// Pure-logic tests for multi-group bases (lib/base.ts) and dashboards (lib/dashboard.ts).
// Run: npx tsx scripts/dashboards.test.ts
import assert from "node:assert/strict";
import type { Card, Note, Session } from "../shared/types";
import { copiesOf, groupKeysOf, groupRows, moveMessage, parseBase, propsOf, runView, swapValue, writeBase, type Ctx, type Row } from "../src/lib/base";
import {
  addTile, compact, datasetTable, duplicateTile, niceTicks, pack, parseDashboard, parseRange, placeTile, removeTile, runTile, serializeDashboard,
  sourceRecords, stackOrder, writeDashboard, type DashData, type Tile,
} from "../src/lib/dashboard";

let passed = 0;
const test = (name: string, fn: () => void) => { try { fn(); passed++; } catch (e) { console.error(`FAIL ${name}`); throw e; } };

const NOW = new Date(2026, 10, 13, 21, 41).getTime(); // Fri 13 Nov 2026
const DAY = 86_400_000;
let seq = 0;
const note = (p: Partial<Note> & { title: string }): Note => ({
  id: p.id ?? `n${++seq}`, body: p.body ?? `# ${p.title}\n`, spaceId: p.spaceId ?? "s1", folderId: null, tags: p.tags ?? [], type: p.type ?? "note",
  status: p.status ?? null, pinned: 0, favorite: 0, published: 0, slug: "", props: p.props ?? {}, createdAt: p.createdAt ?? NOW - 10 * DAY, updatedAt: p.updatedAt ?? NOW - DAY, deleted: 0, ...p,
} as Note);
const ctx: Ctx = { spaceName: (id) => ({ s1: "CS231n", s2: "fast.ai", rm: "Roadmaps" } as Record<string, string>)[id] ?? id, folderPath: () => "" };
const rows = (ns: Note[]): Row[] => ns.map((n) => ({ n, props: propsOf(n) }));

// ------------------------------------------------------------------ multi-group bases
test("note with several tags appears in each group", () => {
  const ns = [note({ title: "A", tags: ["cv", "llm"] }), note({ title: "B", tags: ["nlp"] }), note({ title: "C" })];
  const gs = groupRows(rows(ns), { property: "file.tags", direction: "ASC" }, ctx);
  assert.deepEqual(gs.map((g) => [g.key.replace("\u0000none", "-"), g.rows.map((r) => r.n.title).join("")]), [["cv", "A"], ["llm", "A"], ["nlp", "B"], ["-", "C"]]);
  const cp = copiesOf(gs);
  assert.deepEqual(cp.get(ns[0].id), ["cv", "llm"]);
  assert.equal(cp.has(ns[1].id), false);
});
test("groupMulti: first keeps only the first value", () => {
  const ns = [note({ title: "A", tags: ["cv", "llm"] })];
  const gs = groupRows(rows(ns), { property: "file.tags", direction: "ASC" }, ctx, { multi: "first" });
  assert.deepEqual(gs.map((g) => g.key), ["cv"]);
  assert.deepEqual(groupKeysOf(rows(ns)[0], { property: "tags", direction: "ASC" }, ctx, "each"), ["cv", "llm"]);
});
test("list front-matter property (courses) groups into each value", () => {
  const n = note({ title: "Backprop", body: "---\ncourses: [CS231n, fast.ai]\n---\n# Backprop\n" });
  const gs = groupRows(rows([n]), { property: "courses", direction: "ASC" }, ctx);
  assert.deepEqual(gs.map((g) => g.key), ["CS231n", "fast.ai"]);
});
test("dragging one copy swaps only that value + toast text", () => {
  assert.deepEqual(swapValue(["cv", "llm"], "cv", "nlp"), ["llm", "nlp"]);
  assert.equal(moveMessage("file.tags", "cv", "nlp", ["cv", "llm"]), "Moved from #cv to #nlp, still in #llm");
  assert.equal(moveMessage("file.tags", "cv", "llm", ["cv", "llm"]), "Removed from #cv, still in #llm");
  assert.equal(moveMessage("courses", "CS231n", "fast.ai", ["CS231n"]), "Moved from CS231n to fast.ai");
});
test("groupMulti is parsed and preserved on rewrite", () => {
  const body = "---\ntype: base\n---\n# B\n\n```base\nviews:\n  - type: board\n    name: Tags\n    groupBy:\n      property: file.tags\n    groupMulti: first\n    custom: kept\n```\n";
  const { cfg } = parseBase(body);
  assert.equal(cfg.views[0].groupMulti, "first");
  cfg.views[0].name = "Renamed";
  const out = writeBase(body, cfg);
  assert.match(out, /groupMulti: first/);
  assert.match(out, /custom: kept/);
  assert.match(out, /name: Renamed/);
  assert.equal(parseBase(out).cfg.views[0].groupMulti, "first");
});
test("existing base query still works (Arabic search, filters)", () => {
  const ns = [note({ title: "الانتشار العكسي", type: "lesson" }), note({ title: "Gradient", type: "lesson" }), note({ title: "Other" })];
  const { cfg } = parseBase('```base\nfilters:\n  and:\n    - type == "lesson"\nviews:\n  - type: table\n    name: T\n```');
  assert.equal(runView(ns, cfg, cfg.views[0], ctx, propsOf).rows.length, 2);
  assert.equal(runView(ns, cfg, cfg.views[0], ctx, propsOf, { search: "العكسي" }).rows.length, 1);
});

