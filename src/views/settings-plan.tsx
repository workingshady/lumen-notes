// Settings › Reading › Study plan: daily minutes, study days, max new lessons a day, course priority (drag or Alt+↑/↓).
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { useMemo, useState } from "react";
import { planCourses, planSettingsOf } from "../components/today-data";
import { cx, inputCls, Segmented } from "../components/ui";
import { orderedCourses } from "../lib/plan";
import { setSettings, useSettings } from "../lib/settings";
import { useVault } from "../lib/store";

const DAYS = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MINUTES = ["30", "45", "60", "90", "120"] as const;

export function StudyPlanSettings({ embedded }: { embedded?: boolean }) {
  const s = useSettings();
  const p = planSettingsOf(s);
  const v = useVault();
  const courses = useMemo(() => orderedCourses(p, planCourses(v)), [v, p.courseOrder.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const [drag, setDrag] = useState<string | null>(null);
  const move = (title: string, to: number) => {
    const order = courses.map((c) => c.title).filter((t) => t !== title);
    order.splice(Math.max(0, Math.min(order.length, to)), 0, title);
    setSettings({ planCourseOrder: order });
  };
  const toggleDay = (d: number) => setSettings({ planStudyDays: p.studyDays.includes(d) ? p.studyDays.filter((x) => x !== d) : [...p.studyDays, d].sort() });
  return (
    <div className={cx("flex max-w-[640px] flex-col gap-3", !embedded && "mt-6")}>
      {!embedded && (
        <div>
          <div className="text-[17px] font-[650]">Study plan</div>
          <div className="mt-1 text-[13px] text-muted">Today builds each day from your course roadmaps, learning paths and due reviews. These rules shape it. Saved on this device.</div>
        </div>
      )}
      <div className="flex flex-col gap-4 rounded-[12px] border border-line bg-surface p-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Daily study time · {p.dailyMinutes} min</span>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={(MINUTES as readonly string[]).includes(String(p.dailyMinutes)) ? (String(p.dailyMinutes) as (typeof MINUTES)[number]) : ("" as (typeof MINUTES)[number])} onChange={(x) => setSettings({ planDailyMinutes: Number(x) })} options={MINUTES.map((m) => ({ value: m, label: `${m}` }))} />
            <label className="flex items-center gap-1.5 text-[12.5px] text-muted">Custom
              <input type="number" min={5} max={720} aria-label="Daily study minutes" value={p.dailyMinutes} onChange={(e) => setSettings({ planDailyMinutes: Math.max(5, Math.min(720, Number(e.target.value) || 5)) })} className={cx(inputCls, "w-20 max-sm:h-11")} />min
            </label>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Study days</span>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d) => {
              const on = p.studyDays.includes(d);
              return <button key={d} role="switch" aria-checked={on} onClick={() => toggleDay(d)} className={cx("h-11 min-w-11 rounded-[10px] border px-2 text-[13px] sm:h-8 sm:min-w-[44px]", on ? "border-accent bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] font-semibold text-ink" : "border-line text-muted hover:text-ink")}>{DAY_NAMES[d]}</button>;
            })}
          </div>
          <span className="text-[12px] text-muted">On other days Today shows only reviews.</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">New lessons per day, at most</span>
          <Segmented value={String(p.maxNew)} onChange={(x) => setSettings({ planMaxNew: Number(x) })} options={["1", "2", "3", "4", "5"].map((x) => ({ value: x, label: x }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Course priority</span>
          <span className="text-[12px] text-muted">When dates tie, higher courses come first. Drag to reorder, or focus a row and press Alt+Up / Alt+Down.</span>
          {!courses.length && <span className="text-[13px] text-muted">No courses with a roadmap yet.</span>}
          <ol className="flex flex-col">
            {courses.map((c, i) => (
              <li key={c.key} tabIndex={0} draggable aria-label={`${i + 1}. ${c.title}`}
                onDragStart={(e) => { setDrag(c.title); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDrag(null)}
                onDragOver={(e) => { e.preventDefault(); if (drag && drag !== c.title) move(drag, i); }}
                onKeyDown={(e) => { if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); move(c.title, i + (e.key === "ArrowUp" ? -1 : 1)); requestAnimationFrame(() => (document.querySelector(`[data-plan-course="${CSS.escape(c.key)}"]`) as HTMLElement | null)?.focus()); } }}
                data-plan-course={c.key}
                className={cx("flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-accent", drag === c.title ? "bg-surface-2 opacity-70" : "hover:bg-surface-2")}>
                <GripVertical size={16} className="shrink-0 cursor-grab text-muted" />
                <span className="w-5 text-[12px] text-muted tabular-nums">{i + 1}</span>
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                <span dir="auto" className="min-w-0 flex-1 truncate text-[13.5px]">{c.title}</span>
                {c.target && <span className="hidden text-[12px] text-muted sm:inline">target {c.target}</span>}
                <button aria-label={`Move ${c.title} up`} disabled={i === 0} onClick={() => move(c.title, i - 1)} className="flex size-11 items-center justify-center rounded-[6px] text-muted hover:bg-surface hover:text-ink disabled:opacity-30 sm:size-7"><ArrowUp size={14} /></button>
                <button aria-label={`Move ${c.title} down`} disabled={i === courses.length - 1} onClick={() => move(c.title, i + 1)} className="flex size-11 items-center justify-center rounded-[6px] text-muted hover:bg-surface hover:text-ink disabled:opacity-30 sm:size-7"><ArrowDown size={14} /></button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
