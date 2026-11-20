// Architecture studio conversions: canvas → Mermaid (architecture-beta, flowchart, erDiagram, C4, sequence) and
// Mermaid / draw.io XML / SQL DDL → Lumen DSL (paste-in conversion and the Mermaid tab's write-back).
import { GLYPHS } from "./glyphs";
import { displayOf, edgeSides, endsOf, isGroup, nameOf, parentOf, type AEdge, type ANode, type ArchCanvas, type ArchKind } from "./arch-model";

export type MermaidFlavor = "architecture-beta" | "flowchart" | "erDiagram" | "c4" | "sequence";
export const MERMAID_FLAVORS: MermaidFlavor[] = ["architecture-beta", "flowchart", "erDiagram", "c4", "sequence"];
export function defaultFlavor(k: ArchKind): MermaidFlavor {
  return k === "erd" || k === "class" ? "erDiagram" : k === "c4" ? "c4" : k === "sequence" ? "sequence" : k === "flowchart" || k === "state" || k === "bpmn" ? "flowchart" : "architecture-beta";
}
export const slug = (s: string) => (s.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").toLowerCase() || "n").replace(/^(\d)/, "n$1");
const esc = (s: string) => s.replace(/[[\]{}()"|<>]/g, " ").replace(/\s+/g, " ").trim();
const SIDE_L = { top: "T", right: "R", bottom: "B", left: "L" } as const;

function ids(c: ArchCanvas) {
  const m = new Map<string, string>(), taken = new Set<string>();
  for (const n of c.nodes) { let s = slug(nameOf(n)), k = 2; while (taken.has(s)) s = `${slug(nameOf(n))}${k++}`; taken.add(s); m.set(n.id, s); }
  return m;
}
const archIcon = (n: ANode) => {
  const i = n.lumenNode?.icon ?? "";
  return /database|vector-db|warehouse/.test(i) ? "database" : /bucket|file|lake|queue|topic|stream/.test(i) ? "disk" : /user|owner|external|gateway|cdn|internet|browser|mobile|payment/.test(i) ? "internet" : "server";
};

export function toMermaid(c: ArchCanvas, flavor: MermaidFlavor = defaultFlavor(c.lumenArch.kind)): string {
  const id = ids(c);
  const by = new Map(c.nodes.map((n) => [n.id, n]));
  const L: string[] = [];
  const lr = c.lumenArch.direction === "down" ? "TB" : "LR";
  const label = (e: AEdge) => (e.label ? esc(e.label) : "");
  if (flavor === "architecture-beta") {
    L.push("architecture-beta");
    for (const n of c.nodes.filter(isGroup)) { const p = parentOf(n); L.push(`  group ${id.get(n.id)}(cloud)[${esc([displayOf(n), n.lumenGroup?.sub ?? ""].filter(Boolean).join(" "))}]${p && by.has(p) ? ` in ${id.get(p)}` : ""}`); }
    for (const n of c.nodes.filter((x) => !isGroup(x))) {
      const p = parentOf(n);
      if (n.lumenNode?.kind === "junction") L.push(`  junction ${id.get(n.id)}${p && by.has(p) ? ` in ${id.get(p)}` : ""}`);
      else L.push(`  service ${id.get(n.id)}(${archIcon(n)})[${esc(displayOf(n))}]${p && by.has(p) ? ` in ${id.get(p)}` : ""}`);
    }
    for (const e of c.edges) {
      const a = by.get(e.fromNode), b = by.get(e.toNode);
      if (!a || !b || isGroup(a) || isGroup(b)) continue;
      const [fs, ts] = [e.fromSide, e.toSide].every(Boolean) ? [e.fromSide!, e.toSide!] : edgeSides(a, b);
      const ends = endsOf(e);
      L.push(`  ${id.get(a.id)}:${SIDE_L[fs]} ${ends === "both" ? "<-->" : ends === "none" ? "--" : "-->"} ${SIDE_L[ts]}:${id.get(b.id)}`);
    }
  } else if (flavor === "flowchart") {
    L.push(`flowchart ${lr}`);
    const kids = new Map<string | undefined, ANode[]>();
    for (const n of c.nodes) { const p = parentOf(n); const k = p && by.has(p) ? p : undefined; kids.set(k, [...(kids.get(k) ?? []), n]); }
    const shape = (n: ANode) => {
      const t = esc(displayOf(n)) || id.get(n.id)!, i = n.lumenNode?.icon ?? "";
      return /database|vector-db|warehouse/.test(i) ? `[(${t})]` : i === "decision" ? `{${t}}` : i === "terminator" ? `([${t}])` : /user|owner|actor/.test(i) ? `((${t}))` : `[${t}]`;
    };
    const walk = (p: string | undefined, ind: string) => {
      for (const n of kids.get(p) ?? []) {
        if (isGroup(n)) { L.push(`${ind}subgraph ${id.get(n.id)}[${esc(displayOf(n))}]`); walk(n.id, ind + "  "); L.push(`${ind}end`); }
        else L.push(`${ind}${id.get(n.id)}${shape(n)}`);
      }
    };
    walk(undefined, "  ");
    for (const e of c.edges) {
      const dashed = e.lumenEdge?.style === "async", ends = endsOf(e);
      const op = dashed ? (ends === "both" ? "<-.->" : ends === "none" ? "-.-" : "-.->") : e.lumenEdge?.style === "data" ? (ends === "none" ? "===" : "==>") : ends === "both" ? "<-->" : ends === "none" ? "---" : "-->";
      L.push(`  ${id.get(e.fromNode)} ${op}${label(e) ? `|${label(e)}|` : ""} ${id.get(e.toNode)}`);
    }
  } else if (flavor === "erDiagram") {
    L.push("erDiagram");
    for (const n of c.nodes.filter((x) => !isGroup(x))) {
      const f = n.lumenNode?.fields;
      if (!f?.length) { L.push(`  ${id.get(n.id)} {`, "  }"); continue; }
      L.push(`  ${id.get(n.id)} {`);
      for (const x of f) L.push(`    ${slug(x.type || "string")} ${slug(x.name)}${x.key ? ` ${/pk/i.test(x.key) ? "PK" : /fk/i.test(x.key) ? "FK" : "UK"}` : ""}`);
      L.push("  }");
    }
    for (const e of c.edges) L.push(`  ${id.get(e.fromNode)} ||--o{ ${id.get(e.toNode)} : "${label(e) || "has"}"`);
  } else if (flavor === "c4") {
    const lvl = c.lumenArch.c4?.level ?? "container";
    L.push(lvl === "context" ? "C4Context" : lvl === "component" ? "C4Component" : "C4Container");
    const kids = new Map<string | undefined, ANode[]>();
    for (const n of c.nodes) { const p = parentOf(n); const k = p && by.has(p) ? p : undefined; kids.set(k, [...(kids.get(k) ?? []), n]); }
    const el = (n: ANode) => {
      const i = n.lumenNode?.icon ?? "", t = `"${esc(displayOf(n))}"`, tech = `"${esc(n.lumenNode?.tech ?? "")}"`, d = `"${esc(n.lumenNode?.description ?? "")}"`;
      if (/user|owner|actor|team/.test(i)) return `Person(${id.get(n.id)}, ${t}, ${d})`;
      if (/external/.test(i)) return `System_Ext(${id.get(n.id)}, ${t}, ${d})`;
      if (lvl === "context") return `System(${id.get(n.id)}, ${t}, ${d})`;
      const base = lvl === "component" ? "Component" : "Container";
      return `${base}${/database|vector-db|warehouse/.test(i) ? "Db" : /queue|topic|stream/.test(i) ? "Queue" : ""}(${id.get(n.id)}, ${t}, ${tech}, ${d})`;
    };
    const walk = (p: string | undefined, ind: string) => {
      for (const n of kids.get(p) ?? []) {
        if (isGroup(n)) { L.push(`${ind}${lvl === "context" ? "Enterprise_Boundary" : lvl === "component" ? "Container_Boundary" : "System_Boundary"}(${id.get(n.id)}, "${esc(displayOf(n))}") {`); walk(n.id, ind + "  "); L.push(`${ind}}`); }
        else L.push(`${ind}${el(n)}`);
      }
    };
    walk(undefined, "  ");
    for (const e of c.edges) L.push(`  Rel(${id.get(e.fromNode)}, ${id.get(e.toNode)}, "${label(e)}"${e.lumenEdge?.protocol ? `, "${esc(e.lumenEdge.protocol)}"` : ""})`);
  } else {
    L.push("sequenceDiagram");
    for (const n of c.nodes.filter((x) => !isGroup(x))) L.push(`  ${/user|owner|actor/.test(n.lumenNode?.icon ?? "") ? "actor" : "participant"} ${id.get(n.id)} as ${esc(displayOf(n))}`);
    for (const e of c.edges) L.push(`  ${id.get(e.fromNode)}${e.lumenEdge?.style === "async" ? "-)" : endsOf(e) === "none" ? "-->>" : "->>"}${id.get(e.toNode)}: ${label(e) || " "}`);
  }
  return L.join("\n") + "\n";
}

// ------------------------------------------------------------------ → DSL
const qn = (s: string) => (/^[\p{L}\p{N}_][\p{L}\p{N}_ .'/&+]*$/u.test(s) ? s : `"${s.replace(/"/g, "'")}"`);
const qs = (s: string) => `"${s.replace(/"/g, "'")}"`;
interface Gen { name: string; label?: string; icon?: string; tech?: string; parent?: string; group?: boolean; fields?: string[] }
function emit(nodes: Gen[], edges: { a: string; b: string; label?: string; op?: string; style?: string }[], dir: "right" | "down" = "right"): string {
  const out = [`direction ${dir}`];
  const kids = new Map<string | undefined, Gen[]>();
  const names = new Set(nodes.map((n) => n.name));
  for (const n of nodes) { const k = n.parent && names.has(n.parent) ? n.parent : undefined; kids.set(k, [...(kids.get(k) ?? []), n]); }
  const walk = (p: string | undefined, ind: string) => {
    for (const n of kids.get(p) ?? []) {
      const attrs = [n.icon && `icon: ${n.icon}`, n.label && n.label !== n.name && `label: ${qs(n.label)}`, n.tech && `tech: ${qs(n.tech)}`].filter(Boolean);
      const head = `${ind}${qn(n.name)}${attrs.length ? ` [${attrs.join(", ")}]` : ""}`;
      if (n.group || n.fields) { out.push(`${head} {`); if (n.fields) n.fields.forEach((f) => out.push(`${ind}  ${f}`)); else walk(n.name, ind + "  "); out.push(`${ind}}`); }
      else out.push(head);
    }
  };
  walk(undefined, "");
  for (const e of edges) out.push(`${qn(e.a)} ${e.op ?? ">"} ${qn(e.b)}${e.label ? `: ${/[:"]/.test(e.label) ? qs(e.label) : e.label}` : ""}${e.style ? ` (${e.style})` : ""}`);
  return out.join("\n") + "\n";
}

export type PasteKind = "mermaid-flowchart" | "mermaid-architecture" | "mermaid-er" | "mermaid-c4" | "mermaid-sequence" | "drawio" | "sql";
export function detectPaste(text: string): PasteKind | null {
  const t = text.trim();
  if (/^<mxfile|^<mxGraphModel|<mxCell\b/.test(t)) return "drawio";
  if (/^\s*create\s+table\b/im.test(t)) return "sql";
  const first = t.split("\n").find((l) => l.trim() && !/^\s*%%/.test(l))?.trim() ?? "";
  if (/^(flowchart|graph)\b/.test(first)) return "mermaid-flowchart";
  if (/^architecture-beta\b/.test(first)) return "mermaid-architecture";
  if (/^erDiagram\b/.test(first)) return "mermaid-er";
  if (/^C4(Context|Container|Component|Dynamic|Deployment)\b/.test(first)) return "mermaid-c4";
  if (/^sequenceDiagram\b/.test(first)) return "mermaid-sequence";
  return null;
}
export const PASTE_LABEL: Record<PasteKind, string> = {
  "mermaid-flowchart": "Mermaid flowchart", "mermaid-architecture": "Mermaid architecture diagram", "mermaid-er": "Mermaid ER diagram",
  "mermaid-c4": "Mermaid C4 diagram", "mermaid-sequence": "Mermaid sequence diagram", drawio: "draw.io diagram", sql: "SQL schema",
};

/** Convert pasted text to DSL. `known` maps Mermaid ids back to existing DSL names (keeps positions on write-back). */
export function toDsl(text: string, kind: PasteKind, known: Map<string, string> = new Map()): { dsl: string; archKind?: ArchKind } {
  if (kind === "drawio") return { dsl: fromDrawio(text) };
  if (kind === "sql") return { dsl: fromSql(text), archKind: "erd" };
  if (kind === "mermaid-er") return { dsl: fromEr(text, known), archKind: "erd" };
  if (kind === "mermaid-architecture") return { dsl: fromArchBeta(text, known) };
  if (kind === "mermaid-c4") return { dsl: fromC4(text, known), archKind: "c4" };
  if (kind === "mermaid-sequence") return { dsl: fromSeq(text, known), archKind: "sequence" };
  return { dsl: fromFlowchart(text, known) };
}
const nm = (id: string, label: string | undefined, known: Map<string, string>) => known.get(id) ?? (label?.trim() || id);

function fromFlowchart(text: string, known: Map<string, string>): string {
  const nodes = new Map<string, Gen>(), edges: { a: string; b: string; label?: string; op?: string; style?: string }[] = [];
  const stack: string[] = [];
  let dir: "right" | "down" = "right";
  const SH = /^([\w.-]+)\s*(\[\(|\(\[|\(\(|\[\[|\[\/|\[\\|\[|\(|\{\{|\{|>)(.*?)(\)\]|\]\)|\)\)|\]\]|\/\]|\\\]|\]|\)|\}\}|\})?$/;
  const node = (tok: string): string | null => {
    const s = tok.trim().replace(/:::\w+$/, "");
    if (!s) return null;
    const m = SH.exec(s);
    const id = m ? m[1] : s.split(/\s/)[0];
    const raw = m?.[3]?.replace(/^"|"$/g, "");
    const icon = m ? (m[2] === "[(" ? "database" : m[2] === "{" || m[2] === "{{" ? "decision" : m[2] === "([" ? "terminator" : m[2] === "((" ? "owner" : "process") : undefined;
    const prev = nodes.get(id);
    if (!prev) nodes.set(id, { name: nm(id, raw, known), ...(raw && known.has(id) && raw !== known.get(id) ? { label: raw } : {}), icon, parent: stack[stack.length - 1] });
    else if (raw && !known.has(id)) { prev.name = raw; if (icon) prev.icon = icon; }
    return id;
  };
  for (const raw of text.split("\n")) {
    const l = raw.replace(/%%.*$/, "").trim();
    if (!l) continue;
    const h = /^(flowchart|graph)\s+(\w+)/.exec(l);
    if (h) { dir = /^(TB|TD|BT)$/i.test(h[2]) ? "down" : "right"; continue; }
    const sg = /^subgraph\s+([\w.-]+)\s*(?:\[(.*)\])?/.exec(l);
    if (sg) { const id = sg[1]; nodes.set(id, { name: nm(id, sg[2]?.replace(/^"|"$/g, ""), known), group: true, parent: stack[stack.length - 1] }); stack.push(id); continue; }
    if (l === "end") { stack.pop(); continue; }
    if (/^(classDef|class|style|linkStyle|click|direction)\b/.test(l)) continue;
    // split on links: -->, ---, -.->, ==>, with |label| or -- text -->
    const parts = l.split(/\s*(<?-\.+->?|<?==+>?|<?--+>?|-- .+? -->|-- .+? ---)\s*/);
    if (parts.length === 1) { node(l); continue; }
    let prevId: string | null = null, pending: { op: string; label?: string } | null = null;
    for (let i = 0; i < parts.length; i++) {
      let p = parts[i];
      if (i % 2 === 1) {
        const mid = /^-- (.+?) --[->]$/.exec(p);
        pending = { op: mid ? (p.endsWith(">") ? "-->" : "---") : p, label: mid?.[1] };
        continue;
      }
      let label: string | undefined;
      const lm = /^\|([^|]*)\|\s*(.*)$/.exec(p);
      if (lm) { label = lm[1]; p = lm[2]; }
      const ids = p.split("&").map(node).filter(Boolean) as string[];
      if (prevId && pending) {
        const op = pending.op, dotted = op.includes("."), thick = op.includes("=");
        const both = op.startsWith("<"), none = !op.endsWith(">");
        for (const b of ids) edges.push({ a: nodes.get(prevId)!.name, b: nodes.get(b)!.name, label: label ?? pending.label, op: both ? "<>" : none ? "-" : ">", style: dotted ? "async" : thick ? "data" : undefined });
      }
      prevId = ids[ids.length - 1] ?? prevId;
      pending = null;
    }
  }
  const byId = new Map([...nodes].map(([id, n]) => [id, n.name]));
  return emit([...nodes.values()].map((n) => ({ ...n, parent: n.parent ? byId.get(n.parent) : undefined })), edges, dir);
}

function fromArchBeta(text: string, known: Map<string, string>): string {
  const nodes = new Map<string, Gen>(), edges: { a: string; b: string; op?: string }[] = [];
  const ICON: Record<string, string> = { database: "database", disk: "bucket", internet: "internet", cloud: "region", server: "server" };
  for (const raw of text.split("\n")) {
    const l = raw.replace(/%%.*$/, "").trim();
    const g = /^(group|service)\s+([\w-]+)(?:\(([\w:-]+)\))?(?:\[(.*?)\])?(?:\s+in\s+([\w-]+))?$/.exec(l);
    if (g) {
      const [, kw, id, icon, label, parent] = g;
      const isG = kw === "group";
      const ic = icon?.replace(/^\w+:/, "");
      nodes.set(id, { name: nm(id, label, known), ...(label && known.has(id) && label !== known.get(id) ? { label } : {}), icon: isG ? undefined : (ic && (ICON[ic] ?? (GLYPHS[ic] ? ic : undefined))) || "service", group: isG, parent });
      continue;
    }
    const j = /^junction\s+([\w-]+)(?:\s+in\s+([\w-]+))?$/.exec(l);
    if (j) { nodes.set(j[1], { name: nm(j[1], undefined, known), icon: "junction", parent: j[2] }); continue; }
    const e = /^([\w-]+)(?:\{group\})?(?::[TBLR])?\s*(<?-->?|--)\s*(?:[TBLR]:)?([\w-]+)/.exec(l);
    if (e && nodes.has(e[1]) && nodes.has(e[3])) edges.push({ a: e[1], b: e[3], op: e[2] === "<-->" ? "<>" : e[2] === "--" ? "-" : ">" });
  }
  const byId = new Map([...nodes].map(([id, n]) => [id, n.name]));
  return emit([...nodes.values()].map((n) => ({ ...n, parent: n.parent ? byId.get(n.parent) : undefined })), edges.map((e) => ({ ...e, a: byId.get(e.a)!, b: byId.get(e.b)! })));
}

function fromEr(text: string, known: Map<string, string>): string {
  const ents = new Map<string, Gen>(), edges: { a: string; b: string; label?: string }[] = [];
  let cur: Gen | null = null;
  const ent = (id: string) => { if (!ents.has(id)) ents.set(id, { name: nm(id, undefined, known), icon: "database", fields: [] }); return ents.get(id)!; };
  for (const raw of text.split("\n")) {
    const l = raw.replace(/%%.*$/, "").trim();
    if (!l || l === "erDiagram") continue;
    if (cur) { if (l === "}") { cur = null; continue; } const [ty, name, key] = l.split(/\s+/); if (name) cur.fields!.push([name, ty, key?.toLowerCase()].filter(Boolean).join(" ")); continue; }
    const b = /^([\w-]+)\s*\{$/.exec(l);
    if (b) { cur = ent(b[1]); continue; }
    const r = /^([\w-]+)\s+[|}o][|o]?(?:--|\.\.)[|{o][|o]?\s+([\w-]+)\s*:\s*"?([^"]*)"?/.exec(l);
    if (r) { ent(r[1]); ent(r[2]); edges.push({ a: ents.get(r[1])!.name, b: ents.get(r[2])!.name, label: r[3] || undefined }); }
  }
  return emit([...ents.values()], edges);
}

function fromC4(text: string, known: Map<string, string>): string {
  const nodes = new Map<string, Gen>(), edges: { a: string; b: string; label?: string }[] = [];
  const stack: string[] = [];
  const args = (s: string) => [...s.matchAll(/"([^"]*)"|([^,\s][^,]*)/g)].map((m) => (m[1] ?? m[2]).trim());
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (l === "}") { stack.pop(); continue; }
    const m = /^(\w+)\((.*)\)\s*(\{)?$/.exec(l);
    if (!m) continue;
    const [, fn, inner, open] = m, a = args(inner);
    if (/^(Rel|BiRel|Rel_\w+)$/.test(fn)) { if (nodes.has(a[0]) && nodes.has(a[1])) edges.push({ a: nodes.get(a[0])!.name, b: nodes.get(a[1])!.name, label: a[2] }); continue; }
    if (/Boundary$/.test(fn)) { nodes.set(a[0], { name: nm(a[0], a[1], known), group: true, parent: stack[stack.length - 1] }); if (open) stack.push(a[0]); continue; }
    const icon = /^Person/.test(fn) ? "owner" : /_Ext$/.test(fn) ? "external-system" : /Db/.test(fn) ? "database" : /Queue/.test(fn) ? "queue" : /^Component/.test(fn) ? "service" : /^Container/.test(fn) ? "container" : "service";
    const tech = /^(Container|Component)/.test(fn) ? a[2] : undefined;
    nodes.set(a[0], { name: nm(a[0], a[1], known), icon, tech: tech || undefined, parent: stack[stack.length - 1] });
  }
  const byId = new Map([...nodes].map(([id, n]) => [id, n.name]));
  return emit([...nodes.values()].map((n) => ({ ...n, parent: n.parent ? byId.get(n.parent) : undefined })), edges);
}

function fromSeq(text: string, known: Map<string, string>): string {
  const nodes = new Map<string, Gen>(), edges: { a: string; b: string; label?: string; style?: string; op?: string }[] = [];
  const p = (id: string, label?: string, actor = false) => { if (!nodes.has(id)) nodes.set(id, { name: nm(id, label, known), icon: actor ? "owner" : "service" }); return nodes.get(id)!.name; };
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    const d = /^(participant|actor)\s+([\w-]+)(?:\s+as\s+(.+))?$/.exec(l);
    if (d) { p(d[2], d[3], d[1] === "actor"); continue; }
    const m = /^([\w-]+)\s*(-->>|->>|-->|->|-\)|--\)|-x|--x)\s*\+?-?([\w-]+)\s*:\s*(.*)$/.exec(l);
    if (m) edges.push({ a: p(m[1]), b: p(m[3]), label: m[4].trim() || undefined, style: m[2].includes(")") ? "async" : undefined, op: m[2].startsWith("--") && !m[2].includes(")") ? "-->" : ">" });
  }
  return emit([...nodes.values()], edges);
}

function fromDrawio(text: string): string {
  let xml = text;
  const doc0 = new DOMParser().parseFromString(xml, "text/xml");
  // compressed diagrams (<diagram>base64-deflate</diagram>) are not inflated here; uncompressed models are the common export
  if (!doc0.querySelector("mxCell") && doc0.querySelector("diagram")) xml = doc0.querySelector("diagram")?.textContent ?? xml;
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const cells = [...doc.querySelectorAll("mxCell")];
  const strip = (s: string | null) => (s ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  const verts = cells.filter((c) => c.getAttribute("vertex") === "1");
  const parents = new Set(verts.map((c) => c.getAttribute("parent")));
  const names = new Map<string, string>();
  const taken = new Set<string>();
  const nodes: Gen[] = [];
  for (const c of verts) {
    const id = c.getAttribute("id")!, style = c.getAttribute("style") ?? "";
    let name = strip(c.getAttribute("value")) || id, k = 2;
    while (taken.has(name)) name = `${strip(c.getAttribute("value")) || id} ${k++}`;
    taken.add(name); names.set(id, name);
    const group = parents.has(id) || /swimlane|group|container=1/.test(style);
    const icon = /cylinder|database/.test(style) ? "database" : /actor|umlActor/.test(style) ? "owner" : /rhombus/.test(style) ? "decision" : /queue/.test(style) ? "queue" : /cloud/.test(style) ? "internet" : group ? undefined : "service";
    nodes.push({ name, icon, group, parent: c.getAttribute("parent") ?? undefined });
  }
  for (const n of nodes) n.parent = n.parent ? names.get(n.parent) : undefined;
  const edges = cells.filter((c) => c.getAttribute("edge") === "1" && names.has(c.getAttribute("source") ?? "") && names.has(c.getAttribute("target") ?? ""))
    .map((c) => ({ a: names.get(c.getAttribute("source")!)!, b: names.get(c.getAttribute("target")!)!, label: strip(c.getAttribute("value")) || undefined, style: /dashed=1/.test(c.getAttribute("style") ?? "") ? "async" : undefined }));
  return emit(nodes, edges);
}

function fromSql(text: string): string {
  const ents: Gen[] = [], edges: { a: string; b: string; label?: string }[] = [];
  const clean = text.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of clean.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?[`"[]?([\w.]+)[`"\]]?\s*\(([\s\S]*?)\)\s*;/gi)) {
    const table = m[1].split(".").pop()!;
    const fields: string[] = [];
    const parts = m[2].split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      const fk = /^(?:constraint\s+\w+\s+)?foreign\s+key\s*\(([^)]+)\)\s*references\s+[`"[]?([\w.]+)/i.exec(p);
      if (fk) { edges.push({ a: fk[2].split(".").pop()!, b: table, label: fk[1].replace(/[`"\s]/g, "") }); continue; }
      if (/^(primary|unique|constraint|key|index|check)\b/i.test(p)) continue;
      const c = /^[`"[]?(\w+)[`"\]]?\s+([\w]+(?:\([^)]*\))?)(.*)$/i.exec(p);
      if (!c) continue;
      const key = /primary\s+key/i.test(c[3]) ? "pk" : /references/i.test(c[3]) ? "fk" : "";
      fields.push([c[1], c[2].toLowerCase(), key].filter(Boolean).join(" "));
      const ref = /references\s+[`"[]?([\w.]+)/i.exec(c[3]);
      if (ref) edges.push({ a: ref[1].split(".").pop()!, b: table, label: c[1] });
    }
    ents.push({ name: table, icon: "database", fields });
  }
  const names = new Set(ents.map((e) => e.name));
  return emit(ents, edges.filter((e) => names.has(e.a) && names.has(e.b)));
}

// ------------------------------------------------------------------ Mermaid icon pack (lazy)
let packed = false;
/** Register the Lumen glyphs as a Mermaid icon pack (`lumen:service`, `lumen:database`…) for architecture-beta renders. */
export async function registerArchIcons(): Promise<void> {
  if (packed) return;
  const m = (await import("mermaid")).default as unknown as { registerIconPacks?: (p: unknown[]) => void };
  if (!m.registerIconPacks) return;
  const icons: Record<string, { body: string }> = {};
  for (const [k, parts] of Object.entries(GLYPHS)) {
    icons[k] = { body: `<g fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${parts.map((p) => typeof p === "string" ? `<path d="${p}"/>` : `<path d="${p.d}"${p.fill ? ' fill="currentColor" stroke="none"' : ""}/>`).join("")}</g>` };
  }
  m.registerIconPacks([{ name: "lumen", icons: { prefix: "lumen", width: 24, height: 24, icons } }]);
  packed = true;
}
