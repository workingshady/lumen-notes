// Panel / block / tile renderer: the design's R6Parts + R6Block + WBStudio panel template (36A–G, 45C–D, 49A–F), 1:1 in JSX.
// Items carry the same fields as the design's `it()` object, plus handlers so every tile really works.
import type { CSSProperties, DragEvent, ReactNode } from "react";
import { Glyph } from "../Glyph";

/** Design tokens → app variables (so the design's inline values can be copied unchanged). */
export const TOKENS = { "--bg": "var(--bg)", "--sf": "var(--surface)", "--sf2": "var(--surface-2)", "--bd": "var(--border)", "--tx": "var(--text)", "--mu": "var(--muted)", "--ac": "var(--accent)", "--af": "var(--accent-fg)", "--ln": "var(--link)", "--ok": "var(--success)", "--wa": "var(--warning)", "--da": "var(--danger)", "--in": "var(--info)", "--le": "var(--learn)" } as CSSProperties;
const AC = "color-mix(in srgb,var(--ac) 18%,transparent)";

export interface Itm {
  key?: string; g?: string; l?: ReactNode; sub?: ReactNode; col?: boolean; on?: boolean; gc?: string; gs?: number; mh?: string; pad?: string; rad?: string;
  th?: string; thW?: string; thH?: string; thR?: number | string; grip?: boolean; tag?: string; tagC?: string; tog?: boolean; sl?: number; ic?: (string | [string, string])[];
  c?: string; bd?: string; bg?: string; fw?: number; ff?: string; lfs?: string; wrap?: boolean; tip?: string; ring?: string; op?: number; fs?: string;
  img?: string; pv?: { d: string; w: number; fill?: string; color?: string; op?: number; cap?: string; da?: string; vw?: number };
  onClick?: () => void; onSlide?: (v: number) => void; onDragStart?: (e: DragEvent) => void; onDrop?: (e: DragEvent) => void; onDragOver?: (e: DragEvent) => void; star?: { on: boolean; toggle: () => void };
  draggable?: boolean; disabled?: boolean;
}
export interface Blk { h?: ReactNode; hr?: ReactNode; hrC?: string; onHr?: () => void; seg?: string[]; segCompact?: boolean; segOn?: number; onSeg?: (i: number) => void; items?: Itm[]; cols?: string; gap?: string; note?: ReactNode; noteC?: string; noteBg?: string; node?: ReactNode; key?: string }

