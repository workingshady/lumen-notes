// Live ink overlay: the stroke in progress is drawn with the pen's real look (same `finishStroke` maths and the same
// perfect-freehand options Excalidraw renders the committed element with), so nothing changes on pointer-up.
// Two canvases: one above the board (ink) and one below it (highlighter, translucent behind the ink).
import { getStroke } from "perfect-freehand";
import { finishStroke, type PenSettings } from "./model";

/** Dark-theme ink filter table (the SVG filter Whiteboard puts on the static layer): near-black inks turn light. */
export const INK_TABLE = "0.100 0.105 0.110 0.115 0.120 0.125 0.130 0.135 0.140 0.393 0.900 0.900 0.900 0.900 0.900 0.657 0.413 0.170 0.180 0.190 0.200 0.210 0.220 0.230 0.240 0.250 0.260 0.270 0.280 0.290 0.300 0.310 0.320 0.330 0.340 0.350 0.360 0.370 0.380 0.390 0.400 0.410 0.420 0.430 0.440 0.450 0.460 0.470 0.480 0.490 0.500 0.510 0.520 0.530 0.540 0.550 0.560 0.570 0.580 0.590 0.600 0.610 0.620 0.630 0.640 0.650 0.660 0.670 0.680 0.690 0.700 0.710 0.720 0.730 0.740 0.750 0.760 0.770 0.780 0.790 0.800 0.810 0.820 0.830 0.840 0.850 0.860 0.870 0.880 0.890 0.900 0.910 0.920 0.930 0.940 0.950 0.960 0.970 0.980 0.990 1.000";
const TBL = INK_TABLE.split(" ").map(Number);
const ch = (v: number) => { const x = Math.max(0, Math.min(1, v)) * (TBL.length - 1), i = Math.min(TBL.length - 2, Math.floor(x)); return TBL[i] + (TBL[i + 1] - TBL[i]) * (x - i); };
let probe: CanvasRenderingContext2D | null = null;
/** A colour as the dark board shows it (feFuncR/G/B table transfer, exactly like the SVG filter). */
export function inkFlip(color: string): string {
  probe ??= document.createElement("canvas").getContext("2d");
  if (!probe) return color;
  probe.fillStyle = "#000"; probe.fillStyle = color;
  const s = String(probe.fillStyle);
  let r = 0, g = 0, b = 0, a = 1;
  if (s.startsWith("#")) { r = parseInt(s.slice(1, 3), 16); g = parseInt(s.slice(3, 5), 16); b = parseInt(s.slice(5, 7), 16); }
  else { const m = s.match(/[\d.]+/g)?.map(Number) ?? []; [r, g, b] = m; a = m[3] ?? 1; }
  const f = (v: number) => Math.round(ch(v / 255) * 255);
  return `rgba(${f(r)},${f(g)},${f(b)},${a})`;
}

type El = Record<string, unknown> & { x: number; y: number; points: [number, number][]; pressures?: number[]; simulatePressure?: boolean; strokeWidth: number; opacity: number; strokeColor: string };

/** Excalidraw's freedraw outline (renderer options copied from @excalidraw/excalidraw 0.18 getFreeDrawSvgPath). */
export function freedrawOutline(el: El, last = false): Path2D {
  const input = el.simulatePressure ? el.points : el.points.length ? el.points.map(([x, y], i) => [x, y, el.pressures?.[i] ?? 0.5]) : [[0, 0, 0.5]];
  const pts = getStroke(input as number[][], { simulatePressure: !!el.simulatePressure, size: el.strokeWidth * 4.25, thinning: 0.6, smoothing: 0.5, streamline: 0.5, easing: (t) => Math.sin((t * Math.PI) / 2), last });
  const p = new Path2D();
  if (!pts.length) return p;
  // getSvgPathFromStroke: quadratic curves through the mid points
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    p.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  p.closePath();
  return p;
}

/**
 * Plain 2D context. NOT `desynchronized: true`: on Windows Chromium (Brave / Chrome / Edge) the low-latency canvas is
 * promoted to a front-buffer overlay that loses alpha on many GPUs, so the whole board turned black while the pen was
 * active and strokes tore into clipped rectangles (owner's recording 2026-11-21). The overlay paints on the next frame.
 */
