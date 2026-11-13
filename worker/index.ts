import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import type { JsonCanvas, Kind, Note, SyncItem, SyncRequest, SyncResponse } from "../shared/types";
import { KINDS } from "../shared/types";

type Env = {
  Bindings: {
    DB: D1Database;
    FILES?: R2Bucket;
    AI?: Ai;
    ASSETS: Fetcher;
    /** Owner passphrase (wrangler secret). */
    APP_PASSCODE: string;
    BLOG_NAME?: string;
  };
};

const app = new Hono<Env>();
const api = new Hono<Env>();

// Capacitor (Android) runs the app from https://localhost, so the API allows cross-origin bearer-token calls.
api.use("*", cors({ origin: (o) => o ?? "*", allowHeaders: ["Authorization", "Content-Type"], allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], maxAge: 86400 }));

// ------------------------------------------------------------------ auth (single owner, bearer token)
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
/** Token = HMAC(passcode). Changing the passcode secret signs every device out. */
const ownerToken = (env: Env["Bindings"]) => hmac(env.APP_PASSCODE, "lumen:owner:v1");

const failures = new Map<string, { n: number; until: number }>(); // per-isolate brute-force brake
api.post("/login", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? "?";
  const f = failures.get(ip);
  if (f && f.until > Date.now()) return c.json({ error: "Too many attempts, wait a minute." }, 429);
  const { passcode } = await c.req.json<{ passcode?: string }>().catch(() => ({ passcode: "" }));
  if (!c.env.APP_PASSCODE) return c.json({ error: "Server passcode not configured." }, 500);
  if (!passcode || !safeEqual(await hmac("cmp", passcode), await hmac("cmp", c.env.APP_PASSCODE))) {
    const n = (f?.n ?? 0) + 1;
    failures.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 * 2 ** Math.min(n - 5, 8) : 0 });
    return c.json({ error: "Wrong passcode." }, 401);
  }
  failures.delete(ip);
  return c.json({ token: await ownerToken(c.env) });
});

async function auth(c: Context<Env>, next: Next) {
  const h = c.req.header("authorization") ?? "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!tok || !safeEqual(tok, await ownerToken(c.env))) return c.json({ error: "Unauthorized" }, 401);
  await next();
}

// ------------------------------------------------------------------ sync
const PAGE = 1500;
const UPSERT = `INSERT INTO items (kind, id, data, updated_at, deleted, rev)
  VALUES (?1, ?2, ?3, ?4, ?5, (SELECT CAST(v AS INTEGER) FROM meta WHERE k = 'rev'))
  ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, rev = excluded.rev
  WHERE excluded.updated_at >= items.updated_at`;
const BUMP = `UPDATE meta SET v = CAST(v AS INTEGER) + 1 WHERE k = 'rev'`;

function upserts(db: D1Database, items: SyncItem[]) {
  const stmts: D1PreparedStatement[] = [];
  for (const it of items) {
    if (!KINDS.includes(it.kind) || typeof it.id !== "string" || !it.id) continue;
    stmts.push(db.prepare(BUMP), db.prepare(UPSERT).bind(it.kind, it.id, JSON.stringify(it.data), Math.floor(it.updatedAt), it.deleted ? 1 : 0));
  }
  return stmts;
}

type Row = { kind: Kind; id: string; data: string; updated_at: number; deleted: number; rev: number };
const toItem = (r: Row): SyncItem => ({ kind: r.kind, id: r.id, data: JSON.parse(r.data), updatedAt: r.updated_at, deleted: r.deleted ? 1 : 0 });

api.post("/sync", auth, async (c) => {
  const body = await c.req.json<SyncRequest>();
  const stmts = upserts(c.env.DB, (body.items ?? []).slice(0, 2000));
  for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100));
  const { results } = await c.env.DB.prepare("SELECT * FROM items WHERE rev > ? ORDER BY rev LIMIT ?").bind(Number(body.since) || 0, PAGE).all<Row>();
  const head = Number((await c.env.DB.prepare("SELECT v FROM meta WHERE k = 'rev'").first<{ v: string }>())?.v ?? 0);
  const cursor = results.length ? results[results.length - 1].rev : head;
  const res: SyncResponse & { more: boolean } = { cursor, items: results.map(toItem), more: results.length === PAGE };
  return c.json(res);
});

