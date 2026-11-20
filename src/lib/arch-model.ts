// Architecture & diagram studio: data model (docs/ARCHITECTURE_DIAGRAMS.md §7).
// A diagram is a canvas note (`type: canvas`) whose JSON Canvas body carries a canvas-level `lumenArch` block. The JSON is
// the single source of truth; the Lumen DSL, Mermaid and the board are views of it. Everything Lumen-only lives under
// `lumenArch` / `lumenNode` / `lumenGroup` / `lumenEdge`, so other JSON Canvas readers see plain cards, groups and arrows.
import type { CanvasEdge, CanvasNode, JsonCanvas, Side } from "../../shared/types";
import { GLYPHS } from "./glyphs";
import { tk } from "./i18n";

// ------------------------------------------------------------------ types
export type ArchKind = "architecture" | "flowchart" | "sequence" | "erd" | "c4" | "network" | "pipeline" | "state" | "class" | "bpmn" | "threat";
export type Direction = "right" | "down";
export type Split = "canvas" | "50" | "code";
export type ArchStatus = "planned" | "building" | "live" | "deprecated";
export type EdgeStyle = "sync" | "async" | "data" | "control";
export type EdgeShape = "orthogonal" | "straight" | "curved";
export type Ends = "none" | "one" | "both";
export type NodeSize = "S" | "M" | "L";
export type C4Level = "context" | "container" | "component";

export interface Field { name: string; type?: string; key?: string }
export interface LumenArch {
  kind: ArchKind; direction: Direction; dsl?: string; layout?: string; split?: Split;
  /** C4 zoom levels: this diagram is the `level` view of node `parentNode` in diagram note `parent`. */
  c4?: { level: C4Level; parent?: string; parentNode?: string };
  /** Interview / review mode: node labels start hidden ("? ? ?"); click a node or press Alt+R to reveal. */
  interview?: boolean;
}
export interface LumenNode {
  kind?: string; icon?: string; tech?: string; status?: ArchStatus; name?: string; parent?: string; size?: NodeSize;
  cost?: string; sla?: string; owner?: string; description?: string; links?: string[]; tags?: string[];
  /** Reused model object id: every node with the same ref, in any diagram, is the same object. */
  ref?: string; fields?: Field[];
  /** C4: the note id of the diagram one level deeper. */
  zoom?: string;
}
export interface LumenGroup { kind: string; parent?: string; collapsed?: boolean; name?: string; icon?: string; /** DSL label: shown after the kind ("region · eu-west-1"). */ sub?: string }
export type LabelStyleKind = "plain" | "pill" | "boxed";
export type LabelPlace = "on" | "above" | "below";
/** Look of an edge label (JSON only; the DSL keeps just the middle text). */
export interface LabelStyle { kind?: LabelStyleKind; size?: NodeSize; color?: string; bg?: string; bold?: boolean; place?: LabelPlace; follow?: boolean; hidden?: boolean; chip?: boolean }
export interface LumenEdge {
  style?: EdgeStyle; shape?: EdgeShape; protocol?: string; port?: number; points?: { x: number; y: number }[]; pointsKey?: string;
  /** User-shaped route: `points` are the interior bend points only; both ends keep following their ports. */
  manual?: boolean;
  /** Label position along the route, 0 (start) to 1 (end); unset = the route's natural middle. */
  labelPos?: number;
  /** Extra labels at the ends; the middle text lives in the edge `label` (the DSL text) and is mirrored here. */
  labels?: { start?: string; mid?: string; end?: string };
  labelStyle?: LabelStyle;
}

export type ANode = CanvasNode & { lumenNode?: LumenNode; lumenGroup?: LumenGroup };
export type AEdge = CanvasEdge & { lumenEdge?: LumenEdge };
export interface ArchCanvas extends JsonCanvas { nodes: ANode[]; edges: AEdge[]; lumenArch: LumenArch; [k: string]: unknown }

