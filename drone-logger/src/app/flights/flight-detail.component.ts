import { Component, computed, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FlightService } from './flight.service';
import { Flight, FlightTrack, formatDistance, formatDuration, msToKmh } from './flight.models';
import { FlightMapComponent } from './flight-map.component';
import { FlightProfileComponent, clock } from './flight-profile.component';
import { TuneService } from '../tunes/tune.service';
import { TuneSnapshotSummary } from '../tunes/tune.models';

@Component({
  selector: 'app-flight-detail',
  imports: [DatePipe, DecimalPipe, FormsModule, RouterLink, FlightMapComponent, FlightProfileComponent],
  template: `
    <div class="page detail">
      @if (flight(); as f) {
        <a [routerLink]="['/hangar', f.aircraftId]">Back to aircraft</a>
        <h1>
          @if (f.startedAt) { Flight on {{ f.startedAt | date: 'd MMM y, HH:mm' }} } @else { Flight {{ f.logIndex + 1 }} of {{ f.originalFileName }} }
        </h1>

        @if (f.hasGps) {
          <ul class="headline" aria-label="Flight summary">
            <li><span class="num">{{ distance(f) }}</span><span class="lbl">flown</span></li>
            <li><span class="num">{{ kmh(f.maxSpeedMs) }} km/h</span><span class="lbl">top speed</span></li>
            <li><span class="num">{{ f.maxHeightM | number: '1.0-0' }} m</span><span class="lbl">max height above takeoff</span></li>
            <li><span class="num">{{ f.maxDistanceM | number: '1.0-0' }} m</span><span class="lbl">furthest from home</span></li>
          </ul>
          <section class="panel map-panel" aria-labelledby="map-heading">
            <h2 id="map-heading">Flight path</h2>
            @if (track(); as t) {
              <app-flight-map [track]="t" [(hoverIndex)]="hoverIndex" />
              <p class="readout">
                @if (hoverPoint(); as h) {
                  <strong>{{ h.time }}</strong> in: {{ h.speed }} km/h, {{ h.height }} m above takeoff
                } @else {
                  <span class="hint">Hover over the path or the charts to see speed and height at that moment.</span>
                }
              </p>
              <app-flight-profile [track]="t" [(hoverIndex)]="hoverIndex" />
              <details class="table-view">
                <summary>Data table (every 10 seconds)</summary>
                <div class="scroll">
                  <table>
                    <thead><tr><th scope="col">Time</th><th scope="col">Height (m)</th><th scope="col">Speed (km/h)</th></tr></thead>
                    <tbody>
                      @for (r of tableRows(); track r.time) {
                        <tr><th scope="row">{{ r.time }}</th><td>{{ r.height }}</td><td>{{ r.speed }}</td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              </details>
            } @else if (trackFailed()) {
              <p class="error">Couldn't load the GPS track.</p>
            } @else {
              <p class="hint">Loading map...</p>
            }
          </section>
        }

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
          <dt>GPS</dt>
          <dd>
            {{ f.hasGps ? 'Recorded' : 'Not in this log' }}
            @if (!f.hasGps) {
              <button class="link" type="button" [disabled]="busy()" (click)="reprocess(f)">Re-read log file</button>
            }
          </dd>
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
    .detail { max-width: 56rem; }
    h1 { margin-bottom: 1rem; }
    h2 { margin: 1.5rem 0 .75rem; }
    .stats { display: grid; grid-template-columns: max-content 1fr; gap: .35rem 1.25rem; margin: 0; }
    dt { color: var(--muted); }
    dd { margin: 0; }
    .warn { color: var(--warn); }
    .headline { list-style: none; margin: 0 0 1rem; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .75rem; }
    .headline li { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: .7rem .9rem; display: grid; }
    .num { font-size: 1.35rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .lbl { color: var(--muted); font-size: .85rem; }
    .map-panel { margin-bottom: 1rem; }
    .map-panel h2 { margin-bottom: .75rem; }
    .readout { margin: .6rem 0 .25rem; font-size: .92rem; font-variant-numeric: tabular-nums; min-height: 1.5em; }
    .table-view { margin-top: .75rem; font-size: .9rem; }
    .table-view summary { cursor: pointer; color: var(--accent); }
    .table-view .scroll { max-height: 16rem; overflow: auto; margin-top: .4rem; }
    .table-view table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
    .table-view th, .table-view td { padding: .2rem .9rem .2rem 0; text-align: right; border-bottom: 1px solid var(--line); }
    .table-view thead th { color: var(--muted); font-weight: 600; position: sticky; top: 0; background: var(--surface); }
    .table-view tbody th { font-weight: normal; text-align: left; }
    .link { margin-left: .5rem; background: none; border: 0; padding: 0; font: inherit; color: var(--accent); text-decoration: underline; cursor: pointer; }
    .link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .actions { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: 1rem; }
  `],
})
export class FlightDetailComponent {
  id = input.required<number, unknown>({ transform: numberAttribute });

  private service = inject(FlightService);
  private tuneService = inject(TuneService);
  private router = inject(Router);

  flight = signal<Flight | null>(null);
  track = signal<FlightTrack | null>(null);
  trackFailed = signal(false);
  /** Point under the pointer on the map or charts; both components read and write it. */
  hoverIndex = signal<number | null>(null);

  hoverPoint = computed(() => {
    const i = this.hoverIndex();
    const p = i === null ? undefined : this.track()?.points[i];
    return p ? { time: clock(p[0]), height: p[3].toFixed(0), speed: msToKmh(p[4]).toFixed(0) } : null;
  });

  /** Text alternative to the charts: one row per 10 s of flight. */
  tableRows = computed(() => {
    const rows: { time: string; height: string; speed: string }[] = [];
    let next = 0;
    for (const p of this.track()?.points ?? []) {
      if (p[0] < next) continue;
      rows.push({ time: clock(p[0]), height: p[3].toFixed(1), speed: msToKmh(p[4]).toFixed(0) });
      next = p[0] + 10;
    }
    return rows;
  });
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
          this.loadTrack(f);
          this.tuneChoice.set(f.tuneSnapshotId ? String(f.tuneSnapshotId) : '');
          this.notes.set(f.notes ?? '');
          this.tuneService.list(f.aircraftId).subscribe(list =>
            this.tunes.set([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
        },
        error: () => this.notFound.set(true),
      });
    });
  }

  private loadTrack(f: Flight) {
    this.track.set(null);
    this.hoverIndex.set(null);
    this.trackFailed.set(false);
    if (!f.hasGps) return;
    this.service.track(f.id).subscribe({
      next: t => this.track.set(t),
      error: () => this.trackFailed.set(true),
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
        this.loadTrack(updated);
        this.message.set(updated.hasGps ? 'Found GPS data in the log.' : 'Re-read the log: it has no GPS data.');
      },
      error: () => { this.busy.set(false); this.error.set('Could not re-read the log file.'); },
    });
  }

  distance(f: Flight) {
    return f.distanceM === null ? '' : formatDistance(f.distanceM);
  }

  kmh(ms: number | null) {
    return ms === null ? '' : msToKmh(ms).toFixed(0);
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
