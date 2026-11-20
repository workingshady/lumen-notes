// Chooser imports (round 7, Lumen 40): turn a draw.io / Terraform / SQL DDL file into a canvas body with `lumenArch`.
// The raw source rides along in lumenArch.source so the architecture studio can re-parse it with its own converters.
import type { JsonCanvas } from "../../shared/types";
import { archCanvas } from "./templates-visual";

type Spec = Parameters<typeof archCanvas>[0];
const slug = (s: string) => s.replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "") || "n";
const grid = (i: number, cols = 4) => ({ x: 10 + (i % cols) * 120, y: 20 + Math.floor(i / cols) * 60 });
const withSource = (c: JsonCanvas & Record<string, unknown>, format: string, source: string) => {
  (c as { lumenArch: Record<string, unknown> }).lumenArch = { ...(c as { lumenArch: Record<string, unknown> }).lumenArch, source: { format, text: source } };
  return JSON.stringify(c, null, 2);
};

export function drawioToCanvas(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error("Not valid draw.io XML");
  const cells = [...doc.querySelectorAll("mxCell")];
  const nodes: Record<string, unknown>[] = [], edges: Record<string, unknown>[] = [];
  const plain = (v: string) => { const d = new DOMParser().parseFromString(v || "", "text/html"); return (d.body.textContent ?? "").trim(); };
  const ids = new Set<string>();
  for (const c of cells) {
    if (c.getAttribute("vertex") !== "1") continue;
    const g = c.querySelector("mxGeometry");
    const id = c.getAttribute("id")!;
    ids.add(id);
    nodes.push({ id, type: "text", text: plain(c.getAttribute("value") ?? "") || " ", x: Math.round(Number(g?.getAttribute("x") ?? 0)), y: Math.round(Number(g?.getAttribute("y") ?? 0)), width: Math.max(60, Math.round(Number(g?.getAttribute("width") ?? 120))), height: Math.max(40, Math.round(Number(g?.getAttribute("height") ?? 60))) });
  }
  for (const c of cells) {
    if (c.getAttribute("edge") !== "1") continue;
    const a = c.getAttribute("source"), b = c.getAttribute("target");
    if (a && b && ids.has(a) && ids.has(b)) edges.push({ id: c.getAttribute("id")!, fromNode: a, toNode: b, ...(plain(c.getAttribute("value") ?? "") ? { label: plain(c.getAttribute("value")!) } : {}) });
  }
  if (!nodes.length) throw new Error("No shapes found in this draw.io file");
  return withSource({ nodes, edges, lumenArch: { kind: "architecture", direction: "right", dsl: "", layout: "manual" } } as never, "drawio", xml);
}

export function terraformToCanvas(hcl: string): string {
  const blocks = [...hcl.matchAll(/^\s*resource\s+"([\w-]+)"\s+"([\w-]+)"\s*\{/gm)];
  if (!blocks.length) throw new Error("No resource blocks found");
  const bodies = blocks.map((m, i) => hcl.slice(m.index! + m[0].length, i + 1 < blocks.length ? blocks[i + 1].index : undefined));
  const ids = blocks.map((m) => slug(`${m[1]}.${m[2]}`));
  const spec: Spec = { kind: "architecture", nodes: blocks.map((m, i) => ({ id: ids[i], label: m[2], icon: /db|rds|dynamo|sql/.test(m[1]) ? "database" : /lambda|function/.test(m[1]) ? "function" : /s3|bucket/.test(m[1]) ? "storage" : /sqs|queue/.test(m[1]) ? "queue" : /lb|gateway/.test(m[1]) ? "load-balancer" : "service", ...grid(i) })), edges: [] };
  blocks.forEach((_m, i) => bodies[i].replace(/\b([a-z][\w-]*_[\w-]+)\.([\w-]+)\b/g, (full, t: string, n: string) => {
    const to = ids.indexOf(slug(`${t}.${n}`));
    if (to >= 0 && to !== i && !spec.edges.some((e) => e.from === ids[i] && e.to === ids[to])) spec.edges.push({ from: ids[i], to: ids[to] });
    return full;
  }));
  return withSource(archCanvas(spec), "terraform", hcl);
}

export function sqlToCanvas(sql: string): string {
  const tables = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?[`"[]?([\w.]+)[`"\]]?\s*\(([\s\S]*?)\)\s*;/gi)];
  if (!tables.length) throw new Error("No CREATE TABLE statements found");
  const nodes: Record<string, unknown>[] = [], edges: Record<string, unknown>[] = [];
  const names = tables.map((t) => t[1].split(".").pop()!);
  tables.forEach((t, i) => {
    const cols: string[] = [];
    for (const raw of t[2].split(/,\s*(?![^()]*\))/)) {
      const l = raw.trim().replace(/\s+/g, " ");
      const fk = /references\s+[`"]?([\w.]+)[`"]?/i.exec(l);
      if (/^(primary key|constraint|unique|key|index|foreign key)/i.test(l)) {
        const f = /foreign key\s*\(([^)]+)\)\s*references\s+[`"]?([\w.]+)/i.exec(l);
        if (f) { const to = names.indexOf(f[2].split(".").pop()!); if (to >= 0) edges.push({ id: `e${edges.length}`, fromNode: names[to], toNode: names[i], fromSide: "right", toSide: "left", label: `${f[1]}` }); }
        continue;
      }
      const m = /^[`"]?(\w+)[`"]?\s+(\w+)/.exec(l);
      if (!m) continue;
      cols.push(`${m[1]} ${/primary key/i.test(l) ? "PK" : fk ? "FK" : m[2].toLowerCase()}`);
      if (fk) { const to = names.indexOf(fk[1].split(".").pop()!); if (to >= 0) edges.push({ id: `e${edges.length}`, fromNode: names[to], toNode: names[i], fromSide: "right", toSide: "left", label: m[1] }); }
    }
    nodes.push({ id: names[i], type: "text", text: `**${names[i]}**\n${cols.join("\n")}`, x: (i % 3) * 420, y: Math.floor(i / 3) * 360, width: 300, height: Math.max(120, 60 + cols.length * 26), lumenNode: { kind: "entity", icon: "database", table: { name: names[i], columns: cols } } });
  });
  return withSource({ nodes, edges, lumenArch: { kind: "erd", direction: "right", dsl: "", layout: "manual" } } as never, "sql", sql);
}
