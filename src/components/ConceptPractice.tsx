// Concept practice (learning paths): 5 mixed questions written by the AI from the concept's own course material
// (coverage topics' lesson notes + the concept's linked notes), an in-place quiz, "tested out" on ≥ 80 %,
// and "Save as flashcards" (appends `- Q :: A` lines to the concept note so they enter Review / FSRS).
// Offline / signed out / AI failure: falls back to a quiz built from the flashcards already in that material.
import { BookOpen, Check, Layers, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Note } from "../../shared/types";
import { findOrCreateByTitle, updateNote } from "../lib/actions";
import { api, getToken } from "../lib/api";
import { db } from "../lib/db";
import { flashcards, splitFrontMatter } from "../lib/parse";
import { linkNote, setManualDone, type BuiltConcept, type BuiltPath } from "../lib/path";
import { openNote, toast, useVault } from "../lib/store";
import { Preview } from "./Preview";
import { Button, cx } from "./ui";

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

const PASS = 0.8;
const MAX_CHARS = 18_000;

/** Course material for a concept: its linked notes first, then every course lesson note on it (deduped, capped). */
export function gatherMaterial(concept: BuiltConcept, byTitle: Map<string, Note>) {
  const titles = [...concept.def.notes, ...concept.coverage.map((c) => c.topic.note).filter((t): t is string => !!t)];
  const notes: Note[] = [];
  for (const t of titles) {
    const n = byTitle.get(t.trim().toLowerCase());
    if (n && !n.deleted && !notes.includes(n) && !["canvas", "whiteboard", "diagram"].includes(n.type)) notes.push(n);
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
  const cards = notes.flatMap((n) => flashcards(n.body).map((c) => ({ ...c, source: n.title })));
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
  return /fetch|network|offline/i.test(m) ? "You're offline." : m;
}

/**
 * Practice questions for one learning-path concept.
 * `note` = the path note (its body holds the concept). `onTestOut` defaults to marking the concept learned
 * through `setManualDone` (which also starts its revision ladder).
 */
export function ConceptPractice({ concept, path, note, onTestOut, className }: { concept: BuiltConcept; path: BuiltPath; note: Note; onTestOut?: () => void; className?: string }) {
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
  void path; // part of the public props (callers pass the built path); the concept already carries its coverage

  function begin(list: PracticeQuestion[], fromCards: boolean) {
    setQs(list); setAns(list.map(() => ({}))); setI(0); setSaved(false); setTestedOut(false); setLocal(fromCards); setPhase("quiz");
  }
  async function start() {
    setMsg(null);
    const fallback = (why: string) => {
      const l = localQuiz(material.notes);
      if (l.length) { begin(l, true); setMsg(`${why} Practising with the flashcards already in this concept's notes.`); }
      else { setPhase("idle"); setMsg(`${why} Practice questions need the AI${material.notes.length ? "" : " (and there are no flashcards in linked notes to fall back on)"}.`); }
    };
    if (!signedIn) return fallback("AI needs sync: unlock it in Settings → Sync.");
    if (!online) return fallback("You're offline.");
    setPhase("loading");
    try {
      const { text } = await api<{ text: string }>("/ai/practice", { method: "POST", json: { mode: "quiz", text: material.text } });
      const list = parseQuiz(text);
      if (list.length < 3) return fallback("The AI answer couldn't be read.");
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
      if (sc === undefined) throw new Error("The AI grade couldn't be read: grade it yourself.");
      set(k, { grading: false, score: sc, feedback: r?.feedback });
    } catch (e) { set(k, { grading: false }); toast(stripJsonError(e)); }
  }

  const score = ans.reduce((s, a) => s + (a.score ?? 0), 0);
  const pct = qs.length ? score / qs.length : 0;
  const passed = pct >= PASS;

  async function testOut() {
    if (onTestOut) onTestOut();
    else {
      if (!concept.placed) return toast("Place this concept in a stage first.");
      const fresh = (await db.notes.get(note.id)) ?? note;
      await updateNote(note.id, { body: setManualDone(fresh.body, concept, true) });
    }
    setTestedOut(true);
    toast(`${concept.def.name}: marked learned (tested out)`);
  }

  async function saveCards() {
    const lines = toCardLines(qs);
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
    if (!fresh.length) { setSaved(true); return toast(`Already in “${cur.title}”`); }
    const body = cur.body.trimEnd() + (/^## Practice cards\s*$/m.test(cur.body) ? "\n" : "\n\n## Practice cards\n\n") + fresh.join("\n") + "\n";
    await updateNote(cur.id, { body });
    setSaved(true);
    toast(`${fresh.length} ${fresh.length === 1 ? "card" : "cards"} added to “${cur.title}”`, { label: "Open", run: () => openNote(cur.id) });
  }

  const md = (body: string) => ({ id: note.id, body, spaceId: note.spaceId });
  const sourceNote = (t?: string) => (t && t !== "general" ? v.byTitle.get(t.trim().toLowerCase()) : undefined);

  // ------------------------------------------------------------------ idle / loading
  if (phase === "idle" || phase === "loading") {
    return (
      <section className={cx("practice rounded-[12px] border border-line bg-surface-2/40 p-3", className)}>
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="shrink-0 text-learn" />
          <span className="min-w-0 flex-1 text-[13px]"><b>Practice</b><span className="text-muted"> · 5 questions from {material.notes.length ? `${material.notes.length} ${material.notes.length === 1 ? "note" : "notes"}` : "the concept name"}</span></span>
          <Button size="sm" variant="primary" onClick={() => void start()} disabled={phase === "loading"}>
            {phase === "loading" ? <><Loader2 size={13} className="animate-spin" /> Writing…</> : learned ? "Practice" : "Test out"}
          </Button>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
          {learned ? "Check you still know it: multiple choice, short answers and one explanation." : `Score ${PASS * 100}% or more to mark it learned without the lessons.`}
          {!aiReady && !msg && <> {signedIn ? "Offline: " : "AI needs sync (Settings → Sync): "}uses the flashcards in its notes instead.</>}
          {!material.notes.length && aiReady && " No lesson notes are linked yet, so questions come from general knowledge."}
        </p>
        {msg && <p className="mt-1.5 text-[12px] text-warn" role="status">{msg}</p>}
      </section>
    );
  }

  // ------------------------------------------------------------------ results
  if (phase === "done") {
    return (
      <section className={cx("practice rounded-[12px] border p-3", passed ? "border-ok/40 bg-ok/[.06]" : "border-line bg-surface-2/40", className)}>
        <div className="flex items-center gap-2">
          <span className={cx("text-[20px] font-[650] tabular-nums", passed ? "text-ok" : "text-ink")}>{Math.round(pct * 100)}%</span>
          <span className="min-w-0 flex-1 text-[12.5px] text-muted">{score % 1 ? score.toFixed(1) : score} / {qs.length} · {passed ? "passed" : `${PASS * 100}% to pass`}</span>
          <button onClick={() => setPhase("idle")} aria-label="Close practice" className="flex size-7 items-center justify-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-ink"><X size={14} /></button>
        </div>
        <ol className="mt-2 flex flex-col gap-1 text-[12.5px]">
          {qs.map((q, k) => (
            <li key={k} className="flex items-start gap-2">
              <span className={cx("mt-[3px] size-2 shrink-0 rounded-full", (ans[k].score ?? 0) >= 1 ? "bg-ok" : (ans[k].score ?? 0) > 0 ? "bg-warn" : "bg-bad")} />
              <button className="min-w-0 flex-1 truncate text-left hover:text-ink" dir="auto" onClick={() => { setI(k); setPhase("quiz"); }}>{oneLine(q.q).replace(/[*_`$]/g, "")}</button>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap gap-2">
          {passed && !learned && !testedOut && <Button size="sm" variant="primary" onClick={() => void testOut()}><Check size={13} /> Mark learned (tested out)</Button>}
          {testedOut && <span className="flex h-7 items-center gap-1 text-[12px] text-ok"><Check size={13} /> Marked learned</span>}
          <Button size="sm" onClick={() => void saveCards()} disabled={saved}><Layers size={13} /> {saved ? "Saved as flashcards" : "Save as flashcards"}</Button>
          <Button size="sm" variant="ghost" onClick={() => void start()}><RotateCcw size={13} /> New questions</Button>
        </div>
        {local && <p className="mt-2 text-[11.5px] text-muted">Built from your own cards (AI unavailable).</p>}
      </section>
    );
  }

  // ------------------------------------------------------------------ quiz
  const q = qs[i], a = ans[i];
  const answered = a.score !== undefined;
  const src = sourceNote(q.source);
  const next = () => (i + 1 < qs.length ? setI(i + 1) : setPhase("done"));
  return (
    <section className={cx("practice rounded-[12px] border border-line bg-surface-2/40 p-3", className)} aria-label="Practice question">
      <div className="flex items-center gap-2 text-[11.5px] text-muted">
        <span className="flex flex-1 gap-1">{qs.map((_, k) => <span key={k} className={cx("h-1.5 flex-1 rounded-full", k === i ? "bg-learn" : ans[k].score === undefined ? "bg-surface-2" : ans[k].score! >= 1 ? "bg-ok" : ans[k].score! > 0 ? "bg-warn" : "bg-bad")} />)}</span>
        <span className="tabular-nums">{i + 1} / {qs.length}</span>
        <span className="uppercase tracking-wide">{q.type === "mcq" ? "Choice" : q.type === "short" ? "Short answer" : "Explain"}</span>
        <button onClick={() => setPhase("idle")} aria-label="Stop practice" className="flex size-6 items-center justify-center rounded-[6px] hover:bg-surface-2 hover:text-ink"><X size={13} /></button>
      </div>
      <Preview note={md(q.q)} className="practice-md !m-0 mt-2 !max-w-none !text-[14px] font-medium" />
      {q.type === "mcq" ? (
        <div className="mt-2 flex flex-col gap-1.5" role="radiogroup">
          {q.choices!.map((c, k) => {
            const right = k === q.answer, picked = a.picked === k;
            return (
              <button key={k} role="radio" aria-checked={picked} disabled={answered}
                onClick={() => set(i, { picked: k, revealed: true, score: right ? 1 : 0 })}
                className={cx("practice-choice flex items-start gap-2 rounded-[9px] border px-2.5 py-1.5 text-left text-[13px]",
                  !answered && "border-line hover:bg-surface-2",
                  answered && right && "border-ok/50 bg-ok/10",
                  answered && picked && !right && "border-bad/50 bg-bad/10",
                  answered && !right && !picked && "border-line opacity-60")}>
                <span className="mt-px font-mono text-[11px] text-muted">{"ABCD"[k] ?? k + 1}</span>
                <Preview note={md(c)} className="practice-md !m-0 min-w-0 flex-1 !max-w-none !text-[13px]" />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <textarea dir="auto" rows={q.type === "explain" ? 4 : 2} value={a.text ?? ""} disabled={a.revealed} onChange={(e) => set(i, { text: e.target.value })}
            placeholder={q.type === "explain" ? "Explain it in your own words…" : "Your answer…"}
            className="w-full resize-y rounded-[9px] border border-line bg-surface px-2.5 py-2 text-[13px] outline-none focus:border-accent" />
          {!a.revealed && <div className="flex gap-2"><Button size="sm" variant="primary" onClick={() => set(i, { revealed: true })}>Check</Button><Button size="sm" variant="ghost" onClick={() => set(i, { revealed: true, text: a.text ?? "" })}>I don't know</Button></div>}
          {a.revealed && (
            <div className="rounded-[9px] border border-line bg-surface p-2.5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{q.type === "explain" ? "Key points" : "Expected answer"}</div>
              <Preview note={md(String(q.answer))} className="practice-md !m-0 !max-w-none !text-[13px]" />
              {a.feedback && <p className="mt-1.5 text-[12px] text-muted" dir="auto"><Sparkles size={11} className="mr-1 inline text-learn" />{a.feedback}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] text-muted">How did you do?</span>
                {([[1, "Got it"], [0.5, "Partly"], [0, "Missed"]] as const).map(([s, l]) => (
                  <button key={l} onClick={() => set(i, { score: s })} className={cx("h-7 rounded-[8px] border px-2.5 text-[12px]", a.score === s ? (s === 1 ? "border-ok/60 bg-ok/15 text-ok" : s ? "border-warn/60 bg-warn/15 text-warn" : "border-bad/60 bg-bad/15 text-bad") : "border-line hover:bg-surface-2")}>{l}</button>
                ))}
                {aiReady && !local && !!a.text?.trim() && <Button size="sm" variant="ghost" onClick={() => void aiGrade(i)} disabled={a.grading}>{a.grading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} AI grade</Button>}
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
            : q.source === "general" ? <span className="italic">Not from your notes</span> : null}
        </div>
      )}
      <div className="mt-2.5 flex justify-end gap-2">
        {i > 0 && <Button size="sm" variant="ghost" onClick={() => setI(i - 1)}>Back</Button>}
        <Button size="sm" variant={answered ? "primary" : "secondary"} onClick={next} disabled={!answered}>{i + 1 < qs.length ? "Next" : "See score"}</Button>
      </div>
    </section>
  );
}
