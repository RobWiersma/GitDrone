import { Component, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin, of, catchError, map } from 'rxjs';
import { FlightService } from './flight.service';
import { Flight } from './flight.models';
import { OverlayData } from './overlay-renderer';
import { OverlayExportComponent } from './overlay-export.component';
import { BlackboxTipsComponent } from './blackbox-tips.component';

@Component({
  selector: 'app-flight-overlay',
  imports: [RouterLink, OverlayExportComponent, BlackboxTipsComponent],
  template: `
    <div class="page">
      @if (flight(); as f) {
        <a [routerLink]="['/flights', f.id]">Back to flight</a>
        <h1>Video overlay</h1>
        <p class="hint">
          A transparent QuickTime video of the HUD, to put on a track above your footage in Premiere or After Effects.
          It starts at arming, so line it up with your takeoff.
        </p>
        @if (data(); as d) {
          <app-overlay-export [data]="d" [seconds]="f.durationMs / 1000" [fileStem]="'gitdrone-overlay-' + f.id" />
        } @else {
          <p class="hint">Loading flight data...</p>
        }
        <app-blackbox-tips />
      } @else {
        <p class="hint">Loading flight...</p>
      }
    </div>
  `,
})
export class FlightOverlayComponent {
  id = input.required<number, unknown>({ transform: numberAttribute });

  private service = inject(FlightService);

  flight = signal<Flight | null>(null);
  data = signal<OverlayData | null>(null);

  constructor() {
    effect(() => {
      this.service.get(this.id()).subscribe(f => {
        this.flight.set(f);
        const none = <T>() => of(null as T | null);
        forkJoin({
          track: f.hasGps ? this.service.track(f.id).pipe(catchError(() => none<OverlayData['track']>())) : none<OverlayData['track']>(),
          sticks: f.hasSticks ? this.service.sticks(f.id).pipe(map(s => s.points), catchError(() => none<OverlayData['sticks']>())) : none<OverlayData['sticks']>(),
          battery: this.service.battery(f.id).pipe(catchError(() => none<OverlayData['battery']>())),
          telemetry: f.hasTelemetry
            ? this.service.telemetry(f.id).pipe(map(t => t.points), catchError(() => none<OverlayData['telemetry']>()))
            : none<OverlayData['telemetry']>(),
        }).subscribe(d => this.data.set(d));
      });
    });
  }
}
