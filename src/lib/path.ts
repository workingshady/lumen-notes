// Learning path: one concept-first roadmap on top of several independent course roadmaps.
//
// Stored as plain Markdown in a note of type "path":
//
//   ---
//   type: path
//   courses: [ML Foundations roadmap, CS231n roadmap]
//   ---
//   # Deep learning path
//   Optional intro text.
//
//   ## Stage 1 · Foundations
//   - Linear algebra = Vectors | Matrices          ← concept; "=" lists course topic names it merges
//     - resource: [3Blue1Brown](https://youtu.be/…)
//     - note: [[Eigenvectors]]
//     - review: 2026-11-20 7                        ← next revision date + current interval (days)
//     - done: 2026-11-10                            ← manual completion (concepts with no course topic)
//     - needs: Calculus, Probability               ← path-level prerequisites (concept names), on top of the courses' own
//
// Course topics not listed under any concept still appear (merged by name across courses) in "Not placed yet",
// so the path never hides anything a course teaches. Courses stay independent: their own roadmaps are untouched.
import type { Note } from "../../shared/types";
import { roadmap, splitFrontMatter, type Topic, type TopicStatus } from "./parse";

export const REVIEW_LADDER = [1, 3, 7, 14, 30, 60, 120];
export const UNPLACED = "Not placed yet";

export interface PathConcept {
  name: string;
  aliases: string[];
  resources: { label: string; url: string }[];
  notes: string[];
  review: string | null;
  interval: number;
  done: string | null;
  /** Path-level prerequisites (concept names or aliases), added on top of the ones the courses define. */
  needs: string[];
  extra: string[];
}
export interface PathStage { name: string; concepts: PathConcept[] }
export interface PathDoc { courses: string[]; title: string; intro: string; stages: PathStage[]; fm: Record<string, string> }

export const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s*\(.*?\)\s*/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const list = (v: string | undefined) => (v ?? "").replace(/^\[|\]$/g, "").split(",").map((t) => t.trim()).filter(Boolean);

