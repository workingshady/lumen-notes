import { CircleAlert, CircleCheck, CloudOff, Copy, FileText, GitMerge, Globe, History, House, Info, LayoutGrid, Layers, Link2, Menu, Plus, Trash2 } from "lucide-react";
import { FirstSyncCard } from "./components/first-sync"; // Lumen 22: first sync on a new device
import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ConflictSheet } from "./components/ws-conflict";
import { createNote } from "./lib/actions";
import { DEMO, setDemo, setMeta } from "./lib/db";
import { dismissToast, getUI, openNote, runLatestUndo, setRailAuto, setUI, sidebarRail, toast, toggleSidebar, useToasts, useUI, useVaultSelector, sameNote, type Toast } from "./lib/store";
import { currentIdx, installNavHistory, keepPlace, restoreFrom } from "./lib/nav-history";
import { useDeviceHeartbeat } from "./lib/devices";
import { useFaviconBadge } from "./lib/favicon";
import { useAllPathMoments, useStreakMoment } from "./components/Moments";
import { Sidebar } from "./components/Sidebar";
import { Skeleton } from "./components/Skeleton";
import { NoteList } from "./components/NoteList";
import { TagMenuHost, TagPage } from "./components/TagPage";
import { Palette } from "./components/Palette";
import { NewMenuHost, openNewMenu } from "./components/NewMenu";
import { ImportExportDialog, NewSpaceDialog } from "./components/Dialogs";
import { DiagramExport } from "./components/DiagramExport";
import { useDueCount } from "./lib/due-cards";
import { cx, IconButton } from "./components/ui";
import { LumenMark } from "./components/LumenMark";
import { OfflineBanner } from "./components/ws-sync";
import { readNativeShare, readWebShare, ShareSheet, useShared } from "./components/ws-share";
import { num, useRtl } from "./components/ws-dir";
import { digits, t, tx, useLang } from "./lib/i18n";
import { Home } from "./views/Home";
import { needsWelcome, Welcome } from "./views/Welcome";
import { lazy, Suspense } from "react";

// Heavy screens load on demand (faster start on phones / the APK).
const Productivity = () => import("./views/Productivity");
const TasksView = lazy(() => Productivity().then((m) => ({ default: m.TasksView })));
const KanbanView = lazy(() => Productivity().then((m) => ({ default: m.KanbanView })));
const CalendarView = lazy(() => Productivity().then((m) => ({ default: m.CalendarView })));
const TableView = lazy(() => Productivity().then((m) => ({ default: m.TableView })));
const ReviewView = lazy(() => Productivity().then((m) => ({ default: m.ReviewView })));
const FoldersView = lazy(() => import("./views/FoldersView").then((m) => ({ default: m.FoldersView })));
const TrashView = lazy(() => Productivity().then((m) => ({ default: m.TrashView })));
const PathsList = lazy(() => import("./views/path-list").then((m) => ({ default: m.PathsList })));
const TodayView = lazy(() => import("./views/TodayView").then((m) => ({ default: m.TodayView })));
const GraphView = lazy(() => import("./views/GraphView").then((m) => ({ default: m.GraphView })));
const SpaceView = lazy(() => import("./views/SpaceView").then((m) => ({ default: m.SpaceView })));
const SettingsView = lazy(() => import("./views/Settings").then((m) => ({ default: m.SettingsView })));
const Blog = lazy(() => import("./views/Blog").then((m) => ({ default: m.Blog })));
const Shared = lazy(() => import("./views/Shared").then((m) => ({ default: m.Shared })));
const Remote = lazy(() => import("./views/Remote").then((m) => ({ default: m.Remote })));
// The note screen (CodeMirror, KaTeX, highlight.js) loads on first open, behind the note skeleton.
const loadNoteView = () => import("./components/NoteView");
const NoteView = lazy(() => loadNoteView().then((m) => ({ default: m.NoteView })));
const Loading = () => {
  const v = useUI().view;
  return <Skeleton kind={v === "graph" ? "graph" : v === "tasks" || v === "table" || v === "kanban" || v === "trash" ? "list" : "note"} />;
};

