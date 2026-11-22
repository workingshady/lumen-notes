// Runs a note export: gathers the notes of a scope, builds the print document (lib/print-doc.ts) and delivers it as PDF, HTML,
// Markdown or a print dialog. PDF engines (docs/research/print-pdf-html-export.md §4 D):
//   1. Paged.js in a hidden iframe → print()   (default; free, offline; TOC page numbers, running header / footer)
//   2. "Download PDF": Worker + Cloudflare Browser Rendering (a real file in one click); on any failure → engine 1, with a message
//   3. Safari / Firefox, where Paged.js has problems → plain print CSS (no TOC page numbers)
import type { Folder, Note } from "../../shared/types";
import { isWbType } from "../../shared/types";
import { API_BASE, getToken } from "./api";
import { db } from "./db";
import { attBlob } from "./attachments";
import { t } from "./i18n";
import { buildPrintDoc, exportFileName, headerFooterTemplates, type BuildOptions, type PrintDoc, type PrintEnv, type PrintNote, type PrintOptions } from "./print-doc";
import { browserEnv, primeRender } from "./print-env";
import { PAPER_MM } from "./print-css";

export type Format = "pdf" | "html" | "md" | "print";
export type Scope = { kind: "note"; ids: string[] } | { kind: "selection"; ids: string[] } | { kind: "folder"; folderId: string } | { kind: "space"; spaceId: string };
export interface ExportRequest { format: Format; scope: Scope; opts: PrintOptions; htmlFolder: boolean; fileName?: string; engine: "auto" | "paged" | "server" }
export interface ExportCtl { signal?: AbortSignal; onProgress?: (done: number, total: number, label: string) => void; notify?: (msg: string) => void }
export interface ExportResult { file?: string; bytes?: number; notes: number; skipped: number; engine?: "paged" | "native" | "server"; fellBack?: string; warnings?: PrintDoc["warnings"] }

const MAX_SERVER_HTML = 20_000_000;
export const isCancel = (e: unknown) => (e as { name?: string })?.name === "AbortError";
const toPrintNote = (n: Note, path?: string): PrintNote => ({ id: n.id, title: n.title, body: n.body, createdAt: n.createdAt, updatedAt: n.updatedAt, tags: n.tags, status: n.status, type: n.type, props: n.props as Record<string, string> | undefined, path });
const printable = (n: Note) => !n.deleted && n.type !== "canvas" && !isWbType(n.type) && n.type !== "diagram" && n.type !== "pdf";

/** The notes of a scope in reading order (folders in tree order, notes by title), plus a vault-wide title lookup for wikilinks and transclusions. */
export async function collectScope(scope: Scope): Promise<{ title: string; notes: PrintNote[]; skipped: number; lookup: (title: string) => PrintNote | null }> {
  const [all, folders, spaces] = await Promise.all([db.notes.toArray(), db.folders.toArray(), db.spaces.toArray()]);
  const live = all.filter((n) => !n.deleted);
  const byTitle = new Map<string, PrintNote>();
  for (const n of live) if (!byTitle.has(n.title.toLowerCase())) byTitle.set(n.title.toLowerCase(), toPrintNote(n));
  const lookup = (title: string) => byTitle.get(title.toLowerCase()) ?? null;
  const fl = folders.filter((f) => !f.deleted);
  const kids = (parent: string | null, spaceId: string) => fl.filter((f) => f.spaceId === spaceId && (f.parentId ?? null) === parent).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
  const inFolder = (spaceId: string, folderId: string | null): Note[] => live.filter((n) => n.spaceId === spaceId && (n.folderId ?? null) === folderId).sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  const walk = (spaceId: string, folder: Folder | null, trail: string): Note[] => [
    ...inFolder(spaceId, folder?.id ?? null),
    ...kids(folder?.id ?? null, spaceId).flatMap((f) => walk(spaceId, f, trail ? `${trail} / ${f.name}` : f.name)),
  ];
  let title = "", picked: Note[] = [];
  if (scope.kind === "note" || scope.kind === "selection") {
    const map = new Map(live.map((n) => [n.id, n]));
    picked = scope.ids.map((id) => map.get(id)).filter((n): n is Note => !!n);
    title = picked.length === 1 ? picked[0].title : t("{n} notes", { n: picked.length });
  } else if (scope.kind === "folder") {
    const f = fl.find((x) => x.id === scope.folderId);
    title = f?.name ?? t("Folder");
    picked = f ? walk(f.spaceId, f, f.name) : [];
  } else {
    title = spaces.find((s) => s.id === scope.spaceId)?.name ?? t("Space");
    picked = walk(scope.spaceId, null, "");
  }
  const notes = picked.filter(printable);
  return { title, notes: notes.map((n) => toPrintNote(n)), skipped: picked.length - notes.length, lookup };
}

