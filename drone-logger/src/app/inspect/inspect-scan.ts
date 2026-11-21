import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { Cue, cuesFor } from './inspect-cues';
import { CraftFix } from './inspect-log';
import { Box, CLASSES, Detection, Detector, iou, makeCanvas, within } from './inspect-model';

/**
 * Scans footage for things to inspect: decodes a frame every `step` seconds (Mediabunny/WebCodecs, so DJI O4 HEVC
 * too), runs the detector on it, and follows each object from frame to frame so one fence is one finding, not one
 * per frame. All in the browser; the video never leaves the machine.
 */

/** One sampled frame's detections, each tagged with the finding it belongs to. */
export interface Sample { t: number; dets: (Detection & { track: number })[] }

export interface Finding {
  id: number;
  cls: number;
  /** First and last time it was seen, s. */
  from: number;
  to: number;
  /** How many sampled frames it was in. */
  hits: number;
  /** Its best sighting. */
  best: { t: number; score: number; box: Box };
  /** A JPEG of that sighting, with some of the scene around it. */
  thumb: string;
  cues: Cue[];
}

export interface ScanResult {
  duration: number; width: number; height: number; step: number;
  /** The classes looked for. */
  wanted: number[];
  samples: Sample[]; findings: Finding[];
}

export interface ScanProgress { done: number; total: number; fps: number }

/** How long a finding can go unseen and still be the same object, s. */
const GAP = 1.6;
/** Frames whose 32×18 grey thumbnails differ less than this (mean, of 255) reuse the last frame's detections. */
const SAME_FRAME = 1.2;
/** The frame size decoded: enough for the detector (640) and for sharp thumbnails and cues. */
const DECODE_W = 1280;
const THUMB = 168;
const CUE_SIZE = 160;

interface Track extends Finding { lastBox: Box }

/**
 * Scans `file`. `onUpdate` gets the findings so far every few frames, for the page to show as they come in.
 * Throws when the browser can't decode the video; returns null when cancelled.
 */
export async function scanFootage(
  file: File, detector: Detector, step: number, wanted: ReadonlySet<number>,
  onUpdate: (progress: ScanProgress, partial: ScanResult) => void, control: { cancelled: boolean },
): Promise<ScanResult | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error(`${file.name} has no video in it.`);
    if (!(await track.canDecode())) throw new Error(`This browser can't decode the video in ${file.name}.`);
    const duration = await track.computeDuration();
    const width = track.displayWidth, height = track.displayHeight;
    const times = Array.from({ length: Math.max(1, Math.floor(duration / step) + 1) }, (_, i) => Math.min(duration - 0.001, i * step));
    const sink = new CanvasSink(track, { width: Math.min(width, DECODE_W) });

    const samples: Sample[] = [];
    const tracks: Track[] = [];
    const result = (): ScanResult => ({ duration, width, height, step, wanted: [...wanted].sort((a, b) => a - b), samples, findings: tracks.map(publicFinding) });
    const tiny = makeCanvas(32, 18);
    const tinyCtx = tiny.getContext('2d', { willReadFrequently: true })!;
    let lastGrey: Uint8ClampedArray | null = null, lastDets: Detection[] = [];
    const started = performance.now();
    let k = 0;

    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      if (control.cancelled) return null;
      const t = times[k++];
      if (!wrapped) continue;
      const frame = wrapped.canvas as HTMLCanvasElement | OffscreenCanvas;

      tinyCtx.drawImage(frame, 0, 0, 32, 18);
      const grey = tinyCtx.getImageData(0, 0, 32, 18).data;
      let dets: Detection[];
      if (lastGrey && meanDiff(grey, lastGrey) < SAME_FRAME) {
        dets = lastDets; // the camera's hovering: same picture, same answer
      } else {
        dets = await detector.detect(frame, frame.width, frame.height, wanted);
        lastGrey = grey;
        lastDets = dets;
      }
      samples.push({ t, dets: follow(dets, t, tracks, frame) });

      if (k % 4 === 0 || k === times.length) {
        const secs = (performance.now() - started) / 1000;
        onUpdate({ done: k, total: times.length, fps: secs ? k / secs : 0 }, result());
      }
    }
    attachModelDefects(tracks, samples);
    return result();
  } finally {
    input.dispose();
  }
}

function meanDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] + a[i + 1] + a[i + 2] - b[i] - b[i + 1] - b[i + 2]) / 3;
  return sum / (a.length / 4);
}