export function Tile({ it, panelPad }: { it: Itm; panelPad?: boolean }) {
  const col = !!it.col;
  const clickable = !!it.onClick && !it.disabled;
  return (
    <div title={typeof it.tip === "string" ? it.tip : typeof it.l === "string" ? it.l : ""} role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined} aria-pressed={it.on}
      draggable={it.draggable} onDragStart={it.onDragStart} onDrop={it.onDrop} onDragOver={it.onDragOver}
      onClick={clickable ? it.onClick : undefined} onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); it.onClick!(); } } : undefined}
      className={clickable ? "lib-tile" : undefined}
      style={{ position: "relative", display: "flex", flexDirection: col ? "column" : "row", alignItems: "center", justifyContent: col ? "center" : "flex-start", gap: col ? 4 : 8, minHeight: it.mh ?? (col ? 62 : 34), padding: it.pad ?? (col ? "6px 4px" : "0 8px"), borderRadius: it.rad ?? 8,
        background: it.on ? AC : it.bg ?? "transparent", border: `1px solid ${it.on ? "var(--ac)" : it.bd ?? "transparent"}`, color: it.c ?? "var(--tx)", boxShadow: it.ring ?? "none", opacity: it.op ?? 1, fontSize: it.fs ?? (col ? "10.5px" : "12.5px"), boxSizing: "border-box", minWidth: 0,
        cursor: clickable ? "pointer" : it.draggable ? "grab" : "default", transition: "background .12s, border-color .12s", userSelect: "none", fontFamily: "inherit", textAlign: "start" }}>
      {it.grip && <span aria-hidden style={{ color: "var(--mu)", fontSize: 11, letterSpacing: "-2px" }}>⋮⋮</span>}
      {it.th && <span style={{ width: it.thW ?? 18, height: it.thH ?? 18, flexShrink: 0, borderRadius: it.thR ?? 4, background: it.th, border: "1px solid var(--bd)", boxSizing: "border-box" }} />}
      {it.img && <img src={it.img} alt="" draggable={false} style={{ width: it.gs ?? 24, height: it.gs ?? 24, objectFit: "contain", flexShrink: 0 }} />}
      {it.g && <Glyph name={it.g} size={it.gs ?? (panelPad ? 17 : 18)} color={it.gc ?? "currentColor"} />}
      {it.pv && <svg width={it.pv.vw ?? 90} height={20} viewBox="0 0 120 20" preserveAspectRatio="none" style={{ flexShrink: 0, overflow: "visible" }}><path d={it.pv.d} style={{ fill: it.pv.fill ?? "none", stroke: it.pv.color ?? "var(--tx)", strokeWidth: it.pv.w, opacity: it.pv.op ?? 1, strokeLinecap: (it.pv.cap ?? "round") as "round", strokeDasharray: it.pv.da ?? "none" }} /></svg>}
      {it.l != null && it.l !== "" && <span style={{ flex: col ? "0 0 auto" : 1, minWidth: 0, whiteSpace: it.wrap ? "normal" : "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: it.fw ?? (it.on && !col ? 600 : 400), textAlign: col ? "center" : "start", fontFamily: it.ff ?? "inherit", fontSize: it.lfs ?? "inherit", lineHeight: 1.35 }}>{it.l}</span>}
      {it.sub != null && it.sub !== "" && <span style={{ fontSize: 11, color: "var(--mu)", whiteSpace: "nowrap" }}>{it.sub}</span>}
      {it.tog !== undefined && <span style={{ width: 30, height: 18, borderRadius: 999, background: it.tog ? "var(--ac)" : "var(--bd)", position: "relative", flexShrink: 0, transition: "background .15s" }}><span style={{ position: "absolute", top: 2, left: it.tog ? 14 : 2, width: 14, height: 14, borderRadius: "50%", background: it.tog ? "var(--af)" : "var(--mu)", transition: "left .15s" }} /></span>}
      {it.sl !== undefined && (
        <span style={{ flex: 1, height: 4, borderRadius: 2, background: `linear-gradient(90deg,var(--ac) ${it.sl}%,var(--bd) ${it.sl}%)`, position: "relative", minWidth: 60 }}>
          <span style={{ position: "absolute", left: `${it.sl}%`, top: -6, width: 16, height: 16, marginLeft: -8, borderRadius: "50%", background: "var(--tx)", boxShadow: "0 1px 3px rgba(0,0,0,.4)" }} />
          <input type="range" min={10} max={100} value={it.sl} aria-label={typeof it.l === "string" ? it.l : "Value"} onChange={(e) => it.onSlide?.(Number(e.target.value))} onClick={(e) => e.stopPropagation()} style={{ position: "absolute", inset: "-8px 0", width: "100%", opacity: 0, cursor: "pointer", margin: 0 }} />
        </span>
      )}
      {it.tag && <span style={{ fontSize: 10, fontWeight: 600, color: it.tagC ?? "var(--le)", border: `1px solid ${it.tagC ?? "var(--le)"}`, padding: "0 5px", borderRadius: 999, whiteSpace: "nowrap" }}>{it.tag}</span>}
      {it.ic && <span style={{ display: "flex", gap: 3, color: "var(--mu)" }}>{it.ic.map((x, i) => { const [n, c] = typeof x === "string" ? [x, "var(--mu)"] : x; return <Glyph key={i} name={n} size={15} color={c} />; })}</span>}
      {it.star && (
        <button type="button" className="lib-star" aria-label="Favourite" aria-pressed={it.star.on} onClick={(e) => { e.stopPropagation(); it.star!.toggle(); }}
          style={{ position: "absolute", top: 2, insetInlineEnd: 2, width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 5, border: 0, background: "transparent", color: it.star.on ? "var(--ac)" : "var(--mu)", opacity: it.star.on ? 1 : 0, cursor: "pointer", padding: 0 }}>
          <Glyph name="star" size={12} />
        </button>
      )}
    </div>
  );
}

export function Block({ bk }: { bk: Blk }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {bk.h != null && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--mu)" }}>
          <span>{bk.h}</span>
          {bk.hr != null && <span onClick={bk.onHr} style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500, color: bk.hrC ?? "var(--mu)", cursor: bk.onHr ? "pointer" : "default" }}>{bk.hr}</span>}
        </div>
      )}
      {bk.seg && (
        <div role="tablist" style={{ display: "flex", padding: 2, borderRadius: 8, background: "var(--sf2)", gap: 2 }}>
          {bk.seg.map((l, i) => {
            const on = i === (bk.segOn ?? 0);
            return <button key={l} type="button" role="tab" aria-selected={on} onClick={() => bk.onSeg?.(i)} style={{ flex: bk.segCompact ? "1 0 auto" : 1, height: 28, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: bk.segCompact ? 11.5 : 12, minWidth: bk.segCompact ? "auto" : 0, background: on ? "var(--sf)" : "transparent", color: on ? "var(--tx)" : "var(--mu)", fontWeight: on ? 600 : 400, whiteSpace: "nowrap", boxShadow: on ? "0 1px 2px rgba(0,0,0,.2)" : "none", padding: "0 6px", border: 0, cursor: "pointer", fontFamily: "inherit", transition: "background .12s" }}>{l}</button>;
          })}
        </div>
      )}
      {bk.items && <div style={{ display: "grid", gridTemplateColumns: bk.cols ?? "1fr", gap: bk.gap ?? "4px" }}>{bk.items.map((it, i) => <Tile key={it.key ?? i} it={it} />)}</div>}
      {bk.node}
      {bk.note != null && <div style={{ fontSize: 11.5, lineHeight: "17px", color: bk.noteC ?? "var(--mu)", background: bk.noteBg ?? "transparent", padding: bk.noteBg ? "8px 10px" : 0, borderRadius: 8 }}>{bk.note}</div>}
    </div>
  );
}

