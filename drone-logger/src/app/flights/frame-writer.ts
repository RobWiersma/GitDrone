/** Where exported overlay frames go: a folder on disk (Chrome/Edge) or a zip download (everything else). */
export interface FrameWriter {
  write(name: string, data: Blob): Promise<void>;
  /** Finishes the export; for zips this triggers the download. */
  close(): Promise<void>;
}

// Minimal typing for the File System Access API (Chromium only, not in lib.dom yet).
interface DirectoryHandle {
  getFileHandle(name: string, options: { create: boolean }): Promise<{ createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }> }>;
}
type PickerWindow = Window & { showDirectoryPicker?: (o?: { mode?: 'readwrite'; id?: string }) => Promise<DirectoryHandle> };

export const canWriteFolders = () => typeof (window as PickerWindow).showDirectoryPicker === 'function';

/** Asks the user for a folder and writes each frame straight into it, so memory use stays flat even at 4K. */
export async function folderWriter(): Promise<FrameWriter> {
  const dir = await (window as PickerWindow).showDirectoryPicker!({ mode: 'readwrite', id: 'gitdrone-overlay' });
  return {
    async write(name, data) {
      const file = await dir.getFileHandle(name, { create: true });
      const out = await file.createWritable();
      await out.write(data);
      await out.close();
    },
    async close() { /* nothing to flush */ },
  };
}

/**
 * Stored (uncompressed) zip built from Blob parts. PNGs are already compressed, so deflating again would only cost time.
 * Browsers back large Blobs with disk, but a long 4K export can still be several GB; folders are preferred.
 */
export function zipWriter(fileName: string): FrameWriter {
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  let count = 0;

  return {
    async write(name, data) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      const nameBytes = new Uint8Array(new TextEncoder().encode(name));
      const crc = crc32(bytes);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); // local file header
      local.setUint16(4, 20, true);         // version needed
      local.setUint16(8, 0, true);          // method: stored
      local.setUint32(14, crc, true);
      local.setUint32(18, bytes.length, true);
      local.setUint32(22, bytes.length, true);
      local.setUint16(26, nameBytes.length, true);
      parts.push(local.buffer, nameBytes, bytes);

      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true); // central directory header
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, bytes.length, true);
      entry.setUint32(24, bytes.length, true);
      entry.setUint16(28, nameBytes.length, true);
      entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), nameBytes);

      offset += 30 + nameBytes.length + bytes.length;
      count++;
    },
    async close() {
      const size = central.reduce((n, c) => n + c.length, 0);
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true); // end of central directory
      end.setUint16(8, count, true);
      end.setUint16(10, count, true);
      end.setUint32(12, size, true);
      end.setUint32(16, offset, true);
      const blob = new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  };
}

let table: Uint32Array | null = null;
function crc32(bytes: Uint8Array<ArrayBuffer>): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
