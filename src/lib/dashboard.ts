// Dashboards: a note of type "dashboard" whose body holds open YAML (```dashboard block, or the body after the
// front-matter / H1) describing a 12-column grid of chart tiles. Pure logic, no React: parse / write the YAML,
// build records from a source (cards, sessions, a learning path, notes, a base view), aggregate them into datasets
// the chart components draw. Format: docs/DASHBOARDS.md.
import type { Card, Note, Session } from "../../shared/types";
import { STATUSES } from "../../shared/types";
import {
  asTime, canon, getValue, parseBase, parseYaml, propsOf, runView, testFilter, testFilterWith, toYaml, ymd,
  type Ctx, type FilterNode, type Val, type YMap,
} from "./base";
import { buildPath, parsePath, resolveCourses } from "./path";
import { natural, splitFrontMatter } from "./parse";
// `tr` = i18n `t` (this module uses `t` for tiles)
import { fmtDate as fmtD, fmtNum as fmtN, t as tr, tk } from "./i18n";

// ------------------------------------------------------------------ format
export type TileType = "number" | "bar" | "line" | "area" | "donut" | "stackedBar" | "heatmap" | "ring" | "table" | "list";
export const TILE_TYPES: TileType[] = ["number", "bar", "stackedBar", "line", "area", "donut", "heatmap", "ring", "table", "list"];
export type Aggregate = "count" | "sum" | "avg" | "min" | "max";
export type Bucket = "day" | "week" | "month";
export interface TileLayout { x: number; y: number; w: number; h: number }
export interface Tile {
  id: string;
  title?: string;
  type: TileType;
  /** cards | sessions | notes | path:<path note title> | base:<base note title> (+ `view:`) */
  source: string;
  view?: string;
  filter?: FilterNode;
  /** Category / date field (x axis, donut slices, table rows). `groupBy` is accepted as an alias. */
  x?: string;
  /** Value field for sum / avg / min / max. */
  y?: string;
  aggregate?: Aggregate;
  series?: string;
  bucket?: Bucket;
  /** "12w", "30d", "6m", "1y", "next 14d", "all" */
  range?: string;
  cumulative?: boolean;
  /** ring: the part (filter) and/or a fixed target; number: show the delta (default true when a past range is set;
   *  "percent" shows it as a percentage) */
  part?: FilterNode;
  target?: number;
  delta?: boolean | "percent";
  /** number: which direction is good (delta colour: green / red). Default up. */
  better?: "up" | "down";
  /** number: the line under the value (default: "of N in <source>" for filtered counts, else the range). */
  caption?: string;
  /** table / list: record fields to show, sort ("-field" = descending), row limit */
  fields?: string[];
  sort?: string;
  limit?: number;
  unit?: string;
  /** Series colors: value → canvas preset "1".."6" or "#RRGGBB". */
  colors?: Record<string, string>;
  layout: TileLayout;
  [k: string]: unknown;
}
/** `range` (optional) = the dashboard-wide range picker ("8w", "30d"…): it replaces the range of every chart over
 *  time (bar / stacked / line / area with a date x axis); numbers, rings, heatmaps and tables keep their own. */
export interface DashboardConfig { columns: number; tiles: Tile[]; range?: string; [k: string]: unknown }

/** The tile as run under the dashboard range (see DashboardConfig.range). */
export function withDashRange(t: Tile, range: string | undefined): Tile {
  if (!range || !["bar", "stackedBar", "line", "area"].includes(t.type) || /^\s*next/i.test(t.range ?? "")) return t;
  const x = t.x ?? defaultDateField(t.source);
  const dateX = SOURCE_FIELDS[sourceKind(t.source) === "base" ? "notes" : (sourceKind(t.source) as "notes")]?.find((f) => f.name === x)?.kind === "date" || /date|due|at$|on$|created|updated/i.test(x);
  return dateX ? { ...t, range } : t;
}
/** Default caption under a number: its range in words ("this week", "last 30 days", "today"). */
export const rangeCaption = (r: string | undefined, now: number) => {
  const rg = parseRange(r, now);
  if (!rg) return undefined;
  return rg.label === "last 7 days" ? tr("this week") : rg.label === "next 1 day" ? tr("today") : rangeLabel(rg);
};
/** Translated range text ("last 8 weeks" / "آخر 8 أسابيع"); `Range.label` stays English for logic. */
export function rangeLabel(rg: Pick<Range, "n" | "unit" | "next">): string {
  const n = rg.n;
  if (rg.next) return rg.unit === "d" ? tr("next {n} day|next {n} days", { n }) : rg.unit === "w" ? tr("next {n} week|next {n} weeks", { n }) : rg.unit === "m" ? tr("next {n} month|next {n} months", { n }) : tr("next {n} year|next {n} years", { n });
  return rg.unit === "d" ? tr("last {n} day|last {n} days", { n }) : rg.unit === "w" ? tr("last {n} week|last {n} weeks", { n }) : rg.unit === "m" ? tr("last {n} month|last {n} months", { n }) : tr("last {n} year|last {n} years", { n });
}
/** Dashboard-wide ranges: [value, label] (translate the label with `t`). */
export const DASH_RANGES: [string, string][] = [["7d", tk("Last 7 days")], ["30d", tk("Last 30 days")], ["8w", tk("Last 8 weeks")], ["12w", tk("Last 12 weeks")], ["6m", tk("Last 6 months")], ["1y", tk("Last year")]];

