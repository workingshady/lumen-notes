import { Share2, Link2, ChevronRight, Layers, ArrowLeft, BookOpen, Columns2, Copy, Download, FileCode2, Globe, ImagePlus, Info, ListTree, Map as MapIcon, Maximize2, Mic, MoreHorizontal, EllipsisVertical, Network, PanelRight, PanelLeft, PenLine, Pin, Presentation, Printer, Star, Trash2 } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { canvasToSkeleton } from "../lib/whiteboard";
import { parseCanvas } from "../lib/canvas";
import type { Note } from "../../shared/types";
import { createNote, duplicateNote, restoreNote, snapshot, trashNote, updateNote } from "../lib/actions";
import { exportNoteHtml, exportNoteMd, printNote } from "../lib/io";
import { back, openNote, setUI, toast, useUI, useVault, type Mode } from "../lib/store";
import { canvasFromNote } from "../lib/canvasFromNote";
import { firstH1, outline } from "../lib/parse";
import { ShareSheet } from "./ShareSheet";
import { Skeleton } from "./Skeleton";
import { Editor, editorBridge, scrollEditorToLine } from "./Editor";
import { Preview } from "./Preview";
import { ReviewSession } from "./Review";
import { RightPanel } from "./RightPanel";
import { Slides } from "./Slides";
import { StudyTimer } from "./Timer";
import { Button, cx, relTime, Segmented, Sheet, STATUS_COLOR } from "./ui";
import { HeaderSync, PhoneSyncLine, useSaving, useSyncLook } from "./ws-sync";
import { DirMenu, UiDirRow } from "./ws-bidi";
import { tr, useRtl } from "./ws-dir";

const Whiteboard = lazy(() => import("./Whiteboard"));
const CanvasEditor = lazy(() => import("./CanvasEditor").then((m) => ({ default: m.CanvasEditor })));
const PathView = lazy(() => import("../views/PathView").then((m) => ({ default: m.PathView })));
const RoadmapView = lazy(() => import("../views/RoadmapView").then((m) => ({ default: m.RoadmapView })));
const GraphView = lazy(() => import("../views/GraphView").then((m) => ({ default: m.GraphView })));

