// Plans from existing data (design round 8, Lumen 53 / 54). Everything stays in open formats:
//
// 1. Course roadmap (note type `roadmap`): modules → groups, topics → items. Modules named "A1 · Grammar" make a
//    levelled course: levels A1…C2 are groups, modules are items (14 topics each), topics run on per-module tracks.
//    Front matter (optional): `pace: 4` (h / week) · `hours: 2` (per topic) · `start: 2026-11-16` ·
//    `levels: [A1=Beginner, A2=Elementary]` · `colors: [#5CC8C2, …]`. A topic line may carry `~3h`.
// 2. Plan note (a roadmap note with front matter `plan: course|project|exam|thesis|plan`):
//      ## Group                       (colours: front matter `colors: [#hex, …]`)
//      - [ ] Item ×6 ~8h #track/Labs @sara start:2026-11-02 due:2026-11-20 (needs: Other item) !p1
//      - [ ] Capstone due !milestone due:2027-03-15        (or any line under "## Milestones")
//    Markers are the project-card ones (`> / ? x -`, !p1, ~2d, @owner, start:/due:) + roadmap `(needs: …)`.
//    Front matter: `schedule: fixed|pace|deadline` · `pace` · `start` · `deadline` · `tracks: […]` · `people: [s=Sara]`
//    · `sub` · `icon` · `color` · `unit` · `groupby` · `chips: due={deadline} | clock={pace}` · `cta: today|next|yours|continue`
//    · `from: <roadmap title>` (items come from that roadmap) · `lumenplan: view=…;group=…` (Organize, Lumen-only).
// 3. Project space: task cards of its notes (lib/project.ts), grouped by epic, lanes by @owner, fixed dates; the space
//    roadmap's dated topics are milestones; Organize lives in `space.props.lumenplan`.
import type { Note, Space } from "../../shared/types";
import {
  DEFAULT_PREFS, PLAN_PALETTE, dayOf, isoOf, schedulePlan, todayDay, bucketOf, isDone, planSpan,
  type Day, type GroupKey, type ItemStatus, type Milestone, type Plan, type PlanItem, type PlanKind, type PlanMeta, type PlanPrefs, type ScheduleMode,
} from "./plan-model";
import { roadmap, setFrontMatter, setTopicDue, setTopicStatus, splitFrontMatter, type TopicStatus } from "./parse";
import { parseTaskText, projectTasks, setCardStatus, type CardStatus } from "./project";

const LEVEL_COLORS = ["#5CC8C2", "#7AA2F7", "#6BCB8B", "#E3B341", "#E8893A", "#B48EF0"];
const MODULE_GLYPH: [RegExp, string][] = [[/grammar/i, "lesson"], [/vocab/i, "language"], [/listen|speak/i, "headphones"], [/read|writ/i, "book"], [/milestone|checkpoint|exam/i, "flag"]];
export const moduleGlyph = (name: string) => MODULE_GLYPH.find(([re]) => re.test(name))?.[1] ?? "lesson";
const MILESTONE_MOD = /milestone|checkpoint/i;

/** "[a, b]" / "a, b" → ["a", "b"] (case kept). */
export const fmArr = (v: string | undefined) => (v ?? "").replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const isoDayOk = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? dayOf(v) : null);
const localDay = (ms: number) => todayDay(ms);

// ------------------------------------------------------------------ prefs (Organize) in `lumenplan`
export function parsePrefs(v: string | undefined, base: Partial<PlanPrefs> = {}): PlanPrefs {
  const p: PlanPrefs = { ...DEFAULT_PREFS, ...base, show: [...(base.show ?? DEFAULT_PREFS.show)] };
  for (const part of (v ?? "").split(";")) {
    const [k, val] = part.split("=").map((s) => s.trim());
    if (!k || val === undefined) continue;
    if (k === "view" && ["gantt", "lanes", "board", "agenda"].includes(val)) p.view = val as PlanPrefs["view"];
    else if (k === "group" && ["group", "track", "owner", "status", "tag", "source", "none"].includes(val)) p.group = val as GroupKey;
    else if (k === "colour" && ["group", "status", "owner", "tag"].includes(val)) p.colour = val as PlanPrefs["colour"];
    else if (k === "sort" && ["start", "due", "manual", "priority"].includes(val)) p.sort = val as PlanPrefs["sort"];
    else if (k === "zoom" && ["week", "month", "quarter"].includes(val)) p.zoom = val as PlanPrefs["zoom"];
    else if (k === "show") p.show = val.split(",").map((s) => s.trim()).filter(Boolean) as PlanPrefs["show"];
  }
  return p;
}
export const serializePrefs = (p: PlanPrefs) => `view=${p.view};group=${p.group};colour=${p.colour};sort=${p.sort};show=${p.show.join(",")};zoom=${p.zoom}`;

