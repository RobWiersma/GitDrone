import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FlightService } from '../flights/flight.service';
import { Flight, flightDate, formatDistance, formatDuration } from '../flights/flight.models';
import { FlightThumbComponent } from '../flights/flight-thumb.component';
import { AuthService } from '../auth.service';
import { PhoneNoticeComponent } from '../phone-notice.component';

/** Welcome page, all about LovelyOSD Editor; someone signed in also gets the latest flights from their logbook. */
@Component({
  selector: 'app-home',
  imports: [DatePipe, RouterLink, FlightThumbComponent, PhoneNoticeComponent],
  template: `
    <div class="page home">
      <section class="hero" aria-labelledby="hero-heading">
        <div class="hero-text">
          <p class="eyebrow">LovelyOSD Editor · for FPV pilots</p>
          <h1 id="hero-heading">Your FPV footage with its OSD, ready to upload</h1>
          <p class="lede">
            Drop in your Betaflight blackbox log and your footage. LovelyOSD Editor lines them up on your takeoff, draws your OSD
            in your goggles' own font, grades the picture, mixes your sound and music, and renders a finished video or YouTube
            Short on your GPU, near lossless and in 4K if you shot 4K. Or export a transparent overlay for Premiere.
          </p>
          <div class="cta">
            <a class="btn btn-primary" routerLink="/osd">Open the editor</a>
            <a class="btn" routerLink="/guides/add-osd-to-dji-o4-footage">How it works</a>
          </div>
          <p class="hint">Free and open source. No install, no account, and your files never leave your computer. Best in Chrome or Edge.
            No files handy? <a routerLink="/osd" [queryParams]="{ sample: 1 }">Try a sample flight</a>.</p>
          <!-- Phones only: the editor wants a computer. -->
          <app-phone-notice class="phone" />
        </div>

        <figure class="reel">
          <!-- The first 15 seconds of a real render, on a loop and silent. A pause button, since it moves for more than 5 s;
               visitors who asked for reduced motion get the still and press play themselves. -->
          <div class="frames">
            <video #clip class="clip" src="home/lovelyosd-demo.mp4" poster="home/lovelyosd-demo.jpg" muted [muted]="true" loop playsinline preload="auto"
                   [autoplay]="playing()" (play)="playing.set(true)" (pause)="playing.set(false)"
                   aria-label="FPV flight over golden hills, with the OSD from the blackbox log: speed, battery, sticks, the mini map and satellites"></video>
            <div class="reel-controls">
              <button type="button" class="pause" (click)="togglePlay()" [attr.aria-label]="playing() ? 'Pause the video' : 'Play the video'">
                @if (playing()) {
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg>
                } @else {
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" fill="currentColor" /></svg>
                }
              </button>
            </div>
          </div>
          <figcaption class="hint">
            A real flight rendered in LovelyOSD Editor: O4 footage with its OSD drawn from the blackbox log.
          </figcaption>
        </figure>
      </section>

      <section aria-labelledby="features-heading">
        <h2 id="features-heading" class="sr-only">What LovelyOSD Editor does</h2>
        <ul class="features">
          <li class="panel">
            <h3><a routerLink="/osd">Finished videos and Shorts</a></h3>
            <p>
              Your footage, a stick cam, the sound, music and the OSD in one ready-to-upload <strong>.mp4</strong>, encoded on your GPU
              at near-lossless quality. Landscape for YouTube, or vertical for Shorts, Reels and TikTok with your FPV view on top and
              the stick cam below, plus a title, your craft name and Betaflight's post-flight stats at the end.
            </p>
          </li>
          <li class="panel">
            <h3><a routerLink="/osd">Edit like Premiere</a></h3>
            <p>
              A timeline with your footage, OSD, sound and music as tracks, locked together once they're synced. Grade the footage
              with Lumetri-style colour, set each sound's gain and fades, and see where it clips. Save the session and pick it up later.
            </p>
          </li>
          <li class="panel">
            <h3><a routerLink="/osd">Your OSD, your way</a></h3>
            <p>
              Speed, battery, sticks, a mini map, RSSI and link quality, and the stats screen, in your goggles' <code>font_bf.bin</code>. Drag, resize and
              recolour everything, or export a transparent <strong>.mov</strong> to lay over your footage in Premiere or After Effects.
            </p>
          </li>
          <li class="panel">
            <h3><a routerLink="/osd">Logs straight off the quad</a></h3>
            <p>
              Plug the flight controller in over USB and the editor puts it in mass storage mode, opens its drive and loads the
              newest log. No Configurator, no copying files (Chrome or Edge).
            </p>
          </li>
        </ul>
      </section>

      <section class="panel steps" aria-labelledby="steps-heading">
        <h2 id="steps-heading">A video in three steps</h2>
        <ol>
          <li><strong>Load a log.</strong> Plug your quad in over USB to grab the newest one, or pick any Betaflight <code>.bbl</code>
            or <code>.bfl</code> file from your flight controller or SD card.</li>
          <li><strong>Make it yours.</strong> Add your footage, a phone or stick cam recording and music, synced to your takeoff from
            the motor sound, the arming beep or a clap. Load your goggles' <code>font_bf.bin</code>, pick 16:9 or a vertical Short,
            grade the footage, and click anything to move it, resize it or change its colours.</li>
          <li><strong>Render.</strong> A finished <code>.mp4</code> ready to upload, or a lossless transparent <code>.mov</code> to put
            above your footage in your editor.</li>
        </ol>
        <div class="steps-actions">
          <a class="btn btn-primary" routerLink="/osd">Open LovelyOSD Editor</a>
          <a routerLink="/guides/add-osd-to-dji-o4-footage">Step-by-step guide: adding your OSD to DJI O4 footage</a>
        </div>
      </section>

      <section class="promises" aria-labelledby="promises-heading">
        <h2 id="promises-heading">Free, private, open source</h2>
        <p class="about-link">How many videos have been made so far? <a routerLink="/about">See the numbers</a>.</p>
        <ul>
          <li><strong>Free, no account.</strong> LovelyOSD Editor works without signing up.</li>
          <li><strong>Nothing kept.</strong> A log you open in the editor is read and forgotten, and every video is rendered in your browser.</li>
          <li><strong>Your files stay yours.</strong> Footage, sound and OSD fonts play from your computer and are never uploaded.</li>
          <li><strong>No tracking cookies.</strong> Visits are counted with a hash that changes daily. No IP addresses are stored.</li>
          <li>
            <strong>Open source.</strong> GPL-3.0, built on Betaflight and Blackbox Explorer.
            <a href="https://github.com/RobWiersma/GitDrone">Code on GitHub</a>
          </li>
        </ul>
      </section>

      <!-- The logbook is for whoever's signed in; visitors get the editor. -->
      @if (auth.signedIn() && latest().length) {
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
    .phone { margin-top: 1rem; }

    /* A real render on a loop. */
    .reel { margin: 0; display: grid; gap: .45rem; }
    .reel figcaption { margin: 0; font-size: .85rem; }
    .frames { position: relative; aspect-ratio: 16 / 9; border-radius: 14px; overflow: hidden; border: 1px solid var(--line);
              background: #0a0f14; box-shadow: var(--shadow); }
    .clip { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
    .reel-controls { position: absolute; left: .6rem; bottom: .6rem; }
    .pause { width: 2rem; height: 2rem; border-radius: 50%; border: 0; background: rgb(8 12 16 / .65); color: #fff; display: grid; place-items: center;
             cursor: pointer; padding: 0; }
    .pause svg { width: .9rem; height: .9rem; }
    .pause:focus-visible { outline: 2px solid #9be564; outline-offset: 2px; border-radius: 999px; }

    .features { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr)); gap: 1rem; }
    .features h3 { margin: 0 0 .4rem; font-size: 1.05rem; }
    .features h3 a { color: inherit; text-decoration: none; }
    .features h3 a:hover { color: var(--accent); }
    .features p { margin: 0; line-height: 1.5; }
    .features li { border-top: 3px solid var(--accent); }

    .steps-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem 1.25rem; }
    .steps ol { margin: 0 0 1rem; padding-left: 1.3rem; display: grid; gap: .5rem; line-height: 1.5; }

    .about-link { margin: -.25rem 0 .75rem; }
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
  readonly auth = inject(AuthService);
  latest = signal<Flight[]>([]);

  private clip = viewChild<ElementRef<HTMLVideoElement>>('clip');
  /** Plays on its own, unless the visitor asked for reduced motion. */
  playing = signal(!matchMedia('(prefers-reduced-motion: reduce)').matches);

  constructor() {
    // Only fetched for someone signed in, the only ones who see them.
    void this.auth.load().then(me => {
      if (me.signedIn) this.flights.feed(0, 3).subscribe({ next: p => this.latest.set(p.flights), error: () => this.latest.set([]) });
    });
  }

  togglePlay() {
    const v = this.clip()?.nativeElement;
    if (!v) return;
    if (v.paused) v.play().catch(() => undefined);
    else v.pause();
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
