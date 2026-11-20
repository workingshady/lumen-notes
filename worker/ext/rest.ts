// REST API for scripts and agents (Settings › Developer). Every route needs the owner token or an API token
// (`lmn_…`; read-only tokens are refused on non-GET by `auth`). Writes go through the same `items` table as sync,
// so they show up on every device. Documented in docs/API.md and served as OpenAPI at GET /api/openapi.json.
import type { Hono } from "hono";
import { isWbType, type Folder, type Note, type Space } from "../../shared/types";
import type { Env, Helpers } from "../index";

type Row = { data: string };
const uid = () => crypto.randomUUID();
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/** Front matter + body as one Markdown file (what GET /api/notes/:id?format=md returns). */
function toMarkdown(n: Note) {
  if (/^---\n/.test(n.body)) return n.body;
  const fm = [`type: ${n.type}`, n.status ? `status: ${n.status}` : "", n.tags.length ? `tags: [${n.tags.join(", ")}]` : "",
    ...Object.entries(n.props ?? {}).map(([k, v]) => `${k}: ${v}`)].filter(Boolean);
  return `---\n${fm.join("\n")}\n---\n${n.body}`;
}

export default function register(api: Hono<Env>, h: Helpers) {
  const all = async <T>(c: { env: Env["Bindings"] }, kind: string) =>
    ((await c.env.DB.prepare("SELECT data FROM items WHERE kind = ? AND deleted = 0").bind(kind).all<Row>()).results ?? []).map((r) => JSON.parse(r.data) as T);
  const put = (c: { env: Env["Bindings"] }, kind: "space" | "folder", data: Space | Folder) =>
    c.env.DB.batch(h.upserts(c.env.DB, [{ kind, id: data.id, data, updatedAt: data.updatedAt, deleted: data.deleted }]));

  // ---------- notes: create, delete, append, markdown
  api.post("/notes", h.auth, async (c) => {
    const p = await c.req.json<Partial<Note>>().catch(() => ({} as Partial<Note>));
    const now = Date.now();
    const title = (p.title ?? "").trim() || "Untitled";
    const type = p.type ?? "note";
    // Canvas, whiteboard and board bodies are JSON (JSON Canvas 1.0 / .excalidraw), never a Markdown heading.
    const empty = type === "canvas" ? '{"nodes":[],"edges":[]}' : isWbType(type) ? '{"type":"excalidraw","version":2,"source":"lumen","elements":[]}' : `# ${title}\n`;
    const note: Note = {
      title, body: p.body ?? empty, spaceId: p.spaceId || "inbox", folderId: p.folderId ?? null, tags: p.tags ?? [], type,
      status: p.status ?? null, pinned: p.pinned ?? 0, favorite: p.favorite ?? 0, published: 0, slug: p.slug ?? slugify(title), props: p.props ?? {},
      createdAt: now, deleted: 0, id: p.id || uid(), updatedAt: now,
    };
    if (await h.getNote(c.env.DB, note.id)) return c.json({ error: "A note with this id already exists. Use PUT /api/notes/:id to change it." }, 409);
    await h.putNote(c.env.DB, note);
    return c.json(note, 201);
  });
  api.delete("/notes/:id", h.auth, async (c) => {
    const n = await h.getNote(c.env.DB, c.req.param("id")!);
    if (!n) return c.json({ error: "Not found" }, 404);
    await h.putNote(c.env.DB, { ...n, deleted: 1, updatedAt: h.restNow(n) }); // moves it to Trash on every device (restorable)
    return c.json({ ok: true, id: n.id });
  });
  /** Append Markdown to the end of a note, or under a heading (`{ text, heading? }`). */
  api.post("/notes/:id/append", h.auth, async (c) => {
    const n = await h.getNote(c.env.DB, c.req.param("id")!);
    if (!n) return c.json({ error: "Not found" }, 404);
    const { text, heading } = await c.req.json<{ text?: string; heading?: string }>().catch(() => ({} as { text?: string; heading?: string }));
    if (!text) return c.json({ error: "Missing text" }, 400);
    let body = n.body.replace(/\s*$/, "\n");
    if (heading) {
      const lines = body.split("\n");
      const i = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#{1,6}\s+/, "").trim().toLowerCase() === heading.trim().toLowerCase());
      if (i < 0) body += `\n## ${heading}\n\n${text}\n`;
      else {
        const lvl = lines[i].match(/^#+/)![0].length;
        let j = i + 1;
        while (j < lines.length && !(new RegExp(`^#{1,${lvl}}\\s`).test(lines[j]))) j++;
        while (j > i + 1 && lines[j - 1].trim() === "") j--;
        lines.splice(j, 0, "", text);
        body = lines.join("\n");
      }
    } else body += `\n${text}\n`;
    const note = { ...n, body, updatedAt: h.restNow(n) };
    await h.putNote(c.env.DB, note);
    return c.json(note);
  });
  api.get("/notes/:id/markdown", h.auth, async (c) => {
    const n = await h.getNote(c.env.DB, c.req.param("id")!);
    return n ? c.body(toMarkdown(n), 200, { "content-type": "text/markdown; charset=utf-8" }) : c.json({ error: "Not found" }, 404);
  });

  // ---------- search (title + body, with a snippet)
  api.get("/search", h.auth, async (c) => {
    const q = (c.req.query("q") ?? "").trim().toLowerCase();
    if (!q) return c.json({ error: "Missing q" }, 400);
    const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 100);
    const hits = (await all<Note>(c, "note")).map((n) => {
      const t = n.title.toLowerCase().includes(q) ? 2 : 0;
      const i = n.body.toLowerCase().indexOf(q);
      return { n, score: t + (i >= 0 ? 1 : 0), i };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || b.n.updatedAt - a.n.updatedAt).slice(0, limit);
    return c.json(hits.map(({ n, i }) => ({ id: n.id, title: n.title, type: n.type, spaceId: n.spaceId, updatedAt: n.updatedAt,
      snippet: i >= 0 ? n.body.slice(Math.max(0, i - 60), i + 120).replace(/\s+/g, " ").trim() : "" })));
  });

  // ---------- spaces, folders, tags
  api.get("/spaces", h.auth, async (c) => c.json((await all<Space>(c, "space")).map(({ id, name, kind, icon, color, description, roadmapId, archived }) => ({ id, name, kind, icon, color, description, roadmapId, archived }))));
  api.post("/spaces", h.auth, async (c) => {
    const p = await c.req.json<Partial<Space>>().catch(() => ({} as Partial<Space>));
    if (!p.name) return c.json({ error: "Missing name" }, 400);
    const now = Date.now();
    const s: Space = { id: p.id || uid(), name: p.name, kind: p.kind ?? "area", icon: p.icon ?? "", color: p.color ?? null, description: p.description ?? "", props: p.props ?? {},
      roadmapId: null, sort: now, archived: 0, createdAt: now, updatedAt: now, deleted: 0 };
    await put(c, "space", s);
    return c.json(s, 201);
  });
  api.get("/folders", h.auth, async (c) => {
    const space = c.req.query("space");
    return c.json((await all<Folder>(c, "folder")).filter((f) => !space || f.spaceId === space));
  });
  api.post("/folders", h.auth, async (c) => {
    const p = await c.req.json<Partial<Folder>>().catch(() => ({} as Partial<Folder>));
    if (!p.name || !p.spaceId) return c.json({ error: "Missing name or spaceId" }, 400);
    const now = Date.now();
    const f: Folder = { id: p.id || uid(), spaceId: p.spaceId, name: p.name, parentId: p.parentId ?? null, color: p.color ?? null, sort: now, updatedAt: now, deleted: 0 };
    await put(c, "folder", f);
    return c.json(f, 201);
  });
  api.get("/tags", h.auth, async (c) => {
    const counts = new Map<string, number>();
    for (const n of await all<Note>(c, "note")) for (const t of n.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    return c.json([...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count));
  });

  // ---------- flashcards due (scheduling state; card text lives in its note)
  api.get("/cards/due", h.auth, async (c) => {
    const now = Date.now();
    const due = (await all<{ id: string; noteId: string; due: number; suspended?: number; state?: string }>(c, "card")).filter((x) => !x.suspended && x.due <= now);
    return c.json({ count: due.length, cards: due.slice(0, 500).map(({ id, noteId, due, state }) => ({ id, noteId, due, state })) });
  });

  // ---------- OpenAPI description (for agents and API tools)
  api.get("/openapi.json", (c) => {
    const base = new URL(c.req.url).origin;
    const op = (summary: string, extra: Record<string, unknown> = {}) => ({ summary, security: [{ bearer: [] }], responses: { 200: { description: "OK" } }, ...extra });
    return c.json({
      openapi: "3.1.0", info: { title: "Lumen API", version: "1.0", description: "Read and write notes, canvases, whiteboards, spaces and folders. Use a token from Settings › Developer: Authorization: Bearer <token>." },
      servers: [{ url: `${base}/api` }],
      components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
      paths: {
        "/notes": { get: op("List notes (metadata). Filters: q, type, space, folder, tag, since (ms), limit, offset"), post: op("Create a note { title, body, type, spaceId, folderId, tags, props }") },
        "/notes/{id}": { get: op("Get a note (JSON)"), put: op("Create or update a note (partial JSON)"), delete: op("Move a note to Trash") },
        "/notes/{id}/markdown": { get: op("Get a note as Markdown with front matter") },
        "/notes/{id}/append": { post: op("Append Markdown { text, heading? }") },
        "/search": { get: op("Search titles and text: q, limit") },
        "/spaces": { get: op("List spaces"), post: op("Create a space { name, kind, icon, color, description }") },
        "/folders": { get: op("List folders: space"), post: op("Create a folder { name, spaceId, parentId }") },
        "/tags": { get: op("List tags with counts") },
        "/cards/due": { get: op("Flashcards due now") },
        "/canvas/{id}": { get: op("Get a canvas (JSON Canvas 1.0)"), put: op("Replace a canvas") },
        "/whiteboard/{id}": { get: op("Get a whiteboard or board (Excalidraw scene)"), put: op("Replace a whiteboard or board (keeps the type; ?type=board creates a Board)") },
        "/whiteboard/{id}/elements": { post: op("Append whiteboard elements") },
        "/att/{id}": { get: op("Download an attachment"), put: op("Upload an attachment (raw bytes)") },
        "/sync": { post: op("Sync records { since, items }") },
      },
    });
  });
}
