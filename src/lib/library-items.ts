// Shared library (design 36A–C, 49A–F, §3 + §11.3): ONE catalogue for every workspace.
// Each item knows how to become an Excalidraw skeleton (whiteboard / board) and/or a JSON Canvas node with `lumenNode`
// (canvas / architecture studio). Drag payload on DataTransfer: application/x-lumen+json {type:"library-item", id}.
import { useSyncExternalStore } from "react";
import { tk } from "./i18n";
import { GLYPHS, hasGlyph } from "./glyphs";
import { sk, type Skeleton } from "./whiteboard";
import { kindOfIcon, type ANode } from "./arch-model";

export type Workspace = "whiteboard" | "board" | "canvas" | "architecture";
export type LibTab = "drawing" | "stamps" | "icons" | "architecture";
export const TAB_LABEL: Record<LibTab, string> = { drawing: tk("Drawing"), stamps: tk("Stamps"), icons: tk("Icons"), architecture: tk("Architecture") };
export const DND_TYPE = "application/x-lumen+json";
export interface LibDragPayload { type: "library-item"; id: string }

export interface LibItem {
  id: string; name: string; glyph: string; tab: LibTab;
  /** Excalidraw skeletons, centred on (cx, cy). */
  skeleton?: (cx: number, cy: number) => Skeleton[];
  /** Architecture group kind (region, vpc…): becomes a group node. */
  group?: string;
  /** Stamp / icon: a Lumen glyph drawn as an image, recolourable. */
  glyphName?: string; color?: string;
  /** Vendor pack icon (unmodified SVG text). */
  vendorSvg?: string; vendorPack?: string;
}

// ------------------------------------------------------------------ geometry helpers
type Pt = [number, number];
const INK = "#1e1e1e";
const base = { strokeColor: INK, backgroundColor: "transparent", fillStyle: "solid", roughness: 0 };
/** Closed (or open) polygon from unit coordinates inside a w×h box centred on (cx, cy). */
function poly(cx: number, cy: number, w: number, h: number, pts: Pt[], o: Record<string, unknown> = {}, closed = true): Skeleton {
  const abs = pts.map(([u, v]) => [cx - w / 2 + u * w, cy - h / 2 + v * h] as Pt);
  const [x0, y0] = abs[0];
  const rel = abs.map(([x, y]) => [x - x0, y - y0] as Pt);
  if (closed) rel.push([0, 0]);
  const xs = rel.map((p) => p[0]), ys = rel.map((p) => p[1]);
  return { type: "line", x: x0, y: y0, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), points: rel, ...(closed ? { polygon: true } : {}), ...base, ...o } as Skeleton;
}
const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 14): Pt[] => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * (i / n); return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as Pt; });
const box = (cx: number, cy: number, w: number, h: number, type: "rectangle" | "ellipse" | "diamond", o: Record<string, unknown> = {}): Skeleton => ({ type, x: cx - w / 2, y: cy - h / 2, width: w, height: h, ...base, ...o } as Skeleton);
const line = (x: number, y: number, dx: number, dy: number, o: Record<string, unknown> = {}): Skeleton => ({ type: "line", x, y, width: Math.abs(dx), height: Math.abs(dy), points: [[0, 0], [dx, dy]], ...base, ...o } as Skeleton);
const label = (cx: number, cy: number, text: string, o: Record<string, unknown> = {}): Skeleton => ({ type: "text", x: cx, y: cy, text, fontSize: 16, strokeColor: INK, ...o } as Skeleton);
const W = 160, H = 100;
const single = (f: (cx: number, cy: number) => Skeleton) => (cx: number, cy: number) => [f(cx, cy)];

const STAR: Pt[] = Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.2 : 0.5; return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a) * 1] as Pt; });
const HEART: Pt[] = (() => { const p: Pt[] = []; for (let i = 0; i < 40; i++) { const t = (i / 40) * Math.PI * 2; p.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]); } return p.map(([x, y]) => [(x + 17) / 34, (y + 17) / 30] as Pt); })();
const CLOUD: Pt[] = Array.from({ length: 48 }, (_, i) => { const a = (i / 48) * Math.PI * 2, r = 0.42 + 0.08 * Math.abs(Math.cos(3 * a)); return [0.5 + r * 1.1 * Math.cos(a), 0.5 + r * 0.8 * Math.sin(a)] as Pt; });
const stadium: Pt[] = [...arc(0.2, 0.5, 0.2, 0.5, Math.PI / 2, (3 * Math.PI) / 2, 10).map(([x, y]) => [x, y] as Pt), ...arc(0.8, 0.5, 0.2, 0.5, -Math.PI / 2, Math.PI / 2, 10)];
const cylinderBody: Pt[] = [[0, 0.12], ...arc(0.5, 0.12, 0.5, 0.12, Math.PI, 0, 14).slice(1), [1, 0.88], ...arc(0.5, 0.88, 0.5, 0.12, 0, Math.PI, 14).slice(1)];
const docPath: Pt[] = [[0, 0], [1, 0], [1, 0.85], ...Array.from({ length: 12 }, (_, i) => [1 - (i + 1) / 12, 0.85 + 0.1 * Math.sin(((i + 1) / 12) * Math.PI * 2)] as Pt)];
const dShape: Pt[] = [[0, 0], [0.6, 0], ...arc(0.6, 0.5, 0.4, 0.5, -Math.PI / 2, Math.PI / 2, 12).slice(1), [0, 1]];
const bubble: Pt[] = [[0, 0], [1, 0], [1, 0.75], [0.5, 0.75], [0.25, 1], [0.3, 0.75], [0, 0.75]];

