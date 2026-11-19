// Shared pieces of the course roadmap (design round 4, "Lumen 15 Roadmaps" + "RoadmapDesk"):
// status glyphs, the inline confirm bar, module fold state (persisted per roadmap), the notes tray / builder tray,
// the "link a note" picker and the roadmap's local styles (insert line, ghost, refused drop, unlock moment).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Note } from "../../shared/types";
import type { Module, Topic, TopicStatus } from "../lib/parse";
import type { GlyphName } from "../lib/glyphs";
import { useVault } from "../lib/store";
import { Glyph } from "../components/Glyph";
import { cx } from "../components/ui";
import { endDrag, startDrag } from "./dnd-parts";

export const STATUS_LABEL: Record<TopicStatus, string> = { todo: "Todo", learning: "Learning", done: "Done", skipped: "Skipped" };
export const finished = (t?: Topic) => t?.status === "done" || t?.status === "skipped";

/** Status glyph + colour (design: s-done green, s-learning blue, s-todo / s-locked / s-skipped muted). */
export function topicGlyph(t: Pick<Topic, "status" | "locked">): [GlyphName, string] {
  if (t.status === "done") return ["s-done", "var(--success)"];
  if (t.status === "learning") return ["s-learning", "var(--info)"];
  if (t.status === "skipped") return ["s-skipped", "var(--muted)"];
  if (t.locked) return ["s-locked", "var(--muted)"];
  return ["s-todo", "var(--muted)"];
}
export function StatusGlyph({ t, size = 16, className }: { t: Pick<Topic, "status" | "locked">; size?: number; className?: string }) {
  const [g, c] = topicGlyph(t);
  return <Glyph name={g} size={size} color={c} className={className} />;
}

/** ⋮⋮ grip (design: muted, 60% opacity, 11px, tight letter-spacing). */
export const Grip = ({ className }: { className?: string }) => <span aria-hidden className={cx("select-none text-[11px] tracking-[-1px] text-muted opacity-60", className)}>⋮⋮</span>;

/** Inline confirm bar (design 21): red-tinted, one line, Cancel + red Delete. Esc cancels. */
export function InlineConfirm({ text, ok = "Delete", onCancel, onOk, className }: { text: ReactNode; ok?: string; onCancel: () => void; onOk: () => void; className?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onCancel]);
  return (
    <div role="alertdialog" aria-label="Confirm" className={cx("pdnd-confirm fade-in flex items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-[13px]", className)}
      style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)" }}>
      <span className="min-w-0 flex-1 leading-[18px]" dir="auto">{text}</span>
      <button onClick={onCancel} className="shrink-0 text-muted hover:text-ink">Cancel</button>
      <button autoFocus onClick={onOk} className="flex h-7 shrink-0 items-center rounded-[8px] px-2.5 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)]/40" style={{ background: "var(--danger)", color: "#1A0B0B" }}>{ok}</button>
    </div>
  );
}

/** Floating inline confirm (used by the skill tree's Delete key): same bar, pinned to the bottom of the view. */
export function useInlineConfirm() {
  const [ask, setAsk] = useState<{ text: ReactNode; ok: string; run: () => void } | null>(null);
  const node = ask && (
    <div className="fixed inset-x-3 bottom-4 z-[60] mx-auto max-w-[480px] rounded-[10px] bg-surface-2 shadow-xl">
      <InlineConfirm text={ask.text} ok={ask.ok} onCancel={() => setAsk(null)} onOk={() => { const r = ask.run; setAsk(null); r(); }} />
    </div>
  );
  return [node, (text: ReactNode, ok: string, run: () => void) => setAsk({ text, ok, run })] as const;
}

// ------------------------------------------------------------------ module fold state (persisted)
const foldKey = (id: string) => `lumen.rm.fold.${id}`;
function readFold(id: string): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(foldKey(id)) || "{}"); } catch { return {}; }
}
/**
 * Which modules are open, by module name, remembered per roadmap (localStorage `lumen.rm.fold.<noteId>`). Without a
 * saved choice, finished modules and modules more than one past the current one start folded (design 15A).
 * Shared by the outline and the skill tree (a folded module is a summary card there).
 */
