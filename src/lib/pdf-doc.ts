// pdf.js wrapper for the PDF reader: open (attachments, URLs, passwords, progress), outline, page text cache,
// page rendering with dark-mode inversion that leaves images alone, and area capture. No React here.
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { attUrl } from "./api";
import { db } from "./db";
import { t } from "./i18n";
import { imageRegions, type Box, type Matrix } from "./pdf-geom";
import type { Rect } from "./pdf-format";

type PdfJs = typeof import("pdfjs-dist");
let lib: Promise<PdfJs> | null = null;
export function loadPdfJs() {
  lib ??= (async () => {
    const m = await import("pdfjs-dist");
    const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    m.GlobalWorkerOptions.workerSrc = worker;
    return m;
  })();
  return lib;
}

export type PdfDoc = PDFDocumentProxy;
export type PdfPage = PDFPageProxy;

export interface OpenOpts {
  /** Called when the file is encrypted: resolve with the password, or null to give up. `retry` = the last one was wrong. */
  askPassword?: (retry: boolean) => Promise<string | null>;
  onProgress?: (loaded: number, total: number) => void;
}
export class PdfError extends Error {
  constructor(public kind: "missing" | "network" | "password" | "broken", msg: string) { super(msg); }
}

/** Bytes of a `file:` reference: `att:<id>` (local blob first, then the server) or a URL. */
async function fetchBytes(file: string, onProgress?: (l: number, t: number) => void): Promise<Uint8Array> {
  if (file.startsWith("att:")) {
    const id = file.slice(4);
    const b = await db.blobs.get(id);
    if (b) { onProgress?.(b.blob.size, b.blob.size); return new Uint8Array(await b.blob.arrayBuffer()); }
    return fetchUrl(attUrl(id), onProgress);
  }
  return fetchUrl(file, onProgress);
}
async function fetchUrl(url: string, onProgress?: (l: number, t: number) => void): Promise<Uint8Array> {
  let res: Response;
  try { res = await fetch(url); } catch { throw new PdfError("network", t("Couldn't download the file. Check the connection and try again.")); }
  if (res.status === 404) throw new PdfError("missing", t("The file isn't on this device or the server yet."));
  if (!res.ok) throw new PdfError("network", t("The server answered {status}.", { status: String(res.status) }));
  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body || !onProgress) return new Uint8Array(await res.arrayBuffer());
  // Large files: read in parts so the reader can show how much has arrived.
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

export async function openPdf(file: string, o: OpenOpts = {}): Promise<PdfDoc> {
  if (!file) throw new PdfError("missing", t("This PDF note has no file. Add `file: att:<id>` or a URL to its front matter."));
  const pdfjs = await loadPdfJs();
  const data = await fetchBytes(file, o.onProgress);
  if (data.byteLength < 5) throw new PdfError("broken", t("The file is empty."));
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  let tries = 0;
  task.onPassword = (update: (pw: string) => void, reason: number) => {
    const retry = reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD || tries > 0;
    tries++;
    void (o.askPassword?.(retry) ?? Promise.resolve(null)).then((pw) => {
      if (pw == null) void task.destroy();
      else update(pw);
    });
  };
  try {
    return await task.promise;
  } catch (e) {
    const name = (e as { name?: string })?.name ?? "";
    if (name === "PasswordException" || tries > 0) throw new PdfError("password", t("This PDF is password-protected."));
    throw new PdfError("broken", t("This file couldn't be read as a PDF."));
  }
}

// ------------------------------------------------------------------ outline
export interface OutlineItem { title: string; page: number; depth: number }
export async function flatOutline(doc: PdfDoc): Promise<OutlineItem[]> {
  const raw = await doc.getOutline().catch(() => null);
  if (!raw) return [];
  const out: OutlineItem[] = [];
  type Node = { title: string; dest: unknown; items: Node[] };
  const walk = async (items: Node[], depth: number) => {
    for (const it of items) {
      let page = 0;
      try {
        const dest = typeof it.dest === "string" ? await doc.getDestination(it.dest) : (it.dest as unknown[] | null);
        if (dest && dest[0] != null) page = typeof dest[0] === "number" ? dest[0] + 1 : (await doc.getPageIndex(dest[0] as { num: number; gen: number })) + 1;
      } catch { /* unresolvable bookmark */ }
      out.push({ title: it.title, page, depth });
      if (it.items?.length && out.length < 2000) await walk(it.items, depth + 1);
    }
  };
  await walk(raw as Node[], 0);
  return out;
}

