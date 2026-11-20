// Element sanitiser (src/lib/board-sanitize.ts) + the live crash it fixes: an erased pen stroke stored as a compact
// tombstone (no `points`) made Excalidraw's restore throw "Cannot read properties of undefined (reading 'length')".
// Run: npx tsx scripts/board-sanitize.test.ts
import { carryTombstones, mergeBoards } from "../src/lib/board-merge";
import { sanitizeElement, sanitizeElements } from "../src/lib/board-sanitize";
import { parseScene } from "../src/lib/whiteboard";

let failed = 0, passed = 0;
function ok(cond: unknown, msg: string) { if (cond) passed++; else { failed++; console.error("FAIL:", msg); } }
type E = Record<string, unknown> & { id: string; type: string };
const NOW = 1_800_000_000_000;
const scene = (elements: unknown[]) => JSON.stringify({ type: "excalidraw", version: 2, source: "lumen", elements, files: {} });
const stroke = (id: string, extra: Record<string, unknown> = {}): E => ({ id, type: "freedraw", x: 0, y: 0, width: 10, height: 10, version: 3, versionNonce: 1, isDeleted: false, groupIds: [], boundElements: null, points: [[0, 0], [5, 5], [10, 10]], pressures: [0.5, 0.6, 0.7], simulatePressure: false, index: "a0", updated: NOW - 1000, ...extra });
// What Excalidraw's restoreElements does first for every element (isInvisiblySmallElement): must never throw.
const excalidrawSafe = (e: E) => { if (["line", "arrow", "freedraw"].includes(e.type)) return (e.points as unknown[]).length >= 0; return true; };

// ---- the live bug: erase a pen stroke → save stores a compact tombstone → reopening the board crashed
{
  const prev = scene([stroke("s1"), stroke("s2", { index: "a1" })]);
  const next = scene([stroke("s2", { index: "a1" })]); // s1 erased (Excalidraw never serialises deleted elements)
  const stored = carryTombstones(prev, next, NOW);
  const raw = (JSON.parse(stored) as { elements: E[] }).elements.find((e) => e.id === "s1")!;
  ok(raw.isDeleted && !("points" in raw), "stored tombstone of a stroke has no points (the input that crashed restore)");
  let threw = false;
  try { (raw.points as unknown[]).length; } catch { threw = true; }
  ok(threw, "unsanitised tombstone reproduces \"reading 'length'\"");
  const els = parseScene(stored).scene.elements as E[];
  ok(els.every(excalidrawSafe), "parseScene output is safe for Excalidraw restore");
  const t = els.find((e) => e.id === "s1")!;
  ok(t && Array.isArray(t.points) && (t.points as unknown[]).length === 0 && t.isDeleted, "tombstone kept with points: [] (restore drops it, the external-change effect still deletes the live copy)");
  // A merge of two devices' copies keeps the compact tombstone; loading it is safe too.
  const merged = mergeBoards(stored, scene([stroke("s1"), stroke("s2", { index: "a1" })]), { remoteNewer: false, now: NOW })!;
  ok((parseScene(merged).scene.elements as E[]).every(excalidrawSafe), "merged board is safe to load");
  ok(!(parseScene(merged).scene.elements as E[]).some((e) => e.id === "s1" && !e.isDeleted), "erase wins the merge");
  // Arrow / line tombstones had the same crash.
  for (const type of ["arrow", "line"]) ok(excalidrawSafe(sanitizeElement({ id: "x", type, version: 2, versionNonce: 0, isDeleted: true, updated: NOW })!), `${type} tombstone made safe`);
}

// ---- sanitiser rules
{
  const good = stroke("g");
  ok(sanitizeElement(good) === good, "a valid element is returned as the same object");
  const arr = [good, { id: "r", type: "rectangle", x: 0, y: 0, width: 5, height: 5, groupIds: [], boundElements: [] }];
  ok(sanitizeElements(arr) === arr, "unchanged list → same array (no allocation on big boards)");

  ok(sanitizeElement(stroke("p", { points: undefined })) === null, "live stroke without points → dropped");
  ok(sanitizeElement(stroke("p", { points: [] })) === null, "live stroke with empty points → dropped");
  const bad = sanitizeElement(stroke("p", { points: [[0, 0], [1, "x"], [2, 2]], pressures: [0.5, 0.5, 0.5] }))!;
  ok((bad.points as unknown[]).length === 2 && (bad.pressures as unknown[]).length === 0 && bad.simulatePressure === true, "bad points filtered, mismatched pressures reset to simulated");
  const np = sanitizeElement(stroke("p", { pressures: undefined }))!;
  ok(Array.isArray(np.pressures) && np.simulatePressure === true, "missing pressures → [] + simulatePressure");
  const mp = sanitizeElement(stroke("p", { pressures: [0.5] }))!;
  ok((mp.pressures as unknown[]).length === 0, "pressure count ≠ point count → reset");

  const noArr = sanitizeElement({ id: "r", type: "rectangle", x: 0, y: 0, width: 5, height: 5 })!;
  ok(Array.isArray(noArr.groupIds) && Array.isArray(noArr.boundElements), "missing groupIds / boundElements → []");
  const badArr = sanitizeElement({ id: "r", type: "rectangle", groupIds: "g", boundElements: [null, { id: "t", type: "text" }], x: NaN, index: 5 })!;
  ok(Array.isArray(badArr.groupIds) && (badArr.boundElements as unknown[]).length === 1 && badArr.x === 0 && !("index" in badArr), "bad groupIds / boundElements / x / index repaired");
  ok(sanitizeElement({ id: "r", type: "rectangle", boundElements: null })!.boundElements === null, "boundElements null is valid and kept");

  const line = sanitizeElement({ id: "l", type: "line", width: 40, height: 20, groupIds: [], boundElements: [] })!;
  ok(JSON.stringify(line.points) === "[[0,0],[40,20]]", "live line without points → its box diagonal");
  ok(sanitizeElement({ id: "l", type: "arrow", width: 0, height: 0 }) === null, "live arrow with no points and no size → dropped");

  ok(sanitizeElements([null, 3, "x", [], { type: "rectangle" }, { id: "a" }, { id: "", type: "text" }]).length === 0, "non-objects / missing id or type → dropped");
  ok(sanitizeElements(undefined).length === 0 && sanitizeElements(null).length === 0, "no elements → []");
}

// ---- REST pending / merge with a broken element from another device: never reaches the editor
{
  const remote = scene([stroke("ok"), { id: "broken", type: "freedraw", version: 9, versionNonce: 1, isDeleted: false, index: "a5" }]);
  const merged = JSON.parse(mergeBoards(scene([stroke("ok")]), remote, { remoteNewer: true, now: NOW })!) as { elements: E[] };
  ok(!merged.elements.some((e) => e.id === "broken"), "merge drops a live stroke that can't be repaired");
  ok((parseScene(remote).scene.elements as E[]).every((e) => e.id !== "broken"), "load drops it too");
}

console.log(`board-sanitize: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
