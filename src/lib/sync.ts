import { useSyncExternalStore } from "react";
import type { Kind, SyncItem, SyncResponse } from "../../shared/types";
import { KINDS } from "../../shared/types";
import { api, getToken } from "./api";
import { DEMO } from "./db";
import { db, getMeta, onDirty, setMeta, TABLE } from "./db";
import { uploadPending } from "./attachments";
let appOpenedUpload = false;
import { onFaults, simSync } from "./sim/faults";
import { ackedIds, chunkItems, isStuck, MAX_ITEM_BYTES, utf8Size, type StuckItem } from "./sync-plan";

/** `stuck`: records the server refused (too large…): kept dirty on this device, not re-sent until edited again. */
export type SyncState = { status: "local" | "idle" | "syncing" | "offline" | "error"; last: number; pending: number; error?: string; first?: FirstSync; stuck?: StuckItem[] };
export type { StuckItem };
/** First sync on a new device (Lumen 22): notes first (readable right away), then flashcards and the rest; files on demand. */
export interface FirstSync { phase: "notes" | "cards"; got: number; total: number; notes: number; startedAt: number }
let state: SyncState = { status: getToken() ? "idle" : "local", last: 0, pending: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<SyncState>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const useSync = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => state);

async function countDirty() {
  let n = 0;
  for (const k of KINDS) n += await TABLE[k].where("dirty").equals(1).count();
  return Math.max(0, n - (state.stuck?.length ?? 0)); // refused records aren't "queued": they wait for an edit
}

/** /sync response (v2 Worker: per-item results + composite cursor; older Workers send only cursor/items/more). */
type SyncRes = SyncResponse & { more: boolean; cursorKey?: string; accepted?: string[]; rejected?: { kind: string; id: string; reason: StuckItem["reason"]; size?: number }[]; serverNow?: number };
const STUCK_KEY = "syncStuck";

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
    // Gather dirty records, serialised once (the request body is built from these strings). Records the server refused
    // stay dirty but are skipped until edited again; records over the size cap aren't sent at all.
    const prevStuck = new Map((await getMeta<StuckItem[]>(STUCK_KEY, [])).map((x) => [`${x.kind}/${x.id}`, x]));
    const stuck = new Map<string, StuckItem>();
    const out: { key: string; kind: Kind; id: string; updatedAt: number; json: string; size: number }[] = [];
    const now = Date.now();
    for (const kind of KINDS) {
      for (const r of await TABLE[kind].where("dirty").equals(1).toArray()) {
        const key = `${kind}/${r.id}`;
        const prev = prevStuck.get(key);
        if (isStuck(prev, r.updatedAt, now)) { stuck.set(key, prev!); continue; }
        const { dirty: _d, ...data } = r;
        const json = JSON.stringify({ kind, id: r.id, data, updatedAt: r.updatedAt, deleted: r.deleted ?? 0 } satisfies SyncItem);
        const size = utf8Size(json);
        if (size > MAX_ITEM_BYTES + 200) { stuck.set(key, { kind, id: r.id, updatedAt: r.updatedAt, reason: "too_large", size, title: titleOf(r), at: now }); continue; }
        out.push({ key, kind, id: r.id, updatedAt: r.updatedAt, json, size });
      }
    }
    await saveStuck(stuck);
    let since = await getMeta<number>("cursor", 0);
    let sinceKey = await getMeta<string>("cursorKey", "");
    if (since === 0) { since = await firstSync(); sinceKey = ""; await setMeta("cursor", since); await setMeta("cursorKey", ""); }
    // Push in chunks the Worker accepts (it refuses more than 2000 items; D1 work per request is bounded); each answer
    // also carries a pull page, so pulling continues on the same loop once the chunks are sent.
    const chunks = chunkItems(out);
    for (let i = 0; ; i++) {
      const chunk = chunks[i] ?? [];
      const body = `{"v":2,"since":${Number(since)},"sinceKey":${JSON.stringify(sinceKey)},"items":[${chunk.map((x) => x.json).join(",")}]}`;
      const res = await api<SyncRes>("/sync", { method: "POST", body, headers: { "Content-Type": "application/json" } });
      if (chunk.length) {
        await clearAcked(chunk, res);
        if (res.rejected?.length) {
          for (const r of res.rejected) {
            const sent = chunk.find((x) => x.kind === r.kind && x.id === r.id);
            if (sent) stuck.set(sent.key, { kind: r.kind, id: r.id, updatedAt: sent.updatedAt, reason: r.reason, size: r.size ?? sent.size, title: titleOf((JSON.parse(sent.json) as SyncItem).data), at: Date.now() });
          }
          await saveStuck(stuck);
        }
      }
      await apply(res.items);
      since = res.cursor;
      sinceKey = res.cursorKey ?? "";
      await setMeta("cursor", since);
      await setMeta("cursorKey", sinceKey);
      if (i >= chunks.length - 1 && !res.more) break;
      await new Promise((r) => setTimeout(r, 0)); // let the page paint between big pages
    }
    await compactTombstones();
    await pruneVersionsSometimes();
    failures = 0; retryAt = 0;
    set({ status: "idle", last: Date.now(), pending: await countDirty() });
  } catch (e) {
    failures++;
    // 1, 2, 4, 8, 15 min, +-20 % jitter so several devices don't retry in lockstep.
    retryAt = Date.now() + Math.min(60_000 * 2 ** (failures - 1), 15 * 60_000) * (0.8 + Math.random() * 0.4);
    set({ status: navigator.onLine ? "error" : "offline", error: (e as Error).message, pending: await countDirty(), first: undefined });
  }
}

