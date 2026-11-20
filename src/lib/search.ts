import MiniSearch from "minisearch";
import type { Folder, Note, Space } from "../../shared/types";
import { excerpt } from "./parse";
import { sceneText } from "./whiteboard";
import { isWbType } from "../../shared/types";

/** Parsed query: free text + operators `tag:` `type:` `status:` `in:` (folder) `space:` `is:pinned|published|fav`. */
export interface Query { text: string; tags: string[]; types: string[]; statuses: string[]; folders: string[]; spaces: string[]; is: string[] }

export function parseQuery(q: string): Query {
  const out: Query = { text: "", tags: [], types: [], statuses: [], folders: [], spaces: [], is: [] };
  const rest: string[] = [];
  for (const tok of q.match(/(\w+:"[^"]*"|\S+)/g) ?? []) {
    const m = /^(tag|type|status|in|space|is):"?([^"]*)"?$/.exec(tok);
    if (!m) { if (tok.startsWith("#") && tok.length > 1) out.tags.push(tok.slice(1).toLowerCase()); else rest.push(tok); continue; }
    const v = m[2].toLowerCase().replace(/^#/, "");
    ({ tag: out.tags, type: out.types, status: out.statuses, in: out.folders, space: out.spaces, is: out.is })[m[1] as "tag"].push(v);
  }
  out.text = rest.join(" ");
  return out;
}

export function matcher(q: Query, folders: Map<string, Folder>, spaces: Map<string, Space>) {
  const folderPath = (id: string | null) => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (let f = id ? folders.get(id) : undefined; f && !seen.has(f.id); f = f.parentId ? folders.get(f.parentId) : undefined) { seen.add(f.id); names.push(f.name.toLowerCase()); }
    return names;
  };
  return (n: Note) =>
    q.tags.every((t) => n.tags.some((x) => x === t || x.startsWith(t + "/"))) &&
    (!q.types.length || q.types.includes(n.type)) &&
    (!q.statuses.length || q.statuses.includes(n.status ?? "none")) &&
    (!q.folders.length || q.folders.some((f) => folderPath(n.folderId).some((p) => p.includes(f)))) &&
    (!q.spaces.length || q.spaces.some((s) => (spaces.get(n.spaceId)?.name.toLowerCase() ?? "").includes(s))) &&
    q.is.every((i) => (i === "pinned" ? n.pinned : i === "published" ? n.published : i === "fav" || i === "favorite" ? n.favorite : true));
}

/** Arabic-aware normalization: strip tashkeel/tatweel, unify alef/yaa/taa-marbuta forms; lowercase Latin. */
export const normalize = (t: string) =>
  t.toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي");

let index: MiniSearch<Note> | null = null;
let indexed = new Map<string, number>();

/**
 * Index in the background: big vaults (10k+ notes) take seconds to index, so the work runs in ~12 ms slices
 * between frames. A newer snapshot replaces the pending one; work already done is kept (indexing is incremental).
 */
let pendingNotes: Note[] | null = null;
let indexing = false;

/** Search index progress (big vaults, design 20b A15 "Indexing 512 / 738"): `done` of `total` live notes are indexed. */
export interface IndexStatus { done: number; total: number; running: boolean }
let status: IndexStatus = { done: 0, total: 0, running: false };
const statusSubs = new Set<() => void>();
export const indexStatus = () => status;
export function onIndexStatus(f: () => void) { statusSubs.add(f); return () => void statusSubs.delete(f); }
function setStatus(s: IndexStatus) {
  if (s.done === status.done && s.total === status.total && s.running === status.running) return;
  status = s;
  statusSubs.forEach((f) => f());
}
export function scheduleIndex(notes: Note[]) {
  pendingNotes = notes;
  if (!indexing) void indexLoop();
}
async function indexLoop() {
  indexing = true;
  try {
    while (pendingNotes) {
      const ns = pendingNotes;
      pendingNotes = null;
      await updateIndex(ns, () => pendingNotes !== null);
    }
  } finally { indexing = false; setStatus({ ...status, done: status.total, running: false }); }
}
const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0));

/** Incrementally (re)index notes, yielding to the browser every ~12 ms. Stops early when `stale()` turns true. */
export async function updateIndex(notes: Note[], stale: () => boolean = () => false) {
  index ??= new MiniSearch<Note>({
    fields: ["title", "body", "tagText"],
    storeFields: ["id"],
    autoVacuum: false,
    extractField: (doc, f) => (f === "tagText" ? doc.tags.join(" ") : f === "body" && doc.type === "canvas" ? canvasText(doc.body) : f === "body" && isWbType(doc.type) ? sceneText(doc.body) : (doc as never)[f]),
    processTerm: (term) => normalize(term) || null,
    searchOptions: { boost: { title: 3, tagText: 2 }, prefix: true, fuzzy: 0.2, combineWith: "AND", processTerm: (term) => normalize(term) || null },
  });
  const live = new Map(notes.filter((n) => !n.deleted).map((n) => [n.id, n]));
  // Mass removal (scenario switch, vault reset): rebuild from scratch instead of thousands of discards.
  let gone = 0;
  for (const [id] of indexed) if (!live.has(id)) gone++;
  if (gone > 200 && gone > indexed.size / 3) { index.removeAll(); indexed = new Map(); }
  for (const [id] of indexed) if (!live.has(id)) { index.discard(id); indexed.delete(id); }
  let t = performance.now();
  let done = 0;
  for (const n of live.values()) if (indexed.get(n.id) === n.updatedAt) done++;
  if (done < live.size) setStatus({ done, total: live.size, running: true });
  else setStatus({ done, total: live.size, running: false });
  for (const n of live.values()) {
    const v = indexed.get(n.id);
    if (v === n.updatedAt) continue;
    done++;
    if (v !== undefined) index.discard(n.id);
    index.add(n);
    indexed.set(n.id, n.updatedAt);
    if (performance.now() - t > 12) {
      setStatus({ done, total: live.size, running: true });
      await yieldToBrowser();
      if (stale()) return;
      t = performance.now();
    }
  }
}

