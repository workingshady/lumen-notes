// Sync push planning + version retention (src/lib/sync-plan.ts). Run: npx tsx scripts/sync-plan.test.ts
import { ackedIds, chunkItems, isStuck, MAX_ITEM_BYTES, RETRY_ERROR_MS, utf8Size, versionsToPrune, type VersionLite } from "../src/lib/sync-plan";

let failed = 0, passed = 0;
function ok(cond: unknown, msg: string) { if (cond) passed++; else { failed++; console.error("FAIL:", msg); } }
const eq = <T,>(a: T, b: T, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);

// ---- sizes
eq(utf8Size("abc"), 3, "ascii size");
ok(utf8Size("ع".repeat(700_000)) === 1_400_000, "arabic: 2 bytes per char counted when near the cap");
ok(utf8Size("ع".repeat(1_000_000)) > MAX_ITEM_BYTES, "arabic 1M chars is over the cap");

// ---- chunking: 2,500 dirty items never go in one request, sizes respected, order kept
const many = Array.from({ length: 2500 }, (_, i) => ({ i, size: 100 }));
const ch = chunkItems(many, 200, 4_000_000);
eq(ch.length, 13, "2500 items → 13 chunks of ≤200");
ok(ch.every((c) => c.length <= 200), "chunk item cap");
eq(ch.flat().map((x) => x.i), many.map((x) => x.i), "every item exactly once, in order");
const big = [{ size: 1_700_000 }, { size: 1_700_000 }, { size: 1_700_000 }, { size: 10 }];
eq(chunkItems(big, 200, 4_000_000).map((c) => c.length), [2, 2], "byte cap splits big items");
eq(chunkItems([{ size: 5_000_000 }], 200, 4_000_000).length, 1, "one item over the byte cap still goes alone");

// ---- acks: only acknowledged ids, rejected never cleared, old Worker = all
const sent = [{ key: "note/a", updatedAt: 1 }, { key: "note/b", updatedAt: 1 }, { key: "note/c", updatedAt: 1 }];
eq([...ackedIds(sent, ["note/a", "note/c"], [])], ["note/a", "note/c"], "unacknowledged b stays dirty");
eq([...ackedIds(sent, ["note/a", "note/b", "note/c"], [{ kind: "note", id: "b" }])], ["note/a", "note/c"], "rejected b stays dirty");
eq([...ackedIds(sent, undefined)], ["note/a", "note/b", "note/c"], "older Worker without `accepted`: everything it got");

// ---- stuck items: skip until edited; errors retried after an hour
const st = { kind: "note", id: "x", updatedAt: 5, reason: "too_large" as const, at: 0 };
ok(isStuck(st, 5, 10 ** 12), "too_large with same updatedAt is skipped forever");
ok(!isStuck(st, 6), "edited again → retried");
ok(isStuck({ ...st, reason: "error", at: 1000 }, 5, 1000 + RETRY_ERROR_MS - 1), "error skipped within the hour");
ok(!isStuck({ ...st, reason: "error", at: 1000 }, 5, 1000 + RETRY_ERROR_MS + 1), "error retried after the hour");
ok(!isStuck(undefined, 5), "unknown → not stuck");

// ---- version retention
const H = 3_600_000, D = 24 * H, now = 1_000 * D;
const vs: VersionLite[] = [];
let n = 0;
const add = (age: number, extra: Partial<VersionLite> = {}) => { const v = { id: `v${n++}`, noteId: "N", createdAt: now - age, ...extra }; vs.push(v); return v.id; };
const recent = [add(1000), add(10 * 60_000), add(23 * H)]; // all kept (< 24 h)
const hourA = add(30 * H + 10 * 60_000), hourA2 = add(30 * H + 20 * 60_000); // same hour bucket: newer (A) kept
const dayA = add(20 * D + H), dayA2 = add(20 * D + 2 * H); // same day bucket
const named = add(20 * D + 3 * H, { label: "Draft for Sara" }); // named: kept
const restored = add(20 * D + 4 * H, { label: "Restored from 3 May" }); // bookkeeping label: normal rules
const old1 = add(200 * D), old2 = add(200 * D + H); // weekly bucket beyond 90 days
const gone = add(20 * D + 5 * H, { deleted: 1 }); // already a tombstone: ignored
const drop = new Set(versionsToPrune(vs, now));
ok(recent.every((id) => !drop.has(id)), "last 24 h kept");
ok(!drop.has(hourA) && drop.has(hourA2), "hourly bucket keeps the newest");
ok(drop.has(dayA2) || drop.has(dayA), "daily bucket drops all but one");
ok(!drop.has(named), "named version kept");
ok(drop.has(restored), "restore bookkeeping follows the buckets");
ok(!drop.has(old1) && drop.has(old2), "weekly bucket beyond 90 days keeps the newest");
ok(!drop.has(gone), "tombstones ignored");
eq(versionsToPrune([{ id: "only", noteId: "M", createdAt: 0 }], now), [], "a note's only version is kept");
eq(versionsToPrune([{ id: "a", noteId: "M", createdAt: 0 }, { id: "b", noteId: "M", createdAt: 1 }], now), ["a"], "old pair in one week bucket: newest stays");

console.log(`sync-plan: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
