// Architecture ↔ the other workspaces (round 7 · §13.1): canvas / board cards → nodes, nodes → plain cards / shapes / outline.
import type { CanvasEdge, CanvasNode, JsonCanvas } from "../../../shared/types";
import { archFromDsl, emptyArch } from "../arch-starters";
import { slug, toMermaid } from "../arch-convert";
import { displayOf, isGroup, nameOf, parseArch, kindOfIcon, stringifyArch, type ANode, type ArchCanvas } from "../arch-model";
import { suggestIcon } from "../arch-dsl";
import type { Skeleton } from "../whiteboard";

const first = (n: CanvasNode): string => {
  if (n.type === "text" && /^```\s*mermaid/.test(n.text.trim())) return "Diagram";
  if (n.type === "text") return n.text.replace(/^#+\s*/gm, "").split("\n").map((l) => l.replace(/\*\*|__|`/g, "").trim()).find(Boolean) ?? "Card";
  if (n.type === "file") return n.file.replace(/\.md$/i, "").split("/").pop() ?? n.file;
  if (n.type === "link") return n.url.replace(/^https?:\/\//, "").split("/")[0];
  return n.label ?? "Group";
};
/** Words that make the icon obvious even when the name is not an icon word. */
const HINTS: [RegExp, string][] = [[/\b(db|database|sql|postgres|mysql|mongo|store)\b/i, "database"], [/\b(queue|kafka|sqs|bus)\b/i, "queue"], [/\b(cache|redis)\b/i, "cache"], [/\b(user|client|customer|actor)\b/i, "user"], [/\b(web|browser|ui|frontend|app)\b/i, "browser"], [/\b(api|service|server|backend)\b/i, "service"], [/\b(gateway|proxy|lb|balancer)\b/i, "gateway"], [/\b(job|worker|function|lambda)\b/i, "function"], [/\b(file|bucket|s3|storage)\b/i, "bucket"]];
const iconFor = (name: string): string => { for (const [r, i] of HINTS) if (r.test(name)) return i; return suggestIcon(name.toLowerCase().split(/\s+/)[0]) ?? "service"; };

/**
 * Canvas / board cards → architecture diagram. Built through the Lumen DSL so it opens with the code view in sync;
 * card positions are kept (the studio lays out only what has no position).
 */
export function canvasToArch(c: JsonCanvas): string {
  const nodes = (c.nodes ?? []).filter((n) => n.type !== "group" && !(n.type === "text" && /^!\[[^\]]*\]\(att:/.test(n.text.trim()))); // ink image cards are not nodes
  const names = new Map<string, string>(), taken = new Set<string>();
  const L = ["direction right"];
  for (const n of nodes) {
    const label = first(n).slice(0, 60);
    let name = slug(label) || "n", k = 2;
    while (taken.has(name)) name = `${slug(label)}_${k++}`;
    taken.add(name); names.set(n.id, name);
    const icon = iconFor(label);
    L.push(`${name} [icon: ${icon}${name !== label ? `, label: "${label.replace(/"/g, "'")}"` : ""}]`);
  }
  for (const e of c.edges ?? []) {
    const a = names.get(e.fromNode), b = names.get(e.toNode);
    if (!a || !b) continue;
    const op = e.fromEnd === "arrow" ? "<>" : e.toEnd === "none" ? "-" : ">";
    L.push(`${a} ${op} ${b}${e.label ? `: ${e.label.replace(/\n/g, " ")}` : ""}`);
  }
  const dsl = L.join("\n") + "\n";
  const arch = archFromDsl("architecture", dsl, emptyArch("architecture"));
  // keep the original positions
  const pos = new Map(nodes.map((n) => [names.get(n.id)!, n]));
  arch.nodes = arch.nodes.map((a) => { const src = pos.get(a.lumenNode?.name ?? nameOf(a)) ?? pos.get(slug(displayOf(a))); return src ? { ...a, x: src.x, y: src.y } : a; });
  return stringifyArch(arch);
}

/** Architecture → plain JSON Canvas: cards with the node name and tech, edges with their label. */
export function archToCanvas(a: ArchCanvas): JsonCanvas {
  const nodes: CanvasNode[] = a.nodes.map((n) => {
    if (isGroup(n)) return { id: n.id, type: "group", x: n.x, y: n.y, width: n.width, height: n.height, label: displayOf(n), ...(n.color ? { color: n.color } : {}) } as CanvasNode;
    const tech = n.lumenNode?.tech;
    return { id: n.id, type: "text", text: `**${displayOf(n)}**${tech ? `\n${tech}` : ""}`, x: n.x, y: n.y, width: n.width, height: n.height, ...(n.color ? { color: n.color } : {}) } as CanvasNode;
  });
  const edges: CanvasEdge[] = a.edges.map((e) => ({ id: e.id, fromNode: e.fromNode, toNode: e.toNode, ...(e.fromSide ? { fromSide: e.fromSide } : {}), ...(e.toSide ? { toSide: e.toSide } : {}), ...(e.fromEnd ? { fromEnd: e.fromEnd } : {}), ...(e.toEnd ? { toEnd: e.toEnd } : {}), ...(e.label ? { label: e.label } : {}) }));
  return { nodes, edges };
}

/** Architecture → whiteboard / board skeletons (sketch style, same ids so arrows bind). */
export function archToSkeleton(a: ArchCanvas): Skeleton[] {
  const out: Skeleton[] = [];
  for (const n of a.nodes.filter((x) => !isGroup(x))) out.push({ type: "rectangle", id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, roundness: { type: 3 }, label: { text: displayOf(n), fontSize: 16 } });
  for (const e of a.edges) out.push({ type: "arrow", x: 0, y: 0, start: { id: e.fromNode }, end: { id: e.toNode }, ...(e.toEnd === "none" ? { endArrowhead: null } : {}), ...(e.fromEnd === "arrow" ? { startArrowhead: "arrow" } : {}), ...(e.label ? { label: { text: e.label } } : {}) });
  const groups = a.nodes.filter(isGroup);
  for (const g of groups) {
    const kids = a.nodes.filter((n) => !isGroup(n) && n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height).map((n) => n.id);
    if (kids.length) out.push({ type: "frame", children: kids, name: displayOf(g) });
  }
  return out;
}

/** Architecture → Markdown: a table of nodes, the connections, then the Mermaid source. */
export function archToOutline(title: string, a: ArchCanvas): string {
  const rows = a.nodes.filter((n) => !isGroup(n)).map((n: ANode) => `| ${displayOf(n).replace(/\|/g, "/")} | ${n.lumenNode?.kind ?? kindOfIcon(n.lumenNode?.icon)} | ${(n.lumenNode?.tech ?? "").replace(/\|/g, "/")} | ${n.lumenNode?.status ?? ""} |`);
  const by = new Map(a.nodes.map((n) => [n.id, displayOf(n)]));
  const conns = a.edges.map((e) => `- ${by.get(e.fromNode) ?? e.fromNode} → ${by.get(e.toNode) ?? e.toNode}${e.label ? `: ${e.label}` : ""}`);
  return `# ${title}\n\n| Name | Kind | Tech | Status |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n\n## Connections\n\n${conns.join("\n") || "- (none)"}\n\n\`\`\`mermaid\n${toMermaid(a).trim()}\n\`\`\`\n`;
}

export { parseArch };
