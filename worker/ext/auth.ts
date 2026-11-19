import type { Context, Hono, Next } from "hono";
import type { Env, Helpers } from "../index";
import type { SyncItem } from "../../shared/types";
import { KINDS } from "../../shared/types";
import * as core from "./auth-core";
import { composeMail, pickMailer, type MailKind } from "./auth-mail";

/**
 * User accounts (docs/ACCOUNTS.md) — built, NOT enabled. Everything here is behind the ACCOUNTS_ENABLED switch:
 *   - Worker var/secret `ACCOUNTS_ENABLED` ("1"/"true" on, "0"/"false" forces off), else D1 `meta` key `accounts_enabled` = '1'.
 *   - Off (default): GET /api/accounts/config says {enabled:false}; every /api/auth/* route answers 404; the gate below
 *     lets every request through untouched, so the owner's passcode flow behaves exactly as before.
 *
 * Sessions are bearer tokens like the rest of the app (`lms_…`, only their SHA-256 stored), kept in the same
 * `lumen.token` slot on the device. The gate (registered before the account router) scopes a session's /api/sync to
 * the user's own rows in `user_items`; every owner-only route refuses it with 403. The owner's `items` are never
 * read or written for a session.
 */

type AuthEnv = {
  ACCOUNTS_ENABLED?: string; AUTH_SECRET?: string; APP_ORIGIN?: string;
  GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string; MAIL_FROM?: string;
  /** Optional separate D1 for users (defaults to the main DB). */
  USERS_DB?: D1Database;
};
type B = Env["Bindings"] & AuthEnv;
type C = Context<Env>;

const T = {
  notFound: "Not found",
  notAvailable: "This isn't available for accounts yet.",
  signedOut: "You're signed out. Sign in again.",
  badEmail: "Enter a valid email address.",
  terms: "Please accept the terms to create an account.",
  wrongLogin: "Wrong email or password.",
  tooMany: "Too many attempts.",
  needsVerify: "Confirm your email first. We can send the link again.",
  noMail: "Email isn't set up on this server yet.",
  linkInvalid: "This link is invalid or was already used.",
  linkExpired: "This link has expired. Ask for a new one.",
  wrongCurrent: "Your current password is wrong.",
  lastMethod: "Add a password first, so you can still sign in.",
  confirmMismatch: "Type your email exactly to confirm.",
  badProfile: "Some profile fields aren't valid.",
} as const;

// ------------------------------------------------------------------ switch, DB, secrets
const ON = /^(1|true|on|yes)$/i;
let flagCache: { db: D1Database; v: boolean; until: number } | null = null;
export const _resetAuthCaches = () => { flagCache = null; };
export async function accountsEnabled(env: AuthEnv, db: D1Database, now = Date.now()) {
  const e = env.ACCOUNTS_ENABLED;
  if (e != null && String(e).trim() !== "") return ON.test(String(e).trim());
  if (flagCache && flagCache.db === db && flagCache.until > now) return flagCache.v;
  const r = await db.prepare("SELECT v FROM meta WHERE k = 'accounts_enabled'").first<{ v: string }>().catch(() => null);
  const v = ON.test(r?.v ?? "");
  flagCache = { db, v, until: now + 30_000 };
  return v;
}

/** The main DB as it was before the account router could swap it for a passcode account's DB. */
const mainDb = new WeakMap<Request, D1Database>();
const udb = (c: C) => (c.env as B).USERS_DB ?? mainDb.get(c.req.raw) ?? c.env.DB;
const env = (c: C) => c.env as B;

const secretCache = new Map<string, string>();
async function serverSecret(e: B) {
  if (e.AUTH_SECRET) return e.AUTH_SECRET;
  const base = e.APP_PASSCODE || "lumen-dev";
  if (!secretCache.has(base)) secretCache.set(base, await core.hmacHex(base, "lumen:auth-secret:v1"));
  return secretCache.get(base)!;
}
const ipOf = (c: C) => c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
const clientKey = async (c: C, scope: string, v: string) => core.hmacHex(await serverSecret(env(c)), `lumen:auth:${scope}:${v}`);
const origin = (c: C) => (env(c).APP_ORIGIN || new URL(c.req.url).origin).replace(/\/+$/, "");
const clean = (s: unknown, n = 60) => String(s ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, n);
const googleReady = (e: B) => !!(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);

