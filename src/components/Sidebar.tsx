import { Brain, CalendarDays, Check, ChevronDown, ChevronRight, CloudOff, Columns3, FilePlus2, Folder as FolderIcon, FolderPlus, Hash, Home, Inbox, Layers, Loader2, Map as MapIcon, Network, Pencil, Plus, RefreshCw, Search, Settings, Sun, Table2, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { SPACE_KINDS, type Folder, type Space } from "../../shared/types";
import { createFolder, createNote, dailyNote, deleteFolder, moveFolder, moveNote } from "../lib/actions";
import { patch } from "../lib/db";
import { natural } from "../lib/parse";
import { getSettings } from "../lib/settings";
import { go, openNote, setUI, toast, useUI, useVault, type View } from "../lib/store";
import { syncNow, useSync } from "../lib/sync";
import { PRESETS } from "../lib/canvas";
import { useDueCards } from "./Review";
import { cx, IconButton } from "./ui";

export const KIND_LABEL: Record<Space["kind"], string> = { project: "Project", area: "Area", course: "Course", resource: "Resource", archive: "Archive" };

export function Sidebar() {
  const ui = useUI();
  const v = useVault();
  const due = useDueCards(v.notes)?.length ?? 0;
  const space = v.spaceMap.get(ui.spaceId);
  const [switcher, setSwitcher] = useState(false);

  const nav: { view: View; icon: React.ReactNode; label: string; badge?: number }[] = [
    { view: "home", icon: <Home size={17} />, label: "Home" },
    { view: "notes", icon: <Inbox size={17} />, label: "All notes" },
    { view: "tasks", icon: <Check size={17} />, label: "Tasks" },
    { view: "calendar", icon: <CalendarDays size={17} />, label: "Calendar" },
    { view: "review", icon: <Brain size={17} />, label: "Review", badge: due },
    { view: "kanban", icon: <Columns3 size={17} />, label: "Board" },
    { view: "table", icon: <Table2 size={17} />, label: "Database" },
    { view: "graph", icon: <Network size={17} />, label: "Graph" },
  ];

  const row = (active: boolean) => cx("flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2 text-[13.5px] transition-colors", active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink");

  return (
    <aside className="safe-t flex h-full w-[264px] shrink-0 flex-col border-r border-line bg-surface">
      {/* space switcher */}
      <div className="relative p-2">
        <button onClick={() => setSwitcher((s) => !s)} className="flex w-full items-center gap-2 rounded-[10px] px-2 py-2 text-left hover:bg-surface-2">
          <span className="flex size-8 items-center justify-center rounded-[8px] bg-surface-2 text-[17px]" style={space?.color ? { background: `color-mix(in oklab, ${PRESETS[space.color] ?? space.color} 25%, transparent)` } : undefined}>{ui.spaceId === "all" ? "🗂️" : space?.icon ?? "📥"}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold">{ui.spaceId === "all" ? "All spaces" : space?.name ?? "Inbox"}</span>
            <span className="block text-[11px] text-muted">{ui.spaceId === "all" ? `${v.spaces.length} spaces` : KIND_LABEL[space?.kind ?? "area"]}</span>
          </span>
          <ChevronDown size={15} className="text-muted" />
        </button>
        {switcher && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setSwitcher(false)} />
            <div className="absolute left-2 right-2 top-full z-40 max-h-[60vh] overflow-y-auto rounded-[12px] border border-line bg-surface p-1.5 shadow-xl fade-in" onClick={() => setSwitcher(false)}>
              <button className={row(ui.spaceId === "all")} onClick={() => setUI({ spaceId: "all", folderId: null })}><Layers size={16} /> All spaces</button>
              {SPACE_KINDS.map((k) => {
                const list = v.spaces.filter((s) => s.kind === k && !s.archived);
                if (!list.length) return null;
                return (
                  <div key={k} className="mt-1.5">
                    <div className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">{KIND_LABEL[k]}s</div>
                    {list.map((s) => (
                      <button key={s.id} className={row(ui.spaceId === s.id)} onClick={() => go(s.id === "inbox" ? "notes" : "space", { spaceId: s.id, folderId: null, tag: null })}>
                        <span className="w-5 text-center">{s.icon}</span><span className="truncate">{s.name}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
              {v.spaces.some((s) => s.archived) && (
                <details className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                  <summary className="cursor-pointer px-2 py-1 text-[11px] text-muted">Archived · {v.spaces.filter((s) => s.archived).length}</summary>
                  {v.spaces.filter((s) => s.archived).map((s) => <button key={s.id} className={row(false)} onClick={() => { setSwitcher(false); go("space", { spaceId: s.id, folderId: null }); }}><span className="w-5 text-center">{s.icon}</span>{s.name}</button>)}
                </details>
              )}
              <div className="my-1 h-px bg-line" />
              <button className={row(false)} onClick={() => setUI({ newSpace: true })}><Plus size={16} /> New space…</button>
            </div>
          </>
        )}
      </div>

      <div className="px-2">
        <button onClick={() => setUI({ palette: true })} className="flex h-9 w-full items-center gap-2 rounded-[10px] border border-line bg-bg px-2.5 text-[13px] text-muted hover:text-ink">
          <Search size={15} /> Search or command <kbd className="ml-auto rounded bg-surface-2 px-1.5 text-[10.5px]">Ctrl K</kbd>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <nav className="space-y-0.5">
          {nav.map((n) => (
            <button key={n.view} className={row(ui.view === n.view && !(n.view === "notes" && (ui.folderId || ui.tag)))} onClick={() => go(n.view, n.view === "notes" ? { folderId: null, tag: null } : {})}>
              {n.icon}<span className="flex-1 text-left">{n.label}</span>
              {!!n.badge && <span className="rounded-full bg-learn/20 px-1.5 text-[11px] font-medium text-learn">{n.badge}</span>}
            </button>
          ))}
          <button className={row(false)} onClick={async () => openNote((await dailyNote(ui.spaceId === "all" ? "inbox" : ui.spaceId)).id, "edit")}><Sun size={17} /> Today's journal</button>
          {space && space.id !== "inbox" && (
            <button className={row(ui.view === "space")} onClick={() => go("space")}><MapIcon size={17} /> {space.kind === "course" ? "Course overview" : "Space overview"}</button>
          )}
        </nav>

        {ui.spaceId !== "all" && <FolderTree spaceId={ui.spaceId} />}

        {v.tags.length > 0 && (
          <Section title="Tags">
            {v.tags.slice(0, 40).map(([t, c]) => (
              <button key={t} className={row(ui.tag === t)} onClick={() => go("notes", { tag: ui.tag === t ? null : t, folderId: null })}>
                <Hash size={14} /> <span className="flex-1 truncate text-left">{t}</span><span className="text-[11px] tabular-nums">{c}</span>
              </button>
            ))}
          </Section>
        )}
      </div>

      <div className="safe-b border-t border-line p-2">
        <div className="flex items-center gap-1">
          <button className={row(ui.view === "trash") + " !w-auto"} onClick={() => go("trash")} title="Trash"><Trash2 size={16} /></button>
          <button className={row(false) + " !w-auto"} onClick={() => setUI({ io: true })} title="Import / export"><Upload size={16} /></button>
          <SyncBadge />
          <button className={row(ui.view === "settings") + " !w-auto"} onClick={() => go("settings")} title="Settings"><Settings size={16} /></button>
        </div>
      </div>
    </aside>
  );
}

function SyncBadge() {
  const s = useSync();
  const label = s.status === "local" ? "Local only" : s.status === "syncing" ? "Syncing…" : s.status === "offline" ? `Offline${s.pending ? ` · ${s.pending} queued` : ""}` : s.status === "error" ? "Sync error" : `Synced${s.last ? " " + new Date(s.last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}`;
  const color = s.status === "error" ? "bg-bad" : s.status === "offline" || s.status === "local" ? "bg-warn" : "bg-ok";
  return (
    <button onClick={() => (s.status === "local" ? go("settings") : void syncNow())} title={s.error ?? label} className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[8px] px-2 text-[12px] text-muted hover:bg-surface-2">
      {s.status === "syncing" ? <Loader2 size={13} className="animate-spin" /> : s.status === "offline" ? <CloudOff size={13} /> : s.status === "local" ? <span className={cx("size-2 rounded-full", color)} /> : <RefreshCw size={13} />}
      <span className="truncate">{label}</span>
    </button>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-4">
      <div className="group flex items-center px-2 pb-1">
        <button onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {title}
        </button>
        {action}
      </div>
      {open && <div className="space-y-0.5">{children}</div>}
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
    <Section title="Folders" action={
      <span className="flex opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton label="New note here" className="!size-6" onClick={async () => openNote((await createNote({ spaceId })).id, "edit")}><FilePlus2 size={14} /></IconButton>
        <IconButton label="New folder" className="!size-6" onClick={() => createFolder(spaceId, null)}><FolderPlus size={14} /></IconButton>
      </span>
    }>
      <div onDragOver={(e) => { e.preventDefault(); setRootOver(true); }} onDragLeave={() => setRootOver(false)} onDrop={(e) => { setRootOver(false); void drop(e, null); }}
        className={cx("rounded-[8px]", rootOver && "bg-accent/10 ring-1 ring-accent/40")}>
        <Tree folders={folders} parent={null} depth={0} counts={counts} onDrop={drop} />
        {!folders.length && <div className="px-3 py-1 text-[12px] text-muted">No folders. Use + to add one, or drop notes here.</div>}
      </div>
    </Section>
  );
}

function Tree({ folders, parent, depth, counts, onDrop }: { folders: Folder[]; parent: string | null; depth: number; counts: Map<string, number>; onDrop: (e: React.DragEvent, target: string | null) => void }) {
  const kids = folders.filter((f) => f.parentId === parent).sort((a, b) => (getSettings().johnnyDecimal ? natural(a.name, b.name) : a.sort - b.sort || natural(a.name, b.name)));
  return <>{kids.map((f) => <FolderRow key={f.id} f={f} folders={folders} depth={depth} counts={counts} onDrop={onDrop} />)}</>;
}

function FolderRow({ f, folders, depth, counts, onDrop }: { f: Folder; folders: Folder[]; depth: number; counts: Map<string, number>; onDrop: (e: React.DragEvent, target: string | null) => void }) {
  const ui = useUI();
  const key = `lumen.fold.${f.id}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) !== "0"; } catch { return true; } });
  const [over, setOver] = useState(false);
  const [rename, setRename] = useState(false);
  const [menu, setMenu] = useState(false);
  const hasKids = folders.some((x) => x.parentId === f.id);
  const toggle = () => { setOpen((o) => { try { localStorage.setItem(key, o ? "0" : "1"); } catch { /* ignore */ } return !o; }); };
  const active = ui.folderId === f.id && ui.view === "notes";
  const color = f.color ? PRESETS[f.color] ?? f.color : undefined;
  return (
    <div>
      <div
        draggable={!rename}
        onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData(DRAG, JSON.stringify({ kind: "folder", id: f.id })); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.stopPropagation(); setOver(false); onDrop(e, f.id); }}
        onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}
        className={cx("group relative flex h-8 items-center gap-1 rounded-[8px] pr-1 text-[13.5px]", active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink", over && "bg-accent/15 ring-1 ring-accent/50")}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <button onClick={toggle} className={cx("flex size-5 items-center justify-center", !hasKids && "invisible")} aria-label={open ? "Collapse" : "Expand"}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <FolderIcon size={15} style={color ? { color } : undefined} className="shrink-0" />
        {rename ? (
          <input autoFocus defaultValue={f.name} className="h-6 min-w-0 flex-1 rounded border border-accent bg-bg px-1 text-ink outline-none"
            onBlur={(e) => { setRename(false); if (e.target.value.trim()) void patch("folder", f.id, { name: e.target.value.trim() }); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRename(false); }} />
        ) : (
          <button className="min-w-0 flex-1 truncate text-left" onClick={() => go("notes", { folderId: f.id, tag: null })} onDoubleClick={() => setRename(true)}>{f.name}</button>
        )}
        <span className="text-[11px] tabular-nums group-hover:hidden">{counts.get(f.id) ?? ""}</span>
        <button className="hidden size-6 items-center justify-center rounded group-hover:flex hover:bg-bg" onClick={() => setMenu(true)} aria-label="Folder menu"><Pencil size={12} /></button>
        {menu && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
            <div className="absolute left-6 top-full z-40 w-48 rounded-[10px] border border-line bg-surface p-1 text-ink shadow-xl fade-in" onClick={() => setMenu(false)}>
              {[
                ["New note", async () => openNote((await createNote({ spaceId: f.spaceId, folderId: f.id })).id, "edit")],
                ["New subfolder", async () => { await createFolder(f.spaceId, f.id); if (!open) toggle(); }],
                ["Rename", () => setRename(true)],
              ].map(([l, fn]) => <button key={l as string} className="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-surface-2" onClick={fn as () => void}>{l as string}</button>)}
              <div className="flex gap-1 px-2 py-1.5">
                <button title="No color" className="size-5 rounded-full border border-line" onClick={() => patch("folder", f.id, { color: null })} />
                {Object.keys(PRESETS).map((k) => <button key={k} className="size-5 rounded-full" style={{ background: PRESETS[k] }} onClick={() => patch("folder", f.id, { color: k })} />)}
              </div>
              <button className="block w-full rounded px-2 py-1.5 text-left text-[13px] text-bad hover:bg-surface-2" onClick={async () => { await deleteFolder(f); toast(`Deleted “${f.name}”. Its notes moved up one level.`); }}>Delete folder</button>
            </div>
          </>
        )}
      </div>
      {open && hasKids && <Tree folders={folders} parent={f.id} depth={depth + 1} counts={counts} onDrop={onDrop} />}
    </div>
  );
}
