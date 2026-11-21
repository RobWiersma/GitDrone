import { CameraTurn, rotate } from './camera-turn';

/**
 * Music-reactive OSD: the song is measured once (bass, mids, treble and the drums' hits, 100 times a second), and the
 * HUD pulses, splits into colour fringes and changes tint with it. Measured ahead of time rather than live, so the
 * preview and the finished video react identically, frame for frame.
 */

/**
 * The song at one moment, each 0..1: band loudness against the song's own range, the last hit fading (for the OSD), and
 * the last trigger fading (for the zoom and saturation), and the vignette's own: its last trigger fading, how many have
 * landed (so each one can look different), and how long ago the last one landed, s (Infinity before the first).
 */
export interface MusicLevel {
  bass: number; mid: number; treble: number; hit: number; punch: number;
  vigPunch: number; vigBeat: number; vigAge: number;
}

/**
 * What sets the footage off: every hit, only the strongest quarter of them, only the very biggest (a few a minute), or
 * only drops, where the song jumps up after a quieter stretch. Between triggers the footage is left alone.
 */
export type FootageTrigger = 'hits' | 'big' | 'huge' | 'drops';
const FOOTAGE_TRIGGERS = ['hits', 'big', 'huge', 'drops'] as const;
/** The band the tint follows. */
export type TintSource = 'bass' | 'mid' | 'treble' | 'all';

/** The effects, each with a strength and its own on/off. */
export type MusicEffect = 'pulse' | 'split' | 'tint' | 'particles' | 'spectrum' | 'road' | 'zoom' | 'vignette' | 'saturation' | 'rainbow';
export const MUSIC_EFFECTS: readonly MusicEffect[] = ['pulse', 'split', 'tint', 'particles', 'spectrum', 'road', 'zoom', 'vignette', 'saturation', 'rainbow'];

/** How the HUD and the footage react. Strengths are multipliers: 1 is the default, 0 as good as off. */
export interface MusicReact {
  on: boolean;
  /** Which effects are switched on; their strengths are kept while off. */
  enabled: Record<MusicEffect, boolean>;
  pulse: number;
  split: number;
  /** The two fringe colours, left and right. */
  splitColors: [string, string];
  /** What sets off the pulse and the split. */
  osdTrigger: FootageTrigger;
  tint: number;
  /** 'drift' cycles round the colour wheel at `tintSpeed` degrees a second; 'fixed' is always `tintColor`. */
  tintMode: 'drift' | 'fixed';
  tintColor: string;
  tintSpeed: number;
  tintBy: TintSource;
  /** Glowing sparks falling off the OSD's panels, more with the music and bursting on each hit, changing colour as they fall. */
  particles: number;
  /** How big the sparks are, as a multiple of the smallest (1). */
  sparkSize: number;
  /** Spectrum analyser bars standing on the OSD's text, swinging with the gyro: how tall. */
  spectrum: number;
  /** How they look: classic analyser bars, or star streaks flying out from the middle as if jumping to light speed. */
  spectrumStyle: 'bars' | 'lightspeed';
  /** Which way the light-speed streaks trail off the text: back towards the middle, or out towards the edges. */
  streakDirection: 'in' | 'out';
  /** Their colour: white-hot and blue, or a rainbow that turns with the music. */
  streakColor: 'white' | 'rainbow';
  /** A rainbow road laid along where the craft is about to fly, from the gyro and the GPS speed: how bright. */
  road: number;
  /**
   * How far below the middle of the picture the craft is heading, degrees: with the camera tilted up, forward flight
   * heads below the middle, so the road lines up with where the footage is really going.
   */
  roadAim: number;
  /** How far ahead the road reaches, s of flight. */
  roadLength: number;
  /** What it looks like: a glassy tube floating out ahead, or a pixel rainbow ribbon. */
  roadStyle: 'tube' | 'road';
  /** How long a hit takes to fade, s. */
  hitLength: number;
  /** How readily a sudden rise counts as a hit: higher catches softer ones. */
  sensitivity: number;
  /** The footage itself: zooming in on each hit, its edges darkening with the bass, and its colour swelling with it. */
  zoom: number;
  vignette: number;
  saturation: number;
  /** The saturation swell as is, or spinning the footage's colours once round the rainbow as it fades. */
  saturationStyle: 'plain' | 'rainbow';
  /** Rainbow bands sweeping across the footage with the music: how strong. */
  rainbow: number;
  /** What sets off the zoom and saturation. */
  footageTrigger: FootageTrigger;
  /** What sets off the vignette: rarer by default, so it lands as an event. */
  vignetteTrigger: FootageTrigger;
}

export const MUSIC_REACT_DEFAULTS: MusicReact = {
  on: false, enabled: { pulse: true, split: true, tint: true, particles: true, spectrum: false, road: false, zoom: true, vignette: true, saturation: true, rainbow: false }, pulse: 1, split: 1, splitColors: ['#ff2a55', '#22e4ff'], osdTrigger: 'hits',
  tint: 1, tintMode: 'drift', tintColor: '#ff4fd8', tintSpeed: 24, tintBy: 'bass', particles: 1, sparkSize: 1.6, spectrum: 1, spectrumStyle: 'lightspeed', streakDirection: 'in', streakColor: 'white', road: 1, roadAim: 12, roadLength: 0.5, roadStyle: 'tube', hitLength: 0.14, sensitivity: 1,
  zoom: 1, vignette: 1, saturation: 1, saturationStyle: 'plain', rainbow: 1, footageTrigger: 'big', vignetteTrigger: 'huge',
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
    pulse: num('pulse', 0, 2), split: num('split', 0, 2), tint: num('tint', 0, 2), particles: num('particles', 0, 2), sparkSize: num('sparkSize', 0.5, 4), spectrum: num('spectrum', 0, 2), spectrumStyle: pick(s['spectrumStyle'], ['bars', 'lightspeed'] as const, d.spectrumStyle),
    streakDirection: pick(s['streakDirection'], ['in', 'out'] as const, d.streakDirection),
    streakColor: pick(s['streakColor'], ['white', 'rainbow'] as const, d.streakColor),
    splitColors: [colour(pair[0], d.splitColors[0]), colour(pair[1], d.splitColors[1])],
    osdTrigger: pick(s['osdTrigger'], FOOTAGE_TRIGGERS, d.osdTrigger),
    tintMode: pick(s['tintMode'], ['drift', 'fixed'] as const, d.tintMode),
    tintColor: colour(s['tintColor'], d.tintColor), tintSpeed: num('tintSpeed', 0, 180),
    tintBy: pick(s['tintBy'], ['bass', 'mid', 'treble', 'all'] as const, d.tintBy),
    hitLength: num('hitLength', 0.05, 0.5), sensitivity: num('sensitivity', 0.5, 2),
    zoom: num('zoom', 0, 2), vignette: num('vignette', 0, 2), saturation: num('saturation', 0, 2),
    saturationStyle: pick(s['saturationStyle'], ['plain', 'rainbow'] as const, d.saturationStyle), rainbow: num('rainbow', 0, 2),
    road: num('road', 0, 2), roadAim: num('roadAim', 0, 40), roadLength: num('roadLength', 0.25, 4),
    roadStyle: pick(s['roadStyle'], ['tube', 'road'] as const, d.roadStyle),
    footageTrigger: pick(s['footageTrigger'], FOOTAGE_TRIGGERS, d.footageTrigger),
    vignetteTrigger: pick(s['vignetteTrigger'], FOOTAGE_TRIGGERS, d.vignetteTrigger),
  };
}

/** How much the footage zooms in at this moment: up to 4% as a trigger lands, at 100%. */
export const footagePunch = (lv: MusicLevel | null, fx: MusicFx | null) => (lv && fx ? 1 + 0.04 * fx.zoom * lv.punch : 1);

/**
 * How far the vignette's mosaic reaches in at this moment, 0..0.95: none between triggers, 0.6 as one lands at 100%.
 * It punches in from the edges over the first VIGNETTE_ATTACK s, overshooting a little before it settles, then pulls
 * back out over VIGNETTE_RELEASE hit lengths and is gone completely, so the footage is clean between punches.
 */
export function vignetteLevel(lv: MusicLevel | null, fx: MusicFx | null) {
  if (!lv || !fx || !(lv.vigPunch > 0)) return 0;
  const out = (lv.vigAge - VIGNETTE_ATTACK) / (punchLength(fx.vignetteTrigger, fx.hitLength) * VIGNETTE_RELEASE);
  const env = lv.vigAge < VIGNETTE_ATTACK ? punchIn(lv.vigAge / VIGNETTE_ATTACK) : out >= 1 ? 0 : (1 - out) * (1 - out);
  return Math.min(0.95, 0.6 * fx.vignette * env);
}

/** How long the vignette takes to slam in, s. */
const VIGNETTE_ATTACK = 0.15;
/** How long it takes to pull back out, in hit lengths (about half a second at the default 0.14 s). */
const VIGNETTE_RELEASE = 3.5;
/** 0 to 1 over x = 0..1, overshooting to about 1.1 on the way (an ease-out-back), then 1. */
function punchIn(x: number) {
  if (!(x < 1)) return 1;
  if (x <= 0) return 0;
  const c = 1.4, u = x - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

/** How saturated the footage is at this moment, as a multiplier: 1 between triggers, double as one lands at 100%. */
export const saturationBoost = (lv: MusicLevel | null, fx: MusicFx | null) =>
  lv && fx ? 1 + fx.saturation * lv.punch * (fx.saturationStyle === 'rainbow' ? RAINBOW_SATURATION : 1) : 1;

/** The rainbow swell is this much more saturated than the plain one, so its colours pop as they spin. */
const RAINBOW_SATURATION = 1.5;
/** The rainbow's spin is all the way round once the swell is down to this. */
const RAINBOW_GONE = 0.01;

/**
 * With the rainbow swell, how far the footage's colours are turned round the colour wheel at this moment, degrees: once
 * all the way round as each trigger fades (from where they are as it lands, back to them as it's gone, so nothing
 * jumps), at an even pace through the fade. 0 otherwise.
 */
export function saturationHue(lv: MusicLevel | null, fx: MusicFx | null) {
  if (!lv || !fx || fx.saturationStyle !== 'rainbow' || !(fx.saturation > 0) || lv.punch <= 0.001) return 0;
  // The swell fades away exponentially; by its log, the spin goes round at an even pace until it's all but gone.
  const x = Math.min(1, Math.max(0, Math.log(Math.min(1, lv.punch)) / Math.log(RAINBOW_GONE))), eased = x * x * (3 - 2 * x);
  return eased * 360;
}

/** The music's colour on the footage as a CSS filter: its saturation swell, and with the rainbow, its colours turned. */
export function footageColourFilter(lv: MusicLevel | null, fx: MusicFx | null) {
  const k = saturationBoost(lv, fx), hue = saturationHue(lv, fx);
  if (k === 1 && hue === 0) return null;
  return `saturate(${(k * 100).toFixed(1)}%)` + (hue ? ` hue-rotate(${hue.toFixed(1)}deg)` : '');
}

/** The rainbow tint's bands run across the picture at this angle (CSS's: 0 points up, clockwise). */
export const RAINBOW_ANGLE = 115;
/** How many times round the colour wheel across the picture, how fast it turns (degrees a second), and how far the bass pushes it. */
const TINT_WHEELS = 1.5, TINT_DRIFT = 36, TINT_BASS = 90;

/**
 * The rainbow tint `out` s into the finished video: how strongly the footage takes on the bands' colours (they replace
 * its hue and keep its light and dark), stronger as the song gets louder and on each trigger, and where the wheel has
 * turned to, degrees. Null when it's off.
 */
export function rainbowTint(lv: MusicLevel | null, fx: MusicFx | null, out: number | null): { alpha: number; turn: number } | null {
  if (!lv || !fx || !(fx.rainbow > 0) || out === null) return null;
  const energy = (lv.bass + lv.mid + lv.treble) / 3;
  const alpha = Math.min(0.85, fx.rainbow * (0.18 + 0.32 * energy + 0.3 * lv.punch));
  return alpha > 0.005 ? { alpha, turn: (out * TINT_DRIFT + lv.bass * TINT_BASS) % 360 } : null;
}

/** The tint's colours along its gradient: [offset 0..1, colour]. */
export function rainbowStops(turn: number): [number, string][] {
  const n = 12;
  return Array.from({ length: n + 1 }, (_, i) => [i / n, `hsl(${((turn + (i / n) * 360 * TINT_WHEELS) % 360).toFixed(1)}, 100%, 55%)`]);
}

/** CSS for the tint's gradient over a box. */
export const rainbowCss = (turn: number) =>
  `linear-gradient(${RAINBOW_ANGLE}deg, ${rainbowStops(turn).map(([o, c]) => `${c} ${(o * 100).toFixed(1)}%`).join(', ')})`;

/** Paints the tint over `box` on a canvas, exactly as the CSS gradient lays it out (same line, same stops). */
export function drawRainbowTint(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number },
                                tint: { alpha: number; turn: number }) {
  const a = RAINBOW_ANGLE * (Math.PI / 180), dx = Math.sin(a), dy = -Math.cos(a);
  const half = (Math.abs(box.w * dx) + Math.abs(box.h * dy)) / 2, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const grad = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  for (const [o, c] of rainbowStops(tint.turn)) grad.addColorStop(o, c);
  ctx.save();
  ctx.globalCompositeOperation = 'color';
  ctx.globalAlpha = tint.alpha;
  ctx.fillStyle = grad;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.restore();
}

