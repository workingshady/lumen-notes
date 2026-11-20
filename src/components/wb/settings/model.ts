// Board settings (design 39A–39G, 44F; brief §6): background colour, pattern + density, infinite or pages mode,
// snapping and view. Stored in the .excalidraw file as scene `lumenBoard` (and `appState.lumenBoard`); defaults for
// new boards live in Settings › Diagrams (synced settings key `boardDefaults`).
import { useSyncExternalStore } from "react";
import { getSettings, setSettings, type Settings } from "../../../lib/settings";

export type BgKey = "theme" | "white" | "warm" | "chalk" | "blueprint" | "custom" | "transparent";
export type PatKey = "none" | "dots" | "grid" | "lines" | "iso" | "cornell" | "graph" | "staff";
export type PageMode = "infinite" | "a4" | "letter" | "16:9";
export interface LumenBoard {
  bg: BgKey;
  /** Custom background colour (bg = "custom"). */
  custom: string;
  pattern: PatKey;
  /** Pattern spacing in px at 100% zoom, 12–48 (design default 22). */
  density: number;
  mode: PageMode;
  snapGrid: boolean;
  snapObjects: boolean;
  angleSnap: boolean;
  minimap: boolean;
  zen: boolean;
  viewOnly: boolean;
}
export const BOARD_DEFAULTS: LumenBoard = { bg: "theme", custom: "#2B2F3A", pattern: "dots", density: 22, mode: "infinite", snapGrid: true, snapObjects: true, angleSnap: false, minimap: true, zen: false, viewOnly: false };

/** Settings › Diagrams defaults for new boards (synced with the other settings). */
export type BoardDefaults = Pick<LumenBoard, "bg" | "custom" | "pattern" | "density" | "mode" | "snapGrid" | "snapObjects" | "angleSnap">;
export const boardDefaults = (): LumenBoard => ({ ...BOARD_DEFAULTS, ...(((getSettings() as Settings & { boardDefaults?: Partial<BoardDefaults> }).boardDefaults) ?? {}) });
export const setBoardDefaults = (p: Partial<BoardDefaults>) => {
  const cur = ((getSettings() as Settings & { boardDefaults?: Partial<BoardDefaults> }).boardDefaults) ?? {};
  setSettings({ boardDefaults: { ...cur, ...p } } as unknown as Partial<Settings>);
};

/** Background swatches in the design's order (WBStudio BGS + bgI). */
export const BACKGROUNDS: [BgKey, string, string][] = [
  ["theme", "Theme", "var(--bg)"], ["white", "Paper white", "#FFFFFF"], ["warm", "Warm paper", "#F4ECD8"], ["chalk", "Chalkboard", "#1F3A2E"],
  ["blueprint", "Blueprint", "#173A63"], ["custom", "Custom", "conic-gradient(#EF6B6B,#E3B341,#6BCB8B,#7AA2F7,#B48EF0,#EF6B6B)"], ["transparent", "Transparent", "conic-gradient(#888 25%,#ccc 0 50%,#888 0 75%,#ccc 0) 0 0/10px 10px"],
];
export const PATTERNS: [PatKey, string, string][] = [
  ["none", "fill-none", "None"], ["dots", "pattern-dots", "Dots"], ["grid", "pattern-grid", "Grid"], ["lines", "pattern-lines", "Ruled"],
  ["iso", "pattern-isometric", "Isometric"], ["cornell", "pattern-cornell", "Cornell"], ["graph", "pattern-graph", "Graph 5mm"], ["staff", "pattern-staff", "Music"],
];
/** Pages: size in scene px (96 dpi) and the gap between stacked pages. */
export const PAGE_SIZE: Record<Exclude<PageMode, "infinite">, [number, number]> = { a4: [794, 1123], letter: [816, 1056], "16:9": [1280, 720] };
export const PAGE_GAP = 48;

