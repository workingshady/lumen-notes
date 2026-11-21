// On-device shape recognition (design 34E, R6Parts "Auto-shape"): a rough circle, rectangle, triangle, line or arrow
// drawn with a pen snaps to a clean Excalidraw element. No AI. Also the scratch-out gesture detector.
import { tk } from "../../../lib/i18n";

type Pt = [number, number];
export type Recognised =
  | { kind: "ellipse"; x: number; y: number; w: number; h: number }
  | { kind: "rectangle"; x: number; y: number; w: number; h: number; angle: number }
  | { kind: "triangle"; pts: Pt[] }
  | { kind: "line"; a: Pt; b: Pt }
  | { kind: "arrow"; a: Pt; b: Pt };
export const SNAP_NAME: Record<Recognised["kind"], string> = { ellipse: tk("circle"), rectangle: tk("rectangle"), triangle: tk("triangle"), line: tk("line"), arrow: tk("arrow") };

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const segDist = (p: Pt, a: Pt, b: Pt) => {
  const l2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  if (!l2) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l2));
  return dist(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
};
/** Ramer–Douglas–Peucker. */
function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], pts[0], pts[pts.length - 1]); if (d > max) { max = d; idx = i; } }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}
const pathLen = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + dist(p, pts[i - 1]) : 0), 0);

/** Absolute points of a freedraw element. */
export const absPoints = (el: { x: number; y: number; points?: unknown }) => ((el.points as Pt[]) ?? []).map(([px, py]) => [el.x + px, el.y + py] as Pt);

