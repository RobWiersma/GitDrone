import type { InferenceSession, Tensor } from 'onnxruntime-web';

import vocabulary from './vocabulary.json';
import { EMBED_DIMS } from './inspect-text';

/**
 * The inspection detector: an open-vocabulary YOLO-World model, exported to ONNX (tools/inspection/export_model.py)
 * taking what to look for as an input, CLIP text embeddings of the prompts (inspect-text.ts), so the pilot can add
 * their own. Run in the browser by ONNX Runtime Web on the GPU through WebGPU, or on the CPU through WebAssembly where
 * there's no WebGPU. Nothing leaves the machine.
 */

/** object: what inspections are about; lookalike: named so it isn't mistaken for one; defect: seen on an object. */
export type ClassKind = 'object' | 'lookalike' | 'defect';

export interface InspectClass {
  /** What the page calls it. */
  label: string;
  kind: ClassKind;
  /** Box colour over the video (bright, to stand out on footage). */
  color: string;
  /** What the model is told to look for; each is one of its outputs. */
  prompts: readonly string[];
  /** Added by the pilot (kept in this browser), not built in. */
  custom?: boolean;
  /** A pilot's own class taken off again: kept in place until the page reloads, so findings keep their numbers. */
  removed?: boolean;
}

/** How many prompts the model takes at once (SLOTS in export_model.py). */
export const PROMPT_SLOTS = 96;
const CUSTOM_KEY = 'gitdrone-inspect-custom-classes';
/** Box colours for the pilot's own classes, in turn. */
const CUSTOM_COLORS = ['#ff6ad5', '#7afcff', '#feff9c', '#ff9f43', '#a3ff6a', '#c792ea', '#ff8080', '#80b3ff'];

/** The built-in classes, then the pilot's own. Indexes never change while the page is open (removed ones stay, marked). */
export const CLASSES: InspectClass[] = [...(vocabulary.classes as InspectClass[]), ...loadCustom()];

export const classIndex = (label: string) => CLASSES.findIndex(c => !c.removed && c.label.toLowerCase() === label.toLowerCase());

/** Every prompt the detector is given, in order, with the class it stands for. */
export const activePrompts = () =>
  CLASSES.flatMap((c, cls) => (c.removed ? [] : c.prompts.map(prompt => ({ prompt, cls }))));

function loadCustom(): InspectClass[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]') as { label?: unknown; kind?: unknown }[];
    return raw.filter(c => typeof c.label === 'string' && c.label.trim())
      .map((c, i) => customClass(String(c.label), c.kind === 'defect' ? 'defect' : 'object', i));
  } catch { return []; }
}

const customClass = (label: string, kind: ClassKind, n: number): InspectClass =>
  ({ label, kind, color: CUSTOM_COLORS[n % CUSTOM_COLORS.length], prompts: [label], custom: true });

function saveCustom() {
  const own = CLASSES.filter(c => c.custom && !c.removed).map(c => ({ label: c.label, kind: c.kind }));
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(own)); } catch { /* only for this visit */ }
}

/**
 * Why `text` can't be added as a class of the pilot's own, or '' when it can: it needs words, a name not taken, and
 * room among the model's prompts.
 */
export function cantAdd(text: string): string {
  const label = text.trim();
  if (!label) return 'Type what to look for.';
  if (label.length > 60) return 'Keep it short: a few words, the way you would caption a photo.';
  if (classIndex(label) >= 0) return `${label} is already on the list.`;
  if (activePrompts().length >= PROMPT_SLOTS) return 'The list is full. Take something off first.';
  return '';
}

/** Adds a class of the pilot's own, looked for by its name, and returns its index. Check {@link cantAdd} first. */
export function addCustomClass(text: string, kind: ClassKind): number {
  const n = CLASSES.filter(c => c.custom).length;
  CLASSES.push(customClass(text.trim(), kind, n));
  saveCustom();
  return CLASSES.length - 1;
}

/** Takes one of the pilot's own classes off the list. */
export function removeCustomClass(i: number) {
  if (!CLASSES[i]?.custom) return;
  CLASSES[i] = { ...CLASSES[i], removed: true };
  saveCustom();
}

