import { BatteryPoint, SpeedUnit, StickPoint, TelemetryPoint, TrackPoint, speedFromMs } from './flight.models';
import { MODES, StickMode, sampleSticks, stickAxes } from './stick-math';
import { clock, nearest } from './flight-profile.component';
import { GlyphFont, SYM } from './glyph-font';

export interface OverlayData {
  track: { home: [number, number] | null; points: TrackPoint[] } | null;
  sticks: StickPoint[] | null;
  battery: { cells: number; points: BatteryPoint[] } | null;
  /** RSSI and barometer height; null for logs without rssi / baroAlt. */
  telemetry: TelemetryPoint[] | null;
}

export type ElementKey = 'timer' | 'rssi' | 'map' | 'speed' | 'battery' | 'sticks';

export const ELEMENT_LABELS: Record<ElementKey, string> = {
  timer: 'Flight timer', rssi: 'RSSI', map: 'Mini map', speed: 'Speed panel', battery: 'Battery panel', sticks: 'Sticks',
};

/**
 * Where the user put an element: its centre as a fraction of the frame (0..1 across, 0..1 down) and a size multiplier.
 * Fractions keep the layout identical at 1080p, 1440p and 4K.
 */
export interface ElementPlacement { x: number; y: number; scale: number }

/** Only moved or resized elements are listed; the rest sit at their default spots. */
export type OverlayLayout = Partial<Record<ElementKey, ElementPlacement>>;

/** An element's box on a canvas, in pixels. */
export interface PlacedElement { key: ElementKey; x: number; y: number; w: number; h: number; scale: number }

/** Text items inside the panels that can be sized on their own. */
export type ItemKey =
  | 'timer.time' | 'rssi.value'
  | 'speed.value' | 'speed.accel' | 'speed.alt' | 'speed.home' | 'speed.sats'
  | 'battery.volts' | 'battery.cell' | 'battery.amps' | 'battery.mah' | 'battery.watts';

export const ELEMENT_ITEMS: Partial<Record<ElementKey, { key: ItemKey; label: string }[]>> = {
  timer: [{ key: 'timer.time', label: 'Time' }],
  rssi: [{ key: 'rssi.value', label: 'RSSI value' }],
  speed: [
    { key: 'speed.value', label: 'Speed' }, { key: 'speed.accel', label: 'G-force' }, { key: 'speed.alt', label: 'Height' },
    { key: 'speed.home', label: 'Distance from home' }, { key: 'speed.sats', label: 'Satellites' },
  ],
  battery: [
    { key: 'battery.cell', label: 'Per-cell voltage' }, { key: 'battery.volts', label: 'Pack voltage' },
    { key: 'battery.amps', label: 'Current' }, { key: 'battery.mah', label: 'mAh used' }, { key: 'battery.watts', label: 'Watts' },
  ],
};

export const ITEM_SCALE_MIN = 0.5, ITEM_SCALE_MAX = 2;

export interface OverlayOptions {
  showSticks: boolean;
  showSpeed: boolean;
  showBattery: boolean;
  showMap: boolean;
  showTimer: boolean;
  /** Link RSSI next to the timer, like Betaflight's RSSI element. */
  showRssi: boolean;
  /** Where the speed panel's altitude comes from. Barometer falls back to GPS when the log has none. */
  altSource: 'gps' | 'baro';
  /** Blurred, fading streak behind each stick dot, like a long exposure. */
  stickTrails: boolean;
  /** Mini map colours (#rrggbb): the path just flown, and what it darkens to as it ages. */
  pathRecentColor: string;
  pathOldColor: string;
  /** Stick colours (#rrggbb): the position dot and its motion-blur trail. */
  stickDotColor: string;
  stickTrailColor: string;
  /** Trail opacity multiplier: 1 is the default look, 0.25 faint, 2 strong. */
  stickTrailIntensity: number;
  /** Stick box fill and crosshair (#rrggbb); their transparency stays fixed. */
  stickBoxColor: string;
  stickCrossColor: string;
  stickMode: StickMode;
  /** Background panels behind each element, 0..1. */
  panelOpacity: number;
  /** Betaflight OSD font to draw text with; null uses the built-in monospace font. */
  font: GlyphFont | null;
  speedUnit: SpeedUnit;
  layout: OverlayLayout;
  /** Text size multipliers for items inside panels; missing means 100%. */
  itemScale: Partial<Record<ItemKey, number>>;
}

