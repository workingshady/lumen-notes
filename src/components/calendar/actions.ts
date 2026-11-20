// Writes behind Today, Calendar and Tasks (round 8, page 55). Every change is a Markdown edit in a synced note
// (the task's own note, today's journal, or the Calendar note) through updateNote / createNote.
import { createNote, updateNote } from "../../lib/actions";
import { db } from "../../lib/db";
import type { CalItem } from "../../lib/calendar";
import { CAL_NOTE_ID, editNote, moveLine, removeLine } from "../../lib/calendar-store";
import { addSubtask, completeTask, setField, setLane, setText, taskLine, type CalTask, type Lane, type Parsed } from "../../lib/calendar-tasks";
import type { CalPlan } from "../../lib/calendar-plans";
import { go, openNote, toast } from "../../lib/store";
import { startStudyTimer } from "../Timer";
import { openNoteAtLine } from "../study-nav";
import { t } from "../../lib/i18n";

/** Today's journal note (created on first use, in the plan's space when given, else the inbox). */
export async function journalFor(day: string, spaceId?: string | null) {
  const all = await db.notes.filter((n) => n.type === "journal").toArray();
  const hit = all.find((n) => !n.deleted && n.title.includes(day));
  if (hit) return hit;
  return createNote({ template: "journal", title: `Journal ${day}`, spaceId: spaceId || "inbox" });
}
const append = (body: string, line: string) => { const b = body.replace(/\s*$/, ""); return `${b}${b ? "\n" : ""}${line}\n`; };

/** Quick add: the task goes to today's journal as a Markdown checkbox (the plan is kept as `[plan:: …]`). */
export async function addTask(p: Parsed, today: string, plan?: CalPlan | null) {
  if (!p.text.trim()) return;
  const j = await journalFor(today, null);
  const line = taskLine({ text: p.text, due: p.due, time: p.time, est: p.est, prio: p.prio, repeat: p.repeat, plan: plan && !p.tags.some((g) => plan.aliases.includes(g.slice(1).toLowerCase())) ? plan.title : null });
  const cur = await db.notes.get(j.id);
  await updateNote(j.id, { body: append(cur?.body ?? j.body, line) });
  toast(t("Task added to {note}", { note: j.title }));
}

/** "Today I learned": one line under a `## Today I learned` heading of today's journal. */
export async function addLearned(text: string, today: string) {
  if (!text.trim()) return;
  const j = await journalFor(today, null);
  const cur = (await db.notes.get(j.id))?.body ?? j.body;
  const H = "## Today I learned";
  let body: string;
  if (cur.includes(H)) {
    const lines = cur.split("\n");
    let at = lines.findIndex((l) => l.trim() === H) + 1;
    while (at < lines.length && !/^#{1,2}\s/.test(lines[at])) at++;
    while (at > 0 && !lines[at - 1].trim()) at--;
    lines.splice(at, 0, `- ${text.trim()}`);
    body = lines.join("\n");
  } else body = append(cur, `\n${H}\n\n- ${text.trim()}`);
  await updateNote(j.id, { body });
  toast(t("Saved to today's journal"));
}
/** Lines already saved under "Today I learned" in a journal body. */
export function learnedLines(body: string): string[] {
  const lines = body.split("\n");
  const i = lines.findIndex((l) => l.trim() === "## Today I learned");
  if (i < 0) return [];
  const out: string[] = [];
  for (let k = i + 1; k < lines.length && !/^#{1,2}\s/.test(lines[k]); k++) { const m = /^\s*[-*+]\s+(.*)$/.exec(lines[k]); if (m) out.push(m[1]); }
  return out;
}

// ------------------------------------------------------------------ task edits
export const toggleTask = (task: CalTask, today: string) => editNote(task.noteId, (b) => completeTask(b, task.line, !task.done, today));
export const setTaskLane = (task: CalTask, lane: Lane, today: string) => editNote(task.noteId, (b) => setLane(b, task.line, lane, today));
export const setTaskField = (task: CalTask, f: Parameters<typeof setField>[2], v: string | number | null) => editNote(task.noteId, (b) => setField(b, task.line, f, v));
export const renameTask = (task: CalTask, text: string) => editNote(task.noteId, (b) => setText(b, task.line, text));
export const addCheck = (task: CalTask, text: string) => editNote(task.noteId, (b) => addSubtask(b, task.line, text));
export const toggleCheck = (task: CalTask, line: number, done: boolean, today: string) => editNote(task.noteId, (b) => completeTask(b, line, done, today));

/** Move a calendar line or a task to another day / time. Plan items move their roadmap date. */
export async function moveItem(it: CalItem, date: string, start?: number | null) {
  if (it.noteId == null || it.line == null) return;
  if (it.kind === "task") {
    await editNote(it.noteId, (b) => { let x = setField(b, it.line!, "due", date); if (start != null) x = setField(x, it.line!, "time", start); return x; });
    return;
  }
  if (it.noteId === CAL_NOTE_ID) { await editNote(it.noteId, (b) => moveLine(b, it.line!, date, start)); return; }
  await editNote(it.noteId, (b) => { const ls = b.split("\n"); ls[it.line!] = ls[it.line!].replace(/(\u{1F4C5}\s*)\d{4}-\d{2}-\d{2}|((?<![\w/])due:\s*)\d{4}-\d{2}-\d{2}|(@due\()\d{4}-\d{2}-\d{2}/u, (_m, a, c, d) => `${a ?? c ?? d}${date}`); return ls.join("\n"); });
}
export const setBlockDone = (it: CalItem, done: boolean) => it.noteId === CAL_NOTE_ID && it.line != null ? editNote(CAL_NOTE_ID, (b) => { const ls = b.split("\n"); ls[it.line!] = ls[it.line!].replace(/\[( |x|X|\/)\]/, done ? "[x]" : "[ ]"); return ls.join("\n"); }) : Promise.resolve();

// ------------------------------------------------------------------ start
/**
 * Start: open what the item points at and start the focus timer for its length. Reviews open the review session;
 * tasks open their note at the line; study blocks open the lesson note with the block's title (or the plan's next
 * lesson, or the plan's space).
 */
export function startItem(it: CalItem | { kind: "reviews" }, ctx: { byTitle: Map<string, { id: string }>; plan?: CalPlan }) {
  if (it.kind === "reviews") { go("review", { spaceId: "all" }); startStudyTimer(null); return; }
  const mins = it.dur || undefined;
  if (it.kind === "task" && it.noteId && it.line != null) { void db.notes.get(it.noteId).then((n) => openNoteAtLine(it.noteId!, it.line!, n?.body)); startStudyTimer(it.noteId, mins); return; }
  const p = ctx.plan;
  const title = p?.next.find((x) => x.title === it.title)?.noteTitle ?? it.title;
  const n = ctx.byTitle.get(title.toLowerCase());
  if (n) { openNote(n.id, "read"); startStudyTimer(n.id, mins); return; }
  if (p?.spaceId) go("space", { spaceId: p.spaceId, folderId: null, noteId: null });
  startStudyTimer(null, mins);
}
export function startTask(task: CalTask) {
  void db.notes.get(task.noteId).then((n) => openNoteAtLine(task.noteId, task.line, n?.body));
  startStudyTimer(task.noteId, task.est ?? undefined);
}
/** Remove a block / event line from the Calendar note. */
export const removeCalLine = (it: CalItem) => (it.noteId === CAL_NOTE_ID && it.line != null ? removeLine(it.line) : Promise.resolve());
