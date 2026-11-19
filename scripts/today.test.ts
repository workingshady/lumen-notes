// Today planner tests (pure logic in src/lib/plan.ts). Run: npx tsx scripts/today.test.ts
import { buildPath, resolveCourses, serializePath } from "../src/lib/path";
import { roadmap } from "../src/lib/parse";
import {
  applyMoves, buildPlan, emptyLog, lessonId, markItem, missedDays, parseDuration, parseLog, PLAN_DEFAULTS, proposeReschedule, serializeLog, streak,
  weekSummary, type PlanCourse, type PlanInput, type PlanLog,
} from "../src/lib/plan";
import type { Note, Space } from "../shared/types";

let failed = 0, passed = 0;
function ok(cond: unknown, msg: string) { if (cond) passed++; else { failed++; console.error("FAIL:", msg); } }
function eq<T>(a: T, b: T, msg: string) { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, `${msg}\n   got:      ${A}\n   expected: ${B}`); }

const TODAY = "2026-11-19"; // Thursday
const CS = `## Lectures
- [x] Image classification
- [/] Optimization (needs: Image classification) 📅 2026-11-17 → [[Optimization lecture]]
- [ ] Backpropagation (needs: Optimization) 📅 2026-11-18
- [ ] Neural networks (needs: Backpropagation) 📅 2026-11-19
- [ ] Data loading 📅 2026-11-20
- [ ] Augmentation
`;
const ML = `## Basics
- [x] Vectors
- [ ] Matrices (needs: Vectors)
- [ ] Eigenvectors (needs: Matrices)
- [ ] Calculus
`;
const course = (key: string, title: string, body: string, order: number, target: string | null = null): PlanCourse => ({ key, title, color: `#${order}${order}${order}`, body, spaceId: `s-${key}`, target, order });
const courses = () => [course("rm-cs", "CS231n", CS, 1), course("rm-ml", "ML Foundations", ML, 2)];
const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  today: TODAY, settings: { ...PLAN_DEFAULTS, dailyMinutes: 90, maxNew: 2 }, courses: courses(), paths: [],
  lessons: [{ id: "n-opt", title: "Optimization lecture", updatedAt: 1, minutes: 45 }], cardsDue: 0, lastStudiedNoteId: null, log: emptyLog(), ...over,
});

// ------------------------------------------------------------------ durations
eq(parseDuration("1:12:00"), 72, "h:mm:ss");
eq(parseDuration("45:30"), 46, "mm:ss");
eq(parseDuration("45m"), 45, "45m");
eq(parseDuration("1h 20m"), 80, "1h 20m");
eq(parseDuration("90"), 90, "plain number");
eq(parseDuration("soon"), null, "unreadable");

