// Round-trip tests for the drag & drop Markdown rewrites (roadmaps + learning paths).
// Run: npx tsx scripts/dnd-roundtrip.test.ts
import {
  addModule, addTopic, addTopicNeed, deleteModule, deleteTopic, moveModule, moveTopic, nudgeModule, nudgeTopic, removeTopicNeed,
  renameModule, renameTopic, roadmap, setTopicStatus, type Module,
} from "../src/lib/parse";
import {
  addConcept, addConceptNeed, buildPath, mergeConcepts, moveAlias, nudgeConcept, parsePath, pathNeeds, placeConcept, removeConcept,
  removeConceptNeed, reorderStage, serializePath, wouldCycle, type CourseRef,
} from "../src/lib/path";
import type { Note } from "../shared/types";

let failed = 0, passed = 0;
function ok(cond: unknown, msg: string) { if (cond) passed++; else { failed++; console.error("FAIL:", msg); } }
/** Stable stringify: object keys sorted, so maps compare by content, not insertion order. */
const stable = (x: unknown): string => JSON.stringify(x, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
function eq<T>(a: T, b: T, msg: string) { const A = stable(a), B = stable(b); ok(A === B, `${msg}\n   got:      ${A}\n   expected: ${B}`); }

// ------------------------------------------------------------------ roadmap
const RM = `---
type: roadmap
---
# Deep learning course

Intro paragraph stays.

## Basics 📅 2026-12-01
- [x] Python → [[Python crash]]
- [/] NumPy (needs: Python) 📅 2026-11-20 → [[NumPy note]]
  - a sub-line note that belongs to NumPy
- [ ] Plotting

## Models
- [ ] Linear regression (needs: NumPy, Plotting) 📅 2026-12-10
- [-] Skipped thing
- [ ] Logistic regression (needs: Linear regression) → [[Logit|alias]]

## Empty module
`;

/** Everything that must survive: per topic name its status, needs, due, note, and the set of topic names. */
const snap = (md: string) => {
  const all = roadmap(md).flatMap((m) => m.topics);
  return Object.fromEntries(all.map((t) => [t.name, { s: t.status, n: [...t.needs].sort(), d: t.due, note: t.note }]));
};
const order = (mods: Module[]) => mods.map((m) => `${m.name}: ${m.topics.map((t) => t.name).join(", ")}`);
const lineOf = (md: string, name: string) => roadmap(md).flatMap((m) => m.topics).find((t) => t.name === name)!.line;
const base = snap(RM);

{ // move a topic within a module
  const md = moveTopic(RM, lineOf(RM, "Plotting"), 0, lineOf(RM, "Python"));
  eq(order(roadmap(md))[0], "Basics 📅 2026-12-01".replace(/ 📅.*/, "") + ": Plotting, Python, NumPy", "reorder within module");
  eq(snap(md), base, "reorder keeps all topic data");
  ok(md.includes("- [/] NumPy (needs: Python) 📅 2026-11-20 → [[NumPy note]]\n  - a sub-line note that belongs to NumPy"), "sub-line travels with its topic");
  ok(md.includes("Intro paragraph stays."), "intro kept");
}
{ // move between modules (with sub-line), to end and before a topic
  const md = moveTopic(RM, lineOf(RM, "NumPy"), 1, null);
  eq(order(roadmap(md)).slice(0, 2), ["Basics: Python, Plotting", "Models: Linear regression, Skipped thing, Logistic regression, NumPy"], "move to end of other module");
  eq(snap(md), base, "move between modules keeps data");
  ok(/- \[\/\] NumPy[^\n]*\n  - a sub-line note/.test(md), "sub-line moved too");
  const md2 = moveTopic(RM, lineOf(RM, "Logistic regression"), 0, lineOf(RM, "NumPy"));
  eq(order(roadmap(md2))[0], "Basics: Python, Logistic regression, NumPy, Plotting", "move before a topic in another module");
  eq(snap(md2), base, "data kept (2)");
  const md3 = moveTopic(RM, lineOf(RM, "Python"), 2, null);
  eq(order(roadmap(md3))[2], "Empty module: Python", "move into an empty module");
  eq(snap(md3), base, "data kept (3)");
}
{ // nudge (keyboard)
  let md = nudgeTopic(RM, lineOf(RM, "Python"), 1);
  eq(order(roadmap(md))[0], "Basics: NumPy, Python, Plotting", "alt+down");
  md = nudgeTopic(md, lineOf(md, "Plotting"), 1);
  eq(order(roadmap(md)).slice(0, 2), ["Basics: NumPy, Python", "Models: Plotting, Linear regression, Skipped thing, Logistic regression"], "alt+down crosses into next module");
  md = nudgeTopic(md, lineOf(md, "Plotting"), -1);
  eq(order(roadmap(md))[0], "Basics: NumPy, Python, Plotting", "alt+up back");
  eq(snap(md), base, "nudges keep data");
  eq(nudgeTopic(RM, lineOf(RM, "Python"), -1), RM, "alt+up at the very top is a no-op");
}
{ // modules
  const md = moveModule(RM, 1, 0);
  eq(roadmap(md).map((m) => m.name), ["Models", "Basics", "Empty module"], "module before another");
  eq(snap(md), base, "module move keeps data");
  eq(roadmap(md).find((m) => m.name === "Basics")!.due, "2026-12-01", "module due kept");
  const md2 = moveModule(RM, 0, null);
  eq(roadmap(md2).map((m) => m.name), ["Models", "Empty module", "Basics"], "module to end");
  eq(snap(md2), base, "module to end keeps data");
  eq(roadmap(moveModule(md2, 2, 0)).map((m) => m.name), ["Basics", "Models", "Empty module"], "and back");
  eq(roadmap(nudgeModule(RM, 0, 1)).map((m) => m.name), ["Models", "Basics", "Empty module"], "nudge module down");
  eq(roadmap(nudgeModule(RM, 2, -1)).map((m) => m.name), ["Basics", "Empty module", "Models"], "nudge module up");
  ok(md2.startsWith("---\ntype: roadmap\n---\n# Deep learning course\n\nIntro paragraph stays."), "front-matter + title untouched");
  eq(roadmap(renameModule(RM, 0, "Foundations")).map((m) => [m.name, m.due]), [["Foundations", "2026-12-01"], ["Models", null], ["Empty module", null]], "rename module keeps date");
  const del = deleteModule(RM, 0);
  eq(roadmap(del).map((m) => m.name), ["Models", "Empty module"], "delete module");
  eq(roadmap(del)[0].topics[0].needs, [], "deleted topics dropped from needs");
}
{ // add topic / module, needs, rename, delete
  let md = addTopic(RM, 1, "Softmax", { note: "Softmax note" });
  eq(order(roadmap(md))[1], "Models: Linear regression, Skipped thing, Logistic regression, Softmax", "add topic at end");
  eq(roadmap(md)[1].topics[3].note, "Softmax note", "added with note link");
  md = addTopic(md, 0, "Pandas", { beforeLine: lineOf(md, "Plotting") });
  eq(order(roadmap(md))[0], "Basics: Python, NumPy, Pandas, Plotting", "add topic before");
  md = addModule(md, "Deep nets", [{ name: "MLP", note: "MLP" }]);
  eq(roadmap(md).map((m) => m.name).at(-1), "Deep nets", "add module");
  md = addTopicNeed(md, lineOf(md, "MLP"), lineOf(md, "Softmax"));
  eq(roadmap(md).at(-1)!.topics[0].needs, ["Softmax"], "add need");
  eq(roadmap(md).at(-1)!.topics[0].note, "MLP", "need inserted before the note link");
  eq(addTopicNeed(md, lineOf(md, "Python"), lineOf(md, "Logistic regression")), md, "cycle refused");
  md = removeTopicNeed(md, lineOf(md, "Linear regression"), "plotting");
  eq(roadmap(md)[1].topics[0].needs, ["NumPy"], "remove need (case-insensitive)");
  md = renameTopic(md, lineOf(md, "NumPy"), "NumPy arrays");
  eq(roadmap(md)[1].topics[0].needs, ["NumPy arrays"], "rename updates needs");
  const np = roadmap(md)[0].topics.find((t) => t.name === "NumPy arrays")!;
  eq([np.status, np.due, np.note, np.needs], ["learning", "2026-11-20", "NumPy note", ["Python"]], "rename keeps the rest of the line");
  md = deleteTopic(md, lineOf(md, "NumPy arrays"));
  ok(!md.includes("a sub-line note"), "delete removes sub-lines");
  eq(roadmap(md)[1].topics[0].needs, [], "delete removes it from needs");
  md = setTopicStatus(md, lineOf(md, "Plotting"), "done");
  eq(roadmap(md)[0].topics.find((t) => t.name === "Plotting")!.status, "done", "status still settable");
}
{ // create a roadmap from scratch (empty body → modules + note topics)
  let md = "---\ntype: roadmap\n---\n# New roadmap\n";
  eq(roadmap(md).length, 0, "empty roadmap");
  md = addModule(md, "Module 1");
  md = addTopic(md, 0, "Lesson A", { note: "Lesson A" });
  md = addTopic(md, 0, "Lesson B", { note: "Lesson B" });
  md = addTopic(md, null, "Loose");
  eq(order(roadmap(md)), ["Module 1: Lesson A, Lesson B", "Topics: Loose"], "built from scratch");
  ok(md.startsWith("---\ntype: roadmap\n---\n# New roadmap\n\n## Module 1\n- [ ] Lesson A → [[Lesson A]]"), "scratch markdown shape");
}

// ------------------------------------------------------------------ learning path
const PATH = `---
type: path
courses: [Course A, Course B]
---
# DL path
Intro text.

## Stage 1 · Foundations
- Linear algebra = Vectors | Matrices
  - needs: Calculus
  - resource: [3B1B](https://youtu.be/x)
  - note: [[Eigen]], [[SVD]]
  - review: 2026-11-20 7
  - custom: kept line
- Calculus
  - done: 2026-11-01

## Stage 2 · Core
- Backprop = Backpropagation
- Gradient descent
`;
const pdata = (body: string) => Object.fromEntries(parsePath(body).stages.flatMap((s) => s.concepts.map((c) => [c.name, { ...c }])));
{
  const d = parsePath(PATH);
  eq(d.stages[0].concepts[0].needs, ["Calculus"], "needs parsed");
  eq(d.stages[0].concepts[0].extra, ["  - custom: kept line"], "unknown sub-lines kept");
  const s1 = serializePath(d);
  eq(serializePath(parsePath(s1)), s1, "serialize is idempotent");
  eq(pdata(s1), pdata(PATH), "round trip keeps aliases, needs, resources, notes, review, done, extra");
  ok(s1.includes("  - needs: Calculus"), "needs written as a sub-line");
}
const mkNote = (title: string, body: string): Note => ({ id: title, title, body, type: "roadmap", spaceId: "s", deleted: 0 } as unknown as Note);
const courses: CourseRef[] = [
  { key: "Course A", title: "Course A", note: mkNote("Course A", "## M\n- [x] Vectors\n- [ ] Matrices (needs: Vectors)\n- [ ] Backpropagation (needs: Matrices)\n- [ ] Dropout\n"), color: "#f00", spaceName: "A", spaceIcon: "A", spaceId: null },
  { key: "Course B", title: "Course B", note: mkNote("Course B", "## M\n- [ ] Gradient descent\n- [ ] Backprop\n- [ ] Regularization\n"), color: "#0f0", spaceName: "B", spaceIcon: "B", spaceId: null },
];
{
  const p = buildPath(PATH, courses);
  const la = p.byKey.get("linear algebra")!, calc = p.byKey.get("calculus")!, gd = p.byKey.get("gradient descent")!, bp = p.byKey.get("backprop")!;
  ok(la.needs.includes("calculus"), "path-level needs are part of buildPath's needs");
  ok(calc.unlocks.includes("linear algebra"), "and unlocks");
  ok(pathNeeds(la, calc), "pathNeeds sees the written need");
  ok(bp.needs.includes("linear algebra"), "course-level needs still merged (Backpropagation needs Matrices → Linear algebra)");
  ok(!pathNeeds(bp, la), "course-level need is not a path need");
  ok(wouldCycle(p, calc, la), "cycle detected");
  ok(!wouldCycle(p, gd, calc), "no false cycle");

  let b = addConceptNeed(PATH, gd, calc);
  ok(buildPath(b, courses).byKey.get("gradient descent")!.needs.includes("calculus"), "add concept need");
  eq(addConceptNeed(b, gd, calc), b, "adding twice is a no-op");
  b = removeConceptNeed(b, gd, calc);
  eq(b, serializePath(parsePath(PATH)), "remove concept need restores the document");
  const b2 = removeConceptNeed(PATH, la, calc);
  ok(!buildPath(b2, courses).byKey.get("linear algebra")!.needs.includes("calculus"), "remove written need");

  // reorder within a stage, across stages, unplaced → stage
  let r = placeConcept(PATH, calc, "Stage 1 · Foundations", "linear algebra");
  eq(parsePath(r).stages[0].concepts.map((c) => c.name), ["Calculus", "Linear algebra"], "reorder within stage");
  eq(pdata(r), pdata(PATH), "reorder keeps data");
  r = placeConcept(PATH, la, "Stage 2 · Core", "gradient descent");
  eq(parsePath(r).stages.map((s) => s.concepts.map((c) => c.name)), [["Calculus"], ["Backprop", "Linear algebra", "Gradient descent"]], "move between stages at a position");
  eq(pdata(r), pdata(PATH), "move keeps data");
  const dropout = p.byKey.get("dropout")!;
  ok(!dropout.placed, "Dropout starts unplaced");
  r = placeConcept(PATH, dropout, "Stage 2 · Core", "backprop");
  eq(parsePath(r).stages[1].concepts.map((c) => c.name), ["Dropout", "Backprop", "Gradient descent"], "unplaced placed at a position");
  eq(nudgeConcept(PATH, gd, -1), placeConcept(PATH, gd, "Stage 2 · Core", "backprop"), "nudge up = place before previous");
  eq(parsePath(reorderStage(PATH, "Stage 2 · Core", "Stage 1 · Foundations")).stages.map((s) => s.name), ["Stage 2 · Core", "Stage 1 · Foundations"], "reorder stages");
  eq(pdata(reorderStage(PATH, "Stage 2 · Core", "Stage 1 · Foundations")), pdata(PATH), "stage reorder keeps data");
  eq(parsePath(reorderStage(PATH, "Stage 1 · Foundations", null)).stages.map((s) => s.name), ["Stage 2 · Core", "Stage 1 · Foundations"], "stage to end");

  // add / remove concepts
  r = addConcept(PATH, "Stage 2 · Core", "Attention", { note: "Attention note", beforeKey: "backprop" });
  eq(parsePath(r).stages[1].concepts.map((c) => [c.name, c.notes]), [["Attention", ["Attention note"]], ["Backprop", []], ["Gradient descent", []]], "add concept from a note");
  eq(addConcept(PATH, "Stage 2 · Core", "matrices"), serializePath(parsePath(PATH)), "can't add an existing alias as a new concept");
  r = removeConcept(PATH, gd);
  ok(!buildPath(r, courses).byKey.get("gradient descent")!.placed, "removed concept goes back to Not placed yet");

  // alias moves: course topic from one concept to another; merges
  r = moveAlias(PATH, "Matrices", calc, la);
  const q = buildPath(r, courses);
  eq(q.byKey.get("linear algebra")!.def.aliases, ["Vectors"], "alias removed from source");
  eq(q.byKey.get("calculus")!.coverage.map((x) => x.topic.name), ["Matrices"], "topic now covered by target");
  r = moveAlias(PATH, "Regularization", la, p.byKey.get("regularization"));
  eq(buildPath(r, courses).byKey.get("linear algebra")!.coverage.map((x) => x.topic.name), ["Vectors", "Matrices", "Regularization"], "unplaced topic dropped onto a concept becomes an alias");
  r = mergeConcepts(PATH, la, calc);
  const m = parsePath(r).stages[0].concepts;
  eq(m.map((c) => c.name), ["Linear algebra"], "merge removes the other concept");
  eq([m[0].aliases, m[0].needs, m[0].done, m[0].resources.length, m[0].notes, m[0].review, m[0].extra], [["Vectors", "Matrices", "Calculus"], [], "2026-11-01", 1, ["Eigen", "SVD"], "2026-11-20", ["  - custom: kept line"]], "merge keeps data and drops self-needs");
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} failing`);
