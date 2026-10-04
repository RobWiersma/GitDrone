import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, delay, of, throwError } from 'rxjs';
import { API_BASE, USE_MOCK } from '../api.config';
import { Aircraft, AircraftInput } from './aircraft.models';

@Injectable({ providedIn: 'root' })
export class AircraftService {
  private http = inject(HttpClient);

  private store: Aircraft[] = [
    { id: 1, name: 'Mach 5', type: 'Freestyle', propSize: '5"', frame: 'iFlight Chimera5', flightController: 'Matek F405',
      battery: '6S 1300mAh', weightGrams: 640, notes: 'Main freestyle build. Rebuilt after the June crash.',
      imageUrl: null, createdAt: '2026-04-28T12:00:00Z', tuneCount: 3, lastTuneAt: '2026-08-21T10:40:00Z' },
    { id: 2, name: 'Pocket Rocket', type: 'Tiny whoop', propSize: '1.2"', frame: 'Happymodel Mobula6', flightController: 'Crazybee F4',
      battery: '1S 300mAh', weightGrams: 24, notes: '', imageUrl: null, createdAt: '2026-07-03T09:30:00Z', tuneCount: 0, lastTuneAt: null },
  ];
  private nextId = 3;

  list(): Observable<Aircraft[]> {
    return USE_MOCK ? of([...this.store]).pipe(delay(200)) : this.http.get<Aircraft[]>(`${API_BASE}/aircraft`);
  }

  get(id: number): Observable<Aircraft> {
    if (!USE_MOCK) return this.http.get<Aircraft>(`${API_BASE}/aircraft/${id}`);
    const found = this.store.find(a => a.id === id);
    return found ? of(found).pipe(delay(150)) : throwError(() => new Error('Not found'));
  }

  /** id === null creates, otherwise updates. Sent as multipart so the photo can ride along. */
  save(id: number | null, input: AircraftInput, image: File | null, removeImage: boolean): Observable<Aircraft> {
    if (!USE_MOCK) {
      const body = new FormData();
      Object.entries(input).forEach(([k, v]) => body.append(k, v == null ? '' : String(v)));
      if (image) body.append('image', image);
      if (removeImage) body.append('removeImage', 'true');
      return id === null
        ? this.http.post<Aircraft>(`${API_BASE}/aircraft`, body)
        : this.http.put<Aircraft>(`${API_BASE}/aircraft/${id}`, body);
    }
    const existing = id === null ? null : this.store.find(a => a.id === id) ?? null;
    const imageUrl = image ? URL.createObjectURL(image) : removeImage ? null : existing?.imageUrl ?? null;
    const saved: Aircraft = existing
      ? { ...existing, ...input, imageUrl }
      : { ...input, id: this.nextId++, imageUrl, createdAt: new Date().toISOString(), tuneCount: 0, lastTuneAt: null };
    this.store = existing ? this.store.map(a => (a.id === saved.id ? saved : a)) : [...this.store, saved];
    return of(saved).pipe(delay(300));
  }

  remove(id: number): Observable<void> {
    if (!USE_MOCK) return this.http.delete<void>(`${API_BASE}/aircraft/${id}`);
    this.store = this.store.filter(a => a.id !== id);
    return of(void 0).pipe(delay(200));
  }
}
