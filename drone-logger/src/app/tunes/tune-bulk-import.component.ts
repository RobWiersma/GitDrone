import { Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TuneService } from './tune.service';
import { TuneBulkItem, TuneBulkItemResult } from './tune.models';

const MAX_FILES = 500;
const MAX_FILE_BYTES = 1024 * 1024;

interface Row {
  key: number;
  fileName: string;
  path: string;
  text: string;
  date: Date;
  /** True when the date came from the Configurator's file name, false when it's the file's modified time. */
  datedByName: boolean;
  craft: string | null;
  board: string | null;
  firmware: string | null;
  settings: number;
  valid: boolean;
}

/** Configurator backups are named like BTFL_cli_backup_<craft>_20260109_111902_<board>.txt, in local time. */
function dateFromName(name: string): Date | null {
  const m = /_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(date.getTime()) ? null : date;
}

function inspect(text: string) {
  const header = /^#\s*Betaflight\s*\/\s*(\S+)\s*\(([^)]+)\)\s*(\d+\.\d+\.\d+)/m.exec(text);
  const craft = /^#\s*name:\s*(.+)$/m.exec(text)?.[1] ?? /^set\s+craft_name\s*=\s*(.+)$/m.exec(text)?.[1] ?? null;
  const board = /^#?\s*board_name\s+(\S+)/m.exec(text)?.[1] ?? header?.[2] ?? null;
  const settings = (text.match(/^set\s+\S+\s*=/gm) ?? []).length;
  return { firmware: header?.[3] ?? null, craft: craft?.trim() || null, board, settings, valid: !!header && settings > 0 };
}

@Component({
  selector: 'app-tune-bulk-import',
  imports: [DatePipe, RouterLink],
  template: `
    <div class="page">
      <a [routerLink]="['/hangar', id()]">Back to aircraft</a>
      <h1>Bulk import tunes</h1>
      <p class="hint">
        Pick your saved CLI backups (<code>BTFL_cli_backup_*.txt</code>) or a whole folder of them. Each one becomes a
        tune at the date in its file name. Backups identical to the tune just before them are skipped.
      </p>

      <div class="pickers">
        <label class="btn">
          Choose files
          <input class="sr-only" type="file" multiple accept=".txt,text/plain" (change)="onFiles($event)" />
        </label>
        <label class="btn">
          Choose a folder
          <input class="sr-only" type="file" webkitdirectory (change)="onFiles($event)" />
        </label>
        @if (reading()) { <span class="hint">Reading files...</span> }
      </div>
      @if (notice()) { <p class="warn">{{ notice() }}</p> }

      @if (rows().length > 0) {
        <div class="panel">
          <div class="bar">
            <p class="count" aria-live="polite">{{ selectedCount() }} of {{ rows().length }} selected</p>
            <div class="select">
              <span class="hint">Select:</span>
              <button class="btn small" type="button" (click)="selectAllValid()">All readable</button>
              <button class="btn small" type="button" (click)="selectNone()">None</button>
              @for (c of crafts(); track c.name) {
                <button class="btn small" type="button" (click)="selectCraft(c.name)">
                  Only {{ c.name ?? '(no name)' }} ({{ c.count }})
                </button>
              }
            </div>
          </div>

          <div class="scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col"><span class="sr-only">Import</span></th>
                  <th scope="col">Date</th>
                  <th scope="col">Craft name</th>
                  <th scope="col">Board</th>
                  <th scope="col">Firmware</th>
                  <th scope="col">Settings</th>
                  <th scope="col">File</th>
                  @if (results()) { <th scope="col">Result</th> }
                </tr>
              </thead>
              <tbody>
                @for (r of rows(); track r.key) {
                  <tr [class.invalid]="!r.valid">
                    <td>
                      <input type="checkbox" [id]="'row-' + r.key" [checked]="selected().has(r.key)" [disabled]="!r.valid || busy()"
                             (change)="toggle(r.key)" />
                      <label class="sr-only" [for]="'row-' + r.key">Import {{ r.fileName }}</label>
                    </td>
                    <td>
                      {{ r.date | date: 'd MMM y, HH:mm' }}
                      @if (!r.datedByName) { <span class="hint" title="No date in the file name, using the file's modified time">*</span> }
                    </td>
                    <td>{{ r.craft ?? '—' }}</td>
                    <td>{{ r.board ?? '—' }}</td>
                    <td>{{ r.firmware ?? '—' }}</td>
                    <td>{{ r.valid ? r.settings : '' }}</td>
                    <td class="file" [title]="r.path">
                      {{ r.fileName }}
                      @if (!r.valid) { <span class="error"> Not a Betaflight diff all</span> }
                    </td>
                    @if (results(); as res) {
                      <td>
                        @switch (res.get(r.key)?.status) {
                          @case ('created') { <span class="ok">Added</span> }
                          @case ('duplicate') { <span class="hint">Skipped, same as previous</span> }
                          @case ('error') { <span class="error">{{ res.get(r.key)?.error }}</span> }
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (anyUndated()) {
            <p class="hint">* No date in the file name, so the file's modified time is used.</p>
          }
        </div>

        @if (summary(); as s) {
          <p class="panel result" role="status">
            Added {{ s.created }} {{ s.created === 1 ? 'tune' : 'tunes' }}, skipped {{ s.duplicate }} duplicate{{ s.duplicate === 1 ? '' : 's' }}@if (s.error) {, {{ s.error }} failed}.
          </p>
        }
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

        <div class="actions">
          @if (summary()) {
            <a class="btn btn-primary" [routerLink]="['/hangar', id()]">View tune history</a>
          } @else {
            <button class="btn btn-primary" type="button" [disabled]="selectedCount() === 0 || busy()" (click)="submit()">
              {{ busy() ? 'Importing...' : 'Import ' + selectedCount() + ' ' + (selectedCount() === 1 ? 'tune' : 'tunes') }}
            </button>
          }
          <a class="btn" [routerLink]="['/hangar', id()]">Cancel</a>
        </div>
      }
    </div>
  `,
  styles: [`
    h1 { margin-bottom: .25rem; }
    .pickers { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; margin: 1.25rem 0; }
    .warn { color: var(--warn); }
    .count { margin: 0; font-weight: 600; }
    .select { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; }
    .small { padding: .25rem .65rem; font-size: .85rem; }
    .scroll { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: .92rem; }
    th, td { text-align: left; padding: .35rem .55rem; border-bottom: 1px solid var(--line); white-space: nowrap; }
    thead th { font-size: .82rem; color: var(--muted); font-weight: 600; }
    tr.invalid td { color: var(--muted); }
    .file { max-width: 22rem; overflow: hidden; text-overflow: ellipsis; }
    .ok { color: var(--ok); font-weight: 600; }
    .result { margin: 1rem 0 0; }
    .actions { display: flex; gap: .75rem; margin-top: 1.25rem; }
    input[type=checkbox] { width: 1.1rem; height: 1.1rem; }
    input[type=checkbox]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `],
})
export class TuneBulkImportComponent {
  id = input.required<number, unknown>({ transform: numberAttribute });

