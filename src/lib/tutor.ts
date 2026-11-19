// AI tutor modes (Explain · Socratic · Feynman): the pure session state machine, scoring, response parsing and the
// dev-simulator mock. No app state or I/O here (unit-tested by scripts/chat.test.ts). Runtime: src/components/TutorSession.tsx;
// prompts: worker/ext/tutor.ts. Docs: docs/CHAT_AND_TUTOR.md.
import type { ChatSource } from "../../shared/types";
import { t } from "./i18n";

export type TutorMode = "explain" | "socratic" | "feynman";
export const TUTOR_MODES: TutorMode[] = ["explain", "socratic", "feynman"];
export type Verdict = "correct" | "partly" | "not_yet";
export const VERDICT_SCORE: Record<Verdict, number> = { correct: 1, partly: 0.5, not_yet: 0 };
/** Same bar as concept practice: 80 % marks the concept learned. */
export const TUTOR_PASS = 0.8;
export const SOCRATIC_QUESTIONS = 4;
export const CHECK_QUESTIONS = 3;
/** Each hint used takes this much off a Socratic question's score; "Show answer" scores 0. */
export const HINT_COST = 0.25;

export const TUTOR_STR = {
  get learnWithTutor() { return t("Learn with tutor"); },
  get tutor() { return t("Tutor"); },
  get explainName() { return t("Explain"); },
  get explainWhat() { return t("Step by step, then a 3-question check"); },
  get socraticName() { return t("Socratic"); },
  get socraticWhat() { return t("Guiding questions with hints; it won't give the answer straight away"); },
  get feynmanName() { return t("Feynman"); },
  get feynmanWhat() { return t("You explain it; the tutor finds gaps, wrong statements and unexplained jargon"); },
  get start() { return t("Start"); },
  get gotIt() { return t("Got it"); },
  get differently() { return t("Explain differently"); },
  get example() { return t("Example"); },
  get hint1() { return t("Hint 1"); },
  get hint2() { return t("Hint 2"); },
  get showAnswer() { return t("Show answer"); },
  get answerPlaceholder() { return t("Your answer…"); },
  get explainPlaceholder() { return t("Explain it in your own words, as if to a friend…"); },
  get submit() { return t("Check"); },
  get submitExplain() { return t("Review my explanation"); },
  get endSession() { return t("End session"); },
  get correct() { return t("Correct"); },
  get partly() { return t("Partly"); },
  get notYet() { return t("Not yet"); },
  get clarity() { return t("Clarity"); },
  get gap() { return t("Gap"); },
  get wrong() { return t("Not right"); },
  get jargon() { return t("Unexplained jargon"); },
  get fixIt() { return t("Fix it and explain again"); },
  get summaryTitle() { return t("Session summary"); },
  get right() { return t("What you got right"); },
  get gaps() { return t("Gaps"); },
  get cards() { return t("Suggested flashcards"); },
  get saveAll() { return t("Save all"); },
  saveCards: (n: number) => t("Save {n} card|Save {n} cards", { n }),
  get saved() { return t("Saved"); },
  get markLearned() { return t("Mark concept learned"); },
  get learned() { return t("Learned"); },
  get schedule() { return t("Schedule a review"); },
  scheduled: (d: string) => t("Review on {d}", { d }),
  get history() { return t("Tutor sessions"); },
  get noHistory() { return t("No tutor sessions yet."); },
  get pickConcept() { return t("What do you want to learn?"); },
  get pickHint() { return t("Pick a concept from a learning path, or the note you're reading."); },
  fromNotes: (n: number) => t("Grounded in {n} note|Grounded in {n} notes", { n }),
  get noNotes() { return t("No notes linked to this concept yet: the tutor uses general knowledge and says so."); },
  get loading() { return t("Preparing from your notes…"); },
  progressStep: (i: number, n: number) => t("Step {i} of {n}", { i, n }),
  progressQ: (i: number, n: number) => t("Question {i} of {n}", { i, n }),
  progressAttempt: (i: number) => t("Attempt {i}", { i }),
  score: (p: number) => t("{p}%", { p: Math.round(p * 100) }),
  get passed() { return t("Passed"); },
  get notPassed() { return t("Not passed yet"); },
  get next() { return t("Next question"); },
  get finish() { return t("See summary"); },
  get again() { return t("Try again"); },
} as const;

