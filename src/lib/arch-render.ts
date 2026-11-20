// Edge geometry for the board and a standalone SVG of an architecture diagram for the Export dialog.
import type { DiagramExportPrefs } from "./settings";
import type { BuiltSvg } from "./diagram-export";
import { GLYPHS } from "./glyphs";
import { vendorIconUrl } from "./vendor-icons";
import { displayOf, edgeSides, endsOf, groupColor, hiddenBy, isGroup, nodeColor, SEQ_ROW, SEQ_TOP, seqLife, STATUS, EDGE_STYLE, type AEdge, type ANode, type ArchCanvas } from "./arch-model";
import { avoidPath, crossings, portAt, route, snapRoute, type Pt, type Route } from "./arch-route";
import type { Side } from "../../shared/types";
import { routeKey } from "./arch-layout";
import { chipOf, labelLook, labelSpots, lblStyle } from "./arch-label";

/** Endpoints of an edge on the board: hidden ends (inside a collapsed group) attach to that group. */
export interface RouteSrc { p: Pt; ps: Side; q: Pt; qs: Side; shape: "orthogonal" | "straight" | "curved"; ends: { start: boolean; end: boolean } }
export function edgeRoute(c: ArchCanvas, e: AEdge, by: Map<string, ANode>): (Route & { from: string; to: string; fs: Side; ts: Side; src: RouteSrc }) | null {
  const fromId = hiddenBy(c, e.fromNode) ?? e.fromNode, toId = hiddenBy(c, e.toNode) ?? e.toNode;
  if (fromId === toId) return null;
  const a = by.get(fromId), b = by.get(toId);
  if (!a || !b) return null;
  const le = e.lumenEdge;
  if (c.lumenArch.kind === "sequence" && !isGroup(a) && !isGroup(b)) {
    // a message: a horizontal arrow between the two lifelines, one row per message in code order
    const k = c.edges.findIndex((x) => x.id === e.id), top = Math.max(...c.nodes.filter((n) => !isGroup(n)).map((n) => n.y + n.height));
    const y = top + SEQ_TOP + Math.max(0, k) * SEQ_ROW, ax = a.x + a.width / 2, bx = b.x + b.width / 2;
    const fs: Side = ax <= bx ? "right" : "left", ts: Side = ax <= bx ? "left" : "right", ends = endsOf(e);
    const src: RouteSrc = { p: { x: ax, y }, ps: fs, q: { x: bx, y }, qs: ts, shape: "straight", ends: { start: ends === "both", end: ends !== "none" } };
    return { ...route(src.p, fs, src.q, ts, "straight", src.ends, [src.p, src.q]), from: fromId, to: toId, fs, ts, src };
  }
  const auto = edgeSides(a, b);
  const manual = !!le?.manual && !!le.points && fromId === e.fromNode && toId === e.toNode;
  const stored = !manual && le?.points && le.points.length >= 2 && le.pointsKey && fromId === e.fromNode && toId === e.toNode && le.pointsKey === routeKey(c, e.fromNode, e.toNode) ? snapRoute(le.points, a, b) : null;
  const pts = manual ? le!.points : stored?.pts;
  // a stored full route (auto layout) ends on the centre port of the sides it touches, so the line meets the handles
  const fs = stored ? stored.fs : fromId === e.fromNode && e.fromSide ? e.fromSide : auto[0];
  const ts = stored ? stored.ts : toId === e.toNode && e.toSide ? e.toSide : auto[1];
  const ends = endsOf(e);
  const src: RouteSrc = { p: portAt(a, fs), ps: fs, q: portAt(b, ts), qs: ts, shape: le?.shape ?? "orthogonal", ends: { start: ends === "both", end: ends !== "none" } };
  const r = route(src.p, fs, src.q, ts, src.shape, src.ends, pts, manual);
  // an automatic elbow route never runs through another node: route around the boxes (and pick better ports unless pinned)
  if (!pts && src.shape === "orthogonal") {
    const obs = c.nodes.filter((n) => n.id !== fromId && n.id !== toId && (!isGroup(n) || n.lumenGroup?.collapsed) && !hiddenBy(c, n.id));
    if (crossings(r.pts, obs)) {
      const pinA = fromId === e.fromNode && !!e.fromSide, pinB = toId === e.toNode && !!e.toSide;
      const SIDES: Side[] = ["right", "left", "bottom", "top"];
      let best: { pts: Pt[]; cost: number; fs: Side; ts: Side } | null = null;
      for (const s1 of pinA ? [fs] : SIDES) for (const s2 of pinB ? [ts] : SIDES) {
        const hit = avoidPath(portAt(a, s1), s1, portAt(b, s2), s2, obs);
        // the auto sides win ties (keeps the look stable while dragging)
        if (hit && (!best || hit.cost + (s1 === fs && s2 === ts ? -1 : 0) < best.cost)) best = { ...hit, fs: s1, ts: s2 };
      }
      if (best) {
        const s2: RouteSrc = { ...src, p: portAt(a, best.fs), ps: best.fs, q: portAt(b, best.ts), qs: best.ts };
        return { ...route(s2.p, best.fs, s2.q, best.ts, "orthogonal", src.ends, best.pts), from: fromId, to: toId, fs: best.fs, ts: best.ts, src: s2 };
      }
    }
  }
  return { ...r, from: fromId, to: toId, fs, ts, src };
}

