import {
  ALL_FORMATS, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, Quality, StreamTarget,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import type { StreamTargetChunk, Target } from 'mediabunny';
import { RenderCancelled, footageFrameRate, videoBitrate } from '../flights/video-render';
import { CraftFix } from './inspect-log';
import { DrawOptions, detectionsAt, drawCraft, drawDetections } from './inspect-draw';
import { ScanResult, clock } from './inspect-scan';

/**
 * The Inspector's video: the footage with its findings boxed and labelled, the craft's telemetry from the log in the
 * corner, and the clock, as an H.264 MP4. Decoded and encoded in the browser through WebCodecs (Mediabunny), on the GPU
 * where it has an encoder; nothing is uploaded.
 */

export interface InspectRenderPlan {
  file: File;
  result: ScanResult;
  draw: DrawOptions;
  /** The craft at footage time t, when a log is lined up. */
  craftAt: ((t: number) => CraftFix | null) | null;
  /** Output height, px; the width follows the footage's shape. Null for the footage's own size. */
  height: number | null;
  /** Footage time to render, s. */
  from: number;
  to: number;
}

export { RenderCancelled };

/** Constant quality as an H.264 quantizer: 20 keeps fine detail (wires, cracks) at a sensible size. */
const QP = 20;
/** Frames a second: review footage doesn't need the O4's 100; 30 plays smoothly and halves the work of 60. */
const MAX_FPS = 30;
/** Past this the browser's memory won't hold a render, so it has to stream to a file on disk. */
export const MEMORY_LIMIT = 1.5e9;

/** The output size for `plan`: even numbers (encoders need them), the footage's shape. */
export function outputSize(result: ScanResult, height: number | null): { width: number; height: number } {
  const h = Math.min(result.height, height ?? result.height);
  const w = Math.round((result.width * h) / result.height);
  return { width: w - (w % 2), height: h - (h % 2) };
}

/** About how big the file comes out, bytes. */
export function estimateBytes(result: ScanResult, height: number | null, seconds: number) {
  const { width, height: h } = outputSize(result, height);
  return (videoBitrate(width, h, MAX_FPS, QP) / 8) * seconds * 0.6; // constant quality lands well under the cap
}

/**
 * Renders `plan` into `writable` (a file on disk), or into memory and returned as a Blob when there's none. Calls
 * `progress` every frame; set `control.cancelled` to stop (it then throws RenderCancelled).
 */
export async function renderInspection(
  plan: InspectRenderPlan, writable: WritableStream<StreamTargetChunk> | null,
  progress: (done: number, total: number) => void, control: { cancelled: boolean },
): Promise<Blob | null> {
  const { width: W, height: H } = outputSize(plan.result, plan.height);
  const rate = (await footageFrameRate(plan.file)) ?? 30;
  const fps = rate > MAX_FPS + 1 ? MAX_FPS : Math.round(rate * 1000) / 1000;
  const from = Math.max(0, plan.from), to = Math.min(plan.result.duration, plan.to);
  const total = Math.max(1, Math.floor((to - from) * fps));
  const times = Array.from({ length: total }, (_, i) => Math.min(to - 0.001, from + i / fps));

  const codec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width: W, height: H });
  if (!codec) throw new Error(`This browser can't encode ${W}×${H} video. Try a smaller size, or Chrome or Edge.`);

  const input = new Input({ source: new BlobSource(plan.file), formats: ALL_FORMATS });
  const memory = writable ? null : new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: memory ? 'in-memory' : false }),
    target: (memory ?? new StreamTarget(writable!, { chunked: true })) as Target,
  });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error(`This browser can't read the video in ${plan.file.name}.`);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const quality = new Quality({ quantizer: codec === 'avc' || codec === 'hevc' ? QP : undefined, bitrate: videoBitrate(W, H, fps, QP) });
    const video = new CanvasSource(canvas, { codec, quality, keyFrameInterval: 2 });
    output.addVideoTrack(video);
    await output.start();

    const scale = H / 540;
    const frames = new CanvasSink(track, { width: W, height: H, fit: 'fill' }).canvasesAtTimestamps(times);
    try {
      for (let i = 0; i < total; i++) {
        if (control.cancelled) throw new RenderCancelled();
        const frame = (await frames.next()).value ?? null;
        const t = times[i];
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        if (frame) ctx.drawImage(frame.canvas, 0, 0, W, H);
        drawDetections(ctx, detectionsAt(plan.result.samples, plan.result.step, t), plan.draw, W, H, scale);
        drawCraft(ctx, plan.craftAt?.(t) ?? null, scale);
        stamp(ctx, `GitDrone Inspector · Beta · ${clock(t)}`, W, H, scale);
        await video.add(i / fps, 1 / fps);
        progress(i + 1, total);
      }
    } finally {
      await frames.return(undefined);
    }
    await output.finalize();
    return memory?.buffer ? new Blob([memory.buffer], { type: 'video/mp4' }) : null;
  } catch (e) {
    await output.cancel().catch(() => undefined);
    throw e;
  } finally {
    input.dispose();
  }
}

/** The small credit and clock in the bottom right corner. */
function stamp(ctx: CanvasRenderingContext2D, text: string, W: number, H: number, scale: number) {
  ctx.save();
  ctx.font = `600 ${Math.round(11 * scale)}px ui-monospace, Consolas, monospace`;
  ctx.textBaseline = 'bottom';
  const pad = 5 * scale, m = 8 * scale, tw = ctx.measureText(text).width;
  ctx.fillStyle = 'rgb(10 15 20 / .6)';
  ctx.fillRect(W - m - tw - 2 * pad, H - m - 16 * scale, tw + 2 * pad, 16 * scale);
  ctx.fillStyle = '#e6edf3';
  ctx.fillText(text, W - m - tw - pad, H - m - 2 * scale);
  ctx.restore();
}