export const MODE_INFO: Record<TutorMode, { name: string; what: string; glyph: string }> = {
  explain: { get name() { return TUTOR_STR.explainName; }, get what() { return TUTOR_STR.explainWhat; }, glyph: "lesson" },
  socratic: { get name() { return TUTOR_STR.socraticName; }, get what() { return TUTOR_STR.socraticWhat; }, glyph: "c-question" },
  feynman: { get name() { return TUTOR_STR.feynmanName; }, get what() { return TUTOR_STR.feynmanWhat; }, glyph: "voice" },
};

// ------------------------------------------------------------------ session state
export interface TutorStep { title: string; text: string }
export interface TutorCheck { q: string; answer: string }
export interface SocraticQ { q: string; hints: string[]; answer: string }
export interface FeynmanReview { score: number; reasons: { label: string; score: number; note?: string }[]; issues: { quote: string; kind: "gap" | "wrong" | "jargon"; comment: string }[]; ask: string }
export interface TutorSummary { right: string[]; gaps: string[]; cards: { q: string; a: string }[]; score: number; passed: boolean; savedCards?: number; learned?: 1; reviewOn?: string }

export type TutorPhase =
  | "start"      // nothing loaded yet
  | "step"       // explain: reading step `step`
  | "check"      // explain: answering check `check`
  | "question"   // socratic: answering `q`
  | "closed"     // socratic: current question closed (correct / answer shown) → next or finish
  | "explain"    // feynman: waiting for the learner's explanation
  | "done"       // all questions answered → summary next
  | "summary";   // summary shown
export interface TutorState {
  v: 1;
  mode: TutorMode;
  phase: TutorPhase;
  // explain
  steps: TutorStep[]; step: number; retries: number; checks: TutorCheck[]; check: number;
  // socratic
  q: SocraticQ | null; asked: number; hint: number; tries: number;
  // feynman
  reviews: number[];
  /** Scores 0–1 per closed check / question. */
  results: number[];
  summary: TutorSummary | null;
}

export const initTutor = (mode: TutorMode): TutorState => ({
  v: 1, mode, phase: mode === "feynman" ? "explain" : "start", steps: [], step: 0, retries: 0, checks: [], check: 0,
  q: null, asked: 0, hint: 0, tries: 0, reviews: [], results: [], summary: null,
});

export type TutorEvent =
  | { type: "plan"; steps: TutorStep[]; checks: TutorCheck[] }
  | { type: "got-it" }
  | { type: "rephrased" }
  | { type: "graded"; verdict: Verdict }
  | { type: "question"; q: SocraticQ }
  | { type: "hint" }
  | { type: "show-answer" }
  | { type: "reviewed"; score: number }
  | { type: "finish" }
  | { type: "summary"; summary: TutorSummary };