// ------------------------------------------------------------------ REST: notes & canvases (for scripts / agents)
async function getNote(db: D1Database, id: string) {
  const r = await db.prepare("SELECT * FROM items WHERE kind = 'note' AND id = ? AND deleted = 0").bind(id).first<Row>();
  return r ? (JSON.parse(r.data) as Note) : null;
}
async function putNote(db: D1Database, note: Note) {
  await db.batch(upserts(db, [{ kind: "note", id: note.id, data: note, updatedAt: note.updatedAt, deleted: note.deleted }]));
}

api.get("/notes", auth, async (c) => {
  const q = (c.req.query("q") ?? "").toLowerCase();
  const type = c.req.query("type");
  const { results } = await c.env.DB.prepare("SELECT data FROM items WHERE kind = 'note' AND deleted = 0").all<{ data: string }>();
  const notes = results.map((r) => JSON.parse(r.data) as Note)
    .filter((n) => (!type || n.type === type) && (!q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)))
    .map(({ body, ...meta }) => ({ ...meta, size: body.length }));
  return c.json(notes);
});
api.get("/notes/:id", auth, async (c) => {
  const n = await getNote(c.env.DB, c.req.param("id")!);
  return n ? c.json(n) : c.json({ error: "Not found" }, 404);
});
/** PUT a partial note. Creates it if missing (id from the URL). */
api.put("/notes/:id", auth, async (c) => {
  const patch = await c.req.json<Partial<Note>>();
  const id = c.req.param("id")!;
  const now = Date.now();
  const old = await getNote(c.env.DB, id);
  const note: Note = {
    title: "Untitled", body: "", spaceId: "", folderId: null, tags: [], type: "note", status: null, pinned: 0, favorite: 0,
    published: 0, slug: "", props: {}, createdAt: now, deleted: 0, ...old, ...patch, id, updatedAt: now,
  };
  await putNote(c.env.DB, note);
  return c.json(note);
});

function validCanvas(x: unknown): x is JsonCanvas {
  if (!x || typeof x !== "object") return false;
  const cv = x as JsonCanvas;
  const nodes = cv.nodes ?? [];
  const edges = cv.edges ?? [];
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return false;
  const ids = new Set<string>();
  for (const n of nodes) {
    if (!n || typeof n.id !== "string" || ids.has(n.id) || !["text", "file", "link", "group"].includes(n.type)) return false;
    if (![n.x, n.y, n.width, n.height].every((v) => typeof v === "number")) return false;
    ids.add(n.id);
  }
  return edges.every((e) => e && typeof e.id === "string" && ids.has(e.fromNode) && ids.has(e.toNode));
}
/** JSON Canvas 1.0 in/out. GET returns the raw canvas; PUT replaces it (creates a canvas note if missing). */
api.get("/canvas/:id", auth, async (c) => {
  const n = await getNote(c.env.DB, c.req.param("id")!);
  if (!n || n.type !== "canvas") return c.json({ error: "Not found" }, 404);
  return c.body(n.body || "{}", 200, { "content-type": "application/json" });
});
api.put("/canvas/:id", auth, async (c) => {
  const cv = await c.req.json().catch(() => null);
  if (!validCanvas(cv)) return c.json({ error: "Body is not valid JSON Canvas 1.0 (unique node ids, x/y/width/height numbers, edges reference nodes)." }, 400);
  const id = c.req.param("id")!;
  const now = Date.now();
  const old = await getNote(c.env.DB, id);
  const note: Note = {
    title: c.req.query("title") ?? "Canvas", spaceId: "", folderId: null, tags: [], status: null, pinned: 0, favorite: 0, published: 0, slug: "",
    props: {}, createdAt: now, deleted: 0, ...old, type: "canvas", body: JSON.stringify(cv, null, 2), id, updatedAt: now,
  };
  await putNote(c.env.DB, note);
  return c.json({ ok: true, id, nodes: cv.nodes?.length ?? 0, edges: cv.edges?.length ?? 0 });
});