type Box = { x: number; y: number; w: number; h: number };
/** The vignette's smallest blocks across the picture. */
const MOSAIC_COLS = 96;
/**
 * Its block sizes, in smallest blocks, biggest first, and how far into the band of blocks (as a share of its depth) a
 * block's middle must sit to be drawn that big: huge at the edges, breaking down into smaller ones toward the middle.
 */
const MOSAIC_LEVELS = [4, 2, 1], MOSAIC_DEPTH = [0.45, 0.18, -Infinity];
const canvases = new Map<string, HTMLCanvasElement>();
/** A scratch canvas kept between frames, sized `w`×`h`. */
export function scratch(name: string, w: number, h: number) {
  let c = canvases.get(name);
  if (!c) canvases.set(name, (c = document.createElement('canvas')));
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  return c;
}

/** A repeatable 0..1 from a cell and a seed. */
function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise about six blocks across, so the vignette's edge comes in lumps rather than speckles. */
function lumps(x: number, y: number, seed: number) {
  const gx = x / 6, gy = y / 6, ix = Math.floor(gx), iy = Math.floor(gy);
  const sx = (gx - ix) * (gx - ix) * (3 - 2 * (gx - ix)), sy = (gy - iy) * (gy - iy) * (3 - 2 * (gy - iy));
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * The music's vignette as a mosaic: `src`'s `box` shrunk to big blocks of its own colour, kept only around the edges.
 * The edge is lumpy and off-centre, and both change with `seed` (each trigger), so no two hits look the same. A
 * stronger `alpha` (0..0.95, from vignetteLevel) pushes the blocks further in. Leaves `out` at the mosaic's size, to be
 * stretched over the picture without smoothing; false (and `out` untouched) when there's nothing to draw.
 *
 * It all happens on the GPU: the footage is only ever drawn smaller and bigger, never read back, since reading even a
 * few pixels makes the GPU finish everything queued first and stalls a render on every frame the vignette shows. Only
 * the masks, which depend on the trigger and strength and not the picture, are worked out here and sent up.
 */
export function vignetteMosaic(src: CanvasImageSource, box: Box, out: HTMLCanvasElement, alpha: number, seed: number) {
  if (alpha <= 0.005 || box.w <= 0 || box.h <= 0) return false;
  const cols = MOSAIC_COLS, rows = Math.max(8, Math.round((cols * box.h) / box.w / 8) * 8);
  const L = MOSAIC_LEVELS.length;
  // The footage averaged at each block size: the full grid from the frame, then each half the size of the one before.
  const sizes: HTMLCanvasElement[] = [];
  for (let l = L - 1; l >= 0; l--) {
    const f = MOSAIC_LEVELS[l], c = scratch(`level${f}`, cols / f, rows / f), g = c.getContext('2d');
    if (!g) return false;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.clearRect(0, 0, c.width, c.height);
    if (l === L - 1) g.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
    else g.drawImage(sizes[l + 1], 0, 0, c.width, c.height);
    sizes[l] = c;
  }
  // Where each block size shows, and how much darker it goes, worked out per cell of the full grid.
  const masks = MOSAIC_LEVELS.map(() => new ImageData(cols, rows)), shade = new ImageData(cols, rows);
  // 0 between triggers, 1 at the strongest (100% vignette as a trigger lands).
  const k = Math.min(1, alpha / 0.6), reach = 1 - 0.65 * Math.pow(k, 0.4), solid = Math.min(1, 3 * k);
  const ox = (hash(1, 2, seed) - 0.5) * 0.4, oy = (hash(3, 4, seed) - 0.5) * 0.4;
  // How deep the band of blocks runs, so even a light vignette goes from big blocks at the edge to small ones.
  const band = 1.2 - reach;
  /** How far past the vignette's reach a point of the grid sits (negative inside it): lumpy and off-centre. */
  const past = (x: number, y: number) => {
    const nx = (x / cols - 0.5) * 2 - ox, ny = (y / rows - 0.5) * 2 - oy;
    return Math.hypot(nx, ny) / Math.SQRT2 + 0.45 * (lumps(x / 2, y / 2, seed) - 0.5) + 0.1 * (hash(x | 0, y | 0, seed) - 0.5) - reach;
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // The biggest block this cell's in whose middle is far enough out for that size; the full grid otherwise.
      let level = L - 1, d = 0;
      for (let l = 0; l < L; l++) {
        const f = MOSAIC_LEVELS[l];
        d = past((Math.floor(x / f) + 0.5) * f, (Math.floor(y / f) + 0.5) * f);
        if (d > MOSAIC_DEPTH[l] * band) { level = l; break; }
      }
      const m = Math.max(0, Math.min(1, d / 0.1)), i = (y * cols + x) * 4;
      masks[level].data[i + 3] = 255 * m * solid;
      // Its own colour, a little deeper the further out it sits.
      shade.data[i + 3] = 255 * 0.3 * m;
    }
  }
  if (out.width !== cols) out.width = cols;
  if (out.height !== rows) out.height = rows;
  const c = out.getContext('2d'), layer = scratch('layer', cols, rows), lg = layer.getContext('2d');
  const mask = scratch('mask', cols, rows), mg = mask.getContext('2d');
  if (!c || !lg || !mg) return false;
  c.clearRect(0, 0, cols, rows);
  c.imageSmoothingEnabled = lg.imageSmoothingEnabled = false;
  for (let l = 0; l < L; l++) {
    // This size's blocks, blown up with hard edges and cut to its cells.
    mg.putImageData(masks[l], 0, 0);
    lg.globalCompositeOperation = 'copy';
    lg.drawImage(mask, 0, 0);
    lg.globalCompositeOperation = 'source-in';
    lg.drawImage(sizes[l], 0, 0, cols, rows);
    c.drawImage(layer, 0, 0);
  }
  mg.putImageData(shade, 0, 0);
  c.globalCompositeOperation = 'source-atop';
  c.drawImage(mask, 0, 0);
  c.globalCompositeOperation = 'source-over';
  return true;
}

let mosaic: HTMLCanvasElement | null = null;
/** The vignette mosaic over the footage already drawn in `box` on `ctx`. */
export function drawVignette(ctx: CanvasRenderingContext2D, box: Box, alpha: number, seed: number) {
  mosaic ??= document.createElement('canvas');
  if (!vignetteMosaic(ctx.canvas, box, mosaic, alpha, seed)) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(mosaic, box.x, box.y, box.w, box.h);
  ctx.restore();
}

/**
 * What the renderer needs: the levels at a log time (null where no music plays), and the effects to draw, each
 * switched-off one at strength 0.
 */
export interface MusicFx extends Omit<MusicReact, 'on' | 'enabled'> {
  /** The levels at log time `t`, where it plays in the finished video; null where it doesn't. */
  at: (t: number) => MusicLevel | null;
  /** The levels `out` s into the finished video: what an auto-edit, whose log time jumps at each cut, follows. */
  atOut: (out: number) => MusicLevel | null;
  /**
   * The song's spectrum `out` s into the finished video (SPECTRUM_BANDS bands, bass first, each 0..1) into `into`;
   * false where no music plays.
   */
  spectrumOut: (out: number, into: Float32Array) => boolean;
  /** Seconds into the finished video at log time `t` (null where it isn't shown): the clock the sparks run on. */
  outAt: (t: number) => number | null;
}

/** Levels per second. */
const RATE = 100;
const FFT = 2048;
/** Band edges, Hz: kick and bass below 150, vocals and guitars to 2 kHz, hats and cymbals above. */
const BANDS = [[30, 150], [150, 2000], [2000, 10000]] as const;
/** The spectrum bars' bands: this many, spaced evenly in pitch (log frequency) from SPECTRUM_LOW to SPECTRUM_HIGH Hz. */
export const SPECTRUM_BANDS = 24;
const SPECTRUM_LOW = 40, SPECTRUM_HIGH = 14000;
/** At most one hit this often, s, so busy drums don't turn the pulse into a strobe. */
const HIT_GAP = 0.17;
/** Big hits: the strongest this share of them (at sensitivity 1). */
const BIG_SHARE = 0.25;
/** The biggest hits: the strongest this share (at sensitivity 1), at most one this often, s. */
const HUGE_SHARE = 0.06, HUGE_GAP = 1.5;
/** How long a trigger of this kind takes to fade, s: drops last longer, so they read as events rather than beats. */
const punchLength = (trigger: FootageTrigger, hitLength: number) =>
  trigger === 'drops' ? Math.max(DROP_MIN, hitLength * DROP_LENGTH) : hitLength;
/** Drops: the next second against the four before it, at most one this often, s. */
const DROP_AFTER = 1, DROP_BEFORE = 4, DROP_GAP = 4;
/** A drop's flash lasts this many hit lengths (at least DROP_MIN s), so it reads as an event rather than a beat. */
const DROP_LENGTH = 4, DROP_MIN = 0.6;

/**
 * How sharply a band rises at each moment, with the mean and spread of the rises around it (the last and next half
 * second): a hit is a rise that stands out from its neighbours.
 */
interface Rises { flux: Float32Array; mean: Float32Array; sd: Float32Array }

/** The song's beat: every beat (s into the song), which of each four starts a bar (`bar`, 0-3), and the beat's length (s). */
export interface BeatGrid { beats: Float32Array; bar: number; period: number }

export class MusicAnalysis {
  /** Hits found for each source and sensitivity asked for: their times (s) and how sharp each rise was. */
  private hitCache = new Map<string, { times: Float32Array; strength: Float32Array }>();
  /** The footage's triggers for each kind, source and sensitivity. */
  private triggerCache = new Map<string, Float32Array>();

  constructor(private bass: Float32Array, private mid: Float32Array, private treble: Float32Array,
              private rises: Record<'bass' | 'highs', Rises>, private spectrum: Float32Array[] = []) {}

  /** The spectrum `t` s into the song (each band 0..1 against its own range, eased) into `into`; false outside it. */
  spectrumAt(t: number, into: Float32Array): boolean {
    const f = t * RATE, i = Math.floor(f), k = f - i, n = this.bass.length;
    if (i < 0 || i >= n - 1 || !this.spectrum.length) return false;
    for (let b = 0; b < into.length; b++) {
      const a = this.spectrum[b];
      into[b] = a ? a[i] + (a[i + 1] - a[i]) * k : 0;
    }
    return true;
  }

  /** The levels `t` seconds into the song, eased between measurements; silence outside it. */
  at(t: number, sensitivity: number, hitLength: number,
     { osd, footage: trigger, vignette: vignetteTrigger }: Record<'osd' | 'footage' | 'vignette', FootageTrigger>): MusicLevel {
    const f = t * RATE, i = Math.floor(f), k = f - i, n = this.bass.length;
    if (i < 0 || i >= n - 1) return { bass: 0, mid: 0, treble: 0, hit: 0, punch: 0, vigPunch: 0, vigBeat: 0, vigAge: Infinity };
    const lerp = (a: Float32Array) => a[i] + (a[i + 1] - a[i]) * k;
    const vig = this.triggers(vignetteTrigger, sensitivity), vigBeat = landed(vig, t);
    return {
      bass: lerp(this.bass), mid: lerp(this.mid), treble: lerp(this.treble),
      hit: since(this.triggers(osd, sensitivity), t, punchLength(osd, hitLength)),
      punch: since(this.triggers(trigger, sensitivity), t, punchLength(trigger, hitLength)),
      vigPunch: since(vig, t, punchLength(vignetteTrigger, hitLength)),
      vigBeat, vigAge: vigBeat ? t - vig[vigBeat - 1] : Infinity,
    };
  }

  /** Hits: rises in the bass or the highs well above the ones around them, at most one every HIT_GAP. */
  hits(sensitivity: number): Float32Array {
    return this.hitData(sensitivity).times;
  }

