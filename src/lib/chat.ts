// Ask as a multi-turn chat: the pure logic (no app state, no I/O) so it can be unit-tested (scripts/chat.test.ts).
// Runtime (store, retrieval, network, Dexie) lives in src/lib/ask.ts; prompts in worker/ext/chat.ts.
// Formats + flows: docs/CHAT_AND_TUTOR.md.
import type { ChatMessage, ChatMode, ChatScope, ChatSource, ChatThread } from "../../shared/types";

// ------------------------------------------------------------------ UI strings (one place, for the t() pass later)
export const CHAT_STR = {
  newChat: "New chat",
  threads: "Chats",
  pinned: "Pinned",
  recent: "Recent",
  noThreads: "Conversations you start show here.",
  placeholder: "Ask your notes…",
  placeholderFollow: "Ask a follow-up…",
  send: "Send",
  stop: "Stop",
  searchedFor: "Searched for:",
  contextLine: (turns: number, passages: number) => `Using the last ${turns} turn${turns === 1 ? "" : "s"} · ${passages} passage${passages === 1 ? "" : "s"}`,
  summarizedLine: "Earlier messages summarized",
  readingNotes: (n: number, scope: string) => `Reading ${n} note${n === 1 ? "" : "s"} in ${scope}…`,
  answering: (n: number, scope: string) => `Answering from ${n} passage${n === 1 ? "" : "s"} in ${scope}…`,
  notInNotes: "Not in your notes.",
  notInNotesAr: "ليس في ملاحظاتك.",
  notInNotesSub: "Nothing in your notes answers this. Ask never guesses on its own.",
  answerGeneral: "Answer from general knowledge",
  generalLabel: "General knowledge · not from your notes",
  offline: "Ask needs a connection.",
  offlineSub: "Search still works offline. The closest passages from your notes are below.",
  signedOut: "Ask needs sync: unlock it in Settings › Sync.",
  errorRetry: "Retry",
  copy: "Copy",
  copied: "Copied",
  saveNote: "Save as note",
  makeCards: "Make flashcards",
  makingCards: "Making cards…",
  regenerate: "Regenerate",
  helpful: "Helpful",
  notHelpful: "Not helpful",
  sources: (n: number) => `${n} source${n === 1 ? "" : "s"}`,
  followups: "Follow-ups",
  starters: "Try",
  rename: "Rename",
  pin: "Pin",
  unpin: "Unpin",
  delete: "Delete",
  deleteConfirm: "Delete this conversation?",
  close: "Close",
  modeAsk: "Ask",
  modeTutor: "Tutor",
  savedNote: "Saved as a note",
  privacy: "Passages are found on this device; only the ones listed as sources are sent to your Cloudflare Worker.",
} as const;

export const MODE_LABEL: Record<ChatMode, string> = { ask: "Ask", explain: "Explain", socratic: "Socratic", feynman: "Feynman" };

// ------------------------------------------------------------------ limits
/** Turns (question + answer) passed to the model verbatim; older ones go through the running summary. */
export const WINDOW_TURNS = 4;
/** Turns the follow-up rewrite looks at. */
export const REWRITE_TURNS = 4;
/** Messages stored per thread (oldest are dropped once summarized). */
export const MAX_MESSAGES = 40;
export const MAX_MSG_CHARS = 6000;
export const MAX_SOURCE_CHARS = 500;
export const MAX_SOURCES_KEPT = 10;
export const MAX_SUMMARY_CHARS = 1800;
/** Summarize once this many messages sit before the window without being covered by the summary. */
export const SUMMARY_BATCH = 4;
/** Threads kept locally before old unpinned ones are tombstoned. */
export const MAX_THREADS = 200;

// ------------------------------------------------------------------ follow-up detection
const CASUAL = /^\s*(thanks?( you)?|thank u|thx|ty|ok(ay)?|k|cool|great|nice|perfect|awesome|got it|makes sense|i see|sure|yes|no|yep|nope|hi|hello|hey|bye|good( job)?|شكرا|شكرًا|تمام|حسنا|حسنًا|ممتاز|مرحبا|أهلا|نعم|لا)\s*[!.?،]*\s*$/i;
/** Small talk ("thanks", "ok", "hi"): no retrieval, no rewrite. */
export const isCasual = (text: string) => CASUAL.test(text) || text.trim().replace(/[^\p{L}\p{N}]/gu, "").length < 2;

