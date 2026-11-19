// Prerequisite graphs (design round 4, 14b Graphs & connections): shared pure logic for the learning-path Graph and the
// course Skill tree. No React, no DOM, so it can be tested (scripts/prereq-graph.test.ts).
//
//  · impliedLinks(): the links a transitive reduction would drop: A → C is "implied" when C already needs A through
//    another chain (A → B → C). "Hide implied links" hides exactly these.
//  · checkLink(): what dropping a new link would do (14b-H…K): valid · loop (refused, names the chain) · implied
//    (allowed after asking) · duplicate (nothing happens).
//  · edgePath(): curved / elbow / straight edges, optionally bundled through a shared gutter between stages, in a
//    left → right or top → down flow.
import { isRtl, t, tk } from "./i18n";

/** How a link is written: `needs` (prerequisite), `after` (recommended order), `related` (see also, no order). */
export type LinkKind = "needs" | "after" | "related";
export const LINK_KINDS: LinkKind[] = ["needs", "after", "related"];
export const LINK_LABEL: Record<LinkKind, string> = { needs: tk("Prerequisite"), after: tk("Recommended order"), related: tk("Related (no order)") };
/** Arrow for "A → B" chains in the interface direction. */
export const arrow = () => (isRtl() ? " ← " : " → ");
/** Line pattern per link type (14b · 1). Colour of a prerequisite comes from progress, the others are fixed. */
export const LINK_DASH: Record<LinkKind | "implied" | "added", string | undefined> = { needs: undefined, after: "6 5", related: "1.5 5", added: "6 5", implied: "2 4" };

export type Needs = (key: string) => readonly string[];

/** Shortest chain [from, …, to] following `needs` (from needs … needs to), or null. */
export function needPath(needsOf: Needs, from: string, to: string): string[] | null {
  if (from === to) return [from];
  const prev = new Map<string, string>();
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const x = queue.shift()!;
    for (const n of needsOf(x)) {
      if (seen.has(n)) continue;
      seen.add(n); prev.set(n, x);
      if (n === to) {
        const out = [to];
        for (let c = x; ; c = prev.get(c)!) { out.unshift(c); if (c === from) break; }
        return out;
      }
      queue.push(n);
    }
  }
  return null;
}

export type LinkCheck =
  | { kind: "valid" }
  | { kind: "self" }
  | { kind: "duplicate" }
  /** `chain` = [prereq, …, target]: the prereq already (transitively) needs the target. */
  | { kind: "loop"; chain: string[] }
  /** `chain` = [target, …, prereq]: the target already reaches the prereq through other links. */
  | { kind: "implied"; chain: string[] };

/** What would "target needs prereq" do? */
export function checkLink(needsOf: Needs, prereq: string, target: string): LinkCheck {
  if (prereq === target) return { kind: "self" };
  if (needsOf(target).includes(prereq)) return { kind: "duplicate" };
  const loop = needPath(needsOf, prereq, target);
  // name the longer chain when the direct link is itself implied (it explains why, 14b-I)
  if (loop) return { kind: "loop", chain: (loop.length === 2 && needPath((k) => (k === prereq ? needsOf(k).filter((n) => n !== target) : needsOf(k)), prereq, target)) || loop };
  const imp = needPath(needsOf, target, prereq);
  if (imp) return { kind: "implied", chain: imp };
  return { kind: "valid" };
}

/** One-line explanation for a refused / questioned link (names the existing chain so it can be fixed). */
export function linkMessage(c: LinkCheck, name: (k: string) => string, prereq: string, target: string): { title: string; body: string } | null {
  const through = (ks: string[]) => { const mid = ks.slice(1, -1).map(name); return mid.length ? mid.join(arrow()) : ""; };
  if (c.kind === "loop") {
    const via = through(c.chain);
    return { title: t("Would make a loop"), body: via ? t("{a} is already needed (through {via}) to reach {b}.", { a: name(target), via, b: name(prereq) }) : t("{a} already needs {b}.", { a: name(prereq), b: name(target) }) };
  }
  if (c.kind === "implied") return { title: t("Already implied"), body: t("{a} already needs {b} through {via}. This link adds nothing new.", { a: name(target), b: name(prereq), via: through(c.chain) }) };
  if (c.kind === "duplicate") return { title: t("Already connected"), body: t("{a} → {b} exists.", { a: name(prereq), b: name(target) }) };
  return null;
}

/** Every ancestor (transitive prerequisite) of each key, memoised. Cycles are tolerated. */
function ancestorsOf(needsOf: Needs) {
  const memo = new Map<string, Set<string>>();
  const visiting = new Set<string>();
  const get = (k: string): Set<string> => {
    const m = memo.get(k);
    if (m) return m;
    if (visiting.has(k)) return new Set();
    visiting.add(k);
    const out = new Set<string>();
    for (const n of needsOf(k)) { out.add(n); for (const a of get(n)) out.add(a); }
    visiting.delete(k);
    memo.set(k, out);
    return out;
  };
  return get;
}

/**
 * Implied links ("pre>key"): direct prerequisites that are also reached through another direct prerequisite.
 * Hiding them gives the transitive reduction of the prerequisite DAG.
 */
export function impliedLinks(keys: Iterable<string>, needsOf: Needs): Set<string> {
  const anc = ancestorsOf(needsOf);
  const out = new Set<string>();
  for (const k of keys) {
    const direct = needsOf(k);
    for (const p of direct) if (direct.some((q) => q !== p && anc(q).has(p))) out.add(`${p}>${k}`);
  }
  return out;
}

