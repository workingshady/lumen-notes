// Palettes (round 7 · W2-A, design 37A–37F, docs/design/CLAUDE_DESIGN_UPDATE_06.md §4).
// Shipped palettes, the board palette (colours in use), custom palettes (synced: Inbox space `props.lumenPalettes`),
// recent colours (this device), shades (OKLab mix), WCAG contrast and "keep exact colour in dark theme".
import { useMemo, useSyncExternalStore } from "react";
import { db, patch } from "../../../lib/db";
import { tk } from "../../../lib/i18n";
import { useVaultSelector } from "../../../lib/store";

export interface Swatch { c: string; name?: string }
export interface Palette { id: string; name: string; sub: string; colors: Swatch[]; custom?: boolean; glyph?: string; themeAware?: boolean }

export const LUMEN_INK_DARK_UI = ["#E8E6E1", "#9AA0AA", "#EF6B6B", "#F2A93B", "#E3B341", "#6BCB8B", "#5CC8C2", "#7AA2F7", "#B48EF0", "#F25C9A"];
export const LUMEN_INK_LIGHT_UI = ["#1F1D1A", "#6A655C", "#C42B2B", "#B45F0E", "#A86A00", "#1F8A4C", "#0F7C78", "#2F5BD3", "#7A4BD1", "#B0306A"];
/** Lumen ink as stored: index 0 is the default ink #1e1e1e (flips to light on Lamplight), the rest per theme. */
export const lumenInk = (dark: boolean) => ["#1e1e1e", ...(dark ? LUMEN_INK_DARK_UI : LUMEN_INK_LIGHT_UI).slice(1)];
const NAMES: Record<string, string> = {
  "#e69f00": tk("Okabe orange"), "#56b4e9": tk("Sky blue"), "#009e73": tk("Bluish green"), "#f0e442": tk("Yellow"), "#0072b2": tk("Blue"), "#d55e00": tk("Vermillion"), "#cc79a7": tk("Reddish purple"), "#000000": tk("Black"),
  "#1e1e1e": tk("Ink"), "#9aa0aa": tk("Grey"), "#6a655c": tk("Grey"), "#ef6b6b": tk("Red"), "#c42b2b": tk("Red"), "#f2a93b": tk("Amber"), "#b45f0e": tk("Amber"), "#e3b341": tk("Gold"), "#a86a00": tk("Gold"),
  "#6bcb8b": tk("Green"), "#1f8a4c": tk("Green"), "#5cc8c2": tk("Teal"), "#0f7c78": tk("Teal"), "#7aa2f7": tk("Blue"), "#2f5bd3": tk("Blue"), "#b48ef0": tk("Violet"), "#7a4bd1": tk("Violet"), "#f25c9a": tk("Pink"), "#b0306a": tk("Pink"),
  "#fff3bf": tk("Butter"), "#d3f9d8": tk("Mint"), "#d0ebff": tk("Sky"), "#ffd8a8": tk("Peach"), "#eebefa": tk("Lilac"), "#ffc9c9": tk("Rose"),
};
export const colourName = (c: string) => NAMES[c.toLowerCase()];

export const SHIPPED = (dark: boolean): Palette[] => [
  { id: "lumen", name: tk("Lumen ink"), sub: tk("theme-aware"), themeAware: true, colors: lumenInk(dark).map((c) => ({ c })) },
  { id: "stickies", name: tk("Paper stickies"), sub: tk("6 pastels"), colors: ["#fff3bf", "#d3f9d8", "#d0ebff", "#ffd8a8", "#eebefa", "#ffc9c9"].map((c) => ({ c })) },
  { id: "highlighters", name: tk("Highlighters"), sub: tk("translucent"), colors: [["#ffd43b73", tk("Yellow")], ["#69db7c73", tk("Green")], ["#74c0fc73", tk("Blue")], ["#faa2c173", tk("Pink")], ["#ffa94d73", tk("Orange")]].map(([c, name]) => ({ c, name })) },
  { id: "okabe", name: tk("Colour-blind safe"), sub: "Okabe-Ito", glyph: "eye", colors: ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#000000"].map((c) => ({ c })) },
  { id: "greys", name: tk("Greys"), sub: tk("6 steps"), colors: ["#F2F0EA", "#C9C6BF", "#9AA0AA", "#6A655C", "#3A3E46", "#1F1D1A"].map((c) => ({ c })) },
  { id: "vivid", name: tk("Vivid"), sub: tk("10 saturated"), colors: ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#00C7BE", "#30B0C7", "#007AFF", "#5856D6", "#AF52DE", "#FF2D55"].map((c) => ({ c })) },
];

/** "This board": colours in use, most used first. */
export function boardPalette(els: readonly Record<string, unknown>[]): Palette {
  const n = new Map<string, number>();
  for (const e of els) {
    if (e.isDeleted) continue;
    for (const k of ["strokeColor", "backgroundColor"]) {
      const c = String(e[k] ?? "").toLowerCase();
      if (c && c !== "transparent" && /^#[0-9a-f]{3,8}$/.test(c)) n.set(c, (n.get(c) ?? 0) + 1);
    }
  }
  return { id: "board", name: tk("This board"), sub: tk("colours in use"), colors: [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c]) => ({ c })) };
}

// ------------------------------------------------------------------ custom palettes (synced)
const SPACE = "inbox", PROP = "lumenPalettes";
export function readCustom(raw: unknown): Palette[] {
  try {
    const a = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(a)) return [];
    return a.filter((p) => p && typeof p.id === "string" && typeof p.name === "string").map((p) => ({ id: p.id, name: p.name, sub: tk("custom"), custom: true, glyph: "swatch-add", colors: (Array.isArray(p.colors) ? p.colors : []).filter((s: Swatch) => s && typeof s.c === "string").map((s: Swatch) => ({ c: s.c, name: s.name || undefined })) }));
  } catch { return []; }
}
export function useCustomPalettes(): Palette[] {
  const raw = useVaultSelector((v) => v.spaceMap.get(SPACE)?.props?.[PROP] as string | undefined);
  return useMemo(() => readCustom(raw), [raw]);
}
/** For CanvasOptions' `customPalettes` prop: name → colours. */
export function useCustomPaletteMap(): Record<string, string[]> {
  const list = useCustomPalettes();
  return useMemo(() => Object.fromEntries(list.map((p) => [p.name, p.colors.map((s) => s.c)])), [list]);
}
export async function writeCustom(fn: (cur: Palette[]) => Palette[]) {
  const sp = await db.spaces.get(SPACE);
  if (!sp) return;
  const next = fn(readCustom(sp.props?.[PROP])).map((p) => ({ id: p.id, name: p.name, colors: p.colors.map((s) => (s.name ? { c: s.c, name: s.name } : { c: s.c })) }));
  await patch("space", SPACE, { props: { ...(sp.props ?? {}), [PROP]: JSON.stringify(next) } });
}

