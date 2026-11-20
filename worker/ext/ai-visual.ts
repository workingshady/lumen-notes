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

@@MID@@
export default function register(api: Hono<Env>, { auth }: Helpers) {
  const body = async <T,>(c: { req: { json: <U>() => Promise<U> } }) => c.req.json<T>().catch(() => null);

  api.post("/ai/visual/convert", auth, async (c) => {
    const ai = c.env.AI as unknown as AiBinding | undefined;
    if (!ai) return c.json({ error: "AI isn't enabled on the server." }, 501);
    const b = await body<{ image?: string; kind?: string }>(c);
    const kind = b?.kind && CONVERT[b.kind] ? b.kind : "";
    let img = b?.image ?? "";
    if (!kind || !img) return c.json({ error: "Bad request" }, 400);
    if (!img.startsWith("data:")) img = "data:image/png;base64," + img;
    if (img.length > MAX_IMAGE) return c.json({ error: "That selection is too large. Try a smaller one." }, 413);
    try {
      const r = await vision(ai, img, CONVERT[kind]);
      const raw = kind !== "text" ? cleanCode(r.text) : r.text;
      const { text, spans } = parseMarks(raw);
      return c.json({ text, spans, kind, model: r.model, neurons: neurons(CONVERT[kind].length, raw.length, true) });
    } catch (e) {
      if (errMsg(e) === "empty") return c.json({ error: "Couldn't read this ink. Try a smaller selection or write more clearly.", code: "unreadable" }, 422);
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
      const dsl = cleanCode(await chat(ai, sys, b.text));
      if (!dsl) return c.json({ error: "Couldn't draft a diagram from this. Add more detail." }, 422);
      return c.json({ dsl, neurons: neurons(b.text.length + sys.length, dsl.length) });
    } catch (e) { const m = mapError(e); return c.json({ error: m.error, code: m.code }, m.status); }
  });

  api.post("/ai/visual/edit", auth, async (c) => {
    const ai = c.env.AI as unknown as AiBinding | undefined;
    if (!ai) return c.json({ error: "AI isn't enabled on the server." }, 501);
    const b = await body<{ dsl?: string; instruction?: string }>(c);
    if (!b?.dsl?.trim() || !b.instruction?.trim()) return c.json({ error: "Bad request" }, 400);
    const sys = `You edit a diagram written in the Lumen DSL according to the user's instruction. Keep everything that the instruction does not touch exactly as it is (same names, same order, same lines). Return the COMPLETE updated DSL.\n${DSL_GRAMMAR}`;
    try {
      const dsl = cleanCode(await chat(ai, sys, `Current diagram:\n${b.dsl}\n\nInstruction: ${b.instruction}`));
      if (!dsl) return c.json({ error: "Couldn't apply that. Try rephrasing." }, 422);
      return c.json({ dsl, neurons: neurons(b.dsl.length + b.instruction.length + sys.length, dsl.length) });
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
        const text = await chat(ai, sys, b.dsl, 1400);
        return c.json({ text, neurons: neurons(b.dsl.length + sys.length, text.length) });
      }
      const sys = `You review a system architecture written in the Lumen DSL. Reply with ONLY a JSON object, no prose:
{"summary": "<=2 sentences explaining the flow", "spof": ["single points of failure, short"], "missing": [{"kind":"auth|encryption|backup|other","text":"short"}], "stride": [{"cat":"S|T|R|I|D|E","text":"short threat","severity":"High|Med|Low"}]}
Be specific to the nodes in the diagram. At most 5 items per list.`;
      const raw = await chat(ai, sys, b.dsl, 1400);
      const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
      let review: unknown;
      try { review = JSON.parse(json); } catch { return c.json({ error: "Couldn't read the review. Try again." }, 502); }
      return c.json({ review, neurons: neurons(b.dsl.length + sys.length, raw.length) });
    } catch (e) { const m = mapError(e); return c.json({ error: m.error, code: m.code }, m.status); }
  });
}
