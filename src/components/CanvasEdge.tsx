// Edges of the JSON Canvas board: straight / elbow / curved paths with the board's heads and label, plus what React
// Flow's built-in edges lack: visible end handles on the selected edge that reconnect with mouse, pen or touch, and the
// label edited in place (double-click, Enter or F2); bend points (`lumenPoints`: drag the line anywhere to add one, drag a
// dot to move it, double-click it to remove it) and a label moved along the line by its grip (`lumenLabelPos`, 0…1).
// Both are lumen* keys, so the file stays plain JSON Canvas; each drag is one undo step on release.
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, useReactFlow, useStore, type EdgeProps } from "@xyflow/react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { CanvasEdge, Side } from "../../shared/types";
import { t } from "../lib/i18n";

export interface CanvasEdgeApi {
  /** Move one end of edge `id` onto `node` (pinned to `side`, or automatic). One undo step. */
  reconnect: (id: string, end: "source" | "target", node: string, side?: Side) => void;
  /** The edge whose label is being edited in place, and the setter / commit. */
  editing: string | null;
  setEditing: (id: string | null) => void;
  saveLabel: (id: string, text: string) => void;
  /** Change the stored edge (bend points, label position). One undo step. */
  patch: (id: string, fn: (e: CanvasEdge) => CanvasEdge) => void;
  /** Select only this edge. */
  select: (id: string) => void;
}
export const CanvasEdgeCtx = createContext<CanvasEdgeApi>({ reconnect: () => {}, editing: null, setEditing: () => {}, saveLabel: () => {}, patch: () => {}, select: () => {} });