// ------------------------------------------------------------------ device prefs: recent colours, chosen palette
type Prefs = { recent: string[]; palette: string };
const KEY = "lumen.wbPalette";
let prefs: Prefs = (() => { try { return { recent: [], palette: "lumen", ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return { recent: [], palette: "lumen" }; } })();
const subs = new Set<() => void>();
export const usePalPrefs = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => prefs);
export function setPalPrefs(p: Partial<Prefs>) {
  prefs = { ...prefs, ...p };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  subs.forEach((f) => f());
}
export const pushRecent = (c: string) => setPalPrefs({ recent: [c, ...prefs.recent.filter((x) => x.toLowerCase() !== c.toLowerCase())].slice(0, 8) });

// ------------------------------------------------------------------ colour maths
export function parseHex(c: string): [number, number, number, number] | null {
  const m = /^#?([0-9a-f]{3,8})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}
const hx = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
export const toHex = (r: number, g: number, b: number, a = 1) => `#${hx(r)}${hx(g)}${hx(b)}${a < 1 ? hx(a * 255) : ""}`.toUpperCase();
const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const unlin = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
function toLab([r, g, b]: number[]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B), m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B), s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromLab([L, A, Bb]: number[]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * Bb) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * Bb) ** 3, s = (L - 0.0894841775 * A - 1.291485548 * Bb) ** 3;
  return [unlin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), unlin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), unlin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}
/** color-mix(in oklab, c k, white|black) like the design's shades row: k < 1 mixes with white, k > 1 with black. */
export function shade(c: string, k: number): string {
  const p = parseHex(c);
  if (!p) return c;
  const a = toLab(p), o = toLab(k > 1 ? [0, 0, 0] : [255, 255, 255]);
  const w = k > 1 ? 2 - k : k; // share of the colour
  const [r, g, b] = fromLab(a.map((v, i) => v * w + o[i] * (1 - w)));
  return toHex(r, g, b, p[3]);
}
export const SHADE_STEPS = [0.35, 0.55, 0.75, 1, 1.2, 1.4];
const lum = (c: string) => { const p = parseHex(c); if (!p) return 0; return 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]); };
export const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** Darkest-enough shade of `fill` that reaches 4.5 : 1 against `text` (or lightest, for light text). */
export function suggestShade(fill: string, text: string): string | null {
  const darker = lum(text) > 0.4;
  for (let k = 1; k <= 1.95; k += 0.05) { const s = shade(fill, darker ? k : 2 - k); if (contrast(s, text) >= 4.5) return s; }
  return null;
}

// ------------------------------------------------------------------ keep exact colour in dark theme
/** The dark board's ink filter (Whiteboard INK_TABLE) lifts channels in ~0.09–0.17 to light. This finds the stored value
 *  that the filter draws as the wanted colour, so "exact" ink stays dark on Lamplight. Light theme: no visible change. */
const TABLE = "0.100 0.105 0.110 0.115 0.120 0.125 0.130 0.135 0.140 0.393 0.900 0.900 0.900 0.900 0.900 0.657 0.413 0.170".split(" ").map(Number);
function exactChannel(v: number) {
  const x = v / 255;
  if (x < 0.085 || x > 0.175) return v;
  // pick the table input (0..0.08) whose output is closest to x
  let best = 0, err = 9;
  for (let i = 0; i <= 8; i++) { const e = Math.abs(TABLE[i] - x); if (e < err) { err = e; best = i; } }
  return (best / 100) * 255;
}
export function exactColour(c: string): string {
  const p = parseHex(c);
  if (!p) return c;
  const out = toHex(exactChannel(p[0]), exactChannel(p[1]), exactChannel(p[2]), p[3]);
  return out.toLowerCase() === c.toLowerCase() ? c : out;
}
export const needsExact = (c: string) => exactColour(c).toLowerCase() !== c.toLowerCase();
