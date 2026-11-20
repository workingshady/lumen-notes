// Diagram export: SVG (vector) and PNG / JPEG / WebP (raster) at any scale, with background, padding, theme and
// quality options, plus copy-to-clipboard. Pipeline (the reliable browser route):
//   Mermaid source → render with SVG <text> labels (renderMermaidForExport) → normalise size, add padding/background,
//   embed the used font glyphs → SVG string → (raster) draw on a canvas at scale → toBlob.
// Browser limits: a canvas side ≤ 32,767 px and area ≤ 268,435,456 px (Chrome/Safari), so large scales are reduced.
import { DIAGRAM_EXPORT_DEFAULTS, getSettings, setSettings, type DiagramExportPrefs } from "./settings";
import { t } from "./i18n";

export type { DiagramExportPrefs };
export const MAX_SIDE = 32_767, MAX_AREA = 268_435_456;
export const exportPrefs = (): DiagramExportPrefs => ({ ...DIAGRAM_EXPORT_DEFAULTS, ...(getSettings().diagramExport ?? {}) });
export const saveExportPrefs = (p: Partial<DiagramExportPrefs>) => setSettings({ diagramExport: { ...exportPrefs(), ...p } });

const LIGHT_BG = "#ffffff", DARK_BG = "#1b1d22";
/** The background a "theme" choice resolves to. */
export function themeBackground(theme: DiagramExportPrefs["theme"]): string {
  if (theme === "dark") return DARK_BG;
  if (theme === "app") return getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || LIGHT_BG;
  return LIGHT_BG;
}
export function backgroundOf(p: DiagramExportPrefs): string | null {
  if (p.background === "custom") return p.color;
  if (p.background === "theme" || p.format === "jpeg") return themeBackground(p.theme); // JPEG has no transparency
  return null;
}

