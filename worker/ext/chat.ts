import type { Hono } from "hono";
import type { Env, Helpers } from "../index";
import { ASK_PROMPT } from "./ask";

/**
 * Ask as a multi-turn chat (client: src/lib/ask.ts, pure logic src/lib/chat.ts, docs/CHAT_AND_TUTOR.md).
 * Retrieval still runs on the device; the Worker sees the turn, its standalone rewrite, a short history window,
 * a running summary of older turns and the numbered excerpts.
 *
 * POST /api/ai/chat {op, …}
 *   op "rewrite"   {question, history}                 → {text} standalone search query (small model)
 *   op "answer"    {question, rewrite?, history, summary?, sources, general?, stream?} → SSE stream (or {text})
 *   op "followups" {question, answer}                  → {text} three follow-up questions, one per line (small model)
 *   op "summarize" {summary?, history}                 → {text} updated running summary (small model)
 * Off-switch: Settings › AI "all", "ask" or "chat".
 */
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const SMALL = "@cf/meta/llama-3.1-8b-instruct-fast";
const MAX_SOURCES = 12;
const MAX_CHARS = 16_000;
const MAX_TURN = 1500;

export const REWRITE_PROMPT = [
  "You rewrite the user's latest message into ONE standalone search query for their personal study notes.",
  "Use the conversation only to resolve pronouns and references (it, that, the other one, and for X?).",
  "Keep the user's technical terms and language (Arabic stays Arabic, English stays English; mixed is fine).",
  "Output ONLY the query: no quotes, no explanation, at most 20 words. If the message is already standalone, repeat it unchanged.",
].join("\n");

export const CHAT_PROMPT = ASK_PROMPT + "\n" + [
  "6. This is a conversation. Earlier turns (and a summary of older ones) are given for context only: use them to understand what the user means, but cite and state facts ONLY from the numbered excerpts of this turn.",
  "7. If the user's message is small talk (thanks, ok), reply in one short sentence without citations.",
].join("\n");

export const GENERAL_PROMPT = [
  "The user's own notes do not cover this question and the user explicitly asked for an answer from general knowledge.",
  "Answer helpfully and accurately from general knowledge, concisely (short Markdown paragraphs or bullets, LaTeX as $…$).",
  "Do NOT use citation numbers like [1]: nothing here comes from the user's notes. If you are unsure, say so.",
  "Write in the language named at the end of the user message.",
].join("\n");

export const FOLLOWUP_PROMPT = [
  "Suggest exactly 3 short follow-up questions the learner could ask next about this answer, to deepen understanding.",
  "One per line, no numbering, no quotes, each under 12 words, in the same language as the question.",
].join("\n");

export const SUMMARY_PROMPT = [
  "You keep a running summary of a study conversation so it can continue without the full history.",
  "Merge the previous summary with the new turns. Keep: the topics asked about, key facts and conclusions reached, open questions, and what 'it/that' referred to.",
  "At most 120 words, plain bullet points, same language as the conversation. Output only the summary.",
].join("\n");

interface Source { n: number; title: string; heading?: string; text: string }
interface Turn { role: "user" | "assistant"; text: string }
interface Body { op?: string; question?: string; rewrite?: string; history?: Turn[]; summary?: string; sources?: Source[]; general?: boolean; answer?: string; stream?: boolean }

const clean = (h: unknown): Turn[] => (Array.isArray(h) ? h : []).slice(-12)
  .map((m) => m as Turn).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
  .map((m) => ({ role: m.role, text: m.text.slice(0, MAX_TURN) }));
const langOf = (q: string) => (/\p{Script=Arabic}/u.test(q) ? "Arabic" : "English");

export async function aiOff(c: { env: Env["Bindings"] }, ...names: string[]) {
  const r = await c.env.DB.prepare("SELECT data FROM items WHERE kind = 'space' AND id = 'inbox'").first<{ data: string }>().catch(() => null);
  const off = String((r ? (JSON.parse(r.data) as { props?: Record<string, string> }).props?.aiOff : "") ?? "").split(",").filter(Boolean);
  return off.includes("all") || names.some((n) => off.includes(n));
}
export const aiError = (e: unknown) => { const msg = String((e as Error)?.message ?? e); return /limit|quota|429|capacity/i.test(msg) ? "Daily free AI limit reached. Try tomorrow." : "AI request failed."; };

