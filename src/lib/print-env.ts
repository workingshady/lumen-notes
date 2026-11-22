// Browser services for the print document builder (lib/print-doc.ts): Mermaid → SVG, attachments and web images → data: URIs,
// embedded fonts, KaTeX CSS with its fonts inline, local QR codes. Every service returns null / "" when it cannot do its job
// (offline, blocked, missing) and the builder uses its labelled fallback. Nothing here calls an external service except the
// font files (cached), the video poster (through our own Worker) and the user's own attachments.
import { API_BASE } from "./api";
import { attBlob } from "./attachments";
import { db } from "./db";
import { activeTheme, getSettings } from "./settings";
import type { Attachment, MediaMeta, PrintEnv } from "./print-doc";

const MAX_IMG_SIDE = 2000;
const MAX_IMG_BYTES = 1_200_000;
const toDataUri = (blob: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> => new Promise((res, rej) => { const id = setTimeout(() => rej(new Error("timeout")), ms); p.then((v) => { clearTimeout(id); res(v); }, (e) => { clearTimeout(id); rej(e); }); });

/** Shrink a huge raster image (long side ≤ 2000 px, ≤ ~1.2 MB) so the document stays a sensible size; GIF / SVG are kept as they are. */
export async function shrinkImage(blob: Blob): Promise<Blob> {
  if (!/^image\/(png|jpe?g|webp|bmp)$/.test(blob.type)) return blob;
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) return blob;
  const long = Math.max(bmp.width, bmp.height);
  if (long <= MAX_IMG_SIDE && blob.size <= MAX_IMG_BYTES) { bmp.close?.(); return blob; }
  const k = Math.min(1, MAX_IMG_SIDE / long);
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(bmp.width * k)); cv.height = Math.max(1, Math.round(bmp.height * k));
  const g = cv.getContext("2d")!;
  g.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  const enc = (type: string, q?: number) => new Promise<Blob | null>((r) => cv.toBlob(r, type, q));
  // PNG keeps transparency; a photo-like PNG that grew is better as JPEG (on white). Keep whichever is smallest.
  const candidates: Blob[] = [];
  if (blob.type === "image/png") { const png = await enc("image/png"); if (png) candidates.push(png); }
  const flat = document.createElement("canvas");
  flat.width = cv.width; flat.height = cv.height;
  const fg = flat.getContext("2d")!;
  fg.fillStyle = "#fff"; fg.fillRect(0, 0, flat.width, flat.height); fg.drawImage(cv, 0, 0);
  const jpeg = await new Promise<Blob | null>((r) => flat.toBlob(r, "image/jpeg", 0.84));
  if (jpeg && (blob.type !== "image/png" || !candidates.length || candidates[0].size >= blob.size || jpeg.size < candidates[0].size * 0.6)) candidates.push(jpeg);
  const best = candidates.sort((a, b) => a.size - b.size)[0];
  return best && best.size < blob.size ? best : blob;
}

