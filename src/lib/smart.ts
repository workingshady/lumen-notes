/**
 * Smart folders = saved searches (design update 04 §D7). Pure logic, no React. Format: docs/SMART_FOLDERS.md.
 *
 * Stored as JSON in the Inbox space record, `space.props.lumenSmartFolders` (synced like any space edit, so every
 * device sees the same list). A smart folder is a query string using the search operators (`tag:` `type:` `status:`
 * `in:` `space:` `is:` + free text) plus a few smart-only ones (`due:` `has:` `no:` `updated:` `created:`), and
 * optional Bases filter rows (same expression syntax as a base, see docs/BASES.md).
 */
import type { Folder, Note, Space } from "../../shared/types";
import { serializeBase, testFilter, type Ctx, type FilterNode } from "./base";
import { matcher, normalize, parseQuery, type Query } from "./search";
import { t } from "./i18n";

export interface SmartFolder {
  id: string;
  name: string;
  /** Search query, e.g. `tag:#llm status:learning` or `type:lesson due:week`. */
  query: string;
  /** Optional Bases-style filter expressions (`due < today()`, `file.hasTag("ml")`), combined with `match`. */
  filters?: string[];
  match?: "and" | "or";
  /** Glyph key (see GLYPHS) and colour preset key / CSS colour. */
  glyph?: string;
  color?: string | null;
  pinned?: boolean;
  sort: number;
}

export const SMART_SPACE = "inbox";
export const SMART_PROP = "lumenSmartFolders";
/** Glyph picker (LumenGlyph names, src/lib/glyphs.ts). */
export const GLYPHS = ["smart-folder", "due", "s-learning", "s-revise", "s-todo", "pdf", "flashcards", "lesson", "k-video", "tag", "query", "inbox", "flame", "clock", "highlight", "p1"] as const;
export type Glyph = (typeof GLYPHS)[number];
/** Glyph keys stored before round 4 (Lucide icons) → their LumenGlyph equivalent. */
const LEGACY_GLYPH: Record<string, Glyph> = { search: "smart-folder", star: "flame", book: "lesson", flag: "p1", clock: "clock", file: "pdf", tag: "tag", bolt: "flame", inbox: "inbox", layers: "flashcards" };
/** The LumenGlyph name to draw for a stored glyph key (old keys map, unknown ones fall back to the folder glyph). */
export const glyphName = (g?: string | null): Glyph => (g && (GLYPHS as readonly string[]).includes(g) ? (g as Glyph) : (g && LEGACY_GLYPH[g]) || "smart-folder");
/** Operators offered as chips in the editor (click inserts one). */
export const OPERATOR_CHIPS = ["tag:#x", "type:lesson", "status:learning", "in:folder", "space:", "due:this-week", "has:pdf", "-has:links", "course:", '"exact words"'] as const;

