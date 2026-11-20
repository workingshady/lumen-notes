// WBStudio panel items (`it()` / `B()` in WBStudio.dc.html and R6Parts.dc.html) as components:
// column tiles (glyph or thumb over a label), rows (grip · thumb · glyph · label · sub · toggle / icons), notes.
import type { CSSProperties, ReactNode } from "react";
import { Glyph } from "../Glyph";
import { cx } from "../ui";

export const AC = "color-mix(in srgb,var(--accent) 18%,transparent)";

/** Column tile: `col: 1` items (min-height 62 / 58 / 54, padding 6px 4px, 10.5 px label). */
export function ColItem({ glyph, thumb, label, on, onClick, mh = 54, gs = 18, gc, op = 1, tip, pad = "6px 4px", bd = "var(--border)", fs = 10.5, thH = 30, thW = "100%" }: {
  glyph?: string; thumb?: string; label?: ReactNode; on?: boolean; onClick?: () => void; mh?: number; gs?: number; gc?: string; op?: number; tip?: string; pad?: string; bd?: string; fs?: number; thH?: number; thW?: string;
}) {
  return (
    <button type="button" title={tip ?? (typeof label === "string" ? label : undefined)} aria-pressed={on} onClick={onClick}
      className={cx("relative box-border flex min-w-0 flex-col items-center justify-center gap-1 rounded-[8px] border transition-colors", !on && "hover:bg-surface-2")}
      style={{ minHeight: mh, padding: pad, background: on ? AC : "transparent", borderColor: on ? "var(--accent)" : bd, color: "var(--text)", opacity: op, fontSize: fs }}>
      {thumb && <span className="box-border block shrink-0 rounded-[4px] border border-line" style={{ width: thW, height: thH, background: thumb }} />}
      {glyph && <Glyph name={glyph} size={gs} color={gc} className="shrink-0" />}
      {label != null && <span className="shrink-0 whitespace-nowrap text-center">{label}</span>}
    </button>
  );
}

/** Row item (34 px, padding 0 8px, 12.5 px). */
export function RowItem({ glyph, label, sub, right, on, onClick, onDoubleClick, mh = 34, op = 1, pad = "0 8px", bd = "transparent", children, style, className, gs = 18, title, ...rest }: {
  glyph?: string; label?: ReactNode; sub?: ReactNode; right?: ReactNode; on?: boolean; onClick?: () => void; onDoubleClick?: () => void; mh?: number; op?: number; pad?: string; bd?: string; children?: ReactNode; style?: CSSProperties; className?: string; gs?: number; title?: string;
} & Record<string, unknown>) {
  return (
    <div role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} title={title} onClick={onClick} onDoubleClick={onDoubleClick}
      onKeyDown={onClick ? (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); onClick(); } } : undefined}
      className={cx("relative box-border flex min-w-0 items-center gap-2 rounded-[8px] border text-[12.5px]", onClick && !on && "cursor-pointer hover:bg-surface-2", className)}
      style={{ minHeight: mh, padding: pad, background: on ? AC : "transparent", borderColor: on ? "var(--accent)" : bd, opacity: op, ...style }} {...rest}>
      {children}
      {glyph && <Glyph name={glyph} size={gs} className="shrink-0" />}
      {label != null && <span className="min-w-0 flex-1 truncate whitespace-nowrap">{label}</span>}
      {sub != null && <span className="whitespace-nowrap text-[11px] text-muted">{sub}</span>}
      {right}
    </div>
  );
}

/** Small icon button used inside rows (15 px glyphs, muted). */
export function RowIcon({ glyph, tip, onClick, color, active }: { glyph: string; tip: string; onClick: () => void; color?: string; active?: boolean }) {
  return (
    <button type="button" title={tip} aria-label={tip} aria-pressed={active} onClick={(e) => { e.stopPropagation(); onClick(); }} onDoubleClick={(e) => e.stopPropagation()}
      className="flex size-[22px] items-center justify-center rounded-[6px] text-muted hover:bg-surface hover:text-ink" style={color ? { color } : undefined}>
      <Glyph name={glyph} size={15} />
    </button>
  );
}

/** Block note (11.5 px, muted; optional sf2 box). */
export const Note = ({ children, boxed, color }: { children: ReactNode; boxed?: boolean; color?: string }) => (
  <div className="rounded-[8px] text-[11.5px] leading-[17px]" style={{ color: color ?? "var(--muted)", background: boxed ? "var(--surface-2)" : "transparent", padding: boxed ? "8px 10px" : 0 }}>{children}</div>
);

/** Panel position on desktop (WBStudio pnPos, shifted into the board host under the 48 px header). */
export const PANEL_END = "end-[14px] top-[12px] bottom-[60px] w-[320px]";
