// Exports draw the board's background and pattern (brief §6): the pattern as an SVG <pattern> (vector for SVG / PDF,
// rasterised under the drawing for PNG / JPEG / WebP). Colours are resolved from the theme at export time.
import { PAGE_SIZE, type LumenBoard } from "./model";

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function rgb(c: string): [number, number, number] {
  const x = document.createElement("canvas").getContext("2d")!;
  x.fillStyle = "#000"; x.fillStyle = c;
  const s = String(x.fillStyle);
  if (s.startsWith("#")) return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const m = s.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  return [m[0], m[1], m[2]];
}
/** Concrete board colour (theme / transparent → the app's --bg). */
export function resolvedBoardColor(b: LumenBoard): string {
  const map: Record<string, string> = { white: "#FFFFFF", warm: "#F4ECD8", chalk: "#1F3A2E", blueprint: "#173A63" };
  if (b.bg === "custom") return b.custom;
  return map[b.bg] ?? (css("--bg") || "#0F1115");
}
/** Concrete pattern line colour. */
export function resolvedLineColor(b: LumenBoard, dark: boolean): string {
  if (b.bg === "chalk" || b.bg === "blueprint" || (b.bg === "custom" && dark)) return "rgba(255,255,255,0.14)";
  const [r, g, bl] = rgb(css("--muted") || "#9AA0AA");
  return `rgba(${r},${g},${bl},0.16)`;
}

/** `<pattern>` + fill for the board pattern in scene units (k = export scale; offset so it lines up with the board). */
export function patternDefs(b: LumenBoard, line: string, k: number, ox: number, oy: number): { defs: string; fill: string } | null {
  const s = b.density * k, id = "lumen-board-pat";
  const L = (x1: number, y1: number, x2: number, y2: number, w = 1) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${line}" stroke-width="${w}"/>`;
  let w = s, h = s, body = "";
  switch (b.pattern) {
    case "dots": body = `<circle cx="${s / 2}" cy="${s / 2}" r="${1.3 * k}" fill="${line}"/>`; break;
    case "grid": body = L(0, 0, s, 0) + L(0, 0, 0, s); break;
    case "lines": w = 10; h = (s * 28) / 22; body = L(0, 0, w, 0); break;
    case "graph": { const g = (s * 12) / 22; w = h = g * 5; for (let i = 0; i < 5; i++) body += L(0, i * g, w, i * g, i ? 1 : 1.6) + L(i * g, 0, i * g, h, i ? 1 : 1.6); break; }
    case "iso": { const g = (s * 24) / 22; h = g; w = g / Math.tan(Math.PI / 6); body = L(0, 0, w, h) + L(0, h, w, 0); break; }
    case "cornell": w = 10; h = (s * 28) / 22; body = L(0, 0, w, 0); break;
    case "staff": { const g = (s * 8) / 22; w = 10; h = g * 8; for (let i = 1; i <= 5; i++) body += L(0, g * i, w, g * i); break; }
    default: return null;
  }
  const px = ((ox % w) + w) % w, py = ((oy % h) + h) % h;
  let defs = `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${px}" y="${py}" width="${w}" height="${h}">${body}</pattern>`;
  if (b.pattern === "cornell") defs += `<pattern id="${id}-m" patternUnits="userSpaceOnUse" x="${ox + 260 * k}" y="0" width="100000" height="${h}">${L(0, 0, 0, h, 2)}</pattern>`;
  return { defs, fill: b.pattern === "cornell" ? `url(#${id})|url(#${id}-m)` : `url(#${id})` };
}

/** Background (+ pattern) for an exported image of W×H px whose top-left is scene point (sx, sy) at scale k. */
export function backgroundSvg(b: LumenBoard, bg: string | null, pattern: boolean, dark: boolean, W: number, H: number, sx: number, sy: number, k: number): string {
  const p = pattern && bg ? patternDefs(b, resolvedLineColor(b, dark), k, -sx * k, -sy * k) : null;
  const rects = (p?.fill.split("|") ?? []).map((f) => `<rect width="${W}" height="${H}" fill="${f}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${p ? `<defs>${p.defs}</defs>` : ""}${bg ? `<rect width="${W}" height="${H}" fill="${bg}"/>` : ""}${rects}</svg>`;
}
/** Insert the background into an exported SVG (vector). */
export function withSvgBackground(svg: string, back: string): string {
  const inner = back.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  return svg.replace(/(<svg\b[^>]*>)/, `$1${inner}`);
}
/** PNG blob → same image over the background (pattern rasterised). */
export async function withRasterBackground(blob: Blob, back: string): Promise<Blob> {
  const bm = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bm.width; c.height = bm.height;
  const ctx = c.getContext("2d")!;
  const url = URL.createObjectURL(new Blob([back], { type: "image/svg+xml" }));
  try { const img = new Image(); img.src = url; await img.decode(); ctx.drawImage(img, 0, 0, c.width, c.height); } finally { URL.revokeObjectURL(url); }
  ctx.drawImage(bm, 0, 0);
  bm.close();
  return await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), "image/png"));
}
export { PAGE_SIZE };