/** One piece of text in a panel row; `w` replaces measuring for drawn shapes (the built-in battery icon). */
interface Part { s: string; size: number; weight: number; w?: number }
interface Row { baseline: number; items: { key?: ItemKey; parts: Part[] }[] }
/** A panel's size and its rows' baselines, in 1080p units at element scale 1. */
interface Geometry { w: number; h: number; baselines: number[]; k: (item: ItemKey) => number }

const ACCENT = '#9be564';
const FONT = 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';

/** The OSD font and speed unit for the frame being drawn (set at the start of draw). */
let glyphs: GlyphFont | null = null;
let speedUnit: SpeedUnit = 'kmh';

/** Unit strings: Betaflight's own symbols with an OSD font, plain text otherwise. */
const units = () => glyphs
  ? { kph: speedUnit === 'mph' ? SYM.mph : SYM.kph, volt: SYM.volt, perCell: SYM.volt, amp: SYM.amp, mah: SYM.mah, watt: SYM.watt, m: SYM.m,
      alt: SYM.alt, home: SYM.home, fly: SYM.fly, rssi: SYM.rssi }
  : { kph: speedUnit === 'mph' ? 'mph' : 'km/h', volt: 'V', perCell: ' V/cell', amp: ' A', mah: ' mAh', watt: ' W', m: ' m',
      alt: '▲ ', home: '⌂ ', fly: '', rssi: '' };

/**
 * Text sizes shared by the speed and battery panels (1080p px), so their headline numbers, units and small readings
 * match: the speed number is the same size as the per-cell voltage, and every small reading is the same size.
 */
const BIG = 36;
const unitSize = () => (glyphs ? 28 : 22);
const SMALL = 24;
/** Panel height and row baselines shared by the speed and battery panels, so they line up side by side. */
const ROW1 = 60, ROW2 = 106, TWO_ROW_H = 128;

/** Satellite count: after Betaflight's satellite icon with an OSD font, or "24 SAT" in the built-in font. */
const satText = (n: number) => (glyphs ? `${SYM.sat}${n}` : `${n} SAT`);

/** Betaflight battery icon for a per-cell voltage (3.3 V empty .. 4.2 V full). */
const batteryIcon = (cell: number) => SYM.batt[6 - Math.max(0, Math.min(6, Math.round(((cell - 3.3) / 0.9) * 6)))];

/**
 * Draws one HUD frame for time t (seconds since log start) onto a transparent canvas.
 * Layout is designed at 1080p and scaled by canvas height, so 1440p and 4K look identical, only sharper.
 */
export class OverlayRenderer {
  private trackTimes: number[];
  private batteryTimes: number[];
  private telemetryTimes: number[];
  private hasRssi: boolean;
  private hasBaro: boolean;
  /** The battery panel is shorter without a current sensor; fixed per flight so the box doesn't jump. */
  private hasCurrent: boolean;
  /** mAh used up to each battery sample. */
  private mahAt: number[];
  /** Metres from home at each track point. */
  private homeDist: number[];
  private mapBounds?: { minX: number; maxX: number; minY: number; maxY: number };
  private mapXY: [number, number][] = [];
  private homeXY: [number, number] | null = null;

  constructor(private data: OverlayData) {
    this.trackTimes = data.track?.points.map(p => p[0]) ?? [];
    this.batteryTimes = data.battery?.points.map(p => p[0]) ?? [];
    this.telemetryTimes = data.telemetry?.map(p => p[0]) ?? [];
    this.hasRssi = data.telemetry?.some(p => p[1] !== null) ?? false;
    this.hasBaro = data.telemetry?.some(p => p[2] !== null) ?? false;
    this.hasCurrent = data.battery?.points[0]?.[2] != null;

    this.mahAt = [];
    let mah = 0;
    const bp = data.battery?.points ?? [];
    for (let i = 0; i < bp.length; i++) {
      if (i > 0 && bp[i][2] !== null) mah += (bp[i][2]! * (bp[i][0] - bp[i - 1][0])) / 3.6;
      this.mahAt.push(mah);
    }

    const tp = data.track?.points ?? [];
    const home = data.track?.home ?? (tp.length ? [tp[0][1], tp[0][2]] as [number, number] : null);
    this.homeDist = tp.map(p => (home ? haversine(home[0], home[1], p[1], p[2]) : 0));

    // Project the path to local metres (equirectangular is fine at flying-field scale).
    if (tp.length) {
      const lat0 = tp[0][1] * Math.PI / 180;
      const toXY = (lat: number, lon: number): [number, number] => [lon * 111_320 * Math.cos(lat0), lat * 110_540];
      this.mapXY = tp.map(p => toXY(p[1], p[2]));
      const all = home ? [...this.mapXY, toXY(home[0], home[1])] : this.mapXY;
      this.mapBounds = {
        minX: Math.min(...all.map(p => p[0])), maxX: Math.max(...all.map(p => p[0])),
        minY: Math.min(...all.map(p => p[1])), maxY: Math.max(...all.map(p => p[1])),
      };
      this.homeXY = home ? toXY(home[0], home[1]) : null;
    }
  }