// ------------------------------------------------------------------ page text (search, offsets, "no text layer")
const texts = new WeakMap<PdfDoc, Map<number, Promise<string>>>();
/** The page's text, items joined without separators (the same string the text layer's spans spell). */
export function pageText(doc: PdfDoc, n: number): Promise<string> {
  let m = texts.get(doc);
  if (!m) texts.set(doc, (m = new Map()));
  if (!m.has(n)) m.set(n, doc.getPage(n).then((p) => p.getTextContent()).then((tc) => tc.items.map((i) => ("str" in i ? i.str : "")).join("")).catch(() => ""));
  return m.get(n)!;
}
/** Scanned PDFs have (almost) no text: sample a few pages. */
export async function hasTextLayer(doc: PdfDoc): Promise<boolean> {
  const n = Math.min(doc.numPages, 3);
  for (let i = 1; i <= n; i++) if ((await pageText(doc, i)).replace(/\s/g, "").length > 20) return true;
  return false;
}

// ------------------------------------------------------------------ rendering
let filterOk: boolean | null = null;
const canFilter = () => (filterOk ??= (() => { try { const c = document.createElement("canvas").getContext("2d")!; c.filter = "invert(1)"; return c.filter === "invert(1)"; } catch { return false; } })());

/** Inverts a canvas in place for dark mode, then paints the image regions back un-inverted. */
async function invertKeepImages(page: PdfPage, cv: HTMLCanvasElement, transform: Matrix, dpr: number) {
  const pdfjs = await loadPdfJs();
  const ctx = cv.getContext("2d")!;
  const orig = document.createElement("canvas");
  orig.width = cv.width; orig.height = cv.height;
  orig.getContext("2d")!.drawImage(cv, 0, 0);
  if (canFilter()) {
    ctx.save(); ctx.filter = "invert(1) hue-rotate(180deg)"; ctx.globalCompositeOperation = "copy"; ctx.drawImage(orig, 0, 0); ctx.restore();
  } else {
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
    ctx.putImageData(img, 0, 0);
  }
  try {
    const ol = await page.getOperatorList();
    const regions = imageRegions(ol.fnArray, ol.argsArray, pdfjs.OPS as unknown as Parameters<typeof imageRegions>[2], transform);
    for (const r of regions) {
      const x = Math.max(0, Math.floor(r.left * dpr)), y = Math.max(0, Math.floor(r.top * dpr));
      const w = Math.min(cv.width - x, Math.ceil(r.width * dpr)), h = Math.min(cv.height - y, Math.ceil(r.height * dpr));
      if (w > 0 && h > 0) ctx.drawImage(orig, x, y, w, h, x, y, w, h);
    }
  } catch { /* keep the fully inverted page */ }
}

export interface Rendered { canvas: HTMLCanvasElement; textLayer: HTMLDivElement; hasText: boolean; cancel: () => void }
/**
 * Renders page `n` at `cssWidth` CSS pixels into `box`: a canvas plus a selectable text layer.
 * Returns a cancel handle; pdf.js RenderingCancelledException is swallowed.
 */
