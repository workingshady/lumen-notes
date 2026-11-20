import { NewVisualChooser } from "./NewVisualChooser";
import { DateScrubber } from "./date-scrubber"; // Lumen 22: month headers + date scrubber on long lists
import { openNewMenu } from "./NewMenu";
import { NewPathDialog } from "./NewPathDialog";
import { FileText, Globe, LayoutTemplate, Link2, Pin, Plus, X } from "lucide-react";
import { PdfLibrary } from "./pdf-library";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
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
import { filterByQuery, openSmartEditor, scopeQuery, SmartListHeader, smartListFor, SmartRow, useSmartFolders } from "./SmartFolders";
import { BulkBar, DeskRow, Dropdown, FilterBox, FilterEmpty, GroupHeader, groupRows, useTagColors, type Group } from "./note-list-desk";
import { EmptyState } from "./EmptyState";
import { indexLabel, LIST_PAGE, useIndexStatus } from "../lib/big-vault";
import { fmtDate, t, useLang } from "../lib/i18n";

type Sort = "updated" | "created" | "title";
/** Note type → glyph (Lumen 13 › B1 note types; the glyph name equals the type). Flashcards carry the violet "practice" colour. */
export const TYPE_ICON = (ty: Note["type"], size = 16) => <Glyph name={ty} size={size} color={ty === "flashcards" ? "var(--learn)" : "currentColor"} />;
const useWide = () => { const [w, setW] = useState(() => innerWidth >= 900); useEffect(() => { const f = () => setW(innerWidth >= 900); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return w; };

/** Body without front-matter and the title H1 (the title is shown above the excerpt). */
const TEX: Record<string, string> = { theta: "θ", eta: "η", nabla: "∇", lambda: "λ", alpha: "α", beta: "β", gamma: "γ", delta: "δ", sigma: "σ", Sigma: "Σ", mu: "μ", pi: "π", epsilon: "ε", infty: "∞", cdot: "·", times: "×", leftarrow: "←", rightarrow: "→", to: "→", le: "≤", ge: "≥", partial: "∂", sum: "Σ", approx: "≈" };
/** Inline $math$ → readable text for previews ("$J(\theta)$" → "J(θ)"). */
const texText = (s: string) => s.replace(/\\([A-Za-z]+)/g, (m, w: string) => TEX[w] ?? w).replace(/[{}]/g, "").replace(/\^(\S)/g, "$1").replace(/_(\S)/g, "$1");
const listBody = (b: string) => b.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").replace(/^\s*#\s.*$/m, "").replace(/\$\$[\s\S]*?\$\$/g, " ").replace(/\$([^$\n]+)\$/g, (_m, s: string) => texText(s));

/** List time (design: "12m", "1h", "Yesterday", "Mon", "3 Nov"). */
export function listTime(ts: number) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return t("now");
  if (s < 3600) return t("{n}m", { n: Math.floor(s / 60) });
  const d = new Date(ts), today = new Date();
  today.setHours(0, 0, 0, 0);
  if (d >= today) return t("{n}h", { n: Math.floor(s / 3600) });
  const days = Math.ceil((today.getTime() - d.getTime()) / 86400000);
  if (days <= 1) return t("Yesterday");
  if (days < 7) return fmtDate(d, { weekday: "short" });
  return fmtDate(d, { day: "numeric", month: "short", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

/** Task/roadmap syntax that reads as noise (and as emoji) in a one-line preview: `📅 2026-12-01`, `🛫 …`, `[x]`, `→ [[…]]` arrows stay as text. */
const dropSyntax = (s: string) => s.replace(/\s*[\u{1F4C5}\u{1F6EB}\u{23F3}]️?\s*\d{4}-\d{2}-\d{2}/gu, "").replace(/^\s*[-*+]\s+\[[ xX/>?-]\]\s+/gm, "").replace(/\((?:needs|after|related):[^)]*\)/g, "")
  // round-4 Markdown: status pills keep their text; glyphs, block ids, ::: fences, {.attrs}, [[toc]] and == marks go
  .replace(/:status\[([^\]]*)\](\{[^}]*\})?/g, "$1").replace(/:glyph\[[^\]]*\]/g, "").replace(/\s\^[A-Za-z0-9-]+$/gm, "")
  .replace(/^\s*:{3,}.*$/gm, "").replace(/\{\.[^}]*\}/g, "").replace(/\[\[toc\]\]/gi, "").replace(/==/g, "");
