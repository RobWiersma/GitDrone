import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, linkedSignal, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ELEMENT_ITEMS, ELEMENT_LABELS, ElementKey, ElementPlacement, ITEM_SCALE_MAX, ITEM_SCALE_MIN, ItemKey, OverlayData, OverlayLayout,
  OverlayOptions, OverlayRenderer, STATS_GAP_S } from './overlay-renderer';
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

const TRAIL_KEY = 'gitdrone-overlay-trail-intensity';

function readTrailIntensity(): number {
  try {
    const v = Number(localStorage.getItem(TRAIL_KEY));
    if (v >= 0.25 && v <= 2) return v;
  } catch { /* default */ }
  return 1;
}

const LAYOUT_KEY = 'gitdrone-overlay-layout';
const SCALE_MIN = 0.5, SCALE_MAX = 2;
/** The preview canvas is always drawn at 1080p; placements are fractions, so this is only for pointer maths. */
const PREVIEW_W = 1920, PREVIEW_H = 1080;

/** Moved/resized elements remembered in this browser. Anything malformed is dropped, so that element goes back to default. */
function readLayout(): OverlayLayout {
  const layout: OverlayLayout = {};
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null');
    for (const key of Object.keys(ELEMENT_LABELS) as ElementKey[]) {
      const v = saved?.[key];
      const ok = (n: unknown, lo: number, hi: number) => typeof n === 'number' && n >= lo && n <= hi;
      if (v && ok(v.x, 0, 1) && ok(v.y, 0, 1) && ok(v.scale, SCALE_MIN, SCALE_MAX)) layout[key] = { x: v.x, y: v.y, scale: v.scale };
    }
  } catch { /* defaults */ }
  return layout;
}

function saveLayout(layout: OverlayLayout) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* not remembered */ }
}

const ITEMS_KEY = 'gitdrone-overlay-item-sizes';
type ItemScales = Partial<Record<ItemKey, number>>;

/** Text sizes inside panels, remembered in this browser. Unknown keys and out-of-range values are dropped. */
function readItemScales(): ItemScales {
  const out: ItemScales = {};
  try {
    const saved = JSON.parse(localStorage.getItem(ITEMS_KEY) ?? 'null');
    for (const item of Object.values(ELEMENT_ITEMS).flat()) {
      const v = saved?.[item.key];
      if (typeof v === 'number' && v >= ITEM_SCALE_MIN && v <= ITEM_SCALE_MAX) out[item.key] = v;
    }
  } catch { /* defaults */ }
  return out;
}

function saveItemScales(scales: ItemScales) {
  try { localStorage.setItem(ITEMS_KEY, JSON.stringify(scales)); } catch { /* not remembered */ }
}

type Backdrop = 'checker' | 'sky' | 'video';
const BACKDROP_KEY = 'gitdrone-overlay-backdrop';

function readBackdrop(): Backdrop {
  try {
    const v = localStorage.getItem(BACKDROP_KEY);
    if (v === 'checker' || v === 'sky') return v;
  } catch { /* default */ }
  return 'sky';
}

