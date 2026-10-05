import { BatteryPoint, StickPoint, TrackPoint, msToKmh } from './flight.models';
import { MODES, StickMode, sampleSticks, stickAxes, throttlePercent } from './stick-math';
import { clock, nearest } from './flight-profile.component';

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
  stickMode: StickMode;
  /** Background panels behind each element, 0..1. */
  panelOpacity: number;
}

const ACCENT = '#9be564';
const FONT = 'ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace';

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

    if (o.showTimer) this.drawTimer(ctx, t, m, u, o);
    if (o.showMap && this.mapXY.length > 1) this.drawMap(ctx, t, W - m - 300 * u, m, 300 * u, u, o);
    if (o.showSpeed && this.trackTimes.length) this.drawSpeed(ctx, t, m, H - m, u, o);
    if (o.showBattery && this.batteryTimes.length) this.drawBattery(ctx, t, W - m, H - m, u, o);
    if (o.showSticks && this.data.sticks?.length) this.drawSticks(ctx, t, W / 2, H - m, u, o);
  }

  // ---------- elements ----------

  private drawTimer(ctx: CanvasRenderingContext2D, t: number, m: number, u: number, o: OverlayOptions) {
    panel(ctx, m, m, 210 * u, 92 * u, 18 * u, o.panelOpacity);
    label(ctx, 'FLIGHT TIME', m + 22 * u, m + 30 * u, 20 * u);
    text(ctx, clock(t), m + 22 * u, m + 74 * u, 46 * u, 'left', 700);
  }

  private drawSpeed(ctx: CanvasRenderingContext2D, t: number, x: number, bottom: number, u: number, o: OverlayOptions) {
    const i = nearest(this.trackTimes, t);
    const p = this.data.track!.points[i];
    const w = 330 * u, h = 240 * u, y = bottom - h;
    panel(ctx, x, y, w, h, 22 * u, o.panelOpacity);
    label(ctx, 'SPEED', x + 26 * u, y + 40 * u, 20 * u);
    const kmh = msToKmh(p[4]).toFixed(0);
    text(ctx, kmh, x + 26 * u, y + 140 * u, 108 * u, 'left', 800);
    text(ctx, 'km/h', x + 26 * u + measure(ctx, kmh, 108 * u, 800) + 12 * u, y + 140 * u, 30 * u, 'left', 600, 0.85);
    text(ctx, `▲ ${p[3].toFixed(0)} m`, x + 26 * u, y + 208 * u, 32 * u, 'left', 700);
    text(ctx, `⌂ ${this.homeDist[i].toFixed(0)} m`, x + 190 * u, y + 208 * u, 32 * u, 'left', 700);
  }

  private drawBattery(ctx: CanvasRenderingContext2D, t: number, right: number, bottom: number, u: number, o: OverlayOptions) {
    const bat = this.data.battery!;
    const i = nearest(this.batteryTimes, t);
    const [, v, a] = bat.points[i];
    const cell = v / bat.cells;
    const w = 330 * u, h = 240 * u, x = right - w, y = bottom - h;
    panel(ctx, x, y, w, h, 22 * u, o.panelOpacity);
    label(ctx, `BATTERY ${bat.cells}S`, x + 26 * u, y + 40 * u, 20 * u);
    const low = cell < 3.5;
    const warn = low ? '#ffb340' : undefined;
    const volts = v.toFixed(1);
    text(ctx, volts, x + 26 * u, y + 108 * u, 72 * u, 'left', 800, 1, warn);
    text(ctx, 'V', x + 26 * u + measure(ctx, volts, 72 * u, 800) + 10 * u, y + 108 * u, 30 * u, 'left', 600, 0.85);
    // Per-cell on its own line so it never collides with the big pack voltage.
    text(ctx, `${cell.toFixed(2)} V/cell`, x + 26 * u, y + 146 * u, 26 * u, 'left', 600, 0.9, warn);
    if (a !== null) {
      text(ctx, `${a.toFixed(1)} A`, x + 26 * u, y + 188 * u, 32 * u, 'left', 700);
      text(ctx, `${Math.round(v * a)} W`, x + w - 26 * u, y + 188 * u, 32 * u, 'right', 700);
      text(ctx, `${Math.round(this.mahAt[i])} mAh`, x + 26 * u, y + 222 * u, 26 * u, 'left', 600, 0.9);
    }
    if (this.data.sticks?.length) {
      const thr = throttlePercent(stickAxes(sampleSticks(this.data.sticks, t)));
      text(ctx, `THR ${thr}%`, x + w - 26 * u, y + 222 * u, 26 * u, 'right', 600, 0.9);
    }
  }

  private drawSticks(ctx: CanvasRenderingContext2D, t: number, cx: number, bottom: number, u: number, o: OverlayOptions) {
    const size = 170 * u, gap = 36 * u, pad = 16 * u;
    const now = stickAxes(sampleSticks(this.data.sticks!, t));
    const trail: ReturnType<typeof stickAxes>[] = [];
    for (let dt = 0.6; dt > 0; dt -= 0.04) trail.push(stickAxes(sampleSticks(this.data.sticks!, Math.max(0, t - dt))));
    trail.push(now);
    const [lx, ly, rx, ry] = MODES[o.stickMode];
    const sides: [number, typeof lx, typeof ly][] = [[cx - gap / 2 - size, lx, ly], [cx + gap / 2, rx, ry]];

    for (const [left, ax, ay] of sides) {
      const top = bottom - size;
      panel(ctx, left, top, size, size, 26 * u, o.panelOpacity);
      const r = size / 2 - pad;
      const mx = left + size / 2, my = top + size / 2;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.lineWidth = 2 * u;
      ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([5 * u, 7 * u]);
      ctx.beginPath(); ctx.moveTo(left + pad, my); ctx.lineTo(left + size - pad, my); ctx.moveTo(mx, top + pad); ctx.lineTo(mx, top + size - pad); ctx.stroke();
      ctx.setLineDash([]);
      const at = (a: ReturnType<typeof stickAxes>) => [mx + a[ax] * r, my - a[ay] * r] as const;
      // Fading trail of the last 0.6 s.
      ctx.strokeStyle = ACCENT;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let k = 1; k < trail.length; k++) {
        ctx.globalAlpha = (k / trail.length) * 0.55;
        ctx.lineWidth = 5 * u;
        const [x0, y0] = at(trail[k - 1]);
        const [x1, y1] = at(trail[k]);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const [kx, ky] = at(now);
      ctx.strokeStyle = 'rgba(255,255,255,.7)';
      ctx.lineWidth = 4 * u;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(kx, ky); ctx.stroke();
      ctx.fillStyle = ACCENT;
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.lineWidth = 3 * u;
      ctx.beginPath(); ctx.arc(kx, ky, 13 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
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
    // Whole path faint, flown part bright.
    ctx.strokeStyle = 'rgba(255,255,255,.28)';
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    this.mapXY.forEach((p, k) => { const [px, py] = P(p); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 4 * u;
    ctx.beginPath();
    for (let k = 0; k <= i; k++) { const [px, py] = P(this.mapXY[k]); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke();

    if (this.homeXY) {
      const [hx, hy] = P(this.homeXY);
      text(ctx, 'H', hx, hy + 10 * u, 28 * u, 'center', 800);
    }
    const [cx, cy] = P(this.mapXY[i]);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.lineWidth = 3 * u;
    ctx.beginPath(); ctx.arc(cx, cy, 10 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
    label(ctx, `${(span).toFixed(0)} m across`, x + 18 * u, y + size - 16 * u, 18 * u);
  }
}

// ---------- drawing helpers ----------

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, opacity: number) {
  if (opacity <= 0) return;
  ctx.save();
  ctx.fillStyle = `rgba(8, 12, 16, ${opacity})`;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.restore();
}

/** White OSD text with a dark outline, readable over sky and grass alike. */
function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number,
              align: CanvasTextAlign = 'left', weight = 700, alpha = 1, color = '#ffffff') {
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
