import { Component, effect, inject, input, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FlightService } from './flight.service';
import { Flight, formatDuration } from './flight.models';

@Component({
  selector: 'app-flight-list',
  imports: [RouterLink, DatePipe, DecimalPipe],
  template: `
    <section class="panel">
      <div class="bar">
        <h2>Flights</h2>
        <a class="btn btn-primary" [routerLink]="['/aircraft', aircraftId(), 'flights', 'upload']">Upload blackbox log</a>
      </div>

      @switch (state()) {
        @case ('loading') { <p class="hint">Loading flights...</p> }
        @case ('error') { <p class="error">Couldn't load flights. Check that the API is running, then reload.</p> }
        @default {
          @if (flights().length === 0) {
            <p>No flights yet. Upload a <code>.bbl</code> file from the flight controller or SD card to log one.</p>
          } @else {
            <div class="scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Duration</th>
                    <th scope="col">Tune</th>
                    <th scope="col">Throttle avg / max</th>
                  </tr>
                </thead>
                <tbody>
                  @for (f of flights(); track f.id) {
                    <tr>
                      <th scope="row">
                        <a [routerLink]="['/flights', f.id]">
                          @if (f.startedAt) { {{ f.startedAt | date: 'd MMM y, HH:mm' }} } @else { {{ f.originalFileName }} #{{ f.logIndex + 1 }} }
                        </a>
                      </th>
                      <td>{{ duration(f) }}</td>
                      <td>{{ f.tuneLabel ?? 'None' }}</td>
                      <td>
                        @if (f.avgThrottlePercent !== null) {
                          {{ f.avgThrottlePercent | number: '1.0-0' }}% / {{ f.maxThrottlePercent | number: '1.0-0' }}%
                        } @else { <span class="hint">not logged</span> }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      }
    </section>
  `,
  styles: [`
    .scroll { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid var(--line); white-space: nowrap; }
    thead th { font-size: .85rem; color: var(--muted); font-weight: 600; }
    tbody th { font-weight: normal; }
  `],
})
export class FlightListComponent {
  aircraftId = input.required<number>();

  private service = inject(FlightService);
  state = signal<'loading' | 'ready' | 'error'>('loading');
  flights = signal<Flight[]>([]);

  constructor() {
    effect(() => {
      this.state.set('loading');
      this.service.list(this.aircraftId()).subscribe({
        next: list => { this.flights.set(list); this.state.set('ready'); },
        error: () => this.state.set('error'),
      });
    });
  }

  duration(f: Flight) {
    return formatDuration(f.durationMs);
  }
}
