// Frames navigator (design 38D, 41E; WBStudio overlay "frames"): thumbnails, drag to reorder (= slide order), rename,
// zoom to a frame, hide from the presentation. Footer: Export frames… · Present.
import { useEffect, useState } from "react";
import { t } from "../../../lib/i18n";
import type { WbCtx } from "../hooks";
import { Note, PANEL_END, RowIcon, RowItem } from "../kit";
import { PanelShell } from "../panel";
import { frameName, frameThumb, isHidden, orderedFrames, renameFrame, reorderFrames, setFrameHidden, type FrameEl } from "../present/frames";
import { useReorder } from "./reorder";

const STRIPES = "repeating-linear-gradient(135deg,var(--surface-2) 0 5px,var(--bg) 5px 10px)";

export function FramesPanel({ ctx, tick }: { ctx: WbCtx; tick: number }) {
  const api = ctx.api;
  const frames = orderedFrames(api);
  const [cur, setCur] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const sig = frames.map((f) => `${f.id}:${f.version}`).join();
  useEffect(() => {
    if (!api) return;
    let live = true;
    const tm = setTimeout(async () => {
      const out: Record<string, string> = {};
      for (const f of orderedFrames(api)) { try { out[f.id] = await frameThumb(api, f, !!ctx.dark); } catch { /* empty frame */ } }
      if (live) setThumbs(out);
    }, 250);
    return () => { live = false; clearTimeout(tm); };
  }, [api, sig, tick, ctx.dark]); // eslint-disable-line react-hooks/exhaustive-deps
  // the current frame = nearest to the view centre (same rule as the frame chip)
  useEffect(() => {
    if (!api || !frames.length) return;
    const st = api.getAppState() as { zoom: { value: number }; scrollX: number; scrollY: number; width: number; height: number };
    const cx = -st.scrollX + st.width / st.zoom.value / 2, cy = -st.scrollY + st.height / st.zoom.value / 2;
    let best = frames[0].id, bd = Infinity;
    for (const f of frames) { const d = Math.hypot(f.x + f.width / 2 - cx, f.y + f.height / 2 - cy); if (d < bd) { bd = d; best = f.id; } }
    setCur(best);
  }, [api, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const rl = useReorder(frames.length, (from, to) => { if (api) { reorderFrames(api, from, to); ctx.save(); } });
  const zoom = (f: FrameEl) => { setCur(f.id); api?.scrollToContent(f as never, { fitToContent: true, animate: true }); };
  const foot = (<>
    <button type="button" onClick={() => ctx.exportFrames?.()} className="flex h-8 items-center whitespace-nowrap rounded-[8px] border border-line px-3 text-[12.5px] font-medium hover:bg-surface-2">{t("Export frames…")}</button>
    <button type="button" disabled={!frames.some((f) => !isHidden(f))} onClick={() => ctx.present?.()} className="flex h-8 items-center whitespace-nowrap rounded-[8px] bg-accent px-3 text-[12.5px] font-semibold text-accent-fg disabled:opacity-50">{t("Present")}</button>
  </>);
  return (
    <PanelShell glyph="frame" title={t("Frames")} sub={t("Slide order")} onClose={ctx.close} sheet={ctx.phone} portal={ctx.phone} className={ctx.phone ? "!fixed z-50" : PANEL_END} foot={foot} label={t("Frames")}>
      <div className="flex flex-col gap-2">
        {frames.length ? (
          <div ref={rl.list} className="relative grid grid-cols-1 gap-1">
            {frames.map((f, i) => (
              <div key={f.id} data-row className="relative">
                {rl.lineBefore(i) && <span className="pointer-events-none absolute -top-[3px] inset-x-1 z-10 h-0.5 rounded-full bg-accent" />}
                <RowItem mh={50} pad="4px 8px" on={f.id === cur} op={isHidden(f) ? 0.55 : 1} onClick={() => zoom(f)} onDoubleClick={() => setEdit(f.id)} onKeyDownCapture={rl.keys(i)}
                  title={t("Click to go to the frame · double-click to rename")}>
                  <span {...rl.grip(i)} aria-label={t("Drag to reorder")} className="select-none text-[11px] tracking-[-2px] text-muted">⋮⋮</span>
                  <span className="box-border block h-9 w-16 shrink-0 rounded-[4px] border border-line bg-center bg-no-repeat" style={{ background: thumbs[f.id] ? `url(${thumbs[f.id]}) center/contain no-repeat` : STRIPES, filter: thumbs[f.id] && ctx.dark ? "url(#lumen-wb-ink)" : undefined, backgroundColor: thumbs[f.id] ? "var(--bg)" : undefined }} />
                  {edit === f.id ? (
                    <input autoFocus defaultValue={f.name ?? ""} placeholder={frameName(f, i)} dir="auto" aria-label={t("Frame name")} onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => { if (api) { renameFrame(api, f.id, e.target.value); ctx.save(); } setEdit(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { e.stopPropagation(); setEdit(null); } }}
                      className="h-7 min-w-0 flex-1 rounded-[6px] border border-accent bg-bg px-1.5 text-[12.5px] outline-none" />
                  ) : <span dir="auto" className="min-w-0 flex-1 truncate whitespace-pre">{i + 1}{"  "}{frameName(f, i)}</span>}
                  <span className="flex gap-[2px]">
                    <RowIcon glyph={isHidden(f) ? "eye-off" : "eye"} tip={isHidden(f) ? t("Show in presentation") : t("Hide from presentation")} active={!isHidden(f)} onClick={() => { if (api) { setFrameHidden(api, f.id, !isHidden(f)); ctx.save(); } }} />
                    <RowIcon glyph="fit" tip={t("Zoom to frame")} onClick={() => zoom(f)} />
                  </span>
                </RowItem>
              </div>
            ))}
            {rl.lineBefore(frames.length) && <span className="pointer-events-none absolute -bottom-[3px] inset-x-1 h-0.5 rounded-full bg-accent" />}
          </div>
        ) : <Note boxed>{t("No frames yet. Press F and drag on the board to add one; each frame becomes a slide.")}</Note>}
        <Note>{t("Order here is slide order. The eye hides a frame from the presentation only. Double-click to rename; click the target to zoom to it.")}</Note>
      </div>
    </PanelShell>
  );
}