// ------------------------------------------------------------------ storage
export function readSmart(raw: string | undefined | null): SmartFolder[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is SmartFolder => !!x && typeof x === "object" && typeof (x as SmartFolder).id === "string" && typeof (x as SmartFolder).query === "string")
      .map((x, i) => ({ ...x, name: String(x.name || t("Smart folder")), sort: Number.isFinite(x.sort) ? x.sort : i, filters: Array.isArray(x.filters) ? x.filters.filter((f) => typeof f === "string" && f.trim()) : undefined }));
  } catch { return []; }
}
export const serializeSmart = (list: SmartFolder[]) => JSON.stringify(list.map(({ id, name, query, filters, match, glyph, color, pinned, sort }) => ({ id, name, query, ...(filters?.length ? { filters } : {}), ...(match === "or" ? { match } : {}), ...(glyph ? { glyph } : {}), ...(color ? { color } : {}), ...(pinned ? { pinned } : {}), sort })));
/** Display order: pinned first, then by `sort`. */
export const orderSmart = (list: SmartFolder[]) => [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || a.sort - b.sort || a.name.localeCompare(b.name));
export const newSmartId = () => "sf-" + Math.random().toString(36).slice(2, 10);
export function upsertSmart(list: SmartFolder[], sf: Omit<SmartFolder, "sort"> & { sort?: number }): SmartFolder[] {
  const i = list.findIndex((x) => x.id === sf.id);
  if (i >= 0) return list.map((x, j) => (j === i ? { ...x, ...sf, sort: sf.sort ?? x.sort } : x));
  return [...list, { ...sf, sort: sf.sort ?? Math.max(-1, ...list.map((x) => x.sort)) + 1 }];
}
export const removeSmart = (list: SmartFolder[], id: string) => list.filter((x) => x.id !== id);
/** Move one step up (-1) or down (+1) in display order; renumbers `sort` 0..n. */
export function moveSmart(list: SmartFolder[], id: string, dir: -1 | 1): SmartFolder[] {
  const o = orderSmart(list);
  const i = o.findIndex((x) => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= o.length || !!o[i].pinned !== !!o[j].pinned) return list;
  [o[i], o[j]] = [o[j], o[i]];
  return o.map((x, k) => ({ ...x, sort: k }));
}
/**
 * Drag reorder: move `id` to display position `to` (0-based, in the list without the dragged folder). Dropping into
 * the pinned group pins it, below it unpins it. Renumbers `sort` 0..n.
 */
export function reorderSmart(list: SmartFolder[], id: string, to: number): SmartFolder[] {
  const o = orderSmart(list);
  const sf = o.find((x) => x.id === id);
  if (!sf) return list;
  const rest = o.filter((x) => x.id !== id);
  to = Math.max(0, Math.min(rest.length, to));
  const above = rest[to - 1], below = rest[to];
  const pinned = above?.pinned && below?.pinned ? true : !above?.pinned && !below?.pinned ? false : above?.pinned ? !!sf.pinned : !!sf.pinned;
  rest.splice(to, 0, { ...sf, pinned: pinned || undefined });
  return orderSmart(rest.map((x, k) => ({ ...x, sort: k })));
}
/** A default name from a query: `tag:#llm status:learning` → "#llm · learning". */
export function suggestName(q: string) {
  const words = smartTokens(q.trim()).map((tok) => {
    const m = /^(-?)(tag|type|status|in|space|is|due|has|no|updated|created|course):"?([^"]*)"?$/.exec(tok);
    if (!m) return tok.replace(/^"|"$/g, "");
    const v = m[2] === "tag" ? "#" + m[3].replace(/^#/, "") : m[3].replace(/^this-/, "");
    return m[1] ? t("not {value}", { value: v }) : v;
  });
  const s = words.filter(Boolean).join(" · ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : t("Smart folder");
}

// ------------------------------------------------------------------ query
export interface SmartQuery {
  base: Query; due: string[]; has: string[]; no: string[]; updated: string[]; created: string[];
  /** `course:CS231n`: the note's `course` property contains the text. */
  course: string[];
  /** `"exact words"`: the phrase appears (normalized) in the title or body. */
  phrases: string[];
  /** Negated operators (`-status:done`, `-has:links`, `-tag:#x`, `-#x`), each kept as its own query without the `-`. */
  not: string[];
}
const EXTRA = /^(due|has|no|updated|created|course):"?([^"]*)"?$/i;
/** `due:this-week` (the designed spelling) → `week`; `this-month` → `month`. */
const DUE_ALIAS: Record<string, string> = { "this-week": "week", "next-7-days": "week", "this-month": "month", "next-30-days": "month" };
/** Query tokens: `op:"quoted value"`, `"exact phrase"`, or a run of non-spaces. */
export const smartTokens = (q: string) => q.match(/(-?\w+:"[^"]*"|"[^"]*"|\S+)/g) ?? [];
export function parseSmartQuery(q: string): SmartQuery {
  const out: SmartQuery = { base: parseQuery(""), due: [], has: [], no: [], updated: [], created: [], course: [], phrases: [], not: [] };
  const rest: string[] = [];
  for (const tok of smartTokens(q)) {
    if (/^-(\w+:\S|#\S)/.test(tok)) { out.not.push(tok.slice(1)); continue; }
    const ph = /^"([^"]+)"$/.exec(tok);
    if (ph) { if (ph[1].trim()) out.phrases.push(normalize(ph[1].trim()).replace(/\s+/g, " ")); continue; }
    const m = EXTRA.exec(tok);
    if (m && m[2]) { const k = m[1].toLowerCase() as "due"; let v = m[2].toLowerCase(); if (k === "due") v = DUE_ALIAS[v] ?? v; out[k].push(v); } else rest.push(tok);
  }
  out.base = parseQuery(rest.join(" "));
  return out;
}

