import type { InferenceSession, Tensor } from 'onnxruntime-web';

import vocabulary from './vocabulary.json';

/**
 * The inspection detector: an open-vocabulary YOLO-World model, exported to ONNX with the prompts in vocabulary.json
 * baked in (see tools/inspection/export_model.py, which reads the same file), run in the browser by ONNX Runtime Web on
 * the GPU through WebGPU, or on the CPU through WebAssembly where there's no WebGPU. Nothing leaves the machine.
 */

/** object: what inspections are about; lookalike: named so it isn't mistaken for one; defect: seen on an object. */
export type ClassKind = 'object' | 'lookalike' | 'defect';

export interface InspectClass {
  /** What the page calls it. */
  label: string;
  kind: ClassKind;
  /** Box colour over the video (bright, to stand out on footage). */
  color: string;
  /** What the model was told to look for; each is one of its outputs. */
  prompts: readonly string[];
}

export const CLASSES: readonly InspectClass[] = vocabulary.classes as InspectClass[];

/** The model's outputs, in order: which class each prompt belongs to. */
const PROMPT_CLASS: readonly number[] = CLASSES.flatMap((c, i) => c.prompts.map(() => i));

export const classIndex = (label: string) => CLASSES.findIndex(c => c.label === label);

/** Ready-made "look for" sets: the things an inspection is about, plus the defects that matter on them. */
export const PRESETS: readonly { name: string; labels: readonly string[] }[] = [
  { name: 'Everything', labels: CLASSES.map(c => c.label) },
  { name: 'Power lines', labels: ['Utility pole', 'Transmission tower', 'Power line', 'Insulator', 'Tree', 'Rust', 'Crack', 'Bird nest'] },
  { name: 'Solar', labels: ['Solar panel', 'Roof', 'Building', 'Crack', 'Bird nest'] },
  { name: 'Fences and gates', labels: ['Fence', 'Railing', 'Gate', 'Rust', 'Crack', 'Graffiti'] },
  { name: 'Buildings', labels: ['Building', 'Roof', 'Rust', 'Crack', 'Graffiti'] },
];

/** A box in the frame, as fractions of its width and height (so it fits any size the video is shown at). */
export interface Box { x: number; y: number; w: number; h: number }

export interface Detection { cls: number; score: number; box: Box }

/** Where the model is looked for first: a file next to the app (kept out of git; see the export script). */
export const MODEL_URL = 'models/inspection-v1.onnx';
const ORT_VERSION = '1.31.1';
/** ONNX Runtime's WebAssembly, from the CDN rather than our own (free, bandwidth-capped) server. */
const WASM_PATHS = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const CACHE = 'gitdrone-inspect-models';
/** The cache key for a model the pilot picked from disk. */
const PICKED_KEY = '/inspect-model/picked.onnx';

/** Model input size, square. */
const SIZE = 640;
/** Detections weaker than this aren't kept at all; the page's slider filters above it. */
export const MIN_SCORE = 0.12;
const NMS_IOU = 0.5;

export type Backend = 'webgpu' | 'wasm';

export class Detector {
  private constructor(
    private readonly ort: typeof import('onnxruntime-web'),
    private readonly session: InferenceSession,
    readonly backend: Backend,
  ) {}

  private readonly canvas = makeCanvas(SIZE, SIZE);
  private readonly ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  private readonly input = new Float32Array(3 * SIZE * SIZE);

