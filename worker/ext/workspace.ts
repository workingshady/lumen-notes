import type { Hono } from "hono";
import type { Env, Helpers } from "../index";

/**
 * API routes for the "workspace" area (embeds, design Lumen 08 · R2-2). Mounted under /api. Public (also used by the blog
 * and shared pages), cached at the edge, and restricted to known media hosts so they can't be used as an open proxy.
 *
 * GET /ws/video?url=…    YouTube / Vimeo metadata → { provider, id, title, author, duration (s), thumb (proxied path) }
 * GET /ws/thumb?u=…      proxied video thumbnail (i.ytimg.com / i.vimeocdn.com): no third-party load before the reader presses play
 * GET /ws/favicon?d=…    proxied site favicon for link-preview cards
 */
const day = 86400;
const THUMB_HOSTS = /^(i\.ytimg\.com|i\d?\.vimeocdn\.com)$/;

function ytId(u: URL) {
  if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0];
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) return u.searchParams.get("v") ?? /^\/(?:shorts|embed|live)\/([\w-]+)/.exec(u.pathname)?.[1] ?? null;
  return null;
}

async function cached(key: string, ttl: number, make: () => Promise<Response>, ctx: { waitUntil(p: Promise<unknown>): void }) {
  const cache = caches.default;
  const req = new Request(`https://ws.lumen/${encodeURIComponent(key)}`);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await make();
  if (res.ok) {
    const out = new Response(res.body, res);
    out.headers.set("cache-control", `public, max-age=${ttl}`);
    out.headers.set("access-control-allow-origin", "*");
    ctx.waitUntil(cache.put(req, out.clone()));
    return out;
  }
  return res;
}

export default function register(api: Hono<Env>, h: Helpers) {
  void h;
  api.get("/ws/video", async (c) => {
    let u: URL;
    try { u = new URL(c.req.query("url") ?? ""); } catch { return c.json({ error: "bad url" }, 400); }
    return cached("video:" + u.href, 7 * day, async () => {
      const ua = { "user-agent": "Mozilla/5.0 (compatible; LumenEmbed/1.0)", "accept-language": "en" };
      const yt = ytId(u);
      if (yt) {
        const meta: Record<string, unknown> = { provider: "youtube", id: yt, thumb: `/api/ws/thumb?u=${encodeURIComponent(`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`)}` };
        try {
          const o = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${yt}`)}`, { headers: ua });
          if (o.ok) { const j = (await o.json()) as { title?: string; author_name?: string }; meta.title = j.title; meta.author = j.author_name; }
        } catch { /* offline provider */ }
        try {
          const w = await fetch(`https://www.youtube.com/watch?v=${yt}`, { headers: ua });
          if (w.ok) { const html = await w.text(); const s = /"lengthSeconds":"(\d+)"/.exec(html)?.[1]; if (s) meta.duration = Number(s); }
        } catch { /* ignore */ }
        return Response.json(meta);
      }
      const vm = /vimeo\.com\/(?:video\/)?(\d+)/.exec(u.href);
      if (vm) {
        const meta: Record<string, unknown> = { provider: "vimeo", id: vm[1] };
        try {
          const o = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${vm[1]}`)}`, { headers: ua });
          if (o.ok) {
            const j = (await o.json()) as { title?: string; author_name?: string; duration?: number; thumbnail_url?: string };
            Object.assign(meta, { title: j.title, author: j.author_name, duration: j.duration, thumb: j.thumbnail_url ? `/api/ws/thumb?u=${encodeURIComponent(j.thumbnail_url)}` : undefined });
          }
        } catch { /* ignore */ }
        return Response.json(meta);
      }
      return Response.json({ error: "unsupported" }, { status: 400 });
    }, c.executionCtx);
  });

  api.get("/ws/thumb", async (c) => {
    let u: URL;
    try { u = new URL(c.req.query("u") ?? ""); } catch { return c.text("bad url", 400); }
    if (u.protocol !== "https:" || !THUMB_HOSTS.test(u.hostname)) return c.text("host not allowed", 400);
    return cached("thumb:" + u.href, 30 * day, async () => {
      const r = await fetch(u.href);
      if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/")) return new Response("not found", { status: 404 });
      return new Response(r.body, { headers: { "content-type": r.headers.get("content-type")! } });
    }, c.executionCtx);
  });

  api.get("/ws/favicon", async (c) => {
    const d = (c.req.query("d") ?? "").toLowerCase();
    if (!/^[a-z0-9.-]{1,253}$/.test(d)) return c.text("bad domain", 400);
    return cached("fav:" + d, 7 * day, async () => {
      const r = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=32`);
      if (!r.ok) return new Response("not found", { status: 404 });
      return new Response(r.body, { headers: { "content-type": r.headers.get("content-type") ?? "image/png" } });
    }, c.executionCtx);
  });
}
