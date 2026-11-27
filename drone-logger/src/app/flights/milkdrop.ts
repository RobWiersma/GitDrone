import type { ButterchurnVisualizer } from 'butterchurn';
import type { MilkdropPreset } from './milkdrop-presets';
import { MusicFx, MusicLevel } from './music-react';

/** Samples per channel handed to the visualiser each frame: what a Web Audio analyser with Butterchurn's FFT size gives. */
export const MILKDROP_SAMPLES = 1024;
/** The visualiser draws this wide (and as tall as the footage's box is for it), in the preview and the finished video alike. */
const RENDER_WIDTH = 960;
/** Cycling, each look plays this long, s of the finished video, blending into the next over BLEND s. */
const CYCLE_SECONDS = 16;
const BLEND = 2.5;
/** The harvest colours along their gradient, which turns slowly with the song: gold, pumpkin, cranberry, back to gold. */
const HARVEST: [number, string][] = [[0, '#ffc23a'], [0.3, '#ff6a00'], [0.62, '#c8143c'], [0.85, '#ff8a1e'], [1, '#ffd36b']];
const HARVEST_TURN = 6;
/** Round the edges, how much of it shows in the middle. */
const EDGES_MIDDLE = 0.25;
const LIFT = 'brightness(1.4) saturate(1.15)';

interface Lib {
  create: (canvas: HTMLCanvasElement, w: number, h: number) => ButterchurnVisualizer;
  presets: MilkdropPreset[];
}
let lib: Promise<Lib> | null = null;
/** Butterchurn and the presets, fetched the first time the effect is used (they're kept out of the editor's own code). */
export function loadMilkdrop(): Promise<Lib> {
  lib ??= Promise.all([import('butterchurn'), import('./milkdrop-presets')]).then(([bc, p]) => {
    const api = (bc.default ?? bc) as typeof bc.default;
    return { create: (canvas, width, height) => api.createVisualizer(null, canvas, { width, height, pixelRatio: 1 }), presets: p.MILKDROP_PRESETS };
  });
  lib.catch(() => (lib = null)); // a failed fetch (offline) can be tried again
  return lib;
}

/**
 * How brightly the visualiser shows over the footage at this moment, 0..1: glowing brighter as the song gets louder and
 * on each hit, and gone where no music plays.
 */
export function milkdropAlpha(lv: MusicLevel | null, fx: MusicFx | null): number {
  if (!lv || !fx || !(fx.milkdrop > 0)) return 0;
  const energy = (lv.bass + lv.mid + lv.treble) / 3;
  return Math.min(1, fx.milkdrop * (0.55 + 0.3 * energy + 0.25 * lv.punch));
}

/**
 * A MilkDrop visualiser fed the song frame by frame (not live), so the preview and the finished video dance to the same
 * sound at the same moments. Each frame lands, coloured and masked, on `canvas`, to be screened over the footage. The
 * look builds up over the frames before (MilkDrop feeds each frame into the next), so it matches the preview in look and
 * timing rather than pixel for pixel.
 */
export class MilkdropLayer {
  /** The finished picture, black where nothing glows. */
  readonly canvas = document.createElement('canvas');
  private gl = document.createElement('canvas');
  private viz: ButterchurnVisualizer;
  private look: string | null = null;
  private left = new Uint8Array(MILKDROP_SAMPLES).fill(128);
  private right = new Uint8Array(MILKDROP_SAMPLES).fill(128);
  private mono = new Uint8Array(MILKDROP_SAMPLES).fill(128);

  private constructor(private lib: Lib, aspect: number) {
    const { w, h } = size(aspect);
    this.gl.width = this.canvas.width = w;
    this.gl.height = this.canvas.height = h;
    this.viz = lib.create(this.gl, w, h);
  }

  /** A layer for footage `aspect` wide (w / h), or null where the browser has no WebGL 2. */
  static async create(aspect: number): Promise<MilkdropLayer | null> {
    const lib = await loadMilkdrop();
    if (!document.createElement('canvas').getContext('webgl2')) return null;
    try {
      return new MilkdropLayer(lib, aspect);
    } catch (e) {
      console.warn('[milkdrop] no visualiser here', e);
      return null;
    }
  }

  /** Matches the footage's box, when it changes shape (vertical, or other footage). */
  setAspect(aspect: number) {
    const { w, h } = size(aspect);
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.gl.width = this.canvas.width = w;
    this.gl.height = this.canvas.height = h;
    this.viz.setRendererSize(w, h);
  }

  /** Moves the visualiser on by `dt` s to `out` s into the finished video, with the song's sound there. */
  frame(fx: MusicFx, out: number, dt: number) {
    const presets = this.lib.presets;
    const key = fx.milkdropLook === 'cycle' ? presets[Math.floor(Math.max(0, out) / CYCLE_SECONDS) % presets.length].key : fx.milkdropLook;
    if (key !== this.look) {
      const preset = presets.find(p => p.key === key) ?? presets[0];
      this.viz.loadPreset(preset.preset, this.look === null ? 0 : BLEND);
      this.look = key;
    }
    if (fx.waveOut(out, this.left, this.right)) {
      for (let i = 0; i < MILKDROP_SAMPLES; i++) this.mono[i] = (this.left[i] + this.right[i]) >> 1;
    } else {
      this.left.fill(128);
      this.right.fill(128);
      this.mono.fill(128);
    }
    this.viz.render({ audioLevels: { timeByteArray: this.mono, timeByteArrayL: this.left, timeByteArrayR: this.right }, elapsedTime: dt });

    const ctx = this.canvas.getContext('2d')!, { width: w, height: h } = this.canvas;
    ctx.globalCompositeOperation = 'copy';
    ctx.filter = LIFT; // MilkDrop's picture is dark, built for a black screen; screened over footage it needs lifting
    ctx.drawImage(this.gl, 0, 0);
    ctx.filter = 'none';
    if (fx.milkdropColors === 'harvest') {
      // The preset's light and dark, in the harvest's colours.
      const a = (out * HARVEST_TURN * Math.PI) / 180, r = Math.hypot(w, h) / 2;
      const grad = ctx.createLinearGradient(w / 2 - Math.cos(a) * r, h / 2 - Math.sin(a) * r, w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
      for (const [o, c] of HARVEST) grad.addColorStop(o, c);
      ctx.globalCompositeOperation = 'color';
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
    if (fx.milkdropPlace === 'edges') {
      // Faint in the middle, where the flying is, glowing up towards the edges.
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.translate(w / 2, h / 2);
      ctx.scale(w / 2, h / 2);
      const mask = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.25);
      mask.addColorStop(0, `rgba(0,0,0,${EDGES_MIDDLE})`);
      mask.addColorStop(0.25, `rgba(0,0,0,${EDGES_MIDDLE})`);
      mask.addColorStop(0.8, 'rgba(0,0,0,1)');
      ctx.fillStyle = mask;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

/** Screens the layer's picture over `box` of the finished video, `alpha` strong. */
export function drawMilkdrop(ctx: CanvasRenderingContext2D, layer: MilkdropLayer, box: { x: number; y: number; w: number; h: number }, alpha: number) {
  if (alpha <= 0.005) return;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = alpha;
  ctx.drawImage(layer.canvas, box.x, box.y, box.w, box.h);
  ctx.restore();
}

const size = (aspect: number) => {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  return { w: RENDER_WIDTH, h: Math.max(2, Math.round(RENDER_WIDTH / a / 2) * 2) };
};
