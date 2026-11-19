// Value chip (design round 4 settings rows / export dialog): a 28 px bordered chip showing the current value; click
// opens a small menu of options. Keyboard: Enter/Space opens, arrows move, Enter picks, Esc closes.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

export interface ChipOption<T> { value: T; label: string; hint?: string; disabled?: boolean }
export function ChipSelect<T extends string | number>({ value, options, onChange, label, disabled, className, align = "right" }: {
  value: T; options: ChipOption<T>[]; onChange: (v: T) => void; label?: ReactNode; disabled?: boolean; className?: string; align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const cur = options.find((o) => o.value === value);
  useEffect(() => {
    if (!open) return;
    setHi(Math.max(0, options.findIndex((o) => o.value === value)));
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setHi((x) => Math.min(options.length - 1, x + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setHi((x) => Math.max(0, x - 1)); }
    };
    addEventListener("mousedown", h);
    addEventListener("keydown", k, true);
    return () => { removeEventListener("mousedown", h); removeEventListener("keydown", k, true); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span ref={ref} className={cx("relative inline-flex", className)}>
      <button type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (open && e.key === "Enter") { e.preventDefault(); const o = options[hi]; if (o && !o.disabled) { onChange(o.value); setOpen(false); } } }}
        className="flex h-7 items-center whitespace-nowrap rounded-[7px] border border-line px-2.5 text-[12.5px] hover:bg-surface-2 disabled:opacity-45">
        {label ?? cur?.label ?? String(value)}
      </button>
      {open && (
        <div role="listbox" className={cx("absolute top-full z-50 mt-1 flex max-h-[280px] min-w-full flex-col overflow-y-auto rounded-[9px] border border-line bg-surface-2 p-1 shadow-[0_12px_28px_rgba(0,0,0,.35)]", align === "right" ? "right-0" : "left-0")}>
          {options.map((o, i) => (
            <button key={String(o.value)} type="button" role="option" aria-selected={o.value === value} disabled={o.disabled}
              onMouseEnter={() => setHi(i)} onClick={() => { onChange(o.value); setOpen(false); }}
              className={cx("flex min-h-7 flex-col items-start whitespace-nowrap rounded-[6px] px-2.5 py-1 text-left text-[12.5px] disabled:opacity-40", i === hi && "bg-surface", o.value === value && "font-semibold")}>
              <span>{o.label}</span>{o.hint && <span className="text-[11px] font-normal text-muted">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** Settings row (R4-17G/I): label + description on the left, a control on the right, a hairline above. */
export function PrefRow({ label, desc, children }: { label: ReactNode; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-[34px] items-center gap-3 border-t border-line pt-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="font-medium">{label}</span>{desc && <span className="text-[12px] text-muted">{desc}</span>}</div>
      {children}
    </div>
  );
}