export const COLS = 12;
const FENCE = /^([ \t]*)(`{3,}|~{3,})[ \t]*dashboard[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\2[ \t]*$/m;

export function findDashYaml(body: string): { yaml: string; start: number; end: number; fenced: boolean } | null {
  const m = FENCE.exec(body);
  if (m) { const start = m.index + m[0].indexOf(m[3]); return { yaml: m[3], start, end: start + m[3].length, fenced: true }; }
  const fmLen = body.length - splitFrontMatter(body).body.length;
  const h1 = /^\s*#\s.*(\r?\n|$)/.exec(body.slice(fmLen));
  const off = fmLen + (h1 ? h1[0].length : 0);
  const rest = body.slice(off);
  if (/^\s*tiles\s*:/.test(rest)) return { yaml: rest, start: off, end: body.length, fenced: false };
  return null;
}

const str = (y: unknown) => (typeof y === "string" ? y : typeof y === "number" || typeof y === "boolean" ? String(y) : undefined);
const num = (y: unknown, d: number) => (Number.isFinite(Number(y)) && y !== null && y !== "" ? Number(y) : d);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const AGGS: Aggregate[] = ["count", "sum", "avg", "min", "max"];
const DEFAULT_SIZE: Record<TileType, [number, number]> = { number: [3, 2], ring: [3, 3], donut: [4, 4], bar: [6, 4], stackedBar: [6, 4], line: [6, 4], area: [6, 4], heatmap: [8, 3], table: [6, 4], list: [4, 4] };

/** Normalize one tile (unknown keys are kept for round-trips). */
function tileOf(o: YMap, i: number): Tile {
  const t0 = str(o.type);
  const type = (TILE_TYPES as string[]).includes(t0 ?? "") ? (t0 as TileType) : t0 === "stacked" || t0 === "stackedbar" ? "stackedBar" : t0 === "pie" ? "donut" : t0 === "progress" ? "ring" : "bar";
  const lo = o.layout && typeof o.layout === "object" && !Array.isArray(o.layout) ? (o.layout as YMap) : {};
  const [dw, dh] = DEFAULT_SIZE[type];
  const agg = str(o.aggregate);
  const t: Tile = {
    ...o,
    id: str(o.id) || `t${i + 1}`,
    title: str(o.title),
    type,
    source: str(o.source) || "notes",
    view: str(o.view),
    filter: (o.filter ?? undefined) as FilterNode | undefined,
    x: str(o.x ?? o.groupBy),
    y: str(o.y),
    aggregate: AGGS.includes(agg as Aggregate) ? (agg as Aggregate) : undefined,
    series: str(o.series),
    bucket: (["day", "week", "month"] as string[]).includes(str(o.bucket) ?? "") ? (str(o.bucket) as Bucket) : undefined,
    range: str(o.range),
    cumulative: o.cumulative === true || undefined,
    part: (o.part ?? undefined) as FilterNode | undefined,
    target: o.target !== undefined && o.target !== null ? num(o.target, 0) || undefined : undefined,
    delta: o.delta === false ? false : o.delta === "percent" ? "percent" : undefined,
    better: o.better === "down" ? "down" : undefined,
    caption: str(o.caption),
    fields: Array.isArray(o.fields) ? o.fields.map(str).filter((x): x is string => !!x) : undefined,
    sort: str(o.sort),
    limit: Number(o.limit) > 0 ? Number(o.limit) : undefined,
    unit: str(o.unit),
    colors: o.colors && typeof o.colors === "object" && !Array.isArray(o.colors) ? Object.fromEntries(Object.entries(o.colors).map(([k, v]) => [k, String(v)])) : undefined,
    layout: { x: Math.max(0, Math.round(num(lo.x, -1))), y: Math.max(0, Math.round(num(lo.y, -1))), w: clamp(Math.round(num(lo.w, dw)), 1, COLS), h: clamp(Math.round(num(lo.h, dh)), 1, 12) },
  };
  if (lo.x === undefined || lo.y === undefined) t.layout = { ...t.layout, x: -1, y: -1 }; // packed below
  delete (t as Record<string, unknown>).groupBy;
  return t;
}

export function parseDashboard(body: string): { cfg: DashboardConfig; error: string | null; found: boolean } {
  const loc = findDashYaml(body);
  let raw: unknown = null, error: string | null = null;
  if (loc) { try { raw = parseYaml(loc.yaml); } catch (e) { error = String(e); } }
  const o: YMap = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as YMap) : {};
  if (loc && raw !== null && (typeof raw !== "object" || Array.isArray(raw))) error = tr("The dashboard block should be a YAML map (tiles:)");
  const tiles = (Array.isArray(o.tiles) ? o.tiles : []).filter((v): v is YMap => !!v && typeof v === "object" && !Array.isArray(v)).map(tileOf);
  // unique ids
  const seen = new Set<string>();
  for (const t of tiles) { let id = t.id, n = 2; while (seen.has(id)) id = `${t.id}-${n++}`; t.id = id; seen.add(id); }
  return { cfg: { ...o, columns: COLS, tiles: pack(tiles) }, error, found: !!loc };
}

/** YAML for a config: drops undefined / default keys, writes layout as a flow map. */
export function serializeDashboard(cfg: DashboardConfig): string {
  const { tiles, columns: _c, ...rest } = cfg;
  void _c;
  const clean = (t: Tile): YMap => {
    const out: Record<string, unknown> = {};
    const ORDER = ["id", "title", "type", "source", "view", "filter", "x", "bucket", "y", "aggregate", "series", "range"];
    for (const [k, v] of [...ORDER.filter((k) => k in t).map((k) => [k, t[k]] as const), ...Object.entries(t).filter(([k]) => !ORDER.includes(k))]) {
      if (v === undefined || v === null || k === "layout") continue;
      if (Array.isArray(v) && !v.length) continue;
      out[k] = v;
    }
    return out as YMap;
  };
  const head = Object.keys(rest).length ? toYaml(rest as YMap) : "";
  if (!tiles.length) return `${head}tiles: []\n`;
  // each tile's keys, then `layout: { x: 0, y: 0, w: 6, h: 4 }` on one line
  const items = tiles.map((t) => `  - ${toYaml(clean(t), 4).slice(4)}    layout: ${flow(t.layout)}\n`);
  return `${head}tiles:\n${items.join("")}`;
}
const flow = (l: TileLayout) => `{ x: ${l.x}, y: ${l.y}, w: ${l.w}, h: ${l.h} }`;

export function writeDashboard(body: string, cfg: DashboardConfig): string {
  const yaml = serializeDashboard(cfg).replace(/\n+$/, "");
  const loc = findDashYaml(body);
  if (!loc) return `${body.replace(/\s*$/, "")}\n\n\`\`\`dashboard\n${yaml}\n\`\`\`\n`;
  return body.slice(0, loc.start) + yaml + (loc.fenced ? "" : "\n") + body.slice(loc.end);
}