  /** When the footage goes off: every hit, the strongest of them, or the drops (each landing on its nearest hit). */
  triggers(trigger: FootageTrigger, sensitivity: number): Float32Array {
    const key = trigger + ':' + Math.round(sensitivity * 100);
    let out = this.triggerCache.get(key);
    if (out) return out;
    const { times, strength } = this.hitData(sensitivity);
    if (trigger === 'hits') out = times;
    else if (trigger === 'big') {
      // The strongest share: more of them at a higher sensitivity.
      const sorted = Float32Array.from(strength).sort();
      const cut = sorted[Math.floor(sorted.length * (1 - Math.min(1, BIG_SHARE * sensitivity)))] ?? Infinity;
      out = times.filter((_, i) => strength[i] >= cut);
    } else if (trigger === 'huge') {
      // The very strongest, loudest first, each keeping the others HUGE_GAP away, so they stay rare and spread out.
      const order = Array.from(times.keys()).sort((a, b) => strength[b] - strength[a]);
      const kept: number[] = [], want = Math.max(1, Math.round(times.length * Math.min(1, HUGE_SHARE * sensitivity)));
      for (const i of order) {
        if (kept.length >= want) break;
        if (kept.every(t => Math.abs(t - times[i]) >= HUGE_GAP)) kept.push(times[i]);
      }
      out = Float32Array.from(kept.sort((a, b) => a - b));
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

  private grid: BeatGrid | null = null;
  /**
   * The song's beat: its tempo from how its onsets (sudden bass and highs) repeat, then each beat placed on the
   * strongest onsets while keeping that tempo (a dynamic-programming beat tracker, after Ellis 2007), and which beat
   * of each four starts a bar (the one the kicks land on most). Cutting on these, rather than on loud moments, is what
   * makes an edit feel on the music.
   */
  beats(): BeatGrid {
    if (this.grid) return this.grid;
    const n = this.bass.length, b = this.rises.bass, h = this.rises.highs;
    // How much is starting at each moment, above what's usual around it.
    const onset = new Float32Array(n);
    for (let i = 0; i < n; i++) onset[i] = Math.max(0, b.flux[i] - b.mean[i]) + Math.max(0, h.flux[i] - h.mean[i]);
    let sd = 0;
    for (let i = 0; i < n; i++) sd += onset[i] * onset[i];
    sd = Math.sqrt(sd / Math.max(1, n)) || 1;
    for (let i = 0; i < n; i++) onset[i] /= sd;

    // The tempo: the lag at which the onsets line up with themselves best, between 70 and 180 BPM, leaning to 120.
    const lo = Math.floor((60 / 180) * RATE), hi = Math.ceil((60 / 70) * RATE);
    const score = new Float64Array(hi + 2);
    for (let lag = lo - 1; lag <= hi + 1; lag++) {
      let s = 0;
      for (let i = lag; i < n; i++) s += onset[i] * onset[i - lag];
      const bpm = (60 * RATE) / lag;
      score[lag] = (s / (n - lag)) * Math.exp(-0.5 * (Math.log2(bpm / 120) / 1) ** 2);
    }
    let best = lo;
    for (let lag = lo; lag <= hi; lag++) if (score[lag] > score[best]) best = lag;
    // Between whole samples, from the peak's neighbours.
    const a = score[best - 1], c = score[best + 1], denom = a - 2 * score[best] + c;
    const period = best + (denom < 0 ? (0.5 * (a - c)) / denom : 0);

    // The beats: each moment's best total of onsets with the last beat about a period back, steady tempo rewarded.
    const total = new Float64Array(n), back = new Int32Array(n).fill(-1), tight = 100;
    for (let i = 0; i < n; i++) {
      let top = 0, from = -1;
      for (let j = Math.max(0, Math.round(i - 2 * period)); j <= i - Math.round(period / 2); j++) {
        const s = total[j] - tight * Math.log((i - j) / period) ** 2;
        if (from < 0 || s > top) { top = s; from = j; }
      }
      total[i] = onset[i] + (from >= 0 ? Math.max(0, top) : 0);
      back[i] = from >= 0 && top > 0 ? from : -1;
    }
    let end = n - 1;
    for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (total[i] > total[end]) end = i;
    const found: number[] = [];
    for (let i = end; i >= 0; i = back[i]) found.push(i / RATE);
    const beats = Float32Array.from(found.reverse());

    // The bar: of each four beats, the one with the most bass landing on it.
    const kick = [0, 0, 0, 0];
    beats.forEach((t, k) => {
      const i = Math.round(t * RATE);
      let m = 0;
      for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) m = Math.max(m, b.flux[j]);
      kick[k % 4] += m;
    });
    const bar = kick.indexOf(Math.max(...kick));
    return (this.grid = { beats, bar, period: period / RATE });
  }

  private hitData(sensitivity: number) {
    const key = String(Math.round(sensitivity * 100));
    let data = this.hitCache.get(key);
    if (data) return data;
    const bands = [this.rises.bass, this.rises.highs];
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
  const lo = landed(times, t);
  if (lo === 0) return 0;
  const gone = t - times[lo - 1];
  return gone > length * 6 ? 0 : Math.exp(-gone / length);
}

/** How many of `times` have landed by `t`. */
function landed(times: Float32Array, t: number) {
  let lo = 0, hi = times.length; // the first one after t
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid + 1; else hi = mid; }
  return lo;
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
  const edges = Array.from({ length: SPECTRUM_BANDS + 1 }, (_, b) => SPECTRUM_LOW * (SPECTRUM_HIGH / SPECTRUM_LOW) ** (b / SPECTRUM_BANDS));
  const spectrumBins = edges.slice(0, -1).map((lo, b) => {
    const a = Math.max(1, Math.round((lo * FFT) / rate));
    return [a, Math.max(a + 1, Math.min(FFT / 2, Math.round((edges[b + 1] * FFT) / rate)))];
  });
  const spectrum = spectrumBins.map(() => new Float32Array(frames));
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
    spectrumBins.forEach(([lo, hi], b) => {
      let e = 0;
      for (let i = lo; i < hi; i++) e += re[i] * re[i] + im[i] * im[i];
      spectrum[b][f] = 10 * Math.log10(e / (hi - lo) + 1e-12);
    });
    if (f % 2000 === 1999) await new Promise(r => setTimeout(r));
  }

  const [bass, mid, treble] = db.map(normalise);
  return new MusicAnalysis(bass, mid, treble, { bass: rises(db[0]), highs: rises(db[2]) }, spectrum.map(normalise));
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
                             draw: (ctx: CanvasRenderingContext2D, panels: boolean) => void,
                             sparks: ((t: number) => SparkMask | null) | null = null,
                             motion: CraftMotion = { turn: null, speed: null }) {
  const turn = motion.turn;
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
  const out = fx.outAt(t);
  // The rainbow road, out in the footage, under everything of the HUD's.
  if (fx.road > 0 && out !== null) drawRoad(ctx, fx, lv, t, out, motion);
  // The spectrum bars stand on the text, behind the HUD, so a line's bars never cover the text above it.
  if (fx.spectrum > 0 && out !== null && sparks) {
    const mask = sparks(t);
    if (mask) {
      // Pulsing with the HUD they stand on.
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(scale, scale);
      ctx.translate(-W / 2, -H / 2);
      drawSpectrum(ctx, fx, t, out, mask, u, motion);
      ctx.restore();
    }
  }
  put(src, 0);
  if (fx.particles > 0 && out !== null && sparks) drawParticles(ctx, fx, t, out, sparks, u, turn);
}

/**
 * The rainbow road, a magic pointer to where the craft's going: from ROAD_FROM s ahead to its length (in ROAD_STEPS
 * steps a second), a ribbon ROAD_WIDTH m wide in ROAD_LANES colours, ROAD_DROP m under where the craft will be. Its
 * stripes are ROAD_STRIPE m long, fixed to the ground, so they stream past as the craft flies down it. It's drawn in
 * chunky pixels, ROAD_PIXEL across at 1080p.
 */
const ROAD_FROM = 0.06, ROAD_STEPS = 28, ROAD_WIDTH = 1.6, ROAD_LANES = 7, ROAD_DROP = 0.8, ROAD_STRIPE = 1.5;
const ROAD_PIXEL = 12;
/** The times ahead the road's rows are laid at, s, for a road from `from` to `length` s ahead. */
function roadMarks(length: number, from: number) {
  const steps = Math.max(8, Math.min(60, Math.round(ROAD_STEPS * (length - from))));
  return Array.from({ length: steps + 1 }, (_, k) => from + (k / steps) * (length - from));
}
/**
 * Its near end is pinned to the bottom of the picture, ROAD_FOOT of the picture's width across, and sweeps from there
 * into the path over its first ROAD_SWEEP rows, tapering (by ROAD_TAPER at its end) to a point.
 */
const ROAD_FOOT = 0.3, ROAD_SWEEP = 6, ROAD_TAPER = 0.9;
/**
 * The tube: TUBE_WIDTH m across, with a ripple TUBE_RIPPLE of its width deep every TUBE_WAVE m along the ground (so it
 * streams past), its ends rounded. It's shaded in TUBE_BANDS bands across, then softened by TUBE_SOFT px (at 1080p).
 */
const TUBE_WIDTH = 1, TUBE_RIPPLE = 0.12, TUBE_WAVE = 1.4, TUBE_BANDS = 24, TUBE_SOFT = 1.2;
/** The tube floats out ahead: it starts TUBE_FROM s ahead, and reaches at least TUBE_MIN s further. */
const TUBE_FROM = 0.25, TUBE_MIN = 0.25;
/** How far the bottom end follows the path across the picture (1: all the way to under it). */
const ROAD_SLIDE = 0.7;
/** How far off the lens's middle (deg) the road is still drawn: a bit past the picture's edge, not behind the camera. */
const ROAD_EDGE = 115;
/**
 * The road's only there while the craft's flying: the throttle above ROAD_IDLE some time in the last ROAD_GROUNDED s (a
 * flip or a dive drops it to idle for a moment), and with GPS, moving at least ROAD_STILL m/s (sitting armed, or
 * hovering, there's no road to fly). It comes and goes over ROAD_FADE s.
 */
const ROAD_IDLE = 1050, ROAD_GROUNDED = 1.5, ROAD_STILL = 1.5, ROAD_FADE = 0.5;
/**
 * Its ends break up into random pixels rather than stopping on a straight edge: blocks drop out from ROAD_DISSOLVE_FAR
 * of the way along to none left at its far end, and a few at its near end (down to ROAD_DISSOLVE_NEAR kept right at the
 * edge, all by ROAD_NEAR_SPAN along). The pattern changes ROAD_TWINKLE times a second.
 */
const ROAD_DISSOLVE_FAR = 0.6, ROAD_DISSOLVE_NEAR = 0.45, ROAD_NEAR_SPAN = 0.08, ROAD_TWINKLE = 12;
/**
 * Magic dust: a sparkle every ROAD_SPARK_GAP m along the ground (so they stream past with the stripes), scattered up to
 * ROAD_SPARK_SPREAD of the ribbon's width either side of its middle, each lit about ROAD_SPARK_ON of the time, twinkling.
 */
const ROAD_SPARK_GAP = 0.3, ROAD_SPARK_SPREAD = 1.4, ROAD_SPARK_ON = 0.55;

/** How much of the road's pixels are kept at `u` of the way along it (its ends break up). */
function roadKeep(u: number) {
  return Math.max(0, Math.min(1, ROAD_DISSOLVE_NEAR + ((1 - ROAD_DISSOLVE_NEAR) * u) / ROAD_NEAR_SPAN, (1 - u) / (1 - ROAD_DISSOLVE_FAR)));
}
/** However the camera's pointed, the road climbs at least this far up the picture (a share of its height) by its end. */
const ROAD_RISE = 0.4;
/** ...and narrows into the distance like a road should: at its end at most ROAD_NARROW of its width at the bottom. */
const ROAD_NARROW = 0.25;
/**
 * The craft's momentum: which way it's going follows which way it's pointed, but lags it by ROAD_LAG s (a flip doesn't
 * swing its path round; it carries on). Worked out from ROAD_SETTLE s back, so the lag has caught up by now.
 */
const ROAD_LAG = 0.6, ROAD_SETTLE = 2, ROAD_DT = 0.05;
/** Without a GPS track, the speed to lay the road out at, m/s. */
const ROAD_SPEED = 15;
/** With the accelerometer, the road climbs and dives at most this steeply (deg) however the craft is pointed. */
const ROAD_STEEP = 35;

/** Read either side of now for the roll, s: through a flip the ground's direction swings fast and briefly ill-defined. */
const ROLL_SPREAD = [-0.04, -0.02, 0, 0.02, 0.04];

/**
 * How far the camera's rolled at log time `t`, radians (0 level, clockwise positive): the way the ground is across the
 * picture, averaged a moment either side, counting more where it's clearly across the picture (not dead ahead, looking
 * straight down). 0 without the accelerometer.
 */
function rollAt(motion: CraftMotion, t: number, aim: number) {
  let x = 0, y = 0;
  for (const dt of ROLL_SPREAD) {
    const d = downAt(motion, t + dt, aim);
    if (!d) return 0;
    const w = Math.hypot(d[0], d[1]) * (dt === 0 ? 2 : 1);
    x += d[0] * w; y += d[1] * w;
  }
  return Math.hypot(x, y) < 0.05 ? 0 : Math.atan2(x, y);
}

/**
 * Which way is down in the picture at log time `t`, by the gyro and accelerometer: the craft's down, tipped back by
 * `aim` (the camera looks up from the craft by as much as its path sits below the middle). Null without them.
 */
function downAt(motion: CraftMotion, t: number, aim: number): [number, number, number] | null {
  const d = motion.turn?.down(t);
  if (!d) return null;
  const cos = Math.cos(aim * RAD), sin = Math.sin(aim * RAD);
  return [d[0], d[1] * cos + d[2] * sin, d[2] * cos - d[1] * sin];
}

