import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FlightService } from '../flights/flight.service';
import { Flight, flightDate, formatDistance, formatDuration } from '../flights/flight.models';
import { FlightThumbComponent } from '../flights/flight-thumb.component';

/** Welcome page: what GitDrone does, the way into LovelyOSD, and the latest flights. */
@Component({
  selector: 'app-home',
  imports: [DatePipe, RouterLink, FlightThumbComponent],
  template: `
    <div class="page home">
      <section class="hero" aria-labelledby="hero-heading">
        <div class="hero-text">
          <p class="eyebrow">For FPV pilots</p>
          <h1 id="hero-heading">Your flights, your tunes, and an OSD overlay for every video</h1>
          <p class="lede">
            GitDrone reads Betaflight blackbox logs and turns them into maps, charts and stick replays, keeps your tune history,
            and makes a transparent OSD overlay for your footage in your goggles' own font.
          </p>
          <div class="cta">
            <a class="btn btn-primary" routerLink="/osd">Make an OSD overlay</a>
            <a class="btn" routerLink="/flights">Browse flights</a>
          </div>
          <p class="hint">LovelyOSD is free and needs no account.</p>
        </div>

        <!-- Decorative: a still of what an overlay looks like. The real thing is drawn from your log. -->
        <div class="screen" aria-hidden="true">
          <div class="osd map"><svg viewBox="0 0 100 100"><path d="M12 80 C 4 40, 28 6, 58 12 S 96 42, 82 70 S 40 94, 26 66 S 50 34, 66 50"
            fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" /><circle cx="66" cy="50" r="7" fill="#fff" /></svg></div>
          <div class="osd info"><span>24 SAT</span><span>53% RSSI</span><span>⌂ 81 m</span><span>▲ 8 m</span></div>
          <div class="osd speed"><span class="big">64</span> km/h <span class="r">9.3 A</span><span>0.8G</span><span class="r">294 W</span></div>
          <div class="osd sticks"><i></i><i></i></div>
          <div class="osd battery"><span class="big">3.52</span> V/cell <span class="r">2:11</span><span>21.1 V</span><span class="r">287 mAh</span></div>
        </div>
      </section>

      <section aria-labelledby="features-heading">
        <h2 id="features-heading" class="sr-only">What you can do</h2>
        <ul class="features">
          <li class="panel">
            <h3><a routerLink="/osd">LovelyOSD overlays</a></h3>
            <p>
              Drop in a blackbox log and export a transparent <strong>.mov</strong> for Premiere or After Effects: speed, battery,
              sticks, a mini map, RSSI and a Betaflight-style stats screen at the end. Drag, resize and recolour every element.
            </p>
          </li>
          <li class="panel">
            <h3><a routerLink="/flights">Flight analysis</a></h3>
            <p>
              Every flight gets a map coloured by speed, height, speed, battery and RSSI charts, a stick replay, and the numbers
              that matter: top speed, lowest cell, mAh used, peak power.
            </p>
          </li>
          <li class="panel">
            <h3><a routerLink="/hangar">Tune history</a></h3>
            <p>
              Paste a <code>diff all</code> after each change and see what you changed, grouped by PIDs, filters and rates. Compare
              any two tunes, and see which tune each flight was flown on.
            </p>
          </li>
          <li class="panel">
            <h3><a routerLink="/hangar">Your hangar</a></h3>
            <p>Each quad with its photo, specs, tunes and flights in one place.</p>
          </li>
        </ul>
      </section>

      <section class="panel steps" aria-labelledby="steps-heading">
        <h2 id="steps-heading">An overlay in three steps</h2>
        <ol>
          <li><strong>Load a log.</strong> Any Betaflight <code>.bbl</code> or <code>.bfl</code> file from your flight controller or SD card.</li>
          <li><strong>Make it yours.</strong> Load your goggles' <code>font_bf.bin</code>, move things around, pick colours, check the preview.</li>
          <li><strong>Export.</strong> A lossless video with transparency. Put it on a track above your footage and line it up with takeoff.</li>
        </ol>
        <a class="btn btn-primary" routerLink="/osd">Try LovelyOSD</a>
      </section>

      <section class="promises" aria-labelledby="promises-heading">
        <h2 id="promises-heading">Free, private, open source</h2>
        <ul>
          <li><strong>Free, no account.</strong> LovelyOSD works without signing up.</li>
          <li><strong>Nothing kept.</strong> A log you open in LovelyOSD is read and forgotten, and the video is rendered in your browser.</li>
          <li><strong>Your font stays yours.</strong> OSD fonts load from your computer and are never uploaded.</li>
          <li>
            <strong>Open source.</strong> GPL-3.0, built on Betaflight and Blackbox Explorer.
            <a href="https://github.com/RobWiersma/GitDrone">Code on GitHub</a>
          </li>
        </ul>
      </section>

      @if (latest().length) {
        <section aria-labelledby="latest-heading">
          <div class="latest-head">
            <h2 id="latest-heading">Latest flights</h2>
            <a routerLink="/flights">All flights</a>
          </div>
          <ul class="latest">
            @for (f of latest(); track f.id) {
              <li>
                <a class="panel flight" [routerLink]="['/flights', f.id]">
                  <span class="thumb">@if (f.hasGps) { <app-flight-thumb [flightId]="f.id" /> } @else { <span class="no-gps">No GPS</span> }</span>
                  <span class="craft">{{ f.aircraftName }}</span>
                  <span class="hint">{{ date(f) | date: 'd MMM y' }} · {{ duration(f) }}@if (f.distanceM !== null) { · {{ distance(f) }} }</span>
                </a>
              </li>
            }
          </ul>
        </section>
      }
    </div>
  `,
  styles: [`
    .home { display: grid; gap: 2.5rem; }
    h2 { margin: 0 0 .75rem; }

    .hero { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 2rem; align-items: center; padding-top: .5rem; }
    @media (max-width: 52rem) { .hero { grid-template-columns: 1fr; } }
    .hero h1 { font-size: clamp(1.9rem, 4vw, 2.7rem); margin: .3rem 0 .8rem; }
    .lede { font-size: 1.08rem; line-height: 1.55; margin: 0 0 1.2rem; max-width: 36rem; }
    .cta { display: flex; flex-wrap: wrap; gap: .75rem; margin-bottom: .5rem; }

    /* The pretend video frame. */
    .screen { position: relative; aspect-ratio: 16 / 9; border-radius: 14px; overflow: hidden; border: 1px solid var(--line);
              background: linear-gradient(180deg, #5d82a8 0%, #8fb0c9 46%, #4f6b3e 47%, #2f4426 100%); box-shadow: var(--shadow);
              font-family: var(--mono); color: #fff; font-weight: 700;
              container-type: inline-size; /* everything inside scales with the frame, not the window */ }
    .screen > * { font-size: 2.3cqw; }
    .osd { position: absolute; background: rgb(8 12 16 / .45); border-radius: .6em; padding: .5em .8em; white-space: nowrap;
           text-shadow: 0 1px 2px rgb(0 0 0 / .8); }
    .map { top: 4%; right: 3%; width: 25cqw; height: 25cqw; padding: 0; color: #9be564; }
    .map svg { display: block; width: 100%; height: 100%; padding: 8%; box-sizing: border-box; }
    .info { top: calc(4% + 26.5cqw); right: 3%; width: 25cqw; box-sizing: border-box; display: grid; grid-template-columns: 1fr auto; gap: .25em .6em; }
    .speed, .battery { bottom: 5%; width: 34cqw; box-sizing: border-box; display: grid; grid-template-columns: auto 1fr auto;
                       align-items: baseline; column-gap: .4em; row-gap: .25em; }
    .speed { left: 3%; }
    .battery { right: 3%; }
    .speed .big, .battery .big { font-size: 1.9em; line-height: 1; }
    .speed .r, .battery .r { text-align: right; }
    .speed > span:nth-child(4), .battery > span:nth-child(4) { grid-column: 1 / 3; }
    .sticks { bottom: 5%; left: 50%; transform: translateX(-50%); display: flex; gap: .8em; background: none; padding: 0; }
    .sticks i { width: 3.9em; height: 3.9em; border-radius: 6px; background: rgb(28 28 28 / .75); position: relative;
                background-image: linear-gradient(rgb(255 255 255 / .35), rgb(255 255 255 / .35)), linear-gradient(90deg, rgb(255 255 255 / .35), rgb(255 255 255 / .35));
                background-size: 1px 100%, 100% 1px; background-position: center; background-repeat: no-repeat; }
    .sticks i::after { content: ''; position: absolute; width: .6em; height: .6em; border-radius: 50%; background: #ff5a5a; left: 50%; top: 50%;
                       transform: translate(-50%, -50%); }
    .sticks i:first-child::after { top: 82%; }
    .sticks i:last-child::after { left: 64%; top: 38%; }

    .features { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 1rem; }
    .features h3 { margin: 0 0 .4rem; font-size: 1.05rem; }
    .features h3 a { color: inherit; text-decoration: none; }
    .features h3 a:hover { color: var(--accent); }
    .features p { margin: 0; line-height: 1.5; }
    .features li { border-top: 3px solid var(--accent); }

    .steps ol { margin: 0 0 1rem; padding-left: 1.3rem; display: grid; gap: .5rem; line-height: 1.5; }

    .promises ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: .75rem 1.5rem; }
    .promises li { line-height: 1.5; padding-left: 1.4rem; position: relative; }
    .promises li::before { content: '✓'; position: absolute; left: 0; color: var(--ok); font-weight: 800; }

    .latest-head { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
    .latest { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 1rem; }
    .flight { display: grid; gap: .3rem; color: inherit; text-decoration: none; padding: .75rem; }
    .flight:hover { border-color: var(--accent); }
    .flight:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .flight .thumb { display: block; height: 7.5rem; border-radius: 8px; overflow: hidden; background: var(--raised); }
    .no-gps { display: grid; place-items: center; height: 100%; color: var(--muted); font-size: .85rem; }
    .craft { font-weight: 700; }
  `],
})
export class HomeComponent {
  private flights = inject(FlightService);
  latest = signal<Flight[]>([]);

  constructor() {
    this.flights.feed(0, 3).subscribe({ next: p => this.latest.set(p.flights), error: () => this.latest.set([]) });
  }

  date(f: Flight) {
    return flightDate(f);
  }

  duration(f: Flight) {
    return formatDuration(f.durationMs);
  }

  distance(f: Flight) {
    return f.distanceM === null ? '' : formatDistance(f.distanceM);
  }
}
