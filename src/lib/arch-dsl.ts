// Lumen diagram DSL (docs/ARCHITECTURE_DIAGRAMS.md §3.3): parser, printer and DSL ⇄ canvas sync.
//
//   direction right                         // or down
//   AWS [icon: region, label: "eu-west-1"] {  // braces = a group (boundary); nest freely
//     API [icon: service, tech: "FastAPI", status: live]
//   }
//   User > API: HTTPS                       // one arrow; label after ":"
//   API > Queue: enqueue (async)            // kind in brackets: sync | async | data | control
//   A < B    A <> B    A - B    A --> B    A -- B    A <--> B   // reverse, both ends, no ends, dashed (async)
//   A > B, C       A > B > C                // fan-out and chains
//   users { id int pk \n name text }         // ERD / class diagrams: braces hold fields instead
//
// Positions never appear in the DSL; they stay in the JSON. Comments are cached in `lumenArch.dsl` and re-attached to the
// statement that followed them when the canvas rewrites the code.
import { uid } from "./db";
import {
  ARCH_ICONS, isIcon, kindOfIcon, parentOf, nameOf, displayOf, SIZE, placeNew, setEnds, endsOf, fitGroups,
  type AEdge, type ANode, type ArchCanvas, type ArchKind, type ArchStatus, type Direction, type EdgeStyle, type Ends, type Field, type NodeSize,
} from "./arch-model";

export interface DslError { line: number; col: number; endCol: number; message: string }
export interface DslNode { name: string; attrs: Record<string, string>; parent: string | null; line: number; isGroup: boolean; fields?: Field[]; implicit?: boolean }
export interface DslEdge { from: string; to: string; ends: Ends; style?: EdgeStyle; label?: string; line: number }
export interface DslComment { anchor: string; text: string; inline: boolean }
export interface DslDoc { direction: Direction | null; nodes: DslNode[]; edges: DslEdge[]; comments: DslComment[]; lineOf: Map<string, number> }

const ATTRS = ["icon", "label", "tech", "status", "color", "size", "kind"];
const STATUSES: ArchStatus[] = ["planned", "building", "live", "deprecated"];
const STYLES: EdgeStyle[] = ["sync", "async", "data", "control"];
export const DSL_KEYWORDS = ["direction", ...ATTRS, ...STATUSES, ...STYLES, "right", "down"];
const OPS = ["<-->", "<->", "-->", "<>", "--", ">", "<", "-"] as const;
type Op = (typeof OPS)[number];
const FIELDS_KINDS: ArchKind[] = ["erd", "class"];

