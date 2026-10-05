import { Component, ElementRef, afterNextRender, computed, effect, inject, input, numberAttribute, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin, of, catchError, map } from 'rxjs';
import { FlightService } from './flight.service';
import { Flight } from './flight.models';
import { OverlayData, OverlayOptions, OverlayRenderer } from './overlay-renderer';
import { MovWriter, canSaveToDisk, diskMovWriter, memoryMovWriter } from './mov-writer';
import { GlyphFont, loadSavedFont, parseGlyphFont, saveFont } from './glyph-font';
import { UnitsService } from '../units.service';
import { StickMode, readStickMode } from './stick-math';
import { clock } from './flight-profile.component';

const RESOLUTIONS = [
  { label: '1080p (1920×1080)', w: 1920, h: 1080 },
  { label: '1440p (2560×1440)', w: 2560, h: 1440 },
  { label: '4K (3840×2160)', w: 3840, h: 2160 },
];
const FPS = [24, 25, 30, 50, 60];

const DEFAULT_PATH_COLORS = { pathRecentColor: '#9be564', pathOldColor: '#2c4a1f' };
const DEFAULT_STICK_COLORS = { stickDotColor: '#ff5a5a', stickTrailColor: '#9a9a9a', stickBoxColor: '#1c1c1c', stickCrossColor: '#ffffff' };
const DEFAULT_COLORS = { ...DEFAULT_PATH_COLORS, ...DEFAULT_STICK_COLORS };
type ColorKey = keyof typeof DEFAULT_COLORS;
const COLORS_KEY = 'gitdrone-overlay-path-colors';

/** Overlay colours remembered in this browser; each falls back to its default when missing, invalid or storage is blocked. */
function readColors(): typeof DEFAULT_COLORS {
  const colors = { ...DEFAULT_COLORS };
  try {
    const saved = JSON.parse(localStorage.getItem(COLORS_KEY) ?? 'null');
    for (const key of Object.keys(colors) as ColorKey[]) {
      const v: unknown = saved?.[key];
      if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) colors[key] = v;
    }
  } catch { /* defaults */ }
  return colors;
}

function saveColors(o: typeof DEFAULT_COLORS) {
  const colors = Object.fromEntries((Object.keys(DEFAULT_COLORS) as ColorKey[]).map(k => [k, o[k]]));
  try { localStorage.setItem(COLORS_KEY, JSON.stringify(colors)); } catch { /* not remembered */ }
}

