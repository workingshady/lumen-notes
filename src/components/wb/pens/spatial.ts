// Spatial index for the ink tools (stage 5b): erase, lasso and scratch-out query an R-tree (RBush) of element boxes
// instead of scanning every element on every pointer move. The index syncs by element version (cheap diff, no rebuild),
// and every query is a bounding-box pre-filter: the exact hit tests in engine.ts only run on the candidates.
import RBush from "rbush";

type Box = { minX: number; minY: number; maxX: number; maxY: number };
type Item<E> = Box & { e: E; v: number };
type Shape = { id: string; x: number; y: number; width: number; height: number; angle?: number; version?: number; strokeWidth?: unknown; points?: unknown; isDeleted?: boolean };

/** Axis-aligned box of an element (rotation and stroke width included). */
export function boxOf(e: Shape): Box {
  const pad = Number(e.strokeWidth ?? 1) * 2 + 2;
  const pts = e.points as [number, number][] | undefined;
  let x0 = e.x, y0 = e.y, x1 = e.x + e.width, y1 = e.y + e.height;
  if (pts?.length) {
    x0 = y0 = Infinity; x1 = y1 = -Infinity;
    for (const [px, py] of pts) { const x = e.x + px, y = e.y + py; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const a = e.angle ?? 0;
  if (a) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = Math.hypot(x1 - x0, y1 - y0) / 2;
    x0 = cx - r; x1 = cx + r; y0 = cy - r; y1 = cy + r;
  }
  return { minX: Math.min(x0, x1) - pad, minY: Math.min(y0, y1) - pad, maxX: Math.max(x0, x1) + pad, maxY: Math.max(y0, y1) + pad };
}

export class InkIndex<E extends Shape> {
  private tree = new RBush<Item<E>>(16);
  private items = new Map<string, Item<E>>();
  private seen = new Set<string>();
  /** Bring the index up to date with the scene (diff by element reference + version; deleted elements leave). */
  sync(els: readonly E[]) {
    if (!this.items.size || els.length > this.items.size * 4) return this.load(els);
    const seen = this.seen; seen.clear();
    const add: Item<E>[] = [];
    for (const e of els) {
      if (e.isDeleted) continue;
      seen.add(e.id);
      const it = this.items.get(e.id), v = e.version ?? 0;
      if (it && it.e === e && it.v === v) continue;
      if (it) { if (it.v === v) { it.e = e; continue; } this.tree.remove(it); }
      const n = { ...boxOf(e), e, v };
      this.items.set(e.id, n); add.push(n);
    }
    if (seen.size !== this.items.size) for (const [id, it] of this.items) if (!seen.has(id)) { this.tree.remove(it); this.items.delete(id); }
    if (add.length > 64) this.tree.load(add); else for (const n of add) this.tree.insert(n);
  }
  private load(els: readonly E[]) {
    this.tree.clear(); this.items.clear();
    const all: Item<E>[] = [];
    for (const e of els) if (!e.isDeleted) { const n = { ...boxOf(e), e, v: e.version ?? 0 }; this.items.set(e.id, n); all.push(n); }
    this.tree.load(all);
  }
  /** Elements whose box meets the query box. */
  search(b: Box): E[] { return this.tree.search(b).map((i) => i.e); }
  /** Drop elements at once (the eraser's own deletions, before the scene round-trips). */
  remove(ids: Iterable<string>) { for (const id of ids) { const it = this.items.get(id); if (it) { this.tree.remove(it); this.items.delete(id); } } }
  get size() { return this.items.size; }
}

export const circleBox = (p: [number, number], r: number): Box => ({ minX: p[0] - r, minY: p[1] - r, maxX: p[0] + r, maxY: p[1] + r });
export function polyBox(poly: [number, number][]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { minX, minY, maxX, maxY };
}
