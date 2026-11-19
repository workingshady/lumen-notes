/**
 * Unlinked mentions (design update 04 §D6): plain-text appearances of a note's title or aliases in other notes.
 *
 * Pure logic, no React. A mention is only counted in prose: front-matter, code (fenced + inline), math, existing
 * links ([[wiki]], [md](url), embeds), bare URLs, HTML tags, #tags and the note's own H1 are masked out first.
 * Matching is case-insensitive and Arabic-normalized (same rules as search.ts `normalize`), and word-boundary aware:
 * the letters around a match must not be letters/digits. For Arabic terms a leading proclitic (و ف ب ل ك ال وال بال
 * لل فال كال) is allowed and becomes part of the linked text: "والشبكة" → `[[شبكة|والشبكة]]`.
 *
 * Ignored mentions live in the target note's front-matter: `mentions-ignore: [Source title, Other title]`.
 */

export interface MentionTarget { id: string; title: string; aliases: string[] }
export interface Mention {
  /** Offsets in the source body (UTF-16) of the text that becomes the link. */
  start: number; end: number;
  /** Text as written in the source. */
  text: string;
  /** The title or alias that matched. */
  term: string;
  /** Sentence around the match, split for highlighting. */
  before: string; match: string; after: string;
}

const ALEF = /[أإآٱ]/;
/** Per-character normalization (may return "" for diacritics/tatweel, or 2+ chars for some lowercase forms). */
function normChar(c: string): string {
  if (/[ً-ٰٟـ]/.test(c)) return "";
  if (ALEF.test(c)) return "ا";
  if (c === "ى") return "ي";
  if (c === "ة") return "ه";
  if (c === "ؤ") return "و";
  if (c === "ئ") return "ي";
  return c.toLowerCase();
}
/** Normalized text + map from each normalized index to the source index it came from. */
export function normalizeMapped(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const n = normChar(s[i]);
    for (let k = 0; k < n.length; k++) { text += n[k]; map.push(i); }
  }
  return { text, map };
}
export const normalizeTerm = (s: string) => normalizeMapped(s).text.replace(/\s+/g, " ").trim();

/** Replace a range with spaces (keeps offsets; newlines stay so line-based rules still work). */
const blank = (s: string) => s.replace(/[^\n]/g, " ");

