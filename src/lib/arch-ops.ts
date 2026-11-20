// AI edits as minimal operations (round 7 · A2). The model still answers with a full DSL; instead of replacing the diagram
// with it, we diff it against the DSL it was given (parsed with the real parser), turn the difference into add / remove /
// rename / reconnect / set ops, apply those onto the CURRENT canvas JSON, and print the code from the canvas. Everything an op
// doesn't touch (ids, positions, bend points, label styles, DSL comments, fields the DSL can't express) stays as it was.
import { applyDsl, edgeKey, parseDsl, printDsl, type DslDoc, type DslEdge, type DslNode } from "./arch-dsl";
import type { ArchCanvas } from "./arch-model";

export type ArchOp =
  | { op: "addNode"; node: DslNode }
  | { op: "removeNode"; name: string }
  | { op: "renameNode"; from: string; to: string }
  | { op: "setNode"; name: string; attrs: Record<string, string>; parent: string | null; fields?: DslNode["fields"] }
  | { op: "addEdge"; edge: DslEdge }
  | { op: "removeEdge"; edge: DslEdge }
  | { op: "setEdge"; edge: DslEdge; to: DslEdge }
  | { op: "reconnect"; edge: DslEdge; to: DslEdge };

const sameAttrs = (a: Record<string, string>, b: Record<string, string>) => { const k = new Set([...Object.keys(a), ...Object.keys(b)]); for (const x of k) if ((a[x] ?? "") !== (b[x] ?? "")) return false; return true; };
const sameFields = (a: DslNode["fields"], b: DslNode["fields"]) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const lbl = (e: DslEdge) => e.label ?? "";
const edgeEq = (a: DslEdge, b: DslEdge) => a.ends === b.ends && (a.style ?? "sync") === (b.style ?? "sync") && lbl(a) === lbl(b);

/** Ops that turn the doc the AI was given (`base`) into the doc it wrote (`next`). */
export function diffDocs(base: DslDoc, next: DslDoc): ArchOp[] {
  const ops: ArchOp[] = [];
  const bN = new Map(base.nodes.map((n) => [n.name, n])), nN = new Map(next.nodes.map((n) => [n.name, n]));
  const gone = base.nodes.filter((n) => !nN.has(n.name)), born = next.nodes.filter((n) => !bN.has(n.name));
  // renames: a removed and an added node with the same parent / kind that look alike (icon, position in the file, neighbours)
  const nb = (d: DslDoc, name: string) => new Set(d.edges.filter((e) => e.from === name || e.to === name).map((e) => (e.from === name ? e.to : e.from)));
  const rename = new Map<string, string>(); // old name → new name
  const takenNew = new Set<string>();
  for (const r of gone) {
    let best: DslNode | null = null, bs = 0;
    for (const a of born) {
      if (takenNew.has(a.name) || a.isGroup !== r.isGroup || (a.parent ?? null) !== (r.parent ?? null)) continue;
      const rn = nb(base, r.name), an = nb(next, a.name);
      let score = 0;
      if (r.attrs.icon && r.attrs.icon === a.attrs.icon) score += 2;
      if (r.attrs.tech && r.attrs.tech === a.attrs.tech) score += 1;
      for (const x of rn) if (an.has(x) || (rename.get(x) && an.has(rename.get(x)!))) score += 2;
      if (r.line === a.line || Math.abs(base.nodes.indexOf(r) - next.nodes.indexOf(a)) <= 1) score += 1;
      if (score > bs) { bs = score; best = a; }
    }
    if (best && bs >= 3) { rename.set(r.name, best.name); takenNew.add(best.name); }
  }
  const nm = (n: string) => rename.get(n) ?? n;
  for (const [from, to] of rename) ops.push({ op: "renameNode", from, to });
  for (const r of gone) if (!rename.has(r.name)) ops.push({ op: "removeNode", name: r.name });
  for (const a of born) if (!takenNew.has(a.name)) ops.push({ op: "addNode", node: a });
  for (const o of base.nodes) {
    const n = nN.get(nm(o.name));
    if (!n || (!bN.has(n.name) && !rename.has(o.name))) continue;
    if (!sameAttrs(o.attrs, n.attrs) || (o.parent ? nm(o.parent) : null) !== (n.parent ?? null) || !sameFields(o.fields, n.fields)) ops.push({ op: "setNode", name: n.name, attrs: n.attrs, parent: n.parent, fields: n.fields });
  }
  // edges: compare in the new names; match by pair (same label first, then order), the rest are added / removed / reconnected
  const oldE = base.edges.map((e) => ({ ...e, from: nm(e.from), to: nm(e.to) }));
  const used = new Set<number>(), matchedOld = new Set<number>();
  const pairOf = (e: DslEdge) => `${e.from}>${e.to}`;
  const pass = (strict: boolean) => next.edges.forEach((ne, j) => {
    if (used.has(j)) return;
    const i = oldE.findIndex((oe, k) => !matchedOld.has(k) && pairOf(oe) === pairOf(ne) && (!strict || lbl(oe) === lbl(ne)));
    if (i < 0) return;
    used.add(j); matchedOld.add(i);
    if (!edgeEq(oldE[i], ne)) ops.push({ op: "setEdge", edge: base.edges[i], to: ne });
  });
  pass(true); pass(false);
  const lost = oldE.map((e, k) => k).filter((k) => !matchedOld.has(k)), fresh = next.edges.map((e, j) => j).filter((j) => !used.has(j));
  for (const j of fresh) {
    const ne = next.edges[j];
    const k = lost.find((x) => lbl(oldE[x]) === lbl(ne) && (oldE[x].from === ne.from || oldE[x].to === ne.to));
    if (k !== undefined) { lost.splice(lost.indexOf(k), 1); ops.push({ op: "reconnect", edge: base.edges[k], to: ne }); } else ops.push({ op: "addEdge", edge: ne });
  }
  for (const k of lost) ops.push({ op: "removeEdge", edge: base.edges[k] });
  return ops;
}

