// Today (round 8, page 55 A–C; design PlanDesk.dc.html screen "today", converted 1:1): a Now block with one Start
// button, the day's schedule with a now line, tasks today, reviews due by deck, and on the side a mini month, plan
// health and "Today I learned". Plan my day fills free slots from the rule-based planner (lib/plan.ts) and each plan's
// pace; nothing moves until you confirm.
import { useCallback, useMemo, useState } from "react";
import { Glyph } from "../components/Glyph";
import { Sheet } from "../components/ui";
import { useTodayData } from "../components/today-data";
import { addLearned, addTask, learnedLines, moveItem, removeCalLine, setBlockDone, startItem, toggleTask } from "../components/calendar/actions";
import { QuickAdd } from "../components/calendar/QuickAdd";
import { PlanSheet } from "../components/calendar/PlanSheet";
import { card, DeskHeader, dueText, fmtD, hhmm, HBtn, longDay, MiniMonth, MItem, Pop, TaskRow, tint, V } from "../components/calendar/parts";
import { REVIEW_COLOR, useCalendar, useNow, useReminders, EVENT_COLOR } from "../components/calendar/use-calendar";
import { durLabel, reviewMinutes, shiftDay, type CalItem } from "../lib/calendar";
import { inList, type CalTask } from "../lib/calendar-tasks";
import type { CalPlan } from "../lib/calendar-plans";
import { placeBlocks, suggestBlocks } from "../lib/calendar-suggest";
import { go, toast, useVault } from "../lib/store";
import { usePhone } from "./spaces-util";
import { fmtNum, t } from "../lib/i18n";

type Entry = { id: string; it: CalItem | null; start: number; dur: number; title: string; sub: string; color: string; done: boolean };
const REVIEW_AT = 8 * 60;

