// App sidebar (Lumen 30b · Sidebar best practice + Lumen 30 · space switcher / sections; SideNav2 / SideNav).
// Top: space switcher, New note (⌘N) + Search (⌘K). Core items (customisable; hidden ones fold into More with a
// count), then Favourites, Learning paths, Folders, Smart folders, Tags (nested, folded), Recent. Footer: offline
// warning, sync, settings, avatar, collapse hint. Resizable 200–360 px (double-click resets), collapses to a 56 px
// rail with badges + tooltips, tree keyboard model (↑↓ move, ←→ fold, ↵ open, F2 rename, Alt+↑/↓ reorder).
// Preferences: sidebar-r6.tsx (localStorage "lumen.sidebar").
import { askConfirm } from "./dialogs-r9";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SPACE_KINDS, type Folder, type Note, type Space } from "../../shared/types";
import { createFolder, createNote, dailyNote, deleteFolder, moveFolder, moveNote } from "../lib/actions";
import { patch } from "../lib/db";
import { natural, progress, roadmap, tasks } from "../lib/parse";
import { getSettings, useSettings } from "../lib/settings";
import { expandSidebar, go, noteDerived, openNote, setUI, toast, toggleSidebar, useUI, useVault, type UI, type View } from "../lib/store";
import { useSync } from "../lib/sync";
import { num } from "./ws-dir";
import { t } from "../lib/i18n";
import { PRESETS } from "../lib/canvas";
import { useDueCards } from "../lib/due-cards";
import { cx } from "./ui";
import { SidebarSmartFolders, openSmartEditor, scopeQuery } from "./SmartFolders";
import { AccountSwitcher } from "./AccountSwitcher";
import { Glyph } from "./Glyph";
import { AvatarGlyph, SpaceIcon, SpaceTile as SpaceTileBox } from "./SpaceIcon";
import { useAvatarImage } from "../lib/home-meta";
import { openAsk } from "../lib/ask";
import { buildPath, pathProgress, resolveCourses } from "../lib/path";
import { NewPathDialog } from "./NewPathDialog";
import { openTag, tagTree, useTagMeta, type TagNode } from "../lib/tag-tree";
import { openTagMenu } from "./TagPage";
import { ITEMS, SECTIONS, SidebarOverlays, WIDTH, getSb, openSidebarCustomise, setSb, useSb, type ItemKey, type SectionKey } from "./sidebar-r6";
import { isWbType } from "../../shared/types";
import { setDrag } from "../lib/dnd";
import "../lib/ai-usage"; // registers the AI usage listener at startup (Settings › AI meter)

/** Space kind labels, translated on read (getters), so `KIND_LABEL[k]` is already in the interface language. */
export const KIND_LABEL: Record<Space["kind"], string> = {
  get project() { return t("Project"); }, get area() { return t("Area"); }, get course() { return t("Course"); }, get resource() { return t("Resource"); }, get archive() { return t("Archive"); },
};
const KIND_PLURAL: Record<Space["kind"], () => string> = { project: () => t("Projects"), area: () => t("Areas"), course: () => t("Courses"), resource: () => t("Resources"), archive: () => t("Archives") };
const colorOf = (c: string | null | undefined) => (c ? PRESETS[c] ?? c : null);
const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export type NavKey = "home" | "today" | "inbox" | "daily" | "tasks" | "calendar" | "review" | "graph" | "canvas" | "paths" | "blog";
interface NavItem { key: NavKey; icon: ReactNode; label: string; count?: number; learn?: boolean }

/** Which nav item is active for the current UI state. */
function activeKey(ui: UI): ItemKey | null {
  if (ui.view === "notes") return ui.filter === "visual" ? "canvas" : ui.filter === "published" ? "blog" : ui.spaceId === "inbox" && !ui.folderId && !ui.tag && !ui.noteId ? "inbox" : null;
  return ({ home: "home", today: "today", tasks: "tasks", kanban: "tasks", calendar: "calendar", review: "review", graph: "graph", trash: "trash" } as Partial<Record<View, ItemKey>>)[ui.view] ?? null;
}

/** Counts for the nav items (kept for callers of the round-4 API). */
function useCounts() {
  const v = useVault();
  const due = useDueCards(v.notes)?.length ?? 0;
  const today = new Date().toISOString().slice(0, 10);
  const t2 = useMemo(() => {
    let open = 0, dueT = 0;
    for (const n of v.notes) {
      if (n.type === "roadmap") continue;
      const ts = noteDerived("sbTasks", n, (x) => tasks(x.body).filter((k) => !k.done).map((k) => k.due ?? ""));
      open += ts.length; dueT += ts.filter((d) => d && d <= today).length;
    }
    return { open, dueT };
  }, [v.notes, today]);
  const inbox = v.notes.filter((n) => n.spaceId === "inbox").length;
  const canvases = v.notes.filter((n) => n.type === "canvas" || isWbType(n.type)).length;
  return { review: due, tasks: t2.dueT, openTasks: t2.open, inbox, canvases, trash: 0 };
}

export function useNav(): NavItem[] {
  const c = useCounts();
  const g = (n: string) => <Glyph name={n} size={16} />;
  return [
    { key: "home", icon: g("home"), label: t("Home") }, { key: "today", icon: g("date"), label: t("Today") }, { key: "inbox", icon: g("inbox"), label: t("Inbox"), count: c.inbox },
    { key: "daily", icon: g("journal"), label: t("Daily note") }, { key: "tasks", icon: g("task"), label: t("Tasks"), count: c.openTasks }, { key: "calendar", icon: g("v-calendar"), label: t("Calendar") },
    { key: "review", icon: g("flashcards"), label: t("Review"), count: c.review, learn: true }, { key: "graph", icon: g("graph"), label: t("Graph") }, { key: "canvas", icon: g("canvas"), label: t("Canvases") },
    { key: "paths", icon: g("path"), label: t("Learning paths") }, { key: "blog", icon: g("post"), label: t("Blog") },
  ];
}

