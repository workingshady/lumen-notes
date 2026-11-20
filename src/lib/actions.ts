import type { Folder, Note, Space, Version } from "../../shared/types";
import { db, newFolder, newNote, newSpace, now, patch, save, uid } from "./db";
import { NOTE_TYPES, STATUSES, type NoteType, type Status } from "../../shared/types";
import { firstH1, fmList, inlineTags, setFrontMatter, slugify, splitFrontMatter } from "./parse";
import { TEMPLATES, type Template } from "./templates";
import { versionsToPrune } from "./sync-plan";
import { activityHint, activityQuiet, activityVersion, purgeActivity, thisDevice } from "./activity";

export async function createNote(p: Partial<Note> & { template?: string; fm?: Record<string, string> } = {}) {
  const { template, fm, ...rest } = p;
  const t: Template | undefined = TEMPLATES.find((x) => x.id === (template ?? "blank"));
  const base = newNote({ type: t?.type ?? "note", status: t?.status ?? null, title: t?.title ?? "Untitled", body: t?.body ?? "", ...rest });
  // Markdown notes carry their title as `# H1` and type/status/tags in front-matter (design: ScreenWorkspace).
  const md = !["canvas", "whiteboard", "board", "roadmap", "diagram"].includes(base.type);
  const n0 = md && rest.body === undefined ? { ...base, body: withMeta(`# ${base.title}\n\n${base.body}`, base) } : base;
  const n = fm ? { ...n0, body: setFrontMatter(n0.body, fm) } : n0;
  await save("note", n);
  return n;
}

/** Update a note's body/title; derives tags from #inline tags + front-matter + manual tags. */
/** Write type/status/tags into the body's front-matter (only keys the note uses). */
function withMeta(body: string, n: Pick<Note, "type" | "status" | "tags">) {
  return setFrontMatter(body, { type: n.type === "note" ? null : n.type, status: n.status ?? null, tags: n.tags.filter((t) => !inlineTags(splitFrontMatter(body).body).includes(t)) });
}
const isMarkdown = (t: NoteType) => !["canvas", "whiteboard", "board", "diagram"].includes(t);

