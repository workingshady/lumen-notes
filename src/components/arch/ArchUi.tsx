// Small building blocks of the architecture studio, ported 1:1 from the design's R6Block (headers, segmented controls,
// tile / row grids, toggles, notes) so panels, sheets and popovers share one look.
import type { CSSProperties, ReactNode } from "react";
import { Glyph } from "../Glyph";

export const AC = "color-mix(in srgb,var(--accent) 18%,transparent)";
export interface Item {
  g?: string; gc?: string; gs?: number; l?: ReactNode; sub?: ReactNode; subC?: string; on?: boolean; col?: boolean; mh?: string; bd?: string; bg?: string; c?: string; fw?: number;
  tog?: boolean; tag?: string; tagC?: string; ic?: [string, string][]; ff?: string; onClick?: () => void; draggable?: boolean; onDragStart?: (e: React.DragEvent) => void; title?: string; op?: number; wrap?: boolean;
  children?: ReactNode;
}
export function Row({ it }: { it: Item }) {
  const col = !!it.col;
  const st: CSSProperties = {
    position: "relative", display: "flex", flexDirection: col ? "column" : "row", alignItems: "center", justifyContent: col ? "center" : "flex-start", gap: col ? 3 : 8,
    minHeight: it.mh ?? (col ? "54px" : "32px"), padding: col ? "5px 3px" : "0 8px", borderRadius: 8, background: it.on ? AC : it.bg ?? "transparent",
    border: `1px solid ${it.on ? "var(--accent)" : it.bd ?? "transparent"}`, color: it.c ?? "var(--text)", fontSize: col ? 10.5 : 12.5, boxSizing: "border-box", minWidth: 0, opacity: it.op ?? 1,
    cursor: it.onClick || it.draggable ? "pointer" : "default", textAlign: "start", width: "100%",
  };
  const Tag = it.onClick ? "button" : "div";
  return (
    <Tag type={it.onClick ? "button" : undefined} title={it.title ?? (typeof it.l === "string" ? it.l : undefined)} style={st} onClick={it.onClick} draggable={it.draggable} onDragStart={it.onDragStart} className={it.onClick || it.draggable ? "hover:bg-surface-2" : undefined}>
      {it.g && <Glyph name={it.g} size={it.gs ?? 17} color={it.gc ?? "currentColor"} />}
      {it.l !== undefined && <span style={{ flex: col ? "0 0 auto" : 1, minWidth: 0, whiteSpace: it.wrap ? "normal" : "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: it.fw ?? (it.on ? 600 : 400), textAlign: col ? "center" : "start", fontFamily: it.ff, lineHeight: 1.35 }}>{it.l}</span>}
      {it.sub !== undefined && it.sub !== "" && <span style={{ fontSize: 11, color: it.subC ?? "var(--muted)", whiteSpace: "nowrap" }}>{it.sub}</span>}
      {it.tog !== undefined && <span style={{ width: 30, height: 18, borderRadius: 999, background: it.tog ? "var(--accent)" : "var(--border)", position: "relative", flexShrink: 0 }}><span style={{ position: "absolute", top: 2, left: it.tog ? 14 : 2, width: 14, height: 14, borderRadius: "50%", background: it.tog ? "var(--accent-fg)" : "var(--muted)" }} /></span>}
      {it.tag && <span style={{ fontSize: 10, fontWeight: 600, color: it.tagC ?? "var(--learn)", border: `1px solid ${it.tagC ?? "var(--learn)"}`, padding: "0 5px", borderRadius: 999, whiteSpace: "nowrap" }}>{it.tag}</span>}
      {it.ic && <span style={{ display: "flex", gap: 3 }}>{it.ic.map(([g, c], i) => <Glyph key={i} name={g} size={15} color={c} />)}</span>}
      {it.children}
    </Tag>
  );
}
export interface BlockProps { h?: ReactNode; hr?: ReactNode; seg?: string[]; segOn?: number; onSeg?: (i: number) => void; items?: Item[]; cols?: string; gap?: string; note?: ReactNode; noteBg?: string; noteC?: string; children?: ReactNode }
export function Block({ h, hr, seg, segOn = 0, onSeg, items, cols = "1fr", gap = "4px", note, noteBg, noteC, children }: BlockProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {h && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}><span>{h}</span><span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>{hr}</span></div>}
      {seg && <Seg options={seg} on={segOn} onPick={onSeg} />}
      {items && <div style={{ display: "grid", gridTemplateColumns: cols, gap }}>{items.map((it, i) => <Row key={i} it={it} />)}</div>}
      {children}
      {note && <div style={{ fontSize: 11.5, lineHeight: "17px", color: noteC ?? "var(--muted)", background: noteBg ?? "transparent", padding: noteBg ? "8px 10px" : 0, borderRadius: 8 }}>{note}</div>}
    </div>
  );
}
export function Seg({ options, on, onPick, h = 28 }: { options: ReactNode[]; on: number; onPick?: (i: number) => void; h?: number }) {
  return (
    <div style={{ display: "flex", padding: 2, borderRadius: 8, background: "var(--surface-2)", gap: 2 }} role="radiogroup">
      {options.map((l, i) => (
        <button key={i} type="button" role="radio" aria-checked={i === on} onClick={() => onPick?.(i)}
          style={{ flex: 1, height: h, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, background: i === on ? "var(--surface)" : "transparent", color: i === on ? "var(--text)" : "var(--muted)", fontWeight: i === on ? 600 : 400, whiteSpace: "nowrap", boxShadow: i === on ? "0 1px 2px rgba(0,0,0,.2)" : "none", padding: "0 6px" }}>{l}</button>
      ))}
    </div>
  );
}
export function Btn({ children, pri, onClick, h = 30, disabled, title }: { children: ReactNode; pri?: boolean; onClick?: () => void; h?: number; disabled?: boolean; title?: string }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} className="disabled:opacity-50"
      style={{ height: h, padding: "0 12px", borderRadius: 8, display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: pri ? 600 : 500, background: pri ? "var(--accent)" : "transparent", color: pri ? "var(--accent-fg)" : "var(--text)", border: `1px solid ${pri ? "transparent" : "var(--border)"}`, whiteSpace: "nowrap" }}>{children}</button>
  );
}
/** Floating panel / bottom sheet (design `pops`). */
export function Pop({ title, sub, children, foot, style, sheet, onClose }: { title: ReactNode; sub?: ReactNode; children: ReactNode; foot?: ReactNode; style?: CSSProperties; sheet?: boolean; onClose?: () => void }) {
  return (
    <div role="dialog" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose?.(); } }}
      style={{ position: "absolute", zIndex: 30, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: sheet ? "20px 20px 0 0" : 14, boxShadow: "0 20px 50px rgba(0,0,0,.35)", display: "flex", flexDirection: "column", overflow: "hidden", ...style }}>
      {sheet && <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}><span style={{ width: 36, height: 4, borderRadius: 2, background: "var(--border)" }} /></div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 8px" }}><span style={{ fontWeight: 600, fontSize: 13.5, flex: 1 }}>{title}</span><span style={{ fontSize: 11.5, color: "var(--muted)" }}>{sub}</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 14px 14px", overflow: "auto", minHeight: 0 }}>{children}</div>
      {foot && <div style={{ display: "flex", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border)", justifyContent: "flex-end", marginTop: "auto" }}>{foot}</div>}
    </div>
  );
}
