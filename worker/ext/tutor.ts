import type { Hono } from "hono";
import type { Env, Helpers } from "../index";
import { aiError, aiOff } from "./chat";

/**
 * AI tutor (client: src/components/TutorSession.tsx, pure logic src/lib/tutor.ts, docs/CHAT_AND_TUTOR.md).
 * Grounded in the concept's notes (numbered excerpts the tutor cites as [n]). Every op answers ONE JSON object.
 *
 * POST /api/ai/tutor {op, concept, sources:[{n,title,text}], input?, history?, extra?} → {text} (the JSON as text)
 *   plan      Explain: 3–5 short steps + a 3-question check
 *   rephrase  Explain: the current step again, differently (extra.how = "differently") or as an example ("example")
 *   grade     a free answer vs the expected answer (extra.question, extra.expected) → verdict + feedback
 *   socratic  next guiding question (+ 2 hints + answer); with `input`, first grades the reply to the current question
 *   feynman   review the learner's own explanation: clarity score, reasons, quoted gaps / wrong statements / jargon
 *   ask       Explain: the learner's question about the current step (input, extra.step) → {text}
 *   summary   end of session: what was right, gaps, 3–5 flashcards
 * Off-switch: Settings › AI "all" or "tutor".
 */
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const BASE = [
  "You are a patient, rigorous tutor teaching ONE concept to a learner, using THEIR OWN course notes as the source.",
  "The notes are numbered excerpts. Ground every factual statement in them and cite with the number in square brackets, like [1] or [2][3].",
  "If the notes don't cover something you need, you may use general knowledge but mark that sentence with (general) instead of a citation.",
  "Use $…$ LaTeX for math. Write in the language named at the end of the user message; keep technical terms as written in the notes.",
  "Output ONLY one JSON object, no prose before or after, no code fence.",
].join("\n");

export const TUTOR_PROMPTS: Record<string, string> = {
  plan: `${BASE}
Teach the concept step by step. Output: {"steps":[{"title":"…","text":"…"}, …],"check":[{"q":"…","answer":"…"}, …]}
- 3 to 5 steps, from intuition to mechanics to why it matters. Each step's "text" is 40–110 words of Markdown, one idea only, with citations.
- "check": exactly 3 questions that test understanding (not trivia), each with the expected short "answer" (one or two sentences).`,
  rephrase: `${BASE}
The learner didn't get one step. Re-teach the SAME idea. If asked for "example", give one small concrete worked example; if "differently", use a new analogy or angle and simpler words.
Output: {"title":"…","text":"…"} (text 40–120 words of Markdown, with citations).`,
  grade: `${BASE}
Grade the learner's answer against the expected answer. Accept correct answers in other words; ignore spelling.
Output: {"verdict":"correct"|"partly"|"not_yet","feedback":"…"} where feedback is 1–2 sentences: what was right, and what's missing or wrong (with a citation).`,
  socratic: `${BASE}
Teach by asking guiding questions. NEVER give the answer straight away: each question should lead the learner one step closer to understanding the concept.
If the learner's reply to the current question is given, first grade it: "verdict" = "correct" | "partly" | "not_yet", "feedback" = one encouraging sentence (no answer reveal).
- If correct (or no reply yet): ask the NEXT guiding question.
- If partly / not_yet: set "question" to "" (the learner tries again with hints).
Output: {"verdict":…,"feedback":"…","question":"…","hints":["a small nudge","a bigger nudge"],"answer":"the answer to this new question, with a citation","done":false}
Set "done": true only when the concept has been fully covered.`,
  feynman: `${BASE}
Feynman technique: the learner explains the concept in their own words. Find: gaps (missing key ideas from the notes), wrong statements (contradict the notes), and jargon they used without explaining.
For each issue quote the learner's exact words in "quote" (or the missing idea for a gap) and say what to fix in "comment" (with a citation).
Output: {"score":0-100,"reasons":[{"label":"Accuracy","score":0-100,"note":"…"},{"label":"Completeness","score":0-100,"note":"…"},{"label":"Plain words","score":0-100,"note":"…"},{"label":"Structure","score":0-100,"note":"…"}],"issues":[{"quote":"…","kind":"gap"|"wrong"|"jargon","comment":"…"}],"ask":"one sentence asking them to fix the issues and explain again"}
"score" is the overall clarity score: high only when accurate, complete, in plain words and well ordered. Each "note" is 2–5 words (e.g. "1 wrong claim", "chain rule missing"). Be honest and specific, not gushing.`,
  ask: `${BASE}
The learner is in the middle of a step and asks a question about it. Answer it directly and briefly, grounded in the notes, without moving on to the next step.
Output: {"text":"…"} (30–120 words of Markdown, with citations).`,
  summary: `${BASE}
The tutoring session is over. From the transcript, list what the learner got right and their gaps, and write flashcards for the gaps first.
Output: {"right":["…"],"gaps":["…"],"cards":[{"q":"…","a":"…"}]} with 1–4 items each in right/gaps and 3–5 cards (short question, short answer, no citations).`,
};
const MAX_TOKENS: Record<string, number> = { ask: 450, plan: 1400, rephrase: 400, grade: 250, socratic: 450, feynman: 700, summary: 700 };

