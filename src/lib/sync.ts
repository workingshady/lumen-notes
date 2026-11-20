import { useSyncExternalStore } from "react";
import type { Kind, SyncItem, SyncResponse } from "../../shared/types";
import { KINDS } from "../../shared/types";
import { api, getToken } from "./api";
import { DEMO } from "./db";
import { db, getMeta, onDirty, setMeta, TABLE } from "./db";
import { uploadPending } from "./attachments";
let appOpenedUpload = false;
import { onFaults, simSync } from "./sim/faults";

export type SyncState = { status: "local" | "idle" | "syncing" | "offline" | "error"; last: number; pending: number; error?: string; first?: FirstSync };
/** First sync on a new device (Lumen 22): notes first (readable right away), then flashcards and the rest; files on demand. */
export interface FirstSync { phase: "notes" | "cards"; got: number; total: number; notes: number; startedAt: number }
let state: SyncState = { status: getToken() ? "idle" : "local", last: 0, pending: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<SyncState>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const useSync = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => state);

async function countDirty() {
  let n = 0;
  for (const k of KINDS) n += await TABLE[k].where("dirty").equals(1).count();
  return n;
}

let running: Promise<void> | null = null;
/** Backoff after failed rounds: background triggers (timer, edits) wait until `retryAt`; explicit ones don't. */
let failures = 0, retryAt = 0;
const autoSync = () => { if (Date.now() >= retryAt) void syncNow(); };
export function syncNow() {
  // Demo mode never syncs; the Dev simulator (sim/faults.ts) walks the status machine of the chosen network mode.
  if (DEMO) return (running ??= simSync(set, countDirty).finally(() => (running = null)));
  if (!getToken()) { countDirty().then((pending) => set({ status: "local", pending })); return Promise.resolve(); }
  if (!navigator.onLine) { set({ status: "offline" }); return Promise.resolve(); }
  return (running ??= run().finally(() => (running = null)));
}

async function run() {
  set({ status: "syncing", error: undefined });
  try {
    await uploadPending(!appOpenedUpload).catch(() => {}); // attachment bytes first, so synced notes never point at missing files
    appOpenedUpload = true; // Settings › Sync › Sync files "On open": files go up on the first round after the app opens
    // Gather dirty records.
    const sent: { kind: Kind; id: string; updatedAt: number }[] = [];
    const items: SyncItem[] = [];
    for (const kind of KINDS) {
      for (const r of await TABLE[kind].where("dirty").equals(1).toArray()) {
        const { dirty: _d, ...data } = r;
        items.push({ kind, id: r.id, data, updatedAt: r.updatedAt, deleted: r.deleted ?? 0 });
        sent.push({ kind, id: r.id, updatedAt: r.updatedAt });
      }
    }
    let since = await getMeta<number>("cursor", 0);
    if (since === 0) { since = await firstSync(); await setMeta("cursor", since); }
    let first = true;
    for (;;) {
      const res = await api<SyncResponse & { more: boolean }>("/sync", { method: "POST", json: { since, items: first ? items : [] } });
      if (first) {
        // Clear dirty flags on records that weren't edited again while the request was in flight (bulk, per kind).
        await db.transaction("rw", KINDS.map((k) => TABLE[k]), async () => {
          for (const kind of KINDS) {
            const mine = sent.filter((s) => s.kind === kind);
            if (!mine.length) continue;
            const cur = await TABLE[kind].bulkGet(mine.map((s) => s.id));
            const done = cur.filter((c, i) => c && c.dirty && c.updatedAt === mine[i].updatedAt).map((c) => ({ ...c, dirty: 0 }));
            if (done.length) await TABLE[kind].bulkPut(done);
          }
        });
        first = false;
      }
      await apply(res.items);
      since = res.cursor;
      await setMeta("cursor", since);
      if (!res.more) break;
      await new Promise((r) => setTimeout(r, 0)); // let the page paint between big pages
    }
    await compactTombstones();
    failures = 0; retryAt = 0;
    set({ status: "idle", last: Date.now(), pending: await countDirty() });
  } catch (e) {
    failures++;
    retryAt = Date.now() + Math.min(60_000 * 2 ** (failures - 1), 15 * 60_000); // 1, 2, 4, 8, 15 min
    set({ status: navigator.onLine ? "error" : "offline", error: (e as Error).message, pending: await countDirty(), first: undefined });
  }
}

