import type { Hono } from "hono";
import type { Env, Helpers } from "../index";

/**
 * AI for visuals (round 7 · Lumen 35 review sheet, Lumen 48 architecture AI). Client: src/lib/ai-convert.ts.
 * All routes sit under /api/ai/… so they go through the existing `auth` and the AI usage meter / daily limit
 * (worker/ext/ai-usage.ts, feature bucket "other").
 *
 *  POST /api/ai/visual/convert {image: "data:image/png;base64,…" | base64, kind: text|math|mermaid|shapes-hint}
 *       → {text, spans: [{start,end,alts[]}], kind, model, neurons}
 *  POST /api/ai/visual/arch    {text, source?: describe|code|openapi|compose|k8s|terraform|sql|rfc, type?: architecture|flowchart|sequence|erd|c4}
 *       → {dsl, neurons}
 *  POST /api/ai/visual/edit    {dsl, instruction} → {dsl, neurons}
 *  POST /api/ai/visual/review  {dsl, mode?: review|docs|cards} → {review} | {text}, plus {neurons}
 *
 * Vision: @cf/meta/llama-3.2-11b-vision-instruct first (Cloudflare tutorial format: data-URI string in the top-level
 * `image` field next to `messages`), then @cf/meta/llama-4-scout-17b-16e-instruct (OpenAI-style `image_url` content part).
 * The Llama 3.2 licence must be accepted once per account: on a "not agreed" error we send {prompt:"agree"} and retry.
 * Low confidence: the model is asked to wrap guesses as {{word|alt|alt}}; we strip the markers and return spans.
 */
const VISION = "@cf/meta/llama-3.2-11b-vision-instruct";
const SCOUT = "@cf/meta/llama-4-scout-17b-16e-instruct";
const TEXT = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const TIMEOUT = 50_000;
const MAX_IMAGE = 3_500_000; // chars of base64 (~2.6 MB)

const MARK = "Where you are unsure of a word or symbol, write it as {{best guess|alternative|alternative}} (up to 3 alternatives). Use this only for real doubt.";
const CONVERT: Record<string, string> = {
  text: `Transcribe the handwriting or text in this image exactly. Keep line breaks. Write maths inline as plain Unicode (n₁ sin θ₁). Output only the transcription, no commentary. ${MARK}`,
  math: `Transcribe the mathematics in this image as LaTeX. Output only the LaTeX source, without $ delimiters and without code fences. ${MARK}`,
  mermaid: `Convert the diagram or flow sketched in this image into Mermaid code (flowchart LR unless another type is clearly drawn). Output only the Mermaid source, without code fences. ${MARK}`,
  "shapes-hint": `List the shapes and arrows in this sketch as a Mermaid flowchart so they can be redrawn as clean shapes. Output only the Mermaid source, without code fences. ${MARK}`,
};

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

type AiBinding = { run: (m: string, input: unknown) => Promise<unknown> };

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

const withTimeout = <T,>(p: Promise<T>) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT))]);

const errMsg = (e: unknown) => String((e as Error)?.message ?? e);
const mapError = (e: unknown): { status: 429 | 502 | 504; error: string; code?: string } => {
  const m = errMsg(e);
  if (/timeout|499/i.test(m)) return { status: 504, error: "The AI took too long. Try a smaller selection." };
  if (/limit|quota|capacity|429|3036|4006/i.test(m)) return { status: 429, error: "Daily free AI limit reached. Try tomorrow.", code: "ai_limit" };
  return { status: 502, error: "AI request failed." };
};

async function agree(ai: AiBinding) { try { await ai.run(VISION, { prompt: "agree" }); } catch { /* already agreed or not required */ } }

async function vision(ai: AiBinding, dataUri: string, prompt: string): Promise<{ text: string; model: string }> {
  const messages = [{ role: "user", content: prompt }];
  const attempts: [string, () => Promise<unknown>][] = [
    [VISION, () => ai.run(VISION, { messages, image: dataUri, max_tokens: 1024, temperature: 0.1 })],
    [SCOUT, () => ai.run(SCOUT, { messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUri } }] }], max_tokens: 1024, temperature: 0.1 })],
  ];
  let lastErr: unknown;
  for (const [model, run] of attempts) {
    for (let i = 0; i < 2; i++) {
      try {
        const r = (await withTimeout(run())) as { response?: string; choices?: { message?: { content?: string } }[] };
        const out = (r.response ?? r.choices?.[0]?.message?.content ?? "").toString().trim();
        if (out) return { text: out, model };
        lastErr = new Error("empty");
        break;
      } catch (e) {
        lastErr = e;
        if (model === VISION && i === 0 && /agree|licen[cs]e|5016|terms/i.test(errMsg(e))) { await agree(ai); continue; }
        break;
      }
    }
    if (/limit|quota|429|timeout/i.test(errMsg(lastErr))) break; // retrying another model won't help
  }
  throw lastErr;
}

async function chat(ai: AiBinding, system: string, user: string, max = 1800): Promise<string> {
  const r = (await withTimeout(ai.run(TEXT, { messages: [{ role: "system", content: system }, { role: "user", content: user.slice(0, 24_000) }], max_tokens: max, temperature: 0.2 }))) as { response?: string };
  return (r.response ?? "").trim();
}

/** Neurons estimate (Workers AI doesn't return them): text ~4 chars/token, an image ~1,100 tokens. */
const neurons = (inChars: number, outChars: number, image = false) => Math.max(1, Math.round(((inChars / 4 + (image ? 1100 : 0)) * 4.41 + (outChars / 4) * 6.41) / 1000));

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
