// Bottom clusters (design 33A / 33H / 33J): zoom − % + | Fit, Undo · Redo, minimap; bottom-right frame navigator chip.
import { useEffect, useRef, useState } from "react";
import { t } from "../../lib/i18n";
import { Glyph } from "../Glyph";
import type { WbAPI } from "./hooks";
import { Pop, Row } from "./ui";

type Box = { x: number; y: number; w: number; h: number; frame: boolean };
const bounds = (els: readonly Record<string, unknown>[]): Box[] => els.filter((e) => !e.isDeleted).map((e) => {
  const x = e.x as number, y = e.y as number, w = e.width as number, h = e.height as number;
  return { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h), frame: e.type === "frame" || e.type === "magicframe" };
});

export function ZoomCluster({ api, zoom, canRedo, onUndo, onRedo, disabledEdit }: { api: WbAPI | null; zoom: number; canRedo: boolean; onUndo: () => void; onRedo: () => void; disabledEdit?: boolean }) {
  const setZoom = (f: number | null) => {
    if (!api) return;
    const st = api.getAppState() as { zoom: { value: number }; scrollX: number; scrollY: number; width: number; height: number };
    const z0 = st.zoom.value, z1 = f == null ? 1 : Math.min(30, Math.max(0.1, Math.round(z0 * f * 100) / 100));
    // zoom around the centre of the view
    const cx = st.width / 2, cy = st.height / 2;
    api.updateScene({ appState: { zoom: { value: z1 }, scrollX: st.scrollX + cx / z1 - cx / z0, scrollY: st.scrollY + cy / z1 - cy / z0 } });
  };
  const b = "flex size-7 items-center justify-center rounded-[7px] text-[16px] hover:bg-surface-2";
  return (
    <div data-wb-chrome className="absolute bottom-[14px] start-[14px] z-20 hidden gap-2 md:flex" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-[2px] rounded-[10px] border border-line bg-surface p-[3px]">
        <button type="button" aria-label={t("Zoom out")} title={t("Zoom out") + " · Ctrl −"} onClick={() => setZoom(1 / 1.2)} className={b}>−</button>
        <button type="button" title={t("Reset to 100%")} onClick={() => setZoom(null)} className="w-11 text-center text-[12px] tabular-nums">{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label={t("Zoom in")} title={t("Zoom in") + " · Ctrl +"} onClick={() => setZoom(1.2)} className={b}>+</button>
        <span className="h-[18px] w-px bg-line" />
        <button type="button" title={t("Fit to screen") + " · Shift 1"} onClick={() => api?.scrollToContent(undefined, { fitToContent: true, animate: true })} className="flex h-7 items-center rounded-[7px] px-2 text-[12px] text-muted hover:bg-surface-2 hover:text-ink">{t("Fit")}</button>
      </div>
      <div className="flex items-center gap-[2px] rounded-[10px] border border-line bg-surface p-[3px]">
        <button type="button" title={t("Undo") + " · Ctrl Z"} aria-label={t("Undo")} disabled={disabledEdit} onClick={onUndo} className="flex size-7 items-center justify-center rounded-[7px] text-ink hover:bg-surface-2"><Glyph name="undo" size={16} /></button>
        <button type="button" title={t("Redo") + " · Ctrl Shift Z"} aria-label={t("Redo")} disabled={disabledEdit} onClick={onRedo} className={"flex size-7 items-center justify-center rounded-[7px] hover:bg-surface-2 " + (canRedo && !disabledEdit ? "text-ink" : "text-muted")}><Glyph name="redo" size={16} /></button>
      </div>
    </div>
  );
}

/** 180×110 overview: element boxes (frames outlined), the visible area in amber; click or drag to move there. */
export function Minimap({ api, tick }: { api: WbAPI | null; tick: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const geo = useRef<{ minX: number; minY: number; k: number; ox: number; oy: number } | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !api) return;
    const id = requestAnimationFrame(() => {
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const dpr = devicePixelRatio || 1, W = 180, H = 110;
      c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const st = api.getAppState() as { zoom: { value: number }; scrollX: number; scrollY: number; width: number; height: number };
      const z = st.zoom.value, view = { x: -st.scrollX, y: -st.scrollY, w: st.width / z, h: st.height / z };
      const boxes = bounds(api.getSceneElements());
      const all = [...boxes, { ...view, frame: false }];
      const minX = Math.min(...all.map((b) => b.x)), minY = Math.min(...all.map((b) => b.y));
      const maxX = Math.max(...all.map((b) => b.x + b.w)), maxY = Math.max(...all.map((b) => b.y + b.h));
      const k = Math.min((W - 16) / Math.max(1, maxX - minX), (H - 16) / Math.max(1, maxY - minY));
      const ox = (W - (maxX - minX) * k) / 2, oy = (H - (maxY - minY) * k) / 2;
      geo.current = { minX, minY, k, ox, oy };
      const css = getComputedStyle(c);
      const mu = css.getPropertyValue("--muted").trim() || "#9AA0AA", ac = css.getPropertyValue("--accent").trim() || "#F2A93B";
      ctx.lineWidth = 1;
      ctx.strokeStyle = mu; ctx.globalAlpha = 0.9;
      // big boards: only frames and the largest boxes, so the overview stays cheap
      const draw = boxes.length > 1500 ? boxes.filter((b) => b.frame || b.w * b.h * k * k > 40) : boxes;
      for (const b of draw) ctx.strokeRect(ox + (b.x - minX) * k + 0.5, oy + (b.y - minY) * k + 0.5, Math.max(1, b.w * k), Math.max(1, b.h * k));
      ctx.globalAlpha = 0.08; ctx.fillStyle = ac;
      const vx = ox + (view.x - minX) * k, vy = oy + (view.y - minY) * k;
      ctx.fillRect(vx, vy, view.w * k, view.h * k);
      ctx.globalAlpha = 1; ctx.strokeStyle = ac; ctx.lineWidth = 1.5;
      ctx.strokeRect(vx, vy, view.w * k, view.h * k);
    });
    return () => cancelAnimationFrame(id);
  }, [api, tick]);
  const go = (e: React.PointerEvent) => {
    const g = geo.current, r = ref.current?.getBoundingClientRect();
    if (!g || !r || !api) return;
    const st = api.getAppState() as { zoom: { value: number }; width: number; height: number };
    const sx = (e.clientX - r.left - g.ox) / g.k + g.minX, sy = (e.clientY - r.top - g.oy) / g.k + g.minY;
    api.updateScene({ appState: { scrollX: -(sx - st.width / st.zoom.value / 2), scrollY: -(sy - st.height / st.zoom.value / 2) } });
  };
  return (
    <div data-wb-chrome className="absolute bottom-[58px] start-[14px] z-20 hidden h-[110px] w-[180px] overflow-hidden rounded-[10px] border border-line bg-surface md:block">
      <canvas ref={ref} aria-label={t("Minimap")} className="size-full cursor-pointer" style={{ width: 180, height: 110 }} onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); go(e); }} onPointerMove={(e) => e.buttons && go(e)} />
    </div>
  );
}