// ------------------------------------------------------------------ grid layout
const overlap = (a: TileLayout, b: TileLayout) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Place tiles without a layout (x/y = -1) at the first free spot, in order. */
export function pack(tiles: Tile[], cols = COLS): Tile[] {
  const placed: TileLayout[] = tiles.filter((t) => t.layout.x >= 0 && t.layout.y >= 0).map((t) => ({ ...t.layout, x: Math.min(t.layout.x, cols - Math.min(t.layout.w, cols)), w: Math.min(t.layout.w, cols) }));
  return tiles.map((t) => {
    if (t.layout.x >= 0 && t.layout.y >= 0) { const w = Math.min(t.layout.w, cols); return { ...t, layout: { ...t.layout, w, x: Math.min(t.layout.x, cols - w) } }; }
    const w = Math.min(t.layout.w, cols), h = t.layout.h;
    for (let y = 0; ; y++) for (let x = 0; x + w <= cols; x++) {
      const l = { x, y, w, h };
      if (!placed.some((p) => overlap(p, l))) { placed.push(l); return { ...t, layout: l }; }
    }
  });
}

/** Move / resize one tile; tiles it now overlaps are pushed down, then everything floats up (no gaps). */
export function placeTile(tiles: Tile[], id: string, to: TileLayout, cols = COLS): Tile[] {
  const w = clamp(Math.round(to.w), 1, cols);
  const target: TileLayout = { x: clamp(Math.round(to.x), 0, cols - w), y: Math.max(0, Math.round(to.y)), w, h: clamp(Math.round(to.h), 1, 12) };
  const moved = tiles.find((t) => t.id === id);
  if (!moved) return tiles;
  const others = tiles.filter((t) => t.id !== id).map((t) => ({ ...t, layout: { ...t.layout } })).sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
  const fixed: TileLayout[] = [target];
  for (const t of others) {
    while (fixed.some((f) => overlap(f, t.layout))) t.layout.y++;
    fixed.push(t.layout);
  }
  const all = [{ ...moved, layout: target }, ...others];
  return compact(all).sort((a, b) => tiles.findIndex((t) => t.id === a.id) - tiles.findIndex((t) => t.id === b.id));
}
/** Float every tile up as far as it goes (the moved tile keeps its row if it is first). */
export function compact(tiles: Tile[]): Tile[] {
  const order = [...tiles].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
  const done: TileLayout[] = [];
  const out = new Map<string, Tile>();
  for (const t of order) {
    const l = { ...t.layout };
    while (l.y > 0 && !done.some((d) => overlap(d, { ...l, y: l.y - 1 }))) l.y--;
    done.push(l);
    out.set(t.id, { ...t, layout: l });
  }
  return tiles.map((t) => out.get(t.id)!);
}
export const gridRows = (tiles: Tile[]) => tiles.reduce((m, t) => Math.max(m, t.layout.y + t.layout.h), 0);
/** Phone order: top to bottom, left to right. */
export const stackOrder = (tiles: Tile[]) => [...tiles].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
export const newTileId = (tiles: Tile[]) => { let i = tiles.length + 1; while (tiles.some((t) => t.id === `t${i}`)) i++; return `t${i}`; };
export function addTile(cfg: DashboardConfig, t: Partial<Tile> & { type: TileType; source: string }): DashboardConfig {
  const [w, h] = DEFAULT_SIZE[t.type as TileType];
  const tile = { ...t, id: newTileId(cfg.tiles), layout: t.layout ?? { x: -1, y: -1, w, h } } as Tile;
  return { ...cfg, tiles: pack([...cfg.tiles, tile]) };
}
export function duplicateTile(cfg: DashboardConfig, id: string): DashboardConfig {
  const t = cfg.tiles.find((x) => x.id === id);
  if (!t) return cfg;
  const copy: Tile = { ...structuredClone(t), id: newTileId(cfg.tiles), title: t.title ? `${t.title} copy` : undefined, layout: { ...t.layout, x: -1, y: -1 } };
  const i = cfg.tiles.indexOf(t);
  return { ...cfg, tiles: pack([...cfg.tiles.slice(0, i + 1), copy, ...cfg.tiles.slice(i + 1)]) };
}
export const removeTile = (cfg: DashboardConfig, id: string): DashboardConfig => ({ ...cfg, tiles: compact(cfg.tiles.filter((t) => t.id !== id)) });

