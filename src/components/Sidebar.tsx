import { CalendarDays, ChevronDown, ChevronRight, ChevronsUpDown, FileText, FolderTree as FolderTreeIcon, House, Inbox, LayoutDashboard, Layers, ListChecks, NotebookPen, Plus, Rss, Search, Settings, Trash2, Waypoints } from "lucide-react";
import { useMemo, useState } from "react";
import { SPACE_KINDS, type Folder, type Space } from "../../shared/types";
import { createFolder, createNote, dailyNote, deleteFolder, moveFolder, moveNote } from "../lib/actions";
import { patch } from "../lib/db";
import { natural, progress, roadmap, tasks } from "../lib/parse";
import { getSettings, useSettings } from "../lib/settings";
import { go, openNote, setUI, toast, useUI, useVault, type UI, type View } from "../lib/store";
import { RailSync, SidebarSync } from "./ws-sync";
import { num, tr, useRtl } from "./ws-dir";
import { PRESETS } from "../lib/canvas";
import { useDueCards } from "./Review";
import { cx } from "./ui";

export const KIND_LABEL: Record<Space["kind"], string> = { project: "Project", area: "Area", course: "Course", resource: "Resource", archive: "Archive" };
const colorOf = (c: string | null | undefined) => (c ? PRESETS[c] ?? c : null);

type NavKey = "home" | "inbox" | "daily" | "tasks" | "calendar" | "review" | "graph" | "canvas" | "blog";
interface NavItem { key: NavKey; icon: React.ReactNode; label: string; count?: number; learn?: boolean }

/** Which nav item is active for the current UI state. */
function activeKey(ui: UI): NavKey | null {
  if (ui.view === "notes") return ui.filter === "visual" ? "canvas" : ui.filter === "published" ? "blog" : ui.spaceId === "inbox" && !ui.folderId && !ui.tag && !ui.noteId ? "inbox" : null;
  return ({ home: "home", tasks: "tasks", kanban: "tasks", calendar: "calendar", review: "review", graph: "graph" } as Partial<Record<View, NavKey>>)[ui.view] ?? null;
}

function useNav(): NavItem[] {
  const v = useVault();
  const due = useDueCards(v.notes)?.length ?? 0;
  const openTasks = useMemo(() => v.notes.filter((n) => n.type !== "roadmap").reduce((a, n) => a + tasks(n.body).filter((t) => !t.done).length, 0), [v.notes]);
  const inbox = v.notes.filter((n) => n.spaceId === "inbox").length;
  return [
    { key: "home", icon: <House size={16} />, label: "Home" },
    { key: "inbox", icon: <Inbox size={16} />, label: "Inbox", count: inbox },
    { key: "daily", icon: <NotebookPen size={16} />, label: "Daily note" },
    { key: "tasks", icon: <ListChecks size={16} />, label: "Tasks", count: openTasks },
    { key: "calendar", icon: <CalendarDays size={16} />, label: "Calendar" },
    { key: "review", icon: <Layers size={16} />, label: "Review", count: due, learn: true },
    { key: "graph", icon: <Waypoints size={16} />, label: "Graph" },
    { key: "canvas", icon: <LayoutDashboard size={16} />, label: "Canvases" },
    { key: "blog", icon: <Rss size={16} />, label: "Blog" },
  ];
}

async function runNav(k: NavKey, spaceId: string) {
  const sp = spaceId === "all" ? "inbox" : spaceId;
  if (k === "home") go("home");
  else if (k === "inbox") go("notes", { spaceId: "inbox", folderId: null, tag: null, filter: null, noteId: null });
  else if (k === "daily") openNote((await dailyNote(sp)).id, "edit");
  else if (k === "canvas") go("notes", { spaceId: "all", folderId: null, tag: null, filter: "visual" });
  else if (k === "blog") go("notes", { spaceId: "all", folderId: null, tag: null, filter: "published" });
  else go(k as View);
}

