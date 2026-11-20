// Pure part of the sync-conflict logic (no database, no UI): block comparison of two texts and the merge by choice.
// Used by lib/conflicts.ts and covered by scripts/conflicts.test.ts.
import { diffArrays } from "diff";

export type Choice = "mine" | "theirs" | "both";
export type Seg = { kind: "same"; lines: string[] } | { kind: "diff"; mine: string[]; theirs: string[] };
export interface Side { title: string; body: string; at: number; device: string }
export interface ConflictRec { id: string; noteId: string; mine: Side; theirs: Side; at: number }
export type Resolution = "mine" | "theirs" | "both" | { merged: string };

const NOT_MARKDOWN = new Set(["canvas", "whiteboard", "board", "diagram"]);
export const isMarkdownNote = (n: { type?: string }) => !NOT_MARKDOWN.has(n.type ?? "");
const split = (s: string) => s.replace(/\r\n?/g, "\n").split("\n");

/** Would a pulled note overwrite unpushed local edits? (markdown notes only, texts differ, the pull is not older) */
export function overwritesLocal(
  local: { type?: string; body?: unknown; dirty?: 0 | 1; deleted?: 0 | 1; updatedAt: number },
  incoming: { data?: { type?: string; body?: unknown } | null; updatedAt: number; deleted?: 0 | 1 },
): boolean {
  const d = incoming.data;
  if (!d || incoming.deleted || local.deleted || !local.dirty) return false;
  if (!isMarkdownNote(local) || !isMarkdownNote(d)) return false;
  if (typeof local.body !== "string" || typeof d.body !== "string" || local.body === d.body) return false;
  return incoming.updatedAt >= local.updatedAt; // an older pull never overwrites: apply() keeps the newer local edit
}

/** Block-level comparison of the two texts: unchanged runs and the places where they differ. */
export function segments(mine: string, theirs: string): Seg[] {
  const out: Seg[] = [];
  const parts = diffArrays(split(mine), split(theirs));
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.added && !p.removed) { out.push({ kind: "same", lines: p.value }); continue; }
    const n = parts[i + 1];
    if (p.removed && n?.added) { out.push({ kind: "diff", mine: p.value, theirs: n.value }); i++; }
    else out.push(p.removed ? { kind: "diff", mine: p.value, theirs: [] } : { kind: "diff", mine: [], theirs: p.value });
  }
  return out;
}
export const blocksDiffer = (segs: Seg[]) => segs.filter((s) => s.kind === "diff").length;

/** The note text with one choice per differing block (missing = theirs, what the app applied). "both" keeps mine then theirs. */
export function mergeBlocks(segs: Seg[], choices: Choice[]): string {
  let k = 0;
  const out: string[] = [];
  for (const s of segs) {
    if (s.kind === "same") { out.push(...s.lines); continue; }
    const c = choices[k++] ?? "theirs";
    if (c === "mine") out.push(...s.mine);
    else if (c === "theirs") out.push(...s.theirs);
    else out.push(...s.mine, ...s.theirs.filter((l) => !l.trim() || !s.mine.includes(l)));
  }
  return out.join("\n");
}

/** Text and title the note gets for a resolution. */
export function resolvedText(c: ConflictRec, r: Resolution): { title: string; body: string } {
  if (typeof r === "object") return { title: c.theirs.title, body: r.merged };
  if (r === "mine") return { title: c.mine.title, body: c.mine.body };
  if (r === "theirs") return { title: c.theirs.title, body: c.theirs.body };
  const segs = segments(c.mine.body, c.theirs.body);
  return { title: c.theirs.title, body: mergeBlocks(segs, segs.filter((s) => s.kind === "diff").map(() => "both" as Choice)) };
}
