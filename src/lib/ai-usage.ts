// AI usage meter + daily limit, client side (Lumen 29 · Settings › AI, round 6). Server: worker/ext/ai-usage.ts.
//
//  getUsage(force?)  → today's usage {used, limit, features, week, resetAt, reached} (cached ~30 s)
//  onUsage(cb)       → subscribe; returns unsubscribe
//  limitState(u?)    → "normal" | "near" (≥ 80 %) | "reached"
//  useAiUsage()      → React hook (fetches on mount)
//  setAiLimit(n)     → own daily cap in neurons (0 = none, null = the 10,000 free allowance); synced on the Inbox space
//
// api() dispatches a "lumen:ai" event after every /ai… or /transcribe call (src/lib/api.ts); a 429 `ai_limit` (or a
// limit/quota message) flips the state to "reached" at once, a success refreshes the meter.
// Demo mode never talks to the server: a local ledger (localStorage) counts the simulated calls with the same
// estimates, seeded with a plausible day, and the simulator's "AI quota" fault reads as "reached".
import { useEffect, useSyncExternalStore } from "react";
import { api, getToken } from "./api";
import { db, DEFAULT_SPACE, DEMO, patch } from "./db";
import { getFaults } from "./sim/faults";

export const FREE_NEURONS = 10_000;
export const LIMIT_MESSAGE = "Daily free AI limit reached. Try tomorrow.";
export type Feature = "summarize" | "flashcards" | "explain" | "tags" | "quiz" | "roadmap" | "voice" | "ask" | "chat" | "tutor" | "project" | "practice" | "other";
export interface AiUsage {
  day: string;
  used: number;
  /** Effective daily cap in neurons; 0 = none (paid plan). */
  limit: number;
  free: number;
  reached: boolean;
  features: Partial<Record<Feature, { calls: number; neurons: number }>>;
  week: { day: string; used: number }[];
  resetAt: number;
  /** True while this is the local (demo / offline) estimate. */
  local?: boolean;
}
export type LimitState = "normal" | "near" | "reached";

/** Typical cost per call (neurons), shown next to each feature. */
export const TYPICAL: Partial<Record<Feature, string>> = { summarize: "~120 neurons", flashcards: "~180", explain: "~150", tags: "~40", quiz: "~200", roadmap: "~400", voice: "~70 / min" };
const AVG: Partial<Record<Feature, number>> = { summarize: 120, flashcards: 180, explain: 150, tags: 40, quiz: 200, roadmap: 400, voice: 70, ask: 160, chat: 140, tutor: 150, project: 260, practice: 150, other: 120 };

const dayOf = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const nextReset = (t = Date.now()) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };

let cur: AiUsage | null = null;
let fetchedAt = 0;
let inflight: Promise<AiUsage> | null = null;
const subs = new Set<(u: AiUsage) => void>();
const emit = () => { if (cur) for (const f of subs) f(cur); };

// ------------------------------------------------------------------ local ledger (demo / no server)
type Ledger = { days: Record<string, Partial<Record<Feature, { calls: number; neurons: number }>>>; reached?: string };
const LKEY = "lumen.aiUsage.local";
function readLedger(): Ledger {
  try {
    const l = JSON.parse(localStorage.getItem(LKEY) ?? "null") as Ledger | null;
    if (l?.days) return l;
  } catch { /* fall through */ }
  // Seed: a plausible week like the design (Th 30 %, Fr 62 %, Sa 10 %, Su 0, Mo 88 %, Tu 100 %, today 3,120).
  const now = Date.now(), days: Ledger["days"] = {};
  [30, 62, 10, 0, 88, 100].forEach((p, i) => { if (p) days[dayOf(now - (6 - i) * 86_400_000)] = { other: { calls: Math.round(p / 1.2), neurons: p * 100 } }; });
  days[dayOf(now)] = { summarize: { calls: 10, neurons: 1200 }, flashcards: { calls: 5, neurons: 900 }, voice: { calls: 7, neurons: 500 }, explain: { calls: 2, neurons: 300 }, other: { calls: 2, neurons: 220 } };
  const l = { days };
  writeLedger(l);
  return l;
}
function writeLedger(l: Ledger) { try { localStorage.setItem(LKEY, JSON.stringify(l)); } catch { /* private mode */ } }
async function localLimit(): Promise<number> {
  const v = (await db.spaces.get(DEFAULT_SPACE).catch(() => undefined))?.props?.aiLimit;
  if (v === undefined || v === "") return FREE_NEURONS;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : FREE_NEURONS;
}
async function localUsage(): Promise<AiUsage> {
  const l = readLedger(), now = Date.now(), day = dayOf(now);
  const features = l.days[day] ?? {};
  const used = Math.round(Object.values(features).reduce((s, f) => s + (f?.neurons ?? 0), 0));
  const limit = await localLimit();
  const week = Array.from({ length: 7 }, (_, i) => { const d = dayOf(now - (6 - i) * 86_400_000); return { day: d, used: Math.round(Object.values(l.days[d] ?? {}).reduce((s, f) => s + (f?.neurons ?? 0), 0)) }; });
  const quota = DEMO && getFaults().ai === "quota";
  return { day, used, limit, free: FREE_NEURONS, reached: quota || l.reached === day || (limit > 0 && used >= limit), features, week, resetAt: nextReset(now), local: true };
}
function localAdd(feature: Feature, neurons: number) {
  const l = readLedger(), day = dayOf();
  const d = (l.days[day] ??= {});
  const f = (d[feature] ??= { calls: 0, neurons: 0 });
  f.calls += 1; f.neurons += neurons;
  writeLedger(l);
}