/** Space switcher tile: emoji on a tinted square in the space color. */
function SpaceTile({ space, size = 28 }: { space?: Space; size?: number }) {
  const c = colorOf(space?.color) ?? "#A371F7";
  return (
    <div className="flex shrink-0 items-center justify-center" style={{ width: size, height: size, borderRadius: size / 4, background: `color-mix(in srgb, ${c} 20%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 50%, transparent)`, fontSize: size / 2 }}>
      {space?.icon ?? "🗂️"}
    </div>
  );
}

function useSpaceMeta(space?: Space) {
  const v = useVault();
  if (!space) return `${v.spaces.length} spaces`;
  if (space.kind === "course" && space.roadmapId) return `${progress(roadmap(v.byId.get(space.roadmapId)?.body ?? "")).pct}% done`;
  return `${v.notes.filter((n) => n.spaceId === space.id).length} notes`;
}

export function Sidebar({ rail }: { rail?: boolean }) {
  const ui = useUI();
  const v = useVault();
  const nav = useNav();
  const space = ui.spaceId === "all" ? undefined : v.spaceMap.get(ui.spaceId);
  const meta = useSpaceMeta(space);
  const [switcher, setSwitcher] = useState(false);
  const act = activeKey(ui);
  const rtl = useRtl();

  if (rail) {
    return (
      <aside className="safe-t flex h-full w-14 shrink-0 flex-col items-center gap-1 border-e border-line bg-surface py-2.5">
        <button title={space?.name ?? "All spaces"} onClick={() => setUI({ sidebar: true })} className="mb-1.5"><SpaceTile space={space} size={32} /></button>
        <RailBtn label="Search (Ctrl K)" onClick={() => setUI({ palette: true })}><Search size={16} /></RailBtn>
        {nav.map((n) => (
          <RailBtn key={n.key} label={tr(n.label, rtl)} active={act === n.key} dot={!!(n.learn && n.count)} onClick={() => runNav(n.key, ui.spaceId)}>{n.icon}</RailBtn>
        ))}
        <div className="my-1.5 h-px w-6 bg-line" />
        <RailBtn label="Folders" onClick={() => setUI({ sidebar: true })}><FolderTreeIcon size={16} /></RailBtn>
        <div className="flex-1" />
        <RailSync />
        <RailBtn label="Settings" active={ui.view === "settings"} onClick={() => go("settings")}><Settings size={16} /></RailBtn>
        <Avatar size={28} />
      </aside>
    );
  }

  return (
    <aside className="safe-t flex h-full w-[240px] shrink-0 flex-col border-e border-line bg-surface text-[13px]">
      <div className="relative flex flex-col gap-2 px-2.5 pb-2 pt-2.5">
        <button onClick={() => setSwitcher((s) => !s)} className={cx("flex items-center gap-2.5 rounded-[10px] border px-2 py-1.5 text-left", switcher ? "border-accent bg-surface-2" : "border-transparent hover:bg-surface-2")}>
          <SpaceTile space={space} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-semibold">{space?.name ?? tr("All spaces", rtl)}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted">
              {space && <span className="rounded-[4px] border border-line px-[5px] leading-[15px]">{tr(KIND_LABEL[space.kind], rtl)}</span>}
              <span>{rtl ? num(meta.replace(" done", "").replace(" notes", ""), true).replace("%", "٪") : meta}</span>
            </span>
          </span>
          <ChevronsUpDown size={14} className="text-muted" />
        </button>
        {switcher && <SpaceSwitcher onClose={() => setSwitcher(false)} />}
        <button onClick={() => setUI({ palette: true })} className="flex h-8 items-center gap-2 rounded-[6px] border border-line bg-bg px-2.5 text-muted hover:text-ink">
          <Search size={14} /><span className="flex-1 text-start">{tr("Search", rtl)}</span>
          <span dir="ltr" className="rounded-[4px] border border-line px-[5px] py-px font-mono text-[11px] font-medium leading-[14px]">{navigator.platform.includes("Mac") ? "⌘K" : "Ctrl K"}</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <nav className="flex flex-col gap-px px-2 py-0.5">
          {nav.map((n) => {
            const on = act === n.key;
            return (
              <button key={n.key} onClick={() => runNav(n.key, ui.spaceId)} className={cx("flex h-[30px] items-center gap-2.5 rounded-[6px] px-2 text-start transition-colors", on ? "bg-surface-2 font-semibold text-ink" : "font-[450] text-muted hover:bg-surface-2 hover:text-ink")}>
                <span className={cx("flex w-4 justify-center", on && "text-accent")}>{n.icon}</span>
                <span className="flex-1">{tr(n.label, rtl)}</span>
                {!!n.count && <span className={cx("text-[11px] font-semibold tabular-nums", n.learn ? "text-learn" : "text-muted")}>{num(n.count, rtl)}</span>}
              </button>
            );
          })}
        </nav>

        {ui.spaceId !== "all" && <FolderTree spaceId={ui.spaceId} />}
        <Tags />

        <div className="px-2 pt-2.5">
          <button onClick={() => go("trash")} className={cx("flex h-[30px] w-full items-center gap-2.5 rounded-[6px] px-2", ui.view === "trash" ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink")}><Trash2 size={16} /> {tr("Trash", rtl)}</button>
        </div>
      </div>

      <div className="safe-b flex items-center gap-2.5 border-t border-line px-3 py-2.5">
        <SidebarSync />
        <button title={tr("Settings", rtl)} onClick={() => go("settings")} className={cx("flex", ui.view === "settings" ? "text-accent" : "text-muted hover:text-ink")}><Settings size={16} /></button>
        <Avatar />
      </div>
    </aside>
  );
}

function RailBtn({ label, active, dot, onClick, children }: { label: string; active?: boolean; dot?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={label} aria-label={label} onClick={onClick} className={cx("relative flex h-8 w-9 items-center justify-center rounded-[6px]", active ? "bg-surface-2 text-accent" : "text-muted hover:bg-surface-2 hover:text-ink")}>
      {children}
      {dot && <span className="absolute end-[5px] top-1 size-1.5 rounded-full bg-learn" />}
    </button>
  );
}

function Avatar({ size = 26 }: { size?: number }) {
  const s = useSettings();
  return <button onClick={() => go("settings")} title={s.author || "Profile"} className="flex shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-[14px]" style={{ width: size, height: size }}>{s.avatar}</button>;
}

function SpaceSwitcher({ onClose }: { onClose: () => void }) {
  const ui = useUI();
  const v = useVault();
  const row = (on: boolean) => cx("flex h-8 w-full items-center gap-2.5 rounded-[6px] px-2 text-[13px]", on ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink");
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute inset-x-2.5 top-[52px] z-40 max-h-[60vh] overflow-y-auto rounded-[12px] border border-line bg-surface p-1.5 shadow-xl fade-in" onClick={onClose}>
        <button className={row(ui.spaceId === "all")} onClick={() => setUI({ spaceId: "all", folderId: null, filter: null })}><span className="w-5 text-center">🗂️</span> All spaces</button>
        {SPACE_KINDS.map((k) => {
          const list = v.spaces.filter((s) => s.kind === k && !s.archived);
          if (!list.length) return null;
          return (
            <div key={k} className="mt-1.5">
              <div className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[.06em] text-muted">{KIND_LABEL[k]}s</div>
              {list.map((s) => (
                <button key={s.id} className={row(ui.spaceId === s.id)} onClick={() => go(s.id === "inbox" || k === "area" || k === "resource" ? "notes" : "space", { spaceId: s.id, folderId: null, tag: null, filter: null })}>
                  <SpaceTile space={s} size={20} /><span className="flex-1 truncate text-left">{s.name}</span>
                  {colorOf(s.color) && <span className="size-1.5 rounded-full" style={{ background: colorOf(s.color)! }} />}
                </button>
              ))}
            </div>
          );
        })}
        {v.spaces.some((s) => s.archived) && (
          <details className="mt-1.5" onClick={(e) => e.stopPropagation()}>
            <summary className="cursor-pointer px-2 py-1 text-[11px] text-muted">Archived · {v.spaces.filter((s) => s.archived).length}</summary>
            {v.spaces.filter((s) => s.archived).map((s) => <button key={s.id} className={row(false)} onClick={() => { onClose(); go("space", { spaceId: s.id, folderId: null }); }}><span className="w-5 text-center">{s.icon}</span>{s.name}</button>)}
          </details>
        )}
        <div className="my-1 h-px bg-line" />
        <button className={row(false)} onClick={() => setUI({ newSpace: true })}><Plus size={15} /> New space…</button>
      </div>
    </>
  );
}

function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-2 pb-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">
      <span>{title}</span>{action}
    </div>
  );
}

