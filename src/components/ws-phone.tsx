import { Archive, ArrowDownWideNarrow, Check, ChevronDown, ChevronRight, FolderPlus, Hash, Inbox, Pin, Search, Trash2, X, Globe, Plus } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { Folder, Note, Space } from "../../shared/types";
import { createFolder, createSpace, deleteFolder, moveNote, restoreNote, trashNote, updateNote } from "../lib/actions";
import { patch } from "../lib/db";
import { natural, progress, roadmap } from "../lib/parse";
import { getSettings } from "../lib/settings";
import { go, openNote, setUI, toast, useUI, useVault } from "../lib/store";
import { PRESETS } from "../lib/canvas";
import { useSync } from "../lib/sync";
import { syncLook } from "./ws-sync";
import { cx, Sheet } from "./ui";
import { tr, useRtl } from "./ws-dir";
import { PhoneSmartRows, smartIdOf, useSmartFolders } from "./SmartFolders";
import { Glyph } from "./Glyph";
import { SpaceIcon } from "./SpaceIcon";
import { spaceColor } from "../lib/space-icon";

/* Phone notes list (design: Lumen 02 · 4C) + folder tree sheet (4D). */
const colorOf = (c: string | null | undefined) => (c ? PRESETS[c] ?? c : null);

export type PhoneFilter = "pinned" | "review" | null;

/** Header: space pill (opens the space sheet), sync dot, search. */
export function PhoneListHeader() {
  const ui = useUI();
  const v = useVault();
  const rtl = useRtl();
  const sync = useSync();
  const [spaces, setSpaces] = useState(false);
  const space = ui.spaceId === "all" ? undefined : v.spaceMap.get(ui.spaceId);
  const c = colorOf(space?.color) ?? "#A371F7";
  const dot = syncLook(sync, rtl).dot;
  return (
    <div className="safe-t shrink-0">
      <div className="flex h-14 items-center gap-2 pe-2 ps-4">
        <button onClick={() => setSpaces(true)} className="flex h-10 min-w-0 items-center gap-2 rounded-[10px] bg-surface pe-2.5 ps-1.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px]" style={{ background: `color-mix(in srgb, ${c} 20%, transparent)` }}>{space ? <SpaceIcon space={space} size={15} color={c} /> : <Glyph name="folder" size={15} color={c} />}</span>
          <span className="truncate text-[14px] font-semibold">{space?.name ?? tr("All spaces", rtl)}</span>
          <ChevronDown size={14} className="shrink-0 text-muted" />
        </button>
        <span className="flex-1" />
        <span style={{ ...dot, width: 6, height: 6 }} title={syncLook(sync).text} />
        <button aria-label="Search" onClick={() => setUI({ palette: true })} className="flex size-11 items-center justify-center"><Search size={20} /></button>
      </div>
      <SpaceSheet open={spaces} onClose={() => setSpaces(false)} />
    </div>
  );
}

/** Filter chips: folder (opens the tree sheet), Pinned, Review; sort at the end. */
export function PhoneChips({ filter, setFilter, onSort, sortLabel }: { filter: PhoneFilter; setFilter: (f: PhoneFilter) => void; onSort: () => void; sortLabel: string }) {
  const ui = useUI();
  const v = useVault();
  const rtl = useRtl();
  const [tree, setTree] = useState(false);
  const smart = useSmartFolders();
  const folder = ui.folderId ? v.folderMap.get(ui.folderId) : null;
  const chip = (on: boolean) => cx("flex h-9 shrink-0 items-center rounded-full px-3 text-[14px]", on ? "bg-surface-2 font-medium text-ink" : "border border-line text-muted");
  return (
    <div className="flex shrink-0 items-center gap-2 px-4 pb-2.5 pt-1">
      <button onClick={() => setTree(true)} className={cx(chip(true), "min-w-0 gap-2")}>
        {folder ? <span className="size-2 shrink-0 rounded-[3px]" style={{ background: colorOf(folder.color) ?? "var(--muted)" }} /> : null}
        <span className="truncate">{folder?.name ?? (ui.tag ? `#${ui.tag}` : smartIdOf(ui) ? smart.find((x) => x.id === smartIdOf(ui))?.name ?? "Smart folder" : ui.filter === "paths" ? "Learning paths" : ui.filter === "visual" ? "Canvases & whiteboards" : ui.filter === "published" ? "Blog posts" : tr("All notes", rtl))}</span>
        <ChevronDown size={14} className="shrink-0 text-muted" />
      </button>
      <button className={chip(filter === "pinned")} onClick={() => setFilter(filter === "pinned" ? null : "pinned")}>{tr("Pinned", rtl)}</button>
      <button className={chip(filter === "review")} onClick={() => setFilter(filter === "review" ? null : "review")}>{tr("Review", rtl)}</button>
      <span className="flex-1" />
      <button aria-label={`Sort: ${sortLabel}`} title={`Sort: ${sortLabel}`} onClick={onSort} className="flex size-9 shrink-0 items-center justify-center text-muted"><ArrowDownWideNarrow size={18} /></button>
      <FolderSheet open={tree} onClose={() => setTree(false)} />
    </div>
  );
}

