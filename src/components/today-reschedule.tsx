// Missed days: "You missed 2 days. Spread 6 lessons over the next 5 days?" with a before/after of the rescheduled days.
import { CalendarClock, Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { dayLabel, proposeReschedule, shortDate, type PlanCourse, type PlanSettings } from "../lib/plan";
import { toast } from "../lib/store";
import { acceptMoves } from "./today-data";
import { Button, cx } from "./ui";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dismissKey = (d: string) => `lumen.today.rescheduleDismissed.${d}`;

export function MissedBanner({ today, settings, courses, missed }: { today: string; settings: PlanSettings; courses: PlanCourse[]; missed: number }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState<number | null>(null);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(dismissKey(today)) === "1"; } catch { return false; } });
  const base = useMemo(() => proposeReschedule(today, settings, courses, 5), [today, settings, courses]);
  const days = n ?? Math.min(7, Math.max(2, Math.ceil(base.overdue / Math.max(1, settings.maxNew))));
  const r = useMemo(() => proposeReschedule(today, settings, courses, days), [today, settings, courses, days]);
  if (!r.overdue || hidden) return null;
  const lessons = `${r.overdue} lesson${r.overdue === 1 ? "" : "s"}`;
  const head = missed > 0 ? `You missed ${missed} day${missed === 1 ? "" : "s"}. Spread ${lessons} over the next ${days} days?` : `${lessons} ${r.overdue === 1 ? "is" : "are"} behind ${r.overdue === 1 ? "its date" : "their dates"}. Spread ${r.overdue === 1 ? "it" : "them"} over the next ${days} days?`;
  const max = Math.max(1, r.beforeOverdue, ...r.window.map((d) => Math.max(r.before[d] ?? 0, r.after[d] ?? 0)));
  const dismiss = () => { try { localStorage.setItem(dismissKey(today), "1"); } catch { /* ignore */ } setHidden(true); };
  const accept = async () => {
    await acceptMoves(r.moves);
    toast(`Rescheduled ${r.moves.length} lesson${r.moves.length === 1 ? "" : "s"}`);
    setOpen(false);
  };
  const bar = (v: number, tone: string) => (
    <div className="flex h-[52px] w-full items-end justify-center">
      <span className="w-full max-w-[22px] rounded-t-[4px]" style={{ height: `${v ? Math.max(8, (v / max) * 100) : 0}%`, background: tone }} />
    </div>
  );
  return (
    <section aria-label="Missed days" className="today-missed flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4" style={{ borderColor: "color-mix(in srgb, var(--warning) 40%, var(--border))" }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <CalendarClock size={18} className="mt-0.5 shrink-0" style={{ color: "var(--warning)" }} />
          <span className="text-[14px] font-medium">{head}</span>
        </div>
        <div className="flex shrink-0 gap-2 self-end sm:self-auto">
          <Button variant="ghost" className="max-sm:h-11" onClick={dismiss}>Not now</Button>
          {!open && <Button variant="secondary" className="max-sm:h-11" onClick={() => setOpen(true)}>Adjust</Button>}
          <Button variant="primary" className="max-sm:h-11" onClick={accept}>Accept</Button>
        </div>
      </div>
      {open && (
        <div className="flex flex-col gap-4 border-t border-line pt-3">
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-muted">Spread over</span>
            <div className="flex items-center rounded-[10px] border border-line">
              <button aria-label="Fewer days" disabled={days <= 1} onClick={() => setN(Math.max(1, days - 1))} className="flex size-11 items-center justify-center text-muted hover:text-ink disabled:opacity-30 sm:size-8"><Minus size={14} /></button>
              <span className="min-w-[56px] text-center text-[13px] font-semibold tabular-nums" aria-live="polite">{days} day{days === 1 ? "" : "s"}</span>
              <button aria-label="More days" disabled={days >= 14} onClick={() => setN(Math.min(14, days + 1))} className="flex size-11 items-center justify-center text-muted hover:text-ink disabled:opacity-30 sm:size-8"><Plus size={14} /></button>
            </div>
            <span className="text-[12px] text-muted">study days only</span>
          </div>
          {/* before / after: lessons due per day */}
          <div className="overflow-x-auto">
            <div className="grid min-w-max gap-x-1.5 gap-y-1 text-center text-[11px] text-muted" style={{ gridTemplateColumns: `64px 44px repeat(${r.window.length}, minmax(34px, 1fr))` }}>
              <span />
              <span>Overdue</span>
              {r.window.map((d) => <span key={d} className={cx(r.days.includes(d) ? "text-ink" : "")}>{d === today ? "Today" : WD[new Date(d + "T00:00:00Z").getUTCDay()]}</span>)}
              <span className="self-end pb-1 text-left">Before</span>
              <div className="flex flex-col items-center">{bar(r.beforeOverdue, "var(--danger)")}<span className="tabular-nums">{r.beforeOverdue || ""}</span></div>
              {r.window.map((d) => <div key={d} className="flex flex-col items-center">{bar(r.before[d] ?? 0, "color-mix(in srgb, var(--muted) 60%, transparent)")}<span className="tabular-nums">{r.before[d] || ""}</span></div>)}
              <span className="self-end pb-1 text-left">After</span>
              <div className="flex flex-col items-center">{bar(0, "transparent")}<span>0</span></div>
              {r.window.map((d) => <div key={d} className="flex flex-col items-center">{bar(r.after[d] ?? 0, "var(--accent)")}<span className="tabular-nums">{r.after[d] || ""}</span></div>)}
            </div>
          </div>
          <ul className="flex flex-col gap-1 text-[13px]">
            {r.moves.map((m) => (
              <li key={`${m.courseKey}:${m.line}`} className="flex flex-wrap items-center gap-x-2">
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: m.color }} />
                <span dir="auto" className="font-medium">{m.topic}</span>
                <span dir="auto" className="text-muted">{m.courseTitle}</span>
                <span className="text-muted tabular-nums">{m.from ? shortDate(m.from) : "no date"} → {shortDate(m.to)} ({dayLabel(today, m.to)})</span>
                {m.why !== "overdue" && <span className="text-[12px] text-muted">after its prerequisite</span>}
              </li>
            ))}
          </ul>
          <span className="text-[12px] text-muted">Accept writes the new dates into each course roadmap.</span>
        </div>
      )}
    </section>
  );
}
