// Mermaid ↔ JSON Canvas (round 7 · §13.1): a small flowchart parser, and canvas / outline → flowchart text.
import type { CanvasEdge, CanvasNode, JsonCanvas } from "../../../shared/types";
import { layout } from "../canvas";

export interface FlowNode { id: string; text: string; shape: "rect" | "round" | "diamond" | "circle" | "other" }
export interface FlowEdge { from: string; to: string; label?: string; dashed?: boolean; arrow: boolean }
export interface Flow { dir: "LR" | "TB"; nodes: FlowNode[]; edges: FlowEdge[] }

const OPEN: [string, string, FlowNode["shape"]][] = [["[[", "]]", "other"], ["((", "))", "circle"], ["([", "])", "round"], ["[(", ")]", "other"], ["{{", "}}", "diamond"], ["[", "]", "rect"], ["(", ")", "round"], ["{", "}", "diamond"], [">", "]", "other"]];
const ARROW = /^\s*(?:(?:--|-\.)\s+([^<>=\n]*?)\s+(-->|-\.->|---|==>)|(<?)(-{2,}>?|={2,}>?|-\.+-?>?|~~~)(?:\|([^|]*)\|)?)/;

export const isFlowchart = (src: string) => /^\s*(?:%%[^\n]*\n\s*)*(flowchart|graph)\b/i.test(src);

/** Parse a Mermaid flowchart / graph. Anything it can't read (subgraphs, styles, click handlers) is skipped. */
export function parseFlowchart(src: string): Flow | null {
  if (!isFlowchart(src)) return null;
  const nodes = new Map<string, FlowNode>(), edges: FlowEdge[] = [];
  let pendingEdge: { label?: string; dashed: boolean; arrow: boolean } = { dashed: false, arrow: true };
  let dir: Flow["dir"] = "TB";
  const dm = /^\s*(?:flowchart|graph)\s+(LR|RL|TB|TD|BT)/im.exec(src);
  if (dm) dir = dm[1] === "LR" || dm[1] === "RL" ? "LR" : "TB";
  const unq = (s: string) => s.trim().replace(/^"(.*)"$/s, "$1").replace(/<br\s*\/?>/gi, "\n");
  /** One node reference at i: `A`, `A[Text]`, `A{Text}` … → [id, end index]. */
  const node = (s: string, i: number): [string, number] | null => {
    const m = /^\s*([^\s\[\](){}|<>&;"'=-][^\s\[\](){}|<>&;"']*)/.exec(s.slice(i));
    if (!m) return null;
    const id = m[1];
    let j = i + m[0].length;
    for (const [o, c, shape] of OPEN) {
      if (s.startsWith(o, j)) {
        const k = s.indexOf(c, j + o.length);
        if (k < 0) break;
        const text = unq(s.slice(j + o.length, k));
        nodes.set(id, { id, text, shape });
        j = k + c.length;
        const cls = /^:::\w+/.exec(s.slice(j)); if (cls) j += cls[0].length;
        return [id, j];
      }
    }
    if (!nodes.has(id)) nodes.set(id, { id, text: id, shape: "rect" });
    return [id, j];
  };
  for (const raw of src.split(/\n|;/)) {
    const line = raw.trim();
    if (!line || /^(%%|flowchart|graph|subgraph|end\b|classDef|class\s|style\s|linkStyle|click\s|direction\b)/i.test(line)) continue;
    let i = 0;
    let prev: string[] | null = null;
    for (;;) {
      const group: string[] = [];
      let r = node(line, i);
      if (!r) break;
      group.push(r[0]); i = r[1];
      while (/^\s*&/.test(line.slice(i))) { i += line.slice(i).indexOf("&") + 1; r = node(line, i); if (!r) break; group.push(r[0]); i = r[1]; }
      if (prev) for (const a of prev) for (const b of group) edges.push({ ...pendingEdge, from: a, to: b });
      const am = ARROW.exec(line.slice(i));
      if (!am) break;
      const label = am[1] ?? am[5];
      const tok = am[2] ?? am[4] ?? "";
      pendingEdge = { label: label?.trim() ? unq(label) : undefined, dashed: /\./.test(tok), arrow: /[>]/.test(tok) };
      i += am[0].length;
      prev = group;
    }
  }
  return nodes.size ? { dir, nodes: [...nodes.values()], edges } : null;
}

const sizeOf = (t: string) => ({ width: Math.min(260, Math.max(120, 14 + Math.max(...t.split("\n").map((l) => l.length)) * 8)), height: 48 + 22 * (t.split("\n").length - 1) });
let n = 0;
const nid = () => `m${Date.now().toString(36)}${(n++).toString(36)}`;

/** Flowchart → laid-out canvas (cards + edges). Non-flowchart Mermaid comes across as one card holding the source. */
export function mermaidToCanvas(src: string): JsonCanvas {
  const f = parseFlowchart(src);
  if (!f) return { nodes: [{ id: nid(), type: "text", text: "```mermaid\n" + src.trim() + "\n```", x: 0, y: 0, width: 560, height: 380 }], edges: [] };
  const ids = new Map(f.nodes.map((x) => [x.id, nid()]));
  const nodes: CanvasNode[] = f.nodes.map((x) => ({ id: ids.get(x.id)!, type: "text", text: x.shape === "diamond" ? `${x.text}?`.replace(/\?\?$/, "?") : x.text, x: 0, y: 0, ...sizeOf(x.text) }));
  const edges: CanvasEdge[] = f.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ id: nid(), fromNode: ids.get(e.from)!, toNode: ids.get(e.to)!, ...(f.dir === "LR" ? { fromSide: "right" as const, toSide: "left" as const } : { fromSide: "bottom" as const, toSide: "top" as const }), ...(e.arrow ? {} : { toEnd: "none" as const }), ...(e.label ? { label: e.label } : {}) }));
  return layout({ nodes, edges }, "tree");
}

