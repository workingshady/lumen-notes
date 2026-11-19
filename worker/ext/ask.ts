import type { Hono } from "hono";
import type { Env, Helpers } from "../index";

/**
 * "Ask your vault": answer a question grounded ONLY in excerpts the client retrieved from the owner's notes.
 * Retrieval runs on the device (src/lib/ask.ts); the Worker only sees the question + the numbered excerpts.
 * POST /api/ai/ask {question, sources:[{n,title,heading?,text}], stream?} →text/event-stream (Workers AI SSE:
 * `data: {"response":"…"}` … `data: [DONE]`), or JSON {text} when streaming isn't available.
 */
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_SOURCES = 12;
const MAX_CHARS = 16_000; // all excerpts together (~4k tokens)

export const ASK_PROMPT = [
  "You answer questions about the user's own study notes. You are given numbered excerpts from those notes.",
  "Rules:",
  "1. Use ONLY the excerpts. Do not add facts, formulas, names or numbers that are not in them, even if you know them.",
  "2. Cite every sentence that uses an excerpt with its number in square brackets right after the claim, like [1] or [2][3]. Only cite numbers that exist.",
  "3. If the excerpts say anything relevant to the question, answer from them, even briefly. Only when NOTHING in them is relevant, reply \"Not in your notes.\" (in Arabic: \"ليس في ملاحظاتك.\") and name in one sentence what the excerpts do cover, with citations. If they answer only part of the question, answer that part, then say which part is not in your notes.",
  "4. Write the whole answer in the language named at the end of the user message. Keep technical terms as written in the notes.",
  "5. Be concise: short Markdown paragraphs or bullets. Keep LaTeX math as $…$ when the excerpts have formulas. No preamble, no closing summary, no list of sources (the app shows them).",
].join("\n");

interface Source { n: number; title: string; heading?: string; text: string }

export default function register(api: Hono<Env>, h: Helpers) {
  api.post("/ai/ask", h.auth, async (c) => {
    if (!c.env.AI) return c.json({ error: "AI isn't enabled on the server." }, 501);
    // Same off-switch as /api/ai (Settings › AI): "all" or the "ask" action.
    const r = await c.env.DB.prepare("SELECT data FROM items WHERE kind = 'space' AND id = 'inbox'").first<{ data: string }>().catch(() => null);
    const off = String((r ? (JSON.parse(r.data) as { props?: Record<string, string> }).props?.aiOff : "") ?? "").split(",").filter(Boolean);
    if (off.includes("all") || off.includes("ask")) return c.json({ error: "This AI action is turned off in Settings › AI." }, 403);

    const body = await c.req.json<{ question?: string; sources?: Source[]; stream?: boolean }>().catch(() => ({} as { question?: string; sources?: Source[]; stream?: boolean }));
    const question = String(body.question ?? "").trim().slice(0, 1000);
    const sources = (Array.isArray(body.sources) ? body.sources : []).slice(0, MAX_SOURCES);
    if (!question) return c.json({ error: "Bad request" }, 400);

    let budget = MAX_CHARS;
    const blocks: string[] = [];
    for (const s of sources) {
      const head = `[${Number(s.n) || blocks.length + 1}] ${String(s.title ?? "").slice(0, 160)}${s.heading ? " › " + String(s.heading).slice(0, 120) : ""}`;
      const text = String(s.text ?? "").slice(0, Math.max(0, budget));
      if (!text.trim()) continue;
      budget -= text.length;
      blocks.push(`${head}\n${text}`);
      if (budget <= 0) break;
    }
    // Small models drift into the other language when the prompt mentions both, so the language is stated explicitly.
    const lang = /\p{Script=Arabic}/u.test(question) ? "Arabic" : "English";
    const user = (blocks.length
      ? `Excerpts from my notes:\n\n${blocks.join("\n\n---\n\n")}\n\n===\nQuestion: ${question}`
      : `There are no excerpts (nothing in my notes matched).\n\nQuestion: ${question}`) + `\n\n(Answer in ${lang}.)`;
    const input = { messages: [{ role: "system", content: ASK_PROMPT }, { role: "user", content: user }], max_tokens: 1100, temperature: 0.2 };

    try {
      if (body.stream !== false) {
        const stream = (await c.env.AI.run(MODEL as never, { ...input, stream: true } as never)) as unknown;
        if (stream instanceof ReadableStream) {
          return new Response(stream as ReadableStream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform" } });
        }
      }
      const out = (await c.env.AI.run(MODEL as never, input as never)) as { response?: string };
      return c.json({ text: (out.response ?? "").trim() });
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      return c.json({ error: /limit|quota|429|capacity/i.test(msg) ? "Daily free AI limit reached. Try tomorrow." : "AI request failed." }, 502);
    }
  });
}
