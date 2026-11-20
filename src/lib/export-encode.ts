// Heavy export work with no DOM: bitmap -> PNG/JPEG/WebP (OffscreenCanvas), PDF pages (pdf-lib, lazy), ZIP (store), PNG text chunk.
// Runs inside export-worker.ts (off the main thread); export-run.ts falls back to calling these directly when workers are unavailable.
import type { PageSize } from "./export-job";

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b: Uint8Array, c = 0xffffffff) { for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return c; }

export interface RasterJob { bitmap: ImageBitmap; bg: string | null; aspect: number; type: "image/png" | "image/jpeg" | "image/webp"; quality: number }
/** Composite a bitmap on its background (optionally letterboxed to a fixed aspect) and encode it. */
export async function encodeBitmap(j: RasterJob): Promise<{ blob: Blob; width: number; height: number }> {
  const bw = j.bitmap.width, bh = j.bitmap.height;
  let W = bw, H = bh;
  if (j.aspect > 0) { if (bw / bh < j.aspect) W = Math.round(bh * j.aspect); else H = Math.round(bw / j.aspect); }
  const cv = new OffscreenCanvas(W, H);
  const ctx = cv.getContext("2d")!;
  if (j.bg) { ctx.fillStyle = j.bg; ctx.fillRect(0, 0, W, H); }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(j.bitmap, Math.round((W - bw) / 2), Math.round((H - bh) / 2));
  j.bitmap.close();
  const blob = await cv.convertToBlob({ type: j.type, quality: j.type === "image/png" ? undefined : j.quality });
  return { blob, width: W, height: H };
}

/** Add a tEXt chunk (e.g. the scene JSON) right after IHDR so the PNG reopens as an editable file. */
export function pngWithText(png: Uint8Array, key: string, text: string): Uint8Array {
  const enc = new TextEncoder();
  const k = enc.encode(key), v = enc.encode(btoa(unescape(encodeURIComponent(text))));
  const body = new Uint8Array(k.length + 1 + v.length); body.set(k); body.set(v, k.length + 1);
  const chunk = new Uint8Array(12 + body.length); const dv = new DataView(chunk.buffer);
  dv.setUint32(0, body.length); chunk.set(enc.encode("tEXt"), 4); chunk.set(body, 8);
  dv.setUint32(8 + body.length, (crc32(chunk.subarray(4, 8 + body.length)) ^ 0xffffffff) >>> 0);
  const at = 33; // 8 signature + 25 IHDR chunk
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, at)); out.set(chunk, at); out.set(png.subarray(at), at + chunk.length);
  return out;
}

export interface ZipFile { name: string; data: Uint8Array }
/** Minimal ZIP writer (stored, no compression: images are already compressed). */
export function zipStore(files: ZipFile[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = (crc32(f.data) ^ 0xffffffff) >>> 0;
    const lh = new Uint8Array(30 + name.length), d = new DataView(lh.buffer);
    d.setUint32(0, 0x04034b50, true); d.setUint16(4, 20, true); d.setUint16(6, 0x0800, true); d.setUint32(14, crc, true); d.setUint32(18, f.data.length, true); d.setUint32(22, f.data.length, true); d.setUint16(26, name.length, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length), c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    ch.set(name, 46);
    parts.push(lh, f.data); central.push(ch); off += lh.length + f.data.length;
  }
  const csize = central.reduce((n, x) => n + x.length, 0);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, end], out = new Uint8Array(off + csize + 22);
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

export interface PdfPageIn { bytes: Uint8Array; kind: "png" | "jpg"; width: number; height: number }
export interface PdfLayout { page: PageSize; orient: "landscape" | "portrait"; marginMm: number; title: string }
const MM = 72 / 25.4;
const SIZES: Record<Exclude<PageSize, "fit">, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792], "16:9": [960, 540] };
/** One image per page, centred inside the margins and scaled to fit. */
export async function buildPdf(pages: PdfPageIn[], lay: PdfLayout, progress?: (i: number) => void): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle(lay.title); doc.setCreator("Lumen"); doc.setProducer("Lumen");
  let i = 0;
  for (const p of pages) {
    const img = p.kind === "png" ? await doc.embedPng(p.bytes) : await doc.embedJpg(p.bytes);
    const m = lay.marginMm * MM;
    let pw: number, ph: number;
    if (lay.page === "fit") { pw = p.width * 0.75 + (lay.marginMm ? 2 * m : 0); ph = p.height * 0.75 + (lay.marginMm ? 2 * m : 0); }
    else { [pw, ph] = SIZES[lay.page]; const land = lay.page === "16:9" ? true : lay.orient === "landscape"; if (land !== pw > ph) [pw, ph] = [ph, pw]; if (lay.page === "16:9" && lay.orient === "portrait") [pw, ph] = [540, 960]; }
    const page = doc.addPage([pw, ph]);
    const k = Math.min((pw - 2 * m) / p.width, (ph - 2 * m) / p.height);
    const w = p.width * k, h = p.height * k;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    progress?.(++i);
  }
  return doc.save();
}
