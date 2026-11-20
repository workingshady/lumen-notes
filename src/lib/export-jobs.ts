// Export dialog jobs for the workspaces that exist today: JSON Canvas, Mermaid file and the legacy single-image jobs.
// (Whiteboard / architecture callers build their own VisualExportJob, see the interface docs in export-job.ts.)
import type { CanvasNode, JsonCanvas, Note } from "../../shared/types";
import { buildSvg, safeName, type DiagramExportPrefs, type ExportJob } from "./diagram-export";
import type { ExportOptions, VisualExportJob } from "./export-job";
import { t } from "./i18n";
import { canvasSvg, paletteFor } from "./visual-export";

/** The legacy exporter's option set for the dialog's options (background already resolved in `bgColor`). */
export function toPrefs(o: ExportOptions, format: DiagramExportPrefs["format"]): DiagramExportPrefs {
  return { format, scale: typeof o.scale === "number" ? o.scale : 2, quality: o.quality, background: o.bgColor ? "custom" : "transparent", color: o.bgColor ?? "#ffffff", theme: o.cardStyle === "print" ? "default" : o.theme, padding: o.padding, svgText: o.svgText, embedFont: o.embedFont };
}
/** Draw a dot pattern over the background of a built SVG. */
function addPattern(svg: string, theme: DiagramExportPrefs["theme"]) {
  const vb = /viewBox="([-\d.\s]+)"/.exec(svg)?.[1]?.trim().split(/\s+/).map(Number);
  if (!vb || vb.length !== 4) return svg;
  const dots = `<defs><pattern id="lm-dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="${paletteFor(theme).muted}" fill-opacity=".3"/></pattern></defs><rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" fill="url(#lm-dots)"/>`;
  // right after the background rect when there is one, else first thing
  const m = /^(<svg\b[^>]*>(?:<style>[\s\S]*?<\/style>)?(?:<defs>[\s\S]*?<\/defs>)?(?:<rect[^>]*\/>)?)/.exec(svg);
  return m ? m[1] + dots + svg.slice(m[1].length) : svg;
}

