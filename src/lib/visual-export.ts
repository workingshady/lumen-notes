// Vector export of whole visuals: a JSON Canvas board and the graph view, as standalone SVG (then PNG/JPEG/WebP via
// the shared Export dialog). Built from the data, not a screenshot: text stays text, Mermaid diagram cards embed their
// real rendered diagram, and the result is sharp at any scale.
import type { CanvasNode, JsonCanvas, Note } from "../../shared/types";
import { backgroundOf, buildSvg, fontFaces, type BuiltSvg, type DiagramExportPrefs } from "./diagram-export";
import { boardBackground, cardFrame, drawEdge, drawGroup, drawnHeight, groupPatterns, hiddenByCollapse, insetNode, Markers, type CanvasSvgOpts } from "./canvas-render";
import { pickMeta } from "./canvas-style";
import { t } from "./i18n";
import { parseDiagramText } from "./diagrams";

interface Palette { surface: string; surface2: string; border: string; text: string; muted: string; accent: string }
const LIGHT: Palette = { surface: "#ffffff", surface2: "#f4f2ee", border: "#d9d4ca", text: "#1f1d1a", muted: "#6b665d", accent: "#d97706" };
const DARK: Palette = { surface: "#23262d", surface2: "#2b2f37", border: "#3a3f49", text: "#e8e6e1", muted: "#9aa0aa", accent: "#f2a93b" };
/** Colours for an export: the app's current theme, or a fixed light / dark palette. */
export function paletteFor(theme: DiagramExportPrefs["theme"]): Palette {
  if (theme === "dark") return DARK;
  if (theme !== "app") return LIGHT;
  const css = getComputedStyle(document.documentElement);
  const v = (k: string, f: string) => css.getPropertyValue(k).trim() || f;
  return { surface: v("--surface", LIGHT.surface), surface2: v("--surface-2", LIGHT.surface2), border: v("--border", LIGHT.border), text: v("--text", LIGHT.text), muted: v("--muted", LIGHT.muted), accent: v("--accent", LIGHT.accent) };
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
const FONT = "Inter, 'IBM Plex Sans Arabic', system-ui, sans-serif";
let measurer: CanvasRenderingContext2D | null = null;
/** Wrap text to a pixel width using the real font metrics; at most `max` lines (last one ellipsised). */
function wrap(text: string, width: number, size: number, weight = 400, max = 99): string[] {
  if (max <= 0 || !text) return [];
  measurer ??= document.createElement("canvas").getContext("2d");
  const m = measurer!;
  m.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) { out.push(""); continue; }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (m.measureText(next).width <= width || !line) line = next;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  if (out.length > max) { const cut = out.slice(0, max); cut[max - 1] = cut[max - 1].replace(/.{0,2}$/, "…"); return cut; }
  return out;
}
const lines = (xs: string[], x: number, y: number, size: number, lh: number, fill: string, weight = 400) =>
  xs.map((t, i) => `<text x="${x}" y="${y + i * lh}" font-size="${size}" font-weight="${weight}" fill="${fill}" font-family="${FONT}">${esc(t)}</text>`).join("");
/** Plain text from Markdown for a card (no fences, link syntax, emphasis marks). */
const plain = (md: string) => md.replace(/^---[\s\S]*?---\s*/, "").replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^#+\s+/gm, "").replace(/[*_`>~]/g, "").replace(/\n{3,}/g, "\n\n").trim();

/** Mermaid source of a canvas card, if it is a diagram (text card with a fence, or a file card pointing at a .mermaid file). */
function diagramOf(n: CanvasNode, byTitle: Map<string, Note>): string | null {
  if (n.type === "text") return parseDiagramText(n.text)?.src ?? null;
  if (n.type === "file") { const f = byTitle.get(n.file.replace(/\.md$/i, "").split("/").pop()!.toLowerCase()); return f?.type === "diagram" ? f.body : null; }
  return null;
}