// ------------------------------------------------------------------ dashboard format
const DASH = `---
type: dashboard
---
# My dashboard

Some prose.

\`\`\`dashboard
title: kept
tiles:
  - id: mins
    title: Minutes per course
    type: stackedBar
    source: sessions
    x: at
    bucket: week
    y: minutes
    aggregate: sum
    series: course
    range: 4w
    layout: { x: 0, y: 0, w: 8, h: 4 }
  - title: Due
    type: bar
    source: cards
    x: dueOn
    bucket: day
    range: next 14d
  - type: donut
    source: path:Deep
    groupBy: status
    weird: kept
\`\`\`
`;
test("parse dashboard: tiles, defaults, packing, unknown keys", () => {
  const { cfg, error, found } = parseDashboard(DASH);
  assert.equal(error, null); assert.ok(found);
  assert.equal(cfg.tiles.length, 3);
  assert.deepEqual(cfg.tiles[0].layout, { x: 0, y: 0, w: 8, h: 4 });
  assert.equal(cfg.tiles[1].id, "t2");
  assert.deepEqual(cfg.tiles[1].layout, { x: 0, y: 4, w: 6, h: 4 }); // packed under (8 + 6 > 12)
  assert.equal(cfg.tiles[2].x, "status"); // groupBy alias
  assert.equal(cfg.tiles[2].weird, "kept");
});
test("serialize round-trip keeps prose, unknown keys, layout as a flow map", () => {
  const { cfg } = parseDashboard(DASH);
  const out = writeDashboard(DASH, cfg);
  assert.match(out, /^# My dashboard$/m);
  assert.match(out, /Some prose\./);
  assert.match(out, /title: kept/);
  assert.match(out, /layout: \{ x: 0, y: 0, w: 8, h: 4 \}/);
  assert.match(out, /weird: kept/);
  const again = parseDashboard(out).cfg;
  assert.deepEqual(again.tiles.map((t) => [t.id, t.type, t.source, t.layout]), cfg.tiles.map((t) => [t.id, t.type, t.source, t.layout]));
  assert.equal(serializeDashboard(again), serializeDashboard(cfg));
});
test("raw YAML body (no fence) works too; empty body appends a block", () => {
  const body = "# D\n\ntiles:\n  - type: number\n    source: cards\n";
  const { cfg, found } = parseDashboard(body);
  assert.ok(found); assert.equal(cfg.tiles[0].type, "number");
  assert.match(writeDashboard("# New\n", cfg), /```dashboard\ntiles:\n {2}- id: t1/);
});
test("grid: move pushes overlapping tiles down and compacts; add / duplicate / remove", () => {
  const T = (id: string, x: number, y: number, w: number, h: number): Tile => ({ id, type: "bar", source: "cards", layout: { x, y, w, h } });
  let tiles = [T("a", 0, 0, 6, 2), T("b", 6, 0, 6, 2), T("c", 0, 2, 12, 2)];
  tiles = placeTile(tiles, "c", { x: 0, y: 0, w: 6, h: 2 });
  const L = Object.fromEntries(tiles.map((t) => [t.id, t.layout]));
  assert.deepEqual(L.c, { x: 0, y: 0, w: 6, h: 2 });
  assert.deepEqual(L.a, { x: 0, y: 2, w: 6, h: 2 });
  assert.deepEqual(L.b, { x: 6, y: 0, w: 6, h: 2 });
  assert.deepEqual(tiles.map((t) => t.id), ["a", "b", "c"]); // YAML order kept
  // resize clamps to the grid
  assert.deepEqual(placeTile(tiles, "b", { x: 10, y: 0, w: 5, h: 0 }).find((t) => t.id === "b")!.layout, { x: 7, y: 0, w: 5, h: 1 });
  assert.deepEqual(compact([T("z", 0, 5, 4, 2)])[0].layout.y, 0);
  assert.deepEqual(pack([T("p", -1, -1, 4, 2), T("q", -1, -1, 10, 2)]).map((t) => t.layout), [{ x: 0, y: 0, w: 4, h: 2 }, { x: 0, y: 2, w: 10, h: 2 }]);
  const cfg = { columns: 12, tiles };
  const added = addTile(cfg, { type: "number", source: "cards" });
  assert.equal(added.tiles.length, 4); assert.equal(added.tiles[3].id, "t4");
  const dup = duplicateTile(added, "a");
  assert.equal(dup.tiles[1].source, "cards"); assert.notEqual(dup.tiles[1].id, "a");
  assert.equal(removeTile(dup, "a").tiles.length, 4);
  assert.deepEqual(stackOrder(tiles).map((t) => t.id), ["c", "b", "a"]);
});
test("ranges", () => {
  const r = parseRange("2w", NOW)!;
  assert.equal(r.end - r.start, 14 * DAY);
  assert.equal(new Date(r.end).getDate(), 14);
  const n = parseRange("next 14d", NOW)!;
  assert.equal(new Date(n.start).getDate(), 13); assert.equal(n.next, true);
  assert.equal(parseRange("all", NOW), null);
  assert.deepEqual(niceTicks(87), [0, 25, 50, 75, 100]);
});

// ------------------------------------------------------------------ aggregation
const ROADMAP = "## M\n- [x] Vectors\n- [x] Matrices\n- [/] Gradient descent (needs: Matrices)\n- [ ] Backprop (needs: Gradient descent)\n";
const PATH = `---\ntype: path\ncourses: [CS231n]\n---\n# Deep path\n\n## Basics\n- Vectors\n  - review: 2026-11-20 14\n- Matrices\n  - review: 2026-11-10 3\n- Gradient descent\n- Backprop\n`;
function data(): DashData {
  const lesson = note({ id: "l1", title: "Lesson 1", spaceId: "s1", type: "lesson", status: "learning", tags: ["cv", "llm"] });
  const lesson2 = note({ id: "l2", title: "Lesson 2", spaceId: "s2", type: "lesson", status: "review" });
  const rm = note({ id: "rm1", title: "CS231n roadmap", spaceId: "s1", type: "roadmap", body: ROADMAP });
  const path = note({ id: "p1", title: "Deep path", type: "path", body: PATH });
  const sessions: Session[] = [
    { id: "x1", noteId: "l1", minutes: 30, at: NOW - 1 * DAY, updatedAt: 0, deleted: 0 },
    { id: "x2", noteId: "l1", minutes: 20, at: NOW - 2 * DAY, updatedAt: 0, deleted: 0 },
    { id: "x3", noteId: "l2", minutes: 45, at: NOW - 9 * DAY, updatedAt: 0, deleted: 0 },
    { id: "x4", noteId: "l2", minutes: 15, at: NOW - 40 * DAY, updatedAt: 0, deleted: 0 },
    { id: "x5", noteId: "l2", minutes: 99, at: NOW - 3 * DAY, updatedAt: 0, deleted: 1 },
  ];
  const card = (id: string, due: number, p: Partial<Card> = {}): Card => ({ id, noteId: "l1", ease: 2.5, interval: 3, due, reps: 2, lapses: 0, updatedAt: 0, deleted: 0, ...p });
  const cards = [card("c1", NOW - 2 * DAY), card("c2", NOW + 1 * DAY), card("c3", NOW + 1 * DAY + 3600_000), card("c4", NOW + 30 * DAY), card("c5", 0, { reps: 0, interval: 0 }), card("c6", NOW, { suspended: 1 })];
  return { notes: [lesson, lesson2, rm, path], cards, sessions, spaces: [{ id: "s1", name: "CS231n", icon: "", color: "5", roadmapId: "rm1" }, { id: "s2", name: "fast.ai", icon: "", color: "2", roadmapId: null }], ctx, now: NOW };
}
const tile = (p: Partial<Tile>): Tile => ({ id: "t", type: "bar", source: "cards", layout: { x: 0, y: 0, w: 6, h: 4 }, ...p });

test("sessions: minutes per course per week (stacked), deleted ignored, zero-filled buckets", () => {
  const r = runTile(tile({ type: "stackedBar", source: "sessions", x: "at", bucket: "week", y: "minutes", aggregate: "sum", series: "course", range: "4w" }), data());
  assert.equal(r.data.kind, "series");
  if (r.data.kind !== "series") return;
  assert.ok(r.data.categories.length >= 4 && r.data.categories.length <= 5);
  const cs = r.data.series.find((s) => s.key === "CS231n")!;
  const fa = r.data.series.find((s) => s.key === "fast.ai")!;
  assert.equal(cs.values.reduce((a, b) => a + b, 0), 50);
  assert.equal(fa.values.reduce((a, b) => a + b, 0), 45); // 15 min is 40 days ago, 99 is deleted
  assert.equal(cs.color, "var(--chart-c5)"); // the space's canvas color
  assert.equal(r.data.unit, "min");
  const tbl = datasetTable(r.data);
  assert.deepEqual(tbl.columns, ["At", "CS231n", "fast.ai"]);
});
test("cards: due per day for the next 14 days (overdue counts today, new + suspended excluded)", () => {
  const r = runTile(tile({ type: "bar", source: "cards", x: "dueOn", bucket: "day", range: "next 14d" }), data());
  if (r.data.kind !== "series") throw new Error("kind");
  assert.equal(r.data.categories.length, 14);
  assert.deepEqual(r.data.series[0].values.slice(0, 3), [1, 2, 0]);
  assert.equal(r.data.total, 3);
});
test("cards by state (donut) and record fields", () => {
  const r = runTile(tile({ type: "donut", source: "cards", x: "state" }), data());
  if (r.data.kind !== "series") throw new Error("kind");
  assert.deepEqual(r.data.categories.map((c) => c.key), ["new", "review", "suspended"]);
  assert.deepEqual(r.data.series[0].values, [1, 4, 1]);
});
test("number tile with delta vs previous period", () => {
  const r = runTile(tile({ type: "number", source: "sessions", y: "minutes", aggregate: "sum", range: "7d" }), data());
  assert.deepEqual(r.data, { kind: "number", value: 50, prev: 45, vs: "vs last week", yLabel: "Minutes", unit: "min" });
});
test("path: concept statuses, mastered count, learned over time (cumulative)", () => {
  const d = data();
  const { recs, error } = sourceRecords({ source: "path:Deep path" }, d);
  assert.equal(error, null);
  const by = Object.fromEntries(recs.map((r) => [r.concept, r.status]));
  assert.deepEqual(by, { Vectors: "mastered", Matrices: "learned", "Gradient descent": "learning", Backprop: "locked" });
  const m = runTile(tile({ type: "number", source: "path:Deep path", filter: "mastered == true" }), d);
  assert.equal(m.data.kind === "number" && m.data.value, 1);
  const donut = runTile(tile({ type: "donut", source: "path", x: "status" }), d);
  if (donut.data.kind !== "series") throw new Error("kind");
  assert.deepEqual(donut.data.categories.map((c) => c.key), ["locked", "learning", "learned", "mastered"]);
  const over = runTile(tile({ type: "line", source: "path:Deep path", x: "learnedOn", bucket: "week", range: "4w", cumulative: true }), d);
  if (over.data.kind !== "series") throw new Error("kind");
  const v = over.data.series[0].values;
  assert.equal(v[v.length - 1], 2); // both learned concepts (learned 6 Nov and 7 Nov), running total
  assert.ok(v.every((x, i) => i === 0 || x >= v[i - 1]));
  const ring = runTile(tile({ type: "ring", source: "path", part: "learned == true" }), d);
  assert.deepEqual(ring.data.kind === "ring" && [ring.data.value, ring.data.total], [2, 4]);
  assert.match(sourceRecords({ source: "path:Nope" }, d).error ?? "", /No learning path/);
});
test("notes source with a Bases filter, multi-value x, table rows", () => {
  const d = data();
  const r = runTile(tile({ type: "bar", source: "notes", filter: 'type == "lesson"', x: "tags" }), d);
  if (r.data.kind !== "series") throw new Error("kind");
  assert.deepEqual(r.data.categories.map((c) => c.label), ["cv", "llm", "No tags"]);
  const t = runTile(tile({ type: "table", source: "notes", filter: 'type == "lesson"', fields: ["title", "status", "space"], sort: "title" }), d);
  assert.deepEqual(t.data.kind === "rows" && t.data.rows.map((x) => x.cells), [["Lesson 1", "learning", "CS231n"], ["Lesson 2", "review", "fast.ai"]]);
});
test("base source: runs a base view", () => {
  const d = data();
  d.notes.push(note({ id: "b1", title: "Lessons", type: "base", body: '# Lessons\n\n```base\nfilters:\n  and:\n    - type == "lesson"\nviews:\n  - type: board\n    name: By status\n    groupBy:\n      property: status\n```\n' }));
  const r = runTile(tile({ type: "donut", source: "base:Lessons", view: "By status", x: "status" }), d);
  if (r.data.kind !== "series") throw new Error("kind");
  assert.deepEqual(r.data.categories.map((c) => c.key), ["learning", "review"]);
  assert.equal(runTile(tile({ source: "base:Missing" }), d).error, 'No base called "Missing"');
});
test("heatmap defaults: day buckets over 20 weeks", () => {
  const r = runTile(tile({ type: "heatmap", source: "sessions", y: "minutes" }), data());
  if (r.data.kind !== "series") throw new Error("kind");
  assert.ok(r.data.categories.length >= 140 && r.data.categories.length <= 141);
  assert.equal(r.data.series[0].values.reduce((a, b) => a + b, 0), 110);
});

console.log(`dashboards: ${passed} tests passed`);