/** Ready-made "look for" sets: the things an inspection is about, plus the defects that matter on them. */
export const PRESETS: readonly { name: string; labels: readonly string[] }[] = [
  { name: 'Everything', labels: [] }, // filled in with every class on the list, the pilot's own too
  { name: 'Power lines', labels: ['Utility pole', 'Transmission tower', 'Power line', 'Insulator', 'Tree', 'Rust', 'Crack', 'Bird nest'] },
  { name: 'Solar', labels: ['Solar panel', 'Roof', 'Building', 'Crack', 'Bird nest'] },
  { name: 'Fences and gates', labels: ['Fence', 'Railing', 'Gate', 'Rust', 'Crack', 'Graffiti'] },
  { name: 'Buildings', labels: ['Building', 'Roof', 'Rust', 'Crack', 'Graffiti'] },
  { name: 'Drainage', labels: ['Drainage ditch', 'Tree', 'Crack'] },
  { name: 'Security cameras', labels: ['CCTV camera', 'Building', 'Utility pole', 'Lamp post', 'Graffiti'] },
];

/** A box in the frame, as fractions of its width and height (so it fits any size the video is shown at). */
export interface Box { x: number; y: number; w: number; h: number }

export interface Detection { cls: number; score: number; box: Box }

/** Where the model is looked for first: a file next to the app (kept out of git; see the export script). */
export const MODEL_URL = 'models/inspection-v2.onnx';
/**
 * The model online, for the live site (which doesn't serve one): a public Hugging Face repo, which is free and allows
 * other sites to download from it. Give each upload a new file name (inspection-l-v2.onnx…)
 * so browsers that kept the old one fetch the new one.
 */
export const HOSTED_MODEL: { url: string; megabytes: number } | null = {
  url: 'https://huggingface.co/bswiersma/gitdrone-inspector/resolve/main/inspection-l-v2.onnx',
  megabytes: 188,
};
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

/** Said when the model is the older kind, with what to look for baked in rather than an input. */
const OLD_MODEL = 'This is the older detector, from before you could add your own things to look for. Download the new one, '
  + 'or make one with tools/inspection/export_model.py.';

export class Detector {
  private constructor(
    private readonly ort: typeof import('onnxruntime-web'),
    private readonly session: InferenceSession,
    readonly backend: Backend,
  ) {}

  private readonly canvas = makeCanvas(SIZE, SIZE);
  private readonly ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  private readonly input = new Float32Array(3 * SIZE * SIZE);
  /** What to look for, as the model takes it: PROMPT_SLOTS embeddings, and which class each filled slot is. */
  private readonly prompts = new Float32Array(PROMPT_SLOTS * EMBED_DIMS);
  private promptClass: number[] = [];

  /**
   * Sets what to look for: one embedding per prompt (inspect-text.ts) and the class each stands for. The spare slots
   * repeat the first prompt: the model takes the strongest match over its prompts in places, so a repeat changes
   * nothing, where an empty slot would.
   */
  setPrompts(embeddings: readonly Float32Array[], classes: readonly number[]) {
    if (!embeddings.length || embeddings.length > PROMPT_SLOTS) throw new Error(`The detector takes 1 to ${PROMPT_SLOTS} things to look for.`);
    for (let i = 0; i < PROMPT_SLOTS; i++) this.prompts.set(embeddings[i < embeddings.length ? i : 0], i * EMBED_DIMS);
    this.promptClass = [...classes];
    this.ownSlots = classes.flatMap((cls, slot) => (CLASSES[cls]?.custom ? [slot] : []));
  }

  /**
   * The slots holding the pilot's own classes. Those are judged on their own score rather than having to beat every
   * other prompt: they're often a narrower take on a built-in one ("person sitting" against Person, "rusty gate" against
   * Gate), which would otherwise win nearly every box, so the pilot's would hardly ever be seen.
   */
  private ownSlots: number[] = [];

