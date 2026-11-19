// Bases: database views of notes (Obsidian Bases compatible subset). Pure logic, no React.
//
// A base note (type "base") keeps its definition as YAML in a fenced ```base block (or as the whole body after the
// front-matter / H1). The YAML is the same shape as an Obsidian `.base` file:
//
//   filters:                       # global, every view (string, or and: / or: / not: lists, nestable)
//     and:
//       - type == "lesson"
//       - file.hasTag("ml")
//   views:
//     - type: table                # table | cards | list | board | calendar
//       name: All lessons
//       filters: …                 # per-view filters (same syntax)
//       order: [file.name, status, space, file.tags, file.mtime]   # visible columns / card fields, in order
//       sort: [{ property: file.mtime, direction: DESC }]
//       groupBy: { property: status, direction: ASC }
//       limit: 50
//       columnSize: { file.name: 260 }
//       date: due                  # Lumen: calendar view date property (default file.ctime)
//       groupMulti: each           # Lumen: a note whose group property has several values shows in each group
//                                  # (each, default) or only under its first value (first)
//
// Properties: file.name (title), file.ctime / file.mtime (created / updated), file.tags, file.folder, plus Lumen's
// record fields type, status, space, folder, and any front-matter key (bare or as note.<key>).
// Filter expressions: `prop == value` (!= > >= < <=), `prop.contains("x")`, `prop.isEmpty()`, `prop.startsWith("x")`,
// `file.hasTag("a", "b")`, `file.inFolder("x")`, `file.hasProperty("k")`, any of them negated with a leading `!`.
// Values: "text", 'text', numbers, true/false, today(), now(), date("2026-11-13"). Unknown keys (formulas, summaries,
// properties…) are kept untouched when Lumen rewrites the block.
import type { Note, NoteType, Status } from "../../shared/types";
import { NOTE_TYPES, STATUSES } from "../../shared/types";
import { natural, splitFrontMatter } from "./parse";

// ------------------------------------------------------------------ tiny YAML (the subset .base files use)
type Y = string | number | boolean | null | Y[] | { [k: string]: Y };
export type YMap = { [k: string]: Y };

interface Line { ind: number; text: string }

/** Strip a trailing `# comment` that is outside quotes. */
function stripComment(s: string) {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}

/** Split on top-level commas (outside quotes and brackets). */
function splitTop(s: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0, q: string | null = null, cur = "";
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === "[" || c === "{" || c === "(") depth++;
    else if (c === "]" || c === "}" || c === ")") depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim() || out.length) out.push(cur);
  return out.map((x) => x.trim());
}

/** Index of the `key: ` colon (outside quotes), or -1. */
function keyColon(s: string) {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if ((c === '"' || c === "'") && i === 0) { q = c; continue; }
    if (c === "[" || c === "{") return -1;
    if (c === ":" && (i === s.length - 1 || s[i + 1] === " ")) return i;
  }
  return -1;
}
const unquoteKey = (k: string) => k.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");

