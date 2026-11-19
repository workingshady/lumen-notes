// Single-value tiles: a number with its delta vs the previous period, and a progress ring.
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { Dataset } from "../../lib/dashboard";
import { fmt, useSize } from "./common";

export function NumberStat({ data }: { data: Extract<Dataset, { kind: "number" }> }) {
  const d = data.prev === null ? null : data.value - data.prev;
  const box = useSize<HTMLDivElement>();
  const big = box.h > 110 ? 44 : box.h > 70 ? 34 : 26;
  return (
    <div ref={box.ref} className="flex h-full min-h-0 flex-col justify-center gap-1">
      <div className="font-semibold leading-none tracking-[-.02em] tabular-nums text-ink" style={{ fontSize: big }}>{fmt(data.value, data.unit)}</div>
      {d !== null && (
        <div className="flex items-center gap-1 text-[12.5px] text-muted" title={`Previous period: ${fmt(data.prev!, data.unit)}`}>
          {d > 0 ? <ArrowUpRight size={14} aria-hidden /> : d < 0 ? <ArrowDownRight size={14} aria-hidden /> : <Minus size={14} aria-hidden />}
          <span className="tabular-nums text-ink">{d > 0 ? "+" : d < 0 ? "−" : ""}{fmt(Math.abs(d), data.unit)}</span>
          <span>{data.vs}</span>
        </div>
      )}
    </div>
  );
}

export function Ring({ data, label, color = "var(--chart-c4)" }: { data: Extract<Dataset, { kind: "ring" }>; label: string; color?: string }) {
  const box = useSize<HTMLDivElement>();
  const share = data.total > 0 ? Math.min(1, data.value / data.total) : 0;
  const size = Math.max(56, Math.min(box.w, box.h - 22, 180));
  const r = size / 2 - 7, c = 2 * Math.PI * r;
  return (
    <div ref={box.ref} className="flex h-full min-h-0 flex-col items-center justify-center gap-1.5">
      {box.w > 0 && (
        <svg width={size} height={size} role="img" aria-label={`${label}: ${fmt(data.value, data.unit)} of ${fmt(data.total, data.unit)} (${Math.round(share * 100)}%)`} tabIndex={0} className="chart-hit">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={10} />
          {share > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" strokeDasharray={`${c * share} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
          <text x={size / 2} y={size / 2} dy="0.35em" textAnchor="middle" className="chart-center">{Math.round(share * 100)}%</text>
        </svg>
      )}
      <div className="text-[12px] text-muted tabular-nums"><span className="text-ink">{fmt(data.value, data.unit)}</span> of {fmt(data.total, data.unit)}</div>
    </div>
  );
}
