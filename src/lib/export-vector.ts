// Vector PDF: SVG output drawn into the PDF as paths and real (selectable) text, via jsPDF + svg2pdf.js (both lazy).
// Needs the DOM (svg2pdf measures the SVG), so it runs on the main thread and yields between pages; raster PDFs stay in the worker.
import { pageGeometry, type PdfLayout, type PdfPageIn } from "./export-encode";

export interface VectorPage { svg: string; width: number; height: number; bg: string | null }
export type PdfUnit = ({ kind: "vector" } & VectorPage) | ({ kind: "raster" } & PdfPageIn);

/** Why an SVG cannot be drawn faithfully as vectors (null = it can). */
export function vectorBlocker(svg: string): string | null {
  if (/<foreignObject\b/i.test(svg)) return "foreignObject";
  if (/<image\b/i.test(svg)) return "image";
  if (/<(filter|mask)\b|filter="/i.test(svg)) return "filter";
  if (/<video\b|<canvas\b/i.test(svg)) return "media";
  // PDF's built-in fonts cover Latin-1 / WinAnsi only: other scripts (Arabic shaping, CJK, emoji) would turn to garbage
  const text = [...svg.matchAll(/>([^<>]+)</g)].map((m) => m[1]).join("");
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\xff–—‘’“”•…€™]/.test(text.replace(/&[#\w]+;/g, ""))) return "script";
  return null;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const BASE_FONTS: Record<string, string> = {};

/** One PDF; vector pages are drawn from SVG text, raster pages are placed as images. */
export async function buildVectorPdf(units: PdfUnit[], lay: PdfLayout & { lang?: string }, progress?: (i: number) => void): Promise<Uint8Array> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  void BASE_FONTS;
  let doc: InstanceType<typeof jsPDF> | null = null;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-100000px;top:0;width:0;height:0;overflow:hidden;pointer-events:none";
  document.body.appendChild(host);
  try {
    let i = 0;
    for (const u of units) {
      const g = pageGeometry(lay, u.width, u.height);
      const orient = g.pw > g.ph ? "l" : "p";
      if (!doc) { doc = new jsPDF({ unit: "pt", format: [g.pw, g.ph], orientation: orient, compress: true, putOnlyUsedFonts: true }); doc.setProperties({ title: lay.title, creator: "Lumen", subject: lay.title }); try { doc.setLanguage((lay.lang || "en-US") as never); } catch { /* unsupported tag */ } }
      else doc.addPage([g.pw, g.ph], orient);
      if (u.kind === "raster") doc.addImage(u.bytes, u.kind === "raster" && u.bytes[0] === 0x89 ? "PNG" : "JPEG", g.x, g.y, g.w, g.h, undefined, "FAST");
      else {
        const parsed = new DOMParser().parseFromString(u.svg.replace(/^<\?xml[^>]*\?>\s*/, ""), "image/svg+xml");
        const el = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
        if (el.nodeName !== "svg") throw new Error("svg-parse");
        el.setAttribute("width", String(u.width)); el.setAttribute("height", String(u.height));
        const vb = (el.getAttribute("viewBox") ?? `0 0 ${u.width} ${u.height}`).split(/[\s,]+/).map(Number);
        if (u.bg) { const r = document.createElementNS("http://www.w3.org/2000/svg", "rect"); r.setAttribute("x", String(vb[0])); r.setAttribute("y", String(vb[1])); r.setAttribute("width", String(vb[2])); r.setAttribute("height", String(vb[3])); r.setAttribute("fill", u.bg); el.insertBefore(r, el.firstChild); }
        host.appendChild(el);
        try { await svg2pdf(el, doc, { x: g.x, y: g.y, width: g.w, height: g.h }); } finally { host.removeChild(el); }
      }
      progress?.(++i);
      await tick();
    }
    return new Uint8Array(doc!.output("arraybuffer"));
  } finally { host.remove(); }
}
