// Ask chat + AI tutor logic tests. Run: npx tsx scripts/chat.test.ts
import assert from "node:assert/strict";
import type { ChatMessage } from "../shared/types";
import {
  answerMarkdown, autoTitle, capThread, isCasual, isNotInNotes, localSummary, MAX_MESSAGES, mergeRanked, mockRewrite, needsRewrite,
  needsSummary, parseFollowups, plainTurn, SUMMARY_BATCH, threadsToPrune, windowHistory,
} from "../src/lib/chat";
import {
  CHECK_QUESTIONS, HINT_COST, initTutor, loadTutor, materialSources, mockTutor, parseFeynman, parseGrade, parsePlan, parseSocratic, parseSummary,
  SOCRATIC_QUESTIONS, tutorPassed, tutorProgress, tutorReduce, tutorScore, type TutorEvent, type TutorState,
} from "../src/lib/tutor";

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log("ok -", name); };
let id = 0;
const msg = (role: ChatMessage["role"], text: string, p: Partial<ChatMessage> = {}): ChatMessage => ({ id: `m${++id}`, role, text, at: id, ...p });
const turns = (k: number) => Array.from({ length: k }, (_, i) => [msg("user", `Question ${i}`), msg("assistant", `Answer ${i} [1]`)]).flat();

// ------------------------------------------------------------------ rewrite trigger
t("no rewrite for the first question", () => {
  assert.equal(needsRewrite("And how does that compare to Adam?", []), false);
});
t("follow-ups with pronouns / connectives are rewritten", () => {
  const h = [msg("user", "What is AdamW?"), msg("assistant", "AdamW is …")];
  assert.equal(needsRewrite("And how does that compare to Adam?", h), true);
  assert.equal(needsRewrite("why?", h), true);
  assert.equal(needsRewrite("what about CNNs", h), true);
  assert.equal(needsRewrite("وماذا عن هذا؟", h), true);
});
t("short follow-ups are rewritten even without a cue", () => {
  const h = [msg("user", "Explain batch norm"), msg("assistant", "…")];
  assert.equal(needsRewrite("for transformers?", h), true);
});
t("long standalone questions and small talk skip the rewrite", () => {
  const h = [msg("user", "Explain batch norm"), msg("assistant", "…")];
  assert.equal(needsRewrite("Explain how gradient descent with momentum accumulates velocity across many optimization steps in practice", h), false);
  for (const s of ["thanks", "Thank you!", "ok", "شكرا", "got it."]) { assert.equal(isCasual(s), true, s); assert.equal(needsRewrite(s, h), false, s); }
  assert.equal(isCasual("what is attention"), false);
});
t("mock rewrite keeps the follow-up and adds the earlier topic", () => {
  const r = mockRewrite("And how does that compare to Adam?", [{ role: "user", text: "What is AdamW weight decay?" }]);
  assert.match(r, /Adam/);
  assert.match(r, /AdamW/);
});

// ------------------------------------------------------------------ history window + summary
t("window keeps the last 4 turns, oldest first", () => {
  const ms = turns(7);
  const w = windowHistory({ messages: ms });
  assert.equal(w.usedTurns, 4);
  assert.equal(w.recent[0].text, "Question 3");
  assert.equal(w.recent.at(-1)!.text, "Answer 6");
  assert.equal(w.pending.length, 6); // 3 older turns not summarized yet
  assert.equal(needsSummary({ messages: ms }), true);
});
t("citations are stripped from history sent to the model", () => {
  assert.equal(plainTurn(msg("assistant", "AdamW decouples decay [1][2, 3].")).text, "AdamW decouples decay .");
});
t("summary covers older turns; nothing pending afterwards", () => {
  const ms = turns(7);
  const w = windowHistory({ messages: ms, summary: "- earlier", summarized: 6 });
  assert.equal(w.pending.length, 0);
  assert.equal(w.summary, "- earlier");
  assert.equal(needsSummary({ messages: ms, summarized: 6 }), false);
});
t("short threads are sent whole and need no summary", () => {
  const ms = turns(2);
  const w = windowHistory({ messages: ms });
  assert.equal(w.recent.length, 4);
  assert.equal(w.pending.length, 0);
  assert.ok(SUMMARY_BATCH >= 2);
});
t("empty 'not in your notes' answers are skipped in history", () => {
  const ms = [msg("user", "Who invented X?"), msg("assistant", "", { empty: "none" }), msg("user", "ok")];
  assert.deepEqual(windowHistory({ messages: ms }).recent.map((x) => x.role), ["user", "user"]);
});
t("local summary lists earlier questions", () => {
  const s = localSummary("", turns(2));
  assert.match(s, /Question 0/);
  assert.match(s, /Question 1/);
});