// ------------------------------------------------------------------ fonts
const fontCache = new Map<string, Promise<string | null>>();
const b64 = (buf: ArrayBuffer) => { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const inRanges = (cps: Set<number>, range: string) => {
  for (const part of range.split(",")) {
    const m = /U\+([0-9A-F?]+)(?:-([0-9A-F]+))?/i.exec(part.trim());
    if (!m) continue;
    let lo: number, hi: number;
    if (m[1].includes("?")) { lo = parseInt(m[1].replace(/\?/g, "0"), 16); hi = parseInt(m[1].replace(/\?/g, "F"), 16); } else { lo = parseInt(m[1], 16); hi = m[2] ? parseInt(m[2], 16) : lo; }
    for (const c of cps) if (c >= lo && c <= hi) return true;
  }
  return false;
};
async function familyCss(query: string, cps: Set<number>): Promise<string | null> {
  if (!fontCache.has(query)) {
    fontCache.set(query, (async () => {
      const css = await withTimeout(fetch(`https://fonts.googleapis.com/css2?family=${query}&display=block`).then((r) => (r.ok ? r.text() : Promise.reject(new Error("css")))), 9000);
      return css;
    })().catch(() => null));
  }
  const css = await fontCache.get(query)!;
  if (!css) return null;
  const out: string[] = [];
  for (const m of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const range = /unicode-range:\s*([^;]+)/.exec(m[1])?.[1];
    if (range && !inRanges(cps, range)) continue;
    const url = /url\((https:[^)]+)\)/.exec(m[1])?.[1];
    if (!url) continue;
    const key = "file:" + url;
    if (!fontCache.has(key)) fontCache.set(key, withTimeout(fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("font")))), 12000).then((b) => b64(b)).catch(() => null));
    const data = await fontCache.get(key)!;
    if (!data) return null; // one missing file: use the system stack rather than half the faces
    out.push(`@font-face{${m[1].replace(/src:[^;]+;/, `src:url(data:font/woff2;base64,${data}) format("woff2");`).replace(/\s+/g, " ")}}`);
  }
  return out.join("");
}
/** Inter, Source Serif 4, JetBrains Mono, IBM Plex Sans Arabic: only the unicode ranges the text uses, as base64 woff2. "" when offline. */
export async function printFonts(text: string, o: { mono: boolean; serif: boolean; arabic: boolean; italic: boolean }): Promise<string> {
  const cps = new Set<number>([32, ...[...text].map((ch) => ch.codePointAt(0)!)]);
  const fams = [
    `Inter:ital,wght@0,100..900${o.italic ? ";1,100..900" : ""}`,
    ...(o.serif ? [`Source+Serif+4:ital,opsz,wght@0,8..60,200..900${o.italic ? ";1,8..60,200..900" : ""}`] : []),
    ...(o.mono ? ["JetBrains+Mono:wght@100..800"] : []),
    ...(o.arabic ? ["IBM+Plex+Sans+Arabic:wght@400;600;700"] : []),
  ];
  const parts = await Promise.all(fams.map((f) => familyCss(f, cps)));
  if (parts.some((p) => p === null)) return ""; // offline or blocked: the system font stack carries the document
  return parts.join("");
}

// ------------------------------------------------------------------ KaTeX css with its fonts inline
type FontLoader = () => Promise<string>;
let katexParts: Promise<{ css: string; fonts: Record<string, FontLoader> }> | null = null;
async function loadKatex() {
  katexParts ??= (async () => {
    const [{ default: css }, fonts] = await Promise.all([
      import("katex/dist/katex.min.css?inline"),
      Promise.resolve(import.meta.glob("../../node_modules/katex/dist/fonts/*.woff2", { query: "?inline", import: "default" }) as Record<string, FontLoader>),
    ]);
    return { css, fonts };
  })();
  return katexParts;
}
/** KaTeX's stylesheet with the used font faces as data: URIs (woff2 only; the app's browsers all read it). */
export async function inlineKatexCss(html: string, load = loadKatex): Promise<string> {
  const { css, fonts } = await load();
  return embedKatexFonts(css, html, fonts);
}
/** Pure part (tested in Node): keep the font faces whose families the rendered math uses, with woff2 data URIs. */
export async function embedKatexFonts(css: string, html: string, fonts: Record<string, () => Promise<string>>): Promise<string> {
  const used = new Set<string>(["KaTeX_Main", "KaTeX_Math"]);
  for (const m of css.matchAll(/([^{}]+)\{[^{}]*font-family:\s*"?(KaTeX_\w+)"?[^{}]*\}/g)) {
    const classes = [...m[1].matchAll(/\.([\w-]+)/g)].map((x) => x[1]).filter((x) => x !== "katex");
    if (html === "*" || (classes.length && classes.every((cl) => new RegExp(`class="[^"]*\\b${cl}\\b`).test(html)))) used.add(m[2]);
  }
  const byName = new Map(Object.entries(fonts).map(([p, f]) => [p.split("/").pop()!, f]));
  let out = css;
  const faces = [...css.matchAll(/@font-face\s*{[^}]*}/g)].map((m) => m[0]);
  for (const face of faces) {
    const fam = /font-family:\s*"?(KaTeX_\w+)"?/.exec(face)?.[1] ?? "";
    const file = /url\(([^)]*?([\w-]+\.woff2))\)/.exec(face)?.[2];
    const load = file ? byName.get(file) : undefined;
    if (!used.has(fam) || !load) { out = out.replace(face, ""); continue; }
    const uri = await load();
    out = out.replace(face, face.replace(/src:[^;}]+/, `src:url(${uri}) format("woff2")`));
  }
  return out;
}

