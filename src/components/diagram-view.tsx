// Diagram viewer (design round 4, Lumen 17 · R4-17H): the diagram on a dot grid, drag to pan, Ctrl/⌘ + wheel to zoom,
// bottom-left toolbar (− zoom % + · Fit · Copy SVG). Theme and hand-drawn look come from Settings › Diagrams;
// diagrams larger than "Max render size" open fitted.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { buildSvg, exportPrefs } from "../lib/diagram-export";
import { fmtNum, t } from "../lib/i18n";
import { renderMermaidForExport } from "../lib/markdown";
import { useExtraPrefs, withLook } from "../lib/reading-prefs";
import { activeTheme } from "../lib/settings";
import { toast } from "../lib/store";
import { cx } from "./ui";

export function DiagramView({ src, className, toolbar = true }: { src: string; className?: string; toolbar?: boolean }) {
  const p = useExtraPrefs();
  const box = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<{ html: string; w: number; h: number } | null>(null);
  const [err, setErr] = useState("");
  const [z, setZ] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const fitted = useRef(true);
  const dark = activeTheme().dark;

  useEffect(() => {
    let live = true;
    const tm = setTimeout(async () => {
      try {
        const html = await renderMermaidForExport(withLook(src, p.diagramHand), p.diagramTheme, false);
        const doc = new DOMParser().parseFromString(html, "image/svg+xml").documentElement;
        const vb = (doc.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
        const w = vb[2] || parseFloat(doc.getAttribute("width") ?? "") || 400, h = vb[3] || parseFloat(doc.getAttribute("height") ?? "") || 300;
        if (live) { setSvg({ html, w, h }); setErr(""); }
      } catch (e) { if (live) setErr((e as Error).message.split("\n")[0] || t("Couldn't render this diagram")); }
    }, 200);
    return () => { live = false; clearTimeout(tm); };
  }, [src, p.diagramTheme, p.diagramHand, dark]);

  const fitZoom = useCallback(() => {
    const el = box.current;
    if (!el || !svg) return 1;
    return Math.min(4, (el.clientWidth - 48) / svg.w, (el.clientHeight - 80) / svg.h);
  }, [svg]);
  const fit = useCallback(() => { fitted.current = true; setZ(fitZoom()); setPan({ x: 0, y: 0 }); }, [fitZoom]);
  // First render: 100% when it fits, else fitted; always fitted beyond the max render size.
  useLayoutEffect(() => {
    if (!svg) return;
    const max = p.diagramMaxPx || Infinity;
    const f = fitZoom();
    // Settings › Diagrams › Default zoom (round 6): Fit = fitted when it doesn't fit at 100%; 100% = actual size unless
    // beyond the max render size; Fill = always fitted to the view (may enlarge).
    const zm = p.diagramZoom ?? "fit";
    fitted.current = Math.max(svg.w, svg.h) > max || zm === "fill" || (zm === "fit" && f < 1);
    setZ(fitted.current ? f : 1);
    setPan({ x: 0, y: 0 });
  }, [svg]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (fitted.current) setZ(fitZoom()); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitZoom]);

  const step = (d: number) => { fitted.current = false; setZ((x) => Math.min(8, Math.max(0.1, x * (d > 0 ? 1.2 : 1 / 1.2)))); };
  const copySvg = async () => {
    try { const b = await buildSvg(src, { ...exportPrefs(), format: "svg" }); await navigator.clipboard.writeText(b.svg); toast(t("SVG code copied")); }
    catch (e) { toast((e as Error).message); }
  };
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const x0 = e.clientX - pan.x, y0 = e.clientY - pan.y;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const mv = (m: PointerEvent) => { fitted.current = false; setPan({ x: m.clientX - x0, y: m.clientY - y0 }); };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  const tbtn = "flex h-7 items-center justify-center rounded-[7px] hover:bg-surface-2";
  return (
    <div ref={box} tabIndex={0} className={cx("relative h-full min-h-0 overflow-hidden outline-none", className)}
      style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.2px)", backgroundSize: "20px 20px", cursor: "grab", touchAction: "none" }}
      onPointerDown={down} onDoubleClick={() => (fitted.current ? (fitted.current = false, setZ(1), setPan({ x: 0, y: 0 })) : fit())}
      onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); step(-e.deltaY); } }}
      onKeyDown={(e) => { if (e.key === "+" || e.key === "=") step(1); else if (e.key === "-") step(-1); else if (e.key === "0") fit(); }}>
      {svg && (
        <div className="absolute left-1/2 top-1/2" style={{ width: svg.w, height: svg.h, transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${z})` }}
          dangerouslySetInnerHTML={{ __html: svg.html }} />
      )}
      {!svg && !err && <div className="absolute inset-0 flex items-center justify-center text-muted">{t("Rendering diagram…")}</div>}
      {err && <div className="absolute inset-x-4 top-4 rounded-[8px] border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_12%,var(--surface))] px-3 py-2 font-mono text-[12px] text-bad">{err}</div>}
      {toolbar && (
        <div className="absolute bottom-4 start-4 flex gap-0.5 rounded-[10px] border border-line bg-surface p-[3px] text-[12px]">
          <button aria-label={t("Zoom out")} title={t("Zoom out (−)")} onClick={() => step(-1)} className={cx(tbtn, "w-[30px] text-[13px]")}>−</button>
          <button title={t("Actual size")} onClick={() => { fitted.current = false; setZ(1); }} className={cx(tbtn, "w-10 tabular-nums")}>{fmtNum(Math.round(z * 100))}%</button>
          <button aria-label={t("Zoom in")} title={t("Zoom in (+)")} onClick={() => step(1)} className={cx(tbtn, "w-[30px] text-[13px]")}>+</button>
          <button title={t("Fit (0)")} onClick={fit} className={cx(tbtn, "px-2")}>{t("Fit")}</button>
          <button title={t("Copy the diagram as SVG code")} onClick={() => void copySvg()} className={cx(tbtn, "px-2")}>{t("Copy SVG")}</button>
        </div>
      )}
    </div>
  );
}
