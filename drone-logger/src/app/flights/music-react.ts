/**
 * Music-reactive OSD: the song is measured once (bass, mids, treble and the drums' hits, 100 times a second), and the
 * HUD pulses, splits into colour fringes and changes tint with it. Measured ahead of time rather than live, so the
 * preview and the finished video react identically, frame for frame.
 */

/**
 * The song at one moment, each 0..1: band loudness against the song's own range, the last hit fading (for the OSD), and
 * the last trigger fading (for the footage).
 */
export interface MusicLevel { bass: number; mid: number; treble: number; hit: number; punch: number }

/** Where hits come from: kick drums (sudden bass), hats and snares (sudden highs), or either. */
export type HitSource = 'bass' | 'highs' | 'both';
/**
 * What sets the footage off (its zoom, vignette and saturation): every hit, only the strongest quarter of them, or only
 * drops, where the song jumps up after a quieter stretch. Between triggers the footage is left alone.
 */
export type FootageTrigger = 'hits' | 'big' | 'drops';
/** The band the tint follows. */
export type TintSource = 'bass' | 'mid' | 'treble' | 'all';

/** The effects, each with a strength and its own on/off. */
export type MusicEffect = 'pulse' | 'split' | 'tint' | 'zoom' | 'vignette' | 'saturation';
export const MUSIC_EFFECTS: readonly MusicEffect[] = ['pulse', 'split', 'tint', 'zoom', 'vignette', 'saturation'];

/** How the HUD and the footage react. Strengths are multipliers: 1 is the default, 0 as good as off. */
export interface MusicReact {
  on: boolean;
  /** Which effects are switched on; their strengths are kept while off. */
  enabled: Record<MusicEffect, boolean>;
  pulse: number;
  split: number;
  /** The two fringe colours, left and right. */
  splitColors: [string, string];
  /** What counts as a hit, for the pulse and the split. */
  hitBy: HitSource;
  tint: number;
  /** 'drift' cycles round the colour wheel at `tintSpeed` degrees a second; 'fixed' is always `tintColor`. */
  tintMode: 'drift' | 'fixed';
  tintColor: string;
  tintSpeed: number;
  tintBy: TintSource;
  /** How long a hit takes to fade, s. */
  hitLength: number;
  /** How readily a sudden rise counts as a hit: higher catches softer ones. */
  sensitivity: number;
  /** The footage itself: zooming in on each hit, its edges darkening with the bass, and its colour swelling with it. */
  zoom: number;
  vignette: number;
  saturation: number;
  footageTrigger: FootageTrigger;
}

export const MUSIC_REACT_DEFAULTS: MusicReact = {
  on: false, enabled: { pulse: true, split: true, tint: true, zoom: true, vignette: true, saturation: true }, pulse: 1, split: 1, splitColors: ['#ff2a55', '#22e4ff'], hitBy: 'bass',
  tint: 1, tintMode: 'drift', tintColor: '#ff4fd8', tintSpeed: 24, tintBy: 'bass', hitLength: 0.14, sensitivity: 1,
  zoom: 1, vignette: 1, saturation: 1, footageTrigger: 'big',
};

