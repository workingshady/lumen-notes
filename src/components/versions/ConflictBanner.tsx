// Editor header notice for an unresolved sync conflict (design 58E): "Edited on two devices" with Resolve, so the conflict
// is found in the note itself and not only in its History panel.
import { openConflict, useConflicts } from "../../lib/conflicts";
import { t } from "../../lib/i18n";
import { Glyph } from "../Glyph";

export function ConflictBanner({ noteId }: { noteId: string }) {
  const c = useConflicts().find((x) => x.noteId === noteId);
  if (!c) return null;
  return (
    <div role="status" data-conflict-banner className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-2 text-[12.5px]" style={{ background: "color-mix(in srgb,var(--accent) 10%,var(--bg))" }}>
      <Glyph name="merge" size={14} color="var(--accent)" />
      <span dir="auto" className="min-w-0 flex-1 truncate">{t("Edited on two devices · {device} has a different version", { device: c.theirs.device })}</span>
      <button type="button" onClick={() => openConflict(c.id)} className="flex h-7 shrink-0 items-center rounded-[8px] bg-accent px-3 font-semibold text-accent-fg hover:brightness-110">{t("Resolve")}</button>
    </div>
  );
}
