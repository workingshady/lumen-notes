// Shared pieces of the round-8 daily surfaces (PlanDesk.dc.html header, PDTask.dc.html row, PDMini.dc.html mini month),
// converted 1:1. Design tokens → app variables: --sf surface, --sf2 surface-2, --bd border, --tx text, --mu muted,
// --ac accent, --af accent-fg, --ln link, --ok success, --wa warning, --da danger.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Glyph } from "../Glyph";
import type { GlyphName } from "../../lib/glyphs";
import { monthGrid, shiftDay, daysBetween } from "../../lib/calendar";
import { plainText, type CalTask } from "../../lib/calendar-tasks";
import { fmtDate, fmtNum, getLang, t } from "../../lib/i18n";

export const V = { bg: "var(--bg)", sf: "var(--surface)", sf2: "var(--surface-2)", bd: "var(--border)", tx: "var(--text)", mu: "var(--muted)", ac: "var(--accent)", af: "var(--accent-fg)", ln: "var(--link)", ok: "var(--success)", wa: "var(--warning)", da: "var(--danger)" };
export const AC_TINT = "color-mix(in srgb,var(--accent) 16%,transparent)";
export const tint = (c: string) => `color-mix(in srgb,${c} 16%,var(--bg))`;
export const card: CSSProperties = { display: "flex", flexDirection: "column", padding: 14, borderRadius: 14, background: V.sf, border: `1px solid ${V.bd}` };