/** Settings as saved (perhaps by an older version), with anything missing or malformed back at its default. */
export function readMusicReact(saved: unknown): MusicReact {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>, d = MUSIC_REACT_DEFAULTS;
  const num = (k: keyof MusicReact, lo: number, hi: number) =>
    typeof s[k] === 'number' && Number.isFinite(s[k]) ? Math.min(hi, Math.max(lo, s[k] as number)) : (d[k] as number);
  const colour = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
  const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T) => (options.includes(v as T) ? (v as T) : fallback);
  const pair = Array.isArray(s['splitColors']) ? s['splitColors'] : [];
  const enabled = (s['enabled'] && typeof s['enabled'] === 'object' ? s['enabled'] : {}) as Record<string, unknown>;
  return {
    on: typeof s['on'] === 'boolean' ? s['on'] : d.on,
    enabled: Object.fromEntries(MUSIC_EFFECTS.map(k => [k, typeof enabled[k] === 'boolean' ? enabled[k] : d.enabled[k]])) as Record<MusicEffect, boolean>,
    pulse: num('pulse', 0, 2), split: num('split', 0, 2), tint: num('tint', 0, 2),
    splitColors: [colour(pair[0], d.splitColors[0]), colour(pair[1], d.splitColors[1])],
    hitBy: pick(s['hitBy'], ['bass', 'highs', 'both'] as const, d.hitBy),
    tintMode: pick(s['tintMode'], ['drift', 'fixed'] as const, d.tintMode),
    tintColor: colour(s['tintColor'], d.tintColor), tintSpeed: num('tintSpeed', 0, 180),
    tintBy: pick(s['tintBy'], ['bass', 'mid', 'treble', 'all'] as const, d.tintBy),
    hitLength: num('hitLength', 0.05, 0.5), sensitivity: num('sensitivity', 0.5, 2),
    zoom: num('zoom', 0, 2), vignette: num('vignette', 0, 2), saturation: num('saturation', 0, 2),
    footageTrigger: pick(s['footageTrigger'], ['hits', 'big', 'drops'] as const, d.footageTrigger),
  };
}

/** How much the footage zooms in at this moment: up to 4% as a trigger lands, at 100%. */
export const footagePunch = (lv: MusicLevel | null, fx: MusicFx | null) => (lv && fx ? 1 + 0.04 * fx.zoom * lv.punch : 1);

/** How dark the footage's edges get at this moment, 0..0.95: none between triggers, 60% as one lands at 100%. */
export const vignetteLevel = (lv: MusicLevel | null, fx: MusicFx | null) =>
  lv && fx ? Math.min(0.95, 0.6 * fx.vignette * lv.punch) : 0;

/** How saturated the footage is at this moment, as a multiplier: 1 between triggers, double as one lands at 100%. */
export const saturationBoost = (lv: MusicLevel | null, fx: MusicFx | null) =>
  lv && fx ? 1 + fx.saturation * lv.punch : 1;

/**
 * The vignette over the footage's `box` at `alpha`: clear in the middle, darkening from a quarter of the way out and
 * black at the corners. The same shape as the preview's CSS `radial-gradient(ellipse, transparent 25%, rgba(0,0,0,.7)
 * 65%, black)`, whose ellipse reaches the corners.
 */
