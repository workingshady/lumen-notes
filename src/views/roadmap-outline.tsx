// Course roadmap · Outline (design round 4: RoadmapDesk "outline" + "builder", Lumen 15 R4-15A…D, phone R4-15H).
// Desktop: collapsible modules with progress, drag & drop (insert line, "becomes prerequisite", refused loop with the
// reason), notes tray, builder for an empty roadmap. Phone: no dragging; every row has ⋯ with the same actions.
import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent as RKeyboardEvent } from "react";
import type { Note } from "../../shared/types";
import {
  addModule, addTopic, addTopicNeed, deleteModule, moveModule, moveTopic, needChain, nudgeModule, nudgeTopic, progress, renameModule, roadmap,
  setTopicDue, setTopicNeeds, topicBlock, type Module, type Topic, type TopicStatus,
} from "../lib/parse";
import { toast } from "../lib/store";
import { Glyph } from "../components/Glyph";
import { cx } from "../components/ui";
import { announce, dragging, dragKind, dropData, endDrag, startDrag, useRefocus, zoneY } from "./dnd-parts";
import { InlineConfirm, LinkNotePicker, StatusGlyph, STATUS_LABEL, finished, type useModuleFold } from "./roadmap-parts";
import { fmtDay } from "./spaces-util";

/** What the outline / sheets need to rewrite the roadmap. */
export interface TopicOps {
  body: string; write: (body: string) => void; mods: Module[]; spaceId: string | null;
  remove: (t: Topic) => void; rename: (t: Topic, name: string) => void;
  setStatus: (t: Topic, s: TopicStatus) => void; open: (t: Topic, mode?: "edit" | "split") => void; link: (t: Topic, n: Note) => void;
}
export type Fold = ReturnType<typeof useModuleFold>;

const NEXT: Record<TopicStatus, TopicStatus> = { todo: "learning", learning: "done", done: "todo", skipped: "todo" };
const sel$ = (attr: string, v: string) => `[${attr}="${CSS.escape(v)}"]`;
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const overdue = (t: Topic, due = t.due) => !!due && t.status !== "done" && t.status !== "skipped" && due < todayIso();

/** Ghost content for a dragged row: its status glyph + name (design: the dragged row keeps its status glyph). */
function ghostOf(row: HTMLElement, name: string) {
  const s = document.createElement("span");
  const g = row.querySelector("[data-sg]")?.cloneNode(true);
  if (g) s.appendChild(g);
  s.appendChild(document.createTextNode(name));
  return s;
}

/** Inline "+ Add …" input: Enter adds and keeps the field open for the next one. */
export function AddRow({ placeholder, onAdd, className, inputCls, value, onValue, plus = true, label, inputRef }: {
  placeholder: string; onAdd: (name: string) => void; className?: string; inputCls?: string; value?: string; onValue?: (v: string) => void; plus?: boolean; label?: string; inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [own, setOwn] = useState("");
  const v = value ?? own;
  const setV = onValue ?? setOwn;
  return (
    <form className={cx("flex items-center gap-2", className)} onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(""); } }} onClick={(e) => e.stopPropagation()}>
      {plus && <span className="w-3 shrink-0 text-center text-[15px] leading-none text-muted">+</span>}
      <input ref={inputRef} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={label ?? placeholder} dir="auto"
        className={cx("min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted", inputCls)} />
    </form>
  );
}

/** Drop feedback: insert line before/after a row, "becomes prerequisite", refused (loop) with its reason, module ends, new module. */
type Hint =
  | { kind: "before" | "after" | "need"; line: number }
  | { kind: "refused"; line: number; why: string }
  | { kind: "mod-before" | "mod-after" | "mod-end"; i: number }
  | { kind: "new" }
  | null;

