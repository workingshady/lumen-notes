// Pure Markdown parsing helpers: front-matter, links, tags, tasks, flashcards, outline, roadmaps.
import { clozeCards } from "./cloze";
import { occlusionCards, type Occlusion } from "./occlusion";

export function splitFrontMatter(md: string): { data: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { data: {}, body: md };
  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) data[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { data, body: md.slice(m[0].length) };
}

/** Set/remove front-matter keys in a Markdown body (creates the block if needed). Values: string | string[] | null (remove). */
export function setFrontMatter(md: string, keys: Record<string, string | string[] | null | undefined>): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  const lines = m ? m[1].split(/\r?\n/) : [];
  const fmt = (v: string | string[]) => (Array.isArray(v) ? `[${v.join(", ")}]` : v);
  for (const [k, v] of Object.entries(keys)) {
    if (v === undefined) continue;
    const i = lines.findIndex((l) => l.slice(0, l.indexOf(":")).trim() === k);
    const empty = v === null || (Array.isArray(v) && !v.length) || v === "";
    if (empty) { if (i >= 0) lines.splice(i, 1); continue; }
    if (i >= 0) lines[i] = `${k}: ${fmt(v!)}`; else lines.push(`${k}: ${fmt(v!)}`);
  }
  const rest = m ? md.slice(m[0].length) : md.replace(/^\n+/, "");
  return lines.length ? `---\n${lines.join("\n")}\n---\n${rest}` : rest;
}

