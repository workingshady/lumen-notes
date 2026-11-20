// Project hub · Requirements (MoSCoW + traceability), Timeline (Gantt from cards), Diagrams
// (design round 4: HubDesk "req" / "timeline" / "diagrams", Lumen 15 R4-15M…O, phone 15S / 15U).
import { useMemo, useState } from "react";
import type { Note, Space } from "../../shared/types";
import { createNote } from "../lib/actions";
import { epicMermaid, ganttRows, MOSCOW, traceMermaid, type Requirement, type TaskCard } from "../lib/project";
import { openNote, toast } from "../lib/store";
import { Glyph } from "../components/Glyph";
import { cx, relTime } from "../components/ui";
import { openNoteAtLine } from "../components/study-nav";
import { monDay, TaskGlyph, todayISO } from "./hub-parts";
import { fmtDate, fmtNum, t as tr, tk, tx } from "../lib/i18n";
import { arrow } from "../lib/prereq-graph";
import { isWbType } from "../../shared/types";

// ------------------------------------------------------------------ requirements
export const REQ_STATE = { met: [tk("Met"), "var(--success)"], progress: [tk("In progress"), "var(--info)"], planned: [tk("Planned"), "var(--muted)"], none: [tk("No tasks"), "var(--warning)"] } as const;
export function Requirements({ reqs, phone }: { reqs: Requirement[]; phone: boolean }) {
  const cols = phone ? "1.6fr .7fr 1fr" : "2.2fr .8fr 1.2fr 1fr";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {MOSCOW.map((m) => {
          const rs = reqs.filter((r) => r.priority === m.k);
          const met = rs.filter((r) => r.state === "met").length;
          return (
            <div key={m.k} className="flex min-w-[110px] flex-1 flex-col gap-0.5 rounded-[10px] border border-line bg-surface px-3 py-2.5">
              <span className="text-[12px] text-muted">{tr(m.label)}</span>
              <span className="text-[20px] font-[650]">{fmtNum(rs.length)}{m.k === "must" && rs.length ? ` · ${tr("{n} met", { n: met })}` : ""}</span>
            </div>
          );
        })}
      </div>
      {reqs.length ? (
        <div className="overflow-hidden rounded-[12px] border border-line">
          <div className="grid h-[34px] items-center bg-surface text-[12px] font-semibold text-muted" style={{ gridTemplateColumns: cols }}>
            <span className="px-3">{tr("Requirement")}</span><span className="px-3">{tr("Priority")}</span>{!phone && <span className="px-3">{tr("Tasks")}</span>}<span className="px-3">{tr("Status")}</span>
          </div>
          {reqs.map((r) => {
            const m = MOSCOW.find((x) => x.k === r.priority);
            const [sl, sc] = REQ_STATE[r.state];
            return (
              <button key={r.id} onClick={() => openNoteAtLine(r.doc.id, r.line)} title={tr("From {name}", { name: r.doc.title })} className="grid min-h-[44px] w-full items-center border-t border-line text-start hover:bg-surface/60" style={{ gridTemplateColumns: cols }}>
                <span className="flex min-w-0 flex-col gap-0.5 px-3 py-1.5"><span className="font-mono text-[11.5px] font-medium text-[var(--info)]">{r.id}</span><span dir="auto" className="min-w-0">{r.text}</span></span>
                <span className="px-3 text-[12px] font-semibold" style={{ color: m?.color ?? "var(--muted)" }}>{m ? tr(m.label) : "—"}</span>
                {!phone && (
                  <span className="flex flex-wrap items-center gap-1 px-3" title={r.tasks.map((t) => `${t.status}: ${t.text}`).join("\n")}>
                    {r.tasks.slice(0, 8).map((t) => <TaskGlyph key={t.key} s={t.status} size={14} />)}
                    <span className="ms-1 text-[12px] text-muted">{r.tasks.length ? tr("{n} task|{n} tasks", { n: r.tasks.length }) : "—"}</span>
                  </span>
                )}
                <span className="px-3"><span className="inline-flex items-center rounded-full px-2 text-[12px] font-medium leading-[22px]" style={{ background: `color-mix(in srgb, ${sc} 14%, transparent)`, color: sc }}>{tr(sl)}</span></span>
              </button>
            );
          })}
        </div>
      ) : <div className="rounded-[12px] border border-dashed border-line p-8 text-center text-muted">{tx("No requirements yet. Write them as {code} in any doc, or use New requirement. Link tasks by writing the id in the task.", { code: <code dir="ltr">- REQ-1 (must) …</code> })}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ timeline (Gantt)
const DAYMS = 86400000;
const at = (d: string) => Date.parse(d + "T00:00:00");
export function Gantt({ cards, phone }: { cards: TaskCard[]; phone: boolean }) {
  const today = todayISO();
  const rows = useMemo(() => ganttRows(cards, today), [cards, today]);
  const undated = cards.filter((c) => !c.due && c.status !== "cancelled" && c.status !== "done").length;
  const L = phone ? 130 : 240;
  if (!rows.length) return <div className="rounded-[12px] border border-dashed border-line p-8 text-center text-muted">{tx("Give cards a due date ({due}) and an estimate ({est}) to see them here, grouped by {epic}.", { due: <code dir="ltr">due:2026-12-01</code>, est: <code dir="ltr">~3d</code>, epic: <code dir="ltr">#epic/…</code> })}</div>;
  const lo0 = Math.min(at(today), ...rows.map((r) => at(r.start)));
  const lo = lo0 - ((new Date(lo0).getDay() + 6) % 7) * DAYMS; // Monday
  const hi0 = Math.max(at(today) + 7 * DAYMS, ...rows.map((r) => at(r.end) + DAYMS));
  const weeks = Math.max(4, Math.ceil((hi0 - lo) / (7 * DAYMS)));
  const hi = lo + weeks * 7 * DAYMS;
  const pct = (t: number) => `${((t - lo) / (hi - lo)) * 100}%`;
  const ticks = Array.from({ length: weeks }, (_, i) => { const d = new Date(lo + i * 7 * DAYMS); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  const step = Math.ceil(weeks / (phone ? 4 : 8));
  return (
    <div className="flex min-h-full flex-col">
      <div className="grid h-[30px] items-center border-b border-line text-[12px] text-muted" style={{ gridTemplateColumns: `${L}px 1fr` }}>
        <span>{tr("Epic / task")}</span>
        <div className="relative h-full">{ticks.map((t, i) => i % step === 0 && <span key={t} className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap" style={{ insetInlineStart: pct(at(t)) }}>{monDay(t)}</span>)}</div>
      </div>
      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-y-0 end-0" style={{ insetInlineStart: L }}><div className="absolute inset-y-0 w-0.5 bg-accent" style={{ insetInlineStart: pct(at(today)) }} title={tr("Today")} /></div>
        {rows.map((r, i) => {
          const epic = r.kind === "epic";
          const s = r.card?.status;
          const fill = epic ? "var(--surface-2)" : s === "done" ? "color-mix(in srgb, var(--success) 30%, var(--surface))" : s === "doing" || s === "review" ? "color-mix(in srgb, var(--info) 30%, var(--surface))" : "var(--surface)";
          return (
            <div key={i} className="grid h-10 items-center border-b" style={{ gridTemplateColumns: `${L}px 1fr`, borderColor: "color-mix(in srgb, var(--border) 60%, transparent)" }}>
              <button disabled={epic} onClick={() => r.card && openNoteAtLine(r.card.note.id, r.card.line)} className={cx("flex min-w-0 items-center gap-2 whitespace-nowrap text-start", epic ? "font-semibold" : "ps-[18px] font-[450] hover:underline")}>
                {epic ? <Glyph name="epic" size={14} /> : <TaskGlyph s={s!} size={14} />}<span className="truncate" dir="auto">{r.label}</span>
              </button>
              <div className="relative h-full">
                <span title={`${fmtDate(r.start + "T00:00:00")}${arrow()}${fmtDate(r.end + "T00:00:00")}`} className="absolute rounded-[6px] border" style={{ insetInlineStart: pct(at(r.start)), width: `max(6px, ${((at(r.end) + DAYMS - at(r.start)) / (hi - lo)) * 100}%)`, top: epic ? 15 : 11, height: epic ? 10 : 18, background: fill, borderColor: r.late ? "var(--danger)" : "var(--border)" }} />
              </div>
            </div>
          );
        })}
      </div>
      {undated > 0 && <p className="pt-3 text-[12px] text-muted">{tr("{n} open card without a due date isn't shown.|{n} open cards without a due date aren't shown.", { n: undated })}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ diagrams
const EPIC_COLORS = ["#39C5CF", "#57AB5A", "#E8893A", "#A371F7", "#E3B341", "#E5534B", "#7AA2F7"];
export function diagramNotes(notes: Note[]) { return notes.filter((n) => !n.deleted && (n.type === "canvas" || isWbType(n.type) || n.type === "diagram" || /```mermaid/.test(n.body))); }
async function saveMermaid(sp: Space, title: string, code: string) {
  const n = await createNote({ title: `${title}: ${sp.name}`, body: `# ${title}: ${sp.name}\n\nGenerated ${new Date().toLocaleDateString()}. Edit freely.\n\n\`\`\`mermaid\n${code}\n\`\`\`\n`, spaceId: sp.id, fm: { doc: "spec", docstatus: "draft" } });
  openNote(n.id);
}
function CardActions({ sp, title, code }: { sp: Space; title: string; code: string | null }) {
  if (!code) return null;
  return (
    <span className="ms-auto flex gap-1 text-[12px] font-normal">
      <button className="rounded-[6px] px-2 py-0.5 text-muted hover:bg-surface-2 hover:text-ink" onClick={() => { void navigator.clipboard?.writeText("```mermaid\n" + code + "\n```"); toast(tr("Mermaid copied")); }}>{tr("Copy Mermaid")}</button>
      <button className="rounded-[6px] px-2 py-0.5 text-muted hover:bg-surface-2 hover:text-ink" onClick={() => void saveMermaid(sp, title, code)}>{tr("Save as doc")}</button>
    </span>
  );
}
export function Diagrams({ sp, cards, reqs, notes, phone }: { sp: Space; cards: TaskCard[]; reqs: Requirement[]; notes: Note[]; phone: boolean }) {
  const [allReqs, setAllReqs] = useState(false);
  const epics = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) if (c.status !== "cancelled") m.set(c.epic ?? "general", (m.get(c.epic ?? "general") ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [cards]);
  const list = diagramNotes(notes);
  // the ones that need attention first: must-haves, then anything not met yet
  const ranked = [...reqs].sort((a, b) => Number(a.state === "met") - Number(b.state === "met") || Number(b.priority === "must") - Number(a.priority === "must"));
  const shownReqs = allReqs ? reqs : ranked.slice(0, 3);
  return (
    <div className="flex flex-col gap-3.5">
      <div className={cx("grid content-start gap-3.5", phone ? "grid-cols-1" : "grid-cols-[1.2fr_1fr]")}>
        <section className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-3.5">
          <span className="flex items-center gap-2 font-semibold"><Glyph name="mermaid" size={16} />{tr("Requirements → tasks")}<CardActions sp={sp} title={tr("Requirements → tasks")} code={traceMermaid(reqs)} /></span>
          {reqs.length ? (
            <div className="grid grid-cols-2 gap-x-[30px] gap-y-2 text-[12px]">
              {shownReqs.flatMap((r) => {
                const t = r.tasks[0];
                const tb = !t ? "var(--warning)" : t.status === "done" ? "var(--success)" : t.status === "doing" || t.status === "review" ? "var(--info)" : "var(--border)";
                return [
                  <button key={r.id} onClick={() => openNoteAtLine(r.doc.id, r.line)} className="truncate whitespace-nowrap rounded-[7px] border bg-bg px-2.5 py-1.5 text-start" style={{ borderColor: r.state === "none" ? "var(--warning)" : "var(--info)" }} title={r.text}>{r.id} {r.text}</button>,
                  t ? <button key={r.id + "t"} onClick={() => openNoteAtLine(t.note.id, t.line)} className="truncate whitespace-nowrap rounded-[7px] border bg-bg px-2.5 py-1.5 text-start" style={{ borderColor: tb }} title={r.tasks.map((x) => x.text).join("\n")}>{t.text}{r.tasks.length > 1 ? ` +${fmtNum(r.tasks.length - 1)}` : ""}</button>
                    : <span key={r.id + "t"} className="truncate whitespace-nowrap rounded-[7px] border bg-bg px-2.5 py-1.5" style={{ borderColor: tb }}>{tr("no tasks yet")}</span>,
                ];
              })}
            </div>
          ) : <span className="text-muted">{tr("No requirements yet.")}</span>}
          {reqs.length > 3 && <button onClick={() => setAllReqs((x) => !x)} className="self-start text-[12px] text-muted hover:text-ink">{allReqs ? tr("Show fewer") : tr("Show all {n}", { n: reqs.length })}</button>}
        </section>
        <section className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-3.5">
          <span className="flex items-center gap-2 font-semibold"><Glyph name="moc" size={16} />{tr("Epic mind map")}<CardActions sp={sp} title={tr("Epic breakdown")} code={epicMermaid(cards, sp.name)} /></span>
          {epics.length ? (
            <div className="flex items-center gap-4">
              <span className="shrink-0 rounded-full bg-surface-2 px-3 py-2 font-semibold" dir="auto">{sp.name.length > 22 ? sp.name.slice(0, 20) + "…" : sp.name}</span>
              <div className="flex min-w-0 flex-col gap-1.5 border-s-[1.5px] border-muted ps-3">
                {epics.map(([e, n], i) => <span key={e} className="flex items-center gap-2"><span className="size-2 shrink-0 rounded-[2px]" style={{ background: EPIC_COLORS[i % EPIC_COLORS.length] }} />{e === "general" ? tr("No epic") : <bdi>#epic/{e}</bdi>}<span className="text-[12px] text-muted">{fmtNum(n)}</span></span>)}
              </div>
            </div>
          ) : <span className="text-muted">{tr("No task cards yet.")}</span>}
        </section>
      </div>
      <section className="flex flex-col rounded-[14px] border border-line bg-surface px-4 py-3">
        <span className="pb-1.5 font-semibold">{tr("Diagrams in this project")}</span>
        {list.length ? list.map((n) => (
          <button key={n.id} onClick={() => openNote(n.id)} className="flex min-h-9 items-center gap-2.5 border-t border-line text-start hover:text-ink">
            <Glyph name={n.type === "canvas" ? "canvas" : isWbType(n.type) ? "whiteboard" : n.type === "diagram" ? "diagram" : "mermaid"} size={16} color="var(--muted)" />
            <span className="min-w-0 flex-1 truncate" dir="auto">{n.title}</span><span className="text-[12px] text-muted">{relTime(n.updatedAt)}</span>
          </button>
        )) : <span className="border-t border-line py-2 text-muted">{tr("No Mermaid diagrams, canvases or whiteboards yet. PRD, RFC and spec templates include Mermaid starters.")}</span>}
      </section>
    </div>
  );
}
