/**
 * Writes a QuickTime .mov whose frames are PNG images (codec 'png '). That keeps the alpha channel, so the
 * overlay drops straight onto a track in Premiere / After Effects with transparency, as one file.
 *
 * Layout: ftyp, mdat (64-bit size, frames appended as they're rendered), then moov (the index) at the end.
 * On Chromium the file streams to disk through the File System Access API; elsewhere it's assembled in memory.
 */
export interface MovWriter {
  addFrame(png: Blob): Promise<void>;
  /** Writes the index and finishes the file (or starts the download). */
  close(): Promise<void>;
  /** Stops without producing a file. */
  abort(): Promise<void>;
}

interface Writable {
  write(data: BufferSource | Blob | { type: 'write'; position: number; data: BufferSource }): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
type SaveWindow = Window & {
  showSaveFilePicker?: (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) =>
    Promise<{ createWritable(): Promise<Writable> }>;
};

export const canSaveToDisk = () => typeof (window as SaveWindow).showSaveFilePicker === 'function';

interface Track { width: number; height: number; fps: number }

/** Asks where to save, then streams frames to that file. Throws if the user cancels the picker. */
export async function diskMovWriter(fileName: string, track: Track): Promise<MovWriter> {
  const handle = await (window as SaveWindow).showSaveFilePicker!({
    suggestedName: fileName,
    types: [{ description: 'QuickTime movie', accept: { 'video/quicktime': ['.mov'] } }],
  });
  const out = await handle.createWritable();
  const index = new Index(track);
  await out.write(index.header());
  return {
    async addFrame(png) {
      index.add(png.size);
      await out.write(png);
    },
    async close() {
      await out.write(index.moov());
      // Go back and fill in the mdat size now that it's known.
      await out.write({ type: 'write', position: index.mdatSizeOffset, data: u64(index.mdatSize()) });
      await out.close();
    },
    async abort() { await out.abort(); },
  };
}

/** Builds the whole file in memory and downloads it. Fine for short clips; browsers back big Blobs with disk. */
export function memoryMovWriter(fileName: string, track: Track): MovWriter {
  const index = new Index(track);
  const header = index.header();
  const frames: Blob[] = [];
  return {
    async addFrame(png) {
      index.add(png.size);
      frames.push(png);
    },
    async close() {
      header.set(u64(index.mdatSize()), index.mdatSizeOffset);
      const blob = new Blob([header, ...frames, index.moov()], { type: 'video/quicktime' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    async abort() { frames.length = 0; },
  };
}

// ---------------------------------------------------------------------------------------------------------

/** Frame bookkeeping plus the QuickTime atoms around the frame data. */
class Index {
  /** Ticks per second; each frame lasts 100 ticks, so any whole-number frame rate is exact. */
  private readonly timescale: number;
  private readonly sizes: number[] = [];
  private readonly offsets: number[] = [];
  private position: number;
  readonly mdatSizeOffset: number;
  private readonly mdatStart: number;

  constructor(private track: Track) {
    this.timescale = track.fps * 100;
    const ftyp = 20;                 // size + 'ftyp' + major + minor + one compatible brand
    this.mdatStart = ftyp;
    this.mdatSizeOffset = ftyp + 8;  // after the 32-bit size (=1) and 'mdat'
    this.position = ftyp + 16;       // frames start after the 16-byte large-size mdat header
  }

  header(): Uint8Array<ArrayBuffer> {
    return concat(
      atom('ftyp', str('qt  '), u32(0x20050300), str('qt  ')),
      // 64-bit mdat: size field 1 means "real size follows"; filled in by close().
      u32(1), str('mdat'), u64(0),
    );
  }

  add(size: number) {
    this.offsets.push(this.position);
    this.sizes.push(size);
    this.position += size;
  }

  mdatSize() {
    return this.position - this.mdatStart;
  }

  moov(): Uint8Array<ArrayBuffer> {
    const { width, height } = this.track;
    const n = this.sizes.length;
    const duration = n * 100;
    const matrix = concat(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000));

    const mvhd = atom('mvhd', u32(0), u32(0), u32(0), u32(this.timescale), u32(duration),
      u32(0x10000), u16(0x100), zeros(10), matrix, zeros(24), u32(2));
    const tkhd = atom('tkhd', u32(0x0000000f), u32(0), u32(0), u32(1), u32(0), u32(duration),
      zeros(8), u16(0), u16(0), u16(0), u16(0), matrix, u32(width << 16), u32(height << 16));
    const mdhd = atom('mdhd', u32(0), u32(0), u32(0), u32(this.timescale), u32(duration), u16(0x55c4), u16(0));
    const hdlr = (type: string, sub: string, name: string) =>
      atom('hdlr', u32(0), str(type), str(sub), u32(0), u32(0), u32(0), pascal(name));
    // graphics mode 0x100 = straight alpha, so editors composite with the alpha channel.
    const vmhd = atom('vmhd', u32(1), u16(0x100), u16(0), u16(0), u16(0));
    const dinf = atom('dinf', atom('dref', u32(0), u32(1), atom('alis', u32(1))));

    const pngEntry = atom('png ',
      zeros(6), u16(1),               // reserved, data reference index
      u16(0), u16(0), str('appl'),    // version, revision, vendor
      u32(0), u32(0x400),             // temporal / spatial quality
      u16(width), u16(height),
      u32(72 << 16), u32(72 << 16),   // 72 dpi
      u32(0), u16(1),                 // data size, frames per sample
      fixedName('PNG', 32),
      u16(32),                        // depth 32 = has alpha
      u16(0xffff));                   // no colour table
    const stsd = atom('stsd', u32(0), u32(1), pngEntry);
    const stts = atom('stts', u32(0), u32(1), u32(n), u32(100));
    const stsc = atom('stsc', u32(0), u32(1), u32(1), u32(1), u32(1)); // one frame per chunk
    const stszBody = new Uint8Array(12 + n * 4);
    const sz = new DataView(stszBody.buffer);
    sz.setUint32(4, 0);
    sz.setUint32(8, n);
    this.sizes.forEach((s, i) => sz.setUint32(12 + i * 4, s));
    const co64Body = new Uint8Array(8 + n * 8);
    const co = new DataView(co64Body.buffer);
    co.setUint32(4, n);
    this.offsets.forEach((o, i) => co.setBigUint64(8 + i * 8, BigInt(o)));
    const stbl = atom('stbl', stsd, stts, stsc, atom('stsz', stszBody), atom('co64', co64Body));

    const minf = atom('minf', vmhd, hdlr('dhlr', 'alis', 'DataHandler'), dinf, stbl);
    const mdia = atom('mdia', mdhd, hdlr('mhlr', 'vide', 'VideoHandler'), minf);
    return atom('moov', mvhd, atom('trak', tkhd, mdia));
  }
}

// ---- byte helpers ----

function atom(type: string, ...parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const body = concat(...parts);
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(str(type), 4);
  out.set(body, 8);
  return out;
}
function concat(...parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const str = (s: string) => new Uint8Array([...s].map(c => c.charCodeAt(0)));
const zeros = (n: number) => new Uint8Array(n);
function u16(v: number) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v); return b; }
function u32(v: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0); return b; }
function u64(v: number) { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v)); return b; }
/** QuickTime handler names are Pascal strings (length byte first). */
const pascal = (s: string) => concat(new Uint8Array([s.length]), str(s));
/** Fixed-size Pascal string, as the sample description's compressor name. */
function fixedName(s: string, size: number) {
  const b = new Uint8Array(size);
  b[0] = s.length;
  b.set(str(s), 1);
  return b;
}
