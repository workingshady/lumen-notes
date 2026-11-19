// Learning path · Graph (PathDesk "graph", R4-14E): left → right by stage ("Step N · name"), sub-columns by prerequisite depth
// inside a stage, course colour bars + stage badge, focus chain, collapse a stage into a summary node, minimap, zoom/fit,
// collapsible legend, drag a node's dot onto another to add a path prerequisite (dashed; removable), loops refused.
import { Background, BackgroundVariant, Handle, MiniMap, Position, ReactFlow, useReactFlow, type Connection, type Edge, type Node as RFNode, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronsLeft, Minus, Plus, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { cx } from "../components/ui";
import { addConceptNeed, conceptCourses, focusChain, graphLayout, pathNeeds, removeConceptNeed, wouldCycle, type BuiltConcept, type BuiltPath } from "../lib/path";
import { toast } from "../lib/store";
import { announce } from "./dnd-parts";
import { shortStage, StatusIcon, useStored } from "./path-ui";
import { usePhone } from "./spaces-util";

type CData = { c: BuiltConcept; stageNo: number; chain: boolean; inFocus: boolean; sel: boolean };
type HData = { stage: number; name: string; width: number; onCollapse: () => void };
type SData = { stage: number; name: string; count: number; onExpand: () => void };

const CNode = memo(({ data }: NodeProps<RFNode<CData>>) => {
  const { c, chain, sel, inFocus } = data;
  const done = c.status === "done";
  const bars = conceptCourses(c).slice(0, 3);
  const op = chain ? 1 : c.status === "locked" ? 0.4 : !inFocus ? 0.35 : done ? 0.9 : 0.75;
  return (
    <div className="flex h-[46px] w-[176px] overflow-hidden rounded-[10px]" data-gnode={c.key}
      style={{ background: done ? "color-mix(in srgb,var(--success) 10%,var(--surface))" : "var(--surface)", border: chain ? "1.5px solid var(--accent)" : "1px solid var(--border)", boxShadow: sel ? "0 0 0 4px color-mix(in srgb,var(--accent) 18%,transparent)" : "none", opacity: op }}>
      {/* the whole card is the drop target for "this needs …"; the right-edge dot starts the drag */}
      <Handle type="target" position={Position.Left} isConnectableStart={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", transform: "none", left: 0, top: 0, border: 0, background: "transparent", borderRadius: 10, opacity: 0 }} />
      <span className="flex w-1 shrink-0 flex-col">{(bars.length ? bars : [{ key: "-", color: "var(--border)" }]).map((b) => <span key={b.key} className="flex-1" style={{ background: b.color }} />)}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
        <StatusIcon c={c} size={14} />
        <span className="min-w-0 flex-1 truncate font-semibold" dir="auto" title={c.def.name}>{c.def.name}</span>
        <span className="text-[10.5px] font-semibold text-muted">{data.stageNo ? `S${data.stageNo}` : "—"}</span>
      </div>
      <Handle type="source" position={Position.Right} title="Drag onto a concept to make this its prerequisite" className="pdnd-src"
        style={{ width: 10, height: 10, right: -6, background: "var(--accent)", border: "2px solid var(--bg)", cursor: "crosshair" }} />
    </div>
  );
});
const HNode = memo(({ data }: NodeProps<RFNode<HData>>) => (
  <div className="group flex flex-col gap-0.5" style={{ width: data.width }}>
    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Step {data.stage + 1}
      <button title="Collapse this stage" aria-label={`Collapse step ${data.stage + 1}`} onClick={data.onCollapse} className="nodrag opacity-0 hover:text-ink group-hover:opacity-100"><ChevronsLeft size={13} /></button></span>
    <span className="truncate font-[650]" dir="auto">{shortStage(data.name)}</span>
  </div>
));
const SNode = memo(({ data }: NodeProps<RFNode<SData>>) => (
  <div className="flex w-[150px] flex-col gap-1 rounded-[12px] border border-dashed border-line bg-surface px-3 py-2.5">
    <Handle type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0 }} />
    <span className="truncate font-[650]" dir="auto">Step {data.stage + 1} · {shortStage(data.name)}</span>
    <span className="text-[12px] text-muted">{data.count} {data.count === 1 ? "concept" : "concepts"} · collapsed</span>
    <button onClick={data.onExpand} className="nodrag self-start text-[12px] text-link hover:underline">Expand</button>
    <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0 }} />
  </div>
));
const nodeTypes = { concept: CNode, head: HNode, summary: SNode };