/** Levenshtein distance (for "Did you mean …?"). */
function dist(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
export function suggestIcon(s: string): string | null {
  let best: string | null = null, bd = 3;
  for (const i of ARCH_ICONS) { const x = dist(s, i); if (x < bd) { bd = x; best = i; } }
  return best;
}

/** Split a line into code and `// comment`, ignoring slashes inside quotes. */
function splitComment(line: string): [code: string, comment: string | null] {
  let q = false;
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] === '"') q = !q;
    else if (!q && line[i] === "/" && line[i + 1] === "/") return [line.slice(0, i), line.slice(i + 2).trim()];
  }
  return [line, null];
}
const unq = (s: string) => { const t = s.trim(); return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t; };
const q = (s: string) => (/^[\p{L}\p{N}_][\p{L}\p{N}_ .'/&+-]*$/u.test(s) && !/\s-{1,2}\s|\s$/.test(s) ? s : `"${s.replace(/"/g, "'")}"`);

/** Find connection operators outside quotes / brackets. "-" and "--" need spaces around them (names may contain hyphens). */
function findOps(s: string): { at: number; op: Op }[] {
  const out: { at: number; op: Op }[] = [];
  let quote = false, br = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') { quote = !quote; continue; }
    if (quote) continue;
    if (ch === "[") br++; else if (ch === "]") br--;
    if (br) continue;
    for (const op of OPS) {
      if (!s.startsWith(op, i)) continue;
      if ((op === "-" || op === "--") && !(/\s/.test(s[i - 1] ?? "") && /\s/.test(s[i + op.length] ?? ""))) continue;
      out.push({ at: i, op }); i += op.length - 1; break;
    }
  }
  return out;
}

export function parseDsl(text: string, kind: ArchKind = "architecture"): { doc: DslDoc; errors: DslError[] } {
  const errors: DslError[] = [];
  const nodes: DslNode[] = [], edges: DslEdge[] = [], comments: DslComment[] = [];
  const byName = new Map<string, DslNode>();
  const lineOf = new Map<string, number>();
  let direction: Direction | null = null;
  const stack: { name: string; line: number; fields: boolean }[] = [];
  let pending: string[] = [];
  const err = (line: number, col: number, endCol: number, message: string) => errors.push({ line, col, endCol, message });
  const anchor = (key: string, inline: string | null) => {
    pending.forEach((t) => comments.push({ anchor: key, text: t, inline: false }));
    pending = [];
    if (inline !== null) comments.push({ anchor: key, text: inline, inline: true });
  };
  const fieldsMode = FIELDS_KINDS.includes(kind);
  const lines = text.split("\n");
  lines.forEach((raw, i) => {
    const ln = i + 1;
    const [code0, comment] = splitComment(raw);
    const code = code0.trim();
    const indent = code0.length - code0.trimStart().length;
    if (!code) { if (comment !== null) pending.push(comment); return; }
    if (code === "}") {
      const top = stack.pop();
      if (!top) err(ln, indent + 1, indent + 2, "Unexpected “}”: no group is open.");
      else anchor(`end:${top.name}`, comment);
      return;
    }
    const dm = /^direction\s+(\S+)$/.exec(code);
    if (dm) {
      if (dm[1] === "right" || dm[1] === "down") direction = dm[1]; else if (dm[1] === "left" || dm[1] === "up") direction = dm[1] === "left" ? "right" : "down";
      else err(ln, indent + 11, indent + 11 + dm[1].length, `Unknown direction “${dm[1]}”. Use right or down.`);
      anchor("dir", comment);
      return;
    }
    const top = stack[stack.length - 1];
    if (top?.fields) {
      // field line inside an ERD entity / class: name type [pk|fk]
      const parts = code.replace(/[,;]$/, "").split(/\s+/);
      const owner = byName.get(top.name)!;
      owner.fields = [...(owner.fields ?? []), { name: parts[0], ...(parts[1] ? { type: parts[1] } : {}), ...(parts[2] ? { key: parts.slice(2).join(" ") } : {}) }];
      if (comment !== null) comments.push({ anchor: `n:${top.name}`, text: comment, inline: true });
      return;
    }
    const ops = findOps(code);
    if (ops.length) {
      // connection: A > B, C > D: label (style)
      let body = code, label: string | undefined, style: EdgeStyle | undefined;
      let quote = false, colon = -1;
      for (let k = ops[ops.length - 1].at; k < body.length; k++) { if (body[k] === '"') quote = !quote; else if (!quote && body[k] === ":") { colon = k; break; } }
      if (colon >= 0) { label = unq(body.slice(colon + 1)); body = body.slice(0, colon); }
      const sm = /\((sync|async|data|control)\)\s*$/;
      const tryStyle = (s: string) => { const m = sm.exec(s); if (m) { style = m[1] as EdgeStyle; return s.slice(0, m.index).trim(); } return s; };
      if (label !== undefined) label = tryStyle(label) || undefined;
      body = tryStyle(body.trim());
      const segOps = findOps(body);
      const parts: string[][] = [];
      let last = 0;
      for (const o of segOps) { parts.push(body.slice(last, o.at).split(",").map(unq).map((s) => s.trim())); last = o.at + o.op.length; }
      parts.push(body.slice(last).split(",").map(unq).map((s) => s.trim()));
      if (parts.some((p) => p.some((x) => !x))) { err(ln, indent + 1, indent + code.length + 1, "A connection needs a name on both sides, like “A > B”."); return; }
      for (let s = 0; s < segOps.length; s++) {
        const op = segOps[s].op;
        const dashed = op.includes("--");
        const ends: Ends = op === "<>" || op === "<->" || op === "<-->" ? "both" : op === "-" || op === "--" ? "none" : "one";
        for (const a of parts[s]) for (const b of parts[s + 1]) {
          const [from, to] = op === "<" ? [b, a] : [a, b];
          edges.push({ from, to, ends, style: style ?? (dashed ? "async" : undefined), label, line: ln });
          for (const nm of [from, to]) if (!byName.has(nm)) { const n: DslNode = { name: nm, attrs: {}, parent: null, line: ln, isGroup: false, implicit: true }; byName.set(nm, n); nodes.push(n); }
        }
      }
      const first = edges[edges.length - 1];
      anchor(`e:${first.from}>${first.to}`, comment);
      return;
    }
    // node / group: Name [attrs] {
    let rest = code, opens = false;
    if (rest.endsWith("{")) { opens = true; rest = rest.slice(0, -1).trim(); }
    let attrs: Record<string, string> = {};
    const b = rest.indexOf("[");
    let name = rest;
    if (b >= 0) {
      const close = rest.lastIndexOf("]");
      if (close < b) { err(ln, indent + b + 1, indent + rest.length + 1, "Missing “]” after the attributes."); return; }
      name = rest.slice(0, b);
      const inner = rest.slice(b + 1, close);
      if (rest.slice(close + 1).trim()) { err(ln, indent + close + 2, indent + rest.length + 1, `Unexpected “${rest.slice(close + 1).trim()}” after “]”.`); return; }
      // k: v pairs, values may be quoted and contain commas
      const re = /\s*([\w-]+)\s*:\s*("([^"]*)"|[^,]*)\s*(,|$)/gy;
      let m: RegExpExecArray | null, pos = 0;
      while (pos < inner.length && (m = re.exec(inner))) {
        const key = m[1], val = m[3] ?? m[2].trim();
        const kc = indent + b + 2 + m.index + m[0].indexOf(key);
        const vc = indent + b + 2 + m.index + m[0].indexOf(m[2]);
        if (!ATTRS.includes(key)) err(ln, kc, kc + key.length, `Unknown attribute “${key}”. Use ${ATTRS.join(", ")}.`);
        else if (key === "icon" && !isIcon(val)) { const s = suggestIcon(val); err(ln, vc, vc + val.length, `Line ${ln}: unknown icon “${val}”.${s ? ` Did you mean ${s}?` : ""}`); }
        else if (key === "status" && !STATUSES.includes(val as ArchStatus)) err(ln, vc, vc + val.length, `Unknown status “${val}”. Use ${STATUSES.join(", ")}.`);
        else if (key === "size" && !["S", "M", "L"].includes(val)) err(ln, vc, vc + val.length, "Size is S, M or L.");
        attrs = { ...attrs, [key]: val };
        pos = re.lastIndex;
        if (!m[0]) break;
      }
      if (pos < inner.trim().length && inner.trim()) { const c0 = indent + b + 2 + pos; err(ln, c0, indent + close + 1, "Attributes look like [icon: service, tech: \"Go\"]."); }
    }
    name = unq(name.trim());
    if (!name) { err(ln, indent + 1, indent + code.length + 1, "A node needs a name before “[” or “{”."); return; }
    const existing = byName.get(name);
    if (existing && !existing.implicit) { err(ln, indent + 1, indent + name.length + 1, `“${name}” is already declared on line ${existing.line}.`); return; }
    const parent = top?.name ?? null;
    const isGroup = opens && !fieldsMode;
    const node: DslNode = { name, attrs, parent, line: ln, isGroup, ...(opens && fieldsMode ? { fields: [] } : {}) };
    if (existing) { Object.assign(existing, node, { implicit: false }); nodes.splice(nodes.indexOf(existing), 1); nodes.push(existing); }
    else { byName.set(name, node); nodes.push(node); }
    lineOf.set(name, ln);
    anchor(`n:${name}`, comment);
    if (opens) stack.push({ name, line: ln, fields: fieldsMode });
  });
  for (const s of stack) err(s.line, 1, (lines[s.line - 1] ?? "").length + 1, `“${s.name}” opens a group with “{” that never closes.`);
  pending.forEach((t) => comments.push({ anchor: "eof", text: t, inline: false }));
  for (const n of nodes) lineOf.set(n.name, n.line);
  return { doc: { direction, nodes, edges, comments, lineOf }, errors };
}

// ------------------------------------------------------------------ printer
function nodeAttrs(n: ANode): string {
  const ln = n.lumenNode ?? {}, lg = n.lumenGroup;
  const a: string[] = [];
  const name = nameOf(n), shown = displayOf(n);
  if (n.type === "group") {
    if (lg?.icon || lg?.kind) a.push(`icon: ${lg?.icon ?? lg?.kind}`);
    if (lg?.sub) a.push(`label: "${lg.sub}"`);
  } else {
    if (ln.icon) a.push(`icon: ${ln.icon}`);
    if (shown && shown !== name) a.push(`label: "${shown}"`);
    if (ln.tech) a.push(`tech: "${ln.tech}"`);
    if (ln.status) a.push(`status: ${ln.status}`);
    if (ln.size && ln.size !== "M") a.push(`size: ${ln.size}`);
  }
  if (n.color) a.push(`color: "${n.color}"`);
  return a.length ? ` [${a.join(", ")}]` : "";
}
const OP_OF = (e: AEdge): string => {
  const ends = endsOf(e), dashed = e.lumenEdge?.style === "async";
  if (dashed) return ends === "both" ? "<-->" : ends === "none" ? "--" : "-->";
  return ends === "both" ? "<>" : ends === "none" ? "-" : ">";
};

/** Canvas → DSL. Comments from the cached DSL come back before the statement they preceded (or the next one that still exists). */
export function printDsl(c: ArchCanvas, cached?: string): string {
  const kind = c.lumenArch.kind;
  const old = cached ? parseDsl(cached, kind).doc : null;
  const before = new Map<string, string[]>(), inline = new Map<string, string>();
  if (old) {
    old.comments.forEach((cm) => { if (cm.inline) inline.set(cm.anchor, cm.text); });
    for (const cm of old.comments) if (!cm.inline) before.set(cm.anchor, [...(before.get(cm.anchor) ?? []), cm.text]);
  }
  const names = new Map(c.nodes.map((n) => [n.id, nameOf(n)]));
  const used = new Set<string>();
  const out: string[] = [];
  const emit = (key: string, line: string, ind: string) => {
    for (const t of before.get(key) ?? []) out.push(`${ind}// ${t}`);
    used.add(key);
    const il = inline.get(key);
    out.push(il !== undefined ? `${line} // ${il}` : line);
  };
  emit("dir", `direction ${c.lumenArch.direction ?? "right"}`, "");
  const kids = new Map<string | undefined, ANode[]>();
  const ids = new Set(c.nodes.map((n) => n.id));
  for (const n of c.nodes) { const p = parentOf(n); const k = p && ids.has(p) ? p : undefined; kids.set(k, [...(kids.get(k) ?? []), n]); }
  const walk = (p: string | undefined, depth: number) => {
    const ind = "  ".repeat(depth);
    for (const n of kids.get(p) ?? []) {
      const nm = q(nameOf(n));
      const isG = n.type === "group";
      const fields = n.lumenNode?.fields;
      if (isG || fields) {
        emit(`n:${nameOf(n)}`, `${ind}${nm}${nodeAttrs(n)} {`, ind);
        if (fields) for (const f of fields) out.push(`${ind}  ${[f.name, f.type, f.key].filter(Boolean).join(" ")}`);
        else walk(n.id, depth + 1);
        emit(`end:${nameOf(n)}`, `${ind}}`, `${ind}  `);
      } else emit(`n:${nameOf(n)}`, `${ind}${nm}${nodeAttrs(n)}`, ind);
    }
  };
  walk(undefined, 0);
  for (const e of c.edges) {
    const a = names.get(e.fromNode), b = names.get(e.toNode);
    if (!a || !b) continue;
    const st = e.lumenEdge?.style;
    const suffix = st && st !== "sync" && !(st === "async" && OP_OF(e).includes("--")) ? ` (${st})` : "";
    const lbl = e.label ? `: ${/[:"]/.test(e.label) ? `"${e.label.replace(/"/g, "'")}"` : e.label}` : "";
    emit(`e:${a}>${b}`, `${q(a)} ${OP_OF(e)} ${q(b)}${lbl}${suffix}`, "");
  }
  // comments whose statement is gone: keep them at the end so nothing typed is lost
  for (const [k, ts] of before) if (!used.has(k)) for (const t of ts) out.push(`// ${t}`);
  return out.join("\n") + "\n";
}