type Pt = { x: number; y: number };
export type RoutedEdge = CanvasEdge & { lumenPoints?: Pt[]; lumenLabelPos?: number };
/** Smooth curve through the points (Catmull-Rom as cubic Béziers). */
function smoothPath(p: Pt[]) {
  let d = `M${p[0].x} ${p[0].y}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] ?? p[i], b = p[i], c = p[i + 1], e = p[i + 2] ?? c;
    d += ` C${b.x + (c.x - a.x) / 6} ${b.y + (c.y - a.y) / 6} ${c.x - (e.x - b.x) / 6} ${c.y - (e.y - b.y) / 6} ${c.x} ${c.y}`;
  }
  return d;
}
let probe: SVGPathElement | null = null;
const probeFor = (d: string) => { probe ??= document.createElementNS("http://www.w3.org/2000/svg", "path"); probe.setAttribute("d", d); return probe; };
/** Point at fraction `t` of an SVG path's length (a detached path measures the same as the drawn one). */
function pathAt(d: string, t: number): Pt {
  const pr = probeFor(d), len = pr.getTotalLength(), q = pr.getPointAtLength(Math.max(0, Math.min(1, t)) * len);
  return { x: q.x, y: q.y };
}
/** Fraction along the path nearest to a flow point (sampled, then refined). */
function nearestOnPath(d: string, f: Pt) {
  const pr = probeFor(d), len = pr.getTotalLength() || 1, N = 60;
  const dist = (c: number) => { const q = pr.getPointAtLength(c * len); return (q.x - f.x) ** 2 + (q.y - f.y) ** 2; };
  let best = 0, bd = Infinity;
  for (let i = 0; i <= N; i++) { const dd = dist(i / N); if (dd < bd) { bd = dd; best = i / N; } }
  for (let step = 1 / N / 2; step > 1e-4; step /= 2) for (const c of [best - step, best + step]) { if (c < 0 || c > 1) continue; const dd = dist(c); if (dd < bd) { bd = dd; best = c; } }
  return best;
}
/** Index of the segment of `poly` nearest to `f`. */
function nearestSeg(poly: Pt[], f: Pt) {
  let best = 0, bd = Infinity;
  for (let j = 1; j < poly.length; j++) {
    const a = poly[j - 1], b = poly[j], l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const u = l2 ? Math.max(0, Math.min(1, ((f.x - a.x) * (b.x - a.x) + (f.y - a.y) * (b.y - a.y)) / l2)) : 0;
    const dd = Math.hypot(a.x + (b.x - a.x) * u - f.x, a.y + (b.y - a.y) * u - f.y);
    if (dd < bd) { bd = dd; best = j - 1; }
  }
  return best;
}
let lastDown = { key: "", at: 0 };
/** A handle on the selected edge: 22 px hit area (touch) around the dot, the same size on screen at any zoom. */
const dotBox = (x: number, y: number, k: number): React.CSSProperties => ({ position: "absolute", left: 0, top: 0, width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", transform: `translate(${x}px,${y}px) translate(-50%,-50%) scale(${k})`, pointerEvents: "all", touchAction: "none", zIndex: 4 });

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
/** Zoom rounded to quarter-octave steps (and flat from 0.8 up, where the hit width stops depending on it). */
const zoomStep = (z: number) => (z >= 0.8 ? 0.8 : 2 ** (Math.round(Math.log2(z) * 4) / 4));
function makeEdge(kind: Kind) {
  return function CanvasEdge(p: EdgeProps) {
    const api = useContext(CanvasEdgeCtx), rf = useReactFlow();
    const [drag, setDrag] = useState<{ end: "source" | "target"; x: number; y: number } | null>(null);
    // Perf: an idle edge only needs the zoom for its hit width, so it reads a coarse step (no re-render per zoom frame
    // on boards with hundreds of edges); the selected / dragged edge reads the exact zoom for its handles.
    const exact = !!p.selected || !!drag;
    const zoom = useStore(useCallback((s: { transform: [number, number, number] }) => (exact ? s.transform[2] : zoomStep(s.transform[2])), [exact]));
    const args = { sourceX: p.sourceX, sourceY: p.sourceY, targetX: p.targetX, targetY: p.targetY, sourcePosition: p.sourcePosition, targetPosition: p.targetPosition };
    const ed = (p.data?.edge ?? {}) as RoutedEdge;
    const [draft, setDraft] = useState<Pt[] | null>(null);
    const [lblT, setLblT] = useState<number | null>(null);
    const pts = draft ?? (Array.isArray(ed.lumenPoints) && ed.lumenPoints.length ? ed.lumenPoints : null);
    const S = { x: p.sourceX, y: p.sourceY }, T = { x: p.targetX, y: p.targetY };
    const poly = pts ? [S, ...pts, T] : null;
    const auto = kind === "straight" ? getStraightPath(args) : kind === "step" ? getSmoothStepPath({ ...args, borderRadius: 8 }) : getBezierPath(args);
    const path = poly ? (kind === "curved" ? smoothPath(poly) : `M${poly.map((q) => `${q.x} ${q.y}`).join(" L")}`) : auto[0];
    const tLab = lblT ?? (typeof ed.lumenLabelPos === "number" ? ed.lumenLabelPos : null);
    const at = tLab != null || poly ? pathAt(path, tLab ?? 0.5) : null;
    const lx = at ? at.x : auto[1], ly = at ? at.y : auto[2];
    const k = 1 / zoom;
    const editing = api.editing === p.id;
    /** Press on the line (or its label) and drag: a new bend point at the nearest segment follows the pointer; on release = one step, edge selected. */
    const lineDrag = (ev: React.PointerEvent, onTap?: () => void) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      const base = poly ?? [S, T], f0 = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const j = nearestSeg(base, f0), x0 = ev.clientX, y0 = ev.clientY;
      let last: Pt[] | null = null;
      const mv = (m: PointerEvent) => {
        if (!last && Math.hypot(m.clientX - x0, m.clientY - y0) < 5) return;
        const q = rf.screenToFlowPosition({ x: m.clientX, y: m.clientY });
        const inner = base.slice(1, -1);
        inner.splice(j, 0, { x: Math.round(q.x), y: Math.round(q.y) });
        setDraft((last = inner));
      };
      const up = () => {
        removeEventListener("pointermove", mv); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
        setDraft(null);
        if (last) { const v = last; api.patch(p.id, (e) => ({ ...e, lumenPoints: v } as RoutedEdge)); api.select(p.id); } else onTap?.();
      };
      addEventListener("pointermove", mv); addEventListener("pointerup", up); addEventListener("pointercancel", up);
    };
    /** Drag a bend point (a double press removes it). */
    const pointDrag = (ev: React.PointerEvent, i: number) => {
      if (ev.button !== 0 || !pts) return;
      ev.stopPropagation(); ev.preventDefault();
      const now = Date.now(), key = `${p.id}:${i}`;
      if (lastDown.key === key && now - lastDown.at < 380) {
        lastDown = { key: "", at: 0 };
        const rest = pts.filter((_, n) => n !== i);
        api.patch(p.id, (e) => { const o = { ...e, lumenPoints: rest } as RoutedEdge; if (!rest.length) delete o.lumenPoints; return o; });
        return;
      }
      lastDown = { key, at: now };
      let last: Pt[] | null = null;
      const mv = (m: PointerEvent) => { const q = rf.screenToFlowPosition({ x: m.clientX, y: m.clientY }); setDraft((last = pts.map((o, n) => (n === i ? { x: Math.round(q.x), y: Math.round(q.y) } : o)))); };
      const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); setDraft(null); if (last) { const v = last; api.patch(p.id, (e) => ({ ...e, lumenPoints: v } as RoutedEdge)); } };
      addEventListener("pointermove", mv); addEventListener("pointerup", up); addEventListener("pointercancel", up);
    };
    /** The label: press + drag bends the line, its grip (selected edge) slides it along, a click selects, a double press edits. */
    const labelDown = (ev: React.PointerEvent) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      const now = Date.now(), key = `lbl:${p.id}`;
      if (lastDown.key === key && now - lastDown.at < 380) { lastDown = { key: "", at: 0 }; setTimeout(() => api.setEditing(p.id), 30); return; }
      lastDown = { key, at: now };
      if (!(ev.target as Element).closest?.("[data-grip]")) { lineDrag(ev, () => api.select(p.id)); return; }
      ev.preventDefault();
      let last: number | null = null;
      const mv = (m: PointerEvent) => { setLblT((last = nearestOnPath(path, rf.screenToFlowPosition({ x: m.clientX, y: m.clientY })))); };
      const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); setLblT(null); if (last != null) { const v = Math.round(last * 1000) / 1000; api.patch(p.id, (e) => ({ ...e, lumenLabelPos: v } as RoutedEdge)); } };
      addEventListener("pointermove", mv); addEventListener("pointerup", up); addEventListener("pointercancel", up);
    };
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
        <BaseEdge id={p.id} path={path} markerEnd={p.markerEnd} markerStart={p.markerStart} style={p.style} interactionWidth={0} />
        {/* wide invisible hit area (mouse and touch): a click selects (React Flow), press + drag adds a bend */}
        <path className="cv-edge-hit nopan" d={path} onPointerDown={(ev) => lineDrag(ev)} style={{ fill: "none", stroke: "transparent", strokeWidth: Math.max(20, 16 * k), pointerEvents: "stroke", cursor: p.selected ? "move" : "pointer" }} />
        {p.selected && <path d={path} style={{ fill: "none", stroke: "var(--accent)", strokeOpacity: 0.3, strokeWidth: 7, pointerEvents: "none" }} />}
        {fixed && drag && <path d={`M${fixed.x} ${fixed.y} L${drag.x} ${drag.y}`} style={{ fill: "none", stroke: "var(--accent)", strokeWidth: 1.6 / zoom, strokeDasharray: `${5 / zoom} ${4 / zoom}`, pointerEvents: "none" }} />}
        {label && !editing && (
          <EdgeLabelRenderer>
            <span className="nodrag nopan cv-edge-label" data-edge-label={p.id} onPointerDown={labelDown}
              style={{ position: "absolute", left: 0, top: 0, transform: `translate(${lx}px,${ly}px) translate(-50%,-50%)`, pointerEvents: "all", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", font: "400 11.5px Inter, system-ui, sans-serif", color: "var(--muted)", ...(p.labelShowBg ? { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "2px 8px" } : { padding: "2px 4px" }) }}>
              {p.selected && <span data-grip title={t("Drag to move the label along the line")} style={{ width: 8, height: 12, margin: "0 -1px 0 -4px", cursor: "grab", opacity: 0.8, backgroundImage: "radial-gradient(currentColor 1px, transparent 1.3px)", backgroundSize: "4px 4px" }} />}
              <span dir="auto">{label}</span>
            </span>
          </EdgeLabelRenderer>
        )}
        {(p.selected || editing) && (
          <EdgeLabelRenderer>
            {p.selected && !drag && (pts ?? []).map((q, i) => (
              <div key={`p${i}`} className="nodrag nopan cv-edge-dot" data-point={i} title={t("Drag to move · double-click to remove")} onPointerDown={(ev) => pointDrag(ev, i)} style={{ ...dotBox(q.x, q.y, k), cursor: "move" }}>
                <span style={{ width: 11, height: 11, borderRadius: "50%", background: "var(--bg)", border: "2px solid var(--accent)", boxSizing: "border-box" }} />
              </div>
            ))}
            {p.selected && !drag && (poly ?? [S, T]).slice(1).map((b, j, arr) => {
              // one "add a bend" dot per segment, a quarter of the way along (clear of the label); it drags like the line
              const base = poly ?? [S, T], a = base[j];
              if (arr.length > 1 && Math.hypot(b.x - a.x, b.y - a.y) * zoom < 30) return null;
              const q = poly || kind === "straight" ? { x: a.x + (b.x - a.x) * 0.25, y: a.y + (b.y - a.y) * 0.25 } : pathAt(path, 0.25);
              return (
                <div key={`m${j}`} className="nodrag nopan cv-edge-dot" data-seg={j} title={t("Drag to add a bend")} onPointerDown={(ev) => lineDrag(ev)} style={{ ...dotBox(q.x, q.y, k), cursor: "copy" }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: "color-mix(in srgb,var(--accent) 30%,var(--bg))", border: "1.2px solid var(--accent)", boxSizing: "border-box" }} />
                </div>
              );
            })}
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
