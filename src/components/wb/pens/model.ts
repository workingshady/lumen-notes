// Pens (round 7 · W2-A, design 34A–34E, docs/design/CLAUDE_DESIGN_UPDATE_06.md §2).
// Eight pen types mapped onto Excalidraw freedraw props (strokeWidth, opacity, simulatePressure, constant pressures),
// plus Lumen post-processing after each stroke (smoothing, pressure curve, taper, nib angle, hold-to-straighten).
// Per-device settings live in localStorage; saved pens (up to 8) sync through the Inbox space (`props.lumenPens`).
import { useMemo, useSyncExternalStore } from "react";
import { db, patch } from "../../../lib/db";
import { tk } from "../../../lib/i18n";
import { useVaultSelector } from "../../../lib/store";

export type PenType = "ballpoint" | "fountain" | "brush" | "marker" | "highlighter" | "pencil" | "calligraphy" | "laser";
export type Smoothing = "off" | "low" | "high";
export type Curve = "soft" | "linear" | "firm";
export interface PenSettings {
  type: PenType; color: string;
  /** Thickness in px, 0.5–24. */
  width: number;
  /** 0–100. */
  opacity: number;
  smoothing: Smoothing; pressure: boolean; curve: Curve;
  /** Draw straight when I pause (hold at the end of a stroke). */
  straight: boolean;
}
export type SavedPen = PenSettings & { id: string };

/** [type, glyph, label, preview options] in the design's order (WBStudio `pens`). */
export const PEN_TYPES: { type: PenType; glyph: string; label: string; later?: boolean; pv?: string; pvW2: number; pvO?: number; pvC?: string; pvCap?: "round" | "butt"; pvDa?: string; pvF?: boolean }[] = [
  { type: "ballpoint", glyph: "pen-ballpoint", label: tk("Ballpoint"), pvW2: 2 },
  { type: "fountain", glyph: "pen-fountain", label: tk("Fountain"), pvW2: 2.6 },
  { type: "brush", glyph: "pen-brush", label: tk("Brush"), pv: "M4 15 C 30 0, 55 22, 116 9 C 55 26, 30 6, 4 15z", pvF: true, pvW2: 0.5 },
  { type: "marker", glyph: "pen-marker", label: tk("Marker"), pvW2: 7, pvO: 0.8, pvCap: "butt" },
  { type: "highlighter", glyph: "pen-highlighter", label: tk("Highlighter"), pvW2: 11, pvO: 0.4, pvC: "#FFD43B", pvCap: "butt", pv: "M4 11 H116" },
  { type: "pencil", glyph: "pen-pencil", label: tk("Pencil"), pvW2: 1.6, pvDa: "2 1.2", later: true },
  { type: "calligraphy", glyph: "pen-calligraphy", label: tk("Calligraphy"), pv: "M4 14 C 30 2, 50 22, 70 10 S 100 6, 116 12 L 113 15 C 98 9, 74 13, 66 14 S 28 6, 6 17z", pvF: true, pvW2: 0.4, later: true },
  { type: "laser", glyph: "laser", label: tk("Laser"), pvC: "#EF6B6B", pvW2: 3, pvO: 0.7 },
];
export const PEN_PV = "M4 14 C 30 2, 50 22, 70 10 S 100 6, 116 12";
export const penMeta = (t: PenType) => PEN_TYPES.find((p) => p.type === t)!;
export const THICK_PRESETS = [1, 2.5, 5, 10, 18];

const BASE: Omit<PenSettings, "type"> = { color: "#1e1e1e", width: 2.5, opacity: 100, smoothing: "low", pressure: true, curve: "linear", straight: true };
export const PEN_DEFAULTS: Record<PenType, PenSettings> = {
  ballpoint: { ...BASE, type: "ballpoint", width: 1.5, pressure: false },
  fountain: { ...BASE, type: "fountain", width: 2.5 },
  brush: { ...BASE, type: "brush", width: 8, smoothing: "high" },
  marker: { ...BASE, type: "marker", width: 8, opacity: 80, pressure: false },
  highlighter: { ...BASE, type: "highlighter", color: "#FFD43B", width: 14, opacity: 40, pressure: false },
  pencil: { ...BASE, type: "pencil", width: 1.5, opacity: 72, pressure: true },
  calligraphy: { ...BASE, type: "calligraphy", width: 6, pressure: false },
  laser: { ...BASE, type: "laser", color: "#EF6B6B", width: 3 },
};

