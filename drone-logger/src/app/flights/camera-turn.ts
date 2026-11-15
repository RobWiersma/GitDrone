import { StickPoint } from './flight.models';

/**
 * How the camera turned, from the log's gyro: its orientation at every moment, so things drawn "in the world" (the
 * music's sparks) can swing across the picture as the quad rolls, flips and yaws, like the footage does.
 *
 * Camera axes: +x right on the picture, +y down, +z out through the lens. Betaflight's gyro is roll right, pitch nose
 * down and yaw nose left positive (the same way round as rcCommand), which is +z, -x and -y here. The camera's uptilt
 * is ignored.
 */
export type Quat = readonly [number, number, number, number]; // w, x, y, z

const IDENTITY: Quat = [1, 0, 0, 0];

function mul(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}
const conj = (q: Quat): Quat => [q[0], -q[1], -q[2], -q[3]];
const normal = (q: Quat): Quat => { const n = Math.hypot(...q); return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; };

/** A turn of (x, y, z) radians about the camera's own axes. */
function turnBy(x: number, y: number, z: number): Quat {
  const a = Math.hypot(x, y, z);
  if (a < 1e-9) return IDENTITY;
  const s = Math.sin(a / 2) / a;
  return [Math.cos(a / 2), x * s, y * s, z * s];
}

/** Rotates vector `v` by `q`. */
export function rotate(q: Quat, v: readonly [number, number, number]): [number, number, number] {
  const r = mul(mul(q, [0, v[0], v[1], v[2]]), conj(q));
  return [r[1], r[2], r[3]];
}

const RAD = Math.PI / 180;
/** The gyro's rates for a row, as radians a second about the camera's axes. */
const rates = (p: StickPoint) => [-(p[6] ?? 0) * RAD, -(p[7] ?? 0) * RAD, (p[5] ?? 0) * RAD] as const;

/**
 * The accelerometer's push the other way round, in g: it feels what holds the craft up (thrust and drag), which on
 * average over a few seconds balances gravity, so this averages out to down. Betaflight's axes are x forward, y left,
 * z up; here that's +z, -x and -y. Crash spikes are capped at DOWN_CAP g. Null on a row without it.
 */
function felt(p: StickPoint): [number, number, number] | null {
  const x = p[10], y = p[11], z = p[12];
  if (x === undefined || y === undefined || z === undefined) return null;
  const k = Math.min(1, DOWN_CAP / (Math.hypot(x, y, z) || 1));
  return [y * k, z * k, -x * k];
}
/**
 * Down is that push averaged over the last DOWN_SETTLE s or so, held still in the world by turning it back with the gyro
 * as the craft turns. (Over less, thrust wins: it always pushes along the craft's own up.)
 */
const DOWN_SETTLE = 3, DOWN_CAP = 4;

export class CameraTurn {
  /** The camera's orientation (camera to world) at each row's time. */
  private orient: Quat[] = [];
  /** Which way is down in the camera's frame at each row's time (gyro and accelerometer fused); empty without them. */
  private downs: [number, number, number][] = [];

  private constructor(private rows: StickPoint[]) {
    let q = IDENTITY;
    rows.forEach((p, i) => {
      this.orient.push(q);
      const next = rows[i + 1];
      if (next) {
        const [x, y, z] = rates(p), dt = next[0] - p[0];
        q = normal(mul(q, turnBy(x * dt, y * dt, z * dt)));
      }
    });
    this.fuseDown();
  }

  /**
   * Works out `downs`: the accelerometer's push, averaged (an exponential average, DOWN_SETTLE s) in a frame turned
   * back with the gyro so it stays put in the world, starting from the first reading (sitting on the ground).
   */
  private fuseDown() {
    const rows = this.rows, first = rows.findIndex(r => felt(r));
    if (first < 0) return;
    let g = felt(rows[first])!;
    rows.forEach((p, i) => {
      if (i > 0) {
        const [x, y, z] = rates(rows[i - 1]), dt = p[0] - rows[i - 1][0];
        g = rotate(conj(turnBy(x * dt, y * dt, z * dt)), g);
        const m = felt(p);
        if (m && dt > 0) {
          const k = 1 - Math.exp(-dt / DOWN_SETTLE);
          g = [g[0] + (m[0] - g[0]) * k, g[1] + (m[1] - g[1]) * k, g[2] + (m[2] - g[2]) * k];
        }
      }
      const n = Math.hypot(...g) || 1;
      this.downs.push([g[0] / n, g[1] / n, g[2] / n]);
    });
  }

  /** From a log's sticks, when it has the gyro; null otherwise. */
  static from(rows: StickPoint[] | null | undefined): CameraTurn | null {
    return rows && rows.length > 1 && rows.some(r => r.length >= 8 && (r[5] || r[6] || r[7])) ? new CameraTurn(rows) : null;
  }

  /** The camera's orientation at log time `t`, s. */
  at(t: number): Quat {
    const rows = this.rows;
    if (t <= rows[0][0]) return this.orient[0];
    let lo = 0, hi = rows.length - 1;
    if (t >= rows[hi][0]) return this.orient[hi];
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (rows[mid][0] <= t) lo = mid; else hi = mid; }
    const [x, y, z] = rates(rows[lo]), dt = t - rows[lo][0];
    return mul(this.orient[lo], turnBy(x * dt, y * dt, z * dt));
  }

  /**
   * Which way is down in the camera's frame at log time `t` (a unit vector; (0, 1, 0) when it's level), or null when
   * the log has no accelerometer.
   */
  down(t: number): [number, number, number] | null {
    const rows = this.rows, downs = this.downs;
    if (!downs.length) return null;
    if (t <= rows[0][0]) return downs[0];
    let lo = 0, hi = rows.length - 1;
    if (t >= rows[hi][0]) return downs[hi];
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (rows[mid][0] <= t) lo = mid; else hi = mid; }
    const [x, y, z] = rates(rows[lo]), dt = t - rows[lo][0];
    return rotate(conj(turnBy(x * dt, y * dt, z * dt)), downs[lo]);
  }

  /** How fast the camera is turning at log time `t`: radians a second about its own x, y and z axes. */
  rate(t: number): readonly [number, number, number] {
    const rows = this.rows;
    if (t <= rows[0][0] || t >= rows[rows.length - 1][0]) return [0, 0, 0];
    let lo = 0, hi = rows.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (rows[mid][0] <= t) lo = mid; else hi = mid; }
    return rates(rows[lo]);
  }

  /** A direction in the camera's frame at log time `t`, in the world's (the frame the camera started the log in). */
  toWorld(t: number, v: readonly [number, number, number]) {
    return rotate(this.at(t), v);
  }

  /** A direction in the world's frame, as the camera sees it at log time `t`. */
  toCamera(t: number, v: readonly [number, number, number]) {
    return rotate(conj(this.at(t)), v);
  }

  /** What takes a direction the camera saw at log time `from` to where the camera sees it at `to`. */
  between(from: number, to: number): Quat {
    return mul(conj(this.at(to)), this.at(from));
  }
}