/** Frames, in board order (W3-A may reorder via customData.lumenOrder). */
export function framesOf(api: WbAPI | null) {
  if (!api) return [];
  const fr = api.getSceneElements().filter((e) => (e.type === "frame" || e.type === "magicframe") && !e.isDeleted);
  const ord = (e: Record<string, unknown>) => ((e.customData as { lumenOrder?: number } | undefined)?.lumenOrder ?? Infinity);
  return [...fr].sort((a, b) => ord(a) - ord(b));
}

export function FrameChip({ api, count, tick, minimap, onMinimap, onFrames }: { api: WbAPI | null; count: number; tick: number; minimap: boolean; onMinimap: () => void; onFrames: () => void }) {
  const [menu, setMenu] = useState(false);
  const [cur, setCur] = useState(0);
  // Current frame = the one whose centre is nearest the centre of the view.
  useEffect(() => {
    if (!api || !count) return;
    const st = api.getAppState() as { zoom: { value: number }; scrollX: number; scrollY: number; width: number; height: number };
    const cx = -st.scrollX + st.width / st.zoom.value / 2, cy = -st.scrollY + st.height / st.zoom.value / 2;
    const fr = framesOf(api);
    let best = 0, bd = Infinity;
    fr.forEach((f, i) => { const d = Math.hypot((f.x as number) + (f.width as number) / 2 - cx, (f.y as number) + (f.height as number) / 2 - cy); if (d < bd) { bd = d; best = i; } });
    setCur(best);
  }, [api, tick, count]);
  const go = (d: number) => {
    const fr = framesOf(api);
    if (!fr.length || !api) return;
    const i = (cur + d + fr.length) % fr.length;
    setCur(i);
    api.scrollToContent(fr[i], { fitToContent: true, animate: true });
  };
  return (
    <div data-wb-chrome className="absolute bottom-[14px] end-[14px] z-20 hidden md:block" onPointerDown={(e) => e.stopPropagation()}>
      {count > 0 ? (
        <div className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface pe-1.5 ps-3 text-[12.5px]">
          <button type="button" aria-label={t("Previous frame")} onClick={() => go(-1)} className="text-muted hover:text-ink rtl:rotate-180">‹</button>
          <span>{t("Frame {n} of {total}", { n: cur + 1, total: count })}</span>
          <button type="button" aria-label={t("Next frame")} onClick={() => go(1)} className="text-muted hover:text-ink rtl:rotate-180">›</button>
          <button type="button" data-pop-anchor aria-label={t("Frame options")} onClick={() => setMenu((m) => !m)} className="flex size-[26px] items-center justify-center rounded-full text-muted hover:bg-surface-2"><Glyph name="more" size={15} /></button>
        </div>
      ) : (
        <button type="button" data-pop-anchor aria-label={t("View options")} onClick={() => setMenu((m) => !m)} className="flex size-9 items-center justify-center rounded-full border border-line bg-surface text-muted hover:text-ink"><Glyph name="minimap" size={16} /></button>
      )}
      {menu && (
        <Pop onClose={() => setMenu(false)} className="bottom-[calc(100%+8px)] end-0 w-[210px]">
          {count > 0 && <Row glyph="frame" label={t("Frames…")} onClick={() => { setMenu(false); onFrames(); }} />}
          <Row glyph="minimap" label={t("Minimap")} hint={minimap ? t("On") : t("Off")} on={minimap} onClick={() => { setMenu(false); onMinimap(); }} />
          <Row glyph="fit" label={t("Fit all")} onClick={() => { setMenu(false); api?.scrollToContent(undefined, { fitToContent: true, animate: true }); }} />
        </Pop>
      )}
    </div>
  );
}
