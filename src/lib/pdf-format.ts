// PDF document notes (note type `pdf`): front matter points at the file, the body keeps the highlights as open Markdown.
// Pure functions only (no DOM, no Dexie) so they run in scripts/pdf.test.ts. Format reference: docs/PDF.md.
//
//   ---
//   type: pdf
//   file: att:3f2c…            (or an https URL)
//   page: 4                    (last page read, 1-based)
//   pages: 15
//   progress: 27               (percent of the document read)
//   ---
//   # Attention Is All You Need
//
//   Free notes about the paper…
//
//   ## Highlights
//
//   - yellow · p. 4 · The Transformer follows this overall architecture ^hl-k3x9a
//     - comment: the key sentence
//     - tags: #architecture #attention
//     - rects: 0.1176 0.3021 0.7647 0.0142, 0.1176 0.3163 0.4 0.0142
//     - text: 1234 87
//     - created: 2026-11-19T10:22:31Z
//   - blue · p. 3 · area ![Figure 1, p. 3](att:9ab1…) ^hl-ab12c
//     - rects: 0.1 0.2 0.5 0.4
//
// A highlight is linked from anywhere with the standard block reference `[[Title#^hl-k3x9a]]`.

export type HlColor = "yellow" | "green" | "blue" | "red" | "purple";
/** The 5 highlight colors, in toolbar order, mapped to JSON Canvas color presets (lib/canvas.ts PRESETS). */
export const HL_COLORS: { name: HlColor; preset: string; hex: string }[] = [
  { name: "yellow", preset: "3", hex: "#E3B341" },
  { name: "green", preset: "4", hex: "#57AB5A" },
  { name: "blue", preset: "5", hex: "#39C5CF" },
  { name: "red", preset: "1", hex: "#E5534B" },
  { name: "purple", preset: "6", hex: "#A371F7" },
];
export const hlHex = (c: HlColor) => HL_COLORS.find((x) => x.name === c)?.hex ?? HL_COLORS[0].hex;
export const hlPreset = (c: HlColor) => HL_COLORS.find((x) => x.name === c)?.preset ?? "3";
export const colorFromPreset = (p?: string): HlColor => HL_COLORS.find((x) => x.preset === p)?.name ?? "yellow";
const isColor = (s: string): s is HlColor => HL_COLORS.some((x) => x.name === s);

/** Normalized rectangle on a page: x, y, width, height as fractions (0…1) of the page width / height. */
export type Rect = [number, number, number, number];

export interface Highlight {
  /** Stable id, also the Markdown block id: `hl-` + base36. */
  id: string;
  color: HlColor;
  /** 1-based page number. */
  page: number;
  /** Selected text (empty for an area highlight). */
  quote: string;
  /** Area highlights: the captured PNG (`att:<id>`, or any image URL). */
  image?: string;
  comment?: string;
  tags: string[];
  rects: Rect[];
  /** Character offset + length of the quote in the page's text (items joined without separators). */
  text?: [number, number];
  /** ISO time (second precision). */
  created?: string;
}

export interface PdfMeta { file: string; page: number; pages: number; progress: number }

