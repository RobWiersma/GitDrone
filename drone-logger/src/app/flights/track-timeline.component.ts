import { Component, computed, input, model, output } from '@angular/core';
import { IconComponent } from '../icon.component';
import { RangeWindowComponent } from './range-window.component';

export type TrackId = 'osd' | 'footage' | 'cam' | 'sound' | 'music';

/** One clip on the timeline, placed in footage time (seconds; it can start before the footage does). */
export interface TimelineTrack {
  id: TrackId;
  /** "V2", "A1": video numbered from the bottom layer up, sound from the top down, as in Premiere. */
  label: string;
  name: string;
  kind: 'video' | 'audio';
  start: number;
  end: number;
  /** Sound: its peaks across the clip as they'll play (gain included), 1 being full scale; more than that clips. */
  levels?: ArrayLike<number>;
  /** Sound: the gain, as shown in the track's header. */
  gain?: string;
  muted?: boolean;
  /** A video track that can be hidden: whether it shows. */
  shown?: boolean;
}

/** A moment marked on a track, in timeline time: what was heard in a sound track, or where it's at. */
export interface TimelineMark {
  at: number;
  kind: 'arm' | 'clap' | 'now';
  /** The one the sync uses, drawn bolder. */
  chosen?: boolean;
  /** What it is, shown in a popup on hover or focus. */
  label: string;
}

/**
 * The footage, OSD and sound as tracks on one timeline, like Premiere's: the clips where their sync puts them, a ruler
 * with the playhead, and the finished video's range above them. Clipping shows on the waveforms, in red. Picking a clip or its header picks the track, for its
 * settings beside the preview; the ruler moves the playhead.
 */