// Pronouns / connectives that point back to earlier turns ("And how does that compare to Adam?").
const CUE_EN = /\b(it|its|it's|that|this|these|those|they|them|their|he|she|his|her|one|ones|the other|same|above|previous|earlier|former|latter|also|too|instead|again|more|else|then|compare[ds]?|versus|vs\.?|difference|why|how come|what about|how about|and|but|so)\b/i;
const CUE_AR = /(^|\s)(هذا|هذه|ذلك|تلك|هو|هي|هم|هما|نفس|أيضا|أيضًا|كذلك|ماذا عن|وماذا|لماذا|و|لكن|مقارنة|الفرق)(\s|$)/;
const words = (s: string) => s.split(/[^\p{L}\p{N}_+-]+/u).filter(Boolean);

/**
 * Rewrite a turn into a standalone query? Only when there are earlier turns, the turn isn't small talk, and it either
 * points back (pronoun / connective cue) or is short (≤ 8 words, e.g. "and for CNNs?"). Long self-contained questions skip
 * the extra AI call.
 */
export function needsRewrite(text: string, history: Pick<ChatMessage, "role" | "text">[]): boolean {
  if (!history.some((m) => m.role === "user")) return false;
  if (isCasual(text)) return false;
  return CUE_EN.test(text) || CUE_AR.test(text) || words(text).length <= 8;
}

// ------------------------------------------------------------------ history window + summary
export interface Turn { role: "user" | "assistant"; text: string }
/** Strip citation markers + clamp, for history sent to the model. */
export const plainTurn = (m: Pick<ChatMessage, "role" | "text">, max = 1200): Turn => ({ role: m.role, text: m.text.replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g, "").replace(/\s+\n/g, "\n").trim().slice(0, max) });

/** Messages that count as conversation (tutor cards like hints are kept; empty "not in notes" answers are skipped). */
const talk = (ms: ChatMessage[]) => ms.filter((m) => m.text.trim() && m.empty !== "none");

/**
 * What the model gets: the last `turns` turns verbatim (oldest first) + the running summary of everything before.
 * `pending` = messages before the window that the summary doesn't cover yet (summarize them when ≥ SUMMARY_BATCH).
 */
export function windowHistory(t: Pick<ChatThread, "messages" | "summary" | "summarized">, turns = WINDOW_TURNS) {
  const ms = t.messages;
  // window start = index of the turns-th last user message
  let start = ms.length, seen = 0;
  for (let i = ms.length - 1; i >= 0; i--) if (ms[i].role === "user" && ++seen === turns) { start = i; break; }
  if (seen < turns) start = 0;
  const covered = Math.min(t.summarized ?? 0, ms.length);
  const from = Math.max(start, covered);
  const recent = talk(ms.slice(from)).map((m) => plainTurn(m));
  const pending = ms.slice(covered, start);
  return { recent, summary: t.summary?.trim() || "", pending, windowStart: from, usedTurns: recent.filter((m) => m.role === "user").length };
}
export const needsSummary = (t: Pick<ChatThread, "messages" | "summary" | "summarized">, turns = WINDOW_TURNS) => windowHistory(t, turns).pending.length >= SUMMARY_BATCH;

/** Local fallback summary (no AI): the questions asked, one line each. */
export function localSummary(prev: string, ms: Pick<ChatMessage, "role" | "text">[]) {
  const qs = ms.filter((m) => m.role === "user").map((m) => "- " + m.text.replace(/\s+/g, " ").trim().slice(0, 140));
  return clampSummary([prev.trim(), qs.length ? `Earlier questions:\n${qs.join("\n")}` : ""].filter(Boolean).join("\n"));
}
export const clampSummary = (s: string) => (s.length <= MAX_SUMMARY_CHARS ? s : "…" + s.slice(s.length - MAX_SUMMARY_CHARS + 1));

// ------------------------------------------------------------------ thread size caps
/** Trim one message for storage: text, sources (≤ 10, passages ≤ 500 chars). */
export function compactMessage(m: ChatMessage): ChatMessage {
  const out: ChatMessage = { ...m, text: m.text.slice(0, MAX_MSG_CHARS) };
  if (m.sources) out.sources = m.sources.slice(0, MAX_SOURCES_KEPT).map((s) => ({ ...s, text: s.text.slice(0, MAX_SOURCE_CHARS) }));
  if (m.followups) out.followups = m.followups.slice(0, 3);
  return out;
}

