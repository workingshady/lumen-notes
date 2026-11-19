// Missed days (TodayDesk.dc.html, missed): "You missed 3 study days. 7 topics are overdue. Spread them over the next
// 2 weeks?" with Not now / Accept new dates and, on desktop, Before / After bars of lessons due per day. "Adjust" (kept
// from round 3) changes the window and lists every move.
import { Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { dayLabel, proposeReschedule, shiftDay, shortDate, type PlanCourse, type PlanSettings } from "../lib/plan";
import { toast } from "../lib/store";
import { Glyph } from "./Glyph";
import { acceptMoves } from "./today-data";

const dismissKey = (d: string) => `lumen.today.rescheduleDismissed.${d}`;

export function MissedBanner({ today, settings, courses, missed }: { today: string; settings: PlanSettings; courses: PlanCourse[]; missed: number }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState<number | null>(null);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(dismissKey(today)) === "1"; } catch { return false; } });
  const base = useMemo(() => proposeReschedule(today, settings, courses, 5), [today, settings, courses]);
  const days = n ?? Math.min(10, Math.max(2, Math.ceil(base.overdue / Math.max(1, settings.maxNew))));
  const r = useMemo(() => proposeReschedule(today, settings, courses, days), [today, settings, courses, days]);
  if (!r.overdue || hidden) return null;
  const span = days >= 10 ? "the next 2 weeks" : `the next ${days} study days`;
  const topics = `${r.overdue} topic${r.overdue === 1 ? " is" : "s are"} overdue.`;
  const dismiss = () => { try { localStorage.setItem(dismissKey(today), "1"); } catch { /* ignore */ } setHidden(true); };
  const accept = async () => {
    await acceptMoves(r.moves);
    toast(`Rescheduled ${r.moves.length} topic${r.moves.length === 1 ? "" : "s"}`);
    setOpen(false);
  };
  // 14 bars: overdue + the next 13 days
  const win = Array.from({ length: 13 }, (_, i) => shiftDay(today, i));
  const before = [r.beforeOverdue, ...win.map((d) => r.before[d] ?? 0)];
  const after = [0, ...win.map((d) => r.after[d] ?? 0)];
  const max = Math.max(1, ...before, ...after);
  const bars = (vals: number[], color: (i: number) => string, label: string) => (
    <div className="flex flex-1 flex-col gap-1.5">
      <span className="text-[11.5px] text-muted">{label}</span>
      <div className="flex h-[70px] items-end gap-1 border-b border-line" role="img" aria-label={`${label}: ${vals.join(", ")} lessons per day`}>
        {vals.map((v, i) => <span key={i} className="flex-1 rounded-t-[3px]" style={{ height: `${(v / max) * 100}%`, background: color(i) }} />)}
      </div>
    </div>
  );
  return (
    <section aria-label="Missed days" className="today-missed mb-3 flex flex-col gap-3 rounded-[12px] px-4 py-3.5" style={{ border: "1px solid color-mix(in srgb, var(--warning) 35%, transparent)", background: "color-mix(in srgb, var(--warning) 8%, var(--surface))" }}>
      <div className="flex flex-wrap items-center gap-2.5">
        <Glyph name="s-revise" size={17} color="var(--warning)" />
        <span className="min-w-[200px] flex-1">{missed > 0 && <b className="font-semibold">You missed {missed} study day{missed === 1 ? "" : "s"}. </b>}{topics} Spread them over {span}?</span>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-muted hover:text-ink">Adjust</button>
        <button onClick={dismiss} className="text-muted hover:text-ink">Not now</button>
        <button onClick={accept} className="flex h-[30px] items-center rounded-[8px] bg-accent px-3 font-semibold text-accent-fg hover:brightness-110">Accept new dates</button>
      </div>
      <div className="hidden items-end gap-6 sm:flex">
        {bars(before, (i) => (i === 0 ? "var(--danger)" : "color-mix(in srgb, var(--text) 30%, transparent)"), "Before")}
        {bars(after, () => "color-mix(in srgb, var(--success) 70%, transparent)", "After")}
        <span className="w-[220px] text-[12px] leading-[17px] text-muted">Dates keep prerequisite order ("after its prerequisite"). Only due dates in roadmaps change.</span>
      </div>
      {open && (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-muted">Spread over</span>
            <div className="flex items-center rounded-[8px] border border-line">
              <button aria-label="Fewer days" disabled={days <= 1} onClick={() => setN(Math.max(1, days - 1))} className="flex size-11 items-center justify-center text-muted hover:text-ink disabled:opacity-30 sm:size-8"><Minus size={14} /></button>
              <span className="min-w-[56px] text-center text-[13px] font-semibold tabular-nums" aria-live="polite">{days} day{days === 1 ? "" : "s"}</span>
              <button aria-label="More days" disabled={days >= 14} onClick={() => setN(Math.min(14, days + 1))} className="flex size-11 items-center justify-center text-muted hover:text-ink disabled:opacity-30 sm:size-8"><Plus size={14} /></button>
            </div>
            <span className="text-[12px] text-muted">study days only</span>
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
        </div>
      )}
    </section>
  );
}
