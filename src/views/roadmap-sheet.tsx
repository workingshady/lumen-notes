// Topic sheet (design round 4: RoadmapDesk sheet, Lumen 15 R4-15G): status, due, prerequisites and the linked note in
// one place; "Organize" holds the rarely used actions; delete confirms inline in the sheet. Phone: peek sheet that
// expands to the same sections.
import { useEffect, useRef, useState } from "react";
import { flashcards, moveTopic, nudgeTopic, setTopicDue, setTopicNeeds, type Module, type Topic, type TopicStatus } from "../lib/parse";
import { useVault } from "../lib/store";
import { Glyph } from "../components/Glyph";
import { cx } from "../components/ui";
import { announce } from "./dnd-parts";
import { InlineConfirm, LinkNotePicker, StatusGlyph, STATUS_LABEL, finished } from "./roadmap-parts";
import { overdue, type TopicOps } from "./roadmap-outline";
import { ancestors } from "./roadmap-tree";
import { fmtDay, fmtLong } from "./spaces-util";

type SheetProps = { mods: Module[]; t: Topic; onClose: () => void; onSelect: (t: Topic) => void; ops: TopicOps; fresh: Set<string> };

function useEsc(onClose: () => void) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".pdnd-confirm")) onClose(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
}

/** Notes "in a topic": its linked lesson + notes in the space that link to it; cards = flashcards in those notes. */
function useTopicStats(t: Topic, spaceId: string | null) {
  const v = useVault();
  const linked = t.note ? v.byTitle.get(t.note.toLowerCase()) : undefined;
  if (!linked) return { notes: 0, cards: 0, linked };
  const needle = `[[${linked.title.toLowerCase()}`;
  const linking = v.notes.filter((n) => n.spaceId === spaceId && n.id !== linked.id && n.type !== "roadmap" && n.body.toLowerCase().includes(needle));
  const group = [linked, ...linking];
  return { notes: group.length, cards: group.reduce((s, n) => s + flashcards(n.body).length, 0), linked };
}

export function StatusSelector({ t, onStatus, tall }: { t: Topic; onStatus: (t: Topic, s: TopicStatus) => void; tall?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Status" className="grid grid-cols-4 gap-0.5 rounded-[10px] border border-line bg-bg p-[3px] text-[13px]">
      {(["todo", "learning", "done", "skipped"] as TopicStatus[]).map((s) => (
        <button key={s} role="radio" aria-checked={t.status === s} onClick={() => onStatus(t, s)}
          className={cx("flex items-center justify-center gap-1.5 rounded-[7px]", tall ? "h-[38px]" : "h-7", t.status === s ? "bg-surface font-semibold text-ink" : "text-muted hover:text-ink")}>
          {t.status === s && s !== "todo" && <StatusGlyph t={{ status: s, locked: false }} size={14} />}{STATUS_LABEL[s]}
        </button>
      ))}
    </div>
  );
}

