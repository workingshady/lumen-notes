// Fractional z-order indices for Excalidraw elements (`index`, same keys as Excalidraw: the `fractional-indexing`
// package). Used by the board merge (src/lib/board-merge.ts) and the REST whiteboard writes (worker), so elements that
// arrive without an index (older files, scripts, agents) get one that keeps their place in the array instead of
// sorting to an arbitrary spot.
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

const validCache = new Map<string, boolean>();
/** A well-formed fractional index key. */
export function isIndexKey(k: unknown): k is string {
  if (typeof k !== "string" || !k) return false;
  let v = validCache.get(k);
  if (v === undefined) {
    try { generateKeyBetween(k, null); v = true; } catch { v = false; }
    if (validCache.size > 50_000) validCache.clear();
    validCache.set(k, v);
  }
  return v;
}

/**
 * Array order is z-order (bottom first). Every element whose `index` is missing, malformed or not above the previous
 * element's gets a fresh key between its neighbours; well-ordered elements keep theirs. Returns the same array when
 * nothing changed, otherwise a new array (changed elements are copies; inputs are never mutated).
 */
export function ensureIndices<T extends object>(els: readonly T[]): T[] {
  const ix = (e: T) => (e as { index?: unknown }).index;
  let out: T[] | null = null;
  let last: string | null = null;
  let i = 0;
  while (i < els.length) {
    const k = ix(els[i]);
    if (isIndexKey(k) && (last === null || k > last)) { last = k; i++; continue; }
    // A run of elements needing a key: [i, j). The upper bound is the next element whose key fits above `last`.
    let j = i + 1;
    while (j < els.length) {
      const kj = ix(els[j]);
      if (isIndexKey(kj) && (last === null || kj > last)) break;
      j++;
    }
    const upper = j < els.length ? (ix(els[j]) as string) : null;
    const keys = generateNKeysBetween(last, upper, j - i);
    out ??= els.slice();
    for (let n = i; n < j; n++) out[n] = { ...els[n], index: keys[n - i] };
    last = keys[keys.length - 1];
    i = j;
  }
  return out ?? (els as T[]);
}
