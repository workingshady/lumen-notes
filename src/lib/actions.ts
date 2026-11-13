import type { Folder, Note, Space, Version } from "../../shared/types";
import { db, newFolder, newNote, newSpace, now, patch, save, uid } from "./db";
import { inlineTags, slugify } from "./parse";
import { TEMPLATES, type Template } from "./templates";

export async function createNote(p: Partial<Note> & { template?: string } = {}) {
  const { template, ...rest } = p;
  const t: Template | undefined = TEMPLATES.find((x) => x.id === (template ?? "blank"));
  const n = newNote({ type: t?.type ?? "note", status: t?.status ?? null, title: t?.title ?? "Untitled", body: t?.body ?? "", ...rest });
  await save("note", n);
  return n;
}

/** Update a note's body/title; derives tags from #inline tags + front-matter + manual tags. */
export async function updateNote(id: string, changes: Partial<Note>) {
  const old = await db.notes.get(id);
  if (!old) return;
  const next = { ...old, ...changes };
  if (changes.body !== undefined && next.type !== "canvas") {
    const manual = old.tags.filter((t) => !inlineTags(old.body).includes(t));
    next.tags = [...new Set([...manual, ...inlineTags(next.body)])];
  }
  if (next.published && !next.slug) next.slug = slugify(next.title);
  await save("note", next);
  maybeSnapshot(next);
}

export const trashNote = (id: string) => patch("note", id, { deleted: 1 });
export const restoreNote = (id: string) => patch("note", id, { deleted: 0 });
export async function purgeNote(id: string) {
  // Tombstone stays (deleted: 1) so other devices learn about it; just clear the content.
  await patch("note", id, { deleted: 1, body: "", title: "(deleted)" });
  for (const v of await db.versions.where("noteId").equals(id).toArray()) await save("version", { ...v, deleted: 1, body: "" });
}

export async function duplicateNote(id: string) {
  const n = await db.notes.get(id);
  if (!n) return;
  return createNote({ ...n, id: uid(), title: `${n.title} (copy)`, published: 0, slug: "", createdAt: now(), pinned: 0 });
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
/** Auto-snapshot: at most one per note every 2 min, only if the body changed since the last version. */
async function maybeSnapshot(n: Note) {
  const t = now();
  if (t - (lastSnap.get(n.id) ?? 0) < SNAP_EVERY) return;
  lastSnap.set(n.id, t);
  const last = (await db.versions.where("noteId").equals(n.id).sortBy("createdAt")).pop();
  if (last && last.body === n.body && last.title === n.title) return;
  await snapshot(n, "");
}
export async function snapshot(n: Note, label: string) {
  const v: Version = { id: uid(), noteId: n.id, title: n.title, body: n.body, label, createdAt: now(), updatedAt: now(), deleted: 0 };
  await save("version", v);
  return v;
}
/** Confluence-style: restoring creates a new current version; nothing is lost. */
export async function restoreVersion(v: Version) {
  const n = await db.notes.get(v.noteId);
  if (!n) return;
  await snapshot(n, "Before restore");
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
  for (let p = parentId ? all.find((x) => x.id === parentId) : undefined; p; p = p.parentId ? all.find((x) => x.id === p!.parentId) : undefined) if (p.id === f.id) return;
  const stack = [f.id];
  while (stack.length) {
    const id = stack.pop()!;
    for (const n of await db.notes.where("folderId").equals(id).toArray()) if (n.spaceId !== spaceId) await save("note", { ...n, spaceId });
    for (const c of all.filter((x) => x.parentId === id && !x.deleted)) { stack.push(c.id); if (c.spaceId !== spaceId) await save("folder", { ...c, spaceId }); }
  }
  await save("folder", { ...f, spaceId, parentId });
}
export const moveNote = (id: string, spaceId: string, folderId: string | null) => patch("note", id, { spaceId, folderId });
