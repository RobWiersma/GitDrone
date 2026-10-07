import { Component, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FlightService } from './flight.service';
import { BatteryPoint, Flight, FlightTrack, StickPoint, TelemetryPoint } from './flight.models';
import { FlightViewComponent } from './flight-view.component';
import { TuneService } from '../tunes/tune.service';
import { TuneSnapshotSummary } from '../tunes/tune.models';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-flight-detail',
  imports: [DatePipe, FormsModule, RouterLink, FlightViewComponent],
  template: `
    <div class="page detail">
      @if (flight(); as f) {
        <a [routerLink]="['/hangar', f.aircraftId]">Back to aircraft</a>
        <h1>
          @if (f.startedAt) { Flight on {{ f.startedAt | date: 'd MMM y, HH:mm' }} } @else { Flight {{ f.logIndex + 1 }} of {{ f.originalFileName }} }
        </h1>

        <app-flight-view [flight]="f" [track]="track()" [trackFailed]="trackFailed()" [sticks]="sticks()" [battery]="battery()" [telemetry]="telemetry()"
                         [overlayLink]="['/flights', f.id, 'overlay']" [canReprocess]="auth.canEdit()" [busy]="busy()"
                         (reprocess)="reprocess(f)" />

        <h2>Tune and notes</h2>
        @if (!auth.canEdit()) {
          <dl class="panel stats">
            <dt>Tune</dt><dd>{{ f.tuneLabel ?? 'None linked' }}</dd>
            <dt>Notes</dt><dd class="notes">{{ f.notes || 'None' }}</dd>
          </dl>
        } @else {
        <div class="field">
          <label for="tune">Tune flown</label>
          <select id="tune" [(ngModel)]="tuneChoice">
            <option value="">None</option>
            @for (t of tunes(); track t.id) {
              <option [value]="t.id">{{ t.label }} ({{ t.createdAt | date: 'd MMM y' }})</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="notes">Notes</label>
          <textarea id="notes" rows="3" [(ngModel)]="notes" maxlength="1000"></textarea>
        </div>
        @if (message()) { <p class="hint" aria-live="polite">{{ message() }}</p> }
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

        <div class="actions">
          <button class="btn btn-primary" type="button" [disabled]="busy()" (click)="save(f)">Save</button>
          @if (f.tuneSnapshotId) {
            <a class="btn" [routerLink]="['/hangar', f.aircraftId]">View tune history</a>
          }
          <button class="btn btn-danger" type="button" (click)="remove(f)">Delete flight</button>
        </div>
        }
      } @else if (notFound()) {
        <a routerLink="/hangar">Back to hangar</a>
        <p class="error">That flight doesn't exist. It may have been deleted.</p>
      } @else {
        <p class="hint">Loading flight...</p>
      }
    </div>
  `,
  styles: [`
    .detail { max-width: 56rem; }
    h1 { margin-bottom: 1rem; }
    h2 { margin: 1.5rem 0 .75rem; }
    .stats { display: grid; grid-template-columns: max-content 1fr; gap: .45rem 1.25rem; margin: 0 0 1rem; }
    .stats dt { font-size: .72rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; padding-top: .15rem; color: var(--muted); }
    dd { margin: 0; }
    .actions { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: 1rem; }
    .notes { white-space: pre-wrap; }
  `],
})
export class FlightDetailComponent {
  readonly auth = inject(AuthService);
  id = input.required<number, unknown>({ transform: numberAttribute });

  private service = inject(FlightService);
  private tuneService = inject(TuneService);
  private router = inject(Router);

  flight = signal<Flight | null>(null);
  track = signal<FlightTrack | null>(null);
  trackFailed = signal(false);
  sticks = signal<StickPoint[] | null>(null);
  battery = signal<BatteryPoint[] | null>(null);
  telemetry = signal<TelemetryPoint[] | null>(null);

  notFound = signal(false);
  tunes = signal<TuneSnapshotSummary[]>([]);
  tuneChoice = signal('');
  notes = signal('');
  busy = signal(false);
  message = signal('');
  error = signal('');

  constructor() {
    effect(() => {
      this.notFound.set(false);
      this.service.get(this.id()).subscribe({
        next: f => {
          this.flight.set(f);
          this.loadLogData(f);
          this.tuneChoice.set(f.tuneSnapshotId ? String(f.tuneSnapshotId) : '');
          this.notes.set(f.notes ?? '');
          this.tuneService.list(f.aircraftId).subscribe(list =>
            this.tunes.set([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
        },
        error: () => this.notFound.set(true),
      });
    });
  }

  private loadLogData(f: Flight) {
    this.track.set(null);
    this.sticks.set(null);
    this.battery.set(null);
    this.telemetry.set(null);
    this.trackFailed.set(false);
    if (f.hasTelemetry) {
      this.service.telemetry(f.id).subscribe({
        next: t => {
          this.telemetry.set(t.points);
          // Older rows only learn they have RSSI/baro on first request; pick up the new summary.
          if (f.minRssiPercent === null && f.maxBaroHeightM === null) this.service.get(f.id).subscribe(updated => this.flight.set(updated));
        },
        error: () => this.telemetry.set(null),
      });
    }
    if (f.hasGps) {
      this.service.track(f.id).subscribe({ next: t => this.track.set(t), error: () => this.trackFailed.set(true) });
    }
    if (f.hasSticks) {
      this.service.sticks(f.id).subscribe({
        next: s => this.sticks.set(s.points),
        error: () => this.flight.update(x => (x ? { ...x, hasSticks: false } : x)), // older log without rcCommand
      });
    }
    // Ask for battery data even when the summary says none: older rows only learn they have it on first request.
    this.service.battery(f.id).subscribe({
      next: b => {
        this.battery.set(b.points);
        if (!f.battery) this.service.get(f.id).subscribe(updated => this.flight.set(updated)); // pick up the new stats
      },
      error: () => this.battery.set(null),
    });
  }

  reprocess(f: Flight) {
    this.busy.set(true);
    this.message.set('');
    this.error.set('');
    this.service.reprocess(f.id).subscribe({
      next: updated => {
        this.busy.set(false);
        this.flight.set(updated);
        this.loadLogData(updated);
        this.message.set(updated.hasGps ? 'Found GPS data in the log.' : 'Re-read the log: it has no GPS data.');
      },
      error: () => { this.busy.set(false); this.error.set('Could not re-read the log file.'); },
    });
  }

  save(f: Flight) {
    this.busy.set(true);
    this.message.set('');
    this.error.set('');
    const tuneSnapshotId = this.tuneChoice() ? Number(this.tuneChoice()) : null;
    this.service.update(f.id, { tuneSnapshotId, notes: this.notes().trim() || null }).subscribe({
      next: saved => { this.busy.set(false); this.flight.set(saved); this.message.set('Saved.'); },
      error: () => { this.busy.set(false); this.error.set('Could not save. Check that the API is running and try again.'); },
    });
  }

  remove(f: Flight) {
    if (!confirm('Delete this flight? This can\'t be undone.')) return;
    this.service.remove(f.id).subscribe(() => this.router.navigate(['/hangar', f.aircraftId]));
  }
}
