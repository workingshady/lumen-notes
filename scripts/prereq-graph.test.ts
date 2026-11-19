// Tests for prerequisite-graph logic (round 4, 14b): implied links, link checks, edge paths, untangle, link-type formats.
// Run: npx tsx scripts/prereq-graph.test.ts
import { checkLink, crossings, edgePath, impliedLinks, linkMessage, needPath, untangle } from "../src/lib/prereq-graph";
import { roadmap, setTopicLink, renameTopic } from "../src/lib/parse";
import { buildPath, parsePath, serializePath, setConceptLink, pathLinkKind, graphLayout } from "../src/lib/path";

let failed = 0, passed = 0;
const ok = (c: unknown, m: string) => { if (c) passed++; else { failed++; console.error("FAIL:", m); } };

// la → gd → bp, calc → gd, la → bp (implied), bp → att, la → att (implied)
const G: Record<string, string[]> = { la: [], calc: [], gd: ["la", "calc"], bp: ["gd", "la", "calc"], att: ["bp", "la"], tb: ["att"] };
const needs = (k: string) => G[k] ?? [];
const imp = impliedLinks(Object.keys(G), needs);
ok(imp.has("la>bp") && imp.has("calc>bp") && imp.has("la>att") && !imp.has("gd>bp") && !imp.has("bp>att"), `implied links ${[...imp]}`);
ok(imp.size === 3, "exactly the transitive-reduction extras");
ok(JSON.stringify(needPath(needs, "tb", "la")) === JSON.stringify(["tb", "att", "la"]), "shortest need chain");

ok(checkLink(needs, "bp", "la").kind === "loop", "la needing bp is a loop");
const loop = checkLink(needs, "bp", "la");
ok(loop.kind === "loop" && loop.chain.join(">") === "bp>gd>la", "loop chain names the path");
const nm = (k: string) => ({ la: "Linear algebra", gd: "Gradient descent", bp: "Backpropagation", att: "Attention", tb: "Transformer block", calc: "Calculus" } as Record<string, string>)[k];
ok(linkMessage(loop, nm, "bp", "la")!.body === "Linear algebra is already needed (through Gradient descent) to reach Backpropagation.", "loop message (14b-I)");
const red = checkLink(needs, "gd", "tb");
ok(red.kind === "implied" && linkMessage(red, nm, "gd", "tb")!.title === "Already implied", "implied warning (14b-J)");
ok(checkLink(needs, "bp", "att").kind === "duplicate", "duplicate (14b-K)");
ok(checkLink(needs, "calc", "calc").kind === "self", "self");
ok(checkLink({ ...G, x: [] } && ((k: string) => ({ ...G, x: [] } as Record<string, string[]>)[k] ?? []), "x", "tb").kind === "valid", "valid (14b-H)");

// edge paths
ok(edgePath("curved", 0, 0, 100, 50).d === "M0 0C50 0 50 50 100 50", "curved");
ok(edgePath("straight", 0, 0, 100, 0).d === "M0 0L100 0", "straight");
ok(edgePath("elbow", 0, 0, 100, 40).d.startsWith("M0 0H40Q50 0 50 10V30"), "elbow");
ok(edgePath("curved", 0, 0, 300, 50, { bundleAt: 200 }).d.includes("L263"), "bundled goes through the gutter");
ok(edgePath("curved", 0, 0, 50, 100, { vertical: true }).d === "M0 0C0 50 50 50 50 100", "vertical = rotated curve");

// untangle reduces crossings
const cols = [["a", "b"], ["y", "x"]];
const NB: Record<string, string[]> = { x: ["a"], y: ["b"] }, UP: Record<string, string[]> = { a: ["x"], b: ["y"] };
const u = untangle(cols, (k) => NB[k] ?? [], (k) => UP[k] ?? []);
const pos = (o: string[][]) => (k: string) => { for (let c = 0; c < o.length; c++) { const r = o[c].indexOf(k); if (r >= 0) return { x: c * 100, y: r * 50 }; } };
ok(crossings([["a", "x"], ["b", "y"]], pos(cols)) === 1 && crossings([["a", "x"], ["b", "y"]], pos(u)) === 0, `untangle removes the crossing ${JSON.stringify(u)}`);

// roadmap link types
const md = "## M\n- [x] A\n- [ ] B (needs: A) 📅 2026-12-01\n- [ ] C\n";
let m2 = setTopicLink(md, 2, "A", "after");
ok(m2.includes("- [ ] B (after: A) 📅 2026-12-01"), `needs → after rewrites one link: ${m2}`);
const t = roadmap(m2)[0].topics[1];
ok(t.name === "B" && t.needs.length === 0 && t.after?.[0] === "A" && !t.locked, "after parsed, never locks, name clean");
m2 = setTopicLink(m2, 3, "B", "related");
ok(roadmap(m2)[0].topics[2].related?.[0] === "B", "related parsed");
ok(renameTopic(m2, 1, "Alpha").includes("(after: Alpha)"), "rename follows after: links");
ok(setTopicLink(m2, 2, "A", null).split("\n")[2] === "- [ ] B 📅 2026-12-01", "remove link");

// path link types
const body = "---\ntype: path\ncourses: []\n---\n# P\n\n## S1\n- Alpha\n- Beta\n  - needs: Alpha\n";
const p = buildPath(body, []);
const b2 = setConceptLink(body, p.byKey.get("beta")!, p.byKey.get("alpha")!, "related");
ok(/- related: Alpha/.test(b2) && !/needs:/.test(b2), `path type change: ${b2}`);
const p2 = buildPath(b2, []);
ok(p2.byKey.get("beta")!.related[0] === "alpha" && p2.byKey.get("beta")!.needs.length === 0 && pathLinkKind(p2.byKey.get("beta")!, p2.byKey.get("alpha")!) === "related", "built related");
ok(serializePath(parsePath(b2)) === b2, "round-trip with related:");
ok(graphLayout(p, () => true, new Set(), { byStage: false }).cols.length === 0, "ungrouped layout has no stage columns");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
