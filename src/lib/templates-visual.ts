// Visual templates (round 7, Lumen 51): study, whiteboard and architecture starters, each producing real content.
// Study = .excalidraw scene built from the skeleton helpers (converted by the whiteboard on first open via lumenPending);
// Architecture = JSON Canvas body with `lumenArch` (+ DSL) and `lumenNode` per node, so other canvas readers still open it.
import type { JsonCanvas } from "../../shared/types";
import { tk } from "./i18n";
import { placeBoundArrows, sk, type Skeleton } from "./whiteboard";

export type TplCategory = "Study" | "Architecture" | "Interview";
/** One drawn piece of a gallery thumbnail (a 310 x 170 stage). */
export interface ThumbEl { x: number; y: number; w: number; h: number; bg?: string; bd?: string; r?: string; t?: string; fs?: number; fw?: number; c?: string; g?: string; gc?: string }
export interface ThumbLine { d: string; c: string; w?: number; da?: string }
export interface VisualTemplate {
  id: string; name: string; cat: TplCategory; caption: string;
  type: "whiteboard" | "canvas"; title: string;
  els: ThumbEl[]; lines: ThumbLine[];
  build: () => string;
}

const scene = (skel: Skeleton[]) => JSON.stringify({ type: "excalidraw", version: 2, source: "lumen", elements: [], appState: { viewBackgroundColor: "transparent", gridSize: null }, files: {}, lumenPending: placeBoundArrows(skel) });
const line = (x: number, y: number, dx: number, dy: number, o: Record<string, unknown> = {}): Skeleton => ({ type: "line", x, y, width: dx, height: dy, points: [[0, 0], [dx, dy]], ...o });
const STROKE = "#868e96";

// ------------------------------------------------------------------ study (whiteboard scenes)
const cornell = () => scene([
  sk.rect(0, 0, 900, 640, undefined, { id: "frame", strokeColor: STROKE, backgroundColor: "transparent" }),
  line(260, 0, 0, 500, { strokeColor: STROKE }), line(0, 500, 900, 0, { strokeColor: STROKE }),
  sk.text(16, 14, tk("Cues"), { fontSize: 24, strokeColor: STROKE }), sk.text(276, 14, tk("Notes"), { fontSize: 24, strokeColor: STROKE }), sk.text(16, 514, tk("Summary"), { fontSize: 24, strokeColor: STROKE }),
]);
const kanban = () => {
  const cols = [tk("To learn"), tk("Learning"), tk("Mastered")];
  const out: Skeleton[] = [];
  cols.forEach((c, i) => {
    out.push(sk.rect(i * 300, 0, 280, 560, undefined, { strokeColor: STROKE, backgroundColor: "transparent" }), sk.text(i * 300 + 16, 14, c, { fontSize: 22, strokeColor: STROKE }));
  });
  out.push(sk.sticky(20, 60, tk("First topic"), 0), sk.sticky(20, 240, tk("Second topic"), 0), sk.sticky(320, 60, tk("In progress"), 2), sk.sticky(620, 60, tk("Done"), 1));
  return scene(out);
};
const timeline = () => {
  const out: Skeleton[] = [line(0, 0, 1000, 0, { strokeColor: STROKE, strokeWidth: 3 })];
  for (let i = 0; i < 4; i++) {
    out.push(sk.ellipse(i * 300 + 40, -14, 28, 28, undefined, { backgroundColor: "#F2A93B", fillStyle: "solid", strokeColor: "#B45F0E" }), sk.text(i * 300 + 20, 30, tk("Date"), { fontSize: 20, strokeColor: STROKE }), sk.text(i * 300 + 20, 62, tk("Milestone"), { fontSize: 20 }));
  }
  return scene(out);
};
const venn = () => scene([
  sk.ellipse(0, 0, 300, 300, undefined, { strokeColor: "#E5534B" }), sk.ellipse(200, 0, 300, 300, undefined, { strokeColor: "#39C5CF" }), sk.ellipse(100, 160, 300, 300, undefined, { strokeColor: "#57AB5A" }),
  sk.text(80, 110, "A", { fontSize: 28 }), sk.text(390, 110, "B", { fontSize: 28 }), sk.text(235, 370, "C", { fontSize: 28 }),
]);

