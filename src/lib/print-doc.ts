// The shared "print document" builder: one standalone document for Print, PDF and HTML (docs/research/print-pdf-html-export.md §4 A).
// Everything the browser would otherwise fetch is resolved here: math is KaTeX HTML (CSS and fonts embedded), diagrams are inline SVG,
// images are data: URIs, fonts are embedded. Services that need the browser or the network come in through `PrintEnv`, so this module
// runs unchanged in tests (linkedom) and in the app. Each service may fail; every one has a labelled fallback.
import { isWbType } from "../../shared/types";
import { blockSource } from "./blocks";
import { getLang, isRtl, t } from "./i18n";
import { splitFrontMatter } from "./parse";
import { BW, LAMPLIGHT, PAPER, PAPER_NAME, printCss, type CssOptions, type Engine, type Palette, type Paper, type PrintTheme } from "./print-css";

export type LinkStyle = "inline" | "footnote" | "none";
export type MediaStyle = "poster" | "qr" | "text";
export type AnswerMode = "show" | "hide" | "key";

export interface PrintOptions {
  paper: Paper; landscape: boolean; marginMm: number; fontPt: number;
  theme: PrintTheme;
  titlePage: boolean; toc: boolean; pageNumbers: boolean; headerFooter: boolean; frontMatter: boolean;
  links: LinkStyle; media: MediaStyle; answers: AnswerMode;
  breakH: "none" | "h1" | "h2"; newPagePerNote: boolean;
}
export const PRINT_DEFAULTS: PrintOptions = {
  paper: "a4", landscape: false, marginMm: 18, fontPt: 10.5, theme: "paper",
  titlePage: false, toc: false, pageNumbers: true, headerFooter: false, frontMatter: false,
  links: "footnote", media: "poster", answers: "show", breakH: "none", newPagePerNote: false,
};

export interface PrintNote { id: string; title: string; body: string; createdAt?: number; updatedAt?: number; tags?: string[]; status?: string | null; type?: string; props?: Record<string, string>; path?: string }
export interface PrintInput {
  /** Title of the document (note title, folder or space name). */
  title: string; notes: PrintNote[];
  /** Finds any note of the vault by title (for transclusions and wikilinks); defaults to the exported notes. */
  lookup?: (title: string) => PrintNote | null;
}
export interface Attachment { mime: string; data: string; name?: string }
export interface MediaMeta { poster?: string; title?: string }
export interface PrintEnv {
  doc: Document;
  render(md: string): string;
  mermaid?(src: string, mode: PrintTheme): Promise<string | null>;
  canvasSvg?(json: string): Promise<string | null>;
  query?(q: string): Promise<string | null>;
  /** Attachment bytes as a data: URI (fetched with the user's auth). null = not available. */
  attachment?(id: string): Promise<Attachment | null>;
  /** A web image as a data: URI, or null (offline, blocked by CORS). */
  image?(url: string): Promise<string | null>;
  media?(provider: string, id: string, href: string): Promise<MediaMeta | null>;
  qr?(url: string): Promise<string | null>;
  /** @font-face CSS (base64) for the faces `text` uses; "" when offline. */
  fonts?(text: string, o: { mono: boolean; serif: boolean; arabic: boolean; italic: boolean }): Promise<string>;
  katexCss?(html: string): Promise<string>;
  /** The app theme for the "as on screen" option. */
  screen?: () => { vars: Record<string, string>; dark: boolean };
  bodyFont?: () => "sans" | "serif" | "mono";
  now?: () => Date;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, label: string) => void;
}

export interface TocEntry { id: string; level: 1 | 2 | 3; text: string; note: number }
export interface PrintWarnings { fonts?: boolean; katex?: boolean; imagesMissing: number; diagramsFallback: number; mediaPlain: number; skippedNotes: number }
export interface PrintDoc {
  /** The complete standalone document. */
  html: string;
  css: string; fontCss: string; katexCss: string;
  /** Inner HTML of <main> (title page, TOC, notes, link notes, answer key). */
  body: string;
  title: string; toc: TocEntry[]; warnings: PrintWarnings;
  /** Each note's own HTML, for the "HTML folder" export. */
  notes: { id: string; title: string; html: string; index: number }[];
  linkCount: number;
}
export interface BuildOptions extends PrintOptions {
  engine: Engine;
  /** href for a wikilink to another exported note (HTML folder uses page file names); default `#note-<i>`. */
  hrefFor?: (n: PrintNote, index: number) => string;
  /** Notes a wikilink may point to (the whole export, when each page is built on its own); default: the notes being built. */
  linkTargets?: PrintNote[];
  /** Only the notes' own body (no document shell): used by the HTML folder export. */
  shell?: boolean;
}

