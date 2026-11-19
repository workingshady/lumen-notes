import type { Context, Hono, Next } from "hono";
import type { Env, Helpers } from "../index";

/**
 * API routes for the "settings" area. Mounted under /api.
 * - /tokens: named API tokens for scripts/agents (owner session only; create/regenerate re-check the passcode).
 * - /usage: real Cloudflare D1 usage for Settings › Storage.
 * - /public/blog-meta: blog license + RSS link setting for the public blog (stored on the Inbox space props).
 */
type TokenRow = { id: string; name: string; last4: string; created_at: number; last_used_at: number | null; last_ip: string | null; access?: string | null; expires_at?: number | null };
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const B62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function newSecret() {
  const b = crypto.getRandomValues(new Uint8Array(40));
  let s = "";
  for (const x of b) if (x < 248) s += B62[x % 62]; // 248 = 62*4 → unbiased
  return "lmn_" + s.slice(0, 32).padEnd(32, "x");
}
const maskIp = (ip: string | null) => (ip ? ip.replace(/^(\d+)\.\d+\.\d+\.\d+$/, "$1.x.x.x").replace(/^([0-9a-f]+:[0-9a-f]+):.*$/i, "$1:…") : null);
const toJson = (r: TokenRow) => ({ id: r.id, name: r.name, last4: r.last4, createdAt: r.created_at, lastUsedAt: r.last_used_at, lastIp: maskIp(r.last_ip), access: r.access === "r" ? "r" : "rw", expiresAt: r.expires_at ?? null });
/** Round 6 (Lumen 29 · create token dialog): access (r = GET only, rw) + expiry. Columns added on first use (also migrations/0012). */
const scoped = new WeakSet<D1Database>();
async function ensureScopes(db: D1Database) {
  if (scoped.has(db)) return;
  for (const sql of ["ALTER TABLE api_tokens ADD COLUMN access TEXT NOT NULL DEFAULT 'rw'", "ALTER TABLE api_tokens ADD COLUMN expires_at INTEGER"]) await db.prepare(sql).run().catch(() => {});
  scoped.add(db);
}

