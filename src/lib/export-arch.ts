// Export dialog job for the architecture studio (frame 42E): images, JSON Canvas source, Markdown, Mermaid (every kind),
// plus the format plugins Lumen code (.lumendiagram), draw.io XML, SQL DDL and MD + table; scope Layer / C4 level.
import type { Note } from "../../shared/types";
import { MERMAID_EXPORT_FLAVORS, defaultFlavor, toMermaid, type MermaidFlavor } from "./arch-convert";
import { dslFor } from "./arch-dsl";
import { descendants, displayOf, hiddenBy, isGroup, nameOf, parentOf, parseArch, stringifyArch, type ANode, type ArchCanvas } from "./arch-model";
import { C4_LABEL } from "./arch-objects";
import { archSvg } from "./arch-render";
import { safeName } from "./diagram-export";
import type { ExportOptions, FormatPlugin, PickItem, VisualExportJob } from "./export-job";
import { addPattern, toPrefs } from "./export-jobs";
import { t } from "./i18n";

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The sub-diagram of `ids` (nodes and every descendant), with the edges among them. */
function subArch(c: ArchCanvas, keep: Set<string>): ArchCanvas {
  const ids = new Set<string>();
  for (const id of keep) { ids.add(id); for (const d of descendants(c, id)) ids.add(d); }
  const nodes = c.nodes.filter((n) => ids.has(n.id)).map((n) => (parentOf(n) && !ids.has(parentOf(n)!) ? ({ ...n, ...(isGroup(n) ? { lumenGroup: { ...n.lumenGroup!, parent: undefined } } : { lumenNode: { ...n.lumenNode, parent: undefined } }) } as ANode) : n));
  return { ...c, nodes, edges: c.edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode)) };
}

