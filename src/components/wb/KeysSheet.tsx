import { useEffect } from "react";
import { t, tk } from "../../lib/i18n";
import { Glyph } from "../Glyph";
import { TOOL_META, type ToolId } from "./tools";

/** Lumen's keyboard sheet for the whiteboard / Board ("?"). Same look as the canvas and architecture sheets; lists Lumen's
 *  tool keys (the design's 1–0 map, not Excalidraw's), then the edit keys Excalidraw handles underneath. */
const TOOLS: ToolId[] = ["select", "lasso", "hand", "pen", "hl", "eraser", "laser", "shape", "arrow", "text", "sticky", "image", "note", "frame"];

export function WbKeysSheet({ mod, onClose }: { mod: string; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); onClose(); } };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  }, [onClose]);
  const edit: [string, string][] = [
    [tk("Undo"), `${mod} Z`],
    [tk("Redo"), `${mod} Shift Z · ${mod} Y`],
    [tk("Copy / cut / paste"), `${mod} C · X · V`],
    [tk("Duplicate"), `${mod} D`],
    [tk("Select all"), `${mod} A`],
    [tk("Delete selected"), "Delete · Backspace"],
    [tk("Group · ungroup"), `${mod} G · ${mod} Shift G`],
    [tk("Bring to front"), `${mod} Shift ]`],
    [tk("Send to back"), `${mod} Shift [`],
    [tk("Fit the board"), "Shift 1"],
    [tk("Zoom to selection"), "Shift 2"],
    [tk("Layers"), "L"],
    [tk("Present"), "Alt P"],
    [tk("Export"), `${mod} Shift E`],
    [tk("Move the open note to Trash"), "Shift Delete"],
    [tk("Deselect · close"), "Esc"],
    [tk("Keyboard shortcuts"), "?"],
  ];
  const row = (k: string, keys: string, g?: string) => (
    <div key={k} className="flex min-h-[28px] items-center gap-3">
      {g && <Glyph name={g as never} size={14} className="text-muted" />}
      <span className="flex-1">{t(k)}</span>
      <kbd dir="ltr" className="rounded-[6px] border border-line bg-bg px-1.5 py-px font-sans text-[11.5px] text-muted">{keys}</kbd>
    </div>
  );
  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div role="dialog" aria-label={t("Whiteboard shortcuts")} className="fixed left-1/2 top-16 z-[61] flex max-h-[calc(100vh-96px)] w-[420px] max-w-[calc(100vw-24px)] -translate-x-1/2 flex-col gap-0.5 overflow-y-auto rounded-[14px] border border-line bg-surface-2 p-4 text-[13px] text-ink shadow-[0_14px_34px_rgba(0,0,0,.35)] fade-in">
        <div className="flex items-center pb-2">
          <b className="flex-1 text-[14px] font-[650]">{t("Whiteboard shortcuts")}</b>
          <button aria-label={t("Close")} title={t("Close")} onClick={onClose} className="flex size-7 items-center justify-center rounded-[7px] text-muted hover:bg-bg hover:text-ink"><Glyph name="x" size={14} /></button>
        </div>
        <span className="pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t("Tools")}</span>
        {TOOLS.map((id) => { const [g, name, key] = TOOL_META[id]; return row(name, key, g); })}
        <span className="pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t("Edit")}</span>
        {edit.map(([k, keys]) => row(k, keys))}
      </div>
    </>
  );
}
