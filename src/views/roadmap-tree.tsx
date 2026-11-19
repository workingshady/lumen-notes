// Course roadmap · Skill tree (design round 4: RoadmapDesk "tree", Lumen 15 R4-15E).
// Modules laid out left → right (a module spans as many columns as its prerequisite depth), curved links coloured by
// the state of the prerequisite, module headers that fold a module into a summary card, ancestor/descendant focus,
// minimap, link menu ("Remove prerequisite"), "+ Topic" palette, drag from a dot to add a prerequisite.
import { Handle, MiniMap, Position, ReactFlow, useReactFlow, ViewportPortal, type Connection, type Edge, type Node as RFNode, type NodeProps } from "@xyflow/react";
import { memo, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import type { Module, Topic } from "../lib/parse";
import { Glyph } from "../components/Glyph";
import { cx } from "../components/ui";
import { dragKind, endDrag, startDrag } from "./dnd-parts";
import { StatusGlyph, type useModuleFold } from "./roadmap-parts";

type Fold = ReturnType<typeof useModuleFold>;

/** Every topic `t` (transitively) depends on, by line. */
export function ancestors(all: Topic[], t: Topic): Set<number> {
  const byName = new Map(all.map((x) => [x.name.toLowerCase(), x]));
  const out = new Set<number>();
  const stack = [t];
  while (stack.length) {
    const x = stack.pop()!;
    for (const n of x.needs) { const d = byName.get(n.toLowerCase()); if (d && !out.has(d.line)) { out.add(d.line); stack.push(d); } }
  }
  return out;
}
/** Every topic that (transitively) needs `t`: what finishing it unlocks. */
export function descendants(all: Topic[], t: Topic): Set<number> {
  const kids = new Map<string, Topic[]>();
  for (const x of all) for (const n of x.needs) { const k = n.toLowerCase(); kids.set(k, [...(kids.get(k) ?? []), x]); }
  const out = new Set<number>();
  const stack = [t];
  while (stack.length) {
    const x = stack.pop()!;
    for (const c of kids.get(x.name.toLowerCase()) ?? []) if (!out.has(c.line)) { out.add(c.line); stack.push(c); }
  }
  return out;
}

const W = 180, H = 42, COL = 260, X0 = 30, Y0 = 60, STEP = 90;
const PW = 150, PCOL = 170, PX0 = 16;

type TData = { t: Topic; sel: boolean; dim: boolean; fresh: boolean; phone: boolean; w: number };
const TopicNode = memo(({ data }: NodeProps<RFNode<TData>>) => {
  const { t, sel, dim, fresh, phone, w } = data;
  const style: CSSProperties = {
    width: w, height: H,
    background: t.status === "done" ? "color-mix(in srgb, var(--success) 14%, var(--surface))" : "var(--surface)",
    border: sel ? "2px solid var(--accent)" : t.status === "learning" ? "1.5px solid var(--info)" : "1px solid var(--border)",
    boxShadow: sel ? "0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent)" : undefined,
    opacity: dim ? 0.35 : 1,
    transition: "opacity .12s",
  };
  return (
    <div className="relative">
      {/* the whole node is a drop target for "add prerequisite"; only the right-edge dot starts a drag */}
      <Handle type="target" position={Position.Left} isConnectableStart={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", transform: "none", left: 0, top: 0, border: 0, background: "transparent", borderRadius: 10 }} />
      <div className={cx("box-border flex items-center gap-2 rounded-[10px] px-2.5 text-[13px]", fresh && "rm-unlock")} style={style}>
        <StatusGlyph t={t} />
        <span className={cx("min-w-0 flex-1 truncate font-medium", phone && "text-[13px]")}>{t.name}</span>
      </div>
      <Handle type="source" position={Position.Right} title="Drag onto a topic to make this its prerequisite" className="lm-src"
        style={{ width: 10, height: 10, right: 0, transform: "translate(0,-50%)", background: "var(--accent)", border: "2px solid var(--bg)", cursor: "crosshair" }} />
    </div>
  );
});
TopicNode.displayName = "TopicNode";

type MData = { m: Module; count: number; onOpen: () => void; dim: boolean };
const ModuleNode = memo(({ data }: NodeProps<RFNode<MData>>) => (
  <div className="relative">
    <Handle type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0, left: 0 }} />
    <button onClick={(e) => { e.stopPropagation(); data.onOpen(); }} title="Expand module"
      className="box-border flex h-[62px] w-[180px] flex-col justify-center gap-[3px] rounded-[10px] border border-dashed border-line bg-surface px-3 text-left text-[13px]" style={{ opacity: data.dim ? 0.35 : 1 }}>
      <span className="truncate font-semibold" dir="auto">{data.m.name}</span><span className="text-[12px] text-muted">{data.count} topics · collapsed</span>
    </button>
    <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0, right: 0 }} />
  </div>
));
ModuleNode.displayName = "ModuleNode";