const useServer = () => !DEMO && !!getToken();

// ------------------------------------------------------------------ public API
export async function getUsage(force = false): Promise<AiUsage> {
  if (!force && cur && Date.now() - fetchedAt < 30_000 && cur.day === dayOf()) return cur;
  if (inflight) return inflight;
  inflight = (async () => {
    let u: AiUsage;
    if (useServer()) {
      try { u = await api<AiUsage>("/ai/usage"); }
      catch { u = cur && !cur.local ? cur : await localUsage(); }
    } else u = await localUsage();
    cur = u; fetchedAt = Date.now();
    emit();
    return u;
  })().finally(() => { inflight = null; });
  return inflight;
}
export function onUsage(cb: (u: AiUsage) => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}
export function limitState(u: AiUsage | null = cur): LimitState {
  if (!u) return "normal";
  if (u.reached) return "reached";
  const cap = u.limit || 0;
  return cap > 0 && u.used / cap >= 0.8 ? "near" : "normal";
}
/** Percent of the cap used today (0 when there is no cap). */
export const usedPct = (u: AiUsage | null = cur) => (u && u.limit > 0 ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0);
/** "About 55 summaries or 10 minutes of voice left today." */
export function leftEstimate(u: AiUsage) {
  const left = Math.max(0, (u.limit || Infinity) - u.used);
  return { summaries: Number.isFinite(left) ? Math.floor(left / (AVG.summarize ?? 120)) : Infinity, voiceMin: Number.isFinite(left) ? Math.floor(left / (AVG.voice ?? 70)) : Infinity };
}

/** Own daily cap: null = the free allowance (10,000), 0 = no cap, n = neurons. */
export async function setAiLimit(n: number | null) {
  const inbox = await db.spaces.get(DEFAULT_SPACE);
  if (!inbox) return;
  const props = { ...inbox.props };
  if (n === null) delete props.aiLimit; else props.aiLimit = String(Math.max(0, Math.round(n)));
  await patch("space", DEFAULT_SPACE, { props });
  if (useServer()) { try { const { syncNow } = await import("./sync"); await syncNow(); } catch { /* offline */ } }
  await getUsage(true);
}

export function useAiUsage(): AiUsage | null {
  const u = useSyncExternalStore((f) => onUsage(() => f()), () => cur, () => cur);
  useEffect(() => { void getUsage(); }, []);
  return u;
}

// ------------------------------------------------------------------ api() hook ("lumen:ai" events)
function featureOf(path: string, action?: string): Feature {
  if (path.startsWith("/transcribe")) return "voice";
  if (path === "/ai") return (["summarize", "flashcards", "explain", "tags", "quiz", "roadmap"].includes(action ?? "") ? action : "other") as Feature;
  const sub = path.slice(4).split(/[/?]/)[0];
  return (["ask", "chat", "tutor", "project", "practice"].includes(sub) ? sub : "other") as Feature;
}
export const isLimitError = (status: number, msg = "") => status === 429 || /limit reached|quota/i.test(msg);

if (typeof window !== "undefined") {
  window.addEventListener("lumen:ai", (e) => {
    const d = (e as CustomEvent<{ path: string; status: number; error?: string; action?: string }>).detail;
    if (!d || d.path === "/ai/usage") return;
    try { // Settings › AI › Advanced › Log requests on this device
      if ((JSON.parse(localStorage.getItem("lumen.advanced") ?? "{}") as { aiLog?: boolean }).aiLog) {
        const log = JSON.parse(localStorage.getItem("lumen.aiLog") ?? "[]") as unknown[];
        log.push({ at: Date.now(), path: d.path + (d.action ? ` · ${d.action}` : ""), status: d.status });
        localStorage.setItem("lumen.aiLog", JSON.stringify(log.slice(-50)));
      }
    } catch { /* private mode */ }
    if (d.status >= 400 || d.status === 0) {
      if (isLimitError(d.status, d.error)) {
        if (!useServer()) { const l = readLedger(); l.reached = dayOf(); writeLedger(l); }
        if (cur) { cur = { ...cur, reached: true }; emit(); }
        void getUsage(true);
      }
      return;
    }
    if (!useServer()) localAdd(featureOf(d.path, d.action), AVG[featureOf(d.path, d.action)] ?? 120);
    setTimeout(() => void getUsage(true), useServer() ? 1500 : 0); // the server counts after the answer is sent
  });
}
