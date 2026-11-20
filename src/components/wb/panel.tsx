// Design panel parts (WBStudio "hasPanel" / R6Parts) shared by the W2-A pen, palette, eraser, lasso and handwriting panels.
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Glyph } from "../Glyph";
import { cx } from "../ui";
import { t } from "../../lib/i18n";

/** Floating panel (desktop) or bottom sheet (phone) with the design's header: glyph · title · sub · ×. Closes on outside
 *  pointerdown (unless inside [data-pop-anchor] or [data-keep-open]) and Esc. */
export function PanelShell({ glyph, title, sub, onClose, sheet, className, style, children, foot, bodyClass, label, portal }: {
  /** Render into document.body (phone sheets opened from a bar). */ portal?: boolean;
  glyph: string; title: ReactNode; sub?: ReactNode; onClose: () => void; sheet?: boolean; className?: string; style?: CSSProperties; children: ReactNode; foot?: ReactNode; bodyClass?: string; label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const down = (e: PointerEvent) => { const el = e.target as HTMLElement; if (ref.current && !ref.current.contains(el) && !el.closest?.("[data-pop-anchor],[data-keep-open]")) close.current(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close.current(); } };
    const tm = setTimeout(() => addEventListener("pointerdown", down, true), 0);
    addEventListener("keydown", key, true);
    return () => { clearTimeout(tm); removeEventListener("pointerdown", down, true); removeEventListener("keydown", key, true); };
  }, []);
  const el = (
    <div ref={ref} role="dialog" aria-label={label ?? (typeof title === "string" ? title : undefined)} data-wb-chrome onPointerDown={(e) => e.stopPropagation()}
      className={cx("z-40 box-border flex flex-col overflow-hidden whitespace-normal border border-line bg-surface text-[13px] text-ink", sheet ? "sheet-in absolute inset-x-0 bottom-0 max-h-[74%] rounded-t-[20px] pb-[env(safe-area-inset-bottom)]" : "fade-in absolute rounded-[14px]", className)}
      style={{ boxShadow: "0 18px 48px rgba(0,0,0,.32)", ...style }}>
      {sheet && <div className="flex shrink-0 justify-center pt-2"><span className="h-1 w-9 rounded-[2px] bg-line" /></div>}
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-[14px] pb-[10px] pt-3">
        <Glyph name={glyph} size={16} className="text-muted" />
        <span className="flex-1 text-[13.5px] font-semibold">{title}</span>
        {sub != null && <span className="whitespace-nowrap text-[11.5px] text-muted">{sub}</span>}
        <button type="button" aria-label={t("Close")} onClick={onClose} className="flex size-[26px] items-center justify-center rounded-[7px] text-muted hover:bg-surface-2 hover:text-ink"><Glyph name="x" size={15} /></button>
      </div>
      <div className={cx("flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-[14px] [&>*]:shrink-0 pb-[14px] pt-3", bodyClass)}>{children}</div>
      {foot && <div className="flex shrink-0 justify-end gap-2 border-t border-line px-[14px] py-[10px]">{foot}</div>}
    </div>
  );
  // phone sheets that open from a bar go to <body>, so they sit over the dock like the design (44C)
  return portal ? createPortal(<div dir={document.documentElement.dir || undefined} className="md:hidden">{el}</div>, document.body) : el;
}

/** Block heading: 11 px caps label, optional right text (a button when onRight). */
export function BlockHead({ h, right, rightColor, onRight }: { h?: ReactNode; right?: ReactNode; rightColor?: string; onRight?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">
      <span>{h}</span>
      {right != null && (onRight
        ? <button type="button" onClick={onRight} className="font-medium normal-case tracking-normal" style={{ color: rightColor ?? "var(--muted)" }}>{right}</button>
        : <span className="font-medium normal-case tracking-normal" style={{ color: rightColor ?? "var(--muted)" }}>{right}</span>)}
    </div>
  );
}

