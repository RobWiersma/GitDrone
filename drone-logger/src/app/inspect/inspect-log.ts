import { OsdSession, TrackPoint } from '../flights/flight.models';

/**
 * Telemetry from the flight's blackbox log, for inspection findings: where the craft was, how high and how fast,
 * at any moment of the footage. The log is lined up with the footage by `offset`: the log starts `offset` seconds into
 * the footage (negative when the log started first), so log time = footage time - offset.
 */

/** The craft at one moment. Position fields are null when the log has no GPS. */
export interface CraftFix {
  /** Seconds since the log started. */
  logT: number;
  lat: number | null;
  lon: number | null;
  /** Above takeoff, m: GPS, else the barometer. */
  height: number | null;
  /** Ground speed, m/s. */
  speed: number | null;
  /** Course over the ground, degrees from north, from the GPS track (null when hovering or without GPS). */
  heading: number | null;
  sats: number | null;
  /** Index into the track's points, for the map's cursor. */
  trackIndex: number | null;
}

/** When the craft took off, s of log time: throttle up past idle, else the GPS moving or climbing. */
export function takeoffTime(s: OsdSession): number | null {
  const hit = s.sticks?.points.find(p => p[4] >= 1200);
  if (hit) return hit[0];
  const moved = s.track?.points.find(p => p[4] > 2 || p[3] > 1);
  return moved ? moved[0] : null;
}

/** How long the log runs, s. */
export function logLength(s: OsdSession): number {
  return Math.max(s.flight.durationMs / 1000, s.track?.points.at(-1)?.[0] ?? 0, s.sticks?.points.at(-1)?.[0] ?? 0);
}

/** The craft at footage time `t`; null when that's outside the log. */
export function craftAt(s: OsdSession, offset: number, t: number): CraftFix | null {
  const logT = t - offset;
  if (logT < 0 || logT > logLength(s)) return null;
  const fix: CraftFix = { logT, lat: null, lon: null, height: null, speed: null, heading: null, sats: null, trackIndex: null };

  const pts = s.track?.points;
  if (pts?.length) {
    const i = lastAtOrBefore(pts, logT);
    const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
    const k = b[0] > a[0] ? Math.min(1, Math.max(0, (logT - a[0]) / (b[0] - a[0]))) : 0;
    const mix = (x: number, y: number) => x + (y - x) * k;
    fix.lat = mix(a[1], b[1]);
    fix.lon = mix(a[2], b[2]);
    fix.height = mix(a[3], b[3]);
    fix.speed = mix(a[4], b[4]);
    fix.sats = a[5] ?? null;
    fix.heading = course(pts, i);
    fix.trackIndex = k < 0.5 ? i : Math.min(i + 1, pts.length - 1);
  }
  if (fix.height === null && s.telemetry?.points.length) {
    const tp = s.telemetry.points;
    const j = lastAtOrBefore(tp, logT);
    fix.height = tp[j][2] ?? null;
  }
  return fix;
}

function lastAtOrBefore<P extends readonly number[] | readonly (number | null | undefined)[]>(pts: P[], t: number): number {
  let lo = 0, hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((pts[mid][0] as number) <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Course over the ground around point `i`, from points about a second either side; null below walking pace. */
function course(pts: TrackPoint[], i: number): number | null {
  if (pts[i][4] < 1.5) return null;
  let a = i, b = i;
  while (a > 0 && pts[i][0] - pts[a][0] < 0.5) a--;
  while (b < pts.length - 1 && pts[b][0] - pts[i][0] < 0.5) b++;
  if (a === b) return null;
  const [lat1, lon1] = [pts[a][1], pts[a][2]].map(rad), [lat2, lon2] = [pts[b][1], pts[b][2]].map(rad);
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** The fix without where it was (latitude and longitude), for anything that leaves the page. */
export const withoutPosition = (f: CraftFix | null): CraftFix | null => (f ? { ...f, lat: null, lon: null } : null);

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8];

/** "37.12345, -122.12345". */
export const latLon = (f: CraftFix) => (f.lat !== null && f.lon !== null ? `${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}` : '');

/** One line for a finding: "Craft 12 m up, 4.1 m/s heading NW, at 37.12345, -122.12345". */
export function describe(f: CraftFix): string {
  const parts: string[] = [];
  if (f.height !== null) parts.push(`${Math.round(f.height)} m up`);
  if (f.speed !== null) parts.push(`${f.speed.toFixed(1)} m/s${f.heading !== null ? ` heading ${compass(f.heading)}` : ''}`);
  const at = latLon(f);
  return `Craft ${parts.join(', ')}${at ? `, at ${at}` : ''}`;
}
