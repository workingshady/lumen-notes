// Board pieces of the architecture studio on React Flow: node, group (and collapsed summary), junction, layout ghost
// and edge, ported from ArchStudio.dc.html (nodes / groups / edges / elbl markup) and R6Parts "archnodes".
import { Handle, Position, type NodeProps, type Node as RFNode, type Edge as RFEdge } from "@xyflow/react";
import { createContext, memo, useContext, useEffect, useRef, useState } from "react";
import type { Side } from "../../../shared/types";
import { Glyph } from "../Glyph";
import { t } from "../../lib/i18n";
import { displayOf, groupColor, nodeColor, STATUS, type AEdge, type ANode, type DiffMark } from "../../lib/arch-model";
import type { Route } from "../../lib/arch-route";
import type { RouteSrc } from "../../lib/arch-render";
import type { LabelPart } from "../../lib/arch-label";
import { ArchEdge } from "./ArchEdge";

export const DC: Record<DiffMark, string> = { add: "var(--success)", del: "var(--danger)", chg: "var(--warning)" };
export interface FlowCtx {
  hl: string | null; sel: string | null; editing: string | null;
  /** Edge editing: read-only in diff / present, the label being edited inline, and the board callbacks (each one undo step). */
  ro: boolean; editEdge: { id: string; part: LabelPart } | null; setEditEdge: (x: { id: string; part: LabelPart } | null) => void;
  saveLabel: (id: string, part: LabelPart, text: string) => void; patchEdge: (id: string, fn: (e: AEdge) => AEdge) => void; labelClick: (id: string) => void;
  setHover: (id: string | null) => void; rename: (id: string, v: string) => void; stopEdit: () => void; toggleCollapse: (id: string) => void; inside: (id: string) => number;
}
export const Ctx = createContext<FlowCtx>({ ro: false, editEdge: null, setEditEdge: () => {}, saveLabel: () => {}, patchEdge: () => {}, labelClick: () => {}, hl: null, sel: null, editing: null, setHover: () => {}, rename: () => {}, stopEdit: () => {}, toggleCollapse: () => {}, inside: () => 0 });
export type NData = { n: ANode; mark?: DiffMark; chip?: string; ghost?: boolean };
export type FlowNode = RFNode<NData>;
export type EData = { e: AEdge; r: Route; src: RouteSrc; mark?: DiffMark };
export type FlowEdge = RFEdge<EData>;

const SIDES: [Side, Position][] = [["top", Position.Top], ["right", Position.Right], ["bottom", Position.Bottom], ["left", Position.Left]];
/** Ports on four sides: hidden until hover / selection (the design shows them on the selected node). */
function Ports() {
  return <>{SIDES.map(([s, p]) => <Handle key={s} id={s} type="source" position={p} className="arch-port" />)}</>;
}

function Name({ id, text, style }: { id: string; text: string; style: React.CSSProperties }) {
  const c = useContext(Ctx);
  const ref = useRef<HTMLInputElement>(null);
  const [v, setV] = useState(text);
  useEffect(() => { if (c.editing === id) { setV(text); setTimeout(() => ref.current?.select(), 0); } }, [c.editing, id, text]);
  if (c.editing !== id) return <span dir="auto" style={style}>{text}</span>;
  return <input ref={ref} dir="auto" className="nodrag" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { c.rename(id, v); c.stopEdit(); }}
    onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") c.stopEdit(); }}
    style={{ ...style, background: "var(--bg)", border: "1px solid var(--accent)", borderRadius: 4, padding: "0 3px", outline: "none", minWidth: 0, width: "100%" }} />;
}

