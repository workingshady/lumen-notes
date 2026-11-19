// Home section "Today": the next few plan items with Start, planned vs goal minutes, and a link to the full plan.
import { ChevronRight } from "lucide-react";
import { useCallback } from "react";
import type { PlanItem, SectionId } from "../lib/plan";
import { go } from "../lib/store";
import { useTodayData } from "./today-data";
import { PlanRow, usePlanHandlers } from "./today-item";
import { cx } from "./ui";

const ORDER: SectionId[] = ["continue", "new", "reviews", "practice"];

export function TodayCard({ className }: { className?: string }) {
  const data = useTodayData();
  const onConcept = useCallback((_it: PlanItem) => go("today"), []);
  const h = usePlanHandlers(onConcept);
  const { plan } = data;
  const all = ORDER.flatMap((s) => plan.sections[s]);
  const open = all.filter((x) => x.state === "todo");
  const goal = plan.budget || data.input.settings.dailyMinutes;
  return (
    <div className={cx("today-card flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4 xl:px-5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <button onClick={() => go("today")} className="flex items-center gap-1 text-[14px] font-semibold hover:text-accent">Today<ChevronRight size={14} className="text-muted" /></button>
        <span className="text-[12px] text-muted tabular-nums">{data.ready ? `${plan.doneMinutes} / ${plan.planned} min · goal ${goal}` : ""}</span>
      </div>
      {data.ready && (plan.noSources ? (
        <span className="text-[13px] text-muted">Add a course roadmap or a learning path and Today plans your day.</span>
      ) : !open.length ? (
        <span className="text-[13px] text-muted">{all.length ? "Everything planned for today is done." : "Nothing due today."}</span>
      ) : (
        <div className="flex flex-col gap-2">
          {open.slice(0, 3).map((it) => <PlanRow key={it.id} it={it} h={h} compact />)}
          {open.length > 3 && <button onClick={() => go("today")} className="h-11 self-start text-[13px] text-muted hover:text-ink sm:h-auto">{open.length - 3} more in the plan</button>}
        </div>
      ))}
    </div>
  );
}
