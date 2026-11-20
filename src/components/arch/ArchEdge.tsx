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
  const [recon, setRecon] = useState<{ end: "source" | "target"; pt: Pt } | null>(null);
  const ptsRef = useRef<Pt[]>([]);
  if (!data) return null;
  const { e, src, mark } = data;
  const [ec, da] = EDGE_STYLE[e.lumenEdge?.style ?? "sync"];
  // the line keeps its connection colour when selected (so style changes show at once); a soft accent halo marks the selection
  const col = mark ? DC[mark as DiffMark] : ec;
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

  /** Drag a bend point, or a segment midpoint (adds a point / slides the segment); one undo step on release.
   * `slop` > 0: nothing happens until the pointer has moved that far (pressing the line itself: a click still selects). */
  const drag = (ev: React.PointerEvent, kind: "pt" | "seg", i: number, slop = 0) => {
    if (ev.button !== 0 || c.ro || mark) return;
    ev.stopPropagation(); if (!slop) ev.preventDefault();
    let base = r.poly, idx = i, seg = false;
    if (kind === "seg") { const sp = splitSegment(base, i, ortho); base = sp.pts; idx = sp.idx; seg = sp.seg; }
    let last: Pt[] | null = null, live = !slop;
    const x0 = ev.clientX, y0 = ev.clientY;
    const mv = (m: PointerEvent) => {
      if (!live) { if (Math.hypot(m.clientX - x0, m.clientY - y0) < slop) return; live = true; c.selectEdge?.(id); }
      const pos = rf.screenToFlowPosition({ x: m.clientX, y: m.clientY });
      const to = { x: Math.round(pos.x), y: Math.round(pos.y) };
      last = interiorOf(seg ? slideSegment(base, idx, to) : movePoint(base, idx, to, ortho), ortho, startsHorizontal(src.ps));
      setDraft(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      const pts = last;
      setDraft(null);
      if (pts) store(pts);
    };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  };
  /** Press anywhere on the line and drag: bends it at the nearest segment (selects the edge first). */
  const dragLine = (ev: React.PointerEvent) => {
    if (ev.button !== 0 || c.ro || mark) return;
    const f = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
    let best = 0, bd = Infinity;
    for (let j = 1; j < r.poly.length; j++) {
      const a = r.poly[j - 1], b = r.poly[j], l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      const u = l2 ? Math.max(0, Math.min(1, ((f.x - a.x) * (b.x - a.x) + (f.y - a.y) * (b.y - a.y)) / l2)) : 0;
      const dd = Math.hypot(a.x + (b.x - a.x) * u - f.x, a.y + (b.y - a.y) * u - f.y);
      if (dd < bd) { bd = dd; best = j - 1; }
    }
    drag(ev, "seg", best, 5);
  };
  /** Drag an end handle onto another node (or another side of the same one) to reconnect; mouse, pen and touch. */
  const dragEnd = (ev: React.PointerEvent, end: "source" | "target") => {
    if (ev.button !== 0 || c.ro || mark) return;
    ev.stopPropagation(); ev.preventDefault();
    const root = (ev.currentTarget as Element).closest(".arch-flow");
    root?.classList.add("connecting");
    const mv = (m: PointerEvent) => setRecon({ end, pt: rf.screenToFlowPosition({ x: m.clientX, y: m.clientY }) });
    const up = (m: PointerEvent) => {
      window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel);
      root?.classList.remove("connecting");
      setRecon(null);
      const hit = c.nodeAt?.(m.clientX, m.clientY);
      if (hit) c.reconnect?.(id, end, hit.id, hit.side);
    };
    const cancel = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); root?.classList.remove("connecting"); setRecon(null); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel);
  };
  const k = 1 / zoom;
  return (
    <>
      {recon && <path d={`M${(recon.end === "source" ? r.poly[r.poly.length - 1] : r.poly[0]).x} ${(recon.end === "source" ? r.poly[r.poly.length - 1] : r.poly[0]).y} L${recon.pt.x} ${recon.pt.y}`} style={{ fill: "none", stroke: "var(--accent)", strokeWidth: 1.6 * k, strokeDasharray: `${5 * k} ${4 * k}` }} />}
      {selected && !mark && <path d={r.d} style={{ fill: "none", stroke: "var(--accent)", strokeOpacity: 0.28, strokeWidth: 7 * Math.max(1, k * 0.6), strokeLinejoin: "round", strokeLinecap: "round", pointerEvents: "none" }} />}
      <BaseEdge id={id} path={r.d} interactionWidth={0} style={{ fill: "none", stroke: col, strokeWidth: mark ? 2.2 : selected ? 2.2 : 1.6, strokeDasharray: dash === "none" ? undefined : dash, strokeLinejoin: "round" }} />
      {r.heads.map((h, i) => <path key={i} d={h} style={{ fill: col, stroke: "none" }} />)}
      {/* wide invisible hit area: click selects (React Flow's edge click), press + drag bends the line */}
      {!mark && <path className="arch-edge-hit nopan" d={r.d} style={{ strokeWidth: Math.max(14, 16 * k) }} onPointerDown={dragLine} />}
      {edit && (
        <g className="nopan nodrag">
          {r.poly.slice(1).map((b, j) => {
            const a = r.poly[j];
            if (Math.hypot(b.x - a.x, b.y - a.y) * zoom < 18) return null;
            const horiz = Math.abs(b.y - a.y) < 0.75, vert = Math.abs(b.x - a.x) < 0.75;
            return (
              <circle key={`m${j}`} cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r={4.5 * k} onPointerDown={(ev) => drag(ev, "seg", j)}
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
      {/* end handles sit in the HTML layer above the nodes: at a node's border the node would cover an SVG handle */}
      {edit && (
        <EdgeLabelRenderer>
          {[r.poly[0], r.poly[r.poly.length - 1]].map((p, i) => (
            <div key={i} className="nodrag nopan arch-edge-end" data-end={i ? "target" : "source"} title={t("Drag onto a node to reconnect")} onPointerDown={(ev) => dragEnd(ev, i ? "target" : "source")}
              style={{ position: "absolute", left: 0, top: 0, width: 14, height: 14, transform: `translate(${p.x}px,${p.y}px) translate(-50%,-50%) scale(${k})`, borderRadius: "50%", background: "var(--accent)", border: "2px solid var(--bg)", boxSizing: "border-box", pointerEvents: "all", zIndex: 2 }} />
          ))}
        </EdgeLabelRenderer>
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
