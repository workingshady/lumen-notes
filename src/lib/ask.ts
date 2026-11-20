// Ask as a multi-turn chat + the tutor's network layer: shared store (Ask page / phone sheet / right panel), chat threads
// in Dexie (kind "chat", synced), on-device retrieval with follow-up rewriting, streaming answers, follow-ups, summaries.
// Pure logic: ./chat.ts (tested), tutor logic: ./tutor.ts, prompts: worker/ext/chat.ts + tutor.ts. Docs: docs/CHAT_AND_TUTOR.md.
import { useSyncExternalStore } from "react";
import type { ChatMessage, ChatMode, ChatScope, ChatThread } from "../../shared/types";
import { API_BASE, ApiError, forgetAccount, getAccount, getToken, setToken } from "./api";
import { ensureIndex, retrieve, scopeNotes, type Retrieved, type Scope } from "./ask-retrieve";
import {
  autoTitle, capThread, CHAT_STR, clampSummary, isCasual, isNotInNotes, localSummary, mergeRanked, mockAnswer, mockFollowups, mockRewrite,
  needsRewrite, parseFollowups, plainTurn, REWRITE_TURNS, SUMMARY_BATCH, threadsToPrune, windowHistory, type Turn,
} from "./chat";
import { db, DEMO, save, uid } from "./db";
import { getFaults, simApi } from "./sim/faults";
import { isLimitError } from "./ai-usage";
import { mockTutor } from "./tutor";
import type { Vault } from "./store";

export * from "./ask-retrieve";
export { citedIn as citedNumbers } from "./chat";

