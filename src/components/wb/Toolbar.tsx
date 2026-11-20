// One Lumen toolbar (design 33A): lock, then Navigate · Ink · Shapes · Lines · Content · Media · Structure · More,
// hairline dividers, key numerals, tooltips "Name · key". Pen slot shows the current pen and its colour dot;
// Shapes and Arrow are split buttons that remember the last choice (caret opens the list).
import { useState, type ReactNode } from "react";
import { t } from "../../lib/i18n";
import { Pop, Row, Sep, ToolBtn } from "./ui";
import { LINE_GLYPH, SHAPE_GLYPH, SHAPE_NAME, TOOL_META, type LineKind, type ShapeKind, type ToolId } from "./tools";

export type MoreItem = { glyph: string; label: string; hint?: string; run: () => void; on?: boolean };
export type ArrowType = "sharp" | "round" | "elbow";

export function Toolbar(p: {
  tool: ToolId; shape: ShapeKind; line: LineKind; arrowType: ArrowType; locked: boolean;
  pen: { glyph: string; color: string; label: string };
  onTool: (t: ToolId) => void; onLock: () => void; onShape: (s: ShapeKind) => void; onLine: (l: LineKind, a?: ArrowType) => void;
  more: MoreItem[]; penPopover?: (close: () => void) => ReactNode; shapePopover?: (close: () => void) => ReactNode;
  /** Shapes split-button glyph from the library's remembered shape (W2-B). */
  shapeGlyph?: string;
  /** Stamps / Insert icon popovers (W2-B), opened from More. */
  libPop?: (k: "stamps" | "icons", close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState<null | "pen" | "shape" | "arrow" | "more" | "stamps" | "icons">(null);
  const B = (id: ToolId, extra: Partial<Parameters<typeof ToolBtn>[0]> = {}) => {
    const [g, name, k] = TOOL_META[id];
    return <ToolBtn key={id} glyph={g} tip={t(name)} k={k} on={p.tool === id} onClick={() => p.onTool(id)} {...extra} />;
  };
  const close = () => setOpen(null);
  return (
    <div data-wb-chrome className="absolute left-1/2 top-[12px] z-[31] hidden -translate-x-1/2 items-center gap-[2px] rounded-[12px] border border-line bg-surface p-1 shadow-[0_8px_24px_rgba(0,0,0,.18)] md:flex" onPointerDown={(e) => e.stopPropagation()}>
      {open === "pen" && p.penPopover?.(close)}
      <ToolBtn glyph={p.locked ? "lock" : "unlock"} tip={t("Keep tool active")} on={p.locked} onClick={p.onLock} />
      <Sep />
      {B("select")}{B("lasso")}{B("hand")}
      <Sep />
      <span className="relative" data-pop-anchor>
        {B("pen", { glyph: p.pen.glyph, dot: p.pen.color, split: true, onCaret: () => { p.onTool("pen"); setOpen(open === "pen" ? null : "pen"); } })}
      </span>
      {B("hl")}{B("eraser")}{B("laser")}
      <Sep />
      <span className="relative" data-pop-anchor>
        {B("shape", { glyph: p.shapeGlyph ?? SHAPE_GLYPH[p.shape], tip: t("Shapes") + " · " + t(SHAPE_NAME[p.shape]), split: true, onCaret: () => setOpen(open === "shape" ? null : "shape") })}
        {open === "shape" && p.shapePopover && p.shapePopover(close)}
        {open === "shape" && !p.shapePopover && (
          <Pop onClose={close} className="left-0 top-[44px] w-[200px]" label={t("Shapes")}>
            {(["rectangle", "ellipse", "diamond"] as ShapeKind[]).map((s) => <Row key={s} glyph={SHAPE_GLYPH[s]} label={t(SHAPE_NAME[s])} on={p.shape === s} onClick={() => { p.onShape(s); close(); }} />)}
          </Pop>
        )}
      </span>
      <span className="relative" data-pop-anchor>
        {B("arrow", { glyph: LINE_GLYPH[p.line], split: true, onCaret: () => setOpen(open === "arrow" ? null : "arrow") })}
        {open === "arrow" && (
          <Pop onClose={close} className="left-0 top-[44px] w-[210px]" label={t("Arrow and connector")}>
            <Row glyph="path-straight" label={t("Arrow")} on={p.line === "arrow" && p.arrowType === "sharp"} onClick={() => { p.onLine("arrow", "sharp"); close(); }} />
            <Row glyph="path-curved" label={t("Curved arrow")} on={p.line === "arrow" && p.arrowType === "round"} onClick={() => { p.onLine("arrow", "round"); close(); }} />
            <Row glyph="path-elbow" label={t("Elbow connector")} on={p.line === "arrow" && p.arrowType === "elbow"} onClick={() => { p.onLine("arrow", "elbow"); close(); }} />
            <Row glyph="line" label={t("Line")} on={p.line === "line"} onClick={() => { p.onLine("line"); close(); }} />
          </Pop>
        )}
      </span>
      <Sep />
      {B("text")}{B("sticky")}
      <Sep />
      {B("image")}{B("media")}{B("web")}{B("note")}
      <Sep />
      {B("frame")}
      <Sep />
      <span className="relative" data-pop-anchor>
        <ToolBtn glyph="more" tip={t("Mermaid, code, script, board settings")} on={open === "more"} onClick={() => setOpen(open === "more" ? null : "more")} />
        {open === "more" && (
          <Pop onClose={close} className="end-0 top-[44px] w-[230px]" label={t("More")}>
            {p.more.map((m) => <Row key={m.label} glyph={m.glyph} label={m.label} hint={m.hint} on={m.on} onClick={() => { close(); m.run(); }} />)}
            {p.libPop && <><Row glyph="stamp" label={t("Stamps")} onClick={() => setOpen("stamps")} /><Row glyph="shape-library" label={t("Insert icon")} onClick={() => setOpen("icons")} /></>}
          </Pop>
        )}
        {(open === "stamps" || open === "icons") && p.libPop && <Pop onClose={close} className="end-0 top-[44px]" label={open === "stamps" ? t("Stamps") : t("Insert icon")}>{p.libPop(open, close)}</Pop>}
      </span>
    </div>
  );
}