// ------------------------------------------------------------------ plan basics
{
  const p = buildPlan(base());
  eq(p.sections.continue.map((x) => x.title), ["Optimization"], "continue = the in-progress topic");
  eq(p.sections.continue[0].minutes, 45, "minutes from the linked lesson note");
  ok(/overdue 2 days/.test(p.sections.continue[0].reason), `continue reason says overdue: ${p.sections.continue[0].reason}`);
  // Backpropagation is locked (needs Optimization, not done); new = unlocked topics only
  const titles = p.sections.new.map((x) => x.title);
  ok(!titles.includes("Backpropagation") && !titles.includes("Neural networks"), "locked topics are not planned");
  ok(!titles.includes("Eigenvectors"), "Eigenvectors locked (needs Matrices)");
  eq(titles[0], "Data loading", "due-soon topic first");
  ok(/due tomorrow for CS231n/.test(p.sections.new[0].reason), `reason due tomorrow: ${p.sections.new[0].reason}`);
  ok(p.sections.new.length <= 2, "max new lessons respected");
  ok(p.planned <= 90 || p.sections.new.length === 0, "fits the budget");
  // deterministic
  eq(JSON.stringify(buildPlan(base())), JSON.stringify(p), "same input → same plan");
}
{
  // course priority decides ties between topics without dates
  const s = { ...PLAN_DEFAULTS, dailyMinutes: 200, maxNew: 5, courseOrder: ["ML Foundations", "CS231n"] };
  const p = buildPlan(base({ settings: s }));
  const nodue = p.sections.new.filter((x) => !/due|overdue/.test(x.reason)).map((x) => x.course?.title);
  eq(nodue[0], "ML Foundations", "priority course first among undated topics");
  const s2 = { ...s, courseOrder: ["CS231n", "ML Foundations"] };
  const p2 = buildPlan(base({ settings: s2 }));
  eq(p2.sections.new.filter((x) => !/due|overdue/.test(x.reason)).map((x) => x.course?.title)[0], "CS231n", "reorder flips it");
}
{
  // budget: 40 min, lesson 30 → continue (45) always, then nothing else fits except as "If you have time"
  const p = buildPlan(base({ settings: { ...PLAN_DEFAULTS, dailyMinutes: 40, maxNew: 2 } }));
  eq(p.sections.new.length, 0, "no lesson fits after continue");
  ok(p.extra.length > 0, "overflow goes to If you have time");
}
{
  // cards due → reviews section with an estimate
  const p = buildPlan(base({ cardsDue: 42 }));
  eq(p.sections.reviews[0].kind, "cards", "cards item");
  eq(p.sections.reviews[0].minutes, Math.ceil((42 * 15) / 60), "15 s per card");
  eq(p.sections.reviews[0].reason, "42 cards due", "cards reason");
}
{
  // rest day (Sunday): only reviews
  const p = buildPlan(base({ today: "2026-11-22", cardsDue: 3 }));
  ok(!p.studyDay, "Sunday is a rest day by default");
  eq(p.sections.new.length + p.sections.continue.length, 0, "no lessons on a rest day");
  eq(p.sections.reviews.length, 1, "reviews still planned");
  ok(buildPlan(base({ today: "2026-11-22", force: true })).sections.continue.length === 1, "force plans anyway");
}
{
  // empty state
  const p = buildPlan(base({ courses: [], lessons: [] }));
  ok(p.noSources, "no sources");
}

// ------------------------------------------------------------------ plan state (log)
{
  const p = buildPlan(base());
  const it = p.sections.new[0];
  let log: PlanLog = markItem(emptyLog(), TODAY, it, "skip");
  const p2 = buildPlan(base({ log }));
  ok(!p2.sections.new.some((x) => x.id === it.id), "skipped item leaves the plan");
  ok(p2.setAside.some((x) => x.id === it.id && x.state === "skip"), "and shows under set aside");
  log = markItem(log, TODAY, it, "done");
  const p3 = buildPlan(base({ log }));
  ok(p3.sections.new.some((x) => x.id === it.id && x.state === "done"), "done item stays visible as done");
  eq(p3.doneMinutes, it.minutes, "done minutes counted");
  // round trip through Markdown
  log.goals = [{ n: 3, kind: "lessons", course: "CS231n" }, { n: 150, kind: "cards", course: null }];
  const md = serializeLog(log);
  ok(md.includes("- 3 lessons · CS231n") && md.includes("- 150 cards"), "goals serialized");
  ok(md.includes(`- done: ${it.title} (${it.minutes} min) ^${it.id}`), "entry serialized");
  ok(!/- \[[ x]\]/.test(md) && !md.includes(" :: "), "log never looks like a task or a flashcard");
  eq(parseLog(md).days[TODAY], log.days[TODAY], "log round trip (days)");
  eq(parseLog(md).goals, log.goals, "log round trip (goals)");
  eq(serializeLog(parseLog(md)), md, "serialize(parse(x)) stable");
  // done but no longer generated (topic now [x] in its roadmap) → still shown from the log, with a target to undo
  const doneCS = CS.replace("- [ ] Data loading", "- [x] Data loading");
  const dl = buildPlan(base()).sections.new.find((x) => x.title === "Data loading")!;
  const p4 = buildPlan(base({ courses: [course("rm-cs", "CS231n", doneCS, 1), course("rm-ml", "ML Foundations", ML, 2)], log: markItem(emptyLog(), TODAY, dl, "done") }));
  const kept = p4.sections.new.find((x) => x.id === dl.id);
  ok(kept && kept.state === "done" && kept.target?.type === "topic", "done-and-finished topic kept with a target");
  // moved to tomorrow → first tomorrow with a reason
  const aug = buildPlan(base({ settings: { ...PLAN_DEFAULTS, dailyMinutes: 300, maxNew: 5 } })).sections.new.find((x) => x.title === "Augmentation")!;
  const p5 = buildPlan(base({ today: "2026-11-20", log: markItem(emptyLog(), TODAY, aug, "later") }));
  eq(p5.sections.new[0]?.title, "Augmentation", "moved item comes first the next day");
  ok(/moved from yesterday/.test(p5.sections.new[0]?.reason ?? ""), `moved reason: ${p5.sections.new[0]?.reason}`);
}

