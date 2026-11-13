import { Brain, FileText, Home as HomeIcon, Menu, PanelLeft, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { createNote } from "./lib/actions";
import { openNote, setUI, useToasts, useUI, useVault } from "./lib/store";
import { Sidebar } from "./components/Sidebar";
import { NoteList } from "./components/NoteList";
import { NoteView } from "./components/NoteView";
import { Palette } from "./components/Palette";
import { ImportExportDialog, NewSpaceDialog } from "./components/Dialogs";
import { useDueCards } from "./components/Review";
import { cx, Empty, IconButton } from "./components/ui";
import { Home } from "./views/Home";
import { lazy, Suspense } from "react";

// Heavy screens load on demand (faster start on phones / the APK).
const Productivity = () => import("./views/Productivity");
const TasksView = lazy(() => Productivity().then((m) => ({ default: m.TasksView })));
const KanbanView = lazy(() => Productivity().then((m) => ({ default: m.KanbanView })));
const CalendarView = lazy(() => Productivity().then((m) => ({ default: m.CalendarView })));
const TableView = lazy(() => Productivity().then((m) => ({ default: m.TableView })));
const ReviewView = lazy(() => Productivity().then((m) => ({ default: m.ReviewView })));
const TrashView = lazy(() => Productivity().then((m) => ({ default: m.TrashView })));
const GraphView = lazy(() => import("./views/GraphView").then((m) => ({ default: m.GraphView })));
const SpaceView = lazy(() => import("./views/SpaceView").then((m) => ({ default: m.SpaceView })));
const SettingsView = lazy(() => import("./views/Settings").then((m) => ({ default: m.SettingsView })));
const Blog = lazy(() => import("./views/Blog").then((m) => ({ default: m.Blog })));
const Shared = lazy(() => import("./views/Shared").then((m) => ({ default: m.Shared })));
const Loading = () => <div className="flex h-full items-center justify-center text-[13px] text-muted">Loading…</div>;

export default function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const f = () => setPath(location.pathname);
    addEventListener("popstate", f);
    return () => removeEventListener("popstate", f);
  }, []);
  if (path === "/blog" || path.startsWith("/blog/")) return <Suspense fallback={<Loading />}><Blog path={path} /></Suspense>;
  if (path.startsWith("/s/")) return <Suspense fallback={<Loading />}><Shared path={path} /></Suspense>;
  return <Workspace />;
}