// ------------------------------------------------------------------ media
const mediaCache = new Map<string, MediaMeta | null>();
async function mediaMeta(provider: string, id: string, href: string): Promise<MediaMeta | null> {
  const key = provider + id;
  if (mediaCache.has(key)) return mediaCache.get(key)!;
  let meta: { title?: string; thumb?: string } | null = null;
  try { const c = localStorage.getItem("lumen.vmeta." + href); if (c) meta = JSON.parse(c); } catch { /* none cached */ }
  if (!meta) {
    try {
      const r = await withTimeout(fetch(`${API_BASE}/api/ws/video?url=${encodeURIComponent(href)}`), 6000);
      if (r.ok) meta = (await r.json()) as { title?: string; thumb?: string };
    } catch { /* offline: the title and URL stay */ }
  }
  let poster: string | undefined;
  const thumb = meta?.thumb ?? (provider === "youtube" ? `/api/ws/thumb?u=${encodeURIComponent(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`)}` : undefined);
  if (thumb) {
    try {
      const r = await withTimeout(fetch(thumb.startsWith("/") ? API_BASE + thumb : thumb), 7000);
      if (r.ok && (r.headers.get("content-type") ?? "").startsWith("image/")) poster = await toDataUri(await shrinkImage(await r.blob()));
    } catch { /* no poster */ }
  }
  const out = meta?.title || poster ? { title: meta?.title, poster } : null;
  mediaCache.set(key, out);
  return out;
}

export interface EnvOptions { signal?: AbortSignal; onProgress?: PrintEnv["onProgress"] }
/** The real environment: DOM, the app's Markdown renderer, Mermaid, the user's attachments. */
export function browserEnv(eo: EnvOptions = {}): PrintEnv {
  return {
    doc: document,
    render: (md) => renderMd(md),
    mermaid: async (src, mode) => {
      const { renderMermaidForExport } = await import("./markdown");
      return renderMermaidForExport(src, mode === "screen" ? "app" : mode === "bw" ? "neutral" : "default", true);
    },
    canvasSvg: async (json) => {
      const { parseCanvas, previewSvg } = await import("./canvas");
      const { canvas, error } = parseCanvas(json);
      return error ? null : previewSvg(canvas, 760, 460).replace(/currentColor/g, "#444");
    },
    attachment: async (id): Promise<Attachment | null> => {
      const [blob, meta] = await Promise.all([attBlob(id), db.attachments.get(id)]);
      if (!blob) return null;
      const mime = blob.type || meta?.mime || "application/octet-stream";
      const out = mime.startsWith("image/") ? await shrinkImage(blob) : blob;
      return { mime, data: await toDataUri(out), name: meta?.name };
    },
    image: async (url) => {
      try {
        const r = await withTimeout(fetch(url, { mode: "cors", credentials: "omit", signal: eo.signal }), 9000);
        if (!r.ok) return null;
        const b = await r.blob();
        if (!b.type.startsWith("image/") || b.size > 12_000_000) return null;
        return await toDataUri(await shrinkImage(b));
      } catch { return null; }
    },
    media: mediaMeta,
    qr: async (url) => {
      const QR = await import("qrcode");
      const svg = await QR.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
      return "data:image/svg+xml;base64," + btoa(svg);
    },
    fonts: printFonts,
    katexCss: (html) => inlineKatexCss(html),
    screen: () => { const th = activeTheme(); return { vars: th.vars, dark: th.dark }; },
    bodyFont: () => getSettings().readingFont,
    signal: eo.signal,
    onProgress: eo.onProgress,
  };
}
let renderFn: ((md: string) => string) | null = null;
function renderMd(md: string): string {
  if (!renderFn) throw new Error("markdown renderer not loaded");
  return renderFn(md);
}
/** The Markdown renderer is part of the main bundle; load it once before building (print-doc calls render synchronously). */
export async function primeRender() { renderFn ??= (await import("./markdown")).render; }
