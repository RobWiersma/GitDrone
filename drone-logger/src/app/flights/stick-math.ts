import { StickPoint } from './flight.models';

export type Axis = 'roll' | 'pitch' | 'yaw' | 'throttle';
export type StickMode = 1 | 2 | 3 | 4;
export type StickAxes = Record<Axis, number>;

/** Which axis each stick moves, per transmitter mode: [left x, left y, right x, right y]. */
export const MODES: Record<StickMode, [Axis, Axis, Axis, Axis]> = {
  1: ['yaw', 'pitch', 'roll', 'throttle'],
  2: ['yaw', 'throttle', 'roll', 'pitch'],
  3: ['roll', 'pitch', 'yaw', 'throttle'],
  4: ['roll', 'throttle', 'yaw', 'pitch'],
};

export const AXIS_LABELS: Record<Axis, string> = { roll: 'Roll', pitch: 'Pitch', yaw: 'Yaw', throttle: 'Thr' };

const MODE_KEY = 'gitdrone-stick-mode';

export function readStickMode(): StickMode {
  try {
    const v = Number(localStorage.getItem(MODE_KEY));
    return v === 1 || v === 3 || v === 4 ? v : 2;
  } catch {
    return 2;
  }
}

export function saveStickMode(m: StickMode) {
  try { localStorage.setItem(MODE_KEY, String(m)); } catch { /* not persisted */ }
}

/** Values at time t, linearly interpolated between the 25 Hz samples. */
export function sampleSticks(points: StickPoint[], t: number): StickPoint {
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
export function stickAxes(p: StickPoint): StickAxes {
  return {
    roll: p[1] / 500,
    pitch: p[2] / 500,
    // Betaflight stores rcCommand[YAW] inverted relative to the stick, so flip it back for display.
    yaw: -p[3] / 500,
    throttle: (p[4] - 1500) / 500,
  };
}

/** The logged rcCommand value for an axis, as Blackbox Explorer prints it (throttle 1000..2000, others ±500). */
export function rawStick(p: StickPoint, axis: Axis): number {
  return Math.round(p[{ roll: 1, pitch: 2, yaw: 3, throttle: 4 }[axis]]);
}

/** Throttle stick as 0..100 %. */
export const throttlePercent = (a: StickAxes) => Math.round(((a.throttle + 1) / 2) * 100);