/** How far the craft has flown by each ROAD_DT s of the log, kept per speed source and filled in as far as needed. */
const flown = new WeakMap<(t: number) => number, number[]>();
function distanceFlown(speed: (t: number) => number, t: number) {
  let d = flown.get(speed);
  if (!d) flown.set(speed, (d = [0]));
  const k = Math.max(0, t / ROAD_DT);
  while (d.length <= Math.ceil(k)) { const i = d.length; d.push(d[i - 1] + Math.max(0, speed((i - 0.5) * ROAD_DT)) * ROAD_DT); }
  const i = Math.floor(k);
  return d[i] + (d[Math.min(d.length - 1, i + 1)] - d[i]) * (k - i);
}

/**
 * Where the craft will be over the next few seconds, in the camera's frame now (m: +x right, +y down, +z ahead), with
 * how far along each point is: the way it's heading (below the middle by `aim`) turned with the gyro and lagged by its
 * momentum, at its GPS speed.
 */
function flightAhead(motion: CraftMotion, t: number, aim: number, length: number, from = ROAD_FROM) {
  const times = roadMarks(length, from);
  const ahead: [number, number, number][] = [], along: number[] = [];
  const m: [number, number, number] = [0, Math.sin(aim * RAD), Math.cos(aim * RAD)];
  const speed = (s: number) => (motion.speed ? Math.max(0, motion.speed(s)) : ROAD_SPEED);
  const turn = motion.turn;
  // The gyro and a GPS track: where the craft really went next, turned into the picture.
  if (turn && motion.place) {
    const gps = trackAhead(turn, motion.place, t, aim, times);
    if (gps) return gps;
  }
  // No gyro but a GPS track: the track ahead, as seen flying the way it's going now (level, heading down the track).
  if (!turn && motion.place) {
    const gps = gpsAhead(motion.place, t, aim, times);
    if (gps) return gps;
  }
  if (!turn) {
    for (const s of times) {
      const d = speed(t) * s;
      ahead.push([m[0] * d, m[1] * d, m[2] * d]);
      along.push(d);
    }
    return { ahead, along };
  }
  // In the world's frame: the heading, lagging behind where the camera points, from a couple of seconds back.
  let h = turn.toWorld(t - ROAD_SETTLE, m);
  for (let s = t - ROAD_SETTLE; s < t; s += ROAD_DT) h = lag(h, turn.toWorld(s, m));
  // Knowing which way is down, the path can't climb or dive steeper than ROAD_STEEP (pointing the camera at the sky in
  // a flip doesn't send the craft up there).
  const down = downAt(motion, t, aim), dw = down ? turn.toWorld(t, down) : null, steep = Math.sin(ROAD_STEEP * RAD);
  const along3 = (v: [number, number, number]): [number, number, number] => {
    if (!dw) return v;
    const vd = v[0] * dw[0] + v[1] * dw[1] + v[2] * dw[2];
    if (Math.abs(vd) <= steep) return v;
    const fx = v[0] - vd * dw[0], fy = v[1] - vd * dw[1], fz = v[2] - vd * dw[2], fl = Math.hypot(fx, fy, fz);
    // Straight up or down: no way along the ground to keep, so just level.
    if (fl < 1e-3) return v;
    const c = Math.sqrt(1 - steep * steep) / fl, u = Math.sign(vd) * steep;
    return [fx * c + dw[0] * u, fy * c + dw[1] * u, fz * c + dw[2] * u];
  };
  let p: [number, number, number] = [0, 0, 0], d = 0, s = t;
  const marks = times.map(s => t + s);
  for (const mark of marks) {
    while (s < mark - 1e-6) {
      const dt = Math.min(ROAD_DT, mark - s), v = speed(s);
      h = lag(h, turn.toWorld(s, m), dt);
      const g = along3(h);
      p = [p[0] + g[0] * v * dt, p[1] + g[1] * v * dt, p[2] + g[2] * v * dt];
      d += v * dt;
      s += dt;
    }
    ahead.push(turn.toCamera(t, p));
    along.push(d);
  }
  return { ahead, along };
}

/**
 * The gyro knows how the camera turned but not which way north is (there's no compass in the log). Lined up with the GPS:
 * a quad mostly flies nose first, so over HEADING_WINDOW s either side, the way the GPS says it's going less the way the
 * camera (`aim` below its middle) points, both level, averaged by how fast it's flying (none under HEADING_SLOW m/s, in
 * full from twice that), is how far the gyro's world is turned from the map's. Worked out every HEADING_STEP s.
 */
const HEADING_WINDOW = 6, HEADING_SLOW = 4, HEADING_STEP = 0.25;
/** The GPS reports where the craft was about this long ago, s. */
const GPS_LATENCY = 0.1;
/** Below this, m/s, the track's too slow and noisy to lay the road along; the gyro's guess is used. */
const TRACK_SLOW = 4;

interface Heading { turn: CameraTurn; aim: number; at: (Float64Array | null) }
const headings = new WeakMap<object, Heading>();

/** Level directions in the gyro's world at log time `t`: up, and two across it (a, then b a quarter turn anticlockwise). */
function levelAxes(turn: CameraTurn, t: number) {
  const d = turn.down(t);
  if (!d) return null;
  const w = turn.toWorld(t, d), up = [-w[0], -w[1], -w[2]] as const;
  const ref = Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  const k = ref[0] * up[0] + ref[1] * up[1] + ref[2] * up[2];
  const ax = ref[0] - k * up[0], ay = ref[1] - k * up[1], az = ref[2] - k * up[2], al = Math.hypot(ax, ay, az);
  const a = [ax / al, ay / al, az / al] as const;
  const b = [up[1] * a[2] - up[2] * a[1], up[2] * a[0] - up[0] * a[2], up[0] * a[1] - up[1] * a[0]] as const;
  return { up, a, b };
}

const dot = (u: readonly number[], v: readonly number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];

/** How far the gyro's world is turned from the map's (radians, anticlockwise from above) every HEADING_STEP s; NaN unknown. */
function headingOffsets(turn: CameraTurn, place: (t: number) => [number, number, number] | null, aim: number) {
  const known = headings.get(place);
  if (known && known.turn === turn && known.aim === aim) return known.at;
  const m = [0, Math.sin(aim * RAD), Math.cos(aim * RAD)] as const;
  const sin: number[] = [], cos: number[] = [];
  // To the track's end (it may start late, and has no gaps the interpolation doesn't bridge).
  let last = -1;
  for (let s = 0; s < 4 * 3600; s += 1) if (place(s)) last = s;
  const end = last < 0 ? 0 : Math.floor((last + 1) / HEADING_STEP);
  for (let i = 0; i < end; i++) {
    const s = i * HEADING_STEP, p0 = place(s - 0.3 + GPS_LATENCY), p1 = place(s + 0.3 + GPS_LATENCY), ax = levelAxes(turn, s);
    let w = 0, x = 0;
    if (p0 && p1 && ax) {
      const ve = (p1[0] - p0[0]) / 0.6, vn = (p1[1] - p0[1]) / 0.6, v = Math.hypot(ve, vn);
      const f = turn.toWorld(s, m), fa = dot(f, ax.a), fb = dot(f, ax.b);
      w = Math.min(1, Math.max(0, (v - HEADING_SLOW) / HEADING_SLOW)) * Math.hypot(fa, fb);
      x = Math.atan2(vn, ve) - Math.atan2(fb, fa);
    }
    sin.push(w * Math.sin(x)); cos.push(w * Math.cos(x));
  }
  const at = new Float64Array(end).fill(NaN), span = Math.round(HEADING_WINDOW / HEADING_STEP);
  for (let i = 0; i < end; i++) {
    let ss = 0, cc = 0;
    for (let j = Math.max(0, i - span); j <= Math.min(end - 1, i + span); j++) { ss += sin[j]; cc += cos[j]; }
    if (Math.hypot(ss, cc) > 1.5) at[i] = Math.atan2(ss, cc);
  }
  headings.set(place, { turn, aim, at: end ? at : null });
  return end ? at : null;
}

/**
 * With the gyro and a GPS track: the road along where the craft really went next (so a yaw or a slide doesn't swing
 * it), turned from the map into the gyro's world by the heading offset, then into the picture as the camera is now.
 * Null when that can't be worked out (no accelerometer, hovering, off the track, or no fast flying nearby to line up).
 */
function trackAhead(turn: CameraTurn, place: (t: number) => [number, number, number] | null, t: number, aim: number,
  times: number[]) {
  const offsets = headingOffsets(turn, place, aim), ax = levelAxes(turn, t);
  if (!offsets || !ax) return null;
  const i = Math.round(t / HEADING_STEP), off = offsets[Math.min(offsets.length - 1, Math.max(0, i))];
  const here = place(t + GPS_LATENCY);
  if (Number.isNaN(off) || !here) return null;
  const ahead: [number, number, number][] = [], along: number[] = [];
  let last = here, d = 0;
  for (const s of times) {
    const p = place(t + GPS_LATENCY + s);
    if (!p) break;
    d += Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]);
    last = p;
    const qe = p[0] - here[0], qn = p[1] - here[1], qu = p[2] - here[2];
    const h = Math.hypot(qe, qn), ang = Math.atan2(qn, qe) - off, ca = Math.cos(ang), sa = Math.sin(ang);
    const w: [number, number, number] = [
      h * (ca * ax.a[0] + sa * ax.b[0]) + qu * ax.up[0],
      h * (ca * ax.a[1] + sa * ax.b[1]) + qu * ax.up[1],
      h * (ca * ax.a[2] + sa * ax.b[2]) + qu * ax.up[2],
    ];
    ahead.push(turn.toCamera(t, w));
    along.push(d);
  }
  // Too slow to tell which way it's going: the gyro's guess instead.
  return ahead.length > 2 && d / times[ahead.length - 1] >= TRACK_SLOW ? { ahead, along } : null;
}

/** How far either side of now the GPS track is read for the way the craft is heading, s (fixes are noisy). */
const GPS_HEADING = 0.5;

/**
 * Without a gyro, the road from the GPS track: where the craft will be over the next few seconds, turned so the way
 * it's flying now (along the track, level) is `aim` below the middle of the picture, with up as up. Its turns and climbs
 * bend the road; the camera is taken to be level. Null when the track can't say which way it's heading (hovering, or
 * off the track's ends).
 */
function gpsAhead(place: (t: number) => [number, number, number] | null, t: number, aim: number, times: number[]) {
  const here = place(t), a = place(t - GPS_HEADING) ?? here, b = place(t + GPS_HEADING) ?? here;
  if (!here || !a || !b) return null;
  const he = b[0] - a[0], hn = b[1] - a[1], hl = Math.hypot(he, hn);
  if (hl < 1) return null;
  const fe = he / hl, fn = hn / hl, cos = Math.cos(aim * RAD), sin = Math.sin(aim * RAD);
  const ahead: [number, number, number][] = [], along: number[] = [];
  let last = here, d = 0;
  for (const s of times) {
    const p = place(t + s);
    if (!p) break;
    d += Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]);
    last = p;
    const q = [p[0] - here[0], p[1] - here[1], p[2] - here[2]];
    // Level camera axes: right, down, ahead along the heading; then tipped so straight on is `aim` below the middle.
    const x = q[0] * fn - q[1] * fe, y = -q[2], z = q[0] * fe + q[1] * fn;
    ahead.push([x, y * cos + z * sin, z * cos - y * sin]);
    along.push(d);
  }
  return ahead.length > 2 ? { ahead, along } : null;
}

/** The heading `h` eased `dt` s of the way towards `to`, by the craft's momentum, kept a unit vector. */
function lag(h: [number, number, number], to: [number, number, number], dt = ROAD_DT): [number, number, number] {
  const k = 1 - Math.exp(-dt / ROAD_LAG);
  const x = h[0] + (to[0] - h[0]) * k, y = h[1] + (to[1] - h[1]) * k, z = h[2] + (to[2] - h[2]) * k, n = Math.hypot(x, y, z) || 1;
  return [x / n, y / n, z / n];
}

/**
 * The rainbow road along the flight ahead, drawn into the footage through the fisheye (LENS_FOV round the middle of
 * the footage): a ribbon under the craft's path, its lanes red to violet across it, its colours turning slowly with
 * the song and kicked round by the hits, glowing brighter with the bass, fading out into the distance.
 */
