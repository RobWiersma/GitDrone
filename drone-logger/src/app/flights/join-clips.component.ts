import { Component, computed, input, output, signal } from '@angular/core';
import { rememberHandle } from './file-handles';
import { JoinControl, JoinError, joinClips, joinedName } from './join-clips';
import { canSaveToDisk } from './mov-writer';

/** The most footage joined in memory, where the browser can't write it straight to disk. */
const MEMORY_JOIN_LIMIT = 1.5e9;

type SavePicker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>;

/**
 * Several footage files picked at once: one recording the camera split up (DJI cards do, every 4 GB). Offers to join
 * them into one video, then hands that on as the footage. The join waits for its own button press because Chrome only
 * opens the save dialog straight after a click.
 */
@Component({
  selector: 'app-join-clips',
  template: `
    <div class="join">
      <p class="hint">
        {{ files().length }} files picked: {{ names() }}. If they're one flight the camera split up, join them into one
        video{{ toDisk ? ', saved where you pick' : '' }}. It's as big as the parts together; nothing is re-encoded, so it's quick.
      </p>
      @if (progress() === null) {
        <div class="buttons">
          <button class="btn btn-primary small" type="button" (click)="join()">Join into one video</button>
          <button class="btn small" type="button" (click)="dismissed.emit()">Cancel</button>
        </div>
      } @else {
        <div class="progress" role="status" aria-live="polite">
          <progress [value]="progress()" max="1"></progress>
          <span class="mono">Joining {{ files().length }} clips: {{ percent() }}%</span>
        </div>
        <button class="btn small" type="button" (click)="cancel()">Cancel</button>
      }
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    </div>
  `,
  styles: `
    .join { display: grid; gap: .5rem; margin: .5rem 0; padding: .6rem .75rem; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
    .join .hint { margin: 0; }
    .buttons { display: flex; gap: .5rem; flex-wrap: wrap; }
    .progress { display: grid; gap: .3rem; }
    .progress progress { width: 100%; }
    .join > .btn { justify-self: start; }
  `,
})
export class JoinClipsComponent {
  /** The parts, in recording order. */
  files = input.required<File[]>();
  joined = output<File>();
  dismissed = output<void>();

  readonly toDisk = canSaveToDisk();
  names = computed(() => this.files().map(f => f.name).join(', '));
  /** How far the join has got, 0..1, or null before it starts. */
  progress = signal<number | null>(null);
  percent = computed(() => Math.floor((this.progress() ?? 0) * 100));
  error = signal('');
  private control: JoinControl | null = null;

  async join() {
    const files = this.files(), name = joinedName(files);
    this.error.set('');
    let handle: FileSystemFileHandle | null = null;
    let writable: WritableStream | null = null;
    if (this.toDisk) {
      try {
        handle = await (window as unknown as { showSaveFilePicker: SavePicker }).showSaveFilePicker({
          suggestedName: name, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
        });
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          console.error('[join] save dialog', e);
          this.error.set(`Couldn't open the save dialog: ${e instanceof Error ? e.message : e}`);
        }
        return;
      }
      try {
        writable = await handle.createWritable();
      } catch (e) {
        console.warn('[join] writing to the chosen file was refused', e);
        this.error.set(`This browser wouldn't let LovelyOSD write to the place you picked. Try another folder, such as Videos or Downloads.`);
        return;
      }
    } else {
      const bytes = files.reduce((n, f) => n + f.size, 0);
      if (bytes > MEMORY_JOIN_LIMIT) {
        this.error.set(`These clips are ${(bytes / 1e9).toFixed(1)} GB together, too much to join in memory in this browser. `
          + `Chrome or Edge can join them, writing the joined video straight to disk.`);
        return;
      }
    }
    const control: JoinControl = { cancelled: false };
    this.control = control;
    this.progress.set(0);
    // Don't leave half a video behind.
    const discard = () => (handle as unknown as { remove?: () => Promise<void> } | null)?.remove?.().catch(() => undefined);
    try {
      const blob = await joinClips(files, writable, done => this.progress.set(done), control);
      if (control.cancelled) {
        await discard();
        return;
      }
      const file = handle ? await handle.getFile() : new File([blob!], name, { type: 'video/mp4' });
      // A saved session can open the joined video again, like any footage picked from disk.
      if (handle) rememberHandle(file, handle);
      this.joined.emit(file);
    } catch (e) {
      console.error('[join]', e);
      await discard();
      this.error.set(e instanceof JoinError ? e.message : `Couldn't join the clips: ${e instanceof Error ? e.message : e}`);
    } finally {
      if (this.control === control) this.control = null;
      this.progress.set(null);
    }
  }

  cancel() {
    if (this.control) this.control.cancelled = true;
  }
}
