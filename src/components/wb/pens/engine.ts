// Ink engine (W2-A): scene maths for the lasso, the erasers (stroke · partial · lasso · scratch-out), auto-shape snapping,
// the ruler edge and the highlighter z-order. All edits go through updateScene with one IMMEDIATELY capture per gesture,
// so each gesture is one undo step.
import { restoreElements } from "@excalidraw/excalidraw";
import { sanitizeElements } from "../../../lib/board-sanitize";
import type { WbAPI } from "../hooks";
import { absPoints, isScratch, recognise, snappedElement, type Recognised } from "./shapes";
import { circleBox, InkIndex, polyBox } from "./spatial";

export type El = Record<string, unknown> & { id: string; type: string; x: number; y: number; width: number; height: number; isDeleted?: boolean; angle?: number; points?: [number, number][]; pressures?: number[]; groupIds?: string[]; containerId?: string | null; boundElements?: { id: string; type: string }[] | null; locked?: boolean; customData?: Record<string, unknown> };
type Pt = [number, number];

const rid = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
const nonce = () => Math.floor(Math.random() * 2 ** 31);
export const bump = <T extends Record<string, unknown>>(e: T): T => ({ ...e, version: ((e.version as number) ?? 1) + 1, versionNonce: nonce(), updated: Date.now() });

/** Client point → scene point. */
export function toScene(api: WbAPI, host: HTMLElement, clientX: number, clientY: number): Pt {
  const st = api.getAppState() as { zoom: { value: number }; scrollX: number; scrollY: number };
  const r = host.getBoundingClientRect();
  return [(clientX - r.left) / st.zoom.value - st.scrollX, (clientY - r.top) / st.zoom.value - st.scrollY];
}
export function toScreen(api: WbAPI, x: number, y: number): Pt {
  const st = api.getAppState() as { zoom: { value: number }; scrollX: number; scrollY: number };
  return [(x + st.scrollX) * st.zoom.value, (y + st.scrollY) * st.zoom.value];
}
export const zoomOf = (api: WbAPI) => (api.getAppState() as { zoom: { value: number } }).zoom.value;

export function pointInPoly([x, y]: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}
const segDist = (p: Pt, a: Pt, b: Pt) => {
  const l2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * (b[0] - a[0])), p[1] - (a[1] + t * (b[1] - a[1])));
};
/** Corners of an element's box (rotated). */
function corners(e: El): Pt[] {
  const cx = e.x + e.width / 2, cy = e.y + e.height / 2, a = e.angle ?? 0, c = Math.cos(a), s = Math.sin(a);
  return ([[e.x, e.y], [e.x + e.width, e.y], [e.x + e.width, e.y + e.height], [e.x, e.y + e.height]] as Pt[]).map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
}
const linear = (e: El) => e.type === "freedraw" || e.type === "line" || e.type === "arrow";

/** One spatial index for the open board (erase, lasso, scratch-out): synced from the scene before each query. */
export const inkIndex = new InkIndex<El>();
/** Candidates near a circle / polygon / box: bounding-box pre-filter through the index. */
export const nearCircle = (els: readonly El[], p: Pt, r: number) => { inkIndex.sync(els); return inkIndex.search(circleBox(p, r)); };

/** Elements a closed lasso path encloses: strokes by their points (≥ 70 % inside), boxes by centre + 3 of 4 corners. */
export function lassoed(els: readonly El[], poly: Pt[]): El[] {
  if (poly.length < 3) return [];
  inkIndex.sync(els);
  const pb = polyBox(poly);
  // an enclosed element's box overlaps the lasso's box: only those candidates get the exact test
  const hit = inkIndex.search(pb).filter((e) => {
    if (e.isDeleted || e.locked || (e.type === "text" && e.containerId)) return false;
    if (linear(e)) { const pts = absPoints(e); return pts.length > 0 && pts.filter((p) => pointInPoly(p, poly)).length / pts.length >= 0.7; }
    const cs = corners(e);
    return pointInPoly([e.x + e.width / 2, e.y + e.height / 2], poly) && cs.filter((p) => pointInPoly(p, poly)).length >= 3;
  });
  // whole groups come along
  const groups = new Set(hit.flatMap((e) => (e.groupIds?.length ? [e.groupIds[e.groupIds.length - 1]] : [])));
  const ids = new Set(hit.map((e) => e.id));
  return els.filter((e) => !e.isDeleted && (ids.has(e.id) || (e.groupIds?.length && groups.has(e.groupIds[e.groupIds.length - 1]))) && !(e.type === "text" && e.containerId));
}

