import { Component, input } from '@angular/core';

/** Shows the uploaded photo, or a quad outline when there isn't one. */
@Component({
  selector: 'app-aircraft-image',
  template: `
    @if (src()) {
      <img [src]="src()" [alt]="alt()" />
    } @else {
      <svg viewBox="0 0 120 90" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
           role="img" [attr.aria-label]="'No photo yet for ' + alt()">
        <path d="M38 28 82 62M82 28 38 62" />
        <circle cx="32" cy="23" r="12" /><circle cx="88" cy="23" r="12" />
        <circle cx="32" cy="67" r="12" /><circle cx="88" cy="67" r="12" />
        <rect x="52" y="38" width="16" height="14" rx="3" />
      </svg>
    }
  `,
  styles: [`
    :host { display: block; aspect-ratio: 4 / 3; background: var(--wash); overflow: hidden; }
    img { width: 100%; height: 100%; object-fit: cover; display: block; }
    svg { width: 100%; height: 100%; padding: 12%; color: var(--muted); }
  `],
})
export class AircraftImageComponent {
  src = input<string | null | undefined>(null);
  alt = input.required<string>();
}
