// Plans as the calendar sees them (round 8, page 55). Built from the real plan model of pages 53/54 (plan-model.ts +
// plan-sources.ts: `allPlans`), so Today, Calendar and Tasks agree with the Plans page. `CalPlan` is a flat view of a
// `Plan` (ISO dates, minutes) plus the model itself (`model`) for writes.
import type { Note, Space } from "../../shared/types";
import { bucketItems, dayOf, isDone, isoOf, itemsInRange, milestonesInRange, overdueItems, planProgress, projectFromToday, sessionMinutes, todayDay, type Plan, type PlanItem } from "./plan-model";
import { allPlans } from "./plan-sources";

export interface CalPlan {
  id: string;
  title: string;
  color: string;
  spaceId: string | null;
  /** Plan / roadmap note id (where the plan lives), when it is a note. */
  noteId: string | null;
  /** Study minutes per week the plan asks for. */
  paceMin: number;
  paceSet: boolean;
  /** Minutes of one study session (auto-scheduled blocks). */
  session: number;
  deadline: string | null;
  progress: number;
  total: number;
  doneCount: number;
  overdue: number;
  status: "overdue" | "risk" | "days" | "track";
  daysLeft: number | null;
  milestones: { date: string; title: string; line: number; noteId: string }[];
  items: { date: string; title: string; done: boolean; line: number; noteId: string; item: PlanItem }[];
  /** Next open items in order (titles for suggested study blocks). */
  next: { title: string; noteTitle: string | null }[];
  /** Short names usable as #tags in quick add ("ml", "mlfoundations"). */
  aliases: string[];
  model: Plan;
}

/** Design palette for plans without a colour (PlanDesk C). */
export const PLAN_COLORS = ["#B48EF0", "#F2A93B", "#E8893A", "#5CC8C2", "#7AA2F7", "#6BCB8B", "#EF6B6B"];

const initials = (s: string) => s.split(/[\s\-–·:]+/).filter(Boolean).map((w) => w[0]).join("").toLowerCase();

export function buildPlans(notes: Note[], spaces: Space[], todayIso?: string): CalPlan[] {
  const today = todayIso ? dayOf(todayIso) : todayDay();
  const models = allPlans(notes, spaces);
  const span = models.length ? { lo: today - 400, hi: today + 800 } : { lo: today, hi: today };
  const overdue = new Map<string, number>();
  for (const o of overdueItems(models, today)) overdue.set(o.plan.id, (overdue.get(o.plan.id) ?? 0) + 1);
  const mile = milestonesInRange(models, span.lo, span.hi);
  const its = itemsInRange(models, span.lo, span.hi);
  return models.map((p, i) => {
    const homeNote = p.items[0] ? notes.find((n) => n.id === p.items[0].noteId) : undefined;
    const spaceId = p.home.kind === "space" ? p.home.id : (spaces.find((s) => !s.deleted && s.roadmapId === p.id) ?? spaces.find((s) => !s.deleted && s.id === homeNote?.spaceId && (s.kind === "course" || s.kind === "project")))?.id ?? null;
    const { done, total } = planProgress(p);
    const od = overdue.get(p.id) ?? 0;
    const b = bucketItems(p.items, today);
    const daysLeft = p.deadline != null ? p.deadline - today : null;
    const slip = projectFromToday(p, today).slip;
    const status: CalPlan["status"] = od ? "overdue" : slip > 3 ? "risk" : daysLeft != null && daysLeft > 30 ? "days" : "track";
    const live: PlanItem[] = [...b.overdue, ...b.now, ...b.next, ...b.later];
    return {
      id: p.id, title: p.title, color: p.color || PLAN_COLORS[i % PLAN_COLORS.length], spaceId, noteId: p.home.kind === "note" ? p.home.id : p.items[0]?.noteId ?? null,
      paceMin: Math.round((p.pace || 4) * 60), paceSet: true, session: sessionMinutes(p),
      deadline: p.deadline != null ? isoOf(p.deadline) : null, progress: total ? done / total : 0, total, doneCount: done, overdue: od, status, daysLeft,
      milestones: mile.filter((x) => x.plan.id === p.id).map((x) => ({ date: isoOf(x.milestone.day), title: x.milestone.name, line: x.milestone.line, noteId: x.milestone.noteId })),
      items: its.filter((x) => x.plan.id === p.id && x.item.src !== "module").map((x) => ({ date: isoOf(x.item.end), title: x.item.name, done: isDone(x.item), line: x.item.line, noteId: x.item.noteId, item: x.item })),
      next: live.map((x) => ({ title: x.name, noteTitle: x.link })),
      aliases: [initials(p.title), p.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")].filter((a) => a.length > 1),
      model: p,
    };
  });
}