@Component({
  selector: 'app-track-timeline',
  imports: [IconComponent, RangeWindowComponent],
  template: `
    <div class="timeline">
      <div class="row ruler-row">
        <span class="head mono now">{{ clock(playhead()) }}</span>
        <div class="lane ruler">
          @for (t of ticks(); track t) { <span class="tick" [style.left.%]="pct(t)">{{ clock(t) }}</span> }
          <!-- A native slider over the ruler moves the playhead, so it works from the keyboard too. -->
          <input class="seek" type="range" [min]="from()" [max]="to()" step="0.01" [value]="playhead()" aria-label="Playhead"
                 [attr.aria-valuetext]="clock(playhead())" (input)="seek.emit(+$any($event.target).value)" />
        </div>
      </div>
      <div class="row">
        <span class="head" id="timeline-render">Render</span>
        <div class="lane">
          <div class="range" [style.left.%]="pct(0)" [style.width.%]="pct(footageEnd()) - pct(0)">
            <app-range-window label="Render" [max]="footageEnd()" [step]="0.1" [valueText]="clock" [disabled]="rangeDisabled()"
                              [(start)]="rangeStart" [(end)]="rangeEnd" (startChange)="seek.emit($event)" (endChange)="seek.emit($event)" />
          </div>
        </div>
      </div>
      @for (tr of tracks(); track tr.id) {
        <div class="row track" [class.audio]="tr.kind === 'audio'" [class.picked]="selected() === tr.id">
          <div class="head">
            <button class="label" type="button" [attr.aria-pressed]="selected() === tr.id" [title]="tr.label + ': ' + tr.name + '. Click for its settings.'"
                    (click)="select.emit(tr.id)">{{ tr.label }}</button>
            @if (tr.shown !== undefined) {
              <button class="toggle" type="button" [class.off]="!tr.shown" [attr.aria-pressed]="tr.shown" [attr.aria-label]="'Show ' + tr.name"
                      [title]="tr.shown ? 'Showing: click to hide it' : 'Hidden: click to show it'" (click)="toggleShown.emit(tr.id)"><app-icon name="pip" /></button>
            }
            @if (tr.kind === 'audio') {
              <button class="toggle mute" type="button" [class.on]="tr.muted" [attr.aria-pressed]="!!tr.muted" [attr.aria-label]="'Mute ' + tr.name"
                      [title]="tr.muted ? 'Muted, in the preview and the finished video: click to hear it' : 'Mute it, in the preview and the finished video'"
                      (click)="mute.emit(tr.id)">M</button>
              <span class="gain mono" title="Gain">{{ tr.gain }}</span>
            }
          </div>
          <div class="lane">
            <button class="clip" type="button" [class]="'clip ' + tr.id" [class.muted]="tr.muted" [title]="tr.name"
                    [style.left.%]="pct(tr.start)" [style.width.%]="pct(tr.end) - pct(tr.start)" (click)="select.emit(tr.id)">
              @if (waves().get(tr.id); as w) {
                <svg viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true">
                  <path class="wave" [attr.d]="w.wave" />
                  @if (w.clips) { <path class="clips" [attr.d]="w.clips" /> }
                </svg>
              }
              <span class="clip-name">{{ tr.name }}</span>
            </button>
            @for (m of marks()[tr.id] ?? []; track $index) {
              <!-- A wider hover target than the line, with its explanation popping up above it. -->
              <span [class]="'mark ' + m.kind" [class.chosen]="m.chosen" [class.near-start]="pct(m.at) < 12" [class.near-end]="pct(m.at) > 88"
                    [style.left.%]="pct(m.at)" tabindex="0" [attr.aria-label]="m.label"><span class="tip" role="tooltip">{{ m.label }}</span></span>
            }
          </div>
        </div>
      }
      <div class="playhead" aria-hidden="true" [style.--at]="pct(playhead()) / 100"></div>
    </div>
  `,
  styles: `
    .timeline { --head: 8.25rem; position: relative; display: grid; gap: 2px; margin-top: .6rem; font-size: .8rem;
                border: 1px solid var(--line); border-radius: 6px; background: var(--raised); padding: 4px 0; }
    .row { display: grid; grid-template-columns: var(--head) minmax(0, 1fr); align-items: center; min-height: 1.9rem; }
    .row.audio { min-height: 2.6rem; }
    .head { display: flex; align-items: center; gap: .3rem; padding: 0 .4rem; min-width: 0; }
    .lane { position: relative; height: 100%; min-height: inherit; margin-right: .5rem; }
    .now { color: var(--accent); font-weight: 600; }
    .ruler { border-bottom: 1px solid var(--line); }
    .tick { position: absolute; bottom: 2px; color: var(--muted); font-size: .7rem; white-space: nowrap;
            border-left: 1px solid var(--line); padding-left: 2px; }
    .seek { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: ew-resize; }
    .seek:focus-visible { opacity: .35; }
    .range { position: absolute; top: 0; bottom: 0; display: flex; align-items: center; }
    .range app-range-window { flex: 1; }
    .label { min-width: 2.2rem; padding: .15rem .35rem; border-radius: 4px; border: 1px solid var(--line); background: var(--bg);
             color: var(--ink); font: inherit; font-weight: 700; cursor: pointer; }
    .picked .label { background: var(--accent); border-color: var(--accent); color: #0b1a10; }
    .toggle { padding: .1rem .3rem; border-radius: 4px; border: 1px solid var(--line); background: none; color: var(--ink);
              font: inherit; font-weight: 700; line-height: 1.2; cursor: pointer; }
    .toggle.off { opacity: .45; }
    .mute.on { background: var(--warn); border-color: var(--warn); color: #000; }
    .gain { margin-left: auto; color: var(--muted); font-size: .75rem; white-space: nowrap; }
    .clip { position: absolute; top: 2px; bottom: 2px; display: block; min-width: 4px; padding: 0; overflow: hidden; text-align: left;
            border: 1px solid rgb(0 0 0 / .35); border-radius: 4px; color: #fff; font: inherit; cursor: pointer; }
    .picked .clip { outline: 2px solid var(--accent); outline-offset: 1px; }
    .clip.muted { opacity: .45; }
    .osd { background: #8e3d7c; } .footage { background: #5a4aa6; } .cam { background: #2f6496; }
    .sound { background: #24607a; } .music { background: #2b6a4a; }
    .clip svg { position: absolute; inset: 0; width: 100%; height: 100%; }
    .wave { fill: rgb(255 255 255 / .55); }
    .clips { stroke: #ff6b6b; stroke-width: 2; vector-effect: non-scaling-stroke; }
    .clip-name { position: relative; display: block; padding: 0 .35rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                 text-shadow: 0 1px 2px rgb(0 0 0 / .7); }
    .audio .clip-name { font-size: .72rem; }
    /* Marks over a clip, in the sound graph's colours: arming and launch, claps (dashed), and where the sound is. */
    .mark { position: absolute; top: 0; bottom: 0; width: 0; margin-left: -1px; border-left: 2px solid; z-index: 2; }
    .mark::before { content: ''; position: absolute; inset: 0 -5px; cursor: help; }
    .mark:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .mark.chosen { border-left-width: 3px; }
    .arm { border-color: var(--accent); } .clap { border-color: var(--warn); border-left-style: dashed; } .now { border-color: #fff; }
    .tip { position: absolute; bottom: calc(100% + 6px); left: 0; transform: translateX(-50%); z-index: 3; display: none; width: max-content;
           max-width: 18rem; padding: .3rem .5rem; border-radius: 6px; border: 1px solid var(--line); background: var(--bg); color: var(--ink);
           font-size: .75rem; line-height: 1.35; white-space: normal; box-shadow: 0 4px 12px rgb(0 0 0 / .35); pointer-events: none; }
    .near-start .tip { transform: none; } .near-end .tip { transform: translateX(-100%); }
    .mark:hover .tip, .mark:focus-visible .tip { display: block; }
    .playhead { position: absolute; top: 0; bottom: 0; left: calc(var(--head) + (100% - var(--head) - .5rem) * var(--at)); width: 2px;
                margin-left: -1px; background: var(--accent); pointer-events: none; }
  `,
})
export class TrackTimelineComponent {
  tracks = input.required<TimelineTrack[]>();
  /** Where the timeline starts and ends, in footage time. */
  from = input.required<number>();
  to = input.required<number>();
  /** How long the footage is: the Render range lies inside it. */
  footageEnd = input.required<number>();
  playhead = input.required<number>();
  /** Marks per track, apart from the tracks so a moving mark doesn't redraw the waveforms. */
  marks = input<Partial<Record<TrackId, TimelineMark[]>>>({});
  selected = input<TrackId | null>(null);
  rangeStart = model.required<number>();
  rangeEnd = model.required<number>();
  rangeDisabled = input(false);
  seek = output<number>();
  select = output<TrackId>();
  mute = output<TrackId>();
  toggleShown = output<TrackId>();

