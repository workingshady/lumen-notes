// Canvas options (design round 7, frames 43A/B/D): node shapes, border + background styles, richer edges, groups
// (collapse, pattern) and the board background. Everything is stored under `lumen*` keys on nodes, edges and the
// canvas itself, so other JSON Canvas readers ignore it (they see a plain rectangle / arrow). The same helpers draw
// the board on screen (CanvasEditor) and in exports (canvas-render.ts), so both always match.
import type { CanvasEdge, CanvasNode, JsonCanvas } from "../../shared/types";

// ------------------------------------------------------------------ types
export type NodeShape = "rect" | "rounded" | "pill" | "diamond" | "circle" | "parallelogram" | "cylinder";
export type BorderStyle = "solid" | "dashed" | "dotted" | "none";
export type FillStyle = "none" | "tint" | "solid";
export type LineStyle = "solid" | "dashed" | "dotted";
export type HeadKind = "none" | "arrow" | "triangle" | "bar" | "dot" | "diamond";
export type LabelStyle = "pill" | "plain" | "hidden";
export type PathKind = "curved" | "elbow" | "straight";
export type Pattern = "none" | "dots" | "grid" | "lines";

export const SHAPES: [NodeShape, string, string][] = [
  ["rect", "Rectangle", "rect"], ["rounded", "Rounded", "rounded-rect"], ["pill", "Pill", "terminator"], ["diamond", "Diamond", "decision"],
  ["circle", "Circle", "ellipse"], ["parallelogram", "Parallel.", "parallelogram"], ["cylinder", "Cylinder", "cylinder"],
];
export const HEADS: [HeadKind, string, string][] = [
  ["none", "None", "arrowhead-none"], ["arrow", "Arrow", "arrowhead-arrow"], ["triangle", "Triangle", "arrowhead-triangle-outline"], ["bar", "Bar", "arrowhead-bar"], ["dot", "Dot", "arrowhead-dot"], ["diamond", "Diamond", "arrowhead-diamond"],
];
export const LABEL_STYLES: [LabelStyle, string][] = [["pill", "Pill"], ["plain", "Plain"], ["hidden", "Hidden"]];
export const PATTERNS: [Pattern, string][] = [["dots", "Dots"], ["grid", "Grid"], ["lines", "Lines"], ["none", "None"]];

// ------------------------------------------------------------------ node fields
type Ext = { lumenShape?: NodeShape; lumenBorder?: BorderStyle; lumenFill?: FillStyle; lumenCollapsed?: boolean; lumenPattern?: Pattern };
const X = (n: CanvasNode) => n as CanvasNode & Ext;
const SHAPE_SET = new Set<string>(SHAPES.map((s) => s[0]));
/** Plain cards read as "rounded" (the 10px card the board always had). */
export const shapeOf = (n: CanvasNode): NodeShape => (SHAPE_SET.has(X(n).lumenShape ?? "") ? X(n).lumenShape! : "rounded");
export const borderOf = (n: CanvasNode): BorderStyle => (["solid", "dashed", "dotted", "none"].includes(X(n).lumenBorder ?? "") ? X(n).lumenBorder! : "solid");
export const fillOf = (n: CanvasNode): FillStyle => (["none", "tint", "solid"].includes(X(n).lumenFill ?? "") ? X(n).lumenFill! : "tint");
export const isCollapsed = (n: CanvasNode) => n.type === "group" && !!X(n).lumenCollapsed;
/** Group fill pattern; the design default is Dots (43A), so "none" is the value that gets stored. */
export const patternOf = (n: CanvasNode): Pattern => (["none", "dots", "grid", "lines"].includes(X(n).lumenPattern ?? "") ? X(n).lumenPattern! : "dots");