export function Graph({ path, note, save, onOpen, sel, keep, focus, setFocus }: { path: BuiltPath; note: Note; save: (b: string) => void; onOpen: (k: string) => void; sel: string | null; keep: (c: BuiltConcept) => boolean; focus: string | null; setFocus: (k: string | null) => void }) {
  const phone = usePhone();
  const rf = useReactFlow();
  const box = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useStored<string[]>(`lumen.path.gcol.${note.id}`, []);
  const [legend, setLegend] = useStored<boolean>("lumen.path.legend", !phone);
  const [courses, setCourses] = useState(false);
  const [only, setOnly] = useState(false);
  const [edgeMenu, setEdgeMenu] = useState<{ x: number; y: number; from: BuiltConcept; to: BuiltConcept } | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; from: string; over: string | null } | null>(null);
  const focusKey = focus ?? sel;
  const chain = useMemo(() => focusChain(path, focusKey), [path, focusKey]);
  const L = useMemo(() => graphLayout(path, (c) => keep(c) && (!only || !focusKey || chain.has(c.key)), new Set(collapsed)), [path, keep, only, focusKey, chain, collapsed]);

  const { nodes, edges } = useMemo(() => {
    const nodes: RFNode[] = [];
    for (const col of L.cols) {
      if (col.collapsed) {
        nodes.push({ id: `stage:${col.name}`, type: "summary", position: { x: col.x, y: 300 }, data: { stage: col.stage, name: col.name, count: col.count, onExpand: () => setCollapsed((o) => o.filter((x) => x !== col.name)) } satisfies SData, draggable: false, selectable: false, connectable: false });
      } else {
        nodes.push({ id: `head:${col.name}`, type: "head", position: { x: col.x, y: 14 }, data: { stage: col.stage, name: col.name, width: Math.max(176, col.width), onCollapse: () => setCollapsed((o) => [...o, col.name]) } satisfies HData, draggable: false, selectable: false, connectable: false });
      }
    }
    for (const n of L.nodes) {
      const c = path.byKey.get(n.key)!;
      nodes.push({ id: c.key, type: "concept", position: { x: n.x, y: n.y }, width: 176, height: 46, data: { c, stageNo: c.placed ? c.stageIndex + 1 : 0, chain: !!focusKey && chain.has(c.key), inFocus: !focusKey || chain.has(c.key) || !only, sel: c.key === sel } satisfies CData, draggable: false });
    }
    const ids = new Set(nodes.map((n) => n.id));
    const seen = new Set<string>();
    const edges: Edge[] = [];
    for (const n of L.nodes) {
      const c = path.byKey.get(n.key)!;
      for (const k of c.needs) {
        const pre = path.byKey.get(k);
        if (!pre) continue;
        const src = L.summary.get(k) ?? k, dst = L.summary.get(c.key) ?? c.key;
        if (!ids.has(src) || !ids.has(dst) || src === dst || seen.has(`${src}>${dst}`)) continue;
        seen.add(`${src}>${dst}`);
        const own = pathNeeds(c, pre);
        const foc = !!focusKey && chain.has(k) && chain.has(c.key);
        const done = c.status === "done";
        edges.push({ id: `${src}>${dst}`, source: src, target: dst, type: "straight", interactionWidth: 14, className: "pdnd-edge",
          style: { stroke: foc || own ? "var(--accent)" : done ? "var(--success)" : "var(--muted)", strokeWidth: 2, opacity: foc ? 1 : own ? 0.9 : done ? 0.6 : 0.3, strokeDasharray: own ? "5 4" : undefined } });
      }
    }
    // collapsed → collapsed / summary edges come from the members of collapsed stages too
    for (const [k, sid] of L.summary) {
      const c = path.byKey.get(k)!;
      for (const n of c.needs) {
        const src = L.summary.get(n) ?? n;
        if (!ids.has(src) || src === sid || seen.has(`${src}>${sid}`)) continue;
        seen.add(`${src}>${sid}`);
        edges.push({ id: `${src}>${sid}`, source: src, target: sid, type: "straight", style: { stroke: "var(--muted)", strokeWidth: 2, opacity: 0.3 } });
      }
      for (const u of c.unlocks) {
        const dst = L.summary.get(u) ?? u;
        if (!ids.has(dst) || dst === sid || seen.has(`${sid}>${dst}`)) continue;
        seen.add(`${sid}>${dst}`);
        edges.push({ id: `${sid}>${dst}`, source: sid, target: dst, type: "straight", style: { stroke: "var(--muted)", strokeWidth: 2, opacity: 0.3 } });
      }
    }
    return { nodes, edges };
  }, [path, L, chain, focusKey, sel, only]); // eslint-disable-line react-hooks/exhaustive-deps

  // focus: centre the chain
  useEffect(() => {
    if (!focus) return;
    const t = setTimeout(() => void rf.fitView({ nodes: [...chain].map((id) => ({ id })), padding: 0.2, maxZoom: 1, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = (cn: Connection) => {
    const pre = cn.source ? path.byKey.get(cn.source) : null, c = cn.target ? path.byKey.get(cn.target) : null;
    if (!pre || !c || pre.key === c.key) return;
    if (c.needs.includes(pre.key)) return toast(`“${c.def.name}” already needs “${pre.def.name}”`);
    if (wouldCycle(path, c, pre)) return toast("That would make a loop: it already depends on this concept.");
    save(addConceptNeed(note.body, c, pre));
    announce(`${c.def.name} now needs ${pre.def.name}`);
  };
  const openEdgeMenu = (e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    const from = path.byKey.get(edge.source), to = path.byKey.get(edge.target), r = box.current!.getBoundingClientRect();
    if (from && to) setEdgeMenu({ x: Math.min(e.clientX - r.left, r.width - 250), y: Math.min(e.clientY - r.top, r.height - 110), from, to });
  };
  const firstCols = L.nodes.filter((n) => n.x <= (phone ? 250 : 1000)).map((n) => ({ id: n.key }));
  const fitOpts = { padding: phone ? 0.08 : 0.06, maxZoom: 1, minZoom: 0.45, nodes: firstCols.length ? [...firstCols, ...L.cols.filter((c) => c.x <= 1000).map((c) => ({ id: c.collapsed ? `stage:${c.name}` : `head:${c.name}` }))] : undefined };
  const overBad = drag?.over ? (() => { const a = path.byKey.get(drag.from), b = path.byKey.get(drag.over!); return !a || !b || a.key === b.key || wouldCycle(path, b, a); })() : false;
  const fc = focusKey ? path.byKey.get(focusKey) : null;

  return (
    <div ref={box} className="pdnd-flow lm-flow lp-graph relative h-full min-h-[420px]"
      onMouseMove={(e) => { if (drag) { const r = box.current!.getBoundingClientRect(); const over = (e.target as HTMLElement).closest("[data-gnode]")?.getAttribute("data-gnode") ?? null; setDrag({ ...drag, x: e.clientX - r.left, y: e.clientY - r.top, over }); } }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} {...(phone ? { fitView: true, fitViewOptions: fitOpts } : { defaultViewport: { x: 0, y: 0, zoom: 1 } })} minZoom={0.1} proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => { setEdgeMenu(null); if (n.type === "concept") onOpen(n.id); }}
        nodesConnectable connectOnClick={false} onConnect={connect}
        onConnectStart={(e, p) => { const r = box.current!.getBoundingClientRect(); const ev = "touches" in e ? e.touches[0] : e; if (p.nodeId) setDrag({ x: ev.clientX - r.left, y: ev.clientY - r.top, from: p.nodeId, over: null }); }}
        onConnectEnd={() => setDrag(null)}
        isValidConnection={(c) => { const a = path.byKey.get(c.source), b = path.byKey.get(c.target); return !!a && !!b && a.key !== b.key && !wouldCycle(path, b, a); }}
        connectionLineStyle={{ stroke: "var(--accent)", strokeWidth: 2, strokeDasharray: "5 4" }}
        onEdgeClick={openEdgeMenu} onEdgeContextMenu={openEdgeMenu} onPaneClick={() => setEdgeMenu(null)}>
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="color-mix(in srgb, var(--muted) 30%, transparent)" />
        {!phone && <MiniMap position="bottom-right" pannable zoomable style={{ width: 168, height: 96, margin: 16, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", overflow: "hidden" }}
          nodeColor={(n) => (n.type === "concept" ? ((n.data as CData).c.status === "done" ? "var(--success)" : "var(--muted)") : n.type === "summary" ? "var(--border)" : "transparent")} nodeBorderRadius={2}
          maskColor="transparent" maskStrokeColor="var(--accent)" maskStrokeWidth={3} bgColor="var(--surface)" />}
      </ReactFlow>

      {fc && (
        <div className="absolute right-4 top-3 z-10 flex items-center gap-2 rounded-[10px] border border-line bg-surface px-2.5 py-1 text-[12px]">
          <span className="text-muted">Focus</span><b className="font-semibold" dir="auto">{fc.def.name}</b><span className="text-muted">· {chain.size} in chain</span>
          <button onClick={() => setOnly((o) => !o)} aria-pressed={only} className={cx("rounded-[6px] px-1.5", only ? "bg-accent/15 text-ink" : "text-link")}>{only ? "Show all" : "Only this chain"}</button>
          {focus && <button aria-label="Clear focus" onClick={() => { setFocus(null); setOnly(false); }} className="text-muted hover:text-ink"><X size={13} /></button>}
        </div>
      )}

      {drag && (
        <div className="pointer-events-none absolute z-30 flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-[12px]" style={{ left: drag.x + 14, top: drag.y + 14, background: overBad ? "color-mix(in srgb,var(--danger) 8%,var(--surface-2))" : "var(--surface-2)", border: `1px solid ${overBad ? "var(--danger)" : "var(--accent)"}`, color: overBad ? "var(--danger)" : undefined, boxShadow: "0 8px 20px rgba(0,0,0,.35)" }}>
          <span className="size-2.5 rounded-full" style={{ background: overBad ? "var(--danger)" : "var(--accent)" }} />{overBad ? "Invalid drop · would make a loop" : "Drop on a concept to make it a prerequisite"}
        </div>
      )}

      {edgeMenu && (
        <div role="dialog" aria-label="Prerequisite" className="fade-in absolute z-20 w-[240px] rounded-[10px] border border-line bg-surface p-1.5 text-[12.5px] shadow-xl" style={{ left: Math.max(8, edgeMenu.x), top: Math.max(8, edgeMenu.y) }}>
          <div className="px-2 pb-1.5 pt-1 text-muted" dir="auto"><b className="text-ink">{edgeMenu.to.def.name}</b> needs <b className="text-ink">{edgeMenu.from.def.name}</b></div>
          {pathNeeds(edgeMenu.to, edgeMenu.from) ? (
            <button autoFocus onClick={() => { save(removeConceptNeed(note.body, edgeMenu.to, edgeMenu.from)); announce(`${edgeMenu.to.def.name} no longer needs ${edgeMenu.from.def.name}`); setEdgeMenu(null); }}
              className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-bad hover:bg-bad/10"><X size={13} />Remove prerequisite</button>
          ) : (
            <p className="px-2 pb-1 text-[12px] text-muted">This one comes from a course roadmap ({[...new Set(edgeMenu.to.coverage.map((x) => x.course.spaceName))].join(", ")}); change it there.</p>
          )}
          <button onClick={() => setEdgeMenu(null)} className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-muted hover:bg-surface-2">Close</button>
        </div>
      )}

      {/* legend (collapsible) */}
      <div className="absolute bottom-4 left-5 z-10 flex max-w-[calc(100%-2.5rem)] flex-col rounded-[10px] border border-line bg-surface text-[12px] text-muted">
        {legend && courses && (
          <div className="flex max-h-[30vh] flex-wrap gap-x-3 gap-y-1.5 overflow-y-auto border-b border-line px-3 py-2">
            {path.courses.map((c) => <span key={c.key} className="flex items-center gap-1.5"><span className="h-2 w-1 rounded-[1px]" style={{ background: c.color }} />{c.spaceName}</span>)}
          </div>
        )}
        <div className="flex items-center gap-3.5 px-3 py-2">
          {legend && (
            <>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-ok" />done</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-muted" />needed</span>
              <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-accent" />added by you</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-accent" />focus chain</span>
              <button onClick={() => setCourses((x) => !x)} className="hover:text-ink">{path.courses.length} courses</button>
            </>
          )}
          <button onClick={() => setLegend(!legend)} aria-expanded={legend} aria-label={legend ? "Hide legend" : "Show legend"} className="flex items-center gap-1 hover:text-ink">{!legend && "Legend"}<ChevronDown size={13} className={cx("transition-transform", legend && "rotate-180")} /></button>
        </div>
      </div>

      {/* zoom + fit */}
      <div className="absolute bottom-4 z-10 flex gap-0.5 rounded-[10px] border border-line bg-surface p-[3px]" style={{ right: phone ? 16 : 196 }}>
        <button aria-label="Zoom out" onClick={() => void rf.zoomOut({ duration: 150 })} className="flex size-7 items-center justify-center rounded-[7px] hover:bg-surface-2"><Minus size={14} /></button>
        <button aria-label="Zoom in" onClick={() => void rf.zoomIn({ duration: 150 })} className="flex size-7 items-center justify-center rounded-[7px] hover:bg-surface-2"><Plus size={14} /></button>
        <button onClick={() => void rf.fitView({ padding: 0.06, duration: 200 })} className="flex h-7 items-center rounded-[7px] px-2 text-[12px] hover:bg-surface-2">Fit</button>
      </div>
      {!L.nodes.length && !L.cols.some((c) => c.collapsed) && <div className="absolute inset-0 flex items-center justify-center text-[13px] text-muted">No concepts match the filters.</div>}
    </div>
  );
}
