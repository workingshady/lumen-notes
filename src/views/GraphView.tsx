import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { ArrowLeft, ChevronDown, ChevronUp, Locate, Minus, Plus, Scan, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Note } from "../../shared/types";
import { matcher, parseQuery } from "../lib/search";
import { go, openNote, useUI, useVault } from "../lib/store";
import { plainExcerpt } from "../components/nav-text";
import { cx, STATUS_COLOR } from "../components/ui";

type GNode = SimulationNodeDatum & { id: string; label: string; kind: "note" | "tag"; note?: Note; deg: number; color: string };
type GLink = SimulationLinkDatum<GNode> & { tag?: boolean };
type ColorBy = "folder" | "type" | "status";

/** Folder colours in design order (01 cyan, 02 orange, 03 purple, 04 green, 05 yellow, …). */
const FOLDER_PAL = ["#39C5CF", "#E8893A", "#A371F7", "#57AB5A", "#E3B341", "#E5534B", "#7AA2F7", "#D37FB4", "#5CC8C2"];
const MOC_C = "#E8E6E1", JOURNAL_C = "#6B7280";
const TYPE_C: Record<string, string> = { note: "#9AA0AA", lesson: "#39C5CF", journal: JOURNAL_C, flashcards: "#B48EF0", slides: "#E8893A", post: "#57AB5A", canvas: "#A371F7", whiteboard: "#E3B341", roadmap: "#F2A93B", moc: MOC_C };
const STATUS_C: Record<string, string> = { todo: "#9AA0AA", learning: "#7AA2F7", review: "#E8B34A", mastered: "#6BCB8B", none: "#4B5260" };
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
/** Canvas can't paint `var(--x)`: resolve it first. */
const paint = (c: string) => { const m = /^var\((--[\w-]+)\)$/.exec(c); return m ? css(m[1]) || "#888" : c; };
const PANEL_KEY = "lumen.graphPanel";
const ls = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
const useWidth = () => { const [w, setW] = useState(() => innerWidth); useEffect(() => { const f = () => setW(innerWidth); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return w; };

/** Small on/off switch matching the design (30×18, amber when on). */
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full items-center text-left leading-[18px]">
      <span className="flex-1">{label}</span>
      <span className={cx("relative box-border h-[18px] w-[30px] rounded-full transition-colors", on ? "bg-accent" : "border border-line bg-surface-2")}>
        <span className={cx("absolute size-3 rounded-full", on ? "right-[3px] top-[3px] bg-accent-fg" : "left-[2px] top-[2px] bg-muted")} />
      </span>
    </button>
  );
}