  draw(ctx: CanvasRenderingContext2D, t: number, o: OverlayOptions) {
    const { width: W, height: H } = ctx.canvas;
    const u = H / 1080;
    ctx.clearRect(0, 0, W, H);
    glyphs = o.font;
    speedUnit = o.speedUnit;

    for (const p of this.placements(W, H, o)) {
      const s = u * p.scale; // each element draws in its own scaled units, so text, icons and panels grow together
      switch (p.key) {
        case 'timer': this.drawTimer(ctx, t, p.x, p.y, s, o); break;
        case 'rssi': this.drawRssi(ctx, t, p.x, p.y, s, o); break;
        case 'map': this.drawMap(ctx, t, p.x, p.y, p.w, s, o); break;
        case 'speed': this.drawSpeed(ctx, t, p.x, p.y, s, o); break;
        case 'battery': this.drawBattery(ctx, t, p.x, p.y, s, o); break;
        case 'sticks': this.drawSticks(ctx, t, p.x, p.y, s, o); break;
      }
    }
  }

  /**
   * Every element that will be drawn, with its box on a W x H canvas, in drawing order (later ones on top).
   * Moved elements sit centred on their placement; the rest use the default HUD layout.
   */
  placements(W: number, H: number, o: OverlayOptions): PlacedElement[] {
    glyphs = o.font; // panel widths depend on the font being measured
    speedUnit = o.speedUnit;
    const u = H / 1080;
    const m = 48 * u;
    const out: PlacedElement[] = [];
    // w and h are 1080p sizes at scale 1; (dx, dy) is the default top-left.
    const add = (key: ElementKey, show: boolean, w: number, h: number, dx: number, dy: number) => {
      if (!show) return;
      const pl = o.layout?.[key];
      const scale = pl?.scale ?? 1;
      const pw = w * u * scale, ph = h * u * scale;
      // Kept fully inside the frame, so growing a corner element pushes it inward instead of cutting it off.
      const inside = (v: number, size: number, max: number) => Math.min(Math.max(0, v), Math.max(0, max - size));
      out.push(pl
        ? { key, x: inside(pl.x * W - pw / 2, pw, W), y: inside(pl.y * H - ph / 2, ph, H), w: pw, h: ph, scale }
        : { key, x: dx, y: dy, w: pw, h: ph, scale });
    };
    const timer = this.geometry('timer', o), rssi = this.geometry('rssi', o);
    const speed = this.geometry('speed', o), battery = this.geometry('battery', o);
    add('timer', o.showTimer, timer.w, timer.h, m, m);
    add('rssi', o.showRssi && this.hasRssi, rssi.w, rssi.h, o.showTimer ? m + (timer.w + 16) * u : m, m);
    add('map', o.showMap && this.mapXY.length > 1, 300, 300, W - m - 300 * u, m);
    add('speed', o.showSpeed && this.trackTimes.length > 0, speed.w, speed.h, m, H - m - speed.h * u);
    add('battery', o.showBattery && this.batteryTimes.length > 0, battery.w, battery.h, W - m - battery.w * u, H - m - battery.h * u);
    add('sticks', o.showSticks && !!this.data.sticks?.length, 330, 150, W / 2 - 165 * u, H - m - 150 * u);
    return out;
  }

  // ---------- elements ----------

