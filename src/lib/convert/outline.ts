// Every workspace → a Markdown outline (round 7 · §13.1, "Note" column), and graph / note → canvas / board / flowchart.
import type { CanvasEdge, CanvasNode, JsonCanvas } from "../../../shared/types";
import { fromOutline } from "../canvas";
import { cardOf, cardSkeleton, type LumenCard } from "./cards";
import { canvasToMermaid } from "./mermaid";
import { liveEls, sceneEls, splitScene, type El } from "./scene";
import type { Skeleton } from "../whiteboard";

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const wiki = (t: string) => `[[${t.replace(/\.md$/i, "").replace(/[[\]|]/g, "")}]]`;

/** Whiteboard: text in reading order, frames as headings. Board adds note cards as links, Mermaid blocks, link cards and connections. */
export function sceneToOutline(title: string, body: string, board: boolean): string {
  const els = sceneEls(body);
  const byId = new Map(els.map((e) => [e.id, e]));
  const textOf = (e: El): string | null => {
    if (e.type === "text") return one(String(e.text));
    if (e.type === "embeddable") {
      const c = cardOf(e);
      if (c) return card(c);
      return e.link ? `[${e.link}](${e.link})` : null;
    }
    return null;
  };
  const card = (c: LumenCard): string => c.kind === "note" ? wiki(c.title ?? c.noteId ?? "Note") : c.kind === "link" ? `[${c.url}](${c.url})` : c.kind === "pdf" ? `${c.title ?? "PDF"}, page ${c.page ?? 1}` : "```mermaid\n" + (c.src ?? `(${c.title ?? "diagram"})`) + "\n```";
  const sorted = (a: El[]) => [...a].sort((p, q) => Math.round(p.y / 40) - Math.round(q.y / 40) || p.x - q.x);
  const frames = els.filter((e) => e.type === "frame" || e.type === "magicframe");
  const inFrame = (e: El, f: El) => e.frameId === f.id || (e.x >= f.x && e.y >= f.y && e.x + e.width <= f.x + f.width && e.y + e.height <= f.y + f.height);
  const items = els.filter((e) => (e.type === "text" && !e.containerId) || (e.type === "text" && e.containerId && byId.get(e.containerId)?.type !== "arrow") || (board && e.type === "embeddable"));
  const used = new Set<string>();
  const out: string[] = [`# ${title}`, ""];
  const line = (e: El) => { const t = textOf(e.type === "text" && e.containerId ? e : e); if (!t) return; out.push(t.startsWith("```") ? t : `- ${t}`); };
  for (const f of sorted(frames)) {
    const inside = sorted(items.filter((e) => inFrame(e, f) && !used.has(e.id)));
    if (!inside.length) continue;
    out.push(`## ${f.name || "Frame"}`, "");
    inside.forEach((e) => { used.add(e.id); line(e); });
    out.push("");
  }
  const rest = sorted(items.filter((e) => !used.has(e.id)));
  rest.forEach(line);
  if (board) {
    const { edges, nodes } = splitScene(els);
    const name = (id: string) => { const n = nodes.get(id); return n ? (n.type === "text" ? one(n.text).slice(0, 60) : n.type === "file" ? wiki(n.file) : n.type === "link" ? n.url : "") : ""; };
    const conns = edges.map((e) => `- ${name(e.fromNode)} → ${name(e.toNode)}${e.label ? `: ${e.label}` : ""}`).filter((l) => !l.startsWith("-  →") && !l.endsWith("→ "));
    if (conns.length) out.push("", "## Connections", "", ...conns);
  }
  const text = out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  return text.trim() === `# ${title}` ? `# ${title}\n\n(No text on this ${board ? "board" : "whiteboard"}.)\n` : text;
}

/** Canvas: the tree of cards (edges = parent → child) as headings and nested bullets. */
export function canvasToOutline(title: string, c: JsonCanvas): string {
  const nodes = (c.nodes ?? []).filter((n) => n.type !== "group");
  const by = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, string[]>(), hasIn = new Set<string>();
  for (const e of c.edges ?? []) if (by.has(e.fromNode) && by.has(e.toNode)) { (kids.get(e.fromNode) ?? kids.set(e.fromNode, []).get(e.fromNode)!).push(e.toNode); hasIn.add(e.toNode); }
  const pos = (id: string) => { const n = by.get(id)!; return Math.round(n.y / 40) * 100000 + n.x; };
  const text = (n: CanvasNode): string => n.type === "text" ? n.text.trim().replace(/^#+\s*/, "") : n.type === "file" ? wiki(n.file) : n.type === "link" ? `[${n.url}](${n.url})` : "";
  const out: string[] = [`# ${title}`, ""];
  const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    const [h, ...more] = text(by.get(id)!).split("\n");
    out.push(`${"  ".repeat(depth)}- ${h}`);
    for (const m of more) if (m.trim()) out.push(`${"  ".repeat(depth + 1)}${m.trim()}`);
    [...(kids.get(id) ?? [])].sort((a, b) => pos(a) - pos(b)).forEach((k) => walk(k, depth + 1));
  };
  const roots = nodes.filter((n) => !hasIn.has(n.id)).map((n) => n.id).sort((a, b) => pos(a) - pos(b));
  roots.forEach((r) => walk(r, 0));
  nodes.forEach((n) => walk(n.id, 0)); // cycles and leftovers
  return out.join("\n") + "\n";
}