/** Due / Needs / Note (+ Unlocks, In this topic) grid, then Organize. Shared by the desktop sheet and the expanded phone sheet. */
function SheetBody({ mods, t, onSelect, ops, fresh, phone, onRename }: SheetProps & { phone?: boolean; onRename: () => void }) {
  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState(false);
  const [org, setOrg] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const { body, write } = ops;
  const all = mods.flatMap((x) => x.topics);
  const byName = new Map(all.map((x) => [x.name.toLowerCase(), x]));
  const unlocks = all.filter((x) => x.needs.some((n) => n.toLowerCase() === t.name.toLowerCase()));
  const stats = useTopicStats(t, ops.spaceId);
  const candidates = all.filter((x) => x.line !== t.line && !t.needs.some((n) => n.toLowerCase() === x.name.toLowerCase()) && !ancestors(all, x).has(t.line));
  const setNeeds = (needs: string[]) => write(setTopicNeeds(body, t.line, needs));
  const nudge = (dir: -1 | 1) => { const md = nudgeTopic(body, t.line, dir); if (md !== body) { write(md); announce(`${t.name} moved ${dir < 0 ? "up" : "down"}`); } };
  const btn = cx("flex items-center gap-1.5 rounded-[8px] border border-line px-2.5 hover:bg-surface", phone ? "h-10" : "h-[30px]");
  const m = mods[t.module];
  return (
    <>
      <div className="grid grid-cols-[96px_1fr] items-center gap-2.5">
        <span className="text-muted">Due</span>
        <label className="relative flex h-[30px] cursor-pointer items-center gap-2 rounded-[6px] border border-line bg-bg px-2.5" title="Change due date">
          <Glyph name="due" size={14} color="var(--muted)" />
          <span className={cx(overdue(t) && "text-bad", !t.due && "text-muted")}>{t.due ? fmtLong(t.due) : m?.due ? `Module · ${fmtDay(m.due)}` : "Set date"}</span>
          <input type="date" aria-label="Due date" className="absolute inset-0 cursor-pointer opacity-0" value={t.due ?? ""} onChange={(e) => write(setTopicDue(body, t.line, e.target.value || null))} />
        </label>
        <span className="self-start pt-1 text-muted">Needs</span>
        <div className="flex flex-wrap gap-1.5">
          {t.needs.map((n) => {
            const d = byName.get(n.toLowerCase());
            const ok = finished(d);
            return (
              <span key={n} className="group flex h-[26px] items-center gap-1.5 rounded-[6px] px-2"
                style={ok ? { background: "color-mix(in srgb, var(--success) 12%, var(--surface))" } : { background: "var(--surface)", border: "1px solid var(--border)" }}>
                {d ? <StatusGlyph t={d} size={14} /> : <Glyph name="s-todo" size={14} color="var(--muted)" title="Not in this roadmap" />}
                <button onClick={() => d && onSelect(d)} className="hover:underline" dir="auto">{n}</button>
                <button aria-label={`Remove ${n}`} onClick={() => setNeeds(t.needs.filter((x) => x !== n))} className="hidden text-muted hover:text-ink group-hover:block"><Glyph name="x" size={12} /></button>
              </span>
            );
          })}
          {adding ? (
            <select autoFocus className="h-[26px] rounded-[6px] border border-line bg-bg px-1.5 text-[12.5px]" defaultValue="" onBlur={() => setAdding(false)}
              onChange={(e) => { if (e.target.value) setNeeds([...t.needs, e.target.value]); setAdding(false); }}>
              <option value="" disabled>Pick a topic…</option>
              {candidates.map((x) => <option key={x.line} value={x.name}>{x.name}</option>)}
            </select>
          ) : (
            <button onClick={() => setAdding(true)} disabled={!candidates.length} className="flex h-[26px] items-center rounded-[6px] border border-dashed border-line px-2 text-muted hover:text-ink disabled:opacity-50">+ Add</button>
          )}
        </div>
        <span className="text-muted">Note</span>
        <span className="relative flex min-w-0 items-center gap-2">
          {stats.linked || t.note ? (
            <>
              <button onClick={() => ops.open(t)} className="flex min-w-0 items-center gap-1.5 text-link hover:underline" title="Open note"><Glyph name="lesson" size={14} /><span className="truncate" dir="auto">{t.note}</span></button>
              <button onClick={() => ops.open(t, "split")} title="Open in split" aria-label="Open in split" className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-muted hover:bg-surface hover:text-ink"><Glyph name="columns-2" size={14} /></button>
            </>
          ) : (
            <button onClick={() => setPicking((x) => !x)} className="flex items-center gap-1.5 text-muted hover:text-ink"><Glyph name="lesson" size={14} />+ Link note</button>
          )}
          {picking && <LinkNotePicker spaceId={ops.spaceId} topic={t} onClose={() => setPicking(false)} onLink={(n) => { setPicking(false); ops.link(t, n); }} onCreate={() => { setPicking(false); ops.open(t); }} />}
        </span>
        {unlocks.length > 0 && (
          <>
            <span className="self-start pt-1 text-muted">Unlocks</span>
            <div className="flex flex-wrap gap-1.5">
              {unlocks.map((x) => <button key={x.line} onClick={() => onSelect(x)} className={cx("flex h-[26px] items-center gap-1.5 rounded-[6px] border border-line bg-surface px-2 hover:bg-surface-2", fresh.has(x.name.toLowerCase()) && "rm-unlock")}><StatusGlyph t={x} size={14} /><span dir="auto">{x.name}</span></button>)}
            </div>
          </>
        )}
        {stats.notes > 0 && (
          <>
            <span className="text-muted">In topic</span>
            <span>{stats.notes} note{stats.notes === 1 ? "" : "s"}{stats.cards ? ` · ${stats.cards} card${stats.cards === 1 ? "" : "s"}` : ""}</span>
          </>
        )}
      </div>
      {t.locked && <span className="flex items-center gap-1.5 text-[12px] text-muted"><Glyph name="s-locked" size={13} />Opens when {t.needs.filter((n) => !finished(byName.get(n.toLowerCase()))).join(", ")} {t.needs.filter((n) => !finished(byName.get(n.toLowerCase()))).length > 1 ? "are" : "is"} done</span>}

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <button onClick={() => setOrg((x) => !x)} aria-expanded={org} className="flex items-center gap-1.5 self-start font-semibold"><Glyph name={org ? "expand" : "wide"} size={14} />Organize</button>
        {org && (
          <>
            <div className="flex flex-wrap gap-1.5">
              <button className={btn} aria-label="Move up" onClick={() => nudge(-1)}>Move up</button>
              <button className={btn} aria-label="Move down" onClick={() => nudge(1)}>Move down</button>
              <label className={cx(btn, "relative cursor-pointer")}>Move to module…
                <select aria-label="Move to module" value={t.module} className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={(e) => { const i = Number(e.target.value); write(moveTopic(body, t.line, i, null)); announce(`${t.name} moved to ${mods[i]?.name}`); }}>
                  {mods.map((x, i) => <option key={i} value={i}>{i === t.module ? `In ${x.name}` : x.name}</option>)}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button className={btn} onClick={onRename}>Rename</button>
              <button className={cx(btn, "text-bad hover:bg-bad/10")} style={{ borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)" }} aria-label="Delete topic" onClick={() => setConfirm(true)}>Delete</button>
            </div>
            {confirm && <InlineConfirm text="Delete this topic? The lesson note stays." onCancel={() => setConfirm(false)} onOk={() => { setConfirm(false); ops.remove(t); }} />}
          </>
        )}
      </div>
    </>
  );
}

export function TopicSheet(props: SheetProps) {
  const { mods, t, onClose, ops } = props;
  useEsc(onClose);
  const title = useRef<HTMLInputElement>(null);
  const m = mods[t.module];
  return (
    <aside className="sheet-in lm-sheet absolute bottom-3 right-3 top-3 z-40 flex w-[380px] flex-col overflow-hidden rounded-[14px] border border-line bg-surface-2" aria-label={`Topic ${t.name}`}>
      <div className="flex flex-col gap-1 border-b border-line px-[18px] pb-3 pt-4">
        <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
          <span className="truncate" dir="auto">{m?.name ?? "Topics"}</span>
          <button aria-label="Close" title="Close (Esc)" onClick={onClose} className="-m-1 rounded-md p-1 hover:bg-surface hover:text-ink"><Glyph name="x" size={16} /></button>
        </div>
        <input ref={title} key={t.name} defaultValue={t.name} dir="auto" aria-label="Topic name" title="Rename (updates every “needs” that mentions it)"
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) ops.rename(t, v); }}
          className="-mx-1 rounded-[6px] bg-transparent px-1 text-[19px] font-[650] outline-none focus:bg-surface" />
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-[18px] py-3.5 text-[13px]">
        <StatusSelector t={t} onStatus={ops.setStatus} />
        <SheetBody {...props} onRename={() => { title.current?.focus(); title.current?.select(); }} />
      </div>
    </aside>
  );
}

