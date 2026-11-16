import type { Context, Next } from "hono";
import type { Env } from "./index";

/**
 * Extra accounts: each has its own passcode (wrangler secret) and its own D1 database with the same schema.
 * A request that belongs to an extra account gets `c.env.DB` / `c.env.APP_PASSCODE` swapped before any route runs,
 * so every route (sync, REST, tokens, unlock limits, attachments) works unchanged against that account's data.
 * The main account (DB + APP_PASSCODE) is the default; the public blog / RSS always read the main account.
 */
export const ACCOUNTS = [{ id: "roadmap", db: "DB_ROADMAP", pass: "ROADMAP_PASSCODE" }] as const;
type Account = (typeof ACCOUNTS)[number];

type Bindings = Env["Bindings"] & Record<string, unknown>;
type H = { hmac(secret: string, msg: string): Promise<string>; safeEqual(a: string, b: string): boolean };

const live = (env: Bindings) => ACCOUNTS.filter((a) => env[a.db] && typeof env[a.pass] === "string" && env[a.pass]);
function use(c: Context<Env>, a: Account) {
  const env = c.env as Bindings;
  c.env = { ...c.env, DB: env[a.db] as D1Database, APP_PASSCODE: env[a.pass] as string, ACCOUNT: a.id };
}
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");

export function accountRouter(h: H) {
  return async function route(c: Context<Env>, next: Next) {
    const env = c.env as Bindings;
    const accounts = live(env);
    if (!accounts.length) return next();
    const path = c.req.path;
    const authz = c.req.header("authorization") ?? "";
    const tok = authz.startsWith("Bearer ") ? authz.slice(7) : "";

    if (tok) {
      for (const a of accounts) {
        if (h.safeEqual(tok, await h.hmac(env[a.pass] as string, "lumen:owner:v1"))) { use(c, a); return next(); }
      }
      if (/^lmn_[A-Za-z0-9]{20,64}$/.test(tok)) {
        const hash = await sha256(tok);
        const main = await c.env.DB.prepare("SELECT 1 FROM api_tokens WHERE hash = ?").bind(hash).first().catch(() => null);
        if (!main) for (const a of accounts) {
          const hit = await (env[a.db] as D1Database).prepare("SELECT 1 FROM api_tokens WHERE hash = ?").bind(hash).first().catch(() => null);
          if (hit) { use(c, a); return next(); }
        }
      }
    }

    // Sign-in: the passcode picks the account (Hono caches the parsed body, so the route can read it again).
    if (c.req.method === "POST" && (path === "/api/login" || path === "/api/unlock")) {
      const { passcode } = await c.req.json<{ passcode?: string }>().catch(() => ({ passcode: "" }));
      if (passcode) for (const a of accounts) {
        if (h.safeEqual(await h.hmac("cmp", passcode), await h.hmac("cmp", env[a.pass] as string))) { use(c, a); break; }
      }
      return next();
    }

    // Public, unauthenticated reads that are keyed by a random id: fall back to the account that has it.
    if (c.req.method === "GET") {
      const share = /^\/api\/share\/([\w-]{16,64})(?:\/|$)/.exec(path)?.[1];
      const att = /^\/api\/att\/([\w-]{8,64})$/.exec(path)?.[1];
      const has = (db: D1Database) =>
        share ? db.prepare("SELECT 1 FROM items WHERE json_extract(data, '$.shareId') = ? AND deleted = 0 LIMIT 1").bind(share).first().catch(() => null)
        : att ? db.prepare("SELECT 1 FROM file_meta WHERE id = ?1 UNION ALL SELECT 1 FROM files WHERE id = ?1 LIMIT 1").bind(att).first().catch(() => null)
        : Promise.resolve(true);
      if ((share || att) && !(await has(c.env.DB))) {
        for (const a of accounts) if (await has(env[a.db] as D1Database)) { use(c, a); break; }
      }
    }
    return next();
  };
}
