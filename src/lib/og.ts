// Client side of the OG image (design round 4, Lumen 21): build the card from local data with the shared
// template data (shared/og-card.ts), draw it on a 1200×630 canvas with the app's fonts and upload the PNG to the Worker
// (PUT /api/og/<kind>/<key>.png). Social sites read /api/og/<kind>/<key>.png from the share/blog page meta.
// Skipped when signed out / in demo mode (nothing syncs there).
import type { Note, Space } from "../../shared/types";
import { noteCard, spaceCard, type OgCard } from "../../shared/og-card";
import { API_BASE, getToken } from "./api";
import { db, DEFAULT_SPACE } from "./db";
import { getSettings } from "./settings";

async function siteName() {
  const p = (await db.spaces.get(DEFAULT_SPACE))?.props ?? {};
  return p.blogName || getSettings().blogName || "Lumen";
}

/** The OG card for a note or a space, from local data. */
export async function localOgCard(target: { kind: "note"; note: Note } | { kind: "space"; space: Space }): Promise<OgCard> {
  const site = await siteName();
  if (target.kind === "note") return noteCard(target.note, site);
  const notes = (await db.notes.where("spaceId").equals(target.space.id).toArray()).filter((n) => !n.deleted);
  return spaceCard(target.space, notes, site);
}

const MARK_LIGHT = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D98A1E" stop-opacity=".22"/><stop offset="1" stop-color="#D98A1E" stop-opacity="0"/></linearGradient><radialGradient id="g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#D98A1E" stop-opacity=".28"/><stop offset="1" stop-color="#D98A1E" stop-opacity="0"/></radialGradient></defs><rect x=".5" y=".5" width="63" height="63" rx="16" fill="#FFFFFF" stroke="#E4DFD3"/><circle cx="32" cy="22" r="15" fill="url(#g)"/><path d="M27 27 L37 27 L51 45 L13 45 Z" fill="url(#c)"/><path d="M32 11.5 C35.6 15.6 38 18.9 38 22.4 A6 6 0 0 1 26 22.4 C26 18.9 28.4 15.6 32 11.5 Z" fill="#D98A1E"/><rect x="12" y="44" width="40" height="3.5" rx="1.75" fill="#1F1D1A"/></svg>`;
const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("image")); i.src = src; });
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/** Wrap by real text metrics (max `lines`, ellipsis on the last). */
function wrapMeasured(g: CanvasRenderingContext2D, text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let line = "";
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (g.measureText(next).width <= max || !line) { line = next; continue; }
    out.push(line); line = words[i];
    if (out.length === lines) { line = ""; break; }
  }
  if (line) out.push(line);
  const full = out.join(" ").length < text.trim().length;
  if (full && out.length) { let l = out[out.length - 1]; while (l && g.measureText(l + "…").width > max) l = l.replace(/\s*\S+$/, ""); out[out.length - 1] = (l || out[out.length - 1]) + "…"; }
  return out.slice(0, lines);
}

/** Draw the OG card on a 1200×630 canvas with the app's real fonts (Source Serif 4, Inter) and return a PNG. */
export async function ogPng(card: OgCard): Promise<Blob> {
  const serif = "'Source Serif 4', Georgia, 'IBM Plex Sans Arabic', serif", sans = "Inter, 'IBM Plex Sans Arabic', system-ui, sans-serif";
  try { await Promise.all([document.fonts.load(`700 72px 'Source Serif 4'`, card.title), document.fonts.load(`600 24px Inter`), document.fonts.load(`400 26px Inter`)]); } catch { /* fallback fonts */ }
  const c = document.createElement("canvas");
  c.width = 1200; c.height = 630;
  const g = c.getContext("2d")!;
  g.fillStyle = "#FAF8F3"; g.fillRect(0, 0, 1200, 630);
  g.fillStyle = "#B45F0E"; g.fillRect(1184, 0, 16, 630);
  const L = 80, W = 1040, rtl = RTL.test(card.title);
  g.textBaseline = "alphabetic";
  // kicker: 12 px caps, .06em tracking (×2)
  g.font = `600 24px ${sans}`; g.fillStyle = "#6A655C";
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "1.44px";
  g.fillText(card.kicker.toUpperCase(), L, 95, W);
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "-1.44px";
  // title: serif 36/42 bold (×2), max 3 lines
  g.font = `700 72px ${serif}`; g.fillStyle = "#1F1D1A";
  g.direction = rtl ? "rtl" : "ltr"; g.textAlign = rtl ? "right" : "left";
  const lines = wrapMeasured(g, card.title, W, 3);
  const top = 194;
  lines.forEach((l, i) => g.fillText(l, rtl ? L + W : L, top + i * 84));
  g.direction = "ltr"; g.textAlign = "left";
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px";
  g.font = `400 26px ${sans}`; g.fillStyle = "#6A655C";
  g.fillText(card.meta, L, top + (lines.length - 1) * 84 + 73, W);
  // mark + wordmark, bottom-left
  try { g.drawImage(await loadImg("data:image/svg+xml;charset=utf-8," + encodeURIComponent(MARK_LIGHT)), L, 630 - 60 - 44, 44, 44); } catch { /* no mark */ }
  g.font = `600 30px ${sans}`; g.fillStyle = "#1F1D1A";
  (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "-1.3px";
  g.fillText("lumen", L + 44 + 16, 630 - 60 - 12);
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
}

const done = new Map<string, string>();
const demo = () => { try { return new URLSearchParams(location.search).has("demo"); } catch { return false; } };

/** Render + upload the OG PNG for a share token ("s") or a blog post slug ("post"). Quietly no-ops offline / signed out. */
export async function publishOgImage(kind: "s" | "post", key: string, card: OgCard): Promise<boolean> {
  const tok = getToken();
  if (!tok || demo() || !key) return false;
  const sig = JSON.stringify(card);
  const id = `${kind}:${key}`;
  if (done.get(id) === sig) return true;
  try {
    const png = await ogPng(card);
    const r = await fetch(`${API_BASE}/api/og/${kind}/${encodeURIComponent(key)}.png`, { method: "PUT", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "image/png" }, body: png });
    if (r.ok) done.set(id, sig);
    return r.ok;
  } catch { return false; }
}

/** Set og:/twitter: meta in <head> at runtime (crawlers that run JS; the Worker injects the same server-side). */
export function setOgMeta(card: OgCard | null, image: string) {
  if (typeof document === "undefined") return;
  document.head.querySelectorAll("meta[data-lumen-og]").forEach((m) => m.remove());
  if (!card) return;
  const tags: [string, string, string][] = [["property", "og:title", card.title], ["property", "og:description", card.description || card.meta], ["property", "og:image", image],
    ["property", "og:image:width", "1200"], ["property", "og:image:height", "630"], ["name", "twitter:card", "summary_large_image"], ["name", "twitter:image", image]];
  for (const [a, k, v] of tags) { const m = document.createElement("meta"); m.setAttribute(a, k); m.content = v; m.dataset.lumenOg = "1"; document.head.appendChild(m); }
}