/** Does a circle (scene coords) touch the element? Strokes by their path, boxes by their outline or a solid fill. */
export function touches(e: El, p: Pt, r: number): boolean {
  if (e.isDeleted || e.locked || e.type === "frame" || e.type === "magicframe") return false;
  if (linear(e)) {
    const pts = absPoints(e);
    const sw = Number(e.strokeWidth ?? 1) * 2;
    for (let i = 0; i < pts.length; i++) if ((i ? segDist(p, pts[i - 1], pts[i]) : Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1])) <= r + sw) return true;
    return false;
  }
  const cs = corners(e);
  if (pointInPoly(p, cs) && (e.type === "text" || e.type === "image" || e.type === "embeddable" || e.type === "iframe" || (e.backgroundColor && e.backgroundColor !== "transparent"))) return true;
  for (let i = 0; i < 4; i++) if (segDist(p, cs[i], cs[(i + 1) % 4]) <= r + 2) return true;
  return false;
}

/** Ids that go with an element when it is deleted: its bound text. */
export function withBound(els: readonly El[], ids: Set<string>) {
  for (const e of els) if (e.containerId && ids.has(e.containerId)) ids.add(e.id);
  return ids;
}

/** Commit: replace the scene's elements (deleted flags, new elements) as one undo step. */
export function commit(api: WbAPI, next: El[], capture: "IMMEDIATELY" | "EVENTUALLY" | "NEVER" = "IMMEDIATELY", appState?: Record<string, unknown>) {
  api.updateScene({ elements: restoreElements(sanitizeElements(next) as never, null, { refreshDimensions: false, repairBindings: true }), captureUpdate: capture, ...(appState ? { appState } : {}) });
}
export function deleteIds(api: WbAPI, ids: Set<string>, capture: "IMMEDIATELY" | "EVENTUALLY" | "NEVER" = "IMMEDIATELY") {
  const all = api.getSceneElementsIncludingDeleted() as El[];
  withBound(all, ids);
  // pure deletions keep valid elements: skip restoreElements (O(n) normalisation, the main cost on big boards)
  api.updateScene({ elements: all.map((e) => (ids.has(e.id) ? bump({ ...e, isDeleted: true }) : e)) as never, captureUpdate: capture, appState: { selectedElementIds: {} } });
  inkIndex.remove(ids);
}

/** Partial eraser: cut the parts of freedraw strokes inside the circle; strokes split into pieces. Returns true if changed. */
export function partialErase(api: WbAPI, p: Pt, r: number, capture: "IMMEDIATELY" | "EVENTUALLY") {
  const all = api.getSceneElementsIncludingDeleted() as El[];
  const near = new Set(nearCircle(api.getSceneElements() as El[], p, r).filter((e) => touches(e, p, r)).map((e) => e.id));
  if (!near.size) return false;
  let changed = false;
  const out: El[] = [];
  for (const e of all) {
    if (!near.has(e.id)) { out.push(e); continue; }
    changed = true;
    if (e.type !== "freedraw") { out.push(bump({ ...e, isDeleted: true })); continue; }
    const pts = absPoints(e), pr = e.pressures ?? [];
    const keep = pts.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > r + Number(e.strokeWidth ?? 1) * 1.5);
    const runs: number[][] = [];
    let cur: number[] = [];
    keep.forEach((k, i) => { if (k) cur.push(i); else if (cur.length) { runs.push(cur); cur = []; } });
    if (cur.length) runs.push(cur);
    out.push(bump({ ...e, isDeleted: true }));
    for (const run of runs) {
      if (run.length < 2) continue;
      const [ox, oy] = pts[run[0]];
      const rel = run.map((i) => [pts[i][0] - ox, pts[i][1] - oy] as Pt);
      const xs = rel.map((q) => q[0]), ys = rel.map((q) => q[1]);
      out.push({ ...e, id: rid(), seed: nonce(), version: 1, versionNonce: nonce(), updated: Date.now(), index: null, x: ox, y: oy, points: rel, pressures: pr.length === pts.length ? run.map((i) => pr[i]) : [], width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), boundElements: null, lastCommittedPoint: null });
    }
  }
  if (changed) commit(api, out, capture);
  return changed;
}

