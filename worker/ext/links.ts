import type { Hono } from "hono";
import type { Env, Helpers } from "../index";

/**
 * Note › Links tab (design round 6, Lumen 31 · R6-31I…K; client src/components/NoteTabs.tsx, docs/NOTE_TABS.md).
 *
 * GET  /api/links/snapshot?url=…   a readable snapshot of a web page for the preview pane (works offline once the
 *                                  client keeps it): { url, status, ok, title, description, image, site, favicon,
 *                                  headings[], text (≤ 2,400 chars of the main text), fetchedAt }
 * POST /api/links/check {urls[]}   link check for "Broken" (≤ 40 urls, HEAD then GET): { results: { [url]: status } }
 *                                  (status 0 = unreachable)
 * Signed in only (it fetches arbitrary pages on the user's behalf); http(s) only, private / local hosts refused.
 */
const UA = "Mozilla/5.0 (compatible; LumenLinkPreview/1.0)";
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;
const okUrl = (s: string) => { try { const u = new URL(s); return /^https?:$/.test(u.protocol) && !PRIVATE.test(u.hostname) ? u : null; } catch { return null; } };
const ent = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const strip = (h: string) => ent(h.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export function readable(html: string, base: string) {
  const tag = (prop: string) => new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i").exec(html)?.[0];
  const content = (t?: string) => (t ? /content=["']([^"']*)["']/i.exec(t)?.[1] : undefined);
  const abs = (u?: string) => { if (!u) return undefined; try { return new URL(ent(u), base).href; } catch { return undefined; } };
  const title = content(tag("og:title")) ?? content(tag("twitter:title")) ?? /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  const description = content(tag("og:description")) ?? content(tag("description")) ?? content(tag("twitter:description"));
  const icon = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i.exec(html)?.[0];
  const body = (/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i.exec(html)?.[2] ?? /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html)
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const headings = [...body.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => strip(m[2])).filter((x) => x.length > 1 && x.length < 140).slice(0, 8);
  const paras = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => strip(m[1])).filter((x) => x.length > 40);
  let text = "";
  for (const p of paras) { if (text.length > 2400) break; text += (text ? "\n\n" : "") + p; }
  return {
    title: title && ent(title.trim()).slice(0, 200), description: description && ent(description.trim()).slice(0, 400),
    image: abs(content(tag("og:image")) ?? content(tag("twitter:image"))), site: content(tag("og:site_name")),
    favicon: abs(icon && /href=["']([^"']+)["']/i.exec(icon)?.[1]) ?? new URL("/favicon.ico", base).href,
    headings, text: text.slice(0, 2400),
  };
}

async function status(u: URL): Promise<number> {
  const go = (method: string) => fetch(u.href, { method, headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(8000) });
  try {
    let r = await go("HEAD");
    if (r.status === 405 || r.status === 403 || r.status === 501) { r = await go("GET"); void r.body?.cancel().catch(() => {}); }
    return r.status;
  } catch { return 0; }
}

export default function register(api: Hono<Env>, h: Helpers) {
  api.get("/links/snapshot", h.auth, async (c) => {
    const u = okUrl(c.req.query("url") ?? "");
    if (!u) return c.json({ error: "bad url" }, 400);
    const cache = caches.default;
    const key = new Request(`https://snap.lumen/${encodeURIComponent(u.href)}`);
    if (!c.req.query("fresh")) { const hit = await cache.match(key); if (hit) return hit; }
    let out: Record<string, unknown> = { url: u.href, status: 0, ok: false, fetchedAt: Date.now() };
    try {
      const r = await fetch(u.href, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(10_000) });
      out = { ...out, status: r.status, ok: r.ok, url: r.url || u.href };
      if (r.ok && (r.headers.get("content-type") ?? "").includes("html") && r.body) {
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let html = "";
        while (html.length < 600_000) { const { done, value } = await reader.read(); if (done) break; html += dec.decode(value, { stream: true }); }
        void reader.cancel().catch(() => {});
        out = { ...out, ...readable(html, r.url || u.href) };
      }
    } catch { /* unreachable: status 0 */ }
    const res = new Response(JSON.stringify(out), { headers: { "content-type": "application/json", "cache-control": "private, max-age=21600" } });
    c.executionCtx.waitUntil(cache.put(key, res.clone()));
    return res;
  });

  api.post("/links/check", h.auth, async (c) => {
    const b = await c.req.json<{ urls?: string[] }>().catch(() => ({} as { urls?: string[] }));
    const urls = [...new Set((Array.isArray(b.urls) ? b.urls : []).map(String))].slice(0, 40);
    const results: Record<string, number> = {};
    await Promise.all(urls.map(async (s) => { const u = okUrl(s); results[s] = u ? await status(u) : 0; }));
    return c.json({ results });
  });
}
