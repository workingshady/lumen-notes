// Accounts tests (worker/ext/auth-core.ts + worker/ext/auth.ts). Run: npx tsx scripts/auth.test.ts
// Part 1: pure security pieces. Part 2: the real routes on a local, in-memory SQLite database (node:sqlite behind a
// tiny D1-compatible adapter, all migrations applied) with the switch set by
// an env override in this script — no .dev.vars, no network, never production. Test passcodes are throwaway values.
import { readdirSync, readFileSync } from "node:fs";
import { Hono, type Context, type Next } from "hono";
import { DatabaseSync } from "node:sqlite";
import * as core from "../worker/ext/auth-core";
import registerAuth, { _resetAuthCaches, accountsEnabled, authGate } from "../worker/ext/auth";
import { accountRouter } from "../worker/accounts";
import type { Env, Helpers } from "../worker/index";

let failed = 0, passed = 0;
function ok(cond: unknown, msg: string) { if (cond) passed++; else { failed++; console.error("FAIL:", msg); } }
function eq<T>(a: T, b: T, msg: string) { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, `${msg}\n   got:      ${A}\n   expected: ${B}`); }
async function rejects(p: Promise<unknown>, reason: string, msg: string) {
  try { await p; ok(false, `${msg}: expected rejection ${reason}`); } catch (e) { eq((e as Error).message, reason, msg); }
}

// ================================================================== part 1: core
{
  const h = await core.hashPassword("correct horse battery");
  ok(/^pbkdf2-sha256\$100000\$[\w-]{22}\$[\w-]{43}$/.test(h), "hash format");
  ok(h !== (await core.hashPassword("correct horse battery")), "per-hash salt");
  eq(await core.verifyPassword("correct horse battery", h), { ok: true, rehash: false }, "verify right password");
  eq((await core.verifyPassword("correct horse batterY", h)).ok, false, "verify wrong password");
  eq((await core.verifyPassword("x", null)).ok, false, "no hash never verifies");
  eq((await core.verifyPassword("x", "plain")).ok, false, "malformed hash never verifies");
  const weak = await core.hashPassword("correct horse battery", 2000);
  eq(await core.verifyPassword("correct horse battery", weak), { ok: true, rehash: true }, "weaker hash asks for rehash");
  eq(core.passwordProblem("short"), "Use at least 10 characters.", "min length");
  eq(core.passwordProblem("aaaaaaaaaaaa"), "Pick a less predictable password.", "repeated char");
  eq(core.passwordProblem("a fine long password"), null, "good password");
  ok(core.safeEqual("abc", "abc") && !core.safeEqual("abc", "abd") && !core.safeEqual("abc", "ab"), "safeEqual");
}
{
  const now = 1_000_000;
  eq(core.tokenProblem(null, "magic", now), "missing", "token missing");
  eq(core.tokenProblem({ kind: "reset", expires_at: now + 1, used_at: null }, "magic", now), "wrong-kind", "token kind");
  eq(core.tokenProblem({ kind: "magic", expires_at: now + 1, used_at: 5 }, "magic", now), "used", "token used");
  eq(core.tokenProblem({ kind: "magic", expires_at: now, used_at: null }, "magic", now), "expired", "token expired at boundary");
  eq(core.tokenProblem({ kind: "magic", expires_at: now + 1, used_at: null }, "magic", now), null, "token ok");
  eq(core.TOKEN_TTL.magic, 15 * 60_000, "magic TTL 15 min");
  eq(core.slideExpiry(0, 10), 10 + core.SESSION_TTL, "slide");
  eq(core.slideExpiry(0, core.SESSION_MAX), core.SESSION_MAX, "slide capped at absolute max");
  ok(core.isSessionToken(core.newSessionToken()) && !core.isSessionToken("lmn_abc"), "session token shape");
}
{
  // RFC 7636 appendix B vector
  eq(await core.pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "PKCE S256");
  ok(core.validVerifier(core.pkceVerifier()) && !core.validVerifier("short") && !core.validVerifier("a".repeat(129)), "verifier length rules");
  const now = 5000;
  eq(core.stateProblem("s", null, { expires_at: 9e9 }, now), "missing", "state needs cookie");
  eq(core.stateProblem("s1", "s2", { expires_at: 9e9 }, now), "mismatch", "state must match cookie");
  eq(core.stateProblem("s", "s", null, now), "unknown", "state must exist server-side");
  eq(core.stateProblem("s", "s", { expires_at: now }, now), "expired", "state expiry");
  eq(core.stateProblem("s", "s", { expires_at: now + 1 }, now), null, "state ok");
  eq([core.safeReturn("/settings?x=1"), core.safeReturn("//evil.com"), core.safeReturn("https://evil.com"), core.safeReturn("/\\evil"), core.safeReturn(undefined)],
    ["/settings?x=1", "/", "/", "/", "/"], "safeReturn blocks open redirects");
}