// ------------------------------------------------------------------ architecture (canvas + lumenArch + DSL)
interface ANode { id: string; label: string; icon: string; x: number; y: number; w?: number; col?: string; kind?: string }
interface AGroup { label: string; x: number; y: number; w: number; h: number; col: string; kind: string }
interface AEdge { from: string; to: string; label?: string; dashed?: boolean; style?: "async" | "sync" }
interface ASpec { kind: string; dir?: "right" | "down"; nodes: ANode[]; groups?: AGroup[]; edges: AEdge[] }
const K = 2.2; // stage -> canvas scale
const NW = 86, NH = 30;
const inBox = (n: ANode, g: AGroup) => n.x >= g.x && n.y >= g.y && n.x + (n.w ?? NW) <= g.x + g.w && n.y + NH <= g.y + g.h;

function dslOf(s: ASpec) {
  const out = [`direction ${s.dir ?? "right"}`];
  const used = new Set<string>();
  const line = (n: ANode, pad: string) => `${pad}${n.label} [icon: ${n.icon}]`;
  for (const g of s.groups ?? []) {
    out.push(`${g.label} [icon: ${g.kind}] {`);
    for (const n of s.nodes.filter((n) => inBox(n, g))) { out.push(line(n, "  ")); used.add(n.id); }
    out.push("}");
  }
  for (const n of s.nodes) if (!used.has(n.id)) out.push(line(n, ""));
  const lab = (id: string) => s.nodes.find((n) => n.id === id)!.label;
  for (const e of s.edges) out.push(`${lab(e.from)} > ${lab(e.to)}${e.label ? `: ${e.label}` : ""}`);
  return out.join("\n");
}
export function archCanvas(s: ASpec): JsonCanvas & Record<string, unknown> {
  const nodes: Record<string, unknown>[] = [];
  s.groups?.forEach((g, i) => nodes.push({ id: `g${i}`, type: "group", label: g.label, x: Math.round(g.x * K), y: Math.round(g.y * K), width: Math.round(g.w * K), height: Math.round(g.h * K), color: g.col, lumenGroup: { kind: g.kind } }));
  for (const n of s.nodes) nodes.push({ id: n.id, type: "text", text: n.label, x: Math.round(n.x * K), y: Math.round(n.y * K), width: Math.round((n.w ?? NW) * K), height: Math.round(NH * K), ...(n.col ? { color: n.col } : {}), lumenNode: { kind: n.kind ?? n.icon, icon: n.icon } });
  const edges = s.edges.map((e, i) => {
    const a = s.nodes.find((n) => n.id === e.from)!, b = s.nodes.find((n) => n.id === e.to)!;
    const vert = Math.abs(a.x - b.x) < 20;
    const sides = vert ? (b.y > a.y ? ["bottom", "top"] : ["top", "bottom"]) : (b.x > a.x ? ["right", "left"] : ["left", "right"]);
    return { id: `e${i}`, fromNode: e.from, toNode: e.to, fromSide: sides[0], toSide: sides[1], toEnd: "arrow", ...(e.label ? { label: e.label } : {}), ...(e.dashed ? { lumenEdge: { style: e.style ?? "async", dash: "dashed" } } : { lumenEdge: { style: "sync" } }) };
  });
  return { nodes, edges, lumenArch: { kind: s.kind, direction: s.dir ?? "right", dsl: dslOf(s), layout: "manual" } } as never;
}

