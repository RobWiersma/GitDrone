import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { ThemePreference, ThemeService } from './theme.service';
import { AuthService } from './auth.service';
import { UnitsService } from './units.service';
import { VisitService } from './stats/visit.service';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  selector: 'app-root',
  host: {
    '(document:click)': 'closeOnOutsideClick($event)',
    '(document:keydown.escape)': 'closeMenu(true)',
  },
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  readonly theme = inject(ThemeService);
  readonly auth = inject(AuthService);
  readonly units = inject(UnitsService);
  readonly themeLabel = computed(() => ({ system: 'System', dark: 'Dark', light: 'Light' })[this.theme.preference()]);

  private url = toSignal(inject(Router).events.pipe(
    filter(e => e instanceof NavigationEnd),
    map(e => e.urlAfterRedirects),
  ), { initialValue: '/' });
  /** Sign in, then come back to whatever page you were on. */
  readonly signInHref = computed(() => this.auth.signInUrl(this.url()));

  readonly themes: { value: ThemePreference; label: string }[] = [
    { value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' },
  ];

  /** Which nav dropdown is open. */
  readonly open = signal<'prefs' | 'account' | null>(null);

  constructor() {
    const router = inject(Router);
    inject(VisitService).trackPageViews(router);
    router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => this.open.set(null));
  }

  toggleMenu(which: 'prefs' | 'account') {
    this.open.update(o => (o === which ? null : which));
  }

  /** Escape closes the open menu and puts focus back on its button, so keyboard users don't get lost. */
  closeMenu(refocus = false) {
    const which = this.open();
    if (!which) return;
    this.open.set(null);
    if (refocus) document.getElementById(`${which}-btn`)?.focus();
  }

  closeOnOutsideClick(e: Event) {
    if (this.open() && !(e.target as Element | null)?.closest('.menu')) this.closeMenu();
  }
}