  /** Opens the model (bytes from {@link loadModelBytes}) on WebGPU, else WebAssembly. */
  static async open(bytes: Uint8Array): Promise<Detector> {
    const ort = await import('onnxruntime-web/webgpu');
    ort.env.wasm.wasmPaths = WASM_PATHS;
    ort.env.logLevel = 'error';
    const usable = (session: InferenceSession) => {
      if (session.inputNames.includes('txt_feats')) return session;
      void session.release();
      throw new Error(OLD_MODEL);
    };
    const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator
      && !!(await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
    if (hasGpu) {
      try {
        const session = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
        return new Detector(ort, usable(session), 'webgpu');
      } catch (err) {
        if (err instanceof Error && err.message === OLD_MODEL) throw err;
        console.warn('WebGPU detector failed, falling back to WebAssembly', err);
      }
    }
    ort.env.wasm.numThreads = Math.min(8, navigator.hardwareConcurrency || 4);
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return new Detector(ort, usable(session), 'wasm');
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
    if (!this.promptClass.length) throw new Error('Nothing to look for: set the prompts first.');
    const feeds: Record<string, Tensor> = {
      images: new this.ort.Tensor('float32', data, [1, 3, SIZE, SIZE]),
      txt_feats: new this.ort.Tensor('float32', this.prompts, [1, PROMPT_SLOTS, EMBED_DIMS]),
    };
    const results = await this.session.run(feeds);
    const out = results[this.session.outputNames[0]];
    try {
      const [, rows, anchors] = out.dims as number[];
      if (rows - 4 !== PROMPT_SLOTS) throw new Error(`This model takes ${rows - 4} prompts; the page gives ${PROMPT_SLOTS}. Re-export it with tools/inspection/export_model.py.`);
      // Only the filled slots: the spare ones repeat the first prompt.
      const classes = this.promptClass, nc = classes.length, own = this.ownSlots;
      const o = (out.type === 'float32' ? out.data : Float32Array.from(out.data as ArrayLike<number>)) as Float32Array;
      const found: Detection[] = [];
      const add = (a: number, cls: number, score: number) => {
        const cx = o[a], cy = o[anchors + a], w = o[2 * anchors + a], h = o[3 * anchors + a];
        const x0 = Math.max(0, (cx - w / 2 - padX) / dw), y0 = Math.max(0, (cy - h / 2 - padY) / dh);
        const x1 = Math.min(1, (cx + w / 2 - padX) / dw), y1 = Math.min(1, (cy + h / 2 - padY) / dh);
        if (x1 - x0 < 0.004 || y1 - y0 < 0.004) return;
        found.push({ cls, score, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
      };
      for (let a = 0; a < anchors; a++) {
        // The box's best built-in class...
        let best = 0, cls = -1;
        for (let c = 0; c < nc; c++) {
          if (CLASSES[classes[c]].custom) continue;
          const s = o[(4 + c) * anchors + a];
          if (s > best) { best = s; cls = classes[c]; }
        }
        if (best >= MIN_SCORE && (!wanted || wanted.has(cls))) add(a, cls, best);
        // ...and any of the pilot's own it looks like.
        for (const c of own) {
          const s = o[(4 + c) * anchors + a];
          if (s >= MIN_SCORE && (!wanted || wanted.has(classes[c]))) add(a, classes[c], s);
        }
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
 * The model's bytes, from what's already at hand: one the pilot picked earlier or downloaded from {@link HOSTED_MODEL}
 * (both kept in the browser's cache), else the one next to the app. Null when there's none, so the page offers the
 * download or asks for the file.
 */
export async function loadModelBytes(progress: (fraction: number) => void): Promise<Uint8Array | null> {
  const cache = await openCache();
  const kept = (await cache?.match(PICKED_KEY)) ?? (HOSTED_MODEL ? await cache?.match(HOSTED_MODEL.url) : undefined);
  if (kept) return new Uint8Array(await kept.arrayBuffer());
  // The served one is left to the HTTP cache, so a re-exported model is picked up as soon as it's there.
  let res: Response;
  try {
    res = await fetch(MODEL_URL, { cache: 'no-cache' });
  } catch {
    return null;
  }
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('text/html')) return null; // the app's own page, not a model
  return readAll(res, progress);
}

/**
 * Downloads {@link HOSTED_MODEL} and keeps it in the browser, so it's downloaded once; models kept from older uploads
 * are dropped. Throws when the download fails.
 */
export async function downloadHostedModel(progress: (fraction: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  if (!HOSTED_MODEL) throw new Error('There is no model online yet.');
  const res = await fetch(HOSTED_MODEL.url);
  if (!res.ok) throw new Error(`The download failed (${res.status}).`);
  const bytes = await readAll(res, progress, HOSTED_MODEL.megabytes * 1e6);
  // Kept in the background while the detector starts: writing 186 MB takes a while.
  const url = HOSTED_MODEL.url;
  // The Response copies the bytes now, before the detector can take them over.
  const kept = new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } });
  void (async () => {
    try {
      const cache = await openCache();
      if (!cache) return;
      for (const req of await cache.keys()) if (new URL(req.url).pathname !== PICKED_KEY) await cache.delete(req);
      await cache.put(url, kept);
    } catch { /* fine: it's downloaded again next time */ }
  })();
  return bytes;
}

/** A response's body, reporting how far it's got. */
async function readAll(res: Response, progress: (fraction: number) => void, expected = 0): Promise<Uint8Array<ArrayBuffer>> {
  const total = Number(res.headers.get('content-length')) || expected;
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total) progress(Math.min(1, got / total));
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

/** Forgets kept models (picked and downloaded), so a re-exported one is fetched again. */
export async function forgetModels() {
  try { if (typeof caches !== 'undefined') await caches.delete(CACHE); } catch { /* fine */ }
}
