import { Component, computed, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FlightService } from './flight.service';
import { BatteryPoint, Flight, FlightTrack, StickPoint, formatDistance, formatDuration } from './flight.models';
import { FlightMapComponent } from './flight-map.component';
import { ChartSeries, FlightProfileComponent, clock, nearest } from './flight-profile.component';
import { FlightPlaybackComponent, Readout } from './flight-playback.component';
import { TuneService } from '../tunes/tune.service';
import { TuneSnapshotSummary } from '../tunes/tune.models';
import { AuthService } from '../auth.service';
import { UnitsService } from '../units.service';

@Component({
  selector: 'app-flight-detail',
  imports: [DatePipe, DecimalPipe, FormsModule, RouterLink, FlightMapComponent, FlightProfileComponent, FlightPlaybackComponent],
  template: `
    <div class="page detail">
      @if (flight(); as f) {
        <a [routerLink]="['/hangar', f.aircraftId]">Back to aircraft</a>
        <h1>
          @if (f.startedAt) { Flight on {{ f.startedAt | date: 'd MMM y, HH:mm' }} } @else { Flight {{ f.logIndex + 1 }} of {{ f.originalFileName }} }
        </h1>

        @if (f.hasGps) {
          <ul class="headline" aria-label="Flight summary">
            <li><span class="lbl">Distance</span><span class="num">{{ distanceValue(f) }}<small>{{ distanceUnit(f) }}</small></span></li>
            <li><span class="lbl">Top speed</span><span class="num">{{ speed(f.maxSpeedMs) }}<small>{{ units.speedLabel() }}</small></span></li>
            @if (f.avgSpeedMs !== null) {
              <li><span class="lbl">Avg speed</span><span class="num">{{ speed(f.avgSpeedMs) }}<small>{{ units.speedLabel() }}</small></span></li>
            }
            <li><span class="lbl">Max height</span><span class="num">{{ f.maxHeightM | number: '1.0-0' }}<small>m</small></span></li>
            <li><span class="lbl">Furthest from home</span><span class="num">{{ f.maxDistanceM | number: '1.0-0' }}<small>m</small></span></li>
          </ul>
        }

        @if (f.battery; as b) {
          <ul class="headline battery" aria-label="Battery summary">
            @if (b.mahUsed !== null) {
              <li><span class="lbl">Used</span><span class="num">{{ b.mahUsed | number: '1.0-0' }}<small>mAh</small></span></li>
            }
            <li>
              <span class="lbl">Lowest cell</span>
              <span class="num" [class.low]="b.minV / b.cells < 3.3">{{ b.minV / b.cells | number: '1.2-2' }}<small>V</small></span>
              <span class="sub">{{ b.minV | number: '1.1-1' }} V pack under load</span>
            </li>
            <li>
              <span class="lbl">Pack</span>
              <span class="num">{{ b.startV / b.cells | number: '1.2-2' }}<small>→</small>{{ b.endV / b.cells | number: '1.2-2' }}<small>V/cell</small></span>
              <span class="sub">{{ b.cells }}S, {{ b.startV | number: '1.1-1' }} → {{ b.endV | number: '1.1-1' }} V</span>
            </li>
            @if (b.peakCurrentA !== null) {
              <li>
                <span class="lbl">Peak current</span><span class="num">{{ b.peakCurrentA | number: '1.0-0' }}<small>A</small></span>
                <span class="sub">{{ b.avgCurrentA | number: '1.1-1' }} A average</span>
              </li>
              <li><span class="lbl">Peak power</span><span class="num">{{ b.peakPowerW | number: '1.0-0' }}<small>W</small></span></li>
            }
          </ul>
        }

        @if (f.hasGps) {
          <section class="panel" aria-labelledby="map-heading">
            <h2 id="map-heading">Flight path</h2>
            @if (track(); as t) {
              <app-flight-map [track]="t" [hoverIndex]="mapIndex()" (hoverIndexChange)="onMapHover($event)" />
            } @else if (trackFailed()) {
              <p class="error">Couldn't load the GPS track.</p>
            } @else {
              <p class="hint">Loading map...</p>
            }
          </section>
        }

        @if (sticks() || track() || battery()) {
          <section class="panel" aria-labelledby="playback-heading">
            <div class="panel-head">
              <h2 id="playback-heading">Playback</h2>
              <a class="btn" [routerLink]="['/flights', f.id, 'overlay']">Export video overlay</a>
            </div>
            <app-flight-playback [duration]="seconds()" [sticks]="sticks()" [readouts]="readouts()"
                                 [(time)]="scrubTime" [(playing)]="playing" />
          </section>
        }

        @if (series().length) {
          <section class="panel" aria-labelledby="charts-heading">
            <h2 id="charts-heading">Charts</h2>
            <p class="hint">Hover a chart or the map to look at a moment, or press play.</p>
            <app-flight-profile [series]="series()" [duration]="seconds()" [time]="cursorTime()" (hover)="onChartHover($event)" />
            <details class="table-view">
              <summary>Data table (every 10 seconds)</summary>
              <div class="scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      @for (s of series(); track s.key) { <th scope="col">{{ s.title }} ({{ s.unit }})</th> }
                    </tr>
                  </thead>
                  <tbody>
                    @for (r of tableRows(); track r.time) {
                      <tr><th scope="row">{{ r.time }}</th>@for (v of r.values; track $index) { <td>{{ v }}</td> }</tr>
                    }
                  </tbody>
                </table>
              </div>
            </details>
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
            @if (!f.hasGps && auth.canEdit()) {
              <button class="link" type="button" [disabled]="busy()" (click)="reprocess(f)">Re-read log file</button>
            }
          </dd>
        </dl>

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
    .panel { margin-bottom: 1rem; }
    .panel h2 { margin: 0 0 .75rem; }
    .panel-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: .75rem; }
    .panel-head h2 { margin: 0; }
    .stats { display: grid; grid-template-columns: max-content 1fr; gap: .45rem 1.25rem; margin: 0; }
    .stats dt { font-size: .72rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; padding-top: .15rem; }
    dt { color: var(--muted); }
    dd { margin: 0; }
    .warn { color: var(--warn); }
    .headline { list-style: none; margin: 0 0 1rem; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .75rem; }
    .headline li { position: relative; background: var(--surface); border: 1px solid var(--line); border-radius: 12px;
                   padding: .8rem 1rem .85rem 1.15rem; display: grid; gap: .15rem; align-content: start; box-shadow: var(--shadow); overflow: hidden; }
    .headline li::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--accent); }
    .battery li::before { background: var(--ok); }
    .num { font-family: var(--mono); font-size: 1.6rem; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
    .num small { font-size: .8rem; font-weight: 600; color: var(--muted); margin: 0 .25rem; letter-spacing: 0; }
    .num.low { color: var(--warn); }
    .lbl { color: var(--muted); font-size: .7rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .sub { color: var(--muted); font-size: .78rem; }
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
    .notes { white-space: pre-wrap; }
  `],
})
export class FlightDetailComponent {
  readonly auth = inject(AuthService);
  readonly units = inject(UnitsService);
  id = input.required<number, unknown>({ transform: numberAttribute });