/** Set (or, for the default value, remove) a `lumen*` field so untouched cards stay plain JSON Canvas. */
function put<T extends CanvasNode | CanvasEdge>(o: T, key: string, value: unknown, dflt: unknown): T {
  const { [key]: _old, ...rest } = o as unknown as Record<string, unknown>;
  return (value === dflt || value === undefined ? rest : { ...rest, [key]: value }) as unknown as T;
}
export const setShape = (n: CanvasNode, v: NodeShape) => put(n, "lumenShape", v, "rounded");
export const setBorder = (n: CanvasNode, v: BorderStyle) => put(n, "lumenBorder", v, "solid");
export const setFill = (n: CanvasNode, v: FillStyle) => put(n, "lumenFill", v, "tint");
export const setCollapsed = (n: CanvasNode, v: boolean) => put(n, "lumenCollapsed", v, false);
export const setPattern = (n: CanvasNode, v: Pattern) => put(n, "lumenPattern", v, "dots");
export const NODE_STYLE_KEYS = ["lumenShape", "lumenBorder", "lumenFill"] as const;
export const nodeStyleOf = (n: CanvasNode) => ({ shape: shapeOf(n), border: borderOf(n), fill: fillOf(n) });

// ------------------------------------------------------------------ edge fields
type EExt = { lumenPath?: PathKind; lumenLine?: LineStyle; lumenWidth?: number; lumenFromHead?: HeadKind; lumenToHead?: HeadKind; lumenLabel?: LabelStyle };
const EX = (e: CanvasEdge) => e as CanvasEdge & EExt;
export const edgePathOf = (e: CanvasEdge): PathKind | undefined => (["curved", "elbow", "straight"].includes(EX(e).lumenPath ?? "") ? EX(e).lumenPath : undefined);
export const lineOf = (e: CanvasEdge): LineStyle => (["solid", "dashed", "dotted"].includes(EX(e).lumenLine ?? "") ? EX(e).lumenLine! : "solid");
export const widthOf = (e: CanvasEdge) => { const w = EX(e).lumenWidth; return typeof w === "number" && w >= 1 && w <= 8 ? w : 2; };
export const labelStyleOf = (e: CanvasEdge): LabelStyle => (["pill", "plain", "hidden"].includes(EX(e).lumenLabel ?? "") ? EX(e).lumenLabel! : "pill");
/** The head at one end. JSON Canvas's own `toEnd` / `fromEnd` ("none" | "arrow") stay the source of truth for "is there a head"; `lumenToHead` / `lumenFromHead` pick the richer kind. */
export function headOf(e: CanvasEdge, end: "from" | "to"): HeadKind {
  const std = end === "to" ? (e.toEnd ?? "arrow") : (e.fromEnd ?? "none");
  if (std === "none") return "none";
  const k = end === "to" ? EX(e).lumenToHead : EX(e).lumenFromHead;
  return k && k !== "none" ? k : "arrow";
}
export function setHead(e: CanvasEdge, end: "from" | "to", k: HeadKind): CanvasEdge {
  const key = end === "to" ? "lumenToHead" : "lumenFromHead";
  const std = k === "none" ? "none" : "arrow";
  let out = put(e, key, k === "none" || k === "arrow" ? undefined : k, undefined);
  // `toEnd` defaults to "arrow" and `fromEnd` to "none" in JSON Canvas: only write the non-default.
  out = end === "to" ? put(out, "toEnd", std, "arrow") : put(out, "fromEnd", std, "none");
  return out;
}
export const setEdgePath = (e: CanvasEdge, v: PathKind | undefined) => put(e, "lumenPath", v, undefined);
export const setLine = (e: CanvasEdge, v: LineStyle) => put(e, "lumenLine", v, "solid");
export const setWidth = (e: CanvasEdge, v: number) => put(e, "lumenWidth", v, 2);
export const setLabelStyle = (e: CanvasEdge, v: LabelStyle) => put(e, "lumenLabel", v, "pill");
export const EDGE_STYLE_KEYS = ["lumenLine", "lumenWidth", "lumenFromHead", "lumenToHead", "lumenLabel", "toEnd", "fromEnd"] as const;
/** Pick the style fields of an edge (used for "defaults for new edges"). */
export function edgeStyleOf(e: CanvasEdge): Partial<CanvasEdge> {
  const out: Record<string, unknown> = {};
  for (const k of EDGE_STYLE_KEYS) if ((e as unknown as Record<string, unknown>)[k] !== undefined) out[k] = (e as unknown as Record<string, unknown>)[k];
  return out as Partial<CanvasEdge>;
}

