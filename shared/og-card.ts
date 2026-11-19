// OG card template (design round 4, Lumen 21 › "OG image template · 1200×630"), shared by the Worker
// (worker/ext/og.ts serves it as SVG) and the app (src/lib/og.ts rasterizes it to the PNG that social sites need).
export type OgNote = { id: string; title: string; body: string; type: string; tags: string[]; createdAt: number; updatedAt: number; slug?: string; published?: number; props?: Record<string, string> };
export type OgSpace = { id: string; name: string; kind: string; description?: string; roadmapId?: string | null };
export interface OgCard { kicker: string; title: string; meta: string; description: string }

export const esc = (s: string) => s.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]!);
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const words = (md: string) => md.split(/\s+/).filter(Boolean).length;
const plain = (md: string) => md.replace(/^---[\s\S]*?---/, "").replace(/```[\s\S]*?```/g, "").replace(/\$\$[\s\S]*?\$\$/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "")
  .replace(/^#\s.*$/m, "")
  // slide separators, callout headers, task / list markers, task dates (calendar emoji + 2026-11-13, @due(…)): noise in a link preview
  .replace(/^\s*(---|\*\*\*)\s*$/gm, "").replace(/\[![\w-]+\][+-]?/g, "").replace(/^\s*[-*+]\s+\[[ xX/>?-]\]\s+/gm, "").replace(/^\s*([-*+]|\d+\.)\s+/gm, "")
  .replace(/\s*\p{Extended_Pictographic}\uFE0F?\s*\d{4}-\d{2}-\d{2}/gu, "").replace(/@due\(\d{4}-\d{2}-\d{2}\)/g, "")
  .replace(/[#>*_`\[\]!]|\(.*?\)/g, "").replace(/\s+/g, " ").trim();
const TYPE_LABEL: Record<string, string> = { path: "Learning path", roadmap: "Roadmap", slides: "Slides", canvas: "Canvas", whiteboard: "Whiteboard", flashcards: "Flashcards", lesson: "Lesson", post: "Post", base: "Base", dashboard: "Dashboard", diagram: "Diagram", moc: "Map of content", journal: "Journal" };

/** Greedy word wrap by estimated glyph width (serif bold ≈ 0.52 em; CJK/Arabic a bit wider). */
export function wrap(text: string, maxPx: number, fontPx: number, maxLines: number): string[] {
  const avg = fontPx * (RTL.test(text) ? 0.5 : 0.47);
  const per = Math.max(8, Math.floor(maxPx / avg));
  const out: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = line ? line + " " + w : w;
    if (next.length <= per) { line = next; continue; }
    if (line) out.push(line);
    line = w.length > per ? w.slice(0, per - 1) + "…" : w;
    if (out.length === maxLines) break;
  }
  if (line && out.length < maxLines) out.push(line);
  if (out.length === maxLines && out.join(" ").length < text.trim().length) out[maxLines - 1] = out[maxLines - 1].replace(/\s*\S*$/, "") + "…";
  return out.length ? out : [""];
}

/** Lumen mark, light tile (LumenMark tile="light"), 64-unit box. */
const MARK = (x: number, y: number, s: number) => `<g transform="translate(${x} ${y}) scale(${s / 64})">
<defs><linearGradient id="mc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D98A1E" stop-opacity=".22"/><stop offset="1" stop-color="#D98A1E" stop-opacity="0"/></linearGradient>
<radialGradient id="mg" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#D98A1E" stop-opacity=".28"/><stop offset="1" stop-color="#D98A1E" stop-opacity="0"/></radialGradient></defs>
<rect x=".5" y=".5" width="63" height="63" rx="16" fill="#FFFFFF" stroke="#E4DFD3"/><circle cx="32" cy="22" r="15" fill="url(#mg)"/><path d="M27 27 L37 27 L51 45 L13 45 Z" fill="url(#mc)"/>
<path d="M32 11.5 C35.6 15.6 38 18.9 38 22.4 A6 6 0 0 1 26 22.4 C26 18.9 28.4 15.6 32 11.5 Z" fill="#D98A1E"/><rect x="12" y="44" width="40" height="3.5" rx="1.75" fill="#1F1D1A"/></g>`;

/** The 1200×630 OG card as SVG (design shown at 600×315; every size here is ×2). */
export function ogSvg(card: OgCard): string {
  const rtl = RTL.test(card.title);
  const L = 80, R = 1200 - 80;
  const lines = wrap(card.title, R - L, 72, 3);
  const titleY = 194; // padding 72 · kicker line 30 · gap 28 · first baseline (design 97 at ½ scale)
  // SVG text-anchor follows the direction: with direction="rtl", "start" is the right edge (x = R)
  const tx = rtl ? R : L, anchor = "start";
  const title = lines.map((l, i) => `<text x="${tx}" y="${titleY + i * 84}" text-anchor="${anchor}" ${rtl ? 'direction="rtl"' : ""} font-family="'Source Serif 4', 'Source Serif Pro', Georgia, 'IBM Plex Sans Arabic', serif" font-size="72" font-weight="700" letter-spacing="-1.44" fill="#1F1D1A">${esc(l)}</text>`).join("");
  const metaY = titleY + (lines.length - 1) * 84 + 73;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#FAF8F3"/>
<text x="${L}" y="95" font-family="Inter, 'IBM Plex Sans Arabic', system-ui, sans-serif" font-size="24" font-weight="600" letter-spacing="1.44" fill="#6A655C">${esc(card.kicker.toUpperCase())}</text>
${title}
<text x="${L}" y="${metaY}" font-family="Inter, system-ui, sans-serif" font-size="26" fill="#6A655C">${esc(card.meta)}</text>
${MARK(L, 630 - 60 - 44, 44)}
<text x="${L + 44 + 16}" y="${630 - 60 - 13}" font-family="Inter, system-ui, sans-serif" font-size="30" font-weight="600" letter-spacing="-1.3" fill="#1F1D1A">lumen</text>
<rect x="1184" y="0" width="16" height="630" fill="#B45F0E"/>
</svg>`;
}

const tagsOf = (t: string[] = []) => t.slice(0, 3).map((x) => "#" + x).join(" ");
const readMin = (body: string) => Math.max(1, Math.round(words(body) / 220));

/** Card for a note (any type). */
export function noteCard(n: OgNote, site: string): OgCard {
  const kind = TYPE_LABEL[n.type];
  const tags = tagsOf(n.tags);
  const kicker = [site, kind && n.type !== "post" ? kind : "", tags].filter(Boolean).join(" · ");
  let meta = `${fmtDate(n.props?.date ? Date.parse(n.props.date) || n.createdAt : n.createdAt)} · ${readMin(n.body)} min read`;
  if (n.type === "path") {
    const courses = /^courses:\s*\[([^\]]*)\]/m.exec(n.body)?.[1]?.split(",").filter((x) => x.trim()).length ?? 0;
    const concepts = (n.body.match(/^\s*-\s+(?!\[)\S/gm) ?? []).length;
    meta = [courses ? `${courses} courses` : "", concepts ? `${concepts} concepts` : "", fmtDate(n.updatedAt)].filter(Boolean).join(" · ");
  } else if (n.type === "slides") meta = `${(n.body.match(/^---\s*$/gm) ?? []).length + 1} slides · ${fmtDate(n.updatedAt)}`;
  return { kicker, title: n.title || "Untitled", meta, description: plain(n.body).slice(0, 200) };
}

/** Card for a shared space (course / project): progress from its roadmap's task lines. */
export function spaceCard(sp: OgSpace, notes: OgNote[], site: string): OgCard {
  const rm = sp.roadmapId ? notes.find((n) => n.id === sp.roadmapId) : undefined;
  const all = rm ? rm.body.match(/^\s*- \[[ x/>?-]\]/gim) ?? [] : [];
  const done = rm ? (rm.body.match(/^\s*- \[x\]/gim) ?? []).length : 0;
  const pct = all.length ? Math.round((done / all.length) * 100) : null;
  const n = notes.filter((x) => x.id !== sp.roadmapId).length;
  const kind = sp.kind.charAt(0).toUpperCase() + sp.kind.slice(1);
  const meta = [pct !== null ? `${pct}% done` : "", `${n} ${n === 1 ? "note" : "notes"}`].filter(Boolean).join(" · ");
  return { kicker: `${site} · ${kind}`, title: sp.name, meta, description: (sp.description || "").slice(0, 200) };
}

