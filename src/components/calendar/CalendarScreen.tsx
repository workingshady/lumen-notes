// Calendar (round 8, page 55 D–H; PlanDesk.dc.html screens "month" and "week", converted 1:1). Every plan is a calendar
// you can toggle; reviews due are a count per day, never events; milestones are diamonds. Busy-week warning compares
// planned hours with the plans' pace and offers Rebalance. Auto-schedule proposes dashed blocks; drag one or Accept all.
// Keys: ← → move, T today, D / W / M / A switch view.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Glyph } from "../Glyph";
import { Sheet } from "../ui";
import { busyWeek, byDay, CAL_EVENTS, CAL_REVIEWS, CAL_TASKS, durLabel, monthGrid, rebalance, shiftDay, weekDays, weekLoads, type CalItem } from "../../lib/calendar";
import { addBlocks, CAL_NOTE_ID, editNote, moveLine } from "../../lib/calendar-store";
import { suggestBlocks } from "../../lib/calendar-suggest";
import { downloadICS, toICS } from "../../lib/calendar-ics";
import { toast, useVault } from "../../lib/store";
import { usePhone } from "../../views/spaces-util";
import { moveItem } from "./actions";
import { ItemPop, ScheduleSheet, type ScheduleInit } from "./dialogs";
import { dayMon, DeskHeader, fmtD, hhmm, HBtn, longDay, Seg, tint, V } from "./parts";
import { EVENT_COLOR, REVIEW_COLOR, toggleCalendar, useCalendar, useHidden, useNow } from "./use-calendar";
import { PlanSheet } from "./PlanSheet";
import { WeekGrid as WeekGridLazy } from "./WeekGrid";
import { fmtNum, t } from "../../lib/i18n";
import { dayOf, weeklyLoad } from "../../lib/plan-model";

type Mode = "day" | "week" | "month" | "agenda";
const MODE_KEY = "lumen.cal.mode";

function takeStartDay() {
  try { const raw = sessionStorage.getItem("lumen.calendarDay"); if (!raw) return null; sessionStorage.removeItem("lumen.calendarDay"); return /\d{4}-\d{2}-\d{2}/.exec(raw)?.[0] ?? null; } catch { return null; }
}