/** Segmented control (design `seg`): 2 px padding, sf2 track, selected = sf + shadow + 600. */
export function Seg<T extends string>({ items, value, onPick, className }: { items: [T, ReactNode, string?][]; value: T; onPick: (v: T) => void; className?: string }) {
  return (
    <div role="radiogroup" className={cx("flex gap-[2px] rounded-[8px] bg-surface-2 p-[2px]", className)}>
      {items.map(([v, l, tip]) => (
        <button key={v} type="button" role="radio" title={tip} aria-checked={v === value} onClick={() => onPick(v)}
          className={cx("flex h-7 min-w-0 flex-1 items-center justify-center gap-[5px] overflow-hidden whitespace-nowrap rounded-[6px] px-1.5 text-[12px]", v === value ? "bg-surface font-semibold text-ink" : "text-muted hover:text-ink")}
          style={v === value ? { boxShadow: "0 1px 2px rgba(0,0,0,.2)" } : undefined}>{l}</button>
      ))}
    </div>
  );
}

/** Design slider: 4 px track (accent up to the value), 16 px thumb in the text colour. Pointer drag + arrow keys. */
export function Slider({ value, onChange, min = 0, max = 100, step = 1, label, className, onCommit }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string; className?: string; onCommit?: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const pct = `${((Math.max(min, Math.min(max, value)) - min) / (max - min)) * 100}%`;
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    let k = (clientX - r.left) / r.width;
    if (getComputedStyle(ref.current!).direction === "rtl") k = 1 - k;
    const v = min + Math.max(0, Math.min(1, k)) * (max - min);
    onChange(Math.round(Math.round(v / step) * step * 1000) / 1000);
  };
  return (
    <span ref={ref} role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); at(e.clientX); }}
      onPointerMove={(e) => { if (e.buttons) at(e.clientX); }}
      onPointerUp={() => onCommit?.()}
      onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(Math.min(max, value + step)); else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(Math.max(min, value - step)); else return; e.preventDefault(); }}
      className={cx("relative block h-1 min-w-[60px] flex-1 cursor-pointer touch-none rounded-[2px] outline-none before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']", className)}
      style={{ background: `linear-gradient(90deg,var(--accent) ${pct},var(--border) ${pct})` }}>
      <span className="pointer-events-none absolute -top-1.5 -ms-2 size-4 rounded-full bg-ink" style={{ insetInlineStart: pct, boxShadow: "0 1px 3px rgba(0,0,0,.4)" }} />
    </span>
  );
}

/** Design toggle (30×18): accent knob track when on. */
export function Tog({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="relative h-[18px] w-[30px] shrink-0 rounded-full" style={{ background: on ? "var(--accent)" : "var(--border)" }}>
      <span className="absolute top-[2px] size-[14px] rounded-full transition-[left] duration-150" style={{ left: on ? 14 : 2, background: on ? "var(--accent-fg)" : "var(--muted)" }} />
    </button>
  );
}

/** Design colour tile: full-width swatch (28 px palette / 30 px parts); selected = double ring, never only a shade change. */
export function ColourTile({ c, sel, onClick, title, h = 28, onContextMenu, draggable, onDragStart, onDragOver, onDrop }: {
  c: string; sel?: boolean; onClick?: () => void; title?: string; h?: number; onContextMenu?: (e: React.MouseEvent) => void;
  draggable?: boolean; onDragStart?: (e: React.DragEvent) => void; onDragOver?: (e: React.DragEvent) => void; onDrop?: (e: React.DragEvent) => void;
}) {
  return (
    <button type="button" title={title ?? c} aria-label={title ?? c} aria-pressed={sel} onClick={onClick} onContextMenu={onContextMenu} draggable={draggable} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}
      className="box-border min-w-0 rounded-[7px] p-0" style={{ height: h, boxShadow: sel ? "0 0 0 2px var(--surface), 0 0 0 4px var(--text)" : "none" }}>
      <span className="box-border block size-full rounded-[7px] border border-line" style={{ background: c === "transparent" ? "repeating-conic-gradient(var(--surface-2) 0 25%, var(--bg) 0 50%) 0 0/8px 8px" : c }} />
    </button>
  );
}

export const ON_STYLE: CSSProperties = { background: "color-mix(in srgb,var(--accent) 18%,transparent)", borderColor: "var(--accent)" };