// ------------------------------------------------------------------ small helpers
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const norm = (s: string) => s.replace(/[*_`[\]]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const aborted = (env: PrintEnv) => { if (env.signal?.aborted) throw new DOMException("Export cancelled", "AbortError"); };
const isHttp = (h: string) => /^(https?:|mailto:)/i.test(h);
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

/** A safe file name from a note title: no path characters, no control characters, no Windows reserved names, no trailing dots, ≤ 80 characters. */
export function exportFileName(title: string, ext: string): string {
  let s = [...title.normalize("NFC").replace(/\s+/g, " ")].filter((c) => c.codePointAt(0)! >= 32 && c.codePointAt(0)! !== 127).join("")
    .replace(/[\\/:*?"<>|#%{}^~[\]`;=]+/g, "-").replace(/[‎‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").replace(/^[\s.-]+|[\s.-]+$/g, "");
  s = [...s].slice(0, 80).join("").replace(/[\s.-]+$/, "");
  if (!s || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = s ? `${s}-` : "Untitled";
  return s + (ext.startsWith(".") ? ext : "." + ext);
}

/** Header / footer templates for headless Chromium's `page.pdf` (the native engine): title · date · page X of Y. */
export function headerFooterTemplates(title: string, date: string, o: { headerFooter: boolean; pageNumbers: boolean }, words: { page: string; of: string }) {
  const style = `font-size:8px;color:#666;width:100%;padding:0 14mm;font-family:Arial,sans-serif;display:flex;justify-content:space-between;`;
  const header = o.headerFooter ? `<div style="${style}"><span>${esc(title)}</span><span>${esc(date)}</span></div>` : `<div></div>`;
  const pg = `${esc(words.page)} <span class="pageNumber"></span> ${esc(words.of)} <span class="totalPages"></span>`;
  const footer = o.headerFooter ? `<div style="${style}justify-content:center;"><span>${esc(title)} · ${esc(date)} · ${pg}</span></div>` : o.pageNumbers ? `<div style="${style}justify-content:center;"><span>${pg}</span></div>` : `<div></div>`;
  return { headerTemplate: header, footerTemplate: footer };
}

// ------------------------------------------------------------------ includes
const plainHeading = (s: string) => s.replace(/[*_`[\]]/g, "").replace(/\s+#*\s*$/, "").trim().toLowerCase();
/** `![[Note]]` / `![[Note#Heading]]` / `![[Note#^id]]`: the Markdown to inline, or null when the note doesn't exist. */
export function includeMarkdown(note: PrintNote | null, heading: string): string | null {
  if (!note || note.type === "canvas" || isWbType(note.type as never)) return null;
  const body = splitFrontMatter(note.body).body;
  if (heading.startsWith("^")) return blockSource(body, heading.slice(1)) ?? `*${t("No block ^{id} in {title}.", { id: heading.slice(1), title: note.title })}*`;
  const lines = body.split("\n");
  if (!heading) { const i = lines.findIndex((x) => /^#\s/.test(x)); return lines.filter((_l, k) => k !== i).join("\n"); }
  const want = plainHeading(heading);
  let fence = false, start = -1, level = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(`{3,}|~{3,})/.test(lines[i])) fence = !fence;
    const h = !fence && /^(#{1,6})\s+(.+)$/.exec(lines[i]);
    if (!h) continue;
    if (start >= 0 && h[1].length <= level) return lines.slice(start + 1, i).join("\n");
    if (start < 0 && plainHeading(h[2]) === want) { start = i; level = h[1].length; }
  }
  return start >= 0 ? lines.slice(start + 1).join("\n") : `*${t("No heading “{heading}” in {title}.", { heading, title: note.title })}*`;
}

// ------------------------------------------------------------------ the transform pipeline
interface Ctx {
  env: PrintEnv; o: BuildOptions; notes: PrintNote[]; byTitle: Map<string, number>; lookup: (title: string) => PrintNote | null;
  targets: PrintNote[]; noteIndex: number; w: PrintWarnings;
  links: { url: string }[]; linkIdx: Map<string, number>;
  keys: { note: number; n: number; q?: string; a: string }[]; keyN: number;
  hid: number;
}
const el = (doc: Document, html: string): Element => { const d = doc.createElement("div"); d.innerHTML = html; return d.firstElementChild!; };
const all = (root: Element, sel: string) => Array.from(root.querySelectorAll(sel));
const tokenKind = (mime: string) => (mime.startsWith("video/") ? t("Video") : mime.startsWith("audio/") ? t("Audio") : mime === "application/pdf" ? "PDF" : t("File"));

/** Transclusions: ![[Note]] / ![[Note#Heading]] / ![[Note#^id]] are inlined (3 levels at most, no loops). */
function expandIncludes(root: Element, c: Ctx, depth = 0, chain: string[] = []) {
  for (const span of all(root, "span.transclude")) {
    const title = span.getAttribute("data-note") ?? "", heading = span.getAttribute("data-heading") ?? "";
    const label = span.textContent ?? title;
    const key = `${title}#${heading}`.toLowerCase();
    const plain = () => span.replaceWith(el(c.env.doc, `<span class="wikilink-text">${esc(label)}</span>`));
    if (depth >= 3 || chain.includes(key)) { plain(); continue; }
    const src = includeMarkdown(c.lookup(title), heading);
    if (src == null) { plain(); continue; }
    const html = c.env.render(src);
    const box = el(c.env.doc, `<div class="transclusion"><div class="tc-head" dir="auto">${esc(title)}${heading ? ` › ${esc(heading.replace(/^\^/, "^"))}` : ""}</div><div class="tc-body">${html}</div></div>`);
    if (html.replace(/<[^>]*>/g, "").length < 1200) box.classList.add("short");
    const p = span.parentElement;
    if (p && p.tagName === "P" && p.childNodes.length === 1) p.replaceWith(box); else span.replaceWith(box);
    expandIncludes(box.querySelector(".tc-body")!, c, depth + 1, [...chain, key]);
  }
}

/** [[wikilinks]] become anchors to the note inside the export, or plain title text; tags and block links are plain text. */
function resolveLinks(root: Element, c: Ctx) {
  for (const a of all(root, "a.wikilink")) {
    const title = (a.getAttribute("data-note") ?? "").trim();
    const i = title ? c.byTitle.get(title.toLowerCase()) : undefined;
    const label = a.textContent ?? title;
    if (i !== undefined && c.targets.length > 1) {
      const href = c.o.hrefFor ? c.o.hrefFor(c.targets[i], i) : `#note-${i + 1}`;
      a.setAttribute("href", href);
      for (const k of ["data-note", "data-heading", "class"]) a.removeAttribute(k);
      a.setAttribute("class", "wikilink");
    } else a.replaceWith(el(c.env.doc, `<span class="wikilink-text">${esc(label)}</span>`));
  }
  for (const a of all(root, "a.tag")) a.replaceWith(el(c.env.doc, `<span class="tag">${esc(a.textContent ?? "")}</span>`));
}

async function inlineDiagrams(root: Element, c: Ctx) {
  for (const card of all(root, ".mermaid-card")) {
    aborted(c.env);
    const src = decodeURIComponent(card.querySelector(".mermaid-block")?.getAttribute("data-src") ?? "");
    const kind = (card.querySelector(".mm-head span")?.textContent ?? "mermaid").replace(/^mermaid\s*·?\s*/, "");
    let svg: string | null = null;
    try { svg = (await c.env.mermaid?.(src, c.o.theme)) ?? null; } catch { svg = null; }
    if (svg && /<svg[\s>]/.test(svg)) {
      card.replaceWith(el(c.env.doc, `<figure class="diagram" aria-label="${esc(kind)}">${fitSvg(svg)}</figure>`));
    } else {
      c.w.diagramsFallback++;
      card.replaceWith(el(c.env.doc, `<figure class="diagram-fallback"><figcaption dir="auto">${esc(t("Diagram (could not be drawn here). Mermaid source:"))}</figcaption><pre class="code short" dir="ltr"><code>${esc(src)}</code></pre></figure>`));
    }
  }
  for (const box of all(root, ".canvas-embed")) {
    aborted(c.env);
    const json = decodeURIComponent(box.getAttribute("data-canvas") ?? "");
    let svg: string | null = null;
    try { svg = (await c.env.canvasSvg?.(json)) ?? null; } catch { svg = null; }
    if (svg && /<svg[\s>]/.test(svg)) box.replaceWith(el(c.env.doc, `<figure class="diagram">${fitSvg(svg)}</figure>`));
    else { c.w.diagramsFallback++; box.replaceWith(el(c.env.doc, `<figure class="diagram-fallback"><figcaption dir="auto">${esc(t("Canvas (could not be drawn here). Source:"))}</figcaption><pre class="code" dir="ltr"><code>${esc(json)}</code></pre></figure>`)); }
  }
  for (const q of all(root, ".query-block")) {
    const src = decodeURIComponent(q.getAttribute("data-q") ?? "");
    let html: string | null = null;
    try { html = (await c.env.query?.(src)) ?? null; } catch { html = null; }
    q.replaceWith(el(c.env.doc, html ? `<div class="query-block">${html}</div>` : `<figure class="diagram-fallback"><figcaption dir="auto">${esc(t("Query (not run in exports). Source:"))}</figcaption><pre class="code short" dir="ltr"><code>${esc(src)}</code></pre></figure>`));
  }
}
/** Make an SVG scale to the page: keep its viewBox, drop fixed widths, cap at its natural width. */
function fitSvg(svg: string): string {
  const vb = /viewBox="([\d.\s,-]+)"/.exec(svg)?.[1].split(/[\s,]+/).map(Number);
  const w = vb && vb.length === 4 ? Math.round(vb[2]) : 0;
  return svg.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    const a = attrs.replace(/\s(width|height)="[^"]*"/g, "").replace(/\sstyle="[^"]*"/, "");
    return `<svg${a} width="${w || "100%"}" style="max-width:100%;height:auto${w ? `;width:${w}px` : ""}">`;
  });
}

const missingImg = (c: Ctx, label: string) => { c.w.imagesMissing++; return `<span class="img-missing" dir="auto">${esc(label ? `${label} · ${t("image not available offline")}` : t("image not available offline"))}</span>`; };

async function mediaBlock(c: Ctx, kind: string, title: string, url: string, meta?: MediaMeta | null): Promise<string> {
  let qr = "";
  if (c.o.media === "qr" && url) { try { const d = await c.env.qr?.(url); if (d) qr = `<img class="qr" alt="QR" src="${d}">`; } catch { /* no QR: the URL stays */ } }
  const poster = c.o.media !== "text" && meta?.poster ? `<img class="poster" alt="" src="${meta.poster}">` : c.o.media === "text" ? "" : `<span class="poster-none" aria-hidden="true"></span>`;
  if (!meta?.poster) c.w.mediaPlain++;
  return `<figure class="media-fallback">${poster}<div class="m-body"><div class="m-kind">${esc(kind)}</div><div class="m-title" dir="auto">${esc(meta?.title || title)}</div>${url ? `<div class="m-url" dir="ltr">${esc(url)}</div>` : ""}</div>${qr}</figure>`;
}

/** Images → data: URIs; video / audio / PDF / embeds → poster + title + URL. */
async function inlineMedia(root: Element, c: Ctx) {
  for (const img of all(root, "img")) {
    aborted(c.env);
    const id = img.getAttribute("data-att");
    const alt = img.getAttribute("alt") ?? "";
    const src = img.getAttribute("src") ?? "";
    const m = /\/api\/att\/([\w-]+)/.exec(src);
    const attId = id ?? (m ? m[1] : null);
    if (img.classList.contains("poster") || img.classList.contains("qr")) continue;
    if (attId) {
      let a: Attachment | null = null;
      try { a = (await c.env.attachment?.(attId)) ?? null; } catch { a = null; }
      const holder = img.closest("p") && img.closest("p")!.childNodes.length === 1 ? img.closest("p")! : img;
      if (!a) { holder.replaceWith(el(c.env.doc, missingImg(c, alt))); continue; }
      if (/^(video|audio)\/|^application\/pdf$/.test(a.mime)) { holder.replaceWith(el(c.env.doc, await mediaBlock(c, tokenKind(a.mime), alt || a.name || t("Attachment"), "", null))); continue; }
      img.setAttribute("src", a.data);
      for (const k of ["data-att", "loading"]) img.removeAttribute(k);
      continue;
    }
    if (src.startsWith("data:")) { img.removeAttribute("loading"); continue; }
    if (/^https?:/i.test(src)) {
      let d: string | null = null;
      try { d = (await c.env.image?.(src)) ?? null; } catch { d = null; }
      if (d) { img.setAttribute("src", d); img.removeAttribute("loading"); } else img.replaceWith(el(c.env.doc, missingImg(c, alt)));
      continue;
    }
    img.replaceWith(el(c.env.doc, missingImg(c, alt))); // relative or unknown source: nothing to embed
  }
  for (const f of all(root, "figure.vthumb")) {
    aborted(c.env);
    const provider = f.getAttribute("data-provider") ?? "", id = f.getAttribute("data-id") ?? "", href = f.getAttribute("data-href") ?? "";
    let meta: MediaMeta | null = null;
    try { meta = (await c.env.media?.(provider, id, href)) ?? null; } catch { meta = null; }
    f.replaceWith(el(c.env.doc, await mediaBlock(c, provider === "vimeo" ? "Vimeo" : "YouTube", provider === "vimeo" ? "Vimeo" : "YouTube", href, meta)));
  }
  for (const f of all(root, ".vfile, .afile, .pdfcard")) {
    const src = f.getAttribute("data-src") ?? "", name = f.getAttribute("data-name") ?? "";
    const kind = f.classList.contains("vfile") ? t("Video") : f.classList.contains("afile") ? t("Audio") : "PDF";
    const url = /^https?:/i.test(src) ? src : "";
    f.replaceWith(el(c.env.doc, await mediaBlock(c, kind, name || t("Attachment"), url, null)));
  }
  for (const f of all(root, "iframe, video, audio, embed, object")) {
    const src = f.getAttribute("src") ?? "";
    f.replaceWith(el(c.env.doc, await mediaBlock(c, t("Embedded media"), hostOf(src) || t("Embedded media"), /^https?:/i.test(src) ? src : "", null)));
  }
  for (const a of all(root, "a.link-card")) {
    const href = a.getAttribute("href") ?? "";
    const host = hostOf(href);
    a.replaceWith(el(c.env.doc, `<figure class="media-fallback"><span class="poster-none" aria-hidden="true"></span><div class="m-body"><div class="m-kind">${esc(t("Link"))}</div><div class="m-title" dir="auto">${esc(host)}</div><div class="m-url" dir="ltr">${esc(href)}</div></div></figure>`));
  }
  for (const a of all(root, "a[data-att]")) {
    const name = (a.textContent ?? "").replace(/\s+/g, " ").trim() || t("Attachment");
    a.replaceWith(el(c.env.doc, `<span class="wikilink-text" dir="auto">${esc(name)} <span class="lurl">(${esc(t("attached file"))})</span></span>`));
  }
  for (const b of all(root, "button.vts")) b.replaceWith(el(c.env.doc, `<span class="vts">[${esc(b.textContent ?? "")}]</span>`));
}

/** External links: inline URL, numbered footnotes or none. `#`, `javascript:` and in-document anchors are left alone. */
function styleLinks(root: Element, c: Ctx) {
  for (const a of all(root, "a[href]")) {
    const href = (a.getAttribute("href") ?? "").trim();
    if (!href || href.startsWith("#") || /^javascript:/i.test(href) || a.classList.contains("wikilink") || a.closest(".footnote-ref, .footnotes, .link-notes, .toc, .md-toc, .doc-side")) continue;
    for (const k of ["target", "rel", "tabindex"]) a.removeAttribute(k);
    if (!isHttp(href)) { a.replaceWith(el(c.env.doc, `<span>${a.innerHTML}</span>`)); continue; }
    const text = (a.textContent ?? "").trim();
    const same = text.replace(/^https?:\/\//, "").replace(/\/$/, "") === href.replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (c.o.links === "none") { a.replaceWith(el(c.env.doc, `<span>${a.innerHTML}</span>`)); continue; }
    if (c.o.links === "inline") { if (!same) a.after(el(c.env.doc, `<span class="lurl" dir="ltr"> (${esc(href)})</span>`)); continue; }
    let n = c.linkIdx.get(href);
    if (!n) { c.links.push({ url: href }); n = c.links.length; c.linkIdx.set(href, n); }
    a.after(el(c.env.doc, `<sup class="lfn"><a href="#link-${n}" id="lref-${c.noteIndex}-${n}">[${n}]</a></sup>`));
  }
}

/** Cloze deletions and Question :: Answer rows: answers shown, hidden, or hidden with a numbered answer key. */
function flashcards(root: Element, c: Ctx) {
  const mode = c.o.answers;
  if (mode === "show") return;
  const blank = (text: string, cls: string) => {
    const n = mode === "key" ? ++c.keyN : 0;
    const width = Math.max(3, Math.min(14, Math.round(text.length * 0.6)));
    return { n, html: `<span class="${cls}" style="min-width:${width}em" aria-hidden="true">&nbsp;</span>${n ? `<sup class="cloze-key">${n}</sup>` : ""}` };
  };
  for (const s of all(root, "span.cloze, mark.cloze, span.cloze-ans")) {
    const text = (s.textContent ?? "").trim();
    const b = blank(text, "cloze-hidden");
    if (b.n) c.keys.push({ note: c.noteIndex, n: b.n, a: text });
    s.replaceWith(el(c.env.doc, `<span class="cloze-wrap">${b.html}</span>`));
  }
  for (const row of all(root, ".fc-row")) {
    const a = row.querySelector(".fc-a");
    if (!a) continue;
    const text = (a.textContent ?? "").trim(), q = (row.querySelector(".fc-q")?.textContent ?? "").trim();
    const b = blank(text, "fc-hidden");
    if (b.n) c.keys.push({ note: c.noteIndex, n: b.n, q, a: text });
    a.innerHTML = b.html;
  }
}

/** Real <thead>, size classes for wide tables, short tables that must not split. */
function tables(root: Element, c: Ctx) {
  for (const tb of all(root, "table")) {
    if (tb.classList.contains("fm")) continue;
    let head = tb.querySelector("thead");
    const first = tb.querySelector("tr");
    if (!head && first) {
      head = c.env.doc.createElement("thead");
      const row = first.cloneNode(true) as Element;
      for (const cell of all(row, "td")) { const th = c.env.doc.createElement("th"); th.innerHTML = cell.innerHTML; for (const at of Array.from(cell.attributes)) th.setAttribute(at.name, at.value); cell.replaceWith(th); }
      head.appendChild(row);
      first.parentElement?.removeChild(first);
      tb.insertBefore(head, tb.firstChild);
    }
    const cols = Math.max(...all(tb, "tr").map((r) => r.children.length), 0);
    const rows = all(tb, "tr").length;
    const host = tb.closest(".tbl") ?? tb.parentElement!;
    const cls = cols >= 12 ? "cols-wide" : cols >= 10 ? "cols-10" : cols >= 8 ? "cols-8" : "";
    if (cls) host.classList.add(cls);
    if (rows <= 14) host.classList.add("short");
    if (!host.classList.contains("tbl")) { const wrap = c.env.doc.createElement("div"); wrap.setAttribute("class", `tbl ${cls}${rows <= 14 ? " short" : ""}`); tb.replaceWith(wrap); wrap.appendChild(tb); }
  }
}

function cleanup(root: Element, c: Ctx) {
  for (const x of all(root, "[data-line]")) x.removeAttribute("data-line");
  for (const x of all(root, ".code-head, .mm-head, .tbl-tools, .lc-more, .copy")) x.remove();
  for (const x of all(root, "input[type=checkbox]")) {
    const on = x.hasAttribute("checked");
    x.replaceWith(el(c.env.doc, `<span class="chk${on ? " on" : ""}" role="img" aria-label="${on ? t("done") : t("not done")}"></span>`));
    if (on) x.closest(".task-list-item")?.classList.add("done-item");
  }
  for (const x of all(root, "li.task-list-item")) if (x.querySelector(".chk.on")) x.classList.add("done-item");
  for (const d of all(root, "details")) d.setAttribute("open", "");
  for (const p of all(root, "pre.code")) { const n = (p.textContent ?? "").split("\n").length; if (n <= 24) p.classList.add("short"); }
  for (const x of all(root, ".callout")) if ((x.textContent ?? "").length > 1400) x.classList.add("tall");
  for (const nav of all(root, "nav.md-toc")) {
    const hs = all(root, "h2, h3").filter((h) => !h.closest(".transclusion, .md-toc"));
    nav.innerHTML = `<div class="md-toc-t">${esc(t("Contents"))}</div>` + (hs.length ? `<ol>${hs.map((h) => `<li class="toc-${h.tagName.toLowerCase()}"><span dir="auto">${esc(h.textContent ?? "")}</span></li>`).join("")}</ol>` : "");
  }
  // dir="auto" on every block (RTL and mixed notes)
  for (const x of all(root, "p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, figcaption, summary, .callout, .fc-q, .fc-a, .tc-head, dd, dt")) if (!x.hasAttribute("dir")) x.setAttribute("dir", "auto");
}

// ------------------------------------------------------------------ document assembly
function paletteFor(o: PrintOptions, env: PrintEnv): { palette: Palette; dark?: Palette } {
  if (o.theme === "bw") return { palette: BW };
  if (o.theme === "screen") {
    const s = env.screen?.();
    if (s) {
      const p: Palette = { ...(s.dark ? LAMPLIGHT : PAPER), ...pickColors(s.vars), dark: s.dark };
      return { palette: p, dark: s.dark ? p : LAMPLIGHT };
    }
    return { palette: LAMPLIGHT, dark: LAMPLIGHT };
  }
  return { palette: PAPER, dark: LAMPLIGHT };
}
function pickColors(vars: Record<string, string>): Partial<Palette> {
  const hex = (k: string) => (/^#[0-9a-f]{6}$/i.test(vars[k] ?? "") ? vars[k] : undefined);
  const out: Partial<Palette> = {};
  const m: [keyof Palette, string][] = [["bg", "bg"], ["surface", "surface"], ["surface2", "surface-2"], ["border", "border"], ["text", "text"], ["muted", "muted"], ["accent", "accent"], ["link", "link"]];
  for (const [k, v] of m) { const x = hex(v); if (x) (out as Record<string, string>)[k] = x; }
  return out;
}

const fmtDate = (d: Date) => d.toLocaleDateString(getLang() === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric" });

function frontMatterHtml(n: PrintNote): string {
  const fm = splitFrontMatter(n.body).data;
  const rows: [string, string][] = Object.entries({ ...fm }).filter(([k, v]) => v && k !== "title").map(([k, v]) => [k, v]);
  const meta = [
    n.createdAt ? `<span>${esc(fmtDate(new Date(n.createdAt)))}</span>` : "", n.status ? `<span class="status">${esc(n.status)}</span>` : "",
    ...(n.tags ?? []).map((x) => `<span class="tag">#${esc(x)}</span>`),
  ].join("");
  return (meta ? `<div class="note-meta">${meta}</div>` : "") + (rows.length ? `<table class="fm">${rows.map(([k, v]) => `<tr><th dir="auto">${esc(k)}</th><td dir="auto">${esc(v)}</td></tr>`).join("")}</table>` : "");
}

/** Build the standalone document. Throws AbortError when `env.signal` aborts. */
export async function buildPrintDoc(input: PrintInput, opts: Partial<BuildOptions> & { engine: Engine }, env: PrintEnv): Promise<PrintDoc> {
  const o: BuildOptions = { ...PRINT_DEFAULTS, ...opts };
  const notes = input.notes;
  const multi = notes.length > 1;
  if (multi) o.newPagePerNote = true;
  const targets = o.linkTargets ?? notes;
  const byTitle = new Map<string, number>();
  targets.forEach((n, i) => { if (!byTitle.has(n.title.toLowerCase())) byTitle.set(n.title.toLowerCase(), i); });
  const lookup = input.lookup ?? ((title: string) => { const i = byTitle.get(title.toLowerCase()); return i === undefined ? null : targets[i]; });
  const w: PrintWarnings = { imagesMissing: 0, diagramsFallback: 0, mediaPlain: 0, skippedNotes: 0 };
  const c: Ctx = { env, o, notes, targets, byTitle, lookup, noteIndex: 0, w, links: [], linkIdx: new Map(), keys: [], keyN: 0, hid: 0 };
  const toc: TocEntry[] = [];
  const sections: { id: string; title: string; html: string; index: number }[] = [];

  for (const [i, n] of notes.entries()) {
    aborted(env);
    env.onProgress?.(i, notes.length, n.title);
    c.noteIndex = i + 1;
    const m = /^(---\r?\n[\s\S]*?\r?\n---\r?\n?)?([\s\S]*)$/.exec(n.body)!;
    const rest = m[2].replace(/^\s*#[ \t]+(.+?)[ \t]*#*[ \t]*(\r?\n|$)/, (whole, h: string) => (norm(h) === norm(n.title) ? "" : whole));
    const box = env.doc.createElement("div");
    box.innerHTML = env.render((m[1] ?? "") + rest);
    expandIncludes(box, c);
    resolveLinks(box, c);
    await inlineDiagrams(box, c);
    await inlineMedia(box, c);
    tables(box, c);
    flashcards(box, c);
    styleLinks(box, c);
    cleanup(box, c);
    // headings → anchors + TOC entries
    const tid = `h-${i + 1}-0`;
    toc.push({ id: tid, level: 1, text: n.title, note: i + 1 });
    let k = 0;
    for (const h of all(box, "h1, h2, h3")) {
      if (h.closest(".transclusion, .md-toc, .callout, .fm")) continue;
      const id = `h-${i + 1}-${++k}`;
      h.setAttribute("id", id);
      toc.push({ id, level: Number(h.tagName[1]) as 1 | 2 | 3, text: (h.textContent ?? "").replace(/\s+/g, " ").trim(), note: i + 1 });
    }
    const head = `<header class="note-head"><h1 class="note-title" id="${tid}" dir="auto">${esc(n.title)}</h1>${o.frontMatter ? frontMatterHtml(n) : ""}</header>`;
    const html = `<section class="note" id="note-${i + 1}" data-note="${esc(n.id)}">${head}${box.innerHTML}</section>`;
    sections.push({ id: n.id, title: n.title, html, index: i + 1 });
  }
  env.onProgress?.(notes.length, notes.length, "");

  const now = (env.now ?? (() => new Date()))();
  const dateLabel = fmtDate(now);
  const tocHtml = (cls: string) => `<nav class="${cls}" aria-label="${esc(t("Contents"))}"><h2 class="toc-title" dir="auto">${esc(t("Contents"))}</h2><ol>${toc.map((e) => `<li class="toc-l${e.level}" dir="auto"><a class="toc-link" href="#${e.id}"><span class="toc-text" dir="auto">${esc(e.text)}</span><span class="toc-dots"></span></a></li>`).join("")}</ol></nav>`;
  const linkNotes = c.links.length && o.links === "footnote"
    ? `<section class="link-notes"><h2 dir="auto">${esc(t("Links"))}</h2><ol>${c.links.map((l, i) => `<li id="link-${i + 1}" dir="ltr"><a href="${esc(l.url)}">${esc(l.url)}</a></li>`).join("")}</ol></section>` : "";
  const key = c.keys.length
    ? `<section class="answer-key"><h2 dir="auto">${esc(t("Answer key"))}</h2>${notes.map((n, i) => { const ks = c.keys.filter((x) => x.note === i + 1); return ks.length ? `${multi ? `<h3 dir="auto">${esc(n.title)}</h3>` : ""}<ol>${ks.map((x) => `<li value="${x.n}" dir="auto">${x.q ? `<span class="muted">${esc(x.q)} → </span>` : ""}<b>${esc(x.a)}</b></li>`).join("")}</ol>` : ""; }).join("")}</section>` : "";
  const sub = [multi ? t("{n} notes", { n: notes.length }) : "", dateLabel].filter(Boolean).join(" · ");
  const titlePage = o.titlePage ? `<section class="titlepage"><div class="tp-rule"></div><h1 dir="auto">${esc(input.title)}</h1><div class="tp-sub">${esc(sub)}</div></section>` : "";
  const body = `${titlePage}${o.toc ? tocHtml("toc") : ""}${sections.map((s) => s.html).join("")}${linkNotes}${key}`;

  // fonts + KaTeX are resolved from what the document actually uses
  const text = body.replace(/<[^>]*>/g, " ");
  const hasMath = /class="katex/.test(body);
  const flags = { mono: /<pre|<code/.test(body), serif: (env.bodyFont?.() ?? "sans") === "serif", arabic: /[؀-ۿ]/.test(text), italic: /<(em|i)[\s>]/.test(body) };
  let fontCss = "";
  try { fontCss = (await env.fonts?.(text, flags)) ?? ""; } catch { fontCss = ""; }
  if (env.fonts && !fontCss) w.fonts = true;
  let katexCss = "";
  if (hasMath) { try { katexCss = (await env.katexCss?.(body)) ?? ""; } catch { katexCss = ""; } if (env.katexCss && !katexCss) w.katex = true; }
  aborted(env);

  const { palette, dark } = paletteFor(o, env);
  const cssO: CssOptions = {
    engine: o.engine, paper: o.paper, landscape: o.landscape, marginMm: o.marginMm, fontPt: o.fontPt, palette, theme: o.theme, bodyFont: env.bodyFont?.() ?? "sans",
    pageNumbers: o.pageNumbers, headerFooter: o.headerFooter, tocNumbers: o.toc, docTitle: input.title, dateLabel, pageWord: t("page") + " ", ofWord: " " + t("of") + " ",
    contentsWord: t("Contents"), breakH: o.breakH, newPagePerNote: o.newPagePerNote, darkPalette: o.theme === "bw" ? undefined : dark,
  };
  const css = printCss(cssO);
  const lang = getLang(), rtl = isRtl();
  const isHtml = o.engine === "html";
  const toggle = isHtml && o.theme !== "bw" ? `<button type="button" class="theme-toggle no-print" aria-label="${esc(t("Switch light / dark"))}">${esc(t("Light / dark"))}</button><script>${TOGGLE_JS}</script>` : "";
  const main = `<main class="doc-main" dir="auto">${body}</main>`;
  const side = isHtml && toc.length ? `<aside class="doc-side"><p class="side-t" dir="auto">${esc(input.title)}</p>${tocHtml("side-toc").replace(/<h2[^>]*>.*?<\/h2>/, "")}</aside>` : "";
  const shell = (inner: string) => `<!doctype html><html lang="${lang}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="${isHtml && o.theme !== "bw" ? "light dark" : "light"}"><meta name="generator" content="Lumen"><title>${esc(input.title)}</title>`
    + `${fontCss ? `<style id="fonts">${fontCss}</style>` : ""}${katexCss ? `<style id="katex">${katexCss}</style>` : ""}<style id="print">${css}</style></head><body class="theme-${o.theme} engine-${o.engine}">${inner}</body></html>`;
  const html = shell(isHtml ? `<div class="doc-wrap">${side}${main}</div>${toggle}` : main);
  return { html, css, fontCss, katexCss, body, title: input.title, toc, warnings: w, notes: sections.map((s) => ({ id: s.id, title: s.title, html: s.html, index: s.index })), linkCount: c.links.length };
}

const TOGGLE_JS = `(function(){var r=document.documentElement,b=document.querySelector('.theme-toggle');try{var s=localStorage.getItem('lumen-doc-theme');if(s)r.setAttribute('data-theme',s)}catch(e){}if(b)b.addEventListener('click',function(){var a=r.getAttribute('data-theme');var d=a==='dark'||(!a&&matchMedia('(prefers-color-scheme: dark)').matches);var n=d?'light':'dark';r.setAttribute('data-theme',n);try{localStorage.setItem('lumen-doc-theme',n)}catch(e){}})})();`;

export { PAPER_NAME };
