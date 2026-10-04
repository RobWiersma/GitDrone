export interface TuneSnapshotSummary {
  id: number;
  aircraftId: number;
  label: string;
  notes?: string;
  firmwareVersion: string; // e.g. "4.5.0"
  target: string;          // e.g. "MATEKF405"
  createdAt: string;       // ISO date from the API
  settingCount: number;
  flightCount: number;
}

export interface TuneImportRequest {
  label: string;
  notes?: string;
  rawText: string;
}

export interface TuneImportResult {
  snapshot: TuneSnapshotSummary;
  /** Set when the backend finds an identical tune already stored (matching content hash). */
  duplicateOf: number | null;
}

/** "added" means the setting was at its default before; "removed" means it went back to default. */
export type TuneDiffKind = 'changed' | 'added' | 'removed';

export interface TuneDiffEntry {
  key: string;
  from: string | null; // null = default
  to: string | null;
  kind: TuneDiffKind;
}

export interface TuneDiffGroup {
  scope: string;      // "master", "profile:0", "rateprofile:1"
  scopeLabel: string; // "General", "PID profile 0"
  category: string;   // "PIDs", "Filters", ...
  changes: TuneDiffEntry[];
}

export interface TuneCompareResult {
  from: TuneSnapshotSummary;
  to: TuneSnapshotSummary;
  changed: number;
  added: number;
  removed: number;
  unchanged: number;
  groups: TuneDiffGroup[];
}

export interface TuneBulkItem {
  label: string;
  notes?: string;
  rawText: string;
  /** When the backup was taken, ISO string. Omit for "now". */
  createdAt?: string;
}

export interface TuneBulkItemResult {
  /** Position in the request's items. */
  index: number;
  status: 'created' | 'duplicate' | 'error';
  snapshot: TuneSnapshotSummary | null;
  duplicateOf: number | null;
  error: string | null;
}
