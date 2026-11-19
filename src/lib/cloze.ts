// Cloze (fill-in-the-blank) flashcards. Pure: no DOM, no React. Docs: docs/FLASHCARDS.md.
//
//   {{c1::answer}}  {{c1::answer::hint}}   Anki syntax, anywhere in any note.
//   ==answer==                             also a cloze, but ONLY in notes with `type: flashcards` or `cloze: true` in the
//                                          front matter (elsewhere ==text== stays a reading highlight, see lib/highlights.ts).
//                                          Coloured highlights (==text=={.hl-green}) are never clozes.
//
// Scope: a block = one paragraph (consecutive plain lines), or one list item / heading / table row / quote line.
// The same number inside one block = one card (all its gaps open together); different numbers = separate cards.
// Each `==…==` in a block gets its own number after the highest {{cN}} of that block.
// Card key = `cz<n>-<hash of the block text>`: editing other blocks never resets a card's scheduling.

export interface ClozeSpan {
  n: number;
  answer: string;
  hint: string;
  /** Offsets in the block text (or the line, for `findClozes`). */
  from: number;
  to: number;
  kind: "anki" | "mark";
}
export interface ClozeBlock {
  /** Raw block text (lines joined with \n). */
  text: string;
  /** 0-based line of the block's first line in the full note (front matter included). */
  line: number;
  spans: ClozeSpan[];
}
export interface ClozeCardData { key: string; n: number; line: number; block: string; q: string; a: string }

