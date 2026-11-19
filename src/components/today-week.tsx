// "This week" card (TodayDesk.dc.html right column): goal vs done minutes per day (done = timer sessions) with the
// weekly goals as progress bars, and the goal form used by Settings › Study plan.
import { useState } from "react";
import { setGoals, weekSummary, type Goal, type GoalKind, type PlanCourse, type PlanLog, type PlanSettings } from "../lib/plan";
import { writeLog } from "./today-data";
import { Button, cx, inputCls } from "./ui";
import { fmtDate, getLang, t, tk } from "../lib/i18n";

/** Weekday of a YYYY-MM-DD day in the interface language ("M" / "Mon"; Arabic: full short names, no one-letter forms). */
const wd = (iso: string, w: "narrow" | "short") => fmtDate(new Date(iso + "T00:00:00Z"), { weekday: getLang() === "ar" && w === "narrow" ? "short" : w, timeZone: "UTC" });
const KIND_LABEL: Record<GoalKind, string> = { lessons: tk("{n} lesson|{n} lessons"), cards: tk("{n} card|{n} cards"), minutes: tk("{n} minute|{n} minutes"), revisions: tk("{n} revision|{n} revisions") };
const KIND_NAME: Record<GoalKind, string> = { lessons: tk("lessons"), cards: tk("cards"), minutes: tk("minutes"), revisions: tk("revisions") };
const goalText = (g: Goal) => `${t(KIND_LABEL[g.kind], { n: g.n })}${g.course ? ` · ${g.course}` : ""}`;
const KINDS: GoalKind[] = ["lessons", "cards", "minutes", "revisions"];
const KIND_COLOR: Record<GoalKind, string> = { lessons: "var(--info)", cards: "var(--learn)", minutes: "var(--success)", revisions: "var(--success)" };

export function WeekPanel({ today, settings, log, sessions, cardsReviewed }: { today: string; settings: PlanSettings; log: PlanLog; sessions: { at: string; minutes: number }[]; cardsReviewed: number; courses?: PlanCourse[] }) {
  const w = weekSummary(today, settings, log, sessions, cardsReviewed);
  const max = Math.max(1, ...w.days.map((d) => d.goal));
  return (
    <section aria-label={t("This week")} className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
      <div className="flex items-center">
        <span className="flex-1 font-semibold">{t("This week")}</span>
        <span className="text-[12px] text-muted tabular-nums">{t("{done} / {goal} min", { done: w.doneMinutes, goal: w.goalMinutes })}</span>
      </div>
      <div className="grid h-[110px] grid-cols-7 items-end gap-1.5" role="list" aria-label={t("Goal and done minutes per day")}>
        {w.days.map((d) => {
          const goalH = d.goal ? (d.goal / max) * 90 : 6;
          const doneH = d.goal ? Math.min(100, (d.done / d.goal) * 100) : 0;
          return (
            <div key={d.date} role="listitem" aria-label={t("{day}: {done} of {goal} minutes", { day: wd(d.date, "short"), done: d.done, goal: d.goal })} className="flex h-full flex-col items-center justify-end gap-1.5">
              <div className="relative box-border w-full rounded-[4px] border border-dashed border-line" style={{ height: `${goalH}%` }}>
                <span className="absolute inset-x-0 bottom-0 rounded-[3px]" style={{ height: `${doneH}%`, background: d.goal && d.done >= d.goal ? "var(--success)" : "color-mix(in srgb, var(--success) 60%, transparent)" }} />
              </div>
              <span className="text-[11px]" style={{ color: d.isToday ? "var(--accent)" : "var(--muted)", fontWeight: d.isToday ? 700 : 400 }}>{wd(d.date, "narrow")}</span>
            </div>
          );
        })}
      </div>
      {w.goals.map((g) => (
        <div key={`${g.goal.kind}:${g.goal.course}:${g.goal.n}`} className="flex flex-col gap-[5px]">
          <div className="flex text-[12.5px]"><span dir="auto" className="min-w-0 flex-1 truncate">{goalText(g.goal)}</span><span className="text-muted tabular-nums">{t("{done} / {goal}", { done: g.done, goal: g.goal.n })}</span></div>
          <span className="h-[5px] overflow-hidden rounded-[3px] bg-surface-2"><span className="block h-full" style={{ width: `${g.pct}%`, background: g.pct >= 100 ? "var(--success)" : KIND_COLOR[g.goal.kind] }} /></span>
        </div>
      ))}
      {!w.goals.length && <span className="text-[12.5px] text-muted">{t("No weekly goals yet. Add them in study plan settings.")}</span>}
    </section>
  );
}

export function GoalForm({ courses, onDone }: { courses: PlanCourse[]; onDone: () => void }) {
  const [n, setN] = useState(3);
  const [kind, setKind] = useState<GoalKind>("lessons");
  const [course, setCourse] = useState("");
  const add = async () => {
    if (!(n > 0)) return;
    const g: Goal = { n, kind, course: kind === "lessons" && course ? course : null };
    await writeLog((l) => setGoals(l, [...l.goals, g]));
    onDone();
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void add(); }} className="flex flex-wrap items-end gap-2 rounded-[10px] bg-surface-2 p-3">
      <label className="flex w-20 flex-col gap-1 text-[12px] text-muted">{t("Number")}
        <input type="number" min={1} max={9999} value={n} onChange={(e) => setN(Number(e.target.value))} className={cx(inputCls, "max-sm:h-11")} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-muted">{t("Of")}
        <select value={kind} onChange={(e) => setKind(e.target.value as GoalKind)} className={cx(inputCls, "w-32 max-sm:h-11")}>
          {KINDS.map((k) => <option key={k} value={k}>{t(KIND_NAME[k])}</option>)}
        </select>
      </label>
      {kind === "lessons" && (
        <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-[12px] text-muted">{t("Course")}
          <select value={course} onChange={(e) => setCourse(e.target.value)} className={cx(inputCls, "max-sm:h-11")}>
            <option value="">{t("Any course")}</option>
            {courses.map((c) => <option key={c.key} value={c.title}>{c.title}</option>)}
          </select>
        </label>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="max-sm:h-11" onClick={onDone}>{t("Cancel")}</Button>
        <Button type="submit" variant="primary" className="max-sm:h-11">{t("Add")}</Button>
      </div>
    </form>
  );
}
