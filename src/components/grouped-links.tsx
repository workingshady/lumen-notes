// Backlinks over 20 group by folder with counts (Lumen 22 "Tags, backlinks, chips"). Each group folds; the biggest
// group opens first. Under the threshold the plain list renders unchanged.
import { useMemo, useState, type ReactNode } from "react";
import type { Note } from "../../shared/types";
import { fmtNum, t } from "../lib/i18n";
import { useVault } from "../lib/store";
import { cx } from "./ui";

export const GROUP_LINKS_ABOVE = 20;

export function FolderGroups({ notes, item, wrap = "flex flex-col gap-2" }: { notes: Note[]; item: (n: Note) => ReactNode; wrap?: string }) {
  const v = useVault();
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; notes: Note[] }>();
    for (const n of notes) {
      const k = n.folderId && v.folderMap.has(n.folderId) ? n.folderId : `s:${n.spaceId}`;
      const name = n.folderId ? v.folderMap.get(n.folderId)?.name : undefined;
      (m.get(k) ?? m.set(k, { name: name ?? v.spaceMap.get(n.spaceId)?.name ?? t("Inbox"), notes: [] }).get(k)!).notes.push(n);
    }
    return [...m.entries()].sort((a, b) => b[1].notes.length - a[1].notes.length);
  }, [notes, v.folderMap, v.spaceMap]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups[0] ? [groups[0][0]] : []));
  if (notes.length <= GROUP_LINKS_ABOVE) return <div className={wrap}>{notes.map(item)}</div>;
  return (
    <div className="flex flex-col gap-1" data-grouped-links>
      {groups.map(([k, g]) => {
        const on = open.has(k);
        return (
          <div key={k} className="flex flex-col gap-1.5">
            <button onClick={() => setOpen((s) => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x; })} aria-expanded={on}
              className="flex h-7 items-center gap-1.5 rounded-[6px] text-start text-[12.5px] text-muted hover:text-ink">
              <span className="w-2.5 text-[9px]">{on ? "▾" : "▸"}</span><span dir="auto" className="min-w-0 flex-1 truncate font-medium">{g.name}</span><span className="text-[11.5px]">{fmtNum(g.notes.length)}</span>
            </button>
            {on && <div className={cx(wrap, "ps-4")}>{g.notes.map(item)}</div>}
          </div>
        );
      })}
    </div>
  );
}
