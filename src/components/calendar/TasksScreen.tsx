// Tasks from everywhere (round 8, page 55 I–K; PlanDesk.dc.html screen "tasks", converted 1:1): Inbox, Today,
// Upcoming, Overdue, Completed, by plan and smart lists; list grouped by due (or plan / note) or a board
// (To do · Doing · Waiting · Done, drag between columns); the detail panel edits due, plan, priority, estimate, repeat,
// reminder and the checklist. Every task stays a Markdown checkbox in the note it came from.
// Keys: J/K or arrows select, X toggles, Enter opens the line, N focuses quick add.
import { useEffect, useMemo, useState } from "react";
import { Glyph } from "../Glyph";
import type { GlyphName } from "../../lib/glyphs";
import { Sheet } from "../ui";
import { shiftDay, weekday } from "../../lib/calendar";
import { dueGroup, DUE_GROUPS, inList, laneOf, plainText, sortTasks, topTag, type CalTask, type Lane, type ListId, type SortBy } from "../../lib/calendar-tasks";
import type { CalPlan } from "../../lib/calendar-plans";
import { db } from "../../lib/db";
import { usePhone } from "../../views/spaces-util";
import { openNoteAtLine } from "../study-nav";
import { addCheck, addTask, renameTask, setTaskField, setTaskLane, startTask, toggleCheck, toggleTask } from "./actions";
import { QuickAdd } from "./QuickAdd";
import { AC_TINT, dayMon, DeskHeader, dueText, HBtn, hhmm, MItem, MLabel, Pop, Seg, TaskRow, V } from "./parts";
import { useCalendar } from "./use-calendar";
import { fmtNum, t } from "../../lib/i18n";

type Group = "due" | "plan" | "note" | "none";
const PREF = "lumen.tasks.view";
const load = () => { try { return JSON.parse(localStorage.getItem(PREF) ?? "{}") as { view?: "list" | "board"; group?: Group; sort?: SortBy; list?: ListId }; } catch { return {}; } };

