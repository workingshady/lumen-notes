import type { Hono } from "hono";
import type { Env, Helpers } from "../index";

/** Misses allowed per round before a lockout (design: "Try again · 4 left"). */
const MAX = 5;
const BASE_LOCK = 60; // seconds; doubles per strike
const MAX_LOCK = 24 * 3600;
const FORGET_AFTER = 24 * 3600_000; // a quiet day wipes the history

type Row = { fails: number; strikes: number; locked_until: number; updated_at: number };

/** API routes for the "home" area. Mounted under /api. */
export default function register(api: Hono<Env>, h: Helpers) {
  /**
   * Unlock with the owner passcode. Same token as /api/login, but attempts are tracked in D1 per client
   * (survives isolate restarts), so the UI can show "N attempts left" and a lockout countdown.
   * 200 {token} · 401 {error, attemptsLeft, retryAfterSec:0} · 429 {error, attemptsLeft:0, retryAfterSec}
   */
  api.post("/unlock", async (c) => {
    if (!c.env.APP_PASSCODE) return c.json({ error: "Server passcode not configured." }, 500);
    const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const client = await h.hmac(c.env.APP_PASSCODE, "lumen:unlock-client:v1:" + ip);
    const now = Date.now();
    const db = c.env.DB;
    let row = await db.prepare("SELECT fails, strikes, locked_until, updated_at FROM unlock_attempts WHERE client = ?1").bind(client).first<Row>();
    if (row && now - row.updated_at > FORGET_AFTER && row.locked_until < now) row = null;

    if (row && row.locked_until > now) {
      const retryAfterSec = Math.ceil((row.locked_until - now) / 1000);
      c.header("Retry-After", String(retryAfterSec));
      return c.json({ error: "Too many attempts.", attemptsLeft: 0, retryAfterSec }, 429);
    }

    const { passcode } = await c.req.json<{ passcode?: string }>().catch(() => ({ passcode: "" }));
    const ok = !!passcode && h.safeEqual(await h.hmac("cmp", passcode), await h.hmac("cmp", c.env.APP_PASSCODE));
    if (ok) {
      await db.prepare("DELETE FROM unlock_attempts WHERE client = ?1").bind(client).run();
      return c.json({ token: await h.hmac(c.env.APP_PASSCODE, "lumen:owner:v1"), account: c.env.ACCOUNT ?? "main" });
    }

    let fails = (row?.fails ?? 0) + 1;
    let strikes = row?.strikes ?? 0;
    let lockedUntil = 0;
    if (fails >= MAX) {
      strikes += 1;
      lockedUntil = now + Math.min(MAX_LOCK, BASE_LOCK * 2 ** (strikes - 1)) * 1000;
      fails = 0;
    }
    await db.prepare(
      `INSERT INTO unlock_attempts (client, fails, strikes, locked_until, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(client) DO UPDATE SET fails = excluded.fails, strikes = excluded.strikes, locked_until = excluded.locked_until, updated_at = excluded.updated_at`,
    ).bind(client, fails, strikes, lockedUntil, now).run();

    if (lockedUntil) {
      const retryAfterSec = Math.ceil((lockedUntil - now) / 1000);
      c.header("Retry-After", String(retryAfterSec));
      return c.json({ error: "Too many attempts.", attemptsLeft: 0, retryAfterSec }, 429);
    }
    return c.json({ error: "Wrong passcode.", attemptsLeft: MAX - fails, retryAfterSec: 0 }, 401);
  });
}
