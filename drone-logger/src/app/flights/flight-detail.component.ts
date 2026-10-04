import { Component, computed, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FlightService } from './flight.service';
import { Flight, formatDuration } from './flight.models';
import { TuneService } from '../tunes/tune.service';
import { TuneSnapshotSummary } from '../tunes/tune.models';

@Component({
  selector: 'app-flight-detail',
  imports: [DatePipe, DecimalPipe, FormsModule, RouterLink],
  template: `
    <div class="page narrow">
      @if (flight(); as f) {
        <a [routerLink]="['/hangar', f.aircraftId]">Back to aircraft</a>
        <h1>
          @if (f.startedAt) { Flight on {{ f.startedAt | date: 'd MMM y, HH:mm' }} } @else { Flight {{ f.logIndex + 1 }} of {{ f.originalFileName }} }
        </h1>

        <dl class="panel stats">
          <dt>Duration</dt><dd>{{ duration() }}</dd>
          <dt>Throttle</dt>
          <dd>
            @if (f.avgThrottlePercent !== null) {
              {{ f.avgThrottlePercent | number: '1.0-0' }}% average, {{ f.maxThrottlePercent | number: '1.0-0' }}% peak
            } @else { Not in this log }
          </dd>
          <dt>Firmware</dt><dd>{{ f.firmwareRevision || 'Unknown' }}</dd>
          <dt>Board</dt><dd>{{ f.board || 'Unknown' }}</dd>
          <dt>File</dt><dd>{{ f.originalFileName }}, session {{ f.logIndex + 1 }}</dd>
          @if (f.corruptFrames > 0) {
            <dt>Corrupt frames</dt><dd class="warn">{{ f.corruptFrames }} skipped</dd>
          }
        </dl>

        <h2>Tune and notes</h2>
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
      } @else if (notFound()) {
        <a routerLink="/hangar">Back to hangar</a>
        <p class="error">That flight doesn't exist. It may have been deleted.</p>
      } @else {
        <p class="hint">Loading flight...</p>
      }
    </div>
  `,
  styles: [`
    h1 { margin-bottom: 1rem; }
    h2 { margin: 1.5rem 0 .75rem; }
    .stats { display: grid; grid-template-columns: max-content 1fr; gap: .35rem 1.25rem; margin: 0; }
    dt { color: var(--muted); }
    dd { margin: 0; }
    .warn { color: var(--warn); }
    .actions { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: 1rem; }
  `],
})
export class FlightDetailComponent {
  id = input.required<number, unknown>({ transform: numberAttribute });

  private service = inject(FlightService);
  private tuneService = inject(TuneService);
  private router = inject(Router);

  flight = signal<Flight | null>(null);
  notFound = signal(false);
  tunes = signal<TuneSnapshotSummary[]>([]);
  tuneChoice = signal('');
  notes = signal('');
  busy = signal(false);
  message = signal('');
  error = signal('');

  duration = computed(() => formatDuration(this.flight()?.durationMs ?? 0));

  constructor() {
    effect(() => {
      this.notFound.set(false);
      this.service.get(this.id()).subscribe({
        next: f => {
          this.flight.set(f);
          this.tuneChoice.set(f.tuneSnapshotId ? String(f.tuneSnapshotId) : '');
          this.notes.set(f.notes ?? '');
          this.tuneService.list(f.aircraftId).subscribe(list =>
            this.tunes.set([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
        },
        error: () => this.notFound.set(true),
      });
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
