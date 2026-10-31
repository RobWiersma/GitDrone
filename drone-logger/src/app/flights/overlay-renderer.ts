import { BatteryPoint, SpeedUnit, StickPoint, TelemetryPoint, TrackPoint, speedFromMs } from './flight.models';
import { MODES, StickMode, sampleSticks, stickAxes } from './stick-math';
import { clock, nearest } from './flight-profile.component';
import { GlyphFont, SYM } from './glyph-font';
import { BfOsdElement, BfOsdId, BfOsdLayout } from './bf-osd';

export interface OverlayData {
  track: { home: [number, number] | null; points: TrackPoint[] } | null;
  sticks: StickPoint[] | null;
  battery: { cells: number; points: BatteryPoint[] } | null;
  /** RSSI, barometer height and link quality; null for logs with none of them. */
  telemetry: TelemetryPoint[] | null;
}

export type ElementKey = 'rssi' | 'map' | 'speed' | 'battery' | 'sticks' | 'title' | 'craft' | 'link';

export const ELEMENT_LABELS: Record<ElementKey, string> = {
  rssi: 'RSSI panel', map: 'Mini map', speed: 'Speed panel', battery: 'Battery panel', sticks: 'Sticks',
  title: 'Title', craft: 'Craft name', link: 'LQ and cell panel',
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
  | 'rssi.sats' | 'rssi.value' | 'rssi.dbm' | 'rssi.lq' | 'rssi.home' | 'rssi.alt'
  | 'speed.value' | 'speed.accel' | 'speed.amps' | 'speed.watts'
  | 'battery.cell' | 'battery.time' | 'battery.volts' | 'battery.mah'
  | 'link.lq' | 'link.cell';

export const ELEMENT_ITEMS: Partial<Record<ElementKey, { key: ItemKey; label: string }[]>> = {
  rssi: [
    { key: 'rssi.sats', label: 'Satellites' }, { key: 'rssi.value', label: 'RSSI' }, { key: 'rssi.dbm', label: 'RSSI (dBm)' },
    { key: 'rssi.lq', label: 'Link quality' },
    { key: 'rssi.home', label: 'Distance from home' }, { key: 'rssi.alt', label: 'Height' },
  ],
  speed: [
    { key: 'speed.value', label: 'Speed' }, { key: 'speed.accel', label: 'G-force' },
    { key: 'speed.amps', label: 'Current' }, { key: 'speed.watts', label: 'Watts' },
  ],
  battery: [
    { key: 'battery.cell', label: 'Per-cell voltage' }, { key: 'battery.time', label: 'Flight time' },
    { key: 'battery.volts', label: 'Pack voltage' }, { key: 'battery.mah', label: 'mAh used' },
  ],
  link: [{ key: 'link.cell', label: 'Per-cell voltage' }, { key: 'link.lq', label: 'Link quality' }],
};

export const ITEM_SCALE_MIN = 0.5, ITEM_SCALE_MAX = 2;

export interface OverlayOptions {
  showSticks: boolean;
  showSpeed: boolean;
  showBattery: boolean;
  showMap: boolean;
  /** The panel under the mini map: satellites and RSSI, then distance from home and height. */
  showRssi: boolean;
  /** Per-cell voltage and link quality at the battery panel's headline size, by default just above the sticks (logs with LQ). */
  showLink: boolean;
  /** Where the speed panel's altitude comes from. Barometer falls back to GPS when the log has none. */
  altSource: 'gps' | 'baro';
  /** Betaflight-style "--- STATS ---" screen in place of the HUD from `statsAfter` (seconds since log start) on. */
  showStats: boolean;
  statsAfter: number;
  /** Whole flight length, for TOTAL ARM. */
  flightSeconds: number;
  /** Blurred, fading streak behind each stick dot, like a long exposure. */
  stickTrails: boolean;
  /**
   * How the sticks look: 'smooth' (Blackbox Explorer: boxes, crosshairs, a dot), 'pixel' (the same in chunky pixels like
   * the OSD font: a pixel-art box and an empty ring) or 'retro' (Betaflight's own OSD stick overlay, drawn in characters
   * from the OSD font). Smooth when missing.
   */
  stickStyle?: 'smooth' | 'pixel' | 'retro';
  /** The Pixel look's ring colour (#rrggbb). */
  stickRingColor: string;
  /** Mini map colours (#rrggbb): the path just flown, and what it darkens to as it ages. */
  pathRecentColor: string;
  pathOldColor: string;
  /** Stick colours (#rrggbb): the position ring and its motion-blur trail. */
  stickDotColor: string;
  stickTrailColor: string;
  /** Trail opacity multiplier: 1 is the default look, 0.25 faint, 2 strong. */
  stickTrailIntensity: number;
  /**
   * The stick boxes' own opacity, 0..1, apart from the panels': Pixel and Retro draw their box at exactly this (none at 0),
   * Smooth keeps Blackbox Explorer's darker box, a little more opaque than this.
   */
  stickBoxOpacity: number;
  /** Stick box fill and crosshair (#rrggbb); their transparency stays fixed. */
  stickBoxColor: string;
  stickCrossColor: string;
  stickMode: StickMode;
  /** Background panels behind each element, 0..1. */
  panelOpacity: number;
  /** Betaflight OSD font to draw text with; null uses the built-in monospace font. */
  font: GlyphFont | null;
  speedUnit: SpeedUnit;
  /**
   * A channel-style title in two colours ("BRIDGE" + "BOI") on an optional background box, and the craft's name.
   * Each shows only while it has text. Drawn in a bold display font, not the OSD font.
   */
  /** Whether the title and craft name are drawn (each also needs its text). */
  showTitle: boolean;
  showCraft: boolean;
  titleText: string;
  titleColor: string;
  titleAccentText: string;
  titleAccentColor: string;
  titleStrokeColor: string;
  /** #rrggbb, or '' for no box. */
  titleBgColor: string;
  craftText: string;
  craftColor: string;
  craftStrokeColor: string;
  /**
   * Which font the title and the craft name are drawn in: 'osd' is the loaded OSD font (or the built-in one), its own
   * outline baked in and the text colours tinting it; anything else is the display font, Impact with an outer stroke.
   */
  titleFont: string;
  craftFont: string;
  /**
   * A small "OSD by lovelyosd.com" at the end, so people who see the video can find the editor: under the stats screen,
   * or without one over the last few seconds before `statsAfter`.
   */
  showCredit: boolean;
  /**
   * The pilot's own Betaflight OSD, from their CLI backup: drawn on Betaflight's character grid in place of the speed,
   * battery, RSSI and LQ panels. Null (or missing) draws the panels.
   */
  bfOsd?: BfOsdLayout | null;
  /** Whether the loaded Betaflight OSD is drawn (off shows the panels again). */
  showBfOsd?: boolean;
  layout: OverlayLayout;
  /** Text size multipliers for items inside panels; missing means 100%. */
  itemScale: Partial<Record<ItemKey, number>>;
  /** Panel readings switched off (the RSSI panel's); missing means shown. */
  itemHidden?: Partial<Record<ItemKey, boolean>>;
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
const ROW1 = 60, ROW2 = 106, ONE_ROW_H = 86, TWO_ROW_H = 128;
/** The mini map is a square this size (1080p px); the RSSI panel under it matches its width. */
const MAP_SIZE = 300;

/**
 * Title and craft name: Impact with a flat fill and an outer stroke, sized (1080p px at 100%) from a real Short's
 * Premiere setup (a 1215x2160 sequence: Impact 100 at 69% x 76%, 15 px stroke) brought to a 1080-wide frame.
 */
const DISPLAY_FONT = 'Impact, Haettenschweiler, "Arial Narrow Bold", "Arial Black", sans-serif';
const TITLE_SIZE = 77, TITLE_PAD_X = 13, TITLE_H = 84, TITLE_STROKE = 8;
const CRAFT_SIZE = 47, CRAFT_H = 60, CRAFT_STROKE = 7;

/** OSD-font sizes for the title and craft name: glyph cells that fill their boxes' height, like the display font does. */
const OSD_TITLE_SIZE = 53, OSD_CRAFT_SIZE = 38;
const osdLabel = (font: string | undefined) => font === 'osd';

/** Width of OSD-font text at `size` (1080p px): the loaded font's cells, or the built-in font. */
function osdWidth(s: string, size: number) {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  return measure(measureCtx, s, size, 800);
}

/** The title's and craft name's widths in whichever font each is drawn in (1080p px at 100%, without padding). */
const titleWidth = (s: string, o: OverlayOptions) => (osdLabel(o.titleFont) ? osdWidth(s, OSD_TITLE_SIZE) : displayWidth(s, TITLE_SIZE));
const craftWidth = (s: string, o: OverlayOptions) => (osdLabel(o.craftFont) ? osdWidth(s, OSD_CRAFT_SIZE) : displayWidth(s, CRAFT_SIZE));

/** Width of display-font text at `size` (1080p px). */
function displayWidth(s: string, size: number) {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = `${size}px ${DISPLAY_FONT}`;
  return measureCtx.measureText(s).width;
}

/** Width of the drawn speed gauge (1080p px at 100%), standing in for Betaflight's speed glyph in the built-in font. */
const SPEED_ICON_W = 40;

/** The Betaflight OSD to draw: loaded and switched on. */
export const bfLayout = (o: OverlayOptions) => (o.showBfOsd !== false ? o.bfOsd ?? null : null);

/** Where the footage ends in a vertical frame (the stick cam below it), as a fraction of the height. */
const FOOTAGE_SPLIT = 0.537;

/** Characters for a Betaflight OSD line: strings as their (capital) letters, numbers as font slots. */
const bf = (...parts: (string | number)[]) =>
  parts.flatMap(p => (typeof p === 'number' ? [p] : [...p.toUpperCase()].map(c => c.charCodeAt(0))));
/** tfp_sprintf's %Nd: right-aligned in N characters. */
const pad = (n: number, width: number) => String(n).padStart(width, ' ');
const pad0 = (n: number, width: number) => String(n).padStart(width, '0');
/** osdPrintFloat without rounding: the decimals cut off, not rounded. */
const fixedTrunc = (v: number, places: number) => (Math.trunc(v * 10 ** places) / 10 ** places).toFixed(places);

/** Betaflight's stick overlay characters, drawn as pixels without an OSD font. */
const BF_STICK_CODES = new Set([0x08, 0x09, 0x0a, 0x0b, 0x16, 0x17]);
/** Betaflight symbols as short text for the built-in font (osd_symbols.h). */
const BF_FALLBACK: Record<number, string> = {
  0x01: 'RS', 0x04: 'TH', 0x05: '⌂', 0x06: 'V', 0x07: 'MAH', 0x0c: 'M', 0x0f: 'FT', 0x11: '⌂', 0x1e: 'SA', 0x1f: 'T',
  0x70: '»', 0x71: 'Σ', 0x72: '-', 0x73: '+', 0x74: '-', 0x7b: 'LQ', 0x7d: 'KM', 0x7e: 'MI', 0x7f: '▲', 0x9a: 'A',
  0x9b: 'ON', 0x9c: '⏱', 0x9d: 'MPH', 0x9e: 'KMH',
  ...Object.fromEntries(['↓', '↘', '→', '↗', '↑', '↖', '←', '↙'].flatMap((a, k) => [[0x60 + 2 * k, a], [0x61 + 2 * k, a]])),
};

/** Blank pause between the end of the log and the stats screen, in seconds. */
export const STATS_GAP_S = 0.1;

/** Satellite count: after Betaflight's satellite icon with an OSD font, or "24 SAT" in the built-in font. */
const satText = (n: number) => (glyphs ? `${SYM.sat}${n}` : `${n} SAT`);
/** RSSI: after Betaflight's antenna icon with an OSD font, or "53% RSSI" in the built-in font, like "24 SAT". */
const rssiText = (n: number) => (glyphs ? `${SYM.rssi}${n}` : `${n}% RSSI`);
/** Link quality: after Betaflight's LQ icon with an OSD font, or "100% LQ" in the built-in font. */
const lqText = (n: number) => (glyphs ? `${SYM.lq}${n}` : `${n}% LQ`);
/** Signal strength in dBm: "-72DBM" in an OSD font (it has no dBm symbol), "-72 dBm" in the built-in font. */
const dbmText = (n: number) => (glyphs ? `${n}DBM` : `${n} dBm`);
/** Betaflight's default link quality alarm (osd_link_quality_alarm), %: below it the number turns amber. */
const LQ_ALARM = 80;

/** Betaflight battery icon for a per-cell voltage (3.3 V empty .. 4.2 V full). */
const batteryIcon = (cell: number) => SYM.batt[6 - Math.max(0, Math.min(6, Math.round(((cell - 3.3) / 0.9) * 6)))];

/**
 * Draws one HUD frame for time t (seconds since log start) onto a transparent canvas.
 * Layout is designed at 1080p and scaled by the canvas's short side, so 1440p and 4K look identical, only sharper,
 * and a vertical 1080x1920 frame draws its elements at the same size as landscape 1920x1080.
 */
export class OverlayRenderer {
  private trackTimes: number[];
  private batteryTimes: number[];
  private telemetryTimes: number[];
  private hasRssi: boolean;
  /** Link quality arrives with the CRSF link stats debug mode. */
  private hasLq: boolean;
  private hasDbm: boolean;
  private hasBaro: boolean;
  /** The battery panel is shorter without a current sensor; fixed per flight so the box doesn't jump. */
  private hasCurrent: boolean;
  /** Top ground speed (m/s), for the speed gauge's needle. */
  private maxSpeed: number;
  /** Satellite counts arrive with track data version 4. */
  private hasSats: boolean;
  /** mAh used up to each battery sample. */
  private mahAt: number[];
  /** Metres from home at each track point. */
  private homeDist: number[];
  private mapBounds?: { minX: number; maxX: number; minY: number; maxY: number };
  private mapXY: [number, number][] = [];
  private homeXY: [number, number] | null = null;
  /** Metres flown up to each track point, for the OSD's flight distance. */
  private flown: number[] = [];
  /**
   * Direction of travel at each track point (degrees from north), standing in for the craft's yaw in the home arrow:
   * without a compass Betaflight's own heading comes from the GPS course too.
   */
  private course: (number | null)[] = [];

  constructor(private data: OverlayData) {
    this.trackTimes = data.track?.points.map(p => p[0]) ?? [];
    this.batteryTimes = data.battery?.points.map(p => p[0]) ?? [];
    this.telemetryTimes = data.telemetry?.map(p => p[0]) ?? [];
    this.hasRssi = data.telemetry?.some(p => p[1] !== null) ?? false;
    this.hasLq = data.telemetry?.some(p => p[3] != null) ?? false;
    this.hasDbm = data.telemetry?.some(p => p[4] != null) ?? false;
    this.hasBaro = data.telemetry?.some(p => p[2] !== null) ?? false;
    this.hasCurrent = data.battery?.points[0]?.[2] != null;
    this.hasSats = data.track?.points[0]?.[5] !== undefined;
    this.maxSpeed = Math.max(0, ...(data.track?.points.map(p => p[4]) ?? []));

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
      let flown = 0, heading: number | null = null;
      this.mapXY.forEach((p, k) => {
        if (k > 0) {
          const dx = p[0] - this.mapXY[k - 1][0], dy = p[1] - this.mapXY[k - 1][1];
          flown += Math.hypot(dx, dy);
          // Only while actually moving, so GPS wander on a hover doesn't spin the arrow.
          if (tp[k][4] > 1.5 && Math.hypot(dx, dy) > 0.3) heading = (Math.atan2(dx, dy) * 180) / Math.PI;
        }
        this.flown.push(flown);
        this.course.push(heading);
      });
    }
  }

  draw(ctx: CanvasRenderingContext2D, t: number, o: OverlayOptions) {
    const { width: W, height: H } = ctx.canvas;
    const u = Math.min(W, H) / 1080;
    ctx.clearRect(0, 0, W, H);
    glyphs = o.font;
    speedUnit = o.speedUnit;

    // Like Betaflight after disarm: the HUD clears, a short blank beat, then the stats take the whole screen.
    if (o.showStats && t > o.statsAfter) {
      if (t >= o.statsAfter + STATS_GAP_S) this.drawStats(ctx, W, H, u, o);
      return;
    }

    for (const p of this.placements(W, H, o)) {
      const s = u * p.scale; // each element draws in its own scaled units, so text, icons and panels grow together
      switch (p.key) {
        case 'rssi': this.drawRssi(ctx, t, p.x, p.y, s, o); break;
        case 'map': this.drawMap(ctx, t, p.x, p.y, s, o); break;
        case 'speed': this.drawSpeed(ctx, t, p.x, p.y, s, o); break;
        case 'battery': this.drawBattery(ctx, t, p.x, p.y, s, o); break;
        case 'link': this.drawLink(ctx, t, p.x, p.y, s, o); break;
        case 'sticks': this.drawSticks(ctx, t, p.x, p.y, s, o); break;
        case 'title': drawTitle(ctx, p.x, p.y, s, o); break;
        case 'craft': drawCraft(ctx, p.x, p.y, s, o); break;
      }
    }
    // The pilot's own OSD over everything else, as in the goggles.
    const osd = bfLayout(o);
    if (osd) this.drawBfOsd(ctx, t, W, H, osd);
    // Without a stats screen, the credit comes up over the last few seconds instead: top centre in 16:9, between the
    // title and the mini map, and just above the split in vertical (clear of the Shorts buttons and caption).
    if (o.showCredit && !o.showStats && t >= o.statsAfter - CREDIT_SECONDS && t <= o.statsAfter)
      drawCredit(ctx, W / 2, H > W ? 0.537 * H - (CREDIT_H / 2 + 12) * u : (48 + CREDIT_H / 2) * u, u);
  }

  /**
   * Every element that will be drawn, with its box on a W x H canvas, in drawing order (later ones on top).
   * Moved elements sit centred on their placement; the rest use the default HUD layout.
   */
  placements(W: number, H: number, o: OverlayOptions): PlacedElement[] {
    glyphs = o.font; // panel widths depend on the font being measured
    speedUnit = o.speedUnit;
    const u = Math.min(W, H) / 1080;
    const m = 48 * u;
    const out: PlacedElement[] = [];
    // Vertical (Shorts, Reels) is a split screen: footage on top, stick cam below, with the HUD over the stick cam.
    // The app's header covers the top strip, so anything at the top starts below it.
    const vertical = H > W;
    const top = vertical ? 200 * u : m;
    // w and h are 1080p sizes at scale 1; (dx, dy) is the default top-left at the default scale.
    const add = (key: ElementKey, show: boolean, w: number, h: number, dx: number, dy: number, defaultScale = 1) => {
      if (!show) return;
      const pl = o.layout?.[key];
      const scale = pl?.scale ?? defaultScale;
      const pw = w * u * scale, ph = h * u * scale;
      // Kept fully inside the frame, so growing a corner element pushes it inward instead of cutting it off.
      const inside = (v: number, size: number, max: number) => Math.min(Math.max(0, v), Math.max(0, max - size));
      out.push(pl
        ? { key, x: inside(pl.x * W - pw / 2, pw, W), y: inside(pl.y * H - ph / 2, ph, H), w: pw, h: ph, scale }
        : { key, x: dx, y: dy, w: pw, h: ph, scale });
    };
    const speed = this.geometry('speed', o), battery = this.geometry('battery', o);
    add('map', o.showMap && this.mapXY.length > 1, MAP_SIZE, MAP_SIZE, W - m - MAP_SIZE * u, top);
    // Breakout under the map: right-aligned with wherever the map is, or in the corner when the map is hidden.
    const rssi = this.geometry('rssi', o);
    const mapBox = out.find(e => e.key === 'map');
    const rssiEmpty = rssi.baselines.length === 0; // every reading switched off
    const rw = rssi.w * u;
    const bfOn = !!bfLayout(o);
    add('rssi', o.showRssi && !bfOn && !rssiEmpty && (this.hasRssi || this.hasLq || this.trackTimes.length > 0), rssi.w, rssi.h,
        mapBox ? Math.max(0, mapBox.x + mapBox.w - rw) : W - m - rw,
        mapBox ? Math.min(H - rssi.h * u, mapBox.y + mapBox.h + 12 * u) : top);

    // Title and craft name. Landscape: stacked in the top-left corner. Vertical, as on a real Short: the title boxed in
    // the top-right corner, and the craft name at the top-left of the stick cam half, just under the split.
    const title = (o.titleText ?? '') + (o.titleAccentText ?? '');
    const titleW = o.showTitle && title.trim() ? titleWidth(title, o) + 2 * TITLE_PAD_X : 0;
    const craftW = o.showCraft && o.craftText?.trim() ? craftWidth(o.craftText, o) + 2 * CRAFT_STROKE : 0;
    if (vertical) {
      const ts = 1.15; // a touch bigger than the measured Short, set by eye
      add('title', titleW > 0, titleW, TITLE_H, Math.min(W - titleW * u * ts, 0.8 * W - (titleW * u * ts) / 2), 0.039 * H - (TITLE_H * u * ts) / 2, ts);
      add('craft', craftW > 0, craftW, CRAFT_H, 0.031 * W, 0.556 * H - (CRAFT_H * u) / 2);
    } else {
      add('title', titleW > 0, titleW, TITLE_H, m, m);
      add('craft', craftW > 0, craftW, CRAFT_H, m, m + (titleW > 0 ? (TITLE_H + 8) * u : 0));
    }

    const showSpeed = o.showSpeed && !bfOn && this.trackTimes.length > 0;
    const showBattery = o.showBattery && !bfOn && this.batteryTimes.length > 0;
    const showSticks = o.showSticks && !!this.data.sticks?.length;
    // The link panel: centred just above where the sticks sit by default.
    const showLink = o.showLink && !bfOn && this.hasLq;
    const link = this.geometry('link', o);

    if (!vertical) {
      const bottom = H - m;
      add('speed', showSpeed, speed.w, speed.h, m, bottom - speed.h * u);
      add('battery', showBattery, battery.w, battery.h, W - m - battery.w * u, bottom - battery.h * u);
      add('sticks', showSticks, 330, 150, W / 2 - 165 * u, bottom - 150 * u);
      add('link', showLink, link.w, link.h, W / 2 - (link.w * u) / 2, bottom - (150 + 12 + link.h) * u);
      return out;
    }

    // Vertical, measured off a real Short: big sticks centred in the stick cam half, and the panels in a centred row
    // under them at 200%. With speed and battery both on, the row shrinks to fit the width.
    const sticksScale = 2.1, sticksCy = 0.655 * H;
    add('sticks', showSticks, 330, 150, W / 2 - 165 * u * sticksScale, sticksCy - 75 * u * sticksScale, sticksScale);
    const gap = 16 * u, rowCy = 0.79 * H;
    const row = [showSpeed && speed, showBattery && battery].filter((g): g is Geometry => !!g);
    const rowScale = Math.min(2, (W * 0.94 - gap * Math.max(0, row.length - 1)) / (row.reduce((sum, g) => sum + g.w, 0) * u || 1));
    // The link panel at the row's scale, so its cell voltage matches the battery panel's.
    add('link', showLink, link.w, link.h, W / 2 - (link.w * u * rowScale) / 2,
        sticksCy - 75 * u * sticksScale - 12 * u - link.h * u * rowScale, rowScale);
    let x = (W - (row.reduce((sum, g) => sum + g.w * u * rowScale, 0) + gap * Math.max(0, row.length - 1))) / 2;
    for (const [key, g] of [['speed', showSpeed && speed], ['battery', showBattery && battery]] as const) {
      if (!g) continue;
      add(key, true, g.w, g.h, x, rowCy - (g.h * u * rowScale) / 2, rowScale);
      x += g.w * u * rowScale + gap;
    }
    return out;
  }

  // ---------- elements ----------

  /**
   * The pilot's Betaflight OSD: every element from their backup at its own character cell, in Betaflight's text and
   * symbols, from the OSD font (or the built-in one). The grid fills the footage, fitted whole: the 16:9 frame, or
   * the top part of a vertical one.
   */
  private drawBfOsd(ctx: CanvasRenderingContext2D, t: number, W: number, H: number, osd: BfOsdLayout) {
    const boxW = W, boxH = H > W ? FOOTAGE_SPLIT * H : H;
    const aspect = glyphs ? glyphs.glyphW / glyphs.glyphH : 2 / 3;
    const ch = Math.min(boxH / osd.rows, boxW / (osd.cols * aspect)), cw = ch * aspect;
    const ox = (boxW - osd.cols * cw) / 2, oy = (boxH - osd.rows * ch) / 2;
    // Characters by cell, so later elements write over earlier ones like on the real OSD.
    const grid = new Map<number, number>();
    const put = (x: number, y: number, codes: number[]) => codes.forEach((c, k) => {
      if (c !== 32 && x + k < osd.cols && y < osd.rows) grid.set(y * 64 + x + k, c);
    });
    for (const e of osd.elements) {
      if (e.id === 'stick_overlay_left' || e.id === 'stick_overlay_right') this.bfSticks(e, t, osd, put);
      else { const codes = this.bfElement(e, t, osd); if (codes) put(e.x, e.y, codes); }
    }

    const cells: [number, number, number][] = [...grid].map(([key, code]) => [code, ox + (key % 64) * cw, oy + Math.floor(key / 64) * ch]);
    if (glyphs) {
      const f = glyphs;
      ctx.save();
      ctx.imageSmoothingQuality = 'high';
      for (const [code, x, y] of cells) ctx.drawImage(f.atlas, (code % 16) * f.glyphW, Math.floor(code / 16) * f.glyphH, f.glyphW, f.glyphH, x, y, cw, ch);
      ctx.restore();
      return;
    }
    // The built-in font: letters and numbers as text, the stick overlay in pixels, battery bars as the drawn icon, and
    // other symbols as short words squeezed into their cell.
    retroPixels(ctx, cells.filter(([c]) => BF_STICK_CODES.has(c)), cw, ch);
    for (const [code, x, y] of cells) {
      if (BF_STICK_CODES.has(code)) continue;
      if (code >= 0x90 && code <= 0x97) {
        const cell = code === 0x97 ? 3.3 : 3.3 + ((0x96 - code) / 6) * 0.9;
        drawBatteryIcon(ctx, x + cw * 0.25, y + ch * 0.18, cw * 0.5, ch * 0.66, cell, code === 0x97 ? '#ffb340' : undefined);
        continue;
      }
      const s = BF_FALLBACK[code] ?? (code >= 0x20 && code < 0x60 ? String.fromCharCode(code) : '');
      if (!s) continue;
      let size = ch * 0.72;
      const w = measure(ctx, s, size, 700);
      if (w > cw * 1.05) size *= (cw * 1.05) / w;
      text(ctx, s, x + cw / 2, y + ch * 0.5 + size * 0.36, size, 'center', 700);
    }
  }

  /**
   * Elements of a Betaflight OSD this log has nothing for (no GPS logged, no current sensor...), checked across the
   * flight. Warnings only show now and then, so they never count as missing.
   */
  bfMissing(osd: BfOsdLayout, seconds: number): BfOsdId[] {
    const times = Array.from({ length: 12 }, (_, k) => (seconds * (k + 0.5)) / 12);
    return osd.elements.filter(e => {
      if (e.id === 'warnings') return false;
      if (e.id === 'stick_overlay_left' || e.id === 'stick_overlay_right') return !this.data.sticks?.length;
      return times.every(t => this.bfElement(e, t, osd) === null);
    }).map(e => e.id);
  }

  /** One element's characters at time t, as Betaflight's osd_elements.c prints them; null when the log can't say. */
  private bfElement(e: BfOsdElement, t: number, osd: BfOsdLayout): number[] | null {
    const imperial = osd.units === 'IMPERIAL';
    const bat = this.data.battery;
    const b = bat?.points.length ? bat.points[nearest(this.batteryTimes, t)] : null;
    const cell = b ? b[1] / bat!.cells : null;
    const tl = this.data.telemetry?.length ? this.data.telemetry[nearest(this.telemetryTimes, t)] : null;
    const tp = this.data.track?.points;
    const ti = tp?.length ? nearest(this.trackTimes, t) : -1;
    const p = ti >= 0 && t >= this.trackTimes[0] - 1 ? tp![ti] : null;
    const battSym = (c: number) => (c < osd.cellMin ? 0x97 : 0x96 - Math.max(0, Math.min(6, Math.trunc(((c - osd.cellMin) * 8) / (osd.cellMax - osd.cellMin)))));
    const metres = (m: number) => (imperial ? m * 3.28084 : m);
    // osdFormatDistanceString: whole metres (feet), then km (miles) with 2 decimals, 1 from 10 up.
    const distance = (lead: number, m: number) => {
      const v = metres(m), step = imperial ? 5280 : 1000;
      if (v < step) return bf(lead, String(Math.trunc(v)), imperial ? 0x0f : 0x0c);
      const big = v / step;
      return bf(lead, fixedTrunc(big, big >= 10 ? 1 : 2), imperial ? 0x7e : 0x7d);
    };
    switch (e.id) {
      case 'vbat':
        if (!b) return null;
        return bf(battSym(cell!), b[1].toFixed(b[1] >= 10 ? 1 : 2), 0x06);
      case 'avg_cell_voltage':
        return cell === null ? null : bf(battSym(cell), fixedTrunc(cell, 2), 0x06);
      case 'rssi':
        return tl?.[1] == null ? null : bf(0x01, pad(Math.min(99, Math.floor(tl[1])), 2));
      case 'link_quality':
        // Logs without LQ (no link stats debug mode) show RSSI in its place, unless the layout has RSSI already. It's
        // labelled, so it isn't mistaken for LQ and runs about as wide as the cell voltage usually under it.
        if (tl?.[3] == null) return this.bfRssiForLq(osd) && tl?.[1] != null ? bf('RSSI ' + Math.min(99, Math.floor(tl[1]))) : null;
        return tl[5] != null ? bf(0x7b, (Math.round(tl[5]) % 10) + ':' + pad(Math.round(tl[3]), 2)) : bf(0x7b, pad(Math.round(tl[3]), 2));
      case 'rssi_dbm':
        return tl?.[4] == null ? null : bf(0x01, pad(Math.round(tl[4]), 3));
      case 'tim_1': case 'tim_2': {
        const timer = osd.timers[e.id === 'tim_1' ? 0 : 1];
        const src = timer & 0x0f, prec = (timer >> 4) & 0x0f;
        const sec = Math.max(0, t), mm = pad0(Math.floor(sec / 60), 2), ss = pad0(Math.floor(sec % 60), 2);
        const frac = prec === 1 ? '.' + pad0(Math.floor((sec * 100) % 100), 2) : prec === 2 ? '.' + Math.floor((sec * 10) % 10) : '';
        return bf(src === 0 ? 0x9b : 0x9c, mm + ':' + ss + frac);
      }
      case 'current':
        if (b?.[2] == null) return null;
        return bf(pad(Math.trunc(Math.abs(b[2])), 3) + '.' + pad0(Math.trunc((Math.abs(b[2]) * 100) % 100), 2), 0x9a);
      case 'mah_drawn':
        return b?.[2] == null ? null : bf(pad(Math.round(this.mahAt[nearest(this.batteryTimes, t)]), 4), 0x07);
      case 'power':
        return b?.[2] == null ? null : bf(pad(Math.trunc(Math.abs(b[2]) * b[1]), 4) + 'W');
      case 'gps_speed': {
        const unit = osd.units === 'METRIC' ? 0x9e : 0x9d;
        if (!p) return this.trackTimes.length ? bf(0x70, '-', unit) : null;
        const cms = Math.trunc(p[4] * 100);
        return bf(0x70, pad(osd.units === 'METRIC' ? Math.trunc((cms * 36) / 1000) : Math.trunc((cms * 10000) / 5080 / 88), 3), unit);
      }
      case 'gps_sats':
        if (!this.hasSats) return null;
        return p?.[5] != null ? bf(0x1e, 0x1f, pad(p[5], 2)) : bf(0x1e, 0x1f, 'NC');
      case 'altitude': {
        const baro = this.hasBaro && tl?.[2] != null ? tl[2] : null;
        const m = baro ?? p?.[3] ?? null;
        if (m === null) return bf(0x7f, '-');
        return bf(0x7f, metres(m).toFixed(e.type === 1 ? 0 : 1), imperial ? 0x0f : 0x0c);
      }
      case 'home_dist':
        return p ? distance(0x11, this.homeDist[ti]) : this.trackTimes.length ? bf(0x11, '-') : null;
      case 'flight_dist':
        return p ? distance(0x71, this.flown[ti] ?? 0) : null;
      case 'home_dir': {
        if (!p || !this.homeXY) return this.trackTimes.length ? bf('-') : null;
        if (Math.trunc(this.homeDist[ti]) <= 0) return [0x05];
        const [x, y] = this.mapXY[ti];
        const toHome = (Math.atan2(this.homeXY[0] - x, this.homeXY[1] - y) * 180) / Math.PI;
        const rel = (((toHome - (this.course[ti] ?? toHome)) % 360) + 360) % 360;
        const dir = Math.floor((rel * 16 + 180) / 360) % 16; // up 0, right 4, down 8, left 12
        return [0x60 + ((16 - dir + 8) % 16)]; // the arrow glyphs start at south and turn anticlockwise
      }
      case 'throttle': {
        const sticks = this.data.sticks;
        if (!sticks?.length) return null;
        const thr = Math.min(2000, Math.max(1000, sampleSticks(sticks, t)[4]));
        return bf(0x04, pad(Math.trunc((thr - 1000) / 10), 3));
      }
      case 'crosshairs':
        return [0x72, 0x73, 0x74];
      case 'g_force': {
        const g = p?.[6];
        return g == null ? null : bf((g / 9.81).toFixed(1) + 'G');
      }
      case 'craft_name':
        return bf((osd.craftName || 'CRAFT_NAME').toUpperCase().slice(0, 16));
      case 'pilot_name':
        return bf((osd.pilotName || 'PILOT_NAME').toUpperCase().slice(0, 16));
      case 'warnings': {
        // The ones a log can tell, in Betaflight's order; warnings blink at 2 Hz.
        const mah = b?.[2] != null ? this.mahAt[nearest(this.batteryTimes, t)] : null;
        const w = tl?.[1] != null && tl[1] < osd.rssiAlarm ? 'RSSI LOW'
          : tl?.[3] != null && tl[3] < osd.lqAlarm ? 'LINK QUALITY'
          : cell !== null && cell < osd.cellMin ? ' LAND NOW'
          : cell !== null && cell < osd.cellWarn ? 'LOW BATTERY'
          : mah !== null && osd.capAlarm > 0 && mah >= osd.capAlarm ? 'OVER CAP' : '';
        return w && Math.floor(t * 4) % 2 === 0 ? bf(w) : null;
      }
      default:
        return null;
    }
  }

  /** Whether the LQ element shows RSSI instead: the log has RSSI but no LQ, and the layout has no RSSI element of its own. */
  bfRssiForLq(osd: BfOsdLayout) {
    return !this.hasLq && this.hasRssi && osd.elements.some(e => e.id === 'link_quality') && !osd.elements.some(e => e.id === 'rssi');
  }

  /** Betaflight's stick overlay: a 7 x 5 cross of line characters and a cursor at a third of a character up and down. */
  private bfSticks(e: BfOsdElement, t: number, osd: BfOsdLayout, put: (x: number, y: number, codes: number[]) => void) {
    const sticks = this.data.sticks;
    if (!sticks?.length) return;
    for (let r = 0; r < 5; r++) put(e.x + 3, e.y + r, [0x16]);
    put(e.x, e.y + 2, [0x17, 0x17, 0x17, 0x0b, 0x17, 0x17, 0x17]);
    const a = stickAxes(sampleSticks(sticks, t));
    const [lx, ly, rx, ry] = MODES[osd.stickMode];
    const [h, v] = e.id === 'stick_overlay_left' ? [lx, ly] : [rx, ry];
    const rc = (axis: number) => Math.min(1999, Math.max(1000, 1500 + 500 * axis));
    const cx = Math.trunc(((rc(a[h]) - 1000) * 7) / 1000), cy = 14 - Math.trunc(((rc(a[v]) - 1000) * 15) / 1000);
    put(e.x + cx, e.y + Math.floor(cy / 3), [0x08 + (cy % 3)]);
  }

  /** Whole-flight figures for the stats screen; each is null when the log doesn't have it. */
  private stats(o: OverlayOptions) {
    const tp = this.data.track?.points ?? [];
    const bp = this.data.battery?.points ?? [];
    const tl = this.data.telemetry ?? [];
    const max = (v: number[]) => (v.length ? Math.max(...v) : null);
    // Pack voltage low point from a 0.5 s average, so one noisy sample isn't the minimum (same as the flight stats).
    let minV: number | null = null;
    for (let k = 4; k < bp.length; k++) {
      const avg = (bp[k][1] + bp[k - 1][1] + bp[k - 2][1] + bp[k - 3][1] + bp[k - 4][1]) / 5;
      minV = minV === null ? avg : Math.min(minV, avg);
    }
    let dist = 0;
    for (let k = 1; k < tp.length; k++) dist += haversine(tp[k - 1][1], tp[k - 1][2], tp[k][1], tp[k][2]);
    const baro = o.altSource === 'baro' && this.hasBaro;
    const rssi = tl.map(p => p[1]).filter((v): v is number => v !== null);
    const lq = tl.map(p => p[3]).filter((v): v is number => v != null);
    const dbm = tl.map(p => p[4]).filter((v): v is number => v != null);
    const amps = bp.map(p => p[2]).filter((v): v is number => v !== null);
    const accel = tp.map(p => p[6]).filter((v): v is number => v !== undefined);
    return {
      arm: o.flightSeconds,
      alt: baro ? max(tl.map(p => p[2]).filter((v): v is number => v !== null)) : max(tp.map(p => p[3])),
      speed: max(tp.map(p => p[4])),
      maxDist: max(this.homeDist),
      dist: tp.length > 1 ? dist : null,
      g: accel.length ? Math.max(...accel) / 9.81 : null,
      minV,
      endV: bp.length ? bp[bp.length - 1][1] : null,
      minRssi: rssi.length ? Math.min(...rssi) : null,
      minLq: lq.length ? Math.min(...lq) : null,
      minDbm: dbm.length ? Math.min(...dbm) : null,
      maxA: amps.length ? Math.max(...amps) : null,
      mah: amps.length ? this.mahAt[this.mahAt.length - 1] : null,
    };
  }

  /** Betaflight's post-flight stats screen: centred title, then LABEL : VALUE rows, in the OSD font when loaded. */
  private drawStats(ctx: CanvasRenderingContext2D, W: number, H: number, u: number, o: OverlayOptions) {
    const s = this.stats(o);
    const G = !!glyphs;
    const U = units();
    const mi = o.speedUnit === 'mph';
    const m = G ? SYM.m : ' m';
    const rows: [string, string][] = [];
    const add = (label: string, v: number | null, fmt: (v: number) => string) => { if (v !== null) rows.push([label, fmt(v)]); };
    add('TOTAL ARM', s.arm, v => clock(v));
    add('MAX ALTITUDE', s.alt, v => `${v.toFixed(1)}${m}`);
    add('MAX SPEED', s.speed, v => `${speedFromMs(v, o.speedUnit).toFixed(0)}${G ? U.kph : ' ' + (mi ? 'mph' : 'km/h')}`);
    add('MAX DISTANCE', s.maxDist, v => `${v.toFixed(0)}${m}`);
    add('FLIGHT DISTANCE', s.dist, v => mi ? `${(v / 1609.344).toFixed(2)}${G ? SYM.mi : ' mi'}` : `${(v / 1000).toFixed(2)}${G ? SYM.km : ' km'}`);
    add('MAX G-FORCE', s.g, v => `${v.toFixed(1)}G`);
    add('MIN BATTERY', s.minV, v => `${v.toFixed(2)}${G ? SYM.volt : ' V'}`);
    add('END BATTERY', s.endV, v => `${v.toFixed(2)}${G ? SYM.volt : ' V'}`);
    add('MIN RSSI', s.minRssi, v => `${Math.round(v)}%`);
    add('MIN LINK', s.minLq, v => `${Math.round(v)}%`); // Betaflight's own labels for the lowest LQ and dBm
    add('MIN RSSI DBM', s.minDbm, v => dbmText(Math.round(v)));
    add('MAX CURRENT', s.maxA, v => `${v.toFixed(0)}${G ? SYM.amp : ' A'}`);
    add('USED MAH', s.mah, v => `${Math.round(v)}${G ? SYM.mah : ' mAh'}`);

    const size = 34 * u, lh = 52 * u, gap = 22 * u;
    const labelW = Math.max(...rows.map(r => measure(ctx, r[0], size, 700)));
    const colonW = measure(ctx, ':', size, 700);
    const valueW = Math.max(...rows.map(r => measure(ctx, r[1], size, 700)));
    const title = '--- STATS ---';
    const blockW = Math.max(labelW + gap + colonW + gap + valueW, measure(ctx, title, size, 700));
    const blockH = (rows.length + 1) * lh + lh * 0.4;
    const x0 = (W - blockW) / 2, y0 = (H - blockH) / 2;
    panel(ctx, x0 - 48 * u, y0 - 30 * u, blockW + 96 * u, blockH + 52 * u, 26 * u, o.panelOpacity);
    text(ctx, title, W / 2, y0 + lh * 0.8, size, 'center', 700);
    rows.forEach(([label, value], n) => {
      const y = y0 + lh * (n + 1.4) + lh * 0.8;
      text(ctx, label, x0, y, size, 'left', 700);
      text(ctx, ':', x0 + labelW + gap, y, size, 'left', 700);
      text(ctx, value, x0 + labelW + gap + colonW + gap, y, size, 'left', 700);
    });
    if (o.showCredit) drawCredit(ctx, W / 2, y0 + blockH + (40 + CREDIT_H / 2) * u, u);
  }

  /**
   * Panel layout from the default design plus whatever the user resized. Each row's baseline moves down by the extra
   * height of the rows above it (and most of its own), and the panel widens when a row's widest-case text no longer
   * fits, so nothing overlaps. With every item at 100% this is exactly the original layout.
   */
  private geometry(key: 'rssi' | 'speed' | 'battery' | 'link', o: OverlayOptions): Geometry {
    const k = (item: ItemKey) => Math.min(ITEM_SCALE_MAX, Math.max(ITEM_SCALE_MIN, o.itemScale?.[item] ?? 1));
    const U = units();
    switch (key) {
      case 'rssi': {
        // Satellites, RSSI (% and dBm) and link quality on top, distance from home and height below; each only when the
        // log has it and it isn't switched off.
        const gps = this.trackTimes.length > 0;
        const top: Row['items'] = [], bottom: Row['items'] = [];
        const shown = (i: Row['items'][number]) => !o.itemHidden?.[i.key!];
        if (gps && this.hasSats) top.push({ key: 'rssi.sats', parts: [{ s: satText(88), size: SMALL, weight: 700 }] });
        if (this.hasRssi) top.push({ key: 'rssi.value', parts: [{ s: rssiText(99), size: SMALL, weight: 700 }] });
        if (this.hasDbm) top.push({ key: 'rssi.dbm', parts: [{ s: dbmText(-100), size: SMALL, weight: 700 }] });
        if (this.hasLq) top.push({ key: 'rssi.lq', parts: [{ s: lqText(100), size: SMALL, weight: 700 }] });
        if (gps) bottom.push({ key: 'rssi.home', parts: [{ s: `${U.home}888${U.m}`, size: SMALL, weight: 700 }] },
                             { key: 'rssi.alt', parts: [{ s: `${U.alt}88${U.m}`, size: SMALL, weight: 700 }] });
        const rows = [top.filter(shown), bottom.filter(shown)].filter(r => r.length);
        // As wide as the map above it, or wider if the font needs it.
        return fit(MAP_SIZE, rows.length > 1 ? 94 : 58, 22, k,
                   rows.map((items, n) => ({ baseline: n ? 76 : 40, items })), true);
      }
      case 'speed': {
        // Speed and current on top, G-force and power below. Without a current sensor it's one row: speed and G-force.
        // Same rows and text sizes as the battery panel, so the two line up.
        // Speed gets an icon in front, like the battery icon before the per-cell voltage.
        const speedIcon: Part = glyphs ? { s: SYM.speed, size: BIG, weight: 700 } : { s: '', size: BIG, weight: 700, w: SPEED_ICON_W };
        const speed = { key: 'speed.value' as const,
                        parts: [speedIcon, { s: '188', size: BIG, weight: 800 }, { s: U.kph, size: unitSize(), weight: 600 }] };
        const accel = { key: 'speed.accel' as const, parts: [{ s: '9.9G', size: SMALL, weight: 700 }] };
        const rows: Row[] = this.hasCurrent
          ? [
            { baseline: ROW1, items: [speed, { key: 'speed.amps', parts: [{ s: `188.8${U.amp}`, size: SMALL, weight: 700 }] }] },
            { baseline: ROW2, items: [accel, { key: 'speed.watts', parts: [{ s: `8888${U.watt}`, size: SMALL, weight: 700 }] }] },
          ]
          : [{ baseline: ROW1, items: [speed, accel] }];
        return fit(400, this.hasCurrent ? TWO_ROW_H : ONE_ROW_H, 26, k, rows);
      }
      case 'link': {
        // One row, both at the battery panel's headline size: the battery icon and per-cell voltage on the left, link
        // quality on the right.
        const items: Row['items'] = [];
        if (this.batteryTimes.length) {
          const icon: Part = glyphs ? { s: SYM.batt[0], size: BIG, weight: 700 } : { s: '', size: BIG, weight: 700, w: 26 };
          items.push({ key: 'link.cell', parts: [icon, { s: '4.20', size: BIG, weight: 800 }, { s: glyphs ? U.volt : 'V', size: unitSize(), weight: 600 }] });
        }
        if (this.hasLq) items.push({ key: 'link.lq', parts: [{ s: lqText(100), size: BIG, weight: 700 }] });
        return fit(280, 82, 26, k, [{ baseline: 58, items }], true);
      }
      case 'battery': {
        const icon: Part = glyphs ? { s: SYM.batt[0], size: BIG, weight: 700 } : { s: '', size: BIG, weight: 700, w: 26 };
        // Per-cell average and flight time on top; pack voltage and mAh used below.
        const top: Row['items'] = [
          { key: 'battery.cell', parts: [icon, { s: '4.20', size: BIG, weight: 800 }, { s: glyphs ? U.volt : 'V/cell', size: unitSize(), weight: 600 }] },
        ];
        top.push({ key: 'battery.time', parts: [{ s: U.fly + '88:88', size: SMALL, weight: 700 }] });
        const bottom: Row['items'] = [{ key: 'battery.volts', parts: [{ s: `88.8${glyphs ? U.volt : ' V'}`, size: SMALL, weight: 600 }] }];
        if (this.hasCurrent) bottom.push({ key: 'battery.mah', parts: [{ s: `8888${U.mah}`, size: SMALL, weight: 700 }] });
        return fit(400, TWO_ROW_H, 26, k, [{ baseline: ROW1, items: top }, { baseline: ROW2, items: bottom }]);
      }
    }
  }

  /**
   * The breakout under the map. RSSI is 0..99 like Betaflight's element, amber below its default 20% alarm; link quality
   * 0..100, amber below its default 80% alarm. Each row's readings (those not switched off) spread across the panel:
   * first at the left edge, last at the right, the ones between evenly spaced.
   */
  private drawRssi(ctx: CanvasRenderingContext2D, t: number, x: number, y: number, u: number, o: OverlayOptions) {
    const g = this.geometry('rssi', o);
    const w = g.w * u;
    panel(ctx, x, y, w, g.h * u, 18 * u, o.panelOpacity);
    const left = x + 22 * u, right = x + w - 22 * u;
    const U = units();
    let row = 0;
    const tp = this.data.track?.points;
    const i = tp?.length ? nearest(this.trackTimes, t) : -1;
    const tl = this.data.telemetry?.length ? this.data.telemetry[nearest(this.telemetryTimes, t)] : null;

    const sats = i >= 0 && this.hasSats ? tp![i][5] : undefined;
    type Reading = { key: ItemKey; s: string | null; warn?: boolean };
    const top: Reading[] = [], bottom: Reading[] = [];
    if (sats !== undefined) top.push({ key: 'rssi.sats', s: satText(sats) });
    if (this.hasRssi) {
      const value = tl?.[1] == null ? null : Math.min(99, Math.round(tl[1]));
      top.push({ key: 'rssi.value', s: value === null ? null : rssiText(value), warn: value !== null && value < 20 });
    }
    if (this.hasDbm) top.push({ key: 'rssi.dbm', s: tl?.[4] == null ? null : dbmText(Math.round(tl[4])) });
    if (this.hasLq) {
      const value = tl?.[3] == null ? null : Math.round(tl[3]);
      top.push({ key: 'rssi.lq', s: value === null ? null : lqText(value), warn: value !== null && value < LQ_ALARM });
    }
    if (i >= 0) {
      const alt = (o.altSource === 'baro' && this.hasBaro ? tl?.[2] : null) ?? tp![i][3];
      bottom.push({ key: 'rssi.home', s: `${U.home}${this.homeDist[i].toFixed(0)}${U.m}` },
                  { key: 'rssi.alt', s: `${U.alt}${alt.toFixed(0)}${U.m}` });
    }
    for (const readings of [top, bottom]) {
      const shown = readings.filter(r => !o.itemHidden?.[r.key]);
      if (!shown.length) continue;
      const line = y + g.baselines[row++] * u;
      shown.forEach((item, n) => {
        if (item.s === null) return;
        const last = n === shown.length - 1;
        const [tx, align]: [number, CanvasTextAlign] = n === 0 ? [left, 'left'] : last ? [right, 'right']
          : [left + ((right - left) * n) / (shown.length - 1), 'center'];
        text(ctx, item.s, tx, line, SMALL * g.k(item.key) * u, align, 700, 1, item.warn ? '#ffb340' : undefined);
      });
    }
  }

  private drawSpeed(ctx: CanvasRenderingContext2D, t: number, x: number, y: number, u: number, o: OverlayOptions) {
    const i = nearest(this.trackTimes, t);
    const p = this.data.track!.points[i];
    // Same width as the battery panel by default: speed and current, then G-force and power (see geometry).
    const g = this.geometry('speed', o);
    const w = g.w * u, b1 = y + g.baselines[0] * u;
    panel(ctx, x, y, w, g.h * u, 22 * u, o.panelOpacity);
    const U = units();
    const sv = g.k('speed.value');
    const speed = speedFromMs(p[4], o.speedUnit).toFixed(0);
    // Speed icon: Betaflight's own glyph with an OSD font, a drawn gauge otherwise (its needle shows speed vs the flight's top speed).
    let sx = x + 26 * u;
    if (glyphs) {
      text(ctx, SYM.speed, sx, b1, BIG * sv * u, 'left', 700);
      sx += measure(ctx, SYM.speed, BIG * sv * u, 700) + 6 * sv * u;
    } else {
      drawSpeedIcon(ctx, sx, b1, sv * u, this.maxSpeed > 0 ? p[4] / this.maxSpeed : 0);
      sx += (SPEED_ICON_W + 10) * sv * u;
    }
    text(ctx, speed, sx, b1, BIG * sv * u, 'left', 800);
    text(ctx, U.kph, sx + measure(ctx, speed, BIG * sv * u, 800) + 8 * sv * u, b1, unitSize() * sv * u, 'left', 600, 0.85);
    const gforce = p[6] !== undefined ? `${(p[6] / 9.81).toFixed(1)}G` : null;
    const accelSize = SMALL * g.k('speed.accel') * u;
    if (g.baselines.length > 1) {
      const b2 = y + g.baselines[1] * u;
      const [, v, a] = this.data.battery!.points[nearest(this.batteryTimes, t)];
      if (a !== null) {
        text(ctx, `${a.toFixed(1)}${U.amp}`, x + w - 26 * u, b1, SMALL * g.k('speed.amps') * u, 'right', 700);
        text(ctx, `${Math.round(v * a)}${U.watt}`, x + w - 26 * u, b2, SMALL * g.k('speed.watts') * u, 'right', 700);
      }
      if (gforce) text(ctx, gforce, x + 26 * u, b2, accelSize, 'left', 700);
    } else if (gforce) {
      text(ctx, gforce, x + w - 26 * u, b1, accelSize, 'right', 700);
    }
  }

  private drawBattery(ctx: CanvasRenderingContext2D, t: number, x: number, y: number, u: number, o: OverlayOptions) {
    const bat = this.data.battery!;
    const i = nearest(this.batteryTimes, t);
    const [, v, a] = bat.points[i];
    const cell = v / bat.cells;
    // Two lines: icon, per-cell average and flight time; then pack voltage and mAh used.
    const g = this.geometry('battery', o);
    const w = g.w * u;
    panel(ctx, x, y, w, g.h * u, 22 * u, o.panelOpacity);
    const U = units();
    const low = cell < 3.5;
    const warn = low ? '#ffb340' : undefined;
    const line1 = y + g.baselines[0] * u;
    // Per-cell average is the headline (it reads the same on any pack).
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
    text(ctx, U.fly + clock(t), x + w - 26 * u, line1, SMALL * g.k('battery.time') * u, 'right', 700);

    const line2 = y + g.baselines[1] * u;
    text(ctx, `${v.toFixed(1)}${glyphs ? U.volt : ' V'}`, x + 26 * u, line2, SMALL * g.k('battery.volts') * u, 'left', 600, 0.9, warn);
    if (a !== null) text(ctx, `${Math.round(this.mahAt[i])}${U.mah}`, x + w - 26 * u, line2, SMALL * g.k('battery.mah') * u, 'right', 700);
  }

  /**
   * The per-cell voltage (amber below 3.5 V) on the left, drawn like the battery panel's headline, and link quality
   * (amber below Betaflight's 80% alarm) on the right, at the same size.
   */
  private drawLink(ctx: CanvasRenderingContext2D, t: number, x: number, y: number, u: number, o: OverlayOptions) {
    const g = this.geometry('link', o);
    const w = g.w * u;
    panel(ctx, x, y, w, g.h * u, 22 * u, o.panelOpacity);
    const line = y + g.baselines[0] * u;
    const left = x + 26 * u, right = x + w - 26 * u;
    const bat = this.data.battery;
    if (bat?.points.length) {
      const cell = bat.points[nearest(this.batteryTimes, t)][1] / bat.cells;
      const warn = cell < 3.5 ? '#ffb340' : undefined;
      const kc = g.k('link.cell');
      let vx = left;
      if (glyphs) {
        text(ctx, batteryIcon(cell), vx, line, BIG * kc * u, 'left', 700);
        vx += measure(ctx, batteryIcon(cell), BIG * kc * u, 700) + 6 * kc * u;
      } else {
        drawBatteryIcon(ctx, vx, line - 32 * kc * u, 18 * kc * u, 34 * kc * u, cell, warn);
        vx += 32 * kc * u;
      }
      const perCell = cell.toFixed(2);
      text(ctx, perCell, vx, line, BIG * kc * u, 'left', 800, 1, warn);
      text(ctx, glyphs ? units().volt : 'V', vx + measure(ctx, perCell, BIG * kc * u, 800) + 8 * kc * u, line,
           unitSize() * kc * u, 'left', 600, 0.85, warn);
    }
    const tl = this.data.telemetry?.length ? this.data.telemetry[nearest(this.telemetryTimes, t)] : null;
    if (tl?.[3] != null) {
      const lq = Math.round(tl[3]);
      text(ctx, lqText(lq), right, line, BIG * g.k('link.lq') * u, 'right', 700, 1, lq < LQ_ALARM ? '#ffb340' : undefined);
    }
  }

  /** Blackbox Explorer style: dark squares, thin crosshairs, a red dot, raw rcCommand values around the pair. */
  private drawSticks(ctx: CanvasRenderingContext2D, t: number, x: number, top: number, u: number, o: OverlayOptions) {
    if (o.stickStyle === 'retro') { this.drawRetroSticks(ctx, t, x, top, u, o); return; }
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
    const pixel = o.stickStyle === 'pixel';
    for (const g of sides) {
      ctx.save();
      // The box keeps its own dark fill (like Blackbox Explorer); the sticks' backdrop slider only fades it further.
      const boxAlpha = Math.max(0.55, o.stickBoxOpacity + 0.4);
      if (pixel) {
        // As see-through as the Retro (Betaflight) backdrop: just the sticks' backdrop slider, and gone at 0.
        if (o.stickBoxOpacity > 0) pixelBackdrop(ctx, g.left, top, size, box, o.stickBoxOpacity);
      } else {
        ctx.fillStyle = `rgba(${box.join(', ')}, ${boxAlpha})`;
        ctx.beginPath();
        ctx.roundRect(g.left, top, size, size, 14 * u);
        ctx.fill();
      }
      ctx.strokeStyle = `rgba(${cross.join(', ')}, .35)`;
      ctx.lineWidth = Math.max(1, 2 * u);
      ctx.beginPath();
      ctx.moveTo(g.left, top + size / 2); ctx.lineTo(g.left + size, top + size / 2);
      ctx.moveTo(g.left + size / 2, top); ctx.lineTo(g.left + size / 2, top + size);
      ctx.stroke();
      const r = size / 2 - dot - 3 * u;
      const at = (a: ReturnType<typeof stickAxes>) => [g.left + size / 2 + a[g.ax] * r, top + size / 2 - a[g.ay] * r] as const;
      const [kx, ky] = at(now);
      const ring = pixel ? ringRadius(dot, u) : 0;
      if (o.stickTrails) this.drawTrail(ctx, t, at, g.left, top, size, dot, u, safeColor(o.stickTrailColor, '#86a858'), o.stickTrailIntensity ?? 1, ring);
      if (pixel) {
        // An empty ring in chunky pixels, like the OSD font, so the crosshair and footage show through it.
        pixelRing(ctx, kx, ky, ring, 2 * u, safeColor(o.stickRingColor, '#ffffff'));
      } else {
        ctx.fillStyle = safeColor(o.stickDotColor, '#e086b0');
        ctx.beginPath(); ctx.arc(kx, ky, dot, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  /**
   * Betaflight's own OSD stick overlay (osdElementStickOverlay): per stick a 7 x 5 grid of characters, a cross of line
   * characters through the middle, and a cursor that moves a whole character sideways and a third of one up and down
   * (its three dot heights are three glyphs). Drawn from the OSD font when one is loaded, in chunky pixels otherwise.
   * Same footprint as the smooth sticks, so a layout carries over.
   */
  private drawRetroSticks(ctx: CanvasRenderingContext2D, t: number, x: number, top: number, u: number, o: OverlayOptions) {
    const size = 150 * u, gap = 30 * u;
    const COLS = 7, ROWS = 5, STEPS = 3, MID_C = 3, MID_R = 2;
    const now = stickAxes(sampleSticks(this.data.sticks!, t));
    const [lx, ly, rx, ry] = MODES[o.stickMode];
    const ch = size / ROWS, cw = ch * (glyphs ? glyphs.glyphW / glyphs.glyphH : 2 / 3);
    const box = hexToRgb(o.stickBoxColor, [28, 28, 28]);
    for (const [left, ax, ay] of [[x, lx, ly], [x + size + gap, rx, ry]] as const) {
      if (o.stickBoxOpacity > 0) pixelBackdrop(ctx, left, top, size, box, o.stickBoxOpacity);
      const x0 = left + (size - COLS * cw) / 2;
      // Like Betaflight: the stick's range split evenly over the columns, and over the rows' thirds, top = stick up.
      const col = Math.round((Math.max(-1, Math.min(1, now[ax])) + 1) / 2 * (COLS - 1));
      const step = Math.round((1 - Math.max(-1, Math.min(1, now[ay]))) / 2 * (ROWS * STEPS - 1));
      const cells: [number, number, number][] = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          let code = r === MID_R && c === MID_C ? RETRO.center : r === MID_R ? RETRO.horizontal : c === MID_C ? RETRO.vertical : -1;
          if (c === col && r === Math.floor(step / STEPS)) code = RETRO.cursor + (step % STEPS);
          if (code >= 0) cells.push([code, x0 + c * cw, top + r * ch]);
        }
      }
      if (glyphs) {
        const f = glyphs;
        ctx.save();
        ctx.imageSmoothingQuality = 'high';
        for (const [code, cx, cy] of cells) {
          ctx.drawImage(f.atlas, (code % 16) * f.glyphW, Math.floor(code / 16) * f.glyphH, f.glyphW, f.glyphH, cx, cy, cw, ch);
        }
        ctx.restore();
      } else {
        retroPixels(ctx, cells, cw, ch);
      }
    }
  }

  /**
   * Motion-blur streak behind a stick dot: the last TRAIL_S seconds as short segments that thin out and fade
   * with age, softened with a blur filter. Clipped to the stick box so the blur never bleeds past its edge.
   */
  private drawTrail(ctx: CanvasRenderingContext2D, t: number, at: (a: ReturnType<typeof stickAxes>) => readonly [number, number],
                    left: number, top: number, size: number, dot: number, u: number, color: string, intensity: number, hole = 0) {
    const TRAIL_S = 0.35, STEPS = 21; // 60 steps a second, so fast flicks still draw a smooth curve
    const pts: (readonly [number, number])[] = [];
    for (let k = STEPS; k >= 0; k--) pts.push(at(stickAxes(sampleSticks(this.data.sticks!, Math.max(0, t - (TRAIL_S * k) / STEPS)))));
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(left, top, size, size, 14 * u);
    ctx.clip();
    if (hole) {
      // Nothing inside the Pixel look's ring, so it stays an empty circle with the trail leading up to it.
      const [nx, ny] = pts[pts.length - 1];
      ctx.beginPath();
      ctx.rect(left, top, size, size);
      ctx.arc(nx, ny, hole, 0, Math.PI * 2);
      ctx.clip('evenodd');
    }
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

  private drawMap(ctx: CanvasRenderingContext2D, t: number, x: number, y: number, u: number, o: OverlayOptions) {
    const b = this.mapBounds!;
    const size = MAP_SIZE * u;
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
/**
 * Small speedometer for the built-in font: a half-dial with a needle, sitting on the text baseline like the battery icon.
 * `frac` (0..1) sets the needle from left (stopped) to right (the flight's top speed).
 */
function drawSpeedIcon(ctx: CanvasRenderingContext2D, x: number, baseline: number, s: number, frac: number) {
  const r = (SPEED_ICON_W / 2) * s;
  const cx = x + r, cy = baseline - 5 * s; // dial top lines up with the battery icon on the other panel
  const a = Math.PI + Math.max(0, Math.min(1, frac)) * Math.PI;
  const line = Math.max(1.5, 3.2 * s);
  const shape = (width: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.arc(cx, cy, r - line / 2, Math.PI, 2 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78); ctx.stroke();
  };
  ctx.save();
  ctx.lineCap = 'round';
  shape(line * 2.4, 'rgba(0,0,0,.75)'); // dark halo first, like the text outline
  shape(line, '#ffffff');
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(cx, cy, line * 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

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
const glyphCodes = (s: string) => [...s].map(c => {
  const code = c.charCodeAt(0);
  if (code >= 0xe000 && code <= 0xe0ff) return code - 0xe000; // raw font slot, see glyph()
  const upper = c >= 'a' && c <= 'z' ? c.toUpperCase().charCodeAt(0) : code;
  return upper > 255 ? 63 : upper;
});

/**
 * The Pixel and Retro sticks' backdrop in chunky pixels, like the OSD font: a square on a 30 x 30 grid with stepped round corners and
 * a one-pixel lighter frame. Each row is drawn as runs, so a frame costs a few dozen rectangles, not hundreds.
 */
function pixelBackdrop(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rgb: number[], alpha: number) {
  const N = 30, R = 5, px = size / N;
  const inside = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= N || j >= N) return false;
    const dx = Math.max(0, R - i - 0.5, i + 0.5 - (N - R)), dy = Math.max(0, R - j - 0.5, j + 0.5 - (N - R));
    return dx * dx + dy * dy <= R * R;
  };
  // Diagonal neighbours count too, so the frame steps around the corners without gaps.
  const frame = (i: number, j: number) => [-1, 0, 1].some(a => [-1, 0, 1].some(b => !inside(i + a, j + b)));
  const fill = `rgba(${rgb.join(', ')}, ${alpha})`;
  const light = `rgba(${rgb.map(c => Math.round(c + (255 - c) * 0.35)).join(', ')}, ${Math.min(1, alpha + 0.25)})`;
  ctx.save();
  for (let j = 0; j < N; j++) {
    // Runs of the same kind along the row: outside, fill or frame.
    let i = 0;
    while (i < N) {
      const kind = !inside(i, j) ? 0 : frame(i, j) ? 2 : 1;
      let end = i + 1;
      while (end < N && (!inside(end, j) ? 0 : frame(end, j) ? 2 : 1) === kind) end++;
      if (kind) {
        ctx.fillStyle = kind === 2 ? light : fill;
        // Whole device pixels, so neighbouring runs meet without seams.
        const x0 = Math.round(x + i * px), x1 = Math.round(x + end * px);
        ctx.fillRect(x0, Math.round(y + j * px), x1 - x0, Math.round(y + (j + 1) * px) - Math.round(y + j * px));
      }
      i = end;
    }
  }
  ctx.restore();
}

/** The stick ring's radius: three quarters of the old dot's (plus its edge), small enough to sit neatly on the crosshair. */
const ringRadius = (dot: number, u: number) => (dot + 1.5 * u) * 0.75;

/**
 * An empty ring of radius `r` drawn from square pixels of size `px`, like the OSD font's glyphs: the ring's pixels with a
 * one-pixel dark edge around the outside only, so the middle stays open.
 */
function pixelRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, px: number, color: string) {
  const n = Math.ceil(r / px) + 2;
  const ring: [number, number][] = [], edge: [number, number][] = [];
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const d = Math.hypot(i, j) * px;
      if (d >= r - px * 0.9 && d < r + px * 0.6) ring.push([i, j]);
      else if (d >= r + px * 0.6 && d < r + px * 1.6) edge.push([i, j]);
    }
  }
  const at = (i: number, j: number) => [Math.round(cx + (i - 0.5) * px), Math.round(cy + (j - 0.5) * px)] as const;
  const p = Math.round(px);
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, .85)';
  for (const [i, j] of edge) { const [x, y] = at(i, j); ctx.fillRect(x, y, p, p); }
  ctx.fillStyle = color;
  for (const [i, j] of ring) { const [x, y] = at(i, j); ctx.fillRect(x, y, p, p); }
  ctx.restore();
}

/** Betaflight's stick overlay characters (osd_symbols.h): the cursor's three heights start at 0x08. */
const RETRO = { cursor: 0x08, center: 0x0b, vertical: 0x16, horizontal: 0x17 };

/**
 * The stick overlay without an OSD font: the same characters as blocky white pixels with a black outline, on a 12 x 18
 * pixel cell like the goggles' font. All outlines go first, so lines that meet across cells join cleanly.
 */
function retroPixels(ctx: CanvasRenderingContext2D, cells: [number, number, number][], cw: number, ch: number) {
  const px = ch / 18;
  const rects: [number, number, number, number][] = [];
  for (const [code, x, y] of cells) {
    const hBar = () => rects.push([x, y + ch / 2 - px, cw, 2 * px]);
    const vBar = () => rects.push([x + cw / 2 - px, y, 2 * px, ch]);
    if (code === RETRO.horizontal) hBar();
    else if (code === RETRO.vertical) vBar();
    else if (code === RETRO.center) { hBar(); vBar(); }
    else rects.push([x + cw / 2 - 2 * px, y + ch * ((code - RETRO.cursor) * 2 + 1) / 6 - 2 * px, 4 * px, 4 * px]);
  }
  ctx.save();
  ctx.fillStyle = '#000000';
  for (const [x, y, w, h] of rects) ctx.fillRect(Math.round(x - px), Math.round(y - px), Math.round(w + 2 * px), Math.round(h + 2 * px));
  ctx.fillStyle = '#ffffff';
  for (const [x, y, w, h] of rects) ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  ctx.restore();
}

let tintCanvas: HTMLCanvasElement | null = null, maskCanvas: HTMLCanvasElement | null = null;

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
    // The glyphs' shapes, kept aside: destination-in has to use them in one draw, since each draw clears everything
    // outside itself and drawing glyph by glyph would leave none.
    maskCanvas ??= document.createElement('canvas');
    maskCanvas.width = tintCanvas!.width;
    maskCanvas.height = tintCanvas!.height;
    maskCanvas.getContext('2d')!.drawImage(tintCanvas!, 0, 0);
    // Multiply keeps the dark outline dark and turns the white fill into the tint colour.
    target.save();
    target.globalCompositeOperation = 'multiply';
    target.fillStyle = color;
    target.fillRect(0, 0, tintCanvas!.width, tintCanvas!.height);
    target.globalCompositeOperation = 'destination-in';
    target.drawImage(maskCanvas, 0, 0);
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

/** The title: its two parts side by side in their colours with an outer stroke, on the background box when it has one. */
function drawTitle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, o: OverlayOptions) {
  const size = TITLE_SIZE * s, w = (titleWidth(o.titleText + o.titleAccentText, o) + 2 * TITLE_PAD_X) * s;
  ctx.save();
  if (o.titleBgColor) {
    ctx.fillStyle = o.titleBgColor;
    ctx.fillRect(x, y, w, TITLE_H * s);
  }
  if (osdLabel(o.titleFont)) {
    // In the OSD font, each part tinted its colour; the glyphs carry their own outline.
    let tx = x + TITLE_PAD_X * s;
    const ty = osdBaseline(y, TITLE_H * s, OSD_TITLE_SIZE * s);
    for (const [part, color] of [[o.titleText, o.titleColor], [o.titleAccentText, o.titleAccentColor]]) {
      if (!part) continue;
      text(ctx, part, tx, ty, OSD_TITLE_SIZE * s, 'left', 800, 1, color);
      tx += osdWidth(part, OSD_TITLE_SIZE) * s;
    }
    ctx.restore();
    return;
  }
  ctx.font = `${size}px ${DISPLAY_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const ty = y + (TITLE_H * s) / 2 + size * 0.04; // caps sit a touch low of the em-box middle
  const parts = [[o.titleText, o.titleColor], [o.titleAccentText, o.titleAccentColor]].filter(([part]) => part);
  // Every part's stroke first, then every fill, so the strokes sit outside the letters (Premiere's outer stroke)
  // and merge into one outline around the word instead of cutting into the neighbouring letter.
  let tx = x + TITLE_PAD_X * s;
  for (const [part] of parts) { outerStroke(ctx, part, tx, ty, TITLE_STROKE * s, o.titleStrokeColor); tx += ctx.measureText(part).width; }
  tx = x + TITLE_PAD_X * s;
  for (const [part, color] of parts) { ctx.fillStyle = color; ctx.fillText(part, tx, ty); tx += ctx.measureText(part).width; }
  ctx.restore();
}

/** How long the credit shows at the end of a video without a stats screen (s). */
const CREDIT_SECONDS = 3;
/** The site's dark theme: page background, text, and the green accent (as in styles.css). */
const SITE_BG = '#0a0f14', SITE_LINE = '#233040', SITE_INK = '#e6edf3';
/** The credit badge's height (1080p px). */
const CREDIT_H = 46;

/**
 * The editor's credit as a badge centred on (cx, cy): the GitDrone mark, then "OSD by" and "lovelyosd.com" in bold
 * Impact, in the site's dark theme colours on a dark tile. Under the stats screen, or over a video's last seconds without one.
 */
function drawCredit(ctx: CanvasRenderingContext2D, cx: number, cy: number, u: number) {
  const lead = 'OSD by ', site = 'lovelyosd.com';
  const size = 28 * u, logo = 30 * u, gap = 10 * u, padX = 14 * u, h = CREDIT_H * u;
  ctx.save();
  ctx.font = `${size}px ${DISPLAY_FONT}`;
  ctx.letterSpacing = `${u}px`;
  const leadW = ctx.measureText(lead).width, siteW = ctx.measureText(site).width;
  const w = padX + logo + gap + leadW + siteW + padX;
  const x0 = cx - w / 2;
  ctx.beginPath();
  ctx.roundRect(x0, cy - h / 2, w, h, 10 * u);
  ctx.fillStyle = SITE_BG;
  ctx.globalAlpha = 0.88;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2 * u;
  ctx.strokeStyle = SITE_LINE;
  ctx.stroke();
  drawLogo(ctx, x0 + padX, cy - logo / 2, logo);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const baseline = cy + size * 0.37, tx = x0 + padX + logo + gap;
  ctx.fillStyle = SITE_INK;
  ctx.fillText(lead, tx, baseline);
  ctx.fillStyle = ACCENT;
  ctx.fillText(site, tx + leadW, baseline);
  ctx.restore();
}

/** The GitDrone mark (the nav logo and favicon): an X frame, four rotors and a body, in the site green, `size` px square. */
function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 32, size / 32);
  ctx.strokeStyle = ACCENT;
  ctx.fillStyle = ACCENT;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(9, 9); ctx.lineTo(23, 23);
  ctx.moveTo(23, 9); ctx.lineTo(9, 23);
  for (const [px, py] of [[7, 7], [25, 7], [7, 25], [25, 25]]) {
    ctx.moveTo(px + 4.5, py);
    ctx.arc(px, py, 4.5, 0, 2 * Math.PI);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(12.5, 12.5, 7, 7, 2);
  ctx.fill();
  ctx.restore();
}

/** The craft name: Impact, a flat fill and a dark outer stroke, as set up in Premiere for a real Short. */
function drawCraft(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, o: OverlayOptions) {
  if (osdLabel(o.craftFont)) {
    text(ctx, o.craftText, x + CRAFT_STROKE * s, osdBaseline(y, CRAFT_H * s, OSD_CRAFT_SIZE * s), OSD_CRAFT_SIZE * s, 'left', 800, 1, o.craftColor);
    return;
  }
  const size = CRAFT_SIZE * s;
  ctx.save();
  ctx.font = `${size}px ${DISPLAY_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const tx = x + CRAFT_STROKE * s, ty = y + (CRAFT_H * s) / 2 + size * 0.04;
  outerStroke(ctx, o.craftText, tx, ty, CRAFT_STROKE * s, o.craftStrokeColor);
  ctx.fillStyle = o.craftColor;
  ctx.fillText(o.craftText, tx, ty);
  ctx.restore();
}

/** Where OSD text's baseline goes to sit centred in a box `h` tall from `top`: its glyph cell, or the built-in font's caps. */
function osdBaseline(top: number, h: number, size: number) {
  if (glyphs) { const cell = size * GLYPH_CELL; return top + (h - cell) / 2 + cell * GLYPH_BASELINE; }
  return top + h / 2 + size * 0.36;
}

/**
 * An outline `width` px wide outside the letters (font already set). Canvas strokes straddle the edge, so this
 * strokes twice as wide and relies on the fill drawn after it to cover the inner half.
 */
function outerStroke(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, width: number, color: string) {
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, width * 2);
  ctx.strokeStyle = color;
  ctx.strokeText(s, x, y);
}

function measure(ctx: CanvasRenderingContext2D, s: string, size: number, weight: number) {
  if (glyphs) return glyphCodes(s).length * size * GLYPH_CELL * (glyphs.glyphW / glyphs.glyphH);
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  const w = ctx.measureText(s).width;
  ctx.restore();
  return w;
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** See OverlayRenderer.geometry. Sizes are 1080p units; `pad` is the left/right inset; items in a row sit 20 apart. */
function fit(w0: number, h0: number, pad: number, k: (item: ItemKey) => number, rows: Row[], sizeToContent = false): Geometry {
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
    // Grow only by what resizing added: the default design already decides how tight its own rows are. Panels sized
    // to content instead just take whatever width their text needs.
    if (sizeToContent) w = Math.max(w, rowW(true));
    else w = Math.max(w, w0 + Math.max(0, rowW(true) - Math.max(w0, rowW(false))));
  }
  return { w, h: h0 + shift, baselines, k };
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6_371_000, toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