  private service = inject(FlightService);
  private tuneService = inject(TuneService);
  private router = inject(Router);

  flight = signal<Flight | null>(null);
  track = signal<FlightTrack | null>(null);
  trackFailed = signal(false);
  sticks = signal<StickPoint[] | null>(null);
  battery = signal<BatteryPoint[] | null>(null);

  seconds = computed(() => (this.flight()?.durationMs ?? 0) / 1000);

  /** Playback position, seconds since log start. Persists between hovers. */
  scrubTime = signal(0);
  playing = signal(false);
  /** Moment under the pointer on the map or charts; previews without moving the playback position. */
  hoverTime = signal<number | null>(null);

  /** The one moment everything shows: the playback clock while playing, otherwise a hover or the scrub position. */
  cursorTime = computed(() => (this.playing() ? this.scrubTime() : this.hoverTime() ?? this.scrubTime()));

  private trackTimes = computed(() => this.track()?.points.map(p => p[0]) ?? []);
  private batteryTimes = computed(() => this.battery()?.map(p => p[0]) ?? []);
  private stickTimes = computed(() => this.sticks()?.map(p => p[0]) ?? []);

  /** Track point nearest the cursor, for the map marker. */
  mapIndex = computed(() => (this.trackTimes().length ? nearest(this.trackTimes(), this.cursorTime()) : null));