// ------------------------------------------------------------------ learning path: locks, unlocks, revisions, practice
{
  const notes: Note[] = [
    { id: "rm-cs", title: "CS231n roadmap", body: CS, type: "roadmap", spaceId: "s-cs" } as Note,
    { id: "rm-ml", title: "ML roadmap", body: ML, type: "roadmap", spaceId: "s-ml" } as Note,
  ];
  const spaces = [{ id: "s-cs", name: "CS231n", icon: "", roadmapId: "rm-cs" }, { id: "s-ml", name: "ML Foundations", icon: "", roadmapId: "rm-ml" }] as unknown as Space[];
  let body = serializePath({ courses: ["CS231n", "ML Foundations"], title: "AI path", intro: "", stages: [{ name: "Stage 1", concepts: [
    { name: "Image classification", aliases: [], resources: [], notes: [], review: "2026-11-17", interval: 3, done: null, needs: [], extra: [] },
    { name: "Calculus", aliases: [], resources: [], notes: [], review: null, interval: 0, done: null, needs: [], extra: [] },
    { name: "Data loading", aliases: [], resources: [], notes: [], review: null, interval: 0, done: null, needs: ["Calculus"], extra: [] },
  ] }], fm: {} });
  const built = buildPath(body, resolveCourses(["CS231n", "ML Foundations"], notes, spaces));
  const p = buildPlan(base({ paths: [{ noteId: "path", title: "AI path", built }], settings: { ...PLAN_DEFAULTS, dailyMinutes: 200, maxNew: 5 } }));
  ok(!p.sections.new.some((x) => x.title === "Data loading"), "path-level prerequisite locks a topic");
  const rev = p.sections.reviews.find((x) => x.kind === "revision");
  ok(rev && /overdue 2 days/.test(rev.reason), `concept revision due: ${rev?.reason}`);
  const calc = p.sections.new.find((x) => x.title === "Calculus");
  ok(calc && /unlocks 1 concept/.test(calc.reason), `unlocks reason: ${calc?.reason}`);
  ok(p.sections.practice.length <= 1, "at most one practice item");
  body = "";
}

{
  // the same concept taught by two courses is planned once a day
  const A = "## A\n- [ ] Attention\n- [ ] Tokenization\n", B = "## B\n- [ ] Attention\n- [ ] RAG\n";
  const notes = [{ id: "ra", title: "A roadmap", body: A, type: "roadmap", spaceId: "sa" }, { id: "rb", title: "B roadmap", body: B, type: "roadmap", spaceId: "sb" }] as Note[];
  const spaces = [{ id: "sa", name: "A", icon: "", roadmapId: "ra" }, { id: "sb", name: "B", icon: "", roadmapId: "rb" }] as unknown as Space[];
  const body = serializePath({ courses: ["A", "B"], title: "P", intro: "", stages: [], fm: {} });
  const built = buildPath(body, resolveCourses(["A", "B"], notes, spaces));
  const p = buildPlan(base({ courses: [course("ra", "A", A, 1), course("rb", "B", B, 2)], lessons: [], paths: [{ noteId: "p", title: "P", built }], settings: { ...PLAN_DEFAULTS, dailyMinutes: 300, maxNew: 5 } }));
  eq(p.sections.new.filter((x) => x.title === "Attention").length, 1, "shared concept planned once");
}

