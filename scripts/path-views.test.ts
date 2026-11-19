// Tests for the learning-path view helpers (filters, focus chain, graph layout, course kinds, abbreviations).
// Run: npx tsx scripts/path-views.test.ts
import { abbrevCourse, buildPath, conceptState, courseKind, filterCount, focusChain, graphLayout, matchesFilter, NO_FILTER, nextInterval, overlapReason, resolveCourses } from "../src/lib/path";
import type { Note } from "../shared/types";

let failed = 0, passed = 0;
const ok = (c: unknown, m: string) => { if (c) passed++; else { failed++; console.error("FAIL:", m); } };

const mk = (id: string, title: string, body: string): Note => ({ id, title, body, type: "roadmap", spaceId: "s-" + id, deleted: 0 } as unknown as Note);
const A = mk("a", "Course A", "## M1\n- [x] Vectors\n- [/] Gradient descent (needs: Vectors)\n- [ ] Backprop (needs: Gradient descent)\n");
const B = mk("b", "Course B", "## L1\n- [x] Vectors\n- [ ] Attention (needs: Backprop)\n");
const spaces = [
  { id: "s-a", name: "Course A", icon: "", roadmapId: "a", color: "6", props: { provider: "Stanford · YouTube" } },
  { id: "s-b", name: "Course B", icon: "", roadmapId: "b", color: null, props: { format: "book" } },
];
const refs = resolveCourses(["Course A", "Course B"], [A, B], spaces);
ok(refs[0].color === "#A371F7" && refs[0].kind === "lecture", "space colour preset + kind guessed from provider");
ok(refs[1].kind === "book" && refs[1].color.startsWith("#"), "explicit format prop wins");
ok(courseKind({ provider: "fast.ai" }) === "notebook" && courseKind({ provider: "Udemy" }) === "video", "kind guesses");

const PATH = "---\ntype: path\ncourses: [Course A, Course B]\n---\n# P\n\n## Stage 1 · Basics\n- Vectors\n- Gradient descent\n## Stage 2 · Deep\n- Backprop\n- Attention\n- Own idea\n  - needs: Backprop\n";
const p = buildPath(PATH, refs);
const get = (k: string) => p.byKey.get(k)!;
ok(conceptState(get("vectors")) === "learned" && conceptState(get("gradient descent")) === "learning" && conceptState(get("attention")) === "locked", "concept states");
ok(matchesFilter(get("vectors"), { ...NO_FILTER, overlapping: true }) && !matchesFilter(get("backprop"), { ...NO_FILTER, overlapping: true }), "only overlapping");
ok(matchesFilter(get("attention"), { ...NO_FILTER, courses: ["Course B"] }) && !matchesFilter(get("backprop"), { ...NO_FILTER, courses: ["Course B"] }), "course filter");
ok(matchesFilter(get("attention"), { ...NO_FILTER, states: ["locked"] }) && !matchesFilter(get("vectors"), { ...NO_FILTER, states: ["locked"] }), "status filter");
ok(!matchesFilter(get("vectors"), { ...NO_FILTER, stages: ["Stage 2 · Deep"] }), "stage filter");
ok(filterCount({ ...NO_FILTER, courses: ["x"], revise: true }) === 2, "filter count");
const ch = focusChain(p, "backprop");
ok(["vectors", "gradient descent", "backprop", "attention", "own idea"].every((k) => ch.has(k)), "focus chain: ancestors + descendants");
ok(!focusChain(p, "attention").has("own idea"), "chain excludes siblings");
const L = graphLayout(p, () => true, new Set());
const x = (k: string) => L.nodes.find((n) => n.key === k)!.x;
ok(L.cols.length === 2 && x("gradient descent") > x("vectors") && x("backprop") < x("attention") && x("attention") === x("own idea"), "graph: stage columns, sub-columns by depth");
const L2 = graphLayout(p, () => true, new Set(["Stage 2 · Deep"]));
ok(L2.cols[1].collapsed && L2.summary.get("attention") === "stage:Stage 2 · Deep" && !L2.nodes.some((n) => n.key === "attention"), "graph: collapsed stage → summary node");
ok(graphLayout(p, (c) => c.key !== "vectors", new Set()).nodes.every((n) => n.key !== "vectors"), "graph: filter applies");
ok(abbrevCourse("Coursera DL Specialization") === "DL Spec" && abbrevCourse("HOML (Géron)") === "HOML" && abbrevCourse("A very long course name indeed").endsWith("…"), "abbreviations");
ok(nextInterval({ ...get("vectors"), def: { ...get("vectors").def, interval: 7 } }) === 14, "next interval");
ok(typeof overlapReason(get("vectors"), get("backprop")) === "string", "overlap reason");
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
