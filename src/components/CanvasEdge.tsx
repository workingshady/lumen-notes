// Edges of the JSON Canvas board: straight / elbow / curved paths with the board's heads and label, plus what React
// Flow's built-in edges lack: visible end handles on the selected edge that reconnect with mouse, pen or touch, and the
// label edited in place (double-click, Enter or F2).
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, useReactFlow, useStore, type EdgeProps } from "@xyflow/react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Side } from "../../shared/types";
import { t } from "../lib/i18n";

export interface CanvasEdgeApi {
  /** Move one end of edge `id` onto `node` (pinned to `side`, or automatic). One undo step. */
  reconnect: (id: string, end: "source" | "target", node: string, side?: Side) => void;
  /** The edge whose label is being edited in place, and the setter / commit. */
  editing: string | null;
  setEditing: (id: string | null) => void;
  saveLabel: (id: string, text: string) => void;
}
export const CanvasEdgeCtx = createContext<CanvasEdgeApi>({ reconnect: () => {}, editing: null, setEditing: () => {}, saveLabel: () => {} });

/** Node (and its nearest side) under a screen point: a port first, then the card body. */
export function canvasNodeAt(x: number, y: number): { id: string; side: Side } | null {
  const els = document.elementsFromPoint(x, y);
  const h = els.map((el) => el.closest<HTMLElement>(".react-flow__handle")).find(Boolean);
  if (h?.dataset.nodeid && h.dataset.handleid) return { id: h.dataset.nodeid, side: h.dataset.handleid as Side };
  const n = els.map((el) => el.closest<HTMLElement>(".react-flow__node")).find((e) => e && !e.classList.contains("react-flow__node-group")) ?? els.map((el) => el.closest<HTMLElement>(".react-flow__node")).find(Boolean);
  if (!n?.dataset.id) return null;
  const r = n.getBoundingClientRect();
  const d: [Side, number][] = [["left", x - r.left], ["right", r.right - x], ["top", y - r.top], ["bottom", r.bottom - y]];
  return { id: n.dataset.id, side: d.sort((a, b) => a[1] - b[1])[0][0] };
}

type Kind = "straight" | "step" | "curved";
function makeEdge(kind: Kind) {
  return function CanvasEdge(p: EdgeProps) {
    const api = useContext(CanvasEdgeCtx), rf = useReactFlow();
    const zoom = useStore((s) => s.transform[2]);
    const [drag, setDrag] = useState<{ end: "source" | "target"; x: number; y: number } | null>(null);
    const args = { sourceX: p.sourceX, sourceY: p.sourceY, targetX: p.targetX, targetY: p.targetY, sourcePosition: p.sourcePosition, targetPosition: p.targetPosition };
    const [path, lx, ly] = kind === "straight" ? getStraightPath(args) : kind === "step" ? getSmoothStepPath({ ...args, borderRadius: 8 }) : getBezierPath(args);
    const editing = api.editing === p.id;
    const startEnd = (ev: React.PointerEvent, end: "source" | "target") => {
      if (ev.button !== 0) return;
      ev.stopPropagation(); ev.preventDefault();
      const root = (ev.currentTarget as Element).closest(".lumen-canvas");
      root?.classList.add("connecting");
      const mv = (m: PointerEvent) => { const f = rf.screenToFlowPosition({ x: m.clientX, y: m.clientY }); setDrag({ end, x: f.x, y: f.y }); };
      const done = (m: PointerEvent | null) => {
        removeEventListener("pointermove", mv); removeEventListener("pointerup", up); removeEventListener("pointercancel", cancel);
        root?.classList.remove("connecting"); setDrag(null);
        const hit = m && canvasNodeAt(m.clientX, m.clientY);
        if (hit) api.reconnect(p.id, end, hit.id, hit.side);
      };
      const up = (m: PointerEvent) => done(m), cancel = () => done(null);
      addEventListener("pointermove", mv); addEventListener("pointerup", up); addEventListener("pointercancel", cancel);
    };
    const fixed = drag ? (drag.end === "source" ? { x: p.targetX, y: p.targetY } : { x: p.sourceX, y: p.sourceY }) : null;
    const label = typeof p.label === "string" || typeof p.label === "number" ? String(p.label) : "";
    return (
      <>
        <BaseEdge id={p.id} path={path} markerEnd={p.markerEnd} markerStart={p.markerStart} style={p.style} interactionWidth={Math.max(20, 16 / zoom)}
          label={editing ? undefined : p.label} labelX={lx} labelY={ly} labelStyle={p.labelStyle} labelShowBg={p.labelShowBg} labelBgStyle={p.labelBgStyle} labelBgPadding={p.labelBgPadding} labelBgBorderRadius={p.labelBgBorderRadius} />
        {p.selected && <path d={path} style={{ fill: "none", stroke: "var(--accent)", strokeOpacity: 0.3, strokeWidth: 7, pointerEvents: "none" }} />}
        {fixed && drag && <path d={`M${fixed.x} ${fixed.y} L${drag.x} ${drag.y}`} style={{ fill: "none", stroke: "var(--accent)", strokeWidth: 1.6 / zoom, strokeDasharray: `${5 / zoom} ${4 / zoom}`, pointerEvents: "none" }} />}
        {(p.selected || editing) && (
          <EdgeLabelRenderer>
            {p.selected && !drag && ([["source", p.sourceX, p.sourceY], ["target", p.targetX, p.targetY]] as const).map(([end, x, y]) => (
              <div key={end} className="nodrag nopan cv-edge-end" data-end={end} title={t("Drag onto a card to reconnect")} onPointerDown={(ev) => startEnd(ev, end)}
                style={{ position: "absolute", left: 0, top: 0, width: 14, height: 14, transform: `translate(${x}px,${y}px) translate(-50%,-50%) scale(${1 / zoom})`, borderRadius: "50%", background: "var(--accent)", border: "2px solid var(--bg)", boxSizing: "border-box", pointerEvents: "all", cursor: "crosshair", touchAction: "none", zIndex: 5 }} />
            ))}
            {editing && <LabelInput x={lx} y={ly} value={label} onDone={(v) => { if (v !== null) api.saveLabel(p.id, v); api.setEditing(null); }} />}
          </EdgeLabelRenderer>
        )}
      </>
    );
  };
}
function LabelInput({ x, y, value, onDone }: { x: number; y: number; value: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(value);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (x: string | null) => { if (done.current) return; done.current = true; onDone(x); };
  return (
    <input ref={ref} dir="auto" className="nodrag nopan" value={v} size={Math.max(8, v.length + 1)} placeholder={t("Label")} onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(v)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") finish(v); if (e.key === "Escape") finish(null); }}
      style={{ position: "absolute", left: 0, top: 0, transform: `translate(${x}px,${y}px) translate(-50%,-50%)`, pointerEvents: "all", font: "500 11.5px Inter, system-ui, sans-serif", color: "var(--text)", background: "var(--bg)", border: "1px solid var(--accent)", borderRadius: 6, padding: "2px 6px", outline: "none", boxShadow: "0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)" }} />
  );
}
export const canvasEdgeTypes = { cvStraight: makeEdge("straight"), cvStep: makeEdge("step"), cvCurved: makeEdge("curved") };
