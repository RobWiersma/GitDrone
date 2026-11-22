import builtIn from './prompt-embeddings.json';

/**
 * What the detector is told to look for, as CLIP ViT-B/32 text embeddings (the text half of the model YOLO-World was
 * trained against): 512 numbers per prompt, scaled to length 1. The built-in prompts' are worked out ahead of time by
 * tools/inspection/export_model.py and ship with the page. Anything the pilot types in is worked out here, by the same
 * CLIP text model run in the browser (Transformers.js, from the CDN like ONNX Runtime), downloaded the first time it's
 * needed (about 127 MB, kept by the browser), and each result is remembered so it's only worked out once.
 */

export const EMBED_DIMS = 512;

/** Transformers.js, from the CDN rather than our own (free, bandwidth-capped) server. */
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';
/**
 * CLIP ViT-B/32's text model (OpenAI's weights, converted to ONNX), in half precision: 127 MB instead of 254, and the
 * same embeddings to four decimal places. (The 8-bit one, at 65 MB, drifts far enough that the detector misses things.)
 */
const TEXT_MODEL = 'Xenova/clip-vit-base-patch32';
const TEXT_DTYPE = 'fp16';
export const TEXT_MODEL_MEGABYTES = 127;
const TYPED_KEY = 'gitdrone-inspect-typed-embeddings-v2';

const fromBase64 = (s: string) => {
  const bin = atob(s), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
};
const toBase64 = (v: Float32Array) => {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};

/** The ones known so far, by prompt: built in, then remembered from earlier typing. */
const known = new Map<string, Float32Array>(
  Object.entries((builtIn as { prompts: Record<string, string> }).prompts).map(([p, b]) => [p, fromBase64(b)]),
);
try {
  const typed = JSON.parse(localStorage.getItem(TYPED_KEY) ?? '{}') as Record<string, string>;
  for (const [p, b] of Object.entries(typed)) if (!known.has(p)) known.set(p, fromBase64(b));
} catch { /* worked out again when needed */ }

/** Whether every one of `prompts` is known already, so looking for them needs no download. */
export const allKnown = (prompts: readonly string[]) => prompts.every(p => known.has(p));

interface Encoder { tokenizer: (t: string[], o: object) => unknown; model: (i: unknown) => Promise<{ text_embeds: { data: Float32Array; dims: number[] } }> }
let encoder: Promise<Encoder> | null = null;

/** The CLIP text model, loaded once. `progress` gets 0..1 while it downloads. */
function loadEncoder(progress: (fraction: number) => void): Promise<Encoder> {
  encoder ??= (async () => {
    const url = TRANSFORMERS_URL; // a variable, so the bundler leaves it to the browser
    const tf = await import(/* @vite-ignore */ url);
    tf.env.allowLocalModels = false;
    const onProgress = (e: { status?: string; file?: string; progress?: number }) => {
      if (e.status === 'progress' && e.file?.endsWith('.onnx') && typeof e.progress === 'number') progress(e.progress / 100);
    };
    const tokenizer = await tf.AutoTokenizer.from_pretrained(TEXT_MODEL);
    const model = await tf.CLIPTextModelWithProjection.from_pretrained(TEXT_MODEL, { dtype: TEXT_DTYPE, progress_callback: onProgress });
    return { tokenizer, model };
  })();
  encoder.catch(() => { encoder = null; }); // try again next time
  return encoder;
}

/**
 * The embeddings of `prompts`, in order, working out (and remembering) any that aren't known yet. Only then is the
 * text model loaded, `progress` hearing how its download goes.
 */
export async function embed(prompts: readonly string[], progress: (fraction: number) => void = () => {}): Promise<Float32Array[]> {
  const missing = [...new Set(prompts.filter(p => !known.has(p)))];
  if (missing.length) {
    const { tokenizer, model } = await loadEncoder(progress);
    // One at a time: padded into a batch, the shorter prompts come out wrong.
    for (const p of missing) {
      const { text_embeds } = await model(tokenizer([p], { truncation: true }));
      const d = text_embeds.dims[1];
      if (d !== EMBED_DIMS) throw new Error(`The text model gave ${d} numbers per prompt, not ${EMBED_DIMS}.`);
      const v = Float32Array.from(text_embeds.data.subarray(0, d));
      const n = Math.hypot(...v) || 1;
      for (let k = 0; k < d; k++) v[k] /= n;
      known.set(p, v);
    }
    remember();
  }
  return prompts.map(p => known.get(p)!);
}

/** Keeps the typed prompts' embeddings in this browser (the built-in ones ship with the page). */
function remember() {
  const builtInPrompts = (builtIn as { prompts: Record<string, string> }).prompts;
  const typed: Record<string, string> = {};
  for (const [p, v] of known) if (!(p in builtInPrompts)) typed[p] = toBase64(v);
  try { localStorage.setItem(TYPED_KEY, JSON.stringify(typed)); } catch { /* worked out again next time */ }
}
