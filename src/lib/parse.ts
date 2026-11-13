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
    .replace(/```[\s\S]*?```/g, " ").replace(/\$\$[\s\S]*?\$\$/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^>\s*\[![^\]]+\][-+]?/gm, "").replace(/[#>*_`~|-]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
}

// ------------------------------------------------------------------ tasks
export interface Task { line: number; text: string; done: boolean; due: string | null }
const TASK_RE = /^(\s*[-*+]\s+)\[( |x|X)\]\s+(.*)$/;
export function tasks(md: string): Task[] {
  const out: Task[] = [];
  stripCode(md).split("\n").forEach((l, line) => {
    const m = TASK_RE.exec(l);
    if (m) {
      const due = /📅\s*(\d{4}-\d{2}-\d{2})|@due\((\d{4}-\d{2}-\d{2})\)/.exec(m[3]);
      out.push({ line, text: m[3].replace(/📅\s*\d{4}-\d{2}-\d{2}|@due\(\d{4}-\d{2}-\d{2}\)/, "").trim(), done: m[2] !== " ", due: due ? due[1] || due[2] : null });
    }
  });
  return out;
}
export function toggleTask(md: string, line: number): string {
  const lines = md.split("\n");
  lines[line] = lines[line].replace(/\[( |x|X)\]/, (_, c) => (c === " " ? "[x]" : "[ ]"));
  return lines.join("\n");
}

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
