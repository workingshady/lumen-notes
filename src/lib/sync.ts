import { useSyncExternalStore } from "react";
import type { Kind, SyncItem, SyncResponse } from "../../shared/types";
import { KINDS } from "../../shared/types";
import { api, getToken } from "./api";
import { DEMO } from "./db";
import { db, getMeta, onDirty, setMeta, TABLE } from "./db";
import { uploadPending } from "./attachments";
import { onFaults, simSync } from "./sim/faults";

export type SyncState = { status: "local" | "idle" | "syncing" | "offline" | "error"; last: number; pending: number; error?: string };
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
    await uploadPending().catch(() => {}); // attachment bytes first, so synced notes never point at missing files
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
    let first = true;
    for (;;) {
      const res = await api<SyncResponse & { more: boolean }>("/sync", { method: "POST", json: { since, items: first ? items : [] } });
      if (first) {
        // Clear dirty flags on records that weren't edited again while the request was in flight.
        await db.transaction("rw", KINDS.map((k) => TABLE[k]), async () => {
          for (const s of sent) {
            const cur = await TABLE[s.kind].get(s.id);
            if (cur && cur.updatedAt === s.updatedAt) await TABLE[s.kind].update(s.id, { dirty: 0 });
          }
        });
        first = false;
      }
      await apply(res.items);
      since = res.cursor;
      await setMeta("cursor", since);
      if (!res.more) break;
    }
    set({ status: "idle", last: Date.now(), pending: await countDirty() });
  } catch (e) {
    set({ status: navigator.onLine ? "error" : "offline", error: (e as Error).message, pending: await countDirty() });
  }
}

/** Last-write-wins: remote replaces local unless local has a newer unsynced edit. */
async function apply(items: SyncItem[]) {
  if (!items.length) return;
  await db.transaction("rw", KINDS.map((k) => TABLE[k]), async () => {
    for (const it of items) {
      const t = TABLE[it.kind];
      if (!t) continue;
      const cur = await t.get(it.id);
      if (cur?.dirty && cur.updatedAt > it.updatedAt) continue;
      await t.put({ ...(it.data as object), id: it.id, updatedAt: it.updatedAt, deleted: it.deleted, dirty: 0 });
    }
  });
}

export function startSync() {
  if (DEMO) onFaults(() => { running = null; void syncNow(); });
  onDirty(() => void syncNow());
  window.addEventListener("online", () => void syncNow());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void syncNow(); });
  setInterval(() => void syncNow(), 60_000);
  void syncNow();
}
