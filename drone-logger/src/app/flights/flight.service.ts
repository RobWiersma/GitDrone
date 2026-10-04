import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, delay, of, throwError } from 'rxjs';
import { API_BASE, USE_MOCK } from '../api.config';
import { Flight, FlightFeedPage, FlightUpdate, FlightUploadResult, flightDate } from './flight.models';

@Injectable({ providedIn: 'root' })
export class FlightService {
  private http = inject(HttpClient);

  private mockStore: Flight[] = [
    { id: 1, aircraftId: 1, aircraftName: 'Mach 5', tuneSnapshotId: 3, tuneLabel: 'Updated to 4.5, RPM filter on', notes: 'Smooth, a bit of propwash on dives.',
      originalFileName: 'btfl_012.bbl', logIndex: 0, startedAt: '2026-08-22T17:10:00Z', durationMs: 245_000,
      firmwareRevision: 'Betaflight 4.5.0 (c155f5830) STM32F405', board: 'MTKS MATEKF405', avgThrottlePercent: 34.2,
      maxThrottlePercent: 91.5, corruptFrames: 0, createdAt: '2026-08-22T19:00:00Z' },
  ];

  /** All aircraft, newest first. */
  feed(skip: number, take: number): Observable<FlightFeedPage> {
    if (USE_MOCK) {
      const sorted = [...this.mockStore].sort((a, b) => flightDate(b).localeCompare(flightDate(a)));
      return of({ flights: sorted.slice(skip, skip + take), hasMore: sorted.length > skip + take }).pipe(delay(200));
    }
    return this.http.get<FlightFeedPage>(`${API_BASE}/flights`, { params: { skip, take } });
  }

  list(aircraftId: number): Observable<Flight[]> {
    if (USE_MOCK) return of(this.mockStore.filter(f => f.aircraftId === aircraftId)).pipe(delay(200));
    return this.http.get<Flight[]>(`${API_BASE}/aircraft/${aircraftId}/flights`);
  }

  get(id: number): Observable<Flight> {
    if (!USE_MOCK) return this.http.get<Flight>(`${API_BASE}/flights/${id}`);
    const found = this.mockStore.find(f => f.id === id);
    return found ? of(found).pipe(delay(150)) : throwError(() => new Error('Not found'));
  }

  /** tuneSnapshotId null lets the API match the tune by flight date. */
  upload(aircraftId: number, file: File, tuneSnapshotId: number | null, notes: string): Observable<FlightUploadResult> {
    if (USE_MOCK) {
      const flight: Flight = { ...this.mockStore[0], id: this.mockStore.length + 1, aircraftId, tuneSnapshotId,
        tuneLabel: null, notes: notes || null, originalFileName: file.name, createdAt: new Date().toISOString() };
      this.mockStore = [...this.mockStore, flight];
      return of({ flights: [flight], duplicate: false }).pipe(delay(500));
    }
    const body = new FormData();
    body.append('file', file);
    body.append('tuneSnapshotId', tuneSnapshotId == null ? '' : String(tuneSnapshotId));
    body.append('notes', notes);
    return this.http.post<FlightUploadResult>(`${API_BASE}/aircraft/${aircraftId}/flights`, body);
  }

  update(id: number, changes: FlightUpdate): Observable<Flight> {
    if (USE_MOCK) {
      const existing = this.mockStore.find(f => f.id === id);
      if (!existing) return throwError(() => new Error('Not found'));
      const saved = { ...existing, ...changes };
      this.mockStore = this.mockStore.map(f => (f.id === id ? saved : f));
      return of(saved).pipe(delay(200));
    }
    return this.http.put<Flight>(`${API_BASE}/flights/${id}`, changes);
  }

  remove(id: number): Observable<void> {
    if (!USE_MOCK) return this.http.delete<void>(`${API_BASE}/flights/${id}`);
    this.mockStore = this.mockStore.filter(f => f.id !== id);
    return of(void 0).pipe(delay(200));
  }
}
