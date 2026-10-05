import { BatteryPoint, SpeedUnit, StickPoint, TrackPoint, speedFromMs } from './flight.models';
import { MODES, StickMode, sampleSticks, stickAxes } from './stick-math';
import { clock, nearest } from './flight-profile.component';
import { GlyphFont, SYM } from './glyph-font';

export interface OverlayData {
  track: { home: [number, number] | null; points: TrackPoint[] } | null;
  sticks: StickPoint[] | null;
  battery: { cells: number; points: BatteryPoint[] } | null;
}

export interface OverlayOptions {
  showSticks: boolean;
  showSpeed: boolean;
  showBattery: boolean;
  showMap: boolean;
  showTimer: boolean;
  /** Blurred, fading streak behind each stick dot, like a long exposure. */
  stickTrails: boolean;
  /** Mini map colours (#rrggbb): the path just flown, and what it darkens to as it ages. */
  pathRecentColor: string;
  pathOldColor: string;
  /** Stick colours (#rrggbb): the position dot and its motion-blur trail. */
  stickDotColor: string;
  stickTrailColor: string;
  /** Stick box fill and crosshair (#rrggbb); their transparency stays fixed. */
  stickBoxColor: string;
  stickCrossColor: string;
  stickMode: StickMode;
  /** Background panels behind each element, 0..1. */
  panelOpacity: number;
  /** Betaflight OSD font to draw text with; null uses the built-in monospace font. */
  font: GlyphFont | null;
  speedUnit: SpeedUnit;
}

const ACCENT = '#9be564';
const FONT = 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';

/** The OSD font and speed unit for the frame being drawn (set at the start of draw). */
let glyphs: GlyphFont | null = null;
let speedUnit: SpeedUnit = 'kmh';

/** Unit strings: Betaflight's own symbols with an OSD font, plain text otherwise. */
const units = () => glyphs
  ? { kph: speedUnit === 'mph' ? SYM.mph : SYM.kph, volt: SYM.volt, perCell: SYM.volt, amp: SYM.amp, mah: SYM.mah, watt: SYM.watt, m: SYM.m,
      alt: SYM.alt, home: SYM.home, fly: SYM.fly, sat: SYM.sat }
  : { kph: speedUnit === 'mph' ? 'mph' : 'km/h', volt: 'V', perCell: ' V/cell', amp: ' A', mah: ' mAh', watt: ' W', m: ' m',
      alt: '▲ ', home: '⌂ ', fly: '', sat: 'SAT ' };

/** Betaflight battery icon for a per-cell voltage (3.3 V empty .. 4.2 V full). */
const batteryIcon = (cell: number) => SYM.batt[6 - Math.max(0, Math.min(6, Math.round(((cell - 3.3) / 0.9) * 6)))];

/**
 * Draws one HUD frame for time t (seconds since log start) onto a transparent canvas.
 * Layout is designed at 1080p and scaled by canvas height, so 1440p and 4K look identical, only sharper.
 */
export class OverlayRenderer {
  private trackTimes: number[];
  private batteryTimes: number[];
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
    const m = 48 * u;
    ctx.clearRect(0, 0, W, H);
    glyphs = o.font;
    speedUnit = o.speedUnit;

