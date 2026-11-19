// Slide decks in plain Markdown: splitting, per-slide directives, layouts with named regions, and doc → deck.
//
// A deck is Markdown with `---` between slides. A slide can start with an HTML comment of directives
// (invisible in other Markdown viewers):   <!-- layout: two-cols; class: invert; split: 60% -->
//   layout   title | section | default | center | two-cols | image-left | image-right | cards | stat | quote | full | blank
//   class    extra CSS classes (invert, accent, left …)        split   width of the left column / side image
//   image    side image URL for image-left/right               bg      background image URL
// Plain keys (class, align, paginate) carry to the following slides; layout/image/split/bg apply to one slide;
// a `_key` (Marp style) applies to one slide only. Front-matter keys give deck-wide defaults.
// Regions: `::left::` `::right::` (two-cols), `::1::` … `::6::` (cards); content before the first marker is the
// header (or the left column). Marp's `![bg](url)` / `![bg left:40%](url)` work too.
// Free placement: `::: box x=10 y=20 w=40 h=30` … `:::` (percent of the slide; see lib/markdown.ts).
import { splitFrontMatter } from "./parse";

export const LAYOUTS = ["title", "section", "default", "center", "two-cols", "image-left", "image-right", "cards", "stat", "quote", "full", "blank"] as const;
export type LayoutName = (typeof LAYOUTS)[number];
const LAYOUT_ALIAS: Record<string, LayoutName> = { cover: "title", intro: "title", statement: "center", fact: "stat", "big-number": "stat", "two-cols-header": "two-cols", comparison: "two-cols", grid: "cards", image: "full", none: "blank", end: "center" };
const ONE_SLIDE = new Set(["layout", "image", "split", "bg"]);
export type Dirs = Record<string, string>;

