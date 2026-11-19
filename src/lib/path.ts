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
//     - after: Statistics                          ← recommended order (better first, not required; never locks)
//     - related: Eigenvectors                      ← related, no order (see also)
//
// Course topics not listed under any concept still appear (merged by name across courses) in "Not placed yet",
// so the path never hides anything a course teaches. Courses stay independent: their own roadmaps are untouched.
import type { Note } from "../../shared/types";
import { roadmap, splitFrontMatter, type Topic, type TopicStatus } from "./parse";
import { depths, untangle } from "./prereq-graph";
import { t } from "./i18n";

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
  /** Path-level recommended order (`after:`) and related (`related:`) links (round 4, 14b). */
  after?: string[];
  related?: string[];
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
      else if (k === "after" || k === "related") (concept[k] ??= []).push(...v.split(",").map((x) => x.trim()).filter(Boolean));
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
      if (c.after?.length) out.push(`  - after: ${c.after.join(", ")}`);
      if (c.related?.length) out.push(`  - related: ${c.related.join(", ")}`);
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
export type CourseKind = "video" | "book" | "lecture" | "notebook" | "paper" | "podcast" | "article";
export interface CourseRef { key: string; title: string; note: Note | null; color: string; spaceName: string; spaceIcon: string; spaceId: string | null; /** Course medium (glyph k-*): space prop `format`, else guessed from provider/url. */ kind?: CourseKind }
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
  /** Recommended-order prerequisites (concept keys, from `after:` in the path or `(after: …)` in a course). Never lock. */
  after: string[];
  /** Related concepts, no order (keys; stored on one side, listed here on the side that wrote it). */
  related: string[];
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
/** Course colours: the 6 canvas presets (design: purple, cyan, green, orange, yellow, red). A course space's own colour wins. */
export const COURSE_COLORS = ["#A371F7", "#39C5CF", "#57AB5A", "#E8893A", "#E3B341", "#E5534B"];
const PRESET: Record<string, string> = { "1": "#E5534B", "2": "#E8893A", "3": "#E3B341", "4": "#57AB5A", "5": "#39C5CF", "6": "#A371F7" };
const KINDS: CourseKind[] = ["video", "book", "lecture", "notebook", "paper", "podcast", "article"];
/** Course medium: explicit `format` prop, else a guess from the provider / url text. */
export function courseKind(props: Record<string, string> | undefined, name = ""): CourseKind {
  const f = (props?.format ?? "").toLowerCase().trim();
  if ((KINDS as string[]).includes(f)) return f as CourseKind;
  const t = `${props?.provider ?? ""} ${props?.url ?? ""} ${name}`.toLowerCase();
  if (/podcast|spotify|episode/.test(t)) return "podcast";
  if (/arxiv|paper|journal/.test(t)) return "paper";
  if (/fast\.ai|notebook|kaggle|colab|jupyter/.test(t)) return "notebook";
  if (/book|o'?reilly|manning|chapter|\bch\b|géron|geron|homl|d2l/.test(t)) return "book";
  if (/medium|blog|substack|article|distill/.test(t)) return "article";
  if (/stanford|mit|lecture|cs\d{3}|\d\.s\d|university|berkeley|cmu/.test(t)) return "lecture";
  return "video";
}
const today = () => new Date().toISOString().slice(0, 10);

/** Resolve course references: a roadmap note title, or a space name (uses its roadmap). */
export function resolveCourses(names: string[], notes: Note[], spaces: { id: string; name: string; icon: string; roadmapId: string | null; color?: string | null; props?: Record<string, string> }[]): CourseRef[] {
  return names.map((name, i) => {
    const low = name.toLowerCase();
    const sp = spaces.find((s) => s.name.toLowerCase() === low);
    const note = (sp?.roadmapId ? notes.find((n) => n.id === sp.roadmapId && !n.deleted) : undefined) ?? notes.find((n) => !n.deleted && n.type === "roadmap" && n.title.toLowerCase() === low) ?? null;
    const space = spaces.find((s) => s.id === note?.spaceId) ?? sp;
    const color = (space?.color && (PRESET[space.color] ?? (/^#/.test(space.color) ? space.color : null))) || COURSE_COLORS[i % COURSE_COLORS.length];
    return { key: name, title: name, note, color, spaceName: space?.name ?? name, spaceIcon: space?.icon ?? "", spaceId: space?.id ?? null, kind: courseKind(space?.props, space?.name ?? name) };
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
  const mk = (def: PathConcept, stage: string, stageIndex: number, placed: boolean): BuiltConcept => ({ key: norm(def.name), def, stage, stageIndex, coverage: [], status: "todo", needs: [], after: [], related: [], unlocks: [], due: null, reviewDue: false, placed, learnedVia: null, mastered: false });
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
    // recommended order / related: course `(after|related: …)` + path `after:` / `related:` lines
    for (const k of ["after", "related"] as const) {
      const set = new Set<string>();
      for (const cov of c.coverage) for (const n of cov.topic[k] ?? []) { const d = topicConcept.get(`${cov.course.key}::${norm(n)}`) ?? byKey.get(norm(n)); if (d && d !== c && !needs.has(d.key)) set.add(d.key); }
      for (const n of c.def[k] ?? []) { const d = resolveConcept(concepts, byKey, n); if (d && d !== c && !needs.has(d.key)) set.add(d.key); }
      c[k] = [...set];
    }
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
    for (const k of ["after", "related"] as const) { const m = [...new Set([...(t[k] ?? []), ...(o.c[k] ?? [])])].filter((n) => !own.has(norm(n))); if (m.length) t[k] = m; }
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
/** Kind of the path-written link `c` → `other` (needs / after / related), or null if the path doesn't write one. */
export function pathLinkKind(c: BuiltConcept, other: BuiltConcept): "needs" | "after" | "related" | null {
  const names = new Set([other.key, ...other.def.aliases.map(norm)]);
  for (const k of ["needs", "after", "related"] as const) if ((c.def[k] ?? []).some((n) => names.has(norm(n)))) return k;
  return null;
}
/**
 * Set the path-level link from `c` to `other`: prerequisite (`needs:`), recommended order (`after:`), related (`related:`)
 * or none (null). The name leaves the other lists, so a type change rewrites one link (14b-L).
 */
export const setConceptLink = (body: string, c: BuiltConcept, other: BuiltConcept, kind: "needs" | "after" | "related" | null) => edit(body, (d) => {
  if (c.key === other.key) return;
  const t = kind ? ensureDef(d, c) : findDef(d, c.key)?.c;
  if (!t) return;
  const names = new Set([other.key, ...other.def.aliases.map(norm)]);
  for (const k of ["needs", "after", "related"] as const) {
    const cur = (t[k] ?? []).filter((n) => !names.has(norm(n)));
    if (k === kind) cur.push(other.def.name);
    if (k === "needs") t.needs = cur; else if (cur.length) t[k] = cur; else delete t[k];
  }
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

/** Why two concepts look like one (overlaps panel). */
export function overlapReason(a: BuiltConcept, b: BuiltConcept): string {
  const na = new Set([...a.def.notes, ...a.coverage.map((x) => x.topic.note).filter((x): x is string => !!x)].map((x) => x.toLowerCase()));
  const shared = [...b.def.notes, ...b.coverage.map((x) => x.topic.note).filter((x): x is string => !!x)].filter((x) => na.has(x.toLowerCase())).length;
  if (shared > 1) return t("{n} shared lessons", { n: shared });
  if (shared === 1) return t("same notes cited");
  const sa = stems(a.def.name).join(" "), sb = stems(b.def.name).join(" ");
  return sa === sb ? t("same name") : t("similar names");
}

// ------------------------------------------------------------------ view helpers (filters, focus chain, graph layout)
/** One state per concept, as the design shows it: todo · learning · learned · mastered · locked. */
export type ConceptState = "todo" | "learning" | "learned" | "mastered" | "locked";
export const conceptState = (c: BuiltConcept): ConceptState => (c.mastered ? "mastered" : c.status === "done" ? "learned" : c.status);
/** Distinct courses teaching a concept, in path order. */
export const conceptCourses = (c: BuiltConcept) => [...new Map(c.coverage.map((x) => [x.course.key, x.course])).values()];

/** Filters shared by every tab (Stages, Graph, Matrix, Timeline, Revise). Empty sets = no restriction. */
export interface PathFilter { courses: string[]; states: ConceptState[]; stages: string[]; overlapping: boolean; revise: boolean; unplaced: boolean }
export type GroupBy = "stage" | "course" | "status";
export const NO_FILTER: PathFilter = { courses: [], states: [], stages: [], overlapping: false, revise: false, unplaced: false };
export const filterCount = (f: PathFilter) => f.courses.length + f.states.length + f.stages.length + Number(f.overlapping) + Number(f.revise) + Number(f.unplaced);
export function matchesFilter(c: BuiltConcept, f: PathFilter): boolean {
  if (f.courses.length && !c.coverage.some((x) => f.courses.includes(x.course.key))) return false;
  if (f.states.length && !f.states.includes(conceptState(c))) return false;
  if (f.stages.length && !f.stages.includes(c.stage)) return false;
  if (f.overlapping && conceptCourses(c).length < 2) return false;
  if (f.revise && !c.reviewDue) return false;
  if (f.unplaced && c.placed) return false;
  return true;
}

/** Everything a concept depends on (transitively) plus everything that depends on it: the "focus chain". */
export function focusChain(p: BuiltPath, key: string | null): Set<string> {
  const out = new Set<string>();
  if (!key || !p.byKey.has(key)) return out;
  const walk = (k: string, dir: "needs" | "unlocks") => { for (const n of p.byKey.get(k)?.[dir] ?? []) if (!out.has(n)) { out.add(n); walk(n, dir); } };
  out.add(key); walk(key, "needs"); walk(key, "unlocks");
  return out;
}

/** Next interval after "Got it" (the ladder step above the current one). */
export const nextInterval = (c: BuiltConcept) => REVIEW_LADDER[Math.min(REVIEW_LADDER.length - 1, REVIEW_LADDER.indexOf(c.def.interval) + 1)];

/** Short course label for narrow headers (matrix): drops parentheses and filler words, then trims to `max`. */
export function abbrevCourse(name: string, max = 16): string {
  let s = name.replace(/\s*\(.*?\)\s*/g, " ").replace(/Specialization/i, "Spec").replace(/Introduction to/i, "Intro").replace(/^(Coursera|Udemy|edX|YouTube)\s*[·:-]?\s*/i, "").replace(/\s+/g, " ").trim();
  if (s.includes(" · ")) s = s.split(" · ").slice(-1)[0];
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

export interface GraphNodeLayout { key: string; x: number; y: number; stage: number }
export interface GraphColLayout { stage: number; name: string; x: number; width: number; count: number; collapsed: boolean }
/**
 * Graph layout, left → right: one column group per stage ("Step N"), inside a stage concepts that need another concept of the
 * same stage move one sub-column right. A collapsed stage becomes one summary node. Unplaced concepts are left out unless
 * nothing is placed yet. Pure (no DOM) so it can be tested.
 */
export interface GraphLayoutOpts {
  /** Group by stage (default): one column group per stage. Off: columns = prerequisite depth across the whole path. */
  byStage?: boolean;
  /** Tidy up: order cards inside each column by the barycentre of their links (fewer crossings). */
  untangle?: boolean;
  /** Roomy spacing (Display panel): 1.35× gaps. */
  roomy?: boolean;
}
export function graphLayout(p: BuiltPath, keep: (c: BuiltConcept) => boolean, collapsed: Set<string>, opt: GraphLayoutOpts = {}, base = { colW: 214, nodeW: 176, rowH: 68, top: 72, left: 24, sumW: 150 }) {
  const o = opt.roomy ? { ...base, colW: base.nodeW + (base.colW - base.nodeW) * 2.2, rowH: Math.round(base.rowH * 1.35) } : base;
  const anyPlaced = p.concepts.some((c) => c.placed);
  const stages = anyPlaced ? p.stages.filter((s) => s.name !== UNPLACED) : p.stages;
  const nodes: GraphNodeLayout[] = [];
  const cols: GraphColLayout[] = [];
  const summary = new Map<string, string>(); // concept key → summary node id (collapsed stages)
  const needsOf = (k: string) => p.byKey.get(k)?.needs ?? [];
  const unlocksOf = (k: string) => p.byKey.get(k)?.unlocks ?? [];
  // one group of sub-columns per stage, or (not grouped) one group for everything
  const groups: { name: string; si: number; list: BuiltConcept[] }[] = opt.byStage === false
    ? [{ name: "", si: -1, list: stages.flatMap((s) => s.concepts.filter(keep)) /* not grouped: collapsing a stage doesn't apply */ }]
    : stages.map((s, si) => ({ name: s.name, si, list: s.concepts.filter(keep) }));
  const stageOf = new Map(stages.flatMap((s, si) => s.concepts.map((c) => [c.key, si] as [string, number])));
  let x = o.left;
  const subCols: { x: number; keys: string[] }[] = [];
  for (const g of groups) {
    if (g.si >= 0 && collapsed.has(g.name)) {
      cols.push({ stage: g.si, name: g.name, x, width: o.sumW, count: g.list.length, collapsed: true });
      for (const c of g.list) summary.set(c.key, `stage:${g.name}`);
      x += o.sumW + (o.colW - o.nodeW);
      continue;
    }
    const keys = g.list.map((c) => c.key);
    const depth = depths(keys, needsOf);
    const sub = Math.max(0, ...depth.values()) + 1;
    const cs: string[][] = Array.from({ length: sub }, () => []);
    for (const k of keys) cs[depth.get(k) ?? 0].push(k);
    cs.forEach((ks, i) => subCols.push({ x: x + i * o.colW, keys: ks }));
    if (g.si >= 0) cols.push({ stage: g.si, name: g.name, x, width: Math.max(1, sub) * o.colW - (o.colW - o.nodeW), count: g.list.length, collapsed: false });
    x += Math.max(1, sub) * o.colW;
  }
  const ordered = opt.untangle ? untangle(subCols.map((c) => c.keys), needsOf, unlocksOf) : subCols.map((c) => c.keys);
  ordered.forEach((ks, ci) => ks.forEach((k, r) => nodes.push({ key: k, x: subCols[ci].x, y: o.top + r * o.rowH, stage: stageOf.get(k) ?? stages.length })));
  return { nodes, cols, summary, width: x };
}
