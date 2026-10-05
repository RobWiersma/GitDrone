import { Component, computed, input, signal } from '@angular/core';
import { StickPoint } from './flight.models';

type Axis = 'roll' | 'pitch' | 'yaw' | 'throttle';
type Mode = 1 | 2 | 3 | 4;

/** Which axis each stick moves, per transmitter mode: [left x, left y, right x, right y]. */
const MODES: Record<Mode, [Axis, Axis, Axis, Axis]> = {
  1: ['yaw', 'pitch', 'roll', 'throttle'],
  2: ['yaw', 'throttle', 'roll', 'pitch'],
  3: ['roll', 'pitch', 'yaw', 'throttle'],
  4: ['roll', 'throttle', 'yaw', 'pitch'],
};

const LABELS: Record<Axis, string> = { roll: 'Roll', pitch: 'Pitch', yaw: 'Yaw', throttle: 'Thr' };
const MODE_KEY = 'gitdrone-stick-mode';
const TRAIL_S = 0.6;

/** Values at time t, linearly interpolated between the 25 Hz samples. */
function sample(points: StickPoint[], t: number): StickPoint {
  if (t <= points[0][0]) return points[0];
  if (t >= points.at(-1)![0]) return points.at(-1)!;
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] < t) lo = mid; else hi = mid;
  }
  const a = points[lo], b = points[hi];
  const f = (t - a[0]) / (b[0] - a[0] || 1);
  return a.map((v, i) => v + (b[i] - v) * f) as StickPoint;
}

/** Stick positions as -1..1 on each axis. Up and right are positive. */
function axes(p: StickPoint) {
  return {
    roll: p[1] / 500,
    pitch: p[2] / 500,
    // Betaflight stores rcCommand[YAW] inverted relative to the stick, so flip it back for display.
    yaw: -p[3] / 500,
    throttle: (p[4] - 1500) / 500,
  };
}

function readMode(): Mode {
  try {
    const v = Number(localStorage.getItem(MODE_KEY));
    return v === 1 || v === 3 || v === 4 ? v : 2;
  } catch {
    return 2;
  }
}

const SIZE = 132; // px, each gimbal
const PAD = 12;

@Component({
  selector: 'app-flight-sticks',
  template: `
    <div class="sticks">
      @for (g of gimbals(); track g.side) {
        <figure class="gimbal">
          <svg [attr.width]="size" [attr.height]="size" [attr.viewBox]="'0 0 ' + size + ' ' + size" aria-hidden="true">
            <rect class="frame" x="1" y="1" [attr.width]="size - 2" [attr.height]="size - 2" rx="16" />
            <line class="axis" [attr.x1]="pad" [attr.x2]="size - pad" [attr.y1]="size / 2" [attr.y2]="size / 2" />
            <line class="axis" [attr.y1]="pad" [attr.y2]="size - pad" [attr.x1]="size / 2" [attr.x2]="size / 2" />
            <circle class="ring" [attr.cx]="size / 2" [attr.cy]="size / 2" [attr.r]="size / 2 - pad" />
            <polyline class="trail" [attr.points]="g.trail" />
            <line class="arm" [attr.x1]="size / 2" [attr.y1]="size / 2" [attr.x2]="g.x" [attr.y2]="g.y" />
            <circle class="knob" [attr.cx]="g.x" [attr.cy]="g.y" r="9" />
          </svg>
          <figcaption>
            @for (v of g.values; track v.name) {
              <span><span class="name">{{ v.name }}</span> <span class="val">{{ v.text }}</span></span>
            }
          </figcaption>
        </figure>
      }
    </div>
    <div class="mode" role="group" aria-label="Stick mode">
      @for (m of modes; track m) {
        <button type="button" [attr.aria-pressed]="mode() === m" (click)="setMode(m)">Mode {{ m }}</button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .sticks { display: flex; justify-content: center; gap: clamp(1rem, 6vw, 3rem); flex-wrap: wrap; }
    .gimbal { margin: 0; display: grid; justify-items: center; gap: .4rem; }
    svg { display: block; }
    .frame { fill: var(--raised); stroke: var(--line); stroke-width: 2; }
    .axis { stroke: var(--line); stroke-width: 1; stroke-dasharray: 3 4; }
    .ring { fill: none; stroke: var(--line); stroke-width: 1; }
    .trail { fill: none; stroke: var(--accent); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; opacity: .35; }
    .arm { stroke: var(--muted); stroke-width: 3; stroke-linecap: round; }
    .knob { fill: var(--accent); stroke: var(--surface); stroke-width: 3; }
    figcaption { display: flex; gap: .9rem; font-size: .78rem; }
    .name { color: var(--muted); font-weight: 700; letter-spacing: .06em; text-transform: uppercase; font-size: .68rem; }
    .val { font-family: var(--mono); font-variant-numeric: tabular-nums; display: inline-block; min-width: 3.2em; text-align: right; }
    .mode { display: flex; justify-content: center; gap: .25rem; margin-top: .75rem; }
    .mode button { font: inherit; font-size: .78rem; font-weight: 600; padding: .2rem .6rem; border-radius: 999px; cursor: pointer;
                   border: 1px solid var(--line); background: transparent; color: var(--muted); }
    .mode button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
    .mode button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `],
})
export class FlightSticksComponent {
  points = input.required<StickPoint[]>();
  /** Seconds since log start. */
  time = input.required<number>();

  readonly size = SIZE;
  readonly pad = PAD;
  readonly modes: Mode[] = [1, 2, 3, 4];
  mode = signal<Mode>(readMode());

  gimbals = computed(() => {
    const pts = this.points();
    const t = this.time();
    const now = axes(sample(pts, t));
    const r = SIZE / 2 - PAD;
    const toXY = (x: number, y: number) => [SIZE / 2 + x * r, SIZE / 2 - y * r] as const;

    // Recent positions for the trail, sampled every 40 ms.
    const history: ReturnType<typeof axes>[] = [];
    for (let dt = TRAIL_S; dt > 0; dt -= 0.04) history.push(axes(sample(pts, Math.max(0, t - dt))));
    history.push(now);

    const sign = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;
    const text = (axis: Axis) => (axis === 'throttle' ? `${Math.round(((now.throttle + 1) / 2) * 100)}%` : sign(now[axis]));
    const [lx, ly, rx, ry] = MODES[this.mode()];

    return [
      { side: 'left', x: lx, y: ly },
      { side: 'right', x: rx, y: ry },
    ].map(g => {
      const [x, y] = toXY(now[g.x as Axis], now[g.y as Axis]);
      const trail = history.map(a => toXY(a[g.x as Axis], a[g.y as Axis]).join(',')).join(' ');
      // Vertical axis first, matching how pilots say it ("throttle/yaw").
      const values = [g.y as Axis, g.x as Axis].map(axis => ({ name: LABELS[axis], text: text(axis) }));
      return { side: g.side, x, y, trail, values };
    });
  });

  setMode(m: Mode) {
    this.mode.set(m);
    try { localStorage.setItem(MODE_KEY, String(m)); } catch { /* not persisted */ }
  }
}
