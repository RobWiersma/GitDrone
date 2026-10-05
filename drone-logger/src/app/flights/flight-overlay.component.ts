import { Component, ElementRef, afterNextRender, computed, effect, inject, input, numberAttribute, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin, of, catchError, map } from 'rxjs';
import { FlightService } from './flight.service';
import { Flight } from './flight.models';
import { OverlayData, OverlayOptions, OverlayRenderer } from './overlay-renderer';
import { FrameWriter, canWriteFolders, folderWriter, zipWriter } from './frame-writer';
import { StickMode, readStickMode } from './stick-math';
import { clock } from './flight-profile.component';

const RESOLUTIONS = [
  { label: '1080p (1920×1080)', w: 1920, h: 1080 },
  { label: '1440p (2560×1440)', w: 2560, h: 1440 },
  { label: '4K (3840×2160)', w: 3840, h: 2160 },
];
const FPS = [24, 25, 30, 50, 60];

@Component({
  selector: 'app-flight-overlay',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page">
      @if (flight(); as f) {
        <a [routerLink]="['/flights', f.id]">Back to flight</a>
        <h1>Video overlay</h1>
        <p class="hint">
          A transparent PNG sequence of the HUD, to put on a track above your footage in Premiere or After Effects.
          It starts at arming, so line it up with your takeoff.
        </p>

        <div class="layout">
          <section class="panel preview-panel" aria-labelledby="preview-heading">
            <h2 id="preview-heading">Preview</h2>
            <div class="stage" [class.dark]="darkBackdrop()">
              <canvas #preview width="1920" height="1080" role="img"
                      [attr.aria-label]="'Overlay preview at ' + previewClock()"></canvas>
            </div>
            <div class="scrub">
              <label for="previewTime" class="sr-only">Preview time</label>
              <input id="previewTime" type="range" min="0" [max]="seconds()" step="0.1" [ngModel]="previewTime()"
                     (ngModelChange)="previewTime.set(+$event)" />
              <span class="mono">{{ previewClock() }}</span>
              <label class="check"><input type="checkbox" [ngModel]="darkBackdrop()" (ngModelChange)="darkBackdrop.set($event)" /> Dark backdrop</label>
            </div>
          </section>

          <section class="panel options" aria-labelledby="options-heading">
            <h2 id="options-heading">Options</h2>
            <div class="field">
              <label for="res">Resolution</label>
              <select id="res" [ngModel]="resIndex()" (ngModelChange)="resIndex.set(+$event)" [disabled]="busy()">
                @for (r of resolutions; track r.label; let i = $index) { <option [value]="i">{{ r.label }}</option> }
              </select>
            </div>
            <div class="field">
              <label for="fps">Frame rate</label>
              <select id="fps" [ngModel]="fps()" (ngModelChange)="fps.set(+$event)" [disabled]="busy()">
                @for (r of fpsOptions; track r) { <option [value]="r">{{ r }} fps</option> }
              </select>
              <p class="hint">Match your footage.</p>
            </div>
            <fieldset class="field" [disabled]="busy()">
              <legend>Show</legend>
              <label class="check"><input type="checkbox" [ngModel]="opts().showSpeed" (ngModelChange)="set('showSpeed', $event)" [disabled]="!data()?.track" /> Speed, height, distance</label>
              <label class="check"><input type="checkbox" [ngModel]="opts().showBattery" (ngModelChange)="set('showBattery', $event)" [disabled]="!data()?.battery" /> Battery</label>
              <label class="check"><input type="checkbox" [ngModel]="opts().showSticks" (ngModelChange)="set('showSticks', $event)" [disabled]="!data()?.sticks" /> Sticks</label>
              <label class="check"><input type="checkbox" [ngModel]="opts().showMap" (ngModelChange)="set('showMap', $event)" [disabled]="!data()?.track" /> Mini map</label>
              <label class="check"><input type="checkbox" [ngModel]="opts().showTimer" (ngModelChange)="set('showTimer', $event)" /> Flight timer</label>
            </fieldset>
            <div class="field">
              <label for="mode">Stick mode</label>
              <select id="mode" [ngModel]="opts().stickMode" (ngModelChange)="setStickMode(+$event)" [disabled]="busy()">
                @for (m of [1, 2, 3, 4]; track m) { <option [value]="m">Mode {{ m }}</option> }
              </select>
            </div>
            <div class="field">
              <label for="opacity">Panel background: {{ (opts().panelOpacity * 100).toFixed(0) }}%</label>
              <input id="opacity" type="range" min="0" max="0.8" step="0.05" [ngModel]="opts().panelOpacity"
                     (ngModelChange)="set('panelOpacity', +$event)" [disabled]="busy()" />
            </div>
            <div class="range">
              <div class="field">
                <label for="start">Start (s)</label>
                <input id="start" type="number" min="0" [max]="end()" step="0.5" [ngModel]="start()" (ngModelChange)="start.set(clampTime(+$event))" [disabled]="busy()" />
              </div>
              <div class="field">
                <label for="end">End (s)</label>
                <input id="end" type="number" [min]="start()" [max]="seconds()" step="0.5" [ngModel]="end()" (ngModelChange)="end.set(clampTime(+$event))" [disabled]="busy()" />
              </div>
            </div>
            <p class="hint">{{ frameCount() }} frames, {{ clock(end() - start()) }} long, roughly {{ sizeEstimate() }} on disk.</p>
            @if (!folders && estimatedBytes() > 3.5e9) {
              <p class="error">That's too big for a zip download (4 GB limit). Trim it, lower the resolution, or use Chrome or Edge.</p>
            }

            @if (busy()) {
              <div class="progress" role="status" aria-live="polite">
                <progress [value]="done()" [max]="frameCount()"></progress>
                <span class="mono">{{ done() }} / {{ frameCount() }}{{ eta() ? ', about ' + eta() + ' left' : '' }}</span>
              </div>
              <button class="btn" type="button" (click)="cancel()">Cancel</button>
            } @else {
              <button class="btn btn-primary" type="button" (click)="exportFrames(f)" [disabled]="!data() || frameCount() === 0">
                {{ folders ? 'Export to a folder' : 'Export as zip' }}
              </button>
              @if (!folders) {
                <p class="hint">Your browser can't write to folders, so frames download as one zip. Chrome or Edge is faster for long or 4K exports.</p>
              }
            }
            @if (message()) { <p class="note" role="status">{{ message() }}</p> }
            @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
          </section>
        </div>

        <section class="panel howto" aria-labelledby="howto-heading">
          <h2 id="howto-heading">Using it in Premiere Pro</h2>
          <ol>
            <li><strong>File → Import</strong>, open the export folder, select the first frame and tick <strong>Image Sequence</strong>.</li>
            <li>Right-click the clip in the Project panel, choose <strong>Modify → Interpret Footage</strong>, and set the frame rate to <strong>{{ fps() }} fps</strong>.</li>
            <li>Drop it on a track above your footage. The transparency comes through automatically.</li>
            <li>Slide it so the timer starts when the quad arms (usually just before takeoff).</li>
          </ol>
          <p class="hint">After Effects: same import with "PNG Sequence" ticked, then set the frame rate in Interpret Footage → Main.</p>
        </section>
      } @else {
        <p class="hint">Loading flight...</p>
      }
    </div>
  `,
  styles: [`
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 20rem; gap: 1rem; align-items: start; margin: 1rem 0; }
    @media (max-width: 60rem) { .layout { grid-template-columns: 1fr; } }
    .panel h2 { margin-bottom: .75rem; }
    /* Checkerboard shows which parts are transparent. */
    .stage { border-radius: 8px; overflow: hidden; border: 1px solid var(--line);
             background: repeating-conic-gradient(#c9d1d9 0 25%, #eef2f6 0 50%) 0 0 / 24px 24px; }
    .stage.dark { background: linear-gradient(180deg, #4b6a88, #2b3a2b); }
    canvas { display: block; width: 100%; height: auto; }
    .scrub { display: flex; align-items: center; gap: .75rem; margin-top: .6rem; flex-wrap: wrap; }
    .scrub input[type=range] { flex: 1 1 12rem; accent-color: var(--accent); }
    .check { display: flex; align-items: center; justify-content: flex-start; gap: .45rem; font-weight: normal; margin: .2rem 0; }
    /* The site-wide .field input rule makes inputs full width; checkboxes shouldn't be. */
    .check input { width: auto; margin: 0; }
    fieldset { border: 0; padding: 0; margin: 0 0 1rem; }
    legend { font-weight: 600; margin-bottom: .2rem; }
    .range { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
    .progress { display: grid; gap: .3rem; margin: .5rem 0; }
    progress { width: 100%; accent-color: var(--accent); }
    .note { color: var(--ok); margin: .6rem 0 0; }
    .howto ol { margin: 0; padding-left: 1.25rem; display: grid; gap: .35rem; }
    .howto .hint { margin-top: .6rem; }
  `],
})
export class FlightOverlayComponent {
  id = input.required<number, unknown>({ transform: numberAttribute });

  private service = inject(FlightService);
  private canvas = viewChild<ElementRef<HTMLCanvasElement>>('preview');

  readonly resolutions = RESOLUTIONS;
  readonly fpsOptions = FPS;
  readonly folders = canWriteFolders();
  readonly clock = clock;

  flight = signal<Flight | null>(null);
  data = signal<OverlayData | null>(null);
  private renderer = computed(() => (this.data() ? new OverlayRenderer(this.data()!) : null));

  seconds = computed(() => (this.flight()?.durationMs ?? 0) / 1000);
  resIndex = signal(0);
  fps = signal(30);
  start = signal(0);
  end = signal(0);
  opts = signal<OverlayOptions>({
    showSticks: true, showSpeed: true, showBattery: true, showMap: true, showTimer: true,
    stickMode: readStickMode(), panelOpacity: 0.35,
  });

  previewTime = signal(0);
  previewClock = computed(() => clock(this.previewTime()));
  darkBackdrop = signal(true);

  frameCount = computed(() => Math.max(0, Math.floor((this.end() - this.start()) * this.fps())));
  /** Measured about 170 KB per 1080p frame with all elements on; scales with pixel count. */
  estimatedBytes = computed(() => this.frameCount() * 170_000 * (RESOLUTIONS[this.resIndex()].h / 1080) ** 2);
  sizeEstimate = computed(() => {
    const b = this.estimatedBytes();
    return b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`;
  });
  busy = signal(false);
  done = signal(0);
  eta = signal('');
  message = signal('');
  error = signal('');
  private cancelled = false;

  constructor() {
    effect(() => {
      this.service.get(this.id()).subscribe(f => {
        this.flight.set(f);
        this.end.set(f.durationMs / 1000);
        this.previewTime.set(Math.min(60, f.durationMs / 2000));
        const none = <T>() => of(null as T | null);
        forkJoin({
          track: f.hasGps ? this.service.track(f.id).pipe(catchError(() => none<OverlayData['track']>())) : none<OverlayData['track']>(),
          sticks: f.hasSticks ? this.service.sticks(f.id).pipe(map(s => s.points), catchError(() => none<OverlayData['sticks']>())) : none<OverlayData['sticks']>(),
          battery: this.service.battery(f.id).pipe(catchError(() => none<OverlayData['battery']>())),
        }).subscribe(d => this.data.set(d));
      });
    });

    // Redraw the preview whenever anything it shows changes.
    afterNextRender(() => this.drawPreview());
    effect(() => this.drawPreview());
  }

  set<K extends keyof OverlayOptions>(key: K, value: OverlayOptions[K]) {
    this.opts.update(o => ({ ...o, [key]: value }));
  }

  setStickMode(v: number) {
    this.set('stickMode', (v === 1 || v === 3 || v === 4 ? v : 2) as StickMode);
  }

  clampTime(v: number) {
    return Math.min(this.seconds(), Math.max(0, Number.isFinite(v) ? v : 0));
  }

  private drawPreview() {
    const r = this.renderer();
    const c = this.canvas()?.nativeElement;
    const t = this.previewTime();
    const o = this.opts();
    if (!r || !c) return;
    r.draw(c.getContext('2d')!, t, o);
  }

  async exportFrames(f: Flight) {
    const r = this.renderer();
    if (!r) return;
    this.error.set('');
    this.message.set('');

    let writer: FrameWriter;
    try {
      writer = this.folders ? await folderWriter() : zipWriter(`gitdrone-overlay-${f.id}.zip`);
    } catch {
      return; // folder picker cancelled
    }

    const { w, h } = RESOLUTIONS[this.resIndex()];
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const fps = this.fps();
    const total = this.frameCount();
    const digits = String(total).length < 5 ? 5 : String(total).length;
    const opts = this.opts();
    const started = performance.now();

    this.busy.set(true);
    this.done.set(0);
    this.cancelled = false;
    try {
      for (let i = 0; i < total; i++) {
        if (this.cancelled) break;
        r.draw(ctx, this.start() + i / fps, opts);
        const png = await new Promise<Blob>((ok, fail) => canvas.toBlob(b => (b ? ok(b) : fail(new Error('PNG encode failed'))), 'image/png'));
        await writer.write(`overlay_${String(i + 1).padStart(digits, '0')}.png`, png);
        this.done.set(i + 1);
        if (i % 15 === 0 && i > 0) {
          const perFrame = (performance.now() - started) / (i + 1);
          this.eta.set(clock(((total - i - 1) * perFrame) / 1000));
        }
      }
      if (!this.cancelled) {
        await writer.write('README.txt', new Blob([readme(fps, w, h, total, this.start())], { type: 'text/plain' }));
        await writer.close();
        this.message.set(`Exported ${total} frames at ${w}×${h}, ${fps} fps.`);
      } else {
        this.message.set(`Cancelled after ${this.done()} frames.`);
      }
    } catch (e) {
      this.error.set(`Export stopped: ${e instanceof Error ? e.message : 'unknown error'}.`);
    } finally {
      this.busy.set(false);
      this.eta.set('');
    }
  }

  cancel() {
    this.cancelled = true;
  }
}

function readme(fps: number, w: number, h: number, frames: number, start: number) {
  return [
    'GitDrone video overlay',
    `${frames} transparent PNG frames, ${w}x${h}, ${fps} fps.`,
    start > 0 ? `Frame 1 is ${clock(start)} after the quad armed.` : 'Frame 1 is when the quad armed.',
    '',
    'Premiere Pro:',
    '  1. File > Import, select overlay_00001.png, tick "Image Sequence".',
    `  2. Right-click the clip > Modify > Interpret Footage > Assume this frame rate: ${fps}.`,
    '  3. Put it on a track above your footage and slide it so the timer starts at arming.',
    '',
    'After Effects:',
    '  File > Import > File, select the first frame, tick "PNG Sequence",',
    `  then Interpret Footage > Main > Assume this frame rate: ${fps}.`,
    '',
  ].join('\r\n');
}