/** "0:02.10": minutes, seconds and hundredths, rounded once so 2.0999 reads 2.10, not 2.09. */
function preciseClock(seconds: number) {
  const cs = Math.round(Math.max(0, seconds) * 100);
  return `${clock(Math.floor(cs / 100))}.${(cs % 100).toString().padStart(2, '0')}`;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function saveColors(o: typeof DEFAULT_COLORS) {
  const colors = Object.fromEntries((Object.keys(DEFAULT_COLORS) as ColorKey[]).map(k => [k, o[k]]));
  try { localStorage.setItem(COLORS_KEY, JSON.stringify(colors)); } catch { /* not remembered */ }
}

@Component({
  selector: 'app-overlay-export',
  host: {
    '(document:fullscreenchange)': 'onFullscreenChange()',
    '(document:keydown)': 'onFullscreenKey($event)',
  },
  imports: [FormsModule],
  template: `
        <div class="layout">
          <section class="panel preview-panel" aria-labelledby="preview-heading">
            <h2 id="preview-heading">Preview</h2>
            <div #stage class="stage" [class.dark]="backdrop() === 'sky'">
              <button class="fullscreen-btn" type="button" (click)="toggleFullscreen()"
                      [attr.aria-label]="fullscreen() ? 'Exit full screen' : 'Full screen preview'" [title]="fullscreen() ? 'Exit full screen (Esc)' : 'Full screen'">
                @if (fullscreen()) {
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
                } @else {
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
                }
              </button>
              @if (fullscreen() && backdrop() === 'video' && videoUrl()) {
                <p class="fs-hint" aria-live="polite">Space to {{ videoPlaying() ? 'pause' : 'play' }} · Esc to exit</p>
              }
              <div class="frame">
              @if (backdrop() === 'video' && videoUrl()) {
                <video #bgVideo class="bg-video" [src]="videoUrl()" [muted]="muted()" playsinline preload="auto" aria-hidden="true"
                       (loadedmetadata)="onVideoMeta(); seekVideoToPreview()" (durationchange)="onVideoMeta()"
                       (timeupdate)="onVideoTime()" (seeked)="onVideoTime()"
                       (pause)="videoPlaying.set(false)" (play)="videoPlaying.set(true)"></video>
              }
              <canvas #preview [class.before-log]="backdrop() === 'video' && beforeLog()" width="1920" height="1080" role="img"
                      [attr.aria-label]="'Overlay preview at ' + previewClock() + '. Drag an element to move it; the layout controls below do the same from the keyboard.'"
                      [style.cursor]="dragging() ? 'grabbing' : hoverKey() ? 'grab' : 'default'"
                      (pointerdown)="onPointerDown($event)" (pointermove)="onPointerMove($event)"
                      (pointerup)="onPointerUp()" (pointercancel)="onPointerUp()" (pointerleave)="hoverKey.set(null)"></canvas>
              </div>
            </div>
            @if (backdrop() === 'video' && videoUrl()) {
              <!-- Moves only the video, to find the takeoff frame; the overlay stays put until "Takeoff is here". -->
              <div class="video-scrub">
                <label for="videoTime" class="scrub-label">Flight footage</label>
                <button class="btn small step" type="button" (click)="stepVideo(-1)" aria-label="Back one frame">◀</button>
                <input id="videoTime" type="range" min="0" [max]="videoDuration()" step="0.01" [ngModel]="videoTime()"
                       (ngModelChange)="scrubVideo(+$event)" [disabled]="!videoDuration()" />
                <button class="btn small step" type="button" (click)="stepVideo(1)" aria-label="Forward one frame">▶</button>
                <span class="mono">{{ videoClock() }}</span>
              </div>
            }
            <div class="scrub">
              <label for="previewTime" class="scrub-label">OSD overlay</label>
              <button class="btn small step" type="button" (click)="stepOverlay(-1)" aria-label="Overlay back one frame">◀</button>
              <input id="previewTime" type="range" min="0" [max]="previewMax()" step="0.01" [ngModel]="previewTime()"
                     (ngModelChange)="onScrub(+$event)" />
              <button class="btn small step" type="button" (click)="stepOverlay(1)" aria-label="Overlay forward one frame">▶</button>
              <span class="mono">{{ previewClock() }}</span>
            </div>
            <div class="backdrop">
              <label for="backdrop">Preview backdrop</label>
              <select id="backdrop" [ngModel]="backdrop()" (ngModelChange)="setBackdrop($event)">
                <option value="checker">Checkerboard (shows transparency)</option>
                <option value="sky">Sky</option>
                <option value="video" [disabled]="!videoUrl()">Your video (plays with the overlay)</option>
              </select>
              <label class="btn small">
                {{ videoUrl() ? 'Change video' : 'Play it over your video' }}
                <input class="sr-only" type="file" accept="video/*" (change)="onVideoFile($event)" />
              </label>
            </div>
            @if (backdropError()) { <p class="error">{{ backdropError() }}</p> }
            @if (backdrop() === 'video' && videoUrl()) {
              <div class="video-sync">
                <!-- Sync buttons on top, kept together on one line. -->
                <div class="sync-buttons">
                  @if (takeoffTime() !== null) {
                    <button class="btn btn-primary small" type="button" (click)="takeoffHere()">Takeoff is here</button>
                  }
                  <button class="btn small" type="button" (click)="logStartsHere()">Arming is here</button>
                </div>
                <!-- Playback and the start time underneath. -->
                <div class="playback-row">
                  <button class="btn small" type="button" (click)="toggleVideo()">{{ videoPlaying() ? 'Pause' : 'Play' }}</button>
                  <button class="btn small" type="button" (click)="muted.set(!muted())" [attr.aria-pressed]="!muted()">{{ muted() ? 'Sound off' : 'Sound on' }}</button>
                  <div class="offset">
                    <label for="video-offset">Log starts at</label>
                    <input id="video-offset" type="number" step="0.1" [ngModel]="videoOffset()" (ngModelChange)="setOffset(+$event)" />
                    <span>s in the video</span>
                  </div>
                </div>
              </div>
            }
            <!-- All the how-to text for the preview in one callout, under its controls. -->
            <div class="callout preview-help">
              @if (backdrop() === 'video' && videoUrl()) {
                @if (videoOffset() < 0) { <p>A negative start means you armed before the video started.</p> }
                <p>
                  @if (takeoffTime() !== null) {
                    To line them up: use the <strong>Flight footage</strong> slider (and ◀ ▶ for single frames) to find the moment you leave
                    the ground, then press <strong>Takeoff is here</strong>
                    (the log has takeoff at {{ takeoffClock() }}, the first throttle punch{{ takeoffFromGps() ? ' or move on GPS' : '' }}).
                    Or pause on arming and press <strong>Arming is here</strong>.
                  } @else {
                    To line them up: pause the video on the moment you arm, then press <strong>Arming is here</strong>.
                  }
                  The overlay is hidden before the log starts, like in your editor. {{ videoName() }} plays from this computer and isn't uploaded.
                </p>
              }
              <p>The backdrop is only for the preview: the exported video stays transparent.</p>
            </div>

            <fieldset class="layout-edit" [disabled]="busy()">
              <legend>Layout</legend>
              <p class="hint">Drag an element on the preview to move it, or pick one here. Positions are the element's centre.</p>
              @if (current(); as c) {
                <div class="layout-grid">
                  <div class="field">
                    <label for="el">Element</label>
                    <select id="el" [ngModel]="c.key" (ngModelChange)="selected.set($event)">
                      @for (p of placed(); track p.key) { <option [value]="p.key">{{ labels[p.key] }}</option> }
                    </select>
                  </div>
                  <div class="field">
                    <label for="el-size">Size: {{ (c.scale * 100).toFixed(0) }}%</label>
                    <input id="el-size" type="range" [min]="scaleMin" [max]="scaleMax" step="0.05" [ngModel]="c.scale"
                           (ngModelChange)="updatePlacement('scale', +$event)" />
                  </div>
                  <div class="field">
                    <label for="el-x">Across: {{ (c.x * 100).toFixed(0) }}%</label>
                    <input id="el-x" type="range" min="0" max="1" step="0.005" [ngModel]="c.x" (ngModelChange)="updatePlacement('x', +$event)" />
                  </div>
                  <div class="field">
                    <label for="el-y">Down: {{ (c.y * 100).toFixed(0) }}%</label>
                    <input id="el-y" type="range" min="0" max="1" step="0.005" [ngModel]="c.y" (ngModelChange)="updatePlacement('y', +$event)" />
                  </div>
                </div>
                @if (items[c.key]; as list) {
                  <fieldset class="item-sizes">
                    <legend>Text sizes in the {{ labels[c.key].toLowerCase() }}</legend>
                    <div class="layout-grid">
                      @for (it of list; track it.key) {
                        <div class="field">
                          <label [for]="'item-' + it.key">{{ it.label }}: {{ (itemScale(it.key) * 100).toFixed(0) }}%</label>
                          <input [id]="'item-' + it.key" type="range" [min]="itemMin" [max]="itemMax" step="0.05"
                                 [ngModel]="itemScale(it.key)" (ngModelChange)="setItemScale(it.key, +$event)" />
                        </div>
                      }
                    </div>
                  </fieldset>
                }
                @if (c.key === 'sticks') {
                  <fieldset class="item-sizes">
                    <legend>Stick settings</legend>
                    <div class="layout-grid">
                      <div class="field">
                        <label for="mode">Stick mode</label>
                        <select id="mode" [ngModel]="opts().stickMode" (ngModelChange)="setStickMode(+$event)">
                          @for (m of [1, 2, 3, 4]; track m) { <option [value]="m">Mode {{ m }}</option> }
                        </select>
                      </div>
                      <div class="field">
                        <label class="check"><input type="checkbox" [ngModel]="opts().stickTrails" (ngModelChange)="set('stickTrails', $event)" /> Stick trails (motion blur)</label>
                        <label for="trail-intensity">Trail intensity: {{ (opts().stickTrailIntensity * 100).toFixed(0) }}%</label>
                        <input id="trail-intensity" type="range" min="0.25" max="2" step="0.05" [ngModel]="opts().stickTrailIntensity"
                               (ngModelChange)="setTrailIntensity(+$event)" [disabled]="!opts().stickTrails" />
                      </div>
                    </div>
                  </fieldset>
                  <fieldset class="item-sizes">
                    <legend>Stick colours</legend>
                    <div class="colors">
                      <label class="color"><input type="color" [ngModel]="opts().stickDotColor" (ngModelChange)="setColor('stickDotColor', $event)" /> Dot</label>
                      <label class="color"><input type="color" [ngModel]="opts().stickTrailColor" (ngModelChange)="setColor('stickTrailColor', $event)"
                             [disabled]="!opts().stickTrails" /> Trail</label>
                      <label class="color"><input type="color" [ngModel]="opts().stickBoxColor" (ngModelChange)="setColor('stickBoxColor', $event)" /> Background</label>
                      <label class="color"><input type="color" [ngModel]="opts().stickCrossColor" (ngModelChange)="setColor('stickCrossColor', $event)" /> Crosshair</label>
                      <button class="link" type="button" (click)="resetColors(stickColors)">Reset colours</button>
                    </div>
                  </fieldset>
                }
                @if (c.key === 'rssi' && hasBaro() && data().track) {
                  <fieldset class="item-sizes">
                    <legend>RSSI panel settings</legend>
                    <div class="layout-grid">
                      <div class="field">
                        <label for="alt-source">Height from</label>
                        <select id="alt-source" [ngModel]="opts().altSource" (ngModelChange)="set('altSource', $event)">
                          <option value="gps">GPS (matches the flight stats)</option>
                          <option value="baro">Barometer (smoother)</option>
                        </select>
                      </div>
                    </div>
                  </fieldset>
                }
                @if (c.key === 'map') {
                  <fieldset class="item-sizes">
                    <legend>Mini map colours</legend>
                    <div class="colors">
                      <label class="color"><input type="color" [ngModel]="opts().pathRecentColor" (ngModelChange)="setColor('pathRecentColor', $event)" /> Recent path</label>
                      <label class="color"><input type="color" [ngModel]="opts().pathOldColor" (ngModelChange)="setColor('pathOldColor', $event)" /> Older path</label>
                      <button class="link" type="button" (click)="resetColors(pathColors)">Reset colours</button>
                    </div>
                  </fieldset>
                }
                <div class="layout-actions">
                  <button class="link" type="button" (click)="resetElement(c.key)" [disabled]="!isCustom(c.key)">Reset {{ labels[c.key] }}</button>
                  <button class="link" type="button" (click)="resetLayout()" [disabled]="!hasCustomLayout()">Reset whole layout</button>
                </div>
              } @else {
                <p class="hint">Turn on an element under Show to place it.</p>
              }
            </fieldset>
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
              <label class="check"><input type="checkbox" [ngModel]="opts().showSpeed" (ngModelChange)="set('showSpeed', $event)" [disabled]="!data().track" /> Speed, height, distance</label>
              <label class="check"><input type="checkbox" [ngModel]="opts().showBattery" (ngModelChange)="set('showBattery', $event)" [disabled]="!data().battery" /> Battery</label>
              <label class="check"><input type="checkbox" [ngModel]="opts().showSticks" (ngModelChange)="set('showSticks', $event)" [disabled]="!data().sticks" /> Sticks</label>
              <label class="check"><input type="checkbox" [ngModel]="opts().showMap" (ngModelChange)="set('showMap', $event)" [disabled]="!data().track" /> Mini map</label>
              <label class="check"><input type="checkbox" [ngModel]="opts().showTimer" (ngModelChange)="set('showTimer', $event)" [disabled]="!data().battery" /> Flight time (in the battery panel)</label>
              <label class="check"><input type="checkbox" [ngModel]="opts().showStats" (ngModelChange)="set('showStats', $event)" /> End-of-flight stats</label>
              <div class="stats-time">
                <label for="stats-seconds">Show stats for</label>
                <input id="stats-seconds" type="number" min="0.5" max="30" step="0.5" [ngModel]="statsSeconds()"
                       (ngModelChange)="setStatsSeconds(+$event)" [disabled]="!opts().showStats" />
                <span>s</span>
              </div>
              @if (opts().showStats) {
                <p class="callout stats-hint">After the log ends: a {{ gapMs }} ms blank, then the stats. Drag the preview past the end to see them.</p>
              }
              <label class="check"><input type="checkbox" [ngModel]="opts().showRssi" (ngModelChange)="set('showRssi', $event)" [disabled]="!hasRssi() && !data().track" /> RSSI panel (satellites, RSSI, distance, height)</label>
            </fieldset>
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
            <p class="hint">{{ frameCount() }} frames, {{ clock(exportSeconds()) }} long{{ opts().showStats ? ' with the stats' : '' }}, roughly {{ sizeEstimate() }} on disk.</p>
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
              <button class="btn btn-primary" type="button" (click)="exportVideo()" [disabled]="frameCount() === 0">
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

        <section class="panel howto callout" aria-labelledby="howto-heading">
          <h2 id="howto-heading">Using it in Premiere Pro</h2>
          <ol>
            <li>Import the <strong>.mov</strong> like any clip and drop it on a track above your footage.</li>
            @if (placeAt(); as at) {
              <li>Start the overlay clip at <strong>{{ at }}</strong> in {{ videoName() }}: that's where your sync in the preview puts it.</li>
            } @else if (placeTrimmed(); as cut) {
              <li>Your footage starts after arming, so start the clip at the very beginning of {{ videoName() }} and trim the first
                <strong>{{ cut }}</strong> off the overlay (or set <strong>Start</strong> to that before exporting).</li>
            } @else {
              <li>Slide it until it lines up with your takeoff. Easier: play it over your video above and press <strong>Takeoff is here</strong>,
                and this step tells you exactly where it goes.</li>
            }
            <li>If the background shows black instead of see-through: right-click the clip, <strong>Modify → Interpret Footage</strong>, and set Alpha Channel to <strong>Straight</strong>.</li>
          </ol>
          <p class="hint">The video is lossless (PNG frames inside a .mov), so it's big. Render it into your final export as usual.</p>
        </section>
  `,
  styles: [`
    /* Wider than the site's usual page so the preview can be big; never narrower than its container. */
    :host { display: block; width: max(100%, min(96rem, calc(100vw - 4rem))); margin-inline: calc((100% - max(100%, min(96rem, calc(100vw - 4rem)))) / 2); }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 20rem; gap: 1rem; align-items: start; margin: 1rem 0; }
    @media (max-width: 60rem) { .layout { grid-template-columns: 1fr; } }
    .panel h2 { margin-bottom: .75rem; }
    /* Checkerboard shows which parts are transparent. */
    .stage { border-radius: 8px; overflow: hidden; border: 1px solid var(--line);
             background: repeating-conic-gradient(#c9d1d9 0 25%, #eef2f6 0 50%) 0 0 / 24px 24px; }
    .stage.dark { background: linear-gradient(180deg, #4b6a88, #2b3a2b); }
    .backdrop { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .75rem; margin-top: .6rem; font-size: .92rem; }
    .backdrop label[for] { font-weight: 600; }
    .backdrop select { width: auto; }
    .preview-help { margin: .75rem 0 0; font-size: .88rem; line-height: 1.5; display: grid; gap: .5rem; }
    .preview-help p { margin: 0; }
    .stage { position: relative; }
    /* Video and overlay share one 16:9 frame, so they stay lined up at any size, full screen included. */
    .frame { position: relative; aspect-ratio: 16 / 9; }
    .frame canvas { position: relative; z-index: 1; }
    .bg-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: #000; }
    .fullscreen-btn { position: absolute; top: .5rem; right: .5rem; z-index: 3; width: 2.1rem; height: 2.1rem; display: grid; place-items: center;
                      border: 0; border-radius: 8px; background: rgb(8 12 16 / .6); color: #fff; cursor: pointer; padding: 0; opacity: .75; }
    .fullscreen-btn:hover, .fullscreen-btn:focus-visible { opacity: 1; }
    .fullscreen-btn:focus-visible { outline: 2px solid #9be564; outline-offset: 2px; }
    .fullscreen-btn svg { width: 1.1rem; height: 1.1rem; }
    .stage:fullscreen { display: grid; place-items: center; background: #000; border: 0; border-radius: 0; }
    .stage:fullscreen .frame { width: min(100vw, calc(100vh * 16 / 9)); }
    .fs-hint { position: absolute; bottom: 1rem; left: 50%; transform: translateX(-50%); z-index: 3; margin: 0; padding: .35rem .8rem;
               border-radius: 999px; background: rgb(8 12 16 / .6); color: #fff; font-size: .85rem; pointer-events: none; }
    canvas.before-log { visibility: hidden; }
    /* Both sliders' labels share a width so the two bars line up. */
    .scrub-label { font-weight: 600; font-size: .92rem; flex: 0 0 7.5rem; }
    .video-sync { display: grid; gap: .5rem; margin-top: .6rem; font-size: .92rem; justify-items: start; }
    .playback-row { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .6rem; }
    .video-sync .offset { display: flex; align-items: center; gap: .4rem; flex-wrap: wrap; }
    .video-sync .offset label { font-weight: 600; }
    .video-sync .offset input { width: 5.5rem; }
    .sync-buttons { display: flex; flex-wrap: nowrap; gap: .5rem; white-space: nowrap; }
    canvas { display: block; width: 100%; height: auto; }
    /* The footage and overlay sliders share one look so they read as a pair. */
    .scrub, .video-scrub { display: flex; align-items: center; gap: .5rem; margin-top: .6rem; font-size: .92rem; }
    .scrub input[type=range], .video-scrub input[type=range] { flex: 1 1 10rem; min-width: 0; accent-color: var(--accent); }
    .scrub .step, .video-scrub .step { padding: .2rem .55rem; line-height: 1; }
    .scrub .mono, .video-scrub .mono { min-width: 4.6rem; text-align: right; }
    canvas { touch-action: none; } /* dragging an element shouldn't scroll the page on touch screens */
    .layout-edit { margin: 1rem 0 0; }
    .layout-edit .hint { margin: 0 0 .5rem; }
    .layout-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: .5rem 1rem; }
    .layout-grid .field { margin: 0; }
    .layout-grid label { font-weight: normal; font-size: .92rem; }
    .layout-grid input[type=range] { accent-color: var(--accent); }
    .item-sizes { margin: .6rem 0 0; padding: .5rem 0 0; border: 0; border-top: 1px solid var(--line); }
    .item-sizes legend { font-weight: 600; font-size: .92rem; padding: 0; }
    .stats-time { display: flex; align-items: center; gap: .5rem; margin: .1rem 0 .3rem 1.6rem; font-size: .92rem; }
    .stats-time label { font-weight: normal; }
    .stats-time input { width: 4.5rem; }
    .stats-hint { margin: .1rem 0 .5rem 1.6rem; font-size: .85rem; line-height: 1.45; padding: .5rem .7rem; }
    .layout-actions { display: flex; gap: 1.25rem; flex-wrap: wrap; margin-top: .4rem; font-size: .92rem; }
    .check { display: flex; align-items: center; justify-content: flex-start; gap: .45rem; font-weight: normal; margin: .2rem 0; }
    /* The site-wide .field input rule makes inputs full width; checkboxes shouldn't be. */
    .check input { width: auto; margin: 0; }
    .colors { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem 1rem; margin: .2rem 0 .3rem; font-size: .92rem; }
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
/**
 * Preview and export of the transparent HUD video for one flight's data. Used by the stored flight's overlay page and
 * by LovelyOSD, which reads a log without storing it.
 */
export class OverlayExportComponent {
  data = input.required<OverlayData>();
  /** Flight length; the export range and preview slider cover 0 to this. */
  seconds = input.required<number>();
  /** File name before the "-1920x1080-30fps.mov" part. */
  fileStem = input.required<string>();

  private canvas = viewChild<ElementRef<HTMLCanvasElement>>('preview');

  readonly resolutions = RESOLUTIONS;
  readonly fpsOptions = FPS;
  readonly toDisk = canSaveToDisk();
  readonly clock = clock;

  font = signal<GlyphFont | null>(null);
  fontError = signal('');
  private renderer = computed(() => new OverlayRenderer(this.data()));
  hasRssi = computed(() => this.data().telemetry?.some(p => p[1] !== null) ?? false);
  hasBaro = computed(() => this.data().telemetry?.some(p => p[2] !== null) ?? false);

  /** New data (another flight or session) resets the range to the whole flight. */
  private range = computed(() => ({ data: this.data(), seconds: this.seconds() }));
  resIndex = signal(0);
  fps = signal(30);
  start = linkedSignal({ source: this.range, computation: () => 0 });
  end = linkedSignal({ source: this.range, computation: r => r.seconds });
  opts = signal<OverlayOptions>({
    showSticks: true, stickTrails: true, showSpeed: true, showBattery: true, showMap: true, showTimer: true, showRssi: true, altSource: 'gps', showStats: true, statsAfter: 0, flightSeconds: 0,
    ...readColors(), stickTrailIntensity: readTrailIntensity(),
    stickMode: readStickMode(), panelOpacity: 0.35, font: null, speedUnit: 'kmh', layout: readLayout(), itemScale: readItemScales(),
  });
  private units = inject(UnitsService);

  // ---- layout editing ----
  readonly labels = ELEMENT_LABELS;
  readonly scaleMin = SCALE_MIN;
  readonly scaleMax = SCALE_MAX;
  /** Elements currently drawn, with their boxes on the 1080p preview. */
  placed = computed(() => this.renderer().placements(PREVIEW_W, PREVIEW_H, this.opts()));
  /** Picked by click or from the list; null until the user starts editing, so no outline shows before then. */
  selected = signal<ElementKey | null>(null);
  hoverKey = signal<ElementKey | null>(null);
  dragging = signal(false);
  private drag: { key: ElementKey; dx: number; dy: number } | null = null;
  hasCustomLayout = computed(() => Object.keys(this.opts().layout).length > 0 || Object.keys(this.opts().itemScale).length > 0);
  readonly items = ELEMENT_ITEMS;
  readonly itemMin = ITEM_SCALE_MIN;
  readonly itemMax = ITEM_SCALE_MAX;
  /** The element the controls edit, as centre fractions and scale. */
  current = computed(() => {
    const placed = this.placed();
    const p = placed.find(e => e.key === this.selected()) ?? placed[0];
    return p ? { key: p.key, x: (p.x + p.w / 2) / PREVIEW_W, y: (p.y + p.h / 2) / PREVIEW_H, scale: p.scale } : null;
  });

  previewTime = linkedSignal({ source: this.range, computation: r => Math.min(60, r.seconds / 2) });
  previewClock = computed(() => preciseClock(this.previewTime()));
  /** What's behind the preview canvas. Never part of the export. */
  backdrop = signal<Backdrop>(readBackdrop());
  backdropError = signal('');

  // ---- playing the pilot's own video behind the preview ----
  private bgVideo = viewChild<ElementRef<HTMLVideoElement>>('bgVideo');
  private stage = viewChild<ElementRef<HTMLDivElement>>('stage');
  /** The preview is filling the screen. */
  fullscreen = signal(false);
  videoUrl = signal<string | null>(null);
  videoName = signal('');
  /** Seconds into the video where the log (arming) starts. */
  videoOffset = signal(0);
  videoPlaying = signal(false);
  muted = signal(true);
  /** The background video's own clock, for its slider. */
  videoTime = signal(0);
  videoDuration = signal(0);
  videoClock = computed(() => preciseClock(this.videoTime()));
  /** The video is before arming, so the overlay isn't drawn yet. */
  beforeLog = signal(false);
  private frameRequest: number | null = null;

  // ---- end-of-flight stats ----
  readonly gapMs = Math.round(STATS_GAP_S * 1000);
  statsSeconds = signal(2);
  /** Blank pause plus the stats screen, added after the export's end. */
  private tail = computed(() => (this.opts().showStats ? STATS_GAP_S + this.statsSeconds() : 0));
  exportSeconds = computed(() => Math.max(0, this.end() - this.start()) + this.tail());
  previewMax = computed(() => this.seconds() + this.tail());

  frameCount = computed(() => Math.max(0, Math.floor(this.exportSeconds() * this.fps())));
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
    loadSavedFont().then(f => this.font.set(f));
    effect(() => { const f = this.font(); this.opts.update(o => ({ ...o, font: f })); });
    effect(() => { const u = this.units.speed(); this.opts.update(o => ({ ...o, speedUnit: u })); });
    // The stats start where the export ends (or the flight does, in the preview past the end).
    effect(() => { const after = this.end(), flight = this.seconds(); this.opts.update(o => ({ ...o, statsAfter: after, flightSeconds: flight })); });

    // Redraw the preview whenever anything it shows changes.
    afterNextRender(() => this.drawPreview());
    inject(DestroyRef).onDestroy(() => {
      this.stopVideo();
      const url = this.videoUrl();
      if (url) URL.revokeObjectURL(url);
    });
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

  setTrailIntensity(value: number) {
    this.set('stickTrailIntensity', value);
    try { localStorage.setItem(TRAIL_KEY, String(value)); } catch { /* not remembered */ }
  }

  /** Puts one group (mini map or sticks) back to its defaults. */
  resetColors(defaults: Partial<typeof DEFAULT_COLORS>) {
    this.opts.update(o => ({ ...o, ...defaults }));
    saveColors(this.opts());
  }

  setStickMode(v: number) {
    this.set('stickMode', (v === 1 || v === 3 || v === 4 ? v : 2) as StickMode);
  }

  private setPlacement(key: ElementKey, placement: ElementPlacement, save = true) {
    this.opts.update(o => ({ ...o, layout: { ...o.layout, [key]: placement } }));
    if (save) saveLayout(this.opts().layout);
  }

  updatePlacement(field: keyof ElementPlacement, value: number) {
    const c = this.current();
    if (!c || !Number.isFinite(value)) return;
    this.selected.set(c.key);
    const next = { x: c.x, y: c.y, scale: c.scale, [field]: value };
    next.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, next.scale));
    this.setPlacement(c.key, { x: clamp01(next.x), y: clamp01(next.y), scale: next.scale });
  }

  itemScale(key: ItemKey) {
    return this.opts().itemScale[key] ?? 1;
  }

  setItemScale(key: ItemKey, value: number) {
    if (!Number.isFinite(value)) return;
    const v = Math.min(ITEM_SCALE_MAX, Math.max(ITEM_SCALE_MIN, value));
    this.opts.update(o => ({ ...o, itemScale: { ...o.itemScale, [key]: v } }));
    saveItemScales(this.opts().itemScale);
  }

  /** True when the element is moved, resized, or has resized text. */
  isCustom(key: ElementKey) {
    const o = this.opts();
    return !!o.layout[key] || (ELEMENT_ITEMS[key] ?? []).some(i => o.itemScale[i.key] !== undefined);
  }

  /** Back to its default spot, size and text sizes. */
  resetElement(key: ElementKey) {
    const itemKeys = new Set<string>((ELEMENT_ITEMS[key] ?? []).map(i => i.key));
    this.opts.update(o => ({
      ...o,
      layout: Object.fromEntries(Object.entries(o.layout).filter(([k]) => k !== key)),
      itemScale: Object.fromEntries(Object.entries(o.itemScale).filter(([k]) => !itemKeys.has(k))),
    }));
    saveLayout(this.opts().layout);
    saveItemScales(this.opts().itemScale);
  }

  resetLayout() {
    this.opts.update(o => ({ ...o, layout: {}, itemScale: {} }));
    saveLayout({});
    saveItemScales({});
  }

  /** Pointer position in preview canvas pixels. */
  private canvasPoint(e: PointerEvent) {
    const c = this.canvas()!.nativeElement;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * PREVIEW_W, y: ((e.clientY - r.top) / r.height) * PREVIEW_H };
  }

  /** Topmost element under a point (drawn last = on top). */
  private hit(x: number, y: number) {
    return [...this.placed()].reverse().find(p => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) ?? null;
  }

  onPointerDown(e: PointerEvent) {
    if (this.busy()) return;
    const pt = this.canvasPoint(e);
    const p = this.hit(pt.x, pt.y);
    if (!p) return;
    e.preventDefault();
    this.selected.set(p.key);
    this.drag = { key: p.key, dx: pt.x - (p.x + p.w / 2), dy: pt.y - (p.y + p.h / 2) };
    this.dragging.set(true);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }

  onPointerMove(e: PointerEvent) {
    const pt = this.canvasPoint(e);
    if (!this.drag) { this.hoverKey.set(this.busy() ? null : this.hit(pt.x, pt.y)?.key ?? null); return; }
    let x = clamp01((pt.x - this.drag.dx) / PREVIEW_W);
    let y = clamp01((pt.y - this.drag.dy) / PREVIEW_H);
    // Snap to the frame's centre lines, which are the hardest spots to hit by hand.
    if (Math.abs(x - 0.5) < 0.008) x = 0.5;
    if (Math.abs(y - 0.5) < 0.012) y = 0.5;
    const scale = this.placed().find(p => p.key === this.drag!.key)?.scale ?? 1;
    this.setPlacement(this.drag.key, { x, y, scale }, false);
  }

  onPointerUp() {
    if (!this.drag) return;
    this.drag = null;
    this.dragging.set(false);
    saveLayout(this.opts().layout);
  }

  setStatsSeconds(v: number) {
    if (Number.isFinite(v)) this.statsSeconds.set(Math.min(30, Math.max(0.5, v)));
  }

  setBackdrop(v: Backdrop) {
    this.backdrop.set(v);
    try { localStorage.setItem(BACKDROP_KEY, v); } catch { /* not remembered */ }
  }

  toggleFullscreen() {
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => undefined); return; }
    this.stage()?.nativeElement.requestFullscreen().catch(() => this.backdropError.set("This browser won't go full screen here."));
  }

  onFullscreenChange() {
    this.fullscreen.set(document.fullscreenElement === this.stage()?.nativeElement);
  }

  /** In full screen, Space plays and pauses the video (Esc exits, handled by the browser). */
  onFullscreenKey(e: KeyboardEvent) {
    if (!this.fullscreen() || e.key !== ' ' || !this.videoUrl()) return;
    e.preventDefault();
    this.toggleVideo();
  }

  onVideoFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.stopVideo();
    const old = this.videoUrl();
    if (old) URL.revokeObjectURL(old);
    // Played straight from the file on this computer; nothing is uploaded.
    this.videoUrl.set(URL.createObjectURL(file));
    this.videoName.set(file.name);
    this.backdropError.set('');
    this.setBackdrop('video');
  }

  onVideoMeta() {
    const v = this.bgVideo()?.nativeElement;
    if (!v) return;
    // Some recordings don't say how long they are up front; the seekable range does.
    const d = Number.isFinite(v.duration) ? v.duration : v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0;
    this.videoDuration.set(d);
  }

  onVideoTime() {
    const v = this.bgVideo()?.nativeElement;
    if (v) this.videoTime.set(v.currentTime);
  }

  /** Moves only the video (pausing it), so you can find a frame without the overlay moving. */
  scrubVideo(t: number) {
    const v = this.bgVideo()?.nativeElement;
    if (!v || !Number.isFinite(t)) return;
    v.pause();
    v.currentTime = Math.max(0, t);
    this.videoTime.set(v.currentTime);
  }

  /** The overlay one frame back or forward at the export frame rate; a paused video follows, like the slider. */
  stepOverlay(dir: -1 | 1) {
    const t = Math.min(this.previewMax(), Math.max(0, this.previewTime() + dir / this.fps()));
    this.onScrub(Math.round(t * 1000) / 1000);
  }

  /** One frame back or forward (at 30 fps; close enough for 25-60 fps footage). */
  stepVideo(dir: -1 | 1) {
    this.scrubVideo(this.videoTime() + dir / 30);
  }

  /** The slider moves the overlay; a paused video follows it. */
  onScrub(t: number) {
    this.previewTime.set(t);
    if (!this.videoPlaying()) this.seekVideoToPreview();
  }

  seekVideoToPreview() {
    const v = this.bgVideo()?.nativeElement;
    if (!v) return;
    v.currentTime = Math.max(0, this.previewTime() + this.videoOffset());
    this.beforeLog.set(false);
  }

  toggleVideo() {
    const v = this.bgVideo()?.nativeElement;
    if (!v) return;
    if (!v.paused) { v.pause(); return; }
    v.play().then(() => this.followVideo(), () => this.backdropError.set("This browser can't play that video. Try an H.264 MP4."));
  }

  setOffset(v: number) {
    if (!Number.isFinite(v)) return;
    this.videoOffset.set(Math.round(v * 100) / 100);
    if (!this.videoPlaying()) this.seekVideoToPreview(); // keep the overlay where it is and slide the video under it
  }

  /**
   * When the quad left the ground, in seconds since arming: the first time the throttle stick goes over 20%, or without
   * stick data, the first time GPS shows it moving or climbing. Null when the log has neither.
   */
  takeoffTime = computed(() => {
    const sticks = this.data().sticks;
    if (sticks?.length) {
      const hit = sticks.find(p => p[4] >= 1200);
      if (hit) return hit[0];
    }
    const hit = this.data().track?.points.find(p => p[4] > 2 || p[3] > 1);
    return hit ? hit[0] : null;
  });
  takeoffFromGps = computed(() => !this.data().sticks?.some(p => p[4] >= 1200));
  takeoffClock = computed(() => {
    const t = this.takeoffTime();
    return t === null ? '' : `${clock(t)}.${Math.floor((t % 1) * 10)}`;
  });

  /** Where the exported clip (which begins at Start) goes in the pilot's footage, once the preview is synced. */
  private placeSeconds = computed(() => (this.videoUrl() ? this.videoOffset() + this.start() : null));
  placeAt = computed(() => { const t = this.placeSeconds(); return t !== null && t >= 0 ? preciseClock(t) : null; });
  /** The footage starts after the clip would: how much of the clip's start to cut. */
  placeTrimmed = computed(() => { const t = this.placeSeconds(); return t !== null && t < 0 ? preciseClock(-t) : null; });

  /** Use the frame on screen as the moment of takeoff: the overlay jumps there and the video stays put. */
  takeoffHere() {
    const v = this.bgVideo()?.nativeElement;
    const t = this.takeoffTime();
    if (!v || t === null) return;
    this.videoOffset.set(Math.round((v.currentTime - t) * 100) / 100);
    this.previewTime.set(t);
    this.beforeLog.set(false);
  }

  /** Use the frame on screen as the moment of arming. */
  logStartsHere() {
    const v = this.bgVideo()?.nativeElement;
    if (!v) return;
    this.videoOffset.set(Math.round(v.currentTime * 100) / 100);
    this.previewTime.set(0);
    this.beforeLog.set(false);
  }

  /** While the video plays, the overlay follows its clock, frame by frame where the browser supports it. */
  private followVideo() {
    const v = this.bgVideo()?.nativeElement;
    if (!v || v.paused) return;
    const t = v.currentTime - this.videoOffset();
    this.beforeLog.set(t < 0);
    this.previewTime.set(Math.min(this.previewMax(), Math.max(0, t)));
    const next = () => this.followVideo();
    if ('requestVideoFrameCallback' in v) {
      this.frameRequest = (v as HTMLVideoElement & { requestVideoFrameCallback(cb: () => void): number }).requestVideoFrameCallback(next);
    } else {
      this.frameRequest = requestAnimationFrame(next);
    }
  }

  private stopVideo() {
    this.bgVideo()?.nativeElement.pause();
    this.videoPlaying.set(false);
  }

  clampTime(v: number) {
    return Math.min(this.seconds(), Math.max(0, Number.isFinite(v) ? v : 0));
  }

  private drawPreview() {
    const r = this.renderer();
    const c = this.canvas()?.nativeElement;
    const t = this.previewTime();
    const o = this.opts();
    if (!c) return;
    const ctx = c.getContext('2d')!;
    r.draw(ctx, t, o);
    // Outline the element being edited. Preview only: the exported frames never get it.
    const sel = this.selected() ? this.placed().find(p => p.key === this.selected()) : null;
    if (sel) {
      ctx.save();
      ctx.strokeStyle = '#9be564';
      ctx.lineWidth = 3;
      ctx.setLineDash([12, 8]);
      ctx.strokeRect(sel.x - 6, sel.y - 6, sel.w + 12, sel.h + 12);
      ctx.restore();
    }
  }

  async exportVideo() {
    const r = this.renderer();
    this.error.set('');
    this.message.set('');

    const { w, h } = RESOLUTIONS[this.resIndex()];
    const fps = this.fps();
    const name = `${this.fileStem()}-${w}x${h}-${fps}fps.mov`;
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
    const from = this.start();
    const opts = this.opts();
    const started = performance.now();

    this.busy.set(true);
    this.done.set(0);
    this.cancelled = false;
    try {
      for (let i = 0; i < total; i++) {
        if (this.cancelled) break;
        r.draw(ctx, from + i / fps, opts);
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
