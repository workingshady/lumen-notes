/**
 * Accounts: the pure security pieces (no Hono, no D1) so they can be unit-tested with `npx tsx scripts/auth.test.ts`.
 * Everything uses WebCrypto, available in Workers and in Node 20+.
 *
 * - Passwords: PBKDF2-SHA256, 16-byte random salt per hash, 100 000 iterations (the most Cloudflare Workers allow
 *   for PBKDF2), constant-time compare. Stored as "pbkdf2-sha256$<iterations>$<salt>$<hash>" so the cost can be raised
 *   later (verify reports `rehash` when a stored hash used fewer iterations).
 * - Opaque tokens (sessions, email links, OAuth state): 32 random bytes, base64url; only their SHA-256 is stored.
 * - Google sign-in: PKCE S256 (RFC 7636) + state + nonce; ID token = RS256 JWT checked against Google's JWKS.
 */

const enc = new TextEncoder();

export const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const fromB64url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
};
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
export const sha256hex = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
export async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
/** Constant-time for equal lengths (lengths of hashes/tokens are not secret). */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ------------------------------------------------------------------ passwords
export const PBKDF2_ITERATIONS = 100_000; // Workers' PBKDF2 limit; see docs/ACCOUNTS.md
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 256;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256));
}
export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${iterations}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, iterations))}`;
}
/** `rehash` = the stored hash is valid but weaker than today's setting. Malformed hashes never verify. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<{ ok: boolean; rehash: boolean }> {
  const m = /^pbkdf2-sha256\$(\d{1,7})\$([A-Za-z0-9_-]{16,64})\$([A-Za-z0-9_-]{40,90})$/.exec(stored ?? "");
  if (!m || password.length > PASSWORD_MAX) {
    await pbkdf2(password.slice(0, PASSWORD_MAX), new Uint8Array(16), PBKDF2_ITERATIONS); // same work either way (no user-exists timing signal)
    return { ok: false, rehash: false };
  }
  const iterations = Number(m[1]);
  if (iterations < 1000 || iterations > PBKDF2_ITERATIONS) return { ok: false, rehash: false };
  const got = b64url(await pbkdf2(password, fromB64url(m[2]), iterations));
  const ok = safeEqual(got, m[3]);
  return { ok, rehash: ok && iterations < PBKDF2_ITERATIONS };
}
/** Server-side rule (the client shows a strength meter on top). */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return "That password is too long.";
  if (/^(.)\1+$/.test(pw)) return "Pick a less predictable password.";
  return null;
}

// ------------------------------------------------------------------ emails
export const normEmail = (e: unknown) => String(e ?? "").trim().toLowerCase();
export const validEmail = (e: string) => e.length <= 254 && /^[^\s@"<>()[\],;:\\]+@[^\s@"<>()[\],;:\\]+\.[^\s@"<>()[\],;:\\]{2,}$/.test(e);

/** "amir@nightshift.dev" → "am••@nightshift.dev" (shown after renewing a link from an old one, never the full address). */
export const maskEmail = (e: string) => {
  const [local, domain] = e.split("@");
  if (!domain) return "";
  return (local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2)) + "••@" + domain;
};
/**
 * The phrase typed to delete an account: "delete " + the first word of the name (letters/digits, lower case), else
 * the part of the email before @. Design 27N: "Type delete amir to confirm". The client builds the same phrase.
 */
export function deletePhrase(u: { name: string; email: string }) {
  const first = (u.name ?? "").trim().split(/\s+/)[0]?.toLowerCase().replace(/[^\p{L}\p{N}._-]/gu, "") ?? "";
  return "delete " + (first || (u.email ?? "").split("@")[0].toLowerCase());
}

// ------------------------------------------------------------------ one-time tokens
export type TokenKind = "verify" | "magic" | "reset" | "handoff";
export const TOKEN_TTL: Record<TokenKind, number> = { verify: 24 * 3600_000, magic: 15 * 60_000, reset: 60 * 60_000, handoff: 2 * 60_000 };
/** Email-change confirmation links (table `email_changes`, sent to the NEW address). */
export const EMAIL_CHANGE_TTL = 24 * 3600_000;
export type TokenRow = { kind: TokenKind; expires_at: number; used_at: number | null };
/** Why a stored one-time token can't be used (null = usable). */
export function tokenProblem(row: TokenRow | null | undefined, kind: TokenKind, now: number): "missing" | "wrong-kind" | "used" | "expired" | null {
  if (!row) return "missing";
  if (row.kind !== kind) return "wrong-kind";
  if (row.used_at) return "used";
  if (row.expires_at <= now) return "expired";
  return null;
}

// ------------------------------------------------------------------ sessions
export const SESSION_PREFIX = "lms_";
export const SESSION_TTL = 30 * 24 * 3600_000; // sliding
export const SESSION_MAX = 180 * 24 * 3600_000; // absolute
export const newSessionToken = () => SESSION_PREFIX + randomToken(32);
export const isSessionToken = (t: string) => /^lms_[A-Za-z0-9_-]{43}$/.test(t);
/** New expiry after activity: slide by TTL but never past created + MAX. */
export const slideExpiry = (createdAt: number, now: number) => Math.min(now + SESSION_TTL, createdAt + SESSION_MAX);

// ------------------------------------------------------------------ OAuth: PKCE + state
export const pkceVerifier = () => randomToken(32); // 43 chars, within RFC 7636's 43..128 unreserved set
export const validVerifier = (v: string) => /^[A-Za-z0-9\-._~]{43,128}$/.test(v);
export const pkceChallenge = async (verifier: string) => b64url(await crypto.subtle.digest("SHA-256", enc.encode(verifier)));
export type StateRow = { expires_at: number } | null | undefined;
/**
 * The callback's `state` must (1) match the HttpOnly cookie set on this browser at /start (stops login CSRF),
 * (2) exist server-side (single use: the row is deleted when read) and (3) not be expired.
 */
export function stateProblem(param: string | null | undefined, cookie: string | null | undefined, row: StateRow, now: number): "missing" | "mismatch" | "unknown" | "expired" | null {
  if (!param || !cookie) return "missing";
  if (!safeEqual(param, cookie)) return "mismatch";
  if (!row) return "unknown";
  if (row.expires_at <= now) return "expired";
  return null;
}
/** Only same-site relative paths survive the round trip (no open redirects). */
export const safeReturn = (r: unknown) => {
  const s = String(r ?? "/");
  return /^\/(?![/\\])[^\s]*$/.test(s) && s.length < 300 ? s : "/";
};

// ------------------------------------------------------------------ Google ID token (RS256 JWT)
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
export const GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs";
export type IdClaims = { iss: string; aud: string | string[]; azp?: string; sub: string; email?: string; email_verified?: boolean | string; name?: string; picture?: string; nonce?: string; exp: number; iat: number };
export type KeyLookup = (kid: string) => Promise<CryptoKey | null>;
const SKEW = 300; // seconds of clock skew accepted

export async function verifyIdToken(jwt: string, opts: { clientId: string; nonce: string; now: number; key: KeyLookup }): Promise<IdClaims> {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("malformed");
  let header: { alg?: string; kid?: string }, claims: IdClaims;
  try {
    header = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[1])));
  } catch { throw new Error("malformed"); }
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("bad-alg");
  const key = await opts.key(header.kid);
  if (!key) throw new Error("unknown-key");
  const okSig = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64url(parts[2]) as BufferSource, enc.encode(`${parts[0]}.${parts[1]}`));
  if (!okSig) throw new Error("bad-signature");
  const now = Math.floor(opts.now / 1000);
  if (!GOOGLE_ISSUERS.includes(claims.iss)) throw new Error("bad-issuer");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(opts.clientId) || (aud.length > 1 && claims.azp !== opts.clientId)) throw new Error("bad-audience");
  if (typeof claims.exp !== "number" || claims.exp + SKEW < now) throw new Error("expired");
  if (typeof claims.iat !== "number" || claims.iat - SKEW > now) throw new Error("issued-in-future");
  if (!opts.nonce || claims.nonce !== opts.nonce) throw new Error("bad-nonce");
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("no-subject");
  return claims;
}
export const emailVerifiedClaim = (c: IdClaims) => c.email_verified === true || c.email_verified === "true";

/** JWKS cache (per isolate): honours Cache-Control max-age, refetches at most once a minute on an unknown kid. */
export function jwksCache(fetcher: (url: string) => Promise<Response> = (u) => fetch(u), url = GOOGLE_JWKS) {
  let keys = new Map<string, CryptoKey>();
  let until = 0, lastFetch = 0;
  async function load(now: number) {
    lastFetch = now;
    const r = await fetcher(url);
    if (!r.ok) throw new Error("jwks-unavailable");
    const body = (await r.json()) as { keys?: (JsonWebKey & { kid?: string; alg?: string; use?: string })[] };
    const next = new Map<string, CryptoKey>();
    for (const k of body.keys ?? []) {
      if (!k.kid || k.kty !== "RSA" || (k.use && k.use !== "sig")) continue;
      next.set(k.kid, await crypto.subtle.importKey("jwk", { kty: "RSA", n: k.n, e: k.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
    }
    keys = next;
    const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get("cache-control") ?? "")?.[1] ?? 3600);
    until = now + Math.min(Math.max(maxAge, 60), 24 * 3600) * 1000;
  }
  return async function key(kid: string, now = Date.now()): Promise<CryptoKey | null> {
    if (now >= until) await load(now);
    else if (!keys.has(kid) && now - lastFetch > 60_000) await load(now);
    return keys.get(kid) ?? null;
  };
}