// ---- fake Google: an RSA key, its JWKS, and signed ID tokens
const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
const other = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1", use: "sig", alg: "RS256" };
const JWKS_BODY = JSON.stringify({ keys: [jwk] });
const te = new TextEncoder();
async function idToken(claims: Record<string, unknown>, { kid = "k1", alg = "RS256", key = kp.privateKey } = {}) {
  const h = core.b64url(te.encode(JSON.stringify({ alg, kid, typ: "JWT" })));
  const p = core.b64url(te.encode(JSON.stringify(claims)));
  const sig = core.b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, te.encode(`${h}.${p}`)));
  return `${h}.${p}.${sig}`;
}
const CLIENT = "test-client.apps.googleusercontent.com";
{
  let fetches = 0;
  const keys = core.jwksCache(async () => { fetches++; return new Response(JWKS_BODY, { headers: { "cache-control": "public, max-age=3600" } }); });
  const now = Date.now(), sec = Math.floor(now / 1000);
  const base = { iss: "https://accounts.google.com", aud: CLIENT, sub: "g-123", email: "ana@example.com", email_verified: true, nonce: "n1", iat: sec, exp: sec + 3600 };
  const opts = { clientId: CLIENT, nonce: "n1", now, key: (kid: string) => keys(kid, now) };
  eq((await core.verifyIdToken(await idToken(base), opts)).sub, "g-123", "valid ID token");
  await rejects(core.verifyIdToken(await idToken({ ...base, aud: "someone-else" }), opts), "bad-audience", "audience");
  await rejects(core.verifyIdToken(await idToken({ ...base, iss: "https://evil.example" }), opts), "bad-issuer", "issuer");
  await rejects(core.verifyIdToken(await idToken({ ...base, exp: sec - 3600 }), opts), "expired", "expiry");
  await rejects(core.verifyIdToken(await idToken({ ...base, iat: sec + 3600 }), opts), "issued-in-future", "iat");
  await rejects(core.verifyIdToken(await idToken({ ...base, nonce: "other" }), opts), "bad-nonce", "nonce");
  await rejects(core.verifyIdToken(await idToken(base, { key: other.privateKey }), opts), "bad-signature", "signature by another key");
  await rejects(core.verifyIdToken(await idToken(base, { alg: "none" }), opts), "bad-alg", "alg none");
  const t = await idToken(base);
  const tampered = t.split(".")[0] + "." + core.b64url(te.encode(JSON.stringify({ ...base, sub: "g-999" }))) + "." + t.split(".")[2];
  await rejects(core.verifyIdToken(tampered, opts), "bad-signature", "tampered claims");
  eq(fetches, 1, "JWKS cached");
  await rejects(core.verifyIdToken(await idToken(base, { kid: "k9" }), opts), "unknown-key", "unknown kid");
  eq(fetches, 1, "unknown kid does not refetch within a minute");
  await keys("k9", now + 61_000);
  eq(fetches, 2, "unknown kid refetches after a minute");
  ok(core.emailVerifiedClaim({ ...base, email_verified: "true" } as core.IdClaims) && !core.emailVerifiedClaim({ ...base, email_verified: false } as core.IdClaims), "email_verified claim");
}

