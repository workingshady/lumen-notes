// Today: the rule-based daily study plan (design: handoffs/2026-11-19-round-4/TodayDesk.dc.html; rules: docs/TODAY.md).
// Desktop: plan list + a 360px column (This week, How today was built). Phone: one column; the board button swaps
// the plan for the week card.
import { EmptyState } from "../components/EmptyState";
import { BookOpen } from "lucide-react";
import { useCallback, useState } from "react";
import { updateNote } from "../lib/actions";
import { db } from "../lib/db";
import { markRevised, setManualDone, type BuiltConcept } from "../lib/path";
import type { PlanItem } from "../lib/plan";
import { go, openNote, toast, useVault } from "../lib/store";
import { ConceptPractice } from "../components/ConceptPractice";
import { Glyph } from "../components/Glyph";
import { markPlanItem, startStudyTimer, useTodayData, type TodayData } from "../components/today-data";
import { PlanRow, usePlanHandlers, type ItemHandlers } from "../components/today-item";
import { MissedBanner } from "../components/today-reschedule";
import { WeekPanel } from "../components/today-week";
import { Button, Empty, Sheet } from "../components/ui";
import { StudyPlanSettings } from "./settings-plan";
import { fmtDate, fmtNum, getLang, t } from "../lib/i18n";

/** "Thursday 19 November" (Arabic: "الخميس، ١٩ نوفمبر") for a YYYY-MM-DD day. */
const longDate = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  if (getLang() === "ar") return fmtDate(d, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const p = (o: Intl.DateTimeFormatOptions) => fmtDate(d, { ...o, timeZone: "UTC" });
  return `${p({ weekday: "long" })} ${p({ day: "numeric" })} ${p({ month: "long" })}`;
};

