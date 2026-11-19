// Write an ImportPlan as one undoable batch (docs/IMPORT.md). Pure logic over an ImportStore, so tests use an in-memory
// store and the app uses Dexie through save() (import-db.ts).
//
// Every record the import creates (notes, folders, attachments, cards, review-log rows) carries `lumenImport: <id>`.
// Undo marks them all deleted (tombstones, so other devices drop them too) and restores the text of notes that were
// merged into. The import registry (id, counts, merged notes' previous text) lives in local meta.
import type { Folder, Kind, Note, NoteType, Status } from "../../shared/types";
import { NOTE_TYPES, STATUSES } from "../../shared/types";
import { ATT_REF, FOLDER_REF, yieldUI, type ImportPlan, type ImportSourceKind, type PlanNote, type Progress } from "./import-model";
import { fmList, inlineTags, splitFrontMatter } from "./parse";

export type ConflictAction = "skip" | "rename" | "merge";
type Rec = { id: string } & Record<string, unknown>;

export interface ImportStore {
  notesIn(spaceId: string): Promise<Note[]>;
  foldersIn(spaceId: string): Promise<Folder[]>;
  get(kind: Kind, id: string): Promise<Rec | undefined>;
  put(kind: Kind, rec: Rec): Promise<void>;
  putBlob(id: string, bytes: Uint8Array, mime: string): Promise<void>;
  deleteBlob(id: string): Promise<void>;
  tagged(kind: Kind, importId: string): Promise<Rec[]>;
  /** Run a group of writes together (one IndexedDB transaction). */
  batch(fn: () => Promise<void>): Promise<void>;
  registry(): Promise<ImportRecord[]>;
  setRegistry(r: ImportRecord[]): Promise<void>;
  uid(): string;
}

export interface ImportCounts { notes: number; folders: number; attachments: number; cards: number; reviews: number; merged: number; skipped: number; renamed: number }
export interface ImportRecord {
  id: string;
  source: ImportSourceKind;
  name: string;
  at: number;
  spaceId: string;
  counts: ImportCounts;
  /** Notes that existed before and received imported text: their previous state, restored on undo. */
  merged: { id: string; body: string; tags: string[] }[];
  /** First imported note (the result's "Open" button). */
  firstNoteId?: string;
  /** Folder that holds the import (when a root folder was created). */
  folderId?: string | null;
  undone?: boolean;
}

export interface WriteOptions {
  spaceId: string;
  folderId: string | null;
  /** Put everything in a new folder with this name ("" = straight into the target folder). */
  rootFolder?: string;
  /** Note keys to import (undefined = all). */
  selected?: Set<string>;
  /** Per-note conflict choice (note key → action); others use `conflict`. */
  conflicts?: Record<string, ConflictAction>;
  conflict?: ConflictAction;
  now?: number;
  onProgress?: Progress;
  signal?: AbortSignal;
}

export interface Conflict { key: string; title: string; existingId: string }
const tkey = (t: string) => t.trim().toLowerCase();
/** Imported notes whose title already exists in the target space (links resolve by title, so any folder counts). */
export function findConflicts(plan: ImportPlan, existing: Pick<Note, "id" | "title" | "deleted">[], selected?: Set<string>): Conflict[] {
  const have = new Map(existing.filter((n) => !n.deleted).map((n) => [tkey(n.title), n.id]));
  return plan.notes.filter((n) => (!selected || selected.has(n.key)) && have.has(tkey(n.title))).map((n) => ({ key: n.key, title: n.title, existingId: have.get(tkey(n.title))! }));
}

