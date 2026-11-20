// Edge geometry for the board and a standalone SVG of an architecture diagram for the Export dialog.
import type { DiagramExportPrefs } from "./settings";
import type { BuiltSvg } from "./diagram-export";
import { GLYPHS } from "./glyphs";
import { displayOf, edgeSides, endsOf, groupColor, hiddenBy, isGroup, nodeColor, STATUS, EDGE_STYLE, type AEdge, type ANode, type ArchCanvas } from "./arch-model";
import { portAt, route, type Route } from "./arch-route";
import { routeKey } from "./arch-layout";

/** Endpoints of an edge on the board: hidden ends (inside a collapsed group) attach to that group. */
export function edgeRoute(c: ArchCanvas, e: AEdge, by: Map<string, ANode>): (Route & { from: string; to: string }) | null {
  const fromId = hiddenBy(c, e.fromNode) ?? e.fromNode, toId = hiddenBy(c, e.toNode) ?? e.toNode;
  if (fromId === toId) return null;
  const a = by.get(fromId), b = by.get(toId);
  if (!a || !b) return null;
  const auto = edgeSides(a, b);
  const fs = fromId === e.fromNode && e.fromSide ? e.fromSide : auto[0];
  const ts = toId === e.toNode && e.toSide ? e.toSide : auto[1];
  const le = e.lumenEdge;
  const pts = le?.points && le.pointsKey && fromId === e.fromNode && toId === e.toNode && le.pointsKey === routeKey(c, e.fromNode, e.toNode) ? le.points : undefined;
  const ends = endsOf(e);
  return { ...route(portAt(a, fs), fs, portAt(b, ts), ts, le?.shape ?? "orthogonal", { start: ends === "both", end: ends !== "none" }, pts), from: fromId, to: toId };
}

const PAL = {
  dark: { bg: "#0f1115", sf: "#161a21", sf2: "#1d222b", bd: "#2a303b", tx: "#e8e6e1", mu: "#9aa0aa", ok: "#6bcb8b", wa: "#e8b34a", da: "#ef6b6b", le: "#b48ef0", ln: "#5cc8c2" },
  light: { bg: "#ffffff", sf: "#ffffff", sf2: "#f2efe7", bd: "#e4dfd3", tx: "#1f1d1a", mu: "#6a655c", ok: "#1f8a4c", wa: "#a86a00", da: "#c42b2b", le: "#7a4bd1", ln: "#0f7c78" },
};
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const glyph = (name: string, x: number, y: number, size: number, color: string) => {
  const parts = GLYPHS[name] ?? [];
  const k = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${k})" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${parts.map((p) => typeof p === "string" ? `<path d="${p}"/>` : `<path d="${p.d}"${p.fill ? ` fill="${color}" stroke="none"` : ""}/>`).join("")}</g>`;
};

