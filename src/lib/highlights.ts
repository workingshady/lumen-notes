// Reading highlights: mark text while reading (Focus › Read), then save them into the note as standard Markdown.
//   ==text==                 yellow (default; works in Lumen, Obsidian and most Markdown readers)
//   ==text=={.hl-green}      other colours (attribute syntax as in Pandoc / markdown-it-attrs; Lumen renders it)
//   ==text==[^hl-3]          with a comment, kept as a normal footnote at the end of the note
// While reading, highlights live only in the page (and sessionStorage) until the reader saves or discards them.
// A highlight is anchored like a W3C Web Annotation TextQuoteSelector: the exact text plus a little context before
// and after, which picks the right occurrence when the same words appear more than once.

import { tk } from "./i18n";

export type HlColor = "yellow" | "green" | "blue" | "pink" | "purple";
export const HL_COLORS: { c: HlColor; label: string }[] = [
  { c: "yellow", label: tk("Yellow") }, { c: "green", label: tk("Green") }, { c: "blue", label: tk("Blue") }, { c: "pink", label: tk("Pink") }, { c: "purple", label: tk("Purple") },
];
export interface Highlight { id: string; exact: string; prefix: string; suffix: string; color: HlColor; comment: string; at: number }

// ------------------------------------------------------------------ DOM: wrap / unwrap a selection
const MARK_CLS = "hl-live";
/** Wrap every text segment of `range` in <mark class="hl-live hl-<color>" data-hl=id>. */
export function wrapRange(range: Range, h: Pick<Highlight, "id" | "color">) {
  const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentNode! : range.commonAncestorContainer;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (range.intersectsNode(n) && n.textContent!.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  for (const t of nodes) {
    let node = t;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (start >= end) continue;
    if (end < node.length) node.splitText(end);
    if (start > 0) node = node.splitText(start);
    const m = document.createElement("mark");
    m.className = `${MARK_CLS} hl-${h.color}`;
    m.dataset.hl = h.id;
    node.parentNode!.insertBefore(m, node);
    m.appendChild(node);
  }
}
export function unwrap(root: HTMLElement, id: string) {
  root.querySelectorAll<HTMLElement>(`mark.${MARK_CLS}[data-hl="${CSS.escape(id)}"]`).forEach((m) => { m.replaceWith(...m.childNodes); });
  root.normalize();
}
/** Re-apply stored highlights to freshly rendered text (after a re-render or a reload). */
export function reapply(root: HTMLElement, list: Highlight[]) {
  for (const h of list) {
    if (root.querySelector(`mark[data-hl="${CSS.escape(h.id)}"]`)) continue;
    const r = findInDom(root, h);
    if (r) wrapRange(r, h);
  }
}
/** Text quote → DOM Range in `root` (exact match, the occurrence whose context fits best). */
function findInDom(root: HTMLElement, h: Highlight): Range | null {
  const texts: { node: Text; start: number }[] = [];
  let full = "";
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { texts.push({ node: n as Text, start: full.length }); full += n.textContent; }
  let best = -1, bestScore = -1;
  for (let i = full.indexOf(h.exact); i >= 0; i = full.indexOf(h.exact, i + 1)) {
    const score = (full.slice(Math.max(0, i - h.prefix.length), i).endsWith(h.prefix) ? 2 : 0) + (full.slice(i + h.exact.length).startsWith(h.suffix) ? 1 : 0);
    if (score > bestScore) { best = i; bestScore = score; }
  }
  if (best < 0) return null;
  const at = (pos: number) => { const t = texts.findLast((x) => x.start <= pos)!; return { node: t.node, off: pos - t.start }; };
  const s = at(best), e = at(best + h.exact.length);
  const r = document.createRange();
  r.setStart(s.node, s.off);
  r.setEnd(e.node, Math.min(e.off, e.node.length));
  return r;
}
/** Build a highlight (with context) from the current selection inside `root`. */
export function fromSelection(root: HTMLElement, sel: Selection, color: HlColor): { h: Highlight; range: Range } | null {
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const exact = range.toString();
  if (!exact.trim()) return null;
  const before = document.createRange(); before.setStart(root, 0); before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange(); after.setStart(range.endContainer, range.endOffset); after.setEnd(root, root.childNodes.length);
  return { h: { id: `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, exact, prefix: before.toString().slice(-32), suffix: after.toString().slice(0, 32), color, comment: "", at: Date.now() }, range };
}

// ------------------------------------------------------------------ Markdown: write highlights into the source
const esc = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Ranges of the body that must not be touched (front-matter, fenced code). */
function frozen(body: string): [number, number][] {
  const out: [number, number][] = [];
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(body);
  if (fm) out.push([0, fm[0].length]);
  for (const m of body.matchAll(/^(\s*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1\2[^\n]*$/gm)) out.push([m.index!, m.index! + m[0].length]);
  return out;
}
/**
 * Source span of a rendered text quote: the exact text where Markdown marks (* _ ` ~ = and link brackets) and
 * line breaks may sit between characters. Best context match wins; frozen ranges are skipped.
 */
export function locateInSource(body: string, h: Pick<Highlight, "exact" | "prefix" | "suffix">): [number, number] | null {
  const chars = [...h.exact.replace(/\s+/g, " ").trim()];
  if (!chars.length) return null;
  // Between rendered characters the source may hold emphasis marks, a link target `](url)` or a wiki-link `[[target|`.
  const gap = "(?:[*_`~=\\[\\]]|\\]\\([^)\\s]*\\)|\\[\\[[^\\]|\\n]*\\|)*";
  const pat = chars.map((c) => (c === " " ? "\\s+" : esc(c))).join(gap);
  const re = new RegExp(pat, "g");
  const ice = frozen(body);
  const plain = (s: string) => s.replace(/[*_`~=[\]]/g, "").replace(/\s+/g, " ");
  const pre = plain(h.prefix).trim().slice(-16), suf = plain(h.suffix).trim().slice(0, 16);
  let best: [number, number] | null = null, bestScore = -1;
  for (const m of body.matchAll(re)) {
    const [s, e] = balance(body, m.index!, m.index! + m[0].length);
    if (ice.some(([a, b]) => s < b && e > a)) continue;
    const score = (pre && plain(body.slice(Math.max(0, s - 80), s)).trimEnd().endsWith(pre) ? 2 : 0) + (suf && plain(body.slice(e, e + 80)).trimStart().startsWith(suf) ? 1 : 0);
    if (score > bestScore) { best = [s, e]; bestScore = score; }
  }
  return best;
}
/**
 * Grow a source span so inline Markdown nests properly around it: take in marker characters right next to it
 * (`**word**` selected as "word" → whole `**word**`), then, while a marker (** __ ~~ ` * _) occurs an odd number of
 * times inside, extend to its partner (forward first, else backward) within the paragraph. `==…==` then wraps a
 * well-formed run instead of crossing bold/italic/code boundaries.
 */
export function balance(body: string, s: number, e: number): [number, number] {
  const isMk = (c: string) => /[*_~`]/.test(c);
  while (s > 0 && isMk(body[s - 1])) s--;
  while (e < body.length && isMk(body[e])) e++;
  // Links: never split `[text](url)` / `[[target|alias]]`; widen to the whole link when the span cuts one.
  for (let guard = 0; guard < 4; guard++) {
    const inside = body.slice(s, e);
    const opens = (inside.match(/\[/g) ?? []).length, closes = (inside.match(/\]/g) ?? []).length;
    if (closes > opens) {
      const b = body.lastIndexOf("[", s - 1);
      if (b >= 0) { s = body[b - 1] === "[" ? b - 1 : b; continue; }
    }
    if (opens > closes) {
      const m = /^[^\n]*?\](?:\([^)\s]*\)|\])/.exec(body.slice(e));
      if (m) { e += m[0].length; continue; }
    }
    const tail = /^\]\([^)\s]*\)|^\]\]/.exec(body.slice(e));
    if (tail && inside.includes("[")) { e += tail[0].length; continue; }
    break;
  }
  const paraStart = body.lastIndexOf("\n\n", s) + 1, paraEnd = (() => { const i = body.indexOf("\n\n", e); return i < 0 ? body.length : i; })();
  for (const mk of ["**", "__", "~~", "`", "*", "_"]) {
    for (let guard = 0; guard < 6; guard++) {
      const inside = body.slice(s, e);
      const count = mk.length === 1 ? (inside.replace(/\*\*|__/g, "").split(mk).length - 1) : inside.split(mk).length - 1;
      if (count % 2 === 0) break;
      const fwd = body.indexOf(mk, e);
      if (fwd >= 0 && fwd < paraEnd) { e = fwd + mk.length; continue; }
      const back = body.lastIndexOf(mk, s - 1);
      if (back >= paraStart) { s = back; continue; }
      break;
    }
  }
  return [s, e];
}

/** Insert all highlights (and their comments as footnotes) into the Markdown body. Returns the new body and misses. */
export function applyToMarkdown(body: string, list: Highlight[]): { body: string; saved: number; missed: Highlight[] } {
  const spans: { s: number; e: number; h: Highlight }[] = [];
  const missed: Highlight[] = [];
  for (const h of list) {
    const r = locateInSource(body, h);
    if (!r || spans.some((x) => r[0] < x.e && r[1] > x.s)) { missed.push(h); continue; }
    spans.push({ s: r[0], e: r[1], h });
  }
  let n = Math.max(0, ...[...body.matchAll(/\[\^hl-(\d+)\]/g)].map((m) => Number(m[1])));
  const notes: string[] = [];
  const refs = new Map<string, string>();
  for (const x of [...spans].sort((a, b) => a.s - b.s)) if (x.h.comment.trim()) { n++; refs.set(x.h.id, `hl-${n}`); notes.push(`[^hl-${n}]: ${x.h.comment.trim().replace(/\n+/g, " ")}`); }
  let out = body;
  for (const x of [...spans].sort((a, b) => b.s - a.s)) {
    const attr = x.h.color === "yellow" ? "" : `{.hl-${x.h.color}}`;
    const ref = refs.has(x.h.id) ? `[^${refs.get(x.h.id)}]` : "";
    // A highlight across paragraphs becomes one ==…== per paragraph (inline marks cannot span blocks).
    const seg = out.slice(x.s, x.e).split(/(\n\s*\n)/);
    const wrapped = seg.map((p, i) => (i % 2 || !p.trim() ? p : `==${p}==${attr}`)).join("");
    out = out.slice(0, x.s) + wrapped + ref + out.slice(x.e);
  }
  if (notes.length) out = out.replace(/\s*$/, "") + "\n\n" + notes.join("\n") + "\n";
  return { body: out, saved: spans.length, missed };
}

/** Markdown list of highlights (for copying or a separate highlights note). */
export function highlightsMarkdown(list: Highlight[], noteTitle: string) {
  return list.map((h) => `> ${h.exact.replace(/\s+/g, " ").trim()}\n> — [[${noteTitle}]]${h.color === "yellow" ? "" : ` · ${h.color}`}${h.comment ? `\n\n${h.comment.trim()}` : ""}`).join("\n\n");
}

// ------------------------------------------------------------------ session store (survives a reload while reading)
const key = (noteId: string) => `lumen.hl.${noteId}`;
export const loadSession = (noteId: string): Highlight[] => { try { return JSON.parse(sessionStorage.getItem(key(noteId)) ?? "[]"); } catch { return []; } };
export const saveSession = (noteId: string, list: Highlight[]) => { try { list.length ? sessionStorage.setItem(key(noteId), JSON.stringify(list)) : sessionStorage.removeItem(key(noteId)); } catch { /* ignore */ } };