export async function renderPage(doc: PdfDoc, n: number, box: HTMLElement, cssWidth: number, opts: { invert: boolean; signal: { cancelled: boolean } }): Promise<Rendered | null> {
  const pdfjs = await loadPdfJs();
  const page = await doc.getPage(n);
  if (opts.signal.cancelled) return null;
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: cssWidth / base.width });
  const dpr = Math.min(2, devicePixelRatio || 1);
  const cv = document.createElement("canvas");
  cv.className = "pdfr-canvas";
  cv.width = Math.floor(vp.width * dpr); cv.height = Math.floor(vp.height * dpr);
  const task = page.render({ canvasContext: cv.getContext("2d")!, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
  const cancel = () => { try { task.cancel(); } catch { /* done */ } };
  try { await task.promise; } catch { return null; }
  if (opts.signal.cancelled) return null;
  if (opts.invert) await invertKeepImages(page, cv, vp.transform as Matrix, dpr);
  const tl = document.createElement("div");
  tl.className = "textLayer";
  tl.style.setProperty("--scale-factor", String(vp.scale));
  let hasText = false;
  try {
    const tc = await page.getTextContent();
    hasText = tc.items.some((i) => "str" in i && i.str.trim());
    await new pdfjs.TextLayer({ textContentSource: tc, container: tl, viewport: vp }).render();
  } catch { /* text layer optional */ }
  if (opts.signal.cancelled) return null;
  const old = box.querySelectorAll(":scope > .pdfr-canvas, :scope > .textLayer");
  old.forEach((x) => x.remove());
  box.prepend(cv, tl);
  return { canvas: cv, textLayer: tl, hasText, cancel };
}

/** Crops a normalized rect out of a rendered page canvas → PNG blob (area highlights). */
export function captureArea(canvas: HTMLCanvasElement, r: Rect): Promise<Blob | null> {
  const x = Math.round(r[0] * canvas.width), y = Math.round(r[1] * canvas.height);
  const w = Math.max(1, Math.round(r[2] * canvas.width)), h = Math.max(1, Math.round(r[3] * canvas.height));
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  out.getContext("2d")!.drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return new Promise((res) => out.toBlob(res, "image/png"));
}

/** Renders page `n` off-screen (never inverted) and crops a normalized rect → PNG (area highlights). */
export async function cropPage(doc: PdfDoc, n: number, r: Rect, cssWidth: number): Promise<Blob | null> {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(4, Math.max(1.5, (cssWidth * 2) / base.width)) });
  const cv = document.createElement("canvas");
  cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
  await page.render({ canvasContext: cv.getContext("2d")!, viewport: vp }).promise;
  return captureArea(cv, r);
}

/** Text of the spans whose centre lies inside a normalized rect (the words under an area highlight). */
export function textInRect(pageEl: HTMLElement, r: Rect): string {
  const pb = pageEl.getBoundingClientRect();
  const out: string[] = [];
  pageEl.querySelectorAll<HTMLElement>(".textLayer span:not(.markedContent)").forEach((s) => {
    const b = s.getBoundingClientRect();
    const cx = (b.left + b.width / 2 - pb.left) / pb.width, cy = (b.top + b.height / 2 - pb.top) / pb.height;
    if (cx >= r[0] && cx <= r[0] + r[2] && cy >= r[1] && cy <= r[1] + r[3] && s.textContent?.trim()) out.push(s.textContent.trim());
  });
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/** Renders page `n` small (thumbnails). */
export async function renderThumb(doc: PdfDoc, n: number, width: number): Promise<string> {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: (width * Math.min(2, devicePixelRatio || 1)) / base.width });
  const cv = document.createElement("canvas");
  cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
  await page.render({ canvasContext: cv.getContext("2d")!, viewport: vp }).promise;
  return cv.toDataURL("image/jpeg", 0.7);
}

/** Text of a DOM range inside a text layer → offset into the page text (spans concatenated), or null. */
export function textOffset(textLayer: HTMLElement, range: Range): [number, number] | null {
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  let pos = 0, start = -1, end = -1;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const len = t.textContent?.length ?? 0;
    if (t === range.startContainer) start = pos + range.startOffset;
    if (t === range.endContainer) { end = pos + range.endOffset; break; }
    pos += len;
  }
  return start >= 0 && end > start ? [start, end - start] : null;
}

/** DOM ranges for text offsets in a text layer (search hits). */
export function rangesFor(textLayer: HTMLElement, spans: [number, number][]): Range[] {
  const nodes: { node: Text; at: number }[] = [];
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  let pos = 0;
  for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) { nodes.push({ node: t, at: pos }); pos += t.data.length; }
  const find = (o: number) => { let lo = 0, hi = nodes.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nodes[mid].at <= o) lo = mid; else hi = mid - 1; } return nodes[lo]; };
  const out: Range[] = [];
  for (const [s, len] of spans) {
    if (!nodes.length) break;
    const a = find(s), b = find(s + len);
    if (!a || !b) continue;
    const r = document.createRange();
    try { r.setStart(a.node, Math.min(a.node.data.length, s - a.at)); r.setEnd(b.node, Math.min(b.node.data.length, s + len - b.at)); out.push(r); } catch { /* skip */ }
  }
  return out;
}
export type { Box };
