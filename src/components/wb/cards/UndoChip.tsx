// "Converted from whiteboard · Undo conversion" (Lumen 52 · scene "Undo conversion chip"). The new file opens with it at the top;
// Undo deletes the copy and goes back to the original. Mounts itself once into <body> the first time conversions are loaded,
// so any editor that opens a converted copy shows it.
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { getConversionChip, onConversionChip, undoConversion } from "../../../lib/convert/copy";
import { WS_LABEL } from "../../../lib/convert/model";
import { t } from "../../../lib/i18n";
import { setConversionChip } from "../../../lib/convert/copy";
import { useUI } from "../../../lib/store";
import { Glyph } from "../../Glyph";

const CSS = "@keyframes lcv-in{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}.lcv-chip{animation:lcv-in .16s var(--ease)}@media (prefers-reduced-motion:reduce){.lcv-chip{animation:none}}";

function Chip() {
  const chip = useSyncExternalStore(onConversionChip, getConversionChip);
  const ui = useUI();
  if (!chip || ui.noteId !== chip.noteId) return null;
  return (
    <div role="status" className="lcv-chip fixed left-1/2 bottom-[72px] z-[350] flex h-[30px] max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface-2 ps-3 pe-1 text-[11.5px] text-ink shadow-[0_10px_28px_rgba(0,0,0,.3)]">
      <style>{CSS}</style>
      <Glyph name="switch" size={14} className="shrink-0 text-muted" />
      <span dir="auto" className="truncate">{t("Converted from {kind}", { kind: t(WS_LABEL[chip.from]).toLowerCase() })} ·</span>
      <button type="button" onClick={() => void undoConversion(chip)} className="h-6 rounded-full px-2 font-semibold text-accent hover:bg-bg">{t("Undo conversion")}</button>
      <button type="button" aria-label={t("Dismiss")} onClick={() => setConversionChip(null)} className="flex size-6 items-center justify-center rounded-full text-muted hover:bg-bg hover:text-ink"><Glyph name="x" size={13} /></button>
    </div>
  );
}

let mounted = false;
export function mountUndoChip() {
  if (mounted || typeof document === "undefined") return;
  mounted = true;
  const host = document.createElement("div");
  host.setAttribute("data-conversion-chip", "");
  document.body.appendChild(host);
  createRoot(host).render(<Chip />);
}
mountUndoChip();