const useWide = () => { const [w, setW] = useState(() => innerWidth >= 900); useEffect(() => { const f = () => setW(innerWidth >= 900); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return w; };
const AR = /[؀-ۿ]/;
const LATIN = /[A-Za-z]{3}/;

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
  const mode: Mode = ui.mode;

  // New untitled note → focus title.
  useEffect(() => { if (note.title === "Untitled" && !note.body) titleRef.current?.select(); }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (mode === "focus" || mode === "slides" || mode === "review")) setUI({ mode: wide ? "split" : "edit" });
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void snapshot(note, "Manual save").then(() => toast("Version saved")); }
      if ((e.ctrlKey || e.metaKey) && e.key === "e") { e.preventDefault(); setUI({ mode: mode === "edit" ? "read" : "edit" }); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [mode, note, wide]);

  if (note.deleted) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Trash2 size={32} className="text-muted" />
        <div className="font-semibold">“{note.title}” is in the trash</div>
        <Button variant="primary" onClick={() => restoreNote(note.id)}>Restore</Button>
      </div>
    );
  }
  if (mode === "slides" && !isCanvas) return <Slides note={note} onExit={() => setUI({ mode: "read" })} />;

  const space = v.spaceMap.get(note.spaceId);
  const crumbs: string[] = [];
  const seen = new Set<string>(); // guard against a parent cycle in synced folder data
  for (let f = note.folderId ? v.folderMap.get(note.folderId) : undefined; f && !seen.has(f.id); f = f.parentId ? v.folderMap.get(f.parentId) : undefined) { seen.add(f.id); crumbs.unshift(f.name); }

  const modes = [
    { value: "edit" as Mode, icon: <PenLine size={13} />, l: "Edit", title: "Edit (Ctrl+E)" },
    { value: "split" as Mode, icon: <Columns2 size={13} />, l: "Split", title: "Split: editor + preview" },
    { value: "read" as Mode, icon: <BookOpen size={13} />, l: "Read", title: "Read" },
    { value: "focus" as Mode, icon: <Maximize2 size={13} />, l: "Focus", title: "Focus (Esc to leave)" },
    { value: "slides" as Mode, icon: <Presentation size={13} />, l: "Slides", title: "Present as slides" },
    { value: "review" as Mode, icon: <Layers size={13} />, l: "Review", title: "Review flashcards" },
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
  const twoRows = wide && ui.list;
  const markdownNote = !isCanvas && !isRoadmap;

  const item = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-[13px] hover:bg-surface-2";
  const menuEl = menu && (
    <>
      <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
      <div className="absolute end-0 top-full z-40 mt-1 max-h-[80vh] w-64 overflow-y-auto rounded-[12px] border border-line bg-surface p-1.5 shadow-xl fade-in" onClick={() => setMenu(false)}>
        {!wide && markdownNote && (
          <>
            <button className={item} onClick={() => setUI({ mode: "focus" })}><Maximize2 size={15} /> Focus</button>
            <button className={item} onClick={() => setUI({ mode: "slides" })}><Presentation size={15} /> Present as slides</button>
            <button className={item} onClick={() => setUI({ mode: "review" })}><Layers size={15} /> Review flashcards</button>
            <button className={item} onClick={() => setUI({ panel: "outline" })}><PanelRight size={15} /> Outline, links, history</button>
            <button className={item} onClick={() => setPublish(true)}><Share2 size={15} /> Share / publish…</button>
            <div className="my-1 h-px bg-line" />
          </>
        )}
        {wide && markdownNote && (effMode === "edit" || effMode === "split") && (
          <>
            <button className={item} onClick={() => editorBridge.image?.()}><ImagePlus size={15} /> Insert image or file</button>
            <button className={item} onClick={() => editorBridge.voice?.()}><Mic size={15} /> Voice note → text</button>
            <div className="my-1 h-px bg-line" />
          </>
        )}
        <button className={item} onClick={() => updateNote(note.id, { pinned: note.pinned ? 0 : 1 })}><Pin size={15} /> {note.pinned ? "Unpin" : "Pin"}</button>
        <button className={item} onClick={() => updateNote(note.id, { favorite: note.favorite ? 0 : 1 })}><Star size={15} /> {note.favorite ? "Remove favorite" : "Favorite"}</button>
        {wide && <button className={item} onClick={() => setPublish(true)}><Globe size={15} /> Share / publish…</button>}
        <button className={item} onClick={() => setUI({ panel: "properties" })}><Info size={15} /> Properties</button>
        <button className={item} onClick={() => setLocalGraph(true)}><Network size={15} /> Local graph</button>
        {!isCanvas && <button className={item} onClick={async () => { const c = await canvasFromNote(note, (p) => createNote(p)); if (c) openNote(c.id); }}><MapIcon size={15} /> Make canvas from outline</button>}
        {note.type === "canvas" && <button className={item} onClick={async () => { const { canvas } = parseCanvas(note.body); const w = await createNote({ type: "whiteboard", title: `${note.title} (whiteboard)`, spaceId: note.spaceId, folderId: note.folderId, body: JSON.stringify({ type: "excalidraw", version: 2, source: "lumen", elements: [], lumenPending: canvasToSkeleton(canvas) }) }); openNote(w.id); }}><MapIcon size={15} /> Open as whiteboard</button>}
        <div className="my-1 h-px bg-line" />
        {!isBoard && <button className={item} onClick={() => exportNoteMd(note)}><Download size={15} /> Export {isCanvas ? ".canvas" : ".md"}</button>}
        {!isCanvas && <button className={item} onClick={() => exportNoteHtml(note)}><FileCode2 size={15} /> Export .html</button>}
        {!isCanvas && <button className={item} onClick={() => printNote(note)}><Printer size={15} /> Print / PDF</button>}
        <button className={item} onClick={async () => { const d = await duplicateNote(note.id); if (d) openNote(d.id); }}><Copy size={15} /> Duplicate</button>
        <div className="my-1 h-px bg-line" />
        <UiDirRow />
        <div className="my-1 h-px bg-line" />
        <button className={item + " text-bad"} onClick={async () => { const t = note.title; await trashNote(note.id); setUI({ noteId: null }); toast(`“${t}” moved to Trash`, { label: "Undo", run: () => { void restoreNote(note.id); openNote(note.id); } }); }}><Trash2 size={15} /> Move to trash</button>
      </div>
    </>
  );
  const iconBtn = "flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink";
  const PanelIcon = rtl ? PanelLeft : PanelRight;

  // Single-row header lets crumbs wrap to two lines when space is short (design 5A: "ML / Foundations").
  const crumbsEl = (
    <div className={cx("flex min-w-0 items-center gap-1.5 text-muted", twoRows ? "whitespace-nowrap" : "shrink leading-[14px]")}>
      <button className={cx("hover:text-ink", twoRows ? "truncate" : "line-clamp-2 max-w-[110px] text-start")} onClick={() => setUI({ view: "notes", spaceId: note.spaceId, folderId: null })}>{space?.icon} {space?.name ?? "Inbox"}</button>
      {crumbs.map((c, i) => <span key={i} className="flex min-w-0 items-center gap-1.5"><ChevronRight size={12} className="shrink-0 rtl:rotate-180" /><span className={twoRows ? "truncate" : "line-clamp-2 max-w-[100px]"}>{c}</span></span>)}
      <ChevronRight size={12} className="shrink-0 rtl:rotate-180" /><span dir="auto" className={cx("font-medium text-ink", twoRows ? "truncate" : "line-clamp-2 max-w-[180px]")}>{note.title}</span>
    </div>
  );
  const switcher = (list: typeof modes) => (
    <div className="flex gap-0.5 rounded-[10px] border border-line bg-surface p-[3px]">
      {list.map((m) => (
        <button key={m.value} title={m.title} onClick={() => setUI({ mode: m.value })} className={"flex h-[26px] items-center gap-1.5 rounded-[7px] px-2.5 text-[12.5px] " + (mode === m.value ? "bg-surface-2 font-semibold text-ink" : "font-[450] text-muted hover:text-ink")}>{m.icon}{tr(m.l, rtl)}</button>
      ))}
    </div>
  );
  const shareBtn = <button onClick={() => setPublish(true)} className={"flex h-7 items-center gap-1.5 rounded-[8px] border px-2.5 " + SHARE.cls}>{SHARE.icon}{SHARE.t}</button>;
  const moreBtn = <div className="relative"><button aria-label="More" className={iconBtn} onClick={() => setMenu((m) => !m)}><MoreHorizontal size={16} /></button>{menuEl}</div>;
  const panelBtn = <button aria-label="Side panel" title="Outline, links, history" className={iconBtn + (ui.panel ? " !text-accent" : "")} onClick={() => setUI({ panel: ui.panel ? null : "outline" })}><PanelIcon size={16} /></button>;

  // Focus mode is a full-screen layer (7A / 7B): no chrome, Esc hint, saved state + word count in the corners.
  if (effMode === "focus" && markdownNote) return <FocusMode note={note} words={words} wide={wide} onExit={() => setUI({ mode: wide ? "split" : "edit" })} />;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {wide ? (
          twoRows ? (
            <header className="bg-bg text-[13px]">
              <div className="flex h-11 items-center gap-2.5 pe-3 ps-5">
                {crumbsEl}
                <span className="flex-1" />
                <HeaderSync />
                <StudyTimer noteId={note.id} />
                {isRoadmap && <Segmented value={rmEdit ? "edit" : "map"} onChange={(x) => setRmEdit(x === "edit")} options={[{ value: "map", label: <><MapIcon size={13} /> {isPath ? "Path" : "Roadmap"}</> }, { value: "edit", label: <><PenLine size={13} /> Edit</> }]} />}
                {moreBtn}
                {shareBtn}
                {panelBtn}
              </div>
              {markdownNote && (
                <div className="flex h-11 items-center gap-3 border-b border-line px-5">
                  {switcher(modes)}
                  <span className="flex-1" />
                  <span className="text-[12px] text-muted">{words.toLocaleString()} {tr("words", rtl)} · {mins} {tr("min", rtl)}</span>
                </div>
              )}
              {!markdownNote && <div className="border-b border-line" />}
            </header>
          ) : (
            <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line bg-bg pe-3 ps-5 text-[13px]">
              {crumbsEl}
              <span className="flex-1" />
              {markdownNote && switcher(modes)}
              {isRoadmap && <Segmented value={rmEdit ? "edit" : "map"} onChange={(x) => setRmEdit(x === "edit")} options={[{ value: "map", label: <><MapIcon size={13} /> {isPath ? "Path" : "Roadmap"}</> }, { value: "edit", label: <><PenLine size={13} /> Edit</> }]} />}
              <span className="flex-1" />
              <HeaderSync wrap />
              {markdownNote && <DirMenu note={note} />}
              {shareBtn}
              {moreBtn}
              {panelBtn}
            </header>
          )
        ) : (
          <header className="safe-t flex h-14 shrink-0 items-center gap-0.5 border-b border-line bg-bg px-1">
            <button aria-label="Back" className="flex size-12 items-center justify-center" onClick={() => (ui.history.length ? back() : setUI({ noteId: null, view: "notes" }))}><ArrowLeft size={20} className="rtl:rotate-180" /></button>
            <div className="flex min-w-0 flex-1 flex-col">
              <span dir="auto" className="truncate text-[14px] font-semibold leading-5" style={{ textAlign: rtl ? "right" : "left" }}>{note.title}</span>
              <PhoneSyncLine saving={saving} />
            </div>
            {markdownNote && effMode === "edit" ? (
              <div className="me-1 flex rounded-[10px] border border-line bg-surface p-[3px]">
                {(["edit", "read"] as Mode[]).map((m) => (
                  <button key={m} onClick={() => setUI({ mode: m })} className={"flex h-[30px] items-center rounded-[7px] px-2.5 text-[13px] " + (effMode === m ? "bg-surface-2 font-semibold" : "text-muted")}>{tr(m === "edit" ? "Edit" : "Read", rtl)}</button>
                ))}
              </div>
            ) : markdownNote ? (
              <button aria-label="Edit" className="flex size-12 items-center justify-center" onClick={() => setUI({ mode: "edit" })}><PenLine size={20} /></button>
            ) : null}
            {isRoadmap && <button onClick={() => setRmEdit((x) => !x)} className="rounded-[8px] border border-line px-2.5 py-1.5 text-[13px]">{rmEdit ? "Roadmap" : "Edit"}</button>}
            <div className="relative"><button aria-label="More" className="flex h-12 w-11 items-center justify-center" onClick={() => setMenu((m) => !m)}><EllipsisVertical size={20} /></button>{menuEl}</div>
          </header>
        )}

        {/* title fallback for notes without a "# H1" (the H1 in the body is the title) */}
        {markdownNote && effMode === "edit" && !firstH1(note.body) && (
          <div className="px-5 pt-5 md:px-8">
            <input ref={titleRef} key={note.id} defaultValue={note.title} dir="auto" placeholder="Title"
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
          ) : effMode === "edit" ? (
            <Editor key={note.id} note={note} live={!wide} />
          ) : effMode === "review" ? (
            <ReviewSession key={note.id} notes={[note]} title={note.title} />
          ) : effMode === "split" ? (
            <div className="grid h-full grid-cols-2">
              <div className="split-editor min-h-0 border-e border-line bg-surface"><Editor key={note.id} note={note} /></div>
              <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto px-9 py-7">
                <MetaRow note={note} kind="split" />
                {!firstH1(note.body) && <div className="prose reading"><h1 dir="auto">{note.title}</h1></div>}
                <Preview note={note} className="reading" onLine={(l) => scrollEditorToLine(l)} /><div className="h-[30vh] shrink-0" />
              </div>
            </div>
          ) : (
            <div className={cx("h-full overflow-y-auto", wide ? "px-8 py-14" : "px-5 py-5")} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input,.embed,.vthumb")) setUI({ mode: wide ? "split" : "edit" }); }}>
              <div className={cx("mx-auto flex flex-col", wide ? "max-w-[680px] gap-5" : "gap-4")}>
                <MetaRow note={note} kind={wide ? "read" : "phone"} words={words} />
                {!firstH1(note.body) && <div className={cx("prose reading", wide ? "read-wide max-w-none" : "read-phone")}><h1 dir="auto">{note.title}</h1></div>}
                {note.body.trim() ? <Preview note={note} className={cx("reading", wide ? "read-wide max-w-none" : "read-phone")} /> : <div className="prose text-muted">Empty note. Double-click or press <b>Edit</b> to write.</div>}
                <Backlinks note={note} />
                <div className="h-[30vh]" />
              </div>
            </div>
          )}
          {/* phone read: floating "Outline · Links N" pill (5B) */}
          {!wide && markdownNote && effMode === "read" && <OutlinePill note={note} />}
        </div>
      </div>
      <RightPanel note={note} />

      <ShareSheet target={{ kind: "note", note }} open={publish} onClose={() => setPublish(false)} />
      <Sheet open={localGraph} onClose={() => setLocalGraph(false)} title={`Local graph: ${note.title}`} wide>
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
      <span className="size-1.5 rounded-full" style={{ background: STATUS_COLOR[st] }} />{st}
    </span>
  );
  const type = note.type !== "note" ? note.type[0].toUpperCase() + note.type.slice(1) : null;
  if (kind === "split") {
    if (!type && !st) return null;
    return <div dir="ltr" className="flex items-center gap-2 font-sans text-[12px] leading-5 text-muted">{type && <span className="rounded-[6px] bg-surface-2 px-1.5">{type}</span>}{pill}</div>;
  }
  const mins = Math.max(1, Math.round(words / 220));
  const mixed = AR.test(note.body) && LATIN.test(note.body.replace(/^---[\s\S]*?---/, ""));
  const parts: React.ReactNode[] = [];
  if (type && kind === "read") parts.push(<span key="t">{type}</span>);
  if (pill) parts.push(<span key="s">{pill}</span>);
  parts.push(<span key="m">{mins} min read</span>);
  if (kind === "read") parts.push(<span key="u">Updated {relTime(note.updatedAt).replace(/(\d+)([mhd]) ago/, "$1 $2 ago")}</span>);
  if (mixed && kind === "read") parts.push(<span key="b">AR + EN</span>);
  return (
    <div dir="ltr" className={cx("flex flex-wrap items-center font-sans text-muted", kind === "read" ? "gap-2 text-[12.5px] leading-5" : "gap-2.5 text-[12.5px] leading-5")}>
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
      <ListTree size={15} />Outline · Links {links}
    </button>
  );
}