// ------------------------------------------------------------------ rate limiting (same policy as /api/unlock)
const MAX = 5, BASE_LOCK = 60, MAX_LOCK = 24 * 3600, FORGET_AFTER = 24 * 3600_000;
type Attempt = { fails: number; strikes: number; locked_until: number; updated_at: number };
async function attempt(db: D1Database, key: string, now: number) {
  const r = await db.prepare("SELECT fails, strikes, locked_until, updated_at FROM auth_attempts WHERE key = ?1").bind(key).first<Attempt>();
  return r && now - r.updated_at > FORGET_AFTER && r.locked_until < now ? null : r;
}
async function lockedFor(db: D1Database, keys: string[], now: number) {
  let wait = 0;
  for (const k of keys) { const r = await attempt(db, k, now); if (r && r.locked_until > now) wait = Math.max(wait, Math.ceil((r.locked_until - now) / 1000)); }
  return wait;
}
/** Count one miss (or one email sent) against each key; returns tries left and the lockout, if any. */
async function strike(db: D1Database, keys: string[], now: number) {
  let left = MAX, retryAfterSec = 0;
  for (const k of keys) {
    const r = await attempt(db, k, now);
    let fails = (r?.fails ?? 0) + 1, strikes = r?.strikes ?? 0, lockedUntil = 0;
    if (fails >= MAX) { strikes += 1; lockedUntil = now + Math.min(MAX_LOCK, BASE_LOCK * 2 ** (strikes - 1)) * 1000; fails = 0; }
    await db.prepare(`INSERT INTO auth_attempts (key, fails, strikes, locked_until, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(key) DO UPDATE SET fails = excluded.fails, strikes = excluded.strikes, locked_until = excluded.locked_until, updated_at = excluded.updated_at`)
      .bind(k, fails, strikes, lockedUntil, now).run();
    left = Math.min(left, lockedUntil ? 0 : MAX - fails);
    if (lockedUntil) retryAfterSec = Math.max(retryAfterSec, Math.ceil((lockedUntil - now) / 1000));
  }
  return { left, retryAfterSec };
}
const unstrike = (db: D1Database, keys: string[]) => db.batch(keys.map((k) => db.prepare("DELETE FROM auth_attempts WHERE key = ?1").bind(k)));
function tooMany(c: C, retryAfterSec: number) {
  c.header("Retry-After", String(retryAfterSec));
  return c.json({ error: T.tooMany, attemptsLeft: 0, retryAfterSec }, 429);
}

// ------------------------------------------------------------------ users, sessions, tokens
type UserRow = { id: string; email: string; email_verified: number; name: string; avatar: string; lang: string; tz: string; password_hash: string | null; password_changed_at: number | null; created_at: number; updated_at: number };
type SessionRow = { id: string; user_id: string; device: string; platform: string; method: string; created_at: number; last_seen: number; expires_at: number };
type IdentityRow = { provider: string; subject: string; user_id: string; email: string; created_at: number };

