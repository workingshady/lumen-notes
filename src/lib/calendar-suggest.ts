// Suggested study blocks (round 8, page 55: "Auto-schedule proposes dashed blocks from plan pace"; Today › Plan my day).
// Pure and deterministic: for each week in range, every plan still needs (pace − minutes already planned for it that
// week); that need is spread over the study days left in the week (rest days stay free) and each piece is placed in the
// first free slot of the study window, keeping a 15-minute gap around anything already on the calendar.
// Nothing is written: suggestions become blocks in the Calendar note only when accepted.
import { overlaps, plannedMinutes, shiftDay, weekday, weekStart, type CalItem } from "./calendar";
import type { CalPlan } from "./calendar-plans";

export interface SuggestOpts {
  days: string[];
  today: string;
  /** Minutes now (no block is suggested in the past today). */
  nowMin: number;
  studyDays: number[];
  /** Study window, minutes from midnight. */
  window?: [number, number];
  /** Max study minutes a day (the daily budget). */
  dailyMax: number;
  /** Today's review time, kept free at the start of the window. */
  reviewMin?: number;
}
const GAP = 15, STEP = 15;
const round = (n: number, s = STEP) => Math.ceil(n / s) * s;

export function suggestBlocks(plans: CalPlan[], items: CalItem[], o: SuggestOpts): CalItem[] {
  const [w0, w1] = o.window ?? [9 * 60, 21 * 60];
  const out: CalItem[] = [];
  const timed = (d: string) => [...items, ...out].filter((x) => x.date === d && x.start != null && !x.done && x.kind !== "milestone").map((x) => ({ start: x.start!, dur: Math.max(x.dur, 15) }));
  const dayLoad = (d: string) => [...items, ...out].filter((x) => x.date === d && x.planId).reduce((a, x) => a + plannedMinutes(x), 0);
  const isStudy = (d: string) => !o.studyDays.length || o.studyDays.includes(weekday(d));
  const weeks = [...new Set(o.days.map((d) => weekStart(d)))];
  for (const ws of weeks) {
    const wdays = Array.from({ length: 7 }, (_, i) => shiftDay(ws, i));
    const open = wdays.filter((d) => d >= o.today && isStudy(d) && o.days.includes(d));
    if (!open.length) continue;
    const need = new Map(plans.map((p) => [p.id, Math.max(0, p.paceMin - items.filter((x) => x.planId === p.id && x.date >= ws && x.date < shiftDay(ws, 7) && x.kind !== "suggested").reduce((a, x) => a + plannedMinutes(x), 0))]));
    const nextIdx = new Map(plans.map((p) => [p.id, 0]));
    for (const d of open) {
      const daysLeft = open.length - open.indexOf(d);
      // Plans with the most left to do first; each gets its share of the remaining days.
      const order = [...plans].filter((p) => (need.get(p.id) ?? 0) >= 15).sort((a, b) => (need.get(b.id)! - need.get(a.id)!) || a.title.localeCompare(b.title));
      for (const p of order) {
        const left = need.get(p.id)!;
        // One session of the plan's own length (sessionMinutes), longer only when the pace needs it.
        let dur = Math.min(120, round(left), round(Math.max(p.session, left / daysLeft)));
        if (dayLoad(d) + dur > o.dailyMax) dur = Math.floor((o.dailyMax - dayLoad(d)) / 15) * 15;
        if (dur < 15) break;
        const from = Math.max(w0 + (o.reviewMin && d === o.today ? o.reviewMin : 0), d === o.today ? round(o.nowMin + GAP) : w0);
        const busy = timed(d);
        let start: number | null = null;
        for (let s = from; s + dur <= w1; s += STEP) if (!busy.some((b) => overlaps({ start: s - GAP, dur: dur + 2 * GAP }, b))) { start = s; break; }
        if (start == null) continue;
        const k = nextIdx.get(p.id)!;
        const nx = p.next[k];
        nextIdx.set(p.id, k + 1);
        out.push({ id: `sug:${p.id}:${d}:${start}`, kind: "suggested", title: nx ? nx.title : p.title, sub: p.title, date: d, start, dur, cal: p.id, color: p.color, planId: p.id });
        need.set(p.id, left - dur);
      }
    }
  }
  return out;
}

/** Place given pieces of work (Plan my day) into the first free slots of one day, in order. */
export function placeBlocks(reqs: { title: string; sub?: string; dur: number; planId: string | null; color: string }[], items: CalItem[], day: string, fromMin: number, window: [number, number] = [8 * 60, 22 * 60]): CalItem[] {
  const out: CalItem[] = [];
  let from = Math.max(window[0], round(fromMin));
  for (const r of reqs) {
    const dur = Math.max(15, round(r.dur));
    const busy = [...items, ...out].filter((x) => x.date === day && x.start != null && !x.done && x.kind !== "milestone").map((x) => ({ start: x.start!, dur: Math.max(x.dur, 15) }));
    let start: number | null = null;
    for (let s = from; s + dur <= window[1]; s += STEP) if (!busy.some((b) => overlaps({ start: s - GAP / 3, dur: dur + (2 * GAP) / 3 }, b))) { start = s; break; }
    if (start == null) break;
    out.push({ id: `sug:day:${day}:${start}`, kind: "suggested", title: r.title, sub: r.sub, date: day, start, dur, cal: r.planId ?? "events", color: r.color, planId: r.planId });
    from = start + dur;
  }
  return out;
}
