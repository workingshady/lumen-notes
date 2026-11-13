import { ArrowDownUp, FilePlus2, LayoutTemplate, Pin, Star, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Note } from "../../shared/types";
import { createNote } from "../lib/actions";
import { excerpt } from "../lib/parse";
import { openNote, scoped, setUI, useUI, useVault } from "../lib/store";
import { TEMPLATES } from "../lib/templates";
import { dragNote } from "./Sidebar";
import { cx, Empty, IconButton, relTime, Sheet, StatusDot } from "./ui";

type Sort = "updated" | "created" | "title";
const TYPE_ICON: Record<Note["type"], string> = { note: "", lesson: "📘", journal: "📓", flashcards: "🧠", slides: "📽️", post: "✍️", canvas: "🧩", whiteboard: "🖍️", roadmap: "🗺️", moc: "🧭" };

export function NoteList() {
  const ui = useUI();
  const v = useVault();
  const [sort, setSort] = useState<Sort>(() => { try { return (localStorage.getItem("lumen.sort") as Sort) || "updated"; } catch { return "updated"; } });
  const [tpl, setTpl] = useState(false);
  const notes = useMemo(() => {
    const list = scoped(v, ui);
    const cmp = sort === "title" ? (a: Note, b: Note) => a.title.localeCompare(b.title, undefined, { numeric: true }) : sort === "created" ? (a: Note, b: Note) => b.createdAt - a.createdAt : (a: Note, b: Note) => b.updatedAt - a.updatedAt;
    return list.sort((a, b) => b.pinned - a.pinned || cmp(a, b));
  }, [v, ui, sort]);
  const folder = ui.folderId ? v.folderMap.get(ui.folderId) : null;
  const space = v.spaceMap.get(ui.spaceId);
  const title = ui.tag ? `#${ui.tag}` : folder ? folder.name : ui.spaceId === "all" ? "All notes" : space?.name ?? "Notes";
  const spaceId = ui.spaceId === "all" ? "inbox" : ui.spaceId;

  const nextSort: Record<Sort, Sort> = { updated: "created", created: "title", title: "updated" };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="safe-t flex items-center gap-1 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 truncate font-semibold">{title}
            {(ui.tag || folder) && <IconButton label="Clear filter" className="!size-6" onClick={() => setUI({ tag: null, folderId: null })}><X size={13} /></IconButton>}
          </div>
          <div className="text-[11.5px] text-muted">{notes.length} notes · sorted by {sort}</div>
        </div>
        <IconButton label={`Sort: ${sort}`} onClick={() => { const s = nextSort[sort]; setSort(s); try { localStorage.setItem("lumen.sort", s); } catch { /* ignore */ } }}><ArrowDownUp size={16} /></IconButton>
        <IconButton label="New from template" onClick={() => setTpl(true)}><LayoutTemplate size={16} /></IconButton>
        <IconButton label="New note" className="!text-accent" onClick={async () => openNote((await createNote({ spaceId, folderId: ui.folderId, tags: ui.tag ? [ui.tag] : [] })).id, "edit")}><FilePlus2 size={17} /></IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {notes.length ? notes.map((n) => <NoteRow key={n.id} n={n} active={n.id === ui.noteId} />) : (
          <Empty icon={<FilePlus2 size={30} />} title="No notes here yet" hint="Create one, pick a template, or import Markdown files." />
        )}
      </div>
      <TemplatePicker open={tpl} onClose={() => setTpl(false)} spaceId={spaceId} folderId={ui.folderId} />
    </div>
  );
}

export function NoteRow({ n, active }: { n: Note; active?: boolean }) {
  const v = useVault();
  const space = v.spaceMap.get(n.spaceId);
  const ui = useUI();
  return (
    <button
      draggable
      onDragStart={(e) => dragNote(e, n.id)}
      onClick={() => openNote(n.id)}
      className={cx("mb-0.5 block w-full rounded-[10px] px-3 py-2.5 text-left transition-colors", active ? "bg-surface-2 ring-1 ring-accent/40" : "hover:bg-surface-2")}
    >
      <div className="flex items-center gap-1.5">
        <StatusDot status={n.status} />
        {TYPE_ICON[n.type] && <span className="text-[13px]">{TYPE_ICON[n.type]}</span>}
        <span dir="auto" className="min-w-0 flex-1 truncate text-[14px] font-medium">{n.title || "Untitled"}</span>
        {n.pinned ? <Pin size={12} className="text-accent" /> : null}
        {n.favorite ? <Star size={12} className="text-warn" /> : null}
      </div>
      <div dir="auto" className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{n.type === "canvas" ? "Canvas" : n.type === "whiteboard" ? "Whiteboard" : excerpt(n.body, 140) || "Empty"}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
        <span>{relTime(n.updatedAt)}</span>
        {ui.spaceId === "all" && space && <span className="truncate">· {space.icon} {space.name}</span>}
        {n.tags.slice(0, 3).map((t) => <span key={t} className="rounded-full bg-surface-2 px-1.5">#{t}</span>)}
      </div>
    </button>
  );
}

export function TemplatePicker({ open, onClose, spaceId, folderId }: { open: boolean; onClose: () => void; spaceId: string; folderId: string | null }) {
  return (
    <Sheet open={open} onClose={onClose} title="New from template">
      <div className="grid grid-cols-2 gap-2">
        {TEMPLATES.map((t) => (
          <button key={t.id} onClick={async () => { onClose(); openNote((await createNote({ template: t.id, spaceId, folderId })).id, t.type === "slides" || t.type === "canvas" || t.type === "whiteboard" ? undefined : "edit"); }}
            className="rounded-[10px] border border-line p-3 text-left hover:border-accent">
            <div className="text-[13.5px] font-semibold">{TYPE_ICON[t.type]} {t.name}</div>
            <div className="text-[12px] text-muted">{t.hint}</div>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
