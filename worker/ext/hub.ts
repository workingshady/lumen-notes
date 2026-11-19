import type { Hono } from "hono";
import type { Env, Helpers } from "../index";

/**
 * Project hub › Assistant › "Ask": a free question about one project, answered only from the project context the
 * client sends (goal, deadline, docs, task cards, requirements — built in src/views/hub-assistant.tsx).
 * POST /api/ai/project {question, context} → {text}. Same AI off-switch as /api/ai ("all" or "project").
 */
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const PROMPT = [
  "You are the assistant of one software project. You get the project's goal, deadline, docs, task cards and requirements.",
  "Answer the question using ONLY that context. Be concrete: name tasks, requirement ids (REQ-n), docs and dates from the context.",
  "When you propose tasks, write them as Markdown task lines like `- [ ] Task ~2d !p2 #epic/name REQ-n`.",
  "If the context doesn't contain the answer, say so in one sentence. Short Markdown; no preamble.",
].join("\n");

export default function register(api: Hono<Env>, h: Helpers) {
  api.post("/ai/project", h.auth, async (c) => {
    if (!c.env.AI) return c.json({ error: "AI isn't enabled on the server." }, 501);
    const r = await c.env.DB.prepare("SELECT data FROM items WHERE kind = 'space' AND id = 'inbox'").first<{ data: string }>().catch(() => null);
    const off = String((r ? (JSON.parse(r.data) as { props?: Record<string, string> }).props?.aiOff : "") ?? "").split(",").filter(Boolean);
    if (off.includes("all") || off.includes("project")) return c.json({ error: "This AI action is turned off in Settings › AI." }, 403);
    const body = await c.req.json<{ question?: string; context?: string }>().catch(() => ({} as { question?: string; context?: string }));
    const question = String(body.question ?? "").trim().slice(0, 1000);
    const context = String(body.context ?? "").slice(0, 22_000);
    if (!question) return c.json({ error: "Bad request" }, 400);
    try {
      const out = (await c.env.AI.run(MODEL as never, {
        messages: [{ role: "system", content: PROMPT }, { role: "user", content: `${context}\n\n===\nQuestion: ${question}` }], max_tokens: 1100, temperature: 0.2,
      } as never)) as { response?: string };
      return c.json({ text: (out.response ?? "").trim() });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      return c.json({ error: /limit|quota|429|capacity/i.test(msg) ? "Daily free AI limit reached. Try tomorrow." : "AI request failed." }, 502);
    }
  });
}
