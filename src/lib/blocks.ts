// Block model for the Markdown editor (Notion-style block handles, Obsidian block references).
// A "block" is a top-level Markdown unit: paragraph, heading, list item (with its children), quote / callout,
// code fence, $$ math, ::: container, table or divider. Pure functions over lines, no DOM / CodeMirror here.
//   Block ids follow Obsidian: `text ^id` at the end of a paragraph / heading / list item / quote, or `^id` on its
//   own line after a block (tables, code, containers). Links: [[Note#^id]], embeds: ![[Note#^id]].

export type BlockKind = "paragraph" | "heading" | "list" | "quote" | "callout" | "code" | "math" | "container" | "table" | "hr";
export type ListKind = "bullet" | "ordered" | "task";
export interface Block {
  /** First / last line (0-based, inclusive). A trailing standalone `^id` line belongs to the block before it. */
  a: number;
  b: number;
  kind: BlockKind;
  list?: ListKind;
  level?: number;
  id?: string;
}

const ID_INLINE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;
const ID_LINE = /^\s*\^([A-Za-z0-9-]+)\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:\s|$)/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>/;
const TABLE = /^\s*\|/;
const ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const OPEN = /^:::+\s*\S/;
const CLOSE = /^:::+\s*$/;
const MATH = /^\s*\$\$/;

function startsBlock(l: string) {
  return FENCE.test(l) || HEADING.test(l) || QUOTE.test(l) || TABLE.test(l) || ITEM.test(l) || OPEN.test(l) || MATH.test(l) || HR.test(l);
}
const listKind = (l: string): ListKind => (/^\s*[-*+]\s+\[[ xX/]\]/.test(l) ? "task" : /^\s*\d/.test(l) ? "ordered" : "bullet");

/** Line index after the front-matter (0 when there is none). */
export function frontMatterEnd(lines: string[]) {
  if (lines[0] !== "---") return 0;
  for (let i = 1; i < Math.min(lines.length, 80); i++) if (lines[i] === "---") return i + 1;
  return 0;
}

export function parseBlocks(text: string | string[]): Block[] {
  const lines = typeof text === "string" ? text.split("\n") : text;
  const n = lines.length;
  const out: Block[] = [];
  let i = frontMatterEnd(lines);
  while (i < n) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const idl = ID_LINE.exec(l);
    if (idl && out.length) { const p = out[out.length - 1]; p.b = i; p.id = idl[1]; i++; continue; }
    const a = i;
    let kind: BlockKind = "paragraph";
    let extra: Partial<Block> = {};
    let fm: RegExpExecArray | null;
    if ((fm = FENCE.exec(l))) {
      kind = "code";
      const ch = fm[1][0], len = fm[1].length;
      let j = i + 1;
      while (j < n && !new RegExp(`^ {0,3}\\${ch}{${len},}\\s*$`).test(lines[j])) j++;
      i = Math.min(j, n - 1);
    } else if (MATH.test(l) && !/^\s*\$\$.*\S.*\$\$\s*$/.test(l) && !/^\s*\$\$.+\$\$\s*$/.test(l)) {
      kind = "math";
      let j = i + 1;
      while (j < n && !lines[j].includes("$$")) j++;
      i = Math.min(j, n - 1);
    } else if (OPEN.test(l)) {
      kind = "container";
      let depth = 1, j = i + 1;
      for (; j < n; j++) { if (OPEN.test(lines[j])) depth++; else if (CLOSE.test(lines[j]) && --depth === 0) break; }
      i = Math.min(j, n - 1);
    } else if ((fm = HEADING.exec(l))) {
      kind = "heading";
      extra = { level: fm[1].length };
    } else if (HR.test(l)) {
      kind = "hr";
    } else if (TABLE.test(l)) {
      kind = "table";
      while (i + 1 < n && TABLE.test(lines[i + 1])) i++;
    } else if (QUOTE.test(l)) {
      kind = /^ {0,3}>\s*\[![\w-]+\]/.test(l) ? "callout" : "quote";
      while (i + 1 < n && QUOTE.test(lines[i + 1])) i++;
    } else if (ITEM.test(l)) {
      kind = "list";
      extra = { list: listKind(l) };
      let j = i + 1;
      for (; j < n; j++) {
        const x = lines[j];
        if (/^\s+\S/.test(x) && !ITEM.test(x)) continue; // indented child / continuation
        if (/^\s{4,}/.test(x) || (/^\s+/.test(x) && ITEM.test(x) && /^\s+/.exec(x)![0].length >= 2)) continue; // nested item
        if (x.trim() && !startsBlock(x) && !ID_LINE.test(x) && lines[j - 1].trim()) continue; // lazy continuation
        if (ID_LINE.test(x) && lines[j - 1].trim()) continue; // `^id` right under the item
        if (!x.trim()) { let k = j; while (k < n && !lines[k].trim()) k++; if (k < n && /^\s{2,}\S/.test(lines[k])) { j = k - 1; continue; } }
        break;
      }
      i = j - 1;
    } else {
      while (i + 1 < n && lines[i + 1].trim() && !startsBlock(lines[i + 1])) i++;
    }
    const b: Block = { a, b: i, kind, ...extra };
    const m = ID_INLINE.exec(lines[i]) ?? (kind === "list" ? ID_INLINE.exec(lines[a]) : null);
    if (m && kind !== "code" && kind !== "math") b.id = m[1];
    out.push(b);
    i++;
  }
  return out;
}

