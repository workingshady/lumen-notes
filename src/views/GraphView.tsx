import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { ArrowLeft, ChevronDown, ChevronUp, ImageDown, Locate, Minus, Plus, Scan, Search, SlidersHorizontal, X } from "lucide-react";
import { openExport } from "../lib/diagram-export";
import { graphSvg } from "../lib/visual-export";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Note } from "../../shared/types";
import { matcher, parseQuery } from "../lib/search";
import { go, openNote, toast, useUI, useVault } from "../lib/store";
import { sharedTagEdges, tagNodeEdges } from "../lib/graph-tags";
import { tidy, type LNode, type TidyMode } from "../lib/graph-layout";
import { vaultChecks } from "../lib/graph-checks";
import { graphProgressive, indexLabel, useIndexStatus } from "../lib/big-vault";
import { plainExcerpt } from "../components/nav-text";
import { cx, STATUS_COLOR } from "../components/ui";
import { SpaceIcon } from "../components/SpaceIcon";
import { EdgeSeg, isTidyKey, LineSample, Seg, Switch, TidyBanner, TidyButton, type EdgeShape, type TidyStats } from "../components/graph-display";
import { fmtNum, t, tk } from "../lib/i18n";
import { reduceEffects, reportDrawTime, setScale, useScale } from "../lib/scale-prefs";
import { BigBar, BIG_PAL, expandFor, FilterFirst, GroupedGraph, HairDots, TooBigBanner, TreeGraph, buildGroups, type BigMode, type Drill } from "./graph-big";
import { Glyph } from "../components/Glyph";

/** Learning status / note type / colour-by labels (the ids are stored values). */
const KEY_NAME: Record<string, string> = { todo: tk("Todo"), learning: tk("Learning"), review: tk("Review"), mastered: tk("Mastered"), none: tk("No status"), moc: tk("Map of content"), folder: tk("Folder"), type: tk("Type"), status: tk("Status"), compact: tk("Compact"), roomy: tk("Roomy") };
const keyName = (k: string) => (KEY_NAME[k] ? t(KEY_NAME[k]) : k.charAt(0).toUpperCase() + k.slice(1));

type GNode = SimulationNodeDatum & { id: string; label: string; kind: "note" | "tag"; note?: Note; deg: number; color: string };
/** `tag`: note -> tag-node edge; `shared`: dashed edge between two notes that share a tag (design 04 D6). */
type GLink = SimulationLinkDatum<GNode> & { tag?: boolean; shared?: boolean };
type ColorBy = "folder" | "type" | "status";
type P = { x: number; y: number };
/** Display panel choices (design 14b · 2 "Display"), saved for the graph view. `free` = live physics. */
type LayoutChoice = "free" | "top" | "radial";
interface Display { layout: LayoutChoice; edges: EdgeShape; links: boolean; tagNodes: boolean; shared: boolean; dim: boolean; keepPinned: boolean; spacing: "compact" | "roomy" }
const DISPLAY_DEFAULT: Display = { layout: "free", edges: "straight", links: true, tagNodes: false, shared: false, dim: true, keepPinned: true, spacing: "compact" };