export default function App() {
  useLang(); // re-render the whole tree when the interface language / digits change (live switch)
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const f = () => setPath(location.pathname);
    addEventListener("popstate", f);
    return () => removeEventListener("popstate", f);
  }, []);
  if (path === "/blog" || path.startsWith("/blog/")) return <Suspense fallback={<Loading />}><Blog path={path} /></Suspense>;
  if (path.startsWith("/s/")) return <Suspense fallback={<Loading />}><Shared path={path} /></Suspense>;
  if (path.startsWith("/remote/")) return <Suspense fallback={<Loading />}><Remote path={path} /></Suspense>;
  return <Gate />;
}

/** Native share intents open a translucent activity over the source app: render only the "Save to Lumen" sheet there. */
let nativeShareChecked: Promise<boolean> | null = null;
function Gate() {
  const [welcome, setWelcome] = useState(needsWelcome);
  const [shareOnly, setShareOnly] = useState<boolean | null>(Capacitor.isNativePlatform() ? null : false);
  const shared = useShared();
  useEffect(() => {
    readWebShare();
    nativeShareChecked ??= readNativeShare();
    void nativeShareChecked.then((yes) => setShareOnly(yes));
  }, []);
  useEffect(() => {
    if (!shareOnly) return;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, [shareOnly]);
  if (shareOnly === null) return null; // a few ms while the plugin answers
  if (shareOnly) return shared ? <><ShareSheet /><Toasts /></> : <Toasts />;
  return welcome ? <Welcome onDone={() => setWelcome(false)} /> : <Workspace />;
}

function useWide() {
  const [w, setW] = useState(() => innerWidth >= 900);
  useEffect(() => { const f = () => setW(innerWidth >= 900); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  return w;
}

function useTablet() {
  const f = () => innerWidth >= 900 && innerWidth < 1200;
  const [t, setT] = useState(f);
  useEffect(() => { const h = () => setT(f()); addEventListener("resize", h); return () => removeEventListener("resize", h); }, []);
  return t;
}

/** Android / browser Back + Forward (design: Lumen 12 · R3-5F "Back gesture order"):
 *  1 close the open sheet / popover · 2 leave a mode (Focus, Slides, selection) · 3 dismiss the keyboard ·
 *  4 go to the previous page in the real history (every page is a history entry, see lib/nav-history.ts; Forward works too) ·
 *  5 phone / app at the first page: "Swipe again to exit". */
function useBackGesture(wide: boolean) {
  const lastExit = useRef(0);
  useEffect(() => {
    installNavHistory();
    const phone = !wide || Capacitor.isNativePlatform();
    // phones / the app: a guard entry under the first page, so Back there asks "swipe again to exit" instead of leaving
    if (phone && !sessionStorage.getItem("lumen.navGuard")) {
      const cur = history.state;
      history.replaceState({ lumenGuard: 1 }, "");
      history.pushState(cur, "");
      sessionStorage.setItem("lumen.navGuard", "1");
    }
    const closeLayer = (): boolean => {
      // 1 · sheets / popovers
      const sheet = [...document.querySelectorAll<HTMLElement>(".sheet-in")].pop();
      if (sheet) {
        dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        const backdrop = sheet.parentElement;
        setTimeout(() => { if (sheet.isConnected && backdrop) backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); }, 0);
        return true;
      }
      const u = getUI();
      if (u.palette || u.newSpace || u.io) { setUI({ palette: false, newSpace: false, io: false }); return true; }
      if (u.panel && phone) { setUI({ panel: null }); return true; }
      if (u.sidebar && phone) { setUI({ sidebar: false }); return true; }
      // 2 · modes
      if (u.view === "notes" && u.noteId && (u.mode === "focus" || u.mode === "slides" || u.mode === "review")) { setUI({ mode: wide ? "split" : "edit" }); return true; }
      // 3 · keyboard
      const a = document.activeElement as HTMLElement | null;
      if (phone && a && (a.isContentEditable || a.tagName === "INPUT" || a.tagName === "TEXTAREA")) { a.blur(); return true; }
      return false;
    };
    const onPop = (e: PopStateEvent) => {
      // Forward never closes layers; Back closes the top layer first and keeps the page
      const goingBack = !e.state?.lumen || (e.state.idx as number) < currentIdx();
      if (goingBack && closeLayer()) { keepPlace(); return; }
      if (restoreFrom(e.state)) return; // 4 · previous / next page
      if (e.state?.lumenGuard) {
        // 5 · first page on a phone: swipe again to exit
        if (Date.now() - lastExit.current < 2000) { sessionStorage.removeItem("lumen.navGuard"); history.back(); return; }
        lastExit.current = Date.now();
        toast(t("Swipe back again to close Lumen"), undefined, { ms: 2000, variant: "pill", icon: "none" });
        keepPlace();
      }
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [wide]);
}

/** Pages the design draws with the collapsed sidebar rail (LumenSidebar `collapsed` in the R4 desks + Lumen 04/07/08/11/17/20). */
const RAIL_TYPES = new Set(["path", "pdf", "base", "dashboard", "canvas", "whiteboard", "board"]);
function autoRail(ui: ReturnType<typeof getUI>, note: { type: string } | undefined, space: { kind: string; roadmapId: string | null } | undefined): boolean {
  if (ui.view === "today" || ui.view === "graph" || ui.view === "settings") return true;
  if (ui.view === "space") return !!space && (space.kind === "project" || (space.kind === "course" && !!space.roadmapId));
  if (ui.view !== "notes" || !note) return false;
  return !ui.list || RAIL_TYPES.has(note.type) || ui.mode === "focus" || ui.mode === "slides";
}

function Workspace() {
  const ui = useUI();
  // Narrow vault reads: the shell must not re-render on every save (the open note re-renders in OpenNote).
  const noteType = useVaultSelector((v) => (ui.noteId ? v.byId.get(ui.noteId)?.type : undefined));
  const note = ui.noteId && noteType ? { id: ui.noteId, type: noteType } : undefined;
  const space = useVaultSelector((v) => (ui.view === "space" ? v.spaceMap.get(ui.spaceId) : undefined));
  const ready = useVaultSelector((v) => v.ready);
  const wide = useWide();
  const tablet = useTablet();
  const rtl = useRtl();
  useBackGesture(wide);
  useDeviceHeartbeat(); // Settings › Sync › Devices (lib/devices.ts)
  useEffect(() => { const t = setTimeout(() => void loadNoteView().catch(() => {}), 1500); return () => clearTimeout(t); }, []); // warm the note screen once the shell is up

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "\\") { e.preventDefault(); toggleSidebar(); }
      // ⌘Z / Ctrl Z outside text fields runs the newest Undo toast
      const el = e.target as HTMLElement;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !el.closest("input,textarea,[contenteditable=true],.cm-editor") && runLatestUndo()) e.preventDefault();
    };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, []);

  const notesView = ui.view === "notes";
  // the tag page (R6-30M) lists the tag's notes itself, so the list pane steps aside until a note is opened
  const showList = notesView && (wide ? ui.list && !(ui.tag && !note && !ui.filter) : !note);
  const showNote = notesView && (wide || !!note);

  let main: React.ReactNode = null;
  if (notesView) main = note ? <OpenNote key={note.id} id={note.id} /> : <PickNote />;
  else if (ui.view === "home") main = <Home />;
  else if (ui.view === "today") main = <TodayView />;
  else if (ui.view === "tasks") main = <TasksView />;
  else if (ui.view === "kanban") main = <KanbanView />;
  else if (ui.view === "calendar") main = <CalendarView />;
  else if (ui.view === "table") main = <TableView />;
  else if (ui.view === "review") main = <ReviewView />;
  else if (ui.view === "graph") main = <GraphView />;
  else if (ui.view === "space") main = <SpaceView />;
  else if (ui.view === "settings") main = <SettingsView />;
  else if (ui.view === "trash") main = <TrashView />;
  else if (ui.view === "folders") main = <FoldersView />;

  const inNote = notesView && !!note && !wide;
  setRailAuto(autoRail(ui, note, space));

  return (
    <div className="flex h-full overflow-hidden">
      {/* sidebar: docked on desktop, drawer on phone */}
      {/* tablet (900–1199): rail docked, full sidebar opens as a drawer over the content */}
      {wide && tablet && <Sidebar rail />}
      {wide && !tablet ? <Sidebar rail={sidebarRail(ui)} /> : ui.sidebar && (
        <div className="fixed inset-0 z-40 flex fade-in">
          <div className="sheet-in shadow-2xl"><Sidebar /></div>
          <div className="flex-1 bg-black/50" onClick={() => setUI({ sidebar: false })} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <div className="flex min-h-0 flex-1">
          {showList && (
            // list pane: 320 px (ScreenWorkspace); smart-folder lists are drawn 360 px (Lumen 20b · D7), from 1200 px up so the note keeps room
            <div className={cx("min-h-0 border-e border-line bg-bg", wide ? (ui.filter?.startsWith("smart:") && !tablet ? "w-[360px] shrink-0" : "w-[330px] shrink-0") : "flex-1")}>
              <NoteList />
            </div>
          )}
          {(showNote || !notesView) && (
            <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1"><Suspense fallback={<Loading />}>{main}</Suspense></div>
              {wide && notesView && (
                <IconButton label={ui.list ? t("Hide note list") : t("Show note list")} className="absolute bottom-3 end-3 z-20 border border-line bg-surface opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100" onClick={() => setUI({ list: !ui.list })}><Menu size={16} /></IconButton>
              )}
            </main>
          )}
        </div>

        {/* phone tab bar (design: LumenTabBar) */}
        {!wide && !inNote && <TabBar rtl={rtl} onNew={async () => { /* phone: + on the Visual list opens the "New…" sheet (R4-17 A5), on Learning paths the new-path dialog */ if (ui.view === "notes" && (ui.filter === "visual" || ui.filter === "paths")) { dispatchEvent(new Event(ui.filter === "visual" ? "lumen:new-visual" : "lumen:new-path")); return; } openNewMenu(); }} />}
      </div>

      <Palette />
      <FirstSyncCard />
      <NewMenuHost />
      <TagMenuHost />
      <NewSpaceDialog />
      <ImportExportDialog />
      <DiagramExport />
      <ConflictSheet />
      <ShareSheet />
      <Toasts />
      <Splash ready={ready} />
      <VaultWatchers />
      {DEMO && (
        <div className="fixed bottom-[76px] start-3 z-[70] flex items-center md:bottom-12 gap-2 rounded-full border border-[color-mix(in_srgb,var(--learn)_45%,transparent)] bg-[color-mix(in_srgb,var(--learn)_14%,var(--bg))] py-0.5 pe-1 ps-2.5 text-[11.5px] font-medium text-learn shadow-sm">
          {t("Demo data")}
          <button onClick={async () => { await setMeta("demoSeeded", 0); location.reload(); }} className="rounded-full px-1.5 hover:bg-surface-2" title={t("Reset demo data")}>{t("Reset")}</button>
          <button onClick={() => setDemo(false)} className="rounded-full bg-surface px-2 text-ink hover:bg-surface-2">{t("Exit")}</button>
        </div>
      )}
    </div>
  );
}

/** The open note: subscribes to that one note, so saving it re-renders the note screen, not the whole shell. */
function OpenNote({ id }: { id: string }) {
  const note = useVaultSelector((v) => v.byId.get(id), sameNote);
  return note ? <NoteView note={note} /> : null;
}

/** App-wide vault watchers, in a leaf so their vault subscriptions don't re-render the shell. */
function VaultWatchers() {
  useFaviconBadge(useDueCount()); // Lumen 21 · favicon review-due badge (here, not in Sidebar: phones have no docked sidebar)
  useStreakMoment(); // Lumen 21 · moments: streak
  useAllPathMoments(); // Lumen 21 · moments: unlock + mastered on any learning path change (Today, roadmaps, path page)
  return null;
}

function PickNote() {
  const ui = useUI();
  if (ui.filter === "paths") return <Suspense fallback={null}><PathsList /></Suspense>;
  if (ui.tag && !ui.filter) return <TagPage tag={ui.tag} />;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2.5 px-10 text-center">
      <span className="text-[16px] font-semibold">{t("Pick a note")}</span>
      <span className="max-w-[340px] text-[13px] leading-5 text-muted">{tx("Or press {search} to search, {newNote} for a new note.", { search: <kbd className="rounded-[4px] border border-line px-[5px] font-mono text-[11px]">Ctrl K</kbd>, newNote: <kbd className="rounded-[4px] border border-line px-[5px] font-mono text-[11px]">Ctrl Alt N</kbd> })}</span>
      <button className="mt-2 flex h-9 items-center gap-1.5 rounded-[10px] bg-accent px-3.5 text-[13px] font-semibold text-accent-fg" onClick={async () => openNote((await createNote({ spaceId: ui.spaceId === "all" ? "inbox" : ui.spaceId, folderId: ui.folderId })).id, "edit")}><Plus size={14} />{t("New note")}</button>
    </div>
  );
}

/** Splash (design: Lumen 00 · Splash & launch): plain bg, the mark centred, lamp warms up 0→45% in 240 ms,
 *  then the UI fades in underneath. Launches under 300 ms skip it. */
function Splash({ ready }: { ready: boolean }) {
  const [state, setState] = useState<"wait" | "show" | "out" | "gone">("wait");
  useEffect(() => { const t = setTimeout(() => setState((s) => (s === "wait" ? "show" : s)), 300); return () => clearTimeout(t); }, []);
  useEffect(() => { if (ready) setState((s) => (s === "show" ? "out" : "gone")); }, [ready]);
  useEffect(() => { if (state === "out") { const t = setTimeout(() => setState("gone"), 520); return () => clearTimeout(t); } }, [state]);
  if (state === "wait" || state === "gone") return null;
  return (
    <div className={cx("fixed inset-0 z-[90] flex items-center justify-center bg-[#0F1115]", state === "out" && "splash-out")} aria-hidden>
      <div className="pointer-events-none absolute left-1/2 top-1/2 size-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full splash-glow" style={{ background: "radial-gradient(circle, rgba(242,169,59,.10), transparent 62%)" }} />
      <div className="splash-glow"><LumenMark size={96} tile="glyph" /></div>
    </div>
  );
}

const TOAST_ICON: Record<NonNullable<Toast["icon"]>, React.ReactNode> = {
  trash: <Trash2 size={16} className="text-muted" />, merge: <GitMerge size={16} className="text-warn" />, globe: <Globe size={16} className="text-ok" />,
  link: <Link2 size={16} className="text-info" />, history: <History size={16} className="text-muted" />, check: <CircleCheck size={16} className="text-ok" />,
  error: <CircleAlert size={16} className="text-bad" />, offline: <CloudOff size={16} className="text-warn" />, info: <Info size={16} className="text-muted" />,
  copy: <Copy size={16} className="text-muted" />, none: null,
};
/** Toasts (design: 06b · 22F conflict, 22G delete + undo with an 8 s progress line; Components · Toast). */
function Toasts() {
  const ts = useToasts();
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[84px] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {ts.map((x) => x.variant === "pill" ? (
        <div key={x.id} role="status" className="pointer-events-auto flex h-10 items-center rounded-[20px] bg-ink px-4 text-[14px] font-medium text-bg fade-in" dir="auto">{x.text}</div>
      ) : (
        <div key={x.id} role="status" className="pointer-events-auto relative flex w-full max-w-[420px] items-center gap-3 overflow-hidden rounded-[10px] border border-line bg-surface-2 px-3.5 py-3 text-[13px] shadow-[0_12px_32px_rgba(0,0,0,.4)] fade-in">
          {x.icon && TOAST_ICON[x.icon]}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className={cx(x.sub && "font-semibold")} dir="auto">{x.text}</span>
            {x.sub && <span className="text-[12px] text-muted" dir="auto">{x.sub}</span>}
          </div>
          {x.action && (x.actionStyle === "button" ? (
            <button className="flex h-7 shrink-0 items-center rounded-[8px] border border-line px-2.5 font-semibold" onClick={() => { x.action!.run(); dismissToast(x.id); }}>
              {x.action.label}{(/undo/i.test(x.action.label) || x.action.label === t("Undo")) && <span className="ms-1.5 hidden font-mono text-[11px] font-medium text-muted md:inline">{mac ? "⌘Z" : "Ctrl Z"}</span>}
            </button>
          ) : (
            <button className="shrink-0 font-medium text-link" onClick={() => { x.action!.run(); dismissToast(x.id); }}>{x.action.label}</button>
          ))}
          {x.action && x.actionStyle === "button" && <span className="absolute bottom-0 start-0 h-0.5 bg-muted opacity-60" style={{ animation: `toastbar ${x.ms}ms linear forwards` }} />}
        </div>
      ))}
      <style>{"@keyframes toastbar { from { width: 100%; } to { width: 0%; } }"}</style>
    </div>
  );
}

