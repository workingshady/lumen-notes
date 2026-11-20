// Plans as the calendar sees them (round 8, page 55). Adapter: until the Plans model of pages 53/54 lands
// (src/lib/plan-*.ts), every course and project space is a plan, built from its roadmap (modules = milestones, dated
// topics = plan items, done topics = progress) and its props (target / deadline date, `pace` in hours per week).
// Swap `buildPlans` for the Plans model's own list when it exists; the rest of the calendar only reads `CalPlan`.
import { roadmap, type Topic } from "./parse";
import { daysBetween } from "./calendar";

export interface CalPlan {
  id: string;
  title: string;
  color: string;
  spaceId: string | null;
  /** Roadmap / plan note id. */
  noteId: string | null;
  /** Study minutes per week the plan asks for. */
  paceMin: number;
  /** Explicit pace (space prop) vs. an even share of the daily budget. */
  paceSet: boolean;
  deadline: string | null;
  progress: number;
  total: number;
  doneCount: number;
  overdue: number;
  status: "overdue" | "risk" | "days" | "track";
  daysLeft: number | null;
  milestones: { date: string; title: string; line: number }[];
  items: { date: string; title: string; done: boolean; line: number; noteTitle: string | null }[];
  /** Next open topics in order (titles for suggested study blocks). */
  next: { title: string; noteTitle: string | null }[];
  /** Short names usable as #tags in quick add ("ml", "mlfoundations"). */
  aliases: string[];
}

/** Design palette for plans without a colour (PlanDesk C). */
export const PLAN_COLORS = ["#B48EF0", "#F2A93B", "#E8893A", "#5CC8C2", "#7AA2F7", "#6BCB8B", "#EF6B6B"];

interface SpaceLike { id: string; name: string; kind: string; color: string | null; props: Record<string, string>; roadmapId: string | null; sort: number; archived: number }
interface NoteLike { id: string; body: string; deleted?: number }

/** "6", "6h", "6 h/week", "90m" → minutes per week. */
export function parsePace(v: string | undefined): number | null {
  if (!v) return null;
  const m = /(\d+(?:\.\d+)?)\s*(h|m)?/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return Math.round(m[2]?.toLowerCase() === "m" ? n : n * 60);
}
const initials = (s: string) => s.split(/[\s\-–·:]+/).filter(Boolean).map((w) => w[0]).join("").toLowerCase();

export function buildPlans(spaces: SpaceLike[], byId: Map<string, NoteLike>, today: string, weeklyBudgetMin: number): CalPlan[] {
  const list = spaces.filter((s) => !s.archived && (s.kind === "course" || s.kind === "project" || s.props?.pace)).sort((a, b) => a.sort - b.sort);
  const explicit = list.reduce((a, s) => a + (parsePace(s.props?.pace) ?? 0), 0);
  const unset = list.filter((s) => parsePace(s.props?.pace) == null).length;
  const share = unset ? Math.max(30, Math.round(Math.max(0, weeklyBudgetMin - explicit) / unset / 15) * 15) : 0;
  return list.map((s, i) => {
    const rm = s.roadmapId ? byId.get(s.roadmapId) : undefined;
    const mods = rm && !rm.deleted ? roadmap(rm.body) : [];
    const topics: Topic[] = mods.flatMap((m) => m.topics).filter((t) => t.status !== "skipped");
    const doneCount = topics.filter((t) => t.status === "done").length;
    const overdue = topics.filter((t) => t.due && t.due < today && t.status !== "done").length;
    const deadline = /\d{4}-\d{2}-\d{2}/.exec(s.props?.deadline || s.props?.target || "")?.[0] ?? null;
    const progress = topics.length ? doneCount / topics.length : 0;
    const daysLeft = deadline ? daysBetween(today, deadline) : null;
    // At risk: what is left of the work is clearly more than what is left of the time (started plans only).
    const started = topics.length > 0 && mods.length > 0;
    const firstDue = topics.map((t) => t.due).filter((d): d is string => !!d).sort()[0];
    const span = deadline && firstDue ? Math.max(1, daysBetween(firstDue, deadline)) : null;
    const timeLeft = span && daysLeft != null ? Math.max(0, Math.min(1, daysLeft / span)) : null;
    const risk = started && timeLeft != null && 1 - progress > timeLeft + 0.25;
    const status: CalPlan["status"] = overdue ? "overdue" : risk ? "risk" : daysLeft != null && daysLeft > 30 ? "days" : "track";
    const milestones = [
      ...mods.filter((m) => m.due).map((m) => ({ date: m.due!, title: m.name.replace(/^\d+\s+/, ""), line: m.line })),
      ...(deadline ? [{ date: deadline, title: s.kind === "project" ? "Deadline" : "Target", line: -1 }] : []),
    ];
    const pace = parsePace(s.props?.pace);
    return {
      id: s.id, title: s.name, color: s.color || PLAN_COLORS[i % PLAN_COLORS.length], spaceId: s.id, noteId: rm?.id ?? null,
      paceMin: pace ?? share, paceSet: pace != null, deadline, progress, total: topics.length, doneCount, overdue, status, daysLeft, milestones,
      items: topics.filter((t) => t.due).map((t) => ({ date: t.due!, title: t.name, done: t.status === "done", line: t.line, noteTitle: t.note })),
      next: topics.filter((t) => t.status === "todo" || t.status === "learning").map((t) => ({ title: t.name, noteTitle: t.note })),
      aliases: [initials(s.name), s.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")].filter((a) => a.length > 1),
    };
  });
}