function useWide() {
  const [w, setW] = useState(() => innerWidth >= 900);
  useEffect(() => { const f = () => setW(innerWidth >= 900); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  return w;
}

function Workspace() {
  const ui = useUI();
  const v = useVault();
  const wide = useWide();
  const note = ui.noteId ? v.byId.get(ui.noteId) : undefined;
  const due = useDueCards(v.notes)?.length ?? 0;

  // Android/browser back button closes overlays first, then leaves the note.
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "\\") { e.preventDefault(); setUI((u) => ({ sidebar: !u.sidebar })); } };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, []);

  const notesView = ui.view === "notes";
  const showList = notesView && (wide ? ui.list : !note);
  const showNote = notesView && (wide || !!note);

  let main: React.ReactNode = null;
  if (notesView) main = note ? <NoteView key={note.id} note={note} /> : <Empty icon={<FileText size={34} />} title="Pick a note" hint="Or press Ctrl K to search, Ctrl Alt N for a new note." />;
  else if (ui.view === "home") main = <Home />;
  else if (ui.view === "tasks") main = <TasksView />;
  else if (ui.view === "kanban") main = <KanbanView />;
  else if (ui.view === "calendar") main = <CalendarView />;
  else if (ui.view === "table") main = <TableView />;
  else if (ui.view === "review") main = <ReviewView />;
  else if (ui.view === "graph") main = <GraphView />;
  else if (ui.view === "space") main = <SpaceView />;
  else if (ui.view === "settings") main = <SettingsView />;
  else if (ui.view === "trash") main = <TrashView />;

  const spaceId = ui.spaceId === "all" ? "inbox" : ui.spaceId;
  const tab = (active: boolean) => cx("flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px]", active ? "text-accent" : "text-muted");
  const inNote = notesView && !!note && !wide;

  return (
    <div className="flex h-full overflow-hidden">
      {/* sidebar: docked on desktop, drawer on phone */}
      {wide ? (ui.sidebar && <Sidebar />) : ui.sidebar && (
        <div className="fixed inset-0 z-40 flex fade-in">
          <div className="sheet-in shadow-2xl"><Sidebar /></div>
          <div className="flex-1 bg-black/50" onClick={() => setUI({ sidebar: false })} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* desktop: floating sidebar toggle when collapsed */}
        {wide && !ui.sidebar && (
          <IconButton label="Show sidebar (Ctrl \\)" className="fixed bottom-3 left-3 z-30 border border-line bg-surface" onClick={() => setUI({ sidebar: true })}><PanelLeft size={17} /></IconButton>
        )}
        <div className="flex min-h-0 flex-1">
          {showList && (
            <div className={cx("min-h-0 border-r border-line bg-bg", wide ? "w-[320px] shrink-0" : "flex-1")}>
              {!wide && <MobileTop />}
              <NoteList />
            </div>
          )}
          {(showNote || !notesView) && (
            <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {!wide && !notesView && <MobileTop />}
              <div className="min-h-0 flex-1"><Suspense fallback={<Loading />}>{main}</Suspense></div>
              {wide && notesView && (
                <IconButton label={ui.list ? "Hide note list" : "Show note list"} className="absolute bottom-3 right-3 z-20 border border-line bg-surface md:flex" onClick={() => setUI({ list: !ui.list })}><Menu size={16} /></IconButton>
              )}
            </main>
          )}
        </div>

        {/* phone bottom bar */}
        {!wide && !inNote && (
          <nav className="safe-b flex h-[60px] shrink-0 items-stretch border-t border-line bg-surface">
            <button className={tab(ui.view === "home")} onClick={() => setUI({ view: "home" })}><HomeIcon size={20} />Home</button>
            <button className={tab(ui.view === "notes")} onClick={() => setUI({ view: "notes", noteId: null })}><FileText size={20} />Notes</button>
            <div className="flex flex-1 items-center justify-center">
              <button aria-label="New note" onClick={async () => openNote((await createNote({ spaceId, folderId: ui.folderId })).id, "edit")} className="-mt-6 flex size-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg"><Plus size={26} /></button>
            </div>
            <button className={tab(ui.view === "review")} onClick={() => setUI({ view: "review" })}>
              <span className="relative"><Brain size={20} />{due > 0 && <span className="absolute -right-2 -top-1 rounded-full bg-learn px-1 text-[9px] font-bold text-white">{due}</span>}</span>Review
            </button>
            <button className={tab(ui.sidebar)} onClick={() => setUI({ sidebar: true })}><Menu size={20} />More</button>
          </nav>
        )}
      </div>

      <Palette />
      <NewSpaceDialog />
      <ImportExportDialog />
      <Toasts />
    </div>
  );
}

function MobileTop() {
  return (
    <div className="safe-t flex h-12 items-center gap-1 border-b border-line px-2">
      <IconButton label="Menu" onClick={() => setUI({ sidebar: true })}><Menu size={19} /></IconButton>
      <button onClick={() => setUI({ palette: true })} className="flex h-9 flex-1 items-center gap-2 rounded-[10px] bg-surface-2 px-3 text-[13.5px] text-muted"><Search size={15} /> Search notes</button>
    </div>
  );
}

function Toasts() {
  const ts = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {ts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-2.5 text-[13.5px] shadow-xl fade-in">
          {t.text}
          {t.action && <button className="font-semibold text-accent" onClick={t.action.run}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}