const PAL = {
  dark: { bg: "#0f1115", sf: "#161a21", sf2: "#1d222b", bd: "#2a303b", tx: "#e8e6e1", mu: "#9aa0aa", ok: "#6bcb8b", wa: "#e8b34a", da: "#ef6b6b", le: "#b48ef0", ln: "#5cc8c2" },
  light: { bg: "#ffffff", sf: "#ffffff", sf2: "#f2efe7", bd: "#e4dfd3", tx: "#1f1d1a", mu: "#6a655c", ok: "#1f8a4c", wa: "#a86a00", da: "#c42b2b", le: "#7a4bd1", ln: "#0f7c78" },
};
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const glyph = (name: string, x: number, y: number, size: number, color: string) => {
  if (name.startsWith("vendor:")) { const u = vendorIconUrl(name); return u ? `<image href="${u}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>` : ""; }
  const parts = GLYPHS[name] ?? [];
  const k = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${k})" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${parts.map((p) => typeof p === "string" ? `<path d="${p}"/>` : `<path d="${p.d}"${p.fill ? ` fill="${color}" stroke="none"` : ""}/>`).join("")}</g>`;
};

export async function archSvg(c: ArchCanvas, p: DiagramExportPrefs, look: { groupLabels?: boolean; edgeLabels?: boolean } = {}): Promise<BuiltSvg> {
  const dark = p.theme === "dark" || (p.theme === "app" && matchMedia?.("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "paper");
  const P = dark ? PAL.dark : PAL.light;
  const vars = (s: string) => s.replace(/var\(--text\)/g, P.tx).replace(/var\(--learn\)/g, P.le).replace(/var\(--link\)/g, P.ln).replace(/var\(--warning\)/g, P.wa).replace(/var\(--muted\)/g, P.mu).replace(/var\(--success\)/g, P.ok).replace(/var\(--danger\)/g, P.da);
  const shown = c.nodes.filter((n) => !hiddenBy(c, n.id));
  if (!shown.length) throw new Error("This diagram is empty.");
  const by = new Map(c.nodes.map((n) => [n.id, n]));
  const pad = p.padding ?? 32;
  const x0 = Math.min(...shown.map((n) => n.x)) - pad, y0 = Math.min(...shown.map((n) => n.y)) - pad - 12;
  const seq = c.lumenArch.kind === "sequence", life = seq ? seqLife(c) : 0;
  const x1 = Math.max(...shown.map((n) => n.x + n.width)) + pad, y1 = Math.max(...shown.map((n) => n.y + n.height)) + life + pad + 12;
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
    if (look.groupLabels !== false) out.push(`<rect x="${g.x + 12}" y="${g.y - 10}" width="${w}" height="20" rx="10" fill="${P.bg}"/>`, glyph(g.lumenGroup?.icon ?? g.lumenGroup?.kind ?? "region", g.x + 19, g.y - 7, 14, col),
      `<text x="${g.x + 37}" y="${g.y + 4}" font-family="Inter, sans-serif" font-size="11.5" font-weight="600" fill="${col}">${xml(label)} <tspan font-weight="400" fill="${P.mu}">${xml(sub)}</tspan></text>`);
  }
  // sequence diagrams: a dashed lifeline under every participant
  if (seq) for (const n of shown.filter((x) => !isGroup(x))) out.push(`<line x1="${n.x + n.width / 2}" y1="${n.y + n.height}" x2="${n.x + n.width / 2}" y2="${n.y + n.height + life}" stroke="${P.mu}" stroke-opacity=".55" stroke-width="1.5" stroke-dasharray="5 4"/>`);
  for (const e of c.edges) {
    const r = edgeRoute(c, e, by);
    if (!r) continue;
    const [col, dash] = EDGE_STYLE[e.lumenEdge?.style ?? "sync"];
    const cc = vars(col);
    out.push(`<path d="${r.d}" fill="none" stroke="${cc}" stroke-width="1.6" stroke-linejoin="round"${dash !== "none" ? ` stroke-dasharray="${dash}"` : ""}/>`, ...r.heads.map((h) => `<path d="${h}" fill="${cc}"/>`));
    for (const sp of look.edgeLabels === false ? [] : labelSpots(e, r)) {
      const ls = lblStyle(e), look = labelLook(ls), chip = sp.part === "mid" ? chipOf(e) : "";
      const cw = chip ? chip.length * 5.6 + 14 : 0, tw = sp.text.length * look.fs * 0.61, w = tw + (sp.text ? 12 : 0) + (chip && sp.text ? 6 : 0) + cw, h = look.fs + 6;
      const bgc = vars(look.bg), bd = look.border.includes("transparent") ? "none" : P.bd;
      const tf = sp.angle ? ` transform="rotate(${sp.angle} ${sp.x} ${sp.y})"` : "";
      out.push(`<g${tf}><rect x="${sp.x - w / 2}" y="${sp.y - h / 2}" width="${w}" height="${h}" rx="${Math.min(look.radius, h / 2)}" fill="${bgc}"${bd !== "none" ? ` stroke="${bd}"` : ""}/>`
        + (sp.text ? `<text x="${sp.x - w / 2 + 6}" y="${sp.y + look.fs * 0.35}" font-family="JetBrains Mono, monospace" font-size="${look.fs}" font-weight="${look.fw}" fill="${vars(look.color)}">${xml(sp.text)}</text>` : "")
        + (chip ? `<rect x="${sp.x + w / 2 - cw - 3}" y="${sp.y - 7}" width="${cw}" height="14" rx="7" fill="${P.sf2}" stroke="${P.bd}"/><text x="${sp.x + w / 2 - cw / 2 - 3}" y="${sp.y + 3}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="9.5" fill="${P.mu}">${xml(chip)}</text>` : "") + "</g>");
    }
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
