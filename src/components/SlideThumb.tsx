// Slide thumbnails (design round 4, SlideThumb.dc.html): a schematic of each of the 11 layouts (+ blank) with
// normal / invert / accent variants, drawn at 320 × 180 and scaled. Used by the layout picker; `SlideFrame` wraps a
// real rendered slide (SlideStage) in the same frame (radius W/32, 1 px ring, 2 px accent ring when selected).
import type { CSSProperties, ReactNode } from "react";
import { t, tk } from "../lib/i18n";
import { activeTheme, useSettings } from "../lib/settings";

export const LAYOUT_LABELS: [string, string][] = [
  ["title", tk("Title")], ["section", tk("Section")], ["default", tk("Default")], ["center", tk("Center")], ["two-cols", tk("Two columns")], ["image-left", tk("Image left")],
  ["image-right", tk("Image right")], ["cards", tk("Cards")], ["stat", tk("Big number")], ["quote", tk("Quote")], ["full", tk("Full image")], ["blank", tk("Blank")],
];
/** Translated layout name (LAYOUT_LABELS holds the English keys). */
export const layoutLabel = (k: string) => t(LAYOUT_LABELS.find(([x]) => x === k)?.[1] ?? tk("Auto"));
export type Variant = "normal" | "invert" | "accent";
export const variantOf = (cls = ""): Variant => (/\baccent\b/.test(cls) ? "accent" : /\binvert\b/.test(cls) ? "invert" : "normal");

interface El { x: number; y: number; w: number; h: number; r?: number; f?: string; b?: string; fs?: number; fw?: number; c?: string; t?: string; ai?: string; jc?: string; ta?: CSSProperties["textAlign"] }

/** Palette of a slide variant. "normal" follows the app theme (Lamplight = the design's dark slide); "invert" is the
 *  opposite theme; "accent" is the amber slide. */
function palette(v: Variant, dark: boolean) {
  const d = v === "invert" ? !dark : dark;
  if (v === "accent") return { bg: "#F2A93B", fg: "#1A1206", mu: "rgba(26,18,6,.55)", ph: "rgba(26,18,6,.14)", ring: d ? "#2A303B" : "#E4DFD3", ac: "#F2A93B" };
  if (v === "normal") return { bg: "var(--bg)", fg: "var(--text)", mu: "color-mix(in srgb,var(--muted) 45%,transparent)", ph: "var(--surface-2)", ring: "var(--border)", ac: "var(--accent)" };
  return d
    ? { bg: "#0F1115", fg: "#E8E6E1", mu: "rgba(154,160,170,.45)", ph: "#1D222B", ring: "#2A303B", ac: "#F2A93B" }
    : { bg: "#FAF8F3", fg: "#1F1D1A", mu: "rgba(106,101,92,.4)", ph: "#ECE8DE", ring: "#E4DFD3", ac: "#B45F0E" };
}