/** Index of the block containing `line` (0-based), or -1. */
export function blockIndexAt(blocks: Block[], line: number) {
  let lo = 0, hi = blocks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].b < line) lo = mid + 1; else if (blocks[mid].a > line) hi = mid - 1; else return mid;
  }
  return -1;
}

const isList = (b?: { kind: BlockKind }) => b?.kind === "list";
interface Item { text: string; kind: BlockKind; orig?: number; fresh?: boolean }
const itemOf = (lines: string[], blocks: Block[], i: number): Item => ({ text: lines.slice(blocks[i].a, blocks[i].b + 1).join("\n"), kind: blocks[i].kind, orig: i });

/** Text between two items: the original gap when they were neighbours, else a blank line (none between list items). */
function gap(lines: string[], blocks: Block[], x: Item, y: Item) {
  if (x.orig != null && y.orig != null && y.orig === x.orig + 1 && !x.fresh && !y.fresh) return "\n" + lines.slice(blocks[x.orig].b + 1, blocks[y.orig].a).map((l) => l + "\n").join("");
  return isList(x) && isList(y) ? "\n" : "\n\n";
}

/** Replaces blocks lo..hi with `items` (re-joined with sensible gaps). Line numbers are 0-based. */
function rebuild(lines: string[], blocks: Block[], lo: number, hi: number, items: Item[], focus: number): LineEdit {
  let s = "", cursor = blocks[lo].a;
  items.forEach((it, k) => {
    if (k) s += gap(lines, blocks, items[k - 1], it);
    if (k === focus) cursor = blocks[lo].a + (s.match(/\n/g)?.length ?? 0);
    s += it.text;
  });
  return { aLine: blocks[lo].a, bLine: blocks[hi].b, insert: s, cursor };
}

/** Line-based result: replace lines aLine..bLine (inclusive) with `insert`. */
export interface LineEdit { aLine: number; bLine: number; insert: string; cursor: number }

/** Move the blocks `moved` so they sit before block `before` (blocks.length = at the end). Null when nothing changes. */
export function moveBlocks(lines: string[], blocks: Block[], moved: number[], before: number): LineEdit | null {
  const set = new Set(moved);
  const m = [...set].sort((x, y) => x - y);
  if (!m.length) return null;
  const lo = Math.min(m[0], before), hi = Math.max(m[m.length - 1], before - 1);
  if (lo > hi || hi >= blocks.length) return null;
  const rest: number[] = [];
  for (let i = lo; i <= hi; i++) if (!set.has(i)) rest.push(i);
  let at = rest.findIndex((i) => i >= before);
  if (at < 0) at = rest.length;
  const order = [...rest.slice(0, at), ...m, ...rest.slice(at)];
  if (order.every((x, k) => x === lo + k)) return null;
  // include the neighbours so the gaps at both ends are recomputed too (a paragraph moved next to a list gets a blank line)
  const L = Math.max(0, lo - 1), H = Math.min(blocks.length - 1, hi + 1);
  const full = [...Array.from({ length: lo - L }, (_, k) => L + k), ...order, ...Array.from({ length: H - hi }, (_, k) => hi + 1 + k)];
  return rebuild(lines, blocks, L, H, full.map((i) => itemOf(lines, blocks, i)), at + (lo - L));
}