export interface Chunk { md: string; start: number }
const FENCE = /^\s*(`{3,}|~{3,})/;

/** Slides with the line where each starts in the note body (so edits can be written back). */
export function slideChunks(body: string): Chunk[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const fm = /^---\n[\s\S]*?\n---\n?/.exec(lines.join("\n"));
  let i = fm ? (fm[0].match(/\n/g) ?? []).length + (fm[0].endsWith("\n") ? 0 : 1) : 0;
  const out: Chunk[] = [];
  let start = i, fence = "";
  const push = (end: number) => { const md = lines.slice(start, end).join("\n"); if (md.trim()) out.push({ md, start }); };
  for (; i < lines.length; i++) {
    const f = FENCE.exec(lines[i]);
    if (fence) { if (f && lines[i].trim().startsWith(fence)) fence = ""; continue; }
    if (f) { fence = f[1]; continue; }
    if (/^---\s*$/.test(lines[i])) { push(i); start = i + 1; }
  }
  push(lines.length);
  return out;
}

/** `key: value; key2: value2` from leading `<!-- … -->` lines (blanked, so line numbers stay put). */
export function readDirectives(md: string): { dirs: Dirs; md: string } {
  const lines = md.split("\n");
  const dirs: Dirs = {};
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    const m = /^<!--([\s\S]*?)-->$/.exec(l);
    if (!m || !m[1].includes(":")) break;
    for (const part of m[1].split(/[;\n]/)) {
      const kv = /^\s*(_?[\w-]+)\s*:\s*(.*?)\s*$/.exec(part);
      if (kv) dirs[kv[1].toLowerCase()] = kv[2];
    }
    lines[i] = "";
  }
  return { dirs, md: lines.join("\n") };
}

/** Speaker notes: everything after a `Note:` line (outside code). */
export function splitNotes(md: string) {
  const lines = md.split("\n");
  let fence = false;
  for (let k = 0; k < lines.length; k++) {
    if (FENCE.test(lines[k])) fence = !fence;
    if (!fence && /^Notes?:/i.test(lines[k])) return { body: lines.slice(0, k).join("\n"), notes: [lines[k].replace(/^Notes?:\s*/i, ""), ...lines.slice(k + 1)].join("\n").trim(), noteLine: k };
  }
  return { body: md, notes: "", noteLine: -1 };
}

export interface DeckSlide { md: string; start: number; end: number; notes: string; dirs: Dirs }
/** The slides of a note with the directives in effect on each (front-matter defaults, carried keys, one-slide keys). */
export function deckSlides(body: string): DeckSlide[] {
  const fm = splitFrontMatter(body).data;
  let carry: Dirs = {};
  for (const k of ["class", "align", "paginate", "theme"]) if (fm[k]) carry[k] = fm[k];
  const lines = body.replace(/\r\n/g, "\n").split("\n").length;
  const chunks = slideChunks(body);
  return chunks.map((c, i) => {
    const { dirs } = readDirectives(c.md);
    const local: Dirs = {};
    for (const [k, v] of Object.entries(dirs)) {
      if (k.startsWith("_")) local[k.slice(1)] = v;
      else if (ONE_SLIDE.has(k)) local[k] = v;
      else carry = { ...carry, [k]: v };
    }
    if (!local.layout && fm.layout && i > 0) local.layout = fm.layout;
    const { body: b, notes } = splitNotes(c.md);
    // Prefix blank lines so every rendered data-line is the line in the note body.
    return { md: "\n".repeat(c.start) + b, start: c.start, end: chunks[i + 1] ? chunks[i + 1].start - 1 : lines, notes, dirs: { ...carry, ...local } };
  });
}

/** A slide as plain Markdown for simple viewers (shared page): no directive comments, no region markers. */
export function flatSlide(md: string): string {
  return readDirectives(md).md.split("\n").filter((l) => !/^::[\w-]+::\s*$/.test(l)).join("\n").replace(/^\s*!\[bg\b[^\]]*\]/gim, "![");
}

// ------------------------------------------------------------------ one slide → layout plan
export interface Region { name: string; md: string }
export interface SlidePlan { layout: LayoutName | ""; cls: string; bg: string; side: string; sidePos: "left" | "right"; split: string; header: string; regions: Region[]; cols: number }
const pre = (lines: string[], from: number, to = lines.length) => "\n".repeat(from) + lines.slice(from, to).join("\n");
const isBlank = (s: string) => !s.trim();
const IMG_LINE = /^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/;

export function planSlide(src: string, given: Dirs = {}): SlidePlan {
  const { dirs: own, md } = readDirectives(src);
  const dirs: Dirs = { ...given };
  for (const [k, v] of Object.entries(own)) dirs[k.replace(/^_/, "")] = v;
  const lines = md.split("\n");
  const lname = (dirs.layout ?? "").toLowerCase();
  let layout = (LAYOUT_ALIAS[lname] ?? ((LAYOUTS as readonly string[]).includes(lname) ? lname : "")) as LayoutName | "";
  let bg = dirs.bg ? `![](${dirs.bg})` : "", side = "", sidePos: "left" | "right" = layout === "image-left" ? "left" : "right", split = dirs.split ?? "";
  // Marp backgrounds: ![bg](url), ![bg left:40%](url), ![bg right](url)
  let fence = false;
  lines.forEach((l, i) => {
    if (FENCE.test(l)) fence = !fence;
    const m = !fence && /^\s*!\[bg\b([^\]]*)\]\(([^)\s]+)\)\s*$/i.exec(l);
    if (!m) return;
    const opt = m[1];
    const pos = /\b(left|right)\b/i.exec(opt)?.[1]?.toLowerCase() as "left" | "right" | undefined;
    if (pos) { side = "\n".repeat(i) + `![](${m[2]})`; sidePos = pos; split = /(\d+%)/.exec(opt)?.[1] ?? split; if (!layout) layout = `image-${pos}`; }
    else bg = `![](${m[2]})`;
    lines[i] = "";
  });
  if ((layout === "image-left" || layout === "image-right") && !side) {
    if (dirs.image) side = `![](${dirs.image})`;
    else {
      const i = lines.findIndex((l) => IMG_LINE.test(l));
      if (i >= 0) { side = pre(lines, i, i + 1); lines[i] = ""; }
    }
  }
  // Regions
  const regions: Region[] = [];
  let start = 0, name = "default";
  fence = false;
  for (let i = 0; i <= lines.length; i++) {
    if (i < lines.length && FENCE.test(lines[i])) fence = !fence;
    const m = i < lines.length && !fence ? /^::([\w-]+)::\s*$/.exec(lines[i]) : null;
    if (m || i === lines.length) {
      if (lines.slice(start, i).some((l) => !isBlank(l)) || name !== "default") regions.push({ name, md: pre(lines, start, i) });
      if (m) { name = m[1].toLowerCase(); start = i + 1; lines[i] = ""; }
    }
  }
  const def = regions.find((r) => r.name === "default");
  let header = "";
  const HEADERED = ["two-cols", "cards", "image-left", "image-right", "full", "default", "stat"];
  if (def && HEADERED.includes(layout)) {
    const ls = def.md.split("\n");
    const h = ls.findIndex((l) => !isBlank(l));
    if (h >= 0 && /^#{1,6}\s/.test(ls[h])) { header = pre(ls, h, h + 1); ls[h] = ""; def.md = ls.join("\n"); }
  }
  let out = regions;
  let cols = 0;
  if (layout === "two-cols") {
    const left = regions.find((r) => r.name === "left"), right = regions.find((r) => r.name === "right");
    if (left && def && def.md.trim()) header = header ? header + "\n" + def.md.replace(/^\n+/, "\n") : def.md;
    out = [left ?? (def ? { ...def, name: "left" } : { name: "left", md: "" }), right ?? { name: "right", md: "" }];
  } else if (layout === "cards") {
    const numbered = regions.filter((r) => /^\d+$/.test(r.name));
    out = numbered.length ? numbered : def ? autoCards(def.md) : [];
    cols = out.length <= 3 ? out.length : out.length === 4 ? 2 : 3;
  }
  return { layout, cls: [dirs.class, dirs.align === "left" ? "align-left" : ""].filter(Boolean).join(" "), bg, side, sidePos, split, header, regions: out.filter((r) => r.md.trim() || layout === "two-cols"), cols };
}

/** Cards from one region: one per `###` sub-heading, else one per top-level list item (max 6). */
function autoCards(md: string): Region[] {
  const lines = md.split("\n");
  const heads = lines.map((l, i) => (/^#{2,4}\s/.test(l) ? i : -1)).filter((i) => i >= 0);
  const items = heads.length >= 2 ? heads : lines.map((l, i) => (/^[-*+]\s|^\d+[.)]\s/.test(l) ? i : -1)).filter((i) => i >= 0);
  if (items.length < 2) return [{ name: "1", md }];
  return items.slice(0, 6).map((s, k) => {
    const e = items[k + 1] ?? lines.length;
    const part = lines.slice(s, e);
    if (heads.length < 2) part[0] = part[0].replace(/^[-*+]\s+|^\d+[.)]\s+/, ""); // list item → card text
    return { name: String(k + 1), md: "\n".repeat(s) + part.join("\n") };
  });
}

// ------------------------------------------------------------------ doc → deck
type Block = { kind: "heading" | "para" | "list" | "table" | "code" | "quote" | "image" | "html"; lines: string[]; level?: number; text?: string };
function blocks(src: string[]): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < src.length;) {
    const l = src[i];
    if (isBlank(l)) { i++; continue; }
    const f = FENCE.exec(l);
    if (f) { const s = i++; while (i < src.length && !src[i].trim().startsWith(f[1])) i++; out.push({ kind: "code", lines: src.slice(s, ++i) }); continue; }
    if (/^:{3,}\s*\S/.test(l)) { const s = i++; let d = 1; while (i < src.length && d) { if (/^:{3,}\s*$/.test(src[i])) d--; else if (/^:{3,}\s*\S/.test(src[i])) d++; i++; } out.push({ kind: "html", lines: src.slice(s, i) }); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) { out.push({ kind: "heading", lines: [l], level: h[1].length, text: h[2].trim() }); i++; continue; }
    const kind: Block["kind"] = /^\s*\|/.test(l) ? "table" : /^\s*>/.test(l) ? "quote" : /^\s*([-*+]|\d+[.)])\s/.test(l) ? "list" : IMG_LINE.test(l) ? "image" : "para";
    const s = i++;
    if (kind === "image") { out.push({ kind, lines: [l] }); continue; }
    while (i < src.length && !isBlank(src[i]) && !FENCE.test(src[i]) && !/^#{1,6}\s/.test(src[i])) {
      if (kind === "para" && /^\s*([-*+]|\d+[.)])\s|^\s*\||^\s*>/.test(src[i])) break;
      i++;
    }
    // a list continues over blank lines when the next line is still a list item or indented
    if (kind === "list") while (i + 1 < src.length && isBlank(src[i]) && /^(\s+\S|\s*([-*+]|\d+[.)])\s)/.test(src[i + 1])) { i++; while (i < src.length && !isBlank(src[i])) i++; }
    out.push({ kind, lines: src.slice(s, i) });
  }
  return out;
}
const words = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;
const listItems = (b: Block) => { const items: string[][] = []; for (const l of b.lines) { if (/^([-*+]|\d+[.)])\s/.test(l)) items.push([l]); else if (items.length) items[items.length - 1].push(l); } return items; };
const firstSentence = (p: string) => (/^(.{20,220}?[.!?])(\s|$)/.exec(p)?.[1] ?? p.slice(0, 200)).trim();