// ------------------------------------------------------------------ desktop topic row
type RowDnd = { hint: Hint; dragging: boolean; over: (e: DragEvent) => void; drop: (e: DragEvent) => void; key: (e: RKeyboardEvent) => void; start: (e: DragEvent) => void };
function TopicRow({ t, sel, onSelect, ops, dnd, fresh }: { t: Topic; sel?: boolean; onSelect: (t: Topic) => void; ops: TopicOps; dnd: RowDnd; fresh: boolean }) {
  const [picking, setPicking] = useState(false);
  const h = dnd.hint && "line" in dnd.hint && dnd.hint.line === t.line ? dnd.hint : null;
  const prereq = h?.kind === "need", refused = h?.kind === "refused";
  return (
    <div onClick={() => onSelect(t)} data-topic={t.name} data-pdnd-row tabIndex={0} role="button"
      aria-label={`${t.name}, ${STATUS_LABEL[t.status]}${t.locked ? ", locked" : ""}. Alt+Up or Alt+Down to move.`}
      draggable onDragStart={dnd.start} onDragEnd={() => endDrag()} onDragOver={dnd.over} onDrop={dnd.drop} onKeyDown={dnd.key}
      className={cx("rm-row group flex h-9 cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5", h?.kind === "before" && "rm-ins-before", h?.kind === "after" && "rm-ins-after", !h && (sel ? "bg-surface-2" : "hover:bg-surface-2/60"), fresh && "rm-unlock", dnd.dragging && "opacity-40")}
      style={{
        opacity: dnd.dragging || h ? undefined : t.locked ? 0.55 : undefined,
        background: prereq ? "color-mix(in srgb, var(--accent) 12%, transparent)" : refused ? "color-mix(in srgb, var(--danger) 8%, transparent)" : undefined,
        boxShadow: prereq ? "inset 0 0 0 1.5px var(--accent)" : refused ? "inset 0 0 0 1.5px var(--danger)" : undefined,
      }}>
      <span className="rm-dot" />
      <span className="rm-grip select-none text-[11px] tracking-[-1px] text-muted" aria-hidden>⋮⋮</span>
      <button data-sg title={`${STATUS_LABEL[t.status]}. Click: ${STATUS_LABEL[NEXT[t.status]]}, right-click: skip`}
        onClick={(e) => { e.stopPropagation(); ops.setStatus(t, NEXT[t.status]); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); ops.setStatus(t, t.status === "skipped" ? "todo" : "skipped"); }}
        className="-m-1 flex p-1"><StatusGlyph t={t} /></button>
      <span className={cx("min-w-0 flex-1 truncate font-medium", t.status === "skipped" && "line-through")} dir="auto">{t.name}</span>
      {t.needs.length > 0 && <span className="max-w-[260px] shrink truncate text-[12px] text-muted">needs {t.needs.join(", ")}</span>}
      {prereq && <span className="shrink-0 rounded-[6px] px-2 text-[11.5px] font-semibold leading-5" style={{ background: "color-mix(in srgb, var(--accent) 20%, transparent)", color: "var(--accent)" }}>becomes prerequisite</span>}
      <span className="relative flex w-[150px] shrink-0">
        <button onClick={(e) => { e.stopPropagation(); if (t.note) ops.open(t); else setPicking((x) => !x); }} title={t.note ? `Open ${t.note}` : "Link a note"}
          className={cx("flex min-w-0 items-center gap-1.5 whitespace-nowrap text-left text-[12px]", t.note ? "text-link hover:underline" : "text-muted hover:text-ink")}>
          <Glyph name="lesson" size={14} /><span className="truncate">{t.note ?? "+ Link note"}</span>
        </button>
        {picking && <LinkNotePicker spaceId={ops.spaceId} topic={t} onClose={() => setPicking(false)} onLink={(n) => { setPicking(false); ops.link(t, n); }} onCreate={() => { setPicking(false); ops.open(t); }} />}
      </span>
      <span className={cx("w-[52px] shrink-0 text-right text-[12px] tabular-nums", overdue(t) ? "text-bad" : "text-muted")}>{t.due ? fmtDay(t.due) : ""}</span>
      {refused && h?.kind === "refused" && (
        <div role="status" className="pointer-events-none absolute left-[230px] top-[calc(100%+6px)] z-20 flex items-center gap-2 whitespace-nowrap rounded-[8px] border bg-surface-2 px-3 py-2 text-[13px] text-ink"
          style={{ borderColor: "color-mix(in srgb, var(--danger) 45%, transparent)", boxShadow: "0 12px 28px rgba(0,0,0,.4)" }}>
          <Glyph name="c-danger" size={16} color="var(--danger)" />{h.why}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ desktop outline
export function Outline({ mods, sel, onSelect, ops, fold, fresh }: { mods: Module[]; sel?: number; onSelect: (t: Topic) => void; ops: TopicOps; fold: Fold; fresh: Set<string> }) {
  const [hint, setHint] = useState<Hint>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [newMod, setNewMod] = useState("");
  const { body, write } = ops;
  const refocus = useRefocus(body);
  const lines = useMemo(() => body.split("\n"), [body]);
  const all = mods.flatMap((m) => m.topics);
  const byLine = (l: number) => all.find((t) => t.line === l);
  const hasTopic = (name: string) => all.some((t) => t.name.toLowerCase() === name.toLowerCase());
  /** The topic right after `t`'s block in its module (null = t is last): "drop after t" = "insert before that one". */
  const after = (m: Module, t: Topic) => { const end = topicBlock(lines, t.line)[1]; return m.topics.find((x) => x.line >= end)?.line ?? null; };
  const draggedLine = () => { const d = dragging(); return d && (d.kind === "topic" || d.kind === "need") ? Number(d.id) : null; };
  const set = (h: Hint) => setHint((o) => (JSON.stringify(o) === JSON.stringify(h) ? o : h));
  const finish = () => { setHint(null); endDrag(); };
  const addNote = (md: string, mi: number, title: string, beforeLine: number | null) => {
    if (hasTopic(title)) { toast(`“${title}” is already a topic`); return; }
    write(addTopic(md, mi, title, { note: title, beforeLine }));
    announce(`Added ${title}`);
  };
  /** Why making `from` a prerequisite of `t` is refused (null = allowed). */
  const refusal = (from: Topic, t: Topic) => {
    if (t.needs.some((n) => n.toLowerCase() === from.name.toLowerCase())) return `${t.name} already needs ${from.name}.`;
    const chain = needChain(all, from, t);
    return chain ? `Can't drop here: ${chain[0]} already needs ${chain.slice(1).join(" → ")}, so this would make a loop.` : null;
  };

  const rowDnd = (m: Module, mi: number, t: Topic): RowDnd => ({
    hint,
    dragging: draggedLine() === t.line && !!hint,
    start: (e) => startDrag(e, "topic", String(t.line), t.name, ghostOf(e.currentTarget as HTMLElement, t.name)),
    over: (e) => {
      const k = dragKind(e);
      if (k !== "topic" && k !== "need" && k !== "note") return;
      if (draggedLine() === t.line) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = k === "need" ? "link" : "move";
      const z = k === "need" ? "inside" : zoneY(e, 1 / 3);
      if (z === "inside" && k !== "note") {
        const from = byLine(draggedLine() ?? -1);
        const why = from ? refusal(from, t) : null;
        e.dataTransfer.dropEffect = why ? "none" : e.dataTransfer.dropEffect;
        set(why ? { kind: "refused", line: t.line, why } : { kind: "need", line: t.line });
        return;
      }
      set({ kind: z === "inside" ? (zoneY(e, 0.5) === "after" ? "after" : "before") : z, line: t.line });
    },
    drop: (e) => {
      const k = dragKind(e);
      const h = hint;
      e.preventDefault(); e.stopPropagation();
      if (!h || !("line" in h) || (k !== "topic" && k !== "need" && k !== "note")) return finish();
      const id = dropData(e, k);
      finish();
      if (h.kind === "refused") return; // release does nothing
      const before = h.kind === "before" ? t.line : after(m, t);
      if (k === "note") return addNote(body, mi, id, before);
      const from = byLine(Number(id));
      if (!from) return;
      if (h.kind === "need") {
        const md = addTopicNeed(body, t.line, from.line);
        if (md === body) return;
        write(md);
        announce(`${t.name} now needs ${from.name}`);
        return;
      }
      write(moveTopic(body, from.line, mi, before));
      announce(`Moved ${from.name} ${h.kind} ${t.name}`);
    },
    key: (e) => {
      if (e.key === "Enter" && e.target === e.currentTarget) { onSelect(t); return; }
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      e.preventDefault();
      const md = nudgeTopic(body, t.line, e.key === "ArrowUp" ? -1 : 1);
      if (md === body) return;
      write(md);
      refocus(sel$("data-topic", t.name));
      const nm = roadmap(md).find((x) => x.topics.some((y) => y.name === t.name));
      announce(`${t.name} moved ${e.key === "ArrowUp" ? "up" : "down"}${nm ? `, in ${nm.name}` : ""}`);
    },
  });

  const modOver = (e: DragEvent, i: number) => {
    const k = dragKind(e);
    if (k === "module") {
      const d = dragging();
      if (d && Number(d.id) === i) return;
      e.preventDefault();
      set({ kind: zoneY(e, 0.5) === "after" ? "mod-after" : "mod-before", i });
    } else if (k === "topic" || k === "note") { e.preventDefault(); set({ kind: "mod-end", i }); }
  };
  const modDrop = (e: DragEvent, i: number) => {
    const k = dragKind(e);
    const h = hint;
    e.preventDefault();
    if (!k || !h || !("i" in h)) return finish();
    const id = dropData(e, k);
    finish();
    if (k === "module") {
      const from = Number(id);
      const before = h.kind === "mod-before" ? i : i + 1 < mods.length ? i + 1 : null;
      write(moveModule(body, from, before));
      announce(`Moved module ${mods[from]?.name}`);
    } else if (k === "topic") {
      const t = byLine(Number(id));
      if (t) { write(moveTopic(body, t.line, i, null)); announce(`Moved ${t.name} to ${mods[i].name}`); }
    } else if (k === "note") addNote(body, i, id, null);
  };
  const newOver = (e: DragEvent) => { const k = dragKind(e); if (k === "topic" || k === "note") { e.preventDefault(); set({ kind: "new" }); } };
  const newDrop = (e: DragEvent) => {
    const k = dragKind(e);
    e.preventDefault();
    if (k !== "topic" && k !== "note") return finish();
    const id = dropData(e, k);
    finish();
    const name = newMod.trim() || `Module ${mods.length + 1}`;
    if (k === "note" && hasTopic(id)) { toast(`“${id}” is already a topic`); return; }
    let md = addModule(body, name);
    const idx = roadmap(md).length - 1;
    md = k === "topic" ? moveTopic(md, Number(id), idx, null) : addTopic(md, idx, id, { note: id });
    write(md);
    setNewMod("");
    announce(`New module ${name}`);
  };

  return (
    <div className="relative flex flex-col gap-2.5 px-8 py-4" onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHint(null); }} onDragEnd={finish}>
      {mods.map((m, i) => {
        const p = progress([m]);
        const open = fold.isOpen(i);
        const mh = hint && "i" in hint && hint.i === i ? hint.kind : null;
        return (
          <section key={i} data-module-section={i} onDragOver={(e) => modOver(e, i)} onDrop={(e) => modDrop(e, i)}
            className={cx("rounded-[12px] border border-line bg-surface", mh === "mod-before" && "pdnd-before", mh === "mod-after" && "pdnd-after", mh === "mod-end" && "pdnd-inside")}>
            <div role="button" tabIndex={0} aria-expanded={open} data-module={m.name} data-pdnd-row draggable={m.line >= 0 && renaming !== i}
              aria-label={`Module ${m.name}. Enter to fold. Alt+Up or Alt+Down to move.`}
              onDragStart={(e) => startDrag(e, "module", String(i), m.name)} onDragEnd={finish}
              onClick={() => renaming !== i && fold.toggle(i)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if ((e.key === "Enter" || e.key === " ") && !e.altKey) { e.preventDefault(); fold.toggle(i); return; }
                if (e.key === "F2") { setRenaming(i); return; }
                if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                  e.preventDefault();
                  const md = nudgeModule(body, i, e.key === "ArrowUp" ? -1 : 1);
                  if (md !== body) { write(md); refocus(sel$("data-module", m.name)); announce(`Module ${m.name} moved ${e.key === "ArrowUp" ? "up" : "down"}`); }
                }
              }}
              className="group flex h-[46px] w-full cursor-pointer items-center gap-2.5 px-3 text-left">
              <Glyph name={open ? "expand" : "wide"} size={16} color="var(--muted)" />
              {renaming === i ? (
                <input autoFocus defaultValue={m.name} dir="auto" aria-label="Module name" onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(null); }}
                  onBlur={(e) => { const v = e.target.value.trim(); setRenaming(null); if (v && v !== m.name) write(renameModule(body, i, v)); }}
                  className="min-w-0 flex-1 rounded-[6px] border border-accent bg-bg px-1.5 py-0.5 font-semibold outline-none" />
              ) : (
                <span className="min-w-0 flex-1 truncate font-semibold" dir="auto" title={m.line >= 0 ? "Double-click to rename · drag to reorder" : undefined}
                  onDoubleClick={(e) => { if (m.line >= 0) { e.stopPropagation(); setRenaming(i); } }}>{m.name}</span>
              )}
              {m.due && !(m.topics.length && m.topics.every(finished)) && <span className={cx("shrink-0 text-[12px]", m.due < todayIso() ? "text-bad" : "text-muted")}>Due {fmtDay(m.due)}</span>}
              {!m.topics.length && m.line >= 0 && (
                <button aria-label={`Delete module ${m.name}`} title="Delete empty module" onClick={(e) => { e.stopPropagation(); write(deleteModule(body, i)); announce(`Deleted module ${m.name}`); }}
                  className="pdnd-grip flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-bad"><Glyph name="c-danger" size={14} /></button>
              )}
              <span className="h-[5px] w-[140px] shrink-0 overflow-hidden rounded-[3px] bg-surface-2"><span className="block h-full bg-ok" style={{ width: `${p.pct}%` }} /></span>
              <span className="w-10 shrink-0 text-right text-[12px] tabular-nums text-muted">{p.done}/{p.total}</span>
            </div>
            {open && (
              <div className="border-t border-line px-1.5 pb-1.5 pt-1">
                {m.topics.map((t) => <TopicRow key={t.line} t={t} sel={t.line === sel} onSelect={onSelect} ops={ops} dnd={rowDnd(m, i, t)} fresh={fresh.has(t.name.toLowerCase())} />)}
                <AddRow placeholder="Add topic" label="Add topic" className="h-8 px-2.5"
                  onAdd={(name) => { if (hasTopic(name)) return toast(`“${name}” is already a topic`); write(addTopic(body, i, name)); announce(`Added ${name}`); }} />
              </div>
            )}
          </section>
        );
      })}
      <div onDragOver={newOver} onDrop={newDrop} className={cx("pdnd-zone flex h-11 items-center justify-center px-4", hint?.kind === "new" && "pdnd-over")}>
        <AddRow plus={false} placeholder={hint?.kind === "new" ? `Drop to start “${newMod.trim() || `Module ${mods.length + 1}`}”` : "+ New module · or drop a topic here"} label="New module" className="w-full"
          inputCls="text-center" value={newMod} onValue={setNewMod} onAdd={(name) => { write(addModule(body, name)); announce(`New module ${name}`); }} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ builder (empty roadmap)
