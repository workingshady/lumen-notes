// Project hub logic: docs (PRD, RFC, ADR, requirements, action plans, meetings, drafts), task cards, requirements
// traceability and generated Mermaid. Everything is read from / written to plain Markdown in the project's notes.
//
// Doc:   front-matter `doc: prd|rfc|adr|requirements|plan|meeting|draft|spec`, `docstatus: draft|review|approved|superseded|rejected`, `owner: …`
// Task:  - [>] backlog · [ ] todo · [/] doing · [?] review · [x] done · [-] cancelled
//        inline: !p1 !p2 !p3 (priority) · ~3d ~4h (estimate) · 📅 2026-12-01 (due) · 🛫 2026-11-20 (start) · #epic/auth · @amir · REQ-12 · [[Doc]]
// Req:   - REQ-12 (must|should|could|wont) Text …   (in any doc; MoSCoW priority)
import type { Note } from "../../shared/types";
import { setFrontMatter, splitFrontMatter } from "./parse";

export type DocKind = "prd" | "rfc" | "adr" | "requirements" | "plan" | "meeting" | "draft" | "spec";
export type DocStatus = "draft" | "review" | "approved" | "superseded" | "rejected";
export const DOC_KINDS: { kind: DocKind; label: string; short: string; icon: string; hint: string }[] = [
  { kind: "prd", label: "PRD", short: "PRD", icon: "🎯", hint: "Product requirements: problem, users, goals, scope, metrics" },
  { kind: "rfc", label: "RFC", short: "RFC", icon: "🧩", hint: "Technical proposal: design, alternatives, rollout" },
  { kind: "adr", label: "Decision (ADR)", short: "ADR", icon: "⚖️", hint: "One decision: context, options, decision, consequences" },
  { kind: "requirements", label: "Requirements", short: "REQ", icon: "📋", hint: "Numbered requirements (REQ-1…) with MoSCoW priority" },
  { kind: "plan", label: "Action plan", short: "Plan", icon: "🗺️", hint: "Steps as task cards with owners and dates" },
  { kind: "meeting", label: "Meeting notes", short: "Meet", icon: "🗓️", hint: "Agenda, notes, decisions, action items" },
  { kind: "spec", label: "Spec / design doc", short: "Spec", icon: "📐", hint: "API, data model, diagrams" },
  { kind: "draft", label: "Draft", short: "Draft", icon: "✏️", hint: "Anything not ready yet" },
];
export const DOC_STATUSES: DocStatus[] = ["draft", "review", "approved", "superseded", "rejected"];
export const DOC_STATUS_COLOR: Record<DocStatus, string> = { draft: "var(--muted)", review: "var(--warning)", approved: "var(--success)", superseded: "var(--muted)", rejected: "var(--danger)" };

export interface ProjectDoc { note: Note; kind: DocKind; status: DocStatus; owner: string }
export function docOf(n: Note): ProjectDoc | null {
  if (n.type === "canvas" || n.type === "whiteboard") return null;
  const fm = splitFrontMatter(n.body).data;
  const kind = fm.doc as DocKind;
  if (!kind || !DOC_KINDS.some((d) => d.kind === kind)) return null;
  return { note: n, kind, status: (DOC_STATUSES as string[]).includes(fm.docstatus) ? (fm.docstatus as DocStatus) : "draft", owner: fm.owner ?? "" };
}
export const setDocStatus = (body: string, s: DocStatus) => setFrontMatter(body, { docstatus: s });

