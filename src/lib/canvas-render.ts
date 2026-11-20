// SVG drawing of the canvas options for exports (canvasSvg in visual-export.ts calls these), so an exported board
// matches the screen: node shapes, border styles, card backgrounds, edge path / line / heads / label style, collapsible
// groups with their "N cards" chip, group patterns and the board background. The on-screen board (CanvasEditor)
// uses the same helpers from canvas-style.ts.
import type { CanvasEdge, CanvasNode, JsonCanvas } from "../../shared/types";
import { colorOf } from "./canvas";
import {
  bgColorOf, bgPatternOf, borderOf, collapsibleOf, dashFor, edgePathD, edgePathOf, fillOf, headOf, isCollapsed, labelStyleOf, lineOf, markerId, markerSvg, membersOf,
  patternOf, patternSvg, pickMeta, shapeInset, shapeOf, shapePath, widthOf, type CanvasMeta, type HeadKind, type PathKind, type Pt,
} from "./canvas-style";
import { t } from "./i18n";

export interface Pal { surface: string; surface2: string; border: string; text: string; muted: string; accent: string }
/** Canvas-only export toggles (frame 43C): draw the card styles, the group labels, the edge labels. All on by default. */
export interface CanvasSvgOpts { cardStyle?: boolean; groupLabels?: boolean; edgeLabels?: boolean }
export const GROUP_HEAD = 44; // height a collapsed group keeps (title + chip)

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
const FONT = "Inter, 'IBM Plex Sans Arabic', system-ui, sans-serif";
const txt = (s: string, x: number, y: number, size: number, fill: string, weight = 400, anchor = "start") =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" font-family="${FONT}" text-anchor="${anchor}">${esc(s)}</text>`;

/** The cards hidden because a collapsed group holds them. */
export function hiddenByCollapse(nodes: CanvasNode[]): Set<string> {
  const hide = new Set<string>();
  for (const g of nodes) if (isCollapsed(g)) for (const id of membersOf(g, nodes)) hide.add(id);
  return hide;
}
/** What a box looks like when drawn: the node, or (for a collapsed group) just its header strip. */
export const drawnHeight = (n: CanvasNode) => (isCollapsed(n) ? Math.min(n.height, GROUP_HEAD) : n.height);

/** A card inset so text stays inside its shape (diamond, circle, parallelogram, cylinder, pill). */
export function insetNode<T extends CanvasNode>(n: T): T {
  const i = shapeInset(shapeOf(n), n.width, n.height);
  return { ...n, x: n.x + i.l, y: n.y + i.t, width: n.width - i.l - i.r, height: n.height - i.t - i.b };
}

/** The card's outline + background. With `styled` off every card is the plain rounded rectangle. Returns the SVG and whether the fill is solid (dark text). */
export function cardFrame(n: CanvasNode, P: Pal, styled: boolean): { svg: string; solid: boolean } {
  const col = colorOf(n.color);
  const shape = styled ? shapeOf(n) : "rounded", border = styled ? borderOf(n) : "solid", fill = styled ? fillOf(n) : "tint";
  const { d, rim } = shapePath(shape, n.x, n.y, n.width, n.height);
  const sw = col ? 1.5 : 1;
  const stroke = border === "none" ? "none" : col ?? P.border;
  const dash = dashFor(border, sw);
  const base = fill === "none" ? "" : `<path d="${d}" fill="${fill === "solid" && col ? col : P.surface}"/>`;
  const tint = fill === "tint" && col ? `<path d="${d}" fill="${col}" fill-opacity=".1"/>` : "";
  const line = `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}" stroke-linecap="round"` : ""}/>`;
  const lip = rim && border !== "none" ? `<path d="${rim}" fill="none" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}" stroke-linecap="round"` : ""}/>` : "";
  return { svg: base + tint + line + lip, solid: fill === "solid" && !!col };
}

/** A group: tinted box with optional pattern; title + "N cards" chip inside (collapsible) or the label above (classic). */
export function drawGroup(n: CanvasNode, nodes: CanvasNode[], meta: CanvasMeta, P: Pal, o: CanvasSvgOpts, patId: (p: string) => string): { svg: string; text: string[] } {
  const col = colorOf(n.color) ?? P.border;
  const h = drawnHeight(n);
  const text: string[] = [];
  let svg = `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${h}" rx="16" fill="${col}" fill-opacity=".07" stroke="${col}" stroke-width="1.5"/>`;
  const pat = patternOf(n);
  if (pat !== "none" && !isCollapsed(n)) svg += `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${h}" rx="16" fill="url(#${patId(pat)})"/>`;
  const label = n.type === "group" ? n.label ?? "" : "";
  if (collapsibleOf(meta)) {
    const count = membersOf(n, nodes).length;
    const chipTxt = t("{n} card|{n} cards", { n: count });
    const w = Math.round(chipTxt.length * 6.6 + 24);
    if (o.groupLabels !== false && label) { svg += txt(isCollapsed(n) ? "▸" : "▾", n.x + 14, n.y + 25, 12, P.muted) + txt(label, n.x + 30, n.y + 25, 13, P.text, 600); text.push(label); }
    svg += `<rect x="${n.x + n.width - w - 14}" y="${n.y + 8}" width="${w}" height="24" rx="12" fill="${P.surface2}" stroke="${P.border}"/>${txt(chipTxt, n.x + n.width - w / 2 - 14, n.y + 24.5, 11.5, P.text, 500, "middle")}`;
    text.push(chipTxt);
  } else if (o.groupLabels !== false && label) { svg += txt(label, n.x + 14, n.y - 10, 14, col, 600); text.push(label); }
  return { svg, text };
}

