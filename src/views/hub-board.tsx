// Project hub · Board (design round 4: HubDesk "board", Lumen 15 R4-15L / 15R; task card anatomy).
// Cards = checkbox lines in any note of the project; dragging a card to a column writes the marker back
// ([>] [ ] [/] [?] [x] [-]). Phone: one column per screen, swipe between them.
import { useMemo, useState, type DragEvent } from "react";
import type { Note, Space } from "../../shared/types";
import { updateNote } from "../lib/actions";
import { CARD_COLUMNS, initials, setCardStatus, type CardStatus, type TaskCard } from "../lib/project";
import { Glyph } from "../components/Glyph";
import { cx } from "../components/ui";
import { openNoteAtLine } from "../components/study-nav";
import { addTask, cardDay, menuRow, Popover, TaskGlyph, todayISO } from "./hub-parts";

const PRIO: Record<1 | 2 | 3, string> = { 1: "var(--danger)", 2: "var(--warning)", 3: "var(--muted)" };
const fmtEst = (d: number) => `~${Math.round(d * 10) / 10}d`;

/** Glyph chips: priority, estimate, due (red when late), requirement ids; then owner, #epic/…, source note. */
export function TaskCardView({ c, drag, onDragStart, onDragEnd, dragging }: { c: TaskCard; drag?: boolean; onDragStart?: (e: DragEvent) => void; onDragEnd?: () => void; dragging?: boolean }) {
  const today = todayISO();
  const late = !!c.due && c.status !== "done" && c.status !== "cancelled" && c.due < today;
  const chip = "inline-flex items-center gap-[3px] rounded-[5px] px-[5px] leading-[18px]";
  return (
    <div draggable={drag} onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={() => openNoteAtLine(c.note.id, c.line)} data-card={c.key}
      title={`${c.text}\nfrom ${c.note.title}`}
      className={cx("flex cursor-pointer flex-col gap-[7px] rounded-[10px] border border-transparent bg-surface-2 p-2.5 text-[13px] hover:border-line", dragging && "opacity-40")}>
      <span dir="auto" className={cx("font-medium leading-[18px]", c.status === "done" && "text-muted", c.status === "cancelled" && "text-muted line-through")}>{c.text}</span>
      {(c.priority || c.estimate || c.due || c.reqs.length > 0) && (
        <div className="flex flex-wrap gap-1 text-[11px]">
          {c.priority && <span className={chip} style={{ background: `color-mix(in srgb, ${PRIO[c.priority]} 14%, transparent)`, color: PRIO[c.priority] }}><Glyph name={`p${c.priority}` as "p1"} size={11} />p{c.priority}</span>}
          {c.estimate && <span className={cx(chip, "bg-bg text-muted")}><Glyph name="estimate" size={11} />{c.estimate}</span>}
          {c.due && <span className={cx(chip, "bg-bg")} style={{ color: late ? "var(--danger)" : "var(--muted)" }} title={`Due ${c.due}${c.start ? ` · start ${c.start}` : ""}`}><Glyph name="due" size={11} />{cardDay(c.due, today)}</span>}
          {c.reqs.map((r) => <span key={r} className={cx(chip, "font-mono")} style={{ background: "color-mix(in srgb, var(--info) 14%, transparent)", color: "var(--info)" }}>{r}</span>)}
        </div>
      )}
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        {c.owner && <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-bg text-[9px] font-semibold text-ink" title={`@${c.owner}`}>{initials(c.owner)}</span>}
        <span className="min-w-0 flex-1 truncate">{c.epic ? `#epic/${c.epic}` : ""}</span>
        <Glyph name="note" size={11} title={c.note.title} />
      </div>
    </div>
  );
}

/** Ghost for a dragged card (design: the lifted card tilts 2° with an accent border and a deep shadow). */
function cardGhost(e: DragEvent) {
  const src = e.currentTarget as HTMLElement;
  const wrap = document.createElement("div");
  wrap.style.cssText = `position:fixed;top:-600px;left:-600px;padding:20px;width:${src.offsetWidth + 40}px;pointer-events:none`;
  const g = src.cloneNode(true) as HTMLElement;
  g.style.cssText = "transform:rotate(2deg);border:1px solid var(--accent);box-shadow:0 14px 30px rgba(0,0,0,.4);background:var(--surface-2)";
  wrap.appendChild(g);
  document.body.appendChild(wrap);
  try { e.dataTransfer.setDragImage(wrap, 40, 30); } catch { /* unsupported */ }
  setTimeout(() => wrap.remove(), 0);
}

export function Board({ sp, cards, notes, phone }: { sp: Space; cards: TaskCard[]; notes: Note[]; phone: boolean }) {
  const [over, setOver] = useState<CardStatus | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [filter, setFilter] = useState<{ k: "epic" | "owner" | "prio"; v: string } | null>(() => { try { return JSON.parse(localStorage.getItem(`lumen.hub.filter.${sp.id}`) || "null"); } catch { return null; } });
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState<CardStatus | null>(null);
  const setF = (f: typeof filter) => { setFilter(f); try { localStorage.setItem(`lumen.hub.filter.${sp.id}`, JSON.stringify(f)); } catch { /* private */ } setMenu(false); };
  const epics = useMemo(() => [...new Set(cards.map((c) => c.epic).filter((e): e is string => !!e))].sort(), [cards]);
  const owners = useMemo(() => [...new Set(cards.map((c) => c.owner).filter((e): e is string => !!e))].sort(), [cards]);
  const shown = cards.filter((c) => !filter || (filter.k === "epic" ? c.epic === filter.v : filter.k === "owner" ? c.owner === filter.v : String(c.priority) === filter.v));
  const est = shown.filter((c) => c.status !== "done" && c.status !== "cancelled").reduce((a, c) => a + c.estDays, 0);
  async function drop(e: DragEvent, s: CardStatus) {
    e.preventDefault(); setOver(null); setDrag(null);
    const c = cards.find((x) => x.key === e.dataTransfer.getData("text/lumen-card"));
    if (c && c.status !== s) await updateNote(c.note.id, { body: setCardStatus(c.note.body, c.line, s) });
  }
  const label = filter ? (filter.k === "epic" ? `Epic: ${filter.v}` : filter.k === "owner" ? `Owner: @${filter.v}` : `Priority: p${filter.v}`) : null;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {label && (
          <span className="flex h-7 items-center gap-1.5 rounded-[6px] bg-surface-2 pl-2.5 pr-1.5">
            <Glyph name={filter!.k === "epic" ? "epic" : filter!.k === "owner" ? "owner" : "p1"} size={14} color="var(--muted)" />{label}
            <button aria-label="Clear filter" onClick={() => setF(null)} className="flex size-5 items-center justify-center rounded text-muted hover:text-ink"><Glyph name="x" size={12} /></button>
          </span>
        )}
        <span className="relative">
          <button onClick={() => setMenu((x) => !x)} className="flex h-7 items-center rounded-[6px] border border-dashed border-line px-2.5 text-muted hover:text-ink">+ Filter</button>
          {menu && (
            <Popover onClose={() => setMenu(false)} className="left-0 top-full mt-1 max-h-[340px] w-56 overflow-y-auto">
              {epics.length > 0 && <span className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Epic</span>}
              {epics.map((e) => <button key={e} className={menuRow} onClick={() => setF({ k: "epic", v: e })}><Glyph name="epic" size={14} color="var(--muted)" />{e}</button>)}
              {owners.length > 0 && <span className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Owner</span>}
              {owners.map((o) => <button key={o} className={menuRow} onClick={() => setF({ k: "owner", v: o })}><Glyph name="owner" size={14} color="var(--muted)" />@{o}</button>)}
              <span className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Priority</span>
              {(["1", "2", "3"] as const).map((p) => <button key={p} className={menuRow} onClick={() => setF({ k: "prio", v: p })}><Glyph name={`p${p}` as "p1"} size={14} color={PRIO[Number(p) as 1]} />p{p}</button>)}
            </Popover>
          )}
        </span>
        <span className="flex-1" />
        <span className="text-muted">{shown.length} cards{est ? ` · ${fmtEst(est)}` : ""}</span>
      </div>
      <div className={cx("min-h-0 flex-1 gap-2.5", phone ? "flex snap-x snap-mandatory overflow-x-auto" : "grid grid-cols-6 overflow-hidden")}>
        {CARD_COLUMNS.map((col) => {
          const items = shown.filter((c) => c.status === col.s).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || (a.due ?? "9").localeCompare(b.due ?? "9"));
          const colEst = items.reduce((a, c) => a + c.estDays, 0);
          return (
            <section key={col.s} data-col={col.s} onDragOver={(e) => { if (!e.dataTransfer.types.includes("text/lumen-card")) return; e.preventDefault(); setOver(col.s); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }} onDrop={(e) => drop(e, col.s)}
              className={cx("flex min-w-0 flex-col gap-2 overflow-y-auto rounded-[12px] bg-surface p-2", phone && "w-full shrink-0 snap-start")}
              style={{ boxShadow: over === col.s ? "inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 60%, transparent)" : undefined }}>
              <div className="flex items-center gap-1.5 whitespace-nowrap px-1 pb-0.5 pt-1 font-semibold">
                <TaskGlyph s={col.s} />{col.label}<span className="font-normal text-muted">{items.length}</span>
                <span className="flex-1" /><span className="text-[11px] font-normal text-muted">{colEst && col.s !== "done" && col.s !== "cancelled" && col.s !== "backlog" ? fmtEst(colEst) : ""}</span>
              </div>
              {items.map((c) => <TaskCardView key={c.key} c={c} drag dragging={drag === c.key}
                onDragStart={(e) => { e.dataTransfer.setData("text/lumen-card", c.key); e.dataTransfer.effectAllowed = "move"; cardGhost(e); setDrag(c.key); }} onDragEnd={() => { setDrag(null); setOver(null); }} />)}
              {adding === col.s ? (
                <form className="px-1" onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get("t") ?? ""); void addTask(sp, notes, v, col.s); e.currentTarget.reset(); }}>
                  <input name="t" autoFocus onBlur={(e) => !e.target.value && setAdding(null)} onKeyDown={(e) => e.key === "Escape" && setAdding(null)} placeholder="Task !p1 ~2d due:2026-12-01 #epic/x" aria-label={`Add to ${col.label}`}
                    className="h-8 w-full rounded-[8px] border border-line bg-bg px-2 text-[12.5px] outline-none focus:border-accent" dir="auto" />
                </form>
              ) : <button onClick={() => setAdding(col.s)} className="self-start px-1.5 py-1 text-muted hover:text-ink">+ Add</button>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
