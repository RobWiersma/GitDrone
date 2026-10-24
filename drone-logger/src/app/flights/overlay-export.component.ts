import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, linkedSignal, model, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ELEMENT_ITEMS, ELEMENT_LABELS, ElementKey, ElementPlacement, ITEM_SCALE_MAX, ITEM_SCALE_MIN, ItemKey, OverlayData, OverlayLayout,
  OverlayOptions, OverlayRenderer, STATS_GAP_S } from './overlay-renderer';
import { MovWriter, canSaveToDisk, diskMovWriter, memoryMovWriter } from './mov-writer';
import { GlyphFont, loadSavedFont, parseGlyphFont, saveFont } from './glyph-font';
import { UnitsService } from '../units.service';
import { StickMode, readStickMode } from './stick-math';
import { clock } from './flight-profile.component';
import { ArmingMatch, MotorMatch, SoundProfile, findArming, findClaps, matchMotorSound, soundProfile } from './clap';
import { RenderCancelled, RenderPlan, RenderTarget, footageFrameRate, fpsLabel, outputFrameRate, renderVideo } from './video-render';
import { RangeWindowComponent } from './range-window.component';
import { IconComponent, IconName } from '../icon.component';

const RESOLUTIONS = [
  { label: '1080p (1920×1080)', w: 1920, h: 1080 },
  { label: '1440p (2560×1440)', w: 2560, h: 1440 },
  { label: '4K (3840×2160)', w: 3840, h: 2160 },
];
/** The same sizes on their side, for Shorts, Reels and TikTok. */
const VERTICAL_RESOLUTIONS = [
  { label: '1080p (1080×1920)', w: 1080, h: 1920 },
  { label: '1440p (1440×2560)', w: 1440, h: 2560 },
  { label: '4K (2160×3840)', w: 2160, h: 3840 },
];

const FORMAT_KEY = 'gitdrone-overlay-format';

const FADE_KEY = 'gitdrone-render-fade';

/** The finished video's fade-out in seconds: 1.5 until changed, 0 once switched off. */
function readFadeOut(): number {
  try {
    const saved = localStorage.getItem(FADE_KEY);
    const v = saved === null ? NaN : Number(saved);
    if (v >= 0 && v <= 10) return v;
  } catch { /* default */ }
  return 1.5;
}

type SaveFilePicker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) =>
  Promise<{ createWritable(): Promise<WritableStream> }>;

/** Where the preview's footage and stick cam sliders start, and what Reset goes back to (percent; pan in % of the box). */
const FOOTAGE_DEFAULTS = { brightness: 100, contrast: 110, saturation: 135, zoom: 100 };
const CAM_DEFAULTS = { brightness: 70, contrast: 100, saturation: 100, zoom: 215, panX: 0, panY: 0 };

