import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { Crosshair, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { PRESETS } from "../lib/canvas";
import { matcher, parseQuery } from "../lib/search";
import { openNote, useUI, useVault } from "../lib/store";
import { cx, IconButton, inputCls, Segmented } from "../components/ui";

type GNode = SimulationNodeDatum & { id: string; label: string; kind: "note" | "tag"; note?: Note; deg: number; color: string };
type GLink = SimulationLinkDatum<GNode> & { tag?: boolean };
type ColorBy = "space" | "type" | "status" | "folder";

const PAL = Object.values(PRESETS).concat(["#7AA2F7", "#F2A93B", "#5CC8C2", "#D37FB4"]);
const STATUS_C: Record<string, string> = { todo: "#9AA0AA", learning: "#7AA2F7", review: "#E8B34A", mastered: "#6BCB8B" };
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export function GraphView({ localTo }: { localTo?: string }) {
  const v = useVault();
  const ui = useUI();
  const [q, setQ] = useState("");
  const [showTags, setShowTags] = useState(false);
  const [orphans, setOrphans] = useState(true);
  const [colorBy, setColorBy] = useState<ColorBy>("space");
  const [depth, setDepth] = useState(1);
  const [local, setLocal] = useState(!!localTo);
  const [panel, setPanel] = useState(typeof innerWidth === "number" && innerWidth >= 900);
  const center = localTo ?? ui.noteId;

  const graph = useMemo(() => {
    const f = matcher(parseQuery(q), v.folderMap, v.spaceMap);
    const text = parseQuery(q).text.toLowerCase();
    let notes = v.notes.filter((n) => (ui.spaceId === "all" || local || n.spaceId === ui.spaceId) && f(n) && (!text || n.title.toLowerCase().includes(text)));
    if (local && center) {
      const keep = new Set([center]);
      let frontier = [center];
      for (let d = 0; d < depth; d++) {
        const next: string[] = [];
        for (const id of frontier) for (const o of [...(v.outlinks.get(id) ?? []), ...(v.backlinks.get(id) ?? [])]) if (!keep.has(o)) { keep.add(o); next.push(o); }
        frontier = next;
      }
      notes = v.notes.filter((n) => keep.has(n.id));
    }
    const ids = new Set(notes.map((n) => n.id));
    const keyOf = (n: Note) => (colorBy === "space" ? n.spaceId : colorBy === "type" ? n.type : colorBy === "status" ? n.status ?? "none" : n.folderId ?? "root");
    const keys = [...new Set(notes.map(keyOf))];
    const colorFor = (n: Note) => (colorBy === "status" ? STATUS_C[n.status ?? ""] ?? "#6B7280" : PAL[keys.indexOf(keyOf(n)) % PAL.length]);
    const nodes: GNode[] = notes.map((n) => ({ id: n.id, label: n.title, kind: "note", note: n, deg: 0, color: colorFor(n) }));
    const links: GLink[] = [];
    for (const n of notes) for (const o of v.outlinks.get(n.id) ?? []) if (ids.has(o)) links.push({ source: n.id, target: o });
    if (showTags) {
      const tags = new Set(notes.flatMap((n) => n.tags));
      for (const t of tags) nodes.push({ id: `#${t}`, label: `#${t}`, kind: "tag", deg: 0, color: css("--muted") || "#888" });
      for (const n of notes) for (const t of n.tags) links.push({ source: n.id, target: `#${t}`, tag: true });
    }
    const deg = new Map<string, number>();
    for (const l of links) { deg.set(l.source as string, (deg.get(l.source as string) ?? 0) + 1); deg.set(l.target as string, (deg.get(l.target as string) ?? 0) + 1); }
    nodes.forEach((n) => (n.deg = deg.get(n.id) ?? 0));
    const final = orphans ? nodes : nodes.filter((n) => n.deg > 0 || n.id === center);
    const legend = colorBy === "status" ? Object.entries(STATUS_C) : keys.slice(0, 10).map((k) => [colorBy === "space" ? `${v.spaceMap.get(k)?.icon ?? ""} ${v.spaceMap.get(k)?.name ?? k}` : colorBy === "folder" ? v.folderMap.get(k)?.name ?? "(root)" : k, PAL[keys.indexOf(k) % PAL.length]] as [string, string]);
    return { nodes: final, links: links.filter((l) => final.some((n) => n.id === l.source) && final.some((n) => n.id === l.target)), legend };
  }, [v, q, showTags, orphans, colorBy, local, depth, center, ui.spaceId]);

  return (
    <div className="relative h-full">
      <Canvas2D nodes={graph.nodes} links={graph.links} focus={local ? center : null} />
      <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
        <IconButton label="Graph settings" active={panel} className="bg-surface border border-line" onClick={() => setPanel((p) => !p)}><SlidersHorizontal size={17} /></IconButton>
        {panel && (
          <div className="w-64 space-y-3 rounded-[12px] border border-line bg-surface/95 p-3 text-[13px] shadow-xl backdrop-blur fade-in">
            <input className={inputCls + " h-8"} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter: text tag:x type:lesson" />
            <Segmented value={local ? "local" : "global"} onChange={(x) => setLocal(x === "local")} options={[{ value: "global", label: "Global" }, { value: "local", label: <><Crosshair size={12} /> Local</> }]} />
            {local && (
              <label className="flex items-center gap-2 text-muted">Depth
                <input type="range" min={1} max={3} value={depth} onChange={(e) => setDepth(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
                <span className="w-3 tabular-nums text-ink">{depth}</span></label>
            )}
            <label className="flex items-center justify-between"><span>Show tags</span><input type="checkbox" checked={showTags} onChange={(e) => setShowTags(e.target.checked)} className="accent-[var(--accent)]" /></label>
            <label className="flex items-center justify-between"><span>Show orphans</span><input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} className="accent-[var(--accent)]" /></label>
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wider text-muted">Color by</div>
              <Segmented<ColorBy> value={colorBy} onChange={setColorBy} options={[{ value: "space", label: "Space" }, { value: "folder", label: "Folder" }, { value: "type", label: "Type" }, { value: "status", label: "Status" }]} />
            </div>
            <div className="space-y-1">
              {graph.legend.map(([k, c]) => <div key={k} className="flex items-center gap-2 text-[12px] text-muted"><span className="size-2.5 rounded-full" style={{ background: c }} /><span className="truncate">{k}</span></div>)}
            </div>
            <div className="text-[11.5px] text-muted">{graph.nodes.length} nodes · {graph.links.length} links. Drag to move, scroll to zoom, click to open.</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Canvas2D({ nodes, links, focus }: { nodes: GNode[]; links: GLink[]; focus: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<GNode | null>(null);
  const st = useRef({ x: 0, y: 0, k: 1, sim: null as Simulation<GNode, GLink> | null, drag: null as GNode | null, pan: null as { x: number; y: number } | null, moved: false, hover: null as GNode | null });

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const s = st.current;
    const dpr = devicePixelRatio || 1;
    const resize = () => { cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; if (!s.x) { s.x = cv.clientWidth / 2; s.y = cv.clientHeight / 2; } };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    const linkArr = links.map((l) => ({ ...l }));
    const sim = forceSimulation(nodes)
      .force("link", forceLink<GNode, GLink>(linkArr).id((d) => d.id).distance((l) => (l.tag ? 50 : 80)))
      .force("charge", forceManyBody().strength(-160))
      .force("center", forceCenter(0, 0))
      .force("x", forceX(0).strength(0.04)).force("y", forceY(0).strength(0.04))
      .force("collide", forceCollide<GNode>((d) => 6 + Math.sqrt(d.deg) * 3));
    s.sim = sim;

    const neighbors = (n: GNode | null) => {
      if (!n) return null;
      const set = new Set([n.id]);
      for (const l of linkArr) { const a = (l.source as GNode).id, b = (l.target as GNode).id; if (a === n.id) set.add(b); if (b === n.id) set.add(a); }
      return set;
    };
    let raf = 0;
    const draw = () => {
      const w = cv.width, h = cv.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(dpr * s.k, 0, 0, dpr * s.k, dpr * s.x, dpr * s.y);
      const hl = neighbors(s.hover);
      const muted = css("--border") || "#333";
      const accent = css("--accent") || "#f2a93b";
      ctx.lineWidth = 1 / s.k;
      for (const l of linkArr) {
        const a = l.source as GNode, b = l.target as GNode;
        const on = hl && hl.has(a.id) && hl.has(b.id);
        ctx.strokeStyle = on ? accent : muted;
        ctx.globalAlpha = hl && !on ? 0.15 : l.tag ? 0.35 : 0.8;
        ctx.beginPath(); ctx.moveTo(a.x!, a.y!); ctx.lineTo(b.x!, b.y!); ctx.stroke();
      }
      const text = css("--text") || "#ddd";
      for (const n of nodes) {
        const r = (n.kind === "tag" ? 3 : 4) + Math.sqrt(n.deg) * 2;
        ctx.globalAlpha = hl && !hl.has(n.id) ? 0.2 : 1;
        ctx.fillStyle = n.id === focus || n === s.hover ? accent : n.color;
        ctx.beginPath(); ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2); ctx.fill();
        if (n.note?.type === "moc" || n.note?.type === "roadmap") { ctx.strokeStyle = accent; ctx.lineWidth = 2 / s.k; ctx.stroke(); ctx.lineWidth = 1 / s.k; }
        if (s.k > 0.7 || n.deg > 4 || (hl && hl.has(n.id))) {
          ctx.fillStyle = text;
          ctx.font = `${12 / Math.max(s.k, 0.7)}px Inter, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(n.label.length > 28 ? n.label.slice(0, 27) + "…" : n.label, n.x!, n.y! + r + 12 / Math.max(s.k, 0.7));
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); sim.stop(); ro.disconnect(); };
  }, [nodes, links, focus]);

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    const s = st.current;
    return { x: (e.clientX - r.left - s.x) / s.k, y: (e.clientY - r.top - s.y) / s.k };
  };
  const pick = (e: { clientX: number; clientY: number }) => {
    const p = toWorld(e);
    let best: GNode | null = null, bd = Infinity;
    for (const n of nodes) { const d = (n.x! - p.x) ** 2 + (n.y! - p.y) ** 2; if (d < bd) { bd = d; best = n; } }
    return best && bd < (14 / st.current.k) ** 2 + 100 ? best : null;
  };

  return (
    <>
      <canvas
        ref={ref}
        className="h-full w-full touch-none bg-bg"
        style={{ cursor: hover ? "pointer" : "grab" }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const s = st.current;
          s.moved = false;
          const n = pick(e);
          if (n) { s.drag = n; n.fx = n.x; n.fy = n.y; s.sim?.alphaTarget(0.3).restart(); }
          else s.pan = { x: e.clientX - s.x, y: e.clientY - s.y };
        }}
        onPointerMove={(e) => {
          const s = st.current;
          if (s.drag) { const p = toWorld(e); s.drag.fx = p.x; s.drag.fy = p.y; s.moved = true; }
          else if (s.pan) { s.x = e.clientX - s.pan.x; s.y = e.clientY - s.pan.y; s.moved = true; }
          else { const n = pick(e); s.hover = n; setHover(n); }
        }}
        onPointerUp={() => {
          const s = st.current;
          if (s.drag) {
            if (!s.moved && s.drag.note) openNote(s.drag.note.id);
            s.drag.fx = null; s.drag.fy = null; s.sim?.alphaTarget(0); s.drag = null;
          }
          s.pan = null;
        }}
        onWheel={(e) => {
          const s = st.current;
          const r = ref.current!.getBoundingClientRect();
          const mx = e.clientX - r.left, my = e.clientY - r.top;
          const k = Math.min(4, Math.max(0.1, s.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
          s.x = mx - ((mx - s.x) * k) / s.k; s.y = my - ((my - s.y) * k) / s.k; s.k = k;
        }}
      />
      {hover?.note && (
        <div className={cx("pointer-events-none absolute bottom-4 left-4 max-w-xs rounded-[12px] border border-line bg-surface p-3 text-[12.5px] shadow-xl fade-in")}>
          <div className="font-semibold">{hover.note.title}</div>
          <div className="text-muted">{hover.note.type}{hover.note.status ? ` · ${hover.note.status}` : ""} · {hover.deg} links</div>
          <div className="mt-1 line-clamp-3 text-muted">{hover.note.body.slice(0, 200)}</div>
        </div>
      )}
    </>
  );
}