export interface SmartCtx {
  folderMap: Map<string, Folder>;
  spaceMap: Map<string, Space>;
  outlinks: Map<string, string[]>;
  backlinks: Map<string, string[]>;
  /** Front-matter + record props (cache it: the caller has noteDerived). */
  props: (n: Note) => Record<string, string>;
  /** Normalized searchable text (title + body), cached by the caller. */
  text: (n: Note) => string;
  base: Ctx;
  /** Clock for date operators (demo mode pins it). */
  now?: number;
}

const DAY = 86400000;
const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const parseDay = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim()); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null; };
/** `7d` `2w` `3m` → ms. */
const span = (s: string) => { const m = /^(\d+)([dwm])$/.exec(s); return m ? +m[1] * DAY * (m[2] === "w" ? 7 : m[2] === "m" ? 30 : 1) : null; };

function dueOk(op: string, raw: string | undefined, now: number): boolean {
  const today = dayStart(now);
  const t = raw ? parseDay(raw) : null;
  if (op === "none") return t === null;
  if (op === "any") return t !== null;
  if (t === null) return false;
  if (op === "overdue") return t < today;
  if (op === "today") return t === today;
  if (op === "week") return t >= today && t < today + 7 * DAY;
  if (op === "month") return t >= today && t < today + 31 * DAY;
  const m = /^(<=|>=|<|>|=)?(\d{4}-\d{2}-\d{2})$/.exec(op);
  if (!m) return true; // unknown value: never hides notes
  const d = parseDay(m[2])!;
  return ({ "<": t < d, "<=": t <= d, ">": t > d, ">=": t >= d, "=": t === d } as Record<string, boolean>)[m[1] ?? "="];
}
/** `updated:7d` (= within the last 7 days, same as `<7d`), `updated:>30d` (older than 30 days). */
function ageOk(op: string, t: number, now: number): boolean {
  const m = /^(<|>)?(.+)$/.exec(op)!;
  const ms = span(m[2]);
  if (ms === null) return true;
  return m[1] === ">" ? now - t > ms : now - t <= ms;
}
const hasTasks = (body: string) => /^\s*[-*+]\s+\[[ /]\]\s/m.test(body);
function hasOk(key: string, n: Note, c: SmartCtx): boolean {
  if (key === "links") return (c.outlinks.get(n.id)?.length ?? 0) > 0;
  if (key === "backlinks") return (c.backlinks.get(n.id)?.length ?? 0) > 0;
  if (key === "tasks") return hasTasks(n.body);
  if (key === "tags") return n.tags.length > 0;
  if (key === "status") return !!n.status;
  // has:pdf = a PDF note or a note that embeds/links a PDF; has:video = the note has a player (video-notes.ts rules)
  if (key === "pdf") return n.type === "pdf" || /\.pdf(\)|\]|\s|$|\?|#)/im.test(n.body) || !!c.props(n).pdf;
  if (key === "video") return /^\s*(https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be|vimeo\.com)\S*|!\[[^\]]*\.(mp4|webm|mov|m4v)\]\([^)]*\)|\S+\.(mp4|webm|mov|m4v))\s*$/im.test(n.body);
  const v = c.props(n)[key];
  return v !== undefined && v.trim() !== "" && v.trim() !== "[]";
}

