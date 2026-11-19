// Links tab (Lumen 31 · R6-31I): page snapshots for the preview pane + link check for "Broken". Server: worker/ext/links.ts.
// Snapshots are kept on this device (localStorage "lumen.snap.<url>") so the preview works offline; "Save snapshot"
// marks one as kept (not evicted). Link-check results: "lumen.linkcheck" { url: { status, since } }.
// Demo mode (no Worker): a deterministic snapshot built from the URL, and "404" for URLs that contain "/404" or
// end in "…" (the demo's dead link), so every state can be tried.
import { useSyncExternalStore } from "react";
import { API_BASE, getToken } from "./api";
import { DEMO } from "./db";

export interface Snapshot { url: string; status: number; ok: boolean; title?: string; description?: string; image?: string; site?: string; favicon?: string; headings?: string[]; text?: string; fetchedAt: number; saved?: number }
const SKEY = (u: string) => "lumen.snap." + u;
const CKEY = "lumen.linkcheck";
const MAX_CACHED = 60;

const subs = new Set<() => void>();
let ver = 0;
const bump = () => { ver++; subs.forEach((f) => f()); };
export const useLinkStore = () => useSyncExternalStore((f) => (subs.add(f), () => { subs.delete(f); }), () => ver);

export function cachedSnapshot(url: string): Snapshot | null {
  try { const s = localStorage.getItem(SKEY(url)); return s ? (JSON.parse(s) as Snapshot) : null; } catch { return null; }
}
function store(s: Snapshot) {
  try {
    localStorage.setItem(SKEY(s.url), JSON.stringify(s));
    // evict the oldest unsaved snapshots beyond MAX_CACHED
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("lumen.snap."));
    if (keys.length > MAX_CACHED) {
      const rows = keys.map((k) => { try { return { k, s: JSON.parse(localStorage.getItem(k)!) as Snapshot }; } catch { return { k, s: null }; } }).filter((r) => !r.s?.saved).sort((a, b) => (a.s?.fetchedAt ?? 0) - (b.s?.fetchedAt ?? 0));
      for (const r of rows.slice(0, keys.length - MAX_CACHED)) localStorage.removeItem(r.k);
    }
  } catch { /* storage full */ }
  bump();
}

function demoSnapshot(url: string): Snapshot {
  let host = url, path = "";
  try { const u = new URL(url); host = u.hostname.replace(/^www\./, ""); path = u.pathname; } catch { /* keep */ }
  const slug = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "").replace(/\.[a-z]+$/i, "").replace(/[-_]+/g, " ").trim();
  const title = slug ? slug.replace(/\b\w/g, (c) => c.toUpperCase()) : host;
  const dead = /\/404|…$/.test(url);
  return { url, status: dead ? 404 : 200, ok: !dead, title, site: host, description: dead ? undefined : `A page on ${host} (demo snapshot; the real one is fetched by your Worker).`,
    headings: dead ? [] : ["Overview", "Details"], text: dead ? "" : `${title}.\n\nThis preview is generated in demo mode. Signed in, Lumen fetches the page through your Cloudflare Worker and keeps a readable copy on this device so it opens offline.`, fetchedAt: Date.now() };
}

/** The page snapshot: cached copy first (offline), else fetched through the Worker. */
export async function getSnapshot(url: string, fresh = false): Promise<Snapshot | null> {
  const c = cachedSnapshot(url);
  if (c && !fresh) return c;
  if (DEMO && !getToken()) { const s = { ...demoSnapshot(url), saved: c?.saved }; store(s); return s; }
  if (!getToken() || (typeof navigator !== "undefined" && navigator.onLine === false)) return c;
  try {
    const r = await fetch(`${API_BASE}/api/links/snapshot?url=${encodeURIComponent(url)}${fresh ? "&fresh=1" : ""}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!r.ok) return c;
    const s = { ...((await r.json()) as Snapshot), url, saved: c?.saved };
    store(s);
    if (!s.ok) recordStatus(url, s.status);
    return s;
  } catch { return c; }
}
/** "Save snapshot": keep this page's copy (refetched now when online). */
export async function saveSnapshot(url: string): Promise<Snapshot | null> {
  const s = (await getSnapshot(url, true)) ?? cachedSnapshot(url);
  if (!s) return null;
  const kept = { ...s, saved: Date.now() };
  store(kept);
  return kept;
}

// ------------------------------------------------------------------ link check
type Checks = Record<string, { status: number; since: number }>;
const readChecks = (): Checks => { try { return JSON.parse(localStorage.getItem(CKEY) ?? "{}") as Checks; } catch { return {}; } };
function recordStatus(url: string, status: number) {
  const c = readChecks();
  const bad = status === 0 || status >= 400;
  if (bad) c[url] = { status, since: c[url]?.status === status ? c[url].since : Date.now() };
  else delete c[url];
  try { localStorage.setItem(CKEY, JSON.stringify(c)); } catch { /* full */ }
  bump();
}
/** Why a web link is broken ("404 since 2 Nov"), or null. */
export function brokenReason(url: string, fmt: (status: number, since: number) => string): string | null {
  const c = readChecks()[url];
  return c ? fmt(c.status, c.since) : null;
}
/** Check these URLs now (Worker; demo: simulated). Returns how many are broken. */
export async function checkLinks(urls: string[]): Promise<number> {
  const list = [...new Set(urls)].slice(0, 40);
  if (!list.length) return 0;
  let results: Record<string, number> = {};
  if (DEMO && !getToken()) results = Object.fromEntries(list.map((u) => [u, demoSnapshot(u).status]));
  else {
    const r = await fetch(`${API_BASE}/api/links/check`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` }, body: JSON.stringify({ urls: list }) });
    if (!r.ok) throw new Error(`Link check failed (${r.status})`);
    results = ((await r.json()) as { results: Record<string, number> }).results;
  }
  let bad = 0;
  for (const [u, st] of Object.entries(results)) { recordStatus(u, st); if (st === 0 || st >= 400) bad++; }
  return bad;
}