/**
 * Keep a thread small: at most MAX_MESSAGES messages. Dropped messages must be covered by the summary; any that
 * aren't are folded in with the local (question-list) summary first.
 */
export function capThread<T extends Pick<ChatThread, "messages" | "summary" | "summarized">>(t: T, max = MAX_MESSAGES): T {
  const ms = t.messages.map(compactMessage);
  if (ms.length <= max) return { ...t, messages: ms };
  let drop = ms.length - max;
  // never split a turn: drop up to (not including) the next user message
  while (drop < ms.length && ms[drop].role !== "user") drop++;
  const covered = t.summarized ?? 0;
  let summary = t.summary ?? "";
  if (drop > covered) summary = localSummary(summary, ms.slice(covered, drop));
  return { ...t, messages: ms.slice(drop), summary: clampSummary(summary), summarized: Math.max(0, Math.max(covered, drop) - drop) };
}

/** Threads beyond MAX_THREADS (oldest unpinned first) to tombstone. */
export function threadsToPrune(ts: Pick<ChatThread, "id" | "pinned" | "updatedAt" | "deleted">[], max = MAX_THREADS): string[] {
  const live = ts.filter((t) => !t.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
  if (live.length <= max) return [];
  return live.slice(max).filter((t) => !t.pinned).map((t) => t.id);
}

// ------------------------------------------------------------------ retrieval merge
/**
 * Merge the passages found for the raw turn and for its rewrite (reciprocal-rank fusion, k = 60): a passage found by
 * both ranks first; then renumber 1…n for citations.
 */
export function mergeRanked<T extends { id: string; n: number }>(lists: T[][], top = 8): T[] {
  const score = new Map<string, { item: T; s: number; first: number }>();
  lists.forEach((list, li) => list.forEach((item, rank) => {
    const e = score.get(item.id);
    const add = 1 / (60 + rank);
    if (e) e.s += add; else score.set(item.id, { item, s: add, first: li * 1000 + rank });
  }));
  return [...score.values()].sort((a, b) => b.s - a.s || a.first - b.first).slice(0, top).map((e, i) => ({ ...e.item, n: i + 1 }));
}

// ------------------------------------------------------------------ titles, follow-ups, answers
/** Thread title from the first question: first sentence, ≤ 60 chars at a word boundary. */
export function autoTitle(q: string) {
  const s = q.replace(/\s+/g, " ").trim().split(/(?<=[.?!؟])\s/)[0].replace(/[#[\]|]/g, "");
  if (s.length <= 60) return s || "New chat";
  const cut = s.slice(0, 60);
  return (cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)) || cut).replace(/[\s,;:–-]+$/, "") + "…";
}

/** The model's follow-up list → up to 3 short questions. */
export function parseFollowups(raw: string): string[] {
  return raw.split(/\n+/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/^["“]|["”]$/g, "").trim())
    .filter((l) => l.length >= 6 && l.length <= 140 && !/^(here|sure|follow-?up)/i.test(l)).slice(0, 3);
}

export const NOT_IN_NOTES = /^\s*(\*\*)?(not in your notes|ليس في ملاحظاتك)[.!]?(\*\*)?\s*$/i;
export const isNotInNotes = (s: string) => NOT_IN_NOTES.test(s);

/** Citation numbers an answer uses. */
export const citedIn = (answer: string) => new Set([...answer.matchAll(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g)].flatMap((m) => m[1].split(",").map((x) => Number(x.trim()))));