const isMd = (t: NoteType) => !["canvas", "whiteboard", "diagram"].includes(t);
const KNOWN = new Set(["title", "tags", "tag", "type", "status", "created", "slug"]);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const withoutFmAndH1 = (body: string) => splitFrontMatter(body).body.replace(/^\s*#\s+[^\n]*\n+/, "");

export async function writePlan(plan: ImportPlan, o: WriteOptions, store: ImportStore): Promise<ImportRecord> {
  const now = o.now ?? Date.now();
  const id = store.uid();
  const counts: ImportCounts = { notes: 0, folders: 0, attachments: 0, cards: 0, reviews: 0, merged: 0, skipped: 0, renamed: 0 };
  const rec: ImportRecord = { id, source: plan.source, name: plan.name, at: now, spaceId: o.spaceId, counts, merged: [] };
  const tag = { lumenImport: id };
  const existing = (await store.notesIn(o.spaceId)).filter((n) => !n.deleted);
  const byTitle = new Map(existing.map((n) => [tkey(n.title), n]));
  const used = new Set(byTitle.keys());
  const chosen = plan.notes.filter((n) => !o.selected || o.selected.has(n.key));

  // 1. conflicts: skip / rename / merge
  const renames = new Map<string, string>();
  const todo: { n: PlanNote; title: string; body: string; mergeInto?: Note }[] = [];
  for (const n of chosen) {
    const hit = byTitle.get(tkey(n.title));
    let title = n.title, body = n.body;
    if (hit) {
      const act = o.conflicts?.[n.key] ?? o.conflict ?? "rename";
      if (act === "skip") { counts.skipped++; continue; }
      if (act === "merge" && isMd(hit.type) && isMd(n.type)) { todo.push({ n, title: hit.title, body, mergeInto: hit }); continue; }
      let i = 2;
      while (used.has(tkey(`${n.title} ${i}`))) i++;
      title = `${n.title} ${i}`;
      renames.set(n.title, title);
      counts.renamed++;
      if (isMd(n.type)) body = body.replace(/^(#\s+).*$/m, `$1${title}`);
    }
    used.add(tkey(title));
    todo.push({ n, title, body });
  }
  // links to renamed notes follow them
  if (renames.size) {
    for (const t of todo) {
      if (!isMd(t.n.type)) continue;
      for (const [from, to] of renames) t.body = t.body.replace(new RegExp(`\\[\\[${esc(from)}(?=[\\]|#])`, "gi"), `[[${to}`);
    }
  }

  // 2. folders (reuse same-name folders under the same parent; created ones are tagged)
  const folders = (await store.foldersIn(o.spaceId)).filter((f) => !f.deleted);
  const fById = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (fid: string | null): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (let f = fid ? fById.get(fid) : undefined; f && !seen.has(f.id); f = f.parentId ? fById.get(f.parentId) : undefined) { seen.add(f.id); out.unshift(f.name); }
    return out;
  };
  const newFolders: Folder[] = [];
  const ensureChild = (parent: string | null, name: string, fresh = false): string => {
    const hit = !fresh && folders.find((f) => f.parentId === parent && f.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    const f = { id: store.uid(), spaceId: o.spaceId, name, parentId: parent, color: null, sort: now + newFolders.length, updatedAt: now, deleted: 0 as const, ...tag } as Folder;
    folders.push(f); fById.set(f.id, f); newFolders.push(f);
    return f.id;
  };
  let base = o.folderId;
  if (o.rootFolder?.trim()) {
    let name = o.rootFolder.trim(), i = 2;
    while (folders.some((f) => f.parentId === base && f.name.toLowerCase() === name.toLowerCase())) name = `${o.rootFolder.trim()} ${i++}`;
    base = ensureChild(base, name, true);
    rec.folderId = base;
  }
  const cache = new Map<string, string | null>([["", base]]);
  const ensurePath = (parts: string[]): string | null => {
    const k = parts.join("/");
    if (cache.has(k)) return cache.get(k)!;
    const id2 = ensureChild(ensurePath(parts.slice(0, -1)), parts[parts.length - 1]);
    cache.set(k, id2);
    return id2;
  };
  for (const t of todo) if (!t.mergeInto) ensurePath(t.n.folder);
  for (const p of plan.folders) { const parts = p.split("/").filter(Boolean); if (todo.some((t) => t.n.folder.join("/") === p || t.n.folder.join("/").startsWith(p + "/") || (t.n.type === "base" && t.body.includes(`@@FOLDER:${p}@@`)))) ensurePath(parts); }
  const absPath = (rel: string) => [...pathOf(base), ...rel.split("/").filter(Boolean)].join("/");

  // 3. attachments used by the chosen notes
  const refs = new Set<string>();
  for (const t of todo) for (const m of t.body.matchAll(ATT_REF)) refs.add(m[1]);
  const attId = new Map<string, string>();
  const total = refs.size + todo.length + plan.cards.length + plan.reviews.length + newFolders.length;
  let done = 0;
  // Inside a batch (IndexedDB transaction) nothing but database work may be awaited, so progress only counts there;
  // `flush` reports and yields to the UI between batches.
  let cur = "";
  const tick = (c: string) => { done++; cur = c; };
  const flush = async () => { o.onProgress?.(done, total, cur); await yieldUI(); };
  o.onProgress?.(0, total, "");
  await store.batch(async () => { for (const f of newFolders) { await store.put("folder", f as unknown as Rec); counts.folders++; tick(f.name); } });
  await flush();
  for (const ref of refs) {
    if (o.signal?.aborted) break;
    const a = plan.attachments.get(ref);
    if (!a) continue;
    const bytes = await a.bytes();
    const aid = store.uid();
    await store.putBlob(aid, bytes, a.mime);
    await store.put("attachment", { id: aid, name: a.name, mime: a.mime, size: bytes.length, updatedAt: now, deleted: 0, ...tag });
    attId.set(ref, aid);
    counts.attachments++;
    tick(a.name);
    if (done % 20 === 0) await flush();
  }
  const fill = (body: string) => body.replace(ATT_REF, (m, ref: string) => (attId.has(ref) ? `att:${attId.get(ref)}` : m)).replace(FOLDER_REF, (_m, rel: string) => absPath(rel));

  // 4. notes
  const noteId = new Map<string, string>();
  for (let i = 0; i < todo.length; i += 100) {
    if (o.signal?.aborted) break;
    const chunk = todo.slice(i, i + 100);
    await store.batch(async () => {
      for (const t of chunk) {
        const body = fill(t.body);
        if (t.mergeInto) {
          const old = t.mergeInto;
          rec.merged.push({ id: old.id, body: old.body, tags: old.tags });
          const merged = old.body.trimEnd() + "\n\n" + withoutFmAndH1(body).trim() + "\n";
          await store.put("note", { ...old, body: merged, tags: [...new Set([...old.tags, ...tagsOf(t.n, body)])] } as unknown as Rec);
          noteId.set(t.n.key, old.id);
          counts.merged++;
        } else {
          const fm = isMd(t.n.type) ? splitFrontMatter(body).data : {};
          const type = (NOTE_TYPES as string[]).includes(fm.type) ? (fm.type as NoteType) : t.n.type;
          const status = (STATUSES as string[]).includes(fm.status) ? (fm.status as Status) : null;
          const props = { ...Object.fromEntries(Object.entries(fm).filter(([k]) => !KNOWN.has(k))), ...t.n.props };
          const created = fm.created ? Date.parse(fm.created) : NaN;
          const n: Note = {
            id: store.uid(), title: t.title, body, spaceId: o.spaceId, folderId: ensurePath(t.n.folder), tags: tagsOf(t.n, body), type, status,
            pinned: 0, favorite: 0, published: 0, slug: "", props, createdAt: Number.isFinite(created) ? created : t.n.createdAt ?? now, updatedAt: now, deleted: 0,
          };
          await store.put("note", { ...n, ...tag } as unknown as Rec);
          noteId.set(t.n.key, n.id);
          rec.firstNoteId ??= n.id;
          counts.notes++;
        }
        tick(t.title);
      }
    });
    await flush();
  }
  // 5. schedules and review log
  for (let i = 0; i < plan.cards.length; i += 300) {
    if (o.signal?.aborted) break;
    const chunk = plan.cards.slice(i, i + 300);
    await store.batch(async () => {
      for (const c of chunk) {
        const nid = noteId.get(c.noteKey);
        if (!nid) { tick(""); continue; }
        const cid = `${nid}:${c.cardKey}`;
        if (await store.get("card", cid)) { tick(""); continue; } // merged into a note that already schedules this card
        const { noteKey: _a, cardKey: _b, ...state } = c;
        await store.put("card", { id: cid, noteId: nid, ...state, updatedAt: now, deleted: 0, ...tag });
        counts.cards++;
        tick(cid);
      }
    });
    await flush();
  }
  for (let i = 0; i < plan.reviews.length; i += 500) {
    if (o.signal?.aborted) break;
    const chunk = plan.reviews.slice(i, i + 500);
    await store.batch(async () => {
      for (const r of chunk) {
        const nid = noteId.get(r.noteKey);
        if (!nid) continue;
        const { noteKey: _a, cardKey, ...row } = r;
        await store.put("review", { id: store.uid(), cardId: `${nid}:${cardKey}`, noteId: nid, ...row, updatedAt: now, deleted: 0, ...tag });
        counts.reviews++;
      }
    });
    done += chunk.length;
    o.onProgress?.(done, total, "review history");
    await yieldUI();
  }
  o.onProgress?.(total, total, "");
  const reg = await store.registry();
  await store.setRegistry([rec, ...reg.filter((r) => r.id !== id)].slice(0, 30));
  return rec;
}

function tagsOf(n: PlanNote, body: string): string[] {
  if (!isMd(n.type)) return n.tags;
  const { data, body: text } = splitFrontMatter(body);
  return [...new Set([...n.tags, ...fmList(data.tags ?? data.tag), ...inlineTags(text)])];
}

/** Undo one import: tombstone everything it created, restore merged notes. Returns how many records were removed. */
export async function undoImport(importId: string, store: ImportStore, onProgress?: Progress): Promise<number> {
  const reg = await store.registry();
  const rec = reg.find((r) => r.id === importId);
  let removed = 0;
  const kinds: Kind[] = ["review", "card", "note", "attachment", "folder"];
  for (const kind of kinds) {
    const list = (await store.tagged(kind, importId)).filter((r) => !r.deleted);
    for (let i = 0; i < list.length; i += 300) {
      const chunk = list.slice(i, i + 300);
      await store.batch(async () => {
        for (const r of chunk) { await store.put(kind, { ...r, deleted: 1 }); removed++; }
      });
      if (kind === "attachment") for (const r of chunk) await store.deleteBlob(r.id);
      onProgress?.(removed, removed + list.length - i - chunk.length, kind);
      await yieldUI();
    }
  }
  for (const m of rec?.merged ?? []) {
    const cur = await store.get("note", m.id);
    if (cur) await store.put("note", { ...cur, body: m.body, tags: m.tags });
  }
  if (rec) await store.setRegistry(reg.map((r) => (r.id === importId ? { ...r, undone: true } : r)));
  return removed;
}

/** Counts shown in the preview for the chosen notes. */
export function planCounts(plan: ImportPlan, selected?: Set<string>) {
  const keys = new Set(plan.notes.filter((n) => !selected || selected.has(n.key)).map((n) => n.key));
  const refs = new Set<string>();
  let flash = 0, bases = 0, canvases = 0;
  for (const n of plan.notes) {
    if (!keys.has(n.key)) continue;
    for (const m of n.body.matchAll(ATT_REF)) refs.add(m[1]);
    if (n.type === "base") bases++;
    if (n.type === "canvas" || n.type === "whiteboard") canvases++;
    flash += n.cards && n.type === "flashcards" ? n.cards : 0;
  }
  return {
    notes: keys.size, attachments: refs.size, cards: flash, bases, canvases,
    schedules: plan.cards.filter((c) => keys.has(c.noteKey)).length,
    reviews: plan.reviews.filter((r) => keys.has(r.noteKey)).length,
  };
}
