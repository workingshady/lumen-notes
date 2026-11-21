// One hook for Today, Calendar and Tasks (round 8, page 55): plans, tasks from every note, the Calendar note's blocks
// and events, review load per day, and the calendar items built from all of them.
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { db } from "../../lib/db";
import { CAL_DAILY, CAL_EVENTS, CAL_NOTES, CAL_STUDIED, CAL_TASKS, durLabel, localISO, reviewLoad, type CalItem } from "../../lib/calendar";
import { buildPlans, type CalPlan } from "../../lib/calendar-plans";
import { CAL_NOTE_ID, parseCalNote, type CalLine } from "../../lib/calendar-store";
import { collectTasks, type CalTask } from "../../lib/calendar-tasks";
import { useDueCards, type DueItem } from "../../lib/due-cards";
import { PLAN_DEFAULTS, PLAN_LOG_ID } from "../../lib/plan";
import { useSettings } from "../../lib/settings";
import { useVault } from "../../lib/store";
import { t } from "../../lib/i18n";

export const EVENT_COLOR = "#9AA0AA";
export const REVIEW_COLOR = "#E8B34A";

// ------------------------------------------------------------------ "now" ticks once a minute
let nowMs = Date.now();
const nowSubs = new Set<() => void>();
setInterval(() => { nowMs = Date.now(); nowSubs.forEach((f) => f()); }, 30_000);
export const useNow = () => useSyncExternalStore((f) => (nowSubs.add(f), () => nowSubs.delete(f)), () => nowMs);

// ------------------------------------------------------------------ hidden calendars (per device)
const HID_KEY = "lumen.cal.hidden";
let hidden: Set<string> = (() => { try { return new Set(JSON.parse(localStorage.getItem(HID_KEY) ?? "[]") as string[]); } catch { return new Set<string>(); } })();
// note-activity layers start hidden, once per device
try { if (!localStorage.getItem("lumen.cal.layers")) { hidden.add(CAL_NOTES); hidden.add(CAL_DAILY); hidden.add(CAL_STUDIED); localStorage.setItem(HID_KEY, JSON.stringify([...hidden])); localStorage.setItem("lumen.cal.layers", "1"); } } catch { /* private mode */ }
const hidSubs = new Set<() => void>();
export function toggleCalendar(id: string) {
  hidden = new Set(hidden);
  if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
  try { localStorage.setItem(HID_KEY, JSON.stringify([...hidden])); } catch { /* private mode */ }
  hidSubs.forEach((f) => f());
}
export const useHidden = () => useSyncExternalStore((f) => (hidSubs.add(f), () => hidSubs.delete(f)), () => hidden);

export interface CalData {
  ready: boolean;
  today: string;
  plans: CalPlan[];
  planOf: (id: string | null | undefined) => CalPlan | undefined;
  tasks: CalTask[];
  lines: CalLine[];
  /** Every item, hidden calendars included (filter with `visible`). */
  items: CalItem[];
  visible: (it: CalItem) => boolean;
  reviews: Map<string, number>;
  due: DueItem[];
  paceMin: number;
  studyDays: number[];
  dailyMin: number;
  reviewedToday: number;
}