// ------------------------------------------------------------------ shared store
/** The answer being produced right now (saved into the thread only when it's done). */
export interface Live {
  threadId: string;
  status: "indexing" | "rewriting" | "asking" | "streaming" | "offline" | "signedout" | "error" | "limit";
  text: string;
  sources: Retrieved[];
  rewrite?: string;
  read?: number;
  total?: number;
  error?: string;
  /** What Retry re-runs. */
  question: string;
  general?: boolean;
  /** Turns of history sent + whether a running summary was sent (context indicator). */
  turns?: number;
  summarized?: boolean;
  /** R8-56 timings (ms since send): index+rewrite done, passages read, first streamed word. */
  t0?: number;
  tIndex?: number;
  tRead?: number;
  tFirst?: number;
  /** Passages kept after retrieval ("Read 4 best matches"). */
  nRead?: number;
}
interface AskState {
  open: boolean;
  draft: string;
  scope: Scope | null;
  /** Thread shown (null = a new, empty chat). */
  activeId: string | null;
  live: Live | null;
  /** Phone: the thread list sheet. */
  list: boolean;
  /** Ask page in Tutor mode without a session: the concept picker. */
  picking: boolean;
  /** Note Assistant (right panel, R6-31): its own thread + answer in progress, scoped to the open note. */
  aActive: string | null;
  aLive: Live | null;
  aDraft: string;
}
let state: AskState = { open: false, draft: "", scope: null, activeId: null, live: null, list: false, picking: false, aActive: null, aLive: null, aDraft: "" };
/** Which conversation a turn belongs to: the Ask page / phone sheet, or the note Assistant. */
export type Slot = "ask" | "assistant";
const ACT = { ask: "activeId", assistant: "aActive" } as const;
const LIVE = { ask: "live", assistant: "aLive" } as const;
const liveOf = (slot: Slot) => state[LIVE[slot]];
const subs = new Set<() => void>();
const set = (p: Partial<AskState>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const useAsk = () => useSyncExternalStore((f) => (subs.add(f), () => { subs.delete(f); }), () => state);
export const getAsk = () => state;
export const setAsk = set;
/** Open the Ask page (palette command). */
export function openAsk(question?: string) { set({ open: true, draft: question ?? state.draft }); }
export const closeAsk = () => set({ open: false, list: false, picking: false });
export const NEEDS_SIGNIN = CHAT_STR.signedOut;

// ------------------------------------------------------------------ AI transport (real Worker, or the simulator's mock)
const isDemoMock = async (path: string) => {
  const sim = await simApi(path, "POST");
  if (sim && "mock" in sim) return true;
  if (sim) { if (sim.status === 401) setToken(null); throw new ApiError(sim.error, sim.status); }
  // Demo without an account: the mock keeps chat + tutor testable (Dev panel › AI = real needs a signed-in Worker).
  return DEMO && !getToken() && getFaults().ai === "real";
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function streamWords(full: string, onDelta: ((t: string) => void) | undefined, signal?: AbortSignal) {
  let out = "";
  for (const w of full.split(/(?<=\s)/)) {
    if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    out += w; onDelta?.(out); await sleep(18);
  }
  return out;
}

/** Tell the usage meter (lib/ai-usage.ts) an AI call happened ("lumen:ai", same event as api()). */
const aiEvent = (path: string, status: number, error?: string) => { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("lumen:ai", { detail: { path, status, error } })); };
/** POST to an /api/ai/* route: JSON {text} or an SSE stream (Workers AI), calling `onDelta` with the text so far. */
async function postAi(path: string, body: unknown, onDelta?: (t: string) => void, signal?: AbortSignal): Promise<string> {
  const headers = new Headers({ "Content-Type": "application/json" });
  const tok = getToken();
  if (tok) headers.set("Authorization", `Bearer ${tok}`);
  let res: Response;
  try { res = await fetch(API_BASE + "/api" + path, { method: "POST", headers, body: JSON.stringify(body), signal }); }
  catch (e) { if ((e as Error).name !== "AbortError") aiEvent(path, 0, (e as Error).message); throw e; }
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    const data = type.includes("json") ? ((await res.json()) as { error?: string }) : { error: await res.text() };
    aiEvent(path, res.status, data?.error);
    if (res.status === 401) { setToken(null); forgetAccount(getAccount()); }
    throw new ApiError(data?.error || `HTTP ${res.status}`, res.status);
  }
  aiEvent(path, res.status);
  if (type.includes("json")) { const t = ((await res.json()) as { text?: string }).text ?? ""; onDelta?.(t); return t; }
  if (!res.body) { const t = await res.text(); onDelta?.(t); return t; }
  const reader = res.body.getReader();
  signal?.addEventListener("abort", () => { void reader.cancel().catch(() => {}); }, { once: true });
  const dec = new TextDecoder();
  let buf = "", out = "";
  for (;;) {
    const { value, done } = await reader.read().catch((e) => { if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" }); throw e; });
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const d = line.slice(5).trim();
      if (!d || d === "[DONE]") continue;
      try {
        const j = JSON.parse(d) as { response?: string; choices?: { delta?: { content?: string } }[] };
        const piece = j.response ?? j.choices?.[0]?.delta?.content ?? "";
        if (piece) { out += piece; onDelta?.(out); }
      } catch { /* partial / keep-alive line */ }
    }
  }
  return out;
}

export interface ChatSourceIn { n: number; title: string; heading?: string; text: string }
type ChatOp =
  | { op: "rewrite"; question: string; history: Turn[] }
  | { op: "followups"; question: string; answer: string }
  | { op: "summarize"; summary?: string; history: Turn[] }
  | { op: "answer"; question: string; rewrite?: string; history: Turn[]; summary?: string; sources: ChatSourceIn[]; general?: boolean };
/** POST /api/ai/chat (worker/ext/chat.ts). */
export async function aiChat(body: ChatOp, onDelta?: (t: string) => void, signal?: AbortSignal): Promise<string> {
  if (await isDemoMock("/ai/chat")) {
    await sleep(body.op === "answer" ? 350 : 200);
    aiEvent("/ai/chat", 200);
    if (body.op === "rewrite") return mockRewrite(body.question, body.history);
    if (body.op === "followups") return mockFollowups(body.question);
    if (body.op === "summarize") return localSummary(body.summary ?? "", body.history);
    return streamWords(mockAnswer(body.question, body.sources, !!body.general, body.history), onDelta, signal);
  }
  return postAi("/ai/chat", body, onDelta, signal);
}
export interface TutorReq { op: string; concept: string; sources: ChatSourceIn[]; input?: string; history?: { role: string; text: string }[]; extra?: Record<string, unknown> }
/** POST /api/ai/tutor (worker/ext/tutor.ts): one JSON object as text. */
export async function aiTutor(body: TutorReq, signal?: AbortSignal): Promise<string> {
  if (await isDemoMock("/ai/tutor")) { await sleep(450); aiEvent("/ai/tutor", 200); return mockTutor(body.op, body); }
  return postAi("/ai/tutor", body, undefined, signal);
}
/** Signed in (or demo) and online. */
export const aiReady = () => (!!getToken() || DEMO) && !(typeof navigator !== "undefined" && navigator.onLine === false);

// ------------------------------------------------------------------ threads
const toScope = (s: Scope): ChatScope => ({ kind: s.kind, ...(s.spaceId ? { spaceId: s.spaceId } : {}), ...(s.noteId ? { noteId: s.noteId } : {}), ...(s.pathId ? { pathId: s.pathId } : {}), ...(s.folderId ? { folderId: s.folderId } : {}), ...(s.tag ? { tag: s.tag } : {}) });
export function newThread(p: Partial<ChatThread> & { title: string; mode: ChatMode; scope: ChatScope }): ChatThread {
  const t = Date.now();
  return { id: uid(), pinned: 0, messages: [], createdAt: t, updatedAt: t, deleted: 0, dirty: 1, ...p };
}
export const msg = (role: ChatMessage["role"], text: string, p: Partial<ChatMessage> = {}): ChatMessage => ({ id: uid(), role, text, at: Date.now(), ...p });

/** Write a thread (capped, marked for sync). */
export async function saveThread(t: ChatThread) { return save("chat", capThread(t)) as Promise<ChatThread>; }

/** A tutor thread opened but not started yet (lives in memory until its first write, so unstarted sessions leave nothing). */
let pendingTutor: ChatThread | null = null;
export const getPendingTutor = () => pendingTutor;

/** Read-modify-write the stored thread (or the pending tutor thread on its first write). */
export async function updateThread(id: string, fn: (t: ChatThread) => ChatThread | void) {
  let cur = await db.chats.get(id);
  if (!cur && pendingTutor?.id === id) { cur = pendingTutor; pendingTutor = null; }
  if (!cur) return null;
  const copy = structuredClone(cur);
  const next = fn(copy) ?? copy;
  return saveThread(next);
}
export const renameThread = (id: string, title: string) => updateThread(id, (t) => { t.title = title.trim().slice(0, 120) || t.title; });
export const pinThread = (id: string, on: boolean) => updateThread(id, (t) => { t.pinned = on ? 1 : 0; });
export async function deleteThread(id: string) {
  await updateThread(id, (t) => { t.deleted = 1; t.messages = []; t.summary = ""; delete t.tutor; });
  if (state.activeId === id) set({ activeId: null, live: null });
}
export function openThread(id: string | null, slot: Slot = "ask") {
  ctls[slot]?.abort();
  if (slot === "assistant") set({ aActive: id, aLive: null }); else set({ activeId: id, live: null, list: false, picking: false });
}
/** "New chat": an empty thread (created on the first message). */
export function newChat(slot: Slot = "ask") {
  ctls[slot]?.abort();
  if (slot === "assistant") { set({ aActive: null, aLive: null, aDraft: "" }); return; }
  pendingTutor = null; set({ activeId: null, live: null, draft: "", list: false, picking: false });
}
export function setFeedback(threadId: string, msgId: string, f: 1 | -1 | undefined) {
  return updateThread(threadId, (t) => { const m = t.messages.find((x) => x.id === msgId); if (m) { if (f) m.feedback = f; else delete m.feedback; } });
}
async function pruneThreads() {
  const ids = threadsToPrune(await db.chats.toArray());
  for (const id of ids) await updateThread(id, (t) => { t.deleted = 1; t.messages = []; });
}

/** Start a tutor session (concept sheet "Learn with tutor", lesson note ⋯ › Tutor, Ask's mode switch). */
export function openTutor(p: { title: string; pathId?: string; conceptKey?: string; noteId?: string; mode?: Exclude<ChatMode, "ask"> }) {
  ctls.ask?.abort();
  const scope: ChatScope = p.pathId ? { kind: "path", pathId: p.pathId } : p.noteId ? { kind: "note", noteId: p.noteId } : { kind: "vault" };
  const t = newThread({ title: p.title, mode: p.mode ?? "explain", scope, ...(p.pathId ? { pathId: p.pathId } : {}), ...(p.conceptKey ? { conceptKey: p.conceptKey } : {}), ...(p.noteId ? { noteId: p.noteId } : {}) });
  pendingTutor = t;
  set({ open: true, activeId: t.id, live: null, list: false, picking: false });
  return t;
}

// Dev hook (demo only): lets browser checks open Ask / tutor without the palette.
if (DEMO && typeof window !== "undefined") (window as unknown as Record<string, unknown>).__lumenAsk = { open: openAsk, set, get: () => state, openTutor };

// ------------------------------------------------------------------ ask a turn
const ctls: Record<Slot, AbortController | null> = { ask: null, assistant: null };
/** Bumped by Stop / a new turn: an older turn that is still indexing or rewriting quietly ends. */
const turnSeq: Record<Slot, number> = { ask: 0, assistant: 0 };
const updLive = (slot: Slot, threadId: string, p: Partial<Live>) => { const l = liveOf(slot); if (l?.threadId === threadId) set({ [LIVE[slot]]: { ...l, ...p } }); };
const toPayload = (s: Retrieved[]): ChatSourceIn[] => s.map((x) => ({ n: x.n, title: x.title, heading: x.heading || undefined, text: x.text }));
const keepSources = (s: Retrieved[]) => s.map((x) => ({ n: x.n, noteId: x.noteId, title: x.title, ...(x.heading ? { heading: x.heading } : {}), text: x.text }));

/**
 * Send a message in the active thread (or a new one). `regenerate` re-answers the last question (its old answer is
 * dropped first); `general` answers it from general knowledge (explicit choice after "Not in your notes").
 */
export interface SendOpts {
  scope?: Scope; regenerate?: boolean; general?: boolean;
  /** Which conversation (default: the Ask page). */
  slot?: Slot;
  /** Passages put first (the Assistant's "Selection" chip), numbered before the retrieved ones. */
  pinned?: { noteId: string; title: string; heading?: string; text: string }[];
  /** Assistant with "Only from my notes" off: fall back to general knowledge (labelled) when the notes don't cover it. */
  allowGeneral?: boolean;
  /** Extra note ids the retrieval may use besides the scope (the Assistant's "+ Add" chips). */
  extraNotes?: string[];
  /** New thread: mark it as the Assistant's thread for this note. */
  assistantFor?: string;
}
export async function sendChat(text: string, v: Vault, opts: SendOpts = {}) {
  const question = text.trim();
  if (!question) return;
  const slot = opts.slot ?? "ask";
  ctls[slot]?.abort();
  const my = ++turnSeq[slot];
  const alive = () => my === turnSeq[slot] && liveOf(slot)?.threadId === id;
  const up = (p: Partial<Live>) => { if (alive()) updLive(slot, id, p); };
  const scope = opts.scope ?? state.scope ?? { kind: "vault" };
  const activeId = state[ACT[slot]];
  let found = activeId ? await db.chats.get(activeId) : undefined;
  if (found && (found.deleted || found.mode !== "ask")) found = undefined;
  let thread: ChatThread = found ? structuredClone(found) : newThread({ title: autoTitle(question), mode: "ask", scope: toScope(scope), ...(opts.assistantFor ? { noteId: opts.assistantFor, assistant: 1 as const } : {}) });
  if (opts.regenerate || opts.general) {
    while (thread.messages.length && thread.messages[thread.messages.length - 1].role === "assistant") thread.messages.pop();
  } else {
    thread.messages.push(msg("user", question));
  }
  thread.scope = toScope(scope);
  thread = await saveThread(thread);
  const id = thread.id;
  const history = thread.messages.slice(0, -1); // everything before this question
  const allow = scopeNotes(scope, v);
  if (allow && opts.extraNotes) for (const x of opts.extraNotes) allow.add(x);
  const rscope: Scope = allow && opts.extraNotes?.length ? { ...scope, noteIds: [...allow] } : scope;
  const total = allow ? allow.size : v.notes.filter((n) => !n.deleted).length;
  const ctx = windowHistory({ messages: history, summary: thread.summary, summarized: thread.summarized });
  const t0 = Date.now();
  const since = () => Date.now() - t0;
  const live0: Live = { threadId: id, status: "indexing", text: "", sources: [], read: 0, total, question, t0, general: opts.general, turns: ctx.usedTurns, summarized: !!ctx.summary };
  if (slot === "assistant") set({ aActive: id, aDraft: "", aLive: live0 }); else set({ activeId: id, draft: "", live: live0 });
  void pruneThreads();

  const finish = async (m: ChatMessage | null, live: Partial<Live> | null) => {
    if (m) await updateThread(id, (t) => { t.messages.push(m); });
    if (alive()) set({ [LIVE[slot]]: live ? { ...liveOf(slot)!, ...live } : null });
  };

  try {
    const casual = isCasual(question) && history.length > 0;
    let rewrite: string | undefined;
    let sources: Retrieved[] = [];
    if (!opts.general && !casual) {
      await ensureIndex(v, (done, all) => up({ read: Math.round((done / Math.max(1, all)) * total) }));
      if (!alive()) return;
      up({ read: total, tIndex: since() });
      if (needsRewrite(question, history) && aiReady()) {
        up({ status: "rewriting" });
        const turns = history.slice(-REWRITE_TURNS * 2).filter((m) => m.text.trim()).map((m) => plainTurn(m, 600));
        rewrite = (await aiChat({ op: "rewrite", question, history: turns }).catch(() => "")).trim() || undefined;
        if (rewrite && rewrite.toLowerCase() === question.toLowerCase()) rewrite = undefined;
        if (!alive()) return;
      }
      // retrieve with BOTH the raw turn and its rewrite, merged by reciprocal rank
      sources = rewrite ? mergeRanked([retrieve(question, v, rscope), retrieve(rewrite, v, rscope)], 8) : retrieve(question, v, rscope);
      if (opts.pinned?.length) sources = pinFirst(opts.pinned, sources);
      up({ sources, rewrite, tRead: since(), nRead: sources.length });
      if (!sources.length && !opts.allowGeneral) return finish(msg("assistant", "", { empty: "none", ...(rewrite ? { rewrite } : {}) }), null);
    }
    if (!getToken() && !DEMO) return finish(null, { status: "signedout", error: NEEDS_SIGNIN });
    if (typeof navigator !== "undefined" && navigator.onLine === false) return finish(null, { status: "offline" });
    let general = !!opts.general || (!!opts.allowGeneral && !sources.length && !casual);
    up({ status: "asking", general });
    const c = (ctls[slot] = new AbortController());
    const ask = (g: boolean) => aiChat({ op: "answer", question, rewrite, history: ctx.recent, summary: ctx.summary || undefined, sources: g ? [] : toPayload(sources), general: g },
      (t) => { const l = liveOf(slot); up({ text: t, status: "streaming", ...(l && l.tFirst === undefined && t ? { tFirst: since() } : {}) }); }, c.signal);
    let answer = await ask(general);
    if (!general && isNotInNotes(answer) && opts.allowGeneral) { general = true; up({ text: "", general }); answer = await ask(true); }
    if (!general && isNotInNotes(answer)) return finish(msg("assistant", "", { empty: "none", sources: keepSources(sources), ...(rewrite ? { rewrite } : {}) }), null);
    const m = msg("assistant", answer.trim(), { ms: since(), ...(sources.length && !general ? { sources: keepSources(sources) } : {}), ...(rewrite ? { rewrite } : {}), ...(general ? { general: 1 as const } : {}) });
    await finish(m, null);
    void afterAnswer(id, m, question);
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    const err = e as ApiError;
    const offline = err.status === 0 || /fetch|network/i.test(err.message);
    if (isLimitError(err.status ?? 0, err.message)) return finish(null, { status: "limit", error: err.message });
    await finish(null, offline ? { status: "offline" } : { status: err.status === 401 ? "signedout" : "error", error: err.status === 401 ? NEEDS_SIGNIN : err.message });
  }
}

/** Follow-up suggestions + running summary (best effort, after the answer is saved). */
async function afterAnswer(id: string, m: ChatMessage, question: string) {
  if (m.text && !isCasual(question)) {
    const raw = await aiChat({ op: "followups", question, answer: m.text }).catch(() => "");
    const followups = parseFollowups(raw);
    if (followups.length) await updateThread(id, (t) => { const x = t.messages.find((y) => y.id === m.id); if (x) x.followups = followups; });
  }
  const t = await db.chats.get(id);
  if (!t) return;
  const w = windowHistory(t);
  if (w.pending.length < SUMMARY_BATCH) return;
  const turns = w.pending.filter((x) => x.text.trim()).map((x) => plainTurn(x, 800));
  const summary = clampSummary((await aiChat({ op: "summarize", summary: t.summary, history: turns }).catch(() => "")).trim() || localSummary(t.summary ?? "", turns));
  await updateThread(id, (x) => { x.summary = summary; x.summarized = w.windowStart; });
}

export function stopChat(slot: Slot = "ask") {
  ctls[slot]?.abort();
  turnSeq[slot]++;
  const l = liveOf(slot);
  if (!l) return;
  if (l.text) {
    const m = msg("assistant", l.text.trim(), { stopped: 1 as const, ...(l.t0 ? { ms: Date.now() - l.t0 } : {}), ...(l.sources.length && !l.general ? { sources: keepSources(l.sources) } : {}), ...(l.rewrite ? { rewrite: l.rewrite } : {}), ...(l.general ? { general: 1 as const } : {}) });
    void updateThread(l.threadId, (t) => { t.messages.push(m); });
    set({ [LIVE[slot]]: null });
  } else set({ [LIVE[slot]]: { ...l, status: "error", error: "Stopped before an answer." } }); // Retry re-asks
}
/** Re-answer the last question of a thread (`general` = from general knowledge). */
export async function regenerate(threadId: string, v: Vault, general = false, slot: Slot = "ask", extra: Omit<SendOpts, "scope" | "regenerate" | "general" | "slot"> = {}) {
  const t = await db.chats.get(threadId);
  const q = [...(t?.messages ?? [])].reverse().find((m) => m.role === "user");
  if (!t || !q) return;
  set({ [ACT[slot]]: threadId });
  await sendChat(q.text, v, { ...extra, scope: t.scope as Scope, regenerate: true, general, slot });
}
/** Pinned passages (selection) first, then the retrieved ones without duplicates, renumbered 1…n. */
function pinFirst(pins: NonNullable<SendOpts["pinned"]>, rest: Retrieved[]): Retrieved[] {
  const head: Retrieved[] = pins.map((p, i) => ({ id: `pin:${i}:${p.noteId}`, noteId: p.noteId, spaceId: "", title: p.title, heading: p.heading ?? "", text: p.text.slice(0, 1500), src: "", order: -1, n: 0, score: 999 }));
  const seen = new Set(head.map((h) => h.text.slice(0, 60)));
  return [...head, ...rest.filter((r) => !seen.has(r.text.slice(0, 60)))].slice(0, 8).map((r, i) => ({ ...r, n: i + 1 }));
}