export function TasksScreen() {
  const phone = usePhone();
  const cal = useCalendar();
  const { today, tasks, plans } = cal;
  const [pref, setPref] = useState(load);
  const upd = (p: Partial<ReturnType<typeof load>>) => setPref((o) => { const n = { ...o, ...p }; try { localStorage.setItem(PREF, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const view = pref.view ?? "list", group = pref.group ?? "due", sort = pref.sort ?? "due";
  const list: ListId = pref.list ?? "today";
  const [sel, setSel] = useState<string | null>(() => { try { const k = sessionStorage.getItem("lumen.task"); sessionStorage.removeItem("lumen.task"); return k; } catch { return null; } });
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ k: "group" | "sort"; el: HTMLElement } | null>(null);
  const [sheet, setSheet] = useState(false);

  const tag = topTag(tasks);
  const count = (id: ListId) => tasks.filter((x) => inList(x, id, today)).length;
  type F = { id?: ListId; g?: GlyphName; l: string; head?: boolean; dot?: string; danger?: boolean };
  const filters: F[] = [
    { id: "inbox", g: "inbox", l: t("Inbox") }, { id: "today", g: "today", l: t("Today") }, { id: "upcoming", g: "calendar", l: t("Upcoming") },
    { id: "overdue", g: "c-warning", l: t("Overdue"), danger: true }, { id: "completed", g: "check", l: t("Completed") },
    ...(plans.length ? [{ l: t("PLANS"), head: true }, ...plans.map((p) => ({ id: `plan:${p.id}` as ListId, l: p.title, dot: p.color }))] : []),
    { l: t("SMART LISTS"), head: true },
    { id: "week", g: "calendar", l: t("This week") }, { id: "nodate", g: "date", l: t("No date") }, { id: "waiting", g: "clock", l: t("Waiting") },
    { id: "high", g: "star", l: t("High priority") }, ...(tag ? [{ id: `tag:${tag}` as ListId, g: "tag" as GlyphName, l: tag }] : []), { id: "notes", g: "note", l: t("From notes") },
  ];
  const filterLabel = filters.find((f) => f.id === list)?.l ?? t("Tasks");

  const shown = useMemo(() => sortTasks(tasks.filter((x) => inList(x, list, today)), sort), [tasks, list, today, sort]);
  const groups = useMemo(() => {
    if (group === "none") return [{ k: "all", l: filterLabel, c: V.tx, items: shown }];
    if (group === "due") return DUE_GROUPS.map((g) => ({ k: g, l: t(g), c: g === "Overdue" ? V.da : g === "Today" ? V.ac : V.tx, items: shown.filter((x) => dueGroup(x, today) === g) })).filter((g) => g.items.length);
    const key = (x: CalTask) => (group === "plan" ? x.planId ?? "" : x.noteId);
    const m = new Map<string, CalTask[]>();
    for (const x of shown) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
    return [...m.entries()].map(([k, items]) => ({ k, l: group === "plan" ? cal.planOf(k)?.title ?? t("No plan") : items[0].noteTitle, c: group === "plan" ? cal.planOf(k)?.color ?? V.tx : V.tx, items }));
  }, [group, shown, today, cal, filterLabel]);
  const flat = groups.flatMap((g) => (folded.has(g.k) ? [] : g.items));
  const selTask = tasks.find((x) => x.key === sel) ?? null;
  useEffect(() => { if (!phone && view === "list" && !selTask && flat.length) setSel(flat[0].key); }, [phone, view, selTask, flat]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select,[contenteditable=true],.cm-editor") || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const i = flat.findIndex((x) => x.key === sel);
      if (key === "n") { e.preventDefault(); document.querySelector<HTMLInputElement>("#lumen-add-task")?.focus(); }
      else if (key === "j" || key === "arrowdown" || key === "k" || key === "arrowup") { e.preventDefault(); const d = key === "j" || key === "arrowdown" ? 1 : -1; const nx = flat[Math.max(0, Math.min(flat.length - 1, i < 0 ? 0 : i + d))]; if (nx) setSel(nx.key); }
      else if (key === "x" && selTask) { e.preventDefault(); void toggleTask(selTask, today); }
      else if (key === "enter" && selTask) { e.preventDefault(); void db.notes.get(selTask.noteId).then((n) => openNoteAtLine(selTask.noteId, selTask.line, n?.body)); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  const overdue = count("overdue"), todayN = count("today");
  const sub = phone ? t("{a} overdue · {b} today", { a: overdue, b: todayN }) : t("Tasks from notes, plans and your inbox. They stay as Markdown in the note they came from.");
  const pick = (x: CalTask) => { setSel(x.key); if (phone || view === "board") setSheet(true); };
  const groupLabel = { due: t("Due"), plan: t("Plan"), note: t("Note"), none: t("None") }[group];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", fontSize: 13, color: V.tx, background: V.bg }}>
      <DeskHeader phone={phone} title={t("Tasks")} sub={sub}>
        <Seg options={[{ v: "list", l: t("List") }, { v: "board", l: t("Board") }]} value={view} onChange={(v) => upd({ view: v })} />
        {!phone && <HBtn glyph="filter" label={t("Group: {g}", { g: groupLabel })} onClick={(e) => setMenu({ k: "group", el: e.currentTarget })} />}
        {!phone && <HBtn glyph="sort" label={t("Sort")} onClick={(e) => setMenu({ k: "sort", el: e.currentTarget })} />}
      </DeskHeader>
      {phone && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "0 16px 10px", flexShrink: 0 }}>
          {filters.filter((f) => f.id).map((f) => <button key={f.id} onClick={() => upd({ list: f.id })} style={{ height: 30, padding: "0 12px", borderRadius: 999, border: `1px solid ${list === f.id ? V.ac : V.bd}`, background: list === f.id ? AC_TINT : "transparent", whiteSpace: "nowrap", fontSize: 12.5, color: f.danger && count(f.id!) ? V.da : V.tx }}>{f.l} <span style={{ color: V.mu }}>{fmtNum(count(f.id!))}</span></button>)}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 18, padding: phone ? "0 16px" : "0 28px 24px" }}>
        {!phone && (
          <nav aria-label={t("Task lists")} style={{ width: 210, flexShrink: 0, display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
            {filters.map((f, i) => {
              if (f.head) return <span key={i} style={{ display: "flex", alignItems: "center", minHeight: 34, padding: "0 10px", marginTop: 12, fontSize: 13, fontWeight: 650, color: V.mu }}>{f.l}</span>;
              const on = f.id === list;
              const n = count(f.id!);
              return (
                <button key={f.id} onClick={() => upd({ list: f.id })} aria-current={on} className={on ? undefined : "hover:bg-surface"} style={{ display: "flex", alignItems: "center", gap: 9, minHeight: 34, padding: "0 10px", borderRadius: 8, background: on ? AC_TINT : "transparent", color: V.tx, fontSize: 13, fontWeight: on ? 600 : 400, textAlign: "start" }}>
                  {f.g && <Glyph name={f.g} size={15} color={f.danger ? V.da : "currentColor"} />}
                  {f.dot && <span style={{ width: 8, height: 8, borderRadius: 2, background: f.dot }} />}
                  <span dir="auto" style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.l}</span>
                  <span style={{ fontSize: 11.5, color: f.danger ? V.da : V.mu }}>{f.id === "completed" || !n ? "" : fmtNum(n)}</span>
                </button>
              );
            })}
          </nav>
        )}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <QuickAdd inline phone={phone} today={today} plans={plans} defaultDue={list === "today" ? today : null}
            onAdd={async (p, plan) => { const pl = plan ?? (list.startsWith("plan:") ? cal.planOf(list.slice(5)) ?? null : null); await addTask(p, today, pl); }} />
          {view === "list" ? (
            <div style={{ display: "flex", flexDirection: "column", overflowY: "auto", minHeight: 0, paddingBottom: 16 }}>
              {groups.map((gp) => (
                <div key={gp.k} style={{ display: "flex", flexDirection: "column", paddingTop: 10 }}>
                  <button onClick={() => setFolded((f) => { const n = new Set(f); if (n.has(gp.k)) n.delete(gp.k); else n.add(gp.k); return n; })} aria-expanded={!folded.has(gp.k)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 2px", fontSize: 12.5, fontWeight: 650, color: gp.c, textAlign: "start" }}>
                    <Glyph name="chevron-down" size={13} style={{ transform: folded.has(gp.k) ? "rotate(-90deg)" : "none", transition: "transform .15s" }} />
                    <span dir="auto">{gp.l}</span><span style={{ fontWeight: 400, color: V.mu }}>{fmtNum(gp.items.length)}</span>
                  </button>
                  {!folded.has(gp.k) && gp.items.map((x) => <TaskRow key={x.key} task={x} today={today} phone={phone} long sel={!phone && x.key === sel} onToggle={() => void toggleTask(x, today)} onSelect={() => pick(x)} />)}
                </div>
              ))}
              {!groups.length && <div style={{ padding: "32px 8px", color: V.mu, fontSize: 13 }}>{tasks.length ? t("Nothing in {list}.", { list: filterLabel }) : t("No tasks yet. Write - [ ] in any note, or add one above.")}</div>}
            </div>
          ) : (
            <Board tasks={tasks.filter((x) => inList(x, list === "completed" ? "completed" : list, today) || (x.done && (list !== "completed") && (!list.startsWith("plan:") || x.planId === list.slice(5)) && (x.doneOn ?? "") >= shiftDay(today, -7)))} today={today} plans={plans} onPick={pick} />
          )}
        </div>
        {!phone && view === "list" && selTask && <div style={{ width: 364, flexShrink: 0, alignSelf: "flex-start", maxHeight: "100%", overflowY: "auto" }}><Detail task={selTask} today={today} plans={plans} /></div>}
      </div>
      {menu && (
        <Pop anchor={menu.el} onClose={() => setMenu(null)} width={200}>
          {menu.k === "group" ? <>
            <MLabel>{t("Group by")}</MLabel>
            {(["due", "plan", "note", "none"] as Group[]).map((g) => <MItem key={g} on={group === g} onClick={() => { upd({ group: g }); setMenu(null); }}>{{ due: t("Due"), plan: t("Plan"), note: t("Note"), none: t("None") }[g]}</MItem>)}
          </> : <>
            <MLabel>{t("Sort by")}</MLabel>
            {(["due", "priority", "title"] as SortBy[]).map((s) => <MItem key={s} on={sort === s} onClick={() => { upd({ sort: s }); setMenu(null); }}>{{ due: t("Due date"), priority: t("Priority"), title: t("Title") }[s]}</MItem>)}
          </>}
        </Pop>
      )}
      <Sheet open={sheet && !!selTask} onClose={() => setSheet(false)} title={t("Task")}>
        {selTask && <Detail task={selTask} today={today} plans={plans} bare />}
      </Sheet>
    </div>
  );
}

// ------------------------------------------------------------------ board
const LANES: { k: Lane; l: string; c: string }[] = [{ k: "todo", l: "To do", c: V.mu }, { k: "doing", l: "Doing", c: V.ac }, { k: "waiting", l: "Waiting", c: V.ln }, { k: "done", l: "Done", c: V.ok }];
function Board({ tasks, today, plans, onPick }: { tasks: CalTask[]; today: string; plans: CalPlan[]; onPick: (x: CalTask) => void }) {
  const [over, setOver] = useState<Lane | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const planName = (id: string | null) => plans.find((p) => p.id === id)?.title;
  return (
    <div style={{ display: "flex", gap: 12, paddingTop: 12, paddingBottom: 12, flex: 1, minHeight: 0, overflowX: "auto" }}>
      {LANES.map((c) => {
        const items = sortTasks(tasks.filter((x) => laneOf(x) === c.k), "due");
        return (
          <div key={c.k} onDragOver={(e) => { e.preventDefault(); setOver(c.k); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
            onDrop={(e) => { e.preventDefault(); setOver(null); const k = e.dataTransfer.getData("application/x-lumen-task"); const x = tasks.find((y) => y.key === k); if (x && laneOf(x) !== c.k) void setTaskLane(x, c.k, today); setDrag(null); }}
            style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 6, padding: 10, borderRadius: 14, background: V.sf, border: `1px solid ${over === c.k ? V.ac : V.bd}`, overflowY: "auto", transition: "border-color .15s" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px 6px" }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: c.c }} /><b style={{ fontSize: 13 }}>{t(c.l)}</b><span style={{ color: V.mu, fontSize: 12 }}>{fmtNum(items.length)}</span></div>
            {items.map((x) => {
              const late = !x.done && !!x.due && x.due < today;
              return (
                <button key={x.key} draggable onDragStart={(e) => { e.dataTransfer.setData("application/x-lumen-task", x.key); e.dataTransfer.effectAllowed = "move"; setDrag(x.key); }} onDragEnd={() => setDrag(null)} onClick={() => onPick(x)}
                  className="hover:border-accent" style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, borderRadius: 10, background: V.bg, border: `1px solid ${V.bd}`, textAlign: "start", opacity: drag === x.key ? 0.4 : 1, flexShrink: 0 }}>
                  <span dir="auto" style={{ fontSize: 13, fontWeight: 600, textDecoration: x.done ? "line-through" : undefined, color: x.done ? V.mu : V.tx }}>{plainText(x)}</span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span dir="auto" style={{ fontSize: 11, padding: "1px 7px", borderRadius: 999, background: V.sf2, color: V.mu }}>{planName(x.planId) ?? x.noteTitle}</span>
                    {x.due && <span style={{ fontSize: 11, color: late ? V.da : V.mu }}>{dueText(x, today, true)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ detail panel
const REP: { v: CalTask["repeat"]; l: string }[] = [{ v: null, l: "Never" }, { v: "day", l: "Every day" }, { v: "weekday", l: "Every weekday" }, { v: "week", l: "Every week" }, { v: "2 weeks", l: "Every 2 weeks" }, { v: "month", l: "Every month" }, { v: "year", l: "Every year" }];
function Detail({ task, today, plans, bare }: { task: CalTask; today: string; plans: CalPlan[]; bare?: boolean }) {
  const [menu, setMenu] = useState<{ k: string; el: HTMLElement } | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [check, setCheck] = useState("");
  useEffect(() => { setEdit(null); setCheck(""); }, [task.key]);
  const late = !task.done && !!task.due && task.due < today;
  const plan = plans.find((p) => p.id === task.planId);
  const nDays = task.due ? Math.round((Date.parse(today) - Date.parse(task.due)) / 864e5) : 0;
  const dueV = task.due ? `${dayFull(task.due)}${task.time != null ? ` · ${hhmm(task.time)}` : ""}${late ? ` · ${t("{n} days overdue", { n: nDays })}` : ""}` : t("No date");
  const rows: { k: string; l: string; v: string; c: string; onClick?: (el: HTMLElement) => void }[] = [
    { k: "due", l: t("Due"), v: dueV, c: late ? V.da : task.due ? V.tx : V.mu, onClick: (el) => setMenu({ k: "due", el }) },
    { k: "plan", l: t("Plan"), v: plan ? plan.title : t("None"), c: plan ? V.tx : V.mu, onClick: (el) => setMenu({ k: "plan", el }) },
    { k: "note", l: t("Note"), v: task.noteTitle, c: V.ln, onClick: () => void db.notes.get(task.noteId).then((n) => openNoteAtLine(task.noteId, task.line, n?.body)) },
    { k: "prio", l: t("Priority"), v: task.prio ? t(task.prio === "high" ? "High" : task.prio === "medium" ? "Medium" : "Low") : t("None"), c: task.prio ? V.tx : V.mu, onClick: (el) => setMenu({ k: "prio", el }) },
    { k: "est", l: t("Estimate"), v: task.est ? t("{n} min", { n: task.est }) : t("None"), c: task.est ? V.tx : V.mu, onClick: (el) => setMenu({ k: "est", el }) },
    { k: "rep", l: t("Repeat"), v: t(REP.find((r) => r.v === task.repeat)?.l ?? "Never"), c: task.repeat ? V.tx : V.mu, onClick: (el) => setMenu({ k: "rep", el }) },
    { k: "rem", l: t("Reminder"), v: task.remind != null ? t("{n} min before", { n: task.remind }) : t("None"), c: task.remind != null ? V.tx : V.mu, onClick: (el) => setMenu({ k: "rem", el }) },
  ];
  const done = task.subtasks.filter((s) => s.done).length;
  const close = () => setMenu(null);
  const set = (f: Parameters<typeof setTaskField>[1], v: string | number | null) => { void setTaskField(task, f, v); close(); };
  const nextWd = (w: number) => shiftDay(today, ((w - weekday(today) + 7) % 7) || 7);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: bare ? 0 : 16, borderRadius: 14, background: bare ? undefined : V.sf, border: bare ? undefined : `1px solid ${V.bd}` }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <button onClick={() => void toggleTask(task, today)} aria-label={task.done ? t("Mark not done") : t("Mark done")} style={{ width: 20, height: 20, borderRadius: 6, border: `1.5px solid ${task.done ? V.ok : late ? V.da : V.bd}`, background: task.done ? V.ok : "transparent", marginTop: 2, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: V.af }}>{task.done && <Glyph name="check" size={12} stroke={3} />}</button>
        {edit != null
          ? <input autoFocus dir="auto" value={edit} onChange={(e) => setEdit(e.target.value)} onBlur={() => { if (edit.trim() && edit !== task.text) void renameTask(task, edit); setEdit(null); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEdit(null); }} style={{ fontSize: 16, fontWeight: 650, flex: 1, lineHeight: "22px", background: "transparent", color: V.tx, outline: "none", borderBottom: `1px solid ${V.ac}` }} />
          : <button onClick={() => setEdit(task.text)} title={t("Rename")} dir="auto" style={{ fontSize: 16, fontWeight: 650, flex: 1, lineHeight: "22px", textAlign: "start", textDecoration: task.done ? "line-through" : undefined }}>{task.text}</button>}
      </div>
      {rows.map((f) => (
        <div key={f.k} style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 10, fontSize: 12.5, alignItems: "center", minHeight: 30 }}>
          <span style={{ color: V.mu }}>{f.l}</span>
          <button onClick={(e) => f.onClick?.(e.currentTarget)} dir="auto" className="hover:bg-surface-2" style={{ color: f.c, textAlign: "start", borderRadius: 6, padding: "4px 6px", margin: "-4px -6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.v}</button>
        </div>
      ))}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {task.subtasks.length > 0 && <span style={{ fontSize: 11, fontWeight: 650, letterSpacing: ".06em", color: V.mu }}>{t("CHECKLIST · {a} / {b}", { a: done, b: task.subtasks.length })}</span>}
        {task.subtasks.map((c) => (
          <button key={c.line} onClick={() => void toggleCheck(task, c.line, !c.done, today)} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: c.done ? V.mu : V.tx, textDecoration: c.done ? "line-through" : "none", textAlign: "start" }}>
            <span style={{ width: 15, height: 15, borderRadius: 4, border: `1.5px solid ${c.done ? V.ok : V.bd}`, background: c.done ? V.ok : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: V.af }}>{c.done && <Glyph name="check" size={9} stroke={3} />}</span><span dir="auto">{c.text}</span>
          </button>
        ))}
        <input value={check} onChange={(e) => setCheck(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && check.trim()) { void addCheck(task, check); setCheck(""); } }} dir="auto" placeholder={t("+ Add an item")} aria-label={t("Add a checklist item")}
          className="placeholder:text-muted" style={{ fontSize: 12.5, background: "transparent", color: V.tx, outline: "none", padding: "2px 0 2px 23px" }} />
      </div>
      <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
        <button onClick={(e) => setMenu({ k: "snooze", el: e.currentTarget })} className="hover:bg-surface-2" style={{ flex: 1, height: 34, borderRadius: 9, border: `1px solid ${V.bd}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, fontSize: 12.5 }}>{t("Snooze")}<Glyph name="chevron-down" size={12} /></button>
        <button onClick={() => startTask(task)} className="hover:brightness-110" style={{ flex: 1, height: 34, borderRadius: 9, background: V.ac, color: V.af, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 650 }}>{t("Start focus")}</button>
      </div>
      {menu && (
        <Pop anchor={menu.el} onClose={close} width={menu.k === "due" ? 230 : 210}>
          {menu.k === "due" && <DueMenu value={task.due} today={today} onPick={(d) => set("due", d)} time={task.time} onTime={(m) => set("time", m)} />}
          {menu.k === "snooze" && <>
            <MLabel>{t("Snooze until")}</MLabel>
            <MItem onClick={() => set("due", shiftDay(today, 1))}>{t("Tomorrow")}<span style={{ color: V.mu, fontSize: 12 }}>{dayMon(shiftDay(today, 1))}</span></MItem>
            <MItem onClick={() => set("due", nextWd(6))}>{t("This weekend")}<span style={{ color: V.mu, fontSize: 12 }}>{dayMon(nextWd(6))}</span></MItem>
            <MItem onClick={() => set("due", nextWd(1))}>{t("Next week")}<span style={{ color: V.mu, fontSize: 12 }}>{dayMon(nextWd(1))}</span></MItem>
            <MItem onClick={() => set("due", shiftDay(today, 7))}>{t("In a week")}<span style={{ color: V.mu, fontSize: 12 }}>{dayMon(shiftDay(today, 7))}</span></MItem>
          </>}
          {menu.k === "plan" && <>{plans.map((p) => <MItem key={p.id} on={task.planId === p.id} onClick={() => set("plan", p.title)}><span style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} /><span dir="auto">{p.title}</span></MItem>)}<MItem on={!task.planId} onClick={() => set("plan", null)}>{t("None")}</MItem></>}
          {menu.k === "prio" && (["high", "medium", "low", null] as const).map((p) => <MItem key={String(p)} on={task.prio === p} onClick={() => set("prio", p)}>{t(p === "high" ? "High" : p === "medium" ? "Medium" : p === "low" ? "Low" : "None")}</MItem>)}
          {menu.k === "est" && [15, 30, 45, 60, 90, 120, null].map((m) => <MItem key={String(m)} on={task.est === m} onClick={() => set("est", m)}>{m ? t("{n} min", { n: m }) : t("None")}</MItem>)}
          {menu.k === "rep" && REP.map((r) => <MItem key={String(r.v)} on={task.repeat === r.v} onClick={() => set("repeat", r.v)}>{t(r.l)}</MItem>)}
          {menu.k === "rem" && <>
            {task.time == null && <span style={{ padding: "4px 8px", fontSize: 11.5, color: V.mu }}>{t("Reminders need a time on the due date.")}</span>}
            {[0, 10, 30, 60, null].map((m) => <MItem key={String(m)} on={task.remind === m} onClick={() => { if (m != null) void Notification?.requestPermission?.(); set("remind", m); }}>{m == null ? t("None") : m === 0 ? t("At the time") : t("{n} min before", { n: m })}</MItem>)}
          </>}
        </Pop>
      )}
    </div>
  );
}
const dayFull = (iso: string) => `${new Date(iso + "T12:00:00").toLocaleDateString(document.documentElement.lang || "en-GB", { weekday: "short" })} ${dayMon(iso)}`;

function DueMenu({ value, today, onPick, time, onTime }: { value: string | null; today: string; onPick: (d: string | null) => void; time: number | null; onTime: (m: number | null) => void }) {
  const [d, setD] = useState(value ?? today);
  const [tm, setTm] = useState(time != null ? hhmm(time) : "");
  const inp = { height: 28, minWidth: 0, flex: 1, borderRadius: 6, border: `1px solid ${V.bd}`, background: V.sf, padding: "0 6px", fontSize: 12.5, color: V.tx, colorScheme: "light dark" } as const;
  return <>
    <MLabel>{t("Due date")}</MLabel>
    <MItem on={value === today} onClick={() => onPick(today)}>{t("Today")}</MItem>
    <MItem on={value === shiftDay(today, 1)} onClick={() => onPick(shiftDay(today, 1))}>{t("Tomorrow")}</MItem>
    <MItem onClick={() => onPick(shiftDay(today, ((8 - weekday(today)) % 7) || 7))}>{t("Next week")}</MItem>
    <div style={{ display: "flex", gap: 6, padding: "4px" }}><input type="date" value={d} onChange={(e) => setD(e.target.value)} style={inp} /><button onClick={() => d && onPick(d)} style={{ height: 28, padding: "0 8px", borderRadius: 6, background: V.ac, color: V.af, fontWeight: 600, fontSize: 12 }}>{t("Set")}</button></div>
    <div style={{ display: "flex", gap: 6, padding: "4px", alignItems: "center" }}><span style={{ fontSize: 12, color: V.mu, width: 36 }}>{t("Time")}</span><input type="time" step={900} value={tm} onChange={(e) => setTm(e.target.value)} style={inp} /><button onClick={() => { if (!tm) onTime(null); else { const [h, m] = tm.split(":").map(Number); onTime(h * 60 + m); } }} style={{ height: 28, padding: "0 8px", borderRadius: 6, border: `1px solid ${V.bd}`, fontSize: 12 }}>{t("Set")}</button></div>
    {value && <MItem danger onClick={() => onPick(null)}>{t("Remove date")}</MItem>}
  </>;
}