// ------------------------------------------------------------------ fonts: embed only the glyphs the diagram uses
const fontCache = new Map<string, Promise<string>>();
const toB64 = (buf: ArrayBuffer) => { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
/** @font-face rules (base64 woff2, subset to `text`) for Inter, plus IBM Plex Sans Arabic when the text has Arabic. */
export async function fontFaces(text: string): Promise<string> {
  const chars = [...new Set(text)].join("");
  if (!chars.trim()) return "";
  const key = chars;
  if (!fontCache.has(key)) {
    fontCache.set(key, (async () => {
      const families = ["Inter:wght@400;500;600;700", ...(/[؀-ۿ]/.test(chars) ? ["IBM+Plex+Sans+Arabic:wght@400;600"] : [])];
      const rules: string[] = [];
      for (const fam of families) {
        const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${fam}&text=${encodeURIComponent(chars)}`)).text();
        for (const m of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
          const url = /url\((https:[^)]+)\)/.exec(m[1])?.[1];
          if (!url) continue;
          const b64 = toB64(await (await fetch(url)).arrayBuffer());
          rules.push(`@font-face{${m[1].replace(/src:[^;]+;/, `src:url(data:font/woff2;base64,${b64}) format("woff2");`)}}`);
        }
      }
      return rules.join("");
    })().catch(() => ""));
  }
  return fontCache.get(key)!;
}

// ------------------------------------------------------------------ build the export SVG
export interface BuiltSvg { svg: string; width: number; height: number }
/** Render `src` and return a standalone SVG with padding, background and (optionally) embedded fonts. */
export async function buildSvg(src: string, p: DiagramExportPrefs): Promise<BuiltSvg> {
  const { renderMermaidForExport } = await import("./markdown"); // the renderer loads with the first export
  const raw = await renderMermaidForExport(src, p.theme, p.svgText);
  const doc = new DOMParser().parseFromString(raw, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.nodeName !== "svg") throw new Error(t("Mermaid did not return an SVG"));
  const vb = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  let [x, y, w, h] = vb.length === 4 && vb.every(Number.isFinite) ? vb : [0, 0, parseFloat(svg.getAttribute("width") ?? "800"), parseFloat(svg.getAttribute("height") ?? "600")];
  const pad = Math.max(0, p.padding);
  x -= pad; y -= pad; w += pad * 2; h += pad * 2;
  svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
  svg.setAttribute("width", String(Math.round(w)));
  svg.setAttribute("height", String(Math.round(h)));
  svg.removeAttribute("style"); // mermaid's max-width would shrink it in other apps
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  const bg = backgroundOf(p);
  if (bg) {
    const r = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", String(x)); r.setAttribute("y", String(y)); r.setAttribute("width", String(w)); r.setAttribute("height", String(h)); r.setAttribute("fill", bg);
    svg.insertBefore(r, svg.firstChild);
  }
  if (p.embedFont) {
    const faces = await fontFaces(svg.textContent ?? "");
    if (faces) {
      const st = doc.createElementNS("http://www.w3.org/2000/svg", "style");
      st.textContent = faces;
      svg.insertBefore(st, svg.firstChild);
    }
  }
  return { svg: new XMLSerializer().serializeToString(svg), width: w, height: h };
}

// ------------------------------------------------------------------ rasterize
/** Largest usable scale for a w×h diagram within the browser's canvas limits. */
export function maxScale(w: number, h: number) {
  return Math.max(0.1, Math.min(MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h))));
}
export async function rasterize(b: BuiltSvg, p: DiagramExportPrefs): Promise<{ blob: Blob; width: number; height: number; scale: number }> {
  const scale = Math.min(p.scale, maxScale(b.width, b.height));
  const W = Math.max(1, Math.round(b.width * scale)), H = Math.max(1, Math.round(b.height * scale));
  const url = URL.createObjectURL(new Blob([b.svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    const bg = backgroundOf(p);
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
    ctx.drawImage(img, 0, 0, W, H);
    const type = p.format === "jpeg" ? "image/jpeg" : p.format === "webp" ? "image/webp" : "image/png";
    const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, type, p.format === "png" ? undefined : p.quality));
    if (!blob) throw new Error(t("The browser could not encode the image (too large?)"));
    return { blob, width: W, height: H, scale };
  } finally { URL.revokeObjectURL(url); }
}

export const exportDiagram = async (src: string, p: DiagramExportPrefs) => finalize(await buildSvg(src, p), p);
/** The final file for the chosen format from a built SVG. */
export async function finalize(b: BuiltSvg, p: DiagramExportPrefs): Promise<{ blob: Blob; width: number; height: number; scale: number }> {
  if (p.format === "svg") return { blob: new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${b.svg}`], { type: "image/svg+xml" }), width: Math.round(b.width), height: Math.round(b.height), scale: 1 };
  return rasterize(b, p);
}

export const EXT: Record<DiagramExportPrefs["format"], string> = { svg: "svg", png: "png", jpeg: "jpg", webp: "webp" };
export const safeName = (s: string) => (s.replace(/\.mermaid$/i, "").replace(/[\\/:*?"<>|]+/g, "-").trim() || "diagram").slice(0, 80);

export async function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
/** Copy a PNG to the clipboard (Chrome 76+, Firefox 127+, Safari 13.1+). */
export async function copyImage(blob: Blob) {
  if (!("ClipboardItem" in window) || !navigator.clipboard?.write) throw new Error(t("This browser can't copy images; download instead."));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

/**
 * Something the Export dialog can export: a Mermaid diagram, a whole canvas or the graph. `build` returns a standalone
 * SVG for the options (background, padding, fonts and, when `themable`, the theme); the dialog does the rest.
 */
export interface ExportJob { name: string; title: string; build: (p: DiagramExportPrefs) => Promise<BuiltSvg>; themable: boolean; src?: string }
/** Open the export dialog (DiagramExport.tsx listens). */
export function openExport(job: ExportJob) { dispatchEvent(new CustomEvent("lumen:export", { detail: job })); }
export function openDiagramExport(src: string, name = "diagram") {
  openExport({ name, title: t("Export diagram"), src, themable: true, build: (p) => buildSvg(src, p) });
}
