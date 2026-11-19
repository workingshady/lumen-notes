/**
 * Tidy up (design round 4, 14b · 2): one auto-layout used by the notes graph and canvases. Pure logic, no React.
 *
 * - "layered": Sugiyama-style. Per connected component: break cycles (DFS back edges reversed), assign layers by
 *   longest path (sources pulled down next to their first child), add dummy nodes on long edges, reduce crossings with
 *   barycenter sweeps (best ordering kept, counted with a Fenwick tree), then place nodes along the layer with a
 *   few median-pull passes that keep order and spacing. Direction LR (layers left → right) or TB.
 * - "radial": BFS rings around a centre (the focused note or the best-connected one), each subtree gets an angular
 *   wedge proportional to its leaves; ring radii grow so a ring never overlaps itself.
 * - "force": d3-force from the current positions with a collide radius from the real size.
 * Components are laid out on their own and shelf-packed (biggest first); isolated nodes go into a grid.
 * Pinned nodes never move: the rest is laid out, re-centred on where it was, and pushed off pinned nodes by a final
 * overlap-removal pass. Positions are centres.
 */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";

export interface LNode { id: string; w: number; h: number; x: number; y: number; pinned?: boolean }
export type LEdge = [from: string, to: string];
export type TidyMode = "layered" | "radial" | "force";
export interface TidyOpts {
  mode: TidyMode;
  dir?: "LR" | "TB";
  /** Spacing multiplier (Compact 1 · Roomy 1.6). */
  spacing?: number;
  /** Base gaps between layers / between nodes in a layer (before `spacing`). */
  layerGap?: number;
  nodeGap?: number;
  /** Radial centre. */
  center?: string | null;
  /** Leave pinned nodes where they are (default true). */
  keepPinned?: boolean;
}
export interface TidyResult {
  pos: Map<string, { x: number; y: number }>;
  moved: number;
  /** Straight-line edge crossings before / after (null when the graph is too big to count cheaply). */
  before: number | null;
  after: number | null;
  pinned: number;
}

type P = { x: number; y: number };
const MAX_CROSS_COUNT = 1500;

// ------------------------------------------------------------------ helpers
function components(ids: string[], adj: Map<string, Set<string>>): string[][] {
  const seen = new Set<string>(), out: string[][] = [];
  for (const s of ids) {
    if (seen.has(s)) continue;
    const comp: string[] = [], st = [s];
    seen.add(s);
    while (st.length) { const v = st.pop()!; comp.push(v); for (const o of adj.get(v) ?? []) if (!seen.has(o)) { seen.add(o); st.push(o); } }
    out.push(comp);
  }
  return out;
}

/** Inversions of `a` (Fenwick tree): crossings between two layers once edges are sorted by their upper end. */
function inversions(a: number[], max: number): number {
  const t = new Array(max + 2).fill(0);
  let inv = 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = a[i]; j > 0; j -= j & -j) inv += t[j];
    for (let j = a[i] + 1; j <= max + 1; j += j & -j) t[j]++;
  }
  return inv;
}

/** Straight-segment crossings between edges (centres), ignoring edges sharing an end. */
export function countCrossings(edges: LEdge[], pos: (id: string) => P | undefined): number | null {
  if (edges.length > MAX_CROSS_COUNT) return null;
  const seg = edges.map(([a, b]) => ({ a, b, p: pos(a), q: pos(b) })).filter((s) => s.p && s.q && s.a !== s.b) as { a: string; b: string; p: P; q: P }[];
  const cr = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  let n = 0;
  for (let i = 0; i < seg.length; i++) for (let j = i + 1; j < seg.length; j++) {
    const s = seg[i], t = seg[j];
    if (s.a === t.a || s.a === t.b || s.b === t.a || s.b === t.b) continue;
    const d1 = cr(s.p, s.q, t.p), d2 = cr(s.p, s.q, t.q), d3 = cr(t.p, t.q, s.p), d4 = cr(t.p, t.q, s.q);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) n++;
  }
  return n;
}