function drawRoad(ctx: CanvasRenderingContext2D, fx: MusicFx, lv: MusicLevel, t: number, out: number, motion: CraftMotion) {
  // Not flying (on the ground, or sitting still in the air): no road.
  const up = roadUp(motion, t);
  if (up <= 0) return;
  const { width: W, height: H } = ctx.canvas;
  // A little past the lens's edge too (it lands off the picture), so the road's sides carry on out of it rather than
  // stopping; not round behind the camera, though, where the fisheye would fold it back in.
  const vertical = H > W, cx = W / 2, cy = vertical ? (FOOTAGE_TOP * H) / 2 : H / 2, f = W / (LENS_FOV * RAD), edge = ROAD_EDGE * RAD;
  // The road is laid out as if the camera weren't rolled (the ground straight down the picture), then turned round the
  // picture's middle by the roll, so it comes in from whichever edge the ground's on and spins round with the world.
  const roll = rollAt(motion, t, fx.roadAim), rc = Math.cos(roll), rs = Math.sin(roll);
  const unroll = (v: readonly number[]): [number, number, number] => [v[0] * rc - v[1] * rs, v[0] * rs + v[1] * rc, v[2]];
  const hw = W / 2, hh = cy;
  // From the middle to the picture's edge, toward the ground and across it.
  const reach = Math.min(hw / Math.max(1e-6, Math.abs(rs)), hh / Math.max(1e-6, Math.abs(rc)));
  const across = Math.min(hw / Math.max(1e-6, Math.abs(rc)), hh / Math.max(1e-6, Math.abs(rs)));
  const flight = (fx.roadStyle === 'tube'
    ? flightAhead(motion, t, fx.roadAim, Math.max(fx.roadLength, TUBE_FROM + TUBE_MIN), TUBE_FROM)
    : flightAhead(motion, t, fx.roadAim, fx.roadLength)), along = flight.along, ahead = flight.ahead.map(unroll);
  const toScreen = (p: readonly [number, number, number]): [number, number] | null => {
    const side = Math.hypot(p[0], p[1]), a = Math.atan2(side, p[2]);
    if (a > edge || Math.hypot(...p) < 0.5) return null;
    return side < 1e-6 ? [cx, cy] : [cx + (f * a * p[0]) / side, cy + (f * a * p[1]) / side];
  };
  // Across the road and under it: with the accelerometer, level with the real ground and below the path, however the
  // camera is rolled or pitched. Without it, flat to the camera's own level now. Where the path heads (near) straight
  // down that way, level sideways is ill-defined, so the road keeps the way it was lying.
  // Looking (near) straight down at the ground, the roll's ill-defined, so it leans over to the camera's own down.
  const ground = unroll(downAt(motion, t, fx.roadAim) ?? [0, 1, 0]), keep = Math.max(0, ground[1]);
  const lean = [ground[0] * keep, ground[1] * keep + (1 - keep), ground[2] * keep], ll = Math.hypot(...lean) || 1;
  const down = [lean[0] / ll, lean[1] / ll, lean[2] / ll];
  const tube = fx.roadStyle === 'tube', width = tube ? TUBE_WIDTH : ROAD_WIDTH;
  let side: [number, number, number] = [1, 0, 0];
  const rows = ahead.map((p, k) => {
    const next = ahead[Math.min(ahead.length - 1, k + 1)], prev = ahead[Math.max(0, k - 1)];
    const tx = next[0] - prev[0], ty = next[1] - prev[1], tz = next[2] - prev[2], tl = Math.hypot(tx, ty, tz) || 1;
    // down x tangent: right of the path, along the ground.
    const rx = down[1] * tz - down[2] * ty, ry = down[2] * tx - down[0] * tz, rz = down[0] * ty - down[1] * tx;
    const rl = Math.hypot(rx, ry, rz);
    // Kept left to right across the picture, as its bottom end is, so it never twists over.
    const sg = rx < 0 ? -1 : 1;
    if (rl / tl > 0.35 || k === 0) side = rl > 1e-6 ? [(sg * rx) / rl, (sg * ry) / rl, (sg * rz) / rl] : side;
    return Array.from({ length: ROAD_LANES + 1 }, (_, j) => {
      const w = (j / ROAD_LANES - 0.5) * width;
      return toScreen([
        p[0] + side[0] * w + down[0] * ROAD_DROP,
        p[1] + side[1] * w + down[1] * ROAD_DROP,
        p[2] + side[2] * w + down[2] * ROAD_DROP,
      ]);
    });
  });
  // Pinned to the bottom edge (anchor) and eased from there into where the path really is over the first rows. Where the
  // camera points well above the path, which would leave it all under the picture, it's held up into view: by its end
  // at least ROAD_RISE of the way up. Points too near to see (under the camera) stay on the bottom edge.
  // Its bottom end slides along the edge toward where the path is (off the side when the craft's going sideways).
  const bottom = cy + reach, mid = ROAD_LANES / 2;
  const middleOf = (r: ([number, number] | null)[]) => {
    const l = r[Math.floor(mid)], h = r[Math.ceil(mid)];
    return l && h ? (l[0] + h[0]) / 2 : null;
  };
  const aimAt = rows.slice(Math.min(rows.length - 1, ROAD_SWEEP - 1)).map(middleOf).find(x => x !== null)
    ?? rows.map(middleOf).find(x => x !== null) ?? cx;
  const slide = Math.max(-2.4 * across, Math.min(2.4 * across, (aimAt - cx) * ROAD_SLIDE));
  const anchor = Array.from({ length: ROAD_LANES + 1 }, (_, j): [number, number] =>
    [cx + slide + across * ROAD_FOOT * ((2 * j) / ROAD_LANES - 1), bottom + 2]);
  const base = anchor[ROAD_LANES][0] - anchor[0][0];
  // The tube floats free, out ahead: not pinned to the edge, nor held up into view.
  const road = [...(tube ? [] : [anchor]), ...rows.map((r, i) => {
    const u = (i + 1) / rows.length, e = tube ? 1 : Math.min(1, (i + 1) / ROAD_SWEEP), b = e * e * (3 - 2 * e);
    const lowest = tube ? Infinity : bottom - ROAD_RISE * u * 2 * reach;
    // Squeezed about its middle when it's wider across than this far along allows (a craft's path swinging close), and
    // tapered to a point.
    const seen = r.filter((p): p is [number, number] => !!p);
    const mx = seen.reduce((a, p) => a + p[0], 0) / (seen.length || 1), my = seen.reduce((a, p) => a + p[1], 0) / (seen.length || 1);
    const span = seen.length > 1 ? Math.hypot(seen[seen.length - 1][0] - seen[0][0], seen[seen.length - 1][1] - seen[0][1]) : 0;
    const squeeze = Math.min(1, (base * (1 - (1 - ROAD_NARROW) * u)) / (span || 1)) * (tube ? 1 : 1 - ROAD_TAPER * u ** 1.5);
    return r.map((p, j): [number, number] | null => {
      if (!p) return i < ROAD_SWEEP && !tube ? anchor[j] : null;
      const x = mx + (p[0] - mx) * squeeze, y = Math.min(my + (p[1] - my) * squeeze, lowest);
      return [anchor[j][0] + (x - anchor[j][0]) * b, anchor[j][1] + (y - anchor[j][1]) * b];
    });
  })].map(r => r.map((p): [number, number] | null => {
    // Turned back by the roll, round the picture's middle.
    if (!p) return null;
    const dx = p[0] - cx, dy = p[1] - cy;
    return [cx + dx * rc + dy * rs, cy - dx * rs + dy * rc];
  }));
  const far = tube ? along : [along[0] - ROAD_STRIPE, ...along];
  // Where the craft's path runs out of view (flying backwards to the camera, mid loop), the road fades away.
  const seen = rows.filter(r => middleOf(r) !== null).length / rows.length, inView = Math.min(1, Math.max(0, (seen - 0.3) / 0.4));
  if (inView <= 0) return;
  const travelled = motion.speed ? distanceFlown(motion.speed, t) : out * ROAD_SPEED;
  const turnAt = (out * 20 + lv.hit * 40 + lv.bass * 30) % 360, glow = 0.75 + 0.25 * lv.bass;
  const strength = Math.min(1, fx.road * 0.8) * inView * up;
  if (tube) {
    ctx.save();
    if (vertical) { ctx.beginPath(); ctx.rect(0, 0, W, FOOTAGE_TOP * H); ctx.clip(); }
    drawTube(ctx, road, far, travelled, strength, glow, turnAt);
    ctx.restore();
    return;
  }
  // Drawn small and blown back up with hard edges: chunky pixels.
  const px = Math.max(2, Math.round((ROAD_PIXEL * Math.min(W, H)) / 1080));
  const small = scratch('road', Math.ceil(W / px), Math.ceil(H / px)), g = small.getContext('2d', { willReadFrequently: true })!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, small.width, small.height);
  g.setTransform(1 / px, 0, 0, 1 / px, 0, 0);
  // How far along each pixel is, drawn alongside (0..255 in red) so the ends can break up by it.
  const umap = scratch('road-u', small.width, small.height), ug = umap.getContext('2d', { willReadFrequently: true })!;
  ug.setTransform(1, 0, 0, 1, 0, 0);
  ug.clearRect(0, 0, umap.width, umap.height);
  ug.setTransform(1 / px, 0, 0, 1 / px, 0, 0);
  const along01 = (k: number) => k / (road.length - 1);
  const uShade = (u: number) => `rgb(${Math.round(u * 255)}, 0, 0)`;
  const fadeAt = (_u: number) => 1;
  for (let k = 0; k < road.length - 1; k++) {
    const u = k / (road.length - 1), fade = fadeAt(u);
    const stripe = Math.floor((travelled + far[k]) / ROAD_STRIPE) % 2 === 0 ? 1 : 0.72;
    const alpha = strength * fade * glow;
    if (alpha < 0.01) continue;
    for (let j = 0; j < ROAD_LANES; j++) {
      const a = road[k][j], b = road[k][j + 1], c = road[k + 1][j + 1], d = road[k + 1][j];
      if (!a || !b || !c || !d) continue;
      const hue = (turnAt + (j / ROAD_LANES) * 290) % 360;
      g.fillStyle = `hsla(${hue.toFixed(0)}, 100%, ${(52 * stripe + 8).toFixed(0)}%, ${alpha.toFixed(3)})`;
      g.beginPath();
      g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]);
      g.closePath();
      g.fill();
      const m0 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], m1 = [(c[0] + d[0]) / 2, (c[1] + d[1]) / 2];
      const grad = ug.createLinearGradient(m0[0], m0[1], m1[0], m1[1]);
      grad.addColorStop(0, uShade(along01(k)));
      grad.addColorStop(1, uShade(along01(k + 1)));
      ug.fillStyle = grad;
      ug.beginPath();
      ug.moveTo(a[0], a[1]); ug.lineTo(b[0], b[1]); ug.lineTo(c[0], c[1]); ug.lineTo(d[0], d[1]);
      ug.closePath();
      ug.fill();
    }
  }
  // Bright rails along both edges, a pixel wide.
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'square';
  g.lineWidth = px;
  for (const j of [0, ROAD_LANES]) {
    for (let k = 0; k < road.length - 1; k++) {
      const a = road[k][j], b = road[k + 1][j];
      if (!a || !b) continue;
      g.strokeStyle = `rgba(255, 255, 255, ${(strength * fadeAt(k / (road.length - 1)) * glow * 0.7).toFixed(3)})`;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      ug.strokeStyle = uShade(along01(k + 0.5));
      ug.lineWidth = px;
      ug.beginPath(); ug.moveTo(a[0], a[1]); ug.lineTo(b[0], b[1]); ug.stroke();
    }
  }
  g.globalCompositeOperation = 'source-over';
  dissolveEnds(g, ug, Math.floor(t * ROAD_TWINKLE));
  sparkle(g, road, far, travelled, Math.floor(t * ROAD_TWINKLE), strength * glow, turnAt, px);
  ctx.save();
  if (vertical) { ctx.beginPath(); ctx.rect(0, 0, W, FOOTAGE_TOP * H); ctx.clip(); }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, small.width * px, small.height * px);
  ctx.restore();
}

/** Whether the craft's flying at log time `t` (see ROAD_IDLE): 1 or 0, or 1 when the log can't say. */
function flyingAt(motion: CraftMotion, t: number) {
  const speed = motion.speed, throttle = motion.throttle;
  if (speed && speed(t) < ROAD_STILL) return 0;
  if (!throttle) return 1;
  for (let s = t; s >= t - ROAD_GROUNDED; s -= 0.04) if (throttle(s) > ROAD_IDLE) return 1;
  return 0;
}

/** How much road there is at log time `t`, 0..1: flying over the last ROAD_FADE s, so it eases in and out. */
function roadUp(motion: CraftMotion, t: number) {
  let n = 0;
  for (let k = 0; k < 5; k++) n += flyingAt(motion, t - (k / 4) * ROAD_FADE);
  return n / 5;
}

/**
 * The glass tube along the road's middle (`road`'s rows, screen points across; `far` m along to each): a round rod of
 * clear glass, faintly tinted with colours turning with the song (`hue0`), brighter with `glow` (the bass), rippling as
 * it streams past, its ends rounded off. Drawn apart and softened a touch, so it reads smooth.
 */