/** Where an edge leaves / enters a card: the side's midpoint, else the side facing the other card. */
export function anchorOf(n: CanvasNode, side: string | undefined, toward: CanvasNode): Pt {
  const w = n.width, h = drawnHeight(n);
  const cx = n.x + w / 2, cy = n.y + h / 2;
  const s = side ?? (Math.abs(toward.x + toward.width / 2 - cx) * h > Math.abs(toward.y + drawnHeight(toward) / 2 - cy) * w ? (toward.x > n.x ? "right" : "left") : (toward.y > n.y ? "bottom" : "top"));
  return s === "left" ? { x: n.x, y: cy, s } : s === "right" ? { x: n.x + w, y: cy, s } : s === "top" ? { x: cx, y: n.y, s } : { x: cx, y: n.y + h, s };
}

/** Collects arrowhead markers while edges are drawn; `defs()` gives the `<defs>` body. */
export class Markers {
  private m = new Map<string, string>();
  ref(kind: HeadKind, color: string): string { const id = markerId(kind, color); if (!this.m.has(id)) this.m.set(id, markerSvg(kind, id, color)); return id; }
  defs() { return [...this.m.values()].join(""); }
}

export function drawEdge(e: CanvasEdge, a: CanvasNode, b: CanvasNode, meta: CanvasMeta, P: Pal, o: CanvasSvgOpts, mk: Markers): { svg: string; text?: string } {
  const col = colorOf(e.color) ?? P.muted;
  const path: PathKind = edgePathOf(e) ?? meta.lumenEdgePath ?? "straight";
  const s = anchorOf(a, e.fromSide, b), tt = anchorOf(b, e.toSide, a);
  const { d, mid } = edgePathD(path, s, tt);
  const w = widthOf(e), dash = dashFor(lineOf(e), w);
  const hs = headOf(e, "from"), he = headOf(e, "to");
  let svg = `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}" stroke-linecap="round"` : ""}${he !== "none" ? ` marker-end="url(#${mk.ref(he, col)})"` : ""}${hs !== "none" ? ` marker-start="url(#${mk.ref(hs, col)})"` : ""}/>`;
  const style = labelStyleOf(e);
  if (e.label && style !== "hidden" && o.edgeLabels !== false) {
    const lw = Math.min(260, e.label.length * 7.4 + 16);
    svg += style === "pill"
      ? `<rect x="${mid.x - lw / 2}" y="${mid.y - 12}" width="${lw}" height="24" rx="6" fill="${P.surface}" stroke="${P.border}"/>${txt(e.label, mid.x, mid.y + 4.5, 12.5, P.text, 400, "middle")}`
      : txt(e.label, mid.x, mid.y - 6, 12.5, P.muted, 500, "middle");
    return { svg, text: e.label };
  }
  return { svg };
}

/** Board background for an export: the canvas colour (tinted into the page) and the dots / grid / lines pattern. Only when the export has an opaque background. */
export function boardBackground(meta: CanvasMeta, P: Pal, x: number, y: number, w: number, h: number): { defs: string; svg: string } {
  const color = bgColorOf(meta);
  const c = color ? colorOf(color) ?? color : undefined;
  const pat = bgPatternOf(meta);
  const id = "lcbg";
  let svg = c ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}" fill-opacity=".1"/>` : "";
  if (pat !== "none") svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id})"/>`;
  return { defs: patternSvg(pat, id, P.muted, pat === "dots" ? 0.55 : 0.2), svg };
}
/** `<pattern>` defs for group patterns used in a canvas (ids returned via `patId`). */
export function groupPatterns(nodes: CanvasNode[], P: Pal): { defs: string; id: (p: string) => string } {
  const used = new Set(nodes.map(patternOf).filter((p) => p !== "none"));
  return { defs: [...used].map((p) => patternSvg(p, `lcgp-${p}`, P.muted, p === "dots" ? 0.6 : 0.22, 16)).join(""), id: (p) => `lcgp-${p}` };
}
export { pickMeta };
export type { JsonCanvas };
