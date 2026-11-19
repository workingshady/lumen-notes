// Shared drag & drop parts for roadmaps (RoadmapView) and learning paths (PathView).
// Desktop uses native HTML5 drag and drop (same as the existing stage board); every drag has a keyboard or menu
// alternative (Alt+↑/↓, "Move to…" menus on phones), and results are announced in a polite live region.
import { FileText, GripVertical, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import type { Note } from "../../shared/types";
import { useVault } from "../lib/store";
import { cx } from "../components/ui";
import { t } from "../lib/i18n";

/** MIME types: one per kind of thing being dragged. */
export const DT = { topic: "text/lumen-topic", need: "text/lumen-need", module: "text/lumen-module", note: "text/lumen-note", concept: "text/lumen-concept", stage: "text/lumen-stage", alias: "text/lumen-alias", palette: "text/lumen-palette" } as const;
export type DragKind = keyof typeof DT;

/** What is being dragged right now (dataTransfer data can't be read during dragover, only on drop). */
let current: { kind: DragKind; id: string } | null = null;
export const dragging = () => current;
export function startDrag(e: DragEvent, kind: DragKind, id: string, label?: string, ghost?: Element | null) {
  e.stopPropagation();
  current = { kind, id };
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData(DT[kind], id);
  e.dataTransfer.setData("text/plain", label ?? id);
  if (ghost) dragGhost(e, ghost);
  document.documentElement.classList.add("pdnd-active");
}

/**
 * Drag ghost (design 21 "Drag ghost"): `content` cloned onto a lifted chip (surface-2, accent border, deep shadow,
 * tilted −1.5°) used as the drag image. The chip is off-screen and only lives for the browser to snapshot it.
 */
export function dragGhost(e: DragEvent, content: Element) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;top:-300px;left:-600px;padding:14px 18px 30px;pointer-events:none";
  const g = document.createElement("div");
  g.className = "pdnd-ghost";
  g.appendChild(content.cloneNode(true));
  wrap.appendChild(g);
  document.body.appendChild(wrap);
  try { e.dataTransfer.setDragImage(wrap, 30, 32); } catch { /* not supported */ }
  setTimeout(() => wrap.remove(), 0);
}
export function endDrag() { current = null; document.documentElement.classList.remove("pdnd-active"); }
/** Kind of the drag in progress, from our state or (for drags from another view instance) the dataTransfer types. */
export function dragKind(e: DragEvent): DragKind | null {
  if (current) return current.kind;
  for (const [k, v] of Object.entries(DT)) if (e.dataTransfer.types.includes(v)) return k as DragKind;
  return null;
}
export const dropData = (e: DragEvent, kind: DragKind) => e.dataTransfer.getData(DT[kind]) || (current?.kind === kind ? current.id : "");

/** Where the pointer is over a row: before / inside / after (vertical), or before/after along x (RTL-aware) for columns. */
export function zoneY(e: DragEvent, edge = 0.3): "before" | "inside" | "after" {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const f = (e.clientY - r.top) / Math.max(1, r.height);
  return f < edge ? "before" : f > 1 - edge ? "after" : "inside";
}
export function zoneX(e: DragEvent): "before" | "after" {
  const el = e.currentTarget as HTMLElement;
  const r = el.getBoundingClientRect();
  const left = e.clientX < r.left + r.width / 2;
  return getComputedStyle(el).direction === "rtl" ? (left ? "after" : "before") : left ? "before" : "after";
}

/** Screen-reader announcement (polite live region shared by all drag & drop surfaces). */
export function announce(msg: string) {
  let el = document.getElementById("pdnd-live");
  if (!el) {
    el = document.createElement("div");
    el.id = "pdnd-live";
    el.setAttribute("aria-live", "polite");
    el.setAttribute("role", "status");
    el.className = "pdnd-sr";
    document.body.appendChild(el);
  }
  el.textContent = "";
  const node = el;
  requestAnimationFrame(() => { node.textContent = msg; });
}

/** Restore keyboard focus to an element (by data attribute) after a rewrite re-renders the list. */
export function useRefocus(dep: unknown) {
  const [want, setWant] = useState<string | null>(null);
  useEffect(() => {
    if (!want) return;
    const el = document.querySelector<HTMLElement>(want);
    if (el) { el.focus(); setWant(null); }
  }, [dep, want]);
  return setWant;
}

