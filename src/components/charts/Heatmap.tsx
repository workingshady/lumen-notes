// Study heatmap (Lumen 18 chart tiles): one column per week (Monday on top), one cell per day, filling the tile;
// single-hue scale (empty days stay surface-2, then 35 / 65 / 100 % of the hue). One cell is in the tab order;
// arrows move by day / week; exact values in the tooltip and the data table.
import { useMemo, useRef, useState } from "react";
import type { Dataset } from "../../lib/dashboard";
import { ChartEmpty, fmt, rovingKeys, Tooltip, useSize, type Tip } from "./common";

type SeriesData = Extract<Dataset, { kind: "series" }>;
const STEPS = [0, 35, 65, 100];

export function Heatmap({ data, label, color = "var(--chart-c6)" }: { data: SeriesData; label: string; color?: string }) {
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
  const step = (v: number) => (v <= 0 || max <= 0 ? 0 : Math.min(3, 1 + Math.floor((v / max) * 2.999)));
  const fill = (s: number) => (s === 0 ? "var(--surface-2)" : s === 3 ? color : `color-mix(in srgb, ${color} ${STEPS[s]}%, var(--surface-2))`);
  const gap = 3;
  const cw = Math.max(3, (box.w - gap * (weeks - 1)) / weeks), ch = Math.max(3, (box.h - gap * 6) / 7);
  const pos = (i: number) => { const k = i + lead; return { x: Math.floor(k / 7) * (cw + gap), y: (k % 7) * (ch + gap) }; };
  const fIdx = focusIdx ?? days.length - 1;
  const tip: Tip | null = active !== null ? { x: pos(active).x + cw, y: pos(active).y, title: days[active].c.long, rows: [{ label: data.series[0]?.label ?? "Value", value: fmt(days[active].v, data.unit) }] } : null;
  const total = days.reduce((a, d) => a + d.v, 0);
  return (
    <div ref={box.ref} className="relative h-full min-h-0" dir="ltr" onMouseLeave={() => setActive(null)}>
      {box.w > 0 && (total === 0 ? <ChartEmpty /> : (
        <svg width={box.w} height={box.h} role="grid" aria-label={label} className="block">
          {days.map((d, i) => {
            const p = pos(i);
            return (
              <rect key={d.c.key} ref={(el) => { refs.current[i] = el; }} x={p.x} y={p.y} width={cw} height={ch} rx={2} fill={fill(step(d.v))}
                stroke={active === i ? "var(--text)" : "none"} strokeWidth={1.5} className="chart-hit" role="gridcell"
                tabIndex={i === fIdx ? 0 : -1} aria-label={`${d.c.long}: ${fmt(d.v, data.unit)}`}
                onMouseEnter={() => setActive(i)} onFocus={() => { setActive(i); setFocusIdx(i); }} onBlur={() => setActive(null)}
                onKeyDown={(e) => rovingKeys(e, i, days.length, (j) => { setFocusIdx(j); refs.current[j]?.focus(); }, 7)} />
            );
          })}
        </svg>
      ))}
      <Tooltip tip={tip} w={box.w} />
    </div>
  );
}
