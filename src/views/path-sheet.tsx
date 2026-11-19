// Learning path · concept sheet (PathDesk sheet, R4-14C/D, phone R4-14K/L): collapsible remembered sections (Mastery, Practice,
// Taught in, Prerequisites, Unlocks, Resources, Notes), practice quiz in place, merge / take out with the inline confirm bar.
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, GripVertical, Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Note } from "../../shared/types";
import { PracticeQuiz, usePractice } from "../components/ConceptPractice";
import { Glyph } from "../components/Glyph";
import { cx, inputCls } from "../components/ui";
import { findOrCreateByTitle, updateNote } from "../lib/actions";
import { embedHtml, hydrate } from "../lib/markdown";
import { linkTopicNote, setTopicStatus, type TopicStatus } from "../lib/parse";
import {
  abbrevCourse, addConceptNeed, addResource, conceptState, linkNote, markRevised, MASTERY_INTERVAL, mergeConcepts, moveConcept, nextInterval, pathNeeds, removeConcept, removeConceptNeed, removeResource, renameConcept, setManualDone, wouldCycle,
  type BuiltConcept, type BuiltPath,
} from "../lib/path";
import { openNote, toast, useVault } from "../lib/store";
import { endDrag, startDrag } from "./dnd-parts";
import { conceptNotes, conceptResources, RES_GLYPH, type Res } from "./path-res";
import { dragGhost } from "./path-stages";
import { ConfirmBar, stageLabel, ST, useStored } from "./path-ui";
import { TutorEntry } from "../components/TutorSession"; // "Learn with tutor" + tutor history (round 5)
import { fmtDate, fmtNum, t, tk, tx } from "../lib/i18n";

type Sec = "mastery" | "practice" | "taught" | "prereq" | "unlocks" | "resources" | "notes" | "manage";
const TOPIC_LABEL: Record<TopicStatus, string> = { todo: tk("todo"), learning: tk("learning"), done: tk("done"), skipped: tk("skipped") };
const TOPIC_ST: Record<TopicStatus, string> = { todo: "var(--muted)", learning: "var(--info)", done: "var(--success)", skipped: "var(--muted)" };

function ResourceRow({ r, onRemove }: { r: Res; onRemove?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open && ref.current) { ref.current.innerHTML = embedHtml(r.url, r.label); hydrate(ref.current); } }, [open, r]);
  return (
    <div className="group rounded-[8px] bg-bg">
      <div className="flex h-[34px] items-center gap-2 px-2">
        <Glyph name={RES_GLYPH[r.kind]} size={15} color="var(--muted)" />
        <a href={r.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-link" title={r.url} dir="auto">{r.label}</a>
        <span className="max-w-[90px] truncate text-[12px] text-muted">{r.from}</span>
        {r.kind === "video" && <button onClick={() => setOpen((o) => !o)} className="text-[12px] text-link">{open ? t("Hide") : t("Play")}</button>}
        <a href={r.url} target="_blank" rel="noreferrer" aria-label={t("Open link")} className="text-muted hover:text-ink"><ExternalLink size={12} /></a>
        {onRemove && <button aria-label={t("Remove resource")} onClick={onRemove} className="text-muted opacity-0 hover:text-bad group-hover:opacity-100"><X size={12} /></button>}
      </div>
      {open && <div ref={ref} className="prose !max-w-none px-2 pb-2" />}
    </div>
  );
}

