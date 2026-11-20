// Pure sync helpers (no Dexie, no DOM), unit-tested by scripts/sync-plan.test.ts.

/** Must match the Worker (worker/index.ts MAX_ITEM_BYTES): D1 rows are capped at 2 MB, stored JSON included. */
export const MAX_ITEM_BYTES = 1_800_000;
/** Push chunk: items and serialised bytes per /sync request (the Worker refuses more than 2000 items). */
export const PUSH_ITEMS = 200;
export const PUSH_BYTES = 4_000_000;

/** UTF-8 byte length, encoded only when the UTF-16 length can't decide against `limit`. */
export function utf8Size(s: string, limit = MAX_ITEM_BYTES): number {
  if (s.length > limit || s.length * 3 <= limit) return s.length;
  return new TextEncoder().encode(s).length;
}

/** Split serialised items into request chunks of at most `maxItems` and (unless one item alone is bigger) `maxBytes`. */
export function chunkItems<T extends { size: number }>(items: T[], maxItems = PUSH_ITEMS, maxBytes = PUSH_BYTES): T[][] {
  const out: T[][] = [];
  let cur: T[] = [], bytes = 0;
  for (const it of items) {
    if (cur.length && (cur.length >= maxItems || bytes + it.size > maxBytes)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(it);
    bytes += it.size;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** A record the server refused. Kept dirty but not re-sent until it is edited again (or, for "error", after an hour). */
export interface StuckItem { kind: string; id: string; updatedAt: number; reason: "too_large" | "invalid" | "error"; size?: number; title?: string; at: number }
export const RETRY_ERROR_MS = 60 * 60_000;
/** Should this dirty record be skipped this round? */
export function isStuck(s: StuckItem | undefined, updatedAt: number, now = Date.now()): boolean {
  if (!s || s.updatedAt !== updatedAt) return false; // edited since: try again
  return s.reason !== "error" || now - s.at < RETRY_ERROR_MS;
}

/**
 * Which ids to clear after a push: only those the server acknowledged and that weren't edited again while the request
 * was in flight. `accepted` undefined = an older Worker without per-item results (it wrote everything it got).
 */
export function ackedIds(sent: { key: string; updatedAt: number }[], accepted: string[] | undefined, rejected: { kind: string; id: string }[] = []): Set<string> {
  const bad = new Set(rejected.map((r) => `${r.kind}/${r.id}`));
  const ok = accepted ? new Set(accepted) : null;
  return new Set(sent.map((s) => s.key).filter((k) => !bad.has(k) && (!ok || ok.has(k))));
}

// ------------------------------------------------------------------ version retention
export interface VersionLite { id: string; noteId: string; createdAt: number; label?: string; deleted?: 0 | 1 }
const H = 3_600_000, D = 24 * H;
/**
 * Version retention (per note): keep everything from the last 24 h, then the newest per hour for 7 days, then the newest
 * per day for 90 days, then the newest per week. Named versions (a label that isn't restore bookkeeping) and each
 * note's newest version are always kept. Returns the ids to tombstone (already deleted ones are ignored).
 */
export function versionsToPrune(vs: VersionLite[], now = Date.now(), keep: { all: number; hourly: number; daily: number } = { all: D, hourly: 7 * D, daily: 90 * D }): string[] {
  const byNote = new Map<string, VersionLite[]>();
  for (const v of vs) if (!v.deleted) (byNote.get(v.noteId) ?? byNote.set(v.noteId, []).get(v.noteId)!).push(v);
  const out: string[] = [];
  for (const list of byNote.values()) {
    list.sort((a, b) => b.createdAt - a.createdAt);
    const seen = new Set<string>();
    list.forEach((v, i) => {
      const age = now - v.createdAt;
      const bucket = age < keep.hourly ? `h${Math.floor(v.createdAt / H)}` : age < keep.daily ? `d${Math.floor(v.createdAt / D)}` : `w${Math.floor(v.createdAt / (7 * D))}`;
      if (i === 0) { seen.add(bucket); return; } // the note's newest version always stays (and fills its bucket)
      if (age < keep.all || (v.label && !/^(Restored|Before)/.test(v.label))) return;
      if (seen.has(bucket)) out.push(v.id);
      else seen.add(bucket);
    });
  }
  return out;
}
