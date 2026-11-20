import type { Hono } from "hono";
import type { Env, Helpers } from "../index";

/**
 * AI for visuals (round 7 · Lumen 35 review sheet, Lumen 48 architecture AI). Client: src/lib/ai-convert.ts.
 * All routes sit under /api/ai/… so they go through the existing `auth` and the AI usage meter / daily limit
 * (worker/ext/ai-usage.ts, feature bucket "other"; the meter still estimates from body size, it ignores our `neurons`).
 *
 *  POST /api/ai/visual/convert {image: "data:image/(png|jpeg|webp);base64,…", kind: text|math|mermaid|shapes-hint}
 *       → {text, spans: [{start,end,alts[]}], kind, model, neurons, cached?}
 *  POST /api/ai/visual/arch    {text, source?, type?} → {dsl, neurons}
 *  POST /api/ai/visual/edit    {dsl, instruction} → {dsl, neurons}
 *  POST /api/ai/visual/review  {dsl, mode?: review|docs|cards} → {review} | {text}, plus {neurons}
 *
 * Vision models, in order (checked against the Workers AI docs on 2026-11-20; only DOCUMENTED request shapes are used):
 *  1. @cf/qwen/qwen3.8-27b: OpenAI chat schema: user content parts {type:"image_url", image_url:{url:data-URI}},
 *     `response_format` json_schema, `reasoning_effort` low; answer in choices[0].message.content, real `usage`.
 *     https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/  (+ /sync-input.json, /sync-output.json)
 *  2. @cf/meta/llama-3.2-11b-vision-instruct: tutorial shape {messages, image: data-URI string}; no JSON mode, no usage
 *     documented; one-time licence step {prompt:"agree"} (error code 5016 "agree" message; the docs show no error shape).
 *     https://developers.cloudflare.com/workers-ai/guides/tutorials/llama-vision-tutorial/index.md
 *  Not used: Llama 4 Scout and Mistral Small 3.1 (their pages document no image input), Kimi K2.6 (deprecated 2026-11-20).
 * Image limit: the docs state none. We send ≤1280 px JPEG/PNG (client), cap the body server-side and answer 413.
 * Cache: D1 table ai_visual_cache (24 h) in the account's own database; no KV binding exists.
 * Reliability: one 45 s deadline for everything (AbortSignal), one backoff retry on 5xx, one repair retry on invalid output.
 */
const QWEN = "@cf/qwen/qwen3.8-27b";
const LLAMA32 = "@cf/meta/llama-3.2-11b-vision-instruct";
const TEXT = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const DEADLINE = 45_000;
const MAX_IMAGE = 2_000_000; // chars of base64 (~1.5 MB decoded); the client sends far less
const CACHE_TTL = 24 * 3600_000;
/** Neurons per million tokens (= $/M ÷ $0.000011): Qwen3.8 27B $0.45/$3.20, Llama 3.2 11B $0.0485/$0.676, Llama 3.3 70B fp8-fast. */
const RATES: Record<string, [number, number]> = { [QWEN]: [40_909, 290_909], [LLAMA32]: [4_409, 61_455], [TEXT]: [26_668, 204_805] };

const MARK = "Where you are unsure of a word, write it as {{best guess|alternative|alternative}} (up to 3 alternatives). Use this only for real doubt.";
const NONE = "If nothing legible is drawn, answer exactly NO_TEXT.";
const CONVERT: Record<string, string> = {
  text: `Transcribe the handwriting or text in this image exactly. Keep line breaks, use Markdown bullets where bullets are drawn. Do not correct spelling or maths. Write maths inline as plain Unicode (n₁ sin θ₁). No commentary. ${MARK} ${NONE}`,
  math: `Transcribe the mathematics in this image as LaTeX (\frac, \sqrt, aligned for several lines). Output only the LaTeX source, without $ delimiters and without code fences. Do not correct the maths. ${NONE}`,
  mermaid: `Convert the diagram or flow sketched in this image into Mermaid code (flowchart LR unless another type is clearly drawn). Use explicit node ids, quote labels, label edges only if drawn. Output only the Mermaid source, without code fences. ${NONE}`,
  "shapes-hint": `List the shapes and arrows in this sketch as a Mermaid flowchart (flowchart LR, explicit node ids, quoted labels) so they can be redrawn as clean shapes. Output only the Mermaid source, without code fences. ${NONE}`,
};
const FIELD: Record<string, string> = { text: "text", math: "latex", mermaid: "mermaid", "shapes-hint": "mermaid" };
const schemaOf = (kind: string) => ({
  type: "json_schema",
  json_schema: { name: "ink_" + FIELD[kind], strict: true, schema: { type: "object", properties: { [FIELD[kind]]: { type: "string" } }, required: [FIELD[kind]], additionalProperties: false } },
});