/** Delete blocks (and one gap each). */
export function deleteBlocks(lines: string[], blocks: Block[], del: number[]): LineEdit | null {
  const set = new Set(del);
  if (!set.size) return null;
  const m = [...set].sort((x, y) => x - y);
  const lo = Math.max(0, m[0] - 1), hi = Math.min(blocks.length - 1, m[m.length - 1] + 1);
  const keep: number[] = [];
  for (let i = lo; i <= hi; i++) if (!set.has(i)) keep.push(i);
  if (!keep.length) return { aLine: blocks[lo].a, bLine: blocks[hi].b, insert: "", cursor: blocks[lo].a };
  const focus = Math.max(0, keep.findIndex((i) => i > m[0]));
  return rebuild(lines, blocks, lo, hi, keep.map((i) => itemOf(lines, blocks, i)), focus === -1 ? keep.length - 1 : focus);
}

/** Duplicate blocks: each selected run is copied right after the last selected block (ids are dropped from the copy). */
export function duplicateBlocks(lines: string[], blocks: Block[], dup: number[]): LineEdit | null {
  const m = [...new Set(dup)].sort((x, y) => x - y);
  if (!m.length) return null;
  const last = m[m.length - 1];
  const items: Item[] = [];
  for (let i = m[0]; i <= last; i++) items.push(itemOf(lines, blocks, i));
  const copies = m.map((i) => ({ ...itemOf(lines, blocks, i), orig: undefined, text: stripId(itemOf(lines, blocks, i).text).text }));
  return rebuild(lines, blocks, m[0], last, [...items, ...copies], items.length);
}

/** Remove a block id (inline ` ^id` or a trailing `^id` line); returns the text and the id. */
export function stripId(text: string): { text: string; id?: string } {
  const ls = text.split("\n");
  while (ls.length > 1 && !ls[ls.length - 1].trim()) ls.pop();
  const last = ls[ls.length - 1];
  const own = ID_LINE.exec(last);
  if (own) { ls.pop(); while (ls.length > 1 && !ls[ls.length - 1].trim()) ls.pop(); return { text: ls.join("\n"), id: own[1] }; }
  const m = ID_INLINE.exec(last);
  if (m) { ls[ls.length - 1] = last.slice(0, m.index).replace(/\s+$/, ""); return { text: ls.join("\n"), id: m[1] }; }
  const fm = ID_INLINE.exec(ls[0]);
  if (fm && ITEM.test(ls[0])) { ls[0] = ls[0].slice(0, fm.index).replace(/\s+$/, ""); return { text: ls.join("\n"), id: fm[1] }; }
  return { text: ls.join("\n") };
}

export type TurnTarget = "paragraph" | "h1" | "h2" | "h3" | "bullet" | "numbered" | "todo" | "quote" | "code" | "toggle" | `callout:${string}`;