/** The tutor state machine. Unknown / out-of-phase events leave the state unchanged. */
export function tutorReduce(s: TutorState, e: TutorEvent): TutorState {
  switch (e.type) {
    case "plan":
      if (s.mode !== "explain" || !e.steps.length) return s;
      return { ...s, steps: e.steps, checks: e.checks.slice(0, CHECK_QUESTIONS), step: 0, retries: 0, check: 0, results: [], phase: "step" };
    case "got-it":
      if (s.phase !== "step") return s;
      if (s.step + 1 < s.steps.length) return { ...s, step: s.step + 1, retries: 0 };
      return { ...s, phase: s.checks.length ? "check" : "done", check: 0 };
    case "rephrased":
      return s.phase === "step" ? { ...s, retries: s.retries + 1 } : s;
    case "graded": {
      const sc = VERDICT_SCORE[e.verdict];
      if (s.phase === "check") {
        const results = [...s.results, sc];
        return s.check + 1 < s.checks.length ? { ...s, results, check: s.check + 1 } : { ...s, results, phase: "done" };
      }
      if (s.phase === "question") {
        if (e.verdict === "correct") return close(s, Math.max(0, 1 - HINT_COST * s.hint));
        return { ...s, tries: s.tries + 1 };
      }
      return s;
    }
    case "question":
      if (s.mode !== "socratic" || (s.phase !== "start" && s.phase !== "closed")) return s;
      return { ...s, q: e.q, asked: s.asked + 1, hint: 0, tries: 0, phase: "question" };
    case "hint":
      return s.phase === "question" && s.q ? { ...s, hint: Math.min(s.hint + 1, Math.min(2, s.q.hints.length)) } : s;
    case "show-answer":
      return s.phase === "question" ? { ...close(s, 0), hint: 3 } : s;
    case "reviewed":
      return s.mode === "feynman" ? { ...s, reviews: [...s.reviews, Math.max(0, Math.min(100, Math.round(e.score)))], phase: "explain" } : s;
    case "finish":
      return s.phase === "summary" ? s : { ...s, phase: "done" };
    case "summary":
      return { ...s, summary: e.summary, phase: "summary" };
  }
}
function close(s: TutorState, score: number): TutorState {
  const results = [...s.results, score];
  return { ...s, results, phase: s.asked >= SOCRATIC_QUESTIONS ? "done" : "closed" };
}

/** Session score 0–1: mean of check / question scores (Explain, Socratic), last clarity score (Feynman). */
export function tutorScore(s: TutorState): number {
  if (s.mode === "feynman") return s.reviews.length ? s.reviews[s.reviews.length - 1] / 100 : 0;
  return s.results.length ? s.results.reduce((a, b) => a + b, 0) / s.results.length : 0;
}
/** Passed = score ≥ 80 % with enough evidence (all 3 checks, ≥ 3 Socratic questions, or one Feynman review). */
export function tutorPassed(s: TutorState): boolean {
  const enough = s.mode === "feynman" ? s.reviews.length > 0 : s.mode === "explain" ? s.results.length >= Math.min(CHECK_QUESTIONS, s.checks.length || CHECK_QUESTIONS) : s.results.length >= 3;
  return enough && tutorScore(s) >= TUTOR_PASS;
}
export function tutorProgress(s: TutorState): { done: number; total: number; label: string } {
  if (s.mode === "explain") {
    const total = s.steps.length + s.checks.length;
    if (s.phase === "check") return { done: s.steps.length + s.check, total, label: TUTOR_STR.progressQ(s.check + 1, s.checks.length) };
    if (s.phase === "done" || s.phase === "summary") return { done: total, total, label: TUTOR_STR.finish };
    return { done: s.step, total: Math.max(total, 1), label: s.steps.length ? TUTOR_STR.progressStep(s.step + 1, s.steps.length) : TUTOR_STR.loading };
  }
  if (s.mode === "socratic") return { done: s.results.length, total: SOCRATIC_QUESTIONS, label: TUTOR_STR.progressQ(Math.max(1, s.asked), SOCRATIC_QUESTIONS) };
  return { done: Math.min(s.reviews.length, 3), total: 3, label: TUTOR_STR.progressAttempt(s.reviews.length + 1) };
}
export const verdictLabel = (v: Verdict) => (v === "correct" ? TUTOR_STR.correct : v === "partly" ? TUTOR_STR.partly : TUTOR_STR.notYet);
export const verdictColor = (v: Verdict) => (v === "correct" ? "var(--success)" : v === "partly" ? "var(--warning)" : "var(--danger, #e5534b)");

