// Today: the rule-based daily study planner (no AI). Pure: every input is passed in, "today" included, so the same
// data always gives the same plan. Rules are documented in docs/TODAY.md.
//
// Inputs: course roadmaps (topics with status, needs, due dates (calendar marker), linked lesson notes), learning paths (concept
// locks, unlocks, `review:` dates), due flashcard count, lesson durations, the last studied note, and the plan log
// (what you did / skipped / moved today, weekly goals) which is stored in a synced Markdown note.
import type { BuiltConcept, BuiltPath } from "./path";
import { norm } from "./path";
import { roadmap, setTopicDue, splitFrontMatter, type Topic } from "./parse";

// ------------------------------------------------------------------ settings
export interface PlanSettings {
  /** Daily study budget in minutes. */
  dailyMinutes: number;
  /** Study weekdays, 0 = Sunday … 6 = Saturday. */
  studyDays: number[];
  /** Max new lessons per day (Continue doesn't count). */
  maxNew: number;
  /** Settings › Study plan › Reviews first (round 6): false = reviews only fill the time left after lessons. */
  reviewsFirst?: boolean;
  /** Course titles, highest priority first. Unlisted courses follow in their natural order. */
  courseOrder: string[];
}
export const PLAN_DEFAULTS: PlanSettings = { dailyMinutes: 60, studyDays: [1, 2, 3, 4, 5, 6], maxNew: 2, courseOrder: [] };
/** Minutes for a lesson whose note has no duration. */
export const DEFAULT_LESSON_MIN = 30;
/** Seconds per flashcard when estimating a review session. */
export const CARD_SECONDS = 15;
export const REVISION_MIN = 5;
export const PRACTICE_MIN = 10;
export const MAX_REVISIONS = 4;

// ------------------------------------------------------------------ dates (YYYY-MM-DD, timezone-free arithmetic)
const D = (iso: string) => new Date(iso + "T00:00:00Z");
export const shiftDay = (iso: string, n: number) => { const d = D(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const weekday = (iso: string) => D(iso).getUTCDay();
export const daysBetween = (a: string, b: string) => Math.round((D(b).getTime() - D(a).getTime()) / 86_400_000);
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Fri" within the next 6 days, "tomorrow", "today", else "Nov 30". */
export function dayLabel(today: string, iso: string) {
  const n = daysBetween(today, iso);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n > 1 && n < 7) return WD[weekday(iso)];
  return `${MON[D(iso).getUTCMonth()]} ${D(iso).getUTCDate()}`;
}
export const shortDate = (iso: string) => `${WD[weekday(iso)]} ${D(iso).getUTCDate()} ${MON[D(iso).getUTCMonth()]}`;
/** Local calendar day of an epoch time. */
export const localDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
/** Monday of the week containing `iso`. */
export const weekStart = (iso: string) => shiftDay(iso, -((weekday(iso) + 6) % 7));
export const isStudyDay = (s: PlanSettings, iso: string) => s.studyDays.includes(weekday(iso));
/** The next `n` study days starting at `from` (inclusive). Falls back to every day when no study day is set. */
export function nextStudyDays(s: PlanSettings, from: string, n: number): string[] {
  const days = s.studyDays.length ? s : { ...s, studyDays: [0, 1, 2, 3, 4, 5, 6] };
  const out: string[] = [];
  for (let d = from, guard = 0; out.length < n && guard < 400; d = shiftDay(d, 1), guard++) if (isStudyDay(days, d)) out.push(d);
  return out;
}

// ------------------------------------------------------------------ lesson durations
/** "1:12:00" → 72, "45:30" (mm:ss) → 46, "45m" / "45 min" → 45, "1h 20m" → 80, "90" → 90. Null when unreadable. */
export function parseDuration(v: string | undefined | null): number | null {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return null;
  let m = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(s);
  if (m) return Math.max(1, Math.round(Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60));
  m = /^(\d+):(\d{1,2})$/.exec(s);
  if (m) return Math.max(1, Math.round(Number(m[1]) + Number(m[2]) / 60));
  m = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?$/.exec(s);
  if (m && (m[1] || m[2])) return Math.max(1, Math.round(Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)));
  if (/^\d+(\.\d+)?$/.test(s)) return Math.max(1, Math.round(Number(s)));
  return null;
}
/** Minutes of a lesson note from its `duration` / `minutes` / `length` property (record props or front matter). */
export function lessonMinutesOf(body: string, props: Record<string, string> = {}): number | null {
  const fm = splitFrontMatter(body).data;
  for (const k of ["duration", "minutes", "length", "video_duration"]) {
    const x = parseDuration(props[k] ?? fm[k]);
    if (x) return x;
  }
  return null;
}