function thumbOf(s: ASpec): { els: ThumbEl[]; lines: ThumbLine[] } {
  const els: ThumbEl[] = [];
  const hex: Record<string, string> = { "1": "#E5534B", "2": "#E8893A", "3": "#E3B341", "4": "#57AB5A", "5": "#39C5CF", "6": "#A371F7" };
  for (const g of s.groups ?? []) els.push({ x: g.x, y: g.y, w: g.w, h: g.h, bd: `1.5px dashed ${hex[g.col] ?? g.col}`, r: "10px" });
  for (const n of s.nodes) els.push({ x: n.x, y: n.y, w: n.w ?? NW, h: NH, bg: "var(--surface)", bd: `1px solid ${n.col ? hex[n.col] ?? n.col : "var(--border)"}`, r: "7px", t: n.label, fs: 10.5, g: n.icon, gc: n.col ? hex[n.col] ?? n.col : "var(--muted)" });
  const lines: ThumbLine[] = s.edges.map((e) => {
    const a = s.nodes.find((n) => n.id === e.from)!, b = s.nodes.find((n) => n.id === e.to)!;
    const aw = a.w ?? NW, bw = b.w ?? NW;
    const dash = e.dashed ? { c: "var(--le, #B48EF0)", w: 1.5, da: "5 4" } : { c: "var(--text)" };
    if (Math.abs(a.x - b.x) < 20) { const x = a.x + aw / 2; return { d: b.y > a.y ? `M${x} ${a.y + NH} V${b.y}` : `M${x} ${a.y} V${b.y + NH}`, ...dash }; }
    const fwd = b.x > a.x, x0 = fwd ? a.x + aw : a.x, x1 = fwd ? b.x : b.x + bw, y0 = a.y + NH / 2, y1 = b.y + NH / 2, mx = (x0 + x1) / 2;
    return { d: Math.abs(y0 - y1) < 1 ? `M${x0} ${y0} H${x1}` : `M${x0} ${y0} C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`, ...dash };
  });
  return { els, lines };
}

const N = (id: string, label: string, icon: string, x: number, y: number, col?: string, w?: number): ANode => ({ id, label, icon, x, y, col, w });
const ARCH: { id: string; name: string; cat: TplCategory; caption?: string; title: string; spec: ASpec; extra?: { els?: ThumbEl[]; lines?: ThumbLine[] } }[] = [
  { id: "three-tier", name: tk("3-tier web app"), cat: "Architecture", title: "3-tier web app", spec: { kind: "architecture", nodes: [N("web", "Web", "browser", 16, 70), N("api", "API", "service", 116, 70, "#F2A93B"), N("db", "Postgres", "database", 216, 70, "#5CC8C2", 84)], edges: [{ from: "web", to: "api" }, { from: "api", to: "db" }] } },
  { id: "serverless", name: tk("Serverless API"), cat: "Architecture", title: "Serverless API", spec: { kind: "architecture", nodes: [N("gw", "Gateway", "gateway", 10, 70), N("fn", "Lambda", "function", 112, 70, "#E8893A"), N("dy", "Dynamo", "database", 214, 40), N("q", "SQS", "queue", 214, 100, "#B48EF0")], edges: [{ from: "gw", to: "fn" }, { from: "fn", to: "dy" }, { from: "fn", to: "q" }] } },
  { id: "rag", name: tk("RAG / LLM app"), cat: "Architecture", title: "RAG / LLM app", spec: { kind: "architecture", nodes: [N("docs", "Docs", "file", 10, 30), N("emb", "Embed", "embedding", 112, 30), N("vdb", "Vector DB", "vector-db", 214, 30, "#5CC8C2"), N("user", "User", "owner", 10, 110), N("ret", "Retriever", "search", 112, 110), N("llm", "LLM", "llm", 214, 110, "#B48EF0")], edges: [{ from: "docs", to: "emb" }, { from: "emb", to: "vdb" }, { from: "user", to: "ret" }, { from: "ret", to: "llm" }, { from: "vdb", to: "llm" }] } },
  { id: "event-driven", name: tk("Event-driven microservices"), cat: "Architecture", title: "Event-driven microservices", spec: { kind: "architecture", nodes: [N("ord", "Orders", "service", 10, 70), N("bus", "Bus", "topic", 112, 70, "#B48EF0"), N("bil", "Billing", "service", 214, 20), N("shp", "Shipping", "service", 214, 70), N("eml", "Email", "email", 214, 120)], edges: [{ from: "ord", to: "bus", dashed: true }, { from: "bus", to: "bil", dashed: true }, { from: "bus", to: "shp", dashed: true }, { from: "bus", to: "eml", dashed: true }] } },
  { id: "ml", name: tk("ML training + serving"), cat: "Architecture", title: "ML training + serving", spec: { kind: "architecture", nodes: [N("data", "Data", "lake", 10, 40), N("feat", "Features", "feature-store", 112, 40), N("train", "Train", "gpu", 214, 40), N("reg", "Registry", "registry", 214, 110), N("serve", "Serve", "model", 112, 110, "#F2A93B"), N("mon", "Monitor", "monitoring", 10, 110)], edges: [{ from: "data", to: "feat" }, { from: "feat", to: "train" }, { from: "train", to: "reg" }, { from: "reg", to: "serve" }, { from: "serve", to: "mon" }] } },
  { id: "c4", name: tk("C4 starter"), cat: "Architecture", title: "C4 starter", spec: { kind: "c4", nodes: [N("c1", "Container", "container", 40, 60, undefined, 100), N("c2", "Container", "container", 170, 60, undefined, 100)], groups: [{ label: "System context › Container", x: 20, y: 20, w: 270, h: 130, col: "#7AA2F7", kind: "boundary" }], edges: [] } },
  { id: "erd", name: tk("ERD starter"), cat: "Architecture", title: "ERD starter", spec: { kind: "erd", nodes: [], edges: [] } },
  { id: "threat", name: tk("Threat model starter"), cat: "Architecture", title: "Threat model starter", spec: { kind: "threat-model", nodes: [N("br", "Browser", "browser", 16, 70, undefined, 90), N("api", "API", "service", 180, 70, undefined, 100)], groups: [{ label: "Trust boundary", x: 150, y: 20, w: 150, h: 130, col: "#EF6B6B", kind: "trust-boundary" }], edges: [{ from: "br", to: "api" }] } },
  { id: "url-short", name: tk("URL shortener · review mode"), cat: "Interview", caption: tk("Interview · labels hidden for recall"), title: "URL shortener", spec: { kind: "architecture", nodes: [N("u", "Client", "owner", 10, 70), N("lb", "Load balancer", "load-balancer", 112, 70), N("app", "App service", "service", 214, 40), N("cache", "Cache", "cache", 214, 100)], edges: [{ from: "u", to: "lb" }, { from: "lb", to: "app" }, { from: "lb", to: "cache" }] }, extra: { els: [] } },
  { id: "chat-feed", name: tk("Chat · Feed · Payments"), cat: "Interview", caption: tk("Interview · 3 more"), title: "System design interview", spec: { kind: "architecture", nodes: [N("chat", "Chat", "sms", 16, 30, undefined, 120), N("feed", "News feed", "stream", 16, 70, undefined, 120), N("pay", "Payments", "payment", 16, 110, undefined, 120)], edges: [] } },
];