/** Phone: peek sheet (title, status, needs, open lesson); drag the handle up for the full editor. */
export function PhoneTopicSheet(props: SheetProps) {
  const { mods, t, onClose, ops } = props;
  useEsc(onClose);
  const [full, setFull] = useState(false);
  const [rename, setRename] = useState(false);
  const drag = useRef<number | null>(null);
  const all = mods.flatMap((x) => x.topics);
  const byName = new Map(all.map((x) => [x.name.toLowerCase(), x]));
  const dueCls = !t.due ? "text-muted" : overdue(t) ? "text-bad" : "text-warn";
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <aside className="sheet-in safe-b fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col gap-3 rounded-t-[14px] border-t border-line bg-surface-2 px-4 pt-2.5 text-[13px]" aria-label={`Topic ${t.name}`}>
        <div className="flex touch-none justify-center py-1" role="button" aria-label={full ? "Collapse" : "Expand"}
          onPointerDown={(e) => { drag.current = e.clientY; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); }}
          onPointerUp={(e) => { const y0 = drag.current; drag.current = null; if (y0 === null) return; const dy = e.clientY - y0; if (dy < -24) setFull(true); else if (dy > 24) (full ? setFull(false) : onClose()); else setFull((x) => !x); }}>
          <span className="h-1 w-9 rounded-[2px] bg-[var(--border)]" />
        </div>
        <div className="flex items-center gap-3">
          {rename ? (
            <input autoFocus defaultValue={t.name} aria-label="Topic name" dir="auto" onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              onBlur={(e) => { const v = e.target.value.trim(); setRename(false); if (v && v !== t.name) ops.rename(t, v); }}
              className="h-9 min-w-0 flex-1 rounded-[8px] border border-accent bg-bg px-2 text-[16px] font-[650] outline-none" />
          ) : <span className="min-w-0 flex-1 truncate text-[17px] font-[650]" dir="auto">{t.name}</span>}
          <span className={cx("shrink-0 text-[12.5px]", dueCls)}>{t.due ? `Due ${fmtLong(t.due)}` : t.locked ? "Locked" : ""}</span>
        </div>
        <StatusSelector t={t} onStatus={ops.setStatus} tall />
        <div className={cx("flex min-h-0 flex-col gap-3 overflow-y-auto", full && "gap-4")}>
          {!full && t.needs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5"><span className="mr-0.5 text-[12px] text-muted">Needs</span>
              {t.needs.map((n) => {
                const d = byName.get(n.toLowerCase());
                return <span key={n} className="flex h-[30px] items-center gap-1.5 rounded-[6px] border border-line bg-surface px-2.5">{d ? <StatusGlyph t={d} size={14} /> : null}{n}</span>;
              })}
            </div>
          )}
          {full && <SheetBody {...props} phone onRename={() => setRename(true)} />}
        </div>
        <div className="flex gap-2.5 pb-3">
          <button onClick={() => ops.open(t)} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[12px] bg-accent font-semibold text-accent-fg"><Glyph name="lesson" size={16} />{t.note ? "Open lesson note" : "Create lesson note"}</button>
        </div>
      </aside>
    </>
  );
}
