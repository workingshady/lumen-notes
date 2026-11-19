// Today plan: React glue between the vault and the pure planner (lib/plan.ts), plus the plan actions
// (Start / Done / Skip / Move to tomorrow / reschedule) that write to synced notes.
import { startStudyTimer as startTimer } from "./Timer";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import type { Note } from "../../shared/types";
import { createNote, updateNote } from "../lib/actions";
import { db, DEFAULT_SPACE } from "../lib/db";
import { setTopicStatus, topicLineByName } from "../lib/parse";
import { buildPath, COURSE_COLORS, courseKind, resolveCourses } from "../lib/path";
import {
  applyMoves, buildPlan, emptyLog, lessonMinutesOf, localDay, markItem, missedDays, parseLog, PLAN_DEFAULTS, PLAN_LOG_ID, PLAN_LOG_TITLE, serializeLog, streak,
  weekStart, type Mark, type Move, type PlanCourse, type PlanInput, type PlanItem, type PlanLog, type PlanPath, type PlanSettings,
} from "../lib/plan";
import { useSettings, type Settings } from "../lib/settings";
import { go, noteDerived, openNote, toast, useVault, type Vault } from "../lib/store";
import { useDueCards } from "./Review";

export const planSettingsOf = (s: Settings): PlanSettings => ({
  dailyMinutes: s.planDailyMinutes ?? PLAN_DEFAULTS.dailyMinutes,
  studyDays: s.planStudyDays ?? PLAN_DEFAULTS.studyDays,
  maxNew: s.planMaxNew ?? PLAN_DEFAULTS.maxNew,
  courseOrder: s.planCourseOrder ?? PLAN_DEFAULTS.courseOrder,
});
export const todayISO = () => localDay(Date.now());

/** Every course the planner knows: course spaces with a roadmap, plus roadmaps that learning paths reference. */
export function planCourses(v: Vault): PlanCourse[] {
  const out = new Map<string, PlanCourse>();
  const spaces = v.spaces.filter((s) => !s.archived);
  for (const sp of spaces) {
    if (sp.kind !== "course" || !sp.roadmapId) continue;
    const n = v.byId.get(sp.roadmapId);
    if (!n || n.deleted) continue;
    out.set(n.id, { key: n.id, title: sp.name, color: "", body: n.body, spaceId: sp.id, target: sp.props?.target || null, order: sp.sort, kind: courseKind(sp.props, sp.name) });
  }
  for (const p of v.notes) {
    if (p.type !== "path") continue;
    const names = noteDerived("pathCourses", p, (x) => buildPath(x.body, []).doc.courses);
    for (const ref of resolveCourses(names, v.notes, v.spaces)) {
      if (!ref.note || out.has(ref.note.id)) continue;
      const sp = ref.spaceId ? v.spaceMap.get(ref.spaceId) : undefined;
      out.set(ref.note.id, { key: ref.note.id, title: sp?.roadmapId === ref.note.id ? sp.name : ref.title, color: "", body: ref.note.body, spaceId: ref.spaceId, target: sp?.props?.target || null, order: sp?.sort ?? 1e9, kind: ref.kind });
    }
  }
  const list = [...out.values()].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  list.forEach((c, i) => { c.color = COURSE_COLORS[i % COURSE_COLORS.length]; });
  return list;
}
export function planPaths(v: Vault): PlanPath[] {
  return v.notes.filter((n) => n.type === "path").map((n) => {
    const doc = buildPath(n.body, []).doc;
    return { noteId: n.id, title: n.title, built: buildPath(n.body, resolveCourses(doc.courses, v.notes, v.spaces)) };
  });
}
const minutesOf = (n: Note) => noteDerived("planMinutes", n, (x) => lessonMinutesOf(x.body, x.props ?? {}));

export interface TodayData {
  ready: boolean;
  input: PlanInput;
  plan: ReturnType<typeof buildPlan>;
  courses: PlanCourse[];
  log: PlanLog;
  sessions: { at: string; minutes: number }[];
  cardsReviewed: number;
  active: Set<string>;
  missed: number;
  streak: number;
}

