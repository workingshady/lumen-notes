import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import type { JsonCanvas, Kind, Note, SyncItem, SyncRequest, SyncResponse } from "../shared/types";
import { KINDS } from "../shared/types";
import extHome from "./ext/home";
import extSpaces from "./ext/spaces";
import extNavigate from "./ext/navigate";
import extStudy from "./ext/study";
import extSettings from "./ext/settings";
import extWorkspace from "./ext/workspace";
import extPractice from "./ext/practice";
import registerAsk from "./ext/ask";
import registerChat from "./ext/chat";
import registerTutor from "./ext/tutor";
import registerHub from "./ext/hub";
import registerAccess from "./ext/access";
import extOg, { ogPages } from "./ext/og"; // OG images + share/blog page meta (round 4 assets)
import { accountRouter } from "./accounts";
import registerAuth, { authGate } from "./ext/auth"; // user accounts, behind ACCOUNTS_ENABLED (off) — docs/ACCOUNTS.md

export type Env = {
  Bindings: {
    DB: D1Database;
    FILES?: R2Bucket;
    AI?: Ai;
    ASSETS: Fetcher;
    /** Owner passphrase (wrangler secret). */
    APP_PASSCODE: string;
    BLOG_NAME?: string;
    /** Second account (worker/accounts.ts): its own D1 + passcode. */
    DB_ROADMAP?: D1Database;
    ROADMAP_PASSCODE?: string;
    /** Set by accountRouter when the request belongs to an extra account. */
    ACCOUNT?: string;
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

// Pick the account (main or an extra one) before any route runs.
api.use("*", authGate()); // no-op unless accounts are on and the request carries a user session (lms_…)
api.use("*", accountRouter({ hmac, safeEqual }));

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
  return c.json({ token: await ownerToken(c.env), account: c.env.ACCOUNT ?? "main" });
});

/** Owner token (from /login) or a named API token (`lmn_…`, Settings › Developer; only its SHA-256 is stored). */
async function auth(c: Context<Env>, next: Next) {
  const h = c.req.header("authorization") ?? "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  let ok = !!tok && safeEqual(tok, await ownerToken(c.env));
  if (!ok && /^lmn_[A-Za-z0-9]{20,64}$/.test(tok)) {
    const hash = hex(await crypto.subtle.digest("SHA-256", enc.encode(tok)));
    const row = await c.env.DB.prepare("SELECT id, last_used_at FROM api_tokens WHERE hash = ?").bind(hash).first<{ id: string; last_used_at: number | null }>().catch(() => null);
    if (row) {
      ok = true;
      const now = Date.now();
      if (!row.last_used_at || now - row.last_used_at > 60_000) {
        const ip = c.req.header("cf-connecting-ip") ?? "";
        const write = c.env.DB.prepare("UPDATE api_tokens SET last_used_at = ?, last_ip = ? WHERE id = ?").bind(now, ip, row.id).run().catch(() => {});
        try { c.executionCtx.waitUntil(write); } catch { await write; }
      }
    }
  }
  if (!ok) return c.json({ error: "Unauthorized" }, 401);
  // AI off-switch (Settings › AI): the owner can turn Workers AI actions off; stored on the Inbox space props.
  if (c.req.path === "/api/ai" || c.req.path === "/api/transcribe") {
    const r = await c.env.DB.prepare("SELECT data FROM items WHERE kind = 'space' AND id = 'inbox'").first<{ data: string }>().catch(() => null);
    const off = String((r ? (JSON.parse(r.data) as { props?: Record<string, string> }).props?.aiOff : "") ?? "").split(",").filter(Boolean);
    const action = c.req.path === "/api/transcribe" ? "voice" : ((await c.req.json<{ action?: string }>().catch(() => ({}))) as { action?: string }).action ?? "";
    if (off.includes("all") || off.includes(action)) return c.json({ error: "This AI action is turned off in Settings › AI." }, 403);
  }
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

// ------------------------------------------------------------------ attachments
// Free tier, no R2 needed: each file is split by the app into 1.5 MB parts stored as D1 rows (`file_parts`),
// served back as one stream with HTTP Range support (video seeking). R2 is used instead if a FILES binding exists.
export const CHUNK = 1_500_000;
const MAX_FILE = 100 * 1024 * 1024;
const IMMUTABLE = "public, max-age=31536000, immutable";

/** PUT /att/:id?part=i&parts=n&size=total  (body = that part's bytes; header content-type = file mime). */
api.put("/att/:id", auth, async (c) => {
  const id = c.req.param("id")!;
  const mime = c.req.header("content-type") ?? "application/octet-stream";
  const part = Number(c.req.query("part") ?? 0);
  const parts = Number(c.req.query("parts") ?? 1);
  const buf = await c.req.arrayBuffer();
  const size = Number(c.req.query("size") ?? buf.byteLength);
  if (!/^[\w-]{8,64}$/.test(id) || !Number.isInteger(part) || !Number.isInteger(parts) || part < 0 || part >= parts) return c.json({ error: "Bad part" }, 400);
  if (size > MAX_FILE) return c.json({ error: "File too large (max 100 MB)." }, 413);
  if (c.env.FILES && parts === 1) {
    await c.env.FILES.put(`att/${id}`, buf, { httpMetadata: { contentType: mime, cacheControl: IMMUTABLE } });
    return c.json({ ok: true, store: "r2" });
  }
  if (buf.byteLength > CHUNK || (part < parts - 1 && buf.byteLength !== CHUNK)) return c.json({ error: `Parts must be exactly ${CHUNK} bytes (last part ≤).` }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR REPLACE INTO file_parts (id, part, data) VALUES (?, ?, ?)").bind(id, part, buf),
    c.env.DB.prepare("INSERT OR REPLACE INTO file_meta (id, mime, size, parts, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, mime, size, parts, Date.now()),
  ]);
  return c.json({ ok: true, store: "d1", part, parts });
});

const toBytes = (d: ArrayBuffer | number[]) => (d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d));

