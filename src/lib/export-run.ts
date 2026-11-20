// The export pipeline behind the dialog: build -> rasterise / encode (worker) -> PDF / ZIP (worker) -> file.
import { maxScale, themeBackground } from "./diagram-export";
import { crc32 as _crc, buildPdf, encodeBitmap, pngWithText, zipStore, type PdfPageIn, type RasterJob, type ZipFile } from "./export-encode";
import type { ExportOptions, ExportScope, MarkdownResult, Rendered, VisualExportJob } from "./export-job";
import { t } from "./i18n";

void _crc;
const IMG = new Set(["png", "jpeg", "webp", "svg", "pdf"]);
export const isImageFormat = (f: string) => IMG.has(f);
export const EXTS: Record<string, string> = { png: "png", jpeg: "jpg", webp: "webp", svg: "svg", pdf: "pdf", mermaid: "mmd", markdown: "md" };
const MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
export const PICKER_SCOPES: Record<string, "frames" | "groups" | "layers"> = { frames: "frames", groups: "groups", layers: "layers" };

// ------------------------------------------------------------------ worker client (falls back to the main thread)
let worker: Worker | null | undefined;
const pending = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void; progress?: (i: number) => void }>();
let seq = 0;
function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof OffscreenCanvas === "undefined") throw new Error("no OffscreenCanvas");
    const w = new Worker(new URL("./export-worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e) => {
      const m = e.data, p = pending.get(m.id);
      if (!p) return;
      if (m.progress !== undefined) { p.progress?.(m.progress); return; }
      pending.delete(m.id);
      if (m.error) p.fail(new Error(m.error)); else p.ok(m.result);
    };
    w.onerror = () => { worker = null; for (const p of pending.values()) p.fail(new Error(t("The export worker failed"))); pending.clear(); };
    worker = w;
  } catch { worker = null; }
  return worker;
}
function call<T>(msg: Record<string, unknown>, transfer: Transferable[], progress?: (i: number) => void): Promise<T> {
  const w = getWorker();
  if (!w) {
    // main-thread fallback
    if (msg.op === "raster") return encodeBitmap(msg as unknown as RasterJob) as Promise<T>;
    if (msg.op === "pdf") return buildPdf(msg.pages as PdfPageIn[], msg.layout as never, progress) as Promise<T>;
    return Promise.resolve(zipStore(msg.files as ZipFile[]) as T);
  }
  const id = ++seq;
  return new Promise<T>((ok, fail) => { pending.set(id, { ok: ok as (v: unknown) => void, fail, progress }); w.postMessage({ ...msg, id }, transfer); });
}