// ------------------------------------------------------------------ catalogues
/** Node kinds (47A) → default glyph. */
export const NODE_KINDS: [kind: string, label: string, glyph: string][] = [
  ["service", tk("Service"), "service"], ["database", tk("Database"), "database"], ["queue", tk("Queue / topic"), "queue"], ["cache", tk("Cache"), "cache"],
  ["storage", tk("Storage"), "bucket"], ["function", tk("Function"), "function"], ["container", tk("Container / pod"), "container"], ["gateway", tk("Gateway / LB"), "gateway"],
  ["cdn", tk("CDN"), "cdn"], ["user", tk("User / actor"), "owner"], ["external", tk("External"), "external-system"], ["web", tk("Web client"), "browser"],
  ["mobile", tk("Mobile client"), "mobile"], ["note", tk("Note"), "c-note"], ["text", tk("Text"), "text"], ["image", tk("Image"), "image"],
  ["notecard", tk("Note card"), "note-card"], ["diagramcard", tk("Diagram card"), "diagram"], ["entity", tk("Entity"), "database"], ["junction", tk("Junction"), "junction"],
];
export const GROUP_KINDS: [kind: string, label: string, color: string][] = [
  ["region", tk("Region"), "#E8893A"], ["vpc", tk("VPC"), "#7AA2F7"], ["subnet", tk("Subnet"), "#57AB5A"], ["zone", tk("Zone"), "#39C5CF"], ["cluster", tk("Cluster"), "#A371F7"],
  ["namespace", tk("Namespace"), "#E3B341"], ["account", tk("Account"), "#9AA0AA"], ["team", tk("Team"), "#F25C9A"], ["trust-boundary", tk("Trust"), "#EF6B6B"],
];
export const GROUP_COLOR: Record<string, string> = Object.fromEntries(GROUP_KINDS.map(([k, , c]) => [k, c]));
/** The generic architecture glyphs (47C). */
export const ARCH_ICONS = ["service", "server", "database", "queue", "topic", "cache", "bucket", "function", "container", "pod", "cluster", "gateway", "load-balancer", "cdn", "dns", "api", "user", "team", "browser", "mobile", "desktop", "external-system", "firewall", "key", "lock-shield", "vault", "identity", "monitoring", "logs", "metrics", "alert", "scheduler", "worker", "stream", "etl", "warehouse", "lake", "feature-store", "model", "gpu", "vector-db", "llm", "embedding", "notebook", "registry", "ci", "repo", "webhook", "email", "sms", "payment", "search", "file", "region", "vpc", "subnet", "zone", "namespace", "account", "trust-boundary", "internet", "on-prem", "cost", "sla", "owner", "junction", "process", "decision", "terminator", "actor", "uml-class", "c-note", "text", "image", "note-card", "diagram"];
/** Icon → node kind (for the properties "Kind" row and Mermaid export). */
const ICON_KIND: Record<string, string> = {
  service: "service", server: "service", api: "service", worker: "function", database: "database", "vector-db": "database", warehouse: "database", lake: "storage",
  queue: "queue", topic: "queue", stream: "queue", cache: "cache", bucket: "storage", file: "storage", function: "function", container: "container", pod: "container",
  gateway: "gateway", "load-balancer": "gateway", cdn: "cdn", user: "user", owner: "user", actor: "user", team: "user", "external-system": "external", payment: "external",
  browser: "web", desktop: "web", mobile: "mobile", "c-note": "note", text: "text", image: "image", "note-card": "notecard", diagram: "diagramcard", junction: "junction",
};
export const kindOfIcon = (icon?: string) => (icon ? ICON_KIND[icon] ?? "service" : "service");
export const glyphOfKind = (k?: string) => NODE_KINDS.find((x) => x[0] === k)?.[2] ?? "service";
/** Design tile colours per icon family (46C). */
const ICON_COLOR: Record<string, string> = {
  gateway: "#7AA2F7", "load-balancer": "#7AA2F7", cdn: "#7AA2F7", api: "#7AA2F7", service: "#F2A93B", server: "#F2A93B", queue: "#B48EF0", topic: "#B48EF0", stream: "#B48EF0",
  function: "#E8893A", worker: "#E8893A", database: "#5CC8C2", "vector-db": "#5CC8C2", warehouse: "#5CC8C2", bucket: "#57AB5A", lake: "#57AB5A", file: "#57AB5A",
  cache: "#EF6B6B", user: "#9AA0AA", owner: "#9AA0AA", "external-system": "#9AA0AA", browser: "#9AA0AA", mobile: "#9AA0AA", llm: "#B48EF0", model: "#B48EF0", embedding: "#5CC8C2",
};
export const PRESET: Record<string, string> = { "1": "#E5534B", "2": "#E8893A", "3": "#E3B341", "4": "#57AB5A", "5": "#39C5CF", "6": "#A371F7" };
export const nodeColor = (n: ANode) => (n.color ? PRESET[n.color] ?? n.color : ICON_COLOR[n.lumenNode?.icon ?? ""] ?? "#9AA0AA");
export const groupColor = (n: ANode) => (n.color ? PRESET[n.color] ?? n.color : GROUP_COLOR[n.lumenGroup?.kind ?? ""] ?? "#9AA0AA");
export const STATUS: Record<ArchStatus, [glyph: string, color: string, label: string]> = {
  planned: ["status-planned", "var(--muted)", tk("Planned")], building: ["status-building", "var(--warning)", tk("Building")],
  live: ["status-live", "var(--success)", tk("Live")], deprecated: ["status-deprecated", "var(--danger)", tk("Deprecated")],
};
export const EDGE_STYLE: Record<EdgeStyle, [color: string, dash: string, label: string]> = {
  sync: ["var(--text)", "none", tk("Sync")], async: ["var(--learn)", "6 4", tk("Async")], data: ["var(--link)", "none", tk("Data")], control: ["var(--warning)", "2 4", tk("Control")],
};
export const SIZE: Record<NodeSize, [w: number, h: number]> = { S: [120, 48], M: [150, 60], L: [190, 72] };
export const isIcon = (s: string) => Object.prototype.hasOwnProperty.call(GLYPHS, s);