// ------------------------------------------------------------------ dates
const D = (iso: string) => new Date(iso + "T12:00:00");
export const fmtD = (iso: string, o: Intl.DateTimeFormatOptions) => fmtDate(D(iso), o);
/** "Friday, 20 November". */
export const longDay = (iso: string) => (getLang() === "ar" ? fmtD(iso, { weekday: "long", day: "numeric", month: "long" }) : `${fmtD(iso, { weekday: "long" })}, ${fmtD(iso, { day: "numeric" })} ${fmtD(iso, { month: "long" })}`);
/** "16 Nov". */
export const dayMon = (iso: string) => (getLang() === "ar" ? fmtD(iso, { day: "numeric", month: "short" }) : `${fmtD(iso, { day: "numeric" })} ${fmtD(iso, { month: "short" })}`);
/** Due label in the design's words: "Overdue 4d", "Today", "16:00", "Sat", "Thu 26", "16 Nov". */
export function dueText(task: { due: string | null; time: number | null; done?: boolean }, today: string, long = false): string {
  if (!task.due) return "";
  const n = daysBetween(today, task.due);
  if (n < 0 && !task.done) return long ? dayMon(task.due) : t("Overdue {n}d", { n: -n });
  if (n === 0) return task.time != null ? hhmm(task.time) : t("Today");
  if (n > 0 && n < 7) return n < 2 || !long ? fmtD(task.due, { weekday: "short" }) : `${fmtD(task.due, { weekday: "short" })} ${fmtNum(D(task.due).getDate())}`;
  if (n >= 7 && n < 14) return `${fmtD(task.due, { weekday: "short" })} ${fmtNum(D(task.due).getDate())}`;
  return dayMon(task.due);
}
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// ------------------------------------------------------------------ header (PlanDesk top bar)
export function Seg<T extends string>({ options, value, onChange }: { options: { v: T; l: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" style={{ display: "flex", padding: 3, borderRadius: 10, background: V.sf2, gap: 2 }}>
      {options.map((o) => {
        const on = o.v === value;
        return <button key={o.v} role="tab" aria-selected={on} onClick={() => onChange(o.v)} style={{ height: 30, padding: "0 12px", borderRadius: 7, display: "flex", alignItems: "center", fontSize: 12.5, background: on ? V.sf : "transparent", color: on ? V.tx : V.mu, fontWeight: on ? 600 : 400, boxShadow: on ? "0 1px 2px rgba(0,0,0,.2)" : "none", whiteSpace: "nowrap", transition: "background .15s, color .15s" }}>{o.l}</button>;
      })}
    </div>
  );
}
export function HBtn({ glyph, label, primary, onClick, title, pressed }: { glyph: GlyphName; label: string; primary?: boolean; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; title?: string; pressed?: boolean }) {
  return (
    <button onClick={onClick} title={title} aria-pressed={pressed} className="hover:brightness-110" style={{ display: "flex", height: 34, padding: "0 12px", borderRadius: 9, alignItems: "center", gap: 6, fontSize: 12.5, border: `1px solid ${primary ? "transparent" : pressed ? V.ac : V.bd}`, background: primary ? V.ac : pressed ? AC_TINT : "transparent", color: primary ? V.af : V.tx, fontWeight: primary ? 650 : 500, whiteSpace: "nowrap" }}>
      <Glyph name={glyph} size={15} />{label}
    </button>
  );
}
export function DeskHeader({ title, sub, phone, children }: { title: ReactNode; sub?: ReactNode; phone: boolean; children?: ReactNode }) {
  return (
    <div className="safe-t" style={{ display: "flex", alignItems: "center", gap: 12, padding: phone ? "6px 16px 10px" : "20px 28px 14px", flexWrap: phone ? "nowrap" : "wrap", flexShrink: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
        <h1 style={{ fontSize: phone ? 20 : 24, fontWeight: 650, letterSpacing: "-.02em", margin: 0, whiteSpace: "nowrap", overflow: phone ? "hidden" : undefined, textOverflow: "ellipsis" }}>{title}</h1>
        {sub ? <span style={{ fontSize: 13, color: V.mu }}>{sub}</span> : null}
      </div>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ task row (PDTask)
export function TaskRow({ task, today, sel, phone, onToggle, onSelect, long }: { task: CalTask; today: string; sel?: boolean; phone?: boolean; onToggle: () => void; onSelect?: () => void; long?: boolean }) {
  const late = !task.done && !!task.due && task.due < today;
  const isToday = !task.done && (task.due === today);
  const dc = late ? V.da : isToday ? V.ac : V.mu;
  const subDone = task.subtasks.filter((s) => s.done).length;
  return (
    <div onClick={onSelect} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} onKeyDown={(e) => { if (onSelect && e.key === "Enter") onSelect(); }} className="hover:bg-[color-mix(in_srgb,var(--surface-2)_60%,transparent)]"
      style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 42, padding: "4px 8px", borderRadius: 9, background: sel ? "color-mix(in srgb,var(--accent) 10%,transparent)" : undefined, border: `1px solid ${sel ? "color-mix(in srgb,var(--accent) 50%,transparent)" : "transparent"}`, cursor: onSelect ? "pointer" : undefined }}>
      <button onClick={(e) => { e.stopPropagation(); onToggle(); }} aria-label={task.done ? t("Mark not done") : t("Mark done")} style={{ width: 18, height: 18, borderRadius: 6, border: `1.5px solid ${task.done ? V.ok : late ? V.da : task.status === "doing" ? V.ac : V.bd}`, background: task.done ? V.ok : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: V.af, transition: "background .15s, border-color .15s" }}>
        {task.done ? <Glyph name="check" size={11} stroke={3} /> : task.status === "doing" ? <span style={{ width: 8, height: 8, borderRadius: 2, background: V.ac }} /> : null}
      </button>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <span dir="auto" style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: task.done ? V.mu : V.tx, textDecoration: task.done ? "line-through" : "none", fontWeight: sel ? 600 : 400 }}>{plainText(task)}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: V.mu, whiteSpace: "nowrap", overflow: "hidden" }}>
          <span dir="auto">{task.noteTitle}</span>
          {task.subtasks.length > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>· <Glyph name="task" size={10} /> {fmtNum(subDone)}/{fmtNum(task.subtasks.length)}</span>}
          {task.repeat && <span>· {t("repeats {r}", { r: t(task.repeat === "day" ? "daily" : task.repeat === "week" ? "weekly" : task.repeat === "month" ? "monthly" : task.repeat === "year" ? "yearly" : task.repeat === "weekday" ? "on weekdays" : "every 2 weeks") })}</span>}
          {task.tags.map((g) => <span key={g} style={{ color: V.ln }}>{g}</span>)}
        </div>
      </div>
      {task.prio === "high" && !phone && <span style={{ fontSize: 10.5, fontWeight: 650, color: V.da, border: `1px solid ${V.da}`, padding: "0 6px", borderRadius: 999 }}>{t("High")}</span>}
      <span style={{ fontSize: 11.5, color: dc, whiteSpace: "nowrap", fontWeight: late ? 600 : 400 }}>{dueText(task, today, long)}</span>
    </div>
  );
}

