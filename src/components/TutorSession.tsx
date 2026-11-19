// AI tutor session (design round 5 §2 pending: plain round-4 styling, restyle-ready). Explain · Socratic · Feynman on one
// concept, grounded in its notes (numbered [n] citations), with an end-of-session summary (cards, Mark learned, review).
// State machine + parsing: lib/tutor.ts. Network + threads: lib/ask.ts. Prompts: worker/ext/tutor.ts.
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ChatMessage, ChatThread, Note } from "../../shared/types";
import { createNote, findOrCreateByTitle, updateNote } from "../lib/actions";
import { aiReady, aiTutor, msg, newChat, openThread, openTutor, setAsk, updateThread } from "../lib/ask";
import { db } from "../lib/db";
import { flashcards } from "../lib/parse";
import {
  addDays, buildPath, conceptCourses, linkNote, moveConcept, norm, parsePath, resolveCourses, serializePath, setManualDone,
  type BuiltConcept, type BuiltPath, type CourseRef,
} from "../lib/path";
import { openNote, toast, useVault, type Vault } from "../lib/store";
import {
  cardLines, initTutor, loadTutor, materialSources, MODE_INFO, parseFeynman, parseGrade, parseJson, parsePlan, parseSocratic, parseSummary,
  SOCRATIC_QUESTIONS, TUTOR_MODES, TUTOR_STR, tutorPassed, tutorProgress, tutorReduce, tutorScore, verdictColor, verdictLabel,
  type TutorEvent, type TutorMode, type TutorState, type Verdict,
} from "../lib/tutor";
import { gatherMaterial } from "./ConceptPractice";
import { RichAnswer, SERIF } from "./ChatParts";
import { Glyph } from "./Glyph";
import { cx, relTime } from "./ui";

type Layout = "page" | "sheet" | "panel";