/** Predicate for a smart folder over the given context. */
export function smartMatcher(sf: Pick<SmartFolder, "query" | "filters" | "match">, c: SmartCtx): (n: Note) => boolean {
  const q = parseSmartQuery(sf.query);
  const base = matcher(q.base, c.folderMap, c.spaceMap);
  const terms = normalize(q.base.text).split(/\s+/).filter(Boolean);
  const now = c.now ?? Date.now();
  const filters: FilterNode | undefined = sf.filters?.length ? (sf.match === "or" ? { or: sf.filters } : { and: sf.filters }) : undefined;
  const nots = q.not.map((tok) => smartMatcher({ query: tok }, c));
  const courses = q.course.map(normalize);
  return (n) => {
    if (n.deleted || !base(n)) return false;
    if (nots.some((f) => f(n))) return false;
    if (courses.length) { const cv = normalize(c.props(n).course ?? ""); if (!courses.every((x) => cv.includes(x))) return false; }
    if (q.phrases.length) { const t = c.text(n).replace(/\s+/g, " "); if (!q.phrases.every((x) => t.includes(x))) return false; }
    if (q.due.length) { const p = c.props(n); if (!q.due.every((op) => dueOk(op, p.due ?? p.deadline, now))) return false; }
    if (!q.has.every((k) => hasOk(k, n, c)) || !q.no.every((k) => !hasOk(k, n, c))) return false;
    if (!q.updated.every((op) => ageOk(op, n.updatedAt, now)) || !q.created.every((op) => ageOk(op, n.createdAt, now))) return false;
    if (terms.length) { const t = c.text(n); if (!terms.every((x) => t.includes(x))) return false; }
    if (filters && !testFilter(filters, n, c.base, c.props(n))) return false;
    return true;
  };
}
export const smartNotes = (notes: Note[], sf: Pick<SmartFolder, "query" | "filters" | "match">, c: SmartCtx) => notes.filter(smartMatcher(sf, c));
/** Text a note is searched by (normalize once and cache per note version). */
export const searchText = (n: Note) => normalize(`${n.title}\n${n.type === "canvas" || n.type === "whiteboard" ? "" : n.body}`);

// ------------------------------------------------------------------ "Save as base"
const js = (s: string) => JSON.stringify(s);
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
/**
 * Base filters equivalent to a smart folder (as far as Bases can express it). Returns the filter tree plus the parts
 * that have no Bases equivalent (`is:` flags, has:/no: links/backlinks/tasks), which the caller reports.
 * Free text becomes `file.name.contains(...)` (title only: Bases have no full-text filter). Relative dates
 * (`due:week`, `updated:7d`) are written as fixed dates from `now`.
 */