const preview = (n: Note) => (n.type === "canvas" ? t("Canvas board") : n.type === "whiteboard" ? t("Whiteboard") : noteDerived("listPreview", n, (x) => excerpt(dropSyntax(listBody(x.body.slice(0, 8000))), 160)) || t("Empty"));

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
      {t("Showing {count} of {total}", { count, total: items.length })}
      <button onClick={() => setCount((c) => c + LIST_PAGE)} className="flex h-8 items-center rounded-[8px] border border-line px-3.5 text-ink hover:bg-surface-2">{t("Show {n} more", { n: Math.min(LIST_PAGE, left) })}</button>
    </div>
  ) : null;
  return { shown: left > 0 ? items.slice(0, count) : items, more };
}

/** "Indexing 512 / 738" while the search index catches up (big vaults). */
function IndexingBadge() {
  const s = useIndexStatus();
  if (!indexLabel(s)) return null;
  const label = t("Indexing {done} / {total}", { done: s.done, total: s.total });
  return <span className="flex min-w-0 shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-muted" data-indexing title={t("{label} · search results fill in as the index catches up", { label })}><span className="size-[7px] shrink-0 rounded-full bg-info" /><span className="max-2xl:sr-only">{t("Indexing")} </span><span dir="ltr">{t("{done} / {total}", { done: s.done, total: s.total })}</span></span>;
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
  // Desktop filter box (R6-30D/J): finished operators and words become chips; `draft` is what's still being typed.
  const [chips, setChips] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const lq = [...chips, draft].join(" ").trim();
  const setLq = (q: string) => { setChips([]); setDraft(q); };
  const keepFilter = useRef(false); // "Search all spaces" keeps the chips while the scope changes
  useEffect(() => { if (keepFilter.current) { keepFilter.current = false; return; } setChips([]); setDraft(""); }, [ui.filter, ui.folderId, ui.spaceId]);
  const [group, setGroup] = useState<Group>(() => { try { return (localStorage.getItem("lumen.group") as Group) || "date"; } catch { return "date"; } });
  // Multi-select (R6-30L): Select / Done in the header, click toggles, shift-click selects a range, Esc leaves.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const exitSelect = () => { setSelecting(false); setSelected(new Set()); anchor.current = null; };
  useEffect(exitSelect, [ui.filter, ui.folderId, ui.spaceId, ui.tag]);
  const smartSel = smartListFor(v, ui, smart);
  const indexing = !!indexLabel(useIndexStatus()); // big vaults: "Indexing 512 / 738" replaces the count while it runs
  // list scope: only the ui fields that pick the notes (opening a note or switching modes must not rebuild the list)
  const { spaceId: uiSpace, folderId: uiFolder, tag: uiTag, filter: uiFilter } = ui;
  const notes = useMemo(() => {
    const u = { spaceId: uiSpace, folderId: uiFolder, tag: uiTag, filter: uiFilter };
    let list = smartListFor(v, u, smart)?.notes ?? scoped(v, u);
    if (wide && lq.trim()) list = filterByQuery(v, list, lq);
    if (!wide && filter === "pinned") list = list.filter((n) => n.pinned);
    if (!wide && filter === "review") list = list.filter((n) => n.status === "review");
    const cmp = sort === "title" ? (a: Note, b: Note) => a.title.localeCompare(b.title, undefined, { numeric: true }) : sort === "created" ? (a: Note, b: Note) => b.createdAt - a.createdAt : (a: Note, b: Note) => b.updatedAt - a.updatedAt;
    return list.sort(cmp); // design: pinned notes keep their place in time order and show a pin
  }, [v, uiSpace, uiFolder, uiTag, uiFilter, sort, filter, wide, smart, lq]);
  const folder = ui.folderId ? v.folderMap.get(ui.folderId) : null;
  const space = v.spaceMap.get(ui.spaceId);
  const title = smartSel ? smartSel.sf?.name ?? t("Smart folder") : ui.filter === "visual" ? t("Canvases & whiteboards") : ui.filter === "paths" ? t("Learning paths") : ui.filter === "published" ? t("Blog posts") : folder ? folder.name : ui.spaceId === "all" ? (ui.tag && !wide ? `#${ui.tag}` : tr("All notes", rtl)) : space?.name ?? tr("Notes", rtl);
  const spaceId = ui.spaceId === "all" ? "inbox" : ui.spaceId;
  const { shown, more } = usePaged(notes, `${ui.spaceId}|${ui.folderId}|${ui.tag}|${ui.filter}|${sort}|${filter}|${lq}`);
  const colors = useTagColors(v);
  // desktop rows in display order: Pinned first, then the chosen grouping
  const rows = useMemo(() => (smartSel?.sf ? shown : groupRows(shown, group, (n) => (sort === "created" ? n.createdAt : n.updatedAt), notes.length)), [shown, group, sort, smartSel?.sf, notes.length]);
  const order = useMemo(() => rows.filter((r): r is Note => "id" in r), [rows]);
  const selIds = useMemo(() => [...selected].filter((id) => v.byId.get(id) && !v.byId.get(id)!.deleted), [selected, v]);
  useEffect(() => {
    if (!selecting) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,.cm-editor,[contenteditable=true]")) return;
      if (e.key === "Escape") exitSelect();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); setSelected(new Set(order.map((n) => n.id))); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [selecting, order]);
  const onRow = (e: React.MouseEvent, n: Note) => {
    if (!selecting && !e.shiftKey) return openNote(n.id);
    e.preventDefault();
    if (!selecting) setSelecting(true);
    const from = anchor.current ?? (selecting ? null : ui.noteId);
    if (e.shiftKey && from) {
      const a = order.findIndex((x) => x.id === from), b = order.findIndex((x) => x.id === n.id);
      if (a >= 0 && b >= 0) { const [lo, hi] = a < b ? [a, b] : [b, a]; setSelected((s) => new Set([...s, ...order.slice(lo, hi + 1).map((x) => x.id)])); anchor.current = n.id; return; }
    }
    setSelected((s) => { const x = new Set(s); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; });
    anchor.current = n.id;
  };
  // rows are memoized and keep their first handlers: route clicks through a ref so they always see current state
  const onRowRef = useRef(onRow);
  onRowRef.current = onRow;
  const setGroupSaved = (g: Group) => { setGroup(g); try { localStorage.setItem("lumen.group", g); } catch { /* ignore */ } };
  const setSortSaved = (s: Sort) => { setSort(s); try { localStorage.setItem("lumen.sort", s); } catch { /* ignore */ } };
  const hasPdfs = useMemo(() => wide && scoped(v, { spaceId: uiSpace, folderId: uiFolder, tag: null, filter: uiFilter }).some((n) => n.type === "pdf"), [wide, v, uiSpace, uiFolder, uiFilter]);
  const filterChips = [
    ...(ui.tag ? [{ text: `tag:#${ui.tag}`, onRemove: () => setUI({ tag: null }) }] : []),
    ...chips.map((c, i) => ({ text: c, onRemove: () => setChips((cs) => cs.filter((_, j) => j !== i)) })),
  ];
  const filterText = [...filterChips.map((c) => c.text), draft.trim()].filter(Boolean).join(" ");

  const nextSort: Record<Sort, Sort> = { updated: "created", created: "title", title: "updated" };
  const cycleSort = () => { const s = nextSort[sort]; setSort(s); toast(s === "updated" ? t("Sorted by last edited") : s === "created" ? t("Sorted by date created") : t("Sorted by title"), undefined, { icon: "check" }); try { localStorage.setItem("lumen.sort", s); } catch { /* ignore */ } };
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
    toast(t("Imported {n} note|Imported {n} notes", { n: r.notes }), undefined, { icon: "check" });
  };
  const empty = !notes.length && (
    smartSel?.sf && !lq.trim() ? (
      // Lumen 21 empty state: smart folder with no matches → edit its search
      <EmptyState glyph="smart-folder" text={t("Nothing in this smart folder right now.")} action={{ label: t("Edit search"), onClick: () => openSmartEditor(smartSel.sf!) }} />
    ) : filter || ui.tag || ui.filter || lq.trim() ? (
      <Empty title={filter === "pinned" ? t("No pinned notes here") : filter === "review" ? t("No notes to review here") : t("No notes here")} hint={filter ? t("Clear the filter to see every note in this folder.") : t("Nothing matches this filter yet.")} action={<Button onClick={() => { setFilter(null); setLq(""); setUI({ tag: null, filter: null }); }}><X size={14} />{t("Clear filter")}</Button>} />
    ) : (
      <Empty title={t("“{name}” is empty", { name: folder?.name ?? space?.name ?? t("Inbox") })} hint={t("Start with a lesson — it comes with objectives, a summary and a questions section.")} action={<Button variant="primary" onClick={() => newNote("lesson")}><Plus size={14} />{t("New lesson")}</Button>} foot={t("or drop .md files here")} />
    )
  );

  if (!wide) {
    return (
      <div className="flex h-full min-h-0 flex-col" onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <PhoneListHeader />
        <PhoneChips filter={filter} setFilter={setFilter} onSort={cycleSort} sortLabel={sort} />
        {pdfs && <PdfLibrary spaceId={spaceId} folderId={ui.folderId} onClose={() => setPdfs(false)} />}
        <div className={cx("flex min-h-0 flex-1 flex-col overflow-y-auto", over && "bg-accent/5", pdfs && "hidden")}>
          {shown.map((n) => <PhoneRow key={n.id} n={n} time={listTime(n.updatedAt)} />)}
          {more}
          {empty}
          <button onClick={() => setTpl(true)} className="mx-auto my-3 flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-[13px] text-muted active:bg-surface"><LayoutTemplate size={14} />{t("New from template · base")}</button>
          <button onClick={() => setPdfs(true)} className="mx-auto -mt-2 mb-3 flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-[13px] text-muted active:bg-surface"><FileText size={14} />{t("PDFs")}</button>
        </div>
        <TemplatePicker open={tpl} onClose={() => setTpl(false)} spaceId={spaceId} folderId={ui.folderId} />
        <NewVisualChooser open={chooser} onClose={() => setChooser(false)} />
        <NewPathDialog open={pathDlg} onClose={() => setPathDlg(false)} />
      </div>
    );
  }

  // R6-30J/K: a filter that matches nothing names the filter and the place, with Clear filter + Search all spaces
  const deskEmpty = !notes.length && !smartSel?.sf && !ui.filter && filterText ? (
    <FilterEmpty filter={filterText} where={folder?.name ?? (ui.spaceId === "all" ? t("all spaces") : space?.name ?? t("Inbox"))}
      onClear={() => { setChips([]); setDraft(""); setUI({ tag: null }); }}
      onAllSpaces={ui.spaceId !== "all" || ui.folderId ? () => { keepFilter.current = true; setUI({ spaceId: "all", folderId: null }); } : undefined} />
  ) : empty;
  const headIcon = folder ? <span className="size-2 shrink-0 rounded-[3px]" style={{ background: folder.color ? PRESETS[folder.color] ?? folder.color : "var(--muted)" }} />
    : ui.filter ? null : ui.spaceId === "all" && ui.tag ? <Glyph name="tag" size={16} color="var(--learn)" /> : space ? <SpaceIcon space={space} size={16} /> : null;
  return (
    <div className="flex h-full min-h-0 flex-col text-[13px] leading-[1.35]" onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      {smartSel?.sf ? <SmartListHeader sf={smartSel.sf} query={lq} setQuery={setLq} count={notes.length} /> : (
        <div className="group/head flex shrink-0 flex-col gap-2 border-b border-line px-3 pb-2 pt-[max(12px,env(safe-area-inset-top))] leading-[1.35]" data-list-head>
          <div className="flex h-[26px] items-center gap-2">
            {headIcon}
            <span dir="auto" className="min-w-0 flex-1 truncate font-[650]">{title}</span>
            {(folder || ui.filter) && <button aria-label={t("Clear filter")} title={t("Back to the whole space")} className="text-muted hover:text-ink" onClick={() => setUI({ folderId: null, filter: null })}><X size={13} /></button>}
            {indexing ? <IndexingBadge /> : <span className="text-[12px] text-muted">{num(notes.length, rtl)}</span>}
            {ui.filter === "published" && <a href="/blog" target="_blank" rel="noreferrer" className="text-[12px] text-link">{t("View blog")}↗</a>}
            {(hasPdfs || pdfs) && <button title={t("PDFs in this space")} aria-label={t("PDFs")} aria-pressed={pdfs} className={cx("flex size-[26px] items-center justify-center rounded-[6px] border border-line hover:bg-surface-2 hover:text-ink", pdfs ? "bg-surface-2 text-ink" : "text-muted")} onClick={() => setPdfs(!pdfs)}><FileText size={14} /></button>}
            <button title={ui.filter === "visual" ? t("New canvas or whiteboard") : ui.filter === "paths" ? t("New learning path") : t("New… note, dashboard, base, PDF, canvas, path or template (right-click: from template)")} aria-label={t("New note")}
              className="flex size-[26px] items-center justify-center rounded-[6px] border border-line hover:bg-surface-2" onClick={(e) => (ui.filter === "visual" ? setChooser(true) : ui.filter === "paths" ? setPathDlg(true) : openNewMenu(e.currentTarget))} onContextMenu={(e) => { e.preventDefault(); setTpl(true); }}><Glyph name="plus" size={14} /></button>
          </div>
          <FilterBox chips={filterChips} draft={draft} setDraft={setDraft} addChips={(toks) => setChips((cs) => [...cs, ...toks.filter((x) => !cs.includes(x) && x !== `tag:#${ui.tag}`)])}
            popChip={() => (chips.length ? setChips((cs) => cs.slice(0, -1)) : setUI({ tag: null }))}
            onSaveSmart={() => openSmartEditor({ query: [scopeQuery(v, ui), [...chips, draft.trim()].filter(Boolean).join(" ")].filter(Boolean).join(" ") })} />
          <div className="flex h-4 items-center gap-2 text-[12px] text-muted">
            <Dropdown label={t("Sort:")} value={sort} onChange={setSortSaved} options={[{ value: "updated", label: t("Updated") }, { value: "created", label: t("Created") }, { value: "title", label: t("Title") }]} />
            <span>·</span>
            <Dropdown label={t("Group:")} value={group} onChange={setGroupSaved} options={[{ value: "date", label: t("Date") }, { value: "status", label: t("Status") }, { value: "none", label: t("None") }]} />
            <span className="flex-1" />
            <button onClick={() => (selecting ? exitSelect() : setSelecting(true))} aria-pressed={selecting} title={selecting ? t("Leave select mode (Esc)") : t("Select notes (or shift-click a note)")}
              className={cx("font-semibold", selecting ? "text-accent" : "text-muted opacity-0 hover:text-ink focus-visible:opacity-100 group-hover/head:opacity-100")}>{selecting ? t("Done") : t("Select")}</button>
          </div>
        </div>
      )}
      {pdfs && <PdfLibrary spaceId={spaceId} folderId={ui.folderId} onClose={() => setPdfs(false)} />}
      <div className={cx("flex min-h-0 flex-1 flex-col overflow-y-auto", over && "bg-accent/5 ring-1 ring-inset ring-accent/40", pdfs && "hidden")} data-note-list>
        {!smartSel?.sf && group === "date" && <DateScrubber notes={notes} timeOf={(n) => (sort === "created" ? n.createdAt : n.updatedAt)} />}
        {smartSel?.sf ? shown.map((n) => <SmartRow key={n.id} n={n} active={n.id === ui.noteId} onOpen={() => openNote(n.id)} />)
          : rows.map((r, i) => ("id" in r
            ? <DeskRow key={r.id} n={r} active={r.id === ui.noteId} selecting={selecting} selected={selected.has(r.id)} colors={colors} preview={preview(r)} time={listTime(sort === "created" ? r.createdAt : r.updatedAt)}
                space={ui.spaceId === "all" ? v.spaceMap.get(r.spaceId) : undefined} onClick={(e) => onRowRef.current(e, r)} onDragStart={(e) => dragNote(e, r.id)} />
            : <GroupHeader key={"h" + i + r.h} h={r.h} pin={r.pin} />))}
        {more}
        {deskEmpty}
      </div>
      {selecting && <BulkBar ids={selIds} onDone={exitSelect} />}
      <TemplatePicker open={tpl} onClose={() => setTpl(false)} spaceId={spaceId} folderId={ui.folderId} />
      <NewVisualChooser open={chooser} onClose={() => setChooser(false)} />
      <NewPathDialog open={pathDlg} onClose={() => setPathDlg(false)} />
    </div>
  );
}

