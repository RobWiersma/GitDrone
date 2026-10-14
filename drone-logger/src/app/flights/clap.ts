/**
 * Lining recordings up by their sound.
 *
 * Claps: a clap is a short, sharp burst of high-pitched sound, so we keep only the frequencies above ~2.5 kHz (where
 * voices, wind and handling noise are weak), measure loudness in 5 ms steps, and look for the first moment it jumps far
 * above the half second before it. The same method on both recordings means the two claps line up.
 *
 * Motor sound: the motors get louder as the throttle goes up, so the loudness of the footage's sound over time follows
 * the throttle trace in the log. Sliding one along the other and finding where they match best gives the moment the log
 * starts in the footage, using the whole flight rather than one moment.
 *
 * Arming and launch: a phone on the ground hears the quad come and go, so its loudness doesn't follow the throttle. What
 * it does hear clearly is the motors arming (a jump from quiet to a steady idle) and the launch a known time later (the
 * log has both), so we look for that pair.
 */

import type { StickPoint } from './flight.models';

export interface ClapResult {
  /** Seconds into the recording, earliest first (up to `max` of them, at least 0.3 s apart). */
  claps: number[];
  duration: number;
}

const HOP_S = 0.005;
const BACKGROUND_S = 0.5;
const MIN_GAP_S = 0.3;

// Claps have much of their snap above 8 kHz, so keep the full band (48 kHz is what phones and cameras record anyway).
const DECODE_RATE = 48000;
const decoded = new WeakMap<Blob, Promise<AudioBuffer>>();

/** The recording's sound, decoded once per file however many times it's listened to. */
function decode(file: Blob): Promise<AudioBuffer> {
  let audio = decoded.get(file);
  if (!audio) {
    audio = (async () => {
      const ctx = new AudioContext({ sampleRate: DECODE_RATE });
      try {
        return await ctx.decodeAudioData(await file.arrayBuffer());
      } finally {
        ctx.close();
      }
    })();
    audio.catch(() => decoded.delete(file));
    decoded.set(file, audio);
  }
  return audio;
}

/** The recording's sound, mixed to mono and high-passed at `cutoff` Hz. */
async function highpassed(file: Blob, cutoff: number): Promise<{ samples: Float32Array; rate: number; duration: number }> {
  const audio = await decode(file);
  const offline = new OfflineAudioContext(1, audio.length, audio.sampleRate);
  const source = offline.createBufferSource();
  source.buffer = audio;
  const filter = offline.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = cutoff;
  source.connect(filter).connect(offline.destination);
  source.start();
  return { samples: (await offline.startRendering()).getChannelData(0), rate: audio.sampleRate, duration: audio.duration };
}

/** RMS loudness in steps of `hop` samples. */
function envelope(samples: Float32Array, hop: number): Float32Array {
  const frames = Math.floor(samples.length / hop);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let k = f * hop, end = k + hop; k < end; k++) sum += samples[k] * samples[k];
    env[f] = Math.sqrt(sum / hop);
  }
  return env;
}

export async function findClaps(file: Blob, max = 3): Promise<ClapResult> {
  const { samples, rate, duration } = await highpassed(file, 2500);
  const env = envelope(samples, Math.max(1, Math.round(rate * HOP_S)));
  const frames = env.length;
  let peak = 0;
  for (const e of env) if (e > peak) peak = e;
  const prefix = new Float64Array(frames + 1);
  for (let f = 0; f < frames; f++) prefix[f + 1] = prefix[f] + env[f];

  const back = Math.round(BACKGROUND_S / HOP_S);
  const gap = Math.round(MIN_GAP_S / HOP_S);
  const claps: number[] = [];
  // Many recordings open with a moment of digital silence; sound starting after it isn't a clap, so give the background
  // half a second of real sound first.
  const firstSound = env.findIndex(e => e > 1e-4);
  if (firstSound < 0) return { claps, duration };
  for (let f = Math.max(3, firstSound + back); f < frames && claps.length < max; f++) {
    // Background: the average of the half second before, leaving out the last couple of steps (the clap's own rise).
    const from = Math.max(0, f - back), to = Math.max(from + 1, f - 2);
    const background = (prefix[to] - prefix[from]) / (to - from);
    const loudEnough = env[f] > Math.max(10 * background, 0.08 * peak, 1e-4);
    const sudden = env[f] > 3 * env[f - 2];
    if (loudEnough && sudden) {
      claps.push(+(f * HOP_S).toFixed(3));
      f += gap; // the echo and tail of this clap aren't new claps
    }
  }
  return { claps, duration };
}