// ------------------------------------------------------------------ draw.io
const DRAWIO_STYLE = (n: ANode) => {
  const i = n.lumenNode?.icon ?? "";
  if (isGroup(n)) return "rounded=1;arcSize=4;dashed=1;fillColor=none;container=1;collapsible=0;verticalAlign=top;align=left;spacingLeft=10;fontStyle=1;html=1;";
  if (/database|vector-db|warehouse/.test(i)) return "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;size=10;";
  if (/user|owner|actor/.test(i)) return "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;";
  if (i === "decision") return "rhombus;whiteSpace=wrap;html=1;";
  if (i === "terminator") return "rounded=1;arcSize=50;whiteSpace=wrap;html=1;";
  if (/queue|topic|stream/.test(i)) return "shape=mxgraph.basic.rect;rounded=1;whiteSpace=wrap;html=1;dashed=0;";
  if (/internet|cdn|external/.test(i)) return "ellipse;shape=cloud;whiteSpace=wrap;html=1;";
  return "rounded=1;whiteSpace=wrap;html=1;";
};
/** Uncompressed draw.io file (mxfile). Child geometry is relative to its container, as draw.io expects. */
export function toDrawio(c: ArchCanvas, title: string): string {
  const by = new Map(c.nodes.map((n) => [n.id, n]));
  const id = (s: string) => `c-${s.replace(/[^\w-]/g, "_")}`;
  const out: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  // parents before children
  const order = [...c.nodes].sort((a, b) => depth(a) - depth(b));
  function depth(n: ANode) { let d = 0, p = parentOf(n); while (p && by.has(p) && d < 50) { d++; p = parentOf(by.get(p)!); } return d; }
  for (const n of order) {
    const p = parentOf(n), par = p && by.has(p) ? by.get(p)! : null;
    const x = n.x - (par?.x ?? 0), y = n.y - (par?.y ?? 0);
    const label = [displayOf(n), n.lumenNode?.tech ? `<i>${xmlEsc(n.lumenNode.tech)}</i>` : ""].filter(Boolean).join("<br>");
    const stroke = isGroup(n) ? "strokeColor=#7AA2F7;" : "";
    out.push(`<mxCell id="${id(n.id)}" value="${xmlEsc(isGroup(n) ? displayOf(n) : label)}" style="${DRAWIO_STYLE(n)}${stroke}" vertex="1" parent="${par ? id(par.id) : "1"}"><mxGeometry x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(n.width)}" height="${Math.round(n.height)}" as="geometry"/></mxCell>`);
  }
  for (const e of c.edges) {
    if (!by.has(e.fromNode) || !by.has(e.toNode)) continue;
    const st = e.lumenEdge?.style;
    const style = `edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;${st === "async" ? "dashed=1;" : st === "control" ? "dashed=1;dashPattern=2 4;" : ""}${st === "data" ? "strokeWidth=2;" : ""}${e.fromEnd === "arrow" ? "startArrow=block;" : ""}${e.toEnd === "none" ? "endArrow=none;" : "endArrow=block;"}`;
    out.push(`<mxCell id="${id(e.id)}" value="${xmlEsc(e.label ?? "")}" style="${style}" edge="1" parent="1" source="${id(e.fromNode)}" target="${id(e.toNode)}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="Lumen" type="device"><diagram id="lumen" name="${xmlEsc(title)}"><mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" connect="1" arrows="1" page="0"><root>\n${out.join("\n")}\n</root></mxGraphModel></diagram></mxfile>\n`;
}

// ------------------------------------------------------------------ SQL DDL
const SQL_TYPE: Record<string, string> = { uuid: "UUID", string: "TEXT", text: "TEXT", varchar: "VARCHAR(255)", int: "INTEGER", integer: "INTEGER", bigint: "BIGINT", number: "NUMERIC", decimal: "NUMERIC", float: "REAL", bool: "BOOLEAN", boolean: "BOOLEAN", date: "DATE", datetime: "TIMESTAMP", timestamp: "TIMESTAMP", time: "TIME", json: "JSONB", jsonb: "JSONB", money: "NUMERIC(12,2)" };
const ident = (s: string) => { const x = s.trim().replace(/\s+/g, "_"); return /^[A-Za-z_][\w]*$/.test(x) ? x.toLowerCase() : `"${x.replace(/"/g, "")}"`; };
/** CREATE TABLE per entity (fields from the ERD; PK / FK keys), foreign keys from the relationships. */
export function toSql(c: ArchCanvas, title: string): string {
  const ents = c.nodes.filter((n) => !isGroup(n) && n.lumenNode?.kind !== "junction" && !hiddenBy(c, n.id));
  const by = new Map(ents.map((n) => [n.id, n]));
  const fromErd = ents.some((n) => n.lumenNode?.fields?.length);
  const out = [`-- ${title}`, `-- Generated by Lumen from the ${fromErd ? "ERD" : "diagram (no fields yet: one id column per table)"}`, ""];
  const pkOf = (n: ANode) => n.lumenNode?.fields?.find((f) => /pk/i.test(f.key ?? ""))?.name ?? "id";
  for (const n of ents.filter((x) => !fromErd || x.lumenNode?.fields?.length)) {
    const fields = n.lumenNode?.fields?.length ? n.lumenNode.fields : [{ name: "id", type: "uuid", key: "pk" }];
    const cols = fields.map((f) => `  ${ident(f.name)} ${SQL_TYPE[(f.type ?? "").toLowerCase()] ?? ((f.type ?? "").toUpperCase() || "TEXT")}${/pk/i.test(f.key ?? "") ? " PRIMARY KEY" : /uk|unique/i.test(f.key ?? "") ? " UNIQUE" : ""}${/pk/i.test(f.key ?? "") ? "" : /nn|not ?null/i.test(f.key ?? "") ? " NOT NULL" : ""}`);
    const fks: string[] = [];
    for (const e of c.edges.filter((x) => x.toNode === n.id && by.has(x.fromNode))) {
      const ref = by.get(e.fromNode)!;
      const col = fields.find((f) => f.name === e.label || (/fk/i.test(f.key ?? "") && f.name.toLowerCase().startsWith(nameOf(ref).toLowerCase().replace(/s$/, ""))));
      if (col) fks.push(`  FOREIGN KEY (${ident(col.name)}) REFERENCES ${ident(nameOf(ref))} (${ident(pkOf(ref))})`);
      else if (!fromErd) { const fk = `${nameOf(ref).toLowerCase().replace(/\W+/g, "_")}_id`; cols.push(`  ${ident(fk)} UUID`); fks.push(`  FOREIGN KEY (${ident(fk)}) REFERENCES ${ident(nameOf(ref))} (id)`); }
    }
    out.push(`CREATE TABLE ${ident(nameOf(n))} (`, [...cols, ...fks].join(",\n"), ");", "");
  }
  return out.join("\n");
}

// ------------------------------------------------------------------ Markdown
export function archMarkdown(c: ArchCanvas, title: string, o: Pick<ExportOptions, "mdOutline" | "mdTable" | "mdMermaid" | "mdAttachments">, flavor: MermaidFlavor, image?: string): string {
  const by = new Map(c.nodes.map((n) => [n.id, n]));
  const out = [`# ${title}`, ""];
  if (image) out.push(`![${title}](${image})`, "");
  if (o.mdOutline) {
    const kids = new Map<string | undefined, ANode[]>();
    for (const n of c.nodes) { const p = parentOf(n); const k = p && by.has(p) ? p : undefined; kids.set(k, [...(kids.get(k) ?? []), n]); }
    const walk = (p: string | undefined, ind: string) => {
      for (const n of kids.get(p) ?? []) {
        if (isGroup(n)) { out.push(`${ind}- **${displayOf(n)}**${n.lumenGroup?.sub ? ` (${n.lumenGroup.kind} · ${n.lumenGroup.sub})` : n.lumenGroup?.kind ? ` (${n.lumenGroup.kind})` : ""}`); walk(n.id, ind + "  "); continue; }
        const ln = n.lumenNode;
        out.push(`${ind}- ${displayOf(n)}${ln?.tech ? ` · ${ln.tech}` : ""}${ln?.description ? `: ${ln.description.replace(/\n+/g, " ")}` : ""}`);
        for (const l of ln?.links ?? []) out.push(`${ind}  - ${/^https?:/.test(l) ? `<${l}>` : `[[${l}]]`}`);
      }
    };
    walk(undefined, "");
    out.push("");
    const es = c.edges.filter((e) => by.has(e.fromNode) && by.has(e.toNode));
    if (es.length) { out.push("## Connections", ""); for (const e of es) out.push(`- ${displayOf(by.get(e.fromNode)!)} → ${displayOf(by.get(e.toNode)!)}${e.label ? ` (${e.label})` : ""}${e.lumenEdge?.style && e.lumenEdge.style !== "sync" ? ` · ${e.lumenEdge.style}` : ""}`); out.push(""); }
  }
  if (o.mdTable) {
    const comps = c.nodes.filter((n) => !isGroup(n) && n.lumenNode?.kind !== "junction");
    out.push("## Components", "", "| Component | Kind | Technology | Group | Status | Owner |", "|---|---|---|---|---|---|");
    for (const n of comps) { const ln = n.lumenNode, g = parentOf(n) ? by.get(parentOf(n)!) : undefined; out.push(`| ${cell(displayOf(n))} | ${cell(ln?.kind ?? "service")} | ${cell(ln?.tech ?? "")} | ${cell(g ? displayOf(g) : "")} | ${cell(ln?.status ?? "")} | ${cell(ln?.owner ?? "")} |`); }
    out.push("");
  }
  if (o.mdMermaid) out.push("```mermaid", toMermaid(c, flavor).trimEnd(), "```", "");
  return out.join("\n");
}

export interface ArchJobIn {
  title: string;
  canvas: () => ArchCanvas;
  notes: Note[];
  note: Note;
  selectedIds?: string[];
  view?: { x: number; y: number; w: number; h: number };
  link?: string;
}
/** The Export dialog job for an architecture diagram. */
export function archJob(i: ArchJobIn): VisualExportJob {
  const c0 = i.canvas();
  // Layer / C4 level: every group is a layer; the C4 levels linked to this diagram render their own diagram
  const layers: PickItem[] = c0.nodes.filter(isGroup).map((g) => ({ id: g.id, name: displayOf(g) || t("Group") }));
  const c4: PickItem[] = [];
  {
    const seen = new Set<string>();
    const add = (n: Note) => { const c = parseArch(n.body); if (!c?.lumenArch.c4 || seen.has(n.id) || n.deleted) return; seen.add(n.id); c4.push({ id: `c4:${n.id}`, name: `C4 ${t(C4_LABEL[c.lumenArch.c4.level])}${n.id === i.note.id ? "" : ` · ${n.title}`}` }); };
    let cur: Note | undefined = i.note, guard = 0;
    while (cur && guard++ < 6) { add(cur); const p: string | undefined = parseArch(cur.body)?.lumenArch.c4?.parent; cur = p ? i.notes.find((n) => n.id === p) : undefined; }
    for (const n of c0.nodes) { const z = n.lumenNode?.zoom; const zn = z && i.notes.find((x) => x.id === z); if (zn) add(zn); }
  }
  const picks = [...c4, ...layers];
  const scoped = (scope: string, ids: string[]): ArchCanvas => {
    const c = i.canvas();
    if (scope === "selection" && i.selectedIds?.length) return subArch(c, new Set(i.selectedIds));
    if (scope === "visible" && i.view) { const v = i.view; return subArch(c, new Set(c.nodes.filter((n) => !isGroup(n) && n.x < v.x + v.w && n.x + n.width > v.x && n.y < v.y + v.h && n.y + n.height > v.y).map((n) => n.id))); }
    if (scope === "layers" && ids.length) {
      const note = ids.find((x) => x.startsWith("c4:"));
      if (note) { const n = i.notes.find((x) => x.id === note.slice(3)); const p = n && (n.id === i.note.id ? c : parseArch(n.body)); if (p) return p; }
      return subArch(c, new Set(ids.filter((x) => !x.startsWith("c4:"))));
    }
    return c;
  };
  const flavor = (k: string) => (MERMAID_EXPORT_FLAVORS.includes(k as MermaidFlavor) ? k as MermaidFlavor : defaultFlavor(c0.lumenArch.kind));
  const exportDefault: MermaidFlavor = c0.lumenArch.kind === "state" ? "state" : c0.lumenArch.kind === "class" ? "class" : defaultFlavor(c0.lumenArch.kind);
  const md = async (o: ExportOptions, table: boolean) => {
    const c = scoped(o.scope, o.ids);
    const opts = { ...o, mdTable: table || o.mdTable };
    if (!o.mdAttachments) return archMarkdown(c, i.title, opts, flavor(o.mermaidKind));
    const img = await archSvg(c, toPrefs({ ...o, bgColor: o.bgColor }, "svg"));
    const file = `${safeName(i.title)}.svg`;
    return { text: archMarkdown(c, i.title, opts, flavor(o.mermaidKind), `attachments/${file}`), files: [{ name: file, blob: new Blob([img.svg], { type: "image/svg+xml" }) }] };
  };
  const formats: FormatPlugin[] = [
    { id: "lumen-code", label: t("Lumen code"), glyph: "code", sub: ".lumendiagram", ext: "lumendiagram", mime: "text/plain", run: async (o) => dslFor(scoped(o.scope, o.ids)) },
    { id: "drawio", label: "draw.io", glyph: "diagram", sub: "XML", ext: "drawio", mime: "application/xml", run: async (o) => toDrawio(scoped(o.scope, o.ids), i.title) },
    { id: "sql", label: "SQL DDL", glyph: "database", sub: t("from ERD"), ext: "sql", mime: "application/sql", run: async (o) => toSql(scoped(o.scope, o.ids), i.title) },
    { id: "md-table", label: t("MD + table"), glyph: "table", sub: t("components"), ext: "md", mime: "text/markdown", run: async (o) => { const r = await md({ ...o, mdAttachments: false }, true); return typeof r === "string" ? r : r.text; } },
  ];
  const scopes: VisualExportJob["scopes"] = ["whole", ...((i.selectedIds?.length ?? 0) ? (["selection"] as const) : []), ...(i.view ? (["visible"] as const) : []), ...(picks.length ? (["layers"] as const) : [])];
  return {
    kind: "architecture", title: `${i.title}.canvas`, name: safeName(i.title), sourceExt: ".canvas", scopes, pickers: picks.length ? { layers: picks } : undefined,
    hasPattern: true, themable: true, link: i.link, content: ["groupLabels", "edgeLabels", "embedScene"],
    defaults: { format: "mermaid", mermaidKind: exportDefault },
    build: async (r) => {
      const p = toPrefs(r.opts, r.format === "svg" ? "svg" : "png");
      const b = await archSvg(scoped(r.scope, r.ids), p, { groupLabels: r.opts.groupLabels, edgeLabels: r.opts.edgeLabels });
      return r.opts.pattern ? { ...b, svg: addPattern(b.svg, p.theme) } : b;
    },
    source: async () => stringifyArch(i.canvas()),
    markdown: (o) => md(o, false),
    mermaid: async (o, k) => toMermaid(scoped(o.scope, o.ids), flavor(k)),
    mermaidKinds: MERMAID_EXPORT_FLAVORS,
    mermaidNote: t("Groups become groups, junctions stay. Positions are not kept; Mermaid lays out by itself."),
    formats,
  };
}