const cardLabel = (n: CanvasNode): string => (n.type === "text" ? n.text.replace(/^#+\s*/gm, "").split("\n").find((l) => l.trim()) ?? "" : n.type === "file" ? n.file.replace(/\.md$/i, "").split("/").pop()! : n.type === "link" ? n.url.replace(/^https?:\/\/(www\.)?/, "") : n.type === "group" ? n.label ?? "" : "").trim().slice(0, 60);
/** Best-effort Mermaid flowchart of a canvas (cards become boxes, edges arrows; positions are not kept). */
export function canvasMermaid(c: JsonCanvas): string {
  const q = (s: string) => s.replace(/"/g, "'").replace(/[[\]]/g, "");
  const nodes = (c.nodes ?? []).filter((n) => n.type !== "group");
  const ids = new Map(nodes.map((n, i) => [n.id, `n${i + 1}`]));
  const lines = ["flowchart LR", ...nodes.map((n) => `  ${ids.get(n.id)}["${q(cardLabel(n)) || "card"}"]`)];
  for (const e of c.edges ?? []) { const a = ids.get(e.fromNode), b = ids.get(e.toNode); if (a && b) lines.push(`  ${a} -->${e.label ? `|${q(e.label)}|` : ""} ${b}`); }
  return lines.join("\n");
}
/** A canvas as a Markdown outline: groups as headings, cards as text / [[links]] / URLs, edges as a list. */
export function canvasMarkdown(c: JsonCanvas, title: string, o: Pick<ExportOptions, "mdOutline" | "mdMermaid">): string {
  const nodes = [...(c.nodes ?? [])].sort((a, b) => a.y - b.y || a.x - b.x);
  const inG = (n: CanvasNode, g: CanvasNode) => n.id !== g.id && n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width + 1 && n.y + n.height <= g.y + g.height + 1;
  const groups = nodes.filter((n) => n.type === "group");
  const body = (n: CanvasNode) => (n.type === "text" ? n.text.trim() : n.type === "file" ? `[[${cardLabel(n)}]]` : n.type === "link" ? `<${n.url}>` : "");
  const out = [`# ${title}`, ""];
  if (o.mdOutline) {
    const used = new Set<string>();
    for (const g of groups) { out.push(`## ${cardLabel(g) || "Group"}`, ""); for (const n of nodes.filter((x) => x.type !== "group" && inG(x, g))) { used.add(n.id); out.push(body(n), ""); } }
    const rest = nodes.filter((n) => n.type !== "group" && !used.has(n.id));
    if (rest.length) { if (groups.length) out.push("## Cards", ""); for (const n of rest) out.push(body(n), ""); }
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const es = (c.edges ?? []).filter((e) => byId.has(e.fromNode) && byId.has(e.toNode));
    if (es.length) { out.push("## Connections", ""); for (const e of es) out.push(`- ${cardLabel(byId.get(e.fromNode)!)} → ${cardLabel(byId.get(e.toNode)!)}${e.label ? ` (${e.label})` : ""}`); out.push(""); }
  }
  if (o.mdMermaid) out.push("```mermaid", canvasMermaid(c), "```", "");
  return out.join("\n");
}
const subCanvas = (c: JsonCanvas, keep: (n: CanvasNode) => boolean): JsonCanvas => {
  const nodes = (c.nodes ?? []).filter(keep), ids = new Set(nodes.map((n) => n.id));
  return { ...c, nodes, edges: (c.edges ?? []).filter((e) => ids.has(e.fromNode) && ids.has(e.toNode)) };
};

export interface CanvasJobIn {
  title: string;
  canvas: () => JsonCanvas;
  notes: Note[];
  selectedIds?: string[];
  /** Visible area in canvas coordinates. */
  view?: { x: number; y: number; w: number; h: number };
  link?: string;
}
/** The Export dialog job for a JSON Canvas. */
export function canvasJob(i: CanvasJobIn): VisualExportJob {
  const scoped = (scope: string, ids: string[]): JsonCanvas => {
    const c = i.canvas();
    if (scope === "selection") { const s = new Set(i.selectedIds ?? []); return subCanvas(c, (n) => s.has(n.id)); }
    if (scope === "visible" && i.view) { const v = i.view; return subCanvas(c, (n) => n.x < v.x + v.w && n.x + n.width > v.x && n.y < v.y + v.h && n.y + n.height > v.y); }
    if (scope === "groups" && ids.length) {
      const gs = (c.nodes ?? []).filter((n) => ids.includes(n.id));
      return subCanvas(c, (n) => gs.some((g) => n.id === g.id || (n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width + 1 && n.y + n.height <= g.y + g.height + 1)));
    }
    return c;
  };
  const groups = (i.canvas().nodes ?? []).filter((n) => n.type === "group").map((g) => ({ id: g.id, name: cardLabel(g) || t("Group") }));
  const scopes: VisualExportJob["scopes"] = ["whole", ...((i.selectedIds?.length ?? 0) ? (["selection"] as const) : []), ...(i.view ? (["visible"] as const) : []), ...(groups.length ? (["groups"] as const) : [])];
  return {
    kind: "canvas", title: `${i.title}.canvas`, name: safeName(i.title), sourceExt: ".canvas", scopes, pickers: groups.length ? { groups } : undefined, hasPattern: true, themable: true, link: i.link,
    content: ["cardStyle", "groupLabels", "edgeLabels", "embedScene"],
    build: async (r) => {
      const p = toPrefs(r.opts, r.format === "svg" ? "svg" : "png");
      const b = await canvasSvg(scoped(r.scope, r.ids), i.notes, p, { cardStyle: r.opts.cardStyle === "screen", groupLabels: r.opts.groupLabels, edgeLabels: r.opts.edgeLabels });
      return r.opts.pattern ? { ...b, svg: addPattern(b.svg, p.theme) } : b;
    },
    source: async () => JSON.stringify(i.canvas(), null, 2),
    markdown: async (o) => canvasMarkdown(scoped(o.scope, o.ids), i.title, o),
    mermaid: async (o) => canvasMermaid(scoped(o.scope, o.ids)), mermaidKinds: ["flowchart"], mermaidNote: t("Best effort: only cards and arrows convert. Positions are not kept."),
  };
}
/** The Export dialog job for a Mermaid diagram. */
export function mermaidJob(src: string, name: string): VisualExportJob {
  const title = safeName(name);
  return {
    kind: "mermaid", title: `${title}.mermaid`, name: title, sourceExt: ".mermaid", scopes: ["whole"], themable: true, content: ["embedScene"], defaults: { format: "svg", background: "theme" },
    build: async (r) => buildSvg(src, toPrefs(r.opts, r.format === "svg" ? "svg" : "png")),
    source: async () => src,
    markdown: async () => `# ${title}\n\n\`\`\`mermaid\n${src}\n\`\`\`\n`,
    mermaid: async () => src, mermaidKinds: ["flowchart"],
  };
}
/** Adapter for callers of the older `openExport(job)` (graph view, diagram lists): a single-scope image job. */
export function legacyJob(d: ExportJob): VisualExportJob {
  if (d.src) return { ...mermaidJob(d.src, d.name), title: d.title };
  return {
    kind: "graph", title: d.title, name: safeName(d.name), scopes: ["whole"], themable: d.themable, defaults: { format: "png", background: "theme" }, content: [],
    build: (r) => d.build(toPrefs(r.opts, r.format === "svg" ? "svg" : "png")),
  };
}
