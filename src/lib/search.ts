import MiniSearch from "minisearch";
import type { Folder, Note, Space } from "../../shared/types";
import { excerpt } from "./parse";
import { sceneText } from "./whiteboard";

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
    for (let f = id ? folders.get(id) : undefined; f; f = f.parentId ? folders.get(f.parentId) : undefined) names.push(f.name.toLowerCase());
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

/** Incrementally (re)index notes. Cheap to call on every change. */
export function updateIndex(notes: Note[]) {
  index ??= new MiniSearch<Note>({
    fields: ["title", "body", "tagText"],
    storeFields: ["id"],
    extractField: (doc, f) => (f === "tagText" ? doc.tags.join(" ") : f === "body" && doc.type === "canvas" ? canvasText(doc.body) : f === "body" && doc.type === "whiteboard" ? sceneText(doc.body) : (doc as never)[f]),
    processTerm: (term) => normalize(term) || null,
    searchOptions: { boost: { title: 3, tagText: 2 }, prefix: true, fuzzy: 0.2, combineWith: "AND", processTerm: (term) => normalize(term) || null },
  });
  const live = new Map(notes.filter((n) => !n.deleted).map((n) => [n.id, n]));
  for (const [id] of indexed) if (!live.has(id)) { index.discard(id); indexed.delete(id); }
  for (const n of live.values()) {
    const v = indexed.get(n.id);
    if (v === n.updatedAt) continue;
    if (v !== undefined) index.discard(n.id);
    index.add(n);
    indexed.set(n.id, n.updatedAt);
  }
}

function canvasText(json: string) {
  try {
    const c = JSON.parse(json) as { nodes?: { text?: string; label?: string; url?: string; file?: string }[] };
    return (c.nodes ?? []).map((n) => n.text ?? n.label ?? n.url ?? n.file ?? "").join("\n");
  } catch { return ""; }
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
    .map((note) => ({ note, score: 1, snippet: snippetFor(note.type === "canvas" ? canvasText(note.body) : note.type === "whiteboard" ? sceneText(note.body) : note.body, terms) }));
}

function snippetFor(body: string, terms: string[]) {
  const low = normalize(body);
  const i = Math.max(0, ...terms.map((t) => low.indexOf(t)).filter((x) => x >= 0).slice(0, 1));
  return excerpt(body.slice(Math.max(0, i - 50)), 140);
}
