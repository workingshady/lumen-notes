// Note card (toolbar N, empty-state "Add a note card", drops): pick a note from the vault; the board gets a live card
// (Lumen 40D–40G: collapsed · card · expanded editor · missing; rendered by ./cards/CardView through Excalidraw's embeddable)
// that links to it ("lumen:note/<id>", opened in Lumen by Whiteboard's onLinkOpen). The .excalidraw file stays open: a plain
// embeddable with a link; the Lumen data sits in customData.lumenCard. noteCardPlain() is the old box-with-a-title.
import "./cards/register";
import { useMemo, useState } from "react";
import type { Note } from "../../../shared/types";
import { t } from "../../lib/i18n";
import { useVaultSelector } from "../../lib/store";
import { Glyph } from "../Glyph";
import { cx } from "../ui";
import { Pop } from "./ui";

import { cardSkeleton } from "../../lib/convert/cards";

/** A live note card at x, y (260 × 140). */
export function noteCardSkeleton(n: Note, x: number, y: number) {
  return cardSkeleton({ kind: "note", noteId: n.id, title: n.title, state: "card" }, x, y);
}

/** The plain box-with-a-title note card (no live content). */
export function noteCardPlain(n: Note, x: number, y: number) {
  return {
    type: "rectangle", x, y, width: 260, height: 96, backgroundColor: "#d0ebff", fillStyle: "solid", strokeColor: "#1e1e1e", roughness: 0, roundness: { type: 3 },
    link: `lumen:note/${n.id}`, customData: { lumenNote: n.id },
    label: { text: n.title, fontSize: 20, fontFamily: 6, strokeColor: "#000000", textAlign: "left", verticalAlign: "middle" },
  };
}

export function NoteCardPicker({ phone, exclude, onPick, onClose }: { phone: boolean; exclude: string; onPick: (n: Note) => void; onClose: () => void }) {
  const notes = useVaultSelector((v) => v.notes);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return notes.filter((n) => n.id !== exclude && !n.deleted && (!s || n.title.toLowerCase().includes(s))).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  }, [notes, q, exclude]);
  return (
    <Pop onClose={onClose} label={t("Add a note card")} className={cx(phone ? "inset-x-[10px] bottom-[calc(96px+env(safe-area-inset-bottom))]" : "left-1/2 top-[64px] w-[340px] -translate-x-1/2")}>
      <label className="flex h-[34px] items-center gap-2 rounded-[8px] border border-line px-2 text-muted focus-within:border-accent">
        <Glyph name="search" size={15} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Find a note…")} dir="auto" className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none"
          onKeyDown={(e) => { if (e.key === "Enter" && list[0]) onPick(list[0]); }} />
      </label>
      <div className="mt-1 flex max-h-[300px] flex-col overflow-y-auto">
        {list.map((n) => (
          <button key={n.id} type="button" role="menuitem" onClick={() => onPick(n)} className="flex h-[34px] items-center gap-2.5 rounded-[8px] px-2 text-start text-[12.5px] hover:bg-surface-2">
            <Glyph name="note-card" size={16} /><span dir="auto" className="min-w-0 flex-1 truncate">{n.title}</span>
          </button>
        ))}
        {!list.length && <div className="px-2 py-3 text-[12px] text-muted">{t("No notes match.")}</div>}
      </div>
    </Pop>
  );
}
