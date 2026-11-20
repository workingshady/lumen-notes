// Word-level note diff for the version studio (design 58A-C). Lines are compared first (jsdiff diffArrays), then a
// changed line paired with its replacement is compared word by word (jsdiff diffWords), so "the same" -> "shared" shows
// as one struck and one added word inside an otherwise unchanged line.
import { diffArrays, diffWords } from "diff";
import { readable } from "./versions-text";

export type Tok = { s: string; k: "=" | "+" | "-" };
/** m: "" unchanged, "+" added line, "-" removed line, "~" changed line (tokens carry the word differences). */
export interface DLine {
  m: "" | "+" | "-" | "~";
  h: 0 | 1 | 2;
  toks: Tok[];
  /** Raw markdown of the line in the old / new text. */
  a?: string;
  b?: string;
  /** Blank source line: kept so a restore is exact, never drawn. */
  blank?: boolean;
  /** Index in the full list (what a selection refers to). */
  i: number;
}
export interface DStat { added: number; removed: number; changed: number }

const MAX_WORD_DIFF = 6000;

const headOf = (s: string, rendered: boolean): [0 | 1 | 2, string] => {
  if (!rendered) return [0, s]; // source view: the raw line, front matter and all
  const m = /^(#{1,6})\s+(.*)$/.exec(s);
  return m ? [m[1].length === 1 ? 1 : 2, readable(m[2])] : [0, readable(s)];
};

function wordToks(a: string, b: string): Tok[] | null {
  if (a.length + b.length > MAX_WORD_DIFF) return null;
  const parts = diffWords(a, b);
  const common = parts.filter((p) => !p.added && !p.removed).reduce((n, p) => n + p.value.length, 0);
  if (common < Math.min(a.length, b.length) * 0.3) return null; // a rewrite: show it as a removed and an added line
  return parts.map((p) => ({ s: p.value, k: p.added ? "+" : p.removed ? "-" : "=" }));
}

/** Blank lines stay in the comparison (so a restore keeps the text exact) but are never drawn. */
const lines = (s: string) => s.replace(/\r\n?/g, "\n").split("\n");

/** `rendered` draws readable prose (no table pipes, [[ ]], Markdown marks); a restore still uses the raw lines kept in a / b. */
export function diffLines(oldText: string, newText: string, rendered = false): DLine[] {
  const out: DLine[] = [];
  const head = (s: string) => headOf(s, rendered);
  const empty = (s: string) => !(rendered ? readable(s) : s).trim();
  const row = (m: DLine["m"], text: string, a?: string, b?: string) => {
    const [h, body] = head(text);
    out.push({ m, h, toks: [{ s: body, k: m === "+" ? "+" : m === "-" ? "-" : "=" }], a, b, blank: empty(text), i: 0 });
  };
  const parts = diffArrays(lines(oldText), lines(newText));
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.added && !p.removed) {
      for (const l of p.value) { const [h, body] = head(l); out.push({ m: "", h, toks: [{ s: body, k: "=" }], a: l, b: l, blank: empty(l), i: 0 }); }
      continue;
    }
    const next = parts[i + 1];
    if (p.removed && next?.added) {
      const n = Math.min(p.value.length, next.value.length);
      const paired: DLine[] = [];
      const restOld: string[] = [], restNew: string[] = [];
      for (let j = 0; j < Math.max(p.value.length, next.value.length); j++) {
        const x = p.value[j], y = next.value[j];
        if (j < n && x.trim() && y.trim()) {
          const [hx, bx] = head(x), [hy, by] = head(y);
          const toks = wordToks(bx, by);
          if (toks) { paired.push({ m: "~", h: hy || hx, toks, a: x, b: y, i: 0 }); continue; }
        }
        if (x !== undefined) restOld.push(x);
        if (y !== undefined) restNew.push(y);
      }
      out.push(...paired);
      for (const l of restOld) row("-", l, l);
      for (const l of restNew) row("+", l, undefined, l);
      i++;
      continue;
    }
    for (const l of p.value) row(p.added ? "+" : "-", l, p.removed ? l : undefined, p.added ? l : undefined);
  }
  out.forEach((l, i) => { l.i = i; });
  return out;
}

export const statOf = (ls: DLine[]): DStat => ({
  added: ls.filter((l) => l.m === "+" && !l.blank).length,
  removed: ls.filter((l) => l.m === "-" && !l.blank).length,
  changed: ls.filter((l) => l.m === "~").length,
});

/** Rows drawn inline (old and new together), and on the old / new side of a side-by-side view. */
export const inlineRows = (ls: DLine[]) => ls.filter((l) => !l.blank);
export const oldSide = (ls: DLine[]) => ls.filter((l) => l.m !== "+" && !l.blank).map((l) => (l.m === "~" ? { ...l, toks: l.toks.filter((t) => t.k !== "+") } : l));
export const newSide = (ls: DLine[]) => ls.filter((l) => l.m !== "-" && !l.blank).map((l) => (l.m === "~" ? { ...l, toks: l.toks.filter((t) => t.k !== "-") } : l));

/**
 * Text for "Restore selection": the NEW text (the current note), except that every selected changed row (by `i`) goes
 * back to how the OLD version had it: an added row disappears, a removed row comes back, a changed row takes the old
 * wording. Everything else is byte for byte the new text.
 */
export function restoreRows(ls: DLine[], picked: Set<number>): string {
  const out: string[] = [];
  for (const l of ls) {
    const take = picked.has(l.i);
    if (l.m === "") out.push(l.b ?? "");
    else if (l.m === "+") { if (!take) out.push(l.b ?? ""); }
    else if (l.m === "-") { if (take) out.push(l.a ?? ""); }
    else out.push((take ? l.a : l.b) ?? "");
  }
  return out.join("\n");
}
