// OG images for shared notes, courses/projects (spaces), learning paths and blog posts
// (design round 4, Lumen 21 › "OG image template · 1200×630").
//
// Template: Paper (#FAF8F3) card, 72 px inset; kicker "Blog name · #tag #tag" (24 px caps, #6A655C); title in
// Source Serif 4 bold 72/84 (wrapped, max 3 lines); meta "12 Nov 2026 · 9 min read"; Lumen mark (light tile) +
// "lumen" bottom-left; a 16 px #B45F0E bar down the right edge.
//
// Routes (under /api):
//   GET  /og/s/:token.svg          SVG for a share link (note of any type, incl. paths; or a course/project space)
//   GET  /og/post/:slug.svg        SVG for a published blog post
//   GET  /og/s/:token.png          PNG rasterized by the owner's app when the link was made (stored in D1 `files`
//   GET  /og/post/:slug.png        as id `og:s:<token>` / `og:post:<slug>`); falls back to a redirect to the SVG
//   PUT  /og/:kind/:key.png        (auth) store that PNG (≤ 1.5 MB)
// Pages: `ogPages(app)` serves /s/:token and /blog/:slug as the SPA's index.html with og:/twitter: meta tags injected
// (HTMLRewriter). That needs the Worker to run first for those paths: add "/s/*" and "/blog/*" to
// `assets.run_worker_first` in wrangler.jsonc. Without it the client sets the same tags at runtime (Shared.tsx / Blog.tsx).
import type { Hono } from "hono";
import type { Env, Helpers } from "../index";

import { esc, noteCard, ogSvg, spaceCard, type OgCard, type OgNote as Note, type OgSpace as Space } from "../../shared/og-card";