export function useCalendar(): CalData {
  const v = useVault();
  const s = useSettings();
  const now = useNow();
  const today = localISO(now);
  const studyDays = s.planStudyDays ?? PLAN_DEFAULTS.studyDays;
  const dailyMin = s.planDailyMinutes ?? PLAN_DEFAULTS.dailyMinutes;
  const plans = useMemo(() => buildPlans(v.notes, v.spaces, today), [v.notes, v.spaces, today]);
  const planMap = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);
  const calNote = v.byId.get(CAL_NOTE_ID);
  const lines = useMemo(() => (calNote && !calNote.deleted ? parseCalNote(calNote.body) : []), [calNote]);
  const tasks = useMemo(() => collectTasks(v.notes, plans, new Set([CAL_NOTE_ID, PLAN_LOG_ID])), [v.notes, plans]);
  const cards = useLiveQuery(() => db.cards.toArray(), []);
  const due = useDueCards(v.notes);
  const sod = useMemo(() => new Date(today + "T00:00:00").getTime(), [today]);
  const reviewedToday = useLiveQuery(() => db.reviews.where("at").aboveOrEqual(sod).filter((r) => !r.deleted).count(), [sod]) ?? 0;
  const reviews = useMemo(() => reviewLoad(cards ?? [], today, due?.length), [cards, today, due]);
  const sessRaw = useLiveQuery(() => db.sessions.toArray(), []);
  const hid = useHidden();
  const items = useMemo(() => {
    const out: CalItem[] = [];
    const byName = new Map(plans.map((p) => [p.title.toLowerCase(), p]));
    for (const l of lines) {
      const p = l.plan ? byName.get(l.plan.toLowerCase()) : undefined;
      out.push({ id: `cal:${l.line}:${l.due}`, kind: l.block ? "block" : "event", title: l.text, sub: p?.title, date: l.due!, start: l.time, dur: l.est ?? (l.time != null ? 60 : 0), cal: p ? p.id : CAL_EVENTS, color: p?.color ?? EVENT_COLOR, done: l.done, planId: p?.id ?? null, noteId: CAL_NOTE_ID, line: l.line });
    }
    for (const t of tasks) {
      if (!t.due) continue;
      const p = t.planId ? planMap.get(t.planId) : undefined;
      out.push({ id: `task:${t.key}`, kind: "task", title: t.text, sub: p?.title ?? t.noteTitle, date: t.due, start: t.time, dur: t.est ?? (t.time != null ? 30 : 0), cal: CAL_TASKS, color: p?.color ?? "var(--text)", done: t.done, planId: t.planId, noteId: t.noteId, line: t.line, late: !t.done && t.due < today });
    }
    for (const p of plans) {
      for (const m of p.milestones) out.push({ id: `ms:${p.id}:${m.date}:${m.title}`, kind: "milestone", title: m.title, sub: p.title, date: m.date, start: null, dur: 0, cal: p.id, color: p.color, planId: p.id, noteId: m.noteId, line: m.line >= 0 ? m.line : undefined });
      for (const it of p.items) out.push({ id: `pi:${p.id}:${it.item.key}`, kind: "item", title: it.title, sub: p.title, date: it.date, start: null, dur: 0, cal: p.id, color: p.color, done: it.done, planId: p.id, noteId: it.noteId, line: it.line, late: !it.done && it.date < today, planItem: it.item });
    }
    // note-activity layers: notes created, daily notes, minutes studied
    const since = Date.now() - 400 * 864e5;
    for (const n of v.notes) {
      if (n.deleted || n.id === CAL_NOTE_ID || n.id === PLAN_LOG_ID) continue;
      if (n.type === "journal") {
        const d = /d{4}-d{2}-d{2}/.exec(n.title)?.[0];
        if (d) out.push({ id: `daily:${n.id}`, kind: "note", title: n.title, sub: undefined, date: d, start: null, dur: 0, cal: CAL_DAILY, color: "#6BCB8B", noteId: n.id });
      } else if (n.createdAt >= since) out.push({ id: `new:${n.id}`, kind: "note", title: n.title, sub: undefined, date: localISO(n.createdAt), start: null, dur: 0, cal: CAL_NOTES, color: "#7AA2F7", noteId: n.id });
    }
    const studied = new Map<string, number>();
    for (const x of sessRaw ?? []) if (!x.deleted) { const d = localISO(x.at); studied.set(d, (studied.get(d) ?? 0) + x.minutes); }
    for (const [d, m] of studied) if (m > 0) out.push({ id: `studied:${d}`, kind: "note", title: t("Studied · {d}", { d: durLabel(Math.round(m)) }), date: d, start: null, dur: 0, cal: CAL_STUDIED, color: "#B48EF0" });
    return out;
  }, [lines, tasks, plans, planMap, today, v.notes, sessRaw]);
  const visible = useMemo(() => (it: CalItem) => !hid.has(it.cal) && !(it.kind === "task" && hid.has(CAL_TASKS)), [hid]);
  const paceMin = plans.reduce((a, p) => a + p.paceMin, 0);
  return {
    ready: v.ready && !!cards && !!due, today, plans, planOf: (id) => (id ? planMap.get(id) : undefined), tasks, lines, items, visible,
    reviews, due: due ?? [], paceMin, studyDays, dailyMin, reviewedToday,
  };
}

/** Reminders: while the app is open, a task with a time and `[remind:: N m]` toasts (and notifies) N minutes before. */
export function useReminders(tasks: CalTask[], today: string, notify: (text: string) => void) {
  const now = useNow();
  const [fired] = useState(() => new Set<string>());
  useEffect(() => {
    const d = new Date(now);
    const min = d.getHours() * 60 + d.getMinutes();
    for (const t of tasks) {
      if (t.done || t.remind == null || t.time == null || t.due !== today) continue;
      const at = t.time - t.remind, k = `${t.key}:${t.due}:${at}`;
      if (min >= at && min < t.time && !fired.has(k)) { fired.add(k); notify(t.text); }
    }
  }, [now, tasks, today, fired, notify]);
}
