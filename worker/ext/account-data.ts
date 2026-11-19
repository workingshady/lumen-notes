import type { Hono } from "hono";
import type { Env, Helpers } from "../index";

/**
 * Settings › Account › Danger zone › "Delete account and all data" (Lumen 29 · R6-29L).
 *
 * POST /api/vault/wipe {passcode, confirm: "DELETE"} — owner session only (an API token can't), passcode re-checked.
 * Every synced record becomes a tombstone (`deleted = 1`, body emptied, new rev) so the other devices remove their
 * copies on their next sync instead of pushing them back; attachments are deleted from R2 and the D1 file tables;
 * API tokens and AI usage are cleared. The passcode itself is a Worker secret and stays (it is not data).
 */
export default function register(api: Hono<Env>, h: Helpers) {
  const fails = new Map<string, { n: number; until: number }>();
  api.post("/vault/wipe", h.auth, async (c) => {
    const a = c.req.header("authorization") ?? "";
    const tok = a.startsWith("Bearer ") ? a.slice(7) : "";
    if (!h.safeEqual(tok, await h.hmac(c.env.APP_PASSCODE, "lumen:owner:v1"))) return c.json({ error: "Only a device signed in with the passcode can do this." }, 403);
    const ip = c.req.header("cf-connecting-ip") ?? "?";
    const f = fails.get(ip);
    if (f && f.until > Date.now()) return c.json({ error: "Too many attempts, wait a minute." }, 429);
    const { passcode, confirm } = await c.req.json<{ passcode?: string; confirm?: string }>().catch(() => ({} as { passcode?: string; confirm?: string }));
    if (confirm !== "DELETE") return c.json({ error: "Type DELETE to confirm." }, 400);
    if (!passcode || !h.safeEqual(await h.hmac("cmp", passcode), await h.hmac("cmp", c.env.APP_PASSCODE))) {
      const n = (f?.n ?? 0) + 1;
      fails.set(ip, { n, until: n >= 5 ? Date.now() + 120_000 : 0 });
      return c.json({ error: "Wrong passcode." }, 401);
    }
    const db = c.env.DB;
    const now = Date.now();
    await db.batch([
      db.prepare("UPDATE meta SET v = CAST(v AS INTEGER) + 1 WHERE k = 'rev'"),
      db.prepare("UPDATE items SET deleted = 1, data = json_object('id', id), updated_at = ?1, rev = (SELECT CAST(v AS INTEGER) FROM meta WHERE k = 'rev') WHERE deleted = 0").bind(now),
    ]);
    let files = 0;
    if (c.env.FILES) {
      let cursor: string | undefined;
      do {
        const l = await c.env.FILES.list({ cursor, limit: 500 });
        if (l.objects.length) { await c.env.FILES.delete(l.objects.map((o) => o.key)); files += l.objects.length; }
        cursor = l.truncated ? l.cursor : undefined;
      } while (cursor);
    }
    for (const sql of ["DELETE FROM files", "DELETE FROM file_parts", "DELETE FROM file_meta", "DELETE FROM api_tokens", "DELETE FROM ai_usage"]) await db.prepare(sql).run().catch(() => {});
    return c.json({ ok: true, files });
  });
}
