// Element sanitiser for whiteboards / Boards: every element passes through here before it reaches Excalidraw (load,
// external change / merge, REST pending, card insert, pen commit, Repair). Pure (no Excalidraw import), unit-tested by
// scripts/board-sanitize.test.ts.
//
// Why: Excalidraw's restore()/restoreElements() read `element.points.length` for every line / arrow / freedraw
// (isInvisiblySmallElement) BEFORE filling defaults, so one element without `points` throws "Cannot read properties
// of undefined (reading 'length')" and takes the whole board down. Compact tombstones written by board-merge
// (`{id, type, version, versionNonce, isDeleted, updated}`) are exactly that for erased pen strokes.
//
// Rules: drop anything that isn't an object with a string id and type; fill `groupIds` / `boundElements` with arrays;
// drop a non-string `index` (ensureIndices / Excalidraw re-derive it); non-finite x/y/width/height → 0. Lines/arrows/
// freedraw: tombstones get `points: []` (restore then drops them as invisible, the board's tombstone path still
// deletes the live copy); live freedraw without a usable point is dropped; live lines/arrows fall back to their box
// diagonal (else dropped); freedraw `pressures` must match `points`, otherwise [] with simulated pressure.
// Elements that need no change are returned as the same object (cheap on big boards).

type El = Record<string, unknown> & { id: string; type: string };

const LINEAR = new Set(["line", "arrow", "freedraw", "draw"]);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPt = (p: unknown) => Array.isArray(p) && p.length >= 2 && num(p[0]) && num(p[1]);

/** One element made safe for Excalidraw, or null when it can't be repaired. */
export function sanitizeElement(raw: unknown): El | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== "string" || !e.id || typeof e.type !== "string" || !e.type) return null;
  let out: Record<string, unknown> | null = null;
  const set = (k: string, v: unknown) => { (out ??= { ...e })[k] = v; };
  const del = (k: string) => { if (k in (out ?? e)) delete (out ??= { ...e })[k]; };

  if (!Array.isArray(e.groupIds) || !e.groupIds.every((g) => typeof g === "string")) set("groupIds", Array.isArray(e.groupIds) ? e.groupIds.filter((g) => typeof g === "string") : []);
  if (e.boundElements != null && (!Array.isArray(e.boundElements) || !e.boundElements.every((b) => b && typeof (b as { id?: unknown }).id === "string"))) {
    set("boundElements", Array.isArray(e.boundElements) ? e.boundElements.filter((b) => b && typeof (b as { id?: unknown }).id === "string") : []);
  } else if (e.boundElements === undefined) set("boundElements", []);
  if ("index" in e && e.index !== null && typeof e.index !== "string") del("index");
  for (const k of ["x", "y", "width", "height"]) if (k in e && !num(e[k])) set(k, 0);

  if (LINEAR.has(e.type)) {
    const pts = Array.isArray(e.points) ? e.points : null;
    const valid = pts ? pts.filter(isPt) : [];
    if (e.isDeleted) {
      if (!pts || valid.length !== pts.length) set("points", valid);
    } else if (e.type === "freedraw") {
      if (!valid.length) return null;
      if (!pts || valid.length !== pts.length) set("points", valid);
      const pr = e.pressures;
      const prOk = Array.isArray(pr) && pr.every(num) && (pr.length === 0 || pr.length === valid.length);
      if (!prOk) { set("pressures", []); set("simulatePressure", true); }
      else if (pr.length === 0 && e.simulatePressure === false) set("simulatePressure", true);
    } else if (!pts || valid.length < 2 || valid.length !== pts.length) {
      if (valid.length >= 2) set("points", valid);
      else {
        const w = num(e.width) ? e.width : 0, h = num(e.height) ? e.height : 0;
        if (!w && !h) return null;
        set("points", [[0, 0], [w, h]]);
      }
    }
  }
  return (out ?? e) as El;
}

/** Every element made safe for Excalidraw; unrepairable ones are dropped. Returns the input array when nothing changed. */
export function sanitizeElements<T = El>(els: readonly unknown[] | null | undefined): T[] {
  if (!Array.isArray(els)) return [];
  let changed = false;
  const out: El[] = [];
  for (const raw of els) {
    const s = sanitizeElement(raw);
    if (s !== raw) changed = true;
    if (s) out.push(s);
  }
  return (changed ? out : els) as T[];
}