// ================================================================== part 2: routes on a local D1
/** Minimal D1 surface (prepare/bind/first/all/run, batch as a transaction) over node:sqlite, in memory. */
function d1(sqlite: DatabaseSync): D1Database {
  const stmt = (sql: string, args: unknown[] = []) => {
    const norm = () => args.map((a) => (a === undefined ? null : a)) as (string | number | null)[];
    const s = {
      bind: (...a: unknown[]) => stmt(sql, a),
      first: async () => (sqlite.prepare(sql).get(...norm()) as unknown) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...norm()), success: true, meta: {} }),
      run: async () => { const r = sqlite.prepare(sql).run(...norm()); return { success: true, results: [], meta: { changes: Number(r.changes) } }; },
    };
    return s;
  };
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (list: { run(): Promise<unknown> }[]) => {
      sqlite.exec("BEGIN");
      try { const out = []; for (const st of list) out.push(await st.run()); sqlite.exec("COMMIT"); return out; } catch (e) { sqlite.exec("ROLLBACK"); throw e; }
    },
    exec: async (sql: string) => { sqlite.exec(sql); return { count: 0, duration: 0 }; },
  } as unknown as D1Database;
}
const sqlite = new DatabaseSync(":memory:");
for (const f of readdirSync("migrations").filter((x) => x.endsWith(".sql")).sort()) sqlite.exec(readFileSync(`migrations/${f}`, "utf8"));
const DB = d1(sqlite);

// A small app wired like worker/index.ts: gate → passcode account router → owner routes → auth routes.
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
const OWNER_PASS = "test-only-owner-pass";
async function ownerAuth(c: Context<Env>, next: Next) {
  const tok = (c.req.header("authorization") ?? "").slice(7);
  if (!tok || !core.safeEqual(tok, await hmac(c.env.APP_PASSCODE, "lumen:owner:v1"))) return c.json({ error: "Unauthorized" }, 401);
  return next();
}
const app = new Hono<Env>(), api = new Hono<Env>();
api.use("*", authGate());
api.use("*", accountRouter({ hmac, safeEqual: core.safeEqual }));
api.post("/login", async (c) => {
  const { passcode } = await c.req.json<{ passcode: string }>();
  return passcode === c.env.APP_PASSCODE ? c.json({ token: await hmac(c.env.APP_PASSCODE, "lumen:owner:v1") }) : c.json({ error: "Wrong passcode." }, 401);
});
api.post("/sync", ownerAuth, async (c) => c.json({ owner: true, count: (await c.env.DB.prepare("SELECT COUNT(*) n FROM items").first<{ n: number }>())!.n }));
api.get("/notes", ownerAuth, (c) => c.json([]));
registerAuth(api, {} as Helpers);
app.route("/api", api);

let ENV: Record<string, unknown> = {};
const LOCAL = "http://localhost:5330";
async function call(path: string, init: { method?: string; json?: unknown; token?: string; cookie?: string; base?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.json !== undefined) headers["content-type"] = "application/json";
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.cookie) headers.cookie = init.cookie;
  const res = await app.request((init.base ?? LOCAL) + "/api" + path, { method: init.method ?? (init.json !== undefined ? "POST" : "GET"), headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined }, { DB, APP_PASSCODE: OWNER_PASS, ...ENV });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, body: (type.includes("json") ? await res.json() : await res.text()) as Record<string, any>, headers: res.headers };
}
// Capture the dev mailer ("would send …" lines) instead of printing them.
const mails: string[] = [];
const realLog = console.log;
console.log = (...a: unknown[]) => { const s = a.map(String).join(" "); if (s.startsWith("[auth] would send")) mails.push(s); else realLog(...a); };
const lastLink = (kind: string) => { const m = new RegExp(`auth=${kind}&token=([\\w-]{43})`).exec(mails[mails.length - 1] ?? ""); return m?.[1] ?? ""; };

