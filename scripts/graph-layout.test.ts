// Tidy up layout tests (src/lib/graph-layout.ts). Run: npx tsx scripts/graph-layout.test.ts
import assert from "node:assert/strict";
import { countCrossings, tidy, type LEdge, type LNode } from "../src/lib/graph-layout";

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log("ok -", name); };
const box = (id: string, x: number, y: number, w = 160, h = 40, pinned = false): LNode => ({ id, x, y, w, h, pinned });
const overlaps = (ns: LNode[], pos: Map<string, { x: number; y: number }>) => {
  let c = 0;
  for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
    const a = ns[i], b = ns[j], p = pos.get(a.id)!, q = pos.get(b.id)!;
    if (Math.abs(p.x - q.x) < (a.w + b.w) / 2 - 0.5 && Math.abs(p.y - q.y) < (a.h + b.h) / 2 - 0.5) c++;
  }
  return c;
};

// The 14b messy path: 16 concepts, 23 links.
const MESSY: Record<string, [number, number]> = { la: [520, 300], calc: [80, 420], prob: [700, 90], gd: [300, 160], loss: [860, 420], reg: [150, 90], adam: [640, 470], bp: [420, 380], bn: [880, 250], conv: [60, 250], tok: [300, 470], att: [700, 250], tb: [480, 90], lora: [900, 120], rag: [240, 320], ev: [600, 170] };
const E: LEdge[] = [["la", "gd"], ["calc", "gd"], ["calc", "bp"], ["la", "bp"], ["prob", "loss"], ["gd", "bp"], ["loss", "bp"], ["gd", "adam"], ["bp", "bn"], ["bp", "conv"], ["reg", "bn"], ["bp", "att"], ["la", "att"], ["tok", "tb"], ["att", "tb"], ["tb", "lora"], ["tb", "rag"], ["adam", "lora"], ["rag", "ev"], ["lora", "ev"], ["conv", "att"], ["bn", "tb"], ["prob", "ev"]];
const nodes = Object.entries(MESSY).map(([id, [x, y]]) => box(id, x, y));

t("layered: edges point forward (LR), no overlaps, fewer crossings", () => {
  const r = tidy(nodes, E, { mode: "layered", dir: "LR" });
  assert.equal(r.pos.size, nodes.length);
  for (const [a, b] of E) assert.ok(r.pos.get(a)!.x < r.pos.get(b)!.x, `${a} → ${b} goes right`);
  assert.equal(overlaps(nodes, r.pos), 0);
  assert.ok(r.before! > r.after!, `crossings ${r.before} → ${r.after}`);
  assert.ok(r.moved > 10);
});

t("layered TB + cycles do not hang and still place everything", () => {
  const cyc: LEdge[] = [["a", "b"], ["b", "c"], ["c", "a"], ["c", "d"]];
  const ns = ["a", "b", "c", "d"].map((id, i) => box(id, i * 10, 0, 20, 20));
  const r = tidy(ns, cyc, { mode: "layered", dir: "TB" });
  assert.equal(r.pos.size, 4);
  assert.equal(overlaps(ns, r.pos), 0);
});

t("pinned nodes stay put and nothing overlaps them", () => {
  const ns = nodes.map((x) => (x.id === "bp" || x.id === "tok" ? { ...x, pinned: true } : x));
  const r = tidy(ns, E, { mode: "layered" });
  assert.deepEqual(r.pos.get("bp"), { x: 420, y: 380 });
  assert.deepEqual(r.pos.get("tok"), { x: 300, y: 470 });
  assert.equal(r.pinned, 2);
  assert.equal(overlaps(ns, r.pos), 0);
  const r2 = tidy(ns, E, { mode: "layered", keepPinned: false });
  assert.equal(r2.pinned, 0);
});

t("radial: centre at the middle, everyone else on rings", () => {
  const r = tidy(nodes, E, { mode: "radial", center: "bp" });
  const c = r.pos.get("bp")!;
  for (const id of ["gd", "loss", "bn", "conv", "att"]) {
    const p = r.pos.get(id)!;
    assert.ok(Math.hypot(p.x - c.x, p.y - c.y) > 60, `${id} off centre`);
  }
  assert.equal(overlaps(nodes, r.pos), 0);
});

