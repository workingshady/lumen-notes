// Docked pen bar extras (design 33C/34E WBStudio PROPS.tool: smoothing · pressure | auto-shape) and the eraser bar with
// the R6Parts "erasers" popovers (34D): Eraser (stroke · partial · lasso, three sizes, scratch-out, stylus button),
// Ruler (angle, Shift = 15°, cm) and Auto-shape (hold to snap · always · off).
import { useState, type ReactNode } from "react";
import { t } from "../../../lib/i18n";
import { Glyph } from "../../Glyph";
import { cx } from "../../ui";
import { AC_BG } from "../ui";
import { BlockHead, ON_STYLE, PanelShell, Seg, Tog } from "../panel";
import { ERASER_PX, getInk, setInk, setPen, useInk, type AutoShape, type EraserMode, type EraserSize } from "./model";
import { useLive } from "./live";
import { shownType } from "./PenPanel";

/** Property-bar button (30 px, design `pb`). */
export function PBtn({ glyph, label, tip, on, onClick, sw, anchor = true }: { glyph?: string; label?: ReactNode; tip: string; on?: boolean; onClick: (e: React.MouseEvent) => void; sw?: string; anchor?: boolean }) {
  return (
    <button type="button" {...(anchor ? { "data-pop-anchor": true } : {})} title={tip} aria-label={tip} aria-pressed={on} onClick={onClick}
      className={cx("flex h-[30px] min-w-[30px] shrink-0 items-center justify-center gap-[5px] rounded-[7px] px-[6px] text-[12px]", on ? "text-accent" : "text-ink hover:bg-surface")}
      style={on ? { background: AC_BG } : undefined}>
      {sw && <span className="size-[18px] rounded-[5px]" style={{ background: sw, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.15)" }} />}
      {glyph && <Glyph name={glyph} size={17} />}
      {label != null && <span className="whitespace-nowrap">{label}</span>}
    </button>
  );
}
const Sep = () => <span aria-hidden className="mx-[3px] h-5 w-px shrink-0 bg-line" />;

const SMOOTH_L: Record<string, string> = { off: "Off", low: "Low", high: "High" };

export function AutoShapeBody() {
  const ink = useInk();
  return (
    <>
      <Seg items={[["hold", t("Hold to snap")], ["always", t("Always")], ["off", t("Off")]]} value={ink.autoShape} onPick={(v: AutoShape) => setInk({ autoShape: v })} />
      <div className="flex flex-col gap-2">
        <BlockHead h={t("Recognises")} />
        <div className="grid grid-cols-5 gap-1">
          {[["ellipse", "Circle"], ["rect", "Rectangle"], ["triangle", "Triangle"], ["line", "Line"], ["arrow", "Arrow"]].map(([g, l]) => (
            <span key={g} className="flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-[8px] border border-line px-1 py-1.5 text-[10.5px]"><Glyph name={g} size={18} />{t(l)}</span>
          ))}
        </div>
        <div className="text-[11.5px] leading-[17px] text-muted">{t("Hold ~0.5 s at the end of a stroke. Runs on device, no AI. An Undo snap chip stays for 3 s.")}</div>
      </div>
    </>
  );
}

export function RulerBody() {
  const ink = useInk();
  const deg = Math.round(((ink.rulerAngle * 180) / Math.PI + 360) % 360);
  return (
    <>
      <div className="h-[52px] rounded-[8px] border border-line" style={{ background: "repeating-linear-gradient(90deg,var(--text) 0 1px,transparent 1px 10px) 0 0/100% 40% no-repeat, repeating-linear-gradient(90deg,var(--text) 0 1px,transparent 1px 50px) 0 0/100% 70% no-repeat, color-mix(in srgb,var(--surface-2) 80%,transparent)" }} />
      <div className="grid gap-1">
        <div className="flex min-h-[34px] items-center gap-2 px-2 text-[12.5px]"><span className="flex-1">{t("Show ruler")}</span><Tog on={ink.ruler} onChange={(v) => setInk({ ruler: v })} label={t("Show ruler")} /></div>
        <div className="flex min-h-[34px] items-center gap-2 px-2 text-[12.5px]"><span className="flex-1">{t("Angle")}</span><span className="text-[11px] text-muted">{deg}°</span></div>
        <div className="flex min-h-[34px] items-center gap-2 px-2 text-[12.5px]"><span className="flex-1">{t("Shift snaps to 15°")}</span><Tog on={ink.rulerSnap} onChange={(v) => setInk({ rulerSnap: v })} label={t("Shift snaps to 15°")} /></div>
        <div className="flex min-h-[34px] items-center gap-2 px-2 text-[12.5px]"><span className="flex-1">{t("Show measurements in cm")}</span><Tog on={ink.rulerCm} onChange={(v) => setInk({ rulerCm: v })} label={t("Show measurements in cm")} /></div>
      </div>
      <div className="text-[11.5px] leading-[17px] text-muted">{t("Drag to move, drag the round handle or use two fingers to rotate. Strokes along the edge come out straight.")}</div>
    </>
  );
}

export function EraserBody() {
  const ink = useInk();
  return (
    <>
      <Seg items={[["stroke", t("Stroke")], ["partial", t("Partial")], ["lasso", t("Lasso")]]} value={ink.eraser} onPick={(v: EraserMode) => setInk({ eraser: v })} />
      <div className="flex flex-col gap-2">
        <BlockHead h={t("Size")} />
        <div className="grid grid-cols-3 gap-1">
          {(["S", "M", "L"] as EraserSize[]).map((s) => (
            <button key={s} type="button" onClick={() => setInk({ eraserSize: s })} className="flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-[8px] border border-line px-1 py-1.5 text-[10.5px] hover:bg-surface-2" style={ink.eraserSize === s ? ON_STYLE : undefined}>
              <span className="box-border shrink-0 rounded-full border border-line bg-muted" style={{ width: ERASER_PX[s] / 1.5, height: ERASER_PX[s] / 1.5 }} />{s}
            </button>
          ))}
        </div>
        <div className="grid gap-1">
          <div className="flex min-h-[34px] items-center gap-2 px-2 text-[12.5px]"><Glyph name="eraser-partial" size={18} /><span className="flex-1">{t("Scratch-out to delete")}</span><Tog on={ink.scratchOut} onChange={(v) => setInk({ scratchOut: v, scratchOutSet: true })} label={t("Scratch-out to delete")} /></div>
          <div className="flex min-h-[34px] items-center gap-2 px-2 text-[12.5px]"><Glyph name="pen-mode" size={18} /><span className="flex-1">{t("Stylus button erases")}</span><Tog on={ink.stylusErases} onChange={(v) => setInk({ stylusErases: v })} label={t("Stylus button erases")} /></div>
        </div>
        <div className="text-[11.5px] leading-[17px] text-muted">{t("Stroke removes whole strokes. Lasso erases everything inside the loop in one undo step.")}</div>
      </div>
    </>
  );
}

type Open = null | "smooth" | "auto" | "ruler" | "eraser";
function PopPanel({ open, onClose, phone }: { open: Open; onClose: () => void; phone?: boolean }) {
  if (!open || open === "smooth") return null;
  const cfg = { auto: ["auto-shape", t("Auto-shape"), 360, <AutoShapeBody key="a" />], ruler: ["ruler", t("Ruler"), 360, <RulerBody key="r" />], eraser: ["eraser-stroke", t("Eraser"), 340, <EraserBody key="e" />] }[open] as [string, string, number, ReactNode];
  return <PanelShell glyph={cfg[0]} title={cfg[1]} onClose={onClose} sheet={phone} portal={phone} className={phone ? "!fixed z-50" : "start-0 top-[calc(100%+8px)]"} style={phone ? undefined : { width: cfg[2] }}>{cfg[3]}</PanelShell>;
}

/** inkExtras (registered): smoothing · pressure | auto-shape · ruler, docked in the pen bar. */
export function InkExtras({ phone }: { phone?: boolean }) {
  const ink = useInk();
  const lv = useLive();
  const [open, setOpen] = useState<Open>(null);
  const type = shownType(lv.tool, ink.current);
  const p = ink.byType[type];
  const tog = (k: Open) => () => setOpen(open === k ? null : k);
  return (
    <span className="relative flex items-center gap-[2px]">
      <span className="relative">
        <PBtn glyph="smoothing" label={t(SMOOTH_L[p.smoothing])} tip={t("Smoothing")} on={open === "smooth"} onClick={tog("smooth")} />
        {open === "smooth" && (
          <PanelShell glyph="smoothing" title={t("Smoothing")} onClose={() => setOpen(null)} sheet={phone} portal={phone} className={phone ? "!fixed z-50" : "start-0 top-[calc(100%+8px)] w-[280px]"}>
            <Seg items={[["off", t("Off")], ["low", t("Low")], ["high", t("High")]]} value={p.smoothing} onPick={(v) => setPen({ smoothing: v }, type)} />
            <Seg items={[["soft", t("Soft")], ["linear", t("Linear")], ["firm", t("Firm")]]} value={p.curve} onPick={(v) => setPen({ curve: v }, type)} />
            <div className="text-[11.5px] leading-[17px] text-muted">{t("Smoothing steadies the line after you lift the pen. The curve changes how hard you press for a thick line.")}</div>
          </PanelShell>
        )}
      </span>
      <PBtn glyph="pressure" label={p.pressure ? t("On") : t("Off")} tip={t("Pressure")} on={p.pressure} onClick={() => setPen({ pressure: !p.pressure }, type)} />
      <Sep />
      <span className="relative"><PBtn glyph="auto-shape" label={t("Auto-shape")} tip={t("Auto-shape")} on={open === "auto"} onClick={tog("auto")} />{open === "auto" && <PopPanel open="auto" onClose={() => setOpen(null)} phone={phone} />}</span>
      <span className="relative"><PBtn glyph="ruler" tip={t("Ruler")} on={ink.ruler} onClick={tog("ruler")} />{open === "ruler" && <PopPanel open="ruler" onClose={() => setOpen(null)} phone={phone} />}</span>
    </span>
  );
}

/** Eraser bar: docked under the toolbar while the eraser is active. */
export function EraserBar({ phone }: { phone: boolean }) {
  const ink = useInk();
  const [open, setOpen] = useState<Open>(null);
  const mode = { stroke: t("Stroke"), partial: t("Partial"), lasso: t("Lasso") }[ink.eraser];
  return (
    <div data-wb-chrome onPointerDown={(e) => e.stopPropagation()}
      className={cx("absolute z-30 flex items-center gap-[2px] whitespace-nowrap rounded-[10px] border border-line bg-surface-2 p-1 shadow-[0_10px_28px_rgba(0,0,0,.3)]", phone ? "inset-x-[10px] bottom-[calc(96px+env(safe-area-inset-bottom))] w-fit" : "")}
      style={phone ? undefined : { left: "50%", top: 64, transform: "translateX(-50%)" }}>
      <span className="relative"><PBtn glyph={ink.eraser === "partial" ? "eraser-partial" : ink.eraser === "lasso" ? "lasso" : "eraser-stroke"} label={mode} tip={t("Eraser")} on={open === "eraser"} onClick={() => setOpen(open === "eraser" ? null : "eraser")} />{open === "eraser" && <PopPanel open="eraser" onClose={() => setOpen(null)} phone={phone} />}</span>
      {(["S", "M", "L"] as EraserSize[]).map((s) => <PBtn key={s} label={s} tip={t("Size {s}", { s })} on={ink.eraserSize === s} onClick={() => setInk({ eraserSize: s })} anchor={false} />)}
      <Sep />
      <PBtn glyph="eraser-partial" label={t("Scratch-out")} tip={t("Scratch-out to delete")} on={ink.scratchOut} onClick={() => setInk({ scratchOut: !getInk().scratchOut, scratchOutSet: true })} anchor={false} />
      <span className="relative"><PBtn glyph="ruler" tip={t("Ruler")} on={ink.ruler} onClick={() => setOpen(open === "ruler" ? null : "ruler")} />{open === "ruler" && <PopPanel open="ruler" onClose={() => setOpen(null)} phone={phone} />}</span>
    </div>
  );
}