/** Text of the first `# H1` after the front-matter, or null. */
export function firstH1(md: string): string | null {
  const line = splitFrontMatter(md).body.split("\n").find((l) => l.trim());
  const m = line ? /^#\s+(.+?)\s*#*\s*$/.exec(line) : null;
  return m ? m[1].trim() : null;
}
export const fmList = (v: string | undefined) => (v ?? "").replace(/^\[|\]$/g, "").split(",").map((t) => t.trim().replace(/^#/, "").toLowerCase()).filter(Boolean);

export function toFrontMatter(data: Record<string, string | string[] | number | undefined>) {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : /[:#]/.test(String(v)) ? JSON.stringify(String(v)) : v}`);
  return lines.length ? `---\n${lines.join("\n")}\n---\n\n` : "";
}

/** Strip fenced code so we don't pick up links/tags/tasks inside code. Keeps line count. */
const stripCode = (md: string) => md.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " "));

export function wikiLinks(md: string): string[] {
  const out = new Set<string>();
  for (const m of stripCode(md).matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) out.add(m[1].replace(/\\$/, "").trim()); // `\|` = Obsidian table escape
  return [...out];
}

export function inlineTags(md: string): string[] {
  const out = new Set<string>();
  for (const m of stripCode(md).matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) if (!/^\d+$/.test(m[1])) out.add(m[1].toLowerCase());
  return [...out];
}

export interface Heading { level: number; text: string; line: number }
export function outline(md: string): Heading[] {
  const out: Heading[] = [];
  stripCode(md).split("\n").forEach((l, line) => {
    const m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(l);
    if (m) out.push({ level: m[1].length, text: m[2], line });
  });
  return out;
}

export const words = (md: string) => (md.match(/[\p{L}\p{N}]+/gu) ?? []).length;
export const readingMinutes = (md: string) => Math.max(1, Math.round(words(md) / 220));

export function excerpt(md: string, n = 160) {
  // Only the start can reach the first n chars: clean a bounded prefix, not the whole (possibly huge) note.
  return splitFrontMatter(md).body.slice(0, Math.max(4000, n * 25))
    .replace(/```[\s\S]*?```/g, " ").replace(/\$\$[\s\S]*?\$\$/g, " ").replace(/\$[^$\n]+\$/g, "…").replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^>\s*\[![^\]]+\][-+]?/gm, "").replace(/[#>*_`~|-]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
}

// ------------------------------------------------------------------ tasks
export type TaskStatus = "todo" | "doing" | "done";
export interface Task { line: number; text: string; done: boolean; due: string | null; status: TaskStatus }
const TASK_RE = /^(\s*[-*+]\s+)\[( |x|X)\]\s+(.*)$/;
const TASK_RE_DOING = /^(\s*[-*+]\s+)\[( |x|X|\/)\]\s+(.*)$/;
const TASK_MARK: Record<TaskStatus, string> = { todo: " ", doing: "/", done: "x" };
/**
 * `- [ ] task` / `- [x] done` (📅 2026-12-01 or @due(2026-12-01) sets the due date).
 * With `{ doing: true }`, `- [/] task` is also read as a task in progress (project boards). Without it,
 * `[/]` lines are ignored so callers that map rendered checkboxes by index keep working.
 */
export function tasks(md: string, opts: { doing?: boolean } = {}): Task[] {
  const out: Task[] = [];
  const re = opts.doing ? TASK_RE_DOING : TASK_RE;
  stripCode(md).split("\n").forEach((l, line) => {
    const m = re.exec(l);
    if (m) {
      const due = /📅\s*(\d{4}-\d{2}-\d{2})|@due\((\d{4}-\d{2}-\d{2})\)/.exec(m[3]);
      const status: TaskStatus = m[2] === " " ? "todo" : m[2] === "/" ? "doing" : "done";
      out.push({ line, text: m[3].replace(/📅\s*\d{4}-\d{2}-\d{2}|@due\(\d{4}-\d{2}-\d{2}\)/, "").trim(), done: status === "done", due: due ? due[1] || due[2] : null, status });
    }
  });
  return out;
}
/** Checkbox toggle: `[ ]` ↔ `[x]`; an in-progress `[/]` completes to `[x]`. */
export function toggleTask(md: string, line: number): string {
  const lines = md.split("\n");
  lines[line] = lines[line].replace(/\[( |x|X|\/)\]/, (_, c) => (c === " " || c === "/" ? "[x]" : "[ ]"));
  return lines.join("\n");
}
/** Rewrite one task line's marker (`[ ]` todo, `[/]` doing, `[x]` done). */
export function setTaskStatus(md: string, line: number, s: TaskStatus): string {
  const lines = md.split("\n");
  lines[line] = lines[line].replace(/\[( |x|X|\/)\]/, `[${TASK_MARK[s]}]`);
  return lines.join("\n");
}
/** Board cycle used by project spaces: todo → doing → done → todo. */
export const NEXT_TASK: Record<TaskStatus, TaskStatus> = { todo: "doing", doing: "done", done: "todo" };
export const cycleTask = (md: string, t: Task) => setTaskStatus(md, t.line, NEXT_TASK[t.status]);

// ------------------------------------------------------------------ flashcards
/**
 * Basic cards have only q / a / key. Cloze and image-occlusion cards (lib/cloze.ts, lib/occlusion.ts) add `kind`,
 * the source `line` (0-based, full note) and the data Review needs; their q / a are plain-text fallbacks.
 */
export interface Flashcard {
  q: string; a: string; key: string;
  kind?: "cloze" | "occlusion";
  line?: number;
  cloze?: { block: string; n: number };
  occlusion?: { data: Occlusion; target: string[] };
}
export function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
/**
 * `Question :: Answer` on one line, or `Question\n?\nAnswer lines` (blank line ends the answer),
 * then cloze cards ({{c1::…}}, ==…== in flashcard notes) and ```occlusion image cards, appended in that order.
 */
export function flashcards(md: string): Flashcard[] {
  const out: Flashcard[] = [];
  const used = new Set<number>();
  const lines = stripCode(splitFrontMatter(md).body).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const one = /^(?:[-*]\s+)?(.+?)\s+::\s+(.+)$/.exec(l);
    if (one) { out.push({ q: one[1].trim(), a: one[2].trim(), key: hash(one[1].trim()) }); used.add(i); continue; }
    if (lines[i + 1]?.trim() === "?" && l.trim()) {
      const ans: string[] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim()) ans.push(lines[j++]);
      out.push({ q: l.trim(), a: ans.join("\n"), key: hash(l.trim()) });
      for (let k = i; k < j; k++) used.add(k);
      i = j;
    }
  }
  for (const c of clozeCards(md, used)) out.push({ q: c.q, a: c.a, key: c.key, kind: "cloze", line: c.line, cloze: { block: c.block, n: c.n } });
  for (const c of occlusionCards(md)) out.push({ q: `Image: ${c.label}`, a: c.label, key: c.key, kind: "occlusion", line: c.line, occlusion: { data: c.data, target: c.target } });
  return out;
}