export async function runNav(k: NavKey | ItemKey, spaceId: string) {
  const sp = spaceId === "all" ? "inbox" : spaceId;
  if (k === "home") go("home");
  else if (k === "today") go("today");
  else if (k === "inbox") go("notes", { spaceId: "inbox", folderId: null, tag: null, filter: null, noteId: null });
  else if (k === "daily") openNote((await dailyNote(sp)).id, "edit");
  else if (k === "canvas") go("notes", { spaceId: "all", folderId: null, tag: null, filter: "visual" });
  else if (k === "paths") go("notes", { spaceId: "all", folderId: null, tag: null, filter: "paths" });
  else if (k === "blog") go("notes", { spaceId: "all", folderId: null, tag: null, filter: "published" });
  else if (k === "ask") openAsk();
  else if (k === "trash") go("trash");
  else go(k as View);
}

async function newNote(spaceId: string, folderId: string | null) {
  const n = await createNote({ spaceId: spaceId === "all" ? "inbox" : spaceId, folderId: spaceId === "all" ? null : folderId });
  openNote(n.id, "edit");
}

// ------------------------------------------------------------------ global keys (registered once)
let keysOn = false;
function installKeys() {
  if (keysOn) return;
  keysOn = true;
  addEventListener("keydown", (e) => {
    const el = e.target as HTMLElement;
    const typing = !!el.closest?.("input,textarea,select,[contenteditable=true],.cm-editor");
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && !e.shiftKey && /^[1-5]$/.test(e.key) && !document.querySelector("[data-switcher-open]")) {
      const k = getSb().top[Number(e.key) - 1];
      if (k) { e.preventDefault(); void runNav(k, getUIspace()); }
    } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n" && !typing) {
      e.preventDefault(); void newNote(getUIspace(), null);
    } else if (mod && !e.shiftKey && !e.altKey && e.key === "0") { // ⌘0: space switcher (Lumen 30)
      const b = document.querySelector<HTMLElement>("[data-sidebar] [data-space-switch]");
      if (b) { e.preventDefault(); b.click(); }
    } else if (e.key === "F6") {
      const nav = document.querySelector<HTMLElement>("[data-sidebar] [data-sb-item]");
      if (nav) { e.preventDefault(); nav.focus(); }
    }
  });
}
let uiSpace = "inbox";
const getUIspace = () => uiSpace;