// ------------------------------------------------------------------ accessors
export const isGroup = (n: ANode) => n.type === "group";
export const nameOf = (n: ANode): string =>
  n.type === "group" ? (n.lumenGroup?.name ?? n.label ?? n.id) : n.lumenNode?.name ?? (n.type === "text" ? n.text.split("\n")[0] : n.type === "file" ? n.file : n.type === "link" ? n.url : (n as ANode).id);
/** Shown name: the text of the card (DSL `label:` when it differs from the DSL name). */
export const displayOf = (n: ANode): string => (n.type === "text" ? n.text.split("\n")[0] : n.type === "group" ? (n.lumenGroup?.name ?? n.label ?? "") : nameOf(n));
export const parentOf = (n: ANode) => (n.type === "group" ? n.lumenGroup?.parent : n.lumenNode?.parent);
export function setParent(n: ANode, p: string | undefined): ANode {
  if (n.type === "group") return { ...n, lumenGroup: { ...(n.lumenGroup ?? { kind: "region" }), parent: p } };
  const ln = { ...(n.lumenNode ?? {}) };
  if (p) ln.parent = p; else delete ln.parent;
  return { ...n, lumenNode: ln };
}
export const isArchBody = (body: string) => /"lumenArch"\s*:/.test(body);

export function parseArch(body: string): ArchCanvas | null {
  try {
    const c = JSON.parse(body || "{}") as ArchCanvas;
    if (!c || typeof c !== "object" || !c.lumenArch) return null;
    // lenient: a broken node / edge is set aside under `lumenUnread` (stringifyArch writes it back unchanged), the rest loads
    const prev = (c as { lumenUnread?: { nodes: unknown[]; edges: unknown[] } }).lumenUnread;
    const unread = { nodes: [...(prev?.nodes ?? [])], edges: [...(prev?.edges ?? [])] };
    const ids = new Set<string>(), nodes: ANode[] = [], edges: AEdge[] = [];
    for (const n of Array.isArray(c.nodes) ? c.nodes : []) {
      const ok = n && typeof n === "object" && typeof n.id === "string" && n.id && !ids.has(n.id) && ["text", "file", "link", "group"].includes(n.type) && (["x", "y", "width", "height"] as const).every((k) => typeof n[k] === "number" && Number.isFinite(n[k]));
      if (ok) { ids.add(n.id); nodes.push(n); } else unread.nodes.push(n);
    }
    for (const e of Array.isArray(c.edges) ? c.edges : []) { if (e && typeof e === "object" && typeof e.id === "string" && ids.has(e.fromNode) && ids.has(e.toNode)) edges.push(e); else unread.edges.push(e); }
    const { lumenUnread: _u, ...rest } = c as ArchCanvas & { lumenUnread?: unknown };
    return { ...rest, nodes, edges, ...(unread.nodes.length + unread.edges.length ? { lumenUnread: unread } : {}), lumenArch: { ...c.lumenArch, direction: c.lumenArch.direction ?? "right", kind: c.lumenArch.kind ?? "architecture" } };
  } catch { return null; }
}
/** JSON Canvas order: nodes, edges, then lumenArch (keeps other canvas-level lumen keys). */
export function stringifyArch(c: ArchCanvas): string {
  const { nodes, edges, lumenArch, lumenUnread, ...rest } = c as ArchCanvas & { lumenUnread?: { nodes: unknown[]; edges: unknown[] } };
  return JSON.stringify({ nodes: [...nodes, ...(lumenUnread?.nodes ?? [])], edges: [...edges, ...(lumenUnread?.edges ?? [])], ...rest, lumenArch }, null, 2);
}
/** Items a lenient `parseArch` set aside (0 = the body loaded fully). */
export const unreadCount = (c: ArchCanvas) => { const u = (c as { lumenUnread?: { nodes: unknown[]; edges: unknown[] } }).lumenUnread; return u ? u.nodes.length + u.edges.length : 0; };

