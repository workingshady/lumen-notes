import MiniSearch from "minisearch";
import type { Note, Space } from "../../shared/types";
import { parsePath, resolveCourses } from "./path";
import { normalize } from "./search";
import type { Vault } from "./store";

// ------------------------------------------------------------------ chunking
/** One retrievable passage: a heading section (or part of one) of a note, ~800 chars. */
export interface Chunk { id: string; noteId: string; spaceId: string; title: string; heading: string; text: string; src: string; order: number }

const TARGET = 800;
const HARD = 1400;

/** Fold Arabic forms (search.ts normalize) and Latin diacritics (Géron → geron). */
export const fold = (t: string) => normalize(t).normalize("NFKD").replace(/[̀-ͯ]/g, "");

function canvasText(json: string) {
  try { return ((JSON.parse(json) as { nodes?: { text?: string; label?: string }[] }).nodes ?? []).map((n) => n.text ?? n.label ?? "").filter(Boolean).join("\n\n"); } catch { return ""; }
}

/** Split a long paragraph on sentence / line boundaries into pieces ≤ HARD. */
function splitLong(p: string): string[] {
  if (p.length <= HARD) return [p];
  const parts = p.split(/(?<=[.!?؟。])\s+|\n/);
  const out: string[] = [];
  let cur = "";
  for (const s of parts) {
    if (cur && cur.length + s.length + 1 > TARGET) { out.push(cur); cur = ""; }
    cur = cur ? cur + (/\n$/.test(cur) ? "" : " ") + s : s;
    while (cur.length > HARD) { out.push(cur.slice(0, TARGET)); cur = cur.slice(TARGET); }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Note → passages: split by headings (keeping the heading path), then paragraphs packed up to ~800 chars. */
export function chunkNote(n: Note, spaceName = ""): Chunk[] {
  if (n.type === "whiteboard") return [];
  let body = n.type === "canvas" ? canvasText(n.body) : n.body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  body = body.replace(/\r/g, "");
  const src = `${spaceName} ${n.tags.join(" ")}`.trim();
  const chunks: Chunk[] = [];
  const path: string[] = [];
  let paras: string[] = [];
  let buf: string[] = [];
  let fence = false;
  const push = (text: string) => {
    const t = text.trim();
    if (t.length < 2) return;
    chunks.push({ id: `${n.id}#${chunks.length}`, noteId: n.id, spaceId: n.spaceId, title: n.title, heading: path.filter(Boolean).join(" › "), text: t, src, order: chunks.length });
  };
  const flushSection = () => {
    if (buf.length) { paras.push(buf.join("\n")); buf = []; }
    let cur = "";
    for (const p of paras.flatMap(splitLong)) {
      if (cur && cur.length + p.length + 2 > TARGET) { push(cur); cur = ""; }
      cur = cur ? cur + "\n\n" + p : p;
    }
    push(cur);
    paras = [];
  };
  for (const line of body.split("\n")) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) fence = !fence;
    const h = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flushSection();
      const level = h[1].length;
      if (level === 1 && h[2].trim() === n.title) { path.length = 0; continue; } // the title line
      path.length = Math.max(0, level - 2);
      path[level - 2] = h[2].replace(/[*_`]/g, "").trim();
      continue;
    }
    if (!fence && !line.trim()) { if (buf.length) { paras.push(buf.join("\n")); buf = []; } continue; }
    buf.push(line);
  }
  flushSection();
  return chunks;
}

// ------------------------------------------------------------------ chunk index (incremental, like search.ts)
let index: MiniSearch<Chunk> | null = null;
const indexed = new Map<string, { v: number; ids: string[]; space: string }>();
const chunkById = new Map<string, Chunk>();
const yieldNow = () => new Promise<void>((r) => setTimeout(r, 0));
const STOP = new Set(("a an the of to in on for and or with using use my me i is are was what how why when which who does do did can could should would explain describe tell about from "
  + "notes note please give show between vs versus difference compare summary summarize define definition "
  + "في من على عن الى إلى ما ماذا كيف لماذا هل هي هو و او أو مع ملاحظاتي اشرح شرح").split(" ").map(fold));

const askTerm = (term: string) => { const t = fold(term); return t && !STOP.has(t) ? t : null; };

export async function ensureIndex(v: Vault, onProgress?: (done: number, total: number) => void) {
  index ??= new MiniSearch<Chunk>({
    fields: ["title", "heading", "text", "src"],
    storeFields: ["id"],
    autoVacuum: false,
    processTerm: askTerm,
    searchOptions: { processTerm: askTerm },
  });
  const live = new Map(v.notes.filter((n) => !n.deleted).map((n) => [n.id, n]));
  for (const [id, e] of indexed) if (!live.has(id)) { for (const c of e.ids) { index.discard(c); chunkById.delete(c); } indexed.delete(id); }
  let t = performance.now(), done = 0;
  for (const n of live.values()) {
    done++;
    const space = v.spaceMap.get(n.spaceId)?.name ?? "";
    const e = indexed.get(n.id);
    if (e && e.v === n.updatedAt && e.space === space) continue;
    if (e) for (const c of e.ids) { index.discard(c); chunkById.delete(c); }
    const cs = chunkNote(n, space);
    index.addAll(cs);
    for (const c of cs) chunkById.set(c.id, c);
    indexed.set(n.id, { v: n.updatedAt, ids: cs.map((c) => c.id), space });
    if (performance.now() - t > 14) { onProgress?.(done, live.size); await yieldNow(); t = performance.now(); }
  }
}

// ------------------------------------------------------------------ scope
export type ScopeKind = "vault" | "space" | "note" | "path";
export interface Scope { kind: ScopeKind; spaceId?: string; noteId?: string; pathId?: string }

/** Note ids the scope allows (null = whole vault). */
export function scopeNotes(s: Scope, v: Vault): Set<string> | null {
  if (s.kind === "vault") return null;
  if (s.kind === "space") return s.spaceId && s.spaceId !== "all" ? new Set(v.notes.filter((n) => n.spaceId === s.spaceId).map((n) => n.id)) : null;
  if (s.kind === "note") {
    if (!s.noteId) return null;
    return new Set([s.noteId, ...(v.outlinks.get(s.noteId) ?? []), ...(v.backlinks.get(s.noteId) ?? [])]);
  }
  const p = s.pathId ? v.byId.get(s.pathId) : undefined;
  if (!p) return null;
  const doc = parsePath(p.body);
  const courses = resolveCourses(doc.courses, v.notes, v.spaces as (Space & { roadmapId: string | null })[]);
  const spaces = new Set(courses.map((c) => c.spaceId).filter((x): x is string => !!x));
  const ids = new Set<string>([p.id]);
  for (const c of courses) if (c.note) ids.add(c.note.id);
  for (const n of v.notes) if (spaces.has(n.spaceId)) ids.add(n.id);
  for (const st of doc.stages) for (const c of st.concepts) for (const t of c.notes) { const n = v.byTitle.get(t.toLowerCase()); if (n) ids.add(n.id); }
  return ids;
}

export function scopeLabel(s: Scope, v: Vault): string {
  if (s.kind === "vault" || (s.kind === "space" && (!s.spaceId || s.spaceId === "all"))) return "Whole vault";
  if (s.kind === "space") { const sp = v.spaceMap.get(s.spaceId!); return sp ? sp.name : "This space"; }
  if (s.kind === "note") return `${v.byId.get(s.noteId ?? "")?.title ?? "This note"} + links`;
  return v.byId.get(s.pathId ?? "")?.title ?? "Learning path";
}

// ------------------------------------------------------------------ retrieval
export interface Retrieved extends Chunk { n: number; score: number }
const BUDGET = 9000; // chars of excerpts sent to the model (~2.5k tokens)
const TOP = 8;
const PER_NOTE = 3;

/**
 * Rank passages for a question: MiniSearch BM25 over chunks (title ×3, heading ×2, space/tags ×1.5), OR-combined
 * with prefix/fuzzy for longer terms; then title-term and "named source" boosts (a query word matching a space name,
 * e.g. "Géron", "Coursera", favours that space), at most 3 passages per note and ≥1 per named source, within a char budget.
 */
export function retrieve(question: string, v: Vault, scope: Scope): Retrieved[] {
  if (!index) return [];
  const allow = scopeNotes(scope, v);
  const terms = [...new Set(question.split(/[^\p{L}\p{N}_+-]+/u).map((t) => askTerm(t)).filter((t): t is string => !!t && t.length > 1))];
  if (!terms.length) return [];
  // Query words naming a source (space): "using my Géron and Coursera notes". Only words that pick out ≤2 spaces
  // count (so "deep learning" doesn't name every Deep Learning course).
  const spaceWords = v.spaces.map((sp) => ({ id: sp.id, words: new Set(fold(sp.name).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4)) }));
  const named = new Map<string, string[]>();
  for (const t of terms) {
    if (t.length < 4) continue;
    const hits = spaceWords.filter((s) => s.words.has(t));
    if (hits.length && hits.length <= 2) for (const s of hits) named.set(s.id, [...(named.get(s.id) ?? []), t]);
  }
  const sourceWords = new Set([...named.values()].flat());
  const content = terms.filter((t) => !sourceWords.has(t));
  const qterms = content.length ? content : terms;
  const qset = new Set(qterms);
  const run = (filter: (c: Chunk) => boolean, loose: boolean) => index!.search(qterms.join(" "), {
    boost: { title: 3, heading: 2, src: 1.5 },
    combineWith: "OR",
    prefix: (t) => t.length >= 4,
    fuzzy: (t) => (t.length >= (loose ? 5 : 6) ? 0.2 : false),
    filter: (r) => { const c = chunkById.get(r.id as string); return !!c && (!allow || allow.has(c.noteId)) && filter(c); },
  });
  // Relevance floor: a passage must match at least half of the question's content words — counted per script, so a
  // mixed Arabic + English question ("اشرح attention") passes on its English half.
  const isArabic = (t: string) => /[\u0600-\u06ff]/.test(t);
  const groups = [qterms.filter(isArabic), qterms.filter((t) => !isArabic(t))].filter((g) => g.length);
  const enough = (matched: Set<string>) => groups.some((g) => g.filter((t) => matched.has(t)).length / g.length >= 0.5);

  const score = (r: { id: unknown; score: number; queryTerms: string[] }): Retrieved | null => {
    const c = chunkById.get(r.id as string);
    if (!c || !enough(new Set(r.queryTerms))) return null;
    let s = r.score;
    const tw = new Set(fold(c.title + " " + c.heading).split(/[^\p{L}\p{N}]+/u));
    const inTitle = [...qset].filter((t) => tw.has(t)).length;
    if (inTitle) s *= 1 + 0.35 * inTitle;
    if (named.has(c.spaceId)) s *= 1.8;
    // Distinct question words in the passage text itself (rewards passages that explain, not just mention).
    const body = fold(c.text);
    s *= 1 + 0.25 * [...qset].filter((t) => body.includes(t)).length;
    if (c.text.length < 120) s *= 0.7; // heading-only / link-only stubs
    return { ...c, n: 0, score: s };
  };
  const scored = run(() => true, false).slice(0, 400).map(score).filter((x): x is Retrieved => !!x).sort((a, b) => b.score - a.score);

  const pick: Retrieved[] = [];
  const perNote = new Map<string, number>();
  let used = 0;
  const take = (c: Retrieved) => {
    if (pick.some((p) => p.id === c.id) || (perNote.get(c.noteId) ?? 0) >= PER_NOTE || used + c.text.length > BUDGET) return false;
    pick.push(c); perNote.set(c.noteId, (perNote.get(c.noteId) ?? 0) + 1); used += c.text.length;
    return true;
  };
  // Each named source gets its best passage first, so "using my X and Y notes" really uses both. A source with no
  // direct hit is searched again more loosely (AdamW → Adam) inside that space only.
  for (const id of named.keys()) {
    const best = scored.find((c) => c.spaceId === id)
      ?? run((c) => c.spaceId === id, true).slice(0, 50).map(score).filter((x): x is Retrieved => !!x).sort((a, b) => b.score - a.score)[0];
    if (best) take(best);
  }
  for (const c of scored) { if (pick.length >= TOP) break; take(c); }
  pick.sort((a, b) => b.score - a.score);
  const top = pick[0]?.score ?? 0;
  return pick.filter((c, i) => i < 2 || named.has(c.spaceId) || c.score >= top * 0.12).map((c, i) => ({ ...c, n: i + 1 }));
}