/** CSS filter for preview-only brightness, contrast and saturation (percent); null when all are as recorded. */
const gradeFilter = (brightness: number, contrast: number, saturation: number) =>
  brightness === 100 && contrast === 100 && saturation === 100 ? null
    : `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;

function readVertical(): boolean {
  try { return localStorage.getItem(FORMAT_KEY) === 'vertical'; } catch { return false; }
}
const FPS = [24, 25, 30, 50, 60];

const DEFAULT_PATH_COLORS = { pathRecentColor: '#9be564', pathOldColor: '#2c4a1f' };
const DEFAULT_STICK_COLORS = { stickDotColor: '#e086b0', stickTrailColor: '#86a858', stickBoxColor: '#1c1c1c', stickCrossColor: '#ffffff' };
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
const SCALE_MIN = 0.5, SCALE_MAX = 3;
/** Landscape and vertical frames want different layouts, so each keeps its own. */
const layoutKey = (vertical: boolean) => (vertical ? `${LAYOUT_KEY}-vertical` : LAYOUT_KEY);

/** Moved/resized elements remembered in this browser. Anything malformed is dropped, so that element goes back to default. */
function readLayout(vertical: boolean): OverlayLayout {
  const layout: OverlayLayout = {};
  try {
    const saved = JSON.parse(localStorage.getItem(layoutKey(vertical)) ?? 'null');
    for (const key of Object.keys(ELEMENT_LABELS) as ElementKey[]) {
      const v = saved?.[key];
      const ok = (n: unknown, lo: number, hi: number) => typeof n === 'number' && n >= lo && n <= hi;
      if (v && ok(v.x, 0, 1) && ok(v.y, 0, 1) && ok(v.scale, SCALE_MIN, SCALE_MAX)) layout[key] = { x: v.x, y: v.y, scale: v.scale };
    }
  } catch { /* defaults */ }
  return layout;
}

function saveLayout(layout: OverlayLayout, vertical: boolean) {
  try { localStorage.setItem(layoutKey(vertical), JSON.stringify(layout)); } catch { /* not remembered */ }
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
/** The Show toggles' switches. */
type ShowKey = 'showSpeed' | 'showBattery' | 'showSticks' | 'showMap' | 'showRssi' | 'showStats' | 'showTitle' | 'showCraft';
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

/** Title and craft name: text and colours, remembered in this browser. Colours match a real Short's title. */
const DEFAULT_LABELS = {
  titleText: '', titleColor: '#dc8bad', titleAccentText: '', titleAccentColor: '#8aa860', titleStrokeColor: '#000000', titleBgColor: '',
  craftText: '', craftColor: '#afa0a9', craftStrokeColor: '#330a0a',
};
type LabelKey = keyof typeof DEFAULT_LABELS;
const LABELS_KEY = 'gitdrone-overlay-labels';

function readLabels(): typeof DEFAULT_LABELS {
  const labels = { ...DEFAULT_LABELS };
  try {
    const saved = JSON.parse(localStorage.getItem(LABELS_KEY) ?? 'null');
    for (const key of Object.keys(labels) as LabelKey[]) {
      const v: unknown = saved?.[key];
      if (typeof v !== 'string') continue;
      // Colours are #rrggbb; the background may also be '' (no box). Text is capped so a paste can't flood the frame.
      if (key.endsWith('Color') ? /^#[0-9a-f]{6}$/i.test(v) || (key === 'titleBgColor' && v === '') : v.length <= 60) labels[key] = v;
    }
  } catch { /* defaults */ }
  return labels;
}

function saveLabels(o: typeof DEFAULT_LABELS) {
  const labels = Object.fromEntries((Object.keys(DEFAULT_LABELS) as LabelKey[]).map(k => [k, o[k]]));
  try { localStorage.setItem(LABELS_KEY, JSON.stringify(labels)); } catch { /* not remembered */ }
}

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
  imports: [FormsModule, RangeWindowComponent, IconComponent],
  template: `
        <div class="layout">
          <section class="panel preview-panel" aria-labelledby="preview-heading">
            <h2 id="preview-heading">Preview</h2>
            <div #stage class="stage" [class.dark]="backdrop() === 'sky'" [class.vertical]="vertical()">
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
                <!-- The footage's own box: the whole frame in landscape, the top half in vertical. Zoom stays inside it. -->
                <div class="footage-box" [class.selected]="mediaSelected() === 'footage'">
                  <video #bgVideo class="bg-video" [class.fit]="footage43() && !vertical()" [style.filter]="footageFilter()"
                         [style.transform]="footageZoom() === 100 ? null : 'scale(' + footageZoom() / 100 + ')'"
                         [src]="videoUrl()" [muted]="muted() || !!audioUrl()" playsinline preload="auto" aria-hidden="true"
                         (loadedmetadata)="onVideoMeta(); seekVideoToPreview()" (durationchange)="onVideoMeta()"
                         (timeupdate)="onVideoTime()" (seeked)="onVideoTime(); syncAudio(true)"
                         (pause)="videoPlaying.set(false); syncAudio()" (play)="videoPlaying.set(true); syncAudio(true)"></video>
                </div>
              }
              @if (audioUrl()) {
                @if (audioIsVideo()) {
                  <!-- A stick cam (or any second video): its sound always plays; its picture fills the bottom half under
                       the HUD in vertical only, so landscape keeps the whole frame for the footage. -->
                  <div class="pip" [class.hidden]="!hasCam()" [class.selected]="mediaSelected() === 'cam'">
                    <video #extAudio [style.filter]="camFilter()" [style.transform]="camTransform()"
                           [src]="audioUrl()" [muted]="muted()" playsinline preload="auto"
                           aria-hidden="true" (play)="audioPlaying.set(true)" (pause)="audioPlaying.set(false)"></video>
                  </div>
                } @else {
                  <audio #extAudio [src]="audioUrl()" [muted]="muted()" preload="auto"
                         (play)="audioPlaying.set(true)" (pause)="audioPlaying.set(false)"></audio>
                }
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
                <button class="btn small step" type="button" (click)="stepVideo(-1)" aria-label="Back one frame" title="Back one frame"><app-icon name="prev" /></button>
                <input id="videoTime" type="range" min="0" [max]="videoDuration()" step="0.01" [ngModel]="videoTime()"
                       (ngModelChange)="scrubVideo(+$event)" [disabled]="!videoDuration()" />
                <button class="btn small step" type="button" (click)="stepVideo(1)" aria-label="Forward one frame" title="Forward one frame"><app-icon name="next" /></button>
                <span class="mono">{{ videoClock() }}</span>
              </div>
              <!-- The part of the footage the finished video covers, on its own two-handle slider lined up with the one above.
                   Dragging a handle shows that frame in the preview. -->
              <div class="video-scrub">
                <span class="scrub-label" id="render-range-label">Render</span>
                <span class="btn small step" style="visibility: hidden" aria-hidden="true"><app-icon name="prev" /></span>
                <app-range-window label="Render" [max]="videoDuration()" [step]="0.1" [valueText]="clockText" [disabled]="rendering() || !videoDuration()"
                                  [(start)]="renderStart" [(end)]="renderEnd" (startChange)="scrubVideo($event)" (endChange)="scrubVideo($event)" />
                <span class="btn small step" style="visibility: hidden" aria-hidden="true"><app-icon name="next" /></span>
                <span class="mono">{{ clock(renderEnd() - renderStart()) }}</span>
              </div>
              <div class="export-window">
                <span class="mono" aria-live="polite">Render {{ clipText() }}</span>
                @if (!wholeClip()) {
                  <button class="link" type="button" (click)="useWholeClip()" [disabled]="rendering()">Whole clip</button>
                }
              </div>
            }
            <div class="scrub">
              <label for="previewTime" class="scrub-label">OSD overlay</label>
              <button class="btn small step" type="button" (click)="stepOverlay(-1)" aria-label="Overlay back one frame" title="Overlay back one frame"><app-icon name="prev" /></button>
              <!-- The bar under the slider marks the part that gets exported. -->
              <div class="scrub-track">
                <input id="previewTime" type="range" min="0" [max]="previewMax()" step="0.01" [ngModel]="previewTime()"
                       (ngModelChange)="onScrub(+$event)" />
                @if (!wholeFlight()) {
                  <span class="window-bar" aria-hidden="true" [style.left.%]="windowLeft()" [style.width.%]="windowWidth()"></span>
                }
              </div>
              <button class="btn small step" type="button" (click)="stepOverlay(1)" aria-label="Overlay forward one frame" title="Overlay forward one frame"><app-icon name="next" /></button>
              <span class="mono">{{ previewClock() }}</span>
            </div>
            <!-- Export only part of the flight: scrub to a moment and mark it. -->
            <div class="export-window">
              <span class="scrub-label">Export</span>
              <button class="btn small step" type="button" (click)="startHere()" [disabled]="busy() || previewTime() >= end()" aria-label="Start the export here" title="Start the export here (mark in)"><app-icon name="mark-in" /></button>
              <button class="btn small step" type="button" (click)="endHere()" [disabled]="busy() || previewTime() <= start()" aria-label="End the export here" title="End the export here (mark out)"><app-icon name="mark-out" /></button>
              <span class="mono" aria-live="polite">{{ windowText() }}</span>
              @if (!wholeFlight()) {
                <button class="link" type="button" (click)="useWholeFlight()" [disabled]="busy()">Whole flight</button>
              }
            </div>
            @if (backdropError()) { <p class="error">{{ backdropError() }}</p> }
            @if (backdrop() === 'video' && videoUrl()) {
              <div class="video-sync">
                <!-- Sync buttons on top, kept together on one line. -->
                <div class="sync-buttons">
                  @if (takeoffTime() !== null) {
                    <button class="btn btn-primary small" type="button" (click)="takeoffHere()" title="Pause the footage where you leave the ground, then press this to line the log up">Takeoff is here</button>
                  }
                  <button class="btn small" type="button" (click)="logStartsHere()" title="Pause the footage where you arm, then press this to line the log up">Arming is here</button>
                  @if (canMatchMotors()) {
                    <button class="btn small" type="button" (click)="syncFromMotors()" [disabled]="!!motorStatus()" title="Find where the log starts in the footage by listening for the motors">Sync from motor sound</button>
                  }
                </div>
                @if (motorStatus()) { <span class="hint" role="status">{{ motorStatus() }}</span> }
                <!-- Playback and the start time underneath. -->
                <div class="playback-row">
                  <button class="btn small step" type="button" (click)="toggleVideo()" [attr.aria-label]="videoPlaying() ? 'Pause' : 'Play'" [title]="videoPlaying() ? 'Pause' : 'Play'"><app-icon [name]="videoPlaying() ? 'pause' : 'play'" /></button>
                  <button class="btn small step" type="button" (click)="muted.set(!muted())" [attr.aria-pressed]="!muted()" aria-label="Sound" [title]="muted() ? 'Sound is off: click to hear it' : 'Sound is on: click to mute'"><app-icon [name]="muted() ? 'mute' : 'volume'" /></button>
                  <div class="offset">
                    <label for="video-offset">Log starts at</label>
                    <input id="video-offset" type="number" step="0.1" [ngModel]="videoOffset()" (ngModelChange)="setOffset(+$event)" />
                    <span>s in the video</span>
                  </div>
                </div>
              </div>
            }
            <!-- Sound from another recording (a phone on the ground) is its own track, lined up to the log like the footage.
                 It's picked in Options; lining it up happens here, under the preview. -->
            @if (audioUrl()) {
              <div class="video-sync audio-panel">
                @if (clapStatus()) { <span class="hint" role="status">{{ clapStatus() }}</span> }
                @if (audioProfile(); as prof) {
                  <!-- The recording's loudness with what was heard in it marked; click to move the sound track there. -->
                  <figure class="sound-profile">
                    <figcaption>
                      <span>Sound track: {{ audioName() }}</span>
                      <span class="mono">{{ profileHover() !== null ? clockOf(profileHover()!) : clockOf(prof.duration) + ' long' }}</span>
                    </figcaption>
                    <svg viewBox="0 0 1000 60" preserveAspectRatio="none" role="img" [attr.aria-label]="profileLabel()"
                         (mousemove)="hoverProfile($event)" (mouseleave)="profileHover.set(null)" (click)="seekProfile($event)">
                      <path class="level" [attr.d]="profilePath()" />
                      @for (c of audioClaps(); track c; let i = $index) {
                        <line class="mark clap" [class.chosen]="hasVideo() && i === audioClapIndex()"
                              [attr.x1]="profileX(c)" [attr.x2]="profileX(c)" y1="0" y2="60"><title>Clap at {{ clockOf(c) }}</title></line>
                      }
                      @if (audioArming(); as arm) {
                        <line class="mark arm" [class.chosen]="audioLogStart() === arm.logStart" [attr.x1]="profileX(arm.logStart)" [attr.x2]="profileX(arm.logStart)"
                              y1="0" y2="60"><title>Arming heard at {{ clockOf(arm.logStart) }}</title></line>
                        @if (launchInAudio() !== null) {
                          <line class="mark arm" [class.chosen]="audioLogStart() === arm.logStart" [attr.x1]="profileX(launchInAudio()!)" [attr.x2]="profileX(launchInAudio()!)"
                                y1="0" y2="60"><title>Launch heard at {{ clockOf(launchInAudio()!) }}</title></line>
                        }
                      }
                      <line class="mark now" [attr.x1]="profileX(soundCursor())" [attr.x2]="profileX(soundCursor())" y1="0" y2="60" />
                    </svg>
                    <div class="profile-key">
                      @if (audioArming()) { <span><i class="key arm"></i>Arming and launch heard</span> }
                      @if (audioClaps().length) { <span><i class="key clap"></i>Claps</span> }
                      <span><i class="key now"></i>Sound track position</span>
                    </div>
                  </figure>
                }
                <!-- Moves only the sound, to find arming or takeoff in it; nothing else moves until a button below. -->
                <div class="video-scrub">
                  <label for="soundTime" class="scrub-label">Sound track</label>
                  <button class="btn small step" type="button" (click)="stepSound(-1)" aria-label="Sound track back one frame" title="Sound track back one frame"><app-icon name="prev" /></button>
                  <input id="soundTime" type="range" min="0" [max]="audioProfile()?.duration ?? 0" step="0.01" [ngModel]="soundCursor()"
                         (ngModelChange)="scrubSound(+$event)" [disabled]="!audioProfile()" />
                  <button class="btn small step" type="button" (click)="stepSound(1)" aria-label="Sound track forward one frame" title="Sound track forward one frame"><app-icon name="next" /></button>
                  <span class="mono">{{ clockOf(soundCursor()) }}</span>
                </div>
                <div class="sync-buttons">
                  @if (takeoffTime() !== null) {
                    <button class="btn btn-primary small" type="button" (click)="soundTakeoffHere()" aria-label="Takeoff is here in the sound track" title="Move the sound track slider to the takeoff you hear, then press this">Takeoff is here</button>
                  }
                  <button class="btn small" type="button" (click)="soundArmingHere()" aria-label="Arming is here in the sound track" title="Move the sound track slider to the arming you hear, then press this">Arming is here</button>
                  @if (audioArming(); as arm) {
                    @if (audioLogStart() !== arm.logStart) {
                      <button class="btn small" type="button" (click)="useHeardArming()" title="Line the sound track up on the arming GitDrone heard in it">Use the arming it heard</button>
                    }
                  }
                </div>
                <div class="playback-row">
                  @if (audioOnly()) {
                    <button class="btn small step" type="button" (click)="toggleAudioPreview()" [attr.aria-label]="audioPlaying() ? 'Pause' : 'Play'" [title]="audioPlaying() ? 'Pause' : 'Play'"><app-icon [name]="audioPlaying() ? 'pause' : 'play'" /></button>
                    <button class="btn small step" type="button" (click)="muted.set(!muted())" [attr.aria-pressed]="!muted()" aria-label="Sound" [title]="muted() ? 'Sound is off: click to hear it' : 'Sound is on: click to mute'"><app-icon [name]="muted() ? 'mute' : 'volume'" /></button>
                  }
                  <div class="offset">
                    <label for="audio-log-start">Log starts at</label>
                    <input id="audio-log-start" type="number" step="0.1" [ngModel]="audioLogStart()" (ngModelChange)="setAudioLogStart(+$event)" />
                    <span>s in the sound</span>
                  </div>
                </div>
                @if (hasVideo() && audioClaps().length) {
                  <!-- Or line the sound up with the footage on a clap heard in both. -->
                  <div class="audio-claps">
                    <div class="clap-field">
                      <label for="phone-clap">Clap in the sound</label>
                      <select id="phone-clap" [ngModel]="audioClapIndex()" (ngModelChange)="audioClapIndex.set(+$event)">
                        @for (c of audioClaps(); track c; let i = $index) {
                          <option [value]="i">{{ i === 0 ? 'First' : i === 1 ? 'Second' : 'Third' }} clap at {{ clockOf(c) }}</option>
                        }
                      </select>
                    </div>
                    <div class="clap-field">
                      <span class="clap-label">Clap in the footage</span>
                      <span class="mono">{{ footageClap() === null ? 'not set' : clockOf(footageClap()!) }}</span>
                      @if (footageClapAuto() && footageClap() !== null) { <span class="hint">(found)</span> }
                      <button class="btn small" type="button" (click)="footageClapHere()" title="Mark the clap at the footage's current frame">Clap is here</button>
                      <button class="btn small" type="button" (click)="syncOnClap()" title="Line the sound track up with the footage on the clap heard in both">Sync on the clap</button>
                    </div>
                  </div>
                }
              </div>
            }
            <!-- All the how-to text for the preview in one callout, under its controls. -->
            <div class="callout preview-help">
              @if (backdrop() === 'video' && videoUrl()) {
                @if (videoOffset() < 0) { <p>A negative start means you armed before the video started.</p> }
                <p>
                  @if (takeoffTime() !== null) {
                    To line them up: use the <strong>Flight footage</strong> slider (and its arrow buttons for single frames) to find the moment you leave
                    the ground, then press <strong>Takeoff is here</strong>
                    (the log has takeoff at {{ takeoffClock() }}, the first throttle punch{{ takeoffFromGps() ? ' or move on GPS' : '' }}).
                    Or pause on arming and press <strong>Arming is here</strong>.
                  } @else {
                    To line them up: pause the video on the moment you arm, then press <strong>Arming is here</strong>.
                  }
                  The overlay is hidden before the log starts, like in your editor. {{ videoName() }} plays from this computer and isn't uploaded.
                </p>
              }
              @if (motorMatch(); as m) {
                <p>
                  @if (m.confident) {
                    <strong>Synced from the motor sound.</strong> The footage's sound follows your throttle best with the log starting at
                    {{ clockOf(m.offset < 0 ? -m.offset : m.offset) }}{{ m.offset < 0 ? ' before' : ' into' }} the video (match {{ m.score }}).
                    Press Play and check a punch-out or two.
                  } @else {
                    <strong>The motor sound didn't match clearly</strong> (best match {{ m.score }}), so your start time wasn't changed.
                    Use <strong>Takeoff is here</strong> instead; wind noise and music can drown the motors out.
                    <button class="link" type="button" (click)="applyMotorGuess()">Use the best guess anyway</button>
                  }
                </p>
              }
              @if (audioUrl()) {
                <p>
                  @if (audioArming()?.confident && audioLogStart() === audioArming()!.logStart) {
                    <strong>Sound track lined up on arming.</strong> The motors arm {{ clockOf(audioLogStart()) }} into {{ audioName() }}
                    and launch {{ takeoffClock() }} later, as in the log.
                  } @else {
                    The sound is its own track, lined up to the log like the footage: move the <strong>Sound track</strong> slider (or
                    click the graph) to where the motors arm or you launch, and press <strong>Arming is here</strong> or
                    <strong>Takeoff is here</strong> under it.
                    @if (hasVideo() && audioClaps().length) { Or line it up with the footage on a clap: <strong>Sync on the clap</strong>. }
                  }
                  @if (hasVideo()) {
                    It plays with your footage (starting {{ audioStartText() }}) and stays on the log when you move the footage.
                  } @else {
                    <strong>Play</strong> runs the overlay with it; add your footage to see all three together.
                  }
                </p>
              }
              <p>The backdrop is only for the preview: the exported video stays transparent.</p>
            </div>

          </section>

          <!-- The picked component's settings in one place, like Premiere's Effect Controls: click something in the
               preview (or pick it here) and everything about it shows. Left of the preview in vertical, under it in landscape. -->
          <section class="panel inspector" aria-labelledby="inspector-heading">
            <div class="inspector-head">
              <h2 id="inspector-heading">{{ inspectedLabel() }}</h2>
              @if (inspected()) { <button class="btn small step" type="button" (click)="selectMedia(null)" aria-label="Done" title="Done: close these settings"><app-icon name="close" /></button> }
            </div>
            <fieldset class="inspector-body" [disabled]="busy()">
              <legend class="sr-only">{{ inspectedLabel() }} settings</legend>
              @switch (inspected()) {
                @case (null) {
                  <p class="hint">Click something in the preview to edit it, or pick it here.</p>
                  <div class="colors">
                    @for (it of inspectables(); track it.key) {
                      <button class="btn small" type="button" (click)="inspect(it.key)">{{ it.label }}</button>
                    }
                  </div>
                  <div class="layout-actions">
                    <button class="link" type="button" (click)="resetLayout()" [disabled]="!hasCustomLayout()" title="Put every element back where it starts">Reset whole layout</button>
                  </div>
                }

                @case ('footage') {
                  <p class="mono">{{ videoName() }}</p>
                  <fieldset class="item-sizes">
                    <legend>Picture</legend>
                    <!-- Flat D-Log-ish footage is hard to judge the overlay against; the finished video uses these too. -->
                    <div class="grade">
                      <label for="brightness">Brightness</label>
                      <input id="brightness" type="range" min="50" max="200" step="5" [ngModel]="brightness()" (ngModelChange)="brightness.set(+$event)" />
                      <span class="mono">{{ brightness() }}%</span>
                      <label for="contrast">Contrast</label>
                      <input id="contrast" type="range" min="50" max="200" step="5" [ngModel]="contrast()" (ngModelChange)="contrast.set(+$event)" />
                      <span class="mono">{{ contrast() }}%</span>
                      <label for="saturation">Saturation</label>
                      <input id="saturation" type="range" min="0" max="250" step="5" [ngModel]="saturation()" (ngModelChange)="saturation.set(+$event)" />
                      <span class="mono">{{ saturation() }}%</span>
                    </div>
                  </fieldset>
                  <fieldset class="item-sizes">
                    <legend>Framing</legend>
                    <div class="grade">
                      <label for="zoom">Zoom</label>
                      <input id="zoom" type="range" min="50" max="300" step="5" [ngModel]="footageZoom()" (ngModelChange)="footageZoom.set(+$event)" />
                      <span class="mono">{{ footageZoom() }}%</span>
                    </div>
                  </fieldset>
                  <div class="layout-actions">
                    <button class="btn small step" type="button" (click)="resetFootage()" [disabled]="!footageAdjusted()" aria-label="Reset the flight footage's picture and framing" title="Reset the flight footage's picture and framing"><app-icon name="reset" /></button>
                  </div>
                }

                @case ('cam') {
                  <p class="mono">{{ audioName() }}</p>
                  <fieldset class="item-sizes">
                    <legend>Picture</legend>
                    <div class="grade">
                      <label for="cam-brightness">Brightness</label>
                      <input id="cam-brightness" type="range" min="50" max="200" step="5" [ngModel]="camBrightness()" (ngModelChange)="camBrightness.set(+$event)" />
                      <span class="mono">{{ camBrightness() }}%</span>
                      <label for="cam-contrast">Contrast</label>
                      <input id="cam-contrast" type="range" min="50" max="200" step="5" [ngModel]="camContrast()" (ngModelChange)="camContrast.set(+$event)" />
                      <span class="mono">{{ camContrast() }}%</span>
                      <label for="cam-saturation">Saturation</label>
                      <input id="cam-saturation" type="range" min="0" max="250" step="5" [ngModel]="camSaturation()" (ngModelChange)="camSaturation.set(+$event)" />
                      <span class="mono">{{ camSaturation() }}%</span>
                    </div>
                  </fieldset>
                  <fieldset class="item-sizes">
                    <legend>Framing</legend>
                    <div class="grade">
                      <label for="cam-zoom">Zoom</label>
                      <input id="cam-zoom" type="range" min="50" max="300" step="5" [ngModel]="camZoom()" (ngModelChange)="camZoom.set(+$event)" />
                      <span class="mono">{{ camZoom() }}%</span>
                      <label for="cam-pan-x">Left/right</label>
                      <input id="cam-pan-x" type="range" min="-50" max="50" step="1" [ngModel]="camPanX()" (ngModelChange)="camPanX.set(+$event)" />
                      <span class="mono">{{ camPanX() }}%</span>
                      <label for="cam-pan-y">Up/down</label>
                      <input id="cam-pan-y" type="range" min="-50" max="50" step="1" [ngModel]="camPanY()" (ngModelChange)="camPanY.set(+$event)" />
                      <span class="mono">{{ camPanY() }}%</span>
                    </div>
                  </fieldset>
                  <div class="layout-actions">
                    <button class="btn small step" type="button" (click)="resetCam()" [disabled]="!camAdjusted()" aria-label="Reset the stick cam's picture and framing" title="Reset the stick cam's picture and framing"><app-icon name="reset" /></button>
                  </div>
                }

                @default {
                  @if (inspected() === 'title') {
                    <fieldset class="item-sizes labels">
                      <legend>Text</legend>
                      <div class="label-row">
                        <label for="title-text" class="sr-only">Title</label>
                        <input id="title-text" type="text" maxlength="60" placeholder="Title, e.g. BRIDGE" [ngModel]="opts().titleText"
                               (ngModelChange)="setLabel('titleText', $event)" />
                        <input type="color" aria-label="Title colour" [ngModel]="opts().titleColor" (ngModelChange)="setLabel('titleColor', $event)" />
                      </div>
                      <div class="label-row">
                        <label for="title-accent" class="sr-only">Second part of the title</label>
                        <input id="title-accent" type="text" maxlength="60" placeholder="Second part, e.g. BOI" [ngModel]="opts().titleAccentText"
                               (ngModelChange)="setLabel('titleAccentText', $event)" />
                        <input type="color" aria-label="Second part colour" [ngModel]="opts().titleAccentColor" (ngModelChange)="setLabel('titleAccentColor', $event)" />
                      </div>
                      <div class="label-row">
                        <span>Outline</span>
                        <input type="color" aria-label="Title outline colour" [ngModel]="opts().titleStrokeColor" (ngModelChange)="setLabel('titleStrokeColor', $event)" />
                        <label class="check"><input type="checkbox" [ngModel]="!!opts().titleBgColor"
                               (ngModelChange)="setLabel('titleBgColor', $event ? '#000000' : '')" /> Box behind it</label>
                        @if (opts().titleBgColor) {
                          <input type="color" aria-label="Title box colour" [ngModel]="opts().titleBgColor" (ngModelChange)="setLabel('titleBgColor', $event)" />
                        }
                      </div>
                    </fieldset>
                  }
                  @if (inspected() === 'craft') {
                    <fieldset class="item-sizes labels">
                      <legend>Text</legend>
                      <div class="label-row">
                        <label for="craft-text" class="sr-only">Craft name</label>
                        <input id="craft-text" type="text" maxlength="60" placeholder="Craft name, e.g. FLYFISH VOLADOR VX 3.5" [ngModel]="opts().craftText"
                               (ngModelChange)="setLabel('craftText', $event)" />
                        <input type="color" aria-label="Craft name colour" [ngModel]="opts().craftColor" (ngModelChange)="setLabel('craftColor', $event)" />
                      </div>
                      <div class="label-row">
                        <span>Outline</span>
                        <input type="color" aria-label="Craft name outline colour" [ngModel]="opts().craftStrokeColor"
                               (ngModelChange)="setLabel('craftStrokeColor', $event)" />
                      </div>
                    </fieldset>
                  }

                  @if (current(); as c) {
                    @if (c.key === inspected()) {
                      <fieldset class="item-sizes">
                        <legend>Position and size</legend>
                        <p class="hint">Or drag it on the preview. Positions are its centre.</p>
                        <div class="grade">
                          <label for="el-size">Size</label>
                          <input id="el-size" type="range" [min]="scaleMin" [max]="scaleMax" step="0.05" [ngModel]="c.scale"
                                 (ngModelChange)="updatePlacement('scale', +$event)" />
                          <span class="mono">{{ (c.scale * 100).toFixed(0) }}%</span>
                          <label for="el-x">Across</label>
                          <input id="el-x" type="range" min="0" max="1" step="0.005" [ngModel]="c.x" (ngModelChange)="updatePlacement('x', +$event)" />
                          <span class="mono">{{ (c.x * 100).toFixed(0) }}%</span>
                          <label for="el-y">Down</label>
                          <input id="el-y" type="range" min="0" max="1" step="0.005" [ngModel]="c.y" (ngModelChange)="updatePlacement('y', +$event)" />
                          <span class="mono">{{ (c.y * 100).toFixed(0) }}%</span>
                        </div>
                      </fieldset>
                      @if (items[c.key]; as list) {
                        <fieldset class="item-sizes">
                          <legend>Text sizes</legend>
                          <div class="grade">
                            @for (it of list; track it.key) {
                              <label [for]="'item-' + it.key">{{ it.label }}</label>
                              <input [id]="'item-' + it.key" type="range" [min]="itemMin" [max]="itemMax" step="0.05"
                                     [ngModel]="itemScale(it.key)" (ngModelChange)="setItemScale(it.key, +$event)" />
                              <span class="mono">{{ (itemScale(it.key) * 100).toFixed(0) }}%</span>
                            }
                          </div>
                        </fieldset>
                      }
                      @if (c.key === 'sticks') {
                        <fieldset class="item-sizes">
                          <legend>Sticks</legend>
                          <div class="label-row">
                            <label for="mode">Stick mode</label>
                            <select id="mode" [ngModel]="opts().stickMode" (ngModelChange)="setStickMode(+$event)">
                              @for (m of [1, 2, 3, 4]; track m) { <option [value]="m">Mode {{ m }}</option> }
                            </select>
                          </div>
                          <label class="check"><input type="checkbox" [ngModel]="opts().stickTrails" (ngModelChange)="set('stickTrails', $event)" /> Trails (motion blur)</label>
                          <div class="grade">
                            <label for="trail-intensity">Trail strength</label>
                            <input id="trail-intensity" type="range" min="0.25" max="2" step="0.05" [ngModel]="opts().stickTrailIntensity"
                                   (ngModelChange)="setTrailIntensity(+$event)" [disabled]="!opts().stickTrails" />
                            <span class="mono">{{ (opts().stickTrailIntensity * 100).toFixed(0) }}%</span>
                          </div>
                        </fieldset>
                        <fieldset class="item-sizes">
                          <legend>Colours</legend>
                          <div class="colors">
                            <label class="color"><input type="color" [ngModel]="opts().stickDotColor" (ngModelChange)="setColor('stickDotColor', $event)" /> Dot</label>
                            <label class="color"><input type="color" [ngModel]="opts().stickTrailColor" (ngModelChange)="setColor('stickTrailColor', $event)"
                                   [disabled]="!opts().stickTrails" /> Trail</label>
                            <label class="color"><input type="color" [ngModel]="opts().stickBoxColor" (ngModelChange)="setColor('stickBoxColor', $event)" /> Background</label>
                            <label class="color"><input type="color" [ngModel]="opts().stickCrossColor" (ngModelChange)="setColor('stickCrossColor', $event)" /> Crosshair</label>
                            <button class="btn small step" type="button" (click)="resetColors(stickColors)" aria-label="Reset the stick colours" title="Reset the stick colours"><app-icon name="reset" /></button>
                          </div>
                        </fieldset>
                      }
                      @if (c.key === 'rssi' && hasBaro() && data().track) {
                        <fieldset class="item-sizes">
                          <legend>Height</legend>
                          <div class="field">
                            <label for="alt-source">Height from</label>
                            <select id="alt-source" [ngModel]="opts().altSource" (ngModelChange)="set('altSource', $event)">
                              <option value="gps">GPS (matches the flight stats)</option>
                              <option value="baro">Barometer (smoother)</option>
                            </select>
                          </div>
                        </fieldset>
                      }
                      @if (c.key === 'map') {
                        <fieldset class="item-sizes">
                          <legend>Colours</legend>
                          <div class="colors">
                            <label class="color"><input type="color" [ngModel]="opts().pathRecentColor" (ngModelChange)="setColor('pathRecentColor', $event)" /> Recent path</label>
                            <label class="color"><input type="color" [ngModel]="opts().pathOldColor" (ngModelChange)="setColor('pathOldColor', $event)" /> Older path</label>
                            <button class="btn small step" type="button" (click)="resetColors(pathColors)" aria-label="Reset the map colours" title="Reset the map colours"><app-icon name="reset" /></button>
                          </div>
                        </fieldset>
                      }
                      <div class="layout-actions">
                        <button class="btn small step" type="button" (click)="resetElement(c.key)" [disabled]="!isCustom(c.key)" [attr.aria-label]="'Reset the ' + labels[c.key].toLowerCase() + ': position, size and text sizes'" [title]="'Reset the ' + labels[c.key].toLowerCase() + ': position, size and text sizes'"><app-icon name="reset" /></button>
                      </div>
                    }
                  }
                  @if ((inspected() === 'title' && !hasTitle()) || (inspected() === 'craft' && !hasCraft())) {
                    <p class="hint">Type some text to place it; then it can be moved and resized here.</p>
                  }
                }
              }
            </fieldset>
          </section>

          <section class="panel options" aria-labelledby="options-heading">
            <h2 id="options-heading">Options</h2>
            <!-- What the preview plays and draws with: the backdrop and the three files. None of the files is uploaded, and only
                 the font goes into the overlay; footage and sound only reach the finished video. One row per source: its icon
                 (hover for what it is), the file, then its actions. -->
            <div class="panel field sources" role="group" aria-labelledby="sources-label">
              <span class="field-label" id="sources-label">Sources</span>
              <div class="toggles" role="group" aria-label="Preview backdrop">
                @for (b of backdrops; track b.value) {
                  <button class="btn small step" type="button" [class.btn-primary]="backdrop() === b.value" [attr.aria-pressed]="backdrop() === b.value"
                          [attr.aria-label]="b.label" [title]="'Preview backdrop: ' + b.label + (b.value === 'video' && !videoUrl() ? ' (load your footage first)' : '')"
                          [disabled]="b.value === 'video' && !videoUrl()" (click)="setBackdrop(b.value)"><app-icon [name]="b.icon" /></button>
                }
              </div>

              <div class="source-row">
                <span title="Flight footage: your FPV video, played behind the preview and used for the finished video"><app-icon name="film" /></span>
                <span class="sr-only">Flight footage:</span>
                <span class="mono" [title]="videoName() || 'No footage loaded'">{{ videoName() || 'No footage' }}</span>
                <label class="btn small step" [title]="videoUrl() ? 'Change the flight footage' : 'Load your flight footage'">
                  <app-icon name="folder" />
                  <input class="sr-only" type="file" accept="video/*" [attr.aria-label]="videoUrl() ? 'Change the flight footage' : 'Load your flight footage'"
                         (change)="onVideoFile($event)" />
                </label>
                @if (hasVideo()) {
                  <button class="btn small step" type="button" (click)="selectMedia('footage')" aria-label="Adjust the footage's picture" title="Adjust the footage's picture"><app-icon name="sliders" /></button>
                }
              </div>

              <div class="source-row">
                <span title="Sound track: a phone recording or stick cam video, for its sound (and a stick cam's picture)"><app-icon name="volume" /></span>
                <span class="sr-only">Sound track:</span>
                <span class="mono" [title]="audioName() || 'No sound track loaded'">{{ audioUrl() ? audioName() : 'No sound track' }}</span>
                <label class="btn small step" [title]="audioUrl() ? 'Change the sound track' : 'Load a sound track'">
                  <app-icon name="folder" />
                  <input class="sr-only" type="file" accept="audio/*,video/*" [attr.aria-label]="audioUrl() ? 'Change the sound track' : 'Load a sound track'"
                         (change)="onAudioFile($event)" />
                </label>
                @if (audioUrl()) {
                  @if (hasCam()) {
                    <button class="btn small step" type="button" (click)="selectMedia('cam')" aria-label="Adjust the stick cam's picture" title="Adjust the stick cam's picture"><app-icon name="sliders" /></button>
                  }
                  <button class="btn small step" type="button" (click)="removeAudio()" aria-label="Remove the sound track" title="Remove the sound track"><app-icon name="trash" /></button>
                }
              </div>

              <div class="source-row">
                <span title="OSD font: your goggles' Betaflight font (font_bf.bin is sharpest) for the real OSD look; the built-in font otherwise"><app-icon name="font" /></span>
                <span class="sr-only">OSD font:</span>
                @if (font(); as fnt) {
                  <span class="mono" [title]="fnt.name + ', ' + fnt.glyphW + '×' + fnt.glyphH + ' glyphs'">{{ fnt.name }}</span>
                } @else {
                  <span class="mono" title="The built-in font. Load your goggles' Betaflight font (font_bf.bin) for the real OSD look.">Built-in font</span>
                }
                <label class="btn small step" [title]="font() ? 'Change the OSD font' : 'Load the Betaflight font from your goggles (.bin)'">
                  <app-icon name="folder" />
                  <input class="sr-only" type="file" accept=".bin" [attr.aria-label]="font() ? 'Change the OSD font' : 'Load an OSD font'" (change)="onFont($event)" [disabled]="busy()" />
                </label>
                @if (font()) {
                  <button class="btn small step" type="button" (click)="clearFont()" [disabled]="busy()" aria-label="Remove the font" title="Remove the font: back to the built-in one"><app-icon name="trash" /></button>
                }
              </div>
              @if (fontError()) { <p class="error">{{ fontError() }}</p> }
            </div>
            <!-- What's drawn: one icon toggle per part of the HUD, lit when on. Flight time is always in the battery panel. -->
            <div class="panel field" role="group" aria-labelledby="show-label">
              <span class="field-label" id="show-label">Show</span>
              <div class="toggles">
                @for (t of showToggles(); track t.key) {
                  <button class="btn small step" type="button" [class.btn-primary]="opts()[t.key]" [attr.aria-pressed]="opts()[t.key]"
                          [attr.aria-label]="t.label" [title]="t.label + (t.available ? '' : ' (not in this log)')" [disabled]="busy() || !t.available"
                          (click)="toggleShow(t.key)"><app-icon [name]="t.icon" /></button>
                }
                <!-- In vertical, a video sound track (a stick cam) can show its picture too; preview and finished video only. -->
                @if (vertical() && audioUrl() && audioIsVideo()) {
                  <button class="btn small step" type="button" [class.btn-primary]="showPip()" [attr.aria-pressed]="showPip()" aria-label="Stick cam picture"
                          title="Stick cam picture in the bottom half, from your sound track video"
                          (click)="showPip.set(!showPip())"><app-icon name="pip" /></button>
                }
                @if (opts().showStats) {
                  <span class="stats-time" title="After the log ends: a {{ gapMs }} ms blank, then the stats for this long. Drag the preview past the end to see them.">
                    <label for="stats-seconds">Stats</label>
                    <input id="stats-seconds" type="number" min="0.5" max="30" step="0.5" [ngModel]="statsSeconds()"
                           (ngModelChange)="setStatsSeconds(+$event)" [disabled]="busy()" />
                    <span>s</span>
                  </span>
                }
              </div>
              <div class="grade" title="The dark box behind the speed, battery and RSSI panels and the stats screen; 0% for none">
                <label for="opacity">Panels</label>
                <input id="opacity" type="range" min="0" max="0.8" step="0.05" [ngModel]="opts().panelOpacity"
                       (ngModelChange)="set('panelOpacity', +$event)" [disabled]="busy()" />
                <span class="mono">{{ (opts().panelOpacity * 100).toFixed(0) }}%</span>
              </div>
            </div>
            <!-- What gets made, for both exports: shape (icons), size and frame rate (chips, since numbers say it better than any
                 icon). Hover any button for the details. -->
            <div class="panel field" role="group" aria-labelledby="output-label">
              <span class="field-label" id="output-label">Output</span>
              <div class="toggles" role="group" aria-label="Format">
                <button class="btn small step" type="button" [class.btn-primary]="!vertical()" [attr.aria-pressed]="!vertical()" aria-label="Landscape 16:9"
                        title="Landscape 16:9, for YouTube" [disabled]="busy()" (click)="setVertical(false)"><app-icon name="landscape" /></button>
                <button class="btn small step" type="button" [class.btn-primary]="vertical()" [attr.aria-pressed]="vertical()" aria-label="Vertical 9:16"
                        title="Vertical 9:16, for Shorts, Reels and TikTok: its own layout, with your footage on top, the stick cam below and the OSD over it"
                        [disabled]="busy()" (click)="setVertical(true)"><app-icon name="portrait" /></button>
              </div>
              <div class="toggles" role="group" aria-label="Resolution">
                @for (r of resolutions(); track r.label; let i = $index) {
                  <button class="btn small step" type="button" [class.btn-primary]="resIndex() === i" [attr.aria-pressed]="resIndex() === i"
                          [title]="'Resolution: ' + r.label" [disabled]="busy()" (click)="resIndex.set(i)">{{ r.label.split(' ')[0] }}</button>
                }
              </div>
              <div class="toggles" role="group" aria-label="Frame rate"
                   [title]="footageFps() ? 'Your footage is ' + fpsLabel(footageFps()!) + ' fps' + (footageFps()! >= 100 ? ', so 60, as high as YouTube goes' : '') : 'Loading your footage sets this to match it'">
                @for (r of fpsOptions(); track r) {
                  <button class="btn small step" type="button" [class.btn-primary]="fps() === r" [attr.aria-pressed]="fps() === r"
                          [attr.aria-label]="fpsLabel(r) + ' fps'" [disabled]="busy()" (click)="fps.set(r)">{{ fpsLabel(r) }}</button>
                }
                <span class="hint">fps</span>
              </div>
              @if (footageFps(); as src) {
                @if (fps() !== outputFrameRate(src)) {
                  <button class="link" type="button" (click)="fps.set(outputFrameRate(src))" [title]="'Your footage is ' + fpsLabel(src) + ' fps'">
                    Match your footage ({{ fpsLabel(outputFrameRate(src)) }} fps)</button>
                }
              }
            </div>
            <!-- Rendering, full width under the three boxes: the transparent overlay for an editor and the finished video side
                 by side with the video's fade, then one progress bar for whichever is running. Their ranges are set under the
                 preview (the Export marks and the Render slider); hover a button for the details. -->
            <div class="panel field export" role="group" aria-labelledby="export-label">
              <span class="field-label" id="export-label">Export</span>
              <div class="toggles">
                <div class="toggles" role="group" aria-label="Export">
                  <button class="btn btn-primary small" type="button" (click)="exportVideo()" [disabled]="busy() || rendering() || frameCount() === 0"
                          [title]="overlayHover()"><app-icon name="layers" /> Overlay .mov</button>
                  @if (hasVideo()) {
                    <button class="btn btn-primary small" type="button" (click)="renderFinished()"
                            [disabled]="busy() || rendering() || renderEnd() <= renderStart()" [title]="finishedHover()"><app-icon name="film" /> Video .mp4</button>
                  }
                </div>
                @if (hasVideo()) {
                  <div class="toggles">
                    <button class="btn small step" type="button" [class.btn-primary]="fadeOut() > 0" [attr.aria-pressed]="fadeOut() > 0" aria-label="Fade out"
                            title="Fade out: the video's picture fades to black and its sound to silence at the end" [disabled]="rendering()"
                            (click)="setFadeOut(fadeOut() > 0 ? 0 : 1.5)"><app-icon name="fade" /></button>
                    @if (fadeOut() > 0) {
                      <span class="stats-time" title="How long the fade out takes">
                        <label class="sr-only" for="fade-seconds">Fade length in seconds</label>
                        <input id="fade-seconds" type="number" min="0.5" max="10" step="0.5" [ngModel]="fadeOut()" (ngModelChange)="setFadeOut(+$event)"
                               [disabled]="rendering()" />
                        <span>s</span>
                      </span>
                    }
                  </div>
                }
              </div>
              @if (busy() || rendering()) {
                <!-- One progress bar for whichever is running. The video's has no value until its first frame (sound and the
                     first frames load first), so it shows as busy rather than stuck at zero. -->
                <div class="progress" role="status" aria-live="polite">
                  @if (busy()) {
                    <progress [value]="done()" [max]="frameCount()"></progress>
                    <span class="mono">Overlay: {{ done() }} / {{ frameCount() }}{{ eta() ? ', about ' + eta() + ' left' : '' }}</span>
                  } @else {
                    <progress [attr.value]="renderTotal() ? renderDone() : null" [max]="renderTotal() || 1"></progress>
                    <span class="mono">{{ renderStage() }}{{ renderEta() ? ' About ' + renderEta() + ' left.' : '' }}</span>
                  }
                </div>
                <button class="btn small" type="button" (click)="busy() ? cancel() : cancelRender()">Cancel</button>
              } @else if (renderStage()) {
                <p class="hint" role="status">{{ renderStage() }}</p>
              }
              @if (!toDisk && estimatedBytes() > 2e9) {
                <p class="error">The overlay is a lot to hold in memory in this browser. Trim it, lower the resolution, or use Chrome or Edge.</p>
              }
              @if (message()) { <p class="note" role="status">{{ message() }}</p> }
              @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
              @if (renderMessage()) { <p class="note" role="status">{{ renderMessage() }}</p> }
              @if (renderError()) { <p class="error" role="alert">{{ renderError() }}</p> }
            </div>
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
    /* Premiere-style, in both formats: the component panel left of the preview and Options along the bottom; a narrow
       window stacks everything. */
    .layout { display: grid; grid-template: "inspector preview" auto "options options" auto / 19rem minmax(0, 1fr); gap: 1rem; align-items: start; margin: 1rem 0; }
    .preview-panel { grid-area: preview; } .inspector { grid-area: inspector; } .options { grid-area: options; }
    @media (max-width: 60rem) { .layout { grid-template: "preview" "inspector" "options" / 1fr; } }
    /* Options: its sub-panels side by side, three across (one under the other on narrow windows), each the full height
       of the row with its contents from the top. */
    .options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
    .options > h2 { grid-column: 1 / -1; margin: 0; }
    .options > .panel { margin: 0; align-content: start; }
    .options > .export { grid-column: 1 / -1; justify-items: center; text-align: center; }
    .export .toggles { justify-content: center; }
    @media (max-width: 60rem) { .options { grid-template-columns: 1fr; } }
    .inspector-head { display: flex; justify-content: space-between; align-items: baseline; }
    .inspector-body { min-width: 0; }
    .panel h2 { margin-bottom: .75rem; }
    /* Checkerboard shows which parts are transparent. */
    .stage { position: relative; border-radius: 8px; overflow: hidden; border: 1px solid var(--line);
             background: repeating-conic-gradient(#c9d1d9 0 25%, #eef2f6 0 50%) 0 0 / 24px 24px; }
    .stage.dark { background: linear-gradient(180deg, #4b6a88, #2b3a2b); }
    .preview-help { margin: .75rem 0 0; font-size: .88rem; line-height: 1.5; display: grid; gap: .5rem; }
    .preview-help p { margin: 0; }
    /* Video and overlay share one 16:9 frame, so they stay lined up at any size, full screen included. */
    .frame { position: relative; aspect-ratio: 16 / 9; }
    .frame canvas { position: relative; z-index: 1; }
    .bg-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: #000; }
    .bg-video.fit { object-fit: contain; }
    /* Vertical: a tall frame, no taller than most of the window, centred in the preview panel. */
    .stage.vertical { width: min(100%, calc(78vh * 9 / 16)); margin-inline: auto; }
    .stage.vertical .frame { aspect-ratio: 9 / 16; }
    .stage.vertical:fullscreen { width: 100%; }
    .stage.vertical:fullscreen .frame { width: min(100vw, calc(100vh * 9 / 16)); }
    .footage-box { position: absolute; inset: 0; overflow: hidden; background: #000; }
    /*
     * Vertical is a split screen in three layers: the stick cam at the back (below the split), the flight footage over
     * it (above), and the HUD on top. The split sits 53.7% down, as on a real Short. Neither video is clipped to its
     * part, so zooming or panning one into the other's overlaps it, with the footage always in front. The stage clips
     * both at the frame's edges.
     */
    .stage.vertical .footage-box { bottom: 46.3%; overflow: visible; background: none; z-index: 1; }
    .stage.vertical:has(.footage-box) .frame { background: #000; }
    .stage.vertical .frame canvas { z-index: 2; }
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
    /* Above the overlay but out of its way: clicks go through to the canvas, so elements under it can still be dragged. */
    /* The whole picture, never cropped to the box; Zoom and Pan frame it from there. */
    .pip video { width: 100%; height: 100%; object-fit: contain; display: block; }
    /* The stick cam (vertical only): the bottom of the split screen, under the footage and the HUD. */
    .pip { position: absolute; inset: 53.7% 0 0 0; z-index: 0; pointer-events: none; background: #000; }
    .pip.hidden { display: none; }
    /* Both sliders' labels share a width so the two bars line up. */
    .scrub-label { font-weight: 600; font-size: .92rem; flex: 0 0 7.5rem; }
    .video-sync { display: grid; gap: .5rem; margin-top: .6rem; font-size: .92rem; justify-items: start; }
    .playback-row { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .6rem; }
    .video-sync .offset { display: flex; align-items: center; gap: .4rem; flex-wrap: wrap; }
    .video-sync .offset label { font-weight: 600; }
    .video-sync .offset input { width: 5.5rem; }
    .audio-claps { display: grid; gap: .4rem; justify-self: stretch; }
    .audio-panel .video-scrub, .audio-panel .sound-profile { justify-self: stretch; margin-top: 0; }
    .clap-field { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .6rem; }
    .clap-field label, .clap-label { font-weight: 600; }
    .clap-field select { width: auto; }
    .sound-profile { margin: 0; display: grid; gap: .25rem; }
    .sound-profile figcaption { display: flex; justify-content: space-between; gap: .75rem; font-size: .82rem; color: var(--muted); }
    .sound-profile svg { display: block; width: 100%; height: 64px; background: var(--raised); border: 1px solid var(--line);
                         border-radius: 6px; cursor: pointer; }
    .sound-profile .level { fill: var(--chart-area); stroke: var(--chart-line); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
    .sound-profile .mark { stroke-width: 1.5; vector-effect: non-scaling-stroke; }
    .sound-profile .mark.chosen { stroke-width: 2.5; }
    .sound-profile .clap, .profile-key .clap { stroke: var(--warn); border-color: var(--warn); stroke-dasharray: 4 3; }
    .sound-profile .arm, .profile-key .arm { stroke: var(--accent); border-color: var(--accent); }
    .sound-profile .now, .profile-key .now { stroke: var(--ink); border-color: var(--ink); }
    .profile-key { display: flex; flex-wrap: wrap; gap: .25rem 1rem; font-size: .8rem; color: var(--muted); }
    .profile-key span { display: inline-flex; align-items: center; gap: .35rem; }
    .key { display: inline-block; width: 0; height: .9rem; border-left: 2px solid; }
    .key.clap { border-left-style: dashed; }
    .sync-buttons { display: flex; flex-wrap: nowrap; gap: .5rem; white-space: nowrap; }
    canvas { display: block; width: 100%; height: auto; touch-action: none; } /* dragging an element shouldn't scroll the page on touch screens */
    /* The footage and overlay sliders share one look so they read as a pair. */
    .scrub, .video-scrub { display: flex; align-items: center; gap: .5rem; margin-top: .6rem; font-size: .92rem; }
    .scrub input[type=range], .video-scrub input[type=range] { flex: 1 1 10rem; min-width: 0; }
    .scrub .step, .video-scrub .step { padding: .2rem .55rem; line-height: 1; }
    .scrub .mono, .video-scrub .mono { min-width: 4.6rem; text-align: right; }
    .scrub-track { position: relative; flex: 1 1 10rem; min-width: 0; display: flex; }
    .scrub-track input[type=range] { width: 100%; }
    .window-bar { position: absolute; bottom: -3px; height: 4px; border-radius: 2px; background: var(--accent); opacity: .85; pointer-events: none; }
    .export-window { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem .6rem; margin-top: .5rem; font-size: .92rem; }
    input[type=range] { accent-color: var(--accent); }
    .item-sizes { margin: .6rem 0 0; padding: .5rem 0 0; border: 0; border-top: 1px solid var(--line); }
    .item-sizes legend { font-weight: 600; font-size: .92rem; padding: 0; }
    .toggles { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem; }
    .stats-time { display: inline-flex; align-items: center; gap: .3rem; font-size: .88rem; }
    .stats-time input { width: 3.8rem; }
    .layout-actions { display: flex; gap: 1.25rem; flex-wrap: wrap; margin-top: .4rem; font-size: .92rem; }
    .check { display: flex; align-items: center; justify-content: flex-start; gap: .45rem; font-weight: normal; margin: .2rem 0; }
    /* The site-wide .field input rule makes inputs full width; checkboxes shouldn't be. */
    .check input { width: auto; margin: 0; }
    .colors { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem 1rem; margin: .2rem 0 .3rem; font-size: .92rem; }
    .color { display: inline-flex; align-items: center; gap: .4rem; }
    /* Colour wells: override the site-wide full-width input rule. */
    .color input, .label-row input[type=color] { width: 2.2rem; height: 1.6rem; padding: 0; border: 1px solid var(--line); border-radius: 6px; background: none; cursor: pointer; }
    .color input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    fieldset { border: 0; padding: 0; margin: 0 0 1rem; }
    legend { font-weight: 600; margin-bottom: .2rem; }
    .progress { display: grid; gap: .3rem; margin: .5rem 0; }
    progress { width: 100%; accent-color: var(--accent); }
    .note { color: var(--ok); margin: .6rem 0 0; }
    .field-label { font-weight: 600; }
    .source-row { margin: 0; display: flex; gap: .5rem; align-items: baseline; flex-wrap: wrap; }
    .labels { display: grid; gap: .4rem; }
    .label-row { display: flex; align-items: center; gap: .5rem; }
    .label-row input[type=text] { flex: 1; min-width: 0; }
    .footage-box.selected, .pip.selected { outline: 3px solid var(--accent); outline-offset: -3px; }
    .grade { display: grid; grid-template-columns: auto 1fr 3.2rem; align-items: center; gap: .35rem .6rem; margin: .4rem 0 .1rem; font-size: .92rem; }
    .grade input[type=range] { width: 100%; min-width: 0; }
    .grade .mono { text-align: right; font-size: .82rem; }
    .sources .source-row { flex-wrap: nowrap; align-items: center; }
    .source-row .mono { font-size: .82rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .small { padding: .3rem .75rem; font-size: .88rem; justify-self: start; }
    .link { background: none; border: 0; padding: 0; font: inherit; color: var(--accent); text-decoration: underline; cursor: pointer; }
    .howto ol { margin: 0; padding-left: 1.25rem; display: grid; gap: .35rem; }
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
  /** The pilot's footage, picked here or by the page above; either way it plays behind the preview. */
  video = model<File | null>(null);
  /** A sound track from a second recording (the phone), shared with the page the same way. */
  sound = model<File | null>(null);

  private canvas = viewChild<ElementRef<HTMLCanvasElement>>('preview');

  /** The usual rates, plus whatever the footage or a pick added (29.97, 23.976...). */
  fpsOptions = computed(() => [...new Set([...FPS, this.fps()])].sort((a, b) => a - b));
  /** The loaded footage's measured frame rate; null until known. */
  footageFps = signal<number | null>(null);
  readonly fpsLabel = fpsLabel;
  readonly outputFrameRate = outputFrameRate;
  readonly toDisk = canSaveToDisk();
  readonly clock = clock;

  font = signal<GlyphFont | null>(null);
  fontError = signal('');
  private renderer = computed(() => new OverlayRenderer(this.data()));
  hasRssi = computed(() => this.data().telemetry?.some(p => p[1] !== null) ?? false);
  hasBaro = computed(() => this.data().telemetry?.some(p => p[2] !== null) ?? false);

  /** New data (another flight or session) resets the range to the whole flight. */
  private range = computed(() => ({ data: this.data(), seconds: this.seconds() }));
  /** Vertical 9:16 output for Shorts, Reels and TikTok instead of landscape 16:9. */
  vertical = signal(readVertical());
  resolutions = computed(() => (this.vertical() ? VERTICAL_RESOLUTIONS : RESOLUTIONS));
  /** The preview canvas is drawn at 1080p in the chosen shape; placements are fractions, so this is only for pointer maths. */
  previewW = computed(() => (this.vertical() ? 1080 : 1920));
  previewH = computed(() => (this.vertical() ? 1920 : 1080));
  resIndex = signal(0);
  fps = signal(30);
  start = linkedSignal({ source: this.range, computation: () => 0 });
  end = linkedSignal({ source: this.range, computation: r => r.seconds });
  opts = signal<OverlayOptions>({
    showSticks: true, stickTrails: true, showSpeed: !this.vertical(), showBattery: true, showMap: !this.vertical(), showRssi: !this.vertical(),
    showTitle: this.vertical(), showCraft: this.vertical(), altSource: 'gps', showStats: true, statsAfter: 0, flightSeconds: 0,
    ...readColors(), ...readLabels(), stickTrailIntensity: readTrailIntensity(),
    stickMode: readStickMode(), panelOpacity: this.vertical() ? 0 : 0.35, font: null, speedUnit: 'kmh', layout: readLayout(this.vertical()), itemScale: readItemScales(),
  });
  private units = inject(UnitsService);

  // ---- layout editing ----
  readonly labels = ELEMENT_LABELS;
  readonly scaleMin = SCALE_MIN;
  readonly scaleMax = SCALE_MAX;
  /** Elements currently drawn, with their boxes on the 1080p preview. */
  placed = computed(() => this.renderer().placements(this.previewW(), this.previewH(), this.opts()));
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
    return p ? { key: p.key, x: (p.x + p.w / 2) / this.previewW(), y: (p.y + p.h / 2) / this.previewH(), scale: p.scale } : null;
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
  /** Width over height of the footage, once it has loaded. */
  videoAspect = signal(16 / 9);
  /** 4:3 footage (O4 at 4:3, older cams) is shown whole in the middle of the 16:9 preview, with black bars at the sides. */
  footage43 = computed(() => this.videoAspect() < 1.5);
  /** Preview-only colour for the footage, in percent (100 = as recorded); starts a little punchier than recorded. */
  brightness = signal(FOOTAGE_DEFAULTS.brightness);
  contrast = signal(FOOTAGE_DEFAULTS.contrast);
  saturation = signal(FOOTAGE_DEFAULTS.saturation);
  /** Preview-only zoom of the footage inside its box, in percent. */
  footageZoom = signal(FOOTAGE_DEFAULTS.zoom);
  footageFilter = computed(() => gradeFilter(this.brightness(), this.contrast(), this.saturation()));
  footageAdjusted = computed(() =>
    this.brightness() !== FOOTAGE_DEFAULTS.brightness || this.contrast() !== FOOTAGE_DEFAULTS.contrast
    || this.saturation() !== FOOTAGE_DEFAULTS.saturation || this.footageZoom() !== FOOTAGE_DEFAULTS.zoom);

  resetFootage() {
    this.brightness.set(FOOTAGE_DEFAULTS.brightness);
    this.contrast.set(FOOTAGE_DEFAULTS.contrast);
    this.saturation.set(FOOTAGE_DEFAULTS.saturation);
    this.footageZoom.set(FOOTAGE_DEFAULTS.zoom);
  }

  /** The same for a stick cam's picture, plus panning; it starts zoomed in on the hands and a little darker. */
  camBrightness = signal(CAM_DEFAULTS.brightness);
  camContrast = signal(CAM_DEFAULTS.contrast);
  camSaturation = signal(CAM_DEFAULTS.saturation);
  camZoom = signal(CAM_DEFAULTS.zoom);
  /** Moves the stick cam inside its box, as a percentage of the box: + is right and down. */
  camPanX = signal(CAM_DEFAULTS.panX);
  camPanY = signal(CAM_DEFAULTS.panY);
  camFilter = computed(() => gradeFilter(this.camBrightness(), this.camContrast(), this.camSaturation()));
  camTransform = computed(() => {
    const z = this.camZoom(), x = this.camPanX(), y = this.camPanY();
    return z === 100 && x === 0 && y === 0 ? null : `translate(${x}%, ${y}%) scale(${z / 100})`;
  });
  camAdjusted = computed(() =>
    this.camBrightness() !== CAM_DEFAULTS.brightness || this.camContrast() !== CAM_DEFAULTS.contrast
    || this.camSaturation() !== CAM_DEFAULTS.saturation || this.camZoom() !== CAM_DEFAULTS.zoom
    || this.camPanX() !== CAM_DEFAULTS.panX || this.camPanY() !== CAM_DEFAULTS.panY);

  resetCam() {
    this.camBrightness.set(CAM_DEFAULTS.brightness);
    this.camContrast.set(CAM_DEFAULTS.contrast);
    this.camSaturation.set(CAM_DEFAULTS.saturation);
    this.camZoom.set(CAM_DEFAULTS.zoom);
    this.camPanX.set(CAM_DEFAULTS.panX);
    this.camPanY.set(CAM_DEFAULTS.panY);
  }
  /** The video is before arming, so the overlay isn't drawn yet. */
  beforeLog = signal(false);
  private frameRequest: number | null = null;
  private footageFile: File | null = null;
  private footageFromPage = effect(() => {
    const file = this.video();
    if (file && file !== this.footageFile) untracked(() => this.loadVideo(file));
  });
  private soundFile: File | null = null;
  private soundFromPage = effect(() => {
    const file = this.sound();
    if (file === this.soundFile) return;
    untracked(() => (file ? this.loadAudio(file) : this.removeAudio()));
  });

  // ---- sound from another recording: its own track, placed on the log ----
  private extAudio = viewChild<ElementRef<HTMLMediaElement>>('extAudio');
  /** The sound track came from a video, so in vertical its picture can show in the bottom half. */
  audioIsVideo = signal(false);
  showPip = signal(true);
  audioUrl = signal<string | null>(null);
  audioName = signal('');
  /** Claps found in the phone recording, in seconds, earliest first. */
  audioClaps = signal<number[]>([]);
  audioClapIndex = signal(0);
  /** The same clap in the flight footage, found from its audio or set by hand. */
  footageClap = signal<number | null>(null);
  footageClapAuto = signal(false);
  clapStatus = signal('');
  /** Arming and launch heard in the phone recording, which ties it to the log (and through Log starts at, to the footage). */
  audioArming = signal<ArmingMatch | null>(null);
  /** Seconds into the phone recording where the log starts: where it armed, or set by hand. */
  audioLogStart = signal(0);
  audioPlaying = signal(false);
  /**
   * Where the sound track is, in seconds into the recording. Follows the overlay; the Sound track slider moves it on its
   * own (to find arming or takeoff in it) until the overlay moves again.
   */
  soundCursor = linkedSignal(() => this.previewTime() + this.audioLogStart());
  hasVideo = computed(() => this.backdrop() === 'video' && !!this.videoUrl());
  /** Phone sound without footage on screen: it drives the preview itself. */
  audioOnly = computed(() => !!this.audioUrl() && !this.hasVideo());
  private audioFrame: number | null = null;
  audioProfile = signal<SoundProfile | null>(null);
  /** Phone-recording time under the pointer on the sound profile. */
  profileHover = signal<number | null>(null);
  profilePath = computed(() => {
    const prof = this.audioProfile();
    if (!prof) return '';
    const n = prof.levels.length, pts: string[] = [];
    for (let i = 0; i < n; i++) pts.push(`${((i + 0.5) / n * 1000).toFixed(1)},${(58 - prof.levels[i] * 54).toFixed(1)}`);
    return `M0,60 L${pts.join(' L')} L1000,60 Z`;
  });
  launchInAudio = computed(() => {
    const arm = this.audioArming(), t = this.takeoffTime();
    return arm && t !== null ? arm.logStart + t : null;
  });
  profileLabel = computed(() => {
    const arm = this.audioArming(), claps = this.audioClaps(), launch = this.launchInAudio();
    const parts = [`Loudness of ${this.audioName()} over ${preciseClock(this.audioProfile()?.duration ?? 0)}`];
    if (arm) parts.push(`arming at ${preciseClock(arm.logStart)}` + (launch !== null ? `, launch at ${preciseClock(launch)}` : ''));
    if (claps.length) parts.push(`claps at ${claps.map(c => preciseClock(c)).join(', ')}`);
    return parts.join('; ');
  });
  /** Footage time at which the sound track starts: both are placed on the log. Null without footage. */
  audioOffset = computed(() => (this.hasVideo() ? this.videoOffset() - this.audioLogStart() : null));
  audioStartText = computed(() => {
    const o = this.audioOffset();
    if (o === null) return '';
    return o >= 0 ? `${preciseClock(o)} into your footage` : `${preciseClock(-o)} before your footage`;
  });
  readonly clockOf = preciseClock;
  profileX(t: number) {
    const d = this.audioProfile()?.duration;
    return d ? (Math.min(d, Math.max(0, t)) / d) * 1000 : 0;
  }
  private profileTime(e: MouseEvent) {
    const d = this.audioProfile()?.duration ?? 0, box = (e.currentTarget as Element).getBoundingClientRect();
    return Math.min(d, Math.max(0, ((e.clientX - box.left) / box.width) * d));
  }
  hoverProfile(e: MouseEvent) { this.profileHover.set(this.profileTime(e)); }
  seekProfile(e: MouseEvent) { this.scrubSound(this.profileTime(e)); }

  /** Moves only the sound track, like the Flight footage slider moves only the footage. */
  scrubSound(t: number) {
    const d = this.audioProfile()?.duration ?? 0;
    if (this.videoPlaying() || this.audioPlaying()) this.stopVideo();
    this.soundCursor.set(Math.round(Math.min(d, Math.max(0, t)) * 1000) / 1000);
  }

  stepSound(dir: -1 | 1) { this.scrubSound(this.soundCursor() + dir / 30); }

  /** The sound track's position is arming: the log starts there, and the overlay jumps to its start. */
  soundArmingHere() {
    this.audioLogStart.set(Math.round(this.soundCursor() * 100) / 100);
    this.previewTime.set(0);
    this.seekVideoToPreview();
    this.syncAudio(true);
  }

  /** The sound track's position is the launch; the overlay jumps to the log's takeoff. */
  soundTakeoffHere() {
    const t = this.takeoffTime();
    if (t === null) return;
    this.audioLogStart.set(Math.round((this.soundCursor() - t) * 100) / 100);
    this.previewTime.set(t);
    this.seekVideoToPreview();
    this.syncAudio(true);
  }

  useHeardArming() {
    const arm = this.audioArming();
    if (arm) this.setAudioLogStart(arm.logStart);
  }

  /** Places the sound track so the chosen clap lands on the clap in the footage. */
  async syncOnClap() {
    if (this.footageClap() === null) await this.findFootageClap();
    const f = this.footageClap(), c = this.audioClaps()[this.audioClapIndex()];
    if (f === null) { this.clapStatus.set('Step Flight footage to the frame where your hands meet and press Clap is here.'); return; }
    if (c === undefined) return;
    this.clapStatus.set('');
    this.setAudioLogStart(c - (f - this.videoOffset()));
  }

  // ---- matching the footage's motor sound to the log's throttle ----
  motorStatus = signal('');
  motorMatch = signal<MotorMatch | null>(null);
  /** Needs the log's throttle and a footage file small enough to decode in the browser. */
  canMatchMotors = computed(() => (this.data().sticks?.length ?? 0) > 250 && !!this.videoUrl() && this.footageSize() <= OverlayExportComponent.MAX_DECODE_BYTES);
  private footageSize = signal(0);

  // ---- end-of-flight stats ----
  readonly gapMs = Math.round(STATS_GAP_S * 1000);
  statsSeconds = signal(2);
  /** Blank pause plus the stats screen, added after the export's end. */
  private tail = computed(() => (this.opts().showStats ? STATS_GAP_S + this.statsSeconds() : 0));
  exportSeconds = computed(() => Math.max(0, this.end() - this.start()) + this.tail());
  previewMax = computed(() => this.seconds() + this.tail());

  frameCount = computed(() => Math.max(0, Math.floor(this.exportSeconds() * this.fps())));
  /** Measured about 170 KB per 1080p frame with all elements on; scales with pixel count. */
  estimatedBytes = computed(() => this.frameCount() * 170_000 * ((this.resolutions()[this.resIndex()].w * this.resolutions()[this.resIndex()].h) / (1920 * 1080)));
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
      const audio = this.audioUrl();
      if (audio) URL.revokeObjectURL(audio);
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

  /** Title and craft name text or colour, remembered for next time. Editing one picks it, so its settings stay open. */
  setLabel(key: LabelKey, value: string) {
    this.set(key, key.endsWith('Text') ? value.slice(0, 60) : value);
    saveLabels(this.opts());
    const element = key.startsWith('craft') ? 'craft' : 'title';
    // Typing text means wanting to see it, even in 16:9 where they start hidden.
    if (key.endsWith('Text') && value.trim()) this.set(element === 'title' ? 'showTitle' : 'showCraft', true);
    this.pickElement(element);
  }

  /** A Show toggle. Turning the title or craft name on while it has no text opens its settings to type some. */
  toggleShow(key: ShowKey) {
    const on = !this.opts()[key];
    this.set(key, on);
    if (on && key === 'showTitle' && !this.hasTitle()) this.pickElement('title');
    if (on && key === 'showCraft' && !this.hasCraft()) this.pickElement('craft');
  }

  /** Picks an OSD element (outlined on the preview, its settings shown) and drops any picked video. */
  pickElement(key: ElementKey) {
    this.selected.set(key);
    this.mediaSelected.set(null);
  }

  /** The Show toggles: what each switches, its icon and hover text, and whether this log has the data for it. */
  showToggles = computed(() => {
    const d = this.data();
    const list: { key: ShowKey; icon: IconName; label: string; available: boolean }[] = [
      { key: 'showSpeed', icon: 'gauge', label: 'Speed panel: speed, height and distance', available: !!d.track },
      { key: 'showBattery', icon: 'battery', label: 'Battery panel, with the flight time', available: !!d.battery },
      { key: 'showSticks', icon: 'sticks', label: 'Sticks', available: !!d.sticks },
      { key: 'showMap', icon: 'map', label: 'Mini map', available: !!d.track },
      { key: 'showRssi', icon: 'signal', label: 'RSSI panel: satellites, RSSI, distance and height', available: this.hasRssi() || !!d.track },
      { key: 'showStats', icon: 'stats', label: 'End-of-flight stats screen', available: true },
      { key: 'showTitle', icon: 'title', label: this.hasTitle() ? 'Title' : 'Title (turn on to add one)', available: true },
      { key: 'showCraft', icon: 'craft', label: this.hasCraft() ? 'Craft name' : 'Craft name (turn on to add one)', available: true },
    ];
    return list;
  });

  hasTitle = computed(() => !!(this.opts().titleText + this.opts().titleAccentText).trim());
  hasCraft = computed(() => !!this.opts().craftText.trim());

  // ---- the component panel: the picked video or OSD element, and everything about it ----
  inspected = computed<ElementKey | 'footage' | 'cam' | null>(() => this.mediaSelected() ?? this.selected());
  inspectedLabel = computed(() => {
    const k = this.inspected();
    return k === null ? 'Components' : k === 'footage' ? 'Flight footage' : k === 'cam' ? 'Stick cam' : this.labels[k];
  });
  /** What can be picked: the videos on screen, every OSD element drawn, and the title and craft name even while empty. */
  inspectables = computed(() => {
    const list: { key: ElementKey | 'footage' | 'cam'; label: string }[] = [];
    if (this.hasFootage()) list.push({ key: 'footage', label: 'Flight footage' });
    if (this.hasCam()) list.push({ key: 'cam', label: 'Stick cam' });
    for (const p of this.placed()) if (p.key !== 'title' && p.key !== 'craft') list.push({ key: p.key, label: this.labels[p.key] });
    list.push({ key: 'title', label: this.hasTitle() ? 'Title' : 'Add title' });
    list.push({ key: 'craft', label: this.hasCraft() ? 'Craft name' : 'Add craft name' });
    return list;
  });

  inspect(key: ElementKey | 'footage' | 'cam') {
    if (key === 'footage' || key === 'cam') this.selectMedia(key);
    else this.pickElement(key);
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
    if (save) saveLayout(this.opts().layout, this.vertical());
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
    saveLayout(this.opts().layout, this.vertical());
    saveItemScales(this.opts().itemScale);
  }

  /**
   * Switches between landscape and vertical; each has its own remembered layout, so neither overwrites the other.
   * Vertical starts without the speed panel, mini map and RSSI panel (big sticks and the battery are what fit), and
   * with no panel backgrounds, so the readouts sit straight on the stick cam like a real Short. The title and craft
   * name start on there and off in landscape.
   */
  setVertical(vertical: boolean) {
    this.vertical.set(vertical);
    try { localStorage.setItem(FORMAT_KEY, vertical ? 'vertical' : 'landscape'); } catch { /* not remembered */ }
    this.selected.set(null);
    this.opts.update(o => ({ ...o, layout: readLayout(vertical), showSpeed: !vertical, showMap: !vertical, showRssi: !vertical, showTitle: vertical, showCraft: vertical,
      panelOpacity: vertical ? 0 : 0.35 }));
  }

  resetLayout() {
    this.opts.update(o => ({ ...o, layout: {}, itemScale: {} }));
    saveLayout({}, this.vertical());
    saveItemScales({});
  }

  /** Pointer position in preview canvas pixels. */
  private canvasPoint(e: PointerEvent) {
    const c = this.canvas()!.nativeElement;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.previewW(), y: ((e.clientY - r.top) / r.height) * this.previewH() };
  }

  /** Topmost element under a point (drawn last = on top). */
  private hit(x: number, y: number) {
    return [...this.placed()].reverse().find(p => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) ?? null;
  }

  onPointerDown(e: PointerEvent) {
    if (this.busy()) return;
    const pt = this.canvasPoint(e);
    const p = this.hit(pt.x, pt.y);
    if (!p) {
      // Not on an OSD element: pick the video under the pointer, so its settings show in Options.
      this.selectMedia(this.mediaAt(pt.y));
      return;
    }
    e.preventDefault();
    this.selected.set(p.key);
    this.mediaSelected.set(null);
    this.drag = { key: p.key, dx: pt.x - (p.x + p.w / 2), dy: pt.y - (p.y + p.h / 2) };
    this.dragging.set(true);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }

  onPointerMove(e: PointerEvent) {
    const pt = this.canvasPoint(e);
    if (!this.drag) { this.hoverKey.set(this.busy() ? null : this.hit(pt.x, pt.y)?.key ?? null); return; }
    let x = clamp01((pt.x - this.drag.dx) / this.previewW());
    let y = clamp01((pt.y - this.drag.dy) / this.previewH());
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
    saveLayout(this.opts().layout, this.vertical());
  }

  setStatsSeconds(v: number) {
    if (Number.isFinite(v)) this.statsSeconds.set(Math.min(30, Math.max(0.5, v)));
  }

  /** The preview backdrop toggles, with their icons and names. */
  readonly backdrops: { value: Backdrop; icon: IconName; label: string }[] = [
    { value: 'checker', icon: 'checker', label: 'Checkerboard (shows transparency)' },
    { value: 'sky', icon: 'sky', label: 'Sky' },
    { value: 'video', icon: 'film', label: 'Your video (plays with the overlay)' },
  ];

  setBackdrop(v: Backdrop) {
    this.stopVideo(); // the sound plays with whichever is driving the preview, so start again from paused
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
    if (file) this.loadVideo(file);
  }

  loadVideo(file: File) {
    this.stopVideo();
    const old = this.videoUrl();
    if (old) URL.revokeObjectURL(old);
    // Played straight from the file on this computer; nothing is uploaded.
    this.videoUrl.set(URL.createObjectURL(file));
    this.videoName.set(file.name);
    this.footageFile = file;
    this.video.set(file);
    this.videoAspect.set(16 / 9); // until the new file says otherwise
    this.footageSize.set(file.size);
    this.motorMatch.set(null);
    this.backdropError.set('');
    this.setBackdrop('video');
    this.footageClap.set(null);
    // Exports follow the footage's frame rate (60 for high-speed footage), so frames line up one to one.
    this.footageFps.set(null);
    footageFrameRate(file).then(rate => {
      if (rate === null || this.footageFile !== file) return;
      this.footageFps.set(rate);
      this.fps.set(outputFrameRate(rate));
    });
  }

  /** A sound track from a second recording: draws it, places it on the log from the arming it hears, and finds its claps. */
  onAudioFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.loadAudio(file);
  }

  async loadAudio(file: File) {
    this.soundFile = file;
    this.sound.set(file);
    const old = this.audioUrl();
    if (old) URL.revokeObjectURL(old);
    this.audioUrl.set(URL.createObjectURL(file)); // plays from this computer, like the footage
    this.audioName.set(file.name);
    this.audioIsVideo.set(file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name));
    this.audioClaps.set([]);
    this.audioClapIndex.set(0);
    this.audioArming.set(null);
    this.audioProfile.set(null);
    this.audioLogStart.set(0);
    this.muted.set(false); // adding sound means wanting to hear it
    this.clapStatus.set(`Listening for arming and claps in ${file.name}...`);
    try {
      this.audioProfile.set(await soundProfile(file));
      const claps = (await findClaps(file, 4)).claps;
      const takeoff = this.takeoffTime();
      const arm = takeoff === null ? null : await findArming(file, takeoff);
      if (arm) {
        this.audioArming.set(arm);
        this.audioLogStart.set(arm.logStart);
      }
      // The motors spinning up is sudden and loud too; that one is arming, not a clap.
      this.audioClaps.set(claps.filter(c => !arm?.confident || Math.abs(c - arm.logStart) > 0.3).slice(0, 3));
    } catch {
      this.backdropError.set(`Couldn't read the sound in ${file.name}. Try an MP4, M4A, MP3 or WAV.`);
    }
    this.clapStatus.set('');
    this.syncAudio(true);
  }

  /** Big files can't be decoded in the browser in one go; past this, the footage's clap is set by hand. */
  private static readonly MAX_DECODE_BYTES = 1.5e9;

  private async findFootageClap() {
    const file = this.footageFile;
    if (!file || file.size > OverlayExportComponent.MAX_DECODE_BYTES) return;
    this.clapStatus.set(`Listening for the clap in ${file.name}...`);
    try {
      const first = (await findClaps(file, 1)).claps[0];
      if (first !== undefined && this.footageClap() === null) { this.footageClap.set(first); this.footageClapAuto.set(true); }
    } catch { /* no usable sound track: set the clap by hand */ }
    this.clapStatus.set('');
    this.syncAudio(true);
  }

  /** Sets "Log starts at" by matching the loudness of the footage's motor sound to the throttle trace in the log. */
  async syncFromMotors() {
    const file = this.footageFile, sticks = this.data().sticks;
    if (!file || !sticks?.length) return;
    this.motorStatus.set('Listening to the motors and matching them to your throttle...');
    this.motorMatch.set(null);
    try {
      const m = await matchMotorSound(file, sticks);
      if (m) {
        this.motorMatch.set(m);
        if (m.confident) this.applyMotorGuess(); // an unclear match leaves the current sync alone
      } else {
        this.backdropError.set('There was too little sound or log to match.');
      }
    } catch {
      this.backdropError.set(`Couldn't read the sound in ${file.name}.`);
    }
    this.motorStatus.set('');
  }

  applyMotorGuess() {
    const m = this.motorMatch();
    if (!m) return;
    this.setOffset(m.offset);
    const t = this.takeoffTime();
    if (t !== null && !this.videoPlaying()) { this.previewTime.set(t); this.seekVideoToPreview(); } // show the takeoff to check against
  }

  /** The footage frame on screen is the clap: line the sound track up on it. */
  footageClapHere() {
    const v = this.bgVideo()?.nativeElement;
    if (!v) return;
    this.footageClap.set(Math.round(v.currentTime * 1000) / 1000);
    this.footageClapAuto.set(false);
    this.syncOnClap();
  }

  removeAudio() {
    this.soundFile = null;
    this.sound.set(null);
    this.extAudio()?.nativeElement.pause();
    const url = this.audioUrl();
    if (url) URL.revokeObjectURL(url);
    this.audioUrl.set(null);
    this.audioIsVideo.set(false);
    this.audioClaps.set([]);
    this.audioArming.set(null);
    this.audioProfile.set(null);
    this.footageClap.set(null);
  }

  /**
   * While the footage drives the preview, keeps the sound track at the same log time: same play/pause state, and
   * re-seeked when it drifts more than 60 ms (or on every seek). Silent where the recording hasn't started yet or has ended.
   */
  syncAudio(force = false) {
    const v = this.bgVideo()?.nativeElement, a = this.extAudio()?.nativeElement, o = this.audioOffset();
    if (!v) return; // no footage on screen: the sound plays on its own
    if (!a || o === null) { a?.pause(); return; }
    const target = v.currentTime - o;
    const inside = target >= 0 && (!Number.isFinite(a.duration) || target < a.duration);
    if (!inside || v.paused) {
      if (!a.paused) a.pause();
      if (inside && (force || Math.abs(a.currentTime - target) > 0.06)) a.currentTime = target;
      return;
    }
    if (force || Math.abs(a.currentTime - target) > 0.06) a.currentTime = target;
    if (a.paused) a.play().catch(() => undefined);
  }

  onVideoMeta() {
    const v = this.bgVideo()?.nativeElement;
    if (!v) return;
    // Some recordings don't say how long they are up front; the seekable range does.
    const d = Number.isFinite(v.duration) ? v.duration : v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0;
    this.videoDuration.set(d);
    if (v.videoWidth && v.videoHeight) this.videoAspect.set(v.videoWidth / v.videoHeight);
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

  /** The slider moves the overlay; a paused video follows it, and so does sound playing on its own. */
  onScrub(t: number) {
    this.previewTime.set(t);
    if (!this.videoPlaying()) this.seekVideoToPreview();
    const a = this.extAudio()?.nativeElement;
    if (a && this.audioOnly() && !a.paused) a.currentTime = Math.max(0, t + this.audioLogStart());
  }

  private clampPreview(t: number) {
    return Math.round(Math.min(this.previewMax(), Math.max(0, t)) * 1000) / 1000;
  }

  setAudioLogStart(v: number) {
    if (!Number.isFinite(v)) return;
    this.audioLogStart.set(Math.round(v * 100) / 100); // negative: the recording started after arming
    const a = this.extAudio()?.nativeElement;
    if (a && this.audioOnly() && !a.paused) a.currentTime = this.previewTime() + this.audioLogStart();
    this.syncAudio(true);
  }

  /** Without footage, the phone sound is the clock: play it from the overlay's moment and let the overlay follow. */
  toggleAudioPreview() {
    const a = this.extAudio()?.nativeElement;
    if (!a) return;
    if (!a.paused) { a.pause(); return; }
    if (this.previewTime() >= this.previewMax() - 0.05) this.previewTime.set(0);
    a.currentTime = Math.max(0, this.previewTime() + this.audioLogStart());
    a.play().then(() => this.followAudio(), () => this.backdropError.set("This browser can't play that sound. Try an MP4, M4A, MP3 or WAV."));
  }

  private followAudio() {
    const a = this.extAudio()?.nativeElement;
    if (!a || a.paused || !this.audioOnly()) return;
    const t = a.currentTime - this.audioLogStart();
    if (t > this.previewMax()) { a.pause(); this.previewTime.set(this.previewMax()); return; }
    this.previewTime.set(Math.max(0, t));
    this.audioFrame = requestAnimationFrame(() => this.followAudio());
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
    this.motorMatch.set(null);
    const v = this.bgVideo()?.nativeElement;
    const t = this.takeoffTime();
    if (!v || t === null) return;
    this.videoOffset.set(Math.round((v.currentTime - t) * 100) / 100);
    this.previewTime.set(t);
    this.beforeLog.set(false);
  }

  /** Use the frame on screen as the moment of arming. */
  logStartsHere() {
    this.motorMatch.set(null);
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
    this.syncAudio();
    const next = () => this.followVideo();
    if ('requestVideoFrameCallback' in v) {
      this.frameRequest = (v as HTMLVideoElement & { requestVideoFrameCallback(cb: () => void): number }).requestVideoFrameCallback(next);
    } else {
      this.frameRequest = requestAnimationFrame(next);
    }
  }

  private stopVideo() {
    this.bgVideo()?.nativeElement.pause();
    this.extAudio()?.nativeElement.pause();
    if (this.audioFrame !== null) { cancelAnimationFrame(this.audioFrame); this.audioFrame = null; }
    this.videoPlaying.set(false);
  }

  clampTime(v: number) {
    return Math.min(this.seconds(), Math.max(0, Number.isFinite(v) ? v : 0));
  }

  // ---- picking a video in the preview ----
  /** The video whose picture settings show in Options; only one thing (a video or an OSD element) is picked at a time. */
  mediaSelected = signal<'footage' | 'cam' | null>(null);
  hasFootage = computed(() => this.hasVideo());
  /** The stick cam's picture is on screen: vertical only (landscape plays just its sound), and switched on. */
  hasCam = computed(() => this.vertical() && !!this.audioUrl() && this.audioIsVideo() && this.showPip());

  /** Which video is under a point on the preview canvas, matching where the CSS puts them. */
  private mediaAt(y: number): 'footage' | 'cam' | null {
    // Vertical splits at 53.7% (see .stage.vertical): footage above, the stick cam below. Landscape is all footage.
    if (this.hasCam() && y >= 0.537 * this.previewH()) return 'cam';
    return this.hasFootage() ? 'footage' : null;
  }

  /** Picks a video, or nothing (clicking empty preview), and drops any picked OSD element either way. */
  selectMedia(media: 'footage' | 'cam' | null) {
    this.mediaSelected.set(media);
    this.selected.set(null);
  }

  // ---- finished video: the footage range to render, set from the footage slider ----
  /** A new clip (or its length becoming known) resets the range to the whole clip. */
  private clip = computed(() => ({ url: this.videoUrl(), duration: this.videoDuration() }));
  renderStart = linkedSignal({ source: this.clip, computation: () => 0 });
  renderEnd = linkedSignal({ source: this.clip, computation: c => c.duration });
  wholeClip = computed(() => this.renderStart() === 0 && this.renderEnd() === this.videoDuration());
  clipText = computed(() => this.wholeClip()
    ? `the whole clip (${preciseClock(this.videoDuration())})`
    : `${preciseClock(this.renderStart())} – ${preciseClock(this.renderEnd())} (${preciseClock(this.renderEnd() - this.renderStart())})`);
  /** How the render slider's handles read out to assistive tech. */
  readonly clockText = (v: number) => preciseClock(v);

  useWholeClip() {
    this.renderStart.set(0);
    this.renderEnd.set(this.videoDuration());
  }

  /** What the finished video holds, as hover text on its heading. */
  finishedHover = computed(() =>
    `Finished video (.mp4): your footage${this.hasCam() ? ', stick cam' : ''}, `
    + `${this.audioUrl() ? `${this.audioName()}'s sound` : 'its sound'} and the OSD in one file, as in the preview. `
    + `${this.clipText()[0].toUpperCase()}${this.clipText().slice(1)} at ${this.resolutions()[this.resIndex()].label}, ${fpsLabel(this.fps())} fps`
    + `${this.fadeOut() > 0 ? `, fading out over ${this.fadeOut()} s` : ''}. Set its range with the Render slider under the preview.`);

  /** What the overlay export makes, as hover text on its button. */
  overlayHover = computed(() =>
    `Transparent OSD overlay (.mov) for Premiere or After Effects: ${this.frameCount()} frames, ${clock(this.exportSeconds())} long`
    + `${this.opts().showStats ? ' with the stats' : ''}, about ${this.sizeEstimate()}. Set its range with the Export marks under the preview.`
    + (this.toDisk ? '' : ' This browser builds the file in memory first; Chrome or Edge writes straight to disk.'));

  /** Seconds the finished video fades to black and silence at its end; 0 for no fade. Remembered in this browser. */
  fadeOut = signal(readFadeOut());

  setFadeOut(seconds: number) {
    const v = Number.isFinite(seconds) ? Math.min(10, Math.max(0, seconds)) : 0;
    this.fadeOut.set(v);
    try { localStorage.setItem(FADE_KEY, String(v)); } catch { /* not remembered */ }
  }

  rendering = signal(false);
  /** What the render is doing right now, so a slow start (reading sound, finding frames) doesn't look like nothing. */
  renderStage = signal('');
  renderDone = signal(0);
  renderTotal = signal(0);
  renderEta = signal('');
  renderMessage = signal('');
  renderError = signal('');
  private renderControl = { cancelled: false };

  /** Bakes footage, stick cam, sound and OSD into one MP4, laid out and graded exactly like the preview. */
  async renderFinished() {
    this.renderMessage.set('');
    this.renderError.set('');
    const footage = this.footageFile;
    if (!footage) {
      this.renderError.set('Load your flight footage first (Flight footage, above).');
      return;
    }
    const { w, h } = this.resolutions()[this.resIndex()];
    const fps = this.fps();
    const name = `${this.fileStem()}-video-${w}x${h}-${fpsLabel(fps)}fps.mp4`;

    let target: RenderTarget | null = null;
    let fallbackNote = '';
    if (this.toDisk) {
      this.renderStage.set('Choosing where to save...');
      let handle: Awaited<ReturnType<SaveFilePicker>>;
      try {
        handle = await (window as unknown as { showSaveFilePicker: SaveFilePicker }).showSaveFilePicker({
          suggestedName: name, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
        });
      } catch (e) {
        this.renderStage.set('');
        // Closing the dialog is a choice, not a failure; anything else gets said.
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          console.error('[render] save dialog', e);
          this.renderError.set(`Couldn't open the save dialog: ${e instanceof Error ? e.message : e}`);
        }
        return;
      }
      try {
        target = { kind: 'disk', writable: await handle.createWritable() };
      } catch (e) {
        // Chrome can refuse to write to the chosen place (protected or synced folders, a file open elsewhere). Render
        // anyway and download the result, rather than stopping.
        console.warn('[render] writing to the chosen file was refused; downloading instead', e);
        fallbackNote = ` Chrome wouldn't let GitDrone write to the place you picked, so it went to your Downloads folder instead.`;
      }
    }

    const sound = this.soundFile && this.audioUrl() ? { file: this.soundFile, offset: this.audioOffset() ?? 0 } : null;
    const plan: RenderPlan = {
      width: w, height: h, fps, vertical: this.vertical(),
      footage: {
        file: footage, start: this.renderStart(), end: this.renderEnd(), fit: this.footage43(),
        picture: { brightness: this.brightness(), contrast: this.contrast(), saturation: this.saturation(), zoom: this.footageZoom() },
      },
      cam: sound && this.hasCam() ? {
        ...sound,
        picture: { brightness: this.camBrightness(), contrast: this.camContrast(), saturation: this.camSaturation(), zoom: this.camZoom(),
                   panX: this.camPanX(), panY: this.camPanY() },
      } : null,
      sound,
      // The stats follow the whole flight here, not the overlay export's window.
      overlay: { renderer: this.renderer(), opts: { ...this.opts(), statsAfter: this.seconds() }, logOffset: this.videoOffset(),
                 logEnd: this.seconds() + this.tail() },
      fadeOut: this.fadeOut(),
    };

    this.stopVideo();
    this.rendering.set(true);
    this.renderDone.set(0);
    this.renderTotal.set(0);
    this.renderEta.set('');
    this.renderControl = { cancelled: false };
    const started = performance.now();
    try {
      const blob = await renderVideo(plan, target, (done, total) => {
        this.renderDone.set(done);
        this.renderTotal.set(total);
        this.renderStage.set(`Rendering frame ${done} of ${total}...`);
        if (done % 15 === 0) this.renderEta.set(clock((((performance.now() - started) / done) * (total - done)) / 1000));
      }, this.renderControl, what => {
        console.info('[render]', what);
        this.renderStage.set(what);
      });
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      this.renderMessage.set(`Rendered ${name} (${this.renderTotal()} frames).${fallbackNote}`);
    } catch (e) {
      if (e instanceof RenderCancelled) this.renderMessage.set('Render cancelled; nothing was saved.');
      else {
        console.error('[render] failed while:', this.renderStage(), e);
        this.renderError.set(`The render stopped while ${this.renderStage().replace(/\.\.\.$/, '').toLowerCase() || 'starting'}: `
          + (e instanceof Error && e.message ? e.message : String(e)));
      }
    } finally {
      this.rendering.set(false);
      this.renderStage.set('');
    }
  }

  cancelRender() {
    this.renderControl.cancelled = true;
  }

  // ---- export window, set from the preview ----
  wholeFlight = computed(() => this.start() === 0 && this.end() === this.seconds());
  windowLeft = computed(() => (this.start() / (this.previewMax() || 1)) * 100);
  windowWidth = computed(() => ((this.end() - this.start()) / (this.previewMax() || 1)) * 100);
  windowText = computed(() => this.wholeFlight()
    ? `Whole flight (${preciseClock(this.seconds())})`
    : `${preciseClock(this.start())} – ${preciseClock(this.end())} (${preciseClock(this.end() - this.start())})`);

  /** Rounded to a tenth, like the Start/End boxes show it. */
  private here() {
    return this.clampTime(Math.round(this.previewTime() * 10) / 10);
  }

  startHere() {
    this.start.set(Math.min(this.here(), this.end()));
  }

  endHere() {
    this.end.set(Math.max(this.here(), this.start()));
  }

  useWholeFlight() {
    this.start.set(0);
    this.end.set(this.seconds());
  }

  private drawPreview() {
    const r = this.renderer();
    const c = this.canvas()?.nativeElement;
    const t = this.previewTime();
    const o = this.opts();
    if (!c) return;
    // Sized here rather than in the template, so the canvas and what's drawn on it change shape together.
    const w = this.previewW(), h = this.previewH();
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
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

    const { w, h } = this.resolutions()[this.resIndex()];
    const fps = this.fps();
    const name = `${this.fileStem()}-${w}x${h}-${fpsLabel(fps)}fps.mov`;
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
