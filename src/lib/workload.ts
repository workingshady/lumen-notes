// FSRS workload estimate for Settings › Review (Lumen 20 · A12): "Reviews per day, next 30 days" for a target
// retention, simulated from the cards' current FSRS memory (stability, difficulty, last review). Pure and seeded, so the
// same cards always give the same chart.
//
// Model: each live card (not deleted / suspended) is replayed for `days` days. A review card first comes due when its
// recall probability falls to the target retention (last review + interval(S, r)); overdue and learning cards are due
// today; new cards are learned today (they show as due in Review). At each review the card is recalled with its
// current retrievability: recall → S grows (Good), lapse → S shrinks (Again) and one relearning review follows the
// next day. Each card is sampled `runs` times and the counts averaged.
import type { Card } from "../../shared/types";
import { forgetStability, initDifficulty, initStability, intervalDays, memoryOf, nextDifficulty, paramsFor, recallStability, retrievability, type FsrsCard } from "./fsrs";

const DAY = 86_400_000;

/** Small seeded PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export type CardStateCounts = Record<"new" | "learning" | "review" | "relearning" | "suspended", number>;

export function cardStates(cards: Card[], now = Date.now()): CardStateCounts {
  const out: CardStateCounts = { new: 0, learning: 0, review: 0, relearning: 0, suspended: 0 };
  for (const c of cards) {
    if (c.deleted) continue;
    if (c.suspended) { out.suspended++; continue; }
    out[memoryOf(c as FsrsCard, now).state]++;
  }
  return out;
}

/** Expected reviews per day (index 0 = today) for `days` days at `retention`. */
export function estimateWorkload(cards: Card[], retention: number, days = 30, now = Date.now(), runs?: number): number[] {
  const p = paramsFor(retention);
  const w = p.w;
  const live = cards.filter((c) => !c.deleted && !c.suspended);
  const k = runs ?? (live.length > 3000 ? 2 : live.length > 600 ? 5 : 20);
  const out = new Array<number>(days).fill(0);
  const rand = rng(1234567);
  for (const c of live) {
    const m = memoryOf(c as FsrsCard, now, p);
    for (let run = 0; run < k; run++) {
      let s: number, d: number, t: number, last: number;
      if (m.state === "new") {
        s = initStability(w, 3); d = initDifficulty(w, 3); out[0] += 1; last = 0; t = intervalDays(s, p);
      } else if (m.state === "learning" || m.state === "relearning") {
        s = Math.max(m.s, 0.1); d = m.d || initDifficulty(w, 3); out[0] += 1; last = 0; t = intervalDays(s, p);
      } else {
        s = m.s; d = m.d;
        const lastDay = (m.last - now) / DAY; // ≤ 0
        t = Math.max(0, Math.round(lastDay + intervalDays(s, p)));
        last = lastDay;
      }
      while (t < days) {
        out[t] += 1;
        const elapsed = Math.max(0, t - last);
        const r = retrievability(elapsed, s, w);
        if (rand() < r) {
          s = recallStability(w, d, s, r, 3); d = nextDifficulty(w, d, 3);
          last = t; t = t + intervalDays(s, p);
        } else {
          s = forgetStability(w, d, s, r); d = nextDifficulty(w, d, 1);
          // one relearning step the next day, then back to review
          if (t + 1 < days) out[t + 1] += 1;
          last = t + 1; t = t + 1 + intervalDays(s, p);
        }
      }
    }
  }
  return out.map((x) => x / k);
}

export const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