/** Public on purpose: ids are random UUIDs, and published posts embed their images/videos. */
api.get("/att/:id", async (c) => {
  const id = c.req.param("id")!;
  if (c.env.FILES) {
    const obj = await c.env.FILES.get(`att/${id}`);
    if (obj) {
      const h = new Headers();
      obj.writeHttpMetadata(h);
      h.set("etag", obj.httpEtag);
      h.set("cache-control", IMMUTABLE);
      return new Response(obj.body, { headers: h });
    }
  }
  const meta = await c.env.DB.prepare("SELECT mime, size, parts FROM file_meta WHERE id = ?").bind(id).first<{ mime: string; size: number; parts: number }>();
  if (!meta) {
    // Legacy single-row files (before chunking).
    const row = await c.env.DB.prepare("SELECT mime, data FROM files WHERE id = ?").bind(id).first<{ mime: string; data: number[] | ArrayBuffer }>();
    if (!row) return c.json({ error: "Not found" }, 404);
    return new Response(toBytes(row.data), { headers: { "content-type": row.mime, "cache-control": IMMUTABLE } });
  }
  // Range support (video/audio seeking).
  let start = 0, end = meta.size - 1, status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header("range") ?? "");
  if (range) {
    if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
    else if (range[2]) start = Math.max(0, meta.size - Number(range[2]));
    if (start > end || start >= meta.size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${meta.size}` } });
    status = 206;
  }
  const first = Math.floor(start / CHUNK), last = Math.floor(end / CHUNK);
  const db = c.env.DB;
  let i = first;
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (i > last) { ctrl.close(); return; }
      const row = await db.prepare("SELECT data FROM file_parts WHERE id = ? AND part = ?").bind(id, i).first<{ data: ArrayBuffer | number[] }>();
      if (!row) { ctrl.error(new Error("missing part")); return; }
      const bytes = toBytes(row.data);
      const from = i === first ? start - i * CHUNK : 0;
      const to = i === last ? end - i * CHUNK + 1 : bytes.length;
      ctrl.enqueue(bytes.subarray(from, to));
      i++;
    },
  });
  const h: Record<string, string> = { "content-type": meta.mime, "cache-control": IMMUTABLE, "accept-ranges": "bytes", "content-length": String(end - start + 1) };
  if (status === 206) h["content-range"] = `bytes ${start}-${end}/${meta.size}`;
  return new Response(stream, { status, headers: h });
});

// ------------------------------------------------------------------ AI (Workers AI)
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const PROMPTS: Record<string, string> = {
  summarize: "Summarize this study note in 3-6 concise Markdown bullet points. Keep key terms, formulas (LaTeX) and definitions.",
  flashcards: "Create 5-12 flashcards from this study note. Output ONLY lines in the exact form `Question :: Answer`, one per line, no numbering.",
  explain: "Explain the following to a motivated learner, simply and correctly, in short Markdown with one example.",
  tags: "Suggest 3-6 short lowercase tags (single words or kebab-case) for this note. Output ONLY the tags separated by spaces, each starting with #.",
  quiz: "Write 5 short quiz questions (mix of recall and understanding) about this note, then an 'Answers' section. Markdown.",
  project_plan: "You are a pragmatic engineering lead. From the project goal, docs and current cards, write a plan as Markdown: `## Milestone` headings (3-5), each with 3-7 task lines exactly like `- [ ] Task text ~2d !p1 📅 YYYY-MM-DD #epic/short-name`. Use realistic dates after today and before the deadline. Don't repeat cards that already exist. No other text.",
  project_status: "Write a concise weekly status report for stakeholders in Markdown: **Summary** (2 sentences, overall health), **Done this week**, **In progress**, **Blocked / risks**, **Next week**, **Decisions needed**. Base it only on the given cards, docs and dates.",
  project_next: "List the 5 most valuable next actions as Markdown task lines `- [ ] Action ~estimate !p1|!p2 #epic/x` with a one-line reason under each (indented). Prefer unblocking work, overdue items and must-have requirements without tasks.",
  project_risks: "Identify risks and open questions as a Markdown table: Risk | Likelihood (L/M/H) | Impact (L/M/H) | Mitigation | Owner. Then a short list of open questions. Use evidence from overdue cards, requirements without tasks, missing docs, and the deadline.",
  project_decisions: "Summarize the decisions found in the docs (ADRs, RFCs, meeting notes) as a Markdown table: Decision | Date | Why | Status (active/superseded) | Source doc. Then list decisions that seem pending.",
  project_reqs: "Draft requirements from the PRD/docs as Markdown lines exactly `- REQ-N (must|should|could|wont) The system shall …`, numbered after the highest existing REQ id. Group under `## Functional` and `## Non-functional`. No other text.",
  path: "You organize a multi-course learning path. Group the concepts into 3-6 stages from foundations to advanced, respecting prerequisites. Merge concepts that are the same idea under different names by writing `- Main name = Other name | Another`. Output ONLY Markdown: `## Stage N · Short title` headings, then `- Concept` lines. Use the given concept names exactly. No other text.",
  diagram_name: "You name Mermaid diagram files. From the diagram source (and the section heading, if given) write ONE short descriptive file name: 2-5 lowercase words joined by hyphens, specific to what the diagram shows (e.g. order-checkout-sequence, feed-refresh-pipeline). No extension, no quotes, no other text.",
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
  md.replace(/^---[\s\S]*?---/, "").replace(/^\s*#\s.*$/m, "").replace(/^\s*(---|\*\*\*)\s*$/gm, "").replace(/\[![\w-]+\][+-]?/g, "").replace(/^\s*[-*+]\s+\[[ xX/>?-]\]\s+/gm, "").replace(/\s*\p{Extended_Pictographic}\uFE0F?\s*\d{4}-\d{2}-\d{2}/gu, "").replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*:{2,3}.*$/gm, "").replace(/:status\[([^\]]*)\](\{[^}]*\})?/g, "$1").replace(/\s\^[\w-]+$/gm, "").replace(/\s::\s/g, " — ").replace(/```[\s\S]*?```/g, "").replace(/\$\$[\s\S]*?\$\$/g, "").replace(/\$[^$\n]+\$/g, "…").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[#>*_`\[\]!]|\(.*?\)/g, "").replace(/\s+/g, " ").trim().slice(0, 220);
const toPost = (n: Note, full = false): Post => ({
  id: n.id, title: n.title, slug: n.slug || n.id, tags: n.tags, createdAt: n.createdAt, updatedAt: n.updatedAt, props: n.props ?? {},
  excerpt: n.props?.excerpt || excerpt(n.body), words: n.body.split(/\s+/).filter(Boolean).length, ...(full ? { body: n.body } : {}),
});
async function branding(env: Env["Bindings"]) {
  const r = await env.DB.prepare("SELECT data FROM items WHERE kind = 'space' AND id = 'inbox'").first<{ data: string }>();
  const p = r ? ((JSON.parse(r.data) as { props?: Record<string, string> }).props ?? {}) : {};
  return { name: p.blogName || env.BLOG_NAME || "Lumen", tagline: p.tagline ?? "", author: p.author ?? "", avatar: p.avatar ?? "glyph:owl" };
}
api.get("/public/posts", async (c) => c.json({ blog: await branding(c.env), posts: (await posts(c.env.DB)).map((n) => toPost(n)) }, 200, { "cache-control": "public, max-age=60" }));
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

// ------------------------------------------------------------------ unlisted share links
// /api/share/:token → a shared note (any type) or a shared space (course/project page with its notes).
// Anyone with the token can read; nothing is listed anywhere. Revoking = clearing shareId in the app.
type Space = { id: string; name: string; kind: string; icon: string; color: string | null; description: string; props: Record<string, string>; roadmapId: string | null; shareId?: string | null; deleted?: number };
const SAFE_SPACE_PROPS = ["goal", "deadline", "target", "url", "provider"];
const shareHeaders = { "cache-control": "public, max-age=30" };
const publicNote = (n: Note) => ({ id: n.id, title: n.title, body: n.body, type: n.type, tags: n.tags, status: n.status, createdAt: n.createdAt, updatedAt: n.updatedAt });

async function sharedRoot(db: D1Database, token: string) {
  if (!/^[\w-]{16,64}$/.test(token)) return null;
  return db.prepare("SELECT kind, data FROM items WHERE json_extract(data, '$.shareId') = ? AND deleted = 0 AND kind IN ('note', 'space') LIMIT 1").bind(token).first<{ kind: string; data: string }>();
}
async function spaceNotes(db: D1Database, spaceId: string) {
  const { results } = await db.prepare("SELECT data FROM items WHERE kind = 'note' AND deleted = 0 AND json_extract(data, '$.spaceId') = ?").bind(spaceId).all<{ data: string }>();
  return results.map((r) => JSON.parse(r.data) as Note);
}
api.get("/share/:token", async (c) => {
  const row = await sharedRoot(c.env.DB, c.req.param("token")!);
  if (!row) return c.json({ error: "This link doesn't exist or was turned off." }, 404);
  const blog = await branding(c.env);
  if (row.kind === "note") return c.json({ kind: "note", blog, note: publicNote(JSON.parse(row.data) as Note) }, 200, shareHeaders);
  const sp = JSON.parse(row.data) as Space;
  const notes = await spaceNotes(c.env.DB, sp.id);
  const roadmap = sp.roadmapId ? notes.find((n) => n.id === sp.roadmapId) : undefined;
  return c.json({
    kind: "space", blog,
    space: { name: sp.name, kind: sp.kind, icon: sp.icon, color: sp.color, description: sp.description, props: Object.fromEntries(Object.entries(sp.props ?? {}).filter(([k]) => SAFE_SPACE_PROPS.includes(k))) },
    roadmap: roadmap ? publicNote(roadmap) : null,
    // list without bodies, except link targets for the graph (titles) and an excerpt
    notes: notes.filter((n) => n.id !== sp.roadmapId).map((n) => ({ id: n.id, title: n.title, type: n.type, status: n.status, tags: n.tags, updatedAt: n.updatedAt, links: [...n.body.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim()).slice(0, 50), excerpt: excerpt(n.body).slice(0, 160) })),
  }, 200, shareHeaders);
});
/** One note inside a shared space. */
api.get("/share/:token/note/:id", async (c) => {
  const row = await sharedRoot(c.env.DB, c.req.param("token")!);
  if (!row || row.kind !== "space") return c.json({ error: "Not found" }, 404);
  const sp = JSON.parse(row.data) as Space;
  const n = await getNote(c.env.DB, c.req.param("id")!);
  if (!n || n.spaceId !== sp.id) return c.json({ error: "Not found" }, 404);
  return c.json({ note: publicNote(n) }, 200, shareHeaders);
});

api.get("/health", (c) => c.json({ ok: true, r2: !!c.env.FILES, ai: !!c.env.AI }));

// Area extensions (one file per area so parallel work never collides). Each gets the API router + shared helpers.
const helpers = { auth, getNote, putNote, upserts, hmac, safeEqual };
export type Helpers = typeof helpers;
for (const ext of [extHome, extSpaces, extNavigate, extStudy, extSettings, extWorkspace, extPractice]) ext(api, helpers);
registerAsk(api, helpers); // "Ask your vault" (worker/ext/ask.ts)
registerChat(api, helpers); registerTutor(api, helpers); // Ask chat + AI tutor (worker/ext/chat.ts, tutor.ts)
registerHub(api, helpers); // project hub "Ask" (worker/ext/hub.ts)
registerAccess(api, helpers); // devices that sync (worker/ext/access.ts)
registerAuth(api, helpers); // /api/accounts/config + /api/auth/* (worker/ext/auth.ts; 404 while accounts are off)
extOg(api, helpers); ogPages(app); // OG image routes + /s/:token, /blog/:slug meta (worker/ext/og.ts)

app.route("/api", api);
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
export { SlidesRemote } from "./study-remote";