// ------------------------------------------------------------------ course roadmap → topic schedule
export interface CourseTopic { item: PlanItem; topicLine: number; status: TopicStatus; locked: boolean; needs: string[]; note: string | null; due: string | null }
export interface CourseModule { key: string; name: string; short: string; glyph: string; milestone: boolean; line: number; mi: number; topics: CourseTopic[]; start: Day; end: Day; done: number; total: number; level: number }
export interface CourseLevel { key: string; name: string; color: string; mods: CourseModule[]; start: Day; end: Day; done: number; total: number }
export interface CourseModel { levels: CourseLevel[]; levelled: boolean; plan: Plan; fm: Record<string, string> }

const TOPIC_STATUS: Record<TopicStatus, ItemStatus> = { todo: "todo", learning: "doing", done: "done", skipped: "skipped" };
/** `~3h` / `~1d` on a raw topic line → hours (1 d = 8 h, 1 w = 40 h). */
const lineHours = (raw: string, d: number) => { const m = /(?:^|\s)~(\d+(?:\.\d+)?)([hdw])\b/.exec(raw); return m ? Number(m[1]) * (m[2] === "h" ? 1 : m[2] === "d" ? 8 : 40) : d; };
const stripMarkers = (s: string) => s.replace(/(?:^|\s)~\d+(?:\.\d+)?[hdw]\b/g, "").trim();

/**
 * Schedule a course roadmap topic by topic (pace mode): one track per module kind ("Grammar" runs A1 → A2 → …),
 * a milestone / checkpoint module waits for the rest of its level, `(needs: …)` are finish-to-start.
 */