/** Push overlapping boxes apart (grid-bucketed). Fixed ids never move. */
export function removeOverlaps(nodes: LNode[], pos: Map<string, P>, fixed: Set<string>, gap = 12, iters = 40) {
  if (nodes.length < 2) return;
  const cell = Math.max(...nodes.map((n) => Math.max(n.w, n.h))) + gap;
  for (let it = 0; it < iters; it++) {
    const grid = new Map<string, LNode[]>();
    for (const n of nodes) { const p = pos.get(n.id)!; const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(n); }
    let moved = false;
    for (const n of nodes) {
      const p = pos.get(n.id)!;
      const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const m of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
        if (m.id <= n.id) continue;
        const q = pos.get(m.id)!;
        const ox = (n.w + m.w) / 2 + gap - Math.abs(p.x - q.x), oy = (n.h + m.h) / 2 + gap - Math.abs(p.y - q.y);
        if (ox <= 0 || oy <= 0) continue;
        const fa = fixed.has(n.id), fb = fixed.has(m.id);
        if (fa && fb) continue;
        moved = true;
        const wa = fa ? 0 : fb ? 1 : 0.5, wb = 1 - wa;
        if (ox < oy) { const s = p.x < q.x || (p.x === q.x && n.id < m.id) ? -1 : 1; p.x += s * ox * wa; q.x -= s * ox * wb; }
        else { const s = p.y < q.y || (p.y === q.y && n.id < m.id) ? -1 : 1; p.y += s * oy * wa; q.y -= s * oy * wb; }
      }
    }
    if (!moved) break;
  }
}