export function drawVignette(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, alpha: number) {
  if (alpha <= 0.005) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
  ctx.scale(box.w / 2, box.h / 2);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.SQRT2);
  g.addColorStop(0.25, 'rgba(0,0,0,0)');
  g.addColorStop(0.65, 'rgba(0,0,0,0.7)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

/**
 * What the renderer needs: the levels at a log time (null where no music plays), and the effects to draw, each
 * switched-off one at strength 0.
 */
export interface MusicFx extends Omit<MusicReact, 'on' | 'enabled'> { at: (t: number) => MusicLevel | null }

/** Levels per second. */
const RATE = 100;
const FFT = 2048;
/** Band edges, Hz: kick and bass below 150, vocals and guitars to 2 kHz, hats and cymbals above. */
const BANDS = [[30, 150], [150, 2000], [2000, 10000]] as const;
/** At most one hit this often, s, so busy drums don't turn the pulse into a strobe. */
const HIT_GAP = 0.17;
/** Big hits: the strongest this share of them (at sensitivity 1). */
const BIG_SHARE = 0.25;
/** Drops: the next second against the four before it, at most one this often, s. */
const DROP_AFTER = 1, DROP_BEFORE = 4, DROP_GAP = 4;
/** A drop's flash lasts this many hit lengths (at least DROP_MIN s), so it reads as an event rather than a beat. */
const DROP_LENGTH = 4, DROP_MIN = 0.6;

/**
 * How sharply a band rises at each moment, with the mean and spread of the rises around it (the last and next half
 * second): a hit is a rise that stands out from its neighbours.
 */
interface Rises { flux: Float32Array; mean: Float32Array; sd: Float32Array }

export class MusicAnalysis {
  /** Hits found for each source and sensitivity asked for: their times (s) and how sharp each rise was. */
  private hitCache = new Map<string, { times: Float32Array; strength: Float32Array }>();
  /** The footage's triggers for each kind, source and sensitivity. */
  private triggerCache = new Map<string, Float32Array>();

  constructor(private bass: Float32Array, private mid: Float32Array, private treble: Float32Array,
              private rises: Record<'bass' | 'highs', Rises>) {}

  /** The levels `t` seconds into the song, eased between measurements; silence outside it. */
  at(t: number, hitBy: HitSource, sensitivity: number, hitLength: number, trigger: FootageTrigger): MusicLevel {
    const f = t * RATE, i = Math.floor(f), k = f - i, n = this.bass.length;
    if (i < 0 || i >= n - 1) return { bass: 0, mid: 0, treble: 0, hit: 0, punch: 0 };
    const lerp = (a: Float32Array) => a[i] + (a[i + 1] - a[i]) * k;
    const punchLength = trigger === 'drops' ? Math.max(DROP_MIN, hitLength * DROP_LENGTH) : hitLength;
    return {
      bass: lerp(this.bass), mid: lerp(this.mid), treble: lerp(this.treble),
      hit: since(this.hits(hitBy, sensitivity), t, hitLength),
      punch: since(this.triggers(trigger, hitBy, sensitivity), t, punchLength),
    };
  }

  /** Hits: rises in the chosen band (or either) well above the ones around them, at most one every HIT_GAP. */
  hits(hitBy: HitSource, sensitivity: number): Float32Array {
    return this.hitData(hitBy, sensitivity).times;
  }

  /** When the footage goes off: every hit, the strongest of them, or the drops (each landing on its nearest hit). */
  triggers(trigger: FootageTrigger, hitBy: HitSource, sensitivity: number): Float32Array {
    const key = trigger + ':' + hitBy + ':' + Math.round(sensitivity * 100);
    let out = this.triggerCache.get(key);
    if (out) return out;
    const { times, strength } = this.hitData(hitBy, sensitivity);
    if (trigger === 'hits') out = times;
    else if (trigger === 'big') {
      // The strongest share: more of them at a higher sensitivity.
      const sorted = Float32Array.from(strength).sort();
      const cut = sorted[Math.floor(sorted.length * (1 - Math.min(1, BIG_SHARE * sensitivity)))] ?? Infinity;
      out = times.filter((_, i) => strength[i] >= cut);
    } else out = this.drops(times, sensitivity);
    this.triggerCache.set(key, out);
    return out;
  }

  /**
   * Drops: where the song's loudness (bass and mids) over the next second jumps well above the four before, the
   * biggest jump within DROP_GAP either way, moved onto the first hit near it so it lands on the beat.
   */
  private drops(hits: Float32Array, sensitivity: number): Float32Array {
    const n = this.bass.length, sum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) sum[i + 1] = sum[i] + (this.bass[i] + this.mid[i]) / 2;
    const mean = (a: number, b: number) => (sum[Math.min(n, b)] - sum[Math.max(0, a)]) / Math.max(1, Math.min(n, b) - Math.max(0, a));
    const after = DROP_AFTER * RATE, before = DROP_BEFORE * RATE, gap = DROP_GAP * RATE;
    const jump = new Float32Array(n);
    for (let i = before; i < n - after; i++) jump[i] = mean(i, i + after) - mean(i - before, i);
    const floor = 0.15 / sensitivity, found: number[] = [];
    for (let i = before; i < n - after; i++) {
      if (jump[i] <= floor) continue;
      let biggest = true;
      for (let j = Math.max(0, i - gap); j < Math.min(n, i + gap) && biggest; j++) if (jump[j] > jump[i]) biggest = false;
      if (!biggest || (found.length && i / RATE - found[found.length - 1] < DROP_GAP)) continue;
      const t = i / RATE, near = hits.find(h => h >= t - 0.25 && h <= t + 0.5);
      found.push(near ?? t);
    }
    return Float32Array.from(found);
  }

  private hitData(hitBy: HitSource, sensitivity: number) {
    const key = hitBy + ':' + Math.round(sensitivity * 100);
    let data = this.hitCache.get(key);
    if (data) return data;
    const bands = hitBy === 'both' ? [this.rises.bass, this.rises.highs] : [this.rises[hitBy]];
    const n = this.bass.length, found: number[] = [], sharp: number[] = [];
    const spread = 1.5 / sensitivity, floor = 3 / sensitivity, gap = Math.round(HIT_GAP * RATE);
    const isHit = ({ flux, mean, sd }: Rises, i: number) =>
      flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] && flux[i] > floor && flux[i] > mean[i] + spread * sd[i];
    let last = -gap;
    for (let i = 1; i < n - 1; i++) {
      if (i - last >= gap && bands.some(b => isHit(b, i))) {
        found.push(i / RATE);
        sharp.push(Math.max(...bands.map(b => b.flux[i])));
        last = i;
      }
    }
    data = { times: Float32Array.from(found), strength: Float32Array.from(sharp) };
    this.hitCache.set(key, data);
    return data;
  }
}