/** opts.keepTime: an automatic conversion (not a user edit) keeps the note's "updated" time. */
export async function updateNote(id: string, changes: Partial<Note>, opts: { keepTime?: boolean } = {}) {
  const old = await db.notes.get(id);
  if (!old) return;
  const next = { ...old, ...changes };
  if (changes.body !== undefined && isMarkdown(next.type)) {
    // body → record: front-matter keys and the first H1 win
    const fm = splitFrontMatter(next.body).data;
    if (fm.type && (NOTE_TYPES as string[]).includes(fm.type)) next.type = fm.type as NoteType;
    if ("status" in fm) next.status = (STATUSES as string[]).includes(fm.status) ? (fm.status as Status) : null;
    const h1 = firstH1(next.body);
    if (h1) next.title = h1;
    next.tags = [...new Set([...fmList(fm.tags), ...inlineTags(splitFrontMatter(next.body).body)])];
  } else if (isMarkdown(next.type) && (changes.type !== undefined || changes.status !== undefined || changes.tags !== undefined || changes.title !== undefined)) {
    // record → body: keep the front-matter and H1 in sync when changed from the UI
    let body = splitFrontMatter(old.body).data && Object.keys(splitFrontMatter(old.body).data).length || changes.type !== undefined || changes.status !== undefined || changes.tags !== undefined ? withMeta(old.body, next) : old.body;
    if (changes.title !== undefined && firstH1(old.body)) body = body.replace(/^#\s+.+$/m, `# ${next.title}`);
    next.body = body;
  }
  if (next.published && !next.slug) next.slug = slugify(next.title);
  if (opts.keepTime) activityQuiet(id); // automatic conversion: not something the user did
  await save("note", next);
  if (opts.keepTime) await db.notes.update(id, { updatedAt: old.updatedAt });
  maybeSnapshot(next);
  // Diagrams auto-save (only when on in Settings › Diagrams; loaded lazily to keep actions free of that module).
  if (changes.body !== undefined && isMarkdown(next.type) && /```\s*mermaid/i.test(next.body)) void import("./diagram-autosave").then((m) => m.scheduleDiagramAutoSave(id));
}

export const trashNote = (id: string) => patch("note", id, { deleted: 1 });
export const restoreNote = (id: string) => patch("note", id, { deleted: 0 });
export async function purgeNote(id: string) {
  // Tombstone stays (deleted: 1) so other devices learn about it; just clear the content.
  await patch("note", id, { deleted: 1, body: "", title: "(deleted)" });
  await purgeActivity(id);
  for (const v of await db.versions.where("noteId").equals(id).toArray()) await save("version", { ...v, deleted: 1, body: "" });
}

export async function duplicateNote(id: string) {
  const n = await db.notes.get(id);
  if (!n) return;
  const id2 = uid();
  activityHint(id2, { action: "duplicated", from: n.title });
  return createNote({ ...n, id: id2, title: `${n.title} (copy)`, published: 0, slug: "", createdAt: now(), pinned: 0 });
}

export async function findOrCreateByTitle(title: string, spaceId: string) {
  const low = title.trim().toLowerCase();
  const hit = (await db.notes.toArray()).find((n) => !n.deleted && n.title.toLowerCase() === low);
  return hit ?? createNote({ title: title.trim(), spaceId });
}

export async function dailyNote(spaceId: string) {
  const d = new Date();
  const title = `Journal ${d.toISOString().slice(0, 10)}`;
  const hit = (await db.notes.where("type").equals("journal").toArray()).find((n) => !n.deleted && n.title === title);
  return hit ?? createNote({ template: "journal", title, spaceId });
}

// ------------------------------------------------------------------ versions
const lastSnap = new Map<string, number>();
const SNAP_EVERY = 2 * 60_000;
const trailing = new Map<string, ReturnType<typeof setTimeout>>();
/** Auto-snapshot: at most one per note every 2 min, only if the body changed since the last version. Edits inside the
 *  2 min get one trailing snapshot when it ends, so the end of a writing session is always a version (the activity
 *  log's "Restore to here" points at it). */
async function maybeSnapshot(n: Note) {
  const t = now();
  const wait = SNAP_EVERY - (t - (lastSnap.get(n.id) ?? 0));
  if (wait > 0) {
    if (!trailing.has(n.id)) trailing.set(n.id, setTimeout(() => {
      trailing.delete(n.id);
      void db.notes.get(n.id).then((cur) => { if (cur && !cur.deleted) return maybeSnapshot(cur); });
    }, wait + 50));
    return;
  }
  lastSnap.set(n.id, t);
  // No-op guard: the newest live version (retention tombstones have an empty body) already holds this body.
  const last = (await db.versions.where("noteId").equals(n.id).filter((v) => !v.deleted).sortBy("createdAt")).pop();
  if (last && last.body === n.body) return;
  await snapshot(n, "");
}

/**
 * Version retention (run by sync.ts after a good round, at most every 6 h): all versions from the last 24 h, then the
 * newest per hour for 7 days, per day for 90 days, per week after that; named versions and each note's newest stay.
 * Pruned versions become tombstones (deleted: 1, empty body) so every device and D1 drop the bodies too.
 * One note at a time, so a vault with big board histories never loads every body at once.
 */
export async function pruneVersions(at = now()): Promise<number> {
  let n = 0;
  for (const noteId of (await db.versions.orderBy("noteId").uniqueKeys()) as string[]) {
    const vs = await db.versions.where("noteId").equals(noteId).toArray();
    const drop = new Set(versionsToPrune(vs, at));
    for (const v of vs) if (drop.has(v.id)) { await save("version", { ...v, deleted: 1, body: "" }); n++; }
  }
  return n;
}
export async function snapshot(n: Note, label: string) {
  const v: Version = { id: uid(), noteId: n.id, title: n.title, body: n.body, label, createdAt: now(), updatedAt: now(), deleted: 0, device: thisDevice() };
  await save("version", v);
  if (!/^(Restored|Before)/.test(label)) activityVersion(n.id, v.id, v.createdAt); // restore bookkeeping versions aren't "the end of an edit"
  return v;
}
export { thisDevice };
/** Confluence-style: restoring creates a new current version; nothing is lost. */
export async function restoreVersion(v: Version) {
  const n = await db.notes.get(v.noteId);
  if (!n) return;
  await snapshot(n, "Before restore");
  activityHint(n.id, { action: "reverted", ver: v.id, from: String(v.createdAt) });
  await save("note", { ...n, title: v.title, body: v.body });
  await snapshot({ ...n, title: v.title, body: v.body }, `Restored ${new Date(v.createdAt).toLocaleString()}`);
}

// ------------------------------------------------------------------ spaces & folders
export async function createSpace(p: Partial<Space>) {
  const s = newSpace(p);
  await save("space", s);
  if (s.kind === "course") {
    const rm = await createNote({ template: "roadmap", title: `${s.name} roadmap`, spaceId: s.id, ...(p.props?.roadmap ? { body: p.props.roadmap } : {}) });
    await patch("space", s.id, { roadmapId: rm.id, props: { ...s.props, roadmap: "" } });
  }
  return s;
}
export async function createFolder(spaceId: string, parentId: string | null, name = "New folder") {
  const f = newFolder({ spaceId, parentId, name });
  await save("folder", f);
  return f;
}
/** Delete a folder: its notes move to the parent (never silently deleted), subfolders too. */
export async function deleteFolder(f: Folder) {
  for (const n of await db.notes.where("folderId").equals(f.id).toArray()) await save("note", { ...n, folderId: f.parentId });
  for (const c of await db.folders.where("parentId").equals(f.id).toArray()) await save("folder", { ...c, parentId: f.parentId });
  await save("folder", { ...f, deleted: 1 });
}
/** Move a folder (and everything under it) to another space/parent. */
export async function moveFolder(f: Folder, spaceId: string, parentId: string | null) {
  if (parentId === f.id) return;
  const all = await db.folders.toArray();
  // refuse moving into own descendant
  const seen = new Set<string>();
  for (let p = parentId ? all.find((x) => x.id === parentId) : undefined; p && !seen.has(p.id); p = p.parentId ? all.find((x) => x.id === p!.parentId) : undefined) { if (p.id === f.id) return; seen.add(p.id); }
  const stack = [f.id];
  while (stack.length) {
    const id = stack.pop()!;
    for (const n of await db.notes.where("folderId").equals(id).toArray()) if (n.spaceId !== spaceId) await save("note", { ...n, spaceId });
    for (const c of all.filter((x) => x.parentId === id && !x.deleted)) { stack.push(c.id); if (c.spaceId !== spaceId) await save("folder", { ...c, spaceId }); }
  }
  await save("folder", { ...f, spaceId, parentId });
}
export const moveNote = (id: string, spaceId: string, folderId: string | null) => patch("note", id, { spaceId, folderId });