/** Module-major layout: modules left → right; inside a module, columns = prerequisite depth within it. */
function treeLayout(mods: Module[], isOpen: (i: number) => boolean, phone: boolean) {
  const all = mods.flatMap((m) => m.topics).filter((t) => t.status !== "skipped");
  const byName = new Map(all.map((t) => [t.name.toLowerCase(), t]));
  const deps = (t: Topic) => t.needs.map((n) => byName.get(n.toLowerCase())).filter((d): d is Topic => !!d && d.line !== t.line);
  const local = new Map<number, number>();
  const visiting = new Set<number>();
  const depth = (t: Topic): number => {
    if (local.has(t.line)) return local.get(t.line)!;
    if (visiting.has(t.line)) return 0;
    visiting.add(t.line);
    const ds = deps(t).filter((d) => d.module === t.module);
    const v = ds.length ? 1 + Math.max(...ds.map(depth)) : 0;
    visiting.delete(t.line);
    local.set(t.line, v);
    return v;
  };
  all.forEach(depth);
  const G = phone ? { x0: PX0, col: PCOL, w: PW } : { x0: X0, col: COL, w: W };
  const start: number[] = [];
  let c = 0;
  mods.forEach((m, i) => {
    start[i] = c;
    const ts = m.topics.filter((t) => t.status !== "skipped");
    c += !isOpen(i) || !ts.length ? 1 : Math.max(...ts.map((t) => local.get(t.line) ?? 0)) + 1;
  });
  const col = (t: Topic) => start[t.module] + (local.get(t.line) ?? 0);
  // y: average of placed parents, else stacked; at least STEP apart within a column
  const ys = new Map<number, number>();
  const colPrev = new Map<number, number>();
  const visible = all.filter((t) => isOpen(t.module));
  for (const t of [...visible].sort((a, b) => col(a) - col(b) || a.line - b.line)) {
    const k = col(t);
    const ps = deps(t).map((x) => ys.get(x.line)).filter((y): y is number => y !== undefined);
    const prev = colPrev.get(k);
    const want = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : prev === undefined ? Y0 : prev + STEP;
    const y = prev === undefined ? Math.max(Y0, want) : Math.max(want, prev + STEP);
    ys.set(t.line, y);
    colPrev.set(k, y);
  }
  const pos = (t: Topic) => ({ x: G.x0 + col(t) * G.col, y: ys.get(t.line) ?? Y0 });
  const modPos = (i: number) => ({ x: G.x0 + start[i] * G.col, y: Y0 + 20 });
  return { all, visible, deps, pos, modPos, start, G, cols: c };
}

function TreeControls() {
  const rf = useReactFlow();
  const b = "flex h-7 w-[30px] items-center justify-center rounded-[7px] text-[15px] hover:bg-surface-2";
  return (
    <div className="absolute bottom-4 right-[208px] z-10 flex gap-0.5 rounded-[10px] border border-line bg-surface p-[3px]">
      <button className={b} aria-label="Zoom in" onClick={() => void rf.zoomIn({ duration: 150 })}>+</button>
      <button className={b} aria-label="Zoom out" onClick={() => void rf.zoomOut({ duration: 150 })}>−</button>
      <button className={b} aria-label="Fit" onClick={() => void rf.fitView({ duration: 200, padding: 0.12 })}><Glyph name="full" size={14} /></button>
    </div>
  );
}