// ---- switch OFF (default): nothing new is reachable; owner flow unchanged
const owner = (await call("/login", { json: { passcode: OWNER_PASS } })).body.token as string;
{
  eq((await call("/accounts/config")).body, { enabled: false, providers: { google: false, email: false, magic: false } }, "off: config");
  for (const p of ["/auth/register", "/auth/login", "/auth/magic", "/auth/forgot", "/auth/exchange", "/auth/google/start"]) eq((await call(p, { json: {} })).status, 404, `off: ${p} is 404`);
  eq((await call("/auth/me")).status, 404, "off: /auth/me 404");
  eq((await call("/sync", { json: {}, token: owner })).body.owner, true, "off: owner sync works");
  eq((await call("/sync", { json: {}, token: core.newSessionToken() })).status, 401, "off: a session token is just rejected by owner auth");
  eq(await accountsEnabled({}, DB), false, "off by default");
  await DB.prepare("INSERT INTO meta (k, v) VALUES ('accounts_enabled', '1')").run(); _resetAuthCaches();
  eq(await accountsEnabled({}, DB), true, "meta key turns it on");
  eq(await accountsEnabled({ ACCOUNTS_ENABLED: "0" }, DB), false, "env 0 overrides meta (kill switch)");
  await DB.prepare("DELETE FROM meta WHERE k = 'accounts_enabled'").run(); _resetAuthCaches();
  eq(mails.length, 0, "off: no mail");
}