/** Descendant ids of a group (nested). */
export function descendants(c: ArchCanvas, id: string): Set<string> {
  const out = new Set<string>();
  const kids = childrenMap(c);
  const walk = (g: string) => (kids.get(g) ?? []).forEach((k) => { if (!out.has(k)) { out.add(k); walk(k); } });
  walk(id);
  return out;
}
export function childrenMap(c: ArchCanvas): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const n of c.nodes) { const p = parentOf(n); if (p) m.set(p, [...(m.get(p) ?? []), n.id]); }
  return m;
}
export function depthOf(c: ArchCanvas, id: string): number {
  const by = new Map(c.nodes.map((n) => [n.id, n]));
  let d = 0, p = by.get(id) && parentOf(by.get(id)!);
  while (p && d < 50) { d++; p = by.get(p) && parentOf(by.get(p)!); }
  return d;
}
/** Groups grow to fit their children (deepest first), keeping a header band for the label pill. Collapsed groups are summary nodes. */
export function fitGroups(c: ArchCanvas): ArchCanvas {
  const nodes = c.nodes.map((n) => ({ ...n })) as ANode[];
  const by = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, ANode[]>();
  for (const n of nodes) { const p = parentOf(n); if (p && by.has(p)) kids.set(p, [...(kids.get(p) ?? []), n]); }
  const groups = nodes.filter(isGroup).sort((a, b) => depthOf(c, b.id) - depthOf(c, a.id));
  for (const g of groups) {
    if (g.lumenGroup?.collapsed) { g.width = 220; g.height = 64; continue; }
    const ks = (kids.get(g.id) ?? []).filter((k) => !hiddenBy(c, k.id));
    if (!ks.length) continue;
    const PAD = 24, TOP = 36;
    const x0 = Math.min(...ks.map((k) => k.x)), y0 = Math.min(...ks.map((k) => k.y));
    const x1 = Math.max(...ks.map((k) => k.x + k.width)), y1 = Math.max(...ks.map((k) => k.y + k.height));
    g.x = x0 - PAD; g.y = y0 - TOP; g.width = x1 - x0 + PAD * 2; g.height = y1 - y0 + TOP + PAD;
  }
  // BPMN-lite: top-level groups are swimlanes, all as wide as the widest (lane label column on the left)
  if (c.lumenArch.kind === "bpmn") {
    const lanes = nodes.filter((n) => isGroup(n) && !(parentOf(n) && by.has(parentOf(n)!)));
    if (lanes.length > 1) { const lx0 = Math.min(...lanes.map((l) => l.x)), lx1 = Math.max(...lanes.map((l) => l.x + l.width)); for (const l of lanes) { l.x = lx0; l.width = lx1 - lx0; } }
  }
  return { ...c, nodes };
}
/** The collapsed ancestor group that hides `id`, if any. */
export function hiddenBy(c: ArchCanvas, id: string): string | null {
  const by = new Map(c.nodes.map((n) => [n.id, n]));
  let p = by.get(id) && parentOf(by.get(id)!), hit: string | null = null, guard = 0;
  while (p && guard++ < 50) { const g = by.get(p); if (!g) break; if (g.lumenGroup?.collapsed) hit = g.id; p = parentOf(g); }
  return hit;
}

