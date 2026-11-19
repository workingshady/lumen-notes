// Write an ImportPlan as one undoable batch (docs/IMPORT.md). Pure logic over an ImportStore, so tests use an in-memory
// store and the app uses Dexie through save() (import-db.ts).
//
// Every record the import creates (space, notes, folders, attachments, cards, review-log rows, the "Import report" note)
// carries `lumenImport: <id>`. Undo marks them all deleted (tombstones, so other devices drop them too) and restores the
// text of notes that were merged into. The import registry (id, counts, merged notes' previous text) lives in local meta.
import type { Folder, Kind, Note, NoteType, SpaceKind, Status } from "../../shared/types";
import { NOTE_TYPES, STATUSES } from "../../shared/types";
import { fmtDate, t } from "./i18n";
import { ATT_REF, FOLDER_REF, wikiLinks, yieldUI, type ImportPlan, type ImportSourceKind, type PlanNote, type Progress } from "./import-model";
import { fmList, inlineTags, splitFrontMatter } from "./parse";

export type ConflictAction = "skip" | "rename" | "merge";
type Rec = { id: string } & Record<string, unknown>;

export interface ImportStore {
  notesIn(spaceId: string): Promise<Note[]>;
  /** Every note in every space (title conflicts "already in Lumen"). */
  allNotes?(): Promise<Note[]>;
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

export interface ImportCounts {
  notes: number; folders: number; attachments: number; cards: number; reviews: number; merged: number; skipped: number; renamed: number;
  /** Canvases + whiteboards, bases, [[links]] that resolve, flashcards in the imported notes (round 5 result). */
  canvases?: number; bases?: number; links?: number; flashcards?: number;
}
/** How one title that already existed was handled (result step, "Import report"). */
export interface Handled { title: string; action: ConflictAction; to?: string }
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
  /** Titles that already existed and what happened to them. */
  handled?: Handled[];
  /** The plan's warnings (what couldn't come over). */
  warnings?: string[];
  /** The "Import report" note. */
  reportId?: string;
  /** Target space name, and whether the import created it. */
  spaceName?: string;
  newSpace?: boolean;
}

/** Live numbers for the importing step: [done, total] per kind. */
export interface LiveCounts { notes: [number, number]; canvases: [number, number]; attachments: [number, number]; links: [number, number]; current: string }

export interface WriteOptions {
  spaceId: string;
  folderId: string | null;
  /** Put everything in a new folder with this name ("" = straight into the target folder). "a/b" makes nested folders. */
  rootFolder?: string;
  /** Create a new space for the import (its id replaces `spaceId`; undo removes it). */
  newSpace?: { name: string; kind?: SpaceKind; icon?: string };
  /** Name of the target space (for the record when it isn't new). */
  spaceName?: string;
  /** Note keys to import (undefined = all). */
  selected?: Set<string>;
  /** Attachment refs not to import (unticked files in the preview); links to them stay as they are. */
  excludeAttachments?: Set<string>;
  /** Per-note conflict choice (note key → action); others use `conflict`. */
  conflicts?: Record<string, ConflictAction>;
  conflict?: ConflictAction;
  /** Titles conflict with notes in any space ("Same title already in Lumen"), not only the target space. */
  conflictsAcrossSpaces?: boolean;
  /** Write an "Import report" note next to the import. */
  report?: boolean;
  now?: number;
  onProgress?: Progress;
  onCounts?: (c: LiveCounts) => void;
  signal?: AbortSignal;
}

export interface Conflict { key: string; title: string; existingId: string }
const tkey = (s: string) => s.trim().toLowerCase();
/** Imported notes whose title already exists in the target space (links resolve by title, so any folder counts). */
export function findConflicts(plan: ImportPlan, existing: Pick<Note, "id" | "title" | "deleted">[], selected?: Set<string>): Conflict[] {
  const have = new Map(existing.filter((n) => !n.deleted).map((n) => [tkey(n.title), n.id]));
  return plan.notes.filter((n) => (!selected || selected.has(n.key)) && have.has(tkey(n.title))).map((n) => ({ key: n.key, title: n.title, existingId: have.get(tkey(n.title))! }));
}
/** The renamed title: "Title (2)", "Title (3)"… (the first one not in `used`, lowercased titles). */
export function renamedTitle(title: string, used: Set<string>): string {
  let i = 2;
  while (used.has(tkey(`${title} (${i})`))) i++;
  return `${title} (${i})`;
}