const userById = (db: D1Database, id: string) => db.prepare("SELECT * FROM users WHERE id = ?1").bind(id).first<UserRow>();
const userByEmail = (db: D1Database, email: string) => db.prepare("SELECT * FROM users WHERE email = ?1").bind(email).first<UserRow>();
async function publicUser(db: D1Database, u: UserRow) {
  const { results } = await db.prepare("SELECT provider, email, created_at FROM identities WHERE user_id = ?1").bind(u.id).all<IdentityRow>();
  return {
    id: u.id, email: u.email, emailVerified: !!u.email_verified, name: u.name, avatar: u.avatar, lang: u.lang, tz: u.tz, createdAt: u.created_at,
    hasPassword: !!u.password_hash, passwordChangedAt: u.password_changed_at,
    identities: results.map((r) => ({ provider: r.provider, email: r.email, linkedAt: r.created_at })),
  };
}
async function audit(c: C, userId: string | null, event: string, detail = "") {
  try {
    await udb(c).prepare("INSERT INTO audit (user_id, event, client, at, detail) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(userId, event, (await clientKey(c, "ip", ipOf(c))).slice(0, 16), Date.now(), detail.slice(0, 200)).run();
  } catch { /* the audit log never blocks a sign-in */ }
}

async function createSession(c: C, userId: string, method: string, body: { device?: unknown; platform?: unknown }) {
  const token = core.newSessionToken();
  const now = Date.now();
  await udb(c).prepare("INSERT INTO sessions (id, user_id, device, platform, method, created_at, last_seen, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7)")
    .bind(await core.sha256hex(token), userId, clean(body.device) || "Browser", clean(body.platform, 20), method, now, now + core.SESSION_TTL).run();
  return token;
}
const bearer = (c: C) => { const h = c.req.header("authorization") ?? ""; return h.startsWith("Bearer ") ? h.slice(7) : ""; };
/** The signed-in session for this request (sliding expiry, last_seen updated at most every 5 minutes). */
async function session(c: C): Promise<{ s: SessionRow; u: UserRow } | null> {
  const tok = bearer(c);
  if (!core.isSessionToken(tok)) return null;
  const db = udb(c);
  const now = Date.now();
  const s = await db.prepare("SELECT * FROM sessions WHERE id = ?1").bind(await core.sha256hex(tok)).first<SessionRow>();
  if (!s || s.expires_at <= now) return null;
  const u = await userById(db, s.user_id);
  if (!u) return null;
  if (now - s.last_seen > 5 * 60_000) {
    const w = db.prepare("UPDATE sessions SET last_seen = ?1, expires_at = ?2 WHERE id = ?3").bind(now, core.slideExpiry(s.created_at, now), s.id).run().catch(() => {});
    try { c.executionCtx.waitUntil(w); } catch { await w; }
  }
  return { s, u };
}

async function issueToken(c: C, kind: core.TokenKind, u: UserRow) {
  const raw = core.randomToken(32);
  const now = Date.now();
  await udb(c).prepare("INSERT INTO email_tokens (id, kind, user_id, email, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(await core.sha256hex(raw), kind, u.id, u.email, now, now + core.TOKEN_TTL[kind]).run();
  return raw;
}
/** Use a one-time token: checks kind/expiry/used, marks it used, returns the user. */
async function consumeToken(c: C, kind: core.TokenKind, raw: unknown): Promise<{ u: UserRow } | { err: string }> {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return { err: T.linkInvalid };
  const db = udb(c);
  const id = await core.sha256hex(raw);
  const now = Date.now();
  const row = await db.prepare("SELECT kind, user_id, email, expires_at, used_at FROM email_tokens WHERE id = ?1").bind(id).first<core.TokenRow & { user_id: string; email: string }>();
  const p = core.tokenProblem(row, kind, now);
  if (p) return { err: p === "expired" ? T.linkExpired : T.linkInvalid };
  // Single use even under a race: only the request that flips used_at wins.
  const upd = await db.prepare("UPDATE email_tokens SET used_at = ?1 WHERE id = ?2 AND used_at IS NULL").bind(now, id).run();
  if (!upd.meta.changes) return { err: T.linkInvalid };
  const u = await userById(db, row!.user_id);
  if (!u || u.email !== row!.email) return { err: T.linkInvalid }; // email changed since the link was sent
  return { u };
}
async function sendMail(c: C, kind: MailKind, u: UserRow) {
  const mailer = pickMailer(env(c), c.req.url);
  if (!mailer) return "unavailable" as const;
  const raw = await issueToken(c, kind, u);
  await mailer.send(composeMail(kind, u.email, `${origin(c)}/?auth=${kind}&token=${raw}`));
  return "sent" as const;
}
const signedIn = async (c: C, u: UserRow, method: string, body: { device?: unknown; platform?: unknown }) => {
  const token = await createSession(c, u.id, method, body);
  await audit(c, u.id, "signin", method);
  return c.json({ token, user: await publicUser(udb(c), u) });
};
const newUserId = () => "u" + core.randomToken(12).replace(/[-_]/g, "x");

// ------------------------------------------------------------------ per-user sync (user_items)
const UPSERT = `INSERT INTO user_items (uid, kind, id, data, updated_at, deleted, rev)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT CAST(v AS INTEGER) FROM meta WHERE k = 'urev'))
  ON CONFLICT(uid, kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, rev = excluded.rev
  WHERE excluded.updated_at >= user_items.updated_at`;
const BUMP = `UPDATE meta SET v = CAST(v AS INTEGER) + 1 WHERE k = 'urev'`;
const PAGE = 1500, MAX_ITEM = 2_000_000;
type URow = { kind: string; id: string; data: string; updated_at: number; deleted: number; rev: number };
async function userSync(c: C, uid: string) {
  const db = udb(c);
  const body = await c.req.json<{ since?: number; items?: SyncItem[] }>().catch(() => ({} as { since?: number; items?: SyncItem[] }));
  const stmts: D1PreparedStatement[] = [];
  for (const it of (body.items ?? []).slice(0, 2000)) {
    if (!KINDS.includes(it.kind) || typeof it.id !== "string" || !it.id || it.id.length > 128) continue;
    const data = JSON.stringify(it.data);
    if (data.length > MAX_ITEM) continue;
    stmts.push(db.prepare(BUMP), db.prepare(UPSERT).bind(uid, it.kind, it.id, data, Math.floor(it.updatedAt), it.deleted ? 1 : 0));
  }
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  const { results } = await db.prepare("SELECT kind, id, data, updated_at, deleted, rev FROM user_items WHERE uid = ?1 AND rev > ?2 ORDER BY rev LIMIT ?3").bind(uid, Number(body.since) || 0, PAGE).all<URow>();
  const head = Number((await db.prepare("SELECT v FROM meta WHERE k = 'urev'").first<{ v: string }>())?.v ?? 0);
  return c.json({
    cursor: results.length ? results[results.length - 1].rev : head,
    items: results.map((r) => ({ kind: r.kind, id: r.id, data: JSON.parse(r.data), updatedAt: r.updated_at, deleted: r.deleted ? 1 : 0 })),
    more: results.length === PAGE,
  });
}

// ------------------------------------------------------------------ gate (runs before the passcode account router)
const PUBLIC_GET = /^\/api\/(health$|public\/|share\/|att\/|unfurl$|og\/)/;
/**
 * Off: does nothing but remember the main DB. On: requests carrying a user session (`Bearer lms_…`) are kept inside
 * that user's scope — /api/sync → user_items, /api/access/seen → session heartbeat, public reads pass, the rest 403.
 */
export function authGate() {
  return async function gate(c: C, next: Next) {
    mainDb.set(c.req.raw, c.env.DB);
    const tok = bearer(c);
    if (!tok.startsWith(core.SESSION_PREFIX)) return next();
    const path = c.req.path;
    if (path.startsWith("/api/auth/") || path === "/api/accounts/config") return next();
    if (!(await accountsEnabled(env(c), udb(c)))) return next(); // off: unchanged behaviour (owner auth rejects it)
    const me = await session(c);
    if (!me) return c.json({ error: T.signedOut }, 401);
    if (c.req.method === "POST" && path === "/api/sync") return userSync(c, me.u.id);
    if (c.req.method === "POST" && path === "/api/access/seen") {
      const b = await c.req.json<{ name?: string; platform?: string }>().catch(() => ({} as { name?: string; platform?: string }));
      await udb(c).prepare("UPDATE sessions SET device = ?1, platform = ?2, last_seen = ?3 WHERE id = ?4").bind(clean(b.name) || me.s.device, clean(b.platform, 20) || me.s.platform, Date.now(), me.s.id).run();
      return c.json({ revoked: false });
    }
    if (c.req.method === "GET" && PUBLIC_GET.test(path)) return next();
    return c.json({ error: T.notAvailable }, 403);
  };
}

// ------------------------------------------------------------------ Google (OAuth 2.0 code + PKCE + state + nonce)
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const OAUTH_COOKIE = "__Host-lumen_oauth";
const jwks = core.jwksCache();
const cookie = (c: C, name: string) => {
  for (const part of (c.req.header("cookie") ?? "").split(/;\s*/)) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1); }
  return null;
};
function back(c: C, returnTo: string, params: Record<string, string>) {
  const u = new URL(core.safeReturn(returnTo), origin(c) + "/");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  c.header("Set-Cookie", `${OAUTH_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  c.header("Cache-Control", "no-store");
  return c.redirect(u.toString(), 302);
}

// ------------------------------------------------------------------ routes
export default function register(api: Hono<Env>, _h: Helpers) {
  api.get("/accounts/config", async (c) => {
    const on = await accountsEnabled(env(c), udb(c));
    const providers = on ? { google: googleReady(env(c)), email: true, magic: !!pickMailer(env(c), c.req.url) } : { google: false, email: false, magic: false };
    return c.json({ enabled: on, providers }, 200, { "cache-control": "no-store" });
  });

  // Switch off → every auth route is simply not there.
  api.use("/auth/*", async (c, next) => {
    if (!(await accountsEnabled(env(c), udb(c)))) return c.json({ error: T.notFound }, 404);
    return next();
  });

  type Body = Record<string, unknown>;
  const body = (c: C) => c.req.json<Body>().catch(() => ({} as Body));

  api.post("/auth/register", async (c) => {
    const b = await body(c);
    const db = udb(c), now = Date.now();
    const email = core.normEmail(b.email);
    if (!core.validEmail(email)) return c.json({ error: T.badEmail }, 400);
    const pwErr = core.passwordProblem(b.password);
    if (pwErr) return c.json({ error: pwErr }, 400);
    if (b.terms !== true) return c.json({ error: T.terms }, 400);
    const ipKey = await clientKey(c, "send-ip", ipOf(c));
    const wait = await lockedFor(db, [ipKey], now);
    if (wait) return tooMany(c, wait);
    await strike(db, [ipKey], now); // registrations + emails per network are limited
    const existing = await userByEmail(db, email);
    let mail: "sent" | "unavailable" = "unavailable";
    if (existing) {
      // Same answer whether or not the email is known (no account enumeration). Unverified → resend the link.
      if (!existing.email_verified) mail = await sendMail(c, "verify", existing);
      else mail = pickMailer(env(c), c.req.url) ? "sent" : "unavailable";
    } else {
      const id = newUserId();
      const lang = /^[a-z]{2}(-[A-Z]{2})?$/.test(String(b.lang ?? "")) ? String(b.lang) : "en";
      await db.prepare(`INSERT INTO users (id, email, email_verified, name, avatar, lang, tz, password_hash, password_changed_at, created_at, updated_at)
        VALUES (?1, ?2, 0, ?3, 'glyph:owl', ?4, ?5, ?6, ?7, ?7, ?7)`)
        .bind(id, email, clean(b.name, 80), lang, validTz(b.tz) ? String(b.tz) : "UTC", await core.hashPassword(String(b.password)), now).run();
      await audit(c, id, "register");
      mail = await sendMail(c, "verify", (await userById(db, id))!);
    }
    return c.json({ ok: true, mail });
  });

  api.post("/auth/login", async (c) => {
    const b = await body(c);
    const db = udb(c), now = Date.now();
    const email = core.normEmail(b.email);
    const keys = [await clientKey(c, "login-ip", ipOf(c)), await clientKey(c, "login-email", email)];
    const wait = await lockedFor(db, keys, now);
    if (wait) return tooMany(c, wait);
    const u = core.validEmail(email) ? await userByEmail(db, email) : null;
    const v = await core.verifyPassword(String(b.password ?? ""), u?.password_hash); // runs PBKDF2 even for unknown emails
    if (!u || !v.ok) {
      const r = await strike(db, keys, now);
      if (r.retryAfterSec) return tooMany(c, r.retryAfterSec);
      await audit(c, u?.id ?? null, "signin-failed", "password");
      return c.json({ error: T.wrongLogin, attemptsLeft: r.left, retryAfterSec: 0 }, 401);
    }
    await unstrike(db, keys);
    if (!u.email_verified) return c.json({ error: T.needsVerify, needsVerification: true }, 403);
    if (v.rehash) await db.prepare("UPDATE users SET password_hash = ?1 WHERE id = ?2").bind(await core.hashPassword(String(b.password)), u.id).run();
    return signedIn(c, u, "password", b);
  });

  /** Ask for an email (verify again / magic link / reset). Always the same answer for known and unknown emails. */
  const mailRoute = (kind: MailKind) => async (c: C) => {
    const b = await body(c);
    const db = udb(c), now = Date.now();
    const email = core.normEmail(b.email);
    if (!core.validEmail(email)) return c.json({ error: T.badEmail }, 400);
    if (!pickMailer(env(c), c.req.url)) return c.json({ error: T.noMail, mail: "unavailable" }, 503);
    const keys = [await clientKey(c, "send-ip", ipOf(c)), await clientKey(c, "send-email", email)];
    const wait = await lockedFor(db, keys, now);
    if (wait) return tooMany(c, wait);
    await strike(db, keys, now);
    const u = await userByEmail(db, email);
    if (u && (kind !== "verify" || !u.email_verified)) await sendMail(c, kind, u);
    return c.json({ ok: true, mail: "sent" });
  };
  api.post("/auth/verify/resend", mailRoute("verify"));
  api.post("/auth/magic", mailRoute("magic"));
  api.post("/auth/forgot", mailRoute("reset"));

  /** Email links land on /?auth=<kind>&token=…; the app posts the token here. Verify + magic sign the user in. */
  for (const kind of ["verify", "magic"] as const) {
    api.post(`/auth/${kind}/confirm`, async (c) => {
      const b = await body(c);
      const r = await consumeToken(c, kind, b.token);
      if ("err" in r) return c.json({ error: r.err }, 400);
      await udb(c).prepare("UPDATE users SET email_verified = 1, updated_at = ?1 WHERE id = ?2").bind(Date.now(), r.u.id).run();
      if (kind === "verify") await audit(c, r.u.id, "email-verified");
      return signedIn(c, { ...r.u, email_verified: 1 }, kind === "magic" ? "magic" : "email", b);
    });
  }
  api.post("/auth/reset", async (c) => {
    const b = await body(c);
    const pwErr = core.passwordProblem(b.password);
    if (pwErr) return c.json({ error: pwErr }, 400);
    const r = await consumeToken(c, "reset", b.token);
    if ("err" in r) return c.json({ error: r.err }, 400);
    const db = udb(c), now = Date.now();
    // New password signs every device out (a reset usually means the old one leaked); the email is proven.
    await db.batch([
      db.prepare("UPDATE users SET password_hash = ?1, password_changed_at = ?2, email_verified = 1, updated_at = ?2 WHERE id = ?3").bind(await core.hashPassword(String(b.password)), now, r.u.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(r.u.id),
    ]);
    await audit(c, r.u.id, "password-reset");
    return signedIn(c, { ...r.u, email_verified: 1, password_hash: "set" }, "password", b);
  });

  // ---- Google
  /** POST {return?, link?} (+ session bearer when linking) → {url}. Sets the HttpOnly state cookie on this browser. */
  api.post("/auth/google/start", async (c) => {
    const e = env(c);
    if (!googleReady(e)) return c.json({ error: "Google sign-in isn't set up on this server." }, 503);
    const b = await body(c);
    let link: string | null = null;
    if (b.link === true) { const me = await session(c); if (!me) return c.json({ error: T.signedOut }, 401); link = me.u.id; }
    const state = core.randomToken(32), verifier = core.pkceVerifier(), nonce = core.randomToken(16), now = Date.now();
    const db = udb(c);
    await db.batch([
      db.prepare("DELETE FROM oauth_states WHERE expires_at < ?1").bind(now),
      db.prepare("INSERT INTO oauth_states (id, verifier, nonce, return_to, link_user, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
        .bind(await core.sha256hex(state), verifier, nonce, core.safeReturn(b.return), link, now, now + 10 * 60_000),
    ]);
    const u = new URL(GOOGLE_AUTH);
    u.search = new URLSearchParams({
      client_id: e.GOOGLE_CLIENT_ID!, redirect_uri: `${origin(c)}/api/auth/google/callback`, response_type: "code", scope: "openid email profile",
      state, nonce, code_challenge: await core.pkceChallenge(verifier), code_challenge_method: "S256", prompt: "select_account",
    }).toString();
    c.header("Set-Cookie", `${OAUTH_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    return c.json({ url: u.toString() });
  });

  api.get("/auth/google/callback", async (c) => {
    const e = env(c), db = udb(c), now = Date.now();
    const state = c.req.query("state") ?? "";
    const row = state ? await db.prepare("SELECT * FROM oauth_states WHERE id = ?1").bind(await core.sha256hex(state)).first<{ id: string; verifier: string; nonce: string; return_to: string; link_user: string | null; expires_at: number }>() : null;
    if (row) await db.prepare("DELETE FROM oauth_states WHERE id = ?1").bind(row.id).run(); // single use
    const returnTo = row?.return_to ?? "/";
    const fail = (reason: string) => back(c, returnTo, { auth: "google-error", reason });
    if (c.req.query("error")) return fail(c.req.query("error") === "access_denied" ? "cancelled" : "provider");
    const sp = core.stateProblem(state, cookie(c, OAUTH_COOKIE), row, now);
    if (sp) return fail("state-" + sp);
    if (!googleReady(e) || !core.validVerifier(row!.verifier)) return fail("not-configured");
    const code = c.req.query("code");
    if (!code) return fail("provider");

    let claims: core.IdClaims;
    try {
      const tr = await fetch(GOOGLE_TOKEN, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code, client_id: e.GOOGLE_CLIENT_ID!, client_secret: e.GOOGLE_CLIENT_SECRET!, redirect_uri: `${origin(c)}/api/auth/google/callback`, grant_type: "authorization_code", code_verifier: row!.verifier }),
      });
      if (!tr.ok) return fail("exchange");
      const tj = (await tr.json()) as { id_token?: string };
      if (!tj.id_token) return fail("exchange");
      claims = await core.verifyIdToken(tj.id_token, { clientId: e.GOOGLE_CLIENT_ID!, nonce: row!.nonce, now, key: (kid) => jwks(kid, now) });
    } catch { return fail("token"); }

    const email = core.normEmail(claims.email);
    const verified = core.emailVerifiedClaim(claims);
    const ident = await db.prepare("SELECT * FROM identities WHERE provider = 'google' AND subject = ?1").bind(claims.sub).first<IdentityRow>();

    if (row!.link_user) { // "Connect Google" from the profile page
      if (ident && ident.user_id !== row!.link_user) return fail("already-linked");
      if (!ident) await db.prepare("INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES ('google', ?1, ?2, ?3, ?4)").bind(claims.sub, row!.link_user, email, now).run();
      await audit(c, row!.link_user, "google-linked");
      return back(c, returnTo, { auth: "google-linked" });
    }

    let u = ident ? await userById(db, ident.user_id) : null;
    if (!u) {
      if (!email || !verified) return fail("email-unverified");
      u = await userByEmail(db, email);
      if (u && !u.email_verified) {
        // Pre-registration hijack defence: someone may have registered this address with a password they know but
        // never verified. Google proves the mailbox, so that unproven password and its sessions are dropped.
        await db.batch([
          db.prepare("UPDATE users SET password_hash = NULL, email_verified = 1, updated_at = ?1 WHERE id = ?2").bind(now, u.id),
          db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(u.id),
        ]);
        u = { ...u, password_hash: null, email_verified: 1 };
      }
      if (!u) {
        const id = newUserId();
        await db.prepare(`INSERT INTO users (id, email, email_verified, name, avatar, lang, tz, created_at, updated_at) VALUES (?1, ?2, 1, ?3, 'glyph:owl', 'en', 'UTC', ?4, ?4)`)
          .bind(id, email, clean(claims.name, 80), now).run();
        await audit(c, id, "register", "google");
        u = (await userById(db, id))!;
      }
      await db.prepare("INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES ('google', ?1, ?2, ?3, ?4)").bind(claims.sub, u.id, email, now).run();
    }
    // Hand the session over through a 2-minute, single-use code (the session token never appears in a URL).
    const handoff = await issueToken(c, "handoff", u);
    return back(c, returnTo, { auth: "google", code: handoff });
  });
  api.post("/auth/exchange", async (c) => {
    const b = await body(c);
    const r = await consumeToken(c, "handoff", b.code);
    if ("err" in r) return c.json({ error: r.err }, 400);
    return signedIn(c, r.u, "google", b);
  });

  // ---- signed-in routes
  const me = async (c: C) => session(c);
  api.get("/auth/me", async (c) => {
    const m = await me(c);
    return m ? c.json({ user: await publicUser(udb(c), m.u) }) : c.json({ error: T.signedOut }, 401);
  });
  api.put("/auth/me", async (c) => {
    const m = await me(c);
    if (!m) return c.json({ error: T.signedOut }, 401);
    const b = await body(c);
    const next = { name: m.u.name, avatar: m.u.avatar, lang: m.u.lang, tz: m.u.tz };
    if (b.name !== undefined) next.name = clean(b.name, 80);
    if (b.avatar !== undefined) {
      const a = String(b.avatar);
      if (!/^glyph:[a-z0-9-]{1,30}$/.test(a) && !(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(a) && a.length <= 300_000)) return c.json({ error: T.badProfile }, 400);
      next.avatar = a;
    }
    if (b.lang !== undefined) { if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(String(b.lang))) return c.json({ error: T.badProfile }, 400); next.lang = String(b.lang); }
    if (b.tz !== undefined) { if (!validTz(b.tz)) return c.json({ error: T.badProfile }, 400); next.tz = String(b.tz); }
    await udb(c).prepare("UPDATE users SET name = ?1, avatar = ?2, lang = ?3, tz = ?4, updated_at = ?5 WHERE id = ?6").bind(next.name, next.avatar, next.lang, next.tz, Date.now(), m.u.id).run();
    return c.json({ user: await publicUser(udb(c), { ...m.u, ...next }) });
  });
  api.post("/auth/password", async (c) => {
    const m = await me(c);
    if (!m) return c.json({ error: T.signedOut }, 401);
    const b = await body(c);
    const db = udb(c), now = Date.now();
    const pwErr = core.passwordProblem(b.next);
    if (pwErr) return c.json({ error: pwErr }, 400);
    if (m.u.password_hash) {
      const keys = [await clientKey(c, "pw-user", m.u.id)];
      const wait = await lockedFor(db, keys, now);
      if (wait) return tooMany(c, wait);
      if (!(await core.verifyPassword(String(b.current ?? ""), m.u.password_hash)).ok) {
        const r = await strike(db, keys, now);
        return r.retryAfterSec ? tooMany(c, r.retryAfterSec) : c.json({ error: T.wrongCurrent, attemptsLeft: r.left }, 401);
      }
      await unstrike(db, keys);
    }
    await db.batch([
      db.prepare("UPDATE users SET password_hash = ?1, password_changed_at = ?2, updated_at = ?2 WHERE id = ?3").bind(await core.hashPassword(String(b.next)), now, m.u.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?1 AND id != ?2").bind(m.u.id, m.s.id), // other devices sign out
    ]);
    await audit(c, m.u.id, m.u.password_hash ? "password-changed" : "password-added");
    return c.json({ ok: true });
  });
  api.delete("/auth/identities/:provider", async (c) => {
    const m = await me(c);
    if (!m) return c.json({ error: T.signedOut }, 401);
    if (!m.u.password_hash) return c.json({ error: T.lastMethod }, 400);
    await udb(c).prepare("DELETE FROM identities WHERE user_id = ?1 AND provider = ?2").bind(m.u.id, c.req.param("provider")).run();
    await audit(c, m.u.id, "unlinked", c.req.param("provider"));
    return c.json({ user: await publicUser(udb(c), m.u) });
  });

  api.get("/auth/sessions", async (c) => {
    const m = await me(c);
    if (!m) return c.json({ error: T.signedOut }, 401);
    const { results } = await udb(c).prepare("SELECT * FROM sessions WHERE user_id = ?1 AND expires_at > ?2 ORDER BY last_seen DESC").bind(m.u.id, Date.now()).all<SessionRow>();
    return c.json({ sessions: results.map((s) => ({ id: s.id.slice(0, 16), device: s.device, platform: s.platform, method: s.method, createdAt: s.created_at, lastSeen: s.last_seen, current: s.id === m.s.id })) });
  });
  api.delete("/auth/sessions/:id", async (c) => {
    const m = await me(c);
    if (!m) return c.json({ error: T.signedOut }, 401);
    const id = c.req.param("id") ?? "";
    if (!/^[0-9a-f]{16}$/.test(id)) return c.json({ error: T.notFound }, 404);
    await udb(c).prepare("DELETE FROM sessions WHERE user_id = ?1 AND substr(id, 1, 16) = ?2").bind(m.u.id, id).run();
    return c.json({ ok: true });
  });
  api.post("/auth/signout", async (c) => {
    const m = await me(c);
    if (m) await udb(c).prepare("DELETE FROM sessions WHERE id = ?1").bind(m.s.id).run();
    return c.json({ ok: true });
  });
  api.post("/auth/signout-all", async (c) => {
    const m = await me(c);
    if (!m) return c.json({ error: T.signedOut }, 401);
    await udb(c).prepare("DELETE FROM sessions WHERE user_id = ?1").bind(m.u.id).run();
    await audit(c, m.u.id, "signout-all");
    return c.json({ ok: true });
  });

  /** Everything stored for this user, as one JSON file (profile, sign-in methods, devices, notes and other records). */
  api.get("/auth/export", async (c) => {
    const m = await me(c);
    if (!m) return c.json({ error: T.signedOut }, 401);
    const db = udb(c);
    const [items, sessions, log] = await Promise.all([
      db.prepare("SELECT kind, id, data, updated_at FROM user_items WHERE uid = ?1 AND deleted = 0").bind(m.u.id).all<URow>(),
      db.prepare("SELECT device, platform, method, created_at, last_seen FROM sessions WHERE user_id = ?1").bind(m.u.id).all(),
      db.prepare("SELECT event, at, detail FROM audit WHERE user_id = ?1 ORDER BY at").bind(m.u.id).all(),
    ]);
    await audit(c, m.u.id, "export");
    const out = {
      format: "lumen-account-export", version: 1, exportedAt: new Date().toISOString(), user: await publicUser(db, m.u),
      sessions: sessions.results, security: log.results,
      items: items.results.map((r) => ({ kind: r.kind, id: r.id, updatedAt: r.updated_at, data: JSON.parse(r.data) })),
    };
    return c.body(JSON.stringify(out, null, 2), 200, { "content-type": "application/json", "content-disposition": `attachment; filename="lumen-account-${new Date().toISOString().slice(0, 10)}.json"`, "cache-control": "no-store" });
  });
  /** Delete the account and all of its data. The client offers the export first; {confirm} must equal the email. */
  api.post("/auth/delete", async (c) => {
    const m = await me(c);
    if (!m) return c.json({ error: T.signedOut }, 401);
    const b = await body(c);
    if (core.normEmail(b.confirm) !== m.u.email) return c.json({ error: T.confirmMismatch }, 400);
    const db = udb(c), id = m.u.id;
    await db.batch([
      db.prepare("DELETE FROM user_items WHERE uid = ?1").bind(id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(id),
      db.prepare("DELETE FROM identities WHERE user_id = ?1").bind(id),
      db.prepare("DELETE FROM email_tokens WHERE user_id = ?1").bind(id),
      db.prepare("UPDATE audit SET user_id = NULL WHERE user_id = ?1").bind(id),
      db.prepare("DELETE FROM users WHERE id = ?1").bind(id),
    ]);
    await audit(c, null, "account-deleted");
    return c.json({ ok: true });
  });
}

function validTz(tz: unknown) {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}