/** Apply ops onto a doc (the current canvas as DSL). Names the ops can't find are skipped, never invented. */
export function applyOpsToDoc(doc: DslDoc, ops: ArchOp[]): { doc: DslDoc; renames: Map<string, string> } {
  const nodes = doc.nodes.map((n) => ({ ...n, attrs: { ...n.attrs } }));
  let edges = doc.edges.map((e) => ({ ...e }));
  const renames = new Map<string, string>(); // new name → old name
  const find = (name: string) => nodes.find((n) => n.name === name);
  const insertAfterLastSibling = (n: DslNode) => {
    let at = -1;
    nodes.forEach((x, i) => { if ((x.parent ?? null) === (n.parent ?? null) || x.name === n.parent) at = i; });
    nodes.splice(at < 0 ? nodes.length : at + 1, 0, n);
  };
  for (const o of ops) {
    if (o.op === "renameNode") {
      const n = find(o.from);
      if (!n || find(o.to)) continue;
      renames.set(o.to, renames.get(o.from) ?? o.from); renames.delete(o.from);
      for (const x of nodes) if (x.parent === o.from) x.parent = o.to;
      edges = edges.map((e) => ({ ...e, from: e.from === o.from ? o.to : e.from, to: e.to === o.from ? o.to : e.to }));
      n.name = o.to;
    } else if (o.op === "removeNode") {
      const gone = new Set<string>([o.name]);
      for (let grew = true; grew;) { grew = false; for (const x of nodes) if (x.parent && gone.has(x.parent) && !gone.has(x.name)) { gone.add(x.name); grew = true; } }
      for (let i = nodes.length - 1; i >= 0; i--) if (gone.has(nodes[i].name)) nodes.splice(i, 1);
      edges = edges.filter((e) => !gone.has(e.from) && !gone.has(e.to));
    } else if (o.op === "addNode") {
      if (!find(o.node.name)) insertAfterLastSibling({ ...o.node, attrs: { ...o.node.attrs }, implicit: false });
    } else if (o.op === "setNode") {
      const n = find(o.name);
      if (n) { n.attrs = { ...o.attrs }; n.parent = o.parent; if (o.fields) n.fields = o.fields; else delete n.fields; }
    } else if (o.op === "addEdge") {
      edges.push({ ...o.edge });
    } else if (o.op === "removeEdge") {
      const i = edges.findIndex((e) => e.from === o.edge.from && e.to === o.edge.to && lbl(e) === lbl(o.edge));
      if (i >= 0) edges.splice(i, 1);
    } else if (o.op === "setEdge" || o.op === "reconnect") {
      const i = edges.findIndex((e) => e.from === o.edge.from && e.to === o.edge.to && lbl(e) === lbl(o.edge));
      if (i >= 0) edges[i] = { ...o.to, line: edges[i].line }; else edges.push({ ...o.to });
    }
  }
  // edges to nodes that don't exist (the model referred to a name it never declared) get an implicit node, like the parser does
  for (const e of edges) for (const nmx of [e.from, e.to]) if (!find(nmx)) nodes.push({ name: nmx, attrs: {}, parent: null, line: 0, isGroup: false, implicit: true });
  const seen = new Map<string, number>();
  edges = edges.map((e) => { const p = `${e.from}>${e.to}`, k = seen.get(p) ?? 0; seen.set(p, k + 1); return { ...e, key: edgeKey(e.from, e.to, k) }; });
  return { doc: { ...doc, nodes, edges }, renames };
}

export interface MinimalEdit { canvas: ArchCanvas; dsl: string; ops: ArchOp[] }
/**
 * Apply the AI's answer `newDsl` (written for `baseDsl`) as minimal ops onto `c`. Returns the merged canvas, the code printed
 * from it (comments kept) and the ops. Throws when either DSL fails the real parser.
 */
export function applyMinimalEdit(c: ArchCanvas, baseDsl: string, newDsl: string): MinimalEdit {
  const kind = c.lumenArch.kind;
  const base = parseDsl(baseDsl, kind), nxt = parseDsl(newDsl, kind);
  if (nxt.errors.length) throw new Error(`line ${nxt.errors[0].line}: ${nxt.errors[0].message}`);
  const ops = diffDocs(base.doc, nxt.doc);
  // the canvas as a doc (the AI saw `baseDsl`, which is what the canvas prints, unless the user typed since: then use the canvas)
  const cur = parseDsl(printDsl(c, c.lumenArch.dsl), kind).doc;
  const { doc, renames } = applyOpsToDoc(cur, ops);
  const merged = applyDsl(c, doc, "", undefined, renames);
  const dsl = printDsl(merged, c.lumenArch.dsl);
  return { canvas: { ...merged, lumenArch: { ...merged.lumenArch, dsl } }, dsl, ops };
}

/** Human summary of the ops ("Added Cache · renamed API → Gateway…"). */
export function opsSummary(ops: ArchOp[]) {
  const c = (k: ArchOp["op"]) => ops.filter((o) => o.op === k).length;
  return { added: c("addNode") + c("addEdge"), removed: c("removeNode") + c("removeEdge"), renamed: c("renameNode"), reconnected: c("reconnect"), changed: c("setNode") + c("setEdge") };
}