  /**
   * Panel layout from the default design plus whatever the user resized. Each row's baseline moves down by the extra
   * height of the rows above it (and most of its own), and the panel widens when a row's widest-case text no longer
   * fits, so nothing overlaps. With every item at 100% this is exactly the original layout.
   */
  private geometry(key: 'timer' | 'rssi' | 'speed' | 'battery', o: OverlayOptions): Geometry {
    const k = (item: ItemKey) => Math.min(ITEM_SCALE_MAX, Math.max(ITEM_SCALE_MIN, o.itemScale?.[item] ?? 1));
    const U = units();
    const lbl = (s: string): Row['items'] => (glyphs ? [] : [{ parts: [{ s, size: 20, weight: 700 }] }]);
    switch (key) {
      case 'timer':
        return fit(210, 92, 22, k, [
          { baseline: 30, items: lbl('FLIGHT TIME') },
          { baseline: 74, items: [{ key: 'timer.time', parts: [{ s: U.fly + '88:88', size: 46, weight: 700 }] }] },
        ]);
      case 'rssi':
        return fit(170, 92, 22, k, [
          { baseline: 30, items: lbl('RSSI') },
          { baseline: 74, items: [{ key: 'rssi.value', parts: [{ s: `${U.rssi}99${glyphs ? '' : '%'}`, size: 46, weight: 700 }] }] },
        ]);
      case 'speed':
        // No label: the speed unit says what it is. Same rows and text sizes as the battery panel.
        return fit(400, TWO_ROW_H, 26, k, [
          { baseline: ROW1, items: [
            { key: 'speed.value', parts: [{ s: '188', size: BIG, weight: 800 }, { s: U.kph, size: unitSize(), weight: 600 }] },
            { key: 'speed.accel', parts: [{ s: '9.9G', size: SMALL, weight: 700 }] },
          ] },
          { baseline: ROW2, items: [
            { key: 'speed.alt', parts: [{ s: `${U.alt}888${U.m}`, size: SMALL, weight: 700 }] },
            { key: 'speed.home', parts: [{ s: `${U.home}8888${U.m}`, size: SMALL, weight: 700 }] },
            { key: 'speed.sats', parts: [{ s: satText(88), size: SMALL, weight: 700 }] },
          ] },
        ]);
      case 'battery': {
        const icon: Part = glyphs ? { s: SYM.batt[0], size: BIG, weight: 700 } : { s: '', size: BIG, weight: 700, w: 26 };
        const rows: Row[] = [{ baseline: ROW1, items: [
          { key: 'battery.cell', parts: [icon, { s: '4.20', size: BIG, weight: 800 }, { s: glyphs ? U.volt : 'V/cell', size: unitSize(), weight: 600 }] },
          { key: 'battery.volts', parts: [{ s: `88.8${glyphs ? U.volt : ' V'}`, size: SMALL, weight: 600 }] },
        ] }];
        if (this.hasCurrent) rows.push({ baseline: ROW2, items: [
          { key: 'battery.amps', parts: [{ s: `188.8${U.amp}`, size: SMALL, weight: 700 }] },
          { key: 'battery.mah', parts: [{ s: `8888${U.mah}`, size: SMALL, weight: 700 }] },
          { key: 'battery.watts', parts: [{ s: `8888${U.watt}`, size: SMALL, weight: 700 }] },
        ] });
        return fit(400, this.hasCurrent ? TWO_ROW_H : 86, 26, k, rows);
      }
    }
  }

  private drawTimer(ctx: CanvasRenderingContext2D, t: number, x: number, y: number, u: number, o: OverlayOptions) {
    const g = this.geometry('timer', o);
    panel(ctx, x, y, g.w * u, g.h * u, 18 * u, o.panelOpacity);
    if (!glyphs) label(ctx, 'FLIGHT TIME', x + 22 * u, y + g.baselines[0] * u, 20 * u); // OSD fonts say it with the quad icon
    text(ctx, units().fly + clock(t), x + 22 * u, y + g.baselines[1] * u, 46 * g.k('timer.time') * u, 'left', 700);
  }

  /** Betaflight shows RSSI as 0..99 after its antenna glyph; same here, with a % in the built-in font. */
  private drawRssi(ctx: CanvasRenderingContext2D, t: number, x: number, y: number, u: number, o: OverlayOptions) {
    const p = this.data.telemetry![nearest(this.telemetryTimes, t)];
    if (p[1] === null) return;
    const value = Math.min(99, Math.round(p[1]));
    const warn = value < 20 ? '#ffb340' : undefined; // Betaflight's default osd_rssi_alarm
    const g = this.geometry('rssi', o);
    panel(ctx, x, y, g.w * u, g.h * u, 18 * u, o.panelOpacity);
    if (!glyphs) label(ctx, 'RSSI', x + 22 * u, y + g.baselines[0] * u, 20 * u);
    text(ctx, `${units().rssi}${value}${glyphs ? '' : '%'}`, x + 22 * u, y + g.baselines[1] * u, 46 * g.k('rssi.value') * u, 'left', 700, 1, warn);
  }

