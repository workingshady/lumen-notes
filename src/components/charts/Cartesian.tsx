// Bar, stacked bar, line and area charts on one set of axes (hand-written SVG).
// Quiet horizontal gridlines, one y axis from zero, thinned x labels, direct labels on line ends (<= 4 series),
// a crosshair column per category that is hoverable and keyboard focusable (arrows move), exact values in a tooltip.
import { useMemo, useRef, useState } from "react";
import { niceTicks, type Dataset } from "../../lib/dashboard";
import { ChartEmpty, fmt, Legend, rovingKeys, short, textW, Tooltip, useSize, type Tip } from "./common";

type SeriesData = Extract<Dataset, { kind: "series" }>;
export type CartesianType = "bar" | "stackedBar" | "line" | "area";

/** Rounded-top rectangle (4px data end, square at the baseline). */
function barPath(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0 || w <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function CartesianChart({ data, type, label }: { data: SeriesData; type: CartesianType; label: string }) {
  const box = useSize<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const hits = useRef<(SVGRectElement | null)[]>([]);
  const { categories: cats, series } = data;
  const n = cats.length;
  const stacked = type === "stackedBar";
  const isLine = type === "line" || type === "area";
  const max = useMemo(() => {
    let m = 0;
    for (let i = 0; i < n; i++) {
      if (stacked) m = Math.max(m, series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0));
      else for (const s of series) m = Math.max(m, s.values[i] ?? 0);
    }
    return m;
  }, [series, n, stacked]);
  const W = box.w, H = box.h;
  const empty = !n || data.total === 0 && !series.some((s) => s.values.some((v) => v !== 0));
  const ticks = niceTicks(max || 1, H < 150 ? 2 : 4, series.every((s) => s.values.every((v) => Number.isInteger(v))));
  const top = ticks[ticks.length - 1] || 1;
  const directLabels = isLine && series.length > 1 && series.length <= 4 && W > 360;
  const m = { l: Math.max(...ticks.map((t) => textW(short(t)))) + 10, r: directLabels ? Math.min(96, Math.max(...series.map((s) => textW(s.label))) + 14) : 10, t: 8, b: 20 };
  const pw = Math.max(10, W - m.l - m.r), ph = Math.max(10, H - m.t - m.b);
  const band = pw / Math.max(1, n);
  const yOf = (v: number) => m.t + ph - (v / top) * ph;
  const cx = (i: number) => m.l + band * i + band / 2;
  // x labels: thin so they never collide
  const lw = Math.max(...cats.map((c) => textW(c.label)), 10) + 8;
  const stride = Math.max(1, Math.ceil(lw / band));
  const tipFor = (i: number): Tip => {
    const rows: Tip["rows"] = series.map((s) => ({ color: s.color, label: s.label, value: fmt(s.values[i] ?? 0, data.unit) }));
    if (stacked && series.length > 1) rows.push({ label: "Total", value: fmt(series.reduce((a, s) => a + (s.values[i] ?? 0), 0), data.unit) });
    const ys = series.map((s) => yOf(stacked ? 0 : s.values[i] ?? 0));
    return { x: cx(i), y: Math.min(...ys, m.t + ph / 2), title: cats[i].long, rows };
  };
  const focusAt = (i: number) => { setFocusIdx(i); hits.current[i]?.focus(); };

  let marks: React.ReactNode = null;
  if (W > 0 && !empty) {
    if (isLine) {
      marks = series.map((s) => {
        const pts = s.values.map((v, i) => [cx(i), yOf(v)] as const);
        const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
        return (
          <g key={s.key}>
            {type === "area" && <path d={`${d}L${pts[pts.length - 1][0]},${yOf(0)}L${pts[0][0]},${yOf(0)}Z`} fill={s.color} fillOpacity={series.length > 1 ? 0.12 : 0.18} stroke="none" />}
            <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {n <= 16 && pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.5} fill={s.color} />)}
            {active !== null && <circle cx={pts[active][0]} cy={pts[active][1]} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />}
          </g>
        );
      });
    } else if (stacked) {
      const bw = Math.max(2, Math.min(band * 0.7, 40));
      marks = cats.map((_, i) => {
        let acc = 0;
        const segs = series.map((s) => ({ s, v: Math.max(0, s.values[i] ?? 0) })).filter((x) => x.v > 0);
        return (
          <g key={i} opacity={active !== null && active !== i ? 0.55 : 1}>
            {segs.map(({ s, v }, j) => {
              const y0 = yOf(acc), y1 = yOf(acc + v);
              acc += v;
              const gap = j > 0 ? 2 : 0; // 2px surface gap between stacked fills
              const h = Math.max(0, y0 - y1 - gap);
              return j === segs.length - 1
                ? <path key={s.key} d={barPath(cx(i) - bw / 2, y1, bw, h)} fill={s.color} />
                : <rect key={s.key} x={cx(i) - bw / 2} y={y1} width={bw} height={h} fill={s.color} />;
            })}
          </g>
        );
      });
    } else {
      const k = series.length;
      const gw = Math.min(band * 0.75, 44 * k);
      const bw = Math.max(2, (gw - 2 * (k - 1)) / k);
      marks = cats.map((_, i) => (
        <g key={i} opacity={active !== null && active !== i ? 0.55 : 1}>
          {series.map((s, j) => { const v = Math.max(0, s.values[i] ?? 0); const y = yOf(v); return <path key={s.key} d={barPath(cx(i) - gw / 2 + j * (bw + 2), y, bw, yOf(0) - y)} fill={s.color} />; })}
        </g>
      ));
    }
  }
  // direct labels at the line ends, nudged apart
  let ends: { y: number; label: string; color: string }[] = [];
  if (directLabels && W > 0 && !empty) {
    ends = series.map((s) => ({ y: yOf(s.values[n - 1] ?? 0), label: s.label, color: s.color })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!directLabels && <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />}
      <div ref={box.ref} className="relative min-h-0 flex-1" dir="ltr" onMouseLeave={() => setActive(null)}>
        {empty ? <ChartEmpty /> : W > 0 && (
          <svg width={W} height={H} role="group" aria-label={label} className="block overflow-visible">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={m.l} x2={m.l + pw} y1={yOf(t)} y2={yOf(t)} stroke="var(--border)" strokeOpacity={t === 0 ? 1 : 0.6} />
                <text x={m.l - 6} y={yOf(t)} dy="0.32em" textAnchor="end" className="chart-axis">{short(t)}</text>
              </g>
            ))}
            {cats.map((c, i) => ((n - 1 - i) % stride === 0 ? <text key={c.key} x={cx(i)} y={m.t + ph + 14} textAnchor="middle" className="chart-axis">{c.label}</text> : null))}
            {active !== null && isLine && <line x1={cx(active)} x2={cx(active)} y1={m.t} y2={m.t + ph} stroke="var(--muted)" strokeOpacity={0.5} strokeDasharray="3 3" />}
            {marks}
            {ends.map((e) => <text key={e.label} x={m.l + pw + 6} y={e.y} dy="0.32em" className="chart-direct">{e.label.length > 14 ? e.label.slice(0, 13) + "…" : e.label}</text>)}
            {cats.map((c, i) => (
              <rect key={c.key} ref={(el) => { hits.current[i] = el; }} x={m.l + band * i} y={m.t} width={band} height={ph} fill="transparent" className="chart-hit"
                tabIndex={i === focusIdx ? 0 : -1} role="img"
                aria-label={`${c.long}: ${series.map((s) => `${s.label} ${fmt(s.values[i] ?? 0, data.unit)}`).join(", ")}`}
                onMouseEnter={() => setActive(i)} onFocus={() => { setActive(i); setFocusIdx(i); }} onBlur={() => setActive(null)}
                onKeyDown={(e) => rovingKeys(e, i, n, focusAt)} />
            ))}
          </svg>
        )}
        <Tooltip tip={active !== null && !empty ? tipFor(active) : null} w={W} />
      </div>
    </div>
  );
}