// ------------------------------------------------------------------ thread caps
t("cap drops the oldest whole turns and folds them into the summary", () => {
  const ms = turns(30); // 60 messages
  const c = capThread({ messages: ms, summary: "", summarized: 0 });
  assert.ok(c.messages.length <= MAX_MESSAGES);
  assert.equal(c.messages[0].role, "user");
  assert.match(c.summary!, /Question 0/);
  assert.equal(c.summarized, 0);
});
t("cap keeps the summary pointer when dropped turns were already summarized", () => {
  const ms = turns(30);
  const c = capThread({ messages: ms, summary: "- s", summarized: 30 });
  assert.equal(c.summary, "- s");
  assert.equal(c.summarized, 30 - (60 - c.messages.length));
});
t("cap trims long messages and passages", () => {
  const big = msg("assistant", "x".repeat(10_000), { sources: Array.from({ length: 14 }, (_, i) => ({ n: i + 1, noteId: "a", title: "A", text: "y".repeat(2000) })), followups: ["a?", "b?", "c?", "d?"] });
  const c = capThread({ messages: [big] });
  assert.equal(c.messages[0].text.length, 6000);
  assert.equal(c.messages[0].sources!.length, 10);
  assert.equal(c.messages[0].sources![0].text.length, 500);
  assert.equal(c.messages[0].followups!.length, 3);
});
t("prune keeps pinned threads and the newest ones", () => {
  const ts = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, pinned: (i === 0 ? 1 : 0) as 0 | 1, updatedAt: i, deleted: 0 as const }));
  assert.deepEqual(threadsToPrune(ts, 2).sort(), ["t1", "t2"]);
});

// ------------------------------------------------------------------ retrieval merge, titles, parsing
t("merge ranks passages found by both queries first and renumbers", () => {
  const a = [{ id: "x", n: 1 }, { id: "y", n: 2 }], b = [{ id: "z", n: 1 }, { id: "y", n: 2 }];
  const m = mergeRanked([a, b], 8);
  assert.equal(m[0].id, "y");
  assert.deepEqual(m.map((x) => x.n), [1, 2, 3]);
  assert.equal(mergeRanked([a, b], 2).length, 2);
});
t("auto title: first sentence, ≤ 60 chars at a word boundary", () => {
  assert.equal(autoTitle("What is AdamW? And why?"), "What is AdamW?");
  const long = autoTitle("Explain how the transformer attention mechanism weighs every token against every other token");
  assert.ok(long.length <= 61 && long.endsWith("…"));
});
t("follow-ups parse to 3 clean questions", () => {
  assert.deepEqual(parseFollowups("Here are some:\n1. How is it used?\n- \"Why does it work?\"\n* What breaks it?\n4. Extra one?"), ["How is it used?", "Why does it work?", "What breaks it?"]);
});
t("not-in-notes detection (English + Arabic)", () => {
  assert.equal(isNotInNotes("Not in your notes."), true);
  assert.equal(isNotInNotes("**ليس في ملاحظاتك.**"), true);
  assert.equal(isNotInNotes("Not in your notes, but [1] covers X."), false);
});
t("answer markdown links citations and labels general knowledge", () => {
  const md = answerMarkdown({ text: "AdamW decouples decay [1].", sources: [{ n: 1, noteId: "a", title: "AdamW", text: "" }] });
  assert.match(md, /\[\[AdamW\|1\]\]/);
  assert.match(md, /\*\*Sources\*\*\n1\. \[\[AdamW\]\]/);
  assert.match(answerMarkdown({ text: "In general…", general: 1 }), /not from your notes/);
});