/** Number of distinct prerequisite depths: depth(k) = 1 + max depth of its prerequisites (cycles cut). */
export function depths(keys: string[], needsOf: Needs): Map<string, number> {
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const inSet = new Set(keys);
  const d = (k: string): number => {
    if (memo.has(k)) return memo.get(k)!;
    if (visiting.has(k)) return 0;
    visiting.add(k);
    const ps = needsOf(k).filter((n) => inSet.has(n));
    const v = ps.length ? 1 + Math.max(...ps.map(d)) : 0;
    visiting.delete(k);
    memo.set(k, v);
    return v;
  };
  keys.forEach(d);
  return memo;
}

/**
 * Barycentre ordering (one down + one up sweep): inside each column, sort keys by the mean row of their neighbours in the
 * previous / next column. The classic crossing-reduction step of a layered (Sugiyama) layout.
 */
export function untangle(cols: string[][], needsOf: Needs, unlocksOf: Needs): string[][] {
  const out = cols.map((c) => [...c]);
  const row = new Map<string, number>();
  const index = () => { row.clear(); out.forEach((c) => c.forEach((k, i) => row.set(k, i))); };
  const sweep = (order: number[], nb: Needs) => {
    for (const ci of order) {
      index();
      const bc = new Map(out[ci].map((k, i) => {
        const r = nb(k).map((n) => row.get(n)).filter((x): x is number => x !== undefined);
        return [k, r.length ? r.reduce((a, b) => a + b, 0) / r.length : i] as [string, number];
      }));
      out[ci].sort((a, b) => bc.get(a)! - bc.get(b)!);
    }
  };
  const idx = out.map((_, i) => i);
  for (let pass = 0; pass < 2; pass++) { sweep(idx.slice(1), needsOf); sweep(idx.slice(0, -1).reverse(), unlocksOf); }
  return out;
}

export type EdgeShape = "curved" | "elbow" | "straight";
/** SVG path + arrowhead for one edge. `vertical` = top → down flow. `bundleAt` routes the middle through a shared gutter. */
export function edgePath(shape: EdgeShape, x1: number, y1: number, x2: number, y2: number, o: { vertical?: boolean; bundleAt?: number | null } = {}): { d: string; ah: string } {
  if (o.vertical) {
    // same shapes, rotated: swap axes in, swap them back out
    const r = edgePath(shape, y1, x1, y2, x2, { bundleAt: o.bundleAt });
    const swap = (s: string) => s.replace(/([MLCQHV])([^MLCQHVZ]*)/g, (_, c: string, args: string) => {
      const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (c === "H") return `V${n[0]}`;
      if (c === "V") return `H${n[0]}`;
      const p: number[] = [];
      for (let i = 0; i + 1 < n.length; i += 2) p.push(n[i + 1], n[i]);
      return `${c}${p.join(" ")}`;
    });
    return { d: swap(r.d), ah: swap(r.ah) };
  }
  const head = `M${x2} ${y2}L${x2 - 8} ${y2 - 4}L${x2 - 8} ${y2 + 4}Z`;
  if (shape === "straight") {
    const an = Math.atan2(y2 - y1, x2 - x1), c = Math.cos(an), s = Math.sin(an);
    return { d: `M${x1} ${y1}L${x2} ${y2}`, ah: `M${x2} ${y2}L${x2 - 8 * c + 4 * s} ${y2 - 8 * s - 4 * c}L${x2 - 8 * c - 4 * s} ${y2 - 8 * s + 4 * c}Z` };
  }
  const mx = (x1 + x2) / 2;
  if (shape === "elbow") {
    if (Math.abs(y2 - y1) < 1) return { d: `M${x1} ${y1}H${x2}`, ah: head };
    const sg = Math.sign(y2 - y1), r = Math.min(10, Math.abs(y2 - y1) / 2, Math.abs(x2 - x1) / 2);
    return { d: `M${x1} ${y1}H${mx - r}Q${mx} ${y1} ${mx} ${y1 + sg * r}V${y2 - sg * r}Q${mx} ${y2} ${mx + r} ${y2}H${x2}`, ah: head };
  }
  if (o.bundleAt != null && x2 - x1 > 80) {
    // 14b-G: leave the card, merge into the gutter between stages, run along it, peel off into the target
    const gx = x1 + 25, gy = (y1 + y2) / 4 + o.bundleAt / 2;
    return { d: `M${x1} ${y1}C${gx} ${y1} ${gx} ${gy} ${gx + 12} ${gy}L${x2 - 37} ${gy}C${x2 - 25} ${gy} ${x2 - 25} ${y2} ${x2} ${y2}`, ah: head };
  }
  return { d: `M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`, ah: head };
}

/** Segment-intersection crossings between straight chords of edges (a cheap, layout-independent readability score). */
export function crossings(edges: [string, string][], pos: (k: string) => { x: number; y: number } | undefined): number {
  const seg = edges.map(([a, b]) => [pos(a), pos(b)] as const).filter((s): s is readonly [{ x: number; y: number }, { x: number; y: number }] => !!s[0] && !!s[1]);
  const cr = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  let n = 0;
  for (let i = 0; i < seg.length; i++) for (let j = i + 1; j < seg.length; j++) {
    const [p1, p2] = seg[i], [p3, p4] = seg[j];
    if ([p1, p2].some((p) => p === p3 || p === p4 || (p.x === p3.x && p.y === p3.y) || (p.x === p4.x && p.y === p4.y))) continue;
    const d1 = cr(p3, p4, p1), d2 = cr(p3, p4, p2), d3 = cr(p1, p2, p3), d4 = cr(p1, p2, p4);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) n++;
  }
  return n;
}