/** FNV-1a, same as parse.ts `hash` (copied to avoid an import cycle). */
export function clozeHash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
/** `==text==` counts as cloze in this note? (front matter `type: flashcards` or `cloze: true`) */
export function clozeEnabled(md: string): boolean {
  const m = FM.exec(md);
  if (!m) return false;
  return /^type:\s*["']?flashcards["']?\s*$/m.test(m[1]) || /^cloze:\s*["']?(true|yes|on)["']?\s*$/im.test(m[1]);
}

/** Index of the `}}` closing a cloze that starts its content at `i` (skips `$…$` math), or -1. */
export function closeAt(s: string, i: number): number {
  let math = false;
  for (let j = i; j < s.length - 1; j++) {
    const c = s[j];
    if (c === "\n" && s[j + 1] === "\n") return -1;
    if (c === "\\") { j++; continue; }
    if (c === "$") math = !math;
    else if (!math && c === "}" && s[j + 1] === "}") return j;
  }
  return -1;
}
/** First `::` outside math in `s`, or -1. */
export function sepAt(s: string): number {
  let math = false;
  for (let j = 0; j < s.length - 1; j++) {
    if (s[j] === "\\") { j++; continue; }
    if (s[j] === "$") math = !math;
    else if (!math && s[j] === ":" && s[j + 1] === ":") return j;
  }
  return -1;
}

const ANKI = /\{\{c(\d+)::/g;
const MARK = /(?<![=\\])==(?=[^\s=])([^\n]*?[^\s\\])==(?!=)/g;

/** All clozes in a piece of text (inline code skipped). `marks` = also count `==text==`. Sorted by position. */
export function findClozes(text: string, marks: boolean): ClozeSpan[] {
  // blank out inline code so `{{c1::x}}` inside backticks is literal
  const t = text.replace(/(`+)[^`\n]*?\1/g, (m) => " ".repeat(m.length));
  const out: ClozeSpan[] = [];
  for (const m of t.matchAll(ANKI)) {
    const start = m.index!;
    if (out.length && start < out[out.length - 1].to) continue;
    const inner0 = start + m[0].length;
    const close = closeAt(t, inner0);
    if (close < 0) continue;
    const inner = text.slice(inner0, close);
    const k = sepAt(inner);
    const answer = (k >= 0 ? inner.slice(0, k) : inner).trim();
    if (!answer) continue;
    out.push({ n: Number(m[1]), answer, hint: k >= 0 ? inner.slice(k + 2).trim() : "", from: start, to: close + 2, kind: "anki" });
  }
  if (marks) {
    const taken = (a: number, b: number) => out.some((s) => s.kind === "anki" && a < s.to && b > s.from);
    let next = Math.max(0, ...out.map((s) => s.n)) + 1;
    for (const m of t.matchAll(MARK)) {
      const from = m.index!, to = from + m[0].length;
      if (taken(from, to) || t.startsWith("{.hl-", to)) continue;
      out.push({ n: next++, answer: text.slice(from + 2, to - 2), hint: "", from, to, kind: "mark" });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

const STANDALONE = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|\||>)/;
/**
 * Blocks with at least one cloze. `skipBodyLines` = body line indices (after front matter) that are already
 * `Q :: A` / `?` cards; they never become cloze blocks.
 */
export function clozeBlocks(md: string, skipBodyLines?: Set<number>): ClozeBlock[] {
  if (!/\{\{c\d+::|==/.test(md)) return [];
  const marks = clozeEnabled(md);
  const fm = FM.exec(md);
  const off = fm ? (fm[0].match(/\n/g) ?? []).length : 0;
  const lines = (fm ? md.slice(fm[0].length) : md).split("\n");
  const out: ClozeBlock[] = [];
  let cur: { start: number; lines: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const text = cur.lines.join("\n");
    const spans = findClozes(text, marks);
    if (spans.length) out.push({ text, line: cur.start + off, spans });
    cur = null;
  };
  let fence: string | null = null, mathBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, "");
    const f = /^\s*(`{3,}|~{3,})/.exec(l);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; continue; }
    if (f) { flush(); fence = f[1]; continue; }
    const tl = l.trim();
    if (mathBlock) { if (tl.endsWith("$$")) mathBlock = false; continue; }
    if (tl.startsWith("$$")) { flush(); if (tl === "$$" || !tl.slice(2).includes("$$")) mathBlock = true; continue; }
    if (!l.trim() || skipBodyLines?.has(i)) { flush(); continue; }
    if (STANDALONE.test(l)) { flush(); cur = { start: i, lines: [l] }; flush(); continue; }
    if (cur) cur.lines.push(l); else cur = { start: i, lines: [l] };
  }
  flush();
  return out;
}

/** Strip a leading list marker / heading hashes / quote marker so the card reads as a sentence. */
const bare = (s: string) => s.replace(/^\s*(?:[-*+]\s+(?:\[[ xX/-]\]\s+)?|\d+[.)]\s+|#{1,6}\s+|>\s?)/gm, "");

/** Rebuild the block: target number → `gap(span)`, other clozes → their answer as plain text. */
function rebuild(b: Pick<ClozeBlock, "text" | "spans">, n: number, gap: (s: ClozeSpan) => string): string {
  let s = "", at = 0;
  for (const sp of b.spans) {
    s += b.text.slice(at, sp.from) + (sp.n === n ? gap(sp) : sp.answer);
    at = sp.to;
  }
  return bare(s + b.text.slice(at));
}
// Review markup, rendered by markdown.ts: {{?::hint}} = the gap, {{!::answer}} = the revealed answer.
/** Front (Markdown): the block with the card's gaps shown as […] or the hint. */
export const clozeFront = (b: Pick<ClozeBlock, "text" | "spans">, n: number) => rebuild(b, n, (s) => `{{?::${s.hint}}}`);
/** Back (Markdown): the block with the card's answers highlighted. */
export const clozeBack = (b: Pick<ClozeBlock, "text" | "spans">, n: number) => rebuild(b, n, (s) => `{{!::${s.answer}}}`);

/** Review sides for a card's block text (`marks` = the note counts ==text== as cloze, see clozeEnabled). */
export function clozeSides(block: string, n: number, marks: boolean) {
  const b = { text: block, spans: findClozes(block, marks) };
  return { front: clozeFront(b, n), back: clozeBack(b, n) };
}

/** One card per distinct cloze number per block, in reading order. `q` / `a` are plain-text versions for lists and quizzes. */
export function clozeCards(md: string, skipBodyLines?: Set<number>): ClozeCardData[] {
  const out: ClozeCardData[] = [];
  for (const b of clozeBlocks(md, skipBodyLines)) {
    const h = clozeHash(b.text.trim());
    const nums = [...new Set(b.spans.map((s) => s.n))];
    for (const n of nums) {
      out.push({
        key: `cz${n}-${h}`, n, line: b.line, block: b.text,
        q: rebuild(b, n, (s) => `[${s.hint || "…"}]`),
        a: b.spans.filter((s) => s.n === n).map((s) => s.answer).join(" · "),
      });
    }
  }
  return out;
}

/** Card counts per block for the editor margin: [0-based line of the block's first line, last line, cards]. */
export function clozeLineCounts(md: string): { line: number; last: number; cards: number }[] {
  return clozeBlocks(md).map((b) => ({ line: b.line, last: b.line + b.text.split("\n").length - 1, cards: new Set(b.spans.map((s) => s.n)).size }));
}