// ERD + review-mode thumbnails differ from the generic box layout; the canvases still come from the specs above.
function erdCanvas(): ReturnType<typeof archCanvas> {
  const tbl = (id: string, name: string, x: number, cols: string[]) => ({ id, type: "text", text: `**${name}**\n${cols.join("\n")}`, x, y: 0, width: 300, height: 220, lumenNode: { kind: "entity", icon: "database", table: { name, columns: cols } } });
  return { nodes: [tbl("users", "users", 0, ["id PK", "email", "name"]), tbl("payments", "payments", 520, ["id PK", "user_id FK", "amount"])], edges: [{ id: "e0", fromNode: "users", toNode: "payments", fromSide: "right", toSide: "left", label: "1 : n", lumenEdge: { from: "one", to: "many" } }], lumenArch: { kind: "erd", direction: "right", dsl: "users {\n  id pk\n  email string\n}\npayments {\n  id pk\n  user_id fk\n  amount number\n}\nusers.id < payments.user_id", layout: "manual" } } as never;
}

const stageBox = (x: number, y: number, w: number, h: number, o: Partial<ThumbEl> = {}): ThumbEl => ({ x, y, w, h, ...o });
const STUDY: VisualTemplate[] = [
  { id: "cornell", name: tk("Cornell notes"), cat: "Study", caption: "", type: "whiteboard", title: "Cornell notes", build: cornell,
    els: [stageBox(10, 10, 290, 150, { bd: "1px solid var(--border)", r: "6px" }), stageBox(90, 10, 1, 110, { bg: "var(--border)" }), stageBox(10, 120, 290, 1, { bg: "var(--border)" }), stageBox(14, 16, 70, 16, { t: "Cues", fs: 10, c: "var(--muted)" }), stageBox(96, 16, 120, 16, { t: "Notes", fs: 10, c: "var(--muted)" }), stageBox(14, 126, 120, 16, { t: "Summary", fs: 10, c: "var(--muted)" })], lines: [] },
  { id: "kanban", name: tk("Kanban"), cat: "Study", caption: "", type: "whiteboard", title: "Kanban", build: kanban,
    els: [0, 1, 2].map((i) => stageBox(12 + i * 98, 12, 90, 146, { bg: "var(--surface)", bd: "1px solid var(--border)", r: "8px" })).concat([0, 1, 2].map((i) => stageBox(16 + i * 98, 18, 80, 16, { t: ["To learn", "Learning", "Mastered"][i], fs: 10, c: "var(--muted)" })), [stageBox(20, 44, 74, 26, { bg: "#fff3bf", r: "4px" }), stageBox(118, 44, 74, 26, { bg: "#d0ebff", r: "4px" }), stageBox(216, 44, 74, 26, { bg: "#d3f9d8", r: "4px" }), stageBox(20, 76, 74, 26, { bg: "#fff3bf", r: "4px" })]), lines: [] },
  { id: "timeline", name: tk("Timeline"), cat: "Study", caption: "", type: "whiteboard", title: "Timeline", build: timeline,
    els: [0, 1, 2, 3].map((i) => stageBox(30 + i * 75, 68, 12, 12, { bg: "var(--accent)", r: "50%" })), lines: [{ d: "M20 74 H290", c: "var(--muted)" }] },
  { id: "venn", name: tk("Venn (3)"), cat: "Study", caption: "", type: "whiteboard", title: "Venn diagram", build: venn,
    els: [stageBox(95, 14, 90, 90, { bd: "1.5px solid #E5534B", r: "50%" }), stageBox(135, 14, 90, 90, { bd: "1.5px solid #39C5CF", r: "50%" }), stageBox(115, 60, 90, 90, { bd: "1.5px solid #57AB5A", r: "50%" })], lines: [] },
];

