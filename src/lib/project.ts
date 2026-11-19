// Project hub logic: docs (PRD, RFC, ADR, requirements, action plans, meetings, drafts), task cards, requirements
// traceability, timeline (Gantt) rows, health and generated Mermaid. Everything is read from / written to plain
// Markdown in the project's notes.
//
// Doc:   front-matter `doc: prd|rfc|adr|requirements|plan|meeting|draft|spec`, `docstatus: draft|review|approved|superseded|rejected`,
//        `owner: …`, optional `supersededby: ADR-3` / `reason: …` / `approved: YYYY-MM-DD` (shown in the status header)
// Task:  - [>] backlog · [ ] todo · [/] doing · [?] review · [x] done · [-] cancelled
//        inline: !p1 !p2 !p3 (priority) · ~3d ~4h ~1w (estimate) · #epic/auth · @amir · REQ-12 · [[Doc]]
//        due:   (calendar emoji) 2026-12-01  |  due:2026-12-01  |  @due(2026-12-01)
//        start: (plane / hourglass emoji) 2026-11-20  |  start:2026-11-20  |  @start(2026-11-20)
// Req:   - REQ-12 (must|should|could|wont) Text …   (in any doc; MoSCoW priority)
import type { Note } from "../../shared/types";
import type { GlyphName } from "./glyphs";
import { setFrontMatter, splitFrontMatter } from "./parse";
import { t, tk } from "./i18n";

export type DocKind = "prd" | "rfc" | "adr" | "requirements" | "plan" | "meeting" | "draft" | "spec";
export type DocStatus = "draft" | "review" | "approved" | "superseded" | "rejected";
export const DOC_KINDS: { kind: DocKind; label: string; short: string; glyph: GlyphName; hint: string }[] = [
  { kind: "prd", label: "PRD", short: "PRD", glyph: "note", hint: tk("Product requirements: problem, users, goals, scope, metrics") },
  { kind: "rfc", label: "RFC", short: "RFC", glyph: "note", hint: tk("Technical proposal: design, alternatives, rollout") },
  { kind: "adr", label: "ADR", short: "ADR", glyph: "d-approved", hint: tk("One decision: context, options, decision, consequences") },
  { kind: "requirements", label: tk("Requirements"), short: "REQ", glyph: "requirement", hint: tk("Numbered requirements (REQ-1…) with MoSCoW priority") },
  { kind: "plan", label: tk("Action plan"), short: "Plan", glyph: "task", hint: tk("Steps as task cards with owners and dates") },
  { kind: "meeting", label: tk("Meeting notes"), short: "Meet", glyph: "journal", hint: tk("Agenda, notes, decisions, action items") },
  { kind: "spec", label: tk("Spec"), short: "Spec", glyph: "diagram", hint: tk("API, data model, diagrams") },
  { kind: "draft", label: tk("Draft"), short: "Draft", glyph: "d-draft", hint: tk("Anything not ready yet") },
];
export const DOC_STATUSES: DocStatus[] = ["draft", "review", "approved", "superseded", "rejected"];
export const DOC_STATUS_COLOR: Record<DocStatus, string> = { draft: "var(--muted)", review: "var(--warning)", approved: "var(--success)", superseded: "var(--muted)", rejected: "var(--danger)" };
export const DOC_STATUS_LABEL: Record<DocStatus, string> = { draft: tk("Draft"), review: tk("In review"), approved: tk("Approved"), superseded: tk("Superseded"), rejected: tk("Rejected") };
export const DOC_STATUS_GLYPH: Record<DocStatus, GlyphName> = { draft: "d-draft", review: "d-review", approved: "d-approved", superseded: "d-superseded", rejected: "d-rejected" };

export interface ProjectDoc { note: Note; kind: DocKind; status: DocStatus; owner: string; supersededBy: string; reason: string; approved: string }
export function docOf(n: Note): ProjectDoc | null {
  if (n.type === "canvas" || n.type === "whiteboard") return null;
  const fm = splitFrontMatter(n.body).data;
  const kind = fm.doc as DocKind;
  if (!kind || !DOC_KINDS.some((d) => d.kind === kind)) return null;
  return {
    note: n, kind, status: (DOC_STATUSES as string[]).includes(fm.docstatus) ? (fm.docstatus as DocStatus) : "draft", owner: fm.owner ?? "",
    supersededBy: fm.supersededby ?? fm.superseded_by ?? "", reason: fm.reason ?? "", approved: fm.approved ?? fm.decided ?? "",
  };
}
/** Set a doc's status; approving stamps `approved: YYYY-MM-DD` so the header can say "Approved 10 Nov". */
export const setDocStatus = (body: string, s: DocStatus, today = new Date().toISOString().slice(0, 10)) =>
  setFrontMatter(body, s === "approved" ? { docstatus: s, approved: today } : { docstatus: s });

