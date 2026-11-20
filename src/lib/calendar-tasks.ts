// Tasks from everywhere (round 8, page 55): every `- [ ]` line in any note, read with its metadata, smart lists,
// quick-add parsing, and the Markdown edits behind the task detail panel. A task stays a Markdown checkbox in the
// note it came from; the checklist is its indented sub-tasks.
//
// Line format (Obsidian Tasks-compatible where a convention exists, Dataview inline fields otherwise):
//   - [ ] Lab report: CNN results 📅 2026-11-16 ⏰ 10:30 ~90m ⏫ 🔁 every week [remind:: 30m] [plan:: Deep learning] #dl
//     - [x] Load data + augment          ← checklist (indented sub-tasks)
// `[/]` = doing, `#waiting` = waiting, `✅ 2026-11-20` = completed on. Priority: ⏫ high · 🔼 medium · 🔽 low.
import { parseDur, parseHM, shiftDay, weekday } from "./calendar";
import { tasks as parseTasks, type TaskStatus } from "./parse";

export type Prio = "high" | "medium" | "low" | null;
export type Repeat = "day" | "weekday" | "week" | "2 weeks" | "month" | "year" | null;
export type Lane = "todo" | "doing" | "waiting" | "done";

export interface TaskMeta {
  text: string; due: string | null; time: number | null; est: number | null; prio: Prio; repeat: Repeat;
  remind: number | null; plan: string | null; doneOn: string | null; tags: string[]; waiting: boolean;
}
export interface SubTask { line: number; text: string; done: boolean }
export interface CalTask extends TaskMeta {
  key: string; noteId: string; noteTitle: string; spaceId: string; line: number; status: TaskStatus; done: boolean;
  /** Plan id resolved from `[plan:: …]`, a plan alias tag, or the space the note lives in. */
  planId: string | null;
  subtasks: SubTask[];
  journal: boolean;
}

// ------------------------------------------------------------------ tokens
const T_DUE = /\s*(?:\u{1F4C5}\s*\d{4}-\d{2}-\d{2}|@due\(\d{4}-\d{2}-\d{2}\))/u;
const T_TIME = /\s*⏰\s*(\d{1,2}:\d{2})/u;
const T_EST = /(?:^|\s)~(\d+(?:\.\d+)?h(?:\d+m)?|\d+m(?:in)?)(?=\s|$)/;
const T_PRIO = /\s*(⏫|\u{1F53C}|\u{1F53D})️?/u;
const T_REP = /\s*\u{1F501}\s*every\s+(day|weekday|week|2 weeks|month|year)/u;
const T_REM = /\s*\[remind::\s*([^\]]+)\]/;
const T_PLAN = /\s*\[plan::\s*([^\]]+)\]/;
const T_DONE = /\s*✅\s*(\d{4}-\d{2}-\d{2})/u;
const PRIO_MARK: Record<Exclude<Prio, null>, string> = { high: "⏫", medium: "\u{1F53C}", low: "\u{1F53D}" };

