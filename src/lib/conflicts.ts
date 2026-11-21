// Sync conflicts for markdown notes (design 58E). When a pulled note would overwrite local edits that were never pushed,
// sync.ts apply() calls noteConflict(). Both versions are kept in a conflict record (device-local `meta`), the pulled one
// is applied as before (last write wins, nothing blocks sync) and the other one is saved to the note's History, so the
// Sync conflict screen can later put back "mine", keep "theirs", keep "both" or merge block by block.
import { useLiveQuery } from "dexie-react-hooks";
import type { Note } from "../../shared/types";
import { thisDevice } from "./activity";
import { overwritesLocal, resolvedText, type ConflictRec, type Resolution, type Side } from "./conflicts-core";
import { db, getMeta, now, save, setMeta, uid } from "./db";
import { t } from "./i18n";
import { toast } from "./store";
import { getSettings } from "./settings";

export * from "./conflicts-core";
const KEY = "conflicts";

/** Notes with a conflict queued in this session, so the older "Kept newer version" toast (ws-conflict.tsx) stays quiet. */
const pending = new Set<string>();
export const isConflicted = (noteId: string) => pending.has(noteId);
const queue = new Map<string, { mine: Side; theirs: Side }>();

type Pulled = { data?: unknown; updatedAt: number; deleted?: 0 | 1 };
type Local = Note & { dirty?: 0 | 1 };
/**
 * The hook for sync.ts apply(): `local` is the stored row, `incoming` the pulled item. Returns true (and queues the
 * record) when the pull would overwrite unpushed local edits of a markdown note with different text. Synchronous: it runs
 * inside the apply transaction, so the record itself is written a moment later.
 */
export function noteConflict(local: Local, incoming: Pulled): boolean {
  if (!overwritesLocal(local, incoming as Parameters<typeof overwritesLocal>[1])) return false;
  const d = incoming.data as Note & { lumenDeviceName?: string };
  if (getSettings().conflictPolicy === "newest") { // Settings › Sync › Advanced: newest wins, the overwritten text stays in History, no prompt
    pending.add(local.id);
    void save("version", { id: uid(), noteId: local.id, title: local.title, body: local.body, label: `Other version · ${thisDevice()}`, createdAt: now(), updatedAt: now(), deleted: 0 });
    return true;
  }
  queue.set(local.id, {
    mine: { title: local.title, body: local.body, at: local.updatedAt, device: thisDevice() },
    theirs: { title: d.title, body: d.body, at: incoming.updatedAt, device: d.lumenDeviceName || "another device" },
  });
  pending.add(local.id);
  setTimeout(() => void flush(), 0);
  return true;
}

let flushing: Promise<void> | null = null;
async function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    while (queue.size) {
      const [noteId, c] = queue.entries().next().value as [string, { mine: Side; theirs: Side }];
      queue.delete(noteId);
      const all = await listConflicts();
      const old = all.find((x) => x.noteId === noteId);
      const rec: ConflictRec = { id: old?.id ?? uid(), noteId, mine: old?.mine ?? c.mine, theirs: c.theirs, at: now() };
      if (!old) await save("version", { id: uid(), noteId, title: rec.mine.title, body: rec.mine.body, label: `Other version · ${rec.mine.device}`, createdAt: now(), updatedAt: now(), deleted: 0 });
      await setMeta(KEY, [rec, ...all.filter((x) => x.noteId !== noteId)]);
      if (!old) toast(t("Sync conflict"), { label: t("Resolve"), run: () => openConflict(rec.id) }, { icon: "merge", sub: t("{title}: edited on two devices", { title: c.theirs.title }), ms: 12000, actionStyle: "link" });
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

export const listConflicts = () => getMeta<ConflictRec[]>(KEY, []);
export const useConflicts = (): ConflictRec[] => useLiveQuery(listConflicts, []) ?? [];

// ------------------------------------------------------------------ open the screen
const subs = new Set<(id: string | null) => void>();
let openId: string | null = null;
export function openConflict(id: string | null) { openId = id; subs.forEach((f) => f(id)); }
export const currentConflict = () => openId;
export function onOpenConflict(f: (id: string | null) => void) { subs.add(f); return () => { subs.delete(f); }; }

/** Apply a resolution and clear the record. Both texts stay in the note's History (the losing one was saved when the conflict was found). */
export async function resolve(id: string, r: Resolution): Promise<boolean> {
  const all = await listConflicts();
  const c = all.find((x) => x.id === id);
  if (!c) return false;
  const note = await db.notes.get(c.noteId);
  const next = resolvedText(c, r);
  if (note && (note.body !== next.body || note.title !== next.title)) {
    await save("version", { id: uid(), noteId: note.id, title: note.title, body: note.body, label: "Before resolving a conflict", createdAt: now(), updatedAt: now(), deleted: 0 });
    await (await import("./actions")).updateNote(note.id, next); // lazy: actions <-> sync cycle
  }
  await setMeta(KEY, all.filter((x) => x.id !== id));
  pending.delete(c.noteId);
  if (openId === id) openConflict(null);
  return true;
}
