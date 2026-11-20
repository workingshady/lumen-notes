// Vector export of whole visuals: a JSON Canvas board and the graph view, as standalone SVG (then PNG/JPEG/WebP via
// the shared Export dialog). Built from the data, not a screenshot: text stays text, Mermaid diagram cards embed their
// real rendered diagram, and the result is sharp at any scale.
import type { CanvasNode, JsonCanvas, Note } from "../../shared/types";
import { backgroundOf, buildSvg, fontFaces, type BuiltSvg, type DiagramExportPrefs } from "./diagram-export";
import { boardBackground, cardFrame, drawEdge, drawGroup, drawnHeight, groupPatterns, hiddenByCollapse, insetNode, Markers, type CanvasSvgOpts } from "./canvas-render";
import { pickMeta } from "./canvas-style";
import { t } from "./i18n";
import { parseDiagramText } from "./diagrams";
import { plainExcerpt } from "../components/nav-text";
import { GLYPHS } from "./glyphs";
import { unfurl } from "./api";

/** One glyph as SVG paths (24 px grid, scaled to `size`). */
const glyphSvg = (name: string, x: number, y: number, size: number, color: string) => `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${(GLYPHS[name] ?? []).map((p) => (typeof p === "string" ? `<path d="${p}"/>` : `<path d="${p.d}"${p.fill ? ` fill="${color}" stroke="none"` : ""}/>`)).join("")}</g>`;
const STATUS_FILL: Record<string, string> = { seed: "#9AA0AA", growing: "#E3B341", evergreen: "#57AB5A", draft: "#9AA0AA", review: "#E3B341", done: "#57AB5A" };
// ------------------------------------------------------------------ maths as SVG text
// A <foreignObject> with KaTeX taints the canvas (PNG / PDF can't encode it), so maths is drawn as real text: TeX turned
// into Unicode maths and set in a maths font, letters italic like KaTeX.
const TEX_SYM: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  partial: "∂", nabla: "∇", cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", sim: "∼", equiv: "≡", propto: "∝", infty: "∞",
  sum: "∑", prod: "∏", int: "∫", to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftarrow: "⇐", leftrightarrow: "↔", mapsto: "↦", in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", cup: "∪", cap: "∩", forall: "∀", exists: "∃",
  ldots: "…", cdots: "⋯", dots: "…", top: "⊤", log: "log", ln: "ln", exp: "exp", max: "max", min: "min", sin: "sin", cos: "cos", tan: "tan", lim: "lim", quad: "  ", qquad: "    ", ",": " ", ";": " ", "!": "", " ": " ",
};
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", T: "ᵀ", t: "ᵗ", k: "ᵏ", "⊤": "ᵀ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", i: "ᵢ", j: "ⱼ", k: "ₖ", n: "ₙ", t: "ₜ", x: "ₓ", a: "ₐ", e: "ₑ", o: "ₒ", r: "ᵣ", m: "ₘ", l: "ₗ", s: "ₛ", p: "ₚ" };
const scriptOf = (s: string, map: Record<string, string>, mark: string) => ([...s].every((ch) => map[ch]) ? [...s].map((ch) => map[ch]).join("") : `${mark}${s.length > 1 ? `(${s})` : s}`);
/** Inline TeX → Unicode maths (fractions as a/b, scripts as super / subscript characters where Unicode has them). */
export function texUnicode(tex: string): string {
  let s = tex.replace(/\\(left|right|big|Big|bigg|Bigg)\b/g, "").replace(/\\(mathrm|mathbf|mathit|text|operatorname|mathcal|boldsymbol)\{([^{}]*)\}/g, "$2");
  for (let i = 0; i < 4; i++) s = s.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a: string, b: string) => `${a.length > 1 && /[+-]/.test(a) ? `(${a})` : a}/${b.length > 1 && /[+-]/.test(b) ? `(${b})` : b}`);
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, "√($1)");
  s = s.replace(/\\([a-zA-Z]+|[,;! ])/g, (_m, c: string) => TEX_SYM[c] ?? c);
  s = s.replace(/\^\{([^{}]*)\}|\^(\S)/g, (_m, a?: string, b?: string) => scriptOf(a ?? b ?? "", SUP, "^")).replace(/_\{([^{}]*)\}|_(\S)/g, (_m, a?: string, b?: string) => scriptOf(a ?? b ?? "", SUB, "_"));
  return s.replace(/[{}]/g, "").replace(/\s*=\s*/g, " = ").replace(/\s+/g, " ").trim();
}
/** Marks around maths runs inside wrapped text (zero width when measured). */
const M0 = "\u0001", M1 = "\u0002";
const MATH_FONT = "'Cambria Math','STIX Two Math','Latin Modern Math','Times New Roman',serif";
/** Wrapped lines that may hold maths runs (M0…M1) as <tspan>s; a run can continue onto the next line. */
function mathLines(xs: string[], x: number, y: number, size: number, lh: number, fill: string): string {
  let inMath = false;
  return xs.map((line, i) => {
    const spans: string[] = [];
    for (const part of line.split(/([\u0001\u0002])/)) {
      if (part === M0) { inMath = true; continue; }
      if (part === M1) { inMath = false; continue; }
      if (part) spans.push(inMath ? `<tspan font-family="${MATH_FONT}" font-style="italic" font-size="${size * 1.08}">${esc(part)}</tspan>` : `<tspan>${esc(part)}</tspan>`);
    }
    return `<text x="${x}" y="${y + i * lh}" font-size="${size}" fill="${fill}" font-family="${FONT}" xml:space="preserve">${spans.join("")}</text>`;
  }).join("");
}
/** Card body with TeX: $$…$$ and $…$ converted and marked as maths runs, then the usual Markdown clean-up. */
const mathPlain = (md: string) => plain(md.replace(/\$\$([\s\S]+?)\$\$/g, (_m, m: string) => `\n${M0}${texUnicode(m)}${M1}\n`).replace(/\$([^$\n]+)\$/g, (_m, m: string) => `${M0}${texUnicode(m)}${M1}`));

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
const LINK = "#5CC8C2";
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
      const rawBody = (h ? t.split("\n").slice(1).join("\n") : t).trim();
      // "As on screen": maths renders as maths (Unicode in a maths font), not raw LaTeX
      const hasMath = styled && /\$[^$\n]+\$|\$\$[\s\S]+?\$\$/.test(rawBody);
      const body = hasMath ? mathPlain(rawBody) : plain(rawBody);
      const maxLines = Math.max(0, Math.floor((n.y + n.height - y - 6) / 19) + 1);
      const bl = wrap(body, inner, 13.5, 400, maxLines);
      parts.push(hasMath ? mathLines(bl, n.x + 14, y, 13.5, 19, Q.text) : lines(bl, n.x + 14, y, 13.5, 19, Q.text)); texts.push(bl.join(" ").replace(/[\u0001\u0002]/g, ""));
    } else if (n.type === "file") {
      const title = n.file.replace(/\.md$/i, "").split("/").pop()!;
      const note = byTitle.get(title.toLowerCase());
      // header like the board: file glyph, where the note lives, status dot
      const where = (note && opts.folderOf?.(note)) || n.file.split("/").slice(-2, -1)[0] || t("Note");
      const dot = note?.status ? STATUS_FILL[note.status] ?? "#7AA2F7" : note ? "#7AA2F7" : P.border;
      parts.push(`<line x1="${n.x}" y1="${n.y + 30}" x2="${n.x + n.width}" y2="${n.y + 30}" stroke="${P.border}"/>`, glyphSvg("file", n.x + 10, n.y + 9, 12, Q.muted),
        lines(wrap(where, n.width - 50, 11.5, 400, 1), n.x + 27, n.y + 19.5, 11.5, 16, Q.muted), `<circle cx="${n.x + n.width - 13}" cy="${n.y + 15}" r="3.5" fill="${dot}"/>`);
      texts.push(where);
      // as many title lines as fit under the header (at least one, ellipsised)
      const tl = wrap(title, inner, 14.5, 650, Math.max(1, Math.min(2, Math.floor((n.height - 54 - 8) / 19) + 1)));
      parts.push(lines(tl, n.x + 14, n.y + 54, 14.5, 19, Q.text, 650));
      const ex = note ? plainExcerpt(note.body, 600) : "";
      const top = n.y + 54 + tl.length * 19 + 4;
      const el = wrap(ex, inner, 12.5, 400, Math.max(0, Math.floor((n.y + n.height - top - 6) / 17) + 1));
      parts.push(lines(el, n.x + 14, top, 12.5, 17, Q.muted));
      texts.push(title, el.join(" "));
    } else if (n.type === "link") {
      // like the board: initials badge, page title (link preview), URL with a link glyph
      let host = n.url;
      try { host = new URL(n.url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
      const meta = await Promise.race([unfurl(n.url), new Promise<null>((r) => setTimeout(() => r(null), 1500))]).catch(() => null);
      const cy = n.y + n.height / 2, bx = n.x + 12, tx = bx + 52, tw = n.width - 64 - 12;
      const title = wrap(meta?.title || host, tw, 14, 600, 1), url = wrap(n.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), tw - 16, 12, 400, 1);
      parts.push(`<rect x="${bx}" y="${cy - 20}" width="40" height="40" rx="8" fill="#8C1515"/>`, `<text x="${bx + 20}" y="${cy + 4.5}" font-size="13" font-weight="700" fill="#ffffff" text-anchor="middle" font-family="${FONT}">${esc(host.split(".")[0].slice(0, 2).toUpperCase())}</text>`,
        lines(title, tx, cy - 3, 14, 18, Q.text, 600), glyphSvg("link", tx, cy + 6, 12, LINK), lines(url, tx + 16, cy + 16, 12, 16, LINK));
      texts.push(title.join(" "), url.join(" "));
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
