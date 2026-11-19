// Week view: goal vs done minutes per day (done = timer sessions) and editable weekly goals.
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { setGoals, weekSummary, type Goal, type GoalKind, type PlanCourse, type PlanLog, type PlanSettings } from "../lib/plan";
import { writeLog } from "./today-data";
import { Button, cx, inputCls } from "./ui";

const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KINDS: GoalKind[] = ["lessons", "cards", "minutes", "revisions"];

export function WeekPanel({ today, settings, log, sessions, cardsReviewed, courses }: { today: string; settings: PlanSettings; log: PlanLog; sessions: { at: string; minutes: number }[]; cardsReviewed: number; courses: PlanCourse[] }) {
  const w = weekSummary(today, settings, log, sessions, cardsReviewed);
  const max = Math.max(1, ...w.days.map((d) => Math.max(d.goal, d.done)));
  const [adding, setAdding] = useState(false);
  const remove = (g: Goal) => void writeLog((l) => setGoals(l, l.goals.filter((x) => !(x.kind === g.kind && x.n === g.n && x.course === g.course))));
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="This week" className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[14px] font-semibold">This week</span>
          <span className="text-[12px] text-muted tabular-nums">{w.doneMinutes} of {w.goalMinutes} min</span>
        </div>
        <div className="grid grid-cols-7 gap-1.5 sm:gap-3" role="list" aria-label="Goal and done minutes per day">
          {w.days.map((d, i) => (
            <div key={d.date} role="listitem" className="flex flex-col items-center gap-1.5" aria-label={`${WD[i]}: ${d.done} of ${d.goal} minutes`}>
              <div className="relative flex h-[110px] w-full max-w-[40px] items-end justify-center">
                {d.goal > 0 && <span className="absolute inset-x-0 bottom-0 rounded-[6px] border border-dashed border-line" style={{ height: `${(d.goal / max) * 100}%` }} />}
                <span className="relative w-[60%] rounded-t-[4px]" style={{ height: `${(d.done / max) * 100}%`, background: d.done >= d.goal && d.goal > 0 ? "var(--success)" : "var(--accent)" }} />
              </div>
              <span className={cx("text-[11.5px]", d.isToday ? "font-semibold text-ink" : "text-muted")}>{WD[i]}</span>
              <span className="text-[11px] text-muted tabular-nums">{d.done}{d.goal ? `/${d.goal}` : ""}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 text-[11.5px] text-muted">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-[3px] border border-dashed border-line" />Daily goal</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-[3px] bg-accent" />Studied (timer)</span>
        </div>
      </section>

      <section aria-label="Weekly goals" className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <span className="text-[14px] font-semibold">Weekly goals</span>
          {!adding && <Button size="sm" variant="secondary" className="max-sm:h-11" onClick={() => setAdding(true)}><Plus size={13} />Add goal</Button>}
        </div>
        {!w.goals.length && !adding && <span className="text-[13px] text-muted">No goals yet. Add one, like "3 lessons · CS231n" or "150 cards".</span>}
        {w.goals.map((g) => (
          <div key={`${g.goal.kind}:${g.goal.course}:${g.goal.n}`} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-[13px]">
              <span dir="auto" className="min-w-0 flex-1 truncate font-medium">{g.label}</span>
              <span className="text-muted tabular-nums">{g.done} / {g.goal.n}</span>
              <button aria-label={`Remove goal ${g.label}`} onClick={() => remove(g.goal)} className="flex size-11 items-center justify-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-ink sm:size-7"><X size={14} /></button>
            </div>
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full" style={{ width: `${g.pct}%`, background: g.pct >= 100 ? "var(--success)" : "var(--accent)" }} /></span>
          </div>
        ))}
        {adding && <GoalForm courses={courses} onDone={() => setAdding(false)} />}
        <span className="text-[11.5px] text-muted">Lessons and revisions count what you marked done in Today; cards count cards reviewed this week; minutes come from the study timer.</span>
      </section>
    </div>
  );
}

function GoalForm({ courses, onDone }: { courses: PlanCourse[]; onDone: () => void }) {
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
      <label className="flex w-20 flex-col gap-1 text-[12px] text-muted">Number
        <input type="number" min={1} max={9999} value={n} onChange={(e) => setN(Number(e.target.value))} className={cx(inputCls, "max-sm:h-11")} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-muted">Of
        <select value={kind} onChange={(e) => setKind(e.target.value as GoalKind)} className={cx(inputCls, "w-32 max-sm:h-11")}>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      {kind === "lessons" && (
        <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-[12px] text-muted">Course
          <select value={course} onChange={(e) => setCourse(e.target.value)} className={cx(inputCls, "max-sm:h-11")}>
            <option value="">Any course</option>
            {courses.map((c) => <option key={c.key} value={c.title}>{c.title}</option>)}
          </select>
        </label>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="max-sm:h-11" onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" className="max-sm:h-11">Add</Button>
      </div>
    </form>
  );
}
