// Excalidraw scene (whiteboard / board) ↔ JSON Canvas, as pure functions (round 7 · §13.1).
import type { CanvasEdge, CanvasNode, JsonCanvas, Side } from "../../../shared/types";
import { colorOf, layout } from "../canvas";
import { canvasToSkeleton, EMPTY_SCENE, parseScene, type Scene, type Skeleton } from "../whiteboard";
import { convertSkeleton } from "./bind";
import { cardOf, cardSkeleton, type LumenCard } from "./cards";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type El = Record<string, any>;
export const liveEls = (els: readonly El[]) => els.filter((e) => !e.isDeleted);
export const sceneEls = (body: string): El[] => liveEls(parseScene(body).scene.elements as El[]);

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const INK = new Set(["#1e1e1e", "#000000", "transparent", "#ffffff", "#fff"]);
const colorOfEl = (e: El): string | undefined => { const c = String(e.strokeColor ?? "").toLowerCase(); return INK.has(c) || !c ? undefined : e.strokeColor; };
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const side = (a: { x: number; y: number; width: number; height: number }, b: typeof a): [Side, Side] => {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2), dy = b.y + b.height / 2 - (a.y + a.height / 2);
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? ["right", "left"] : ["left", "right"]) : dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
};
const sid = () => Math.random().toString(36).slice(2, 10);

/** What a board holds, sorted: converted items (cards), arrows between them, and the drawing (ink, pictures, loose shapes). */
export interface SceneParts {
  /** Element ids that become cards, with their node. */
  nodes: Map<string, CanvasNode>;
  edges: CanvasEdge[];
  /** Elements that are not cards: freedraw, images, lines, unlabelled shapes, arrows with a loose end (and their text). */
  drawing: El[];
}

export function splitScene(all: El[]): SceneParts {
  const els = liveEls(all);
  const textBy = new Map<string, El>();
  for (const e of els) if (e.type === "text" && e.containerId) textBy.set(e.containerId, e);
  const nodes = new Map<string, CanvasNode>();
  const used = new Set<string>();
  const frames = els.filter((e) => e.type === "frame" || e.type === "magicframe");
  for (const e of els) {
    const c = e.type === "embeddable" ? cardOf(e) : null;
    const base = { id: e.id as string, x: Math.round(e.x), y: Math.round(e.y), width: Math.round(e.width), height: Math.round(e.height) };
    if (c) {
      used.add(e.id);
      nodes.set(e.id, cardNode(c, base));
    } else if (e.type === "embeddable" && e.link) {
      used.add(e.id);
      nodes.set(e.id, { ...base, type: "link", url: String(e.link) });
    } else if (SHAPES.has(e.type) && textBy.has(e.id)) {
      const t = textBy.get(e.id)!;
      const nc = cardOf(e);
      used.add(e.id); used.add(t.id);
      nodes.set(e.id, nc ? cardNode({ ...nc, title: nc.title ?? clean(t.text) }, base) : { ...base, type: "text", text: String(t.text).trim(), ...(colorOfEl(e) ? { color: colorOfEl(e) } : {}) });
    } else if (e.type === "text" && !e.containerId) {
      used.add(e.id);
      nodes.set(e.id, { ...base, width: Math.max(120, base.width + 24), height: Math.max(48, base.height + 16), type: "text", text: String(e.text).trim() });
    } else if (e.type === "frame" || e.type === "magicframe") {
      used.add(e.id);
      nodes.set(e.id, { ...base, type: "group", label: e.name || "Frame" });
    }
  }
  const edges: CanvasEdge[] = [];
  const drawing: El[] = [];
  for (const e of els) {
    if (e.type !== "arrow") continue;
    const s = e.startBinding?.elementId, t = e.endBinding?.elementId;
    const sn = nodes.get(s), tn = nodes.get(t);
    if (sn && tn) {
      const [fs, ts] = side(sn, tn);
      const lab = textBy.get(e.id);
      used.add(e.id); if (lab) used.add(lab.id);
      edges.push({ id: e.id, fromNode: sn.id, toNode: tn.id, fromSide: fs, toSide: ts, ...(e.endArrowhead ? {} : { toEnd: "none" as const }), ...(e.startArrowhead ? { fromEnd: "arrow" as const } : {}), ...(lab ? { label: clean(lab.text) } : {}), ...(colorOfEl(e) ? { color: colorOfEl(e) } : {}) });
    }
  }
  for (const e of els) if (!used.has(e.id) && !(e.type === "text" && e.containerId && used.has(e.containerId)) && e.type !== "frame" && e.type !== "magicframe") drawing.push(e);
  void frames;
  return { nodes, edges, drawing };
}