/** Turn a document into a deck (plain slide Markdown using the layouts above), Pandoc/Quarto-style:
 *  title slide from the H1; headings above the slide level become section slides; each slide picks a layout from
 *  its content; long prose moves to speaker notes; long lists and tables continue on "(cont.)" slides. */
export function docToDeck(body: string, title: string): string {
  const { data, body: b } = splitFrontMatter(body);
  const all = blocks(b.replace(/\r\n/g, "\n").split("\n")).filter((x) => !(x.kind === "para" && /^\[{1,2}toc\]{1,2}$/i.test(x.lines.join("").trim())));
  const h1 = all.findIndex((x) => x.kind === "heading" && x.level === 1);
  const deckTitle = h1 >= 0 ? all[h1].text! : title;
  if (h1 >= 0) all.splice(h1, 1);
  // Slide level: the highest heading level directly followed by content (Pandoc's rule).
  let level = 7;
  all.forEach((x, i) => { if (x.kind === "heading" && all[i + 1] && all[i + 1].kind !== "heading") level = Math.min(level, x.level!); });
  if (level === 7) level = Math.min(7, ...all.filter((x) => x.kind === "heading").map((x) => x.level!));
  const slides: string[] = [];
  // Cover: H1 + the first short paragraph before any heading.
  const firstHead = all.findIndex((x) => x.kind === "heading");
  const intro = all.slice(0, firstHead < 0 ? all.length : firstHead);
  const sub = intro.find((x) => x.kind === "para" && words(x.lines.join(" ")) <= 40);
  const kicker = data.subtitle ?? (sub ? sub.lines.join(" ") : "");
  slides.push(`<!-- layout: title -->\n# ${deckTitle}${kicker ? `\n\n${kicker}` : ""}`);
  // A doc's metadata table (| Field | Value | or | | |: Status, Version, Author …) is not slide material.
  const isMeta = (x: Block) => x.kind === "table" && /^\|\s*(\*\*)?(field|key|property)?(\*\*)?\s*\|\s*(\*\*)?(value)?(\*\*)?\s*\|\s*$/i.test(x.lines[0]) && x.lines.slice(2).some((l) => /\|\s*\**(status|version|author|date)\**\s*\|/i.test(l));
  const rest = intro.filter((x) => x !== sub && !isMeta(x));
  if (rest.length) slides.push(...contentSlides("Overview", rest));
  // Sections
  let i = firstHead < 0 ? all.length : firstHead;
  while (i < all.length) {
    const h = all[i];
    let j = i + 1;
    while (j < all.length && !(all[j].kind === "heading" && all[j].level! <= Math.max(h.level!, level))) j++;
    const content = all.slice(i + 1, j);
    if (h.level! < level) {
      // section divider; its own short intro becomes the subtitle
      const own: Block[] = [];
      let k = i + 1;
      while (k < j && all[k].kind !== "heading") own.push(all[k++]);
      const lead = own.find((x) => x.kind === "para");
      const short = lead && words(lead.lines.join(" ")) <= 30;
      slides.push(`<!-- layout: section -->\n## ${h.text}${short ? `\n\n${lead!.lines.join(" ")}` : ""}${own.length && !(short && own.length === 1) ? `\n\nNote: ${own.map((x) => x.lines.join("\n")).join("\n\n")}` : ""}`);
      i = k;
      continue;
    }
    slides.push(...contentSlides(h.text!, content));
    i = j;
  }
  return slides.join("\n\n---\n\n") + "\n";
}