// ------------------------------------------------------------------ Excalidraw mapping
/** perfect-freehand (size = strokeWidth × 4.25, thinning .6, sine easing) draws ≈ 4.4 × strokeWidth at pressure .25. */
const K = 4.4;
export const pxToSw = (px: number) => Math.max(0.1, Math.round((px / K) * 1000) / 1000);
export const swToPx = (sw: number) => Math.round(sw * K * 2) / 2;
/** currentItem* values Excalidraw draws the stroke-in-progress with. */
export const appStyle = (p: PenSettings) => ({ currentItemStrokeColor: p.color, currentItemStrokeWidth: pxToSw(p.width), currentItemOpacity: p.opacity, currentItemRoughness: 0 });

// ------------------------------------------------------------------ device-local prefs (store)
export type AutoShape = "hold" | "always" | "off";
export type EraserMode = "stroke" | "partial" | "lasso";
export type EraserSize = "S" | "M" | "L";
export const ERASER_PX: Record<EraserSize, number> = { S: 8, M: 16, L: 32 };
export interface InkPrefs {
  current: PenType;
  byType: Record<PenType, PenSettings>;
  autoShape: AutoShape;
  eraser: EraserMode; eraserSize: EraserSize; scratchOut: boolean; stylusErases: boolean;
  ruler: boolean; rulerAngle: number; rulerSnap: boolean; rulerCm: boolean;
  /** Index into the saved pens, when the current pen came from one. */
  savedId: string | null;
}
const KEY = "lumen.wbPens";
const DEFAULT_PREFS: InkPrefs = { current: "fountain", byType: PEN_DEFAULTS, autoShape: "hold", eraser: "stroke", eraserSize: "M", scratchOut: true, stylusErases: true, ruler: false, rulerAngle: 0, rulerSnap: true, rulerCm: false, savedId: null };
let prefs: InkPrefs = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<InkPrefs> | null;
    if (v) return { ...DEFAULT_PREFS, ...v, byType: { ...PEN_DEFAULTS, ...Object.fromEntries(Object.entries(v.byType ?? {}).map(([k, s]) => [k, { ...PEN_DEFAULTS[k as PenType], ...s }])) } as Record<PenType, PenSettings> };
    // first run: carry over the shell's pen / highlighter ink
    const old = JSON.parse(localStorage.getItem("lumen.wbInk.pen") ?? "null") as { color: string; opacity: number } | null;
    return old ? { ...DEFAULT_PREFS, byType: { ...PEN_DEFAULTS, fountain: { ...PEN_DEFAULTS.fountain, color: old.color, opacity: old.opacity ?? 100 } } } : DEFAULT_PREFS;
  } catch { return DEFAULT_PREFS; }
})();
const subs = new Set<() => void>();
export const getInk = () => prefs;
export function setInk(p: Partial<InkPrefs> | ((x: InkPrefs) => Partial<InkPrefs>)) {
  prefs = { ...prefs, ...(typeof p === "function" ? p(prefs) : p) };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
  subs.forEach((f) => f());
}
export const onInk = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useInk = () => useSyncExternalStore(onInk, getInk);
/** Current drawing pen (never the highlighter: the highlighter tool keeps its own settings). */
export const currentPen = (x = prefs) => x.byType[x.current === "highlighter" ? "fountain" : x.current];
export const hlPen = (x = prefs) => x.byType.highlighter;
/** Update the settings of one pen type (the current one by default). */
export function setPen(p: Partial<PenSettings>, type: PenType = prefs.current) {
  setInk((x) => ({ byType: { ...x.byType, [type]: { ...x.byType[type], ...p, type } }, savedId: type === x.current ? null : x.savedId }));
}