/** Folder colours in design order (01 cyan, 02 orange, 03 purple, 04 green, 05 yellow, …). */
const FOLDER_PAL = ["#39C5CF", "#E8893A", "#A371F7", "#57AB5A", "#E3B341", "#E5534B", "#7AA2F7", "#D37FB4", "#5CC8C2"];
const MOC_C = "var(--text)", JOURNAL_C = "#6B7280";
const TYPE_C: Record<string, string> = { note: "#9AA0AA", lesson: "#39C5CF", journal: JOURNAL_C, flashcards: "#B48EF0", slides: "#E8893A", post: "#57AB5A", canvas: "#A371F7", whiteboard: "#E3B341", roadmap: "#F2A93B", moc: MOC_C };
const STATUS_C: Record<string, string> = { todo: "#9AA0AA", learning: "#7AA2F7", review: "#E8B34A", mastered: "#6BCB8B", none: "#4B5260" };
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
/** Canvas can't paint `var(--x)`: resolve it first. */
const paint = (c: string) => { const m = /^var\((--[\w-]+)\)$/.exec(c); return m ? css(m[1]) || "#888" : c; };
const PANEL_KEY = "lumen.graphPanel";
const TAGS_KEY = "lumen.graphTags";
const DISPLAY_KEY = "lumen.graphDisplay";
/** Tag links (20b): teal `--link`, dashed 4 4. */
const TAG_C = "var(--link)";
/** Shared-tag edges per tag (ring beyond a small clique) and how many tag neighbours a local graph pulls in. */
const SHARED_PER_TAG = 24, LOCAL_TAG_NEIGHBOURS = 30;
/** Above this many nodes the layout runs progressively with cheaper forces (no collide, approximate charge). */
const BIG_GRAPH = 1500;
const ls = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
const useWidth = () => { const [w, setW] = useState(() => innerWidth); useEffect(() => { const f = () => setW(innerWidth); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return w; };

/** Node diameter (sized by link count; maps of content at least 26 like 14b; tag nodes 22 like 20b). */
const diam = (n: GNode) => n.kind === "tag" ? 22 : Math.max(n.note?.type === "moc" ? 26 : 5, 6 + Math.min(n.deg, 12) * 2.1);
/** Box a node takes in a tidy layout: the dot plus room for its label underneath. */
const boxOf = (n: GNode) => { const d = diam(n); return { w: Math.max(d, Math.min(150, n.label.length * 6.2)), h: d + 20 }; };
const idOf = (v: unknown) => (typeof v === "object" && v ? (v as GNode).id : String(v));

/** Tidied layouts, per view (global per space / local per centre). Survive leaving and re-opening the graph. */
interface Frozen { pos: Map<string, P>; pinned: Set<string> }
const FROZEN = new Map<string, Frozen>();

function loadDisplay(): Display {
  let d = DISPLAY_DEFAULT;
  try { d = { ...DISPLAY_DEFAULT, ...JSON.parse(ls.get(DISPLAY_KEY) ?? "{}") }; } catch { /* default */ }
  // Older "Tag links" choice (off | nodes | shared) still applies.
  const t = ls.get(TAGS_KEY);
  if (t) d = { ...d, tagNodes: t === "nodes" || t === "both", shared: t === "shared" || t === "both" };
  return d;
}

/** Depth slider drawn like the design (4px track, 16px thumb), 1–3. */
function DepthSlider({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const pct = ((value - 1) / 2) * 100;
  return (
    <div className="relative h-4">
      <div className="absolute inset-x-0 top-1.5 h-1 rounded-[2px] bg-surface-2"><span className="absolute inset-y-0 left-0 rounded-[2px] bg-ink opacity-70" style={{ width: `${pct}%` }} /></div>
      <span className="pointer-events-none absolute top-0 -ml-2 size-4 rounded-full bg-ink" style={{ left: `${pct}%` }} />
      <input type="range" min={1} max={3} step={1} value={value} disabled={disabled} aria-label={t("Local graph depth")} onChange={(e) => onChange(Number(e.target.value))} className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-default" />
    </div>
  );
}

/** Tag node as drawn in 20b: a ring in --link with a muted "#". */
const TagDot = ({ size = 14 }: { size?: number }) => (
  <span className="box-border flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-link bg-bg font-bold leading-none text-muted" style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}>#</span>
);

export function GraphView({ localTo }: { localTo?: string }) {
  const v = useVault();
  const ui = useUI();
  const width = useWidth();
  const phone = width < 768;
  // "Graph from note" (New… chooser / palette) asks for a local graph through sessionStorage.
  const [requested] = useState(() => { try { return sessionStorage.getItem("lumen.graphLocal"); } catch { return null; } });
  useEffect(() => { try { sessionStorage.removeItem("lumen.graphLocal"); } catch { /* ignore */ } }, []);
  const [q, setQ] = useState("");
  const [disp, setDispRaw] = useState<Display>(loadDisplay);
  const setDisp = (p: Partial<Display>) => setDispRaw((d) => {
    const n = { ...d, ...p };
    ls.set(DISPLAY_KEY, JSON.stringify(n));
    ls.set(TAGS_KEY, n.tagNodes && n.shared ? "both" : n.tagNodes ? "nodes" : n.shared ? "shared" : "off");
    return n;
  });
  const [orphans, setOrphans] = useState(true);
  const [journal, setJournal] = useState(true);
  const [colorBy, setColorBy] = useState<ColorBy>("folder");
  const [depth, setDepth] = useState(localTo ? 1 : 2);
  const [local, setLocal] = useState(!!localTo || !!requested);
  const [focusId, setFocusId] = useState<string | null>(requested);
  const [allSpaces, setAllSpaces] = useState(ui.spaceId === "all");
  const [spaceMenu, setSpaceMenu] = useState(false);
  const [iso, setIso] = useState<string | null>(null);
  const [panel, setPanel] = useState(() => ls.get(PANEL_KEY) ?? (typeof innerWidth === "number" && innerWidth >= 1200 ? "1" : "0"));
  const [selId, setSelId] = useState<string | null>(requested);
  const [selPos, setSelPos] = useState<{ x: number; y: number } | null>(null);
  const [showBroken, setShowBroken] = useState(false);
  // Big vaults (20b): the global graph first draws the most-linked notes; "Show all" draws everything.
  const [showAll, setShowAll] = useState(false);
  const [more, setMore] = useState(false);
  const indexing = indexLabel(useIndexStatus());
  const open = panel === "1";
  const togglePanel = () => setPanel((p) => { const n = p === "1" ? "0" : "1"; ls.set(PANEL_KEY, n); return n; });
  const center = focusId ?? localTo ?? ui.noteId;
  const embedded = !!localTo;
  const viewKey = local ? `local:${center}:${depth}` : `global:${allSpaces || ui.spaceId === "all" ? "all" : ui.spaceId}`;
  const api = useRef<GraphApi | null>(null);
  // Big graphs (Lumen 32 R6-32A–C): above `graphAsk` notes ask first; Full · Grouped · Tree · Local · Filter.
  const scale = useScale();
  const spaceKey = allSpaces || ui.spaceId === "all" ? "all" : ui.spaceId;
  const [bigPick, setBigPick] = useState<BigMode | null>(null);
  const [drill, setDrill] = useState<Drill>([]);
  const [expand, setExpand] = useState<Set<string>>(() => new Set());
  const [slowNote, setSlowNote] = useState(false);

  // Connection checks over the notes in scope (orphans, broken [[links]]).
  const scopeNotes = useMemo(() => v.notes.filter((n) => allSpaces || ui.spaceId === "all" || n.spaceId === ui.spaceId), [v, allSpaces, ui.spaceId]);
  const checks = useMemo(() => (open ? vaultChecks(scopeNotes, v.byTitle, v.outlinks, v.backlinks) : null), [open, scopeNotes, v]);
  const big = !embedded && scopeNotes.length > scale.graphAsk;
  const remembered = scale.graphChoice[spaceKey] ?? (scale.graphDefault !== "ask" ? scale.graphDefault : null);
  const bigMode: BigMode = local ? "local" : bigPick && bigPick !== "local" ? bigPick : remembered ?? "full";
  const asking = big && !local && !bigPick && !remembered;
  useEffect(() => { setBigPick(null); setDrill([]); }, [spaceKey]);
  const scopeLinks = useMemo(() => { if (!big) return 0; const ids = new Set(scopeNotes.map((n) => n.id)); let k = 0; for (const n of scopeNotes) for (const o of v.outlinks.get(n.id) ?? []) if (ids.has(o)) k++; return k; }, [big, scopeNotes, v.outlinks]);
  const groupCount = useMemo(() => (big ? buildGroups(scopeNotes, v, [], spaceKey === "all").length : 0), [big, scopeNotes, v, spaceKey]);
  const pickBig = (m: BigMode, remember = false) => {
    setBigPick(m); setSelId(null);
    if (remember && m !== "local" && m !== "filter") setScale({ graphChoice: { ...scale.graphChoice, [spaceKey]: m } });
    if (m === "local") {
      const deg = (id: string) => (v.outlinks.get(id)?.length ?? 0) + (v.backlinks.get(id)?.length ?? 0);
      const id = selId ?? center ?? [...scopeNotes].sort((a, b) => deg(b.id) - deg(a.id))[0]?.id;
      if (id) showLocal(id);
      return;
    }
    setLocal(false); setFocusId(null);
    if (m === "full") setShowAll(true);
    if (m === "filter") { setShowAll(true); if (!q) setQ(""); }
  };

  const filterEmpty = big && bigMode === "filter" && !q.trim();
  const graph = useMemo(() => {
    const pq = parseQuery(q);
    const f = matcher(pq, v.folderMap, v.spaceMap);
    const text = pq.text.toLowerCase();
    // Folder colour: the top-level folder of the note (its own colour if set, else the design palette).
    const top = (id: string | null) => {
      // Guarded walk: synced/imported data can contain a parent cycle (A→B→A).
      let fo = id ? v.folderMap.get(id) : undefined;
      const seen = new Set<string>();
      while (fo?.parentId && v.folderMap.get(fo.parentId) && !seen.has(fo.id) && seen.size < 64) { seen.add(fo.id); fo = v.folderMap.get(fo.parentId); }
      return fo;
    };
    const keyOf = (n: Note) => colorBy === "type" ? n.type : colorBy === "status" ? n.status ?? "none"
      : n.type === "moc" ? "@moc" : n.type === "journal" ? "@journal" : top(n.folderId)?.id ?? "@root";
    const tagsOn = disp.tagNodes || disp.shared;
    let notes = filterEmpty ? [] : v.notes.filter((n) => (allSpaces || ui.spaceId === "all" || local || n.spaceId === ui.spaceId) && f(n) && (!text || n.title.toLowerCase().includes(text)) && (journal || n.type !== "journal"));
    if (local && center) {
      const keep = new Set([center]);
      let frontier = [center];
      for (let d = 0; d < depth; d++) {
        const next: string[] = [];
        for (const id of frontier) for (const o of [...(v.outlinks.get(id) ?? []), ...(v.backlinks.get(id) ?? [])]) if (!keep.has(o)) { keep.add(o); next.push(o); }
        frontier = next;
      }
      // With tag links on, the local graph also pulls in notes that share a tag with the centre (capped).
      const c = v.byId.get(center);
      if (tagsOn && c?.tags.length) {
        let extra = 0;
        for (const n of v.notes) {
          if (extra >= LOCAL_TAG_NEIGHBOURS) break;
          if (!keep.has(n.id) && n.tags.some((t) => c.tags.includes(t))) { keep.add(n.id); extra++; }
        }
      }
      notes = v.notes.filter((n) => keep.has(n.id) && (journal || n.type !== "journal" || n.id === center));
    }
    // 700+ notes in the global graph: start with the 300 most linked (lib/big-vault.ts), the rest on "Show all".
    const prog = local ? null : graphProgressive(notes.map((n) => n.id), (id) => (v.outlinks.get(id)?.length ?? 0) + (v.backlinks.get(id)?.length ?? 0), showAll || big);
    if (prog?.progressive) { const keep = new Set(prog.ids); notes = notes.filter((n) => keep.has(n.id)); }
    // Legend over the visible notes (before isolating, so every chip stays tappable).
    const count = new Map<string, number>();
    for (const n of notes) count.set(keyOf(n), (count.get(keyOf(n)) ?? 0) + 1);
    const folderKeys = [...count.keys()].filter((k) => !k.startsWith("@")).sort((a, b) => (v.folderMap.get(a)?.name ?? "").localeCompare(v.folderMap.get(b)?.name ?? ""));
    const colorOfKey = (k: string) => colorBy === "status" ? STATUS_C[k] ?? STATUS_C.none : colorBy === "type" ? TYPE_C[k] ?? "#9AA0AA"
      : k === "@moc" ? MOC_C : k === "@journal" ? JOURNAL_C : k === "@root" ? "#4B5260" : v.folderMap.get(k)?.color ?? FOLDER_PAL[folderKeys.indexOf(k) % FOLDER_PAL.length];
    const nameOf = (k: string) => colorBy !== "folder" ? keyName(k)
      : k === "@moc" ? t("Map of content") : k === "@journal" ? t("Journal") : k === "@root" ? t("Unfiled") : v.folderMap.get(k)?.name ?? k;
    const order = colorBy === "folder" ? [...folderKeys, "@root", "@moc", "@journal"] : colorBy === "status" ? ["todo", "learning", "review", "mastered", "none"] : Object.keys(TYPE_C);
    const legend = order.filter((k) => count.has(k)).map((k) => ({ k, n: nameOf(k), c: colorOfKey(k), count: count.get(k)! }));
    // "@orphans" (Checks › Orphans) keeps only notes with no link in or out.
    if (iso === "@orphans") notes = notes.filter((n) => !(v.outlinks.get(n.id)?.length) && !(v.backlinks.get(n.id)?.length));
    else if (iso) notes = notes.filter((n) => keyOf(n) === iso || n.id === center && local);

    const ids = new Set(notes.map((n) => n.id));
    const nodes: GNode[] = notes.map((n) => ({ id: n.id, label: n.title, kind: "note", note: n, deg: 0, color: colorOfKey(keyOf(n)) }));
    const links: GLink[] = [];
    for (const n of notes) for (const o of v.outlinks.get(n.id) ?? []) if (ids.has(o)) links.push({ source: n.id, target: o });
    // Degree = real links only (node size, labels, "N links"); tag edges only keep a note from counting as an orphan.
    const deg = new Map<string, number>();
    for (const l of links) { deg.set(l.source as string, (deg.get(l.source as string) ?? 0) + 1); deg.set(l.target as string, (deg.get(l.target as string) ?? 0) + 1); }
    nodes.forEach((n) => (n.deg = deg.get(n.id) ?? 0));
    let tagEdges = 0, sharedEdges = 0;
    if (disp.tagNodes) {
      const t = tagNodeEdges(notes);
      for (const x of t.tags) nodes.push({ id: x.id, label: `#${x.tag}`, kind: "tag", deg: x.count, color: TAG_C });
      for (const e of t.edges) links.push({ source: e.source, target: e.target, tag: true });
      tagEdges = t.edges.length;
    }
    if (disp.shared) {
      const s = sharedTagEdges(notes, { perTag: SHARED_PER_TAG, linked: links.filter((l) => !l.tag).map((l) => [l.source as string, l.target as string] as [string, string]) });
      for (const e of s) links.push({ source: e.source, target: e.target, shared: true });
      sharedEdges = s.length;
    }
    const touched = new Set<string>();
    for (const l of links) { touched.add(l.source as string); touched.add(l.target as string); }
    const final = orphans || iso === "@orphans" ? nodes : nodes.filter((n) => touched.has(n.id) || n.id === center);
    const finalIds = new Set(final.map((n) => n.id));
    // A tidied layout for this view: those nodes start (and stay) where Tidy up put them.
    const fz = FROZEN.get(viewKey);
    if (fz) for (const n of final) { const p = fz.pos.get(n.id); if (p) { n.x = n.fx = p.x; n.y = n.fy = p.y; } }
    return { nodes: final, links: links.filter((l) => finalIds.has(l.source as string) && finalIds.has(l.target as string)), legend, notes: notes.length, tagEdges, sharedEdges, progress: prog?.progressive ? prog.label : null };
  }, [v, q, disp.tagNodes, disp.shared, orphans, journal, colorBy, local, depth, center, ui.spaceId, allSpaces, iso, showAll, filterEmpty, big]); // eslint-disable-line react-hooks/exhaustive-deps

  const hairColor = useMemo(() => {
    const tops = new Map<string, number>();
    return (n: Note) => {
      let f = n.folderId ? v.folderMap.get(n.folderId) : undefined;
      for (let i = 0; f?.parentId && i < 64; i++) f = v.folderMap.get(f.parentId) ?? undefined;
      if (!f) return "#9AA0AA";
      if (!tops.has(f.id)) tops.set(f.id, tops.size);
      return f.color ?? BIG_PAL[tops.get(f.id)! % BIG_PAL.length];
    };
  }, [v.folderMap]);
  const sel = selId ? graph.nodes.find((n) => n.id === selId) ?? null : null;
  const selNote = sel?.note;
  const folderOf = (n: Note) => (n.folderId ? v.folderMap.get(n.folderId)?.name : v.spaceMap.get(n.spaceId)?.name) ?? "";
  const showLocal = (id: string) => { setFocusId(id); setLocal(true); setSelId(id); };
  const linkCount = graph.links.filter((l) => !l.tag && !l.shared).length;
  const selTag = sel?.kind === "tag" ? sel.label.slice(1) : null;
  const space = v.spaceMap.get(ui.spaceId);
  const leave = () => (ui.history.length ? go("notes", { noteId: ui.history[ui.history.length - 1] }) : go("home"));
  const tagsOn = disp.tagNodes || disp.shared;

  // ------------------------------------------------------------ Tidy up (preview → Apply / Cancel → toast Undo)
  const [preview, setPreview] = useState<null | { stats: TidyStats; prev: Map<string, P>; prevFrozen: Frozen | null; next: Frozen; layout: LayoutChoice }>(null);
  const startTidy = (choice: LayoutChoice = disp.layout) => {
    const a = api.current;
    if (!a || preview) return;
    const ns = a.nodes();
    if (!ns.length) return;
    const fz = FROZEN.get(viewKey) ?? null;
    const input: LNode[] = ns.map((n) => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0, ...boxOf(n), pinned: !!fz?.pinned.has(n.id) }));
    // Tag links point tag → note, so tags head their notes in a top-down layout.
    const edges = a.links().map((l) => (l.tag ? [idOf(l.target), idOf(l.source)] : [idOf(l.source), idOf(l.target)]) as [string, string]);
    const mode: TidyMode = choice === "top" ? "layered" : choice === "radial" ? "radial" : "force";
    const r = tidy(input, edges, { mode, dir: "TB", spacing: disp.spacing === "roomy" ? 1.6 : 1, layerGap: 70, nodeGap: 14, center: local ? center : selId, keepPinned: disp.keepPinned });
    const prev = new Map(ns.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
    a.moveTo(r.pos, true);
    const label = choice === "top" ? t("top-down") : choice === "radial" ? t("radial") : t("free");
    setPreview({ stats: { ...r, label }, prev, prevFrozen: fz, next: { pos: r.pos, pinned: new Set(disp.keepPinned ? fz?.pinned ?? [] : []) }, layout: choice });
  };
  const cancelTidy = () => { if (!preview) return; api.current?.moveTo(preview.prev, !!preview.prevFrozen); setPreview(null); };
  const applyTidy = () => {
    if (!preview) return;
    const { prev, prevFrozen, next, stats, layout } = preview;
    const key = viewKey;
    FROZEN.set(key, next);
    setDisp({ layout });
    setPreview(null);
    toast(t("Tidied up · {n} card moved|Tidied up · {n} cards moved", { n: stats.moved }), { label: t("Undo"), run: () => {
      api.current?.moveTo(prev, !!prevFrozen);
      if (prevFrozen) FROZEN.set(key, prevFrozen); else FROZEN.delete(key);
    } });
  };
  /** Layout segment: Free = back to live physics (undoable); Top-down / Radial = a Tidy up preview in that layout. */
  const chooseLayout = (l: LayoutChoice) => {
    if (l !== "free") return startTidy(l);
    const fz = FROZEN.get(viewKey);
    setDisp({ layout: "free" });
    if (!fz) return;
    const a = api.current;
    const cur = new Map((a?.nodes() ?? []).map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
    FROZEN.delete(viewKey);
    a?.moveTo(cur, false);
    toast(t("Free layout · physics on"), { label: t("Undo"), run: () => { FROZEN.set(viewKey, fz); a?.moveTo(fz.pos, true); setDisp({ layout: "top" }); } });
  };
  const reset = () => {
    setDispRaw(DISPLAY_DEFAULT); ls.set(DISPLAY_KEY, JSON.stringify(DISPLAY_DEFAULT)); ls.set(TAGS_KEY, "off");
    setQ(""); setOrphans(true); setJournal(true); setColorBy("folder"); setIso(null);
    const a = api.current;
    if (FROZEN.has(viewKey) && a) { FROZEN.delete(viewKey); a.moveTo(new Map(a.nodes().map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }])), false); }
  };
  const onPin = (id: string, p: P) => { const fz = FROZEN.get(viewKey); if (fz) { fz.pos.set(id, p); fz.pinned.add(id); } };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (isTidyKey(e)) { e.preventDefault(); startTidy(); }
      else if (e.key === "Escape" && preview) cancelTidy();
      else if (e.key === "Enter" && preview && !(e.target as HTMLElement)?.closest?.("input,textarea")) { e.preventDefault(); applyTidy(); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });
  // A new graph (filters, local centre…) drops an open preview.
  useEffect(() => setPreview(null), [graph]);

  const card = selNote && sel && (
    <>
      <div className="flex items-center gap-1.5 text-[12px] text-muted">
        <span className="size-2 shrink-0 rounded-[3px]" style={{ background: sel.color }} />
        <span className="truncate"><bdi>{folderOf(selNote)}</bdi><span className="md:hidden"> · {t("{n} link|{n} links", { n: sel.deg })}</span></span>
        <span className="hidden flex-1 md:inline" />
        {selNote.status && (
          <span className="hidden items-center gap-1 md:flex" style={{ color: STATUS_COLOR[selNote.status] }}>
            <span className="size-1.5 rounded-full" style={{ background: STATUS_COLOR[selNote.status] }} />{keyName(selNote.status)}
          </span>
        )}
      </div>
      <span dir="auto" className="text-[17px] font-[650] md:text-[15px]">{selNote.title}</span>
      <span dir="auto" className="line-clamp-2 text-[13.5px] leading-5 text-muted md:text-[12.5px] md:leading-[19px]">{plainExcerpt(selNote.body, 90) || t("Empty note")}</span>
    </>
  );

  const tagCard = selTag && sel && (
    <>
      <div className="flex items-center gap-1.5 text-[12px] text-muted"><TagDot size={12} />{t("Tag")} · {t("{n} note|{n} notes", { n: sel.deg })}</div>
      <span dir="auto" className="text-[17px] font-[650] md:text-[15px]">#{selTag}</span>
      <div className="mt-0.5 flex items-center gap-2 pb-1">
        <button onClick={() => go("notes", { tag: selTag, spaceId: "all", folderId: null, filter: null, noteId: null })} className="flex h-11 flex-1 items-center justify-center rounded-[8px] border border-line bg-bg px-3 font-medium hover:border-accent md:h-[30px] md:flex-none">{t("Show notes")}</button>
        <button onClick={() => { setQ(`tag:#${selTag}`); setSelId(null); }} className="flex h-11 flex-1 items-center justify-center rounded-[8px] border border-line px-3 hover:bg-surface md:h-[30px] md:flex-none">{t("Filter graph")}</button>
      </div>
    </>
  );

  // Desktop card sits above-right of the selected node (clamped to the view).
  const host = useRef<HTMLDivElement>(null);
  const cardStyle = (() => {
    const W = host.current?.clientWidth ?? 1000, H = host.current?.clientHeight ?? 800;
    if (!selPos) return { left: 20, top: 60 };
    let left = selPos.x + 38, top = selPos.y - 265;
    if (top < 60) top = Math.min(H - 200, selPos.y + 30);
    if (left + 268 > W - (open ? 300 : 70)) left = Math.max(20, selPos.x - 306);
    return { left, top: Math.max(56, top) };
  })();

  const label = "text-[12px] text-muted";
  const linkRows: [keyof Display, ReactNode, string, string | undefined, number, number][] = [
    ["links", t("Links"), "var(--muted)", undefined, 1.5, linkCount],
    ["tagNodes", t("Note to tag"), TAG_C, "4 4", 1.5, graph.tagEdges],
    ["shared", t("Shared tags"), TAG_C, "1.5 4", 2, graph.sharedEdges],
  ];
  const checkRows = checks && (
    <div className="flex flex-col gap-[7px] border-t border-line pt-3" aria-label={t("Connection checks")}>
      <span className={label}>{t("Checks")}</span>
      <button onClick={() => setIso((x) => (x === "@orphans" ? null : "@orphans"))} title={iso === "@orphans" ? t("Show all") : t("Show only notes with no links")} className={cx("flex items-center gap-2 text-start leading-4", iso === "@orphans" && "text-accent")}>
        <span className={cx("size-2.5 shrink-0 rounded-full border-[1.5px]", checks.orphans.length ? "border-warn" : "border-ok")} /><span className="flex-1">{t("Orphans · no links")}</span><span className="text-[12px] text-muted">{checks.orphans.length}</span>
      </button>
      <button onClick={() => setShowBroken((b) => !b)} aria-expanded={showBroken} className="flex items-center gap-2 text-start leading-4">
        <span className={cx("size-2.5 shrink-0 rounded-full border-[1.5px]", checks.broken.length ? "border-bad" : "border-ok")} /><span className="flex-1">{t("Broken links")}</span><span className="text-[12px] text-muted">{checks.broken.length}</span>
      </button>
      {showBroken && (checks.broken.length ? (
        <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-[8px] border border-line bg-bg p-1">
          {checks.broken.slice(0, 50).map((b, i) => (
            <button key={i} onClick={() => openNote(b.note.id)} title={t("Open “{title}”", { title: b.note.title })} className="flex flex-col rounded-[6px] px-2 py-1 text-start hover:bg-surface-2">
              <span dir="auto" className="truncate text-[12.5px]">{b.note.title}</span>
              <span dir="ltr" className="truncate text-start font-mono text-[11px] text-bad">[[{b.target}]]</span>
            </button>
          ))}
        </div>
      ) : <span className="text-[12px] text-muted">{t("Every [[link]] points to a note.")}</span>)}
    </div>
  );

  const panelBody = (
    <div className="flex flex-col gap-3.5 overflow-y-auto px-3.5 py-3">
      <label className="flex h-8 shrink-0 items-center gap-2 rounded-[6px] border border-line bg-bg px-2.5 text-muted focus-within:border-accent">
        <Search size={13} className="shrink-0" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Filter… tag:#math")} className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted" />
      </label>
      <div className="flex flex-col gap-2.5">
        <Switch label={t("Tags as nodes")} on={disp.tagNodes} onChange={(x) => setDisp({ tagNodes: x })} />
        <Switch label={t("Orphans")} on={orphans} onChange={setOrphans} />
        <Switch label={t("Journal notes")} on={journal} onChange={setJournal} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={label}>{t("Colour by")}</span>
        <Seg label={t("Colour by")} value={colorBy} onChange={(c) => { setColorBy(c); setIso(null); }} options={(["folder", "type", "status"] as ColorBy[]).map((c) => [c, <span>{keyName(c)}</span>])} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between text-[12px]"><span className="text-muted">{t("Local graph depth")}</span><span className="tabular-nums">{fmtNum(depth)}</span></div>
        <DepthSlider value={depth} onChange={(d) => { setDepth(d); if (!local && (selId ?? center)) showLocal((selId ?? center)!); }} />
      </div>
      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <span className={label}>{t("Layout")}</span>
        <Seg label={t("Layout")} value={disp.layout} onChange={chooseLayout} h={26} options={[["free", t("Free")], ["top", t("Top-down")], ["radial", t("Radial")]]} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={label}>{t("Edges")}</span>
        <EdgeSeg value={disp.edges} onChange={(e) => setDisp({ edges: e })} />
      </div>
      <div className="flex flex-col gap-0.5" aria-label={t("Show links")}>
        <span className={cx(label, "pb-1")}>{t("Show links")}</span>
        {linkRows.map(([k, l, c, dash, w, n]) => (
          <div key={k} className="flex h-8 items-center">
            <Switch label={<><LineSample color={c} dash={dash} width={w} /><span className="truncate">{l}</span></>} right={<span className="text-[12px] text-muted">{disp[k] ? n : ""}</span>} on={!!disp[k]} onChange={(x) => setDisp({ [k]: x } as Partial<Display>)} />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-0.5 border-t border-line pt-3">
        <span className={cx(label, "pb-1")}>{t("Declutter")}</span>
        <div className="flex h-8 items-center"><Switch label={t("Dim notes outside focus")} on={disp.dim} onChange={(x) => setDisp({ dim: x })} /></div>
        <div className="flex h-8 items-center"><Switch label={t("Keep pinned notes")} on={disp.keepPinned} onChange={(x) => setDisp({ keepPinned: x })} /></div>
        <div className="flex h-8 items-center gap-2.5">
          <span className="flex-1">{t("Spacing")}</span>
          <div className="flex gap-0.5 rounded-[7px] border border-line bg-bg p-0.5 text-[12px]">
            {(["compact", "roomy"] as const).map((s) => <button key={s} onClick={() => setDisp({ spacing: s })} aria-pressed={disp.spacing === s} className={cx("flex h-[22px] items-center rounded-[5px] px-2", disp.spacing === s ? "bg-surface-2 font-semibold" : "text-muted hover:text-ink")}>{keyName(s)}</button>)}
          </div>
        </div>
      </div>
      {checkRows}
      <div className="flex flex-col gap-[7px] border-t border-line pt-3">
        {tagsOn && disp.tagNodes && <span className="flex items-center gap-2 leading-4"><span className="flex w-2.5 justify-center"><TagDot size={12} /></span><span className="flex-1">{t("Tag")}</span></span>}
        {graph.legend.map((l) => (
          <button key={l.k} onClick={() => setIso((x) => (x === l.k ? null : l.k))} title={iso === l.k ? t("Show all") : t("Isolate")} className={cx("flex items-center gap-2 text-start leading-4", iso && iso !== l.k && "opacity-40")}>
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: l.c }} /><span className="flex-1 truncate" dir="auto">{l.n}</span><span className="text-[12px] text-muted">{fmtNum(l.count)}</span>
          </button>
        ))}
      </div>
    </div>
  );

  // Phone Display sheet (14b-P1): edges, link chips, Tidy up first; the rest below.
  const chip = (on: boolean, l: string, f: () => void, c = "var(--info)") => (
    <button key={l} onClick={f} aria-pressed={on} className={cx("flex h-9 items-center rounded-full px-3", on ? "" : "border border-line")} style={on ? { background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c } : undefined}>{l}</button>
  );
  const phoneSheet = (
    <div className="absolute inset-x-0 bottom-0 z-30 flex max-h-[85%] flex-col rounded-t-[14px] border-t border-line bg-surface text-[14px] sheet-in">
      <div className="flex justify-center pt-2.5"><button aria-label={t("Close display")} onClick={togglePanel} className="h-1 w-9 rounded-full bg-line" /></div>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pt-3">
        <span className="text-[16px] font-[650]">{t("Display")}</span>
        <EdgeSeg big value={disp.edges} onChange={(e) => setDisp({ edges: e })} />
        <div className="flex flex-wrap gap-2">
          {chip(disp.links, t("Links"), () => setDisp({ links: !disp.links }), "var(--info)")}
          {chip(disp.tagNodes, t("Tags as nodes"), () => setDisp({ tagNodes: !disp.tagNodes }), "var(--link)")}
          {chip(disp.shared, t("Shared tags"), () => setDisp({ shared: !disp.shared }), "var(--link)")}
          {chip(orphans, t("Orphans"), () => setOrphans(!orphans))}
          {chip(journal, t("Journal"), () => setJournal(!journal))}
        </div>
        <TidyButton big onClick={() => { togglePanel(); startTidy(); }} busy={!!preview} />
        <button onClick={() => setMore((m) => !m)} aria-expanded={more} className="flex h-10 items-center gap-1.5 text-[13px] text-muted">{more ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{t("More: filter, colour, layout, checks")}</button>
        {more && <div className="-mx-3.5 border-t border-line text-[13px] [&>div]:pb-2">{panelBody}</div>}
      </div>
      <div className="flex h-6 shrink-0 items-center justify-center safe-b"><span className="h-1 w-[108px] rounded-full bg-muted opacity-45" /></div>
    </div>
  );

  return (
    <div ref={host} className={cx("overflow-hidden bg-bg text-[13px]", phone && !embedded ? "fixed inset-0 z-30 flex flex-col" : big ? "relative flex h-full flex-col" : "relative h-full")}>
      {big && (
        <BigBar mode={bigMode} onMode={(m) => pickBig(m)} phone={phone} glyph={bigMode === "grouped" ? "cluster" : bigMode === "tree" ? "tree" : "graph"}
          title={bigMode === "grouped" ? t("Graph · grouped") : bigMode === "tree" ? t("Graph · tree") : t("Graph")}
          sub={bigMode === "grouped" ? t("{n} notes in {g} groups", { n: scopeNotes.length, g: groupCount }) : bigMode === "tree" ? t("Folders → notes, branches fold")
            : `${spaceKey === "all" ? t("All spaces") : space?.name ?? ""} · ${t("{n} note|{n} notes", { n: scopeNotes.length })} · ${t("{n} link|{n} links", { n: scopeLinks })}`}
          lead={phone ? <button aria-label={t("Back")} onClick={leave} className="-ml-1 flex size-9 items-center justify-center"><ArrowLeft size={18} /></button> : undefined} />
      )}
      {big && (asking || bigMode === "grouped" || bigMode === "tree") ? (
        asking ? (
          <div className="relative min-h-0 flex-1 overflow-hidden" style={{ backgroundImage: "radial-gradient(color-mix(in srgb,var(--muted) 16%,transparent) 1px,transparent 1.2px)", backgroundSize: "22px 22px" }}>
            <HairDots notes={scopeNotes} colorOf={hairColor} />
            <TooBigBanner count={scopeNotes.length} groups={groupCount} phone={phone} onPick={(m, r) => pickBig(m, r)} />
          </div>
        ) : bigMode === "grouped" ? (
          <GroupedGraph notes={scopeNotes} v={v} allScope={spaceKey === "all"} drill={drill} setDrill={setDrill} phone={phone}
            onOpenLeaf={(g) => { setBigPick("filter"); setShowAll(true); setQ(g.kind === "folder" ? `in:"${g.name}"` : g.kind === "space" ? `space:"${g.name}"` : ""); }}
            onAsTree={(g) => { setExpand((s) => new Set([...s, ...expandFor(g, v.folderMap, spaceKey === "all")])); setBigPick("tree"); }} />
        ) : (
          <TreeGraph notes={scopeNotes} v={v} allScope={spaceKey === "all"} rootName={spaceKey === "all" ? t("All spaces") : space?.name ?? t("Notes")} phone={phone} expand={expand} setExpand={setExpand} pageSize={scale.pageSize} />
        )
      ) : (<>
      {/* Phone header: back · Graph · Global / Local · display */}
      {phone && !embedded && !big && (
        <div className="safe-t relative z-20 flex h-14 shrink-0 items-center gap-2 px-2">
          <button aria-label={t("Back")} onClick={leave} className="flex size-11 items-center justify-center"><ArrowLeft size={20} /></button>
          <span className="flex-1 text-[17px] font-[650]">{t("Graph")}</span>
          <div className="flex rounded-[10px] border border-line bg-surface p-[3px] text-[13px]">
            <button onClick={() => { setLocal(false); setFocusId(null); }} className={cx("flex h-8 items-center rounded-[7px] px-3", !local ? "bg-surface-2 font-semibold" : "text-muted")}>{t("Global")}</button>
            <button onClick={() => { const id = selId ?? center; if (id) showLocal(id); }} className={cx("flex h-8 items-center rounded-[7px] px-3", local ? "bg-surface-2 font-semibold" : "text-muted")}>{t("Local · {n}", { n: depth })}</button>
          </div>
          <button aria-label={t("Graph display settings")} onClick={togglePanel} className={cx("flex size-11 items-center justify-center", open && "text-accent")}><SlidersHorizontal size={20} /></button>
        </div>
      )}
      <div className={cx("relative overflow-hidden", (phone && !embedded) || big ? "min-h-0 flex-1" : "h-full")}>
        {big && bigMode === "filter" && <FilterFirst q={q} setQ={setQ} count={graph.notes} phone={phone} />}
        {slowNote && (
          <div role="status" className="absolute left-1/2 top-3 z-20 flex max-w-[calc(100%-24px)] -translate-x-1/2 flex-col gap-1 rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-[12.5px] shadow-[0_12px_30px_rgba(0,0,0,.35)]">
            <span className="flex items-center gap-2"><Glyph name="c-info" size={14} color="var(--info)" /><span className="flex-1">{t("Simple view: no animation, labels on zoom")}</span>
              <button onClick={() => { setSlowNote(false); go("settings"); }} className="font-medium text-link">{t("Change")}</button>
              <button aria-label={t("Close")} onClick={() => setSlowNote(false)} className="text-muted hover:text-ink"><X size={13} /></button></span>
            <span className="text-[11.5px] text-muted">{t("Also in Settings › Appearance › Advanced · Reduce effects.")}</span>
          </div>
        )}
        <Canvas2D onSlow={() => setSlowNote(true)} labelTop={big ? 30 : 0} nodes={graph.nodes} links={graph.links} focus={local ? center : null} selected={selId} onSelect={(n) => setSelId(n?.id ?? null)} onSelectedPos={setSelPos}
          controls={!embedded && open && !phone} fitKey={`${local}:${center}:${depth}:${iso}`} insetRight={open && !phone ? 300 : 0} insetBottom={phone && selId ? 250 : 0}
          edgeShape={disp.edges} showLinks={disp.links} dim={disp.dim} roomy={disp.spacing === "roomy"} api={api} onPin={onPin} pinned={(id) => !!FROZEN.get(viewKey)?.pinned.has(id)} />

        {/* Desktop / tablet header */}
        {!embedded && !phone && (
          <div className="absolute left-5 top-4 z-10 flex items-center gap-2.5">
            {!big && <span className="text-[16px] font-[650]">{t("Graph")}</span>}
            {ui.spaceId !== "all" && !local && width >= 1100 && (
              <div className="relative">
                <button onClick={() => setSpaceMenu((m) => !m)} className="flex h-7 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-muted hover:text-ink">
                  {!allSpaces && <SpaceIcon space={space} size={15} />}<span>{allSpaces ? t("All spaces") : t("This space")}</span><ChevronDown size={12} />
                </button>
                {spaceMenu && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setSpaceMenu(false)} />
                    <div className="absolute left-0 top-9 z-30 flex w-48 flex-col gap-px rounded-[12px] border border-line bg-surface-2 p-1.5 shadow-[0_16px_40px_rgba(0,0,0,.45)] fade-in">
                      {[[t("This space"), false], [t("All spaces"), true]].map(([l, a]) => (
                        <button key={l as string} onClick={() => { setAllSpaces(a as boolean); setSpaceMenu(false); }} className={cx("flex h-8 items-center gap-2 rounded-[8px] px-2.5 text-start hover:bg-bg", allSpaces === a && "font-semibold")}>
                          {!a && <SpaceIcon space={space} size={15} />}{a ? l : `${space?.name ?? l}`}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {local && <button onClick={() => { setLocal(false); setFocusId(null); }} className="flex h-7 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-muted hover:text-ink"><Locate size={12} /> {t("Local · {n}", { n: depth })}<X size={12} /></button>}
            <span className={cx("text-[12px] text-muted", big && !local && bigMode !== "filter" && "hidden")}>{t("{n} note|{n} notes", { n: graph.notes })} · {t("{n} link|{n} links", { n: linkCount })}{tagsOn ? ` · ${t("{n} tag link|{n} tag links", { n: graph.tagEdges + graph.sharedEdges })}` : ""}</span>
            {graph.progress && <span className="flex items-center gap-2 text-[12px] text-muted">· {graph.progress}<button onClick={() => setShowAll(true)} className="flex h-6 items-center rounded-[7px] border border-line px-2 text-ink hover:bg-surface-2">{t("Show all")}</button></span>}
            {showAll && !local && !big && <button onClick={() => setShowAll(false)} className="flex h-6 items-center rounded-[7px] border border-line px-2 text-[12px] text-muted hover:text-ink">{t("Most linked only")}</button>}
            {indexing && <span className="flex items-center gap-1.5 text-[12px] text-muted"><span className="size-[7px] rounded-full bg-info" />{indexing}</span>}
          </div>
        )}

        {preview && <TidyBanner stats={preview.stats} onCancel={cancelTidy} onApply={applyTidy} top={phone ? 10 : 56} />}

        {/* Selected preview: floating card on desktop, bottom sheet on phone */}
        {card && !(phone && open) && (
          <>
            <div className="absolute z-10 hidden w-[268px] flex-col gap-2 rounded-[14px] border border-line bg-surface-2 p-3.5 shadow-[0_16px_40px_rgba(0,0,0,.45)] md:flex fade-in" style={cardStyle}>
              {card}
              <div className="mt-0.5 flex items-center gap-2">
                <button onClick={() => openNote(selNote!.id)} className="flex h-[30px] items-center rounded-[8px] border border-line bg-bg px-3 font-medium hover:border-accent">{t("Open")}</button>
                <button onClick={() => showLocal(selNote!.id)} className="flex h-[30px] items-center gap-1.5 rounded-[8px] border border-line px-3 hover:bg-surface"><Locate size={13} />{t("Local graph")}</button>
                <span className="flex-1" />
                <span className="text-[12px] text-muted">{t("{n} link|{n} links", { n: sel!.deg })}</span>
              </div>
            </div>
            <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2.5 rounded-t-[14px] border-t border-line bg-surface px-5 pt-2.5 safe-b md:hidden sheet-in">
              <div className="flex justify-center"><button aria-label={t("Close preview")} onClick={() => setSelId(null)} className="h-1 w-9 rounded-full bg-line" /></div>
              {card}
              <div className="flex gap-2.5 pb-2 pt-1">
                <button onClick={() => openNote(selNote!.id)} className="flex h-12 flex-1 items-center justify-center rounded-[12px] bg-accent font-semibold text-accent-fg">{t("Open note")}</button>
                <button aria-label={t("Local graph")} onClick={() => showLocal(selNote!.id)} className="flex size-12 items-center justify-center rounded-[12px] border border-line"><Locate size={18} /></button>
              </div>
              <div className="flex h-6 items-center justify-center"><span className="h-1 w-[108px] rounded-full bg-muted opacity-45" /></div>
            </div>
          </>
        )}

        {tagCard && !(phone && open) && (
          <>
            <div className="absolute z-10 hidden w-[268px] flex-col gap-2 rounded-[14px] border border-line bg-surface-2 p-3.5 shadow-[0_16px_40px_rgba(0,0,0,.45)] md:flex fade-in" style={cardStyle}>{tagCard}</div>
            <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2.5 rounded-t-[14px] border-t border-line bg-surface px-5 pb-4 pt-2.5 safe-b md:hidden sheet-in">
              <div className="flex justify-center"><button aria-label={t("Close preview")} onClick={() => setSelId(null)} className="h-1 w-9 rounded-full bg-line" /></div>
              {tagCard}
            </div>
          </>
        )}

        {/* Display panel (collapses to one icon; state remembered) */}
        {!phone && (
          <div className="absolute right-4 top-3 z-10 flex flex-col items-end">
            {open ? (
              <div className="mt-1 flex max-h-[calc(100vh-120px)] w-[272px] flex-col overflow-hidden rounded-[14px] border border-line bg-surface fade-in">
                <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pl-3.5 pr-2.5">
                  <SlidersHorizontal size={14} className="text-muted" /><span className="flex-1 font-semibold">{t("Display")}</span>
                  <button onClick={reset} className="px-1 text-[12px] text-muted hover:text-ink">{t("Reset")}</button>
                  <button aria-label={t("Collapse display")} onClick={togglePanel} className="text-muted hover:text-ink"><ChevronUp size={15} /></button>
                </div>
                {panelBody}
                <div className="flex shrink-0 flex-col border-t border-line p-3.5"><TidyButton onClick={() => startTidy()} busy={!!preview} /></div>
              </div>
            ) : (
              <button aria-label={t("Graph display settings")} title={t("Display")} onClick={togglePanel} className="flex size-11 items-center justify-center rounded-[12px] border border-line bg-surface hover:text-accent">
                <SlidersHorizontal size={18} />
              </button>
            )}
          </div>
        )}
        {phone && open && !embedded && phoneSheet}

        {/* Link / Tag legend (20b) when tag links are on and the panel is closed */}
        {tagsOn && !open && !embedded && !(phone && (card || tagCard)) && (
          <div className={cx("absolute left-3 z-10 flex flex-col gap-1 rounded-[8px] bg-bg px-2 py-1.5 text-[11.5px] text-muted", phone ? "bottom-16" : "bottom-[60px]")}>
            <span className="flex items-center gap-1.5"><span className="h-[1.5px] w-4 bg-muted" />{t("Link")}</span>
            <span className="flex items-center gap-1.5"><span className="w-4 border-t-[1.5px] border-dashed border-link" />{t("Tag")}</span>
          </div>
        )}

        {/* Legend chips when the panel is collapsed: tap = isolate that group */}
        {!open && !embedded && !(phone && card) && (
          <div className={cx("absolute right-4 z-10 flex flex-wrap gap-1.5", "bottom-4 left-4", card && "md:hidden")}>
            {graph.legend.map((l) => (
              <button key={l.k} onClick={() => setIso((x) => (x === l.k ? null : l.k))} title={iso === l.k ? t("Show all") : t("Isolate")}
                className={cx("flex h-7 items-center gap-1.5 rounded-full border bg-surface px-2.5 text-[12px]", iso === l.k ? "border-accent" : "border-line", iso && iso !== l.k && "opacity-50")}>
                <span className="size-2 rounded-full" style={{ background: l.c }} /><bdi>{l.n}</bdi>
              </button>
            ))}
          </div>
        )}
      </div>
      </>)}
    </div>
  );
}

export type { GNode, GLink };
/** Imperative handle used by Tidy up: read the laid-out nodes, and move them (animated) to new positions. */
export interface GraphApi { nodes: () => GNode[]; links: () => GLink[]; moveTo: (pos: Map<string, P>, frozen: boolean) => void }

/** Edge path in the chosen shape (14b · 1): curved follows the dominant axis, elbow has soft 10px corners. */
function edgePath(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, shape: EdgeShape) {
  ctx.moveTo(x1, y1);
  if (shape === "straight") { ctx.lineTo(x2, y2); return; }
  const dx = x2 - x1, dy = y2 - y1, hor = Math.abs(dx) >= Math.abs(dy);
  if (shape === "curved") {
    if (hor) ctx.bezierCurveTo(x1 + dx / 2, y1, x1 + dx / 2, y2, x2, y2); else ctx.bezierCurveTo(x1, y1 + dy / 2, x2, y1 + dy / 2, x2, y2);
    return;
  }
  const r = Math.min(10, Math.abs(dx) / 2, Math.abs(dy) / 2);
  if (hor) { const mx = x1 + dx / 2; ctx.arcTo(mx, y1, mx, y2, r); ctx.arcTo(mx, y2, x2, y2, r); }
  else { const my = y1 + dy / 2; ctx.arcTo(x1, my, x2, my, r); ctx.arcTo(x2, my, x2, y2, r); }
  ctx.lineTo(x2, y2);
}
/** Same path as SVG `d` (export). */
function edgeD(x1: number, y1: number, x2: number, y2: number, shape: EdgeShape) {
  const f = (n: number) => n.toFixed(1);
  if (shape === "straight") return `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`;
  const dx = x2 - x1, dy = y2 - y1, hor = Math.abs(dx) >= Math.abs(dy);
  if (shape === "curved") return hor ? `M${f(x1)} ${f(y1)}C${f(x1 + dx / 2)} ${f(y1)} ${f(x1 + dx / 2)} ${f(y2)} ${f(x2)} ${f(y2)}` : `M${f(x1)} ${f(y1)}C${f(x1)} ${f(y1 + dy / 2)} ${f(x2)} ${f(y1 + dy / 2)} ${f(x2)} ${f(y2)}`;
  const r = Math.min(10, Math.abs(dx) / 2, Math.abs(dy) / 2), sx = Math.sign(dx) || 1, sy = Math.sign(dy) || 1;
  if (hor) { const mx = x1 + dx / 2; return `M${f(x1)} ${f(y1)}H${f(mx - sx * r)}Q${f(mx)} ${f(y1)} ${f(mx)} ${f(y1 + sy * r)}V${f(y2 - sy * r)}Q${f(mx)} ${f(y2)} ${f(mx + sx * r)} ${f(y2)}H${f(x2)}`; }
  const my = y1 + dy / 2;
  return `M${f(x1)} ${f(y1)}V${f(my - sy * r)}Q${f(x1)} ${f(my)} ${f(x1 + sx * r)} ${f(my)}H${f(x2 - sx * r)}Q${f(x2)} ${f(my)} ${f(x2)} ${f(my + sy * r)}V${f(y2)}`;
}

export function Canvas2D({ nodes, links, focus, onOpen, selected, onSelect, onSelectedPos, controls, fitKey, insetRight, insetBottom, edgeShape = "straight", showLinks = true, dim = true, roomy, api, onPin, pinned, onSlow, labelTop = 0 }: {
  nodes: GNode[]; links: GLink[]; focus: string | null; onOpen?: (id: string) => void;
  /** When given, a click selects (and double-click opens) instead of opening right away. */
  selected?: string | null; onSelect?: (n: GNode | null) => void;
  /** Screen position of the selected node (for anchoring a preview card). */
  onSelectedPos?: (p: { x: number; y: number } | null) => void;
  /** Show zoom in / out / fit buttons (bottom-left). */
  controls?: boolean;
  /** Changing this re-fits the view once the layout settles. */
  fitKey?: string;
  /** Pixels on the right covered by a floating panel (kept out of the fit). */
  insetRight?: number;
  insetBottom?: number;
  /** Display panel: edge shape, link edges on/off, dimming outside the hovered / selected note, roomy spacing. */
  edgeShape?: EdgeShape; showLinks?: boolean; dim?: boolean; roomy?: boolean;
  api?: { current: GraphApi | null };
  /** A node dragged while the layout is tidied (fixed) stays where it is dropped: it gets a pin. */
  onPin?: (id: string, p: P) => void;
  pinned?: (id: string) => boolean;
  /** Drawing was too slow twice: Reduce effects just switched on (lib/scale-prefs.ts reportDrawTime); say so once. */
  onSlow?: () => void;
  /** Big graphs (Lumen 22): labels only on the N most-linked notes; the rest appear on zoom. 0 = the usual rule. */
  labelTop?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<GNode | null>(null);
  const st = useRef({ x: 0, y: 0, k: 1, sim: null as Simulation<GNode, GLink> | null, drag: null as GNode | null, dragFixed: false, pan: null as { x: number; y: number } | null, moved: false, hover: null as GNode | null, selected: null as string | null, lastClick: { id: "", t: 0 }, touched: false, pos: "", fitted: "0000", touches: new Map<number, { x: number; y: number }>(), pinch: null as null | { d: number; k: number; cx: number; cy: number; x: number; y: number }, anim: null as null | { from: Map<string, P>; to: Map<string, P>; t0: number; frozen: boolean }, animT: 0, opts: "" });
  st.current.selected = selected ?? null;
  const posCb = useRef(onSelectedPos);
  posCb.current = onSelectedPos;
  const look = useRef({ edgeShape, showLinks, dim, pinned, onSlow });
  look.current = { edgeShape, showLinks, dim, pinned, onSlow };
  st.current.opts = `${edgeShape}|${showLinks}|${dim}`;

  // Export the graph as laid out on screen (vector SVG, or PNG/JPEG/WebP through the shared Export dialog).
  const exportImage = () => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const degs = nodes.map((n) => n.deg).sort((a, b) => b - a);
    const labelMin = Math.max(3, degs[Math.floor(degs.length * 0.3)] ?? 3);
    const shown = links.filter((l) => l.tag || l.shared || showLinks).map((l) => ({ a: byId.get(idOf(l.source)), b: byId.get(idOf(l.target)), tag: !!(l.tag || l.shared) })).filter((l): l is { a: GNode; b: GNode; tag: boolean } => !!l.a && !!l.b);
    const linkC = paint("var(--link)");
    openExport({
      name: focus ? `graph-${byId.get(focus)?.label ?? "local"}` : "graph", title: t("Export graph"), themable: true,
      build: async (pr) => {
        const r = await graphSvg(
          // Labels: only the most connected nodes (top 30 %, at least 3 links) so a dense graph stays readable.
          nodes.map((n) => ({ x: n.x ?? 0, y: n.y ?? 0, r: diam(n) / 2, color: n.kind === "tag" ? linkC : paint(n.color), label: n.label, showLabel: !!focus || n.deg >= labelMin })),
          shown.map((l) => ({ a: { x: l.a.x ?? 0, y: l.a.y ?? 0 }, b: { x: l.b.x ?? 0, y: l.b.y ?? 0 }, tag: l.tag })),
          pr,
        );
        // Same edge shapes and tag styling as on screen: rewrite the exporter's straight lines and tag dots in order.
        let i = 0, j = 0;
        const svg = r.svg
          .replace(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" stroke-opacity="([\d.]+)"\/>/g, (_m, x1, y1, x2, y2, o) => {
            const tag = shown[i++]?.tag;
            return `<path d="${edgeD(+x1, +y1, +x2, +y2, edgeShape)}" stroke-opacity="${o}"${tag ? ` stroke="${linkC}" stroke-dasharray="4 4"` : ""}/>`;
          })
          .replace(/<circle ([^>]*)\/>/g, (m, attrs) => (nodes[j++]?.kind === "tag" ? `<circle ${attrs} fill-opacity="0.12" stroke="${linkC}" stroke-width="1.5"/>` : m));
        return { ...r, svg };
      },
    });
  };
  const fit = () => {
    const s = st.current, cv = ref.current;
    if (!cv || !nodes.length) return;
    const xs = nodes.map((n) => n.x ?? 0), ys = nodes.map((n) => n.y ?? 0);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const W = cv.clientWidth - (insetRight ?? 0), H = cv.clientHeight - 40 - (insetBottom ?? 0);
    const k = Math.min(1.6, Math.max(0.1, Math.min(W / (x1 - x0 + 160), H / (y1 - y0 + 160))));
    s.k = k; s.x = W / 2 - ((x0 + x1) / 2) * k; s.y = 40 + H / 2 - ((y0 + y1) / 2) * k;
  };

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const s = st.current;
    const dpr = devicePixelRatio || 1;
    // Setting width/height clears the canvas even when the size is unchanged (the ResizeObserver's first callback
    // lands after the first draw), so only resize on a real change and force a redraw when it happens.
    let lastSig = "";
    const resize = () => {
      const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; lastSig = ""; }
      if (!s.x) { s.x = cv.clientWidth / 2; s.y = cv.clientHeight / 2; }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    const linkArr = links.map((l) => ({ ...l }));
    // Big vaults (thousands of notes): fewer, cheaper layout steps, run a slice per frame instead of all up front.
    const big = nodes.length > BIG_GRAPH;
    const sp = roomy ? 1.6 : 1;
    const charge = forceManyBody<GNode>().strength((d) => sp * (d.kind === "tag" ? -90 : d.deg ? -170 : -50));
    if (big) charge.theta(1.2).distanceMax(700);
    const sim = forceSimulation(nodes)
      .force("link", forceLink<GNode, GLink>(linkArr).id((d) => d.id).distance((l) => sp * (l.tag ? 50 : l.shared ? 110 : 80)).strength((l) => (l.shared ? 0.04 : l.tag ? 0.3 : 0.7)))
      .force("charge", charge)
      .force("center", forceCenter(0, 0))
      .force("x", forceX<GNode>(0).strength((d) => (d.deg ? 0.05 : 0.14))).force("y", forceY<GNode>(0).strength((d) => (d.deg ? 0.05 : 0.14)));
    if (!big) sim.force("collide", forceCollide<GNode>((d) => sp * (8 + Math.min(d.deg, 12) * 1.1)));
    s.sim = sim;
    let simTicks = 0; // ticks from d3's own timer (dragging restarts it)
    sim.on("tick", () => { simTicks++; });
    // Re-fit once the layout has settled (first mount + when fitKey changes).
    const want = fitKey ?? "";
    const total = big ? Math.max(60, Math.round((320 * BIG_GRAPH) / nodes.length)) : 320;
    sim.stop();
    let ticked = 0;
    const fitOnce = () => { if (s.fitted !== want && nodes.length) { s.fitted = want; fit(); } };
    // Small graphs settle up front (deterministic, fitted on first paint), as before.
    if (!big) { sim.tick(total); ticked = total; fitOnce(); }

    if (api) api.current = {
      nodes: () => nodes,
      links: () => linkArr,
      moveTo: (to, frozen) => {
        s.anim = { from: new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }])), to, t0: performance.now(), frozen };
        ticked = total; // a tidied layout replaces whatever was still settling
        sim.stop();
      },
    };

    // Neighbour sets per node, built once (the draw loop used to scan every link on every frame).
    const adj = new Map<string, Set<string>>();
    for (const l of linkArr) {
      const a = typeof l.source === "object" ? (l.source as GNode).id : String(l.source), b = typeof l.target === "object" ? (l.target as GNode).id : String(l.target);
      (adj.get(a) ?? adj.set(a, new Set([a])).get(a)!).add(b);
      (adj.get(b) ?? adj.set(b, new Set([b])).get(b)!).add(a);
    }
    const neighbors = (n: GNode | null) => (n ? adj.get(n.id) ?? new Set([n.id]) : null);
    // Slow or old device (Lumen 22): simple mode = no easing animation, labels only on zoom.
    let simple = reduceEffects();
    const topIds = labelTop > 0 ? new Set([...nodes].sort((a, b) => b.deg - a.deg).slice(0, labelTop).map((n) => n.id)) : null;
    let raf = 0;
    let shown = ticked, shownAt = 0; // layout progress last drawn (big graphs redraw ~3×/s while settling)
    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (ticked < total) {
        const first = ticked === 0;
        const t0 = performance.now();
        while (ticked < total && performance.now() - t0 < 24) { sim.tick(); ticked++; }
        // Fit after the first slice (something sensible on screen) and again once the layout has settled.
        if (first) fitOnce();
        else if (ticked === total) { s.fitted = ""; fitOnce(); }
        if (first || ticked === total || t0 - shownAt > 300) { shown = ticked; shownAt = t0; }
      }
      // Tidy up / undo: ease every node to its target over 380 ms.
      if (s.anim) {
        const a = s.anim, t = simple ? 1 : Math.min(1, (performance.now() - a.t0) / 380), e = 1 - (1 - t) ** 3;
        for (const n of nodes) {
          const f = a.from.get(n.id), to = a.to.get(n.id);
          if (!f || !to) continue;
          n.x = f.x + (to.x - f.x) * e; n.y = f.y + (to.y - f.y) * e;
          n.vx = 0; n.vy = 0;
          if (a.frozen) { n.fx = n.x; n.fy = n.y; } else { n.fx = null; n.fy = null; }
        }
        s.animT++;
        if (t >= 1) { s.anim = null; fit(); }
      }
      const L = look.current;
      // Redraw only when something visible changed (view, hover, selection, layout, size, theme, display options).
      const sig = `${s.k}|${s.x}|${s.y}|${s.hover?.id ?? ""}|${s.selected ?? ""}|${shown}|${simTicks}|${s.animT}|${cv.width}x${cv.height}|${css("--accent")}|${css("--bg")}|${s.opts}`;
      if (sig === lastSig) return;
      lastSig = sig;
      const drawT0 = performance.now();
      const w = cv.width, h = cv.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(dpr * s.k, 0, 0, dpr * s.k, dpr * s.x, dpr * s.y);
      const selNode = s.selected ? nodes.find((n) => n.id === s.selected) ?? null : null;
      const lit = s.hover ?? (focus ? null : selNode);
      const hl = neighbors(lit);
      const edge = css("--muted") || "#888";
      const accent = css("--accent") || "#f2a93b";
      const text = css("--text") || "#ddd";
      const bg = css("--bg") || "#000";
      const tagC = css("--link") || "#5cc8c2";
      const px = 1 / s.k;
      const fadeOut = L.dim ? 0.18 : 1;
      // Edges: muted (links) / teal dashed (tags); around the lit node amber, others fade.
      // Batched into one path per style: one stroke() for thousands of edges instead of one each.
      const batch = (pick: (l: GLink, on: boolean) => boolean, style: string, width: number, alpha: number, dash?: number[]) => {
        ctx.strokeStyle = style; ctx.lineWidth = width * px; ctx.globalAlpha = alpha;
        ctx.setLineDash(dash ? dash.map((d) => d * px) : []);
        ctx.beginPath();
        for (const l of linkArr) {
          const a = l.source as GNode, b = l.target as GNode;
          if (!L.showLinks && !l.tag && !l.shared) continue;
          if (pick(l, !!lit && (a === lit || b === lit))) edgePath(ctx, a.x!, a.y!, b.x!, b.y!, L.edgeShape);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      };
      // Link edges solid; tag edges (note -> tag node, or shared tag) dashed in --link (legend: Link vs Tag).
      const tagEdge = (l: GLink) => !!(l.tag || l.shared);
      if (lit) {
        batch((l, on) => !on && !tagEdge(l), edge, 1, L.dim ? 0.1 : 0.35);
        batch((l, on) => !on && tagEdge(l), tagC, 1.2, L.dim ? 0.08 : 0.4, [4, 4]);
        batch((l, on) => on && !tagEdge(l), accent, 1.5, 0.9);
        batch((l, on) => on && tagEdge(l), tagC, 1.2, 0.9, [4, 4]);
      } else {
        // Thousands of overlapping edges at 35% turn into a solid sheet: fade them with graph size.
        const fade = big ? Math.max(0.15, BIG_GRAPH / nodes.length) : 1;
        batch((l) => !tagEdge(l), edge, 1.5, 0.35 * fade);
        batch((l) => !!l.tag, tagC, 1.2, 0.5 * fade, [4, 4]);
        batch((l) => !!l.shared, tagC, 1.2, 0.35 * fade, [1.5, 4]);
      }
      const zoomF = Math.max(0.75, Math.min(1, s.k * 1.1));
      for (const n of nodes) {
        const isTag = n.kind === "tag";
        const r = (diam(n) * (isTag ? 1 : zoomF)) / 2;
        const on = !hl || hl.has(n.id);
        const big = n === lit || n === selNode || n.id === focus;
        ctx.globalAlpha = on ? 1 : fadeOut;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
        if (isTag) {
          // Tag node (20b): bg-filled ring in --link with a muted "#".
          ctx.fillStyle = bg; ctx.fill();
          ctx.lineWidth = 1.5; ctx.strokeStyle = tagC; ctx.stroke();
          ctx.fillStyle = edge; ctx.font = `700 10px Inter, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("#", n.x!, n.y! + 0.5);
        } else { ctx.fillStyle = paint(n.color); ctx.fill(); }
        if (L.pinned?.(n.id)) { ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(n.x! + r * 0.75, n.y! - r * 0.75, Math.max(2, 2.5 * px), 0, Math.PI * 2); ctx.fill(); }
        if (big) {
          ctx.globalAlpha = 1;
          ctx.lineWidth = 3 * px; ctx.strokeStyle = bg; ctx.beginPath(); ctx.arc(n.x!, n.y!, r + 1.5 * px, 0, Math.PI * 2); ctx.stroke();
          ctx.lineWidth = 2 * px; ctx.strokeStyle = accent; ctx.beginPath(); ctx.arc(n.x!, n.y!, r + 4 * px, 0, Math.PI * 2); ctx.stroke();
        }
        const showL = n.label && (simple ? (hl && hl.has(n.id)) || s.k > 1.4 : topIds ? topIds.has(n.id) || (hl && hl.has(n.id)) || focus || s.k > 2.4 : (isTag ? n.deg >= 2 : n.deg >= 3) || (hl && hl.has(n.id)) || focus || s.k > 2.4);
        // Tidied (fixed) nodes keep labels inside their layout box: world-sized when zoomed out, hidden when tiny.
        const fixed = n.fx != null && s.k < 1;
        if (showL && !(fixed && s.k * 11.5 < 6.5)) {
          ctx.globalAlpha = on ? 0.95 : Math.max(0.2, fadeOut);
          ctx.fillStyle = text;
          const fs = (big ? 13 : 11.5) * (fixed ? 1 : px);
          ctx.font = `${big ? 650 : 450} ${fs}px Inter, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(n.label.length > 32 ? n.label.slice(0, 31) + "…" : n.label, n.x!, n.y! + r + 4 * px);
        }
      }
      ctx.globalAlpha = 1;
      if (!simple && nodes.length > 300 && reportDrawTime(performance.now() - drawT0)) { simple = true; L.onSlow?.(); lastSig = ""; }
      if (posCb.current) {
        const p = selNode ? `${Math.round(s.x + selNode.x! * s.k)},${Math.round(s.y + selNode.y! * s.k)}` : "";
        if (p !== s.pos) { s.pos = p; const [x, y] = p.split(",").map(Number); posCb.current(p ? { x, y } : null); }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); sim.stop(); ro.disconnect(); if (api?.current?.nodes() === nodes) api.current = null; };
  }, [nodes, links, focus, roomy, labelTop]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const zoomAt = (mx: number, my: number, k0: number) => {
    const s = st.current;
    const k = Math.min(4, Math.max(0.1, k0));
    s.x = mx - ((mx - s.x) * k) / s.k; s.y = my - ((my - s.y) * k) / s.k; s.k = k;
  };
  const zoomBy = (f: number) => { const cv = ref.current!; zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, st.current.k * f); };
  const open = (n: GNode) => { if (n.note) (onOpen ?? openNote)(n.note.id); };

  return (
    <>
      <canvas
        ref={ref}
        className="h-full w-full touch-none bg-bg"
        style={{ cursor: hover ? "pointer" : "grab" }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const s = st.current;
          s.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (s.touches.size === 2) {
            // Pinch to zoom + two-finger pan.
            const [a, b] = [...s.touches.values()];
            const r = ref.current!.getBoundingClientRect();
            s.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: s.k, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, x: s.x, y: s.y };
            if (s.drag) { if (!s.dragFixed) { s.drag.fx = null; s.drag.fy = null; } s.drag = null; }
            s.pan = null; s.moved = true;
            return;
          }
          s.moved = false;
          const n = pick(e);
          if (n) { s.drag = n; s.dragFixed = n.fx != null; n.fx = n.x; n.fy = n.y; if (!s.dragFixed) s.sim?.alphaTarget(0.3).restart(); }
          else s.pan = { x: e.clientX - s.x, y: e.clientY - s.y };
          s.touched = true;
        }}
        onPointerMove={(e) => {
          const s = st.current;
          if (s.touches.has(e.pointerId)) s.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (s.pinch && s.touches.size === 2) {
            const [a, b] = [...s.touches.values()];
            const r = ref.current!.getBoundingClientRect();
            const p = s.pinch, k = Math.min(4, Math.max(0.1, p.k * Math.hypot(a.x - b.x, a.y - b.y) / (p.d || 1)));
            const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
            s.k = k; s.x = cx - ((p.cx - p.x) * k) / p.k; s.y = cy - ((p.cy - p.y) * k) / p.k;
            return;
          }
          if (s.drag) { const p = toWorld(e); s.drag.fx = p.x; s.drag.fy = p.y; if (s.dragFixed) { s.drag.x = p.x; s.drag.y = p.y; s.animT++; } s.moved = true; }
          else if (s.pan) { s.x = e.clientX - s.pan.x; s.y = e.clientY - s.pan.y; s.moved = true; }
          else if (e.pointerType === "mouse") { const n = pick(e); s.hover = n; setHover(n); }
        }}
        onPointerUp={(e) => {
          const s = st.current;
          s.touches.delete(e.pointerId);
          if (s.pinch) { if (s.touches.size < 2) s.pinch = null; return; }
          if (s.drag) {
            if (!s.moved) {
              if (!onSelect) open(s.drag);
              else {
                const now = Date.now();
                if (s.lastClick.id === s.drag.id && now - s.lastClick.t < 350) open(s.drag);
                else onSelect(s.drag);
                s.lastClick = { id: s.drag.id, t: now };
              }
            }
            // Tidied (fixed) layout: the dragged node stays put and gets a pin. Free layout: physics resumes on release.
            if (s.dragFixed) { if (s.moved) onPin?.(s.drag.id, { x: s.drag.x!, y: s.drag.y! }); s.animT++; }
            else { s.drag.fx = null; s.drag.fy = null; s.sim?.alphaTarget(0); }
            s.drag = null;
          } else if (s.pan && !s.moved) onSelect?.(null);
          s.pan = null;
        }}
        onPointerLeave={() => { st.current.hover = null; setHover(null); }}
        onWheel={(e) => {
          st.current.touched = true;
          const r = ref.current!.getBoundingClientRect();
          zoomAt(e.clientX - r.left, e.clientY - r.top, st.current.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
        }}
      />
      {controls && (
        <div className="absolute bottom-4 left-4 z-10 hidden gap-0.5 rounded-[10px] border border-line bg-surface p-[3px] md:flex">
          {([[t("Zoom in"), <Plus size={14} />, () => zoomBy(1.25)], [t("Zoom out"), <Minus size={14} />, () => zoomBy(0.8)], [t("Fit"), <Scan size={14} />, fit], [t("Export image (SVG, PNG, JPEG, WebP)"), <ImageDown size={14} />, exportImage]] as const).map(([l, i, f]) => (
            <button key={l} aria-label={l} title={l} onClick={f} className="flex h-7 w-[30px] items-center justify-center rounded-[7px] text-ink hover:bg-surface-2">{i}</button>
          ))}
        </div>
      )}
      {!onSelect && hover?.note && (
        <div className={cx("pointer-events-none absolute bottom-4 left-4 max-w-xs rounded-[12px] border border-line bg-surface-2 p-3 text-[12.5px] shadow-xl fade-in")}>
          <div className="font-semibold" dir="auto">{hover.note.title}</div>
          <div className="text-muted">{hover.note.type}{hover.note.status ? ` · ${keyName(hover.note.status)}` : ""} · {t("{n} link|{n} links", { n: hover.deg })}</div>
          <div className="mt-1 line-clamp-3 text-muted">{hover.note.body.slice(0, 200)}</div>
        </div>
      )}
    </>
  );
}
