// Lumen tool model on top of Excalidraw's tools: ids, glyphs, key hints, last-used list (tool wheel) and ink styles.
import { tk } from "../../lib/i18n";
import type { GlyphName } from "../../lib/glyphs";

export type ToolId = "select" | "lasso" | "hand" | "pen" | "hl" | "eraser" | "laser" | "shape" | "arrow" | "text" | "sticky" | "image" | "media" | "web" | "note" | "frame";
export type ShapeKind = "rectangle" | "ellipse" | "diamond";
export type LineKind = "arrow" | "line";

export const SHAPE_GLYPH: Record<ShapeKind, GlyphName> = { rectangle: "rect", ellipse: "ellipse", diamond: "decision" } as Record<ShapeKind, GlyphName>;
export const SHAPE_NAME: Record<ShapeKind, string> = { rectangle: tk("Rectangle"), ellipse: tk("Ellipse"), diamond: tk("Diamond") };
export const LINE_GLYPH: Record<LineKind, GlyphName> = { arrow: "arrow", line: "line" } as Record<LineKind, GlyphName>;

/** Tool → [glyph, name, key hint]. Keys follow the design (1 select · 2 lasso · 3 pen · … · 0 image), not Excalidraw's. */
export const TOOL_META: Record<ToolId, [GlyphName, string, string]> = {
  select: ["select" as GlyphName, tk("Select"), "1"], lasso: ["lasso" as GlyphName, tk("Lasso"), "2"], hand: ["hand" as GlyphName, tk("Hand"), "H"],
  pen: ["pen-fountain" as GlyphName, tk("Pen"), "3"], hl: ["highlighter" as GlyphName, tk("Highlighter"), "4"], eraser: ["eraser-stroke" as GlyphName, tk("Eraser"), "5"], laser: ["laser" as GlyphName, tk("Laser"), "K"],
  shape: ["rect" as GlyphName, tk("Shapes"), "6"], arrow: ["arrow" as GlyphName, tk("Arrow and connector"), "7"],
  text: ["text" as GlyphName, tk("Text"), "8"], sticky: ["sticky" as GlyphName, tk("Sticky"), "9"],
  image: ["image" as GlyphName, tk("Image"), "0"], media: ["media" as GlyphName, tk("GIF or video"), ""], web: ["web-embed" as GlyphName, tk("Web page"), ""], note: ["note-card" as GlyphName, tk("Note card"), "N"],
  frame: ["frame" as GlyphName, tk("Frame"), "F"],
};
/** Key → tool (single key, no modifiers, not while typing). */
export const KEY_TOOL: Record<string, ToolId> = { "1": "select", "2": "lasso", h: "hand", "3": "pen", "4": "hl", "5": "eraser", k: "laser", "6": "shape", "7": "arrow", "8": "text", "9": "sticky", "0": "image", n: "note", f: "frame" };

/** Excalidraw tool type → Lumen tool (the highlighter is freedraw with the highlighter style, tracked separately). */
export function lumenTool(type: string, hl: boolean): ToolId {
  switch (type) {
    case "selection": return "select";
    case "freedraw": return hl ? "hl" : "pen";
    case "rectangle": case "ellipse": case "diamond": return "shape";
    case "arrow": case "line": return "arrow";
    case "embeddable": return "web";
    case "magicframe": return "frame";
    default: return (type in TOOL_META ? type : "select") as ToolId;
  }
}

// ------------------------------------------------------------------ ink styles (pen and highlighter keep their own)
export type Ink = { color: string; width: number; opacity: number };
export const PEN_DEFAULT: Ink = { color: "#1e1e1e", width: 2, opacity: 100 };
export const HL_DEFAULT: Ink = { color: "#ffd43b", width: 8, opacity: 45 };
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
export const loadInk = (which: "pen" | "hl") => read<Ink>(`lumen.wbInk.${which}`, which === "pen" ? PEN_DEFAULT : HL_DEFAULT);
export const saveInk = (which: "pen" | "hl", ink: Ink) => write(`lumen.wbInk.${which}`, ink);

// ------------------------------------------------------------------ last used (tool wheel: 6 slots)
export type WheelSlot = { tool: ToolId; shape?: ShapeKind; color?: string };
const WHEEL_DEFAULT: WheelSlot[] = [{ tool: "pen" }, { tool: "hl" }, { tool: "eraser" }, { tool: "lasso" }, { tool: "text" }, { tool: "shape", shape: "rectangle" }];
export function loadRecent(): WheelSlot[] {
  try { const v = JSON.parse(localStorage.getItem("lumen.wbRecent") ?? "null") as WheelSlot[] | null; if (Array.isArray(v) && v.length) return [...v, ...WHEEL_DEFAULT.filter((d) => !v.some((x) => x.tool === d.tool))].slice(0, 6); } catch { /* ignore */ }
  return WHEEL_DEFAULT;
}
const WHEELABLE: ToolId[] = ["pen", "hl", "eraser", "laser", "lasso", "shape", "arrow", "text", "sticky", "frame", "hand", "select"];
export function pushRecent(s: WheelSlot) {
  if (!WHEELABLE.includes(s.tool)) return;
  const cur = loadRecent().filter((x) => x.tool !== s.tool);
  write("lumen.wbRecent", [s, ...cur].slice(0, 6));
}

/** Lumen ink: theme-aware swatches (design PAL['Lumen ink']). Index 0 = the default ink. */
export const LUMEN_INK_DARK = ["#1e1e1e", "#9AA0AA", "#EF6B6B", "#F2A93B", "#E3B341", "#6BCB8B", "#5CC8C2", "#7AA2F7", "#B48EF0", "#F25C9A"];
export const LUMEN_INK_LIGHT = ["#1e1e1e", "#6A655C", "#C42B2B", "#B45F0E", "#A86A00", "#1F8A4C", "#0F7C78", "#2F5BD3", "#7A4BD1", "#B0306A"];
/** Sticky paper colours (also fills). */
export const PAPER = ["#fff3bf", "#d3f9d8", "#d0ebff", "#ffd8a8", "#eebefa", "#ffc9c9"];
/** What a stored colour looks like on screen: the dark theme flips near-black ink to light (see the ink filter). */
export const shown = (c: string, dark: boolean) => (dark && /^#1e1e1e$/i.test(c) ? "#E8E6E1" : c);
