import { CraftFix, latLon } from './inspect-log';
import { Box, CLASSES, Detection } from './inspect-model';
import { Sample } from './inspect-scan';

/**
 * Drawing findings over the footage, shared by the page's preview and the exported video so they look the same.
 * Sizes are given for a 540 px tall picture and scaled by `scale` (the picture's height / 540).
 */

export type Placed = Detection & { track: number };

export interface DrawOptions {
  /** The findings to draw (the page's filters). */
  shown: ReadonlySet<number>;
  /** Findings with a cue: drawn solid and marked ⚠ (the rest dashed). */
  flagged: ReadonlySet<number>;
  selected: number | null;
}

/**
 * The boxes at footage time `t`: between two sampled frames, each finding seen in both slides from one box to the
 * other, so the boxes follow the picture instead of jumping every `step` s; others show near their own frame only.
 */
export function detectionsAt(samples: readonly Sample[], step: number, t: number): Placed[] {
  if (!samples.length) return [];
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid].t <= t) lo = mid; else hi = mid - 1;
  }
  const a = samples[lo], b = samples[lo + 1];
  if (t < a.t) return Math.abs(a.t - t) <= step * 0.75 ? a.dets : [];
  if (!b || b.t - a.t > step * 1.6) return t - a.t <= step * 0.75 ? a.dets : [];
  const k = (t - a.t) / (b.t - a.t);
  const later = new Map(b.dets.map(d => [d.track, d]));
  const out: Placed[] = [];
  const inA = new Set<number>();
  for (const d of a.dets) {
    inA.add(d.track);
    const e = later.get(d.track);
    if (e) out.push({ ...d, score: d.score + (e.score - d.score) * k, box: lerpBox(d.box, e.box, k) });
    else if (k < 0.5) out.push(d);
  }
  if (k >= 0.5) for (const e of b.dets) if (!inA.has(e.track)) out.push(e);
  return out;
}

const lerpBox = (a: Box, b: Box, k: number): Box =>
  ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k });

/** Draws `dets` over a `w`×`h` picture whose top left is at (`x0`, `y0`). */
export function drawDetections(ctx: CanvasRenderingContext2D, dets: readonly Placed[], o: DrawOptions,
                               w: number, h: number, scale: number, x0 = 0, y0 = 0) {
  ctx.save();
  ctx.font = `600 ${Math.round(12 * scale)}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  const tagH = Math.round(18 * scale), pad = 4 * scale;
  for (const d of dets) {
    if (!o.shown.has(d.track)) continue;
    const c = CLASSES[d.cls], picked = d.track === o.selected, flagged = o.flagged.has(d.track);
    const x = x0 + d.box.x * w, y = y0 + d.box.y * h, bw = d.box.w * w, bh = d.box.h * h;
    if (picked) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 5 * scale; ctx.strokeRect(x, y, bw, bh); }
    ctx.strokeStyle = c.color;
    ctx.lineWidth = (picked ? 3 : 2) * scale;
    ctx.setLineDash(flagged ? [] : [6 * scale, 4 * scale]);
    ctx.strokeRect(x, y, bw, bh);
    ctx.setLineDash([]);
    const text = `${flagged ? '⚠ ' : ''}${c.label} #${d.track} ${Math.round(d.score * 100)}%`;
    const tw = ctx.measureText(text).width + 2 * pad, ty = y - y0 >= tagH ? y - tagH : y;
    ctx.fillStyle = c.color;
    ctx.fillRect(x, ty, tw, tagH);
    ctx.fillStyle = '#0a0f14';
    ctx.fillText(text, x + pad, ty + 3 * scale);
  }
  ctx.restore();
}

/** The log's readout in the top left corner: height, speed, heading and position. */
export function drawCraft(ctx: CanvasRenderingContext2D, c: CraftFix | null, scale: number, x0 = 0, y0 = 0) {
  if (!c) return;
  const lines = [
    [c.height !== null ? `ALT ${Math.round(c.height)} m` : '', c.speed !== null ? `${c.speed.toFixed(1)} m/s` : '',
      c.heading !== null ? `HDG ${Math.round(c.heading)}°` : ''].filter(Boolean).join('  '),
    (latLon(c) + (c.sats !== null ? `  ${c.sats} sats` : '')).trim(),
  ].filter(Boolean);
  if (!lines.length) return;
  ctx.save();
  ctx.font = `600 ${Math.round(12 * scale)}px ui-monospace, Consolas, monospace`;
  ctx.textBaseline = 'top';
  const line = 16 * scale, m = 8 * scale, pad = 6 * scale;
  const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 2 * pad;
  ctx.fillStyle = 'rgb(10 15 20 / .72)';
  ctx.fillRect(x0 + m, y0 + m, width, lines.length * line + pad + 2 * scale);
  ctx.fillStyle = '#9be564';
  lines.forEach((l, i) => ctx.fillText(l, x0 + m + pad, y0 + m + pad * 0.85 + i * line));
  ctx.restore();
}