/** Scratch-out: a scribble over ink deletes what it covers, and itself. Returns the number of items removed. */
export function scratchOut(api: WbAPI, stroke: El): number {
  const pts = absPoints(stroke);
  const box = isScratch(pts);
  if (!box) return 0;
  const all = api.getSceneElements() as El[];
  const area = box.w * box.h || 1;
  // already a bounding-box test per element, once per stroke: a plain scan beats an index sync here (measured)
  const hit = all.filter((e) => {
    if (e.id === stroke.id || e.isDeleted || e.locked || e.type === "frame" || (e.type === "text" && e.containerId)) return false;
    const x0 = Math.max(e.x, box.x), x1 = Math.min(e.x + e.width, box.x + box.w), y0 = Math.max(e.y, box.y), y1 = Math.min(e.y + e.height, box.y + box.h);
    if (x1 <= x0 || y1 <= y0) return false;
    const ov = (x1 - x0) * (y1 - y0), ea = Math.max(1, e.width * e.height);
    return ov / ea >= 0.5 || (ov / area >= 0.3 && ea < area * 2);
  });
  if (!hit.length) return 0;
  deleteIds(api, new Set([stroke.id, ...hit.map((e) => e.id)]));
  return hit.length;
}

/** Snap a freedraw stroke to a clean shape (one undo step). Returns the recognised shape and the new element id. */
export function snapStroke(api: WbAPI, stroke: El): { rec: Recognised; id: string; from: El } | null {
  const rec = recognise(absPoints(stroke));
  if (!rec) return null;
  const id = rid();
  const el = { ...snappedElement(rec, stroke), id, seed: nonce(), version: 1, versionNonce: nonce(), updated: Date.now(), isDeleted: false, boundElements: null, link: null, locked: false, index: null } as unknown as El;
  const all = api.getSceneElementsIncludingDeleted() as El[];
  commit(api, all.flatMap((e) => (e.id === stroke.id ? [bump({ ...e, isDeleted: true }), el] : [e])), "IMMEDIATELY");
  return { rec, id, from: stroke };
}
/** Undo snap: bring the stroke back, drop the shape (one step). */
export function unsnap(api: WbAPI, shapeId: string, strokeId: string) {
  const all = api.getSceneElementsIncludingDeleted() as El[];
  commit(api, all.map((e) => (e.id === shapeId ? bump({ ...e, isDeleted: true }) : e.id === strokeId ? bump({ ...e, isDeleted: false }) : e)), "IMMEDIATELY");
}

/** Highlighter draws behind ink: move it just under the lowest ink (stroke / text) it overlaps. */
export function sendBehindInk(api: WbAPI, id: string) {
  const all = [...(api.getSceneElementsIncludingDeleted() as El[])];
  const i = all.findIndex((e) => e.id === id);
  if (i < 0) return;
  const h = all[i];
  const ov = (e: El) => !(e.x > h.x + h.width || e.x + e.width < h.x || e.y > h.y + h.height || e.y + e.height < h.y);
  const j = all.findIndex((e, k) => k < i && !e.isDeleted && (e.type === "freedraw" || e.type === "text") && (e.customData?.lumenPen as { type?: string } | undefined)?.type !== "highlighter" && ov(e));
  if (j < 0) return;
  const [m] = all.splice(i, 1);
  all.splice(j, 0, { ...m, index: null } as El);
  commit(api, all, "EVENTUALLY");
}

/** Ruler edge (scene coords): straighten a stroke drawn along it. Returns new absolute points or null. */
export function alongRuler(pts: Pt[], a: Pt, b: Pt, tol: number): Pt[] | null {
  if (pts.length < 2) return null;
  const near = pts.filter((p) => segDist(p, a, b) <= tol).length / pts.length;
  if (near < 0.7) return null;
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  return pts.map((p) => { const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2; return [a[0] + t * dx, a[1] + t * dy] as Pt; });
}
