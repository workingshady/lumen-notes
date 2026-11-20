// Sidebar best practice (Lumen 30b): per-device sidebar preferences (order, hidden → More, sections, counts,
// row height, width, folds), the Customise sheet and the keyboard map. Sidebar.tsx renders from these.
// Stored in localStorage "lumen.sidebar" (device-only, like the width).
import { useEffect, useState, useSyncExternalStore } from "react";
import { Glyph } from "./Glyph";
import { cx } from "./ui";
import { t, tk } from "../lib/i18n";
import { setSettings, useSettings, type Settings } from "../lib/settings";

export type ItemKey = "home" | "today" | "inbox" | "review" | "tasks" | "ask" | "daily" | "calendar" | "graph" | "canvas" | "blog" | "trash";
export type SectionKey = "favourites" | "paths" | "folders" | "smart" | "tags" | "recent";
export interface SbPrefs {
  width: number;
  /** Items in the top block, in order. Everything else in ITEMS is in More. */
  top: ItemKey[];
  more: ItemKey[];
  sections: { id: SectionKey; on: boolean }[];
  counts: "none" | "due" | "all";
  rowH: 28 | 32 | 40;
  moreOpen: boolean;
  /** Folded sections (true = closed). */
  folded: Partial<Record<SectionKey, boolean>>;
  /** Space switcher: pinned spaces (⌘1–9 while the switcher is open). */
  pinnedSpaces?: string[];
}
export const ITEMS: Record<ItemKey, { glyph: string; label: string; sc?: string }> = {
  home: { glyph: "home", label: tk("Home") }, today: { glyph: "date", label: tk("Today") }, inbox: { glyph: "inbox", label: tk("Inbox") },
  review: { glyph: "flashcards", label: tk("Review") }, tasks: { glyph: "task", label: tk("Tasks") }, ask: { glyph: "assistant", label: tk("Ask"), sc: "J" },
  daily: { glyph: "journal", label: tk("Daily note") }, calendar: { glyph: "v-calendar", label: tk("Calendar") }, graph: { glyph: "graph", label: tk("Graph"), sc: "G" },
  canvas: { glyph: "canvas", label: tk("Canvases") }, blog: { glyph: "post", label: tk("Blog") }, trash: { glyph: "trash", label: tk("Trash") },
};
export const SECTIONS: Record<SectionKey, { glyph: string; label: string }> = {
  favourites: { glyph: "pin", label: tk("Favourites") }, paths: { glyph: "path", label: tk("Learning paths") }, folders: { glyph: "folder", label: tk("Folders") },
  smart: { glyph: "smart-folder", label: tk("Smart folders") }, tags: { glyph: "tag", label: tk("Tags") }, recent: { glyph: "clock", label: tk("Recent") },
};
export const WIDTH = { min: 200, max: 360, def: 256 };
const DEF: SbPrefs = {
  width: WIDTH.def,
  top: ["home", "today", "inbox", "review", "tasks", "ask"],
  more: ["daily", "calendar", "graph", "canvas", "blog", "trash"],
  sections: [{ id: "favourites", on: true }, { id: "paths", on: true }, { id: "folders", on: true }, { id: "smart", on: true }, { id: "tags", on: true }, { id: "recent", on: false }],
  counts: "due", rowH: 32, moreOpen: false, folded: { tags: true, recent: true },
};
const KEY = "lumen.sidebar";
function norm(p: Partial<SbPrefs>): SbPrefs {
  const all = Object.keys(ITEMS) as ItemKey[];
  const top = (p.top ?? DEF.top).filter((k, i, a) => all.includes(k) && a.indexOf(k) === i);
  if (!top.includes("home")) top.unshift("home"); // Home is always on top
  const more = [...(p.more ?? DEF.more).filter((k, i, a) => all.includes(k) && !top.includes(k) && a.indexOf(k) === i), ...all.filter((k) => !top.includes(k) && !(p.more ?? DEF.more).includes(k))];
  const secs = (p.sections ?? DEF.sections).filter((s) => SECTIONS[s.id]);
  for (const d of DEF.sections) if (!secs.some((s) => s.id === d.id)) secs.push(d);
  const width = Math.min(WIDTH.max, Math.max(WIDTH.min, Number(p.width) || WIDTH.def));
  return { ...DEF, ...p, width, top, more, sections: secs, folded: { ...DEF.folded, ...(p.folded ?? {}) } };
}
let cur: SbPrefs = (() => { try { return norm(JSON.parse(localStorage.getItem(KEY) ?? "{}")); } catch { return DEF; } })();
const subs = new Set<() => void>();
export const getSb = () => cur;
export const useSb = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => cur);
export function setSb(p: Partial<SbPrefs>) {
  cur = norm({ ...cur, ...p });
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* private mode */ }
  subs.forEach((f) => f());
}
export const resetSb = () => setSb({ ...DEF, width: cur.width });

