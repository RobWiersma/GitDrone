import {
  ALL_FORMATS, AudioBufferSink, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat,
  Output, Quality, StreamTarget, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
} from 'mediabunny';
import { Grade, GradeRenderer, isNeutral } from './grade';
import type { AudioCodec, StreamTargetChunk, Target, VideoCodec, WrappedCanvas } from 'mediabunny';
import { OverlayOptions, OverlayRenderer } from './overlay-renderer';
import { drawVignette, footagePunch, saturationBoost, vignetteLevel } from './music-react';
import { EditClip } from './auto-edit';

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
  footage: { file: File; start: number; end: number; picture: Picture; /** Landscape 4:3: show it whole (pillarboxed). */ fit: boolean;
             /** Its Lumetri-style colour, graded on the GPU. */ grade: Grade };
  /** Seconds after `footage.end` that the last footage frame stays up, so the post-flight stats can finish over it. */
  hold: number;
  /**
   * An auto-edit: these pieces of the footage back to back in place of `footage.start`..`end` (no hold). The footage,
   * stick cam, sound and OSD jump at each cut; the music and its effects run straight through.
   */
  clips?: EditClip[] | null;
  /** A stick cam whose picture fills the bottom of a vertical frame; `offset` is where it starts in footage time. */
  cam: { file: File; offset: number; picture: Picture } | null;
  /** Vertical with no stick cam: the bottom filled with the footage itself, zoomed in, soft and dark (see drawBottomFill). */
  fill?: boolean;
  /** Where the sound comes from: the sound track (at its offset in footage time, raised or lowered by `gain`, 1 for as
   *  recorded), or else the footage's own. */
  sound: { file: File; offset: number; gain: number; fadeIn: number; fadeOut: number } | null;
  /** Music under the whole video: `start` seconds into the song at the first frame, at `gain`, faded in and out over
   *  `fadeIn` / `fadeOut` seconds (0 for none). */
  music: { file: File; start: number; gain: number; fadeIn: number; fadeOut: number } | null;
  overlay: { renderer: OverlayRenderer; opts: OverlayOptions; /** Footage time where the log starts. */ logOffset: number; /** Log time after which nothing is drawn. */ logEnd: number };
  /** Seconds at the end over which the picture fades to black and the sound to silence; 0 for none. */
  fadeOut: number;
  /** The constant quality to encode at, as an H.264 quantizer (lower keeps more): 14 near lossless, 18 high, 22 smaller. */
  quantizer: number;
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

/**
 * The finished video's bitrate where the encoder can't do constant quality, for quantizer `qp`: at 14, 0.35 bits per
 * pixel per frame, about 44 Mbps at 1080p60 and 175 Mbps at 4K60, halving for every 6 the quantizer goes up, as it does
 * for constant quality. FPV footage is the hardest kind to compress (the whole frame moving, dense foliage, fine grass);
 * at the 6 Mbps a "high quality" preset gives 1080p, the encoder runs out of bits and smears blocks along the motion.
 * Capped at 240 Mbps, H.264's ceiling at the highest level.
 */
export const videoBitrate = (width: number, height: number, fps: number, qp = 14) =>
  Math.round(Math.min(240_000_000, width * height * fps * 0.35 * 2 ** (-(qp - 14) / 6)));

/**
 * About what constant quality `qp` comes to on busy FPV footage: measured at 337 Mbps for 4K60 at 14 on an RTX
 * 3060 Ti's encoder, about 1.9 times the bitrate above; calm footage comes out smaller.
 */
export const expectedBitrate = (width: number, height: number, fps: number, qp: number) =>
  1.9 * width * height * fps * 0.35 * 2 ** (-(qp - 14) / 6);

/** An H.264 quantizer in another codec's terms (VP9 runs to 63, AV1 to 255); undefined where it has none. */
const quantizerFor = (codec: VideoCodec, qp: number): number | undefined =>
  codec === 'avc' || codec === 'hevc' ? qp : codec === 'vp9' ? Math.round(qp * 1.25) : codec === 'av1' ? qp * 5 : undefined;

/** The sound's top bitrate, for size estimates: AAC at 320 kbps where the browser's encoder takes it. */
export const AUDIO_BITRATE = 320_000;