export function useModuleFold(noteId: string, mods: Module[], cur?: number) {
  const [saved, setSaved] = useState(() => readFold(noteId));
  useEffect(() => setSaved(readFold(noteId)), [noteId]);
  useEffect(() => {
    const f = (e: StorageEvent | CustomEvent) => { if (!("key" in e) || e.key === foldKey(noteId)) setSaved(readFold(noteId)); };
    addEventListener("storage", f as EventListener);
    addEventListener("lumen-rm-fold", f as EventListener);
    return () => { removeEventListener("storage", f as EventListener); removeEventListener("lumen-rm-fold", f as EventListener); };
  }, [noteId]);
  const curMod = mods.findIndex((m) => m.topics.some((t) => t.line === cur));
  const byDefault = (m: Module, i: number) => !(m.topics.length && (m.topics.every(finished) || (curMod >= 0 && i > curMod + 1)));
  const isOpen = (i: number) => { const m = mods[i]; if (!m) return true; const k = m.name.toLowerCase(); return k in saved ? saved[k] : byDefault(m, i); };
  const write = (next: Record<string, boolean>) => {
    setSaved(next);
    try { localStorage.setItem(foldKey(noteId), JSON.stringify(next)); } catch { /* private mode */ }
    dispatchEvent(new CustomEvent("lumen-rm-fold"));
  };
  const toggle = (i: number) => { const m = mods[i]; if (m) write({ ...saved, [m.name.toLowerCase()]: !isOpen(i) }); };
  const setAll = (open: boolean) => write(Object.fromEntries(mods.map((m) => [m.name.toLowerCase(), open])));
  const allOpen = mods.every((_, i) => isOpen(i));
  return { isOpen, toggle, setAll, allOpen };
}

// ------------------------------------------------------------------ notes tray
const noteGlyph = (n: Note): GlyphName => (n.type === "lesson" ? "lesson" : n.type === "pdf" ? "pdf" : n.type === "whiteboard" ? "whiteboard" : n.type === "canvas" ? "canvas" : n.type === "slides" ? "slides" : n.type === "flashcards" ? "flashcards" : "note");
const noteKind = (n: Note) => (n.type === "pdf" ? "pdf" : n.type === "whiteboard" ? "board" : n.type === "canvas" ? "canvas" : n.type === "slides" ? "slides" : "new");

/** Notes of the space that can become topics (not roadmaps/paths), newest first; used ones last. */
export function useTrayNotes(spaceId: string | null, used: Set<string>, q: string) {
  const v = useVault();
  return useMemo(() => {
    const low = q.trim().toLowerCase();
    return v.notes
      .filter((n) => !n.deleted && n.type !== "roadmap" && n.type !== "path" && (!spaceId || n.spaceId === spaceId) && (!low || n.title.toLowerCase().includes(low)))
      .sort((a, b) => Number(used.has(a.title.toLowerCase())) - Number(used.has(b.title.toLowerCase())) || b.updatedAt - a.updatedAt)
      .slice(0, 200);
  }, [v.notes, q, spaceId, used]);
}

/**
 * Notes tray (design 15A) and the builder's "Notes in this space" panel (15D). Drag a row onto a module or between
 * topics; "+" (hover) adds it to the last module. The builder variant ends with "Add all N as topics".
 */
