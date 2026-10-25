import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NavigationEnd, Router } from '@angular/router';
import { Observable, filter } from 'rxjs';
import { API_BASE, USE_MOCK } from '../api.config';

export interface VisitStats {
  days: number;
  today: number;
  /** Sum of each day's unique visitors (someone back on another day counts again). */
  total: number;
  daily: { day: string; visitors: number }[];
  pages: { path: string; visitors: number }[];
  /** Where visitor-days came from: a site name or "Direct". */
  referrers: { source: string; visitors: number }[];
  /** What visitors did in LovelyOSD Editor: visitor-days that did it, and how many times all told. */
  events: { name: UsageEvent; visitors: number; times: number }[];
}

/** The About page's numbers: since when they're counted, and each public action's totals. */
export interface PublicStats {
  since: string | null;
  counts: { name: string; total: number; last30Days: number }[];
}

/** The things LovelyOSD Editor reports. The API takes these names only. */
export type UsageEvent =
  | 'log-loaded' | 'log-from-usb' | 'footage-loaded' | 'sound-loaded' | 'music-loaded'
  | 'video-rendered' | 'short-rendered' | 'overlay-exported' | 'render-failed' | 'session-saved' | 'session-opened';

/**
 * Tells the API which page was opened, for the privacy-friendly visitor count. No cookies or ids are sent:
 * the server works out a daily hash from the request itself and stores nothing else.
 */
@Injectable({ providedIn: 'root' })
export class VisitService {
  private http = inject(HttpClient);

  /** Call once at startup; reports every page change from then on. */
  trackPageViews(router: Router) {
    if (USE_MOCK) return;
    let landing = true;
    router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(e => {
      // Where they came from only matters for the page they landed on; later pages are moves inside GitDrone.
      const referrer = landing ? externalReferrer() : null;
      landing = false;
      this.http.post(`${API_BASE}/visit`, { path: e.urlAfterRedirects, referrer }).subscribe({ error: () => undefined });
    });
  }

  /**
   * Counts something a visitor did ("video-rendered"), the same privacy-friendly way as a page view: just the name, with
   * no file names, sizes or settings. Fire and forget; it never gets in the way.
   */
  event(name: UsageEvent) {
    if (USE_MOCK) return;
    this.http.post(`${API_BASE}/event`, { name }).subscribe({ error: () => undefined });
  }

  /** The public totals for the About page; anyone can read them. */
  publicStats(): Observable<PublicStats> {
    return this.http.get<PublicStats>(`${API_BASE}/stats/public`);
  }

  stats(days: number): Observable<VisitStats> {
    return this.http.get<VisitStats>(`${API_BASE}/stats/visits`, { params: { days } });
  }
}

/** The site that linked here, as a hostname only (never the full link), or null for none or GitDrone itself. */
function externalReferrer(): string | null {
  try {
    const host = new URL(document.referrer).hostname;
    return host && host !== location.hostname ? host : null;
  } catch {
    return null; // no referrer, or not a URL
  }
}