function drawTube(ctx: CanvasRenderingContext2D, road: ([number, number] | null)[][], far: number[], travelled: number,
  alpha: number, glow: number, hue0: number) {
  // The middle and half-width of each row, as far as the tube can be seen unbroken from its near end.
  const lo = Math.floor(ROAD_LANES / 2), hi = Math.ceil(ROAD_LANES / 2);
  const mid: [number, number][] = [], rad: number[] = [];
  for (let k = 0; k < road.length; k++) {
    const r = road[k], a = r[lo], b = r[hi], l = r[0], e = r[ROAD_LANES];
    if (!a || !b || !l || !e) {
      if (mid.length > 1) break;
      mid.length = rad.length = 0;
      continue;
    }
    const ripple = 1 + TUBE_RIPPLE * Math.sin((2 * Math.PI * (travelled + far[k])) / TUBE_WAVE);
    mid.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    rad.push((Math.hypot(e[0] - l[0], e[1] - l[1]) / 2) * ripple);
  }
  if (mid.length < 2) return;
  const { width: W, height: H } = ctx.canvas;
  // Smoothed: the rows are far apart on screen where the tube's close, so it's drawn through them on a curve, a point
  // every few pixels, rather than straight from row to row (which shows corners).
  const { mid: line, rad: wide } = smoothTube(mid, rad, Math.max(2, Math.min(W, H) / 270));
  const n = line.length;
  const run = [0];
  for (let k = 1; k < n; k++) run.push(run[k - 1] + Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]));
  const total = run[n - 1];
  // No wider than it bends: round a tight bend the tube's inside edge would fold back over itself, so it narrows
  // there instead, easing in and out.
  const bendR = tightness(line, run, total);
  // Rounded ends: the radius closes in like a half ball over the last radius's length at each end (at most a third of
  // the tube each, so a short one close up stays a rod, not a ball).
  const capA = Math.min(wide[0], total / 3), capB = Math.min(wide[n - 1], total / 3);
  const round = (x: number) => (x >= 1 ? 1 : Math.sqrt(Math.max(0, 1 - (1 - x) ** 2)));
  const r = wide.map((v, k) => Math.min(v, bendR[k]) * round(run[k] / (capA || 1)) * round((total - run[k]) / (capB || 1)));
  // Across the tube at each point: square to its line on screen, the lit side up the picture where it starts and kept
  // on the same side along it.
  const across: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const q = line[Math.min(n - 1, k + 2)], o = line[Math.max(0, k - 2)];
    let x = -(q[1] - o[1]), y = q[0] - o[0];
    const l = Math.hypot(x, y) || 1;
    x /= l; y /= l;
    const prev = across[k - 1];
    const flip = prev ? x * prev[0] + y * prev[1] < 0 : y > 0;
    across.push(flip ? [-x, -y] : [x, y]);
  }
  const at = (k: number, s: number): [number, number] => [line[k][0] + across[k][0] * r[k] * s, line[k][1] + across[k][1] * r[k] * s];
  const canvas = scratch('tube', W, H), g = canvas.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  // In bands along its length, side to side across it (s: -1 one side, 0 the middle, 1 the lit side), shaded as a
  // round rod of clear glass: see-through in the middle, brighter toward its sides where the glass is seen edge on,
  // a darker line just inside each edge where it bends the light away, and a white highlight down its lit side. Faintly
  // tinted along its length in colours that turn with the song.
  for (let i = 0; i < TUBE_BANDS; i++) {
    const s0 = -1 + (2 * i) / TUBE_BANDS, s1 = s0 + 2 / TUBE_BANDS, sm = (s0 + s1) / 2;
    const edge = Math.abs(sm) ** 3, shine = Math.exp(-(((sm - 0.45) / 0.13) ** 2));
    const bend = Math.exp(-(((Math.abs(sm) - 0.8) / 0.08) ** 2)), under = Math.exp(-(((sm + 0.55) / 0.15) ** 2));
    const light = Math.max(20, Math.min(97, 82 + 14 * shine + 6 * under - 50 * bend)), sat = 30 - 25 * shine;
    const a = alpha * Math.min(1, 0.1 + 0.55 * edge + 0.7 * shine + 0.3 * bend + 0.15 * under) * (0.85 + 0.15 * glow);
    const across0 = hue0;
    const grad = g.createLinearGradient(line[0][0], line[0][1], line[n - 1][0], line[n - 1][1]);
    const step = Math.max(1, Math.floor(n / 8));
    const stop = (k: number) => {
      const u = k / (n - 1), h = (across0 + u * 220) % 360;
      grad.addColorStop(u, `hsla(${h.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%, ${(a * (1 - 0.25 * u)).toFixed(3)})`);
    };
    for (let k = 0; k < n; k += step) stop(k);
    stop(n - 1);
    g.fillStyle = grad;
    g.beginPath();
    for (let k = 0; k < n; k++) { const p = at(k, s0); if (k) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }
    for (let k = n - 1; k >= 0; k--) { const p = at(k, s1); g.lineTo(p[0], p[1]); }
    g.closePath();
    g.fill();
  }
  ctx.save();
  ctx.filter = `blur(${Math.max(0.5, (TUBE_SOFT * Math.min(W, H)) / 1080).toFixed(1)}px)`;
  ctx.drawImage(canvas, 0, 0);
  ctx.restore();
}

/**
 * The tube's middle line (`mid`) and radius (`rad`) through its rows, on a Catmull-Rom curve with a point about every
 * `step` px, and the radius eased along it.
 */
function smoothTube(mid: [number, number][], rad: number[], step: number) {
  const n = mid.length, out: [number, number][] = [], wide: number[] = [];
  const P = (k: number) => mid[Math.max(0, Math.min(n - 1, k))], R = (k: number) => rad[Math.max(0, Math.min(n - 1, k))];
  const cr = (a: number, b: number, c: number, d: number, t: number) =>
    0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  for (let k = 0; k < n - 1; k++) {
    const p0 = P(k - 1), p1 = P(k), p2 = P(k + 1), p3 = P(k + 2);
    const parts = Math.max(1, Math.min(40, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step)));
    for (let j = 0; j < parts; j++) {
      const t = j / parts;
      out.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t)]);
      wide.push(Math.max(0, cr(R(k - 1), R(k), R(k + 1), R(k + 2), t)));
    }
  }
  out.push(mid[n - 1]);
  wide.push(rad[n - 1]);
  return { mid: out, rad: wide };
}

/**
 * How wide the tube can be at each point of its middle line (`line`, `run` px along it, `total` in all) before its
 * inside edge folds back on a bend: 0.85 of the bend's radius there (measured over a stretch, so a wobble doesn't count),
 * eased so it narrows smoothly into a tight bend and out again.
 */
function tightness(line: [number, number][], run: number[], total: number) {
  const n = line.length, out = new Array<number>(n).fill(Infinity);
  if (n < 3) return out;
  const span = Math.max(6, total / 40);
  const dir = (k: number) => {
    const q = line[Math.min(n - 1, k + 1)], o = line[Math.max(0, k - 1)];
    return Math.atan2(q[1] - o[1], q[0] - o[0]);
  };
  let lo = 0, hi = 0;
  for (let k = 0; k < n; k++) {
    while (lo < k && run[k] - run[lo] > span) lo++;
    while (hi < n - 1 && run[hi] - run[k] < span) hi++;
    let turn = Math.abs(dir(hi) - dir(lo));
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    const arc = run[hi] - run[lo];
    if (turn > 1e-3 && arc > 0) out[k] = (0.85 * arc) / turn;
  }
  // Eased: each limit spreads to its neighbours (a narrowing can't be sharper than it gets wider), then softened.
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 1; k < n; k++) out[k] = Math.min(out[k], out[k - 1] + (run[k] - run[k - 1]) * 0.5);
    for (let k = n - 2; k >= 0; k--) out[k] = Math.min(out[k], out[k + 1] + (run[k + 1] - run[k]) * 0.5);
  }
  return out;
}

/**
 * Magic dust round the road: sparkles fixed to the ground along it (one every ROAD_SPARK_GAP m, `travelled` m flown so
 * far, `far` m along to each row), either side of its middle, twinkling on and off with `seed`, white or a rainbow
 * colour, the odd one a bigger cross. Pixels of `px` (it's drawn on the small road canvas).
 */
function sparkle(g: CanvasRenderingContext2D, road: ([number, number] | null)[][], far: number[], travelled: number,
  seed: number, alpha: number, hue0: number, px: number) {
  const last = road.length - 1, from = travelled + far[0], to = travelled + far[last];
  if (!(to > from)) return;
  g.globalCompositeOperation = 'lighter';
  let k = 0;
  for (let j = Math.ceil(from / ROAD_SPARK_GAP); j * ROAD_SPARK_GAP <= to; j++) {
    const d = (j + hash(j, 1, 7) - 0.5) * ROAD_SPARK_GAP - travelled;
    while (k < last - 1 && far[k + 1] < d) k++;
    const a = road[k], b = road[k + 1];
    const a0 = a[0], a1 = a[ROAD_LANES], b0 = b[0], b1 = b[ROAD_LANES];
    if (!a0 || !a1 || !b0 || !b1 || far[k + 1] <= far[k]) continue;
    const f = Math.max(0, Math.min(1, (d - far[k]) / (far[k + 1] - far[k]))), u = (k + f) / last;
    const on = hash(j, seed, 11);
    if (on > ROAD_SPARK_ON) continue;
    // Across the ribbon here: its left and right edges, between the two rows.
    const lx = a0[0] + (b0[0] - a0[0]) * f, ly = a0[1] + (b0[1] - a0[1]) * f;
    const rx = a1[0] + (b1[0] - a1[0]) * f, ry = a1[1] + (b1[1] - a1[1]) * f;
    const o = 0.5 + (hash(j, 3, 13) - 0.5) * ROAD_SPARK_SPREAD;
    const x = lx + (rx - lx) * o, y = ly + (ry - ly) * o;
    const bright = alpha * roadKeep(u) * (0.5 + on / ROAD_SPARK_ON / 2);
    if (bright < 0.03) continue;
    const white = hash(j, 5, 17) < 0.5;
    g.fillStyle = white ? `rgba(255, 255, 255, ${bright.toFixed(3)})`
      : `hsla(${((hue0 + hash(j, 6, 19) * 290) % 360).toFixed(0)}, 100%, 70%, ${bright.toFixed(3)})`;
    const cxp = Math.floor(x / px) * px, cyp = Math.floor(y / px) * px;
    g.fillRect(cxp, cyp, px, px);
    if (hash(j, 8, 23) < 0.25) {
      g.fillRect(cxp - px, cyp, px, px); g.fillRect(cxp + px, cyp, px, px);
      g.fillRect(cxp, cyp - px, px, px); g.fillRect(cxp, cyp + px, px, px);
    }
  }
  g.globalCompositeOperation = 'source-over';
}

/**
 * Breaks the road's ends up into random pixels: each pixel of `g` is kept or dropped by a dice roll against how far
 * along the road it is (read from `ug`), the roll changing with `seed`.
 */
function dissolveEnds(g: CanvasRenderingContext2D, ug: CanvasRenderingContext2D, seed: number) {
  const { width: w, height: h } = g.canvas;
  const img = g.getImageData(0, 0, w, h), u = ug.getImageData(0, 0, w, h).data, px = img.data;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (px[o + 3] === 0 || u[o + 3] === 0) continue;
    const keep = roadKeep(u[o] / 255);
    if (keep < 1 && hash(i % w, Math.floor(i / w), seed) >= keep) px[o + 3] = 0;
  }
  g.putImageData(img, 0, 0);
}

/** Spectrum bars: across each line of text, at most this many bars, each this many copy pixels wide (gap included). */
const BAR_PITCH = 4, BAR_FILL = 0.7, BARS_MAX = 24;
/** Shorter lit shapes than this many bars (a stick dot, a map marker) aren't text and get none. */
const BARS_MIN = 3;
/** A line of text is at most this tall (as a share of the copy's long side); taller lit shapes (the map) get no bars. */
const TEXT_TALL = 0.06;
/** How tall a full bar is at 100%, 1080p pixels. */
const BAR_HEIGHT = 70;
/**
 * The bars are springy: their bases turn with the camera and their tops lag behind, swinging back and forth until they
 * settle (a damped spring, BAR_SPRING rad/s, damping BAR_DAMP), worked out over the last BAR_MEMORY s of the gyro. Rolls
 * and yaws lean them over (at most BAR_LEAN rad); pitching squashes and stretches them.
 */
const BAR_SPRING = 11, BAR_DAMP = 0.22, BAR_MEMORY = 1.2, BAR_STEP = 1 / 60, BAR_LEAN = 0.9;
/** The peak caps: how far back they remember (s) and the step they look back in. They fall under the sparks' gravity. */
const CAP_MEMORY = 0.6, CAP_STEP = 1 / 50;

/**
 * A line of OSD text in a HUD copy (copy pixels): its bars' left edges and the top of the text above each, and for the
 * light-speed streaks, a root for each: where a line from the picture's middle through that bar leaves the text.
 */
interface TextLine {
  left: number[]; top: number[]; width: number;
  /** Where a line out from the middle through each bar leaves the text (the outer edge)... */
  rootX: number[]; rootY: number[];
  /** ...and where it first meets it (the edge facing the middle). */
  innerX: number[]; innerY: number[];
}
const textLines = new WeakMap<SparkMask, TextLine[]>();