function elements(k: string, p: ReturnType<typeof palette>): El[] {
  const E = (x: number, y: number, w: number, h: number, o: Partial<El> = {}): El => ({ x, y, w, h, ...o });
  const T = (x: number, y: number, w: number, t: string, fs = 22, o: Partial<El> = {}) => E(x, y, w, fs * 2.4, { t, fs, fw: 700, ...o });
  const L = (x: number, y: number, w: number) => E(x, y, w, 5, { f: p.mu, r: 2.5 });
  const bullets = (x: number, y: number, w: number, n: number) => Array.from({ length: n }, (_, i) => L(x, y + i * 16, i === n - 1 ? w * 0.6 : w));
  const M: Record<string, El[]> = {
    title: [T(28, 62, 264, "Backprop, from one neuron up", 24), L(28, 128, 120)],
    section: [E(28, 74, 6, 32, { f: p.ac, r: 2 }), T(44, 72, 240, "Part 2 · Neural networks", 22), L(44, 108, 90)],
    default: [T(24, 20, 272, "The chain rule", 18), ...bullets(24, 60, 240, 5)],
    center: [T(30, 64, 260, "Cache every activation", 20, { ta: "center", jc: "center" }), L(110, 110, 100)],
    "two-cols": [T(24, 20, 272, "Sigmoid vs ReLU", 16), ...bullets(24, 58, 124, 4), ...bullets(172, 58, 124, 4)],
    "image-left": [E(0, 0, 140, 180, { f: p.ph, r: 0 }), T(156, 30, 150, "Feature maps", 16), ...bullets(156, 70, 140, 4)],
    "image-right": [T(20, 30, 150, "Loss curve", 16), ...bullets(20, 70, 140, 4), E(180, 0, 140, 180, { f: p.ph, r: 0 })],
    cards: [T(24, 18, 272, "Three steps", 16), E(24, 58, 84, 100, { f: p.ph, r: 8 }), E(118, 58, 84, 100, { f: p.ph, r: 8 }), E(212, 58, 84, 100, { f: p.ph, r: 8 }), L(32, 70, 60), L(126, 70, 60), L(220, 70, 60)],
    stat: [E(30, 40, 260, 70, { t: "93.4%", fs: 56, fw: 700, jc: "center", ai: "center" }), L(110, 122, 100)],
    quote: [E(40, 40, 6, 80, { f: p.ac, r: 2 }), E(58, 40, 230, 70, { t: "“Backprop is just the chain rule, organised.”", fs: 17, fw: 600 }), L(58, 128, 80)],
    full: [E(0, 0, 320, 180, { f: p.ph, r: 0 }), E(20, 130, 200, 30, { t: "Week 6 · study group", fs: 16, fw: 700, c: "#FFFFFF" })],
    blank: [E(150, 86, 20, 8, { f: p.mu, r: 4 })],
  };
  return M[k] ?? M.title;
}

/** Schematic thumbnail of a layout (the design's SlideThumb, 1:1). */
export function SlideThumb({ layout = "title", variant = "normal", width = 160, selected, className, title }: { layout?: string; variant?: Variant; width?: number; selected?: boolean; className?: string; title?: string }) {
  useSettings(); // re-render on theme change
  const dark = activeTheme().dark;
  const p = palette(variant, dark);
  const s = width / 320;
  return (
    <div className={className} title={title} style={{ width, height: (width * 9) / 16, position: "relative", flexShrink: 0, borderRadius: Math.max(4, width / 32), overflow: "hidden", boxShadow: selected ? "0 0 0 2px var(--accent)" : `0 0 0 1px ${p.ring}` }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: 320, height: 180, transform: `scale(${s})`, transformOrigin: "0 0", background: p.bg, color: p.fg, fontFamily: "Inter,system-ui,sans-serif" }}>
        {elements(layout, p).map((e, i) => (
          <div key={i} style={{ position: "absolute", left: e.x, top: e.y, width: e.w, height: e.h, borderRadius: e.r ?? 3, background: e.f ?? "transparent", border: e.b ?? "none", boxSizing: "border-box", fontSize: e.fs ?? 12, fontWeight: e.fw ?? 400, lineHeight: 1.15, color: e.c ?? p.fg, display: "flex", alignItems: e.ai ?? "flex-start", justifyContent: e.jc ?? "flex-start", textAlign: e.ta ?? "left", letterSpacing: "-.02em", overflow: "hidden" }}>{e.t ?? ""}</div>
        ))}
      </div>
    </div>
  );
}

/** The SlideThumb frame around real content (a rendered slide). */
export function SlideFrame({ width, selected, children, className, style }: { width: number; selected?: boolean; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={className} style={{ width, height: (width * 9) / 16, position: "relative", flexShrink: 0, borderRadius: Math.max(4, width / 32), overflow: "hidden", background: "var(--bg)", boxShadow: selected ? "0 0 0 2px var(--accent)" : "0 0 0 1px var(--border)", ...style }}>
      {children}
    </div>
  );
}
