// Geometry for the PDF reader: selection rects → normalized page rects, and where a page paints its images
// (so dark-mode inversion can leave photos and figures alone). Pure functions, see scripts/pdf.test.ts.
import type { Rect } from "./pdf-format";

export interface Box { left: number; top: number; width: number; height: number }

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Merges rects on the same text line (vertical overlap ≥ 50 %, horizontal gap ≤ `gap`) into one. */
export function mergeLines(rs: Rect[], gap = 0.02): Rect[] {
  const sorted = [...rs].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out: Rect[] = [];
  for (const r of sorted) {
    const hit = out.find((o) => {
      const top = Math.max(o[1], r[1]), bot = Math.min(o[1] + o[3], r[1] + r[3]);
      const vOverlap = bot - top >= 0.5 * Math.min(o[3], r[3]);
      const hGap = Math.max(o[0], r[0]) - Math.min(o[0] + o[2], r[0] + r[2]);
      return vOverlap && hGap <= gap;
    });
    if (!hit) { out.push([...r] as Rect); continue; }
    const x0 = Math.min(hit[0], r[0]), y0 = Math.min(hit[1], r[1]);
    const x1 = Math.max(hit[0] + hit[2], r[0] + r[2]), y1 = Math.max(hit[1] + hit[3], r[1] + r[3]);
    hit[0] = x0; hit[1] = y0; hit[2] = x1 - x0; hit[3] = y1 - y0;
  }
  return out;
}

/** Client rects of a selection → rects relative to the page box (0…1), merged per line, tiny ones dropped. */
export function normRects(rects: Box[], page: Box): Rect[] {
  if (page.width <= 0 || page.height <= 0) return [];
  const rs: Rect[] = [];
  for (const r of rects) {
    const x0 = clamp01((r.left - page.left) / page.width), y0 = clamp01((r.top - page.top) / page.height);
    const x1 = clamp01((r.left + r.width - page.left) / page.width), y1 = clamp01((r.top + r.height - page.top) / page.height);
    if (x1 - x0 < 0.002 || y1 - y0 < 0.003) continue;
    rs.push([x0, y0, x1 - x0, y1 - y0]);
  }
  return mergeLines(rs);
}

/** Rect from two drag points (any direction), normalized against the page box. */
export function dragRect(ax: number, ay: number, bx: number, by: number, page: Box): Rect {
  const x0 = clamp01((Math.min(ax, bx) - page.left) / page.width), y0 = clamp01((Math.min(ay, by) - page.top) / page.height);
  const x1 = clamp01((Math.max(ax, bx) - page.left) / page.width), y1 = clamp01((Math.max(ay, by) - page.top) / page.height);
  return [x0, y0, x1 - x0, y1 - y0];
}

/** Bounding box of all rects (for margin markers / flashing / scrolling to a highlight). */
export function unionRect(rs: Rect[]): Rect | null {
  if (!rs.length) return null;
  const x0 = Math.min(...rs.map((r) => r[0])), y0 = Math.min(...rs.map((r) => r[1]));
  const x1 = Math.max(...rs.map((r) => r[0] + r[2])), y1 = Math.max(...rs.map((r) => r[1] + r[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}

// ------------------------------------------------------------------ image regions from a pdf.js operator list
export type Matrix = [number, number, number, number, number, number];
export const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export interface OpCodes { save: number; restore: number; transform: number; paintImageXObject: number; paintInlineImageXObject: number; paintFormXObjectBegin: number; paintFormXObjectEnd: number }

/**
 * Device-space boxes (viewport pixels) where the page paints raster images. pdf.js paints an image into the unit
 * square of the current transform, so we replay save / restore / transform (and form matrices) from `base`
 * (the viewport transform) and map the unit square. Image masks (stencils drawn in the fill colour) are not images.
 */
export function imageRegions(fnArray: ArrayLike<number>, argsArray: ArrayLike<unknown>, ops: OpCodes, base: Matrix): Box[] {
  const out: Box[] = [];
  const stack: Matrix[] = [];
  let ctm = base;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null;
    if (fn === ops.save) stack.push(ctm);
    else if (fn === ops.restore) ctm = stack.pop() ?? ctm;
    else if (fn === ops.transform && args) ctm = mul(ctm, args.slice(0, 6) as Matrix);
    else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = args?.[0] as number[] | null | undefined;
      if (m && m.length >= 6) ctm = mul(ctm, Array.from(m).slice(0, 6) as Matrix);
    } else if (fn === ops.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject) {
      const pts = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)];
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const left = Math.min(...xs), top = Math.min(...ys);
      const w = Math.max(...xs) - left, h = Math.max(...ys) - top;
      if (w > 4 && h > 4) out.push({ left, top, width: w, height: h });
    }
  }
  return out;
}
