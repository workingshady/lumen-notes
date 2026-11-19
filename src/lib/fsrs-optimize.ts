// "Optimize from history" (Settings › Review › Advanced, Lumen 20 · A12): fit the 21 FSRS-6 weights to the user's own
// review log (db.reviews, kind "review"). Pure; the settings screen runs it and stores the result in settings.fsrsWeights.
//
// What it does (a smaller cousin of the official fsrs-optimizer, which trains with gradient descent in PyTorch/Rust):
//  1. Group the log by card, oldest first, and replay each card's history with FSRS-6 (same formulas as lib/fsrs.ts):
//     first rating → initial S/D; a review less than a day after the previous one → short-term stability; otherwise
//     the model predicts recall R(t, S) before the review and the outcome is "recalled" for Hard/Good/Easy, "forgot"
//     for Again. Loss = binary cross-entropy (log loss) of those predictions.
//  2. Pretrain the four initial stabilities (w0–w3): for each first rating, a 1-D golden-section search for the S that
//     best predicts the first long-term review of the cards that started with that rating (needs ≥ 8 such cards).
//  3. Coordinate descent (pattern search) over all 21 weights inside the published FSRS-6 bounds, minimising
//     log loss + an L2 pull toward the defaults (so a small history only nudges the weights). Steps halve when no
//     move helps; stops when the steps are tiny or after `maxRounds`.
// Needs at least MIN_REVIEWS long-term reviews (a review ≥ 1 day after the previous one); fewer → no fit.
import { DEFAULT_W, forgetStability, initDifficulty, initStability, nextDifficulty, recallStability, retrievability, shortTermStability } from "./fsrs";

export interface LogRow { cardId: string; at: number; grade: 0 | 1 | 2 | 3 }
type Rating = 1 | 2 | 3 | 4;
const DAY = 86_400_000;
export const MIN_REVIEWS = 50;
/** FSRS-6 weight bounds (as clamped by fsrs-rs / ts-fsrs). */
export const BOUNDS: [number, number][] = [
  [0.001, 100], [0.001, 100], [0.001, 100], [0.001, 100], [1, 10], [0.001, 4], [0.001, 4], [0.001, 0.75], [0, 4.5], [0, 0.8],
  [0.001, 3.5], [0.001, 5], [0.001, 0.25], [0.001, 0.9], [0, 4], [0, 1], [1, 6], [0, 2], [0, 2], [0, 0.8], [0.1, 0.8],
];
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
const EPS = 1e-4;
const bce = (r: number, y: number) => { const p = clamp(r, EPS, 1 - EPS); return -(y * Math.log(p) + (1 - y) * Math.log(1 - p)); };

/** Logs grouped per card, oldest first. */
export function byCard(logs: LogRow[]): LogRow[][] {
  const m = new Map<string, LogRow[]>();
  for (const l of logs) { const a = m.get(l.cardId); if (a) a.push(l); else m.set(l.cardId, [l]); }
  return [...m.values()].map((a) => a.sort((x, y) => x.at - y.at));
}

/** Total log loss and number of predicted (long-term) reviews when replaying every card with weights `w`. */
export function replayLoss(w: readonly number[], cards: LogRow[][]): { loss: number; n: number } {
  let loss = 0, n = 0;
  for (const rows of cards) {
    let s = 0, d = 0, last = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], g = (r.grade + 1) as Rating;
      if (i === 0) { s = initStability(w, g); d = clamp(initDifficulty(w, g), 1, 10); last = r.at; continue; }
      const t = (r.at - last) / DAY;
      if (t < 1) { s = shortTermStability(w, s, g); d = nextDifficulty(w, d, g); last = r.at; continue; }
      const R = retrievability(t, s, w);
      loss += bce(R, g > 1 ? 1 : 0); n++;
      s = g === 1 ? Math.min(forgetStability(w, d, s, R), s / Math.exp(w[17] * w[18])) : recallStability(w, d, s, R, g);
      s = clamp(s, 0.001, 36500);
      d = nextDifficulty(w, d, g); last = r.at;
    }
  }
  return { loss, n };
}

