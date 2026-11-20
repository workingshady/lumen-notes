// Edge routes for architecture diagrams: orthogonal (elbow, the default), straight or curved, with the design's
// filled arrowheads (ArchStudio.dc.html `head()`). Shared by the board (components/arch) and the SVG export.
import type { Side } from "../../shared/types";

export interface Box { x: number; y: number; width: number; height: number }
export type Pt = { x: number; y: number };
/** `pts` is the drawn route as a polyline (curves sampled); `poly` is the editable polyline (curves reduce to their ends). */
export interface Route { d: string; heads: string[]; mid: Pt; pts: Pt[]; poly: Pt[] }
type Dir = "r" | "l" | "d" | "u";
export const portAt = (b: Box, s: Side) => (s === "top" ? { x: b.x + b.width / 2, y: b.y } : s === "bottom" ? { x: b.x + b.width / 2, y: b.y + b.height } : s === "left" ? { x: b.x, y: b.y + b.height / 2 } : { x: b.x + b.width, y: b.y + b.height / 2 });
/** Head tip at (x, y) pointing `dir` (8 long, 9 wide). */
export const head = (x: number, y: number, dir: Dir) => ({ r: `M${x} ${y}l-8 -4.5v9z`, l: `M${x} ${y}l8 -4.5v9z`, d: `M${x} ${y}l-4.5 -8h9z`, u: `M${x} ${y}l-4.5 8h9z` }[dir]);
const into: Record<Side, Dir> = { left: "r", right: "l", top: "d", bottom: "u" };
const segDir = (a: { x: number; y: number }, b: { x: number; y: number }): Dir => (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? (b.x >= a.x ? "r" : "l") : b.y >= a.y ? "d" : "u");

const near = (a: number, b: number) => Math.abs(a - b) < 0.75;
/** Right angles: insert the corner between any two points that share neither x nor y, drop doubles and collinear points. */
export function orthogonalize(pts: Pt[], startHoriz: boolean): Pt[] {
  if (pts.length < 2) return pts;
  const out: Pt[] = [pts[0]];
  let lastHoriz = !startHoriz;
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1], b = pts[i];
    if (near(a.x, b.x) && near(a.y, b.y)) { if (i === pts.length - 1) out[out.length - 1] = b; continue; }
    if (near(a.y, b.y)) { out.push(b); lastHoriz = true; }
    else if (near(a.x, b.x)) { out.push(b); lastHoriz = false; }
    else { out.push(lastHoriz ? { x: a.x, y: b.y } : { x: b.x, y: a.y }, b); lastHoriz = near(out[out.length - 2].y, b.y); }
  }
  return simplify(out);
}
/** Remove middle points lying on a straight run (the two ends stay). */
export function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const n = out.length;
    if (n && near(out[n - 1].x, p.x) && near(out[n - 1].y, p.y) && n > 1) continue;
    if (n >= 2 && ((near(out[n - 2].x, out[n - 1].x) && near(out[n - 1].x, p.x)) || (near(out[n - 2].y, out[n - 1].y) && near(out[n - 1].y, p.y)))) out[n - 1] = p;
    else out.push(p);
  }
  return out;
}
const horizSide = (s: Side) => s === "left" || s === "right";
const len = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
export const polyLength = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + len(pts[i - 1], p) : 0), 0);
/** Point (and line direction in degrees) at distance `d` from the start of a polyline. */
export function polyAt(pts: Pt[], d: number): Pt & { angle: number } {
  let rest = Math.max(0, d);
  for (let i = 1; i < pts.length; i++) {
    const l = len(pts[i - 1], pts[i]);
    if (rest <= l || i === pts.length - 1) {
      const k = l ? Math.min(1, rest / l) : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k, angle: (Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x) * 180) / Math.PI };
    }
    rest -= l;
  }
  return { ...(pts[0] ?? { x: 0, y: 0 }), angle: 0 };
}
export const routeAt = (r: Route, t: number) => polyAt(r.pts, polyLength(r.pts) * Math.min(1, Math.max(0, t)));
/** Direction of the segment holding `p` (the natural label spot). */
export function angleAtPoint(pts: Pt[], p: Pt): number {
  let best = 0, bd = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const k = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2)) : 0;
    const dd = Math.hypot(a.x + (b.x - a.x) * k - p.x, a.y + (b.y - a.y) * k - p.y);
    if (dd < bd) { bd = dd; best = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI; }
  }
  return best;
}
/** Position 0–1 along the route nearest to `p` (label dragging). */
export function nearestT(pts: Pt[], p: Pt): number {
  const total = polyLength(pts) || 1;
  let acc = 0, best = 0, bd = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = len(a, b), l2 = l * l;
    const k = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2)) : 0;
    const dd = Math.hypot(a.x + (b.x - a.x) * k - p.x, a.y + (b.y - a.y) * k - p.y);
    if (dd < bd) { bd = dd; best = (acc + l * k) / total; }
    acc += l;
  }
  return best;
}

