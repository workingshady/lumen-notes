// Dashboards: a 12-column grid of chart tiles defined as YAML in the note body (lib/dashboard.ts, docs/DASHBOARDS.md).
// Layout follows design/handoffs/2026-11-19-round-4/DashDesk.dc.html (R4-18K..Q): a top bar with the dashboard-wide
// range, YAML and Add tile; "Edit layout" shows the 12 columns: drag a tile to move it, its corner to resize it
// (keyboard: arrows move the selected tile, Shift+arrows resize). Every change rewrites only the ```dashboard block.
// Phones show two columns; wide tiles span both.
import { useLiveQuery } from "dexie-react-hooks";
import { ReaderBack } from "../components/reader-bar";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Note } from "../../shared/types";
import { updateNote } from "../lib/actions";
import { parseBase, propsOf } from "../lib/base";
import {
  addTile, duplicateTile, fieldsOf, gridRows, parseDashboard, placeTile, removeTile, runTile, sourceKind, sourceArg, sourceRecords, stackOrder, tileDefaults, withDashRange, writeDashboard, parseRange,
  COLS, DASH_RANGES, rangeLabel, type Aggregate, type Bucket, type DashboardConfig, type DashData, type Tile, type TileLayout, type TileType,
} from "../lib/dashboard";
import { db } from "../lib/db";
import { fmtNum, t, tk } from "../lib/i18n";
import { normalizeSpaceIcon } from "../lib/space-icon";
import { noteDerived, openNote, setUI, useVault } from "../lib/store";
import { TileChart } from "../components/charts";
import { Glyph } from "../components/Glyph";
import { cx } from "../components/ui";