// ------------------------------------------------------------------ mini month (PDMini)
export function MiniMonth({ year, month, today, dots, onPick, sel }: { year: number; month: number; today: string; dots: Map<string, string>; onPick?: (iso: string) => void; sel?: string }) {
  const cells = monthGrid(year, month, 1);
  const dow = [1, 2, 3, 4, 5, 6, 0].map((d) => fmtD(shiftDay("2026-11-16", (d + 6) % 7), { weekday: "narrow" }));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
      {dow.map((d, i) => <span key={i} style={{ textAlign: "center", fontSize: 10.5, color: V.mu, paddingBottom: 4 }}>{d}</span>)}
      {cells.map((d) => {
        const inM = Number(d.slice(5, 7)) === month + 1;
        const on = d === (sel ?? today);
        return (
          <button key={d} disabled={!inM} onClick={() => onPick?.(d)} aria-label={longDay(d)} className={inM && !on ? "hover:bg-surface-2" : undefined}
            style={{ height: 28, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, borderRadius: 7, background: on ? V.ac : "transparent", color: on ? V.af : d < today ? V.mu : V.tx, fontSize: 11.5, fontWeight: on ? 700 : 400 }}>
            {inM ? fmtNum(Number(d.slice(8))) : ""}
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: inM && dots.get(d) ? dots.get(d) : "transparent" }} />
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ popover menu
export function Pop({ anchor, onClose, children, width = 220 }: { anchor: HTMLElement; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 200;
    const rtl = document.documentElement.dir === "rtl";
    const left = Math.max(8, Math.min(innerWidth - width - 8, rtl ? r.left : r.right - width));
    const top = r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - 6 - h) : r.bottom + 6;
    setPos({ left, top });
  }, [anchor, width]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    addEventListener("mousedown", h); addEventListener("keydown", k, true);
    return () => { removeEventListener("mousedown", h); removeEventListener("keydown", k, true); };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={ref} role="menu" onClick={(e) => e.stopPropagation()} className="fade-in" style={{ position: "fixed", zIndex: 60, left: pos?.left ?? -9999, top: pos?.top ?? -9999, width, display: "flex", flexDirection: "column", gap: 1, padding: 6, borderRadius: 10, border: `1px solid ${V.bd}`, background: V.sf2, boxShadow: "0 12px 32px rgba(0,0,0,.4)", fontSize: 13 }}>
      {children}
    </div>, document.body);
}
export function MItem({ on, children, onClick, danger }: { on?: boolean; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button role="menuitem" onClick={onClick} className="hover:bg-surface" style={{ display: "flex", alignItems: "center", gap: 10, height: 30, borderRadius: 6, padding: "0 8px", textAlign: "start", fontWeight: on ? 600 : 400, color: danger ? V.da : undefined }}>
      {children}<span style={{ flex: 1 }} />{on && <Glyph name="check" size={13} color="var(--accent)" />}
    </button>
  );
}
export const MLabel = ({ children }: { children: ReactNode }) => <span style={{ padding: "6px 8px 4px", fontSize: 11, fontWeight: 650, letterSpacing: ".06em", color: V.mu, textTransform: "uppercase" }}>{children}</span>;
