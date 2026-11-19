// Settings row kit (Lumen 29 · SettingsDesk, round 6): every section is grouped rows — label, one-line description,
// one control — with "Advanced" folded at the bottom and danger actions in red outline only.
import { useState, type ReactNode } from "react";
import { Glyph } from "../components/Glyph";
import { cx } from "../components/ui";
import { t } from "../lib/i18n";

/** Section page header (desktop only; the phone shows the title in its top bar). */
export function SPage({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex max-w-[760px] flex-col gap-5">
      <div className="hidden flex-col gap-1 md:flex"><span className="text-[22px] font-[650] tracking-[-.02em]">{title}</span>{sub && <span className="leading-[19px] text-muted">{sub}</span>}</div>
      {children}
    </div>
  );
}

/** Group heading (14px/650) with an optional muted description. */
export function SHead({ title, desc }: { title: ReactNode; desc?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 pt-1"><span className="text-[14px] font-[650]">{title}</span>{desc && <span className="text-[12.5px] leading-[18px] text-muted">{desc}</span>}</div>
  );
}

/** A rounded group of rows (12px radius, 1px border, surface). Children are <SRow>s; separators are drawn here. */
export function SGroup({ title, desc, children, className }: { title?: ReactNode; desc?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <>
      {title && <SHead title={title} desc={desc} />}
      <div className={cx("flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface [&>*+*]:border-t [&>*+*]:border-line", className)}>{children}</div>
    </>
  );
}

export interface SRowProps {
  label: ReactNode;
  desc?: ReactNode;
  glyph?: string;
  glyphColor?: string;
  tile?: string;
  value?: ReactNode;
  valueColor?: string;
  mono?: boolean;
  /** Right-side control (Toggle, SSeg, SBtn…). */
  control?: ReactNode;
  /** Shows "›" and makes the whole row a button. */
  onOpen?: () => void;
  off?: boolean;
  className?: string;
  children?: ReactNode;
  id?: string;
}
/** One row: optional glyph, label + description, value, control, chevron. 52px min (56 on phone). */
export function SRow({ label, desc, glyph, glyphColor = "var(--muted)", tile, value, valueColor, mono, control, onOpen, off, className, children, id }: SRowProps) {
  const body = (
    <>
      {glyph && <span className="flex shrink-0"><Glyph name={glyph} size={16} color={glyphColor} tile={tile} /></span>}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="font-medium" dir="auto">{label}</span>{desc && <span className="text-[12.5px] leading-[18px] text-muted" dir="auto">{desc}</span>}</div>
      {value !== undefined && value !== null && value !== "" && <span className={cx("whitespace-nowrap text-[12.5px]", mono && "font-mono")} style={{ color: valueColor ?? "var(--muted)" }} dir="auto">{value}</span>}
      {control}
      {onOpen && <span className="text-muted rtl:-scale-x-100" aria-hidden>›</span>}
    </>
  );
  const cls = cx("flex min-h-[72px] w-full items-center gap-3 px-3.5 py-2.5 text-start max-md:min-h-[56px]", off && "opacity-45", className);
  return (
    <div id={id}>
      {onOpen && !control ? <button type="button" onClick={onOpen} className={cx(cls, "hover:bg-surface-2/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent")}>{body}</button> : <div className={cls}>{body}</div>}
      {children}
    </div>
  );
}

/** Design toggle: 34×20 track, 14px knob. */
export function SToggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className="relative h-5 w-[34px] shrink-0 rounded-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed" style={{ background: on ? "var(--accent)" : "var(--border)" }}>
      <span className="absolute top-[3px] size-[14px] rounded-full transition-[inset-inline-start]" style={{ insetInlineStart: on ? 17 : 3, background: on ? "var(--accent-fg)" : "var(--muted)" }} />
    </button>
  );
}

/** Segmented control: 3px padding, bg, 24px items. */
export function SSeg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 gap-0.5 rounded-[8px] border border-line bg-bg p-[3px]">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cx("flex h-6 items-center whitespace-nowrap rounded-[6px] px-[9px] text-[12px]", value === o.value ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}>{o.label}</button>
      ))}
    </div>
  );
}

/** Row button: 30px; `danger` = red outline only; `primary` = accent fill. */
export function SBtn({ children, onClick, danger, primary, disabled, title }: { children: ReactNode; onClick?: () => void; danger?: boolean; primary?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={cx("flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] border px-3 disabled:opacity-50", primary ? "border-accent bg-accent font-semibold text-accent-fg" : danger ? "font-medium text-bad" : "border-line font-medium text-ink hover:bg-surface-2")}
      style={danger ? { borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)" } : undefined}>{children}</button>
  );
}

/** "▸ Advanced · summary" fold. */
export function SAdvanced({ summary, children, defaultOpen = false }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col gap-4">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-10 items-center gap-2 rounded-[10px] border border-line px-3.5 text-start text-muted hover:bg-surface">
        <span className={cx("inline-block transition-transform", open && "rotate-90")} aria-hidden>▸</span><span className="font-medium text-ink">{t("Advanced")}</span><span className="truncate text-[12px]">{summary}</span>
      </button>
      {open && <div className="flex flex-col gap-5">{children}</div>}
    </div>
  );
}

/** Inline editor that opens under a row (value rows with ›). */
export function SEdit({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 border-t border-line bg-bg/40 px-3.5 py-3">{children}</div>;
}
