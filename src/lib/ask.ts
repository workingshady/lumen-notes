import { useSyncExternalStore } from "react";
import { ApiError, aiAsk, getToken, type AskSource } from "./api";
import { ensureIndex, retrieve, scopeLabel, type Retrieved, type Scope } from "./ask-retrieve";
import type { Vault } from "./store";

export * from "./ask-retrieve";

// ------------------------------------------------------------------ shared store (panel + palette sheet)
export type AskStatus = "idle" | "indexing" | "asking" | "streaming" | "done" | "error";
export interface AskTurn {
  id: number; question: string; scope: Scope; scopeLabel: string; sources: Retrieved[]; answer: string;
  status: AskStatus; error?: string; notice?: string; at: number;
}
interface AskState { open: boolean; draft: string; scope: Scope | null; turn: AskTurn | null; history: AskTurn[] }

const HKEY = "lumen.askHistory";
const loadHistory = (): AskTurn[] => { try { return (JSON.parse(sessionStorage.getItem(HKEY) ?? "[]") as AskTurn[]).filter((t) => t && t.question); } catch { return []; } };
let state: AskState = { open: false, draft: "", scope: null, turn: null, history: loadHistory() };
const subs = new Set<() => void>();
const set = (p: Partial<AskState>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const useAsk = () => useSyncExternalStore((f) => (subs.add(f), () => { subs.delete(f); }), () => state);
export const setAsk = set;
/** Open the full Ask sheet (palette command); a question runs at once. */
export function openAsk(question?: string) { set({ open: true, draft: question ?? state.draft }); }
export const closeAsk = () => set({ open: false });

const saveHistory = (h: AskTurn[]) => { try { sessionStorage.setItem(HKEY, JSON.stringify(h.slice(0, 12).map((t) => ({ ...t, sources: t.sources.map((s) => ({ ...s, text: s.text.slice(0, 900) })) })))); } catch { /* storage full */ } };

let ctl: AbortController | null = null;
let seq = 0;
const upd = (id: number, p: Partial<AskTurn>) => { if (state.turn?.id === id) set({ turn: { ...state.turn, ...p } }); };

export const NEEDS_SIGNIN = "AI needs sync: unlock it in Settings → Sync.";

export async function ask(question: string, scope: Scope, v: Vault) {
  question = question.trim();
  if (!question) return;
  ctl?.abort();
  const id = ++seq;
  const label = scopeLabel(scope, v);
  set({ turn: { id, question, scope, scopeLabel: label, sources: [], answer: "", status: "indexing", at: Date.now() }, draft: "" });
  await ensureIndex(v);
  if (state.turn?.id !== id) return;
  const sources = retrieve(question, v, scope);
  upd(id, { sources, status: "asking" });
  const finish = (p: Partial<AskTurn>) => {
    upd(id, p);
    const t = state.turn;
    if (t?.id === id) { const h = [t, ...state.history.filter((x) => x.question !== t.question)].slice(0, 12); set({ history: h }); saveHistory(h); }
  };
  if (!sources.length) return finish({ status: "done", answer: "Not in your notes.", notice: `Nothing in ${label === "Whole vault" ? "your notes" : label} matches this question.` });
  if (!getToken() && !/[?&]demo=1/.test(location.search)) return finish({ status: "done", notice: NEEDS_SIGNIN + " Meanwhile, here are the most relevant passages from your notes." });
  if (typeof navigator !== "undefined" && navigator.onLine === false) return finish({ status: "done", notice: "You're offline. Here are the most relevant passages from your notes; ask again when you're back online." });
  ctl = new AbortController();
  const payload: AskSource[] = sources.map((s) => ({ n: s.n, title: s.title, heading: s.heading || undefined, text: s.text }));
  try {
    const text = await aiAsk(question, payload, (t) => upd(id, { answer: t, status: "streaming" }), ctl.signal);
    finish({ answer: text, status: "done" });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    const err = e as ApiError;
    const offline = err.status === 0 || /fetch|network/i.test(err.message);
    finish({ status: "error", error: err.status === 401 ? NEEDS_SIGNIN : offline ? "Couldn't reach the server. The passages below are from your notes." : err.message });
  }
}
export function stopAsk() { ctl?.abort(); if (state.turn && (state.turn.status === "streaming" || state.turn.status === "asking")) set({ turn: { ...state.turn, status: "done" } }); }
export function showTurn(t: AskTurn) { ctl?.abort(); set({ turn: t }); }

/** Citation numbers an answer actually uses (for dimming unused sources). */
export const citedNumbers = (answer: string) => new Set([...answer.matchAll(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g)].flatMap((m) => m[1].split(",").map((x) => Number(x.trim()))));
