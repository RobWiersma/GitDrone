import { Component, ElementRef, OnDestroy, afterNextRender, computed, input, model, signal, viewChild } from '@angular/core';
import { FlightTrack, msToKmh } from './flight.models';

const PLOT_H = 110;
const M = { left: 44, right: 14, top: 10, bottom: 8 };
const AXIS_H = 22; // time labels under the lower chart only; both charts share the time axis

export function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  return `${m}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

/** Round tick step: 1, 2 or 5 times a power of ten, giving roughly `count` ticks. */
function ticks(min: number, max: number, count: number): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(f => f * pow).find(s => s >= raw)!;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

interface Series {
  key: 'height' | 'speed';
  title: string;
  unit: string;
  value: (i: number) => number;
}

/**
 * Height and speed over time as two small charts on one time axis (two measures, two charts; never a dual axis).
 * The hovered point is shared with the map through `hoverIndex`.
 */
@Component({
  selector: 'app-flight-profile',
  template: `
    <div #box class="box" tabindex="0" role="group"
         aria-label="Height and speed over time. Use the left and right arrow keys to step through the flight."
         (pointermove)="onPointer($event)" (pointerleave)="hoverIndex.set(null)" (keydown)="onKey($event)">
      @for (c of charts(); track c.key; let last = $last) {
        <h3 class="title">{{ c.title }} <span class="unit">({{ c.unit }})</span></h3>
        <svg [attr.width]="width()" [attr.height]="c.height" aria-hidden="true">
          @for (t of c.yTicks; track t.v) {
            <line class="grid" [attr.x1]="m.left" [attr.x2]="width() - m.right" [attr.y1]="t.y" [attr.y2]="t.y" />
            <text class="ylab" [attr.x]="m.left - 6" [attr.y]="t.y" dy="0.32em">{{ t.v }}</text>
          }
          <path class="area" [attr.d]="c.area" />
          <path class="line" [attr.d]="c.line" />
          @if (last) {
            @for (t of xTicks(); track t.v) {
              <text class="xlab" [attr.x]="t.x" [attr.y]="c.height - 6">{{ t.label }}</text>
            }
          }
          @if (cursor(); as k) {
            <line class="cross" [attr.x1]="k.x" [attr.x2]="k.x" [attr.y1]="m.top" [attr.y2]="m.top + plotH" />
            <circle class="dot" [attr.cx]="k.x" [attr.cy]="c.dotY(k.i)" r="4" />
            <g [attr.transform]="'translate(' + c.labelX(k.x) + ',' + (m.top + 2) + ')'">
              <rect class="tip" [attr.width]="c.labelW" height="18" rx="4" />
              <text class="tiptext" x="6" y="13">{{ c.labelText(k.i) }}</text>
            </g>
          }
        </svg>
      }
    </div>
    @if (cursor(); as k) {
      <p class="sr-only" aria-live="polite">{{ k.summary }}</p>
    }
  `,
  styles: [`
    :host { display: block; }
    .box { outline: none; border-radius: 6px; touch-action: pan-y; }
    .box:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
    .title { margin: .6rem 0 .1rem; font-size: .72rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
    .unit { color: var(--muted); font-weight: normal; }
    svg { display: block; overflow: visible; }
    .grid { stroke: var(--line); stroke-width: 1; }
    .ylab, .xlab { fill: var(--muted); font-size: 11px; font-family: var(--mono); font-variant-numeric: tabular-nums; }
    .ylab { text-anchor: end; }
    .xlab { text-anchor: middle; }
    .line { fill: none; stroke: var(--chart-line); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .area { fill: var(--chart-area); }
    .cross { stroke: var(--ink); stroke-width: 1; stroke-dasharray: 3 3; }
    .dot { fill: var(--chart-line); stroke: var(--surface); stroke-width: 2; }
    .tip { fill: var(--ink); }
    .tiptext { fill: var(--surface); font-size: 11px; font-weight: 700; font-family: var(--mono); font-variant-numeric: tabular-nums; }
  `],
})
export class FlightProfileComponent implements OnDestroy {
  track = input.required<FlightTrack>();
  hoverIndex = model<number | null>(null);

  readonly m = M;
  readonly plotH = PLOT_H;

  private box = viewChild.required<ElementRef<HTMLDivElement>>('box');
  private resize?: ResizeObserver;
  width = signal(600);

  private series: Series[] = [
    { key: 'height', title: 'Height above takeoff', unit: 'm', value: i => this.track().points[i][3] },
    { key: 'speed', title: 'Ground speed', unit: 'km/h', value: i => msToKmh(this.track().points[i][4]) },
  ];

  private times = computed(() => this.track().points.map(p => p[0]));
  private x = computed(() => {
    const t = this.times();
    const t0 = t[0], t1 = t.at(-1)! || 1;
    const w = this.width() - M.left - M.right;
    return (v: number) => M.left + ((v - t0) / (t1 - t0 || 1)) * w;
  });

  xTicks = computed(() => {
    const t = this.times();
    const x = this.x();
    const target = Math.max(2, Math.floor((this.width() - M.left - M.right) / 90));
    // Steps in whole seconds that read well as m:ss.
    const span = t.at(-1)! - t[0];
    const step = [5, 10, 15, 30, 60, 120, 300, 600].find(s => span / s <= target) ?? 600;
    const out: { v: number; x: number; label: string }[] = [];
    for (let v = Math.ceil(t[0] / step) * step; v <= t.at(-1)!; v += step) out.push({ v, x: x(v), label: clock(v) });
    return out;
  });

  charts = computed(() => {
    const n = this.track().points.length;
    const x = this.x();
    const times = this.times();
    return this.series.map((s, idx) => {
      const values = Array.from({ length: n }, (_, i) => s.value(i));
      const lo = Math.min(0, ...values);
      const hi = Math.max(...values, lo + 1);
      const yt = ticks(lo, hi, 3);
      const yMin = Math.min(lo, yt[0]);
      const yMax = Math.max(hi, yt.at(-1)!);
      const y = (v: number) => M.top + PLOT_H - ((v - yMin) / (yMax - yMin || 1)) * PLOT_H;

      let line = '';
      for (let i = 0; i < n; i++) line += `${i ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(values[i]).toFixed(1)}`;
      const base = y(Math.max(yMin, 0)).toFixed(1);
      const area = `${line}L${x(times[n - 1]).toFixed(1)},${base}L${x(times[0]).toFixed(1)},${base}Z`;

      const labelW = 64;
      const isLast = idx === this.series.length - 1;
      return {
        key: s.key,
        title: s.title,
        unit: s.unit,
        height: M.top + PLOT_H + M.bottom + (isLast ? AXIS_H : 0),
        yTicks: yt.map(v => ({ v, y: y(v) })),
        line,
        area,
        labelW,
        dotY: (i: number) => y(values[i]),
        labelText: (i: number) => `${Math.round(values[i])} ${s.unit}`,
        // Keep the value label inside the plot: right of the crosshair, or left near the right edge.
        labelX: (cx: number) => (cx + 8 + labelW > this.width() - M.right ? cx - 8 - labelW : cx + 8),
      };
    });
  });

  cursor = computed(() => {
    const i = this.hoverIndex();
    const p = i === null ? undefined : this.track().points[i];
    if (i === null || !p) return null;
    return {
      i,
      x: this.x()(p[0]),
      summary: `${clock(p[0])}: ${Math.round(p[3])} m above takeoff, ${Math.round(msToKmh(p[4]))} km/h`,
    };
  });

  constructor() {
    afterNextRender(() => {
      const el = this.box().nativeElement;
      this.resize = new ResizeObserver(() => this.width.set(Math.max(240, el.clientWidth)));
      this.resize.observe(el);
    });
  }

  ngOnDestroy() {
    this.resize?.disconnect();
  }

  onPointer(e: PointerEvent) {
    const rect = this.box().nativeElement.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < M.left || px > this.width() - M.right) { this.hoverIndex.set(null); return; }
    const t = this.times();
    const w = this.width() - M.left - M.right;
    const target = t[0] + ((px - M.left) / w) * (t.at(-1)! - t[0]);
    this.hoverIndex.set(this.nearest(target));
  }

  onKey(e: KeyboardEvent) {
    const n = this.track().points.length;
    const cur = this.hoverIndex() ?? 0;
    // Step about one second per key press, ten with Shift.
    const perSecond = Math.max(1, Math.round(n / Math.max(1, this.times().at(-1)! - this.times()[0])));
    const step = perSecond * (e.shiftKey ? 10 : 1);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = Math.min(n - 1, cur + step);
    else if (e.key === 'ArrowLeft') next = Math.max(0, cur - step);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'Escape') { this.hoverIndex.set(null); return; }
    if (next === null) return;
    e.preventDefault();
    this.hoverIndex.set(next);
  }

  /** Binary search for the sample closest in time. */
  private nearest(target: number): number {
    const t = this.times();
    let lo = 0, hi = t.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid] < target) lo = mid; else hi = mid;
    }
    return target - t[lo] <= t[hi] - target ? lo : hi;
  }
}
