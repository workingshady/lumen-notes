// Bar, stacked bar, line and area charts on one set of axes (hand-written SVG).
// Quiet horizontal gridlines, one y axis from zero, thinned x labels, direct labels on line ends (<= 4 series),
// a crosshair column per category that is hoverable and keyboard focusable (arrows move), exact values in a tooltip.
import { useMemo, useRef, useState } from "react";
import { niceTicks, type Dataset } from "../../lib/dashboard";
import { t } from "../../lib/i18n";
import { ChartEmpty, fmt, rovingKeys, textW, Tooltip, useSize, type Tip } from "./common";

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
  // Design (Lumen 18 · chart tiles): no y axis; bars sit on one baseline with 6px gaps and 3px top radius; lines get
  // three quiet gridlines, the first series filled (area), later series dashed. Exact values: tooltip + data table.
  const m = { l: 0, r: 0, t: 6, b: 18 };
  const pw = Math.max(10, W - m.l - m.r), ph = Math.max(10, H - m.t - m.b);
  const band = isLine ? pw / Math.max(1, n - 1) : (pw + 6) / Math.max(1, n);
  const yOf = (v: number) => m.t + ph - (v / top) * ph;
  const cx = (i: number) => (isLine ? m.l + (n === 1 ? pw / 2 : band * i) : m.l + band * i + (band - 6) / 2);
  const hitX = (i: number) => (isLine ? cx(i) - band / 2 : m.l + band * i);
  // x labels: thin so they never collide
  const lw = Math.max(...cats.map((c) => textW(c.label)), 10) + 8;
  const stride = Math.max(1, Math.ceil(lw / Math.max(band, 1)));
  const tipFor = (i: number): Tip => {
    const rows: Tip["rows"] = series.map((s) => ({ color: s.color, label: s.label, value: fmt(s.values[i] ?? 0, data.unit) }));
    if (stacked && series.length > 1) rows.push({ label: t("Total"), value: fmt(series.reduce((a, s) => a + (s.values[i] ?? 0), 0), data.unit) });
    const ys = series.map((s) => yOf(stacked ? 0 : s.values[i] ?? 0));
    return { x: cx(i), y: Math.min(...ys, m.t + ph / 2), title: cats[i].long, rows };
  };
  const focusAt = (i: number) => { setFocusIdx(i); hits.current[i]?.focus(); };

  let marks: React.ReactNode = null;
  if (W > 0 && !empty) {
    if (isLine) {
      marks = series.map((s, si) => {
        const pts = s.values.map((v, i) => [cx(i), yOf(v)] as const);
        const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
        return (
          <g key={s.key}>
            {type === "area" && si === 0 && <path d={`${d}L${pts[pts.length - 1][0]},${yOf(0)}L${pts[0][0]},${yOf(0)}Z`} fill={`color-mix(in srgb, ${s.color} 18%, transparent)`} stroke="none" />}
            <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={si > 0 ? "5 4" : undefined} />
            {active !== null && <circle cx={pts[active][0]} cy={pts[active][1]} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />}
          </g>
        );
      });
    } else {
      const bw = Math.max(2, band - 6);
      const k = series.length;
      marks = cats.map((_, i) => {
        let acc = 0;
        if (stacked || k === 1) {
          const segs = series.map((s) => ({ s, v: Math.max(0, s.values[i] ?? 0) })).filter((x) => x.v > 0);
          return (
            <g key={i} opacity={active !== null && active !== i ? 0.55 : 1}>
              {segs.map(({ s, v }, j) => {
                const y0 = yOf(acc), y1 = yOf(acc + v);
                acc += v;
                const h = Math.max(0, y0 - y1);
                const x = m.l + band * i;
                return j === segs.length - 1 ? <path key={s.key} d={barPath(x, y1, bw, h, 3)} fill={s.color} /> : <rect key={s.key} x={x} y={y1} width={bw} height={h} fill={s.color} />;
              })}
            </g>
          );
        }
        const sw = Math.max(2, (bw - 2 * (k - 1)) / k);
        return (
          <g key={i} opacity={active !== null && active !== i ? 0.55 : 1}>
            {series.map((s, j) => { const v = Math.max(0, s.values[i] ?? 0); const y = yOf(v); return <path key={s.key} d={barPath(m.l + band * i + j * (sw + 2), y, sw, yOf(0) - y, 3)} fill={s.color} />; })}
          </g>
        );
      });
    }
  }
  const legend = series.length > 1 && (
    <div className="chart-legend" role="list">
      {series.map((s, i) => (
        <span key={s.key} role="listitem" className="inline-flex min-w-0 items-center gap-[5px]">
          <span style={{ width: 10, height: isLine ? 2 : 8, borderRadius: isLine ? 0 : 2, background: isLine && i > 0 ? `repeating-linear-gradient(90deg, ${s.color} 0 4px, transparent 4px 6px)` : s.color, flexShrink: 0 }} />
          <span dir="auto" className="truncate">{s.label}</span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div ref={box.ref} className="relative min-h-0 flex-1" dir="ltr" onMouseLeave={() => setActive(null)}>
        {empty ? <ChartEmpty /> : W > 0 && (
          <svg width={W} height={H} role="group" aria-label={label} className="block overflow-visible">
            {isLine
              ? [0.25, 0.57, 0.9].map((f) => <line key={f} x1={m.l} x2={m.l + pw} y1={m.t + ph * f} y2={m.t + ph * f} stroke="var(--border)" />)
              : <line x1={m.l} x2={m.l + pw} y1={yOf(0) + 0.5} y2={yOf(0) + 0.5} stroke="var(--border)" />}
            {cats.map((c, i) => ((n - 1 - i) % stride === 0 ? <text key={c.key} x={isLine ? Math.max(m.l + 12, Math.min(m.l + pw - 12, cx(i))) : cx(i)} y={m.t + ph + 14} textAnchor="middle" className="chart-axis">{c.label}</text> : null))}
            {active !== null && isLine && <line x1={cx(active)} x2={cx(active)} y1={m.t} y2={m.t + ph} stroke="var(--muted)" strokeOpacity={0.5} strokeDasharray="3 3" />}
            {marks}
            {cats.map((c, i) => (
              <rect key={c.key} ref={(el) => { hits.current[i] = el; }} x={hitX(i)} y={m.t} width={band} height={ph} fill="transparent" className="chart-hit"
                tabIndex={i === focusIdx ? 0 : -1} role="img"
                aria-label={`${c.long}: ${series.map((s) => `${s.label} ${fmt(s.values[i] ?? 0, data.unit)}`).join(t(", "))}`}
                onMouseEnter={() => setActive(i)} onFocus={() => { setActive(i); setFocusIdx(i); }} onBlur={() => setActive(null)}
                onKeyDown={(e) => rovingKeys(e, i, n, focusAt)} />
            ))}
          </svg>
        )}
        <Tooltip tip={active !== null && !empty ? tipFor(active) : null} w={W} />
      </div>
      {legend}
    </div>
  );
}
