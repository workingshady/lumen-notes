import { NewVisualChooser } from "./NewVisualChooser";
import { openNewMenu } from "./NewMenu";
import { NewPathDialog } from "./NewPathDialog";
import { ArrowDownWideNarrow, FileText, Globe, LayoutTemplate, Table2, Link2, Pin, Plus, SquarePen, Star, X } from "lucide-react";
import { PdfLibrary } from "./pdf-library";
import { memo, useEffect, useMemo, useState } from "react";
import type { Note, Space } from "../../shared/types";
import { createNote } from "../lib/actions";
import { importFiles } from "../lib/io";
import { excerpt } from "../lib/parse";
import { noteDerived, openNote, scoped, setUI, toast, useUI, useVault } from "../lib/store";
import { TEMPLATES } from "../lib/templates";
import { dragNote } from "./Sidebar";
import { Button, cx, Empty, Sheet, STATUS_COLOR } from "./ui";
import { PRESETS } from "../lib/canvas";
import { Glyph } from "./Glyph";
import { SpaceIcon } from "./SpaceIcon";
import { PhoneChips, PhoneListHeader, SwipeRow, type PhoneFilter } from "./ws-phone";
import { num, tr, useRtl } from "./ws-dir";
import { filterByQuery, NoteListQueryBar, openSmartEditor, SmartListHeader, smartListFor, SmartRow, useSmartFolders } from "./SmartFolders";
import { EmptyState } from "./EmptyState";
import { indexLabel, LIST_PAGE, useIndexStatus } from "../lib/big-vault";

type Sort = "updated" | "created" | "title";
/** Note type → glyph (Lumen 13 › B1 note types; the glyph name equals the type). Flashcards carry the violet "practice" colour. */
export const TYPE_ICON = (t: Note["type"], size = 16) => <Glyph name={t} size={size} color={t === "flashcards" ? "var(--learn)" : "currentColor"} />;
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

/** Task/roadmap syntax that reads as noise (and as emoji) in a one-line preview: `📅 2026-12-01`, `🛫 …`, `[x]`, `→ [[…]]` arrows stay as text. */
const dropSyntax = (s: string) => s.replace(/\s*[\u{1F4C5}\u{1F6EB}\u{23F3}]️?\s*\d{4}-\d{2}-\d{2}/gu, "").replace(/^\s*[-*+]\s+\[[ xX/>?-]\]\s+/gm, "").replace(/\((?:needs|after|related):[^)]*\)/g, "")
  // round-4 Markdown: status pills keep their text; glyphs, block ids, ::: fences, {.attrs}, [[toc]] and == marks go
  .replace(/:status\[([^\]]*)\](\{[^}]*\})?/g, "$1").replace(/:glyph\[[^\]]*\]/g, "").replace(/\s\^[A-Za-z0-9-]+$/gm, "")
  .replace(/^\s*:{3,}.*$/gm, "").replace(/\{\.[^}]*\}/g, "").replace(/\[\[toc\]\]/gi, "").replace(/==/g, "");
const preview = (n: Note) => (n.type === "canvas" ? "Canvas board" : n.type === "whiteboard" ? "Whiteboard" : noteDerived("listPreview", n, (x) => excerpt(dropSyntax(listBody(x.body.slice(0, 8000))), 160)) || "Empty");

/**
 * Big vaults (design 20b A15): the list renders LIST_PAGE rows at a time; the footer says "Showing 200 of 738" and
 * "Show 200 more" mounts the next page. The page count resets when the list scope changes.
 */
function usePaged<T>(items: T[], resetKey: unknown) {
  const [count, setCount] = useState(LIST_PAGE);
  useEffect(() => setCount(LIST_PAGE), [resetKey]);
  const left = items.length - count;
  const more = left > 0 ? (
    <div className="flex shrink-0 flex-col items-center gap-2 p-3.5 text-[12.5px] text-muted" data-list-more>
      Showing {count} of {items.length}
      <button onClick={() => setCount((c) => c + LIST_PAGE)} className="flex h-8 items-center rounded-[8px] border border-line px-3.5 text-ink hover:bg-surface-2">Show {Math.min(LIST_PAGE, left)} more</button>
    </div>
  ) : null;
  return { shown: left > 0 ? items.slice(0, count) : items, more };
}

