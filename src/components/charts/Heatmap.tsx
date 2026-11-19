// Study heatmap: one column per week (Monday on top), one cell per day, a single-hue sequential scale (5 steps,
// empty days stay surface-2). One cell is in the tab order; arrows move by day / week.
import { useMemo, useRef, useState } from "react";
import type { Dataset } from "../../lib/dashboard";
import { ChartEmpty, fmt, rovingKeys, Tooltip, useSize, type Tip } from "./common";

type SeriesData = Extract<Dataset, { kind: "series" }>;
const STEPS = [0, 25, 45, 70, 100]; // % of the hue mixed into surface-2

export function Heatmap({ data, label, color = "var(--chart-c5)" }: { data: SeriesData; label: string; color?: string }) {
  const box = useSize<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const refs = useRef<(SVGRectElement | null)[]>([]);
  const days = useMemo(() => data.categories.map((c, i) => ({ c, v: data.series.reduce((a, s) => a + (s.values[i] ?? 0), 0) })), [data]);
  if (!days.length || !data.categories[0].start) return <ChartEmpty />;
  const first = new Date(data.categories[0].start);
  const lead = (first.getDay() + 6) % 7;
  const weeks = Math.ceil((lead + days.length) / 7);
  const max = Math.max(...days.map((d) => d.v), 0);
  // quantile-free scale: steps of the max (exact values are in the tooltip and the data table)
  const step = (v: number) => (v <= 0 ? 0 : max <= 0 ? 0 : Math.min(4, 1 + Math.floor((v / max) * 3.999)));
  const fill = (s: number) => (s === 0 ? "var(--surface-2)" : `color-mix(in srgb, ${color} ${STEPS[s]}%, var(--surface-2))`);
  const left = 26, topPad = 14, legendH = 18;
  const cell = Math.max(6, Math.min(18, Math.floor((box.w - left) / weeks) - 2, Math.floor((box.h - topPad - legendH) / 7) - 2));
  const g = cell + 2;
  const pos = (i: number) => { const k = i + lead; return { x: left + Math.floor(k / 7) * g, y: topPad + (k % 7) * g }; };
  const months: { x: number; l: string }[] = [];
  days.forEach((d, i) => { const dt = new Date(d.c.start!); if (dt.getDate() <= 7 && (i + lead) % 7 === 0 || i === 0) { const l = dt.toLocaleDateString("en-GB", { month: "short" }); if (!months.length || months[months.length - 1].l !== l) months.push({ x: pos(i).x, l }); } });
  const fIdx = focusIdx ?? days.length - 1;
  const tip: Tip | null = active !== null ? { x: pos(active).x + cell, y: pos(active).y, title: days[active].c.long, rows: [{ label: data.series[0]?.label ?? "Value", value: fmt(days[active].v, data.unit) }] } : null;
  const total = days.reduce((a, d) => a + d.v, 0);
  return (
    <div ref={box.ref} className="relative h-full min-h-0" dir="ltr" onMouseLeave={() => setActive(null)}>
      {box.w > 0 && (total === 0 ? <ChartEmpty /> : (
        <svg width={box.w} height={topPad + 7 * g + legendH} role="grid" aria-label={label} className="block">
          {months.map((m, i) => (i > 0 && m.x - months[i - 1].x < 28 ? null : <text key={i} x={m.x} y={10} className="chart-axis">{m.l}</text>))}
          {["Mon", "", "Wed", "", "Fri", "", ""].map((d, i) => d && <text key={i} x={0} y={topPad + i * g + cell / 2} dy="0.32em" className="chart-axis">{d}</text>)}
          {days.map((d, i) => {
            const p = pos(i);
            return (
              <rect key={d.c.key} ref={(el) => { refs.current[i] = el; }} x={p.x} y={p.y} width={cell} height={cell} rx={Math.min(3, cell / 4)} fill={fill(step(d.v))}
                stroke={active === i ? "var(--text)" : "none"} strokeWidth={1.5} className="chart-hit" role="gridcell"
                tabIndex={i === fIdx ? 0 : -1} aria-label={`${d.c.long}: ${fmt(d.v, data.unit)}`}
                onMouseEnter={() => setActive(i)} onFocus={() => { setActive(i); setFocusIdx(i); }} onBlur={() => setActive(null)}
                onKeyDown={(e) => rovingKeys(e, i, days.length, (j) => { setFocusIdx(j); refs.current[j]?.focus(); }, 7)} />
            );
          })}
          <g transform={`translate(${left},${topPad + 7 * g + 5})`}>
            <text x={0} y={7} dy="0.32em" className="chart-axis">Less</text>
            {[0, 1, 2, 3, 4].map((s) => <rect key={s} x={30 + s * 13} y={2} width={10} height={10} rx={2} fill={fill(s)} />)}
            <text x={30 + 5 * 13 + 2} y={7} dy="0.32em" className="chart-axis">More</text>
          </g>
        </svg>
      ))}
      <Tooltip tip={tip} w={box.w} />
    </div>
  );
}