// ------------------------------------------------------------------ layered
function layered(ids: string[], size: Map<string, LNode>, edges: LEdge[], dir: "LR" | "TB", layerGap: number, nodeGap: number): Map<string, P> {
  const inC = new Set(ids);
  const es = edges.filter(([a, b]) => a !== b && inC.has(a) && inC.has(b));
  // 1. Cycle breaking: DFS from nodes in input order, back edges are reversed.
  const out = new Map<string, string[]>();
  for (const [a, b] of es) (out.get(a) ?? out.set(a, []).get(a)!).push(b);
  const state = new Map<string, number>(); // 1 = on stack, 2 = done
  const dag: LEdge[] = [];
  const seenPair = new Set<string>();
  const push = (a: string, b: string) => { const k = a + "\u0000" + b; if (!seenPair.has(k)) { seenPair.add(k); dag.push([a, b]); } };
  for (const s of ids) {
    if (state.get(s)) continue;
    const st: [string, number][] = [[s, 0]];
    state.set(s, 1);
    while (st.length) {
      const top = st[st.length - 1];
      const kids = out.get(top[0]) ?? [];
      if (top[1] < kids.length) {
        const k = kids[top[1]++];
        const ks = state.get(k);
        if (ks === 1) push(k, top[0]);
        else { push(top[0], k); if (!ks) { state.set(k, 1); st.push([k, 0]); } }
      } else { state.set(top[0], 2); st.pop(); }
    }
  }
  // 2. Layers: longest path from sources (Kahn order), then sources move next to their nearest child.
  const succ = new Map<string, string[]>(), pred = new Map<string, string[]>(), indeg = new Map<string, number>();
  for (const id of ids) { succ.set(id, []); pred.set(id, []); indeg.set(id, 0); }
  for (const [a, b] of dag) { succ.get(a)!.push(b); pred.get(b)!.push(a); indeg.set(b, indeg.get(b)! + 1); }
  const layer = new Map<string, number>();
  const q = ids.filter((id) => !indeg.get(id));
  const topo: string[] = [];
  for (let i = 0; i < q.length; i++) {
    const v = q[i]; topo.push(v);
    if (!layer.has(v)) layer.set(v, 0);
    for (const w of succ.get(v)!) { layer.set(w, Math.max(layer.get(w) ?? 0, layer.get(v)! + 1)); indeg.set(w, indeg.get(w)! - 1); if (!indeg.get(w)) q.push(w); }
  }
  for (const v of [...topo].reverse()) if (!pred.get(v)!.length && succ.get(v)!.length) layer.set(v, Math.min(...succ.get(v)!.map((w) => layer.get(w)!)) - 1);
  // 3. Dummy nodes on long edges.
  type V = { id: string; real: boolean; up: string[]; down: string[] };
  const V = new Map<string, V>();
  for (const id of ids) V.set(id, { id, real: true, up: [], down: [] });
  let dn = 0;
  for (const [a, b] of dag) {
    let prev = a;
    for (let l = layer.get(a)! + 1; l < layer.get(b)!; l++) {
      const d = `\u0001d${dn++}`;
      V.set(d, { id: d, real: false, up: [], down: [] }); layer.set(d, l);
      V.get(prev)!.down.push(d); V.get(d)!.up.push(prev); prev = d;
    }
    V.get(prev)!.down.push(b); V.get(b)!.up.push(prev);
  }
  const L = Math.max(0, ...[...layer.values()]) + 1;
  const layers: string[][] = Array.from({ length: L }, () => []);
  // Initial order: DFS from the first source keeps related nodes together.
  const placed = new Set<string>();
  const visit = (v: string) => { const st = [v]; while (st.length) { const x = st.pop()!; if (placed.has(x)) continue; placed.add(x); layers[layer.get(x)!].push(x); const d = V.get(x)!.down; for (let i = d.length - 1; i >= 0; i--) st.push(d[i]); } };
  for (const id of [...ids].sort((a, b) => layer.get(a)! - layer.get(b)!)) visit(id);
  for (const k of V.keys()) if (!placed.has(k)) { placed.add(k); layers[layer.get(k)!].push(k); }
  // 4. Crossing reduction: barycenter sweeps, best ordering kept.
  const idx = new Map<string, number>();
  const reindex = () => layers.forEach((ly) => ly.forEach((v, i) => idx.set(v, i)));
  const crossings = () => {
    let c = 0;
    for (let l = 0; l + 1 < L; l++) {
      const pairs: [number, number][] = [];
      for (const v of layers[l]) for (const w of V.get(v)!.down) pairs.push([idx.get(v)!, idx.get(w)!]);
      pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      c += inversions(pairs.map((p) => p[1]), layers[l + 1].length);
    }
    return c;
  };
  reindex();
  let best = layers.map((l) => [...l]), bestC = crossings();
  for (let it = 0; it < 12 && bestC > 0; it++) {
    const down = it % 2 === 0;
    for (let s = 0; s < L - 1; s++) {
      const l = down ? s + 1 : L - 2 - s;
      const ref = (v: string) => (down ? V.get(v)!.up : V.get(v)!.down);
      const bc = new Map<string, number>();
      layers[l].forEach((v, i) => { const r = ref(v); bc.set(v, r.length ? r.reduce((t, w) => t + idx.get(w)!, 0) / r.length : i); });
      layers[l].sort((a, b) => bc.get(a)! - bc.get(b)!);
      layers[l].forEach((v, i) => idx.set(v, i));
    }
    const c = crossings();
    if (c < bestC) { bestC = c; best = layers.map((x) => [...x]); }
  }
  best.forEach((l, i) => (layers[i] = l));
  reindex();
  // 5. Coordinates. "Along" = position inside the layer, "across" = layer axis.
  const along = (id: string) => { const n = size.get(id); return n ? (dir === "LR" ? n.h : n.w) : 0; };
  const across = (id: string) => { const n = size.get(id); return n ? (dir === "LR" ? n.w : n.h) : 0; };
  // Dummies only served the ordering: coordinates use the real nodes and their real neighbours, so long edges
  // don't spread the rows apart.
  for (let l = 0; l < L; l++) layers[l] = layers[l].filter((v) => V.get(v)!.real);
  const nb = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [a, b] of dag) { nb.get(a)!.push(b); nb.get(b)!.push(a); }
  const pos = new Map<string, number>();
  for (const ly of layers) { let t = 0; for (const v of ly) { pos.set(v, t + along(v) / 2); t += along(v) + nodeGap; } }
  const sep = (a: string, b: string) => (along(a) + along(b)) / 2 + nodeGap;
  for (let it = 0; it < 6; it++) {
    const down = it % 2 === 0;
    for (let s = 0; s < L; s++) {
      const li = down ? s : L - 1 - s, ly = layers[li];
      // Pull toward the median of neighbours in the layers already placed in this sweep direction.
      const want = ly.map((v) => { const r = nb.get(v)!.filter((w) => (down ? layer.get(w)! < li : layer.get(w)! > li)); if (!r.length) return pos.get(v)!; const xs = r.map((w) => pos.get(w)!).sort((a, b) => a - b); const m = xs.length >> 1; return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2; });
      const x = [...want];
      for (let i = 1; i < ly.length; i++) x[i] = Math.max(x[i], x[i - 1] + sep(ly[i - 1], ly[i]));
      // Re-centre on what the layer wanted (keeps it from drifting right).
      const shift = want.reduce((t, w, i) => t + w - x[i], 0) / (ly.length || 1);
      ly.forEach((v, i) => pos.set(v, x[i] + shift));
    }
  }
  // Very wide layers (a hub with 60 children) wrap into stacked sub-rows of at most `maxRow` real nodes.
  // Row length aims at a roughly square drawing: N boxes of (along + gap) × (across + layer gap).
  const avgAl = ids.reduce((t, id) => t + along(id), 0) / ids.length + nodeGap, avgAc = ids.reduce((t, id) => t + across(id), 0) / ids.length + layerGap;
  const maxRow = Math.max(4, Math.ceil(Math.sqrt((ids.length * avgAc) / avgAl) * 1.3));
  const rows: string[][] = [], rowLayer: number[] = [];
  for (const [li, ly] of layers.entries()) {
    const real = ly.length;
    if (real <= maxRow) { rows.push(ly); rowLayer.push(li); continue; }
    const k = Math.ceil(real / maxRow);
    // Interleave (every k-th node per sub-row) so each sub-row spans the layer's range, then pack each around
    // its own mean so nodes stay near their neighbours.
    for (let r = 0; r < k; r++) {
      const row = ly.filter((_, i) => i % k === r);
      const w = row.reduce((t, v) => t + along(v), 0) + nodeGap * (row.length - 1);
      const mean = row.reduce((t, v) => t + pos.get(v)!, 0) / row.length;
      let t = mean - w / 2;
      for (const v of row) { pos.set(v, t + along(v) / 2); t += along(v) + nodeGap; }
      rows.push(row); rowLayer.push(li);
    }
  }
  const rowSize = rows.map((ly) => Math.max(0, ...ly.map(across)));
  const res = new Map<string, P>();
  let off = 0;
  rows.forEach((ly, l) => {
    const c = off + rowSize[l] / 2;
    for (const v of ly) if (V.get(v)!.real) res.set(v, dir === "LR" ? { x: c, y: pos.get(v)! } : { x: pos.get(v)!, y: c });
    off += rowSize[l] + (rowLayer[l + 1] === rowLayer[l] ? nodeGap * 2 : layerGap);
  });
  return res;
}

