import { Injectable, computed, effect, signal } from '@angular/core';
import { SpeedUnit, speedFromMs } from './flights/flight.models';

const STORAGE_KEY = 'gitdrone-speed-unit';

function readStored(): SpeedUnit {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'mph' ? 'mph' : 'kmh';
  } catch {
    return 'kmh'; // private mode or blocked storage
  }
}

/** km/h or mph for every speed in the app and the video overlay. Remembered per browser. */
@Injectable({ providedIn: 'root' })
export class UnitsService {
  readonly speed = signal<SpeedUnit>(readStored());
  readonly speedLabel = computed(() => (this.speed() === 'mph' ? 'mph' : 'km/h'));

  constructor() {
    effect(() => {
      const unit = this.speed();
      try { localStorage.setItem(STORAGE_KEY, unit); } catch { /* not persisted, still applied */ }
    });
  }

  toggle() {
    this.speed.update(u => (u === 'kmh' ? 'mph' : 'kmh'));
  }

  /** m/s in the chosen unit. */
  fromMs(ms: number) {
    return speedFromMs(ms, this.speed());
  }
}
