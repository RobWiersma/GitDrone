/**
 * Betaflight OSD fonts for the DJI goggles (WTFOS msp-osd), in either of its formats: the older .bin (256 glyphs stored
 * one after another, each width*height RGBA pixels) or the .png msp-osd uses since 0.12 (four pages of glyphs side by
 * side, one glyph per row). Outlines and colours are baked into the glyphs, so they draw as-is.
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

/**
 * Where to get .bin fonts: msp-osd 0.11.1, the last release that shipped them (font_bf_hd.bin, and font.bin / font_hd.bin,
 * its generic ones), and the third-party packs its README lists.
 */
export const WTFOS_FONTS_URL = 'https://github.com/fpv-wtf/msp-osd/tree/v0.11.1/fonts';
export const WTFOS_FONT_PACKS_URL = 'https://github.com/fpv-wtf/msp-osd/tree/v0.11.1#suggested-third-party-fonts';

const isPng = (buffer: ArrayBuffer) => {
  const b = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
  return b.length === 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
};

export async function parseGlyphFont(name: string, buffer: ArrayBuffer): Promise<GlyphFont> {
  return isPng(buffer) ? parsePngFont(name, buffer) : parseBinFont(name, buffer);
}

/**
 * A msp-osd .png font (font_btfl.png, font_btfl_hd.png), or a Walksnail one (its _36 and _24 files are the same format): up
 * to 4 pages side by side, 256 glyphs down each. Betaflight's glyphs are the first page, the same ones the .bin holds.
 */
async function parsePngFont(name: string, buffer: ArrayBuffer): Promise<GlyphFont> {
  const image = await createImageBitmap(new Blob([buffer], { type: 'image/png' }));
  const size = Object.values(SIZES).find(([w, h]) => [1, 2, 3, 4].some(pages => image.width === w * pages) && image.height === h * 256);
  if (!size) {
    image.close();
    throw new Error('Not a WTFOS OSD font. Use font_btfl.png or font_btfl_hd.png, or font_bf.bin from the goggles font folder.');
  }
  const [w, h] = size;
  const atlas = document.createElement('canvas');
  atlas.width = w * 16;
  atlas.height = h * 16;
  const ctx = atlas.getContext('2d')!;
  for (let g = 0; g < 256; g++) ctx.drawImage(image, 0, g * h, w, h, (g % 16) * w, Math.floor(g / 16) * h, w, h);
  image.close();
  return { name, glyphW: w, glyphH: h, atlas };
}

function parseBinFont(name: string, buffer: ArrayBuffer): GlyphFont {
  const perGlyph = buffer.byteLength / 256;
  const size = SIZES[perGlyph];
  if (!Number.isInteger(perGlyph) || !size) {
    throw new Error('Not a WTFOS OSD font. Use font_btfl.png or font_btfl_hd.png, or font_bf.bin from the goggles font folder.');
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

/**
 * A font slot by number, carried in a private-use character (U+E000 + code). Use it for symbols whose codes fall on
 * lowercase letters (0x61-0x7A); glyphCodes maps it straight back to the slot without capitalising.
 */
export const glyph = (code: number) => String.fromCharCode(0xe000 + code);

/** Betaflight symbol codes (src/main/drivers/osd_symbols.h). */
export const SYM = {
  volt: '\x06', mah: '\x07', m: '\x0C', home: '\x11', thr: '\x04', alt: '\x7F',
  amp: '\x9A', fly: '\x9C', kph: '\x9E', mph: '\x9D', watt: 'W', rssi: '\x01',
  /** SYM_LINK_QUALITY, before the LQ number. */
  lq: '\x7B',
  /** SYM_SPEED is 0x70, the same code as "p", so it's marked as a raw glyph or text drawing would capitalise it. */
  speed: glyph(0x70),
  km: '\x7D', mi: '\x7E',
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
    return saved ? await parseGlyphFont(saved.name, saved.buffer) : null;
  } catch {
    return null;
  }
}
