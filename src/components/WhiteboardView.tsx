import { Excalidraw, restore } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useMemo, useRef, useState } from "react";
import { attUrl } from "../lib/api";
import { activeTheme } from "../lib/settings";
import { t } from "../lib/i18n";
import { parseScene } from "../lib/whiteboard";
import { hydrateFiles, serverSource, type SceneFile } from "../lib/wb-files";
import { embedProps } from "./wb-media";
import type { WbAPI } from "./wb/hooks";
import { BoardHeader } from "./wb/BoardHeader";
import { BottomStart, FrameChip, Minimap } from "./wb/BottomBar";
import { Banner } from "./wb/States";

const embeds = embedProps(async (id) => attUrl(id));
const CSS = `.lumen-wbv { background-color: var(--bg); background-image: radial-gradient(color-mix(in srgb,var(--muted) 16%,transparent) 1.2px, transparent 1.4px); background-size: 22px 22px; }
.lumen-wbv .excalidraw .App-menu_top, .lumen-wbv .excalidraw .layer-ui__wrapper__footer-left, .lumen-wbv .excalidraw .layer-ui__wrapper__footer-right, .lumen-wbv .excalidraw .footer-center, .lumen-wbv .excalidraw .exit-view-mode,
.lumen-wbv .excalidraw .App-bottom-bar, .lumen-wbv .excalidraw .HintViewer, .lumen-wbv .excalidraw .main-menu-trigger, .lumen-wbv .excalidraw .scroll-back-to-content { display: none !important; }
.lumen-wbv .excalidraw { --color-surface-low: transparent; }`;

/** Zoom out / % / zoom in / Fit only: a view-only page has nothing to undo or save (the editor's ZoomCluster adds undo and redo). */
function ViewZoom({ api, zoom }: { api: WbAPI | null; zoom: number }) {
  const setZoom = (f: number | null) => {
    if (!api) return;
    const st = api.getAppState() as { zoom: { value: number }; scrollX: number; scrollY: number; width: number; height: number };
    const z0 = st.zoom.value, z1 = f == null ? 1 : Math.min(30, Math.max(0.1, Math.round(z0 * f * 100) / 100));
    const cx = st.width / 2, cy = st.height / 2;
    api.updateScene({ appState: { zoom: { value: z1 }, scrollX: st.scrollX + cx / z1 - cx / z0, scrollY: st.scrollY + cy / z1 - cy / z0 } });
  };
  const b = "flex size-7 items-center justify-center rounded-[7px] text-[16px] hover:bg-surface-2";
  return (
    <div data-wb-chrome className="hidden gap-2 md:flex" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-[2px] rounded-[10px] border border-line bg-surface p-[3px]">
        <button type="button" aria-label={t("Zoom out")} title={t("Zoom out")} onClick={() => setZoom(1 / 1.2)} className={b}>−</button>
        <button type="button" title={t("Reset to 100%")} onClick={() => setZoom(null)} className="w-11 text-center text-[12px] tabular-nums">{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label={t("Zoom in")} title={t("Zoom in")} onClick={() => setZoom(1.2)} className={b}>+</button>
        <span className="h-[18px] w-px bg-line" />
        <button type="button" title={t("Fit to screen")} onClick={() => api?.scrollToContent(undefined, { fitToContent: true, animate: true })} className="flex h-7 items-center rounded-[7px] px-2 text-[12px] text-muted hover:bg-surface-2 hover:text-ink">{t("Fit")}</button>
      </div>
    </div>
  );
}

/**
 * View-only shared board (design 33H): toolbar hidden, header offers "Duplicate to my vault", banner "Shared by … · view only",
 * zoom / fit / minimap / frames still work. Without `header` it renders the bare board (pan/zoom only) as before.
 */
export default function WhiteboardView({ body, header, title = "", crumb = "", by, onDuplicate, onAskEdit, onApi, extraButtons }: {
  body: string; header?: boolean; title?: string; crumb?: string; by?: string; onDuplicate?: () => void; onAskEdit?: () => void;
  /** The Excalidraw handle (the share page uses it for PNG export), and extra header buttons such as "PNG". */
  onApi?: (a: WbAPI) => void; extraButtons?: { glyph: string; label: string; tip: string; run: () => void }[];
}) {
  const [api, setApi] = useState<WbAPI | null>(null);
  const [zoom, setZoom] = useState(1);
  const [tick, setTick] = useState(0);
  const [frames, setFrames] = useState(0);
  const [minimap, setMinimap] = useState(true);
  const last = useRef(0);
  const { initialData, files } = useMemo(() => {
    const { scene } = parseScene(body);
    const r = restore({ elements: scene.elements as never, files: scene.files as never }, null, null);
    return { initialData: { elements: r.elements, files: r.files, appState: { viewBackgroundColor: "transparent", viewModeEnabled: true }, scrollToContent: true }, files: scene.files as Record<string, SceneFile> };
  }, [body]);
  const board = (
    <Excalidraw initialData={initialData as never} viewModeEnabled theme={activeTheme().dark ? "dark" : "light"} {...(embeds as object)}
      excalidrawAPI={(a) => { setApi(a as unknown as WbAPI); onApi?.(a as unknown as WbAPI); setFrames(a.getSceneElements().filter((e) => e.type === "frame" || e.type === "magicframe").length); void hydrateFiles(files, serverSource(attUrl)).then((f) => { if (f.length) a.addFiles(f as never); }); }}
      onChange={(_e, st) => { const now = performance.now(); if (now - last.current > 120) { last.current = now; setTick((n) => n + 1); } if (st.zoom.value !== zoom) setZoom(st.zoom.value); }}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false, changeViewBackgroundColor: false, clearCanvas: false, saveAsImage: false } }} />
  );
  if (!header) return board;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <style>{CSS}</style>
      <BoardHeader crumb={crumb} title={title} saved={{ text: "", color: "transparent" }} phone={false}
        buttons={[...(extraButtons ?? []), { glyph: "eye", label: t("View only"), tip: t("View only"), run: () => {} }, ...(onDuplicate ? [{ glyph: "copy", label: t("Duplicate to my vault"), tip: t("Duplicate to my vault"), run: onDuplicate, primary: true }] : [])]} />
      <div className="lumen-wbv relative min-h-0 flex-1">
        <div dir="ltr" className="absolute inset-0">{board}</div>
        <Banner dot="var(--info)" text={by ? t("Shared by {name} · view only", { name: by }) : t("Shared · view only")} action={onAskEdit ? t("Ask to edit") : undefined} onAction={onAskEdit} />
        <BottomStart>{minimap && <Minimap api={api} tick={tick} />}<ViewZoom api={api} zoom={zoom} /></BottomStart>
        <FrameChip api={api} count={frames} tick={tick} minimap={minimap} onMinimap={() => setMinimap((m) => !m)} onFrames={() => {}} />
      </div>
    </div>
  );
}
