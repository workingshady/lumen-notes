// Smart folders (saved searches) + graph tag links.
// Run: npx tsx scripts/smart-folders.test.ts
import type { Folder, Note, Space } from "../shared/types";
import { parseBase, propsOf, testFilter, type Ctx } from "../src/lib/base";
import { sharedTagEdges, tagMembers, tagNodeEdges } from "../src/lib/graph-tags";
import { moveSmart, orderSmart, parseSmartQuery, readSmart, removeSmart, searchText, serializeSmart, smartNotes, suggestName, toBaseNote, upsertSmart, type SmartCtx } from "../src/lib/smart";

let failed = 0, passed = 0;
function ok(cond: unknown, msg: string) { if (cond) passed++; else { failed++; console.error("FAIL:", msg); } }

const NOW = new Date(2026, 10, 19, 10).getTime();
const DAY = 86400000;
let i = 0;
const note = (p: Partial<Note>): Note => ({ id: "n" + ++i, title: "T" + i, body: "", spaceId: "inbox", folderId: null, tags: [], type: "note", status: null, pinned: 0, favorite: 0, published: 0, slug: "", props: {}, createdAt: NOW - 100 * DAY, updatedAt: NOW - 50 * DAY, deleted: 0, ...p });
const space: Space = { id: "ml", name: "Machine learning", kind: "course", icon: "", color: null, description: "", props: {}, roadmapId: null, sort: 0, archived: 0, createdAt: 0, updatedAt: 0, deleted: 0 };
const folder: Folder = { id: "f1", spaceId: "ml", name: "Week 1", parentId: null, color: null, sort: 0, updatedAt: 0, deleted: 0 };

const notes = [
  note({ title: "Attention", tags: ["llm"], status: "learning", type: "lesson", spaceId: "ml", folderId: "f1", body: "---\ndue: 2026-11-21\n---\n# Attention\nQueries and keys." }),
  note({ title: "Tokenizers", tags: ["llm", "nlp"], status: "mastered", type: "lesson", body: "# Tokenizers\nBPE\n- [ ] read paper" }),
  note({ title: "Old lesson", tags: ["cv"], status: "learning", type: "lesson", body: "---\ndue: 2026-11-01\n---\n# Old\n" }),
  note({ title: "Paper.pdf", type: "pdf", body: "" }),
  note({ title: "Notes on paper", body: "# Notes\nSee [[Paper.pdf]]", updatedAt: NOW - 2 * DAY }),
  note({ title: "الشبكات العصبية", tags: ["llm"], body: "# الشبكات\nالتعلّم العميق" }),
];
const byTitle = new Map(notes.map((n) => [n.title, n]));
const outlinks = new Map<string, string[]>([[byTitle.get("Notes on paper")!.id, [byTitle.get("Paper.pdf")!.id]]]);
const backlinks = new Map<string, string[]>([[byTitle.get("Paper.pdf")!.id, [byTitle.get("Notes on paper")!.id]]]);
const base: Ctx = { spaceName: (id) => (id === "ml" ? "Machine learning" : "Inbox"), folderPath: (id) => (id === "f1" ? "Week 1" : "") };
const ctx: SmartCtx = { folderMap: new Map([["f1", folder]]), spaceMap: new Map([["ml", space]]), outlinks, backlinks, props: propsOf, text: searchText, base, now: NOW };
const titles = (q: string, extra: { filters?: string[]; match?: "and" | "or" } = {}) => smartNotes(notes, { query: q, ...extra }, ctx).map((n) => n.title).sort().join("|");

ok(titles("tag:#llm status:learning") === "Attention", "tag + status: " + titles("tag:#llm status:learning"));
ok(titles("#llm") === "Attention|Tokenizers|الشبكات العصبية", "#tag shorthand");
ok(titles("type:lesson due:week") === "Attention", "due:week");
ok(titles("due:overdue") === "Old lesson", "due:overdue");
ok(titles("type:pdf no:backlinks") === "", "pdf with notes is excluded from 'no notes'");
ok(titles("type:pdf has:backlinks") === "Paper.pdf", "has:backlinks");
ok(titles("has:tasks") === "Tokenizers", "has:tasks");
ok(titles("updated:7d") === "Notes on paper", "updated within 7 days");
ok(titles("space:machine") === "Attention" && titles("in:week") === "Attention", "space: and in:");
ok(titles("queries") === "Attention", "free text in body");
ok(titles("التعلم") === "الشبكات العصبية", "Arabic free text, normalized (shadda)");
ok(titles("", { filters: ['status == "mastered"'] }) === "Tokenizers", "Bases filter row");
ok(titles("type:lesson", { filters: ['status == "mastered"', "file.hasTag(\"cv\")"], match: "or" }) === "Old lesson|Tokenizers", "filter rows with or");
ok(parseSmartQuery('due:week tag:x hello').due[0] === "week" && parseSmartQuery("due:week tag:x hello").base.text === "hello", "parseSmartQuery splits");
ok(suggestName("tag:#llm status:learning") === "#llm · learning", "suggestName: " + suggestName("tag:#llm status:learning"));

