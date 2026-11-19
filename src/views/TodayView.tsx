// Today: the rule-based daily study plan (spec: docs/design/CLAUDE_DESIGN_UPDATE_04.md §D3, rules: docs/TODAY.md).
import { BookOpen, ChevronDown, Flame, Settings2 } from "lucide-react";
import { useCallback, useState } from "react";
import { updateNote } from "../lib/actions";
import { db } from "../lib/db";
import { markRevised, setManualDone, type BuiltConcept } from "../lib/path";
import { shortDate, type PlanItem, type SectionId } from "../lib/plan";
import { go, openNote, toast, useVault } from "../lib/store";
import { ConceptPractice } from "../components/ConceptPractice";
import { markPlanItem, startStudyTimer, useTodayData, type TodayData } from "../components/today-data";
import { PlanRow, usePlanHandlers } from "../components/today-item";
import { MissedBanner } from "../components/today-reschedule";
import { WeekPanel } from "../components/today-week";
import { Button, cx, Empty, Segmented, Sheet } from "../components/ui";
import { StudyPlanSettings } from "./settings-plan";

const SECTION_NAME: Record<SectionId, string> = { continue: "Continue", new: "New lessons", reviews: "Reviews", practice: "Practice" };
const ORDER: SectionId[] = ["continue", "new", "reviews", "practice"];