function TabBar({ onNew, rtl }: { onNew: () => void; rtl: boolean }) {
  const ui = useUI();
  const due = useDueCount();
  const active = ui.sidebar || ui.view === "settings" ? "more" : ui.view === "home" ? "home" : ui.view === "notes" ? "notes" : ui.view === "review" ? "review" : "none";
  const tab = (k: string, icon: React.ReactNode, label: string, onClick: () => void, badge?: number) => {
    const on = active === k;
    return (
      <button key={k} onClick={onClick} className={cx("flex flex-col items-center gap-[3px]", on ? "text-ink" : "text-muted")}>
        <span className="relative flex h-7 w-14 items-center justify-center rounded-[14px]" style={{ background: on ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent" }}>
          {icon}
          {!!badge && <span className="absolute -top-[3px] end-1.5 h-4 min-w-[18px] rounded-lg bg-learn px-1 text-center text-[10px] font-bold leading-4 text-[#14101C]">{badge > 99 ? digits("99+") : num(badge, rtl)}</span>}
        </span>
        <span className={cx("text-[11px]", on ? "font-semibold" : "font-medium")}>{label}</span>
      </button>
    );
  };
  return (
    <nav className="safe-b shrink-0 border-t border-line bg-surface">
      <div className="grid h-16 grid-cols-5 items-center">
        {tab("home", <House size={20} />, t("Home"), () => setUI({ view: "home", sidebar: false }))}
        {tab("notes", <FileText size={20} />, t("Notes"), () => setUI({ view: "notes", noteId: null, sidebar: false }))}
        <div className="flex justify-center">
          <button aria-label={t("New…")} onClick={onNew} className="-mt-[26px] flex size-14 items-center justify-center rounded-[18px] bg-accent text-accent-fg" style={{ boxShadow: "0 0 0 5px var(--bg)" }}><Plus size={26} /></button>
        </div>
        {tab("review", <Layers size={20} />, t("Review"), () => setUI({ view: "review", sidebar: false }), due)}
        {tab("more", <LayoutGrid size={20} />, t("More"), () => setUI({ view: "settings", sidebar: false }))}
      </div>
    </nav>
  );
}
