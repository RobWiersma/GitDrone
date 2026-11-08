import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { OverlayData } from './overlay-renderer';
import { MusicAnalysis } from './music-react';

/**
 * Auto-edit: the flight's best moments cut together on the song's beat. The footage says where the flight is exciting
 * (how fast the picture rushes past), helped by the log (speed, flips and rolls, punch-outs, dives); the music says where
 * to cut (every few beats, lined up on its drop) and where the biggest moment goes (the drop). The song plays straight through; the footage and the OSD jump at each cut.
 */

/** One piece of the edit: footage from `from` to `to` (s, footage time), starting `at` s into the finished video. */
export interface EditClip { from: number; to: number; at: number }

export interface AutoEditOptions {
  /** How long the edit should be, s (shorter when the flight hasn't enough good moments). */
  length: number;
  /** How many of the song's beats each clip runs: 4 is a bar, 8 two bars. */
  beats: number;
  /** 0 for the best edit; any other number shuffles which good moments make it in (Regenerate). */
  seed?: number;
}

/** The excitement grid's spacing, s. */
const STEP = 0.1;
/** Moments kept apart from each other, s, so two clips don't show the same bit of flying. */
const APART = 3;
/** How much a regenerated edit's luck can lift or sink a moment (of its score), so it still picks good ones. */
const LUCK = 0.4;
/** The luck changes every this many seconds of the flight, so whole moments rise and fall together. */
const LUCK_SPAN = 1.5;

/** A repeatable 0..1 from two whole numbers. */
function luck(seed: number, i: number) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** The total length of an edit, s. */
export const editLength = (clips: readonly EditClip[]) => (clips.length ? clips[clips.length - 1].at + clipLength(clips[clips.length - 1]) : 0);
export const clipLength = (c: EditClip) => c.to - c.from;

/** Where footage time `f` lands in the finished video, or null when no clip shows it. */
export function editOut(clips: readonly EditClip[], f: number): number | null {
  for (const c of clips) if (f >= c.from && f < c.to) return c.at + (f - c.from);
  return null;
}

/** The clip playing `out` s into the finished video (or -1 past the end). */
export function clipAt(clips: readonly EditClip[], out: number): number {
  for (let i = clips.length - 1; i >= 0; i--) if (out >= clips[i].at) return out < clips[i].at + clipLength(clips[i]) ? i : -1;
  return -1;
}

/** How much the footage's picture changes, every `step` s of footage time from 0. */
export interface FootageMotion { step: number; motion: Float32Array }

/** The size the footage is watched at: plenty to see the picture rush past, tiny to read back. */
const WATCH_W = 96, WATCH_H = 54;

/**
 * Watches the footage for how fast its picture changes: each frame STEP s apart, shrunk to 96×54 greys, against the one
 * before. Flying close to things (a gap, a container, a tree) and flips rush the picture past; cruising over open
 * ground barely moves it. The log can't see that, and it's what makes a moment worth watching. Decodes the whole clip
 * once (a minute or two for long 4K), so callers keep the result. Null when the browser can't read it or it's cancelled.
 */
export async function footageMotion(file: File, progress: (done: number) => void, control: { cancelled: boolean }): Promise<FootageMotion | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const n = Math.max(1, Math.floor((await track.computeDuration()) / STEP));
    const sink = new CanvasSink(track, { width: WATCH_W, height: WATCH_H, fit: 'fill' });
    const small = document.createElement('canvas');
    small.width = WATCH_W;
    small.height = WATCH_H;
    const ctx = small.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const motion = new Float32Array(n), size = WATCH_W * WATCH_H;
    let prev: Float32Array | null = null, k = 0;
    for await (const frame of sink.canvasesAtTimestamps(Array.from({ length: n }, (_, i) => i * STEP))) {
      if (control.cancelled) return null;
      if (frame) {
        ctx.drawImage(frame.canvas, 0, 0, WATCH_W, WATCH_H);
        const px = ctx.getImageData(0, 0, WATCH_W, WATCH_H).data, grey = new Float32Array(size);
        let change = 0;
        for (let i = 0; i < size; i++) {
          grey[i] = 0.3 * px[4 * i] + 0.59 * px[4 * i + 1] + 0.11 * px[4 * i + 2];
          if (prev) change += Math.abs(grey[i] - prev[i]);
        }
        if (prev && k < n) motion[k] = change / size;
        prev = grey;
      }
      k++;
      if (k % 25 === 0) progress(k / n);
    }
    if (n > 1) motion[0] = motion[1];
    return { step: STEP, motion };
  } finally {
    input.dispose();
  }
}

/** A trick found in the log: when it starts and ends (log time, s), what it is, and how big (about 1 to 2). */
export interface Trick { from: number; to: number; kind: 'flip' | 'roll' | 'drop'; punched: boolean; size: number }