// ------------------------------------------------------------------ missed days + rescheduling
{
  const s = { ...PLAN_DEFAULTS };
  eq(missedDays(TODAY, s, new Set(["2026-11-16"])), 2, "Tue + Wed missed after Monday");
  eq(missedDays(TODAY, s, new Set(["2026-11-18"])), 0, "yesterday active");
  eq(missedDays(TODAY, s, new Set()), 0, "no history → not 'missed'");
  eq(streak(TODAY, new Set(["2026-11-17", "2026-11-18"])), 2, "streak ends yesterday");
  eq(streak(TODAY, new Set(["2026-11-19", "2026-11-18"])), 2, "streak incl. today");

  const r = proposeReschedule(TODAY, s, courses(), 3);
  eq(r.overdue, 2, "two overdue topics (Optimization, Backpropagation)");
  eq(r.days, ["2026-11-19", "2026-11-20", "2026-11-21"], "next 3 study days");
  const to = Object.fromEntries(r.moves.map((m) => [m.topic, m.to]));
  eq(to["Optimization"], "2026-11-19", "first overdue today");
  eq(to["Backpropagation"], "2026-11-20", "second tomorrow");
  eq(to["Neural networks"], "2026-11-20", "dependent pushed after its prerequisite");
  ok(r.moves.find((m) => m.topic === "Neural networks")?.why === "after prerequisite", "cascade marked");
  eq(r.beforeOverdue, 2, "before: 2 overdue");
  eq(r.after["2026-11-20"], 3, "after: Backprop + Neural networks + Data loading on Fri");
  const out = applyMoves(CS, r.moves.filter((m) => m.courseKey === "rm-cs"));
  const t = Object.fromEntries(roadmap(out).flatMap((m) => m.topics).map((x) => [x.name, x.due]));
  eq(t["Optimization"], "2026-11-19", "Accept writes 📅 into the roadmap");
  eq(t["Backpropagation"], "2026-11-20", "Accept writes 📅 (2)");
  ok(out.includes("→ [[Optimization lecture]]"), "note link kept");
  eq(out.split("\n").length, CS.split("\n").length, "no lines added or lost");
  // Sunday excluded from the spread
  const r2 = proposeReschedule("2026-11-21", s, courses(), 2);
  eq(r2.days, ["2026-11-21", "2026-11-23"], "skips Sunday");
}

// ------------------------------------------------------------------ week
{
  let log = markItem(emptyLog(), "2026-11-17", { id: lessonId("CS231n", "Optimization"), title: "Optimization", minutes: 30 }, "done");
  log = markItem(log, "2026-11-18", { id: lessonId("ML Foundations", "Matrices"), title: "Matrices", minutes: 30 }, "done");
  log = markItem(log, "2026-11-10", { id: lessonId("CS231n", "Old"), title: "Old", minutes: 30 }, "done"); // last week
  log.goals = [{ n: 3, kind: "lessons", course: "CS231n" }, { n: 2, kind: "lessons", course: null }, { n: 100, kind: "cards", course: null }, { n: 120, kind: "minutes", course: null }];
  const w = weekSummary(TODAY, PLAN_DEFAULTS, log, [{ at: "2026-11-16", minutes: 50 }, { at: "2026-11-19", minutes: 25 }, { at: "2026-11-09", minutes: 99 }], 40);
  eq(w.days.map((d) => d.date)[0], "2026-11-16", "week starts Monday");
  eq(w.days.map((d) => d.done), [50, 0, 0, 25, 0, 0, 0], "done minutes per day");
  eq(w.days.map((d) => d.goal), [60, 60, 60, 60, 60, 60, 0], "goal per study day");
  eq(w.goals.map((g) => g.done), [1, 2, 40, 75], "goal progress");
  eq(w.goals[0].label, "3 lessons · CS231n", "goal label");
}

{
  const md = "---\nlumen: study-plan\n---\n# Study plan log\n\nMy intro.\n\n## Goals\n- 2 revisions\nfree text in goals\n\n## 2026-11-19\n- done: X (5 min) ^cards\nnote about the day\n\n## Ideas\n- something else\n";
  const out = serializeLog(parseLog(md));
  ok(out.includes("My intro.") && out.includes("free text in goals") && out.includes("note about the day") && out.includes("## Ideas\n- something else"), "hand-written lines kept:\n" + out);
  eq(serializeLog(parseLog(out)), out, "stable after hand edits");
}
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