/** The last of `times` at `t`: 1 as it lands, fading over `length`; 0 before the first or long after. */
function since(times: Float32Array, t: number, length: number) {
  let lo = 0, hi = times.length; // the first one after t
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid + 1; else hi = mid; }
  if (lo === 0) return 0;
  const gone = t - times[lo - 1];
  return gone > length * 6 ? 0 : Math.exp(-gone / length);
}

/** Measures a decoded song. Yields to the page now and then, so a long song doesn't freeze it. */
export async function analyzeMusic(audio: AudioBuffer): Promise<MusicAnalysis> {
  const rate = audio.sampleRate, hop = rate / RATE;
  const mono = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / audio.numberOfChannels;
  }

  const frames = Math.max(1, Math.floor(audio.length / hop));
  const db = BANDS.map(() => new Float32Array(frames));
  const bins = BANDS.map(([lo, hi]) => [Math.max(1, Math.round((lo * FFT) / rate)), Math.min(FFT / 2, Math.round((hi * FFT) / rate))]);
  const window = Float32Array.from({ length: FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT - 1)));
  const re = new Float32Array(FFT), im = new Float32Array(FFT);
  for (let f = 0; f < frames; f++) {
    // Centred on the moment it stands for.
    const from = Math.round(f * hop) - FFT / 2;
    for (let i = 0; i < FFT; i++) {
      const s = from + i;
      re[i] = s >= 0 && s < mono.length ? mono[s] * window[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    bins.forEach(([lo, hi], b) => {
      let e = 0;
      for (let i = lo; i < hi; i++) e += re[i] * re[i] + im[i] * im[i];
      db[b][f] = 10 * Math.log10(e / (hi - lo) + 1e-12);
    });
    if (f % 2000 === 1999) await new Promise(r => setTimeout(r));
  }

  const [bass, mid, treble] = db.map(normalise);
  return new MusicAnalysis(bass, mid, treble, { bass: rises(db[0]), highs: rises(db[2]) });
}

/** dB to 0..1 against the song's own range: quiet parts (10th percentile) at 0, its loudest (98th) at 1. */
function normalise(db: Float32Array): Float32Array {
  const sorted = Float32Array.from(db).sort();
  const lo = sorted[Math.floor(sorted.length * 0.1)], hi = sorted[Math.floor(sorted.length * 0.98)];
  const span = Math.max(6, hi - lo);
  return db.map(v => Math.min(1, Math.max(0, (v - lo) / span)));
}

/** How sharply a band rises at each moment (dB over 20 ms), with the mean and spread of the rises within half a second. */
function rises(db: Float32Array): Rises {
  const n = db.length, reach = RATE / 2;
  const flux = new Float32Array(n), mean = new Float32Array(n), sd = new Float32Array(n);
  for (let i = 2; i < n; i++) flux[i] = Math.max(0, db[i] - db[i - 2]);
  // Running sums over the window as it slides.
  let sum = 0, sq = 0, lo = 0, hi = 0;
  for (let i = 0; i < n; i++) {
    for (; hi < Math.min(n, i + reach); hi++) { sum += flux[hi]; sq += flux[hi] * flux[hi]; }
    for (; lo < Math.max(0, i - reach); lo++) { sum -= flux[lo]; sq -= flux[lo] * flux[lo]; }
    const count = hi - lo;
    mean[i] = sum / count;
    sd[i] = Math.sqrt(Math.max(0, sq / count - mean[i] * mean[i]));
  }
  return { flux, mean, sd };
}

/** In-place radix-2 FFT; `re.length` must be a power of two. */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

/** Layers for drawing the effects, kept between frames. */
const layers: Partial<Record<'hud' | 'glyphs' | 'tint' | 'fx', HTMLCanvasElement>> = {};
function layer(key: keyof typeof layers, W: number, H: number) {
  const c = (layers[key] ??= document.createElement('canvas'));
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  return { c, ctx };
}

/**
 * Draws a HUD with the music's effects onto `ctx`. `draw` paints the HUD onto a canvas, with panel backgrounds or
 * without (the colour fringes are only the text and icons, so the panels don't darken where the copies overlap).
 * `t` drives the tint's colour drift.
 */
export function drawReactive(ctx: CanvasRenderingContext2D, lv: MusicLevel, fx: MusicFx, t: number,
                             draw: (ctx: CanvasRenderingContext2D, panels: boolean) => void) {
  const { width: W, height: H } = ctx.canvas;
  const u = Math.min(W, H) / 1080;
  const hud = layer('hud', W, H);
  draw(hud.ctx, true);

  // Tint: the white text takes on a colour (drifting round the wheel, or a fixed one), as strong as its band.
  let src: HTMLCanvasElement = hud.c;
  const band = { bass: lv.bass, mid: lv.mid, treble: lv.treble, all: Math.max(lv.bass, lv.mid, lv.treble) }[fx.tintBy];
  const tint = Math.min(1, 0.7 * fx.tint * band ** 1.5);
  if (tint > 0.01) {
    const t2 = layer('tint', W, H);
    t2.ctx.drawImage(hud.c, 0, 0);
    tinted(t2.ctx, hud.c, fx.tintMode === 'fixed' ? fx.tintColor : `hsl(${(t * fx.tintSpeed) % 360}, 100%, 62%)`, tint, W, H);
    src = t2.c;
  }

  // Pulse: the whole HUD punches out from the centre on each hit.
  const scale = 1 + 0.03 * fx.pulse * lv.hit;
  const put = (img: HTMLCanvasElement, dx: number) => {
    ctx.save();
    ctx.translate(W / 2 + dx, H / 2);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -W / 2, -H / 2);
    ctx.restore();
  };

  ctx.clearRect(0, 0, W, H);
  // Split: two coloured copies of the text slide apart on each hit, under the HUD itself.
  const d = 10 * u * fx.split * lv.hit;
  if (d > 0.5 * u) {
    const glyphs = layer('glyphs', W, H);
    draw(glyphs.ctx, false);
    for (const [colour, dx] of [[fx.splitColors[0], -d], [fx.splitColors[1], d]] as const) {
      const c = layer('fx', W, H);
      c.ctx.drawImage(glyphs.c, 0, 0);
      tinted(c.ctx, glyphs.c, colour, 1, W, H);
      ctx.globalCompositeOperation = 'lighter';
      put(c.c, dx);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  put(src, 0);
}

/**
 * Multiplies what's on `ctx` by `colour` at `amount` (white takes the colour, black stays black), keeping `shape`'s
 * transparency.
 */
function tinted(ctx: CanvasRenderingContext2D, shape: HTMLCanvasElement, colour: string, amount: number, W: number, H: number) {
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = amount;
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(shape, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}