  /** Opens the model (bytes from {@link loadModelBytes}) on WebGPU, else WebAssembly. */
  static async open(bytes: Uint8Array): Promise<Detector> {
    const ort = await import('onnxruntime-web/webgpu');
    ort.env.wasm.wasmPaths = WASM_PATHS;
    ort.env.logLevel = 'error';
    const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator
      && !!(await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
    if (hasGpu) {
      try {
        const session = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
        return new Detector(ort, session, 'webgpu');
      } catch (err) {
        console.warn('WebGPU detector failed, falling back to WebAssembly', err);
      }
    }
    ort.env.wasm.numThreads = Math.min(8, navigator.hardwareConcurrency || 4);
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return new Detector(ort, session, 'wasm');
  }

  /**
   * Finds the classes' objects in one frame, keeping only the classes in `wanted` (all when omitted). Each box still
   * gets its best class out of all of them first, so a bench isn't passed off as a fence when benches aren't wanted.
   */
  async detect(frame: CanvasImageSource, width: number, height: number, wanted?: ReadonlySet<number>): Promise<Detection[]> {
    // Letterbox into SIZE×SIZE on Ultralytics' grey, as the model was trained.
    const scale = Math.min(SIZE / width, SIZE / height);
    const dw = Math.round(width * scale), dh = Math.round(height * scale);
    const padX = Math.floor((SIZE - dw) / 2), padY = Math.floor((SIZE - dh) / 2);
    this.ctx.fillStyle = 'rgb(114,114,114)';
    this.ctx.fillRect(0, 0, SIZE, SIZE);
    this.ctx.drawImage(frame, padX, padY, dw, dh);
    const px = this.ctx.getImageData(0, 0, SIZE, SIZE).data;
    const plane = SIZE * SIZE, data = this.input;
    for (let i = 0; i < plane; i++) {
      data[i] = px[4 * i] / 255;
      data[plane + i] = px[4 * i + 1] / 255;
      data[2 * plane + i] = px[4 * i + 2] / 255;
    }
    const feeds: Record<string, Tensor> = { [this.session.inputNames[0]]: new this.ort.Tensor('float32', data, [1, 3, SIZE, SIZE]) };
    const results = await this.session.run(feeds);
    const out = results[this.session.outputNames[0]];
    try {
      const [, rows, anchors] = out.dims as number[];
      const nc = rows - 4;
      if (nc !== PROMPT_CLASS.length) throw new Error(`This model was made for ${nc} prompts; the page has ${PROMPT_CLASS.length}. Re-export it with tools/inspection/export_model.py.`);
      const o = (out.type === 'float32' ? out.data : Float32Array.from(out.data as ArrayLike<number>)) as Float32Array;
      const found: Detection[] = [];
      for (let a = 0; a < anchors; a++) {
        let best = 0, cls = -1;
        for (let c = 0; c < nc; c++) {
          const s = o[(4 + c) * anchors + a];
          if (s > best) { best = s; cls = PROMPT_CLASS[c]; }
        }
        if (best < MIN_SCORE || (wanted && !wanted.has(cls))) continue;
        const cx = o[a], cy = o[anchors + a], w = o[2 * anchors + a], h = o[3 * anchors + a];
        const x0 = Math.max(0, (cx - w / 2 - padX) / dw), y0 = Math.max(0, (cy - h / 2 - padY) / dh);
        const x1 = Math.min(1, (cx + w / 2 - padX) / dw), y1 = Math.min(1, (cy + h / 2 - padY) / dh);
        if (x1 - x0 < 0.004 || y1 - y0 < 0.004) continue;
        found.push({ cls, score: best, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
      }
      return nms(found);
    } finally {
      for (const t of Object.values(results)) t.dispose?.();
    }
  }

  dispose() { void this.session.release(); }
}

/** Keeps the strongest of each class's overlapping boxes. */
function nms(dets: Detection[]): Detection[] {
  dets.sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  for (const d of dets) {
    if (kept.every(k => k.cls !== d.cls || iou(k.box, d.box) < NMS_IOU)) kept.push(d);
    if (kept.length >= 100) break;
  }
  return kept;
}

export function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}

/** How much of `inner` lies inside `outer`. */
export function within(inner: Box, outer: Box): number {
  const ix = Math.max(0, Math.min(inner.x + inner.w, outer.x + outer.w) - Math.max(inner.x, outer.x));
  const iy = Math.max(0, Math.min(inner.y + inner.h, outer.y + outer.h) - Math.max(inner.y, outer.y));
  return (ix * iy) / (inner.w * inner.h || 1);
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function openCache(): Promise<Cache | null> {
  try { return typeof caches !== 'undefined' ? await caches.open(CACHE) : null; } catch { return null; }
}

/**
 * The model's bytes: one the pilot picked earlier (kept in the browser's cache), else the one next to the app.
 * Null when there's neither, so the page asks for the file.
 */
export async function loadModelBytes(progress: (fraction: number) => void): Promise<Uint8Array | null> {
  const cache = await openCache();
  const picked = await cache?.match(PICKED_KEY);
  if (picked) return new Uint8Array(await picked.arrayBuffer());
  // The served one is left to the HTTP cache, so a re-exported model is picked up as soon as it's there.
  let res: Response;
  try {
    res = await fetch(MODEL_URL, { cache: 'no-cache' });
  } catch {
    return null;
  }
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('text/html')) return null; // the app's own page, not a model
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total) progress(got / total);
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  return bytes;
}

/** Keeps a model picked from disk for next time, and returns its bytes. */
export async function keepPickedModel(file: File): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try { await (await openCache())?.put(PICKED_KEY, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })); } catch { /* fine */ }
  return bytes;
}

/** Forgets cached models (so a re-exported one is fetched again). */
export async function forgetModels() {
  try { if (typeof caches !== 'undefined') await caches.delete(CACHE); } catch { /* fine */ }
}