  /** Live values for the playback readout. */
  readouts = computed<Readout[]>(() => {
    const t = this.cursorTime();
    const out: Readout[] = [];
    const tp = this.track()?.points;
    if (tp?.length) {
      const p = tp[nearest(this.trackTimes(), t)];
      out.push({ label: 'Speed', value: this.units.fromMs(p[4]).toFixed(0), unit: this.units.speedLabel() });
      out.push({ label: 'Height', value: p[3].toFixed(0), unit: 'm' });
    }
    const bp = this.battery();
    const cells = this.flight()?.battery?.cells ?? 1;
    if (bp?.length) {
      const p = bp[nearest(this.batteryTimes(), t)];
      out.push({ label: 'Battery', value: p[1].toFixed(1), unit: 'V', sub: `${(p[1] / cells).toFixed(2)} V/cell` });
      if (p[2] !== null) out.push({ label: 'Current', value: p[2].toFixed(1), unit: 'A', sub: `${Math.round(p[1] * p[2])} W` });
    }
    const sp = this.sticks();
    if (sp?.length) {
      const p = sp[nearest(this.stickTimes(), t)];
      out.push({ label: 'Throttle', value: Math.round((p[4] - 1000) / 10).toString(), unit: '%' });
    }
    return out;
  });

  /** Everything that gets a chart, on one time axis. */
  series = computed<ChartSeries[]>(() => {
    const out: ChartSeries[] = [];
    const tp = this.track()?.points;
    if (tp?.length) {
      out.push({ key: 'height', title: 'Height above takeoff', unit: 'm', times: this.trackTimes(), values: tp.map(p => p[3]) });
      out.push({ key: 'speed', title: 'Ground speed', unit: this.units.speedLabel(), times: this.trackTimes(), values: tp.map(p => this.units.fromMs(p[4])) });
    }
    const bp = this.battery();
    if (bp?.length) {
      out.push({ key: 'volts', title: 'Battery voltage', unit: 'V', times: this.batteryTimes(), values: bp.map(p => p[1]), decimals: 1, fromZero: false });
      if (bp[0][2] !== null) {
        out.push({ key: 'amps', title: 'Current', unit: 'A', times: this.batteryTimes(), values: bp.map(p => p[2] ?? 0), decimals: 1 });
      }
    }
    return out;
  });

  /** Text alternative to the charts: one row per 10 s of flight. */
  tableRows = computed(() => {
    const series = this.series();
    const rows: { time: string; values: string[] }[] = [];
    for (let t = 0; t <= this.seconds(); t += 10) {
      rows.push({ time: clock(t), values: series.map(s => s.values[nearest(s.times, t)].toFixed(s.decimals ?? 0)) });
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

  /** From the map. Ignored while playing so the pointer doesn't fight the clock. */
  onMapHover(i: number | null) {
    if (this.playing()) return;
    const p = i === null ? undefined : this.track()?.points[i];
    this.hoverTime.set(p ? p[0] : null);
  }

  onChartHover(t: number | null) {
    if (!this.playing()) this.hoverTime.set(t);
  }

  private loadLogData(f: Flight) {
    this.track.set(null);
    this.sticks.set(null);
    this.battery.set(null);
    this.playing.set(false);
    this.scrubTime.set(0);
    this.hoverTime.set(null);
    this.trackFailed.set(false);
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

  /** "4.87" and "km", so the unit can be styled smaller. */
  distanceValue(f: Flight) {
    return f.distanceM === null ? '' : formatDistance(f.distanceM).split(' ')[0];
  }

  distanceUnit(f: Flight) {
    return f.distanceM === null ? '' : formatDistance(f.distanceM).split(' ')[1];
  }

  speed(ms: number | null) {
    return ms === null ? '' : this.units.fromMs(ms).toFixed(0);
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
