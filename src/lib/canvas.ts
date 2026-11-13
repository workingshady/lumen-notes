import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import type { CanvasEdge, CanvasNode, JsonCanvas, Side } from "../../shared/types";
import { uid } from "./db";

export const PRESETS: Record<string, string> = { "1": "#E5534B", "2": "#E8893A", "3": "#E3B341", "4": "#57AB5A", "5": "#39C5CF", "6": "#A371F7" };
export const colorOf = (c?: string) => (c ? PRESETS[c] ?? c : undefined);
const shortId = () => uid().replace(/-/g, "").slice(0, 16);

export function parseCanvas(text: string): { canvas: JsonCanvas; error: string | null } {
  try {
    const c = JSON.parse(text || "{}") as JsonCanvas;
    const err = validate(c);
    return { canvas: err ? { nodes: [], edges: [] } : { nodes: c.nodes ?? [], edges: c.edges ?? [] }, error: err };
  } catch (e) {
    return { canvas: { nodes: [], edges: [] }, error: `JSON: ${(e as Error).message}` };
  }
}

/** JSON Canvas 1.0 validation (https://jsoncanvas.org/spec/1.0/). Returns an error message or null. */
export function validate(c: unknown): string | null {
  if (!c || typeof c !== "object" || Array.isArray(c)) return "Top level must be an object { nodes, edges }";
  const { nodes = [], edges = [] } = c as JsonCanvas;
  if (!Array.isArray(nodes)) return "`nodes` must be an array";
  if (!Array.isArray(edges)) return "`edges` must be an array";
  const ids = new Set<string>();
  for (const [i, n] of nodes.entries()) {
    if (!n || typeof n.id !== "string" || !n.id) return `nodes[${i}]: missing id`;
    if (ids.has(n.id)) return `nodes[${i}]: duplicate id "${n.id}"`;
    ids.add(n.id);
    if (!["text", "file", "link", "group"].includes(n.type)) return `nodes[${i}]: type must be text | file | link | group`;
    for (const k of ["x", "y", "width", "height"] as const) if (typeof n[k] !== "number") return `nodes[${i}]: ${k} must be a number`;
    if (n.type === "text" && typeof n.text !== "string") return `nodes[${i}]: text node needs "text"`;
    if (n.type === "file" && typeof n.file !== "string") return `nodes[${i}]: file node needs "file"`;
    if (n.type === "link" && typeof n.url !== "string") return `nodes[${i}]: link node needs "url"`;
  }
  for (const [i, e] of edges.entries()) {
    if (!e || typeof e.id !== "string") return `edges[${i}]: missing id`;
    if (!ids.has(e.fromNode)) return `edges[${i}]: fromNode "${e.fromNode}" doesn't exist`;
    if (!ids.has(e.toNode)) return `edges[${i}]: toNode "${e.toNode}" doesn't exist`;
  }
  return null;
}

export const stringify = (c: JsonCanvas) => JSON.stringify({ nodes: c.nodes ?? [], edges: c.edges ?? [] }, null, 2);

// ------------------------------------------------------------------ layouts
type LayoutKind = "grid" | "tree" | "force";
export function layout(c: JsonCanvas, kind: LayoutKind = "tree"): JsonCanvas {
  const nodes = (c.nodes ?? []).map((n) => ({ ...n }));
  const edges = c.edges ?? [];
  const items = nodes.filter((n) => n.type !== "group");
  if (kind === "grid") {
    const cols = Math.ceil(Math.sqrt(items.length));
    items.forEach((n, i) => { n.x = (i % cols) * 320; n.y = Math.floor(i / cols) * 220; });
  } else if (kind === "tree") {
    const incoming = new Map<string, number>();
    edges.forEach((e) => incoming.set(e.toNode, (incoming.get(e.toNode) ?? 0) + 1));
    const kids = new Map<string, string[]>();
    edges.forEach((e) => kids.set(e.fromNode, [...(kids.get(e.fromNode) ?? []), e.toNode]));
    const depth = new Map<string, number>();
    const roots = items.filter((n) => !incoming.get(n.id));
    const queue = (roots.length ? roots : items.slice(0, 1)).map((n) => n.id);
    queue.forEach((id) => depth.set(id, 0));
    while (queue.length) {
      const id = queue.shift()!;
      for (const k of kids.get(id) ?? []) if (!depth.has(k)) { depth.set(k, depth.get(id)! + 1); queue.push(k); }
    }
    items.forEach((n) => depth.has(n.id) || depth.set(n.id, 0));
    const rows = new Map<number, typeof items>();
    items.forEach((n) => rows.set(depth.get(n.id)!, [...(rows.get(depth.get(n.id)!) ?? []), n]));
    for (const [d, row] of rows) {
      let x = 0;
      row.forEach((n) => { n.x = x; n.y = d * 220; x += n.width + 60; });
      const shift = x / 2;
      row.forEach((n) => (n.x -= shift));
    }
  } else {
    type S = SimulationNodeDatum & { id: string; r: number };
    const sim: S[] = items.map((n) => ({ id: n.id, x: n.x, y: n.y, r: Math.max(n.width, n.height) / 2 + 30 }));
    const links = edges.filter((e) => sim.some((s) => s.id === e.fromNode) && sim.some((s) => s.id === e.toNode)).map((e) => ({ source: e.fromNode, target: e.toNode }));
    const s = forceSimulation(sim).force("link", forceLink<S, { source: string; target: string }>(links).id((d) => d.id).distance(260))
      .force("charge", forceManyBody().strength(-900)).force("collide", forceCollide<S>((d) => d.r)).force("x", forceX(0).strength(0.03)).force("y", forceY(0).strength(0.03)).stop();
    for (let i = 0; i < 300; i++) s.tick();
    sim.forEach((p) => { const n = items.find((x) => x.id === p.id)!; n.x = Math.round(p.x! - n.width / 2); n.y = Math.round(p.y! - n.height / 2); });
  }
  return { nodes, edges };
}

