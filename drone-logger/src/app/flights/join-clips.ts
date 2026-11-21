import {
  ALL_FORMATS, BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacket, EncodedPacketSink, EncodedVideoPacketSource,
  Input, InputAudioTrack, InputVideoTrack, Mp4OutputFormat, Output, StreamTarget,
} from 'mediabunny';
import type { StreamTargetChunk, Target } from 'mediabunny';

/**
 * Joining a recording the camera split up. DJI goggles and air units write to FAT32 cards, so a long flight lands as
 * several files of about 4 GB each (DJI_..._0031_D.MP4, DJI_..._0032_D.MP4, ...), one straight after the other. This
 * copies their video and sound, as they are (nothing is re-encoded, so it's quick and loses nothing), into one file,
 * each part's timestamps moved on to follow the last.
 */

/** Something about the clips that stops them being joined, said for the person who picked them. */
export class JoinError extends Error {}

/** The parts in recording order: DJI names carry the start time and a running number, so name order is time order. */
export const clipOrder = (files: File[]) =>
  [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

/** A name for the joined file: the first part's, marked as joined (DJI_..._0031_D.MP4 → DJI_..._0031_D-joined.mp4). */
export const joinedName = (files: File[]) => `${clipOrder(files)[0].name.replace(/\.[^.]+$/, '')}-joined.mp4`;

export interface JoinControl { cancelled: boolean }

interface Part {
  name: string;
  input: Input;
  video: InputVideoTrack;
  audio: InputAudioTrack | null;
  /** Where its video starts and ends in its own file, seconds. */
  start: number;
  end: number;
}

/**
 * Joins `files` (already in order) into one MP4, written to `writable` (a file on disk, the way to go for footage this
 * big) or, without one, built in memory and returned. `progress` gets 0..1 as it goes, by bytes copied.
 */
export async function joinClips(files: File[], writable: WritableStream<StreamTargetChunk> | null,
  progress: (done: number) => void, control: JoinControl): Promise<Blob | null> {
  const parts: Part[] = [];
  try {
    for (const file of files) {
      const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
      const video = await input.getPrimaryVideoTrack().catch(() => null);
      if (!video) {
        input.dispose();
        throw new JoinError(`${file.name} isn't a video LovelyOSD can read.`);
      }
      const audio = await input.getPrimaryAudioTrack();
      parts.push({ name: file.name, input, video, audio, start: await video.getFirstTimestamp(), end: await video.computeDuration() });
    }
    await checkMatch(parts);

    const first = parts[0];
    const videoConfig = await first.video.getDecoderConfig();
    if (!first.video.codec || !videoConfig) throw new JoinError(`LovelyOSD can't read the video in ${first.name}.`);
    const audioConfig = first.audio ? await first.audio.getDecoderConfig() : null;
    const withSound = !!(first.audio?.codec && audioConfig);

    const memory = writable ? null : new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: memory ? 'in-memory' : false }),
      target: (memory ?? new StreamTarget(writable!, { chunked: true })) as Target,
    });
    const videoOut = new EncodedVideoPacketSource(first.video.codec);
    const rate = (await first.video.computePacketStats(200)).averagePacketRate;
    output.addVideoTrack(videoOut, {
      rotation: await first.video.getRotation(),
      ...(Number.isFinite(rate) && rate > 0 ? { frameRate: rate } : {}),
    });
    const audioOut = withSound ? new EncodedAudioPacketSource(first.audio!.codec!) : null;
    if (audioOut) output.addAudioTrack(audioOut);
    await output.start();

    const total = files.reduce((n, f) => n + f.size, 0) || 1;
    let copied = 0, lastReport = 0;
    const counted = (p: EncodedPacket) => {
      copied += p.byteLength;
      if (copied - lastReport > total / 500) { lastReport = copied; progress(Math.min(1, copied / total)); }
    };
    try {
      let offset = 0, videoMeta = true, audioMeta = true, soundEnd = -Infinity;
      for (const part of parts) {
        if (control.cancelled) break;
        // Moves this part's times on to follow the last part's, its video's first frame landing where that one ended.
        const shift = offset - part.start;
        const videoPackets = withPacket(new EncodedPacketSink(part.video).packets(), p => p.timestamp + shift);
        const audioPackets = audioOut && part.audio ? withPacket(new EncodedPacketSink(part.audio).packets(), p => p.timestamp + shift) : null;
        // Video and sound fed in time order, so the file is written as it goes rather than one held back in memory.
        let v = await videoPackets.next(), a = audioPackets ? await audioPackets.next() : null;
        while (!v.done || (a && !a.done)) {
          if (control.cancelled) break;
          const takeVideo = !v.done && (!a || a.done || v.value.at <= a.value.at);
          if (takeVideo) {
            const { packet, at } = v.value;
            await videoOut.add(packet.clone({ timestamp: at }), videoMeta ? { decoderConfig: videoConfig! } : undefined);
            videoMeta = false;
            counted(packet);
            v = await videoPackets.next();
          } else {
            const { packet, at } = a!.value as Timed;
            // Sound that runs on past its part's last frame, or (for the first part) before its first, overlaps its
            // neighbour; it's dropped there so the sound plays straight through.
            if (at >= soundEnd - 1e-4 && at >= 0) {
              await audioOut!.add(packet.clone({ timestamp: at }), audioMeta ? { decoderConfig: audioConfig! } : undefined);
              audioMeta = false;
              soundEnd = at + packet.duration;
            }
            counted(packet);
            a = await audioPackets!.next();
          }
        }
        offset += part.end - part.start;
      }
    } catch (e) {
      await output.cancel();
      throw e;
    }
    if (control.cancelled) {
      await output.cancel();
      return null;
    }
    await output.finalize();
    progress(1);
    return memory ? new Blob([memory.buffer!], { type: 'video/mp4' }) : null;
  } finally {
    for (const p of parts) p.input.dispose();
  }
}

interface Timed { packet: EncodedPacket; at: number }

/** Each packet with where it goes in the joined file. */
async function* withPacket(packets: AsyncGenerator<EncodedPacket>, at: (p: EncodedPacket) => number): AsyncGenerator<Timed> {
  for await (const packet of packets) yield { packet, at: at(packet) };
}

/** Parts from one recording match: the same kind of video at the same size, and sound in all of them or none. */
async function checkMatch(parts: Part[]) {
  const [first, ...rest] = parts;
  const firstSound = first.audio ? `${first.audio.codec} ${first.audio.sampleRate} ${first.audio.numberOfChannels}` : 'none';
  for (const p of rest) {
    if (p.video.codec !== first.video.codec || p.video.codedWidth !== first.video.codedWidth || p.video.codedHeight !== first.video.codedHeight
        || await p.video.getCodecParameterString() !== await first.video.getCodecParameterString()) {
      throw new JoinError(`${p.name} isn't from the same recording as ${first.name} (its video is a different size or kind), so they can't be joined.`);
    }
    const sound = p.audio ? `${p.audio.codec} ${p.audio.sampleRate} ${p.audio.numberOfChannels}` : 'none';
    if (sound !== firstSound) {
      throw new JoinError(`${p.name} and ${first.name} don't have the same kind of sound, so they can't be from the same recording.`);
    }
  }
}
