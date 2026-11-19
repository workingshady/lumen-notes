// One Today plan row (design: TodayDesk.dc.html + "Today item" in Lumen 21): glyph tile, title · course, the reason,
// minutes, Start, and a ⋯ menu with Mark done / Skip today / Move to tomorrow (Undo once set aside). On phones the ⋯ is
// hidden as in the design: tapping the row opens the same menu.
import { useEffect, useMemo, useRef, useState } from "react";
import type { GlyphName } from "../lib/glyphs";
import { dayLabel, shortDate, type PlanItem } from "../lib/plan";
import { fmtDate, getLang, t, tk } from "../lib/i18n";
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
      void markPlanItem(it, "done").then(() => toast(t("Done: {title}", { title: it.title }), { label: t("Undo"), run: () => void markPlanItem({ ...it, state: "done" }, null) }));
    },
    skip: (it) => void markPlanItem(it, "skip").then(() => toast(t("Skipped for today"), { label: t("Undo"), run: () => void markPlanItem({ ...it, state: "skip" }, null) })),
    later: (it) => void markPlanItem(it, "later").then(() => toast(t("Moved to tomorrow"), { label: t("Undo"), run: () => void markPlanItem({ ...it, state: "later" }, null) })),
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

// ---- display copy of lib/plan.ts strings (the planner keeps English reasons and day labels in its log and tests)
const WD_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const UTC = { timeZone: "UTC" } as const;
/** Localize a plan.ts day label ("today", "tomorrow", "yesterday", "Fri", "Nov 30"). */
export function planDay(s: string): string {
  if (getLang() === "en") return s;
  if (s === "today") return t("today");
  if (s === "tomorrow") return t("tomorrow");
  if (s === "yesterday") return t("yesterday");
  const w = WD_EN.indexOf(s);
  if (w >= 0) return fmtDate(Date.UTC(2023, 0, 1 + w), { weekday: "long", ...UTC }); // 1 Jan 2023 was a Sunday
  const m = /^([A-Z][a-z]{2}) (\d{1,2})$/.exec(s);
  if (m && MON_EN.includes(m[1])) return fmtDate(Date.UTC(2024, MON_EN.indexOf(m[1]), Number(m[2])), { day: "numeric", month: "short", ...UTC });
  return s;
}
/** dayLabel / shortDate from lib/plan.ts in the interface language. */
export const planDayLabel = (today: string, iso: string) => planDay(dayLabel(today, iso));
export const planShortDate = (iso: string) => (getLang() === "en" ? shortDate(iso) : fmtDate(new Date(iso + "T00:00:00Z"), { weekday: "short", day: "numeric", month: "short", ...UTC }));
const FIXED_REASON: Record<string, string> = {
  "in progress": tk("in progress"), "where you left off": tk("where you left off"), "done today": tk("done today"),
  "revision due today": tk("revision due today"), "skip ahead": tk("skip ahead"), "already know it? skip ahead": tk("already know it? skip ahead"),
};
const REASONS: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^moved from (.+)$/, (m) => t("moved from {day}", { day: planDay(m[1]) })],
  [/^revision overdue (\d+) days?$/, (m) => t("revision overdue {n} day|revision overdue {n} days", { n: Number(m[1]) })],
  [/^overdue (\d+) days?$/, (m) => t("overdue {n} day|overdue {n} days", { n: Number(m[1]) })],
  [/^due (.+?) for (.+)$/, (m) => t("due {day} for {course}", { day: planDay(m[1]), course: m[2] })],
  [/^(?:already know it\? )?unlocks (\d+) concepts?$/, (m) => t("unlocks {n} concept|unlocks {n} concepts", { n: Number(m[1]) })],
  [/^(.+) target (.+?): (\d+) left$/, (m) => t("{course} target {day}: {n} left", { course: m[1], day: planDay(m[2]), n: Number(m[3]) })],
  [/^next in (.+)$/, (m) => t("next in {course}", { course: m[1] })],
  [/^(\d+)-day step$/, (m) => t("{n}-day step", { n: Number(m[1]) })],
  [/^(\d+) cards? due$/, (m) => t("{n} card due|{n} cards due", { n: Number(m[1]) })],
];
/** A planner reason ("overdue 2 days · unlocks 3 concepts") in the interface language. */
export function reasonText(r: string): string {
  if (getLang() === "en") return r;
  return r.split(" · ").map((p) => {
    if (FIXED_REASON[p]) return t(FIXED_REASON[p]);
    for (const [re, f] of REASONS) { const m = re.exec(p); if (m) return f(m); }
    return p;
  }).join(" · ");
}

