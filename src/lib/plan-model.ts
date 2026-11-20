// Plans (design round 8: Lumen 53 Course timeline, Lumen 54 Plans and timelines). One model for a course, a project,
// exam prep or a thesis, with four views (Timeline · Lanes · Board · Agenda) over the same items.
// (lib/plan.ts is the separate rule-based Today planner.)
//
// Pure scheduling maths, no React / DOM:
//   - dates are "epoch days" (UTC day numbers) so week maths is integer maths;
//   - three ways to make dates: fixed (from the Markdown), by pace (h / week, forward) or back from a deadline;
//   - tracks are resources: each track works through its items one after another, with a share of the weekly pace
//     equal to its share of the work (so tracks finish together); `needs` are finish-to-start dependencies;
//   - critical path = CPM forward/backward pass over needs + track order (resource conflicts as artificial precedence);
//   - buckets Overdue / Now / Next / Later / Done and weekly load against the pace.
// Sources (roadmap, plan note, project tasks) are turned into a Plan in lib/plan-sources.ts.

export const DAYMS = 86_400_000;
export type Day = number;
/** "2026-11-20" → epoch day. */
export const dayOf = (iso: string): Day => Math.round(Date.parse(iso.slice(0, 10) + "T00:00:00Z") / DAYMS);
/** epoch day → "2026-11-20". */
export const isoOf = (d: Day) => new Date(d * DAYMS).toISOString().slice(0, 10);
/** Local today as an epoch day (respects the demo clock). */
export function todayDay(now = Date.now()): Day {
  const d = new Date(now);
  return dayOf(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
}
/** Date object (UTC) of an epoch day, for month / year maths. */
export const dateOf = (d: Day) => new Date(d * DAYMS);
/** Monday on or before `d`. */
export const mondayOf = (d: Day) => d - ((dateOf(d).getUTCDay() + 6) % 7);
/** First day of the month containing `d`, plus `m` months. */
export const monthStart = (d: Day, m = 0) => { const D = dateOf(d); return Math.round(Date.UTC(D.getUTCFullYear(), D.getUTCMonth() + m, 1) / DAYMS); };

export type ItemStatus = "todo" | "doing" | "review" | "done" | "skipped" | "backlog";
export type Bucket = "overdue" | "now" | "next" | "later" | "done";
export type ScheduleMode = "fixed" | "pace" | "deadline";
export type PlanKind = "course" | "project" | "exam" | "thesis" | "plan";
export type PlanViewKind = "gantt" | "lanes" | "board" | "agenda";
export type GroupKey = "group" | "track" | "owner" | "status" | "tag" | "source" | "none";
export type ColourKey = "group" | "status" | "owner" | "tag";
export type SortKey = "start" | "due" | "manual" | "priority";
export type ShowKey = "milestones" | "deps" | "done" | "weekends" | "empty";

export interface PlanItem {
  /** Stable id: `<noteId>:<line>` (or `<noteId>:m<module>` for a course module). */
  key: string;
  name: string;
  /** Index into plan.groups. */
  group: number;
  track: string;
  owner: string | null;
  status: ItemStatus;
  /** Work in hours (estimate, or topics × hours per topic). */
  hours: number;
  /** Things inside the item ("14 topics", "6 lessons"); 1 = a single item. */
  count: number;
  /** How many of `count` are done (course modules). */
  doneCount?: number;
  /** Names of items this one needs (finish-to-start). */
  needs: string[];
  /** Dates written in the Markdown (fixed schedule); null = let the scheduler place it. */
  fixedStart: Day | null;
  fixedEnd: Day | null;
  /** Scheduled span (inclusive). Filled by schedulePlan(). */
  start: Day;
  end: Day;
  /** Where it lives: note + line, for writes. */
  noteId: string;
  line: number;
  priority: 1 | 2 | 3 | null;
  tags: string[];
  /** Linked lesson / doc note title. */
  link: string | null;
  /** Source of the line: plan note, roadmap topic, roadmap module (aggregate), project card. */
  src: "plan" | "topic" | "module" | "card";
  /** Source note title (Group by › Source note). */
  srcTitle: string;
}
export interface PlanGroup { name: string; color: string; line: number }
export interface Milestone { name: string; day: Day; line: number; noteId: string; done: boolean }
export interface PlanPrefs {
  view: PlanViewKind; group: GroupKey; colour: ColourKey; sort: SortKey; show: ShowKey[];
  zoom: "week" | "month" | "quarter";
}
export const DEFAULT_PREFS: PlanPrefs = { view: "gantt", group: "group", colour: "group", sort: "start", show: ["milestones", "deps", "done"], zoom: "month" };
export interface PlanMeta { glyph: string; label: string; warn?: boolean }
export interface Plan {
  /** Note id (plan note / roadmap) or `space:<id>` (project tasks). */
  id: string;
  kind: PlanKind;
  title: string;
  sub: string;
  icon: string;
  color: string;
  /** "topics", "lessons", "tasks", "sessions". */
  unit: string;
  /** Label of the natural grouping ("Module", "Level", "Phase", "Domain", "Chapter"). */
  groupBy: string;
  groups: PlanGroup[];
  items: PlanItem[];
  milestones: Milestone[];
  /** Track order (lanes). */
  tracks: string[];
  /** Lanes are people. */
  owners: boolean;
  /** Owner id → display name ("sara" → "Sara"). */
  people: Record<string, string>;
  start: Day;
  pace: number;
  deadline: Day | null;
  mode: ScheduleMode;
  meta: PlanMeta[];
  prefs: PlanPrefs;
  /** Where prefs / schedule are written: a note's front matter or a space's props. */
  home: { kind: "note"; id: string } | { kind: "space"; id: string };
  /** Continue button: the next thing to do. */
  next: PlanItem | null;
}

export const PLAN_PALETTE = ["#7AA2F7", "#5CC8C2", "#6BCB8B", "#E3B341", "#E8893A", "#F25C9A", "#B48EF0", "#EF6B6B"];
export const PERSON_COLORS = ["#F2A93B", "#5CC8C2", "#B48EF0", "#6BCB8B", "#7AA2F7", "#E8893A"];
export const isDone = (i: Pick<PlanItem, "status">) => i.status === "done" || i.status === "skipped";
export const isActive = (i: Pick<PlanItem, "status">) => i.status === "doing" || i.status === "review";

// ------------------------------------------------------------------ ordering
/** Items in dependency order (Kahn, stable by source order). Cycles fall back to source order. */
export function topoOrder(items: PlanItem[]): PlanItem[] {
  const byName = new Map(items.map((i) => [i.name.toLowerCase(), i]));
  const indeg = new Map<PlanItem, number>(), out = new Map<PlanItem, PlanItem[]>();
  for (const i of items) { indeg.set(i, 0); out.set(i, []); }
  for (const i of items) for (const n of i.needs) { const p = byName.get(n.toLowerCase()); if (p && p !== i) { indeg.set(i, indeg.get(i)! + 1); out.get(p)!.push(i); } }
  const pos = new Map(items.map((i, k) => [i, k]));
  const ready = items.filter((i) => indeg.get(i) === 0), done: PlanItem[] = [], seen = new Set<PlanItem>();
  while (ready.length) {
    ready.sort((a, b) => pos.get(a)! - pos.get(b)!);
    const i = ready.shift()!;
    done.push(i); seen.add(i);
    for (const s of out.get(i)!) { indeg.set(s, indeg.get(s)! - 1); if (indeg.get(s) === 0) ready.push(s); }
  }
  if (done.length < items.length) for (const i of items) if (!seen.has(i)) done.push(i);
  return done;
}
const predsOf = (i: PlanItem, byName: Map<string, PlanItem>) => i.needs.map((n) => byName.get(n.toLowerCase())).filter((p): p is PlanItem => !!p && p !== i);

/** Weekly hours each track gets: its share of the work × pace, at least 15% of the pace. */
export function trackCapacity(items: PlanItem[], pace: number): Map<string, number> {
  const work = new Map<string, number>();
  for (const i of items) work.set(i.track, (work.get(i.track) ?? 0) + Math.max(0.25, i.hours));
  const total = [...work.values()].reduce((a, b) => a + b, 0) || 1;
  return new Map([...work].map(([t, h]) => [t, Math.max(pace * 0.15, (pace * h) / total)]));
}
/** Days an item takes on its track at that track's weekly capacity (min 1). */
export const daysFor = (hours: number, cap: number) => Math.max(1, Math.ceil((Math.max(0.25, hours) / Math.max(0.1, cap)) * 7));

// ------------------------------------------------------------------ scheduling
/**
 * Fill every item's start/end.
 * - fixed: Markdown dates win; an item with only a due date runs back from it by its estimate; undated items chain
 *   after their track / needs from the plan start.
 * - pace: forward from the plan start, each track serial at its capacity, needs finish-to-start.
 * - deadline: backwards from the deadline (the deadline day itself stays free), successors first.
 */
export function schedulePlan(plan: Plan): Plan {
  const items = plan.items;
  const cap = trackCapacity(items, plan.pace || 4);
  const byName = new Map(items.map((i) => [i.name.toLowerCase(), i]));
  const order = topoOrder(items);
  if (plan.mode === "deadline" && plan.deadline != null) {
    const latest = new Map<string, Day>();
    const succ = new Map<PlanItem, PlanItem[]>(items.map((i) => [i, []]));
    for (const i of items) for (const p of predsOf(i, byName)) succ.get(p)!.push(i);
    for (const i of [...order].reverse()) {
      const d = daysFor(i.hours, cap.get(i.track)!);
      const lf = Math.min(latest.get(i.track) ?? plan.deadline - 1, ...succ.get(i)!.map((s) => s.start - 1));
      i.end = lf; i.start = lf - d + 1;
      latest.set(i.track, i.start - 1);
    }
  } else {
    const free = new Map<string, Day>();
    for (const i of order) {
      const d = daysFor(i.hours, cap.get(i.track)!);
      const es = Math.max(free.get(i.track) ?? plan.start, ...predsOf(i, byName).map((p) => p.end + 1));
      if (plan.mode === "fixed" && (i.fixedStart != null || i.fixedEnd != null)) {
        i.start = i.fixedStart ?? i.fixedEnd! - d + 1;
        i.end = i.fixedEnd ?? i.fixedStart! + d - 1;
        if (i.end < i.start) i.end = i.start;
      } else { i.start = es; i.end = es + d - 1; }
      free.set(i.track, i.end + 1);
    }
  }
  return plan;
}

/** Plan-wide span (items + milestones + deadline). */
export function planSpan(plan: Plan): { lo: Day; hi: Day } {
  const ds = [...plan.items.flatMap((i) => [i.start, i.end]), ...plan.milestones.map((m) => m.day), ...(plan.deadline != null ? [plan.deadline] : [])];
  if (!ds.length) return { lo: plan.start, hi: plan.start + 28 };
  return { lo: Math.min(plan.start, ...ds), hi: Math.max(...ds) };
}

// ------------------------------------------------------------------ critical path (CPM)
export interface CpmResult { es: Map<string, Day>; lf: Map<string, Day>; slack: Map<string, number>; critical: Set<string>; finish: Day }
/**
 * Critical path over not-done items: precedence = `needs` (finish-to-start) + the order of items on the same track
 * (a shared resource as an artificial precedence). Forward pass gives early start/finish, backward pass from the
 * project finish gives late finish; slack = LF − EF; slack 0 = critical.
 */
export function criticalPath(plan: Plan): CpmResult {
  const live = plan.items.filter((i) => !isDone(i));
  const byName = new Map(live.map((i) => [i.name.toLowerCase(), i]));
  const preds = new Map<PlanItem, PlanItem[]>(live.map((i) => [i, predsOf(i, byName)]));
  const lastOnTrack = new Map<string, PlanItem>();
  for (const i of [...live].sort((a, b) => a.start - b.start || a.line - b.line)) { const p = lastOnTrack.get(i.track); if (p) preds.get(i)!.push(p); lastOnTrack.set(i.track, i); }
  const dur = (i: PlanItem) => Math.max(1, i.end - i.start + 1);
  const order = topoOrder(live).sort((a, b) => a.start - b.start);
  const es = new Map<string, Day>(), ef = new Map<string, Day>();
  for (const i of order) { const s = Math.max(i.start, ...preds.get(i)!.map((p) => (ef.get(p.key) ?? p.end) + 1)); es.set(i.key, s); ef.set(i.key, s + dur(i) - 1); }
  const finish = Math.max(plan.start, ...ef.values());
  const succ = new Map<PlanItem, PlanItem[]>(live.map((i) => [i, []]));
  for (const [i, ps] of preds) for (const p of ps) succ.get(p)!.push(i);
  const lf = new Map<string, Day>(), slack = new Map<string, number>(), critical = new Set<string>();
  for (const i of [...order].reverse()) {
    const l = Math.min(finish, ...succ.get(i)!.map((s) => (lf.get(s.key) ?? finish) - dur(s)));
    lf.set(i.key, l);
    const sl = l - ef.get(i.key)!;
    slack.set(i.key, sl);
    if (sl <= 0) critical.add(i.key);
  }
  return { es, lf, slack, critical, finish };
}

// ------------------------------------------------------------------ buckets
/** Overdue = end passed and not done; Now = in progress or running today; Next = starts within `nextDays`; Later = the rest. */
export function bucketOf(i: PlanItem, today: Day, nextDays = 14): Bucket {
  if (isDone(i)) return "done";
  if (i.end < today) return "overdue";
  if (isActive(i) || (i.start <= today && today <= i.end)) return "now";
  if (i.start <= today + nextDays) return "next";
  return "later";
}
export const BUCKETS: Bucket[] = ["overdue", "now", "next", "later", "done"];
export function bucketItems(items: PlanItem[], today: Day, nextDays = 14): Record<Bucket, PlanItem[]> {
  const out: Record<Bucket, PlanItem[]> = { overdue: [], now: [], next: [], later: [], done: [] };
  for (const i of items) out[bucketOf(i, today, nextDays)].push(i);
  for (const b of BUCKETS) out[b].sort((a, c) => (b === "done" ? a.end - c.end : a.start - c.start || a.line - c.line));
  return out;
}
/** Days late (0 when not overdue). */
export const daysLate = (i: PlanItem, today: Day) => (isDone(i) || i.end >= today ? 0 : today - i.end);

// ------------------------------------------------------------------ load
export interface WeekLoad { week: Day; hours: number; over: boolean; items: PlanItem[] }
/** Planned hours per week (an item's hours spread evenly over its days), `weeks` weeks from the Monday of `from`. */
export function weeklyLoad(plan: Plan, from: Day, weeks: number): WeekLoad[] {
  const w0 = mondayOf(from), out: WeekLoad[] = [];
  for (let k = 0; k < weeks; k++) {
    const a = w0 + k * 7, b = a + 6;
    let h = 0; const its: PlanItem[] = [];
    for (const i of plan.items) {
      if (isDone(i) || i.end < a || i.start > b) continue;
      const days = i.end - i.start + 1, ov = Math.min(b, i.end) - Math.max(a, i.start) + 1;
      h += (i.hours * ov) / days; its.push(i);
    }
    out.push({ week: a, hours: Math.round(h * 10) / 10, over: h > (plan.pace || 4) * 1.1, items: its });
  }
  return out;
}

// ------------------------------------------------------------------ behind schedule
/**
 * Projected end if the remaining work restarts today at the current pace (each track serial from today, needs kept).
 * Returns per-item projected end and the slip in days vs the plan (positive = late).
 */
export function projectFromToday(plan: Plan, today: Day): { end: Map<string, Day>; slip: number } {
  const live = plan.items.filter((i) => !isDone(i));
  if (!live.length) return { end: new Map(), slip: 0 };
  const cap = trackCapacity(live, plan.pace || 4);
  const byName = new Map(live.map((i) => [i.name.toLowerCase(), i]));
  const free = new Map<string, Day>(), ends = new Map<string, Day>();
  for (const i of topoOrder(live)) {
    const preds = predsOf(i, byName).map((p) => (ends.get(p.key) ?? p.end) + 1);
    const s = Math.max(free.get(i.track) ?? today, Math.min(i.start, today) === i.start ? today : i.start, ...preds);
    const e = s + daysFor(i.hours * (i.doneCount && i.count ? 1 - i.doneCount / i.count : 1), cap.get(i.track)!) - 1;
    ends.set(i.key, e); free.set(i.track, e + 1);
  }
  const planned = Math.max(...live.map((i) => i.end)), projected = Math.max(planned, ...ends.values());
  return { end: ends, slip: projected - planned };
}

/** Progress: done items / all items (topics inside course modules), skipped excluded. */
export function planProgress(plan: Plan) {
  let done = 0, total = 0;
  for (const i of plan.items) {
    if (i.status === "skipped") continue;
    if (i.src === "module") { total += i.count; done += i.doneCount ?? 0; } else { total += 1; done += i.status === "done" ? 1 : 0; }
  }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

// ------------------------------------------------------------------ grouping / colour / sort (Organize)
export interface ViewGroup { key: string; name: string; color: string; items: PlanItem[]; avatar?: string }
export const STATUS_LABEL: Record<ItemStatus, string> = { todo: "To do", doing: "In progress", review: "In review", done: "Done", skipped: "Skipped", backlog: "Backlog" };
export const STATUS_COLOR: Record<ItemStatus, string> = { todo: "var(--mu)", doing: "var(--ac)", review: "var(--wa)", done: "var(--ok)", skipped: "var(--bd)", backlog: "var(--mu)" };
export function personColor(plan: Plan, owner: string | null) {
  if (!owner) return "var(--mu)";
  const ids = [...new Set(plan.items.map((i) => i.owner).filter(Boolean))] as string[];
  return PERSON_COLORS[Math.max(0, ids.indexOf(owner)) % PERSON_COLORS.length];
}
const tagColor = (t: string) => PLAN_PALETTE[[...t].reduce((a, c) => a + c.charCodeAt(0), 0) % PLAN_PALETTE.length];
export function itemColor(plan: Plan, i: PlanItem, by: ColourKey = plan.prefs.colour): string {
  if (by === "status") return STATUS_COLOR[i.status];
  if (by === "owner") return personColor(plan, i.owner);
  if (by === "tag") return i.tags[0] ? tagColor(i.tags[0]) : "var(--mu)";
  return plan.groups[i.group]?.color ?? "var(--mu)";
}
export function sortItems(items: PlanItem[], by: SortKey): PlanItem[] {
  const s = [...items];
  if (by === "start") s.sort((a, b) => a.start - b.start || a.line - b.line);
  else if (by === "due") s.sort((a, b) => a.end - b.end || a.line - b.line);
  else if (by === "priority") s.sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || a.start - b.start);
  else s.sort((a, b) => a.line - b.line);
  return s;
}
/** The rows of the Timeline / the lanes: items grouped by the chosen key. */
export function groupItems(plan: Plan, key: GroupKey, items = plan.items): ViewGroup[] {
  const sort = (xs: PlanItem[]) => sortItems(xs, plan.prefs.sort);
  if (key === "group") return plan.groups.map((g, gi) => ({ key: `g${gi}`, name: g.name, color: g.color, items: sort(items.filter((i) => i.group === gi)) }));
  if (key === "none") return [{ key: "all", name: plan.title, color: plan.color, items: sort(items) }];
  const keyOf = (i: PlanItem): string => key === "track" ? i.track : key === "owner" ? i.owner ?? "" : key === "status" ? i.status : key === "tag" ? i.tags[0] ?? "" : i.srcTitle;
  const order: string[] = key === "track" ? [...plan.tracks] : key === "owner" ? Object.keys(plan.people) : [];
  for (const i of items) { const k = keyOf(i); if (!order.includes(k)) order.push(k); }
  return order.map((k) => {
    const its = items.filter((i) => keyOf(i) === k);
    const name = key === "owner" ? (k ? plan.people[k] ?? k : "Unassigned") : key === "status" ? STATUS_LABEL[k as ItemStatus] ?? k : k || "None";
    const color = key === "owner" ? personColor(plan, k || null) : key === "status" ? STATUS_COLOR[k as ItemStatus] ?? "var(--mu)" : key === "tag" ? (k ? tagColor(k) : "var(--mu)") : plan.groups[its[0]?.group]?.color ?? plan.color;
    return { key: `${key}:${k}`, name, color, items: sort(its), avatar: key === "owner" && k ? (plan.people[k] ?? k)[0].toUpperCase() : undefined };
  });
}

// ------------------------------------------------------------------ helpers page 55 (Today / Calendar / Tasks) can use
/** Items running on a day (start ≤ day ≤ end), not done, with their plan. */
export const itemsOnDay = (plans: Plan[], day: Day) => plans.flatMap((p) => p.items.filter((i) => !isDone(i) && i.start <= day && day <= i.end).map((item) => ({ plan: p, item })));
/** Items whose span overlaps [from, to] (inclusive), with their plan; for a calendar range. */
export const itemsInRange = (plans: Plan[], from: Day, to: Day) => plans.flatMap((p) => p.items.filter((i) => i.start <= to && i.end >= from).map((item) => ({ plan: p, item })));
/** Milestones in [from, to] with their plan. */
export const milestonesInRange = (plans: Plan[], from: Day, to: Day) => plans.flatMap((p) => p.milestones.filter((m) => m.day >= from && m.day <= to).map((milestone) => ({ plan: p, milestone })));
/** Overdue items across plans (end before today, not done), most late first. */
export const overdueItems = (plans: Plan[], today: Day) => plans.flatMap((p) => p.items.filter((i) => daysLate(i, today) > 0).map((item) => ({ plan: p, item, late: daysLate(item, today) }))).sort((a, b) => b.late - a.late);
/** A plan's daily session at its pace: hours per week over 5 study days, in minutes (rounded to 5). */
export const sessionMinutes = (plan: Plan) => Math.max(15, Math.round(((plan.pace || 4) * 60) / 5 / 5) * 5);
