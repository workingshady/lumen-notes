// Course roadmap · Skill tree (design round 4: RoadmapDesk "tree", Lumen 15 R4-15E, + 14b Graphs & connections).
// Modules laid out left → right (a module spans as many columns as its prerequisite depth), links coloured by the state
// of the prerequisite, module headers that fold a module into a summary card, ancestor/descendant focus, minimap,
// "+ Topic" palette, drag from a dot to add a prerequisite.
// 14b: the shared Display panel (edge shape, show links: prerequisites / recommended / related / implied, Group by
// module, Bundle links between modules, Dim outside focus, spacing; saved per view), implied links hidden by default and
// shown as faint dots while either end is hovered, live drag checks (valid → "Becomes a prerequisite", loop refused with
// the chain, already implied asks first, duplicate does nothing) and the link menu (type, reverse, remove).
import { Handle, MiniMap, Position, ReactFlow, useReactFlow, ViewportPortal, type Connection, type Edge, type Node as RFNode, type NodeProps } from "@xyflow/react";
import { SlidersHorizontal } from "lucide-react";
import { memo, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { setTopicLink, type Module, type Topic } from "../lib/parse";
import { Glyph } from "../components/Glyph";
import { DropTag, LinkMenu, LinkTip, PrereqDisplayPanel, PrereqDisplaySheet, dropBorder, dropLineColor, dropState, linkLook, prereqEdgeTypes, usePrereqDisplay, type DropState, type PrereqEdgeData } from "../components/prereq-ui";
import { cx } from "../components/ui";
import { arrow, checkLink, impliedLinks, LINK_LABEL, linkMessage, needPath, type LinkKind } from "../lib/prereq-graph";
import { toast } from "../lib/store";
import { announce, dragKind, endDrag, startDrag } from "./dnd-parts";
import { StatusGlyph, type useModuleFold } from "./roadmap-parts";
import { t as tr, useLang } from "../lib/i18n";

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

type TData = { t: Topic; sel: boolean; dim: boolean; fresh: boolean; phone: boolean; w: number; drop: DropState };
const TopicNode = memo(({ data }: NodeProps<RFNode<TData>>) => {
  useLang();
  const { t, sel, dim, fresh, phone, w, drop } = data;
  const style: CSSProperties = {
    width: w, height: H,
    background: t.status === "done" ? "color-mix(in srgb, var(--success) 14%, var(--surface))" : "var(--surface)",
    border: dropBorder(drop) ?? (sel ? "2px solid var(--accent)" : t.status === "learning" ? "1.5px solid var(--info)" : "1px solid var(--border)"),
    boxShadow: sel ? "0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent)" : undefined,
    opacity: dim && !drop ? 0.35 : 1,
    transition: "opacity .12s",
  };
  return (
    <div className="relative" data-tnode={t.line}>
      {drop === "valid" && <DropTag />}
      {/* the whole node is a drop target for "add prerequisite"; only the right-edge dot starts a drag */}
      <Handle type="target" position={Position.Left} isConnectableStart={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", transform: "none", left: 0, top: 0, border: 0, background: "transparent", borderRadius: 10 }} />
      <div className={cx("box-border flex items-center gap-2 rounded-[10px] px-2.5 text-[13px]", fresh && "rm-unlock")} style={style}>
        <StatusGlyph t={t} />
        <span className={cx("min-w-0 flex-1 truncate font-medium", phone && "text-[13px]")} dir="auto">{t.name}</span>
      </div>
      <Handle type="source" position={Position.Right} title={tr("Drag onto a topic to make this its prerequisite")} className="lm-src"
        style={{ width: 10, height: 10, right: 0, transform: "translate(0,-50%)", background: "var(--accent)", border: "2px solid var(--bg)", cursor: "crosshair" }} />
    </div>
  );
});
TopicNode.displayName = "TopicNode";

type MData = { m: Module; count: number; onOpen: () => void; dim: boolean };
const ModuleNode = memo(({ data }: NodeProps<RFNode<MData>>) => { useLang(); return (
  <div className="relative">
    <Handle type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0, left: 0 }} />
    <button onClick={(e) => { e.stopPropagation(); data.onOpen(); }} title={tr("Expand module")}
      className="box-border flex h-[62px] w-[180px] flex-col justify-center gap-[3px] rounded-[10px] border border-dashed border-line bg-surface px-3 text-start text-[13px]" style={{ opacity: data.dim ? 0.35 : 1 }}>
      <span className="truncate font-semibold" dir="auto">{data.m.name}</span><span className="text-[12px] text-muted">{tr("{n} topic|{n} topics", { n: data.count })} · {tr("collapsed")}</span>
    </button>
    <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0, right: 0 }} />
  </div>
); });
ModuleNode.displayName = "ModuleNode";