const FIRST_PHASES: { phase: FirstSync["phase"]; kinds: Kind[] }[] = [
  { phase: "notes", kinds: ["space", "folder", "note"] },
  { phase: "cards", kinds: KINDS.filter((k) => !["space", "folder", "note"].includes(k)) },
];
/** Pull everything kind group by kind group; returns a safe cursor (the normal loop re-reads anything newer). */
async function firstSync(): Promise<number> {
  let total = 0, notes = 0;
  try {
    const u = await api<{ notes?: { count: number }; records?: { byKind?: Record<string, { count: number; deleted: number }> } }>("/usage");
    for (const k of Object.values(u.records?.byKind ?? {})) total += (k.count ?? 0) + (k.deleted ?? 0);
    notes = u.notes?.count ?? 0;
  } catch { /* totals unknown: progress shows counts only */ }
  const startedAt = Date.now();
  let got = 0, cursor = Infinity;
  for (const { phase, kinds } of FIRST_PHASES) {
    let since = 0;
    for (;;) {
      set({ first: { phase, got, total, notes, startedAt } });
      const res = await api<SyncResponse & { more: boolean }>("/sync", { method: "POST", json: { since, items: [], kinds } });
      await apply(res.items);
      got += res.items.length;
      since = res.cursor;
      if (!res.more) break;
      await new Promise((r) => setTimeout(r, 0));
    }
    cursor = Math.min(cursor, since);
  }
  set({ first: undefined });
  return Number.isFinite(cursor) ? cursor : 0;
}

/**
 * Last-write-wins: remote replaces local unless local has a newer unsynced edit.
 * One bulkGet + one bulkPut per kind and page (a page is up to 1500 records): per-record get/put froze the page
 * for 0.2–1.3 s per page on big pulls.
 */
async function apply(items: SyncItem[]) {
  if (!items.length) return;
  await db.transaction("rw", KINDS.map((k) => TABLE[k]), async () => {
    for (const kind of KINDS) {
      const t = TABLE[kind];
      const mine = items.filter((it) => it.kind === kind);
      if (!t || !mine.length) continue;
      const cur = await t.bulkGet(mine.map((it) => it.id));
      const rows = mine
        // Skip: a newer unsynced local edit, or a clean local copy of this exact version (own echo / repeat page:
        // re-putting it would wake every liveQuery and re-render the app for nothing).
        .filter((it, i) => !(cur[i]?.dirty && cur[i].updatedAt > it.updatedAt)
          && !(cur[i] && !cur[i].dirty && cur[i].updatedAt === it.updatedAt && (cur[i].deleted ?? 0) === (it.deleted ?? 0)))
        .map((it) => ({ ...(it.data as object), id: it.id, updatedAt: it.updatedAt, deleted: it.deleted, dirty: 0 }));
      if (rows.length) await t.bulkPut(rows);
    }
  });
}

/**
 * Drop tombstones of notes deleted forever (title "(deleted)", empty body) once the server has them (not dirty),
 * plus their versions. The server keeps the tombstone, so every other device still learns about the deletion; this
 * only stops thousands of empty rows from being re-read on every change. Notes in the Trash are untouched.
 */
async function compactTombstones() {
  const dead = await db.notes.where("deleted").equals(1).filter((n) => !n.dirty && n.title === "(deleted)" && !n.body).primaryKeys();
  if (dead.length < 50) return;
  await db.transaction("rw", [db.notes, db.versions], async () => {
    await db.notes.bulkDelete(dead);
    const vs = await db.versions.where("noteId").anyOf(dead).filter((v) => !v.dirty).primaryKeys();
    if (vs.length) await db.versions.bulkDelete(vs);
  });
}

export function startSync() {
  if (DEMO) onFaults(() => { running = null; void syncNow(); });
  onDirty(autoSync); // edits keep their dirty flag; the timer below pushes them once the backoff ends
  window.addEventListener("online", () => void syncNow());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void syncNow(); });
  // Poll only while visible (becoming visible syncs right away anyway) and not inside a backoff window.
  setInterval(() => { if (document.visibilityState !== "hidden") autoSync(); }, 60_000);
  void syncNow();
}
