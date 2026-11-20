// Edge labels of the architecture studio: where each label sits on the route and how it looks. Shared by the board
// (components/arch/ArchFlow) and the SVG export (arch-render). The middle text is the edge `label` (the DSL keeps only
// that); start / end text, style, position and the protocol chip live in `lumenEdge` (JSON only).
import { PRESET, type AEdge, type LabelStyle } from "./arch-model";
import { angleAtPoint, polyAt, polyLength, routeAt, type Route } from "./arch-route";

export type LabelPart = "start" | "mid" | "end";
export const LBL_PX = { S: 9.5, M: 10.5, L: 12 } as const;
export interface LabelLook { fs: number; fw: number; color: string; bg: string; border: string; radius: number; pad: string }
const col = (c: string | undefined) => (c ? PRESET[c] ?? c : undefined);

export const lblStyle = (e: AEdge): LabelStyle => e.lumenEdge?.labelStyle ?? {};
/** Text of a label part: the middle text is the edge label itself. */
export const partText = (e: AEdge, part: LabelPart) => (part === "mid" ? e.label ?? "" : e.lumenEdge?.labels?.[part] ?? "");
/** "HTTPS · 443" from the protocol and port rows; hidden when the chip is switched off. */
export function chipOf(e: AEdge): string {
  const le = e.lumenEdge;
  if (!le || le.labelStyle?.chip === false) return "";
  return [le.protocol, le.port].filter(Boolean).join(" · ");
}
export function labelLook(ls: LabelStyle): LabelLook {
  const kind = ls.kind ?? "plain";
  const fs = LBL_PX[ls.size ?? "M"], color = col(ls.color) ?? "var(--muted)", fw = ls.bold ? 700 : 500;
  if (kind === "pill") return { fs, fw, color, bg: col(ls.bg) ?? "var(--surface-2)", border: "1px solid var(--border)", radius: 999, pad: "1px 8px" };
  if (kind === "boxed") return { fs, fw, color, bg: col(ls.bg) ?? "var(--surface)", border: "1px solid var(--border)", radius: 4, pad: "2px 6px" };
  return { fs, fw, color, bg: col(ls.bg) ?? "var(--bg)", border: "1px solid transparent", radius: 4, pad: "1px 5px" };
}

export interface LabelSpot { part: LabelPart; text: string; x: number; y: number; angle: number }
/** Anchor of a part before the above / below offset: the middle follows `labelPos`, ends sit 36px in from their node. */
function anchor(e: AEdge, r: Route, part: LabelPart) {
  const total = polyLength(r.pts), inset = Math.min(36, total * 0.3);
  if (part === "start") return polyAt(r.pts, inset);
  if (part === "end") return polyAt(r.pts, total - inset);
  const lp = e.lumenEdge?.labelPos;
  return lp == null ? { ...r.mid, angle: angleAtPoint(r.pts, r.mid) } : routeAt(r, lp);
}
/** Position of the middle label for a given `labelPos` (the drag preview uses it too). */
export function labelSpot(e: AEdge, r: Route, part: LabelPart, text = partText(e, part)): LabelSpot {
  const ls = lblStyle(e), a = anchor(e, r, part);
  let { x, y } = a;
  const rad = (a.angle * Math.PI) / 180;
  // a label wider than its line (a short hop between neighbours) would hide the line and its arrow: it sits above instead
  const tw = (text.length + (part === "mid" ? chipOf(e).length : 0)) * LBL_PX[ls.size ?? "M"] * 0.62 + 14;
  const place = ls.place ?? (part === "mid" && polyLength(r.pts) < tw + 28 ? "above" : "on");
  if (place !== "on") {
    // the normal pointing up (or right on a vertical run) is "above"
    let nx = Math.sin(rad), ny = -Math.cos(rad);
    if (ny > 0.001 || (Math.abs(ny) <= 0.001 && nx < 0)) { nx = -nx; ny = -ny; }
    const k = (place === "above" ? 1 : -1) * (LBL_PX[ls.size ?? "M"] / 2 + 9);
    x += nx * k; y += ny * k;
  }
  let angle = 0;
  if (ls.follow) { angle = a.angle; if (angle > 90) angle -= 180; if (angle <= -90) angle += 180; }
  return { part, text, x, y, angle };
}
/** Every visible text label of an edge, in draw order. */
export function labelSpots(e: AEdge, r: Route): LabelSpot[] {
  if (lblStyle(e).hidden) return [];
  return (["start", "mid", "end"] as const).filter((p) => partText(e, p) || (p === "mid" && chipOf(e))).map((p) => labelSpot(e, r, p));
}
