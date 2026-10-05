import { Component, ElementRef, OnDestroy, afterNextRender, inject, input } from '@angular/core';
import type * as Leaflet from 'leaflet';
import { FlightService } from './flight.service';

/**
 * Small, non-interactive map of a flight's path for list rows. Waits until it scrolls into view, then loads
 * Leaflet (lazily, so the feed's initial bundle stays small) and a thinned copy of the track.
 * Decorative: the row it sits in already says everything in text, so it's hidden from assistive tech.
 */
@Component({
  selector: 'app-flight-thumb',
  template: '',
  host: { 'aria-hidden': 'true' },
  styles: [`
    :host { display: block; width: 100%; height: 100%; border-radius: 6px; overflow: hidden; background: var(--wash);
            pointer-events: none; /* clicks go to the row's link */ }
    :host ::ng-deep .leaflet-control-attribution { font-size: 9px; padding: 0 3px; line-height: 1.4; }
  `],
})
export class FlightThumbComponent implements OnDestroy {
  flightId = input.required<number>();

  private el = inject<ElementRef<HTMLElement>>(ElementRef);
  private service = inject(FlightService);
  private observer?: IntersectionObserver;
  private map?: Leaflet.Map;
  private destroyed = false;

  constructor() {
    afterNextRender(() => {
      this.observer = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) {
          this.observer?.disconnect();
          this.load();
        }
      }, { rootMargin: '200px' });
      this.observer.observe(this.el.nativeElement);
    });
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.observer?.disconnect();
    this.map?.remove();
  }

  private load() {
    this.service.track(this.flightId(), 120).subscribe(async track => {
      // Leaflet 1.x is CommonJS, so a dynamic import wraps it: the API lives on `default`.
      const mod = await import('leaflet');
      const L = ((mod as unknown as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
      if (this.destroyed || track.points.length < 2) return;

      const map = L.map(this.el.nativeElement, {
        zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false,
        keyboard: false, touchZoom: false, zoomSnap: 0.25, fadeAnimation: false, zoomAnimation: false,
        attributionControl: false,
      });
      // Short-form credit is what OSM asks for on small maps; plain text, since the row is already a link.
      L.control.attribution({ prefix: false }).addAttribution('© OpenStreetMap').addTo(map);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);

      const line = track.points.map(p => [p[1], p[2]] as Leaflet.LatLngTuple);
      L.polyline(line, { color: '#ffffff', weight: 4, opacity: 0.9, interactive: false }).addTo(map);
      L.polyline(line, { color: '#184f95', weight: 2, interactive: false }).addTo(map);
      map.fitBounds(L.latLngBounds(line), { padding: [6, 6], animate: false });
      this.map = map;
    });
  }
}
