import { Component, computed, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AircraftService } from './aircraft.service';
import { Aircraft } from './aircraft.models';
import { AircraftImageComponent } from './aircraft-image.component';
import { TuneTimelineComponent } from '../tunes/tune-timeline.component';
import { FlightListComponent } from '../flights/flight-list.component';

@Component({
  selector: 'app-aircraft-detail',
  imports: [RouterLink, AircraftImageComponent, TuneTimelineComponent, FlightListComponent],
  template: `
    <div class="page">
      <a routerLink="/aircraft">Back to hangar</a>

      @if (notFound()) {
        <p class="error">That aircraft doesn't exist. It may have been deleted.</p>
      } @else if (aircraft(); as a) {
        <div class="head">
          <app-aircraft-image [src]="a.imageUrl" [alt]="a.name" />
          <div>
            <h1>{{ a.name }}</h1>
            <p class="hint">{{ a.type }}</p>
            <dl>
              @for (f of facts(); track f.label) {
                <dt>{{ f.label }}</dt><dd>{{ f.value }}</dd>
              }
            </dl>
            @if (a.notes) { <p class="notes">{{ a.notes }}</p> }
            <div class="actions">
              <a class="btn" [routerLink]="['/aircraft', a.id, 'edit']">Edit</a>
              <button class="btn btn-danger" type="button" (click)="remove(a)">Delete</button>
            </div>
          </div>
        </div>

        <app-flight-list [aircraftId]="a.id" />
        <app-tune-timeline [aircraftId]="a.id" />
      }
    </div>
  `,
  styles: [`
    .head { display: grid; grid-template-columns: minmax(14rem, 22rem) 1fr; gap: 2rem; margin: 1rem 0 2rem; align-items: start; }
    .head app-aircraft-image { border-radius: 8px; border: 1px solid var(--line); }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; margin: 1rem 0; }
    dt { color: var(--muted); }
    dd { margin: 0; }
    .notes { max-width: 60ch; }
    app-tune-timeline { display: block; margin-top: 1.5rem; }
    .actions { display: flex; gap: .75rem; margin-top: 1rem; }
    @media (max-width: 42rem) { .head { grid-template-columns: 1fr; } }
  `],
})
export class AircraftDetailComponent {
  id = input.required<number, unknown>({ transform: numberAttribute });

  private service = inject(AircraftService);
  private router = inject(Router);

  aircraft = signal<Aircraft | null>(null);
  notFound = signal(false);

  facts = computed(() => {
    const a = this.aircraft();
    if (!a) return [];
    return [
      { label: 'Prop size', value: a.propSize },
      { label: 'Frame', value: a.frame },
      { label: 'Flight controller', value: a.flightController },
      { label: 'Battery', value: a.battery },
      { label: 'Weight', value: a.weightGrams ? `${a.weightGrams} g` : '' },
    ].filter(f => f.value);
  });

  constructor() {
    effect(() => {
      this.notFound.set(false);
      this.service.get(this.id()).subscribe({
        next: a => this.aircraft.set(a),
        error: () => this.notFound.set(true),
      });
    });
  }

  remove(a: Aircraft) {
    if (!confirm(`Delete ${a.name} and all of its tunes and flights? This can't be undone.`)) return;
    this.service.remove(a.id).subscribe(() => this.router.navigate(['/aircraft']));
  }
}
