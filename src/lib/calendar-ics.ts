// iCalendar (.ics, RFC 5545) export of plans and tasks (round 8, page 55). Study blocks and events → VEVENT with local
// "floating" times (a study block at 10:30 stays at 10:30 wherever the file is opened); milestones and dated plan
// items → all-day VEVENT (DTEND = next day, exclusive); tasks → VTODO with DUE, PRIORITY, STATUS and RRULE for repeats.
// Rules followed: CRLF line ends, lines folded at 75 octets without splitting a UTF-8 sequence, TEXT escaping of
// \ ; , and newlines, a stable short UID per item (re-importing updates instead of duplicating), DTSTAMP in UTC,
// METHOD:PUBLISH (Outlook needs it). Clients that ignore VTODO (Outlook) still get every dated task as an all-day event
// when `tasksAsEvents` is on.
import type { CalItem } from "./calendar";
import type { CalTask } from "./calendar-tasks";
import { hash } from "./parse";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const enc = new TextEncoder();
/** Fold one content line at 75 octets (continuation lines start with a space). */
export function fold(line: string): string {
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "", n = 0, limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (n + b > limit) { parts.push(cur); cur = ""; n = 0; limit = 74; }
    cur += ch; n += b;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}
const d8 = (iso: string) => iso.replace(/-/g, "");
const next = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const local = (iso: string, min: number) => `${d8(iso)}T${String(Math.floor(min / 60) % 24).padStart(2, "0")}${String(min % 60).padStart(2, "0")}00`;
const stamp = (t: number) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const uid = (s: string) => `${hash(s)}-${hash(s + "#")}@lumen`;
const RR: Record<string, string> = { day: "FREQ=DAILY", weekday: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", week: "FREQ=WEEKLY", "2 weeks": "FREQ=WEEKLY;INTERVAL=2", month: "FREQ=MONTHLY", year: "FREQ=YEARLY" };

export interface IcsOpts { name: string; now: number; tasksAsEvents?: boolean; planTitle?: (id: string | null | undefined) => string | null }

export function toICS(items: CalItem[], tasks: CalTask[], o: IcsOpts): string {
  const L: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lumen//Calendar 1.0//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(o.name)}`];
  const ds = `DTSTAMP:${stamp(o.now)}`;
  for (const it of items) {
    if (it.kind === "suggested" || it.kind === "task") continue;
    const cat = o.planTitle?.(it.planId);
    L.push("BEGIN:VEVENT", `UID:${uid(it.id)}`, ds);
    if (it.start != null) L.push(`DTSTART:${local(it.date, it.start)}`, `DTEND:${local(it.date, it.start + Math.max(it.dur, 15))}`);
    else L.push(`DTSTART;VALUE=DATE:${d8(it.date)}`, `DTEND;VALUE=DATE:${d8(next(it.date))}`, "TRANSP:TRANSPARENT");
    L.push(`SUMMARY:${esc((it.kind === "milestone" ? "Milestone: " : "") + it.title)}`);
    if (it.sub) L.push(`DESCRIPTION:${esc(it.sub)}`);
    if (cat) L.push(`CATEGORIES:${esc(cat)}`);
    if (it.done) L.push("STATUS:CONFIRMED");
    L.push("END:VEVENT");
  }
  for (const t of tasks) {
    const cat = o.planTitle?.(t.planId);
    L.push("BEGIN:VTODO", `UID:${uid("task:" + t.key + t.text)}`, ds, `SUMMARY:${esc(t.text)}`);
    if (t.due) L.push(t.time != null ? `DUE:${local(t.due, t.time)}` : `DUE;VALUE=DATE:${d8(t.due)}`);
    if (t.prio) L.push(`PRIORITY:${t.prio === "high" ? 1 : t.prio === "medium" ? 5 : 9}`);
    L.push(`STATUS:${t.done ? "COMPLETED" : t.status === "doing" ? "IN-PROCESS" : "NEEDS-ACTION"}`);
    if (t.done && t.doneOn) L.push(`COMPLETED:${d8(t.doneOn)}T120000Z`);
    if (t.repeat && t.due && !t.done) L.push(`RRULE:${RR[t.repeat]}`);
    if (t.est) L.push(`X-LUMEN-ESTIMATE:PT${t.est}M`);
    const desc = [`From: ${t.noteTitle}`, ...t.subtasks.map((s) => `${s.done ? "[x]" : "[ ]"} ${s.text}`)].join("\n");
    L.push(`DESCRIPTION:${esc(desc)}`);
    if (cat) L.push(`CATEGORIES:${esc(cat)}`);
    if (t.remind != null && t.due && t.time != null) L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(t.text)}`, `TRIGGER:-PT${t.remind}M`, "END:VALARM");
    L.push("END:VTODO");
    if (o.tasksAsEvents && t.due && !t.done) {
      L.push("BEGIN:VEVENT", `UID:${uid("taskev:" + t.key + t.text)}`, ds);
      if (t.time != null) L.push(`DTSTART:${local(t.due, t.time)}`, `DTEND:${local(t.due, t.time + (t.est ?? 30))}`);
      else L.push(`DTSTART;VALUE=DATE:${d8(t.due)}`, `DTEND;VALUE=DATE:${d8(next(t.due))}`, "TRANSP:TRANSPARENT");
      L.push(`SUMMARY:${esc(t.text)}`, "END:VEVENT");
    }
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

/** Save the .ics file (browser download; on Android the share sheet picks it up from the download). */
export function downloadICS(text: string, name = "lumen-calendar.ics") {
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
