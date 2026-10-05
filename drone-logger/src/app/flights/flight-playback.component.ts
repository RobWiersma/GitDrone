import { Component, OnDestroy, computed, effect, input, model, signal, untracked } from '@angular/core';
import { StickPoint } from './flight.models';
import { FlightSticksComponent } from './flight-sticks.component';
import { clock } from './flight-profile.component';

const SPEEDS = [0.5, 1, 2, 4];

/** Play/pause, speed and a scrubber for a flight, plus the stick animation. Drives `time` (seconds since log start). */
@Component({
  selector: 'app-flight-playback',
  imports: [FlightSticksComponent],
  template: `
    <div class="controls">
      <button class="play" type="button" (click)="toggle()" [attr.aria-label]="playing() ? 'Pause' : 'Play'">
        @if (playing()) {
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        } @else {
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
        }
      </button>
      <span class="clock">{{ now() }} <span class="of">/ {{ total() }}</span></span>
      <label class="sr-only" for="scrub">Playback position</label>
      <input id="scrub" class="scrub" type="range" min="0" [max]="duration()" step="0.1" [value]="time()"
             [attr.aria-valuetext]="now() + ' of ' + total()" (input)="seek($event)" />
      <div class="speeds" role="group" aria-label="Playback speed">
        @for (s of speeds; track s) {
          <button type="button" [attr.aria-pressed]="speed() === s" (click)="speed.set(s)">{{ s }}×</button>
        }
      </div>
    </div>
    @if (sticks(); as pts) {
      <app-flight-sticks [points]="pts" [time]="time()" />
    }
  `,
  styles: [`
    :host { display: block; }
    .controls { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .play { width: 2.75rem; height: 2.75rem; border-radius: 50%; border: 0; background: var(--accent); color: var(--accent-ink);
            display: grid; place-items: center; cursor: pointer; flex: none; }
    .play svg { width: 1.3rem; height: 1.3rem; fill: currentColor; }
    .play:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
    .clock { font-family: var(--mono); font-variant-numeric: tabular-nums; font-weight: 700; min-width: 7.5em; }
    .of { color: var(--muted); font-weight: 400; }
    .scrub { flex: 1 1 12rem; accent-color: var(--accent); min-width: 8rem; }
    .scrub:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 4px; }
    .speeds { display: flex; gap: .25rem; }
    .speeds button { font: inherit; font-family: var(--mono); font-size: .78rem; font-weight: 600; padding: .2rem .5rem;
                     border-radius: 999px; cursor: pointer; border: 1px solid var(--line); background: transparent; color: var(--muted); }
    .speeds button[aria-pressed="true"] { background: var(--ink); border-color: var(--ink); color: var(--surface); }
    .speeds button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `],
})
export class FlightPlaybackComponent implements OnDestroy {
  /** Flight length, seconds. */
  duration = input.required<number>();
  sticks = input<StickPoint[] | null>(null);
  time = model(0);
  playing = model(false);

  readonly speeds = SPEEDS;
  speed = signal(1);
  now = computed(() => clock(this.time()));
  total = computed(() => clock(this.duration()));

  private frame = 0;
  private last = 0;

  constructor() {
    // Run the clock while playing; requestAnimationFrame pauses on its own when the tab is hidden.
    effect(onCleanup => {
      if (!this.playing()) return;
      this.last = performance.now();
      const tick = (now: number) => {
        const dt = (now - this.last) / 1000;
        this.last = now;
        const next = untracked(this.time) + dt * untracked(this.speed);
        if (next >= this.duration()) {
          this.time.set(this.duration());
          this.playing.set(false);
          return;
        }
        this.time.set(next);
        this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
      onCleanup(() => cancelAnimationFrame(this.frame));
    });
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.frame);
  }

  toggle() {
    if (!this.playing() && this.time() >= this.duration() - 0.05) this.time.set(0); // replay from the start
    this.playing.update(p => !p);
  }

  seek(e: Event) {
    this.time.set(Number((e.target as HTMLInputElement).value));
  }
}
