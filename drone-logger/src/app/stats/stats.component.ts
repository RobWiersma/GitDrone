import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { VisitService, VisitStats } from './visit.service';

/** Friendly names for the paths the API folds visits onto. */
const PAGE_NAMES: Record<string, string> = {
  '/': 'Home', '/osd': 'LovelyOSD Overlay', '/flights': 'Flights feed', '/flights/:id': 'Flight page',
  '/flights/:id/overlay': 'Flight overlay export', '/hangar': 'Hangar', '/hangar/:id': 'Aircraft page',
  '/hangar/new': 'Add aircraft', '/hangar/:id/edit': 'Edit aircraft', '/hangar/:id/tunes/import': 'Import tune',
  '/hangar/:id/tunes/bulk': 'Bulk import tunes', '/hangar/:id/flights/upload': 'Upload log', '/tunes/compare': 'Compare tunes',
  '/stats': 'Stats', '/other': 'Other',
};

const RANGES = [7, 30, 90];

/** Round tick step (1, 2 or 5 x 10^n) giving about `count` ticks from 0 to max. */
function ticks(max: number, count = 3): number[] {
  const raw = Math.max(1, max) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map(f => f * pow).find(s => s >= raw)!);
  // Always end on a tick at or above the tallest bar, so no bar pokes out of the top.
  const out = [0];
  while (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  if (out.length === 1) out.push(step);
  return out;
}