const linkTitle = (t: string) => t.replace(/[[\]|#]/g, " ").trim();
/** Answer Markdown with citations as [[Note|n]] links + a Sources list (Copy / Save as note). */
export function answerMarkdown(m: Pick<ChatMessage, "text" | "sources" | "general">) {
  const by = new Map((m.sources ?? []).map((s) => [s.n, s]));
  const body = m.text.replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g, (all, list: string) => {
    const links = list.split(",").map((x) => by.get(Number(x.trim()))).filter((s): s is ChatSource => !!s);
    return links.length ? links.map((s) => `[[${linkTitle(s.title)}|${s.n}]]`).join("") : all;
  });
  if (m.general) return `${body.trim()}\n\n*General knowledge, not from your notes.*\n`;
  const used = citedIn(m.text);
  const srcs = (m.sources ?? []).filter((s) => used.has(s.n));
  const list = srcs.length ? srcs : m.sources ?? [];
  return list.length ? `${body.trim()}\n\n**Sources**\n${list.map((s) => `${s.n}. [[${linkTitle(s.title)}]]${s.heading ? ` › ${s.heading}` : ""}`).join("\n")}\n` : body.trim() + "\n";
}

/** The whole conversation as Markdown (Save thread as note). */
export function threadMarkdown(t: Pick<ChatThread, "title" | "messages">) {
  const parts = t.messages.filter((m) => m.text.trim()).map((m) => (m.role === "user" ? `> [!question] ${m.text.replace(/\n/g, " ")}` : answerMarkdown(m)));
  return `# ${t.title.replace(/[#[\]|]/g, "")}\n\n${parts.join("\n\n")}\n`;
}

/** Starter questions for an empty thread from the current note / path (titles, headings). */
export function starterQuestions(ctx: { noteTitle?: string; headings?: string[]; concepts?: string[] }): string[] {
  const out: string[] = [];
  const h = (ctx.headings ?? []).filter((x) => x.length > 2 && x.length < 60);
  if (ctx.noteTitle) out.push(`Summarize the key ideas of ${ctx.noteTitle}`);
  if (h[0]) out.push(`Explain ${h[0]} in simple terms`);
  if (h[1] && ctx.noteTitle) out.push(`How does ${h[1]} relate to ${h[0] ?? ctx.noteTitle}?`);
  for (const c of ctx.concepts ?? []) { if (out.length >= 3) break; out.push(`What is ${c} and why does it matter?`); }
  const fallback = ["What did I learn this week?", "Explain the main idea of my latest lesson", "اشرح أهم فكرة في ملاحظاتي الأخيرة"];
  for (const f of fallback) { if (out.length >= 3) break; out.push(f); }
  return out.slice(0, 3);
}

export const scopeKey = (s: ChatScope) => `${s.kind}:${s.spaceId ?? s.noteId ?? s.pathId ?? ""}`;

// ------------------------------------------------------------------ dev-simulator mock (demo mode, AI = mock)
const topic = (q: string) => words(q).filter((w) => w.length > 3 && !/^(what|which|does|explain|about|with|from|that|this|these|those|compare|using|notes?|how|why|and)$/i.test(w)).slice(0, 4).join(" ");
/** Standalone rewrite: keep the follow-up's own words + the topic of the previous question. */
export function mockRewrite(question: string, history: Turn[]) {
  const prev = [...history].reverse().find((m) => m.role === "user")?.text ?? "";
  const t = topic(prev), own = topic(question);
  return [own || question.replace(/[?؟]+$/, ""), t && !own.toLowerCase().includes(t.toLowerCase()) ? t : ""].filter(Boolean).join(" · ").slice(0, 160);
}
export function mockAnswer(question: string, sources: Pick<ChatSource, "n" | "title">[], general: boolean, history: Turn[]) {
  if (general) return `**Mock answer (simulator, general knowledge).** In general terms, ${topic(question) || "this"} is usually explained like this: a short overview, one example, one caveat.\n\n- Overview in one line\n- Example\n- Caveat`;
  if (!sources.length) return "Not in your notes.";
  const c = (i: number) => (sources[i] ? `[${sources[i].n}]` : "");
  const follow = history.some((m) => m.role === "user") ? ` Following up on what we discussed, ` : " ";
  return `**Mock answer (simulator).**${follow}your notes describe ${topic(question) || "this"} in ${sources.length} place${sources.length === 1 ? "" : "s"} ${c(0)}.${sources[1] ? ` ${sources[1].title} adds detail ${c(1)}${c(2)}.` : ""}\n\n- First point from your notes ${c(0)}\n- Second point ${c(1) || c(0)}`;
}
export function mockFollowups(question: string) {
  const t = topic(question) || "this";
  return [`How is ${t} used in practice?`, `What are common mistakes with ${t}?`, `Compare ${t} with a related idea`].join("\n");
}
