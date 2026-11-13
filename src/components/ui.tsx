import { X } from "lucide-react";
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Status } from "../../shared/types";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" };
export function Button({ variant = "secondary", size = "md", className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-[10px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-10 px-3.5",
        variant === "primary" && "bg-accent text-accent-fg hover:brightness-110",
        variant === "secondary" && "bg-surface-2 text-ink border border-line hover:bg-surface",
        variant === "ghost" && "text-muted hover:text-ink hover:bg-surface-2",
        variant === "danger" && "bg-bad/15 text-bad hover:bg-bad/25",
        className,
      )}
    />
  );
}

export function IconButton({ label, active, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      {...p}
      className={cx("inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] transition-colors", active ? "bg-surface-2 text-accent" : "text-muted hover:text-ink hover:bg-surface-2", className)}
    />
  );
}

export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx("inline-flex rounded-[10px] bg-surface-2 p-0.5 border border-line", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx("h-7 rounded-[8px] px-2.5 text-[12.5px] font-medium transition-colors flex items-center gap-1", value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const STATUS_COLOR: Record<Status, string> = { todo: "var(--muted)", learning: "var(--info)", review: "var(--warning)", mastered: "var(--success)" };
export function StatusDot({ status, className }: { status: Status | null; className?: string }) {
  if (!status) return null;
  return <span title={status} className={cx("inline-block size-2 rounded-full shrink-0", className)} style={{ background: STATUS_COLOR[status] }} />;
}
export function StatusPill({ status }: { status: Status }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium capitalize" style={{ color: STATUS_COLOR[status], background: `color-mix(in oklab, ${STATUS_COLOR[status]} 14%, transparent)` }}>
      <span className="size-1.5 rounded-full" style={{ background: STATUS_COLOR[status] }} />
      {status}
    </span>
  );
}

export function Chip({ children, onClick, active }: { children: ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} className={cx("inline-flex h-6 items-center rounded-full px-2 text-[12px] transition-colors", active ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted hover:text-ink")}>
      {children}
    </button>
  );
}

/** Dialog on desktop, bottom sheet on phones. */
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx("sheet-in safe-b max-h-[90dvh] w-full overflow-hidden rounded-t-[14px] border border-line bg-surface shadow-2xl md:rounded-[14px] flex flex-col", wide ? "md:max-w-3xl" : "md:max-w-lg")}>
        {title && (
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="font-semibold">{title}</div>
            <IconButton label="Close" onClick={onClose}><X size={18} /></IconButton>
          </div>
        )}
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="mb-1 text-muted">{icon}</div>
      <div className="font-semibold">{title}</div>
      {hint && <div className="max-w-xs text-[13px] text-muted">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function relTime(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
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
export const inputCls = "h-10 w-full rounded-[8px] border border-line bg-bg px-3 text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none";