// Whiteboards: full .excalidraw JSON in/out, or append element skeletons (converted by the app on next open).
api.get("/whiteboard/:id", auth, async (c) => {
  const n = await getNote(c.env.DB, c.req.param("id")!);
  if (!n || n.type !== "whiteboard") return c.json({ error: "Not found" }, 404);
  return c.body(n.body || '{"type":"excalidraw","version":2,"elements":[]}', 200, { "content-type": "application/json" });
});
async function saveBoard(c: Context<Env>, id: string, mutate: (scene: Record<string, unknown> & { elements: unknown[] }) => void) {
  const now = Date.now();
  const old = await getNote(c.env.DB, id);
  let scene: Record<string, unknown> & { elements: unknown[] } = { type: "excalidraw", version: 2, source: "lumen", elements: [] };
  try { if (old?.body) scene = JSON.parse(old.body); } catch { /* start fresh */ }
  mutate(scene);
  const note: Note = {
    title: c.req.query("title") ?? "Whiteboard", spaceId: "inbox", folderId: null, tags: [], status: null, pinned: 0, favorite: 0, published: 0, slug: "",
    props: {}, createdAt: now, deleted: 0, ...old, type: "whiteboard", body: JSON.stringify(scene), id, updatedAt: now,
  };
  await putNote(c.env.DB, note);
  return scene;
}
api.put("/whiteboard/:id", auth, async (c) => {
  const body = await c.req.json<{ elements?: unknown }>().catch(() => null);
  if (!body || !Array.isArray(body.elements)) return c.json({ error: "Body must be .excalidraw JSON with an `elements` array." }, 400);
  await saveBoard(c, c.req.param("id")!, (s) => { Object.assign(s, body, { type: "excalidraw" }); });
  return c.json({ ok: true, elements: body.elements.length });
});
/** Append Excalidraw element skeletons, e.g. {"skeleton":[{"type":"rectangle","x":0,"y":0,"label":{"text":"Hi"}}]} */
api.post("/whiteboard/:id/elements", auth, async (c) => {
  const body = await c.req.json<{ skeleton?: unknown }>().catch(() => null);
  if (!body || !Array.isArray(body.skeleton) || !body.skeleton.every((x) => x && typeof (x as { type?: unknown }).type === "string")) return c.json({ error: "Body must be { skeleton: [{ type, ... }] }" }, 400);
  const s = await saveBoard(c, c.req.param("id")!, (sc) => { sc.lumenPending = [...((sc.lumenPending as unknown[]) ?? []), ...(body.skeleton as unknown[])]; });
  return c.json({ ok: true, pending: (s.lumenPending as unknown[]).length });
});

// ------------------------------------------------------------------ attachments (R2)
const MAX_FILE = 25 * 1024 * 1024;
api.put("/att/:id", auth, async (c) => {
  const id = c.req.param("id")!;
  const mime = c.req.header("content-type") ?? "application/octet-stream";
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > MAX_FILE) return c.json({ error: "File too large (max 25 MB)." }, 413);
  if (c.env.FILES) {
    await c.env.FILES.put(`att/${id}`, buf, { httpMetadata: { contentType: mime, cacheControl: "public, max-age=31536000, immutable" } });
    return c.json({ ok: true, store: "r2" });
  }
  // Fallback: D1 (no R2 binding yet).
  if (buf.byteLength > 1_900_000) return c.json({ error: "Files over 1.9 MB need R2 storage (enable R2 in Cloudflare)." }, 413);
  await c.env.DB.prepare("INSERT OR REPLACE INTO files (id, mime, data, created_at) VALUES (?, ?, ?, ?)").bind(id, mime, buf, Date.now()).run();
  return c.json({ ok: true, store: "d1" });
});
/** Public on purpose: ids are random UUIDs, and published posts embed their images. */
api.get("/att/:id", async (c) => {
  const id = c.req.param("id")!;
  const cache = "public, max-age=31536000, immutable";
  if (c.env.FILES) {
    const obj = await c.env.FILES.get(`att/${id}`);
    if (obj) {
      const h = new Headers();
      obj.writeHttpMetadata(h);
      h.set("etag", obj.httpEtag);
      h.set("cache-control", cache);
      return new Response(obj.body, { headers: h });
    }
  }
  const row = await c.env.DB.prepare("SELECT mime, data FROM files WHERE id = ?").bind(id).first<{ mime: string; data: number[] | ArrayBuffer }>();
  if (!row) return c.json({ error: "Not found" }, 404);
  const bytes = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : new Uint8Array(row.data);
  return new Response(bytes, { headers: { "content-type": row.mime, "cache-control": cache } });
});

