// Big graphs (design Lumen 32 · R6-32A–C, G–I; Lumen 22 §4). Above `graphAsk` notes (lib/scale-prefs.ts) the graph
// asks before drawing everything: Full graph (the original view, always first and always in the view switch),
// Grouped by folder (suggested), Tree, Local and Filter. "Remember my choice" stores the pick per space.
// Grouped: one circle per folder (size = notes, line thickness = links between folders), click for a summary,
// Open group drills in. Tree: folders → notes left to right, counts on every branch, long branches end in "+ N more".
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Folder, Note } from "../../shared/types";
import { Glyph } from "../components/Glyph";
import type { GlyphName } from "../lib/glyphs";
import { cx } from "../components/ui";
import { fmtNum, t, tk } from "../lib/i18n";
import { openNote } from "../lib/store";

export type BigMode = "full" | "grouped" | "tree" | "local" | "filter";
/** Folder colours in design order (same as GraphView). */
export const BIG_PAL = ["#39C5CF", "#E8893A", "#A371F7", "#57AB5A", "#E5534B", "#E3B341", "#7AA2F7", "#D37FB4", "#5CC8C2"];
const GREY = "#9AA0AA";

type VaultLike = { folderMap: Map<string, Folder>; spaceMap: Map<string, { id: string; name: string; color?: string | null }>; outlinks: Map<string, string[]>; backlinks: Map<string, string[]>; byId: Map<string, Note> };

// ------------------------------------------------------------------ view switch + bar
const MODES: [BigMode, GlyphName, string][] = [["full", "graph", tk("Full")], ["grouped", "cluster", tk("Grouped")], ["tree", "tree", tk("Tree")], ["local", "note", tk("Local")], ["filter", "filter", tk("Filter")]];

