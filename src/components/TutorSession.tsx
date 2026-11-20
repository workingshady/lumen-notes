// AI tutor session — design round 5, Lumen 24 (TutorDesk): R5-24A…S. Explain · Socratic · Feynman on one concept,
// grounded in its notes (numbered [n] citations, a "From your note …" line under each step), with an end-of-session
// summary (got / gaps, suggested flashcards with checkboxes, Mark learned, Schedule a review) and the edge-case cards
// (no notes, signed out, offline). Also: concept picker (Ask › Tutor mode), tutor history + entry (concept sheet).
// State machine + parsing: lib/tutor.ts. Network + threads: lib/ask.ts. Prompts: worker/ext/tutor.ts.
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ChatMessage, ChatSource, ChatThread, Note } from "../../shared/types";
import { createNote, findOrCreateByTitle, updateNote } from "../lib/actions";
import { aiTutor, closeAsk, msg, newChat, openThread, openTutor, setAsk, updateThread } from "../lib/ask";
import { db } from "../lib/db";
import { fmtDate, isRtl, t, useLang } from "../lib/i18n";
import { flashcards } from "../lib/parse";
import {
  addDays, buildPath, conceptCourses, linkNote, moveConcept, norm, parsePath, resolveCourses, serializePath, setManualDone,
  type BuiltConcept, type BuiltPath, type CourseRef,
} from "../lib/path";
import { openNote, setUI, toast, useVault, type Vault } from "../lib/store";
import {
  cardLines, initTutor, loadTutor, materialSources, MODE_INFO, parseFeynman, parseGrade, parseJson, parsePlan, parseSocratic, parseSummary,
  SOCRATIC_QUESTIONS, TUTOR_MODES, TUTOR_STR, tutorPassed, tutorProgress, tutorReduce, tutorScore, verdictLabel,
  type TutorEvent, type TutorMode, type TutorState,
} from "../lib/tutor";
import { GeneralLabel, usePhone } from "./AskVault";
import { gatherMaterial } from "./ConceptPractice";
import { RichAnswer, useAiLocked, useOnline } from "./ChatParts";
import { Glyph } from "./Glyph";
import { openSettings } from "./ShareSheet";
import { cx } from "./ui";

type Layout = "page" | "sheet" | "panel";
const READ = "'Source Serif 4', Georgia, serif";
const READ_AR = "'Noto Naskh Arabic', 'Source Serif 4', serif";

// ------------------------------------------------------------------ what is being learned
export interface Subject { name: string; concept?: BuiltConcept; path?: BuiltPath; pathNote?: Note; note?: Note; notes: Note[]; courses: CourseRef[] }
function builtPathOf(p: Note, v: Vault): BuiltPath {
  const doc = parsePath(p.body);
  return buildPath(p.body, resolveCourses(doc.courses, v.notes, v.spaces));
}
export function resolveSubject(th: Pick<ChatThread, "title" | "pathId" | "conceptKey" | "noteId">, v: Vault): Subject {
  const pathNote = th.pathId ? v.byId.get(th.pathId) : undefined;
  if (pathNote && th.conceptKey) {
    const path = builtPathOf(pathNote, v);
    const concept = path.byKey.get(th.conceptKey);
    if (concept) return { name: concept.def.name, concept, path, pathNote, notes: gatherMaterial(concept, v.byTitle).notes, courses: conceptCourses(concept) };
  }
  const note = th.noteId ? v.byId.get(th.noteId) : undefined;
  if (note) {
    const linked = [...(v.outlinks.get(note.id) ?? [])].map((id) => v.byId.get(id)).filter((n): n is Note => !!n && !n.deleted && !["canvas", "whiteboard", "board", "diagram", "path"].includes(n.type)).slice(0, 3);
    const space = v.spaceMap.get(note.spaceId);
    return { name: note.title, note, notes: [note, ...linked], courses: space ? [{ key: space.id, title: space.name, note: null, color: space.color ?? "var(--muted)", spaceName: space.name, spaceIcon: space.icon, spaceId: space.id }] : [] };
  }
  return { name: th.title, notes: [], courses: [] };
}
/** A learning-path concept this note teaches (linked note or course lesson), if any. */
export function conceptForNote(note: Note, v: Vault): { pathNote: Note; concept: BuiltConcept } | null {
  const low = note.title.toLowerCase();
  for (const p of v.notes) {
    if (p.type !== "path" || p.deleted) continue;
    const path = builtPathOf(p, v);
    const c = path.concepts.find((x) => x.def.notes.some((n) => n.toLowerCase() === low) || x.coverage.some((cv) => cv.topic.note?.toLowerCase() === low) || x.key === norm(note.title));
    if (c) return { pathNote: p, concept: c };
  }
  return null;
}
/** Lesson note ⋯ › Tutor · Explain / Socratic / Feynman: the path concept it teaches, else the note itself. */
export function openTutorForNote(note: Note, v: Vault, mode?: TutorMode) {
  const hit = conceptForNote(note, v);
  if (hit) openTutor({ title: hit.concept.def.name, pathId: hit.pathNote.id, conceptKey: hit.concept.key, mode });
  else openTutor({ title: note.title, noteId: note.id, mode });
}

const STATUS_GLYPH = { done: ["s-done", "var(--success)"], learning: ["s-learning", "var(--info)"], todo: ["s-todo", "var(--muted)"], locked: ["s-todo", "var(--muted)"] } as const;

