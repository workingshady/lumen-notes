// FSRS-6 spaced-repetition scheduler (Free Spaced Repetition Scheduler, open-spaced-repetition).
//
// Self-contained port of the published algorithm, matching ts-fsrs 5.x (FSRS-6.0) with its defaults:
// 21 default weights, desired retention 0.9, learning steps 1m → 10m, relearning step 10m, no fuzz.
//
// Memory model (per card):
//   S  stability    days until the recall probability R drops to 90 %
//   D  difficulty   1 (easy) … 10 (hard)
//   R  retrievability  R(t, S) = (1 + F·t/S)^(−w20),  F = 0.9^(−1/w20) − 1   (power forgetting curve, R(S,S) = 0.9)
// Interval for a desired retention r:  I = S/F · (r^(−1/w20) − 1)   (= S when r = 0.9)
//
// Cards scheduled by the older SM-2 ladder (no `stability`) migrate on their next review: S = their current interval,
// D from their ease, last review = due − interval (see `memoryOf`). Card fields stay compatible with SM-2 readers:
// `interval` = scheduled days (0 while in learning steps), `ease` is left untouched.
import type { Card } from "../../shared/types";

export type Grade = 0 | 1 | 2 | 3; // Again, Hard, Good, Easy (UI order; FSRS rating = grade + 1)
type Rating = 1 | 2 | 3 | 4;
type State = NonNullable<Card["state"]>;
/** `step` = index into the (re)learning steps (synced as part of the card JSON; absent = 0). */
export type FsrsCard = Card & { step?: number };

export const DEFAULT_W = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
  1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
] as const;

export interface FsrsParams {
  w: readonly number[];
  /** Desired retention (probability of recall when a card comes due), 0.7 – 0.97. */
  retention: number;
  /** Learning steps for new cards, minutes. */
  learningSteps: number[];
  /** Relearning steps after a lapse, minutes. */
  relearningSteps: number[];
  maxInterval: number;
}
export const DEFAULT_PARAMS: FsrsParams = { w: DEFAULT_W, retention: 0.9, learningSteps: [1, 10], relearningSteps: [10], maxInterval: 36500 };

const DAY = 86_400_000;
const MIN = 60_000;
const S_MIN = 0.001;
const S_MAX = 36500;
const r8 = (x: number) => +x.toFixed(8);
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

// ------------------------------------------------------------------ core formulas
export const decayFactor = (w: readonly number[]) => { const decay = -w[20]; return { decay, factor: r8(Math.exp(Math.log(0.9) / decay) - 1) }; };
/** Probability of recall after `t` days at stability `s`. */
export function retrievability(t: number, s: number, w: readonly number[] = DEFAULT_W) {
  const { decay, factor } = decayFactor(w);
  return r8(Math.pow(1 + (factor * t) / s, decay));
}
export const initStability = (w: readonly number[], g: Rating) => Math.max(w[g - 1], 0.1);
export const initDifficulty = (w: readonly number[], g: Rating) => r8(w[4] - Math.exp((g - 1) * w[5]) + 1);
export function nextDifficulty(w: readonly number[], d: number, g: Rating) {
  const delta = -w[6] * (g - 3);
  const next = d + r8((delta * (10 - d)) / 9); // linear damping
  return clamp(r8(w[7] * initDifficulty(w, 4) + (1 - w[7]) * next), 1, 10); // mean reversion towards D0(Easy)
}
export function recallStability(w: readonly number[], d: number, s: number, r: number, g: Rating) {
  const hard = g === 2 ? w[15] : 1;
  const easy = g === 4 ? w[16] : 1;
  return r8(clamp(s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1) * hard * easy), S_MIN, S_MAX));
}
export function forgetStability(w: readonly number[], d: number, s: number, r: number) {
  return r8(clamp(w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]), S_MIN, S_MAX));
}
/** Same-day (short-term) review: S' = S · e^(w17·(G − 3 + w18)) · S^(−w19); never shrinks on Good/Easy. */
export function shortTermStability(w: readonly number[], s: number, g: Rating) {
  const sinc = Math.pow(s, -w[19]) * Math.exp(w[17] * (g - 3 + w[18]));
  return r8(clamp(s * (g >= 3 ? Math.max(sinc, 1) : sinc), S_MIN, S_MAX));
}
/** Days until R falls to the desired retention. */
export function intervalDays(s: number, p: FsrsParams = DEFAULT_PARAMS) {
  const { decay, factor } = decayFactor(p.w);
  const mod = r8((Math.pow(p.retention, 1 / decay) - 1) / factor);
  return Math.min(Math.max(1, Math.round(s * mod)), p.maxInterval);
}
/** Whole calendar days (UTC) between two instants, like ts-fsrs. */
function daysBetween(a: number, b: number) {
  const da = new Date(a), db = new Date(b);
  return Math.floor((Date.UTC(db.getUTCFullYear(), db.getUTCMonth(), db.getUTCDate()) - Date.UTC(da.getUTCFullYear(), da.getUTCMonth(), da.getUTCDate())) / DAY);
}

// ------------------------------------------------------------------ card state
interface Memory { state: State; s: number; d: number; last: number; step: number }

