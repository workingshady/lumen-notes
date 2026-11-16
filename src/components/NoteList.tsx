import { NewVisualChooser } from "./NewVisualChooser";
import { NewPathDialog } from "./NewPathDialog";
import { ArrowDownWideNarrow, Globe, Link2, Pin, Plus, SquarePen, Star, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Note } from "../../shared/types";
import { createNote } from "../lib/actions";
import { importFiles } from "../lib/io";
import { excerpt } from "../lib/parse";
import { openNote, scoped, setUI, toast, useUI, useVault } from "../lib/store";
import { TEMPLATES } from "../lib/templates";
import { dragNote } from "./Sidebar";
import { Button, cx, Empty, Sheet, STATUS_COLOR } from "./ui";
import { PRESETS } from "../lib/canvas";
import { PhoneChips, PhoneListHeader, SwipeRow, type PhoneFilter } from "./ws-phone";
import { num, tr, useRtl } from "./ws-dir";

type Sort = "updated" | "created" | "title";
const TYPE_ICON: Record<Note["type"], string> = { note: "", lesson: "📘", journal: "📓", flashcards: "🧠", slides: "📽️", post: "✍️", canvas: "🧩", whiteboard: "🖍️", roadmap: "🗺️", moc: "🧭", path: "🛤️" };
const useWide = () => { const [w, setW] = useState(() => innerWidth >= 900); useEffect(() => { const f = () => setW(innerWidth >= 900); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return w; };

/** Body without front-matter and the title H1 (the title is shown above the excerpt). */
const TEX: Record<string, string> = { theta: "θ", eta: "η", nabla: "∇", lambda: "λ", alpha: "α", beta: "β", gamma: "γ", delta: "δ", sigma: "σ", Sigma: "Σ", mu: "μ", pi: "π", epsilon: "ε", infty: "∞", cdot: "·", times: "×", leftarrow: "←", rightarrow: "→", to: "→", le: "≤", ge: "≥", partial: "∂", sum: "Σ", approx: "≈" };
/** Inline $math$ → readable text for previews ("$J(\theta)$" → "J(θ)"). */
const texText = (s: string) => s.replace(/\\([A-Za-z]+)/g, (m, w: string) => TEX[w] ?? w).replace(/[{}]/g, "").replace(/\^(\S)/g, "$1").replace(/_(\S)/g, "$1");
const listBody = (b: string) => b.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").replace(/^\s*#\s.*$/m, "").replace(/\$\$[\s\S]*?\$\$/g, " ").replace(/\$([^$\n]+)\$/g, (_m, t: string) => texText(t));

/** List time (design: "12m", "1h", "Yesterday", "Mon", "3 Nov"). */
export function listTime(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const d = new Date(t), today = new Date();
  today.setHours(0, 0, 0, 0);
  if (d >= today) return `${Math.floor(s / 3600)}h`;
  const days = Math.ceil((today.getTime() - d.getTime()) / 86400000);
  if (days <= 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-GB", { weekday: "short" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

const preview = (n: Note) => (n.type === "canvas" ? "Canvas board" : n.type === "whiteboard" ? "Whiteboard" : excerpt(listBody(n.body), 160) || "Empty");

export function NoteList() {
  const ui = useUI();
  const v = useVault();
  const wide = useWide();
  const rtl = useRtl();
  const [sort, setSort] = useState<Sort>(() => { try { return (localStorage.getItem("lumen.sort") as Sort) || "updated"; } catch { return "updated"; } });
  const [tpl, setTpl] = useState(false);
  const [filter, setFilter] = useState<PhoneFilter>(null);
  const [over, setOver] = useState(false);
  const notes = useMemo(() => {
    let list = scoped(v, ui);
    if (!wide && filter === "pinned") list = list.filter((n) => n.pinned);
    if (!wide && filter === "review") list = list.filter((n) => n.status === "review");
    const cmp = sort === "title" ? (a: Note, b: Note) => a.title.localeCompare(b.title, undefined, { numeric: true }) : sort === "created" ? (a: Note, b: Note) => b.createdAt - a.createdAt : (a: Note, b: Note) => b.updatedAt - a.updatedAt;
    return list.sort(cmp); // design: pinned notes keep their place in time order and show a pin
  }, [v, ui, sort, filter, wide]);
  const folder = ui.folderId ? v.folderMap.get(ui.folderId) : null;
  const space = v.spaceMap.get(ui.spaceId);
  const title = ui.filter === "visual" ? "Canvases & whiteboards" : ui.filter === "paths" ? "Learning paths" : ui.filter === "published" ? "Blog posts" : ui.tag ? `#${ui.tag}` : folder ? folder.name : ui.spaceId === "all" ? tr("All notes", rtl) : space?.name ?? tr("Notes", rtl);
  const spaceId = ui.spaceId === "all" ? "inbox" : ui.spaceId;

  const nextSort: Record<Sort, Sort> = { updated: "created", created: "title", title: "updated" };
  const cycleSort = () => { const s = nextSort[sort]; setSort(s); toast(`Sorted by ${s === "updated" ? "last edited" : s === "created" ? "date created" : "title"}`, undefined, { icon: "check" }); try { localStorage.setItem("lumen.sort", s); } catch { /* ignore */ } };
  const [chooser, setChooser] = useState(false);
  const [pathDlg, setPathDlg] = useState(false);
  const newNote = async (template?: string) => openNote((await createNote({ spaceId, folderId: ui.folderId, tags: ui.tag ? [ui.tag] : [], ...(template ? { template } : ui.filter === "published" ? { template: "post" } : {}) })).id, "edit");
  // Drop .md / .zip files onto the list to import them here (empty state: "or drop .md files here").
  const onDrop = async (e: React.DragEvent) => {
    setOver(false);
    const fl = [...e.dataTransfer.files].filter((f) => /\.(md|markdown|txt|zip|canvas|excalidraw)$/i.test(f.name));
    if (!fl.length) return;
    e.preventDefault();
    const r = await importFiles(fl, spaceId, ui.folderId);
    toast(`Imported ${r.notes} note${r.notes === 1 ? "" : "s"}`, undefined, { icon: "check" });
  };
  const empty = !notes.length && (
    filter || ui.tag || ui.filter ? (
      <Empty title={`No ${filter === "pinned" ? "pinned notes" : filter === "review" ? "notes to review" : "notes"} here`} hint={filter ? "Clear the filter to see every note in this folder." : "Nothing matches this filter yet."} action={<Button onClick={() => { setFilter(null); setUI({ tag: null, filter: null }); }}><X size={14} />Clear filter</Button>} />
    ) : (
      <Empty title={`“${folder?.name ?? space?.name ?? "Inbox"}” is empty`} hint="Start with a lesson — it comes with objectives, a summary and a questions section." action={<Button variant="primary" onClick={() => newNote("lesson")}><Plus size={14} />New lesson</Button>} foot="or drop .md files here" />
    )
  );

  if (!wide) {
    return (
      <div className="flex h-full min-h-0 flex-col" onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <PhoneListHeader />
        <PhoneChips filter={filter} setFilter={setFilter} onSort={cycleSort} sortLabel={sort} />
        <div className={cx("flex min-h-0 flex-1 flex-col overflow-y-auto", over && "bg-accent/5")}>
          {notes.map((n) => (
            <SwipeRow key={n.id} n={n}>
              <button onClick={() => openNote(n.id)} className="flex w-full flex-col gap-1.5 px-4 py-3.5 text-start active:bg-surface">
                <div className="flex w-full items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: n.status ? STATUS_COLOR[n.status] : "var(--muted)" }} />
                  <span dir="auto" className="min-w-0 flex-1 truncate text-[15px] font-semibold">{n.title || "Untitled"}</span>
                  {n.shareId ? <Link2 size={13} className="text-info" /> : null}
                  {n.published ? <Globe size={13} className="text-ok" /> : null}
                  {n.pinned ? <Pin size={13} className="text-muted" /> : null}
                  <span className="text-[12px] text-muted">{listTime(n.updatedAt)}</span>
                </div>
                <div dir="auto" className="line-clamp-2 h-10 text-[13.5px] leading-5 text-muted">{preview(n)}</div>
              </button>
            </SwipeRow>
          ))}
          {empty}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <div className="safe-t flex h-12 shrink-0 items-center gap-2 border-b border-line pe-3 ps-4">
        {folder ? <span className="size-2 shrink-0 rounded-[3px]" style={{ background: folder.color ? PRESETS[folder.color] ?? folder.color : "var(--muted)" }} /> : ui.filter ? null : space ? <span className="text-[14px]">{space.icon}</span> : null}
        <span dir="auto" className="truncate text-[14px] font-semibold">{title}</span>
        <span className="text-muted">{num(notes.length, rtl)}</span>
        {(ui.tag || folder || ui.filter) && <button aria-label="Clear filter" className="text-muted hover:text-ink" onClick={() => setUI({ tag: null, folderId: null, filter: null })}><X size={13} /></button>}
        <span className="flex-1" />
        {ui.filter === "published" && <a href="/blog" target="_blank" rel="noreferrer" className="text-[12px] text-link">View blog ↗</a>}
        <button title={`Sort: ${sort}`} aria-label="Sort" className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink" onClick={cycleSort}><ArrowDownWideNarrow size={15} /></button>
        <button title={ui.filter === "visual" ? "New canvas or whiteboard" : ui.filter === "paths" ? "New learning path" : "New note (right-click: from template)"} aria-label="New note" className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink" onClick={() => (ui.filter === "visual" ? setChooser(true) : ui.filter === "paths" ? setPathDlg(true) : newNote())} onContextMenu={(e) => { e.preventDefault(); setTpl(true); }}><SquarePen size={15} /></button>
      </div>
      <div className={cx("flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5", over && "bg-accent/5 ring-1 ring-inset ring-accent/40")}>
        {notes.map((n) => <NoteRow key={n.id} n={n} active={n.id === ui.noteId} />)}
        {empty}
      </div>
      <TemplatePicker open={tpl} onClose={() => setTpl(false)} spaceId={spaceId} folderId={ui.folderId} />
      <NewVisualChooser open={chooser} onClose={() => setChooser(false)} />
      <NewPathDialog open={pathDlg} onClose={() => setPathDlg(false)} />
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
      className={cx("flex w-full flex-col gap-[5px] rounded-[10px] px-3 py-2.5 text-start transition-colors", active ? "bg-surface-2" : "hover:bg-surface-2")}
    >
      <div className="flex w-full items-center gap-2">
        <span className="size-[7px] shrink-0 rounded-full" style={{ background: n.status ? STATUS_COLOR[n.status] : "var(--muted)" }} />
        <span dir="auto" className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{n.title || "Untitled"}</span>
        {n.shareId ? <Link2 size={12} className="text-info" /> : null}
        {n.published ? <Globe size={12} className="text-ok" /> : null}
        {n.favorite ? <Star size={12} className="text-warn" /> : null}
        {n.pinned ? <Pin size={12} className="text-muted" /> : null}
      </div>
      <div dir="auto" className="line-clamp-2 h-9 w-full text-[12.5px] leading-[18px] text-muted">{preview(n)}</div>
      <div className="flex w-full items-center gap-1">
        {n.tags.slice(0, 2).map((t) => <span key={t} className="rounded-[6px] bg-surface-2 px-1.5 text-[11px] leading-[18px] text-muted">#{t}</span>)}
        {ui.spaceId === "all" && space && <span className="truncate text-[11px] text-muted">{space.icon} {space.name}</span>}
        <span className="flex-1" />
        <span className="text-[11px] text-muted">{listTime(n.updatedAt)}</span>
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
            className="rounded-[10px] border border-line p-3 text-start hover:border-accent">
            <div className="text-[13.5px] font-semibold">{TYPE_ICON[t.type]} {t.name}</div>
            <div className="text-[12px] text-muted">{t.hint}</div>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
