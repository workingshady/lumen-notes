// The <Glyph> component as an SVG string, for HTML built outside React (rendered Markdown, CodeMirror widgets).
import { GLYPHS } from "./glyphs";

export function glyphSvg(name: string, size = 16, cls = "lm-g"): string {
  const def = GLYPHS[name] ?? GLYPHS.note ?? [];
  const paths = def.map((p) => {
    const d = typeof p === "string" ? p : p.d;
    const fill = typeof p !== "string" && p.fill ? "currentColor" : "none";
    const stroke = typeof p === "string" ? "currentColor" : p.stroke ?? (p.fill ? "none" : "currentColor");
    return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" style="display:block;flex-shrink:0;overflow:visible">${paths}</svg>`;
}
