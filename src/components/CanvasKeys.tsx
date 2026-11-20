import { X } from "lucide-react";
import { t, tk } from "../lib/i18n";

/** Keyboard shortcuts sheet for the canvas ("?" on the board). `mod` = "Ctrl" or the Command key sign. */
export function CanvasKeys({ mod, onClose }: { mod: string; onClose: () => void }) {
  const rows: [string, string][] = [
    [tk("Undo"), `${mod} Z`],
    [tk("Redo"), `${mod} Shift Z · ${mod} Y`],
    [tk("Copy / cut / paste cards"), `${mod} C · X · V`],
    [tk("Duplicate cards"), `${mod} D`],
    [tk("Select all"), `${mod} A`],
    [tk("Delete selected"), "Delete · Backspace"],
    [tk("Nudge (bigger step with Shift)"), "← ↑ → ↓"],
    [tk("Lock / unlock"), `${mod} Shift L`],
    [tk("Bring to front"), `${mod} Shift ]`],
    [tk("Send to back"), `${mod} Shift [`],
    [tk("Fit the board"), "Shift 1"],
    [tk("Zoom to selection"), "Shift 2"],
    [tk("Tidy up"), "Shift T"],
    [tk("Script console"), `${mod} \``],
    [tk("New text card"), t("Double-click")],
    [tk("Select several"), t("Shift click · Shift drag")],
    [tk("Keyboard shortcuts"), "?"],
  ];
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div role="dialog" aria-label={t("Canvas shortcuts")} className="absolute left-1/2 top-16 z-40 flex max-h-[calc(100%-80px)] w-[400px] max-w-[calc(100%-24px)] -translate-x-1/2 flex-col gap-0.5 overflow-y-auto rounded-[14px] border border-line bg-surface-2 p-4 text-[13px] shadow-[0_14px_34px_rgba(0,0,0,.35)] fade-in">
        <div className="flex items-center pb-2">
          <b className="flex-1 text-[14px] font-[650]">{t("Canvas shortcuts")}</b>
          <button aria-label={t("Close")} onClick={onClose} className="flex size-7 items-center justify-center rounded-[7px] text-muted hover:bg-bg hover:text-ink"><X size={14} /></button>
        </div>
        {rows.map(([k, keys]) => (
          <div key={k} className="flex min-h-[28px] items-center gap-3">
            <span className="flex-1">{t(k)}</span>
            <kbd dir="ltr" className="rounded-[6px] border border-line bg-bg px-1.5 py-px font-sans text-[11.5px] text-muted">{keys}</kbd>
          </div>
        ))}
      </div>
    </>
  );
}