/** Top bar (48 px desktop / 52 px phone): glyph · title · subtitle · Full · Grouped · Tree · Local · Filter. */
export function BigBar({ mode, onMode, title, sub, glyph, phone, lead }: { mode: BigMode; onMode: (m: BigMode) => void; title: string; sub: string; glyph: GlyphName; phone: boolean; lead?: ReactNode }) {
  return (
    <div className={cx("relative z-20 flex shrink-0 items-center gap-2.5 border-b border-line bg-bg", phone ? "safe-t h-[52px] px-3" : "h-12 px-5")}>
      {lead}
      <Glyph name={glyph} size={18} color="var(--accent)" />
      <b className="whitespace-nowrap text-[15px] font-[650]">{title}</b>
      {!phone && <span className="min-w-0 truncate text-muted">{sub}</span>}
      <span className="flex-1" />
      <div role="radiogroup" aria-label={t("Graph view")} className="flex gap-0.5 rounded-[9px] border border-line bg-surface p-[3px]">
        {MODES.map(([k, g, l]) => (
          <button key={k} role="radio" aria-checked={mode === k} title={t(l)} aria-label={t(l)} onClick={() => onMode(k)}
            className={cx("flex h-[26px] items-center gap-1.5 rounded-[7px] px-2.5", mode === k ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}>
            <Glyph name={g} size={14} />{!phone && <span>{t(l)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ "too big" banner (R6-32A / G)
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

/** Cheap backdrop while asking: every note as a dot (no layout, no edges), coloured by folder. */
export function HairDots({ notes, colorOf }: { notes: Note[]; colorOf: (n: Note) => string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const draw = () => {
      const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      const ctx = cv.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.globalAlpha = 0.7;
      const max = Math.min(notes.length, W < 700 ? 160 : 420);
      for (let i = 0; i < max; i++) {
        const n = notes[Math.floor((i * notes.length) / max)];
        const a = hash(n.id), b = hash(n.id + "y"), s = 2 + hash(n.id + "s") * 4;
        ctx.fillStyle = colorOf(n);
        ctx.beginPath(); ctx.arc(a * W, b * H, s / 2, 0, Math.PI * 2); ctx.fill();
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [notes, colorOf]);
  return <canvas ref={ref} className="absolute inset-0 size-full" aria-hidden />;
}

export function TooBigBanner({ count, groups, phone, onPick }: { count: number; groups: number; phone: boolean; onPick: (m: Exclude<BigMode, "local">, remember: boolean) => void }) {
  const [remember, setRemember] = useState(false);
  const opts: [Exclude<BigMode, "local">, GlyphName, string, string][] = [
    ["full", "graph", t("Full graph"), t("Every note, as before. Labels on zoom; may be slow")],
    ["grouped", "cluster", t("Grouped by folder"), t("{n} groups you can open one by one", { n: groups })],
    ["tree", "tree", t("Tree"), t("Folders → notes, branches fold")],
    ["filter", "filter", t("Filter first"), t("tag:, in:, status: to narrow")],
  ];
  return (
    <div role="dialog" aria-label={t("Too many notes to draw")} className="absolute left-1/2 z-20 flex -translate-x-1/2 flex-col gap-3 rounded-[14px] border border-accent bg-surface-2 p-4 shadow-[0_18px_44px_rgba(0,0,0,.45)]"
      style={{ top: phone ? 120 : 200, width: phone ? 392 : 654, maxWidth: "calc(100% - 20px)" }}>
      <div className="flex items-center gap-2.5"><Glyph name="c-info" size={18} color="var(--accent)" /><b className="flex-1 font-semibold">{t("{n} notes is too many to read as one picture", { n: count })}</b></div>
      <span className="leading-[19px] text-muted">{t("Pick a view that shows structure. You can still search for any note and jump straight to it.")}</span>
      <div className="grid gap-2" style={{ gridTemplateColumns: phone ? "1fr 1fr" : "repeat(4,1fr)" }}>
        {opts.map(([k, g, l, d]) => {
          const on = k === "grouped";
          return (
            <button key={k} onClick={() => onPick(k, remember)} className={cx("flex flex-col gap-1 rounded-[10px] p-2.5 text-start hover:border-accent", on ? "border-[1.5px] border-accent" : "border border-line")}
              style={{ background: on ? "color-mix(in srgb,var(--accent) 8%,var(--bg))" : "var(--bg)" }}>
              <span className="flex items-center gap-2 font-semibold"><Glyph name={g} size={15} color={on ? "var(--accent)" : "var(--muted)"} />{l}</span>
              <span className="text-[12px] leading-4 text-muted">{d}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2.5 text-[12px] text-muted">
        <button role="switch" aria-checked={remember} onClick={() => setRemember((r) => !r)} className="flex items-center gap-2.5 text-start">
          <span className={cx("relative h-4 w-7 shrink-0 rounded-full", remember ? "bg-accent" : "bg-line")}><span className={cx("absolute top-0.5 size-3 rounded-full", remember ? "left-[14px] bg-accent-fg" : "left-0.5 bg-muted")} /></span>
          {t("Remember my choice for this space")}
        </button>
        <span className="flex-1" />
        <span>{t("Nothing is hidden or deleted — this only changes how it's drawn.")}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ groups
export interface Group { id: string; name: string; color: string; notes: Note[]; kind: "space" | "folder" | "loose"; folder?: Folder; nested: boolean }
export type Drill = { kind: "space" | "folder"; id: string; name: string }[];

/** Top-level folder ids per space, child folders per folder (built once per vault). */
function folderKids(folders: Map<string, Folder>) {
  const kids = new Map<string, Folder[]>(), tops = new Map<string, Folder[]>();
  for (const f of folders.values()) {
    if (f.deleted) continue;
    if (f.parentId && folders.get(f.parentId)) (kids.get(f.parentId) ?? kids.set(f.parentId, []).get(f.parentId)!).push(f);
    else (tops.get(f.spaceId) ?? tops.set(f.spaceId, []).get(f.spaceId)!).push(f);
  }
  const by = (a: Folder, b: Folder) => a.sort - b.sort || a.name.localeCompare(b.name);
  kids.forEach((l) => l.sort(by)); tops.forEach((l) => l.sort(by));
  return { kids, tops };
}
/** Chain of folder ids from the note's folder up to the top (guarded against cycles). */
function chain(id: string | null, folders: Map<string, Folder>) {
  const out: string[] = [];
  for (let f = id ? folders.get(id) : undefined; f && out.length < 64 && !out.includes(f.id); f = f.parentId ? folders.get(f.parentId) : undefined) out.push(f.id);
  return out;
}

/** Groups at the current drill level: spaces (all-spaces scope), top folders of a space, or child folders of a folder. */
export function buildGroups(notes: Note[], v: VaultLike, drill: Drill, allScope: boolean): Group[] {
  const { kids, tops } = folderKids(v.folderMap);
  const last = drill[drill.length - 1];
  const spaces = new Set(notes.map((n) => n.spaceId));
  const groups = new Map<string, Group>();
  const pal = (i: number) => BIG_PAL[i % BIG_PAL.length];
  if (!last && allScope && spaces.size > 1) {
    [...spaces].forEach((s, i) => { const sp = v.spaceMap.get(s); groups.set(s, { id: s, name: sp?.name ?? s, color: sp?.color && !sp.color.startsWith("hsl") ? sp.color : pal(i), notes: [], kind: "space", nested: true }); });
    for (const n of notes) groups.get(n.spaceId)?.notes.push(n);
  } else {
    const level = last?.kind === "folder" ? kids.get(last.id) ?? [] : tops.get(last?.id ?? [...spaces][0]) ?? [];
    const scoped = last?.kind === "folder" ? notes.filter((n) => chain(n.folderId, v.folderMap).includes(last.id)) : last ? notes.filter((n) => n.spaceId === last.id) : notes;
    level.forEach((f, i) => groups.set(f.id, { id: f.id, name: f.name, color: f.color ?? pal(i), notes: [], kind: "folder", folder: f, nested: !!kids.get(f.id)?.length }));
    const ids = new Set(level.map((f) => f.id));
    const loose: Note[] = [];
    for (const n of scoped) { const g = chain(n.folderId, v.folderMap).find((x) => ids.has(x)); if (g) groups.get(g)!.notes.push(n); else loose.push(n); }
    if (loose.length) groups.set("@loose", { id: "@loose", name: last?.kind === "folder" ? last.name : t("Unfiled"), color: GREY, notes: loose, kind: "loose", nested: false });
  }
  return [...groups.values()].filter((g) => g.notes.length);
}

/** Links between groups (undirected, counted once per link). */
export function groupLinks(groups: Group[], outlinks: Map<string, string[]>) {
  const of = new Map<string, string>();
  for (const g of groups) for (const n of g.notes) of.set(n.id, g.id);
  const w = new Map<string, number>();
  for (const g of groups) for (const n of g.notes) for (const o of outlinks.get(n.id) ?? []) {
    const h = of.get(o);
    if (!h || h === g.id) continue;
    const k = g.id < h ? `${g.id}|${h}` : `${h}|${g.id}`;
    w.set(k, (w.get(k) ?? 0) + 1);
  }
  return [...w].map(([k, n]) => { const [a, b] = k.split("|"); return { a, b, n }; });
}

// ------------------------------------------------------------------ pan / zoom surface
type View = { x: number; y: number; k: number };
type Box = { x: number; y: number; w: number; h: number };
function bounds(boxes: Box[]) {
  if (!boxes.length) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  return { x0: Math.min(...boxes.map((b) => b.x)), y0: Math.min(...boxes.map((b) => b.y)), x1: Math.max(...boxes.map((b) => b.x + b.w)), y1: Math.max(...boxes.map((b) => b.y + b.h)) };
}

function usePanZoom(boxes: Box[], fitKey: string, opts: { k0?: number; maxK?: number; align?: "center" | "topleft" } = {}) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: opts.k0 ?? 1 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const fit = () => {
    const el = host.current;
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight, b = bounds(boxes);
    if (opts.align === "topleft") { setView({ x: 0, y: 0, k: opts.k0 ?? 1 }); return; }
    const k = Math.max(0.1, Math.min(opts.maxK ?? 1, (W - 60) / (b.x1 - b.x0 || 1), (H - 60) / (b.y1 - b.y0 || 1)));
    setView({ k, x: W / 2 - ((b.x0 + b.x1) / 2) * k, y: H / 2 - ((b.y0 + b.y1) / 2) * k });
  };
  useEffect(fit, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoomAt = (mx: number, my: number, f: number) => setView((v) => { const k = Math.min(3, Math.max(0.1, v.k * f)); return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k }; });
  const zoomBy = (f: number) => { const el = host.current; if (el) zoomAt(el.clientWidth / 2, el.clientHeight / 2, f); };
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => { if ((e.target as HTMLElement).closest("button,a,input")) return; drag.current = { x: e.clientX - view.x, y: e.clientY - view.y, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); },
    onPointerMove: (e: React.PointerEvent) => { const d = drag.current; if (!d) return; d.moved = true; setView((v) => ({ ...v, x: e.clientX - d.x, y: e.clientY - d.y })); },
    onPointerUp: () => { drag.current = null; },
    onWheel: (e: React.WheelEvent) => { const r = host.current!.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12); },
  };
  const center = (wx: number, wy: number) => { const el = host.current; if (el) setView((v) => ({ ...v, x: el.clientWidth / 2 - wx * v.k, y: el.clientHeight / 2 - wy * v.k })); };
  return { host, view, fit, zoomBy, handlers, center, dragged: () => !!drag.current?.moved };
}

/** Zoom out · % · zoom in · fit (bottom-left, design R6-32B/C/D). */
export function ZoomBar({ k, onIn, onOut, onFit }: { k: number; onIn: () => void; onOut: () => void; onFit: () => void }) {
  const b = "flex size-7 items-center justify-center rounded-[7px] hover:bg-surface-2";
  return (
    <div className="absolute bottom-4 left-4 z-10 flex items-center gap-0.5 rounded-[9px] border border-line bg-surface p-[3px]">
      <button aria-label={t("Zoom out")} title={t("Zoom out")} onClick={onOut} className={b}><Glyph name="zoom-out" size={14} /></button>
      <span className="w-10 text-center text-[12px] tabular-nums">{fmtNum(Math.round(k * 100))}%</span>
      <button aria-label={t("Zoom in")} title={t("Zoom in")} onClick={onIn} className={b}><Glyph name="zoom-in" size={14} /></button>
      <button aria-label={t("Fit")} title={t("Fit")} onClick={onFit} className={b}><Glyph name="fit" size={14} /></button>
    </div>
  );
}

/** 150×96 overview with the visible area outlined; click to jump there. */
function Minimap({ boxes, view, host, onJump }: { boxes: Box[]; view: View; host: HTMLDivElement | null; onJump: (x: number, y: number) => void }) {
  const b = bounds(boxes), W = 150, H = 96, pad = 10;
  const s = Math.min((W - pad * 2) / (b.x1 - b.x0 || 1), (H - pad * 2) / (b.y1 - b.y0 || 1));
  const X = (x: number) => pad + (x - b.x0) * s, Y = (y: number) => pad + (y - b.y0) * s;
  const vw = (host?.clientWidth ?? 0) / view.k, vh = (host?.clientHeight ?? 0) / view.k, vx = -view.x / view.k, vy = -view.y / view.k;
  return (
    <button aria-label={t("Minimap")} title={t("Minimap")} className="absolute bottom-4 right-4 z-10 overflow-hidden rounded-[9px] border border-line bg-surface" style={{ width: W, height: H }}
      onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onJump(b.x0 + (e.clientX - r.left - pad) / s, b.y0 + (e.clientY - r.top - pad) / s); }}>
      {boxes.slice(0, 400).map((x, i) => <span key={i} className="absolute rounded-[2px] bg-muted opacity-50" style={{ left: X(x.x), top: Y(x.y + x.h / 2) - 2, width: Math.max(3, x.w * s), height: 4 }} />)}
      <span className="absolute rounded-[4px] border-[1.5px] border-accent" style={{ left: Math.max(0, X(vx)), top: Math.max(0, Y(vy)), width: Math.min(W, vw * s), height: Math.min(H, vh * s) }} />
    </button>
  );
}

const dotsBg = { backgroundImage: "radial-gradient(color-mix(in srgb,var(--muted) 16%,transparent) 1px,transparent 1.2px)", backgroundSize: "22px 22px" };

// ------------------------------------------------------------------ Grouped (R6-32B / H)
type GNodeD = SimulationNodeDatum & { id: string; r: number };

export function GroupedGraph({ notes, v, allScope, drill, setDrill, phone, onOpenLeaf, onAsTree }: {
  notes: Note[]; v: VaultLike; allScope: boolean; drill: Drill; setDrill: (d: Drill) => void; phone: boolean;
  /** Open group on a folder without sub-folders: draw its notes. */
  onOpenLeaf: (g: Group) => void; onAsTree: (g: Group) => void;
}) {
  const groups = useMemo(() => buildGroups(notes, v, drill, allScope), [notes, v, drill, allScope]);
  const links = useMemo(() => groupLinks(groups, v.outlinks), [groups, v.outlinks]);
  const [sel, setSel] = useState<string | null>(null);
  const pos = useMemo(() => {
    const max = Math.max(1, ...groups.map((g) => g.notes.length));
    const nodes: GNodeD[] = groups.map((g, i) => ({ id: g.id, r: (50 + 130 * Math.sqrt(g.notes.length / max)) / 2, x: Math.cos(i * 2.4) * 200 * Math.sqrt(i + 1), y: Math.sin(i * 2.4) * 140 * Math.sqrt(i + 1) }));
    const lmax = Math.max(1, ...links.map((l) => l.n));
    const sim = forceSimulation(nodes)
      .force("link", forceLink<GNodeD, { source: string; target: string; n: number }>(links.map((l) => ({ source: l.a, target: l.b, n: l.n }))).id((d) => d.id).distance((l) => (l.source as unknown as GNodeD).r + (l.target as unknown as GNodeD).r + 90).strength((l) => 0.05 + 0.25 * (l.n / lmax)))
      .force("charge", forceManyBody<GNodeD>().strength(-700))
      .force("collide", forceCollide<GNodeD>((d) => d.r + 40))
      .force("x", forceX<GNodeD>(0).strength(0.06)).force("y", forceY<GNodeD>(0).strength(0.16))
      .force("center", forceCenter(0, 0)).stop();
    sim.tick(300);
    return new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0, r: n.r }]));
  }, [groups, links]);
  const boxes = groups.map((g) => { const p = pos.get(g.id)!; return { x: p.x - p.r, y: p.y - p.r, w: p.r * 2, h: p.r * 2 }; });
  const pz = usePanZoom(boxes, `${drill.map((d) => d.id).join("/")}:${groups.length}`, { maxK: phone ? 0.6 : 1 });
  useEffect(() => setSel(null), [drill]);
  const lmax = Math.max(1, ...links.map((l) => l.n));
  const g = sel ? groups.find((x) => x.id === sel) : null;
  const deg = (id: string) => (v.outlinks.get(id)?.length ?? 0) + (v.backlinks.get(id)?.length ?? 0);
  const summary = useMemo(() => {
    if (!g) return null;
    const top = [...g.notes].sort((a, b) => deg(b.id) - deg(a.id)).slice(0, 3).map((n) => n.title);
    const best = links.filter((l) => l.a === g.id || l.b === g.id).sort((a, b) => b.n - a.n)[0];
    const other = best ? groups.find((x) => x.id === (best.a === g.id ? best.b : best.a)) : null;
    return { top, best: best && other ? { n: best.n, name: other.name } : null };
  }, [g]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = g ? pos.get(g.id)! : null;
  const card = p && { left: Math.min((pz.host.current?.clientWidth ?? 800) - 236, Math.max(8, pz.view.x + (p.x + p.r * 0.55) * pz.view.k)), top: Math.max(8, pz.view.y + (p.y - p.r * 0.1) * pz.view.k) };
  const open = (x: Group) => {
    if (x.kind === "space") setDrill([...drill, { kind: "space", id: x.id, name: x.name }]);
    else if (x.kind === "folder" && x.nested) setDrill([...drill, { kind: "folder", id: x.id, name: x.name }]);
    else onOpenLeaf(x);
  };
  return (
    <div ref={pz.host} className="relative min-h-0 flex-1 cursor-grab overflow-hidden" style={dotsBg} {...pz.handlers} onClick={(e) => { if (e.target === e.currentTarget && !pz.dragged()) setSel(null); }}>
      {drill.length > 0 && (
        <div className="absolute left-4 top-3 z-10 flex items-center gap-1 text-[12px] text-muted">
          <button onClick={() => setDrill([])} className="hover:text-ink">{t("All groups")}</button>
          {drill.map((d, i) => <span key={d.id} className="flex items-center gap-1">›<button onClick={() => setDrill(drill.slice(0, i + 1))} className={cx("hover:text-ink", i === drill.length - 1 && "font-semibold text-ink")} dir="auto">{d.name}</button></span>)}
        </div>
      )}
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${pz.view.x}px,${pz.view.y}px) scale(${pz.view.k})` }}>
        {groups.map((x) => {
          const q = pos.get(x.id)!;
          return (
            <button key={x.id} onClick={() => setSel(x.id)} onDoubleClick={() => open(x)} title={x.name}
              className="absolute flex flex-col items-center justify-center gap-0.5 rounded-full text-center"
              style={{ left: q.x - q.r, top: q.y - q.r, width: q.r * 2, height: q.r * 2, background: `color-mix(in srgb,${x.color} 14%,transparent)`, border: `${sel === x.id ? 2.5 : 1.5}px solid ${x.color}` }}>
              <b dir="auto" className="max-w-[90%] truncate" style={{ fontSize: phone ? 11 / pz.view.k : 13 }}>{x.name}</b>
              <span className="text-muted" style={{ fontSize: phone ? 11 / pz.view.k : 11 }}>{t("{n} note|{n} notes", { n: x.notes.length })}</span>
            </button>
          );
        })}
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
          {links.map((l) => { const a = pos.get(l.a)!, b = pos.get(l.b)!; return <line key={l.a + l.b} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--muted)" strokeOpacity={0.35} strokeWidth={1 + 9 * (l.n / lmax)} strokeLinecap="round" />; })}
        </svg>
      </div>
      {g && summary && card && (
        <div className="absolute z-10 flex w-[220px] flex-col gap-1.5 rounded-[12px] border border-line bg-surface-2 p-3 shadow-[0_12px_30px_rgba(0,0,0,.35)] fade-in" style={card}>
          <b className="font-semibold" dir="auto">{g.name} · {t("{n} note|{n} notes", { n: g.notes.length })}</b>
          {summary.top.length > 0 && <span className="text-[12px] text-muted" dir="auto">{t("Top: {list}", { list: summary.top.join(", ") })}</span>}
          {summary.best && <span className="text-[12px] text-muted" dir="auto">{t("{n} links to {name}", { n: summary.best.n, name: summary.best.name })}</span>}
          <div className="flex gap-1.5">
            <button onClick={() => open(g)} className="flex h-7 items-center rounded-[7px] bg-accent px-2.5 font-semibold text-accent-fg">{t("Open group")}</button>
            <button onClick={() => onAsTree(g)} className="flex h-7 items-center rounded-[7px] border border-line px-2.5 hover:bg-surface">{t("As tree")}</button>
          </div>
        </div>
      )}
      <ZoomBar k={pz.view.k} onIn={() => pz.zoomBy(1.25)} onOut={() => pz.zoomBy(0.8)} onFit={pz.fit} />
      {!phone && <Minimap boxes={boxes} view={pz.view} host={pz.host.current} onJump={pz.center} />}
    </div>
  );
}

// ------------------------------------------------------------------ Tree (R6-32C / I)
interface TNode { id: string; label: string; color: string; count: number; kind: "root" | "space" | "folder" | "note" | "more"; depth: number; open: boolean; parent?: string; noteId?: string; kids: boolean }
/** Notes shown per folder before "+ N more" (more on click). */
export const TREE_NOTES = 8;
let measureCtx: CanvasRenderingContext2D | null = null;
const textW = (s: string, weight: number, px = 12.5) => { measureCtx ??= document.createElement("canvas").getContext("2d"); if (!measureCtx) return s.length * px * 0.56; measureCtx.font = `${weight} ${px}px Inter, system-ui, sans-serif`; return measureCtx.measureText(s).width; };

export function TreeGraph({ notes, v, allScope, rootName, phone, expand, setExpand, pageSize }: {
  notes: Note[]; v: VaultLike; allScope: boolean; rootName: string; phone: boolean;
  expand: Set<string>; setExpand: (f: (s: Set<string>) => Set<string>) => void; pageSize: number;
}) {
  const [extra, setExtra] = useState<Record<string, number>>({});
  const idx = useMemo(() => {
    const { kids, tops } = folderKids(v.folderMap);
    const direct = new Map<string, Note[]>(), loose = new Map<string, Note[]>(), total = new Map<string, number>();
    const spaces = new Map<string, number>();
    for (const n of notes) {
      spaces.set(n.spaceId, (spaces.get(n.spaceId) ?? 0) + 1);
      const ch = chain(n.folderId, v.folderMap);
      if (ch.length) (direct.get(ch[0]) ?? direct.set(ch[0], []).get(ch[0])!).push(n); else (loose.get(n.spaceId) ?? loose.set(n.spaceId, []).get(n.spaceId)!).push(n);
      for (const f of ch) total.set(f, (total.get(f) ?? 0) + 1);
    }
    const deg = (id: string) => (v.outlinks.get(id)?.length ?? 0) + (v.backlinks.get(id)?.length ?? 0);
    direct.forEach((l) => l.sort((a, b) => deg(b.id) - deg(a.id)));
    loose.forEach((l) => l.sort((a, b) => deg(b.id) - deg(a.id)));
    return { kids, tops, direct, loose, total, spaces };
  }, [notes, v]);
  const multi = allScope && idx.spaces.size > 1;
  const colorOf = useMemo(() => { const m = new Map<string, string>(); const sp = [...idx.spaces.keys()]; for (const s of sp) (idx.tops.get(s) ?? []).forEach((f, i) => m.set(f.id, f.color ?? BIG_PAL[i % BIG_PAL.length])); return m; }, [idx]);
  // Visible rows, depth-first.
  const rows = useMemo(() => {
    const out: TNode[] = [];
    const add = (n: TNode) => { out.push(n); return n.open; };
    const noteRows = (key: string, list: Note[], depth: number, color: string) => {
      const cap = TREE_NOTES + (extra[key] ?? 0);
      for (const n of list.slice(0, cap)) out.push({ id: `n:${n.id}`, label: n.title, color, count: 0, kind: "note", depth, open: false, parent: key, noteId: n.id, kids: false });
      if (list.length > cap) out.push({ id: `more:${key}`, label: t("+ {n} more", { n: list.length - cap }), color: "var(--muted)", count: 0, kind: "more", depth, open: false, parent: key, kids: false });
    };
    const folder = (f: Folder, depth: number, color: string, parent: string) => {
      const c = idx.total.get(f.id) ?? 0;
      if (!c) return;
      const kids = idx.kids.get(f.id) ?? [];
      if (!add({ id: f.id, label: f.name, color, count: c, kind: "folder", depth, open: expand.has(f.id), parent, kids: true })) return;
      for (const k of kids) folder(k, depth + 1, color, f.id);
      noteRows(f.id, idx.direct.get(f.id) ?? [], depth + 1, color);
    };
    const space = (s: string, depth: number, isRoot: boolean) => {
      const name = isRoot ? rootName : v.spaceMap.get(s)?.name ?? s;
      const id = isRoot ? "@root" : `s:${s}`;
      if (!add({ id, label: name, color: "var(--accent)", count: idx.spaces.get(s) ?? 0, kind: isRoot ? "root" : "space", depth, open: isRoot || expand.has(id), parent: isRoot ? undefined : "@root", kids: true })) return;
      for (const f of idx.tops.get(s) ?? []) folder(f, depth + 1, colorOf.get(f.id) ?? GREY, id);
      noteRows(id, idx.loose.get(s) ?? [], depth + 1, GREY);
    };
    if (multi) {
      add({ id: "@root", label: rootName, color: "var(--accent)", count: notes.length, kind: "root", depth: 0, open: true, kids: true });
      for (const s of idx.spaces.keys()) space(s, 1, false);
    } else space([...idx.spaces.keys()][0] ?? "", 0, true);
    return out;
  }, [idx, expand, extra, multi, rootName, notes.length, colorOf, v.spaceMap]);
  // Layout: leaves take consecutive rows; a parent sits at the middle of its visible children.
  const ROW = phone ? 48 : 52, CW = phone ? 0 : 240;
  const lay = useMemo(() => {
    const pos = new Map<string, Box>();
    const children = new Map<string, TNode[]>();
    for (const r of rows) if (r.parent) (children.get(r.parent) ?? children.set(r.parent, []).get(r.parent)!).push(r);
    let row = 0;
    const widthOf = (n: TNode) => Math.ceil(6 + (n.kids ? 22 : 0) + 13 + textW(n.label, n.kind === "root" || n.open ? 600 : 450) + (n.count ? 6 + textW(fmtNum(n.count), 400, 11) + 12 : 0) + 10 + 2);
    // Column x: at least CW apart, and never closer than the widest box of the column before + 40.
    const maxW: number[] = [];
    for (const r of rows) maxW[r.depth] = Math.max(maxW[r.depth] ?? 0, widthOf(r));
    const colX: number[] = [16];
    for (let d = 1; d <= maxW.length; d++) colX[d] = colX[d - 1] + Math.max(CW, (maxW[d - 1] ?? 0) + 40);
    const place = (n: TNode): number => {
      const kids = n.open ? children.get(n.id) ?? [] : [];
      const w = widthOf(n);
      let y: number;
      if (!kids.length) y = row++ * ROW;
      else { const ys = kids.map(place); y = n.kind === "root" ? Math.min(...ys) - ROW * 0.8 : (ys[0] + ys[ys.length - 1]) / 2; }
      pos.set(n.id, { x: colX[n.depth], y: y + 10, w, h: 30 });
      return y;
    };
    const root = rows[0];
    if (root) { row = root.open && (children.get(root.id)?.length ?? 0) ? 1 : 0; place(root); }
    return pos;
  }, [rows, ROW, CW]);
  const boxes = [...lay.values()];
  const pz = usePanZoom(boxes, rootName, { align: "topleft" });
  const toggle = (n: TNode) => setExpand((s) => { const x = new Set(s); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; });
  const edges = rows.filter((r) => r.parent && lay.has(r.parent) && lay.has(r.id)).map((r) => {
    const a = lay.get(r.parent!)!, b = lay.get(r.id)!;
    const x1 = a.x + a.w, y1 = a.y + 15, x2 = b.x, y2 = b.y + 15, mx = (x1 + x2) / 2;
    return <path key={r.id} d={`M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} fill="none" stroke="var(--muted)" strokeWidth={1.5} opacity={0.5} />;
  });
  return (
    <div ref={pz.host} className="relative min-h-0 flex-1 cursor-grab overflow-hidden" style={dotsBg} {...pz.handlers}>
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${pz.view.x}px,${pz.view.y}px) scale(${pz.view.k})` }}>
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>{edges}</svg>
        {rows.map((r) => {
          const b = lay.get(r.id);
          if (!b) return null;
          const bold = r.kind === "root" || (r.open && r.kind !== "note");
          const click = () => (r.kind === "note" ? openNote(r.noteId!) : r.kind === "more" ? setExtra((e) => ({ ...e, [r.parent!]: (e[r.parent!] ?? 0) + pageSize })) : r.kind !== "root" && toggle(r));
          return (
            <button key={r.id} onClick={click} title={r.label} data-tree={r.id}
              className={cx("absolute flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-[8px] pl-1.5 pr-2.5 text-[12.5px] hover:border-accent", bold ? "bg-surface-2 font-semibold" : "bg-surface", r.kind === "more" ? "border border-transparent" : "border border-line")}
              style={{ left: b.x, top: b.y, width: b.w }}>
              {r.kids && <span className="flex size-4 items-center justify-center rounded-[4px] bg-surface-2 text-[10px] text-muted">{r.open ? "−" : "+"}</span>}
              <span className="size-[7px] shrink-0 rounded-full" style={{ background: r.color }} />
              <span dir="auto" className="min-w-0 truncate">{r.label}</span>
              {r.count > 0 && <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-normal leading-[18px] text-muted">{fmtNum(r.count)}</span>}
            </button>
          );
        })}
      </div>
      <ZoomBar k={pz.view.k} onIn={() => pz.zoomBy(1.25)} onOut={() => pz.zoomBy(0.8)} onFit={pz.fit} />
      {!phone && <Minimap boxes={boxes} view={pz.view} host={pz.host.current} onJump={pz.center} />}
    </div>
  );
}

/** Ids to expand so `g` is open in the tree ("As tree" on a group). */
export function expandFor(g: Group, folders: Map<string, Folder>, allScope: boolean): string[] {
  if (g.kind === "space") return [`s:${g.id}`];
  if (g.kind === "folder") { const ch = chain(g.id, folders); const sp = g.folder?.spaceId; return [...ch, ...(allScope && sp ? [`s:${sp}`] : [])]; }
  return [];
}

/** Filter-first prompt (Filter mode with an empty query). */
export function FilterFirst({ q, setQ, count, phone }: { q: string; setQ: (q: string) => void; count: number; phone: boolean }) {
  return (
    <div className={cx("absolute left-1/2 z-20 flex -translate-x-1/2 flex-col gap-2.5 rounded-[14px] border border-line bg-surface-2 p-4 shadow-[0_18px_44px_rgba(0,0,0,.45)]", q ? "top-3" : phone ? "top-[120px]" : "top-[200px]")} style={{ width: phone ? 360 : 520, maxWidth: "calc(100% - 24px)" }}>
      {!q && <b className="flex items-center gap-2 font-semibold"><Glyph name="filter" size={16} color="var(--accent)" />{t("Filter first")}</b>}
      <label className="flex h-9 items-center gap-2 rounded-[8px] border border-accent bg-bg px-2.5">
        <Glyph name="search" size={13} color="var(--muted)" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("tag:#nlp in:\"03 Deep learning\" status:learning")} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" />
        {q && <span className="text-[11.5px] text-muted">{t("{n} note|{n} notes", { n: count })}</span>}
      </label>
      {!q && <span className="text-[12px] leading-[18px] text-muted">{t("Type tag:, in: (folder), status: or a word. Only matching notes are drawn.")}</span>}
    </div>
  );
}