// ------------------------------------------------------------------ plan log (synced Markdown note)
export type Mark = "done" | "skip" | "later";
export interface LogEntry { mark: Mark; id: string; title: string; minutes: number }
export type GoalKind = "lessons" | "cards" | "minutes" | "revisions";
export interface Goal { n: number; kind: GoalKind; course: string | null }
export interface PlanLog { intro: string; goals: Goal[]; days: Record<string, LogEntry[]>; extra: Record<string, string[]> }
export const PLAN_LOG_ID = "lumen-study-plan";
export const PLAN_LOG_TITLE = "Study plan log";
const ENTRY_RE = /^-\s+(done|skip|later):\s+(.*?)\s+\((\d+)\s+min\)\s+\^(\S+)\s*$/;
const GOAL_RE = /^-\s+(\d+)\s+(lessons?|cards?|minutes?|revisions?)(?:\s+·\s+(.+))?\s*$/i;
export const emptyLog = (): PlanLog => ({ intro: "Written by Today (see docs/TODAY.md). One section per day; you can edit it.", goals: [], days: {}, extra: {} });

export function parseLog(body: string): PlanLog {
  const log: PlanLog = { ...emptyLog(), intro: "" };
  const intro: string[] = [];
  let sec: string | null = null;
  for (const raw of splitFrontMatter(body).body.split("\n")) {
    const l = raw.trimEnd();
    if (/^#\s/.test(l)) continue;
    const h = /^##\s+(.+)$/.exec(l);
    if (h) { sec = h[1].trim(); if (sec !== "Goals" && /^\d{4}-\d{2}-\d{2}$/.test(sec)) log.days[sec] ??= []; continue; }
    if (sec === null) { intro.push(l); continue; }
    if (sec === "Goals") {
      const g = GOAL_RE.exec(l);
      if (g) { const k = g[2].toLowerCase().replace(/s$/, "") + "s"; log.goals.push({ n: Number(g[1]), kind: k as GoalKind, course: g[3]?.trim() || null }); continue; }
    } else if (log.days[sec]) {
      const e = ENTRY_RE.exec(l);
      if (e) { log.days[sec].push({ mark: e[1] as Mark, id: e[4], title: e[2], minutes: Number(e[3]) }); continue; }
    }
    if (l.trim()) (log.extra[sec] ??= []).push(l);
  }
  log.intro = intro.join("\n").trim();
  return log;
}
export function serializeLog(log: PlanLog): string {
  const out = ["---", "lumen: study-plan", "---", `# ${PLAN_LOG_TITLE}`, ""];
  if (log.intro) out.push(log.intro, "");
  out.push("## Goals", ...log.goals.map(goalLine), ...(log.extra.Goals ?? []), "");
  for (const d of Object.keys(log.days).sort().reverse()) {
    const es = log.days[d];
    if (!es.length && !log.extra[d]?.length) continue;
    out.push(`## ${d}`, ...es.map((e) => `- ${e.mark}: ${e.title.replace(/\s+/g, " ")} (${Math.round(e.minutes)} min) ^${e.id}`), ...(log.extra[d] ?? []), "");
  }
  for (const [sec, lines] of Object.entries(log.extra)) if (sec !== "Goals" && !log.days[sec] && lines.length) out.push(`## ${sec}`, ...lines, "");
  return out.join("\n").trimEnd() + "\n";
}
export const goalLine = (g: Goal) => `- ${g.n} ${g.n === 1 ? g.kind.replace(/s$/, "") : g.kind}${g.course ? ` · ${g.course}` : ""}`;
/** Set (or clear with null) the mark of one item on one day. Returns a new log. */
export function markItem(log: PlanLog, day: string, item: { id: string; title: string; minutes: number }, mark: Mark | null): PlanLog {
  const es = (log.days[day] ?? []).filter((e) => e.id !== item.id);
  if (mark) es.push({ mark, id: item.id, title: item.title, minutes: item.minutes });
  return { ...log, days: { ...log.days, [day]: es } };
}
export const setGoals = (log: PlanLog, goals: Goal[]): PlanLog => ({ ...log, goals });

// ------------------------------------------------------------------ plan input / output
export interface PlanCourse {
  /** Roadmap note id. */
  key: string;
  title: string;
  color: string;
  body: string;
  spaceId: string | null;
  /** Course target date (space prop `target`). */
  target: string | null;
  /** Natural order (space sort). */
  order: number;
  /** Course medium (glyph k-*), for the Today item glyph. */
  kind?: string;
}
export interface PlanLesson { id: string; title: string; updatedAt: number; minutes: number | null }
export interface PlanPath { noteId: string; title: string; built: BuiltPath }
export interface PlanInput {
  today: string;
  settings: PlanSettings;
  courses: PlanCourse[];
  paths: PlanPath[];
  /** Lesson notes that roadmap topics link to (any note, really), for minutes and "last studied". */
  lessons: PlanLesson[];
  cardsDue: number;
  /** Note of the most recent timer session. */
  lastStudiedNoteId: string | null;
  log: PlanLog;
  /** Plan lessons even on a rest day. */
  force?: boolean;
}

export type ItemKind = "continue" | "lesson" | "cards" | "revision" | "practice";
export type SectionId = "continue" | "new" | "reviews" | "practice";
export type ItemState = "todo" | "done" | "skip" | "later";
export type PlanTarget =
  | { type: "topic"; courseKey: string; line: number; topic: string; status: Topic["status"]; noteTitle: string | null; noteId: string | null; spaceId: string | null }
  | { type: "cards" }
  | { type: "concept"; pathNoteId: string; concept: string };
export interface PlanItem {
  id: string;
  kind: ItemKind;
  section: SectionId;
  course: { key: string; title: string; color: string } | null;
  title: string;
  minutes: number;
  reason: string;
  target: PlanTarget | null;
  state: ItemState;
}
export interface Plan {
  date: string;
  studyDay: boolean;
  budget: number;
  /** Minutes of everything planned and not skipped (done included). */
  planned: number;
  doneMinutes: number;
  sections: Record<SectionId, PlanItem[]>;
  /** Fit the rules but not the budget / lesson cap: "If you have time". */
  extra: PlanItem[];
  /** Skipped or moved to tomorrow today (can be undone). */
  setAside: PlanItem[];
  /** True when there's nothing to plan from at all (no course roadmap, no path, no cards). */
  noSources: boolean;
}

export const slug = (s: string) => norm(s).replace(/\s+/g, "-") || "x";
export const lessonId = (courseTitle: string, topic: string) => `lesson:${slug(courseTitle)}:${slug(topic)}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Course priority index: position in settings.courseOrder, then natural order. */
export function coursePriority(s: PlanSettings, courses: PlanCourse[]): Map<string, number> {
  const sorted = orderedCourses(s, courses);
  return new Map(sorted.map((c, i) => [c.key, i]));
}
export function orderedCourses<T extends { title: string; order: number }>(s: PlanSettings, courses: T[]): T[] {
  const pos = (c: T) => { const i = s.courseOrder.findIndex((t) => t.toLowerCase() === c.title.toLowerCase()); return i < 0 ? 1e6 + c.order : i; };
  return [...courses].sort((a, b) => pos(a) - pos(b) || a.title.localeCompare(b.title));
}

interface Cand { item: PlanItem; topic: Topic; course: PlanCourse; tier: number; due: string; prio: number; recent: number; concept: string | null }

/** Map course topic → path concept (for locks, unlocks and "already learned elsewhere"). */
function conceptIndex(paths: PlanPath[]) {
  const m = new Map<string, BuiltConcept>();
  for (const p of paths) for (const c of p.built.concepts) for (const cov of c.coverage) if (cov.course.note) m.set(`${cov.course.note.id}::${norm(cov.topic.name)}`, c);
  return m;
}

/** Topics of every course that are overdue (open, due before today). */
export function overdueTopics(today: string, courses: PlanCourse[]) {
  const out: { course: PlanCourse; topic: Topic }[] = [];
  for (const c of courses) for (const m of roadmap(c.body)) for (const t of m.topics) if ((t.status === "todo" || t.status === "learning") && t.due && t.due < today) out.push({ course: c, topic: t });
  return out;
}

/** Courses with a target date that need more than one lesson per remaining study day: behind schedule. */
function behindTarget(inp: PlanInput, c: PlanCourse) {
  if (!c.target || c.target < inp.today) return null;
  const left = roadmap(c.body).flatMap((m) => m.topics).filter((t) => t.status === "todo" || t.status === "learning").length;
  const days = Math.max(1, nextStudyDays(inp.settings, inp.today, 400).filter((d) => d <= c.target!).length);
  const perDay = left / days;
  return perDay >= inp.settings.maxNew * 0.5 ? { left, perDay } : null;
}

export function buildPlan(inp: PlanInput): Plan {
  const { today, settings: s } = inp;
  const studyDay = isStudyDay(s, today) || !!inp.force;
  const budget = studyDay ? Math.max(0, s.dailyMinutes) : 0;
  const todayLog = inp.log.days[today] ?? [];
  const mark = new Map(todayLog.map((e) => [e.id, e]));
  // "Move to tomorrow" on the last logged day before today → first in line today
  const prevDay = Object.keys(inp.log.days).filter((d) => d < today).sort().pop();
  const movedIn = new Set((prevDay ? inp.log.days[prevDay] : []).filter((e) => e.mark === "later").map((e) => e.id));
  const prio = coursePriority(s, inp.courses);
  const concepts = conceptIndex(inp.paths);
  const lessonsByTitle = new Map(inp.lessons.map((l) => [l.title.toLowerCase(), l]));
  const lastNote = inp.lessons.find((l) => l.id === inp.lastStudiedNoteId) ?? null;

  // ---- lesson candidates
  const cands: Cand[] = [];
  for (const course of inp.courses) {
    const behind = behindTarget(inp, course);
    for (const m of roadmap(course.body)) for (const t of m.topics) {
      if (t.status !== "todo" && t.status !== "learning") continue;
      const concept = concepts.get(`${course.key}::${norm(t.name)}`);
      if (t.status === "todo") {
        if (t.locked) continue; // a prerequisite in this course isn't done
        if (concept && (concept.status === "locked" || concept.status === "done")) continue; // path prerequisite missing / learned elsewhere
      }
      const lesson = t.note ? lessonsByTitle.get(t.note.toLowerCase()) ?? null : null;
      const id = lessonId(course.title, t.name);
      const overdue = t.due && t.due < today ? daysBetween(t.due, today) : 0;
      const soon = t.due && !overdue && daysBetween(today, t.due) <= 7;
      const unlocks = concept ? concept.unlocks.length : 0;
      const reasons: string[] = [];
      if (movedIn.has(id)) reasons.push(`moved from ${daysBetween(prevDay!, today) === 1 ? "yesterday" : WD[weekday(prevDay!)]}`);
      if (overdue) reasons.push(`overdue ${plural(overdue, "day")}`);
      else if (soon) reasons.push(`due ${dayLabel(today, t.due!)} for ${course.title}`);
      if (t.status === "learning" && !reasons.length) reasons.push("in progress");
      if (unlocks) reasons.push(`unlocks ${plural(unlocks, "concept")}`);
      if (behind && !overdue && !soon) reasons.push(`${course.title} target ${dayLabel(today, course.target!)}: ${behind.left} left`);
      if (!reasons.length) reasons.push(`next in ${course.title}`);
      const tier = movedIn.has(id) ? 0 : overdue ? 1 : soon ? 2 : t.status === "learning" ? 3 : behind ? 4 : 5;
      cands.push({
        course, topic: t, tier, concept: concept?.key ?? null, due: t.due ?? "9999-12-31", prio: prio.get(course.key) ?? 999, recent: lesson?.updatedAt ?? 0,
        item: {
          id, kind: "lesson", section: "new", course: { key: course.key, title: course.title, color: course.color }, title: t.name,
          minutes: lesson?.minutes ?? DEFAULT_LESSON_MIN, reason: reasons.slice(0, 2).join(" · "),
          target: { type: "topic", courseKey: course.key, line: t.line, topic: t.name, status: t.status, noteTitle: t.note, noteId: lesson?.id ?? null, spaceId: course.spaceId },
          state: "todo",
        },
      });
    }
  }
  cands.sort((a, b) => a.tier - b.tier || a.due.localeCompare(b.due) || a.prio - b.prio || a.topic.module - b.topic.module || a.topic.line - b.topic.line);

  // ---- Continue: the lesson you were in (last timer session's note, else the most recently edited in-progress lesson)
  const learning = cands.filter((c) => c.topic.status === "learning");
  const cont = (lastNote && learning.find((c) => c.topic.note?.toLowerCase() === lastNote.title.toLowerCase()))
    ?? [...learning].sort((a, b) => b.recent - a.recent || a.prio - b.prio || a.topic.line - b.topic.line)[0];
  if (cont) { cont.item.kind = "continue"; cont.item.section = "continue"; if (cont.item.reason === "in progress") cont.item.reason = lastNote && cont.topic.note?.toLowerCase() === lastNote.title.toLowerCase() ? "where you left off" : "in progress"; }

  // ---- reviews
  const reviews: PlanItem[] = [];
  if (inp.cardsDue > 0) reviews.push({ id: "cards", kind: "cards", section: "reviews", course: null, title: `Review ${plural(inp.cardsDue, "flashcard")}`, minutes: Math.max(5, Math.ceil((inp.cardsDue * CARD_SECONDS) / 60)), reason: `${plural(inp.cardsDue, "card")} due`, target: { type: "cards" }, state: "todo" });
  const revs: { item: PlanItem; review: string }[] = [];
  for (const p of inp.paths) for (const c of p.built.concepts) {
    if (c.status !== "done" || !c.def.review || c.def.review > today) continue;
    const late = daysBetween(c.def.review, today);
    const cov = c.coverage[0]?.course;
    const course = cov ? inp.courses.find((x) => x.key === cov.note?.id) : undefined;
    revs.push({ review: c.def.review, item: { id: `rev:${slug(p.title)}:${c.key.replace(/\s+/g, "-")}`, kind: "revision", section: "reviews", course: course ? { key: course.key, title: course.title, color: course.color } : null, title: `Revise ${c.def.name}`, minutes: REVISION_MIN, reason: late ? `revision overdue ${plural(late, "day")}` : `revision due today · ${c.def.interval || 1}-day step`, target: { type: "concept", pathNoteId: p.noteId, concept: c.key }, state: "todo" } });
  }
  revs.sort((a, b) => a.review.localeCompare(b.review) || a.item.title.localeCompare(b.item.title));
  reviews.push(...revs.slice(0, MAX_REVISIONS).map((r) => r.item));

  // ---- practice: one unlocked, not-started concept to test out (the one that unlocks the most)
  const planned = new Set(cands.slice(0, s.maxNew + 1).map((c) => `${c.course.key}::${norm(c.topic.name)}`));
  let practice: PlanItem | null = null;
  const pcands: { c: BuiltConcept; p: PlanPath }[] = [];
  for (const p of inp.paths) for (const c of p.built.concepts) if (c.status === "todo" && !c.coverage.some((x) => x.course.note && planned.has(`${x.course.note.id}::${norm(x.topic.name)}`))) pcands.push({ c, p });
  pcands.sort((a, b) => b.c.unlocks.length - a.c.unlocks.length || a.c.stageIndex - b.c.stageIndex || a.c.def.name.localeCompare(b.c.def.name));
  if (pcands[0]) {
    const { c, p } = pcands[0];
    const cov = c.coverage[0]?.course;
    const course = cov ? inp.courses.find((x) => x.key === cov.note?.id) : undefined;
    practice = { id: `practice:${slug(p.title)}:${c.key.replace(/\s+/g, "-")}`, kind: "practice", section: "practice", course: course ? { key: course.key, title: course.title, color: course.color } : null, title: `Test out of ${c.def.name}`, minutes: PRACTICE_MIN, reason: c.unlocks.length ? `already know it? unlocks ${plural(c.unlocks.length, "concept")}` : "already know it? skip ahead", target: { type: "concept", pathNoteId: p.noteId, concept: c.key }, state: "todo" };
  }

  // ---- fit to the budget
  const sections: Record<SectionId, PlanItem[]> = { continue: [], new: [], reviews: [], practice: [] };
  const extra: PlanItem[] = [], setAside: PlanItem[] = [];
  const seen = new Set<string>();
  let used = 0, doneMin = 0, newCount = 0;
  for (const e of todayLog) if (e.mark === "done") { used += e.minutes; doneMin += e.minutes; }
  const place = (it: PlanItem, rule: "always" | "fit" | "lesson") => {
    seen.add(it.id);
    const m = mark.get(it.id);
    if (m) {
      it.state = m.mark;
      if (m.mark === "done") { it.minutes = m.minutes; sections[it.section].push(it); if (it.kind === "lesson") newCount++; }
      else setAside.push(it);
      return;
    }
    if (!studyDay && it.kind !== "cards" && it.kind !== "revision") return;
    const fits = used + it.minutes <= budget;
    const ok = rule === "always" || (rule === "fit" ? fits : newCount < s.maxNew && (fits || (used === 0 && budget > 0)));
    if (!ok) { if (it.kind === "lesson" && extra.length < 3) extra.push(it); return; }
    sections[it.section].push(it);
    used += it.minutes;
    if (it.kind === "lesson") newCount++;
  };
  if (cont) place(cont.item, "always");
  const reviewsFirst = s.reviewsFirst !== false;
  if (reviewsFirst) for (const r of reviews) place(r, "always");
  // one lesson per path concept a day: the same idea taught by two courses is learned once
  const taken = new Set<string>(cont?.concept ? [cont.concept] : []);
  for (const c of cands) {
    if (c === cont) continue;
    if (c.concept && taken.has(c.concept) && !mark.has(c.item.id)) continue;
    if (c.concept) taken.add(c.concept);
    place(c.item, "lesson");
  }
  if (!reviewsFirst) for (const r of reviews) place(r, "fit");
  if (practice) place(practice, "fit");
  // done today but no longer generated (e.g. the topic is now marked done in its roadmap): keep showing it
  for (const e of todayLog) {
    if (seen.has(e.id) || e.mark !== "done") continue;
    const section: SectionId = e.id === "cards" || e.id.startsWith("rev:") ? "reviews" : e.id.startsWith("practice:") ? "practice" : "new";
    const kind: ItemKind = e.id === "cards" ? "cards" : e.id.startsWith("rev:") ? "revision" : e.id.startsWith("practice:") ? "practice" : "lesson";
    const courseSlug = kind === "lesson" ? e.id.split(":")[1] : "";
    const course = inp.courses.find((c) => slug(c.title) === courseSlug);
    const t = course ? roadmap(course.body).flatMap((m) => m.topics).find((x) => slug(x.name) === e.id.split(":")[2]) : undefined;
    const lesson = t?.note ? lessonsByTitle.get(t.note.toLowerCase()) : undefined;
    const target: PlanTarget | null = course && t ? { type: "topic", courseKey: course.key, line: t.line, topic: t.name, status: t.status, noteTitle: t.note, noteId: lesson?.id ?? null, spaceId: course.spaceId } : null;
    sections[section].push({ id: e.id, kind, section, course: course ? { key: course.key, title: course.title, color: course.color } : null, title: e.title, minutes: e.minutes, reason: "done today", target, state: "done" });
  }
  const all = Object.values(sections).flat();
  return {
    date: today, studyDay, budget, planned: all.reduce((a, x) => a + x.minutes, 0), doneMinutes: doneMin, sections, extra, setAside,
    noSources: !inp.courses.length && !inp.paths.length && inp.cardsDue === 0,
  };
}

// ------------------------------------------------------------------ missed days + rescheduling
/** Study days before today (looking back up to `lookback` days) with no activity, counted until the last active day. */
export function missedDays(today: string, s: PlanSettings, active: Set<string>, lookback = 14): number {
  let n = 0;
  for (let i = 1; i <= lookback; i++) {
    const d = shiftDay(today, -i);
    if (active.has(d)) return n;
    if (isStudyDay(s, d)) n++;
  }
  return 0; // nothing at all in the window: a fresh start, not "missed"
}

export interface Move { courseKey: string; courseTitle: string; color: string; line: number; topic: string; from: string | null; to: string; why: "overdue" | "after prerequisite" }
export interface Reschedule {
  overdue: number;
  days: string[];
  moves: Move[];
  /** Window shown in the before/after: today + the next days up to the last new date. */
  window: string[];
  before: Record<string, number>;
  after: Record<string, number>;
  /** Overdue lessons (before) — shown as their own column. */
  beforeOverdue: number;
}

/**
 * Spread overdue topics over the next `n` study days (today included when it's a study day), in course priority and
 * roadmap order, at most ceil(overdue / n) a day. Then push any open topic that now comes before one of its
 * prerequisites to that prerequisite's new date, so the order still makes sense.
 */
export function proposeReschedule(today: string, s: PlanSettings, courses: PlanCourse[], n: number): Reschedule {
  const days = nextStudyDays(s, today, Math.max(1, n));
  const prio = coursePriority(s, courses);
  const od = overdueTopics(today, courses).sort((a, b) => (prio.get(a.course.key) ?? 0) - (prio.get(b.course.key) ?? 0) || a.topic.line - b.topic.line);
  // interleave courses by priority: one from each in turn, keeping each course's roadmap order
  const queues = new Map<string, typeof od>();
  for (const x of od) queues.set(x.course.key, [...(queues.get(x.course.key) ?? []), x]);
  const order: typeof od = [];
  while ([...queues.values()].some((q) => q.length)) for (const q of queues.values()) { const x = q.shift(); if (x) order.push(x); }
  const per = Math.max(1, Math.ceil(order.length / days.length));
  const newDue = new Map<string, string>(); // courseKey::line → date
  const moves: Move[] = [];
  order.forEach((x, i) => {
    const to = days[Math.min(days.length - 1, Math.floor(i / per))];
    newDue.set(`${x.course.key}::${x.topic.line}`, to);
    moves.push({ courseKey: x.course.key, courseTitle: x.course.title, color: x.course.color, line: x.topic.line, topic: x.topic.name, from: x.topic.due, to, why: "overdue" });
  });
  // cascade: an open topic due before its (re)scheduled prerequisite moves to the prerequisite's date
  for (const c of courses) {
    const topics = roadmap(c.body).flatMap((m) => m.topics);
    const byName = new Map(topics.map((t) => [t.name.toLowerCase(), t]));
    const dueOf = (t: Topic) => newDue.get(`${c.key}::${t.line}`) ?? t.due;
    for (let pass = 0, changed = true; changed && pass < 20; pass++) {
      changed = false;
      for (const t of topics) {
        if (t.status !== "todo" && t.status !== "learning") continue;
        const mine = dueOf(t);
        if (!mine) continue;
        const pre = t.needs.map((x) => byName.get(x.toLowerCase())).filter((x): x is Topic => !!x && (x.status === "todo" || x.status === "learning")).map(dueOf).filter((x): x is string => !!x).sort().pop();
        if (pre && pre > mine) {
          newDue.set(`${c.key}::${t.line}`, pre);
          const mv = moves.find((m) => m.courseKey === c.key && m.line === t.line);
          if (mv) mv.to = pre; else moves.push({ courseKey: c.key, courseTitle: c.title, color: c.color, line: t.line, topic: t.name, from: t.due, to: pre, why: "after prerequisite" });
          changed = true;
        }
      }
    }
  }
  const last = [days[days.length - 1], ...moves.map((m) => m.to)].sort().pop()!;
  const window: string[] = [];
  for (let d = today; d <= last && window.length < 21; d = shiftDay(d, 1)) window.push(d);
  const before: Record<string, number> = {}, after: Record<string, number> = {};
  let beforeOverdue = 0;
  for (const c of courses) for (const t of roadmap(c.body).flatMap((m) => m.topics)) {
    if (t.status !== "todo" && t.status !== "learning") continue;
    if (t.due && t.due < today) beforeOverdue++;
    else if (t.due && window.includes(t.due)) before[t.due] = (before[t.due] ?? 0) + 1;
    const a = newDue.get(`${c.key}::${t.line}`) ?? t.due;
    if (a && window.includes(a)) after[a] = (after[a] ?? 0) + 1;
  }
  return { overdue: order.length, days, moves, window, before, after, beforeOverdue };
}
/** Write the moves of one course into its roadmap body (due dates via parse.ts setTopicDue). */
export function applyMoves(body: string, moves: Move[]): string {
  let out = body;
  for (const m of moves) out = setTopicDue(out, m.line, m.to);
  return out;
}

// ------------------------------------------------------------------ week view
export interface WeekDay { date: string; studyDay: boolean; goal: number; done: number; isToday: boolean }
export interface GoalProgress { goal: Goal; done: number; pct: number; label: string }
export function weekSummary(today: string, s: PlanSettings, log: PlanLog, sessions: { at: string; minutes: number }[], cardsReviewed: number): { days: WeekDay[]; goals: GoalProgress[]; doneMinutes: number; goalMinutes: number } {
  const start = weekStart(today);
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = shiftDay(start, i);
    const studyDay = isStudyDay(s, date);
    return { date, studyDay, goal: studyDay ? s.dailyMinutes : 0, done: 0, isToday: date === today };
  });
  for (const x of sessions) { const d = days.find((y) => y.date === x.at); if (d) d.done += x.minutes; }
  const inWeek = Object.entries(log.days).filter(([d]) => d >= start && d <= shiftDay(start, 6)).flatMap(([, es]) => es.filter((e) => e.mark === "done"));
  const doneMinutes = days.reduce((a, d) => a + d.done, 0);
  const goals = log.goals.map((g) => {
    let done = 0;
    if (g.kind === "minutes") done = doneMinutes;
    else if (g.kind === "cards") done = cardsReviewed;
    else if (g.kind === "revisions") done = inWeek.filter((e) => e.id.startsWith("rev:")).length;
    else done = inWeek.filter((e) => e.id.startsWith("lesson:") && (!g.course || e.id.split(":")[1] === slug(g.course))).length;
    const label = `${g.n} ${g.n === 1 ? g.kind.replace(/s$/, "") : g.kind}${g.course ? ` · ${g.course}` : ""}`;
    return { goal: g, done, pct: g.n ? Math.min(100, Math.round((done / g.n) * 100)) : 0, label };
  });
  return { days, goals, doneMinutes, goalMinutes: days.reduce((a, d) => a + d.goal, 0) };
}

/** Days in a row with activity ending today (or yesterday if today has none yet). */
export function streak(today: string, active: Set<string>): number {
  let d = active.has(today) ? today : shiftDay(today, -1), n = 0;
  while (active.has(d) && n < 3650) { n++; d = shiftDay(d, -1); }
  return n;
}