/** Sides for an edge from the geometry (ports from JSON win). */
export function edgeSides(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): [Side, Side] {
  const ax = a.x + a.width / 2, ay = a.y + a.height / 2, bx = b.x + b.width / 2, by = b.y + b.height / 2;
  const dx = bx - ax, dy = by - ay;
  // overlapping columns → vertical, overlapping rows → horizontal
  if (a.x < b.x + b.width && b.x < a.x + a.width) return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
  if (a.y < b.y + b.height && b.y < a.y + a.height) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}
export const endsOf = (e: AEdge): Ends => (e.fromEnd === "arrow" ? "both" : e.toEnd === "none" ? "none" : "one");
export function setEnds(e: AEdge, v: Ends): AEdge {
  const { fromEnd: _f, toEnd: _t, ...rest } = e;
  return { ...rest, ...(v === "both" ? { fromEnd: "arrow" as const } : {}), ...(v === "none" ? { toEnd: "none" as const } : {}) };
}

// ------------------------------------------------------------------ placement (only new nodes move)
/** Place nodes in `fresh` (ids) next to a connected placed node, inside their group, or right of everything; never on top of others. */
export function placeNew(c: ArchCanvas, fresh: Set<string>): ArchCanvas {
  if (!fresh.size) return fitGroups(c);
  const nodes = c.nodes.map((n) => ({ ...n })) as ANode[];
  const by = new Map(nodes.map((n) => [n.id, n]));
  const placed = () => nodes.filter((n) => !fresh.has(n.id) && !isGroup(n));
  const right = c.lumenArch.direction !== "down";
  const overlaps = (n: ANode) => placed().some((o) => o.id !== n.id && n.x < o.x + o.width + 20 && o.x < n.x + n.width + 20 && n.y < o.y + o.height + 20 && o.y < n.y + n.height + 20);
  // groups first so their children can sit inside them
  const order = [...fresh].map((id) => by.get(id)!).filter(Boolean).sort((a, b) => depthOf(c, a.id) - depthOf(c, b.id));
  for (const n of order) {
    if (isGroup(n)) { fresh.delete(n.id); continue; } // groups fit their children afterwards
    const nbId = c.edges.find((e) => (e.toNode === n.id && !fresh.has(e.fromNode)) || (e.fromNode === n.id && !fresh.has(e.toNode)));
    const nb = nbId ? by.get(nbId.toNode === n.id ? nbId.fromNode : nbId.toNode) : undefined;
    const p = parentOf(n);
    const sibs = placed().filter((o) => parentOf(o) === p && (p ? true : !nb));
    const all = placed();
    if (nb && !isGroup(nb)) {
      const before = nbId!.toNode === n.id; // nb → n: put n after nb
      if (right) { n.x = before ? nb.x + nb.width + 70 : nb.x - n.width - 70; n.y = nb.y; }
      else { n.x = nb.x; n.y = before ? nb.y + nb.height + 70 : nb.y - n.height - 70; }
    } else if (p && sibs.length) {
      const last = sibs.reduce((a, b) => (right ? (b.x + b.width > a.x + a.width ? b : a) : (b.y + b.height > a.y + a.height ? b : a)));
      if (right) { n.x = last.x + last.width + 50; n.y = last.y; } else { n.x = last.x; n.y = last.y + last.height + 50; }
    } else if (p && by.get(p) && placed().some(() => true)) {
      const g = by.get(p)!;
      n.x = g.x + 24; n.y = g.y + 36;
    } else if (all.length) {
      n.x = Math.max(...all.map((o) => o.x + o.width)) + 80; n.y = Math.min(...all.map((o) => o.y));
    } else { n.x = 0; n.y = 0; }
    let guard = 0;
    while (overlaps(n) && guard++ < 60) { if (right) n.y += n.height + 30; else n.x += n.width + 30; }
    fresh.delete(n.id);
  }
  return fitGroups({ ...c, nodes });
}

