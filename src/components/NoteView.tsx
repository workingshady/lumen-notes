import { ArrowLeft, BookOpen, Columns2, Copy, Download, FileCode2, Globe, Info, Map as MapIcon, MoreHorizontal, Network, PanelRight, Pencil, Pin, Presentation, Printer, Star, Trash2, Brain, Maximize2 } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { canvasToSkeleton } from "../lib/whiteboard";
import { parseCanvas } from "../lib/canvas";
import type { Note } from "../../shared/types";
import { createNote, duplicateNote, snapshot, trashNote, updateNote } from "../lib/actions";
import { exportNoteHtml, exportNoteMd, printNote } from "../lib/io";
import { slugify } from "../lib/parse";
import { back, openNote, setUI, toast, useUI, useVault, type Mode } from "../lib/store";
import { API_BASE } from "../lib/api";
import { CanvasEditor, canvasFromNote } from "./CanvasEditor";
import { Editor, scrollEditorToLine } from "./Editor";
import { Preview } from "./Preview";
import { ReviewSession } from "./Review";
import { RightPanel } from "./RightPanel";
import { Slides } from "./Slides";
import { StudyTimer } from "./Timer";
import { Button, IconButton, inputCls, Segmented, Sheet } from "./ui";
import { GraphView } from "../views/GraphView";
import { restoreNote } from "../lib/actions";
import { RoadmapView } from "../views/RoadmapView";

const Whiteboard = lazy(() => import("./Whiteboard"));