export function useTodayData(force = false): TodayData {
  const v = useVault();
  const s = useSettings();
  const settings = planSettingsOf(s);
  const today = todayISO();
  const due = useDueCards(v.notes);
  const sessRaw = useLiveQuery(() => db.sessions.toArray(), []);
  const ws = useMemo(() => new Date(weekStart(today) + "T00:00:00").getTime(), [today]);
  const cardsReviewed = useLiveQuery(async () => (await db.cards.toArray()).filter((c) => !c.deleted && (c.lastReview ?? 0) >= ws).length, [ws]) ?? 0;
  const logNote = v.byId.get(PLAN_LOG_ID);
  const log = useMemo(() => (logNote && !logNote.deleted ? parseLog(logNote.body) : emptyLog()), [logNote]);
  const courses = useMemo(() => planCourses(v), [v]);
  const paths = useMemo(() => planPaths(v), [v]);
  const sessions = useMemo(() => (sessRaw ?? []).filter((x) => !x.deleted).sort((a, b) => a.at - b.at), [sessRaw]);
  const lessons = useMemo(() => {
    const titles = new Set<string>();
    for (const c of courses) for (const m of /→|->/.test(c.body) ? c.body.matchAll(/(?:→|->)\s*\[\[([^\]|]+)/g) : []) titles.add(m[1].trim().toLowerCase());
    const out = [...titles].map((t) => v.byTitle.get(t)).filter((n): n is Note => !!n).map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt, minutes: minutesOf(n) }));
    const last = sessions.filter((x) => x.noteId).pop();
    const ln = last?.noteId ? v.byId.get(last.noteId) : undefined;
    if (ln && !out.some((x) => x.id === ln.id)) out.push({ id: ln.id, title: ln.title, updatedAt: ln.updatedAt, minutes: minutesOf(ln) });
    return out;
  }, [courses, sessions, v.byTitle, v.byId]);
  const lastStudiedNoteId = sessions.filter((x) => x.noteId).pop()?.noteId ?? null;
  const input: PlanInput = { today, settings, courses, paths, lessons, cardsDue: due?.length ?? 0, lastStudiedNoteId, log, force };
  const plan = useMemo(() => buildPlan(input), [today, JSON.stringify(settings), courses, paths, lessons, input.cardsDue, lastStudiedNoteId, log, force]); // eslint-disable-line react-hooks/exhaustive-deps
  const sess = useMemo(() => sessions.map((x) => ({ at: localDay(x.at), minutes: x.minutes })), [sessions]);
  const active = useMemo(() => {
    const a = new Set(sess.filter((x) => x.minutes > 0).map((x) => x.at));
    for (const [d, es] of Object.entries(log.days)) if (es.some((e) => e.mark === "done")) a.add(d);
    return a;
  }, [sess, log]);
  return {
    ready: v.ready && !!due && !!sessRaw, input, plan, courses, log, sessions: sess, cardsReviewed, active,
    missed: missedDays(today, settings, active), streak: streak(today, active),
  };
}

// ------------------------------------------------------------------ writes
/** Read-modify-write of the synced plan log note (created on first use with a fixed id, so devices share one). */
export async function writeLog(fn: (l: PlanLog) => PlanLog) {
  const cur = await db.notes.get(PLAN_LOG_ID);
  const log = cur && !cur.deleted ? parseLog(cur.body) : emptyLog();
  const body = serializeLog(fn(log));
  if (cur && !cur.deleted) await updateNote(PLAN_LOG_ID, { body });
  else if (cur) await updateNote(PLAN_LOG_ID, { body, deleted: 0 });
  else await createNote({ id: PLAN_LOG_ID, title: PLAN_LOG_TITLE, body, spaceId: DEFAULT_SPACE, type: "note" });
}
async function setStatusIn(courseKey: string, topic: string, line: number, status: "todo" | "learning" | "done" | "skipped") {
  const n = await db.notes.get(courseKey);
  if (!n) return;
  const at = topicLineByName(n.body, topic) ?? line;
  const next = setTopicStatus(n.body, at, status);
  if (next !== n.body) await updateNote(n.id, { body: next });
}

/** Start the global study timer (Timer.tsx), attributed to the note being studied. */
export function startStudyTimer(noteId: string | null = null) { startTimer(noteId); }

export async function markPlanItem(item: PlanItem, mark: Mark | null, day = todayISO()) {
  await writeLog((l) => markItem(l, day, item, mark));
  const t = item.target;
  if (t?.type === "topic") {
    if (mark === "done") await setStatusIn(t.courseKey, t.topic, t.line, "done");
    else if (mark === null && item.state === "done") await setStatusIn(t.courseKey, t.topic, t.line, t.status === "done" ? "learning" : t.status);
  }
}

/** Start: open what the item points at and start the study timer. Concept items are handled by the view (sheets). */
export async function startPlanItem(item: PlanItem) {
  const t = item.target;
  if (!t) return;
  if (t.type === "cards") { go("review"); startStudyTimer(); return; }
  if (t.type === "topic") {
    if (t.status === "todo") await setStatusIn(t.courseKey, t.topic, t.line, "learning");
    if (t.noteId) openNote(t.noteId, "read");
    else if (t.spaceId) { go("space", { spaceId: t.spaceId, folderId: null, noteId: null }); toast(`No lesson note linked to "${t.topic}" yet`); return; }
    else openNote(t.courseKey);
    startStudyTimer(t.noteId ?? null);
  }
}

/** Accept a reschedule: write the new due dates into each course roadmap. */
export async function acceptMoves(moves: Move[]) {
  const byCourse = new Map<string, Move[]>();
  for (const m of moves) byCourse.set(m.courseKey, [...(byCourse.get(m.courseKey) ?? []), m]);
  for (const [key, ms] of byCourse) {
    const n = await db.notes.get(key);
    if (!n) continue;
    const next = applyMoves(n.body, ms);
    if (next !== n.body) await updateNote(n.id, { body: next });
  }
}
