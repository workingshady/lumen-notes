import { LayoutTemplate, Waypoints, Share2, Link2, Layers, ArrowLeft, BookOpen, Columns2, Copy, Download, FileCode2, Globe, ImagePlus, Info, ListTree, Map as MapIcon, Maximize2, Mic, MoreHorizontal, EllipsisVertical, Network, PanelRight, PanelLeft, PenLine, Pin, Presentation, Printer, Star, Trash2 } from "lucide-react";
import { LongRead } from "./long-read"; // Lumen 22: long notes (progress, folding, Top)
import { FolderGroups } from "./grouped-links"; // Lumen 22: backlinks over 20 group by folder
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { canvasToSkeleton } from "../lib/whiteboard";
import { parseCanvas } from "../lib/canvas";
import type { Note } from "../../shared/types";
import { createNote, duplicateNote, restoreNote, snapshot, trashNote, updateNote } from "../lib/actions";
import { exportNoteHtml, exportNoteMd, printNote } from "../lib/io";
import { back, getUI, openNote, setUI, toast, useUI, useVault, type Mode } from "../lib/store";
import { canGoBack } from "../lib/nav-history";
import { NavButtons } from "./nav-buttons";
import { openInsertGallery } from "./InsertGallery";
import { Glyph } from "./Glyph";
import { openTutorForNote } from "./TutorSession"; // ⋯ › Tutor (round 5)
import { SpaceIcon } from "./SpaceIcon";
import { canvasFromNote } from "../lib/canvasFromNote";
import { firstH1, outline, setFrontMatter, splitFrontMatter } from "../lib/parse";
import { ShareSheet } from "./ShareSheet";
import { Skeleton } from "./Skeleton";
import { Editor, editorBridge, scrollEditorToLine } from "./Editor";
import { UndoRedo } from "./editor-tools";
import { Preview } from "./Preview";
import { ReviewSession } from "./Review";
import { RightPanel } from "./RightPanel";
import { Slides } from "./Slides";
import { StudyTimer } from "./Timer";
import { Button, cx, Segmented, Sheet, STATUS_COLOR } from "./ui";
import { HeaderSync, PhoneSyncLine, useSaving } from "./ws-sync";
import { getSettings } from "../lib/settings";
import { DirMenu, UiDirRow } from "./ws-bidi";
import { ReadMenu, ReadRows } from "./ws-read";
import { DiagramFile } from "./DiagramFile";
import { DiagramsTab } from "./DiagramsTab";
import { LinksTab, MediaTab, NoteTabBar } from "./NoteTabs"; // note tabs Diagrams · Media · Links (round 6)
import { toggleAssistantPanel, toggleAssistantRail } from "./Assistant"; // in-note Assistant (round 6)
import { FocusView } from "./FocusView";
import { tr, useRtl } from "./ws-dir";
import { fmtNum, fmtRelative, t, tk, tx } from "../lib/i18n";
import type { NoteType, Status } from "../../shared/types";

const Whiteboard = lazy(() => import("./Whiteboard"));
const CanvasEditor = lazy(() => import("./CanvasEditor").then((m) => ({ default: m.CanvasEditor })));
const PathView = lazy(() => import("../views/PathView").then((m) => ({ default: m.PathView })));
const RoadmapView = lazy(() => import("../views/RoadmapView").then((m) => ({ default: m.RoadmapView })));
const GraphView = lazy(() => import("../views/GraphView").then((m) => ({ default: m.GraphView })));
const BaseView = lazy(() => import("../views/BaseView").then((m) => ({ default: m.BaseView })));
const PdfReader = lazy(() => import("./PdfReader").then((m) => ({ default: m.PdfReader })));
const DashboardView = lazy(() => import("../views/DashboardView").then((m) => ({ default: m.DashboardView })));

