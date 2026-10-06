import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { FlightService } from '../flights/flight.service';
import { OsdAnalysis, OsdSession, formatDuration } from '../flights/flight.models';
import { OverlayData } from '../flights/overlay-renderer';
import { FlightViewComponent } from '../flights/flight-view.component';
import { OverlayExportComponent } from '../flights/overlay-export.component';
import { AuthService } from '../auth.service';

const MAX_FILE_BYTES = 64 * 1024 * 1024;

/**
 * LovelyOSD: read a blackbox log for its stats and a video overlay without saving anything. The server decodes the
 * file in memory and forgets it; the results live only on this page.
 */
@Component({
  selector: 'app-lovely-osd',
  imports: [DatePipe, FormsModule, FlightViewComponent, OverlayExportComponent],
  template: `
    <div class="page">
      <h1>LovelyOSD Overlay</h1>
      <p class="hint">
        Load a Betaflight blackbox log (<code>.bbl</code> / <code>.bfl</code>) to see its stats and export a transparent OSD
        video for your footage. Nothing is saved: the log isn't added to the hangar, and it's gone when you leave this page.
      </p>

      @if (!auth.signedIn()) {
        <div class="panel">
          <p>Sign in to read a log.</p>
          <a class="btn btn-primary" [href]="auth.signInUrl()">Sign in</a>
        </div>
      } @else {
        <div class="panel pick">
          <div class="field">
            <label for="osd-file">Log file</label>
            <input id="osd-file" type="file" accept=".bbl,.bfl,.bbs,.txt" (change)="onFile($event)" [disabled]="busy() || exporting()" />
          </div>
          @if (busy()) { <p class="hint" role="status">Reading {{ fileName() }}...</p> }
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

          @if (result(); as r) {
            @if (r.sessions.length > 1) {
              <div class="field">
                <label for="osd-session">Session ({{ r.sessions.length }} in this file)</label>
                <select id="osd-session" [ngModel]="index()" (ngModelChange)="index.set(+$event)" [disabled]="exporting()">
                  @for (s of r.sessions; track s.flight.logIndex; let i = $index) {
                    <option [value]="i">{{ sessionLabel(s, i) }}</option>
                  }
                </select>
              </div>
            }
          }
        </div>

        @if (session(); as s) {
          <h2 class="session-title">
            @if (s.flight.startedAt) { Flight on {{ s.flight.startedAt | date: 'd MMM y, HH:mm' }} }
            @else { Session {{ s.flight.logIndex + 1 }} of {{ s.flight.originalFileName }} }
          </h2>

          <app-flight-view [flight]="s.flight" [track]="s.track" [sticks]="s.sticks?.points ?? null" [battery]="s.battery?.points ?? null" />

          <section aria-labelledby="osd-export-heading">
            <h2 id="osd-export-heading">Video overlay</h2>
            <p class="hint">It starts at arming, so line it up with your takeoff in Premiere or After Effects.</p>
            <app-overlay-export [data]="overlayData()!" [seconds]="s.flight.durationMs / 1000" [fileStem]="fileStem()" />
          </section>
        }
      }
    </div>
  `,
  styles: [`
    .pick { margin: 1rem 0; display: grid; gap: .25rem; }
    .pick .field { margin: 0; }
    .pick p { margin: 0; }
    .session-title { margin: 1.5rem 0 .75rem; }
    section h2 { margin: 1.5rem 0 .25rem; }
    section .hint { margin: 0; }
  `],
})
export class LovelyOsdComponent {
  readonly auth = inject(AuthService);
  private service = inject(FlightService);
  private exporter = viewChild(OverlayExportComponent);

  fileName = signal('');
  busy = signal(false);
  error = signal('');
  result = signal<OsdAnalysis | null>(null);
  index = signal(0);

  session = computed(() => this.result()?.sessions[this.index()] ?? null);
  /** Switching sessions or files mid-export would pull the data out from under it. */
  exporting = computed(() => this.exporter()?.busy() ?? false);

  overlayData = computed<OverlayData | null>(() => {
    const s = this.session();
    return s ? { track: s.track, sticks: s.sticks?.points ?? null, battery: s.battery } : null;
  });

  /** "lovelyosd-btfl_012-s2": the log's name, safe for any file system. */
  fileStem = computed(() => {
    const r = this.result();
    const base = (r?.fileName ?? 'log').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 60) || 'log';
    const s = this.session();
    return `lovelyosd-${base}${r && r.sessions.length > 1 && s ? `-s${s.flight.logIndex + 1}` : ''}`;
  });

  onFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.error.set('');
    if (file.size > MAX_FILE_BYTES) {
      this.error.set('That file is over 64 MB.');
      input.value = '';
      return;
    }
    this.fileName.set(file.name);
    this.busy.set(true);
    this.service.analyze(file).subscribe({
      next: r => {
        this.busy.set(false);
        this.index.set(0);
        this.result.set(r);
      },
      error: (e: HttpErrorResponse) => {
        this.busy.set(false);
        const problem = e.error?.errors as Record<string, string[]> | undefined;
        this.error.set(problem ? Object.values(problem).flat().join(' ')
          : e.status === 401 ? 'Sign in to read a log.'
          : 'Could not read this log. Check that the API is running and try again.');
      },
    });
  }

  sessionLabel(s: OsdSession, i: number) {
    const when = s.flight.startedAt ? new Date(s.flight.startedAt).toLocaleString() : `Session ${i + 1}`;
    return `${when}, ${formatDuration(s.flight.durationMs)}${s.flight.hasGps ? ', GPS' : ''}`;
  }
}
