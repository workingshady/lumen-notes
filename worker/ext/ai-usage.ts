import type { Context, Hono, MiddlewareHandler, Next } from "hono";
import type { Env } from "../index";

/**
 * AI usage meter + optional daily limit (Lumen 29 · Settings › AI, round 6).
 *
 * Every Workers AI route (`POST /api/ai`, `/api/ai/*`, `/api/transcribe`) passes through `meter`:
 *  - before: if today's usage (UTC day) is at the daily limit, or Cloudflare already said the free allowance is used
 *    up, it answers 429 `{ error: "Daily free AI limit reached. Try tomorrow.", code: "ai_limit" }` without calling AI;
 *  - after a successful answer: it estimates the neurons the call used and adds them to today's row for that feature.
 *    Workers AI does not return neurons, so they are estimated from the text sizes with the published rates
 *    (Llama 3.3 70B fp8-fast: 26,668 neurons / M input tokens, 204,805 / M output tokens; ~4 chars per token;
 *    Whisper turbo: ~47 neurons per audio minute, audio minutes from the upload size at ~32 kbit/s).
 *  - a 502 whose message says limit/quota marks the day as reached (Cloudflare's own free limit).
 *
 * Limit: Inbox space props `aiLimit` (synced like `aiOff`): absent = 10,000 (the free allowance), a number = own
 * daily cap in neurons, "0" = no cap (paid plan).
 * `GET /api/ai/usage` → { day, used, limit, free, reached, features: {f: {calls, neurons}}, week: [{day, used}], resetAt }.
 *
 * Table (created on first use): ai_usage(day TEXT, feature TEXT, calls INTEGER, neurons REAL, PRIMARY KEY(day, feature)).
 * The pseudo-feature "_reached" marks a day Cloudflare refused for quota.
 */
const DDL = `CREATE TABLE IF NOT EXISTS ai_usage (day TEXT NOT NULL, feature TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0,
  neurons REAL NOT NULL DEFAULT 0, PRIMARY KEY (day, feature))`;
export const FREE_NEURONS = 10_000;
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
/** The owner's own cap (neurons/day) from Settings › AI; 0 = none. */
async function ownLimit(db: D1Database, props?: Record<string, string>): Promise<number> {
  const v = (props ?? (await inboxProps(db))).aiLimit;
  if (v === undefined || v === "") return FREE_NEURONS;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : FREE_NEURONS;
}

async function today(db: D1Database, day = dayOf()) {
  const { results } = await db.prepare("SELECT feature, calls, neurons FROM ai_usage WHERE day = ?1").bind(day).all<{ feature: string; calls: number; neurons: number }>();
  let used = 0, reached = false;
  const features: Record<string, { calls: number; neurons: number }> = {};
  for (const r of results) {
    if (r.feature === "_reached") { reached = true; continue; }
    features[r.feature] = { calls: r.calls, neurons: Math.round(r.neurons) };
    used += r.neurons;
  }
  return { used: Math.round(used), reached, features };
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
  const db = c.env.DB;
  try { await table(db); } catch { return next(); }
  const props = await inboxProps(db);
  const [t, limit] = await Promise.all([today(db), ownLimit(db, props)]);
  if (t.reached || (limit > 0 && t.used >= limit)) return c.json({ error: LIMIT_MSG, code: "ai_limit" }, 429);
  // Settings › AI › Advanced › Model override: text features use this Workers AI model instead of Llama 3.3 70B.
  const override = String(props.aiModel ?? "").trim();
  if (c.env.AI && /^@cf\/[\w.-]+\/[\w.-]+$/.test(override)) {
    const ai = c.env.AI;
    const wrapped = new Proxy(ai, { get: (o, k) => k === "run" ? (model: string, ...rest: unknown[]) => (ai.run as (...a: unknown[]) => unknown)(/^@cf\/meta\/llama-3/.test(String(model)) ? override : model, ...rest) : Reflect.get(o, k) });
    c.env = { ...c.env, AI: wrapped };
  }

  const isVoice = path.endsWith("/transcribe");
  let action = "", inChars = 0, audioBytes = 0;
  if (isVoice) audioBytes = Number(c.req.header("content-length") ?? 0) || (await c.req.raw.clone().arrayBuffer().catch(() => new ArrayBuffer(0))).byteLength;
  else {
    const body = await c.req.raw.clone().text().catch(() => "");
    inChars = body.length;
    try { action = String((JSON.parse(body) as { action?: string }).action ?? ""); } catch { /* not JSON */ }
  }
  const feature = featureOf(path, action);
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
  } else wait(textLen(res).then((n) => add(db, feature, est(n))).catch(() => {}));
};

export default function register(api: Hono<Env>, auth: MiddlewareHandler<Env>) {
  api.use("/ai", meter);
  api.use("/ai/*", meter);
  api.use("/transcribe", meter);

  api.get("/ai/usage", auth, async (c) => {
    const db = c.env.DB;
    await table(db);
    const now = Date.now();
    const [t, limit] = await Promise.all([today(db), ownLimit(db)]);
    const from = dayOf(now - 6 * 86_400_000);
    const { results } = await db.prepare("SELECT day, SUM(neurons) AS used FROM ai_usage WHERE day >= ?1 AND feature != '_reached' GROUP BY day").bind(from).all<{ day: string; used: number }>();
    const by = new Map(results.map((r) => [r.day, Math.round(r.used)]));
    const week = Array.from({ length: 7 }, (_, i) => { const d = dayOf(now - (6 - i) * 86_400_000); return { day: d, used: by.get(d) ?? 0 }; });
    // Housekeeping: keep 60 days.
    try { c.executionCtx.waitUntil(db.prepare("DELETE FROM ai_usage WHERE day < ?1").bind(dayOf(now - 60 * 86_400_000)).run()); } catch { /* tests */ }
    return c.json({ day: dayOf(now), used: t.used, limit, free: FREE_NEURONS, reached: t.reached || (limit > 0 && t.used >= limit), features: t.features, week, resetAt: nextReset(now) });
  });
}
