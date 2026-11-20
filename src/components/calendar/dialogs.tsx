// Calendar dialogs (round 8, page 55): the item popover (Start · Open · Done · Move · Remove) and the "+ Schedule"
// sheet that adds a study block or an event to the Calendar note.
import { useState } from "react";
import { Glyph } from "../Glyph";
import { Sheet } from "../ui";
import { durLabel, shiftDay, type CalItem } from "../../lib/calendar";
import { addBlocks } from "../../lib/calendar-store";
import type { CalPlan } from "../../lib/calendar-plans";
import type { CalTask } from "../../lib/calendar-tasks";
import { db } from "../../lib/db";
import { openNote, toast } from "../../lib/store";
import { openNoteAtLine } from "../study-nav";
import { moveItem, removeCalLine, setBlockDone, setPlanItemStatus, startItem, toggleTask } from "./actions";
import { hhmm, longDay, MItem, Pop, V } from "./parts";
import { t } from "../../lib/i18n";

export function ItemPop({ it, anchor, onClose, today, tasks, plan, byTitle }: { it: CalItem; anchor: HTMLElement; onClose: () => void; today: string; tasks: CalTask[]; plan?: CalPlan; byTitle: Map<string, { id: string }> }) {
  const run = (f: () => void) => () => { onClose(); f(); };
  const task = it.kind === "task" ? tasks.find((x) => `task:${x.key}` === it.id) : undefined;
  const when = `${longDay(it.date)}${it.start != null ? ` · ${hhmm(it.start)} – ${hhmm(it.start + (it.dur || 30))}` : ""}`;
  const kind = it.kind === "milestone" ? t("Milestone") : it.kind === "block" ? t("Study block") : it.kind === "event" ? t("Event") : it.kind === "task" ? t("Task") : it.kind === "item" ? t("Plan item") : t("Suggested");
  return (
    <Pop anchor={anchor} onClose={onClose} width={260}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "6px 8px 8px", borderBottom: `1px solid ${V.bd}`, marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 650, letterSpacing: ".06em", color: it.color === "var(--text)" ? V.mu : it.color, textTransform: "uppercase" }}>{kind}</span>
        <b dir="auto" style={{ fontSize: 13.5, fontWeight: 650 }}>{it.title}</b>
        <span style={{ fontSize: 12, color: V.mu }}>{when}{it.dur && it.start == null ? ` · ${durLabel(it.dur)}` : ""}</span>
        {it.sub && <span dir="auto" style={{ fontSize: 12, color: V.mu }}>{it.sub}</span>}
      </div>
      {it.kind !== "milestone" && it.kind !== "item" && <MItem onClick={run(() => startItem(it, { byTitle, plan }))}><Glyph name="play" size={14} />{t("Start focus")}</MItem>}
      {it.noteId && it.kind !== "block" && it.kind !== "event" && <MItem onClick={run(() => { if (it.line != null) void db.notes.get(it.noteId!).then((n) => openNoteAtLine(it.noteId!, it.line!, n?.body)); else openNote(it.noteId!); })}><Glyph name="note" size={14} />{t("Open note")}</MItem>}
      {(it.kind === "block" || task) && <MItem onClick={run(() => { if (task) void toggleTask(task, today); else void setBlockDone(it, !it.done); })}><Glyph name="check" size={14} />{it.done ? t("Mark not done") : t("Mark done")}</MItem>}
      {it.kind === "item" && it.planItem && it.planItem.src !== "module" && <MItem onClick={run(() => void setPlanItemStatus(it, it.done ? "todo" : "done"))}><Glyph name="check" size={14} />{it.done ? t("Mark not done") : t("Mark done")}</MItem>}
      {it.noteId && it.line != null && (it.kind !== "item" || it.planItem?.src !== "module") && <MItem onClick={run(() => { void moveItem(it, shiftDay(it.date < today ? today : it.date, 1), it.start); toast(t("Moved to the next day")); })}><Glyph name="calendar" size={14} />{t("Move to the next day")}</MItem>}
      {(it.kind === "block" || it.kind === "event") && <MItem danger onClick={run(() => void removeCalLine(it))}><Glyph name="trash" size={14} />{t("Remove from calendar")}</MItem>}
    </Pop>
  );
}

export interface ScheduleInit { date: string; start: number | null; planId?: string | null }
export function ScheduleSheet({ init, plans, onClose }: { init: ScheduleInit | null; plans: CalPlan[]; onClose: () => void }) {
  return (
    <Sheet open={!!init} onClose={onClose} title={t("Schedule")}>
      {init && <ScheduleForm init={init} plans={plans} onClose={onClose} />}
    </Sheet>
  );
}
function ScheduleForm({ init, plans, onClose }: { init: ScheduleInit; plans: CalPlan[]; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(init.date);
  const [start, setStart] = useState(hhmm(init.start ?? 10 * 60));
  const [dur, setDur] = useState(60);
  const [plan, setPlan] = useState<string>(init.planId ?? plans[0]?.id ?? "");
  const p = plans.find((x) => x.id === plan);
  const inp = "h-9 w-full rounded-[8px] border border-line bg-bg px-2.5 text-ink focus:border-accent focus:outline-none [color-scheme:light_dark]";
  const save = async () => {
    const [h, m] = start.split(":").map(Number);
    await addBlocks([{ title: title.trim() || p?.next[0]?.title || p?.title || t("Study"), date, start: h * 60 + m, dur, plan: p?.title ?? null, event: !p }]);
    toast(p ? t("Study block added") : t("Event added"));
    onClose();
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={{ color: V.mu, fontSize: 12 }}>{t("Title")}</span><input autoFocus dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={p?.next[0]?.title ?? t("What will you do?")} className={inp} /></label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={{ color: V.mu, fontSize: 12 }}>{t("Calendar")}</span>
        <select value={plan} onChange={(e) => setPlan(e.target.value)} className={inp}>
          {plans.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          <option value="">{t("Event (not study)")}</option>
        </select>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 8 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={{ color: V.mu, fontSize: 12 }}>{t("Date")}</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} /></label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={{ color: V.mu, fontSize: 12 }}>{t("Start")}</span><input type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} className={inp} /></label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={{ color: V.mu, fontSize: 12 }}>{t("Length")}</span>
          <select value={dur} onChange={(e) => setDur(Number(e.target.value))} className={inp}>{[15, 30, 45, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{durLabel(m)}</option>)}</select>
        </label>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" onClick={onClose} style={{ height: 34, padding: "0 14px", borderRadius: 9, border: `1px solid ${V.bd}` }}>{t("Cancel")}</button>
        <button type="submit" style={{ height: 34, padding: "0 14px", borderRadius: 9, background: V.ac, color: V.af, fontWeight: 650 }}>{t("Add to calendar")}</button>
      </div>
    </form>
  );
}
