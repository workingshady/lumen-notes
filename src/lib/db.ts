import Dexie, { type Table } from "dexie";
import type { AttachmentMeta, Card, Folder, Kind, Note, Session, Space, Version } from "../../shared/types";

export interface AttachmentBlob { id: string; blob: Blob; uploaded: 0 | 1 }
export interface Meta { k: string; v: unknown }

/** Dev/demo mode: a separate local database seeded with the design's sample data; never syncs. */
export const DEMO = (() => { try { return localStorage.getItem("lumen.demo") === "1"; } catch { return false; } })();
export function setDemo(on: boolean) {
  try { on ? localStorage.setItem("lumen.demo", "1") : localStorage.removeItem("lumen.demo"); } catch { /* ignore */ }
  location.href = location.pathname;
}

export class LumenDB extends Dexie {
  spaces!: Table<Space, string>;
  notes!: Table<Note, string>;
  folders!: Table<Folder, string>;
  versions!: Table<Version, string>;
  cards!: Table<Card, string>;
  sessions!: Table<Session, string>;
  attachments!: Table<AttachmentMeta, string>;
  blobs!: Table<AttachmentBlob, string>;
  meta!: Table<Meta, string>;
  constructor() {
    // One local database per server account (main = "lumen"), so two accounts never mix on a device.
    const account = (() => { try { return localStorage.getItem("lumen.account") || "main"; } catch { return "main"; } })();
    super(DEMO ? "lumen-demo" : account === "main" ? "lumen" : `lumen-${account}`);
    this.version(1).stores({
      spaces: "id, kind, sort, dirty, deleted",
      notes: "id, spaceId, folderId, type, status, updatedAt, createdAt, pinned, published, slug, dirty, deleted, *tags",
      folders: "id, spaceId, parentId, dirty, deleted",
      versions: "id, noteId, createdAt, dirty",
      cards: "id, noteId, due, dirty",
      sessions: "id, noteId, at, dirty",
      attachments: "id, dirty",
      blobs: "id, uploaded",
      meta: "k",
    });
  }
}
export const db = new LumenDB();

export const TABLE: Record<Kind, Table<any, string>> = {
  space: db.spaces, note: db.notes, folder: db.folders, version: db.versions, card: db.cards, session: db.sessions, attachment: db.attachments,
};

export async function getMeta<T>(k: string, fallback: T): Promise<T> {
  const r = await db.meta.get(k);
  return (r?.v as T) ?? fallback;
}
export const setMeta = (k: string, v: unknown) => db.meta.put({ k, v });

export const uid = () => crypto.randomUUID();
export const now = () => Date.now();

/** Write a record and mark it for sync. */
export async function save<K extends Kind>(kind: K, rec: { id: string } & Record<string, any>) {
  const r = { ...rec, updatedAt: now(), dirty: 1 as const, deleted: (rec.deleted ?? 0) as 0 | 1 };
  await TABLE[kind].put(r);
  schedulePush();
  return r;
}
export async function patch<K extends Kind>(kind: K, id: string, changes: Record<string, unknown>) {
  const old = await TABLE[kind].get(id);
  if (!old) return;
  return save(kind, { ...old, ...changes });
}

// Sync hook (set by sync.ts) so writes trigger a debounced push without import cycles.
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pushFn: (() => void) | null = null;
export const onDirty = (fn: () => void) => (pushFn = fn);
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushFn?.(), 2500);
}

// ------------------------------------------------------------------ factories
export const DEFAULT_SPACE = "inbox";

export function newNote(p: Partial<Note> = {}): Note {
  const t = now();
  return {
    id: uid(), title: "Untitled", body: "", spaceId: DEFAULT_SPACE, folderId: null, tags: [], type: "note", status: null,
    pinned: 0, favorite: 0, published: 0, slug: "", props: {}, createdAt: t, updatedAt: t, deleted: 0, dirty: 1, ...p,
  };
}
export function newSpace(p: Partial<Space> = {}): Space {
  const t = now();
  return {
    id: uid(), name: "New space", kind: "area", icon: "📁", color: null, description: "", props: {}, roadmapId: null,
    sort: t, archived: 0, createdAt: t, updatedAt: t, deleted: 0, dirty: 1, ...p,
  };
}
export function newFolder(p: Partial<Folder> & { spaceId: string }): Folder {
  return { id: uid(), name: "New folder", parentId: null, color: null, sort: now(), updatedAt: now(), deleted: 0, dirty: 1, ...p };
}

/** Make sure the default Inbox space exists (first run). */
export async function ensureDefaults() {
  if (!(await db.spaces.get(DEFAULT_SPACE))) {
    await db.spaces.put(newSpace({ id: DEFAULT_SPACE, name: "Inbox", kind: "area", icon: "📥", description: "Default space", sort: 0, dirty: 0, updatedAt: 0 }));
  }
}
