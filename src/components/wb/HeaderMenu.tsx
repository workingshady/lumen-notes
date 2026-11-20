// Board header ⋯ menu (design 33D desktop popover, 44G phone sheet): Board settings, Layers, Frames, Present, Export,
// Convert, History, Handwriting search, Zen. Panels that belong to later packages open through onOpen(panel).
import { useEffect, useState } from "react";
import { t } from "../../lib/i18n";
import { Glyph } from "../Glyph";
import { cx } from "../ui";
import { IS_MAC } from "../../lib/mod-label";
import { Row } from "./ui";

export type MenuItem = { id: string; glyph: string; label: string; hint?: string; run: () => void; on?: boolean };

/** Design copy uses Mac signs (⌥P, ⇧⌘E); on Windows / Linux show Ctrl / Alt / Shift like the key sheets do. */
const platHint = (h?: string) => {
  if (!h || IS_MAC) return h;
  const mods = [h.includes("⌘") && "Ctrl", h.includes("⌥") && "Alt", h.includes("⇧") && "Shift"].filter(Boolean) as string[];
  const rest = h.replace(/[⌘⌥⇧]/g, "");
  return mods.length ? [...mods, rest].join(" ") : h;
};

export function HeaderMenu({ items, noteItems, phone, onClose }: { items: MenuItem[]; noteItems: MenuItem[]; phone: boolean; onClose: () => void }) {
  const [sub, setSub] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  }, [onClose]);
  const list = sub ? noteItems : items;
  const head = (
    <div className="flex items-center gap-2 border-b border-line px-[14px] pb-2.5 pt-3">
      {sub ? <button type="button" aria-label={t("Back")} onClick={() => setSub(false)} className="-ms-1 flex size-6 items-center justify-center rounded-[6px] text-muted hover:text-ink"><Glyph name="chevron-right" size={15} style={{ transform: "scaleX(-1)" }} /></button>
        : <Glyph name="board" size={16} color="var(--muted)" />}
      <span className="flex-1 text-[13.5px] font-semibold">{sub ? t("Note") : t("Board")}</span>
      <button type="button" aria-label={t("Close")} onClick={onClose} className="flex size-[26px] items-center justify-center text-muted hover:text-ink"><Glyph name="x" size={15} /></button>
    </div>
  );
  const rows = (
    <div className={cx("flex flex-col p-[12px_14px_14px]", phone ? "gap-0" : "gap-0")}>
      {list.map((m) => <Row key={m.id} glyph={m.glyph} label={m.label} hint={platHint(m.hint)} on={m.on} danger={m.id === "trash" || m.id === "delete"} onClick={() => { if (m.id === "note") { setSub(true); return; } onClose(); m.run(); }} />)}
    </div>
  );
  if (phone) return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div data-wb-chrome role="menu" className="sheet-in safe-b fixed inset-x-0 bottom-0 z-50 max-h-[74%] overflow-y-auto rounded-t-[20px] border border-line bg-surface shadow-[0_18px_48px_rgba(0,0,0,.32)] [&_[role=menuitem]]:h-[34px]">
        <div className="flex justify-center pt-2"><span className="h-1 w-9 rounded-[2px] bg-line" /></div>
        {head}{rows}
      </div>
    </>
  );
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div data-wb-chrome role="menu" className="absolute end-[14px] top-[52px] z-50 w-[260px] overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_18px_48px_rgba(0,0,0,.32)] fade-in">
        {head}{rows}
      </div>
    </>
  );
}