const hex = (c: string) => { const m = c.replace("#", ""); const v = m.length === 3 ? m.split("").map((x) => x + x).join("") : m; return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]; };
const lum = (c: string) => { try { const [r, g, b] = hex(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; } catch { return 0.5; } };

/** CSS background colour of the board (theme / transparent follow the app). */
export function boardColor(b: LumenBoard): string {
  if (b.bg === "custom") return b.custom;
  return BACKGROUNDS.find(([k]) => k === b.bg)?.[2].startsWith("#") ? BACKGROUNDS.find(([k]) => k === b.bg)![2] : "var(--bg)";
}
/** Whether the board itself is dark (ink flips to light on it). null = follows the app theme. */
export function boardDark(b: LumenBoard): boolean | null {
  if (b.bg === "chalk" || b.bg === "blueprint") return true;
  if (b.bg === "white" || b.bg === "warm") return false;
  if (b.bg === "custom") return lum(b.custom) < 0.45;
  return null;
}
/** Pattern line colour: white 14% on chalkboard / blueprint, muted 16% otherwise (WBStudio lineC); 30% for swatches. */
export const lineColor = (b: LumenBoard, dark: boolean) => (b.bg === "chalk" || b.bg === "blueprint" || (b.bg === "custom" && dark) ? "rgba(255,255,255,.14)" : "color-mix(in srgb,var(--muted) 16%,transparent)");

/** Pattern as CSS background layers at scale `k` (zoom × density / default). Mirrors WBStudio PAT. */
export function patternCss(p: PatKey, lc: string, size: number, z = 1): { image: string; size: string; repeat?: string } {
  const s = size * z, px = (n: number) => `${n}px`;
  switch (p) {
    case "dots": return { image: `radial-gradient(${lc} ${1.2 * Math.max(0.6, Math.min(1.6, z))}px, transparent ${1.4 * Math.max(0.6, Math.min(1.6, z))}px)`, size: `${px(s)} ${px(s)}` };
    case "grid": return { image: `linear-gradient(${lc} 1px,transparent 1px),linear-gradient(90deg,${lc} 1px,transparent 1px)`, size: `${px(s)} ${px(s)}` };
    case "lines": return { image: `linear-gradient(${lc} 1px,transparent 1px)`, size: `100% ${px(s * 28 / 22)}` };
    case "iso": { const h = s * 24 / 22; return { image: `repeating-linear-gradient(30deg,${lc} 0 1px,transparent 1px ${px(h)}),repeating-linear-gradient(150deg,${lc} 0 1px,transparent 1px ${px(h)})`, size: "auto" }; }
    case "graph": { const g = s * 12 / 22; return { image: `linear-gradient(${lc} 1px,transparent 1px),linear-gradient(90deg,${lc} 1px,transparent 1px),linear-gradient(${lc} 1px,transparent 1px),linear-gradient(90deg,${lc} 1px,transparent 1px)`, size: `${px(g)} ${px(g)}, ${px(g)} ${px(g)}, ${px(g * 5)} ${px(g * 5)}, ${px(g * 5)} ${px(g * 5)}` }; }
    case "cornell": return { image: `linear-gradient(90deg,transparent ${px(260 * z)},${lc} ${px(260 * z)},${lc} ${px(262 * z)},transparent ${px(262 * z)}),linear-gradient(${lc} 1px,transparent 1px)`, size: `100% 100%, 100% ${px(s * 28 / 22)}`, repeat: "repeat-y, repeat" };
    case "staff": { const g = s * 8 / 22, T = g * 8; const L = [0, 1, 2, 3, 4].map((i) => `linear-gradient(transparent ${px(g * i + g)},${lc} ${px(g * i + g)},${lc} ${px(g * i + g + 1)},transparent ${px(g * i + g + 1)})`); return { image: L.join(","), size: L.map(() => `100% ${px(T)}`).join(", ") }; }
    default: return { image: "none", size: "auto" };
  }
}

/** Tiny observable store for one open board's settings. */
export class BoardStore {
  value: LumenBoard;
  private subs = new Set<() => void>();
  constructor(init: Partial<LumenBoard> | undefined, isNew: boolean) {
    this.value = { ...(isNew ? boardDefaults() : BOARD_DEFAULTS), ...(init ?? {}) };
  }
  set = (p: Partial<LumenBoard>) => { this.value = { ...this.value, ...p }; this.subs.forEach((f) => f()); };
  replace = (v: Partial<LumenBoard> | undefined) => { if (!v) return; this.value = { ...this.value, ...v }; this.subs.forEach((f) => f()); };
  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f); }; };
  get = () => this.value;
}
export const useBoard = (s: BoardStore) => useSyncExternalStore(s.subscribe, s.get);