export function courseModel(note: Note, opts: { space?: Space | null; fm?: Record<string, string> } = {}): CourseModel {
  const fm = { ...splitFrontMatter(note.body).data, ...(opts.fm ?? {}) };
  const lines = note.body.split("\n");
  const mods = roadmap(note.body);
  const levelled = mods.length > 1 && mods.filter((m) => / · /.test(m.name)).length >= mods.length / 2;
  const levelNames = new Map(fmArr(fm.levels).map((x) => { const [k, v] = x.split("="); return [k.trim(), (v ?? "").trim()] as const; }));
  const colors = fmArr(fm.colors);
  const perTopic = num(fm.hours, 2);
  const pace = num(fm.pace ?? opts.space?.props.pace, 4);
  const start = isoDayOk(fm.start) ?? isoDayOk(opts.space?.props.start) ?? localDay(note.createdAt);
  const levels: CourseLevel[] = [];
  const cmods: CourseModule[] = [];
  const items: PlanItem[] = [];
  mods.forEach((m, mi) => {
    const [lv, short] = levelled && / · /.test(m.name) ? [m.name.split(" · ")[0].trim(), m.name.split(" · ").slice(1).join(" · ").trim()] : [levelled ? m.name : "", m.name];
    let L = levels.find((x) => x.key === lv);
    if (!L) { const k = levels.length; L = { key: lv, name: levelNames.get(lv) || lv, color: colors[k] || LEVEL_COLORS[k % LEVEL_COLORS.length], mods: [], start: 0, end: 0, done: 0, total: 0 }; levels.push(L); }
    const li = levels.indexOf(L);
    const cm: CourseModule = { key: `${lv}${short}`.replace(/\s+/g, ""), name: m.name, short, glyph: moduleGlyph(short), milestone: MILESTONE_MOD.test(short), line: m.line, mi, topics: [], start: 0, end: 0, done: 0, total: 0, level: li };
    for (const tp of m.topics) {
      const it: PlanItem = {
        key: `${note.id}:${tp.line}`, name: stripMarkers(tp.name), group: li, track: levelled ? short : "Course", owner: null, status: TOPIC_STATUS[tp.status],
        hours: lineHours(lines[tp.line] ?? "", perTopic), count: 1, needs: [...tp.needs], fixedStart: null, fixedEnd: tp.due ? dayOf(tp.due) : null, start: 0, end: 0,
        noteId: note.id, line: tp.line, priority: null, tags: [], link: tp.note, src: "topic", srcTitle: note.title,
      };
      cm.topics.push({ item: it, topicLine: tp.line, status: tp.status, locked: tp.locked, needs: tp.needs, note: tp.note, due: tp.due });
      items.push(it);
    }
    L.mods.push(cm); cmods.push(cm);
  });
  // a checkpoint waits for the rest of its level
  for (const L of levels) for (const cm of L.mods) if (cm.milestone) {
    const others = L.mods.filter((x) => x !== cm).flatMap((x) => x.topics.map((t) => t.item.name));
    for (const t of cm.topics) { t.item.needs = [...new Set([...t.item.needs, ...others])]; t.item.hours = Math.min(t.item.hours, 0.25); }
  }
  const plan: Plan = {
    id: note.id, kind: "course", title: note.title, sub: fm.sub ?? "", icon: fm.icon ?? "language", color: fm.color ?? opts.space?.color ?? LEVEL_COLORS[0], unit: "topics",
    groupBy: levelled ? "Level" : "Module", groups: levels.map((L) => ({ name: L.name ? `${L.key} · ${L.name}` : L.key, color: L.color, line: -1 })), items, milestones: [], tracks: [...new Set(items.map((i) => i.track))],
    owners: false, people: {}, start, pace, deadline: isoDayOk(fm.deadline ?? opts.space?.props.target), mode: fm.schedule === "fixed" ? "fixed" : fm.schedule === "deadline" && isoDayOk(fm.deadline ?? opts.space?.props.target) != null ? "deadline" : "pace", meta: [], prefs: parsePrefs(fm.lumenplan), home: { kind: "note", id: note.id }, next: null,
  };
  if (levelled && plan.mode !== "fixed") {
    // levels run one after another (A1 then A2 …); inside a level the module tracks run side by side
    const its = (L: CourseLevel) => L.mods.flatMap((m) => m.topics.map((t) => t.item));
    if (plan.mode === "deadline" && plan.deadline != null) {
      let cur = plan.deadline;
      for (const L of [...levels].reverse()) { const sub = { ...plan, items: its(L), deadline: cur }; schedulePlan(sub); cur = Math.min(cur, ...sub.items.map((i) => i.start)); }
      plan.start = Math.min(plan.start, cur);
    } else {
      let cur = start;
      for (const L of levels) { const sub = { ...plan, items: its(L), start: cur }; schedulePlan(sub); cur = Math.max(cur, ...sub.items.map((i) => i.end + 1)); }
    }
  } else schedulePlan(plan);
  for (const L of levels) {
    for (const cm of L.mods) {
      const ts = cm.topics.map((t) => t.item);
      cm.start = ts.length ? Math.min(...ts.map((t) => t.start)) : start; cm.end = ts.length ? Math.max(...ts.map((t) => t.end)) : start;
      cm.total = ts.filter((t) => t.status !== "skipped").length; cm.done = ts.filter((t) => t.status === "done").length;
    }
    L.start = Math.min(...L.mods.map((m) => m.start)); L.end = Math.max(...L.mods.map((m) => m.end));
    L.total = L.mods.reduce((a, m) => a + m.total, 0); L.done = L.mods.reduce((a, m) => a + m.done, 0);
  }
  plan.next = items.find((i) => i.status === "doing") ?? items.find((i, k) => i.status === "todo" && !cmods.flatMap((m) => m.topics)[k]?.locked) ?? null;
  return { levels, levelled, plan, fm };
}