// ---- switch ON via env override
ENV = { ACCOUNTS_ENABLED: "1" };
const DEV = { device: "Test PC", platform: "windows" };
{
  eq((await call("/accounts/config")).body, { enabled: true, providers: { google: false, email: true, magic: true } }, "on: config (local → dev mailer)");
  eq((await call("/auth/register", { json: { email: "ana@example.com", password: "short", terms: true } })).status, 400, "weak password refused");
  eq((await call("/auth/register", { json: { email: "ana@example.com", password: "a fine long password" } })).status, 400, "terms required");
  const r = await call("/auth/register", { json: { email: " Ana@Example.com ", password: "a fine long password", name: "Ana", terms: true, tz: "Europe/Berlin" } });
  eq(r.body, { ok: true, mail: "sent" }, "register");
  const row = await DB.prepare("SELECT password_hash, email_verified, tz FROM users WHERE email = 'ana@example.com'").first<{ password_hash: string; email_verified: number; tz: string }>();
  ok(row?.password_hash.startsWith("pbkdf2-sha256$") && !row.password_hash.includes("fine"), "password stored hashed");
  eq([row?.email_verified, row?.tz], [0, "Europe/Berlin"], "unverified, tz kept");
  const again = await call("/auth/register", { json: { email: "ana@example.com", password: "another long password", terms: true } });
  eq(again.body, { ok: true, mail: "sent" }, "re-register answers the same (no enumeration)");
  const login1 = await call("/auth/login", { json: { email: "ana@example.com", password: "a fine long password" } });
  eq([login1.status, login1.body.needsVerification], [403, true], "login before verifying");
  const verify = lastLink("verify");
  ok(verify, "verify link in mail");
  const v = await call("/auth/verify/confirm", { json: { token: verify, ...DEV } });
  ok(core.isSessionToken(v.body.token) && v.body.user.emailVerified === true, "verify signs in");
  eq((await call("/auth/verify/confirm", { json: { token: verify } })).status, 400, "verify link single use");
  const tokHash = await core.sha256hex(v.body.token);
  ok(await DB.prepare("SELECT 1 FROM sessions WHERE id = ?1").bind(tokHash).first(), "session stored by hash");
  ok(!(await DB.prepare("SELECT 1 FROM sessions WHERE id = ?1").bind(v.body.token).first()), "raw token not stored");
}
let S = "";
{
  const l = await call("/auth/login", { json: { email: "ANA@example.com", password: "a fine long password", ...DEV } });
  eq(l.status, 200, "login");
  S = l.body.token;
  eq((await call("/auth/me", { token: S })).body.user.email, "ana@example.com", "me");
  const p = await call("/auth/me", { method: "PUT", json: { name: "Ana B", avatar: "glyph:owl", lang: "ar", tz: "Asia/Dubai" }, token: S });
  eq([p.body.user.name, p.body.user.lang, p.body.user.tz], ["Ana B", "ar", "Asia/Dubai"], "profile update");
  eq((await call("/auth/me", { method: "PUT", json: { tz: "Mars/Base" }, token: S })).status, 400, "bad tz refused");
  eq((await call("/auth/me", { method: "PUT", json: { avatar: "javascript:alert(1)" }, token: S })).status, 400, "bad avatar refused");

  // per-user data: sync scoped to user_items, owner untouched
  await DB.prepare("INSERT INTO items (kind, id, data, updated_at, deleted, rev) VALUES ('note', 'owner-note', '{\"title\":\"owner\"}', 1, 0, 1)").run();
  const s1 = await call("/sync", { json: { since: 0, items: [{ kind: "note", id: "n1", data: { title: "mine" }, updatedAt: 10, deleted: 0 }] }, token: S });
  eq([s1.status, s1.body.items.length, s1.body.items[0]?.data.title], [200, 1, "mine"], "user sync sees only own rows");
  eq((await DB.prepare("SELECT COUNT(*) n FROM items").first<{ n: number }>())!.n, 1, "owner items untouched");
  eq((await call("/sync", { json: {}, token: owner })).body, { owner: true, count: 1 }, "owner sync unchanged while on");
  eq((await call("/notes", { token: S })).status, 403, "owner routes refuse a session (403, not 401)");
  eq((await call("/access/seen", { json: { name: "Laptop", platform: "web" }, token: S })).body, { revoked: false }, "heartbeat");
}
{
  // a second user can't see the first one's rows
  await call("/auth/register", { json: { email: "bo@example.com", password: "bo's long password", terms: true } });
  const bo = (await call("/auth/verify/confirm", { json: { token: lastLink("verify") } })).body.token as string;
  eq((await call("/sync", { json: { since: 0 }, token: bo })).body.items.length, 0, "isolation between users");

  // lockout: 5 misses → 429
  let last = 0;
  for (let i = 0; i < 5; i++) last = (await call("/auth/login", { json: { email: "bo@example.com", password: "wrong password!!" } })).status;
  eq(last, 429, "5 wrong passwords → lockout");
  eq((await call("/auth/login", { json: { email: "bo@example.com", password: "bo's long password" } })).status, 429, "locked even with the right password");
  await DB.prepare("DELETE FROM auth_attempts").run();
  eq((await call("/auth/login", { json: { email: "nobody@example.com", password: "whatever long" } })).status, 401, "unknown email: same 401");
}
{
  // magic link + reset
  eq((await call("/auth/magic", { json: { email: "nobody@example.com" } })).body, { ok: true, mail: "sent" }, "magic for unknown email answers the same");
  const before = mails.length;
  await call("/auth/magic", { json: { email: "ana@example.com" } });
  eq(mails.length, before + 1, "magic mail sent");
  const m = await call("/auth/magic/confirm", { json: { token: lastLink("magic") } });
  ok(core.isSessionToken(m.body.token), "magic link signs in");
  await DB.prepare("UPDATE email_tokens SET expires_at = 1 WHERE kind = 'magic'").run();
  await call("/auth/magic", { json: { email: "ana@example.com" } });
  const fresh = lastLink("magic");
  await DB.prepare("UPDATE email_tokens SET expires_at = 1 WHERE kind = 'magic' AND used_at IS NULL").run();
  eq((await call("/auth/magic/confirm", { json: { token: fresh } })).body.error, "This link has expired. Ask for a new one.", "expired magic link");
  await DB.prepare("DELETE FROM auth_attempts").run();
  await call("/auth/forgot", { json: { email: "ana@example.com" } });
  const reset = await call("/auth/reset", { json: { token: lastLink("reset"), password: "a brand new password" } });
  eq(reset.status, 200, "reset");
  eq((await call("/auth/me", { token: S })).status, 401, "reset signs out other sessions");
  S = reset.body.token;
  eq((await call("/auth/login", { json: { email: "ana@example.com", password: "a brand new password" } })).status, 200, "new password works");
}
{
  // password change, sessions, sign out everywhere
  eq((await call("/auth/password", { json: { current: "nope nope nope", next: "another new password" }, token: S })).status, 401, "change needs current");
  eq((await call("/auth/password", { json: { current: "a brand new password", next: "another new password" }, token: S })).status, 200, "change password");
  const sessions = (await call("/auth/sessions", { token: S })).body.sessions as { id: string; current: boolean }[];
  eq(sessions.length, 1, "other sessions dropped on password change");
  const extra = (await call("/auth/login", { json: { email: "ana@example.com", password: "another new password" } })).body.token as string;
  const list = (await call("/auth/sessions", { token: S })).body.sessions as { id: string; current: boolean }[];
  const target = list.find((s) => !s.current)!;
  eq((await call("/auth/sessions/" + target.id, { method: "DELETE", token: S })).status, 200, "revoke one");
  eq((await call("/auth/me", { token: extra })).status, 401, "revoked session is out");
  const e = await call("/auth/export", { token: S });
  eq([e.body.format, e.body.items.length, e.body.user.email], ["lumen-account-export", 1, "ana@example.com"], "export");
  ok(!JSON.stringify(e.body).includes("pbkdf2"), "export has no password hash");
  eq((await call("/auth/signout-all", { json: {}, token: S })).status, 200, "sign out everywhere");
  eq((await call("/auth/me", { token: S })).status, 401, "signed out");
}
{
  // Google: start → callback (fake token endpoint + JWKS) → hand-off code → session
  ENV = { ACCOUNTS_ENABLED: "1", GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: "test-only-secret" };
  eq((await call("/accounts/config")).body.providers.google, true, "google provider on with secrets");
  const realFetch = globalThis.fetch;
  let tokenClaims: Record<string, unknown> = {};
  let sentVerifier = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === core.GOOGLE_JWKS) return new Response(JWKS_BODY, { headers: { "content-type": "application/json", "cache-control": "max-age=3600" } });
    if (url === "https://oauth2.googleapis.com/token") {
      sentVerifier = new URLSearchParams(String(init?.body)).get("code_verifier") ?? "";
      return Response.json({ id_token: await idToken(tokenClaims) });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  try {
    const start = await call("/auth/google/start", { json: { return: "/" } });
    const u = new URL(start.body.url);
    const state = u.searchParams.get("state")!, nonce = u.searchParams.get("nonce")!;
    eq([u.origin, u.searchParams.get("code_challenge_method"), u.searchParams.get("redirect_uri")], ["https://accounts.google.com", "S256", LOCAL + "/api/auth/google/callback"], "auth URL");
    const setCookie = start.headers.get("set-cookie") ?? "";
    ok(/HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Lax/.test(setCookie), "state cookie flags");
    const cookie = `__Host-lumen_oauth=${state}`;
    const sec = Math.floor(Date.now() / 1000);
    tokenClaims = { iss: "https://accounts.google.com", aud: CLIENT, sub: "g-ana", email: "ana@example.com", email_verified: true, nonce, iat: sec, exp: sec + 600, name: "Ana" };
    // wrong cookie → error, and the state is burnt
    const bad = await call(`/auth/google/callback?state=${state}&code=c1`, { cookie: "__Host-lumen_oauth=other" });
    ok(bad.status === 302 && /auth=google-error&reason=state-mismatch/.test(bad.headers.get("location") ?? ""), "callback rejects a state without its cookie");
    eq((await call(`/auth/google/callback?state=${state}&code=c1`, { cookie })).headers.get("location")?.includes("reason=state-unknown"), true, "state is single use");
    // full flow
    const s2 = await call("/auth/google/start", { json: {} });
    const u2 = new URL(s2.body.url);
    tokenClaims.nonce = u2.searchParams.get("nonce");
    const cb = await call(`/auth/google/callback?state=${u2.searchParams.get("state")}&code=c2`, { cookie: `__Host-lumen_oauth=${u2.searchParams.get("state")}` });
    const loc = new URL(cb.headers.get("location")!);
    eq(loc.searchParams.get("auth"), "google", "callback succeeds");
    eq(await core.pkceChallenge(sentVerifier), u2.searchParams.get("code_challenge"), "verifier sent matches the challenge");
    const ex = await call("/auth/exchange", { json: { code: loc.searchParams.get("code"), ...DEV } });
    eq(ex.body.user?.email, "ana@example.com", "google links to the existing verified account");
    eq(ex.body.user?.identities?.[0]?.provider, "google", "identity linked");
    eq((await call("/auth/exchange", { json: { code: loc.searchParams.get("code") } })).status, 400, "hand-off code single use");
    // nonce mismatch → token error
    const s3 = await call("/auth/google/start", { json: {} });
    const u3 = new URL(s3.body.url);
    tokenClaims.nonce = "not-the-nonce";
    const cb3 = await call(`/auth/google/callback?state=${u3.searchParams.get("state")}&code=c3`, { cookie: `__Host-lumen_oauth=${u3.searchParams.get("state")}` });
    ok(/reason=token/.test(cb3.headers.get("location") ?? ""), "bad nonce → error");
    // user cancelled
    const s4 = await call("/auth/google/start", { json: {} });
    const st4 = new URL(s4.body.url).searchParams.get("state");
    ok(/reason=cancelled/.test((await call(`/auth/google/callback?state=${st4}&error=access_denied`, { cookie: `__Host-lumen_oauth=${st4}` })).headers.get("location") ?? ""), "consent cancelled");
    // pre-registration hijack defence: unverified password account gets its password dropped
    await call("/auth/register", { json: { email: "cy@example.com", password: "attacker password", terms: true } });
    const s5 = await call("/auth/google/start", { json: {} });
    const u5 = new URL(s5.body.url);
    tokenClaims = { ...tokenClaims, sub: "g-cy", email: "cy@example.com", nonce: u5.searchParams.get("nonce") };
    const cb5 = new URL((await call(`/auth/google/callback?state=${u5.searchParams.get("state")}&code=c5`, { cookie: `__Host-lumen_oauth=${u5.searchParams.get("state")}` })).headers.get("location")!);
    const cy = await call("/auth/exchange", { json: { code: cb5.searchParams.get("code") } });
    eq([cy.body.user?.hasPassword, cy.body.user?.emailVerified], [false, true], "unverified password dropped when Google proves the email");
    // delete account
    const tok = ex.body.token as string;
    eq((await call("/auth/delete", { json: { confirm: "wrong@example.com" }, token: tok })).status, 400, "delete needs typed email");
    eq((await call("/auth/delete", { json: { confirm: "ana@example.com" }, token: tok })).status, 200, "delete");
    eq((await DB.prepare("SELECT COUNT(*) n FROM user_items WHERE uid NOT IN (SELECT id FROM users)").first<{ n: number }>())!.n, 0, "user rows gone");
    ok(!(await DB.prepare("SELECT 1 FROM users WHERE email = 'ana@example.com'").first()), "user gone");
  } finally { globalThis.fetch = realFetch; }
}
{
  // production host, no mail provider: refuse, and log nothing
  const before = mails.length;
  const r = await call("/auth/magic", { json: { email: "bo@example.com" }, base: "https://lumen.example.com" });
  eq([r.status, mails.length], [503, before], "production without a provider: 503, no 'would send' log");
  eq((await call("/accounts/config", { base: "https://lumen.example.com" })).body.providers.magic, false, "production: magic off without provider");
}

console.log = realLog;
sqlite.close();
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