// ------------------------------------------------------------ bend-point editing (full polylines, both ends fixed)
/** Move interior point `i`; with right angles the neighbours that shared its x or y follow so segments stay straight. */
export function movePoint(pts: Pt[], i: number, to: Pt, ortho: boolean): Pt[] {
  const out = pts.map((p) => ({ ...p }));
  const old = pts[i];
  if (ortho) for (const j of [i - 1, i + 1]) if (j > 0 && j < pts.length - 1) { if (near(pts[j].x, old.x)) out[j].x = to.x; else if (near(pts[j].y, old.y)) out[j].y = to.y; }
  out[i] = { ...to };
  return out;
}
/** Start dragging the segment `i`→`i+1`: right angles slide it sideways (adding corners when it touches an end), otherwise a point is added in the middle. Returns the new polyline and the dragged index (a segment drag moves `idx` and `idx+1`). */
export function splitSegment(pts: Pt[], i: number, ortho: boolean): { pts: Pt[]; idx: number; seg: boolean } {
  const out = pts.map((p) => ({ ...p }));
  if (!ortho) { const a = out[i], b = out[i + 1]; out.splice(i + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); return { pts: out, idx: i + 1, seg: false }; }
  let idx = i;
  if (i + 1 === out.length - 1) out.splice(out.length - 1, 0, { ...out[out.length - 1] });
  if (i === 0) { out.splice(1, 0, { ...out[0] }); idx = 1; }
  return { pts: out, idx, seg: true };
}
/** Slide the segment `idx`→`idx+1` to `pos` along its normal axis (right-angle routes). */
export function slideSegment(pts: Pt[], idx: number, pos: Pt): Pt[] {
  const out = pts.map((p) => ({ ...p }));
  const horiz = near(pts[idx].y, pts[idx + 1].y) && !near(pts[idx].x, pts[idx + 1].x);
  for (const j of [idx, idx + 1]) if (j > 0 && j < out.length - 1) { if (horiz) out[j].y = pos.y; else out[j].x = pos.x; }
  return out;
}
/** The interior points to store for an edited full polyline (normalised when right angles apply). */
export function interiorOf(pts: Pt[], ortho: boolean, startHoriz: boolean): Pt[] {
  const full = ortho ? orthogonalize(pts, startHoriz) : simplify(pts);
  return full.slice(1, -1).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}
export const startsHorizontal = horizSide;