/** Design panel: header (glyph, title, sub, ×) + blocks + optional footer buttons. */
export function PanelShell({ title, g, sub, subC, w, onClose, children, style, foot, bodyStyle, flat }: {
  title: ReactNode; g?: string; sub?: ReactNode; subC?: string; w?: number | string; onClose?: () => void; children: ReactNode; style?: CSSProperties; foot?: ReactNode; bodyStyle?: CSSProperties; flat?: boolean;
}) {
  return (
    <div data-lib-panel style={{ ...TOKENS, width: w, boxSizing: "border-box", background: "var(--sf)", border: flat ? 0 : "1px solid var(--bd)", borderRadius: flat ? 0 : 14, boxShadow: flat ? "none" : "0 18px 48px rgba(0,0,0,.32)", display: "flex", flexDirection: "column", overflow: "hidden", color: "var(--tx)", fontSize: 13, fontFamily: "Inter,'IBM Plex Sans Arabic',system-ui,sans-serif", ...style }}>
      <style>{`.lib-tile:hover{background:color-mix(in srgb,var(--tx) 7%,transparent)}.lib-tile:hover .lib-star{opacity:1!important}.lib-tile:focus-visible{outline:2px solid var(--ac);outline-offset:1px}@keyframes lib-in{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}@media (prefers-reduced-motion:reduce){[data-lib-panel]{animation:none!important}}`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: flat ? "12px 14px 8px" : "12px 14px 10px", borderBottom: flat ? 0 : "1px solid var(--bd)" }}>
        {g && <Glyph name={g} size={16} color="var(--mu)" />}
        <span style={{ fontWeight: 600, fontSize: "13.5px", flex: 1 }}>{title}</span>
        {sub != null && <span style={{ fontSize: "11.5px", color: subC ?? "var(--mu)" }}>{sub}</span>}
        {onClose && <button type="button" aria-label="Close" onClick={onClose} style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--mu)", fontSize: 15, background: "transparent", border: 0, cursor: "pointer", borderRadius: 6 }}>×</button>}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 14, padding: flat ? "4px 14px 14px" : "12px 14px 14px", ...bodyStyle }}>{children}</div>
      {foot && <div style={{ display: "flex", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--bd)", justifyContent: "flex-end" }}>{foot}</div>}
    </div>
  );
}
export const Blocks = ({ list }: { list: Blk[] }) => <>{list.map((b, i) => <Block key={b.key ?? i} bk={b} />)}</>;

/** A glyph tile as the design's `tile()` helper. */
export const tile = (g: string, l: ReactNode, o: Partial<Itm> = {}): Itm => ({ g, l, col: true, bd: "var(--bd)", ...o });
/** A colour swatch as the design's `sw()` helper. */
export const sw = (c: string, sel: boolean, tip?: string, o: Partial<Itm> = {}): Itm => ({ th: c, thW: "100%", thH: "30px", mh: "30px", pad: "0", rad: "7px", thR: 7, ring: sel ? "0 0 0 2px var(--sf), 0 0 0 4px var(--tx)" : "none", tip: tip ?? c, ...o });