/** Roll or pitch stick at least this far over (of full) counts as throwing a flip or roll. */
const TRICK_STICK = 0.8;
/** How long the stick has to stay over, s: a flip's at about 0.1 to 0.3 s of full stick, a twitch less. */
const TRICK_HELD = 0.1;
/** A drop: at least this much height lost, m, within DROP_WITHIN s, mostly on low throttle (falling, not flying down). */
const DROP_LOSS = 6, DROP_WITHIN = 2.5;

/**
 * The flight's tricks, from the sticks and height in the log (there's no gyro here, so how far it turned is a guess
 * from how long the stick was held). Flips and rolls: roll or pitch stick held near full, with whether the throttle
 * punched back up within a second after (a Matty flip or a power-out). Drops: a fall of DROP_LOSS m or more inside
 * DROP_WITHIN s, mostly on low throttle (off a building or a tree, or a dive), from the barometer with its spikes
 * thrown out (else the GPS).
 */
export function findTricks(data: OverlayData): Trick[] {
  const sticks = data.sticks ?? [], out: Trick[] = [];
  const throttleAt = (t: number) => {
    let lo = 0, hi = sticks.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (sticks[mid][0] <= t) lo = mid; else hi = mid - 1; }
    return sticks.length ? (sticks[lo][4] - 1000) / 1000 : 0;
  };
  let run: { from: number; to: number; axis: 'roll' | 'pitch'; low: number } | null = null;
  const close = () => {
    if (run && run.to - run.from >= TRICK_HELD - 1e-6) {
      let punch = 0;
      for (let dt = 0; dt <= 1; dt += 0.04) punch = Math.max(punch, throttleAt(run.to + dt));
      const punched = run.low <= 0.15 && punch >= 0.45;
      // Over in under a second where a drop runs two or three, so it counts for more per moment to hold its own.
      const size = 1.3 + Math.min(0.5, (run.to - run.from) / 0.3) + (punched ? 0.3 : 0);
      out.push({ from: run.from, to: run.to, kind: run.axis === 'pitch' ? 'flip' : 'roll', punched, size });
    }
    run = null;
  };
  for (const p of sticks) {
    const r = Math.abs(p[1]) / 500, q = Math.abs(p[2]) / 500;
    if (Math.max(r, q) >= TRICK_STICK) {
      run ??= { from: p[0], to: p[0], axis: q > r ? 'pitch' : 'roll', low: 1 };
      run.to = p[0];
      run.low = Math.min(run.low, (p[4] - 1000) / 1000);
    } else close();
  }
  close();

  // Height, a sample every 0.1 s, with the barometer's spikes (tens of metres for a moment) dropped first.
  const baro = (data.telemetry ?? []).filter(p => p[2] !== null).map(p => [p[0], p[2]!] as const);
  const track = data.track?.points ?? [];
  const raw = baro.length > 10 ? baro : track.map(p => [p[0], p[3]] as const);
  const clean = raw.filter((p, i) => {
    const near = raw.slice(Math.max(0, i - 5), i + 6).map(q => q[1]).sort((a, b) => a - b);
    return Math.abs(p[1] - near[near.length >> 1]) < 15;
  });
  if (clean.length > 10) {
    const t0 = clean[0][0], n = Math.floor((clean[clean.length - 1][0] - t0) / STEP);
    const h = smooth(sample(clean.map(p => p[0] - t0), clean.map(p => p[1]), n), 3);
    const within = Math.round(DROP_WITHIN / STEP);
    for (let k = 0; k < n; k++) {
      // The lowest point within reach, and how much was lost getting there.
      let low = k;
      for (let j = k + 1; j <= Math.min(n - 1, k + within); j++) if (h[j] < h[low]) low = j;
      const loss = h[k] - h[low];
      if (loss < DROP_LOSS) continue;
      // Starting from the top of the fall, not partway down it.
      if (k > 0 && h[k - 1] >= h[k]) continue;
      let thr = 0;
      for (let j = k; j <= low; j++) thr += throttleAt(t0 + j * STEP);
      if (thr / (low - k + 1) > 0.3) continue;
      const from = t0 + k * STEP, to = t0 + low * STEP;
      if (out.some(o => o.kind === 'drop' && from < o.to)) continue;
      out.push({ from, to, kind: 'drop', punched: false, size: Math.min(1.5, 0.4 + loss / 10) });
      k = low;
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

/**
 * How exciting the flight is every STEP s of log time, 0 (sitting on the ground) up. Tricks (see findTricks) stand
 * above everything, from a little before each to a second after. Then mostly how fast the footage's picture changes
 * (shown at footage time log + `offset`), when it's been watched; then from the log: speed against the flight's own
 * top speeds, flips and rolls (roll or pitch stick held near full), punch-outs (throttle snapped up), current against
 * its peaks, and fast climbs or dives. Each part is measured against this flight, so a slow cruiser's best bits still
 * stand out.
 */
export function excitement(data: OverlayData, seconds: number, footage: FootageMotion | null = null, offset = 0,
                           tricks: Trick[] = findTricks(data)): Float32Array {
  const n = Math.max(1, Math.ceil(seconds / STEP)), grid = (k: number) => k * STEP;
  const track = data.track?.points ?? [], sticks = data.sticks ?? [], battery = data.battery?.points ?? [];
  const speed = sample(track.map(p => p[0]), track.map(p => p[4]), n);
  const amps = sample(battery.map(p => p[0]), battery.map(p => p[2] ?? 0), n);
  // Height from the barometer where there is one (smoother), else the GPS.
  const baro = (data.telemetry ?? []).filter(p => p[2] !== null);
  const height = baro.length > 10 ? sample(baro.map(p => p[0]), baro.map(p => p[2]!), n) : sample(track.map(p => p[0]), track.map(p => p[3]), n);
  // How hard the craft is being thrown about: roll or pitch stick past half, as a share of the rest of the way to full,
  // with yaw counting half. Held over 0.4 s so a flip (a second of full stick) counts and a twitch doesn't.
  const roll = sample(sticks.map(p => p[0]), sticks.map(p => {
    const r = Math.max(Math.abs(p[1]), Math.abs(p[2])) / 500, y = Math.abs(p[3]) / 500;
    return Math.max(0, (r - 0.5) / 0.5, (y - 0.6) / 0.4 * 0.5);
  }), n);
  const throttle = sample(sticks.map(p => p[0]), sticks.map(p => (p[4] - 1000) / 1000), n);

  const topSpeed = Math.max(5, percentile(speed, 0.95)), topAmps = Math.max(5, percentile(amps, 0.95));
  const flips = smooth(roll, 2);
  const climb = new Float32Array(n), punch = new Float32Array(n);
  const d = Math.round(0.5 / STEP);
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - d), b = Math.min(n - 1, k + d);
    climb[k] = Math.abs(height[b] - height[a]) / Math.max(STEP, grid(b - a));
    // The throttle's rise over the last 0.3 s.
    punch[k] = Math.max(0, throttle[k] - throttle[Math.max(0, k - 3)]) / 0.5;
  }
  const topClimb = Math.max(3, percentile(climb, 0.95));
  // The footage's motion at each log moment, against the flight's own busiest (0 where there's no footage).
  const seen = new Float32Array(n);
  if (footage) {
    for (let k = 0; k < n; k++) {
      const i = Math.round((k * STEP + offset) / footage.step);
      seen[k] = i >= 0 && i < footage.motion.length ? footage.motion[i] : 0;
    }
  }
  const watched = smooth(seen, 2), topSeen = Math.max(1, percentile(watched, 0.95));
  // Each trick from 0.6 s before it (the flip starts before the stick's let go) to a second after (the landing).
  const trick = new Float32Array(n);
  for (const t of tricks) {
    for (let k = Math.max(0, Math.floor((t.from - 0.6) / STEP)); k <= Math.min(n - 1, Math.ceil((t.to + 1) / STEP)); k++) {
      trick[k] = Math.max(trick[k], t.size);
    }
  }
  const score = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0.35 * Math.min(1.3, speed[k] / topSpeed) + 0.3 * Math.min(1, flips[k]) + 0.15 * Math.min(1, punch[k])
      + 0.1 * Math.min(1.3, amps[k] / topAmps) + 0.1 * Math.min(1.3, climb[k] / topClimb);
    if (footage) s = 0.35 * s + 0.65 * Math.min(1.3, watched[k] / topSeen);
    // On the ground or idling: not a moment, whatever the noise says (but a flip on zero throttle is no idle).
    if (speed[k] < 2 && throttle[k] < 0.15 && !trick[k]) s *= 0.2;
    score[k] = s + trick[k];
  }
  return smooth(score, 3);
}

