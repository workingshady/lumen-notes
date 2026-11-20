// Two-device merge for whiteboards and Boards (.excalidraw bodies). Pure (no Dexie, no DOM, no Excalidraw import),
// unit-tested by scripts/board-merge.test.ts. Used by the sync apply (src/lib/sync.ts) when a pulled board meets local
// edits the server never saw, and by updateNote (src/lib/actions.ts) to keep deletion tombstones in the stored scene.
//
// Rules (docs/research/r7-backend-review.md, "Design note: per-element board merge"):
// - elements merge by id: a deleted side wins (`isDeleted` tombstone), else higher `version`, tie → lower
//   `versionNonce` (Excalidraw's reconcileElements semantics); result ordered by fractional `index`;
// - tombstones `{id, type, version, versionNonce, isDeleted, updated, index}` stay in the stored scene for 7 days;
// - `files` (image refs) are unioned, kept when some live element still uses them;
// - `lumenBoard` (board settings): the newer note's keys over the older's; `lumenLayers`: union by id, newer order;
//   `lumenPending` (REST skeletons not yet applied): union, minus skeletons whose id is already an element;
// - everything else comes from the newer note. Parse failure or an oversized result → null (caller keeps LWW).
import { ensureIndices } from "../../shared/board-index";
import { MAX_ITEM_BYTES } from "./sync-plan";

export const TOMBSTONE_TTL = 7 * 24 * 3_600_000;

export type BoardEl = Record<string, unknown> & { id: string; type?: string; version?: number; versionNonce?: number; isDeleted?: boolean; updated?: number; index?: string | null; fileId?: string | null };
type Scene = Record<string, unknown> & { elements: BoardEl[]; files?: Record<string, Record<string, unknown>>; lumenBoard?: Record<string, unknown>; lumenLayers?: { list?: { id: string }[]; active?: string }; lumenPending?: unknown[]; appState?: Record<string, unknown> };

export function parseBoard(body: string | null | undefined): Scene | null {
  if (!body) return null;
  try {
    const s = JSON.parse(body) as Scene;
    if (!s || typeof s !== "object" || Array.isArray(s) || !Array.isArray(s.elements)) return null;
    if (!s.elements.every((e) => e && typeof e === "object" && typeof e.id === "string")) return null;
    return s;
  } catch { return null; }
}

/** Which of two copies of one element survives. */
export function pickElement<T extends BoardEl>(a: T, b: T): T {
  const ad = !!a.isDeleted, bd = !!b.isDeleted;
  if (ad !== bd) return ad ? a : b; // deletion wins over a concurrent edit
  const av = a.version ?? 0, bv = b.version ?? 0;
  if (av !== bv) return av > bv ? a : b;
  return (a.versionNonce ?? 0) <= (b.versionNonce ?? 0) ? a : b;
}

/** The small form a deleted element is stored in. */
export const tombstone = (e: BoardEl, now = Date.now()): BoardEl => ({
  id: e.id, type: e.type ?? "rectangle", version: e.version ?? 1, versionNonce: e.versionNonce ?? 0, isDeleted: true,
  updated: typeof e.updated === "number" ? e.updated : now,
}); // no `index`: tombstones are stored first in the array and never take part in z-order
const expired = (e: BoardEl, now: number) => !!e.isDeleted && typeof e.updated === "number" && now - e.updated > TOMBSTONE_TTL;