export function CalendarScreen() {
  const phone = usePhone();
  const cal = useCalendar();
  const v = useVault();
  const now = useNow();
  const hid = useHidden();
  const { today } = cal;
  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  const [mode, setModeRaw] = useState<Mode>(() => { try { return (localStorage.getItem(MODE_KEY) as Mode) || "month"; } catch { return "month"; } });
  const setMode = (m: Mode) => { setModeRaw(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ } };
  const [anchor, setAnchor] = useState(() => takeStartDay() ?? today);
  const [sel, setSel] = useState(anchor);
  const [pop, setPop] = useState<{ it: CalItem; el: HTMLElement } | null>(null);
  const [sched, setSched] = useState<ScheduleInit | null>(null);
  const [auto, setAuto] = useState(false);
  const [confirm, setConfirm] = useState<CalItem[] | null>(null);
  const m = phone && mode === "day" ? "week" : mode;

  const visible = useMemo(() => cal.items.filter(cal.visible), [cal]);
  const showReviews = !hid.has(CAL_REVIEWS);
  const y = Number(anchor.slice(0, 4)), mo = Number(anchor.slice(5, 7)) - 1;
  const days = m === "month" ? monthGrid(y, mo, 1) : m === "week" ? (phone ? [shiftDay(anchor, -1), anchor, shiftDay(anchor, 1)] : weekDays(anchor)) : m === "day" ? [anchor] : Array.from({ length: 14 }, (_, i) => shiftDay(anchor, i));

  const suggestions = useMemo(() => (auto && (m === "week" || m === "day") ? suggestBlocks(cal.plans.filter((p) => !hid.has(p.id)), cal.items, { days, today, nowMin, studyDays: cal.studyDays, dailyMax: Math.max(cal.dailyMin, 60) }) : []), [auto, m, days.join(), cal, hid, today, nowMin]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = [...visible, ...suggestions];
  const perDay = useMemo(() => byDay(shown), [shown]); // eslint-disable-line react-hooks/exhaustive-deps

  // busy week (from this week on)
  const loads = useMemo(() => weekLoads(cal.items, cal.paceMin, today, 8), [cal.items, cal.paceMin, today]);
  // Plans page agreement: a week is also busy when a plan's own weeklyLoad is over its pace.
  const loadsM = useMemo(() => loads.map((w) => {
    const t0 = dayOf(w.week);
    const plan = cal.plans.filter((p) => !hid.has(p.id)).map((p) => ({ p, wl: weeklyLoad(p.model, t0, 1)[0] })).filter((x) => x.wl.over);
    return plan.length ? { ...w, over: true, planned: Math.max(w.planned, Math.round(plan.reduce((a, x) => a + x.wl.hours * 60, 0))) } : w;
  }), [loads, cal.plans, hid]);
  const busy = busyWeek(loadsM);
  const doRebalance = async () => {
    if (!busy) return;
    const moves = rebalance(cal.items, busy, cal.studyDays, today);
    if (!moves.length) { toast(t("Nothing movable that week: only study blocks you scheduled can move.")); return; }
    await editNote(CAL_NOTE_ID, (b) => moves.reduce((x, mv) => moveLine(x, mv.line, mv.to), b));
    toast(t("{n} blocks moved to the week of {d}", { n: moves.length, d: dayMon(shiftDay(busy.week, 7)) }));
  };

  const nav = useCallback((dir: number) => {
    if (m === "month") { const d = new Date(Date.UTC(y, mo + dir, 1)); setAnchor(d.toISOString().slice(0, 10)); }
    else setAnchor((a) => shiftDay(a, dir * (m === "week" ? (phone ? 3 : 7) : m === "day" ? 1 : 14)));
  }, [m, y, mo, phone]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select,[contenteditable=true],.cm-editor") || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "arrowleft" || key === "arrowright") { e.preventDefault(); const rtl = document.documentElement.dir === "rtl"; nav((key === "arrowright") !== rtl ? 1 : -1); }
      else if (key === "t") { setAnchor(today); setSel(today); }
      else if (key === "d" && !phone) setMode("day"); else if (key === "w") setMode("week"); else if (key === "m") setMode("month"); else if (key === "a") setMode("agenda");
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [nav, today, phone]); // eslint-disable-line react-hooks/exhaustive-deps

  const accept = async (it: CalItem, date?: string, start?: number) => {
    await addBlocks([{ title: it.title, date: date ?? it.date, start: start ?? it.start, dur: it.dur, plan: cal.planOf(it.planId)?.title ?? null }]);
    toast(t("Block added"));
  };
  const exportIcs = () => {
    const text = toICS(cal.items.filter((x) => cal.visible(x) && x.kind !== "task"), cal.tasks.filter((x) => !hid.has(CAL_TASKS) && (x.due || !x.done)), { name: "Lumen", now: Date.now(), tasksAsEvents: true, planTitle: (id) => cal.planOf(id)?.title ?? null });
    downloadICS(text);
    toast(t("Calendar exported (.ics)"));
  };

  // header
  const inMonth = (d: string) => Number(d.slice(5, 7)) === mo + 1 && Number(d.slice(0, 4)) === y;
  const monthItems = visible.filter((x) => inMonth(x.date));
  const reviewsInMonth = [...cal.reviews.entries()].filter(([d]) => inMonth(d) && d >= today).reduce((a, [, n]) => a + n, 0);
  const title = m === "month" ? fmtD(anchor, phone ? { month: "long" } : { month: "long", year: "numeric" })
    : m === "week" ? (phone ? `${fmtNum(Number(days[0].slice(8)))} – ${dayMon(days[days.length - 1])}` : t("Week of {d}", { d: `${fmtNum(Number(days[0].slice(8)))} ${fmtD(days[0], { month: "long" })}` }))
      : m === "day" ? longDay(anchor) : t("Agenda");
  const sub = phone ? "" : m === "month" ? t("{s} sessions · {m} milestones · {r} reviews scheduled", { s: monthItems.filter((x) => x.kind === "block").length, m: monthItems.filter((x) => x.kind === "milestone").length, r: reviewsInMonth })
    : m === "week" || m === "day" ? (auto ? t("Dashed blocks are suggestions from your plans’ pace; drag to accept.") : t("{h} planned · pace {p} a week", { h: durLabel(days.reduce((a, d) => a + (perDay.get(d) ?? []).filter((x) => x.planId && x.kind !== "suggested").reduce((s, x) => s + (x.done ? 0 : x.dur), 0), 0)), p: durLabel(cal.paceMin) }))
      : t("The next two weeks, day by day.");
  const seg = (phone ? ["month", "week", "agenda"] : ["day", "week", "month", "agenda"]) as Mode[];
  const navBtn = (dir: number, label: string) => (
    <button onClick={() => nav(dir)} aria-label={label} title={label} className="hover:bg-surface-2" style={{ width: 34, height: 34, borderRadius: 9, border: `1px solid ${V.bd}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Glyph name="chevron-right" size={15} className={dir < 0 ? "-scale-x-100 rtl:scale-x-100" : "rtl:-scale-x-100"} />
    </button>
  );

  const calRows = [
    ...cal.plans.map((p) => ({ id: p.id, l: p.title, c: p.color, s: fmtNum(monthItems.filter((x) => x.cal === p.id || (x.kind === "task" && x.planId === p.id)).length) })),
    { id: CAL_TASKS, l: t("Tasks with dates"), c: "var(--text)", s: fmtNum(cal.items.filter((x) => x.kind === "task" && inMonth(x.date)).length) },
    { id: CAL_REVIEWS, l: t("Review load"), c: REVIEW_COLOR, s: t("counts") },
    { id: CAL_EVENTS, l: t("Events"), c: EVENT_COLOR, s: fmtNum(cal.items.filter((x) => x.cal === CAL_EVENTS && inMonth(x.date)).length) },
  ];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", fontSize: 13, color: V.tx, background: V.bg }}>
      <DeskHeader phone={phone} title={title} sub={sub}>
        <Seg options={seg.map((x) => ({ v: x, l: t(x === "day" ? "Day" : x === "week" ? "Week" : x === "month" ? "Month" : "Agenda") }))} value={m} onChange={setMode} />
        {navBtn(-1, t("Previous"))}
        {!phone && <HBtn glyph="chevron-right" label={t("Today")} onClick={() => { setAnchor(today); setSel(today); }} />}
        {navBtn(1, t("Next"))}
        {(m === "week" || m === "day") && !phone && <HBtn glyph="target" label={t("Auto-schedule")} pressed={auto} onClick={() => setAuto((a) => !a)} />}
        {phone && (m === "week") && <HBtn glyph="target" label="" pressed={auto} onClick={() => setAuto((a) => !a)} title={t("Auto-schedule")} />}
      </DeskHeader>

      {auto && (m === "week" || m === "day") && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: phone ? "0 12px 10px" : "0 28px 12px", padding: "8px 12px", borderRadius: 10, border: `1.5px dashed ${V.bd}`, fontSize: 12.5 }}>
          <span style={{ flex: 1, color: V.mu }}>{suggestions.length === 1 ? t("1 suggested block from your plans’ pace ({h}). Click or drag it to accept.", { h: durLabel(suggestions[0].dur) }) : suggestions.length ? t("{n} suggested blocks from your plans’ pace ({h}). Click or drag one to accept.", { n: suggestions.length, h: durLabel(suggestions.reduce((a, x) => a + x.dur, 0)) }) : t("Your plans’ pace is already covered this week.")}</span>
          {suggestions.length > 0 && <button onClick={() => setConfirm(suggestions)} style={{ height: 30, padding: "0 12px", borderRadius: 8, background: V.ac, color: V.af, fontWeight: 650 }}>{t("Accept all")}</button>}
          <button onClick={() => setAuto(false)} aria-label={t("Hide suggestions")} style={{ color: V.mu }}><Glyph name="x" size={14} /></button>
        </div>
      )}

      {m === "month" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: phone ? "column" : "row", gap: 16, padding: phone ? "0 12px 12px" : "0 28px 24px", overflowY: phone ? "auto" : undefined }}>
          {!phone && (
            <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
              <button onClick={() => setSched({ date: sel >= today ? sel : today, start: 10 * 60 })} className="hover:brightness-110" style={{ height: 38, borderRadius: 10, background: V.ac, color: V.af, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 650, gap: 6, flexShrink: 0 }}>{t("+ Schedule")}</button>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 650, letterSpacing: ".06em", color: V.mu, paddingBottom: 4 }}>{t("CALENDARS")}</span>
                {calRows.map((c) => {
                  const off = hid.has(c.id);
                  return (
                    <button key={c.id} onClick={() => toggleCalendar(c.id)} role="switch" aria-checked={!off} style={{ display: "flex", alignItems: "center", gap: 9, minHeight: 30, fontSize: 12.5, opacity: off ? 0.5 : 1, textAlign: "start", transition: "opacity .15s" }}>
                      <span style={{ width: 14, height: 14, borderRadius: 4, background: off ? "transparent" : c.c, border: `2px solid ${c.c}`, boxSizing: "border-box", flexShrink: 0 }} />
                      <span dir="auto" style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.l}</span>
                      <span style={{ fontSize: 11, color: V.mu }}>{c.s}</span>
                    </button>
                  );
                })}
              </div>
              {busy && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12, borderRadius: 12, background: V.sf, border: `1px solid ${V.bd}`, fontSize: 12, lineHeight: "17px", color: V.mu }}>
                  <b style={{ color: V.tx }}>{busy.week <= today ? t("Busy week") : t("Busy week ahead")}</b>
                  {t("Week of {d} has {h} planned against a {p} pace. Spread to the next week?", { d: dayMon(busy.week), h: durLabel(busy.planned), p: durLabel(busy.pace) })}
                  <button onClick={() => void doRebalance()} style={{ color: V.ac, fontWeight: 600, textAlign: "start" }}>{t("Rebalance")}</button>
                </div>
              )}
              <button onClick={exportIcs} className="hover:text-ink" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: V.mu, textAlign: "start" }}><Glyph name="export" size={14} />{t("Export .ics")}</button>
            </div>
          )}
          <MonthGrid days={days} month={mo} today={today} sel={sel} phone={phone} perDay={perDay} reviews={showReviews ? cal.reviews : new Map()}
            onSel={(d) => { setSel(d); if (!phone && d === sel) { setAnchor(d); setMode("day"); } }} onItem={(it, el) => setPop({ it, el })} onDrop={(id, d) => { const it = cal.items.find((x) => x.id === id); if (it && it.date !== d) void moveItem(it, d, it.start); }} />
          {phone && <DayAgenda day={sel} items={perDay.get(sel) ?? []} reviews={showReviews ? cal.reviews.get(sel) ?? 0 : 0} today={today} onItem={(it, el) => setPop({ it, el })} onAdd={() => setSched({ date: sel, start: 10 * 60 })} />}
        </div>
      )}

      {(m === "week" || m === "day") && (
        <WeekGridLazy days={days} today={today} nowMin={nowMin} items={shown} reviews={cal.reviews} showReviews={showReviews} phone={phone}
          onItem={(it, el) => setPop({ it, el })} onSlot={(d, s) => setSched({ date: d, start: s })} onMove={(it, d, s) => void moveItem(it, d, s)} onAccept={(it, d, s) => void accept(it, d, s)} />
      )}

      {m === "agenda" && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: phone ? "0 12px 16px" : "0 28px 24px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 820 }}>
          {days.map((d) => <DayAgenda key={d} day={d} items={perDay.get(d) ?? []} reviews={showReviews ? cal.reviews.get(d) ?? 0 : 0} today={today} onItem={(it, el) => setPop({ it, el })} compact />)}
          <button onClick={exportIcs} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: V.mu }}><Glyph name="export" size={14} />{t("Export .ics")}</button>
        </div>
      )}

      {pop && <ItemPop it={pop.it} anchor={pop.el} onClose={() => setPop(null)} today={today} tasks={cal.tasks} plan={cal.planOf(pop.it.planId)} byTitle={v.byTitle} />}
      <ScheduleSheet init={sched} plans={cal.plans} onClose={() => setSched(null)} />
      <Sheet open={!!confirm} onClose={() => setConfirm(null)} title={t("Accept all")}>
        {confirm && <PlanSheet items={confirm} planTitle={(id) => cal.planOf(id)?.title ?? null} onClose={() => { setConfirm(null); setAuto(false); }} />}
      </Sheet>
    </div>
  );
}


function MonthGrid({ days, month, today, sel, phone, perDay, reviews, onSel, onItem, onDrop }: {
  days: string[]; month: number; today: string; sel: string; phone: boolean; perDay: Map<string, CalItem[]>; reviews: Map<string, number>;
  onSel: (d: string) => void; onItem: (it: CalItem, el: HTMLElement) => void; onDrop: (id: string, d: string) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  const max = phone ? 3 : 3;
  const dow = days.slice(0, 7).map((d) => fmtD(d, { weekday: phone ? "narrow" : "short" }));
  return (
    <div style={{ flex: phone ? "none" : 1, minWidth: 0, display: "flex", flexDirection: "column", border: `1px solid ${V.bd}`, borderRadius: 14, overflow: "hidden", height: phone ? 380 : undefined }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderBottom: `1px solid ${V.bd}` }}>{dow.map((d, i) => <span key={i} style={{ padding: "8px 10px", fontSize: 11.5, color: V.mu, fontWeight: 600 }}>{d}</span>)}</div>
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(7,1fr)", gridAutoRows: "1fr", minHeight: 0 }}>
        {days.map((d) => {
          const inM = Number(d.slice(5, 7)) === month + 1;
          const isT = d === today, isS = d === sel;
          const evs = (perDay.get(d) ?? []).filter((x) => x.kind !== "suggested");
          const rv = reviews.get(d) ?? 0;
          return (
            <div key={d} onClick={() => onSel(d)} onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-lumen-cal")) { e.preventDefault(); setOver(d); } }} onDragLeave={() => setOver((o) => (o === d ? null : o))}
              onDrop={(e) => { const id = e.dataTransfer.getData("application/x-lumen-cal"); setOver(null); if (id) { e.preventDefault(); onDrop(id, d); } }}
              style={{ borderInlineEnd: `1px solid color-mix(in srgb,var(--border) 60%,transparent)`, borderBottom: `1px solid color-mix(in srgb,var(--border) 60%,transparent)`, padding: 6, display: "flex", flexDirection: "column", gap: 3, minWidth: 0, background: over === d ? "color-mix(in srgb,var(--accent) 10%,transparent)" : isS && !isT ? "color-mix(in srgb,var(--surface-2) 70%,transparent)" : inM ? "transparent" : "color-mix(in srgb,var(--surface) 60%,transparent)", overflow: "hidden", cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: isT ? 700 : 500, background: isT ? V.ac : "transparent", color: isT ? V.af : inM ? V.tx : V.mu }}>{fmtNum(Number(d.slice(8)))}</span>
                <span style={{ flex: 1 }} />
                {!phone && rv > 0 && inM && <span style={{ fontSize: 10.5, color: V.wa, fontVariantNumeric: "tabular-nums" }}>{t("{n} due", { n: rv })}</span>}
              </div>
              {phone ? evs.slice(0, 3).map((x) => <div key={x.id} style={{ height: 4, borderRadius: 5, background: x.color === "var(--text)" ? V.mu : x.color }} />)
                : evs.slice(0, max).map((x) => {
                  const ms = x.kind === "milestone";
                  const c = x.color === "var(--text)" ? V.mu : x.color;
                  const drag = x.noteId != null && x.line != null && !ms && (x.kind !== "item" || (!!x.planItem && x.planItem.src !== "module"));
                  return (
                    <div key={x.id} draggable={drag} onDragStart={(e) => { e.dataTransfer.setData("application/x-lumen-cal", x.id); e.dataTransfer.effectAllowed = "move"; }}
                      onClick={(e) => { e.stopPropagation(); onItem(x, e.currentTarget); }} title={x.title}
                      style={{ display: "flex", alignItems: "center", gap: 5, height: 20, padding: "0 6px", borderRadius: 5, background: ms ? "transparent" : tint(c), borderInlineStart: `2px solid ${c}`, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", color: ms ? c : x.late ? V.da : V.tx, fontWeight: ms ? 650 : 500, flexShrink: 0, textDecoration: x.done ? "line-through" : undefined, opacity: x.done ? 0.6 : 1 }}>
                      {x.start != null && <span style={{ color: V.mu }}>{hhmm(x.start)}</span>}<span dir="auto" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{(ms ? "◆ " : "") + x.title}</span>
                    </div>
                  );
                })}
              {!phone && evs.length > max && <span style={{ fontSize: 10.5, color: V.mu, paddingInlineStart: 4 }}>{t("+{n} more", { n: evs.length - max })}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayAgenda({ day, items, reviews, today, onItem, onAdd, compact }: { day: string; items: CalItem[]; reviews: number; today: string; onItem: (it: CalItem, el: HTMLElement) => void; onAdd?: () => void; compact?: boolean }) {
  const list = items.filter((x) => x.kind !== "suggested");
  if (compact && !list.length && !reviews) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: compact ? 0 : 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <b style={{ fontSize: 13.5, fontWeight: 650, color: day === today ? V.ac : V.tx }}>{longDay(day)}{day === today ? ` · ${t("today")}` : ""}</b>
        <span style={{ flex: 1 }} />
        {reviews > 0 && <span style={{ fontSize: 11.5, color: V.wa }}>{t("{n} reviews", { n: reviews })}</span>}
        {onAdd && <button onClick={onAdd} style={{ fontSize: 12, color: V.ac }}>{t("+ Add")}</button>}
      </div>
      {!list.length && <span style={{ fontSize: 12.5, color: V.mu }}>{t("Nothing planned.")}</span>}
      {list.map((x) => {
        const c = x.color === "var(--text)" ? V.mu : x.color;
        return (
          <button key={x.id} onClick={(e) => onItem(x, e.currentTarget)} className="hover:brightness-110" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 9, background: x.kind === "milestone" ? "transparent" : `color-mix(in srgb,${c} 8%,transparent)`, borderInlineStart: `3px solid ${c}`, textAlign: "start", opacity: x.done ? 0.55 : 1 }}>
            <span style={{ width: 44, fontSize: 11.5, color: V.mu, fontVariantNumeric: "tabular-nums" }}>{x.start != null ? hhmm(x.start) : x.kind === "milestone" ? "◆" : t("all day")}</span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
              <span dir="auto" style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: x.done ? "line-through" : undefined, color: x.late ? V.da : undefined }}>{x.title}</span>
              {x.sub && <span dir="auto" style={{ fontSize: 11, color: V.mu }}>{x.sub}{x.dur && x.start != null ? ` · ${durLabel(x.dur)}` : ""}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