async function blogName(db: D1Database, env: Env["Bindings"]) {
  const r = await db.prepare("SELECT data FROM items WHERE kind = 'space' AND id = 'inbox'").first<{ data: string }>().catch(() => null);
  const p = r ? ((JSON.parse(r.data) as { props?: Record<string, string> }).props ?? {}) : {};
  return p.blogName || env.BLOG_NAME || "Lumen";
}
async function shareCard(c: { env: Env["Bindings"] }, token: string): Promise<OgCard | null> {
  if (!/^[\w-]{16,64}$/.test(token)) return null;
  const db = c.env.DB;
  const row = await db.prepare("SELECT kind, data FROM items WHERE json_extract(data, '$.shareId') = ? AND deleted = 0 AND kind IN ('note', 'space') LIMIT 1").bind(token).first<{ kind: string; data: string }>();
  if (!row) return null;
  const site = await blogName(db, c.env);
  if (row.kind === "note") return noteCard(JSON.parse(row.data) as Note, site);
  const sp = JSON.parse(row.data) as Space;
  const { results } = await db.prepare("SELECT data FROM items WHERE kind = 'note' AND deleted = 0 AND json_extract(data, '$.spaceId') = ?").bind(sp.id).all<{ data: string }>();
  return spaceCard(sp, results.map((r) => JSON.parse(r.data) as Note), site);
}
async function postCard(c: { env: Env["Bindings"] }, slug: string): Promise<OgCard | null> {
  const db = c.env.DB;
  const { results } = await db.prepare("SELECT data FROM items WHERE kind = 'note' AND deleted = 0 AND json_extract(data, '$.published') = 1").all<{ data: string }>();
  const n = results.map((r) => JSON.parse(r.data) as Note).find((x) => (x.slug || x.id) === slug);
  return n ? noteCard(n, await blogName(db, c.env)) : null;
}
const cardFor = (c: { env: Env["Bindings"] }, kind: string, key: string) => (kind === "s" ? shareCard(c, key) : kind === "post" ? postCard(c, key) : Promise.resolve(null));
const svgHeaders = { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=300" };

/** API routes (mounted under /api). */
export default function register(api: Hono<Env>, h: Helpers) {
  api.get("/og/:kind/:file", async (c) => {
    const kind = c.req.param("kind")!, file = c.req.param("file")!;
    const m = /^(.+)\.(svg|png)$/.exec(file);
    if (!m || (kind !== "s" && kind !== "post")) return c.json({ error: "Not found" }, 404);
    const [, key, ext] = m;
    const card = await cardFor(c, kind, key);
    if (!card) return c.json({ error: "Not found" }, 404);
    if (ext === "png") {
      const row = await c.env.DB.prepare("SELECT data FROM files WHERE id = ?").bind(`og:${kind}:${key}`).first<{ data: ArrayBuffer }>().catch(() => null);
      if (row?.data) return new Response(row.data, { headers: { "content-type": "image/png", "cache-control": "public, max-age=3600" } });
      return c.redirect(`/api/og/${kind}/${encodeURIComponent(key)}.svg`, 302);
    }
    return c.body(ogSvg(card), 200, svgHeaders);
  });
  /** The owner's app uploads the rasterized PNG (social sites don't take SVG og:images). */
  api.put("/og/:kind/:file", h.auth, async (c) => {
    const kind = c.req.param("kind")!, file = c.req.param("file")!;
    const m = /^([\w-]{1,128})\.png$/.exec(file);
    if (!m || (kind !== "s" && kind !== "post")) return c.json({ error: "Bad name" }, 400);
    const buf = await c.req.arrayBuffer();
    const sig = new Uint8Array(buf.slice(0, 8));
    if (buf.byteLength > 1_500_000 || sig[0] !== 0x89 || sig[1] !== 0x50 || sig[2] !== 0x4e || sig[3] !== 0x47) return c.json({ error: "Expected a PNG under 1.5 MB" }, 400);
    await c.env.DB.prepare("INSERT OR REPLACE INTO files (id, mime, data, created_at) VALUES (?, 'image/png', ?, ?)").bind(`og:${kind}:${m[1]}`, buf, Date.now()).run();
    return c.json({ ok: true, url: `/api/og/${kind}/${m[1]}.png` });
  });
}

/** Share / blog pages with og:/twitter: meta (needs run_worker_first for /s/* and /blog/*, see header). */
export function ogPages(app: Hono<Env>) {
  const page = (kind: "s" | "post") => async (c: import("hono").Context<Env>) => {
    const key = c.req.param(kind === "s" ? "token" : "slug")!;
    const origin = new URL(c.req.url).origin;
    const index = await c.env.ASSETS.fetch(new Request(new URL("/", c.req.url)));
    const card = await cardFor(c, kind, key).catch(() => null);
    if (!card) return index;
    const img = `${origin}/api/og/${kind}/${encodeURIComponent(key)}.png`;
    const tags: [string, string, string][] = [
      ["property", "og:type", kind === "post" ? "article" : "website"], ["property", "og:title", card.title], ["property", "og:description", card.description || card.meta],
      ["property", "og:image", img], ["property", "og:image:width", "1200"], ["property", "og:image:height", "630"], ["property", "og:url", c.req.url],
      ["property", "og:site_name", card.kicker.split(" · ")[0]], ["name", "twitter:card", "summary_large_image"], ["name", "twitter:title", card.title],
      ["name", "twitter:description", card.description || card.meta], ["name", "twitter:image", img], ["name", "description", card.description || card.meta],
    ];
    const html = tags.map(([a, k, v]) => `<meta ${a}="${k}" content="${esc(v)}">`).join("");
    return new HTMLRewriter()
      .on("title", { element: (el) => { el.setInnerContent(`${card.title} · ${card.kicker.split(" · ")[0]}`); } })
      .on("head", { element: (el) => { el.append(html, { html: true }); } })
      .transform(index);
  };
  app.get("/s/:token", page("s"));
  app.get("/s/:token/:rest{.+}", page("s"));
  app.get("/blog/:slug", page("post"));
}
