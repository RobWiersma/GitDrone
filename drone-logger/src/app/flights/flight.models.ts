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
}

export interface FlightUploadResult {
  flights: Flight[];
  /** True when this exact file was uploaded before; flights are then the existing ones. */
  duplicate: boolean;
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