// ------------------------------------------------------------------ Paged.js
export const pagedSupported = () => typeof navigator !== "undefined" && /\b(Chrome|Chromium|Edg)\//.test(navigator.userAgent);
const BOOT = `(async function(){var post=function(s,e){try{parent.postMessage({lumenPaged:s,error:e?String(e):"",pages:window.__pagedPages||0},"*")}catch(_){}};
try{await document.fonts.ready;await Promise.all(Array.prototype.map.call(document.images,function(i){return i.complete?0:new Promise(function(r){i.onload=i.onerror=r})}));
var flow=await window.PagedPolyfill.preview();await document.fonts.ready;window.__pagedPages=flow&&flow.total||document.querySelectorAll(".pagedjs_page").length;window.__pagedDone=true;post("done")}
catch(e){window.__pagedFailed=String(e);window.__pagedDone=true;post("failed",e)}})();`;
let polyfill: Promise<string> | null = null;
const loadPolyfill = () => (polyfill ??= import("../../node_modules/pagedjs/dist/paged.polyfill.min.js?raw").then((m) => m.default as string).catch((e) => { polyfill = null; throw e; }));
const safeScript = (s: string) => s.replace(/<\/(script)/gi, "<\\/$1");
/** Wrap a built document so it paginates itself with Paged.js (lazy-loaded), waits for fonts and images, and reports back. */
export async function pagedDocument(html: string, opts: { preview?: boolean } = {}): Promise<string> {
  const lib = await loadPolyfill();
  const inject = `<script>window.PagedConfig={auto:false};</script><script>${safeScript(lib)}</script><script>${safeScript(BOOT)}</script>`;
  const preview = opts.preview ? `<style>html{background:#e9e7e2}.pagedjs_pages{margin:0 auto}.pagedjs_page{box-shadow:0 1px 6px rgba(0,0,0,.25);margin:14px auto!important}</style>` : "";
  return html.replace("</head>", `${preview}</head>`).replace("</body>", `${inject}</body>`);
}

// ------------------------------------------------------------------ building
async function makeDoc(req: ExportRequest, engine: BuildOptions["engine"], ctl: ExportCtl, extra: Partial<BuildOptions> = {}, envPatch: Partial<PrintEnv> = {}) {
  await primeRender();
  const sc = await collectScope(req.scope);
  if (!sc.notes.length) throw new Error(t("Nothing to export: no notes in this scope."));
  const env = { ...browserEnv({ signal: ctl.signal, onProgress: ctl.onProgress }), ...envPatch };
  const doc = await buildPrintDoc({ title: sc.title, notes: sc.notes, lookup: sc.lookup }, { ...req.opts, engine, ...extra }, env);
  doc.warnings.skippedNotes = sc.skipped;
  return { doc, scope: sc };
}
const fileOf = (title: string, ext: string, req: ExportRequest) => (req.fileName?.trim() ? exportFileName(req.fileName.replace(/\.\w{2,5}$/, ""), ext) : exportFileName(title, ext));

/** The document the dialog previews: paged pages for PDF / print, the HTML page for HTML. */
export async function previewDoc(req: ExportRequest, ctl: ExportCtl): Promise<{ html: string; doc: PrintDoc; paged: boolean }> {
  const useHtml = req.format === "html" || req.format === "md";
  const paged = !useHtml && pagedSupported();
  const { doc } = await makeDoc(req, useHtml ? "html" : paged ? "paged" : "native", ctl);
  return { html: paged ? await pagedDocument(doc.html, { preview: true }) : doc.html, doc, paged };
}