/** A whole canvas as a standalone SVG (cards, groups, arrows with labels, embedded diagrams). */
export async function canvasSvg(c: JsonCanvas, notes: Note[], p: DiagramExportPrefs, opts: CanvasSvgOpts = {}): Promise<BuiltSvg> {
  const P = paletteFor(p.theme);
  const all = c.nodes ?? [];
  if (!all.length) throw new Error(t("This canvas is empty."));
  // Canvas options (lib/canvas-style.ts): cards inside a collapsed group are not drawn, like on the board.
  const meta = pickMeta(c);
  const hidden = hiddenByCollapse(all);
  const nodes = all.filter((n) => !hidden.has(n.id));
  const styled = opts.cardStyle !== false;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byTitle = new Map(notes.filter((n) => !n.deleted).map((n) => [n.title.toLowerCase(), n]));
  const pad = Math.max(0, p.padding);
  const minX = Math.min(...nodes.map((n) => n.x)) - pad, minY = Math.min(...nodes.map((n) => n.y)) - pad;
  const W = Math.max(...nodes.map((n) => n.x + n.width)) - minX + pad, H = Math.max(...nodes.map((n) => n.y + drawnHeight(n))) - minY + pad;
  const parts: string[] = [];
  const texts: string[] = [];

  // groups first (behind everything)
  const gp = groupPatterns(nodes, P);
  for (const n of nodes.filter((x) => x.type === "group")) {
    const g = drawGroup(n, all, meta, P, opts, gp.id);
    parts.push(g.svg); texts.push(...g.text);
  }
  // edges
  const mk = new Markers();
  for (const e of c.edges ?? []) {
    const a = byId.get(e.fromNode), b = byId.get(e.toNode);
    if (!a || !b) continue;
    const r = drawEdge(e, a, b, meta, P, opts, mk);
    parts.push(r.svg); if (r.text) texts.push(r.text);
  }
  // cards
  for (const card of nodes.filter((x) => x.type !== "group")) {
    const frame = cardFrame(card, P, styled);
    parts.push(frame.svg);
    const n = styled ? insetNode(card) : card; // text stays inside diamonds, circles, cylinders…
    const Q = frame.solid ? { ...P, text: "#0F1115", muted: "#3A3D44" } : P;
    const inner = n.width - 28;
    const src = diagramOf(n, byTitle);
    if (src) {
      // header + the real diagram, fitted into the card
      const name = n.type === "file" ? n.file : parseDiagramText((n as Extract<CanvasNode, { type: "text" }>).text)?.name ?? "diagram.mermaid";
      parts.push(`<line x1="${n.x}" y1="${n.y + 30}" x2="${n.x + n.width}" y2="${n.y + 30}" stroke="${P.border}"/>${lines([name], n.x + 12, n.y + 20, 12, 16, Q.text, 500)}`);
      texts.push(name);
      try {
        const d = await buildSvg(src, { ...p, padding: 8, background: "transparent", embedFont: false });
        const inner = d.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
        const vb = /viewBox="([^"]+)"/.exec(d.svg)?.[1] ?? `0 0 ${d.width} ${d.height}`;
        parts.push(`<svg x="${n.x + 8}" y="${n.y + 36}" width="${n.width - 16}" height="${n.height - 44}" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`);
        texts.push((d.svg.match(/>([^<>]+)</g) ?? []).join(" "));
      } catch { parts.push(lines(["(diagram could not be rendered)"], n.x + 12, n.y + 56, 12, 16, Q.muted)); }
      continue;
    }
    if (n.type === "text") {
      const t = n.text.trim();
      const h = /^#{1,6}\s+(.+)$/m.exec(t.split("\n")[0] ?? "");
      let y = n.y + 28;
      if (h) { const tl = wrap(h[1], inner, 16, 650, Math.max(1, Math.min(2, Math.floor((n.height - 28 - 8) / 21) + 1))); parts.push(lines(tl, n.x + 14, y, 16, 21, Q.text, 650)); texts.push(h[1]); y += tl.length * 21 + 4; }
      const body = plain(h ? t.split("\n").slice(1).join("\n") : t);
      const maxLines = Math.max(0, Math.floor((n.y + n.height - y - 6) / 19) + 1);
      const bl = wrap(body, inner, 13.5, 400, maxLines);
      parts.push(lines(bl, n.x + 14, y, 13.5, 19, Q.text)); texts.push(bl.join(" "));
    } else if (n.type === "file") {
      const title = n.file.replace(/\.md$/i, "").split("/").pop()!;
      const note = byTitle.get(title.toLowerCase());
      parts.push(`<line x1="${n.x}" y1="${n.y + 30}" x2="${n.x + n.width}" y2="${n.y + 30}" stroke="${P.border}"/>${lines(["Note"], n.x + 12, n.y + 20, 11.5, 16, Q.muted)}`);
      // as many title lines as fit under the header (at least one, ellipsised)
      const tl = wrap(title, inner, 14.5, 650, Math.max(1, Math.min(2, Math.floor((n.height - 54 - 8) / 19) + 1)));
      parts.push(lines(tl, n.x + 14, n.y + 54, 14.5, 19, Q.text, 650));
      const ex = note ? plain(note.body).replace(/\s+/g, " ").slice(0, 600) : "";
      const top = n.y + 54 + tl.length * 19 + 4;
      const el = wrap(ex, inner, 12.5, 400, Math.max(0, Math.floor((n.y + n.height - top - 6) / 17) + 1));
      parts.push(lines(el, n.x + 14, top, 12.5, 17, Q.muted));
      texts.push(title, el.join(" "));
    } else if (n.type === "link") {
      const tl = wrap(n.url.replace(/^https?:\/\/(www\.)?/, ""), inner, 13, 500, 3);
      parts.push(lines(["Link"], n.x + 12, n.y + 22, 11.5, 16, Q.muted), lines(tl, n.x + 14, n.y + 44, 13, 18, P.accent, 500));
      texts.push(tl.join(" "));
    }
  }
  // Board background (colour + dots / grid / lines) behind everything, only when the export has an opaque background.
  const bgOn = backgroundOf(p) !== null;
  const board = bgOn ? boardBackground(meta, P, minX, minY, W, H) : { defs: "", svg: "" };
  const defs = `<defs>${mk.defs()}${gp.defs}${board.defs}</defs>`;
  return finish(board.svg + parts.join(""), defs, minX, minY, W, H, p, texts.join(" "));
}