export function RoadmapTray({ spaceId, used, onPick, onAddAll, builder }: { spaceId: string | null; used: Set<string>; onPick: (n: Note) => void; onAddAll?: (ns: Note[]) => void; builder?: boolean }) {
  const [q, setQ] = useState("");
  const list = useTrayNotes(spaceId, used, q);
  const fresh = list.filter((n) => !used.has(n.title.toLowerCase()));
  return (
    <aside className={cx("pdnd-tray flex min-h-0 shrink-0 flex-col border-l border-line bg-surface text-[13px]", builder ? "w-[300px]" : "w-[260px]")} aria-label={builder ? "Notes in this space" : "Notes tray"}>
      <div className={cx("flex flex-col gap-2 px-3.5", builder ? "py-3.5" : "pb-2 pt-3.5")}>
        <span className="font-semibold">{builder ? `Notes in this space · ${fresh.length}` : "Notes tray"}</span>
        {!builder && <span className="text-[12px] leading-[17px] text-muted">Drag a note in to make it a topic linked to that note.</span>}
        <label className="flex h-8 items-center gap-2 rounded-[6px] border border-line bg-bg px-2.5 text-muted">
          <Glyph name="query" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter notes" aria-label="Filter notes" dir="auto" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted" />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {list.map((n) => {
          const on = used.has(n.title.toLowerCase());
          return (
            <div key={n.id} draggable={!on} data-note={n.title}
              onDragStart={(e) => startDrag(e, "note", n.title, n.title, (e.currentTarget as HTMLElement).querySelector("[data-ghost]"))} onDragEnd={endDrag}
              className={cx("group mx-2 flex items-center gap-2 rounded-[8px] px-2 hover:bg-surface-2", builder ? "h-[38px]" : "h-9", on ? "cursor-default opacity-55" : "cursor-grab active:cursor-grabbing")}>
              <Grip />
              <span data-ghost className="flex min-w-0 flex-1 items-center gap-2"><Glyph name={noteGlyph(n)} size={16} color="var(--muted)" /><span className="min-w-0 flex-1 truncate" dir="auto" title={n.title}>{n.title}</span></span>
              {!builder && <span className="text-[11px] text-muted group-hover:hidden [@media(hover:none)]:hidden">{on ? "added" : noteKind(n)}</span>}
              {!on && <button aria-label={`Add ${n.title}`} title="Add as topic" onClick={() => onPick(n)} className="hidden size-6 shrink-0 items-center justify-center rounded-[6px] text-muted hover:bg-surface hover:text-ink group-hover:flex [@media(hover:none)]:flex"><Glyph name="plus" size={14} /></button>}
            </div>
          );
        })}
        {!list.length && <p className="px-4 py-3 text-[12px] text-muted">No notes{q ? " match" : " in this space"}.</p>}
      </div>
      {builder && onAddAll && (
        <button disabled={!fresh.length} onClick={() => onAddAll(fresh)} className="mx-3.5 mb-3.5 mt-auto flex h-[34px] shrink-0 items-center justify-center rounded-[10px] bg-accent font-semibold text-accent-fg hover:brightness-110 disabled:opacity-50">
          Add all {fresh.length} as topics
        </button>
      )}
    </aside>
  );
}

/** "+ Link note" picker: notes of the space (filterable) + "Create lesson note". */
export function LinkNotePicker({ spaceId, topic, onLink, onCreate, onClose }: { spaceId: string | null; topic: Topic; onLink: (n: Note) => void; onCreate: () => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const list = useTrayNotes(spaceId, new Set(), q).slice(0, 8);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const id = setTimeout(() => addEventListener("mousedown", down));
    addEventListener("keydown", key);
    return () => { clearTimeout(id); removeEventListener("mousedown", down); removeEventListener("keydown", key); };
  }, [onClose]);
  return (
    <div ref={ref} role="dialog" aria-label={`Link a note to ${topic.name}`} onClick={(e) => e.stopPropagation()}
      className="fade-in absolute right-0 top-full z-30 mt-1 flex w-[260px] flex-col gap-0.5 rounded-[10px] border border-line bg-surface-2 p-1 text-[13px] shadow-xl">
      <label className="mb-1 flex h-8 items-center gap-2 rounded-[6px] border border-line bg-bg px-2.5 text-muted">
        <Glyph name="query" size={14} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a note" className="min-w-0 flex-1 bg-transparent text-ink outline-none" dir="auto" />
      </label>
      {list.map((n) => (
        <button key={n.id} onClick={() => onLink(n)} className="flex h-[30px] items-center gap-2 rounded-[6px] px-2 text-left hover:bg-bg">
          <Glyph name={noteGlyph(n)} size={14} color="var(--muted)" /><span className="min-w-0 flex-1 truncate" dir="auto">{n.title}</span>
        </button>
      ))}
      <button onClick={onCreate} className="flex h-[30px] items-center gap-2 rounded-[6px] border-t border-line px-2 text-left text-muted hover:bg-bg hover:text-ink">
        <Glyph name="plus" size={14} />Create lesson note “{topic.name}”
      </button>
    </div>
  );
}