// ------------------------------------------------------------------ DSL → canvas
/**
 * Merge a parsed DSL document into the canvas. Existing nodes (matched by DSL name, or by declaration line for a rename)
 * keep their id, position, size and the fields the DSL can't express (description, links, owner, ref…). Only new nodes
 * get placed. Edges keep their id, ports and shape when the same pair still connects.
 */
export function applyDsl(c: ArchCanvas, doc: DslDoc, text: string, prevLines?: Map<string, number>): ArchCanvas {
  const oldByName = new Map(c.nodes.map((n) => [nameOf(n), n]));
  const docNames = new Set(doc.nodes.map((n) => n.name));
  // renames: an old node no longer named in the DSL whose declaration sat on the same line
  const orphanByLine = new Map<number, ANode>();
  if (prevLines) for (const [nm, ln] of prevLines) { const o = oldByName.get(nm); if (o && !docNames.has(nm)) orphanByLine.set(ln, o); }
  const idOf = new Map<string, string>();
  const fresh = new Set<string>();
  const out: ANode[] = [];
  for (const d of doc.nodes) {
    const prev = oldByName.get(d.name) ?? orphanByLine.get(d.line);
    const id = prev?.id ?? `n-${uid().slice(0, 8)}`;
    idOf.set(d.name, id);
    if (!prev) fresh.add(id);
    const a = d.attrs;
    const color = a.color || undefined;
    if (d.isGroup) {
      const kindG = a.kind || a.icon || (prev?.type === "group" ? prev.lumenGroup?.kind : undefined) || "region";
      const g: ANode = {
        id, type: "group", x: prev?.x ?? 0, y: prev?.y ?? 0, width: prev?.width ?? 300, height: prev?.height ?? 200,
        label: d.name, ...(color ? { color } : {}),
        lumenGroup: { ...(prev?.type === "group" ? prev.lumenGroup : {}), kind: kindG, name: d.name, ...(a.icon ? { icon: a.icon } : {}), sub: a.label, parent: undefined },
      } as ANode;
      if (!a.icon && g.lumenGroup) delete g.lumenGroup.icon;
      if (!a.label && g.lumenGroup) delete g.lumenGroup.sub;
      out.push(g);
    } else {
      const pl = (prev && prev.type !== "group" ? prev.lumenNode : undefined) ?? {};
      const size = (a.size as NodeSize) || undefined;
      const [w, h] = SIZE[size ?? "M"];
      const fields = d.fields;
      const icon = a.icon || (a.kind ? undefined : pl.icon) || undefined;
      const ln = { ...pl, name: d.name, icon, kind: a.kind || (icon ? kindOfIcon(icon) : pl.kind), tech: a.tech || undefined, status: (a.status as ArchStatus) || undefined, size, fields, parent: undefined as string | undefined };
      for (const k of Object.keys(ln) as (keyof typeof ln)[]) if (ln[k] === undefined) delete ln[k];
      const text = a.label ?? d.name;
      const sizeChanged = prev && (pl.size ?? "M") !== (size ?? "M");
      const fh = fields ? 40 + fields.length * 22 : h;
      out.push({
        id, type: "text", text, x: prev?.x ?? 0, y: prev?.y ?? 0,
        width: prev && !sizeChanged ? prev.width : fields ? 200 : w, height: prev && !sizeChanged && !fields ? prev.height : fh, ...(color ? { color } : {}), lumenNode: ln,
      } as ANode);
    }
  }
  // parents (after every id is known)
  const res = out.map((n, i) => {
    const p = doc.nodes[i].parent;
    const pid = p ? idOf.get(p) : undefined;
    if (n.type === "group") return { ...n, lumenGroup: { ...n.lumenGroup!, ...(pid ? { parent: pid } : {}) } };
    return pid ? { ...n, lumenNode: { ...n.lumenNode, parent: pid } } : n;
  }) as ANode[];
  for (const n of res) if (n.type === "group" && !n.lumenGroup?.parent) delete n.lumenGroup!.parent;
  // edges: reuse by pair + occurrence
  const pool = new Map<string, AEdge[]>();
  for (const e of c.edges) { const k = `${e.fromNode}>${e.toNode}`; pool.set(k, [...(pool.get(k) ?? []), e]); }
  const edges: AEdge[] = doc.edges.map((d) => {
    const from = idOf.get(d.from)!, to = idOf.get(d.to)!;
    const prev = pool.get(`${from}>${to}`)?.shift();
    let e: AEdge = { id: prev?.id ?? `e-${uid().slice(0, 8)}`, fromNode: from, toNode: to, ...(prev?.fromSide ? { fromSide: prev.fromSide } : {}), ...(prev?.toSide ? { toSide: prev.toSide } : {}), ...(prev?.color ? { color: prev.color } : {}) };
    if (d.label) e.label = d.label;
    e = setEnds(e, d.ends);
    const le = { ...(prev?.lumenEdge ?? {}), style: d.style ?? "sync" };
    e.lumenEdge = le;
    return e;
  });
  const next: ArchCanvas = { ...c, nodes: res, edges, lumenArch: { ...c.lumenArch, direction: doc.direction ?? c.lumenArch.direction ?? "right", dsl: text } };
  return placeNew(next, fresh);
}

/** Canvas changed (drag, rename, connect…): rewrite the cached DSL, keeping comments. */
export const withDsl = (c: ArchCanvas): ArchCanvas => ({ ...c, lumenArch: { ...c.lumenArch, dsl: printDsl(c, c.lumenArch.dsl) } });
/** The DSL to show: the cached text when it still describes this canvas (keeps formatting), else a fresh print. */
export function dslFor(c: ArchCanvas): string {
  const cached = c.lumenArch.dsl;
  if (cached) {
    const { doc, errors } = parseDsl(cached, c.lumenArch.kind);
    if (!errors.length && printDsl(applyDsl(c, doc, cached), cached) === printDsl(c, cached)) return cached;
  }
  return printDsl(c, cached);
}
export { fitGroups };
