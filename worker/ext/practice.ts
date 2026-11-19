import type { Hono } from "hono";
import type { Env, Helpers } from "../index";

// Concept practice (learning paths): AI-written quizzes from the learner's course notes + AI grading of free answers.
// Client: src/components/ConceptPractice.tsx. Path is under /api/ai/… so the dev simulator's AI modes apply to it.
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const PROMPTS = {
  quiz: `You write practice questions that check whether a learner really understands one concept, using their own course material.
Output ONLY one JSON object, no prose, no code fence:
{"questions":[{"type":"mcq","q":"…","choices":["…","…","…","…"],"answer":0,"why":"…","source":"…"}, …]}
Exactly 5 questions, in this order: 3 of type "mcq" (4 plausible choices, "answer" = index 0-3 of the correct one, vary its position),
1 of type "short" ("answer" = the expected short answer, a few words or one sentence),
1 of type "explain" (asks to explain why/how in their own words; "answer" = the 2-4 key points a good explanation covers).
"why" = one sentence on why the answer is right. "source" = the exact title after "### Note:" that the question comes from, or "general" when the material doesn't cover it.
Test understanding and application, not trivia about the notes. Use $…$ LaTeX for math. Write in the language of the material.`,
  grade: `You grade a learner's free-text answer against the expected answer. Be fair: accept correct answers in other words, ignore spelling.
Output ONLY one JSON object, no prose: {"score":1,"feedback":"…"} where score is 1 (correct), 0.5 (partly right / missing key points) or 0 (wrong),
and feedback is one or two short sentences telling them what was right or missing. Answer in the learner's language.`,
} as const;

export default function register(api: Hono<Env>, h: Helpers) {
  api.post("/ai/practice", h.auth, async (c) => {
    if (!c.env.AI) return c.json({ error: "AI isn't enabled on the server." }, 501);
    // Same off-switch as /api/ai (Settings › AI): "all" or "practice".
    const row = await c.env.DB.prepare("SELECT data FROM items WHERE kind = 'space' AND id = 'inbox'").first<{ data: string }>().catch(() => null);
    const off = String((row ? (JSON.parse(row.data) as { props?: Record<string, string> }).props?.aiOff : "") ?? "").split(",").filter(Boolean);
    if (off.includes("all") || off.includes("practice")) return c.json({ error: "This AI action is turned off in Settings › AI." }, 403);
    const { mode, text } = await c.req.json<{ mode?: string; text?: string }>().catch(() => ({} as { mode?: string; text?: string }));
    const sys = mode === "quiz" || mode === "grade" ? PROMPTS[mode] : null;
    if (!sys || !text?.trim()) return c.json({ error: "Bad request" }, 400);
    try {
      const r = (await c.env.AI.run(MODEL as never, {
        messages: [{ role: "system", content: sys }, { role: "user", content: text.slice(0, 24_000) }],
        max_tokens: mode === "quiz" ? 2000 : 300,
      } as never)) as { response?: unknown };
      const out = typeof r.response === "string" ? r.response : JSON.stringify(r.response ?? "");
      return c.json({ text: out.trim() });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      return c.json({ error: /limit|quota|429|capacity/i.test(msg) ? "Daily free AI limit reached. Try tomorrow." : "AI request failed." }, 502);
    }
  });
}
