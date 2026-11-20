import type { Context, Hono, MiddlewareHandler, Next } from "hono";
import type { Env } from "../index";

/**
 * AI usage meter + optional daily limit (Lumen 29 · Settings › AI, round 6).
 *
 * Every Workers AI route (`POST /api/ai`, `/api/ai/*`, `/api/transcribe`) passes through `meter`:
 *  - before: if today's usage (UTC day) is at the daily limit, or Cloudflare already said the free allowance is used
 *    up, it answers 429 `{ error: "Daily free AI limit reached. Try tomorrow.", code: "ai_limit" }` without calling AI;
 *  - after a successful answer: /api/ai/visual/* bills the route's own `neurons` (real model usage) and nothing for `cached: true`;
 *    every other route estimates the neurons the call used and adds them to today's row for that feature.
 *    Workers AI does not return neurons, so they are estimated from the text sizes with the published rates
 *    (Llama 3.3 70B fp8-fast: 26,668 neurons / M input tokens, 204,805 / M output tokens; ~4 chars per token;
 *    Whisper turbo: ~47 neurons per audio minute, audio minutes from the upload size at ~32 kbit/s).
 *  - a 502 whose message says limit/quota marks the day as reached (Cloudflare's own free limit).
 *
 * Limit: Inbox space props `aiLimit` (synced like `aiOff`): absent = 10,000 on the main account and 3,000 on an extra
 * account, a number = own daily cap in neurons, "0" = no cap (paid plan).
 * Accounts (worker/accounts.ts): the free 10,000 neurons/day belong to the Cloudflare account, so every account's
 * counters live in the MAIN database, keyed per account (feature "<account>:<feature>"; main unprefixed). Each account
 * has its own limit, and while the main account is on the free allowance (its aiLimit isn't "0") all accounts
 * together stop at 10,000. The meter runs after `auth` (an unauthenticated call never touches D1 or the body).
 * `GET /api/ai/usage` → { day, used, limit, free, reached, features: {f: {calls, neurons}}, week: [{day, used}], resetAt }.
 *
 * Table (created on first use): ai_usage(day TEXT, feature TEXT, calls INTEGER, neurons REAL, PRIMARY KEY(day, feature)).
 * The pseudo-feature "_reached" marks a day Cloudflare refused for quota.
 */
const DDL = `CREATE TABLE IF NOT EXISTS ai_usage (day TEXT NOT NULL, feature TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0,
  neurons REAL NOT NULL DEFAULT 0, PRIMARY KEY (day, feature))`;
export const FREE_NEURONS = 10_000;
/** Default daily cap of an extra account (they share the Cloudflare account's free allowance with main). */
export const EXTRA_ACCOUNT_NEURONS = 3_000;
const IN_RATE = 26_668 / 1e6, OUT_RATE = 204_805 / 1e6, WHISPER_PER_MIN = 46.63;
const LIMIT_MSG = "Daily free AI limit reached. Try tomorrow.";

const dayOf = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const nextReset = (t = Date.now()) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };

const ready = new WeakSet<D1Database>();
async function table(db: D1Database) { if (!ready.has(db)) { await db.prepare(DDL).run(); ready.add(db); } }