// ------------------------------------------------------------------ graph
export interface GraphData {
  /** Node positions as the graph shows them (any scale). */
  nodes: { id: string; title: string; x: number; y: number }[];
  links: [from: string, to: string][];
  /** The note the graph is centred on. */
  center?: string;
}

/** Scale the layout so no two cards overlap, keeping its shape. */
function spread(g: GraphData, minGap: number): Map<string, { x: number; y: number }> {
  let d = Infinity;
  for (let i = 0; i < g.nodes.length; i++) for (let j = i + 1; j < g.nodes.length; j++) d = Math.min(d, Math.hypot(g.nodes[i].x - g.nodes[j].x, g.nodes[i].y - g.nodes[j].y));
  const k = Number.isFinite(d) && d > 0 ? Math.max(0.5, Math.min(8, minGap / d)) : 1;
  const x0 = Math.min(...g.nodes.map((n) => n.x)), y0 = Math.min(...g.nodes.map((n) => n.y));
  return new Map(g.nodes.map((n) => [n.id, { x: Math.round((n.x - x0) * k), y: Math.round((n.y - y0) * k) }]));
}
export function graphToCanvas(g: GraphData): JsonCanvas {
  const p = spread(g, 340);
  const nodes: CanvasNode[] = g.nodes.map((n) => ({ id: n.id, type: "file", file: n.title, ...p.get(n.id)!, width: 260, height: 140, ...(n.id === g.center ? { color: "6" } : {}) }));
  const ids = new Set(nodes.map((n) => n.id));
  const edges: CanvasEdge[] = g.links.filter(([a, b]) => ids.has(a) && ids.has(b)).map(([a, b], i) => ({ id: `g${i}`, fromNode: a, toNode: b }));
  return { nodes, edges };
}
export function graphToBoardSkeleton(g: GraphData): Skeleton[] {
  const p = spread(g, 340);
  const out: Skeleton[] = g.nodes.map((n) => cardSkeleton({ kind: "note", noteId: n.id, title: n.title }, p.get(n.id)!.x, p.get(n.id)!.y, { id: n.id }) as Skeleton);
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const [a, b] of g.links) if (ids.has(a) && ids.has(b)) out.push({ type: "arrow", x: 0, y: 0, start: { id: a }, end: { id: b } });
  return out;
}
export const graphToMermaid = (g: GraphData): string => canvasToMermaid({ nodes: g.nodes.map((n) => ({ id: n.id, type: "file" as const, file: n.title, x: n.x, y: n.y, width: 1, height: 1 })), edges: g.links.map(([a, b], i) => ({ id: `g${i}`, fromNode: a, toNode: b })) });
export function graphToOutline(title: string, g: GraphData): string {
  const t = new Map(g.nodes.map((n) => [n.id, n.title]));
  const out = new Map<string, string[]>();
  for (const [a, b] of g.links) (out.get(a) ?? out.set(a, []).get(a)!).push(b);
  const L = [`# ${title}`, ""];
  for (const n of g.nodes) { const o = out.get(n.id) ?? []; L.push(`- ${wiki(n.title)}${o.length ? ` → ${o.map((x) => wiki(t.get(x) ?? x)).join(", ")}` : ""}`); }
  return L.join("\n") + "\n";
}

// ------------------------------------------------------------------ note → board / canvas
export const wikilinks = (md: string): string[] => [...new Set([...md.matchAll(/\[\[([^\]|#\n]+)(?:[#|][^\]]*)?\]\]/g)].map((m) => m[1].trim()))];

/** Send to board: the note as a live card in the middle, the notes it links to around it, joined by arrows. */
export function noteToBoardSkeleton(note: { id?: string; title: string; body: string }): Skeleton[] {
  const links = wikilinks(note.body).filter((l) => l.toLowerCase() !== note.title.toLowerCase()).slice(0, 12);
  const cid = "center";
  const out: Skeleton[] = [cardSkeleton({ kind: "note", noteId: note.id, title: note.title, state: "card" }, 0, 0, { id: cid }) as Skeleton];
  const R = 380;
  links.forEach((l, i) => {
    const a = (i / Math.max(1, links.length)) * Math.PI * 2 - Math.PI / 2;
    const id = `l${i}`;
    out.push(cardSkeleton({ kind: "note", title: l }, Math.round(130 + Math.cos(a) * R * 1.3 - 130), Math.round(70 + Math.sin(a) * R * 0.8 - 70), { id }) as Skeleton);
    out.push({ type: "arrow", x: 0, y: 0, start: { id: cid }, end: { id } });
  });
  return out;
}
export function noteToCanvas(note: { title: string; body: string }): JsonCanvas {
  const c = fromOutline(note.body);
  if (c.nodes?.length) return c;
  return { nodes: [{ id: "n1", type: "file", file: note.title, x: 0, y: 0, width: 300, height: 200 }], edges: [] };
}
void liveEls;