// ------------------------------------------------------------------ canvas-level fields
export interface CanvasMeta {
  lumenBackground?: { pattern?: Pattern; color?: string };
  lumenEdgePath?: PathKind;
  lumenGroups?: { collapsible?: boolean };
}
export const META_KEYS = ["lumenBackground", "lumenEdgePath", "lumenGroups"] as const;
/** The `lumen*` fields at the top level of a canvas file (cleaned). */
export function pickMeta(c: unknown): CanvasMeta {
  const o = (c ?? {}) as Record<string, unknown>;
  const out: CanvasMeta = {};
  const bg = o.lumenBackground as CanvasMeta["lumenBackground"];
  if (bg && typeof bg === "object") out.lumenBackground = { ...(["dots", "grid", "lines", "none"].includes(bg.pattern ?? "") ? { pattern: bg.pattern } : {}), ...(typeof bg.color === "string" && bg.color ? { color: bg.color } : {}) };
  if (o.lumenEdgePath === "curved" || o.lumenEdgePath === "elbow" || o.lumenEdgePath === "straight") out.lumenEdgePath = o.lumenEdgePath;
  const g = o.lumenGroups as CanvasMeta["lumenGroups"];
  if (g && typeof g === "object" && typeof g.collapsible === "boolean") out.lumenGroups = { collapsible: g.collapsible };
  return out;
}
export const bgPatternOf = (m: CanvasMeta): Pattern => m.lumenBackground?.pattern ?? "dots";
export const bgColorOf = (m: CanvasMeta) => m.lumenBackground?.color;
export const collapsibleOf = (m: CanvasMeta) => m.lumenGroups?.collapsible !== false;
export const withMeta = (c: JsonCanvas, m: CanvasMeta): JsonCanvas => ({ ...c, ...pickMeta(m) });

/** Cards (not groups) whose centre lies inside the group's box: its members for "N cards" and collapse. */
export function membersOf(g: CanvasNode, nodes: { id: string; x: number; y: number; width: number; height: number; type: string }[]): string[] {
  return nodes.filter((n) => n.id !== g.id && n.type !== "group" && n.x + n.width / 2 >= g.x && n.x + n.width / 2 <= g.x + g.width && n.y + n.height / 2 >= g.y && n.y + n.height / 2 <= g.y + g.height).map((n) => n.id);
}