// ------------------------------------------------------------------ tree keyboard model
function treeKeys(e: React.KeyboardEvent<HTMLElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-sb-item]")].filter((x) => x.offsetParent);
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const cur = items[i];
  if (e.key === "ArrowDown" && !e.altKey) { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
  else if (e.key === "ArrowUp" && !e.altKey) { e.preventDefault(); items[Math.max(0, i - 1)]?.focus(); }
  else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    const open = cur.getAttribute("aria-expanded");
    const rtl = getComputedStyle(cur).direction === "rtl";
    const wantOpen = (e.key === "ArrowRight") !== rtl;
    if (open !== null && (open === "true") !== wantOpen) { e.preventDefault(); cur.dispatchEvent(new CustomEvent("sb-fold", { bubbles: false })); }
  } else if (e.key === "F2") { e.preventDefault(); cur.dispatchEvent(new CustomEvent("sb-rename")); }
  else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    const k = cur.dataset.sbKey as ItemKey | undefined;
    const p = getSb();
    if (k && p.top.includes(k)) {
      e.preventDefault();
      const j = p.top.indexOf(k), to = j + (e.key === "ArrowUp" ? -1 : 1);
      if (j > 0 && to > 0 && to < p.top.length) { const l = [...p.top]; l.splice(j, 1); l.splice(to, 0, k); setSb({ top: l }); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-sb-key="${k}"]`)?.focus()); }
    }
  }
}
/** Listen to the tree's fold / rename events on an element. */
function useTreeEvents(ref: React.RefObject<HTMLElement | null>, fold: () => void, rename?: () => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const f = () => fold(), r = () => rename?.();
    el.addEventListener("sb-fold", f); el.addEventListener("sb-rename", r);
    return () => { el.removeEventListener("sb-fold", f); el.removeEventListener("sb-rename", r); };
  });
}

// ------------------------------------------------------------------ space switcher tile + meta
function SpaceTile({ space, size = 28 }: { space?: Space; size?: number }) {
  return <SpaceTileBox space={space} size={size} glyph={size >= 32 ? 13 : size >= 28 ? 15 : Math.round(size * 0.6)} />;
}
function spaceMeta(v: ReturnType<typeof useVault>, space?: Space) {
  if (!space) return t("{n} space|{n} spaces", { n: v.spaces.length });
  if (space.kind === "course" && space.roadmapId) return `${KIND_LABEL[space.kind]} · ${t("{pct}% done", { pct: progress(roadmap(v.byId.get(space.roadmapId)?.body ?? "")).pct })}`;
  return `${KIND_LABEL[space.kind]} · ${t("{n} note|{n} notes", { n: v.notes.filter((n) => n.spaceId === space.id).length })}`;
}

// ------------------------------------------------------------------ rows
const rowCls = "relative flex shrink-0 items-center gap-2 rounded-[7px] px-1.5 text-start outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]";
function Row({ glyph, glyphColor, label, count, countColor, countBold, active, onClick, indent = 0, caret, dot, round, sc, kbd, sbKey, expanded, children, title, onContextMenu, className, style, rowRef, dragProps }: {
  glyph?: string; glyphColor?: string; label: ReactNode; count?: ReactNode; countColor?: string; countBold?: boolean; active?: boolean; onClick?: () => void; indent?: number;
  caret?: "open" | "closed" | null; dot?: string | null; round?: boolean; sc?: string; kbd?: boolean; sbKey?: string; expanded?: boolean; children?: ReactNode; title?: string;
  onContextMenu?: (e: React.MouseEvent) => void; className?: string; style?: React.CSSProperties; rowRef?: React.Ref<HTMLButtonElement>; dragProps?: React.HTMLAttributes<HTMLButtonElement> & { draggable?: boolean };
}) {
  return (
    <button ref={rowRef} type="button" data-sb-item data-sb-key={sbKey} role="treeitem" aria-selected={!!active} aria-expanded={expanded} onClick={onClick} onContextMenu={onContextMenu} title={title}
      className={cx(rowCls, "group w-full", active ? "bg-surface-2 font-semibold text-ink" : "font-[450] text-ink hover:bg-surface-2/60", className)}
      style={{ height: "var(--sb-row, 32px)", paddingInlineStart: 6 + indent * 16, ...style }} {...dragProps}>
      {active && <span className="absolute inset-y-[7px] start-0 w-[3px] rounded-[2px] bg-accent" />}
      {caret !== undefined && <span className="w-2.5 shrink-0 text-[9px] text-muted rtl:-scale-x-100">{caret === "open" ? "▾" : caret === "closed" ? "▸" : ""}</span>}
      {dot && <span className="size-2 shrink-0" style={{ background: dot, borderRadius: round ? "50%" : 3 }} />}
      {glyph && <Glyph name={glyph} size={16} color={active ? "var(--accent)" : glyphColor ?? "var(--muted)"} />}
      <span className="min-w-0 flex-1 truncate" dir="auto">{label}</span>
      {children}
      {count !== undefined && count !== null && count !== "" && count !== 0 && <span className="text-[11.5px] tabular-nums" style={{ color: countColor ?? "var(--muted)", fontWeight: countBold ? 600 : 450 }}>{typeof count === "number" ? num(count) : count}</span>}
      {sc && kbd && <span dir="ltr" className="font-mono text-[10.5px] font-medium text-muted">{sc}</span>}
    </button>
  );
}

function Head({ id, count, onAdd, addLabel }: { id: SectionKey; count?: number | string; onAdd?: () => void; addLabel?: string }) {
  const p = useSb();
  const closed = !!p.folded[id];
  const ref = useRef<HTMLButtonElement>(null);
  const toggle = () => setSb({ folded: { ...p.folded, [id]: !closed } });
  useTreeEvents(ref, toggle);
  return (
    <div className="mt-2.5 flex h-7 shrink-0 items-center">
      <button ref={ref} type="button" data-sb-item aria-expanded={!closed} onClick={toggle}
        className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[6px] px-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted outline-none hover:text-ink focus-visible:shadow-[0_0_0_2px_var(--accent)]">
        <span className="w-2.5 text-[9px] tracking-normal rtl:-scale-x-100">{closed ? "▸" : "▾"}</span>
        <span className="flex-1 truncate text-start">{t(SECTIONS[id].label)}</span>
        {count !== undefined && count !== "" && <span className="font-medium normal-case tracking-normal">{typeof count === "number" ? num(count) : count}</span>}
      </button>
      {onAdd && <button type="button" title={addLabel} aria-label={addLabel} onClick={onAdd} className="flex size-5 items-center justify-center rounded-[5px] text-muted hover:bg-surface-2 hover:text-ink">+</button>}
    </div>
  );
}

// ------------------------------------------------------------------ main
export function Sidebar({ rail }: { rail?: boolean }) {
  const ui = useUI();
  const v = useVault();
  const p = useSb();
  const c = useCounts();
  const sync = useSync();
  const space = ui.spaceId === "all" ? undefined : v.spaceMap.get(ui.spaceId);
  const [switcher, setSwitcher] = useState(false);
  const [kbd, setKbd] = useState(false);
  const [resizing, setResizing] = useState<number | null>(null);
  const [hoverHandle, setHoverHandle] = useState(false);
  const [pathDlg, setPathDlg] = useState(false);
  const act = activeKey(ui);
  uiSpace = ui.spaceId;
  useEffect(installKeys, []);
  const phone = typeof matchMedia !== "undefined" && matchMedia("(max-width: 899px)").matches;
  const tablet = !phone && typeof matchMedia !== "undefined" && matchMedia("(max-width: 1199px)").matches;
  const width = phone ? Math.min(340, innerWidth - 40) : tablet ? 232 : resizing ?? p.width;
  const rowH = phone ? 44 : tablet ? Math.max(36, p.rowH) : p.rowH;

  const countOf = (k: ItemKey): { n?: number; color?: string; bold?: boolean } => {
    if (p.counts === "none") return {};
    if (k === "review") return { n: c.review, color: "var(--learn)", bold: true };
    if (k === "tasks") return { n: c.tasks, color: "var(--warning)", bold: true };
    if (k === "inbox") return { n: c.inbox };
    if (p.counts === "all" && k === "canvas") return { n: c.canvases };
    return {};
  };
  const item = (k: ItemKey, i: number, indent = 0) => {
    const it = ITEMS[k];
    const cn = countOf(k);
    const sc = i < 5 && indent === 0 ? `${MOD}${i + 1}` : it.sc ? `${MOD}${it.sc}` : undefined;
    return <Row key={k} sbKey={k} glyph={it.glyph} label={t(it.label)} active={act === k} indent={indent} count={cn.n} countColor={cn.color} countBold={cn.bold} sc={sc} kbd={kbd} onClick={() => void runNav(k, ui.spaceId)} />;
  };

  // ---------------------------------------------------------------- rail (56 px)
  if (rail) {
    const RailBtn = ({ k, glyph, label, sc, badge, badgeColor, onClick, active }: { k: string; glyph: string; label: string; sc?: string; badge?: number; badgeColor?: string; onClick: () => void; active?: boolean }) => (
      <button key={k} type="button" aria-label={label} onClick={onClick} data-sb-item className={cx("group relative flex size-9 shrink-0 items-center justify-center rounded-[7px] outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]", active ? "bg-surface-2" : "hover:bg-surface-2")}>
        <Glyph name={glyph} size={16} color={active ? "var(--accent)" : "var(--muted)"} />
        {!!badge && <span className="absolute end-0.5 top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-[8px] px-[3px] text-[9px] font-bold text-bg" style={{ background: badgeColor }}>{badge > 99 ? "99+" : badge}</span>}
        <span role="tooltip" className="pointer-events-none absolute start-[46px] top-1 z-50 hidden h-7 items-center gap-2 whitespace-nowrap rounded-[7px] bg-ink px-2.5 font-medium text-bg shadow-[0_6px_16px_rgba(0,0,0,.3)] group-hover:flex group-focus-visible:flex">{label}{sc && <span dir="ltr" className="font-mono text-[10.5px] opacity-60">{sc}</span>}</span>
      </button>
    );
    return (
      <nav aria-label={t("Main")} data-sidebar className="safe-t flex h-full w-14 shrink-0 flex-col items-center border-e border-line bg-surface text-[13px]" onKeyDown={treeKeys}>
        <div className="flex flex-col items-center gap-1.5 px-2 py-2.5">
          <button type="button" data-space-switch aria-label={space?.name ?? t("All spaces")} onClick={() => setSwitcher((s) => !s)} className="flex h-11 w-10 items-center justify-center rounded-[10px] border border-line bg-bg"><SpaceTile space={space} size={28} /></button>
          {switcher && <SpaceSwitcher onClose={() => setSwitcher(false)} rail />}
          <button type="button" aria-label={t("New note")} title={`${t("New note")} (${MOD}N)`} onClick={() => void newNote(ui.spaceId, ui.folderId)} className="flex size-9 items-center justify-center rounded-[9px] bg-accent"><Glyph name="plus" size={16} color="var(--accent-fg)" /></button>
          <button type="button" aria-label={t("Search")} title={`${t("Search")} (${MOD}K)`} onClick={() => setUI({ palette: true })} className="flex size-9 items-center justify-center rounded-[9px] border border-line"><Glyph name="search" size={16} /></button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col items-center gap-px overflow-y-auto px-2 py-1">
          {p.top.map((k, i) => <RailBtn key={k} k={k} glyph={ITEMS[k].glyph} label={t(ITEMS[k].label)} sc={i < 5 ? `${MOD}${i + 1}` : undefined} active={act === k} onClick={() => void runNav(k, ui.spaceId)}
            badge={k === "review" ? c.review : k === "tasks" ? c.tasks : undefined} badgeColor={k === "tasks" ? "var(--warning)" : "var(--learn)"} />)}
          <RailBtn k="more" glyph="more" label={t("More")} onClick={() => { setSb({ moreOpen: true }); expandSidebar(); }} />
          <div className="my-2 h-px w-6 shrink-0 bg-line" />
          {p.sections.filter((s) => s.on).map((s) => <RailBtn key={s.id} k={s.id} glyph={SECTIONS[s.id].glyph} label={t(SECTIONS[s.id].label)} onClick={() => { setSb({ folded: { ...p.folded, [s.id]: false } }); expandSidebar(); }} />)}
        </div>
        <div className="safe-b flex flex-col items-center gap-2 border-t border-line px-1.5 py-2.5">
          <SyncDot />
          <button type="button" aria-label={t("Settings")} title={t("Settings")} onClick={() => go("settings")} className={cx("flex size-7 items-center justify-center rounded-[7px]", ui.view === "settings" ? "bg-surface-2" : "hover:bg-surface-2")}><Glyph name="gear" size={16} color={ui.view === "settings" ? "var(--accent)" : "var(--muted)"} /></button>
          <Avatar size={28} />
        </div>
        <SidebarOverlays />
      </nav>
    );
  }

  // ---------------------------------------------------------------- full sidebar
  const moreCount = p.more.length;
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = p.width, rtl = getComputedStyle(e.currentTarget as HTMLElement).direction === "rtl";
    let w = w0;
    const mv = (m: PointerEvent) => { w = Math.round(Math.min(WIDTH.max, Math.max(WIDTH.min, w0 + (rtl ? x0 - m.clientX : m.clientX - x0)))); setResizing(w); };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); setResizing(null); setSb({ width: w }); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  const offline = sync.status === "offline" || (sync.status === "error" && sync.pending > 0);

  return (
    <nav aria-label={t("Main")} data-sidebar className="safe-t relative flex h-full shrink-0 flex-col border-e border-line bg-surface text-[13px] text-ink" style={{ width, ["--sb-row" as string]: `${rowH}px` }}
      onKeyDown={(e) => { if (["ArrowUp", "ArrowDown", "Tab", "F2"].includes(e.key)) setKbd(true); treeKeys(e); }} onPointerDown={() => setKbd(false)}>
      <div className="relative flex flex-col gap-1.5 px-2.5 pb-1.5 pt-2.5">
        <button type="button" data-space-switch onClick={() => setSwitcher((s) => !s)} aria-expanded={switcher} aria-haspopup="dialog"
          className={cx("flex h-11 items-center gap-2.5 rounded-[10px] border bg-bg px-2 text-start outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]", switcher ? "border-accent" : "border-line")}>
          <SpaceTile space={space} />
          <span className="flex min-w-0 flex-1 flex-col leading-4"><span className="truncate font-[650]" dir="auto">{space?.name ?? t("All spaces")}</span><span className="truncate text-[11.5px] text-muted">{spaceMeta(v, space)}</span></span>
          <span className="text-[11px] text-muted">⌃⌄</span>
        </button>
        {switcher && <SpaceSwitcher onClose={() => setSwitcher(false)} />}
        <div className="flex gap-1.5">
          <button type="button" onClick={() => void newNote(ui.spaceId, ui.folderId)} className="flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-accent font-semibold text-accent-fg outline-none focus-visible:shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--accent)]">
            <Glyph name="plus" size={14} color="var(--accent-fg)" />{t("New note")}<span dir="ltr" className="font-mono text-[10.5px] font-medium opacity-70">{MOD === "⌘" ? "⌘N" : "Ctrl N"}</span>
          </button>
          <button type="button" aria-label={`${t("Search")} ${MOD}K`} title={`${t("Search")} (${MOD}K)`} onClick={() => setUI({ palette: true })} className="flex size-[34px] items-center justify-center rounded-[8px] border border-line outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"><Glyph name="search" size={15} /></button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div role="tree" aria-label={t("Navigation")} className="flex h-full flex-col gap-px overflow-y-auto px-2 pb-8 pt-0.5">
          {p.top.map((k, i) => item(k, i))}
          {moreCount > 0 && (
            <Row sbKey="more" glyph="more" label={p.moreOpen ? t("Less") : t("More")} expanded={p.moreOpen} count={p.moreOpen ? undefined : moreCount} onClick={() => setSb({ moreOpen: !p.moreOpen })} className="!font-[450] text-muted" />
          )}
          {p.moreOpen && p.more.map((k) => item(k, 99, 1))}
          {p.sections.filter((s) => s.on).map((s) => <Section key={s.id} id={s.id} kbd={kbd} onNewPath={() => setPathDlg(true)} />)}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-gradient-to-b from-transparent to-[var(--surface)]" />
      </div>

      <div className="safe-b flex flex-col gap-2 border-t border-line px-3 py-2.5">
        {offline && (
          <div role="status" className="flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-[12px]" style={{ background: "color-mix(in srgb, var(--warning) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--warning) 35%, transparent)" }}>
            <Glyph name="c-warning" size={13} color="var(--warning)" /><span className="flex-1">{t("Offline · {n} changes waiting", { n: num(sync.pending) })}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <SyncDot withText />
          <button type="button" aria-label={t("Settings")} title={t("Settings")} onClick={() => go("settings")} className={cx("flex size-7 items-center justify-center rounded-[7px] outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]", ui.view === "settings" ? "bg-surface-2" : "hover:bg-surface-2")}><Glyph name="gear" size={16} color={ui.view === "settings" ? "var(--accent)" : "var(--muted)"} /></button>
          <Avatar size={28} />
        </div>
        <div className="flex items-center gap-1.5">
          {!phone ? (
            <button type="button" onClick={toggleSidebar} className="flex flex-1 items-center gap-1.5 text-[11.5px] text-muted hover:text-ink">
              <span className="flex-1 text-start">{t("Collapse")}</span><span dir="ltr" className="font-mono">{MOD === "⌘" ? "⌘\\" : "Ctrl \\"}</span>
            </button>
          ) : <span className="flex-1" />}
          <button type="button" aria-label={t("Customise sidebar")} title={t("Customise sidebar")} onClick={openSidebarCustomise} className="flex h-5 w-6 items-center justify-center rounded-[5px] text-muted hover:bg-surface-2 hover:text-ink"><Glyph name="more" size={14} /></button>
        </div>
      </div>

      {!phone && !tablet && (
        <div role="separator" aria-orientation="vertical" aria-label={t("Resize sidebar")} aria-valuenow={width} aria-valuemin={WIDTH.min} aria-valuemax={WIDTH.max} tabIndex={0}
          onPointerDown={startResize} onDoubleClick={() => setSb({ width: WIDTH.def })} onPointerEnter={() => setHoverHandle(true)} onPointerLeave={() => setHoverHandle(false)}
          onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setSb({ width: p.width + (e.key === "ArrowRight" ? 8 : -8) }); } }}
          className="absolute inset-y-0 -end-[3px] z-10 w-1.5 cursor-col-resize outline-none">
          <span className="absolute inset-y-0 start-0.5 w-0.5" style={{ background: resizing !== null || hoverHandle ? "var(--accent)" : "transparent" }} />
          {(resizing !== null || hoverHandle) && <span className="absolute start-2.5 top-[48%] flex h-6 items-center whitespace-nowrap rounded-[6px] bg-ink px-2 text-[11.5px] text-bg">{t("{n} px · double-click resets", { n: width })}</span>}
        </div>
      )}
      <NewPathDialog open={pathDlg} onClose={() => setPathDlg(false)} />
      <SidebarOverlays />
    </nav>
  );
}

function SyncDot({ withText }: { withText?: boolean }) {
  const s = useSync();
  const colorBase = s.status === "error" ? "var(--danger)" : s.status === "offline" ? "var(--warning)" : s.status === "local" ? "var(--muted)" : "var(--success)";
  const stuck = s.status === "idle" && s.stuck?.length ? s.stuck.length : 0; // records too large to sync (details in the note header)
  const color = stuck ? "var(--warning)" : colorBase;
  const text = s.status === "syncing" ? t("Syncing…") : s.status === "offline" ? t("Offline") : s.status === "error" ? t("Sync error") : s.status === "local" ? t("This device only") : stuck ? t("{n} item too large to sync|{n} items too large to sync", { n: stuck }) : s.last ? t("Synced {ago}", { ago: fmtAgo(s.last) }) : t("Synced");
  return (
    <button type="button" onClick={() => (s.status === "local" ? go("settings") : void import("../lib/sync").then((m) => m.syncNow()))} title={text} aria-label={text} className={cx("flex min-w-0 items-center gap-2", withText && "flex-1")}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
      {withText && <span className="truncate text-[12px] text-muted">{text}</span>}
    </button>
  );
}
function fmtAgo(at: number) {
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1 ? t("just now") : m < 60 ? t("{n} min ago", { n: m }) : t("{n} h ago", { n: Math.round(m / 60) });
}

function Avatar({ size = 26 }: { size?: number }) {
  const s = useSettings();
  const img = useAvatarImage();
  const initials = (s.author || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (
    <button type="button" onClick={() => go("settings")} title={s.author || t("Profile")} aria-label={s.author || t("Profile")} className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-[11px] font-bold outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]" style={{ width: size, height: size }}>
      {img ? <img src={img} alt="" className="size-full object-cover" /> : initials || <AvatarGlyph value={s.avatar} size={12} />}
    </button>
  );
}

// ------------------------------------------------------------------ sections
function Section({ id, kbd, onNewPath }: { id: SectionKey; kbd: boolean; onNewPath: () => void }) {
  const p = useSb();
  const closed = !!p.folded[id];
  if (id === "favourites") return <Favourites closed={closed} />;
  if (id === "paths") return <Paths closed={closed} onNew={onNewPath} />;
  if (id === "folders") return <Folders closed={closed} />;
  if (id === "smart") return <Smart closed={closed} />;
  if (id === "tags") return <TagsSection closed={closed} />;
  if (id === "recent") return <Recent closed={closed} />;
  void kbd;
  return null;
}

function NoteRow({ n, indent = 0 }: { n: Note; indent?: number }) {
  const ui = useUI();
  const on = ui.noteId === n.id && ui.view === "notes";
  const g = isWbType(n.type) ? "whiteboard" : n.type === "canvas" ? "canvas" : n.type === "path" ? "path" : "lesson";
  return <Row glyph={g} label={n.title || t("Untitled")} title={n.title} active={on} indent={indent} onClick={() => openNote(n.id)} dragProps={{ draggable: true, onDragStart: (e) => dragNote(e, n.id), "data-dnd-note": n.id } as React.HTMLAttributes<HTMLButtonElement> & { draggable?: boolean }} />;
}

function Favourites({ closed }: { closed: boolean }) {
  const v = useVault();
  const list = useMemo(() => v.notes.filter((n) => n.favorite || n.pinned).sort((a, b) => b.updatedAt - a.updatedAt), [v.notes]);
  return (
    <>
      <Head id="favourites" count={list.length || ""} />
      {!closed && (list.length ? list.slice(0, 12).map((n) => <NoteRow key={n.id} n={n} />) : <Empty text={t("Star a note or board (⋯ › Favourite) to keep it here.")} />)}
    </>
  );
}

function Empty({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="mx-1 mb-1 mt-0.5 flex flex-col gap-1.5 rounded-[9px] border border-dashed border-line px-2.5 py-[9px]">
      <span className="text-[12px] leading-[17px] text-muted">{text}</span>
      {action && <button type="button" onClick={onAction} className="self-start text-[12px] font-semibold text-accent">{action}</button>}
    </div>
  );
}

const PATH_COLORS = ["#A371F7", "#39C5CF", "#57AB5A", "#E8893A", "#E3B341", "#E5534B"];
function Paths({ closed, onNew }: { closed: boolean; onNew: () => void }) {
  const v = useVault();
  const ui = useUI();
  const paths = useMemo(() => v.notes.filter((n) => n.type === "path").map((n, i) => {
    let pct = 0;
    try { const courses = resolveCourses(((n.props as Record<string, unknown> | undefined)?.courses as string[] | undefined) ?? [], v.notes, v.spaces); pct = pathProgress(buildPath(n.body, courses)).pct; } catch { /* bad path body */ }
    return { n, pct, color: PATH_COLORS[i % PATH_COLORS.length] };
  }), [v.notes, v.spaces]);
  return (
    <>
      <Head id="paths" count={paths.length || ""} onAdd={onNew} addLabel={t("New path")} />
      {!closed && (paths.length ? paths.map(({ n, pct, color }) => (
        <Row key={n.id} glyph="path" glyphColor={color} label={n.title} active={ui.noteId === n.id && ui.view === "notes"} count={t("{n}%", { n: pct })} onClick={() => openNote(n.id)} />
      )) : <Empty text={t("No paths yet. A path joins courses into one route with stages.")} action={t("New path")} onAction={onNew} />)}
    </>
  );
}

function Smart({ closed }: { closed: boolean }) {
  const v = useVault();
  const ui = useUI();
  return (
    <>
      <Head id="smart" onAdd={() => openSmartEditor({ query: scopeQuery(v, ui) })} addLabel={t("New smart folder")} />
      {!closed && <SidebarSmartFolders bare />}
    </>
  );
}

function Recent({ closed }: { closed: boolean }) {
  const v = useVault();
  const list = useMemo(() => [...v.notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8), [v.notes]);
  return <><Head id="recent" />{!closed && list.map((n) => <NoteRow key={n.id} n={n} />)}</>;
}

// Nested tags (#ml/llm): lib/tag-tree.ts rolls counts up to parents; colours + pins from the Inbox props `lumenTagMeta`.
function TagsSection({ closed }: { closed: boolean }) {
  const v = useVault();
  const meta = useTagMeta();
  const [all, setAll] = useState(false);
  const tree = useMemo(() => tagTree(v.tags, meta.colors, meta.pinned), [v.tags, meta]);
  const shown = all ? tree : tree.slice(0, 8);
  return (
    <>
      <Head id="tags" count={v.tags.length || ""} />
      {!closed && <>
        {shown.map((n) => <TagRow key={n.path} n={n} depth={0} />)}
        {tree.length > 8 && <button type="button" data-sb-item onClick={() => setAll(!all)} className={cx(rowCls, "w-full text-link")} style={{ height: "var(--sb-row)", paddingInlineStart: 26 }}>{all ? t("Show fewer") : t("Show all {n} tags", { n: v.tags.length })}</button>}
      </>}
    </>
  );
}
function TagRow({ n, depth }: { n: TagNode; depth: number }) {
  const ui = useUI();
  const key = `lumen.tagfold.${n.path}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  const ref = useRef<HTMLButtonElement>(null);
  const toggle = () => setOpen((o) => { try { localStorage.setItem(key, o ? "0" : "1"); } catch { /* ignore */ } return !o; });
  useTreeEvents(ref, () => n.children.length && toggle(), () => window.dispatchEvent(new CustomEvent("lumen:tag-menu", { detail: { tag: n.path, x: ref.current?.getBoundingClientRect().right ?? 0, y: ref.current?.getBoundingClientRect().top ?? 0, dialog: "rename" } })));
  return (
    <>
      <Row rowRef={ref} label={depth ? n.name : `#${n.name}`} indent={depth} caret={n.children.length ? (open ? "open" : "closed") : null} dot={n.color ?? "var(--muted)"} round expanded={n.children.length ? open : undefined}
        active={ui.tag === n.path && ui.view === "notes"} count={n.count}
        onContextMenu={(e) => { e.preventDefault(); openTagMenu(n.path, { x: e.clientX, y: e.clientY }); }}
        onClick={() => { if (n.children.length && !open) toggle(); openTag(n.path); }}>
        {n.pinned && <Glyph name="pin" size={12} color="var(--muted)" />}
      </Row>
      {open && n.children.map((c) => <TagRow key={c.path} n={c} depth={depth + 1} />)}
    </>
  );
}