// ------------------------------------------------------------------ overlays (customise sheet, keyboard map)
type Overlay = "custom" | "keys" | null;
let overlay: Overlay = null;
const osubs = new Set<() => void>();
const setOverlay = (o: Overlay) => { overlay = o; osubs.forEach((f) => f()); };
export const openSidebarCustomise = () => setOverlay("custom");
export const openKeyboardMap = () => setOverlay("keys");
const useOverlay = () => useSyncExternalStore((f) => (osubs.add(f), () => osubs.delete(f)), () => overlay);

/** Mount once (Sidebar renders it). */
export function SidebarOverlays() {
  const o = useOverlay();
  useEffect(() => {
    if (!o) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOverlay(null); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [o]);
  useEffect(() => {
    // "?" opens the keyboard map (outside text fields)
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !el.closest("input,textarea,select,[contenteditable=true],.cm-editor")) { e.preventDefault(); setOverlay(overlay === "keys" ? null : "keys"); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);
  if (o === "custom") return <Customise onClose={() => setOverlay(null)} />;
  if (o === "keys") return <KeyMap onClose={() => setOverlay(null)} />;
  return null;
}

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
const KEYS: [string, string[]][] = [
  [tk("Open search"), [MOD, "K"]], [tk("New note"), [MOD, "N"]], [tk("Go to Home · Today · Inbox · Review · Tasks"), [MOD, "1–5"]],
  [tk("Collapse / expand sidebar"), [MOD, "\\"]], [tk("Move in the tree"), ["↑", "↓"]], [tk("Open / close a folder"), ["←", "→"]],
  [tk("Open the focused item"), ["↵"]], [tk("Rename"), ["F2"]], [tk("Move item up / down"), ["Alt", "↑ ↓"]], [tk("Jump to sidebar from note"), ["F6"]],
  [tk("Move between notes in the list"), ["↑", "↓"]], [tk("Move the focused / selected notes to Trash"), ["Del"]], [tk("Select all notes in the list"), [MOD, "A"]],
  [tk("Add or remove a note from the selection"), [MOD, "click"]], [tk("Select a range of notes"), ["Shift", "click"]], [tk("Clear the selection"), ["Esc"]],
  [tk("Move the open note to Trash"), ["Shift", "Del"]],
];
function KeyMap({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[55]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={t("Sidebar keys")} className="absolute start-6 top-6 flex w-[380px] max-w-[calc(100vw-32px)] flex-col gap-1.5 rounded-[14px] border border-line bg-surface-2 p-4 text-[13px] shadow-[0_14px_34px_rgba(0,0,0,.35)] fade-in">
        <div className="flex items-center pb-1"><b className="flex-1 text-[14px] font-[650]">{t("Sidebar keys")}</b><button aria-label={t("Close")} onClick={onClose} className="text-muted hover:text-ink"><Glyph name="x" size={14} /></button></div>
        {KEYS.map(([l, ks]) => (
          <div key={l} className="flex min-h-[26px] items-center gap-2.5">
            <span className="flex-1">{t(l)}</span>
            <span className="flex gap-1" dir="ltr">{ks.map((k) => <kbd key={k} className="flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] border border-line bg-bg px-1.5 font-mono text-[11px] font-medium">{k}</kbd>)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tog({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} className="relative h-[18px] w-[30px] shrink-0 rounded-[9px]" style={{ background: on ? "var(--accent)" : "var(--border)" }}>
      <span className="absolute top-[3px] size-3 rounded-full" style={{ insetInlineStart: on ? 15 : 3, background: on ? "var(--accent-fg)" : "var(--muted)" }} />
    </button>
  );
}
function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <span className="flex gap-0.5 rounded-[7px] border border-line bg-bg p-[3px] text-[12px]" role="radiogroup">
      {options.map(([v, l]) => <button key={String(v)} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={cx("flex h-[22px] items-center rounded-[5px] px-2", value === v ? "bg-surface-2 font-semibold" : "text-muted")}>{l}</button>)}
    </span>
  );
}

/** Customise sidebar (30b-H/I/N): reorder by drag or Alt+↑/↓, hide (→ More), sections on/off, counts, row height. */
function Customise({ onClose }: { onClose: () => void }) {
  const p = useSb();
  const sbm = ((useSettings() as { sidebarMode?: "open" | "hover" | "click" }).sidebarMode) ?? "open";
  const [drag, setDrag] = useState<{ list: "top" | "more" | "sec"; i: number } | null>(null);
  const moveIn = (list: "top" | "more" | "sec", from: number, to: number) => {
    if (list === "sec") { const l = [...p.sections]; if (to < 0 || to >= l.length) return; const [x] = l.splice(from, 1); l.splice(to, 0, x); setSb({ sections: l }); return; }
    const l = [...p[list]]; if (to < 0 || to >= l.length || (list === "top" && (from === 0 || to === 0))) return;
    const [x] = l.splice(from, 1); l.splice(to, 0, x); setSb({ [list]: l });
  };
  const toggleItem = (k: ItemKey) => {
    if (k === "home") return;
    if (p.top.includes(k)) setSb({ top: p.top.filter((x) => x !== k), more: [k, ...p.more] });
    else setSb({ top: [...p.top, k], more: p.more.filter((x) => x !== k) });
  };
  const row = (list: "top" | "more" | "sec", i: number, glyph: string, label: string, mode: string, on: boolean, toggle: () => void, fixed = false) => {
    const dragging = drag?.list === list && drag.i === i;
    return (
      <div key={list + label} draggable={!fixed} tabIndex={0} aria-label={label}
        onDragStart={() => setDrag({ list, i })} onDragEnd={() => setDrag(null)}
        onDragOver={(e) => { e.preventDefault(); if (drag && drag.list === list && drag.i !== i) { moveIn(list, drag.i, i); setDrag({ list, i }); } }}
        onKeyDown={(e) => { if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); moveIn(list, i, i + (e.key === "ArrowUp" ? -1 : 1)); } if (e.key === " " && e.target === e.currentTarget) { e.preventDefault(); toggle(); } }}
        className={cx("flex h-10 shrink-0 items-center gap-2.5 rounded-[9px] border px-2.5 focus-visible:outline-2 focus-visible:outline-accent", dragging ? "border-accent bg-surface-2" : "border-line bg-bg", !on && "opacity-60")}>
        <Glyph name="grip" size={14} color="var(--muted)" className={fixed ? "opacity-30" : "cursor-grab"} />
        <Glyph name={glyph} size={16} />
        <span className="flex-1">{label}</span>
        <span className="text-[12px] text-muted">{mode}</span>
        <Tog on={on} onClick={toggle} label={label} />
      </div>
    );
  };
  const head = (h: string) => <div className="px-1.5 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{h}</div>;
  return (
    <div className="fixed inset-0 z-[55] bg-[rgba(5,6,8,.5)] fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={t("Customise sidebar")} className="absolute inset-x-0 bottom-0 top-auto flex max-h-[88dvh] flex-col overflow-hidden rounded-t-[14px] border border-line bg-surface text-[13px] text-ink md:bottom-10 md:left-1/2 md:top-10 md:max-h-none md:w-[420px] md:-translate-x-1/2 md:rounded-[14px]">
        <div className="flex items-center gap-2.5 px-[18px] pb-2.5 pt-4"><span className="flex-1 text-[16px] font-[650]">{t("Customise sidebar")}</span><button onClick={resetSb} className="text-link">{t("Reset")}</button><button aria-label={t("Close")} onClick={onClose} className="text-[16px] text-muted hover:text-ink"><Glyph name="x" size={15} /></button></div>
        <span className="px-[18px] pb-2.5 leading-[18px] text-muted">{t("Drag to reorder (or Alt+↑/↓). Hidden items move into More.")}</span>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-2">
          {head(t("Top"))}
          {p.top.map((k, i) => row("top", i, ITEMS[k].glyph, t(ITEMS[k].label), k === "home" ? t("Always") : k === "review" ? t("Badge") : "", true, () => toggleItem(k), k === "home"))}
          {head(t("In More"))}
          {p.more.map((k, i) => row("more", i, ITEMS[k].glyph, t(ITEMS[k].label), "", false, () => toggleItem(k)))}
          {head(t("Sections"))}
          {p.sections.map((s, i) => row("sec", i, SECTIONS[s.id].glyph, t(SECTIONS[s.id].label), s.id === "tags" && p.folded.tags ? t("Collapsed") : "", s.on, () => setSb({ sections: p.sections.map((x) => (x.id === s.id ? { ...x, on: !x.on } : x)) })))}
        </div>
        <div className="flex flex-col gap-2 border-t border-line px-[18px] py-3">
          <div className="flex items-center gap-2.5"><span className="flex-1">{t("Sidebar")}</span><Seg value={sbm} onChange={(v) => setSettings({ sidebarMode: v } as Partial<Settings>)} options={[["open", t("Always open")], ["hover", t("Expand on hover")], ["click", t("Expand on click")]]} /></div>
          <div className="flex items-center gap-2.5"><span className="flex-1">{t("Show counts")}</span><Seg value={p.counts} onChange={(v) => setSb({ counts: v })} options={[["none", t("None")], ["due", t("Due only")], ["all", t("All")]]} /></div>
          <div className="flex items-center gap-2.5"><span className="flex-1">{t("Row height")}</span><Seg value={p.rowH} onChange={(v) => setSb({ rowH: v })} options={[[32, "32"], [28, t("28 compact")], [40, t("40 touch")]]} /></div>
        </div>
      </div>
    </div>
  );
}