// ------------------------------------------------------------------ generators
/** Markdown outline (headings + bullets) → tree canvas. */
export function fromOutline(md: string): JsonCanvas {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const stack: { level: number; id: string }[] = [];
  for (const line of md.split("\n")) {
    const h = /^(#{1,6})\s+(.+)/.exec(line);
    const b = /^(\s*)[-*+]\s+(?:\[.\]\s+)?(.+)/.exec(line);
    if (!h && !b) continue;
    const level = h ? h[1].length : 7 + Math.floor(b![1].replace(/\t/g, "  ").length / 2);
    const text = (h ? `${"#".repeat(Math.min(h[1].length + 1, 3))} ${h[2]}` : b![2]).trim();
    const id = shortId();
    nodes.push({ id, type: "text", text, x: 0, y: 0, width: 260, height: h ? 80 : 60, color: h ? (h[1].length === 1 ? "6" : "5") : undefined });
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    if (stack.length) edges.push({ id: shortId(), fromNode: stack[stack.length - 1].id, toNode: id, fromSide: "bottom", toSide: "top" });
    stack.push({ level, id });
  }
  return layout({ nodes, edges }, "tree");
}

/** A note + the notes it links to (and that link back) → canvas of file nodes. */
export function fromLinks(center: string, out: string[], back: string[]): JsonCanvas {
  const nodes: CanvasNode[] = [{ id: "c", type: "file", file: center, x: 0, y: 0, width: 300, height: 200, color: "6" }];
  const edges: CanvasEdge[] = [];
  [...new Set([...out, ...back])].forEach((t, i) => {
    const id = `n${i}`;
    nodes.push({ id, type: "file", file: t, x: 0, y: 0, width: 260, height: 160 });
    if (out.includes(t)) edges.push({ id: `e${i}`, fromNode: "c", toNode: id });
    if (back.includes(t)) edges.push({ id: `b${i}`, fromNode: id, toNode: "c" });
  });
  return layout({ nodes, edges }, "force");
}

// ------------------------------------------------------------------ scripting API (Script console)
export interface CanvasApi {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  addNode(n: Partial<CanvasNode> & { type?: CanvasNode["type"] }): string;
  addText(text: string, opts?: Partial<CanvasNode>): string;
  addNote(title: string, opts?: Partial<CanvasNode>): string;
  addLink(url: string, opts?: Partial<CanvasNode>): string;
  addGroup(label: string, opts?: Partial<CanvasNode>): string;
  addEdge(from: string, to: string, opts?: Partial<CanvasEdge>): string;
  remove(id: string): void;
  find(pred: (n: CanvasNode) => boolean): CanvasNode[];
  update(id: string, changes: Partial<CanvasNode>): void;
  layout(kind?: LayoutKind): void;
  fromOutline(md: string): void;
  clear(): void;
  log(...args: unknown[]): void;
}

/** Runs user JS against the canvas. The script is the owner's own code, executed in the page. */
export async function runScript(code: string, c: JsonCanvas, helpers: Record<string, unknown> = {}): Promise<{ canvas: JsonCanvas; logs: string[]; error: string | null }> {
  let state: JsonCanvas = { nodes: [...(c.nodes ?? [])], edges: [...(c.edges ?? [])] };
  const logs: string[] = [];
  const at = () => {
    const ns = state.nodes ?? [];
    const maxY = ns.length ? Math.max(...ns.map((n) => n.y + n.height)) : -60;
    return { x: 0, y: maxY + 60 };
  };
  const add = (n: Partial<CanvasNode>) => {
    const id = n.id ?? shortId();
    const p = at();
    state.nodes!.push({ x: p.x, y: p.y, width: 260, height: 120, ...n, id } as CanvasNode);
    return id;
  };
  const api: CanvasApi = {
    get nodes() { return state.nodes!; },
    get edges() { return state.edges!; },
    addNode: (n) => add({ type: "text", text: "", ...n } as Partial<CanvasNode>),
    addText: (text, o) => add({ type: "text", text, ...o } as Partial<CanvasNode>),
    addNote: (file, o) => add({ type: "file", file, width: 300, height: 200, ...o } as Partial<CanvasNode>),
    addLink: (url, o) => add({ type: "link", url, width: 300, height: 160, ...o } as Partial<CanvasNode>),
    addGroup: (label, o) => add({ type: "group", label, width: 600, height: 400, ...o } as Partial<CanvasNode>),
    addEdge: (fromNode, toNode, o) => { const id = o?.id ?? shortId(); state.edges!.push({ id, fromNode, toNode, ...o }); return id; },
    remove: (id) => { state.nodes = state.nodes!.filter((n) => n.id !== id); state.edges = state.edges!.filter((e) => e.id !== id && e.fromNode !== id && e.toNode !== id); },
    find: (pred) => state.nodes!.filter(pred),
    update: (id, ch) => { state.nodes = state.nodes!.map((n) => (n.id === id ? ({ ...n, ...ch } as CanvasNode) : n)); },
    layout: (kind) => { state = layout(state, kind); },
    fromOutline: (md) => { const g = fromOutline(md); state.nodes!.push(...g.nodes!); state.edges!.push(...g.edges!); },
    clear: () => { state = { nodes: [], edges: [] }; },
    log: (...a) => logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")),
  };
  try {
    const fn = new Function("canvas", "helpers", "log", `"use strict"; return (async () => { ${code}\n })();`);
    await fn(api, helpers, api.log);
    const err = validate(state);
    return { canvas: err ? c : state, logs, error: err };
  } catch (e) {
    return { canvas: c, logs, error: String((e as Error).message ?? e) };
  }
}

export const SIDES: Side[] = ["top", "right", "bottom", "left"];

/** Small static SVG preview of a canvas (used for ```canvas blocks and list thumbnails). */
export function previewSvg(c: JsonCanvas, w = 600, h = 280) {
  const ns = c.nodes ?? [];
  if (!ns.length) return `<svg viewBox="0 0 ${w} ${h}" width="100%"><text x="50%" y="50%" text-anchor="middle" fill="currentColor" opacity=".5">Empty canvas</text></svg>`;
  const minX = Math.min(...ns.map((n) => n.x)), minY = Math.min(...ns.map((n) => n.y));
  const maxX = Math.max(...ns.map((n) => n.x + n.width)), maxY = Math.max(...ns.map((n) => n.y + n.height));
  const pad = 40;
  const vb = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
  const byId = new Map(ns.map((n) => [n.id, n]));
  const esc = (s: string) => s.replace(/[<>&]/g, (x) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[x]!);
  const edges = (c.edges ?? []).map((e) => {
    const a = byId.get(e.fromNode), b = byId.get(e.toNode);
    if (!a || !b) return "";
    return `<line x1="${a.x + a.width / 2}" y1="${a.y + a.height / 2}" x2="${b.x + b.width / 2}" y2="${b.y + b.height / 2}" stroke="${colorOf(e.color) ?? "currentColor"}" stroke-opacity=".5" stroke-width="3"/>`;
  }).join("");
  const nodes = ns.map((n) => {
    const col = colorOf(n.color) ?? "var(--border)";
    const label = n.type === "text" ? n.text.replace(/^#+\s*/, "").split("\n")[0] : n.type === "file" ? `📄 ${n.file}` : n.type === "link" ? `🔗 ${n.url}` : n.label ?? "";
    const fill = n.type === "group" ? "transparent" : "var(--surface)";
    return `<g><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="12" fill="${fill}" stroke="${col}" stroke-width="3" ${n.type === "group" ? 'stroke-dasharray="10 8"' : ""}/><text x="${n.x + 16}" y="${n.y + 34}" font-size="22" fill="currentColor">${esc(label.slice(0, 32))}</text></g>`;
  }).join("");
  return `<svg viewBox="${vb}" width="100%" height="${h}" preserveAspectRatio="xMidYMid meet">${edges}${nodes}</svg>`;
}