const DRAW: LibItem[] = [
  // basic
  { id: "draw:rect", name: tk("Rectangle"), glyph: "rect", tab: "drawing", skeleton: single((x, y) => box(x, y, W, H, "rectangle", { roundness: null })) },
  { id: "draw:rounded-rect", name: tk("Rounded"), glyph: "rounded-rect", tab: "drawing", skeleton: single((x, y) => box(x, y, W, H, "rectangle", { roundness: { type: 3 } })) },
  { id: "draw:ellipse", name: tk("Ellipse"), glyph: "ellipse", tab: "drawing", skeleton: single((x, y) => box(x, y, W, H, "ellipse")) },
  { id: "draw:diamond", name: tk("Diamond"), glyph: "decision", tab: "drawing", skeleton: single((x, y) => box(x, y, W, 120, "diamond")) },
  { id: "draw:triangle", name: tk("Triangle"), glyph: "triangle", tab: "drawing", skeleton: single((x, y) => poly(x, y, W, H, [[0.5, 0], [1, 1], [0, 1]])) },
  { id: "draw:hexagon", name: tk("Hexagon"), glyph: "hexagon", tab: "drawing", skeleton: single((x, y) => poly(x, y, W, H, [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]])) },
  { id: "draw:star", name: tk("Star"), glyph: "star", tab: "drawing", skeleton: single((x, y) => poly(x, y, 120, 116, STAR)) },
  { id: "draw:parallelogram", name: tk("Parallel."), glyph: "parallelogram", tab: "drawing", skeleton: single((x, y) => poly(x, y, W, H, [[0.2, 0], [1, 0], [0.8, 1], [0, 1]])) },
  { id: "draw:trapezoid", name: tk("Trapezoid"), glyph: "trapezoid", tab: "drawing", skeleton: single((x, y) => poly(x, y, W, H, [[0.2, 0], [0.8, 0], [1, 1], [0, 1]])) },
  { id: "draw:cylinder", name: tk("Cylinder"), glyph: "cylinder", tab: "drawing", skeleton: (x, y) => [poly(x, y, 110, 130, cylinderBody), box(x, y - 65 + 15.6, 110, 31.2, "ellipse")] },
  { id: "draw:cloud", name: tk("Cloud"), glyph: "cloud", tab: "drawing", skeleton: single((x, y) => poly(x, y, 180, 110, CLOUD)) },
  { id: "draw:heart", name: tk("Heart"), glyph: "heart", tab: "drawing", skeleton: single((x, y) => poly(x, y, 110, 100, HEART)) },
  { id: "draw:speech-bubble", name: tk("Speech"), glyph: "speech-bubble", tab: "drawing", skeleton: single((x, y) => poly(x, y, 170, 120, bubble)) },
  { id: "draw:callout", name: tk("Callout"), glyph: "callout", tab: "drawing", skeleton: (x, y) => [box(x, y - 20, 170, 70, "rectangle", { roundness: { type: 3 } }), line(x - 55, y + 15, -35, 45)] },
  // flowchart
  { id: "draw:process", name: tk("Process"), glyph: "process", tab: "drawing", skeleton: single((x, y) => box(x, y, W, 80, "rectangle", { roundness: null })) },
  { id: "draw:decision", name: tk("Decision"), glyph: "decision", tab: "drawing", skeleton: single((x, y) => box(x, y, 150, 110, "diamond")) },
  { id: "draw:terminator", name: tk("Terminator"), glyph: "terminator", tab: "drawing", skeleton: single((x, y) => poly(x, y, W, 64, stadium)) },
  { id: "draw:data", name: tk("Data"), glyph: "data", tab: "drawing", skeleton: single((x, y) => poly(x, y, W, 80, [[0.2, 0], [1, 0], [0.8, 1], [0, 1]])) },
  { id: "draw:document", name: tk("Document"), glyph: "document", tab: "drawing", skeleton: single((x, y) => poly(x, y, W, 90, docPath.map(([u, v]) => [u, v / 0.95] as Pt).concat([[0, 0.85]]))) },
  { id: "draw:multi-document", name: tk("Multi-doc"), glyph: "multi-document", tab: "drawing", skeleton: (x, y) => [poly(x + 12, y - 12, 130, 80, [[0, 0], [1, 0], [1, 1], [0, 1]]), poly(x + 6, y - 6, 130, 80, [[0, 0], [1, 0], [1, 1], [0, 1]]), poly(x - 6, y + 6, 130, 80, docPath.map(([u, v]) => [u, v / 0.95] as Pt).concat([[0, 0.85]]), { backgroundColor: "#ffffff" })] },
  { id: "draw:database", name: tk("Database"), glyph: "database", tab: "drawing", skeleton: (x, y) => [poly(x, y, 110, 130, cylinderBody), box(x, y - 65 + 15.6, 110, 31.2, "ellipse")] },
  { id: "draw:manual-input", name: tk("Manual"), glyph: "manual-input", tab: "drawing", skeleton: single((x, y) => poly(x, y, W, 80, [[0, 0.25], [1, 0], [1, 1], [0, 1]])) },
  { id: "draw:delay", name: tk("Delay"), glyph: "delay", tab: "drawing", skeleton: single((x, y) => poly(x, y, W, 80, dShape)) },
  { id: "draw:preparation", name: tk("Preparation"), glyph: "hexagon", tab: "drawing", skeleton: single((x, y) => poly(x, y, W, 80, [[0.15, 0], [0.85, 0], [1, 0.5], [0.85, 1], [0.15, 1], [0, 0.5]])) },
  { id: "draw:connector", name: tk("Connector"), glyph: "ellipse", tab: "drawing", skeleton: single((x, y) => box(x, y, 56, 56, "ellipse")) },
  // UML
  { id: "draw:uml-class", name: tk("Class"), glyph: "uml-class", tab: "drawing", skeleton: (x, y) => [box(x, y, 170, 120, "rectangle", { roundness: null }), line(x - 85, y - 20, 170, 0), line(x - 85, y + 20, 170, 0), label(x - 70, y - 50, "ClassName", { fontSize: 16 }), label(x - 70, y - 14, "attribute: Type", { fontSize: 14 }), label(x - 70, y + 26, "method()", { fontSize: 14 })] },
  { id: "draw:actor", name: tk("Actor"), glyph: "actor", tab: "drawing", skeleton: (x, y) => [box(x, y - 44, 28, 28, "ellipse"), line(x, y - 30, 0, 44), line(x - 24, y - 16, 48, 0), line(x, y + 14, -22, 36), line(x, y + 14, 22, 36)] },
  { id: "draw:package", name: tk("Package"), glyph: "package", tab: "drawing", skeleton: (x, y) => [box(x - 30, y - 56, 80, 24, "rectangle", { roundness: null }), box(x, y, 170, 100, "rectangle", { roundness: null })] },
  // mind map
  { id: "draw:mind-map", name: tk("Mind map"), glyph: "mind-map", tab: "drawing", skeleton: (x, y) => [
    box(x, y, 130, 64, "ellipse", { backgroundColor: "#d0ebff" }), label(x - 28, y - 10, "Topic", { fontSize: 20 }),
    ...[[-1, -1], [1, -1], [0, 1.2]].flatMap(([dx, dy], i) => { const bx = x + dx * 190, by = y + dy * 100; return [line(x + dx * 55, y + dy * 24, dx * 80, dy * 40), box(bx, by, 110, 44, "rectangle", { roundness: { type: 3 } }), label(bx - 30, by - 10, ["Idea A", "Idea B", "Idea C"][i], { fontSize: 16 })]; }),
  ] },
  // containers
  { id: "draw:frame", name: tk("Frame"), glyph: "frame", tab: "drawing", skeleton: single((x, y) => ({ type: "frame", x: x - 200, y: y - 140, width: 400, height: 280, name: "Frame", children: [] } as unknown as Skeleton)) },
  { id: "draw:section", name: tk("Section"), glyph: "section", tab: "drawing", skeleton: (x, y) => [box(x, y, 360, 240, "rectangle", { roundness: { type: 3 }, strokeStyle: "dashed", opacity: 80 }), label(x - 170, y - 114, "Section", { fontSize: 18 })] },
  { id: "draw:sticky", name: tk("Sticky"), glyph: "sticky", tab: "drawing", skeleton: single((x, y) => sk.sticky(x - 100, y - 80, "", Math.floor(Math.random() * 6))) },
  // math & study
  { id: "draw:axes", name: tk("Axes"), glyph: "axes", tab: "drawing", skeleton: (x, y) => [line(x - 90, y + 80, 0, -170, { endArrowhead: "arrow", type: "arrow" }), line(x - 90, y + 80, 190, 0, { endArrowhead: "arrow", type: "arrow" }), label(x + 88, y + 86, "x"), label(x - 104, y - 112, "y")] },
  { id: "draw:venn", name: tk("Venn"), glyph: "venn", tab: "drawing", skeleton: (x, y) => [box(x - 45, y, 130, 130, "ellipse", { backgroundColor: "#a5d8ff", opacity: 60 }), box(x + 45, y, 130, 130, "ellipse", { backgroundColor: "#ffc9c9", opacity: 60 })] },
  { id: "draw:number-line", name: tk("Number line"), glyph: "number-line", tab: "drawing", skeleton: (x, y) => [line(x - 150, y, 300, 0, { type: "arrow", endArrowhead: "arrow", startArrowhead: "arrow" }), ...[-100, -50, 0, 50, 100].flatMap((d, i) => [line(x + d * 1.4, y - 8, 0, 16), label(x + d * 1.4 - 6, y + 14, String(i - 2), { fontSize: 14 })])] },
  { id: "draw:timeline", name: tk("Timeline"), glyph: "timeline", tab: "drawing", skeleton: (x, y) => [line(x - 180, y, 360, 0, { type: "arrow", endArrowhead: "arrow" }), ...[-120, 0, 120].flatMap((d, i) => [box(x + d, y, 12, 12, "ellipse", { backgroundColor: INK }), label(x + d - 24, i % 2 ? y - 40 : y + 22, ["Start", "Middle", "End"][i], { fontSize: 16 })])] },
  { id: "draw:cornell", name: tk("Cornell notes"), glyph: "cornell", tab: "drawing", skeleton: (x, y) => [box(x, y, 420, 300, "rectangle", { roundness: null }), line(x - 210 + 120, y - 150, 0, 220), line(x - 210, y + 70, 420, 0), label(x - 200, y - 140, "Cues", { fontSize: 16 }), label(x - 80, y - 140, "Notes", { fontSize: 16 }), label(x - 200, y + 78, "Summary", { fontSize: 16 })] },
  { id: "draw:table", name: tk("Table"), glyph: "table", tab: "drawing", skeleton: (x, y) => [box(x, y, 300, 150, "rectangle", { roundness: null }), line(x - 50, y - 75, 0, 150), line(x + 50, y - 75, 0, 150), line(x - 150, y - 25, 300, 0), line(x - 150, y + 25, 300, 0)] },
];