  private drawSpeed(ctx: CanvasRenderingContext2D, t: number, x: number, y: number, u: number, o: OverlayOptions) {
    const i = nearest(this.trackTimes, t);
    const p = this.data.track!.points[i];
    // Same width as the battery panel by default. Line 1: speed and acceleration; line 2: altitude, home distance, satellites.
    const g = this.geometry('speed', o);
    const w = g.w * u, [b1, b2] = g.baselines.map(b => y + b * u);
    panel(ctx, x, y, w, g.h * u, 22 * u, o.panelOpacity);
    const U = units();
    const sv = g.k('speed.value');
    const speed = speedFromMs(p[4], o.speedUnit).toFixed(0);
    text(ctx, speed, x + 26 * u, b1, BIG * sv * u, 'left', 800);
    text(ctx, U.kph, x + 26 * u + measure(ctx, speed, BIG * sv * u, 800) + 8 * sv * u, b1, unitSize() * sv * u, 'left', 600, 0.85);
    if (p[6] !== undefined) text(ctx, `${(p[6] / 9.81).toFixed(1)}G`, x + w - 26 * u, b1, SMALL * g.k('speed.accel') * u, 'right', 700);
    const tl = o.altSource === 'baro' && this.hasBaro ? this.data.telemetry![nearest(this.telemetryTimes, t)] : null;
    const alt = tl?.[2] ?? p[3];
    spreadRow(ctx, x + 26 * u, x + w - 26 * u, b2, [
      { s: `${U.alt}${alt.toFixed(0)}${U.m}`, size: SMALL * g.k('speed.alt') * u },
      { s: `${U.home}${this.homeDist[i].toFixed(0)}${U.m}`, size: SMALL * g.k('speed.home') * u },
      p[5] !== undefined ? { s: satText(p[5]), size: SMALL * g.k('speed.sats') * u } : null,
    ]);
  }

  private drawBattery(ctx: CanvasRenderingContext2D, t: number, x: number, y: number, u: number, o: OverlayOptions) {
    const bat = this.data.battery!;
    const i = nearest(this.batteryTimes, t);
    const [, v, a] = bat.points[i];
    const cell = v / bat.cells;
    // Two lines: icon, pack voltage and per-cell average; then amps, mAh used and watts.
    const g = this.geometry('battery', o);
    const w = g.w * u;
    panel(ctx, x, y, w, g.h * u, 22 * u, o.panelOpacity);
    const U = units();
    const low = cell < 3.5;
    const warn = low ? '#ffb340' : undefined;
    const line1 = y + g.baselines[0] * u;
    // Per-cell average is the headline (it reads the same on any pack); the pack total is the smaller figure on the right.
    const kc = g.k('battery.cell');

    // Battery-level icon: Betaflight's own glyph with an OSD font, a drawn one otherwise.
    let vx = x + 26 * u;
    if (glyphs) {
      text(ctx, batteryIcon(cell), vx, line1, BIG * kc * u, 'left', 700);
      vx += measure(ctx, batteryIcon(cell), BIG * kc * u, 700) + 6 * kc * u;
    } else {
      drawBatteryIcon(ctx, vx, line1 - 32 * kc * u, 18 * kc * u, 34 * kc * u, cell, warn);
      vx += 32 * kc * u;
    }
    const perCell = cell.toFixed(2);
    text(ctx, perCell, vx, line1, BIG * kc * u, 'left', 800, 1, warn);
    text(ctx, glyphs ? U.volt : 'V/cell', vx + measure(ctx, perCell, BIG * kc * u, 800) + 8 * kc * u, line1,
         unitSize() * kc * u, 'left', 600, 0.85, warn);
    text(ctx, `${v.toFixed(1)}${glyphs ? U.volt : ' V'}`, x + w - 26 * u, line1, SMALL * g.k('battery.volts') * u, 'right', 600, 0.9, warn);

    if (a !== null && g.baselines.length > 1) {
      spreadRow(ctx, x + 26 * u, x + w - 26 * u, y + g.baselines[1] * u, [
        { s: `${a.toFixed(1)}${U.amp}`, size: SMALL * g.k('battery.amps') * u },
        { s: `${Math.round(this.mahAt[i])}${U.mah}`, size: SMALL * g.k('battery.mah') * u },
        { s: `${Math.round(v * a)}${U.watt}`, size: SMALL * g.k('battery.watts') * u },
      ]);
    }
  }

