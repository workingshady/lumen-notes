import { X } from "lucide-react";
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Status } from "../../shared/types";
import { fmtDate, t, tk } from "../lib/i18n";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg" };
/** Buttons (design: Lumen Components · Buttons): Small 28 / Medium 36 / Touch 48+. */
export function Button({ variant = "secondary", size = "md", className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap",
        size === "sm" ? "h-7 rounded-[8px] px-2.5 text-[12px]" : size === "lg" ? "h-12 rounded-[12px] px-[18px] text-[15px]" : "h-9 rounded-[10px] px-3.5 text-[13px]",
        variant === "primary" && "bg-accent font-semibold text-accent-fg hover:brightness-110",
        variant === "secondary" && "border border-line font-medium text-ink hover:bg-surface-2",
        variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-ink",
        variant === "danger" && "border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] font-medium text-bad hover:bg-bad/10",
        className,
      )}
    />
  );
}

/** Icon button 32 (design: Components · "+" bordered / "⋯" ghost). */
export function IconButton({ label, active, bordered, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; bordered?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      {...p}
      className={cx("inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] transition-colors", bordered && "border border-line", active ? "bg-surface-2 text-accent" : bordered ? "text-ink hover:bg-surface-2" : "text-muted hover:text-ink hover:bg-surface-2", className)}
    />
  );
}

/** Segmented control (design: Components · Edit/Split/Read/Focus). */
export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx("inline-flex gap-0.5 rounded-[10px] border border-line bg-surface p-[3px]", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx("flex h-7 items-center gap-1.5 rounded-[7px] px-3 text-[13px] transition-colors", value === o.value ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Status display labels (the stored values stay English ids). */
export const STATUS_LABEL: Record<Status, string> = { todo: tk("todo"), learning: tk("learning"), review: tk("review"), mastered: tk("mastered") };
export const STATUS_COLOR: Record<Status, string> = { todo: "var(--muted)", learning: "var(--info)", review: "var(--warning)", mastered: "var(--success)" };
export function StatusDot({ status, className }: { status: Status | null; className?: string }) {
  if (!status) return null;
  return <span title={t(STATUS_LABEL[status] ?? status)} className={cx("inline-block size-2 rounded-full shrink-0", className)} style={{ background: STATUS_COLOR[status] }} />;
}
export function StatusPill({ status }: { status: Status }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-[9px] text-[12px] font-medium capitalize leading-[22px]" style={{ color: STATUS_COLOR[status], background: `color-mix(in srgb, ${STATUS_COLOR[status]} 14%, transparent)` }}>
      <span className="size-1.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />
      {t(STATUS_LABEL[status] ?? status)}
    </span>
  );
}

/** Chip (design: Components · Chips): neutral #tag, link-tinted #tag, removable filter chip. */
export function Chip({ children, onClick, active, tone, onRemove }: { children: ReactNode; onClick?: () => void; active?: boolean; tone?: "link" | "info"; onRemove?: () => void }) {
  const c = tone === "link" ? "var(--link)" : tone === "info" ? "var(--info)" : null;
  return (
    <button onClick={onClick} className={cx("inline-flex items-center gap-1 rounded-[6px] py-0.5 text-[12px] leading-[18px] transition-colors", onRemove ? "ps-2 pe-1.5" : "px-2", active ? "bg-accent text-accent-fg" : c ? "" : "bg-surface-2 text-muted hover:text-ink")} style={!active && c ? { color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` } : undefined}>
      {children}
      {onRemove && <X size={11} onClick={(e) => { e.stopPropagation(); onRemove(); }} />}
    </button>
  );
}

/** Dialog on desktop (radius 14), bottom sheet with a drag handle on phones (design: Components · Bottom sheet). */
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(5,6,8,.6)] md:items-center fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx("sheet-in safe-b flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-[14px] border border-b-0 border-line bg-surface shadow-2xl md:rounded-[14px] md:border-b", wide ? "md:max-w-3xl" : "md:max-w-[520px]")}>
        {title && <div className="flex justify-center pt-2.5 md:hidden"><span className="h-1 w-9 rounded-[2px] bg-line" /></div>}
        {title && (
          <div className="flex items-center justify-between px-4 pb-1 pt-2.5 md:px-[22px] md:pt-[18px]">
            <div className="text-[15px] font-[650] md:text-[17px]">{title}</div>
            <button aria-label={t("Close")} onClick={onClose} className="text-muted hover:text-ink"><X size={17} /></button>
          </div>
        )}
        <div className={cx("overflow-y-auto", title ? "px-4 pb-4 pt-3 md:px-[22px]" : "p-4")}>{children}</div>
      </div>
    </div>
  );
}

/** Empty state (design: 06b · 22A–C): title, one line of help, exactly one action. */
/** `icon` is accepted for compatibility but not drawn: empty states are illustration-free. */
export function Empty({ title, hint, action, foot }: { icon?: ReactNode; title: string; hint?: ReactNode; action?: ReactNode; foot?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 px-10 py-16 text-center">
      <div className="text-[16px] font-semibold">{title}</div>
      {hint && <div className="max-w-[340px] text-[13px] leading-5 text-muted">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
      {foot && <div className="text-[12px] text-muted">{foot}</div>}
    </div>
  );
}

/** Compact relative time ("5m ago"); in the interface language. */
export function relTime(ts: number) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return t("just now");
  if (s < 3600) return t("{n}m ago", { n: Math.floor(s / 60) });
  if (s < 86400) return t("{n}h ago", { n: Math.floor(s / 3600) });
  if (s < 86400 * 7) return t("{n}d ago", { n: Math.floor(s / 86400) });
  return fmtDate(ts, { month: "short", day: "numeric", year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-[12px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-[11.5px] text-muted">{hint}</span>}
    </label>
  );
}
/** Input (design: Components · Inputs): 36 high, radius 6, focus = accent border + 3 px 20% ring; add `aria-invalid` for the error state. */
export const inputCls = "h-9 w-full rounded-[6px] border border-line bg-bg px-2.5 text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_20%,transparent)] aria-[invalid=true]:border-bad";