/** Course roadmap as a plan: levels → groups, modules → items (levelled course), or modules → groups, topics → items. */
export function planFromRoadmap(note: Note, opts: { space?: Space | null; fm?: Record<string, string>; host?: Note } = {}): Plan {
  const cm = courseModel(note, { space: opts.space, fm: opts.fm });
  const fm = { ...cm.fm, ...(opts.fm ?? {}) };
  const base = cm.plan;
  let plan: Plan;
  if (cm.levelled) {
    const items: PlanItem[] = [], milestones: Milestone[] = [];
    cm.levels.forEach((L, li) => L.mods.forEach((m) => {
      if (m.milestone) { milestones.push({ name: m.topics[0]?.item.name ?? `${L.key} checkpoint`, day: m.start, line: m.line, noteId: note.id, done: m.done === m.total && m.total > 0 }); return; }
      const ts = m.topics.map((t) => t.item);
      const status: ItemStatus = m.total && m.done === m.total ? "done" : ts.some((t) => t.status === "doing" || t.status === "done") ? "doing" : "todo";
      items.push({ key: `${note.id}:m${m.mi}`, name: m.short, group: li, track: m.short, owner: null, status, hours: ts.reduce((a, t) => a + t.hours, 0), count: m.total, doneCount: m.done,
        needs: [], fixedStart: m.start, fixedEnd: m.end, start: m.start, end: m.end, noteId: note.id, line: m.line, priority: null, tags: [], link: null, src: "module", srcTitle: note.title });
    }));
    plan = { ...base, items, milestones, tracks: [...new Set(items.map((i) => i.track))] };
  } else {
    plan = { ...base, groupBy: "Module", groups: cm.levels.flatMap((L) => L.mods).map((m, k) => ({ name: m.name, color: PLAN_PALETTE[k % PLAN_PALETTE.length], line: m.line })) };
    const gi = new Map(cm.levels.flatMap((L) => L.mods).flatMap((m, k) => m.topics.map((t) => [t.item.key, k] as const)));
    plan.items = base.items.map((i) => ({ ...i, group: gi.get(i.key) ?? 0 }));
  }
  const host = opts.host ?? note;
  const p0 = planSpan(plan);
  return finishPlan({ ...plan, id: host.id, title: opts.host ? host.title : plan.title, home: { kind: "note", id: host.id }, prefs: parsePrefs(fm.lumenplan),
    kind: (fm.plan as PlanKind) || "course", sub: fm.sub ?? plan.sub, icon: fm.icon ?? plan.icon, color: fm.color ?? plan.color, unit: fm.unit ?? "topics",
    groupBy: fm.groupby ?? plan.groupBy, deadline: isoDayOk(fm.deadline) ?? plan.deadline ?? p0.hi }, fm, cm.plan.next);
}