// ------------------------------------------------------------------ diff (AI edits and version compare)
export type DiffMark = "add" | "del" | "chg";
export interface ArchDiff { nodes: Map<string, DiffMark>; edges: Map<string, DiffMark>; ghostNodes: ANode[]; ghostEdges: AEdge[]; counts: Record<DiffMark, number> }
const sig = (n: ANode) => JSON.stringify([n.type, displayOf(n), n.lumenNode?.icon, n.lumenNode?.tech, n.lumenNode?.status, n.lumenGroup?.kind, parentOf(n), n.color]);
const esig = (e: AEdge) => JSON.stringify([e.label, e.lumenEdge?.style, e.fromEnd, e.toEnd]);
/** Compare an older canvas with the current one: added (green), removed (red, drawn as ghosts), changed (amber). */
export function diffArch(older: ArchCanvas, now: ArchCanvas): ArchDiff {
  const nodes = new Map<string, DiffMark>(), edges = new Map<string, DiffMark>();
  const oldN = new Map(older.nodes.map((n) => [n.id, n])), newN = new Map(now.nodes.map((n) => [n.id, n]));
  // match by DSL name too (ids may differ after an import)
  const oldByName = new Map(older.nodes.map((n) => [nameOf(n), n]));
  const matched = new Set<string>();
  for (const n of now.nodes) {
    const o = oldN.get(n.id) ?? oldByName.get(nameOf(n));
    if (!o) nodes.set(n.id, "add");
    else { matched.add(o.id); if (sig(o) !== sig(n)) nodes.set(n.id, "chg"); }
  }
  const ghostNodes = older.nodes.filter((o) => !matched.has(o.id) && !newN.has(o.id));
  ghostNodes.forEach((g) => nodes.set(g.id, "del"));
  // edges: same id first (an AI edit or a rename keeps ids), then by name pair + occurrence so parallel edges stay distinct
  const nameOfId = (c: ArchCanvas) => new Map(c.nodes.map((n) => [n.id, nameOf(n)]));
  const keyed = (c: ArchCanvas) => { const m = nameOfId(c), seenK = new Map<string, number>(); return new Map(c.edges.map((e) => { const k = `${m.get(e.fromNode)}>${m.get(e.toNode)}`, n = seenK.get(k) ?? 0; seenK.set(k, n + 1); return [e.id, `${k}#${n}`] as const; })); };
  const oldKey = keyed(older), newKey = keyed(now);
  const oldById = new Map(older.edges.map((e) => [e.id, e])), oldByKey = new Map(older.edges.map((e) => [oldKey.get(e.id)!, e]));
  const seen = new Set<string>();
  for (const e of now.edges) {
    const o = oldById.get(e.id) ?? oldByKey.get(newKey.get(e.id)!);
    if (!o || seen.has(o.id)) edges.set(e.id, "add"); else { seen.add(o.id); if (esig(o) !== esig(e) || o.fromNode !== e.fromNode || o.toNode !== e.toNode) edges.set(e.id, "chg"); }
  }
  const ghostEdges = older.edges.filter((e) => !seen.has(e.id));
  ghostEdges.forEach((e) => edges.set(e.id, "del"));
  const counts = { add: 0, del: 0, chg: 0 };
  for (const v of nodes.values()) counts[v]++;
  return { nodes, edges, ghostNodes, ghostEdges, counts };
}