const titleOf = (r: unknown) => {
  const o = (r ?? {}) as { title?: unknown; name?: unknown };
  return String(o.title ?? o.name ?? "").slice(0, 120);
};
async function saveStuck(stuck: Map<string, StuckItem>) {
  const list = [...stuck.values()];
  await setMeta(STUCK_KEY, list);
  set({ stuck: list.length ? list : undefined });
}
/** Load the refused list at start-up so the badge shows before the first round. */
void getMeta<StuckItem[]>(STUCK_KEY, []).then((l) => { if (l.length) set({ stuck: l }); }).catch(() => {});

/**
 * Clear dirty flags only for records the server acknowledged (`accepted`, minus `rejected`), and only where the local
 * row wasn't edited again while the request was in flight (same updatedAt). Everything else stays dirty and is sent
 * again next round: nothing is marked clean that the server never stored.
 */
async function clearAcked(chunk: { key: string; kind: Kind; id: string; updatedAt: number }[], res: SyncRes) {
  const ok = ackedIds(chunk, res.accepted, res.rejected);
  const mine = chunk.filter((x) => ok.has(x.key));
  if (!mine.length) return;
  await db.transaction("rw", KINDS.map((k) => TABLE[k]), async () => {
    for (const kind of KINDS) {
      const list = mine.filter((s) => s.kind === kind);
      if (!list.length) continue;
      const cur = await TABLE[kind].bulkGet(list.map((s) => s.id));
      const done = cur.filter((c, i) => c && c.dirty && c.updatedAt === list[i].updatedAt).map((c) => ({ ...c, dirty: 0 }));
      if (done.length) await TABLE[kind].bulkPut(done);
    }
  });
}

/** Version retention (lib/actions.ts pruneVersions) after a good round, at most every 6 h per device. */
async function pruneVersionsSometimes() {
  const last = await getMeta<number>("versionsPrunedAt", 0);
  if (Date.now() - last < 6 * 3_600_000) return;
  await setMeta("versionsPrunedAt", Date.now());
  try { await (await import("./actions")).pruneVersions(); } catch { /* retention never breaks sync */ }
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
    let since = 0, sinceKey = "";
    for (;;) {
      set({ first: { phase, got, total, notes, startedAt } });
      const res = await api<SyncRes>("/sync", { method: "POST", json: { v: 2, since, sinceKey, items: [], kinds } });
      await apply(res.items);
      got += res.items.length;
      since = res.cursor;
      sinceKey = res.cursorKey ?? "";
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