/** Empty roadmap (design 15D): module name in edit mode, a drop area for notes, "+ New module", a tip. */
export function Builder({ mods, ops }: { mods: Module[]; ops: TopicOps }) {
  const { body, write } = ops;
  const [name, setName] = useState("Module 1");
  const [over, setOver] = useState<number | "new" | null>(null);
  const [newMod, setNewMod] = useState("");
  const topicIn = useRef<HTMLInputElement>(null);
  // a virtual first module until something is added
  const shown: { name: string; i: number | null }[] = mods.length ? mods.map((m, i) => ({ name: m.name, i })) : [{ name, i: null }];
  const ensure = (md: string, i: number | null) => { if (i !== null) return { md, i }; const out = addModule(md, name.trim() || "Module 1"); return { md: out, i: roadmap(out).length - 1 }; };
  const addTopicTo = (i: number | null, topic: string, note?: string) => {
    const r = ensure(body, i);
    write(addTopic(r.md, r.i, topic, note ? { note } : {}));
    announce(`Added ${topic}`);
  };
  const dropOn = (e: DragEvent, i: number | null) => {
    const k = dragKind(e);
    e.preventDefault(); setOver(null);
    if (k !== "note") return endDrag();
    const id = dropData(e, k);
    endDrag();
    addTopicTo(i, id, id);
  };
  return (
    <div className="flex flex-col gap-3.5 px-8 py-6">
      {shown.map((m, k) => (
        <section key={k} data-module-section={k} className="rounded-[12px] border border-line bg-surface" onDragOver={(e) => { if (dragKind(e) === "note") { e.preventDefault(); setOver(k); } }} onDrop={(e) => dropOn(e, m.i)}>
          <div className="flex h-[46px] items-center gap-2.5 px-3">
            <Glyph name="expand" size={16} color="var(--muted)" />
            {m.i === null ? (
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Module name" dir="auto"
                onKeyDown={(e) => { if (e.key === "Enter") topicIn.current?.focus(); }} style={{ width: `calc(${Math.max(4, name.length)}ch + 14px)` }}
                className="max-w-[420px] rounded-[6px] border border-accent bg-bg px-1.5 py-0.5 font-semibold caret-[var(--accent)] outline-none" />
            ) : (
              <input defaultValue={m.name} aria-label="Module name" dir="auto" onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== m.name) write(renameModule(body, m.i!, v)); }}
                className="w-[220px] rounded-[6px] border border-transparent bg-transparent px-1.5 py-0.5 font-semibold outline-none focus:border-accent focus:bg-bg" />
            )}
          </div>
          <div className={cx("mx-3 mb-3 flex h-[150px] flex-col items-center justify-center gap-2 rounded-[10px] border-[1.5px] border-dashed text-muted transition-colors", over === k ? "border-accent bg-accent/5" : "border-line")}>
            <span className="text-[14px] font-semibold text-ink">Drop notes here to make topics</span>
            <span>or type a topic name and press Enter</span>
            <AddRow inputRef={k === 0 ? topicIn : undefined} placeholder="+ Add topic" label="Add topic" plus={false}
              className="h-[30px] w-[200px] rounded-[8px] border border-line px-3" inputCls="text-center text-ink placeholder:text-ink"
              onAdd={(t) => addTopicTo(m.i, t)} />
          </div>
        </section>
      ))}
      <div onDragOver={(e) => { if (dragKind(e) === "note") { e.preventDefault(); setOver("new"); } }} onDrop={(e) => {
        e.preventDefault(); setOver(null);
        const k = dragKind(e);
        if (k !== "note") return endDrag();
        const id = dropData(e, k);
        endDrag();
        const nm = newMod.trim() || (mods.length ? `Module ${mods.length + 1}` : name.trim() || "Module 1");
        write(addModule(body, nm, [{ name: id, note: id }]));
        setNewMod("");
        announce(`New module ${nm}`);
      }} className={cx("pdnd-zone flex h-11 items-center justify-center px-4", over === "new" && "pdnd-over")}>
        <AddRow plus={false} placeholder="+ New module" label="New module" className="w-full" inputCls="text-center" value={newMod} onValue={setNewMod}
          onAdd={(n) => { const md = !mods.length ? addModule(body, name.trim() || "Module 1") : body; write(addModule(md, n)); announce(`New module ${n}`); }} />
      </div>
      <span className="max-w-[560px] leading-[19px] text-muted">Tip: drag one topic onto the middle of another to make it a prerequisite. Alt+↑/↓ moves the selected row.</span>
    </div>
  );
}