// ------------------------------------------------------------------ helpers
export function resolveBg(job: VisualExportJob, o: ExportOptions): string | null {
  let bg: string | null = o.background === "transparent" ? null : o.background === "custom" ? o.color : o.background === "board" ? job.boardBackground ?? themeBackground(o.theme) : themeBackground(o.theme);
  if (!bg && o.format === "jpeg") bg = themeBackground(o.theme);
  return bg;
}
/** Options with the background resolved, as handed to `build`. */
export const withBg = (job: VisualExportJob, o: ExportOptions): ExportOptions => ({ ...o, bgColor: resolveBg(job, o) });
const sized = (svg: string, w: number, h: number) => svg.replace(/<svg\b[^>]*>/, (tag) => {
  const strip = tag.replace(/\s(width|height)="[^"]*"/g, "");
  return strip.replace(/^<svg\b/, `<svg width="${w}" height="${h}"`);
});
/** Letterbox an SVG into a fixed aspect on a background. */
function fitSvg(svg: string, w: number, h: number, aspect: number, bg: string | null) {
  const W = Math.max(w, h * aspect), H = Math.max(h, w / aspect);
  const inner = svg.replace(/^<\?xml[^>]*\?>\s*/, "").replace(/<svg\b/, `<svg x="${(W - w) / 2}" y="${(H - h) / 2}"`);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${Math.round(W)}" height="${Math.round(H)}">${bg ? `<rect width="${W}" height="${H}" fill="${bg}"/>` : ""}${inner}</svg>`, width: W, height: H };
}
async function svgBitmap(svg: string, W: number, H: number): Promise<ImageBitmap> {
  const url = URL.createObjectURL(new Blob([sized(svg, W, H)], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.decoding = "async"; img.src = url;
    await img.decode();
    return await createImageBitmap(img, { resizeWidth: W, resizeHeight: H, resizeQuality: "high" }).catch(() => createImageBitmap(img));
  } finally { URL.revokeObjectURL(url); }
}
const embedSvg = (svg: string, scene: string) => svg.replace(/<svg\b[^>]*>/, (tag) => `${tag}<metadata id="lumen-scene"><![CDATA[${scene.replace(/]]>/g, "]]]]><![CDATA[>")}]]></metadata>`);

export interface Unit { svg?: string; blob?: Blob; width: number; height: number; scale: number; limited?: number }
/** Build one image and encode it for `fmt` (svg stays vector). */
export async function renderUnit(job: VisualExportJob, o: ExportOptions, ids: string[], fmt: "svg" | "png" | "jpeg" | "webp", sceneText?: string): Promise<Unit> {
  const oo = { ...withBg(job, o), format: fmt as ExportOptions["format"] };
  const req = { scope: o.scope as ExportScope, ids, opts: oo, format: fmt, scale: o.scale === "max" ? null : o.scale, maxPx: o.maxPx };
  const r: Rendered = await job.build(req);
  const bg = oo.bgColor;
  if ("svg" in r) {
    let svg = r.svg, w = r.width, h = r.height;
    if (sceneText) svg = embedSvg(svg, sceneText);
    if (fmt === "svg") {
      if (o.aspect > 0) ({ svg, width: w, height: h } = fitSvg(svg, w, h, o.aspect, bg));
      return { svg, width: w, height: h, scale: 1 };
    }
    const want = o.scale === "max" ? o.maxPx / Math.max(w, h) : o.scale;
    const cap = maxScale(w, h), scale = Math.min(want, cap);
    const W = Math.max(1, Math.round(w * scale)), H = Math.max(1, Math.round(h * scale));
    const bitmap = await svgBitmap(svg, W, H);
    const e = await call<{ blob: Blob; width: number; height: number }>({ op: "raster", bitmap, bg, aspect: o.aspect, type: MIME[fmt], quality: o.quality }, [bitmap]);
    let blob = e.blob;
    if (fmt === "png" && sceneText) blob = new Blob([pngWithText(new Uint8Array(await blob.arrayBuffer()), "lumen-scene", sceneText) as BlobPart], { type: "image/png" });
    return { blob, width: e.width, height: e.height, scale, limited: want > cap + 0.01 ? cap : undefined };
  }
  if (fmt === "svg") throw new Error(t("This workspace can't export SVG"));
  if (fmt === "png" && !(o.aspect > 0)) return { blob: r.blob, width: r.width, height: r.height, scale: r.limited ?? req.scale ?? 1, limited: r.limited };
  const bitmap = await createImageBitmap(r.blob);
  const e = await call<{ blob: Blob; width: number; height: number }>({ op: "raster", bitmap, bg, aspect: o.aspect, type: MIME[fmt], quality: o.quality }, [bitmap]);
  return { blob: e.blob, width: e.width, height: e.height, scale: r.limited ?? req.scale ?? 1, limited: r.limited };
}

export interface TextOut { blob: Blob; text?: string; ext: string; name: string }
export const asBlob = (v: string | Blob, mime: string) => (typeof v === "string" ? new Blob([v], { type: `${mime};charset=utf-8` }) : v);
/** Text-like formats: source, Markdown, Mermaid and the job's format plugins. */
export async function textOutput(job: VisualExportJob, o: ExportOptions): Promise<TextOut> {
  const f = o.format;
  if (f === "source") {
    const v = await job.source!();
    const ext = (job.sourceExt ?? ".txt").replace(/^\./, "");
    return { blob: asBlob(v, "text/plain"), text: typeof v === "string" ? v : undefined, ext, name: o.fileName };
  }
  if (f === "markdown") {
    const v = await job.markdown!(o);
    const r: MarkdownResult = typeof v === "string" ? { text: v } : v;
    if (r.files?.length && o.mdAttachments) {
      const enc = new TextEncoder();
      const files: ZipFile[] = [{ name: `${o.fileName}.md`, data: enc.encode(r.text) }];
      for (const x of r.files) files.push({ name: `attachments/${x.name}`, data: new Uint8Array(await x.blob.arrayBuffer()) });
      return { blob: new Blob([zipStore(files) as BlobPart], { type: "application/zip" }), text: r.text, ext: "zip", name: o.fileName };
    }
    return { blob: asBlob(r.text, "text/markdown"), text: r.text, ext: "md", name: o.fileName };
  }
  if (f === "mermaid") { const v = await job.mermaid!(o, o.mermaidKind); return { blob: asBlob(v, "text/plain"), text: v, ext: "mmd", name: o.fileName }; }
  const p = job.formats?.find((x) => x.id === f);
  if (!p) throw new Error(t("Unknown export format"));
  const v = await p.run(o);
  return { blob: asBlob(v, p.mime), text: typeof v === "string" ? v : undefined, ext: p.ext.replace(/^\./, ""), name: o.fileName };
}

export interface PickItemName { id: string; name: string }
/** The units (image groups) an export makes: one per picked frame, or one for everything. */
export function unitsOf(job: VisualExportJob, o: ExportOptions): { ids: string[]; label: string }[] {
  const pk = PICKER_SCOPES[o.scope];
  if (!pk || !o.ids.length) return [{ ids: [], label: "" }];
  const items = job.pickers?.[pk] ?? [];
  const sep = o.format === "pdf" ? o.pdfMode === "per-frame" : o.format !== "svg" || true;
  const nameOf = (id: string) => items.find((x) => x.id === id)?.name ?? id;
  if (!sep || (o.format === "pdf" && o.pdfMode === "single")) return [{ ids: o.ids, label: "" }];
  return o.ids.map((id) => ({ ids: [id], label: nameOf(id) }));
}

const slug = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 60) || "frame";
export interface Result { blob: Blob; file: string; pages?: number; text?: string }
/** The full export for the dialog's Download. */
export async function runExport(job: VisualExportJob, o: ExportOptions, onProgress: (done: number, total: number) => void): Promise<Result> {
  const base = o.fileName.trim() || job.name;
  const f = o.format;
  if (!isImageFormat(f)) { const x = await textOutput(job, { ...o, fileName: base }); return { blob: x.blob, file: `${base}.${x.ext}`, text: x.text }; }
  const units = unitsOf(job, o);
  const scene = o.embedScene && job.source && f !== "pdf" ? await job.source().then((v) => (typeof v === "string" ? v : undefined)).catch(() => undefined) : undefined;
  const fmt = f === "pdf" ? (o.background === "transparent" ? "png" : "jpeg") : (f as "svg" | "png" | "jpeg" | "webp");
  const outs: { u: Unit; label: string }[] = [];
  onProgress(0, units.length);
  for (let i = 0; i < units.length; i++) {
    outs.push({ u: await renderUnit(job, f === "pdf" ? { ...o, quality: Math.max(o.quality, 0.85) } : o, units[i].ids, fmt, scene), label: units[i].label });
    onProgress(i + 1, units.length);
  }
  if (f === "pdf") {
    const pages: PdfPageIn[] = [];
    for (const { u } of outs) pages.push({ bytes: new Uint8Array(await u.blob!.arrayBuffer()), kind: fmt === "png" ? "png" : "jpg", width: u.width, height: u.height });
    const pdf = await call<Uint8Array>({ op: "pdf", pages, layout: { page: o.pdfPage, orient: o.pdfOrient, marginMm: o.pdfMargin, title: base } }, pages.map((p) => p.bytes.buffer));
    return { blob: new Blob([pdf as BlobPart], { type: "application/pdf" }), file: `${base}.pdf`, pages: pages.length };
  }
  const ext = EXTS[f];
  const bytes = async (u: Unit) => (u.svg !== undefined ? new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>\n${u.svg}`) : new Uint8Array(await u.blob!.arrayBuffer()));
  if (outs.length === 1) {
    const { u } = outs[0];
    return { blob: u.svg !== undefined ? new Blob([await bytes(u) as BlobPart], { type: "image/svg+xml" }) : u.blob!, file: `${base}.${ext}` };
  }
  const files: ZipFile[] = [];
  for (let i = 0; i < outs.length; i++) files.push({ name: `${base}-${i + 1}-${slug(outs[i].label)}.${ext}`, data: await bytes(outs[i].u) });
  const zip = await call<Uint8Array>({ op: "zip", files }, []);
  return { blob: new Blob([zip as BlobPart], { type: "application/zip" }), file: `${base}.zip`, pages: outs.length };
}

export interface Preview { url: string; blob: Blob; width: number; height: number; scale: number; limited?: number; count: number; text?: string; bytes: number }
/** Live preview: the first unit rendered for real (also gives size, pixel dimensions and the browser scale limit). */
export async function renderPreview(job: VisualExportJob, o: ExportOptions): Promise<Preview> {
  const f = o.format;
  if (!isImageFormat(f)) {
    const x = await textOutput(job, { ...o, fileName: o.fileName || job.name });
    return { url: "", blob: x.blob, width: 0, height: 0, scale: 1, count: 1, text: x.text, bytes: x.blob.size };
  }
  const units = unitsOf(job, o);
  const fmt = f === "pdf" ? "png" : (f as "svg" | "png" | "jpeg" | "webp");
  const u = await renderUnit(job, o, units[0].ids, fmt);
  const blob = u.svg !== undefined ? new Blob([u.svg], { type: "image/svg+xml" }) : u.blob!;
  const per = f === "pdf" ? Math.round(blob.size * 0.6) : blob.size;
  return { url: URL.createObjectURL(blob), blob, width: u.width, height: u.height, scale: u.scale, limited: u.limited, count: units.length, bytes: per * units.length };
}