/** The source body with every non-prose region blanked out (same length as the input). */
export function maskBody(body: string): string {
  let s = body;
  const sub = (re: RegExp) => { s = s.replace(re, (m) => blank(m)); };
  sub(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/); // front-matter
  sub(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(^[ \t]*\1[ \t]*$|(?![\s\S]))/gm); // fenced code (unterminated: to the end)
  sub(/\$\$[\s\S]*?\$\$/g); // display math
  sub(/`[^`\n]*`/g); // inline code
  sub(/\$[^$\n]+\$/g); // inline math
  sub(/!?\[\[[^\]\n]*\]\]/g); // wikilinks + embeds
  sub(/!?\[[^\]\n]*\]\([^)\n]*\)/g); // markdown links + images
  sub(/<[^>\n]+>/g); // HTML tags / autolinks
  sub(/\b(?:https?:\/\/|www\.)[^\s)>\]]+/g); // bare URLs
  sub(/(^|[^\p{L}\p{N}&])#[\p{L}\p{N}_/-]+/gmu); // #tags (the preceding char is blanked too; harmless)
  sub(/^#[ \t].*$/m); // the note's own H1 (its title)
  return s;
}

const WORD = /[\p{L}\p{N}_]/u;
const ARABIC = /[؀-ۿ]/;
const PROCLITICS = ["وال", "فال", "بال", "كال", "لل", "ال", "و", "ف", "ب", "ل", "ك"];

/** Find all unlinked mentions of `terms` (title + aliases) in `body`. Longest term wins where matches overlap. */
export function findMentions(body: string, terms: string[]): Mention[] {
  const masked = maskBody(body);
  const { text, map } = normalizeMapped(masked);
  const norm = [...new Set(terms.map(normalizeTerm).filter((t) => t.length >= 3))].sort((a, b) => b.length - a.length);
  const raw: { s: number; e: number; term: string }[] = [];
  for (const t of norm) {
    const ar = ARABIC.test(t);
    for (let i = text.indexOf(t); i >= 0; i = text.indexOf(t, i + 1)) {
      const j = i + t.length;
      if (j < text.length && WORD.test(text[j])) continue;
      let s = i;
      if (i > 0 && WORD.test(text[i - 1])) {
        if (!ar) continue;
        // Arabic: allow a proclitic glued to the word ("والشبكة"), which must itself start at a word boundary.
        const p = PROCLITICS.find((p) => text.slice(i - p.length, i) === p && (i - p.length === 0 || !WORD.test(text[i - p.length - 1])));
        if (!p) continue;
        s = i - p.length;
      }
      raw.push({ s, e: j, term: t });
    }
  }
  raw.sort((a, b) => a.s - b.s || b.e - a.e);
  const out: Mention[] = [];
  let last = -1;
  for (const r of raw) {
    if (r.s < last) continue;
    last = r.e;
    const start = map[r.s], end = map[r.e - 1] + 1;
    // extend over trailing diacritics that normalized away (they belong to the last letter)
    let e2 = end;
    while (e2 < body.length && /[ً-ٰٟـ]/.test(body[e2])) e2++;
    out.push({ start, end: e2, text: body.slice(start, e2), term: terms.find((t) => normalizeTerm(t) === r.term) ?? r.term, ...sentence(body, start, e2) });
  }
  return out;
}

/** The sentence around [start, end), trimmed to ~90 chars per side, Markdown marks removed. */
function sentence(body: string, start: number, end: number) {
  const stop = /[.!?؟\n]/;
  let a = start;
  while (a > 0 && start - a < 90 && !stop.test(body[a - 1])) a--;
  let b = end;
  while (b < body.length && b - end < 90 && !stop.test(body[b])) b++;
  if (b < body.length && /[.!?؟]/.test(body[b])) b++;
  const clean = (s: string) => s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`~]|==|^\s*([-*+>]|\d+\.)\s+|^\s*\[[ xX/-]\]\s+|^#+\s+/g, "");
  const before = clean(body.slice(a, start)).replace(/^\s+/, "");
  const after = clean(body.slice(end, b)).replace(/\s+$/, "");
  return { before: (a > 0 && !stop.test(body[a - 1]) ? "…" : "") + before, match: body.slice(start, end), after: after + (b < body.length && !stop.test(body[b - 1] ?? "") ? "…" : "") };
}

/** Wikilink for a mention: `[[Title]]` when the text is exactly the title, else `[[Title|text as written]]`. */
export function linkFor(m: Pick<Mention, "text">, title: string) {
  return m.text === title ? `[[${title}]]` : `[[${title}|${m.text.replace(/[|\]]/g, "")}]]`;
}

/** Rewrite mentions (given in any order) to links. Ranges must come from `findMentions` on this exact body. */
export function linkMentions(body: string, ms: Pick<Mention, "start" | "end" | "text">[], title: string): string {
  let out = body;
  for (const m of [...ms].sort((a, b) => b.start - a.start)) {
    if (out.slice(m.start, m.end) !== m.text) continue;
    out = out.slice(0, m.start) + linkFor(m, title) + out.slice(m.end);
  }
  return out;
}

/** Re-locate a mention in a (possibly edited) body: same offset and text, else the n-th (0-based) mention with that same text. */
export function relocate(body: string, terms: string[], m: Pick<Mention, "start" | "text">, nth: number): Mention | null {
  const all = findMentions(body, terms);
  return all.find((x) => x.start === m.start && x.text === m.text) ?? all.filter((x) => x.text === m.text)[nth] ?? null;
}

/** Aliases from front-matter `aliases:` (list or comma string) and the record props. */
export function aliasesOf(fmAliases: string | undefined, propAliases: string | undefined): string[] {
  const split = (v?: string) => (v ?? "").replace(/^\[|\]$/g, "").split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  return [...new Set([...split(fmAliases), ...split(propAliases)])];
}
/** Titles of source notes whose mentions are ignored (front-matter `mentions-ignore:`). */
export const ignoredOf = (fm: string | undefined) => (fm ?? "").replace(/^\[|\]$/g, "").split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);

/** Quick pre-check on a normalized body (cheap: lets callers skip most notes without masking). */
export const mayMention = (normBody: string, normTerms: string[]) => normTerms.some((t) => t.length >= 3 && normBody.includes(t));

/** Note types whose body is Markdown prose (mentions are only looked for there). Roadmaps and learning paths are left out: their topic lines are structured syntax, a link there would rename the topic. */
export const PROSE_TYPES = new Set(["note", "lesson", "journal", "flashcards", "slides", "post", "moc"]);
