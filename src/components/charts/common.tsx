// Shared chart pieces: size observer, tooltip, legend, data table, empty state. Hand-written SVG, no chart library.
// Colors come from CSS variables (--chart-c1..c6 = the canvas presets, plus theme tokens), so both themes work.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { fmtNum } from "../../lib/dashboard";
import { digits, t } from "../../lib/i18n";

/**
 * Observed element size. A callback ref, so a chart that first renders its empty state (no element yet: the vault was
 * still loading) starts measuring once the element mounts; a plain ref + mount-only effect stayed at 0 × 0 forever.
 */
export function useSize<T extends HTMLElement>() {
  const [el, ref] = useState<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const set = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return { ref, el, ...size };
}

export interface Tip { x: number; y: number; title: string; rows: { color?: string; label: string; value: string }[] }
/** Tooltip positioned inside a relative container; flips to stay inside it. */
export function Tooltip({ tip, w }: { tip: Tip | null; w: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tw, setTw] = useState(160);
  useEffect(() => { if (ref.current) setTw(ref.current.offsetWidth); }, [tip]);
  if (!tip) return null;
  const left = tip.x + 12 + tw > w ? Math.max(0, tip.x - 12 - tw) : tip.x + 12;
  return (
    <div ref={ref} role="status" className="chart-tip" style={{ left, top: Math.max(0, tip.y - 8) }}>
      <div className="chart-tip-title" dir="auto">{tip.title}</div>
      {tip.rows.map((r, i) => (
        <div key={i} className="chart-tip-row">
          {r.color && <span className="chart-swatch" style={{ background: r.color }} />}
          <span dir="auto" className="min-w-0 flex-1 truncate">{r.label}</span>
          <b className="tabular-nums">{r.value}</b>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  if (items.length < 2) return null;
  return (
    <div className="chart-legend" role="list">
      {items.map((it, i) => (
        <span key={i} role="listitem" className="inline-flex min-w-0 items-center gap-1.5">
          <span className="chart-swatch" style={{ background: it.color }} />
          <span dir="auto" className="truncate">{it.label}</span>
          {it.value && <span className="tabular-nums text-ink">{it.value}</span>}
        </span>
      ))}
    </div>
  );
}

export function DataTable({ columns, rows, caption }: { columns: string[]; rows: string[][]; caption?: string }) {
  return (
    <div className="chart-table h-full overflow-auto">
      <table>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead><tr>{columns.map((c, i) => <th key={i} scope="col" dir="auto">{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row" dir="auto">{c}</th> : <td key={j} dir="auto" className={/^[-\d٠-٩.,٫٬\s%٪hminسد]+$/.test(c) ? "tabular-nums text-end" : ""}>{c}</td>))}</tr>)}</tbody>
      </table>
      {!rows.length && <div className="px-2 py-3 text-[12px] text-muted">{t("No rows.")}</div>}
    </div>
  );
}

export function ChartEmpty({ children }: { children?: ReactNode }) {
  return <div className="flex h-full min-h-[60px] items-center justify-center px-3 text-center text-[12.5px] text-muted">{children ?? t("No data in this range")}</div>;
}

export const fmt = fmtNum;
/** Short axis number: 1.2k, 3.4M. */
export function short(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return digits(`${+(v / 1e6).toFixed(1)}M`);
  if (a >= 1e4) return digits(`${Math.round(v / 1e3)}k`);
  if (a >= 1e3) return digits(`${+(v / 1e3).toFixed(1)}k`);
  return digits(Number.isInteger(v) ? String(v) : String(+v.toFixed(1)));
}
/** Roughly how wide a label renders at 11px. */
export const textW = (s: string) => s.length * 6.2;

/** Roving focus across chart marks: arrows move, Home/End jump. */
export function rovingKeys(e: React.KeyboardEvent, i: number, n: number, focus: (i: number) => void, cols?: number) {
  const step = cols ? { ArrowLeft: -cols, ArrowRight: cols, ArrowUp: -1, ArrowDown: 1 } : { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 1, ArrowDown: -1 };
  const rtl = getComputedStyle(e.currentTarget as Element).direction === "rtl";
  let d = (step as Record<string, number>)[e.key];
  if (d === undefined) {
    if (e.key === "Home") { e.preventDefault(); focus(0); }
    if (e.key === "End") { e.preventDefault(); focus(n - 1); }
    return;
  }
  if (rtl && (e.key === "ArrowLeft" || e.key === "ArrowRight")) d = -d;
  e.preventDefault();
  focus(Math.max(0, Math.min(n - 1, i + d)));
}