    if (o.showTimer) this.drawTimer(ctx, t, m, u, o);
    if (o.showMap && this.mapXY.length > 1) this.drawMap(ctx, t, W - m - 300 * u, m, 300 * u, u, o);
    if (o.showSpeed && this.trackTimes.length) this.drawSpeed(ctx, t, m, H - m, u, o);
    if (o.showBattery && this.batteryTimes.length) this.drawBattery(ctx, t, W - m, H - m, u, o);
    if (o.showSticks && this.data.sticks?.length) this.drawSticks(ctx, t, W / 2, H - m, u, o);
  }

  // ---------- elements ----------

  private drawTimer(ctx: CanvasRenderingContext2D, t: number, m: number, u: number, o: OverlayOptions) {
    panel(ctx, m, m, 210 * u, 92 * u, 18 * u, o.panelOpacity);
    if (!glyphs) label(ctx, 'FLIGHT TIME', m + 22 * u, m + 30 * u, 20 * u); // OSD fonts say it with the quad icon
    text(ctx, units().fly + clock(t), m + 22 * u, m + 74 * u, 46 * u, 'left', 700);
  }

  private drawSpeed(ctx: CanvasRenderingContext2D, t: number, x: number, bottom: number, u: number, o: OverlayOptions) {
    const i = nearest(this.trackTimes, t);
    const p = this.data.track!.points[i];
    // Same width as the battery panel. Line 1: speed and acceleration; line 2: altitude, home distance, satellites.
    const w = 400 * u, h = 160 * u, y = bottom - h;
    panel(ctx, x, y, w, h, 22 * u, o.panelOpacity);
    if (!glyphs) label(ctx, 'SPEED', x + 26 * u, y + 36 * u, 20 * u);
    const U = units();
    const speed = speedFromMs(p[4], o.speedUnit).toFixed(0);
    text(ctx, speed, x + 26 * u, y + 96 * u, 54 * u, 'left', 800);
    text(ctx, U.kph, x + 26 * u + measure(ctx, speed, 54 * u, 800) + 10 * u, y + 96 * u, glyphs ? 30 * u : 24 * u, 'left', 600, 0.85);
    if (p[6] !== undefined) text(ctx, `${(p[6] / 9.81).toFixed(1)}G`, x + w - 26 * u, y + 96 * u, 32 * u, 'right', 700);
    // Home sits a little right of centre: the altitude reading on the left is usually the wider of the two neighbours.
    text(ctx, `${U.alt}${p[3].toFixed(0)}${U.m}`, x + 26 * u, y + 140 * u, 26 * u, 'left', 700);
    text(ctx, `${U.home}${this.homeDist[i].toFixed(0)}${U.m}`, x + w * 0.55, y + 140 * u, 26 * u, 'center', 700);
    if (p[5] !== undefined) text(ctx, `${U.sat}${p[5]}`, x + w - 26 * u, y + 140 * u, 26 * u, 'right', 700);
  }

  private drawBattery(ctx: CanvasRenderingContext2D, t: number, right: number, bottom: number, u: number, o: OverlayOptions) {
    const bat = this.data.battery!;
    const i = nearest(this.batteryTimes, t);
    const [, v, a] = bat.points[i];
    const cell = v / bat.cells;
    // Two lines: icon, pack voltage and per-cell average; then amps, mAh used and watts.
    const w = 400 * u, h = a !== null ? 128 * u : 86 * u, x = right - w, y = bottom - h;
    panel(ctx, x, y, w, h, 22 * u, o.panelOpacity);
    const U = units();
    const low = cell < 3.5;
    const warn = low ? '#ffb340' : undefined;
    const line1 = y + 60 * u;

    // Battery-level icon: Betaflight's own glyph with an OSD font, a drawn one otherwise.
    let vx = x + 26 * u;
    if (glyphs) {
      text(ctx, batteryIcon(cell), vx, line1, 36 * u, 'left', 700);
      vx += measure(ctx, batteryIcon(cell), 36 * u, 700) + 6 * u;
    } else {
      drawBatteryIcon(ctx, vx, line1 - 32 * u, 18 * u, 34 * u, cell, warn);
      vx += 32 * u;
    }
    const volts = v.toFixed(1);
    text(ctx, volts, vx, line1, 36 * u, 'left', 800, 1, warn);
    text(ctx, U.volt, vx + measure(ctx, volts, 36 * u, 800) + 8 * u, line1, glyphs ? 28 * u : 22 * u, 'left', 600, 0.85);
    text(ctx, `${cell.toFixed(2)}${U.perCell}`, x + w - 26 * u, line1, 24 * u, 'right', 600, 0.9, warn);

    if (a !== null) {
      const line2 = y + 106 * u;
      text(ctx, `${a.toFixed(1)}${U.amp}`, x + 26 * u, line2, 24 * u, 'left', 700);
      text(ctx, `${Math.round(this.mahAt[i])}${U.mah}`, x + w / 2, line2, 24 * u, 'center', 700);
      text(ctx, `${Math.round(v * a)}${U.watt}`, x + w - 26 * u, line2, 24 * u, 'right', 700);
    }
  }

  /** Blackbox Explorer style: dark squares, thin crosshairs, a red dot, raw rcCommand values around the pair. */
  private drawSticks(ctx: CanvasRenderingContext2D, t: number, cx: number, bottom: number, u: number, o: OverlayOptions) {
    const size = 150 * u, gap = 30 * u, dot = 10 * u;
    const raw = sampleSticks(this.data.sticks!, t);
    const now = stickAxes(raw);
    const [lx, ly, rx, ry] = MODES[o.stickMode];
    const top = bottom - size;
    const sides = [
      { side: 'left', left: cx - gap / 2 - size, ax: lx, ay: ly },
      { side: 'right', left: cx + gap / 2, ax: rx, ay: ry },
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
      if (o.stickTrails) this.drawTrail(ctx, t, at, g.left, top, size, dot, u, safeColor(o.stickTrailColor, '#9a9a9a'));
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
                    left: number, top: number, size: number, dot: number, u: number, color: string) {
    const TRAIL_S = 0.35, STEPS = 21; // 60 steps a second, so fast flicks still draw a smooth curve
    const pts: (readonly [number, number])[] = [];
    for (let k = STEPS; k >= 0; k--) pts.push(at(stickAxes(sampleSticks(this.data.sticks!, Math.max(0, t - (TRAIL_S * k) / STEPS)))));
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(left, top, size, size, 14 * u);
    ctx.clip();
    ctx.filter = `blur(${Math.max(1, 3.5 * u)}px)`;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    for (let k = 1; k < pts.length; k++) {
      const age = k / (pts.length - 1); // 0 = oldest, 1 = newest
      ctx.globalAlpha = 0.75 * age * age;
      ctx.lineWidth = dot * 2 * (0.35 + 0.65 * age);
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

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6_371_000, toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
