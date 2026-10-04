import { Component, computed, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { FlightService } from './flight.service';
import { Flight, formatDuration } from './flight.models';
import { TuneService } from '../tunes/tune.service';
import { TuneSnapshotSummary } from '../tunes/tune.models';

const MAX_FILE_BYTES = 64 * 1024 * 1024;

@Component({
  selector: 'app-flight-upload',
  imports: [DatePipe, FormsModule, RouterLink],
  template: `
    <div class="page narrow">
      <a [routerLink]="['/hangar', id()]">Back to aircraft</a>
      <h1>Upload blackbox log</h1>
      <p class="hint">
        Pick a <code>.bbl</code> or <code>.bfl</code> file from the flight controller (Blackbox tab, "Activate Mass Storage Device Mode")
        or the SD card. A file with several armed sessions becomes several flights.
      </p>

      @if (result(); as r) {
        <div class="panel" aria-live="polite">
          @if (r.duplicate) {
            <p class="warn">This file was already uploaded, so nothing was added.</p>
          } @else {
            <p><strong>Added {{ r.flights.length }} {{ r.flights.length === 1 ? 'flight' : 'flights' }}.</strong></p>
          }
          <ul>
            @for (f of r.flights; track f.id) {
              <li><a [routerLink]="['/flights', f.id]">{{ label(f) }}</a>, {{ duration(f) }}{{ f.tuneLabel ? ', on ' + f.tuneLabel : '' }}</li>
            }
          </ul>
          <div class="actions">
            <a class="btn btn-primary" [routerLink]="['/hangar', id()]">Done</a>
            <button class="btn" type="button" (click)="reset()">Upload another</button>
          </div>
        </div>
      } @else {
        <div class="field">
          <label for="file">Log file</label>
          <input id="file" type="file" accept=".bbl,.bfl,.bbs,.txt" (change)="onFile($event)" />
          @if (fileError()) { <p class="error">{{ fileError() }}</p> }
        </div>

        <div class="field">
          <label for="tune">Tune flown</label>
          <select id="tune" [(ngModel)]="tuneChoice">
            <option value="">Match by flight date</option>
            @for (t of tunes(); track t.id) {
              <option [value]="t.id">{{ t.label }} ({{ t.createdAt | date: 'd MMM y' }})</option>
            }
          </select>
          <p class="hint">"Match by flight date" picks the newest tune saved before each flight.</p>
        </div>

        <div class="field">
          <label for="notes">Notes</label>
          <textarea id="notes" rows="2" [(ngModel)]="notes" maxlength="1000" placeholder="How did it fly?"></textarea>
        </div>

        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

        <div class="actions">
          <button class="btn btn-primary" type="button" [disabled]="!canSubmit()" (click)="submit()">
            {{ busy() ? 'Uploading...' : 'Upload' }}
          </button>
          <a class="btn" [routerLink]="['/hangar', id()]">Cancel</a>
        </div>
      }
    </div>
  `,
  styles: [`
    .warn { color: var(--warn); }
    .panel p { margin: 0 0 .5rem; }
    .panel ul { margin: 0 0 .5rem; padding-left: 1.25rem; }
    .actions { display: flex; gap: .75rem; margin-top: 1.25rem; }
  `],
})
export class FlightUploadComponent {
  id = input.required<number, unknown>({ transform: numberAttribute });

  private flights = inject(FlightService);
  private tuneService = inject(TuneService);

  tunes = signal<TuneSnapshotSummary[]>([]);
  file = signal<File | null>(null);
  tuneChoice = signal('');
  notes = signal('');
  busy = signal(false);
  error = signal('');
  fileError = signal('');
  result = signal<{ flights: Flight[]; duplicate: boolean } | null>(null);

  canSubmit = computed(() => !!this.file() && !this.busy());

  constructor() {
    effect(() => {
      this.tuneService.list(this.id()).subscribe(list =>
        this.tunes.set([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
    });
  }

  onFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.error.set('');
    if (file && file.size > MAX_FILE_BYTES) {
      this.fileError.set('That file is over 64 MB.');
      this.file.set(null);
      return;
    }
    this.fileError.set('');
    this.file.set(file);
  }

  submit() {
    const file = this.file();
    if (!file) return;
    this.busy.set(true);
    this.error.set('');
    const tune = this.tuneChoice() ? Number(this.tuneChoice()) : null;
    this.flights.upload(this.id(), file, tune, this.notes().trim()).subscribe({
      next: r => { this.busy.set(false); this.result.set(r); },
      error: (e: HttpErrorResponse) => {
        this.busy.set(false);
        const problem = e.error?.errors as Record<string, string[]> | undefined;
        this.error.set(problem ? Object.values(problem).flat().join(' ') : 'Could not upload this log. Check that the API is running and try again.');
      },
    });
  }

  reset() {
    this.result.set(null);
    this.file.set(null);
    this.notes.set('');
  }

  label(f: Flight) {
    return f.startedAt ? new Date(f.startedAt).toLocaleString() : `Session ${f.logIndex + 1}`;
  }

  duration(f: Flight) {
    return formatDuration(f.durationMs);
  }
}