// ------------------------------------------------------------------ concept picker (Ask › Tutor mode)
export function ConceptPicker({ note, layout }: { note?: Note; layout: Layout }) {
  const v = useVault();
  useLang();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const paths = useMemo(() => v.notes.filter((n) => n.type === "path" && !n.deleted).map((p) => ({ p, path: builtPathOf(p, v) })), [v]);
  const ql = q.trim().toLowerCase();
  const fromNote = note && note.type !== "path" ? conceptForNote(note, v) : null;
  const rows = paths.flatMap(({ p, path }) => path.stages.flatMap((st) => st.concepts.filter((c) => !ql || c.def.name.toLowerCase().includes(ql)).map((c) => ({ p, c, stage: st.name })))).slice(0, 60);
  const pick = (i: number) => { const r = rows[i]; if (r) openTutor({ title: r.c.def.name, pathId: r.p.id, conceptKey: r.c.key }); };
  return (
    <div className={cx("flex min-h-0 w-full flex-1 justify-center overflow-y-auto text-[13px]", layout === "page" ? "pt-8" : "p-4")} data-picker>
      <div className="flex w-[520px] max-w-full flex-col gap-3 pb-6">
        <div role="radiogroup" aria-label={t("Mode")} className="flex gap-0.5 self-start rounded-[10px] border border-line bg-surface p-[3px]">
          <button role="radio" aria-checked={false} onClick={() => newChat()} className="flex h-[30px] items-center px-3 text-muted hover:text-ink">{t("Ask")}</button>
          <button role="radio" aria-checked className="flex h-[30px] items-center gap-1.5 rounded-[8px] bg-surface-2 px-3 font-semibold"><Glyph name="lesson" size={14} color="var(--learn)" />{t("Tutor")}</button>
        </div>
        <label className="flex h-[46px] items-center gap-2.5 rounded-[12px] border border-line bg-surface px-3 text-muted focus-within:border-accent">
          <span className="whitespace-nowrap">{t("Which concept?")}</span>
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} aria-label={t("Find a concept")} dir="auto"
            onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(rows.length - 1, s + 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); } if (e.key === "Enter") pick(sel); }}
            className="min-w-0 flex-1 bg-transparent text-ink caret-accent outline-none" />
        </label>
        {note && note.type !== "path" && !ql && (
          <button onClick={() => openTutorForNote(note, v)} className="flex h-10 items-center gap-2.5 rounded-[8px] px-2.5 text-start hover:bg-surface" data-concept-note>
            <Glyph name={note.type || "note"} size={15} color="var(--learn)" />
            <span dir="auto" className="min-w-0 flex-1 truncate">{fromNote ? fromNote.concept.def.name : note.title}</span>
            <span className="text-[12px] text-muted">{fromNote ? fromNote.pathNote.title : t("The note you're reading")}</span>
          </button>
        )}
        <div className="flex flex-col gap-0.5">
          {rows.map(({ p, c, stage }, i) => {
            const [g, col] = STATUS_GLYPH[c.status] ?? STATUS_GLYPH.todo;
            return (
              <button key={p.id + c.key} onClick={() => pick(i)} onMouseEnter={() => setSel(i)} data-concept={c.key}
                className="flex h-10 items-center gap-2.5 rounded-[8px] px-2.5 text-start" style={{ background: i === sel ? "var(--surface)" : "transparent" }}>
                <Glyph name={g} size={15} color={col} />
                <span dir="auto" className="min-w-0 flex-1 truncate">{c.def.name}</span>
                <span className="text-[12px] text-muted" dir="auto">{stage} · {t(c.status === "done" ? "done" : c.status === "learning" ? "learning" : "todo")}</span>
              </button>
            );
          })}
        </div>
        {!rows.length && <span className="px-2.5 text-muted">{paths.length ? t("No concept matches.") : t("No learning paths yet. Open a lesson note and use ⋯ › Tutor.")}</span>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tutor history (concept sheet)
export function TutorHistory({ pathId, conceptKey }: { pathId: string; conceptKey: string }) {
  useLang();
  const rows = useLiveQuery(() => db.chats.where("conceptKey").equals(conceptKey).filter((th) => !th.deleted && th.pathId === pathId && th.messages.length > 0).toArray(), [pathId, conceptKey]) ?? [];
  if (!rows.length) return <span className="text-[12px] text-muted">{TUTOR_STR.noHistory}</span>;
  const today = new Date().toDateString();
  return (
    <div className="flex flex-col gap-1.5" aria-label={TUTOR_STR.history} data-tutor-history>
      <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{TUTOR_STR.history} · {rows.length}</span>
      <div className="flex flex-col">
        {rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6).map((th) => {
          const s = loadTutor(th.tutor, th.mode as TutorMode);
          const sc = s.summary?.score ?? tutorScore(s);
          const any = !!(s.summary || s.results.length || s.reviews.length);
          const color = !any ? "var(--muted)" : sc >= 0.8 ? "var(--success)" : sc >= 0.5 ? "var(--warning)" : "var(--danger)";
          const val = !any ? "…" : th.mode === "feynman" ? String(Math.round(sc * 100)) : th.mode === "explain" ? `${s.results.filter((x) => x >= 0.75).length}/${Math.max(s.results.length, s.checks.length || 3)}` : `${s.results.filter((x) => x >= 0.75).length}/${Math.max(s.results.length, 1)}`;
          return (
            <button key={th.id} onClick={() => { setAsk({ open: true }); openThread(th.id); }} className="flex min-h-[42px] items-center gap-2.5 border-t border-line text-start hover:text-link">
              <span className="w-[76px] text-[12px] text-muted">{new Date(th.updatedAt).toDateString() === today ? t("Today") : fmtDate(th.updatedAt, { day: "numeric", month: "short" })}</span>
              <span className="flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold text-learn" style={{ background: "color-mix(in srgb, var(--learn) 14%, transparent)" }}>{MODE_INFO[th.mode as TutorMode]?.name ?? th.mode}</span>
              <span className="flex-1" />
              <span className="h-[5px] w-[60px] overflow-hidden rounded-[3px] bg-surface"><span className="block h-full" style={{ width: `${any ? Math.round(sc * 100) : 0}%`, background: color }} /></span>
              <span className="w-[30px] text-end font-semibold">{val}</span>
            </button>
          );
        })}
      </div>
      <span className="text-[12px] leading-[17px] text-muted">{t("Passing score (≥ 80 % or 3/3 checks) lets you mark the concept learned. Sessions sync with your chats and show in Ask.")}</span>
    </div>
  );
}

/** Concept sheet: "Learn with tutor" + this concept's past tutor sessions (R5-24 entry points). */
export function TutorEntry({ pathId, c }: { pathId: string; c: BuiltConcept }) {
  useLang();
  return (
    <div className="flex flex-col gap-3.5 pt-1" data-tutor-entry>
      <button onClick={() => openTutor({ title: c.def.name, pathId, conceptKey: c.key })} className="flex h-[38px] items-center justify-center gap-2 rounded-[10px] bg-accent font-semibold text-accent-fg" data-act="learn-with-tutor">
        <Glyph name="lesson" size={15} />{TUTOR_STR.learnWithTutor}
      </button>
      <TutorHistory pathId={pathId} conceptKey={c.key} />
    </div>
  );
}

