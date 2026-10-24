import {
  ALL_FORMATS, AudioBufferSink, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat,
  Output, QUALITY_HIGH, StreamTarget, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
} from 'mediabunny';
import type { StreamTargetChunk, Target, WrappedCanvas } from 'mediabunny';
import { OverlayOptions, OverlayRenderer } from './overlay-renderer';

/**
 * Renders the finished video: the pilot's footage, the stick cam, the sound and the OSD baked into one H.264/AAC MP4,
 * laid out exactly like the preview (see the .stage / .footage-box / .pip styles in overlay-export.component.ts).
 * Decoding and encoding run in the browser through WebCodecs (via Mediabunny); nothing is uploaded.
 */

/** Preview-only picture settings, applied for real here. Percent; pan in % of the video's box. */
export interface Picture { brightness: number; contrast: number; saturation: number; zoom: number; panX?: number; panY?: number }

export interface RenderPlan {
  width: number;
  height: number;
  fps: number;
  vertical: boolean;
  /** The footage and the part of it (seconds, footage time) to render. */
  footage: { file: File; start: number; end: number; picture: Picture; /** Landscape 4:3: show it whole (pillarboxed). */ fit: boolean };
  /** A stick cam whose picture is shown; `offset` is where it starts in footage time. */
  cam: { file: File; offset: number; picture: Picture } | null;
  /** Where the sound comes from: the sound track (at its offset in footage time), or else the footage's own. */
  sound: { file: File; offset: number } | null;
  overlay: { renderer: OverlayRenderer; opts: OverlayOptions; /** Footage time where the log starts. */ logOffset: number; /** Log time after which nothing is drawn. */ logEnd: number };
  /** Seconds at the end over which the picture fades to black and the sound to silence; 0 for none. */
  fadeOut: number;
}

export interface RenderTarget { kind: 'disk'; writable: WritableStream<StreamTargetChunk> }

/** Same split as `.stage.vertical .footage-box` / `.pip`: the footage above 53.7%, the stick cam below. */
const SPLIT = 0.537;

export class RenderCancelled extends Error {}

/** The footage's frame rate, from its first couple of seconds of frames; null when it can't be read. */
export async function footageFrameRate(file: File): Promise<number | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    const rate = track ? (await track.computePacketStats(120)).averagePacketRate : 0;
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

/** Standard rates a measured one snaps to, NTSC's 1000/1001 ones included. */
const STANDARD_RATES = [24000 / 1001, 24, 25, 30000 / 1001, 30, 48, 50, 60000 / 1001, 60];

/**
 * The output rate for footage at `rate`: the same rate, snapped to the closest standard one within 2% (phones record
 * a slightly variable ~29.86 that means 29.97), except that high-speed footage (100 fps and up, like the O4's 100 or
 * 120) comes out at 60, which is as high as YouTube and most players go.
 */
export function outputFrameRate(rate: number): number {
  if (rate >= 100) return 60;
  const near = STANDARD_RATES.filter(r => Math.abs(r - rate) / r < 0.02).sort((a, b) => Math.abs(a - rate) - Math.abs(b - rate));
  return near[0] ?? Math.round(rate * 100) / 100;
}

/** "29.97", "23.976", "60": a frame rate as people write it. */
export const fpsLabel = (fps: number) => String(Number(fps.toFixed(3)));

/**
 * Renders `plan`, writing to `target` (or into memory, returned as a Blob, when there is none). Calls `progress`
 * after each frame; set `control.cancelled` to stop early.
 */