/** Depth slider drawn like the design (4px track, 16px thumb), 1–3. */
function DepthSlider({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const pct = ((value - 1) / 2) * 100;
  return (
    <div className="relative h-4">
      <div className="absolute inset-x-0 top-1.5 h-1 rounded-[2px] bg-surface-2"><span className="absolute inset-y-0 left-0 rounded-[2px] bg-ink opacity-70" style={{ width: `${pct}%` }} /></div>
      <span className="pointer-events-none absolute top-0 -ml-2 size-4 rounded-full bg-ink" style={{ left: `${pct}%` }} />
      <input type="range" min={1} max={3} step={1} value={value} disabled={disabled} aria-label="Local graph depth" onChange={(e) => onChange(Number(e.target.value))} className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-default" />
    </div>
  );
}

export function GraphView({ localTo }: { localTo?: string }) {
  const v = useVault();
  const ui = useUI();
  const width = useWidth();
  const phone = width < 768;
  // "Graph from note" (New… chooser / palette) asks for a local graph through sessionStorage.
  const [requested] = useState(() => { try { return sessionStorage.getItem("lumen.graphLocal"); } catch { return null; } });
  useEffect(() => { try { sessionStorage.removeItem("lumen.graphLocal"); } catch { /* ignore */ } }, []);
  const [q, setQ] = useState("");
  const [showTags, setShowTags] = useState(false);
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
  const open = panel === "1";
  const togglePanel = () => setPanel((p) => { const n = p === "1" ? "0" : "1"; ls.set(PANEL_KEY, n); return n; });
  const center = focusId ?? localTo ?? ui.noteId;
  const embedded = !!localTo;

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
    let notes = v.notes.filter((n) => (allSpaces || ui.spaceId === "all" || local || n.spaceId === ui.spaceId) && f(n) && (!text || n.title.toLowerCase().includes(text)) && (journal || n.type !== "journal"));
    if (local && center) {
      const keep = new Set([center]);
      let frontier = [center];
      for (let d = 0; d < depth; d++) {
        const next: string[] = [];
        for (const id of frontier) for (const o of [...(v.outlinks.get(id) ?? []), ...(v.backlinks.get(id) ?? [])]) if (!keep.has(o)) { keep.add(o); next.push(o); }
        frontier = next;
      }
      notes = v.notes.filter((n) => keep.has(n.id) && (journal || n.type !== "journal" || n.id === center));
    }
    // Legend over the visible notes (before isolating, so every chip stays tappable).
    const count = new Map<string, number>();
    for (const n of notes) count.set(keyOf(n), (count.get(keyOf(n)) ?? 0) + 1);
    const folderKeys = [...count.keys()].filter((k) => !k.startsWith("@")).sort((a, b) => (v.folderMap.get(a)?.name ?? "").localeCompare(v.folderMap.get(b)?.name ?? ""));
    const colorOfKey = (k: string) => colorBy === "status" ? STATUS_C[k] ?? STATUS_C.none : colorBy === "type" ? TYPE_C[k] ?? "#9AA0AA"
      : k === "@moc" ? MOC_C : k === "@journal" ? JOURNAL_C : k === "@root" ? "#4B5260" : v.folderMap.get(k)?.color ?? FOLDER_PAL[folderKeys.indexOf(k) % FOLDER_PAL.length];
    const nameOf = (k: string) => colorBy !== "folder" ? (k === "none" ? "No status" : k === "moc" ? "Map of content" : k.charAt(0).toUpperCase() + k.slice(1))
      : k === "@moc" ? "Map of content" : k === "@journal" ? "Journal" : k === "@root" ? "Unfiled" : v.folderMap.get(k)?.name ?? k;
    const order = colorBy === "folder" ? [...folderKeys, "@root", "@moc", "@journal"] : colorBy === "status" ? ["todo", "learning", "review", "mastered", "none"] : Object.keys(TYPE_C);
    const legend = order.filter((k) => count.has(k)).map((k) => ({ k, n: nameOf(k), c: colorOfKey(k), count: count.get(k)! }));
    if (iso) notes = notes.filter((n) => keyOf(n) === iso || n.id === center && local);

    const ids = new Set(notes.map((n) => n.id));
    const nodes: GNode[] = notes.map((n) => ({ id: n.id, label: n.title, kind: "note", note: n, deg: 0, color: colorOfKey(keyOf(n)) }));
    const links: GLink[] = [];
    for (const n of notes) for (const o of v.outlinks.get(n.id) ?? []) if (ids.has(o)) links.push({ source: n.id, target: o });
    if (showTags) {
      const tags = new Set(notes.flatMap((n) => n.tags));
      for (const t of tags) nodes.push({ id: `#${t}`, label: `#${t}`, kind: "tag", deg: 0, color: "var(--muted)" });
      for (const n of notes) for (const t of n.tags) links.push({ source: n.id, target: `#${t}`, tag: true });
    }
    const deg = new Map<string, number>();
    for (const l of links) { deg.set(l.source as string, (deg.get(l.source as string) ?? 0) + 1); deg.set(l.target as string, (deg.get(l.target as string) ?? 0) + 1); }
    nodes.forEach((n) => (n.deg = deg.get(n.id) ?? 0));
    const final = orphans ? nodes : nodes.filter((n) => n.deg > 0 || n.id === center);
    const finalIds = new Set(final.map((n) => n.id));
    return { nodes: final, links: links.filter((l) => finalIds.has(l.source as string) && finalIds.has(l.target as string)), legend, notes: notes.length };
  }, [v, q, showTags, orphans, journal, colorBy, local, depth, center, ui.spaceId, allSpaces, iso]);

  const sel = selId ? graph.nodes.find((n) => n.id === selId) ?? null : null;
  const selNote = sel?.note;
  const folderOf = (n: Note) => (n.folderId ? v.folderMap.get(n.folderId)?.name : v.spaceMap.get(n.spaceId)?.name) ?? "";
  const showLocal = (id: string) => { setFocusId(id); setLocal(true); setSelId(id); };
  const linkCount = graph.links.filter((l) => !l.tag).length;
  const space = v.spaceMap.get(ui.spaceId);
  const leave = () => (ui.history.length ? go("notes", { noteId: ui.history[ui.history.length - 1] }) : go("home"));

  const card = selNote && sel && (
    <>
      <div className="flex items-center gap-1.5 text-[12px] text-muted">
        <span className="size-2 shrink-0 rounded-[3px]" style={{ background: sel.color }} />
        <span className="truncate">{folderOf(selNote)}<span className="md:hidden"> · {sel.deg} links</span></span>
        <span className="hidden flex-1 md:inline" />
        {selNote.status && (
          <span className="hidden items-center gap-1 capitalize md:flex" style={{ color: STATUS_COLOR[selNote.status] }}>
            <span className="size-1.5 rounded-full" style={{ background: STATUS_COLOR[selNote.status] }} />{selNote.status}
          </span>
        )}
      </div>
      <span dir="auto" className="text-[17px] font-[650] md:text-[15px]">{selNote.title}</span>
      <span dir="auto" className="line-clamp-2 text-[13.5px] leading-5 text-muted md:text-[12.5px] md:leading-[19px]">{plainExcerpt(selNote.body, 90) || "Empty note"}</span>
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

  const panelBody = (
    <div className="flex flex-col gap-3.5 overflow-y-auto px-3.5 py-3">
      <label className="flex h-8 shrink-0 items-center gap-2 rounded-[6px] border border-line bg-bg px-2.5 text-muted focus-within:border-accent">
        <Search size={13} className="shrink-0" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter… tag:#math" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted" />
      </label>
      <div className="flex flex-col gap-2.5">
        <Toggle label="Tags as nodes" on={showTags} onChange={setShowTags} />
        <Toggle label="Orphans" on={orphans} onChange={setOrphans} />
        <Toggle label="Journal notes" on={journal} onChange={setJournal} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] text-muted">Colour by</span>
        <div className="grid grid-cols-3 gap-0.5 rounded-[8px] border border-line bg-bg p-[3px]">
          {(["folder", "type", "status"] as ColorBy[]).map((c) => (
            <button key={c} onClick={() => { setColorBy(c); setIso(null); }} className={cx("h-6 rounded-[6px] capitalize", colorBy === c ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}>{c}</button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between text-[12px]"><span className="text-muted">Local graph depth</span><span className="tabular-nums">{depth}</span></div>
        <DepthSlider value={depth} onChange={(d) => { setDepth(d); if (!local && (selId ?? center)) showLocal((selId ?? center)!); }} />
      </div>
      <div className="flex flex-col gap-[7px] border-t border-line pt-3">
        {graph.legend.map((l) => (
          <button key={l.k} onClick={() => setIso((x) => (x === l.k ? null : l.k))} title={iso === l.k ? "Show all" : "Isolate"} className={cx("flex items-center gap-2 text-left leading-4", iso && iso !== l.k && "opacity-40")}>
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: l.c }} /><span className="flex-1 truncate">{l.n}</span><span className="text-[12px] text-muted">{l.count}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div ref={host} className={cx("overflow-hidden bg-bg text-[13px]", phone && !embedded ? "fixed inset-0 z-30 flex flex-col" : "relative h-full")}>
      {/* Phone header: back · Graph · Global / Local · display */}
      {phone && !embedded && (
        <div className="safe-t relative z-20 flex h-14 shrink-0 items-center gap-2 px-2">
          <button aria-label="Back" onClick={leave} className="flex size-11 items-center justify-center"><ArrowLeft size={20} /></button>
          <span className="flex-1 text-[17px] font-[650]">Graph</span>
          <div className="flex rounded-[10px] border border-line bg-surface p-[3px] text-[13px]">
            <button onClick={() => { setLocal(false); setFocusId(null); }} className={cx("flex h-8 items-center rounded-[7px] px-3", !local ? "bg-surface-2 font-semibold" : "text-muted")}>Global</button>
            <button onClick={() => { const id = selId ?? center; if (id) showLocal(id); }} className={cx("flex h-8 items-center rounded-[7px] px-3", local ? "bg-surface-2 font-semibold" : "text-muted")}>Local · {depth}</button>
          </div>
          <button aria-label="Graph display settings" onClick={togglePanel} className={cx("flex size-11 items-center justify-center", open && "text-accent")}><SlidersHorizontal size={20} /></button>
        </div>
      )}
      <div className={cx("relative overflow-hidden", phone && !embedded ? "min-h-0 flex-1" : "h-full")}>
        <Canvas2D nodes={graph.nodes} links={graph.links} focus={local ? center : null} selected={selId} onSelect={(n) => setSelId(n?.id ?? null)} onSelectedPos={setSelPos}
          controls={!embedded && open && !phone} fitKey={`${local}:${center}:${depth}:${iso}`} insetRight={open && !phone ? 300 : 0} insetBottom={phone && selId ? 250 : 0} />

        {/* Desktop / tablet header */}
        {!embedded && !phone && (
          <div className="absolute left-5 top-4 z-10 flex items-center gap-2.5">
            <span className="text-[16px] font-[650]">Graph</span>
            {ui.spaceId !== "all" && !local && width >= 1100 && (
              <div className="relative">
                <button onClick={() => setSpaceMenu((m) => !m)} className="flex h-7 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-muted hover:text-ink">
                  <span className="text-ink">{allSpaces ? "All spaces" : `${space?.icon ?? ""} This space`}</span><ChevronDown size={12} />
                </button>
                {spaceMenu && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setSpaceMenu(false)} />
                    <div className="absolute left-0 top-9 z-30 flex w-48 flex-col gap-px rounded-[12px] border border-line bg-surface-2 p-1.5 shadow-[0_16px_40px_rgba(0,0,0,.45)] fade-in">
                      {[["This space", false], ["All spaces", true]].map(([l, a]) => (
                        <button key={l as string} onClick={() => { setAllSpaces(a as boolean); setSpaceMenu(false); }} className={cx("flex h-8 items-center rounded-[8px] px-2.5 text-left hover:bg-bg", allSpaces === a && "font-semibold")}>{a ? l : `${space?.icon ?? ""} ${space?.name ?? l}`}</button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {local && <button onClick={() => { setLocal(false); setFocusId(null); }} className="flex h-7 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-muted hover:text-ink"><Locate size={12} /> Local · {depth}<X size={12} /></button>}
            <span className="text-[12px] text-muted">{graph.notes} notes · {linkCount} links</span>
          </div>
        )}

        {/* Selected preview: floating card on desktop, bottom sheet on phone */}
        {card && (
          <>
            <div className="absolute z-10 hidden w-[268px] flex-col gap-2 rounded-[14px] border border-line bg-surface-2 p-3.5 shadow-[0_16px_40px_rgba(0,0,0,.45)] md:flex fade-in" style={cardStyle}>
              {card}
              <div className="mt-0.5 flex items-center gap-2">
                <button onClick={() => openNote(selNote!.id)} className="flex h-[30px] items-center rounded-[8px] border border-line bg-bg px-3 font-medium hover:border-accent">Open</button>
                <button onClick={() => showLocal(selNote!.id)} className="flex h-[30px] items-center gap-1.5 rounded-[8px] border border-line px-3 hover:bg-surface"><Locate size={13} />Local graph</button>
                <span className="flex-1" />
                <span className="text-[12px] text-muted">{sel!.deg} links</span>
              </div>
            </div>
            <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2.5 rounded-t-[14px] border-t border-line bg-surface px-5 pt-2.5 safe-b md:hidden sheet-in">
              <div className="flex justify-center"><button aria-label="Close preview" onClick={() => setSelId(null)} className="h-1 w-9 rounded-full bg-line" /></div>
              {card}
              <div className="flex gap-2.5 pb-2 pt-1">
                <button onClick={() => openNote(selNote!.id)} className="flex h-12 flex-1 items-center justify-center rounded-[12px] bg-accent font-semibold text-accent-fg">Open note</button>
                <button aria-label="Local graph" onClick={() => showLocal(selNote!.id)} className="flex size-12 items-center justify-center rounded-[12px] border border-line"><Locate size={18} /></button>
              </div>
              <div className="flex h-6 items-center justify-center"><span className="h-1 w-[108px] rounded-full bg-muted opacity-45" /></div>
            </div>
          </>
        )}

        {/* Display panel (collapses to one icon; state remembered) */}
        {!phone && (
          <div className="absolute right-4 top-3 z-10 flex flex-col items-end">
            {open ? (
              <div className="mt-1 flex max-h-[calc(100vh-120px)] w-[272px] flex-col overflow-hidden rounded-[14px] border border-line bg-surface fade-in">
                <button onClick={togglePanel} className="flex h-11 shrink-0 items-center gap-2 border-b border-line pl-3.5 pr-2.5 text-left">
                  <SlidersHorizontal size={14} className="text-muted" /><span className="flex-1 font-semibold">Display</span><ChevronUp size={15} className="text-muted" />
                </button>
                {panelBody}
              </div>
            ) : (
              <button aria-label="Graph display settings" title="Display" onClick={togglePanel} className="flex size-11 items-center justify-center rounded-[12px] border border-line bg-surface hover:text-accent">
                <SlidersHorizontal size={18} />
              </button>
            )}
          </div>
        )}
        {phone && open && (
          <div className="absolute inset-x-3 top-1 z-20 flex max-h-[70%] flex-col overflow-hidden rounded-[14px] border border-line bg-surface text-[13px] shadow-xl fade-in">
            <button onClick={togglePanel} className="flex h-11 shrink-0 items-center gap-2 border-b border-line pl-3.5 pr-2.5 text-left">
              <SlidersHorizontal size={14} className="text-muted" /><span className="flex-1 font-semibold">Display</span><X size={15} className="text-muted" />
            </button>
            {panelBody}
          </div>
        )}

        {/* Legend chips when the panel is collapsed: tap = isolate that group */}
        {!open && !embedded && !(phone && card) && (
          <div className={cx("absolute left-4 right-4 z-10 flex flex-wrap gap-1.5", phone ? "bottom-4" : "bottom-4", card && "md:hidden")}>
            {graph.legend.map((l) => (
              <button key={l.k} onClick={() => setIso((x) => (x === l.k ? null : l.k))} title={iso === l.k ? "Show all" : "Isolate"}
                className={cx("flex h-7 items-center gap-1.5 rounded-full border bg-surface px-2.5 text-[12px]", iso === l.k ? "border-accent" : "border-line", iso && iso !== l.k && "opacity-50")}>
                <span className="size-2 rounded-full" style={{ background: l.c }} />{l.n}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export type { GNode, GLink };
export function Canvas2D({ nodes, links, focus, onOpen, selected, onSelect, onSelectedPos, controls, fitKey, insetRight, insetBottom }: {
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
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<GNode | null>(null);
  const st = useRef({ x: 0, y: 0, k: 1, sim: null as Simulation<GNode, GLink> | null, drag: null as GNode | null, pan: null as { x: number; y: number } | null, moved: false, hover: null as GNode | null, selected: null as string | null, lastClick: { id: "", t: 0 }, touched: false, pos: "", fitted: "0000", touches: new Map<number, { x: number; y: number }>(), pinch: null as null | { d: number; k: number; cx: number; cy: number; x: number; y: number } });
  st.current.selected = selected ?? null;
  const posCb = useRef(onSelectedPos);
  posCb.current = onSelectedPos;

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
    const resize = () => { cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; if (!s.x) { s.x = cv.clientWidth / 2; s.y = cv.clientHeight / 2; } };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    const linkArr = links.map((l) => ({ ...l }));
    const sim = forceSimulation(nodes)
      .force("link", forceLink<GNode, GLink>(linkArr).id((d) => d.id).distance((l) => (l.tag ? 50 : 80)))
      .force("charge", forceManyBody<GNode>().strength((d) => (d.deg ? -170 : -50)))
      .force("center", forceCenter(0, 0))
      .force("x", forceX<GNode>(0).strength((d) => (d.deg ? 0.05 : 0.14))).force("y", forceY<GNode>(0).strength((d) => (d.deg ? 0.05 : 0.14)))
      .force("collide", forceCollide<GNode>((d) => 8 + Math.min(d.deg, 12) * 1.1));
    s.sim = sim;
    // Re-fit once the layout has settled (first mount + when fitKey changes).
    const want = fitKey ?? "";
    // Settle the layout up front (deterministic), then fit once per fitKey.
    sim.stop(); sim.tick(320);
    if (s.fitted !== want && nodes.length) { s.fitted = want; fit(); }

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
      const selNode = s.selected ? nodes.find((n) => n.id === s.selected) ?? null : null;
      const lit = s.hover ?? (focus ? null : selNode);
      const hl = neighbors(lit);
      const edge = css("--muted") || "#888";
      const accent = css("--accent") || "#f2a93b";
      const text = css("--text") || "#ddd";
      const bg = css("--bg") || "#000";
      const px = 1 / s.k;
      // Edges: muted at 35%; around the lit node amber, others fade to 10%.
      for (const l of linkArr) {
        const a = l.source as GNode, b = l.target as GNode;
        const on = !!lit && (a === lit || b === lit);
        ctx.strokeStyle = on ? accent : edge;
        ctx.lineWidth = (on ? 1.5 : 1) * px;
        ctx.globalAlpha = lit ? (on ? 0.9 : 0.1) : l.tag ? 0.2 : 0.35;
        ctx.beginPath(); ctx.moveTo(a.x!, a.y!); ctx.lineTo(b.x!, b.y!); ctx.stroke();
      }
      const zoomF = Math.max(0.75, Math.min(1, s.k * 1.1));
      for (const n of nodes) {
        const d = Math.max(5, 6 + Math.min(n.deg, 12) * 2.1) * zoomF;
        const r = d / 2;
        const on = !hl || hl.has(n.id);
        const big = n === lit || n === selNode || n.id === focus;
        ctx.globalAlpha = on ? 1 : 0.18;
        ctx.fillStyle = paint(n.color);
        ctx.beginPath(); ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2); ctx.fill();
        if (big) {
          ctx.globalAlpha = 1;
          ctx.lineWidth = 3 * px; ctx.strokeStyle = bg; ctx.beginPath(); ctx.arc(n.x!, n.y!, r + 1.5 * px, 0, Math.PI * 2); ctx.stroke();
          ctx.lineWidth = 2 * px; ctx.strokeStyle = accent; ctx.beginPath(); ctx.arc(n.x!, n.y!, r + 4 * px, 0, Math.PI * 2); ctx.stroke();
        }
        const showL = n.label && (n.deg >= 3 || (hl && hl.has(n.id)) || focus || s.k > 2.4);
        if (showL) {
          ctx.globalAlpha = on ? 0.95 : 0.2;
          ctx.fillStyle = text;
          const fs = (big ? 13 : 11.5) * px;
          ctx.font = `${big ? 650 : 450} ${fs}px Inter, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(n.label.length > 32 ? n.label.slice(0, 31) + "…" : n.label, n.x!, n.y! + r + 4 * px);
        }
      }
      ctx.globalAlpha = 1;
      if (posCb.current) {
        const p = selNode ? `${Math.round(s.x + selNode.x! * s.k)},${Math.round(s.y + selNode.y! * s.k)}` : "";
        if (p !== s.pos) { s.pos = p; const [x, y] = p.split(",").map(Number); posCb.current(p ? { x, y } : null); }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); sim.stop(); ro.disconnect(); };
  }, [nodes, links, focus]); // eslint-disable-line react-hooks/exhaustive-deps

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
            if (s.drag) { s.drag.fx = null; s.drag.fy = null; s.drag = null; }
            s.pan = null; s.moved = true;
            return;
          }
          s.moved = false;
          const n = pick(e);
          if (n) { s.drag = n; n.fx = n.x; n.fy = n.y; s.sim?.alphaTarget(0.3).restart(); }
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
          if (s.drag) { const p = toWorld(e); s.drag.fx = p.x; s.drag.fy = p.y; s.moved = true; }
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
            // Physics resumes on release.
            s.drag.fx = null; s.drag.fy = null; s.sim?.alphaTarget(0); s.drag = null;
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
          {([["Zoom in", <Plus size={14} />, () => zoomBy(1.25)], ["Zoom out", <Minus size={14} />, () => zoomBy(0.8)], ["Fit", <Scan size={14} />, fit]] as const).map(([l, i, f]) => (
            <button key={l} aria-label={l} title={l} onClick={f} className="flex h-7 w-[30px] items-center justify-center rounded-[7px] text-ink hover:bg-surface-2">{i}</button>
          ))}
        </div>
      )}
      {!onSelect && hover?.note && (
        <div className={cx("pointer-events-none absolute bottom-4 left-4 max-w-xs rounded-[12px] border border-line bg-surface-2 p-3 text-[12.5px] shadow-xl fade-in")}>
          <div className="font-semibold">{hover.note.title}</div>
          <div className="text-muted">{hover.note.type}{hover.note.status ? ` · ${hover.note.status}` : ""} · {hover.deg} links</div>
          <div className="mt-1 line-clamp-3 text-muted">{hover.note.body.slice(0, 200)}</div>
        </div>
      )}
    </>
  );
}