/** Read the metadata out of a task's text (the part after the checkbox). */
export function taskMeta(raw: string): TaskMeta {
  const due = /\u{1F4C5}\s*(\d{4}-\d{2}-\d{2})|@due\((\d{4}-\d{2}-\d{2})\)/u.exec(raw);
  const time = T_TIME.exec(raw);
  const est = T_EST.exec(raw);
  const pr = T_PRIO.exec(raw);
  const rep = T_REP.exec(raw);
  const rem = T_REM.exec(raw);
  const plan = T_PLAN.exec(raw);
  const done = T_DONE.exec(raw);
  const text = raw.replace(T_DUE, "").replace(T_TIME, "").replace(T_EST, " ").replace(T_PRIO, "").replace(T_REP, "").replace(T_REM, "").replace(T_PLAN, "").replace(T_DONE, "").replace(/\s+/g, " ").trim();
  const tags = [...text.matchAll(/(?:^|\s)(#[\p{L}\p{N}_/-]+)/gu)].map((m) => m[1]);
  return {
    text, due: due ? due[1] || due[2] : null, time: time ? parseHM(time[1]) : null, est: est ? parseDur(est[1]) : null,
    prio: pr ? (pr[1] === "⏫" ? "high" : pr[1] === "\u{1F53C}" ? "medium" : "low") : null,
    repeat: rep ? (rep[1] as Repeat) : null, remind: rem ? parseDur(rem[1].replace(/\s/g, "")) : null, plan: plan ? plan[1].trim() : null,
    doneOn: done ? done[1] : null, tags, waiting: tags.some((t) => t.toLowerCase() === "#waiting"),
  };
}
/** Text without tags (titles in lists show tags separately). */
export const plainText = (t: TaskMeta) => t.text.replace(/(?:^|\s)#[\p{L}\p{N}_/-]+/gu, "").trim() || t.text;

const indentOf = (l: string) => /^\s*/.exec(l)![0].replace(/\t/g, "  ").length;

export interface PlanRef { id: string; title: string; spaceId: string | null; aliases: string[] }
export interface NoteLike { id: string; title: string; body: string; spaceId: string; type: string; deleted?: number }

/** Every task in the given notes. Sub-tasks (indented under a task) become the parent's checklist, not tasks of their own. */
export function collectTasks(notes: NoteLike[], plans: PlanRef[], skip: Set<string> = new Set()): CalTask[] {
  const byName = new Map<string, string>();
  for (const p of plans) { byName.set(p.title.toLowerCase(), p.id); for (const a of p.aliases) byName.set(a.toLowerCase(), p.id); }
  const bySpace = new Map(plans.filter((p) => p.spaceId).map((p) => [p.spaceId!, p.id]));
  const out: CalTask[] = [];
  for (const n of notes) {
    if (n.deleted || n.type === "roadmap" || n.type === "canvas" || skip.has(n.id) || !n.body.includes("[")) continue;
    const lines = n.body.split("\n");
    const found = parseTasks(n.body, { doing: true });
    let parent: { t: CalTask; ind: number } | null = null;
    for (const f of found) {
      const ind = indentOf(lines[f.line] ?? "");
      if (parent && ind > parent.ind && parent.t.line < f.line) { parent.t.subtasks.push({ line: f.line, text: taskMeta(f.text).text, done: f.done }); continue; }
      const raw = (/\]\s+(.*)$/.exec(lines[f.line] ?? "")?.[1]) ?? f.text;
      const m = taskMeta(raw);
      const planId = (m.plan && byName.get(m.plan.toLowerCase())) || m.tags.map((t) => byName.get(t.slice(1).toLowerCase())).find(Boolean) || bySpace.get(n.spaceId) || null;
      const t: CalTask = { ...m, key: `${n.id}:${f.line}`, noteId: n.id, noteTitle: n.title, spaceId: n.spaceId, line: f.line, status: f.status, done: f.done, planId, subtasks: [], journal: n.type === "journal" };
      out.push(t);
      parent = { t, ind };
    }
  }
  return out;
}

export const laneOf = (t: CalTask): Lane => (t.done ? "done" : t.status === "doing" ? "doing" : t.waiting ? "waiting" : "todo");

// ------------------------------------------------------------------ smart lists
export type ListId = "inbox" | "today" | "upcoming" | "overdue" | "completed" | "week" | "nodate" | "waiting" | "high" | "notes" | `plan:${string}` | `tag:${string}`;
export function inList(t: CalTask, id: ListId, today: string): boolean {
  const open = !t.done;
  const weekEnd = shiftDay(today, 6);
  switch (id) {
    case "inbox": return open && !t.planId && (t.spaceId === "inbox" || t.journal);
    case "today": return open && !!t.due && t.due <= today || open && t.status === "doing";
    case "upcoming": return open && !!t.due && t.due > today;
    case "overdue": return open && !!t.due && t.due < today;
    case "completed": return t.done;
    case "week": return open && !!t.due && t.due >= today && t.due <= weekEnd;
    case "nodate": return open && !t.due;
    case "waiting": return open && t.waiting;
    case "high": return open && t.prio === "high";
    case "notes": return open && !t.journal && t.spaceId !== "inbox";
    default:
      if (id.startsWith("plan:")) return open && t.planId === id.slice(5);
      if (id.startsWith("tag:")) return open && t.tags.some((x) => x.toLowerCase() === id.slice(4).toLowerCase());
      return open;
  }
}
/** The most used tag among open tasks (shown as a smart list), ignoring #waiting. */
export function topTag(ts: CalTask[]): string | null {
  const c = new Map<string, number>();
  for (const t of ts) if (!t.done) for (const g of t.tags) if (g.toLowerCase() !== "#waiting") c.set(g, (c.get(g) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}
/** Due groups for the list view (Overdue · Today · Tomorrow · This week · Later · No date). */
export type DueGroup = "Overdue" | "Today" | "Tomorrow" | "This week" | "Later" | "No date" | "Completed";
export function dueGroup(t: CalTask, today: string): DueGroup {
  if (t.done) return "Completed";
  if (!t.due) return t.status === "doing" ? "Today" : "No date";
  if (t.due < today) return "Overdue";
  if (t.due === today) return "Today";
  if (t.due === shiftDay(today, 1)) return "Tomorrow";
  if (t.due <= shiftDay(today, 6)) return "This week";
  return "Later";
}
export const DUE_GROUPS: DueGroup[] = ["Overdue", "Today", "Tomorrow", "This week", "Later", "No date", "Completed"];
const PR_RANK = { high: 0, medium: 1, low: 3 } as const;
export type SortBy = "due" | "priority" | "title";
export function sortTasks(ts: CalTask[], by: SortBy): CalTask[] {
  const r = (t: CalTask) => (t.prio ? PR_RANK[t.prio] : 2);
  return [...ts].sort((a, b) =>
    by === "title" ? a.text.localeCompare(b.text)
      : by === "priority" ? r(a) - r(b) || (a.due ?? "9").localeCompare(b.due ?? "9")
        : (a.due ?? "9").localeCompare(b.due ?? "9") || (a.time ?? 1e4) - (b.time ?? 1e4) || r(a) - r(b));
}

// ------------------------------------------------------------------ quick add
const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export interface Parsed { text: string; due: string | null; time: number | null; prio: Prio; est: number | null; repeat: Repeat; planId: string | null; tags: string[] }
/**
 * Quick add: "lab report fri #dl !high" → due Friday, tag #dl (and plan Deep learning when #dl is its alias), high
 * priority. Understands today / tomorrow / tmr / weekday names / next week / in N days / 3 dec / 2026-12-03, times
 * (10:30, 4pm, at 9), !high !med !low (or !1 !2 !3), ~90m estimates and "every week".
 */
export function quickParse(input: string, today: string, plans: PlanRef[] = []): Parsed {
  let s = ` ${input.trim()} `;
  let due: string | null = null, time: number | null = null, prio: Prio = null, est: number | null = null, repeat: Repeat = null;
  const take = (re: RegExp, f: (m: RegExpExecArray) => boolean | void) => { const m = re.exec(s); if (m && f(m) !== false) s = s.replace(m[0], " "); };
  take(/\s!(high|h|1|med|medium|m|2|low|l|3)(?=\s)/i, (m) => { const k = m[1].toLowerCase(); prio = /^(high|h|1)$/.test(k) ? "high" : /^(med|medium|m|2)$/.test(k) ? "medium" : "low"; });
  take(/\s~(\d+(?:\.\d+)?h(?:\d+m)?|\d+m(?:in)?)(?=\s)/i, (m) => { est = parseDur(m[1]); });
  take(/\severy\s+(day|weekday|week|2 weeks|month|year)(?=\s)/i, (m) => { repeat = m[1].toLowerCase() as Repeat; });
  take(/\s(\d{4}-\d{2}-\d{2})(?=\s)/, (m) => { due = m[1]; });
  if (!due) take(/\s(today|tod|tomorrow|tmr|tmrw)(?=\s)/i, (m) => { due = /^tod/i.test(m[1]) ? today : shiftDay(today, 1); });
  if (!due) take(/\snext week(?=\s)/i, () => { due = shiftDay(today, ((8 - weekday(today)) % 7) || 7); });
  if (!due) take(/\sin (\d+) (day|days|week|weeks)(?=\s)/i, (m) => { due = shiftDay(today, Number(m[1]) * (/week/i.test(m[2]) ? 7 : 1)); });
  if (!due) take(/\s(?:on\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*(?=\s)/i, (m) => { const w = WD.indexOf(m[1].toLowerCase()); due = shiftDay(today, ((w - weekday(today) + 7) % 7) || 7); });
  if (!due) take(/\s(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?=\s)/i, (m) => {
    const y0 = Number(today.slice(0, 4)), mo = MON.indexOf(m[2].toLowerCase()), d = Number(m[1]);
    let iso = `${y0}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (iso < today) iso = `${y0 + 1}${iso.slice(4)}`;
    due = iso;
  });
  take(/\s(?:at\s+)?(\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))(?=\s)/i, (m) => { const v = parseHM(m[1]); if (v == null) return false; time = v; });
  if (time == null) take(/\sat\s+(\d{1,2})(?=\s)/i, (m) => { const v = parseHM(m[1]); if (v == null) return false; time = v; });
  const tags = [...s.matchAll(/\s(#[\p{L}\p{N}_/-]+)/gu)].map((m) => m[1]);
  const byName = new Map<string, string>();
  for (const p of plans) for (const a of [p.title, ...p.aliases]) byName.set(a.toLowerCase(), p.id);
  const planId = tags.map((t) => byName.get(t.slice(1).toLowerCase())).find(Boolean) ?? null;
  if (time != null && !due) due = today;
  return { text: s.replace(/\s+/g, " ").trim(), due, time, prio, est, repeat, planId, tags };
}
/** One task line from parsed fields (tags stay in the text). */
export function taskLine(p: { text: string; due?: string | null; time?: number | null; est?: number | null; prio?: Prio; repeat?: Repeat; plan?: string | null }, indent = "") {
  const parts = [p.text];
  if (p.due) parts.push(`\u{1F4C5} ${p.due}`);
  if (p.time != null) parts.push(`⏰ ${String(Math.floor(p.time / 60)).padStart(2, "0")}:${String(p.time % 60).padStart(2, "0")}`);
  if (p.est) parts.push(`~${p.est}m`);
  if (p.prio) parts.push(PRIO_MARK[p.prio]);
  if (p.repeat) parts.push(`\u{1F501} every ${p.repeat}`);
  if (p.plan) parts.push(`[plan:: ${p.plan}]`);
  return `${indent}- [ ] ${parts.join(" ")}`;
}

// ------------------------------------------------------------------ edits (Markdown in, Markdown out)
type Field = "due" | "time" | "est" | "prio" | "repeat" | "remind" | "plan";
const FIELD_RE: Record<Field, RegExp> = { due: T_DUE, time: T_TIME, est: /\s~(\d+(?:\.\d+)?h(?:\d+m)?|\d+m(?:in)?)(?=\s|$)/, prio: T_PRIO, repeat: T_REP, remind: T_REM, plan: T_PLAN };
function fieldText(f: Field, v: string | number): string {
  switch (f) {
    case "due": return `\u{1F4C5} ${v}`;
    case "time": { const n = Number(v); return `⏰ ${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`; }
    case "est": return `~${v}m`;
    case "prio": return PRIO_MARK[v as Exclude<Prio, null>];
    case "repeat": return `\u{1F501} every ${v}`;
    case "remind": return `[remind:: ${v}m]`;
    case "plan": return `[plan:: ${v}]`;
  }
}
/** Set (or clear with null) one field on the task at `line`. */
export function setField(md: string, line: number, f: Field, v: string | number | null): string {
  const lines = md.split("\n");
  let l = (lines[line] ?? "").replace(FIELD_RE[f], "");
  if (v != null && v !== "") l = l.replace(/\s*$/, "") + " " + fieldText(f, v);
  lines[line] = l;
  return lines.join("\n");
}
/** Rename a task (keeps its metadata). */
export function setText(md: string, line: number, text: string): string {
  const lines = md.split("\n");
  const l = lines[line] ?? "";
  const m = /^(\s*[-*+]\s+\[[^\]]\]\s+)(.*)$/.exec(l);
  if (!m) return md;
  const i = m[2].search(/\s(?:\u{1F4C5}|@due\(|⏰|~\d|⏫|\u{1F53C}|\u{1F53D}|\u{1F501}|\[remind::|\[plan::|✅)/u);
  const own = new Set([...text.matchAll(/#[\p{L}\p{N}_/-]+/gu)].map((x) => x[0].toLowerCase()));
  const tail = (i >= 0 ? m[2].slice(i) : "").replace(/\s#[\p{L}\p{N}_/-]+/gu, (x) => (own.has(x.trim().toLowerCase()) ? "" : x));
  lines[line] = m[1] + text.trim() + tail;
  return lines.join("\n");
}
function nextDue(d: string, r: Exclude<Repeat, null>): string {
  if (r === "day") return shiftDay(d, 1);
  if (r === "weekday") { let x = shiftDay(d, 1); while (weekday(x) === 0 || weekday(x) === 6) x = shiftDay(x, 1); return x; }
  if (r === "week") return shiftDay(d, 7);
  if (r === "2 weeks") return shiftDay(d, 14);
  const dt = new Date(d + "T00:00:00Z");
  if (r === "month") dt.setUTCMonth(dt.getUTCMonth() + 1); else dt.setUTCFullYear(dt.getUTCFullYear() + 1);
  return dt.toISOString().slice(0, 10);
}
/**
 * Mark the task at `line` done (`[x]` + `✅ today`) or not done. A repeating task completes and a fresh copy with the
 * next due date is inserted above it (Obsidian Tasks behaviour), with its checklist reset.
 */
export function completeTask(md: string, line: number, done: boolean, today: string): string {
  const lines = md.split("\n");
  const l = lines[line] ?? "";
  if (!done) { lines[line] = l.replace(/\[(x|X)\]/, "[ ]").replace(T_DONE, ""); return lines.join("\n"); }
  const raw = /\]\s+(.*)$/.exec(l)?.[1] ?? "";
  const m = taskMeta(raw);
  lines[line] = l.replace(/\[( |\/)\]/, "[x]").replace(T_DONE, "").replace(/\s*$/, "") + ` ✅ ${today}`;
  if (m.repeat) {
    const base = m.due ?? today;
    let nd = nextDue(base, m.repeat);
    while (nd <= today && m.due) nd = nextDue(nd, m.repeat);
    const fresh = l.replace(/\[(x|X|\/)\]/, "[ ]").replace(T_DONE, "").replace(T_DUE, "").replace(/\s*$/, "") + ` \u{1F4C5} ${nd}`;
    const ind = indentOf(l);
    const kids: string[] = [];
    for (let i = line + 1; i < lines.length && lines[i].trim() && indentOf(lines[i]) > ind; i++) kids.push(lines[i].replace(/\[(x|X|\/)\]/, "[ ]"));
    lines.splice(line, 0, fresh, ...kids);
  }
  return lines.join("\n");
}
/** Board lanes: To do `[ ]`, Doing `[/]`, Waiting `[ ] … #waiting`, Done `[x]`. */
export function setLane(md: string, line: number, lane: Lane, today: string): string {
  if (lane === "done") return completeTask(md, line, true, today);
  let out = completeTask(md, line, false, today);
  const lines = out.split("\n");
  let l = lines[line].replace(/\[( |x|X|\/)\]/, lane === "doing" ? "[/]" : "[ ]").replace(/\s#waiting\b/i, "");
  if (lane === "waiting") l = l.replace(/\s*$/, "") + " #waiting";
  lines[line] = l;
  out = lines.join("\n");
  return out;
}
/** Add a checklist item under the task (after its last sub-task), indented one level deeper. */
export function addSubtask(md: string, line: number, text: string): string {
  const lines = md.split("\n");
  const ind = indentOf(lines[line] ?? "");
  let at = line + 1;
  while (at < lines.length && lines[at].trim() && indentOf(lines[at]) > ind) at++;
  lines.splice(at, 0, `${" ".repeat(ind + 2)}- [ ] ${text.trim()}`);
  return lines.join("\n");
}