export async function archSvg(c: ArchCanvas, p: DiagramExportPrefs): Promise<BuiltSvg> {
  const dark = p.theme === "dark" || (p.theme === "app" && matchMedia?.("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "paper");
  const P = dark ? PAL.dark : PAL.light;
  const vars = (s: string) => s.replace(/var\(--text\)/g, P.tx).replace(/var\(--learn\)/g, P.le).replace(/var\(--link\)/g, P.ln).replace(/var\(--warning\)/g, P.wa).replace(/var\(--muted\)/g, P.mu).replace(/var\(--success\)/g, P.ok).replace(/var\(--danger\)/g, P.da);
  const shown = c.nodes.filter((n) => !hiddenBy(c, n.id));
  if (!shown.length) throw new Error("This diagram is empty.");
  const by = new Map(c.nodes.map((n) => [n.id, n]));
  const pad = p.padding ?? 32;
  const x0 = Math.min(...shown.map((n) => n.x)) - pad, y0 = Math.min(...shown.map((n) => n.y)) - pad - 12;
  const x1 = Math.max(...shown.map((n) => n.x + n.width)) + pad, y1 = Math.max(...shown.map((n) => n.y + n.height)) + pad + 12;
  const W = x1 - x0, H = y1 - y0;
  const out: string[] = [];
  const { backgroundOf } = await import("./diagram-export");
  const bg = backgroundOf(p);
  if (bg) out.push(`<rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="${bg}"/>`);
  for (const g of shown.filter(isGroup).filter((g) => !g.lumenGroup?.collapsed)) {
    const col = groupColor(g);
    out.push(`<rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" rx="14" fill="${col}" fill-opacity=".05" stroke="${col}" stroke-width="1.5" stroke-dasharray="6 4"/>`);
    const label = displayOf(g), sub = g.lumenGroup?.sub ? `${g.lumenGroup?.kind ?? ""} · ${g.lumenGroup.sub}` : g.lumenGroup?.kind ?? "";
    const w = 30 + (label.length + sub.length) * 6.6;
    out.push(`<rect x="${g.x + 12}" y="${g.y - 10}" width="${w}" height="20" rx="10" fill="${P.bg}"/>`, glyph(g.lumenGroup?.icon ?? g.lumenGroup?.kind ?? "region", g.x + 19, g.y - 7, 14, col),
      `<text x="${g.x + 37}" y="${g.y + 4}" font-family="Inter, sans-serif" font-size="11.5" font-weight="600" fill="${col}">${xml(label)} <tspan font-weight="400" fill="${P.mu}">${xml(sub)}</tspan></text>`);
  }
  for (const e of c.edges) {
    const r = edgeRoute(c, e, by);
    if (!r) continue;
    const [col, dash] = EDGE_STYLE[e.lumenEdge?.style ?? "sync"];
    const cc = vars(col);
    out.push(`<path d="${r.d}" fill="none" stroke="${cc}" stroke-width="1.6" stroke-linejoin="round"${dash !== "none" ? ` stroke-dasharray="${dash}"` : ""}/>`, ...r.heads.map((h) => `<path d="${h}" fill="${cc}"/>`));
    if (e.label) { const w = e.label.length * 6.4 + 10; out.push(`<rect x="${r.mid.x - w / 2}" y="${r.mid.y - 8}" width="${w}" height="16" rx="4" fill="${P.bg}"/><text x="${r.mid.x}" y="${r.mid.y + 3.5}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10.5" font-weight="500" fill="${P.mu}">${xml(e.label)}</text>`); }
  }
  for (const n of shown.filter((x) => !isGroup(x) || x.lumenGroup?.collapsed)) {
    const col = isGroup(n) ? groupColor(n) : nodeColor(n);
    out.push(`<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="10" fill="${P.sf}" stroke="${isGroup(n) ? col : P.bd}"${isGroup(n) ? ' stroke-dasharray="6 4"' : ""}/>`);
    out.push(`<rect x="${n.x + 10}" y="${n.y + 15}" width="30" height="30" rx="8" fill="${col}" fill-opacity=".16"/>`, glyph(isGroup(n) ? (n.lumenGroup?.kind ?? "region") : (n.lumenNode?.icon ?? "service"), n.x + 16, n.y + 21, 18, col));
    const tech = n.lumenNode?.tech;
    out.push(`<text x="${n.x + 48}" y="${n.y + (tech ? 27 : 34)}" font-family="Inter, sans-serif" font-size="13" font-weight="600" fill="${P.tx}">${xml(displayOf(n))}</text>`);
    if (tech) out.push(`<text x="${n.x + 48}" y="${n.y + 42}" font-family="Inter, sans-serif" font-size="10.5" fill="${P.mu}">${xml(tech)}</text>`);
    const st = n.lumenNode?.status;
    if (st) out.push(glyph(STATUS[st][0], n.x + n.width - 20, n.y + 6, 14, vars(STATUS[st][1])));
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${x0} ${y0} ${W} ${H}">${out.join("")}</svg>`;
  return { svg, width: W, height: H };
}
