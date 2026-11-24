import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { API_BASE, USE_MOCK } from '../api.config';
import { OsdAnalysis } from './flight.models';

/** Reads blackbox logs on the server for LovelyOSD Editor and the Inspector. Nothing is stored. */
@Injectable({ providedIn: 'root' })
export class FlightService {
  private http = inject(HttpClient);

  /** Reads a log on the server without storing it. */
  analyze(file: File): Observable<OsdAnalysis> {
    if (USE_MOCK) return throwError(() => new Error('LovelyOSD needs the API'));
    const body = new FormData();
    body.append('file', file);
    return this.http.post<OsdAnalysis>(`${API_BASE}/osd/analyze`, body);
  }
}
