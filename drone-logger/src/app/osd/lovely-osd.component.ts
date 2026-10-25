import { Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { FlightService } from '../flights/flight.service';
import { OsdAnalysis, OsdSession, formatDuration } from '../flights/flight.models';
import { OverlayData } from '../flights/overlay-renderer';
import { FlightViewComponent } from '../flights/flight-view.component';
import { EditorState, OverlayExportComponent } from '../flights/overlay-export.component';
import { BlackboxTipsComponent } from '../flights/blackbox-tips.component';
import { FcUsbComponent } from '../flights/fc-usb.component';
import { KeepFileDirective, canKeepFiles } from '../flights/file-handles';
import { SavedSession, deleteSession, listSessions, putSession, reopen, savedFile } from '../flights/session-store';
import { IconComponent } from '../icon.component';
import { PhoneNoticeComponent } from '../phone-notice.component';
import { VisitService } from '../stats/visit.service';

const MAX_FILE_BYTES = 64 * 1024 * 1024;

type FileKind = 'log' | 'footage' | 'sound' | 'music';
type Files = Record<FileKind, File | null>;

/** A saved session being opened: the files found so far, and the ones it still needs picked or allowed. */
interface Opening {
  session: SavedSession<EditorState>;
  files: Files;
  missing: FileKind[];
}

/**
 * LovelyOSD Editor: a blackbox log's OSD on your footage, as a finished video or an overlay, without saving anything to the server. The server
 * decodes the file in memory and forgets it; the results live on this page, and a saved session (this browser only)
 * brings the whole setup back.
 */
@Component({
  selector: 'app-lovely-osd',
  imports: [DatePipe, FormsModule, FlightViewComponent, OverlayExportComponent, BlackboxTipsComponent, FcUsbComponent, KeepFileDirective, IconComponent, PhoneNoticeComponent, RouterLink],
  template: `
    <div class="page">
      <h1>LovelyOSD Editor</h1>
      <p class="hint">
        Load a Betaflight blackbox log (<code>.bbl</code> / <code>.bfl</code>) and your footage, and make a finished video with
        your OSD on it, or a transparent OSD overlay for your own editor. It all runs in your browser: no install, no account,
        and your files aren't uploaded. Save a session to come back to a video later; it's kept in this browser only.
        New here? Read the <a routerLink="/guides/add-osd-to-dji-o4-footage">step-by-step guide</a>.
      </p>

        <!-- Phones only: the editor wants a computer. -->
        <app-phone-notice class="phone" />

        <div class="panel pick">
          <!-- Saved sessions, newest first: open one to pick up where you left off. -->
          @if (sessions().length && !opening()) {
            <div class="recent">
              <h2 class="recent-title">Recent sessions</h2>
              <ul class="recent-list">
                @for (s of sessions(); track s.id) {
                  <li [class.current]="s.id === sessionId()">
                    <div class="recent-text">
                      <strong>{{ s.name }}</strong>
                      <span class="hint">Saved {{ s.savedAt | date: 'd MMM, HH:mm' }} · {{ fileList(s) }}</span>
                    </div>
                    <button class="btn small" type="button" (click)="openSession(s)" [disabled]="busy() || exporting()"
                            [title]="'Open ' + s.name + ': its log, files, sync and settings'">Open</button>
                    <button class="btn small" type="button" (click)="removeSession(s)" [attr.aria-label]="'Delete ' + s.name"
                            title="Delete this saved session (your files aren't touched)"><app-icon name="trash" /></button>
                  </li>
                }
              </ul>
            </div>
          }

          <!-- Opening a session whose files need an OK to be read again, or have to be picked. -->
          @if (opening(); as o) {
            <div class="callout reopen" role="group" aria-labelledby="reopen-title">
              <p id="reopen-title">
                <strong>Opening {{ o.session.name }}.</strong>
                @if (canAllow(o)) { Allow these to be read again (or find them, if they've moved): }
                @else if (keepsFiles) { Pick these files again: }
                @else { Pick these files again; this browser can't reopen them by itself: }
              </p>
              @for (k of o.missing; track k) {
                <div class="reopen-file">
                  <span>{{ kindLabel[k] }}: <span class="mono">{{ o.session[k]!.name }}</span></span>
                  @if (o.session[k]!.handle) {
                    <button class="btn small btn-primary" type="button" (click)="allow(k)">Allow</button>
                  }
                  <label class="btn small">Find it
                    <input class="sr-only" type="file" appKeepFile [accept]="acceptFor[k]" (change)="found(k, $event)" [attr.aria-label]="'Find ' + o.session[k]!.name" />
                  </label>
                </div>
              }
              <div class="reopen-actions">
                <button class="btn small btn-primary" type="button" (click)="continueOpen()" [disabled]="!o.files.log"
                        [title]="o.files.log ? 'Open it with the files found so far' : 'The log is needed to open it'">
                  {{ o.missing.length ? 'Open without the rest' : 'Open' }}</button>
                <button class="link" type="button" (click)="opening.set(null)">Cancel</button>
              </div>
            </div>
          }

          <app-fc-usb [disabled]="busy() || exporting()" (picked)="fromUsb($event)" />
          <div class="field">
            <label for="osd-file">Log file</label>
            <input id="osd-file" type="file" appKeepFile accept=".bbl,.bfl,.bbs,.txt" (change)="onFile($event)" [disabled]="busy() || exporting()" />
          </div>
          @if (busy()) { <p class="hint" role="status">Reading {{ fileName() }}...</p> }
          <div class="field footage">
            <label for="osd-video">Flight footage (optional)</label>
            <input id="osd-video" type="file" appKeepFile accept="video/*" (change)="onVideo($event)" [disabled]="exporting()" />
            <p class="hint">
              @if (video(); as v) { {{ v.name }} plays behind the overlay preview. }
              @else { Plays behind the overlay preview so you can line it up. }
              It stays on this computer.
            </p>
          </div>
          <div class="field footage">
            <label for="osd-sound">Sound track (optional)</label>
            <input id="osd-sound" type="file" appKeepFile accept="audio/*,video/*" (change)="onSound($event)" [disabled]="exporting()" />
            <p class="hint">
              @if (sound(); as s) { {{ s.name }} plays with the preview, lined up on the arming it hears. }
              @else { A phone recording or stick cam video of the flight (only its sound is used). It's lined up on the motors arming, or on a clap. }
            </p>
          </div>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

          @if (result(); as r) {
            @if (r.sessions.length > 1) {
              <div class="field">
                <label for="osd-session">Session ({{ r.sessions.length }} in this file)</label>
                <select id="osd-session" [ngModel]="index()" (ngModelChange)="index.set(+$event)" [disabled]="exporting()">
                  @for (s of r.sessions; track s.flight.logIndex; let i = $index) {
                    <option [value]="i">{{ sessionLabel(s, i) }}</option>
                  }
                </select>
              </div>
            }
          }
        </div>

        <!-- Open until a log is loaded, then folded away to one line. -->
        <app-blackbox-tips [open]="!result()" />

        @if (session(); as s) {
          <h2 class="session-title">
            @if (s.flight.startedAt) { Flight on {{ s.flight.startedAt | date: 'd MMM y, HH:mm' }} }
            @else { Session {{ s.flight.logIndex + 1 }} of {{ s.flight.originalFileName }} }
          </h2>

          <section aria-labelledby="osd-export-heading">
            <h2 id="osd-export-heading">Video overlay</h2>
            <p class="hint">It starts at arming. Play it over your own video to check the layout and line it up with your takeoff.</p>
            <!-- Save the whole setup (log, files, sync, look) to come back to; once saved, it keeps itself up to date. -->
            <div class="session-bar">
              <label for="session-name">Session</label>
              <input id="session-name" type="text" [ngModel]="sessionName()" (ngModelChange)="sessionName.set($event)" [placeholder]="defaultName()" />
              @if (sessionId()) {
                <span class="hint" role="status">{{ saveStatus() }}{{ saveStatus() ? ' · ' : '' }}saves as you go</span>
              } @else {
                <button class="btn small btn-primary" type="button" (click)="saveSession()"
                        title="Save this session in this browser: the log and files it uses, the sync, the lock, the render range and every setting">Save session</button>
              }
            </div>
            <app-overlay-export [data]="overlayData()!" [seconds]="s.flight.durationMs / 1000" [fileStem]="fileStem()" [(video)]="video" [(sound)]="sound" />
          </section>

          <section aria-labelledby="osd-stats-heading">
            <h2 id="osd-stats-heading">Flight stats</h2>
            <app-flight-view [flight]="s.flight" [track]="s.track" [sticks]="s.sticks?.points ?? null" [battery]="s.battery?.points ?? null"
                             [telemetry]="s.telemetry?.points ?? null" />
          </section>
        }
    </div>
  `,
  styles: [`
    .phone { margin-top: 1rem; }
    .pick { margin: 1rem 0; display: grid; gap: .25rem; }
    .pick .field { margin: 0; }
    .pick app-fc-usb { display: block; margin-bottom: .5rem; }
    .pick .footage { margin-top: .75rem; }
    .pick p { margin: 0; }
    .session-title { margin: 1.5rem 0 .75rem; }
    section h2 { margin: 1.5rem 0 .25rem; }
    #osd-stats-heading { margin-top: 2.5rem; margin-bottom: .75rem; }
    section .hint { margin: 0; }
    .small { padding: .3rem .75rem; font-size: .88rem; }
    .link { background: none; border: 0; padding: 0; font: inherit; color: var(--accent); text-decoration: underline; cursor: pointer; }
    .mono { font-family: var(--mono, monospace); }
    .recent { margin-bottom: 1rem; padding-bottom: .75rem; border-bottom: 1px solid var(--line); }
    .recent-title { font-size: 1rem; margin: 0 0 .5rem; }
    .recent-list { list-style: none; margin: 0; padding: 0; display: grid; gap: .4rem; }
    .recent-list li { display: flex; align-items: center; gap: .5rem; padding: .4rem .6rem; border: 1px solid var(--line); border-radius: 8px; }
    .recent-list li.current { border-color: var(--accent); }
    .recent-text { flex: 1; min-width: 0; display: grid; }
    .recent-text .hint { margin: 0; font-size: .82rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .reopen { display: grid; gap: .5rem; margin-bottom: 1rem; padding: .9rem 1rem; border-radius: 8px; }
    .reopen-file, .reopen-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
    .session-bar { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .75rem; margin: .75rem 0 0; }
    .session-bar label { font-weight: 600; }
    .session-bar input { font: inherit; padding: .35rem .55rem; border: 1px solid var(--line); border-radius: 6px; background: var(--surface);
                         color: var(--ink); min-width: min(24rem, 100%); }
  `],
})
export class LovelyOsdComponent {
  private service = inject(FlightService);
  private usage = inject(VisitService);
  private exporter = viewChild(OverlayExportComponent);

  fileName = signal('');
  busy = signal(false);
  error = signal('');
  result = signal<OsdAnalysis | null>(null);
  index = signal(0);
  /** The log file loaded, for a saved session to point at. */
  private logFile = signal<File | null>(null);
  /** Footage for the preview, shared with the exporter so picking it in either place works. */
  video = signal<File | null>(null);
  sound = signal<File | null>(null);

  session = computed(() => this.result()?.sessions[this.index()] ?? null);
  /** Switching sessions or files mid-export would pull the data out from under it. */
  exporting = computed(() => this.exporter()?.busy() ?? false);

  overlayData = computed<OverlayData | null>(() => {
    const s = this.session();
    return s ? { track: s.track, sticks: s.sticks?.points ?? null, battery: s.battery, telemetry: s.telemetry?.points ?? null } : null;
  });

  /** "lovelyosd-btfl_012-s2": the log's name, safe for any file system. */
  fileStem = computed(() => {
    const r = this.result();
    const base = (r?.fileName ?? 'log').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 60) || 'log';
    const s = this.session();
    return `lovelyosd-${base}${r && r.sessions.length > 1 && s ? `-s${s.flight.logIndex + 1}` : ''}`;
  });

  onFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!this.loadNew(file)) input.value = '';
  }

  /** A log read straight off the flight controller over USB. */
  fromUsb(file: File) {
    this.usage.event('log-from-usb');
    this.loadNew(file);
  }

  /** A log picked by hand starts a new, unsaved session. */
  loadNew(file: File) {
    this.sessionId.set(null);
    this.sessionName.set('');
    return this.load(file);
  }

  /** Reads a log from the file input, the flight controller or a saved session; false if it's too big to try. */
  load(file: File, then?: () => void) {
    this.error.set('');
    if (file.size > MAX_FILE_BYTES) {
      this.error.set('That file is over 64 MB.');
      return false;
    }
    this.fileName.set(file.name);
    this.busy.set(true);
    this.service.analyze(file).subscribe({
      next: r => {
        this.busy.set(false);
        this.index.set(0);
        this.result.set(r);
        this.logFile.set(file);
        this.usage.event('log-loaded');
        then?.();
      },
      error: (e: HttpErrorResponse) => {
        this.busy.set(false);
        const problem = e.error?.errors as Record<string, string[]> | undefined;
        this.error.set(problem ? Object.values(problem).flat().join(' ')
          : e.status === 503 ? 'LovelyOSD is busy reading other logs right now. Try again in a minute.'
          : 'Could not read this log. Check that the API is running and try again.');
      },
    });
    return true;
  }

  onVideo(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.video.set(file);
  }

  onSound(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.sound.set(file);
  }

  sessionLabel(s: OsdSession, i: number) {
    const when = s.flight.startedAt ? new Date(s.flight.startedAt).toLocaleString() : `Session ${i + 1}`;
    return `${when}, ${formatDuration(s.flight.durationMs)}${s.flight.hasGps ? ', GPS' : ''}`;
  }

  // ---- saved sessions (this browser only) ----
  readonly keepsFiles = canKeepFiles();
  readonly kindLabel: Record<FileKind, string> = { log: 'Log', footage: 'Footage', sound: 'Sound track', music: 'Music' };
  readonly acceptFor: Record<FileKind, string> = { log: '.bbl,.bfl,.bbs,.txt', footage: 'video/*', sound: 'audio/*,video/*', music: 'audio/*' };
  sessions = signal<SavedSession<EditorState>[]>([]);
  /** The saved session this page is working in; once set, every change is saved to it. */
  sessionId = signal<string | null>(null);
  sessionName = signal('');
  saveStatus = signal('');
  opening = signal<Opening | null>(null);
  /** A session whose log has loaded, waiting for the editor to take back its files and state. */
  private pendingApply = signal<{ session: SavedSession<EditorState> } & Omit<Files, 'log'> | null>(null);
  private saveTimer = 0;

  constructor() {
    void this.refreshSessions();
  }

  private async refreshSessions() {
    this.sessions.set(await listSessions<EditorState>());
  }

  /** "btfl_018.bbl · 21 Oct, 13:07": the log and when it was flown. */
  defaultName() {
    const s = this.session(), when = s?.flight.startedAt ? new Date(s.flight.startedAt) : new Date();
    const date = when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const time = when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return `${this.result()?.fileName ?? 'Session'} · ${date}, ${time}`;
  }

  /** Some of the files still needed can be read again with an OK, rather than picked. */
  canAllow(o: Opening) {
    return o.missing.some(k => !!o.session[k]?.handle);
  }

  fileList(s: SavedSession<EditorState>) {
    return [s.log, s.footage, s.sound, s.music].filter(f => !!f).map(f => f!.name).join(', ');
  }

  saveSession() {
    this.usage.event('session-saved');
    if (!this.sessionName()) this.sessionName.set(this.defaultName());
    this.sessionId.set(crypto.randomUUID());
    void this.writeSession();
  }

  private async writeSession() {
    const id = this.sessionId(), ex = this.exporter(), log = this.logFile();
    // Not while a session is still being opened: its state isn't all back yet.
    if (!id || !ex || !log || ex.restoring()) return;
    const ok = await putSession<EditorState>({
      id, name: this.sessionName() || this.defaultName(), savedAt: Date.now(), log: savedFile(log)!, logIndex: this.index(),
      footage: savedFile(ex.video()), sound: savedFile(ex.sound()), music: savedFile(ex.music()), editor: ex.sessionState(),
    });
    const time = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    this.saveStatus.set(ok ? `Saved ${time}` : `Couldn't save: this browser is blocking storage`);
    void this.refreshSessions();
  }

  /** Once saved, any change saves again a moment after the last one. */
  private autosave = effect(() => {
    const id = this.sessionId(), ex = this.exporter();
    if (!id || !ex || ex.restoring()) return;
    ex.sessionState(); ex.video(); ex.sound(); ex.music(); this.sessionName(); this.index(); this.logFile();
    untracked(() => {
      clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => void this.writeSession(), 1500);
    });
  });

  /**
   * Opens a saved session from its click: reads each file again through its handle (asking for permission where the
   * browser wants it), and lists any it couldn't get to be allowed or picked.
   */
  async openSession(s: SavedSession<EditorState>) {
    this.error.set('');
    const files: Files = { log: await reopen(s.log), footage: await reopen(s.footage), sound: await reopen(s.sound), music: await reopen(s.music) };
    const missing = (['log', 'footage', 'sound', 'music'] as const).filter(k => s[k] && !files[k]);
    this.opening.set({ session: s, files, missing });
    if (!missing.length) this.continueOpen();
  }

  /** A second try at a file's permission, from its own click (a browser may only ask once per click). */
  async allow(kind: FileKind) {
    const o = this.opening();
    const file = o ? await reopen(o.session[kind]) : null;
    if (file) this.foundFile(kind, file);
  }

  found(kind: FileKind, event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.foundFile(kind, file);
  }

  private foundFile(kind: FileKind, file: File) {
    this.opening.update(o => o && { ...o, files: { ...o.files, [kind]: file }, missing: o.missing.filter(m => m !== kind) });
    if (!this.opening()?.missing.length) this.continueOpen();
  }

  /** Loads the session's log, then hands its files and state to the editor. */
  continueOpen() {
    const o = this.opening(), log = o?.files.log;
    if (!o || !log) return;
    this.opening.set(null);
    const { session, files } = o;
    this.sessionId.set(null); // saving resumes once it's all back
    this.usage.event('session-opened');
    this.sessionName.set(session.name);
    this.load(log, () => {
      this.index.set(Math.max(0, Math.min(session.logIndex, (this.result()?.sessions.length ?? 1) - 1)));
      if (files.footage) this.video.set(files.footage);
      if (files.sound) this.sound.set(files.sound);
      this.pendingApply.set({ session, footage: files.footage, sound: files.sound, music: files.music });
    });
  }

  private applyPending = effect(() => {
    const ex = this.exporter(), p = this.pendingApply();
    if (!ex || !p) return;
    untracked(() => {
      this.pendingApply.set(null);
      if (p.music) ex.loadMusic(p.music);
      ex.restore(p.session.editor, { footage: p.footage, sound: p.sound, music: p.music });
      this.sessionId.set(p.session.id);
    });
  });

  async removeSession(s: SavedSession<EditorState>) {
    await deleteSession(s.id);
    if (this.sessionId() === s.id) this.sessionId.set(null);
    void this.refreshSessions();
  }
}
