// Settings › Reading › Study plan (Lumen 20, "Settings › Reading › Study plan"): daily minutes slider, study days,
// max new lessons a day, course priority (drag, or Alt+Up/Down), weekly goals (stored in the synced plan log note).
import { useMemo, useState } from "react";
import { planCourses, planSettingsOf, writeLog } from "../components/today-data";
import { GoalForm } from "../components/today-week";
import { cx } from "../components/ui";
import { Glyph } from "../components/Glyph";
import { emptyLog, goalLine, orderedCourses, parseLog, PLAN_LOG_ID, setGoals, type Goal } from "../lib/plan";
import { setSettings, useSettings } from "../lib/settings";
import { useVault } from "../lib/store";

const DAYS = [1, 2, 3, 4, 5, 6, 0];
const DAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function StudyPlanSettings({ embedded }: { embedded?: boolean }) {
  const s = useSettings();
  const p = planSettingsOf(s);
  const v = useVault();
  const courses = useMemo(() => orderedCourses(p, planCourses(v)), [v, p.courseOrder.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const logNote = v.byId.get(PLAN_LOG_ID);
  const goals = useMemo(() => (logNote && !logNote.deleted ? parseLog(logNote.body) : emptyLog()).goals, [logNote]);
  const [drag, setDrag] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const move = (title: string, to: number) => {
    const order = courses.map((c) => c.title).filter((t) => t !== title);
    order.splice(Math.max(0, Math.min(order.length, to)), 0, title);
    setSettings({ planCourseOrder: order });
  };
  const toggleDay = (d: number) => setSettings({ planStudyDays: p.studyDays.includes(d) ? p.studyDays.filter((x) => x !== d) : [...p.studyDays, d].sort() });
  const removeGoal = (g: Goal) => void writeLog((l) => setGoals(l, l.goals.filter((x) => !(x.kind === g.kind && x.n === g.n && x.course === g.course))));
  const pct = ((p.dailyMinutes - 15) / (240 - 15)) * 100;
  return (
    <div className={cx("flex max-w-[640px] flex-col gap-3 text-[13px]", !embedded && "mt-6")}>
      {!embedded && (
        <div>
          <div className="text-[17px] font-[650]">Study plan</div>
          <div className="mt-1 text-muted">Today builds each day from your course roadmaps, learning paths and due reviews. These rules shape it.</div>
        </div>
      )}
      <div className="flex flex-col gap-3.5 rounded-[14px] border border-line bg-bg p-[22px] max-sm:p-4">
        <label className="flex items-center gap-3">
          <span className="flex-1">Daily minutes</span>
          <span className="relative h-4 w-[200px] max-sm:w-[140px]">
            <span className="absolute inset-x-0 top-1.5 h-1 rounded-[2px] bg-surface-2" />
            <span className="absolute left-0 top-1.5 h-1 rounded-[2px] bg-ink" style={{ width: `${pct}%` }} />
            <span className="pointer-events-none absolute top-0 -ml-2 size-4 rounded-full bg-ink" style={{ left: `${pct}%` }} />
            <input type="range" min={15} max={240} step={5} value={Math.min(240, Math.max(15, p.dailyMinutes))} aria-label="Daily minutes" onChange={(e) => setSettings({ planDailyMinutes: Number(e.target.value) })} className="absolute inset-0 m-0 w-full cursor-pointer opacity-0" />
          </span>
          <b className="w-[52px] text-right tabular-nums">{p.dailyMinutes} min</b>
        </label>
        <div className="flex items-center gap-3">
          <span className="flex-1">Study days</span>
          <div className="flex gap-1">
            {DAYS.map((d) => {
              const on = p.studyDays.includes(d);
              return <button key={d} role="switch" aria-checked={on} aria-label={DAY_NAMES[d]} onClick={() => toggleDay(d)} className="flex size-[30px] items-center justify-center rounded-[8px] text-[12px] font-semibold" style={{ background: on ? "var(--accent)" : "var(--surface-2)", color: on ? "var(--accent-fg)" : "var(--muted)" }}>{DAY_LETTER[d]}</button>;
            })}
          </div>
        </div>
        <label className="flex items-center gap-3">
          <span className="flex-1">Max new lessons a day</span>
          <input type="number" min={0} max={10} value={p.maxNew} aria-label="Max new lessons a day" onChange={(e) => setSettings({ planMaxNew: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
            className="h-[30px] w-[52px] rounded-[7px] border border-line bg-transparent px-3 text-ink focus:border-accent focus:outline-none" />
        </label>
        <div className="flex flex-col gap-1.5">
          <span>Course priority · drag to reorder</span>
          {!courses.length && <span className="text-muted">No courses with a roadmap yet.</span>}
          <ol className="flex flex-col gap-1.5">
            {courses.map((c, i) => (
              <li key={c.key} tabIndex={0} draggable aria-label={`${i + 1}. ${c.title}. Alt+Up or Alt+Down to move`}
                onDragStart={(e) => { setDrag(c.title); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDrag(null)}
                onDragOver={(e) => { e.preventDefault(); if (drag && drag !== c.title) move(drag, i); }}
                onKeyDown={(e) => { if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); move(c.title, i + (e.key === "ArrowUp" ? -1 : 1)); requestAnimationFrame(() => (document.querySelector(`[data-plan-course="${CSS.escape(c.key)}"]`) as HTMLElement | null)?.focus()); } }}
                data-plan-course={c.key}
                className={cx("flex h-9 cursor-grab items-center gap-2.5 rounded-[8px] bg-surface px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-accent", drag === c.title && "opacity-60")}>
                <Glyph name="grip" size={14} color="var(--muted)" />
                <span aria-hidden className="h-4 w-1 shrink-0 rounded-[2px]" style={{ background: c.color }} />
                <span dir="auto" className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="text-[12px] text-muted">{c.target ? `target ${c.target}` : "no date"}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex flex-col gap-1.5">
          <span>Weekly goals</span>
          <div className="flex flex-wrap gap-1.5">
            {goals.map((g) => (
              <span key={`${g.kind}:${g.course}:${g.n}`} className="flex h-[30px] items-center gap-1 rounded-[7px] bg-surface-2 pl-2.5 pr-1">
                {goalLine(g).replace(/^- /, "")}
                <button aria-label={`Remove goal ${goalLine(g).replace(/^- /, "")}`} onClick={() => removeGoal(g)} className="flex size-6 items-center justify-center rounded-[5px] text-muted hover:text-ink"><Glyph name="x" size={12} /></button>
              </span>
            ))}
            {!adding && <button onClick={() => setAdding(true)} className="flex h-[30px] items-center rounded-[7px] border border-dashed border-line px-2.5 text-muted hover:text-ink">+ Goal</button>}
          </div>
          {adding && <GoalForm courses={courses} onDone={() => setAdding(false)} />}
        </div>
      </div>
    </div>
  );
}