let flip = false;
function contentSlides(title: string, content: Block[]): string[] {
  const head = `## ${title}`;
  const sub = content.filter((x) => x.kind === "heading");
  const notes: string[] = [];
  const out = (layout: string, bodyMd: string) => `<!-- layout: ${layout} -->\n${head}\n\n${bodyMd.trim()}${notes.length ? `\n\nNote: ${notes.join("\n\n")}` : ""}`;
  const groups = () => {
    const g: { h: string; b: Block[] }[] = [];
    for (const x of content) { if (x.kind === "heading") g.push({ h: x.text!, b: [] }); else if (g.length) g[g.length - 1].b.push(x); }
    return g;
  };
  const md = (bs: Block[]) => bs.map((x) => x.lines.join("\n")).join("\n\n");
  // 2 sub-sections → two columns; 3–6 → cards
  if (sub.length >= 2 && sub.length <= 6 && content[0]?.kind === "heading") {
    const g = groups();
    const card = (x: { h: string; b: Block[] }) => { const keep = x.b.slice(0, 2); if (x.b.length > 2) notes.push(`${x.h}: ${md(x.b.slice(2))}`); return `### ${x.h}\n\n${trimProse(keep, notes)}`; };
    if (g.length === 2) return [out("two-cols", `::left::\n${card(g[0])}\n\n::right::\n${card(g[1])}`)];
    return [out("cards", g.map((x, k) => `::${k + 1}::\n${card(x)}`).join("\n\n"))];
  }
  const flat = content.filter((x) => x.kind !== "heading");
  const only = flat.length === 1 ? flat[0] : null;
  if (!flat.length) return [`<!-- layout: center -->\n${head}`];
  if (only?.kind === "quote" && !/\[!\w+\]/.test(only.lines[0])) return [`<!-- layout: quote -->\n${only.lines.join("\n")}\n\n— ${title}`];
  if (only?.kind === "image") return [out("full", only.lines[0])];
  if (only?.kind === "code" && /mermaid/.test(only.lines[0])) return [out("full", md(flat))];
  // Stat: 1–3 short lines that each lead with a number
  if (flat.length <= 3 && flat.every((x) => x.kind === "para" && words(x.lines.join(" ")) <= 14 && /^\s*(\*\*)?[$€£]?\d/.test(x.lines[0]))) return [out("stat", md(flat))];
  if (only?.kind === "para" && words(only.lines.join(" ")) <= 18) return [`<!-- layout: center -->\n${head}\n\n${only.lines.join(" ")}`];
  // Image + text → image left/right (alternating)
  const img = flat.find((x) => x.kind === "image");
  if (img && flat.length > 1) { flip = !flip; const text = flat.filter((x) => x !== img); return [out(flip ? "image-right" : "image-left", `${img.lines[0]}\n\n${trimProse(text, notes)}`)]; }
  // A list of 3–6 items that each lead with **bold** → cards
  if (only?.kind === "list") {
    const items = listItems(only);
    if (items.length >= 3 && items.length <= 6 && items.every((it) => /^([-*+]|\d+[.)])\s+\*\*/.test(it[0]))) return [out("cards", items.map((it) => it.join("\n").replace(/^([-*+]|\d+[.)])\s+/, "- ")).join("\n"))];
    // Long lists continue on "(cont.)" slides: at most 6 items or ~75 words per slide, never splitting an item.
    if (items.length > 6 || words(only.lines.join(" ")) > 90) {
      const pages: string[][][] = [[]];
      let w = 0;
      for (const it of items) {
        const iw = words(it.join(" "));
        if (pages[pages.length - 1].length && (pages[pages.length - 1].length >= 6 || w + iw > 75)) { pages.push([]); w = 0; }
        pages[pages.length - 1].push(it); w += iw;
      }
      if (pages.length > 1) return pages.map((pg, k) => `${head}${k ? " (cont.)" : ""}\n\n${pg.map((it) => it.join("\n")).join("\n")}`);
    }
  }
  // Tables: up to 6 body rows per slide, header repeated
  const tbl = flat.find((x) => x.kind === "table");
  if (tbl && flat.length <= 2) {
    const [hd, sep, ...rows] = tbl.lines;
    const other = flat.filter((x) => x !== tbl);
    if (other.length) notes.push(md(other));
    if (rows.length <= 7) return [out("full", tbl.lines.join("\n"))];
    const res: string[] = [];
    for (let k = 0; k < rows.length; k += 6) res.push(`<!-- layout: full -->\n${head}${k ? " (cont.)" : ""}\n\n${[hd, sep, ...rows.slice(k, k + 6)].join("\n")}${!k && notes.length ? `\n\nNote: ${notes.join("\n\n")}` : ""}`);
    return res;
  }
  if (only && (only.kind === "code" || only.kind === "table")) return [out("full", md(flat))];
  return [`${head}\n\n${trimProse(flat, notes)}${notes.length ? `\n\nNote: ${notes.join("\n\n")}` : ""}`];
}
/** Keep slides short: a paragraph over ~40 words keeps its first sentence; the full text goes to the notes. */
function trimProse(bs: Block[], notes: string[]): string {
  return bs.map((x) => {
    const t = x.lines.join("\n");
    if (x.kind === "para" && words(t) > 40) { notes.push(t); return firstSentence(x.lines.join(" ")); }
    return t;
  }).join("\n\n");
}