export function TodayView() {
  const [force, setForce] = useState(false);
  const data = useTodayData(force);
  const [weekOpen, setWeekOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [concept, setConcept] = useState<{ it: PlanItem; mode: "start" | "done" } | null>(null);
  const [asideOpen, setAsideOpen] = useState(false);
  const onConcept = useCallback((it: PlanItem, mode: "start" | "done") => setConcept({ it, mode }), []);
  const h = usePlanHandlers(onConcept);
  const { plan, input } = data;
  const goal = plan.budget || input.settings.dailyMinutes;
  const donePct = goal ? Math.min(100, (plan.doneMinutes / goal) * 100) : 0;
  const plannedPct = goal ? Math.min(100 - donePct, ((plan.planned - plan.doneMinutes) / goal) * 100) : 0;
  const kindOf = (it: PlanItem) => data.courses.find((c) => c.key === it.course?.key)?.kind;

  if (!data.ready) return <div className="p-6 text-[13px] text-muted">{t("Building today's plan…")}</div>;

  const reviews = plan.sections.reviews.filter((x) => x.kind === "cards");
  const revise = [...plan.sections.reviews.filter((x) => x.kind !== "cards"), ...plan.sections.practice];
  const newCount = plan.sections.new.filter((x) => x.state !== "skip" && x.state !== "later").length;
  const groups: { id: string; name: string; meta: string; items: PlanItem[] }[] = [
    { id: "reviews", name: t("Reviews"), meta: `· ${t("always first")}`, items: reviews },
    { id: "continue", name: t("Continue"), meta: "", items: plan.sections.continue },
    { id: "new", name: t("New lessons"), meta: `· ${t("{n} of max {max}", { n: newCount, max: input.settings.maxNew })}`, items: plan.sections.new },
    { id: "revise", name: t("Revise & practice"), meta: "", items: revise },
    { id: "extra", name: t("If you have time"), meta: `· ${t("over today's budget")}`, items: plan.extra },
  ];
  const all = groups.flatMap((g) => g.items);
  const settingsBtn = <button onClick={() => setSettingsOpen(true)} className="self-start text-[12.5px] text-link hover:underline">{t("Study plan settings")}</button>;
  const side = (
    <>
      <WeekPanel today={plan.date} settings={input.settings} log={data.log} sessions={data.sessions} cardsReviewed={data.cardsReviewed} />
      <div className="flex flex-col gap-1.5 rounded-[14px] border border-line bg-surface px-4 py-3.5 text-[12.5px] leading-[18px] text-muted">
        <span className="font-semibold text-ink">{t("How today was built")}</span>
        {t("Reviews always first. Then the course you're mid-way through, new lessons by due date and course order (max {n} new), revisions due on your learning path ladders, and one practice quiz.", { n: input.settings.maxNew })}
        {settingsBtn}
      </div>
    </>
  );

  return (
    <div className="safe-t flex h-full flex-col overflow-y-auto text-[13px] leading-[normal] sm:overflow-hidden">
      <header className="flex flex-wrap items-end gap-4 px-4 pb-3 pt-3.5 sm:px-8 sm:pb-4 sm:pt-6">
        <div className="flex min-w-[200px] flex-1 flex-col gap-1">
          <span className="text-muted">{longDate(plan.date)}{!plan.studyDay ? ` · ${t("rest day")}` : ""}</span>
          <h1 className="text-[24px] font-[650] tracking-[-0.02em] sm:text-[28px]">{t("Today")}</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex min-w-[150px] flex-col gap-1">
            <span className="text-[12px] text-muted tabular-nums">{t("Planned {planned} of {goal} min", { planned: plan.planned, goal })}</span>
            <span className="flex h-1.5 overflow-hidden rounded-[3px] bg-surface-2" role="progressbar" aria-label={t("Done and planned minutes of the daily goal")} aria-valuenow={Math.round(donePct)} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${donePct}%`, background: "var(--success)" }} />
              <span style={{ width: `${Math.max(0, plannedPct)}%`, background: "color-mix(in srgb, var(--text) 30%, transparent)" }} />
            </span>
          </div>
          <span className="flex flex-col items-end" title={t("Days in a row with study activity")}><b className="text-[18px] font-[650] tabular-nums">{fmtNum(data.streak)}</b><span className="text-[11.5px] text-muted">{t("day streak")}</span></span>
          <button aria-label={t("Week and goals")} aria-pressed={weekOpen} onClick={() => (window.matchMedia("(min-width: 1024px)").matches ? setSettingsOpen(true) : setWeekOpen((o) => !o))}
            className="flex size-8 items-center justify-center rounded-[8px] border border-line hover:bg-surface-2" style={weekOpen ? { background: "var(--surface-2)" } : undefined} title={t("This week · study plan")}>
            <Glyph name="v-board" size={15} />
          </button>
        </div>
      </header>

      {plan.noSources ? (
        <div className="px-4 sm:px-8">
          <Empty title={t("Nothing to plan from yet")} hint={t("Today plans your day from course roadmaps, learning paths and due flashcards. Create a course with a roadmap, or a learning path, to start.")}
            action={<Button variant="primary" onClick={() => go("notes", { spaceId: "all", filter: "paths", folderId: null, tag: null, noteId: null })}>{t("Open learning paths")}</Button>} />
        </div>
      ) : (
        <>
          <div className="px-4 sm:px-8"><MissedBanner today={plan.date} settings={input.settings} courses={data.courses} missed={data.missed} /></div>
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-[18px] px-4 pb-4 sm:px-8 lg:grid-cols-[1fr_360px]">
            <div className="flex min-w-0 flex-col gap-3.5 lg:overflow-y-auto">
              {weekOpen && <div className="flex flex-col gap-3.5 lg:hidden">{side}</div>}
              {!weekOpen && (
                <>
                  {!plan.studyDay && all.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-surface px-3.5 py-3">
                      <span className="flex-1 text-muted">{t("Rest day: only reviews are planned.")}</span>
                      <button onClick={() => setForce(true)} className="flex h-[30px] items-center rounded-[8px] border border-line px-3 font-semibold hover:bg-surface-2">{t("Plan lessons anyway")}</button>
                    </div>
                  )}
                  {/* Lumen 21 empty state: rest day → "Plan anyway" pulls lessons in; study day with nothing left → learning paths */}
                  {!all.length && (plan.studyDay
                    ? <EmptyState framed glyph="date" text={t("All caught up. Nothing else is planned today.")} action={{ label: t("Open learning paths"), onClick: () => go("notes", { spaceId: "all", filter: "paths", folderId: null, tag: null, noteId: null }) }} />
                    : <EmptyState framed glyph="date" text={t("Nothing planned. Today is a rest day.")} action={{ label: t("Plan anyway"), onClick: () => setForce(true) }} />)}
                  {groups.map((g) => g.items.length > 0 && (
                    <Section key={g.id} name={g.name} meta={g.meta} items={g.items} h={h} kindOf={kindOf} />
                  ))}
                  {plan.setAside.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[12.5px] text-muted">{t("Skipped or moved")} · {plan.setAside.length} <button onClick={() => setAsideOpen((o) => !o)} aria-expanded={asideOpen} className="text-link hover:underline">{asideOpen ? t("Hide") : t("Show")}</button></span>
                      {asideOpen && plan.setAside.map((it) => <PlanRow key={it.id} it={it} h={h} kind={kindOf(it)} />)}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="hidden flex-col gap-3.5 lg:flex">{side}</div>
          </div>
        </>
      )}
      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title={t("Study plan")}>
        <StudyPlanSettings embedded />
      </Sheet>
      {concept && <ConceptSheet data={data} it={concept.it} mode={concept.mode} onClose={() => setConcept(null)} />}
    </div>
  );
}

function Section({ name, meta, items, h, kindOf }: { name: string; meta: string; items: PlanItem[]; h: ItemHandlers; kindOf: (it: PlanItem) => string | undefined }) {
  return (
    <section aria-label={name} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{name}{meta && <span className="font-medium normal-case tracking-normal">{meta}</span>}</div>
      {items.map((it) => <PlanRow key={it.id} it={it} h={h} current={it.kind === "continue" && it.state === "todo"} kind={kindOf(it)} />)}
    </section>
  );
}

/** Revision ("Got it" / "Again" moves the concept's review ladder) or practice (the path's test-out quiz). */
export function ConceptSheet({ data, it, mode, onClose }: { data: TodayData; it: PlanItem; mode: "start" | "done"; onClose: () => void }) {
  const v = useVault();
  const tg = it.target?.type === "concept" ? it.target : null;
  const path = tg ? data.input.paths.find((p) => p.noteId === tg.pathNoteId) : undefined;
  const c: BuiltConcept | undefined = tg && path ? path.built.byKey.get(tg.concept) : undefined;
  const note = path ? v.byId.get(path.noteId) : undefined;
  if (!tg || !path || !c || !note) return null;
  const save = async (fn: (body: string) => string) => { const n = await db.notes.get(note.id); if (n) await updateNote(n.id, { body: fn(n.body) }); };
  const revise = async (remembered: boolean) => {
    await save((b) => markRevised(b, c, remembered));
    await markPlanItem(it, "done");
    toast(remembered ? t("{name}: next revision moved out", { name: c.def.name }) : t("{name}: back to tomorrow", { name: c.def.name }));
    onClose();
  };
  const notes = [...c.def.notes, ...c.coverage.map((x) => x.topic.note).filter((x): x is string => !!x)].filter((x, i, a) => a.indexOf(x) === i);
  return (
    <Sheet open onClose={onClose} title={it.kind === "practice" ? t("Test out: {name}", { name: c.def.name }) : t("Revise: {name}", { name: c.def.name })} wide={it.kind === "practice"}>
      {it.kind === "practice" ? (
        <div className="flex flex-col gap-3">
          <ConceptPractice concept={c} path={path.built} note={note} onTestOut={() => { void save((b) => setManualDone(b, c, true)); void markPlanItem(it, "done"); onClose(); }} />
          <div className="flex justify-end"><Button variant="secondary" className="max-sm:h-11" onClick={() => { void markPlanItem(it, "done"); onClose(); }}>{t("Mark practice done")}</Button></div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 text-[13px]">
          <span className="text-muted">{mode === "start" ? t("Recall what you know about it, check your notes, then say how it went.") : t("How did the revision go?")}</span>
          {notes.length > 0 && (
            <div className="flex flex-col gap-1">
              {notes.map((title) => {
                const n = v.byTitle.get(title.toLowerCase());
                return n ? <button key={title} onClick={() => { openNote(n.id, "read"); startStudyTimer(); onClose(); }} className="flex h-11 items-center gap-2 rounded-[8px] px-2 text-start hover:bg-surface-2 sm:h-9"><BookOpen size={14} className="text-muted" /><span dir="auto" className="truncate">{title}</span></button> : null;
              })}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" className="max-sm:h-11" onClick={() => void revise(false)}>{t("Again")}</Button>
            <Button variant="primary" className="max-sm:h-11" onClick={() => void revise(true)}>{t("Got it")}</Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
