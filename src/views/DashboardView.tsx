// Dashboards: a 12-column grid of chart tiles defined as YAML in the note body (lib/dashboard.ts, docs/DASHBOARDS.md).
// Drag a tile's grip to move it, its corner to resize it (keyboard: arrows move, Shift+arrows resize); every change
// rewrites only the ```dashboard block. Phones stack the tiles in one column.
import { useLiveQuery } from "dexie-react-hooks";
import {
  ChartArea, ChartColumn, ChartColumnStacked, ChartLine, ChartPie, CircleGauge, Copy, FileCode2, Grid3x3, GripVertical, Hash, List, MoreHorizontal, Pencil, Plus, Table2, Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Note } from "../../shared/types";
import { updateNote } from "../lib/actions";
import { parseBase, propsOf } from "../lib/base";
import {
  addTile, duplicateTile, fieldsOf, gridRows, parseDashboard, placeTile, removeTile, runTile, sourceKind, sourceArg, sourceRecords, stackOrder, tileDefaults, writeDashboard,
  COLS, TILE_TYPES, type Aggregate, type Bucket, type DashboardConfig, type DashData, type Tile, type TileLayout, type TileType,
} from "../lib/dashboard";
import { db } from "../lib/db";
import { noteDerived, openNote, setUI, useVault } from "../lib/store";
import { TileChart } from "../components/charts";
import { Button, cx, inputCls, Sheet } from "../components/ui";