/** Restore a stored state (threads sync as JSON; older/foreign shapes fall back to a fresh state). */
export function loadTutor(raw: unknown, mode: TutorMode): TutorState {
  const r = raw as Partial<TutorState> | undefined;
  if (!r || r.v !== 1 || r.mode !== mode) return initTutor(mode);
  return { ...initTutor(mode), ...r };
}

// ------------------------------------------------------------------ material → numbered sources
export interface MaterialNote { id: string; title: string; body: string }
const stripFm = (b: string) => b.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").replace(/^#\s+.*\n/, "").trim();
/** Concept notes → numbered excerpts the tutor cites as [n] (budget split evenly, at most 6 notes). */
export function materialSources(notes: MaterialNote[], budget = 14_000): ChatSource[] {
  const list = notes.slice(0, 6);
  const per = list.length ? Math.floor(budget / list.length) : 0;
  return list.map((n, i) => ({ n: i + 1, noteId: n.id, title: n.title, text: stripFm(n.body).slice(0, per) })).filter((s) => s.text.length > 0);
}

// ------------------------------------------------------------------ parsing the model's JSON
export function parseJson<T = Record<string, unknown>>(raw: string): T | null {
  const s = raw.replace(/```(?:json)?/gi, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)) as T; } catch { return null; }
}
const str = (x: unknown) => (typeof x === "string" ? x.trim() : typeof x === "number" ? String(x) : "");
export const asVerdict = (x: unknown): Verdict => { const v = str(x).toLowerCase().replace(/[\s-]+/g, "_"); return v === "correct" || v === "right" ? "correct" : v === "partly" || v === "partial" || v === "partially" ? "partly" : "not_yet"; };

export function parsePlan(raw: string): { steps: TutorStep[]; checks: TutorCheck[] } | null {
  const j = parseJson<{ steps?: unknown[]; check?: unknown[]; checks?: unknown[] }>(raw);
  if (!j || !Array.isArray(j.steps)) return null;
  const steps = (j.steps as Record<string, unknown>[]).map((x) => ({ title: str(x?.title), text: str(x?.text ?? x?.body) })).filter((x) => x.text).slice(0, 6);
  const checks = ((j.check ?? j.checks ?? []) as Record<string, unknown>[]).map((x) => ({ q: str(x?.q ?? x?.question), answer: str(x?.answer) })).filter((x) => x.q).slice(0, CHECK_QUESTIONS);
  return steps.length ? { steps, checks } : null;
}
export function parseGrade(raw: string): { verdict: Verdict; feedback: string } | null {
  const j = parseJson<{ verdict?: unknown; feedback?: unknown }>(raw);
  return j ? { verdict: asVerdict(j.verdict), feedback: str(j.feedback) } : null;
}
export function parseSocratic(raw: string): { verdict?: Verdict; feedback: string; q: SocraticQ | null; done: boolean } | null {
  const j = parseJson<{ verdict?: unknown; feedback?: unknown; question?: unknown; hints?: unknown[]; answer?: unknown; done?: unknown }>(raw);
  if (!j) return null;
  const q = str(j.question);
  return {
    verdict: j.verdict == null || j.verdict === "" ? undefined : asVerdict(j.verdict), feedback: str(j.feedback), done: j.done === true,
    q: q ? { q, hints: (Array.isArray(j.hints) ? j.hints : []).map(str).filter(Boolean).slice(0, 2), answer: str(j.answer) } : null,
  };
}
export function parseFeynman(raw: string): FeynmanReview | null {
  const j = parseJson<{ score?: unknown; reasons?: unknown[]; issues?: unknown[]; ask?: unknown }>(raw);
  if (!j) return null;
  const num = (x: unknown) => Math.max(0, Math.min(100, Math.round(Number(x) || 0)));
  const kinds = new Set(["gap", "wrong", "jargon"]);
  return {
    score: num(j.score),
    reasons: (Array.isArray(j.reasons) ? j.reasons : []).map((r) => r as Record<string, unknown>).map((r) => ({ label: str(r.label), score: num(r.score), note: str(r.note) || undefined })).filter((r) => r.label).slice(0, 5),
    issues: (Array.isArray(j.issues) ? j.issues : []).map((r) => r as Record<string, unknown>).map((r) => ({ quote: str(r.quote), kind: (kinds.has(str(r.kind)) ? str(r.kind) : "gap") as "gap" | "wrong" | "jargon", comment: str(r.comment) })).filter((r) => r.comment).slice(0, 6),
    ask: str(j.ask),
  };
}
export function parseSummary(raw: string): { right: string[]; gaps: string[]; cards: { q: string; a: string }[] } | null {
  const j = parseJson<{ right?: unknown[]; gaps?: unknown[]; cards?: unknown[] }>(raw);
  if (!j) return null;
  const list = (x: unknown) => (Array.isArray(x) ? x.map(str).filter(Boolean).slice(0, 6) : []);
  const cards = (Array.isArray(j.cards) ? j.cards : []).map((c) => c as Record<string, unknown>).map((c) => ({ q: str(c.q ?? c.question), a: str(c.a ?? c.answer) })).filter((c) => c.q && c.a).slice(0, 5);
  return { right: list(j.right), gaps: list(j.gaps), cards };
}
/** Flashcard lines (`- Q :: A`) for a cards note. */
export const cardLines = (cards: { q: string; a: string }[]) => cards.map((c) => `- ${c.q.replace(/\s*\n+\s*/g, " ").replace(/::/g, ":")} :: ${c.a.replace(/\s*\n+\s*/g, " ").replace(/::/g, ":")}`);

// ------------------------------------------------------------------ dev-simulator mock (demo mode, AI = mock)
const sentences = (t: string) => t.split(/\n+/).filter((l) => !/::|!\[|https?:|^\s*[|`{]|\{\{/.test(l)).join("\n")
  .replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, "$1").replace(/[#>*_`|]+/g, " ").replace(/^\s*-\s+/gm, "").split(/(?<=[.!?؟])\s+|\n+/).map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length > 25 && x.length < 260);
const terms = (t: string) => new Set(t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3));
/** Word overlap of an answer with the expected answer (0–1). */
export function overlap(answer: string, expected: string) {
  const e = terms(expected), a = terms(answer);
  if (!e.size) return a.size ? 0.5 : 0;
  let hit = 0;
  for (const w of e) if (a.has(w) || [...a].some((x) => x.startsWith(w.slice(0, 5)))) hit++;
  return hit / e.size;
}
const gradeOf = (o: number): Verdict => (o >= 0.5 ? "correct" : o >= 0.2 ? "partly" : "not_yet");

/** Canned tutor replies built from the material (same JSON shapes as the Worker), so every flow works offline in demo. */
export function mockTutor(op: string, body: { concept: string; sources: Pick<ChatSource, "n" | "title" | "text">[]; input?: string; extra?: Record<string, unknown>; history?: { role: string; text: string }[] }): string {
  const { concept, sources } = body;
  const pool = sources.flatMap((s) => sentences(s.text).map((t) => ({ t, n: s.n })));
  const pick = (i: number) => pool.length ? pool[i % pool.length] : { t: `${concept} is a core idea of this course.`, n: 0 };
  const cite = (n: number) => (n ? ` [${n}]` : "");
  switch (op) {
    case "plan": {
      const steps = [0, 1, 2].map((i) => { const p = pick(i); return { title: ["The idea", "How it works", "Why it matters"][i], text: `**Mock tutor (simulator).** ${p.t}${cite(p.n)}` }; });
      const checks = [3, 4, 5].map((i) => { const p = pick(i); const w = p.t.split(" "); return { q: `In your own words: ${w.slice(0, 8).join(" ")}…?`, answer: p.t }; });
      return JSON.stringify({ steps, check: checks });
    }
    case "rephrase": {
      const p = pick(2 + (Number(body.extra?.retry) || 0));
      return JSON.stringify({ title: body.extra?.how === "example" ? "Example" : "Another way to see it", text: body.extra?.how === "example" ? `**Mock example.** Imagine applying ${concept} to a tiny case: ${p.t}${cite(p.n)}` : `**Put differently.** ${p.t}${cite(p.n)}` });
    }
    case "grade": {
      const o = overlap(body.input ?? "", String(body.extra?.expected ?? ""));
      const v = gradeOf(o);
      return JSON.stringify({ verdict: v, feedback: v === "correct" ? "Right: that matches your notes." : v === "partly" ? "Partly: you have the core, but one key point is missing." : `Not yet: your notes say ${String(body.extra?.expected ?? "").slice(0, 120)}` });
    }
    case "socratic": {
      const asked = (body.history ?? []).filter((m) => m.role === "assistant").length;
      const p = pick(asked + 1);
      const q = { question: `What do you think happens here: ${p.t.split(" ").slice(0, 9).join(" ")}…?`, hints: [`Look at ${sources[0]?.title ?? "your notes"}.`, `It's about: ${p.t.split(" ").slice(0, 5).join(" ")}…`], answer: `${p.t}${cite(p.n)}` };
      if (!body.input) return JSON.stringify({ ...q, done: false });
      const exp = String(body.extra?.expected ?? "");
      const v = gradeOf(overlap(body.input, exp));
      return JSON.stringify({ verdict: v, feedback: v === "correct" ? "Yes, exactly." : v === "partly" ? "You're close: what's missing?" : "Not quite. Think about the hint.", ...(v === "correct" ? q : { question: "", hints: [], answer: "" }), done: false });
    }
    case "feynman": {
      const text = body.input ?? "";
      const key = [...terms(sources.map((s) => s.text).join(" "))].slice(0, 30);
      const covered = key.filter((k) => text.toLowerCase().includes(k)).length;
      const len = Math.min(1, text.split(/\s+/).length / 60);
      const acc = Math.round(60 + 40 * Math.min(1, covered / 6)), comp = Math.round(100 * Math.min(1, covered / 8)), clar = Math.round(50 + 50 * len);
      const first = text.split(/(?<=[.!?])\s+/)[0] ?? text;
      const jargon = text.match(/\b[A-Z][A-Za-z]{2,}\b|\b\w+(?:ization|ivity|ance)\b/)?.[0];
      const issues = [
        ...(comp < 80 ? [{ quote: first.slice(0, 120), kind: "gap", comment: `This skips how ${concept} actually works step by step${cite(1)}.` }] : []),
        ...(jargon ? [{ quote: jargon, kind: "jargon", comment: `You use “${jargon}” without saying what it means.` }] : []),
      ];
      return JSON.stringify({ score: Math.round((acc + comp + clar) / 3), reasons: [{ label: "Accuracy", score: acc, note: "Nothing contradicts your notes (mock)." }, { label: "Completeness", score: comp, note: `${covered} key terms from your notes.` }, { label: "Plain words", score: clar, note: jargon ? "1 unexplained term" : "plain words" }, { label: "Structure", score: Math.min(100, clar + 10), note: "clear order" }], issues, ask: issues.length ? "Fix the quoted parts and explain it again." : "Clear. Try explaining it to a 12-year-old in two sentences." });
    }
    case "ask": {
      const p = pick(1 + (body.history?.length ?? 0));
      return JSON.stringify({ text: `**Mock answer (simulator).** About “${String(body.input ?? "").slice(0, 60)}”: ${p.t}${cite(p.n)}` });
    }
    case "summary": {
      const cards = [0, 1, 2, 3].map((i) => { const p = pick(i); const w = p.t.split(" "); return { q: `${concept}: ${w.slice(0, 7).join(" ")}…?`, a: p.t.slice(0, 160) }; });
      return JSON.stringify({ right: [`You can state what ${concept} is.`, "You connected it to an example."], gaps: [`Why ${concept} matters in practice needs another look.`], cards });
    }
  }
  return "{}";
}