// storage round-trip + ordering
let list = upsertSmart([], { id: "a", name: "A", query: "tag:x" });
list = upsertSmart(list, { id: "b", name: "B", query: "type:pdf", pinned: true, color: "red" });
list = upsertSmart(list, { id: "c", name: "C", query: "#y" });
ok(orderSmart(list).map((x) => x.id).join("") === "bac", "pinned first");
const rt = readSmart(serializeSmart(list));
ok(rt.length === 3 && rt[1].pinned && rt[1].color === "red" && rt[0].sort === 0, "serialize/read round-trip");
ok(orderSmart(moveSmart(list, "c", -1)).map((x) => x.id).join("") === "bca", "move up");
ok(orderSmart(moveSmart(list, "a", -1)).map((x) => x.id).join("") === "bac", "cannot move above the pinned group");
ok(removeSmart(list, "a").length === 2, "remove");
ok(readSmart("not json").length === 0 && readSmart(undefined).length === 0, "bad input is empty");
ok(upsertSmart(list, { id: "a", name: "A2", query: "tag:z" }).find((x) => x.id === "a")!.name === "A2", "upsert updates");

// Save as base: the base filters select the same notes (where expressible)
const check = (q: string, extra: { filters?: string[] } = {}) => {
  const { body, dropped } = toBaseNote({ name: "X", query: q, ...extra }, NOW);
  const cfg = parseBase(body).cfg;
  const got = notes.filter((n) => testFilter(cfg.filters, n, base, propsOf(n))).map((n) => n.title).sort().join("|");
  return { got, want: titles(q, extra), dropped, body };
};
for (const q of ["tag:#llm status:learning", "type:lesson", "status:mastered", "in:week", "space:machine"]) {
  const r = check(q);
  ok(r.got === r.want, `base equals smart for "${q}": ${r.got} vs ${r.want}`);
}
const b2 = check("type:pdf no:backlinks is:pinned");
ok(b2.dropped.includes("no:backlinks") && b2.dropped.includes("is:pinned") && b2.body.includes("Not expressible"), "dropped parts reported");
ok(/^---\ntype: base\n---\n# X\n/.test(b2.body) && b2.body.includes("```base\nfilters:"), "base note shape");

// graph tags
const tn = [{ id: "a", tags: ["x", "y"] }, { id: "b", tags: ["x"] }, { id: "c", tags: ["x"] }, { id: "d", tags: ["z"] }];
ok(tagMembers(tn).get("x")!.length === 3, "tagMembers");
const tne = tagNodeEdges(tn);
ok(tne.tags.length === 3 && tne.edges.length === 5, "tag node edges");
const sh = sharedTagEdges(tn, { linked: [["a", "b"]] });
ok(sh.length === 2 && !sh.some((e) => (e.source === "a" && e.target === "b") || (e.source === "b" && e.target === "a")), "shared edges skip linked pairs and single-note tags");
const many = Array.from({ length: 500 }, (_, k) => ({ id: "m" + k, tags: ["big", k % 2 ? "odd" : "even"] }));
const capped = sharedTagEdges(many, { perTag: 24 });
ok(capped.length <= 24 * 3, "edges capped per tag: " + capped.length);
const t0 = performance.now();
const huge = Array.from({ length: 12000 }, (_, k) => ({ id: "h" + k, tags: ["t" + (k % 300), "u" + (k % 17)] }));
const he = sharedTagEdges(huge);
ok(he.length <= 317 * 24, "12k notes edge count bounded: " + he.length);
console.log(`12k-note shared-tag edges in ${(performance.now() - t0).toFixed(0)} ms`);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
