// FSRS Advanced settings + "Optimize from history" tests. Run: npx tsx scripts/fsrs-optimize.test.ts
import { DEFAULT_W, paramsFor, parseSteps, schedule, userParams, retrievability } from "../src/lib/fsrs";
import { fitWeights, replayLoss, byCard, MIN_REVIEWS, type LogRow } from "../src/lib/fsrs-optimize";
import { newCard } from "../src/lib/srs";

let failed = 0, passed = 0;
function ok(cond: unknown, msg: string) { if (cond) passed++; else { failed++; console.error("FAIL:", msg); } }
const DAY = 86_400_000;

// ---- steps parsing + params
ok(JSON.stringify(parseSteps("1, 10")) === "[1,10]", "parseSteps 1, 10");
ok(JSON.stringify(parseSteps("1m 1h")) === "[1,60]", "parseSteps 1m 1h");
ok(parseSteps("2d") === null, "parseSteps rejects days");
ok(parseSteps("abc") === null, "parseSteps rejects text");
ok(paramsFor(0.9, { maxInterval: 30 }).maxInterval === 30, "maxInterval override");
ok(paramsFor(0.9, { w: [1, 2] }).w === DEFAULT_W, "bad weights ignored");

// max interval caps scheduling
{
  const t0 = Date.UTC(2026, 0, 1);
  const p = userParams({ retention: 0.9, fsrsMaxInterval: 5, fsrsLearningSteps: [], fsrsRelearningSteps: [10] });
  let c = schedule(newCard("x:1", "x"), 3, t0, p); // Easy, no learning steps → review
  ok(c.state === "review" && c.interval <= 5, `max interval 5 days after Easy (got ${c.interval})`);
  c = schedule(c, 3, t0 + 5 * DAY, p);
  ok(c.interval <= 5, `still capped (got ${c.interval})`);
  // learning steps honoured
  const q = userParams({ retention: 0.9, fsrsLearningSteps: [2, 30] });
  const l = schedule(newCard("y:1", "y"), 2, t0, q); // Good on a new card → next step (30 min)
  ok(l.state === "learning" && Math.round((l.due - t0) / 60000) === 30, `learning step 30m (got ${(l.due - t0) / 60000})`);
  const a = schedule(newCard("z:1", "z"), 0, t0, q);
  ok(Math.round((a.due - t0) / 60000) === 2, "Again → first step 2m");
}

// ---- optimizer on synthetic history from "true" weights with larger initial stabilities
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const TRUE_W = [...DEFAULT_W]; TRUE_W[0] = 0.8; TRUE_W[1] = 3; TRUE_W[2] = 8; TRUE_W[3] = 20;
const rand = rng(42);
const logs: LogRow[] = [];
const t0 = Date.UTC(2026, 0, 1);
for (let k = 0; k < 400; k++) {
  const id = `c${k}`;
  let at = t0 + k * 3600_000;
  const first = (rand() < 0.15 ? 0 : rand() < 0.2 ? 1 : rand() < 0.85 ? 2 : 3) as 0 | 1 | 2 | 3;
  logs.push({ cardId: id, at, grade: first });
  // true memory under TRUE_W, reviewed at a randomish interval; record outcome sampled from true R
  let s = Math.max(TRUE_W[first], 0.1);
  for (let r = 0; r < 4; r++) {
    const t = Math.max(1, Math.round(s * (0.5 + rand() * 1.5)));
    at += t * DAY;
    const R = retrievability(t, s, TRUE_W);
    const recalled = rand() < R;
    const g = (recalled ? 2 : 0) as 0 | 2;
    logs.push({ cardId: id, at, grade: g });
    s = recalled ? s * 2.5 : Math.max(0.5, s * 0.3);
  }
}
const cards = byCard(logs);
const base = replayLoss(DEFAULT_W, cards);
ok(base.n >= MIN_REVIEWS, `enough long-term reviews (${base.n})`);
const res = await fitWeights(logs, { maxRounds: 12 });
ok(!!res, "fit returns a result");
if (res) {
  ok(res.after < res.before, `log loss improves ${res.before.toFixed(4)} → ${res.after.toFixed(4)}`);
  ok(res.w.length === 21 && res.w.every(Number.isFinite), "21 finite weights");
  ok(res.w[2] > DEFAULT_W[2], `Good initial stability moves toward the truth (${DEFAULT_W[2]} → ${res.w[2]})`);
  ok(res.w[0] <= res.w[1] && res.w[1] <= res.w[2] && res.w[2] <= res.w[3], "initial stabilities ordered");
}
ok((await fitWeights(logs.slice(0, 30))) === null, "too little history → no fit");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
