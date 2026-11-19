import type { Context, Hono } from "hono";
import type { Env, Helpers } from "../index";

/**
 * Access: the devices that sync with this vault (Lumen 20 · "Settings › Sync › Devices").
 *
 * Lumen has one owner and no accounts: every unlocked device holds the same token (HMAC of the passcode). Devices
 * report themselves after they sync (POST /api/access/seen with a random device id + a name), so the owner sees
 * which devices are unlocked, when they last synced, and which still hold a token from an older passcode
 * ("Token expired"). "Sign out" marks a device: on its next contact it is told to drop its token and lock.
 * "Remove" forgets a row. The passcode itself is never stored, logged or returned: only `gen`, a short HMAC that
 * changes when the passcode is rotated (wrangler secret put APP_PASSCODE), is kept to tell old tokens apart.
 *
 * Table (created on first use):
 *   devices(id TEXT PK, name, platform, first_seen, unlocked_at, last_seen, gen, revoked)
 */
const DDL = `CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL DEFAULT '',
  first_seen INTEGER NOT NULL, unlocked_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  gen TEXT NOT NULL DEFAULT '', revoked INTEGER NOT NULL DEFAULT 0)`;

type Row = { id: string; name: string; platform: string; first_seen: number; unlocked_at: number; last_seen: number; gen: string; revoked: number };
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const clean = (s: unknown, n = 60) => String(s ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n);

export default function register(api: Hono<Env>, h: Helpers) {
  const ready = new WeakSet<D1Database>();
  const table = async (db: D1Database) => { if (!ready.has(db)) { await db.prepare(DDL).run(); ready.add(db); } };
  const gen = async (c: Context<Env>) => (await h.hmac(c.env.APP_PASSCODE, "lumen:token-gen:v1")).slice(0, 12);

  /** Heartbeat after a sync: {id, name, platform} → {revoked}. A revoked device should sign itself out. */
  api.post("/access/seen", h.auth, async (c) => {
    const b = await c.req.json<{ id?: string; name?: string; platform?: string }>().catch(() => ({} as { id?: string; name?: string; platform?: string }));
    const id = String(b.id ?? "");
    if (!ID.test(id)) return c.json({ error: "Bad device id" }, 400);
    const db = c.env.DB;
    await table(db);
    const now = Date.now();
    const g = await gen(c);
    const row = await db.prepare("SELECT * FROM devices WHERE id = ?1").bind(id).first<Row>();
    if (row?.revoked) {
      await db.prepare("DELETE FROM devices WHERE id = ?1").bind(id).run();
      return c.json({ revoked: true });
    }
    const name = clean(b.name) || row?.name || "Device";
    const platform = clean(b.platform, 30);
    if (!row) {
      await db.prepare("INSERT INTO devices (id, name, platform, first_seen, unlocked_at, last_seen, gen, revoked) VALUES (?1, ?2, ?3, ?4, ?4, ?4, ?5, 0)").bind(id, name, platform, now, g).run();
    } else {
      // a new token generation = this device unlocked again with the current passcode
      await db.prepare("UPDATE devices SET name = ?2, platform = ?3, last_seen = ?4, gen = ?5, unlocked_at = CASE WHEN gen = ?5 THEN unlocked_at ELSE ?4 END WHERE id = ?1")
        .bind(id, b.name ? name : row.name, platform || row.platform, now, g).run();
    }
    return c.json({ revoked: false });
  });

  /** Devices, most recently seen first. `expired` = holds a token from an older passcode. */
  api.get("/access/devices", h.auth, async (c) => {
    const db = c.env.DB;
    await table(db);
    const g = await gen(c);
    const { results } = await db.prepare("SELECT * FROM devices ORDER BY last_seen DESC LIMIT 100").all<Row>();
    return c.json({
      devices: results.map((r) => ({ id: r.id, name: r.name, platform: r.platform, firstSeen: r.first_seen, unlockedAt: r.unlocked_at, lastSeen: r.last_seen, expired: r.gen !== g, signingOut: !!r.revoked })),
    });
  });

  /** Rename a device. */
  api.put("/access/devices/:id", h.auth, async (c) => {
    const id = c.req.param("id") ?? "";
    const { name } = await c.req.json<{ name?: string }>().catch(() => ({ name: "" }));
    const n = clean(name);
    if (!ID.test(id) || !n) return c.json({ error: "Bad request" }, 400);
    await table(c.env.DB);
    await c.env.DB.prepare("UPDATE devices SET name = ?2 WHERE id = ?1").bind(id, n).run();
    return c.json({ ok: true });
  });

  /** Sign a device out: it drops its token the next time it contacts the server. */
  api.post("/access/devices/:id/sign-out", h.auth, async (c) => {
    const id = c.req.param("id") ?? "";
    if (!ID.test(id)) return c.json({ error: "Bad request" }, 400);
    await table(c.env.DB);
    await c.env.DB.prepare("UPDATE devices SET revoked = 1 WHERE id = ?1").bind(id).run();
    return c.json({ ok: true });
  });

  /** Forget a device row (e.g. one whose token expired). It reappears if it unlocks and syncs again. */
  api.delete("/access/devices/:id", h.auth, async (c) => {
    const id = c.req.param("id") ?? "";
    if (!ID.test(id)) return c.json({ error: "Bad request" }, 400);
    await table(c.env.DB);
    await c.env.DB.prepare("DELETE FROM devices WHERE id = ?1").bind(id).run();
    return c.json({ ok: true });
  });
}
