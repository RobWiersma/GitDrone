import { Component, computed, input, model } from '@angular/core';

/**
 * A two-handle slider for a window inside 0..max: drag the left handle for the start, the right one for the end.
 * Two native range inputs stacked on one track, so each handle works with the keyboard and screen readers.
 */
@Component({
  selector: 'app-range-window',
  template: `
    <div class="track">
      <span class="fill" [style.left.%]="startPct()" [style.width.%]="endPct() - startPct()"></span>
      <!-- When the handles meet near the end, the start one goes in front so it can still be dragged back. -->
      <input type="range" min="0" [max]="max()" [step]="step()" [value]="start()" [attr.aria-label]="label() + ' start'"
             [style.z-index]="startPct() > 50 ? 2 : null"
             [attr.aria-valuetext]="valueText()(start())" [disabled]="disabled()" (input)="setStart($event)" />
      <input type="range" min="0" [max]="max()" [step]="step()" [value]="end()" [attr.aria-label]="label() + ' end'"
             [attr.aria-valuetext]="valueText()(end())" [disabled]="disabled()" (input)="setEnd($event)" />
    </div>
  `,
  styles: [`
    :host { display: block; flex: 1 1 12rem; min-width: 0; }
    .track { position: relative; height: 1.4rem; }
    .track::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 4px; margin-top: -2px; border-radius: 2px; background: var(--line); }
    .fill { position: absolute; top: 50%; height: 6px; margin-top: -3px; border-radius: 3px; background: var(--accent); }
    /* Both inputs cover the whole track; only their handles take the pointer, so either can be grabbed. */
    input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; background: none; pointer-events: none;
            -webkit-appearance: none; appearance: none; }
    input::-webkit-slider-runnable-track { background: none; }
    input::-moz-range-track { background: none; }
    input::-webkit-slider-thumb { -webkit-appearance: none; pointer-events: auto; width: .8rem; height: 1.3rem; border-radius: 3px;
                                  background: var(--accent); border: 2px solid var(--surface); cursor: ew-resize; }
    input::-moz-range-thumb { pointer-events: auto; width: .8rem; height: 1.3rem; border-radius: 3px; background: var(--accent);
                              border: 2px solid var(--surface); cursor: ew-resize; }
    input:focus-visible::-webkit-slider-thumb { outline: 2px solid var(--accent); outline-offset: 2px; }
    input:focus-visible::-moz-range-thumb { outline: 2px solid var(--accent); outline-offset: 2px; }
    input:disabled::-webkit-slider-thumb { opacity: .5; cursor: not-allowed; }
    input:disabled::-moz-range-thumb { opacity: .5; cursor: not-allowed; }
  `],
})
export class RangeWindowComponent {
  max = input.required<number>();
  step = input(0.1);
  /** Names the two handles for assistive tech: "<label> start" and "<label> end". */
  label = input('Range');
  /** How a handle's value is read out, e.g. as a clock. */
  valueText = input<(v: number) => string>(v => `${v.toFixed(1)} s`);
  disabled = input(false);
  start = model.required<number>();
  end = model.required<number>();

  startPct = computed(() => (this.start() / (this.max() || 1)) * 100);
  endPct = computed(() => (this.end() / (this.max() || 1)) * 100);

  /** A handle can't pass the other one, so the window never turns inside out. */
  setStart(e: Event) {
    const input = e.target as HTMLInputElement;
    const v = Math.min(+input.value, this.end());
    input.value = String(v);
    this.start.set(v);
  }

  setEnd(e: Event) {
    const input = e.target as HTMLInputElement;
    const v = Math.max(+input.value, this.start());
    input.value = String(v);
    this.end.set(v);
  }
}