function cardNode(c: LumenCard, base: { id: string; x: number; y: number; width: number; height: number }): CanvasNode {
  if (c.kind === "link") return { ...base, type: "link", url: c.url ?? "" };
  if (c.kind === "mermaid" && !c.noteId) return { ...base, type: "text", text: "```mermaid\n" + (c.src ?? "") + "\n```" };
  const title = c.title ?? "";
  return { ...base, type: "file", file: c.kind === "mermaid" && title && !/\.mermaid$/i.test(title) ? `${title}.mermaid` : title || (c.noteId ?? ""), ...(c.kind === "pdf" && c.page ? { subpath: `#page=${c.page}` } : {}) };
}

export const bbox = (els: El[]) => {
  if (!els.length) return null;
  const x0 = Math.min(...els.map((e) => e.x)), y0 = Math.min(...els.map((e) => e.y)), x1 = Math.max(...els.map((e) => e.x + (e.width ?? 0))), y1 = Math.max(...els.map((e) => e.y + (e.height ?? 0)));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};

/** Whiteboard / board → JSON Canvas. `inkAtt` = attachment id of the rendered drawing (becomes one image card). */
export function sceneToCanvas(body: string | El[], o: { inkAtt?: string } = {}): JsonCanvas {
  const parts = splitScene(typeof body === "string" ? sceneEls(body) : body);
  const nodes = [...parts.nodes.values()];
  // groups: keep a card only if inside; JSON Canvas groups are plain rectangles
  const bb = bbox(parts.drawing);
  if (bb && o.inkAtt) nodes.push({ id: sid(), type: "text", text: `![ink](att:${o.inkAtt})`, x: Math.round(bb.x), y: Math.round(bb.y), width: Math.max(120, Math.round(bb.width)), height: Math.max(80, Math.round(bb.height)) });
  return { nodes, edges: parts.edges };
}

