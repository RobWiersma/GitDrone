import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AircraftService } from './aircraft.service';
import { Aircraft } from './aircraft.models';
import { AircraftImageComponent } from './aircraft-image.component';

@Component({
  selector: 'app-aircraft-list',
  imports: [RouterLink, DatePipe, AircraftImageComponent],
  template: `
    <div class="page">
      <header class="bar">
        <h1>Hangar</h1>
        <a class="btn btn-primary" routerLink="/hangar/new">Add aircraft</a>
      </header>

      @if (failed()) {
        <p class="error">Couldn't load your aircraft. Check that the API is running, then reload.</p>
      } @else if (aircraft() === null) {
        <p class="hint">Loading aircraft...</p>
      } @else if (aircraft()!.length === 0) {
        <div class="panel empty">
          <h2>No aircraft yet</h2>
          <p>Add your first quad to start keeping its tune history.</p>
          <a class="btn btn-primary" routerLink="/hangar/new">Add aircraft</a>
        </div>
      } @else {
        <ul class="grid">
          @for (a of aircraft(); track a.id) {
            <li>
              <a class="card" [routerLink]="['/hangar', a.id]">
                <app-aircraft-image [src]="a.imageUrl" [alt]="a.name" />
                <div class="body">
                  <h2>{{ a.name }}</h2>
                  <p class="hint">{{ a.type }}{{ a.propSize ? ', ' + a.propSize + ' props' : '' }}</p>
                  <p class="tunes">
                    @if (a.tuneCount > 0) {
                      {{ a.tuneCount }} saved {{ a.tuneCount === 1 ? 'tune' : 'tunes' }},
                      last {{ a.lastTuneAt | date: 'd MMM y' }}
                    } @else {
                      No tunes saved yet
                    }
                  </p>
                </div>
              </a>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    .grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 1.25rem;
            grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); }
    .card { display: block; background: var(--surface); border: 1px solid var(--line); border-radius: 8px;
            overflow: hidden; color: inherit; text-decoration: none; }
    .card:hover { border-color: var(--muted); }
    .card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .body { padding: .85rem 1rem 1rem; }
    .body p { margin: .15rem 0 0; }
    .tunes { font-size: .9rem; margin-top: .6rem !important; }
    .empty { display: grid; gap: .5rem; justify-items: start; }
    .empty p { margin: 0 0 .5rem; }
  `],
})
export class AircraftListComponent {
  aircraft = signal<Aircraft[] | null>(null);
  failed = signal(false);

  constructor() {
    inject(AircraftService).list().subscribe({
      next: list => this.aircraft.set(list),
      error: () => this.failed.set(true),
    });
  }
}