const DSL_GRAMMAR = `Lumen diagram DSL (output ONLY this, no prose, no code fences):
direction right            (or down)
// comment
Group [icon: region] {     groups nest with braces
  API [icon: service, tech: "FastAPI", status: live]
  DB [icon: database, tech: "Postgres 16"]
}
User [icon: user]
User > API: HTTPS          edges: A > B: label   (add "(async)" or "(data)" or "(control)" after the label for edge kinds)
API > DB: SQL (data)
Icons: service server database queue topic cache bucket function container pod cluster gateway load-balancer cdn dns api user team browser mobile desktop external-system firewall key lock-shield vault identity monitoring logs metrics alert scheduler worker stream etl warehouse lake model llm vector-db registry ci repo webhook email sms payment search file region vpc subnet zone namespace.
status is one of planned, building, live, deprecated. Node names are unique, one per line.`;

const SOURCE_HINT: Record<string, string> = {
  describe: "A plain-English description of a system.", code: "Source code.", openapi: "An OpenAPI document.", compose: "A docker-compose file.",
  k8s: "Kubernetes manifests.", terraform: "Terraform or CloudFormation.", sql: "SQL DDL or ORM models.", rfc: "An RFC or PRD note.",
};

type AiBinding = { run: (m: string, input: unknown, opts?: { signal?: AbortSignal }) => Promise<unknown> };
type Usage = { prompt_tokens?: number; completion_tokens?: number } | undefined;

/** Strip code fences and chatter around model output. */
export function cleanCode(s: string): string {
  const m = s.match(/```[\w-]*\n([\s\S]*?)```/);
  return (m ? m[1] : s).replace(/^\s*(here is|here's)[^\n]*\n/i, "").trim();
}

/** Parse {{best|alt|alt}} markers into plain text plus spans over it. */
export function parseMarks(raw: string): { text: string; spans: { start: number; end: number; alts: string[] }[] } {
  let text = "";
  const spans: { start: number; end: number; alts: string[] }[] = [];
  let last = 0;
  for (const m of raw.matchAll(/\{\{([^{}]+?)\}\}/g)) {
    text += raw.slice(last, m.index);
    const [best, ...alts] = m[1].split("|").map((x) => x.trim());
    spans.push({ start: text.length, end: text.length + best.length, alts: alts.filter(Boolean) });
    text += best;
    last = m.index! + m[0].length;
  }
  text += raw.slice(last);
  return { text, spans };
}

// ------------------------------------------------------------------ errors
class AiFail extends Error {
  constructor(msg: string, public status: number, public code?: string) { super(msg); }
}
const errMsg = (e: unknown) => String((e as Error)?.message ?? e);
const errCode = (e: unknown) => Number((e as { code?: unknown })?.code ?? (e as { status?: unknown })?.status ?? NaN);

/** Workers AI licence step (Llama 3.2). The docs give no error shape; the binding reports code 5016 ("…agree…"). */
export function isLicenceError(e: unknown): boolean {
  const m = errMsg(e);
  return errCode(e) === 5016 || /\b5016\b/.test(m) || /(submit|send)[^.]{0,30}prompt[^.]{0,6}agree/i.test(m) || /agree[^.]{0,60}(licen[cs]e|terms|acceptable use)|(licen[cs]e|terms)[^.]{0,60}agree/i.test(m);
}
const isQuota = (e: unknown) => [3036, 4006, 429].includes(errCode(e)) || /limit|quota|neurons|4006|3036|\b429\b/i.test(errMsg(e));
const is5xx = (e: unknown) => { const c = errCode(e); return (c >= 500 && c < 600) || /\b50[0-4]\b|internal server|upstream|temporarily|capacity|3040|3007/i.test(errMsg(e)); };
const isAbort = (e: unknown) => (e as Error)?.name === "AbortError" || /abort|timeout|499/i.test(errMsg(e));

function mapError(e: unknown): { status: 413 | 422 | 424 | 429 | 502 | 504; error: string; code?: string } {
  if (e instanceof AiFail) return { status: e.status as 422, error: e.message, code: e.code };
  if (isAbort(e)) return { status: 504, error: "The AI took too long. Try a smaller selection." };
  if (isQuota(e)) return { status: 429, error: "Daily free AI limit reached. Try tomorrow.", code: "ai_limit" };
  return { status: 502, error: "AI request failed." };
}
const licenceFail = () => new AiFail("One-time setup needed: accept the Llama 3.2 licence for this Cloudflare account (send {\"prompt\":\"agree\"} to @cf/meta/llama-3.2-11b-vision-instruct once), then try again.", 424, "ai_licence");

// ------------------------------------------------------------------ deadline + retry
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); rej(new Error("timeout")); }, { once: true });
});
/** One call with the shared deadline signal and one backoff retry on 5xx. */
async function run(ai: AiBinding, model: string, input: unknown, signal: AbortSignal): Promise<unknown> {
  for (let i = 0; ; i++) {
    if (signal.aborted) throw new Error("timeout");
    try {
      return await Promise.race([ai.run(model, input, { signal }), new Promise<never>((_, rej) => signal.addEventListener("abort", () => rej(new Error("timeout")), { once: true }))]);
    } catch (e) {
      if (i >= 1 || !is5xx(e) || isLicenceError(e)) throw e;
      await sleep(500 + Math.random() * 500, signal);
    }
  }
}

