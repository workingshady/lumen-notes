// Small shared pieces of the whiteboard chrome (design WBStudio / R6Parts): toolbar buttons, hairlines, popovers, rows.
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Glyph } from "../Glyph";
import { cx } from "../ui";

export const AC_BG = "color-mix(in srgb,var(--accent) 18%,transparent)";

/** Toolbar button: 34 px tall, 8 px radius, 18 px glyph; key numeral bottom-right; optional colour dot and split caret. */
export function ToolBtn({ glyph, tip, k, on, dot, split, onClick, onCaret, disabled, label, size = 18 }: {
  glyph: string; tip: string; k?: string; on?: boolean; dot?: string; split?: boolean; onClick: () => void; onCaret?: () => void; disabled?: boolean; label?: string; size?: number;
}) {
  return (
    <button type="button" title={k ? `${tip} · ${k}` : tip} aria-label={tip} aria-pressed={on} disabled={disabled}
      onClick={(e) => { if (split && onCaret && (e.target as HTMLElement).closest("[data-caret]")) onCaret(); else onClick(); }}
      onContextMenu={(e) => { if (onCaret) { e.preventDefault(); onCaret(); } }}
      className={cx("relative flex h-[34px] min-w-[34px] items-center justify-center gap-[3px] rounded-[8px] transition-colors disabled:opacity-40", split ? "px-[6px]" : "px-0", on ? "text-accent" : "text-ink hover:bg-surface-2")}
      style={on ? { background: AC_BG } : undefined}>
      <Glyph name={glyph} size={size} />
      {label && <span className="text-[12px]">{label}</span>}
      {dot && <span className="absolute bottom-[5px] left-[5px] size-[7px] rounded-full" style={{ background: dot, boxShadow: "0 0 0 1.5px var(--surface)" }} />}
      {split && <span data-caret className="flex h-full items-center"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg></span>}
      {k && <span className="pointer-events-none absolute bottom-px right-[3px] text-[8.5px] font-medium leading-none text-muted">{k}</span>}
    </button>
  );
}

/** Hairline divider between groups. */
export const Sep = ({ h = 22, m = 4 }: { h?: number; m?: number }) => <span aria-hidden className="w-px shrink-0 bg-line" style={{ height: h, margin: `0 ${m}px` }} />;

/** Floating popover; closes on outside pointerdown and Esc. Positioned by the caller (style). */
export function Pop({ onClose, children, className, style, label }: { onClose: () => void; children: ReactNode; className?: string; style?: CSSProperties; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.("[data-pop-anchor]")) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    const tm = setTimeout(() => addEventListener("pointerdown", down, true), 0);
    addEventListener("keydown", key, true);
    return () => { clearTimeout(tm); removeEventListener("pointerdown", down, true); removeEventListener("keydown", key, true); };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" aria-label={label} onPointerDown={(e) => e.stopPropagation()}
      className={cx("absolute z-40 rounded-[12px] border border-line bg-surface p-1.5 text-[12.5px] shadow-[0_16px_40px_rgba(0,0,0,.35)] fade-in", className)} style={style}>
      {children}
    </div>
  );
}

/** Menu row: 34 px, glyph 16, label, right hint. */
export function Row({ glyph, label, hint, on, onClick, danger, disabled }: { glyph?: string; label: ReactNode; hint?: ReactNode; on?: boolean; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick}
      className={cx("flex h-[34px] w-full items-center gap-2.5 rounded-[8px] px-2 text-start text-[12.5px] disabled:opacity-40", on ? "text-accent" : danger ? "text-bad hover:bg-surface-2" : "text-ink hover:bg-surface-2")}
      style={on ? { background: AC_BG } : undefined}>
      {glyph && <Glyph name={glyph} size={16} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint != null && <span className="whitespace-nowrap text-[11px] text-muted">{hint}</span>}
    </button>
  );
}

/** Small switch (30×18), amber when on. */
export function Toggle({ on }: { on: boolean }) {
  return (
    <span className={cx("relative h-[18px] w-[30px] shrink-0 rounded-full", on ? "bg-accent" : "bg-line")}>
      <span className="absolute top-[2px] size-[14px] rounded-full" style={{ left: on ? 14 : 2, background: on ? "var(--accent-fg)" : "var(--muted)" }} />
    </span>
  );
}

/** Swatch: 18×18 (property bar) or bigger in grids; selected = double ring. */
export function Swatch({ c, sel, size = 22, onClick, title }: { c: string; sel?: boolean; size?: number; onClick?: () => void; title?: string }) {
  const transparent = c === "transparent";
  return (
    <button type="button" title={title ?? c} aria-label={title ?? c} onClick={onClick} className="shrink-0 rounded-[6px]"
      style={{ width: size, height: size, background: transparent ? "repeating-conic-gradient(var(--surface-2) 0 25%, var(--bg) 0 50%) 0 0/8px 8px" : c, boxShadow: sel ? "0 0 0 2px var(--surface), 0 0 0 4px var(--text)" : "inset 0 0 0 1px rgba(0,0,0,.15)" }} />
  );
}

/** Rounded segmented row of glyph choices (fill style, width, edges…). */
export function Choices<T extends string | number>({ items, value, onPick }: { items: [T, string, string][]; value: T | null; onPick: (v: T) => void }) {
  return (
    <div className="flex gap-1">
      {items.map(([v, g, tip]) => (
        <button key={String(v)} type="button" title={tip} aria-label={tip} aria-pressed={value === v} onClick={() => onPick(v)}
          className={cx("flex size-[32px] items-center justify-center rounded-[8px] border", value === v ? "border-accent text-accent" : "border-line text-ink hover:bg-surface-2")}
          style={value === v ? { background: AC_BG } : undefined}><Glyph name={g} size={17} /></button>
      ))}
    </div>
  );
}

export const Label = ({ children, right }: { children: ReactNode; right?: ReactNode }) => (
  <div className="flex items-center justify-between px-1 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted"><span>{children}</span>{right != null && <span className="font-medium normal-case tracking-normal">{right}</span>}</div>
);