// ------------------------------------------------------------------ delivering
function hiddenFrame(html: string): HTMLIFrameElement {
  const f = document.createElement("iframe");
  f.setAttribute("aria-hidden", "true");
  f.tabIndex = -1;
  f.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
  f.srcdoc = html;
  document.body.appendChild(f);
  return f;
}
/** Resolves with "done" / "failed" when the Paged.js document reports back (or "timeout"). */
function waitPaged(frame: HTMLIFrameElement, ms: number, signal?: AbortSignal): Promise<"done" | "failed" | "timeout"> {
  return new Promise((res, rej) => {
    const end = (v: "done" | "failed" | "timeout") => { removeEventListener("message", on); clearTimeout(tm); signal?.removeEventListener("abort", ab); res(v); };
    const on = (e: MessageEvent) => { if (e.source === frame.contentWindow && e.data && typeof e.data === "object" && "lumenPaged" in e.data) end((e.data as { lumenPaged: "done" | "failed" }).lumenPaged); };
    const ab = () => { removeEventListener("message", on); clearTimeout(tm); rej(new DOMException("Export cancelled", "AbortError")); };
    const tm = setTimeout(() => end("timeout"), ms);
    addEventListener("message", on);
    signal?.addEventListener("abort", ab, { once: true });
  });
}
async function waitLoad(frame: HTMLIFrameElement, signal?: AbortSignal) {
  await new Promise<void>((res, rej) => {
    const ab = () => rej(new DOMException("Export cancelled", "AbortError"));
    signal?.addEventListener("abort", ab, { once: true });
    frame.addEventListener("load", () => { signal?.removeEventListener("abort", ab); res(); }, { once: true });
  });
  const d = frame.contentDocument;
  if (d) { await d.fonts?.ready; await Promise.all(Array.from(d.images).map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))); }
}
/** Engine 1: Paged.js (or plain print CSS) in a hidden iframe, then print(). No window.open, so pop-up blockers can't stop it. */
async function printInFrame(req: ExportRequest, ctl: ExportCtl): Promise<{ engine: "paged" | "native"; fellBack?: string; doc: PrintDoc; title: string }> {
  let usePaged = pagedSupported() && req.engine !== "server";
  let fellBack: string | undefined;
  ctl.notify?.(t("Preparing the document…"));
  const first = await makeDoc(req, usePaged ? "paged" : "native", ctl);
  let doc = first.doc;
  if (!usePaged) fellBack = t("This browser can't number the table of contents; printing with plain page CSS.");
  let frame: HTMLIFrameElement | null = null;
  try {
    if (usePaged) {
      frame = hiddenFrame(await pagedDocument(doc.html));
      const r = await waitPaged(frame, 60_000 + doc.notes.length * 4000, ctl.signal);
      if (r !== "done") {
        frame.remove(); frame = null; usePaged = false;
        fellBack = t("Page layout (Paged.js) didn't finish; printing with plain page CSS and no table of contents page numbers.");
        doc = (await makeDoc(req, "native", ctl)).doc;
      }
    }
    if (!frame) { frame = hiddenFrame(doc.html); await waitLoad(frame, ctl.signal); }
    const w = frame.contentWindow!;
    const clean = () => setTimeout(() => frame?.remove(), 1000);
    w.addEventListener("afterprint", clean, { once: true });
    setTimeout(clean, 10 * 60_000);
    w.focus();
    w.print();
    return { engine: usePaged ? "paged" : "native", fellBack, doc, title: first.scope.title };
  } catch (e) { frame?.remove(); throw e; }
}