export function Tree({ mods, sel, phone, fold, fresh, onSelect, onConnect, onCreate, onRemoveNeed }: {
  mods: Module[]; sel: number | null; phone: boolean; fold: Fold; fresh: Set<string>; onSelect: (t: Topic) => void; onConnect: (topicLine: number, prereqLine: number) => void;
  onCreate: (module: number | null, needs?: Topic) => void; onRemoveNeed: (t: Topic, name: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<{ x: number; y: number; from: Topic; to: Topic } | null>(null);
  const [paletteOver, setPaletteOver] = useState<number | "pane" | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const L = useMemo(() => treeLayout(mods, fold.isOpen, phone), [mods, fold, phone]); // eslint-disable-line react-hooks/exhaustive-deps
  // focus = hovered topic, else the selected one: its prerequisite chain AND everything it unlocks stay bright
  const focus = hover ?? sel;
  const path = useMemo(() => {
    if (focus === null) return null;
    const t = L.all.find((x) => x.line === focus);
    if (!t) return null;
    const s = ancestors(L.all, t);
    for (const d of descendants(L.all, t)) s.add(d);
    s.add(t.line);
    return s;
  }, [focus, L]);
  const nodeId = (t: Topic) => (fold.isOpen(t.module) ? String(t.line) : `m${t.module}`);
  const nodes = useMemo(() => {
    const out: RFNode[] = L.visible.map((t): RFNode<TData> => ({
      id: String(t.line), type: "topic", position: L.pos(t), width: L.G.w, height: H, draggable: false, selectable: false,
      data: { t, sel: t.line === sel || paletteOver === t.line, dim: !!path && !path.has(t.line), fresh: fresh.has(t.name.toLowerCase()), phone, w: L.G.w },
    }));
    mods.forEach((m, i) => {
      if (fold.isOpen(i) || !m.topics.length) return;
      out.push({ id: `m${i}`, type: "module", position: L.modPos(i), width: 180, height: 62, draggable: false, selectable: false, connectable: false,
        data: { m, count: m.topics.length, onOpen: () => fold.toggle(i), dim: !!path && !m.topics.some((t) => path.has(t.line)) } satisfies MData });
    });
    return out;
  }, [L, sel, path, fresh, phone, paletteOver, mods, fold]);
  const edges = useMemo(() => {
    const seen = new Set<string>();
    const out: Edge[] = [];
    for (const to of L.all) for (const from of L.deps(to)) {
      const s = nodeId(from), d = nodeId(to);
      if (s === d || seen.has(`${s}>${d}`)) continue;
      seen.add(`${s}>${d}`);
      const on = !!path && path.has(from.line) && path.has(to.line);
      // colour = state of the link: from a done topic (green) → open; into a locked topic (muted); otherwise learning (blue)
      const c = from.status === "done" ? "var(--success)" : to.locked ? "var(--muted)" : "var(--info)";
      const drawIn = fresh.has(to.name.toLowerCase()) && from.status === "done";
      out.push({ id: `${s}>${d}`, source: s, target: d, type: "default", selectable: false, focusable: false, className: cx("pdnd-edge", drawIn && "rm-draw"), interactionWidth: 18,
        style: { strokeWidth: on ? 2.2 : 1.5, stroke: c, opacity: path ? (on ? 1 : 0.3) : to.locked ? 0.45 : 0.85 } });
    }
    return out;
  }, [L, path, fresh, fold]); // eslint-disable-line react-hooks/exhaustive-deps
  const connect = (c: Connection) => { if (c.source && c.target && c.source !== c.target && !c.source.startsWith("m") && !c.target.startsWith("m")) onConnect(Number(c.target), Number(c.source)); };
  const byLine = (id: string) => L.all.find((t) => t.line === Number(id));
  const openEdgeMenu = (e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    const from = byLine(edge.source), to = byLine(edge.target), r = box.current!.getBoundingClientRect();
    if (from && to) setEdgeMenu({ x: Math.min(e.clientX - r.left, r.width - 200), y: Math.min(e.clientY - r.top, r.height - 50), from, to });
  };
  // palette: drag "+ Topic" onto the canvas (new topic) or onto a node (new topic that needs it)
  const nodeAt = (e: DragEvent) => { const el = (e.target as Element).closest?.(".react-flow__node"); const id = el?.getAttribute("data-id"); return id && !id.startsWith("m") ? Number(id) : null; };
  const onPaletteOver = (e: DragEvent) => { if (dragKind(e) !== "palette") return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setPaletteOver(nodeAt(e) ?? "pane"); };
  const onPaletteDrop = (e: DragEvent) => {
    if (dragKind(e) !== "palette") return;
    e.preventDefault();
    const n = nodeAt(e);
    setPaletteOver(null);
    endDrag();
    const t = n === null ? undefined : L.all.find((x) => x.line === n);
    onCreate(t ? t.module : null, t);
  };
  const miniColor = (n: RFNode) => { const t = (n.data as TData).t; return !t ? "var(--border)" : t.status === "done" ? "var(--success)" : t.status === "learning" ? "var(--info)" : "var(--muted)"; };

  return (
    <div ref={box} className="lm-flow absolute inset-0" style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)", backgroundSize: "20px 20px" }}
      onDragOver={onPaletteOver} onDrop={onPaletteDrop} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setPaletteOver(null); }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={{ topic: TopicNode, module: ModuleNode }} defaultViewport={{ x: 0, y: 0, zoom: 1 }} minZoom={0.2} maxZoom={2}
        onInit={(rf) => { const w = box.current?.clientWidth ?? 1200; const content = L.G.x0 * 2 + L.cols * L.G.col; if (content > w) void rf.setViewport({ x: 0, y: 0, zoom: Math.max(0.55, w / content) }); }}
        proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => { setEdgeMenu(null); const t = (n.data as TData).t; if (t) onSelect(t); }}
        onNodeMouseEnter={(_, n) => !n.id.startsWith("m") && setHover(Number(n.id))} onNodeMouseLeave={() => setHover(null)}
        onEdgeClick={openEdgeMenu} onEdgeContextMenu={openEdgeMenu} onPaneClick={() => setEdgeMenu(null)}
        onConnect={connect} isValidConnection={(c) => c.source !== c.target} connectionLineStyle={{ stroke: "var(--accent)", strokeWidth: 1.5 }}
        onConnectEnd={(e, st) => {
          // dropped on empty canvas: a new topic that needs the one you dragged from
          if (st.isValid || !st.fromNode) return;
          const target = (e as MouseEvent).target as Element | null;
          if (!target?.classList.contains("react-flow__pane")) return;
          const from = byLine(st.fromNode.id);
          if (from) onCreate(from.module, from);
        }}
        nodesConnectable connectOnClick={false} zoomOnDoubleClick={false} panOnScroll={!phone} elementsSelectable={false}>
        <ViewportPortal>
          {/* one header per module, at its first column; click folds the module into a summary card */}
          {mods.map((m, i) => (
            <button key={i} onClick={() => fold.toggle(i)} title={fold.isOpen(i) ? "Collapse module" : "Expand module"}
              className="pointer-events-auto absolute flex max-w-[220px] items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[.06em] text-muted hover:text-ink"
              style={{ left: 0, top: 14, transform: `translateX(${L.G.x0 + L.start[i] * L.G.col}px)` }}>
              <Glyph name={fold.isOpen(i) ? "expand" : "wide"} size={14} /><span className="truncate" dir="auto">{m.name}</span>
              <span className="font-medium normal-case tracking-normal">{m.topics.length} topics</span>
            </button>
          ))}
        </ViewportPortal>
        {!phone && (
          <MiniMap position="bottom-right" pannable zoomable nodeColor={miniColor} nodeBorderRadius={2} nodeStrokeWidth={0} maskColor="transparent" maskStrokeColor="var(--accent)" maskStrokeWidth={1.5}
            style={{ width: 180, height: 110, margin: 16, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", overflow: "hidden" }} />
        )}
      </ReactFlow>
      {paletteOver === "pane" && <div className="pointer-events-none absolute inset-2 rounded-[14px] border-2 border-dashed border-accent/60" />}
      {!phone && (
        <div className="absolute right-4 top-3.5 z-10 flex gap-3.5 rounded-[8px] bg-bg px-2 py-1 text-[12px] text-muted">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-ok" />done</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[var(--info)]" />learning</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[var(--muted)] opacity-50" />locked</span>
        </div>
      )}
      {edgeMenu && (
        <div role="dialog" aria-label={`${edgeMenu.to.name} needs ${edgeMenu.from.name}`} className="fade-in absolute z-20 flex flex-col rounded-[10px] border border-line bg-surface-2 p-1 text-[13px]"
          style={{ left: Math.max(8, edgeMenu.x), top: Math.max(8, edgeMenu.y), boxShadow: "0 12px 28px rgba(0,0,0,.4)" }}>
          <button autoFocus onClick={() => { onRemoveNeed(edgeMenu.to, edgeMenu.from.name); setEdgeMenu(null); }} title={`${edgeMenu.to.name} needs ${edgeMenu.from.name}`}
            className="flex h-[30px] items-center gap-2 rounded-[6px] px-2.5 text-left text-bad hover:bg-bad/10"><Glyph name="d-rejected" size={14} />Remove prerequisite</button>
        </div>
      )}
      {/* palette: drag onto the canvas / a topic, or click to add */}
      <button data-palette draggable onDragStart={(e) => startDrag(e, "palette", "topic", "New topic")} onDragEnd={() => { endDrag(); setPaletteOver(null); }}
        onClick={() => onCreate(sel !== null ? L.all.find((t) => t.line === sel)?.module ?? null : null)}
        title="Drag onto the canvas for a new topic, or onto a topic for a next step that needs it. Click to add."
        className={cx("absolute z-10 flex h-[30px] cursor-grab items-center gap-1.5 rounded-full border border-dashed border-accent bg-surface px-3 font-semibold text-accent active:cursor-grabbing", phone ? "bottom-3 left-3" : "bottom-5 left-6")}>
        + Topic {!phone && <span className="font-normal text-muted">drag onto canvas or a node</span>}
      </button>
      {phone
        ? <span className="pointer-events-none absolute right-3 top-3 flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[12px] text-muted">swipe</span>
        : <TreeControls />}
    </div>
  );
}