/**
 * The lines of text in a HUD copy: its lit pixels gathered into blobs (letters within a few pixels of each other joined
 * up), kept when short enough to be text. Each gets a row of bars along it, sitting on the top of its letters.
 */
function linesOf(mask: SparkMask): TextLine[] {
  const known = textLines.get(mask);
  if (known) return known;
  const { w, h, lit } = mask, on = new Uint8Array(w * h);
  for (const p of lit) on[p] = 1;
  // Coarse cells of 2x2, so a blob search stays quick.
  const cw = Math.ceil(w / 2), chh = Math.ceil(h / 2), cell = new Int32Array(cw * chh).fill(-1);
  for (const p of lit) cell[(Math.floor(p / w) >> 1) * cw + ((p % w) >> 1)] = 0;
  const lines: TextLine[] = [], tall = TEXT_TALL * Math.max(w, h);
  // The middle of the footage, which the streaks fly out from.
  const mx = w / 2, my = h > w ? (FOOTAGE_TOP * h) / 2 : h / 2;
  let id = 0;
  for (let start = 0; start < cell.length; start++) {
    if (cell[start] !== 0) continue;
    id++;
    let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
    const stack = [start];
    cell[start] = id;
    while (stack.length) {
      const c = stack.pop()!, cx = c % cw, cy = (c - cx) / cw;
      x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
      // Letters a few pixels apart along a line are one line; lines above and below stay apart.
      for (let dy = -1; dy <= 1; dy++) for (let dx = -3; dx <= 3; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= chh) continue;
        const n = ny * cw + nx;
        if (cell[n] === 0) { cell[n] = id; stack.push(n); }
      }
    }
    const px0 = x0 * 2, px1 = Math.min(w - 1, x1 * 2 + 1), py0 = y0 * 2, py1 = Math.min(h - 1, y1 * 2 + 1);
    if (py1 - py0 + 1 > tall || px1 - px0 + 1 < BAR_PITCH * BARS_MIN) continue;
    const count = Math.min(BARS_MAX, Math.floor((px1 - px0 + 1) / BAR_PITCH)), width = (px1 - px0 + 1) / count;
    const line: TextLine = { left: [], top: [], width, rootX: [], rootY: [], innerX: [], innerY: [] };
    for (let b = 0; b < count; b++) {
      const a = Math.floor(px0 + b * width), z = Math.floor(px0 + (b + 1) * width);
      // The bar sits on the highest lit pixel under it, or the line's top where there's a gap between letters.
      let top = py0;
      search: for (let y = py0; y <= py1; y++) for (let x = a; x < z; x++) if (on[y * w + x]) { top = y; break search; }
      line.left.push(a);
      line.top.push(top);
      // Its streak's root: out from the middle through the bar, the last lit pixel before leaving the line, so top
      // text sheds them off its top, bottom text off its bottom, and text in the corners off its outer corner.
      const sx0 = (a + z) / 2, sy0 = (py0 + py1) / 2, dl = Math.hypot(sx0 - mx, sy0 - my) || 1;
      const ux = (sx0 - mx) / dl, uy = (sy0 - my) / dl;
      const inside = (qx: number, qy: number) => qx >= px0 - 1 && qx <= px1 + 1 && qy >= py0 - 1 && qy <= py1 + 1;
      const lit = (qx: number, qy: number) => {
        const ix = Math.round(qx), iy = Math.round(qy);
        return iy >= 0 && iy < h && ((ix >= 0 && ix < w && on[iy * w + ix] === 1) || (ix > 0 && on[iy * w + ix - 1] === 1) || (ix < w - 1 && on[iy * w + ix + 1] === 1));
      };
      // From where the line enters the text's box to where it leaves, the first and last lit pixels on it.
      let k0 = 0;
      while (inside(sx0 - ux * (k0 + 0.5), sy0 - uy * (k0 + 0.5))) k0 += 0.5;
      let first: [number, number] | null = null, last: [number, number] | null = null;
      for (let k = -k0; inside(sx0 + ux * k, sy0 + uy * k); k += 0.5) {
        const qx = sx0 + ux * k, qy = sy0 + uy * k;
        if (lit(qx, qy)) { first ??= [qx, qy]; last = [qx, qy]; }
      }
      line.rootX.push(last?.[0] ?? sx0);
      line.rootY.push(last?.[1] ?? sy0);
      line.innerX.push(first?.[0] ?? sx0);
      line.innerY.push(first?.[1] ?? sy0);
    }
    lines.push(line);
  }
  textLines.set(mask, lines);
  return lines;
}

/** A damped spring's swing at log time `t`, driven by how fast the camera's turning about one axis speeds up. */
function springSwing(turn: CameraTurn, t: number, axis: 0 | 1 | 2) {
  const wd = BAR_SPRING * Math.sqrt(1 - BAR_DAMP * BAR_DAMP);
  let x = 0, before = turn.rate(t - BAR_MEMORY)[axis];
  // The response to each step's change in rate (the angular acceleration), summed: x'' + 2ζω x' + ω² x = -dω/dt.
  for (let s = BAR_MEMORY - BAR_STEP; s >= 0; s -= BAR_STEP) {
    const now = turn.rate(t - s)[axis], kick = now - before;
    before = now;
    x -= kick * Math.exp(-BAR_DAMP * BAR_SPRING * s) * Math.sin(wd * s) / wd * BAR_SPRING;
  }
  return x;
}

/**
 * Spectrum analyser bars standing on the OSD's text, from bass on the left to treble on the right of each line, with
 * peak caps that fall under gravity. Worked out afresh each frame from the music and the gyro, like the sparks.
 */