// ------------------------------------------------------------------ front matter (minimal local copy of parse.ts so this stays dependency-free)
const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
function fmData(md: string): Record<string, string> {
  const m = FM.exec(md);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
/** Sets (or removes, with null) front-matter keys, keeping the other lines as they are. */
export function setFm(md: string, keys: Record<string, string | number | null | undefined>): string {
  const m = FM.exec(md);
  const lines = m ? m[1].split(/\r?\n/) : [];
  for (const [k, v] of Object.entries(keys)) {
    if (v === undefined) continue;
    const i = lines.findIndex((l) => l.slice(0, l.indexOf(":")).trim() === k);
    if (v === null) { if (i >= 0) lines.splice(i, 1); continue; }
    const line = `${k}: ${v}`;
    if (i >= 0) lines[i] = line; else lines.push(line);
  }
  const rest = m ? md.slice(m[0].length) : md;
  return lines.length ? `---\n${lines.join("\n")}\n---\n${rest}` : rest;
}

export function pdfMeta(body: string): PdfMeta {
  const d = fmData(body);
  const int = (s: string | undefined, def: number) => { const n = parseInt(s ?? "", 10); return Number.isFinite(n) ? n : def; };
  return { file: d.file ?? "", page: Math.max(1, int(d.page, 1)), pages: Math.max(0, int(d.pages, 0)), progress: Math.min(100, Math.max(0, int(d.progress, 0))) };
}
export const setPdfMeta = (body: string, p: Partial<PdfMeta>) => setFm(body, { file: p.file, page: p.page, pages: p.pages, progress: p.progress });
export const progressOf = (page: number, pages: number) => (pages > 0 ? Math.round((Math.min(page, pages) / pages) * 100) : 0);

/** A fresh pdf note body. */
export function newPdfBody(o: { title: string; file: string; pages?: number }) {
  const fm = ["type: pdf", `file: ${o.file}`, "page: 1", ...(o.pages ? [`pages: ${o.pages}`] : []), "progress: 0"];
  return `---\n${fm.join("\n")}\n---\n# ${o.title}\n\n## Highlights\n`;
}
/** "vaswani-2017-attention.pdf" → "vaswani 2017 attention". */
export const titleFromFile = (name: string) => name.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").replace(/[[\]#|^]/g, "").trim() || "Document";

// ------------------------------------------------------------------ highlights ↔ Markdown
const SPECIAL = /[\\`*_[\]#<>=|^]/g;
/** Escapes characters that would turn quote text into Markdown (links, tags, marks…); the quote stays one line. */
export const escapeMd = (s: string) => s.replace(/\s+/g, " ").trim().replace(SPECIAL, (c) => "\\" + c);
export const unescapeMd = (s: string) => s.replace(/\\(.)/g, "$1");

const r4 = (n: number) => String(Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000);
export const fmtRects = (rs: Rect[]) => rs.map((r) => r.map(r4).join(" ")).join(", ");
export function parseRects(s: string): Rect[] {
  return s.split(",").map((p) => p.trim().split(/\s+/).map(Number)).filter((a) => a.length === 4 && a.every((n) => Number.isFinite(n))) as Rect[];
}

const HEAD = /^- (\w+) · p\. (\d+) · (.*?)\s+\^(hl-[A-Za-z0-9-]+)\s*$/;
const SUB = /^\s{2,}- (\w+):\s?(.*)$/;
const AREA = /^area\s+!\[[^\]]*\]\(([^)\s]+)\)\s*$/;

export function serializeHighlight(h: Highlight): string {
  const head = h.image
    ? `- ${h.color} · p. ${h.page} · area ![${escapeMd(h.quote || `Area, p. ${h.page}`)}](${h.image}) ^${h.id}`
    : `- ${h.color} · p. ${h.page} · ${escapeMd(h.quote) || "(empty)"} ^${h.id}`;
  const sub: string[] = [];
  if (h.comment?.trim()) sub.push(`comment: ${h.comment.replace(/\s*\n\s*/g, " ").trim()}`);
  if (h.tags.length) sub.push(`tags: ${h.tags.map((t) => "#" + t.replace(/^#/, "")).join(" ")}`);
  if (h.rects.length) sub.push(`rects: ${fmtRects(h.rects)}`);
  if (h.text) sub.push(`text: ${h.text[0]} ${h.text[1]}`);
  if (h.created) sub.push(`created: ${h.created}`);
  return [head, ...sub.map((s) => `  - ${s}`)].join("\n");
}

/** Parses one highlight from its lines (head line first). */
function parseItem(lines: string[]): Highlight | null {
  const m = HEAD.exec(lines[0]);
  if (!m) return null;
  const color = isColor(m[1]) ? m[1] : "yellow";
  const h: Highlight = { id: m[4], color, page: Number(m[2]), quote: "", tags: [], rects: [] };
  const area = AREA.exec(m[3]);
  if (area) {
    h.image = area[1];
    const alt = /^area\s+!\[([^\]]*)\]/.exec(m[3])?.[1] ?? "";
    const q = unescapeMd(alt);
    h.quote = /^Area, p\. \d+$/.test(q) ? "" : q;
  } else h.quote = m[3] === "(empty)" ? "" : unescapeMd(m[3]);
  for (const l of lines.slice(1)) {
    const s = SUB.exec(l);
    if (!s) continue;
    const [, k, v] = s;
    if (k === "comment") h.comment = v.trim();
    else if (k === "tags") h.tags = [...v.matchAll(/#([\p{L}\p{N}_/-]+)/gu)].map((x) => x[1].toLowerCase());
    else if (k === "rects") h.rects = parseRects(v);
    else if (k === "text") { const [a, b] = v.trim().split(/\s+/).map(Number); if (Number.isFinite(a) && Number.isFinite(b)) h.text = [a, b]; }
    else if (k === "created") h.created = v.trim();
  }
  return h;
}

/** Line ranges [a, b] (inclusive, 0-based) of every highlight item in the body. */
function itemRanges(lines: string[]): { a: number; b: number; id: string }[] {
  const out: { a: number; b: number; id: string }[] = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(`{3,}|~{3,})/.test(lines[i])) fence = !fence;
    if (fence) continue;
    const m = HEAD.exec(lines[i]);
    if (!m) continue;
    let j = i;
    while (j + 1 < lines.length && SUB.test(lines[j + 1])) j++;
    out.push({ a: i, b: j, id: m[4] });
    i = j;
  }
  return out;
}

export function parseHighlights(body: string): Highlight[] {
  const lines = body.split("\n");
  return itemRanges(lines).map((r) => parseItem(lines.slice(r.a, r.b + 1))).filter((h): h is Highlight => !!h);
}

const sortKey = (h: Highlight) => h.page * 10 + (h.rects[0]?.[1] ?? 0);

/** Inserts or replaces a highlight. New items go into `## Highlights` (created at the end if missing), in page order. */
export function upsertHighlight(body: string, h: Highlight): string {
  const lines = body.split("\n");
  const ranges = itemRanges(lines);
  const text = serializeHighlight(h);
  const hit = ranges.find((r) => r.id === h.id);
  if (hit) { lines.splice(hit.a, hit.b - hit.a + 1, ...text.split("\n")); return lines.join("\n"); }
  let sec = lines.findIndex((l) => /^##\s+Highlights\s*$/i.test(l));
  if (sec < 0) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push("", "## Highlights", "");
    sec = lines.length - 2;
  }
  // section end = next heading of level ≤ 2
  let end = lines.length;
  for (let i = sec + 1; i < lines.length; i++) if (/^#{1,2}\s/.test(lines[i])) { end = i; break; }
  const inSec = ranges.filter((r) => r.a > sec && r.a < end);
  const all = parseHighlights(lines.join("\n"));
  const after = inSec.find((r) => { const o = all.find((x) => x.id === r.id); return o && sortKey(o) > sortKey(h); });
  let at: number;
  if (after) at = after.a;
  else if (inSec.length) at = inSec[inSec.length - 1].b + 1;
  else { at = sec + 1; while (at < end && !lines[at].trim()) at++; if (at === end || at === sec + 1) { lines.splice(sec + 1, 0, ""); at = sec + 2; } }
  lines.splice(at, 0, ...text.split("\n"));
  return lines.join("\n").replace(/\n*$/, "\n");
}

export function removeHighlight(body: string, id: string): string {
  const lines = body.split("\n");
  const r = itemRanges(lines).find((x) => x.id === id);
  if (!r) return body;
  lines.splice(r.a, r.b - r.a + 1);
  return lines.join("\n");
}

export function newHlId(rand: () => number = Math.random) {
  let s = "";
  for (let i = 0; i < 6; i++) s += "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(rand() * 32)];
  return "hl-" + s;
}
export const isoNow = (t = Date.now()) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");

// ------------------------------------------------------------------ panel: filter / sort
export interface HlFilter { color?: HlColor | null; tag?: string | null; q?: string }
export function filterHighlights(hs: Highlight[], f: HlFilter): Highlight[] {
  const q = f.q?.trim().toLowerCase();
  return hs.filter((h) => (!f.color || h.color === f.color) && (!f.tag || h.tags.includes(f.tag.toLowerCase()))
    && (!q || h.quote.toLowerCase().includes(q) || (h.comment ?? "").toLowerCase().includes(q)));
}
export function sortHighlights(hs: Highlight[], by: "page" | "date"): Highlight[] {
  return [...hs].sort(by === "page" ? (a, b) => sortKey(a) - sortKey(b) : (a, b) => (b.created ?? "").localeCompare(a.created ?? "") || sortKey(a) - sortKey(b));
}
export const allTags = (hs: Highlight[]) => [...new Set(hs.flatMap((h) => h.tags))].sort();

// ------------------------------------------------------------------ links, notes, cards, export
/** Block-reference back-link with a readable label: `[[Title#^hl-id|Title · p. 4]]`. */
export const hlLink = (title: string, h: Pick<Highlight, "id" | "page">) => `[[${title}#^${h.id}|${title} · p. ${h.page}]]`;
/** `[[Title#^hl-id…]]` → its parts (the label is optional). */
export function parseHlLink(s: string): { title: string; id: string; label: string } | null {
  const m = /\[\[([^\]#|]+)#\^(hl-[A-Za-z0-9-]+)(?:\|([^\]]*))?\]\]/.exec(s);
  return m ? { title: m[1].trim(), id: m[2], label: (m[3] ?? "").trim() } : null;
}
const pageOfLabel = (label: string) => Number(/p\. (\d+)\s*$/.exec(label)?.[1] ?? 0);

/** "The Transformer follows this overall architecture using…" → a short note title (≤ 8 words). */
export function shortTitle(quote: string, fallback = "Highlight") {
  const w = quote.replace(/[[\]#|^*_`]/g, "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!w.length) return fallback;
  return w.length > 8 ? w.slice(0, 8).join(" ") + "…" : w.join(" ");
}
const quoteBlock = (h: Highlight) => (h.image ? `![Area, p. ${h.page}](${h.image})` : `> ${escapeMd(h.quote)}`);

/** Body of a note made from one highlight (the title is the H1). */
export function hlNoteBody(pdfTitle: string, h: Highlight, title = shortTitle(h.quote, `${pdfTitle}, p. ${h.page}`)) {
  return `# ${title}\n\n${quoteBlock(h)}\n\n${h.comment ? h.comment + "\n\n" : ""}${hlLink(pdfTitle, h)}${h.tags.length ? "\n\n" + h.tags.map((t) => "#" + t).join(" ") : ""}\n`;
}
/** A flashcard line: `Q :: A [[Title#^hl…]]`, or a cloze line (`{{c1::…}}` already in `q`) with the back-link. */
export function flashcardLine(q: string, a: string, pdfTitle: string, h: Pick<Highlight, "id" | "page">) {
  const one = (s: string) => s.replace(/\s+/g, " ").trim();
  const link = hlLink(pdfTitle, h);
  return a.trim() ? `${one(q)} :: ${one(a)} ${link}` : `${one(q)} ${link}`;
}
/** All highlights as one Markdown document (export, and "Make a note from all highlights"). */
export function highlightsMarkdown(pdfTitle: string, hs: Highlight[], title = `${pdfTitle}: highlights`) {
  const out = [`# ${title}`, "", `Highlights from [[${pdfTitle}]].`, ""];
  let page = -1;
  for (const h of sortHighlights(hs, "page")) {
    if (h.page !== page) { page = h.page; out.push(`## p. ${page}`, ""); }
    out.push(quoteBlock(h), "");
    const meta = [h.comment, h.tags.map((t) => "#" + t).join(" ")].filter(Boolean).join(" · ");
    if (meta) out.push(meta, "");
    out.push(hlLink(pdfTitle, h), "");
  }
  return out.join("\n");
}

// ------------------------------------------------------------------ canvas (standard JSON Canvas text nodes, no format change)
/** Text of a highlight card on a canvas: the quote (or area image) + the back-link. */
export const hlCardText = (pdfTitle: string, h: Highlight) => `${quoteBlock(h)}\n\n${hlLink(pdfTitle, h)}`;
export function hlCanvasNode(pdfTitle: string, h: Highlight, x: number, y: number, id: string) {
  const len = h.image ? 0 : h.quote.length;
  const height = h.image ? 260 : Math.min(360, 96 + Math.ceil(len / 38) * 19);
  return { id, type: "text" as const, x: Math.round(x), y: Math.round(y), width: 320, height, color: hlPreset(h.color), text: hlCardText(pdfTitle, h) };
}
/** Recognizes a highlight card's text (see hlCardText). */
export function parseHlCard(text: string): { quote: string; image?: string; title: string; id: string; page: number } | null {
  const t = text.trim();
  const m = /^(?:> (.+)|!\[[^\]]*\]\(([^)\s]+)\))\n\n(\[\[[^\]]+\]\])$/s.exec(t);
  if (!m) return null;
  const link = parseHlLink(m[3]);
  if (!link) return null;
  return { quote: m[1] ? unescapeMd(m[1].replace(/\n> ?/g, " ")) : "", image: m[2], title: link.title, id: link.id, page: pageOfLabel(link.label) };
}
/** `#page=4` subpath of a canvas file card → 4. */
export const pageOfSubpath = (s?: string) => { const n = Number(/page=(\d+)/.exec(s ?? "")?.[1]); return Number.isFinite(n) && n > 0 ? n : 0; };

// ------------------------------------------------------------------ in-document search
const fold = (s: string) => s.toLowerCase();
/** Every match of `q` in `text` (case-insensitive) → start offsets. */
export function findAll(text: string, q: string): number[] {
  const needle = fold(q.trim());
  if (!needle) return [];
  const hay = fold(text);
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}
export interface SearchHit { page: number; index: number; at: number }
/** Hits across pages (pageTexts[0] = page 1), in reading order. */
export function searchPages(pageTexts: (string | null | undefined)[], q: string, max = 2000): SearchHit[] {
  const out: SearchHit[] = [];
  pageTexts.forEach((t, i) => { if (!t) return; findAll(t, q).forEach((at, k) => { if (out.length < max) out.push({ page: i + 1, index: k, at }); }); });
  return out;
}