export function route(p: Pt, ps: Side, q: Pt, qs: Side, shape: "orthogonal" | "straight" | "curved" = "orthogonal", ends: { start: boolean; end: boolean } = { start: false, end: true }, points?: Pt[], manual?: boolean): Route {
  let d: string, mid: Pt, endDir: Dir = into[qs], startDir: Dir = into[ps];
  let pts: Pt[], poly: Pt[];
  if (manual) points = shape === "orthogonal" ? orthogonalize([p, ...(points ?? []), q], horizSide(ps)) : [p, ...(points ?? []), q];
  if (points && points.length >= 2) {
    pts = poly = points;
    d = `M${points[0].x} ${points[0].y}` + points.slice(1).map((pt) => ` L${pt.x} ${pt.y}`).join("");
    // label on the longest segment
    let best = 0, bi = 1;
    for (let i = 1; i < points.length; i++) { const l = Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y); if (l > best) { best = l; bi = i; } }
    mid = { x: (points[bi].x + points[bi - 1].x) / 2, y: (points[bi].y + points[bi - 1].y) / 2 };
    endDir = segDir(points[points.length - 2], points[points.length - 1]);
    startDir = segDir(points[1], points[0]);
    p = points[0]; q = points[points.length - 1];
  } else if (shape === "straight") {
    d = `M${p.x} ${p.y} L${q.x} ${q.y}`; mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    endDir = segDir(p, q); startDir = segDir(q, p);
    pts = poly = [p, q];
  } else if (shape === "curved") {
    const k = Math.max(40, Math.hypot(q.x - p.x, q.y - p.y) / 3);
    const off = (s: Side) => (s === "left" ? [-k, 0] : s === "right" ? [k, 0] : s === "top" ? [0, -k] : [0, k]);
    const [ax, ay] = off(ps), [bx, by] = off(qs);
    d = `M${p.x} ${p.y} C${p.x + ax} ${p.y + ay} ${q.x + bx} ${q.y + by} ${q.x} ${q.y}`; mid = { x: (p.x + q.x) / 2 + (ax + bx) / 8, y: (p.y + q.y) / 2 + (ay + by) / 8 };
    const c1 = { x: p.x + ax, y: p.y + ay }, c2 = { x: q.x + bx, y: q.y + by };
    pts = Array.from({ length: 41 }, (_, i) => { const u = i / 40, v = 1 - u; return { x: v ** 3 * p.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u ** 3 * q.x, y: v ** 3 * p.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u ** 3 * q.y }; });
    poly = [p, q];
  } else {
    const hp = horizSide(ps), hq = horizSide(qs);
    if (hp && hq) {
      const mx = Math.abs(q.y - p.y) < 1 ? q.x : (p.x + q.x) / 2;
      d = Math.abs(q.y - p.y) < 1 ? `M${p.x} ${p.y} H${q.x}` : `M${p.x} ${p.y} H${mx} V${q.y} H${q.x}`;
      mid = Math.abs(q.y - p.y) < 1 ? { x: (p.x + q.x) / 2, y: p.y } : { x: mx, y: (p.y + q.y) / 2 };
      pts = Math.abs(q.y - p.y) < 1 ? [p, q] : [p, { x: mx, y: p.y }, { x: mx, y: q.y }, q];
    } else if (!hp && !hq) {
      const my = Math.abs(q.x - p.x) < 1 ? q.y : (p.y + q.y) / 2;
      d = Math.abs(q.x - p.x) < 1 ? `M${p.x} ${p.y} V${q.y}` : `M${p.x} ${p.y} V${my} H${q.x} V${q.y}`;
      mid = Math.abs(q.x - p.x) < 1 ? { x: p.x, y: (p.y + q.y) / 2 } : { x: (p.x + q.x) / 2, y: my };
      pts = Math.abs(q.x - p.x) < 1 ? [p, q] : [p, { x: p.x, y: my }, { x: q.x, y: my }, q];
    } else if (hp) { d = `M${p.x} ${p.y} H${q.x} V${q.y}`; mid = { x: (p.x + q.x) / 2, y: p.y }; pts = [p, { x: q.x, y: p.y }, q]; }
    else { d = `M${p.x} ${p.y} V${q.y} H${q.x}`; mid = { x: p.x, y: (p.y + q.y) / 2 }; pts = [p, { x: p.x, y: q.y }, q]; }
    poly = pts;
  }
  const heads: string[] = [];
  if (ends.end) heads.push(head(q.x, q.y, endDir));
  if (ends.start) heads.push(head(p.x, p.y, startDir));
  return { d, heads, mid, pts, poly };
}
