import { Component, effect, inject, input, linkedSignal, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Aircraft } from '../aircraft/aircraft.models';
import { TuneService } from './tune.service';
import { TuneSnapshotSummary } from './tune.models';

/** One side of a comparison: pick an aircraft, then one of its snapshots. */
@Component({
  selector: 'app-tune-picker',
  imports: [DatePipe],
  template: `
    <fieldset>
      <legend>{{ legend() }}</legend>
      <div class="field">
        <label [for]="name() + '-aircraft'">Aircraft</label>
        <select [id]="name() + '-aircraft'" (change)="pickAircraft($event)">
          @for (a of aircraft(); track a.id) {
            <option [value]="a.id" [selected]="a.id === selectedAircraft()">{{ a.name }}</option>
          }
        </select>
      </div>
      <div class="field">
        <label [for]="name() + '-tune'">Tune</label>
        <select [id]="name() + '-tune'" (change)="pickTune($event)" [disabled]="tunes().length === 0">
          @for (t of tunes(); track t.id) {
            <option [value]="t.id" [selected]="t.id === snapshotId()">{{ t.label }} ({{ t.createdAt | date: 'd MMM y' }})</option>
          } @empty {
            <option>No tunes saved</option>
          }
        </select>
      </div>
    </fieldset>
  `,
  styles: [`
    fieldset { border: 1px solid var(--line); border-radius: 8px; padding: .75rem 1rem .25rem; margin: 0; min-width: 0; }
    legend { font-weight: 600; padding: 0 .3rem; }
  `],
})
export class TunePickerComponent {
  legend = input.required<string>();
  /** Prefix for element ids, so two pickers on one page don't collide. */
  name = input.required<string>();
  aircraft = input.required<Aircraft[]>();
  aircraftId = input.required<number>();
  snapshotId = input.required<number>();
  picked = output<number>();

  private service = inject(TuneService);
  selectedAircraft = linkedSignal(() => this.aircraftId());
  tunes = signal<TuneSnapshotSummary[]>([]);
  /** Set when the user switches aircraft, so the newest tune of the new aircraft gets picked once loaded. */
  private autoPick = false;

  constructor() {
    effect(() => {
      this.service.list(this.selectedAircraft()).subscribe(list => {
        const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        this.tunes.set(sorted);
        if (this.autoPick && sorted.length > 0) this.picked.emit(sorted[0].id);
        this.autoPick = false;
      });
    });
  }

  pickAircraft(event: Event) {
    this.autoPick = true;
    this.selectedAircraft.set(Number((event.target as HTMLSelectElement).value));
  }

  pickTune(event: Event) {
    this.picked.emit(Number((event.target as HTMLSelectElement).value));
  }
}