const ARCH_T: VisualTemplate[] = ARCH.map((a) => {
  let { els, lines } = thumbOf(a.spec);
  if (a.id === "erd") {
    els = [stageBox(20, 30, 110, 110, { bg: "var(--surface)", bd: "1px solid var(--border)", r: "7px" }), stageBox(180, 30, 110, 110, { bg: "var(--surface)", bd: "1px solid var(--border)", r: "7px" }), stageBox(28, 36, 90, 18, { t: "users", fs: 11, fw: 600 }), stageBox(188, 36, 90, 18, { t: "payments", fs: 11, fw: 600 })];
    lines = [{ d: "M130 85 H180 M170 78 L180 85 L170 92 M140 78 V92", c: "var(--text)" }];
  }
  if (a.id === "c4") els.push(stageBox(26, 26, 200, 14, { t: "System context › Container", fs: 9.5, c: "var(--muted)" }));
  if (a.id === "threat") els.push(stageBox(156, 26, 120, 14, { t: "Trust boundary", fs: 9.5, c: "#EF6B6B" }));
  if (a.id === "url-short") els = els.map((e) => (e.t ? { ...e, t: "? ? ?" } : e));
  if (a.id === "chat-feed") els.push(stageBox(160, 70, 140, 30, { t: "Reveal labels ⌥R", fs: 10.5, c: "var(--muted)" }));
  return { id: a.id, name: a.name, cat: a.cat, caption: a.caption ?? "", type: "canvas", title: a.title, els, lines, build: () => { const c = a.id === "erd" ? erdCanvas() : archCanvas(a.spec); if (a.cat === "Interview" && c.lumenArch && typeof c.lumenArch === "object") (c.lumenArch as Record<string, unknown>).interview = true; return JSON.stringify(c, null, 2); } };
});

export const VISUAL_TEMPLATES: VisualTemplate[] = [...STUDY, ...ARCH_T];
export const templateById = (id: string) => VISUAL_TEMPLATES.find((t) => t.id === id);
/** The chip ids on the chooser's "From template" row map to these. */
export const CHIP_TEMPLATES: { id: string; g: string; l: string }[] = [
  { id: "cornell", g: "cornell", l: "Cornell notes" }, { id: "kanban", g: "kanban", l: "Kanban" }, { id: "timeline", g: "timeline", l: "Timeline" },
  { id: "venn", g: "venn", l: "Venn" }, { id: "mindmap", g: "mind-map", l: "Mind map" }, { id: "three-tier", g: "service", l: "3-tier app" },
];

/** Mind map = a Mermaid mindmap diagram file (the chooser's chip); kept here so the gallery and chip share one source. */
export const MINDMAP_SRC = "mindmap\n  root((Topic))\n    Idea A\n      Detail\n    Idea B\n    Idea C";