// ------------------------------------------------------------------ AI (Workers AI)
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const PROMPTS: Record<string, string> = {
  summarize: "Summarize this study note in 3-6 concise Markdown bullet points. Keep key terms, formulas (LaTeX) and definitions.",
  flashcards: "Create 5-12 flashcards from this study note. Output ONLY lines in the exact form `Question :: Answer`, one per line, no numbering.",
  explain: "Explain the following to a motivated learner, simply and correctly, in short Markdown with one example.",
  tags: "Suggest 3-6 short lowercase tags (single words or kebab-case) for this note. Output ONLY the tags separated by spaces, each starting with #.",
  quiz: "Write 5 short quiz questions (mix of recall and understanding) about this note, then an 'Answers' section. Markdown.",
  roadmap: "Create a learning roadmap for the topic below as Markdown: `## Module` headings, and under each 3-8 topics as `- [ ] Topic` lines. Add `(needs: Other Topic)` only where a real prerequisite exists. No other text.",
};
api.post("/ai", auth, async (c) => {
  if (!c.env.AI) return c.json({ error: "AI isn't enabled on the server." }, 501);
  const { action, text } = await c.req.json<{ action: string; text: string }>();
  const sys = PROMPTS[action];
  if (!sys || !text?.trim()) return c.json({ error: "Bad request" }, 400);
  try {
    const r = (await c.env.AI.run(MODEL as never, {
      messages: [{ role: "system", content: sys }, { role: "user", content: text.slice(0, 24_000) }],
      max_tokens: 1200,
    } as never)) as { response?: string };
    return c.json({ text: (r.response ?? "").trim() });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    return c.json({ error: /limit|quota|429|capacity/i.test(msg) ? "Daily free AI limit reached. Try tomorrow." : "AI request failed." }, 502);
  }
});
api.post("/transcribe", auth, async (c) => {
  if (!c.env.AI) return c.json({ error: "Voice-to-text isn't enabled on the server." }, 501);
  const buf = new Uint8Array(await c.req.arrayBuffer());
  if (buf.byteLength < 800) return c.json({ error: "Recording too short." }, 400);
  if (buf.byteLength > 6_000_000) return c.json({ error: "Recording too long (max ~4 min)." }, 413);
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  try {
    const r = (await c.env.AI.run("@cf/openai/whisper-large-v3-turbo" as never, { audio: btoa(bin), task: "transcribe", vad_filter: true } as never)) as { text?: string };
    return c.json({ text: (r.text ?? "").replace(/\s+/g, " ").trim() });
  } catch {
    return c.json({ error: "Couldn't transcribe. Try again." }, 502);
  }
});

