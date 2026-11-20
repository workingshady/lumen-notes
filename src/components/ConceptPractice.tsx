// Concept practice (learning paths): 5 mixed questions written by the AI from the concept's own course material
// (coverage topics' lesson notes + the concept's linked notes), an in-place quiz, "tested out" on ≥ 80 %,
// and "Save as flashcards" (appends `- Q :: A` lines to the concept note so they enter Review / FSRS).
// Offline / signed out / AI failure: falls back to a quiz built from the flashcards already in that material.
//
// usePractice() holds the logic; <PracticeQuiz> is the design's sheet quiz (Lumen 14 · R4-14D / 14L);
// <ConceptPractice> is the compact card used by Today.
import { BookOpen, Check, Layers, Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { findOrCreateByTitle, updateNote } from "../lib/actions";
import { api, getToken } from "../lib/api";
import { db } from "../lib/db";
import { flashcards, splitFrontMatter } from "../lib/parse";
import { linkNote, setManualDone, type BuiltConcept, type BuiltPath } from "../lib/path";
import { openNote, toast, useVault } from "../lib/store";
import { Glyph } from "./Glyph";
import { Preview } from "./Preview";
import { Button, cx } from "./ui";
import { fmtNum, t, tk } from "../lib/i18n";

export interface PracticeQuestion {
  type: "mcq" | "short" | "explain";
  q: string;
  choices?: string[];
  /** mcq: index of the right choice; short/explain: expected answer / key points. */
  answer: number | string;
  why?: string;
  source?: string;
}
interface AnswerState { picked?: number; text?: string; revealed?: boolean; score?: number; feedback?: string; grading?: boolean }

export const PASS = 0.8;
const MAX_CHARS = 18_000;

/** Course material for a concept: its linked notes first, then every course lesson note on it (deduped, capped). */
export function gatherMaterial(concept: BuiltConcept, byTitle: Map<string, Note>) {
  const titles = [...concept.def.notes, ...concept.coverage.map((c) => c.topic.note).filter((t): t is string => !!t)];
  const notes: Note[] = [];
  for (const t of titles) {
    const n = byTitle.get(t.trim().toLowerCase());
    if (n && !n.deleted && !notes.includes(n) && !["canvas", "whiteboard", "board", "diagram"].includes(n.type)) notes.push(n);
  }
  const per = notes.length ? Math.floor(MAX_CHARS / notes.length) : 0;
  const courses = [...new Set(concept.coverage.map((c) => `${c.course.spaceName} (${c.module} › ${c.topic.name})`))];
  const head = `Concept: ${concept.def.name}${concept.def.aliases.length ? ` (also called: ${concept.def.aliases.join(", ")})` : ""}\n${courses.length ? `Taught in: ${courses.join("; ")}\n` : ""}`;
  const text = head + notes.map((n) => `\n### Note: ${n.title}\n${splitFrontMatter(n.body).body.trim().slice(0, per)}`).join("\n");
  return { text, notes };
}

/** Parse the model's JSON (tolerates code fences / prose around it); returns only well-formed questions. */
export function parseQuiz(raw: string): PracticeQuestion[] {
  const s = raw.replace(/```(?:json)?/gi, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  const a2 = s.indexOf("["), b2 = s.lastIndexOf("]");
  let data: unknown = null;
  try { data = JSON.parse(s.slice(a, b + 1)); } catch { try { data = JSON.parse(s.slice(a2, b2 + 1)); } catch { return []; } }
  const list = Array.isArray(data) ? data : (data as { questions?: unknown })?.questions;
  if (!Array.isArray(list)) return [];
  const out: PracticeQuestion[] = [];
  for (const x of list as Record<string, unknown>[]) {
    const q = typeof x?.q === "string" ? x.q.trim() : typeof x?.question === "string" ? (x.question as string).trim() : "";
    if (!q) continue;
    const why = typeof x.why === "string" ? x.why : undefined;
    const source = typeof x.source === "string" ? x.source : undefined;
    if (x.type === "mcq" && Array.isArray(x.choices) && x.choices.length >= 2) {
      const choices = (x.choices as unknown[]).map(String);
      let ans = typeof x.answer === "number" ? x.answer : choices.findIndex((c) => c === String(x.answer));
      if (!(ans >= 0 && ans < choices.length)) ans = 0;
      out.push({ type: "mcq", q, choices, answer: ans, why, source });
    } else if (x.answer !== undefined) {
      const ans = Array.isArray(x.answer) ? (x.answer as unknown[]).map((p) => `- ${String(p)}`).join("\n") : String(x.answer);
      out.push({ type: x.type === "explain" ? "explain" : "short", q, answer: ans, why, source });
    }
  }
  return out.slice(0, 5);
}

/** Offline quiz from the `Q :: A` cards already in the material (MCQ with other answers as distractors). */
export function localQuiz(notes: Note[]): PracticeQuestion[] {
  const cards = notes.flatMap((n) => flashcards(n.body).filter((c) => c.kind !== "occlusion").map((c) => ({ ...c, source: n.title })));
  if (cards.length < 3) return [];
  const pick = [...cards].sort(() => Math.random() - 0.5).slice(0, 5);
  return pick.map((c, i) => {
    const others = [...new Set(cards.filter((o) => o.a !== c.a).map((o) => o.a))].sort(() => Math.random() - 0.5).slice(0, 3);
    if (i < 3 && others.length >= 2 && c.a.length < 160) {
      const choices = [...others, c.a].sort(() => Math.random() - 0.5);
      return { type: "mcq" as const, q: c.q, choices, answer: choices.indexOf(c.a), source: c.source };
    }
    return { type: "short" as const, q: c.q, answer: c.a, source: c.source };
  });
}

const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, " ").replace(/::/g, ":").trim();
/** Flashcard lines for a quiz (MCQ → the right choice; explain → its key points on one line). */
export const toCardLines = (qs: PracticeQuestion[]) => qs.map((q) => `- ${oneLine(q.q)} :: ${oneLine(q.type === "mcq" ? q.choices![q.answer as number] : String(q.answer).replace(/^\s*[-*]\s+/gm, "").split(/\n+/).map((x) => x.trim().replace(/[.;]$/, "")).filter(Boolean).join("; "))}`);

function stripJsonError(e: unknown) {
  const m = (e as Error)?.message ?? String(e);
  return /fetch|network|offline/i.test(m) ? t("You're offline.") : m;
}

/**
 * Practice state + actions for one concept. `note` = the path note (its body holds the concept). `onTestOut` defaults to
 * marking the concept learned through `setManualDone` (which also starts its revision ladder). With `autoLearn`, finishing
 * with ≥ 80 % marks the concept learned right away (design: "80%+ marks it learned").
 */
export function usePractice({ concept, note, onTestOut, autoLearn }: { concept: BuiltConcept; note: Note; onTestOut?: () => void; autoLearn?: boolean }) {
  const v = useVault();
  const material = useMemo(() => gatherMaterial(concept, v.byTitle), [concept, v.byTitle]);
  const [phase, setPhase] = useState<"idle" | "loading" | "quiz" | "done">("idle");
  const [qs, setQs] = useState<PracticeQuestion[]>([]);
  const [ans, setAns] = useState<AnswerState[]>([]);
  const [i, setI] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [local, setLocal] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testedOut, setTestedOut] = useState(false);
  const signedIn = !!getToken();
  const online = typeof navigator === "undefined" || navigator.onLine !== false;
  const aiReady = signedIn && online;
  const learned = concept.status === "done";
  // a different concept: back to idle
  const key = concept.key;
  const prevKey = useRef(key);
  useEffect(() => { if (prevKey.current !== key) { prevKey.current = key; setPhase("idle"); setQs([]); setAns([]); setMsg(null); } }, [key]);

  function begin(list: PracticeQuestion[], fromCards: boolean) {
    setQs(list); setAns(list.map(() => ({}))); setI(0); setSaved(false); setTestedOut(false); setLocal(fromCards); setPhase("quiz");
  }
  async function start() {
    setMsg(null);
    const fallback = (why: string) => {
      const l = localQuiz(material.notes);
      if (l.length) { begin(l, true); setMsg(`${why} ${t("Practising with the flashcards already in this concept's notes.")}`); }
      else { setPhase("idle"); setMsg(`${why} ${material.notes.length ? t("Practice questions need the AI.") : t("Practice questions need the AI (and there are no flashcards in linked notes to fall back on).")}`); }
    };
    if (!signedIn) return fallback(t("AI needs sync: unlock it in Settings → Sync."));
    if (!online) return fallback(t("You're offline."));
    setPhase("loading");
    try {
      const { text } = await api<{ text: string }>("/ai/practice", { method: "POST", json: { mode: "quiz", text: material.text } });
      const list = parseQuiz(text);
      if (list.length < 3) return fallback(t("The AI answer couldn't be read."));
      begin(list, false);
    } catch (e) { fallback(stripJsonError(e) + (/\.$/.test(stripJsonError(e)) ? "" : ".")); }
  }

  const set = (k: number, p: Partial<AnswerState>) => setAns((a) => a.map((x, j) => (j === k ? { ...x, ...p } : x)));
  async function aiGrade(k: number) {
    const q = qs[k], a = ans[k];
    if (!a.text?.trim()) return;
    set(k, { grading: true });
    try {
      const { text } = await api<{ text: string }>("/ai/practice", { method: "POST", json: { mode: "grade", text: `Question: ${q.q}\nExpected answer: ${q.answer}\nLearner's answer: ${a.text}` } });
      const m = /\{[\s\S]*\}/.exec(text);
      const r = m ? (JSON.parse(m[0]) as { score?: number; feedback?: string }) : null;
      const sc = typeof r?.score === "number" ? (r.score >= 0.75 ? 1 : r.score >= 0.25 ? 0.5 : 0) : undefined;
      if (sc === undefined) throw new Error(t("The AI grade couldn't be read: grade it yourself."));
      set(k, { grading: false, score: sc, feedback: r?.feedback });
    } catch (e) { set(k, { grading: false }); toast(stripJsonError(e)); }
  }

  const score = ans.reduce((s, a) => s + (a.score ?? 0), 0);
  const pct = qs.length ? score / qs.length : 0;
  const passed = pct >= PASS;

  async function testOut() {
    if (onTestOut) onTestOut();
    else {
      if (!concept.placed) return toast(t("Place this concept in a stage first."));
      const fresh = (await db.notes.get(note.id)) ?? note;
      await updateNote(note.id, { body: setManualDone(fresh.body, concept, true) });
    }
    setTestedOut(true);
    toast(t("{name}: marked learned (tested out)", { name: concept.def.name }));
  }

  async function saveCards(only?: PracticeQuestion[]) {
    const lines = toCardLines(only ?? qs);
    let target = material.notes.find((n) => concept.def.notes.some((t) => t.toLowerCase() === n.title.toLowerCase())) ?? null;
    if (!target) {
      // No concept note yet: create one named after the concept (or reuse a note with that title) and link it in the path.
      target = await findOrCreateByTitle(concept.def.name, note.spaceId);
      if (concept.placed) {
        const fresh = (await db.notes.get(note.id)) ?? note;
        await updateNote(note.id, { body: linkNote(fresh.body, concept, target.title) });
      }
    }
    const cur = (await db.notes.get(target.id)) ?? target;
    const have = new Set(flashcards(cur.body).map((c) => c.q.toLowerCase()));
    const fresh = lines.filter((l) => !have.has(l.slice(2, l.indexOf(" :: ")).trim().toLowerCase()));
    if (!fresh.length) { setSaved(true); return toast(t("Already in “{name}”", { name: cur.title })); }
    const body = cur.body.trimEnd() + (/^## Practice cards\s*$/m.test(cur.body) ? "\n" : "\n\n## Practice cards\n\n") + fresh.join("\n") + "\n";
    await updateNote(cur.id, { body });
    setSaved(true);
    toast(t("{n} card added to “{name}”|{n} cards added to “{name}”", { n: fresh.length, name: cur.title }), { label: t("Open"), run: () => openNote(cur.id) });
  }

  const next = () => (i + 1 < qs.length ? setI(i + 1) : setPhase("done"));
  // ≥ 80 % learns (sheet quiz)
  useEffect(() => { if (autoLearn && phase === "done" && passed && !learned && !testedOut) void testOut(); }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  return { v, concept, material, phase, setPhase, qs, ans, i, setI, msg, local, saved, testedOut, signedIn, aiReady, learned, start, set, aiGrade, score, pct, passed, testOut, saveCards, next };
}
export type Practice = ReturnType<typeof usePractice>;

const md = (note: Note, body: string) => ({ id: note.id, body, spaceId: note.spaceId });
const SERIF = { fontFamily: "'Source Serif 4', Georgia, serif" };

/** Design quiz (concept sheet / phone sheet): progress bars, serif question, lettered choices, feedback box, Next question. */
export function PracticeQuiz({ p, note, onClose, phone }: { p: Practice; note: Note; onClose: () => void; phone?: boolean }) {
  const { qs, ans, i, phase } = p;
  if (phase === "loading" || phase === "idle") {
    return (
      <div className="flex flex-1 flex-col gap-3.5 px-[18px] py-4">
        <div className="flex items-center gap-2"><span className="font-semibold text-learn">{t("Practice")}</span><span className="text-muted">· {p.material.notes.length ? t("from {n} note|from {n} notes", { n: p.material.notes.length }) : t("general knowledge")}</span><span className="flex-1" /><button aria-label={t("Stop practice")} onClick={onClose} className="text-muted hover:text-ink"><X size={16} /></button></div>
        {phase === "loading" ? <span className="flex items-center gap-2 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" />{t("Writing {n} questions…", { n: 5 })}</span>
          : <><span className="text-[13px] text-muted">{p.msg ?? t("Five questions: multiple choice and short answers.")}</span><Button variant="primary" className="self-start" onClick={() => void p.start()}>{t("Start")}</Button></>}
      </div>
    );
  }
  if (phase === "done") {
    return (
      <div className="flex flex-1 flex-col gap-3.5 px-[18px] py-4">
        <div className="flex items-center gap-2"><span className="font-semibold text-learn">{t("Practice")}</span><span className="text-muted">· {t("score")}</span><span className="flex-1" /><button aria-label={t("Close practice")} onClick={onClose} className="text-muted hover:text-ink"><X size={16} /></button></div>
        <div className="flex items-baseline gap-3"><span className={cx("text-[34px] font-[650] tabular-nums", p.passed ? "text-ok" : "text-ink")}>{fmtNum(Math.round(p.pct * 100))}%</span><span className="text-[13px] text-muted">{t("{n} of {total}", { n: p.score % 1 ? fmtNum(p.score, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : p.score, total: qs.length })} · {p.passed ? (p.learned || p.testedOut ? t("learned") : t("passed")) : t("{pct}% to pass", { pct: PASS * 100 })}</span></div>
        <ol className="flex flex-col gap-1.5 text-[13px]">
          {qs.map((q, k) => (
            <li key={k} className="flex items-start gap-2">
              <span className={cx("mt-[6px] h-1 w-[18px] shrink-0 rounded-[2px]", (ans[k].score ?? 0) >= 1 ? "bg-ok" : (ans[k].score ?? 0) > 0 ? "bg-warn" : "bg-bad")} />
              <button className="min-w-0 flex-1 text-start hover:text-link" dir="auto" onClick={() => { p.setI(k); p.setPhase("quiz"); }}>{oneLine(q.q).replace(/[*_`$]/g, "")}</button>
            </li>
          ))}
        </ol>
        {p.testedOut && <span className="flex items-center gap-1.5 text-[13px] text-ok"><Check size={14} />{t("Marked learned")}</span>}
        <div className="mt-auto flex gap-2">
          <button onClick={() => void p.saveCards()} disabled={p.saved} className="flex h-9 items-center rounded-[10px] border border-line px-3 text-muted hover:text-ink disabled:opacity-60">{p.saved ? t("Saved as flashcards") : t("Save as flashcards")}</button>
          <span className="flex-1" />
          <button onClick={() => void p.start()} className="flex h-9 items-center gap-1.5 rounded-[10px] bg-accent px-4 font-semibold text-accent-fg"><RotateCcw size={14} />{t("New questions")}</button>
        </div>
        {p.local && <span className="text-[12px] text-muted">{t("Built from your own cards (AI unavailable).")}</span>}
      </div>
    );
  }
  const q = qs[i], a = ans[i];
  const answered = a.score !== undefined;
  const src = q.source && q.source !== "general" ? p.v.byTitle.get(q.source.trim().toLowerCase()) : undefined;
  const srcTitle = src?.title ?? (q.source && q.source !== "general" ? q.source : null);
  const course = srcTitle ? p.concept.coverage.find((x) => (x.topic.note ?? "").toLowerCase() === srcTitle.toLowerCase())?.course.spaceName : undefined;
  const tone = a.score === undefined ? null : a.score >= 1 ? "ok" : a.score > 0 ? "warn" : "bad";
  const toneVar = tone === "ok" ? "var(--success)" : tone === "warn" ? "var(--warning)" : "var(--danger)";
  const head = tone === "ok" ? t("Right.") : tone === "warn" ? t("Close.") : t("Not quite.");
  return (
    <div className={cx("flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto", phone ? "px-0 py-0" : "px-[18px] py-4")} aria-label={t("Practice question")}>
      <div className="flex items-center gap-2">
        <span className="font-semibold text-learn">{t("Practice")}</span>
        <span className="text-muted">{phone ? t("{n} of {total}", { n: i + 1, total: qs.length }) : `· ${t("question {n} of {total}", { n: i + 1, total: qs.length })} · ${t("from {n} note|from {n} notes", { n: p.material.notes.length })}`}</span>
        <span className="flex-1" />
        {!phone && <span className="flex gap-1">{qs.map((_, k) => <span key={k} className="h-1 w-[18px] rounded-[2px]" style={{ background: k === i && ans[k].score === undefined ? "var(--learn)" : ans[k].score === undefined ? "var(--surface-2)" : ans[k].score! >= 1 ? "var(--success)" : ans[k].score! > 0 ? "var(--warning)" : "var(--danger)" }} />)}</span>}
        <button aria-label={t("Stop practice")} onClick={onClose} className="text-muted hover:text-ink"><X size={phone ? 20 : 16} /></button>
      </div>
      <div style={SERIF} className="text-[19px] leading-[28px]" dir="auto"><Preview note={md(note, q.q)} className="practice-q !m-0 !max-w-none" /></div>
      {q.type === "mcq" ? (
        <div className="flex flex-col gap-3.5" role="radiogroup">
          {q.choices!.map((c, k) => {
            const right = k === q.answer, picked = a.picked === k;
            const good = answered && right, bad = answered && picked && !right;
            return (
              <button key={k} role="radio" aria-checked={picked} disabled={answered} onClick={() => p.set(i, { picked: k, revealed: true, score: right ? 1 : 0 })}
                className={cx("flex min-h-[44px] items-center gap-2.5 rounded-[10px] px-3 py-2 text-start", !answered && "hover:border-ink/40")}
                style={{ border: good ? "1.5px solid var(--success)" : bad ? "1.5px solid var(--danger)" : "1px solid var(--border)", background: good ? "color-mix(in srgb,var(--success) 8%,var(--bg))" : bad ? "color-mix(in srgb,var(--danger) 8%,var(--bg))" : "var(--bg)", opacity: answered && !good && !bad ? 1 : 1 }}>
                <span className="flex size-[22px] shrink-0 items-center justify-center rounded-[6px] bg-surface-2 text-[11.5px] font-[650]">{"ABCDEF"[k] ?? k + 1}</span>
                <span className="min-w-0 flex-1 leading-[18px]" dir="auto"><Preview note={md(note, c)} className="practice-choice-md !m-0 !max-w-none" /></span>
                <Glyph name={good ? "s-done" : bad ? "x" : "s-todo"} size={16} color={good ? "var(--success)" : bad ? "var(--danger)" : "transparent"} />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <textarea dir="auto" rows={4} value={a.text ?? ""} disabled={a.revealed} onChange={(e) => p.set(i, { text: e.target.value })} autoFocus
            placeholder={q.type === "explain" ? t("Explain it in your own words…") : t("Your answer…")}
            className="min-h-[120px] w-full resize-y rounded-[12px] border-[1.5px] border-line bg-bg p-3 leading-[22px] outline-none focus:border-accent" />
          {!a.revealed && <div className="flex gap-2"><Button size="sm" variant="primary" onClick={() => { p.set(i, { revealed: true }); if (p.aiReady && !p.local && a.text?.trim()) void p.aiGrade(i); }}>{t("Check")}</Button><Button size="sm" variant="ghost" onClick={() => p.set(i, { revealed: true, text: a.text ?? "", score: 0 })}>{t("I don't know")}</Button></div>}
          {a.revealed && (
            <div className="rounded-[10px] border border-line bg-bg px-3 py-2.5 text-[12.5px] leading-[19px]">
              <div className="text-[11.5px] font-medium text-muted">{q.type === "explain" ? t("Key points") : t("Expected answer")}</div>
              <Preview note={md(note, String(q.answer))} className="practice-md !m-0 !max-w-none !text-[13px]" />
              {a.grading && <span className="mt-1 flex items-center gap-1.5 text-muted"><Loader2 size={12} className="animate-spin" />{t("Grading…")}</span>}
              {!a.grading && a.score === undefined && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] text-muted">{t("How did you do?")}</span>
                  {([[1, tk("Got it")], [0.5, tk("Partly")], [0, tk("Missed")]] as const).map(([s, l]) => <button key={l} onClick={() => p.set(i, { score: s })} className="h-7 rounded-[8px] border border-line px-2.5 text-[12px] hover:bg-surface-2">{t(l)}</button>)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {tone && (
        <div className="rounded-[10px] px-3 py-2.5 text-[12.5px] leading-[19px]" dir="auto" style={{ background: `color-mix(in srgb, ${toneVar} 9%, transparent)`, border: `1px solid color-mix(in srgb, ${toneVar} 28%, transparent)` }}>
          <b className="font-semibold" style={{ color: toneVar }}>{head}</b> {a.feedback ?? q.why ?? (q.type === "mcq" && tone !== "ok" ? t("The answer is {x}.", { x: "ABCDEF"[q.answer as number] }) : "")}{tone === "warn" ? " " + t("Counts as half.") : ""}
          {srcTitle && <> <button onClick={() => src && openNote(src.id)} className="text-link hover:underline">{t("From “{name}”", { name: srcTitle })}{course ? ` · ${course}` : ""}</button></>}
        </div>
      )}
      <div className={cx("mt-auto flex gap-2", phone && "flex-col-reverse pb-3")}>
        <button onClick={() => void p.saveCards()} disabled={p.saved} className={cx("flex items-center justify-center rounded-[10px] text-muted hover:text-ink disabled:opacity-60", phone ? "h-11" : "h-9 border border-line px-3")}>{p.saved ? t("Saved as flashcards") : t("Save as flashcards")}</button>
        {!phone && <span className="flex-1" />}
        {i > 0 && !phone && <button onClick={() => p.setI(i - 1)} className="flex h-9 items-center px-3 text-muted hover:text-ink">{t("Back")}</button>}
        <button onClick={p.next} disabled={!answered} className={cx("flex items-center justify-center rounded-[10px] bg-accent px-4 font-semibold text-accent-fg disabled:opacity-50", phone ? "h-[52px] rounded-[12px]" : "h-9")}>{i + 1 < qs.length ? t("Next question") : t("See score")}</button>
      </div>
      {!phone && <span className="text-[12px] text-muted">{t("Score {pct}% or more to mark it learned.", { pct: PASS * 100 })}</span>}
    </div>
  );
}

/** Compact practice card (Today plan): same logic, inline quiz. */
export function ConceptPractice({ concept, path, note, onTestOut, className }: { concept: BuiltConcept; path: BuiltPath; note: Note; onTestOut?: () => void; className?: string }) {
  const p = usePractice({ concept, note, onTestOut });
  void path; // part of the public props (callers pass the built path); the concept already carries its coverage
  const { phase, qs, ans, i, material, learned, aiReady, signedIn, msg } = p;

  if (phase === "idle" || phase === "loading") {
    return (
      <section className={cx("practice rounded-[12px] border border-line bg-surface-2/40 p-3", className)}>
        <div className="flex items-center gap-2">
          <Glyph name="flashcards" size={14} color="var(--learn)" />
          <span className="min-w-0 flex-1 text-[13px]"><b>{t("Practice")}</b><span className="text-muted"> · {t("{n} questions from {source}", { n: 5, source: material.notes.length ? t("{n} note|{n} notes", { n: material.notes.length }) : t("the concept name") })}</span></span>
          <Button size="sm" variant="primary" onClick={() => void p.start()} disabled={phase === "loading"}>
            {phase === "loading" ? <><Loader2 size={13} className="animate-spin" /> {t("Writing…")}</> : learned ? t("Practice") : t("Test out")}
          </Button>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
          {learned ? t("Check you still know it: multiple choice, short answers and one explanation.") : t("Score {pct}% or more to mark it learned without the lessons.", { pct: PASS * 100 })}
          {!aiReady && !msg && <> {signedIn ? t("Offline: uses the flashcards in its notes instead.") : t("AI needs sync (Settings → Sync): uses the flashcards in its notes instead.")}</>}
          {!material.notes.length && aiReady && " " + t("No lesson notes are linked yet, so questions come from general knowledge.")}
        </p>
        {msg && <p className="mt-1.5 text-[12px] text-warn" role="status">{msg}</p>}
      </section>
    );
  }

  if (phase === "done") {
    return (
      <section className={cx("practice rounded-[12px] border p-3", p.passed ? "border-ok/40 bg-ok/[.06]" : "border-line bg-surface-2/40", className)}>
        <div className="flex items-center gap-2">
          <span className={cx("text-[20px] font-[650] tabular-nums", p.passed ? "text-ok" : "text-ink")}>{fmtNum(Math.round(p.pct * 100))}%</span>
          <span className="min-w-0 flex-1 text-[12.5px] text-muted">{fmtNum(p.score, { maximumFractionDigits: 1 })} / {fmtNum(qs.length)} · {p.passed ? t("passed") : t("{pct}% to pass", { pct: PASS * 100 })}</span>
          <button onClick={() => p.setPhase("idle")} aria-label={t("Close practice")} className="flex size-7 items-center justify-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-ink"><X size={14} /></button>
        </div>
        <ol className="mt-2 flex flex-col gap-1 text-[12.5px]">
          {qs.map((q, k) => (
            <li key={k} className="flex items-start gap-2">
              <span className={cx("mt-[3px] size-2 shrink-0 rounded-full", (ans[k].score ?? 0) >= 1 ? "bg-ok" : (ans[k].score ?? 0) > 0 ? "bg-warn" : "bg-bad")} />
              <button className="min-w-0 flex-1 truncate text-start hover:text-ink" dir="auto" onClick={() => { p.setI(k); p.setPhase("quiz"); }}>{oneLine(q.q).replace(/[*_`$]/g, "")}</button>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap gap-2">
          {p.passed && !learned && !p.testedOut && <Button size="sm" variant="primary" onClick={() => void p.testOut()}><Check size={13} /> {t("Mark learned (tested out)")}</Button>}
          {p.testedOut && <span className="flex h-7 items-center gap-1 text-[12px] text-ok"><Check size={13} /> {t("Marked learned")}</span>}
          <Button size="sm" onClick={() => void p.saveCards()} disabled={p.saved}><Layers size={13} /> {p.saved ? t("Saved as flashcards") : t("Save as flashcards")}</Button>
          <Button size="sm" variant="ghost" onClick={() => void p.start()}><RotateCcw size={13} /> {t("New questions")}</Button>
        </div>
        {p.local && <p className="mt-2 text-[11.5px] text-muted">{t("Built from your own cards (AI unavailable).")}</p>}
      </section>
    );
  }

  const q = qs[i], a = ans[i];
  const answered = a.score !== undefined;
  const src = q.source && q.source !== "general" ? p.v.byTitle.get(q.source.trim().toLowerCase()) : undefined;
  return (
    <section className={cx("practice rounded-[12px] border border-line bg-surface-2/40 p-3", className)} aria-label={t("Practice question")}>
      <div className="flex items-center gap-2 text-[11.5px] text-muted">
        <span className="flex flex-1 gap-1">{qs.map((_, k) => <span key={k} className={cx("h-1.5 flex-1 rounded-full", k === i ? "bg-learn" : ans[k].score === undefined ? "bg-surface-2" : ans[k].score! >= 1 ? "bg-ok" : ans[k].score! > 0 ? "bg-warn" : "bg-bad")} />)}</span>
        <span className="tabular-nums">{fmtNum(i + 1)} / {fmtNum(qs.length)}</span>
        <span className="uppercase tracking-wide">{q.type === "mcq" ? t("Choice") : q.type === "short" ? t("Short answer") : t("Explain")}</span>
        <button onClick={() => p.setPhase("idle")} aria-label={t("Stop practice")} className="flex size-6 items-center justify-center rounded-[6px] hover:bg-surface-2 hover:text-ink"><X size={13} /></button>
      </div>
      <Preview note={md(note, q.q)} className="practice-md !m-0 mt-2 !max-w-none !text-[14px] font-medium" />
      {q.type === "mcq" ? (
        <div className="mt-2 flex flex-col gap-1.5" role="radiogroup">
          {q.choices!.map((c, k) => {
            const right = k === q.answer, picked = a.picked === k;
            return (
              <button key={k} role="radio" aria-checked={picked} disabled={answered}
                onClick={() => p.set(i, { picked: k, revealed: true, score: right ? 1 : 0 })}
                className={cx("practice-choice flex items-start gap-2 rounded-[9px] border px-2.5 py-1.5 text-start text-[13px]",
                  !answered && "border-line hover:bg-surface-2",
                  answered && right && "border-ok/50 bg-ok/10",
                  answered && picked && !right && "border-bad/50 bg-bad/10",
                  answered && !right && !picked && "border-line opacity-60")}>
                <span className="mt-px font-mono text-[11px] text-muted">{"ABCD"[k] ?? k + 1}</span>
                <Preview note={md(note, c)} className="practice-md !m-0 min-w-0 flex-1 !max-w-none !text-[13px]" />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <textarea dir="auto" rows={q.type === "explain" ? 4 : 2} value={a.text ?? ""} disabled={a.revealed} onChange={(e) => p.set(i, { text: e.target.value })}
            placeholder={q.type === "explain" ? t("Explain it in your own words…") : t("Your answer…")}
            className="w-full resize-y rounded-[9px] border border-line bg-surface px-2.5 py-2 text-[13px] outline-none focus:border-accent" />
          {!a.revealed && <div className="flex gap-2"><Button size="sm" variant="primary" onClick={() => p.set(i, { revealed: true })}>{t("Check")}</Button><Button size="sm" variant="ghost" onClick={() => p.set(i, { revealed: true, text: a.text ?? "" })}>{t("I don't know")}</Button></div>}
          {a.revealed && (
            <div className="rounded-[9px] border border-line bg-surface p-2.5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{q.type === "explain" ? t("Key points") : t("Expected answer")}</div>
              <Preview note={md(note, String(q.answer))} className="practice-md !m-0 !max-w-none !text-[13px]" />
              {a.feedback && <p className="mt-1.5 text-[12px] text-muted" dir="auto">{a.feedback}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] text-muted">{t("How did you do?")}</span>
                {([[1, tk("Got it")], [0.5, tk("Partly")], [0, tk("Missed")]] as const).map(([s, l]) => (
                  <button key={l} onClick={() => p.set(i, { score: s })} className={cx("h-7 rounded-[8px] border px-2.5 text-[12px]", a.score === s ? (s === 1 ? "border-ok/60 bg-ok/15 text-ok" : s ? "border-warn/60 bg-warn/15 text-warn" : "border-bad/60 bg-bad/15 text-bad") : "border-line hover:bg-surface-2")}>{t(l)}</button>
                ))}
                {aiReady && !p.local && !!a.text?.trim() && <Button size="sm" variant="ghost" onClick={() => void p.aiGrade(i)} disabled={a.grading}>{a.grading ? <Loader2 size={12} className="animate-spin" /> : null} {t("Grade it")}</Button>}
              </div>
            </div>
          )}
        </div>
      )}
      {(answered || a.revealed) && (q.why || src || q.source) && (
        <div className="mt-2 text-[12px] text-muted">
          {q.why && <span dir="auto">{q.why} </span>}
          {src ? <button onClick={() => openNote(src.id)} className="inline-flex items-center gap-1 text-link hover:underline"><BookOpen size={11} />{src.title}</button>
            : q.source && q.source !== "general" ? <span className="inline-flex items-center gap-1"><BookOpen size={11} />{q.source}</span>
            : q.source === "general" ? <span className="italic">{t("Not from your notes")}</span> : null}
        </div>
      )}
      <div className="mt-2.5 flex justify-end gap-2">
        {i > 0 && <Button size="sm" variant="ghost" onClick={() => p.setI(i - 1)}>{t("Back")}</Button>}
        <Button size="sm" variant={answered ? "primary" : "secondary"} onClick={p.next} disabled={!answered}>{i + 1 < qs.length ? t("Next") : t("See score")}</Button>
      </div>
    </section>
  );
}