export function parsePath(body: string): PathDoc {
  const { data, body: rest } = splitFrontMatter(body);
  const lines = rest.split("\n");
  const doc: PathDoc = { courses: list(data.courses), title: "", intro: "", stages: [], fm: data };
  const intro: string[] = [];
  let stage: PathStage | null = null;
  let concept: PathConcept | null = null;
  for (const raw of lines) {
    const l = raw.replace(/\s+$/, "");
    const h1 = /^#\s+(.+)$/.exec(l);
    const h2 = /^##\s+(.+)$/.exec(l);
    const top = /^[-*]\s+(?:\[[ x/-]\]\s+)?(.+)$/.exec(l);
    const sub = /^\s{2,}[-*]\s+(\w+):\s*(.*)$/.exec(l);
    if (h1 && !doc.title && !stage) { doc.title = h1[1].trim(); continue; }
    if (h2) { stage = { name: h2[1].trim(), concepts: [] }; doc.stages.push(stage); concept = null; continue; }
    if (stage && top) {
      const [name, al] = top[1].split(/\s+=\s+/);
      concept = { name: name.trim(), aliases: al ? al.split("|").map((a) => a.trim()).filter(Boolean) : [], resources: [], notes: [], review: null, interval: 0, done: null, needs: [], extra: [] };
      stage.concepts.push(concept);
      continue;
    }
    if (concept && sub) {
      const [, k, v] = sub;
      if (k === "resource") {
        const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(v.trim());
        concept.resources.push(m ? { label: m[1], url: m[2] } : { label: v.trim().replace(/^https?:\/\/(www\.)?/, "").slice(0, 60), url: v.trim() });
      } else if (k === "note") concept.notes.push(...[...v.matchAll(/\[\[([^\]|]+)/g)].map((m) => m[1].trim()));
      else if (k === "review") { const [d, i] = v.trim().split(/\s+/); concept.review = d || null; concept.interval = Number(i) || 0; }
      else if (k === "done") concept.done = v.trim() || null;
      else if (k === "needs") concept.needs.push(...v.split(",").map((x) => x.trim()).filter(Boolean));
      else concept.extra.push(l);
      continue;
    }
    if (concept && /^\s{2,}\S/.test(l)) { concept.extra.push(l); continue; }
    if (!stage) intro.push(l);
  }
  doc.intro = intro.join("\n").trim();
  return doc;
}

export function serializePath(doc: PathDoc): string {
  const fm = { ...doc.fm, type: "path", courses: `[${doc.courses.join(", ")}]` };
  const out: string[] = ["---", ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), "---", `# ${doc.title || "Learning path"}`, ""];
  if (doc.intro) out.push(doc.intro, "");
  for (const s of doc.stages) {
    if (s.name === UNPLACED) continue;
    out.push(`## ${s.name}`);
    for (const c of s.concepts) {
      out.push(`- ${c.name}${c.aliases.length ? ` = ${c.aliases.join(" | ")}` : ""}`);
      if (c.needs.length) out.push(`  - needs: ${c.needs.join(", ")}`);
      for (const r of c.resources) out.push(`  - resource: [${r.label}](${r.url})`);
      if (c.notes.length) out.push(`  - note: ${c.notes.map((n) => `[[${n}]]`).join(", ")}`);
      if (c.review) out.push(`  - review: ${c.review} ${c.interval}`);
      if (c.done) out.push(`  - done: ${c.done}`);
      out.push(...c.extra);
    }
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ------------------------------------------------------------------ build: merge courses into concepts
export interface CourseRef { key: string; title: string; note: Note | null; color: string; spaceName: string; spaceIcon: string; spaceId: string | null }
export interface Coverage { course: CourseRef; topic: Topic; module: string }
export type ConceptStatus = "todo" | "learning" | "done" | "locked";
export interface BuiltConcept {
  key: string;
  def: PathConcept;
  stage: string;
  stageIndex: number;
  coverage: Coverage[];
  status: ConceptStatus;
  needs: string[]; // concept keys
  unlocks: string[];
  due: string | null; // earliest course due date
  reviewDue: boolean;
  placed: boolean;
  /** How it became learned: "manual" (you marked it / tested out) or the course key whose lessons on it are all finished. */
  learnedVia: string | null;
  /** Learned and its spaced reviews reached the 14-day step (Khan-style "mastered": shown again after a delay). */
  mastered: boolean;
}
/** Review interval (days) from which a learned concept counts as mastered. */
export const MASTERY_INTERVAL = 14;
export interface BuiltPath { doc: PathDoc; courses: CourseRef[]; concepts: BuiltConcept[]; stages: { name: string; concepts: BuiltConcept[] }[]; byKey: Map<string, BuiltConcept> }

const blank = (name: string): PathConcept => ({ name, aliases: [], resources: [], notes: [], review: null, interval: 0, done: null, needs: [], extra: [] });
/** A concept by name, key or alias. */
function resolveConcept(concepts: BuiltConcept[], byKey: Map<string, BuiltConcept>, name: string): BuiltConcept | undefined {
  const k = norm(name);
  return byKey.get(k) ?? concepts.find((c) => c.def.aliases.some((a) => norm(a) === k));
}
export const COURSE_COLORS = ["#A371F7", "#39C5CF", "#E8893A", "#57AB5A", "#E5534B", "#E3B341", "#7AA2F7", "#D37FB4"];
const today = () => new Date().toISOString().slice(0, 10);

/** Resolve course references: a roadmap note title, or a space name (uses its roadmap). */
export function resolveCourses(names: string[], notes: Note[], spaces: { id: string; name: string; icon: string; roadmapId: string | null }[]): CourseRef[] {
  return names.map((name, i) => {
    const low = name.toLowerCase();
    const sp = spaces.find((s) => s.name.toLowerCase() === low);
    const note = (sp?.roadmapId ? notes.find((n) => n.id === sp.roadmapId && !n.deleted) : undefined) ?? notes.find((n) => !n.deleted && n.type === "roadmap" && n.title.toLowerCase() === low) ?? null;
    const space = spaces.find((s) => s.id === note?.spaceId) ?? sp;
    return { key: name, title: name, note, color: COURSE_COLORS[i % COURSE_COLORS.length], spaceName: space?.name ?? name, spaceIcon: space?.icon ?? "🎓", spaceId: space?.id ?? null };
  });
}

export function buildPath(body: string, courses: CourseRef[]): BuiltPath {
  const doc = parsePath(body);
  // every course topic, keyed by normalized name
  const topics: Coverage[] = [];
  for (const c of courses) {
    if (!c.note) continue;
    for (const m of roadmap(c.note.body)) for (const t of m.topics) topics.push({ course: c, topic: t, module: m.name });
  }
  const claimed = new Set<Coverage>();
  const concepts: BuiltConcept[] = [];
  const mk = (def: PathConcept, stage: string, stageIndex: number, placed: boolean): BuiltConcept => ({ key: norm(def.name), def, stage, stageIndex, coverage: [], status: "todo", needs: [], unlocks: [], due: null, reviewDue: false, placed, learnedVia: null, mastered: false });
  doc.stages.forEach((s, si) => {
    for (const def of s.concepts) {
      const c = mk(def, s.name, si, true);
      const names = new Set([norm(def.name), ...def.aliases.map(norm)]);
      for (const cov of topics) if (!claimed.has(cov) && names.has(norm(cov.topic.name))) { c.coverage.push(cov); claimed.add(cov); }
      concepts.push(c);
    }
  });
  // unplaced topics: merged across courses by normalized name
  const loose = new Map<string, BuiltConcept>();
  for (const cov of topics) {
    if (claimed.has(cov)) continue;
    const k = norm(cov.topic.name);
    let c = loose.get(k);
    if (!c) { c = mk(blank(cov.topic.name), UNPLACED, doc.stages.length, false); loose.set(k, c); }
    c.coverage.push(cov);
  }
  concepts.push(...loose.values());
  const byKey = new Map(concepts.map((c) => [c.key, c]));
  // map course topic → concept, to merge prerequisites across courses
  const topicConcept = new Map<string, BuiltConcept>();
  for (const c of concepts) for (const cov of c.coverage) topicConcept.set(`${cov.course.key}::${norm(cov.topic.name)}`, c);
  for (const c of concepts) {
    const needs = new Set<string>();
    for (const cov of c.coverage) for (const n of cov.topic.needs) {
      const d = topicConcept.get(`${cov.course.key}::${norm(n)}`) ?? byKey.get(norm(n));
      if (d && d !== c) needs.add(d.key);
    }
    // path-level `needs:` lines (concept name or any alias)
    for (const n of c.def.needs) { const d = resolveConcept(concepts, byKey, n); if (d && d !== c) needs.add(d.key); }
    c.needs = [...needs];
    const dues = c.coverage.map((x) => x.topic.due).filter((x): x is string => !!x).sort();
    c.due = dues[0] ?? null;
  }
  for (const c of concepts) for (const n of c.needs) byKey.get(n)?.unlocks.push(c.key);
  const t = today();
  // Mastery rules (Math Academy / Khan / competency-based practice):
  //  · learned = you marked it (or tested out), OR you finished every lesson on it in ANY one course; the other courses are
  //    optional extra material, not requirements (a concept taught by 11 sources must not need all 11)
  //  · locked  = not started and some prerequisite concept isn't learned yet
  //  · mastered = learned and its spaced reviews reached the 14-day step
  for (const c of concepts) {
    const byCourse = new Map<string, TopicStatus[]>();
    for (const x of c.coverage) byCourse.set(x.course.key, [...(byCourse.get(x.course.key) ?? []), x.topic.status]);
    const via = [...byCourse].find(([, st]) => st.some((s) => s === "done") && st.every((s) => s === "done" || s === "skipped"))?.[0] ?? null;
    c.learnedVia = c.def.done ? "manual" : via;
    const started = c.coverage.some((x) => x.topic.status === "learning" || x.topic.status === "done");
    c.status = c.learnedVia ? "done" : started ? "learning" : "todo";
  }
  for (const c of concepts) if (c.status === "todo" && c.needs.some((n) => byKey.get(n)?.status !== "done")) c.status = "locked";
  for (const c of concepts) {
    c.reviewDue = c.status === "done" && (c.def.review ? c.def.review <= t : false);
    c.mastered = c.status === "done" && c.def.interval >= MASTERY_INTERVAL;
  }
  const stages = doc.stages.map((s) => ({ name: s.name, concepts: concepts.filter((c) => c.placed && c.stage === s.name) }));
  if (loose.size) stages.push({ name: UNPLACED, concepts: [...loose.values()] });
  return { doc, courses, concepts, stages, byKey };
}

export function pathProgress(p: BuiltPath) {
  const all = p.concepts.length;
  const done = p.concepts.filter((c) => c.status === "done").length;
  return { done, total: all, pct: all ? Math.round((done / all) * 100) : 0, learning: p.concepts.filter((c) => c.status === "learning").length, review: p.concepts.filter((c) => c.reviewDue).length, mastered: p.concepts.filter((c) => c.mastered).length };
}

/** Topic status in one course for a concept ("—" when the course doesn't cover it). */
export function cellStatus(c: BuiltConcept, course: CourseRef): TopicStatus | null {
  const cov = c.coverage.filter((x) => x.course.key === course.key);
  if (!cov.length) return null;
  if (cov.every((x) => x.topic.status === "done" || x.topic.status === "skipped")) return "done";
  if (cov.some((x) => x.topic.status === "learning" || x.topic.status === "done")) return "learning";
  return "todo";
}

// ------------------------------------------------------------------ mutations (return new Markdown)
function edit(body: string, fn: (doc: PathDoc) => void) { const d = parsePath(body); fn(d); return serializePath(d); }
function findDef(doc: PathDoc, key: string) { for (const s of doc.stages) { const c = s.concepts.find((x) => norm(x.name) === key); if (c) return { s, c }; } return null; }

/** Move (or place) a concept into a stage. Unplaced concepts get written into the path. */
export const moveConcept = (body: string, concept: BuiltConcept, stage: string, index?: number) => edit(body, (d) => {
  const f = findDef(d, concept.key);
  const def = f ? f.c : { ...blank(concept.def.name) };
  if (f) f.s.concepts.splice(f.s.concepts.indexOf(f.c), 1);
  let s = d.stages.find((x) => x.name === stage);
  if (!s) { s = { name: stage, concepts: [] }; d.stages.push(s); }
  s.concepts.splice(index ?? s.concepts.length, 0, def);
});
export const addStage = (body: string, name: string) => edit(body, (d) => { if (!d.stages.some((s) => s.name === name)) d.stages.push({ name, concepts: [] }); });
export const renameStage = (body: string, from: string, to: string) => edit(body, (d) => { const s = d.stages.find((x) => x.name === from); if (s) s.name = to; });
export const removeStage = (body: string, name: string) => edit(body, (d) => { d.stages = d.stages.filter((s) => s.name !== name); });
export const moveStage = (body: string, name: string, dir: -1 | 1) => edit(body, (d) => {
  const i = d.stages.findIndex((s) => s.name === name), j = i + dir;
  if (i < 0 || j < 0 || j >= d.stages.length) return;
  [d.stages[i], d.stages[j]] = [d.stages[j], d.stages[i]];
});
/** Merge `other` into `into`: other's name + aliases become aliases of into. */
export const mergeConcepts = (body: string, into: BuiltConcept, other: BuiltConcept) => edit(body, (d) => {
  let t = findDef(d, into.key)?.c;
  if (!t) { const s = d.stages[0] ?? (d.stages.push({ name: "Stage 1", concepts: [] }), d.stages[0]); t = blank(into.def.name); s.concepts.push(t); }
  const o = findDef(d, other.key);
  const names = [other.def.name, ...other.def.aliases, ...other.coverage.map((x) => x.topic.name)];
  t.aliases = [...new Set([...t.aliases, ...names.filter((n) => norm(n) !== norm(t!.name))])];
  if (o) {
    t.resources.push(...o.c.resources); t.notes.push(...o.c.notes);
    const own = new Set([norm(t.name), ...t.aliases.map(norm)]);
    t.needs = [...new Set([...t.needs, ...o.c.needs])].filter((n) => !own.has(norm(n)));
    if (o.c.done && !t.done) t.done = o.c.done;
    t.extra.push(...o.c.extra);
    o.s.concepts.splice(o.s.concepts.indexOf(o.c), 1);
  }
});
/** Find or create (in the first stage) the written definition of a concept, so path-level data can be attached to it. */
function ensureDef(d: PathDoc, c: BuiltConcept): PathConcept {
  const f = findDef(d, c.key);
  if (f) return f.c;
  const b = blank(c.def.name);
  b.aliases = c.coverage.map((x) => x.topic.name).filter((n, i, a) => norm(n) !== c.key && a.findIndex((y) => norm(y) === norm(n)) === i);
  (d.stages[0] ?? (d.stages.push({ name: "Stage 1", concepts: [] }), d.stages[0])).concepts.push(b);
  return b;
}
/**
 * Put a concept into `stage` right before the concept `beforeKey` (null = at the end). Works for reordering inside a stage,
 * moving between stages, and placing a "Not placed yet" concept. All its written data moves with it.
 */
export const placeConcept = (body: string, concept: BuiltConcept, stage: string, beforeKey: string | null) => edit(body, (d) => {
  if (beforeKey === concept.key) return;
  const f = findDef(d, concept.key);
  const def = f ? f.c : { ...blank(concept.def.name) };
  if (f) f.s.concepts.splice(f.s.concepts.indexOf(f.c), 1);
  let s = d.stages.find((x) => x.name === stage);
  if (!s) { s = { name: stage, concepts: [] }; d.stages.push(s); }
  const i = beforeKey === null ? -1 : s.concepts.findIndex((x) => norm(x.name) === beforeKey);
  s.concepts.splice(i < 0 ? s.concepts.length : i, 0, def);
});
/** Keyboard reorder: one step up/down inside the stage (Alt+↑/↓). */
export const nudgeConcept = (body: string, concept: BuiltConcept, dir: -1 | 1) => edit(body, (d) => {
  const f = findDef(d, concept.key);
  if (!f) return;
  const i = f.s.concepts.indexOf(f.c), j = i + dir;
  if (j < 0 || j >= f.s.concepts.length) return;
  [f.s.concepts[i], f.s.concepts[j]] = [f.s.concepts[j], f.s.concepts[i]];
});
/** Reorder stages: put stage `name` before stage `before` (null = last). */
export const reorderStage = (body: string, name: string, before: string | null) => edit(body, (d) => {
  const i = d.stages.findIndex((s) => s.name === name);
  if (i < 0 || name === before) return;
  const [s] = d.stages.splice(i, 1);
  const j = before === null ? -1 : d.stages.findIndex((x) => x.name === before);
  d.stages.splice(j < 0 ? d.stages.length : j, 0, s);
});
/** New concept of your own (typed, or from a dropped note) in `stage`, before `beforeKey`. No-op if the name is taken. */
export const addConcept = (body: string, stage: string, name: string, opts: { note?: string; beforeKey?: string | null } = {}) => edit(body, (d) => {
  const n = name.trim();
  if (!n || d.stages.some((s) => s.concepts.some((c) => norm(c.name) === norm(n) || c.aliases.some((a) => norm(a) === norm(n))))) return;
  let s = d.stages.find((x) => x.name === stage);
  if (!s) { s = { name: stage, concepts: [] }; d.stages.push(s); }
  const c = blank(n);
  if (opts.note) c.notes.push(opts.note);
  const i = opts.beforeKey ? s.concepts.findIndex((x) => norm(x.name) === opts.beforeKey) : -1;
  s.concepts.splice(i < 0 ? s.concepts.length : i, 0, c);
});
/** Take a concept out of the path (its course topics go back to "Not placed yet"). */
export const removeConcept = (body: string, c: BuiltConcept) => edit(body, (d) => { const f = findDef(d, c.key); if (f) f.s.concepts.splice(f.s.concepts.indexOf(f.c), 1); });
/**
 * Attach one course topic name to `into` as an alias (drag a topic from a concept's sheet onto another concept).
 * The alias is removed from the concept that listed it before (`from`), so the topic moves instead of being claimed twice.
 */
export const moveAlias = (body: string, name: string, into: BuiltConcept, from?: BuiltConcept | null) => edit(body, (d) => {
  const k = norm(name);
  if (from && from.key !== into.key) { const f = findDef(d, from.key); if (f) f.c.aliases = f.c.aliases.filter((a) => norm(a) !== k); }
  const t = ensureDef(d, into);
  if (norm(t.name) !== k && !t.aliases.some((a) => norm(a) === k)) t.aliases.push(name.trim());
});
/** Path-level prerequisite: `c` needs `prereq` (written as `  - needs: …` under c). */
export const addConceptNeed = (body: string, c: BuiltConcept, prereq: BuiltConcept) => edit(body, (d) => {
  if (c.key === prereq.key) return;
  const t = ensureDef(d, c);
  const names = new Set([prereq.key, ...prereq.def.aliases.map(norm)]);
  if (!t.needs.some((n) => names.has(norm(n)))) t.needs.push(prereq.def.name);
});
export const removeConceptNeed = (body: string, c: BuiltConcept, prereq: BuiltConcept) => edit(body, (d) => {
  const f = findDef(d, c.key);
  if (!f) return;
  const names = new Set([prereq.key, ...prereq.def.aliases.map(norm)]);
  f.c.needs = f.c.needs.filter((n) => !names.has(norm(n)));
});
/** Does `c` need `prereq` through a `needs:` line in the path (removable here), rather than only through a course roadmap? */
export const pathNeeds = (c: BuiltConcept, prereq: BuiltConcept) => { const names = new Set([prereq.key, ...prereq.def.aliases.map(norm)]); return c.def.needs.some((n) => names.has(norm(n))); };
/** Would `c` needing `prereq` create a cycle (prereq already depends on c, directly or not)? */
export function wouldCycle(p: BuiltPath, c: BuiltConcept, prereq: BuiltConcept) {
  if (c.key === prereq.key) return true;
  const seen = new Set<string>(), stack = [prereq.key];
  while (stack.length) {
    const k = stack.pop()!;
    if (k === c.key) return true;
    if (seen.has(k)) continue;
    seen.add(k);
    stack.push(...(p.byKey.get(k)?.needs ?? []));
  }
  return false;
}
export const renameConcept = (body: string, c: BuiltConcept, name: string) => edit(body, (d) => {
  const f = findDef(d, c.key);
  const def = f?.c ?? (() => { const b = blank(c.def.name); (d.stages[0] ?? (d.stages.push({ name: "Stage 1", concepts: [] }), d.stages[0])).concepts.push(b); return b; })();
  if (norm(name) !== norm(def.name)) def.aliases = [...new Set([...def.aliases, def.name])];
  def.name = name;
});
export const addResource = (body: string, c: BuiltConcept, label: string, url: string) => edit(body, (d) => { const f = findDef(d, c.key); if (f) f.c.resources.push({ label, url }); });
export const removeResource = (body: string, c: BuiltConcept, url: string) => edit(body, (d) => { const f = findDef(d, c.key); if (f) f.c.resources = f.c.resources.filter((r) => r.url !== url); });
export const linkNote = (body: string, c: BuiltConcept, title: string) => edit(body, (d) => { const f = findDef(d, c.key); if (f && !f.c.notes.includes(title)) f.c.notes.push(title); });
export const setManualDone = (body: string, c: BuiltConcept, on: boolean) => edit(body, (d) => {
  const f = findDef(d, c.key);
  if (!f) return;
  f.c.done = on ? today() : null;
  if (on && !f.c.review) { f.c.review = addDays(today(), REVIEW_LADDER[0]); f.c.interval = REVIEW_LADDER[0]; }
});
/** Spaced revision: "Got it" moves up the ladder (1→3→7→14→30→60→120 days), "Again" restarts at 1 day. */
export const markRevised = (body: string, c: BuiltConcept, remembered: boolean) => edit(body, (d) => {
  const f = findDef(d, c.key);
  if (!f) return;
  const i = REVIEW_LADDER.indexOf(f.c.interval);
  const next = remembered ? REVIEW_LADDER[Math.min(REVIEW_LADDER.length - 1, i + 1)] : REVIEW_LADDER[0];
  f.c.interval = next;
  f.c.review = addDays(today(), next);
});
/**
 * Start the revision ladder for concepts that became learned (call after building).
 * Implicit review: learning a concept exercises its direct prerequisites, so their next review is pushed back
 * by their current interval (never earlier than already scheduled; the ladder step itself doesn't change).
 */
export function scheduleNewlyDone(body: string, p: BuiltPath): string | null {
  const fresh = p.concepts.filter((c) => c.placed && c.status === "done" && !c.def.review);
  if (!fresh.length) return null;
  return edit(body, (d) => {
    for (const c of fresh) {
      const f = findDef(d, c.key);
      if (f) { f.c.review = addDays(today(), REVIEW_LADDER[0]); f.c.interval = REVIEW_LADDER[0]; }
      for (const n of c.needs) {
        const pre = p.byKey.get(n);
        const g = pre && pre.status === "done" ? findDef(d, n) : null;
        if (g?.c.review && g.c.interval) { const later = addDays(today(), g.c.interval); if (later > g.c.review) g.c.review = later; }
      }
    }
  });
}
export function addDays(iso: string, n: number) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

/**
 * Auto-organize: place every concept into stages by prerequisite depth across all courses (topological levels),
 * keeping each course's module order as the tie-breaker. Existing stage names are reused; existing data is kept.
 */
export function autoOrganize(body: string, p: BuiltPath, stageNames = ["Foundations", "Core", "Applied", "Advanced", "Mastery"]): string {
  const level = new Map<string, number>();
  const visit = (c: BuiltConcept, seen = new Set<string>()): number => {
    if (level.has(c.key)) return level.get(c.key)!;
    if (seen.has(c.key)) return 0;
    seen.add(c.key);
    const l = c.needs.length ? 1 + Math.max(...c.needs.map((n) => (p.byKey.get(n) ? visit(p.byKey.get(n)!, seen) : 0))) : 0;
    level.set(c.key, l);
    return l;
  };
  p.concepts.forEach((c) => visit(c));
  const maxL = Math.max(0, ...level.values());
  const nStages = Math.min(stageNames.length, Math.max(1, maxL + 1));
  const stageOf = (c: BuiltConcept) => Math.min(nStages - 1, Math.floor((level.get(c.key)! / (maxL + 1)) * nStages));
  const modIdx = (c: BuiltConcept) => Math.min(...c.coverage.map((x) => x.topic.module), 99);
  return edit(body, (d) => {
    const defs = new Map<string, PathConcept>();
    for (const s of d.stages) for (const c of s.concepts) defs.set(norm(c.name), c);
    d.stages = Array.from({ length: nStages }, (_, i) => ({ name: `Stage ${i + 1} · ${stageNames[i]}`, concepts: [] as PathConcept[] }));
    [...p.concepts].sort((a, b) => stageOf(a) - stageOf(b) || modIdx(a) - modIdx(b) || a.def.name.localeCompare(b.def.name)).forEach((c) => {
      d.stages[stageOf(c)].concepts.push(defs.get(c.key) ?? { ...blank(c.def.name), aliases: c.coverage.map((x) => x.topic.name).filter((n) => norm(n) !== c.key) });
    });
  });
}

/** New path body from a list of courses (auto-organized). */
export function newPathBody(title: string, courseNames: string[], courses: CourseRef[]) {
  const base = serializePath({ courses: courseNames, title, intro: "", stages: [], fm: {} });
  return autoOrganize(base, buildPath(base, courses));
}

// ------------------------------------------------------------------ overlap suggestions (likely the same concept, different names)
// Generic words ("learning", "models", "deep"…) say nothing about which concept a name is; they never count as a match.
const STOP = new Set(["the", "a", "an", "and", "of", "to", "in", "for", "by", "from", "with", "your", "intro", "introduction", "basics", "part", "lecture", "review", "hand", "scratch",
  "learning", "learn", "model", "models", "deep", "neural", "network", "networks", "using", "use", "how", "what", "why", "overview", "practice", "practical", "advanced", "understanding", "building", "build", "data", "machine", "systems", "system"]);
const stems = (s: string) => norm(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 7));
/** Pairs of concepts from different courses whose names share their key words (e.g. "Backprop by hand" ~ "Backpropagation"). */
export function overlapSuggestions(p: BuiltPath, dismissed: string[] = []): [BuiltConcept, BuiltConcept][] {
  const out: [BuiltConcept, BuiltConcept][] = [];
  const cs = p.concepts;
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const a = cs[i], b = cs[j];
    const ca = new Set(a.coverage.map((x) => x.course.key)), cb = new Set(b.coverage.map((x) => x.course.key));
    if (!ca.size || !cb.size || [...ca].some((k) => cb.has(k))) continue; // same course = intentionally separate
    if (dismissed.includes(`${a.key}|${b.key}`)) continue;
    const sa = stems(a.def.name), sb = stems(b.def.name);
    if (!sa.length || !sb.length) continue;
    // 7-letter stems: "quantization" ≠ "quantifying", "backprop" ≈ "backpropagation"
    const same = (w: string, v: string) => (w.length >= 5 && v.length >= 5 ? v.startsWith(w) || w.startsWith(v) : w === v);
    const shared = sa.filter((w) => sb.some((v) => same(w, v))).length;
    if (shared / Math.min(sa.length, sb.length) >= 1 || shared >= 2) out.push(a.coverage.length >= b.coverage.length ? [a, b] : [b, a]);
  }
  return out.slice(0, 20);
}