// ------------------------------------------------------------------ sources → records
export type RVal = string | number | boolean | string[] | null;
export type Rec = Record<string, RVal> & { _id?: string };
export interface DashData {
  notes: Note[];
  cards: Card[];
  sessions: Session[];
  spaces: { id: string; name: string; icon: string; color: string | null; roadmapId: string | null }[];
  ctx: Ctx;
  now: number;
  /** Cached props of a note (front-matter + record props). */
  propsFor?: (n: Note) => Record<string, string>;
}
export type FieldKind = "date" | "number" | "category" | "text" | "bool";
export interface FieldInfo { name: string; kind: FieldKind; label: string }
const F = (name: string, kind: FieldKind, label: string): FieldInfo => ({ name, kind, label });
export const SOURCE_FIELDS: Record<"cards" | "sessions" | "path" | "notes", FieldInfo[]> = {
  cards: [F("dueOn", "date", tk("Due (overdue counts today)")), F("due", "date", tk("Due")), F("lastReview", "date", tk("Last review")), F("state", "category", tk("State")), F("course", "category", tk("Course")), F("note", "category", tk("Note")),
    F("interval", "number", tk("Interval (days)")), F("reps", "number", tk("Reviews")), F("lapses", "number", tk("Lapses")), F("stability", "number", tk("Stability")), F("difficulty", "number", tk("Difficulty"))],
  sessions: [F("at", "date", tk("Date")), F("course", "category", tk("Course")), F("note", "category", tk("Note")), F("weekday", "category", tk("Weekday")), F("hour", "number", tk("Hour")), F("minutes", "number", tk("Minutes"))],
  path: [F("learnedOn", "date", tk("Learned on")), F("review", "date", tk("Next review")), F("due", "date", tk("Course due date")), F("status", "category", tk("Status")), F("stage", "category", tk("Stage")), F("courses", "category", tk("Courses")),
    F("concept", "text", tk("Concept")), F("mastered", "bool", tk("Mastered")), F("learned", "bool", tk("Learned")), F("reviewDue", "bool", tk("Review due")), F("interval", "number", tk("Review interval"))],
  notes: [F("created", "date", tk("Created")), F("updated", "date", tk("Updated")), F("status", "category", tk("Status")), F("type", "category", tk("Type")), F("space", "category", tk("Space (course)")), F("tags", "category", tk("Tags")), F("folder", "category", tk("Folder")), F("title", "text", tk("Title"))],
};
export const sourceKind = (source: string): "cards" | "sessions" | "path" | "notes" | "base" => {
  const s = source.trim().toLowerCase();
  if (s === "cards" || s === "sessions") return s;
  if (s === "path" || s.startsWith("path:")) return "path";
  if (s.startsWith("base:")) return "base";
  return "notes";
};
export const sourceArg = (source: string) => source.replace(/^\s*(path|base)\s*:\s*/i, "").trim();
const DEFAULT_DATE: Record<string, string> = { cards: "dueOn", sessions: "at", path: "learnedOn", notes: "updated", base: "updated" };
export const defaultDateField = (source: string) => DEFAULT_DATE[sourceKind(source)];

const DAY = 86_400_000;
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const isoToTime = (s: string | null | undefined) => (s ? asTime(s) : null);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function noteRecord(n: Note, d: DashData): Rec {
  const props = d.propsFor ? d.propsFor(n) : propsOf(n);
  const r: Rec = { _id: n.id };
  for (const k of Object.keys(props)) r[k] = getValue(n, k, d.ctx, props) as RVal;
  for (const k of ["title", "type", "status", "tags", "space", "folder", "created", "updated"]) r[k] = getValue(n, k, d.ctx, props) as RVal;
  r.course = r.course ?? r.space;
  return r;
}

export function cardState(c: Card): string {
  if (c.suspended) return "suspended";
  if (c.state) return c.state;
  if (!c.reps) return "new";
  return c.interval === 0 ? (c.lapses ? "relearning" : "learning") : "review";
}

/** Records for a tile's source, filtered by the tile filter. `error` when the source can't be found. */
export function sourceRecords(t: Pick<Tile, "source" | "view" | "filter">, d: DashData): { recs: Rec[]; error: string | null } {
  const kind = sourceKind(t.source);
  const byId = new Map(d.notes.map((n) => [n.id, n]));
  const spaceName = (id: string | undefined) => (id ? d.ctx.spaceName(id) : null);
  let recs: Rec[] = [];
  if (kind === "cards") {
    const today = startOfDay(d.now);
    recs = d.cards.filter((c) => !c.deleted).map((c) => {
      const n = byId.get(c.noteId);
      const state = cardState(c);
      const due = c.due > 0 && state !== "new" ? c.due : null;
      return { _id: c.id, note: n?.title ?? null, course: spaceName(n?.spaceId), state, due, dueOn: due === null || state === "suspended" ? null : Math.max(due, today), interval: c.interval, reps: c.reps, lapses: c.lapses, stability: c.stability ?? null, difficulty: c.difficulty ?? null, lastReview: c.lastReview ?? null, suspended: !!c.suspended };
    });
  } else if (kind === "sessions") {
    recs = d.sessions.filter((s) => !s.deleted).map((s) => {
      const n = s.noteId ? byId.get(s.noteId) : undefined;
      const dt = new Date(s.at);
      return { _id: s.id, at: s.at, minutes: s.minutes, note: n?.title ?? null, course: n ? spaceName(n.spaceId) : null, weekday: WEEKDAYS[(dt.getDay() + 6) % 7], hour: dt.getHours() };
    });
  } else if (kind === "path") {
    // `path:<title>` (exact, then partial match); bare `path` = the most recently edited learning path
    const name = sourceArg(t.source).replace(/^path$/i, "").toLowerCase();
    const paths = d.notes.filter((n) => n.type === "path").sort((a, b) => b.updatedAt - a.updatedAt);
    const pn = name ? paths.find((n) => n.title.toLowerCase() === name) ?? paths.find((n) => n.title.toLowerCase().includes(name)) : paths[0];
    if (!pn) return { recs: [], error: name ? tr("No learning path called \"{name}\"", { name: sourceArg(t.source) }) : tr("No learning path yet") };
    const refs = resolveCourses(parsePath(pn.body).courses, d.notes, d.spaces);
    const p = buildPath(pn.body, refs);
    recs = p.concepts.map((c) => {
      const review = isoToTime(c.def.review);
      let learnedOn: number | null = null;
      if (c.status === "done") {
        learnedOn = isoToTime(c.def.done) ?? (review !== null && c.def.interval ? review - c.def.interval * DAY : null);
        if (learnedOn === null && c.learnedVia) learnedOn = refs.find((r) => r.key === c.learnedVia)?.note?.updatedAt ?? null;
      }
      return {
        _id: c.key, concept: c.def.name, stage: c.stage, status: c.mastered ? "mastered" : c.status === "done" ? "learned" : c.status,
        learned: c.status === "done", mastered: c.mastered, reviewDue: c.reviewDue, learnedOn, review, due: isoToTime(c.due), interval: c.def.interval,
        courses: [...new Set(c.coverage.map((x) => x.course.title))],
      };
    });
  } else if (kind === "base") {
    const name = sourceArg(t.source).toLowerCase();
    const bn = d.notes.find((n) => n.type === "base" && n.title.toLowerCase() === name);
    if (!bn) return { recs: [], error: tr("No base called \"{name}\"", { name: sourceArg(t.source) }) };
    const { cfg } = parseBase(bn.body);
    const view = cfg.views.find((v) => v.name.toLowerCase() === (t.view ?? "").toLowerCase()) ?? cfg.views[0];
    const { rows } = runView(d.notes, cfg, { ...view, limit: undefined }, d.ctx, d.propsFor ?? propsOf, { self: bn.id });
    recs = rows.map((r) => noteRecord(r.n, d));
  } else {
    const pf = d.propsFor ?? propsOf;
    recs = d.notes.filter((n) => testFilter(t.filter, n, d.ctx, pf(n))).map((n) => noteRecord(n, d));
    return { recs, error: null }; // the filter already ran with full note semantics
  }
  if (t.filter) recs = recs.filter((r) => testFilterWith(t.filter, (p) => recGet(r, p)));
  return { recs, error: null };
}
/** A record field as a base filter value (booleans → "true"/"false"). */
export function recGet(r: Rec, p: string): Val {
  const k = p.replace(/^(note|file)\./, "");
  let v = r[k] ?? r[canon(p)];
  if (v === undefined) v = null;
  if (typeof v === "boolean") return String(v);
  return v as Val;
}