/** Drawing categories (design 36A): basic, flowchart, UML, mind map, containers, math & study templates. */
export interface LibCat { id: string; name: string; glyph: string; tab: LibTab; ids: string[] }
const draw = (...n: string[]) => n.map((x) => "draw:" + x);
export const CATS: LibCat[] = [
  { id: "basic", name: tk("Basic"), glyph: "shape-library", tab: "drawing", ids: draw("rect", "rounded-rect", "ellipse", "diamond", "triangle", "hexagon", "star", "parallelogram", "trapezoid", "cylinder", "cloud", "heart", "speech-bubble", "callout") },
  { id: "flowchart", name: tk("Flowchart"), glyph: "process", tab: "drawing", ids: draw("process", "decision", "terminator", "data", "document", "multi-document", "database", "manual-input", "delay", "preparation", "connector") },
  { id: "uml", name: tk("UML"), glyph: "uml-class", tab: "drawing", ids: draw("uml-class", "actor", "package") },
  { id: "mindmap", name: tk("Mind map"), glyph: "mind-map", tab: "drawing", ids: draw("mind-map") },
  { id: "containers", name: tk("Containers"), glyph: "frame", tab: "drawing", ids: draw("frame", "section", "sticky") },
  { id: "study", name: tk("Math & study templates"), glyph: "axes", tab: "drawing", ids: draw("axes", "venn", "number-line", "timeline", "cornell", "table") },
  // architecture (generic glyph-style icons, 47C)
  { id: "generic", name: tk("Generic"), glyph: "shape-square", tab: "architecture", ids: ["service", "text", "c-note", "image", "note-card", "diagram", "owner", "external-system", "browser", "mobile", "junction", "process"].map((x) => "arch:" + x) },
  { id: "compute", name: tk("Compute"), glyph: "service", tab: "architecture", ids: ["service", "server", "function", "container", "pod", "worker", "scheduler", "desktop"].map((x) => "arch:" + x) },
  { id: "data", name: tk("Data"), glyph: "database", tab: "architecture", ids: ["database", "cache", "bucket", "warehouse", "lake", "vector-db", "redis", "read-replica", "search", "file", "logs", "metrics"].map((x) => "arch:" + x) },
  { id: "network", name: tk("Network"), glyph: "cdn", tab: "architecture", ids: ["gateway", "load-balancer", "cdn", "dns", "api", "firewall", "internet", "on-prem", "webhook"].map((x) => "arch:" + x) },
  { id: "messaging", name: tk("Messaging"), glyph: "queue", tab: "architecture", ids: ["queue", "topic", "stream", "email", "sms"].map((x) => "arch:" + x) },
  { id: "aiml", name: tk("AI / ML"), glyph: "model", tab: "architecture", ids: ["model", "gpu", "llm", "embedding", "notebook", "registry", "feature-store", "etl", "monitoring"].map((x) => "arch:" + x) },
  { id: "security", name: tk("Security"), glyph: "lock-shield", tab: "architecture", ids: ["key", "lock-shield", "vault", "identity", "alert", "firewall", "trust-boundary"].map((x) => "arch:" + x) },
  { id: "clients", name: tk("Clients"), glyph: "browser", tab: "architecture", ids: ["browser", "mobile", "desktop", "user", "team"].map((x) => "arch:" + x) },
  { id: "k8s", name: tk("Kubernetes"), glyph: "pod", tab: "architecture", ids: ["pod", "container", "cluster", "namespace", "registry", "ci"].map((x) => "arch:" + x) },
  { id: "saas", name: tk("SaaS"), glyph: "payment", tab: "architecture", ids: ["payment", "email", "sms", "search", "repo", "ci", "webhook", "external-system", "redis"].map((x) => "arch:" + x) },
  { id: "boundaries", name: tk("Boundaries"), glyph: "region", tab: "architecture", ids: ["region", "vpc", "subnet", "zone", "cluster", "namespace", "account", "team", "trust-boundary"].map((x) => "grp:" + x) },
];
export const CAT_NAMES = new Set(["Basic", "Flowchart", "UML", "Mind map", "Containers", "Math & study templates", "Generic", "Compute", "Data", "Network", "Messaging", "AI / ML", "Security", "Clients", "Kubernetes", "SaaS", "Boundaries"]);