// ------------------------------------------------------------------ roadmaps
export type TopicStatus = "todo" | "learning" | "done" | "skipped";
const MARK: Record<string, TopicStatus> = { " ": "todo", "/": "learning", x: "done", X: "done", "-": "skipped" };
export const STATUS_MARK: Record<TopicStatus, string> = { todo: " ", learning: "/", done: "x", skipped: "-" };
export interface Topic {
  name: string; status: TopicStatus; needs: string[];
  /** Recommended order `(after: …)` and see-also `(related: …)` links (round 4, 14b): drawn, never lock a topic. Optional for old callers. */
  after?: string[]; related?: string[];
  due: string | null; note: string | null; line: number; module: number; locked: boolean;
}
export interface Module { name: string; line: number; due: string | null; topics: Topic[] }

export type TopicLinkKey = "needs" | "after" | "related";
const linkRe = (k: TopicLinkKey) => new RegExp(String.raw`\s*\(` + k + String.raw`:[^)]*\)`, "i");
const listOf = (l: string, k: TopicLinkKey) => { const m = new RegExp(String.raw`\(` + k + String.raw`:\s*([^)]+)\)`, "i").exec(l); return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : []; };
/** Every `(needs: …)` / `(after: …)` / `(related: …)` group on a topic line. */
const LINKS_G = /\s*\((?:needs|after|related):[^)]*\)/gi;
const TOPIC_RE = /^\s*[-*+]\s+\[( |\/|x|X|-)\]\s+(.*)$/;
/** A roadmap date: `(calendar emoji) 2026-12-01` (written by the app), or the plain-text forms `due:2026-12-01` / `@due(2026-12-01)`. */
const RM_DUE = /(?:\u{1F4C5}\s*|(?<![\w/])due:\s*|@due\()(\d{4}-\d{2}-\d{2})\)?/u;
const RM_DUE_G = /\s*(?:\u{1F4C5}\s*|(?<![\w/])due:\s*|@due\()\d{4}-\d{2}-\d{2}\)?/gu;
/**
 * Roadmap Markdown:
 *   ## Module name 📅 2026-12-01
 *   - [ ] Topic
 *   - [/] Topic (needs: Other topic, Another) 📅 2026-12-01 → [[Lesson note]]
 *   - [ ] Topic (after: Better first) (related: See also)   ← recommended order · related (no order)
 *   - [x] done · [-] skipped
 */
