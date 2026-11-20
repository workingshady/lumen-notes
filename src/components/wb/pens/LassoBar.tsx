// Lasso action bar (design 34F desktop · 34G/44I phone; WBStudio PROPS.lasso): Move · Recolour · Pen · Duplicate ·
// Copy as image · Group | Shapes · Text · Math · Mermaid. Phone: above the dock, wraps to two rows.
import { useState, type ReactNode } from "react";
import { t } from "../../../lib/i18n";
import { Glyph } from "../../Glyph";
import { cx } from "../../ui";
import { ON_STYLE, PanelShell } from "../panel";
import { PBtn } from "./InkBars";
import { PEN_TYPES, type PenType } from "./model";

export type LassoAction = "move" | "duplicate" | "copy-image" | "group" | "shapes" | "text" | "math" | "mermaid";

export function LassoBar({ pos, phone, color, busy, onAction, onPen, recolour }: {
  pos: { x: number; y: number } | null; phone: boolean; color: string; busy?: LassoAction | null;
  onAction: (a: LassoAction) => void; onPen: (p: PenType) => void;
  /** Colour popover (rendered under the Recolour button). */
  recolour: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState<null | "colour" | "pen">(null);
  const close = () => setOpen(null);
  const Sep = () => <span aria-hidden className="mx-[3px] h-5 w-px shrink-0 bg-line" />;
  return (
    <div data-wb-chrome onPointerDown={(e) => e.stopPropagation()}
      className={cx("absolute z-30 flex items-center gap-[2px] whitespace-nowrap rounded-[10px] border border-line bg-surface-2 p-1 shadow-[0_10px_28px_rgba(0,0,0,.3)]", phone ? "start-[10px] bottom-[calc(108px+env(safe-area-inset-bottom))] max-w-[min(392px,calc(100%-20px))] flex-wrap" : "flex-nowrap")}
      style={phone ? undefined : pos ? { left: pos.x, top: pos.y } : { left: "50%", top: 64, transform: "translateX(-50%)" }}>
      <PBtn glyph="select" label={t("Move")} tip={t("Move: drag the selection")} onClick={() => onAction("move")} anchor={false} />
      <span className="relative">
        <PBtn sw={color} label={t("Recolour")} tip={t("Recolour")} on={open === "colour"} onClick={() => setOpen(open === "colour" ? null : "colour")} />
        {open === "colour" && <div className={phone ? "" : "absolute start-0 top-[calc(100%+8px)] z-40"}>{recolour(close)}</div>}
      </span>
      <span className="relative">
        <PBtn glyph="pen-fountain" label={t("Pen")} tip={t("Change pen")} on={open === "pen"} onClick={() => setOpen(open === "pen" ? null : "pen")} />
        {open === "pen" && (
          <PanelShell glyph="pen-fountain" title={t("Change pen")} onClose={close} sheet={phone} portal={phone} className={phone ? "!fixed z-50" : "start-0 top-[calc(100%+8px)] w-[260px]"}>
            <div className="grid gap-[2px]">
              {PEN_TYPES.filter((p) => p.type !== "laser").map((p) => (
                <button key={p.type} type="button" onClick={() => { onPen(p.type); close(); }} className="flex min-h-[34px] items-center gap-2 rounded-[8px] border border-transparent px-2 text-start text-[12.5px] hover:bg-surface-2"><Glyph name={p.glyph} size={18} />{t(p.label)}</button>
              ))}
            </div>
          </PanelShell>
        )}
      </span>
      <PBtn glyph="duplicate" tip={t("Duplicate")} onClick={() => onAction("duplicate")} anchor={false} />
      <PBtn glyph="copy-image" tip={t("Copy as image")} onClick={() => onAction("copy-image")} anchor={false} />
      <PBtn glyph="group" tip={t("Group")} onClick={() => onAction("group")} anchor={false} />
      {phone ? <span className="basis-full" /> : <Sep />}
      {([["shapes", "to-shapes", "Shapes", "Convert to shapes (on device)"], ["text", "to-text", "Text", "Convert to text"], ["math", "to-math", "Math", "Convert to math"], ["mermaid", "to-mermaid", "Mermaid", "Convert to Mermaid"]] as [LassoAction, string, string, string][]).map(([a, g, l, tip]) => (
        <button key={a} type="button" title={t(tip)} aria-label={t(tip)} onClick={() => onAction(a)}
          className={cx("flex h-[30px] min-w-[30px] shrink-0 items-center justify-center gap-[5px] rounded-[7px] border border-transparent px-[6px] text-[12px] hover:bg-surface", busy === a ? "text-accent" : "text-ink")} style={busy === a ? { ...ON_STYLE, borderColor: "transparent" } : undefined}>
          <Glyph name={g} size={17} /><span>{t(l)}</span>
        </button>
      ))}
    </div>
  );
}
