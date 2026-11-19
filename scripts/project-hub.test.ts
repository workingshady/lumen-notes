// Project hub + roadmap round-4 logic: task markers (emoji and text date forms), requirements traceability, Gantt rows,
// health reasons, roadmap due-date text forms and the refused-drop chain. Run: npx tsx scripts/project-hub.test.ts
import { cardSpan, docOf, ganttRows, initials, parseTaskText, projectHealth, projectTasks, requirements, setCardStatus, setDocStatus, taskLine } from "../src/lib/project";
import { needChain, roadmap, setTopicDue } from "../src/lib/parse";
import type { Note } from "../shared/types";

let failed = 0, passed = 0;
function eq<T>(a: T, b: T, msg: string) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A === B) passed++; else { failed++; console.error(`FAIL: ${msg}\n   got:      ${A}\n   expected: ${B}`); } }
const note = (id: string, body: string, extra: Partial<Note> = {}) => ({ id, title: id, body, type: "note", spaceId: "p", updatedAt: 0, createdAt: 0, ...extra }) as unknown as Note;

// ---- task markers: emoji and text forms parse the same
const a = parseTaskText("Sync conflict screen !p1 ~3d 📅 2026-11-19 ⏳ 2026-11-14 #epic/sync @sara REQ-5");
eq([a.text, a.priority, a.estimate, a.due, a.start, a.epic, a.owner, a.reqs], ["Sync conflict screen", 1, "3d", "2026-11-19", "2026-11-14", "sync", "sara", ["REQ-5"]], "emoji markers");
const b = parseTaskText("Sync conflict screen !p1 ~3d due:2026-11-19 start:2026-11-14 #epic/sync @sara REQ-5");
eq([b.text, b.due, b.start, b.owner], ["Sync conflict screen", "2026-11-19", "2026-11-14", "sara"], "text markers due:/start:");
const c = parseTaskText("Ship it @due(2026-12-01) @start(2026-11-20) @amir");
eq([c.text, c.due, c.start, c.owner], ["Ship it", "2026-12-01", "2026-11-20", "amir"], "@due()/@start() forms are not owners");
eq(parseTaskText("Kick off 🛫 2026-11-20 📅 2026-11-22").start, "2026-11-20", "🛫 start");
eq(parseTaskText("Read https://x.io/due:2026-01-01").due, null, "due: inside a URL is not a date");
eq(initials("sara"), "SA", "initials one word"); eq(initials("amir.h"), "AH", "initials two parts");
eq(taskLine("Do it !p2", "doing"), "- [/] Do it !p2", "taskLine marker");

// ---- cards, status write-back
const plan = note("plan", "# Plan\n- [>] Backlog thing\n- [ ] Todo thing ~2d due:2026-11-20 #epic/api REQ-1\n- [/] Doing thing ~1d 📅 2026-11-18 #epic/api REQ-2\n- [?] Review thing REQ-2\n- [x] Done thing REQ-3\n- [-] Dropped REQ-4\n```\n- [ ] in code\n```\n");
const prd = note("prd", "---\ndoc: prd\ndocstatus: approved\nowner: amir\napproved: 2026-11-10\n---\n# PRD\n- REQ-1 (must) A\n- REQ-2 (must) B\n- REQ-3 (should) C\n- REQ-4 (must) D\n- REQ-5 (could) E\n");
const cards = projectTasks([plan, prd]);
eq(cards.map((x) => x.status), ["backlog", "todo", "doing", "review", "done", "cancelled"], "card statuses, code fence skipped");
eq(setCardStatus(plan.body, 2, "review").split("\n")[2], "- [?] Todo thing ~2d due:2026-11-20 #epic/api REQ-1", "marker write-back keeps the line");
const reqs = requirements([plan, prd], cards);
eq(reqs.map((r) => `${r.id}:${r.state}`), ["REQ-1:planned", "REQ-2:progress", "REQ-3:met", "REQ-4:none", "REQ-5:none"], "traceability (cancelled-only = no tasks)");
const d = docOf(prd)!;
eq([d.kind, d.status, d.owner, d.approved], ["prd", "approved", "amir", "2026-11-10"], "doc header fields");
eq(/docstatus: review/.test(setDocStatus(prd.body, "review")), true, "set doc status");
eq(/approved: 2026-11-19/.test(setDocStatus(prd.body.replace("approved: 2026-11-10\n", ""), "approved", "2026-11-19")), true, "approving stamps the date");

// ---- gantt
eq(cardSpan(cards[1]), { start: "2026-11-19", end: "2026-11-20" }, "span = due − estimate");
const rows = ganttRows(cards, "2026-11-19");
eq(rows.map((r) => `${r.kind}:${r.label}`), ["epic:Epic: api", "task:Doing thing", "task:Todo thing"], "gantt rows grouped by epic, sorted by start");
eq(rows[1].late, true, "doing card past its due date is late");

// ---- health
const h = projectHealth(cards, "2026-12-30", Date.parse("2026-11-01"), reqs, Date.parse("2026-11-19T12:00:00Z"));
eq(h.reasons.some((r) => r.includes("REQ-4")), true, "must-have without tasks is a reason");
eq(h.tone === "ok", false, "not on track with an uncovered must-have");

// ---- roadmap: text due forms + refused-drop chain
const RM = "## M\n- [ ] A due:2026-12-01\n- [ ] B (needs: A) @due(2026-12-02)\n- [ ] C (needs: B) 📅 2026-12-03\n";
const mods = roadmap(RM);
eq(mods[0].topics.map((t) => [t.name, t.due]), [["A", "2026-12-01"], ["B", "2026-12-02"], ["C", "2026-12-03"]], "roadmap due forms");
eq(setTopicDue(RM, 1, "2026-12-09").split("\n")[1], "- [ ] A 📅 2026-12-09", "setTopicDue replaces a text-form date");
const all = mods[0].topics;
eq(needChain(all, all[2], all[0]), ["C", "B", "A"], "loop chain C → B → A");
eq(needChain(all, all[0], all[2]), null, "no chain the other way");

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