interface Source { n: number; title: string; text: string }
interface Body { op?: string; concept?: string; sources?: Source[]; input?: string; history?: { role: string; text: string }[]; extra?: Record<string, unknown> }

export default function register(api: Hono<Env>, h: Helpers) {
  api.post("/ai/tutor", h.auth, async (c) => {
    if (!c.env.AI) return c.json({ error: "AI isn't enabled on the server." }, 501);
    if (await aiOff(c, "tutor")) return c.json({ error: "This AI action is turned off in Settings › AI." }, 403);
    const b = await c.req.json<Body>().catch(() => ({} as Body));
    const op = String(b.op ?? "");
    const system = TUTOR_PROMPTS[op];
    const concept = String(b.concept ?? "").trim().slice(0, 200);
    if (!system || !concept) return c.json({ error: "Bad request" }, 400);

    let budget = 16_000;
    const notes: string[] = [];
    for (const s of (Array.isArray(b.sources) ? b.sources : []).slice(0, 8)) {
      const text = String(s.text ?? "").slice(0, Math.max(0, budget));
      if (!text.trim()) continue;
      budget -= text.length;
      notes.push(`[${Number(s.n) || notes.length + 1}] ${String(s.title ?? "").slice(0, 160)}\n${text}`);
      if (budget <= 0) break;
    }
    const hist = (Array.isArray(b.history) ? b.history : []).slice(-12).map((m) => `${m.role === "user" ? "Learner" : "Tutor"}: ${String(m.text ?? "").slice(0, 1200)}`).join("\n\n");
    const extra = b.extra ?? {};
    const input = String(b.input ?? "").slice(0, 4000);
    const lang = /\p{Script=Arabic}/u.test(input + concept) ? "Arabic" : "English";
    const parts = [
      `Concept: ${concept}`,
      notes.length ? `Notes:\n\n${notes.join("\n\n---\n\n")}` : "Notes: (none linked: use general knowledge and mark it (general))",
      hist ? `Session so far:\n${hist}` : "",
      op === "rephrase" ? `Step to re-teach (${extra.how === "example" ? "example" : "differently"}):\n${String(extra.step ?? "").slice(0, 1500)}` : "",
      op === "grade" ? `Question: ${String(extra.question ?? "").slice(0, 600)}\nExpected answer: ${String(extra.expected ?? "").slice(0, 800)}\nLearner's answer: ${input}` : "",
      op === "socratic" && input ? `Current question: ${String(extra.question ?? "").slice(0, 600)}\nIts answer: ${String(extra.expected ?? "").slice(0, 600)}\nLearner's reply: ${input}` : "",
      op === "feynman" ? `Learner's explanation:\n${input}` : "",
      op === "ask" ? `Current step:\n${String(extra.step ?? "").slice(0, 1500)}\n\nLearner's question: ${input}` : "",
      `(Answer in ${lang}.)`,
    ].filter(Boolean).join("\n\n===\n");

    try {
      const r = (await c.env.AI.run(MODEL as never, { messages: [{ role: "system", content: system }, { role: "user", content: parts }], max_tokens: MAX_TOKENS[op] ?? 600, temperature: 0.3 } as never)) as { response?: unknown };
      const out = typeof r.response === "string" ? r.response : JSON.stringify(r.response ?? "");
      return c.json({ text: out.trim() });
    } catch (e) {
      return c.json({ error: aiError(e) }, 502);
    }
  });
}