const ROW = 68, GAP = 14; // h = 2 → 150px tiles, h = 4 → 314px (design rows 150 / 2 × 150 + 14)
const propsFor = (n: Note) => noteDerived("baseProps", n, propsOf);
const useWidth = () => { const [w, setW] = useState(() => innerWidth); useEffect(() => { const f = () => setW(innerWidth); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return w; };
/** Chart type glyphs (design: Add tile · 2 chart). */
export const TILE_GLYPH: Record<TileType, string> = {
  number: "dashboard", bar: "v-board", stackedBar: "v-board", line: "graph", area: "graph", donut: "s-learning", ring: "s-todo", table: "v-table", heatmap: "v-calendar", list: "v-list",
};
/** Chart type names: translate with `t(TILE_LABEL[type])`. */
export const TILE_LABEL: Record<TileType, string> = { number: tk("Number"), bar: tk("Bar"), stackedBar: tk("Stacked"), line: tk("Line"), area: tk("Area@@chart"), donut: tk("Donut"), heatmap: tk("Heatmap"), ring: tk("Ring"), table: tk("Table"), list: tk("List") };
const TYPE_ORDER: TileType[] = ["number", "bar", "stackedBar", "line", "area", "donut", "ring", "table", "heatmap", "list"];

function useDashData(): DashData {
  const v = useVault();
  const cards = useLiveQuery(() => db.cards.toArray(), []) ?? [];
  const sessions = useLiveQuery(() => db.sessions.toArray(), []) ?? [];
  const now = useMemo(() => Date.now(), [v, cards, sessions]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => ({
    notes: v.notes, cards, sessions, now, propsFor,
    // icon: the resolved glyph form ("glyph:x" / "initials:AB"), never a legacy emoji
    spaces: v.spaces.map((s) => ({ id: s.id, name: s.name, icon: normalizeSpaceIcon(s.icon, s.name), color: s.color, roadmapId: s.roadmapId })),
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

interface Drag { id: string; mode: "move" | "resize"; to: TileLayout }

export function DashboardView({ note }: { note: Note }) {
  const { cfg, error, found } = useMemo(() => parseDashboard(note.body), [note.body]);
  const data = useDashData();
  const vw = useWidth();
  const phone = vw < 640;
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [wizard, setWizard] = useState<Tile | "new" | null>(null);
  const [tables, setTables] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null);
  const [layout, setLayout] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  const write = (next: DashboardConfig) => void updateNote(note.id, { body: writeDashboard(note.body, next) });
  const tiles = drag ? placeTile(cfg.tiles, drag.id, drag.to) : cfg.tiles;
  const results = useMemo(() => new Map(cfg.tiles.map((t) => [t.id, runTile(withDashRange(t, cfg.range), data)])), [cfg.tiles, cfg.range, data]);
  useEffect(() => { if (phone) setLayout(false); }, [phone]);

  const colW = () => ((gridRef.current?.clientWidth ?? 960) - GAP * (COLS - 1)) / COLS;
  const startDrag = (e: React.PointerEvent, t: Tile, mode: Drag["mode"]) => {
    if (phone || !layout || e.button !== 0 || (e.target as HTMLElement).closest("button, select, input, [role=menu]")) return;
    e.preventDefault(); e.stopPropagation();
    setSel(t.id);
    const sx = e.clientX, sy = e.clientY, cw = colW() + GAP, rh = ROW + GAP;
    const rtl = getComputedStyle(gridRef.current!).direction === "rtl";
    let cur: TileLayout = t.layout;
    const move = (ev: PointerEvent) => {
      const dx = Math.round(((rtl ? -1 : 1) * (ev.clientX - sx)) / cw), dy = Math.round((ev.clientY - sy) / rh);
      cur = mode === "move" ? { ...t.layout, x: Math.max(0, Math.min(COLS - t.layout.w, t.layout.x + dx)), y: Math.max(0, t.layout.y + dy) }
        : { ...t.layout, w: Math.max(2, Math.min(COLS - t.layout.x, t.layout.w + dx)), h: Math.max(2, Math.min(12, t.layout.h + dy)) };
      setDrag({ id: t.id, mode, to: cur });
    };
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
      setDrag(null);
      if (cur.x !== t.layout.x || cur.y !== t.layout.y || cur.w !== t.layout.w || cur.h !== t.layout.h) write({ ...cfg, tiles: placeTile(cfg.tiles, t.id, cur) });
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
    setDrag({ id: t.id, mode, to: t.layout });
  };
  const keyMove = (e: React.KeyboardEvent, t: Tile) => {
    if (!layout) return;
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
  const toggleTable = (id: string) => setTables((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const ordered = phone ? stackOrder(tiles) : tiles;
  const rows = Math.max(gridRows(tiles), 1);
  const preview = drag && tiles.find((t) => t.id === drag.id)!.layout;
  // No dashboard-wide range: the picker names the charts' own range when they share one ("Last 8 weeks", DashDesk).
  const ownRanges = [...new Set(cfg.tiles.filter((t) => withDashRange(t, "8w") !== t).map((t) => t.range ?? ""))];
  const dashLabel = (r: string) => { const l = DASH_RANGES.find(([v]) => v === r)?.[1]; return l ? t(l) : undefined; };
  const ownRg = ownRanges.length === 1 && ownRanges[0] ? parseRange(ownRanges[0], Date.now()) : null;
  const ownLabel = ownRanges.length === 1 ? (ownRanges[0] ? dashLabel(ownRanges[0]) ?? (ownRg ? rangeLabel(ownRg).replace(/^./, (c) => c.toUpperCase()) : t("Tile ranges")) : t("All time")) : t("Tile ranges");
  const setRange = (r: string) => { const next = { ...cfg }; if (r) next.range = r; else delete next.range; write(next); };

  return (
    <div className="dash relative flex h-full min-h-0 flex-col" onClick={() => setMenu(null)}>
      <div className={cx("flex shrink-0 items-center gap-2.5 border-b border-line", phone ? "h-14 px-4" : "h-[52px] px-7")}>
        <ReaderBack phone={phone} />
        <Glyph name="dashboard" size={18} />
        <span dir="auto" className="min-w-0 flex-1 truncate text-[16px] font-[650]">{note.title || t("Dashboard")}</span>
        {!phone && (
          <label className="dash-range cursor-pointer hover:text-ink" title={t("Range for every chart over time")}>
            {/* the label shows the chosen range at its own width ("Last 8 weeks ▾"); the native select sits on top, invisible */}
            <b aria-hidden className="pointer-events-none pe-3 text-[13px] font-normal">{cfg.range ? dashLabel(cfg.range) ?? cfg.range : ownLabel}</b>
            <select aria-label={t("Dashboard range")} value={cfg.range ?? ""} onChange={(e) => setRange(e.target.value)} className="absolute inset-0 w-full opacity-0">
              <option value="">{ownLabel}</option>
              {DASH_RANGES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
              {cfg.range && !DASH_RANGES.some(([v]) => v === cfg.range) && <option value={cfg.range}>{cfg.range}</option>}
            </select>
            <span aria-hidden>▾</span>
          </label>
        )}
        {!phone && cfg.tiles.length > 0 && <button className={cx("dash-btn", layout && "is-on")} aria-pressed={layout} onClick={() => { setLayout(!layout); setSel(null); }}>{layout ? t("Done") : t("Edit layout")}</button>}
        {!phone && <button className="dash-btn" onClick={() => setUI({ mode: "edit" })} title={t("Edit the dashboard YAML")}>YAML</button>}
        <button className="dash-primary" onClick={() => setWizard("new")}>{t("Add tile")}</button>
      </div>
      {error && <div className="shrink-0 border-b border-line px-7 py-1.5 text-[12px] text-bad" dir="auto">{t("Couldn't read the dashboard definition: {error}", { error })}</div>}
      <div className={cx("min-h-0 flex-1 overflow-y-auto", phone ? "px-4 py-3.5" : "px-7 py-[18px]")}>
        {!cfg.tiles.length ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <Glyph name="dashboard" size={24} color="var(--muted)" />
            <div className="text-[14px] font-semibold">{found ? t("No tiles yet") : t("This dashboard is empty")}</div>
            <div className="max-w-[360px] text-[13px] text-muted">{t("Add a tile to chart your cards, study sessions, a learning path or any set of notes.")}</div>
            <button className="dash-primary" onClick={() => setWizard("new")}>{t("Add tile")}</button>
          </div>
        ) : (
          <div ref={gridRef} className={cx("dash-grid", phone && "dash-phone", layout && "is-layout", drag && "is-dragging")}
            style={phone ? undefined : { gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, ${ROW}px)`, gap: GAP }}>
            {preview && !phone && <div className="dash-ghost" style={{ gridColumn: `${preview.x + 1} / span ${preview.w}`, gridRow: `${preview.y + 1} / span ${preview.h}` }} />}
            {ordered.map((tile) => {
              const r = results.get(tile.id) ?? runTile(tile, data);
              const showTable = tables.has(tile.id);
              const chartless = tile.type === "table" || tile.type === "list";
              const isSel = layout && sel === tile.id;
              const phoneSpan = tile.type === "number" && tile.layout.w <= 4 ? 1 : 2;
              const title = showTable ? t("{title} · as table", { title: tile.title || t(TILE_LABEL[tile.type]) }) : tile.title || t(TILE_LABEL[tile.type]);
              return (
                <section key={tile.id} className={cx("dash-tile group/t", drag?.id === tile.id && "is-drag", isSel && "is-sel")} aria-label={title}
                  tabIndex={layout ? 0 : undefined} onKeyDown={(e) => keyMove(e, tile)} onPointerDown={(e) => startDrag(e, tile, "move")} onFocus={() => layout && setSel(tile.id)}
                  style={phone ? { gridColumn: `span ${phoneSpan}`, gridRow: `span ${tile.type === "number" ? 1 : 2}` } : { gridColumn: `${tile.layout.x + 1} / span ${tile.layout.w}`, gridRow: `${tile.layout.y + 1} / span ${tile.layout.h}` }}>
                  <header className="flex items-center gap-2">
                    <h3 dir="auto" className="min-w-0 flex-1 truncate text-[13px] font-semibold">{title}</h3>
                    {!chartless && tile.type !== "number" && (
                      <button className={cx("dash-tbl", showTable && "is-on")} aria-pressed={showTable} aria-label={t("Show as data table")} title={t("Data table")} onClick={(e) => { e.stopPropagation(); toggleTable(tile.id); }}>{t("Table")}</button>
                    )}
                    <div className="relative">
                      <button className="dash-more" aria-label={t("Tile menu")} aria-haspopup="menu" aria-expanded={menu === tile.id} onClick={(e) => { e.stopPropagation(); setMenu(menu === tile.id ? null : tile.id); }}>⋯</button>
                      {menu === tile.id && (
                        <div role="menu" className="dash-menu" onClick={(e) => e.stopPropagation()}>
                          <button role="menuitem" onClick={() => { setMenu(null); setWizard(tile); }}>{t("Edit tile")}</button>
                          {!chartless && <button role="menuitem" onClick={() => { setMenu(null); toggleTable(tile.id); }}>{showTable ? t("Show chart") : t("Show as table")}</button>}
                          <button role="menuitem" onClick={() => { setMenu(null); write(duplicateTile(cfg, tile.id)); }}>{t("Duplicate")}</button>
                          {!phone && <button role="menuitem" onClick={() => { setMenu(null); setLayout(true); setSel(tile.id); }}>{t("Move or resize")}</button>}
                          {phone && <button role="menuitem" onClick={() => { setMenu(null); setUI({ mode: "edit" }); }}>{t("Edit dashboard YAML")}</button>}
                          <button role="menuitem" className="text-bad" onClick={() => { setMenu(null); write(removeTile(cfg, tile.id)); }}>{t("Delete")}</button>
                        </div>
                      )}
                    </div>
                  </header>
                  <div className="dash-body"><TileChart tile={withDashRange(tile, cfg.range)} result={r} spaces={data.spaces} table={showTable} onRow={(id) => openRow(tile, id)} /></div>
                  {layout && !phone && <span className="dash-resize" aria-hidden title={t("Drag to resize")} onPointerDown={(e) => startDrag(e, tile, "resize")} />}
                </section>
              );
            })}
          </div>
        )}
      </div>
      {wizard && <AddTile key={wizard === "new" ? "new" : wizard.id} initial={wizard === "new" ? null : wizard} data={data} phone={phone}
        onCancel={() => setWizard(null)}
        onSave={(t) => { const ed = wizard; setWizard(null); if (ed === "new") { const { id: _i, layout: _l, ...rest } = t; void _i; void _l; write(addTile(cfg, rest)); } else write({ ...cfg, tiles: cfg.tiles.map((x) => (x.id === ed.id ? { ...t, id: x.id, layout: x.layout } : x)) }); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ Add tile (R4-18N/O/P): source → chart → fields, live preview
const RANGES = [["", tk("All time")], ["7d", tk("Last 7 days")], ["30d", tk("Last 30 days")], ["8w", tk("Last 8 weeks")], ["12w", tk("Last 12 weeks")], ["20w", tk("Last 20 weeks")], ["6m", tk("Last 6 months")], ["1y", tk("Last year")], ["next 1d", tk("Today")], ["next 7d", tk("Next 7 days")], ["next 14d", tk("Next 14 days")], ["next 30d", tk("Next 30 days")]];
const filterText = (f: Tile["filter"]) => (typeof f === "string" ? f : f ? JSON.stringify(f) : "");
const parseFilterText = (s: string): Tile["filter"] => { const t = s.trim(); if (!t) return undefined; if (t.startsWith("{")) { try { return JSON.parse(t); } catch { return t; } } return t; };

function AddTile({ initial, data, phone, onSave, onCancel }: { initial: Tile | null; data: DashData; phone: boolean; onSave: (tile: Tile) => void; onCancel: () => void }) {
  const [step, setStep] = useState(initial ? 3 : 1);
  const [tile, setT] = useState<Tile>(() => initial ? structuredClone(initial) : { id: "new", type: "stackedBar", source: "sessions", x: "at", bucket: "week", y: "minutes", aggregate: "sum", series: "course", range: "8w", layout: { x: 0, y: 0, w: 6, h: 4 } });
  const set = (p: Partial<Tile>) => setT((o) => ({ ...o, ...p }));
  const kind = sourceKind(tile.source);
  const paths = data.notes.filter((n) => n.type === "path");
  const bases = data.notes.filter((n) => n.type === "base");
  const baseNote = kind === "base" ? bases.find((n) => n.title.toLowerCase() === sourceArg(tile.source).toLowerCase()) : undefined;
  const baseViews = baseNote ? parseBase(baseNote.body).cfg.views.map((v) => v.name) : [];
  const recs = useMemo(() => sourceRecords(tile, data).recs, [tile.source, tile.view, tile.filter, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const fields = fieldsOf(tile.source, recs);
  const dateFields = fields.filter((f) => f.kind === "date");
  const numFields = fields.filter((f) => f.kind === "number");
  const catFields = fields.filter((f) => f.kind === "category" || f.kind === "bool" || f.kind === "text");
  const eff = { ...tile, ...tileDefaults(tile) };
  const xIsDate = dateFields.some((f) => f.name === eff.x);
  const result = useMemo(() => runTile(tile, data), [tile, data]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onCancel(); addEventListener("keydown", k); ref.current?.focus(); return () => removeEventListener("keydown", k); }, [onCancel]);
  const pickSource = (source: string, extra: Partial<Tile> = {}) => {
    const k = sourceKind(source);
    const def: Partial<Tile> = k === "sessions" ? { x: "at", y: "minutes", aggregate: "sum", series: undefined, bucket: "week", range: "8w" }
      : k === "cards" ? { x: "dueOn", y: undefined, aggregate: "count", series: undefined, bucket: "day", range: "next 14d" }
      : { x: "status", y: undefined, aggregate: "count", series: undefined, bucket: undefined, range: undefined };
    set({ source, view: undefined, filter: undefined, ...def, ...extra });
  };
  const final = (): Tile => ({ ...tile, bucket: xIsDate ? tile.bucket : undefined, series: ["bar", "stackedBar", "line", "area"].includes(tile.type) ? tile.series : undefined, cumulative: tile.type === "line" || tile.type === "area" ? tile.cumulative : undefined });
  const box = "h-8 min-w-0 flex-1 rounded-[7px] border border-line bg-bg px-2.5 text-[13px] text-ink outline-none focus:border-accent";
  const row = (l: string, el: ReactNode) => <label className="flex items-center gap-2.5"><span className="w-[110px] shrink-0 text-muted">{l}</span>{el}</label>;
  const choice = (on: boolean) => cx("dash-choice", on && "is-on");
  const STEPS = [t("Source"), t("Chart"), t("Fields")];
  const seriesNames = result.data.kind === "series" && result.data.series.length > 1 ? result.data.series.slice(0, 3).map((s) => s.label).join(t(", ")) : "";
  const seriesLabel = fields.find((f) => f.name === tile.series)?.label ?? tile.series ?? "";
  const caption = seriesNames ? (tile.type === "stackedBar" ? t("Stacked by {field} · {names}", { field: seriesLabel, names: seriesNames }) : t("Coloured by {field} · {names}", { field: seriesLabel, names: seriesNames })) : t("{n} record|{n} records", { n: result.records });

  return (
    <>
      <div className="dash-scrim" onClick={onCancel} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal aria-label={initial ? t("Edit tile") : t("Add tile")} className="dash-wizard" style={{ width: phone ? "min(380px, calc(100% - 24px))" : "min(900px, calc(100% - 48px))" }}>
        <div className="flex items-center gap-3.5 border-b border-line px-5 py-4">
          <span className="flex-1 text-[17px] font-[650]">{initial ? t("Edit tile") : t("Add tile")}</span>
          {STEPS.map((l, i) => {
            const n = i + 1, done = n < step, cur = n === step;
            return (
              <button key={l} onClick={() => setStep(n)} className={cx("flex items-center gap-1.5 text-[12.5px]", cur || done ? "text-ink" : "text-muted", cur ? "font-semibold" : "font-[450]")}>
                <span className="flex size-5 items-center justify-center rounded-full text-[11px] font-bold" style={{ border: `1.5px solid ${cur || done ? "var(--text)" : "var(--muted)"}`, background: cur ? "var(--accent)" : "transparent", borderColor: cur ? "var(--accent)" : undefined, color: cur ? "var(--accent-fg)" : "var(--text)" }}>{done ? "✓" : fmtNum(n)}</span>
                {!phone && l}
              </button>
            );
          })}
        </div>
        <div className={cx("grid min-h-[380px]", phone ? "grid-cols-1" : "grid-cols-[1fr_360px]")}>
          <div className="flex max-h-[62vh] flex-col gap-2.5 overflow-y-auto px-5 py-[18px]">
            {step === 1 && (
              <>
                <span className="text-muted">{t("What should the tile count?")}</span>
                {([
                  ["sessions", "dashboard", t("Study sessions"), t("Timer minutes, by day/course")],
                  ["cards", "flashcards", t("Flashcards"), t("Reviews, due, retention")],
                  ["path", "path", t("A learning path"), t("Concept status by stage")],
                  ["base", "base", t("A base view"), bases[0] ? `“${bases[0].title}”` : t("No bases yet")],
                  ["notes", "note", t("Notes"), t("Count by type, tag, folder")],
                ] as const).map(([k, g, n, d]) => (
                  <div key={k} className={choice(kind === k)} role="button" tabIndex={0} aria-pressed={kind === k}
                    onClick={() => kind !== k && pickSource(k === "path" ? (paths[0] ? `path:${paths[0].title}` : "path") : k === "base" ? (bases[0] ? `base:${bases[0].title}` : "base:") : k)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && kind !== k && (e.preventDefault(), pickSource(k === "path" ? (paths[0] ? `path:${paths[0].title}` : "path") : k === "base" ? (bases[0] ? `base:${bases[0].title}` : "base:") : k))}>
                    <Glyph name={g} size={18} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-semibold">{n}</span>
                      <span className="truncate text-[12px] text-muted">{d}</span>
                      {kind === k && k === "path" && paths.length > 0 && (
                        <select aria-label={t("Learning path")} className={cx(box, "mt-1.5")} value={sourceArg(tile.source).replace(/^path$/i, "")} onClick={(e) => e.stopPropagation()} onChange={(e) => pickSource(e.target.value ? `path:${e.target.value}` : "path")}>
                          <option value="">{t("Most recent path")}</option>
                          {paths.map((p) => <option key={p.id} value={p.title}>{p.title}</option>)}
                        </select>
                      )}
                      {kind === k && k === "base" && bases.length > 0 && (
                        <span className="mt-1.5 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <select aria-label={t("Base")} className={box} value={sourceArg(tile.source)} onChange={(e) => pickSource(`base:${e.target.value}`)}>
                            {bases.map((b) => <option key={b.id} value={b.title}>{b.title}</option>)}
                          </select>
                          {baseViews.length > 1 && <select aria-label={t("View")} className={box} value={tile.view ?? baseViews[0]} onChange={(e) => set({ view: e.target.value })}>{baseViews.map((v) => <option key={v} value={v}>{v}</option>)}</select>}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
            {step === 2 && (
              <>
                <span className="text-muted">{t("Chart type")}</span>
                <div className="grid grid-cols-4 gap-2">
                  {TYPE_ORDER.map((ty) => (
                    <button key={ty} aria-pressed={tile.type === ty} onClick={() => set({ type: ty, ...(ty === "heatmap" ? { x: dateFields[0]?.name, bucket: "day" as Bucket, range: "20w", series: undefined }
                      // a donut slices categories: a date x from the previous chart becomes the series field (or the first category); no second split
                      : ty === "donut" ? { ...(xIsDate ? { x: tile.series ?? catFields[0]?.name, bucket: undefined } : {}), series: undefined } : {}) })}
                      className={cx("dash-type", tile.type === ty && "is-on")}>
                      <Glyph name={TILE_GLYPH[ty]} size={20} />{t(TILE_LABEL[ty])}
                    </button>
                  ))}
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <span className="text-muted">{t("Fields")}</span>
                {row(t("Title"), <input className={box} dir="auto" value={tile.title ?? ""} placeholder={t(TILE_LABEL[tile.type])} onChange={(e) => set({ title: e.target.value || undefined })} />)}
                {tile.type !== "number" && tile.type !== "ring" && row(tile.type === "donut" ? t("Slices") : tile.type === "table" || tile.type === "list" ? t("Group by") : t("X axis"),
                  <select className={box} value={eff.x ?? ""} onChange={(e) => set({ x: e.target.value || undefined })}>
                    {(tile.type === "table" || tile.type === "list") && <option value="">{t("None (list records)")}</option>}
                    {(tile.type === "heatmap" ? dateFields : [...dateFields, ...catFields]).map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}
                  </select>)}
                {xIsDate && tile.type !== "heatmap" && tile.type !== "number" && tile.type !== "ring" && row(t("Bucket"),
                  <select className={box} value={tile.bucket ?? ""} onChange={(e) => set({ bucket: (e.target.value || undefined) as Bucket | undefined })}>
                    <option value="">{t("Automatic")}</option><option value="day">{t("Day")}</option><option value="week">{t("Week")}</option><option value="month">{t("Month")}</option>
                  </select>)}
                {row(t("Value"),
                  <span className="flex min-w-0 flex-1 gap-1.5">
                    <select aria-label={t("Aggregate")} className={box} value={tile.aggregate ?? (tile.y ? "sum" : "count")} onChange={(e) => set({ aggregate: e.target.value as Aggregate, y: e.target.value === "count" ? undefined : tile.y ?? numFields[0]?.name })}>
                      <option value="count">{t("Count")}</option><option value="sum">{t("Sum of")}</option><option value="avg">{t("Average of")}</option><option value="min">{t("Min of")}</option><option value="max">{t("Max of")}</option>
                    </select>
                    {(tile.aggregate ?? (tile.y ? "sum" : "count")) !== "count" && (
                      <select aria-label={t("Value field")} className={box} value={tile.y ?? ""} onChange={(e) => set({ y: e.target.value || undefined })}>
                        {numFields.map((f) => <option key={f.name} value={f.name}>{f.label.toLowerCase()}</option>)}
                      </select>
                    )}
                  </span>)}
                {["bar", "stackedBar", "line", "area"].includes(tile.type) && row(t("Series"),
                  <select className={box} value={tile.series ?? ""} onChange={(e) => set({ series: e.target.value || undefined })}>
                    <option value="">{t("None")}</option>
                    {catFields.filter((f) => f.name !== eff.x).map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}
                  </select>)}
                {row(t("Range"),
                  <select className={box} value={eff.range ?? ""} onChange={(e) => set({ range: e.target.value || undefined })}>
                    {RANGES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
                    {eff.range && !RANGES.some(([v]) => v === eff.range) && <option value={eff.range}>{eff.range}</option>}
                  </select>)}
                {row(t("Filter"),
                  <input className={cx(box, "font-mono text-[12px]")} dir="ltr" defaultValue={filterText(tile.filter)} placeholder={kind === "path" ? "mastered == true" : kind === "cards" ? 'state == "review"' : kind === "notes" ? 'type == "lesson"' : 'course == "CS231n"'} onBlur={(e) => set({ filter: parseFilterText(e.target.value) })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />)}
                {tile.type === "ring" && row(t("Filled part"),
                  <input className={cx(box, "font-mono text-[12px]")} dir="ltr" defaultValue={filterText(tile.part)} placeholder="learned == true" onBlur={(e) => set({ part: parseFilterText(e.target.value) })} />)}
                {tile.type === "number" && row(t("Delta"),
                  <span className="flex min-w-0 flex-1 gap-1.5">
                    <select aria-label={t("Delta")} className={box} value={tile.delta === false ? "off" : tile.delta === "percent" ? "percent" : "abs"} onChange={(e) => set({ delta: e.target.value === "off" ? false : e.target.value === "percent" ? "percent" : undefined })}>
                      <option value="abs">{t("Difference")}</option><option value="percent">{t("Percent")}</option><option value="off">{t("Off")}</option>
                    </select>
                    <select aria-label={t("Better")} className={box} value={tile.better ?? "up"} onChange={(e) => set({ better: e.target.value === "down" ? "down" : undefined })}>
                      <option value="up">{t("Up is good")}</option><option value="down">{t("Down is good")}</option>
                    </select>
                  </span>)}
                {tile.type === "number" && row(t("Caption"), <input className={box} dir="auto" value={tile.caption ?? ""} placeholder={t("Automatic")} onChange={(e) => set({ caption: e.target.value || undefined })} />)}
                {(tile.type === "line" || tile.type === "area") && xIsDate && row(t("Running total"),
                  <select className={box} value={tile.cumulative ? "on" : "off"} onChange={(e) => set({ cumulative: e.target.value === "on" || undefined })}><option value="off">{t("Off")}</option><option value="on">{t("On")}</option></select>)}
                {(tile.type === "table" || tile.type === "list") && !eff.x && row(t("Columns"),
                  <input className={box} dir="ltr" defaultValue={(tile.fields ?? []).join(", ")} placeholder={fields.slice(0, 3).map((f) => f.name).join(", ")} onBlur={(e) => set({ fields: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />)}
              </>
            )}
          </div>
          {!phone && (
            <div className="flex flex-col gap-2 border-s border-line bg-bg p-4">
              <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t("Live preview")}</span>
              <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-[12px] border border-line bg-surface p-3.5">
                <span dir="auto" className="truncate font-semibold">{tile.title || t(TILE_LABEL[tile.type])}</span>
                <div className="dash-preview relative min-h-[200px] flex-1"><div className="absolute inset-0"><TileChart tile={tile} result={result} spaces={data.spaces} /></div></div>
                <span dir="auto" className="truncate text-[11.5px] text-muted">{caption}</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <button className="h-[34px] px-3.5 text-muted hover:text-ink" onClick={() => (step > 1 && !initial ? setStep(step - 1) : onCancel())}>{step > 1 && !initial ? t("Back") : t("Cancel")}</button>
          <button className="dash-primary h-[34px] rounded-[10px] px-4" onClick={() => (step < 3 ? setStep(step + 1) : onSave(final()))}>{step < 3 ? t("Next") : initial ? t("Save tile") : t("Add to dashboard")}</button>
        </div>
      </div>
    </>
  );
}