/** Phone list row. Memoized like DeskRow: a save re-renders only the edited note's row. */
const PhoneRow = memo(function PhoneRow({ n, time }: { n: Note; time: string }) {
  useLang();
  return (
    <SwipeRow n={n}>
      <button onClick={() => openNote(n.id)} className="flex w-full flex-col gap-1.5 px-4 py-3.5 text-start active:bg-surface">
        <div className="flex w-full items-center gap-2">
          <span className="size-2 shrink-0 rounded-full" style={{ background: n.status ? STATUS_COLOR[n.status] : "var(--muted)" }} />
          <span dir="auto" className="min-w-0 flex-1 truncate text-[15px] font-semibold">{n.title || t("Untitled")}</span>
          {n.shareId ? <Link2 size={13} className="text-info" /> : null}
          {n.published ? <Globe size={13} className="text-ok" /> : null}
          {n.pinned ? <Pin size={13} className="text-muted" /> : null}
          <span className="text-[12px] text-muted">{time}</span>
        </div>
        <div dir="auto" className="line-clamp-2 h-10 text-[13.5px] leading-5 text-muted">{preview(n)}</div>
      </button>
    </SwipeRow>
  );
}, (a, b) => a.n.id === b.n.id && a.n.updatedAt === b.n.updatedAt && a.time === b.time);

export function TemplatePicker({ open, onClose, spaceId, folderId }: { open: boolean; onClose: () => void; spaceId: string; folderId: string | null }) {
  return (
    <Sheet open={open} onClose={onClose} title={t("New from template")}>
      <div className="grid grid-cols-2 gap-2">
        {[...TEMPLATES.filter((tp) => tp.type === "base" || tp.type === "dashboard"), ...TEMPLATES.filter((tp) => tp.type !== "base" && tp.type !== "dashboard")].map((tp) => (
          <button key={tp.id} onClick={async () => { onClose(); openNote((await createNote({ template: tp.id, spaceId, folderId })).id, tp.type === "slides" || tp.type === "canvas" || tp.type === "whiteboard" ? undefined : tp.type === "base" || tp.type === "dashboard" ? "read" : "edit"); }}
            className="rounded-[10px] border border-line p-3 text-start hover:border-accent">
            <div className="flex items-center gap-2 text-[13.5px] font-semibold"><span className="text-muted">{TYPE_ICON(tp.type)}</span>{t(tp.name)}</div>
            <div className="text-[12px] text-muted">{t(tp.hint)}</div>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