const isMd = (type: NoteType) => !["canvas", "whiteboard", "diagram"].includes(type);
const KNOWN = new Set(["title", "tags", "tag", "type", "status", "created", "slug"]);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const withoutFmAndH1 = (body: string) => splitFrontMatter(body).body.replace(/^\s*#\s+[^\n]*\n+/, "");

export async function writePlan(plan: ImportPlan, o: WriteOptions, store: ImportStore): Promise<ImportRecord> {
  const now = o.now ?? Date.now();
  const id = store.uid();
  const counts: ImportCounts = { notes: 0, folders: 0, attachments: 0, cards: 0, reviews: 0, merged: 0, skipped: 0, renamed: 0, canvases: 0, bases: 0, links: 0, flashcards: 0 };
  const tag = { lumenImport: id };
  // 0. a new space (one undo step with the rest)
  let spaceId = o.spaceId;
  if (o.newSpace) {
    spaceId = store.uid();
    await store.put("space", {
      id: spaceId, name: o.newSpace.name, kind: o.newSpace.kind ?? "resource", icon: o.newSpace.icon ?? "glyph:folder", color: null, description: "", props: {},
      roadmapId: null, sort: now, archived: 0, createdAt: now, updatedAt: now, deleted: 0, ...tag,
    });
  }
  const rec: ImportRecord = { id, source: plan.source, name: plan.name, at: now, spaceId, counts, merged: [], handled: [], warnings: [...plan.warnings], spaceName: o.newSpace?.name ?? o.spaceName, newSpace: !!o.newSpace };
  const existing = (o.conflictsAcrossSpaces && store.allNotes ? await store.allNotes() : o.newSpace ? [] : await store.notesIn(spaceId)).filter((n) => !n.deleted);
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
      if (act === "skip") { counts.skipped++; rec.handled!.push({ title: n.title, action: "skip" }); continue; }
      if (act === "merge" && isMd(hit.type) && isMd(n.type)) { todo.push({ n, title: hit.title, body, mergeInto: hit }); rec.handled!.push({ title: n.title, action: "merge" }); continue; }
      title = renamedTitle(n.title, used);
      renames.set(n.title, title);
      counts.renamed++;
      rec.handled!.push({ title: n.title, action: "rename", to: title });
      if (isMd(n.type)) body = body.replace(/^(#\s+).*$/m, `$1${title}`);
    }
    used.add(tkey(title));
    todo.push({ n, title, body });
  }
  // links to renamed notes follow them
  if (renames.size) {
    for (const x of todo) {
      if (!isMd(x.n.type)) continue;
      for (const [from, to] of renames) x.body = x.body.replace(new RegExp(`\\[\\[${esc(from)}(?=[\\]|#])`, "gi"), `[[${to}`);
    }
  }
  // links: total in the chosen notes; resolved = the target is an imported or existing note
  const titles = new Set([...used, ...todo.map((x) => tkey(x.title))]);
  const linkInfo = new Map(todo.map((x) => {
    const ls = isMd(x.n.type) ? wikiLinks(x.body) : [];
    return [x, { total: ls.length, resolved: ls.filter((l) => titles.has(tkey(l.split("/").pop() ?? l))).length }] as const;
  }));
  const isCanvas = (x: { n: PlanNote }) => x.n.type === "canvas" || x.n.type === "whiteboard";
  const live: LiveCounts = {
    notes: [0, todo.length], canvases: [0, todo.filter(isCanvas).length], attachments: [0, 0],
    links: [0, [...linkInfo.values()].reduce((s, v) => s + v.total, 0)], current: "",
  };

  // 2. folders (reuse same-name folders under the same parent; created ones are tagged)
  const folders = (await store.foldersIn(spaceId)).filter((f) => !f.deleted);
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
    const f = { id: store.uid(), spaceId, name, parentId: parent, color: null, sort: now + newFolders.length, updatedAt: now, deleted: 0 as const, ...tag } as Folder;
    folders.push(f); fById.set(f.id, f); newFolders.push(f);
    return f.id;
  };
  let base = o.folderId;
  const rootParts = (o.rootFolder ?? "").split("/").map((s) => s.trim()).filter(Boolean);
  if (rootParts.length) {
    // "Imported / Obsidian 2026-11-19": reuse the parents, the last part is always a new folder
    for (const p of rootParts.slice(0, -1)) base = ensureChild(base, p);
    const last = rootParts[rootParts.length - 1];
    let name = last, i = 2;
    while (folders.some((f) => f.parentId === base && f.name.toLowerCase() === name.toLowerCase())) name = `${last} ${i++}`;
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
  for (const x of todo) if (!x.mergeInto) ensurePath(x.n.folder);
  for (const p of plan.folders) { const parts = p.split("/").filter(Boolean); if (todo.some((x) => x.n.folder.join("/") === p || x.n.folder.join("/").startsWith(p + "/") || (x.n.type === "base" && x.body.includes(`@@FOLDER:${p}@@`)))) ensurePath(parts); }
  const absPath = (rel: string) => [...pathOf(base), ...rel.split("/").filter(Boolean)].join("/");

  // 3. attachments used by the chosen notes (minus the unticked ones)
  const refs = new Set<string>();
  for (const x of todo) for (const m of x.body.matchAll(ATT_REF)) if (!o.excludeAttachments?.has(m[1])) refs.add(m[1]);
  live.attachments[1] = [...refs].filter((r) => plan.attachments.has(r)).length;
  const attId = new Map<string, string>();
  const total = refs.size + todo.length + plan.cards.length + plan.reviews.length + newFolders.length;
  let done = 0;
  // Inside a batch (IndexedDB transaction) nothing but database work may be awaited, so progress only counts there;
  // `flush` reports and yields to the UI between batches.
  let cur = "";
  const tick = (c: string) => { done++; cur = c; };
  const flush = async () => { live.current = cur; o.onProgress?.(done, total, cur); o.onCounts?.({ ...live }); await yieldUI(); };
  o.onProgress?.(0, total, "");
  o.onCounts?.({ ...live });
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
    live.attachments[0]++;
    tick(a.path ?? a.name);
    if (done % 20 === 0) await flush();
  }
  const fill = (body: string) => body.replace(ATT_REF, (m, ref: string) => (attId.has(ref) ? `att:${attId.get(ref)}` : m)).replace(FOLDER_REF, (_m, rel: string) => absPath(rel));

  // 4. notes
  const noteId = new Map<string, string>();
  for (let i = 0; i < todo.length; i += 100) {
    if (o.signal?.aborted) break;
    const chunk = todo.slice(i, i + 100);
    await store.batch(async () => {
      for (const x of chunk) {
        const body = fill(x.body);
        if (x.mergeInto) {
          const old = x.mergeInto;
          rec.merged.push({ id: old.id, body: old.body, tags: old.tags });
          const merged = old.body.trimEnd() + "\n\n" + withoutFmAndH1(body).trim() + "\n";
          await store.put("note", { ...old, body: merged, tags: [...new Set([...old.tags, ...tagsOf(x.n, body)])] } as unknown as Rec);
          noteId.set(x.n.key, old.id);
          counts.merged++;
        } else {
          const fm = isMd(x.n.type) ? splitFrontMatter(body).data : {};
          const type = (NOTE_TYPES as string[]).includes(fm.type) ? (fm.type as NoteType) : x.n.type;
          const status = (STATUSES as string[]).includes(fm.status) ? (fm.status as Status) : null;
          const props = { ...Object.fromEntries(Object.entries(fm).filter(([k]) => !KNOWN.has(k))), ...x.n.props };
          const created = fm.created ? Date.parse(fm.created) : NaN;
          const n: Note = {
            id: store.uid(), title: x.title, body, spaceId, folderId: ensurePath(x.n.folder), tags: tagsOf(x.n, body), type, status,
            pinned: 0, favorite: 0, published: 0, slug: "", props, createdAt: Number.isFinite(created) ? created : x.n.createdAt ?? now, updatedAt: now, deleted: 0,
          };
          await store.put("note", { ...n, ...tag } as unknown as Rec);
          noteId.set(x.n.key, n.id);
          rec.firstNoteId ??= n.id;
          counts.notes++;
          if (type === "base") counts.bases!++;
          if (type === "flashcards") counts.flashcards! += x.n.cards ?? 0;
        }
        if (isCanvas(x)) { counts.canvases!++; live.canvases[0]++; }
        const li = linkInfo.get(x)!;
        counts.links! += li.resolved;
        live.links[0] += li.resolved;
        live.notes[0]++;
        tick([...x.n.folder, x.title].join("/"));
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
    o.onProgress?.(done, total, t("review history"));
    await yieldUI();
  }
  // 6. the "Import report" note (part of the same undo step)
  if (o.report && (counts.notes || counts.merged)) {
    const title = used.has(tkey(t("Import report"))) ? renamedTitle(t("Import report"), used) : t("Import report");
    const n: Note = {
      id: store.uid(), title, body: reportBody(title, rec, plan, now), spaceId, folderId: base, tags: [], type: "note", status: null,
      pinned: 0, favorite: 0, published: 0, slug: "", props: {}, createdAt: now, updatedAt: now, deleted: 0,
    };
    await store.put("note", { ...n, ...tag } as unknown as Rec);
    rec.reportId = n.id;
  }
  o.onProgress?.(total, total, "");
  o.onCounts?.({ ...live });
  const reg = await store.registry();
  await store.setRegistry([rec, ...reg.filter((r) => r.id !== id)].slice(0, 30));
  return rec;
}

/** Markdown of the "Import report" note: counts, titles that already existed, and what couldn't come over. */
export function reportBody(title: string, rec: ImportRecord, plan: Pick<ImportPlan, "name" | "source">, now = rec.at): string {
  const c = rec.counts;
  const lines = [`# ${title}`, "", t("Imported from {name} on {date}.", { name: plan.name, date: fmtDate(now) }), ""];
  const kinds: [number | undefined, string][] = [
    [c.notes, t("{n} note|{n} notes", { n: c.notes })], [c.folders, t("{n} folder|{n} folders", { n: c.folders })],
    [c.attachments, t("{n} attachment|{n} attachments", { n: c.attachments })], [c.canvases, t("{n} canvas|{n} canvases", { n: c.canvases ?? 0 })],
    [c.bases, t("{n} base|{n} bases", { n: c.bases ?? 0 })], [c.flashcards, t("{n} card|{n} cards", { n: c.flashcards ?? 0 })],
    [c.cards, t("{n} schedule|{n} schedules", { n: c.cards })], [c.reviews, t("{n} review|{n} reviews", { n: c.reviews })],
    [c.links, t("{n} link resolved|{n} links resolved", { n: c.links ?? 0 })],
  ];
  for (const [n, s] of kinds) if (n) lines.push(`- ${s}`);
  if (rec.handled?.length) {
    lines.push("", `## ${t("Titles already in Lumen")}`, "");
    for (const h of rec.handled) {
      lines.push(`- ${h.action === "merge" ? t("{title}: merged into the existing note", { title: `[[${h.title}]]` })
        : h.action === "rename" ? t("{title}: imported as {to}", { title: `[[${h.title}]]`, to: `[[${h.to}]]` })
        : t("{title}: skipped (the existing note was kept)", { title: `[[${h.title}]]` })}`);
    }
  }
  if (rec.warnings?.length) {
    lines.push("", `## ${t("Not imported or changed")}`, "");
    for (const w of rec.warnings) lines.push(`- ${w}`);
  }
  return lines.join("\n") + "\n";
}

function tagsOf(n: PlanNote, body: string): string[] {
  if (!isMd(n.type)) return n.tags;
  const { data, body: text } = splitFrontMatter(body);
  return [...new Set([...n.tags, ...fmList(data.tags ?? data.tag), ...inlineTags(text)])];
}

/** Undo one import: tombstone everything it created (its new space too), restore merged notes. Returns how many records were removed. */
export async function undoImport(importId: string, store: ImportStore, onProgress?: Progress): Promise<number> {
  const reg = await store.registry();
  const rec = reg.find((r) => r.id === importId);
  let removed = 0;
  const kinds: Kind[] = ["review", "card", "note", "attachment", "folder", "space"];
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

/** Counts shown in the preview for the chosen notes (and the attachments that aren't unticked). */
export function planCounts(plan: ImportPlan, selected?: Set<string>, excludeAttachments?: Set<string>) {
  const keys = new Set(plan.notes.filter((n) => !selected || selected.has(n.key)).map((n) => n.key));
  const refs = new Set<string>();
  const tags = new Set<string>();
  let flash = 0, bases = 0, canvases = 0, links = 0, bytes = 0;
  for (const n of plan.notes) {
    if (!keys.has(n.key)) continue;
    for (const m of n.body.matchAll(ATT_REF)) if (!excludeAttachments?.has(m[1])) refs.add(m[1]);
    if (n.type === "base") bases++;
    if (n.type === "canvas" || n.type === "whiteboard") canvases++;
    flash += n.cards && n.type === "flashcards" ? n.cards : 0;
    if (isMd(n.type)) {
      links += wikiLinks(n.body).length;
      const { data, body } = splitFrontMatter(n.body);
      for (const x of [...n.tags, ...fmList(data.tags ?? data.tag), ...inlineTags(body)]) tags.add(x.toLowerCase());
    }
  }
  for (const r of refs) bytes += plan.attachments.get(r)?.size ?? 0;
  return {
    notes: keys.size, attachments: refs.size, cards: flash, bases, canvases, links, tags: tags.size, bytes,
    schedules: plan.cards.filter((c) => keys.has(c.noteKey)).length,
    reviews: plan.reviews.filter((r) => keys.has(r.noteKey)).length,
  };
}