export default function register(api: Hono<Env>, h: Helpers) {
  /** Only the signed-in owner (passcode session) manages tokens; an API token can't mint or list others. */
  async function ownerOnly(c: Context<Env>, next: Next) {
    const a = c.req.header("authorization") ?? "";
    const tok = a.startsWith("Bearer ") ? a.slice(7) : "";
    if (!tok || !h.safeEqual(tok, await h.hmac(c.env.APP_PASSCODE, "lumen:owner:v1"))) return c.json({ error: "Sign in with your passcode on this device first." }, 401);
    await next();
  }
  const fails = new Map<string, { n: number; until: number }>();
  async function checkPasscode(c: Context<Env>, passcode: unknown) {
    const ip = c.req.header("cf-connecting-ip") ?? "?";
    const f = fails.get(ip);
    if (f && f.until > Date.now()) return "Too many attempts, wait a minute.";
    if (typeof passcode !== "string" || !passcode || !h.safeEqual(await h.hmac("cmp", passcode), await h.hmac("cmp", c.env.APP_PASSCODE))) {
      const n = (f?.n ?? 0) + 1;
      fails.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 * 2 ** Math.min(n - 5, 8) : 0 });
      return "Wrong passcode.";
    }
    fails.delete(ip);
    return null;
  }

  api.get("/tokens", ownerOnly, async (c) => {
    await ensureScopes(c.env.DB);
    const { results } = await c.env.DB.prepare("SELECT * FROM api_tokens ORDER BY created_at DESC").all<TokenRow>();
    return c.json({ tokens: results.map(toJson) });
  });

  api.post("/tokens", ownerOnly, async (c) => {
    const { name, passcode, access, days } = await c.req.json<{ name?: string; passcode?: string; access?: string; days?: number }>().catch(() => ({} as { name?: string; passcode?: string; access?: string; days?: number }));
    const err = await checkPasscode(c, passcode);
    if (err) return c.json({ error: err }, err.startsWith("Too") ? 429 : 401);
    const n = (name ?? "").trim().slice(0, 60) || "API token";
    const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM api_tokens").first<{ n: number }>();
    if ((count?.n ?? 0) >= 20) return c.json({ error: "You already have 20 tokens. Revoke one first." }, 400);
    const token = newSecret();
    await ensureScopes(c.env.DB);
    const now = Date.now();
    const d = Number(days);
    const row: TokenRow = { id: crypto.randomUUID(), name: n, last4: token.slice(-4), created_at: now, last_used_at: null, last_ip: null, access: access === "r" ? "r" : "rw", expires_at: Number.isFinite(d) && d > 0 ? now + Math.min(d, 3650) * 86_400_000 : null };
    await c.env.DB.prepare("INSERT INTO api_tokens (id, name, hash, last4, created_at, access, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(row.id, row.name, await sha256(token), row.last4, row.created_at, row.access, row.expires_at).run();
    return c.json({ token, ...toJson(row) });
  });

  /** New secret for an existing token; the old one stops working immediately. */
  api.post("/tokens/:id/regenerate", ownerOnly, async (c) => {
    const { passcode } = await c.req.json<{ passcode?: string }>().catch(() => ({} as { passcode?: string }));
    const err = await checkPasscode(c, passcode);
    if (err) return c.json({ error: err }, err.startsWith("Too") ? 429 : 401);
    const id = c.req.param("id")!;
    const old = await c.env.DB.prepare("SELECT * FROM api_tokens WHERE id = ?").bind(id).first<TokenRow>();
    if (!old) return c.json({ error: "Not found" }, 404);
    const token = newSecret();
    const row: TokenRow = { ...old, last4: token.slice(-4), created_at: Date.now(), last_used_at: null, last_ip: null };
    await c.env.DB.prepare("UPDATE api_tokens SET hash = ?, last4 = ?, created_at = ?, last_used_at = NULL, last_ip = NULL WHERE id = ?").bind(await sha256(token), row.last4, row.created_at, id).run();
    return c.json({ token, ...toJson(row) });
  });

  api.delete("/tokens/:id", ownerOnly, async (c) => {
    const r = await c.env.DB.prepare("DELETE FROM api_tokens WHERE id = ?").bind(c.req.param("id")!).run();
    return r.meta.changes ? c.json({ ok: true }) : c.json({ error: "Not found" }, 404);
  });

  /** Real server-side usage: bytes of synced records by kind + attachment bytes in D1 (and R2 if bound). */
  api.get("/usage", h.auth, async (c) => {
    const db = c.env.DB;
    const kinds = await db.prepare("SELECT kind, COUNT(*) AS n, SUM(deleted) AS del, COALESCE(SUM(LENGTH(CAST(data AS BLOB))), 0) AS bytes FROM items GROUP BY kind").all<{ kind: string; n: number; del: number; bytes: number }>();
    const parts = await db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM file_parts").first<{ n: number; bytes: number }>();
    const files = await db.prepare("SELECT COUNT(*) AS n FROM file_meta").first<{ n: number }>();
    const legacy = await db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM files").first<{ n: number; bytes: number }>().catch(() => null);
    const sizeProbe = await db.prepare("SELECT 1").run();
    let r2 = { n: 0, bytes: 0 };
    if (c.env.FILES) {
      let cursor: string | undefined;
      for (let i = 0; i < 20; i++) {
        const l = await c.env.FILES.list({ prefix: "att/", cursor, limit: 1000 });
        for (const o of l.objects) { r2.n++; r2.bytes += o.size; }
        if (!l.truncated) break;
        cursor = l.cursor;
      }
    }
    const byKind = Object.fromEntries(kinds.results.map((k) => [k.kind, { count: k.n - (k.del ?? 0), deleted: k.del ?? 0, bytes: k.bytes }]));
    const recordsBytes = kinds.results.reduce((s, k) => s + k.bytes, 0);
    const notesBytes = byKind.note?.bytes ?? 0;
    const filesBytes = (parts?.bytes ?? 0) + (legacy?.bytes ?? 0);
    return c.json({
      at: Date.now(),
      dbBytes: (sizeProbe.meta as { size_after?: number }).size_after ?? null,
      limitBytes: 5 * 1024 ** 3, // D1 free plan: 5 GB per account
      notes: { count: byKind.note?.count ?? 0, bytes: notesBytes },
      records: { bytes: recordsBytes, byKind },
      files: { count: (files?.n ?? 0) + (legacy?.n ?? 0), parts: parts?.n ?? 0, bytes: filesBytes },
      r2: c.env.FILES ? r2 : null,
    });
  });

  /** Free an attachment's bytes on Cloudflare (Settings › Storage › Delete). The record itself is tombstoned by sync. */
  api.delete("/att/:id", h.auth, async (c) => {
    const id = c.req.param("id")!;
    if (!/^[\w-]{8,64}$/.test(id)) return c.json({ error: "Bad id" }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM file_parts WHERE id = ?").bind(id),
      c.env.DB.prepare("DELETE FROM file_meta WHERE id = ?").bind(id),
      c.env.DB.prepare("DELETE FROM files WHERE id = ?").bind(id),
    ]);
    if (c.env.FILES) await c.env.FILES.delete(`att/${id}`);
    return c.json({ ok: true });
  });

  /**
   * Public: the notes a shared canvas's file cards point at (title, status, excerpt) so visitors see the same cards
   * as the owner. Only files referenced by that shared canvas (or a canvas inside a shared space) are returned.
   */
  api.get("/share/:token/refs", async (c) => {
    const token = c.req.param("token")!;
    if (!/^[\w-]{6,64}$/.test(token)) return c.json({ refs: {} });
    const root = await c.env.DB.prepare("SELECT kind, data FROM items WHERE json_extract(data, '$.shareId') = ? AND deleted = 0 AND kind IN ('note','space') LIMIT 1").bind(token).first<{ kind: string; data: string }>();
    if (!root) return c.json({ error: "Not found" }, 404);
    let body = "";
    if (root.kind === "note") body = (JSON.parse(root.data) as { body?: string }).body ?? "";
    else {
      const id = c.req.query("note") ?? "";
      const n = id ? await h.getNote(c.env.DB, id) : null;
      if (!n || n.spaceId !== (JSON.parse(root.data) as { id: string }).id) return c.json({ refs: {} });
      body = n.body;
    }
    let files: string[] = [];
    try { files = ((JSON.parse(body) as { nodes?: { type: string; file?: string }[] }).nodes ?? []).filter((n) => n.type === "file" && n.file).map((n) => n.file!).slice(0, 100); } catch { /* not a canvas */ }
    const refs: Record<string, { title: string; status: string | null; excerpt: string }> = {};
    for (const f of files) {
      const title = f.split("/").pop()!.replace(/\.md$/, "");
      const r = await c.env.DB.prepare("SELECT data FROM items WHERE kind = 'note' AND deleted = 0 AND json_extract(data, '$.title') = ? LIMIT 1").bind(title).first<{ data: string }>();
      if (!r) continue;
      const n = JSON.parse(r.data) as { title: string; status: string | null; body: string; props?: Record<string, string> };
      refs[f] = { title: n.title, status: n.status, excerpt: refExcerpt(n.body) };
    }
    return c.json({ refs }, 200, { "cache-control": "public, max-age=30" });
  });

  /** Public: extra blog settings the public blog page reads (license line, RSS link). */
  api.get("/public/blog-meta", async (c) => {
    const r = await c.env.DB.prepare("SELECT data FROM items WHERE kind = 'space' AND id = 'inbox'").first<{ data: string }>();
    const p = r ? ((JSON.parse(r.data) as { props?: Record<string, string> }).props ?? {}) : {};
    return c.json({ license: p.license ?? "CC BY 4.0", rss: p.rss !== "0" }, 200, { "cache-control": "public, max-age=60" });
  });
}

/** First prose of a note, plain text, for canvas file cards. */
export function refExcerpt(md: string) {
  const greek: Record<string, string> = { theta: "θ", eta: "η", sigma: "σ", alpha: "α", beta: "β", lambda: "λ", nabla: "∇", mu: "μ" };
  // first prose paragraph (skip front-matter, headings, callouts, math/code blocks, lists)
  const para = md.replace(/\r\n/g, "\n").replace(/^\s*---\n[\s\S]*?\n---[ \t]*(\n|$)/, "").split(/\n\s*\n/).map((p) => p.trim())
    .find((p) => p && !/^(#|>|```|\$\$|[-*+] |\d+\. |!\[|\|)/.test(p)) ?? "";
  return para.replace(/\$([^$\n]+)\$/g, (_, x: string) => x.replace(/\\([a-z]+)/gi, (m: string, g: string) => greek[g] ?? m).replace(/[\\{}]/g, ""))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
}