/** Pull text + usage out of either documented response shape. */
function readOut(r: unknown): { text: string; usage: Usage; object?: unknown } {
  const o = r as { response?: unknown; choices?: { message?: { content?: string | null } }[]; usage?: Usage };
  const resp = o?.response;
  if (resp && typeof resp === "object") return { text: JSON.stringify(resp), usage: o.usage, object: resp };
  return { text: String(resp ?? o?.choices?.[0]?.message?.content ?? "").trim(), usage: o?.usage };
}
const neuronsOf = (model: string, usage: Usage, inChars: number, outChars: number, image = false) => {
  const [ri, ro] = RATES[model] ?? RATES[TEXT];
  const tin = usage?.prompt_tokens ?? inChars / 4 + (image ? 1100 : 0), tout = usage?.completion_tokens ?? outChars / 4;
  return Math.max(1, Math.round((tin * ri + tout * ro) / 1e6));
};

// ------------------------------------------------------------------ validation of vision output
type Checked = { ok: true; value: string } | { ok: false; reason: string; unreadable?: boolean };
const REFUSAL = /^(i('m| am)? (sorry|unable|not able)|i (can ?not|can't|cannot|couldn't)|sorry,? (i|but)|as an ai)/i;
const MERMAID_HEAD = /^(flowchart|graph)\s+(TB|TD|BT|RL|LR)\b|^(sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|gantt|pie|mindmap|journey|timeline|gitGraph)\b/;

function balanced(s: string, pairs: [string, string][]): boolean {
  return pairs.every(([o, c]) => { let d = 0; for (const ch of s) { if (ch === o) d++; else if (ch === c && --d < 0) return false; } return d === 0; });
}

/** Extract the answer field (JSON mode) or fall back to the raw text, then check it per kind. */
export function checkVision(kind: string, raw: string): Checked {
  let v = raw.trim();
  const field = FIELD[kind];
  if (/^\{\s*"/.test(v) || v.startsWith("```json")) {
    try {
      const j = JSON.parse(cleanCode(v)) as Record<string, unknown>;
      if (typeof j?.[field] !== "string") return { ok: false, reason: `JSON must be {"${field}": "<string>"}` };
      v = (j[field] as string).trim();
    } catch { return { ok: false, reason: "not valid JSON" }; }
  }
  if (kind !== "text") v = cleanCode(v);
  if (!v) return { ok: false, reason: "empty answer" };
  if (/^NO_TEXT\b/.test(v)) return { ok: false, reason: "nothing legible", unreadable: true };
  if (REFUSAL.test(v)) return { ok: false, reason: "the answer is a refusal, not a transcription", unreadable: true };
  if (kind === "text") {
    v = v.replace(/^\s*(transcription|transcript|text)\s*:\s*/i, "").trim();
    if (!v) return { ok: false, reason: "empty answer" };
    if ((v.match(/\{\{/g)?.length ?? 0) !== (v.match(/\}\}/g)?.length ?? 0)) v = v.replace(/\{\{|\}\}/g, "");
    return { ok: true, value: v };
  }
  if (kind === "math") {
    v = v.replace(/^\s*\$\$?|\$\$?\s*$/g, "").replace(/^\s*\\\[|\\\]\s*$/g, "").replace(/^\s*\\\(|\\\)\s*$/g, "").trim();
    if (!v) return { ok: false, reason: "empty LaTeX" };
    if (v.length > 4000) return { ok: false, reason: "LaTeX is far too long" };
    if (!balanced(v.replace(/\\[{}]/g, ""), [["{", "}"]])) return { ok: false, reason: "unbalanced braces" };
    if ((v.match(/\\begin\{/g)?.length ?? 0) !== (v.match(/\\end\{/g)?.length ?? 0)) return { ok: false, reason: "\\begin and \\end do not match" };
    return { ok: true, value: v };
  }
  const lines = v.split("\n").filter((l) => l.trim() && !l.trim().startsWith("%%"));
  if (!lines.length || !MERMAID_HEAD.test(lines[0].trim())) return { ok: false, reason: "must start with a Mermaid diagram header such as `flowchart LR`" };
  if (lines.length < 2) return { ok: false, reason: "the diagram has no nodes" };
  if (!balanced(v.replace(/"[^"\n]*"/g, ""), [["[", "]"], ["(", ")"], ["{", "}"]])) return { ok: false, reason: "unbalanced brackets (quote labels)" };
  return { ok: true, value: v };
}

/** Image data URI → verified { mime, b64 } (magic bytes), or null. */
export function readImage(img: string): { mime: string; b64: string } | null {
  const m = img.match(/^data:[^;,]*;base64,([\s\S]*)$/);
  const b64 = (m ? m[1] : img).replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(b64) || b64.length < 24) return null;
  let head = "";
  try { head = atob(b64.slice(0, 24)); } catch { return null; }
  if (head.startsWith("\x89PNG")) return { mime: "image/png", b64 };
  if (head.startsWith("\xff\xd8\xff")) return { mime: "image/jpeg", b64 };
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return { mime: "image/webp", b64 };
  return null;
}

let agreed = false; // Llama 3.2 licence, once per isolate
async function agree(ai: AiBinding, signal: AbortSignal) {
  await run(ai, LLAMA32, { prompt: "agree" }, signal).catch((e) => { console.warn("ai-visual: licence step failed", errCode(e), errMsg(e).slice(0, 200)); });
  agreed = true;
}

interface VisionOut { value: string; model: string; neurons: number }

/** Ordered models, shared deadline. Licence errors are never swallowed by the fallback. */
async function vision(ai: AiBinding, dataUri: string, kind: string): Promise<VisionOut> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), DEADLINE);
  const signal = ctl.signal;
  const prompt = CONVERT[kind];
  const input = (model: string, text: string): unknown => model === QWEN
    ? { messages: [{ role: "user", content: [{ type: "text", text }, { type: "image_url", image_url: { url: dataUri } }] }], response_format: schemaOf(kind), reasoning_effort: "low", max_completion_tokens: 1500, temperature: 0.1 }
    : { messages: [{ role: "user", content: text }], image: dataUri, max_tokens: 1024, temperature: 0.1 };
  const tail = (model: string) => (model === QWEN ? ` Reply as JSON {"${FIELD[kind]}": "..."}.` : "");
  let lastErr: unknown, licence = false, spent = 0;
  try {
    for (const model of [QWEN, LLAMA32]) {
      try {
        let text = prompt + tail(model);
        for (let attempt = 0; attempt < 2; attempt++) {
          let r: unknown;
          try { r = await run(ai, model, input(model, text), signal); }
          catch (e) {
            if (model === LLAMA32 && isLicenceError(e)) {
              if (agreed) throw licenceFail();
              await agree(ai, signal);
              try { r = await run(ai, model, input(model, text), signal); }
              catch (e2) { throw isLicenceError(e2) ? licenceFail() : e2; }
            } else throw e;
          }
          const out = readOut(r);
          spent += neuronsOf(model, out.usage, text.length, out.text.length, true);
          const chk = checkVision(kind, out.text);
          if (chk.ok) return { value: chk.value, model, neurons: spent };
          if (chk.unreadable) throw new AiFail("Couldn't read this ink. Try a smaller selection or write more clearly.", 422, "unreadable");
          if (attempt === 1) throw new AiFail(`The AI returned an unusable answer (${chk.reason}). Try again or select less.`, 502, "invalid_output");
          text = `${prompt}${tail(model)}\n\nYour previous answer was rejected: ${chk.reason}. Look at the image again and answer correctly, following the format exactly.`;
        }
      } catch (e) {
        if (e instanceof AiFail && e.code === "ai_licence") licence = true;
        else if (isLicenceError(e)) licence = true;
        else if (e instanceof AiFail || isQuota(e) || isAbort(e)) throw e; // wrong ink / limit / deadline: another model won't help
        lastErr = e;
        console.warn("ai-visual:", model, errCode(e), errMsg(e).slice(0, 200));
      }
    }
    if (licence) throw licenceFail();
    throw lastErr ?? new Error("failed");
  } finally { clearTimeout(timer); }
}

async function chat(ai: AiBinding, system: string, user: string, max = 1800, format?: unknown): Promise<{ text: string; object?: unknown; neurons: number }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), DEADLINE);
  try {
    const usr = user.slice(0, 24_000);
    const r = await run(ai, TEXT, { messages: [{ role: "system", content: system }, { role: "user", content: usr }], max_tokens: max, temperature: 0.2, ...(format ? { response_format: format } : {}) }, ctl.signal);
    const o = readOut(r);
    return { text: o.text, object: o.object, neurons: neuronsOf(TEXT, o.usage, system.length + usr.length, o.text.length) };
  } finally { clearTimeout(timer); }
}

// ------------------------------------------------------------------ review output
const REVIEW_SCHEMA = {
  type: "json_schema",
  json_schema: { name: "review", schema: { type: "object", additionalProperties: false, required: ["summary", "spof", "missing", "stride"], properties: {
    summary: { type: "string" },
    spof: { type: "array", items: { type: "string" } },
    missing: { type: "array", items: { type: "object", required: ["kind", "text"], properties: { kind: { type: "string", enum: ["auth", "encryption", "backup", "other"] }, text: { type: "string" } } } },
    stride: { type: "array", items: { type: "object", required: ["cat", "text", "severity"], properties: { cat: { type: "string", enum: ["S", "T", "R", "I", "D", "E"] }, text: { type: "string" }, severity: { type: "string", enum: ["High", "Med", "Low"] } } } },
  } } },
};
/** Validate and clamp the model's review (arrays, max 5 items, enums). null when the shape is unusable. */
export function checkReview(v: unknown): { summary: string; spof: string[]; missing: { kind: string; text: string }[]; stride: { cat: string; text: string; severity: string }[] } | null {
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  if (typeof o.summary !== "string" || !Array.isArray(o.spof) || !Array.isArray(o.missing) || !Array.isArray(o.stride)) return null;
  const str = (x: unknown, n = 240) => (typeof x === "string" ? x.trim().slice(0, n) : "");
  const sev = (x: unknown) => { const s = str(x).toLowerCase(); return s.startsWith("h") ? "High" : s.startsWith("l") ? "Low" : "Med"; };
  const cat = (x: unknown) => { const c = str(x, 20).toUpperCase().charAt(0); return c && "STRIDE".includes(c) ? c : ""; };
  const spof = o.spof.map((x) => str(x)).filter(Boolean).slice(0, 5);
  const missing = o.missing.map((x) => { const m = x as Record<string, unknown>; const k = str(m?.kind, 20).toLowerCase(); return { kind: ["auth", "encryption", "backup"].includes(k) ? k : "other", text: str(m?.text) }; }).filter((m) => m.text).slice(0, 5);
  const stride = o.stride.map((x) => { const m = x as Record<string, unknown>; return { cat: cat(m?.cat), text: str(m?.text), severity: sev(m?.severity) }; }).filter((m) => m.cat && m.text).slice(0, 5);
  const summary = str(o.summary, 400);
  return summary ? { summary, spof, missing, stride } : null;
}

// ------------------------------------------------------------------ cache (D1, 24 h)
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const cacheReady = new WeakSet<D1Database>();
async function cacheTable(db: D1Database) {
  if (cacheReady.has(db)) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS ai_visual_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL)").run();
  cacheReady.add(db);
}
async function cacheGet(db: D1Database, key: string): Promise<Record<string, unknown> | null> {
  try {
    await cacheTable(db);
    const r = await db.prepare("SELECT data FROM ai_visual_cache WHERE key = ?1 AND created_at > ?2").bind(key, Date.now() - CACHE_TTL).first<{ data: string }>();
    return r ? (JSON.parse(r.data) as Record<string, unknown>) : null;
  } catch { return null; }
}
async function cachePut(db: D1Database, key: string, data: unknown) {
  try {
    await cacheTable(db);
    await db.prepare("INSERT OR REPLACE INTO ai_visual_cache (key, data, created_at) VALUES (?1, ?2, ?3)").bind(key, JSON.stringify(data), Date.now()).run();
    if (Math.random() < 0.05) await db.prepare("DELETE FROM ai_visual_cache WHERE created_at < ?1").bind(Date.now() - CACHE_TTL).run();
  } catch { /* cache is optional */ }
}

export default function register(api: Hono<Env>, { auth }: Helpers) {
  const body = async <T,>(c: { req: { json: <U>() => Promise<U> } }) => c.req.json<T>().catch(() => null);

  api.post("/ai/visual/convert", auth, async (c) => {
    const ai = c.env.AI as unknown as AiBinding | undefined;
    if (!ai) return c.json({ error: "AI isn't enabled on the server." }, 501);
    const b = await body<{ image?: string; kind?: string }>(c);
    const kind = b?.kind && CONVERT[b.kind] ? b.kind : "";
    if (!kind || !b?.image) return c.json({ error: "Bad request" }, 400);
    if (b.image.length > MAX_IMAGE) return c.json({ error: `That selection is too large (${(b.image.length / 1e6).toFixed(1)} MB, limit ${(MAX_IMAGE / 1e6).toFixed(0)} MB). Select less ink or zoom out.`, code: "too_large" }, 413);
    const img = readImage(b.image);
    if (!img) return c.json({ error: "That isn't a PNG, JPEG or WebP image." }, 400);
    const key = await sha256(`${kind}:${img.b64}`);
    const hit = await cacheGet(c.env.DB, key);
    if (hit) return c.json({ ...hit, neurons: 0, cached: true });
    try {
      const r = await vision(ai, `data:${img.mime};base64,${img.b64}`, kind);
      const { text, spans } = kind === "text" ? parseMarks(r.value) : { text: r.value, spans: [] };
      const out = { text, spans, kind, model: r.model };
      try { c.executionCtx.waitUntil(cachePut(c.env.DB, key, out)); } catch { await cachePut(c.env.DB, key, out); }
      return c.json({ ...out, neurons: r.neurons });
    } catch (e) {
      const m = mapError(e);
      return c.json({ error: m.error, code: m.code }, m.status);
    }
  });

  api.post("/ai/visual/arch", auth, async (c) => {
    const ai = c.env.AI as unknown as AiBinding | undefined;
    if (!ai) return c.json({ error: "AI isn't enabled on the server." }, 501);
    const b = await body<{ text?: string; source?: string; type?: string }>(c);
    if (!b?.text?.trim()) return c.json({ error: "Bad request" }, 400);
    const type = ["architecture", "flowchart", "sequence", "erd", "c4"].includes(b.type ?? "") ? b.type : "architecture";
    const sys = `You turn input into a ${type} diagram in the Lumen DSL. Input: ${SOURCE_HINT[b.source ?? "describe"] ?? SOURCE_HINT.describe} Show only the components, data stores, queues, external systems and the connections between them; do not invent products that are not implied.\n${DSL_GRAMMAR}`;
    try {
      const r = await chat(ai, sys, b.text);
      const dsl = cleanCode(r.text);
      if (!dsl) return c.json({ error: "Couldn't draft a diagram from this. Add more detail." }, 422);
      return c.json({ dsl, neurons: r.neurons, truncated: b.text.length > 24_000 || undefined });
    } catch (e) { const m = mapError(e); return c.json({ error: m.error, code: m.code }, m.status); }
  });

  api.post("/ai/visual/edit", auth, async (c) => {
    const ai = c.env.AI as unknown as AiBinding | undefined;
    if (!ai) return c.json({ error: "AI isn't enabled on the server." }, 501);
    const b = await body<{ dsl?: string; instruction?: string }>(c);
    if (!b?.dsl?.trim() || !b.instruction?.trim()) return c.json({ error: "Bad request" }, 400);
    const sys = `You edit a diagram written in the Lumen DSL according to the user's instruction. Keep everything that the instruction does not touch exactly as it is (same names, same order, same lines). Return the COMPLETE updated DSL.\n${DSL_GRAMMAR}`;
    try {
      const r = await chat(ai, sys, `Current diagram:\n${b.dsl}\n\nInstruction: ${b.instruction}`);
      const dsl = cleanCode(r.text);
      if (!dsl) return c.json({ error: "Couldn't apply that. Try rephrasing." }, 422);
      return c.json({ dsl, neurons: r.neurons });
    } catch (e) { const m = mapError(e); return c.json({ error: m.error, code: m.code }, m.status); }
  });

  api.post("/ai/visual/review", auth, async (c) => {
    const ai = c.env.AI as unknown as AiBinding | undefined;
    if (!ai) return c.json({ error: "AI isn't enabled on the server." }, 501);
    const b = await body<{ dsl?: string; mode?: string }>(c);
    if (!b?.dsl?.trim()) return c.json({ error: "Bad request" }, 400);
    try {
      if (b.mode === "docs" || b.mode === "cards") {
        const sys = b.mode === "docs"
          ? "Write a short architecture decision record in Markdown for this diagram: Context, Decision, a component table (Component | Kind | Tech | Notes), Consequences."
          : "Write 6 to 10 study flashcards about this diagram, one per line, in the form `Question :: Answer`. Output only the lines.";
        const r = await chat(ai, sys, b.dsl, 1400);
        return c.json({ text: r.text, neurons: r.neurons });
      }
      const sys = `You review a system architecture written in the Lumen DSL. Reply with ONLY a JSON object, no prose:
{"summary": "<=2 sentences explaining the flow", "spof": ["single points of failure, short"], "missing": [{"kind":"auth|encryption|backup|other","text":"short"}], "stride": [{"cat":"S|T|R|I|D|E","text":"short threat","severity":"High|Med|Low"}]}
Be specific to the nodes in the diagram. At most 5 items per list.`;
      let spent = 0, why = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        let r: Awaited<ReturnType<typeof chat>>;
        try { r = await chat(ai, attempt ? `${sys}\n\nYour previous answer was rejected (${why}). Return exactly the JSON object described.` : sys, b.dsl, 1400, REVIEW_SCHEMA); }
        catch (e) { if (!/JSON Mode/i.test(errMsg(e))) throw e; why = "JSON mode couldn't be met"; continue; } // documented failure: repair retry
        spent += r.neurons;
        let v: unknown = r.object;
        if (v === undefined) { try { v = JSON.parse(r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1)); } catch { why = "not valid JSON"; continue; } }
        const review = checkReview(v);
        if (review) return c.json({ review, neurons: spent });
        why = "wrong shape: need summary (string), spof (array), missing (array), stride (array)";
      }
      return c.json({ error: "Couldn't read the review. Try again." }, 502);
    } catch (e) { const m = mapError(e); return c.json({ error: m.error, code: m.code }, m.status); }
  });
}
