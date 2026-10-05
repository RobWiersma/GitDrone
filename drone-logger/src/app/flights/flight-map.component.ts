import { Component, ElementRef, OnDestroy, afterNextRender, computed, effect, inject, input, model, signal, viewChild } from '@angular/core';
import * as L from 'leaflet';
import { FlightTrack, SpeedUnit, TrackPoint, speedFromMs } from './flight.models';
import { ThemeService } from '../theme.service';
import { UnitsService } from '../units.service';

/**
 * Speed bands. Fixed (not scaled per flight) so colours mean the same thing on every flight. Each unit gets
 * round thresholds of its own (15/30/45/60 km/h, 10/20/30/40 mph) rather than awkward converted numbers.
 * One-hue blue ramp where faster always means more contrast with the map: darker on light tiles, brighter on
 * dark tiles. Both validated as ordinal ramps against their surface.
 */
const COLORS = [
  { light: '#6da7ec', dark: '#1c5cab' },
  { light: '#3987e5', dark: '#2a78d6' },
  { light: '#256abf', dark: '#5598e7' },
  { light: '#184f95', dark: '#86b6ef' },
  { light: '#0d366b', dark: '#cde2fb' },
];
const STEPS: Record<SpeedUnit, number[]> = { kmh: [15, 30, 45, 60], mph: [10, 20, 30, 40] };

function bandsFor(unit: SpeedUnit) {
  const s = STEPS[unit];
  const labels = [`under ${s[0]}`, `${s[0]}–${s[1]}`, `${s[1]}–${s[2]}`, `${s[2]}–${s[3]}`, `${s[3]}+`];
  return COLORS.map((c, i) => ({ ...c, upTo: s[i] ?? Infinity, label: labels[i] }));
}

/** Leaflet draws on canvas, so CSS variables have to be resolved to real colours. */
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

@Component({
  selector: 'app-flight-map',
  template: `
    <div #map class="map" role="region" aria-label="Map of the flight path, coloured by ground speed"></div>
    <div class="legend" role="group" aria-label="Speed legend">
      <span class="title">Speed, {{ units.speedLabel() }}</span>
      @for (b of bands(); track b.label) {
        <span class="item"><span class="swatch" [style.background]="b.color"></span>{{ b.label }}</span>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .map { height: 26rem; border-radius: 10px; border: 1px solid var(--line); z-index: 0; }
    .legend { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem 1rem; margin-top: .6rem; font-size: .88rem; }
    .title { color: var(--muted); font-size: .72rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .item { display: inline-flex; align-items: center; gap: .35rem; }
    .swatch { width: 1.4rem; height: .5rem; border-radius: 4px; box-shadow: 0 0 0 2px var(--surface); }
    @media (max-width: 42rem) { .map { height: 20rem; } }
  `],
})
export class FlightMapComponent implements OnDestroy {
  track = input.required<FlightTrack>();

  /** Index into track().points under the pointer, shared with the height/speed charts. */
  hoverIndex = model<number | null>(null);

  private theme = inject(ThemeService);
  readonly units = inject(UnitsService);
  private rawBands = computed(() => bandsFor(this.units.speed()));
  readonly bands = computed(() => this.rawBands().map(b => ({ label: b.label, color: this.theme.dark() ? b.dark : b.light })));

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
      this.theme.dark(); // redraw with the other palette when the theme changes
      this.units.speed(); // or the bands when the speed unit changes
      if (this.ready()) this.draw(t);
    });

    // Follow hovers that start on the charts.
    effect(() => {
      const i = this.hoverIndex();
      if (this.ready()) this.showCursor(i);
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
      const speed = speedFromMs(pts[i][4], this.units.speed());
      const band = this.rawBands().findIndex(b => speed < b.upTo);
      const last = runs.at(-1);
      if (last && last.band === band) last.coords.push([pts[i][1], pts[i][2]]);
      else runs.push({ band, coords: [[pts[i - 1][1], pts[i - 1][2]], [pts[i][1], pts[i][2]]] });
    }
    // A white casing under every run keeps the line readable over busy tiles.
    const colors = this.bands().map(b => b.color);
    const casing = cssVar('--map-casing');
    for (const r of runs) L.polyline(r.coords, { color: casing, weight: 6, opacity: 0.9, interactive: false }).addTo(layers);
    for (const r of runs) L.polyline(r.coords, { color: colors[r.band], weight: 3, interactive: false }).addTo(layers);

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
      L.circleMarker(m.at, { radius: 6, color: cssVar('--mark-ink'), weight: 2, fillColor: cssVar(m.filled ? '--mark-ink' : '--mark-fill'), fillOpacity: 1, interactive: false })
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
    this.hoverIndex.set(best < 0 ? null : best);
  }

  private clearHover() {
    this.hoverIndex.set(null);
  }

  private showCursor(i: number | null) {
    const p = i === null ? undefined : this.track().points[i];
    if (!p) {
      this.cursor?.remove();
      this.cursor = undefined;
      return;
    }
    if (!this.cursor) {
      this.cursor = L.circleMarker([p[1], p[2]], { radius: 7, color: cssVar('--mark-fill'), weight: 2, fillColor: cssVar('--accent'), fillOpacity: 1, interactive: false })
        .addTo(this.layers!);
    } else {
      this.cursor.setLatLng([p[1], p[2]]);
    }
  }
}