/**
 * Module-major layout: modules left → right; inside a module, columns = prerequisite depth within it. Not grouped
 * ("Group by module" off): columns = prerequisite depth across the whole roadmap, no module bands.
 */
function treeLayout(mods: Module[], isOpen: (i: number) => boolean, phone: boolean, group = true, roomy = false) {
  const all = mods.flatMap((m) => m.topics).filter((t) => t.status !== "skipped");
  const byName = new Map(all.map((t) => [t.name.toLowerCase(), t]));
  const deps = (t: Topic) => t.needs.map((n) => byName.get(n.toLowerCase())).filter((d): d is Topic => !!d && d.line !== t.line);
  const open = (i: number) => !group || isOpen(i);
  const local = new Map<number, number>();
  const visiting = new Set<number>();
  const depth = (t: Topic): number => {
    if (local.has(t.line)) return local.get(t.line)!;
    if (visiting.has(t.line)) return 0;
    visiting.add(t.line);
    const ds = deps(t).filter((d) => !group || d.module === t.module);
    const v = ds.length ? 1 + Math.max(...ds.map(depth)) : 0;
    visiting.delete(t.line);
    local.set(t.line, v);
    return v;
  };
  all.forEach(depth);
  const G = phone ? { x0: PX0, col: PCOL, w: PW } : { x0: X0, col: roomy ? COL + 60 : COL, w: W };
  const step = roomy ? STEP + 30 : STEP;
  const start: number[] = [];
  let c = 0;
  if (group) {
    mods.forEach((m, i) => {
      start[i] = c;
      const ts = m.topics.filter((t) => t.status !== "skipped");
      c += !isOpen(i) || !ts.length ? 1 : Math.max(...ts.map((t) => local.get(t.line) ?? 0)) + 1;
    });
  } else {
    mods.forEach((_, i) => { start[i] = 0; });
    c = Math.max(0, ...local.values()) + 1;
  }
  // Fan-out (R4-15E): a topic with no prerequisites sits next to what it unlocks ("as late as possible") instead of being
  // stranded in the first column, e.g. "Activation functions" beside "Backpropagation", feeding "Convolution".
  // It never widens its module: at most the module's last column.
  const span = (m: number) => (group ? Math.max(0, ...mods[m].topics.filter((t) => t.status !== "skipped").map((t) => local.get(t.line) ?? 0)) : c - 1);
  const kids = new Map<number, Topic[]>();
  for (const t of all) for (const d of deps(t)) kids.set(d.line, [...(kids.get(d.line) ?? []), t]);
  for (const t of all) {
    const ks = kids.get(t.line) ?? [];
    if (deps(t).length || !ks.length) continue;
    const want = Math.min(...ks.map((k) => (group && k.module !== t.module ? Infinity : (local.get(k.line) ?? 0) - 1)));
    local.set(t.line, Math.max(local.get(t.line) ?? 0, Math.min(Number.isFinite(want) ? want : span(t.module), span(t.module))));
  }
  const col = (t: Topic) => start[t.module] + (local.get(t.line) ?? 0);
  // y: average of placed parents, else stacked; at least `step` apart within a column
  const ys = new Map<number, number>();
  const colPrev = new Map<number, number>();
  const visible = all.filter((t) => open(t.module));
  for (const t of [...visible].sort((a, b) => col(a) - col(b) || a.line - b.line)) {
    const k = col(t);
    const ps = deps(t).map((x) => ys.get(x.line)).filter((y): y is number => y !== undefined);
    const prev = colPrev.get(k);
    const want = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : prev === undefined ? Y0 : prev + step;
    const y = prev === undefined ? Math.max(Y0, want) : Math.max(want, prev + step);
    ys.set(t.line, y);
    colPrev.set(k, y);
  }
  const pos = (t: Topic) => ({ x: G.x0 + col(t) * G.col, y: ys.get(t.line) ?? Y0 });
  const modPos = (i: number) => ({ x: G.x0 + start[i] * G.col, y: Y0 + 20 });
  return { all, visible, deps, pos, modPos, start, G, cols: c, byName, open };
}

