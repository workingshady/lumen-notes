// The synced Calendar note (round 8, page 55): study blocks and events live as plain Markdown lines in one note with a
// fixed id, so every device shares them and the format stays open.
//   - [ ] nanoGPT lab 📅 2026-11-21 ⏰ 10:00 ~120m [plan:: Deep learning]     ← study block (checkbox = done)
//   - Team sync 📅 2026-11-20 ⏰ 14:00 ~30m                                   ← event (no checkbox)
// Writes go through createNote / updateNote (db.save → dirty → sync).
import { createNote, updateNote } from "./actions";
import { db, DEFAULT_SPACE } from "./db";
import { taskLine, taskMeta, type TaskMeta } from "./calendar-tasks";

export const CAL_NOTE_ID = "lumen-calendar";
export const CAL_NOTE_TITLE = "Calendar";
const HEAD = `# ${CAL_NOTE_TITLE}\n\nStudy blocks and events for Lumen's calendar. One line each: \`- [ ] Title 📅 YYYY-MM-DD ⏰ HH:MM ~90m [plan:: Plan]\` is a study block, a line without a checkbox is an event.\n`;

export interface CalLine extends TaskMeta { line: number; block: boolean; done: boolean }
/** Blocks and events in the Calendar note body (lines without a date are ignored). */
export function parseCalNote(body: string): CalLine[] {
  const out: CalLine[] = [];
  body.split("\n").forEach((l, line) => {
    const m = /^\s*[-*+]\s+(?:\[( |x|X|\/)\]\s+)?(.*)$/.exec(l);
    if (!m) return;
    const meta = taskMeta(m[2]);
    if (!meta.due) return;
    out.push({ ...meta, line, block: m[1] != null, done: m[1] === "x" || m[1] === "X" });
  });
  return out;
}

async function write(fn: (body: string) => string) {
  const cur = await db.notes.get(CAL_NOTE_ID);
  if (cur && !cur.deleted) { const next = fn(cur.body); if (next !== cur.body) await updateNote(CAL_NOTE_ID, { body: next }); return; }
  const body = fn(cur?.body && !cur.deleted ? cur.body : HEAD);
  if (cur) await updateNote(CAL_NOTE_ID, { body, deleted: 0 });
  else await createNote({ id: CAL_NOTE_ID, title: CAL_NOTE_TITLE, body, spaceId: DEFAULT_SPACE, type: "note" });
}

export interface NewBlock { title: string; date: string; start: number | null; dur: number; plan?: string | null; event?: boolean }
const lineOf = (b: NewBlock) => { const l = taskLine({ text: b.title, due: b.date, time: b.start, est: b.dur || null, plan: b.plan ?? null }); return b.event ? l.replace("- [ ] ", "- ") : l; };
/** Add blocks (or events) to the Calendar note in one write. */
export const addBlocks = (bs: NewBlock[]) => write((body) => body.replace(/\s*$/, "\n") + bs.map(lineOf).join("\n") + "\n");
/** Replace one line's date / time (drag in the week view, Rebalance). */
export function moveLine(body: string, line: number, date: string, start?: number | null): string {
  const lines = body.split("\n");
  let l = lines[line] ?? "";
  l = l.replace(/\u{1F4C5}\s*\d{4}-\d{2}-\d{2}/u, `\u{1F4C5} ${date}`);
  if (start != null) {
    const t = `⏰ ${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`;
    l = /⏰\s*\d{1,2}:\d{2}/u.test(l) ? l.replace(/⏰\s*\d{1,2}:\d{2}/u, t) : l.replace(/(\u{1F4C5}\s*\d{4}-\d{2}-\d{2})/u, `$1 ${t}`);
  }
  lines[line] = l;
  return lines.join("\n");
}
/** Edit any note's lines (Calendar note or a task's own note). */
export async function editNote(noteId: string, fn: (body: string) => string) {
  if (noteId === CAL_NOTE_ID) return write(fn);
  const n = await db.notes.get(noteId);
  if (!n) return;
  const next = fn(n.body);
  if (next !== n.body) await updateNote(noteId, { body: next });
}
/** Remove one block / event line from the Calendar note (the note itself is never deleted). */
export const removeLine = (line: number) => write((b) => { const ls = b.split("\n"); ls.splice(line, 1); return ls.join("\n"); });