// ------------------------------------------------------------------ space switcher (R6-30A–C)
function SpaceSwitcher({ onClose, rail }: { onClose: () => void; rail?: boolean }) {
  const ui = useUI();
  const v = useVault();
  const p = useSb();
  const pinned = (p.pinnedSpaces ?? []).filter((id) => v.spaceMap.has(id));
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const ql = q.trim().toLowerCase();
  const match = (s: Space) => !ql || s.name.toLowerCase().includes(ql);
  const pick = (s: Space | null) => {
    onClose();
    if (!s) return setUI({ spaceId: "all", folderId: null, filter: null });
    go(s.id === "inbox" || s.kind === "area" || s.kind === "resource" ? "notes" : "space", { spaceId: s.id, folderId: null, tag: null, filter: null });
  };
  const togglePin = (id: string) => setSb({ pinnedSpaces: pinned.includes(id) ? pinned.filter((x) => x !== id) : [...pinned, id].slice(0, 9) });
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) { const s = v.spaceMap.get(pinned[Number(e.key) - 1]); if (s) { e.preventDefault(); pick(s); } }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); onClose(); setUI({ newSpace: true }); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });
  const sub = (s: Space) => spaceMeta(v, s);
  const row = (s: Space, sc?: string) => {
    const on = ui.spaceId === s.id;
    const isPinned = pinned.includes(s.id);
    return (
      <div key={s.id} className={cx("group flex h-10 items-center gap-2.5 rounded-[8px] px-2", on ? "bg-bg font-semibold" : "hover:bg-surface-2")}>
        <button type="button" onClick={() => pick(s)} className="flex min-w-0 flex-1 items-center gap-2.5 text-start">
          <SpaceIcon space={s} size={15} tile tileScale={1.75} />
          <span className="flex min-w-0 flex-1 flex-col leading-4"><span className="truncate" dir="auto">{s.name}</span><span className="truncate text-[11.5px] font-normal text-muted">{sub(s)}</span></span>
        </button>
        <button type="button" onClick={() => togglePin(s.id)} aria-label={isPinned ? t("Unpin") : t("Pin")} title={isPinned ? t("Unpin") : t("Pin")} className={cx("text-muted hover:text-ink", isPinned ? "hidden group-hover:block" : "hidden group-hover:block")}><Glyph name="pin" size={13} /></button>
        {sc && <span dir="ltr" className="font-mono text-[11px] text-muted group-hover:hidden">{sc}</span>}
        {on && <Glyph name="check" size={14} color="var(--accent)" />}
      </div>
    );
  };
  const head = (h: string) => <div className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[.06em] text-muted">{h}</div>;
  const live = v.spaces.filter((s) => !s.archived && match(s));
  const archived = v.spaces.filter((s) => s.archived);
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div role="dialog" aria-label={t("Switch space")} data-switcher-open className="fixed z-40 flex max-h-[min(640px,80vh)] w-[320px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[12px] border border-line bg-surface text-[13px] shadow-[0_14px_34px_rgba(0,0,0,.35)] fade-in"
        style={{ top: 62, insetInlineStart: rail ? 64 : 12 }}>
        <div className="p-2 pb-1">
          <label className="flex h-[38px] items-center gap-2 rounded-[8px] border border-accent bg-bg px-2.5 text-muted">
            <Glyph name="search" size={14} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Find a space or account")} className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted"
              onKeyDown={(e) => { if (e.key === "Enter") { const s = live[0]; if (s) pick(s); } }} />
            <span dir="ltr" className="font-mono text-[11px]">{MOD}0</span>
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
          {!ql && <button type="button" onClick={() => pick(null)} className={cx("flex h-10 w-full items-center gap-2.5 rounded-[8px] px-2 text-start", ui.spaceId === "all" ? "bg-bg font-semibold" : "hover:bg-surface-2")}><Glyph name="folder" size={15} color="var(--muted)" tile="#9AA0AA" /><span className="flex-1">{t("All spaces")}</span>{ui.spaceId === "all" && <Glyph name="check" size={14} color="var(--accent)" />}</button>}
          {!ql && pinned.length > 0 && <>{head(t("Pinned"))}{pinned.map((id, i) => row(v.spaceMap.get(id)!, `${MOD}${i + 1}`))}</>}
          {SPACE_KINDS.map((k) => {
            const list = live.filter((s) => s.kind === k && (ql || !pinned.includes(s.id)));
            if (!list.length) return null;
            const total = list.length;
            const shown = open[k] || ql ? list : list.slice(0, 5);
            return (
              <div key={k}>
                {head(total > 1 ? `${KIND_PLURAL[k]()} · ${num(total)}` : KIND_PLURAL[k]())}
                {shown.map((s) => row(s))}
                {total > 5 && !ql && <button type="button" onClick={() => setOpen({ ...open, [k]: !open[k] })} className="flex h-10 w-full items-center gap-2.5 rounded-[8px] px-2 text-start text-muted hover:bg-surface-2"><Glyph name="more" size={15} />{open[k] ? t("Show fewer") : t("Show all {n} {kind}", { n: num(total), kind: KIND_PLURAL[k]().toLowerCase() })}</button>}
              </div>
            );
          })}
          <div className="my-1 h-px bg-line" />
          <button type="button" onClick={() => { onClose(); setUI({ newSpace: true }); }} className="flex h-10 w-full items-center gap-2.5 rounded-[8px] px-2 text-start text-muted hover:bg-surface-2"><Glyph name="plus" size={15} /><span className="flex-1">{t("New space…")}</span><span dir="ltr" className="font-mono text-[11px]">{MOD}N</span></button>
          {archived.length > 0 && (
            <details className="text-muted">
              <summary className="flex h-10 cursor-pointer list-none items-center gap-2.5 rounded-[8px] px-2 hover:bg-surface-2"><Glyph name="archive" size={15} />{t("Archived · {n}", { n: archived.length })}</summary>
              {archived.map((s) => row(s))}
            </details>
          )}
          <div className="my-1 h-px bg-line" />
          {head(t("Accounts"))}
          <AccountSwitcher compact onDone={onClose} />
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ folders (drag notes in, ⋯ menu with colour row)
const DRAG = "application/x-lumen";
type DragData = { kind: "note" | "folder"; id: string };
export const dragNote = (e: React.DragEvent, id: string) => { e.dataTransfer.setData(DRAG, JSON.stringify({ kind: "note", id })); setDrag(e, { kind: "note", id }); e.dataTransfer.effectAllowed = "copyMove"; }; // + the typed payload for boards (lib/dnd.ts)