export const ArchNode = memo(function ArchNode({ id, data, selected }: NodeProps<FlowNode>) {
  const c = useContext(Ctx);
  const { n, mark, chip } = data;
  const col = nodeColor(n), ln = n.lumenNode ?? {};
  const on = selected || c.hl === id;
  const st = ln.status ? STATUS[ln.status] : null;
  if (ln.kind === "junction") return <div onMouseEnter={() => c.setHover(id)} onMouseLeave={() => c.setHover(null)} style={{ width: "100%", height: "100%", borderRadius: "50%", background: "var(--learn)", boxShadow: on ? "0 0 0 4px color-mix(in srgb,var(--accent) 22%,transparent)" : "none" }}><Ports /></div>;
  const bg = mark ? `color-mix(in srgb,${DC[mark]} 10%,var(--surface))` : "var(--surface)";
  const bd = mark ? `1.5px ${mark === "del" ? "dashed" : "solid"} ${DC[mark]}` : on ? "1.5px solid var(--accent)" : "1px solid var(--border)";
  const ring = on && !mark ? "0 0 0 4px color-mix(in srgb,var(--accent) 22%,transparent)" : "none";
  const fields = ln.fields;
  return (
    <div onMouseEnter={() => c.setHover(id)} onMouseLeave={() => c.setHover(null)}
      style={{ position: "relative", width: "100%", height: "100%", boxSizing: "border-box", borderRadius: 10, background: bg, border: bd, boxShadow: ring, display: "flex", flexDirection: fields ? "column" : "row", alignItems: fields ? "stretch" : "center", gap: fields ? 0 : 8, padding: fields ? 0 : "0 10px", opacity: mark === "del" ? 0.7 : 1, transition: "box-shadow .12s, border-color .12s" }}>
      {fields ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", height: 38, borderBottom: "1px solid var(--border)" }}>
            <span style={{ width: 24, height: 24, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", background: `color-mix(in srgb,${col} 16%,transparent)`, color: col }}><Glyph name={ln.icon ?? "database"} size={15} /></span>
            <Name id={id} text={displayOf(n)} style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} />
          </div>
          {fields.map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 8, height: 22, alignItems: "center", padding: "0 10px", font: "500 11px 'JetBrains Mono',monospace" }}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span><span style={{ color: "var(--muted)" }}>{f.type}</span>{f.key && <span style={{ color: "var(--accent)", fontSize: 10 }}>{f.key.toUpperCase()}</span>}
            </div>
          ))}
        </>
      ) : (
        <>
          <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: `color-mix(in srgb,${col} 16%,transparent)`, color: col }}><Glyph name={ln.icon ?? "service"} size={18} /></span>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
            <Name id={id} text={displayOf(n)} style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: mark === "del" ? "line-through" : "none" }} />
            {ln.tech && <span dir="auto" style={{ fontSize: 10.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ln.tech}</span>}
          </div>
        </>
      )}
      {st && <span title={t(st[2])} style={{ position: "absolute", right: 6, top: 6, display: "flex" }}><Glyph name={st[0]} size={14} color={st[1]} stroke={2.2} /></span>}
      {chip && !mark && <span style={{ position: "absolute", left: 10, bottom: -10, fontSize: 10, padding: "1px 7px", borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--muted)", whiteSpace: "nowrap" }}>{chip}</span>}
      {ln.zoom && <span title={t("Double-click to open the next C4 level")} style={{ position: "absolute", right: 6, bottom: 4, display: "flex", color: "var(--muted)" }}><Glyph name="c4-level" size={12} /></span>}
      <Ports />
    </div>
  );
});

