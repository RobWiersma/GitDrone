import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TuneService } from './tune.service';
import { TuneSnapshotSummary } from './tune.models';
import { TuneRawComponent } from './tune-raw.component';

@Component({
  selector: 'app-tune-timeline',
  imports: [RouterLink, DatePipe, TuneRawComponent],
  template: `
    <section class="panel">
      <div class="bar">
        <h2>Tune history</h2>
        <div class="bar-actions">
          <a class="btn" [routerLink]="['/aircraft', aircraftId(), 'tunes', 'bulk']">Bulk import</a>
          <a class="btn btn-primary" [routerLink]="['/aircraft', aircraftId(), 'tunes', 'import']">Import tune</a>
        </div>
      </div>

      @switch (state()) {
        @case ('loading') { <p class="hint">Loading tunes...</p> }
        @case ('error') { <p class="error">Couldn't load tune history. Check that the API is running, then reload.</p> }
        @default {
          @if (rows().length === 0) {
            <p>No tunes saved yet. Paste the output of <code>diff all</code> from the Betaflight CLI to record this aircraft's first snapshot.</p>
          } @else {
            <ol class="timeline">
              @for (row of rows(); track row.snapshot.id) {
                <li class="snap">
                  <h3>{{ row.snapshot.label }}</h3>
                  <p class="meta">
                    {{ row.snapshot.createdAt | date: 'd MMM y' }}, Betaflight {{ row.snapshot.firmwareVersion }} on {{ row.snapshot.target }}
                  </p>
                  <p class="meta">
                    {{ row.snapshot.settingCount }} non-default settings,
                    {{ row.snapshot.flightCount }} {{ row.snapshot.flightCount === 1 ? 'flight' : 'flights' }}
                  </p>
                  @if (row.snapshot.notes) { <p class="note">{{ row.snapshot.notes }}</p> }
                  <div class="links">
                    @if (row.previousId) {
                      <a routerLink="/tunes/compare" [queryParams]="{ from: row.previousId, to: row.snapshot.id }">
                        Compare with previous<span class="sr-only"> tune ({{ row.snapshot.label }})</span>
                      </a>
                    }
                    <app-tune-raw [snapshotId]="row.snapshot.id" [label]="row.snapshot.label" />
                  </div>
                </li>
                @if (row.firmwareChange) {
                  <li class="fw">Firmware updated from {{ row.firmwareChange }}</li>
                }
              }
            </ol>
          }
        }
      }
    </section>
  `,
  styles: [`
    .bar-actions { display: flex; gap: .6rem; }
    h3 { margin: 0; font-size: 1.05rem; }
    .meta { margin: .1rem 0 0; color: var(--muted); font-size: .92rem; }
    .note { margin: .5rem 0 0; max-width: 60ch; }
    .links { margin-top: .4rem; font-size: .92rem; display: flex; flex-wrap: wrap; column-gap: 1.25rem; row-gap: .25rem; }
    .timeline { list-style: none; margin: 1rem 0 0; padding: 0 0 0 1.25rem; border-left: 2px solid var(--line); }
    .snap, .fw { position: relative; padding-bottom: 1.4rem; }
    .snap::before { content: ""; position: absolute; left: calc(-1.25rem - 1px - .35rem); top: .4rem;
                    width: .7rem; height: .7rem; border-radius: 50%; background: var(--accent); }
    .fw { color: var(--warn); font-weight: 600; font-size: .9rem; }
    .fw::before { content: ""; position: absolute; left: calc(-1.25rem - 1px - .3rem); top: .4rem;
                  width: .6rem; height: .6rem; background: var(--warn); transform: rotate(45deg); }
  `],
})
export class TuneTimelineComponent {
  aircraftId = input.required<number>();

  private tunes = inject(TuneService);
  state = signal<'loading' | 'ready' | 'error'>('loading');
  snapshots = signal<TuneSnapshotSummary[]>([]);

  /** Newest first, each row noting if the firmware differs from the snapshot before it. */
  rows = computed(() => {
    const sorted = [...this.snapshots()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sorted.map((snapshot, i) => {
      const older = sorted[i + 1];
      const changed = older && older.firmwareVersion !== snapshot.firmwareVersion;
      return {
        snapshot,
        previousId: older?.id ?? null,
        firmwareChange: changed ? `${older.firmwareVersion} to ${snapshot.firmwareVersion}` : null,
      };
    });
  });

  constructor() {
    effect(() => {
      this.state.set('loading');
      this.tunes.list(this.aircraftId()).subscribe({
        next: list => { this.snapshots.set(list); this.state.set('ready'); },
        error: () => this.state.set('error'),
      });
    });
  }
}