/** Matches this frame's detections to the findings so far (same kind, overlapping or close by), starting new ones. */
function follow(dets: Detection[], t: number, tracks: Track[], frame: CanvasImageSource & { width: number; height: number }) {
  const live = tracks.filter(tr => t - tr.to <= GAP);
  const pairs: { d: number; tr: Track; s: number }[] = [];
  dets.forEach((d, i) => {
    for (const tr of live) {
      if (tr.cls !== d.cls) continue;
      const o = iou(d.box, tr.lastBox);
      const dist = Math.hypot(d.box.x + d.box.w / 2 - tr.lastBox.x - tr.lastBox.w / 2, d.box.y + d.box.h / 2 - tr.lastBox.y - tr.lastBox.h / 2);
      const s = o > 0.15 ? 1 + o : dist < 0.12 ? 1 - dist : 0;
      if (s > 0) pairs.push({ d: i, tr, s });
    }
  });
  pairs.sort((a, b) => b.s - a.s);
  const owner = new Array<Track | null>(dets.length).fill(null);
  const taken = new Set<Track>();
  for (const p of pairs) {
    if (owner[p.d] || taken.has(p.tr)) continue;
    owner[p.d] = p.tr;
    taken.add(p.tr);
  }
  return dets.map((d, i) => {
    let tr = owner[i];
    if (!tr) {
      tr = { id: tracks.length + 1, cls: d.cls, from: t, to: t, hits: 0, best: { t, score: 0, box: d.box }, thumb: '', cues: [], lastBox: d.box };
      tracks.push(tr);
    }
    tr.to = t;
    tr.hits++;
    tr.lastBox = d.box;
    if (d.score > tr.best.score) {
      tr.best = { t, score: d.score, box: d.box };
      snapshot(tr, frame);
    }
    return { ...d, track: tr.id };
  });
}

/** Takes the finding's thumbnail and works out its cues, from its best sighting so far. */
function snapshot(tr: Track, frame: CanvasImageSource & { width: number; height: number }) {
  const { box } = tr.best, W = frame.width, H = frame.height;
  const region = (grow: number) => {
    const cx = (box.x + box.w / 2) * W, cy = (box.y + box.h / 2) * H;
    const w = Math.max(8, box.w * W * grow), h = Math.max(8, box.h * H * grow);
    const x = Math.max(0, cx - w / 2), y = Math.max(0, cy - h / 2);
    return { x, y, w: Math.min(W - x, w), h: Math.min(H - y, h) };
  };
  const draw = (r: { x: number; y: number; w: number; h: number }, max: number) => {
    const s = Math.min(1, max / Math.max(r.w, r.h));
    const c = makeCanvas(Math.max(1, Math.round(r.w * s)), Math.max(1, Math.round(r.h * s)));
    c.getContext('2d', { willReadFrequently: true })!.drawImage(frame, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    return c;
  };
  tr.thumb = draw(region(1.3), THUMB).toDataURL('image/jpeg', 0.82);
  const crop = draw(region(1), CUE_SIZE), around = draw(region(1.5), CUE_SIZE);
  const data = (c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
  tr.cues = cuesFor(tr.cls, data(crop), data(around), (box.h * H) / (box.w * W || 1));
}

/** Rust, cracks, nests and graffiti the model saw on an object become cues on that object. */
function attachModelDefects(tracks: Track[], samples: Sample[]) {
  const byId = new Map(tracks.map(t => [t.id, t]));
  const noted = new Set<string>();
  for (const s of samples) {
    for (const d of s.dets) {
      if (CLASSES[d.cls].kind !== 'defect') continue;
      for (const o of s.dets) {
        if (CLASSES[o.cls].kind === 'defect' || within(d.box, o.box) < 0.6) continue;
        const key = `${o.track}:${d.cls}`;
        if (noted.has(key)) continue;
        noted.add(key);
        byId.get(o.track)?.cues.push({ kind: 'model', text: `Model sees ${CLASSES[d.cls].label.toLowerCase()} on it (${Math.round(d.score * 100)}%)` });
      }
    }
  }
}

function publicFinding(t: Track): Finding {
  const { lastBox: _, ...f } = t;
  return { ...f, cues: [...f.cues] };
}

const craftCells = (c: CraftFix | undefined, n: (v: number | null | undefined, d: number) => string) =>
  [n(c?.logT, 2), n(c?.lat, 6), n(c?.lon, 6), n(c?.height, 1), n(c?.speed, 1), n(c?.heading, 0)];

/** Seconds as m:ss. */
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The findings as CSV. */
export function findingsCsv(file: string, findings: Finding[], craft: Map<number, CraftFix> = new Map()): string {
  const n = (v: number | null | undefined, digits: number) => (v === null || v === undefined ? '' : v.toFixed(digits));
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = findings.map(f => [f.id, q(CLASSES[f.cls].label), f.from.toFixed(2), f.to.toFixed(2), f.best.t.toFixed(2),
    f.best.score.toFixed(3), f.best.box.x.toFixed(4), f.best.box.y.toFixed(4), f.best.box.w.toFixed(4), f.best.box.h.toFixed(4),
    q(f.cues.map(c => c.text).join('; ')), ...craftCells(craft.get(f.id), n)].join(','));
  return [`# ${file}`, 'id,class,from_s,to_s,best_s,score,x,y,w,h,cues,log_s,lat,lon,height_m,speed_ms,heading_deg', ...rows].join('\n');
}