// ------------------------------------------------------------------ cards
const label = "text-[11.5px] font-semibold uppercase tracking-[.04em]";
const stripCites = (s: string) => s.replace(/\s?\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g, "");
const FB: Record<string, { c: string; g: string; l: () => string }> = {
  correct: { c: "var(--success)", g: "s-done", l: () => TUTOR_STR.correct },
  partly: { c: "var(--warning)", g: "s-revise", l: () => TUTOR_STR.partly },
  not_yet: { c: "var(--danger)", g: "c-danger", l: () => TUTOR_STR.notYet },
  gap: { c: "var(--warning)", g: "c-warning", l: () => t("Gap found") },
  jargon: { c: "var(--info)", g: "c-info", l: () => t("Jargon to explain") },
  wrong: { c: "var(--danger)", g: "c-danger", l: () => t("Not quite right") },
};
function Feedback({ kind, text, quote, sources, onOpen, rf }: { kind: string; text: string; quote?: string; sources: ChatSource[]; onOpen: (id: string) => void; rf: string }) {
  const f = FB[kind] ?? FB.not_yet;
  return (
    <div className="flex flex-col gap-1.5 rounded-[12px] border px-3.5 py-2.5" style={{ background: `color-mix(in srgb, ${f.c} 9%, transparent)`, borderColor: `color-mix(in srgb, ${f.c} 32%, transparent)` }} data-card="feedback" data-verdict={kind}>
      <span className="flex items-center gap-2 font-semibold" style={{ color: f.c }}><Glyph name={f.g} size={15} />{f.l()}</span>
      <div className="leading-[20px]" dir="auto"><RichAnswer text={text} sources={sources} size={13} ui onOpen={onOpen} /></div>
      {quote && <span dir="auto" className="border-s-[3px] ps-2.5 leading-[20px] text-muted" style={{ borderColor: f.c, fontFamily: rf }}>“{quote}”</span>}
    </div>
  );
}
const ISSUE_ORDER = { wrong: 0, jargon: 1, gap: 2 } as const;
const scoreColor = (n: number) => (n >= 75 ? "var(--success)" : n >= 50 ? "var(--warning)" : "var(--danger)");

