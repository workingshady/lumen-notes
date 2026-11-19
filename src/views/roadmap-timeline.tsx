// Course roadmap · Timeline (design round 4: RoadmapDesk "timeline", Lumen 15 R4-15F).
// One lane per module, a bar per dated topic (left edge = due date). Drag a bar sideways to reschedule: a ghost stays at
// the old date and a tooltip shows the new one ("Due Tue 2 Dec · was 25 Nov"); release writes the due date.
import { useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { progress, type Module, type Topic } from "../lib/parse";
import { cx } from "../components/ui";
import { StatusGlyph } from "./roadmap-parts";
import { overdue } from "./roadmap-outline";
import { DAY, fmtDay, fmtLong, isoDay, todayIso } from "./spaces-util";

const LANE = 180;

export function Timeline({ mods, target, onSelect, onDue, fresh }: { mods: Module[]; target?: string | null; onSelect: (t: Topic) => void; onDue: (t: Topic, due: string) => void; fresh: Set<string> }) {
  const lanes = mods.map((m) => ({ m, items: m.topics.filter((t) => t.status !== "skipped" && t.due).sort((a, b) => a.due!.localeCompare(b.due!)) }));
  const dates = lanes.flatMap((l) => l.items.map((t) => Date.parse(t.due! + "T00:00:00")));
  const now = Date.parse(todayIso() + "T00:00:00");
  const tgt = target ? Date.parse(target + "T00:00:00") : NaN;
  // Freeze the scale while dragging so the bar follows the pointer.
  const frozen = useRef<{ lo: number; hi: number; weeks: number } | null>(null);
  let scale = frozen.current;
  if (!scale) {
    const lo0 = Math.min(now, ...dates);
    const lo = lo0 - ((new Date(lo0).getDay() + 6) % 7) * DAY; // snap to Monday
    const hiRaw = Math.max(now + 14 * DAY, ...dates, ...(isNaN(tgt) ? [] : [tgt])) + 6 * DAY;
    const weeks = Math.max(4, Math.ceil((hiRaw - lo) / (7 * DAY)));
    scale = { lo, hi: lo + weeks * 7 * DAY, weeks };
  }
  const { lo, hi, weeks } = scale;
  const frac = (t: number) => (t - lo) / (hi - lo);
  const area = useRef<HTMLDivElement>(null);
  const [laneW, setLaneW] = useState(1000);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLaneW(el.clientWidth - LANE));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="flex min-h-full min-w-[760px] flex-col px-4 py-4 md:px-8">
      {!dates.length && <p className="mb-3 text-[13px] text-muted">Give topics a due date (topic sheet → Due, or <code>due:2026-12-01</code> in the Markdown) to place them here.</p>}
      <div className="grid h-[30px] shrink-0 items-center border-b border-line text-[12px] text-muted" style={{ gridTemplateColumns: `${LANE}px 1fr` }}>
        <span>Module</span>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}>{Array.from({ length: weeks }, (_, i) => <span key={i}>{fmtDay(lo + i * 7 * DAY)}</span>)}</div>
      </div>
      <div ref={area} className="relative flex-1">
        <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: LANE }}>
          <div className="absolute inset-y-0 w-0.5 bg-accent" style={{ left: `${frac(now) * 100}%` }} title="Today" />
          {!isNaN(tgt) && <div className="absolute inset-y-0 border-l-[1.5px] border-dashed border-muted opacity-60" style={{ left: `${frac(tgt) * 100}%` }}><span className="absolute left-1.5 top-1 whitespace-nowrap text-[11px] text-muted">Target · {fmtDay(target!)}</span></div>}
        </div>
        {lanes.map(({ m, items }, i) => {
          const p = progress([m]);
          // Rows 38 px apart (14, 52, …): a bar goes to the first row where it doesn't overlap.
          const ends: number[] = [];
          const placed = items.map((t) => {
            const w = 40 + t.name.length * 6.6;
            const left = Math.max(0, Math.min(frac(Date.parse(t.due! + "T00:00:00")) * laneW, laneW - w));
            let row = ends.findIndex((e) => left >= e + 6);
            if (row < 0) { row = ends.length; ends.push(0); }
            ends[row] = left + w;
            return { t, left, row };
          });
          return (
            <div key={i} className="grid border-b border-line" style={{ gridTemplateColumns: `${LANE}px 1fr`, minHeight: Math.max(96, 14 + ends.length * 38 + 16) }}>
              <div className="flex flex-col gap-1 py-3.5 pr-3"><span className="truncate font-semibold" dir="auto">{m.name}</span><span className="text-[12px] text-muted">{p.total && p.done === p.total ? `${p.done}/${p.total} done` : `${p.done}/${p.total}`}</span></div>
              <div className="relative">
                {placed.map((x) => <TimelineBar key={x.t.line} t={x.t} left={x.left} top={14 + x.row * 38} pxPerDay={laneW / ((hi - lo) / DAY)} fresh={fresh.has(x.t.name.toLowerCase())}
                  onSelect={onSelect} onDrop={(due) => onDue(x.t, due)} freeze={(on) => { frozen.current = on ? scale : null; }} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A topic bar: click opens the sheet, horizontal drag moves its date (snaps to days). */
function TimelineBar({ t, left, top, pxPerDay, onSelect, onDrop, freeze, fresh }: { t: Topic; left: number; top: number; pxPerDay: number; onSelect: (t: Topic) => void; onDrop: (due: string) => void; freeze: (on: boolean) => void; fresh: boolean }) {
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const [dx, setDx] = useState(0);
  const days = Math.round(dx / pxPerDay);
  const due = t.due!;
  const shown = days ? isoDay(Date.parse(due + "T00:00:00") + days * DAY) : due;
  const late = overdue(t, shown);
  const done = t.status === "done";
  const down = (e: RPointerEvent) => { if (e.button !== 0) return; drag.current = { x: e.clientX, moved: false }; try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } freeze(true); };
  const move = (e: RPointerEvent) => { const d = drag.current; if (!d) return; const x = e.clientX - d.x; if (Math.abs(x) > 3) d.moved = true; if (d.moved) setDx(x); };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    freeze(false);
    if (!d) return;
    if (!d.moved) { onSelect(t); return; }
    setDx(0);
    if (days) onDrop(shown);
  };
  const base = cx("absolute flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2 text-[12px] font-medium");
  const fill = done ? "color-mix(in srgb, var(--success) 14%, var(--surface))" : "var(--surface)";
  return (
    <>
      {dx !== 0 && (
        <div aria-hidden className={base} style={{ left, top, background: fill, border: "1px solid var(--border)", opacity: 0.35 }}><StatusGlyph t={t} size={14} />{t.name}</div>
      )}
      <button onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setDx(0); freeze(false); }}
        title={`${t.name} · due ${fmtLong(due)}. Click to open · drag sideways to change the date`} data-bar={t.name}
        className={cx(base, "touch-none select-none", dx ? "z-20 cursor-grabbing" : "cursor-grab hover:brightness-110", fresh && "rm-unlock")}
        style={{ left: left + dx, top: dx ? top + 6 : top, background: fill, border: dx ? "1.5px solid var(--accent)" : `1px solid ${late ? "var(--danger)" : "var(--border)"}`, boxShadow: dx ? "0 12px 28px rgba(0,0,0,.45)" : undefined }}>
        <StatusGlyph t={t} size={14} />{t.name}
      </button>
      {dx !== 0 && (
        <div role="status" className="pointer-events-none absolute z-30 whitespace-nowrap rounded-[8px] border border-line bg-surface-2 px-2.5 py-1.5 text-[12px]"
          style={{ left: left + dx, top: top - 40, boxShadow: "0 10px 24px rgba(0,0,0,.4)" }}>
          Due <b className="font-semibold">{fmtLong(shown)}</b> · was {fmtDay(due)}
        </div>
      )}
    </>
  );
}