// ------------------------------------------------------------------ what is being learned
export interface Subject { name: string; concept?: BuiltConcept; path?: BuiltPath; pathNote?: Note; note?: Note; notes: Note[]; courses: CourseRef[] }
function builtPathOf(p: Note, v: Vault): BuiltPath {
  const doc = parsePath(p.body);
  return buildPath(p.body, resolveCourses(doc.courses, v.notes, v.spaces));
}
export function resolveSubject(t: Pick<ChatThread, "title" | "pathId" | "conceptKey" | "noteId">, v: Vault): Subject {
  const pathNote = t.pathId ? v.byId.get(t.pathId) : undefined;
  if (pathNote && t.conceptKey) {
    const path = builtPathOf(pathNote, v);
    const concept = path.byKey.get(t.conceptKey);
    if (concept) return { name: concept.def.name, concept, path, pathNote, notes: gatherMaterial(concept, v.byTitle).notes, courses: conceptCourses(concept) };
  }
  const note = t.noteId ? v.byId.get(t.noteId) : undefined;
  if (note) {
    const linked = [...(v.outlinks.get(note.id) ?? [])].map((id) => v.byId.get(id)).filter((n): n is Note => !!n && !n.deleted && !["canvas", "whiteboard", "diagram", "path"].includes(n.type)).slice(0, 3);
    const space = v.spaceMap.get(note.spaceId);
    return { name: note.title, note, notes: [note, ...linked], courses: space ? [{ key: space.id, title: space.name, note: null, color: space.color ?? "var(--muted)", spaceName: space.name, spaceIcon: space.icon, spaceId: space.id }] : [] };
  }
  return { name: t.title, notes: [], courses: [] };
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
/** Lesson note ⋯ › Tutor: the path concept it teaches, else the note itself. */
export function openTutorForNote(note: Note, v: Vault) {
  const hit = conceptForNote(note, v);
  if (hit) openTutor({ title: hit.concept.def.name, pathId: hit.pathNote.id, conceptKey: hit.concept.key });
  else openTutor({ title: note.title, noteId: note.id });
}

// ------------------------------------------------------------------ concept picker (Ask › Tutor)
export function ConceptPicker({ note, layout }: { note?: Note; layout: Layout }) {
  const v = useVault();
  const [q, setQ] = useState("");
  const paths = useMemo(() => v.notes.filter((n) => n.type === "path" && !n.deleted).map((p) => ({ p, path: builtPathOf(p, v) })), [v]);
  const ql = q.trim().toLowerCase();
  const fromNote = note && note.type !== "path" ? conceptForNote(note, v) : null;
  return (
    <div className={cx("flex flex-col gap-3 text-[13px]", layout !== "panel" && "min-h-0 w-full max-w-[760px] overflow-y-auto pb-4", layout === "page" && "pt-8")} data-picker>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[18px] font-[650]">{TUTOR_STR.pickConcept}</span>
        <button onClick={newChat} className="h-8 rounded-[8px] px-2.5 text-muted hover:bg-surface-2 hover:text-ink">Back to Ask</button>
      </div>
      <span className="text-muted">{TUTOR_STR.pickHint}</span>
      {note && note.type !== "path" && (
        <button onClick={() => openTutorForNote(note, v)} className="flex min-h-[44px] items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 text-left hover:bg-surface-2">
          <Glyph name={note.type} size={16} color="var(--muted)" />
          <span className="flex min-w-0 flex-1 flex-col"><span dir="auto" className="truncate font-semibold">{fromNote ? fromNote.concept.def.name : note.title}</span><span className="text-[12px] text-muted">{fromNote ? `From ${fromNote.pathNote.title}` : "The note you're reading"}</span></span>
        </button>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a concept…" aria-label="Find a concept" dir="auto"
        className="h-9 rounded-[8px] border border-line bg-bg px-2.5 outline-none focus:border-accent" />
      {paths.map(({ p, path }) => {
        const list = path.concepts.filter((c) => !ql || c.def.name.toLowerCase().includes(ql)).slice(0, 40);
        if (!list.length) return null;
        return (
          <div key={p.id} className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted"><Glyph name="path" size={12} />{p.title}</span>
            {list.map((c) => (
              <button key={c.key} onClick={() => openTutor({ title: c.def.name, pathId: p.id, conceptKey: c.key })} data-concept={c.key}
                className="flex h-9 items-center gap-2 rounded-[8px] px-2 text-left hover:bg-surface-2">
                <Glyph name={c.status === "done" ? "s-done" : c.status === "learning" ? "s-learning" : "s-todo"} size={14} color={c.status === "done" ? "var(--success)" : "var(--muted)"} />
                <span dir="auto" className="min-w-0 flex-1 truncate">{c.def.name}</span>
                <span className="text-[11.5px] text-muted">{c.stage}</span>
              </button>
            ))}
          </div>
        );
      })}
      {!paths.length && !note && <span className="text-muted">No learning paths yet. Open a lesson note and use ⋯ › Tutor.</span>}
    </div>
  );
}

// ------------------------------------------------------------------ tutor history (concept sheet)
export function TutorHistory({ pathId, conceptKey }: { pathId: string; conceptKey: string }) {
  const rows = useLiveQuery(() => db.chats.where("conceptKey").equals(conceptKey).filter((t) => !t.deleted && t.pathId === pathId && t.messages.length > 0).toArray(), [pathId, conceptKey]) ?? [];
  if (!rows.length) return <span className="text-[12px] text-muted">{TUTOR_STR.noHistory}</span>;
  return (
    <div className="flex flex-col gap-1" aria-label={TUTOR_STR.history} data-tutor-history>
      {rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6).map((t) => {
        const s = loadTutor(t.tutor, t.mode as TutorMode);
        const sc = s.summary?.score ?? tutorScore(s);
        return (
          <button key={t.id} onClick={() => { setAsk({ open: true }); openThread(t.id); }} className="flex h-8 items-center gap-2 rounded-[8px] bg-bg px-2 text-left text-[12.5px] hover:text-link">
            <Glyph name={MODE_INFO[t.mode as TutorMode]?.glyph ?? "lesson"} size={14} color="var(--muted)" />
            <span className="flex-1">{MODE_INFO[t.mode as TutorMode]?.name ?? t.mode}</span>
            <span className="text-muted">{relTime(t.updatedAt)}</span>
            <span className="w-10 text-right font-semibold" style={{ color: s.summary ? (s.summary.passed ? "var(--success)" : "var(--warning)") : "var(--muted)" }}>{s.summary || s.results.length || s.reviews.length ? TUTOR_STR.score(sc) : "…"}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Concept sheet: "Learn with tutor" + this concept's past tutor sessions. */
export function TutorEntry({ pathId, c }: { pathId: string; c: BuiltConcept }) {
  return (
    <div className="flex flex-col gap-1.5 pt-1" data-tutor-entry>
      <button onClick={() => openTutor({ title: c.def.name, pathId, conceptKey: c.key })} className="flex h-8 items-center gap-2 self-start rounded-[10px] border border-line px-3 hover:bg-surface-2" data-act="learn-with-tutor">
        <Glyph name="lesson" size={15} />{TUTOR_STR.learnWithTutor}
      </button>
      <TutorHistory pathId={pathId} conceptKey={c.key} />
    </div>
  );
}

// ------------------------------------------------------------------ cards
const card = "flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-4 py-3";
const small = "text-[11px] font-semibold uppercase tracking-[.06em] text-muted";
function Bar({ value, color = "var(--ink, currentColor)" }: { value: number; color?: string }) {
  return <span className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-surface-2"><span className="block h-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} /></span>;
}
const KIND_LABEL = { gap: TUTOR_STR.gap, wrong: TUTOR_STR.wrong, jargon: TUTOR_STR.jargon } as const;

function TutorMessage({ m, subjectSources, onOpen, state, summaryNode }: { m: ChatMessage; subjectSources: ReturnType<typeof materialSources>; onOpen: (id: string) => void; state: TutorState; summaryNode: ReactNode }) {
  const tc = m.tutor;
  if (m.role === "user") return <div dir="auto" data-msg="user" className="max-w-[85%] self-end whitespace-pre-wrap rounded-[14px] bg-surface-2 px-3.5 py-2 text-[14px] leading-[21px]">{m.text}</div>;
  if (!tc) return <RichAnswer text={m.text} sources={subjectSources} size={15} onOpen={onOpen} />;
  if (tc.kind === "summary") return <>{summaryNode}</>;
  if (tc.kind === "feedback") {
    const v = (tc.verdict ?? "not_yet") as Verdict;
    return (
      <div className="flex flex-col gap-1 rounded-[10px] border border-line px-3.5 py-2.5" style={{ borderInlineStartWidth: 3, borderInlineStartColor: verdictColor(v) }} data-card="feedback" data-verdict={v}>
        <span className="text-[12px] font-semibold" style={{ color: verdictColor(v) }}>{verdictLabel(v)}</span>
        <RichAnswer text={m.text} sources={subjectSources} size={14.5} onOpen={onOpen} />
      </div>
    );
  }
  if (tc.kind === "hint" || tc.kind === "answer") return (
    <div className="flex flex-col gap-1 rounded-[10px] bg-surface-2 px-3.5 py-2.5" data-card={tc.kind}>
      <span className={small}>{tc.kind === "hint" ? `Hint ${tc.i ?? ""}` : "Answer"}</span>
      <RichAnswer text={m.text} sources={subjectSources} size={14.5} onOpen={onOpen} />
    </div>
  );
  if (tc.kind === "review") return (
    <div className={card} data-card="review">
      <div className="flex items-baseline gap-2"><span className={small}>{TUTOR_STR.clarity}</span><span className="text-[22px] font-[650]">{tc.score ?? 0}</span><span className="text-muted">/ 100</span></div>
      {(tc.reasons ?? []).map((r) => (
        <div key={r.label} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 text-[12.5px]"><span className="w-[100px] shrink-0">{r.label}</span><Bar value={r.score} color="var(--muted)" /><span className="w-8 text-right text-muted">{r.score}</span></div>
          {r.note && <span className="text-[12px] text-muted" dir="auto">{r.note}</span>}
        </div>
      ))}
      {(tc.issues ?? []).length > 0 && (
        <div className="flex flex-col gap-2 pt-1">
          {(tc.issues ?? []).map((x, i) => (
            <div key={i} className="flex flex-col gap-0.5 border-s-2 border-line ps-2.5">
              <span className="text-[11.5px] font-semibold" style={{ color: x.kind === "wrong" ? "var(--danger, #e5534b)" : "var(--warning)" }}>{KIND_LABEL[x.kind]}</span>
              {x.quote && <span dir="auto" className="text-[14px] italic" style={{ fontFamily: SERIF }}>“{x.quote}”</span>}
              <RichAnswer text={x.comment} sources={subjectSources} size={13.5} onOpen={onOpen} />
            </div>
          ))}
        </div>
      )}
      {m.text && <span dir="auto" className="pt-1 font-semibold">{m.text}</span>}
    </div>
  );
  // step / explanation / question
  const label = tc.kind === "step" ? (tc.i ? TUTOR_STR.progressStep(tc.i, tc.of ?? tc.i) : "") : tc.kind === "question" ? TUTOR_STR.progressQ(tc.i ?? 1, tc.of ?? 1) : "";
  void state;
  return (
    <div className={card} data-card={tc.kind}>
      {label && <span className={small}>{label}</span>}
      <RichAnswer text={m.text} sources={subjectSources} size={15.5} onOpen={onOpen} />
    </div>
  );
}

// ------------------------------------------------------------------ the session
export function TutorSession({ thread, layout, onOpened }: { thread: ChatThread; layout: Layout; onOpened?: () => void }) {
  const v = useVault();
  const mode = thread.mode as TutorMode;
  const subj = useMemo(() => resolveSubject(thread, v), [thread.pathId, thread.conceptKey, thread.noteId, thread.title, v]); // eslint-disable-line react-hooks/exhaustive-deps
  const sources = useMemo(() => materialSources(subj.notes.map((n) => ({ id: n.id, title: n.title, body: n.body }))), [subj.notes]);
  const s = loadTutor(thread.tutor, mode);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; retry: () => void } | null>(null);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<boolean[] | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const page = layout === "page";
  const fill = layout !== "panel";
  const open = (id: string) => { openNote(id); onOpened?.(); };
  useEffect(() => { const el = fill ? scroller.current : null; if (el) el.scrollTop = el.scrollHeight; }, [thread.messages.length, busy, fill]);
  useEffect(() => { setErr(null); setDraft(""); setPicked(null); }, [thread.id]);

  const payload = sources.map(({ n, title, text }) => ({ n, title, text }));
  const hist = (ms: ChatMessage[]) => ms.filter((m) => m.text.trim()).slice(-12).map((m) => ({ role: m.role, text: m.text }));
  const call = (op: string, input?: string, extra?: Record<string, unknown>, ms = thread.messages) => aiTutor({ op, concept: subj.name, sources: payload, input, history: hist(ms), extra });
  const commit = (next: TutorState, add: ChatMessage[]) => updateThread(thread.id, (t) => { t.tutor = next as unknown as Record<string, unknown>; t.messages.push(...add); });
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    if (!aiReady()) { setErr({ text: "The tutor needs sync and a connection: unlock it in Settings › Sync.", retry: () => void run(fn) }); return; }
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) {
      const m = (e as Error).message || "The tutor didn't answer.";
      setErr({ text: /fetch|network/i.test(m) ? "You're offline." : m, retry: () => void run(fn) });
    } finally { setBusy(false); }
  };
  const red = (st: TutorState, ...es: TutorEvent[]) => es.reduce(tutorReduce, st);
  const stepMsg = (st: TutorState) => { const x = st.steps[st.step]; return msg("assistant", `${x.title ? `**${x.title}**\n\n` : ""}${x.text}`, { tutor: { kind: "step", i: st.step + 1, of: st.steps.length } }); };
  const checkMsg = (st: TutorState) => msg("assistant", st.checks[st.check].q, { tutor: { kind: "question", i: st.check + 1, of: st.checks.length } });
  const qMsg = (st: TutorState) => msg("assistant", st.q!.q, { tutor: { kind: "question", i: st.asked, of: SOCRATIC_QUESTIONS } });
  const unread = () => new Error("The tutor's answer couldn't be read. Try again.");

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
      await commit(st0, [msg("assistant", `Explain **${subj.name}** in your own words, as if to a friend who has never heard of it. I'll quote anything that's missing, not quite right, or jargon you didn't explain, and give you a clarity score.`, { tutor: { kind: "step" } })]);
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
    await commit(red(s, { type: "rephrased" }), [msg("assistant", `${j.title ? `**${j.title}**\n\n` : ""}${j.text}`, { tutor: { kind: "explanation" } })]);
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
  const endSession = () => { if (!thread.messages.length) return newChat(); if (s.phase !== "summary") void finish(s); };

  // ------------------------------------------------ summary actions
  const sum = s.summary;
  const patchSummary = (p: Partial<NonNullable<TutorState["summary"]>>) => updateThread(thread.id, (t) => { const st = loadTutor(t.tutor, mode); if (st.summary) t.tutor = { ...st, summary: { ...st.summary, ...p } } as unknown as Record<string, unknown>; });
  async function saveCards() {
    if (!sum) return;
    const chosen = sum.cards.filter((_, i) => picked?.[i] ?? true);
    if (!chosen.length) return;
    let target: Note | null = subj.note ?? subj.notes.find((n) => subj.concept?.def.notes.some((t) => t.toLowerCase() === n.title.toLowerCase())) ?? subj.notes[0] ?? null;
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
    toast(lines.length ? `${lines.length} card${lines.length === 1 ? "" : "s"} added to “${cur.title}”` : `Already in “${cur.title}”`, { label: "Open", run: () => openNote(cur.id) });
  }
  async function markLearned() {
    if (!subj.concept || !subj.pathNote || !subj.path) return;
    const fresh = (await db.notes.get(subj.pathNote.id)) ?? subj.pathNote;
    const body = subj.concept.placed ? fresh.body : moveConcept(fresh.body, subj.concept, subj.path.doc.stages[0]?.name ?? "Stage 1");
    await updateNote(fresh.id, { body: setManualDone(body, subj.concept, true) });
    await patchSummary({ learned: 1 });
    toast(`${subj.name}: marked learned`);
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
  const summaryNode = sum && (
    <div className={card} data-card="summary">
      <div className="flex items-baseline gap-2"><span className="flex-1 text-[16px] font-[650]">{TUTOR_STR.summaryTitle}</span>
        <span className="font-semibold" style={{ color: sum.passed ? "var(--success)" : "var(--warning)" }}>{TUTOR_STR.score(sum.score)} · {sum.passed ? TUTOR_STR.passed : TUTOR_STR.notPassed}</span></div>
      {sum.right.length > 0 && <div className="flex flex-col gap-1"><span className={small}>{TUTOR_STR.right}</span>{sum.right.map((x) => <span key={x} dir="auto" className="flex gap-2"><Glyph name="check" size={14} color="var(--success)" style={{ marginTop: 3 }} />{x}</span>)}</div>}
      {sum.gaps.length > 0 && <div className="flex flex-col gap-1"><span className={small}>{TUTOR_STR.gaps}</span>{sum.gaps.map((x) => <span key={x} dir="auto" className="flex gap-2"><Glyph name="c-warning" size={14} color="var(--warning)" style={{ marginTop: 3 }} />{x}</span>)}</div>}
      {sum.cards.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className={small}>{TUTOR_STR.cards}</span>
          {sum.cards.map((c, i) => (
            <label key={i} className="flex cursor-pointer items-start gap-2 rounded-[8px] bg-bg px-2.5 py-2">
              <input type="checkbox" checked={picked?.[i] ?? true} onChange={(e) => setPicked((p) => { const a = p ?? sum.cards.map(() => true); a[i] = e.target.checked; return [...a]; })} className="mt-1" />
              <span className="flex min-w-0 flex-col" dir="auto"><span className="font-semibold">{c.q}</span><span className="text-muted">{c.a}</span></span>
            </label>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {sum.cards.length > 0 && <button onClick={() => void saveCards()} disabled={!!sum.savedCards} className="h-8 rounded-[8px] border border-line px-3 hover:bg-surface-2 disabled:opacity-60" data-act="save-cards">{sum.savedCards ? TUTOR_STR.saved : (picked && picked.some((x) => !x)) ? TUTOR_STR.saveCards(picked.filter(Boolean).length) : TUTOR_STR.saveAll}</button>}
        {subj.concept && sum.passed && <button onClick={() => void markLearned()} disabled={learned} className="h-8 rounded-[8px] bg-accent px-3 font-semibold text-accent-fg disabled:opacity-60" data-act="learned">{learned ? TUTOR_STR.learned : TUTOR_STR.markLearned}</button>}
        {subj.concept && <button onClick={() => void scheduleReview()} disabled={!!sum.reviewOn} className="h-8 rounded-[8px] border border-line px-3 hover:bg-surface-2 disabled:opacity-60" data-act="schedule">{sum.reviewOn ? TUTOR_STR.scheduled(sum.reviewOn) : TUTOR_STR.schedule}</button>}
        <button onClick={() => switchMode(mode)} className="h-8 rounded-[8px] px-3 text-muted hover:bg-surface-2 hover:text-ink">{TUTOR_STR.again}</button>
      </div>
    </div>
  );

  // ------------------------------------------------ render
  const prog = tutorProgress(s);
  const started = thread.messages.length > 0;
  const header = (
    <div className={cx("flex flex-col gap-2 border-b border-line pb-3", page && "pt-6")} data-tutor-header>
      <div className="flex items-center gap-2">
        <Glyph name={MODE_INFO[mode].glyph} size={18} color="var(--muted)" />
        <span dir="auto" className="min-w-0 flex-1 truncate text-[18px] font-[650]">{subj.name}</span>
        <button onClick={endSession} className="h-8 shrink-0 rounded-[8px] border border-line px-3 text-[12.5px] hover:bg-surface-2" data-act="end">{started ? TUTOR_STR.endSession : "Back to Ask"}</button>
      </div>
      {subj.courses.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {subj.courses.slice(0, 4).map((c) => <span key={c.key} className="flex h-6 items-center gap-1.5 rounded-[999px] bg-surface-2 px-2.5 text-[11.5px]"><span className="size-2 rounded-full" style={{ background: c.color }} />{c.spaceName}</span>)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Tutor mode" className="flex gap-0.5 rounded-[8px] bg-surface-2 p-0.5">
          {TUTOR_MODES.map((m) => <button key={m} role="radio" aria-checked={m === mode} onClick={() => switchMode(m)} className={cx("h-7 rounded-[6px] px-2.5 text-[12px]", m === mode ? "bg-bg font-semibold" : "text-muted hover:text-ink")}>{MODE_INFO[m].name}</button>)}
        </div>
        {started && <div className="flex min-w-[160px] flex-1 items-center gap-2 text-[12px] text-muted"><span>{prog.label}</span><Bar value={(prog.done / Math.max(1, prog.total)) * 100} color="var(--muted)" /></div>}
      </div>
    </div>
  );

  const ta = (ph: string, rows: number, onSubmit: (t: string) => void, label: string) => (
    <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-3 py-2 focus-within:border-accent">
      <textarea dir="auto" rows={rows} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={ph} aria-label={ph} disabled={busy}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && (rows === 1 || e.ctrlKey || e.metaKey) && draft.trim()) { e.preventDefault(); onSubmit(draft.trim()); } }}
        className="w-full resize-none bg-transparent text-[14.5px] leading-[22px] !outline-none placeholder:text-muted" style={{ fieldSizing: "content", minHeight: rows * 22 } as CSSProperties} />
      <div className="flex items-center gap-2">
        {mode === "feynman" && <VoiceButton onText={(t) => setDraft((d) => (d ? d + " " : "") + t)} />}
        <span className="flex-1" />
        <button onClick={() => draft.trim() && onSubmit(draft.trim())} disabled={!draft.trim() || busy} className="h-8 rounded-[8px] bg-accent px-3 font-semibold text-accent-fg disabled:opacity-40" data-act="submit">{label}</button>
      </div>
    </div>
  );
  const btn = "h-9 rounded-[10px] border border-line px-3.5 hover:bg-surface-2 disabled:opacity-50";
  let controls: ReactNode = null;
  if (!started) controls = null;
  else if (s.phase === "step") controls = (
    <div className="flex flex-wrap gap-2" data-controls="step">
      <button onClick={gotIt} disabled={busy} className="h-9 rounded-[10px] bg-accent px-4 font-semibold text-accent-fg disabled:opacity-50" data-act="got-it">{TUTOR_STR.gotIt}</button>
      <button onClick={() => rephrase("differently")} disabled={busy} className={btn} data-act="differently">{TUTOR_STR.differently}</button>
      <button onClick={() => rephrase("example")} disabled={busy} className={btn} data-act="example">{TUTOR_STR.example}</button>
    </div>
  );
  else if (s.phase === "check") controls = ta(TUTOR_STR.answerPlaceholder, 2, answerCheck, TUTOR_STR.submit);
  else if (s.phase === "question") controls = (
    <div className="flex flex-col gap-2" data-controls="question">
      <div className="flex flex-wrap items-center gap-1.5" aria-label="Hints">
        <button onClick={hint} disabled={busy || s.hint >= 1 || !s.q?.hints.length} className="h-8 rounded-[999px] border border-line px-3 text-[12.5px] disabled:opacity-40" data-act="hint1">{TUTOR_STR.hint1}</button>
        <Glyph name="chevron-right" size={12} color="var(--muted)" />
        <button onClick={hint} disabled={busy || s.hint !== 1 || (s.q?.hints.length ?? 0) < 2} className="h-8 rounded-[999px] border border-line px-3 text-[12.5px] disabled:opacity-40" data-act="hint2">{TUTOR_STR.hint2}</button>
        <Glyph name="chevron-right" size={12} color="var(--muted)" />
        <button onClick={showAnswer} disabled={busy} className="h-8 rounded-[999px] border border-line px-3 text-[12.5px] disabled:opacity-40" data-act="show">{TUTOR_STR.showAnswer}</button>
      </div>
      {ta(TUTOR_STR.answerPlaceholder, 2, socraticReply, TUTOR_STR.submit)}
    </div>
  );
  else if (s.phase === "closed") controls = <button onClick={() => nextQuestion(s, thread.messages)} disabled={busy} className={btn}>{TUTOR_STR.next}</button>;
  else if (s.phase === "explain") controls = (
    <div className="flex flex-col gap-2">
      {ta(TUTOR_STR.explainPlaceholder, 4, feynman, TUTOR_STR.submitExplain)}
      {s.reviews.length > 0 && <button onClick={() => finish(s)} disabled={busy} className="self-start text-[12.5px] text-link hover:underline" data-act="finish">{TUTOR_STR.finish}</button>}
    </div>
  );
  else if (s.phase === "done") controls = <button onClick={() => finish(s)} disabled={busy} className={btn} data-act="finish">{TUTOR_STR.finish}</button>;

  return (
    <div className={cx("flex min-h-0 flex-col gap-3 text-[13px]", fill ? "h-full w-full max-w-[760px]" : "")} data-tutor={mode}>
      {header}
      <div ref={scroller} className={cx("flex flex-col gap-4", fill && "min-h-0 flex-1 overflow-y-auto pb-4")}>
        {!started && (
          <div className="flex flex-col gap-3" data-tutor-start>
            <div className="grid gap-2 sm:grid-cols-3">
              {TUTOR_MODES.map((m) => (
                <button key={m} onClick={() => switchMode(m)} aria-pressed={m === mode} className={cx("flex flex-col items-start gap-1.5 rounded-[12px] border px-3.5 py-3 text-left", m === mode ? "border-accent bg-surface" : "border-line hover:bg-surface-2")}>
                  <span className="flex items-center gap-2 font-semibold"><Glyph name={MODE_INFO[m].glyph} size={16} />{MODE_INFO[m].name}</span>
                  <span className="text-[12.5px] leading-[18px] text-muted">{MODE_INFO[m].what}</span>
                </button>
              ))}
            </div>
            <span className="text-[12.5px] text-muted">{subj.notes.length ? `${TUTOR_STR.fromNotes(subj.notes.length)}: ${subj.notes.slice(0, 4).map((n) => n.title).join(", ")}${subj.notes.length > 4 ? "…" : ""}` : TUTOR_STR.noNotes}</span>
            <button onClick={start} disabled={busy} className="h-10 self-start rounded-[10px] bg-accent px-5 font-semibold text-accent-fg disabled:opacity-50" data-act="start">{busy ? TUTOR_STR.loading : `${TUTOR_STR.start} · ${MODE_INFO[mode].name}`}</button>
          </div>
        )}
        {thread.messages.map((m) => <TutorMessage key={m.id} m={m} subjectSources={sources} onOpen={open} state={s} summaryNode={summaryNode} />)}
        {busy && started && <span className="text-muted" role="status">Thinking…</span>}
        {err && <div className="flex items-center gap-3" role="alert"><span className="text-bad" dir="auto">{err.text}</span><button onClick={err.retry} className="h-8 rounded-[8px] border border-line px-3 hover:bg-surface-2">Retry</button></div>}
      </div>
      {controls && <div className={cx("shrink-0", fill && "pb-3 pt-1")}>{controls}</div>}
    </div>
  );
}

/** Dictation for Feynman explanations (Web Speech API where the browser has it). */
function VoiceButton({ onText }: { onText: (t: string) => void }) {
  const [on, setOn] = useState(false);
  const rec = useRef<{ stop: () => void } | null>(null);
  const SR = typeof window !== "undefined" ? ((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as (new () => { lang: string; continuous: boolean; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>; resultIndex: number }) => void; onend: () => void; start: () => void; stop: () => void }) | undefined : undefined;
  if (!SR) return null;
  const toggle = () => {
    if (on) { rec.current?.stop(); return; }
    const r = new SR();
    r.lang = document.documentElement.lang || navigator.language || "en-US";
    r.continuous = true; r.interimResults = false;
    r.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText(e.results[i][0].transcript.trim()); };
    r.onend = () => setOn(false);
    rec.current = r; r.start(); setOn(true);
  };
  return <button onClick={toggle} aria-pressed={on} className={cx("flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px]", on ? "bg-surface-2 text-ink" : "text-muted hover:text-ink")}><Glyph name="voice" size={14} />{on ? "Listening…" : "Speak"}</button>;
}