async function inboxProps(db: D1Database): Promise<Record<string, string>> {
  const r = await db.prepare("SELECT data FROM items WHERE kind = 'space' AND id = 'inbox'").first<{ data: string }>().catch(() => null);
  try { return (r ? (JSON.parse(r.data) as { props?: Record<string, string> }).props : undefined) ?? {}; } catch { return {}; }
}
/** The account's own cap (neurons/day) from Settings › AI; 0 = none. */
async function ownLimit(db: D1Database, props?: Record<string, string>, account?: string): Promise<number> {
  const v = (props ?? (await inboxProps(db))).aiLimit;
  const fallback = account && account !== "main" ? EXTRA_ACCOUNT_NEURONS : FREE_NEURONS;
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Counter key prefix of an account ("" for main). */
export const acctPrefix = (account?: string) => (account && account !== "main" ? `${account}:` : "");
/** Today's usage: this account's (`used`, `features`) and all accounts together (`total`). */
export function summarize(rows: { feature: string; calls: number; neurons: number }[], account?: string) {
  const pre = acctPrefix(account);
  let used = 0, total = 0, reached = false;
  const features: Record<string, { calls: number; neurons: number }> = {};
  for (const r of rows) {
    if (r.feature === "_reached") { reached = true; continue; }
    total += r.neurons;
    const mine = pre ? r.feature.startsWith(pre) : !r.feature.includes(":");
    if (!mine) continue;
    features[r.feature.slice(pre.length)] = { calls: r.calls, neurons: Math.round(r.neurons) };
    used += r.neurons;
  }
  return { used: Math.round(used), total: Math.round(total), reached, features };
}
async function today(db: D1Database, account?: string, day = dayOf()) {
  const { results } = await db.prepare("SELECT feature, calls, neurons FROM ai_usage WHERE day = ?1").bind(day).all<{ feature: string; calls: number; neurons: number }>();
  return summarize(results, account);
}
/** Vault wipe: drop this account's counters only. */
export async function clearAiUsage(db: D1Database, account?: string) {
  const pre = acctPrefix(account);
  if (pre) await db.prepare("DELETE FROM ai_usage WHERE substr(feature, 1, ?2) = ?1").bind(pre, pre.length).run();
  else await db.prepare("DELETE FROM ai_usage WHERE instr(feature, ':') = 0 AND feature != '_reached'").run();
}

async function add(db: D1Database, feature: string, neurons: number) {
  await db.prepare(`INSERT INTO ai_usage (day, feature, calls, neurons) VALUES (?1, ?2, 1, ?3)
    ON CONFLICT(day, feature) DO UPDATE SET calls = calls + 1, neurons = neurons + excluded.neurons`).bind(dayOf(), feature, neurons).run();
}

/** Feature bucket for a request (matches the client's legend: summarize, flashcards, voice, explain, other…). */
function featureOf(path: string, action: string): string {
  if (path.endsWith("/transcribe")) return "voice";
  if (path === "/api/ai") return ["summarize", "flashcards", "explain", "tags", "quiz", "roadmap"].includes(action) ? action : "other";
  const sub = path.slice("/api/ai/".length).split("/")[0];
  return ["ask", "chat", "tutor", "project", "practice"].includes(sub) ? sub : "other";
}

async function textLen(r: Response | Request): Promise<number> {
  try { return (await r.clone().text()).length; } catch { return 0; }
}

export const meter: MiddlewareHandler<Env> = async (c: Context<Env>, next: Next) => {
  const path = c.req.path;
  if (c.req.method !== "POST" || path === "/api/ai/usage") return next();
  const own = c.env.DB, db = c.env.MAIN_DB ?? c.env.DB, account = c.env.ACCOUNT;
  try { await table(db); } catch { return next(); }
  const props = await inboxProps(own);
  const [t, limit, mainProps] = await Promise.all([today(db, account), ownLimit(own, props, account), db === own ? props : inboxProps(db)]);
  const shared = String(mainProps.aiLimit ?? "") !== "0"; // main on the free allowance: all accounts share 10,000
  if (t.reached || (limit > 0 && t.used >= limit) || (shared && t.total >= FREE_NEURONS)) return c.json({ error: LIMIT_MSG, code: "ai_limit" }, 429);
  // Settings › AI › Advanced › Model override: text features use this Workers AI model instead of Llama 3.3 70B.
  const override = String(props.aiModel ?? "").trim();
  if (c.env.AI && /^@cf\/[\w.-]+\/[\w.-]+$/.test(override)) {
    const ai = c.env.AI;
    const wrapped = new Proxy(ai, { get: (o, k) => k === "run" ? (model: string, ...rest: unknown[]) => (ai.run as (...a: unknown[]) => unknown)(/^@cf\/meta\/llama-3/.test(String(model)) ? override : model, ...rest) : Reflect.get(o, k) });
    c.env = { ...c.env, AI: wrapped };
  }

  const isVoice = path.endsWith("/transcribe");
  const len = Number(c.req.header("content-length") ?? 0) || 0;
  let action = "", inChars = 0, audioBytes = 0;
  if (isVoice) audioBytes = len || (await c.req.raw.clone().arrayBuffer().catch(() => new ArrayBuffer(0))).byteLength;
  else if (len > 8_000_000) inChars = 4400; // don't clone a huge body just to estimate (routes reject it anyway)
  else {
    const body = await c.req.raw.clone().text().catch(() => "");
    // Vision routes carry a base64 image: count the text only (the image is a flat ~1,100 tokens).
    inChars = path.startsWith("/api/ai/visual/") ? body.replace(/[A-Za-z0-9+/=]{2000,}/g, "").length + 4400 : body.length;
    try { action = String((JSON.parse(body) as { action?: string }).action ?? ""); } catch { /* not JSON */ }
  }
  const feature = acctPrefix(account) + featureOf(path, action);
  await next();

  const res = c.res;
  const wait = (p: Promise<unknown>) => { try { c.executionCtx.waitUntil(p); } catch { void p; } };
  if (res.status === 502 || res.status === 429) {
    const msg = await res.clone().text().catch(() => "");
    if (/limit|quota/i.test(msg)) wait(db.prepare("INSERT OR IGNORE INTO ai_usage (day, feature, calls, neurons) VALUES (?1, '_reached', 0, 0)").bind(dayOf()).run());
    return;
  }
  if (!res.ok) return;
  if (isVoice) { wait(add(db, feature, Math.max(1, (audioBytes / (32_000 / 8 * 60)) * WHISPER_PER_MIN))); return; }
  const est = (outChars: number) => Math.max(1, (inChars / 4) * IN_RATE + (outChars / 4) * OUT_RATE);
  if (res.headers.get("content-type")?.includes("event-stream") && res.body) {
    // Streams: count what was streamed once it ends, without holding the answer back.
    const [a, b] = res.body.tee();
    c.res = new Response(a, res);
    wait(new Response(b).text().then((s) => add(db, feature, est(s.length))).catch(() => {}));
  } else if (path.startsWith("/api/ai/visual/")) {
    // ai-visual routes return their own count from the model's real `usage` ({ neurons, cached? }): bill that, and nothing for a cache hit.
    wait(res.clone().json().then((j0: unknown) => {
      const j = j0 as { neurons?: unknown; cached?: unknown } | null;
      if (j?.cached === true) return;
      const n = Number(j?.neurons);
      return add(db, feature, Number.isFinite(n) && n >= 0 ? (n > 0 ? n : 0) : est(0)); // body without a count: fall back to the size estimate
    }).catch(() => {}));
  } else wait(textLen(res).then((n) => add(db, feature, est(n))).catch(() => {}));
};

export default function register(api: Hono<Env>, auth: MiddlewareHandler<Env>) {
  // auth first (401 before any D1 read or body clone), then the meter; the route's own `auth` sees the request
  // already passed and skips the second check.
  const gate: MiddlewareHandler<Env> = async (c, next) => {
    let out: Response | void = undefined;
    const r = await auth(c, async () => { out = await meter(c, next); });
    return r ?? out;
  };
  api.use("/ai", gate);
  api.use("/ai/*", gate);
  api.use("/transcribe", gate);

  api.get("/ai/usage", auth, async (c) => {
    const own = c.env.DB, db = c.env.MAIN_DB ?? c.env.DB, account = c.env.ACCOUNT;
    await table(db);
    const now = Date.now();
    const [t, limit] = await Promise.all([today(db, account), ownLimit(own, undefined, account)]);
    const from = dayOf(now - 6 * 86_400_000);
    const pre = acctPrefix(account);
    const mine = pre ? "substr(feature, 1, ?2) = ?3" : "instr(feature, ':') = 0";
    const stmt = db.prepare(`SELECT day, SUM(neurons) AS used FROM ai_usage WHERE day >= ?1 AND feature != '_reached' AND ${mine} GROUP BY day`);
    const { results } = await (pre ? stmt.bind(from, pre.length, pre) : stmt.bind(from)).all<{ day: string; used: number }>();
    const by = new Map(results.map((r) => [r.day, Math.round(r.used)]));
    const week = Array.from({ length: 7 }, (_, i) => { const d = dayOf(now - (6 - i) * 86_400_000); return { day: d, used: by.get(d) ?? 0 }; });
    // Housekeeping: keep 60 days.
    try { c.executionCtx.waitUntil(db.prepare("DELETE FROM ai_usage WHERE day < ?1").bind(dayOf(now - 60 * 86_400_000)).run()); } catch { /* tests */ }
    return c.json({ day: dayOf(now), used: t.used, total: t.total, limit, free: FREE_NEURONS, reached: t.reached || (limit > 0 && t.used >= limit), features: t.features, week, resetAt: nextReset(now) });
  });
}