// ------------------------------------------------------------------ radial
function radial(ids: string[], size: Map<string, LNode>, adj: Map<string, Set<string>>, center: string | null | undefined, gap: number): Map<string, P> {
  const root = center && ids.includes(center) ? center : [...ids].sort((a, b) => (adj.get(b)?.size ?? 0) - (adj.get(a)?.size ?? 0))[0];
  const parent = new Map<string, string | null>([[root, null]]), depth = new Map([[root, 0]]), kids = new Map<string, string[]>();
  const order = [root];
  for (let i = 0; i < order.length; i++) {
    const v = order[i];
    kids.set(v, []);
    for (const w of [...(adj.get(v) ?? [])].sort()) if (!parent.has(w)) { parent.set(w, v); depth.set(w, depth.get(v)! + 1); kids.get(v)!.push(w); order.push(w); }
  }
  const leaves = new Map<string, number>();
  for (const v of [...order].reverse()) leaves.set(v, kids.get(v)!.length ? kids.get(v)!.reduce((t, k) => t + leaves.get(k)!, 0) : 1);
  const maxD = Math.max(...depth.values());
  const dim = (id: string) => { const n = size.get(id)!; return Math.max(n.w, n.h); };
  const radius: number[] = [0];
  for (let d = 1; d <= maxD; d++) {
    const ring = order.filter((v) => depth.get(v) === d);
    const need = ring.reduce((t, v) => t + dim(v) + gap, 0) / (2 * Math.PI);
    const prevMax = Math.max(...order.filter((v) => depth.get(v) === d - 1).map(dim));
    radius[d] = Math.max(radius[d - 1] + prevMax / 2 + gap * 2.2, need);
  }
  const ang = new Map<string, [number, number]>([[root, [0, Math.PI * 2]]]);
  const res = new Map<string, P>([[root, { x: 0, y: 0 }]]);
  for (const v of order) {
    const [a0, a1] = ang.get(v)!;
    let a = a0;
    const tot = leaves.get(v)!;
    for (const k of kids.get(v)!) {
      const span = ((a1 - a0) * leaves.get(k)!) / tot;
      ang.set(k, [a, a + span]);
      const mid = a + span / 2, r = radius[depth.get(k)!];
      res.set(k, { x: Math.cos(mid - Math.PI / 2) * r, y: Math.sin(mid - Math.PI / 2) * r });
      a += span;
    }
  }
  return res;
}