/** FSRS memory of a card; SM-2 cards (no stability yet) are migrated from their interval and ease. */
export function memoryOf(c: FsrsCard, now: number, p: FsrsParams = DEFAULT_PARAMS): Memory {
  if (c.stability && c.difficulty) return { state: c.state ?? "review", s: c.stability, d: c.difficulty, last: c.lastReview ?? now, step: c.step ?? 0 };
  if (!c.reps && !c.lapses && !c.lastReview) return { state: "new", s: 0, d: 0, last: now, step: 0 };
  // SM-2 card. ease 1.3 (hard) … 2.5 (default) … 3+ (easy) → D 10 … 5 … ≤2.5.
  const d = clamp(r8(5 + (2.5 - (c.ease || 2.5)) * 5), 1, 10);
  if (c.interval >= 1) {
    const last = c.due > 0 ? c.due - c.interval * DAY : now - c.interval * DAY;
    return { state: "review", s: c.interval, d, last: Math.min(last, now), step: 0 };
  }
  // Still in SM-2's minute steps: continue as a learning card.
  return { state: c.lapses ? "relearning" : "learning", s: initStability(p.w, 3), d, last: now, step: 0 };
}

/** ts-fsrs BasicLearningStepsStrategy: minutes + next step for each rating, or nothing (= graduate to review). */
function stepsFor(p: FsrsParams, state: State, cur: number): Partial<Record<Rating, { min: number; step: number }>> {
  const steps = state === "relearning" || state === "review" ? p.relearningSteps : p.learningSteps;
  if (!steps.length || cur >= steps.length) return {};
  const out: Partial<Record<Rating, { min: number; step: number }>> = {};
  if (state === "review") { out[1] = { min: steps[Math.max(0, cur)], step: 0 }; return out; }
  out[1] = { min: steps[0], step: 0 };
  out[2] = { min: steps.length === 1 ? Math.round(steps[0] * 1.5) : Math.round((steps[0] + steps[1]) / 2), step: cur };
  const nx = steps[cur + 1];
  if (nx) out[3] = { min: Math.round(nx), step: cur + 1 };
  return out;
}

/** The four possible next cards (Again, Hard, Good, Easy) for a review at `now`. */
export function scheduleAll(card: Card, now = Date.now(), p: FsrsParams = DEFAULT_PARAMS): [FsrsCard, FsrsCard, FsrsCard, FsrsCard] {
  const c = card as FsrsCard;
  const m = memoryOf(c, now, p);
  const w = p.w;
  const base = (): FsrsCard => ({ ...c, reps: c.reps + 1, lastReview: now, state: m.state, step: m.step });
  // Learning steps (new, learning, relearning cards, and Again on a review card).
  const applySteps = (n: FsrsCard, r: Rating, toState: State) => {
    const cur = m.state === "learning" && r !== 1 && r !== 2 ? m.step + 1 : m.step;
    const info = stepsFor(p, m.state, cur)[r];
    if (info && info.min > 0 && info.min < 1440) {
      n.state = toState; n.step = info.step; n.interval = 0; n.due = now + info.min * MIN;
    } else {
      n.state = "review"; n.step = 0;
      n.interval = intervalDays(n.stability!, p); n.due = now + n.interval * DAY;
    }
    return n;
  };
  const ratings: Rating[] = [1, 2, 3, 4];
  if (m.state === "new") {
    return ratings.map((r) => applySteps({ ...base(), difficulty: clamp(initDifficulty(w, r), 1, 10), stability: initStability(w, r) }, r, "learning")) as never;
  }
  if (m.state === "learning" || m.state === "relearning") {
    return ratings.map((r) => applySteps({ ...base(), difficulty: nextDifficulty(w, m.d, r), stability: shortTermStability(w, m.s, r) }, r, m.state)) as never;
  }
  // Review card
  const t = Math.max(0, daysBetween(m.last, now));
  const R = retrievability(t, m.s, w);
  const again: FsrsCard = { ...base(), lapses: c.lapses + 1, difficulty: nextDifficulty(w, m.d, 1), stability: clamp(r8(m.s / Math.exp(w[17] * w[18])), S_MIN, forgetStability(w, m.d, m.s, R)) };
  applySteps(again, 1, "relearning");
  const [hard, good, easy] = ([2, 3, 4] as Rating[]).map((r) => ({ ...base(), state: "review" as State, step: 0, difficulty: nextDifficulty(w, m.d, r), stability: recallStability(w, m.d, m.s, R, r) }));
  let hi = intervalDays(hard.stability!, p), gi = intervalDays(good.stability!, p);
  hi = Math.min(hi, gi); gi = Math.max(gi, hi + 1);
  const ei = Math.max(intervalDays(easy.stability!, p), gi + 1);
  for (const [n, i] of [[hard, hi], [good, gi], [easy, ei]] as const) { n.interval = i; n.due = now + i * DAY; }
  return [again, hard, good, easy];
}

export const schedule = (c: Card, g: Grade, now = Date.now(), p: FsrsParams = DEFAULT_PARAMS): FsrsCard => scheduleAll(c, now, p)[g];

/** "1m · 6m · 10m · 8d" style previews for the four grade buttons. */
export function previewIntervals(c: Card, now = Date.now(), p: FsrsParams = DEFAULT_PARAMS): string[] {
  return scheduleAll(c, now, p).map((n) => fmtInterval(n.due - now));
}
export function fmtInterval(ms: number) {
  const m = ms / MIN;
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  const d = m / 1440;
  return d < 30 ? `${Math.round(d)}d` : d < 365 ? `${Math.round(d / 30)}mo` : `${(d / 365).toFixed(1)}y`;
}
/** True while the card is in (re)learning steps: it comes back within minutes, so a session shows it again. */
export const inSteps = (c: Card) => c.state === "learning" || c.state === "relearning";
/** Scheduler parameters with the user's desired retention. */
export const paramsFor = (retention?: number): FsrsParams => ({ ...DEFAULT_PARAMS, retention: clamp(retention ?? 0.9, 0.7, 0.97) });
