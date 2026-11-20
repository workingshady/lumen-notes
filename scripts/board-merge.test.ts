// Two-device board merge (src/lib/board-merge.ts) + fractional indices (shared/board-index.ts).
// Run: npx tsx scripts/board-merge.test.ts
import { carriedFrom, carryTombstones, mergeBoards, mergeElements, pickElement, TOMBSTONE_TTL, type BoardEl } from "../src/lib/board-merge";
import { ensureIndices, isIndexKey } from "../shared/board-index";

let failed = 0, passed = 0;
function ok(cond: unknown, msg: string) { if (cond) passed++; else { failed++; console.error("FAIL:", msg); } }
const eq = <T,>(a: T, b: T, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);

const NOW = 1_800_000_000_000;
const el = (id: string, index: string | null, version = 1, extra: Partial<BoardEl> = {}): BoardEl => ({ id, type: "rectangle", x: 0, y: 0, version, versionNonce: 100, isDeleted: false, updated: NOW - 1000, index, ...extra });
const scene = (elements: BoardEl[], extra: Record<string, unknown> = {}) => JSON.stringify({ type: "excalidraw", version: 2, source: "lumen", elements, files: {}, ...extra });
const merge = (l: string, r: string, remoteNewer = true) => JSON.parse(mergeBoards(l, r, { remoteNewer, now: NOW })!) as { elements: BoardEl[]; files: Record<string, unknown>; lumenBoard?: Record<string, unknown>; lumenLayers?: { list: { id: string }[]; active: string }; lumenPending?: unknown[]; appState?: Record<string, unknown> };
const live = (els: BoardEl[]) => els.filter((e) => !e.isDeleted);
const ids = (els: BoardEl[]) => live(els).map((e) => e.id);

// ---- concurrent edits to different elements: both kept, z-order by index
{
  const base = [el("a", "a0"), el("b", "a1")];
  const l = scene([...base, el("c", "a2")]); // device 1 added c
  const r = scene([el("a", "a0", 2, { x: 50 }), el("b", "a1"), el("d", "a3")]); // device 2 moved a, added d
  const m = merge(l, r);
  eq(ids(m.elements), ["a", "b", "c", "d"], "disjoint edits: all four, in index order");
  eq(m.elements.find((e) => e.id === "a")!.x, 50, "disjoint edits: remote move of a kept");
  const m2 = merge(r, l, false);
  eq(ids(m2.elements), ids(m.elements), "merge is symmetric in elements");
}

// ---- same element: higher version wins, tie → lower versionNonce
{
  eq(pickElement(el("a", "a0", 3, { x: 1 }), el("a", "a0", 5, { x: 2 })).x, 2, "higher version wins");
  eq(pickElement(el("a", "a0", 5, { x: 1, versionNonce: 9 }), el("a", "a0", 5, { x: 2, versionNonce: 3 })).x, 2, "tie: lower nonce wins");
  eq(pickElement(el("a", "a0", 5, { x: 2, versionNonce: 3 }), el("a", "a0", 5, { x: 1, versionNonce: 9 })).x, 2, "tie: order doesn't matter");
  const m = merge(scene([el("a", "a0", 7, { x: 7 })]), scene([el("a", "a0", 4, { x: 4 })]), true);
  eq(m.elements[0].x, 7, "older remote copy doesn't overwrite a newer local edit (even when the remote note is newer)");
}

// ---- delete vs edit: the deletion wins, stored as a compact tombstone; expired tombstones are dropped
{
  const l = scene([el("a", "a0", 3, { isDeleted: true, updated: NOW - 5000 }), el("b", "a1")]);
  const r = scene([el("a", "a0", 9, { x: 99 }), el("b", "a1")]);
  const m = merge(l, r);
  eq(ids(m.elements), ["b"], "delete beats a concurrent edit with a higher version");
  const t = m.elements.find((e) => e.id === "a")!;
  ok(t.isDeleted && t.version === 3 && !("x" in t) && !("index" in t), "tombstone is compact");
  const old = scene([el("a", "a0", 3, { isDeleted: true, updated: NOW - TOMBSTONE_TTL - 1 })]);
  eq(merge(old, scene([])).elements.length, 0, "tombstone older than 7 days is dropped");
  // Deletion with no local copy left: a tombstone from the other side still removes it here.
  eq(ids(merge(scene([el("a", "a0")]), scene([{ id: "a", type: "rectangle", version: 2, versionNonce: 1, isDeleted: true, updated: NOW }])).elements), [], "remote tombstone removes the local element");
}

// ---- carryTombstones: removed elements become tombstones (version + 1), kept 7 days, expired pruned
{
  const prev = scene([el("a", "a0", 4), el("b", "a1")]);
  const next = scene([el("b", "a1")]);
  const out = carryTombstones(prev, next, NOW);
  const s = JSON.parse(out) as { elements: BoardEl[] };
  const t = s.elements.find((e) => e.id === "a")!;
  ok(t?.isDeleted && t.version === 5 && t.updated === NOW, "removed element → tombstone with version + 1");
  eq(carriedFrom(out), next, "carriedFrom maps the stored body back to the editor body");
  eq(carryTombstones(next, next, NOW), next, "no change → same string");
  const later = carryTombstones(out, next, NOW + 1000);
  ok((JSON.parse(later) as { elements: BoardEl[] }).elements.some((e) => e.id === "a" && e.isDeleted), "tombstone carried across saves");
  const expiredOut = carryTombstones(out, next, NOW + TOMBSTONE_TTL + 10);
  eq(expiredOut, next, "tombstone gone after 7 days");
  // Round trip: device 1 deletes a (stored with tombstone), device 2 edits b; merge keeps a deleted.
  const m = merge(out, scene([el("a", "a0", 4), el("b", "a1", 2, { x: 5 })]));
  eq(ids(m.elements), ["b"], "stored tombstone wins over the other device's live copy");
  eq(m.elements.find((e) => e.id === "b")!.x, 5, "and the other device's edit to b is kept");
}

