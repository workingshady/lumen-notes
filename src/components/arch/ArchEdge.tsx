// Edge of the architecture board (46C / 46N / 47A–B): the route with the design's arrowheads, bend-point handles on the
// selected edge (drag a segment midpoint to add a point, drag points, double-click a point to remove it; right-angle
// routes stay right-angled), draggable / editable labels (start · middle · end), style, placement and the protocol chip.
import { BaseEdge, EdgeLabelRenderer, useReactFlow, useStore, type EdgeProps } from "@xyflow/react";
import { memo, useContext, useEffect, useRef, useState } from "react";
import { t } from "../../lib/i18n";
import { EDGE_STYLE, type AEdge } from "../../lib/arch-model";
import { interiorOf, movePoint, nearestT, route, slideSegment, splitSegment, startsHorizontal, type Pt } from "../../lib/arch-route";
import { chipOf, labelLook, labelSpot, labelSpots, lblStyle, type LabelPart } from "../../lib/arch-label";
import { Ctx, DC, type FlowEdge } from "./ArchFlow";
import type { DiffMark } from "../../lib/arch-model";

let lastDown = { key: "", at: 0 };
type Spot = { part: LabelPart; text: string; x: number; y: number; angle: number };

/** One text label: drag along the line (middle), click for options, double-click to edit in place. */
function EdgeText({ id, e, spot, mark, chip, ro, ptsRef, onDrag }: { id: string; e: AEdge; spot: Spot; mark?: DiffMark; chip: string; ro: boolean; ptsRef: React.RefObject<Pt[]>; onDrag: (t: number | null, commit?: boolean) => void }) {
  const c = useContext(Ctx), rf = useReactFlow();
  const look = labelLook(lblStyle(e));
  const editing = c.editEdge?.id === id && c.editEdge.part === spot.part;
  const [v, setV] = useState(spot.text);
  const esc = useRef(false);
  useEffect(() => { if (editing) { setV(spot.text); esc.current = false; } }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const tf = `translate(-50%,-50%) translate(${spot.x}px,${spot.y}px)${spot.angle ? ` rotate(${spot.angle}deg)` : ""}`;
  const down = (ev: React.PointerEvent) => {
    if (ev.button !== 0 || editing) return;
    ev.stopPropagation();
    // the board re-renders on the first click, so detect the double-click here instead of relying on the dblclick event
    const now = Date.now(), key = id + spot.part;
    if (!ro && lastDown.key === key && now - lastDown.at < 380) { lastDown = { key: "", at: 0 }; setTimeout(() => c.setEditEdge({ id, part: spot.part }), 30); return; }
    lastDown = { key, at: now };
    const x0 = ev.clientX, y0 = ev.clientY;
    let moved = false, last: number | null = null;
    const mv = (m: PointerEvent) => {
      if (!moved && Math.hypot(m.clientX - x0, m.clientY - y0) < 4) return;
      if (ro || spot.part !== "mid") return;
      moved = true;
      onDrag((last = nearestT(ptsRef.current!, rf.screenToFlowPosition({ x: m.clientX, y: m.clientY }))));
    };
    const up = () => {
      window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up);
      if (moved && last != null) onDrag(last, true); else { onDrag(null); c.labelClick(id); }
    };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };
  const colr = mark ? DC[mark] : look.color;
  const box: React.CSSProperties = { position: "absolute", transform: tf, font: `${look.fw} ${look.fs}px 'JetBrains Mono',monospace`, color: colr, background: look.bg, border: look.border, padding: look.pad, borderRadius: look.radius, whiteSpace: "nowrap", textDecoration: mark === "del" ? "line-through" : "none", pointerEvents: "all", display: "flex", alignItems: "center", gap: 6, cursor: ro ? "default" : spot.part === "mid" ? "grab" : "pointer" };
  if (editing) {
    const done = (save: boolean) => { if (save) c.saveLabel(id, spot.part, v); c.setEditEdge(null); };
    return (
      <div className="nodrag nopan" style={{ ...box, cursor: "text", border: "1px solid var(--accent)", background: "var(--bg)", boxShadow: "0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)" }}>
        <input autoFocus dir="auto" value={v} size={Math.max(8, v.length + 1)} placeholder={spot.part === "mid" ? "HTTPS · 443" : spot.part === "start" ? t("Start label") : t("End label")} onChange={(x) => setV(x.target.value)} onFocus={(x) => x.target.select()}
          onBlur={() => { if (!esc.current) done(true); }}
          onKeyDown={(k) => { k.stopPropagation(); if (k.key === "Enter") { esc.current = true; done(true); } if (k.key === "Escape") { esc.current = true; done(false); } }}
          style={{ font: "inherit", color: "var(--text)", background: "transparent", outline: "none", border: 0, padding: 0, minWidth: 40 }} />
      </div>
    );
  }
  return (
    <span className="nodrag nopan" data-edge-label={id} data-part={spot.part} onPointerDown={down} onDoubleClick={(x) => { x.stopPropagation(); }} style={box}>
      {spot.text && <span dir="auto">{spot.text}</span>}
      {spot.part === "mid" && chip && <span style={{ fontSize: Math.max(9, look.fs - 1), padding: "0 6px", borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--muted)", fontWeight: 500 }}>{chip}</span>}
    </span>
  );
}

export const ArchEdge = memo(function ArchEdge({ id, data, selected }: EdgeProps<FlowEdge>) {
  const c = useContext(Ctx), rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const [draft, setDraft] = useState<Pt[] | null>(null);
  const [lblT, setLblT] = useState<number | null>(null);
  const ptsRef = useRef<Pt[]>([]);
  if (!data) return null;
  const { e, src, mark } = data;
  const [ec, da] = EDGE_STYLE[e.lumenEdge?.style ?? "sync"];
  const col = mark ? DC[mark as DiffMark] : selected ? "var(--accent)" : ec;
  const dash = mark === "del" ? "5 4" : da;
  const r = draft ? route(src.p, src.ps, src.q, src.qs, src.shape, src.ends, draft, true) : data.r;
  ptsRef.current = r.pts;
  const ortho = src.shape === "orthogonal";
  const edit = !!selected && !c.ro && !mark;
  const eShown: AEdge = lblT == null ? e : { ...e, lumenEdge: { ...e.lumenEdge, labelPos: lblT } };
  const spots = labelSpots(eShown, r);
  const ed = c.editEdge?.id === id ? c.editEdge.part : null;
  if (ed && !spots.some((x) => x.part === ed)) spots.push(labelSpot(eShown, r, ed, ""));
  const chip = chipOf(e);
  const store = (pts: Pt[]) => c.patchEdge(id, (x) => { const { pointsKey: _k, ...le } = x.lumenEdge ?? {}; return { ...x, lumenEdge: { ...le, manual: true, points: pts } }; });

  /** Drag a bend point, or a segment midpoint (adds a point / slides the segment); one undo step on release. */
  const drag = (ev: React.PointerEvent, kind: "pt" | "seg", i: number) => {
    if (ev.button !== 0) return;
    ev.stopPropagation(); ev.preventDefault();
    let base = r.poly, idx = i, seg = false;
    if (kind === "seg") { const sp = splitSegment(base, i, ortho); base = sp.pts; idx = sp.idx; seg = sp.seg; }
    let last: Pt[] | null = null;
    const mv = (m: PointerEvent) => {
      const pos = rf.screenToFlowPosition({ x: m.clientX, y: m.clientY });
      const to = { x: Math.round(pos.x), y: Math.round(pos.y) };
      last = interiorOf(seg ? slideSegment(base, idx, to) : movePoint(base, idx, to, ortho), ortho, startsHorizontal(src.ps));
      setDraft(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up);
      const pts = last;
      setDraft(null);
      if (pts) store(pts);
    };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };
  const k = 1 / zoom;
  return (
    <>
      <BaseEdge id={id} path={r.d} interactionWidth={14} style={{ fill: "none", stroke: col, strokeWidth: mark ? 2.2 : selected ? 2.2 : 1.6, strokeDasharray: dash === "none" ? undefined : dash, strokeLinejoin: "round" }} />
      {r.heads.map((h, i) => <path key={i} d={h} style={{ fill: col, stroke: "none" }} />)}
      {edit && (
        <g className="nopan nodrag">
          {[r.poly[0], r.poly[r.poly.length - 1]].map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4.5 * k} style={{ fill: "var(--accent)", stroke: "var(--bg)", strokeWidth: 1.5 * k, pointerEvents: "none" }} />)}
          {r.poly.slice(1).map((b, j) => {
            const a = r.poly[j];
            if (Math.hypot(b.x - a.x, b.y - a.y) * zoom < 30) return null;
            const horiz = Math.abs(b.y - a.y) < 0.75, vert = Math.abs(b.x - a.x) < 0.75;
            return (
              <circle key={`m${j}`} cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r={3.5 * k} onPointerDown={(ev) => drag(ev, "seg", j)}
                style={{ fill: "color-mix(in srgb,var(--accent) 30%,var(--bg))", stroke: "var(--accent)", strokeWidth: 1.2 * k, pointerEvents: "all", cursor: ortho ? (horiz ? "ns-resize" : vert ? "ew-resize" : "copy") : "copy" }}>
                <title>{ortho ? t("Drag to move this segment") : t("Drag to add a bend")}</title>
              </circle>
            );
          })}
          {r.poly.slice(1, -1).map((p, j) => (
            <circle key={`p${j}`} cx={p.x} cy={p.y} r={5.5 * k} onPointerDown={(ev) => drag(ev, "pt", j + 1)}
              onDoubleClick={(ev) => { ev.stopPropagation(); store(interiorOf(r.poly.filter((_, n) => n !== j + 1), ortho, startsHorizontal(src.ps))); }}
              style={{ fill: "var(--bg)", stroke: "var(--accent)", strokeWidth: 2 * k, pointerEvents: "all", cursor: "move" }}>
              <title>{t("Drag to move · double-click to remove")}</title>
            </circle>
          ))}
        </g>
      )}
      {spots.length > 0 && (
        <EdgeLabelRenderer>
          {spots.map((sp) => (
            <EdgeText key={sp.part} id={id} e={eShown} spot={sp} mark={mark} chip={chip} ro={c.ro || !!mark} ptsRef={ptsRef}
              onDrag={(tt, commit) => { setLblT(tt); if (commit && tt != null) { c.patchEdge(id, (x) => ({ ...x, lumenEdge: { ...x.lumenEdge, labelPos: Math.round(tt * 1000) / 1000 } })); setLblT(null); } }} />
          ))}
        </EdgeLabelRenderer>
      )}
    </>
  );
});