// ------------------------------------------------------------------ task cards
export type CardStatus = "backlog" | "todo" | "doing" | "review" | "done" | "cancelled";
export const CARD_COLUMNS: { s: CardStatus; label: string; mark: string; color: string; glyph: GlyphName }[] = [
  { s: "backlog", label: tk("Backlog"), mark: ">", color: "var(--muted)", glyph: "t-backlog" },
  { s: "todo", label: tk("Todo"), mark: " ", color: "var(--text)", glyph: "t-todo" },
  { s: "doing", label: tk("Doing"), mark: "/", color: "var(--info)", glyph: "t-doing" },
  { s: "review", label: tk("Review"), mark: "?", color: "var(--warning)", glyph: "t-review" },
  { s: "done", label: tk("Done"), mark: "x", color: "var(--success)", glyph: "t-done" },
  { s: "cancelled", label: tk("Cancelled"), mark: "-", color: "var(--muted)", glyph: "t-cancelled" },
];
export const CARD_META = Object.fromEntries(CARD_COLUMNS.map((c) => [c.s, c])) as Record<CardStatus, (typeof CARD_COLUMNS)[number]>;
const MARK_STATUS: Record<string, CardStatus> = { ">": "backlog", " ": "todo", "/": "doing", "?": "review", x: "done", X: "done", "-": "cancelled" };
const STATUS_MARK: Record<CardStatus, string> = { backlog: ">", todo: " ", doing: "/", review: "?", done: "x", cancelled: "-" };
export interface TaskCard {
  key: string; note: Note; line: number; raw: string; text: string; status: CardStatus;
  priority: 1 | 2 | 3 | null; estimate: string | null; estDays: number; due: string | null; start: string | null;
  epic: string | null; owner: string | null; reqs: string[]; links: string[];
}
const TASK_RE = /^(\s*[-*+]\s+)\[([ xX/?>-])\]\s+(.*)$/;
const DUE_RE = /(?:\u{1F4C5}\s*|(?<![\w/])due:\s*|@due\()(\d{4}-\d{2}-\d{2})\)?/u;
const START_RE = /(?:\u{1F6EB}\s*|\u{23F3}\s*|(?<![\w/])start:\s*|@start\()(\d{4}-\d{2}-\d{2})\)?/u;
const STRIP_RE = /(?:^|\s)!p[123]\b|(?:^|\s)~\d+(?:\.\d+)?[hdw]\b|(?:\u{1F4C5}|\u{1F6EB}|\u{23F3})\s*\d{4}-\d{2}-\d{2}|(?<![\w/])(?:due|start):\s*\d{4}-\d{2}-\d{2}|@(?:due|start)\(\d{4}-\d{2}-\d{2}\)|#epic\/[\p{L}\p{N}_-]+|(?:^|\s)@(?!due\(|start\()[\p{L}\p{N}_.-]+|\bREQ-\d+\b/gu;