// ------------------------------------------------------------------ phone outline + ⋯ menu
function phoneSub(t: Topic) {
  if (t.locked) return `Needs ${t.needs.join(", ")}`;
  if (t.status === "done") return t.due ? `Done ${fmtDay(t.due)}` : "Done";
  if (t.status === "skipped") return "Skipped";
  if (t.due) return overdue(t) ? `Overdue · ${fmtDay(t.due)}` : `Due ${fmtDay(t.due)}`;
  return t.status === "learning" ? "Learning" : "Todo";
}

export function PhoneOutline({ mods, sel, onSelect, ops, fold, fresh, onNotes }: { mods: Module[]; sel?: number; onSelect: (t: Topic) => void; ops: TopicOps; fold: Fold; fresh: Set<string>; onNotes: () => void }) {
  const [menu, setMenu] = useState<Topic | null>(null);
  const { body, write } = ops;
  const hasTopic = (name: string) => mods.some((m) => m.topics.some((t) => t.name.toLowerCase() === name.toLowerCase()));
  const live = menu ? mods.flatMap((m) => m.topics).find((t) => t.name === menu.name) ?? null : null;
  return (
    <div className="flex flex-col gap-2.5 px-4 pb-3">
      {!mods.length && <p className="text-[13px] leading-relaxed text-muted">Name a first module below, then add topics, or add notes as topics.</p>}
      {mods.map((m, i) => {
        const p = progress([m]);
        const open = fold.isOpen(i);
        return (
          <section key={i} className="overflow-hidden rounded-[14px] border border-line bg-surface">
            <button className="flex h-[52px] w-full items-center gap-2.5 px-3 text-left" onClick={() => fold.toggle(i)} aria-expanded={open}>
              <Glyph name={open ? "expand" : "wide"} size={16} color="var(--muted)" />
              <span className="min-w-0 flex-1 truncate font-semibold" dir="auto">{m.name}</span>
              <span className="text-[12px] text-muted">{p.done}/{p.total}</span>
            </button>
            {open && m.topics.map((t) => (
              <div key={t.line} className={cx("flex min-h-[52px] items-center gap-2.5 border-t border-line pl-3.5 pr-1", t.line === sel && "bg-surface-2", fresh.has(t.name.toLowerCase()) && "rm-unlock")} style={{ opacity: t.locked ? 0.55 : 1 }}>
                <button onClick={() => onSelect(t)} className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left">
                  <StatusGlyph t={t} />
                  <span className="flex min-w-0 flex-1 flex-col gap-px"><span className={cx("truncate font-medium", t.status === "skipped" && "line-through")} dir="auto">{t.name}</span><span className="truncate text-[12px] text-muted">{phoneSub(t)}</span></span>
                </button>
                <button aria-label={`Actions for ${t.name}`} onClick={() => setMenu(t)} className="flex size-11 shrink-0 items-center justify-center text-[18px] text-muted">⋯</button>
              </div>
            ))}
            {open && <AddRow placeholder="Add topic" label="Add topic" className="h-12 border-t border-line px-3.5" inputCls="text-[15px]"
              onAdd={(name) => { if (hasTopic(name)) return toast(`“${name}” is already a topic`); write(addTopic(body, i, name)); }} />}
          </section>
        );
      })}
      <div className="pdnd-zone flex h-12 items-center px-3.5"><AddRow placeholder="New module" label="New module" className="flex-1" inputCls="text-[15px] font-semibold" onAdd={(name) => write(addModule(body, name))} /></div>
      <button onClick={onNotes} className="flex h-11 items-center justify-center gap-2 rounded-[12px] border border-line text-[14px] text-muted"><Glyph name="file" size={16} />Add notes as topics</button>
      {live && <PhoneTopicMenu t={live} ops={ops} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Phone ⋯ menu (design 15H): one sheet with every action the desktop does by dragging. */
export function PhoneTopicMenu({ t, ops, onClose }: { t: Topic; ops: TopicOps; onClose: () => void }) {
  const [view, setView] = useState<"main" | "needs" | "move" | "module" | "rename" | "delete">("main");
  const dateIn = useRef<HTMLInputElement>(null);
  const { body, write, mods } = ops;
  const all = mods.flatMap((m) => m.topics);
  const others = all.filter((x) => x.line !== t.line && !t.needs.some((n) => n.toLowerCase() === x.name.toLowerCase()) && !needChain(all, x, t));
  const nudge = (dir: -1 | 1) => { const md = nudgeTopic(body, t.line, dir); if (md !== body) { write(md); announce(`${t.name} moved ${dir < 0 ? "up" : "down"}`); } };
  const row = "flex h-[50px] w-full items-center gap-3 border-t border-line text-left";
  const items: { g: Parameters<typeof Glyph>[0]["name"]; l: string; r?: string; danger?: boolean; run: () => void }[] = [
    { g: "s-done", l: t.status === "done" ? "Mark not done" : "Mark done", run: () => { ops.setStatus(t, t.status === "done" ? "todo" : "done"); onClose(); } },
    { g: "date", l: "Due date", r: t.due ? fmtDay(t.due) : "Set", run: () => { const el = dateIn.current; if (el) { try { el.showPicker(); } catch { el.click(); } } } },
    { g: "roadmap", l: "Prerequisites", r: t.needs.length ? String(t.needs.length) : "", run: () => setView("needs") },
    { g: "lesson", l: t.note ? "Open lesson note" : "Create lesson note", run: () => { onClose(); ops.open(t); } },
    { g: "expand", l: "Move up / down", run: () => setView("move") },
    { g: "folder", l: "Move to module…", run: () => setView("module") },
    { g: "d-draft", l: "Rename", run: () => setView("rename") },
    { g: "c-danger", l: "Delete topic", danger: true, run: () => setView("delete") },
  ];
  return (
    <>
      <div className="fixed inset-0 z-40 bg-[rgba(5,6,8,.55)]" onClick={onClose} />
      <div role="dialog" aria-label={`${t.name} actions`} className="sheet-in safe-b fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-y-auto rounded-t-[14px] bg-surface px-4 pt-2.5 text-[14px]">
        <div className="flex justify-center pb-2"><span className="h-1 w-9 rounded-[2px] bg-[var(--border)]" /></div>
        <span className="pb-2 pt-1 text-[16px] font-[650]" dir="auto">{t.name}</span>
        <input ref={dateIn} type="date" className="sr-only" tabIndex={-1} value={t.due ?? ""} onChange={(e) => { write(setTopicDue(body, t.line, e.target.value || null)); }} />
        {view === "main" && items.map((it) => (
          <button key={it.l} onClick={it.run} className={row} style={{ color: it.danger ? "var(--danger)" : "var(--text)" }}>
            <Glyph name={it.g} size={18} /><span className="flex-1">{it.l}</span><span className="text-[12.5px] text-muted">{it.r}</span>
          </button>
        ))}
        {view === "needs" && (
          <>
            {t.needs.map((n) => {
              const d = all.find((x) => x.name.toLowerCase() === n.toLowerCase());
              return (
                <div key={n} className={row}>{d ? <StatusGlyph t={d} size={18} /> : <Glyph name="s-todo" size={18} color="var(--muted)" />}<span className="flex-1" dir="auto">{n}</span>
                  <button className="px-2 text-[12.5px] text-bad" onClick={() => write(setTopicNeeds(body, t.line, t.needs.filter((x) => x !== n)))}>Remove</button></div>
              );
            })}
            <span className="pb-1 pt-3 text-[12px] font-medium text-muted">Add a prerequisite</span>
            {others.map((x) => <button key={x.line} className={row} onClick={() => write(setTopicNeeds(body, t.line, [...t.needs, x.name]))}><StatusGlyph t={x} size={18} /><span className="flex-1" dir="auto">{x.name}</span><Glyph name="plus" size={16} color="var(--muted)" /></button>)}
          </>
        )}
        {view === "move" && (
          <>
            <button className={row} aria-label="Move up" onClick={() => nudge(-1)}><Glyph name="chevron-down" size={18} style={{ transform: "rotate(180deg)" }} /><span className="flex-1">Move up</span></button>
            <button className={row} aria-label="Move down" onClick={() => nudge(1)}><Glyph name="chevron-down" size={18} /><span className="flex-1">Move down</span></button>
          </>
        )}
        {view === "module" && mods.map((m, i) => (
          <button key={i} className={row} disabled={i === t.module} onClick={() => { write(moveTopic(body, t.line, i, null)); announce(`${t.name} moved to ${m.name}`); onClose(); }}>
            <Glyph name="folder" size={18} color={i === t.module ? "var(--muted)" : undefined} /><span className={cx("flex-1 truncate", i === t.module && "text-muted")} dir="auto">{m.name}</span>{i === t.module && <span className="text-[12.5px] text-muted">current</span>}
          </button>
        ))}
        {view === "rename" && (
          <form className="flex gap-2 border-t border-line py-3" onSubmit={(e) => { e.preventDefault(); const v = (new FormData(e.currentTarget).get("n") as string).trim(); if (v) ops.rename(t, v); onClose(); }}>
            <input name="n" autoFocus defaultValue={t.name} aria-label="Topic name" dir="auto" className="h-11 min-w-0 flex-1 rounded-[8px] border border-line bg-bg px-3 outline-none focus:border-accent" />
            <button className="h-11 rounded-[10px] bg-accent px-4 font-semibold text-accent-fg">Save</button>
          </form>
        )}
        {view === "delete" && <div className="border-t border-line py-3"><InlineConfirm text="Delete this topic? The lesson note stays." onCancel={() => setView("main")} onOk={() => { onClose(); ops.remove(t); }} /></div>}
        {view !== "main" && <button className="h-11 text-[13px] text-muted" onClick={() => setView("main")}>Back</button>}
        <div className="h-6" />
      </div>
    </>
  );
}
