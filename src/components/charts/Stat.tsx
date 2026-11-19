// Single-value tiles (Lumen 18 chart tiles): a number with its delta vs the previous period (green = better,
// red = worse; "better" is up unless the tile says `better: down`), and a progress ring with the share inside.
import type { Dataset } from "../../lib/dashboard";
import { t } from "../../lib/i18n";
import { fmt, useSize } from "./common";

export function NumberStat({ data }: { data: Extract<Dataset, { kind: "number" }> }) {
  const d = data.prev === null ? null : data.value - data.prev;
  const box = useSize<HTMLDivElement>();
  const big = box.h > 120 ? 44 : 34;
  const good = d === null || d === 0 ? null : (d > 0) === (data.better !== "down");
  const pct = data.pct && data.prev ? Math.round((d! / Math.abs(data.prev)) * 100) : null;
  const sign = (x: number) => (x > 0 ? "+" : x < 0 ? "−" : "±");
  const deltaText = d === null ? "" : pct !== null ? sign(pct) + t("{n}%", { n: Math.abs(pct) }) : `${sign(d)}${fmt(Math.abs(d), data.unit)} ${data.vs ?? ""}`.trim();
  return (
    <div ref={box.ref} className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="whitespace-nowrap font-[650] leading-none tracking-[-.02em] tabular-nums text-ink" style={{ fontSize: big }}>{fmt(data.value, data.unit)}</span>
        {d !== null && <span className="truncate text-[12.5px] font-semibold tabular-nums" style={{ color: good === null ? "var(--muted)" : good ? "var(--success)" : "var(--danger)" }} title={t("Previous period: {value}", { value: fmt(data.prev!, data.unit) })}>{deltaText}</span>}
      </div>
      {data.sub && <span dir="auto" className="truncate text-[12px] text-muted">{data.sub}</span>}
    </div>
  );
}

export function Ring({ data, label, color = "var(--success)" }: { data: Extract<Dataset, { kind: "ring" }>; label: string; color?: string }) {
  const box = useSize<HTMLDivElement>();
  const share = data.total > 0 ? Math.min(1, data.value / data.total) : 0;
  const size = Math.max(64, Math.min(box.w, box.h, 140) || 96);
  const sw = Math.max(8, Math.round(size * 0.094)), r = size / 2 - sw / 2, c = 2 * Math.PI * r;
  return (
    <div ref={box.ref} className="flex h-full min-h-0 items-center justify-center">
      {box.w > 0 && (
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} role="img" aria-label={t("{label}: {value} of {total} ({pct}%)", { label, value: fmt(data.value, data.unit), total: fmt(data.total, data.unit), pct: Math.round(share * 100) })} tabIndex={0} className="chart-hit block">
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={sw} />
            {share > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={sw} strokeDasharray={`${c * share} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <b className="text-[18px] font-bold leading-[22px] tabular-nums">{t("{n}%", { n: Math.round(share * 100) })}</b>
            <span className="whitespace-nowrap text-[10.5px] tabular-nums text-muted">{fmt(data.value, data.unit)} / {fmt(data.total, data.unit)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