// ------------------------------------------------------------------ the session
export function TutorSession({ thread, layout, onOpened }: { thread: ChatThread; layout: Layout; onOpened?: () => void }) {
  const v = useVault();
  useLang();
  const online = useOnline();
  const phone = usePhone() || layout === "sheet";
  const mode = thread.mode as TutorMode;
  const subj = useMemo(() => resolveSubject(thread, v), [thread.pathId, thread.conceptKey, thread.noteId, thread.title, v]); // eslint-disable-line react-hooks/exhaustive-deps
  const sources = useMemo(() => materialSources(subj.notes.map((n) => ({ id: n.id, title: n.title, body: n.body }))), [subj.notes]);
  const s = loadTutor(thread.tutor, mode);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; retry: () => void } | null>(null);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<boolean[] | null>(null);
  const [general, setGeneral] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const autoStarted = useRef<string | null>(null);
  const ar = isRtl() || /[؀-ۿ]/.test(subj.name);
  const rf = ar ? READ_AR : READ;
  const open = (id: string) => { openNote(id); onOpened?.(); };
  const locked = useAiLocked();
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [thread.messages.length, busy]);
  useEffect(() => { setErr(null); setDraft(""); setPicked(null); }, [thread.id]);

  const payload = sources.map(({ n, title, text }) => ({ n, title, text }));
  const hist = (ms: ChatMessage[]) => ms.filter((m) => m.text.trim()).slice(-12).map((m) => ({ role: m.role, text: m.text }));
  const call = (op: string, input?: string, extra?: Record<string, unknown>, ms = thread.messages) => aiTutor({ op, concept: subj.name, sources: payload, input, history: hist(ms), extra });
  const commit = (next: TutorState, add: ChatMessage[]) => updateThread(thread.id, (th) => { th.tutor = next as unknown as Record<string, unknown>; th.messages.push(...add); });
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    if (!online || locked) return;
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) {
      const m = (e as Error).message || t("The tutor didn't answer.");
      setErr({ text: /fetch|network/i.test(m) ? t("You're offline.") : m, retry: () => void run(fn) });
    } finally { setBusy(false); }
  };
  const red = (st: TutorState, ...es: TutorEvent[]) => es.reduce(tutorReduce, st);
  const stepMsg = (st: TutorState) => { const x = st.steps[st.step]; return msg("assistant", `${x.title ? `**${x.title}**\n\n` : ""}${x.text}`, { tutor: { kind: "step", i: st.step + 1, of: st.steps.length } }); };
  const checkMsg = (st: TutorState) => msg("assistant", st.checks[st.check].q, { tutor: { kind: "question", i: st.check + 1, of: st.checks.length } });
  const qMsg = (st: TutorState) => msg("assistant", st.q!.q, { tutor: { kind: "question", i: st.asked, of: SOCRATIC_QUESTIONS } });
  const unread = () => new Error(t("The tutor's answer couldn't be read. Try again."));

  const start = () => run(async () => {
    const st0 = initTutor(mode);
    if (mode === "explain") {
      const p = parsePlan(await call("plan", undefined, undefined, []));
      if (!p) throw unread();
      const st = red(st0, { type: "plan", ...p });
      await commit(st, [stepMsg(st)]);
    } else if (mode === "socratic") {
      const r = parseSocratic(await call("socratic", undefined, undefined, []));
      if (!r?.q) throw unread();
      const st = red(st0, { type: "question", q: r.q });
      await commit(st, [qMsg(st)]);
    } else {
      await commit(st0, [msg("assistant", t("Explain **{name}** in your own words, as if to a friend who has never heard of it. I'll quote anything that's missing, not quite right, or jargon you didn't explain, and give you a clarity score.", { name: subj.name }), { tutor: { kind: "step" } })]);
    }
  });
  const finish = (st: TutorState) => run(async () => {
    const fresh = (await db.chats.get(thread.id))?.messages ?? thread.messages;
    const p = parseSummary(await call("summary", undefined, undefined, fresh.slice(-24))) ?? { right: [], gaps: [], cards: [] };
    const next = red(st, { type: "finish" }, { type: "summary", summary: { ...p, score: tutorScore(st), passed: tutorPassed(st) } });
    await commit(next, [msg("assistant", "", { tutor: { kind: "summary" } })]);
  });
  const gotIt = () => run(async () => {
    const st = red(s, { type: "got-it" });
    if (st.phase === "step") await commit(st, [stepMsg(st)]);
    else if (st.phase === "check") await commit(st, [checkMsg(st)]);
    else { await commit(st, []); setBusy(false); void finish(st); }
  });
  const rephrase = (how: "differently" | "example") => run(async () => {
    const j = parseJson<{ title?: string; text?: string }>(await call("rephrase", undefined, { how, step: s.steps[s.step]?.text ?? "", retry: s.retries }));
    if (!j?.text) throw unread();
    // "Example" inserts a worked example and keeps the step; "Explain differently" counts as a retry
    await commit(how === "example" ? s : red(s, { type: "rephrased" }), [msg("user", how === "example" ? t("Example please") : t("Explain it differently")), msg("assistant", j.text, { tutor: { kind: "explanation", how } })]);
  });
  const askStep = (text: string) => run(async () => {
    const j = parseJson<{ text?: string }>(await call("ask", text, { step: s.steps[s.step]?.text ?? "" }));
    if (!j?.text) throw unread();
    await commit(s, [msg("user", text), msg("assistant", j.text, { tutor: { kind: "explanation", how: "ask" } })]);
    setDraft("");
  });
  const answerCheck = (text: string) => run(async () => {
    const q = s.checks[s.check];
    const user = msg("user", text);
    const g = parseGrade(await call("grade", text, { question: q.q, expected: q.answer }));
    if (!g) throw unread();
    const st = red(s, { type: "graded", verdict: g.verdict });
    const add = [user, msg("assistant", g.feedback || verdictLabel(g.verdict), { tutor: { kind: "feedback", verdict: g.verdict } })];
    if (st.phase === "check") add.push(checkMsg(st));
    await commit(st, add);
    setDraft("");
    if (st.phase === "done") { setBusy(false); void finish(st); }
  });
  const nextQuestion = (st: TutorState, ms: ChatMessage[]) => run(async () => {
    const r = parseSocratic(await call("socratic", undefined, undefined, ms));
    if (!r?.q || r.done) { setBusy(false); void finish(red(st, { type: "finish" })); return; }
    const n = red(st, { type: "question", q: r.q });
    await commit(n, [qMsg(n)]);
  });
  const socraticReply = (text: string) => run(async () => {
    const q = s.q!;
    const user = msg("user", text);
    const r = parseSocratic(await call("socratic", text, { question: q.q, expected: q.answer }));
    if (!r) throw unread();
    const verdict = r.verdict ?? "not_yet";
    let st = red(s, { type: "graded", verdict });
    const add = [user, msg("assistant", r.feedback || verdictLabel(verdict), { tutor: { kind: "feedback", verdict } })];
    if (verdict === "correct" && st.phase === "closed" && r.q && !r.done) { st = red(st, { type: "question", q: r.q }); add.push(qMsg(st)); }
    await commit(st, add);
    setDraft("");
    if (st.phase === "done" || (verdict === "correct" && r.done)) { setBusy(false); void finish(red(st, { type: "finish" })); }
    else if (st.phase === "closed") { setBusy(false); void nextQuestion(st, [...thread.messages, ...add]); }
  });
  const hint = () => run(async () => {
    const st = red(s, { type: "hint" });
    if (st.hint === s.hint || !s.q) return;
    await commit(st, [msg("assistant", s.q.hints[st.hint - 1], { tutor: { kind: "hint", i: st.hint } })]);
  });
  const showAnswer = () => run(async () => {
    const st = red(s, { type: "show-answer" });
    const add = [msg("assistant", s.q?.answer || "—", { tutor: { kind: "answer" } })];
    await commit(st, add);
    setBusy(false);
    if (st.phase === "done") void finish(st); else void nextQuestion(st, [...thread.messages, ...add]);
  });
  const feynman = (text: string) => run(async () => {
    const r = parseFeynman(await call("feynman", text));
    if (!r) throw unread();
    await commit(red(s, { type: "reviewed", score: r.score }), [msg("user", text), msg("assistant", r.ask, { tutor: { kind: "review", score: r.score, reasons: r.reasons, issues: r.issues } })]);
    setDraft("");
  });
  const switchMode = (m: TutorMode) => { if (m !== mode) openTutor({ title: subj.name, pathId: thread.pathId, conceptKey: thread.conceptKey, noteId: thread.noteId, mode: m }); };
  const started = thread.messages.length > 0;
  const endSession = () => { if (s.phase === "summary" || !started) return newChat(); void finish(s); };

  // start on open (the entry point already chose the mode); no notes → wait for "Use general knowledge"
  const canStart = online && !locked && (sources.length > 0 || general);
  useEffect(() => {
    if (started || !canStart || autoStarted.current === thread.id) return;
    autoStarted.current = thread.id;
    void start();
  }, [thread.id, started, canStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------ summary actions
  const sum = s.summary;
  const patchSummary = (p: Partial<NonNullable<TutorState["summary"]>>) => updateThread(thread.id, (th) => { const st = loadTutor(th.tutor, mode); if (st.summary) th.tutor = { ...st, summary: { ...st.summary, ...p } } as unknown as Record<string, unknown>; });
  async function saveCards() {
    if (!sum) return;
    const chosen = sum.cards.filter((_, i) => picked?.[i] ?? true);
    if (!chosen.length) return;
    let target: Note | null = subj.note ?? subj.notes.find((n) => subj.concept?.def.notes.some((x) => x.toLowerCase() === n.title.toLowerCase())) ?? subj.notes[0] ?? null;
    if (!target) {
      if (subj.concept && subj.pathNote) {
        target = await findOrCreateByTitle(subj.name, subj.pathNote.spaceId);
        const fresh = (await db.notes.get(subj.pathNote.id)) ?? subj.pathNote;
        if (subj.concept.placed) await updateNote(fresh.id, { body: linkNote(fresh.body, subj.concept, target.title) });
      } else target = await createNote({ title: `${subj.name} · cards`, type: "flashcards", body: `# ${subj.name} · cards\n` });
    }
    const cur = (await db.notes.get(target.id)) ?? target;
    const have = new Set(flashcards(cur.body).map((c) => c.q.toLowerCase()));
    const lines = cardLines(chosen).filter((l) => !have.has(l.slice(2, l.indexOf(" :: ")).trim().toLowerCase()));
    if (lines.length) await updateNote(cur.id, { body: cur.body.trimEnd() + (/^## Tutor cards\s*$/m.test(cur.body) ? "\n" : "\n\n## Tutor cards\n\n") + lines.join("\n") + "\n" });
    await patchSummary({ savedCards: chosen.length });
    toast(lines.length ? t("{n} card added to “{title}”|{n} cards added to “{title}”", { n: lines.length, title: cur.title }) : t("Already in “{title}”", { title: cur.title }), { label: t("Open"), run: () => openNote(cur.id) });
  }
  async function markLearned() {
    if (!subj.concept || !subj.pathNote || !subj.path) return;
    const fresh = (await db.notes.get(subj.pathNote.id)) ?? subj.pathNote;
    const body = subj.concept.placed ? fresh.body : moveConcept(fresh.body, subj.concept, subj.path.doc.stages[0]?.name ?? "Stage 1");
    await updateNote(fresh.id, { body: setManualDone(body, subj.concept, true) });
    await patchSummary({ learned: 1 });
    toast(t("{name}: marked learned", { name: subj.name }));
  }
  async function scheduleReview() {
    if (!subj.concept || !subj.pathNote || !subj.path) return;
    const fresh = (await db.notes.get(subj.pathNote.id)) ?? subj.pathNote;
    const base = subj.concept.placed ? fresh.body : moveConcept(fresh.body, subj.concept, subj.path.doc.stages[0]?.name ?? "Stage 1");
    const doc = parsePath(base);
    const day = addDays(new Date().toISOString().slice(0, 10), sum?.passed ? 3 : 1);
    for (const st of doc.stages) for (const c of st.concepts) if (norm(c.name) === subj.concept.key) { c.review = day; if (!c.interval) c.interval = 1; }
    await updateNote(fresh.id, { body: serializePath(doc) });
    await patchSummary({ reviewOn: day });
    toast(TUTOR_STR.scheduled(day));
  }
  const learned = subj.concept?.status === "done" || !!sum?.learned;
  const nPicked = sum ? sum.cards.filter((_, i) => picked?.[i] ?? true).length : 0;
  const okCount = s.results.filter((x) => x >= 0.75).length;
  const bigScore = mode === "feynman" ? String(s.reviews[s.reviews.length - 1] ?? 0) : `${okCount} / ${Math.max(s.results.length, mode === "explain" ? s.checks.length : 1)}`;
  const sumSub = mode === "explain" ? t("Explain · {steps} steps · {ok} of {n} check questions", { steps: s.steps.length, ok: okCount, n: s.checks.length || s.results.length })
    : mode === "socratic" ? t("Socratic · {n} questions · {ok} answered", { n: s.results.length, ok: okCount })
    : t("Feynman · {n} explanations · clarity {score}", { n: s.reviews.length, score: s.reviews[s.reviews.length - 1] ?? 0 });
  const btn38 = "flex h-[38px] items-center rounded-[10px] border border-line px-3.5 hover:bg-surface-2 disabled:opacity-60";
  const summaryNode = sum && (
    <div className="flex flex-col gap-4 rounded-[16px] border border-line bg-surface p-5" data-card="summary">
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${sum.passed ? "var(--success)" : "var(--warning)"} 16%, transparent)` }}><Glyph name={sum.passed ? "s-done" : "s-revise"} size={22} color={sum.passed ? "var(--success)" : "var(--warning)"} /></span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5"><span dir="auto" className="text-[17px] font-[650]">{t("{name} · session done", { name: subj.name })}</span><span className="text-muted">{sumSub}</span></div>
        <b className="text-[24px]">{bigScore}</b>
      </div>
      <div className={cx("grid gap-3.5", phone ? "grid-cols-1" : "grid-cols-2")}>
        <div className="flex flex-col gap-1.5"><span className="text-[11px] font-semibold uppercase tracking-[.06em] text-ok">{t("You got")}</span>{sum.right.map((x) => <span key={x} dir="auto" className="flex gap-2 leading-[19px]"><Glyph name="s-done" size={14} color="var(--success)" style={{ marginTop: 2 }} />{x}</span>)}</div>
        <div className="flex flex-col gap-1.5"><span className="text-[11px] font-semibold uppercase tracking-[.06em] text-warn">{t("Gaps")}</span>{sum.gaps.map((x) => <span key={x} dir="auto" className="flex gap-2 leading-[19px]"><Glyph name="s-revise" size={14} color="var(--warning)" style={{ marginTop: 2 }} />{x}</span>)}</div>
      </div>
      {sum.cards.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center"><span className="flex-1 text-[11px] font-semibold uppercase tracking-[.06em] text-learn">{TUTOR_STR.cards}</span><span className="text-[12px] text-muted">{t("{n} of {m} picked", { n: nPicked, m: sum.cards.length })}</span></div>
          {sum.cards.map((c, i) => {
            const on = picked?.[i] ?? true;
            return (
              <button key={i} role="checkbox" aria-checked={on} onClick={() => setPicked((p) => { const a = p ?? sum.cards.map(() => true); a[i] = !on; return [...a]; })} disabled={!!sum.savedCards}
                className="flex min-h-10 items-center gap-2.5 rounded-[9px] border border-line bg-bg px-2.5 py-2 text-start" style={{ opacity: on ? 1 : 0.55 }} data-card-pick>
                <span className="flex size-4 shrink-0 items-center justify-center rounded-[4px]" style={on ? { background: "var(--learn)" } : { border: "1.5px solid var(--muted)" }}></span>
                <span dir="auto" className="flex-1 leading-[18px]">{c.q}</span>
                {!phone && <span dir="auto" className="text-[12px] text-muted">{c.a}</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {subj.concept && sum.passed && <button onClick={() => void markLearned()} disabled={learned} className="flex h-[38px] items-center rounded-[10px] bg-accent px-4 font-semibold text-accent-fg disabled:opacity-60" data-act="learned">{learned ? TUTOR_STR.learned : TUTOR_STR.markLearned}</button>}
        {sum.cards.length > 0 && <button onClick={() => void saveCards()} disabled={!!sum.savedCards || !nPicked} className={btn38} data-act="save-cards">{sum.savedCards ? TUTOR_STR.saved : TUTOR_STR.saveCards(nPicked)}</button>}
        {subj.concept && <button onClick={() => void scheduleReview()} disabled={!!sum.reviewOn} className={btn38} data-act="schedule">{sum.reviewOn ? TUTOR_STR.scheduled(sum.reviewOn) : TUTOR_STR.schedule}</button>}
        <button onClick={() => { const m = mode; newChat(); openTutor({ title: subj.name, pathId: thread.pathId, conceptKey: thread.conceptKey, noteId: thread.noteId, mode: m }); }} className="flex h-[38px] items-center px-2 text-muted hover:text-ink">{TUTOR_STR.again}</button>
      </div>
    </div>
  );

  // ------------------------------------------------ cards
  const lastAssistant = [...thread.messages].reverse().find((m) => m.role === "assistant");
  const citeLine = (text: string) => {
    const n = Number(/\[(\d{1,2})/.exec(text)?.[1] ?? 0);
    const src = sources.find((x) => x.n === n) ?? (sources.length === 1 ? sources[0] : undefined);
    if (!src) return null;
    const course = v.spaceMap.get(v.byId.get(src.noteId)?.spaceId ?? "")?.name;
    return <button onClick={() => open(src.noteId)} className="self-start text-start text-[12px] text-link hover:underline" dir="auto" data-cite>{t("From your note “{title}”", { title: src.title })}{course ? ` · ${course}` : ""}</button>;
  };
  const actBtn = (on: boolean) => cx("flex h-8 items-center rounded-[9px] border px-3 disabled:opacity-50", on ? "border-accent font-semibold" : "border-line hover:bg-surface-2");
  const stepActions = (m: ChatMessage) => m === lastAssistant && s.phase === "step" && (
    <div className="flex flex-wrap gap-2" data-controls="step">
      <button onClick={gotIt} disabled={busy} className={actBtn(true)} style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)" }} data-act="got-it">{TUTOR_STR.gotIt}</button>
      <button onClick={() => rephrase("differently")} disabled={busy} className={actBtn(false)} data-act="differently">{TUTOR_STR.differently}</button>
      {m.tutor?.how !== "example" && <button onClick={() => rephrase("example")} disabled={busy} className={actBtn(false)} data-act="example">{TUTOR_STR.example}</button>}
    </div>
  );
  // Socratic: the open question's card holds the first reply, the hint ladder and Answer
  const openQ = mode === "socratic" && s.phase === "question" ? [...thread.messages].reverse().find((m) => m.tutor?.kind === "question") : undefined;
  const replyAfter = (m: ChatMessage) => { const i = thread.messages.indexOf(m); const r = thread.messages.slice(i + 1).find((x) => x.role === "user"); const f = r ? thread.messages.slice(thread.messages.indexOf(r) + 1).find((x) => x.tutor?.kind === "feedback") : undefined; return { r, f }; };

  const renderMsg = (m: ChatMessage): ReactNode => {
    const tc = m.tutor;
    if (m.role === "user") {
      // the first reply to a Socratic question shows inside its card
      if (mode === "socratic") { const i = thread.messages.indexOf(m); const q = [...thread.messages.slice(0, i)].reverse().find((x) => x.tutor?.kind === "question"); if (q && replyAfter(q).r === m) return null; }
      return <div key={m.id} dir="auto" data-msg="user" className="max-w-[78%] self-end whitespace-pre-wrap rounded-[14px] bg-surface-2 px-3.5 py-2.5 leading-[21px]">{m.text}</div>;
    }
    if (!tc) return <RichAnswer key={m.id} text={m.text} sources={sources} size={15} onOpen={open} />;
    if (tc.kind === "summary") return <div key={m.id}>{summaryNode}</div>;
    if (tc.kind === "feedback") return <Feedback key={m.id} kind={tc.verdict ?? "not_yet"} text={m.text} sources={sources} onOpen={open} rf={rf} />;
    if (tc.kind === "review") return (
      <div key={m.id} className="flex flex-col gap-3.5" data-card="review">
        {[...(tc.issues ?? [])].sort((a, b) => ISSUE_ORDER[a.kind] - ISSUE_ORDER[b.kind]).map((x, i) => <Feedback key={i} kind={x.kind} text={x.comment} quote={x.kind === "gap" ? undefined : x.quote} sources={sources} onOpen={open} rf={rf} />)}
        <div className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface px-4 py-3.5" data-card="clarity">
          <div className="flex items-baseline gap-2.5"><span className="flex-1 font-semibold">{t("Clarity score")}</span><b className="text-[22px]">{tc.score ?? 0}</b><span className="text-muted">/ 100</span></div>
          {(tc.reasons ?? []).map((r) => (
            <div key={r.label} className="grid items-center gap-2.5" style={{ gridTemplateColumns: phone ? "90px 1fr" : "110px 1fr 140px" }}>
              <span className="text-muted">{t(r.label)}</span>
              <span className="flex h-2 overflow-hidden rounded-[4px] bg-surface-2"><span style={{ width: `${Math.max(0, Math.min(100, r.score))}%`, background: scoreColor(r.score) }} /></span>
              {!phone && <span dir="auto" className="truncate text-[12px] text-muted">{r.note}</span>}
            </div>
          ))}
          {m.text && <span dir="auto" className="text-muted">{stripCites(m.text)}</span>}
        </div>
      </div>
    );
    if (tc.kind === "question") {
      const { r, f } = replyAfter(m);
      const live = m === openQ;
      const v0 = f?.tutor?.verdict;
      const hs = (on: boolean, used: boolean) => ({ borderColor: used ? "color-mix(in srgb, var(--learn) 45%, transparent)" : "var(--border)", background: used ? "color-mix(in srgb, var(--learn) 12%, transparent)" : "transparent", color: on || used ? "var(--text)" : "var(--muted)" });
      return (
        <div key={m.id} className="flex flex-col gap-2.5 rounded-[14px] border bg-surface px-4 py-3.5" style={{ borderColor: mode === "socratic" ? "color-mix(in srgb, var(--learn) 40%, transparent)" : "var(--border)" }} data-card="question">
          <span className={cx(label, mode === "socratic" ? "text-learn" : "text-muted")}>{TUTOR_STR.progressQ(tc.i ?? 1, tc.of ?? 1)}</span>
          <div className="font-medium" dir="auto"><RichAnswer text={m.text} sources={sources} size={ar ? 17 : 16} onOpen={open} /></div>
          {mode === "socratic" && (r || live) && (
            r ? <div dir="auto" className="min-h-16 rounded-[9px] border bg-bg px-3 py-2.5 leading-[20px]" style={{ borderColor: v0 === "correct" ? "var(--success)" : v0 === "partly" ? "var(--warning)" : v0 ? "var(--danger)" : "var(--border)" }}>{r.text}</div>
              : <textarea dir="auto" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("Type your answer…")} aria-label={t("Your answer")} disabled={busy}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && draft.trim()) { e.preventDefault(); socraticReply(draft.trim()); } }}
                  className="min-h-16 resize-none rounded-[9px] border border-line bg-bg px-3 py-2.5 leading-[20px] outline-none placeholder:text-muted focus:border-accent" style={{ fieldSizing: "content" } as CSSProperties} />
          )}
          {live && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label={t("Hints")} data-controls="question">
              <button onClick={hint} disabled={busy || s.hint >= 1 || !s.q?.hints.length} className="flex h-7 items-center rounded-full border px-2.5 text-[12.5px]" style={hs(s.hint < 1, s.hint >= 1)} data-act="hint1">{s.hint >= 1 ? t("Hint 1 · used") : TUTOR_STR.hint1}</button>
              <button onClick={hint} disabled={busy || s.hint !== 1 || (s.q?.hints.length ?? 0) < 2} className="flex h-7 items-center rounded-full border px-2.5 text-[12.5px]" style={hs(s.hint === 1, s.hint >= 2)} data-act="hint2">{s.hint >= 2 ? t("Hint 2 · used") : TUTOR_STR.hint2}</button>
              <button onClick={showAnswer} disabled={busy || s.hint < 2} className="flex h-7 items-center rounded-full border px-2.5 text-[12.5px]" style={hs(s.hint >= 2, false)} title={s.hint < 2 ? t("Use both hints first") : undefined} data-act="show">{TUTOR_STR.showAnswer}</button>
              <span className="flex-1" />
              <button onClick={() => draft.trim() && socraticReply(draft.trim())} disabled={busy || !draft.trim()} className="flex h-[30px] items-center rounded-[9px] bg-accent px-3.5 font-semibold text-accent-fg disabled:cursor-default" data-act="submit">{t("Answer")}</button>
            </div>
          )}
        </div>
      );
    }
    if (tc.kind === "hint" || tc.kind === "answer") return (
      <div key={m.id} className="flex flex-col gap-1 rounded-[12px] border px-3.5 py-2.5" style={{ borderColor: "color-mix(in srgb, var(--learn) 32%, transparent)", background: "color-mix(in srgb, var(--learn) 8%, transparent)" }} data-card={tc.kind}>
        <span className={cx(label, "text-learn")}>{tc.kind === "hint" ? t("Hint {i}", { i: tc.i ?? "" }) : t("Answer")}</span>
        <RichAnswer text={m.text} sources={sources} size={14.5} onOpen={open} />
      </div>
    );
    // step / explanation
    const head = tc.kind === "step" ? (tc.i ? TUTOR_STR.progressStep(tc.i, tc.of ?? tc.i) : t("Your turn")) : tc.how === "example" ? t("Example") : tc.how === "ask" ? t("Answer") : t("Another way");
    return (
      <div key={m.id} className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface px-4 py-3.5" data-card={tc.kind}>
        <span className={cx(label, "text-muted")}>{head}</span>
        {sources.length === 0 && <GeneralLabel />}
        <RichAnswer text={stripCites(m.text)} sources={[]} size={ar ? 17 : 16} onOpen={open} />
        {citeLine(m.text)}
        {stepActions(m)}
      </div>
    );
  };

  // ------------------------------------------------ header
  const prog = tutorProgress(s);
  const pct = s.phase === "summary" ? 100 : Math.round(((prog.done + (started && (s.phase === "step" || s.phase === "check" || s.phase === "question") ? 1 : 0)) / Math.max(1, prog.total)) * 100);
  const progLabel = s.phase === "summary" ? t("Done") : mode === "feynman" ? t("Round {n} · {k} notes found", { n: Math.max(1, s.reviews.length), k: sources.length }) : prog.label;
  const seg = (big: boolean) => TUTOR_MODES.map((m) => (
    <button key={m} role="radio" aria-checked={m === mode} onClick={() => switchMode(m)}
      className={cx("flex items-center justify-center rounded-[7px]", big ? "h-[34px]" : "h-[26px] px-2.5")} style={m === mode ? { background: "var(--surface-2)", fontWeight: 600 } : { color: "var(--muted)", fontWeight: 450 }}>{MODE_INFO[m].name}</button>
  ));
  const bar = <span className="h-1 overflow-hidden rounded-[2px] bg-surface-2"><span className="block h-full bg-learn transition-[width]" style={{ width: `${pct}%` }} /></span>;
  const header = (
    <div className={cx("flex shrink-0 flex-col gap-2.5 border-b border-line", phone ? "px-4 py-3" : "px-7 pb-3 pt-4")} data-tutor-header>
      <div className="flex items-center gap-2.5">
        {phone && <button aria-label={t("Back")} onClick={() => newChat()} className="w-7 text-start text-[18px]"><span aria-hidden>{isRtl() ? "→" : "←"}</span></button>}
        <Glyph name="lesson" size={18} color="var(--learn)" tile="#B48EF0" />
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span dir="auto" className={cx("truncate font-[650]", phone ? "text-[16px]" : "text-[18px]")}>{subj.name}</span>
          {subj.courses.length > 0 && (
            <div className="flex gap-1.5 overflow-hidden">
              {subj.courses.slice(0, phone ? 2 : 3).map((c) => <span key={c.key} className="flex h-5 shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full border border-line bg-surface pe-2 ps-[3px] text-[11.5px]"><span className="h-3 w-[3px] rounded-[2px]" style={{ background: c.color }} />{c.spaceName || c.title}</span>)}
            </div>
          )}
        </div>
        {!phone && <div role="radiogroup" aria-label={t("Tutor mode")} className="flex gap-0.5 rounded-[9px] border border-line bg-surface p-[3px] text-[12.5px]">{seg(false)}</div>}
        {!phone && started && <span className="whitespace-nowrap text-[12px] text-muted">{progLabel}</span>}
        <button onClick={endSession} className="flex h-[30px] shrink-0 items-center whitespace-nowrap rounded-[8px] border border-line px-3 hover:bg-surface-2" data-act="end">{s.phase === "summary" || !started ? t("Close") : TUTOR_STR.endSession}</button>
      </div>
      {phone && <div className="flex flex-col gap-2"><div role="radiogroup" aria-label={t("Tutor mode")} className="grid grid-cols-3 rounded-[9px] border border-line bg-surface p-[3px]">{seg(true)}</div>{bar}</div>}
      {!phone && bar}
    </div>
  );

  // ------------------------------------------------ edge-case cards (R5-24I·J·K)
  let stateCard: ReactNode = null;
  const stateBox = (g: string, c: string, tile: string, title: string, desc: string, a: string, onA: () => void, b?: string, onB?: () => void) => (
    <div className={cx("mt-10 flex flex-col gap-3 self-center rounded-[16px] border border-line bg-surface p-[22px]", phone ? "w-full" : "w-[480px] max-w-full")} data-tutor-state>
      <Glyph name={g} size={22} color={c} tile={tile} />
      <span className="text-[17px] font-[650]">{title}</span><span className="leading-[20px] text-muted" dir="auto">{desc}</span>
      <div className="flex flex-wrap gap-2">
        <button onClick={onA} className="flex h-9 items-center rounded-[10px] bg-accent px-3.5 font-semibold text-accent-fg" data-act="state-primary">{a}</button>
        {b && <button onClick={onB} className="flex h-9 items-center rounded-[10px] border border-line px-3.5 hover:bg-surface-2">{b}</button>}
      </div>
    </div>
  );
  if (locked) stateCard = stateBox("s-locked", "var(--muted)", "#9AA0AA", t("Unlock to use the tutor"), t("The tutor runs on your Cloudflare and needs this device to be unlocked."), t("Unlock"), () => { closeAsk(); openSettings("sync"); });
  else if (!online) stateCard = stateBox("c-info", "var(--info)", "#7AA2F7", t("The tutor needs a connection"), t("Your past sessions and flashcards still work offline."), t("Review cards instead"), () => { closeAsk(); setUI({ view: "review" }); }, t("See past sessions"), () => newChat());
  else if (!started && !sources.length && !general) stateCard = stateBox("note", "var(--muted)", "#9AA0AA", t("No notes on this concept yet"),
    t("The tutor teaches from your notes. You have none on “{name}” yet. You can use general knowledge instead — answers will be labelled “Not from your notes”.", { name: subj.name }),
    t("Use general knowledge"), () => setGeneral(true), t("Write a lesson note first"), async () => {
      const n = await findOrCreateByTitle(subj.name, subj.pathNote?.spaceId ?? "inbox");
      if (subj.concept && subj.pathNote) { const fresh = (await db.notes.get(subj.pathNote.id)) ?? subj.pathNote; if (subj.concept.placed) await updateNote(fresh.id, { body: linkNote(fresh.body, subj.concept, n.title) }); }
      closeAsk(); openNote(n.id, "edit");
    });

  // ------------------------------------------------ composer
  const comp = (() => {
    if (!started || stateCard) return null;
    if (s.phase === "step") return { ph: t("Ask about this step…"), go: askStep };
    if (s.phase === "check") return { ph: t("Type your answer…"), go: answerCheck };
    if (s.phase === "question") return { ph: t("Type your answer…"), go: socraticReply };
    if (s.phase === "explain") return { ph: s.reviews.length ? t("Fix your explanation, or say it again…") : t("Explain it in your own words…"), go: feynman };
    return null;
  })();
  const after: ReactNode = s.phase === "closed" ? <button onClick={() => nextQuestion(s, thread.messages)} disabled={busy} className="flex h-9 items-center self-start rounded-[10px] border border-line px-3.5 hover:bg-surface-2">{TUTOR_STR.next}</button>
    : s.phase === "done" ? <button onClick={() => finish(s)} disabled={busy} className="flex h-9 items-center self-start rounded-[10px] border border-line px-3.5 hover:bg-surface-2" data-act="finish">{TUTOR_STR.finish}</button>
    : s.phase === "explain" && s.reviews.length > 0 ? <button onClick={() => finish(s)} disabled={busy} className="self-start text-[12.5px] text-link hover:underline" data-act="finish">{TUTOR_STR.finish}</button> : null;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col text-[13px]" data-tutor={mode} dir={isRtl() ? "rtl" : undefined}>
      {header}
      <div ref={scroller} className={cx("flex min-h-0 flex-1 justify-center overflow-y-auto", phone ? "px-4 py-3.5" : "px-8 py-6")}>
        <div className={cx("flex max-w-full flex-col gap-3.5", phone ? "w-[380px]" : "w-[720px]")}>
          {stateCard}
          {!stateCard && !started && busy && <span className="text-muted" role="status">{TUTOR_STR.loading}</span>}
          {!stateCard && s.phase === "summary" && sum && !showLog ? (
            <>{summaryNode}<button onClick={() => setShowLog(true)} className="self-start text-[12.5px] text-link hover:underline" data-act="show-log">{t("Show the session ({n} messages)", { n: thread.messages.length - 1 })}</button></>
          ) : !stateCard && thread.messages.map(renderMsg)}
          {busy && started && <span className="text-muted" role="status">{t("Thinking…")}</span>}
          {err && <div className="flex items-center gap-2.5 rounded-[12px] border px-3.5 py-3" style={{ borderColor: "color-mix(in srgb, var(--danger) 35%, transparent)", background: "color-mix(in srgb, var(--danger) 8%, var(--surface))" }} role="alert"><Glyph name="c-danger" size={16} color="var(--danger)" /><span className="flex-1" dir="auto">{err.text}</span><button onClick={err.retry} className="flex h-[30px] items-center rounded-[8px] border border-line px-3 hover:bg-surface-2">{t("Retry")}</button></div>}
          {!stateCard && after}
        </div>
      </div>
      {comp && (
        <div className={cx("flex shrink-0 justify-center border-t border-line", phone ? "px-4 pb-5 pt-2.5" : "px-8 py-3.5")}>
          <div className={cx("flex min-h-[46px] max-w-full items-center gap-2.5 rounded-[12px] border border-line bg-surface pe-1.5 ps-3.5 focus-within:border-accent", phone ? "w-[380px]" : "w-[720px]")}>
            <textarea dir="auto" rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={comp.ph} aria-label={comp.ph} disabled={busy}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && draft.trim()) { e.preventDefault(); comp.go(draft.trim()); } }}
              className="max-h-[160px] min-h-[22px] flex-1 resize-none bg-transparent py-3 leading-[20px] !outline-none placeholder:text-muted" style={{ fieldSizing: "content" } as CSSProperties} />
            <VoiceButton onText={(x) => setDraft((d) => (d ? d + " " : "") + x)} />
            <button aria-label={t("Send")} onClick={() => draft.trim() && comp.go(draft.trim())} disabled={busy || !draft.trim()} className="flex size-[34px] items-center justify-center rounded-[9px] bg-accent font-bold text-accent-fg disabled:cursor-default" data-act="send"><span aria-hidden>{isRtl() ? "←" : "→"}</span></button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Dictation (Web Speech API where the browser has it; the button stays visible and explains when it doesn't). */
export function VoiceButton({ onText, size = 34 }: { onText: (t: string) => void; size?: number }) {
  const [on, setOn] = useState(false);
  const rec = useRef<{ stop: () => void } | null>(null);
  const SR = typeof window !== "undefined" ? ((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as (new () => { lang: string; continuous: boolean; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>; resultIndex: number }) => void; onend: () => void; start: () => void; stop: () => void }) | undefined : undefined;
  const toggle = () => {
    if (!SR) { toast(t("Dictation isn't available in this browser.")); return; }
    if (on) { rec.current?.stop(); return; }
    const r = new SR();
    r.lang = document.documentElement.lang || navigator.language || "en-US";
    r.continuous = true; r.interimResults = false;
    r.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText(e.results[i][0].transcript.trim()); };
    r.onend = () => setOn(false);
    rec.current = r; r.start(); setOn(true);
  };
  return <button onClick={toggle} aria-pressed={on} aria-label={on ? t("Stop dictation") : t("Dictate")} title={on ? t("Listening…") : t("Dictate")} className={cx("flex shrink-0 items-center justify-center rounded-[9px]", on ? "bg-surface-2 text-accent" : "text-muted hover:text-ink")} style={{ width: size, height: size }}><Glyph name="voice" size={size > 31 ? 16 : 15} /></button>;
}
