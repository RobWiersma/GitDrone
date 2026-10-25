import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PublicStats, VisitService } from '../stats/visit.service';

/** What each public count is called, in the order the page shows them; sub ones are part of the one before. */
const COUNTS: Record<string, { label: string; sub?: boolean }> = {
  'video-rendered': { label: 'Finished videos rendered' },
  'short-rendered': { label: 'of them vertical Shorts', sub: true },
  'overlay-exported': { label: 'Transparent overlays exported' },
  'log-loaded': { label: 'Blackbox logs loaded' },
  'log-from-usb': { label: 'straight off the quad over USB', sub: true },
  'footage-loaded': { label: 'Clips of footage loaded' },
};

/**
 * About LovelyOSD Editor: what it is, how it treats your files, and what people have made with it so far, from the
 * same anonymous counters as the owner's Visitors page (totals only).
 */
@Component({
  selector: 'app-about',
  imports: [DatePipe, DecimalPipe, RouterLink],
  template: `
    <article class="page about">
      <p class="eyebrow">About</p>
      <h1>LovelyOSD Editor</h1>
      <p class="lede">
        A free video editor for FPV pilots that runs in your browser. Give it your Betaflight blackbox log and your footage,
        and it puts your OSD back on the video, synced to your flight, in your goggles' own font, then renders the finished
        video on your graphics card. It's part of GitDrone, an open-source logbook for FPV flights.
      </p>
      <p class="cta"><a class="btn btn-primary" routerLink="/osd">Open the editor</a>
        <a routerLink="/guides/add-osd-to-dji-o4-footage">How to add your OSD to DJI O4 footage</a></p>

      <section aria-labelledby="numbers-heading">
        <h2 id="numbers-heading">By the numbers</h2>
        @if (stats(); as s) {
          @if (s.since) {
            <p class="hint">Counted anonymously since {{ s.since | date: 'd MMMM y' : 'UTC' }}. Every one of these happened in someone's own browser.</p>
          } @else {
            <p class="hint">Counting has just started: these fill in as people make videos.</p>
          }
          <ul class="numbers">
            @for (c of main(); track c.name) {
              <li class="panel">
                <span class="num">{{ c.total | number }}</span>
                <span class="what">{{ label(c.name) }}</span>
                <span class="recent">{{ c.last30Days | number }} in the last 30 days</span>
                @if (subOf(c.name); as sub) {
                  <span class="sub">{{ sub.total | number }} {{ label(sub.name) }}</span>
                }
              </li>
            }
          </ul>
        } @else if (failed()) {
          <p class="hint">The numbers couldn't be loaded just now.</p>
        } @else {
          <p class="hint">Loading...</p>
        }
      </section>

      <section aria-labelledby="privacy-heading">
        <h2 id="privacy-heading">Your files stay yours</h2>
        <ul class="points">
          <li>Your footage, sound, music and OSD font play and render on your own computer. They're never uploaded.</li>
          <li>The blackbox log is sent to be decoded, read in memory and forgotten. No account, nothing kept.</li>
          <li>
            The numbers above come from anonymous counters: when someone renders a video, only the words "video rendered" are
            counted, with a visitor hash that changes every day. No cookies, no IP addresses, no file names or settings.
          </li>
        </ul>
      </section>

      <section aria-labelledby="open-heading">
        <h2 id="open-heading">Open source</h2>
        <p>
          LovelyOSD Editor and GitDrone are free and open source under the GPL-3.0, built on Betaflight and Blackbox Explorer.
          The code, and the place for ideas and problems, is <a href="https://github.com/RobWiersma/GitDrone">on GitHub</a>.
        </p>
      </section>
    </article>
  `,
  styles: [`
    .about { max-width: 50rem; display: grid; gap: 1.5rem; }
    .eyebrow { margin: 0; text-transform: uppercase; letter-spacing: .06em; font-size: .78rem; font-weight: 700; color: var(--muted); }
    h1 { font-size: clamp(1.9rem, 4vw, 2.5rem); margin: 0; }
    h2 { font-size: 1.3rem; margin: 0 0 .6rem; }
    .lede { font-size: 1.1rem; line-height: 1.6; margin: 0; }
    .cta { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem 1.25rem; margin: 0; }
    .hint { margin: 0 0 .75rem; }
    .numbers { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr)); gap: .75rem; }
    .numbers li { display: grid; gap: .2rem; border-top: 3px solid var(--accent); }
    .num { font-family: var(--mono); font-size: 2.2rem; font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .what { font-weight: 700; }
    .recent, .sub { color: var(--muted); font-size: .88rem; }
    .points { margin: 0; padding-left: 1.2rem; display: grid; gap: .4rem; line-height: 1.6; }
    p { line-height: 1.6; }
  `],
})
export class AboutComponent {
  private visits = inject(VisitService);
  stats = signal<PublicStats | null>(null);
  failed = signal(false);
  /** The headline counts; the sub ones show inside the tile they belong to. */
  main = computed(() => (this.stats()?.counts ?? []).filter(c => !COUNTS[c.name]?.sub));

  constructor() {
    this.visits.publicStats().subscribe({ next: s => this.stats.set(s), error: () => this.failed.set(true) });
  }

  label(name: string) {
    return COUNTS[name]?.label ?? name;
  }

  /** The sub count that follows `name` in the list, if any (videos have Shorts, logs have USB). */
  subOf(name: string) {
    const counts = this.stats()?.counts ?? [];
    const next = counts[counts.findIndex(c => c.name === name) + 1];
    return next && COUNTS[next.name]?.sub ? next : null;
  }
}