/**
 * The best sound encoder this browser has, stereo at 48 kHz: AAC (which plays everywhere) at the highest bitrate it
 * takes, trying 320 kbps down, since encoders differ (Chrome on Windows stops at 192); else Opus. Null for none.
 */
async function bestAudioEncoder(): Promise<{ codec: AudioCodec; bitrate: number } | null> {
  for (const codec of ['aac', 'opus'] as const) {
    for (const bitrate of [AUDIO_BITRATE, 256_000, 192_000, 160_000, 128_000]) {
      const options = { numberOfChannels: 2, sampleRate: 48000, quality: new Quality({ bitrate }) };
      if (await getFirstEncodableAudioCodec([codec], options)) return { codec, bitrate };
    }
  }
  return null;
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
  // The footage time of every frame: the range (and the hold after it, for the stick cam and sound running on), or an
  // auto-edit's clips back to back, each running to the frame its next cut lands on so the cuts stay on the beat.
  const clips = plan.clips?.length ? plan.clips : null;
  const times: number[] = [];
  let moving: number;
  if (clips) {
    for (const c of clips) {
      const frames = Math.round((c.at + c.to - c.from) * fps) - Math.round(c.at * fps);
      for (let j = 0; j < frames; j++) times.push(c.from + j / fps);
    }
    moving = times.length;
  } else {
    moving = Math.max(1, Math.round((plan.footage.end - plan.footage.start) * fps));
    const held = moving + Math.max(0, Math.round(plan.hold * fps));
    for (let i = 0; i < held; i++) times.push(plan.footage.start + i / fps);
  }
  const total = Math.max(1, times.length);
  const seconds = total / fps;

  stage('Checking what this browser can encode...');
  const videoCodec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width: W, height: H });
  if (!videoCodec) throw new Error(`This browser can't encode ${W}×${H} video. Try a lower resolution, or Chrome or Edge.`);
  const audioEncoder = await bestAudioEncoder();

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

    // Constant quality where the encoder offers it (the GPU's does): every frame keeps the same detail, and fast motion
    // gets the bits it needs. Encoders without it (Chrome's software H.264) get the high bitrate instead.
    const quality = new Quality({ quantizer: quantizerFor(videoCodec, plan.quantizer), bitrate: videoBitrate(W, H, fps, plan.quantizer) });
    const video = new CanvasSource(canvas, { codec: videoCodec, quality, keyFrameInterval: 2 });
    // No frame rate on the track: Chrome checks it against the GPU encoder's limits and turns the GPU down above 30 fps
    // at 1440p and 4K, leaving a weaker software encoder. Every frame gets its own exact timestamp anyway.
    output.addVideoTrack(video);
    const audio = audioEncoder ? new AudioBufferSource({ codec: audioEncoder.codec, quality: new Quality({ bitrate: audioEncoder.bitrate }) }) : null;
    if (audio) output.addAudioTrack(audio);
    await output.start();

    // Sound first: it's small, and once it's in, the frames can stream straight through.
    if (audio) {
      const sound = await mixSound(plan, seconds, open, stage);
      if (sound) await audio.add(sound);
    }
    if (control.cancelled) throw new RenderCancelled();
    stage('Finding the first frames...');

    // Decoded frames, scaled down to roughly the size they're shown at to save work.
    const footageSink = new CanvasSink(footageTrack, { width: Math.min(footageTrack.displayWidth, Math.max(W, H)) });
    // The footage only as far as its end; the hold after it repeats the last frame. The stick cam (and the sound) run on.
    const footageFrames = footageSink.canvasesAtTimestamps(times.slice(0, moving));
    const camDuration = camOk ? await camTrack!.computeDuration() : 0;
    const camFrames = camOk
      ? new CanvasSink(camTrack!, { width: Math.min(camTrack!.displayWidth, W) }).canvasesAtTimestamps(times.map(t => Math.max(0, t - plan.cam!.offset)))
      : null;

    const grader = isNeutral(plan.footage.grade) ? null : new GradeRenderer();
    if (grader && !grader.ready) console.warn('[render] no WebGL 2 here, so the footage goes ungraded');
    let foot: WrappedCanvas | null = null;
    for (let i = 0; i < total; i++) {
      if (control.cancelled) throw new RenderCancelled();
      const t = times[i];
      if (i < moving) foot = (await footageFrames.next()).value ?? null;
      const camFrame = camFrames ? (await camFrames.next()).value ?? null : null;
      const camT = plan.cam ? t - plan.cam.offset : -1;
      const cam = camFrame && camT >= 0 && camT <= camDuration ? camFrame : null;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const logT = t - plan.overlay.logOffset;
      const showHud = logT >= 0 && logT <= plan.overlay.logEnd;
      // The music by the finished video's own clock, which an auto-edit's log time doesn't follow; the OSD gets the same.
      const music = plan.overlay.opts.music ?? null, level = music?.atOut(i / fps) ?? null;
      let opts = music ? { ...plan.overlay.opts, music: { ...music, at: () => level, outAt: () => i / fps } } : plan.overlay.opts;
      // An edit has no post-flight stats (it ends mid-flight), and the credit comes up over its last seconds.
      if (clips) opts = { ...opts, showStats: false, statsAfter: logT + (seconds - i / fps) };
      if (showHud) plan.overlay.renderer.draw(hudCtx, logT, opts);

      // Back to front: the stick cam (vertical only), the footage over it (zooming and darkening with the music), then the HUD.
      if (plan.cam) drawCam(ctx, cam, plan, W, H);
      else if (plan.vertical && plan.fill && foot) drawBottomFill(ctx, foot.canvas, foot.canvas.width, foot.canvas.height, bottomBox(W, H));
      drawFootage(ctx, foot, plan, W, H, grader, footagePunch(level, music), saturationBoost(level, music));
      drawVignette(ctx, pictureBox(plan, foot, W, H), vignetteLevel(level, music), level?.vigBeat ?? 0);
      if (showHud) ctx.drawImage(hud, 0, 0);
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

/** The footage's box: the whole frame, or the top part in vertical. */
const footageBox = (plan: RenderPlan, W: number, H: number) => (plan.vertical ? { x: 0, y: 0, w: W, h: SPLIT * H } : { x: 0, y: 0, w: W, h: H });

/** Where the footage's picture is: its whole box, or shown whole (4:3 in 16:9), just the picture between the bars. */
function pictureBox(plan: RenderPlan, frame: WrappedCanvas | null, W: number, H: number) {
  const box = footageBox(plan, W, H);
  if (plan.vertical || !plan.footage.fit || !frame) return box;
  const w = Math.min(box.w, box.h * (frame.canvas.width / frame.canvas.height));
  return { x: box.x + (box.w - w) / 2, y: box.y, w, h: box.h };
}

/** The footage in its box, cover-fitted or whole, zoomed (times `punch`, the music's zoom), graded, and saturated by the music. */
function drawFootage(ctx: CanvasRenderingContext2D, frame: WrappedCanvas | null, plan: RenderPlan, W: number, H: number,
                     grader: GradeRenderer | null, punch: number, saturation = 1) {
  if (!frame) return;
  const p = plan.footage.picture;
  // Graded on the GPU first, exactly as the preview shows it.
  const graded = grader?.draw(frame.canvas, frame.canvas.width, frame.canvas.height, plan.footage.grade);
  draw(ctx, graded ? grader!.canvas : frame.canvas, footageBox(plan, W, H), !plan.vertical && plan.footage.fit ? 'contain' : 'cover',
       { ...p, zoom: p.zoom * punch, saturation: p.saturation * saturation }, 0, 0);
}

/** The bottom part of the vertical split screen, under the footage: the stick cam's, or the fill's. */
const bottomBox = (W: number, H: number) => ({ x: 0, y: SPLIT * H, w: W, h: (1 - SPLIT) * H });

/** The fill's look: how far it zooms into the footage, how soft (the share of its box it's shrunk to), and how dark. */
const FILL = { zoom: 1.4, shrink: 1 / 14, saturate: 60, top: 0.5, bottom: 0.94 };
let fillScratch: HTMLCanvasElement | null = null;

/**
 * Fills `box` with the footage (`src`, `sw`×`sh`) when there's nothing else to put there: its middle zoomed in to
 * cover the box, shrunk to a few dozen pixels and stretched back up (so it's a soft blur of the footage's colours and
 * movement, nothing to read), desaturated, and darkened more the further down it goes. All on the GPU, no readback.
 * The preview's bottom fill draws through this too, so the two match.
 */
export function drawBottomFill(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number,
                               box: { x: number; y: number; w: number; h: number }) {
  if (sw <= 0 || sh <= 0 || box.w <= 0 || box.h <= 0) return;
  const w = Math.max(8, Math.round(box.w * FILL.shrink)), h = Math.max(8, Math.round(box.h * FILL.shrink));
  fillScratch ??= document.createElement('canvas');
  const small = fillScratch;
  if (small.width !== w || small.height !== h) {
    small.width = w;
    small.height = h;
  }
  const g = small.getContext('2d');
  if (!g) return;
  const k = Math.max(w / sw, h / sh) * FILL.zoom, cw = w / k, ch = h / k;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.filter = `saturate(${FILL.saturate}%)`;
  g.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h);
  g.filter = 'none';
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, box.x, box.y, box.w, box.h);
  const fade = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
  fade.addColorStop(0, `rgba(0,0,0,${FILL.top})`);
  fade.addColorStop(1, `rgba(0,0,0,${FILL.bottom})`);
  ctx.fillStyle = fade;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.restore();
}

