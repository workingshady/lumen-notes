import type { Card } from "../../shared/types";

export type Grade = 0 | 1 | 2 | 3; // again, hard, good, easy
const DAY = 86_400_000;

export function newCard(id: string, noteId: string): Card {
  return { id, noteId, ease: 2.5, interval: 0, due: 0, reps: 0, lapses: 0, updatedAt: 0, deleted: 0 };
}

/** SM-2 variant with learning steps for new/lapsed cards (minutes) and Anki-like hard/easy modifiers. */
export function schedule(c: Card, g: Grade, now = Date.now()): Card {
  let { ease, interval, reps, lapses } = c;
  let due: number;
  if (g === 0) {
    lapses += reps > 0 ? 1 : 0;
    reps = 0;
    interval = 0;
    ease = Math.max(1.3, ease - 0.2);
    due = now + 60_000; // 1 min
  } else if (reps === 0 && g < 3) {
    reps = 1;
    interval = g === 1 ? 0 : 1;
    due = g === 1 ? now + 6 * 60_000 : now + DAY;
  } else {
    reps += 1;
    if (g === 1) { ease = Math.max(1.3, ease - 0.15); interval = Math.max(1, Math.round(Math.max(interval, 1) * 1.2)); }
    else if (g === 2) interval = reps <= 2 ? (interval < 1 ? 1 : 3) : Math.round(Math.max(interval, 1) * ease);
    else { ease += 0.15; interval = reps <= 1 ? 4 : Math.round(Math.max(interval, 1) * ease * 1.3); }
    due = now + interval * DAY;
  }
  return { ...c, ease, interval, reps, lapses, due };
}

export function previewIntervals(c: Card): string[] {
  const now = Date.now();
  return ([0, 1, 2, 3] as Grade[]).map((g) => fmt(schedule(c, g, now).due - now));
}
function fmt(ms: number) {
  const m = ms / 60_000;
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  const d = m / 1440;
  return d < 30 ? `${Math.round(d)}d` : d < 365 ? `${Math.round(d / 30)}mo` : `${(d / 365).toFixed(1)}y`;
}
