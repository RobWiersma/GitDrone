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

export class CameraTurn {
  /** The camera's orientation (camera to world) at each row's time. */
  private orient: Quat[] = [];

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

  /** How fast the camera is turning at log time `t`: radians a second about its own x, y and z axes. */
  rate(t: number): readonly [number, number, number] {
    const rows = this.rows;
    if (t <= rows[0][0] || t >= rows[rows.length - 1][0]) return [0, 0, 0];
    let lo = 0, hi = rows.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (rows[mid][0] <= t) lo = mid; else hi = mid; }
    return rates(rows[lo]);
  }

  /** What takes a direction the camera saw at log time `from` to where the camera sees it at `to`. */
  between(from: number, to: number): Quat {
    return mul(conj(this.at(to)), this.at(from));
  }
}
