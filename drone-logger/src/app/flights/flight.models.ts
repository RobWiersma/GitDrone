export interface Flight {
  id: number;
  aircraftId: number;
  aircraftName: string;
  tuneSnapshotId: number | null;
  tuneLabel: string | null;
  notes: string | null;
  originalFileName: string;
  /** Position of this armed session inside the uploaded file (0-based). */
  logIndex: number;
  /** From the log header; null when the flight controller had no clock. */
  startedAt: string | null;
  durationMs: number;
  firmwareRevision: string;
  board: string;
  avgThrottlePercent: number | null;
  maxThrottlePercent: number | null;
  corruptFrames: number;
  createdAt: string;
  hasGps: boolean;
  /** Path length over the ground, metres. GPS fields are null without a fix. */
  distanceM: number | null;
  maxSpeedMs: number | null;
  /** Above takeoff. */
  maxHeightM: number | null;
  maxDistanceM: number | null;
  /** Stick data available for playback (rcCommand logged). */
  hasSticks: boolean;
  /** Average ground speed while moving, m/s. */
  avgSpeedMs: number | null;
  battery: FlightBattery | null;
  /** RSSI and/or barometer series available (rssi / baroAlt logged). */
  hasTelemetry: boolean;
  /** Lowest link RSSI, %, 0.5 s average. Null when not logged. */
  minRssiPercent: number | null;
  /** Highest barometer height above takeoff, m. Null without a barometer. */
  maxBaroHeightM: number | null;
}

/** [seconds since log start, RSSI % or null, barometer height above takeoff (m) or null], 10 Hz. */
export type TelemetryPoint = [number, number | null, number | null];

export interface FlightTelemetry {
  points: TelemetryPoint[];
}

export interface FlightBattery {
  cells: number;
  /** Pack volts: resting at start and end, and the lowest under load. */
  startV: number;
  endV: number;
  minV: number;
  /** Null when the FC has no current sensor. */
  mahUsed: number | null;
  peakCurrentA: number | null;
  avgCurrentA: number | null;
  peakPowerW: number | null;
}

/** [seconds since log start, pack volts, amps or null], 10 Hz. */
export type BatteryPoint = [number, number, number | null];

export interface FlightBatterySeries {
  cells: number;
  points: BatteryPoint[];
}

/**
 * [seconds since log start, lat, lon, height above takeoff (m), ground speed (m/s), satellites, acceleration (m/s²)].
 * The last two arrive with data version 4; older tracks rebuild themselves on first request.
 */
export type TrackPoint = [number, number, number, number, number, number?, number?];

/** [seconds since log start, roll, pitch, yaw (-500..500), throttle (1000..2000)], Betaflight rcCommand at 25 Hz. */
export type StickPoint = [number, number, number, number, number];

export interface FlightSticks {
  points: StickPoint[];
}

export interface FlightTrack {
  home: [number, number] | null;
  points: TrackPoint[];
}

/** "4.87 km" or "460 m". */
export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

export const msToKmh = (ms: number) => ms * 3.6;

export type SpeedUnit = 'kmh' | 'mph';
export const speedFromMs = (ms: number, unit: SpeedUnit) => (unit === 'mph' ? ms * 2.236936 : ms * 3.6);

export interface FlightUploadResult {
  flights: Flight[];
  /** True when this exact file was uploaded before; flights are then the existing ones. */
  duplicate: boolean;
}

/** One armed session from a log read by LovelyOSD. Never stored: flight.id is 0 and there's no aircraft. */
export interface OsdSession {
  flight: Flight;
  track: FlightTrack | null;
  sticks: FlightSticks | null;
  battery: FlightBatterySeries | null;
  telemetry: FlightTelemetry | null;
}

export interface OsdAnalysis {
  fileName: string;
  sessions: OsdSession[];
}

export interface FlightFeedPage {
  flights: Flight[];
  hasMore: boolean;
}

/** The date a flight is filed under: the log's start time, or the upload time when the FC had no clock. */
export function flightDate(f: Flight): string {
  return f.startedAt ?? f.createdAt;
}

export interface FlightUpdate {
  tuneSnapshotId: number | null;
  notes: string | null;
}

/** "4:05" style duration. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