// ------------------------------------------------------------------ canvas → board / whiteboard
const isMermaidText = (t: string) => /^```\s*mermaid\s*\n([\s\S]*?)\n?```\s*$/.exec(t.trim());
const plain = (md: string) => md.replace(/^#+\s*/gm, "").replace(/\*\*|__|`/g, "").trim().slice(0, 300);

/** JSON Canvas → board skeletons: note cards, link cards, Mermaid cards, shapes, frames, bound arrows. */
export function canvasToBoardSkeleton(c: JsonCanvas): Skeleton[] {
  const out: Skeleton[] = [];
  const nodes = c.nodes ?? [];
  for (const n of nodes) {
    if (n.type === "group") continue;
    const w = n.width, h = n.height;
    if (n.type === "file") {
      const title = n.file.replace(/\.md$/i, "").split("/").pop() ?? n.file;
      const kind: LumenCard["kind"] = /\.mermaid$/i.test(n.file) ? "mermaid" : /\.pdf$/i.test(n.file) ? "pdf" : "note";
      const page = /#page=(\d+)/.exec(n.subpath ?? "")?.[1];
      out.push(cardSkeleton({ kind, title, ...(page ? { page: +page } : {}) }, n.x, n.y, { id: n.id, w: Math.max(w, kind === "note" ? 240 : 240), h: Math.max(h, 120) }) as Skeleton);
    } else if (n.type === "link") {
      out.push(cardSkeleton({ kind: "link", url: n.url }, n.x, n.y, { id: n.id, w: Math.max(w, 260), h: Math.max(h, 150) }) as Skeleton);
    } else {
      const m = isMermaidText(n.text);
      if (m) out.push(cardSkeleton({ kind: "mermaid", src: m[1] }, n.x, n.y, { id: n.id, w: Math.max(w, 300), h: Math.max(h, 180) }) as Skeleton);
      else { const col = colorOf(n.color); out.push({ type: "rectangle", id: n.id, x: n.x, y: n.y, width: w, height: h, roundness: { type: 3 }, ...(col ? { strokeColor: col, backgroundColor: col + "33", fillStyle: "solid" } : {}), label: { text: plain(n.text), fontSize: 16 } }); }
    }
  }
  const rest = canvasToSkeleton({ nodes: nodes.filter((n) => n.type === "group"), edges: [] });
  void rest;
  for (const e of nodeEdges(c).edges ?? []) out.push({ type: "arrow", x: 0, y: 0, start: { id: e.fromNode }, end: { id: e.toNode }, ...(e.toEnd === "none" ? { endArrowhead: null } : {}), ...(e.fromEnd === "arrow" ? { startArrowhead: "arrow" } : {}), ...(e.label ? { label: { text: e.label } } : {}), ...(colorOf(e.color) ? { strokeColor: colorOf(e.color) } : {}) });
  for (const g of nodes.filter((n) => n.type === "group")) {
    const kids = nodes.filter((n) => n.type !== "group" && n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height).map((n) => n.id);
    if (kids.length) out.push({ type: "frame", children: kids, name: (g as { label?: string }).label ?? "Group" });
  }
  return out;
}

/** Skeletons → a full .excalidraw scene body (elements converted here, so nothing is pending when the file opens). */
export async function buildScene(skel: Skeleton[], keep: El[] = [], base: Partial<Scene> = {}): Promise<string> {
  const conv = await convertSkeleton(skel, { regenerateIds: false }, keep);
  return JSON.stringify({ ...EMPTY_SCENE, ...base, elements: [...keep, ...conv] }, null, 2);
}

/** A saved scene whose elements are still pending skeletons (made through the REST API, or never opened) → real elements. */
export async function materialise(body: string): Promise<string> {
  const { scene } = parseScene(body);
  if (!scene.lumenPending?.length) return body;
  const { lumenPending, elements, ...rest } = scene;
  return buildScene(lumenPending, elements as El[], rest);
}

/** Edges that end on a group have nothing to bind to outside a canvas: leave them out. */
export const nodeEdges = (c: JsonCanvas): JsonCanvas => { const ok = new Set((c.nodes ?? []).filter((n) => n.type !== "group").map((n) => n.id)); return { ...c, edges: (c.edges ?? []).filter((e) => ok.has(e.fromNode) && ok.has(e.toNode)) }; };

/** Board → whiteboard: ink, shapes and text stay; live cards become labelled boxes (same id, so arrows keep their ends). */
export async function boardToWhiteboard(body: string): Promise<string> {
  const { scene } = parseScene(body);
  const keep: El[] = [], boxes: Skeleton[] = [];
  for (const e of scene.elements as El[]) {
    const c = e.type === "embeddable" && !e.isDeleted ? cardOf(e) : null;
    if (!c && !(e.type === "embeddable" && !e.isDeleted && e.link)) { keep.push(e); continue; }
    const label = c ? (c.kind === "link" ? c.url ?? e.link : c.title ?? (c.kind === "mermaid" ? "Mermaid" : "Note")) : String(e.link);
    boxes.push({ type: "rectangle", id: e.id, x: e.x, y: e.y, width: e.width, height: e.height, roundness: { type: 3 }, backgroundColor: "#d0ebff", fillStyle: "solid", strokeColor: "#1e1e1e", roughness: 0, label: { text: String(label), fontSize: 18 } });
  }
  const { elements: _e, ...rest } = scene; void _e;
  return buildScene(boxes, keep, rest);
}
export { layout };