function scalar(raw: string): Y {
  const s = raw.trim();
  if (s === "" || s === "~" || s === "null") return null;
  if (s.startsWith('"')) { try { return JSON.parse(s) as string; } catch { return s.slice(1, -1); } }
  if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith("[") && s.endsWith("]")) return s.slice(1, -1).trim() ? splitTop(s.slice(1, -1)).map(scalar) : [];
  if (s.startsWith("{") && s.endsWith("}")) {
    const o: YMap = {};
    for (const part of s.slice(1, -1).trim() ? splitTop(s.slice(1, -1)) : []) {
      const i = keyColon(part);
      if (i > 0) o[unquoteKey(part.slice(0, i))] = scalar(part.slice(i + 1));
    }
    return o;
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

export function parseYaml(text: string): Y {
  const lines: Line[] = [];
  for (const raw of text.replace(/\t/g, "  ").split(/\r?\n/)) {
    const t = stripComment(raw);
    if (!t.trim() || t.trim() === "---") continue;
    lines.push({ ind: t.length - t.trimStart().length, text: t.trim() });
  }
  let i = 0;
  const block = (ind: number): Y => {
    if (i >= lines.length) return null;
    return lines[i].text.startsWith("- ") || lines[i].text === "-" ? list(lines[i].ind) : map(ind);
  };
  // value after "key:" — inline scalar, a block scalar (| >), or a nested block on the next lines
  const valueAfter = (rest: string, ind: number): Y => {
    if (rest === "|" || rest === ">" || rest === "|-" || rest === ">-") {
      const out: string[] = [];
      while (i < lines.length && lines[i].ind > ind) out.push(lines[i++].text);
      return out.join(rest.startsWith("|") ? "\n" : " ");
    }
    if (rest !== "") return scalar(rest);
    if (i < lines.length && (lines[i].ind > ind || (lines[i].ind === ind && lines[i].text.startsWith("-")))) return block(lines[i].ind);
    return null;
  };
  function map(ind: number): YMap {
    const o: YMap = {};
    while (i < lines.length && lines[i].ind === ind && !lines[i].text.startsWith("- ")) {
      const { text } = lines[i];
      const c = keyColon(text);
      i++;
      if (c < 0) continue; // not a key line: skip it
      o[unquoteKey(text.slice(0, c))] = valueAfter(text.slice(c + 1).trim(), ind);
    }
    return o;
  }
  function list(ind: number): Y[] {
    const a: Y[] = [];
    while (i < lines.length && lines[i].ind === ind && (lines[i].text.startsWith("- ") || lines[i].text === "-")) {
      const rest = lines[i].text.slice(1).trim();
      const itemInd = ind + (lines[i].text.length - lines[i].text.slice(1).trimStart().length);
      if (rest === "") { i++; a.push(i < lines.length && lines[i].ind > ind ? block(lines[i].ind) : null); continue; }
      const c = keyColon(rest);
      if (c > 0 && !/^["'[{]/.test(rest)) {
        // "- key: value" starts a map whose keys sit at the item's text column
        lines[i] = { ind: itemInd, text: rest };
        a.push(map(itemInd));
      } else { i++; a.push(scalar(rest)); }
    }
    return a;
  }
  return lines.length ? block(lines[0].ind) : null;
}

const PLAIN = /^[^\s\-?:,[\]{}#&*!|>'"%@`][^#]*$/;
function yScalar(v: Y): string {
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  const ambiguous = s === "" || /^(true|false|null|~|-?\d+(\.\d+)?)$/.test(s) || /:\s|:$|\s$/.test(s) || !PLAIN.test(s);
  if (!ambiguous) return s;
  if (!s.includes("'") && !s.includes("\n")) return `'${s}'`;
  return JSON.stringify(s);
}
export function toYaml(v: Y, ind = 0): string {
  const pad = " ".repeat(ind);
  if (Array.isArray(v)) {
    if (!v.length) return `${pad}[]\n`;
    return v.map((x) => {
      if (x && typeof x === "object" && !Array.isArray(x)) {
        const inner = toYaml(x, ind + 2);
        return `${pad}- ${inner.slice(ind + 2)}`;
      }
      if (Array.isArray(x)) return `${pad}-\n${toYaml(x, ind + 2)}`;
      return `${pad}- ${yScalar(x)}\n`;
    }).join("");
  }
  if (v && typeof v === "object") {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);
    if (!keys.length) return `${pad}{}\n`;
    return keys.map((k) => {
      const x = v[k];
      const key = /^[\w.\-\u0080-￿]+$/.test(k) ? k : JSON.stringify(k);
      if (Array.isArray(x)) return x.length ? `${pad}${key}:\n${toYaml(x, ind + 2)}` : `${pad}${key}: []\n`;
      if (x && typeof x === "object") return Object.keys(x).length ? `${pad}${key}:\n${toYaml(x, ind + 2)}` : `${pad}${key}: {}\n`;
      return `${pad}${key}: ${yScalar(x)}\n`;
    }).join("");
  }
  return `${pad}${yScalar(v)}\n`;
}

// ------------------------------------------------------------------ the base definition inside a note body
export type ViewType = "table" | "cards" | "list" | "board" | "calendar";
export const VIEW_TYPES: ViewType[] = ["table", "board", "cards", "list", "calendar"];
export type FilterNode = string | { and?: FilterNode[]; or?: FilterNode[]; not?: FilterNode[] };
export interface SortRule { property: string; direction: "ASC" | "DESC" }
export interface BaseViewDef {
  type: ViewType; name: string;
  filters?: FilterNode; order?: string[]; sort?: SortRule[]; groupBy?: SortRule; limit?: number;
  columnSize?: Record<string, number>; date?: string;
  /** Lumen: notes with several values of the group property show in each group (default) or the first only. */
  groupMulti?: GroupMulti;
  [k: string]: unknown;
}
export type GroupMulti = "each" | "first";
export interface BaseConfig { filters?: FilterNode; views: BaseViewDef[]; [k: string]: unknown }

const FENCE = /^([ \t]*)(`{3,}|~{3,})[ \t]*base[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\2[ \t]*$/m;

/** Where the YAML lives in the body: a fenced ```base block, or the body itself (after front-matter + H1). */
export function findBaseYaml(body: string): { yaml: string; start: number; end: number; fenced: boolean } | null {
  const m = FENCE.exec(body);
  if (m) {
    const start = m.index + m[0].indexOf(m[3]);
    return { yaml: m[3], start, end: start + m[3].length, fenced: true };
  }
  const fmLen = body.length - splitFrontMatter(body).body.length;
  let rest = body.slice(fmLen);
  const h1 = /^\s*#\s.*(\r?\n|$)/.exec(rest);
  const off = fmLen + (h1 ? h1[0].length : 0);
  rest = body.slice(off);
  if (/^\s*(filters|views|formulas|properties)\s*:/m.test(rest) && /^\s*(filters|views)\s*:/.test(rest)) return { yaml: rest, start: off, end: body.length, fenced: false };
  return null;
}

const asStr = (y: unknown): string | undefined => (typeof y === "string" ? y : typeof y === "number" || typeof y === "boolean" ? String(y) : undefined);
function asSort(y: unknown): SortRule | undefined {
  if (typeof y === "string") return { property: y, direction: "ASC" };
  if (y && typeof y === "object" && !Array.isArray(y)) {
    const o = y as YMap;
    const p = asStr(o.property ?? o.column);
    if (p) return { property: p, direction: String(o.direction ?? "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC" };
  }
  return undefined;
}

/** Parse a base note body. Always returns at least one view. `error` is set when the YAML could not be read. */
export function parseBase(body: string): { cfg: BaseConfig; error: string | null; found: boolean } {
  const loc = findBaseYaml(body);
  let raw: Y = null, error: string | null = null;
  if (loc) { try { raw = parseYaml(loc.yaml); } catch (e) { error = String(e); } }
  const o: YMap = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  if (loc && raw !== null && (typeof raw !== "object" || Array.isArray(raw))) error = "The base block should be a YAML map (filters:, views:)";
  const views = (Array.isArray(o.views) ? o.views : []).filter((v): v is YMap => !!v && typeof v === "object" && !Array.isArray(v)).map((v, i): BaseViewDef => {
    const t = asStr(v.type) as ViewType | undefined;
    const sort = Array.isArray(v.sort) ? v.sort.map(asSort).filter((x): x is SortRule => !!x) : v.sort ? [asSort(v.sort)].filter((x): x is SortRule => !!x) : undefined;
    const cs = v.columnSize && typeof v.columnSize === "object" && !Array.isArray(v.columnSize) ? Object.fromEntries(Object.entries(v.columnSize).map(([k, n]) => [k, Number(n)]).filter(([, n]) => Number(n) > 0)) : undefined;
    return {
      ...v,
      type: t && (VIEW_TYPES as string[]).includes(t) ? t : t === "gallery" as string ? "cards" : t === "kanban" as string ? "board" : "table",
      name: asStr(v.name) ?? `View ${i + 1}`,
      filters: (v.filters ?? undefined) as FilterNode | undefined,
      order: Array.isArray(v.order) ? v.order.map(asStr).filter((x): x is string => !!x) : undefined,
      sort, groupBy: asSort(v.groupBy), limit: Number(v.limit) > 0 ? Number(v.limit) : undefined,
      columnSize: cs as Record<string, number> | undefined, date: asStr(v.date),
      groupMulti: asStr(v.groupMulti) === "first" ? "first" : asStr(v.groupMulti) === "each" ? "each" : undefined,
    };
  });
  return { cfg: { ...o, filters: (o.filters ?? undefined) as FilterNode | undefined, views: views.length ? views : [{ type: "table", name: "Table" }] }, error, found: !!loc };
}

/** Plain YAML object for a config (drops undefined / empty optional keys). */
function plain(cfg: BaseConfig): YMap {
  const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length && v !== o.order) && !(v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length))) as YMap;
  const views = cfg.views.map((v) => clean({ ...v, sort: v.sort?.length ? v.sort : undefined }));
  const { views: _v, ...rest } = cfg;
  void _v;
  return clean({ ...rest, views }) as YMap;
}
export const serializeBase = (cfg: BaseConfig) => toYaml(plain(cfg));

/** Write the config back into the body (replacing the fenced block, the raw YAML body, or appending a block). */
export function writeBase(body: string, cfg: BaseConfig): string {
  const yaml = serializeBase(cfg).replace(/\n$/, "");
  const loc = findBaseYaml(body);
  if (!loc) return `${body.replace(/\s*$/, "")}\n\n\`\`\`base\n${yaml}\n\`\`\`\n`;
  return body.slice(0, loc.start) + yaml + (loc.fenced ? "" : "\n") + body.slice(loc.end);
}

// ------------------------------------------------------------------ properties
export type Val = string | number | string[] | null;
export interface Ctx {
  spaceName: (id: string) => string;
  folderPath: (id: string | null) => string; // "Parent/Child" or ""
  /** Flashcards per note (the computed `cards` property); absent = no such property. */
  cardCount?: (noteId: string) => number;
}

const ALIAS: Record<string, string> = {
  "file.name": "title", "file.basename": "title", name: "title", title: "title",
  "file.ctime": "created", ctime: "created", created: "created", "file.mtime": "updated", mtime: "updated", updated: "updated", modified: "updated",
  "file.tags": "tags", tags: "tags", "file.folder": "folder", folder: "folder", "file.path": "folder",
  type: "type", status: "status", space: "space", course: "course",
};
/** Canonical key: built-in field name, or the front-matter key (note.x → x). */
export const canon = (p: string) => { const k = p.trim().replace(/^(note|formula)\./, ""); return ALIAS[k] ?? ALIAS[k.toLowerCase()] ?? k; };
export const BUILTIN = ["title", "type", "status", "tags", "space", "folder", "created", "updated"] as const;
/** Name written to YAML for a built-in (Obsidian names where they exist). */
export const yamlName = (k: string) => ({ title: "file.name", created: "file.ctime", updated: "file.mtime", tags: "file.tags", folder: "file.folder" } as Record<string, string>)[k] ?? k;
export function label(p: string) {
  const k = canon(p);
  const L: Record<string, string> = { title: "Title", type: "Type", status: "Status", tags: "Tags", space: "Space", folder: "Folder", created: "Created", updated: "Updated" };
  return L[k] ?? k.charAt(0).toUpperCase() + k.slice(1);
}
/** Which cells can be edited inline (and dragged to on a board / calendar). */
export const editable = (p: string) => !["title", "folder", "created", "updated", "cards"].includes(canon(p));
export const isDateProp = (p: string, sample?: Val) => ["created", "updated"].includes(canon(p)) || /date|due|deadline|day|when|start|end|review/i.test(canon(p)) || (typeof sample === "string" && /^\d{4}-\d{2}-\d{2}/.test(sample));

const fmOf = (n: Note): Record<string, string> => (["canvas", "whiteboard", "diagram"].includes(n.type) ? {} : splitFrontMatter(n.body).data);
const listy = (s: string) => /^\[.*\]$/.test(s.trim()) ? s.trim().slice(1, -1).split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : null;

/** Front-matter + record props of a note (cached by the caller). */
export function propsOf(n: Note): Record<string, string> { return { ...(n.props ?? {}), ...fmOf(n) }; }

export function getValue(n: Note, p: string, ctx: Ctx, props: Record<string, string>): Val {
  const k = canon(p);
  switch (k) {
    case "title": return n.title;
    case "type": return n.type;
    case "status": return n.status;
    case "tags": return n.tags;
    case "space": return ctx.spaceName(n.spaceId);
    case "folder": return ctx.folderPath(n.folderId) || null;
    case "created": return n.createdAt;
    case "updated": return n.updatedAt;
  }
  if (k === "cards" && props.cards === undefined && ctx.cardCount) return ctx.cardCount(n.id);
  const raw = props[k] ?? (k === "course" ? ctx.spaceName(n.spaceId) : undefined);
  if (raw === undefined || raw === "") return null;
  return listy(raw) ?? raw;
}

export function show(v: Val, p: string): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "number" && ["created", "updated"].includes(canon(p))) return fmtDate(v);
  return String(v);
}
export const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Epoch ms for a date-ish value (number or YYYY-MM-DD…), else null. */
export function asTime(v: Val | boolean | undefined): number | null {
  if (typeof v === "number") return v > 1e11 ? v : null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const [y, m, d] = v.slice(0, 10).split("-").map(Number);
    const t = /T\d/.test(v) ? Date.parse(v) : new Date(y, m - 1, d).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

// ------------------------------------------------------------------ filters
export type Op = "==" | "!=" | ">" | ">=" | "<" | "<=" | "contains" | "startsWith" | "isEmpty" | "hasTag" | "inFolder";
export interface Cond { prop: string; op: Op; args: (string | number | boolean)[]; neg: boolean }

function literal(s: string): string | number | boolean {
  const t = s.trim();
  if (/^(today|now)\(\)$/.test(t)) return t; // resolved when evaluated (dyn), kept as written for round-trips
  const dm = /^date\((.+)\)$/.exec(t);
  if (dm) return String(literal(dm[1]));
  if (/^".*"$/.test(t)) { try { return JSON.parse(t) as string; } catch { return t.slice(1, -1); } }
  if (/^'.*'$/.test(t)) return t.slice(1, -1);
  if (t === "true" || t === "false") return t === "true";
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

const METHOD = /^(!)?\s*([^\s()!=<>]+?)\.(contains|containsAny|containsAll|startsWith|endsWith|isEmpty|hasTag|inFolder|hasProperty)\((.*)\)$/;
const BIN = /^(!)?\s*([^\s()!=<>]+)\s*(==|!=|>=|<=|>|<|=)\s*(.+)$/;
/** One filter expression → condition, or null when Lumen can't evaluate it (it is then ignored, never hides notes). */
export function parseCond(expr: string): Cond | null {
  const s = expr.trim().replace(/^\((.*)\)$/, "$1");
  let m = METHOD.exec(s);
  if (m) {
    const args = m[4].trim() ? splitTop(m[4]).map(literal) : [];
    const neg = !!m[1];
    const meth = m[3];
    if (meth === "hasTag") return { prop: "tags", op: "hasTag", args, neg };
    if (meth === "inFolder") return { prop: "folder", op: "inFolder", args, neg };
    if (meth === "hasProperty") return { prop: String(args[0] ?? ""), op: "isEmpty", args: [], neg: !neg };
    if (meth === "isEmpty") return { prop: m[2], op: "isEmpty", args: [], neg };
    return { prop: m[2], op: meth === "startsWith" || meth === "endsWith" ? "startsWith" : "contains", args, neg };
  }
  m = BIN.exec(s);
  if (m) return { prop: m[2], op: (m[3] === "=" ? "==" : m[3]) as Op, args: [literal(m[4])], neg: !!m[1] };
  return null;
}
const q = (x: string | number | boolean) => (typeof x === "string" && !/^(today|now)\(\)$/.test(x) ? JSON.stringify(x) : String(x));
/** today() / now() → epoch ms at evaluation time. */
const dyn = (a: string | number | boolean | undefined) => {
  if (a === "now()") return Date.now();
  if (a === "today()") { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  return a;
};
export function condToExpr(c: Cond): string {
  const p = c.prop;
  const neg = c.neg ? "!" : "";
  switch (c.op) {
    case "hasTag": return `${neg}file.hasTag(${c.args.map(q).join(", ")})`;
    case "inFolder": return `${neg}file.inFolder(${c.args.map(q).join(", ")})`;
    case "isEmpty": return `${neg}${p}.isEmpty()`;
    case "contains": case "startsWith": return `${neg}${p}.${c.op}(${c.args.map(q).join(", ")})`;
    default: return `${p} ${c.neg ? ({ "==": "!=", "!=": "==", ">": "<=", ">=": "<", "<": ">=", "<=": ">" } as Record<string, string>)[c.op] : c.op} ${q(c.args[0] ?? "")}`;
  }
}

const low = (x: unknown) => String(x).toLowerCase();
function testCond(c: Cond, n: Note, ctx: Ctx, props: Record<string, string>): boolean {
  return evalCond(c, c.op === "inFolder" ? ctx.folderPath(n.folderId) : getValue(n, c.prop, ctx, props));
}
/** Evaluate one condition against an already-read value (`v` = the folder path for inFolder). */
function evalCond(c: Cond, v: Val): boolean {
  const r = (() => {
    switch (c.op) {
      case "isEmpty": return v === null || v === "" || (Array.isArray(v) && !v.length);
      case "hasTag": {
        const tags = (Array.isArray(v) ? v : []).map(low);
        return c.args.some((a) => { const t = low(a).replace(/^#/, ""); return tags.some((x) => x === t || x.startsWith(t + "/")); });
      }
      case "inFolder": {
        const path = low(v ?? "");
        return c.args.some((a) => { const f = low(a).replace(/^\/|\/$/g, ""); return !!path && (path === f || path.startsWith(f + "/") || path.split("/").includes(f)); });
      }
      case "contains": return v !== null && c.args.some((a) => (Array.isArray(v) ? v.some((x) => low(x).includes(low(a))) : low(v).includes(low(a))));
      case "startsWith": return v !== null && c.args.some((a) => (Array.isArray(v) ? v.some((x) => low(x).startsWith(low(a))) : low(v).startsWith(low(a))));
      default: return compare(v, c.op, dyn(c.args[0]));
    }
  })();
  return c.neg ? !r : r;
}
function compare(v: Val, op: Op, arg: string | number | boolean | undefined): boolean {
  if (arg === undefined) return true;
  if (Array.isArray(v)) return op === "!=" ? !v.some((x) => compare(x, "==", arg)) : v.some((x) => compare(x, op, arg));
  if (v === null) return op === "!=" ? low(arg) !== "" : op === "==" ? low(arg) === "" || low(arg) === "null" : false;
  const ta = asTime(v), tb = asTime(typeof arg === "boolean" ? String(arg) : arg);
  let a: number | string, b: number | string;
  if (ta !== null && tb !== null) {
    // dates compare by day (created/updated carry a time of day)
    const day = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    a = day(ta); b = day(tb);
  } else if (typeof arg === "number" && !Number.isNaN(Number(v))) { a = Number(v); b = arg; }
  else { a = low(v); b = low(arg); }
  switch (op) {
    case "==": return a === b;
    case "!=": return a !== b;
    case ">": return a > b;
    case ">=": return a >= b;
    case "<": return a < b;
    case "<=": return a <= b;
    default: return true;
  }
}

/** Evaluate a filter tree. Unknown expressions pass (they never hide notes). */
export function testFilter(f: FilterNode | undefined | null, n: Note, ctx: Ctx, props: Record<string, string>): boolean {
  if (!f) return true;
  if (typeof f === "string") { const c = parseCond(f); return c ? testCond(c, n, ctx, props) : true; }
  if (Array.isArray(f)) return f.every((x) => testFilter(x as FilterNode, n, ctx, props));
  if (f.and) return f.and.every((x) => testFilter(x, n, ctx, props));
  if (f.or) return f.or.length ? f.or.some((x) => testFilter(x, n, ctx, props)) : true;
  if (f.not) return !f.not.some((x) => testFilter(x, n, ctx, props));
  return true;
}
/** Evaluate a filter tree against any record (dashboard sources): `get(prop)` returns the value of a property. */
export function testFilterWith(f: FilterNode | undefined | null, get: (prop: string) => Val): boolean {
  if (!f) return true;
  if (typeof f === "string") {
    const c = parseCond(f);
    if (!c) return true;
    return evalCond(c, get(c.op === "hasTag" ? "tags" : c.op === "inFolder" ? "folder" : c.prop));
  }
  if (Array.isArray(f)) return f.every((x) => testFilterWith(x as FilterNode, get));
  if (f.and) return f.and.every((x) => testFilterWith(x, get));
  if (f.or) return f.or.length ? f.or.some((x) => testFilterWith(x, get)) : true;
  if (f.not) return !f.not.some((x) => testFilterWith(x, get));
  return true;
}
/** Expressions in a filter tree that Lumen can't evaluate (shown as a hint). */
export function unsupported(f: FilterNode | undefined | null): string[] {
  if (!f) return [];
  if (typeof f === "string") return parseCond(f) ? [] : [f];
  if (Array.isArray(f)) return f.flatMap((x) => unsupported(x as FilterNode));
  return [...(f.and ?? []), ...(f.or ?? []), ...(f.not ?? [])].flatMap(unsupported);
}

/** Flat editable form of a view filter: an and/or list of conditions + nodes the editor keeps as raw text. */
export interface FlatFilter { mode: "and" | "or"; conds: Cond[]; raw: FilterNode[] }
export function flatten(f: FilterNode | undefined): FlatFilter {
  if (!f) return { mode: "and", conds: [], raw: [] };
  const list: FilterNode[] = typeof f === "string" ? [f] : f.and ?? f.or ?? [f];
  const mode = typeof f !== "string" && f.or ? "or" : "and";
  const conds: Cond[] = [], raw: FilterNode[] = [];
  for (const x of list) { const c = typeof x === "string" ? parseCond(x) : null; if (c) conds.push(c); else raw.push(x); }
  return { mode, conds, raw };
}
export function unflatten(ff: FlatFilter): FilterNode | undefined {
  const items: FilterNode[] = [...ff.conds.map(condToExpr), ...ff.raw];
  if (!items.length) return undefined;
  return ff.mode === "or" ? { or: items } : { and: items };
}

// ------------------------------------------------------------------ query: filter, search, sort, group
export interface Row { n: Note; props: Record<string, string> }
export interface Group { key: string; label: string; rows: Row[] }
export const NONE = "\u0000none";

function cmpVal(a: Val, b: Val): number {
  const an = a === null || a === "" || (Array.isArray(a) && !a.length), bn = b === null || b === "" || (Array.isArray(b) && !b.length);
  if (an || bn) return an && bn ? 0 : an ? 1 : -1;
  const ta = asTime(a as Val), tb = asTime(b as Val);
  if (ta !== null && tb !== null) return ta - tb;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = Array.isArray(a) ? a.join(",") : String(a), sb = Array.isArray(b) ? b.join(",") : String(b);
  if (/^-?\d+(\.\d+)?$/.test(sa) && /^-?\d+(\.\d+)?$/.test(sb)) return Number(sa) - Number(sb);
  return natural(sa, sb);
}
const RANK: Record<string, string[]> = { status: STATUSES, type: NOTE_TYPES };
function cmpProp(p: string, a: Val, b: Val) {
  const r = RANK[canon(p)];
  if (r && typeof a === "string" && typeof b === "string") return r.indexOf(a) - r.indexOf(b);
  return cmpVal(a, b);
}

export function runView(notes: Note[], cfg: BaseConfig, view: BaseViewDef, ctx: Ctx, propsFor: (n: Note) => Record<string, string>, opts: { search?: string; self?: string } = {}) {
  const s = opts.search?.trim().toLowerCase();
  let rows: Row[] = [];
  for (const n of notes) {
    if (n.id === opts.self) continue;
    const props = propsFor(n);
    if (!testFilter(cfg.filters, n, ctx, props) || !testFilter(view.filters, n, ctx, props)) continue;
    if (s && !n.title.toLowerCase().includes(s) && !n.tags.some((t) => t.includes(s)) && !Object.values(props).some((v) => v.toLowerCase().includes(s)) && !(n.body.length < 20000 && n.body.toLowerCase().includes(s))) continue;
    rows.push({ n, props });
  }
  const sort = view.sort?.length ? view.sort : [{ property: "updated", direction: "DESC" as const }];
  rows.sort((a, b) => {
    for (const r of sort) {
      const d = cmpProp(r.property, getValue(a.n, r.property, ctx, a.props), getValue(b.n, r.property, ctx, b.props));
      if (d) return r.direction === "DESC" ? -d : d;
    }
    return 0;
  });
  const total = rows.length;
  if (view.limit) rows = rows.slice(0, view.limit);
  return { rows, total };
}

/** The group keys a row falls in for a property (several for tags / list properties; NONE when empty). */
export function groupKeysOf(r: Row, by: SortRule, ctx: Ctx, multi: GroupMulti = "each"): string[] {
  const k = canon(by.property);
  const v = getValue(r.n, by.property, ctx, r.props);
  const keys = Array.isArray(v) ? (v.length ? [...new Set(v.map(String))] : [NONE]) : v === null || v === "" ? [NONE] : [k === "created" || k === "updated" ? ymd(new Date(v as number)) : String(v)];
  return multi === "first" ? keys.slice(0, 1) : keys;
}

/** Group rows by a property. Multi-value properties (tags, lists, courses) put a note in each of its groups
 *  (`multi: "first"` keeps only the first value). */
export function groupRows(rows: Row[], by: SortRule, ctx: Ctx, opts: { allStatuses?: boolean; multi?: GroupMulti } = {}): Group[] {
  const m = new Map<string, Group>();
  const k = canon(by.property);
  if (opts.allStatuses && k === "status") for (const s of STATUSES) m.set(s, { key: s, label: s, rows: [] });
  for (const r of rows) {
    for (const key of groupKeysOf(r, by, ctx, opts.multi)) {
      if (!m.has(key)) m.set(key, { key, label: key === NONE ? `No ${label(k).toLowerCase()}` : key, rows: [] });
      m.get(key)!.rows.push(r);
    }
  }
  const gs = [...m.values()];
  gs.sort((a, b) => (a.key === NONE ? 1 : b.key === NONE ? -1 : (by.direction === "DESC" ? -1 : 1) * cmpProp(k, a.key, b.key)));
  return gs;
}

/** For each note shown in several groups: the group keys it appears in, in display order. The first one is the
 *  "home" copy; later copies are marked as duplicates on boards and get an "also in N groups" marker in tables. */
export function copiesOf(groups: Group[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const g of groups) for (const r of g.rows) m.set(r.n.id, [...(m.get(r.n.id) ?? []), g.key]);
  for (const [id, ks] of m) if (ks.length < 2) m.delete(id);
  return m;
}

/** New values after dragging one copy of a multi-value note from group `from` to group `to` (only that value changes). */
export function swapValue(cur: string[], from: string, to: string): string[] {
  return [...new Set([...cur.filter((x) => x !== from), ...(to === NONE ? [] : [to])])];
}
/** Toast text for a drag between groups: "Moved from #cv to #nlp, still in #llm". `cur` = values before the move. */
export function moveMessage(prop: string, from: string, to: string, cur: string[] = []): string {
  const k = canon(prop);
  const f = (x: string) => (x === NONE ? `no ${label(k).toLowerCase()}` : k === "tags" ? `#${x}` : x);
  const next = swapValue(cur, from, to);
  const still = next.filter((x) => x !== to);
  const head = to === NONE || cur.includes(to) ? `Removed from ${f(from)}` : `Moved from ${f(from)} to ${f(to)}`;
  const keep = cur.includes(to) ? next : still;
  return keep.length ? `${head}, still in ${keep.map(f).join(", ")}` : head;
}

/** All property names seen on the notes (front-matter keys), for the column / filter pickers. */
export function knownProps(rows: { props: Record<string, string> }[]): string[] {
  const seen = new Map<string, number>();
  const SKIP = new Set(["type", "status", "tags", "title", "width", "slug", "cssclass", "cssclasses", "aliases", "diagramHash", "diagramLine", "diagramFrom", "diagramsFor"]);
  for (const r of rows.slice(0, 3000)) for (const k of Object.keys(r.props)) if (!SKIP.has(k)) seen.set(k, (seen.get(k) ?? 0) + 1);
  return [...seen].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

// ------------------------------------------------------------------ writes (record + front-matter, via updateNote)
export const isStatus = (s: string): s is Status => (STATUSES as string[]).includes(s);
export const isType = (s: string): s is NoteType => (NOTE_TYPES as string[]).includes(s);

/** Default view for a new base / an added view. */
export const newView = (type: ViewType, name?: string): BaseViewDef => ({
  type, name: name ?? ({ table: "Table", board: "Board", cards: "Gallery", list: "List", calendar: "Calendar" } as Record<ViewType, string>)[type],
  order: type === "board" ? ["file.name", "file.tags"] : type === "cards" ? ["file.name", "status", "file.tags"] : type === "list" ? ["file.name", "status"] : ["file.name", "status", "file.tags", "file.mtime"],
  ...(type === "board" ? { groupBy: { property: "status", direction: "ASC" as const } } : {}),
});

/** Front-matter key/values implied by a view's simple `==` filters (used to pre-fill a note created from the view). */
export function impliedProps(cfg: BaseConfig, view: BaseViewDef): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [cfg.filters, view.filters]) {
    const ff = flatten(f);
    if (ff.mode !== "and") continue;
    for (const c of ff.conds) {
      if (c.neg) continue;
      if (c.op === "==" && typeof c.args[0] !== "undefined") out[canon(c.prop)] = String(c.args[0]);
      if (c.op === "hasTag" && c.args[0]) out.tags = [out.tags, String(c.args[0]).replace(/^#/, "")].filter(Boolean).join(", ");
    }
  }
  return out;
}

// ------------------------------------------------------------------ filter rows (the Filter popover's model)
/** One row of the Filter popover. `any` = "is any of" (an `or:` of `==` on one property, written back the same way);
 *  `group` = a nested "any of" group (one level); `raw` = anything else, kept untouched. */
export type FilterRow =
  | { kind: "cond"; c: Cond }
  | { kind: "any"; prop: string; values: string[] }
  | { kind: "group"; conds: Cond[] }
  | { kind: "raw"; node: FilterNode };
export interface FilterRows { mode: "and" | "or"; rows: FilterRow[] }

export function filterRows(f: FilterNode | undefined): FilterRows {
  if (!f) return { mode: "and", rows: [] };
  const list: FilterNode[] = typeof f === "string" ? [f] : Array.isArray(f) ? (f as FilterNode[]) : f.and ?? f.or ?? [f];
  const mode = typeof f !== "string" && !Array.isArray(f) && f.or ? "or" : "and";
  const rows: FilterRow[] = list.map((x): FilterRow => {
    if (typeof x === "string") { const c = parseCond(x); return c ? { kind: "cond", c } : { kind: "raw", node: x }; }
    if (x && typeof x === "object" && !Array.isArray(x) && x.or && !x.and && !x.not) {
      const cs = x.or.map((y) => (typeof y === "string" ? parseCond(y) : null));
      if (cs.length && cs.every((c): c is Cond => !!c)) {
        const p = canon(cs[0].prop);
        if (cs.length > 1 && cs.every((c) => c.op === "==" && !c.neg && canon(c.prop) === p)) return { kind: "any", prop: cs[0].prop, values: cs.map((c) => String(c.args[0] ?? "")) };
        return { kind: "group", conds: cs };
      }
    }
    return { kind: "raw", node: x };
  });
  return { mode, rows };
}
export function rowsToFilter(fr: FilterRows): FilterNode | undefined {
  const items: FilterNode[] = [];
  for (const r of fr.rows) {
    if (r.kind === "cond") items.push(condToExpr(r.c));
    else if (r.kind === "raw") items.push(r.node);
    else if (r.kind === "any") {
      const vs = [...new Set(r.values.map((v) => v.trim()).filter(Boolean))];
      if (vs.length === 1) items.push(condToExpr({ prop: r.prop, op: "==", neg: false, args: [vs[0]] }));
      else if (vs.length) items.push({ or: vs.map((v) => condToExpr({ prop: r.prop, op: "==", neg: false, args: [v] })) });
    } else if (r.conds.length) items.push({ or: r.conds.map(condToExpr) });
  }
  if (!items.length) return undefined;
  return fr.mode === "or" ? { or: items } : { and: items };
}
/** Number of filter conditions (toolbar badge). */
export const filterCount = (f: FilterNode | undefined) => filterRows(f).rows.reduce((a, r) => a + (r.kind === "group" ? r.conds.length : 1), 0);

// ------------------------------------------------------------------ templates (New base · template picker)
export interface BaseTemplate { id: string; glyph: string; name: string; desc: string; type: "base" | "dashboard"; title: string; yaml: string }
export const BASE_TEMPLATES: BaseTemplate[] = [
  { id: "all", glyph: "base", name: "Base (database view)", desc: "Empty table of all notes", type: "base", title: "New base",
    yaml: "views:\n  - type: table\n    name: All notes\n    order:\n      - file.name\n      - type\n      - status\n      - space\n      - file.tags\n      - file.mtime\n    sort:\n      - property: file.mtime\n        direction: DESC\n" },
  { id: "lessons", glyph: "v-board", name: "Lessons by status × course", desc: "Board grouped by status, filtered to lessons", type: "base", title: "Lessons by status × course",
    yaml: "filters:\n  and:\n    - type == \"lesson\"\nviews:\n  - type: board\n    name: By status\n    groupBy:\n      property: status\n      direction: ASC\n    order:\n      - file.name\n      - course\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - status\n      - course\n      - file.tags\n      - due\n      - cards\n    sort:\n      - property: due\n        direction: ASC\n  - type: cards\n    name: Gallery\n    order:\n      - file.name\n      - status\n      - course\n  - type: list\n    name: List\n    groupBy:\n      property: status\n      direction: ASC\n    order:\n      - file.name\n      - course\n      - due\n  - type: calendar\n    name: Calendar\n    date: due\n" },
  { id: "due", glyph: "v-calendar", name: "Due this month", desc: "Calendar by due date", type: "base", title: "Due this month",
    yaml: "filters:\n  and:\n    - '!due.isEmpty()'\nviews:\n  - type: calendar\n    name: Due\n    date: due\n    order:\n      - file.name\n      - course\n" },
  { id: "cards", glyph: "flashcards", name: "Cards by deck", desc: "Table of flashcard notes", type: "base", title: "Cards by deck",
    yaml: "filters:\n  and:\n    - type == \"flashcards\"\nviews:\n  - type: table\n    name: By deck\n    groupBy:\n      property: space\n      direction: ASC\n    order:\n      - file.name\n      - space\n      - cards\n      - file.mtime\n" },
  { id: "reading", glyph: "pdf", name: "Reading list", desc: "PDFs with progress", type: "base", title: "Reading list",
    yaml: "filters:\n  and:\n    - type == \"pdf\"\nviews:\n  - type: table\n    name: Reading list\n    order:\n      - file.name\n      - status\n      - progress\n      - space\n      - file.mtime\n    sort:\n      - property: file.mtime\n        direction: DESC\n" },
  { id: "dashboard", glyph: "dashboard", name: "Dashboard", desc: "Tiles over sessions and cards", type: "dashboard", title: "Study dashboard",
    yaml: "tiles:\n  - id: minutes\n    title: Minutes studied\n    type: number\n    source: sessions\n    y: minutes\n    aggregate: sum\n    range: 7d\n    layout: { x: 0, y: 0, w: 3, h: 2 }\n  - id: due\n    title: Cards due\n    type: number\n    source: cards\n    range: next 1d\n    layout: { x: 3, y: 0, w: 3, h: 2 }\n  - id: week\n    title: Minutes per week by course\n    type: stackedBar\n    source: sessions\n    x: at\n    bucket: week\n    y: minutes\n    aggregate: sum\n    series: course\n    range: 8w\n    layout: { x: 6, y: 0, w: 6, h: 4 }\n  - id: days\n    title: Study days\n    type: heatmap\n    source: sessions\n    y: minutes\n    aggregate: sum\n    range: 20w\n    layout: { x: 0, y: 2, w: 6, h: 4 }\n" },
];
/** Body for a note created from a template: an intro line + the fenced YAML block. */
export const templateBody = (t: BaseTemplate) => `${t.desc}.\n\n\`\`\`${t.type}\n${t.yaml}\`\`\`\n`;