  /** Blackbox Explorer style: dark squares, thin crosshairs, a red dot, raw rcCommand values around the pair. */
  private drawSticks(ctx: CanvasRenderingContext2D, t: number, x: number, top: number, u: number, o: OverlayOptions) {
    const size = 150 * u, gap = 30 * u, dot = 10 * u;
    const raw = sampleSticks(this.data.sticks!, t);
    const now = stickAxes(raw);
    const [lx, ly, rx, ry] = MODES[o.stickMode];
    const sides = [
      { side: 'left', left: x, ax: lx, ay: ly },
      { side: 'right', left: x + size + gap, ax: rx, ay: ry },
    ] as const;

    const box = hexToRgb(o.stickBoxColor, [28, 28, 28]);
    const cross = hexToRgb(o.stickCrossColor, [255, 255, 255]);
    for (const g of sides) {
      ctx.save();
      // The box keeps its own dark fill (like Blackbox Explorer); the panel slider only fades it further.
      ctx.fillStyle = `rgba(${box.join(', ')}, ${Math.max(0.55, o.panelOpacity + 0.4)})`;
      ctx.beginPath();
      ctx.roundRect(g.left, top, size, size, 14 * u);
      ctx.fill();
      ctx.strokeStyle = `rgba(${cross.join(', ')}, .35)`;
      ctx.lineWidth = Math.max(1, 2 * u);
      ctx.beginPath();
      ctx.moveTo(g.left, top + size / 2); ctx.lineTo(g.left + size, top + size / 2);
      ctx.moveTo(g.left + size / 2, top); ctx.lineTo(g.left + size / 2, top + size);
      ctx.stroke();
      const r = size / 2 - dot - 3 * u;
      const at = (a: ReturnType<typeof stickAxes>) => [g.left + size / 2 + a[g.ax] * r, top + size / 2 - a[g.ay] * r] as const;
      const [kx, ky] = at(now);
      if (o.stickTrails) this.drawTrail(ctx, t, at, g.left, top, size, dot, u, safeColor(o.stickTrailColor, '#9a9a9a'), o.stickTrailIntensity ?? 1);
      ctx.fillStyle = safeColor(o.stickDotColor, '#ff5a5a');
      ctx.beginPath(); ctx.arc(kx, ky, dot, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  /**
   * Motion-blur streak behind a stick dot: the last TRAIL_S seconds as short segments that thin out and fade
   * with age, softened with a blur filter. Clipped to the stick box so the blur never bleeds past its edge.
   */
  private drawTrail(ctx: CanvasRenderingContext2D, t: number, at: (a: ReturnType<typeof stickAxes>) => readonly [number, number],
                    left: number, top: number, size: number, dot: number, u: number, color: string, intensity: number) {
    const TRAIL_S = 0.35, STEPS = 21; // 60 steps a second, so fast flicks still draw a smooth curve
    const pts: (readonly [number, number])[] = [];
    for (let k = STEPS; k >= 0; k--) pts.push(at(stickAxes(sampleSticks(this.data.sticks!, Math.max(0, t - (TRAIL_S * k) / STEPS)))));
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(left, top, size, size, 14 * u);
    ctx.clip();
    ctx.filter = `blur(${Math.max(1, 2.5 * u)}px)`;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    for (let k = 1; k < pts.length; k++) {
      const age = k / (pts.length - 1); // 0 = oldest, 1 = newest
      ctx.globalAlpha = Math.min(1, 0.75 * intensity * age * age);
      // At most 60% of the dot's width, so the streak stays tucked inside the dot's outline instead of fanning out behind it.
      ctx.lineWidth = dot * 2 * (0.2 + 0.4 * age);
      ctx.beginPath();
      ctx.moveTo(pts[k - 1][0], pts[k - 1][1]);
      ctx.lineTo(pts[k][0], pts[k][1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawMap(ctx: CanvasRenderingContext2D, t: number, x: number, y: number, size: number, u: number, o: OverlayOptions) {
    const b = this.mapBounds!;
    panel(ctx, x, y, size, size, 22 * u, o.panelOpacity);
    const pad = 26 * u;
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 20); // metres; at least 20 m so hovers don't fill the box
    const scale = (size - pad * 2) / span;
    const ox = x + size / 2 - ((b.minX + b.maxX) / 2) * scale;
    const oy = y + size / 2 + ((b.minY + b.maxY) / 2) * scale;
    const P = (p: [number, number]) => [ox + p[0] * scale, oy - p[1] * scale] as const;
    const i = nearest(this.trackTimes, t);

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Upcoming path: faint and light. Flown path: bright green where recent, darkening to a solid dark green as it
    // ages, so old flown path never looks like path that's still to come.
    ctx.strokeStyle = 'rgba(255,255,255,.28)';
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    this.mapXY.forEach((p, k) => { const [px, py] = P(p); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();

    const FADE_S = 45;
    const NEW = hexToRgb(o.pathRecentColor, [0x9b, 0xe5, 0x64]);
    const OLD = hexToRgb(o.pathOldColor, [0x2c, 0x4a, 0x1f]); // opaque, so it covers the light outline underneath
    // Age as 0..1 in 5% steps; segments in the same step share one stroke, so long flights stay cheap to draw.
    const ageAt = (k: number) => Math.round(Math.min(1, Math.max(0, t - this.trackTimes[k]) / FADE_S) * 20) / 20;
    ctx.lineWidth = 4 * u;
    let k0 = 0;
    while (k0 < i) {
      const f = ageAt(k0 + 1);
      let k1 = k0 + 1;
      while (k1 < i && ageAt(k1 + 1) === f) k1++;
      const [r, g, b] = NEW.map((c, n) => Math.round(c + (OLD[n] - c) * f));
      ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.beginPath();
      for (let k = k0; k <= k1; k++) { const [px, py] = P(this.mapXY[k]); k === k0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
      ctx.stroke();
      k0 = k1;
    }

    if (this.homeXY) {
      // Home as a hollow ring (no text on the mini map), so it can't be mistaken for the white position dot.
      const [hx, hy] = P(this.homeXY);
      ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.lineWidth = 6 * u;
      ctx.beginPath(); ctx.arc(hx, hy, 9 * u, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3 * u;
      ctx.beginPath(); ctx.arc(hx, hy, 9 * u, 0, Math.PI * 2); ctx.stroke();
    }
    const [cx, cy] = P(this.mapXY[i]);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.lineWidth = 3 * u;
    ctx.beginPath(); ctx.arc(cx, cy, 10 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}

// ---------- drawing helpers ----------

/** A #rrggbb colour, or the fallback if it isn't one. */
const safeColor = (hex: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(hex ?? '') ? hex : fallback);

/** "#9be564" -> [155, 229, 100]; anything unparseable gives the fallback. */
function hexToRgb(hex: string, fallback: number[]): number[] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Upright battery outline with a fill that drains from 4.2 V to 3.3 V per cell (for the built-in font). */
function drawBatteryIcon(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cell: number, warn?: string) {
  const level = Math.max(0, Math.min(1, (cell - 3.3) / 0.9));
  const cap = h * 0.12, line = Math.max(1.5, w * 0.12), inset = line * 1.6;
  ctx.save();
  ctx.lineJoin = 'round';
  // Dark halo first so the icon reads on bright footage, like the text outline.
  ctx.strokeStyle = 'rgba(0,0,0,.75)';
  ctx.lineWidth = line * 2.4;
  ctx.strokeRect(x, y + cap, w, h - cap);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = line;
  ctx.strokeRect(x, y + cap, w, h - cap);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + w * 0.3, y, w * 0.4, cap);
  const inner = h - cap - inset * 2;
  ctx.fillStyle = warn ?? '#ffffff';
  ctx.fillRect(x + inset, y + cap + inset + inner * (1 - level), w - inset * 2, inner * level);
  ctx.restore();
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, opacity: number) {
  if (opacity <= 0) return;
  ctx.save();
  ctx.fillStyle = `rgba(8, 12, 16, ${opacity})`;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.restore();
}

/** OSD glyph cells are taller than the letters in them; this sizes a cell so capitals match `size`. */
const GLYPH_CELL = 1.45;
const GLYPH_BASELINE = 0.78; // fraction of the cell height where the baseline sits

/** Glyph codes for a string: OSD fonts are capitals only (lowercase slots hold icons). */
const glyphCodes = (s: string) => [...s].map(c => (c >= 'a' && c <= 'z' ? c.toUpperCase() : c).charCodeAt(0)).map(c => (c > 255 ? 63 : c));

let tintCanvas: HTMLCanvasElement | null = null;

/** Draws a string from the OSD font sheet. Outlines are baked into the glyphs, so no stroke is needed. */
function glyphText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number,
                   align: CanvasTextAlign, alpha: number, color: string) {
  const f = glyphs!;
  const cellH = size * GLYPH_CELL, cellW = cellH * (f.glyphW / f.glyphH);
  const codes = glyphCodes(s);
  const width = codes.length * cellW;
  const x0 = align === 'center' ? x - width / 2 : align === 'right' || align === 'end' ? x - width : x;
  const top = y - cellH * GLYPH_BASELINE;

  // Tinted text (the low-battery warning) is drawn white offscreen, then recoloured, then copied over.
  const tinted = color !== '#ffffff';
  let target = ctx, ox = x0, oy = top;
  if (tinted) {
    tintCanvas ??= document.createElement('canvas');
    tintCanvas.width = Math.ceil(width);
    tintCanvas.height = Math.ceil(cellH);
    target = tintCanvas.getContext('2d')!;
    ox = 0;
    oy = 0;
  }
  target.save();
  target.imageSmoothingQuality = 'high';
  if (!tinted) target.globalAlpha = alpha;
  codes.forEach((code, k) => {
    target.drawImage(f.atlas, (code % 16) * f.glyphW, Math.floor(code / 16) * f.glyphH, f.glyphW, f.glyphH,
      ox + k * cellW, oy, cellW, cellH);
  });
  target.restore();
  if (tinted) {
    // Multiply keeps the dark outline dark and turns the white fill into the tint colour.
    target.save();
    target.globalCompositeOperation = 'multiply';
    target.fillStyle = color;
    target.fillRect(0, 0, tintCanvas!.width, tintCanvas!.height);
    target.globalCompositeOperation = 'destination-in';
    codes.forEach((code, k) => target.drawImage(f.atlas, (code % 16) * f.glyphW, Math.floor(code / 16) * f.glyphH,
      f.glyphW, f.glyphH, k * cellW, 0, cellW, cellH));
    target.restore();
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(tintCanvas!, x0, top);
    ctx.restore();
  }
}

/** White OSD text with a dark outline, readable over sky and grass alike. Uses the OSD font when one is loaded. */
function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number,
              align: CanvasTextAlign = 'left', weight = 700, alpha = 1, color = '#ffffff') {
  if (glyphs) { glyphText(ctx, s, x, y, size, align, alpha, color); return; }
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.14);
  ctx.strokeStyle = 'rgba(0,0,0,.75)';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
  ctx.restore();
}

function label(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number) {
  text(ctx, s, x, y, size, 'left', 700, 0.75);
}

function measure(ctx: CanvasRenderingContext2D, s: string, size: number, weight: number) {
  if (glyphs) return glyphCodes(s).length * size * GLYPH_CELL * (glyphs.glyphW / glyphs.glyphH);
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  const w = ctx.measureText(s).width;
  ctx.restore();
  return w;
}

/**
 * Three readings on one line: first flush left, last flush right, and the middle one centred in the gap between them,
 * so resizing any of them never makes two collide. A null last item leaves the middle centred in the remaining space.
 */
function spreadRow(ctx: CanvasRenderingContext2D, left: number, right: number, baseline: number,
                   items: [{ s: string; size: number }, { s: string; size: number }, { s: string; size: number } | null]) {
  const [a, b, c] = items;
  text(ctx, a.s, left, baseline, a.size, 'left', 700);
  if (c) text(ctx, c.s, right, baseline, c.size, 'right', 700);
  const gapL = left + measure(ctx, a.s, a.size, 700);
  const gapR = c ? right - measure(ctx, c.s, c.size, 700) : right;
  text(ctx, b.s, (gapL + gapR) / 2, baseline, b.size, 'center', 700);
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** See OverlayRenderer.geometry. Sizes are 1080p units; `pad` is the left/right inset; items in a row sit 20 apart. */
function fit(w0: number, h0: number, pad: number, k: (item: ItemKey) => number, rows: Row[]): Geometry {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  const scaleOf = (key?: ItemKey) => (key ? k(key) : 1);
  let shift = 0, w = w0;
  const baselines: number[] = [];
  for (const r of rows) {
    const sizes = r.items.flatMap(i => i.parts.map(p => ({ base: p.size, now: p.size * scaleOf(i.key) })));
    const delta = sizes.length ? Math.max(...sizes.map(z => z.now)) - Math.max(...sizes.map(z => z.base)) : 0;
    // Most of a row's growth goes above its baseline (text grows upwards from it), the rest pushes the rows below.
    baselines.push(r.baseline + shift + delta * 0.8);
    shift += delta;
    const rowW = (scaled: boolean) => pad * 2 + 20 * Math.max(0, r.items.length - 1) + r.items.reduce((sum, i) => {
      const sc = scaled ? scaleOf(i.key) : 1;
      return sum + i.parts.reduce((acc, p, n) =>
        acc + (n ? 10 * sc : 0) + (p.w !== undefined ? p.w * sc : measure(measureCtx!, p.s, p.size * sc, p.weight)), 0);
    }, 0);
    // Grow only by what resizing added: the default design already decides how tight its own rows are.
    const before = Math.max(w0, rowW(false));
    w = Math.max(w, w0 + Math.max(0, rowW(true) - before));
  }
  return { w, h: h0 + shift, baselines, k };
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6_371_000, toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