// ---- image files: union, only for live image elements; attachment refs preferred over inline bytes
{
  const img = (id: string, fileId: string, index: string) => el(id, index, 1, { type: "image", fileId });
  const l = scene([img("i1", "f1", "a0")], { files: { f1: { id: "f1", mimeType: "image/png", lumenAtt: "att1" }, gone: { id: "gone", mimeType: "image/png" } } });
  const r = scene([img("i2", "f2", "a1")], { files: { f2: { id: "f2", mimeType: "image/png", dataURL: "data:x" } } });
  const m = merge(l, r);
  eq(Object.keys(m.files).sort(), ["f1", "f2"], "files unioned; unreferenced dropped");
  const r2 = scene([img("i1", "f1", "a0")], { files: { f1: { id: "f1", mimeType: "image/png", dataURL: "data:y" } } });
  eq((merge(l, r2).files.f1 as { lumenAtt?: string }).lumenAtt, "att1", "attachment ref preferred");
  const del = scene([{ id: "i1", type: "image", version: 9, versionNonce: 1, isDeleted: true, updated: NOW }]);
  eq(Object.keys(merge(l, del).files), [], "file of a deleted image dropped");
}

// ---- lumenBoard, lumenLayers, lumenPending, scene fields from the newer note
{
  const l = scene([el("a", "a0")], { lumenBoard: { bg: "white", pattern: "grid", minimap: false }, lumenLayers: { list: [{ id: "notes" }, { id: "mine" }, { id: "sketch" }], active: "mine" }, lumenPending: [{ type: "rectangle", id: "p1" }, { type: "text", text: "x" }], appState: { viewBackgroundColor: "#fff", lumenBoard: { bg: "white" } } });
  const r = scene([el("a", "a0"), el("p1", "a1")], { lumenBoard: { bg: "chalk", density: 30 }, lumenLayers: { list: [{ id: "notes" }, { id: "sketch" }, { id: "bg" }], active: "notes" }, lumenPending: [{ type: "text", text: "x" }], appState: { viewBackgroundColor: "#000" } });
  const m = merge(l, r, true);
  eq(m.lumenBoard, { bg: "chalk", pattern: "grid", minimap: false, density: 30 }, "lumenBoard: newer keys over older ones");
  eq(m.appState?.lumenBoard, m.lumenBoard, "appState.lumenBoard mirrors it");
  eq(m.appState?.viewBackgroundColor, "#000", "other scene fields from the newer note");
  eq(m.lumenLayers!.list.map((x) => x.id), ["notes", "mine", "sketch", "bg"], "layers: union, newer order, added layer keeps its place");
  eq(m.lumenLayers!.active, "notes", "active layer from the newer note");
  eq(m.lumenPending, [{ type: "text", text: "x" }], "pending: deduped, already-applied skeleton (id is an element) dropped");
  const noPend = merge(scene([el("p1", "a0")], { lumenPending: [{ type: "rectangle", id: "p1" }] }), scene([el("p1", "a0")]));
  ok(!("lumenPending" in noPend), "no pending left → key removed");
}

// ---- missing index: elements without one get a key from their array place, not an arbitrary spot
{
  const r = scene([el("a", "a0"), el("x", null), el("b", "a1"), el("y", null)]);
  const m = merge(scene([el("a", "a0"), el("b", "a1")]), r);
  eq(ids(m.elements), ["a", "x", "b", "y"], "index-less elements keep their array position (y on top)");
  ok(m.elements.every((e) => isIndexKey(e.index)), "every live element has a valid index");
  const keys = m.elements.map((e) => e.index!);
  ok(keys.every((k, i) => i === 0 || keys[i - 1] < k), "indices strictly increasing");
  const all = ensureIndices([el("a", null), el("b", null), el("c", null)]);
  ok(all[0].index! < all[1].index! && all[1].index! < all[2].index!, "all missing → ascending keys");
  const same = [el("a", "a0"), el("b", "a1")];
  ok(ensureIndices(same) === same, "valid indices → same array");
  const dup = ensureIndices([el("a", "a1"), el("b", "a1"), el("c", "a0"), el("d", "a2")]);
  ok(dup.every((e, i) => i === 0 || dup[i - 1].index! < e.index!), "duplicate / out-of-order keys repaired");
  eq(dup.map((e) => e.index)[3], "a2", "a later valid key is kept");
  ok(!isIndexKey("a10") && !isIndexKey("") && isIndexKey("a0") && isIndexKey("Zz"), "key validation");
  // Equal keys created on both devices: both kept, strictly ordered.
  const m2 = merge(scene([el("a", "a0"), el("l", "a1")]), scene([el("a", "a0"), el("r", "a1")]));
  eq(ids(m2.elements), ["a", "l", "r"], "same key from two devices: tie broken by id");
  ok(m2.elements[1].index! < m2.elements[2].index!, "and re-keyed to be strictly increasing");
}

// ---- guardrails
{
  eq(mergeBoards("not json", scene([]), { remoteNewer: true }), null, "unparseable → null (LWW)");
  eq(mergeBoards(scene([]), '{"nodes":[]}', { remoteNewer: true }), null, "not a scene → null");
  eq(mergeBoards(scene([el("a", "a0")]), scene([el("b", "a1")]), { remoteNewer: true, maxBytes: 50 }), null, "over the size cap → null");
  const big = mergeElements([el("a", "a0")], [el("a", "a0")], NOW);
  eq(big.length, 1, "same element on both sides → once");
}

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