/** Run a small, cheap model; fall back to the main one if it isn't available on this account. */
async function small(ai: Ai, messages: { role: string; content: string }[], max_tokens: number) {
  for (const m of [SMALL, MODEL]) {
    try {
      const out = (await ai.run(m as never, { messages, max_tokens, temperature: 0.2 } as never)) as { response?: unknown };
      return (typeof out.response === "string" ? out.response : JSON.stringify(out.response ?? "")).trim();
    } catch (e) { if (m === MODEL) throw e; }
  }
  return "";
}

export default function register(api: Hono<Env>, h: Helpers) {
  api.post("/ai/chat", h.auth, async (c) => {
    if (!c.env.AI) return c.json({ error: "AI isn't enabled on the server." }, 501);
    if (await aiOff(c, "ask", "chat")) return c.json({ error: "This AI action is turned off in Settings › AI." }, 403);
    const b = await c.req.json<Body>().catch(() => ({} as Body));
    const question = String(b.question ?? "").trim().slice(0, 1000);
    const history = clean(b.history);
    const convo = history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n\n");
    try {
      if (b.op === "rewrite") {
        if (!question) return c.json({ error: "Bad request" }, 400);
        const text = await small(c.env.AI, [{ role: "system", content: REWRITE_PROMPT }, { role: "user", content: `Conversation:\n${convo}\n\nLatest message: ${question}\n\nStandalone query:` }], 60);
        return c.json({ text: text.split("\n")[0].replace(/^["“']|["”']$/g, "").slice(0, 200) || question });
      }
      if (b.op === "followups") {
        const text = await small(c.env.AI, [{ role: "system", content: FOLLOWUP_PROMPT }, { role: "user", content: `Question: ${question}\n\nAnswer: ${String(b.answer ?? "").slice(0, 3000)}` }], 120);
        return c.json({ text });
      }
      if (b.op === "summarize") {
        const text = await small(c.env.AI, [{ role: "system", content: SUMMARY_PROMPT }, { role: "user", content: `Previous summary:\n${String(b.summary ?? "").slice(0, 2000) || "(none)"}\n\nNew turns:\n${convo}` }], 260);
        return c.json({ text });
      }
      if (b.op !== "answer" || !question) return c.json({ error: "Bad request" }, 400);

      const lang = langOf(question);
      const past = [
        b.summary ? `Summary of earlier conversation:\n${String(b.summary).slice(0, 2000)}` : "",
        convo ? `Recent conversation:\n${convo}` : "",
      ].filter(Boolean).join("\n\n");
      let system: string, user: string;
      if (b.general) {
        system = GENERAL_PROMPT;
        user = `${past ? past + "\n\n===\n" : ""}Question: ${question}\n\n(Answer in ${lang}.)`;
      } else {
        let budget = MAX_CHARS;
        const blocks: string[] = [];
        for (const s of (Array.isArray(b.sources) ? b.sources : []).slice(0, MAX_SOURCES)) {
          const head = `[${Number(s.n) || blocks.length + 1}] ${String(s.title ?? "").slice(0, 160)}${s.heading ? " › " + String(s.heading).slice(0, 120) : ""}`;
          const text = String(s.text ?? "").slice(0, Math.max(0, budget));
          if (!text.trim()) continue;
          budget -= text.length;
          blocks.push(`${head}\n${text}`);
          if (budget <= 0) break;
        }
        system = CHAT_PROMPT;
        const rw = b.rewrite && b.rewrite.trim() && b.rewrite.trim() !== question ? `\n(In context this means: ${String(b.rewrite).slice(0, 300)})` : "";
        user = `${past ? past + "\n\n===\n" : ""}${blocks.length ? `Excerpts from my notes for this turn:\n\n${blocks.join("\n\n---\n\n")}` : "There are no excerpts for this turn (nothing in my notes matched)."}\n\n===\nQuestion: ${question}${rw}\n\n(Answer in ${lang}.)`;
      }
      const input = { messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: 1100, temperature: b.general ? 0.4 : 0.2 };
      if (b.stream !== false) {
        const stream = (await c.env.AI.run(MODEL as never, { ...input, stream: true } as never)) as unknown;
        if (stream instanceof ReadableStream) return new Response(stream as ReadableStream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform" } });
      }
      const out = (await c.env.AI.run(MODEL as never, input as never)) as { response?: string };
      return c.json({ text: (out.response ?? "").trim() });
    } catch (e) {
      return c.json({ error: aiError(e) }, 502);
    }
  });
}