// ------------------------------------------------------------------ public blog
type Post = Pick<Note, "id" | "title" | "slug" | "tags" | "createdAt" | "updatedAt" | "props"> & { excerpt: string; words: number; body?: string };
async function posts(db: D1Database) {
  const { results } = await db
    .prepare("SELECT data FROM items WHERE kind = 'note' AND deleted = 0 AND json_extract(data, '$.published') = 1")
    .all<{ data: string }>();
  return results.map((r) => JSON.parse(r.data) as Note).sort((a, b) => (Number(b.props?.date ? Date.parse(b.props.date) : b.createdAt)) - Number(a.props?.date ? Date.parse(a.props.date) : a.createdAt));
}
const excerpt = (md: string) =>
  md.replace(/^---[\s\S]*?---/, "").replace(/```[\s\S]*?```/g, "").replace(/\$\$[\s\S]*?\$\$/g, "").replace(/[#>*_`\[\]!]|\(.*?\)/g, "").replace(/\s+/g, " ").trim().slice(0, 220);
const toPost = (n: Note, full = false): Post => ({
  id: n.id, title: n.title, slug: n.slug || n.id, tags: n.tags, createdAt: n.createdAt, updatedAt: n.updatedAt, props: n.props ?? {},
  excerpt: n.props?.excerpt || excerpt(n.body), words: n.body.split(/\s+/).filter(Boolean).length, ...(full ? { body: n.body } : {}),
});
async function branding(env: Env["Bindings"]) {
  const r = await env.DB.prepare("SELECT data FROM items WHERE kind = 'space' AND id = 'inbox'").first<{ data: string }>();
  const p = r ? ((JSON.parse(r.data) as { props?: Record<string, string> }).props ?? {}) : {};
  return { name: p.blogName || env.BLOG_NAME || "Lumen", tagline: p.tagline ?? "", author: p.author ?? "", avatar: p.avatar ?? "🕯️" };
}
api.get("/public/posts", async (c) => c.json({ blog: await branding(c.env), posts: (await posts(c.env.DB)).map((n) => toPost(n)) }));
api.get("/public/posts/:slug", async (c) => {
  const slug = c.req.param("slug")!;
  const all = await posts(c.env.DB);
  const i = all.findIndex((n) => (n.slug || n.id) === slug);
  if (i < 0) return c.json({ error: "Not found" }, 404);
  return c.json({ blog: await branding(c.env), post: toPost(all[i], true), prev: all[i + 1] ? toPost(all[i + 1]) : null, next: all[i - 1] ? toPost(all[i - 1]) : null });
});

const xml = (s: string) => s.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]!);
app.get("/rss.xml", async (c) => {
  const origin = new URL(c.req.url).origin;
  const items = (await posts(c.env.DB)).slice(0, 50).map((n) => {
    const p = toPost(n);
    return `<item><title>${xml(p.title)}</title><link>${origin}/blog/${xml(p.slug)}</link><guid>${origin}/blog/${xml(p.slug)}</guid><pubDate>${new Date(n.createdAt).toUTCString()}</pubDate><description>${xml(p.excerpt)}</description></item>`;
  });
  const b = await branding(c.env);
  const title = xml(b.name);
  return c.body(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${title}</title><link>${origin}/blog</link><description>${xml(b.tagline || b.name)}</description>${items.join("")}</channel></rss>`, 200, { "content-type": "application/rss+xml; charset=utf-8" });
});

// ------------------------------------------------------------------ link previews (Open Graph)
const ent = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
api.get("/unfurl", async (c) => {
  let u: URL;
  try { u = new URL(c.req.query("url") ?? ""); } catch { return c.json({ error: "bad url" }, 400); }
  if (!/^https?:$/.test(u.protocol)) return c.json({ error: "bad url" }, 400);
  const cache = caches.default;
  const key = new Request(`https://unfurl.lumen/${encodeURIComponent(u.href)}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  let meta: Record<string, string> = {};
  try {
    const r = await fetch(u.href, { headers: { "user-agent": "Mozilla/5.0 (compatible; LumenLinkPreview/1.0)", accept: "text/html" }, redirect: "follow" });
    if (r.ok && (r.headers.get("content-type") ?? "").includes("html") && r.body) {
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let html = "";
      while (html.length < 250_000) {
        const { done, value } = await reader.read();
        if (done) break;
        html += dec.decode(value, { stream: true });
        if (html.includes("</head>")) break;
      }
      void reader.cancel().catch(() => {});
      const tag = (prop: string) => new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i").exec(html)?.[0];
      const content = (t?: string) => (t ? /content=["']([^"']*)["']/i.exec(t)?.[1] : undefined);
      const title = content(tag("og:title")) ?? content(tag("twitter:title")) ?? /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
      const description = content(tag("og:description")) ?? content(tag("description")) ?? content(tag("twitter:description"));
      let image = content(tag("og:image")) ?? content(tag("twitter:image"));
      if (image) { try { image = new URL(ent(image), u.href).href; } catch { image = undefined; } }
      const all = { title: title && ent(title.trim()).slice(0, 200), description: description && ent(description.trim()).slice(0, 300), image, site: content(tag("og:site_name")) };
      meta = Object.fromEntries(Object.entries(all).filter(([, v]) => v)) as Record<string, string>;
    }
  } catch { /* unreachable site → empty preview */ }
  const res = new Response(JSON.stringify(meta), { headers: { "content-type": "application/json", "cache-control": "public, max-age=86400", "access-control-allow-origin": "*" } });
  c.executionCtx.waitUntil(cache.put(key, res.clone()));
  return res;
});

api.get("/health", (c) => c.json({ ok: true, r2: !!c.env.FILES, ai: !!c.env.AI }));

app.route("/api", api);
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
