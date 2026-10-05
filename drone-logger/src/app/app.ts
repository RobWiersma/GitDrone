import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ThemeService } from './theme.service';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  readonly theme = inject(ThemeService);
  readonly themeLabel = computed(() => ({ system: 'System', dark: 'Dark', light: 'Light' })[this.theme.preference()]);
}