export async function renderVideo(plan: RenderPlan, target: RenderTarget | null, progress: (done: number, total: number) => void,
                                  control: { cancelled: boolean }, stage: (what: string) => void = () => undefined): Promise<Blob | null> {
  const { width: W, height: H, fps } = plan;
  const total = Math.max(1, Math.round((plan.footage.end - plan.footage.start) * fps));
  const seconds = total / fps;

  stage('Checking what this browser can encode...');
  const videoCodec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width: W, height: H });
  if (!videoCodec) throw new Error(`This browser can't encode ${W}×${H} video. Try a lower resolution, or Chrome or Edge.`);
  const audioCodec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: 48000 });

  const inputs: Input[] = [];
  const open = (file: File) => { const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS }); inputs.push(input); return input; };

  const memory = target ? null : new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: memory ? 'in-memory' : false }), target: (memory ?? new StreamTarget(target!.writable, { chunked: true })) as Target });
  try {
    stage(`Opening ${plan.footage.file.name}...`);
    const footageTrack = await (await open(plan.footage.file)).getPrimaryVideoTrack();
    if (!footageTrack || !(await footageTrack.canDecode())) throw new Error(`This browser can't read the video in ${plan.footage.file.name}.`);
    const camTrack = plan.cam ? await (await open(plan.cam.file)).getPrimaryVideoTrack() : null;
    const camOk = !!camTrack && (await camTrack.canDecode());

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const hud = document.createElement('canvas');
    hud.width = W;
    hud.height = H;
    const hudCtx = hud.getContext('2d')!;

    const video = new CanvasSource(canvas, { codec: videoCodec, quality: QUALITY_HIGH });
    output.addVideoTrack(video, { frameRate: fps });
    const audio = audioCodec ? new AudioBufferSource({ codec: audioCodec, quality: QUALITY_HIGH }) : null;
    if (audio) output.addAudioTrack(audio);
    await output.start();

    // Sound first: it's small, and once it's in, the frames can stream straight through.
    if (audio) {
      stage(`Reading the sound from ${(plan.sound?.file ?? plan.footage.file).name}...`);
      const sound = await mixSound(plan, seconds, open);
      if (sound) await audio.add(sound);
    }
    if (control.cancelled) throw new RenderCancelled();
    stage('Finding the first frames...');

    // Decoded frames, scaled down to roughly the size they're shown at to save work.
    const footageSink = new CanvasSink(footageTrack, { width: Math.min(footageTrack.displayWidth, Math.max(W, H)) });
    const times = Array.from({ length: total }, (_, i) => plan.footage.start + i / fps);
    const footageFrames = footageSink.canvasesAtTimestamps(times);
    const camDuration = camOk ? await camTrack!.computeDuration() : 0;
    const camFrames = camOk
      ? new CanvasSink(camTrack!, { width: Math.min(camTrack!.displayWidth, W) }).canvasesAtTimestamps(times.map(t => Math.max(0, t - plan.cam!.offset)))
      : null;

    for (let i = 0; i < total; i++) {
      if (control.cancelled) throw new RenderCancelled();
      const t = times[i];
      const foot = (await footageFrames.next()).value ?? null;
      const camFrame = camFrames ? (await camFrames.next()).value ?? null : null;
      const camT = plan.cam ? t - plan.cam.offset : -1;
      const cam = camFrame && camT >= 0 && camT <= camDuration ? camFrame : null;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const logT = t - plan.overlay.logOffset;
      const showHud = logT >= 0 && logT <= plan.overlay.logEnd;
      if (showHud) plan.overlay.renderer.draw(hudCtx, logT, plan.overlay.opts);

      if (plan.vertical) {
        if (plan.cam) drawCam(ctx, cam, plan, W, H);
        drawFootage(ctx, foot, plan, W, H);
        if (showHud) ctx.drawImage(hud, 0, 0);
      } else {
        drawFootage(ctx, foot, plan, W, H);
        if (showHud) ctx.drawImage(hud, 0, 0);
        if (plan.cam) drawCam(ctx, cam, plan, W, H); // the corner picture sits over the HUD, as in the preview
      }
      // Fade to black over the last few seconds: everything, OSD included, ending on a fully black frame.
      const fade = fadeLevel(i / fps, (total - 1) / fps, plan.fadeOut);
      if (fade < 1) {
        ctx.fillStyle = `rgba(0,0,0,${1 - fade})`;
        ctx.fillRect(0, 0, W, H);
      }
      await video.add(i / fps, 1 / fps);
      progress(i + 1, total);
    }
    await footageFrames.return(undefined);
    await camFrames?.return(undefined);

    stage('Finishing the file...');
    await output.finalize();
    return memory?.buffer ? new Blob([memory.buffer], { type: 'video/mp4' }) : null;
  } catch (e) {
    await output.cancel().catch(() => undefined);
    throw e;
  } finally {
    for (const input of inputs) input.dispose();
  }
}

/** How much of the picture shows at time `t` (1 = all, 0 = black): a straight ramp down over the last `fade` seconds to `last`. */
function fadeLevel(t: number, last: number, fade: number) {
  if (fade <= 0) return 1;
  return Math.max(0, Math.min(1, (last - t) / Math.min(fade, last || fade)));
}