/** Row with swipe actions: left → Archive / Delete; right → Pin; long-press → context sheet. */
export function SwipeRow({ n, children }: { n: Note; children: ReactNode }) {
  const [dx, setDx] = useState(0);
  const [ctx, setCtx] = useState(false);
  const st = useRef<{ x: number; y: number; t: number; lock?: "h" | "v" } | null>(null);
  const press = useRef<ReturnType<typeof setTimeout>>(undefined);
  const moved = useRef(false);
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  const end = () => {
    clearTimeout(press.current);
    const d = rtl ? -dx : dx;
    if (d > 80) void pin();
    else if (d < -160) void del();
    else if (d < -80) { setDx(rtl ? 152 : -152); return; } // reveal Archive / Delete
    setDx(0);
  };
  const pin = async () => { await updateNote(n.id, { pinned: n.pinned ? 0 : 1 }); toast(n.pinned ? "Unpinned" : "Pinned", undefined, { icon: "check" }); setDx(0); };
  const del = async () => { setDx(0); await trashNote(n.id); toast(`“${n.title}” moved to Trash`, { label: "Undo", run: () => void restoreNote(n.id) }); };
  const archive = async () => {
    setDx(0);
    const v = await import("../lib/db").then((m) => m.db.spaces.toArray());
    let arch = v.find((s) => s.kind === "archive" && !s.deleted);
    if (!arch) arch = await createSpace({ name: "Archive", kind: "archive", icon: "glyph:archive" });
    const from = { spaceId: n.spaceId, folderId: n.folderId };
    await moveNote(n.id, arch.id, null);
    toast(`“${n.title}” archived`, { label: "Undo", run: () => void moveNote(n.id, from.spaceId, from.folderId) }, { icon: "info" });
  };
  return (
    <div className="relative shrink-0 overflow-hidden border-b border-line">
      <div className="absolute inset-y-0 start-0 flex items-center bg-[color-mix(in_srgb,var(--accent)_18%,var(--bg))] ps-5 text-accent" style={{ width: Math.max(0, rtl ? -dx : dx) }}><Pin size={18} /></div>
      <div className="absolute inset-y-0 end-0 flex">
        <button onClick={archive} className="flex w-[76px] flex-col items-center justify-center gap-1 bg-surface-2 text-[11px] text-muted"><Archive size={18} />Archive</button>
        <button onClick={del} className="flex w-[76px] flex-col items-center justify-center gap-1 bg-[color-mix(in_srgb,var(--danger)_22%,var(--bg))] text-[11px] text-bad"><Trash2 size={18} />Delete</button>
      </div>
      <div
        className="relative bg-bg transition-transform duration-150"
        style={{ transform: `translateX(${dx}px)`, transitionDuration: st.current ? "0ms" : undefined }}
        onTouchStart={(e) => { const t = e.touches[0]; st.current = { x: t.clientX, y: t.clientY, t: Date.now() }; moved.current = false; press.current = setTimeout(() => { if (!moved.current) { setCtx(true); navigator.vibrate?.(10); } }, 500); }}
        onTouchMove={(e) => {
          const s = st.current; if (!s) return;
          const t = e.touches[0]; const ddx = t.clientX - s.x, ddy = t.clientY - s.y;
          if (!s.lock && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) { s.lock = Math.abs(ddx) > Math.abs(ddy) ? "h" : "v"; moved.current = true; clearTimeout(press.current); }
          if (s.lock === "h") setDx(Math.max(-200, Math.min(140, ddx)));
        }}
        onTouchEnd={() => { const s = st.current; st.current = null; if (s?.lock === "h") end(); else clearTimeout(press.current); }}
        onClickCapture={(e) => { if (moved.current || dx !== 0) { e.stopPropagation(); e.preventDefault(); if (dx !== 0) setDx(0); } }}
        onContextMenu={(e) => { e.preventDefault(); setCtx(true); }}
      >
        {children}
      </div>
      <Sheet open={ctx} onClose={() => setCtx(false)} title={<span dir="auto">{n.title}</span>}>
        <div className="-mx-2 flex flex-col">
          {([
            [<Pin size={17} key="p" />, n.pinned ? "Unpin" : "Pin", pin],
            [<Archive size={17} key="a" />, "Archive", archive],
            [<Trash2 size={17} key="d" />, "Move to trash", del],
          ] as [ReactNode, string, () => void][]).map(([ic, l, fn]) => (
            <button key={l} onClick={() => { setCtx(false); fn(); }} className={cx("flex h-12 items-center gap-3 rounded-[10px] px-3 text-start text-[15px] hover:bg-surface-2", l === "Move to trash" && "text-bad")}>{ic}{l}</button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

/** Space switcher as a bottom sheet (phone, design Lumen 03 · 1D): grouped Courses · Projects · Areas · Resources,
 *  36 px tinted tiles with the space glyph, a meta line, search, and All spaces / New space at the bottom. */
const SHEET_KINDS: [Space["kind"], string][] = [["course", "Courses"], ["project", "Projects"], ["area", "Areas"], ["resource", "Resources"], ["archive", "Archive"]];
export function SpaceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ui = useUI();
  const v = useVault();
  const [q, setQ] = useState<string | null>(null);
  if (!open) return null;
  const pick = (spaceId: string) => { setUI({ spaceId, folderId: null, filter: null, tag: null }); setQ(null); onClose(); };
  const meta = (s: Space) => {
    const n = v.notes.filter((x) => x.spaceId === s.id).length;
    if (s.kind === "course" && s.roadmapId) return `${progress(roadmap(v.byId.get(s.roadmapId)?.body ?? "")).pct}% · ${n} notes`;
    const d = s.kind === "project" ? s.props?.deadline : "";
    if (d && !isNaN(Date.parse(d))) { const days = Math.ceil((Date.parse(d) - Date.now()) / 864e5); return days >= 0 ? `${days} days left` : `${-days} days over`; }
    return `${n} notes`;
  };
  const term = (q ?? "").trim().toLowerCase();
  const live = v.spaces.filter((s) => !s.archived && (!term || s.name.toLowerCase().includes(term)));
  return (
    <div className="fade-in fixed inset-0 z-50 flex items-end bg-[rgba(5,6,8,.6)]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Spaces" className="sheet-in flex h-[700px] max-h-[90dvh] w-full flex-col rounded-t-[14px] bg-surface text-[14px] text-ink">
        <div className="flex justify-center pb-1 pt-2.5"><span className="h-1 w-9 rounded-[2px] bg-line" /></div>
        <div className="flex items-center gap-2 px-5 pb-3 pt-2">
          {q === null ? <span className="flex-1 text-[18px] font-[650] leading-[22px]">Spaces</span>
            : <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a space" aria-label="Find a space" className="h-9 min-w-0 flex-1 rounded-[8px] border border-accent bg-bg px-3 text-[15px] outline-none" />}
          <button aria-label={q === null ? "Search spaces" : "Close search"} onClick={() => setQ(q === null ? "" : null)} className="-my-2.5 -me-2 flex size-10 items-center justify-center text-muted">{q === null ? <Search size={20} /> : <X size={20} />}</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {SHEET_KINDS.map(([k, label]) => {
            const list = live.filter((s) => s.kind === k);
            if (!list.length) return null;
            return (
              <div key={k}>
                <div className="px-5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{label}</div>
                {list.map((s) => { const on = ui.spaceId === s.id; return (
                  <button key={s.id} onClick={() => pick(s.id)} className={cx("mx-2 flex h-14 w-[calc(100%-16px)] items-center gap-3 rounded-[12px] px-3 text-start", on && "bg-surface-2")}>
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px]" style={{ background: `color-mix(in srgb, ${spaceColor(s)} 20%, transparent)` }}><SpaceIcon space={s} size={16} color="var(--text)" /></span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span dir="auto" className={cx("truncate", on ? "font-semibold" : "font-medium")}>{s.name}</span><span className="text-[12px] text-muted">{meta(s)}</span></span>
                    {on && <Check size={18} className="shrink-0 text-accent" />}
                  </button>); })}
              </div>
            );
          })}
          {!live.length && <div className="px-5 py-6 text-muted">No space matches.</div>}
        </div>
        <div className="flex gap-2.5 px-4 py-3">
          <button onClick={() => pick("all")} className={cx("flex h-12 flex-1 items-center justify-center gap-2 rounded-[12px] border", ui.spaceId === "all" ? "border-accent" : "border-line")}><Globe size={16} />All spaces</button>
          <button onClick={() => { onClose(); setUI({ newSpace: true }); }} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[12px] border border-line"><Plus size={16} />New space</button>
        </div>
        <div className="safe-b" />
      </div>
    </div>
  );
}

/** Folder tree sheet (4D): 48 px rows, tap = open, long-press = Rename / Color / New subfolder / Delete. */
export function FolderSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ui = useUI();
  const v = useVault();
  const spaceId = ui.spaceId === "all" ? "inbox" : ui.spaceId;
  const folders = v.folders.filter((f) => ui.spaceId === "all" || f.spaceId === spaceId);
  const counts = new Map<string, number>();
  v.notes.forEach((n) => n.folderId && counts.set(n.folderId, (counts.get(n.folderId) ?? 0) + 1));
  const [openF, setOpenF] = useState<Set<string>>(() => new Set(ui.folderId ? [ui.folderId] : []));
  const [menuF, setMenuF] = useState<Folder | null>(null);
  const [rename, setRename] = useState("");
  const inbox = v.notes.filter((n) => n.spaceId === "inbox").length;
  const total = v.notes.filter((n) => ui.spaceId === "all" || n.spaceId === spaceId).length;
  const sortF = (a: Folder, b: Folder) => (getSettings().johnnyDecimal ? natural(a.name, b.name) : a.sort - b.sort || natural(a.name, b.name));
  const rows: { f: Folder; d: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, d: number) => folders.filter((f) => f.parentId === parent && !seen.has(f.id)).sort(sortF).forEach((f) => { seen.add(f.id); rows.push({ f, d }); if (openF.has(f.id)) walk(f.id, d + 1); });
  walk(null, 0);
  const pick = (id: string | null) => { go("notes", { folderId: id, tag: null, filter: null, noteId: null }); onClose(); };
  const lp = useRef<ReturnType<typeof setTimeout>>(undefined);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[rgba(5,6,8,.6)] fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-in safe-b flex max-h-[70dvh] w-full flex-col rounded-t-[14px] bg-surface text-[14px]" style={{ minHeight: "min(640px, 70dvh)" }}>
        <div className="flex justify-center pb-1 pt-2.5"><span className="h-1 w-9 rounded-[2px] bg-line" /></div>
        <div className="flex items-center gap-2.5 px-5 pb-3 pt-2">
          <span className="flex-1 text-[18px] font-[650]">{tr("Folders")}</span>
          <button onClick={async () => { const f = await createFolder(spaceId, null); setMenuF(f); setRename(f.name); }} className="flex h-9 items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13px]"><FolderPlus size={15} />{tr("New folder")}</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2">
          <PhoneSmartRows onPick={onClose} />
          <button onClick={() => pick(null)} className={cx("flex h-12 w-full items-center gap-2.5 rounded-[10px] pe-3 ps-3", !ui.folderId && "bg-surface-2")}>
            <span className="w-3.5" /><span className="size-2.5 rounded-[3px] bg-muted" /><span className={cx("flex-1 text-start", !ui.folderId && "font-semibold")}>{tr("All notes")}</span><span className="text-[13px] text-muted">{total}</span>{!ui.folderId && <Check size={18} className="text-accent" />}
          </button>
          {rows.map(({ f, d }) => {
            const on = ui.folderId === f.id;
            const kids = folders.some((x) => x.parentId === f.id);
            return (
              <div key={f.id} role="button" tabIndex={0} onClick={() => pick(f.id)}
                onTouchStart={() => { lp.current = setTimeout(() => { setMenuF(f); setRename(f.name); navigator.vibrate?.(10); }, 500); }} onTouchEnd={() => clearTimeout(lp.current)} onTouchMove={() => clearTimeout(lp.current)}
                onContextMenu={(e) => { e.preventDefault(); setMenuF(f); setRename(f.name); }}
                className={cx("flex h-12 w-full items-center gap-2.5 rounded-[10px] pe-3", on && "bg-surface-2")} style={{ paddingInlineStart: 12 + d * 28 }}>
                <button aria-label={openF.has(f.id) ? "Collapse" : "Expand"} className="flex w-3.5 justify-center text-muted" style={{ visibility: kids ? "visible" : "hidden" }} onClick={(e) => { e.stopPropagation(); setOpenF((s) => { const n = new Set(s); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n; }); }}>
                  {openF.has(f.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} className="rtl:rotate-180" />}
                </button>
                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: colorOf(f.color) ?? "var(--muted)" }} />
                <span className={cx("flex-1 truncate text-start", on && "font-semibold")}>{f.name}</span>
                <span className="text-[13px] text-muted">{counts.get(f.id) ?? ""}</span>
                {on && <Check size={18} className="text-accent" />}
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 border-t border-line px-5 py-3 text-[13px] text-muted">
          <button className="flex items-center gap-1.5" onClick={() => { go("notes", { spaceId: "inbox", folderId: null, tag: null, filter: null }); onClose(); }}><Inbox size={15} />Inbox {inbox}</button>
          <button className="flex items-center gap-1.5" onClick={() => { onClose(); setUI({ sidebar: true }); }}><Hash size={15} />Tags</button>
          <button className="flex items-center gap-1.5" onClick={() => { go("trash"); onClose(); }}><Trash2 size={15} />Trash</button>
        </div>
      </div>
      <Sheet open={!!menuF} onClose={() => { if (menuF && rename.trim() && rename !== menuF.name) void patch("folder", menuF.id, { name: rename.trim() }); setMenuF(null); }} title="Folder">
        {menuF && (
          <div className="flex flex-col gap-3">
            <input autoFocus value={rename} onChange={(e) => setRename(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { if (rename.trim()) void patch("folder", menuF.id, { name: rename.trim() }); setMenuF(null); } }} className="h-12 rounded-[10px] border border-line bg-bg px-3.5 text-[15px] outline-none focus:border-accent" />
            <div className="flex gap-2">
              <button title="No color" className="size-8 rounded-full border border-line" onClick={() => patch("folder", menuF.id, { color: null })} />
              {Object.keys(PRESETS).map((k) => <button key={k} className="size-8 rounded-full" style={{ background: PRESETS[k], boxShadow: menuF.color === k ? "0 0 0 2px var(--surface), 0 0 0 4px var(--accent)" : undefined }} onClick={() => { void patch("folder", menuF.id, { color: k }); setMenuF({ ...menuF, color: k }); }} />)}
            </div>
            <button className="flex h-12 items-center gap-3 rounded-[10px] px-1 text-[15px]" onClick={async () => { await createFolder(menuF.spaceId, menuF.id); setOpenF((s) => new Set(s).add(menuF.id)); setMenuF(null); }}><FolderPlus size={17} />New subfolder</button>
            <button className="flex h-12 items-center gap-3 rounded-[10px] px-1 text-[15px] text-bad" onClick={async () => { const f = menuF; setMenuF(null); await deleteFolder(f); toast(`Deleted “${f.name}”. Its notes moved up one level.`); }}><Trash2 size={17} />Delete folder</button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

export const openNoteFromList = (id: string) => openNote(id);