function TreeControls({ right }: { right: number }) {
  const rf = useReactFlow();
  const b = "flex h-7 w-[30px] items-center justify-center rounded-[7px] text-[15px] hover:bg-surface-2";
  return (
    <div className="absolute bottom-4 z-10 flex gap-0.5 rounded-[10px] border border-line bg-surface p-[3px]" style={{ insetInlineEnd: right }}>
      <button className={b} aria-label={tr("Zoom in")} onClick={() => void rf.zoomIn({ duration: 150 })}>+</button>
      <button className={b} aria-label={tr("Zoom out")} onClick={() => void rf.zoomOut({ duration: 150 })}>−</button>
      <button className={b} aria-label={tr("Fit")} onClick={() => void rf.fitView({ duration: 200, padding: 0.12 })}><Glyph name="full" size={14} /></button>
    </div>
  );
}

type EKind = LinkKind | "implied";
interface TreeLink { id: string; src: string; dst: string; kind: EKind; from: Topic; to: Topic }

export function Tree({ mods, sel, phone, fold, fresh, onSelect, onConnect, onCreate, onRemoveNeed, onEditLinks }: {
  mods: Module[]; sel: number | null; phone: boolean; fold: Fold; fresh: Set<string>; onSelect: (t: Topic) => void; onConnect: (topicLine: number, prereqLine: number) => void;
  onCreate: (module: number | null, needs?: Topic) => void; onRemoveNeed: (t: Topic, name: string) => void;
  /** Rewrite the roadmap Markdown (link menu: change type / reverse / remove). */
  onEditLinks?: (f: (md: string) => string, said: string) => void;
}) {
  const rf = useReactFlow();
  const [hover, setHover] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; from: Topic; to: Topic; kind: LinkKind; id: string } | null>(null);
  const [paletteOver, setPaletteOver] = useState<number | "pane" | null>(null);
  const [disp, setDisp] = usePrereqDisplay("tree");
  const [panel, setPanel] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [drag, setDrag] = useState<{ from: string; over: string | null } | null>(null);
  const [ask, setAsk] = useState<{ from: string; to: string; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const L = useMemo(() => treeLayout(mods, fold.isOpen, phone, disp.group, disp.roomy), [mods, fold, phone, disp.group, disp.roomy]); // eslint-disable-line react-hooks/exhaustive-deps
  const byLine = (id: string) => L.all.find((t) => t.line === Number(id));
  // prerequisite graph by node id (topic line)
  const needsOf = useMemo(() => {
    const m = new Map(L.all.map((t) => [String(t.line), L.deps(t).map((d) => String(d.line))]));
    return (k: string) => m.get(k) ?? [];
  }, [L]);
  const implied = useMemo(() => impliedLinks(L.all.map((t) => String(t.line)), needsOf), [L, needsOf]);
  // focus = hovered topic, else the selected one: its prerequisite chain AND everything it unlocks stay bright
  const focus = hover ?? sel;
  const path = useMemo(() => {
    if (focus === null || !disp.dim) return null;
    const t = L.all.find((x) => x.line === focus);
    if (!t) return null;
    const s = ancestors(L.all, t);
    for (const d of descendants(L.all, t)) s.add(d);
    s.add(t.line);
    return s;
  }, [focus, L, disp.dim]);
  const nodeId = (t: Topic) => (L.open(t.module) ? String(t.line) : `m${t.module}`);

  const links = useMemo(() => {
    const out: TreeLink[] = [];
    const seen = new Set<string>();
    const push = (from: Topic, to: Topic, kind: EKind) => {
      const s = nodeId(from), d = nodeId(to);
      if (s === d) return;
      const pair = kind === "related" ? [s, d].sort().join("~") : `${s}>${d}`;
      if (seen.has(pair)) return;
      seen.add(pair);
      out.push({ id: `${kind}:${s}>${d}`, src: s, dst: d, kind, from, to });
    };
    for (const to of L.all) {
      for (const from of L.deps(to)) push(from, to, implied.has(`${from.line}>${to.line}`) ? "implied" : "needs");
      for (const k of ["after", "related"] as const) for (const n of to[k] ?? []) { const from = L.byName.get(n.toLowerCase()); if (from && from.line !== to.line) push(from, to, k); }
    }
    return out;
  }, [L, implied, fold]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => { const n = { needs: 0, after: 0, related: 0, implied: 0 }; for (const l of links) n[l.kind]++; return n; }, [links]);

  const overCheck = drag?.over && drag.over !== drag.from ? checkLink(needsOf, drag.from, drag.over) : null;
  const overState = dropState(overCheck);
  const nodes = useMemo(() => {
    const out: RFNode[] = L.visible.map((t): RFNode<TData> => ({
      id: String(t.line), type: "topic", position: L.pos(t), width: L.G.w, height: H, draggable: false, selectable: false,
      data: { t, sel: t.line === sel || paletteOver === t.line, dim: !!path && !path.has(t.line), fresh: fresh.has(t.name.toLowerCase()), phone, w: L.G.w,
        drop: drag?.over === String(t.line) ? overState : ask?.to === String(t.line) ? "implied" : null },
    }));
    mods.forEach((m, i) => {
      if (L.open(i) || !m.topics.length) return;
      out.push({ id: `m${i}`, type: "module", position: L.modPos(i), width: 180, height: 62, draggable: false, selectable: false, connectable: false,
        data: { m, count: m.topics.length, onOpen: () => fold.toggle(i), dim: !!path && !m.topics.some((t) => path.has(t.line)) } satisfies MData });
    });
    return out;
  }, [L, sel, path, fresh, phone, paletteOver, mods, fold, drag, overState, ask]);
  const edges = useMemo(() => {
    const ys = L.visible.map((t) => L.pos(t).y);
    const mid = ys.length ? (Math.min(...ys) + Math.max(...ys) + H) / 2 : 0;
    const out: Edge<PrereqEdgeData>[] = [];
    for (const l of links) {
      const hov = hover !== null && (l.from.line === hover || l.to.line === hover);
      if (l.kind === "implied" ? !(disp.implied || hov) : !disp[l.kind]) continue;
      const on = !!path && path.has(l.from.line) && path.has(l.to.line);
      const look = linkLook(l.kind, l.from.status, l.to.locked);
      const isSel = menu?.id === l.id;
      // colour = state of the link: from a done topic (green) → open; into a locked topic (muted); otherwise learning (blue)
      const drawIn = fresh.has(l.to.name.toLowerCase()) && l.from.status === "done";
      const opacity = isSel ? 1 : l.kind === "implied" && !disp.implied ? 0.7 : path ? (on ? 1 : 0.3) : l.kind === "needs" ? (l.to.locked ? 0.45 : 0.85) : look.opacity;
      out.push({ id: l.id, source: l.src, target: l.dst, type: "prereq", selectable: false, focusable: false, className: cx("prq-edge", drawIn && "rm-draw"), interactionWidth: 18,
        data: { shape: disp.edges, bundleAt: disp.bundle && disp.group && l.from.module !== l.to.module ? mid : null, color: isSel ? "var(--accent)" : look.color, width: isSel ? 3 : on ? 2.2 : look.width === 1.6 ? 1.5 : look.width, dash: look.dash, opacity, arrow: look.arrow } });
    }
    return out;
  }, [L, links, path, fresh, disp, hover, menu]);

  // ------------------------------------------------------------ connect with live checks (14b-H…K)
  const nameOf = (k: string) => byLine(k)?.name ?? k;
  const tipAt = (id: string) => {
    const t = byLine(id), vp = rf.getViewport(), w = box.current?.clientWidth ?? 800;
    if (!t) return { x: 16, y: 16 };
    const p = L.pos(t);
    return { x: Math.max(8, Math.min(w - 310, (p.x + L.G.w + 16) * vp.zoom + vp.x)), y: Math.max(8, (p.y - 6) * vp.zoom + vp.y) };
  };
  const connect = (c: Connection) => {
    if (!c.source || !c.target || c.source.startsWith("m") || c.target.startsWith("m")) return;
    if (checkLink(needsOf, c.source, c.target).kind === "valid") onConnect(Number(c.target), Number(c.source));
  };
  const trackOver = (x: number, y: number, target: Element | null) => {
    if (!drag) return;
    const el = target?.closest?.("[data-tnode]") ?? document.elementFromPoint(x, y)?.closest("[data-tnode]");
    const over = el?.getAttribute("data-tnode") ?? null;
    if (over !== drag.over) setDrag({ ...drag, over });
  };
  const overMsg = overCheck && drag?.over ? linkMessage(overCheck, nameOf, drag.from, drag.over) : null;

  // ------------------------------------------------------------ link menu (14b-L)
  const openEdgeMenu = (e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    const l = links.find((x) => x.id === edge.id);
    if (!l || l.src.startsWith("m") || l.dst.startsWith("m")) return;
    const r = box.current!.getBoundingClientRect();
    setMenu({ x: Math.min(e.clientX - r.left + 12, r.width - 236), y: Math.min(e.clientY - r.top + 8, r.height - 210), from: l.from, to: l.to, kind: l.kind === "implied" ? "needs" : l.kind, id: l.id });
  };
  const edit = (f: (md: string) => string, said: string) => { if (onEditLinks) onEditLinks(f, said); setMenu(null); };
  const setKind = (k: LinkKind) => menu && edit((md) => setTopicLink(md, menu.to.line, menu.from.name, k), `${menu.from.name}${arrow()}${menu.to.name}: ${tr(LINK_LABEL[k])}`);
  const removeLink = () => {
    if (!menu) return;
    if (onEditLinks) edit((md) => setTopicLink(md, menu.to.line, menu.from.name, null), tr("Removed {link}", { link: `${menu.from.name}${arrow()}${menu.to.name}` }));
    else { onRemoveNeed(menu.to, menu.from.name); setMenu(null); }
  };
  const reverse = () => {
    if (!menu) return;
    const { from, to, kind } = menu;
    const without = (k: string) => (k === String(to.line) ? needsOf(k).filter((n) => n !== String(from.line)) : needsOf(k));
    if (kind === "needs" && needPath(without, String(to.line), String(from.line))) { toast(tr("Can't reverse: {a} still needs {b} through other links, so this would make a loop.", { a: to.name, b: from.name }), undefined, { icon: "error" }); return setMenu(null); }
    edit((md) => setTopicLink(setTopicLink(md, to.line, from.name, null), from.line, to.name, kind), tr("Reversed: {link}", { link: `${to.name}${arrow()}${from.name}` }));
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
  const inset = panel && !phone ? 300 : 0;
  const { rtl } = useLang();

  return (
    <div ref={box} className="lm-flow absolute inset-0" style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)", backgroundSize: "20px 20px" }}
      onDragOver={onPaletteOver} onDrop={onPaletteDrop} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setPaletteOver(null); }}
      onMouseMove={(e) => drag && trackOver(e.clientX, e.clientY, e.target as Element)}
      onTouchMove={(e) => { const t = e.touches[0]; if (drag && t) trackOver(t.clientX, t.clientY, null); }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={{ topic: TopicNode, module: ModuleNode }} edgeTypes={prereqEdgeTypes} defaultViewport={{ x: 0, y: 0, zoom: 1 }} minZoom={0.2} maxZoom={2}
        onInit={(rf) => { const w = box.current?.clientWidth ?? 1200; const content = L.G.x0 * 2 + L.cols * L.G.col; if (content > w) void rf.setViewport({ x: 0, y: 0, zoom: Math.max(0.55, w / content) }); }}
        proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => { setMenu(null); setAsk(null); const t = (n.data as TData).t; if (t) onSelect(t); }}
        onNodeMouseEnter={(_, n) => !n.id.startsWith("m") && setHover(Number(n.id))} onNodeMouseLeave={() => setHover(null)}
        onEdgeClick={openEdgeMenu} onEdgeContextMenu={openEdgeMenu} onPaneClick={() => { setMenu(null); setAsk(null); }}
        onConnect={connect} isValidConnection={(c) => checkLink(needsOf, c.source, c.target).kind === "valid"} connectionLineStyle={{ stroke: dropLineColor(overState), strokeWidth: 2, strokeDasharray: "6 5" }}
        onConnectStart={(_, p) => { setAsk(null); setMenu(null); if (p.nodeId) setDrag({ from: p.nodeId, over: null }); }}
        onConnectEnd={(e, st) => {
          const d = drag;
          setDrag(null);
          if (d?.over && d.over !== d.from) {
            const ck = checkLink(needsOf, d.from, d.over);
            const m = linkMessage(ck, nameOf, d.from, d.over);
            if (ck.kind === "loop" && m) { toast(tr("Can't drop here: {why}", { why: m.body }), undefined, { icon: "error" }); announce(`${m.title}. ${m.body}`); }
            else if (ck.kind === "implied") setAsk({ from: d.from, to: d.over, ...tipAt(d.over) });
            return;
          }
          // dropped on empty canvas: a new topic that needs the one you dragged from
          if (st.isValid || !st.fromNode) return;
          const target = (e as MouseEvent).target as Element | null;
          if (!target?.classList.contains("react-flow__pane")) return;
          const from = byLine(st.fromNode.id);
          if (from) onCreate(from.module, from);
        }}
        nodesConnectable connectOnClick={false} zoomOnDoubleClick={false} panOnScroll={!phone} elementsSelectable={false}>
        <ViewportPortal>
          {/* one header per module, at its first column; click folds the module into a summary card (grouped only) */}
          {disp.group && mods.map((m, i) => (
            <button key={i} onClick={() => fold.toggle(i)} title={fold.isOpen(i) ? tr("Collapse module") : tr("Expand module")}
              className="pointer-events-auto absolute flex max-w-[220px] items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[.06em] text-muted hover:text-ink"
              style={{ left: 0, top: 14, transform: `translateX(${L.G.x0 + L.start[i] * L.G.col}px)` }}>
              <Glyph name={fold.isOpen(i) ? "expand" : "wide"} size={14} /><span className="truncate" dir="auto">{m.name}</span>
              <span className="font-medium normal-case tracking-normal">{tr("{n} topic|{n} topics", { n: m.topics.length })}</span>
            </button>
          ))}
        </ViewportPortal>
        {!phone && (
          <MiniMap position={rtl ? "bottom-left" : "bottom-right"} pannable zoomable nodeColor={miniColor} nodeBorderRadius={2} nodeStrokeWidth={0} maskColor="transparent" maskStrokeColor="var(--accent)" maskStrokeWidth={1.5}
            style={{ width: 180, height: 110, margin: 16, [rtl ? "marginLeft" : "marginRight"]: 16 + inset, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", overflow: "hidden" }} />
        )}
      </ReactFlow>
      {paletteOver === "pane" && <div className="pointer-events-none absolute inset-2 rounded-[14px] border-2 border-dashed border-accent/60" />}
      {!phone && (
        <div className="absolute top-3.5 z-10 flex items-center gap-3.5 rounded-[8px] bg-bg px-2 py-1 text-[12px] text-muted" style={{ insetInlineEnd: 16 + inset }}>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-ok" />{tr("done")}</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[var(--info)]" />{tr("learning")}</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[var(--muted)] opacity-50" />{tr("locked")}</span>
          {!panel && <button onClick={() => setPanel(true)} className="flex h-6 items-center gap-1 rounded-[6px] border border-line px-2 hover:text-ink"><SlidersHorizontal size={12} />{tr("Display")}</button>}
        </div>
      )}
      {drag?.over && overMsg && overState && overState !== "valid" && (() => { const tp = tipAt(drag.over); return <LinkTip state={overState} title={overMsg.title} body={overMsg.body} x={tp.x} y={tp.y} />; })()}
      {ask && (() => { const m = linkMessage(checkLink(needsOf, ask.from, ask.to), nameOf, ask.from, ask.to); return m ? <LinkTip state="implied" title={m.title} body={m.body} x={ask.x} y={ask.y} onAdd={() => { onConnect(Number(ask.to), Number(ask.from)); setAsk(null); }} onCancel={() => setAsk(null)} /> : null; })()}
      {menu && (
        <LinkMenu phone={phone} x={Math.max(8, menu.x)} y={Math.max(8, menu.y)} from={menu.from.name} to={menu.to.name} kind={onEditLinks ? menu.kind : null}
          onKind={onEditLinks ? setKind : undefined} onReverse={onEditLinks ? reverse : undefined} onRemove={removeLink} onClose={() => setMenu(null)} />
      )}
      {/* palette: drag onto the canvas / a topic, or click to add */}
      <button data-palette draggable onDragStart={(e) => startDrag(e, "palette", "topic", tr("New topic"))} onDragEnd={() => { endDrag(); setPaletteOver(null); }}
        onClick={() => onCreate(sel !== null ? L.all.find((t) => t.line === sel)?.module ?? null : null)}
        title={tr("Drag onto the canvas for a new topic, or onto a topic for a next step that needs it. Click to add.")}
        className={cx("absolute z-10 flex h-[30px] cursor-grab items-center gap-1.5 rounded-full border border-dashed border-accent bg-surface px-3 font-semibold text-accent active:cursor-grabbing", phone ? "bottom-3 start-3" : "bottom-5 start-6")}>
        {tr("+ Topic")} {!phone && <span className="font-normal text-muted">{tr("drag onto canvas or a node")}</span>}
      </button>
      {phone
        ? <>
            <span className="pointer-events-none absolute end-14 top-3 flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[12px] text-muted">{tr("swipe")}</span>
            <button aria-label={tr("Skill tree display")} onClick={() => setSheet(true)} className="absolute end-3 top-2 z-10 flex size-9 items-center justify-center rounded-[10px] border border-line bg-surface"><SlidersHorizontal size={16} /></button>
          </>
        : <TreeControls right={208 + inset} />}
      {panel && !phone && (
        <PrereqDisplayPanel d={disp} set={setDisp} onClose={() => setPanel(false)} counts={counts}
          o={{ groupLabel: tr("Group by module"), bundleLabel: tr("Bundle links between modules"), dimLabel: tr("Dim topics outside focus") }} />
      )}
      {sheet && phone && <PrereqDisplaySheet d={disp} set={setDisp} onClose={() => setSheet(false)} />}
    </div>
  );
}