/** Plain content lines of a block (markers, fences and container lines removed). */
function contentLines(text: string, kind: BlockKind): { lines: string[]; title?: string; lang?: string; callout?: string } {
  const ls = text.split("\n");
  switch (kind) {
    case "heading": return { lines: [ls[0].replace(HEADING, "").replace(/\s+#+\s*$/, ""), ...ls.slice(1)] };
    case "list": {
      const mk = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s+\[[ xX/]\])?\s?/.exec(ls[0])!;
      const w = mk[0].length;
      return { lines: [ls[0].slice(w), ...ls.slice(1).map((l) => (l.slice(0, w).trim() ? l : l.slice(Math.min(w, /^\s*/.exec(l)![0].length))))] };
    }
    case "quote": return { lines: ls.map((l) => l.replace(/^ {0,3}> ?/, "")) };
    case "callout": {
      const m = /^ {0,3}>\s*\[!([\w-]+)\][+-]?\s*(.*)$/.exec(ls[0]);
      const body = ls.slice(1).map((l) => l.replace(/^ {0,3}> ?/, ""));
      return { lines: m?.[2] ? [m[2], ...body] : body, title: m?.[2] || undefined, callout: m?.[1] };
    }
    case "code": {
      const lang = ls[0].replace(FENCE, "").trim();
      const end = ls.length > 1 && FENCE.test(ls[ls.length - 1]) ? -1 : undefined;
      return { lines: ls.slice(1, end), lang };
    }
    case "math": return { lines: ls.slice(1, ls.length > 1 && ls[ls.length - 1].includes("$$") ? -1 : undefined) };
    case "container": {
      const t = /^:::+\s*expand\s*(.*)$/.exec(ls[0]);
      const inner = ls.slice(1, ls.length > 1 && CLOSE.test(ls[ls.length - 1]) ? -1 : undefined);
      return { lines: t?.[1] ? [t[1], ...inner] : inner, title: t?.[1] || undefined };
    }
    default: return { lines: ls };
  }
}

/** Convert one block's text into another block type ("Turn into"). The block id survives. */
export function turnInto(text: string, kind: BlockKind, target: TurnTarget): string {
  const { text: bare, id } = stripId(text);
  const c = contentLines(bare, kind);
  let ls = c.lines;
  while (ls.length > 1 && !ls[ls.length - 1].trim()) ls = ls.slice(0, -1);
  while (ls.length > 1 && !ls[0].trim()) ls = ls.slice(1);
  if (!ls.length) ls = [""];
  let out: string;
  let ownLineId = false;
  const indent = (w: number) => ls.slice(1).map((l) => (l.trim() ? " ".repeat(w) + l : ""));
  if (target === "paragraph") out = ls.join("\n");
  else if (target === "h1" || target === "h2" || target === "h3") out = "#".repeat(Number(target[1])) + " " + ls.filter((l) => l.trim()).join(" ");
  else if (target === "bullet") out = ["- " + ls[0], ...indent(2)].join("\n");
  else if (target === "todo") out = ["- [ ] " + ls[0], ...indent(2)].join("\n");
  else if (target === "numbered") out = ["1. " + ls[0], ...indent(3)].join("\n");
  else if (target === "quote") out = ls.map((l) => (l ? "> " + l : ">")).join("\n");
  else if (target.startsWith("callout:")) {
    const type = target.slice(8);
    const body = c.callout && c.title ? ls.slice(1) : ls;
    out = [`> [!${type}]${c.callout && c.title ? " " + c.title : ""}`, ...body.map((l) => (l ? "> " + l : ">"))].join("\n");
  } else if (target === "code") { out = "```" + (c.lang ?? "") + "\n" + ls.join("\n") + "\n```"; ownLineId = true; }
  else { // toggle
    const [title, ...rest] = c.title ? ls : ls.length > 1 ? ls : [ls[0]];
    out = `::: expand ${title.trim() || "Details"}\n${rest.length ? rest.join("\n") : ""}\n:::`;
    ownLineId = true;
  }
  if (id) out += ownLineId ? `\n^${id}` : ` ^${id}`;
  return out;
}

/** Turn several blocks at once (one edit). */
export function turnBlocks(lines: string[], blocks: Block[], idx: number[], target: TurnTarget): LineEdit | null {
  const m = [...new Set(idx)].sort((x, y) => x - y);
  if (!m.length) return null;
  const set = new Set(m);
  const items: Item[] = [];
  for (let i = m[0]; i <= m[m.length - 1]; i++) {
    const it = itemOf(lines, blocks, i);
    if (set.has(i)) {
      const text = turnInto(it.text, blocks[i].kind, target);
      const k: BlockKind = /^(bullet|numbered|todo)$/.test(target) ? "list" : target === "paragraph" ? "paragraph" : target[0] === "h" ? "heading" : "quote";
      items.push({ text, kind: k, orig: i, fresh: true });
    } else items.push(it);
  }
  return rebuild(lines, blocks, m[0], m[m.length - 1], items, 0);
}

export const newBlockId = () => Math.random().toString(36).slice(2, 8);

/** Where to add ` ^id` for a block without one: a line + column insert. */
export function idInsertion(lines: string[], blk: Block, id: string): { line: number; ch: number; text: string } {
  if (blk.kind === "list") return { line: blk.a, ch: lines[blk.a].length, text: ` ^${id}` };
  if (blk.kind === "table") return { line: blk.b, ch: lines[blk.b].length, text: `\n\n^${id}` };
  if (blk.kind === "code" || blk.kind === "math" || blk.kind === "container" || blk.kind === "hr") return { line: blk.b, ch: lines[blk.b].length, text: `\n^${id}` };
  return { line: blk.b, ch: lines[blk.b].replace(/\s+$/, "").length, text: ` ^${id}` };
}

/** Markdown of the block with this id (id removed), or null. Used by ![[Note#^id]]. */
export function blockSource(body: string, id: string): string | null {
  const lines = body.split("\n");
  const blk = parseBlocks(lines).find((b) => b.id === id);
  if (!blk) return null;
  return stripId(lines.slice(blk.a, blk.b + 1).join("\n")).text;
}

/** One-line plain preview of a block (for autocomplete / menus). */
export function blockPreview(text: string, kind: BlockKind, max = 70): string {
  const c = contentLines(stripId(text).text, kind);
  const s = c.lines.filter((l) => l.trim()).join(" ").replace(/[*_`~]|\[\[|\]\]|==|<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s || kind;
}

// ------------------------------------------------------------------ pending "[[Note#^id]]" jump
/** Set when a block link is clicked; the next view (preview hydrate or editor) that shows the block scrolls to it. */
export const pendingBlock: { title: string; id: string; at: number } = { title: "", id: "", at: 0 };
export function setPendingBlock(title: string, id: string) { Object.assign(pendingBlock, { title, id, at: Date.now() }); }
/** Returns the pending id once (if it is fresh), then clears it. */
export function takePendingBlock(title?: string): string | null {
  if (!pendingBlock.id || Date.now() - pendingBlock.at > 8000) return null;
  if (title != null && pendingBlock.title && pendingBlock.title.toLowerCase() !== title.toLowerCase()) return null;
  const id = pendingBlock.id;
  pendingBlock.id = "";
  return id;
}

// ------------------------------------------------------------------ glyphs + current "Turn into" target (R4 block menu / autocomplete)
/** The Lumen glyph for a block (block-ref autocomplete rows, design R4-16G). */
export function blockGlyph(blk: Block, firstLine = ""): string {
  switch (blk.kind) {
    case "heading": { const n = HEADING.exec(firstLine)?.[1].length ?? 2; return n === 1 ? "h1" : n === 2 ? "h2" : "h3"; }
    case "list": return blk.list === "task" ? "task" : blk.list === "ordered" ? "numbered" : "list";
    case "quote": return "quote";
    case "callout": return "c-" + ((/\[!([\w-]+)\]/.exec(firstLine)?.[1] ?? "note").toLowerCase());
    case "code": return "code";
    case "math": return "math-block";
    case "container": return /^:::+\s*(columns|grid)/.test(firstLine) ? "columns-2" : /^:::+\s*tabs/.test(firstLine) ? "tabs" : /^:::+\s*(expand|toggle|details)/.test(firstLine) ? "expand" : "box";
    case "table": return "table";
    case "hr": return "divider";
    default: return "text";
  }
}
/** What the block is now, as a Turn-into target (highlighted in the block menu grid). */
export function turnTargetOf(blk: Block, firstLine = ""): TurnTarget | null {
  switch (blk.kind) {
    case "paragraph": return "paragraph";
    case "heading": { const n = HEADING.exec(firstLine)?.[1].length ?? 2; return n === 1 ? "h1" : n === 2 ? "h2" : "h3"; }
    case "list": return blk.list === "task" ? "todo" : blk.list === "ordered" ? "numbered" : "bullet";
    case "quote": return "quote";
    case "code": return "code";
    case "callout": return `callout:${(/\[!([\w-]+)\]/.exec(firstLine)?.[1] ?? "note").toLowerCase()}`;
    case "container": return /^:::+\s*(expand|toggle|details)/.test(firstLine) ? "toggle" : null;
    default: return null;
  }
}