/** Roadmap-local styles: insert line with its ring dot, drag ghost chip, unlock moment, tree bits. */
export const RM_STYLE = `
.pdnd-ghost { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; border-radius: 8px; background: var(--surface-2); border: 1px solid var(--accent); box-shadow: 0 14px 32px rgba(0,0,0,.45); transform: rotate(-1.5deg); font: 500 13px Inter, system-ui, sans-serif; color: var(--text); white-space: nowrap; }
.pdnd-ghost > * { display: inline-flex; align-items: center; gap: 8px; }
.rm-row { position: relative; }
.rm-ins-before::before, .rm-ins-after::after { content: ""; position: absolute; left: 30px; right: 8px; height: 2px; border-radius: 1px; background: var(--accent); pointer-events: none; z-index: 5; }
.rm-ins-before::before { top: -1px; } .rm-ins-after::after { bottom: -1px; }
.rm-ins-before > .rm-dot, .rm-ins-after > .rm-dot { display: block; }
.rm-dot { display: none; position: absolute; left: 25px; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--accent); box-sizing: border-box; background: var(--surface); z-index: 6; pointer-events: none; }
.rm-ins-before > .rm-dot { top: -5px; } .rm-ins-after > .rm-dot { bottom: -5px; }
.rm-grip { opacity: .6; cursor: grab; }
@keyframes rm-unlock { 0% { opacity: .55; box-shadow: none; transform: none; } 40% { opacity: 1; box-shadow: 0 0 0 4px color-mix(in srgb, var(--info) 18%, transparent); transform: translateY(-2px); } 100% { opacity: 1; box-shadow: 0 0 0 0 transparent; transform: none; } }
.rm-unlock { animation: rm-unlock .6s cubic-bezier(.2,.8,.2,1) both; }
@keyframes rm-draw { from { stroke-dashoffset: 1200; } to { stroke-dashoffset: 0; } }
.react-flow__edge.rm-draw .react-flow__edge-path { stroke-dasharray: 1200; animation: rm-draw .24s ease-out both; }
@media (prefers-reduced-motion: reduce) { .rm-unlock, .react-flow__edge.rm-draw .react-flow__edge-path { animation: none; stroke-dasharray: none; } }
.lm-flow .react-flow__handle { min-width: 0; min-height: 0; }
.lm-flow .react-flow__edge-path { transition: stroke .12s, opacity .12s; }
.lm-flow .react-flow__node { cursor: pointer; }
.lm-flow .lm-src { opacity: 0; transition: opacity .12s; }
.lm-flow .react-flow__node:hover .lm-src, .lm-flow .lm-src.connecting { opacity: 1; }
.lm-flow .react-flow__edge.pdnd-edge:hover .react-flow__edge-path { stroke: var(--danger) !important; }
.lm-flow .react-flow__minimap { background: var(--surface); }
.lm-flow .react-flow { background: transparent; }
[data-dark="0"] .lm-sheet { box-shadow: 0 1px 2px rgb(0 0 0 / .06), 0 4px 16px rgb(0 0 0 / .08); }
`;