export function NoteView({ note }: { note: Note }) {
  const ui = useUI();
  const v = useVault();
  const [menu, setMenu] = useState(false);
  const [publish, setPublish] = useState(false);
  const [localGraph, setLocalGraph] = useState(false);
  const [rmEdit, setRmEdit] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const isBoard = note.type === "whiteboard";
  const isCanvas = note.type === "canvas" || isBoard;
  const isRoadmap = note.type === "roadmap";
  const mode: Mode = ui.mode;

  // New untitled note → focus title.
  useEffect(() => { if (note.title === "Untitled" && !note.body) titleRef.current?.select(); }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (mode === "focus" || mode === "slides" || mode === "review")) setUI({ mode: "split" });
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void snapshot(note, "Manual save").then(() => toast("Version saved")); }
      if ((e.ctrlKey || e.metaKey) && e.key === "e") { e.preventDefault(); setUI({ mode: mode === "edit" ? "read" : "edit" }); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [mode, note]);

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
  for (let f = note.folderId ? v.folderMap.get(note.folderId) : undefined; f; f = f.parentId ? v.folderMap.get(f.parentId) : undefined) crumbs.unshift(f.name);

  const modes = [
    { value: "edit" as Mode, label: <Pencil size={13} />, title: "Edit (Ctrl+E)" },
    { value: "split" as Mode, label: <Columns2 size={13} />, title: "Split: editor + preview" },
    { value: "read" as Mode, label: <BookOpen size={13} />, title: "Read" },
    { value: "focus" as Mode, label: <Maximize2 size={13} />, title: "Focus" },
    { value: "slides" as Mode, label: <Presentation size={13} />, title: "Present as slides" },
    { value: "review" as Mode, label: <Brain size={13} />, title: "Review flashcards" },
  ];
  const wide = typeof innerWidth === "number" && innerWidth >= 900;
  const effMode: Mode = mode === "split" && !wide ? "read" : mode;

  const item = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-surface-2";
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        {effMode !== "focus" && (
          <header className="safe-t border-b border-line bg-bg">
            <div className="flex items-center gap-1 px-2 pt-1.5 md:px-4">
              <IconButton label="Back" className="md:hidden" onClick={() => (ui.history.length ? back() : setUI({ noteId: null, view: "notes" }))}><ArrowLeft size={18} /></IconButton>
              <div className="flex min-w-0 flex-1 items-center gap-1 truncate text-[12px] text-muted">
                <button className="truncate hover:text-ink" onClick={() => setUI({ view: "notes", spaceId: note.spaceId, folderId: null })}>{space?.icon} {space?.name ?? "Inbox"}</button>
                {crumbs.map((c, i) => <span key={i} className="truncate">/ {c}</span>)}
                {note.published ? <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-ok/15 px-2 text-[11px] text-ok"><Globe size={11} /> Published</span> : null}
              </div>
              <StudyTimer noteId={note.id} />
              {!isCanvas && !isRoadmap && wide && <Segmented value={mode} onChange={(m) => setUI({ mode: m })} options={modes} />}
              {isRoadmap && <Segmented value={rmEdit ? "edit" : "map"} onChange={(x) => setRmEdit(x === "edit")} options={[{ value: "map", label: <><MapIcon size={13} /> Roadmap</> }, { value: "edit", label: <><Pencil size={13} /> Edit</> }]} />}
              <IconButton label="Side panel" active={!!ui.panel} onClick={() => setUI({ panel: ui.panel ? null : "outline" })}><PanelRight size={17} /></IconButton>
              <div className="relative">
                <IconButton label="More" active={menu} onClick={() => setMenu((m) => !m)}><MoreHorizontal size={18} /></IconButton>
                {menu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
                    <div className="absolute right-0 top-full z-40 mt-1 w-60 rounded-[12px] border border-line bg-surface p-1.5 shadow-xl fade-in" onClick={() => setMenu(false)}>
                      <button className={item} onClick={() => updateNote(note.id, { pinned: note.pinned ? 0 : 1 })}><Pin size={15} /> {note.pinned ? "Unpin" : "Pin"}</button>
                      <button className={item} onClick={() => updateNote(note.id, { favorite: note.favorite ? 0 : 1 })}><Star size={15} /> {note.favorite ? "Remove favorite" : "Favorite"}</button>
                      <button className={item} onClick={() => setPublish(true)}><Globe size={15} /> {note.published ? "Blog settings…" : "Publish to blog…"}</button>
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
                      <button className={item + " text-bad"} onClick={async () => { await trashNote(note.id); setUI({ noteId: null }); toast("Moved to trash", { label: "Undo", run: () => { void restoreNote(note.id); openNote(note.id); } }); }}><Trash2 size={15} /> Move to trash</button>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="mx-auto w-full px-4 pb-2 md:px-8" style={{ maxWidth: isCanvas || isRoadmap ? undefined : "calc(var(--measure) + 64px)" }}>
              <input
                ref={titleRef}
                key={note.id}
                defaultValue={note.title}
                onBlur={(e) => e.target.value.trim() && e.target.value !== note.title && updateNote(note.id, { title: e.target.value.trim() })}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                dir="auto"
                className="w-full bg-transparent text-[22px] font-bold tracking-tight outline-none md:text-[26px]"
                placeholder="Title"
              />
            </div>
            {!isCanvas && !isRoadmap && !wide && (
              <div className="flex justify-center pb-2">
                <Segmented value={mode === "split" ? "read" : mode} onChange={(m) => setUI({ mode: m })} options={modes.filter((m) => m.value !== "split")} />
              </div>
            )}
          </header>
        )}

        {/* body */}
        <div className="min-h-0 flex-1">
          {isBoard ? (
            <Suspense fallback={<div className="p-8 text-muted">Loading whiteboard…</div>}><Whiteboard key={note.id} note={note} /></Suspense>
          ) : isCanvas ? (
            <CanvasEditor key={note.id} note={note} />
          ) : isRoadmap && !rmEdit ? (
            <RoadmapView note={note} />
          ) : isRoadmap ? (
            <Editor key={note.id} note={note} />
          ) : effMode === "edit" ? (
            <Editor key={note.id} note={note} />
          ) : effMode === "focus" ? (
            <div className="relative h-full">
              <Editor key={note.id} note={note} focus />
              <button onClick={() => setUI({ mode: "split" })} className="absolute right-4 top-3 text-[11.5px] text-muted hover:text-ink">Esc to exit focus</button>
            </div>
          ) : effMode === "review" ? (
            <ReviewSession key={note.id} notes={[note]} title={note.title} />
          ) : effMode === "split" ? (
            <div className="grid h-full grid-cols-2">
              <div className="min-h-0 border-r border-line"><Editor key={note.id} note={note} /></div>
              <div className="min-h-0 overflow-y-auto px-8 py-6"><Preview note={note} onLine={(l) => scrollEditorToLine(l)} /><div className="h-[30vh]" /></div>
            </div>
          ) : (
            <div className="h-full overflow-y-auto px-5 py-6 md:px-8" onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input")) setUI({ mode: wide ? "split" : "edit" }); }}>
              {note.body.trim() ? <Preview note={note} /> : <div className="prose text-muted">Empty note. Double-click or press <b>Edit</b> to write.</div>}
              <Backlinks note={note} />
              <div className="h-[30vh]" />
            </div>
          )}
        </div>
      </div>
      <RightPanel note={note} />

      <PublishSheet note={note} open={publish} onClose={() => setPublish(false)} />
      <Sheet open={localGraph} onClose={() => setLocalGraph(false)} title={`Local graph: ${note.title}`} wide>
        <div className="h-[60vh]"><GraphView localTo={note.id} /></div>
      </Sheet>
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

function PublishSheet({ note, open, onClose }: { note: Note; open: boolean; onClose: () => void }) {
  const [slug, setSlug] = useState(note.slug || slugify(note.title));
  const [excerpt, setExcerpt] = useState(note.props.excerpt ?? "");
  useEffect(() => { if (open) { setSlug(note.slug || slugify(note.title)); setExcerpt(note.props.excerpt ?? ""); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const url = `${API_BASE || location.origin}/blog/${slug}`;
  return (
    <Sheet open={open} onClose={onClose} title={note.published ? "Blog post settings" : "Publish to your blog"}>
      <div className="space-y-3">
        <label className="block text-[12px] text-muted">Slug<input className={inputCls} value={slug} onChange={(e) => setSlug(slugify(e.target.value))} /></label>
        <label className="block text-[12px] text-muted">Excerpt (optional)<textarea className={inputCls + " h-20 py-2"} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} /></label>
        <div className="text-[12px] text-muted">Public URL: <span className="text-link">{url}</span>. Published posts are public to anyone with the link, appear on <code>/blog</code>, and are in the RSS feed. Images in the post are public too.</div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={async () => { await updateNote(note.id, { published: 1, slug, props: { ...note.props, excerpt } }); toast("Published. Live after the next sync."); onClose(); }}>{note.published ? "Save" : "Publish"}</Button>
          {note.published ? <Button variant="danger" onClick={async () => { await updateNote(note.id, { published: 0 }); toast("Unpublished"); onClose(); }}>Unpublish</Button> : null}
          {note.published ? <Button variant="ghost" onClick={() => open && window.open(url, "_blank")}>Open</Button> : null}
        </div>
      </div>
    </Sheet>
  );
}