// ------------------------------------------------------------------ tutor state machine
const run = (s: TutorState, ...es: TutorEvent[]) => es.reduce(tutorReduce, s);
const steps = [{ title: "a", text: "A" }, { title: "b", text: "B" }];
const checks = [{ q: "q1", answer: "a1" }, { q: "q2", answer: "a2" }, { q: "q3", answer: "a3" }];
t("explain: steps → 3-question check → done → summary", () => {
  let s = run(initTutor("explain"), { type: "plan", steps, checks });
  assert.equal(s.phase, "step");
  assert.equal(tutorProgress(s).label, "Step 1 of 2");
  s = run(s, { type: "rephrased" }, { type: "got-it" });
  assert.equal(s.step, 1);
  assert.equal(s.retries, 0);
  s = run(s, { type: "got-it" });
  assert.equal(s.phase, "check");
  assert.equal(tutorProgress(s).label, "Question 1 of 3");
  s = run(s, { type: "graded", verdict: "correct" }, { type: "graded", verdict: "partly" });
  assert.equal(s.check, 2);
  s = run(s, { type: "graded", verdict: "correct" });
  assert.equal(s.phase, "done");
  assert.equal(Math.round(tutorScore(s) * 100), 83);
  assert.equal(tutorPassed(s), true);
  s = run(s, { type: "summary", summary: { right: [], gaps: [], cards: [], score: tutorScore(s), passed: true } });
  assert.equal(s.phase, "summary");
  assert.equal(run(s, { type: "got-it" }), s); // out-of-phase events are ignored
});
t("explain: failing the check doesn't pass", () => {
  const s = run(initTutor("explain"), { type: "plan", steps, checks }, { type: "got-it" }, { type: "got-it" },
    { type: "graded", verdict: "not_yet" }, { type: "graded", verdict: "partly" }, { type: "graded", verdict: "correct" });
  assert.equal(tutorPassed(s), false);
  assert.equal(CHECK_QUESTIONS, 3);
});
t("socratic: hint ladder lowers the score; Show answer scores 0", () => {
  const q = { q: "Q?", hints: ["h1", "h2"], answer: "A" };
  let s = run(initTutor("socratic"), { type: "question", q });
  assert.equal(s.phase, "question");
  s = run(s, { type: "graded", verdict: "not_yet" });
  assert.equal(s.phase, "question");
  assert.equal(s.tries, 1);
  s = run(s, { type: "hint" }, { type: "hint" }, { type: "hint" });
  assert.equal(s.hint, 2); // capped at the number of hints
  s = run(s, { type: "graded", verdict: "correct" });
  assert.equal(s.phase, "closed");
  assert.equal(s.results[0], 1 - 2 * HINT_COST);
  s = run(s, { type: "question", q }, { type: "show-answer" });
  assert.equal(s.results[1], 0);
  assert.equal(s.hint, 3);
});
t("socratic: finishes after the last question", () => {
  const q = { q: "Q?", hints: ["h"], answer: "A" };
  let s = initTutor("socratic");
  for (let i = 0; i < SOCRATIC_QUESTIONS; i++) s = run(s, { type: "question", q }, { type: "graded", verdict: "correct" });
  assert.equal(s.phase, "done");
  assert.equal(tutorScore(s), 1);
  assert.equal(tutorPassed(s), true);
  assert.equal(run(s, { type: "question", q }).asked, SOCRATIC_QUESTIONS); // no new question once done
});
t("feynman: the last clarity score counts", () => {
  let s = initTutor("feynman");
  assert.equal(s.phase, "explain");
  assert.equal(tutorPassed(s), false);
  s = run(s, { type: "reviewed", score: 55 }, { type: "reviewed", score: 140 });
  assert.equal(s.reviews.at(-1), 100);
  assert.equal(tutorPassed(s), true);
  assert.equal(tutorProgress(s).label, "Attempt 3");
});
t("stored state round-trips; a foreign shape resets", () => {
  const s = run(initTutor("explain"), { type: "plan", steps, checks });
  assert.deepEqual(loadTutor(JSON.parse(JSON.stringify(s)), "explain"), s);
  assert.equal(loadTutor({ v: 2 }, "explain").phase, "start");
  assert.equal(loadTutor(s, "socratic").mode, "socratic");
});