@Component({
  selector: 'app-flight-overlay',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page">
      @if (flight(); as f) {
        <a [routerLink]="['/flights', f.id]">Back to flight</a>
        <h1>Video overlay</h1>
        <p class="hint">
          A transparent QuickTime video of the HUD, to put on a track above your footage in Premiere or After Effects.
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
              <span class="field-label" id="font-label">OSD font</span>
              @if (font(); as fnt) {
                <p class="font-row"><span class="mono">{{ fnt.name }}</span> <span class="hint">{{ fnt.glyphW }}×{{ fnt.glyphH }} glyphs</span>
                  <button class="link" type="button" (click)="clearFont()" [disabled]="busy()">Remove</button></p>
              } @else {
                <p class="hint">Built-in font. Load your goggles' Betaflight font (<code>font_bf.bin</code> is sharpest) for the real OSD look.</p>
              }
              <label class="btn small">
                {{ font() ? 'Change font' : 'Load font file' }}
                <input class="sr-only" type="file" accept=".bin" aria-labelledby="font-label" (change)="onFont($event)" [disabled]="busy()" />
              </label>
              @if (fontError()) { <p class="error">{{ fontError() }}</p> }
            </div>
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
              <label class="check indent"><input type="checkbox" [ngModel]="opts().stickTrails" (ngModelChange)="set('stickTrails', $event)" [disabled]="!data()?.sticks || !opts().showSticks" /> Stick trails (motion blur)</label>
              <div class="colors indent">
                <label class="color"><input type="color" [ngModel]="opts().stickDotColor" (ngModelChange)="setColor('stickDotColor', $event)"
                       [disabled]="!data()?.sticks || !opts().showSticks" /> Dot</label>
                <label class="color"><input type="color" [ngModel]="opts().stickTrailColor" (ngModelChange)="setColor('stickTrailColor', $event)"
                       [disabled]="!data()?.sticks || !opts().showSticks || !opts().stickTrails" /> Trail</label>
                <label class="color"><input type="color" [ngModel]="opts().stickBoxColor" (ngModelChange)="setColor('stickBoxColor', $event)"
                       [disabled]="!data()?.sticks || !opts().showSticks" /> Background</label>
                <label class="color"><input type="color" [ngModel]="opts().stickCrossColor" (ngModelChange)="setColor('stickCrossColor', $event)"
                       [disabled]="!data()?.sticks || !opts().showSticks" /> Crosshair</label>
                <button class="link" type="button" (click)="resetColors(stickColors)" [disabled]="!opts().showSticks">Reset</button>
              </div>
              <label class="check"><input type="checkbox" [ngModel]="opts().showMap" (ngModelChange)="set('showMap', $event)" [disabled]="!data()?.track" /> Mini map</label>
              <div class="colors indent">
                <label class="color"><input type="color" [ngModel]="opts().pathRecentColor" (ngModelChange)="setColor('pathRecentColor', $event)"
                       [disabled]="!data()?.track || !opts().showMap" /> Recent path</label>
                <label class="color"><input type="color" [ngModel]="opts().pathOldColor" (ngModelChange)="setColor('pathOldColor', $event)"
                       [disabled]="!data()?.track || !opts().showMap" /> Older path</label>
                <button class="link" type="button" (click)="resetColors(pathColors)" [disabled]="!opts().showMap">Reset</button>
              </div>
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
            @if (!toDisk && estimatedBytes() > 2e9) {
              <p class="error">That's a lot to hold in memory in this browser. Trim it, lower the resolution, or use Chrome or Edge.</p>
            }

            @if (busy()) {
              <div class="progress" role="status" aria-live="polite">
                <progress [value]="done()" [max]="frameCount()"></progress>
                <span class="mono">{{ done() }} / {{ frameCount() }}{{ eta() ? ', about ' + eta() + ' left' : '' }}</span>
              </div>
              <button class="btn" type="button" (click)="cancel()">Cancel</button>
            } @else {
              <button class="btn btn-primary" type="button" (click)="exportVideo(f)" [disabled]="!data() || frameCount() === 0">
                Export .mov
              </button>
              @if (!toDisk) {
                <p class="hint">This browser builds the file in memory before downloading. Chrome or Edge writes straight to disk, which is better for long or 4K exports.</p>
              }
            }
            @if (message()) { <p class="note" role="status">{{ message() }}</p> }
            @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
          </section>
        </div>

        <section class="panel howto" aria-labelledby="howto-heading">
          <h2 id="howto-heading">Using it in Premiere Pro</h2>
          <ol>
            <li>Import the <strong>.mov</strong> like any clip and drop it on a track above your footage.</li>
            <li>Slide it so the timer starts when the quad arms (usually just before takeoff).</li>
            <li>If the background shows black instead of see-through: right-click the clip, <strong>Modify → Interpret Footage</strong>, and set Alpha Channel to <strong>Straight</strong>.</li>
          </ol>
          <p class="hint">The video is lossless (PNG frames inside a .mov), so it's big. Render it into your final export as usual.</p>
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
    .check.indent { margin-left: 1.6rem; }
    .colors { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem 1rem; margin: .2rem 0 .3rem 1.6rem; font-size: .92rem; }
    .color { display: inline-flex; align-items: center; gap: .4rem; font-weight: normal; }
    /* Colour wells: override the site-wide full-width input rule. */
    .color input { width: 2.2rem; height: 1.6rem; padding: 0; border: 1px solid var(--line); border-radius: 6px; background: none; cursor: pointer; }
    .color input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    fieldset { border: 0; padding: 0; margin: 0 0 1rem; }
    legend { font-weight: 600; margin-bottom: .2rem; }
    .range { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
    .progress { display: grid; gap: .3rem; margin: .5rem 0; }
    progress { width: 100%; accent-color: var(--accent); }
    .note { color: var(--ok); margin: .6rem 0 0; }
    .field-label { font-weight: 600; }
    .font-row { margin: 0; display: flex; gap: .5rem; align-items: baseline; flex-wrap: wrap; }
    .small { padding: .3rem .75rem; font-size: .88rem; justify-self: start; }
    .link { background: none; border: 0; padding: 0; font: inherit; color: var(--accent); text-decoration: underline; cursor: pointer; }
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
  readonly toDisk = canSaveToDisk();
  readonly clock = clock;

  flight = signal<Flight | null>(null);
  data = signal<OverlayData | null>(null);
  font = signal<GlyphFont | null>(null);
  fontError = signal('');
  private renderer = computed(() => (this.data() ? new OverlayRenderer(this.data()!) : null));

  seconds = computed(() => (this.flight()?.durationMs ?? 0) / 1000);
  resIndex = signal(0);
  fps = signal(30);
  start = signal(0);
  end = signal(0);
  opts = signal<OverlayOptions>({
    showSticks: true, stickTrails: true, showSpeed: true, showBattery: true, showMap: true, showTimer: true,
    ...readColors(),
    stickMode: readStickMode(), panelOpacity: 0.35, font: null, speedUnit: 'kmh',
  });
  private units = inject(UnitsService);

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

    loadSavedFont().then(f => this.font.set(f));
    effect(() => { const f = this.font(); this.opts.update(o => ({ ...o, font: f })); });
    effect(() => { const u = this.units.speed(); this.opts.update(o => ({ ...o, speedUnit: u })); });

    // Redraw the preview whenever anything it shows changes.
    afterNextRender(() => this.drawPreview());
    effect(() => this.drawPreview());
  }

  set<K extends keyof OverlayOptions>(key: K, value: OverlayOptions[K]) {
    this.opts.update(o => ({ ...o, [key]: value }));
  }

  async onFont(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.fontError.set('');
    try {
      const buffer = await file.arrayBuffer();
      this.font.set(parseGlyphFont(file.name, buffer));
      await saveFont(file.name, buffer);
    } catch (err) {
      this.fontError.set(err instanceof Error ? err.message : 'Could not read that font file.');
    }
  }

  clearFont() {
    this.font.set(null);
    saveFont('', null);
  }

  protected readonly pathColors = DEFAULT_PATH_COLORS;
  protected readonly stickColors = DEFAULT_STICK_COLORS;

  setColor(key: ColorKey, value: string) {
    this.set(key, value);
    saveColors(this.opts());
  }

  /** Puts one group (mini map or sticks) back to its defaults. */
  resetColors(defaults: Partial<typeof DEFAULT_COLORS>) {
    this.opts.update(o => ({ ...o, ...defaults }));
    saveColors(this.opts());
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

  async exportVideo(f: Flight) {
    const r = this.renderer();
    if (!r) return;
    this.error.set('');
    this.message.set('');

    const { w, h } = RESOLUTIONS[this.resIndex()];
    const fps = this.fps();
    const name = `gitdrone-overlay-${f.id}-${w}x${h}-${fps}fps.mov`;
    let writer: MovWriter;
    try {
      writer = this.toDisk ? await diskMovWriter(name, { width: w, height: h, fps }) : memoryMovWriter(name, { width: w, height: h, fps });
    } catch {
      return; // save dialog cancelled
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const total = this.frameCount();
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
        await writer.addFrame(png);
        this.done.set(i + 1);
        if (i % 15 === 0 && i > 0) {
          const perFrame = (performance.now() - started) / (i + 1);
          this.eta.set(clock(((total - i - 1) * perFrame) / 1000));
        }
      }
      if (this.cancelled) {
        await writer.abort();
        this.message.set(`Cancelled after ${this.done()} frames; no file was written.`);
      } else {
        await writer.close();
        this.message.set(`Exported ${name} (${total} frames).`);
      }
    } catch (e) {
      await writer.abort().catch(() => undefined);
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