/** The footage in its box (the whole frame, or the top part in vertical), cover-fitted or whole, zoomed and graded. */
function drawFootage(ctx: CanvasRenderingContext2D, frame: WrappedCanvas | null, plan: RenderPlan, W: number, H: number) {
  if (!frame) return;
  const box = plan.vertical ? { x: 0, y: 0, w: W, h: SPLIT * H } : { x: 0, y: 0, w: W, h: H };
  const p = plan.footage.picture;
  draw(ctx, frame.canvas, box, !plan.vertical && plan.footage.fit ? 'contain' : 'cover', p, 0, 0);
}

/** The stick cam: the bottom part in vertical, the bordered corner picture in landscape. Always shown whole. */
function drawCam(ctx: CanvasRenderingContext2D, frame: WrappedCanvas | null, plan: RenderPlan, W: number, H: number) {
  const p = plan.cam!.picture;
  if (plan.vertical) {
    if (frame) draw(ctx, frame.canvas, { x: 0, y: SPLIT * H, w: W, h: (1 - SPLIT) * H }, 'contain', p, p.panX ?? 0, p.panY ?? 0);
    return;
  }
  // .pip: right 2%, bottom 3%, 26% wide, 16:9, rounded, clipped, with a light border.
  const w = 0.26 * W, h = (w * 9) / 16, box = { x: 0.98 * W - w, y: 0.97 * H - h, w, h }, r = 0.0035 * W;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, r);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.clip();
  if (frame) draw(ctx, frame.canvas, box, 'contain', p, p.panX ?? 0, p.panY ?? 0);
  ctx.restore();
  ctx.lineWidth = Math.max(2, 0.0022 * W);
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, r);
  ctx.stroke();
}

/**
 * One video frame fitted to its box, then panned (% of the box) and zoomed about the box's centre, like
 * `transform: translate(x%, y%) scale(z)` on the preview's video element.
 */
function draw(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement | OffscreenCanvas, box: { x: number; y: number; w: number; h: number },
              fit: 'cover' | 'contain', p: Picture, panX: number, panY: number) {
  const k = fit === 'cover' ? Math.max(box.w / src.width, box.h / src.height) : Math.min(box.w / src.width, box.h / src.height);
  const z = p.zoom / 100, w = src.width * k * z, h = src.height * k * z;
  const cx = box.x + box.w / 2 + (panX / 100) * box.w, cy = box.y + box.h / 2 + (panY / 100) * box.h;
  ctx.save();
  if (p.brightness !== 100 || p.contrast !== 100 || p.saturation !== 100) {
    ctx.filter = `brightness(${p.brightness}%) contrast(${p.contrast}%) saturate(${p.saturation}%)`;
  }
  ctx.drawImage(src, cx - w / 2, cy - h / 2, w, h);
  ctx.restore();
}

/**
 * The output's sound as one stereo 48 kHz buffer: the sound track (or the footage's own audio) from the matching
 * point, silent where the recording hasn't started yet or has ended. Null when the source has no audio.
 */
async function mixSound(plan: RenderPlan, seconds: number, open: (file: File) => Input): Promise<AudioBuffer | null> {
  const source = plan.sound ?? { file: plan.footage.file, offset: 0 };
  const track = await open(source.file).getPrimaryAudioTrack();
  if (!track || !(await track.canDecode())) return null;
  const rate = 48000;
  const mix = new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * rate)), rate);
  // Everything goes through one gain, which ramps to silence over the fade, in step with the picture.
  const out = mix.createGain();
  out.connect(mix.destination);
  const fade = Math.min(plan.fadeOut, seconds);
  if (fade > 0) {
    out.gain.setValueAtTime(1, seconds - fade);
    out.gain.linearRampToValueAtTime(0, seconds);
  }
  const from = plan.footage.start - source.offset; // where the output's first moment is in the recording
  for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers(Math.max(0, from), from + seconds)) {
    const node = mix.createBufferSource();
    node.buffer = buffer;
    node.connect(out);
    const at = timestamp - from;
    if (at >= 0) node.start(at);
    else if (-at < buffer.duration) node.start(0, -at);
  }
  return mix.startRendering();
}