// ------------------------------------------------------------------ plan note
const TASK_RE = /^(\s*[-*+]\s+)\[([ xX/?>-])\]\s+(.*)$/;
const MARK: Record<string, ItemStatus> = { ">": "backlog", " ": "todo", "/": "doing", "?": "review", x: "done", X: "done", "-": "skipped" };
/** A plan note (front matter `plan:`): headings → groups, task lines → items, `!milestone` / "## Milestones" → milestones. */
export function planFromNote(note: Note, ctx: { notes?: Note[]; spaces?: Space[] } = {}): Plan {
  const { data: fm } = splitFrontMatter(note.body);
  if (fm.from) {
    const src = ctx.notes?.find((n) => n.title.toLowerCase() === fm.from.replace(/^\[\[|\]\]$/g, "").toLowerCase() && n.type === "roadmap");
    if (src) return planFromRoadmap(src, { fm, host: note, space: ctx.spaces?.find((s) => s.id === src.spaceId) });
  }
  const colors = fmArr(fm.colors);
  const groups: Plan["groups"] = [], items: PlanItem[] = [], milestones: Milestone[] = [];
  const defHours = num(fm.hours, 4);
  let inMs = false;
  note.body.split("\n").forEach((l, line) => {
    const h = /^(#{2,3})\s+(.+)$/.exec(l);
    if (h) { inMs = /^milestones?$/i.test(h[2].trim()); if (!inMs) groups.push({ name: h[2].trim(), color: colors[groups.length] || PLAN_PALETTE[groups.length % PLAN_PALETTE.length], line }); return; }
    const m = TASK_RE.exec(l);
    if (!m) return;
    let rest = m[3];
    const needs = /\(needs:\s*([^)]+)\)/i.exec(rest);
    const count = /(?:^|\s)×(\d+)\b/.exec(rest);
    const track = /#track\/([\p{L}\p{N}_&.-]+)/u.exec(rest);
    const ms = /(?:^|\s)!milestone\b/.test(rest);
    const tags = [...rest.matchAll(/(?:^|\s)#(?!track\/|epic\/)([\p{L}\p{N}_/-]+)/gu)].map((x) => x[1]);
    rest = rest.replace(/\s*\(needs:[^)]*\)/i, "").replace(/(?:^|\s)×\d+\b/, "").replace(/#track\/[\p{L}\p{N}_&.-]+/u, "").replace(/(?:^|\s)!milestone\b/, "").replace(/(?:^|\s)#(?!epic\/)[\p{L}\p{N}_/-]+/gu, "");
    const f = parseTaskText(rest);
    const status = MARK[m[2]];
    if (ms || inMs) { milestones.push({ name: f.text, day: f.due ? dayOf(f.due) : NaN, line, noteId: note.id, done: status === "done" }); return; }
    if (!groups.length) groups.push({ name: note.title, color: colors[0] || PLAN_PALETTE[0], line: -1 });
    items.push({
      key: `${note.id}:${line}`, name: f.text, group: groups.length - 1, track: track?.[1].replace(/_/g, " ") ?? f.owner ?? (f.epic ?? "Work"), owner: f.owner, status,
      hours: f.estDays ? f.estDays * 8 : defHours, count: count ? Number(count[1]) : 1, needs: needs ? needs[1].split(",").map((s) => s.trim()).filter(Boolean) : [],
      fixedStart: f.start ? dayOf(f.start) : null, fixedEnd: f.due ? dayOf(f.due) : null, start: 0, end: 0, noteId: note.id, line, priority: f.priority, tags, link: f.links[0] ?? null, src: "plan", srcTitle: note.title,
    });
  });
  const people = Object.fromEntries(fmArr(fm.people).map((x) => { const [k, v] = x.split("="); return [k.trim(), (v ?? k).trim()]; }));
  for (const i of items) if (i.owner && !people[i.owner]) people[i.owner] = i.owner[0].toUpperCase() + i.owner.slice(1);
  const owners = items.some((i) => i.owner);
  const tracks = fmArr(fm.tracks);
  for (const i of items) {
    if (owners && i.owner) i.track = i.owner;
    else if (/^\d+$/.test(i.track) && tracks[Number(i.track)]) i.track = tracks[Number(i.track)];
  }
  const trackOrder = owners ? Object.keys(people) : [...tracks, ...items.map((i) => i.track).filter((t) => !tracks.includes(t))];
  const kind = (["course", "project", "exam", "thesis"].includes(fm.plan) ? fm.plan : "plan") as PlanKind;
  const mode = (["fixed", "pace", "deadline"].includes(fm.schedule) ? fm.schedule : kind === "course" && !items.some((i) => i.fixedStart != null) ? "pace" : "fixed") as ScheduleMode;
  const plan: Plan = {
    id: note.id, kind, title: note.title, sub: fm.sub ?? "", icon: fm.icon ?? KIND_ICON[kind], color: fm.color ?? PLAN_PALETTE[0], unit: fm.unit ?? (kind === "exam" ? "sessions" : "tasks"),
    groupBy: fm.groupby ?? "Group", groups, items, milestones, tracks: [...new Set(trackOrder)], owners, people,
    start: isoDayOk(fm.start) ?? localDay(note.createdAt), pace: num(fm.pace, 6), deadline: isoDayOk(fm.deadline), mode,
    meta: [], prefs: parsePrefs(fm.lumenplan), home: { kind: "note", id: note.id }, next: null,
  };
  schedulePlan(plan);
  return finishPlan(plan, fm, null);
}
const KIND_ICON: Record<PlanKind, string> = { course: "course", project: "project", exam: "c-tip", thesis: "book", plan: "timeline" };

// ------------------------------------------------------------------ project space
/** A project space's task cards as a plan: epics → groups, @owners → lanes, fixed dates; roadmap topics with dates → milestones. */
export function planFromProject(space: Space, notes: Note[], prefsRaw = space.props.lumenplan): Plan {
  const mine = notes.filter((n) => n.spaceId === space.id && !n.deleted);
  const cards = projectTasks(mine).filter((c) => c.status !== "cancelled");
  const groupNames: string[] = [];
  const keyOf = (c: (typeof cards)[number]) => c.epic ?? c.note.title;
  for (const c of [...cards].sort((a, b) => (a.start ?? a.due ?? "9").localeCompare(b.start ?? b.due ?? "9"))) if (!groupNames.includes(keyOf(c))) groupNames.push(keyOf(c));
  const people: Record<string, string> = {};
  for (const c of cards) if (c.owner && !people[c.owner]) people[c.owner] = c.owner[0].toUpperCase() + c.owner.slice(1);
  const owners = Object.keys(people).length > 0;
  const items: PlanItem[] = cards.map((c) => ({
    key: c.key, name: c.text, group: groupNames.indexOf(keyOf(c)), track: c.owner ?? (owners ? "" : keyOf(c)), owner: c.owner, status: c.status as ItemStatus,
    hours: Math.max(1, (c.estDays || 1) * 8), count: 1, needs: [], fixedStart: c.start ? dayOf(c.start) : null, fixedEnd: c.due ? dayOf(c.due) : null, start: 0, end: 0,
    noteId: c.note.id, line: c.line, priority: c.priority, tags: c.epic ? [c.epic] : [], link: c.links[0] ?? null, src: "card", srcTitle: c.note.title,
  }));
  const rm = mine.find((n) => n.id === space.roadmapId);
  const milestones: Milestone[] = rm ? roadmap(rm.body).flatMap((m) => m.topics).filter((t) => t.due).map((t) => ({ name: t.name, day: dayOf(t.due!), line: t.line, noteId: rm.id, done: t.status === "done" })) : [];
  const start = isoDayOk(space.props.start) ?? localDay(space.createdAt);
  const plan: Plan = {
    id: `space:${space.id}`, kind: "project", title: space.name, sub: space.description, icon: "project", color: space.color ?? "#F2A93B", unit: "tasks",
    groupBy: "Epic", groups: groupNames.map((g, k) => ({ name: g, color: PLAN_PALETTE[k % PLAN_PALETTE.length], line: -1 })), items, milestones,
    tracks: owners ? Object.keys(people) : groupNames, owners, people, start, pace: num(space.props.pace, 40), deadline: isoDayOk(space.props.deadline), mode: "fixed",
    meta: [], prefs: parsePrefs(prefsRaw), home: { kind: "space", id: space.id }, next: null,
  };
  schedulePlan(plan);
  return finishPlan(plan, { chips: "team={team} | due={deadline} | c-warning={risk}", cta: "yours" }, null);
}

// ------------------------------------------------------------------ header chips + Continue
const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const fmtD = (d: Day) => { const D = new Date(d * 86400000); return `${D.getUTCDate()} ${MN[D.getUTCMonth()]}`; };
export const fmtDow = (d: Day) => { const D = new Date(d * 86400000); return `${DOW[D.getUTCDay()]} ${D.getUTCDate()} ${MN[D.getUTCMonth()]}`; };
function finishPlan(plan: Plan, fm: Record<string, string>, next: PlanItem | null): Plan {
  const today = todayDay();
  const deadlineLabel = fm.deadlinelabel ?? (plan.kind === "exam" ? "Exam" : plan.kind === "thesis" ? "Submit" : plan.kind === "project" ? "Launch" : "Due");
  const risk = plan.items.filter((i) => bucketOf(i, today) === "overdue").length;
  const chips = fm.chips ?? (plan.deadline != null ? "due={deadline} | clock={pace}" : "clock={pace}");
  const meta: PlanMeta[] = [];
  for (const part of chips.split("|").map((s) => s.trim()).filter(Boolean)) {
    const [g, ...rest] = part.split("="); let label = rest.join("=").trim();
    if (label.includes("{deadline}")) { if (plan.deadline == null) continue; label = label.replace("{deadline}", plan.kind === "exam" ? `${deadlineLabel} ${fmtDow(plan.deadline)} · ${Math.max(0, plan.deadline - today)} days` : `${deadlineLabel} ${fmtD(plan.deadline)}`); }
    if (label.includes("{pace}")) label = label.replace("{pace}", `${plan.pace} h / week`);
    if (label.includes("{team}")) { if (!plan.owners) continue; label = label.replace("{team}", Object.values(plan.people).join(" · ")); }
    if (label.includes("{risk}")) { if (!risk) continue; label = label.replace("{risk}", `${risk} at risk`); }
    meta.push({ glyph: g.trim(), label, warn: g.trim() === "c-warning" });
  }
  const live = plan.items.filter((i) => !isDone(i)).sort((a, b) => a.start - b.start);
  plan.next = next ?? live.find((i) => bucketOf(i, today) === "overdue") ?? live.find((i) => i.status === "doing") ?? live[0] ?? null;
  (plan as Plan & { cta?: string }).cta = fm.cta ?? (plan.kind === "course" ? "continue" : plan.kind === "exam" ? "today" : plan.kind === "project" ? "yours" : "next");
  plan.meta = meta;
  return plan;
}
export const planCta = (p: Plan) => (p as Plan & { cta?: string }).cta ?? "next";

// ------------------------------------------------------------------ all plans (for page 55 and pickers)
/** Is this note a plan note (roadmap with `plan:` front matter)? */
export const isPlanNote = (n: Note) => n.type === "roadmap" && /^---[\s\S]*?\nplan:\s*\S/m.test(n.body.slice(0, 600));
/**
 * Every plan in the vault: plan notes, course roadmaps of course spaces, project spaces with task cards.
 * Page 55 (Today / Calendar / Tasks) uses this with itemsOnDay / itemsInRange / milestonesInRange / overdueItems.
 */
export function allPlans(notes: Note[], spaces: Space[]): Plan[] {
  const out: Plan[] = [];
  // A plan note wins over what it describes: its `from:` roadmap and the space it lives in are not listed again.
  const covered = new Set<string>(), coveredSpaces = new Set<string>();
  for (const n of notes) if (!n.deleted && isPlanNote(n)) {
    const from = splitFrontMatter(n.body).data.from?.replace(/^[[|]]$/g, "").toLowerCase();
    if (from) for (const r of notes) if (r.type === "roadmap" && !r.deleted && r.title.toLowerCase() === from) { covered.add(r.id); coveredSpaces.add(r.spaceId); }
    coveredSpaces.add(n.spaceId);
  }
  for (const n of notes) if (!n.deleted && isPlanNote(n)) { try { out.push(planFromNote(n, { notes, spaces })); } catch { /* a broken plan never breaks the list */ } }
  for (const s of spaces) {
    if (s.deleted || s.archived) continue;
    if (s.kind === "course" && s.roadmapId && !coveredSpaces.has(s.id) && !covered.has(s.roadmapId)) { const rm = notes.find((n) => n.id === s.roadmapId && !n.deleted); if (rm && !isPlanNote(rm)) out.push(planFromRoadmap(rm, { space: s })); }
    if (s.kind === "project" && !coveredSpaces.has(s.id) && notes.some((n) => n.spaceId === s.id && /\[[ /?>]\]/.test(n.body))) out.push(planFromProject(s, notes));
  }
  return out;
}

// ------------------------------------------------------------------ writes (pure body edits; callers save with updateNote)
const TOPIC_OF: Partial<Record<ItemStatus, TopicStatus>> = { todo: "todo", backlog: "todo", doing: "learning", review: "learning", done: "done", skipped: "skipped" };
/** New body after setting an item's status (roadmap topic marks or task-card marks). */
export function bodyWithStatus(body: string, item: PlanItem, s: ItemStatus): string {
  if (item.src === "module") return body;
  if (item.src === "topic") return setTopicStatus(body, item.line, TOPIC_OF[s] ?? "todo");
  return setCardStatus(body, item.line, (s === "skipped" ? "cancelled" : s) as CardStatus);
}
const setToken = (l: string, key: "start" | "due", iso: string | null) => {
  const re = key === "due" ? /\s*(?:\u{1F4C5}\s*|(?<![\w/])due:\s*|@due\()\d{4}-\d{2}-\d{2}\)?/u : /\s*(?:\u{1F6EB}\s*|\u{23F3}\s*|(?<![\w/])start:\s*|@start\()\d{4}-\d{2}-\d{2}\)?/u;
  const cleaned = l.replace(re, "");
  return iso ? `${cleaned.trimEnd()} ${key}:${iso}` : cleaned;
};
/** New body after giving an item fixed dates (start / due tokens on its line; roadmap topics take a due date only). */
export function bodyWithDates(body: string, item: PlanItem, start: Day | null, end: Day | null): string {
  if (item.src === "module") return body;
  if (item.src === "topic") return setTopicDue(body, item.line, end != null ? isoOf(end) : null);
  const lines = body.split("\n");
  let l = lines[item.line] ?? "";
  if (start !== undefined) l = setToken(l, "start", start != null ? isoOf(start) : null);
  if (end !== undefined) l = setToken(l, "due", end != null ? isoOf(end) : null);
  lines[item.line] = l;
  return lines.join("\n");
}
/** New body with plan settings in the front matter (schedule / pace / deadline / start / lumenplan). */
export const bodyWithPlanFm = (body: string, keys: Record<string, string | null | undefined>) => setFrontMatter(body, keys);