/** Parse one task line's text (after the checkbox) into its fields. */
export function parseTaskText(t: string) {
  const pr = /(?:^|\s)!p([123])\b/.exec(t);
  const est = /(?:^|\s)~(\d+(?:\.\d+)?)([hdw])\b/.exec(t);
  const due = DUE_RE.exec(t);
  const start = START_RE.exec(t);
  const epic = /#epic\/([\p{L}\p{N}_-]+)/u.exec(t);
  const owner = /(?:^|\s)@(?!due\(|start\()([\p{L}\p{N}_.-]+)/u.exec(t);
  const reqs = [...t.matchAll(/\bREQ-(\d+)\b/g)].map((x) => `REQ-${x[1]}`);
  const links = [...t.matchAll(/\[\[([^\]|]+)/g)].map((x) => x[1].trim());
  const text = t.replace(STRIP_RE, " ").replace(/\s+/g, " ").trim();
  const estDays = est ? Number(est[1]) * (est[2] === "h" ? 1 / 8 : est[2] === "w" ? 5 : 1) : 0;
  return { text, priority: pr ? (Number(pr[1]) as 1 | 2 | 3) : null, estimate: est ? `${est[1]}${est[2]}` : null, estDays, due: due?.[1] ?? null, start: start?.[1] ?? null, epic: epic?.[1] ?? null, owner: owner?.[1] ?? null, reqs, links };
}
export function projectTasks(notes: Note[]): TaskCard[] {
  const out: TaskCard[] = [];
  for (const n of notes) {
    if (n.type === "canvas" || n.type === "whiteboard" || n.type === "roadmap") continue;
    let fence = false;
    n.body.split("\n").forEach((l, line) => {
      if (/^\s*```/.test(l)) fence = !fence;
      if (fence) return;
      const m = TASK_RE.exec(l);
      if (!m) return;
      out.push({ key: `${n.id}:${line}`, note: n, line, raw: l, status: MARK_STATUS[m[2]], ...parseTaskText(m[3]) });
    });
  }
  return out;
}
export function setCardStatus(body: string, line: number, s: CardStatus) {
  const lines = body.split("\n");
  lines[line] = lines[line].replace(/\[([ xX/?>-])\]/, `[${STATUS_MARK[s]}]`);
  return lines.join("\n");
}
/** A new task line for a column: `- [/] text` (the text may already carry markers like !p1 ~2d #epic/x). */
export const taskLine = (text: string, s: CardStatus = "todo") => `- [${STATUS_MARK[s]}] ${text.trim()}`;
/** Two-letter avatar for an @owner ("sara" → "SA", "amir.h" → "AH"). */
export const initials = (owner: string) => {
  const parts = owner.split(/[._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : owner.slice(0, 2)).toUpperCase();
};

// ------------------------------------------------------------------ requirements + traceability
export type Moscow = "must" | "should" | "could" | "wont";
export const MOSCOW: { k: Moscow; label: string; color: string }[] = [
  { k: "must", label: tk("Must"), color: "var(--danger)" }, { k: "should", label: tk("Should"), color: "var(--warning)" },
  { k: "could", label: tk("Could"), color: "var(--info)" }, { k: "wont", label: tk("Won't"), color: "var(--muted)" },
];
export interface Requirement { id: string; priority: Moscow | null; text: string; doc: Note; line: number; tasks: TaskCard[]; state: "met" | "progress" | "planned" | "none" }
const REQ_RE = /^\s*[-*+]\s+(?:\[[ xX/?>-]\]\s+)?(REQ-\d+)\s*(?:\((must|should|could|won'?t)\))?\s*[:—-]?\s*(.+)$/i;
export function requirements(notes: Note[], tasks: TaskCard[]): Requirement[] {
  const out: Requirement[] = [];
  for (const n of notes) {
    if (n.type === "canvas" || n.type === "whiteboard") continue;
    n.body.split("\n").forEach((l, line) => {
      const m = REQ_RE.exec(l);
      if (!m) return;
      const id = m[1].toUpperCase();
      if (out.some((r) => r.id === id)) return;
      const linked = tasks.filter((t) => t.reqs.includes(id) && !(t.note.id === n.id && t.line === line));
      const live = linked.filter((t) => t.status !== "cancelled");
      const state: Requirement["state"] = !live.length ? "none" : live.every((t) => t.status === "done") ? "met" : live.some((t) => t.status === "doing" || t.status === "review" || t.status === "done") ? "progress" : "planned";
      out.push({ id, priority: m[2] ? (m[2].toLowerCase().replace("'", "") as Moscow) : null, text: m[3].trim(), doc: n, line, tasks: linked, state });
    });
  }
  return out.sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)));
}
export const nextReqId = (reqs: Requirement[]) => `REQ-${Math.max(0, ...reqs.map((r) => Number(r.id.slice(4)))) + 1}`;

// ------------------------------------------------------------------ timeline (Gantt rows)
const dayMs = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const at = (d: string) => Date.parse(d + "T00:00:00Z");
/** Start/end of a dated card: start = start date, else due − estimate (min 1 day) + 1; end = due. */
export function cardSpan(c: TaskCard): { start: string; end: string } | null {
  if (!c.due) return null;
  const days = Math.max(1, Math.round(c.estDays || 1));
  const start = c.start && c.start <= c.due ? c.start : iso(at(c.due) - (days - 1) * dayMs);
  return { start, end: c.due };
}
/** Late = due passed and not done, or start passed while still in backlog/todo. */
export const isLate = (c: TaskCard, today: string) => c.status !== "done" && c.status !== "cancelled" && ((!!c.due && c.due < today) || (!!c.start && c.start < today && (c.status === "todo" || c.status === "backlog")));
export interface GanttRow { kind: "epic" | "task"; label: string; start: string; end: string; card?: TaskCard; late?: boolean; count?: number }
/** Rows grouped by epic: one epic bar spanning its dated cards, then the cards (sorted by start). */
export function ganttRows(cards: TaskCard[], today: string): GanttRow[] {
  const dated = cards.filter((c) => c.due && c.status !== "cancelled");
  const byEpic = new Map<string, TaskCard[]>();
  for (const c of dated) byEpic.set(c.epic ?? "general", [...(byEpic.get(c.epic ?? "general") ?? []), c]);
  const rows: GanttRow[] = [];
  const epics = [...byEpic].map(([e, cs]) => ({ e, cs: cs.map((c) => ({ c, s: cardSpan(c)! })).sort((a, b) => a.s.start.localeCompare(b.s.start)) }))
    .sort((a, b) => a.cs[0].s.start.localeCompare(b.cs[0].s.start));
  for (const { e, cs } of epics) {
    rows.push({ kind: "epic", label: t("Epic: {name}", { name: e }), start: cs[0].s.start, end: cs.map((x) => x.s.end).sort().at(-1)!, count: cs.length, late: false });
    for (const { c, s } of cs) rows.push({ kind: "task", label: c.text, start: s.start, end: s.end, card: c, late: isLate(c, today) });
  }
  return rows;
}

// ------------------------------------------------------------------ generated Mermaid
const mq = (s: string) => s.replace(/["`]/g, "'").replace(/[:;#]/g, " ").slice(0, 60);
/** Gantt from cards with dates: start (start date or due − estimate) → due. Grouped by epic. */
export function ganttMermaid(cards: TaskCard[], title: string): string | null {
  const dated = cards.filter((c) => c.due && c.status !== "cancelled");
  if (!dated.length) return null;
  const byEpic = new Map<string, TaskCard[]>();
  for (const c of dated) byEpic.set(c.epic ?? "General", [...(byEpic.get(c.epic ?? "General") ?? []), c]);
  // explicit palette: readable on Lamplight and Paper (Mermaid's dark theme makes bars nearly invisible)
  const init = `%%{init: {"theme":"base","themeVariables":{"fontFamily":"Inter, sans-serif","taskBkgColor":"#7AA2F7","taskBorderColor":"#5B82D6","taskTextColor":"#0F1115","taskTextOutsideColor":"#9AA0AA","taskTextLightColor":"#0F1115","activeTaskBkgColor":"#39C5CF","activeTaskBorderColor":"#2BA3AC","doneTaskBkgColor":"#57AB5A","doneTaskBorderColor":"#3F8A43","critBkgColor":"#EF6B6B","critBorderColor":"#C42B2B","sectionBkgColor":"rgba(122,162,247,0.08)","altSectionBkgColor":"rgba(154,160,170,0.06)","sectionBkgColor2":"rgba(122,162,247,0.08)","gridColor":"#2A303B","todayLineColor":"#F2A93B","titleColor":"#9AA0AA"}}}%%`;
  const lines = [init, "gantt", `  title ${mq(title)}`, "  dateFormat YYYY-MM-DD", "  axisFormat %d %b", "  todayMarker stroke-width:2px,stroke:#F2A93B"];
  let i = 0;
  for (const [epic, cs] of byEpic) {
    lines.push(`  section ${mq(epic)}`);
    for (const c of cs.sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""))) {
      const tag = c.status === "done" ? "done, " : c.status === "doing" || c.status === "review" ? "active, " : c.priority === 1 ? "crit, " : "";
      const s = cardSpan(c)!;
      lines.push(`    ${mq(c.text) || "Task"} :${tag}t${i++}, ${s.start}, ${iso(at(s.end) + dayMs)}`); // gantt end is exclusive
    }
  }
  return lines.join("\n");
}
/** Requirement → task traceability flowchart. */
export function traceMermaid(reqs: Requirement[]): string | null {
  if (!reqs.length) return null;
  const L = ["flowchart LR"];
  const cls = { met: "met", progress: "prog", planned: "plan", none: "none" };
  reqs.slice(0, 40).forEach((r) => {
    L.push(`  ${r.id.replace("-", "_")}["${r.id} ${mq(r.text).slice(0, 34)}"]:::${cls[r.state]}`);
    r.tasks.slice(0, 6).forEach((t, k) => { const id = `T_${r.id.replace("-", "_")}_${k}`; L.push(`  ${r.id.replace("-", "_")} --> ${id}("${mq(t.text).slice(0, 30)}"):::${t.status === "done" ? "met" : t.status === "doing" || t.status === "review" ? "prog" : "plan"}`); });
  });
  L.push("  classDef met stroke:#6BCB8B,stroke-width:2px", "  classDef prog stroke:#7AA2F7,stroke-width:2px", "  classDef plan stroke:#9AA0AA", "  classDef none stroke:#EF6B6B,stroke-dasharray:4 3");
  return L.join("\n");
}
/** Epic breakdown mindmap. */
export function epicMermaid(cards: TaskCard[], title: string): string | null {
  const epics = new Map<string, TaskCard[]>();
  for (const c of cards) if (c.status !== "cancelled") epics.set(c.epic ?? "General", [...(epics.get(c.epic ?? "General") ?? []), c]);
  if (!epics.size) return null;
  const L = ["mindmap", `  root((${mq(title).slice(0, 30)}))`];
  for (const [e, cs] of epics) { const done = cs.filter((c) => c.status === "done").length; L.push(`    ${mq(e)} ${done}/${cs.length}`); cs.slice(0, 8).forEach((c) => L.push(`      ${c.status === "done" ? "(done) " : ""}${mq(c.text).slice(0, 40)}`)); }
  return L.join("\n");
}

// ------------------------------------------------------------------ health
export type HealthTone = "ok" | "warn" | "bad" | "muted";
export interface Health { label: string; tone: HealthTone; pct: number; overdue: number; timePct?: number; reasons: string[] }
/**
 * Health: On track / At risk / Behind, with the reasons the Overview explains ("Why at risk").
 * Signals: work done vs time used (deadline), must-have requirements without tasks, overdue cards, epics that started late.
 */
export function projectHealth(cards: TaskCard[], deadline: string | null, createdAt: number, reqs: Requirement[] = [], now = Date.now()): Health {
  const today = iso(now);
  const live = cards.filter((c) => c.status !== "cancelled");
  const done = live.filter((c) => c.status === "done").length;
  const pct = live.length ? done / live.length : 0;
  const overdue = live.filter((c) => c.due && c.status !== "done" && c.due < today).length;
  const reasons: string[] = [];
  const mustNone = reqs.filter((r) => r.priority === "must" && r.state === "none").map((r) => r.id);
  if (mustNone.length) reasons.push(t("{n} must-have requirement has no tasks ({ids}).|{n} must-have requirements have no tasks ({ids}).", { n: mustNone.length, ids: mustNone.join(", ") }));
  if (overdue) reasons.push(t("{n} task is past due.|{n} tasks are past due.", { n: overdue }));
  // epics with a card whose start date passed while it still waits in backlog/todo
  const epics = new Map<string, TaskCard[]>();
  for (const c of live) if (c.epic) epics.set(c.epic, [...(epics.get(c.epic) ?? []), c]);
  for (const [e, cs] of epics) {
    const late = cs.filter((c) => c.start && c.start < today && (c.status === "todo" || c.status === "backlog")).map((c) => Math.round((at(today) - at(c.start!)) / dayMs));
    if (late.length) { const d = Math.max(...late); reasons.push(t("The {name} epic started {n} day late.|The {name} epic started {n} days late.", { name: e, n: d })); }
  }
  let tone: HealthTone, timePct: number | undefined;
  if (!deadline) tone = reasons.length ? "warn" : "muted";
  else {
    const total = at(deadline) - createdAt, used = now - createdAt;
    timePct = total > 0 ? Math.min(1, Math.max(0, used / total)) : 1;
    const gap = t("{a}% of the time is used, {b}% of the work is done.", { a: Math.round(timePct * 100), b: Math.round(pct * 100) });
    if (now > at(deadline) + dayMs && pct < 1) { tone = "bad"; reasons.unshift(t("The deadline has passed.")); }
    else if (pct + 0.25 < timePct) { tone = "bad"; reasons.unshift(gap); }
    else if (pct + 0.1 < timePct) { tone = "warn"; reasons.unshift(gap); }
    else tone = mustNone.length || overdue || reasons.length ? "warn" : "ok";
  }
  const label = tone === "ok" ? t("On track") : tone === "warn" ? t("At risk") : tone === "bad" ? t("Behind") : t("No deadline");
  return { label, tone, pct, overdue, timePct, reasons };
}