function drawSpectrum(ctx: CanvasRenderingContext2D, fx: MusicFx, t: number, out: number, mask: SparkMask, u: number,
                      motion: CraftMotion) {
  const turn = motion.turn;
  const { width: W, height: H } = ctx.canvas, sx = W / mask.w, sy = H / mask.h;
  const lines = linesOf(mask);
  if (!lines.length) return;
  const bands = new Float32Array(SPECTRUM_BANDS), past = new Float32Array(SPECTRUM_BANDS);
  if (!fx.spectrumOut(out, bands)) return;
  // Peaks: the highest any band reached recently, less how far it has fallen since (½gt²).
  const g = GRAVITY * ((1080 * u) / SPARK_FRAME_M), full = BAR_HEIGHT * u * fx.spectrum;
  const peaks = Float32Array.from(bands, v => v * full);
  for (let s = CAP_STEP; s <= CAP_MEMORY; s += CAP_STEP) {
    if (!fx.spectrumOut(out - s, past)) break;
    const fall = 0.5 * g * s * s;
    for (let b = 0; b < SPECTRUM_BANDS; b++) peaks[b] = Math.max(peaks[b], past[b] * full - fall);
  }
  // Light speed: each bar a star streak, its head on the text and its tail trailing back along the craft's motion.
  const warp = fx.spectrumStyle === 'lightspeed';
  // Rainbow: where the wheel has turned to now, with the song's clock and its bass.
  const bass = bands.slice(0, 4).reduce((a, b) => a + b, 0) / 4, rainbowAt = out * RAINBOW_DRIFT + bass * RAINBOW_BASS;
  const cx = W / 2, cy = H > W ? (FOOTAGE_TOP * H) / 2 : H / 2, paths = warp ? momentumPaths(motion, t, W, cx, cy) : null;
  // The bars: rolling and yawing lean them over, pitching stretches them.
  let lean = 0, stretch = 1;
  if (turn && !warp) {
    lean = Math.max(-BAR_LEAN, Math.min(BAR_LEAN, springSwing(turn, t, 2) + 0.6 * springSwing(turn, t, 1)));
    stretch = Math.max(0.4, Math.min(1.8, 1 + 0.5 * springSwing(turn, t, 0)));
  }
  const shear = Math.tan(lean);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const line of lines) {
    const n = line.left.length, bw = line.width * sx * BAR_FILL;
    for (let i = 0; i < n; i++) {
      // Across the line from bass to treble.
      const band = Math.min(SPECTRUM_BANDS - 1, Math.floor((i / n) * SPECTRUM_BANDS));
      const x = line.left[i] * sx, base = line.top[i] * sy - 2 * u;
      const tall = bands[band] * full * stretch, cap = peaks[band] * stretch;
      const hue = 130 - 80 * bands[band];
      if (warp) {
        // Heading out, they leave the text's outer edge; heading in, the edge facing the middle.
        const out = fx.streakDirection === 'out';
        const hx = (out ? line.rootX[i] : line.innerX[i]) * sx, hy = (out ? line.rootY[i] : line.innerY[i]) * sy;
        const hue = fx.streakColor === 'rainbow' ? Math.round((rainbowAt + (i / n) * RAINBOW_SPREAD) % 360) : null;
        drawStreak(ctx, hx, hy, paths?.(hx, hy) ?? null, cx, cy, tall * WARP_LENGTH, cap * WARP_LENGTH, bw, bands[band], u, out, hue);
        continue;
      }
      if (tall > 0.5 * u) {
        const grad = ctx.createLinearGradient(0, base, 0, base - tall);
        grad.addColorStop(0, `hsla(${hue.toFixed(0)}, 95%, 45%, 0.55)`);
        grad.addColorStop(1, `hsla(${(hue - 30).toFixed(0)}, 100%, 62%, 0.9)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.lineTo(x + bw, base);
        ctx.lineTo(x + bw + shear * tall, base - tall);
        ctx.lineTo(x + shear * tall, base - tall);
        ctx.closePath();
        ctx.fill();
      }
      if (cap > 1.5 * u) {
        const capH = Math.max(1, 2 * u);
        ctx.fillStyle = `hsla(${(hue - 40).toFixed(0)}, 100%, 75%, 0.95)`;
        ctx.fillRect(x + shear * cap, base - cap - capH - 1.5 * u, bw, capH);
      }
    }
  }
  ctx.restore();
}

/** Light-speed streaks are this many times as long as the bars they stand for. */
const WARP_LENGTH = 2.4;
/**
 * A streak's peak cap shows only once it's this far (1080p pixels) clear of the streak's end, and only from this far
 * out, so quiet bands and steady ones don't dot every streak.
 */
const CAP_CLEAR = 6, CAP_MIN = 40;
/**
 * Rainbow streaks: the colour wheel spread across each line (bass to treble), the whole of it turning this many degrees
 * a second, and pushed further round by the bass.
 */
const RAINBOW_SPREAD = 260, RAINBOW_DRIFT = 40, RAINBOW_BASS = 140;
/**
 * Their shape follows the craft's momentum: each traces back where the picture at its root came from over the last
 * WARP_TRAIL s (in WARP_STEPS steps), turned by the gyro and streaming out from straight ahead with the GPS speed
 * (things WARP_DEPTH m away), then is stretched or shrunk to its length. Still, they point back at the middle.
 */
const WARP_TRAIL = 0.2, WARP_STEPS = 8, WARP_DEPTH = 8;

/** How the craft was moving, for the streaks: the camera's turns from the gyro, and its speed (m/s) from the GPS. */
export interface CraftMotion {
  turn: CameraTurn | null;
  speed: ((t: number) => number) | null;
  /** Where the craft is by its GPS at log time `t`: metres east, north and up (null off the track or without one). */
  place?: ((t: number) => [number, number, number] | null) | null;
  /** The throttle at log time `t` (rcCommand, 1000 at idle..2000), without sticks null. */
  throttle?: ((t: number) => number) | null;
}

/**
 * The paths the streaks follow this frame: for a point on the picture, where the world there was seen over the last
 * WARP_TRAIL s, as points on the picture from now back (a fisheye of LENS_FOV round (cx, cy)). Null when the craft
 * isn't moving at all (no gyro or GPS).
 */
function momentumPaths(motion: CraftMotion, t: number, W: number, cx: number, cy: number) {
  const steps = Array.from({ length: WARP_STEPS + 1 }, (_, k) => (k / WARP_STEPS) * WARP_TRAIL);
  const turns = motion.turn ? steps.map(s => motion.turn!.between(t, t - s)) : null;
  const speed = motion.speed?.(t) ?? 0;
  if (!turns && !(speed > 0.3)) return null;
  const f = W / (LENS_FOV * RAD);
  return (x: number, y: number): [number, number][] => {
    const ox = x - cx, oy = y - cy, r = Math.hypot(ox, oy), off = r / f, ux = r > 1e-6 ? ox / r : 0, uy = r > 1e-6 ? oy / r : -1;
    return steps.map((s, k) => {
      // Flying forward, things off to the side were nearer straight ahead a moment ago...
      const was = Math.max(0, off - (speed / WARP_DEPTH) * Math.sin(off) * s);
      let d: [number, number, number] = [ux * Math.sin(was), uy * Math.sin(was), Math.cos(was)];
      // ...and wherever the camera was pointing then.
      if (turns) d = rotate(turns[k], d);
      const now = Math.acos(Math.max(-1, Math.min(1, d[2]))), side = Math.hypot(d[0], d[1]) || 1;
      return [cx + (f * now * d[0]) / side, cy + (f * now * d[1]) / side];
    });
  };
}

/**
 * One light-speed streak, its head (wide and white-hot) on the OSD at (x, y) and its tail thinning and fading along
 * the craft's motion. `path` (from momentumPaths) runs back in time, the way the picture there came from: towards the
 * middle with speed, against a turn. `out` turns it round, so the tail flies the way the picture is streaming: out from
 * the middle, along with a turn. Straight towards (or out from) the middle (cx, cy) when the craft isn't moving.
 * `length` long, with its peak cap a bright point `cap` along it.
 */
function drawStreak(ctx: CanvasRenderingContext2D, x: number, y: number, path: [number, number][] | null, cx: number, cy: number,
                    length: number, cap: number, width: number, level: number, u: number, out: boolean, hue: number | null) {
  // The path's shape, from the head, scaled to `want` long.
  let pts = path, total = 0;
  if (pts) for (let k = 1; k < pts.length; k++) total += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  if (!pts || total < 0.5 * u) {
    const dx = cx - x, dy = cy - y, d = Math.hypot(dx, dy) || 1;
    pts = [[x, y], [x + dx / d, y + dy / d]];
    total = 1;
  }
  const turn = out ? -1 : 1;
  const along = (want: number) => pts!.map(([px, py]) => [x + turn * (px - pts![0][0]) * (want / total), y + turn * (py - pts![0][1]) * (want / total)] as const);
  if (length > 1.5 * u) {
    const line = along(length), tail = line[line.length - 1];
    // White-hot and blue, or (rainbow) in `hue`, shading on round the wheel towards the tail.
    const h = hue ?? 205, h2 = hue === null ? 215 : hue + 40, white = hue === null;
    for (const [scale, head, mid] of [[2.4, `hsla(${h}, 100%, 62%, ${(0.25 + 0.25 * level).toFixed(2)})`, `hsla(${h2}, 100%, 58%, 0.08)`],
                                      [0.55, white ? 'rgba(255, 255, 255, 1)' : `hsla(${h}, 100%, 82%, 1)`,
                                       `hsla(${white ? 200 : h + 20}, 100%, ${white ? 85 : 66}%, 0.55)`]] as const) {
      const grad = ctx.createLinearGradient(x, y, tail[0], tail[1]);
      grad.addColorStop(0, head);
      grad.addColorStop(0.45, mid);
      grad.addColorStop(1, `hsla(${h2}, 100%, 70%, 0)`);
      ctx.fillStyle = grad;
      taper(ctx, line, (width * scale) / 2);
    }
  }
  // The peak cap: only once it has come clear of its streak (a loud moment just past), small and faint, fading as the
  // streak catches back up with it.
  const gap = cap - length;
  if (gap > CAP_CLEAR * u && cap > CAP_MIN * u) {
    const end = along(cap + 3 * u), [px, py] = end[end.length - 1], r = Math.max(0.8, width * 0.16);
    const a = Math.min(1, (gap - CAP_CLEAR * u) / (CAP_CLEAR * 2 * u));
    ctx.fillStyle = `hsla(${hue ?? 205}, 100%, 70%, ${(0.12 * a).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(px, py, r * 2.2, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = hue === null ? `rgba(255, 255, 255, ${(0.55 * a).toFixed(3)})` : `hsla(${hue}, 100%, 85%, ${(0.55 * a).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(px, py, r, 0, 2 * Math.PI); ctx.fill();
  }
}

/** Fills a shape along `line`, `half` wide each side at its first point, narrowing to nothing at its last, round at the head. */
function taper(ctx: CanvasRenderingContext2D, line: readonly (readonly [number, number])[], half: number) {
  const n = line.length, left: [number, number][] = [], right: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const a = line[Math.max(0, k - 1)], b = line[Math.min(n - 1, k + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, w = half * (1 - k / (n - 1));
    left.push([line[k][0] - (dy / d) * w, line[k][1] + (dx / d) * w]);
    right.push([line[k][0] + (dy / d) * w, line[k][1] - (dx / d) * w]);
  }
  ctx.beginPath();
  ctx.arc(line[0][0], line[0][1], half, 0, 2 * Math.PI);
  ctx.moveTo(left[0][0], left[0][1]);
  for (const [px, py] of left) ctx.lineTo(px, py);
  for (let k = n - 1; k >= 0; k--) ctx.lineTo(right[k][0], right[k][1]);
  ctx.closePath();
  ctx.fill();
}

/** The HUD's lit pixels at one moment, as indexes into a `w`×`h` copy of it: where sparks can leave from. */
export interface SparkMask { lit: Uint32Array; w: number; h: number }

/** Particle spawn slots a second, the longest any spark lasts (s), and the most one slot sends off. */
const SPARK_RATE = 30, SPARK_LIFE = 3.2, SPARK_MAX = 12;
/**
 * The footage's lens, for keeping sparks in the world as the camera turns: a fisheye seeing this many degrees across
 * the picture's width, and how far from straight ahead a spark can be before it has left the picture behind.
 */
const LENS_FOV = 120, LENS_EDGE = 100;
const RAD = Math.PI / 180;
/** Where the footage ends in a vertical frame, as a share of its height (as the renderer splits it). */
const FOOTAGE_TOP = 0.537;
/**
 * The physics, in real units: the frame's height stands for SPARK_FRAME_M metres of air, with Earth's gravity. Each
 * bounce off the ground keeps SPARK_BOUNCE of the speed it hit with (and SPARK_SKID of its sideways speed); once a
 * bounce would be slower than SPARK_SETTLE m/s it stops bouncing and slides to a stop against SPARK_FRICTION, then
 * lies glowing for SPARK_REST s (give or take) as it fades out.
 */
const SPARK_FRAME_M = 3, GRAVITY = 9.81, SPARK_BOUNCE = 0.42, SPARK_SKID = 0.75, SPARK_SETTLE = 0.35,
  SPARK_FRICTION = 0.55, SPARK_REST = 0.9;
/** Each spark's glow, outermost first: radius (in core radii), opacity and lightness (%). */
const SPARK_GLOW = [[3, 0.12, 55], [1.9, 0.2, 62], [1, 0.95, 84]] as const;

/**
 * Sparks falling off the OSD's panels. Nothing is kept between frames: every spark is worked out afresh from the
 * moment it was sent off (by the finished video's clock), how loud the music was then and a hash of its number, so a
 * scrubbed preview and the finished video show exactly the same ones. Each slot of 1/SPARK_RATE s sends off more the
 * louder the song, and a burst on a hit. They pop off a random spot on a panel's edge (harder with the bass), then fly
 * as real projectiles: gravity only, falling to the bottom of the frame as the ground, bouncing, sliding to a stop and
 * fading out there. Their colour drifts round the wheel as they go, glowing over the HUD.
 *
 * With the gyro in the log (`turn`), they live in the world rather than on the screen: as the quad rolls, flips and
 * yaws after a spark leaves, it swings across the picture the way the footage does, through the fisheye lens, and
 * goes out of sight behind the camera on a flip. `t` is the log time, `out` the finished video's.
 */
function drawParticles(ctx: CanvasRenderingContext2D, fx: MusicFx, t: number, out: number,
                       sparks: (t: number) => SparkMask | null, u: number, turn: CameraTurn | null) {
  const { width: W, height: H } = ctx.canvas;
  const m = (1080 * u) / SPARK_FRAME_M, g = GRAVITY * m; // pixels a metre, and gravity in pixels/s²
  // The lens: its centre (the footage's, which is the top part in vertical) and pixels a radian off it.
  const cx = W / 2, cy = H > W ? (FOOTAGE_TOP * H) / 2 : H / 2, f = W / (LENS_FOV * RAD), edge = LENS_EDGE * RAD;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const last = Math.floor(out * SPARK_RATE);
  for (let slot = Math.max(0, Math.ceil((out - SPARK_LIFE) * SPARK_RATE)); slot <= last; slot++) {
    const born = slot / SPARK_RATE, age = out - born;
    if (age < 0) continue;
    const lv = fx.atOut(born);
    if (!lv) continue;
    // How the camera has turned since the slot's sparks left.
    const q = turn?.between(t - age, t) ?? null;
    const energy = Math.max(lv.bass, lv.mid * 0.8);
    // A hit bursts only in the slot it lands in (it fades as exp(-age / hitLength)), not for its whole fade.
    const burst = lv.hit > Math.exp(-1 / (SPARK_RATE * fx.hitLength)) ? 1 : 0;
    const want = fx.particles * (SPARK_MAX * energy * energy + burst * SPARK_MAX * 1.5);
    const count = Math.floor(want + hash(slot, 0, 7));
    // What the HUD showed as they left: they leave from its lit pixels.
    const mask = count > 0 ? sparks(t - age) : null;
    if (!mask?.lit.length) continue;
    for (let k = 0; k < count; k++) {
      const r = (n: number) => hash(slot, k, n);
      // Which lit pixel it leaves from, somewhere within it.
      const p = mask.lit[Math.floor(r(2) * mask.lit.length)];
      const x = ((p % mask.w) + r(8)) * (W / mask.w), y = (Math.floor(p / mask.w) + r(9)) * (H / mask.h);
      // Popped off it in any direction but mostly up, harder with the bass and on a burst (m/s).
      const kick = (0.3 + 1.2 * lv.bass + 0.9 * burst) * (0.4 + 0.6 * r(3)), dir = -Math.PI / 2 + (r(4) - 0.5) * 1.6 * Math.PI;
      const vx = Math.cos(dir) * kick * m, vy = (Math.sin(dir) * kick - (0.2 + 0.8 * r(5)) * (0.4 + energy)) * m;
      const size = (0.9 + 1.3 * r(6) + 1.2 * lv.treble) * u * fx.sparkSize;
      const at = flight(x, y, vx, vy, age, H - size, g, m);
      const rest = SPARK_REST * (0.6 + 0.8 * r(1));
      // Gone once it has lain there long enough, or if it flew off the side and won't come back.
      if (at.stopped !== null && age > at.stopped + rest) continue;
      if (at.x < -40 * u || at.x > W + 40 * u) continue;
      const fade = at.stopped === null ? 1 : 1 - (age - at.stopped) / rest, a = Math.min(1, age * 12) * fade * fade;
      let px = at.x, py = at.y;
      if (q) {
        // Out through the lens as a direction, turned with the camera, and back onto the picture.
        const ox = px - cx, oy = py - cy, off = Math.hypot(ox, oy) / f, s = off > 1e-9 ? Math.sin(off) / (Math.hypot(ox, oy)) : 1 / f;
        const [dx, dy, dz] = rotate(q, [ox * s, oy * s, Math.cos(off)]);
        const now = Math.acos(Math.max(-1, Math.min(1, dz)));
        if (now > edge) continue;
        const side = Math.hypot(dx, dy) || 1;
        px = cx + (f * now * dx) / side;
        py = cy + (f * now * dy) / side;
      }
      const hue = ((born * 40 + r(7) * 160 + lv.bass * 120 + age * 120) % 360).toFixed(0);
      // A soft glow (rings fading outward, added up), then the bright core.
      for (const [reach, alpha, light] of SPARK_GLOW) {
        ctx.fillStyle = `hsla(${hue}, 100%, ${light}%, ${(alpha * a).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(px, py, size * reach, 0, 2 * Math.PI); ctx.fill();
      }
    }
  }
  ctx.restore();
}

/**
 * Where a spark is `t` s after leaving (x, y) at (vx, vy) px/s, under gravity `g` px/s² alone, with the ground at y =
 * `ground`, solved exactly: each flight is a parabola to the ground, each bounce keeps SPARK_BOUNCE of the speed it
 * landed with, and once bounces get too small it slides to a stop. `stopped` is when it came to rest (s after
 * leaving), null while it's still moving. `m` is pixels a metre.
 */
function flight(x: number, y: number, vx: number, vy: number, t: number, ground: number, g: number, m: number) {
  let clock = 0;
  // The first fall: y + vy·s + ½g·s² = ground.
  let hit = (-vy + Math.sqrt(vy * vy + 2 * g * Math.max(0, ground - y))) / g;
  for (let bounce = 0; bounce < 12; bounce++) {
    if (t <= clock + hit) {
      const s = t - clock;
      return { x: x + vx * s, y: Math.min(ground, y + vy * s + 0.5 * g * s * s), stopped: null };
    }
    // It lands: bounce back up with some of the speed, losing some sideways speed to the ground.
    x += vx * hit;
    clock += hit;
    const up = (vy + g * hit) * SPARK_BOUNCE;
    y = ground;
    vx *= SPARK_SKID;
    if (up < SPARK_SETTLE * m) break;
    vy = -up;
    hit = (2 * up) / g;
  }
  // Sliding along the ground against friction until it stops.
  const slow = SPARK_FRICTION * g, slide = Math.abs(vx) / slow, s = Math.max(0, Math.min(t - clock, slide));
  return { x: x + vx * s - Math.sign(vx) * 0.5 * slow * s * s, y: ground, stopped: clock + slide };
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
