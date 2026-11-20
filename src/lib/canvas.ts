import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import type { CanvasEdge, CanvasNode, JsonCanvas, Side } from "../../shared/types";
import { uid } from "./db";
import { countCrossings, tidy, type LEdge, type LNode } from "./graph-layout";

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
type LayoutKind = "grid" | "tree" | "force" | "tidy";
export function layout(c: JsonCanvas, kind: LayoutKind = "tree"): JsonCanvas {
  if (kind === "tidy") return tidyCanvas(c).canvas;
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

// ------------------------------------------------------------------ Tidy up (design round 4, 14b · 2)
/** Pinned cards (`"lumenPinned": true`, a Lumen extension field JSON Canvas readers ignore) never move in Tidy up. */
export const isPinned = (n: CanvasNode) => !!(n as { lumenPinned?: boolean }).lumenPinned;
export function setPinned(n: CanvasNode, on: boolean): CanvasNode {
  const { lumenPinned: _old, ...rest } = n as CanvasNode & { lumenPinned?: boolean };
  return (on ? { ...rest, lumenPinned: true } : rest) as CanvasNode;
}

export interface CanvasTidy { canvas: JsonCanvas; moved: number; before: number | null; after: number | null; pinned: number }

/**
 * Tidy up a board: groups are laid out as compound nodes (their cards first, the group resized around them), then
 * every level is laid out left → right by its edges (layered; edges between cards in different groups are lifted
 * to the groups), isolated cards packed in a grid, pinned cards left where they are, and edge sides set to the
 * straightest pair. Returns the new canvas plus what changed (for the preview banner).
 */
export function tidyCanvas(c: JsonCanvas, opts: { keepPinned?: boolean; mode?: "layered" | "force"; dir?: "LR" | "TB" } = {}): CanvasTidy {
  const nodes = (c.nodes ?? []).map((n) => ({ ...n }));
  const edges = (c.edges ?? []).map((e) => ({ ...e }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const keep = opts.keepPinned !== false;
  const area = (n: CanvasNode) => n.width * n.height;
  const centre = (id: string) => { const n = byId.get(id); return n && { x: n.x + n.width / 2, y: n.y + n.height / 2 }; };
  const edgeList = () => edges.map((e) => [e.fromNode, e.toNode] as LEdge);
  // Parent = the smallest group that contains the card's centre (groups nest the same way).
  const parent = new Map<string, string | null>();
  for (const n of nodes) {
    const cx = n.x + n.width / 2, cy = n.y + n.height / 2;
    let best: CanvasNode | null = null;
    for (const g of nodes) if (g.type === "group" && g.id !== n.id && area(g) > area(n) && cx >= g.x && cx <= g.x + g.width && cy >= g.y && cy <= g.y + g.height && (!best || area(g) < area(best))) best = g;
    parent.set(n.id, best?.id ?? null);
  }
  const chain = (id: string) => { const out = [id]; let p = parent.get(id); while (p && out.length < 32) { out.push(p); p = parent.get(p); } return out; };
  const PAD = 28, HEAD = 36; // group padding; the label chip sits 30px above the group
  const before = countCrossings(edgeList(), centre);
  // Centre of every card relative to its level's layout frame, and each level's content top-left.
  const local = new Map<string, { x: number; y: number }>();
  const origin = new Map<string | null, { x: number; y: number }>();
  let pinnedKept = 0;
  const layoutLevel = (pid: string | null): { w: number; h: number } | null => {
    const kids = nodes.filter((n) => parent.get(n.id) === pid);
    if (!kids.length) return null;
    for (const k of kids) if (k.type === "group") {
      const inner = layoutLevel(k.id);
      if (inner && !(keep && isPinned(k))) { k.width = Math.round(inner.w + PAD * 2); k.height = Math.round(inner.h + PAD * 2); }
    }
    // Lift edges to this level: the ancestors of both ends that are children of `pid`.
    const kidSet = new Set(kids.map((k) => k.id));
    const lifted: LEdge[] = [];
    for (const e of edges) {
      const a = chain(e.fromNode).find((x) => kidSet.has(x)), b = chain(e.toNode).find((x) => kidSet.has(x));
      if (a && b && a !== b) lifted.push([a, b]);
    }
    // A group's box includes its label chip above it.
    const head = (k: CanvasNode) => (k.type === "group" ? HEAD : 0);
    const ln: LNode[] = kids.map((k) => ({ id: k.id, w: k.width, h: k.height + head(k), x: k.x + k.width / 2, y: k.y + (k.height - head(k)) / 2, pinned: isPinned(k) }));
    const r = tidy(ln, lifted, { mode: opts.mode ?? "layered", dir: opts.dir ?? "LR", layerGap: 90, nodeGap: 40, keepPinned: keep });
    pinnedKept += r.pinned;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const k of kids) {
      const p = r.pos.get(k.id)!;
      const top = p.y - (k.height + head(k)) / 2; // top of the chip area
      local.set(k.id, { x: p.x - k.width / 2, y: top + head(k) }); // card top-left in this frame
      x0 = Math.min(x0, p.x - k.width / 2); x1 = Math.max(x1, p.x + k.width / 2);
      y0 = Math.min(y0, top); y1 = Math.max(y1, top + k.height + head(k));
    }
    origin.set(pid, { x: x0, y: y0 });
    return { w: x1 - x0, h: y1 - y0 };
  };
  if (!layoutLevel(null)) return { canvas: c, moved: 0, before, after: before, pinned: 0 };
  // Top level is already in board coordinates (tidy() re-centres on where the cards were); a nested level is
  // placed so its content box starts at the group's top-left + padding.
  const done = new Set<string>();
  const place = (n: CanvasNode): void => {
    if (done.has(n.id)) return;
    done.add(n.id);
    const pid = parent.get(n.id) ?? null;
    const p = local.get(n.id)!;
    if (keep && isPinned(n) && !pid) return;
    if (!pid) { n.x = Math.round(p.x); n.y = Math.round(p.y); return; }
    const g = byId.get(pid)!;
    place(g);
    const o = origin.get(pid)!;
    if (keep && isPinned(n)) return;
    n.x = Math.round(g.x + PAD + (p.x - o.x));
    n.y = Math.round(g.y + PAD + (p.y - o.y));
  };
  for (const n of nodes) place(n);
  // Straighten edges: each edge leaves / enters on the sides facing each other.
  for (const e of edges) {
    const a = byId.get(e.fromNode), b = byId.get(e.toNode);
    if (!a || !b) continue;
    const dx = b.x + b.width / 2 - (a.x + a.width / 2), dy = b.y + b.height / 2 - (a.y + a.height / 2);
    if (Math.abs(dx) >= Math.abs(dy)) { e.fromSide = dx >= 0 ? "right" : "left"; e.toSide = dx >= 0 ? "left" : "right"; }
    else { e.fromSide = dy >= 0 ? "bottom" : "top"; e.toSide = dy >= 0 ? "top" : "bottom"; }
  }
  const old = new Map((c.nodes ?? []).map((n) => [n.id, n]));
  const moved = nodes.filter((n) => { const o = old.get(n.id)!; return Math.abs(o.x - n.x) > 2 || Math.abs(o.y - n.y) > 2 || o.width !== n.width || o.height !== n.height; }).length;
  return { canvas: { nodes, edges }, moved, before, after: countCrossings(edgeList(), centre), pinned: pinnedKept };
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
    // File / link cards get a small drawn mark (page / link) instead of an emoji.
    const label = n.type === "text" ? n.text.replace(/^#+\s*/, "").split("\n")[0] : n.type === "file" ? n.file.replace(/\.md$/i, "") : n.type === "link" ? n.url.replace(/^https?:\/\/(www\.)?/, "") : n.label ?? "";
    const mark = n.type === "file" ? `<path d="M${n.x + 16} ${n.y + 16}h11l6 6v14h-17z" fill="none" stroke="currentColor" stroke-opacity=".6" stroke-width="2"/>`
      : n.type === "link" ? `<path d="M${n.x + 20} ${n.y + 27}h8 M${n.x + 21} ${n.y + 22}h-3a5 5 0 0 0 0 10h3 M${n.x + 27} ${n.y + 22}h3a5 5 0 0 1 0 10h-3" fill="none" stroke="currentColor" stroke-opacity=".6" stroke-width="2"/>` : "";
    const tx = mark ? n.x + 42 : n.x + 16;
    const fill = n.type === "group" ? "transparent" : "var(--surface)";
    return `<g><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="12" fill="${fill}" stroke="${col}" stroke-width="3" ${n.type === "group" ? 'stroke-dasharray="10 8"' : ""}/>${mark}<text x="${tx}" y="${n.y + 34}" font-size="22" fill="currentColor">${esc(label.slice(0, 32))}</text></g>`;
  }).join("");
  return `<svg viewBox="${vb}" width="100%" height="${h}" preserveAspectRatio="xMidYMid meet">${edges}${nodes}</svg>`;
}

// ------------------------------------------------------------------ editing helpers (copy / paste, lock, align, order)
/** Locked cards (`"lumenLocked": true`, a Lumen extension field) can't be moved, resized or deleted on the board. */
export const isLocked = (n: CanvasNode) => !!(n as { lumenLocked?: boolean }).lumenLocked;
export function setLocked(n: CanvasNode, on: boolean): CanvasNode {
  const { lumenLocked: _old, ...rest } = n as CanvasNode & { lumenLocked?: boolean };
  return (on ? { ...rest, lumenLocked: true } : rest) as CanvasNode;
}

/** The selected cards plus the edges between them (and selected edges whose ends are both copied), as JSON Canvas. */
export function pickSelection(c: JsonCanvas, ids: Set<string>): JsonCanvas {
  const nodes = (c.nodes ?? []).filter((n) => ids.has(n.id));
  const keep = new Set(nodes.map((n) => n.id));
  const edges = (c.edges ?? []).filter((e) => keep.has(e.fromNode) && keep.has(e.toNode));
  return { nodes, edges };
}

/** Clipboard text → JSON Canvas fragment (from Lumen, Obsidian or any JSON Canvas app), or null. */
export function canvasFromText(text: string): JsonCanvas | null {
  const s = text.trim();
  if (!s.startsWith("{") || !s.includes("\"nodes\"")) return null;
  try {
    const c = JSON.parse(s) as JsonCanvas;
    const nodes = c.nodes ?? [];
    const ids = new Set(nodes.map((n) => n.id));
    const frag = { nodes, edges: (c.edges ?? []).filter((e) => ids.has(e.fromNode) && ids.has(e.toNode)) };
    return nodes.length && !validate(frag) ? frag : null;
  } catch { return null; }
}

/**
 * Copies of a fragment with fresh ids, moved so its top-left lands on `at` (or shifted by `offset`), snapped to
 * `grid` when given. Locks are dropped on the copies. Returns the copies and their ids.
 */
export function cloneFragment(f: JsonCanvas, place: { at?: { x: number; y: number }; offset?: number; grid?: number }): { canvas: JsonCanvas; ids: string[] } {
  const nodes = f.nodes ?? [];
  const map = new Map(nodes.map((n) => [n.id, shortId()]));
  const minX = Math.min(...nodes.map((n) => n.x)), minY = Math.min(...nodes.map((n) => n.y));
  const snap = (v: number) => (place.grid ? Math.round(v / place.grid) * place.grid : Math.round(v));
  const dx = place.at ? snap(place.at.x) - minX : place.offset ?? 40;
  const dy = place.at ? snap(place.at.y) - minY : place.offset ?? 40;
  const out = nodes.map((n) => setLocked({ ...n, id: map.get(n.id)!, x: n.x + dx, y: n.y + dy } as CanvasNode, false));
  const edges = (f.edges ?? []).map((e) => ({ ...e, id: shortId(), fromNode: map.get(e.fromNode)!, toNode: map.get(e.toNode)! }));
  return { canvas: { nodes: out, edges }, ids: [...out.map((n) => n.id), ...edges.map((e) => e.id)] };
}

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "hspace" | "vspace";
/** Align or distribute the given cards (locked ones stay put). Distribute keeps the outer two and spaces the rest evenly. */
export function alignNodes(c: JsonCanvas, ids: Set<string>, mode: AlignMode): JsonCanvas {
  const nodes = (c.nodes ?? []).map((n) => ({ ...n }));
  const sel = nodes.filter((n) => ids.has(n.id));
  if (sel.length < 2) return c;
  const x0 = Math.min(...sel.map((n) => n.x)), x1 = Math.max(...sel.map((n) => n.x + n.width));
  const y0 = Math.min(...sel.map((n) => n.y)), y1 = Math.max(...sel.map((n) => n.y + n.height));
  const free = sel.filter((n) => !isLocked(n));
  if (mode === "hspace" || mode === "vspace") {
    const h = mode === "hspace";
    const sorted = [...sel].sort((a, b) => (h ? a.x + a.width / 2 - (b.x + b.width / 2) : a.y + a.height / 2 - (b.y + b.height / 2)));
    const total = sorted.reduce((s, n) => s + (h ? n.width : n.height), 0);
    const gap = ((h ? x1 - x0 : y1 - y0) - total) / (sorted.length - 1);
    let p = h ? x0 : y0;
    for (const n of sorted) {
      if (!isLocked(n)) { if (h) n.x = Math.round(p); else n.y = Math.round(p); }
      p += (h ? n.width : n.height) + gap;
    }
  } else for (const n of free) {
    if (mode === "left") n.x = x0;
    else if (mode === "right") n.x = x1 - n.width;
    else if (mode === "hcenter") n.x = Math.round((x0 + x1) / 2 - n.width / 2);
    else if (mode === "top") n.y = y0;
    else if (mode === "bottom") n.y = y1 - n.height;
    else n.y = Math.round((y0 + y1) / 2 - n.height / 2);
  }
  return { nodes, edges: c.edges ?? [] };
}

/** Z-order = order in `nodes` (JSON Canvas: later is on top). Moves the given cards to the top or the bottom. */
export function reorder(c: JsonCanvas, ids: Set<string>, to: "front" | "back"): JsonCanvas {
  const ns = c.nodes ?? [];
  const sel = ns.filter((n) => ids.has(n.id)), rest = ns.filter((n) => !ids.has(n.id));
  return { nodes: to === "front" ? [...rest, ...sel] : [...sel, ...rest], edges: c.edges ?? [] };
}