// ------------------------------------------------------------------ force
function force(ids: string[], size: Map<string, LNode>, edges: LEdge[], gap: number): Map<string, P> {
  type S = SimulationNodeDatum & { id: string; r: number };
  const sim: S[] = ids.map((id) => { const n = size.get(id)!; return { id, x: n.x, y: n.y, r: Math.hypot(n.w, n.h) / 2 + gap / 2 }; });
  const inC = new Set(ids);
  const links = edges.filter(([a, b]) => a !== b && inC.has(a) && inC.has(b)).map(([a, b]) => ({ source: a, target: b }));
  const avg = sim.reduce((t, s) => t + s.r, 0) / (sim.length || 1);
  const s = forceSimulation(sim).force("link", forceLink<S, { source: string; target: string }>(links).id((d) => d.id).distance(avg * 2 + gap).strength(0.6))
    .force("charge", forceManyBody<S>().strength(-avg * 12)).force("collide", forceCollide<S>((d) => d.r).iterations(2))
    .force("x", forceX(0).strength(0.04)).force("y", forceY(0).strength(0.04)).stop();
  for (let i = 0; i < 300; i++) s.tick();
  return new Map(sim.map((p) => [p.id, { x: p.x!, y: p.y! }]));
}

// ------------------------------------------------------------------ packing
function bbox(ids: string[], pos: Map<string, P>, size: Map<string, LNode>) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) { const p = pos.get(id)!, n = size.get(id)!; x0 = Math.min(x0, p.x - n.w / 2); y0 = Math.min(y0, p.y - n.h / 2); x1 = Math.max(x1, p.x + n.w / 2); y1 = Math.max(y1, p.y + n.h / 2); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** Shelf-pack laid-out components (each with its own frame) into rows of about `rowW`. */
function pack(parts: { ids: string[]; pos: Map<string, P> }[], size: Map<string, LNode>, gap: number): Map<string, P> {
  const boxes = parts.map((p) => ({ ...p, b: bbox(p.ids, p.pos, size) })).sort((a, b) => b.b.w * b.b.h - a.b.w * a.b.h);
  const area = boxes.reduce((t, x) => t + (x.b.w + gap) * (x.b.h + gap), 0);
  const rowW = Math.max(boxes[0]?.b.w ?? 0, Math.sqrt(area) * 1.6);
  const out = new Map<string, P>();
  let x = 0, y = 0, rowH = 0;
  for (const bx of boxes) {
    if (x > 0 && x + bx.b.w > rowW) { x = 0; y += rowH + gap; rowH = 0; }
    for (const id of bx.ids) { const p = bx.pos.get(id)!; out.set(id, { x: p.x - bx.b.x0 + x, y: p.y - bx.b.y0 + y }); }
    x += bx.b.w + gap; rowH = Math.max(rowH, bx.b.h);
  }
  return out;
}

// ------------------------------------------------------------------ entry point
export function tidy(nodes: LNode[], edges: LEdge[], o: TidyOpts): TidyResult {
  const k = o.spacing ?? 1;
  const layerGap = (o.layerGap ?? 80) * k, nodeGap = (o.nodeGap ?? 24) * k;
  const keep = o.keepPinned !== false;
  const size = new Map(nodes.map((n) => [n.id, n]));
  const pinned = new Set(keep ? nodes.filter((n) => n.pinned).map((n) => n.id) : []);
  const free = nodes.filter((n) => !pinned.has(n.id));
  const ids = free.map((n) => n.id);
  const freeSet = new Set(ids);
  const fe = edges.filter(([a, b]) => freeSet.has(a) && freeSet.has(b) && a !== b);
  const adj = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const [a, b] of fe) { adj.get(a)!.add(b); adj.get(b)!.add(a); }
  const comps = components(ids, adj);
  const singles = comps.filter((c) => c.length === 1).map((c) => c[0]);
  const parts: { ids: string[]; pos: Map<string, P> }[] = [];
  for (const c of comps.filter((c) => c.length > 1)) {
    const pos = o.mode === "radial" ? radial(c, size, adj, o.center, nodeGap) : o.mode === "force" ? force(c, size, fe, nodeGap) : layered(c, size, fe, o.dir ?? "LR", layerGap, nodeGap);
    // Radial wedges and force can leave near-misses: a light overlap pass per component.
    if (o.mode !== "layered") removeOverlaps(c.map((id) => size.get(id)!), pos, new Set(), nodeGap / 2, 60);
    parts.push({ ids: c, pos });
  }
  if (singles.length) {
    // Isolated nodes: a compact grid, biggest first.
    const cols = Math.max(1, Math.ceil(Math.sqrt(singles.length * 1.6)));
    const cw = Math.max(...singles.map((id) => size.get(id)!.w)) + nodeGap, ch = Math.max(...singles.map((id) => size.get(id)!.h)) + nodeGap;
    parts.push({ ids: singles, pos: new Map(singles.map((id, i) => [id, { x: (i % cols) * cw, y: Math.floor(i / cols) * ch }])) });
  }
  const pos = pack(parts, size, layerGap * 0.75);
  // Keep the result where the old one was (same centre), so the view doesn't jump.
  if (ids.length) {
    const old = bbox(ids, new Map(free.map((n) => [n.id, { x: n.x, y: n.y }])), size), nb = bbox(ids, pos, size);
    const dx = (old.x0 + old.x1) / 2 - (nb.x0 + nb.x1) / 2, dy = (old.y0 + old.y1) / 2 - (nb.y0 + nb.y1) / 2;
    for (const p of pos.values()) { p.x += dx; p.y += dy; }
  }
  for (const n of nodes) if (pinned.has(n.id)) pos.set(n.id, { x: n.x, y: n.y });
  if (pinned.size) removeOverlaps(nodes, pos, pinned, nodeGap / 2);
  const oldPos = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  let moved = 0;
  for (const n of nodes) { const p = pos.get(n.id)!; if (Math.hypot(p.x - n.x, p.y - n.y) > 2) moved++; }
  return { pos, moved, before: countCrossings(edges, (id) => oldPos.get(id)), after: countCrossings(edges, (id) => pos.get(id)), pinned: pinned.size };
}
