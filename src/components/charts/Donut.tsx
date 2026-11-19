// Donut: slices with a 2px gap, total in the middle (the hovered / focused slice's exact value and share replace it),
// and a legend with exact values and shares.
import { useRef, useState } from "react";
import type { Dataset } from "../../lib/dashboard";
import { ChartEmpty, fmt, rovingKeys, useSize } from "./common";

type SeriesData = Extract<Dataset, { kind: "series" }>;

function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const p = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)},${(cy - r * Math.cos(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
  return `M${p(r1, a0)}A${r1},${r1} 0 ${large} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0},${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
}

export function DonutChart({ data, colors, label }: { data: SeriesData; colors: string[]; label: string }) {
  const box = useSize<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const refs = useRef<(SVGPathElement | null)[]>([]);
  // slices: categories, summed over series
  const slices = data.categories.map((c, i) => ({ c, v: data.series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0), color: colors[i] })).filter((s) => s.v > 0);
  const total = slices.reduce((a, s) => a + s.v, 0);
  if (!total) return <ChartEmpty />;
  const side = box.w >= 300 && box.w > box.h * 1.3;
  const size = Math.max(60, Math.min(side ? box.h : box.h - 20 * Math.min(4, slices.length), side ? box.w * 0.5 : box.w, 220));
  const r1 = size / 2 - 2, r0 = r1 * 0.62, cxy = size / 2;
  let a = 0;
  const gap = slices.length > 1 ? Math.min(0.04, 2 / Math.max(r1, 1)) : 0;
  const paths = slices.map((s) => { const a0 = a, a1 = a + (s.v / total) * Math.PI * 2; a = a1; return { ...s, d: arc(cxy, cxy, r0, r1, a0 + gap / 2, Math.max(a0 + gap / 2 + 0.001, a1 - gap / 2)), mid: (a0 + a1) / 2 }; });
  const pct = (v: number) => `${Math.round((v / total) * 100)}%`;
  const act = active !== null ? paths[active] : null;
  return (
    <div ref={box.ref} className={side ? "relative flex h-full min-h-0 items-center gap-4" : "relative flex h-full min-h-0 flex-col items-center gap-2"} onMouseLeave={() => setActive(null)}>
      <svg width={size} height={size} role="group" aria-label={label} className="shrink-0 overflow-visible">
        {paths.map((p, i) => (
          <path key={p.c.key} ref={(el) => { refs.current[i] = el; }} d={p.d} fill={p.color} className="chart-hit" opacity={active !== null && active !== i ? 0.5 : 1}
            tabIndex={i === focusIdx ? 0 : -1} role="img" aria-label={`${p.c.long}: ${fmt(p.v, data.unit)} (${pct(p.v)})`}
            onMouseEnter={() => setActive(i)} onFocus={() => { setActive(i); setFocusIdx(i); }} onBlur={() => setActive(null)}
            onKeyDown={(e) => rovingKeys(e, i, paths.length, (j) => { setFocusIdx(j); refs.current[j]?.focus(); })} />
        ))}
        <text x={cxy} y={cxy - 4} textAnchor="middle" className="chart-center">{fmt(act ? act.v : total, data.unit)}</text>
        <text x={cxy} y={cxy + 13} textAnchor="middle" className="chart-axis">{act ? pct(act.v) : "total"}</text>
      </svg>
      <ul className="chart-donut-legend min-w-0" aria-hidden>
        {paths.map((p, i) => (
          <li key={p.c.key} className={active === i ? "is-on" : undefined} onMouseEnter={() => setActive(i)}>
            <span className="chart-swatch" style={{ background: p.color }} />
            <span dir="auto" className="min-w-0 flex-1 truncate capitalize">{p.c.label}</span>
            <span className="tabular-nums text-ink">{fmt(p.v, data.unit)}</span>
            <span className="w-9 text-end tabular-nums">{pct(p.v)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