/** Inline confirm bar ("Merge A into B?") — keeps destructive drops reversible without a modal. */
export function useConfirm() {
  const [ask, setAsk] = useState<{ text: ReactNode; ok: string; run: () => void; danger?: boolean } | null>(null);
  useEffect(() => {
    if (!ask) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setAsk(null); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [ask]);
  const node = ask && (
    <div role="alertdialog" aria-label={t("Confirm")} className="pdnd-confirm fade-in fixed inset-x-3 bottom-4 z-[60] mx-auto flex max-w-[480px] items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3 text-[13px] shadow-xl">
      <span className="min-w-0 flex-1" dir="auto">{ask.text}</span>
      <button onClick={() => setAsk(null)} className="h-8 shrink-0 rounded-[8px] px-3 text-muted hover:bg-surface-2 hover:text-ink">{t("Cancel")}</button>
      <button autoFocus onClick={() => { const r = ask.run; setAsk(null); r(); }} className={cx("h-8 shrink-0 rounded-[8px] px-3 font-semibold", ask.danger ? "bg-bad text-white" : "bg-accent text-accent-fg")}>{ask.ok}</button>
    </div>
  );
  return [node, (text: ReactNode, ok: string, run: () => void, danger?: boolean) => setAsk({ text, ok, run, danger })] as const;
}

/**
 * Notes to drag in: every note of the space (lessons, notes…), searchable. Drag a card onto a module / stage / concept,
 * or tap "+" (phones, keyboard) to add it where `onPick` says. `used` marks notes already in the roadmap/path.
 */
export function NotesTray({ spaceId, used, onPick, onClose, title, hint, className }: { spaceId: string | null; used: Set<string>; onPick?: (n: Note) => void; onClose: () => void; title?: string; hint?: ReactNode; className?: string }) {
  const v = useVault();
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const list = useMemo(() => {
    const low = q.trim().toLowerCase();
    return v.notes
      .filter((n) => !n.deleted && n.type !== "roadmap" && n.type !== "path" && (all || !spaceId || n.spaceId === spaceId) && (!low || n.title.toLowerCase().includes(low)))
      .sort((a, b) => Number(used.has(a.title.toLowerCase())) - Number(used.has(b.title.toLowerCase())) || b.updatedAt - a.updatedAt)
      .slice(0, 200);
  }, [v.notes, q, all, spaceId, used]);
  return (
    <aside className={cx("pdnd-tray flex min-h-0 flex-col border-line bg-surface", className)} aria-label={title ?? t("Notes")}>
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{title ?? t("Notes")}</span>
        <button aria-label={t("Close notes")} onClick={onClose} className="-m-1 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink"><X size={14} /></button>
      </div>
      {hint && <p className="px-3 pb-2 text-[11.5px] leading-snug text-muted">{hint}</p>}
      <label className="mx-3 mb-2 flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-bg px-2 text-[12.5px]">
        <Search size={13} className="shrink-0 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search notes")} className="min-w-0 flex-1 bg-transparent outline-none" dir="auto" />
      </label>
      {spaceId && <label className="mx-3 mb-1.5 flex items-center gap-1.5 text-[11.5px] text-muted"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{t("All spaces")}</label>}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {list.map((n) => {
          const on = used.has(n.title.toLowerCase());
          return (
            <div key={n.id} draggable data-note={n.title} onDragStart={(e) => startDrag(e, "note", n.title)} onDragEnd={endDrag}
              className={cx("group mb-1 flex cursor-grab items-center gap-1.5 rounded-[8px] border border-line bg-bg px-2 py-1.5 text-[12.5px] active:cursor-grabbing", on && "opacity-55")}>
              <GripVertical size={12} className="shrink-0 text-muted" />
              <FileText size={13} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate" dir="auto" title={n.title}>{n.title}</span>
              {on ? <span className="text-[10.5px] text-muted">added</span>
                : onPick && <button aria-label={t("Add {title}", { title: n.title })} title={t("Add")} onClick={() => onPick(n)} className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink"><Plus size={13} /></button>}
            </div>
          );
        })}
        {!list.length && <p className="px-1 py-3 text-[12px] text-muted">{q ? t("No notes match.") : t("No notes in this space.")}</p>}
      </div>
    </aside>
  );
}
