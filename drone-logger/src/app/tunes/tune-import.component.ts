import { Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TuneService } from './tune.service';

const MAX_FILE_BYTES = 1024 * 1024;

@Component({
  selector: 'app-tune-import',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page narrow">
      <a [routerLink]="['/aircraft', id()]">Back to aircraft</a>
      <h1>Import tune</h1>
      <p class="hint">In the Betaflight Configurator CLI, run <code>diff all</code>, copy the output, and paste it below. You can also load a saved .txt file.</p>

      <div class="field">
        <label for="label">Label</label>
        <input id="label" [(ngModel)]="label" maxlength="80" placeholder="Less D on pitch" autocomplete="off" />
      </div>

      <div class="field">
        <label for="notes">Notes</label>
        <textarea id="notes" rows="2" [(ngModel)]="notes" placeholder="What changed, and how did it fly?"></textarea>
      </div>

      <div class="field">
        <label for="raw">diff all output</label>
        <textarea id="raw" class="mono" rows="10" [(ngModel)]="rawText" spellcheck="false"></textarea>
        <div>
          <label class="btn">
            Load from file
            <input class="sr-only" type="file" accept=".txt,.cli,text/plain" (change)="onFile($event)" />
          </label>
        </div>
        @if (fileError()) { <p class="error">{{ fileError() }}</p> }
      </div>

      @if (preview(); as p) {
        <div class="panel preview" aria-live="polite">
          @if (p.valid) {
            <p><strong>Betaflight {{ p.firmware }}</strong> on {{ p.board ?? 'unknown board' }}, {{ p.settings }} non-default settings.</p>
            @if (p.identifying) {
              <p class="warn">This dump includes a craft or pilot name. It is removed before saving.</p>
            }
          } @else {
            <p class="error">This doesn't look like <code>diff all</code> output. It should start with a "# Betaflight /" line and contain "set" lines.</p>
          }
        </div>
      }

      @if (notice()) { <p class="warn">{{ notice() }}</p> }
      @if (error()) { <p class="error">{{ error() }}</p> }

      <div class="actions">
        <button class="btn btn-primary" type="button" [disabled]="!canSubmit()" (click)="submit()">
          {{ busy() ? 'Saving...' : 'Save tune' }}
        </button>
        <a class="btn" [routerLink]="['/aircraft', id()]">Cancel</a>
      </div>
    </div>
  `,
  styles: [`
    .mono { font-family: ui-monospace, "Cascadia Code", Menlo, monospace; font-size: .85rem; }
    .preview { margin: 1rem 0; }
    .preview p { margin: 0; }
    .preview p + p { margin-top: .4rem; }
    .warn { color: var(--warn); }
    .actions { display: flex; gap: .75rem; margin-top: 1.25rem; }
  `],
})
export class TuneImportComponent {
  id = input.required<number, unknown>({ transform: numberAttribute });

  private tunes = inject(TuneService);
  private router = inject(Router);

  label = signal('');
  notes = signal('');
  rawText = signal('');
  busy = signal(false);
  error = signal('');
  notice = signal('');
  fileError = signal('');

  /** Quick client-side read of the header so mistakes show up before upload. The API does the real parsing. */
  preview = computed(() => {
    const text = this.rawText();
    if (!text.trim()) return null;
    const header = /^#\s*Betaflight\s*\/\s*(\S+)\s*\(([^)]+)\)\s*(\d+\.\d+\.\d+)/m.exec(text);
    const board = /^#?\s*board_name\s+(\S+)/m.exec(text)?.[1] ?? header?.[2] ?? null;
    const settings = (text.match(/^set\s+\S+\s*=/gm) ?? []).length;
    const identifying = /^set\s+(name|craft_name|pilot_name)\s*=\s*\S+/m.test(text);
    return { firmware: header?.[3] ?? null, board, settings, identifying, valid: !!header && settings > 0 };
  });

  canSubmit = computed(() => !!this.label().trim() && !!this.preview()?.valid && !this.busy());

  async onFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      this.fileError.set('That file is over 1 MB. A diff all dump is normally a few KB.');
      return;
    }
    this.fileError.set('');
    this.rawText.set(await file.text());
  }

  submit() {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    this.tunes.import(this.id(), { label: this.label().trim(), notes: this.notes().trim() || undefined, rawText: this.rawText() })
      .subscribe({
        next: result => {
          if (result.duplicateOf) {
            this.busy.set(false);
            this.notice.set(`This tune is identical to an existing snapshot (#${result.duplicateOf}), so nothing was added.`);
          } else {
            this.router.navigate(['/aircraft', this.id()]);
          }
        },
        error: () => {
          this.busy.set(false);
          this.error.set('Could not save this tune. Check that the API is running and try again.');
        },
      });
  }
}
