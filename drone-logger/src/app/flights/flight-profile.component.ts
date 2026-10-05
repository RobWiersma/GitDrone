import { Component, ElementRef, OnDestroy, afterNextRender, computed, input, output, signal, viewChild } from '@angular/core';

const PLOT_H = 96;
const M = { left: 44, right: 14, top: 10, bottom: 8 };
const AXIS_H = 22; // time labels under the last chart only; every chart shares the time axis

export function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  return `${m}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

/** One measure over time. Each series keeps its own sample times, so 10 Hz GPS and 10 Hz battery can differ. */
export interface ChartSeries {
  key: string;
  title: string;
  unit: string;
  times: number[];
  values: number[];
  decimals?: number;
  /** Start the y-axis at zero (heights, speeds, currents) or fit the data (voltages). */
  fromZero?: boolean;
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

/** Index of the sample closest in time. */
export function nearest(times: number[], t: number): number {
  let lo = 0, hi = times.length - 1;
  if (t <= times[0]) return 0;
  if (t >= times[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid; else hi = mid;
  }
  return t - times[lo] <= times[hi] - t ? lo : hi;
}

/**
 * Small charts stacked on one time axis (one measure per chart; never a dual axis).
 * `time` is the shared cursor; hovering or arrow keys emit `hover` with a time in seconds.
 */
@Component({
  selector: 'app-flight-profile',
  template: `
    <div #box class="box" tabindex="0" role="group"
         aria-label="Flight charts over time. Use the left and right arrow keys to step through the flight."
         (pointermove)="onPointer($event)" (pointerleave)="hover.emit(null)" (keydown)="onKey($event)">
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
          @if (cursorX(); as x) {
            <line class="cross" [attr.x1]="x" [attr.x2]="x" [attr.y1]="m.top" [attr.y2]="m.top + plotH" />
            <circle class="dot" [attr.cx]="x" [attr.cy]="c.dotY()" r="4" />
            <g [attr.transform]="'translate(' + c.labelX(x) + ',' + (m.top + 2) + ')'">
              <rect class="tip" [attr.width]="labelW" height="18" rx="4" />
              <text class="tiptext" x="6" y="13">{{ c.labelText() }}</text>
            </g>
          }
        </svg>
      }
    </div>
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
  series = input.required<ChartSeries[]>();
  /** Flight length in seconds; the shared x-axis runs 0..duration. */
  duration = input.required<number>();
  /** Cursor in seconds since log start, or null for none. */
  time = input<number | null>(null);
  hover = output<number | null>();

  readonly m = M;
  readonly plotH = PLOT_H;
  readonly labelW = 72;

  private box = viewChild.required<ElementRef<HTMLDivElement>>('box');
  private resize?: ResizeObserver;
  width = signal(600);

  private x = computed(() => {
    const w = this.width() - M.left - M.right;
    const d = this.duration() || 1;
    return (t: number) => M.left + (t / d) * w;
  });

  cursorX = computed(() => {
    const t = this.time();
    return t === null ? null : this.x()(t);
  });

  xTicks = computed(() => {
    const d = this.duration();
    const x = this.x();
    const target = Math.max(2, Math.floor((this.width() - M.left - M.right) / 90));
    const step = [5, 10, 15, 30, 60, 120, 300, 600].find(s => d / s <= target) ?? 600;
    const out: { v: number; x: number; label: string }[] = [];
    for (let v = 0; v <= d; v += step) out.push({ v, x: x(v), label: clock(v) });
    return out;
  });

  charts = computed(() => {
    const x = this.x();
    const series = this.series();
    return series.map((s, idx) => {
      const n = s.values.length;
      const lo = s.fromZero === false ? Math.min(...s.values) : Math.min(0, ...s.values);
      const hi = Math.max(...s.values, lo + (s.fromZero === false ? 0.1 : 1));
      const yt = ticks(lo, hi, 3);
      const yMin = Math.min(lo, yt[0]);
      const yMax = Math.max(hi, yt.at(-1)!);
      const y = (v: number) => M.top + PLOT_H - ((v - yMin) / (yMax - yMin || 1)) * PLOT_H;

      let line = '';
      for (let i = 0; i < n; i++) line += `${i ? 'L' : 'M'}${x(s.times[i]).toFixed(1)},${y(s.values[i]).toFixed(1)}`;
      const base = y(Math.max(yMin, s.fromZero === false ? yMin : 0)).toFixed(1);
      const area = n ? `${line}L${x(s.times[n - 1]).toFixed(1)},${base}L${x(s.times[0]).toFixed(1)},${base}Z` : '';

      const at = () => {
        const t = this.time();
        return t === null || !n ? null : nearest(s.times, t);
      };
      return {
        key: s.key,
        title: s.title,
        unit: s.unit,
        height: M.top + PLOT_H + M.bottom + (idx === series.length - 1 ? AXIS_H : 0),
        yTicks: yt.map(v => ({ v, y: y(v) })),
        line,
        area,
        dotY: () => { const i = at(); return i === null ? 0 : y(s.values[i]); },
        labelText: () => { const i = at(); return i === null ? '' : `${s.values[i].toFixed(s.decimals ?? 0)} ${s.unit}`; },
        // Keep the value label inside the plot: right of the crosshair, or left near the right edge.
        labelX: (cx: number) => (cx + 8 + this.labelW > this.width() - M.right ? cx - 8 - this.labelW : cx + 8),
      };
    });
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
    if (px < M.left || px > this.width() - M.right) { this.hover.emit(null); return; }
    const w = this.width() - M.left - M.right;
    this.hover.emit(((px - M.left) / w) * this.duration());
  }

  onKey(e: KeyboardEvent) {
    const d = this.duration();
    const cur = this.time() ?? 0;
    const step = e.shiftKey ? 10 : 1; // seconds
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = Math.min(d, cur + step);
    else if (e.key === 'ArrowLeft') next = Math.max(0, cur - step);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = d;
    else if (e.key === 'Escape') { this.hover.emit(null); return; }
    if (next === null) return;
    e.preventDefault();
    this.hover.emit(next);
  }
}