/** Display copy of an item (the planner's ids, titles and reasons stay as they are in the log and the tests). */
export function itemView(it: PlanItem, kind?: string): { glyph: GlyphName; color: string; title: string; why: string } {
  const course = it.course?.color || "var(--muted)";
  const state = it.state === "skip" ? t("Skipped today") : it.state === "later" ? t("Moved to tomorrow") : null;
  if (it.kind === "cards") {
    const n = Number(/(\d+)/.exec(it.title)?.[1] ?? 0);
    return { glyph: "flashcards", color: "var(--learn)", title: t("{n} card due|{n} cards due", { n }), why: state ?? t("FSRS · ~{n} min at your pace", { n: it.minutes }) };
  }
  if (it.kind === "revision") return { glyph: "s-revise", color: "var(--warning)", title: it.title.replace(/^Revise /, ""), why: state ?? cap(reasonText(it.reason)) };
  if (it.kind === "practice") return { glyph: "c-question", color: "var(--learn)", title: t("Practice: {name}", { name: it.title.replace(/^Test out of /, "") }), why: state ?? `${t("Test out")} · ${reasonText(it.reason.replace(/^already know it\? /, ""))}` };
  const g = (it.kind === "continue" || !kind ? "lesson" : `k-${kind}`) as GlyphName;
  return { glyph: g, color: course, title: it.course ? `${it.title} · ${it.course.title}` : it.title, why: state ?? cap(reasonText(it.reason)) };
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
        {/* <bdi>: an Arabic title keeps its own direction but stays at the row's start, next to the glyph */}
        <span className={cx("truncate font-semibold", done && "line-through")}><bdi>{d.title}</bdi></span>
        <span dir="auto" className="truncate text-[12px] text-muted">{d.why}</span>
      </div>
      <span className="whitespace-nowrap text-[12px] text-muted tabular-nums">{t("{n} min", { n: it.minutes })}</span>
      {!done && !aside && (
        <button onClick={() => h.start(it)} aria-label={t("Start {title}", { title: it.title })}
          className={cx("flex h-[30px] items-center whitespace-nowrap rounded-[8px] px-3 font-semibold", current ? "bg-accent text-accent-fg hover:brightness-110" : "border border-line hover:bg-surface-2")}>{t("Start")}</button>
      )}
      {aside && <button onClick={() => h.undo(it)} aria-label={t("Undo {title}", { title: it.title })} className="flex h-[30px] items-center rounded-[8px] border border-line px-3 font-semibold hover:bg-surface-2">{t("Undo")}</button>}
      {!compact && (
        <button aria-label={t("More for {title}", { title: it.title })} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((o) => !o)}
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
    const tm = setTimeout(() => document.addEventListener("mousedown", off));
    document.addEventListener("keydown", esc);
    ref.current?.querySelector("button")?.focus();
    return () => { clearTimeout(tm); document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [onClose]);
  const run = (f: (x: PlanItem) => void) => () => { f(it); onClose(); };
  const items: [string, string, () => void][] = it.state === "todo"
    ? [[t("Mark done"), t("Mark {title} done", { title: it.title }), run(h.done)], [t("Skip today"), t("Skip {title}", { title: it.title }), run(h.skip)], [t("Move to tomorrow"), t("Move {title} to tomorrow", { title: it.title }), run(h.later)]]
    : [[t("Undo"), t("Undo {title}", { title: it.title }), run(h.undo)]];
  return (
    <div ref={ref} role="menu" className="absolute end-2 top-[calc(100%-6px)] z-30 flex w-[200px] flex-col rounded-[10px] border border-line bg-surface-2 p-1 text-[13px] shadow-[0_8px_24px_rgb(0_0_0/.25)]">
      {items.map(([l, aria, f]) => (
        <button key={l} role="menuitem" onClick={f} aria-label={aria} className="flex h-11 items-center rounded-[6px] px-2 text-start hover:bg-bg focus:bg-bg focus:outline-none sm:h-8">{l}</button>
      ))}
    </div>
  );
}
