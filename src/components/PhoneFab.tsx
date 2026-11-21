// Lumen 01 3C: phone "+" button. Tap = new note; long-press (or swipe up) = speed dial: Daily note · Voice note · Flashcard.
import { useRef, useState } from "react";
import { createNote, dailyNote } from "../lib/actions";
import { t } from "../lib/i18n";
import { openNote, useUI } from "../lib/store";
import { editorBridge } from "./Editor";
import { Glyph } from "./Glyph";

export function PhoneFab() {
  const ui = useUI();
  const [open, setOpen] = useState(false);
  const timer = useRef(0);
  const long = useRef(false);
  const space = ui.spaceId === "all" ? "inbox" : ui.spaceId;
  const run = async (k: "daily" | "voice" | "card") => {
    setOpen(false);
    if (k === "daily") { openNote((await dailyNote(space)).id, "edit"); return; }
    if (k === "card") { openNote((await createNote({ template: "flashcards", spaceId: space, folderId: ui.folderId })).id, "edit"); return; }
    openNote((await createNote({ spaceId: space, folderId: ui.folderId })).id, "edit");
    setTimeout(() => void editorBridge.voice?.(), 700);
  };
  const items = [
    { k: "daily" as const, g: "journal", l: t("Daily note") },
    { k: "voice" as const, g: "voice", l: t("Voice note") },
    { k: "card" as const, g: "flashcards", l: t("Flashcard") },
  ];
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/30" onClick={() => setOpen(false)} />}
      <div className="absolute bottom-4 end-4 z-40 flex flex-col items-end gap-2.5">
        {open && items.map((i) => (
          <button key={i.k} onClick={() => void run(i.k)} className="fade-in flex h-12 items-center gap-2.5 rounded-full border border-line bg-surface-2 pe-4 ps-3 text-[14px] font-medium shadow-lg">
            <Glyph name={i.g} size={18} />{i.l}
          </button>
        ))}
        <button aria-label={t("New note")} aria-haspopup="menu" aria-expanded={open}
          className="flex size-14 select-none items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-[0_8px_24px_rgba(0,0,0,.35)] active:scale-95"
          onPointerDown={() => { long.current = false; timer.current = window.setTimeout(() => { long.current = true; navigator.vibrate?.(15); setOpen(true); }, 450); }}
          onPointerUp={() => clearTimeout(timer.current)} onPointerLeave={() => clearTimeout(timer.current)} onPointerCancel={() => clearTimeout(timer.current)}
          onContextMenu={(e) => e.preventDefault()}
          onClick={async () => { if (long.current) { long.current = false; return; } if (open) { setOpen(false); return; } openNote((await createNote({ spaceId: space, folderId: ui.folderId })).id, "edit"); }}>
          <Glyph name="plus" size={24} color="var(--accent-fg)" />
        </button>
      </div>
    </>
  );
}