/**
 * The edit: cuts on the song's beat from `songStart` (s into the song), every `opts.beats` beats, on a grid that runs through the first drop (or the song's bars), for the grid line nearest `opts.length`
 * s. The flight's best moment goes on the drop, then the rest by how loud the music is under them, each taking the best
 * moment left of its length. Moments come from log time `logFrom` to `logTo`, shown at footage time log + `offset`.
 * Empty when there's nothing to cut.
 */
export function autoEdit(score: Float32Array, logFrom: number, logTo: number, offset: number,
                         music: MusicAnalysis, songStart: number, sensitivity: number, opts: AutoEditOptions): EditClip[] {
  const { beats, bar, period } = music.beats();
  const every = Math.max(1, Math.round(opts.beats));
  const inEdit = (t: number) => t - songStart;
  // The beat nearest a moment of the song.
  const nearest = (t: number) => {
    let k = 0;
    for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i] - t) < Math.abs(beats[k] - t)) k = i;
    return k;
  };
  // The grid runs through the first drop in the edit (where the best moment goes), else through the song's bars.
  const drop = Array.from(music.triggers('drops', sensitivity)).find(t => inEdit(t) > period && inEdit(t) < opts.length - period);
  const anchor = drop !== undefined ? nearest(drop) : bar;
  const grid = Array.from(beats.keys()).filter(k => (((k - anchor) % every) + every) % every === 0).map(k => inEdit(beats[k]));
  // The edit runs to the grid line nearest the length asked for, so it ends on a cut too, never past the song.
  const usable = grid.filter(t => t > period * 0.75);
  if (!usable.length) return [];
  const L = usable.reduce((a, b) => (Math.abs(b - opts.length) < Math.abs(a - opts.length) ? b : a));
  // The lead-in before the first grid line joins the first clip when it's under half a clip: no blip of a shot to open.
  const lead = (every * period) / 2;
  const cuts = [0, ...usable.filter(t => t >= Math.min(lead, L) && t < L - period * 0.75)];
  const slots = cuts.map((at, i) => ({ at, len: (cuts[i + 1] ?? L) - at }));

  // The hero slot: the one starting on the drop, else the loudest.
  const heroAt = drop !== undefined ? inEdit(beats[nearest(drop)]) : undefined;
  const heroSlot = heroAt !== undefined ? cuts.findIndex(c => Math.abs(c - heroAt) < 0.01) : -1;
  const loudness = (s: { at: number; len: number }) => {
    let sum = 0;
    for (let k = 0; k < 5; k++) {
      const lv = music.at(songStart + s.at + ((k + 0.5) / 5) * s.len, sensitivity, 0.15, { osd: 'hits', footage: 'hits', vignette: 'hits' });
      sum += lv.bass + lv.mid + lv.treble;
    }
    return sum;
  };
  const order = slots.map((s, i) => ({ i, loud: i === heroSlot ? Infinity : loudness(s) })).sort((a, b) => b.loud - a.loud).map(o => o.i);

  // Each slot takes the best stretch of its length that's left, by the mean excitement over it.
  // Regenerated: each stretch of the flight gets some luck, up or down, so other good moments win this time.
  const seed = Math.round(opts.seed ?? 0);
  const lucky = (k: number) => (seed ? 1 + LUCK * (luck(seed, Math.floor((k * STEP) / LUCK_SPAN)) - 0.5) * 2 : 1);
  const sum = new Float64Array(score.length + 1);
  for (let k = 0; k < score.length; k++) sum[k + 1] = sum[k] + score[k] * lucky(k);
  const lo = Math.max(0, Math.ceil(logFrom / STEP)), hi = Math.min(score.length, Math.floor(logTo / STEP));
  const used: [number, number][] = [];
  const picked: (EditClip | null)[] = slots.map(() => null);
  for (const i of order) {
    const n = Math.max(1, Math.round(slots[i].len / STEP));
    let best = -1, bestMean = -Infinity;
    for (let k = lo; k + n <= hi; k++) {
      const a = k * STEP, b = (k + n) * STEP;
      if (used.some(([u, v]) => a < v + APART && b > u - APART)) continue;
      const mean = (sum[k + n] - sum[k]) / n;
      if (mean > bestMean) { bestMean = mean; best = k; }
    }
    if (best < 0) continue;
    const from = best * STEP;
    used.push([from, from + slots[i].len]);
    picked[i] = { from: from + offset, to: from + offset + slots[i].len, at: slots[i].at };
  }
  // Stop at the first slot nothing was left for: the edit ends there, still on a cut.
  const out: EditClip[] = [];
  for (const c of picked) {
    if (!c) break;
    out.push(c);
  }
  return out;
}

/** `values` at `times` resampled onto the STEP grid (n points), held flat past either end; zeros with no samples. */
function sample(times: number[], values: number[], n: number): Float32Array {
  const out = new Float32Array(n);
  if (!times.length) return out;
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = k * STEP;
    while (j < times.length - 2 && times[j + 1] < t) j++;
    const t0 = times[j], t1 = times[j + 1] ?? t0;
    if (t <= t0 || t1 === t0) out[k] = values[j];
    else if (t >= t1) out[k] = values[j + 1];
    else out[k] = values[j] + ((values[j + 1] - values[j]) * (t - t0)) / (t1 - t0);
  }
  return out;
}

/** A running mean over `r` points either side. */
function smooth(a: Float32Array, r: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let k = 0; k < a.length; k++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, k - r); j <= Math.min(a.length - 1, k + r); j++) { s += a[j]; c++; }
    out[k] = s / c;
  }
  return out;
}

function percentile(a: Float32Array, q: number): number {
  if (!a.length) return 0;
  const s = Float32Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
