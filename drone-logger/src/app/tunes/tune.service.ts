import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, delay, map, of, throwError } from 'rxjs';
import { API_BASE, USE_MOCK } from '../api.config';
import { TuneBulkItem, TuneBulkItemResult, TuneCompareResult, TuneImportRequest, TuneImportResult, TuneSnapshotSummary } from './tune.models';

@Injectable({ providedIn: 'root' })
export class TuneService {
  private http = inject(HttpClient);

  private mockStore: TuneSnapshotSummary[] = [
    { id: 1, aircraftId: 1, label: 'Stock-ish baseline', firmwareVersion: '4.4.2', target: 'MATEKF405',
      createdAt: '2026-05-02T18:20:00Z', settingCount: 64, flightCount: 11 },
    { id: 2, aircraftId: 1, label: 'Less D on pitch', notes: 'Motors were warm after the first pack.',
      firmwareVersion: '4.4.2', target: 'MATEKF405', createdAt: '2026-06-14T16:05:00Z', settingCount: 66, flightCount: 9 },
    { id: 3, aircraftId: 1, label: 'Updated to 4.5, RPM filter on', firmwareVersion: '4.5.0', target: 'MATEKF405',
      createdAt: '2026-08-21T10:40:00Z', settingCount: 71, flightCount: 4 },
  ];

  list(aircraftId: number): Observable<TuneSnapshotSummary[]> {
    if (USE_MOCK) {
      return of(this.mockStore.filter(s => s.aircraftId === aircraftId)).pipe(delay(250));
    }
    return this.http.get<TuneSnapshotSummary[]>(`${API_BASE}/aircraft/${aircraftId}/tunes`);
  }

  import(aircraftId: number, req: TuneImportRequest): Observable<TuneImportResult> {
    if (USE_MOCK) {
      const snapshot: TuneSnapshotSummary = {
        id: this.mockStore.length + 1,
        aircraftId,
        label: req.label,
        notes: req.notes,
        firmwareVersion: /(\d+\.\d+\.\d+)/.exec(req.rawText)?.[1] ?? 'unknown',
        target: /^#?\s*board_name\s+(\S+)/m.exec(req.rawText)?.[1] ?? 'unknown',
        createdAt: new Date().toISOString(),
        settingCount: (req.rawText.match(/^set /gm) ?? []).length,
        flightCount: 0,
      };
      this.mockStore = [...this.mockStore, snapshot];
      return of({ snapshot, duplicateOf: null }).pipe(delay(400));
    }
    return this.http.post<TuneImportResult>(`${API_BASE}/aircraft/${aircraftId}/tunes`, req);
  }

  bulkImport(aircraftId: number, items: TuneBulkItem[]): Observable<TuneBulkItemResult[]> {
    if (USE_MOCK) {
      return of(items.map((item, index): TuneBulkItemResult => {
        const snapshot: TuneSnapshotSummary = {
          id: this.mockStore.length + 1, aircraftId, label: item.label, notes: item.notes,
          firmwareVersion: /(\d+\.\d+\.\d+)/.exec(item.rawText)?.[1] ?? 'unknown',
          target: /^#?\s*board_name\s+(\S+)/m.exec(item.rawText)?.[1] ?? 'unknown',
          createdAt: item.createdAt ?? new Date().toISOString(),
          settingCount: (item.rawText.match(/^set /gm) ?? []).length, flightCount: 0,
        };
        this.mockStore = [...this.mockStore, snapshot];
        return { index, status: 'created', snapshot, duplicateOf: null, error: null };
      })).pipe(delay(600));
    }
    return this.http.post<TuneBulkItemResult[]>(`${API_BASE}/aircraft/${aircraftId}/tunes/bulk`, { items });
  }

  compare(from: number, to: number): Observable<TuneCompareResult> {
    if (USE_MOCK) {
      const a = this.mockStore.find(s => s.id === from);
      const b = this.mockStore.find(s => s.id === to);
      if (!a || !b) return throwError(() => new Error('Not found'));
      // The mock has no stored settings, so it returns a fixed sample diff.
      return of<TuneCompareResult>({
        from: a, to: b, changed: 2, added: 1, removed: 1, unchanged: 60,
        groups: [
          { scope: 'master', scopeLabel: 'General', category: 'Filters', changes: [
            { key: 'dterm_lpf1_static_hz', from: '75', to: '90', kind: 'changed' },
            { key: 'rpm_filter_harmonics', from: null, to: '2', kind: 'added' },
          ] },
          { scope: 'profile:0', scopeLabel: 'PID profile 0', category: 'PIDs', changes: [
            { key: 'd_pitch', from: '38', to: '34', kind: 'changed' },
            { key: 'feedforward_boost', from: '20', to: null, kind: 'removed' },
          ] },
        ],
      }).pipe(delay(250));
    }
    return this.http.get<TuneCompareResult>(`${API_BASE}/tunes/compare`, { params: { from, to } });
  }

  /** The stored diff all text (craft and pilot names removed at import). */
  raw(id: number): Observable<string> {
    if (USE_MOCK) {
      return of(`# Betaflight / STM32F405 (S405) 4.5.0

board_name MATEKF405

set dterm_lpf1_static_hz = 75

profile 0
set d_pitch = 38`).pipe(delay(200));
    }
    return this.http.get<{ id: number; rawText: string }>(`${API_BASE}/tunes/${id}/raw`).pipe(map(r => r.rawText));
  }
}
