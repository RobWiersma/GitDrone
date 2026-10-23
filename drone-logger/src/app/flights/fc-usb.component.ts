import { Component, afterNextRender, input, output, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FcUsbError, drivePickerSupported, readDriveLogs, rebootToMassStorage, serialSupported } from './fc-usb';

type Stage = 'idle' | 'rebooting' | 'rebooted' | 'reading';

/**
 * Gets logs straight off a flight controller plugged in over USB: reboots it into mass storage mode, then reads the
 * drive it becomes and hands over the newest log. Any other log on the drive is one click away.
 */
@Component({
  selector: 'app-fc-usb',
  imports: [DatePipe, DecimalPipe],
  template: `
    @if (serialOk() || driveOk()) {
      <div class="fc-usb">
        <div class="row">
          @if (serialOk()) {
            <button class="btn" type="button" (click)="connect()" [disabled]="disabled() || stage() !== 'idle' && stage() !== 'rebooted'">
              {{ stage() === 'rebooting' ? 'Connecting...' : 'Connect FC over USB' }}
            </button>
          }
          @if (driveOk()) {
            <button class="btn" type="button" [class.btn-primary]="stage() === 'rebooted'" (click)="openDrive()"
                    [disabled]="disabled() || stage() === 'rebooting' || stage() === 'reading'">
              {{ stage() === 'reading' ? 'Reading drive...' : 'Open FC drive' }}
            </button>
          }
        </div>

        <p class="hint" role="status">
          @switch (stage()) {
            @case ('rebooting') { Rebooting the flight controller into mass storage mode... }
            @case ('rebooted') {
              The flight controller is now a USB drive. Give it a few seconds to show up (it may be called
              <code>BETAFLIGHT</code> or <code>NO NAME</code>), then open it.
            }
            @default {
              @if (serialOk()) { Plug the flight controller in (no battery needed), connect, then open its drive. }
              @else { Already in mass storage mode? Open its drive. Connecting to the FC needs Chrome or Edge. }
            }
          }
        </p>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

        @if (files().length) {
          <fieldset class="logs">
            <legend>Logs on {{ drive() }}</legend>
            @for (f of files(); track f.name; let first = $first) {
              <button class="log" type="button" [class.current]="f === chosen()" [attr.aria-pressed]="f === chosen()"
                      [disabled]="disabled()" (click)="choose(f)">
                <span class="name">{{ f.name }}@if (first) { <span class="tag">Latest</span> }</span>
                <span class="meta">{{ f.size / 1024 / 1024 | number: '1.1-1' }} MB, {{ f.lastModified | date: 'd MMM y, HH:mm' }}</span>
              </button>
            }
          </fieldset>
          <p class="hint">When you're done, eject the drive and unplug the FC to put it back to normal.</p>
        }
      </div>
    }
  `,
  styles: [`
    .fc-usb { display: grid; gap: .5rem; }
    .row { display: flex; flex-wrap: wrap; gap: .5rem; }
    p { margin: 0; }
    .logs { border: 1px solid var(--line); border-radius: 8px; padding: .5rem; margin: 0; display: grid; gap: .25rem; }
    .logs legend { padding: 0 .25rem; font-size: .9rem; }
    .log { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .25rem 1rem; text-align: left; padding: .4rem .6rem;
           border: 1px solid transparent; border-radius: 6px; background: none; color: inherit; font: inherit; cursor: pointer; }
    .log:hover { background: var(--raised); }
    .log:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    .log.current { border-color: var(--accent); }
    .log[disabled] { opacity: .5; cursor: not-allowed; }
    .meta { color: var(--muted); font-size: .9rem; }
    .tag { margin-left: .5rem; padding: 0 .4rem; border-radius: 4px; background: var(--accent); color: var(--accent-ink); font-size: .8rem; }
  `],
})
export class FcUsbComponent {
  disabled = input(false);
  picked = output<File>();

  // Both APIs live only in the browser, so they're checked after the first render rather than on the server.
  serialOk = signal(false);
  driveOk = signal(false);

  stage = signal<Stage>('idle');
  error = signal('');
  drive = signal('');
  files = signal<File[]>([]);
  chosen = signal<File | null>(null);

  constructor() {
    afterNextRender(() => {
      this.serialOk.set(serialSupported());
      this.driveOk.set(drivePickerSupported());
    });
  }

  async connect() {
    this.error.set('');
    this.stage.set('rebooting');
    try {
      await rebootToMassStorage();
      this.stage.set('rebooted');
    } catch (e) {
      this.stage.set('idle');
      this.error.set(e instanceof FcUsbError ? e.message : 'Could not talk to the flight controller. Unplug it, plug it back in and try again.');
    }
  }

  async openDrive() {
    const before = this.stage() === 'rebooted' ? 'rebooted' : 'idle';
    this.error.set('');
    this.stage.set('reading');
    try {
      const found = await readDriveLogs();
      if (!found) { this.stage.set(before); return; }
      const { drive, files } = found;
      this.stage.set('idle');
      this.drive.set(drive);
      this.files.set(files);
      if (!files.length) {
        this.error.set(`No .bbl or .bfl logs on ${drive}. Is that the flight controller's drive?`);
        return;
      }
      this.choose(files[0]);
    } catch {
      this.stage.set(before);
      this.error.set('Could not read that drive. Try opening it again.');
    }
  }

  choose(file: File) {
    this.chosen.set(file);
    this.picked.emit(file);
  }
}
