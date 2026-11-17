import { useSyncExternalStore } from "react";

export type ThemeId = "lamplight" | "paper" | "midnight" | "sepia" | "forest" | "contrast";
export interface Theme { id: ThemeId; name: string; dark: boolean; vars: Record<string, string> }

const T = (id: ThemeId, name: string, dark: boolean, bg: string, surface: string, s2: string, border: string, text: string, muted: string, accent: string, accentFg: string, link: string): Theme => ({
  id, name, dark, vars: { bg, surface, "surface-2": s2, border, text, muted, accent, "accent-fg": accentFg, link },
});
export const THEMES: Theme[] = [
  T("lamplight", "Lamplight", true, "#0F1115", "#161A21", "#1D222B", "#2A303B", "#E8E6E1", "#9AA0AA", "#F2A93B", "#1A1206", "#5CC8C2"),
  T("paper", "Paper", false, "#FAF8F3", "#FFFFFF", "#F2EFE7", "#E4DFD3", "#1F1D1A", "#6A655C", "#B45F0E", "#FFFFFF", "#0F7C78"),
  T("midnight", "Midnight", true, "#0B1020", "#111830", "#18213D", "#263156", "#E3E8F5", "#93A0C0", "#8EA8FF", "#0B1020", "#6EE7D8"),
  T("sepia", "Sepia", false, "#F4ECD8", "#FBF5E6", "#EDE2C8", "#DCCDA8", "#3B2F1E", "#75654A", "#9C4A1A", "#FFFFFF", "#2F6B5C"),
  T("forest", "Forest", true, "#0E1512", "#141D19", "#1B2621", "#29372F", "#E2EBE4", "#93A69A", "#7FD49B", "#0E1512", "#F2C46D"),
  T("contrast", "High contrast", true, "#000000", "#0A0A0A", "#161616", "#6A6A6A", "#FFFFFF", "#D6D6D6", "#FFD400", "#000000", "#66CCFF"),
];

/** Diagram export preferences (Settings › Diagrams and the Export dialog remember the last choice). */
export interface DiagramExportPrefs {
  format: "svg" | "png" | "jpeg" | "webp";
  /** Raster scale (× the diagram's natural size); 1–8. SVG is vector and ignores it. */
  scale: number;
  /** JPEG/WebP quality 0.5–1. */
  quality: number;
  background: "transparent" | "theme" | "custom";
  color: string;
  theme: "app" | "default" | "dark" | "neutral" | "forest";
  padding: number;
  /** Labels as SVG <text> (sharp, editable in Figma/Illustrator) instead of HTML. */
  svgText: boolean;
  /** Embed the used Inter glyphs so text looks the same outside Lumen. */
  embedFont: boolean;
}
export const DIAGRAM_EXPORT_DEFAULTS: DiagramExportPrefs = { format: "png", scale: 3, quality: 0.92, background: "theme", color: "#ffffff", theme: "app", padding: 24, svgText: true, embedFont: true };

export interface Settings {
  theme: ThemeId | "auto";
  /** OKLCH hue override for the accent; null = theme default. */
  accentHue: number | null;
  readingFont: "sans" | "serif" | "mono";
  fontSize: number;
  measure: 60 | 68 | 80 | 0;
  density: "comfortable" | "compact";
  blogName: string;
  tagline: string;
  author: string;
  avatar: string;
  johnnyDecimal: boolean;
  spellcheck: boolean;
  dailyTemplate: string;
  /** Where diagrams saved from a note go: a `diagrams` subfolder next to the note, one `Diagrams` folder per space, or the note's own folder. */
  diagramFolder: "sub" | "space" | "same";
  /** Save every new Mermaid block of a note to its diagram canvas automatically. */
  diagramAutoSave: boolean;
  /** Ask the AI for a short file name when a diagram is saved (otherwise the nearest heading). */
  diagramAiNames: boolean;
  diagramExport: DiagramExportPrefs;
  /** Focus mode opens for reading (rendered note, highlighter) or writing (editor). */
  focusMode: "read" | "write";
  /** Writing focus: dim every paragraph except the one with the cursor. */
  focusDim: boolean;
  /** Leaving Focus with unsaved highlights: ask, always save into the note, or discard. */
  highlightOnExit: "ask" | "save" | "discard";
  /** Read-aloud speed (0.5–3). */
  ttsRate: number;
}
const DEFAULTS: Settings = {
  theme: "auto", accentHue: null, readingFont: "serif", fontSize: 16, measure: 68, density: "comfortable",
  blogName: "Lumen", tagline: "Notes from what I'm learning", author: "", avatar: "🕯️", johnnyDecimal: false, spellcheck: true, dailyTemplate: "journal", diagramFolder: "sub", diagramAutoSave: false, diagramAiNames: false, diagramExport: DIAGRAM_EXPORT_DEFAULTS, focusMode: "read", focusDim: true, highlightOnExit: "ask", ttsRate: 1,
};

const KEY = "lumen.settings";
let cur: Settings = (() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return DEFAULTS; } })();
const subs = new Set<() => void>();
export const useSettings = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => cur);
export const getSettings = () => cur;
export function setSettings(p: Partial<Settings>) {
  cur = { ...cur, ...p };
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* ignore */ }
  applyTheme();
  subs.forEach((f) => f());
}

const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: dark)") : null;
mq?.addEventListener("change", () => cur.theme === "auto" && (applyTheme(), subs.forEach((f) => f())));

export function activeTheme(): Theme {
  const id = cur.theme === "auto" ? (mq?.matches === false ? "paper" : "lamplight") : cur.theme;
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function applyTheme() {
  const t = activeTheme();
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(`--${k}`, v);
  if (cur.accentHue !== null) {
    // Keep the theme's lightness/chroma feel; only the hue changes (contrast stays AA).
    root.style.setProperty("--accent", t.dark ? `oklch(0.78 0.14 ${cur.accentHue})` : `oklch(0.52 0.14 ${cur.accentHue})`);
    root.style.setProperty("--accent-fg", t.dark ? "#111" : "#fff");
  }
  root.dataset.dark = t.dark ? "1" : "0";
  root.style.colorScheme = t.dark ? "dark" : "light";
  root.style.setProperty("--read-size", `${cur.fontSize}px`);
  root.style.setProperty("--measure", cur.measure ? `${cur.measure}ch` : "100%");
  root.style.setProperty("--read-font", cur.readingFont === "serif" ? "'Source Serif 4', 'Noto Naskh Arabic', Georgia, serif" : cur.readingFont === "mono" ? "'JetBrains Mono', 'IBM Plex Sans Arabic', ui-monospace, monospace" : "Inter, 'IBM Plex Sans Arabic', system-ui, sans-serif");
  root.dataset.density = cur.density;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.vars.bg);
}