const ARCH_LABEL: Record<string, string> = { "c-note": "Note", "note-card": "Note card", diagram: "Diagram card", owner: "User / actor", "external-system": "External", browser: "Web client", mobile: "Mobile client", "load-balancer": "Load balancer", "vector-db": "Vector DB", "lock-shield": "Shield", "feature-store": "Feature store", "on-prem": "On-prem", "trust-boundary": "Trust", ci: "CI", llm: "LLM", cdn: "CDN", dns: "DNS", sms: "SMS", api: "API", gpu: "GPU" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ");
const GROUP_COLORS: Record<string, string> = { region: "#E8893A", vpc: "#7AA2F7", subnet: "#57AB5A", zone: "#39C5CF", cluster: "#A371F7", namespace: "#E3B341", account: "#9AA0AA", team: "#F25C9A", "trust-boundary": "#EF6B6B" };

/** Products that share a generic glyph. */
const ARCH_ALIAS: Record<string, [glyph: string, name: string]> = { redis: ["cache", "Redis"], "read-replica": ["database", "Read replica"] };
const ARCH: LibItem[] = [];
const seen = new Set<string>();
for (const c of CATS) if (c.tab === "architecture") for (const id of c.ids) {
  if (seen.has(id)) continue; seen.add(id);
  const n = id.slice(id.indexOf(":") + 1);
  ARCH.push(id.startsWith("grp:") ? { id, name: ARCH_LABEL[n] ?? cap(n), glyph: n, tab: "architecture", group: n, color: GROUP_COLORS[n] } : ARCH_ALIAS[n] ? { id, name: ARCH_ALIAS[n][1], glyph: ARCH_ALIAS[n][0], tab: "architecture", glyphName: ARCH_ALIAS[n][0] } : { id, name: ARCH_LABEL[n] ?? cap(n), glyph: n, tab: "architecture", glyphName: n });
}

// ------------------------------------------------------------------ stamps and icons (36G)
export const STAMPS: [id: string, glyph: string, name: string, color: string][] = [
  ["check", "stamp-check", tk("Check"), "#6BCB8B"], ["cross", "stamp-cross", tk("Cross"), "#EF6B6B"], ["question", "stamp-question", tk("Question"), "#7AA2F7"], ["important", "stamp-important", tk("Important"), "#EF6B6B"],
  ["idea", "stamp-idea", tk("Idea"), "#E3B341"], ["star", "stamp-star", tk("Star"), "#E3B341"], ["warning", "stamp-warning", tk("Warning"), "#E8893A"], ["flag", "stamp-flag", tk("Flag"), "#EF6B6B"],
  ["heart", "stamp-heart", tk("Heart"), "#F25C9A"], ["pin", "stamp-pin", tk("Pin"), "#9AA0AA"], ["pointer", "select", tk("Pointer"), "var(--tx)"], ["see-note", "note-card", tk("See note"), "#5CC8C2"],
];
const STAMP_ITEMS: LibItem[] = [
  ...STAMPS.map(([id, glyph, name, color]) => ({ id: "stamp:" + id, name, glyph, tab: "stamps" as const, glyphName: glyph, color })),
  ...Array.from({ length: 9 }, (_, i) => ({ id: "stamp:number-" + (i + 1), name: String(i + 1), glyph: "number-" + (i + 1), tab: "stamps" as const, glyphName: "number-" + (i + 1), color: "#7AA2F7" })),
];
/** Icon insert offers the whole glyph set. */
export const ICON_GROUPS: [string, string, string[]][] = [
  ["all", tk("All"), []],
  ["study", tk("Study"), ["lesson", "flashcards", "course", "book", "math", "flask", "globe", "neural", "language", "music", "health", "clock", "c-tip", "c-question", "s-mastered", "cloze", "graph", "timeline", "axes", "venn", "mind-map", "owl", "flame", "pin"]],
  ["tools", tk("Tools"), ["search", "gear", "link", "code", "export", "import", "highlight", "layers", "frame", "palette", "sticky", "text", "image", "table", "calendar", "template"]],
  ["architecture", tk("Architecture"), ["service", "server", "database", "queue", "cache", "bucket", "function", "container", "pod", "gateway", "cdn", "api", "owner", "browser", "mobile", "model", "llm", "vault", "key", "region", "vpc", "subnet"]],
  ["status", tk("Status"), ["status-planned", "status-building", "status-live", "status-deprecated", "stamp-check", "stamp-cross", "stamp-warning", "stamp-important", "c-warning", "c-tip", "s-mastered", "alert"]],
];
export const ALL_GLYPHS: string[] = Object.keys(GLYPHS).sort();
export const ICON_COLORS = ["var(--tx)", "#EF6B6B", "#F2A93B", "#6BCB8B", "#5CC8C2", "#7AA2F7", "#B48EF0", "#9AA0AA"];

const ALL: LibItem[] = [...DRAW, ...ARCH, ...STAMP_ITEMS];
const BY_ID = new Map(ALL.map((i) => [i.id, i]));
export const LIBRARY_ITEMS = ALL;
/** Resolve any library id, including `icon:<glyph>` and vendor items (`vendor:<pack>:<name>`). */
export function getLibraryItem(id: string): LibItem | undefined {
  const hit = BY_ID.get(id);
  if (hit) return hit;
  if (id.startsWith("icon:")) { const g = id.slice(5); return hasGlyph(g) ? { id, name: cap(g), glyph: g, tab: "icons", glyphName: g, color: "#E8E6E1" } : undefined; }
  if (id.startsWith("vendor:")) { const [, pack, ...rest] = id.split(":"); const f = getVendorPack(pack)?.find((x) => x.name === rest.join(":")); return f ? { id, name: f.name, glyph: "cloud", tab: "architecture", vendorSvg: f.svg, vendorPack: pack } : undefined; }
  return undefined;
}
export const drawingItems = () => DRAW;
export const itemsOf = (cat: LibCat): LibItem[] => cat.ids.map((i) => BY_ID.get(i)).filter(Boolean) as LibItem[];

/** Search across every tab: shapes, stamps, icons (whole glyph set) and vendor icons. */
export function searchLibrary(q: string, limit = 60): LibItem[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const hit = (i: LibItem) => i.name.toLowerCase().includes(s) || i.glyph.includes(s);
  const out: LibItem[] = ALL.filter(hit);
  const seenIds = new Set(out.map((i) => i.id));
  for (const g of ALL_GLYPHS) if (g.includes(s) && out.length < limit && !seenIds.has("icon:" + g) && !ARCH.some((a) => a.glyph === g) && !STAMP_ITEMS.some((a) => a.glyph === g)) out.push(getLibraryItem("icon:" + g)!);
  if (getLibPrefs().vendor) for (const p of VENDOR_PACKS) for (const v of getVendorPack(p.id) ?? []) if (v.name.toLowerCase().includes(s)) out.push(getLibraryItem(`vendor:${p.id}:${v.name}`)!);
  return out.slice(0, limit);
}

// ------------------------------------------------------------------ glyph → SVG file (stamps, icons: recolourable, editable)
const cssColor = (c: string) => (c.startsWith("var(") ? (getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#E8E6E1") : c);
export function glyphSvgText(name: string, color: string, size = 96): string {
  const def = GLYPHS[name] ?? GLYPHS.note ?? [];
  const col = cssColor(color);
  const paths = def.map((p) => {
    const d = typeof p === "string" ? p : p.d;
    const fill = typeof p !== "string" && p.fill ? col : "none";
    const stroke = typeof p === "string" ? col : p.stroke ? (p.stroke === "currentColor" ? col : p.stroke) : (p.fill ? "none" : col);
    return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${paths}</svg>`;
}
export const svgDataUrl = (svg: string) => "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
const fid = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);

// ------------------------------------------------------------------ placing
export interface WbLike {
  getAppState: () => Record<string, unknown>; getSceneElementsIncludingDeleted: () => readonly Record<string, unknown>[];
  updateScene: (s: { elements?: readonly unknown[]; appState?: Record<string, unknown> }) => void; addFiles: (f: unknown[]) => void; setActiveTool: (t: { type: string }) => void;
}
/** Centre of the visible board in scene coordinates. */
export function viewCentre(api: WbLike): { x: number; y: number } {
  const st = api.getAppState() as { zoom?: { value: number }; scrollX?: number; scrollY?: number; width?: number; height?: number };
  const z = st.zoom?.value ?? 1;
  return { x: (st.width ?? 800) / 2 / z - (st.scrollX ?? 0), y: (st.height ?? 600) / 2.2 / z - (st.scrollY ?? 0) };
}
let nudgeN = 0, nudgeT = 0;
const nudge = () => { const now = Date.now(); nudgeN = now - nudgeT < 2500 ? nudgeN + 1 : 0; nudgeT = now; return (nudgeN % 8) * 22; };

export interface PlaceOpts { at?: { x: number; y: number }; color?: string; link?: string; text?: string }
/** Put a library item on an Excalidraw board (whiteboard / board). Returns the new element ids. */
export async function placeOnBoard(api: WbLike, item: LibItem, opts: PlaceOpts = {}): Promise<string[]> {
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  const c = opts.at ?? viewCentre(api);
  const off = opts.at ? 0 : nudge();
  const x = c.x + off, y = c.y + off;
  let skel: Skeleton[] = [];
  const files: unknown[] = [];
  if (item.skeleton) skel = item.skeleton(x, y);
  else if (item.vendorSvg || item.glyphName || item.group) {
    const id = fid();
    const svg = item.vendorSvg ?? glyphSvgText(item.glyphName ?? item.glyph, opts.color ?? item.color ?? "#E8E6E1");
    files.push({ id, mimeType: "image/svg+xml", dataURL: svgDataUrl(svg), created: Date.now() });
    const sz = item.vendorSvg ? 80 : item.tab === "stamps" ? 64 : 72;
    skel = [{ type: "image", fileId: id, status: "saved", x: x - sz / 2, y: y - sz / 2, width: sz, height: sz, ...(opts.link ? { link: opts.link } : {}),
      customData: item.vendorSvg ? { lumenVendor: item.vendorPack } : { lumenGlyph: { name: item.glyphName ?? item.glyph, color: opts.color ?? item.color ?? "#E8E6E1" }, ...(item.id.startsWith("stamp:") ? { lumenStamp: item.id.slice(6) } : {}) } } as unknown as Skeleton];
  }
  if (!skel.length) return [];
  if (files.length) api.addFiles(files);
  const els = convertToExcalidrawElements(skel as never, { regenerateIds: true }) as unknown as { id: string }[];
  const ids = Object.fromEntries(els.map((e) => [e.id, true]));
  api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...els], appState: { selectedElementIds: ids } });
  api.setActiveTool({ type: "selection" });
  return els.map((e) => e.id);
}

/** Recolour the selected stamps / icons (their SVG is regenerated; the glyph name stays in customData so they stay editable). */
export function recolourSelectedGlyphs(api: WbLike, color: string): number {
  const sel = (api.getAppState() as { selectedElementIds?: Record<string, boolean> }).selectedElementIds ?? {};
  let n = 0;
  const files: unknown[] = [];
  const next = api.getSceneElementsIncludingDeleted().map((e) => {
    const g = (e.customData as { lumenGlyph?: { name: string; color: string } } | undefined)?.lumenGlyph;
    if (!sel[e.id as string] || !g) return e;
    n++;
    const id = fid();
    files.push({ id, mimeType: "image/svg+xml", dataURL: svgDataUrl(glyphSvgText(g.name, color)), created: Date.now() });
    return { ...e, fileId: id, version: ((e.version as number) ?? 1) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), customData: { ...(e.customData as object), lumenGlyph: { name: g.name, color } } };
  });
  if (n) { api.addFiles(files); api.updateScene({ elements: next }); }
  return n;
}
/** Selected glyph stamps/icons (for the Insert-icon popover state). */
export function selectedGlyphColor(api: WbLike): string | null {
  const sel = (api.getAppState() as { selectedElementIds?: Record<string, boolean> }).selectedElementIds ?? {};
  for (const e of api.getSceneElementsIncludingDeleted()) { const g = (e.customData as { lumenGlyph?: { color: string } } | undefined)?.lumenGlyph; if (sel[e.id as string] && g) return g.color; }
  return null;
}

/** JSON Canvas node for the architecture studio / canvas (lumenNode / lumenGroup), centred on `at`. Mirrors ArchStudio.addShape. */
export function canvasNodeFor(item: LibItem, at: { x: number; y: number }, id: string, name?: string): ANode {
  const nm = name ?? item.name;
  if (item.group) return { id, type: "group", x: at.x - 150, y: at.y - 100, width: 300, height: 200, label: nm, lumenGroup: { kind: item.group, name: nm } } as ANode;
  if (item.vendorSvg) return { id, type: "text", text: nm, x: at.x - 75, y: at.y - 30, width: 150, height: 60, lumenNode: { name: nm, kind: "service", tags: [`vendor:${item.vendorPack}`], icon: "service" }, lumenVendorSvg: item.vendorSvg } as unknown as ANode;
  const icon = item.glyphName ?? (item.tab === "drawing" ? ({ process: "process", decision: "decision", terminator: "terminator", actor: "actor", "uml-class": "uml-class", database: "database", cylinder: "database", rect: "service" } as Record<string, string>)[item.id.slice(5)] : undefined);
  if (!icon) return { id, type: "text", text: nm, x: at.x - 75, y: at.y - 30, width: 150, height: 60 } as ANode;
  const n = { id, type: "text", text: nm, x: at.x - 75, y: at.y - 30, width: 150, height: 60, lumenNode: { name: nm, icon, kind: kindOfIcon(icon) } } as ANode;
  if (icon === "junction") Object.assign(n, { width: 12, height: 12, x: at.x - 6, y: at.y - 6 });
  return n;
}

// ------------------------------------------------------------------ drag payload
export function setLibraryDrag(e: { dataTransfer: DataTransfer | null }, id: string) {
  const dt = e.dataTransfer;
  if (!dt) return;
  dt.setData(DND_TYPE, JSON.stringify({ type: "library-item", id } satisfies LibDragPayload));
  dt.setData("text/plain", id);
  dt.effectAllowed = "copy";
}
export function readLibraryDrag(dt: DataTransfer | null): LibItem | undefined {
  try { const p = JSON.parse(dt?.getData(DND_TYPE) ?? "") as LibDragPayload; return p?.type === "library-item" ? getLibraryItem(p.id) : undefined; } catch { return undefined; }
}

// ------------------------------------------------------------------ preferences (recent, favourites, order, vendor packs)
export interface LibPrefs {
  recent: string[]; favs: string[]; vendor: boolean; /** The shapes split button remembers the last shape. */ lastShape: string;
  /** Category order per tab (ids from CATS); categories missing here keep the default order after these. */
  catOrder: string[]; hidden: string[];
  /** Which tab opens first per workspace. */
  firstTab: Record<Workspace, LibTab>;
  /** Numbered stamps: next number. */
  nextNumber: number; iconColor: string; tab: Partial<Record<Workspace, LibTab>>;
}
export const DEFAULT_FIRST: Record<Workspace, LibTab> = { whiteboard: "drawing", board: "drawing", canvas: "architecture", architecture: "architecture" };
const KEY = "lumen.library";
const DEF: LibPrefs = { recent: ["draw:rounded-rect", "draw:decision", "draw:sticky", "draw:cylinder", "arch:service", "arch:database", "arch:queue"], favs: [], vendor: false, lastShape: "draw:rect", catOrder: [], hidden: [], firstTab: DEFAULT_FIRST, nextNumber: 1, iconColor: "#5CC8C2", tab: {} };
let cur: LibPrefs = (() => { try { const p = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<LibPrefs>; return { ...DEF, ...p, firstTab: { ...DEFAULT_FIRST, ...p.firstTab } }; } catch { return DEF; } })();
const subs = new Set<() => void>();
export const getLibPrefs = () => cur;
export const useLibPrefs = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => cur);
export function setLibPrefs(p: Partial<LibPrefs>) {
  cur = { ...cur, ...p };
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* private mode */ }
  subs.forEach((f) => f());
}
export const touchRecent = (id: string) => setLibPrefs({ recent: [id, ...cur.recent.filter((x) => x !== id)].slice(0, 14), ...(id.startsWith("draw:") ? { lastShape: id } : {}) });
export const toggleFav = (id: string) => setLibPrefs({ favs: cur.favs.includes(id) ? cur.favs.filter((x) => x !== id) : [...cur.favs, id] });
/** Categories of a tab in the user's order. */
export function orderedCats(tab: LibTab): LibCat[] {
  const all = CATS.filter((c) => c.tab === tab);
  const rank = (c: LibCat) => { const i = cur.catOrder.indexOf(c.id); return i < 0 ? 1000 + all.indexOf(c) : i; };
  return [...all].sort((a, b) => rank(a) - rank(b));
}
/** Tabs in this workspace's order: its first tab, then the rest (every category is reachable from every workspace). */
export function tabsFor(ws: Workspace): LibTab[] {
  const first = cur.firstTab[ws] ?? DEFAULT_FIRST[ws];
  const rest: LibTab[] = ws === "whiteboard" || ws === "board" ? ["drawing", "stamps", "icons", "architecture"] : ["architecture", "drawing", "stamps", "icons"];
  return [first, ...rest.filter((x) => x !== first)];
}

// ------------------------------------------------------------------ vendor packs (shown exactly as published: never recoloured or edited)
export const VENDOR_PACKS: { id: string; name: string }[] = [{ id: "aws", name: "AWS Architecture Icons" }, { id: "azure", name: "Azure icons" }, { id: "gcp", name: "Google Cloud icons" }];
const vkey = (p: string) => "lumen.library.vendor." + p;
export interface VendorIcon { name: string; svg: string }
export function getVendorPack(pack: string): VendorIcon[] | undefined {
  try { const v = JSON.parse(localStorage.getItem(vkey(pack)) ?? "null") as VendorIcon[] | null; return v?.length ? v : undefined; } catch { return undefined; }
}
/** Store the SVG files the owner picked for a pack, byte for byte. Returns how many were kept (localStorage budget ~3 MB per pack). */
export function saveVendorPack(pack: string, icons: VendorIcon[]): number {
  const keep: VendorIcon[] = []; let size = 0;
  for (const i of icons) { size += i.svg.length; if (size > 3_000_000) break; keep.push(i); }
  try { localStorage.setItem(vkey(pack), JSON.stringify(keep)); } catch { return 0; }
  subs.forEach((f) => f());
  return keep.length;
}
export function clearVendorPack(pack: string) { try { localStorage.removeItem(vkey(pack)); } catch { /* ignore */ } subs.forEach((f) => f()); }
export const vendorItems = (): LibItem[] => VENDOR_PACKS.flatMap((p) => (getVendorPack(p.id) ?? []).map((v) => getLibraryItem(`vendor:${p.id}:${v.name}`)!));