// ------------------------------------------------------------------ saved pens (synced: Inbox space props.lumenPens)
const SPACE = "inbox", PROP = "lumenPens";
export const MAX_SAVED = 8;
export function readSaved(raw: unknown): SavedPen[] {
  try {
    const a = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(a)) return [];
    return a.filter((p) => p && typeof p.id === "string" && PEN_TYPES.some((m) => m.type === p.type)).map((p) => ({ ...PEN_DEFAULTS[p.type as PenType], ...p })).slice(0, MAX_SAVED);
  } catch { return []; }
}
const DEFAULT_SAVED: SavedPen[] = [
  { ...PEN_DEFAULTS.fountain, id: "d1", color: "#5CC8C2" }, { ...PEN_DEFAULTS.ballpoint, id: "d2", color: "#1e1e1e" }, { ...PEN_DEFAULTS.brush, id: "d3", color: "#EF6B6B" },
  { ...PEN_DEFAULTS.marker, id: "d4", color: "#E8893A" }, { ...PEN_DEFAULTS.highlighter, id: "d5", color: "#FFD43B" }, { ...PEN_DEFAULTS.ballpoint, id: "d6", color: "#7AA2F7" }, { ...PEN_DEFAULTS.fountain, id: "d7", color: "#B48EF0" },
];
/** Saved pens; until the owner saves their own, the design's starter set. */
export function useSavedPens(): SavedPen[] {
  const raw = useVaultSelector((v) => v.spaceMap.get(SPACE)?.props?.[PROP] as string | undefined);
  return useMemo(() => (raw == null ? DEFAULT_SAVED : readSaved(raw)), [raw]);
}
export async function writeSaved(fn: (cur: SavedPen[]) => SavedPen[]) {
  const sp = await db.spaces.get(SPACE);
  if (!sp) return;
  const raw = sp.props?.[PROP];
  const cur = raw == null ? DEFAULT_SAVED : readSaved(raw);
  await patch("space", SPACE, { props: { ...(sp.props ?? {}), [PROP]: JSON.stringify(fn(cur).slice(0, MAX_SAVED)) } });
}
export const rid = () => Math.random().toString(36).slice(2, 10);
export const penSub = (p: PenSettings) => `${penMeta(p.type).label} · ${p.width} px`;

// ------------------------------------------------------------------ stroke post-processing
type Pt = [number, number];
const smooth = (pts: Pt[], win: number): Pt[] => {
  if (win < 1 || pts.length < 5) return pts;
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    let sx = 0, sy = 0, n = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(pts.length - 1, i + win); j++) { sx += pts[j][0]; sy += pts[j][1]; n++; }
    return [sx / n, sy / n] as Pt;
  });
};
const curveOf = (c: Curve) => (p: number) => (c === "soft" ? Math.pow(p, 0.6) : c === "firm" ? Math.pow(p, 1.7) : p);
/** Seeded noise so a pencil stroke keeps its grain on every render. */
const grain = (i: number) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };

/**
 * Per-pen pressure profile (one function for the live overlay and the committed element). Excalidraw draws every freedraw
 * with fixed perfect-freehand options (size = strokeWidth × 4.25, thinning .6, sine easing), so a pen's look is carried by
 * its pressures: each point's radius = size × sin((.2 + .6 p) · π/2). Without stylus data the profile comes from the
 * point spacing (pointer speed), the stroke direction or the arc length, so every pen reads differently with a mouse too.
 */
