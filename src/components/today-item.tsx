// One Today plan row (design: TodayDesk.dc.html + "Today item" in Lumen 21): glyph tile, title · course, the reason,
// minutes, Start, and a ⋯ menu with Mark done / Skip today / Move to tomorrow (Undo once set aside). On phones the ⋯ is
// hidden as in the design: tapping the row opens the same menu.
import { useEffect, useMemo, useRef, useState } from "react";
import type { GlyphName } from "../lib/glyphs";
import type { PlanItem } from "../lib/plan";
import { toast } from "../lib/store";
import { Glyph } from "./Glyph";
import { markPlanItem, startPlanItem } from "./today-data";
import { cx } from "./ui";

/** Shared Start / Done / Skip / Move to tomorrow / Undo handlers. Concept items (revision, practice) open a sheet via `onConcept`. */
export function usePlanHandlers(onConcept: (it: PlanItem, mode: "start" | "done") => void): ItemHandlers {
  return useMemo(() => ({
    start: (it) => { if (it.target?.type === "concept") onConcept(it, "start"); else void startPlanItem(it); },
    done: (it) => {
      if (it.kind === "revision") return onConcept(it, "done");
      void markPlanItem(it, "done").then(() => toast(`Done: ${it.title}`, { label: "Undo", run: () => void markPlanItem({ ...it, state: "done" }, null) }));
    },
    skip: (it) => void markPlanItem(it, "skip").then(() => toast("Skipped for today", { label: "Undo", run: () => void markPlanItem({ ...it, state: "skip" }, null) })),
    later: (it) => void markPlanItem(it, "later").then(() => toast("Moved to tomorrow", { label: "Undo", run: () => void markPlanItem({ ...it, state: "later" }, null) })),
    undo: (it) => void markPlanItem(it, null),
  }), [onConcept]);
}

export interface ItemHandlers {
  start: (it: PlanItem) => void;
  done: (it: PlanItem) => void;
  skip: (it: PlanItem) => void;
  later: (it: PlanItem) => void;
  undo: (it: PlanItem) => void;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Display copy of an item (the planner's ids, titles and reasons stay as they are in the log and the tests). */
export function itemView(it: PlanItem, kind?: string): { glyph: GlyphName; color: string; title: string; why: string } {
  const course = it.course?.color || "var(--muted)";
  const state = it.state === "skip" ? "Skipped today" : it.state === "later" ? "Moved to tomorrow" : null;
  if (it.kind === "cards") {
    const n = /(\d+)/.exec(it.title)?.[1] ?? "";
    return { glyph: "flashcards", color: "var(--learn)", title: `${n} card${n === "1" ? "" : "s"} due`, why: state ?? `FSRS · ~${it.minutes} min at your pace` };
  }
  if (it.kind === "revision") return { glyph: "s-revise", color: "var(--warning)", title: it.title.replace(/^Revise /, ""), why: state ?? cap(it.reason) };
  if (it.kind === "practice") return { glyph: "c-question", color: "var(--learn)", title: `Practice: ${it.title.replace(/^Test out of /, "")}`, why: state ?? `Test out · ${it.reason.replace(/^already know it\? /, "")}` };
  const g = (it.kind === "continue" || !kind ? "lesson" : `k-${kind}`) as GlyphName;
  return { glyph: g, color: course, title: it.course ? `${it.title} · ${it.course.title}` : it.title, why: state ?? cap(it.reason) };
}

export function PlanRow({ it, h, compact, current, kind }: { it: PlanItem; h: ItemHandlers; compact?: boolean; current?: boolean; kind?: string }) {
  const done = it.state === "done";
  const aside = it.state === "skip" || it.state === "later";
  const d = itemView(it, kind);
  const [menu, setMenu] = useState(false);
  return (
    <div
      className={cx("today-row relative flex items-center gap-3 rounded-[12px] px-3 py-2.5 sm:px-3.5 sm:py-3", (done || aside) && "[&>*:not([role=menu])]:opacity-60")}
      style={{ background: current ? "color-mix(in srgb, var(--accent) 7%, var(--surface))" : "var(--surface)", border: current ? "1.5px solid var(--accent)" : "1px solid var(--border)" }}
      data-kind={it.kind} data-state={it.state}
      onClick={(e) => { if (!compact && window.matchMedia("(max-width: 639px)").matches && !(e.target as HTMLElement).closest("button,[role=menu]")) setMenu(true); }}
    >
      <Glyph name={d.glyph} size={18} color={d.color} tile={d.color} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span dir="auto" className={cx("truncate font-semibold", done && "line-through")}>{d.title}</span>
        <span dir="auto" className="truncate text-[12px] text-muted">{d.why}</span>
      </div>
      <span className="whitespace-nowrap text-[12px] text-muted tabular-nums">{it.minutes} min</span>
      {!done && !aside && (
        <button onClick={() => h.start(it)} aria-label={`Start ${it.title}`}
          className={cx("flex h-[30px] items-center whitespace-nowrap rounded-[8px] px-3 font-semibold", current ? "bg-accent text-accent-fg hover:brightness-110" : "border border-line hover:bg-surface-2")}>Start</button>
      )}
      {aside && <button onClick={() => h.undo(it)} aria-label={`Undo ${it.title}`} className="flex h-[30px] items-center rounded-[8px] border border-line px-3 font-semibold hover:bg-surface-2">Undo</button>}
      {!compact && (
        <button aria-label={`More for ${it.title}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((o) => !o)}
          className="hidden w-5 items-center justify-center text-muted hover:text-ink sm:flex"><Glyph name="more" size={16} /></button>
      )}
      {menu && <RowMenu it={it} h={h} onClose={() => setMenu(false)} />}
    </div>
  );
}

function RowMenu({ it, h, onClose }: { it: PlanItem; h: ItemHandlers; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const t = setTimeout(() => document.addEventListener("mousedown", off));
    document.addEventListener("keydown", esc);
    ref.current?.querySelector("button")?.focus();
    return () => { clearTimeout(t); document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [onClose]);
  const run = (f: (x: PlanItem) => void) => () => { f(it); onClose(); };
  const items: [string, string, () => void][] = it.state === "todo"
    ? [["Mark done", `Mark ${it.title} done`, run(h.done)], ["Skip today", `Skip ${it.title}`, run(h.skip)], ["Move to tomorrow", `Move ${it.title} to tomorrow`, run(h.later)]]
    : [["Undo", `Undo ${it.title}`, run(h.undo)]];
  return (
    <div ref={ref} role="menu" className="absolute right-2 top-[calc(100%-6px)] z-30 flex w-[200px] flex-col rounded-[10px] border border-line bg-surface-2 p-1 text-[13px] shadow-[0_8px_24px_rgb(0_0_0/.25)]">
      {items.map(([l, aria, f]) => (
        <button key={l} role="menuitem" onClick={f} aria-label={aria} className="flex h-11 items-center rounded-[6px] px-2 text-left hover:bg-bg focus:bg-bg focus:outline-none sm:h-8">{l}</button>
      ))}
    </div>
  );
}