// ------------------------------------------------------------------ task cards
export type CardStatus = "backlog" | "todo" | "doing" | "review" | "done" | "cancelled";
export const CARD_COLUMNS: { s: CardStatus; label: string; mark: string; color: string }[] = [
  { s: "backlog", label: "Backlog", mark: ">", color: "var(--muted)" },
  { s: "todo", label: "To do", mark: " ", color: "var(--text)" },
  { s: "doing", label: "In progress", mark: "/", color: "var(--info)" },
  { s: "review", label: "Review", mark: "?", color: "var(--warning)" },
  { s: "done", label: "Done", mark: "x", color: "var(--success)" },
];
const MARK_STATUS: Record<string, CardStatus> = { ">": "backlog", " ": "todo", "/": "doing", "?": "review", x: "done", X: "done", "-": "cancelled" };
const STATUS_MARK: Record<CardStatus, string> = { backlog: ">", todo: " ", doing: "/", review: "?", done: "x", cancelled: "-" };
export interface TaskCard {
  key: string; note: Note; line: number; raw: string; text: string; status: CardStatus;
  priority: 1 | 2 | 3 | null; estimate: string | null; estDays: number; due: string | null; start: string | null;
  epic: string | null; owner: string | null; reqs: string[]; links: string[];
}
const TASK_RE = /^(\s*[-*+]\s+)\[([ xX/?>-])\]\s+(.*)$/;
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
      const t = m[3];
      const pr = /(?:^|\s)!p([123])\b/.exec(t);
      const est = /(?:^|\s)~(\d+(?:\.\d+)?)([hdw])\b/.exec(t);
      const due = /📅\s*(\d{4}-\d{2}-\d{2})/.exec(t);
      const start = /🛫\s*(\d{4}-\d{2}-\d{2})/.exec(t);
      const epic = /#epic\/([\p{L}\p{N}_-]+)/u.exec(t);
      const owner = /(?:^|\s)@([\p{L}\p{N}_.-]+)/u.exec(t);
      const reqs = [...t.matchAll(/\bREQ-(\d+)\b/g)].map((x) => `REQ-${x[1]}`);
      const links = [...t.matchAll(/\[\[([^\]|]+)/g)].map((x) => x[1].trim());
      const text = t.replace(/(?:^|\s)!p[123]\b|(?:^|\s)~\d+(?:\.\d+)?[hdw]\b|📅\s*\d{4}-\d{2}-\d{2}|🛫\s*\d{4}-\d{2}-\d{2}|#epic\/[\p{L}\p{N}_-]+|(?:^|\s)@[\p{L}\p{N}_.-]+|\bREQ-\d+\b/gu, " ").replace(/\s+/g, " ").trim();
      const estDays = est ? Number(est[1]) * (est[2] === "h" ? 1 / 8 : est[2] === "w" ? 5 : 1) : 0;
      out.push({ key: `${n.id}:${line}`, note: n, line, raw: l, text, status: MARK_STATUS[m[2]], priority: pr ? (Number(pr[1]) as 1 | 2 | 3) : null, estimate: est ? `${est[1]}${est[2]}` : null, estDays, due: due?.[1] ?? null, start: start?.[1] ?? null, epic: epic?.[1] ?? null, owner: owner?.[1] ?? null, reqs, links });
    });
  }
  return out;
}
export function setCardStatus(body: string, line: number, s: CardStatus) {
  const lines = body.split("\n");
  lines[line] = lines[line].replace(/\[([ xX/?>-])\]/, `[${STATUS_MARK[s]}]`);
  return lines.join("\n");
}

// ------------------------------------------------------------------ requirements + traceability
export type Moscow = "must" | "should" | "could" | "wont";
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
      const state: Requirement["state"] = !linked.length ? "none" : linked.every((t) => t.status === "done" || t.status === "cancelled") ? "met" : linked.some((t) => t.status === "doing" || t.status === "review" || t.status === "done") ? "progress" : "planned";
      out.push({ id, priority: m[2] ? (m[2].toLowerCase().replace("'", "") as Moscow) : null, text: m[3].trim(), doc: n, line, tasks: linked, state });
    });
  }
  return out.sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)));
}
export const nextReqId = (reqs: Requirement[]) => `REQ-${Math.max(0, ...reqs.map((r) => Number(r.id.slice(4)))) + 1}`;

// ------------------------------------------------------------------ generated Mermaid
const mq = (s: string) => s.replace(/["`]/g, "'").replace(/[:;#]/g, " ").slice(0, 60);
/** Gantt from cards with dates: start (🛫 or due − estimate) → due. Grouped by epic. */
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
      const days = Math.max(1, Math.round(c.estDays || 1));
      const start = c.start ?? (() => { const d = new Date(c.due + "T12:00"); d.setDate(d.getDate() - days + 1); return d.toISOString().slice(0, 10); })();
      const end = (() => { const e = new Date(c.due + "T12:00"); e.setDate(e.getDate() + 1); return e.toISOString().slice(0, 10); })(); // gantt end is exclusive
      lines.push(`    ${mq(c.text) || "Task"} :${tag}t${i++}, ${start}, ${end}`);
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
  for (const [e, cs] of epics) { const done = cs.filter((c) => c.status === "done").length; L.push(`    ${mq(e)} ${done}/${cs.length}`); cs.slice(0, 8).forEach((c) => L.push(`      ${c.status === "done" ? "✓ " : ""}${mq(c.text).slice(0, 40)}`)); }
  return L.join("\n");
}

/** Health: on track / at risk / late, from deadline, time used and work done. */
export function projectHealth(cards: TaskCard[], deadline: string | null, createdAt: number) {
  const live = cards.filter((c) => c.status !== "cancelled");
  const done = live.filter((c) => c.status === "done").length;
  const pct = live.length ? done / live.length : 0;
  const overdue = live.filter((c) => c.due && c.status !== "done" && c.due < new Date().toISOString().slice(0, 10)).length;
  if (!deadline) return { label: overdue ? "Has overdue tasks" : "No deadline", tone: overdue ? "warn" : "muted", pct, overdue } as const;
  const total = Date.parse(deadline) - createdAt, used = Date.now() - createdAt;
  const timePct = total > 0 ? Math.min(1, Math.max(0, used / total)) : 1;
  const tone = Date.now() > Date.parse(deadline) && pct < 1 ? "bad" : pct + 0.1 >= timePct && !overdue ? "ok" : pct + 0.25 >= timePct ? "warn" : "bad";
  return { label: tone === "ok" ? "On track" : tone === "warn" ? "At risk" : "Behind", tone, pct, overdue, timePct } as const;
}
