import { Component, ElementRef, OnDestroy, afterNextRender, effect, input, signal, viewChild } from '@angular/core';
import * as L from 'leaflet';
import { FlightTrack, TrackPoint, msToKmh } from './flight.models';

/**
 * Speed bands, km/h. Fixed (not scaled per flight) so colours mean the same thing on every flight.
 * Colours: one-hue blue ramp, light = slow, dark = fast; validated as an ordinal ramp.
 */
const BANDS = [
  { upTo: 15, color: '#6da7ec', label: 'under 15' },
  { upTo: 30, color: '#3987e5', label: '15–30' },
  { upTo: 45, color: '#256abf', label: '30–45' },
  { upTo: 60, color: '#184f95', label: '45–60' },
  { upTo: Infinity, color: '#0d366b', label: '60+' },
];

const bandOf = (p: TrackPoint) => BANDS.findIndex(b => msToKmh(p[4]) < b.upTo);

function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  return `${m}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

@Component({
  selector: 'app-flight-map',
  template: `
    <div #map class="map" role="region" aria-label="Map of the flight path, coloured by ground speed"></div>
    <div class="legend" role="group" aria-label="Speed legend">
      <span class="title">Speed, km/h</span>
      @for (b of bands; track b.label) {
        <span class="item"><span class="swatch" [style.background]="b.color"></span>{{ b.label }}</span>
      }
    </div>
    @if (hover(); as h) {
      <p class="readout" aria-live="polite">
        {{ h.time }} in: {{ h.speed }} km/h, {{ h.height }} m above takeoff
      </p>
    } @else {
      <p class="readout hint">Hover over the path to see speed and height.</p>
    }
  `,
  styles: [`
    :host { display: block; }
    .map { height: 26rem; border-radius: 8px; border: 1px solid var(--line); z-index: 0; }
    .legend { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem 1rem; margin-top: .6rem; font-size: .88rem; }
    .title { color: var(--muted); font-weight: 600; }
    .item { display: inline-flex; align-items: center; gap: .35rem; }
    .swatch { width: 1.4rem; height: .5rem; border-radius: 4px; box-shadow: 0 0 0 2px var(--surface); }
    .readout { margin: .4rem 0 0; font-size: .9rem; font-variant-numeric: tabular-nums; min-height: 1.4em; }
    @media (max-width: 42rem) { .map { height: 20rem; } }
  `],
})
export class FlightMapComponent implements OnDestroy {
  track = input.required<FlightTrack>();

  readonly bands = BANDS;
  hover = signal<{ time: string; speed: string; height: string } | null>(null);

  private host = viewChild.required<ElementRef<HTMLDivElement>>('map');
  private map?: L.Map;
  private layers?: L.LayerGroup;
  private cursor?: L.CircleMarker;
  private ready = signal(false);
  private resize?: ResizeObserver;
  private bounds?: L.LatLngBounds;

  constructor() {
    afterNextRender(() => {
      this.map = L.map(this.host().nativeElement, { preferCanvas: true, scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(this.map);
      this.layers = L.layerGroup().addTo(this.map);
      this.map.on('mousemove', e => this.onMove(e));
      this.map.on('mouseout', () => this.clearHover());
      // The container can still be 0px tall when the map is created, which makes fitBounds jump to max zoom.
      // Re-measure and re-fit whenever its size changes.
      this.resize = new ResizeObserver(() => {
        this.map?.invalidateSize();
        if (this.bounds) this.map?.fitBounds(this.bounds, { padding: [24, 24], animate: false });
      });
      this.resize.observe(this.host().nativeElement);
      this.ready.set(true);
    });

    effect(() => {
      const t = this.track();
      if (this.ready()) this.draw(t);
    });
  }

  ngOnDestroy() {
    this.resize?.disconnect();
    this.map?.remove();
  }

  private draw(track: FlightTrack) {
    const map = this.map!;
    const layers = this.layers!;
    layers.clearLayers();
    this.cursor = undefined;
    const pts = track.points;
    if (pts.length < 2) return;

    // Consecutive points in the same speed band share one polyline, which keeps the layer count low.
    const runs: { band: number; coords: L.LatLngExpression[] }[] = [];
    for (let i = 1; i < pts.length; i++) {
      const band = bandOf(pts[i]);
      const last = runs.at(-1);
      if (last && last.band === band) last.coords.push([pts[i][1], pts[i][2]]);
      else runs.push({ band, coords: [[pts[i - 1][1], pts[i - 1][2]], [pts[i][1], pts[i][2]]] });
    }
    // A white casing under every run keeps the line readable over busy tiles.
    for (const r of runs) L.polyline(r.coords, { color: '#ffffff', weight: 6, opacity: 0.9, interactive: false }).addTo(layers);
    for (const r of runs) L.polyline(r.coords, { color: BANDS[r.band].color, weight: 3, interactive: false }).addTo(layers);

    // Markers within 15 m share one label ("Home, Start, End"), otherwise the labels stack and hide each other.
    const end = pts.at(-1)!;
    const marks: { at: L.LatLng; names: string[]; filled: boolean }[] = [];
    const mark = (at: L.LatLng, name: string, filled: boolean) => {
      const near = marks.find(m => map.distance(m.at, at) < 15);
      if (near) { near.names.push(name); near.filled ||= filled; }
      else marks.push({ at, names: [name], filled });
    };
    if (track.home) mark(L.latLng(track.home), 'Home', false);
    mark(L.latLng(pts[0][1], pts[0][2]), 'Start', false);
    mark(L.latLng(end[1], end[2]), 'End', true);
    for (const m of marks) {
      L.circleMarker(m.at, { radius: 6, color: '#16222c', weight: 2, fillColor: m.filled ? '#16222c' : '#ffffff', fillOpacity: 1, interactive: false })
        .bindTooltip(m.names.join(', '), { permanent: true, direction: 'top', offset: [0, -6] })
        .addTo(layers);
    }

    const bounds = L.latLngBounds(pts.map(p => [p[1], p[2]] as L.LatLngTuple));
    if (track.home) bounds.extend(track.home);
    this.bounds = bounds;
    map.invalidateSize();
    map.fitBounds(bounds, { padding: [24, 24], animate: false });
  }

  /** Snap to the nearest track point within 24px of the pointer. */
  private onMove(e: L.LeafletMouseEvent) {
    const map = this.map!;
    const pts = this.track().points;
    let best = -1;
    let bestDist = 24 * 24;
    for (let i = 0; i < pts.length; i++) {
      const p = map.latLngToContainerPoint([pts[i][1], pts[i][2]]);
      const d = (p.x - e.containerPoint.x) ** 2 + (p.y - e.containerPoint.y) ** 2;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    if (best < 0) { this.clearHover(); return; }

    const p = pts[best];
    if (!this.cursor) {
      this.cursor = L.circleMarker([p[1], p[2]], { radius: 7, color: '#ffffff', weight: 2, fillColor: '#16222c', fillOpacity: 1, interactive: false })
        .addTo(this.layers!);
    } else {
      this.cursor.setLatLng([p[1], p[2]]);
    }
    this.hover.set({ time: clock(p[0]), speed: msToKmh(p[4]).toFixed(0), height: p[3].toFixed(0) });
  }

  private clearHover() {
    this.cursor?.remove();
    this.cursor = undefined;
    this.hover.set(null);
  }
}