export const ArchGroup = memo(function ArchGroup({ id, data, selected }: NodeProps<FlowNode>) {
  const c = useContext(Ctx);
  const { n, mark } = data;
  const col = mark ? DC[mark] : groupColor(n), lg = n.lumenGroup;
  const k = [lg?.kind, lg?.sub].filter(Boolean).join(" · ");
  const on = selected || c.hl === id;
  if (lg?.collapsed) {
    // collapsed into a summary node (47A "Collapsed group")
    return (
      <div onMouseEnter={() => c.setHover(id)} onMouseLeave={() => c.setHover(null)} style={{ width: "100%", height: "100%", boxSizing: "border-box", borderRadius: 12, background: `color-mix(in srgb,${col} 10%,var(--surface))`, border: `1.5px dashed ${col}`, display: "flex", alignItems: "center", gap: 6, padding: "0 12px", boxShadow: on ? "0 0 0 4px color-mix(in srgb,var(--accent) 22%,transparent)" : "none" }}>
        <Glyph name={lg.icon ?? lg.kind} size={18} color={col} />
        <Name id={id} text={displayOf(n)} style={{ fontWeight: 600, fontSize: 14, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} />
        <button className="nodrag" onClick={() => c.toggleCollapse(id)} style={{ height: 30, padding: "0 10px", borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)", fontSize: 11.5, whiteSpace: "nowrap" }}>{t("{n} inside ›", { n: c.inside(id) })}</button>
        <Ports />
      </div>
    );
  }
  return (
    <div onMouseEnter={() => c.setHover(id)} onMouseLeave={() => c.setHover(null)} style={{ width: "100%", height: "100%", boxSizing: "border-box", border: `1.5px ${mark === "add" || mark === "chg" ? "solid" : "dashed"} ${col}`, borderRadius: 14, background: `color-mix(in srgb,${col} 5%,transparent)`, boxShadow: on ? "0 0 0 3px color-mix(in srgb,var(--accent) 30%,transparent)" : "none", transition: "box-shadow .12s" }}>
      <span style={{ position: "absolute", left: 12, top: -11, display: "flex", alignItems: "center", gap: 6, padding: "1px 8px", borderRadius: 999, background: "var(--bg)", color: col, fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap" }}>
        <Glyph name={lg?.icon ?? lg?.kind ?? "region"} size={14} />
        <Name id={id} text={displayOf(n)} style={{}} />
        <span style={{ color: "var(--muted)", fontWeight: 400 }}>{k}</span>
        <button className="nodrag" aria-label={t("Collapse group")} title={t("Collapse into a summary node")} onClick={() => c.toggleCollapse(id)} style={{ display: "flex", color: "var(--muted)", marginInlineStart: 2 }}><Glyph name="chevron-down" size={12} /></button>
      </span>
    </div>
  );
});

export const ArchGhost = memo(function ArchGhost() {
  return <div style={{ width: "100%", height: "100%", border: "1.5px dashed var(--accent)", borderRadius: 10, background: "color-mix(in srgb,var(--accent) 6%,transparent)", pointerEvents: "none", animation: "arch-ghost .2s var(--ease)" }} />;
});

export const nodeTypes = { arch: ArchNode, archGroup: ArchGroup, archGhost: ArchGhost };
export const edgeTypes = { arch: ArchEdge };
export const FLOW_CSS = `
.arch-flow .react-flow__node { font-family: Inter, 'IBM Plex Sans Arabic', system-ui, sans-serif; color: var(--text); }
.arch-flow .react-flow__node-archGroup { z-index: -1 !important; }
.arch-flow .react-flow__edgelabel-renderer { z-index: 3000; }
.arch-flow .arch-port { width: 9px; height: 9px; min-width: 0; min-height: 0; border-radius: 50%; background: var(--bg); border: 2px solid var(--accent); opacity: 0; transition: opacity .12s; }
.arch-flow .react-flow__node.selected .arch-port, .arch-flow .react-flow__node:hover .arch-port, .arch-flow.connecting .arch-port { opacity: 1; }
.arch-flow .arch-port.connectingto, .arch-flow .arch-port.valid { opacity: 1; transform: scale(1.5); background: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb,var(--accent) 25%,transparent); }
.arch-flow .react-flow__node-archGroup .arch-port { opacity: 0; pointer-events: none; }
.arch-flow .react-flow__minimap { border-radius: 10px; border: 1px solid var(--border); background: var(--surface); overflow: hidden; }
.arch-flow .react-flow__connectionline path { stroke: var(--accent); stroke-width: 1.6; }
@keyframes arch-ghost { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
@keyframes arch-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@keyframes arch-sheet { from { transform: translateY(100%); } to { transform: none; } }
@keyframes arch-slide { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
`;
