// One Today plan row: course color, title, minutes, reason, and Start / Done / Skip / Move to tomorrow.
import { ArrowRight, Check, Play, RotateCcw, SkipForward } from "lucide-react";
import { useMemo } from "react";
import type { PlanItem } from "../lib/plan";
import { toast } from "../lib/store";
import { markPlanItem, startPlanItem } from "./today-data";
import { cx } from "./ui";

/** Shared Start / Done / Skip / Move to tomorrow / Undo handlers. Concept items (revision, practice) open a sheet via `onConcept`. */
export function usePlanHandlers(onConcept: (it: PlanItem, mode: "start" | "done") => void): ItemHandlers {
  return useMemo(() => ({
    start: (it) => { if (it.target?.type === "concept") onConcept(it, "start"); else void startPlanItem(it); },
    done: (it) => {
      if (it.kind === "revision") return onConcept(it, "done");
      void markPlanItem(it, "done").then(() => toast(`Done: ${it.title}`, { label: "Undo", run: () => void markPlanItem({ ...it, state: "done" }, null) }));
    },
    skip: (it) => void markPlanItem(it, "skip"),
    later: (it) => void markPlanItem(it, "later").then(() => toast("Moved to tomorrow")),
    undo: (it) => void markPlanItem(it, null),
  }), [onConcept]);
}

export interface ItemHandlers {
  start: (it: PlanItem) => void;
  done: (it: PlanItem) => void;
  skip: (it: PlanItem) => void;
  later: (it: PlanItem) => void;
  undo: (it: PlanItem) => void;
}

const act = "flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[10px] px-2.5 text-[13px] sm:h-8 sm:min-w-8 sm:rounded-[8px] sm:px-2";

export function PlanRow({ it, h, compact }: { it: PlanItem; h: ItemHandlers; compact?: boolean }) {
  const done = it.state === "done";
  const aside = it.state === "skip" || it.state === "later";
  const color = it.course?.color ?? "var(--muted)";
  return (
    <div className={cx("today-row flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3 sm:flex-row sm:items-center sm:gap-3 sm:py-2.5", (done || aside) && "opacity-70")} data-kind={it.kind} data-state={it.state}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span aria-hidden className="mt-[3px] h-[34px] w-1 shrink-0 rounded-full" style={{ background: color }} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span dir="auto" className={cx("truncate text-[14px] font-medium", done && "line-through decoration-muted")}>{it.title}</span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
            {it.course && <span dir="auto" className="truncate" style={{ color }}>{it.course.title}</span>}
            {it.course && <span aria-hidden>·</span>}
            <span className="tabular-nums">{it.minutes} min</span>
            <span aria-hidden>·</span>
            <span dir="auto">{done ? "done" : it.state === "skip" ? "skipped today" : it.state === "later" ? "moved to tomorrow" : it.reason}</span>
          </span>
        </div>
      </div>
      {!compact && (
        <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
          {done || aside ? (
            <button onClick={() => h.undo(it)} className={cx(act, "border border-line text-muted hover:text-ink")} aria-label={`Undo ${it.title}`}><RotateCcw size={14} />Undo</button>
          ) : (
            <>
              <button onClick={() => h.skip(it)} className={cx(act, "text-muted hover:bg-surface-2 hover:text-ink")} aria-label={`Skip ${it.title}`} title="Skip today"><SkipForward size={15} /></button>
              <button onClick={() => h.later(it)} className={cx(act, "text-muted hover:bg-surface-2 hover:text-ink")} aria-label={`Move ${it.title} to tomorrow`} title="Move to tomorrow"><ArrowRight size={15} /></button>
              <button onClick={() => h.done(it)} className={cx(act, "border border-line hover:bg-surface-2")} aria-label={`Mark ${it.title} done`} title="Done"><Check size={15} /></button>
              <button onClick={() => h.start(it)} className={cx(act, "bg-accent px-3 font-semibold text-accent-fg hover:brightness-110")} aria-label={`Start ${it.title}`}><Play size={13} />Start</button>
            </>
          )}
        </div>
      )}
      {compact && !done && !aside && (
        <button onClick={() => h.start(it)} className={cx(act, "shrink-0 self-end border border-line hover:bg-surface-2 sm:self-auto")} aria-label={`Start ${it.title}`}><Play size={13} />Start</button>
      )}
    </div>
  );
}