export interface MotorMatch {
  /** Seconds into the footage where the log (arming) starts. Negative when arming came before the footage. */
  offset: number;
  /** How well the sound followed the throttle at the best match, -1..1. */
  score: number;
  /** The best match stands out from the next best (more than a second away): a sync to trust. */
  confident: boolean;
}

const MATCH_HZ = 25;

/** Even 25 Hz throttle trace (0..1) from the log's stick samples. */
function throttleTrace(sticks: StickPoint[]): Float32Array {
  const end = sticks[sticks.length - 1][0];
  const out = new Float32Array(Math.floor(end * MATCH_HZ) + 1);
  let j = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / MATCH_HZ;
    while (j + 1 < sticks.length && sticks[j + 1][0] <= t) j++;
    out[i] = Math.min(1, Math.max(0, (sticks[j][4] - 1000) / 1000));
  }
  return out;
}


/**
 * Where the log starts in the footage, by matching the footage's motor sound to the log's throttle. Loudness is
 * compared on a log scale (it follows the throttle more evenly that way) and every shift with enough overlap is tried.
 */
export async function matchMotorSound(footage: Blob, sticks: StickPoint[]): Promise<MotorMatch | null> {
  if (sticks.length < MATCH_HZ * 10) return null;
  const { samples, rate } = await highpassed(footage, 800);
  const env = envelope(samples, Math.round(rate / MATCH_HZ));
  for (let i = 0; i < env.length; i++) env[i] = Math.log(env[i] + 1e-4);
  const thr = throttleTrace(sticks);

  // Running sums, so each overlap's own mean and spread cost nothing to work out.
  const sums = (v: Float32Array) => {
    const s = new Float64Array(v.length + 1), q = new Float64Array(v.length + 1);
    for (let i = 0; i < v.length; i++) { s[i + 1] = s[i] + v[i]; q[i + 1] = q[i] + v[i] * v[i]; }
    return { s, q };
  };
  const T = sums(thr), E = sums(env);

  // Lag L: log frame i lines up with footage frame i + L. The overlap has to cover most of the shorter recording, so a
  // few seconds at either end can't win by chance; each overlap is scored by its own correlation (-1..1).
  const minOverlap = Math.min(thr.length, env.length) * 0.6;
  const scores = new Map<number, number>();
  let best = -Infinity, bestLag = 0;
  for (let lag = -thr.length + 1; lag < env.length; lag++) {
    const i0 = Math.max(0, -lag), i1 = Math.min(thr.length, env.length - lag);
    const n = i1 - i0;
    if (n < minOverlap) continue;
    let sumXY = 0;
    for (let i = i0; i < i1; i++) sumXY += thr[i] * env[i + lag];
    const sx = T.s[i1] - T.s[i0], sxx = T.q[i1] - T.q[i0];
    const sy = E.s[i1 + lag] - E.s[i0 + lag], syy = E.q[i1 + lag] - E.q[i0 + lag];
    const cov = sumXY - (sx * sy) / n;
    const spread = Math.sqrt((sxx - (sx * sx) / n) * (syy - (sy * sy) / n));
    const score = spread > 0 ? cov / spread : 0;
    scores.set(lag, score);
    if (score > best) { best = score; bestLag = lag; }
  }
  if (!scores.size) return null;

  // Sub-frame refinement from the neighbours, then how clearly the winner beats anything over a second away.
  const a = scores.get(bestLag - 1), b = best, c = scores.get(bestLag + 1);
  const shift = a !== undefined && c !== undefined && a - 2 * b + c !== 0 ? (a - c) / (2 * (a - 2 * b + c)) : 0;
  let runnerUp = -Infinity;
  for (const [lag, score] of scores) if (Math.abs(lag - bestLag) > MATCH_HZ && score > runnerUp) runnerUp = score;
  return {
    offset: Math.round(((bestLag + shift) / MATCH_HZ) * 100) / 100,
    score: Math.round(best * 100) / 100,
    confident: best > 0.25 && (runnerUp <= 0 || best > runnerUp * 1.25),
  };
}

