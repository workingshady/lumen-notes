// Edge routes for architecture diagrams: orthogonal (elbow, the default), straight or curved, with the design's
// filled arrowheads (ArchStudio.dc.html `head()`). Shared by the board (components/arch) and the SVG export.
import type { Side } from "../../shared/types";

export interface Box { x: number; y: number; width: number; height: number }
export interface Route { d: string; heads: string[]; mid: { x: number; y: number } }
type Dir = "r" | "l" | "d" | "u";
export const portAt = (b: Box, s: Side) => (s === "top" ? { x: b.x + b.width / 2, y: b.y } : s === "bottom" ? { x: b.x + b.width / 2, y: b.y + b.height } : s === "left" ? { x: b.x, y: b.y + b.height / 2 } : { x: b.x + b.width, y: b.y + b.height / 2 });
/** Head tip at (x, y) pointing `dir` (8 long, 9 wide). */
export const head = (x: number, y: number, dir: Dir) => ({ r: `M${x} ${y}l-8 -4.5v9z`, l: `M${x} ${y}l8 -4.5v9z`, d: `M${x} ${y}l-4.5 -8h9z`, u: `M${x} ${y}l-4.5 8h9z` }[dir]);
const into: Record<Side, Dir> = { left: "r", right: "l", top: "d", bottom: "u" };
const segDir = (a: { x: number; y: number }, b: { x: number; y: number }): Dir => (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? (b.x >= a.x ? "r" : "l") : b.y >= a.y ? "d" : "u");

export function route(p: { x: number; y: number }, ps: Side, q: { x: number; y: number }, qs: Side, shape: "orthogonal" | "straight" | "curved" = "orthogonal", ends: { start: boolean; end: boolean } = { start: false, end: true }, points?: { x: number; y: number }[]): Route {
  let d: string, mid: { x: number; y: number }, endDir: Dir = into[qs], startDir: Dir = into[ps];
  if (points && points.length >= 2) {
    d = `M${points[0].x} ${points[0].y}` + points.slice(1).map((pt) => ` L${pt.x} ${pt.y}`).join("");
    // label on the longest segment
    let best = 0, bi = 0;
    for (let i = 1; i < points.length; i++) { const len = Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y); if (len > best) { best = len; bi = i; } }
    mid = { x: (points[bi].x + points[bi - 1].x) / 2, y: (points[bi].y + points[bi - 1].y) / 2 };
    endDir = segDir(points[points.length - 2], points[points.length - 1]);
    startDir = segDir(points[1], points[0]);
    p = points[0]; q = points[points.length - 1];
  } else if (shape === "straight") {
    d = `M${p.x} ${p.y} L${q.x} ${q.y}`; mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    endDir = segDir(p, q); startDir = segDir(q, p);
  } else if (shape === "curved") {
    const k = Math.max(40, Math.hypot(q.x - p.x, q.y - p.y) / 3);
    const off = (s: Side) => (s === "left" ? [-k, 0] : s === "right" ? [k, 0] : s === "top" ? [0, -k] : [0, k]);
    const [ax, ay] = off(ps), [bx, by] = off(qs);
    d = `M${p.x} ${p.y} C${p.x + ax} ${p.y + ay} ${q.x + bx} ${q.y + by} ${q.x} ${q.y}`; mid = { x: (p.x + q.x) / 2 + (ax + bx) / 8, y: (p.y + q.y) / 2 + (ay + by) / 8 };
  } else {
    const hp = ps === "left" || ps === "right", hq = qs === "left" || qs === "right";
    if (hp && hq) {
      const mx = Math.abs(q.y - p.y) < 1 ? q.x : (p.x + q.x) / 2;
      d = Math.abs(q.y - p.y) < 1 ? `M${p.x} ${p.y} H${q.x}` : `M${p.x} ${p.y} H${mx} V${q.y} H${q.x}`;
      mid = Math.abs(q.y - p.y) < 1 ? { x: (p.x + q.x) / 2, y: p.y } : { x: mx, y: (p.y + q.y) / 2 };
    } else if (!hp && !hq) {
      const my = Math.abs(q.x - p.x) < 1 ? q.y : (p.y + q.y) / 2;
      d = Math.abs(q.x - p.x) < 1 ? `M${p.x} ${p.y} V${q.y}` : `M${p.x} ${p.y} V${my} H${q.x} V${q.y}`;
      mid = Math.abs(q.x - p.x) < 1 ? { x: p.x, y: (p.y + q.y) / 2 } : { x: (p.x + q.x) / 2, y: my };
    } else if (hp) { d = `M${p.x} ${p.y} H${q.x} V${q.y}`; mid = { x: (p.x + q.x) / 2, y: p.y }; }
    else { d = `M${p.x} ${p.y} V${q.y} H${q.x}`; mid = { x: p.x, y: (p.y + q.y) / 2 }; }
  }
  const heads: string[] = [];
  if (ends.end) heads.push(head(q.x, q.y, endDir));
  if (ends.start) heads.push(head(p.x, p.y, startDir));
  return { d, heads, mid };
}
