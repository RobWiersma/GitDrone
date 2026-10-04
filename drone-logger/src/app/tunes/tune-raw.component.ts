import { Component, inject, input, signal } from '@angular/core';
import { TuneService } from './tune.service';

/** "Show full tune" toggle. Loads the stored diff all text the first time it is opened. */
@Component({
  selector: 'app-tune-raw',
  template: `
    <button class="link" type="button" [attr.aria-expanded]="open()" [attr.aria-controls]="'raw-' + snapshotId()" (click)="toggle()">
      {{ open() ? 'Hide full tune' : 'Show full tune' }}<span class="sr-only"> ({{ label() }})</span>
    </button>

    @if (open()) {
      <div class="raw" [id]="'raw-' + snapshotId()">
        @if (text(); as t) {
          <div class="tools">
            <button class="btn small" type="button" (click)="copy(t)">Copy</button>
            <span class="hint" aria-live="polite">{{ copied() ? 'Copied to clipboard.' : '' }}</span>
          </div>
          <pre tabindex="0" [attr.aria-label]="'diff all for ' + label()">{{ t }}</pre>
        } @else if (failed()) {
          <p class="error">Couldn't load this tune. Check that the API is running.</p>
        } @else {
          <p class="hint">Loading...</p>
        }
      </div>
    }
  `,
  styles: [`
    /* contents: the button sits inline with sibling links, the opened text takes its own full-width row. */
    :host { display: contents; }
    .link { background: none; border: 0; padding: 0; font: inherit; font-size: .92rem; color: var(--accent);
            text-decoration: underline; cursor: pointer; }
    .link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .raw { flex-basis: 100%; min-width: 0; margin-top: .25rem; }
    .tools { display: flex; align-items: center; gap: .75rem; margin-bottom: .4rem; }
    .tools .hint { margin: 0; }
    .small { padding: .25rem .7rem; font-size: .88rem; }
    pre { margin: 0; max-height: 24rem; overflow: auto; padding: .75rem 1rem; background: var(--wash);
          border: 1px solid var(--line); border-radius: 6px; font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
          font-size: .82rem; line-height: 1.45; white-space: pre; }
    pre:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `],
})
export class TuneRawComponent {
  snapshotId = input.required<number>();
  /** Tune label, so screen readers know which tune the toggle belongs to. */
  label = input.required<string>();

  private tunes = inject(TuneService);
  open = signal(false);
  text = signal<string | null>(null);
  failed = signal(false);
  copied = signal(false);

  toggle() {
    this.open.update(o => !o);
    if (this.open() && this.text() === null) {
      this.failed.set(false);
      this.tunes.raw(this.snapshotId()).subscribe({
        next: t => this.text.set(t),
        error: () => this.failed.set(true),
      });
    }
  }

  async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.copied.set(false);
    }
  }
}