  pct(t: number) {
    const span = this.to() - this.from();
    return span > 0 ? ((t - this.from()) / span) * 100 : 0;
  }

  /** Ruler marks: a round step that gives about eight across. */
  ticks = computed(() => {
    const span = this.to() - this.from();
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find(s => span / s <= 9) ?? 1200;
    const out: number[] = [];
    for (let t = Math.ceil(this.from() / step) * step; t < this.to(); t += step) out.push(t);
    return out;
  });

  /** Each sound clip's waveform (mirrored, −48 dB at the middle line to full scale at the edges) and its clipping. */
  waves = computed(() => {
    const out = new Map<TrackId, { wave: string; clips: string }>();
    for (const tr of this.tracks()) {
      const lv = tr.levels;
      if (!lv?.length) continue;
      const n = lv.length, top: string[] = [], bottom: string[] = [], clips: string[] = [];
      for (let i = 0; i < n; i++) {
        const x = (((i + 0.5) / n) * 1000).toFixed(1);
        const h = Math.min(1, Math.max(0, (20 * Math.log10(lv[i] + 1e-6) + 48) / 48)) * 19;
        top.push(`${x},${(20 - h).toFixed(1)}`);
        bottom.unshift(`${x},${(20 + h).toFixed(1)}`);
        if (lv[i] >= 1) clips.push(`M${x},0 V6`);
      }
      out.set(tr.id, { wave: `M0,20 L${top.join(' L')} L1000,20 L${bottom.join(' L')} Z`, clips: clips.join(' ') });
    }
    return out;
  });

  /** "1:05", "-0:03": timeline times. */
  readonly clock = (t: number) => {
    const s = Math.round(Math.abs(t));
    return `${t < 0 && s ? '-' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
}