export function recognise(pts: Pt[]): Recognised | null {
  if (pts.length < 4) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY, diag = Math.hypot(w, h);
  if (diag < 16) return null;
  const len = pathLen(pts);
  const a = pts[0], b = pts[pts.length - 1];
  const closed = dist(a, b) < Math.max(18, diag * 0.22);
  if (!closed) {
    // line: every point near the chord
    const dev = Math.max(...pts.map((p) => segDist(p, a, b)));
    if (dev < Math.max(6, dist(a, b) * 0.07) && len < dist(a, b) * 1.15) return { kind: "line", a, b };
    // arrow: a long shaft, then a short head going back from the shaft's end
    const simp = rdp(pts, diag * 0.08);
    if (simp.length >= 3 && simp.length <= 5) {
      const shaftEnd = simp[1], shaft = dist(simp[0], shaftEnd);
      const tail = pathLen(simp.slice(1));
      const shaftDev = Math.max(...pts.slice(0, pts.findIndex((p) => p === shaftEnd || dist(p, shaftEnd) < 1) + 1 || 2).map((p) => segDist(p, simp[0], shaftEnd)));
      if (shaft > tail * 1.6 && tail > shaft * 0.12 && shaftDev < shaft * 0.12 && simp.slice(2).every((p) => dist(p, shaftEnd) < shaft * 0.45)) return { kind: "arrow", a: simp[0], b: shaftEnd };
    }
    return null;
  }
  // closed shapes: corners from RDP on the closed loop
  const loop = [...pts, pts[0]];
  const corners = rdp(loop, diag * 0.1).slice(0, -1);
  // ellipse first when the radius is steady
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, rx = w / 2, ry = h / 2;
  if (rx > 4 && ry > 4) {
    const err = pts.reduce((s, p) => s + Math.abs(Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry) - 1), 0) / pts.length;
    if (err < 0.1 && corners.length !== 4 && corners.length !== 3) return { kind: "ellipse", x: minX, y: minY, w, h };
    if (err < 0.07) return { kind: "ellipse", x: minX, y: minY, w, h };
  }
  if (corners.length === 3) return { kind: "triangle", pts: corners };
  if (corners.length === 4) {
    // rectangle: angle from the longest edge, size from the points rotated into that frame
    let best = 0, ang = 0;
    for (let i = 0; i < 4; i++) { const p = corners[i], q = corners[(i + 1) % 4]; const d = dist(p, q); if (d > best) { best = d; ang = Math.atan2(q[1] - p[1], q[0] - p[0]); } }
    ang = ((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    if (ang > Math.PI / 4) ang -= Math.PI / 2;
    if (Math.abs(ang) < (6 * Math.PI) / 180) ang = 0;
    const c = Math.cos(-ang), s = Math.sin(-ang);
    const rot = pts.map(([x, y]) => [(x - cx) * c - (y - cy) * s, (x - cx) * s + (y - cy) * c] as Pt);
    const rxs = rot.map((p) => p[0]), rys = rot.map((p) => p[1]);
    const rw = Math.max(...rxs) - Math.min(...rxs), rh = Math.max(...rys) - Math.min(...rys);
    const mx = (Math.max(...rxs) + Math.min(...rxs)) / 2, my = (Math.max(...rys) + Math.min(...rys)) / 2;
    const ccx = cx + mx * Math.cos(ang) - my * Math.sin(ang), ccy = cy + mx * Math.sin(ang) + my * Math.cos(ang);
    return { kind: "rectangle", x: ccx - rw / 2, y: ccy - rh / 2, w: rw, h: rh, angle: ang };
  }
  if (rx > 4 && ry > 4) return { kind: "ellipse", x: minX, y: minY, w, h };
  return null;
}

/** Excalidraw element props (without ids/versions) for a recognised shape, styled like the source stroke. */
export function snappedElement(r: Recognised, src: Record<string, unknown>): Record<string, unknown> {
  const style = { strokeColor: src.strokeColor, backgroundColor: "transparent", fillStyle: "solid", strokeWidth: Math.max(1, Math.min(4, Math.round(Number(src.strokeWidth) * 2) / 2 || 2)), strokeStyle: "solid", roughness: 0, opacity: src.opacity ?? 100, groupIds: src.groupIds ?? [], frameId: src.frameId ?? null, customData: { lumenSnapFrom: src.id } };
  switch (r.kind) {
    case "ellipse": return { type: "ellipse", x: r.x, y: r.y, width: r.w, height: r.h, ...style };
    case "rectangle": return { type: "rectangle", x: r.x, y: r.y, width: r.w, height: r.h, angle: (r.angle + 2 * Math.PI) % (2 * Math.PI), roundness: null, ...style };
    case "triangle": {
      const [p0] = r.pts;
      const pts = [...r.pts, r.pts[0]].map(([x, y]) => [x - p0[0], y - p0[1]]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return { type: "line", x: p0[0], y: p0[1], width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), points: pts, polygon: true, roundness: null, ...style };
    }
    case "line": case "arrow": {
      const dx = r.b[0] - r.a[0], dy = r.b[1] - r.a[1];
      return { type: r.kind, x: r.a[0], y: r.a[1], width: Math.abs(dx), height: Math.abs(dy), points: [[0, 0], [dx, dy]], roundness: null, startArrowhead: null, endArrowhead: r.kind === "arrow" ? "arrow" : null, ...style };
    }
  }
}

/** Scratch-out: a dense back-and-forth scribble (≥ 6 reversals along its main axis, path ≥ 5× its span). Returns its bounds. */
export function isScratch(pts: Pt[]): { x: number; y: number; w: number; h: number } | null {
  if (pts.length < 16) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  const axis = w >= h ? 0 : 1, span = Math.max(w, h);
  if (span < 20 || pathLen(pts) < span * 5) return null;
  let rev = 0, dir = 0, acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i][axis] - pts[i - 1][axis];
    if (!d) continue;
    const s = Math.sign(d);
    acc += Math.abs(d);
    if (dir && s !== dir && acc > span * 0.3) { rev++; acc = 0; }
    if (s !== dir) dir = s;
  }
  return rev >= 6 ? { x: minX, y: minY, w, h } : null;
}