/** Pretrain w0–w3 from each card's first long-term review. */
function pretrain(w: number[], cards: LogRow[][]) {
  const obs: Record<number, { t: number; y: number }[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const rows of cards) {
    if (rows.length < 2) continue;
    const t = (rows[1].at - rows[0].at) / DAY;
    if (t < 1) continue; // same-day steps first: not a clean observation of S0
    obs[rows[0].grade + 1].push({ t, y: rows[1].grade > 0 ? 1 : 0 });
  }
  for (const g of [1, 2, 3, 4]) {
    const o = obs[g];
    if (o.length < 8) continue;
    const f = (ls: number) => { const s = Math.exp(ls); let L = 0; for (const x of o) L += bce(retrievability(x.t, s, w), x.y); return L + 0.5 * (ls - Math.log(w[g - 1])) ** 2; };
    let a = Math.log(0.1), b = Math.log(100);
    const k = (Math.sqrt(5) - 1) / 2;
    for (let it = 0; it < 60; it++) {
      const c = b - k * (b - a), d = a + k * (b - a);
      if (f(c) < f(d)) b = d; else a = c;
    }
    w[g - 1] = clamp(Math.exp((a + b) / 2), BOUNDS[g - 1][0], BOUNDS[g - 1][1]);
  }
  // keep the initial stabilities ordered (Again ≤ Hard ≤ Good ≤ Easy)
  for (let i = 1; i < 4; i++) w[i] = Math.max(w[i], w[i - 1]);
}

export interface FitResult { w: number[]; n: number; before: number; after: number }

/**
 * Fit FSRS-6 weights to a review log. Returns null when there are fewer than MIN_REVIEWS long-term reviews.
 * `before` / `after` = mean log loss with the default weights / with the fitted weights (lower is better).
 */
export async function fitWeights(logs: LogRow[], opts: { maxRounds?: number; reg?: number; onProgress?: (f: number) => void } = {}): Promise<FitResult | null> {
  const cards = byCard(logs);
  const base = replayLoss(DEFAULT_W, cards);
  if (base.n < MIN_REVIEWS) return null;
  const reg = opts.reg ?? 50;
  const maxRounds = opts.maxRounds ?? 24;
  const w: number[] = [...DEFAULT_W];
  pretrain(w, cards);
  const obj = (x: number[]) => replayLoss(x, cards).loss + reg * x.reduce((a, v, i) => a + ((v - DEFAULT_W[i]) / (BOUNDS[i][1] - BOUNDS[i][0])) ** 2, 0);
  let best = obj(w);
  const step = BOUNDS.map(([lo, hi]) => (hi - lo) * 0.04);
  for (let round = 0; round < maxRounds; round++) {
    let moved = false;
    for (let i = 0; i < w.length; i++) {
      for (const dir of [1, -1]) {
        const x = [...w];
        x[i] = clamp(w[i] + dir * step[i], BOUNDS[i][0], BOUNDS[i][1]);
        if (x[i] === w[i]) continue;
        const v = obj(x);
        if (v < best - 1e-9) { best = v; w[i] = x[i]; moved = true; break; }
      }
    }
    if (!moved) for (let i = 0; i < step.length; i++) step[i] /= 2;
    opts.onProgress?.((round + 1) / maxRounds);
    if (step.every((s, i) => s < (BOUNDS[i][1] - BOUNDS[i][0]) * 0.002)) break;
    await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
  }
  const after = replayLoss(w, cards);
  if (after.loss >= base.loss) return { w: [...DEFAULT_W], n: base.n, before: base.loss / base.n, after: base.loss / base.n }; // defaults already fit best
  return { w: w.map((x) => +x.toFixed(4)), n: base.n, before: base.loss / base.n, after: after.loss / after.n };
}
