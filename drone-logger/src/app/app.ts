import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { ThemeService } from './theme.service';
import { AuthService } from './auth.service';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  readonly theme = inject(ThemeService);
  readonly auth = inject(AuthService);
  readonly themeLabel = computed(() => ({ system: 'System', dark: 'Dark', light: 'Light' })[this.theme.preference()]);

  private url = toSignal(inject(Router).events.pipe(
    filter(e => e instanceof NavigationEnd),
    map(e => e.urlAfterRedirects),
  ), { initialValue: '/' });
  /** Sign in, then come back to whatever page you were on. */
  readonly signInHref = computed(() => this.auth.signInUrl(this.url()));
}