export function toBaseFilters(sf: Pick<SmartFolder, "query" | "filters" | "match">, now = Date.now()): { filters: FilterNode | undefined; dropped: string[] } {
  const q = parseSmartQuery(sf.query);
  const and: FilterNode[] = [];
  const dropped: string[] = [];
  const anyOf = (xs: string[]) => (xs.length === 1 ? xs[0] : { or: xs });
  if (q.base.tags.length) for (const t of q.base.tags) and.push(`file.hasTag(${js(t)})`);
  if (q.base.types.length) and.push(anyOf(q.base.types.map((t) => `type == ${js(t)}`)));
  if (q.base.statuses.length) and.push(anyOf(q.base.statuses.map((s) => (s === "none" ? "status.isEmpty()" : `status == ${js(s)}`))));
  if (q.base.folders.length) and.push(anyOf(q.base.folders.map((f) => `file.folder.contains(${js(f)})`)));
  if (q.base.spaces.length) and.push(anyOf(q.base.spaces.map((s) => `space.contains(${js(s)})`)));
  for (const i of q.base.is) dropped.push(`is:${i}`);
  for (const w of q.base.text.split(/\s+/).filter(Boolean)) and.push(`file.name.contains(${js(w)})`);
  const today = dayStart(now);
  for (const op of q.due) {
    if (op === "overdue") and.push("due < today()");
    else if (op === "today") and.push("due == today()");
    else if (op === "week" || op === "month") { and.push("due >= today()"); and.push(`due < date(${js(ymd(today + (op === "week" ? 7 : 31) * DAY))})`); }
    else if (op === "none") and.push("due.isEmpty()");
    else if (op === "any") and.push("!due.isEmpty()");
    else { const m = /^(<=|>=|<|>|=)?(\d{4}-\d{2}-\d{2})$/.exec(op); if (m) and.push(`due ${m[1] === "=" || !m[1] ? "==" : m[1]} date(${js(m[2])})`); else dropped.push(`due:${op}`); }
  }
  const special = ["links", "backlinks", "tasks", "pdf", "video"];
  for (const k of q.has) { if (special.includes(k)) dropped.push(`has:${k}`); else and.push(k === "tags" ? "!file.tags.isEmpty()" : `!${k}.isEmpty()`); }
  for (const k of q.no) { if (special.includes(k)) dropped.push(`no:${k}`); else and.push(k === "tags" ? "file.tags.isEmpty()" : `${k}.isEmpty()`); }
  for (const [key, ops] of [["file.mtime", q.updated], ["file.ctime", q.created]] as const) {
    for (const op of ops) {
      const m = /^(<|>)?(\d+[dwm])$/.exec(op);
      const ms = m ? span(m[2]) : null;
      if (!m || ms === null) { dropped.push(op); continue; }
      and.push(`${key} ${m[1] === ">" ? "<" : ">="} date(${js(ymd(now - ms))})`);
    }
  }
  for (const c of q.course) and.push(`course.contains(${js(c)})`);
  for (const ph of q.phrases) and.push(`file.name.contains(${js(ph)})`);
  for (const tok of q.not) {
    const m = /^(tag|type|status|has|no):"?#?([^"]*)"?$/.exec(tok) ?? (tok.startsWith("#") ? ["", "tag", tok.slice(1)] : null);
    const v = m?.[2].toLowerCase() ?? "";
    if (!m || !v) { dropped.push("-" + tok); continue; }
    if (m[1] === "tag") and.push(`!file.hasTag(${js(v)})`);
    else if (m[1] === "type") and.push(`type != ${js(v)}`);
    else if (m[1] === "status") and.push(v === "none" ? "!status.isEmpty()" : `status != ${js(v)}`);
    else if (special.includes(v) || v === "pdf" || v === "video") dropped.push("-" + tok);
    else if (m[1] === "has") and.push(v === "tags" ? "file.tags.isEmpty()" : `${v}.isEmpty()`);
    else and.push(v === "tags" ? "!file.tags.isEmpty()" : `!${v}.isEmpty()`);
  }
  if (sf.filters?.length) and.push(sf.match === "or" ? { or: sf.filters } : { and: sf.filters });
  return { filters: and.length ? { and } : undefined, dropped };
}

/** Body of a new base note (type: base) for a smart folder. */
export function toBaseNote(sf: Pick<SmartFolder, "name" | "query" | "filters" | "match">, now = Date.now()): { body: string; dropped: string[] } {
  const { filters, dropped } = toBaseFilters(sf, now);
  const yaml = serializeBase({ ...(filters ? { filters } : {}), views: [{ type: "table", name: "Table", order: ["file.name", "type", "status", "tags", "file.mtime"] }] }).replace(/\n$/, "");
  const note = `Saved from the smart folder query \`${sf.query.replace(/`/g, "")}\`.` + (dropped.length ? ` Not expressible as base filters: ${dropped.join(", ")}.` : "");
  return { body: `---\ntype: base\n---\n# ${sf.name}\n\n${note}\n\n\`\`\`base\n${yaml}\n\`\`\`\n`, dropped };
}