/** The stick cam: the bottom part of the vertical split screen, shown whole. */
function drawCam(ctx: CanvasRenderingContext2D, frame: WrappedCanvas | null, plan: RenderPlan, W: number, H: number) {
  const p = plan.cam!.picture;
  if (frame) draw(ctx, frame.canvas, bottomBox(W, H), 'contain', p, p.panX ?? 0, p.panY ?? 0);
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
 * point, silent where the recording hasn't started yet or has ended, with the music under it. Null when there's no
 * sound to be had.
 */
async function mixSound(plan: RenderPlan, seconds: number, open: (file: File) => Input, stage: (what: string) => void): Promise<AudioBuffer | null> {
  const source = plan.sound ?? { file: plan.footage.file, offset: 0, gain: 1, fadeIn: 0, fadeOut: 0 };
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
  // From where the output's first moment is in the recording.
  // The sound's and the music's own fades each ride on a gain of their own, before the whole mix's fade out.
  // An auto-edit's sound is cut with its clips; otherwise it runs from the range's start.
  // An edit's cuts crossfade the sound, so the motors don't jump from one note to the next (the first clip's start
  // and the last one's end stay hard: the video starts and ends there).
  const pieces: Piece[] = plan.clips?.length
    ? plan.clips.map((c, i, all) => ({ from: c.from - source.offset, at: c.at, seconds: c.to - c.from,
                                       blendIn: i > 0 ? CUT_BLEND : 0, blendOut: i < all.length - 1 ? CUT_BLEND : 0 }))
    : [{ from: plan.footage.start - source.offset, at: 0, seconds }];
  // Switched off (an auto-edit's default): none at all, not even the footage's own.
  let heard = false;
  if (source.gain > 0) {
    stage(`Reading the sound from ${source.file.name}...`);
    heard = await addTrack(mix, fades(mix, out, source.fadeIn, source.fadeOut, seconds), open(source.file), pieces, seconds, source.gain);
  }
  if (plan.music) stage(`Reading the music from ${plan.music.file.name}...`);
  const music = !!plan.music && await addTrack(mix, fades(mix, out, plan.music.fadeIn, plan.music.fadeOut, seconds),
                                                open(plan.music.file), [{ from: plan.music.start, at: 0, seconds }], seconds, plan.music.gain);
  if (!heard && !music) return null;
  stage('Mixing the sound...');
  return mix.startRendering();
}

/** A gain into `into` that ramps up from silence over the first `fadeIn` seconds and down to it over the last `fadeOut`. */
function fades(mix: OfflineAudioContext, into: AudioNode, fadeIn: number, fadeOut: number, seconds: number): GainNode {
  const gain = mix.createGain();
  gain.connect(into);
  const up = Math.min(fadeIn, seconds), down = Math.min(fadeOut, seconds);
  if (up > 0) {
    gain.gain.setValueAtTime(0, 0);
    gain.gain.linearRampToValueAtTime(1, up);
  }
  if (down > 0) {
    gain.gain.setValueAtTime(1, Math.max(up, seconds - down));
    gain.gain.linearRampToValueAtTime(0, seconds);
  }
  return gain;
}

/** How far either side of an edit's cut the two clips' sounds overlap, s: 0.3 s of crossfade in all. */
const CUT_BLEND = 0.15;

/**
 * A stretch of a recording in the output: `seconds` of it from `from` s into the recording, landing `at` s into the
 * output. With a blend, it reaches that far past its start (or end) into the next piece, fading in (or out) across the
 * cut while that one fades the other way.
 */
interface Piece { from: number; at: number; seconds: number; blendIn?: number; blendOut?: number }

/**
 * How loud a piece is at `t` s from its own start: equal-power curves across each blended cut (so two different
 * stretches of motor sound add up to the same loudness all the way through), 1 between.
 */
function pieceLevel(piece: Piece, t: number) {
  const bi = piece.blendIn ?? 0, bo = piece.blendOut ?? 0;
  let k = 1;
  if (bi > 0 && t < bi) k *= Math.sin((Math.PI / 4) * (1 + Math.max(-1, t / bi)));
  if (bo > 0 && t > piece.seconds - bo) k *= Math.cos((Math.PI / 4) * (1 + Math.min(1, (t - piece.seconds) / bo)));
  return k;
}

/**
 * Lays pieces of a recording's sound into `mix` (an output `seconds` long) through a gain of `gain`; a piece starting
 * before the recording does (negative `from`) is silent until it starts. False when it has no sound this browser can decode.
 */
async function addTrack(mix: OfflineAudioContext, into: AudioNode, input: Input, pieces: Piece[], seconds: number, gain: number): Promise<boolean> {
  const track = await input.getPrimaryAudioTrack();
  if (!track || !(await track.canDecode())) return false;
  // The decoded chunks are added into one buffer covering the whole output, at the recording's own rate, and played as
  // one node: the offline mixer slows to a crawl with a node per chunk (thousands for a few minutes of sound).
  let whole: AudioBuffer | null = null;
  const sink = new AudioBufferSink(track);
  for (const piece of pieces) {
    const { from } = piece, bi = piece.blendIn ?? 0, bo = piece.blendOut ?? 0;
    // Read (and lay down) the blends either side too: they overlap the neighbouring pieces, each fading the other way.
    const readFrom = from - bi, readTo = from + piece.seconds + bo;
    for await (const { buffer, timestamp } of sink.buffers(Math.max(0, readFrom), readTo)) {
      whole ??= mix.createBuffer(buffer.numberOfChannels, Math.max(1, Math.ceil(seconds * buffer.sampleRate)), buffer.sampleRate);
      const rate = whole.sampleRate;
      const start = Math.max(0, Math.round((piece.at - bi) * rate)), end = Math.min(whole.length, Math.round((piece.at + piece.seconds + bo) * rate));
      // Where the chunk lands in the output, in samples; the parts before the piece's reach or past it are cut.
      const at = Math.round((piece.at + (timestamp - from)) * rate), skip = Math.max(0, start - at);
      const count = Math.min(buffer.length - skip, end - Math.max(start, at));
      if (count <= 0) continue;
      const first = Math.max(start, at);
      // Each sample's own level through the blends; added, not copied, so the overlaps mix.
      const level = new Float32Array(count);
      for (let s = 0; s < count; s++) level[s] = pieceLevel(piece, (first + s) / rate - piece.at);
      for (let c = 0; c < whole.numberOfChannels; c++) {
        const data = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)), out = whole.getChannelData(c);
        for (let s = 0; s < count; s++) out[first + s] += data[skip + s] * level[s];
      }
    }
  }
  if (!whole) return true; // nothing of it falls inside the output
  const level = mix.createGain();
  level.gain.value = gain;
  level.connect(into);
  const node = mix.createBufferSource();
  node.buffer = whole;
  node.connect(level);
  node.start(0);
  return true;
}
