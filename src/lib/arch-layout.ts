// Auto layout for architecture diagrams (48A–48B): elkjs "layered" with compound groups and orthogonal routing.
// elkjs (~1.5 MB) loads lazily, the first time Layout runs, and computes in a Web Worker so the board never freezes.
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import { fitGroups, hiddenBy, isGroup, parentOf, type ArchCanvas } from "./arch-model";
import { snapRoute } from "./arch-route";

export interface LayoutOpts { direction: "right" | "down"; spacing: "compact" | "roomy"; keep: boolean; scope: "all" | "selection" | "group"; ids?: Set<string> }

let elkP: Promise<{ layout: (g: ElkNode) => Promise<ElkNode> }> | null = null;
function elk() {
  elkP ??= Promise.all([import("elkjs/lib/elk-api.js"), import("elkjs/lib/elk-worker.min.js?url")]).then(([api, url]) => {
    const ELK = (api as unknown as { default: new (o: unknown) => { layout: (g: ElkNode) => Promise<ElkNode> } }).default;
    return new ELK({ workerFactory: () => new Worker(url.default) });
  });
  return elkP;
}

/** Geometry key of an edge's two endpoints: stored routes are used only while the nodes haven't moved. */
export const routeKey = (c: ArchCanvas, from: string, to: string) => {
  const a = c.nodes.find((n) => n.id === from), b = c.nodes.find((n) => n.id === to);
  return a && b ? [a.x, a.y, a.width, a.height, b.x, b.y, b.width, b.height].map(Math.round).join(",") : "";
};

