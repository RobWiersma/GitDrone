import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FlightService } from './flight.service';
import { Flight, flightDate, formatDuration } from './flight.models';

const PAGE_SIZE = 50;

/** Front page: every aircraft's flights, newest first, grouped by day. */
@Component({
  selector: 'app-flight-feed',
  imports: [DatePipe, DecimalPipe, RouterLink],
  template: `
    <div class="page">
      <h1>Flights</h1>

      @if (failed() && flights().length === 0) {
        <p class="error">Couldn't load flights. Check that the API is running, then reload.</p>
      } @else if (loading() && flights().length === 0) {
        <p class="hint">Loading flights...</p>
      } @else if (flights().length === 0) {
        <div class="panel empty">
          <h2>No flights yet</h2>
          <p>Open an aircraft in the hangar and upload a blackbox log to see it here.</p>
          <a class="btn btn-primary" routerLink="/aircraft">Go to hangar</a>
        </div>
      } @else {
        @for (day of days(); track day.key) {
          <section class="panel day" [attr.aria-labelledby]="'day-' + day.key">
            <h2 [id]="'day-' + day.key">{{ day.date | date: 'EEEE d MMMM y' }}</h2>
            <p class="hint summary">
              {{ day.flights.length }} {{ day.flights.length === 1 ? 'flight' : 'flights' }}, {{ day.total }} in the air
            </p>
            <ul>
              @for (f of day.flights; track f.id) {
                <li>
                  <a class="row" [routerLink]="['/flights', f.id]">
                    <span class="time">
                      @if (f.startedAt) { {{ f.startedAt | date: 'HH:mm' }} } @else { <span class="hint">no clock</span> }
                    </span>
                    <span class="craft">{{ f.aircraftName }}</span>
                    <span class="dur">{{ duration(f) }}</span>
                    <span class="tune">{{ f.tuneLabel ?? 'No tune linked' }}</span>
                    <span class="thr">
                      @if (f.avgThrottlePercent !== null) {
                        {{ f.avgThrottlePercent | number: '1.0-0' }}% avg throttle
                      }
                    </span>
                  </a>
                </li>
              }
            </ul>
          </section>
        }

        @if (hasMore()) {
          <div class="more">
            <button class="btn" type="button" [disabled]="loading()" (click)="loadMore()">
              {{ loading() ? 'Loading...' : 'Show older flights' }}
            </button>
          </div>
        }
        @if (failed()) { <p class="error" role="alert">Couldn't load more flights. Try again.</p> }
      }
    </div>
  `,
  styles: [`
    h1 { margin-bottom: 1.25rem; }
    .day { margin-bottom: 1.25rem; padding-bottom: .5rem; }
    .summary { margin: .1rem 0 .6rem; font-size: .9rem; }
    ul { list-style: none; margin: 0; padding: 0; }
    li + li { border-top: 1px solid var(--line); }
    .row { display: grid; grid-template-columns: 4rem minmax(8rem, 1.2fr) 4rem minmax(8rem, 1.5fr) 9rem; gap: .75rem;
           align-items: baseline; padding: .55rem .25rem; color: inherit; text-decoration: none; border-radius: 4px; }
    .row:hover { background: var(--wash); }
    .row:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .time { font-variant-numeric: tabular-nums; color: var(--muted); }
    .craft { font-weight: 600; color: var(--accent); }
    .dur { font-variant-numeric: tabular-nums; }
    .tune, .thr { color: var(--muted); font-size: .92rem; }
    .thr { text-align: right; }
    .more { display: flex; justify-content: center; margin-top: 1rem; }
    .empty h2 { margin-bottom: .25rem; }
    @media (max-width: 42rem) {
      .row { grid-template-columns: 3.5rem 1fr auto; row-gap: .1rem; }
      .tune, .thr { grid-column: 2 / -1; text-align: left; }
    }
  `],
})
export class FlightFeedComponent {
  private service = inject(FlightService);

  flights = signal<Flight[]>([]);
  hasMore = signal(false);
  loading = signal(false);
  failed = signal(false);

  /** Flights grouped by local calendar day, keeping the newest-first order. */
  days = computed(() => {
    const days: { key: string; date: Date; flights: Flight[]; total: string }[] = [];
    for (const f of this.flights()) {
      const date = new Date(flightDate(f));
      const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
      let day = days.at(-1);
      if (day?.key !== key) days.push(day = { key, date, flights: [], total: '' });
      day.flights.push(f);
    }
    for (const d of days) d.total = formatDuration(d.flights.reduce((sum, f) => sum + f.durationMs, 0));
    return days;
  });

  constructor() {
    this.loadMore();
  }

  loadMore() {
    this.loading.set(true);
    this.failed.set(false);
    this.service.feed(this.flights().length, PAGE_SIZE).subscribe({
      next: page => {
        this.flights.update(list => [...list, ...page.flights]);
        this.hasMore.set(page.hasMore);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.failed.set(true);
      },
    });
  }

  duration(f: Flight) {
    return formatDuration(f.durationMs);
  }
}