function FocusMode({ note, words, wide, onExit }: { note: Note; words: number; wide: boolean; onExit: () => void }) {
  const l = useSyncLook();
  const saving = useSaving();
  const start = useRef<{ y: number; t: number } | null>(null);
  return (
    <div className="fixed inset-0 z-[45] flex flex-col bg-bg fade-in"
      onTouchStart={(e) => { start.current = { y: e.touches[0].clientY, t: Date.now() }; }}
      onTouchEnd={(e) => { const s = start.current; if (s && e.changedTouches[0].clientY - s.y > 140 && Date.now() - s.t < 600 && (document.querySelector(".focus-mode .cm-scroller")?.scrollTop ?? 0) < 4) onExit(); }}>
      {wide && (
        <button onClick={onExit} className="absolute left-1/2 top-7 z-10 -translate-x-1/2 text-[12px] text-muted opacity-80 hover:opacity-100">
          <span className="me-1.5 rounded-[4px] border border-line px-1.5 py-0.5 font-mono text-[11px]">Esc</span>to leave focus
        </button>
      )}
      <div className="safe-t min-h-0 flex-1"><Editor key={note.id} note={note} focus /></div>
      <div className="safe-b pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between px-6 pb-7 pt-10 text-[12px] text-muted md:px-8" style={{ background: "linear-gradient(transparent, var(--bg) 55%)" }}>
        {wide ? (
          <span className="flex items-center gap-2"><span className="size-1.5 rounded-full" style={{ background: saving ? "var(--info)" : l.kind === "error" ? "var(--danger)" : "var(--success)" }} />{saving ? "Saving…" : "Saved"}</span>
        ) : (
          <button className="pointer-events-auto flex items-center gap-1" onClick={onExit}>Tap <Maximize2 size={11} className="inline" /> or swipe down to exit</button>
        )}
        <span>{words.toLocaleString()} words</span>
      </div>
    </div>
  );
}

function Backlinks({ note }: { note: Note }) {
  const v = useVault();
  const back = (v.backlinks.get(note.id) ?? []).map((id) => v.byId.get(id)!).filter(Boolean);
  if (!back.length) return null;
  return (
    <div className="mx-auto mt-12 max-w-[var(--measure)] border-t border-line pt-4">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Linked from · {back.length}</div>
      <div className="flex flex-wrap gap-2">
        {back.map((n) => <button key={n.id} onClick={() => openNote(n.id)} className="rounded-full border border-line px-3 py-1 text-[12.5px] hover:border-accent hover:text-accent">{n.title}</button>)}
      </div>
    </div>
  );
}
