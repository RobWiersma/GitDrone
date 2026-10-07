/**
 * Betaflight OSD fonts in the DJI goggles (WTFOS msp-osd) .bin format: 256 glyphs stored one after another,
 * each width*height RGBA pixels. Outlines and colours are baked into the glyphs, so they draw as-is.
 */
export interface GlyphFont {
  name: string;
  glyphW: number;
  glyphH: number;
  /** 16 glyphs per row, 16 rows. */
  atlas: HTMLCanvasElement;
}

/** Glyph sizes msp-osd uses, keyed by bytes per glyph. */
const SIZES: Record<number, [number, number]> = {
  [36 * 54 * 4]: [36, 54], // font_bf.bin (SD grid, larger glyphs)
  [24 * 36 * 4]: [24, 36], // font_bf_hd.bin (HD grid)
};

export function parseGlyphFont(name: string, buffer: ArrayBuffer): GlyphFont {
  const perGlyph = buffer.byteLength / 256;
  const size = SIZES[perGlyph];
  if (!Number.isInteger(perGlyph) || !size) {
    throw new Error('Not a DJI OSD font file. Use font_bf.bin or font_bf_hd.bin from the goggles font folder.');
  }
  const [w, h] = size;
  const bytes = new Uint8ClampedArray(buffer);
  const atlas = document.createElement('canvas');
  atlas.width = w * 16;
  atlas.height = h * 16;
  const ctx = atlas.getContext('2d')!;
  for (let g = 0; g < 256; g++) {
    const glyph = new ImageData(bytes.slice(g * w * h * 4, (g + 1) * w * h * 4), w, h);
    ctx.putImageData(glyph, (g % 16) * w, Math.floor(g / 16) * h);
  }
  return { name, glyphW: w, glyphH: h, atlas };
}

/** Betaflight symbol codes (src/main/drivers/osd_symbols.h). */
export const SYM = {
  volt: '\x06', mah: '\x07', m: '\x0C', home: '\x11', thr: '\x04', alt: '\x7F',
  amp: '\x9A', fly: '\x9C', kph: '\x9E', mph: '\x9D', watt: 'W', rssi: '\x01',
  /** Satellite icon is two glyphs side by side (SYM_SAT_L, SYM_SAT_R). */
  sat: '\x1E\x1F',
  /** Battery bars, full to empty. */
  batt: ['\x90', '\x91', '\x92', '\x93', '\x94', '\x95', '\x96'],
};

// ---- remembering the chosen font (this browser only; never uploaded) ----

const DB = 'gitdrone';
const STORE = 'osd-font';

function open(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

export async function saveFont(name: string, buffer: ArrayBuffer | null) {
  try {
    const db = await open();
    await new Promise<void>((ok, fail) => {
      const tx = db.transaction(STORE, 'readwrite');
      if (buffer) tx.objectStore(STORE).put({ name, buffer }, 'current');
      else tx.objectStore(STORE).delete('current');
      tx.oncomplete = () => ok();
      tx.onerror = () => fail(tx.error);
    });
  } catch { /* private mode or blocked storage: the font just isn't remembered */ }
}

export async function loadSavedFont(): Promise<GlyphFont | null> {
  try {
    const db = await open();
    const saved = await new Promise<{ name: string; buffer: ArrayBuffer } | undefined>((ok, fail) => {
      const req = db.transaction(STORE).objectStore(STORE).get('current');
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    });
    return saved ? parseGlyphFont(saved.name, saved.buffer) : null;
  } catch {
    return null;
  }
}