/** "Indexing 512 / 738" while the search index catches up (big vaults). */
function IndexingBadge() {
  const label = indexLabel(useIndexStatus());
  return label ? <span className="flex min-w-0 shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-muted" data-indexing title={`${label} · search results fill in as the index catches up`}><span className="size-[7px] shrink-0 rounded-full bg-info" /><span className="max-2xl:sr-only">Indexing </span>{label.replace(/^Indexing /, "")}</span> : null;
}

export function NoteList() {
  const ui = useUI();
  const v = useVault();
  const wide = useWide();
  const rtl = useRtl();
  const [sort, setSort] = useState<Sort>(() => { try { return (localStorage.getItem("lumen.sort") as Sort) || "updated"; } catch { return "updated"; } });
  const [tpl, setTpl] = useState(false);
  const [filter, setFilter] = useState<PhoneFilter>(null);
  const [over, setOver] = useState(false);
  const [pdfs, setPdfs] = useState(false); // PDF library of this space (components/pdf-library.tsx)
  // Smart folders (filter "smart:<id>") + the desktop list search box (search operators, lib/smart.ts).
  const smart = useSmartFolders();
  const [lq, setLq] = useState("");
  useEffect(() => setLq(""), [ui.filter, ui.folderId, ui.tag, ui.spaceId]);
  const smartSel = smartListFor(v, ui, smart);
  const indexing = !!indexLabel(useIndexStatus()); // big vaults: "Indexing 512 / 738" replaces the count while it runs
  const notes = useMemo(() => {
    let list = smartListFor(v, ui, smart)?.notes ?? scoped(v, ui);
    if (wide && lq.trim()) list = filterByQuery(v, list, lq);
    if (!wide && filter === "pinned") list = list.filter((n) => n.pinned);
    if (!wide && filter === "review") list = list.filter((n) => n.status === "review");
    const cmp = sort === "title" ? (a: Note, b: Note) => a.title.localeCompare(b.title, undefined, { numeric: true }) : sort === "created" ? (a: Note, b: Note) => b.createdAt - a.createdAt : (a: Note, b: Note) => b.updatedAt - a.updatedAt;
    return list.sort(cmp); // design: pinned notes keep their place in time order and show a pin
  }, [v, ui, sort, filter, wide, smart, lq]);
  const folder = ui.folderId ? v.folderMap.get(ui.folderId) : null;
  const space = v.spaceMap.get(ui.spaceId);
  const title = smartSel ? smartSel.sf?.name ?? "Smart folder" : ui.filter === "visual" ? "Canvases & whiteboards" : ui.filter === "paths" ? "Learning paths" : ui.filter === "published" ? "Blog posts" : ui.tag ? `#${ui.tag}` : folder ? folder.name : ui.spaceId === "all" ? tr("All notes", rtl) : space?.name ?? tr("Notes", rtl);
  const spaceId = ui.spaceId === "all" ? "inbox" : ui.spaceId;
  const { shown, more } = usePaged(notes, `${ui.spaceId}|${ui.folderId}|${ui.tag}|${ui.filter}|${sort}|${filter}|${lq}`);

  const nextSort: Record<Sort, Sort> = { updated: "created", created: "title", title: "updated" };
  const cycleSort = () => { const s = nextSort[sort]; setSort(s); toast(`Sorted by ${s === "updated" ? "last edited" : s === "created" ? "date created" : "title"}`, undefined, { icon: "check" }); try { localStorage.setItem("lumen.sort", s); } catch { /* ignore */ } };
  const [chooser, setChooser] = useState(false);
  // phone: the tab bar's + on the Visual list opens the "New…" sheet (R4-17 A5) instead of a blank note
  const [pathDlg, setPathDlg] = useState(false);
  useEffect(() => {
    const v = () => setChooser(true), p = () => setPathDlg(true);
    addEventListener("lumen:new-visual", v); addEventListener("lumen:new-path", p);
    return () => { removeEventListener("lumen:new-visual", v); removeEventListener("lumen:new-path", p); };
  }, []);
  const newNote = async (template?: string) => openNote((await createNote({ spaceId, folderId: ui.folderId, tags: ui.tag ? [ui.tag] : [], ...(template ? { template } : ui.filter === "published" ? { template: "post" } : {}) })).id, "edit");
  // Drop .md / .zip files onto the list to import them here (empty state: "or drop .md files here").
  const onDrop = async (e: React.DragEvent) => {
    setOver(false);
    // Dropped PDFs become PDF notes (reader with highlights).
    const pdfFiles = [...e.dataTransfer.files].filter((f) => /\.pdf$/i.test(f.name));
    if (pdfFiles.length) { e.preventDefault(); const { addPdfFile } = await import("../lib/pdf-note"); let last: Note | null = null; for (const f of pdfFiles) last = await addPdfFile(f, spaceId, ui.folderId); if (last) openNote(last.id, "read"); return; }
    const fl = [...e.dataTransfer.files].filter((f) => /\.(md|markdown|txt|zip|canvas|excalidraw)$/i.test(f.name));
    if (!fl.length) return;
    e.preventDefault();
    const r = await importFiles(fl, spaceId, ui.folderId);
    toast(`Imported ${r.notes} note${r.notes === 1 ? "" : "s"}`, undefined, { icon: "check" });
  };
  const empty = !notes.length && (
    smartSel?.sf && !lq.trim() ? (
      // Lumen 21 empty state: smart folder with no matches → edit its search
      <EmptyState glyph="smart-folder" text="Nothing in this smart folder right now." action={{ label: "Edit search", onClick: () => openSmartEditor(smartSel.sf!) }} />
    ) : filter || ui.tag || ui.filter || lq.trim() ? (
      <Empty title={`No ${filter === "pinned" ? "pinned notes" : filter === "review" ? "notes to review" : "notes"} here`} hint={filter ? "Clear the filter to see every note in this folder." : "Nothing matches this filter yet."} action={<Button onClick={() => { setFilter(null); setLq(""); setUI({ tag: null, filter: null }); }}><X size={14} />Clear filter</Button>} />
    ) : (
      <Empty title={`“${folder?.name ?? space?.name ?? "Inbox"}” is empty`} hint="Start with a lesson — it comes with objectives, a summary and a questions section." action={<Button variant="primary" onClick={() => newNote("lesson")}><Plus size={14} />New lesson</Button>} foot="or drop .md files here" />
    )
  );

  if (!wide) {
    return (
      <div className="flex h-full min-h-0 flex-col" onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <PhoneListHeader />
        <PhoneChips filter={filter} setFilter={setFilter} onSort={cycleSort} sortLabel={sort} />
        {pdfs && <PdfLibrary spaceId={spaceId} folderId={ui.folderId} onClose={() => setPdfs(false)} />}
        <div className={cx("flex min-h-0 flex-1 flex-col overflow-y-auto", over && "bg-accent/5", pdfs && "hidden")}>
          {shown.map((n) => (
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
          {more}
          {empty}
          <button onClick={() => setTpl(true)} className="mx-auto my-3 flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-[13px] text-muted active:bg-surface"><LayoutTemplate size={14} />New from template · base</button>
          <button onClick={() => setPdfs(true)} className="mx-auto -mt-2 mb-3 flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-[13px] text-muted active:bg-surface"><FileText size={14} />PDFs</button>
        </div>
        <TemplatePicker open={tpl} onClose={() => setTpl(false)} spaceId={spaceId} folderId={ui.folderId} />
        <NewVisualChooser open={chooser} onClose={() => setChooser(false)} />
        <NewPathDialog open={pathDlg} onClose={() => setPathDlg(false)} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      {smartSel?.sf ? <SmartListHeader sf={smartSel.sf} query={lq} setQuery={setLq} count={notes.length} /> : <>
      <div className="safe-t flex h-12 shrink-0 items-center gap-2 border-b border-line pe-3 ps-4">
        {folder ? <span className="size-2 shrink-0 rounded-[3px]" style={{ background: folder.color ? PRESETS[folder.color] ?? folder.color : "var(--muted)" }} /> : ui.filter ? null : space ? <SpaceIcon space={space} size={15} /> : null}
        <span dir="auto" className="truncate text-[14px] font-semibold">{title}</span>
        {!indexing && <span className="text-muted">{num(notes.length, rtl)}</span>}
        {(ui.tag || folder || ui.filter) && <button aria-label="Clear filter" className="text-muted hover:text-ink" onClick={() => setUI({ tag: null, folderId: null, filter: null })}><X size={13} /></button>}
        {indexing && <IndexingBadge />}
        <span className="flex-1" />
        {ui.filter === "published" && <a href="/blog" target="_blank" rel="noreferrer" className="text-[12px] text-link">View blog ↗</a>}
        <button title={`Sort: ${sort}`} aria-label="Sort" className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink" onClick={cycleSort}><ArrowDownWideNarrow size={15} /></button>
        <button title="New base (database view of notes) or another template" aria-label="New base" className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink" onClick={() => setTpl(true)}><Table2 size={15} /></button>
        <button title="PDFs in this space" aria-label="PDFs" aria-pressed={pdfs} className={cx("flex size-7 items-center justify-center rounded-[6px] hover:bg-surface-2 hover:text-ink", pdfs ? "bg-surface-2 text-ink" : "text-muted")} onClick={() => setPdfs(!pdfs)}><FileText size={15} /></button>
        <button title={ui.filter === "visual" ? "New canvas or whiteboard" : ui.filter === "paths" ? "New learning path" : "New… note, dashboard, base, PDF, canvas, path or template (right-click: from template)"} aria-label="New note" className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink" onClick={(e) => (ui.filter === "visual" ? setChooser(true) : ui.filter === "paths" ? setPathDlg(true) : openNewMenu(e.currentTarget))} onContextMenu={(e) => { e.preventDefault(); setTpl(true); }}><SquarePen size={15} /></button>
      </div>
      <NoteListQueryBar query={lq} setQuery={setLq} count={notes.length} />
      </>}
      {pdfs && <PdfLibrary spaceId={spaceId} folderId={ui.folderId} onClose={() => setPdfs(false)} />}
      <div className={cx("flex min-h-0 flex-1 flex-col overflow-y-auto", !smartSel?.sf && "gap-0.5 p-1.5", over && "bg-accent/5 ring-1 ring-inset ring-accent/40", pdfs && "hidden")}>
        {smartSel?.sf ? shown.map((n) => <SmartRow key={n.id} n={n} active={n.id === ui.noteId} onOpen={() => openNote(n.id)} />)
          : shown.map((n) => <NoteRow key={n.id} n={n} active={n.id === ui.noteId} space={ui.spaceId === "all" ? v.spaceMap.get(n.spaceId) : undefined} />)}
        {more}
        {empty}
      </div>
      <TemplatePicker open={tpl} onClose={() => setTpl(false)} spaceId={spaceId} folderId={ui.folderId} />
      <NewVisualChooser open={chooser} onClose={() => setChooser(false)} />
      <NewPathDialog open={pathDlg} onClose={() => setPathDlg(false)} />
    </div>
  );
}

/** One list row. Memoized on what it shows, so a save re-renders only the edited note's row. */
export const NoteRow = memo(function NoteRow({ n, active, space }: { n: Note; active?: boolean; /** shown when listing all spaces */ space?: Space }) {
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
        {space && <span className="flex min-w-0 items-center gap-1 truncate text-[11px] text-muted"><SpaceIcon space={space} size={12} />{space.name}</span>}
        <span className="flex-1" />
        <span className="text-[11px] text-muted">{listTime(n.updatedAt)}</span>
      </div>
    </button>
  );
}, (a, b) => a.n.id === b.n.id && a.n.updatedAt === b.n.updatedAt && a.n.title === b.n.title && a.active === b.active
  && a.space?.id === b.space?.id && a.space?.name === b.space?.name && a.space?.icon === b.space?.icon && a.space?.color === b.space?.color);

export function TemplatePicker({ open, onClose, spaceId, folderId }: { open: boolean; onClose: () => void; spaceId: string; folderId: string | null }) {
  return (
    <Sheet open={open} onClose={onClose} title="New from template">
      <div className="grid grid-cols-2 gap-2">
        {[...TEMPLATES.filter((t) => t.type === "base" || t.type === "dashboard"), ...TEMPLATES.filter((t) => t.type !== "base" && t.type !== "dashboard")].map((t) => (
          <button key={t.id} onClick={async () => { onClose(); openNote((await createNote({ template: t.id, spaceId, folderId })).id, t.type === "slides" || t.type === "canvas" || t.type === "whiteboard" ? undefined : t.type === "base" || t.type === "dashboard" ? "read" : "edit"); }}
            className="rounded-[10px] border border-line p-3 text-start hover:border-accent">
            <div className="flex items-center gap-2 text-[13.5px] font-semibold"><span className="text-muted">{TYPE_ICON(t.type)}</span>{t.name}</div>
            <div className="text-[12px] text-muted">{t.hint}</div>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