/** The graph view (positions as laid out on screen) as a standalone SVG. */
export interface GraphNodeIn { x: number; y: number; r: number; color: string; label: string; showLabel: boolean }
export interface GraphLinkIn { a: { x: number; y: number }; b: { x: number; y: number }; tag?: boolean }
export async function graphSvg(nodes: GraphNodeIn[], links: GraphLinkIn[], p: DiagramExportPrefs): Promise<BuiltSvg> {
  if (!nodes.length) throw new Error(t("The graph is empty."));
  const P = paletteFor(p.theme);
  const pad = Math.max(0, p.padding) + 40;
  const minX = Math.min(...nodes.map((n) => n.x - n.r)) - pad, minY = Math.min(...nodes.map((n) => n.y - n.r)) - pad;
  const W = Math.max(...nodes.map((n) => n.x + n.r)) - minX + pad, H = Math.max(...nodes.map((n) => n.y + n.r + 18)) - minY + pad;
  const fade = links.length > 3000 ? 0.12 : links.length > 600 ? 0.22 : 0.4;
  const edges = `<g stroke="${P.muted}" stroke-width="1" fill="none">${links.map((l) => `<line x1="${l.a.x.toFixed(1)}" y1="${l.a.y.toFixed(1)}" x2="${l.b.x.toFixed(1)}" y2="${l.b.y.toFixed(1)}" stroke-opacity="${l.tag ? fade * 0.6 : fade}"/>`).join("")}</g>`;
  const dots = nodes.map((n) => `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}" fill="${n.color}"/>`).join("");
  const labels = nodes.filter((n) => n.showLabel && n.label).map((n) => `<text x="${n.x.toFixed(1)}" y="${(n.y + n.r + 13).toFixed(1)}" font-size="11.5" text-anchor="middle" fill="${P.text}" font-family="${FONT}">${esc(n.label.length > 32 ? n.label.slice(0, 31) + "…" : n.label)}</text>`).join("");
  return finish(edges + dots + labels, "", minX, minY, W, H, p, nodes.filter((n) => n.showLabel).map((n) => n.label).join(" "));
}

async function finish(body: string, defs: string, x: number, y: number, w: number, h: number, p: DiagramExportPrefs, text: string): Promise<BuiltSvg> {
  const bg = backgroundOf(p);
  const fonts = p.embedFont ? await fontFaces(text) : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${x} ${y} ${w} ${h}" width="${Math.round(w)}" height="${Math.round(h)}">${fonts ? `<style>${fonts}</style>` : ""}${defs}${bg ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}"/>` : ""}${body}</svg>`;
  return { svg, width: w, height: h };
}