export function TodayView() {
  const phone = usePhone();
  const cal = useCalendar();
  const td = useTodayData();
  const v = useVault();
  const now = useNow();
  const { today } = cal;
  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  const [planning, setPlanning] = useState<CalItem[] | null>(null);
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const [entryMenu, setEntryMenu] = useState<{ e: Entry; el: HTMLElement } | null>(null);
  const notify = useCallback((text: string) => { toast(t("Reminder: {task}", { task: text })); try { new Notification("Lumen", { body: text }); } catch { /* no permission */ } }, []);
  useReminders(cal.tasks, today, notify);

  // ---------------------------------------------------------------- schedule
  const dueN = cal.due.length;
  const entries = useMemo(() => {
    const out: Entry[] = cal.items.filter((x) => x.date === today && x.start != null && x.kind !== "milestone" && x.kind !== "item" && cal.visible(x))
      .map((it) => ({ id: it.id, it, start: it.start!, dur: it.dur || 30, title: it.title, sub: [it.sub, durLabel(it.dur || 30)].filter(Boolean).join(" · "), color: it.color === "var(--text)" ? EVENT_COLOR : it.color, done: !!it.done }));
    if (dueN > 0 || cal.reviewedToday > 0) out.push({ id: "reviews", it: null, start: REVIEW_AT, dur: Math.max(5, reviewMinutes(dueN)), title: t("Morning reviews"), sub: dueN ? t("{n} cards · {m} min", { n: dueN, m: reviewMinutes(dueN) }) : t("All reviewed"), color: REVIEW_COLOR, done: dueN === 0 });
    return out.sort((a, b) => a.start - b.start);
  }, [cal, today, dueN]);
  const nowE = entries.find((e) => !e.done && e.start <= nowMin && nowMin < e.start + e.dur) ?? null;
  const nextE = nowE ?? entries.find((e) => !e.done && e.start >= nowMin) ?? null;
  const schedMin = entries.reduce((a, e) => a + e.dur, 0);

  // ---------------------------------------------------------------- tasks
  const todayTasks = cal.tasks.filter((x) => inList(x, "today", today) || (x.done && x.doneOn === today)).sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? "").localeCompare(b.due ?? "") || (a.time ?? 1e4) - (b.time ?? 1e4));
  const doneN = todayTasks.filter((x) => x.done).length;
  const leftN = todayTasks.length - doneN;
  const upTask: CalTask | undefined = todayTasks.find((x) => !x.done);

  // ---------------------------------------------------------------- reviews by deck (= space; Review scopes by space)
  const decks = useMemo(() => {
    const m = new Map<string, { id: string; l: string; c: string; n: number; r: number }>();
    for (const d of cal.due) {
      const sid = d.note.spaceId;
      const sp = v.spaceMap.get(sid);
      const row = m.get(sid) ?? { id: sid, l: sp?.name ?? t("Inbox"), c: cal.planOf(sid)?.color ?? sp?.color ?? V.mu, n: 0, r: 0 };
      if (d.card.reps === 0) row.n++; else row.r++;
      m.set(sid, row);
    }
    return [...m.values()].sort((a, b) => b.n + b.r - (a.n + a.r));
  }, [cal, v.spaceMap]);

  // ---------------------------------------------------------------- side
  const [y, mo] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1];
  const dots = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of cal.items) if (it.planId && cal.visible(it) && !m.has(it.date)) m.set(it.date, it.color);
    return m;
  }, [cal]);
  const journal = v.notes.find((n) => n.type === "journal" && !n.deleted && n.title.includes(today));
  const learned = journal ? learnedLines(journal.body) : [];
  const [til, setTil] = useState("");

  // ---------------------------------------------------------------- Plan my day
  function planMyDay() {
    const busy = cal.items.filter((x) => cal.visible(x));
    const s = td.plan.sections;
    const reqs = [...s.continue, ...s.new, ...s.practice, ...s.reviews.filter((x) => x.kind !== "cards")]
      .filter((it) => it.state !== "done" && it.state !== "skip" && it.state !== "later" && !entries.some((e) => e.title === it.title))
      .map((it) => { const sp = td.courses.find((c) => c.key === it.course?.key)?.spaceId ?? null; const p = cal.planOf(sp); return { title: it.title, sub: p?.title ?? it.course?.title, dur: Math.max(30, it.minutes), planId: p?.id ?? null, color: p?.color ?? it.course?.color ?? EVENT_COLOR }; });
    const from = Math.max(nowMin + 5, dueN ? REVIEW_AT + reviewMinutes(dueN) : 0);
    let out = placeBlocks(reqs, busy, today, from);
    if (!out.length) out = suggestBlocks(cal.plans, busy, { days: [today], today, nowMin, studyDays: [], dailyMax: cal.dailyMin, reviewMin: dueN ? reviewMinutes(dueN) : 0 });
    setPlanning(out);
  }

  const startNow = () => {
    if (nextE) { if (nextE.it) startItem(nextE.it, { byTitle: v.byTitle, plan: cal.planOf(nextE.it.planId) }); else startItem({ kind: "reviews" }, { byTitle: v.byTitle }); }
    else if (upTask) startItem({ id: upTask.key, kind: "task", title: upTask.text, date: today, start: upTask.time, dur: upTask.est ?? 0, cal: "tasks", color: "", noteId: upTask.noteId, line: upTask.line }, { byTitle: v.byTitle });
  };
  const nowLabel = nextE ? `${nowE ? t("NOW") : t("NEXT")} · ${hhmm(nextE.start)} – ${hhmm(nextE.start + nextE.dur)}` : upTask ? t("UP NEXT") : t("NOTHING SCHEDULED");
  const nowTitle = nextE?.title ?? (upTask ? upTask.text : t("Your day is free"));
  const lateDays = nextE?.it?.late ? Math.round((Date.parse(today) - Date.parse(nextE.it.date)) / 864e5) : 0;
  const nowSub = nextE ? [nextE.it ? nextE.it.sub : null, nextE.it ? durLabel(nextE.dur) : nextE.sub, lateDays ? t("{n} days overdue", { n: lateDays }) : ""].filter(Boolean).join(" · ")
    : upTask ? [cal.planOf(upTask.planId)?.title ?? upTask.noteTitle, dueText(upTask, today, true)].filter(Boolean).join(" · ") : t("Plan my day fills free slots from your plans’ pace.");
  const nowDur = nextE?.dur ?? upTask?.est ?? 0;

  if (!cal.ready) return <div className="p-6 text-[13px] text-muted">{t("Loading…")}</div>;
  const sub = phone
    ? `${longDay(today).split(",")[0].slice(0, 3)} · ${t("{n} blocks", { n: entries.length })} · ${t("{n} reviews", { n: dueN })}`
    : t("{greet}. {b} blocks, {t} tasks left and {r} reviews. {s}-day streak.", { greet: greeting(nowMin), b: entries.length, t: leftN, r: dueN, s: td.streak });
  const nTasks = phone ? 3 : 6;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", fontSize: 13, color: V.tx, background: V.bg }}>
      <DeskHeader phone={phone} title={phone ? t("Today") : longDay(today)} sub={sub}>
        {!phone && <HBtn glyph="plus" label={t("Quick add")} onClick={(e) => setAdding(e.currentTarget)} />}
        <HBtn glyph="timeline" label={t("Plan my day")} primary onClick={planMyDay} />
      </DeskHeader>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "grid", gridTemplateColumns: phone ? "1fr" : "minmax(0,1fr) 300px", gap: 16, padding: phone ? "0 16px 16px" : "0 28px 24px", alignContent: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {/* Now block */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 16, borderRadius: 16, background: "linear-gradient(135deg,color-mix(in srgb,var(--accent) 18%,var(--surface)),var(--surface))", border: "1px solid color-mix(in srgb,var(--accent) 40%,var(--border))" }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: V.ac }}>{nowLabel}</span>
              <span dir="auto" style={{ fontSize: phone ? 16 : 19, fontWeight: 650 }}>{nowTitle}</span>
              <span dir="auto" style={{ fontSize: 12.5, color: V.mu }}>{nowSub}</span>
            </div>
            <button onClick={nextE || upTask ? startNow : planMyDay} className="hover:brightness-110" style={{ height: 40, padding: "0 16px", borderRadius: 10, background: V.ac, color: V.af, display: "flex", alignItems: "center", gap: 8, fontWeight: 650, whiteSpace: "nowrap" }}>
              {nextE || upTask
                ? <><svg width="13" height="13" viewBox="0 0 24 24" className="rtl:-scale-x-100"><path d="M8 5l11 7-11 7z" style={{ fill: "currentColor" }} /></svg>{nowDur ? t("Start · {d}", { d: durLabel(nowDur) }) : t("Start")}</>
                : <><Glyph name="timeline" size={14} />{t("Plan my day")}</>}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: phone ? "1fr" : "1fr 1fr", gap: 14 }}>
            {/* Schedule */}
            <div style={{ ...card, gap: 2 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 8 }}><span style={{ fontWeight: 650, fontSize: 13.5, flex: 1 }}>{t("Schedule")}</span><span style={{ fontSize: 12, color: V.mu }}>{t("{n} blocks · {d}", { n: entries.length, d: durLabel(schedMin) })}</span></div>
              {!entries.length && <button onClick={planMyDay} style={{ minHeight: 50, borderRadius: 8, border: `1px dashed ${V.bd}`, color: V.mu, fontSize: 12.5 }}>{t("Nothing scheduled yet. Plan my day")}</button>}
              {entries.map((e) => {
                const past = !e.done && e.start + e.dur <= nowMin;
                const isNow = e === nowE;
                return (
                  <div key={e.id} style={{ display: "flex", gap: 10, minHeight: phone ? 44 : 50, position: "relative" }}>
                    <span style={{ width: 44, flexShrink: 0, fontSize: 11.5, color: V.mu, paddingTop: 3, fontVariantNumeric: "tabular-nums" }}>{hhmm(e.start)}</span>
                    <button onClick={(ev) => setEntryMenu({ e, el: ev.currentTarget })} className="hover:brightness-110" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2, padding: "6px 10px", borderRadius: 8, background: isNow ? tint(e.color) : `color-mix(in srgb,${e.color} 8%,transparent)`, borderInlineStart: `3px solid ${e.color}`, opacity: e.done || past ? 0.55 : 1, textAlign: "start", marginBottom: 4 }}>
                      <span dir="auto" style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: e.done ? "line-through" : "none", maxWidth: "100%" }}>{e.title}</span>
                      <span dir="auto" style={{ fontSize: 11, color: V.mu }}>{e.sub}</span>
                    </button>
                    {isNow && <div style={{ position: "absolute", insetInlineStart: 44, insetInlineEnd: 0, top: -1, height: 2, background: V.ac, pointerEvents: "none" }} />}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              {/* Tasks today */}
              <div style={card}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 6 }}>
                  <span style={{ fontWeight: 650, fontSize: 13.5, flex: 1 }}>{t("Tasks today")}</span>
                  <span style={{ fontSize: 12, color: V.mu }}>{t("{a} of {b}", { a: doneN, b: todayTasks.length })}</span>
                  <button onClick={(e) => setAdding(e.currentTarget)} style={{ fontSize: 12, color: V.ac }}>{t("+ Add")}</button>
                </div>
                {!todayTasks.length && <span style={{ fontSize: 12.5, color: V.mu, padding: "8px 2px" }}>{t("Nothing due today.")}</span>}
                {todayTasks.slice(0, nTasks).map((x) => <TaskRow key={x.key} task={x} today={today} phone={phone} onToggle={() => void toggleTask(x, today)} onSelect={() => { try { sessionStorage.setItem("lumen.task", x.key); } catch { /* ignore */ } go("tasks"); }} />)}
                {todayTasks.length > nTasks && <button onClick={() => go("tasks")} style={{ fontSize: 12, color: V.mu, textAlign: "start", padding: "6px 8px" }}>{t("+{n} more", { n: todayTasks.length - nTasks })}</button>}
              </div>
              {/* Reviews due */}
              <div style={{ ...card, gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 650, fontSize: 13.5, flex: 1 }}>{t("Reviews due")}</span><span style={{ fontSize: 12, color: V.mu }}>{t("{n} cards · ~{m} min", { n: dueN, m: reviewMinutes(dueN) })}</span></div>
                {decks.slice(0, 5).map((d) => (
                  <button key={d.id} onClick={() => go("review", { spaceId: d.id })} title={t("Review this deck")} className="hover:bg-surface-2" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 32, borderRadius: 6, textAlign: "start" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: d.c }} />
                    <span dir="auto" style={{ flex: 1, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.l}</span>
                    <span style={{ fontSize: 11.5, color: V.ln, fontVariantNumeric: "tabular-nums" }}>{t("{n} new", { n: d.n })}</span>
                    <span style={{ fontSize: 11.5, color: V.wa, fontVariantNumeric: "tabular-nums", width: 22, textAlign: "end" }}>{fmtNum(d.r)}</span>
                  </button>
                ))}
                {!dueN && <span style={{ fontSize: 12.5, color: V.mu }}>{t("No cards due.")}</span>}
                <button disabled={!dueN} onClick={() => startItem({ kind: "reviews" }, { byTitle: v.byTitle })} className="hover:bg-surface-2 disabled:opacity-50" style={{ height: 34, borderRadius: 9, border: `1px solid ${V.bd}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 600 }}>{t("Review all · or pick a deck")}</button>
              </div>
            </div>
          </div>
        </div>
        {!phone && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <div style={{ ...card, gap: 10 }}><button onClick={() => go("calendar")} style={{ fontWeight: 650, fontSize: 13.5, textAlign: "start" }}>{monthName(today)}</button><MiniMonth year={y} month={mo} today={today} dots={dots} onPick={(d) => { try { sessionStorage.setItem("lumen.calendarDay", d); } catch { /* ignore */ } go("calendar"); }} /></div>
            <div style={{ ...card, gap: 10 }}>
              <span style={{ fontWeight: 650, fontSize: 13.5 }}>{t("Plans")}</span>
              {!cal.plans.length && <span style={{ fontSize: 12.5, color: V.mu }}>{t("Course and project spaces show up here as plans.")}</span>}
              {cal.plans.map((p) => <PlanHealth key={p.id} p={p} />)}
            </div>
            <div style={{ ...card, gap: 8 }}>
              <span style={{ fontWeight: 650, fontSize: 13.5 }}>{t("Today I learned")}</span>
              {learned.map((l, i) => <span key={i} dir="auto" style={{ fontSize: 12.5, lineHeight: "18px" }}>{l}</span>)}
              <textarea value={til} onChange={(e) => setTil(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void addLearned(til, today); setTil(""); } }} dir="auto"
                placeholder={t("One line is enough. Saved to today’s journal.")} aria-label={t("Today I learned")} className="placeholder:text-muted focus:border-accent focus:outline-none"
                style={{ minHeight: 56, padding: 10, borderRadius: 9, background: V.bg, border: `1px solid ${V.bd}`, fontSize: 12.5, resize: "none", color: V.tx }} />
            </div>
          </div>
        )}
      </div>

      {adding && <Pop anchor={adding} onClose={() => setAdding(null)} width={420}><QuickAdd today={today} plans={cal.plans} defaultDue={today} onDone={() => setAdding(null)} onAdd={(p, plan) => addTask(p, today, plan)} /></Pop>}
      {entryMenu && <EntryMenu entry={entryMenu.e} anchor={entryMenu.el} onClose={() => setEntryMenu(null)} today={today} tasks={cal.tasks} start={(it) => it ? startItem(it, { byTitle: v.byTitle, plan: cal.planOf(it.planId) }) : startItem({ kind: "reviews" }, { byTitle: v.byTitle })} />}
      <Sheet open={!!planning} onClose={() => setPlanning(null)} title={t("Plan my day")}>
        {planning && <PlanSheet items={planning} planTitle={(id) => cal.planOf(id)?.title ?? null} onClose={() => setPlanning(null)} />}
      </Sheet>
    </div>
  );
}

const greeting = (m: number) => (m < 5 * 60 ? t("Burning the midnight oil") : m < 12 * 60 ? t("Good morning") : m < 18 * 60 ? t("Good afternoon") : t("Good evening"));
const monthName = (iso: string) => fmtD(iso, { month: "long" });

function PlanHealth({ p }: { p: CalPlan }) {
  const [s, sc] = p.status === "overdue" ? [t("{n} overdue", { n: p.overdue }), V.da] : p.status === "risk" ? [t("at risk"), V.da] : p.status === "days" ? [t("{n} days", { n: p.daysLeft ?? 0 }), V.mu] : [t("on track"), V.ok];
  return (
    <button onClick={() => p.spaceId && go("space", { spaceId: p.spaceId, folderId: null, noteId: null })} title={t("{a} of {b} done", { a: p.doneCount, b: p.total })} style={{ display: "flex", flexDirection: "column", gap: 5, textAlign: "start" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, width: "100%" }}><span style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} /><span dir="auto" style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</span><span style={{ fontSize: 11.5, color: sc }}>{s}</span></div>
      <div style={{ height: 4, borderRadius: 2, background: V.sf2, width: "100%" }}><div style={{ height: "100%", width: `${Math.round(p.progress * 100)}%`, borderRadius: 2, background: p.color, transition: "width .3s var(--ease)" }} /></div>
    </button>
  );
}

function EntryMenu({ entry, anchor, onClose, today, tasks, start }: { entry: Entry; anchor: HTMLElement; onClose: () => void; today: string; tasks: CalTask[]; start: (it: CalItem | null) => void }) {
  const it = entry.it;
  const run = (f: () => void) => () => { onClose(); f(); };
  return (
    <Pop anchor={anchor} onClose={onClose} width={220}>
      <MItem onClick={run(() => start(it))}><Glyph name="play" size={14} />{t("Start")}</MItem>
      {it && (it.kind === "block" || it.kind === "task") && <MItem onClick={run(() => { if (it.kind === "block") void setBlockDone(it, !it.done); else { const tk = tasks.find((x) => `task:${x.key}` === it.id); if (tk) void toggleTask(tk, today); } })}><Glyph name="check" size={14} />{entry.done ? t("Mark not done") : t("Mark done")}</MItem>}
      {it && <MItem onClick={run(() => { void moveItem(it, shiftDay(today, 1), it.start); toast(t("Moved to tomorrow")); })}><Glyph name="calendar" size={14} />{t("Move to tomorrow")}</MItem>}
      {it && (it.kind === "block" || it.kind === "event") && <MItem danger onClick={run(() => void removeCalLine(it))}><Glyph name="trash" size={14} />{t("Remove from calendar")}</MItem>}
    </Pop>
  );
}
