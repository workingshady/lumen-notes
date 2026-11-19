// <LayoutThumb> = the design's LayoutThumb (design/handoffs/2026-11-19-round-4/LayoutThumb.dc.html), 1:1.
// 96×64 layout thumbnails drawn from theme tokens, so they work in Lamplight and Paper. `scale` enlarges (gallery preview).
import type { CSSProperties } from "react";

type Rect = { x: number; y: number; w: number; h: number; f: string; r: number; b?: string };
const R = (x: number, y: number, w: number, h: number, f = "var(--surface-2)", o: { r?: number; b?: string } = {}): Rect => ({ x, y, w, h, f, r: o.r ?? 2, b: o.b });
const line = (x: number, y: number, w: number, c = "var(--muted)") => R(x, y, w, 3, `color-mix(in srgb, ${c} 45%, transparent)`, { r: 1.5 });
const tint = (c: string) => `color-mix(in srgb, ${c} 16%, var(--bg))`;
const lines = (x: number, y: number, w: number, n: number) => Array.from({ length: n }, (_, i) => line(x, y + i * 7, i === n - 1 ? w * 0.6 : w));
const panel = (c: string) => [R(8, 10, 80, 44, tint(c), { b: `1px solid color-mix(in srgb,${c} 45%,transparent)`, r: 5 }), R(13, 15, 8, 8, c, { r: 4 }), line(25, 17, 40, c), ...lines(13, 29, 64, 3)];

const M: Record<string, Rect[]> = {
  "cols-2": [R(8, 8, 37, 48), R(51, 8, 37, 48), ...lines(12, 14, 28, 3), ...lines(55, 14, 28, 3)],
  "cols-3": [R(8, 8, 24, 48), R(36, 8, 24, 48), R(64, 8, 24, 48), ...lines(11, 14, 18, 3), ...lines(39, 14, 18, 3), ...lines(67, 14, 18, 3)],
  "cols-side": [R(8, 8, 24, 48, tint("var(--accent)")), R(36, 8, 52, 48), ...lines(11, 14, 18, 3), ...lines(40, 14, 44, 5)],
  tabs: [R(8, 8, 20, 8, "var(--surface-2)", { r: 3 }), R(30, 8, 20, 8, "transparent", { b: "1px solid var(--border)", r: 3 }), R(52, 8, 20, 8, "transparent", { b: "1px solid var(--border)", r: 3 }), R(8, 18, 80, 38), ...lines(12, 24, 60, 4)],
  expand: [R(8, 10, 80, 12), line(18, 15, 40, "var(--text)"), R(11, 13, 4, 6, "var(--muted)", { r: 1 }), R(8, 26, 80, 12, "transparent", { b: "1px solid var(--border)" }), line(18, 31, 30)],
  "panel-info": panel("var(--info)"),
  "panel-tip": panel("var(--success)"),
  "panel-warn": panel("var(--warning)"),
  aside: [...lines(8, 12, 52, 6), R(64, 10, 24, 30, tint("var(--muted)"), { r: 4 }), line(67, 15, 16)],
  center: [line(22, 14, 52), line(16, 22, 64), line(26, 30, 44), line(30, 38, 36)],
  wide: [...lines(24, 8, 48, 2), R(4, 24, 88, 18, "var(--surface-2)"), ...lines(24, 48, 48, 2)],
  full: [...lines(24, 8, 48, 2), R(0, 24, 96, 18, tint("var(--accent)"), { r: 0 }), ...lines(24, 48, 48, 2)],
  toc: [R(10, 8, 46, 48, "transparent", { b: "1px solid var(--border)", r: 4 }), line(14, 14, 30, "var(--text)"), line(18, 23, 30), line(18, 31, 26), line(22, 39, 22), line(18, 47, 28)],
  include: [line(8, 10, 60), R(8, 18, 80, 34, "transparent", { b: "1px dashed var(--border)", r: 5 }), R(12, 22, 26, 7, tint("var(--link)"), { r: 3 }), ...lines(12, 34, 64, 2)],
  cards: [R(8, 8, 24, 48, "var(--surface-2)", { r: 5 }), R(36, 8, 24, 48, "var(--surface-2)", { r: 5 }), R(64, 8, 24, 48, "var(--surface-2)", { r: 5 }), line(11, 14, 16, "var(--text)"), line(39, 14, 16, "var(--text)"), line(67, 14, 16, "var(--text)")],
};
export const LAYOUT_THUMBS = Object.keys(M);

export function LayoutThumb({ kind, scale = 1, style }: { kind: string; scale?: number; style?: CSSProperties }) {
  const rects = M[kind] ?? M["cols-2"];
  return (
    <div aria-hidden style={{ width: 96 * scale, height: 64 * scale, position: "relative", flexShrink: 0, ...style }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: 96, height: 64, transform: `scale(${scale})`, transformOrigin: "0 0", borderRadius: 8, background: "var(--bg)", border: "1px solid var(--border)", boxSizing: "border-box", overflow: "hidden" }}>
        {rects.map((r, i) => (
          <span key={i} style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: r.r, background: r.f, border: r.b ?? "none", boxSizing: "border-box" }} />
        ))}
      </div>
    </div>
  );
}