function Tags() {
  const v = useVault();
  const ui = useUI();
  if (!v.tags.length) return null;
  return (
    <div className="px-2 pt-3.5">
      <SectionHead title={tr("Tags")} />
      <div className="flex flex-wrap gap-1 px-1.5">
        {v.tags.slice(0, 30).map(([t, c]) => (
          <button key={t} dir="ltr" onClick={() => go("notes", { tag: ui.tag === t ? null : t, folderId: null, filter: null })} className={cx("rounded-[6px] px-[7px] py-0.5 text-[12px]", ui.tag === t ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted hover:text-ink")}>
            #{t} <b className="font-medium opacity-70">{c}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

const DRAG = "application/x-lumen";
type DragData = { kind: "note" | "folder"; id: string };
export const dragNote = (e: React.DragEvent, id: string) => { e.dataTransfer.setData(DRAG, JSON.stringify({ kind: "note", id })); e.dataTransfer.effectAllowed = "move"; };

function FolderTree({ spaceId }: { spaceId: string }) {
  const v = useVault();
  const folders = v.folders.filter((f) => f.spaceId === spaceId);
  const counts = new Map<string, number>();
  v.notes.forEach((n) => n.folderId && counts.set(n.folderId, (counts.get(n.folderId) ?? 0) + 1));
  const [rootOver, setRootOver] = useState(false);

  async function drop(e: React.DragEvent, target: string | null) {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DRAG);
    if (!raw) return;
    const d = JSON.parse(raw) as DragData;
    if (d.kind === "note") await moveNote(d.id, spaceId, target);
    else { const f = v.folderMap.get(d.id); if (f && f.id !== target) await moveFolder(f, spaceId, target); }
  }

  return (
    <div className="px-2 pt-3.5">
      <SectionHead title={tr("Folders")} action={
        <button title="New folder" aria-label="New folder" className="hover:text-ink" onClick={() => createFolder(spaceId, null)}><Plus size={14} /></button>
      } />
      <div onDragOver={(e) => { e.preventDefault(); setRootOver(true); }} onDragLeave={() => setRootOver(false)} onDrop={(e) => { setRootOver(false); void drop(e, null); }}
        className={cx("flex flex-col gap-px rounded-[8px]", rootOver && "bg-accent/10 ring-1 ring-accent/40")}>
        <Tree folders={folders} parent={null} depth={0} counts={counts} onDrop={drop} />
        {!folders.length && <div className="px-2 py-1 text-[12px] text-muted">No folders yet. Use + or drop notes here.</div>}
      </div>
    </div>
  );
}

function Tree({ folders, parent, depth, counts, onDrop }: { folders: Folder[]; parent: string | null; depth: number; counts: Map<string, number>; onDrop: (e: React.DragEvent, target: string | null) => void }) {
  if (depth > 32) return null; // a parent cycle in synced data can't recurse forever
  const kids = folders.filter((f) => f.parentId === parent).sort((a, b) => (getSettings().johnnyDecimal ? natural(a.name, b.name) : a.sort - b.sort || natural(a.name, b.name)));
  return <>{kids.map((f) => <FolderRow key={f.id} f={f} folders={folders} depth={depth} counts={counts} onDrop={onDrop} />)}</>;
}

function FolderRow({ f, folders, depth, counts, onDrop }: { f: Folder; folders: Folder[]; depth: number; counts: Map<string, number>; onDrop: (e: React.DragEvent, target: string | null) => void }) {
  const ui = useUI();
  const v = useVault();
  const key = `lumen.fold.${f.id}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  const [over, setOver] = useState(false);
  const [rename, setRename] = useState(false);
  const [menu, setMenu] = useState(false);
  const notes = open ? v.notes.filter((n) => n.folderId === f.id).sort((a, b) => natural(a.title, b.title)).slice(0, 60) : [];
  const toggle = () => setOpen((o) => { try { localStorage.setItem(key, o ? "0" : "1"); } catch { /* ignore */ } return !o; });
  const active = ui.folderId === f.id && ui.view === "notes";
  const color = colorOf(f.color) ?? "var(--muted)";
  const pl = 8 + depth * 20;
  return (
    <div>
      <div
        draggable={!rename}
        onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData(DRAG, JSON.stringify({ kind: "folder", id: f.id })); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.stopPropagation(); setOver(false); onDrop(e, f.id); }}
        onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}
        className={cx("group relative flex h-7 items-center gap-[7px] rounded-[6px] pe-2", active ? "bg-surface-2 font-semibold" : "font-[450] hover:bg-surface-2")}
        style={{ paddingInlineStart: pl, ...(over ? { background: "color-mix(in srgb,var(--accent) 15%,transparent)", boxShadow: "inset 0 0 0 1.5px var(--accent)" } : {}) }}
      >
        <button onClick={toggle} aria-label={open ? "Collapse" : "Expand"} className="flex w-3 justify-center text-muted">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} className="rtl:rotate-180" />}</button>
        <span className="size-2 shrink-0 rounded-[3px]" style={{ background: color }} />
        {rename ? (
          <input autoFocus defaultValue={f.name} className="h-6 min-w-0 flex-1 rounded border border-accent bg-bg px-1 outline-none"
            onBlur={(e) => { setRename(false); if (e.target.value.trim()) void patch("folder", f.id, { name: e.target.value.trim() }); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRename(false); }} />
        ) : (
          <button className="min-w-0 flex-1 truncate text-start" onClick={() => go("notes", { folderId: f.id, tag: null, filter: null })} onDoubleClick={() => setRename(true)}>{f.name}</button>
        )}
        <span className="text-[11px] text-muted group-hover:hidden">{num(counts.get(f.id) ?? "")}</span>
        <button className="hidden text-muted hover:text-ink group-hover:block" onClick={() => setMenu(true)} aria-label="Folder menu">⋯</button>
        {menu && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
            <div className="absolute left-6 top-full z-40 w-48 rounded-[10px] border border-line bg-surface p-1 shadow-xl fade-in" onClick={() => setMenu(false)}>
              {([
                ["New note", async () => openNote((await createNote({ spaceId: f.spaceId, folderId: f.id })).id, "edit")],
                ["New subfolder", async () => { await createFolder(f.spaceId, f.id); if (!open) toggle(); }],
                ["Rename", () => setRename(true)],
              ] as [string, () => void][]).map(([l, fn]) => <button key={l} className="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-surface-2" onClick={fn}>{l}</button>)}
              <div className="flex gap-1 px-2 py-1.5">
                <button title="No color" className="size-5 rounded-full border border-line" onClick={() => patch("folder", f.id, { color: null })} />
                {Object.keys(PRESETS).map((k) => <button key={k} className="size-5 rounded-full" style={{ background: PRESETS[k] }} onClick={() => patch("folder", f.id, { color: k })} />)}
              </div>
              <button className="block w-full rounded px-2 py-1.5 text-left text-[13px] text-bad hover:bg-surface-2" onClick={async () => { await deleteFolder(f); toast(`Deleted “${f.name}”. Its notes moved up one level.`); }}>Delete folder</button>
            </div>
          </>
        )}
      </div>
      {open && (
        <>
          <Tree folders={folders} parent={f.id} depth={depth + 1} counts={counts} onDrop={onDrop} />
          {notes.map((n) => {
            const on = ui.noteId === n.id && ui.view === "notes";
            return (
              <button key={n.id} draggable onDragStart={(e) => dragNote(e, n.id)} onClick={() => openNote(n.id)}
                className={cx("flex h-7 w-full items-center gap-[7px] rounded-[6px] pe-2 text-start", on ? "bg-surface-2 font-semibold text-ink" : "font-[450] text-muted hover:bg-surface-2 hover:text-ink")} style={{ paddingInlineStart: pl + 20 }}>
                <FileText size={14} className={on ? "text-accent" : ""} /><span dir="auto" className="truncate">{n.title}</span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