/** Field names present in records (for the field pickers), with a guessed kind. */
export function fieldsOf(source: string, recs: Rec[]): FieldInfo[] {
  const kind = sourceKind(source);
  const base = SOURCE_FIELDS[kind === "base" ? "notes" : kind].map((f) => ({ ...f, label: tr(f.label) })); // labels in the interface language
  if (kind !== "notes" && kind !== "base") return base;
  const seen = new Map<string, FieldKind>();
  for (const r of recs.slice(0, 500)) for (const [k, v] of Object.entries(r)) {
    if (k === "_id" || base.some((f) => f.name === k) || seen.has(k) || v === null) continue;
    seen.set(k, typeof v === "number" ? "number" : typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? "date" : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? "number" : "category");
  }
  return [...base, ...[...seen].map(([name, k]) => F(name, k, name))];
}

// ------------------------------------------------------------------ ranges and date buckets
export interface Range { start: number; end: number; next: boolean; label: string; n: number; unit: "d" | "w" | "m" | "y" }
/** Parse "12w", "30d", "6m", "1y", "next 14d" (relative to now). "all" / empty → null (no limit). */
export function parseRange(s: string | undefined, now: number): Range | null {
  const m = /^\s*(next\s+|last\s+)?(\d+)\s*(d|w|m|y)\w*\s*$/i.exec(s ?? "");
  if (!m) return null;
  const n = Math.max(1, Number(m[2])), unit = m[3].toLowerCase() as Range["unit"], next = /next/i.test(m[1] ?? "");
  const today = startOfDay(now);
  const shift = (t: number, k: number) => {
    const d = new Date(t);
    if (unit === "d") d.setDate(d.getDate() + k);
    else if (unit === "w") d.setDate(d.getDate() + 7 * k);
    else if (unit === "m") d.setMonth(d.getMonth() + k);
    else d.setFullYear(d.getFullYear() + k);
    return d.getTime();
  };
  const word = { d: "day", w: "week", m: "month", y: "year" }[unit] + (n === 1 ? "" : "s");
  if (next) return { start: today, end: shift(today, n), next, n, unit, label: `next ${n} ${word}` };
  const end = today + DAY;
  return { start: shift(end, -n), end, next, n, unit, label: `last ${n} ${word}` };
}
export function bucketStart(t: number, b: Bucket): number {
  const d = new Date(startOfDay(t));
  if (b === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  if (b === "month") d.setDate(1);
  return d.getTime();
}
const nextBucket = (t: number, b: Bucket) => { const d = new Date(t); if (b === "day") d.setDate(d.getDate() + 1); else if (b === "week") d.setDate(d.getDate() + 7); else d.setMonth(d.getMonth() + 1); return d.getTime(); };
export function bucketLabel(t: number, b: Bucket): string {
  const d = new Date(t);
  if (b === "month") return fmtD(d, d.getMonth() === 0 ? { month: "short", year: "2-digit" } : { month: "short" });
  return fmtD(d, { day: "numeric", month: "short" });
}
export function bucketLong(t: number, b: Bucket): string {
  const d = new Date(t);
  if (b === "month") return fmtD(d, { month: "long", year: "numeric" });
  if (b === "week") return tr("Week of {date}", { date: fmtD(d, { day: "numeric", month: "short", year: "numeric" }) });
  return fmtD(d, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

// ------------------------------------------------------------------ aggregation
export interface Category { key: string; label: string; long: string; start?: number }
export interface Series { key: string; label: string; color: string; values: number[] }
export type Dataset =
  | { kind: "series"; categories: Category[]; series: Series[]; dateX: boolean; xLabel: string; yLabel: string; unit?: string; total: number }
  | { kind: "number"; value: number; prev: number | null; vs: string | null; yLabel: string; unit?: string; sub?: string; better?: "up" | "down"; pct?: boolean }
  | { kind: "ring"; value: number; total: number; yLabel: string; unit?: string }
  | { kind: "rows"; columns: string[]; rows: { id?: string; cells: string[] }[]; total: number };
export interface TileResult { data: Dataset; error: string | null; records: number }

/** Series colors: canvas presets in a fixed order (purple, cyan, orange, green, yellow, red) as CSS variables. */
export const SERIES_ORDER = ["6", "5", "2", "4", "3", "1"];
export const presetVar = (p: string) => `var(--chart-c${p})`;
const STATUS_VAR: Record<string, string> = {
  todo: "var(--muted)", learning: "var(--info)", review: "var(--warning)", mastered: "var(--success)",
  locked: "color-mix(in srgb, var(--muted) 45%, var(--surface-2))", learned: "var(--chart-c5)",
  new: "var(--chart-c6)", relearning: "var(--chart-c1)", suspended: "color-mix(in srgb, var(--muted) 45%, var(--surface-2))",
};
const RANKS: string[][] = [
  [...STATUSES],
  ["locked", "todo", "learning", "learned", "mastered"],
  ["new", "learning", "relearning", "review", "suspended"],
  WEEKDAYS,
];
export const NONE_KEY = "\u0000none";

const aggOf = (t: Tile): Aggregate => t.aggregate ?? (t.y ? "sum" : "count");
function reduce(vals: number[], agg: Aggregate, n: number): number {
  if (agg === "count") return n;
  if (!vals.length) return 0;
  if (agg === "sum") return vals.reduce((a, b) => a + b, 0);
  if (agg === "avg") return vals.reduce((a, b) => a + b, 0) / vals.length;
  return agg === "min" ? Math.min(...vals) : Math.max(...vals);
}
const numOf = (v: RVal | undefined): number | null => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : typeof v === "boolean" ? Number(v) : null);
const timeOf = (v: RVal | undefined): number | null => (typeof v === "number" ? (v > 1e11 ? v : null) : typeof v === "string" ? asTime(v) : null);
const keysOf = (v: RVal | undefined): string[] => (Array.isArray(v) ? (v.length ? v.map(String) : [NONE_KEY]) : v === null || v === undefined || v === "" ? [NONE_KEY] : [String(v)]);

function isDateField(t: Tile, field: string | undefined, recs: Rec[]) {
  if (!field) return false;
  const kind = sourceKind(t.source);
  const known = SOURCE_FIELDS[kind === "base" ? "notes" : kind].find((f) => f.name === field);
  if (known) return known.kind === "date";
  const sample = recs.find((r) => r[field] !== null && r[field] !== undefined)?.[field];
  return timeOf(sample ?? null) !== null;
}

/** Default x / bucket / range for a tile type, used by the editor and when YAML leaves them out. */
export function tileDefaults(t: Tile): { x?: string; bucket?: Bucket; range?: string } {
  const date = defaultDateField(t.source);
  if (t.type === "heatmap") return { x: t.x ?? date, bucket: "day", range: t.range ?? "20w" };
  if (t.type === "number" || t.type === "ring" || t.type === "table" || t.type === "list") return { x: t.x, bucket: t.bucket, range: t.range };
  return { x: t.x ?? (t.type === "donut" ? (sourceKind(t.source) === "cards" ? "state" : "status") : date), bucket: t.bucket, range: t.range };
}

const fmtCell = (v: RVal | undefined, field: string): string => {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "yes" : "no";
  const t = typeof v === "number" && /^(due|dueOn|at|created|updated|lastReview|learnedOn|review)$/.test(field) ? v : null;
  if (t !== null && t > 1e11) return ymd(new Date(t));
  return typeof v === "number" ? fmtNum(v) : String(v);
};
export function fmtNum(v: number, unit?: string): string {
  const s = Math.abs(v) >= 100 || Number.isInteger(v) ? fmtN(Math.round(v), { useGrouping: true }) : fmtN(v, { maximumFractionDigits: 1, useGrouping: true });
  if (unit === "min" && Math.abs(v) >= 60) { const h = Math.floor(v / 60), m = Math.round(v % 60); return m ? tr("{h}h {m}m", { h, m }) : tr("{h}h", { h }); }
  if (unit === "min") return tr("{n} min", { n: s });
  return unit ? `${s} ${unit}` : s;
}
/** Field name → label ("dueOn" → "Due on"); built-in field labels are translated (catalog: lib/dashboard field labels). */
const label = (f: string) => { const x = f.replace(/^(note|file)\./, ""); return tr(x.charAt(0).toUpperCase() + x.slice(1).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()); };

/** Run a tile: source → filter → range → group (x × series) → aggregate. */
export function runTile(tile: Tile, d: DashData): TileResult {
  const { recs: all, error } = sourceRecords(tile, d);
  const t = { ...tile, ...tileDefaults(tile) } as Tile;
  const agg = aggOf(t);
  const yField = t.y;
  const unit = t.unit ?? (sourceKind(t.source) === "sessions" && yField === "minutes" ? "min" : undefined);
  const yl = label(yField ?? "");
  const yLabel = agg === "count" ? (sourceKind(t.source) === "cards" ? tr("Cards") : sourceKind(t.source) === "sessions" ? tr("Sessions") : sourceKind(t.source) === "path" ? tr("Concepts") : tr("Notes"))
    : agg === "avg" ? tr("avg {field}", { field: yl }) : agg === "min" ? tr("min {field}", { field: yl }) : agg === "max" ? tr("max {field}", { field: yl }) : yl;
  const range = parseRange(t.range, d.now);
  const dateField = t.x && isDateField(t, t.x, all) ? t.x : defaultDateField(t.source);
  const inRange = (r: Rec, rg: { start: number; end: number }) => { const tt = timeOf(r[dateField]); return tt !== null && tt >= rg.start && tt < rg.end; };
  const yVals = (rs: Rec[]) => rs.map((r) => numOf(yField ? r[yField] : null)).filter((x): x is number => x !== null);
  const value = (rs: Rec[]) => reduce(yVals(rs), agg, rs.length);

  if (t.type === "number") {
    const cur = range ? all.filter((r) => inRange(r, range)) : all;
    let prev: number | null = null, vs: string | null = null;
    if (range && !range.next && t.delta !== false) {
      const len = range.end - range.start;
      prev = value(all.filter((r) => inRange(r, { start: range.start - len, end: range.start })));
      const u = range.unit === "d" && range.n === 7 ? "w" : range.unit, n = range.n;
      vs = range.n === 1 || (range.unit === "d" && range.n === 7)
        ? (u === "d" ? tr("vs last day") : u === "w" ? tr("vs last week") : u === "m" ? tr("vs last month") : tr("vs last year"))
        : u === "d" ? tr("vs previous {n} days", { n }) : u === "w" ? tr("vs previous {n} weeks", { n }) : u === "m" ? tr("vs previous {n} months", { n }) : tr("vs previous {n} years", { n });
    }
    let sub = t.caption;
    if (sub === undefined && t.filter && agg === "count") {
      // "of 101 in AI Engineer": the filtered count out of the whole source
      const whole = sourceRecords({ source: t.source, view: t.view }, d).recs.length;
      const k = sourceKind(t.source);
      const name = k === "path" ? (sourceArg(t.source).replace(/^path$/i, "") || d.notes.filter((n) => n.type === "path").sort((a, b) => b.updatedAt - a.updatedAt)[0]?.title || "") : k === "base" ? sourceArg(t.source) : k === "cards" ? tr("cards") : k === "sessions" ? tr("sessions") : tr("notes");
      sub = name ? tr("of {n} in {name}", { n: whole, name }) : tr("of {n}", { n: whole });
    }
    return { data: { kind: "number", value: value(cur), prev, vs, yLabel, unit, ...(sub !== undefined ? { sub } : {}), ...(t.better ? { better: t.better } : {}), ...(t.delta === "percent" ? { pct: true } : {}) }, error, records: cur.length };
  }
  if (t.type === "ring") {
    const cur = range ? all.filter((r) => inRange(r, range)) : all;
    const part = t.part ? cur.filter((r) => testFilterWith(t.part, (p) => recGet(r, p))) : cur;
    return { data: { kind: "ring", value: value(part), total: t.target ?? value(cur), yLabel, unit }, error, records: cur.length };
  }
  if ((t.type === "table" || t.type === "list") && (t.fields?.length || !t.x)) {
    const cur = range ? all.filter((r) => inRange(r, range)) : all;
    const kind = sourceKind(t.source);
    const fields = t.fields?.length ? t.fields : t.type === "list"
      ? (kind === "cards" ? ["note", "dueOn"] : kind === "sessions" ? ["note", "minutes"] : kind === "path" ? ["concept", "status"] : ["title", "status"])
      : (kind === "cards" ? ["note", "state", "dueOn"] : kind === "sessions" ? ["at", "course", "minutes"] : kind === "path" ? ["concept", "stage", "status"] : ["title", "status", "space", "updated"]);
    const s = t.sort ?? (kind === "sessions" ? "-at" : kind === "cards" ? "dueOn" : kind === "path" ? "" : "-updated");
    const sf = s.replace(/^-/, ""), desc = s.startsWith("-");
    const rows = sf ? [...cur].sort((a, b) => {
      const av = a[sf], bv = b[sf];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const na = numOf(av), nb = numOf(bv);
      const c = na !== null && nb !== null ? na - nb : natural(String(av), String(bv));
      return desc ? -c : c;
    }) : cur;
    const lim = t.limit ?? (t.type === "list" ? 8 : 10);
    return { data: { kind: "rows", columns: fields.map(label), rows: rows.slice(0, lim).map((r) => ({ id: typeof r._id === "string" ? r._id : undefined, cells: fields.map((f) => fmtCell(r[f], f)) })), total: cur.length }, error, records: cur.length };
  }

  // ---- series dataset: categories (x) × series
  const xField = t.x ?? dateField;
  const dateX = isDateField(t, xField, all);
  const bucket: Bucket = t.bucket ?? (t.type === "heatmap" ? "day" : range && (range.unit === "d" && range.n <= 31) ? "day" : range && range.unit === "y" ? "month" : "week");
  let recs = all;
  if (dateX && range) recs = all.filter((r) => { const tt = timeOf(r[xField]); return tt !== null && tt >= range.start && tt < range.end; });
  else if (range) recs = all.filter((r) => inRange(r, range));
  let categories: Category[] = [];
  const catOf = new Map<string, number>();
  if (dateX) {
    const times = recs.map((r) => timeOf(r[xField])).filter((x): x is number => x !== null);
    let lo = range ? range.start : times.length ? Math.min(...times) : null;
    let hi = range ? range.end - 1 : times.length ? Math.max(...times) : null;
    if (lo !== null && hi !== null) {
      lo = bucketStart(lo, bucket); hi = bucketStart(hi, bucket);
      for (let b = lo, guard = 0; b <= hi && guard < 800; b = nextBucket(b, bucket), guard++) {
        const key = ymd(new Date(b));
        catOf.set(key, categories.length);
        categories.push({ key, label: bucketLabel(b, bucket), long: bucketLong(b, bucket), start: b });
      }
    }
  } else {
    const counts = new Map<string, number>();
    for (const r of recs) for (const k of keysOf(r[xField])) counts.set(k, (counts.get(k) ?? 0) + 1);
    let keys = [...counts.keys()];
    const rank = RANKS.find((rk) => keys.every((k) => k === NONE_KEY || rk.includes(k)));
    keys.sort((a, b) => (a === NONE_KEY ? 1 : b === NONE_KEY ? -1 : rank ? rank.indexOf(a) - rank.indexOf(b) : (counts.get(b)! - counts.get(a)!) || natural(a, b)));
    if (t.sort === "label") keys.sort((a, b) => natural(a, b));
    const lim = t.limit ?? (t.type === "donut" ? 6 : 12);
    const other = keys.length > lim ? keys.slice(lim - 1) : [];
    if (other.length) keys = [...keys.slice(0, lim - 1), "\u0000other"];
    keys.forEach((k, i) => { catOf.set(k, i); categories.push({ key: k, label: k === NONE_KEY ? tr("No {prop}", { prop: label(xField).toLowerCase() }) : k === "\u0000other" ? tr("Other") : k, long: k === NONE_KEY ? tr("No {prop}", { prop: label(xField).toLowerCase() }) : k === "\u0000other" ? tr("Other ({n})", { n: other.length }) : k }); });
    for (const k of other) catOf.set(k, keys.length - 1);
  }
  // series keys
  const sKeys: string[] = [];
  if (t.series) {
    const sc = new Map<string, number>();
    for (const r of recs) for (const k of keysOf(r[t.series])) sc.set(k, (sc.get(k) ?? 0) + 1);
    sKeys.push(...[...sc.keys()].sort((a, b) => (a === NONE_KEY ? 1 : b === NONE_KEY ? -1 : (sc.get(b)! - sc.get(a)!) || natural(a, b))));
  } else sKeys.push("");
  const MAXS = 6;
  const sIndex = new Map<string, number>();
  sKeys.forEach((k, i) => sIndex.set(k, Math.min(i, MAXS - 1)));
  const sList = sKeys.slice(0, MAXS).map((k, i) => (i === MAXS - 1 && sKeys.length > MAXS ? "\u0000other" : k));
  // bins
  const bins = sList.map(() => categories.map(() => [] as Rec[]));
  for (const r of recs) {
    let ci: number[] = [];
    if (dateX) { const tt = timeOf(r[xField]); if (tt !== null) { const i = catOf.get(ymd(new Date(bucketStart(tt, bucket)))); if (i !== undefined) ci = [i]; } }
    else ci = [...new Set(keysOf(r[xField]).map((k) => catOf.get(k)).filter((x): x is number => x !== undefined))];
    const si = t.series ? [...new Set(keysOf(r[t.series]).map((k) => sIndex.get(k)!))] : [0];
    for (const c of ci) for (const s of si) bins[s][c].push(r);
  }
  const spaceColor = new Map(d.spaces.filter((s) => s.color && /^[1-6]$/.test(s.color)).map((s) => [s.name, presetVar(s.color!)]));
  const used = new Set<string>();
  const colorFor = (key: string, i: number): string => {
    const explicit = t.colors?.[key];
    if (explicit) return /^[1-6]$/.test(explicit) ? presetVar(explicit) : explicit;
    if (STATUS_VAR[key] && (t.series === "status" || t.series === "state" || (!t.series && (xField === "status" || xField === "state")))) return STATUS_VAR[key];
    if (spaceColor.has(key) && (t.series === "course" || t.series === "space" || t.series === "courses")) { const c = spaceColor.get(key)!; if (!used.has(c)) { used.add(c); return c; } }
    for (const p of SERIES_ORDER) { const c = presetVar(p); if (!used.has(c)) { used.add(c); return c; } }
    return presetVar(SERIES_ORDER[i % SERIES_ORDER.length]);
  };
  let carry = sList.map(() => 0);
  if (t.cumulative && dateX && categories[0]?.start !== undefined) {
    // running totals start from everything before the first bucket
    const first = categories[0].start!;
    carry = sList.map((sk, si) => value(all.filter((r) => { const tt = timeOf(r[xField]); return tt !== null && tt < first && (!t.series || keysOf(r[t.series]).some((k) => sIndex.get(k) === si)); })));
    void sKeys;
  }
  // donut / single series over categories: slice colors per category
  const series: Series[] = sList.map((sk, si) => {
    let values = bins[si].map((rs) => value(rs));
    if (t.cumulative) { let acc = carry[si]; values = values.map((v) => (acc += v)); }
    const lbl = sk === "" ? yLabel : sk === NONE_KEY ? tr("No {prop}", { prop: label(t.series ?? "").toLowerCase() }) : sk === "\u0000other" ? tr("Other") : sk;
    return { key: sk || "value", label: lbl, color: "", values };
  });
  if (t.type === "donut" && !t.series) series[0].color = "";
  else series.forEach((s, i) => { s.color = colorFor(s.key, i); });
  const total = series.reduce((a, s) => a + s.values.reduce((x, y) => x + y, 0), 0);
  return { data: { kind: "series", categories, series, dateX, xLabel: label(xField), yLabel, unit, total }, error, records: recs.length };
}

/** Colors for donut slices / single-series categories (status-aware, then the preset order). */
export function categoryColors(t: Tile, cats: Category[], d: Pick<DashData, "spaces">): string[] {
  const spaceColor = new Map(d.spaces.filter((s) => s.color && /^[1-6]$/.test(s.color)).map((s) => [s.name, presetVar(s.color!)]));
  const x = t.x ?? "";
  let i = 0;
  const used = new Set<string>();
  return cats.map((c) => {
    const explicit = t.colors?.[c.key];
    if (explicit) return /^[1-6]$/.test(explicit) ? presetVar(explicit) : explicit;
    if (c.key === "\u0000other" || c.key === NONE_KEY) return "color-mix(in srgb, var(--muted) 45%, var(--surface-2))";
    if (STATUS_VAR[c.key] && /^(status|state)$/.test(x)) return STATUS_VAR[c.key];
    if (spaceColor.has(c.key) && /^(course|space|courses)$/.test(x) && !used.has(spaceColor.get(c.key)!)) { used.add(spaceColor.get(c.key)!); return spaceColor.get(c.key)!; }
    while (i < 12) { const col = presetVar(SERIES_ORDER[i++ % 6]); if (!used.has(col) || i > 6) { used.add(col); return col; } }
    return presetVar("6");
  });
}

/** Data table form of any dataset (the accessibility toggle, and the table tile with x). */
export function datasetTable(ds: Dataset): { columns: string[]; rows: string[][] } {
  if (ds.kind === "rows") return { columns: ds.columns, rows: ds.rows.map((r) => r.cells) };
  if (ds.kind === "number") return { columns: [ds.yLabel, tr("Previous period")], rows: [[fmtNum(ds.value, ds.unit), ds.prev === null ? "" : fmtNum(ds.prev, ds.unit)]] };
  if (ds.kind === "ring") return { columns: [ds.yLabel, tr("Total"), tr("Share@@proportion")], rows: [[fmtNum(ds.value, ds.unit), fmtNum(ds.total, ds.unit), ds.total ? tr("{n}%", { n: Math.round((ds.value / ds.total) * 100) }) : ""]] };
  return { columns: [ds.xLabel, ...ds.series.map((s) => s.label)], rows: ds.categories.map((c, i) => [c.long, ...ds.series.map((s) => fmtNum(s.values[i] ?? 0, ds.unit))]) };
}

/** "Nice" axis ticks from 0 to ≥ max. */
export function niceTicks(max: number, count = 4, integer = false): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  if (integer) step = Math.max(1, step === 2.5 * p ? 5 * p : Math.ceil(step)); // counts: whole-number ticks
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1] < max) out.push(Math.round((out[out.length - 1] + step) * 1e6) / 1e6);
  return out;
}
