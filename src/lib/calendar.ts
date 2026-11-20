// Calendar model (round 8, page 55): one list of dated items built from every source (study blocks and events in the
// synced Calendar note, dated tasks from any note, plan milestones and dated plan items) plus the review load per day.
// Pure: the caller passes "today" and the raw data, so the same input always gives the same calendar.
// Reviews are counts per day, never events (design 55 note). Times are minutes from local midnight.
import { daysBetween, shiftDay, weekday, weekStart } from "./plan";

export { daysBetween, shiftDay, weekday, weekStart };

/** Which kind of thing sits on the calendar. `suggested` blocks are not stored until accepted. */
export type CalKind = "block" | "event" | "task" | "milestone" | "item" | "suggested";

export interface CalItem {
  id: string;
  kind: CalKind;
  title: string;
  /** Second line (source, plan, length). */
  sub?: string;
  date: string;
  /** Minutes from midnight; null = all-day. */
  start: number | null;
  /** Minutes (0 for all-day items without an estimate). */
  dur: number;
  /** Calendar id: a plan id, or "tasks" / "events" / "reviews". */
  cal: string;
  color: string;
  done?: boolean;
  planId?: string | null;
  /** Where it is stored (note + 0-based line), when it is a Markdown line. */
  noteId?: string;
  line?: number;
  late?: boolean;
}

/** Fixed calendar ids for the non-plan calendars. */
export const CAL_TASKS = "tasks", CAL_EVENTS = "events", CAL_REVIEWS = "reviews";

// ------------------------------------------------------------------ times
export const hm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;
/** "10:30", "9", "4pm", "4:15 pm" → minutes; null when not a time. */
export function parseHM(s: string): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  if (m[3]) { const pm = m[3].toLowerCase() === "pm"; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}
/** "90m", "1h", "1h30m", "1.5h" → minutes. */
export function parseDur(s: string): number | null {
  const m = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+)m(?:in)?)?$/i.exec(s.trim());
  if (!m || (!m[1] && !m[2])) return null;
  return Math.round(Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0));
}
/** "90 min", "1 h 30", "5 h 15" (design wording). */
export const durLabel = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? " " + String(min % 60).padStart(2, "0") : ""}`);

// ------------------------------------------------------------------ grids
/** The month grid: whole weeks covering the month (35 cells, or 42 when the month spans six weeks). `firstDay` 1 = Monday. */
export function monthGrid(year: number, month: number, firstDay = 1): string[] {
  const first = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const lead = (weekday(first) - firstDay + 7) % 7;
  const start = shiftDay(first, -lead);
  const daysIn = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = lead + daysIn > 35 ? 42 : 35;
  return Array.from({ length: cells }, (_, i) => shiftDay(start, i));
}
/** Seven days starting on the week's first day. */
export const weekDays = (iso: string, firstDay = 1) => { const s = shiftDay(iso, -((weekday(iso) - firstDay + 7) % 7)); return Array.from({ length: 7 }, (_, i) => shiftDay(s, i)); };

// ------------------------------------------------------------------ review load
export interface CardLike { due: number; suspended?: boolean | number; deleted?: number; reps?: number }
const localISO = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
/**
 * Cards due per day from each card's scheduled due time. Anything already due (overdue) counts today; `dueToday`
 * (the Review queue's own count, which applies the new-cards-a-day limit) replaces today's figure when given.
 */
export function reviewLoad(cards: CardLike[], today: string, dueToday?: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of cards) {
    if (c.deleted || c.suspended || !c.reps) continue; // new cards are not scheduled yet
    const d = localISO(c.due);
    const k = d < today ? today : d;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  if (dueToday != null) out.set(today, dueToday);
  return out;
}
/** Seconds per card for review time estimates (same rule as the Today planner). */
export const reviewMinutes = (n: number, secondsPerCard = 10) => Math.max(n ? 1 : 0, Math.round((n * secondsPerCard) / 60));

// ------------------------------------------------------------------ by day
export function byDay(items: CalItem[]): Map<string, CalItem[]> {
  const m = new Map<string, CalItem[]>();
  for (const it of items) { const a = m.get(it.date); if (a) a.push(it); else m.set(it.date, [it]); }
  for (const a of m.values()) a.sort(orderItems);
  return m;
}
/** Milestones first, then all-day items, then by start time. */
export function orderItems(a: CalItem, b: CalItem) {
  const r = (x: CalItem) => (x.kind === "milestone" ? 0 : x.start == null ? 1 : 2);
  return r(a) - r(b) || (a.start ?? 0) - (b.start ?? 0) || a.title.localeCompare(b.title);
}
/** Planned minutes of an item (blocks, events and timed / estimated tasks). Milestones and plain dated items count 0. */
export const plannedMinutes = (it: CalItem) => (it.kind === "milestone" || it.kind === "item" || it.done ? 0 : it.dur);

// ------------------------------------------------------------------ busy weeks
export interface WeekLoad { week: string; planned: number; pace: number; over: boolean }
/**
 * Planned study minutes per week against the pace (sum of every plan's minutes per week). A week is busy when it is more
 * than 10% over pace. Events that aren't study (no plan) don't count against the pace.
 */
export function weekLoads(items: CalItem[], paceMin: number, from: string, weeks = 8): WeekLoad[] {
  const w0 = weekStart(from);
  const out: WeekLoad[] = [];
  for (let i = 0; i < weeks; i++) {
    const ws = shiftDay(w0, i * 7), we = shiftDay(ws, 7);
    const planned = items.filter((x) => x.date >= ws && x.date < we && x.planId && x.kind !== "suggested").reduce((a, x) => a + plannedMinutes(x), 0);
    out.push({ week: ws, planned, pace: paceMin, over: paceMin > 0 && planned > paceMin * 1.1 });
  }
  return out;
}
/** First busy week from today on, if any. */
export const busyWeek = (loads: WeekLoad[]) => loads.find((w) => w.over) ?? null;

/**
 * Rebalance a busy week: move the latest movable blocks (study blocks, not done, from today on) to the lightest study
 * days of the next week, same time of day, until the week is back at pace. Returns the moves; nothing is written.
 */
export function rebalance(items: CalItem[], load: WeekLoad, studyDays: number[], today: string): { id: string; noteId: string; line: number; from: string; to: string }[] {
  const ws = load.week, we = shiftDay(ws, 7), next = shiftDay(ws, 7);
  const movable = items.filter((x) => x.kind === "block" && !x.done && x.date >= ws && x.date < we && x.date >= today && x.noteId != null && x.line != null)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.start ?? 0) - (a.start ?? 0));
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(next, i)).filter((d) => !studyDays.length || studyDays.includes(weekday(d)));
  const load2 = new Map(days.map((d) => [d, items.filter((x) => x.date === d).reduce((a, x) => a + plannedMinutes(x), 0)]));
  let over = load.planned - load.pace;
  const moves: { id: string; noteId: string; line: number; from: string; to: string }[] = [];
  for (const b of movable) {
    if (over <= 0 || !days.length) break;
    const to = [...load2.entries()].sort((a, c) => a[1] - c[1] || a[0].localeCompare(c[0]))[0][0];
    moves.push({ id: b.id, noteId: b.noteId!, line: b.line!, from: b.date, to });
    load2.set(to, (load2.get(to) ?? 0) + b.dur);
    over -= b.dur;
  }
  return moves;
}

/** Overlap test for timed items on the same day. */
export const overlaps = (a: { start: number; dur: number }, b: { start: number; dur: number }) => a.start < b.start + b.dur && b.start < a.start + a.dur;

export { localISO };