  private tunes = inject(TuneService);

  rows = signal<Row[]>([]);
  selected = signal<Set<number>>(new Set());
  reading = signal(false);
  busy = signal(false);
  notice = signal('');
  error = signal('');
  results = signal<Map<number, TuneBulkItemResult> | null>(null);

  selectedCount = computed(() => this.selected().size);
  anyUndated = computed(() => this.rows().some(r => !r.datedByName));

  /** Distinct craft names among readable backups, for the "Only X" buttons. */
  crafts = computed(() => {
    const counts = new Map<string | null, number>();
    for (const r of this.rows()) if (r.valid) counts.set(r.craft, (counts.get(r.craft) ?? 0) + 1);
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  });

  summary = computed(() => {
    const res = this.results();
    if (!res) return null;
    const all = [...res.values()];
    return {
      created: all.filter(r => r.status === 'created').length,
      duplicate: all.filter(r => r.status === 'duplicate').length,
      error: all.filter(r => r.status === 'error').length,
    };
  });

  async onFiles(event: Event) {
    const input = event.target as HTMLInputElement;
    const picked = [...(input.files ?? [])].filter(f => /\.txt$/i.test(f.name));
    input.value = '';
    if (picked.length === 0) {
      this.notice.set('No .txt files found in that selection.');
      return;
    }

    this.reading.set(true);
    this.results.set(null);
    this.error.set('');
    const skipped = picked.length > MAX_FILES ? picked.length - MAX_FILES : 0;
    const files = picked.slice(0, MAX_FILES);
    const tooBig = files.filter(f => f.size > MAX_FILE_BYTES).length;

    const rows: Row[] = await Promise.all(files.filter(f => f.size <= MAX_FILE_BYTES).map(async (file, key) => {
      const text = await file.text();
      const fromName = dateFromName(file.name);
      return {
        key, text, fileName: file.name, path: file.webkitRelativePath || file.name,
        date: fromName ?? new Date(file.lastModified), datedByName: !!fromName, ...inspect(text),
      };
    }));
    rows.sort((a, b) => a.date.getTime() - b.date.getTime());

    this.rows.set(rows);
    this.selected.set(new Set(rows.filter(r => r.valid).map(r => r.key)));
    this.reading.set(false);

    const notes = [];
    if (skipped) notes.push(`Only the first ${MAX_FILES} files are shown.`);
    if (tooBig) notes.push(`${tooBig} file${tooBig === 1 ? ' was' : 's were'} over 1 MB and left out.`);
    if (this.crafts().length > 1) notes.push('These backups come from more than one craft. Pick the ones that belong to this aircraft.');
    this.notice.set(notes.join(' '));
  }

  toggle(key: number) {
    this.selected.update(s => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  selectAllValid() {
    this.selected.set(new Set(this.rows().filter(r => r.valid).map(r => r.key)));
  }

  selectNone() {
    this.selected.set(new Set());
  }

  selectCraft(craft: string | null) {
    this.selected.set(new Set(this.rows().filter(r => r.valid && r.craft === craft).map(r => r.key)));
  }

  submit() {
    const chosen = this.rows().filter(r => this.selected().has(r.key));
    const format = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const items: TuneBulkItem[] = chosen.map(r => ({
      label: `Backup ${format.format(r.date)}`,
      notes: 'Imported from a CLI backup file.',
      rawText: r.text,
      createdAt: r.date.toISOString(),
    }));

    this.busy.set(true);
    this.error.set('');
    this.tunes.bulkImport(this.id(), items).subscribe({
      next: results => {
        this.busy.set(false);
        this.results.set(new Map(results.map(res => [chosen[res.index].key, res])));
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Could not import these tunes. Check that the API is running and try again.');
      },
    });
  }
}
