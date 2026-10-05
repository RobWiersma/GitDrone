import { Component, computed, input, signal } from '@angular/core';
import { StickPoint } from './flight.models';
import { AXIS_LABELS, Axis, MODES, StickMode, rawStick, readStickMode, sampleSticks, saveStickMode, stickAxes } from './stick-math';

// Blackbox Explorer style: two dark squares, thin crosshairs, a red dot, raw rcCommand values around them.
const S = 112;      // each stick box, px
const GAP = 22;     // between the boxes
const SIDE = 46;    // room for the vertical value beside each box
const BELOW = 22;   // room for the horizontal value under each box
const DOT = 6;

@Component({
  selector: 'app-flight-sticks',
  template: `
    <div class="sticks">
      <svg [attr.width]="width" [attr.height]="height" [attr.viewBox]="'0 0 ' + width + ' ' + height" aria-hidden="true">
        @for (g of gimbals(); track g.side) {
          <rect class="box" [attr.x]="g.left" y="0" [attr.width]="s" [attr.height]="s" rx="10" />
          <line class="cross" [attr.x1]="g.left" [attr.x2]="g.left + s" [attr.y1]="s / 2" [attr.y2]="s / 2" />
          <line class="cross" [attr.x1]="g.left + s / 2" [attr.x2]="g.left + s / 2" y1="0" [attr.y2]="s" />
          <circle class="dot" [attr.cx]="g.x" [attr.cy]="g.y" [attr.r]="dot" />
          <!-- Vertical value outside the pair, horizontal value underneath, as in Blackbox Explorer. -->
          <text class="val" [attr.x]="g.side === 'left' ? g.left - 8 : g.left + s + 8" [attr.y]="s / 2"
                [attr.text-anchor]="g.side === 'left' ? 'end' : 'start'" dy="0.35em">{{ g.vValue }}</text>
          <text class="val" [attr.x]="g.left + s / 2" [attr.y]="s + 16" text-anchor="middle">{{ g.hValue }}</text>
        }
        <text class="mode-label" [attr.x]="side + s / 2" [attr.y]="s - 10" text-anchor="middle">Mode {{ mode() }}</text>
      </svg>
      <p class="sr-only">{{ summary() }}</p>
    </div>
    <div class="mode" role="group" aria-label="Stick mode">
      @for (m of modes; track m) {
        <button type="button" [attr.aria-pressed]="mode() === m" (click)="setMode(m)">Mode {{ m }}</button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .sticks { display: flex; justify-content: center; }
    svg { display: block; overflow: visible; }
    .box { fill: #1c1c1c; fill-opacity: .9; }
    .cross { stroke: #ffffff; stroke-opacity: .35; stroke-width: 1; }
    .dot { fill: #ff5a5a; }
    .val { fill: var(--ink); font-family: var(--mono); font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .mode-label { fill: #ffffff; fill-opacity: .35; font-size: 11px; font-weight: 700; }
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

  readonly s = S;
  readonly side = SIDE;
  readonly dot = DOT;
  readonly width = SIDE + S + GAP + S + SIDE;
  readonly height = S + BELOW;
  readonly modes: StickMode[] = [1, 2, 3, 4];
  mode = signal<StickMode>(readStickMode());

  private sample = computed(() => sampleSticks(this.points(), this.time()));

  gimbals = computed(() => {
    const raw = this.sample();
    const now = stickAxes(raw);
    const r = S / 2 - DOT - 2; // keep the dot inside the box at full deflection
    const [lx, ly, rx, ry] = MODES[this.mode()];
    return ([
      { side: 'left', left: SIDE, x: lx, y: ly },
      { side: 'right', left: SIDE + S + GAP, x: rx, y: ry },
    ] as const).map(g => ({
      side: g.side,
      left: g.left,
      x: g.left + S / 2 + now[g.x] * r,
      y: S / 2 - now[g.y] * r,
      vValue: rawStick(raw, g.y),
      hValue: rawStick(raw, g.x),
    }));
  });

  /** Plain-text version for screen readers. */
  summary = computed(() => {
    const raw = this.sample();
    return (['throttle', 'yaw', 'pitch', 'roll'] as Axis[]).map(a => `${AXIS_LABELS[a]} ${rawStick(raw, a)}`).join(', ');
  });

  setMode(m: StickMode) {
    this.mode.set(m);
    saveStickMode(m);
  }
}