t("force + isolated nodes packed in a grid, no overlaps", () => {
  const ns = [...nodes, box("x1", 0, 0), box("x2", 0, 0), box("x3", 0, 0)];
  const r = tidy(ns, E, { mode: "force", spacing: 1.6 });
  assert.equal(r.pos.size, ns.length);
  assert.ok(overlaps(ns, r.pos) <= 1);
});

t("countCrossings: an X crosses once, a shared end does not count", () => {
  const P: Record<string, { x: number; y: number }> = { a: { x: 0, y: 0 }, b: { x: 10, y: 10 }, c: { x: 0, y: 10 }, d: { x: 10, y: 0 } };
  assert.equal(countCrossings([["a", "b"], ["c", "d"]], (id) => P[id]), 1);
  assert.equal(countCrossings([["a", "b"], ["a", "d"]], (id) => P[id]), 0);
});

t("big graph (2000 nodes) lays out in reasonable time", () => {
  const ns: LNode[] = [], es: LEdge[] = [];
  for (let i = 0; i < 2000; i++) { ns.push(box(`n${i}`, Math.random() * 1000, Math.random() * 1000, 12, 12)); if (i) es.push([`n${Math.floor(Math.random() * i)}`, `n${i}`]); }
  const t0 = Date.now();
  const r = tidy(ns, es, { mode: "layered", dir: "TB" });
  assert.equal(r.pos.size, 2000);
  assert.equal(r.before, null);
  assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`);
});

console.log(`\n${n} passed`);

import { isPinned, setPinned, tidyCanvas } from "../src/lib/canvas";
import type { CanvasNode, JsonCanvas } from "../shared/types";
t("tidyCanvas: groups stay around their cards, pinned card kept, sides straightened", () => {
  const cards: CanvasNode[] = [
    { id: "g", type: "group", label: "Forward", x: 0, y: 0, width: 700, height: 500 },
    { id: "a", type: "text", text: "A", x: 400, y: 300, width: 200, height: 100 },
    { id: "b", type: "text", text: "B", x: 20, y: 20, width: 200, height: 100 },
    { id: "c", type: "text", text: "C", x: 900, y: 50, width: 200, height: 100 },
    setPinned({ id: "p", type: "text", text: "P", x: 1500, y: 900, width: 200, height: 100 }, true),
  ];
  const c: JsonCanvas = { nodes: cards, edges: [{ id: "e1", fromNode: "a", toNode: "b" }, { id: "e2", fromNode: "b", toNode: "c" }, { id: "e3", fromNode: "c", toNode: "p" }] };
  const r = tidyCanvas(c);
  const by = new Map(r.canvas.nodes!.map((n) => [n.id, n]));
  const g = by.get("g")!, a = by.get("a")!, b = by.get("b")!;
  for (const k of [a, b]) assert.ok(k.x >= g.x && k.y >= g.y && k.x + k.width <= g.x + g.width && k.y + k.height <= g.y + g.height, `${k.id} inside group`);
  assert.ok(a.x < b.x, "a → b left to right inside the group");
  assert.equal(by.get("p")!.x, 1500); assert.ok(isPinned(by.get("p")!));
  assert.equal(r.pinned, 1);
  assert.equal(r.canvas.edges![0].fromSide, "right");
  const box = (n: CanvasNode) => [n.x, n.y, n.x + n.width, n.y + n.height];
  const ov = (m: CanvasNode, n: CanvasNode) => { const [a0, a1, a2, a3] = box(m), [b0, b1, b2, b3] = box(n); return a0 < b2 && b0 < a2 && a1 < b3 && b1 < a3; };
  assert.ok(!ov(by.get("c")!, g) && !ov(by.get("c")!, by.get("p")!), "c clear of the group and the pinned card");
});
console.log(`${n} passed (with canvas)`);
