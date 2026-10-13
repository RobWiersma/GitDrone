import { Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe, NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FlightService } from '../flights/flight.service';
import { Flight, flightDate, formatDistance, formatDuration } from '../flights/flight.models';
import { FlightThumbComponent } from '../flights/flight-thumb.component';

/** Welcome page: what GitDrone does, the way into LovelyOSD, and the latest flights. */
@Component({
  selector: 'app-home',
  imports: [DatePipe, NgOptimizedImage, RouterLink, FlightThumbComponent],
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

        <figure class="reel">
          <div class="frames" aria-roledescription="carousel" aria-label="LovelyOSD overlay on real footage">
            @for (f of frames; track f.src; let i = $index) {
              <div class="frame" [class.on]="i === current()" [attr.aria-hidden]="i !== current()"
                   [attr.aria-roledescription]="'slide'" [attr.aria-label]="(i + 1) + ' of ' + frames.length">
                <img [ngSrc]="f.src" fill [priority]="i === 0" [alt]="f.alt" />
              </div>
            }
            <div class="reel-controls">
              <button type="button" class="pause" (click)="togglePlay()"
                      [attr.aria-label]="playing() ? 'Pause the slideshow' : 'Play the slideshow'">
                @if (playing()) {
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg>
                } @else {
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" fill="currentColor" /></svg>
                }
              </button>
              <div class="dots">
                @for (f of frames; track f.src; let i = $index) {
                  <button type="button" [class.on]="i === current()" [attr.aria-current]="i === current() ? 'true' : null"
                          [attr.aria-label]="'Show frame ' + (i + 1)" (click)="show(i)"></button>
                }
              </div>
            </div>
          </div>
          <figcaption class="hint">
            Real footage with a LovelyOSD overlay.
          </figcaption>
        </figure>
      </section>

      <section aria-labelledby="features-heading">
        <h2 id="features-heading" class="sr-only">What you can do</h2>
        <ul class="features">
          <li class="panel">
            <h3><a routerLink="/osd">LovelyOSD overlays</a></h3>
            <p>
              Drop in a blackbox log and export a transparent <strong>.mov</strong> for Premiere or After Effects: speed, battery,
              sticks, a mini map, RSSI and a Betaflight-style stats screen at the end. Drag, resize and recolour every element,
              and preview it playing over your own footage.
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
          <li><strong>Make it yours.</strong> Load your goggles' <code>font_bf.bin</code>, move things around and pick colours, with your own
            flight video playing behind it, synced to your takeoff.</li>
          <li><strong>Export.</strong> A lossless video with transparency. Put it on a track above your footage, at the time the page gives you.</li>
        </ol>
        <a class="btn btn-primary" routerLink="/osd">Try LovelyOSD</a>
      </section>

      <section class="promises" aria-labelledby="promises-heading">
        <h2 id="promises-heading">Free, private, open source</h2>
        <ul>
          <li><strong>Free, no account.</strong> LovelyOSD works without signing up.</li>
          <li><strong>Nothing kept.</strong> A log you open in LovelyOSD is read and forgotten, and the video is rendered in your browser.</li>
          <li><strong>Your font stays yours.</strong> OSD fonts load from your computer and are never uploaded.</li>
          <li><strong>No tracking cookies.</strong> Visits are counted with a hash that changes daily. No IP addresses are stored.</li>
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

    /* Slideshow of real footage with the overlay. */
    .reel { margin: 0; display: grid; gap: .45rem; }
    .reel figcaption { margin: 0; font-size: .85rem; }
    .frames { position: relative; aspect-ratio: 16 / 9; border-radius: 14px; overflow: hidden; border: 1px solid var(--line);
              background: #0a0f14; box-shadow: var(--shadow); }
    .frame { position: absolute; inset: 0; opacity: 0; transition: opacity 1s ease; }
    .frame.on { opacity: 1; }
    .frame img { object-fit: cover; }
    @media (prefers-reduced-motion: reduce) { .frame { transition: none; } }
    .reel-controls { position: absolute; left: .6rem; right: .6rem; bottom: .6rem; display: flex; align-items: center; justify-content: space-between;
                     pointer-events: none; }
    .reel-controls > * { pointer-events: auto; }
    .pause { width: 2rem; height: 2rem; border-radius: 50%; border: 0; background: rgb(8 12 16 / .65); color: #fff; display: grid; place-items: center;
             cursor: pointer; padding: 0; }
    .pause svg { width: .9rem; height: .9rem; }
    .dots { display: flex; gap: .35rem; background: rgb(8 12 16 / .55); padding: .4rem .55rem; border-radius: 999px; }
    /* Each dot is a 24px tap target around an 8px dot. */
    .dots button { width: 1.5rem; height: 1.5rem; margin: -.5rem -.25rem; border: 0; padding: 0; background: none; cursor: pointer; position: relative; }
    .dots button::after { content: ''; position: absolute; inset: 50% auto auto 50%; width: .5rem; height: .5rem; border-radius: 50%;
                          transform: translate(-50%, -50%); background: rgb(255 255 255 / .5); }
    .dots button.on::after { background: #fff; width: 1rem; border-radius: 999px; }
    .pause:focus-visible, .dots button:focus-visible { outline: 2px solid #9be564; outline-offset: 2px; border-radius: 999px; }

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

  /** Frames from a real flight with a LovelyOSD overlay (Speedybee Mario 5 X). */
  readonly frames = [
    { src: 'home/osd-hillside.jpg', alt: 'FPV view over a sunny hillside and bay, with the overlay showing a speed of 47, 3.94 V per cell, the mini map and both sticks' },
    { src: 'home/osd-treetop.jpg', alt: 'Looking straight down at a tree from above, with the overlay showing speed, battery, flight time and the mini map' },
    { src: 'home/osd-field.jpg', alt: 'Diving toward a dirt field, with the overlay showing a speed of 11, satellites, RSSI and the stick positions' },
    { src: 'home/osd-picnic.jpg', alt: 'Low over a picnic area, with the overlay showing 3.73 V per cell, 402 mAh used and 3:10 flight time' },
    { src: 'home/osd-treeline.jpg', alt: 'Skimming the grass toward a tree line under blue sky, with the overlay showing a speed of 28 and 454 mAh used' },
  ];
  current = signal(0);
  /** Auto-advance, unless the visitor asked for reduced motion. */
  playing = signal(!matchMedia('(prefers-reduced-motion: reduce)').matches);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.flights.feed(0, 3).subscribe({ next: p => this.latest.set(p.flights), error: () => this.latest.set([]) });
    if (this.playing()) this.start();
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  show(i: number) {
    this.current.set(i);
    if (this.playing()) { this.stop(); this.start(); } // a full interval on the frame you picked
  }

  togglePlay() {
    this.playing.update(p => !p);
    if (this.playing()) this.start(); else this.stop();
  }

  private start() {
    this.stop();
    this.timer = setInterval(() => this.current.update(i => (i + 1) % this.frames.length), 5000);
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
