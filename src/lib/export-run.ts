// The export pipeline behind the dialog: build -> rasterise / encode (worker) -> PDF / ZIP (worker) -> file.
import { themeBackground } from "./diagram-export";
import { CANVAS_LIMIT_MSG, crc32 as _crc, buildPdf, canvasLimits, capScale, encodeBitmap, pngWithText, zipStore, type PdfPageIn, type RasterJob, type ZipFile } from "./export-encode";
import { vectorBlocker, type PdfUnit } from "./export-vector";
import type { ExportOptions, ExportScope, MarkdownResult, Rendered, VisualExportJob } from "./export-job";
import { t } from "./i18n";

void _crc;
const IMG = new Set(["png", "jpeg", "webp", "svg", "pdf"]);
export const isImageFormat = (f: string) => IMG.has(f);
export const EXTS: Record<string, string> = { png: "png", jpeg: "jpg", webp: "webp", svg: "svg", pdf: "pdf", mermaid: "mmd", markdown: "md", html: "html" };
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

// ------------------------------------------------------------------ accessible SVG
const xesc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const KIND_LABEL: Record<string, string> = { whiteboard: "Whiteboard", board: "Board", canvas: "Canvas", mermaid: "Mermaid diagram", architecture: "Architecture diagram", graph: "Graph" };
/** `role="img"`, `<title>` and `<desc>` (diagram name + a short text summary) on the outer <svg>; the diagram's own text stays real <text>. */
export function accessibleSvg(svg: string, title: string, kind: string, lang?: string): string {
  const open = /<svg\b[^>]*>/.exec(svg);
  if (!open || /^\s*<title\b/.test(svg.slice(open.index + open[0].length, open.index + open[0].length + 200))) return svg;
  const labels = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const shown = labels.slice(0, 12).join("; ");
  const desc = `${KIND_LABEL[kind] ?? "Diagram"} exported from Lumen with ${labels.length} text label${labels.length === 1 ? "" : "s"}${shown ? `: ${shown}${labels.length > 12 ? "; …" : ""}` : ""}.`;
  let tag = open[0].replace(/\s(role|aria-labelledby)="[^"]*"/g, "");
  if (lang && !/\slang=/.test(tag)) tag = tag.replace(/^<svg\b/, `<svg lang="${xesc(lang)}" xml:lang="${xesc(lang)}"`);
  tag = tag.replace(/^<svg\b/, '<svg role="img" aria-labelledby="lumen-title lumen-desc"');
  return svg.slice(0, open.index) + tag + `<title id="lumen-title">${xesc(title)}</title><desc id="lumen-desc">${xesc(desc)}</desc>` + svg.slice(open.index + open[0].length);
}
/** Drop what svg2pdf can't use (embedded @font-face rules, scene metadata) before drawing. */
const pdfSvg = (svg: string) => svg.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/g, (m, css: string) => (/@font-face|@import/.test(css) ? "" : m)).replace(/<metadata\b[\s\S]*?<\/metadata>/g, "")
  // PDF's built-in fonts only have normal and bold: map numeric weights (svg2pdf logs a warning for "600normal")
  .replace(/font-weight(=|:\s*)(["']?)(\d{3})\2/g, (_m, eq: string, q: string, w: string) => `font-weight${eq}${q}${+w >= 600 ? "bold" : "normal"}${q}`);
const docLang = () => (typeof document !== "undefined" && document.documentElement.lang) || undefined;

export interface Unit { svg?: string; blob?: Blob; width: number; height: number; scale: number; limited?: number }
/** Build one image and encode it for `fmt` (svg stays vector). */
export async function renderUnit(job: VisualExportJob, o: ExportOptions, ids: string[], fmt: "svg" | "png" | "jpeg" | "webp", sceneText?: string, label = ""): Promise<Unit> {
  const oo = { ...withBg(job, o), format: fmt as ExportOptions["format"] };
  const lim = canvasLimits();
  const req = { scope: o.scope as ExportScope, ids, opts: oo, format: fmt, scale: o.scale === "max" ? null : o.scale, maxPx: Math.min(o.maxPx, lim.maxSide) };
  let r: Rendered;
  try { r = await job.build(req); } catch (err) {
    // a constrained browser (iOS) can fail a raster build outright: retry once at a scale that fits
    if (fmt === "svg" || lim.maxArea > 20_000_000) throw err;
    r = await rebuildWithin(job, req, lim, err);
  }
  const bg = oo.bgColor;
  if ("svg" in r) {
    let svg = r.svg, w = r.width, h = r.height;
    if (sceneText) svg = embedSvg(svg, sceneText);
    if (fmt === "svg") {
      if (o.aspect > 0) ({ svg, width: w, height: h } = fitSvg(svg, w, h, o.aspect, bg));
      return { svg: accessibleSvg(svg, [job.title.replace(/\.(canvas|mermaid|excalidraw)$/i, ""), label].filter(Boolean).join(" · ") || job.name, job.kind, docLang()), width: w, height: h, scale: 1 };
    }
    // letterboxing to a fixed aspect grows the canvas: size the cap on the final canvas
    const lw = o.aspect > 0 ? Math.max(w, h * o.aspect) : w, lh = o.aspect > 0 ? Math.max(h, w / o.aspect) : h;
    const want = o.scale === "max" ? Math.min(o.maxPx, lim.maxSide) / Math.max(w, h) : o.scale;
    const cap = capScale(lw, lh, lim);
    let scale = Math.min(want, cap);
    for (let attempt = 0; ; attempt++) {
      const W = Math.max(1, Math.round(w * scale)), H = Math.max(1, Math.round(h * scale));
      try {
        const bitmap = await svgBitmap(svg, W, H);
        const e = await call<{ blob: Blob; width: number; height: number }>({ op: "raster", bitmap, bg, aspect: o.aspect, type: MIME[fmt], quality: o.quality }, [bitmap]);
        let blob = e.blob;
        if (fmt === "png" && sceneText) blob = new Blob([pngWithText(new Uint8Array(await blob.arrayBuffer()), "lumen-scene", sceneText) as BlobPart], { type: "image/png" });
        return { blob, width: e.width, height: e.height, scale, limited: want > scale + 0.01 ? scale : undefined };
      } catch (err) {
        // the browser refused (or silently blanked) a canvas this big: shrink and try again, never hand back a broken image
        if (attempt >= 4 || scale <= 0.1) throw new Error(t("The browser could not encode the image (too large?)"));
        if (!String((err as Error)?.message).includes(CANVAS_LIMIT_MSG) && !(err instanceof RangeError) && !(err instanceof DOMException)) throw err;
        scale *= 0.7;
      }
    }
  }
  if (fmt === "svg") throw new Error(t("This workspace can't export SVG"));
  // raster straight from the workspace (whiteboard): keep it inside the browser's canvas limits
  if (capScale(r.width, r.height, lim) < 0.999) r = await rebuildWithin(job, req, lim, null, r);
  if (!("blob" in r)) throw new Error(t("The browser could not encode the image (too large?)"));
  if (fmt === "png" && !(o.aspect > 0)) return { blob: r.blob, width: r.width, height: r.height, scale: r.limited ?? req.scale ?? 1, limited: r.limited };
  const bitmap = await createImageBitmap(r.blob);
  const e = await call<{ blob: Blob; width: number; height: number }>({ op: "raster", bitmap, bg, aspect: o.aspect, type: MIME[fmt], quality: o.quality }, [bitmap]);
  return { blob: e.blob, width: e.width, height: e.height, scale: r.limited ?? req.scale ?? 1, limited: r.limited };
}
/** A workspace that rasterises itself ignores our caps: measure its 1x size from SVG, then rebuild at a scale that fits. */
async function rebuildWithin(job: VisualExportJob, req: BuildRequestLike, lim: ReturnType<typeof canvasLimits>, firstErr: unknown, first?: Rendered): Promise<Rendered> {
  let base: Rendered | null = null;
  try { base = await job.build({ ...req, format: "svg", scale: 1 }); } catch { /* no SVG export: use the first result's size */ }
  const bw = base?.width ?? first?.width, bh = base?.height ?? first?.height;
  if (!bw || !bh) throw firstErr ?? new Error(t("The browser could not encode the image (too large?)"));
  const baseW = base && "svg" in base ? bw : bw / (req.scale ?? 1), baseH = base && "svg" in base ? bh : bh / (req.scale ?? 1);
  const want = req.scale ?? Math.min(req.maxPx / Math.max(baseW, baseH), lim.maxSide / Math.max(baseW, baseH));
  const scale = Math.min(want, capScale(baseW, baseH, lim));
  const r = await job.build({ ...req, scale, maxPx: req.maxPx });
  return "svg" in r ? r : { ...r, limited: want > scale + 0.01 ? scale : r.limited };
}
type BuildRequestLike = Parameters<VisualExportJob["build"]>[0];

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
  if (f === "html") {
    // one self-contained, read-only page: the vector image with wheel zoom, drag to pan, double-click to reset (no network, no scripts from elsewhere)
    const u = await renderUnit(job, { ...o, format: "svg" }, o.ids ?? [], "svg");
    if (!("svg" in u)) throw new Error(t("This workspace can't export SVG"));
    const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
    const bg = o.bgColor ?? "#ffffff";
    const html = `<!doctype html><html lang="${docLang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(job.title)}</title><style>html,body{margin:0;height:100%;background:${bg};font-family:system-ui,sans-serif}#v{position:fixed;inset:0;overflow:hidden;cursor:grab;touch-action:none}#v:active{cursor:grabbing}#s{transform-origin:0 0;position:absolute;left:0;top:0}#s svg{display:block}#h{position:fixed;bottom:10px;inset-inline-start:12px;font-size:12px;opacity:.55;color:#777}</style></head><body><div id="v"><div id="s">${u.svg}</div></div><div id="h">${esc(t("Scroll to zoom, drag to move, double-click to fit"))}</div><script>(function(){var v=document.getElementById("v"),s=document.getElementById("s"),sv=s.querySelector("svg"),w=${Math.round(u.width)},h=${Math.round(u.height)};sv.setAttribute("width",w);sv.setAttribute("height",h);var k=1,x=0,y=0;function ap(){s.style.transform="translate("+x+"px,"+y+"px) scale("+k+")"}function fit(){k=Math.min(innerWidth/w,innerHeight/h,1)*.95;x=(innerWidth-w*k)/2;y=(innerHeight-h*k)/2;ap()}fit();addEventListener("resize",fit);v.addEventListener("wheel",function(e){e.preventDefault();var f=Math.exp(-e.deltaY*.0015),n=Math.max(.05,Math.min(8,k*f));x=e.clientX-(e.clientX-x)*n/k;y=e.clientY-(e.clientY-y)*n/k;k=n;ap()},{passive:false});var d=null;v.addEventListener("pointerdown",function(e){d={x:e.clientX-x,y:e.clientY-y};v.setPointerCapture(e.pointerId)});v.addEventListener("pointermove",function(e){if(d){x=e.clientX-d.x;y=e.clientY-d.y;ap()}});v.addEventListener("pointerup",function(){d=null});v.addEventListener("dblclick",fit)})();</script></body></html>`;
    return { blob: asBlob(html, "text/html"), text: html, ext: "html", name: o.fileName };
  }
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
export type ExportStage = "render" | "encode" | "pdf";
export async function runExport(job: VisualExportJob, o: ExportOptions, onProgress: (done: number, total: number, stage?: ExportStage) => void): Promise<Result> {
  const base = o.fileName.trim() || job.name;
  const f = o.format;
  if (!isImageFormat(f)) { const x = await textOutput(job, { ...o, fileName: base }); return { blob: x.blob, file: `${base}.${x.ext}`, text: x.text }; }
  const units = unitsOf(job, o);
  const scene = o.embedScene && job.source && f !== "pdf" ? await job.source().then((v) => (typeof v === "string" ? v : undefined)).catch(() => undefined) : undefined;
  const lay = { page: o.pdfPage, orient: o.pdfOrient, marginMm: o.pdfMargin, title: base };
  onProgress(0, units.length, "render");
  if (f === "pdf") {
    // vector first: SVG output drawn as paths + selectable text; a unit that can't (images, foreignObject, filters, non-Latin
    // text with PDF's built-in fonts) or a workspace without SVG falls back to a raster page
    const rasterFmt = o.background === "transparent" ? "png" : "jpeg";
    const ro = { ...o, quality: Math.max(o.quality, 0.85) };
    const bg = resolveBg(job, o);
    const pdfUnits: PdfUnit[] = [];
    let vectorOk = true;
    for (let i = 0; i < units.length; i++) {
      let done = false;
      if (vectorOk) {
        try {
          const u = await renderUnit(job, { ...o, aspect: 0 }, units[i].ids, "svg", undefined, units[i].label);
          const why = u.svg !== undefined ? vectorBlocker(u.svg) : "no-svg";
          if (why) console.debug("[export] PDF page falls back to raster:", why);
          if (u.svg !== undefined && !why) { pdfUnits.push({ vector: true, svg: pdfSvg(u.svg), width: u.width, height: u.height, bg }); done = true; }
        } catch (err) { if (String((err as Error)?.message) === t("This workspace can't export SVG")) vectorOk = false; }
      }
      if (!done) {
        const u = await renderUnit(job, ro, units[i].ids, rasterFmt);
        pdfUnits.push({ vector: false, bytes: new Uint8Array(await u.blob!.arrayBuffer()), fmt: rasterFmt === "png" ? "png" : "jpg", width: u.width, height: u.height });
      }
      onProgress(i + 1, units.length, "render");
    }
    let pdf: Uint8Array;
    if (pdfUnits.some((u) => u.vector)) {
      onProgress(units.length, units.length, "pdf");
      const { buildVectorPdf } = await import("./export-vector");
      pdf = await buildVectorPdf(pdfUnits, { ...lay, lang: docLang() }, (i) => onProgress(i, units.length, "pdf"));
    } else {
      const pages: PdfPageIn[] = pdfUnits.flatMap((u) => (u.vector ? [] : [{ bytes: u.bytes, kind: u.fmt, width: u.width, height: u.height }]));
      onProgress(units.length, units.length, "pdf");
      pdf = await call<Uint8Array>({ op: "pdf", pages, layout: lay }, pages.map((p) => p.bytes.buffer), (i) => onProgress(i, units.length, "pdf"));
    }
    return { blob: new Blob([pdf as BlobPart], { type: "application/pdf" }), file: `${base}.pdf`, pages: units.length };
  }
  const fmt = f as "svg" | "png" | "jpeg" | "webp";
  const outs: { u: Unit; label: string }[] = [];
  for (let i = 0; i < units.length; i++) {
    outs.push({ u: await renderUnit(job, o, units[i].ids, fmt, scene, units[i].label), label: units[i].label });
    onProgress(i + 1, units.length, "render");
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