let serverBusy: Promise<unknown> | null = null;
let serverCoolUntil = 0;
export class ServerPdfUnavailable extends Error { constructor(public reason: "offline" | "quota" | "missing" | "failed" | "large" | "busy", msg: string) { super(msg); } }
/** Engine 2: the Worker renders the same document with Cloudflare Browser Rendering and returns the PDF. */
async function serverPdf(req: ExportRequest, ctl: ExportCtl): Promise<{ blob: Blob; doc: PrintDoc; title: string }> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new ServerPdfUnavailable("offline", t("You're offline."));
  if (Date.now() < serverCoolUntil) throw new ServerPdfUnavailable("quota", t("The PDF service is resting after a limit; try again in a minute."));
  if (serverBusy) throw new ServerPdfUnavailable("busy", t("Another PDF is still being made."));
  const run = (async () => {
    ctl.notify?.(t("Preparing the document…"));
    const { doc, scope } = await makeDoc(req, "paged", ctl);
    const html = await pagedDocument(doc.html);
    if (html.length > MAX_SERVER_HTML) throw new ServerPdfUnavailable("large", t("The document is too large for the PDF service."));
    ctl.notify?.(t("Rendering the PDF on the server…"));
    const [w, h] = PAPER_MM[req.opts.paper];
    const dateLabel = new Date().toLocaleDateString();
    const body = { html, mode: "paged", paper: req.opts.paper, landscape: req.opts.landscape, marginMm: req.opts.marginMm, widthMm: req.opts.landscape ? h : w, heightMm: req.opts.landscape ? w : h, title: scope.title, date: dateLabel, pageNumbers: req.opts.pageNumbers, headerFooter: req.opts.headerFooter, words: { page: t("page"), of: t("of") }, ...headerFooterTemplates(scope.title, dateLabel, req.opts, { page: t("page"), of: t("of") }) };
    let r: Response;
    try {
      r = await fetch(`${API_BASE}/api/export/pdf`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` }, body: JSON.stringify(body), signal: ctl.signal });
    } catch (e) { if (isCancel(e)) throw e; throw new ServerPdfUnavailable("offline", t("The PDF service can't be reached.")); }
    if (r.status === 429) { serverCoolUntil = Date.now() + Math.max(60, Number(r.headers.get("retry-after")) || 0) * 1000; throw new ServerPdfUnavailable("quota", t("The daily PDF allowance is used up.")); }
    if (r.status === 501 || r.status === 404) throw new ServerPdfUnavailable("missing", t("The PDF service isn't set up on this server."));
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("pdf")) throw new ServerPdfUnavailable("failed", t("The PDF service failed."));
    return { blob: await r.blob(), doc, title: scope.title };
  })();
  serverBusy = run;
  try { return await run; } finally { serverBusy = null; }
}

/** io.ts pulls in the app's data layer; it loads only when a file is actually saved. */
const io = () => import("./io");
const download = async (name: string, data: Blob | string, mime: string) => (await io()).download(name, data, mime);
const phone = () => typeof matchMedia !== "undefined" && matchMedia("(max-width: 767px)").matches;
async function shareOrSave(blob: Blob, name: string) {
  const file = new File([blob], name, { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (phone() && nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title: name }); return; } catch (e) { if (isCancel(e)) return; } }
  await download(name, blob, "application/pdf");
}

// ------------------------------------------------------------------ HTML folder (index + one page per note + assets)
const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i += Math.max(1, s.length >> 12)) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36) + s.length.toString(36); };
const extOf = (mime: string) => ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" })[mime] ?? "bin";
const dataBytes = (uri: string) => { const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(uri)!; return { mime: m[1], bytes: m[2] ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3])) }; };
export async function buildHtmlFolder(notes: PrintNote[], title: string, lookup: (t: string) => PrintNote | null, req: ExportRequest, env: PrintEnv): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const names = notes.map((n, i) => `${String(i + 1).padStart(2, "0")}-${exportFileName(n.title, "html")}`);
  const text = notes.map((n) => n.body).join("\n");
  // fonts and KaTeX are resolved once for the whole export, so every page shares one stylesheet
  const flags = { mono: true, serif: env.bodyFont?.() === "serif", arabic: /[؀-ۿ]/.test(text), italic: true };
  const fontCss = (await env.fonts?.(text, flags).catch(() => "")) ?? "";
  const katexCss = (await env.katexCss?.("*").catch(() => "")) ?? "";
  const shared: PrintEnv = { ...env, fonts: env.fonts ? async () => fontCss : undefined, katexCss: env.katexCss ? async () => katexCss : undefined };
  const assets = new Map<string, string>();
  let css = "";
  for (const [i, n] of notes.entries()) {
    env.onProgress?.(i, notes.length, n.title);
    const doc = await buildPrintDoc({ title: n.title, notes: [n], lookup }, { ...req.opts, engine: "html", linkTargets: notes, hrefFor: (_x, k) => names[k] }, shared);
    css = css || `${doc.fontCss}${doc.katexCss}${doc.css}`;
    let html = doc.html.replace(/<style id="(?:fonts|katex|print)">[\s\S]*?<\/style>/g, "").replace("</head>", `<link rel="stylesheet" href="assets/doc.css"></head>`);
    html = html.replace(/src="(data:image\/[^"]+)"/g, (_m, uri: string) => {
      const k = fnv(uri);
      let file = assets.get(k);
      if (!file) { const { mime, bytes } = dataBytes(uri); file = `assets/img-${assets.size + 1}.${extOf(mime)}`; assets.set(k, file); zip.file(file, bytes); }
      return `src="${file}"`;
    });
    html = html.replace('<main class="doc-main" dir="auto">', `<main class="doc-main" dir="auto"><nav class="crumbs no-print"><a href="index.html">${t("Index")}</a></nav>`);
    zip.file(names[i], html);
  }
  zip.file("assets/doc.css", css);
  const li = notes.map((n, i) => `<li><a href="${names[i]}" dir="auto">${n.title.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</a></li>`).join("");
  zip.file("index.html", `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title.replace(/</g, "&lt;")}</title><link rel="stylesheet" href="assets/doc.css"></head><body><main class="doc-main"><h1 dir="auto">${title.replace(/</g, "&lt;")}</h1><ol class="index-list">${li}</ol></main></body></html>`);
  env.onProgress?.(notes.length, notes.length, "");
  return zip.generateAsync({ type: "blob" });
}

// ------------------------------------------------------------------ Markdown (one file, or a zip with its attachments)
async function markdownExport(req: ExportRequest, ctl: ExportCtl): Promise<ExportResult> {
  const sc = await collectScope(req.scope);
  const all = (await db.notes.bulkGet(sc.notes.map((n) => n.id))).filter((n): n is Note => !!n);
  if (!all.length) throw new Error(t("Nothing to export: no notes in this scope."));
  if (all.length === 1) {
    const { noteToMarkdown } = await io();
    const file = fileOf(all[0].title, "md", req), md = noteToMarkdown(all[0]);
    await download(file, md, "text/markdown");
    return { file, bytes: md.length, notes: 1, skipped: sc.skipped };
  }
  const zip = new (await import("jszip")).default();
  const used = new Set<string>();
  const atts = new Set<string>();
  for (const [i, n] of all.entries()) {
    if (ctl.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
    ctl.onProgress?.(i, all.length, n.title);
    let f = exportFileName(n.title, "md");
    for (let k = 2; used.has(f.toLowerCase()); k++) f = exportFileName(`${n.title} ${k}`, "md");
    used.add(f.toLowerCase());
    const md = (await io()).noteToMarkdown(n);
    zip.file(f, md);
    for (const m of md.matchAll(/\(att:([\w-]+)\)/g)) atts.add(m[1]);
  }
  for (const id of atts) {
    const b = await attBlob(id);
    const meta = await db.attachments.get(id);
    if (b) zip.file(`attachments/${id}-${exportFileName(meta?.name ?? "file", "").replace(/\.$/, "")}`, b);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const file = fileOf(sc.title, "zip", req);
  await download(file, blob, "application/zip");
  return { file, bytes: blob.size, notes: all.length, skipped: sc.skipped };
}

/** Run one export request. Throws AbortError when cancelled. */
export async function runExport(req: ExportRequest, ctl: ExportCtl = {}): Promise<ExportResult> {
  if (req.format === "md") return markdownExport(req, ctl);
  if (req.format === "html") {
    if (req.htmlFolder && req.scope.kind !== "note") {
      await primeRender();
      const sc = await collectScope(req.scope);
      if (sc.notes.length > 1) {
        const blob = await buildHtmlFolder(sc.notes, sc.title, sc.lookup, req, browserEnv({ signal: ctl.signal, onProgress: ctl.onProgress }));
        const file = fileOf(sc.title + " (HTML)", "zip", req);
        await download(file, blob, "application/zip");
        return { file, bytes: blob.size, notes: sc.notes.length, skipped: sc.skipped };
      }
    }
    const { doc, scope } = await makeDoc(req, "html", ctl);
    const file = fileOf(scope.title, "html", req);
    const blob = new Blob([doc.html], { type: "text/html" });
    await download(file, blob, "text/html");
    return { file, bytes: blob.size, notes: doc.notes.length, skipped: scope.skipped, warnings: doc.warnings };
  }
  if (req.format === "print") {
    const r = await printInFrame(req, ctl);
    return { notes: r.doc.notes.length, skipped: r.doc.warnings.skippedNotes, engine: r.engine, fellBack: r.fellBack, warnings: r.doc.warnings };
  }
  // PDF: the server renders a real file; any failure falls back to engine 1 (print → Save as PDF) with the reason.
  const wantServer = req.engine === "server" || (req.engine === "auto" && phone());
  if (req.engine !== "paged" && (wantServer || req.engine === "server")) {
    try {
      const r = await serverPdf(req, ctl);
      const file = fileOf(r.title, "pdf", req);
      await shareOrSave(r.blob, file);
      return { file, bytes: r.blob.size, notes: r.doc.notes.length, skipped: r.doc.warnings.skippedNotes, engine: "server", warnings: r.doc.warnings };
    } catch (e) {
      if (isCancel(e)) throw e;
      const why = e instanceof ServerPdfUnavailable ? e.message : t("The PDF service failed.");
      ctl.notify?.(`${why} ${t("Using the print dialog instead: choose “Save as PDF”.")}`);
      const r = await printInFrame({ ...req, engine: "paged" }, ctl);
      return { notes: r.doc.notes.length, skipped: r.doc.warnings.skippedNotes, engine: r.engine, fellBack: `${why} ${t("Used the print dialog instead.")}`, warnings: r.doc.warnings };
    }
  }
  const r = await printInFrame(req, ctl);
  return { notes: r.doc.notes.length, skipped: r.doc.warnings.skippedNotes, engine: r.engine, fellBack: r.fellBack, warnings: r.doc.warnings };
}
