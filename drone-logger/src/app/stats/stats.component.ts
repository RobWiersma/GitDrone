import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import { UsageEvent, VisitService, VisitStats } from './visit.service';

/** Friendly names for the paths the API folds visits onto. */
const PAGE_NAMES: Record<string, string> = {
  '/': 'Home', '/osd': 'LovelyOSD Editor', '/flights': 'Flights feed', '/flights/:id': 'Flight page',
  '/flights/:id/overlay': 'Flight overlay export', '/hangar': 'Hangar', '/hangar/:id': 'Aircraft page',
  '/hangar/new': 'Add aircraft', '/hangar/:id/edit': 'Edit aircraft', '/hangar/:id/tunes/import': 'Import tune',
  '/hangar/:id/tunes/bulk': 'Bulk import tunes', '/hangar/:id/flights/upload': 'Upload log', '/tunes/compare': 'Compare tunes',
  '/stats': 'Stats', '/guides/add-osd-to-dji-o4-footage': 'Guide: OSD on DJI O4 footage', '/about': 'About', '/other': 'Other',
};

const RANGES = [7, 30, 90];

/** What each usage event means, in the order a visit goes; indented ones are part of the one above. */
const EVENT_NAMES: Record<UsageEvent, { label: string; sub?: boolean }> = {
  'sample-loaded': { label: 'Tried the sample flight' },
  'log-loaded': { label: 'Loaded a log' },
  'log-from-usb': { label: 'straight off the quad over USB', sub: true },
  'footage-loaded': { label: 'Added footage' },
  'sound-loaded': { label: 'Added a sound track' },
  'music-loaded': { label: 'Added music' },
  'video-rendered': { label: 'Rendered a finished video' },
  'short-rendered': { label: 'of them vertical Shorts', sub: true },
  'overlay-exported': { label: 'Exported a transparent overlay' },
  'render-failed': { label: 'Had a render fail' },
  'session-saved': { label: 'Saved a session' },
  'session-opened': { label: 'Reopened a saved session' },
};

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
  imports: [DatePipe, DecimalPipe, PercentPipe],
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
        counts twice, and nobody can be followed over time. Visits while signed in (yours) are counted on their own, in
        Signed in, and kept out of every other number.
      </p>

      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      } @else if (stats(); as s) {
        <ul class="tiles" aria-label="Summary">
          <li class="panel"><span class="lbl">Today</span><span class="num">{{ s.today | number }}</span><span class="sub">unique visitors</span></li>
          <li class="panel"><span class="lbl">Last {{ s.days }} days</span><span class="num">{{ s.total | number }}</span><span class="sub">visitors, added up per day</span></li>
          <li class="panel"><span class="lbl">Page views</span><span class="num">{{ pageViews() | number }}</span>
            <span class="sub">last {{ s.days }} days, each page once per visitor per day</span></li>
          <li class="panel"><span class="lbl">Signed in</span><span class="num">{{ s.signedIn | number }}</span>
            <span class="sub">you, on {{ s.signedInPageViews | number }} pages; {{ s.total | number }} visitors signed out</span></li>
          <li class="panel"><span class="lbl">Busiest day</span><span class="num">{{ busiest()?.visitors ?? 0 | number }}</span>
            <span class="sub">{{ busiest() ? (busiest()!.day | date: 'EEE d MMM' : 'UTC') : 'No visits yet' }}</span></li>
        </ul>

        <section class="panel" aria-labelledby="daily-heading">
          <h2 id="daily-heading">Visitors and page views per day</h2>
          <ul class="legend" aria-hidden="true">
            <li><i class="key v"></i>Unique visitors</li>
            <li><i class="key pv"></i>Page views</li>
          </ul>
          <div class="chart" (mouseleave)="hover.set(null)">
            <div class="yaxis" aria-hidden="true">
              @for (t of yTicks(); track t) { <span [style.bottom.%]="t / yMax() * 100">{{ t }}</span> }
            </div>
            <div class="plot">
              @for (t of yTicks(); track t) { <i class="grid" [style.bottom.%]="t / yMax() * 100" aria-hidden="true"></i> }
              <div class="bars">
                @for (d of s.daily; track d.day; let i = $index) {
                  <!-- The whole column is the hover target; page views behind, visitors (always fewer) in front. -->
                  <button type="button" class="bar"
                          [attr.aria-label]="(d.day | date: 'EEE d MMM' : 'UTC') + ': ' + d.visitors + ' visitors, ' + d.pageViews + ' page views'"
                          (mouseenter)="hover.set(i)" (focus)="hover.set(i)" (blur)="hover.set(null)">
                    @if (d.pageViews) { <i class="pv" [style.height.%]="d.pageViews / yMax() * 100"></i> }
                    @if (d.visitors) { <i class="v" [style.height.%]="d.visitors / yMax() * 100"></i> }
                  </button>
                }
              </div>
              @if (hover() !== null) {
                @let d = s.daily[hover()!];
                <div class="tip" [style.left.%]="(hover()! + .5) / s.daily.length * 100" aria-hidden="true">
                  <strong>{{ d.visitors }}</strong> {{ d.visitors === 1 ? 'visitor' : 'visitors' }} ·
                  <strong>{{ d.pageViews }}</strong> {{ d.pageViews === 1 ? 'page view' : 'page views' }}<br />{{ d.day | date: 'EEE d MMM' : 'UTC' }}
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
              <thead><tr><th scope="col">Day</th><th scope="col">Unique visitors</th><th scope="col">Page views</th><th scope="col">Signed in</th></tr></thead>
              <tbody>
                @for (d of s.daily; track d.day) {
                  <tr><th scope="row">{{ d.day | date: 'EEE d MMM y' : 'UTC' }}</th><td>{{ d.visitors }}</td><td>{{ d.pageViews }}</td><td>{{ d.signedIn }}</td></tr>
                }
              </tbody>
            </table>
          </details>
        </section>

        <section class="panel" aria-labelledby="usage-heading">
          <h2 id="usage-heading">What editor visitors did</h2>
          <p class="hint">
            Counted like visits, once per visitor per day, with how many times all told. Only the action is recorded: no file
            names, sizes or settings. The share is of LovelyOSD Editor's {{ editorVisitors() | number }} visitors in this period.
          </p>
          @if (s.events.length) {
            <table class="pages usage">
              <thead><tr><th scope="col">Action</th><th scope="col">Visitors</th><th scope="col">Times</th><th scope="col">Share</th></tr></thead>
              <tbody>
                @for (e of s.events; track e.name) {
                  <tr [class.sub]="eventName(e.name).sub">
                    <th scope="row">{{ eventName(e.name).label }}</th>
                    <td>{{ e.visitors | number }}</td>
                    <td>{{ e.times | number }}</td>
                    <td>{{ editorVisitors() ? (e.visitors / editorVisitors() | percent) : '–' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <p>Nobody has loaded a log or made a video in this period yet.</p>
          }
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

    .tiles { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: .75rem; }
    .tiles li { display: grid; gap: .15rem; }
    .lbl { color: var(--muted); font-size: .7rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .num { font-family: var(--mono); font-size: 1.6rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .sub { color: var(--muted); font-size: .8rem; }

    /* Bar chart: page views as a pale bar, visitors as a narrower solid one in front. */
    .legend { list-style: none; margin: -.4rem 0 .6rem; padding: 0; display: flex; gap: 1rem; font-size: .8rem; color: var(--muted); }
    .legend li { display: flex; align-items: center; gap: .35rem; }
    .key { width: .7rem; height: .7rem; border-radius: 2px; }
    .chart { display: grid; grid-template-columns: 2rem minmax(0, 1fr); height: 12rem; }
    .yaxis { position: relative; }
    .yaxis span { position: absolute; right: .4rem; transform: translateY(50%); font-family: var(--mono); font-size: 11px; color: var(--muted); }
    .plot { position: relative; border-bottom: 1px solid var(--line); }
    .grid { position: absolute; left: 0; right: 0; height: 0; border-top: 1px solid var(--line); }
    .bars { position: absolute; inset: 0; display: flex; align-items: flex-end; gap: 2px; }
    .bar { position: relative; flex: 1 1 0; min-width: 0; height: 100%; margin: 0; padding: 0; border: 0; background: transparent; cursor: default; }
    .bar i { position: absolute; bottom: 0; border-radius: 4px 4px 0 0; }
    .pv, .key.pv { background: color-mix(in srgb, var(--chart-line) 35%, transparent); }
    .bar .pv { left: 0; right: 0; }
    .v, .key.v { background: var(--chart-line); }
    .bar .v { left: 20%; right: 20%; }
    .bar:hover i, .bar:focus-visible i { filter: brightness(1.15); }
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
    .usage td { text-align: right; width: 5.5rem; }
    .usage .sub th { padding-left: 1.25rem; color: var(--muted); }
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
  /** Visitor-days on the editor page, the base for each action's share. */
  editorVisitors = computed(() => this.stats()?.pages.find(p => p.path === '/osd')?.visitors ?? 0);
  pageViews = computed(() => (this.stats()?.daily ?? []).reduce((sum, d) => sum + d.pageViews, 0));
  /** Scaled to the page views, the taller of the two. */
  yTicks = computed(() => ticks(Math.max(0, ...(this.stats()?.daily.map(d => Math.max(d.visitors, d.pageViews)) ?? [0]))));
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

  eventName(name: UsageEvent) {
    return EVENT_NAMES[name] ?? { label: name };
  }

  pageName(path: string) {
    return PAGE_NAMES[path] ?? path;
  }
}