const useWide = () => { const [w, setW] = useState(() => innerWidth >= 900); useEffect(() => { const f = () => setW(innerWidth >= 900); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return w; };
const AR = /[؀-ۿ]/;

/** Page width (front-matter `width:`): fixed follows Aa › Line width; wide ≈ Confluence "wide"; full = the whole pane. */
export type PageWidth = "fixed" | "wide" | "full";
const PAGE_W: Record<PageWidth, string> = { fixed: "", wide: "920px", full: "none" };
const pageWidthOf = (body: string): PageWidth => { const w = splitFrontMatter(body).data.width; return w === "wide" || w === "full" ? w : "fixed"; };
const fixedW = () => { const m = getSettings().measure; return m === 0 ? "none" : m === 60 ? "600px" : m === 80 ? "820px" : "680px"; };

// Layout / panel inserts come from the slash-command catalog (lib/slash.ts).
const LATIN = /[A-Za-z]{3}/;
const STATUS_L: Record<Status, string> = { todo: tk("To do"), learning: tk("Learning"), review: tk("Review"), mastered: tk("Mastered") };
const TYPE_L: Record<NoteType, string> = { note: tk("Note"), lesson: tk("Lesson"), journal: tk("Journal"), flashcards: tk("Flashcards"), slides: tk("Slides"), post: tk("Post"), canvas: tk("Canvas"), whiteboard: tk("Whiteboard"), roadmap: tk("Roadmap"), moc: tk("MOC"), path: tk("Path"), diagram: tk("Diagram"), base: tk("Base"), pdf: tk("PDF"), dashboard: tk("Dashboard") };

export function NoteView({ note }: { note: Note }) {
  const ui = useUI();
  const v = useVault();
  const rtl = useRtl();
  const saving = useSaving();
  const [menu, setMenu] = useState(false);
  const [publish, setPublish] = useState(false);
  const [localGraph, setLocalGraph] = useState(false);
  const [rmEdit, setRmEdit] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const wide = useWide();
  const isBoard = note.type === "whiteboard";
  const isCanvas = note.type === "canvas" || isBoard;
  const isPath = note.type === "path";
  const isRoadmap = note.type === "roadmap" || isPath;
  const isDiagram = note.type === "diagram";
  const ownBar = note.type === "pdf" || note.type === "base" || note.type === "dashboard"; // readers with their own bar
  const diagramCount = useMemo(() => (note.type === "canvas" || note.type === "whiteboard" || note.type === "diagram" ? 0 : (note.body.match(/^\s*(`{3,}|~{3,})\s*mermaid/gim) ?? []).length), [note.body, note.type]);
  // A .mermaid file has three views (Source / Split / Preview); other modes show the preview.
  const mode: Mode = isDiagram && !["edit", "split", "read"].includes(ui.mode) ? "read" : ui.mode;

  // New untitled note → focus title.
  useEffect(() => { if (note.title === "Untitled" && !note.body) titleRef.current?.select(); }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      // Focus handles its own Esc (it may ask to save highlights first).
      if (e.key === "Escape" && (mode === "slides" || mode === "review")) setUI({ mode: wide ? "split" : "edit" });
      // Esc closes the side panel / Assistant, unless a sheet or menu is on top or the editor has focus
      else if (e.key === "Escape" && !e.defaultPrevented && getUI().panel && !document.querySelector(".sheet-in, [role=menu]") && !(document.activeElement as HTMLElement | null)?.closest(".cm-editor, [contenteditable=true]")) setUI({ panel: null });
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void snapshot(note, "Manual save").then(() => toast(t("Version saved"))); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j" && !e.shiftKey) { e.preventDefault(); toggleAssistantRail(getUI().panel === "ai"); }
      if ((e.ctrlKey || e.metaKey) && e.key === "e") { e.preventDefault(); if (isRoadmap) setRmEdit((x) => !x); else setUI({ mode: mode === "edit" ? "read" : "edit" }); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [mode, note, wide, isRoadmap]);

  // One-row header (list hidden) falls back to two rows when the breadcrumb gets clipped (many mode tabs, e.g.
  // Diagrams, cut "Writing studio" to "Writin"); `tight` keeps the pane width where that happened so it can return
  // to one row when wider again.
  const hdrRef = useRef<HTMLElement>(null);
  const crumbRef = useRef<HTMLDivElement>(null);
  const [tight, setTight] = useState(0);
  const [crumbsOpen, setCrumbsOpen] = useState(false);
  useEffect(() => { setTight(0); setCrumbsOpen(false); }, [note.id]);
  useEffect(() => {
    const h = hdrRef.current;
    if (!h || !wide) return;
    const check = () => {
      const w = h.clientWidth;
      if (!tight) {
        const c = crumbRef.current;
        const clipped = !!c && (c.clientWidth < 90 || [...c.querySelectorAll<HTMLElement>("button, span[dir]")].some((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1));
        if (clipped) setTight(w);
      }
      else if (w > tight + 80) setTight(0);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(h);
    return () => ro.disconnect();
  });

  if (note.deleted) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Trash2 size={32} className="text-muted" />
        <div className="font-semibold">{tx("“{title}” is in the trash", { title: <span dir="auto">{note.title}</span> })}</div>
        <Button variant="primary" onClick={() => restoreNote(note.id)}>{t("Restore")}</Button>
      </div>
    );
  }
  if (mode === "slides" && !isCanvas && !ownBar) return <Slides note={note} onExit={() => setUI({ mode: "read" })} />;

  const space = v.spaceMap.get(note.spaceId);
  const crumbs: { id: string; name: string }[] = [];
  const seen = new Set<string>(); // guard against a parent cycle in synced folder data
  for (let f = note.folderId ? v.folderMap.get(note.folderId) : undefined; f && !seen.has(f.id); f = f.parentId ? v.folderMap.get(f.parentId) : undefined) { seen.add(f.id); crumbs.unshift({ id: f.id, name: f.name }); }

  const modes = isDiagram ? [
    { value: "edit" as Mode, icon: <PenLine size={13} />, l: t("Source"), title: t("Mermaid source (Ctrl+E)") },
    { value: "split" as Mode, icon: <Columns2 size={13} />, l: t("Split"), title: t("Source + preview") },
    { value: "read" as Mode, icon: <BookOpen size={13} />, l: t("Preview"), title: t("Diagram preview") },
  ] : [
    { value: "edit" as Mode, icon: <PenLine size={13} />, l: t("Edit"), title: t("Edit (Ctrl+E)") },
    { value: "split" as Mode, icon: <Columns2 size={13} />, l: t("Split"), title: t("Split: editor + preview") },
    { value: "read" as Mode, icon: <BookOpen size={13} />, l: t("Read"), title: t("Read") },
    { value: "focus" as Mode, icon: <Maximize2 size={13} />, l: t("Focus"), title: t("Focus (Esc to leave)") },
    { value: "slides" as Mode, icon: <Presentation size={13} />, l: t("Slides"), title: t("Present as slides") },
    { value: "review" as Mode, icon: <Layers size={13} />, l: t("Review"), title: t("Review flashcards") },
    // Diagrams / Media / Links: the note tab row under the header (NoteTabs.tsx, round 6).
  ];
  const effMode: Mode = mode === "split" && !wide ? "read" : mode;
  const words = isCanvas ? 0 : (note.body.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  const mins = Math.max(1, Math.round(words / 220));
  const share = note.published ? "published" : note.shareId ? "shared" : "private";
  const SHARE = {
    private: { cls: "border-line text-ink font-medium", icon: <Share2 size={13} />, t: tr("Share", rtl) },
    shared: { cls: "font-semibold text-info border-[color-mix(in_srgb,var(--info)_40%,transparent)] bg-[color-mix(in_srgb,var(--info)_14%,transparent)]", icon: <Link2 size={13} />, t: tr("Shared", rtl) },
    published: { cls: "font-semibold text-ok border-[color-mix(in_srgb,var(--success)_40%,transparent)] bg-[color-mix(in_srgb,var(--success)_14%,transparent)]", icon: <Globe size={13} />, t: tr("Published", rtl) },
  }[share];
  // With the note list visible: two header rows (ScreenWorkspace). List hidden / rail: one row (5A, 08 R2-3A).
  const twoRows = wide && (ui.list || tight > 0);
  const markdownNote = !isCanvas && !isRoadmap;

  const item = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-[13px] hover:bg-surface-2";
  const menuEl = menu && (
    <>
      <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
      <div className="absolute end-0 top-full z-40 mt-1 max-h-[80vh] w-64 overflow-y-auto rounded-[12px] border border-line bg-surface p-1.5 shadow-xl fade-in" onClick={() => setMenu(false)}>
        {!wide && markdownNote && (
          <>
            <button className={item} onClick={() => setUI({ mode: "focus" })}><Maximize2 size={15} /> {t("Focus")}</button>
            <button className={item} onClick={() => setUI({ mode: "slides" })}><Presentation size={15} /> {t("Present as slides")}</button>
            <button className={item} onClick={() => setUI({ mode: "review" })}><Layers size={15} /> {t("Review flashcards")}</button>
            {diagramCount > 0 && <button className={item} onClick={() => setUI({ mode: "diagrams" })}><Waypoints size={15} /> {t("Diagrams ({n})", { n: diagramCount })}</button>}
            <button className={item} onClick={() => setUI({ panel: "outline" })}><PanelRight size={15} /> {t("Outline, links, history")}</button>
            <button className={item} onClick={() => setPublish(true)}><Share2 size={15} /> {t("Share / publish…")}</button>
            <div className="my-1 h-px bg-line" />
          </>
        )}
        {wide && markdownNote && (effMode === "edit" || effMode === "split") && (
          <>
            <button className={item} onClick={() => editorBridge.image?.()}><ImagePlus size={15} /> {t("Insert image or file")}</button>
            <button className={item} onClick={() => editorBridge.voice?.()}><Mic size={15} /> {t("Voice note → text")}</button>
          </>
        )}
        {markdownNote && (effMode === "edit" || effMode === "split") && (
          <>
            {/* Insert gallery (R4-16C): layout thumbnails + preview, same catalog as the "/" menu */}
            <button className={item} onClick={() => openInsertGallery()}><LayoutTemplate size={15} /> {t("Insert…")}</button>
            <div className="my-1 h-px bg-line" />
          </>
        )}
        <button className={item} onClick={() => updateNote(note.id, { pinned: note.pinned ? 0 : 1 })}><Pin size={15} /> {note.pinned ? t("Unpin") : t("Pin")}</button>
        <button className={item} onClick={() => updateNote(note.id, { favorite: note.favorite ? 0 : 1 })}><Star size={15} /> {note.favorite ? t("Remove favorite") : t("Favorite")}</button>
        {wide && <button className={item} onClick={() => setPublish(true)}><Globe size={15} /> {t("Share / publish…")}</button>}
        <button className={item} onClick={() => setUI({ panel: "properties" })}><Info size={15} /> {t("Properties")}</button>
        <button className={item} onClick={() => setLocalGraph(true)}><Network size={15} /> {t("Local graph")}</button>
        {markdownNote && <button className={item} onClick={() => openTutorForNote(note, v, "explain")}><Glyph name="lesson" size={15} color="var(--learn)" /> {t("Tutor · Explain")}</button>}
        {markdownNote && <button className={item} onClick={() => openTutorForNote(note, v, "socratic")}><Glyph name="c-question" size={15} color="var(--learn)" /> {t("Tutor · Socratic")}</button>}
        {markdownNote && <button className={item} onClick={() => openTutorForNote(note, v, "feynman")}><Glyph name="d-draft" size={15} color="var(--learn)" /> {t("Tutor · Feynman")}</button>}
        {!isCanvas && <button className={item} onClick={async () => { const c = await canvasFromNote(note, (p) => createNote(p)); if (c) openNote(c.id); }}><MapIcon size={15} /> {t("Make canvas from outline")}</button>}
        {markdownNote && note.type !== "slides" && <button className={item} onClick={() => setUI({ mode: "slides" })}><Presentation size={15} /> {t("Make a slide deck from this note")}</button>}
        {note.type === "canvas" && <button className={item} onClick={async () => { const { canvas } = parseCanvas(note.body); const w = await createNote({ type: "whiteboard", title: `${note.title} (whiteboard)`, spaceId: note.spaceId, folderId: note.folderId, body: JSON.stringify({ type: "excalidraw", version: 2, source: "lumen", elements: [], lumenPending: canvasToSkeleton(canvas) }) }); openNote(w.id); }}><MapIcon size={15} /> {t("Open as whiteboard")}</button>}
        <div className="my-1 h-px bg-line" />
        {!isBoard && <button className={item} onClick={() => exportNoteMd(note)}><Download size={15} /> {t("Export {ext}", { ext: isCanvas ? ".canvas" : ".md" })}</button>}
        {!isCanvas && <button className={item} onClick={() => exportNoteHtml(note)}><FileCode2 size={15} /> {t("Export {ext}", { ext: ".html" })}</button>}
        {!isCanvas && <button className={item} onClick={() => printNote(note)}><Printer size={15} /> {t("Print / PDF")}</button>}
        <button className={item} onClick={async () => { const d = await duplicateNote(note.id); if (d) openNote(d.id); }}><Copy size={15} /> {t("Duplicate")}</button>
        <div className="my-1 h-px bg-line" />
        {!wide && markdownNote && <><ReadRows /><div className="my-1 h-px bg-line" /></>}
        <UiDirRow />
        <div className="my-1 h-px bg-line" />
        <button className={item + " text-bad"} onClick={async () => { const title = note.title; await trashNote(note.id); setUI({ noteId: null }); toast(t("“{title}” moved to Trash", { title }), { label: t("Undo"), run: () => { void restoreNote(note.id); openNote(note.id); } }); }}><Trash2 size={15} /> {t("Move to trash")}</button>
      </div>
    </>
  );
  const iconBtn = "flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink";
  const PanelIcon = rtl ? PanelLeft : PanelRight;

  // Single-row header lets crumbs wrap to two lines when space is short (design 5A: "ML / Foundations").
  const crumbsEl = (
    <div ref={crumbRef} className={cx("flex min-w-0 items-center gap-1.5 text-muted", twoRows ? "whitespace-nowrap" : "shrink leading-[14px]")}>
      {/* space → its page (course hub / project hub / space home); folder → that folder's note list */}
      <button title={t("Open {name}", { name: space?.name ?? t("Inbox") })} className={cx("hover:text-ink hover:underline", twoRows ? "truncate" : "line-clamp-2 max-w-[110px] text-start")}
        onClick={() => (note.spaceId === "inbox" ? setUI({ view: "notes", spaceId: "inbox", folderId: null, filter: null, tag: null, noteId: null }) : setUI({ view: "space", spaceId: note.spaceId, folderId: null, noteId: null }))}><span className="inline-flex items-center gap-1.5 align-middle"><SpaceIcon space={space} size={15} /><span dir="auto">{space?.name ?? t("Inbox")}</span></span></button>
      {/* Lumen 22 truncation: past three levels the middle folders collapse to "…" (click for the full path) */}
      {crumbs.length > 2 && !crumbsOpen && <span className="flex shrink-0 items-center gap-1.5"><span aria-hidden>›</span><button onClick={() => setCrumbsOpen(true)} title={crumbs.slice(0, -1).map((c) => c.name).join(" › ")} aria-label={t("Show the full path")} className="hover:text-ink">…</button></span>}
      {(crumbs.length > 2 && !crumbsOpen ? crumbs.slice(-1) : crumbs).map((c) => (
        <span key={c.id} className="flex min-w-0 items-center gap-1.5"><span aria-hidden className="shrink-0">›</span>
          <button dir="auto" title={t("Open folder {name}", { name: c.name })} onClick={() => setUI({ view: "notes", spaceId: note.spaceId, folderId: c.id, filter: null, tag: null, noteId: null, list: true })}
            className={cx("hover:text-ink hover:underline", twoRows ? "truncate" : "line-clamp-2 max-w-[100px] text-start")}>{c.name}</button>
        </span>
      ))}
      <span aria-hidden className="shrink-0">›</span><span dir="auto" title={note.title} className={cx("font-medium text-ink", twoRows ? "truncate" : "line-clamp-2 max-w-[180px]")}>{note.title}</span>
    </div>
  );
  const switcher = (list: typeof modes) => (
    <div className="flex gap-0.5 rounded-[10px] border border-line bg-surface p-[3px]">
      {list.map((m) => (
        <button key={m.value} title={m.title} onClick={() => setUI({ mode: m.value })} className={"flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5 text-[12.5px] " + (mode === m.value ? "bg-surface-2 font-semibold text-ink" : "font-[450] text-muted hover:text-ink")}>{m.icon}<span className={mode === m.value ? "@max-xl:hidden" : "@max-3xl:hidden"}>{m.l}</span>{"badge" in m && m.badge ? <span className="rounded-full bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] px-1.5 text-[10.5px] font-semibold leading-4 text-accent">{fmtNum(Number(m.badge))}</span> : null}</button>
      ))}
    </div>
  );
  const shareBtn = <button onClick={() => setPublish(true)} className={"flex h-7 items-center gap-1.5 rounded-[8px] border px-2.5 " + SHARE.cls}>{SHARE.icon}<span className="@max-xl:hidden">{SHARE.t}</span></button>;
  const moreBtn = <div className="relative"><button aria-label={t("More")} className={iconBtn} onClick={() => setMenu((m) => !m)}><MoreHorizontal size={16} /></button>{menuEl}</div>;
  const pw = pageWidthOf(note.body);
  // Page width switch (R4-16J): Fixed · Wide · Full, saved per note as front-matter `width:` (fixed = no key)
  const widthBtn = (effMode === "read" || effMode === "split") && (
    <div role="radiogroup" aria-label={t("Page width")} className="flex shrink-0 gap-0.5 rounded-[9px] border border-line bg-surface p-[3px] text-[12px]">
      {([["fixed", t("Fixed"), "center"], ["wide", t("Wide"), "wide"], ["full", t("Full"), "full"]] as [PageWidth, string, string][]).map(([k, l, g]) => (
        <button key={k} role="radio" aria-checked={pw === k} title={t("Page width: {width}", { width: l })} onClick={() => pw !== k && void updateNote(note.id, { body: setFrontMatter(note.body, { width: k === "fixed" ? null : k }) })}
          className="flex h-6 items-center gap-[5px] rounded-[6px] px-[9px]" style={pw === k ? { background: "var(--surface-2)", color: "var(--text)", fontWeight: 600 } : { color: "var(--muted)", fontWeight: 450 }}>
          <Glyph name={g} size={13} /><span className="@max-4xl:hidden">{l}</span>
        </button>
      ))}
    </div>
  );
  // Assistant (R6-31): opens / closes the in-note Assistant; Ctrl/⌘ J collapses it to the rail
  const assistantBtn = <button aria-label={t("Assistant")} title={t("Assistant (Ctrl+J)")} aria-pressed={ui.panel === "ai"} onClick={() => toggleAssistantPanel(ui.panel !== "ai")} data-act="assistant"
    className={"flex h-[30px] items-center gap-1.5 rounded-[8px] border px-2.5 font-semibold " + (ui.panel === "ai" ? "border-accent bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]" : "border-line hover:bg-surface-2")}><Glyph name="assistant" size={15} color="var(--accent)" /><span className="@max-xl:hidden">{t("Assistant")}</span></button>;
  const panelBtn = <button aria-label={t("Side panel")} title={t("Outline, links, history")} className={iconBtn + (ui.panel ? " !text-accent" : "")} onClick={() => setUI({ panel: ui.panel ? null : "outline" })}><PanelIcon size={16} /></button>;

  // Focus mode is a full-screen layer (7A / 7B): no chrome, Esc hint, saved state + word count in the corners.
  // Focus: full-screen reading (highlighter, read aloud, outline) or writing (FocusView). Leaving returns to the matching view.
  if (effMode === "focus" && markdownNote && !ownBar) return <FocusView note={note} wide={wide} onExit={() => setUI({ mode: (getSettings().focusMode ?? "read") === "read" ? "read" : wide ? "split" : "edit" })} />;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* full-height readers bring their own bar (Back · title · Edit): path map, PDF (PdfDesk), base (BaseDesk), dashboard (DashDesk) */}
        {(isPath && !rmEdit) || (ownBar && effMode !== "edit") ? null : wide ? (
          twoRows ? (
            <header ref={hdrRef} className="@container bg-bg text-[13px]">
              <div className="flex h-11 items-center gap-2.5 pe-3 ps-5">
                <span className="flex @max-lg:hidden"><NavButtons /></span>
                {crumbsEl}
                <span className="flex-1" />
                {/* narrow (side panel open): drop the sync line so Assistant / side-panel toggles stay on screen */}
                <span className="hidden @3xl:flex"><HeaderSync /></span>
                <StudyTimer noteId={note.id} />
                {isRoadmap && <Segmented value={rmEdit ? "edit" : "map"} onChange={(x) => setRmEdit(x === "edit")} options={[{ value: "map", label: <><MapIcon size={13} /> {isPath ? t("Path") : t("Roadmap")}</> }, { value: "edit", label: <><PenLine size={13} /> {t("Edit")}</> }]} />}
                {moreBtn}
                {shareBtn}
                {markdownNote && assistantBtn}
                {panelBtn}
              </div>
              {markdownNote && (
                <div className="flex h-11 min-w-0 items-center gap-3 border-b border-line px-5">
                  {switcher(modes)}
                  {(effMode === "edit" || effMode === "split") && <UndoRedo />}
                  <span className="flex-1" />
                  {widthBtn}
                  <ReadMenu />
                  {/* edit / split show live counts in the editor footer (editor-tools.tsx) */}
                  {effMode !== "edit" && effMode !== "split" && <span className="whitespace-nowrap text-[12px] text-muted">{t("{words} words · {mins} min", { words, mins })}</span>}
                </div>
              )}
              {!markdownNote && <div className="border-b border-line" />}
            </header>
          ) : (
            <header ref={hdrRef} className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line bg-bg pe-3 ps-5 text-[13px]">
              <NavButtons />
              {crumbsEl}
              <span className="flex-1" />
              {markdownNote && switcher(modes)}
              {markdownNote && (effMode === "edit" || effMode === "split") && <UndoRedo />}
              {isRoadmap && <Segmented value={rmEdit ? "edit" : "map"} onChange={(x) => setRmEdit(x === "edit")} options={[{ value: "map", label: <><MapIcon size={13} /> {isPath ? t("Path") : t("Roadmap")}</> }, { value: "edit", label: <><PenLine size={13} /> {t("Edit")}</> }]} />}
              <span className="flex-1" />
              <HeaderSync wrap />
              {markdownNote && widthBtn}
              {markdownNote && <ReadMenu />}
              {markdownNote && <DirMenu note={note} />}
              {shareBtn}
              {markdownNote && assistantBtn}
              {moreBtn}
              {panelBtn}
            </header>
          )
        ) : (
          <header className="safe-t flex h-14 shrink-0 items-center gap-0.5 border-b border-line bg-bg px-1">
            <button aria-label={t("Back")} className="flex size-12 items-center justify-center" onClick={() => (canGoBack() ? history.back() : back())}><ArrowLeft size={20} /></button>
            <div className="flex min-w-0 flex-1 flex-col">
              {saving ? <PhoneSyncLine saving /> : <span dir="auto" className="truncate text-[11.5px] leading-4 text-muted">{[space?.name ?? t("Inbox"), ...crumbs.map((c) => c.name)].join(" › ")}</span>}
              <span dir="auto" className="truncate text-[14px] font-semibold leading-5" style={{ textAlign: rtl ? "right" : "left" }}>{note.title}</span>
            </div>
            {markdownNote && effMode === "edit" ? (
              <div className="me-1 flex rounded-[10px] border border-line bg-surface p-[3px]">
                {(["edit", "read"] as Mode[]).map((m) => (
                  <button key={m} onClick={() => setUI({ mode: m })} className={"flex h-[30px] items-center rounded-[7px] px-2.5 text-[13px] " + (effMode === m ? "bg-surface-2 font-semibold" : "text-muted")}>{tr(m === "edit" ? "Edit" : "Read", rtl)}</button>
                ))}
              </div>
            ) : markdownNote ? (
              <button aria-label={t("Edit")} className="flex size-12 items-center justify-center" onClick={() => setUI({ mode: "edit" })}><PenLine size={20} /></button>
            ) : null}
            {isRoadmap && <button onClick={() => setRmEdit((x) => !x)} className="rounded-[8px] border border-line px-2.5 py-1.5 text-[13px]">{rmEdit ? t("Roadmap") : t("Edit")}</button>}
            {markdownNote && <button aria-label={t("Assistant")} onClick={() => toggleAssistantPanel(ui.panel !== "ai")} className="flex h-[30px] items-center rounded-[8px] border px-2.5" style={ui.panel === "ai" ? { borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 10%, transparent)" } : { borderColor: "var(--border)" }} data-act="assistant"><Glyph name="assistant" size={15} color="var(--accent)" /></button>}
            <div className="relative"><button aria-label={t("More")} className="flex h-12 w-11 items-center justify-center" onClick={() => setMenu((m) => !m)}><EllipsisVertical size={20} /></button>{menuEl}</div>
          </header>
        )}
        {/* note tabs (R6-31): Note · Diagrams · Media · Links · Outline, only the ones this note has content for */}
        {markdownNote && !isDiagram && !ownBar && !(isPath && !rmEdit) && effMode !== "focus" && effMode !== "slides" && effMode !== "review" && <NoteTabBar note={note} mode={effMode} wide={wide} />}

        {/* title fallback for notes without a "# H1" (the H1 in the body is the title) */}
        {markdownNote && effMode === "edit" && !firstH1(note.body) && (
          <div className="px-5 pt-5 md:px-8">
            <input ref={titleRef} key={note.id} defaultValue={note.title} dir="auto" placeholder={t("Title")}
              onBlur={(e) => e.target.value.trim() && e.target.value !== note.title && updateNote(note.id, { title: e.target.value.trim() })}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
              className="mx-auto block w-full max-w-[var(--measure)] bg-transparent font-serif text-[26px] font-bold leading-9 tracking-[-.01em] outline-none md:text-[30px]" />
          </div>
        )}

        {/* body */}
        <div className="relative min-h-0 flex-1">
          {isBoard ? (
            <Suspense fallback={<Skeleton kind="board" />}><Whiteboard key={note.id} note={note} /></Suspense>
          ) : isCanvas ? (
            <Suspense fallback={<Skeleton kind="board" />}><CanvasEditor key={note.id} note={note} /></Suspense>
          ) : isRoadmap && !rmEdit ? (
            <Suspense fallback={<Skeleton kind="list" />}>{isPath ? <PathView note={note} /> : <RoadmapView note={note} />}</Suspense>
          ) : isRoadmap ? (
            <Editor key={note.id} note={note} />
          ) : isDiagram ? (
            <DiagramFile note={note} mode={effMode as "edit" | "split" | "read"} wide={wide} />
          ) : note.type === "pdf" && effMode !== "edit" ? (
            <Suspense fallback={<Skeleton kind="note" />}><PdfReader key={note.id} note={note} /></Suspense>
          ) : note.type === "base" && effMode !== "edit" ? (
            <Suspense fallback={<Skeleton kind="list" />}><BaseView note={note} /></Suspense>
          ) : note.type === "dashboard" && effMode !== "edit" ? (
            <Suspense fallback={<Skeleton kind="list" />}><DashboardView note={note} /></Suspense>
          ) : effMode === "edit" ? (
            <Editor key={note.id} note={note} live={!wide} page={wide} />
          ) : effMode === "diagrams" ? (
            <DiagramsTab note={note} wide={wide} />
          ) : effMode === "media" ? (
            <MediaTab note={note} wide={wide} />
          ) : effMode === "links" ? (
            <LinksTab note={note} wide={wide} />
          ) : effMode === "review" ? (
            <ReviewSession key={note.id} notes={[note]} title={note.title} />
          ) : effMode === "split" ? (
            <div className="grid h-full grid-cols-2">
              <div className="split-editor min-h-0 border-e border-line bg-surface"><Editor key={note.id} note={note} /></div>
              <div className="read-pane flex min-h-0 flex-col gap-3.5 overflow-y-auto px-9 py-7">
                <MetaRow note={note} kind="split" />
                {!firstH1(note.body) && <div className="prose reading"><h1 dir="auto">{note.title}</h1></div>}
                <Preview note={note} className="reading" onLine={(l) => scrollEditorToLine(l)} /><div className="h-[30vh] shrink-0" />
              </div>
            </div>
          ) : (
            <div data-pw={pw} className={cx("read-pane h-full overflow-y-auto", wide ? (pw === "full" ? "px-[72px] pb-14 pt-9" : "px-8 pb-14 pt-9") : "px-5 py-5")} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input,.embed,.vthumb,.mermaid-card")) setUI({ mode: wide ? "split" : "edit" }); }}>
              <div className={cx("mx-auto flex w-full flex-col", wide ? "gap-[18px]" : "gap-3.5")} style={wide ? { maxWidth: PAGE_W[pw] || fixedW() } : undefined}>
                {/* R4-16J…L / P4 (ReadDoc): the title opens the page; the "Type · status · N min read · Updated" row moves to the end of the note */}
                {note.body.length > 15000 && <LongRead key={note.id} note={note} />}
                {!firstH1(note.body) && <div className={cx("prose reading", wide ? "read-wide max-w-none" : "read-phone")}><h1 dir="auto">{note.title}</h1></div>}
                {note.body.trim() ? <Preview note={note} className={cx("reading", wide ? "read-wide max-w-none" : "read-phone")} /> : <div className="prose text-muted">{tx("Empty note. Double-click or press {edit} to write.", { edit: <b>{t("Edit")}</b> })}</div>}
                <div className="border-t border-line pt-3"><MetaRow note={note} kind={wide ? "read" : "phone"} words={words} /></div>
                <Backlinks note={note} />
                <div className="h-[30vh]" />
              </div>
            </div>
          )}
          {/* phone read: floating "Outline · Links N" pill (5B) */}
          {!wide && markdownNote && !ownBar && effMode === "read" && <OutlinePill note={note} />}
        </div>
      </div>
      <RightPanel note={note} />

      <ShareSheet target={{ kind: "note", note }} open={publish} onClose={() => setPublish(false)} />
      <Sheet open={localGraph} onClose={() => setLocalGraph(false)} title={t("Local graph: {title}", { title: note.title })} wide>
        <div className="h-[60vh]"><Suspense fallback={<Skeleton kind="graph" />}><GraphView localTo={note.id} /></Suspense></div>
      </Sheet>
    </div>
  );
}

/** "Lesson · ● Review · 9 min read · Updated 2 h ago" (5A) / "Lesson ● Learning" chips (split) / "● Review 9 min read" (5B). */
function MetaRow({ note, kind, words = 0 }: { note: Note; kind: "split" | "read" | "phone"; words?: number }) {
  const st = note.status;
  const pill = st && (
    <span className="flex items-center gap-[5px] rounded-full px-2 font-medium capitalize leading-5" style={{ color: STATUS_COLOR[st], background: `color-mix(in srgb, ${STATUS_COLOR[st]} 14%, transparent)` }}>
      <span className="size-1.5 rounded-full" style={{ background: STATUS_COLOR[st] }} />{t(STATUS_L[st])}
    </span>
  );
  const type = note.type !== "note" ? t(TYPE_L[note.type] ?? note.type) : null;
  if (kind === "split") {
    if (!type && !st) return null;
    return <div className="flex items-center gap-2 font-sans text-[12px] leading-5 text-muted">{type && <span className="rounded-[6px] bg-surface-2 px-1.5">{type}</span>}{pill}</div>;
  }
  const mins = Math.max(1, Math.round(words / 220));
  const mixed = AR.test(note.body) && LATIN.test(note.body.replace(/^---[\s\S]*?---/, ""));
  const parts: React.ReactNode[] = [];
  if (type && kind === "read") parts.push(<span key="t">{type}</span>);
  if (pill) parts.push(<span key="s">{pill}</span>);
  parts.push(<span key="m">{t("{n} min read", { n: mins })}</span>);
  if (kind === "read") parts.push(<span key="u">{t("Updated {ago}", { ago: fmtRelative(note.updatedAt) })}</span>);
  if (mixed && kind === "read") parts.push(<span key="b">AR + EN</span>);
  return (
    <div className={cx("flex flex-wrap items-center font-sans text-muted", kind === "read" ? "gap-2 text-[12.5px] leading-5" : "gap-2.5 text-[12.5px] leading-5")}>
      {parts.map((p, i) => <span key={i} className="flex items-center gap-2">{i > 0 && kind === "read" && <span>·</span>}{p}</span>)}
    </div>
  );
}

function OutlinePill({ note }: { note: Note }) {
  const v = useVault();
  const links = (v.backlinks.get(note.id) ?? []).length + (v.outlinks.get(note.id) ?? []).length;
  const heads = outline(note.body).length;
  if (heads < 2 && !links) return null;
  return (
    <button onClick={() => setUI({ panel: "outline" })} className="absolute bottom-[calc(16px+env(safe-area-inset-bottom))] end-4 z-10 flex h-11 items-center gap-2 rounded-full border border-line bg-surface-2 px-4 text-[13px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,.35)]">
      <ListTree size={15} />{t("Outline · Links {n}", { n: links })}
    </button>
  );
}

function Backlinks({ note }: { note: Note }) {
  const v = useVault();
  const back = (v.backlinks.get(note.id) ?? []).map((id) => v.byId.get(id)!).filter(Boolean);
  if (!back.length) return null;
  return (
    <div className="mx-auto mt-12 max-w-[var(--measure)] border-t border-line pt-4">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{t("Linked from · {n}", { n: back.length })}</div>
      <FolderGroups notes={back} wrap="flex flex-wrap gap-2" item={(n) => <button key={n.id} onClick={() => openNote(n.id)} dir="auto" title={n.title} className="max-w-[320px] truncate rounded-full border border-line px-3 py-1 text-[12.5px] hover:border-accent hover:text-accent">{n.title}</button>} />
    </div>
  );
}
