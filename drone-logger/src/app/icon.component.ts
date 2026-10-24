import { Component, input } from '@angular/core';

export type IconName =
  | 'play' | 'pause' | 'volume' | 'mute' | 'prev' | 'next' | 'close' | 'reset' | 'sliders' | 'folder' | 'trash'
  | 'mark-in' | 'mark-out' | 'gauge' | 'battery' | 'sticks' | 'map' | 'signal' | 'stats' | 'layers' | 'film' | 'fade' | 'checker' | 'sky' | 'pip' | 'font' | 'landscape' | 'portrait' | 'title' | 'craft';

/**
 * A small outline icon in the app's style (24x24, current text colour). Decorative: the button around it carries the
 * name, as `aria-label` for screen readers and `title` for the hover text.
 */
@Component({
  selector: 'app-icon',
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      @switch (name()) {
        @case ('play') { <path fill="currentColor" stroke="none" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /> }
        @case ('pause') { <rect fill="currentColor" stroke="none" x="6" y="5" width="4" height="14" rx="1" /><rect fill="currentColor" stroke="none" x="14" y="5" width="4" height="14" rx="1" /> }
        @case ('volume') { <path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /> }
        @case ('mute') { <path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M17 9.5l5 5M22 9.5l-5 5" /> }
        @case ('prev') { <path d="M15 6l-6 6 6 6" /> }
        @case ('next') { <path d="M9 6l6 6-6 6" /> }
        @case ('close') { <path d="M6 6l12 12M18 6L6 18" /> }
        @case ('reset') { <path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4h4" /> }
        @case ('sliders') { <path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /> }
        @case ('folder') { <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /> }
        @case ('trash') { <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /> }
        @case ('mark-in') { <path d="M9 4H6v16h3M12 8l4 4-4 4" /> }
        @case ('mark-out') { <path d="M15 4h3v16h-3M12 8l-4 4 4 4" /> }
        @case ('gauge') { <path d="M4 17a8 8 0 1 1 16 0" /><path d="M12 17l4-5" /> }
        @case ('battery') { <rect x="2" y="7" width="17" height="10" rx="2" /><path d="M22 10.5v3M6 10.5v3M10 10.5v3" /> }
        @case ('sticks') { <rect x="2" y="6" width="9" height="12" rx="2" /><rect x="13" y="6" width="9" height="12" rx="2" /><circle fill="currentColor" cx="6.5" cy="13" r="1.2" /><circle fill="currentColor" cx="17.5" cy="10" r="1.2" /> }
        @case ('map') { <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" /> }
        @case ('signal') { <path d="M5 20v-3M10 20v-7M15 20v-11M20 20V4" /> }
        @case ('layers') { <path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /> }
        @case ('film') { <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /> }
        @case ('fade') { <path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 6v3M5.6 9.6l1.8 1.8M18.4 9.6l-1.8 1.8" /> }
        @case ('checker') { <rect x="4" y="4" width="16" height="16" rx="1" /><path fill="currentColor" stroke="none" d="M4 4h8v8H4zM12 12h8v8h-8z" /> }
        @case ('sky') { <path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9.5a4.3 4.3 0 0 1-1 8.5z" /> }
        @case ('pip') { <rect x="3" y="5" width="18" height="14" rx="2" /><rect fill="currentColor" stroke="none" x="12" y="11" width="7" height="6" rx="1" /> }
        @case ('font') { <path d="M5 20l7-16 7 16M8.5 13h7" /> }
        @case ('landscape') { <rect x="2" y="6" width="20" height="12" rx="2" /> }
        @case ('portrait') { <rect x="7" y="2" width="10" height="20" rx="2" /> }
        @case ('title') { <path d="M5 6h14M12 6v13" /> }
        @case ('craft') { <path d="M3 12V4h8l10 10-8 8z" /><circle fill="currentColor" stroke="none" cx="7.5" cy="8.5" r="1.5" /> }
        @case ('stats') { <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /> }
      }
    </svg>
  `,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; }
    svg { width: 1.15em; height: 1.15em; }
  `],
})
export class IconComponent {
  name = input.required<IconName>();
}