const ROW = 76, GAP = 12;
const propsFor = (n: Note) => noteDerived("baseProps", n, propsOf);
const useWidth = () => { const [w, setW] = useState(() => innerWidth); useEffect(() => { const f = () => setW(innerWidth); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return w; };
export const TILE_ICON: Record<TileType, ReactNode> = {
  number: <Hash size={15} />, bar: <ChartColumn size={15} />, stackedBar: <ChartColumnStacked size={15} />, line: <ChartLine size={15} />, area: <ChartArea size={15} />,
  donut: <ChartPie size={15} />, heatmap: <Grid3x3 size={15} />, ring: <CircleGauge size={15} />, table: <Table2 size={15} />, list: <List size={15} />,
};
export const TILE_LABEL: Record<TileType, string> = { number: "Number", bar: "Bar", stackedBar: "Stacked bar", line: "Line", area: "Area", donut: "Donut", heatmap: "Heatmap", ring: "Progress ring", table: "Table", list: "List" };

function useDashData(): DashData {
  const v = useVault();
  const cards = useLiveQuery(() => db.cards.toArray(), []) ?? [];
  const sessions = useLiveQuery(() => db.sessions.toArray(), []) ?? [];
  const now = useMemo(() => Date.now(), [v, cards, sessions]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => ({
    notes: v.notes, cards, sessions, now, propsFor,
    spaces: v.spaces.map((s) => ({ id: s.id, name: s.name, icon: s.icon, color: s.color, roadmapId: s.roadmapId })),
    ctx: {
      spaceName: (id: string) => v.spaceMap.get(id)?.name ?? (id === "inbox" ? "Inbox" : id),
      folderPath: (id: string | null) => {
        const names: string[] = []; const seen = new Set<string>();
        for (let f = id ? v.folderMap.get(id) : undefined; f && !seen.has(f.id); f = f.parentId ? v.folderMap.get(f.parentId) : undefined) { seen.add(f.id); names.unshift(f.name); }
        return names.join("/");
      },
    },
  }), [v, cards, sessions, now]);
}

interface Drag { id: string; mode: "move" | "resize"; from: TileLayout; to: TileLayout }

export function DashboardView({ note }: { note: Note }) {
  const { cfg, error, found } = useMemo(() => parseDashboard(note.body), [note.body]);
  const data = useDashData();
  const vw = useWidth();
  const phone = vw < 640;
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [editing, setEditing] = useState<Tile | "new" | null>(null);
  const [tables, setTables] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null);

  const write = (next: DashboardConfig) => void updateNote(note.id, { body: writeDashboard(note.body, next) });
  const tiles = drag ? placeTile(cfg.tiles, drag.id, drag.to) : cfg.tiles;
  const results = useMemo(() => new Map(cfg.tiles.map((t) => [t.id, runTile(t, data)])), [cfg.tiles, data]);

  const colW = () => ((gridRef.current?.clientWidth ?? 960) - GAP * (COLS - 1)) / COLS;
  const startDrag = (e: React.PointerEvent, t: Tile, mode: Drag["mode"]) => {
    if (phone || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, cw = colW() + GAP, rh = ROW + GAP;
    const rtl = getComputedStyle(gridRef.current!).direction === "rtl";
    let cur: TileLayout = t.layout;
    const move = (ev: PointerEvent) => {
      const dx = Math.round(((rtl ? -1 : 1) * (ev.clientX - sx)) / cw), dy = Math.round((ev.clientY - sy) / rh);
      cur = mode === "move" ? { ...t.layout, x: Math.max(0, Math.min(COLS - t.layout.w, t.layout.x + dx)), y: Math.max(0, t.layout.y + dy) }
        : { ...t.layout, w: Math.max(2, Math.min(COLS - t.layout.x, t.layout.w + dx)), h: Math.max(2, Math.min(12, t.layout.h + dy)) };
      setDrag({ id: t.id, mode, from: t.layout, to: cur });
    };
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
      setDrag(null);
      if (cur.x !== t.layout.x || cur.y !== t.layout.y || cur.w !== t.layout.w || cur.h !== t.layout.h) write({ ...cfg, tiles: placeTile(cfg.tiles, t.id, cur) });
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
    setDrag({ id: t.id, mode, from: t.layout, to: t.layout });
  };
  const keyMove = (e: React.KeyboardEvent, t: Tile) => {
    const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
    if (!d) return;
    e.preventDefault();
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const dx = rtl ? -d[0] : d[0];
    const l = t.layout;
    const to = e.shiftKey ? { ...l, w: Math.max(2, l.w + dx), h: Math.max(2, l.h + d[1]) } : { ...l, x: Math.max(0, l.x + dx), y: Math.max(0, l.y + d[1]) };
    write({ ...cfg, tiles: placeTile(cfg.tiles, t.id, to) });
  };

  const openRow = (t: Tile, id: string) => {
    const k = sourceKind(t.source);
    const nid = k === "cards" ? id.split(":")[0] : k === "notes" || k === "base" ? id : null;
    if (nid && data.notes.some((n) => n.id === nid)) openNote(nid);
  };

  const ordered = phone ? stackOrder(tiles) : tiles;
  const rows = Math.max(gridRows(tiles), 1);
  const preview = drag && tiles.find((t) => t.id === drag.id)!.layout;

  return (
    <div className="dash flex h-full min-h-0 flex-col">
      <div className={cx("flex shrink-0 items-center gap-2 border-b border-line py-2", phone ? "px-3" : "px-6")}>
        <span dir="auto" className="min-w-0 flex-1 truncate text-[15px] font-semibold">{note.title}</span>
        <span className="text-[12px] tabular-nums text-muted">{cfg.tiles.length} tile{cfg.tiles.length === 1 ? "" : "s"}</span>
        <Button size="sm" variant="ghost" onClick={() => setUI({ mode: "edit" })} title="Edit the dashboard YAML"><FileCode2 size={13} />{!phone && "YAML"}</Button>
        <Button size="sm" variant="primary" onClick={() => setEditing("new")}><Plus size={13} />Add tile</Button>
      </div>
      {error && <div className="shrink-0 border-b border-line px-6 py-1.5 text-[12px] text-bad" dir="auto">Couldn't read the dashboard definition: {error}</div>}
      <div className={cx("min-h-0 flex-1 overflow-y-auto", phone ? "px-3 py-3" : "px-6 py-4")} onClick={() => setMenu(null)}>
        {!cfg.tiles.length ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="text-[14px] font-semibold">{found ? "No tiles yet" : "This dashboard is empty"}</div>
            <div className="max-w-[360px] text-[13px] text-muted">Add a tile to chart your cards, study sessions, a learning path or any set of notes.</div>
            <Button variant="primary" onClick={() => setEditing("new")}><Plus size={14} />Add tile</Button>
          </div>
        ) : (
          <div ref={gridRef} className={cx("dash-grid", phone ? "dash-stack" : "", drag && "is-dragging")}
            style={phone ? undefined : { gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, ${ROW}px)`, gap: GAP }}>
            {preview && !phone && <div className="dash-ghost" style={{ gridColumn: `${preview.x + 1} / span ${preview.w}`, gridRow: `${preview.y + 1} / span ${preview.h}` }} />}
            {ordered.map((t) => {
              const r = results.get(t.id) ?? runTile(t, data);
              const showTable = tables.has(t.id);
              const chartless = t.type === "table" || t.type === "list" || t.type === "number";
              return (
                <section key={t.id} className={cx("dash-tile", drag?.id === t.id && "is-drag")} aria-label={t.title || TILE_LABEL[t.type]}
                  style={phone ? { height: t.type === "number" ? 132 : t.type === "list" || t.type === "table" ? 300 : Math.max(3, Math.min(5, t.layout.h)) * 66 } : { gridColumn: `${t.layout.x + 1} / span ${t.layout.w}`, gridRow: `${t.layout.y + 1} / span ${t.layout.h}` }}>
                  <header className="flex items-center gap-1">
                    {!phone && (
                      <button className="dash-grip" aria-label={`Move ${t.title || "tile"} (arrows move, Shift+arrows resize)`} title="Drag to move" onPointerDown={(e) => startDrag(e, t, "move")} onKeyDown={(e) => keyMove(e, t)}>
                        <GripVertical size={14} />
                      </button>
                    )}
                    <h3 dir="auto" className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-muted">{t.title || TILE_LABEL[t.type]}</h3>
                    {!chartless && (
                      <button className={cx("dash-icon", showTable && "is-on")} aria-pressed={showTable} aria-label="Show as data table" title="Data table"
                        onClick={() => setTables((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}><Table2 size={14} /></button>
                    )}
                    <div className="relative">
                      <button className="dash-icon" aria-label="Tile menu" aria-haspopup="menu" aria-expanded={menu === t.id} onClick={(e) => { e.stopPropagation(); setMenu(menu === t.id ? null : t.id); }}><MoreHorizontal size={15} /></button>
                      {menu === t.id && (
                        <div role="menu" className="dash-menu" onClick={(e) => e.stopPropagation()}>
                          <button role="menuitem" onClick={() => { setMenu(null); setEditing(t); }}><Pencil size={14} />Edit</button>
                          <button role="menuitem" onClick={() => { setMenu(null); write(duplicateTile(cfg, t.id)); }}><Copy size={14} />Duplicate</button>
                          <button role="menuitem" className="text-bad" onClick={() => { setMenu(null); write(removeTile(cfg, t.id)); }}><Trash2 size={14} />Delete</button>
                        </div>
                      )}
                    </div>
                  </header>
                  <div className="dash-body"><TileChart tile={t} result={r} spaces={data.spaces} table={showTable} onRow={(id) => openRow(t, id)} /></div>
                  {!phone && <span className="dash-resize" aria-hidden title="Drag to resize" onPointerDown={(e) => startDrag(e, t, "resize")} />}
                </section>
              );
            })}
          </div>
        )}
      </div>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add tile" : "Edit tile"} wide>
        {editing && <TileEditor key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? null : editing} data={data}
          onCancel={() => setEditing(null)}
          onSave={(t) => { setEditing(null); if (editing === "new") { const { id: _i, layout: _l, ...rest } = t; void _i; void _l; write(addTile(cfg, rest)); } else write({ ...cfg, tiles: cfg.tiles.map((x) => (x.id === editing.id ? { ...t, id: x.id, layout: x.layout } : x)) }); }} />}
      </Sheet>
    </div>
  );
}

// ------------------------------------------------------------------ add / edit tile: source → chart type → fields, live preview
const RANGES = [["", "All time"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["12w", "Last 12 weeks"], ["20w", "Last 20 weeks"], ["6m", "Last 6 months"], ["1y", "Last year"], ["next 7d", "Next 7 days"], ["next 14d", "Next 14 days"], ["next 30d", "Next 30 days"]];
const filterText = (f: Tile["filter"]) => (typeof f === "string" ? f : f ? JSON.stringify(f) : "");
const parseFilterText = (s: string): Tile["filter"] => { const t = s.trim(); if (!t) return undefined; if (t.startsWith("{")) { try { return JSON.parse(t); } catch { return t; } } return t; };

function TileEditor({ initial, data, onSave, onCancel }: { initial: Tile | null; data: DashData; onSave: (t: Tile) => void; onCancel: () => void }) {
  const [step, setStep] = useState(initial ? 2 : 0);
  const [t, setT] = useState<Tile>(() => initial ? structuredClone(initial) : { id: "new", type: "bar", source: "sessions", x: "at", bucket: "week", y: "minutes", aggregate: "sum", series: "course", range: "12w", layout: { x: 0, y: 0, w: 6, h: 4 } });
  const set = (p: Partial<Tile>) => setT((o) => ({ ...o, ...p }));
  const kind = sourceKind(t.source);
  const paths = data.notes.filter((n) => n.type === "path");
  const bases = data.notes.filter((n) => n.type === "base");
  const baseNote = kind === "base" ? bases.find((n) => n.title.toLowerCase() === sourceArg(t.source).toLowerCase()) : undefined;
  const baseViews = baseNote ? parseBase(baseNote.body).cfg.views.map((v) => v.name) : [];
  const recs = useMemo(() => sourceRecords(t, data).recs, [t.source, t.view, t.filter, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const fields = fieldsOf(t.source, recs);
  const dateFields = fields.filter((f) => f.kind === "date");
  const numFields = fields.filter((f) => f.kind === "number");
  const catFields = fields.filter((f) => f.kind === "category" || f.kind === "bool" || f.kind === "text");
  const eff = { ...t, ...tileDefaults(t) };
  const xIsDate = dateFields.some((f) => f.name === eff.x);
  const result = useMemo(() => runTile(t, data), [t, data]);
  const pickSource = (source: string, extra: Partial<Tile> = {}) => {
    const k = sourceKind(source);
    const def: Partial<Tile> = k === "sessions" ? { x: "at", y: "minutes", aggregate: "sum", series: undefined, bucket: "week", range: "12w" }
      : k === "cards" ? { x: "dueOn", y: undefined, aggregate: "count", series: undefined, bucket: "day", range: "next 14d" }
      : k === "path" ? { x: "status", y: undefined, aggregate: "count", series: undefined, bucket: undefined, range: undefined }
      : { x: "status", y: undefined, aggregate: "count", series: undefined, bucket: undefined, range: undefined };
    set({ source, view: undefined, filter: undefined, ...def, ...extra });
  };
  const srcBtn = (active: boolean) => cx("flex items-start gap-2 rounded-[10px] border p-3 text-start text-[13px]", active ? "border-accent" : "border-line hover:border-accent/60");
  const sel = cx(inputCls, "text-[13px]");
  const field = (lbl: string, el: ReactNode) => <label className="block min-w-0 space-y-1"><span className="text-[12px] font-medium text-muted">{lbl}</span>{el}</label>;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 text-[12.5px]" role="tablist">
        {["Source", "Chart", "Fields"].map((s, i) => (
          <button key={s} role="tab" aria-selected={step === i} onClick={() => setStep(i)} className={cx("h-8 rounded-[8px] px-3", step === i ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}>{i + 1}. {s}</button>
        ))}
      </div>

      {step === 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          <button className={srcBtn(kind === "sessions")} onClick={() => pickSource("sessions")}><span><b className="block">Study sessions</b><span className="text-[12px] text-muted">Minutes per day, week, course</span></span></button>
          <button className={srcBtn(kind === "cards")} onClick={() => pickSource("cards")}><span><b className="block">Flashcards</b><span className="text-[12px] text-muted">Due per day, by state</span></span></button>
          <div className={srcBtn(kind === "path")}>
            <span className="min-w-0 flex-1 space-y-1.5"><b className="block">Learning path</b><span className="block text-[12px] text-muted">Concept statuses, learned over time</span>
              <select aria-label="Learning path" className={sel} value={kind === "path" ? sourceArg(t.source) : ""} onChange={(e) => pickSource(e.target.value ? `path:${e.target.value}` : "path")}>
                <option value="">{paths.length ? "Most recent path" : "No paths yet"}</option>
                {paths.map((n) => <option key={n.id} value={n.title}>{n.title}</option>)}
              </select>
            </span>
          </div>
          <div className={srcBtn(kind === "base")}>
            <span className="min-w-0 flex-1 space-y-1.5"><b className="block">Base view</b><span className="block text-[12px] text-muted">The notes a base view shows</span>
              <select aria-label="Base" className={sel} value={kind === "base" ? sourceArg(t.source) : ""} onChange={(e) => e.target.value && pickSource(`base:${e.target.value}`)}>
                <option value="">{bases.length ? "Choose a base" : "No bases yet"}</option>
                {bases.map((n) => <option key={n.id} value={n.title}>{n.title}</option>)}
              </select>
              {kind === "base" && baseViews.length > 0 && (
                <select aria-label="View" className={sel} value={t.view ?? baseViews[0]} onChange={(e) => set({ view: e.target.value })}>
                  {baseViews.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              )}
            </span>
          </div>
          <button className={srcBtn(kind === "notes")} onClick={() => pickSource("notes")}><span><b className="block">Notes</b><span className="text-[12px] text-muted">Any notes, narrowed by a Bases filter</span></span></button>
          <div className="flex items-end justify-end md:col-span-2"><Button size="sm" variant="primary" onClick={() => setStep(1)}>Next</Button></div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {TILE_TYPES.map((ty) => (
              <button key={ty} aria-pressed={t.type === ty} onClick={() => set({ type: ty, ...(ty === "heatmap" ? { x: dateFields[0]?.name, bucket: "day" as Bucket, range: "20w", series: undefined } : {}) })}
                className={cx("flex flex-col items-center gap-1 rounded-[10px] border p-2.5 text-[12px]", t.type === ty ? "border-accent text-ink" : "border-line text-muted hover:text-ink")}>
                {TILE_ICON[ty]}{TILE_LABEL[ty]}
              </button>
            ))}
          </div>
          <div className="flex justify-end"><Button size="sm" variant="primary" onClick={() => setStep(2)}>Next</Button></div>
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-3 md:grid-cols-2">
          {field("Title", <input className={sel} dir="auto" value={t.title ?? ""} placeholder={TILE_LABEL[t.type]} onChange={(e) => set({ title: e.target.value || undefined })} />)}
          {t.type !== "number" && t.type !== "ring" && field(t.type === "donut" ? "Slices" : t.type === "table" || t.type === "list" ? "Group by (empty = list records)" : "X axis",
            <select className={sel} value={eff.x ?? ""} onChange={(e) => set({ x: e.target.value || undefined })}>
              {(t.type === "table" || t.type === "list") && <option value="">None</option>}
              {(t.type === "heatmap" ? dateFields : [...dateFields, ...catFields]).map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}
            </select>)}
          {xIsDate && t.type !== "heatmap" && t.type !== "number" && t.type !== "ring" && field("Bucket",
            <select className={sel} value={t.bucket ?? ""} onChange={(e) => set({ bucket: (e.target.value || undefined) as Bucket | undefined })}>
              <option value="">Automatic</option><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
            </select>)}
          {field("Value",
            <div className="flex gap-1.5">
              <select aria-label="Aggregate" className={sel} value={t.aggregate ?? (t.y ? "sum" : "count")} onChange={(e) => set({ aggregate: e.target.value as Aggregate, y: e.target.value === "count" ? undefined : t.y ?? numFields[0]?.name })}>
                <option value="count">Count</option><option value="sum">Sum of</option><option value="avg">Average of</option><option value="min">Min of</option><option value="max">Max of</option>
              </select>
              {(t.aggregate ?? (t.y ? "sum" : "count")) !== "count" && (
                <select aria-label="Value field" className={sel} value={t.y ?? ""} onChange={(e) => set({ y: e.target.value || undefined })}>
                  {numFields.map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}
                </select>
              )}
            </div>)}
          {["bar", "stackedBar", "line", "area"].includes(t.type) && field("Series (color by)",
            <select className={sel} value={t.series ?? ""} onChange={(e) => set({ series: e.target.value || undefined })}>
              <option value="">None</option>
              {catFields.filter((f) => f.name !== eff.x).map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}
            </select>)}
          {field("Range",
            <select className={sel} value={eff.range ?? ""} onChange={(e) => set({ range: e.target.value || undefined })}>
              {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              {eff.range && !RANGES.some(([v]) => v === eff.range) && <option value={eff.range}>{eff.range}</option>}
            </select>)}
          {field(kind === "notes" ? "Filter (Bases expression, e.g. type == \"lesson\")" : "Filter (e.g. status == \"learning\")",
            <input className={cx(sel, "font-mono text-[12px]")} dir="auto" defaultValue={filterText(t.filter)} placeholder={kind === "path" ? "mastered == true" : kind === "cards" ? 'state == "review"' : 'course == "CS231n"'} onBlur={(e) => set({ filter: parseFilterText(e.target.value) })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />)}
          {t.type === "ring" && field("Part (filter for the filled share)",
            <input className={cx(sel, "font-mono text-[12px]")} defaultValue={filterText(t.part)} placeholder="learned == true" onBlur={(e) => set({ part: parseFilterText(e.target.value) })} />)}
          {(t.type === "line" || t.type === "area") && xIsDate && (
            <label className="flex items-center gap-2 self-end text-[13px]"><input type="checkbox" className="accent-[var(--accent)]" checked={!!t.cumulative} onChange={(e) => set({ cumulative: e.target.checked || undefined })} />Running total</label>
          )}
          {(t.type === "table" || t.type === "list") && !eff.x && field("Fields (comma separated)",
            <input className={sel} defaultValue={(t.fields ?? []).join(", ")} placeholder={fields.slice(0, 3).map((f) => f.name).join(", ")} onBlur={(e) => set({ fields: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />)}
        </div>
      )}

      <div className="rounded-[12px] border border-line bg-bg p-3">
        <div className="mb-2 flex items-center gap-2 text-[12px] text-muted"><span className="font-semibold text-ink">{t.title || TILE_LABEL[t.type]}</span><span className="flex-1" />Preview · {result.records} record{result.records === 1 ? "" : "s"}</div>
        <div className="dash-preview" style={{ height: t.type === "number" ? 90 : 220 }}><TileChart tile={t} result={result} spaces={data.spaces} /></div>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={() => onSave({ ...t, bucket: xIsDate ? t.bucket : undefined, series: ["bar", "stackedBar", "line", "area"].includes(t.type) ? t.series : undefined, cumulative: t.type === "line" || t.type === "area" ? t.cumulative : undefined })}>{initial ? "Save tile" : "Add tile"}</Button>
      </div>
    </div>
  );
}
