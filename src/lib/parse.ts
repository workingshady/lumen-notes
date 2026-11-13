// Pure Markdown parsing helpers: front-matter, links, tags, tasks, flashcards, outline, roadmaps.

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
  for (const m of stripCode(md).matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) out.add(m[1].trim());
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
  return splitFrontMatter(md).body
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
export interface Flashcard { q: string; a: string; key: string }
export function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
/** `Question :: Answer` on one line, or `Question\n?\nAnswer lines` (blank line ends the answer). */
export function flashcards(md: string): Flashcard[] {
  const out: Flashcard[] = [];
  const lines = stripCode(splitFrontMatter(md).body).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const one = /^(?:[-*]\s+)?(.+?)\s+::\s+(.+)$/.exec(l);
    if (one) { out.push({ q: one[1].trim(), a: one[2].trim(), key: hash(one[1].trim()) }); continue; }
    if (lines[i + 1]?.trim() === "?" && l.trim()) {
      const ans: string[] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim()) ans.push(lines[j++]);
      out.push({ q: l.trim(), a: ans.join("\n"), key: hash(l.trim()) });
      i = j;
    }
  }
  return out;
}

// ------------------------------------------------------------------ roadmaps
export type TopicStatus = "todo" | "learning" | "done" | "skipped";
const MARK: Record<string, TopicStatus> = { " ": "todo", "/": "learning", x: "done", X: "done", "-": "skipped" };
export const STATUS_MARK: Record<TopicStatus, string> = { todo: " ", learning: "/", done: "x", skipped: "-" };
export interface Topic { name: string; status: TopicStatus; needs: string[]; due: string | null; note: string | null; line: number; module: number; locked: boolean }
export interface Module { name: string; line: number; due: string | null; topics: Topic[] }

const TOPIC_RE = /^\s*[-*+]\s+\[( |\/|x|X|-)\]\s+(.*)$/;
/**
 * Roadmap Markdown:
 *   ## Module name 📅 2026-12-01
 *   - [ ] Topic
 *   - [/] Topic (needs: Other topic, Another) 📅 2026-12-01 → [[Lesson note]]
 *   - [x] done · [-] skipped
 */
export function roadmap(md: string): Module[] {
  const mods: Module[] = [];
  md.split("\n").forEach((l, line) => {
    const h = /^#{1,3}\s+(.+)$/.exec(l);
    if (h) {
      const due = /📅\s*(\d{4}-\d{2}-\d{2})/.exec(h[1]);
      mods.push({ name: h[1].replace(/📅\s*\d{4}-\d{2}-\d{2}/, "").trim(), line, due: due?.[1] ?? null, topics: [] });
      return;
    }
    const m = TOPIC_RE.exec(l);
    if (!m) return;
    if (!mods.length) mods.push({ name: "Topics", line: -1, due: null, topics: [] });
    let rest = m[2];
    const needs = /\(needs:\s*([^)]+)\)/i.exec(rest);
    const due = /📅\s*(\d{4}-\d{2}-\d{2})/.exec(rest);
    const note = /(?:→|->)\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(rest);
    rest = rest.replace(/\(needs:[^)]*\)/i, "").replace(/📅\s*\d{4}-\d{2}-\d{2}/, "").replace(/(?:→|->)\s*\[\[[^\]]+\]\]/, "").trim();
    mods[mods.length - 1].topics.push({
      name: rest, status: MARK[m[1]], needs: needs ? needs[1].split(",").map((s) => s.trim()).filter(Boolean) : [],
      due: due?.[1] ?? null, note: note?.[1].trim() ?? null, line, module: mods.length - 1, locked: false,
    });
  });
  const byName = new Map(mods.flatMap((m) => m.topics).map((t) => [t.name.toLowerCase(), t]));
  for (const t of mods.flatMap((m) => m.topics)) {
    t.locked = t.status === "todo" && t.needs.some((n) => { const d = byName.get(n.toLowerCase()); return d && d.status !== "done" && d.status !== "skipped"; });
  }
  return mods.filter((m) => m.topics.length || m.line >= 0);
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