// ------------------------------------------------------------------ sequence diagrams (46A "Sequence · Code-first")
/** Vertical step between two messages, and the gap under the participant row before the first one. */
export const SEQ_ROW = 44, SEQ_TOP = 40;
/** Sequence layout: participants side by side in the order they stand (drag one sideways to reorder), messages top to bottom
 * in code order, each on its own row under the lifelines. Groups are not used. */
export function seqLayout(c: ArchCanvas): ArchCanvas {
  const parts = c.nodes.filter((n) => !isGroup(n)).sort((a, b) => a.x - b.x || c.nodes.indexOf(a) - c.nodes.indexOf(b));
  const at = new Map(parts.map((n, i) => [n.id, i]));
  let moved = false;
  const nodes = c.nodes.map((n) => {
    const i = at.get(n.id);
    if (i === undefined) return n;
    const x = i * 200, y = 0, width = Math.max(130, Math.min(170, n.width)), height = 56;
    if (n.x === x && n.y === y && n.width === width && n.height === height) return n;
    moved = true;
    return { ...n, x, y, width, height };
  });
  return moved ? { ...c, nodes } : c;
}
/** Height of a lifeline under the participant row. */
export const seqLife = (c: ArchCanvas) => SEQ_TOP + Math.max(1, c.edges.length) * SEQ_ROW;

// ------------------------------------------------------------------ BPMN-lite swimlanes (46A "BPMN-lite · Swimlanes")
/** Swimlanes: the top-level groups become full-width horizontal lanes stacked top to bottom; the steps keep their left-to-right
 * order across lanes (the flow reads left to right through the lanes). */
export function laneLayout(c: ArchCanvas): ArchCanvas {
  const by = new Map(c.nodes.map((n) => [n.id, n]));
  const lanes = c.nodes.filter((n) => isGroup(n) && !(parentOf(n) && by.has(parentOf(n)!))).sort((a, b) => a.y - b.y || a.x - b.x);
  if (!lanes.length) return c;
  const laneOf = (n: ANode): string | undefined => { let p = parentOf(n), last: string | undefined; while (p && by.has(p)) { last = p; p = parentOf(by.get(p)!); } return last; };
  const steps = c.nodes.filter((n) => !isGroup(n)).sort((a, b) => a.x - b.x || a.y - b.y);
  // one column per step in flow order, so a step never sits under another step's lane neighbour
  const col = new Map(steps.map((n, i) => [n.id, i]));
  const pos = new Map<string, { x: number; y: number }>();
  let top = 0;
  for (const lane of lanes) {
    const kids = steps.filter((n) => laneOf(n) === lane.id);
    const h = Math.max(60, ...kids.map((k) => k.height));
    for (const k of kids) pos.set(k.id, { x: 140 + col.get(k.id)! * 190, y: top + 36 + (h - k.height) / 2 });
    top += 36 + h + 24 + 16;
  }
  let y2 = top;
  for (const k of steps) if (!pos.has(k.id)) { pos.set(k.id, { x: 140 + col.get(k.id)! * 190, y: y2 }); }
  y2 += 0;
  return fitGroups({ ...c, nodes: c.nodes.map((n) => (pos.has(n.id) ? { ...n, ...pos.get(n.id)! } : n)) });
}