function inkContext(c: HTMLCanvasElement): { ctx: CanvasRenderingContext2D | null; low: boolean } {
  return { ctx: c.getContext("2d"), low: false };
}

/** The overlay for one board. `draw` is rAF-throttled (immediate on a low-latency canvas when `now` is set); `clear` hides it (call right after the final element is committed). */
export class LiveInk {
  private top: HTMLCanvasElement;
  private under: HTMLCanvasElement;
  private raf = 0;
  private job: { el: El; pen: PenSettings; st: { zoom: { value: number }; scrollX: number; scrollY: number }; hl: boolean; dark: boolean; predicted?: [number, number][] } | null = null;
  private ctxTop: { ctx: CanvasRenderingContext2D | null; low: boolean };
  private ctxUnder: { ctx: CanvasRenderingContext2D | null; low: boolean };
  active = false;
  /** True when the overlay canvases got the low-latency (desynchronized) context. */
  get lowLatency() { return this.ctxTop.low; }
  constructor(private host: HTMLElement, beneath: HTMLElement) {
    const mk = () => { const c = document.createElement("canvas"); c.setAttribute("aria-hidden", "true"); c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none"; return c; };
    this.top = mk(); this.top.style.zIndex = "5";
    this.under = mk();
    host.appendChild(this.top);
    beneath.before(this.under);
    this.ctxTop = inkContext(this.top); this.ctxUnder = inkContext(this.under);
  }
  dispose() { cancelAnimationFrame(this.raf); this.top.remove(); this.under.remove(); this.host.classList.remove("wb-live-ink"); }
  /**
   * `predicted`: scene points from getPredictedEvents(), drawn ahead of the pen on the overlay only (never saved).
   * `now`: paint inside the pointer event when the canvas is low-latency.
   */
  draw(el: El, pen: PenSettings, st: { zoom: { value: number }; scrollX: number; scrollY: number }, hl: boolean, dark: boolean, o: { predicted?: [number, number][]; now?: boolean } = {}) {
    this.job = { el, pen, st, hl, dark, predicted: o.predicted };
    if (!this.active) { this.active = true; this.host.classList.add("wb-live-ink"); }
    if (o.now && this.ctxTop.low) { cancelAnimationFrame(this.raf); this.raf = 0; this.paint(); return; }
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); });
  }
  private paint() {
    const j = this.job;
    if (!j || !this.active) return;
    const c = j.hl ? this.under : this.top, other = j.hl ? this.top : this.under;
    const dpr = devicePixelRatio || 1, W = this.host.clientWidth, H = this.host.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    if (other.width) (j.hl ? this.ctxTop : this.ctxUnder).ctx?.clearRect(0, 0, other.width, other.height);
    const ctx = (j.hl ? this.ctxUnder : this.ctxTop).ctx;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    // predicted samples ride on the end of the stroke for this paint only (the stabiliser is causal: the real prefix is unchanged)
    const src = j.predicted?.length ? { ...j.el, points: [...j.el.points, ...j.predicted.map(([x, y]) => [x - j.el.x, y - j.el.y] as [number, number])], pressures: j.el.pressures?.length ? [...j.el.pressures, ...j.predicted.map(() => j.el.pressures![j.el.pressures!.length - 1])] : j.el.pressures } : j.el;
    const out = finishStroke(src, j.pen) as El;
    const z = j.st.zoom.value;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * z * (out.x + j.st.scrollX), dpr * z * (out.y + j.st.scrollY));
    ctx.globalAlpha = (out.opacity ?? 100) / 100;
    ctx.fillStyle = j.dark ? inkFlip(String(out.strokeColor)) : String(out.strokeColor);
    ctx.fill(freedrawOutline(out));
  }
  /** Hide the overlay (next frame, so the committed element is already painted underneath). */
  clear(now = false) {
    const go = () => {
      this.active = false; this.job = null;
      cancelAnimationFrame(this.raf); this.raf = 0;
      this.ctxTop.ctx?.clearRect(0, 0, this.top.width, this.top.height); this.ctxUnder.ctx?.clearRect(0, 0, this.under.width, this.under.height);
      this.host.classList.remove("wb-live-ink");
    };
    if (now) go(); else requestAnimationFrame(go);
  }
}