// ------------------------------------------------------------------ colours
/** Round-7 palettes (design 37) offered next to the six presets. Lumen ink is theme-aware (dark / light variants). */
export const CANVAS_PALETTES: Record<string, { dark: string[]; light?: string[] }> = {
  "Lumen ink": { dark: ["#E8E6E1", "#9AA0AA", "#EF6B6B", "#F2A93B", "#E3B341", "#6BCB8B", "#5CC8C2", "#7AA2F7", "#B48EF0", "#F25C9A"], light: ["#1F1D1A", "#6A655C", "#C42B2B", "#B45F0E", "#A86A00", "#1F8A4C", "#0F7C78", "#2F5BD3", "#7A4BD1", "#B0306A"] },
  "Paper stickies": { dark: ["#fff3bf", "#d3f9d8", "#d0ebff", "#ffd8a8", "#eebefa", "#ffc9c9"] },
  "Colour-blind safe": { dark: ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#000000"] },
  Greys: { dark: ["#F2F0EA", "#C9C6BF", "#9AA0AA", "#6A655C", "#3A3E46", "#1F1D1A"] },
  Vivid: { dark: ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#00C7BE", "#30B0C7", "#007AFF", "#5856D6", "#AF52DE", "#FF2D55"] },
};

// ------------------------------------------------------------------ SVG drawing (export + the board's non-CSS shapes)
export const dashFor = (b: BorderStyle | LineStyle, w: number): string | undefined => (b === "dashed" ? `${Math.round(w * 4 + 2)} ${Math.round(w * 2.5 + 2)}` : b === "dotted" ? `${w * 0.1} ${Math.round(w * 2 + 2)}` : undefined);
const f = (n: number) => +n.toFixed(2);

/** Outline of a shape in a w×h box at (x, y), as an SVG path (`rim` = the cylinder's front lip). */
export function shapePath(shape: NodeShape, x: number, y: number, w: number, h: number): { d: string; rim?: string } {
  const r = shape === "rect" ? 4 : shape === "rounded" ? 10 : shape === "pill" ? h / 2 : 0;
  if (shape === "diamond") return { d: `M${f(x + w / 2)} ${y}L${x + w} ${f(y + h / 2)}L${f(x + w / 2)} ${y + h}L${x} ${f(y + h / 2)}Z` };
  if (shape === "parallelogram") { const s = Math.min(w * 0.18, 44); return { d: `M${f(x + s)} ${y}L${x + w} ${y}L${f(x + w - s)} ${y + h}L${x} ${y + h}Z` }; }
  if (shape === "cylinder") {
    const ry = Math.min(h * 0.14, 22), rx = w / 2;
    return { d: `M${x} ${f(y + ry)}A${f(rx)} ${f(ry)} 0 0 1 ${x + w} ${f(y + ry)}V${f(y + h - ry)}A${f(rx)} ${f(ry)} 0 0 1 ${x} ${f(y + h - ry)}Z`, rim: `M${x} ${f(y + ry)}A${f(rx)} ${f(ry)} 0 0 0 ${x + w} ${f(y + ry)}` };
  }
  if (shape === "circle") { const rx = w / 2, ry = h / 2; return { d: `M${x} ${f(y + ry)}A${f(rx)} ${f(ry)} 0 1 0 ${x + w} ${f(y + ry)}A${f(rx)} ${f(ry)} 0 1 0 ${x} ${f(y + ry)}Z` }; }
  const rr = Math.min(r, w / 2, h / 2);
  return { d: `M${f(x + rr)} ${y}H${f(x + w - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${x + w} ${f(y + rr)}V${f(y + h - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x + w - rr)} ${y + h}H${f(x + rr)}A${f(rr)} ${f(rr)} 0 0 1 ${x} ${f(y + h - rr)}V${f(y + rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x + rr)} ${y}Z` };
}
/** Padding (px) a shape needs inside its box so text stays within the outline. */
/** Same, as percentages of the box (the board sizes cards with CSS). */
export function shapeInsetPct(shape: NodeShape): { l: number; r: number; t: number; b: number } | null {
  if (shape === "diamond") return { l: 22, r: 22, t: 20, b: 20 };
  if (shape === "circle") return { l: 12, r: 12, t: 10, b: 10 };
  if (shape === "pill") return { l: 6, r: 6, t: 0, b: 0 };
  if (shape === "parallelogram") return { l: 15, r: 15, t: 0, b: 0 };
  if (shape === "cylinder") return { l: 0, r: 0, t: 22, b: 8 };
  return null;
}
export function shapeInset(shape: NodeShape, w: number, h: number): { l: number; r: number; t: number; b: number } {
  if (shape === "diamond") return { l: w * 0.22, r: w * 0.22, t: h * 0.2, b: h * 0.2 };
  if (shape === "circle") return { l: w * 0.12, r: w * 0.12, t: h * 0.1, b: h * 0.1 };
  if (shape === "pill") return { l: Math.min(h * 0.35, 24), r: Math.min(h * 0.35, 24), t: 0, b: 0 };
  if (shape === "parallelogram") { const s = Math.min(w * 0.18, 44); return { l: s, r: s, t: 0, b: 0 }; }
  if (shape === "cylinder") { const ry = Math.min(h * 0.14, 22); return { l: 0, r: 0, t: ry * 1.6, b: ry * 0.8 }; }
  return { l: 0, r: 0, t: 0, b: 0 };
}

/** `<marker>` for an arrowhead kind. Sizes scale with the line thickness (markerUnits=strokeWidth). */
export function markerSvg(kind: HeadKind, id: string, color: string): string {
  if (kind === "none") return "";
  const shape = kind === "arrow" ? `<path d="M0 1L10 5L0 9Z" fill="${color}" stroke="${color}" stroke-width="1" stroke-linejoin="round"/>`
    : kind === "triangle" ? `<path d="M0 0L10 5L0 10Z" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/>`
    : kind === "bar" ? `<path d="M9 0V10" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`
    : kind === "dot" ? `<circle cx="5" cy="5" r="3.6" fill="${color}"/>`
    : `<path d="M0 5L5 1L10 5L5 9Z" fill="${color}" stroke="${color}" stroke-width="1" stroke-linejoin="round"/>`;
  const refX = kind === "dot" ? 5 : kind === "bar" ? 9 : kind === "diamond" ? 9 : 9;
  return `<marker id="${id}" viewBox="0 0 10 10" refX="${refX}" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse" markerUnits="strokeWidth" overflow="visible">${shape}</marker>`;
}
export const markerId = (kind: HeadKind, color: string) => `lcm-${kind}-${color.replace(/[^a-zA-Z0-9]/g, "")}`;

export type Pt = { x: number; y: number; s: string };
const outward = (p: Pt, d: number) => (p.s === "left" ? { x: p.x - d, y: p.y } : p.s === "right" ? { x: p.x + d, y: p.y } : p.s === "top" ? { x: p.x, y: p.y - d } : { x: p.x, y: p.y + d });
/** Edge path (export): curved = cubic, elbow = rounded right angles, straight = a line. */
export function edgePathD(path: PathKind, s: Pt, t: Pt): { d: string; mid: { x: number; y: number } } {
  if (path === "straight") return { d: `M${s.x} ${s.y}L${t.x} ${t.y}`, mid: { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 } };
  if (path === "curved") {
    const d = Math.max(40, Math.hypot(t.x - s.x, t.y - s.y) / 3), c1 = outward(s, d), c2 = outward(t, d);
    const mx = (s.x + 3 * c1.x + 3 * c2.x + t.x) / 8, my = (s.y + 3 * c1.y + 3 * c2.y + t.y) / 8; // bezier at t = .5
    return { d: `M${s.x} ${s.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${t.x} ${t.y}`, mid: { x: mx, y: my } };
  }
  const horiz = (p: Pt) => p.s === "left" || p.s === "right";
  const g = 20, a = outward(s, g), b = outward(t, g);
  let pts: { x: number; y: number }[];
  if (horiz(s) && horiz(t)) { const mx = (a.x + b.x) / 2; pts = [s, { x: mx, y: s.y }, { x: mx, y: t.y }, t]; }
  else if (!horiz(s) && !horiz(t)) { const my = (a.y + b.y) / 2; pts = [s, { x: s.x, y: my }, { x: t.x, y: my }, t]; }
  else if (horiz(s)) pts = [s, { x: t.x, y: s.y }, t];
  else pts = [s, { x: s.x, y: t.y }, t];
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    const r = Math.min(10, Math.hypot(p1.x - p0.x, p1.y - p0.y) / 2, Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2);
    const u = (a: typeof p0, b: typeof p0) => { const L = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / L, y: (b.y - a.y) / L }; };
    const u1 = u(p1, p0), u2 = u(p1, p2);
    d += `L${f(p1.x + u1.x * r)} ${f(p1.y + u1.y * r)}Q${p1.x} ${p1.y} ${f(p1.x + u2.x * r)} ${f(p1.y + u2.y * r)}`;
  }
  d += `L${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  const m = pts.length === 4 ? { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 } : pts[1];
  return { d, mid: m };
}

/** CSS background for a pattern over a surface (board background, group fill). `ink` is the dot / line colour. */
export function patternCss(p: Pattern, ink: string, gap = 22): { backgroundImage?: string; backgroundSize?: string } {
  if (p === "dots") return { backgroundImage: `radial-gradient(${ink} 1px, transparent 1.2px)`, backgroundSize: `${gap}px ${gap}px` };
  if (p === "grid") return { backgroundImage: `linear-gradient(${ink} 1px, transparent 1px), linear-gradient(90deg, ${ink} 1px, transparent 1px)`, backgroundSize: `${gap}px ${gap}px` };
  if (p === "lines") return { backgroundImage: `linear-gradient(${ink} 1px, transparent 1px)`, backgroundSize: `100% ${gap}px` };
  return {};
}
/** SVG `<pattern>` for exports: returns the def and the fill reference. */
export function patternSvg(p: Pattern, id: string, ink: string, opacity: number, gap = 22): string {
  if (p === "none") return "";
  const inner = p === "dots" ? `<circle cx="1" cy="1" r="1" fill="${ink}" fill-opacity="${opacity}"/>`
    : p === "grid" ? `<path d="M${gap} 0H0V${gap}" fill="none" stroke="${ink}" stroke-opacity="${opacity}" stroke-width="1"/>`
    : `<path d="M0 ${gap}H${gap}" stroke="${ink}" stroke-opacity="${opacity}" stroke-width="1"/>`;
  return `<pattern id="${id}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse">${inner}</pattern>`;
}