function Folders({ closed }: { closed: boolean }) {
  const ui = useUI();
  const v = useVault();
  const spaceId = ui.spaceId;
  const folders = v.folders.filter((f) => f.spaceId === spaceId);
  const counts = useMemo(() => { const m = new Map<string, number>(); v.notes.forEach((n) => n.folderId && m.set(n.folderId, (m.get(n.folderId) ?? 0) + 1)); return m; }, [v.notes]);
  const [rootOver, setRootOver] = useState(false);
  if (spaceId === "all") return <><Head id="folders" />{!closed && <Empty text={t("Pick a space (top) to see its folders.")} />}</>;
  async function drop(e: React.DragEvent, target: string | null) {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DRAG);
    if (!raw) return;
    const d = JSON.parse(raw) as DragData;
    if (d.kind === "note") await moveNote(d.id, spaceId, target);
    else { const f = v.folderMap.get(d.id); if (f && f.id !== target) await moveFolder(f, spaceId, target); }
  }
  return (
    <>
      <Head id="folders" count={folders.length || ""} onAdd={() => void createFolder(spaceId, null)} addLabel={t("New folder")} />
      {!closed && (
        <div onDragOver={(e) => { e.preventDefault(); setRootOver(true); }} onDragLeave={() => setRootOver(false)} onDrop={(e) => { setRootOver(false); void drop(e, null); }}
          className={cx("flex flex-col gap-px rounded-[8px]", rootOver && "bg-accent/10 ring-1 ring-accent/40")}>
          <Tree folders={folders} parent={null} depth={0} counts={counts} onDrop={drop} />
          {!folders.length && <Empty text={t("No folders yet. Use + or drop notes here.")} />}
        </div>
      )}
    </>
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
  const [more, setMore] = useState(false);
  const hoverT = useRef(0);
  const ref = useRef<HTMLButtonElement>(null);
  const all = open ? v.notes.filter((n) => n.folderId === f.id).sort((a, b) => natural(a.title, b.title)) : [];
  const notes = more ? all : all.slice(0, 60);
  const toggle = () => setOpen((o) => { try { localStorage.setItem(key, o ? "0" : "1"); } catch { /* ignore */ } return !o; });
  useTreeEvents(ref, toggle, () => setRename(true));
  const openFolder = ui.view === "notes" && ui.noteId ? v.byId.get(ui.noteId)?.folderId ?? null : null;
  const holdsOpenNote = useMemo(() => { for (let id = openFolder; id; id = folders.find((x) => x.id === id)?.parentId ?? null) if (id === f.id) return true; return false; }, [openFolder, folders, f.id]);
  useEffect(() => { if (holdsOpenNote) setOpen(true); }, [holdsOpenNote, ui.noteId]);
  const active = ui.folderId === f.id && ui.view === "notes" && !(open && openFolder === f.id);
  const color = colorOf(f.color) ?? "var(--muted)";
  const MI = ({ g, l, k, run, danger }: { g: string; l: string; k?: string; run: () => void; danger?: boolean }) => (
    <button type="button" className={cx("flex h-8 w-full items-center gap-2.5 rounded-[6px] px-2 text-start text-[13px] hover:bg-surface-2", danger && "text-bad")} onClick={run}>
      <Glyph name={g} size={15} color={danger ? "var(--danger)" : "var(--muted)"} /><span className="flex-1">{l}</span>{k && <span className="font-mono text-[11px] text-muted">{k}</span>}
    </button>
  );
  return (
    <div className="relative">
      {rename ? (
        <div className="flex items-center gap-2 px-1.5" style={{ height: "var(--sb-row)", paddingInlineStart: 6 + depth * 16 + 18 }}>
          <input autoFocus defaultValue={f.name} className="h-6 min-w-0 flex-1 rounded border border-accent bg-bg px-1 outline-none" dir="auto"
            onBlur={(e) => { setRename(false); if (e.target.value.trim()) void patch("folder", f.id, { name: e.target.value.trim() }); ref.current?.focus(); }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRename(false); }} />
        </div>
      ) : (
        <Row rowRef={ref} glyph="folder" label={f.name} indent={depth} caret={open ? "open" : "closed"} dot={color} expanded={open} active={active} count={counts.get(f.id) ?? ""}
          onClick={() => { if (!open) toggle(); go("notes", { folderId: f.id, tag: null, filter: null }); }}
          onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}
          style={over ? { background: "color-mix(in srgb,var(--accent) 15%,transparent)", boxShadow: "inset 0 0 0 1.5px var(--accent)" } : undefined}
          dragProps={{
            draggable: true,
            onDragStart: (e) => { e.stopPropagation(); e.dataTransfer.setData(DRAG, JSON.stringify({ kind: "folder", id: f.id })); },
            onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); setOver(true); if (!open && !hoverT.current) hoverT.current = window.setTimeout(() => { hoverT.current = 0; setOpen(true); }, 600); }, // Lumen 03 1H: hover 600 ms expands
            onDragLeave: () => { setOver(false); clearTimeout(hoverT.current); hoverT.current = 0; },
            onDrop: (e) => { e.stopPropagation(); setOver(false); clearTimeout(hoverT.current); hoverT.current = 0; onDrop(e, f.id); },
          }}>
          <span role="button" tabIndex={-1} aria-label={t("Folder menu")} onClick={(e) => { e.stopPropagation(); setMenu(true); }} className="hidden text-muted hover:text-ink group-hover:inline">⋯</span>
        </Row>
      )}
      {menu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
          <div role="menu" className="absolute start-6 top-full z-40 w-[220px] rounded-[10px] border border-line bg-surface p-1 shadow-xl fade-in" onClick={() => setMenu(false)}>
            <MI g="lesson" l={t("New note")} k="N" run={async () => openNote((await createNote({ spaceId: f.spaceId, folderId: f.id })).id, "edit")} />
            <MI g="folder" l={t("New subfolder")} k="⇧N" run={async () => { await createFolder(f.spaceId, f.id); if (!open) toggle(); }} />
            <MI g="d-draft" l={t("Rename")} k="F2" run={() => setRename(true)} />
            <MI g="folder" l={t("Move to top level")} run={() => void moveFolder(f, f.spaceId, null)} />
            <MI g="pin" l={t("Pin")} run={() => void patch("folder", f.id, { sort: -1 - Date.now() / 1e13 })} />
            <div className="flex items-center gap-1.5 px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
              <button type="button" title={t("No color")} aria-label={t("No color")} className="size-5 rounded-full border border-line" onClick={() => void patch("folder", f.id, { color: null })} />
              {Object.keys(PRESETS).map((k) => <button type="button" key={k} aria-label={k} className="size-5 rounded-full" style={{ background: PRESETS[k], boxShadow: f.color === k ? "0 0 0 2px var(--surface), 0 0 0 3.5px var(--text)" : undefined }} onClick={() => void patch("folder", f.id, { color: k })} />)}
            </div>
            <div className="my-1 h-px bg-line" />
            <MI g="trash" l={t("Delete")} k="⌫" danger run={async () => { if (!(await askConfirm({ title: t("Delete folder “{name}”?", { name: f.name }), body: t("Its notes and subfolders move up one level. Nothing is deleted."), ok: t("Delete folder"), danger: true }))) return; await deleteFolder(f); toast(t("Deleted “{name}”. Its notes moved up one level.", { name: f.name })); }} />
          </div>
        </>
      )}
      {open && (
        <>
          <Tree folders={folders} parent={f.id} depth={depth + 1} counts={counts} onDrop={onDrop} />
          {notes.map((n) => <NoteRow key={n.id} n={n} indent={depth + 1} />)}
          {all.length > notes.length && <button type="button" data-sb-item onClick={() => setMore(true)} className={cx(rowCls, "w-full text-link")} style={{ height: "var(--sb-row)", paddingInlineStart: 6 + (depth + 1) * 16 + 18 }}>{t("+ {n} more", { n: num(all.length - notes.length) })}</button>}
        </>
      )}
    </div>
  );
}

export { openSidebarCustomise };