// ------------------------------------------------------------------ tutor parsing + mock
t("parsers tolerate fences and prose", () => {
  const p = parsePlan("Sure!\n```json\n{\"steps\":[{\"title\":\"T\",\"text\":\"X [1]\"}],\"check\":[{\"q\":\"Q\",\"answer\":\"A\"}]}\n```");
  assert.equal(p!.steps[0].text, "X [1]");
  assert.equal(p!.checks.length, 1);
  assert.equal(parsePlan("no json"), null);
  assert.equal(parseGrade('{"verdict":"Partially","feedback":"f"}')!.verdict, "partly");
  assert.equal(parseGrade('{"verdict":"not yet"}')!.verdict, "not_yet");
  const so = parseSocratic('{"verdict":"correct","feedback":"ok","question":"Next?","hints":["a","b","c"],"answer":"x","done":false}')!;
  assert.equal(so.q!.hints.length, 2);
  assert.equal(parseSocratic('{"question":"First?"}')!.verdict, undefined);
  const fy = parseFeynman('{"score":"71","reasons":[{"label":"Accuracy","score":90}],"issues":[{"quote":"q","kind":"weird","comment":"c"}],"ask":"again"}')!;
  assert.equal(fy.score, 71);
  assert.equal(fy.issues[0].kind, "gap");
  assert.equal(parseSummary('{"right":["a"],"gaps":[],"cards":[{"question":"Q","answer":"A"}]}')!.cards[0].q, "Q");
});
t("material → numbered sources without front-matter", () => {
  const s = materialSources([{ id: "a", title: "A", body: "---\ntype: lesson\n---\n# A\n\nBody text." }, { id: "b", title: "B", body: "" }]);
  assert.equal(s.length, 1);
  assert.equal(s[0].n, 1);
  assert.equal(s[0].text, "Body text.");
});
t("mock tutor answers every op with parseable JSON", () => {
  const sources = [{ n: 1, title: "Attention", text: "Attention lets each token look at every other token and weigh them by relevance. The weights come from a softmax over scaled dot products." }];
  const body = { concept: "Attention", sources };
  assert.ok(parsePlan(mockTutor("plan", body))!.steps.length >= 3);
  assert.ok(parseJson(mockTutor("rephrase", { ...body, extra: { how: "example" } })));
  assert.equal(parseGrade(mockTutor("grade", { ...body, input: "each token weighs other tokens by relevance", extra: { expected: "Attention lets each token weigh other tokens by relevance" } }))!.verdict, "correct");
  assert.ok(parseSocratic(mockTutor("socratic", body))!.q);
  const fy = parseFeynman(mockTutor("feynman", { ...body, input: "Attention uses the Softmax to mix tokens." }))!;
  assert.ok(fy.score > 0 && fy.reasons.length === 4) // Accuracy, Completeness, Plain words, Structure (R5-24E);
  assert.ok(parseSummary(mockTutor("summary", body))!.cards.length >= 3);
});
function parseJson(s: string) { try { return JSON.parse(s); } catch { return null; } }

console.log(`\n${n} tests passed`);
