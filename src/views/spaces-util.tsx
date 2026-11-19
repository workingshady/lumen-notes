// Shared helpers for the spaces area (space page, roadmap views, new-space + import/export dialogs).
import { useEffect, useState, type ReactNode } from "react";
import { digits, fmtDate, getLang, t } from "../lib/i18n";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const asDate = (d: string | number | Date) => (d instanceof Date ? d : new Date(typeof d === "string" ? d + "T00:00:00" : d));
/** Arabic interface: Intl with Arabic month / weekday names (the English design order stays hand-built). */
const ar = () => getLang() === "ar";
/** "18 Nov" */
export const fmtDay = (d: string | number | Date) => { const x = asDate(d); return ar() ? fmtDate(x, { day: "numeric", month: "short" }) : `${x.getDate()} ${MON[x.getMonth()]}`; };
/** "Tue 18 Nov" */
export const fmtLong = (d: string | number | Date) => { const x = asDate(d); return ar() ? fmtDate(x, { weekday: "short", day: "numeric", month: "short" }) : `${WD[x.getDay()]} ${x.getDate()} ${MON[x.getMonth()]}`; };
/** "Fri 12 Feb 2027" */
export const fmtFull = (d: string | number | Date) => { const x = asDate(d); return ar() ? fmtDate(x, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : `${fmtLong(x)} ${x.getFullYear()}`; };
/** "Mon 17" (task cards) */
export const fmtWdDay = (d: string | number | Date) => { const x = asDate(d); return ar() ? fmtDate(x, { weekday: "short", day: "numeric" }) : `${WD[x.getDay()]} ${x.getDate()}`; };
export const isoDay = (t: number) => { const x = new Date(t); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
export const todayIso = () => isoDay(Date.now());
export const DAY = 86_400_000;

/** "Edited 1 h ago" · "Yesterday" · "Tue" · "6 Nov" (design: project recent notes). */
export function recentLabel(ts: number) {
  const now = new Date();
  const s = (now.getTime() - ts) / 1000;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startToday) return s < 3600 ? t("Edited {n} min ago", { n: Math.max(1, Math.round(s / 60)) }) : t("Edited {n} h ago", { n: Math.floor(s / 3600) });
  if (ts >= startToday - DAY) return t("Yesterday");
  if (ts >= startToday - 6 * DAY) return ar() ? fmtDate(ts, { weekday: "short" }) : WD[new Date(ts).getDay()];
  return fmtDay(ts);
}

export const fmtBytes = (n: number) => digits(n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);

/** Phone layout (< 768px), live. */
export function usePhone() {
  const q = "(max-width: 767px)";
  const [m, setM] = useState(() => typeof matchMedia === "function" && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const f = () => setM(mq.matches);
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return m;
}

/** Design dialog: dimmed backdrop rgba(5,6,8,.62), centred panel of a fixed width; bottom sheet on phones. */
export function Modal({ open, onClose, width, phoneHeight, children, label }: { open: boolean; onClose: () => void; width: number; phoneHeight?: string; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fade-in fixed inset-0 z-50 flex items-end justify-center bg-[rgba(5,6,8,.62)] md:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={label}
        className="sheet-in safe-b flex max-h-[100dvh] w-full flex-col leading-[normal] overflow-y-auto overflow-x-hidden rounded-t-[14px] bg-surface md:max-h-[92dvh] md:rounded-[14px] md:border md:border-line"
        style={{ maxWidth: `min(${width}px, 100vw)`, height: phoneHeight }}>
        {children}
      </div>
      <style>{`@media (min-width:768px){[aria-label="${label}"][role=dialog]{height:auto!important}}`}</style>
    </div>
  );
}