/** Owner-only page: daily unique visitors and the pages they open, from the privacy-friendly counter. */
@Component({
  selector: 'app-stats',
  imports: [DatePipe, DecimalPipe],
  template: `
    <div class="page stats">
      <div class="head">
        <h1>Visitors</h1>
        <div class="ranges" role="group" aria-label="Period">
          @for (r of ranges; track r) {
            <button type="button" class="btn small" [class.on]="days() === r" [attr.aria-pressed]="days() === r" (click)="days.set(r)">
              {{ r }} days
            </button>
          }
        </div>
      </div>
      <p class="hint">
        Counted without cookies or IP addresses: each visitor is a hash that changes every day, so the same person on two days
        counts twice, and nobody can be followed over time. Your own visits while signed in aren't counted.
      </p>

      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      } @else if (stats(); as s) {
        <ul class="tiles" aria-label="Summary">
          <li class="panel"><span class="lbl">Today</span><span class="num">{{ s.today | number }}</span><span class="sub">unique visitors</span></li>
          <li class="panel"><span class="lbl">Last {{ s.days }} days</span><span class="num">{{ s.total | number }}</span><span class="sub">visitors, added up per day</span></li>
          <li class="panel"><span class="lbl">Busiest day</span><span class="num">{{ busiest()?.visitors ?? 0 | number }}</span>
            <span class="sub">{{ busiest() ? (busiest()!.day | date: 'EEE d MMM' : 'UTC') : 'No visits yet' }}</span></li>
        </ul>

        <section class="panel" aria-labelledby="daily-heading">
          <h2 id="daily-heading">Unique visitors per day</h2>
          <div class="chart" (mouseleave)="hover.set(null)">
            <div class="yaxis" aria-hidden="true">
              @for (t of yTicks(); track t) { <span [style.bottom.%]="t / yMax() * 100">{{ t }}</span> }
            </div>
            <div class="plot">
              @for (t of yTicks(); track t) { <i class="grid" [style.bottom.%]="t / yMax() * 100" aria-hidden="true"></i> }
              <div class="bars">
                @for (d of s.daily; track d.day; let i = $index) {
                  <button type="button" class="bar" [style.height.%]="d.visitors / yMax() * 100" [class.zero]="d.visitors === 0"
                          [attr.aria-label]="(d.day | date: 'EEE d MMM' : 'UTC') + ': ' + d.visitors + ' visitors'"
                          (mouseenter)="hover.set(i)" (focus)="hover.set(i)" (blur)="hover.set(null)"></button>
                }
              </div>
              @if (hover() !== null) {
                @let d = s.daily[hover()!];
                <div class="tip" [style.left.%]="(hover()! + .5) / s.daily.length * 100" aria-hidden="true">
                  <strong>{{ d.visitors }}</strong> {{ d.visitors === 1 ? 'visitor' : 'visitors' }}<br />{{ d.day | date: 'EEE d MMM' : 'UTC' }}
                </div>
              }
            </div>
          </div>
          <div class="xaxis" aria-hidden="true">
            <span>{{ s.daily[0].day | date: 'd MMM' : 'UTC' }}</span>
            <span>{{ s.daily[s.daily.length - 1].day | date: 'd MMM' : 'UTC' }}</span>
          </div>
          <details class="table-view">
            <summary>Data table</summary>
            <table>
              <thead><tr><th scope="col">Day</th><th scope="col">Unique visitors</th></tr></thead>
              <tbody>
                @for (d of s.daily; track d.day) { <tr><th scope="row">{{ d.day | date: 'EEE d MMM y' : 'UTC' }}</th><td>{{ d.visitors }}</td></tr> }
              </tbody>
            </table>
          </details>
        </section>

        <section class="panel" aria-labelledby="refs-heading">
          <h2 id="refs-heading">Where visitors came from</h2>
          <p class="hint">The site that linked to GitDrone (name only, never the full link), counted once per visitor per day.
            Direct means a typed address, a bookmark, or an app that doesn't say.</p>
          @if (s.referrers.length) {
            <table class="pages">
              <thead><tr><th scope="col">Source</th><th scope="col">Visitors</th><th scope="col"><span class="sr-only">Share</span></th></tr></thead>
              <tbody>
                @for (r of s.referrers; track r.source) {
                  <tr>
                    <th scope="row">{{ r.source }}</th>
                    <td>{{ r.visitors | number }}</td>
                    <td class="meter" aria-hidden="true"><i [style.width.%]="r.visitors / s.referrers[0].visitors * 100"></i></td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <p>No visits in this period yet.</p>
          }
        </section>

        <section class="panel" aria-labelledby="pages-heading">
          <h2 id="pages-heading">Pages</h2>
          <p class="hint">Visitors who opened each page, counted once per day.</p>
          @if (s.pages.length) {
            <table class="pages">
              <thead><tr><th scope="col">Page</th><th scope="col">Visitors</th><th scope="col"><span class="sr-only">Share</span></th></tr></thead>
              <tbody>
                @for (p of s.pages; track p.path) {
                  <tr>
                    <th scope="row">{{ pageName(p.path) }} <span class="path">{{ p.path }}</span></th>
                    <td>{{ p.visitors | number }}</td>
                    <td class="meter" aria-hidden="true"><i [style.width.%]="p.visitors / s.pages[0].visitors * 100"></i></td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <p>No visits in this period yet.</p>
          }
        </section>
      } @else {
        <p class="hint">Loading...</p>
      }
    </div>
  `,
  styles: [`
    .stats { max-width: 56rem; display: grid; gap: 1rem; }
    .head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .ranges { display: flex; gap: .4rem; }
    .small { padding: .3rem .75rem; font-size: .88rem; }
    .btn.on { border-color: var(--accent); color: var(--accent); }
    .hint { margin: 0; }
    h2 { margin: 0 0 .75rem; font-size: 1.1rem; }

    .tiles { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; }
    @media (max-width: 36rem) { .tiles { grid-template-columns: 1fr; } }
    .tiles li { display: grid; gap: .15rem; }
    .lbl { color: var(--muted); font-size: .7rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .num { font-family: var(--mono); font-size: 1.6rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .sub { color: var(--muted); font-size: .8rem; }

    /* Bar chart: one series, so no legend; the heading names it. */
    .chart { display: grid; grid-template-columns: 2rem minmax(0, 1fr); height: 12rem; }
    .yaxis { position: relative; }
    .yaxis span { position: absolute; right: .4rem; transform: translateY(50%); font-family: var(--mono); font-size: 11px; color: var(--muted); }
    .plot { position: relative; border-bottom: 1px solid var(--line); }
    .grid { position: absolute; left: 0; right: 0; height: 0; border-top: 1px solid var(--line); }
    .bars { position: absolute; inset: 0; display: flex; align-items: flex-end; gap: 2px; }
    .bar { flex: 1 1 0; min-width: 0; margin: 0; padding: 0; border: 0; background: var(--chart-line); border-radius: 4px 4px 0 0; cursor: default; }
    .bar.zero { background: transparent; height: 100% !important; } /* full-height hit target, nothing drawn */
    .bar:hover:not(.zero), .bar:focus-visible:not(.zero) { filter: brightness(1.15); }
    .bar:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .tip { position: absolute; top: .25rem; transform: translateX(-50%); background: var(--ink); color: var(--surface); padding: .3rem .5rem;
           border-radius: 6px; font-size: .78rem; line-height: 1.3; white-space: nowrap; pointer-events: none; text-align: center; }
    .xaxis { display: flex; justify-content: space-between; margin-left: 2rem; font-family: var(--mono); font-size: 11px; color: var(--muted); padding-top: .25rem; }

    .table-view { margin-top: .75rem; font-size: .9rem; }
    .table-view summary { cursor: pointer; color: var(--accent); }
    table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
    th, td { text-align: left; padding: .3rem 1rem .3rem 0; border-bottom: 1px solid var(--line); }
    thead th { color: var(--muted); font-weight: 600; }
    tbody th { font-weight: normal; }
    .pages { width: 100%; }
    .pages td:nth-child(2) { text-align: right; width: 5rem; }
    .path { color: var(--muted); font-family: var(--mono); font-size: .78rem; margin-left: .4rem; }
    .meter { width: 30%; }
    .meter i { display: block; height: .5rem; border-radius: 0 4px 4px 0; background: var(--chart-line); min-width: 2px; }
  `],
})
export class StatsComponent {
  private visits = inject(VisitService);
  readonly ranges = RANGES;

  days = signal(30);
  stats = signal<VisitStats | null>(null);
  error = signal('');
  hover = signal<number | null>(null);

  busiest = computed(() => {
    const d = this.stats()?.daily ?? [];
    const best = d.reduce((a, b) => (b.visitors > a.visitors ? b : a), d[0]);
    return best && best.visitors > 0 ? best : null;
  });
  yTicks = computed(() => ticks(Math.max(0, ...(this.stats()?.daily.map(d => d.visitors) ?? [0]))));
  yMax = computed(() => this.yTicks().at(-1) || 1);

  constructor() {
    effect(() => {
      const n = this.days();
      this.error.set('');
      this.hover.set(null);
      this.visits.stats(n).subscribe({
        next: s => this.stats.set(s),
        error: () => this.error.set('Could not load the visitor stats. Check that you are signed in.'),
      });
    });
  }

  pageName(path: string) {
    return PAGE_NAMES[path] ?? path;
  }
}