export function penPressures(pts: Pt[], pr: number[], stylus: boolean, p: PenSettings, straight = false): number[] {
  const n = pts.length;
  if (!n) return [];
  const cv = curveOf(p.curve);
  const real = (i: number) => cv(pr[i] ?? 0.5);
  const clamp = (v: number) => Math.max(0.02, Math.min(1, v));
  // speed: spacing between pointer samples, smoothed over a few points (fast = thin)
  const gap = pts.map((q, i) => (i ? Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0));
  if (n > 1) gap[0] = gap[1];
  const speed = gap.map((_, i) => { let s = 0, k = 0; for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) { s += gap[j]; k++; } return s / k; });
  const ref = 3 + p.width;
  const bySpeed = (i: number) => 1 - Math.min(1, speed[i] / ref);
  // arc length for tapers
  const arc: number[] = []; let L = 0;
  for (let i = 0; i < n; i++) { L += gap[i] && i ? gap[i] : 0; arc.push(L); }
  const taper = (i: number, len: number) => Math.min(1, (arc[i] + 0.5) / len, (L - arc[i] + 0.5) / len);
  switch (p.type) {
    case "ballpoint": return pts.map(() => 0.25);
    case "fountain":
      if (straight) return pts.map(() => 0.3);
      return pts.map((_, i) => clamp(p.pressure && stylus ? real(i) : 0.04 + 0.96 * Math.pow(bySpeed(i), 1.4)));
    case "brush": {
      const len = Math.max(8, Math.min(L * 0.3, p.width * 7));
      return pts.map((_, i) => clamp(Math.pow(taper(i, len), 0.7) * (p.pressure && stylus ? 0.3 + real(i) * 0.7 : 0.3 + 0.7 * bySpeed(i))));
    }
    case "calligraphy":
      // fixed 45° nib: width follows the stroke direction
      return pts.map((_, i) => { const r = pts[Math.min(n - 1, i + 2)], l = pts[Math.max(0, i - 2)]; const a = Math.atan2(r[1] - l[1], r[0] - l[0]); return clamp(0.04 + 0.96 * Math.abs(Math.sin(a - Math.PI / 4))); });
    case "pencil": return pts.map((_, i) => clamp((p.pressure && stylus ? real(i) * 0.5 : 0.2) + (grain(i) - 0.5) * 0.36));
    case "marker": case "highlighter": return pts.map(() => 1);
    default: return pts.map((_, i) => (p.pressure && stylus ? clamp(real(i) * 0.5 + 0.05) : 0.25));
  }
}

/** Excalidraw radius factor of one pressure (sine easing, thinning .6). */
const radiusK = (q: number) => Math.sin(((0.2 + 0.6 * q) * Math.PI) / 2);
/** strokeWidth so the stroke's average width is the chosen size in px, whatever the pen's pressure shaping. */
export function strokeWidthFor(px: number, pressures: number[]): number {
  const mean = pressures.length ? pressures.reduce((s, q) => s + radiusK(q), 0) / pressures.length : radiusK(0.25);
  return Math.max(0.05, Math.round((px / (2 * 4.25 * mean)) * 1000) / 1000);
}

/**
 * Freedraw element → the element as the pen draws it. `straight` replaces the path by a straight line (hold-to-straighten),
 * `angleSnap` snaps that line to 15°.
 */
export function finishStroke<E extends Record<string, unknown>>(el: E, p: PenSettings, o: { straight?: boolean; angleSnap?: boolean } = {}): E {
  let pts = ((el.points as Pt[]) ?? []).map((q) => [q[0], q[1]] as Pt);
  const n0 = pts.length;
  let pr = (el.pressures as number[] | undefined) ?? [];
  // real stylus data only: a mouse reports a constant (0.5, or 0 in some browsers / automation)
  const hadPressure = !el.simulatePressure && pr.length === n0 && n0 > 1 && Math.max(...pr) - Math.min(...pr) > 0.02;
  if (o.straight && pts.length > 1) {
    const a = pts[0];
    let b = pts[pts.length - 1];
    if (o.angleSnap) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.round(Math.atan2(b[1] - a[1], b[0] - a[0]) / (Math.PI / 12)) * (Math.PI / 12);
      b = [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len];
    }
    const steps = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 6));
    pts = Array.from({ length: steps + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps] as Pt);
    pr = pts.map(() => 0.5);
  } else {
    pts = smooth(pts, p.smoothing === "high" ? 4 : p.smoothing === "low" ? 1 : 0);
  }
  const pressures = penPressures(pts, pr, hadPressure && !o.straight, p, !!o.straight);
  const simulate = false;
  // points are relative to (x, y): keep the first at 0,0
  const [ox, oy] = pts[0] ?? [0, 0];
  const rel = pts.map(([x, y]) => [x - ox, y - oy] as Pt);
  const xs = rel.map((q) => q[0]), ys = rel.map((q) => q[1]);
  return {
    ...el,
    x: (el.x as number) + ox, y: (el.y as number) + oy,
    points: rel, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
    pressures: simulate ? [] : pressures ?? [], simulatePressure: simulate,
    strokeWidth: strokeWidthFor(p.width, pressures), opacity: p.opacity, roughness: 0,
    customData: { ...((el.customData as object) ?? {}), lumenPen: { type: p.type, width: p.width, smoothing: p.smoothing, pressure: p.pressure, curve: p.curve } },
  };
}