const esc = (s: string) => s.replace(/"/g, "'").replace(/\n+/g, "<br/>").trim();
const label = (n: CanvasNode): string => {
  if (n.type === "text") return n.text.replace(/^#+\s*/gm, "").split("\n").map((l) => l.replace(/\*\*|__|`/g, "").trim()).filter(Boolean)[0] ?? "Card";
  if (n.type === "file") return n.file.replace(/\.md$/i, "").split("/").pop() ?? n.file;
  if (n.type === "link") return n.url.replace(/^https?:\/\//, "");
  return n.label ?? "Group";
};

/** Canvas → flowchart text: one node per card, one arrow per edge (cards without edges are listed too). */
export function canvasToMermaid(c: JsonCanvas): string {
  const nodes = (c.nodes ?? []).filter((x) => x.type !== "group");
  const ids = new Map(nodes.map((x, i) => [x.id, `n${i + 1}`]));
  const xs = nodes.map((x) => x.x), ys = nodes.map((x) => x.y);
  const lr = xs.length && ys.length ? Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) : true;
  const L = [`flowchart ${lr ? "LR" : "TB"}`];
  for (const x of nodes) { const t = esc(label(x)); L.push(`  ${ids.get(x.id)}${x.type === "text" && /\?\s*$/.test(t) ? `{"${t}"}` : x.type === "file" ? `("${t}")` : `["${t}"]`}`); }
  for (const e of c.edges ?? []) {
    const a = ids.get(e.fromNode), b = ids.get(e.toNode);
    if (a && b) L.push(`  ${a} ${e.toEnd === "none" ? "---" : "-->"}${e.label ? `|${esc(e.label)}|` : ""} ${b}`);
  }
  return L.join("\n") + "\n";
}

/** Outline (Markdown headings / bullets) → flowchart of the tree. */
export function outlineToMermaid(md: string): string {
  const c = (md.split("\n").some((l) => /^(#{1,6}\s|\s*[-*+]\s)/.test(l)) ? outlineTree(md) : { nodes: [], edges: [] }) as JsonCanvas;
  return c.nodes?.length ? canvasToMermaid(c).replace(/^flowchart \w+/, "flowchart TD") : "flowchart TD\n  n1[\"Empty\"]\n";
}
function outlineTree(md: string): JsonCanvas {
  const nodes: CanvasNode[] = [], edges: CanvasEdge[] = [], stack: { level: number; id: string }[] = [];
  for (const line of md.split("\n")) {
    const h = /^(#{1,6})\s+(.+)/.exec(line), b = /^(\s*)[-*+]\s+(?:\[.\]\s+)?(.+)/.exec(line);
    if (!h && !b) continue;
    const level = h ? h[1].length : 7 + Math.floor(b![1].replace(/\t/g, "  ").length / 2);
    const id = nid();
    nodes.push({ id, type: "text", text: (h ? h[2] : b![2]).trim(), x: 0, y: 0, width: 200, height: 60 });
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    if (stack.length) edges.push({ id: nid(), fromNode: stack[stack.length - 1].id, toNode: id });
    stack.push({ level, id });
  }
  return { nodes, edges };
}