function canvasText(json: string) {
  try {
    const c = JSON.parse(json) as { nodes?: { text?: string; label?: string; url?: string; file?: string }[] };
    return (c.nodes ?? []).map((n) => n.text ?? n.label ?? n.url ?? n.file ?? "").join("\n");
  } catch { return ""; }
}

/**
 * The part of a note worth building a snippet from: ~1 KB around the first raw hit of any term, else the start.
 * Snippet helpers (plain-text conversion, normalization) are linear in their input, so this keeps search results cheap
 * on huge notes. Arabic-normalized matches that the raw lowercase scan misses fall back to the start.
 */
export function around(body: string, terms: string[], before = 400, after = 900) {
  if (body.length <= before + after) return body;
  const low = body.toLowerCase();
  let i = -1;
  for (const t of terms) { const j = low.indexOf(t.toLowerCase()); if (j >= 0 && (i < 0 || j < i)) i = j; }
  if (i < 0) return body.slice(0, before + after);
  const head = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(body.slice(0, 4000))?.[0] ?? "";
  return i - before <= head.length ? body.slice(0, i + after) : body.slice(i - before, i + after);
}

export interface Hit { note: Note; score: number; snippet: string }
export function search(q: Query, notes: Map<string, Note>, filter: (n: Note) => boolean, limit = 50): Hit[] {
  if (!q.text.trim()) {
    return [...notes.values()].filter((n) => !n.deleted && filter(n)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
      .map((note) => ({ note, score: 0, snippet: excerpt(note.body, 120) }));
  }
  if (!index) return [];
  const terms = normalize(q.text).split(/\s+/).filter(Boolean);
  return index.search(q.text)
    .map((r) => notes.get(r.id as string))
    .filter((n): n is Note => !!n && !n.deleted && filter(n))
    .slice(0, limit)
    .map((note) => ({ note, score: 1, snippet: snippetFor(note.type === "canvas" ? canvasText(note.body) : isWbType(note.type) ? sceneText(note.body) : note.body, terms) }));
}

/** Every note matching the query (no snippets, no limit): totals for "Showing 50 of 1,240" (Lumen 22). */
export function searchCount(q: Query, notes: Map<string, Note>, filter: (n: Note) => boolean): Note[] {
  if (!q.text.trim()) return [...notes.values()].filter((n) => !n.deleted && filter(n));
  if (!index) return [];
  return index.search(q.text).map((r) => notes.get(r.id as string)).filter((n): n is Note => !!n && !n.deleted && filter(n));
}

/**
 * Filters that would narrow a big result list the most (Lumen 22 "Search with too many results"): per facet (type,
 * space or top folder) the most common value that still cuts at least a fifth; most-cutting first, at most `max`.
 */
export function narrowingFilters(hits: Note[], folders: Map<string, Folder>, spaces: Map<string, Space>, opts: { allSpaces: boolean; max?: number }): { op: string; left: number }[] {
  const out: { op: string; left: number }[] = [];
  const quote = (s: string) => (/\s/.test(s) ? `"${s.toLowerCase()}"` : s.toLowerCase());
  const facet = (key: (n: Note) => string | null, op: (v: string) => string) => {
    const c = new Map<string, number>();
    for (const n of hits) { const k = key(n); if (k) c.set(k, (c.get(k) ?? 0) + 1); }
    const best = [...c].filter(([, n]) => n <= hits.length * 0.8 && n > 0).sort((a, b) => b[1] - a[1])[0];
    if (best) out.push({ op: op(best[0]), left: best[1] });
  };
  facet((n) => n.type, (v) => `type:${v}`);
  if (opts.allSpaces) facet((n) => n.spaceId, (v) => `space:${quote(spaces.get(v)?.name ?? v)}`);
  else facet((n) => { let f = n.folderId ? folders.get(n.folderId) : undefined; for (let i = 0; f?.parentId && i < 64; i++) f = folders.get(f.parentId) ?? undefined; return f?.id ?? null; }, (v) => `in:${quote(folders.get(v)?.name ?? v)}`);
  facet((n) => n.status, (v) => `status:${v}`);
  return out.sort((a, b) => a.left - b.left).slice(0, opts.max ?? 2);
}

function snippetFor(body: string, terms: string[]) {
  body = around(body, terms);
  const low = normalize(body);
  const i = Math.max(0, ...terms.map((t) => low.indexOf(t)).filter((x) => x >= 0).slice(0, 1));
  return excerpt(body.slice(Math.max(0, i - 50)), 140);
}
