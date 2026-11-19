// Donut (Lumen 18 chart tiles): a ring with the total in the middle (the hovered / focused slice's value and share
// replace it), and a legend: swatch, name, value. Slices are keyboard focusable (arrows move).
import { useRef, useState } from "react";
import type { Dataset } from "../../lib/dashboard";
import { ChartEmpty, fmt, rovingKeys, useSize } from "./common";

type SeriesData = Extract<Dataset, { kind: "series" }>;

function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const p = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)},${(cy - r * Math.cos(a)).toFixed(2)}`;
  if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r1, a0)}A${r1},${r1} 0 ${large} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0},${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
}

export function DonutChart({ data, colors, label }: { data: SeriesData; colors: string[]; label: string }) {
  const box = useSize<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const refs = useRef<(SVGPathElement | null)[]>([]);
  const slices = data.categories.map((c, i) => ({ c, v: data.series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0), color: colors[i] })).filter((s) => s.v > 0);
  const total = slices.reduce((a, s) => a + s.v, 0);
  if (!total) return <ChartEmpty />;
  const side = box.w >= 220;
  const size = Math.max(80, Math.min(side ? box.h : box.h - 18 * Math.min(5, slices.length), side ? box.w * 0.5 : box.w, 150));
  const r1 = size / 2, r0 = r1 * (70 / 110), cxy = size / 2;
  let a = 0;
  const paths = slices.map((s) => { const a0 = a, a1 = a + (s.v / total) * Math.PI * 2; a = a1; return { ...s, d: arc(cxy, cxy, r0, r1, a0, Math.max(a0 + 0.001, a1)) }; });
  const pct = (v: number) => `${Math.round((v / total) * 100)}%`;
  const act = active !== null ? paths[active] : null;
  return (
    <div ref={box.ref} className={side ? "relative flex h-full min-h-0 items-center gap-4" : "relative flex h-full min-h-0 flex-col items-center gap-2"} onMouseLeave={() => setActive(null)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} role="group" aria-label={label} className="block overflow-visible">
          {paths.map((p, i) => (
            <path key={p.c.key} ref={(el) => { refs.current[i] = el; }} d={p.d} fill={p.color} className="chart-hit" opacity={active !== null && active !== i ? 0.5 : 1}
              tabIndex={i === focusIdx ? 0 : -1} role="img" aria-label={`${p.c.long}: ${fmt(p.v, data.unit)} (${pct(p.v)})`}
              onMouseEnter={() => setActive(i)} onFocus={() => { setActive(i); setFocusIdx(i); }} onBlur={() => setActive(null)}
              onKeyDown={(e) => rovingKeys(e, i, paths.length, (j) => { setFocusIdx(j); refs.current[j]?.focus(); })} />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <b className="text-[17px] font-bold leading-[21px] tabular-nums">{fmt(act ? act.v : total, data.unit)}</b>
          <span className="max-w-[64px] truncate text-[10.5px] text-muted">{act ? pct(act.v) : data.unit === "min" ? "studied" : "total"}</span>
        </div>
      </div>
      <ul className="chart-donut-legend min-w-0" aria-hidden>
        {paths.map((p, i) => (
          <li key={p.c.key} className={active === i ? "is-on" : undefined} onMouseEnter={() => setActive(i)}>
            <span className="chart-swatch" style={{ background: p.color }} />
            <span dir="auto" className="min-w-0 truncate text-ink">{legendLabel(p.c.label)}</span>
            <span className="shrink-0 tabular-nums">{fmt(p.v, data.unit)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Status / card-state values read as words in the legend ("Todo", "Mastered"); names (fast.ai, CS231n) stay as written. */
const ENUM = /^(locked|todo|learning|learned|review|mastered|new|relearning|suspended|none|done|open)$/;
const legendLabel = (l: string) => (ENUM.test(l) ? l[0].toUpperCase() + l.slice(1) : l);
