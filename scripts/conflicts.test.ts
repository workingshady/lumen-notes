// Sync conflicts (src/lib/conflicts-core.ts) + the word diff (src/lib/versions-diff.ts).
// Run: npx tsx scripts/conflicts.test.ts
import { blocksDiffer, mergeBlocks, overwritesLocal, resolvedText, segments, type ConflictRec } from "../src/lib/conflicts-core";
import { diffLines, restoreRows, statOf } from "../src/lib/versions-diff";

let failed = 0, passed = 0;
function ok(cond: unknown, msg: string) { if (cond) passed++; else { failed++; console.error("FAIL:", msg); } }
const eq = <T,>(a: T, b: T, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);

// --- detection
const local = { type: "note", body: "mine", dirty: 1 as const, updatedAt: 100 };
const pull = (body: string, updatedAt = 200, extra = {}) => ({ data: { type: "note", body }, updatedAt, ...extra });
ok(overwritesLocal(local, pull("theirs")), "pull newer than unpushed edit = conflict");
ok(overwritesLocal(local, pull("theirs", 100)), "same timestamp = conflict");
ok(!overwritesLocal(local, pull("theirs", 50)), "older pull never overwrites");
ok(!overwritesLocal({ ...local, dirty: 0 }, pull("theirs")), "clean local row: plain update");
ok(!overwritesLocal(local, pull("mine")), "same text: no conflict");
ok(!overwritesLocal(local, pull("theirs", 200, { deleted: 1 })), "remote delete is not a text conflict");
ok(!overwritesLocal({ ...local, type: "whiteboard" }, { data: { type: "whiteboard", body: "x" }, updatedAt: 200 }), "boards are not markdown");

// --- blocks
const mine = "# T\n\nA 3x3 kernel.\n\nPooling halves it.\n\nEnd";
const theirs = "# T\n\nA 3x3 kernel.\n\nReceptive field grows.\n\nEnd";
const segs = segments(mine, theirs);
eq(blocksDiffer(segs), 1, "one differing block, the rest identical");
eq(mergeBlocks(segs, ["mine"]), mine, "choose mine");
eq(mergeBlocks(segs, ["theirs"]), theirs, "choose theirs");
eq(mergeBlocks(segs, []), theirs, "default is theirs (what sync applied)");
eq(mergeBlocks(segs, ["both"]), "# T\n\nA 3x3 kernel.\n\nPooling halves it.\nReceptive field grows.\n\nEnd", "choose both keeps mine then theirs");
const two = segments("a\nX\nb\nY\nc", "a\nP\nb\nQ\nc");
eq(blocksDiffer(two), 2, "two blocks");
eq(mergeBlocks(two, ["mine", "theirs"]), "a\nX\nb\nQ\nc", "per-block choices");

const rec = (m: string, t: string): ConflictRec => ({ id: "c", noteId: "n", at: 1, mine: { title: "Mine", body: m, at: 1, device: "A" }, theirs: { title: "Theirs", body: t, at: 2, device: "B" } });
eq(resolvedText(rec(mine, theirs), "mine"), { title: "Mine", body: mine }, "resolve mine");
eq(resolvedText(rec(mine, theirs), "theirs"), { title: "Theirs", body: theirs }, "resolve theirs");
eq(resolvedText(rec(mine, theirs), "both").body.includes("Pooling halves it.\nReceptive field grows."), true, "resolve both");
eq(resolvedText(rec(mine, theirs), { merged: "custom" }).body, "custom", "resolve merged text");

// --- word diff
const old = "# Doc\n\nA kernel slides with the same weights.\n\nCost is linear.\n\nGone line.";
const cur = "# Doc\n\nA kernel slides with shared weights.\n\nCost is quadratic overall in length.\n\nNew line.";
const d = diffLines(old, cur);
const changed = d.find((l) => l.m === "~" && l.toks.some((x) => x.s.includes("shared")))!;
ok(!!changed, "changed line is word-diffed");
ok(changed.toks.some((x) => x.k === "-" && /the same/.test(x.s)) && changed.toks.some((x) => x.k === "+" && /shared/.test(x.s)), "removed and added words");
ok(changed.toks.some((x) => x.k === "=" && /kernel slides/.test(x.s)), "unchanged words kept");
const st = statOf(d);
ok(st.changed >= 1, "stat counts changed lines");
eq(d[0].h, 1, "heading level kept");
// restore selection: take the old wording back for the changed row only
const idx = changed.i;
const back = restoreRows(d, new Set([idx]));
ok(back.includes("with the same weights") && back.includes("New line.") && !back.includes("Gone line."), "restore selection takes back only the picked row");
eq(restoreRows(d, new Set()), cur.replace(/\n\n/g, "\n\n"), "no selection = current text");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
