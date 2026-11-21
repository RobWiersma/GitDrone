import { CLASSES } from './inspect-model';

/**
 * Defect cues: cheap checks on the pixels of a found object that say "look closer", never "this is broken". Real
 * defect detection needs a model trained on labelled defects; these catch the obvious (rust-coloured metal, trees
 * grown into a pole, bright spots on a dark panel, a pole that isn't upright).
 */

export interface Cue { kind: 'rust' | 'vegetation' | 'spots' | 'lean' | 'model'; text: string }

const RUST_ON = new Set(['Fence', 'Railing', 'Gate', 'Utility pole', 'Transmission tower', 'Roof', 'Lamp post', 'Street sign']);
const VEG_NEAR = new Set(['Utility pole', 'Transmission tower', 'Power line', 'Insulator', 'Fence', 'Railing', 'Solar panel']);
const UPRIGHT = new Set(['Utility pole', 'Transmission tower', 'Lamp post', 'Street sign', 'Pier']);

/** Hue in degrees, saturation and value 0..1. */
function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max / 255];
}

/**
 * Cues for one object, from its crop (`crop`) and a wider crop around it (`around`, half as big again each way).
 * `tall` is the box's height over its width in the frame.
 */
export function cuesFor(cls: number, crop: ImageData, around: ImageData, tall: number): Cue[] {
  const label = CLASSES[cls].label;
  const cues: Cue[] = [];

  if (RUST_ON.has(label)) {
    const f = fraction(crop, (h, s, v) => h >= 5 && h <= 28 && s > 0.55 && v > 0.25 && v < 0.8);
    if (f > 0.08) cues.push({ kind: 'rust', text: `Rust-coloured (${Math.round(f * 100)}% of it)` });
  }

  if (VEG_NEAR.has(label)) {
    const f = fraction(around, (h, s, v) => h >= 70 && h <= 150 && s > 0.3 && v > 0.2);
    if (f > 0.35) cues.push({ kind: 'vegetation', text: `Vegetation close by (${Math.round(f * 100)}% green around it)` });
  }

  if (label === 'Solar panel') {
    const f = brightSpots(crop);
    if (f > 0.04) cues.push({ kind: 'spots', text: `Bright spots on the panel (${Math.round(f * 100)}%): soiling, droppings or cracked glass?` });
  }

  if (UPRIGHT.has(label) && tall > 1.5) {
    const lean = leanDegrees(crop);
    // Past 35° the crop's main line isn't the upright at all (a crossbar, wires, the horizon): say nothing.
    if (lean !== null && Math.abs(lean) > 7 && Math.abs(lean) <= 35) {
      cues.push({ kind: 'lean', text: `Leans about ${Math.round(Math.abs(lean))}° against the frame (check the horizon)` });
    }
  }
  return cues;
}

function fraction(img: ImageData, test: (h: number, s: number, v: number) => boolean): number {
  const p = img.data, n = img.width * img.height;
  let hit = 0;
  for (let i = 0; i < n; i++) {
    const [h, s, v] = hsv(p[4 * i], p[4 * i + 1], p[4 * i + 2]);
    if (test(h, s, v)) hit++;
  }
  return n ? hit / n : 0;
}

/** Share of pixels in the panel's middle much brighter than its typical brightness. */
function brightSpots(img: ImageData): number {
  const { width: w, height: h, data: p } = img;
  const x0 = Math.floor(w * 0.1), x1 = Math.ceil(w * 0.9), y0 = Math.floor(h * 0.1), y1 = Math.ceil(h * 0.9);
  const vals: number[] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = 4 * (y * w + x);
    vals.push(Math.max(p[i], p[i + 1], p[i + 2]) / 255);
  }
  if (vals.length < 50) return 0;
  const sorted = [...vals].sort((a, b) => a - b), median = sorted[sorted.length >> 1];
  if (median > 0.6) return 0; // a washed-out or glare-lit panel says nothing
  return vals.filter(v => v > median + 0.35).length / vals.length;
}

/**
 * The main line's angle from vertical in degrees (+ leaning right), from the crop's structure tensor; null when the
 * crop has no strong single direction.
 */
function leanDegrees(img: ImageData): number | null {
  const { width: w, height: h, data: p } = img;
  if (w < 8 || h < 8) return null;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.3 * p[4 * i] + 0.59 * p[4 * i + 1] + 0.11 * p[4 * i + 2];
  let jxx = 0, jyy = 0, jxy = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1];
    const gy = g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - w] - g[i - w + 1];
    jxx += gx * gx; jyy += gy * gy; jxy += gx * gy;
  }
  const sum = jxx + jyy;
  if (!sum) return null;
  const coherence = Math.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / sum;
  if (coherence < 0.4) return null;
  // Gradient direction: 0 for a vertical line (its edges change left to right).
  return (0.5 * Math.atan2(2 * jxy, jxx - jyy) * 180) / Math.PI;
}