/** Merge two element lists (either order). Deleted winners are compacted to tombstones; expired ones are dropped. */
export function mergeElements(local: readonly BoardEl[], remote: readonly BoardEl[], now = Date.now()): BoardEl[] {
  const L = ensureIndices(local), R = ensureIndices(remote);
  const won = new Map<string, BoardEl>();
  for (const e of L) won.set(e.id, won.has(e.id) ? pickElement(won.get(e.id)!, e) : e);
  for (const e of R) won.set(e.id, won.has(e.id) ? pickElement(won.get(e.id)!, e) : e);
  const live: BoardEl[] = [], dead: BoardEl[] = [];
  for (const e of won.values()) {
    if (!e.isDeleted) live.push(e);
    else if (!expired(e, now)) dead.push(tombstone(e, now));
  }
  live.sort((a, b) => (a.index! < b.index! ? -1 : a.index! > b.index! ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  dead.sort((a, b) => (a.id < b.id ? -1 : 1));
  return [...dead, ...ensureIndices(live)]; // equal keys from the two sides → strictly increasing again
}

function mergeFiles(older: Scene["files"], newer: Scene["files"], els: BoardEl[]): Scene["files"] | undefined {
  if (!older && !newer) return undefined;
  const used = new Set(els.filter((e) => !e.isDeleted && typeof e.fileId === "string").map((e) => e.fileId as string));
  const out: NonNullable<Scene["files"]> = {};
  for (const src of [older ?? {}, newer ?? {}]) {
    for (const [id, f] of Object.entries(src)) {
      if (!used.has(id) || !f) continue;
      const cur = out[id];
      // Prefer an attachment ref, then inline bytes; otherwise the newer side's entry.
      if (!cur || (f.lumenAtt && !cur.lumenAtt) || (!cur.lumenAtt && f.dataURL && !cur.dataURL) || (!!f.lumenAtt === !!cur.lumenAtt && !!f.dataURL === !!cur.dataURL)) out[id] = f;
    }
  }
  return out;
}

function mergeLayers(older: Scene["lumenLayers"], newer: Scene["lumenLayers"]): Scene["lumenLayers"] | undefined {
  if (!newer?.list?.length) return older ?? newer;
  if (!older?.list?.length) return newer;
  const list = newer.list.map((l) => ({ ...l }));
  const have = new Set(list.map((l) => l.id));
  older.list.forEach((l, i) => {
    if (have.has(l.id)) return;
    // Insert after the older list's previous layer, so a layer added on one device keeps its place in the stack.
    const prev = older.list![i - 1]?.id;
    const at = prev ? list.findIndex((x) => x.id === prev) + 1 : 0;
    list.splice(at, 0, { ...l });
    have.add(l.id);
  });
  return { ...newer, list };
}

const keyOf = (x: unknown) => { try { return JSON.stringify(x); } catch { return String(x); } };

/**
 * Merge two .excalidraw bodies. `remoteNewer`: the remote note has the later `updatedAt` (its scene-level fields win).
 * Returns the merged body, or null when either side doesn't parse or the result is over the sync size cap.
 */
export function mergeBoards(localBody: string, remoteBody: string, opts: { remoteNewer: boolean; now?: number; maxBytes?: number }): string | null {
  const now = opts.now ?? Date.now();
  const l = parseBoard(localBody), r = parseBoard(remoteBody);
  if (!l || !r) return null;
  const [older, newer] = opts.remoteNewer ? [l, r] : [r, l];
  const elements = mergeElements(l.elements, r.elements, now);
  const out: Scene = { ...older, ...newer, elements };
  const files = mergeFiles(older.files, newer.files, elements);
  if (files) out.files = files;
  if (older.lumenBoard || newer.lumenBoard) out.lumenBoard = { ...(older.lumenBoard ?? {}), ...(newer.lumenBoard ?? {}) };
  if (out.appState && out.lumenBoard && typeof out.appState === "object") out.appState = { ...out.appState, lumenBoard: out.lumenBoard };
  const layers = mergeLayers(older.lumenLayers, newer.lumenLayers);
  if (layers) out.lumenLayers = layers;
  const ids = new Set(elements.map((e) => e.id));
  const pend = new Map<string, unknown>();
  for (const p of [...(l.lumenPending ?? []), ...(r.lumenPending ?? [])]) {
    const id = (p as { id?: unknown })?.id;
    if (typeof id === "string" && ids.has(id)) continue; // already applied on some device
    pend.set(keyOf(p), p);
  }
  if (pend.size) out.lumenPending = [...pend.values()];
  else delete out.lumenPending;
  const body = JSON.stringify(out);
  if (body.length > (opts.maxBytes ?? MAX_ITEM_BYTES)) return null;
  return body;
}

/**
 * Keep deletions in the stored scene: elements of `prevBody` missing from `nextBody` become tombstones (version + 1,
 * so they beat the last live copy on other devices), earlier tombstones are carried over, expired ones dropped.
 * Returns `nextBody` itself when nothing needs adding or pruning (or either side doesn't parse).
 */
export function carryTombstones(prevBody: string | null | undefined, nextBody: string, now = Date.now()): string {
  const prev = parseBoard(prevBody), next = parseBoard(nextBody);
  if (!prev || !next) return nextBody;
  const have = new Set(next.elements.map((e) => e.id));
  const add: BoardEl[] = [];
  for (const e of prev.elements) {
    if (have.has(e.id)) continue;
    if (e.isDeleted) { if (!expired(e, now)) add.push(tombstone(e, now)); }
    else add.push({ ...tombstone(e, now), version: (e.version ?? 1) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: now });
  }
  let changed = add.length > 0;
  const kept: BoardEl[] = [];
  for (const e of next.elements) {
    if (expired(e, now)) { changed = true; continue; }
    if (e.isDeleted && (Object.keys(e).length > 6 || "index" in e)) { kept.push(tombstone(e, now)); changed = true; continue; }
    kept.push(e);
  }
  if (!changed) return nextBody;
  // Tombstones go first (bottom of the z-order, hidden anyway) so live elements keep their array positions.
  const out = JSON.stringify({ ...next, elements: [...add, ...kept] });
  carried.set(out, nextBody);
  if (carried.size > 4) carried.delete(carried.keys().next().value!);
  return out;
}

const carried = new Map<string, string>();
/** The editor body a stored body was made from by `carryTombstones` (lets the board tell its own save from a remote change). */
export const carriedFrom = (stored: string): string | undefined => carried.get(stored);