export function TodayView() {
  const [force, setForce] = useState(false);
  const data = useTodayData(force);
  const [tab, setTab] = useState<"today" | "week">(() => { try { return localStorage.getItem("lumen.today.tab") === "week" ? "week" : "today"; } catch { return "today"; } });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [concept, setConcept] = useState<{ it: PlanItem; mode: "start" | "done" } | null>(null);
  const [asideOpen, setAsideOpen] = useState(false);
  const onConcept = useCallback((it: PlanItem, mode: "start" | "done") => setConcept({ it, mode }), []);
  const h = usePlanHandlers(onConcept);
  const { plan, input } = data;
  const setT = (t: "today" | "week") => { setTab(t); try { localStorage.setItem("lumen.today.tab", t); } catch { /* ignore */ } };
  const items = ORDER.flatMap((s) => plan.sections[s]);
  const goal = plan.budget || input.settings.dailyMinutes;
  const pct = goal ? Math.min(100, Math.round((plan.planned / goal) * 100)) : 0;
  const donePct = goal ? Math.min(100, Math.round((plan.doneMinutes / goal) * 100)) : 0;

  if (!data.ready) return <div className="p-6 text-[13px] text-muted">Building today's plan…</div>;

  return (
    <div className="safe-t h-full overflow-y-auto text-[14px] sm:text-[13px]">
      <div className="mx-auto flex max-w-[880px] flex-col gap-4 px-4 pb-10 pt-3 sm:px-8 sm:py-7">
        <header className="flex flex-col gap-3">
          <div className="flex items-start gap-2 sm:gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h1 className="text-[22px] font-[650] tracking-[-0.02em] sm:text-[24px]">Today</h1>
              <span className="text-[13px] text-muted">{shortDate(plan.date)}{!plan.studyDay ? " · rest day" : ""}</span>
            </div>
            <span className="flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[13px]" title="Days in a row with study activity">
              <Flame size={14} style={{ color: data.streak ? "var(--accent)" : "var(--muted)" }} /><span className="tabular-nums">{data.streak}</span><span className="text-muted">day streak</span>
            </span>
            <button aria-label="Study plan settings" onClick={() => setSettingsOpen(true)} className="flex size-11 items-center justify-center rounded-[10px] text-muted hover:bg-surface-2 hover:text-ink sm:size-9"><Settings2 size={17} /></button>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span><span className="font-semibold tabular-nums">{plan.planned} min</span> <span className="text-muted">planned of {goal} min goal</span></span>
              <span className="text-muted tabular-nums">{plan.doneMinutes} min done</span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Planned minutes of the daily goal" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: "color-mix(in srgb, var(--accent) 35%, transparent)" }} />
              <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${donePct}%` }} />
            </div>
          </div>
          <Segmented value={tab} onChange={setT} options={[{ value: "today", label: "Plan" }, { value: "week", label: "Week" }]} className="self-start" />
        </header>

        {tab === "week" ? (
          <WeekPanel today={plan.date} settings={input.settings} log={data.log} sessions={data.sessions} cardsReviewed={data.cardsReviewed} courses={data.courses} />
        ) : plan.noSources ? (
          <Empty title="Nothing to plan from yet" hint="Today plans your day from course roadmaps, learning paths and due flashcards. Create a course space with a roadmap, or a learning path, to get started."
            action={<Button variant="primary" onClick={() => go("notes", { spaceId: "all", filter: "paths", folderId: null, tag: null, noteId: null })}>Open learning paths</Button>} />
        ) : (
          <>
            <MissedBanner today={plan.date} settings={input.settings} courses={data.courses} missed={data.missed} />
            {!plan.studyDay && (
              <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-4 sm:flex-row sm:items-center">
                <span className="flex-1 text-[13px] text-muted">Rest day: only reviews are planned. Change study days in settings.</span>
                <Button variant="secondary" className="max-sm:h-11" onClick={() => setForce(true)}>Plan lessons anyway</Button>
              </div>
            )}
            {!items.length && (
              <Empty title={plan.studyDay ? "All caught up" : "Nothing due today"} hint={plan.extra.length ? "Nothing fits today's budget. Pick something below if you have time." : "No lessons are unlocked and no cards or revisions are due. Add topics to a course roadmap, or enjoy the break."} />
            )}
            {ORDER.map((sid) => plan.sections[sid].length > 0 && (
              <section key={sid} aria-label={SECTION_NAME[sid]} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between px-1">
                  <h2 className="text-[12px] font-semibold uppercase tracking-[.06em] text-muted">{SECTION_NAME[sid]}</h2>
                  <span className="text-[12px] text-muted tabular-nums">{plan.sections[sid].reduce((a, x) => a + x.minutes, 0)} min</span>
                </div>
                {plan.sections[sid].map((it) => <PlanRow key={it.id} it={it} h={h} />)}
              </section>
            ))}
            {plan.extra.length > 0 && (
              <section aria-label="If you have time" className="flex flex-col gap-2">
                <h2 className="px-1 text-[12px] font-semibold uppercase tracking-[.06em] text-muted">If you have time</h2>
                {plan.extra.map((it) => <PlanRow key={it.id} it={it} h={h} />)}
              </section>
            )}
            {plan.setAside.length > 0 && (
              <section className="flex flex-col gap-2">
                <button onClick={() => setAsideOpen((o) => !o)} aria-expanded={asideOpen} className="flex h-11 items-center gap-1.5 px-1 text-[13px] text-muted hover:text-ink sm:h-8">
                  <ChevronDown size={14} className={cx("transition-transform", !asideOpen && "-rotate-90")} />Skipped or moved ({plan.setAside.length})
                </button>
                {asideOpen && plan.setAside.map((it) => <PlanRow key={it.id} it={it} h={h} />)}
              </section>
            )}
          </>
        )}
      </div>
      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Study plan">
        <StudyPlanSettings embedded />
      </Sheet>
      {concept && <ConceptSheet data={data} it={concept.it} mode={concept.mode} onClose={() => setConcept(null)} />}
    </div>
  );
}

/** Revision ("Got it" / "Again" moves the concept's review ladder) or practice (the path's test-out quiz). */
export function ConceptSheet({ data, it, mode, onClose }: { data: TodayData; it: PlanItem; mode: "start" | "done"; onClose: () => void }) {
  const v = useVault();
  const t = it.target?.type === "concept" ? it.target : null;
  const path = t ? data.input.paths.find((p) => p.noteId === t.pathNoteId) : undefined;
  const c: BuiltConcept | undefined = t && path ? path.built.byKey.get(t.concept) : undefined;
  const note = path ? v.byId.get(path.noteId) : undefined;
  if (!t || !path || !c || !note) return null;
  const save = async (fn: (body: string) => string) => { const n = await db.notes.get(note.id); if (n) await updateNote(n.id, { body: fn(n.body) }); };
  const revise = async (remembered: boolean) => {
    await save((b) => markRevised(b, c, remembered));
    await markPlanItem(it, "done");
    toast(remembered ? `${c.def.name}: next revision moved out` : `${c.def.name}: back to tomorrow`);
    onClose();
  };
  const notes = [...c.def.notes, ...c.coverage.map((x) => x.topic.note).filter((x): x is string => !!x)].filter((x, i, a) => a.indexOf(x) === i);
  return (
    <Sheet open onClose={onClose} title={it.kind === "practice" ? `Test out: ${c.def.name}` : `Revise: ${c.def.name}`} wide={it.kind === "practice"}>
      {it.kind === "practice" ? (
        <div className="flex flex-col gap-3">
          <ConceptPractice concept={c} path={path.built} note={note} onTestOut={() => { void save((b) => setManualDone(b, c, true)); void markPlanItem(it, "done"); onClose(); }} />
          <div className="flex justify-end"><Button variant="secondary" className="max-sm:h-11" onClick={() => { void markPlanItem(it, "done"); onClose(); }}>Mark practice done</Button></div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 text-[13px]">
          <span className="text-muted">{mode === "start" ? "Recall what you know about it, check your notes, then say how it went." : "How did the revision go?"}</span>
          {notes.length > 0 && (
            <div className="flex flex-col gap-1">
              {notes.map((title) => {
                const n = v.byTitle.get(title.toLowerCase());
                return n ? <button key={title} onClick={() => { openNote(n.id, "read"); startStudyTimer(); onClose(); }} className="flex h-11 items-center gap-2 rounded-[8px] px-2 text-left hover:bg-surface-2 sm:h-9"><BookOpen size={14} className="text-muted" /><span dir="auto" className="truncate">{title}</span></button> : null;
              })}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" className="max-sm:h-11" onClick={() => void revise(false)}>Again</Button>
            <Button variant="primary" className="max-sm:h-11" onClick={() => void revise(true)}>Got it</Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
