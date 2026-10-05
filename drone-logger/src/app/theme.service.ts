import { Injectable, computed, effect, signal } from '@angular/core';

export type ThemePreference = 'system' | 'dark' | 'light';

const STORAGE_KEY = 'gitdrone-theme';

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : 'system';
  } catch {
    return 'system'; // private mode or blocked storage
  }
}

/**
 * Light/dark theme. "system" follows the OS; dark/light force a theme through <html data-theme>.
 * index.html applies the stored choice before Angular starts, so there's no flash of the wrong theme.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly preference = signal<ThemePreference>(readStored());

  private media = matchMedia('(prefers-color-scheme: dark)');
  private systemDark = signal(this.media.matches);

  /** What's on screen right now. Canvas-drawn things (maps) read this to pick colours. */
  readonly dark = computed(() => this.preference() === 'dark' || (this.preference() === 'system' && this.systemDark()));

  constructor() {
    this.media.addEventListener('change', e => this.systemDark.set(e.matches));
    effect(() => {
      const pref = this.preference();
      const root = document.documentElement;
      if (pref === 'system') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', pref);
      try {
        if (pref === 'system') localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, pref);
      } catch { /* not persisted, still applied */ }
    });
  }

  /** System -> Dark -> Light -> System. */
  cycle() {
    const order: ThemePreference[] = ['system', 'dark', 'light'];
    this.preference.update(p => order[(order.indexOf(p) + 1) % order.length]);
  }
}