export interface ArmingMatch {
  /** Seconds into the recording where the motors arm, which is where the log starts. */
  logStart: number;
  /** How much louder idle is than before it plus how much louder the launch is than idle, in dB. */
  score: number;
  /** Clearly better than anything else in the recording (more than 2 s away). */
  confident: boolean;
}

/**
 * Where the log starts in a recording made near the quad (a phone on the ground), from the sound of arming followed by
 * the launch `takeoff` seconds later. Each moment is scored as: quiet for up to 2 s before, a steady idle until the launch,
 * and a burst at the launch. Needs at least 1.5 s of idle between arming and launch to tell them apart.
 */
export async function findArming(recording: Blob, takeoff: number): Promise<ArmingMatch | null> {
  if (takeoff < 1.5) return null;
  const { samples, rate } = await highpassed(recording, 800);
  const env = envelope(samples, Math.round(rate / MATCH_HZ));
  for (let i = 0; i < env.length; i++) env[i] = 20 * Math.log10(env[i] + 1e-5);
  const n = env.length;
  const s = new Float64Array(n + 1), q = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { s[i + 1] = s[i] + env[i]; q[i + 1] = q[i] + env[i] * env[i]; }
  const mean = (i: number, j: number) => (s[j] - s[i]) / (j - i);
  const spread = (i: number, j: number) => Math.sqrt(Math.max(0, (q[j] - q[i]) / (j - i) - mean(i, j) ** 2));

  const before = 2 * MATCH_HZ, edge = Math.round(0.3 * MATCH_HZ), lift = Math.round(takeoff * MATCH_HZ);
  const burst = Math.round(0.2 * MATCH_HZ), burstFrom = lift - edge, burstTo = lift + Math.round(1.5 * MATCH_HZ);
  const scores: [number, number][] = [];
  for (let f = Math.round(0.5 * MATCH_HZ); f + burstTo + burst <= n; f++) {
    const quiet = mean(Math.max(0, f - before), f); // the recording may start only just before arming
    const idle = mean(f + edge, f + lift - edge);
    let loudest = -Infinity;
    for (let i = f + burstFrom; i < f + burstTo; i++) loudest = Math.max(loudest, mean(i, i + burst));
    // A real idle is steady; a busy stretch (talking, wind gusts) that happens to be loud is marked down.
    scores.push([f, idle - quiet + (loudest - idle) - 2 * spread(f + edge, f + lift - edge)]);
  }
  if (!scores.length) return null;
  let best = scores[0];
  for (const c of scores) if (c[1] > best[1]) best = c;
  let runnerUp = -Infinity;
  for (const [f, score] of scores) if (Math.abs(f - best[0]) > 2 * MATCH_HZ && score > runnerUp) runnerUp = score;
  return {
    logStart: Math.round((best[0] / MATCH_HZ) * 100) / 100,
    score: Math.round(best[1]),
    confident: best[1] >= 15 && (runnerUp <= 0 || best[1] > runnerUp * 1.25),
  };
}

export interface SoundProfile {
  duration: number;
  /** Loudness above 800 Hz (the band the matching listens to) in even steps across the recording, 0 (quietest) to 1. */
  levels: Float32Array;
}

/** A recording's loudness over time, for drawing. Quiet is the 2nd percentile so a silent stretch doesn't flatten the rest. */
export async function soundProfile(recording: Blob, steps = 800): Promise<SoundProfile> {
  const { samples, duration } = await highpassed(recording, 800);
  const env = envelope(samples, Math.max(1, Math.floor(samples.length / steps)));
  const db = env.map(e => 20 * Math.log10(e + 1e-5));
  const sorted = [...db].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.02)], top = sorted[sorted.length - 1];
  const range = Math.max(1, top - floor);
  return { duration, levels: db.map(v => Math.min(1, Math.max(0, (v - floor) / range))) };
}