export function ConceptSheet({ c, path, note, save, onClose, onOpen, onFocus, phone }: { c: BuiltConcept; path: BuiltPath; note: Note; save: (b: string) => void; onClose: () => void; onOpen: (k: string) => void; onFocus: (k: string) => void; phone: boolean }) {
  const v = useVault();
  const [open, setOpen] = useStored<Sec[]>("lumen.path.sheet.open", ["mastery", "taught", "prereq"]);
  const [phoneSec, setPhoneSec] = useState<Sec | null>(null);
  const [quiz, setQuiz] = useState(false);
  const [ask, setAsk] = useState<null | { kind: "merge"; other: BuiltConcept } | { kind: "out" }>(null);
  const [mergePick, setMergePick] = useState(false);
  const [mq, setMq] = useState("");
  const [addingNeed, setAddingNeed] = useState(false);
  const [nq, setNq] = useState("");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const practice = usePractice({ concept: c, note, onTestOut: () => save(setManualDone(note.body, c, true)), autoLearn: true });
  useEffect(() => { setQuiz(false); setAsk(null); setMergePick(false); setPhoneSec(null); }, [c.key]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".pdnd-confirm")) onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);

  const state = conceptState(c);
  const st = ST[state];
  const learned = c.status === "done";
  const res = conceptResources(c, v.byTitle);
  const notes = conceptNotes(c, v.byTitle);
  const nCourses = new Set(c.coverage.map((x) => x.course.key)).size;
  const blocks = c.unlocks.map((k) => path.byKey.get(k)).filter((x): x is BuiltConcept => !!x && x.status !== "done");
  const blockers = c.needs.map((n) => path.byKey.get(n)).filter((x): x is BuiltConcept => !!x && x.status !== "done");
  const days = learned ? Math.min(MASTERY_INTERVAL, c.def.interval || 0) : 0;
  const needCandidates = path.concepts.filter((x) => x.key !== c.key && !c.needs.includes(x.key) && !wouldCycle(path, c, x) && (!nq || x.def.name.toLowerCase().includes(nq.toLowerCase())));

  async function setCourseStatus(cov: BuiltConcept["coverage"][number], s: TopicStatus) {
    if (!cov.course.note) return;
    await updateNote(cov.course.note.id, { body: setTopicStatus(cov.course.note.body, cov.topic.line, s) });
  }
  async function openLesson(cov?: BuiltConcept["coverage"][number]) {
    if (cov?.topic.note) { const n = v.byTitle.get(cov.topic.note.toLowerCase()); if (n) return openNote(n.id); }
    const title = cov?.topic.name ?? c.def.name;
    const n = await findOrCreateByTitle(title, cov?.course.spaceId ?? note.spaceId);
    if (cov?.course.note && !cov.topic.note) await updateNote(cov.course.note.id, { body: linkTopicNote(cov.course.note.body, cov.topic.line, n.title) });
    else if (!cov) save(linkNote(c.placed ? note.body : moveConcept(note.body, c, path.doc.stages[0]?.name ?? "Stage 1"), c, n.title));
    openNote(n.id);
  }
  /** Mastery segmented control: Todo / Learning / Learned / Mastered. */
  function setState(s: "todo" | "learning" | "learned") {
    if (s === "learned") { if (!learned) save(setManualDone(c.placed ? note.body : moveConcept(note.body, c, path.doc.stages[0]?.name ?? "Stage 1"), c, true)); return; }
    if (c.learnedVia === "manual") save(setManualDone(note.body, c, false));
    else if (learned) return toast(t("Learned through a course: change its lessons in Taught in"));
    const cov = c.coverage[0];
    if (s === "learning" && cov && cov.topic.status === "todo") void setCourseStatus(cov, "learning");
    if (s === "todo") for (const x of c.coverage) if (x.topic.status === "learning") void setCourseStatus(x, "todo");
    if (s === "learning" && !cov) toast(t("Your own concept: mark it learned when you know it"));
  }

  const meta: Record<Sec, string> = {
    mastery: `${t(st.label).toLowerCase()} · ${t("{n}/{total} d", { n: days, total: MASTERY_INTERVAL })}`,
    practice: t("{n} question|{n} questions", { n: 5 }),
    taught: nCourses ? t("{n} course|{n} courses", { n: nCourses }) : t("your own"),
    prereq: fmtNum(c.needs.length),
    unlocks: c.unlocks.length ? (phone ? fmtNum(c.unlocks.length) : c.unlocks.map((k) => path.byKey.get(k)?.def.name).filter(Boolean).slice(0, 3).join(", ") + (c.unlocks.length > 3 ? ` +${fmtNum(c.unlocks.length - 3)}` : "")) : t("none"),
    resources: fmtNum(res.length),
    notes: fmtNum(notes.length),
    manage: t("merge · take out"),
  };
  const titles: Record<Sec, string> = { mastery: t("Mastery"), practice: t("Practice"), taught: t("Taught in"), prereq: t("Prerequisites"), unlocks: t("Unlocks"), resources: t("Resources"), notes: t("Notes"), manage: t("Merge or take out") };

  const chip = (x: BuiltConcept, own: boolean, removable: boolean, onRemove?: () => void) => {
    const done = x.status === "done";
    return (
      <span key={x.key} className="flex h-7 items-center gap-1.5 rounded-[6px] pe-1.5 ps-2 text-[12.5px]" title={own ? t("Added in this path") : t("From a course roadmap")}
        style={{ background: done && !own ? "color-mix(in srgb,var(--success) 12%,var(--bg))" : "var(--bg)", border: own ? "1px dashed var(--accent)" : done ? "1px solid color-mix(in srgb,var(--success) 40%,transparent)" : "1px solid var(--border)" }}>
        <button onClick={() => onOpen(x.key)} className="flex items-center gap-1.5">{done && !own && <Glyph name="s-done" size={13} color="var(--success)" />}<span dir="auto">{x.def.name}</span></button>
        {own && <span className="text-[10.5px] text-accent">{t("added")}</span>}
        {removable && <button aria-label={t("Remove {name}", { name: x.def.name })} onClick={onRemove} className="text-muted hover:text-ink"><X size={12} /></button>}
      </span>
    );
  };

  const body: Record<Sec, () => ReactNode> = {
    mastery: () => (
      <div className="flex flex-col gap-2.5">
        <div className="grid grid-cols-4 gap-0.5 rounded-[10px] border border-line bg-bg p-[3px] text-[12.5px]" role="radiogroup" aria-label={t("Status")}>
          {(["todo", "learning", "learned", "mastered"] as const).map((k) => {
            const on = state === k || (k === "todo" && state === "locked");
            return (
              <button key={k} role="radio" aria-checked={on} disabled={k === "mastered"} title={k === "mastered" ? t("Earned after 14 days of correct recalls") : undefined}
                onClick={() => k !== "mastered" && setState(k)} className={cx("flex items-center justify-center rounded-[7px]", phone ? "h-[38px]" : "h-7")}
                style={{ background: on ? "var(--surface-2)" : "transparent", fontWeight: on ? 600 : 450, color: on ? ST[k].color : "var(--muted)" }}>{t(ST[k].label)}</button>
            );
          })}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-[12px]"><span className="text-muted">{phone ? t("To mastered") : t("Progress to mastered")}</span><span className={phone ? "font-semibold" : ""}>{t("{n} of {total} days", { n: days, total: MASTERY_INTERVAL })}</span></div>
          <span className="h-1.5 overflow-hidden rounded-[3px] bg-surface-2"><span className="block h-full bg-ok" style={{ width: `${(days / MASTERY_INTERVAL) * 100}%` }} /></span>
          {!phone && <span className="text-[12px] text-muted">{c.mastered ? t("Mastered. It still comes back now and then.") : t("Mastered after {n} days of correct recalls.", { n: MASTERY_INTERVAL })}{learned && c.def.review ? " " + t("Next revision {date}.", { date: fmtDate(c.def.review + "T12:00") }) : ""}</span>}
        </div>
        {(state === "locked" ? blockers : blocks).length > 0 && (
          <div className="flex items-center gap-2 text-[12.5px]"><Glyph name="s-locked" size={14} color="var(--muted)" /><span className="text-muted">{state === "locked" ? t("Needs first") : t("Blocks")}</span>
            <span className="min-w-0 flex-1 truncate">{(state === "locked" ? blockers : blocks).slice(0, 4).map((b, i) => <span key={b.key}>{i > 0 && t(", ")}<button onClick={() => onOpen(b.key)} className="hover:text-link" dir="auto">{b.def.name}</button></span>)}</span></div>
        )}
        {learned && c.learnedVia && c.learnedVia !== "manual" && <span className="text-[12px] text-muted">{t("Learned through {name}.", { name: path.courses.find((x) => x.key === c.learnedVia)?.spaceName ?? c.learnedVia })}</span>}
        {c.reviewDue && (
          <div className="flex items-center gap-2"><span className="flex-1 text-[12.5px] text-learn">{t("Due for revision")}</span>
            <button onClick={() => save(markRevised(note.body, c, false))} className="h-7 rounded-[8px] border border-line px-2.5 text-[12.5px] text-bad">{t("Again")}</button>
            <button onClick={() => save(markRevised(note.body, c, true))} className="h-7 rounded-[8px] border border-line px-2.5 text-[12.5px] text-ok">{t("Got it · {n} d", { n: nextInterval(c) })}</button></div>
        )}
        {!phone && (c.learnedVia === "manual"
          ? <button onClick={() => save(setManualDone(note.body, c, false))} className="flex h-8 items-center self-start rounded-[10px] border border-line px-3">{t("Unmark learned")}</button>
          : !learned && <button onClick={() => setState("learned")} className="flex h-8 items-center self-start rounded-[10px] bg-accent px-3 font-semibold text-accent-fg">{t("Mark learned")}</button>)}
        <TutorEntry pathId={note.id} c={c} />
      </div>
    ),
    practice: () => (
      <div className="flex flex-col gap-2">
        <span className="text-[12.5px] text-muted">{t("{n} questions from {source}: multiple choice and short answers. Score 80% or more and it counts as learned.", { n: 5, source: practice.material.notes.length ? t("{n} note|{n} notes", { n: practice.material.notes.length }) : t("general knowledge (no notes linked yet)") })}</span>
        {practice.msg && <span className="text-[12px] text-warn">{practice.msg}</span>}
        <button onClick={() => { setQuiz(true); void practice.start(); }} className="flex h-8 items-center gap-2 self-start rounded-[10px] px-3 font-semibold" style={{ background: "color-mix(in srgb,var(--learn) 14%,transparent)", color: "var(--learn)" }}><Glyph name="flashcards" size={15} />{t("Start practice")}</button>
      </div>
    ),
    taught: () => (
      <div className="flex flex-col gap-1.5">
        {[...c.coverage].sort((a, b) => path.courses.indexOf(a.course) - path.courses.indexOf(b.course)).map((cov, k) => (
          <div key={k} draggable onDragStart={(e) => { startDrag(e, "alias", JSON.stringify({ name: cov.topic.name, from: c.key }), cov.topic.name); dragGhost(e, cov.topic.name); }} onDragEnd={() => endDrag()}
            title={`${cov.course.spaceName} › ${cov.module} › ${cov.topic.name}. ${t("Drag onto another concept on the board: this topic then counts as that concept.")}`}
            className="flex h-[34px] cursor-grab items-center gap-2 rounded-[8px] bg-bg px-2 active:cursor-grabbing">
            <GripVertical size={13} className="shrink-0 text-muted" aria-hidden />
            <span className="h-[18px] w-[3px] shrink-0 rounded-[2px]" style={{ background: cov.course.color }} />
            <span className="min-w-0 flex-1 truncate" dir="auto"><span className="text-muted">{abbrevCourse(cov.course.spaceName, 14)} · {abbrevCourse(cov.module, 12)} — </span><span className="lp-topic">{cov.topic.name}</span></span>
            <select value={cov.topic.status} onChange={(e) => void setCourseStatus(cov, e.target.value as TopicStatus)} aria-label={t("Status in {name}", { name: cov.course.spaceName })} disabled={!cov.course.note}
              className="max-w-[78px] shrink-0 cursor-pointer appearance-none bg-transparent text-end text-[12px] outline-none" style={{ color: TOPIC_ST[cov.topic.status] }}>
              {(["todo", "learning", "done", "skipped"] as TopicStatus[]).map((s) => <option key={s} value={s} style={{ color: "var(--text)", background: "var(--surface)" }}>{t(TOPIC_LABEL[s])}</option>)}
            </select>
            <button onClick={() => void openLesson(cov)} className="shrink-0 text-[12px] text-link hover:underline">{t("Open")}</button>
          </div>
        ))}
        {!c.coverage.length && <p className="text-[12.5px] text-muted">{t("Your own concept (not in a course): mark it learned in Mastery.")}</p>}
        {c.coverage.length > 0 && <span className="text-[11.5px] text-muted">{t("Status changes update that course's own roadmap. Learned when any one course is finished.")}</span>}
      </div>
    ),
    prereq: () => (
      <div className="flex flex-wrap items-center gap-1.5">
        {c.needs.map((n) => { const d = path.byKey.get(n)!; const own = pathNeeds(c, d); return chip(d, own, own, () => save(removeConceptNeed(note.body, c, d))); })}
        {addingNeed ? (
          <div className="relative w-full">
            <input autoFocus value={nq} onChange={(e) => setNq(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setAddingNeed(false))} placeholder={t("Needs which concept…")} className={inputCls} />
            <div className="mt-1 max-h-48 overflow-y-auto rounded-[8px] border border-line bg-bg p-1">
              {needCandidates.slice(0, 40).map((x) => <button key={x.key} onClick={() => { save(addConceptNeed(c.placed ? note.body : moveConcept(note.body, c, path.doc.stages[0]?.name ?? "Stage 1"), c, x)); setAddingNeed(false); setNq(""); }} className="flex w-full rounded-[6px] px-2 py-1 text-start text-[12.5px] hover:bg-surface-2" dir="auto">{x.def.name}</button>)}
              {!needCandidates.length && <span className="block px-2 py-1 text-[12.5px] text-muted">{t("No concept fits (loops are refused).")}</span>}
            </div>
          </div>
        ) : (
          <button onClick={() => setAddingNeed(true)} className="flex h-7 items-center gap-1 rounded-[6px] border border-dashed border-line px-2.5 text-[12.5px] text-muted hover:text-ink"><Plus size={12} />{t("Add")}</button>
        )}
      </div>
    ),
    unlocks: () => (
      <div className="flex flex-wrap gap-1.5">
        {c.unlocks.map((k) => { const x = path.byKey.get(k)!; const own = pathNeeds(x, c); return chip(x, own, own, () => save(removeConceptNeed(note.body, x, c))); })}
        {!c.unlocks.length && <span className="text-[12.5px] text-muted">{t("Nothing depends on it yet.")}</span>}
      </div>
    ),
    resources: () => (
      <div className="flex flex-col gap-1.5">
        {res.map((r) => <ResourceRow key={r.url} r={r} onRemove={c.def.resources.some((x) => x.url === r.url) ? () => save(removeResource(note.body, c, r.url)) : undefined} />)}
        <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (!/^https?:\/\//.test(url)) return toast(t("Paste a link (YouTube, course video, article, book…)")); const base = c.placed ? note.body : moveConcept(note.body, c, path.doc.stages[0]?.name ?? "Stage 1"); save(addResource(base, c, label.trim() || url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60), url)); setUrl(""); setLabel(""); }}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("Paste a link")} aria-label={t("Resource link")} dir="ltr" className={inputCls + " min-w-0 flex-1"} />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("Name")} aria-label={t("Resource name")} className={inputCls + " !w-24 shrink-0"} />
          <button type="submit" aria-label={t("Add resource")} className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-accent text-accent-fg"><Plus size={14} /></button>
        </form>
        <span className="text-[11.5px] text-muted">{t("Links inside each course's lesson notes are collected here.")}</span>
      </div>
    ),
    manage: () => tail,
    notes: () => (
      <div className="flex flex-col gap-1">
        {notes.map(({ title, note: n }) => (
          <button key={title} onClick={() => n && openNote(n.id)} className="flex h-[34px] items-center gap-2 rounded-[8px] bg-bg px-2 text-start hover:text-link">
            <Glyph name={n?.type === "pdf" ? "pdf" : "lesson"} size={15} color="var(--muted)" /><span className="min-w-0 flex-1 truncate" dir="auto">{title}</span>{!n && <span className="text-[11.5px] text-muted">{t("missing")}</span>}
          </button>
        ))}
        <button onClick={() => void openLesson(c.coverage[0])} className="flex h-8 items-center gap-1.5 self-start rounded-[8px] border border-dashed border-line px-2.5 text-[12.5px] text-muted hover:text-ink"><Plus size={12} />{notes.length ? t("Open or add a lesson note") : t("Create a lesson note")}</button>
      </div>
    ),
  };
  const order: Sec[] = ["mastery", "practice", "taught", "prereq", "unlocks", "resources", "notes", "manage"];
  const toggle = (s: Sec) => setOpen((o) => (o.includes(s) ? o.filter((x) => x !== s) : [...o, s]));

  const others = path.concepts.filter((x) => x.key !== c.key && (!mq || x.def.name.toLowerCase().includes(mq.toLowerCase()))).slice(0, 50);
  const tail = (
    <div className="flex flex-col gap-1.5">
      {ask?.kind === "merge" && <ConfirmBar text={tx("Merge “{a}” into “{b}”?", { a: <b dir="auto">{ask.other.def.name}</b>, b: <b dir="auto">{c.def.name}</b> })} ok={t("Merge")} onCancel={() => setAsk(null)} onOk={() => { save(mergeConcepts(note.body, c, ask.other)); toast(t("Merged “{a}” into “{b}”", { a: ask.other.def.name, b: c.def.name })); setAsk(null); setMergePick(false); }} />}
      {ask?.kind === "out" && <ConfirmBar danger text={tx("Take “{name}” out of the path? Its course topics go back to Not placed yet.", { name: <b dir="auto">{c.def.name}</b> })} ok={t("Take out")} onCancel={() => setAsk(null)} onOk={() => { save(removeConcept(note.body, c)); toast(t("“{name}” taken out of the path", { name: c.def.name })); onClose(); }} />}
      {!ask && (
        <>
          <button onClick={() => setMergePick((m) => !m)} aria-expanded={mergePick} className="flex h-[34px] items-center gap-2 rounded-[8px] bg-bg px-2 text-start hover:text-ink"><Glyph name="merge" size={15} color="var(--muted)" /><span className="flex-1">{t("Merge with another concept")}</span><span className="text-[12px] text-muted">{t("same idea, other name")}</span><ChevronDown size={13} className={cx("text-muted transition-transform", mergePick && "rotate-180")} /></button>
          {c.placed && <button onClick={() => setAsk({ kind: "out" })} className="flex h-[34px] items-center gap-2 rounded-[8px] bg-bg px-2 text-start hover:text-bad"><X size={15} className="text-muted" /><span className="flex-1">{t("Take out of the path")}</span><span className="text-[12px] text-muted">{t("topics go back to Not placed")}</span></button>}
        </>
      )}
      {mergePick && !ask && (
        <div className="flex flex-col gap-1">
          <input autoFocus value={mq} onChange={(e) => setMq(e.target.value)} placeholder={t("Same idea, different name…")} className={inputCls} />
          <div className="max-h-48 overflow-y-auto rounded-[8px] border border-line p-1">
            {others.map((x) => <button key={x.key} onClick={() => setAsk({ kind: "merge", other: x })} className="flex w-full justify-between gap-2 rounded-[6px] px-2 py-1 text-start text-[12.5px] hover:bg-surface-2"><span dir="auto" className="truncate">{x.def.name}</span><span className="shrink-0 text-muted">{[...new Set(x.coverage.map((y) => abbrevCourse(y.course.spaceName, 12)))].slice(0, 2).join(", ")}</span></button>)}
          </div>
        </div>
      )}
    </div>
  );

  const header = (
    <div className={cx("flex shrink-0 flex-col gap-1.5", phone ? "pb-3" : "border-b border-line px-[18px] pb-3 pt-4")}>
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <span className="truncate">{stageLabel(path, c)}</span><span className="flex-1" />
        <button onClick={() => onFocus(c.key)} className="shrink-0 hover:text-ink">{t("Focus in graph")}</button>
        {!phone && <button aria-label={t("Close")} onClick={onClose} className="hover:text-ink"><X size={16} /></button>}
      </div>
      <div className="flex items-center gap-2.5">
        <Glyph name={c.reviewDue ? "s-revise" : st.glyph} size={phone ? 20 : 18} color={c.reviewDue ? "var(--learn)" : st.color} />
        <input dir="auto" key={c.key} defaultValue={c.def.name} aria-label={t("Concept name")} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          onBlur={(e) => e.target.value.trim() && e.target.value !== c.def.name && save(renameConcept(note.body, c, e.target.value.trim()))}
          className={cx("min-w-0 flex-1 bg-transparent font-[650] tracking-[-.01em] outline-none", phone ? "text-[22px]" : "text-[21px]")} />
      </div>
    </div>
  );

  // ------------------------------------------------------------------ phone: full-height bottom sheet
  if (phone) {
    return (
      <>
        <div className="fixed inset-0 z-40" style={{ background: "rgba(5,6,8,.55)" }} onClick={onClose} />
        <aside role="dialog" aria-label={c.def.name} className="sheet-in safe-b fixed inset-x-0 bottom-0 top-[120px] z-50 flex flex-col rounded-t-[14px] bg-surface px-4 pt-2.5">
          <div className="flex shrink-0 justify-center pb-2.5"><button aria-label={t("Close")} onClick={onClose} className="h-1 w-9 rounded-[2px] bg-line" /></div>
          {quiz ? <PracticeQuiz p={practice} note={note} onClose={() => setQuiz(false)} phone /> : phoneSec ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <button onClick={() => setPhoneSec(null)} className="flex h-11 shrink-0 items-center gap-1 text-[15px] font-semibold"><ChevronLeft size={18} />{titles[phoneSec]}</button>
              <div className="min-h-0 flex-1 overflow-y-auto pb-4">{body[phoneSec]()}</div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              {header}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {body.mastery()}
                <div className="mt-3">
                  {order.filter((s) => s !== "mastery").map((s) => (
                    <button key={s} onClick={() => s === "practice" ? (setQuiz(true), void practice.start()) : setPhoneSec(s)} className="flex h-[52px] w-full items-center gap-2.5 border-t border-line text-start">
                      <span className="flex-1 font-semibold">{titles[s]}</span><span className="text-[12.5px] text-muted">{meta[s]}</span><ChevronRight size={15} className="text-muted" />
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 gap-2.5 pb-3">
                <button onClick={() => { setQuiz(true); void practice.start(); }} className="flex h-[52px] flex-1 items-center justify-center rounded-[12px] font-semibold" style={{ background: "color-mix(in srgb,var(--learn) 14%,transparent)", color: "var(--learn)" }}>{t("Practice · {n}", { n: 5 })}</button>
                {c.learnedVia === "manual" ? <button onClick={() => save(setManualDone(note.body, c, false))} className="flex h-[52px] flex-1 items-center justify-center rounded-[12px] border border-line font-semibold">{t("Unmark learned")}</button>
                  : <button onClick={() => setState("learned")} disabled={learned} className="flex h-[52px] flex-1 items-center justify-center rounded-[12px] bg-accent font-semibold text-accent-fg disabled:opacity-50">{learned ? t("Learned") : t("Mark learned")}</button>}
              </div>
            </div>
          )}
        </aside>
      </>
    );
  }

  // ------------------------------------------------------------------ desktop: right sheet over the view
  return (
    <aside className="fade-in absolute inset-y-0 end-0 z-[4] flex w-[420px] flex-col border-s border-line bg-surface" style={{ boxShadow: "var(--lp-sh)" }} aria-label={c.def.name}>
      {header}
      {quiz ? <PracticeQuiz p={practice} note={note} onClose={() => setQuiz(false)} /> : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {order.map((s) => {
              const isOpen = open.includes(s);
              return (
                <div key={s} className="border-b border-line" data-sec={s}>
                  <button onClick={() => toggle(s)} aria-expanded={isOpen} className="flex h-[42px] w-full items-center gap-2 px-[18px] text-start">
                    {isOpen ? <ChevronDown size={13} className="text-muted" /> : <ChevronRight size={13} className="text-muted" />}
                    <span className="flex-1 font-semibold">{titles[s]}</span><span className="max-w-[220px] truncate text-[12px] text-muted">{meta[s]}</span>
                  </button>
                  {isOpen && <div className="px-[18px] pb-3.5">{body[s]()}</div>}
                </div>
              );
            })}
          </div>
          <div className="flex shrink-0 gap-2 border-t border-line px-[18px] py-3.5">
            <button onClick={() => { setQuiz(true); void practice.start(); }} className="flex h-9 flex-1 items-center justify-center gap-2 rounded-[10px] font-semibold" style={{ background: "color-mix(in srgb,var(--learn) 14%,transparent)", color: "var(--learn)" }}><Glyph name="flashcards" size={15} />{t("Practice · {n} questions", { n: 5 })}</button>
            <button onClick={() => { setQuiz(true); void practice.start(); }} disabled={learned} title={learned ? t("Already learned") : t("Score 80% or more to mark it learned")} className="flex h-9 items-center rounded-[10px] border border-line px-3 disabled:opacity-50">{t("Test out")}</button>
          </div>
        </>
      )}
    </aside>
  );
}