export function roadmap(md: string): Module[] {
  const mods: Module[] = [];
  md.split("\n").forEach((l, line) => {
    const h = /^#{1,3}\s+(.+)$/.exec(l);
    if (h) {
      const due = RM_DUE.exec(h[1]);
      mods.push({ name: h[1].replace(RM_DUE_G, "").trim(), line, due: due?.[1] ?? null, topics: [] });
      return;
    }
    const m = TOPIC_RE.exec(l);
    if (!m) return;
    if (!mods.length) mods.push({ name: "Topics", line: -1, due: null, topics: [] });
    let rest = m[2];
    const needs = /\(needs:\s*([^)]+)\)/i.exec(rest);
    const due = RM_DUE.exec(rest);
    const note = /(?:→|->)\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(rest);
    const after = listOf(rest, "after"), related = listOf(rest, "related");
    rest = rest.replace(LINKS_G, "").replace(RM_DUE_G, "").replace(/(?:→|->)\s*\[\[[^\]]+\]\]/, "").trim();
    mods[mods.length - 1].topics.push({
      name: rest, status: MARK[m[1]], needs: needs ? needs[1].split(",").map((s) => s.trim()).filter(Boolean) : [], after, related,
      due: due?.[1] ?? null, note: note?.[1].trim() ?? null, line, module: mods.length - 1, locked: false,
    });
  });
  const byName = new Map(mods.flatMap((m) => m.topics).map((t) => [t.name.toLowerCase(), t]));
  for (const t of mods.flatMap((m) => m.topics)) {
    t.locked = t.status === "todo" && t.needs.some((n) => { const d = byName.get(n.toLowerCase()); return d && d.status !== "done" && d.status !== "skipped"; });
  }
  // a "# Title" line with no topics under it is the document title, not an (empty) module
  const lines = md.split("\n");
  const kept = mods.filter((m) => m.topics.length || (m.line >= 0 && !/^#\s/.test(lines[m.line])));
  kept.forEach((m, i) => m.topics.forEach((t) => { t.module = i; }));
  return kept;
}

export function setTopicStatus(md: string, line: number, s: TopicStatus) {
  const lines = md.split("\n");
  lines[line] = lines[line].replace(/\[( |\/|x|X|-)\]/, `[${STATUS_MARK[s]}]`);
  return lines.join("\n");
}
export function linkTopicNote(md: string, line: number, title: string) {
  const lines = md.split("\n");
  if (!/(?:→|->)\s*\[\[/.test(lines[line])) lines[line] = `${lines[line].trimEnd()} → [[${title}]]`;
  return lines.join("\n");
}

export function progress(mods: Module[]) {
  const all = mods.flatMap((m) => m.topics).filter((t) => t.status !== "skipped");
  const done = all.filter((t) => t.status === "done").length;
  return { done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0 };
}

/** Natural sort ("2 Intro" < "10 Advanced", Johnny-Decimal "11.02" < "11.10"). */
export const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

export const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "post";

// ------------------------------------------------------------------ roadmap edits (pure Markdown rewrites, used by drag & drop)
// Every function takes the roadmap note body and returns the new body; lines it doesn't touch stay byte-identical.
const HEADING_RE = /^#{1,3}\s+/;
const indentOf = (l: string) => /^\s*/.exec(l)![0].replace(/\t/g, "  ").length;
const reindent = (l: string, delta: number) => (!l.trim() || !delta ? l : delta > 0 ? " ".repeat(delta) + l : l.replace(new RegExp(`^[ \\t]{0,${-delta}}`), ""));
const withEol = (lines: string[], like: string) => lines.join("\n").replace(/\n+$/, "") + (like.endsWith("\n") || !like ? "\n" : "");

/** A topic line plus everything that belongs to it: deeper-indented lines (sub-topics, notes) up to a blank line or heading. */
export function topicBlock(lines: string[], line: number): [number, number] {
  const ind = indentOf(lines[line]);
  let e = line + 1;
  while (e < lines.length && lines[e].trim() && indentOf(lines[e]) > ind && !HEADING_RE.test(lines[e])) e++;
  return [line, e];
}
function topicName(l: string): string {
  const m = TOPIC_RE.exec(l);
  if (!m) return "";
  return m[2].replace(LINKS_G, "").replace(RM_DUE_G, "").replace(/(?:→|->)\s*\[\[[^\]]+\]\]/, "").trim();
}
function editLine(md: string, line: number, f: (l: string) => string) {
  const lines = md.split("\n");
  if (line < 0 || line >= lines.length) return md;
  lines[line] = f(lines[line]);
  return lines.join("\n");
}
function insertBeforeTail(l: string, frag: string, tail: RegExp) {
  const m = tail.exec(l);
  return m ? `${l.slice(0, m.index).trimEnd()} ${frag} ${l.slice(m.index).trimStart()}` : `${l.trimEnd()} ${frag}`;
}
/** Replace a topic's `(needs: …)` list (removed when empty). */
export const setTopicNeeds = (md: string, line: number, needs: string[]) => setTopicList(md, line, "needs", needs);
/** Replace a topic's `(needs|after|related: …)` list (removed when empty). */
export const setTopicList = (md: string, line: number, key: TopicLinkKey, items: string[]) => editLine(md, line, (l) => {
  const s = l.replace(linkRe(key), "");
  return items.length ? insertBeforeTail(s, `(${key}: ${items.join(", ")})`, /\s(\u{1F4C5}|due:|@due\(|→|->)/u) : s;
});
/**
 * How topic `line` links to `name`: prerequisite, recommended order, related, or not at all (null). The name leaves the other
 * two lists, so a type change keeps one link and rewrites it (needs → after → related). Other lines stay byte-identical.
 */
export function setTopicLink(md: string, line: number, name: string, kind: TopicLinkKey | null): string {
  const l = md.split("\n")[line];
  if (l === undefined || !TOPIC_RE.test(l)) return md;
  const low = name.toLowerCase();
  for (const k of ["needs", "after", "related"] as const) {
    const cur = listOf(md.split("\n")[line], k);
    const rest = cur.filter((n) => n.toLowerCase() !== low);
    const next = k === kind ? [...rest, name] : rest;
    if (next.length !== cur.length || next.some((x, i) => x !== cur[i])) md = setTopicList(md, line, k, next);
  }
  return md;
}
export const setTopicDue = (md: string, line: number, due: string | null) => editLine(md, line, (l) => {
  const s = l.replace(RM_DUE_G, "");
  return due ? insertBeforeTail(s, `📅 ${due}`, /\s(→|->)/) : s;
});

/** Line numbers of every topic `t` (transitively) depends on. */
export function topicAncestors(all: Topic[], t: Topic): Set<number> {
  const byName = new Map(all.map((x) => [x.name.toLowerCase(), x]));
  const out = new Set<number>();
  const stack = [t];
  while (stack.length) {
    const x = stack.pop()!;
    for (const n of x.needs) { const d = byName.get(n.toLowerCase()); if (d && !out.has(d.line)) { out.add(d.line); stack.push(d); } }
  }
  return out;
}
/**
 * The prerequisite chain that makes `from` (transitively) need `to`: [from, …, to] by name, or null.
 * Explains a refused drop ("A already needs B → C, so this would make a loop").
 */
export function needChain(all: Topic[], from: Topic, to: Topic): string[] | null {
  if (from.line === to.line) return null;
  const byName = new Map(all.map((x) => [x.name.toLowerCase(), x]));
  const prev = new Map<number, Topic>();
  const seen = new Set([from.line]);
  const queue = [from];
  while (queue.length && !prev.has(to.line)) {
    const x = queue.shift()!;
    for (const n of x.needs) {
      const d = byName.get(n.toLowerCase());
      if (!d || seen.has(d.line)) continue;
      seen.add(d.line); prev.set(d.line, x); queue.push(d);
    }
  }
  if (!prev.has(to.line)) return null;
  const path: string[] = [];
  for (let c: Topic | undefined = to; c; c = c.line === from.line ? undefined : prev.get(c.line)) path.unshift(c.name);
  return path;
}
/** Can `prereq` become a prerequisite of `t`? (not itself, not already, no cycle) */
export function canAddNeed(all: Topic[], t: Topic, prereq: Topic) {
  return t.line !== prereq.line && !t.needs.some((n) => n.toLowerCase() === prereq.name.toLowerCase()) && !topicAncestors(all, prereq).has(t.line);
}
/** Make the topic on `prereqLine` a prerequisite of the topic on `line` (unchanged when it would create a cycle). */
export function addTopicNeed(md: string, line: number, prereqLine: number) {
  const all = roadmap(md).flatMap((m) => m.topics);
  const t = all.find((x) => x.line === line), d = all.find((x) => x.line === prereqLine);
  if (!t || !d || !canAddNeed(all, t, d)) return md;
  return setTopicNeeds(md, line, [...t.needs, d.name]);
}
export function removeTopicNeed(md: string, line: number, name: string) {
  const t = roadmap(md).flatMap((m) => m.topics).find((x) => x.line === line);
  if (!t) return md;
  return setTopicNeeds(md, line, t.needs.filter((n) => n.toLowerCase() !== name.toLowerCase()));
}

/**
 * Move a topic (with its sub-lines) into module `toModule`, before the topic on `beforeLine` (null = end of the module).
 * The block is re-indented to its new siblings, so a nested topic moved elsewhere doesn't become someone else's child.
 */
export function moveTopic(md: string, line: number, toModule: number, beforeLine: number | null): string {
  const m = roadmap(md)[toModule];
  const lines = md.split("\n");
  if (!m || !TOPIC_RE.test(lines[line] ?? "") || beforeLine === line) return md;
  const [s, e] = topicBlock(lines, line);
  if (beforeLine !== null && beforeLine > s && beforeLine < e) return md; // into its own children
  const others = m.topics.filter((t) => t.line < s || t.line >= e);
  let at: number, ind: number;
  if (beforeLine !== null && others.some((t) => t.line === beforeLine)) { at = beforeLine; ind = indentOf(lines[beforeLine]); }
  else if (others.length) { at = Math.max(...others.map((t) => topicBlock(lines, t.line)[1])); ind = Math.min(...others.map((t) => indentOf(lines[t.line]))); }
  else if (m.line >= 0) { at = m.line + 1; ind = 0; }
  else return md;
  const delta = ind - indentOf(lines[line]);
  if (at >= s && at <= e && !delta) return md; // same place
  const block = lines.slice(s, e).map((l) => reindent(l, delta));
  lines.splice(s, e - s);
  if (at > s) at -= e - s;
  lines.splice(at, 0, ...block);
  return lines.join("\n");
}
/** One step up/down for keyboard reordering (Alt+↑/↓); crosses into the neighbouring module at the edges. */
export function nudgeTopic(md: string, line: number, dir: -1 | 1): string {
  const mods = roadmap(md);
  const lines = md.split("\n");
  const mi = mods.findIndex((m) => m.topics.some((t) => t.line === line));
  if (mi < 0) return md;
  const ind = indentOf(lines[line]);
  const sib = mods[mi].topics.filter((t) => indentOf(lines[t.line]) === ind);
  const i = sib.findIndex((t) => t.line === line);
  if (dir < 0) {
    if (i > 0) return moveTopic(md, line, mi, sib[i - 1].line);
    return mi > 0 ? moveTopic(md, line, mi - 1, null) : md;
  }
  if (i < sib.length - 2) return moveTopic(md, line, mi, sib[i + 2].line);
  if (i === sib.length - 2) return moveTopic(md, line, mi, null);
  return mi < mods.length - 1 ? moveTopic(md, line, mi + 1, mods[mi + 1].topics[0]?.line ?? null) : md;
}

/** Lines [start, end) of a module: its heading up to the next heading (level 1–3). */
function moduleBlock(lines: string[], start: number): [number, number] {
  let e = start + 1;
  while (e < lines.length && !HEADING_RE.test(lines[e])) e++;
  return [start, e];
}
/** Reorder modules: put module `from` before module `before` (null = last). Each module moves as a whole block. */
export function moveModule(md: string, from: number, before: number | null): string {
  const mods = roadmap(md);
  const m = mods[from];
  if (!m || m.line < 0 || before === from || (before !== null && (!mods[before] || mods[before].line < 0))) return md;
  const lines = md.split("\n");
  const [s, e] = moduleBlock(lines, m.line);
  if (before !== null && mods[before].line === e) return md; // already right before it
  if (before === null && e === lines.length) return md; // already last
  const block = lines.slice(s, e);
  while (block.length > 1 && !block[block.length - 1].trim()) block.pop();
  let at = before === null ? lines.length : mods[before].line;
  lines.splice(s, e - s);
  if (at > s) at -= e - s;
  if (before === null) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push("", ...block);
  } else lines.splice(at, 0, ...block, "");
  return withEol(lines, md);
}
/** One step up/down for a module (Alt+↑/↓ on its header). */
export function nudgeModule(md: string, module: number, dir: -1 | 1): string {
  const n = roadmap(md).length;
  if (dir < 0) return module > 0 ? moveModule(md, module, module - 1) : md;
  return module < n - 2 ? moveModule(md, module, module + 2) : module === n - 2 ? moveModule(md, module, null) : md;
}
/** Insert `- [ ] name` (optionally `→ [[note]]`) into a module, before `beforeLine` or at its end. No such module → new `## Topics`. */
export function addTopic(md: string, module: number | null, name: string, opts: { beforeLine?: number | null; note?: string } = {}): string {
  const text = `- [ ] ${name.trim()}${opts.note ? ` → [[${opts.note}]]` : ""}`;
  const m = module === null ? undefined : roadmap(md)[module];
  const lines = md.split("\n");
  if (!m || m.line < 0 && !m.topics.length) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push(...(lines.length ? [""] : []), "## Topics", text);
    return withEol(lines, md);
  }
  const at = opts.beforeLine != null && m.topics.some((t) => t.line === opts.beforeLine) ? opts.beforeLine
    : m.topics.length ? Math.max(...m.topics.map((t) => topicBlock(lines, t.line)[1])) : m.line + 1;
  const ind = m.topics.length ? Math.min(...m.topics.map((t) => indentOf(lines[t.line]))) : 0;
  lines.splice(at, 0, " ".repeat(ind) + text);
  return lines.join("\n");
}
/** Append a `## name` module (with optional topics) at the end. */
export function addModule(md: string, name: string, topics: { name: string; note?: string }[] = []): string {
  const lines = md.split("\n");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  lines.push(...(lines.length ? [""] : []), `## ${name.trim()}`, ...topics.map((t) => `- [ ] ${t.name}${t.note ? ` → [[${t.note}]]` : ""}`));
  return withEol(lines, md);
}
/** Rename a module heading (keeps its level and 📅 date). */
export function renameModule(md: string, module: number, name: string): string {
  const m = roadmap(md)[module];
  if (!m || m.line < 0 || !name.trim()) return md;
  return editLine(md, m.line, (l) => `${/^(#{1,3}\s+)/.exec(l)![1]}${name.trim()}${m.due ? ` 📅 ${m.due}` : ""}`);
}
/** Remove a module heading with all its topics; their names are dropped from other topics' needs. */
export function deleteModule(md: string, module: number): string {
  const m = roadmap(md)[module];
  if (!m || m.line < 0) return md;
  const lines = md.split("\n");
  const [s, e] = moduleBlock(lines, m.line);
  lines.splice(s, e - s);
  let out = withEol(lines, md);
  for (const t of m.topics) out = stripNeed(out, t.name);
  return out;
}
/** Rename a topic and every `(needs: …)` reference to it. */
export function renameTopic(md: string, line: number, name: string): string {
  const lines = md.split("\n");
  const old = topicName(lines[line] ?? "");
  const nn = name.trim().replace(/[()]/g, "");
  if (!old || !nn || old === nn) return md;
  const m = TOPIC_RE.exec(lines[line])!;
  const head = lines[line].slice(0, lines[line].length - m[2].length);
  const i = m[2].indexOf(old);
  lines[line] = head + (i >= 0 ? m[2].slice(0, i) + nn + m[2].slice(i + old.length) : `${nn} ${m[2]}`);
  return mapNeeds(lines.join("\n"), (n) => (n.toLowerCase() === old.toLowerCase() ? nn : n));
}
function mapNeeds(md: string, f: (n: string) => string | null): string {
  return md.split("\n").map((l) => {
    if (!TOPIC_RE.test(l)) return l;
    // (needs: …) plus the round-4 (after: …) / (related: …) lists: renames and deletes follow every link type
    for (const key of ["needs", "after", "related"] as const) {
      const m = new RegExp(String.raw`\(` + key + String.raw`:\s*([^)]+)\)`, "i").exec(l);
      if (!m) continue;
      const needs = m[1].split(",").map((s) => s.trim()).filter(Boolean);
      const next = needs.map(f).filter((x): x is string => !!x);
      if (next.length === needs.length && next.every((x, i) => x === needs[i])) continue;
      l = next.length ? l.replace(m[0], `(${key}: ${next.join(", ")})`) : l.replace(linkRe(key), "");
    }
    return l;
  }).join("\n");
}
const stripNeed = (md: string, name: string) => mapNeeds(md, (n) => (n.toLowerCase() === name.toLowerCase() ? null : n));
/** Delete a topic (with its sub-lines); other topics stop needing it. */
export function deleteTopic(md: string, line: number): string {
  const lines = md.split("\n");
  if (!TOPIC_RE.test(lines[line] ?? "")) return md;
  const name = topicName(lines[line]);
  const [s, e] = topicBlock(lines, line);
  lines.splice(s, e - s);
  return stripNeed(lines.join("\n"), name);
}
/** "New topic", "New topic 2", … not used yet in this roadmap. */
export function uniqueTopicName(mods: Module[], base = "New topic") {
  const taken = new Set(mods.flatMap((m) => m.topics).map((t) => t.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}
/** Line of the topic named `name` (case-insensitive) in a roadmap body, or null. */
export const topicLineByName = (md: string, name: string) => roadmap(md).flatMap((m) => m.topics).find((t) => t.name.toLowerCase() === name.toLowerCase())?.line ?? null;
