// Learning path · Graph (PathDesk "graph", R4-14E + 14b Graphs & connections): left → right by stage ("Step N · name"),
// sub-columns by prerequisite depth inside a stage, course colour bars + stage badge, focus chain, collapse a stage into a
// summary node, minimap, zoom/fit, collapsible legend.
// Round 4 · 14b: one connection language (prerequisite / recommended order / related / added in this path / implied), the
// Display panel (layout By stage · Top-down · Free, edge shape, show-links toggles with counts, Group by stage, Bundle
// links between stages, Dim outside focus, Keep pinned cards, spacing), "Hide implied links" (transitive reduction; an
// implied link comes back as faint dots while either end is hovered), Tidy up (preview → Apply → Undo), drag-to-connect
// with live checks (valid → "Becomes a prerequisite", loop refused naming the chain, already implied asks first,
// duplicate does nothing) and the link menu (change type, reverse, remove: path links rewrite the path, course links
// rewrite that course's roadmap).
import { Background, BackgroundVariant, Handle, MiniMap, Position, ReactFlow, useReactFlow, type Connection, type Edge, type Node as RFNode, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronsLeft, Minus, Plus, SlidersHorizontal, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { Glyph } from "../components/Glyph";
import { TidyBanner, isTidyKey, type TidyStats } from "../components/graph-display";
import { DropTag, LinkMenu, LinkTip, PrereqDisplayPanel, PrereqDisplaySheet, dropBorder, dropLineColor, dropState, linkLook, prereqEdgeTypes, usePrereqDisplay, type DropState, type PrereqEdgeData, type PrereqLayout } from "../components/prereq-ui";
import { cx } from "../components/ui";
import { updateNote } from "../lib/actions";
import { setTopicLink } from "../lib/parse";
import { addConceptNeed, conceptCourses, focusChain, graphLayout, pathLinkKind, setConceptLink, type BuiltConcept, type BuiltPath } from "../lib/path";
import { arrow, checkLink, crossings, LINK_LABEL, impliedLinks, linkMessage, needPath, type LinkCheck, type LinkKind } from "../lib/prereq-graph";
import { toast } from "../lib/store";
import { tidy } from "../lib/graph-layout";
import { announce } from "./dnd-parts";
import { shortStage, StatusIcon, useStored } from "./path-ui";
import { usePhone } from "./spaces-util";
import { t, useLang } from "../lib/i18n";

type P = { x: number; y: number };
type CData = { c: BuiltConcept; stageNo: number; chain: boolean; inFocus: boolean; sel: boolean; vertical: boolean; drop: DropState; pinned: boolean; dimOff: boolean };
type HData = { stage: number; name: string; width: number; onCollapse: () => void; vertical: boolean };
type SData = { stage: number; name: string; count: number; onExpand: () => void; vertical: boolean };
const NW = 176, NH = 46;

const CNode = memo(({ data }: NodeProps<RFNode<CData>>) => {
  useLang();
  const { c, chain, sel, inFocus, vertical, drop, pinned, dimOff } = data;
  const done = c.status === "done";
  const bars = conceptCourses(c).slice(0, 3);
  const op = dimOff ? (c.status === "locked" ? 0.62 : 1) : chain ? 1 : c.status === "locked" ? 0.4 : !inFocus ? 0.35 : done ? 0.9 : 0.75;
  return (
    <div className="relative">
      {drop === "valid" && <DropTag />}
      <div className="flex h-[46px] w-[176px] overflow-hidden rounded-[10px]" data-gnode={c.key}
        style={{ background: done ? "color-mix(in srgb,var(--success) 10%,var(--surface))" : "var(--surface)", border: dropBorder(drop) ?? (chain || sel ? "1.5px solid var(--accent)" : "1px solid var(--border)"), boxShadow: sel ? "0 0 0 4px color-mix(in srgb,var(--accent) 18%,transparent)" : "none", opacity: drop ? 1 : op }}>
        {/* the whole card is the drop target for "this needs …"; the dot on the outgoing side starts the drag */}
        <Handle type="target" position={vertical ? Position.Top : Position.Left} isConnectableStart={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", transform: "none", left: 0, top: 0, border: 0, background: "transparent", borderRadius: 10, opacity: 0 }} />
        <span className="flex w-1 shrink-0 flex-col">{(bars.length ? bars : [{ key: "-", color: "var(--border)" }]).map((b) => <span key={b.key} className="flex-1" style={{ background: b.color }} />)}</span>
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
          <StatusIcon c={c} size={14} />
          <span className="min-w-0 flex-1 truncate font-semibold" dir="auto" title={c.def.name}>{c.def.name}</span>
          <span className="text-[10.5px] font-semibold text-muted">{data.stageNo ? t("S{n}", { n: data.stageNo }) : "—"}</span>
        </div>
        <Handle type="source" position={vertical ? Position.Bottom : Position.Right} title={t("Drag onto a concept to make this its prerequisite")} className="pdnd-src"
          style={{ width: 10, height: 10, ...(vertical ? { bottom: -6 } : { right: -6 }), background: "var(--accent)", border: "2px solid var(--bg)", cursor: "crosshair" }} />
      </div>
      {pinned && <span title={t("Pinned: Tidy up keeps it here")} className="pointer-events-none absolute -right-1.5 -top-1.5 size-2.5 rounded-full bg-accent shadow-[0_0_0_2px_var(--bg)]" />}
    </div>
  );
});
const HNode = memo(({ data }: NodeProps<RFNode<HData>>) => { useLang(); return (
  <div className="group flex flex-col gap-0.5" style={{ width: data.width }}>
    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t("Step {n}", { n: data.stage + 1 })}
      <button title={t("Collapse this stage")} aria-label={t("Collapse step {n}", { n: data.stage + 1 })} onClick={data.onCollapse} className="nodrag opacity-0 hover:text-ink group-hover:opacity-100"><ChevronsLeft size={13} /></button></span>
    <span className="truncate font-[650]" dir="auto">{shortStage(data.name)}</span>
  </div>
); });
const SNode = memo(({ data }: NodeProps<RFNode<SData>>) => { useLang(); return (
  <div className="flex w-[150px] flex-col gap-1 rounded-[12px] border border-dashed border-line bg-surface px-3 py-2.5">
    <Handle type="target" position={data.vertical ? Position.Top : Position.Left} isConnectable={false} style={{ opacity: 0 }} />
    <span className="truncate font-[650]" dir="auto">{t("Step {n} · {name}", { n: data.stage + 1, name: shortStage(data.name) })}</span>
    <span className="text-[12px] text-muted">{t("{n} concept|{n} concepts", { n: data.count })} · {t("collapsed")}</span>
    <button onClick={data.onExpand} className="nodrag self-start text-[12px] text-link hover:underline">{t("Expand")}</button>
    <Handle type="source" position={data.vertical ? Position.Bottom : Position.Right} isConnectable={false} style={{ opacity: 0 }} />
  </div>
); });
const nodeTypes = { concept: CNode, head: HNode, summary: SNode };

type EKind = LinkKind | "added" | "implied";
interface MenuState { x: number; y: number; from: BuiltConcept; to: BuiltConcept; kind: LinkKind; own: boolean; id: string }

/** Course roadmap lines that write the link to → from (a topic of `to` listing a topic name that is `from`). */
function courseSites(to: BuiltConcept, from: BuiltConcept) {
  const names = new Set([from.key, from.def.name, ...from.def.aliases, ...from.coverage.map((x) => x.topic.name)].map((s) => s.toLowerCase().trim()));
  const out: { note: Note; line: number; name: string; course: string }[] = [];
  for (const cov of to.coverage) {
    const n = cov.course.note;
    if (!n) continue;
    for (const k of ["needs", "after", "related"] as const) for (const name of cov.topic[k] ?? []) {
      if (names.has(name.toLowerCase().trim())) out.push({ note: n, line: cov.topic.line, name, course: cov.course.spaceName });
    }
  }
  return out;
}

export function Graph({ path, note, save, onOpen, sel, keep, focus, setFocus }: { path: BuiltPath; note: Note; save: (b: string) => void; onOpen: (k: string) => void; sel: string | null; keep: (c: BuiltConcept) => boolean; focus: string | null; setFocus: (k: string | null) => void }) {
  const phone = usePhone();
  const rf = useReactFlow();
  const box = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useStored<string[]>(`lumen.path.gcol.${note.id}`, []);
  const [legend, setLegend] = useStored<boolean>("lumen.path.legend", !phone);
  const [panel, setPanel] = useStored<boolean>("lumen.path.display", false);
  const [sheet, setSheet] = useState(false);
  const [disp, setDisp] = usePrereqDisplay("path");
  const [manual, setManual] = useStored<Record<string, P>>(`lumen.path.gpos.${note.id}`, {});
  const [pins, setPins] = useStored<string[]>(`lumen.path.gpin.${note.id}`, []);
  const [tidied, setTidied] = useStored<boolean>(`lumen.path.tidy.${note.id}`, false);
  const [preview, setPreview] = useState<{ pos: Map<string, P>; stats: TidyStats } | null>(null);
  const [courses, setCourses] = useState(false);
  const [only, setOnly] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; from: string; over: string | null } | null>(null);
  const [ask, setAsk] = useState<{ from: string; to: string; x: number; y: number } | null>(null);
  const focusKey = focus ?? sel;
  const chain = useMemo(() => focusChain(path, focusKey), [path, focusKey]);
  const vertical = disp.layout === "top";
  const free = disp.layout === "free";
  const radial = disp.layout === "radial";
  const pinSet = useMemo(() => new Set(pins), [pins]);
  const needsOf = useMemo(() => (k: string) => path.byKey.get(k)?.needs ?? [], [path]);
  const implied = useMemo(() => impliedLinks(path.concepts.map((c) => c.key), needsOf), [path, needsOf]);

  const layoutFor = (untangle: boolean) => graphLayout(path, (c) => keep(c) && (!only || !focusKey || chain.has(c.key)), new Set(collapsed), { byStage: disp.group, untangle, roomy: disp.roomy });
  const L = useMemo(() => layoutFor(tidied), [path, keep, only, focusKey, chain, collapsed, disp.group, disp.roomy, tidied]); // eslint-disable-line react-hooks/exhaustive-deps

  // Top-down = the same layout turned a quarter: stages become rows, headers sit on the left of each row.
  const rowH = disp.roomy ? 92 : 68, colW = disp.roomy ? NW + 38 * 2.2 : 214;
  const HEADW = 150, VSTEP = disp.roomy ? 124 : 96, HSTEP = NW + (disp.roomy ? 40 : 20);
  const turn = (p: P): P => (vertical ? { x: 24 + HEADW + ((p.y - 72) / rowH) * HSTEP, y: 72 + ((p.x - 24) / colW) * VSTEP } : p);
  const basePos = useMemo(() => new Map(L.nodes.map((n) => [n.key, turn({ x: n.x, y: n.y })])), [L, vertical]); // eslint-disable-line react-hooks/exhaustive-deps
  const posOf = (k: string): P | undefined => preview?.pos.get(k) ?? (free ? manual[k] : undefined) ?? radialPos?.get(k) ?? basePos.get(k);

  // ------------------------------------------------------------ links (one connection language, 14b · 1)
  const linkList = useMemo(() => {
    const visible = new Set(L.nodes.map((n) => n.key));
    const idOf = (k: string) => L.summary.get(k) ?? (visible.has(k) ? k : null);
    const out: { id: string; src: string; dst: string; kind: EKind; from: BuiltConcept; to: BuiltConcept }[] = [];
    const seen = new Set<string>();
    const push = (from: BuiltConcept, to: BuiltConcept, kind: EKind) => {
      const src = idOf(from.key), dst = idOf(to.key);
      if (!src || !dst || src === dst) return;
      const pair = kind === "related" ? [src, dst].sort().join("~") : `${src}>${dst}`;
      if (seen.has(pair)) return;
      seen.add(pair);
      out.push({ id: `${kind}:${src}>${dst}`, src, dst, kind, from, to });
    };
    for (const to of path.concepts) {
      for (const k of to.needs) { const from = path.byKey.get(k); if (from) push(from, to, implied.has(`${k}>${to.key}`) ? "implied" : pathLinkKind(to, from) === "needs" ? "added" : "needs"); }
      for (const k of to.after) { const from = path.byKey.get(k); if (from) push(from, to, "after"); }
      for (const k of to.related) { const from = path.byKey.get(k); if (from) push(from, to, "related"); }
    }
    return out;
  }, [path, L, implied]);
  const counts = useMemo(() => {
    const n = { needs: 0, after: 0, related: 0, added: 0, implied: 0 };
    for (const l of linkList) n[l.kind]++;
    return n;
  }, [linkList]);
  const showKind = (l: { kind: EKind; from: BuiltConcept; to: BuiltConcept }) =>
    l.kind === "implied" ? disp.implied || hover === l.from.key || hover === l.to.key : l.kind === "added" ? disp.added : disp[l.kind];

  // Radial: rings of concepts around the focused (or best-connected) one, from the notes-graph layout engine
  const radialPos = useMemo(() => radial ? tidy(L.nodes.map((n) => ({ id: n.key, x: n.x, y: n.y, w: NW, h: NH })), linkList.filter((l) => l.kind !== "implied").map((l) => [l.src, l.dst] as [string, string]), { mode: "radial", center: focusKey ?? undefined, spacing: disp.roomy ? 1.5 : 1.1 }).pos : null, [radial, L, linkList, focusKey, disp.roomy]);

  const { nodes, edges } = useMemo(() => {
    const nodes: RFNode[] = [];
    for (const col of radial ? [] : L.cols) {
      const at = turn({ x: col.x, y: 14 });
      if (col.collapsed) {
        nodes.push({ id: `stage:${col.name}`, type: "summary", position: vertical ? { x: 24 + HEADW, y: at.y } : { x: col.x, y: 300 }, data: { stage: col.stage, name: col.name, count: col.count, vertical, onExpand: () => setCollapsed((o) => o.filter((x) => x !== col.name)) } satisfies SData, draggable: false, selectable: false, connectable: false });
      } else if (disp.group) {
        nodes.push({ id: `head:${col.name}`, type: "head", position: vertical ? { x: 24, y: at.y + 2 } : { x: col.x, y: 14 }, data: { stage: col.stage, name: col.name, width: vertical ? HEADW - 16 : Math.max(NW, col.width), vertical, onCollapse: () => setCollapsed((o) => [...o, col.name]) } satisfies HData, draggable: false, selectable: false, connectable: false });
      }
    }
    const over = drag?.over && drag.over !== drag.from ? drag.over : ask?.to ?? null;
    const overCk: LinkCheck | null = drag?.over ? checkLink(needsOf, drag.from, drag.over) : ask ? { kind: "implied", chain: [] } : null;
    for (const n of L.nodes) {
      const c = path.byKey.get(n.key)!;
      nodes.push({ id: c.key, type: "concept", position: posOf(c.key)!, width: NW, height: NH, draggable: free && !preview,
        data: { c, stageNo: c.placed ? c.stageIndex + 1 : 0, chain: !!focusKey && chain.has(c.key), inFocus: !focusKey || chain.has(c.key) || !only, sel: c.key === sel, vertical, drop: c.key === over ? dropState(overCk) : null, pinned: free && pinSet.has(c.key), dimOff: !disp.dim } satisfies CData });
    }
    // gutter for bundled links: the middle of the card rows (left → right) or columns (top-down)
    const ps = [...basePos.values()];
    const mid = ps.length ? (vertical ? (Math.min(...ps.map((p) => p.x)) + Math.max(...ps.map((p) => p.x)) + NW) / 2 : (Math.min(...ps.map((p) => p.y)) + Math.max(...ps.map((p) => p.y)) + NH) / 2) : 0;
    const edges: Edge<PrereqEdgeData>[] = [];
    for (const l of linkList) {
      if (!showKind(l)) continue;
      const foc = !!focusKey && chain.has(l.from.key) && chain.has(l.to.key);
      const look = linkLook(l.kind, l.from.status, l.to.status === "locked");
      const isSel = menu?.id === l.id;
      const hoverImplied = l.kind === "implied" && !disp.implied;
      const opacity = isSel ? 1 : hoverImplied ? 0.7 : !disp.dim || !focusKey ? look.opacity : foc ? 1 : 0.28;
      const crossStage = l.from.stageIndex !== l.to.stageIndex;
      edges.push({ id: l.id, source: l.src, target: l.dst, type: "prereq", interactionWidth: 14, className: "prq-edge",
        data: { shape: disp.edges, vertical, bundleAt: disp.bundle && disp.group && crossStage ? mid : null, color: isSel ? "var(--accent)" : foc && l.kind !== "related" && l.kind !== "implied" ? "var(--accent)" : look.color, width: isSel ? 3 : foc ? 2 : look.width, dash: look.dash, opacity, arrow: look.arrow } });
    }
    return { nodes, edges };
  }, [path, L, chain, focusKey, sel, only, disp, linkList, hover, menu, drag, ask, basePos, manual, preview, pinSet]); // eslint-disable-line react-hooks/exhaustive-deps

  // focus: centre the chain
  useEffect(() => {
    if (!focus) return;
    const t = setTimeout(() => void rf.fitView({ nodes: [...chain].map((id) => ({ id })), padding: 0.2, maxZoom: 1, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ connect (14b-H…K)
  const nameOf = (k: string) => path.byKey.get(k)?.def.name ?? k;
  const addLink = (fromKey: string, toKey: string) => {
    const pre = path.byKey.get(fromKey), c = path.byKey.get(toKey);
    if (!pre || !c) return;
    save(addConceptNeed(note.body, c, pre));
    announce(t("{a} now needs {b}", { a: c.def.name, b: pre.def.name }));
  };
  const tipAt = (k: string) => {
    const p = posOf(k), vp = rf.getViewport(), w = box.current?.clientWidth ?? 800;
    return p ? { x: Math.max(8, Math.min(w - 310, (p.x + NW + 16) * vp.zoom + vp.x)), y: Math.max(8, (p.y - 6) * vp.zoom + vp.y) } : { x: 16, y: 16 };
  };
  const endConnect = () => {
    const d = drag;
    setDrag(null);
    if (!d?.over || d.over === d.from) return;
    const ck = checkLink(needsOf, d.from, d.over);
    if (ck.kind === "valid") return; // onConnect writes it
    const m = linkMessage(ck, nameOf, d.from, d.over);
    if (ck.kind === "loop" && m) { toast(`${m.title}: ${m.body}`, undefined, { icon: "error" }); announce(`${m.title}. ${m.body}`); }
    else if (ck.kind === "implied") setAsk({ from: d.from, to: d.over, ...tipAt(d.over) });
  };
  const connect = (cn: Connection) => {
    if (!cn.source || !cn.target) return;
    if (checkLink(needsOf, cn.source, cn.target).kind === "valid") addLink(cn.source, cn.target);
  };
  const trackOver = (clientX: number, clientY: number, target: Element | null) => {
    if (!drag) return;
    const r = box.current!.getBoundingClientRect();
    const el = target?.closest?.("[data-gnode]") ?? document.elementFromPoint(clientX, clientY)?.closest("[data-gnode]");
    const over = el?.getAttribute("data-gnode") ?? null;
    setDrag({ ...drag, x: clientX - r.left, y: clientY - r.top, over });
  };
  const overCheck = drag?.over && drag.over !== drag.from ? checkLink(needsOf, drag.from, drag.over) : null;
  const overState = dropState(overCheck);
  const overMsg = overCheck && drag?.over ? linkMessage(overCheck, nameOf, drag.from, drag.over) : null;

  // ------------------------------------------------------------ link menu (14b-L / P2)
  const openMenu = (e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    const l = linkList.find((x) => x.id === edge.id);
    if (!l || l.src !== l.from.key || l.dst !== l.to.key) return; // links into a collapsed stage summary have no menu
    const r = box.current!.getBoundingClientRect();
    const kind: LinkKind = l.kind === "after" || l.kind === "related" ? l.kind : "needs";
    setMenu({ x: Math.min(e.clientX - r.left + 12, r.width - 236), y: Math.min(e.clientY - r.top + 8, r.height - 210), from: l.from, to: l.to, kind, own: pathLinkKind(l.to, l.from) === kind, id: l.id });
  };
  const sites = menu && !menu.own ? courseSites(menu.to, menu.from) : [];
  const writeCourse = (k: LinkKind | null) => {
    const byNote = new Map<string, { note: Note; body: string }>();
    for (const s of sites) { const cur = byNote.get(s.note.id) ?? { note: s.note, body: s.note.body }; cur.body = setTopicLink(cur.body, s.line, s.name, k); byNote.set(s.note.id, cur); }
    for (const { note: n, body } of byNote.values()) if (body !== n.body) void updateNote(n.id, { body });
  };
  const setKind = (k: LinkKind) => {
    if (!menu) return;
    if (menu.own || !sites.length) save(setConceptLink(note.body, menu.to, menu.from, k)); else writeCourse(k);
    announce(`${menu.from.def.name}${arrow()}${menu.to.def.name}: ${t(LINK_LABEL[k])}`);
    setMenu(null);
  };
  const remove = () => {
    if (!menu) return;
    if (menu.own || !sites.length) save(setConceptLink(note.body, menu.to, menu.from, null)); else writeCourse(null);
    announce(t("Removed {link}", { link: `${menu.from.def.name}${arrow()}${menu.to.def.name}` }));
    setMenu(null);
  };
  const reverse = () => {
    if (!menu) return;
    const { from, to, kind } = menu;
    // a reversed prerequisite must not close a loop through the other links
    const without = (k: string) => (k === to.key ? needsOf(k).filter((n) => n !== from.key) : needsOf(k));
    if (kind === "needs" && needPath(without, to.key, from.key)) { toast(t("Can't reverse: {a} still needs {b} through other links, so this would make a loop.", { a: to.def.name, b: from.def.name }), undefined, { icon: "error" }); return setMenu(null); }
    let body = note.body;
    if (menu.own || !sites.length) body = setConceptLink(body, to, from, null); else writeCourse(null);
    save(setConceptLink(body, from, to, kind));
    announce(t("Reversed: {link}", { link: `${to.def.name}${arrow()}${from.def.name}` }));
    setMenu(null);
  };

  // ------------------------------------------------------------ Tidy up (preview → Apply → Undo)
  const startTidy = () => {
    if (preview || !L.nodes.length) return;
    const T = layoutFor(true);
    const keepPins = disp.keepPinned && free;
    const next = new Map<string, P>();
    for (const n of T.nodes) next.set(n.key, keepPins && pinSet.has(n.key) && manual[n.key] ? manual[n.key] : turn({ x: n.x, y: n.y }));
    const moved = T.nodes.filter((n) => { const a = posOf(n.key), b = next.get(n.key)!; return !a || Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1; }).length;
    const pairs = linkList.filter((l) => l.kind !== "related" && (l.kind !== "implied" || disp.implied)).map((l) => [l.src, l.dst] as [string, string]);
    const before = crossings(pairs, (k) => posOf(k)), after = crossings(pairs.filter(([a, b]) => !implied.has(`${a}>${b}`)), (k) => next.get(k));
    const pinned = keepPins ? T.nodes.filter((n) => pinSet.has(n.key) && manual[n.key]).length : 0;
    setPreview({ pos: next, stats: { moved, before, after, pinned, label: counts.implied && disp.implied ? t("hides {n} implied link|hides {n} implied links", { n: counts.implied }) : undefined } });
  };
  const applyTidy = () => {
    if (!preview) return;
    const prev = { manual, pins, tidied, implied: disp.implied };
    const keepPins = disp.keepPinned && free;
    setManual(keepPins ? Object.fromEntries(Object.entries(manual).filter(([k]) => pinSet.has(k))) : {});
    if (!keepPins) setPins([]);
    setTidied(true);
    setDisp({ implied: false });
    toast(t("Tidied up · {n} card moved|Tidied up · {n} cards moved", { n: preview.stats.moved }), { label: t("Undo"), run: () => { setManual(prev.manual); setPins(prev.pins); setTidied(prev.tidied); setDisp({ implied: prev.implied }); } });
    setPreview(null);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (isTidyKey(e)) { e.preventDefault(); startTidy(); }
      else if (e.key === "Escape" && preview) setPreview(null);
      else if (e.key === "Enter" && preview && !(e.target as HTMLElement)?.closest?.("input,textarea,button")) { e.preventDefault(); applyTidy(); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });
  useEffect(() => setPreview(null), [path, disp.layout, disp.group, disp.roomy]);

  // phone: fit the first columns (left → right) or the first rows (top-down) so cards stay readable
  const firstCols = L.nodes.filter((n) => { const q = basePos.get(n.key) ?? n; return vertical ? q.y <= 72 + VSTEP * 3 : q.x <= (phone ? 250 : 1000); }).map((n) => ({ id: n.key }));
  useEffect(() => {
    if (!phone) return;
    const t = setTimeout(() => {
      // top-down rows are wide: start at the top-left corner, sized to show the stage label + ~2 cards
      if (vertical) void rf.setViewport({ x: 0, y: 0, zoom: Math.min(1, Math.max(0.4, (box.current?.clientWidth ?? 412) / (24 + HEADW + 2.2 * HSTEP))) }, { duration: 200 });
      else void rf.fitView({ padding: 0.08, maxZoom: 1, minZoom: 0.45, nodes: firstCols.length ? firstCols : undefined, duration: 200 });
    }, 80);
    return () => clearTimeout(t);
  }, [disp.layout, disp.group, disp.roomy]); // eslint-disable-line react-hooks/exhaustive-deps
  const fitOpts = { padding: phone ? 0.08 : 0.06, maxZoom: 1, minZoom: 0.45, nodes: firstCols.length ? firstCols : undefined };
  const fc = focusKey ? path.byKey.get(focusKey) : null;
  const inset = panel && !phone ? 300 : 0;
  const { rtl } = useLang();

  return (
    <div ref={box} className="pdnd-flow lm-flow lp-graph relative h-full min-h-[420px]"
      onMouseMove={(e) => drag && trackOver(e.clientX, e.clientY, e.target as Element)}
      onTouchMove={(e) => { const t = e.touches[0]; if (drag && t) trackOver(t.clientX, t.clientY, null); }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={prereqEdgeTypes} {...(phone && !vertical ? { fitView: true, fitViewOptions: fitOpts } : { defaultViewport: { x: 0, y: 0, zoom: phone ? 0.55 : 1 } })} minZoom={0.1} proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => { setMenu(null); setAsk(null); if (n.type === "concept") onOpen(n.id); }}
        onNodeMouseEnter={(_, n) => n.type === "concept" && setHover(n.id)} onNodeMouseLeave={() => setHover(null)}
        onNodeDragStop={(_, n) => { if (!free || n.type !== "concept") return; setManual((m) => ({ ...m, [n.id]: n.position })); if (!pinSet.has(n.id)) setPins((p) => [...p, n.id]); }}
        onNodeContextMenu={(e, n) => { if (!free || n.type !== "concept") return; e.preventDefault(); const on = pinSet.has(n.id); setPins((p) => (on ? p.filter((x) => x !== n.id) : [...p, n.id])); toast(on ? t("Unpinned · Tidy up may move it") : t("Pinned · Tidy up keeps it here")); }}
        nodesConnectable connectOnClick={false} onConnect={connect}
        onConnectStart={(e, p) => { setAsk(null); setMenu(null); const r = box.current!.getBoundingClientRect(); const ev = "touches" in e ? e.touches[0] : e; if (p.nodeId) setDrag({ x: ev.clientX - r.left, y: ev.clientY - r.top, from: p.nodeId, over: null }); }}
        onConnectEnd={endConnect}
        isValidConnection={(c) => checkLink(needsOf, c.source, c.target).kind === "valid"}
        connectionLineStyle={{ stroke: dropLineColor(overState), strokeWidth: 2, strokeDasharray: "6 5" }}
        onEdgeClick={openMenu} onEdgeContextMenu={openMenu} onPaneClick={() => { setMenu(null); setAsk(null); }}>
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="color-mix(in srgb, var(--muted) 30%, transparent)" />
        {!phone && <MiniMap position={rtl ? "bottom-left" : "bottom-right"} pannable zoomable style={{ width: 168, height: 96, margin: 16, [rtl ? "marginLeft" : "marginRight"]: 16 + inset, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", overflow: "hidden" }}
          nodeColor={(n) => (n.type === "concept" ? ((n.data as CData).c.status === "done" ? "var(--success)" : "var(--muted)") : n.type === "summary" ? "var(--border)" : "transparent")} nodeBorderRadius={2}
          maskColor="transparent" maskStrokeColor="var(--accent)" maskStrokeWidth={3} bgColor="var(--surface)" />}
      </ReactFlow>

      {/* top-right: focus pill (+ the phone Display button) */}
      <div className="absolute top-3 z-10 flex items-center gap-2" style={{ insetInlineEnd: 16 + inset }}>
        {fc && (
          <div className="flex items-center gap-2 rounded-[10px] border border-line bg-surface px-2.5 py-1 text-[12px]">
            <span className="text-muted">{t("Focus")}</span><b className="font-semibold" dir="auto">{fc.def.name}</b><span className="text-muted">· {t("{n} in chain", { n: chain.size })}</span>
            <button onClick={() => setOnly((o) => !o)} aria-pressed={only} className={cx("rounded-[6px] px-1.5", only ? "bg-accent/15 text-ink" : "text-link")}>{only ? t("Show all") : t("Only this chain")}</button>
            {focus && <button aria-label={t("Clear focus")} onClick={() => { setFocus(null); setOnly(false); }} className="text-muted hover:text-ink"><X size={13} /></button>}
          </div>
        )}
        {phone && <button aria-label={t("Graph display")} onClick={() => setSheet(true)} className="flex size-10 items-center justify-center rounded-[10px] border border-line bg-surface"><SlidersHorizontal size={18} /></button>}
      </div>

      {preview && <TidyBanner stats={preview.stats} onCancel={() => setPreview(null)} onApply={applyTidy} top={phone ? 60 : 56} />}

      {drag && !(overMsg && overState !== "valid") && (
        <div className="pointer-events-none absolute z-30 flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-[12px]" style={{ left: drag.x + 14, top: drag.y + 14, background: "var(--surface-2)", border: `1px solid ${dropLineColor(overState)}`, color: overState && overState !== "valid" ? dropLineColor(overState) : undefined, boxShadow: "0 8px 20px rgba(0,0,0,.35)" }}>
          <span className="size-2.5 rounded-full" style={{ background: dropLineColor(overState) }} />
          {overState === "valid" ? t("{a} will need {b}", { a: nameOf(drag.over!), b: nameOf(drag.from) }) : overMsg ? overMsg.title : t("Drop on a concept to make it a prerequisite")}
        </div>
      )}
      {drag?.over && overMsg && overState && overState !== "valid" && (() => { const tp = tipAt(drag.over); return <LinkTip state={overState} title={overMsg.title} body={overMsg.body} x={tp.x} y={tp.y} />; })()}
      {ask && (() => { const m = linkMessage(checkLink(needsOf, ask.from, ask.to), nameOf, ask.from, ask.to); return m ? <LinkTip state="implied" title={m.title} body={m.body} x={ask.x} y={ask.y} onAdd={() => { addLink(ask.from, ask.to); setAsk(null); }} onCancel={() => setAsk(null)} /> : null; })()}

      {menu && (
        <LinkMenu phone={phone} x={Math.max(8, menu.x)} y={Math.max(8, menu.y)} from={menu.from.def.name} to={menu.to.def.name} kind={menu.kind}
          note={phone ? (menu.own ? t("Added in this path") : sites.length ? t("Prerequisite · added from {names} roadmap", { names: [...new Set(sites.map((s) => s.course))].join(t(", ")) }) : undefined) : undefined}
          onKind={setKind} onReverse={reverse} onRemove={remove} onClose={() => setMenu(null)} />
      )}

      {/* legend (collapsible) */}
      <div className="absolute bottom-4 start-5 z-10 flex max-w-[calc(100%-2.5rem)] flex-col rounded-[10px] border border-line bg-surface text-[12px] text-muted">
        {legend && courses && (
          <div className="flex max-h-[30vh] flex-wrap gap-x-3 gap-y-1.5 overflow-y-auto border-b border-line px-3 py-2">
            {path.courses.map((c) => <span key={c.key} className="flex items-center gap-1.5"><span className="h-2 w-1 rounded-[1px]" style={{ background: c.color }} />{c.spaceName}</span>)}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-3 py-2">
          {legend && (
            <>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-ok" />{t("done")}</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-muted" />{t("needed")}</span>
              {counts.after > 0 && <span className="flex items-center gap-1.5"><svg width="16" height="4" aria-hidden><path d="M1 2H15" stroke="var(--muted)" strokeWidth="2" strokeDasharray="6 5" /></svg>{t("recommended")}</span>}
              {counts.related > 0 && <span className="flex items-center gap-1.5"><svg width="16" height="4" aria-hidden><path d="M1 2H15" stroke="var(--link)" strokeWidth="2" strokeDasharray="1.5 5" strokeLinecap="round" /></svg>{t("related")}</span>}
              <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-accent" />{t("added by you")}</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-accent" />{t("focus chain")}</span>
              <button onClick={() => setCourses((x) => !x)} className="hover:text-ink">{t("{n} course|{n} courses", { n: path.courses.length })}</button>
            </>
          )}
          <button onClick={() => setLegend(!legend)} aria-expanded={legend} aria-label={legend ? t("Hide legend") : t("Show legend")} className="flex items-center gap-1 hover:text-ink">{!legend && t("Legend")}<ChevronDown size={13} className={cx("transition-transform", legend && "rotate-180")} /></button>
        </div>
      </div>

      {/* Display · Tidy up (14b-P3) · zoom + fit */}
      {!phone && !panel && (
        <div className="absolute bottom-4 z-10 flex gap-2" style={{ insetInlineEnd: 196 + 120 }}>
          <button onClick={() => setPanel(true)} className="flex h-[36px] items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 text-[12.5px] text-muted hover:text-ink"><SlidersHorizontal size={14} />{t("Display")}</button>
          <button onClick={startTidy} title={t("Tidy up (Shift T)")} className="flex h-[36px] items-center gap-1.5 rounded-[10px] border border-accent bg-[color-mix(in_srgb,var(--accent)_12%,var(--surface))] px-3 text-[12.5px] font-semibold"><Glyph name="wide" size={14} color="var(--accent)" />{t("Tidy up")}</button>
        </div>
      )}
      <div className="absolute bottom-4 z-10 flex gap-0.5 rounded-[10px] border border-line bg-surface p-[3px]" style={{ insetInlineEnd: phone ? 16 : 196 + inset }}>
        <button aria-label={t("Zoom out")} onClick={() => void rf.zoomOut({ duration: 150 })} className="flex size-7 items-center justify-center rounded-[7px] hover:bg-surface-2"><Minus size={14} /></button>
        <button aria-label={t("Zoom in")} onClick={() => void rf.zoomIn({ duration: 150 })} className="flex size-7 items-center justify-center rounded-[7px] hover:bg-surface-2"><Plus size={14} /></button>
        <button onClick={() => void rf.fitView({ padding: 0.06, duration: 200 })} className="flex h-7 items-center rounded-[7px] px-2 text-[12px] hover:bg-surface-2">{t("Fit")}</button>
      </div>
      {!L.nodes.length && !L.cols.some((c) => c.collapsed) && <div className="absolute inset-0 flex items-center justify-center text-[13px] text-muted">{t("No concepts match the filters.")}</div>}

      {panel && !phone && (
        <PrereqDisplayPanel d={disp} set={setDisp} onClose={() => setPanel(false)} counts={counts}
          o={{ layouts: ["stage", "top", "radial", "free"] as PrereqLayout[], tidy: startTidy, busy: !!preview, pinned: free }} />
      )}
      {sheet && phone && <PrereqDisplaySheet d={disp} set={setDisp} onClose={() => setSheet(false)} tidy={startTidy} />}
    </div>
  );
}