export async function elkLayout(c: ArchCanvas, o: LayoutOpts): Promise<ArchCanvas> {
  const scopeIds = o.scope === "all" || !o.ids?.size ? null : o.ids;
  const inScope = (id: string) => !scopeIds || scopeIds.has(id);
  const by = new Map(c.nodes.map((n) => [n.id, n]));
  const visible = c.nodes.filter((n) => !hiddenBy(c, n.id) && inScope(n.id));
  const vis = new Set(visible.map((n) => n.id));
  const roomy = o.spacing === "roomy", down = o.direction === "down";
  // spacing must be set on every container: ELK doesn't inherit it into groups (nodes inside a group were packed 20 px apart)
  const spacing = { "elk.spacing.nodeNode": roomy ? "50" : "28", "elk.layered.spacing.nodeNodeBetweenLayers": roomy ? "80" : "48", "elk.spacing.edgeNode": "20", "elk.spacing.edgeEdge": "12" };
  const root: ElkNode = {
    id: "__root",
    layoutOptions: {
      "elk.algorithm": "layered", "elk.direction": o.direction === "down" ? "DOWN" : "RIGHT", "elk.edgeRouting": "ORTHOGONAL",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN", "elk.spacing.nodeNode": roomy ? "50" : "28", "elk.layered.spacing.nodeNodeBetweenLayers": roomy ? "80" : "48",
      "elk.spacing.edgeNode": "20", "elk.spacing.edgeEdge": "12", "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      ...(o.keep ? { "elk.layered.layering.strategy": "INTERACTIVE", "elk.layered.crossingMinimization.semiInteractive": "true", "elk.layered.cycleBreaking.strategy": "INTERACTIVE" } : {}),
    },
    children: [], edges: [],
  };
  const elkOf = new Map<string, ElkNode>([["__root", root]]);
  const make = (id: string): ElkNode => {
    if (elkOf.has(id)) return elkOf.get(id)!;
    const n = by.get(id)!;
    const group = isGroup(n) && !n.lumenGroup?.collapsed;
    const e: ElkNode = group
      ? { id, children: [], layoutOptions: { "elk.padding": "[top=40,left=24,bottom=24,right=24]", ...spacing }, ...(o.keep ? { x: n.x, y: n.y } : {}) }
      // one fixed port in the middle of the out / in side: the board draws every edge from the side centre, so ELK must too
      : { id, width: n.width, height: n.height, ...(o.keep ? { x: n.x, y: n.y } : {}), layoutOptions: { "elk.portConstraints": "FIXED_POS" },
          ports: down ? [{ id: `${id}__out`, x: n.width / 2, y: n.height, width: 0, height: 0, layoutOptions: { "elk.port.side": "SOUTH" } }, { id: `${id}__in`, x: n.width / 2, y: 0, width: 0, height: 0, layoutOptions: { "elk.port.side": "NORTH" } }]
            : [{ id: `${id}__out`, x: n.width, y: n.height / 2, width: 0, height: 0, layoutOptions: { "elk.port.side": "EAST" } }, { id: `${id}__in`, x: 0, y: n.height / 2, width: 0, height: 0, layoutOptions: { "elk.port.side": "WEST" } }] };
    elkOf.set(id, e);
    const p = parentOf(n);
    const parent = p && vis.has(p) ? make(p) : root;
    parent.children!.push(e);
    return e;
  };
  visible.forEach((n) => make(n.id));
  // drop empty groups' children arrays to sized boxes
  for (const n of visible) { const e = elkOf.get(n.id)!; if (e.children && !e.children.length) { delete e.children; e.width = n.width; e.height = n.height; } }
  const edges: ElkExtendedEdge[] = c.edges.filter((e) => vis.has(e.fromNode) && vis.has(e.toNode) && e.fromNode !== e.toNode && !isGroup(by.get(e.fromNode)!) && !isGroup(by.get(e.toNode)!))
    .map((e) => ({ id: e.id, sources: [`${e.fromNode}__out`], targets: [`${e.toNode}__in`] }));
  root.edges = edges;
  const res = await (await elk()).layout(root);
  // absolute positions
  const abs = new Map<string, { x: number; y: number; w: number; h: number }>();
  const walk = (n: ElkNode, ox: number, oy: number) => {
    for (const k of n.children ?? []) { const x = ox + (k.x ?? 0), y = oy + (k.y ?? 0); abs.set(k.id, { x, y, w: k.width ?? 0, h: k.height ?? 0 }); walk(k, x, y); }
  };
  walk(res, 0, 0);
  // keep the laid-out part where it was (top-left of the scope's old bounding box)
  const old = visible.filter((n) => !isGroup(n));
  const ox = old.length ? Math.min(...old.map((n) => n.x)) : 0, oy = old.length ? Math.min(...old.map((n) => n.y)) : 0;
  const leaves = [...abs].filter(([id]) => !isGroup(by.get(id)!) || by.get(id)!.lumenGroup?.collapsed);
  const nx = leaves.length ? Math.min(...leaves.map(([, p]) => p.x)) : 0, ny = leaves.length ? Math.min(...leaves.map(([, p]) => p.y)) : 0;
  const dx = ox - nx, dy = oy - ny;
  // children of collapsed groups move with them
  const nodes = c.nodes.map((n) => {
    const p = abs.get(n.id);
    if (p) return { ...n, x: Math.round(p.x + dx), y: Math.round(p.y + dy) };
    const h = hiddenBy(c, n.id);
    if (h && abs.has(h)) { const g = by.get(h)!, q = abs.get(h)!; return { ...n, x: Math.round(n.x + q.x + dx - g.x), y: Math.round(n.y + q.y + dy - g.y) }; }
    return n;
  });
  let next = fitGroups({ ...c, nodes, lumenArch: { ...c.lumenArch, direction: o.direction, layout: "elk-layered" } });
  // orthogonal routes from ELK (sections are relative to the edge's container)
  const routes = new Map<string, { x: number; y: number }[]>();
  const collect = (n: ElkNode) => {
    const off = n.id === "__root" ? { x: 0, y: 0 } : abs.get(n.id)!;
    for (const e of (n.edges ?? []) as ElkExtendedEdge[]) {
      const s = e.sections?.[0];
      if (!s) continue;
      const cont = (e as ElkExtendedEdge & { container?: string }).container;
      const base = cont && cont !== "__root" ? abs.get(cont) ?? off : off;
      routes.set(e.id, [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: Math.round(p.x + base.x + dx), y: Math.round(p.y + base.y + dy) })));
    }
    (n.children ?? []).forEach(collect);
  };
  collect(res);
  // ELK spreads several edges over a side; the board's ports sit at the side centres, so pin both ends there
  const byNext = new Map(next.nodes.map((n) => [n.id, n]));
  next = { ...next, edges: next.edges.map((e) => {
    const r = routes.get(e.id);
    if (!r) return e;
    const { fromSide: _a, toSide: _b, ...rest } = e;
    const a = byNext.get(e.fromNode), b = byNext.get(e.toNode);
    const sn = a && b && r.length >= 2 ? snapRoute(r, a, b) : null;
    const { points: _p, pointsKey: _k, manual: _m, ...le } = e.lumenEdge ?? {};
    return { ...rest, lumenEdge: { ...le, shape: "orthogonal", ...(sn && sn.pts.length > 2 ? { points: sn.pts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })), pointsKey: "" } : {}) } };
  }) };
  // stamp keys after positions are final
  next = { ...next, edges: next.edges.map((e) => (e.lumenEdge?.points && routes.has(e.id) ? { ...e, lumenEdge: { ...e.lumenEdge, pointsKey: routeKey(next, e.fromNode, e.toNode) } } : e)) };
  return next;
}
