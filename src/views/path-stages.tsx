// Learning path · Stages (PathDesk "stages", R4-14A/B, phone R4-14I/J): stage columns that collapse to a 44 px strip,
// concept cards, dashed "Not placed yet", drag & drop (reorder / move / merge / take out / notes tray / Alt+arrows),
// group by course or status (read-only columns). Phone: accordion, one stage open at a time, ⋯ menu instead of drag.
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, ChevronsLeft, ChevronsRight, GitMerge, Layers, MoreHorizontal, NotebookPen, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState, type DragEvent, type KeyboardEvent as RKeyboardEvent } from "react";
import type { Note } from "../../shared/types";
import { cx, inputCls } from "../components/ui";
import {
  addConcept, addStage, conceptCourses, conceptState, linkNote, mergeConcepts, moveAlias, moveConcept, moveStage, nudgeConcept, placeConcept, removeConcept, removeStage, renameStage, reorderStage, serializePath, UNPLACED,
  type BuiltConcept, type BuiltPath, type ConceptState, type GroupBy,
} from "../lib/path";
import { toast, useVault } from "../lib/store";
import { announce, dragging, dragKind, dropData, endDrag, NotesTray, startDrag, useRefocus, zoneX, zoneY } from "./dnd-parts";
import { resourceCount } from "./path-res";
import { shortStage, ST, StatusIcon, useEscape, type Ask } from "./path-ui";

const sel$ = (attr: string, v: string) => `[${attr}="${CSS.escape(v)}"]`;
type Col = { name: string; concepts: BuiltConcept[]; color?: string; label?: string };

/** Drag ghost (Lumen 21): tilted chip with a grip, accent border. */
export function dragGhost(e: DragEvent, label: string) {
  const g = document.createElement("div");
  g.className = "lp-ghost";
  g.textContent = label;
  document.body.appendChild(g);
  try { e.dataTransfer.setDragImage(g, 14, 17); } catch { /* ignore */ }
  setTimeout(() => g.remove(), 0);
}

type CardDnd = { cls: string; tag: string | null; bad?: boolean; over: (e: DragEvent) => void; drop: (e: DragEvent) => void; key: (e: RKeyboardEvent) => void; dragging: boolean };

/** Concept card (design): status icon · name / course dots (≤3) · N courses · N res · violet revise pill. */
export function ConceptCard({ c, onOpen, sel, drag, dnd, res }: { c: BuiltConcept; onOpen: (k: string) => void; sel?: boolean; drag?: boolean; dnd?: CardDnd; res: number }) {
  const courses = conceptCourses(c);
  return (
    <button draggable={drag} data-concept={c.key} data-pdnd-row
      onDragStart={(e) => { startDrag(e, "concept", c.key, c.def.name); dragGhost(e, c.def.name); }} onDragEnd={() => endDrag()}
      onDragOver={dnd?.over} onDrop={dnd?.drop} onKeyDown={dnd?.key} onClick={() => onOpen(c.key)}
      aria-label={`${c.def.name}, ${ST[conceptState(c)].label}${c.reviewDue ? ", to revise" : ""}.${dnd ? " Alt+arrows to move." : ""}`}
      className={cx("lp-card relative flex w-full flex-col gap-[7px] rounded-[10px] px-[11px] py-2.5 text-left", dnd?.cls, dnd?.dragging && "pdnd-dragging")}
      style={{ background: sel ? "var(--surface-2)" : "var(--surface)", border: sel ? "1.5px solid var(--accent)" : "1px solid var(--border)", opacity: c.status === "locked" ? 0.5 : 1, boxShadow: sel ? "0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent)" : "none" }}>
      <span className="flex items-center gap-2"><StatusIcon c={c} /><span dir="auto" className="flex-1 font-semibold leading-[17px]">{c.def.name}</span></span>
      <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
        {courses.length > 0 && <span className="flex gap-[3px]">{courses.slice(0, 3).map((k) => <span key={k.key} title={k.spaceName} className="size-[7px] rounded-full" style={{ background: k.color }} />)}</span>}
        <span>{courses.length ? `${courses.length} ${courses.length === 1 ? "course" : "courses"}` : "your own"}</span>
        <span className="opacity-50">·</span><span>{res} res</span>
        <span className="flex-1" />
        {c.reviewDue && <span className="rounded-full px-1.5 font-semibold leading-[17px]" style={{ background: "color-mix(in srgb,var(--learn) 16%,transparent)", color: "var(--learn)" }}>revise</span>}
      </span>
      {dnd?.tag && <span className={cx("pdnd-tag", dnd.bad && "lp-tag-bad")}>{dnd.tag}</span>}
    </button>
  );
}

/** "+ Add concept": type a name, Enter adds it to the stage (keeps focus for the next one). */
function AddConcept({ onAdd, big }: { onAdd: (name: string) => void; big?: boolean }) {
  const [v, setV] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(""); } }} className={cx("flex items-center gap-1.5 rounded-[10px] border border-dashed border-line px-2.5 text-muted focus-within:border-accent/60", big ? "h-11" : "h-9")}>
      <Plus size={13} className="shrink-0" />
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Add concept" aria-label="Add concept" dir="auto" className={cx("min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted", big ? "text-[15px]" : "text-[13px]")} />
    </form>
  );
}

/** Columns for the current Group by (stages keep their order; course/status columns are views, not editable). */
export function groupColumns(path: BuiltPath, group: GroupBy, keep: (c: BuiltConcept) => boolean): Col[] {
  if (group === "course") {
    const cols: Col[] = path.courses.map((k) => ({ name: `course:${k.key}`, label: k.spaceName, color: k.color, concepts: path.concepts.filter((c) => keep(c) && c.coverage.some((x) => x.course.key === k.key)) }));
    const own = path.concepts.filter((c) => keep(c) && !c.coverage.length);
    if (own.length) cols.push({ name: "course:", label: "Your own", concepts: own });
    return cols;
  }
  if (group === "status") {
    return (["learning", "todo", "locked", "learned", "mastered"] as ConceptState[]).map((s) => ({ name: `status:${s}`, label: ST[s].label, color: ST[s].color, concepts: path.concepts.filter((c) => keep(c) && conceptState(c) === s) }));
  }
  const cols: Col[] = path.stages.map((s) => ({ name: s.name, concepts: s.concepts.filter(keep) }));
  if (!cols.some((s) => s.name === UNPLACED)) cols.push({ name: UNPLACED, concepts: [] });
  return cols;
}

type SHint = { kind: "before" | "after" | "merge" | "alias" | "link" | "bad"; key: string } | { kind: "end" | "col-before" | "col-after"; stage: string } | null;

/** Desktop board. */
export function Stages({ path, note, onOpen, save, confirm, keep, group, collapsed, setCollapsed, sel }: {
  path: BuiltPath; note: Note; onOpen: (k: string) => void; save: (b: string) => void; confirm: Ask; keep: (c: BuiltConcept) => boolean; group: GroupBy;
  collapsed: string[]; setCollapsed: (f: (o: string[]) => string[]) => void; sel: string | null;
}) {
  const v = useVault();
  const [hint, setHint] = useState<SHint>(null);
  const [newStage, setNewStage] = useState("");
  const [tray, setTray] = useState(() => !path.concepts.length);
  const refocus = useRefocus(note.body);
  const used = useMemo(() => new Set(path.concepts.flatMap((c) => [c.def.name.toLowerCase(), ...c.def.notes.map((n) => n.toLowerCase())])), [path]);
  const resN = useMemo(() => new Map(path.concepts.map((c) => [c.key, resourceCount(c, v.byTitle)])), [path, v.byTitle]);
  const body = note.body;
  const editable = group === "stage";
  const set = (h: SHint) => setHint((o) => (JSON.stringify(o) === JSON.stringify(h) ? o : h));
  const finish = () => { setHint(null); endDrag(); };
  const real = path.stages.filter((s) => s.name !== UNPLACED);
  const firstStage = real[0]?.name ?? "Stage 1";
  const unchanged = (b: string) => b === serializePath(path.doc);
  const toggleCol = (n: string) => setCollapsed((o) => (o.includes(n) ? o.filter((x) => x !== n) : [...o, n]));
  const cols = groupColumns(path, group, keep);

  const cardDnd = (c: BuiltConcept, s: Col, i: number): CardDnd => {
    const h = hint && "key" in hint && hint.key === c.key ? hint : null;
    return {
      cls: h ? (h.kind === "before" ? "lp-before" : h.kind === "after" ? "lp-after" : h.kind === "bad" ? "lp-bad" : "pdnd-inside") : "",
      tag: h ? (h.kind === "merge" ? "merge" : h.kind === "alias" ? "add as alias" : h.kind === "link" ? "link note" : h.kind === "bad" ? "Invalid drop" : null) : null,
      bad: h?.kind === "bad",
      dragging: dragging()?.kind === "concept" && dragging()?.id === c.key && !!hint,
      over: (e) => {
        const k = dragKind(e);
        if (k === "concept") {
          if (dragging()?.id === c.key) return;
          e.preventDefault(); e.stopPropagation();
          const z = zoneY(e);
          set({ kind: z === "inside" ? "merge" : z, key: c.key });
        } else if (k === "alias" || k === "note") { e.preventDefault(); e.stopPropagation(); set({ kind: k === "alias" ? "alias" : "link", key: c.key }); }
      },
      drop: (e) => {
        const k = dragKind(e);
        const hh = hint;
        e.preventDefault(); e.stopPropagation();
        if (!k || !hh || !("key" in hh)) return finish();
        const id = dropData(e, k);
        finish();
        if (k === "note") {
          const base = c.placed ? body : moveConcept(body, c, firstStage);
          save(linkNote(base, c, id));
          announce(`Linked ${id} to ${c.def.name}`);
          return;
        }
        if (k === "alias") {
          let d: { name: string; from: string | null };
          try { d = JSON.parse(id); } catch { return; }
          const from = d.from ? path.byKey.get(d.from) : null;
          if (from?.key === c.key) return;
          save(moveAlias(body, d.name, c, from));
          toast(`“${d.name}” now counts as “${c.def.name}”`);
          return;
        }
        const other = path.byKey.get(id);
        if (!other || other.key === c.key) return;
        if (hh.kind === "merge") {
          const doMerge = () => { save(mergeConcepts(note.body, c, other)); announce(`Merged ${other.def.name} into ${c.def.name}`); toast(`Merged “${other.def.name}” into “${c.def.name}”`); };
          if (!other.placed) return doMerge(); // a loose course topic just becomes an alias
          confirm(<>Merge “<b dir="auto">{other.def.name}</b>” into “<b dir="auto">{c.def.name}</b>”?</>, "Merge", doMerge);
          return;
        }
        if (!editable) return;
        if (s.name === UNPLACED) { if (other.placed) { save(removeConcept(body, other)); announce(`${other.def.name} taken out of the path`); } return; }
        const before = hh.kind === "before" ? c.key : s.concepts[i + 1]?.key ?? null;
        save(placeConcept(body, other, s.name, before));
        announce(`Moved ${other.def.name} to ${s.name}`);
        refocus(sel$("data-concept", other.key));
      },
      key: (e) => {
        if (!e.altKey || !editable) return;
        const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
        const si = real.findIndex((x) => x.name === s.name);
        let b: string | null = null, msg = "";
        if ((e.key === "ArrowUp" || e.key === "ArrowDown") && c.placed) { b = nudgeConcept(body, c, e.key === "ArrowUp" ? -1 : 1); msg = `${c.def.name} moved ${e.key === "ArrowUp" ? "up" : "down"}`; }
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          const dir = (e.key === "ArrowRight") !== rtl ? 1 : -1;
          const to = c.placed ? real[si + dir] : real[real.length - 1];
          if (to) { b = placeConcept(body, c, to.name, null); msg = `${c.def.name} moved to ${to.name}`; }
        }
        if (b === null) return;
        e.preventDefault();
        if (b !== body) { save(b); announce(msg); refocus(sel$("data-concept", c.key)); }
      },
    };
  };
  const colOver = (e: DragEvent, s: Col) => {
    if (!editable) return;
    const k = dragKind(e);
    const unplaced = s.name === UNPLACED;
    if (k === "concept") { e.preventDefault(); set({ kind: "end", stage: s.name }); }
    else if (k === "note" && !unplaced) { e.preventDefault(); set({ kind: "end", stage: s.name }); }
    else if (k === "stage" && !unplaced && dragging()?.id !== s.name) { e.preventDefault(); set({ kind: zoneX(e) === "before" ? "col-before" : "col-after", stage: s.name }); }
  };
  const colDrop = (e: DragEvent, s: Col) => {
    const k = dragKind(e);
    const h = hint;
    e.preventDefault();
    if (!k || !h || !("stage" in h)) return finish();
    const id = dropData(e, k);
    finish();
    if (k === "stage") {
      const i = real.findIndex((x) => x.name === s.name);
      const before = h.kind === "col-before" ? s.name : real[i + 1]?.name ?? null;
      save(reorderStage(body, id, before));
      announce(`Moved stage ${id}`);
    } else if (k === "concept") {
      const c = path.byKey.get(id);
      if (!c) return;
      if (s.name === UNPLACED) { if (c.placed) { save(removeConcept(body, c)); announce(`${c.def.name} taken out of the path`); } return; }
      save(placeConcept(body, c, s.name, null));
      announce(`Moved ${c.def.name} to ${s.name}`);
    } else if (k === "note") {
      const b = addConcept(body, s.name, id, { note: id });
      if (unchanged(b)) toast(`“${id}” is already in this path`); else { save(b); announce(`Added ${id}`); }
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 min-w-0 flex-1 items-start gap-3 overflow-auto px-7 py-4" onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHint(null); }} onDragEnd={finish}>
        {cols.map((s, i) => {
          const done = s.concepts.filter((c) => c.status === "done").length;
          const full = editable ? path.stages.find((x) => x.name === s.name)?.concepts ?? s.concepts : s.concepts;
          const fdone = full.filter((c) => c.status === "done").length;
          const unplaced = s.name === UNPLACED;
          const ch = hint && "stage" in hint && hint.stage === s.name ? hint.kind : null;
          const dropCls = cx(ch === "end" && "lp-col-over", ch === "col-before" && "pdnd-col-before", ch === "col-after" && "pdnd-col-after");
          const label = s.label ?? shortStage(s.name);
          if (unplaced) {
            return (
              <section key={s.name} data-stage={s.name} onDragOver={(e) => colOver(e, s)} onDrop={(e) => colDrop(e, s)}
                className={cx("flex max-h-full w-[200px] shrink-0 flex-col gap-2 rounded-[12px] border-[1.5px] border-dashed border-line p-3 text-muted", dropCls)}>
                <span className="font-semibold text-ink">{UNPLACED} · {s.concepts.length}</span>
                <span className="text-[12px] leading-[17px]">Drop on a stage, or let Organize place them.</span>
                <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
                  {s.concepts.map((c, ci) => {
                    const d = cardDnd(c, s, ci);
                    return (
                      <button key={c.key} draggable data-concept={c.key} data-pdnd-row onClick={() => onOpen(c.key)} onDragStart={(e) => { startDrag(e, "concept", c.key, c.def.name); dragGhost(e, c.def.name); }} onDragEnd={() => endDrag()}
                        onDragOver={d.over} onDrop={d.drop} onKeyDown={d.key} className={cx("lp-card relative rounded-[8px] bg-surface px-2.5 py-2 text-left text-ink", d.cls)}>
                        <span dir="auto">{c.def.name}</span>{d.tag && <span className="pdnd-tag">{d.tag}</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          }
          if (collapsed.includes(s.name)) {
            return (
              <section key={s.name} data-stage={s.name} onDragOver={(e) => colOver(e, s)} onDrop={(e) => colDrop(e, s)}
                className={cx("flex w-11 shrink-0 cursor-pointer flex-col items-center gap-2.5 self-stretch rounded-[10px] border border-line bg-surface py-2.5", dropCls)} onClick={() => toggleCol(s.name)} title={`Expand ${label}`}>
                <span className="flex size-5 items-center justify-center rounded-[6px] bg-surface-2 text-[11px] font-[650]" style={s.color ? { boxShadow: `inset 0 -2px 0 ${s.color}` } : undefined}>{editable ? i + 1 : label[0]}</span>
                <button aria-label={`Expand ${label}`} onClick={(e) => { e.stopPropagation(); toggleCol(s.name); }} className="text-muted hover:text-ink"><ChevronsRight size={13} /></button>
                <span className="whitespace-nowrap font-semibold [writing-mode:vertical-rl]" dir="auto">{label} · {fdone}/{full.length}</span>
              </section>
            );
          }
          return (
            <section key={s.name} data-stage={s.name} onDragOver={(e) => colOver(e, s)} onDrop={(e) => colDrop(e, s)}
              className={cx("flex w-[228px] shrink-0 flex-col gap-2 rounded-[10px]", dropCls)}>
              <header className="group flex flex-col gap-1.5 px-0.5 pb-1 pt-0.5" draggable={editable} data-stage-head={s.name}
                onDragStart={(e) => { if ((e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); return; } startDrag(e, "stage", s.name); dragGhost(e, label); }} onDragEnd={finish}>
                <div className="flex items-center gap-2">
                  <span className="flex size-5 shrink-0 cursor-grab items-center justify-center rounded-[6px] bg-surface-2 text-[11px] font-[650]" style={s.color ? { boxShadow: `inset 0 -2px 0 ${s.color}` } : undefined}>{editable ? i + 1 : label[0]}</span>
                  {editable ? (
                    <input dir="auto" defaultValue={s.name} key={s.name} aria-label="Stage name" title={s.name}
                      onKeyDown={(e) => {
                        if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                          e.preventDefault();
                          const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
                          save(moveStage(body, s.name, (e.key === "ArrowRight") !== rtl ? 1 : -1));
                          refocus(`${sel$("data-stage-head", s.name)} input`);
                        } else if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && save(renameStage(body, s.name, e.target.value.trim()))}
                      className="min-w-0 flex-1 truncate bg-transparent font-[650] outline-none" />
                  ) : <span className="min-w-0 flex-1 truncate font-[650]" dir="auto">{label}</span>}
                  <span className="text-[12px] tabular-nums text-muted">{editable ? fdone : done}/{editable ? full.length : s.concepts.length}</span>
                  {editable && !full.length && <button title="Delete stage" aria-label="Delete stage" onClick={() => save(removeStage(body, s.name))} className="hidden text-muted hover:text-bad group-hover:block"><Trash2 size={12} /></button>}
                  <button aria-label={`Collapse ${label}`} title="Collapse" onClick={() => toggleCol(s.name)} className="text-muted hover:text-ink"><ChevronsLeft size={13} /></button>
                </div>
                <span className="h-1 overflow-hidden rounded-[2px] bg-surface-2"><span className="block h-full bg-ok" style={{ width: `${full.length ? (fdone / full.length) * 100 : 0}%` }} /></span>
              </header>
              {s.concepts.map((c, ci) => <ConceptCard key={c.key} c={c} onOpen={onOpen} sel={sel === c.key} drag dnd={cardDnd(c, s, ci)} res={resN.get(c.key) ?? 0} />)}
              {editable && <AddConcept onAdd={(n) => { const b = addConcept(body, s.name, n); if (unchanged(b)) toast(`“${n}” is already in this path`); else { save(b); announce(`Added ${n}`); } }} />}
            </section>
          );
        })}
        {editable && (
          <div className="flex w-[200px] shrink-0 flex-col gap-2">
            <form onSubmit={(e) => { e.preventDefault(); if (newStage.trim()) { save(addStage(body, newStage.trim())); setNewStage(""); } }}>
              <input value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="+ New stage" aria-label="New stage" className={inputCls} />
            </form>
            <button onClick={() => setTray((t) => !t)} aria-pressed={tray} title="Drag notes in to make them concepts"
              className={cx("flex h-8 items-center gap-1.5 rounded-[8px] border px-2.5 text-[12.5px]", tray ? "border-accent/50 bg-accent/10 text-ink" : "border-line text-muted hover:text-ink")}><NotebookPen size={13} />Add notes</button>
          </div>
        )}
      </div>
      {tray && editable && <NotesTray className="w-[260px] shrink-0 border-l" spaceId={note.spaceId} used={used} onClose={() => setTray(false)} title="Notes → concepts"
        hint={<>Drag a note into a stage to make it a concept, or onto a concept to link it.</>}
        onPick={(n) => { const b = addConcept(body, real[real.length - 1]?.name ?? "Stage 1", n.title, { note: n.title }); if (unchanged(b)) toast(`“${n.title}” is already in this path`); else save(b); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ phone
/** Phone: everything drag does on desktop, as an explicit menu (no hover, no drag). */
function PhoneConceptMenu({ c, path, note, save, confirm, onClose }: { c: BuiltConcept; path: BuiltPath; note: Note; save: (b: string) => void; confirm: Ask; onClose: () => void }) {
  const [mode, setMode] = useState<"main" | "stage" | "merge">("main");
  useEscape(onClose);
  const [q, setQ] = useState("");
  const stages = path.doc.stages.map((s) => s.name);
  const run = (b: string, msg: string) => { save(b); announce(msg); toast(msg); onClose(); };
  const row = "flex min-h-[48px] w-full items-center gap-3 rounded-[10px] px-3 text-left text-[15px] active:bg-surface-2";
  const idx = path.stages.find((s) => s.name === c.stage)?.concepts.findIndex((x) => x.key === c.key) ?? -1;
  const n = path.stages.find((s) => s.name === c.stage)?.concepts.length ?? 0;
  const targets = path.concepts.filter((x) => x.key !== c.key && (!q || x.def.name.toLowerCase().includes(q.toLowerCase()))).slice(0, 60);
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "rgba(5,6,8,.55)" }} onClick={onClose} />
      <div role="dialog" aria-label={`Move ${c.def.name}`} className="sheet-in safe-b fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col rounded-t-[14px] bg-surface px-2 pb-3 pt-2.5">
        <div className="flex justify-center pb-2"><span className="h-1 w-9 rounded-[2px] bg-line" /></div>
        <div className="flex items-center gap-2 px-3 pb-2"><span dir="auto" className="min-w-0 flex-1 truncate text-[16px] font-semibold">{c.def.name}</span><button aria-label="Close" onClick={onClose} className="p-2 text-muted"><X size={18} /></button></div>
        <div className="min-h-0 overflow-y-auto">
          {mode === "main" && (
            <>
              {c.placed && idx > 0 && <button className={row} onClick={() => run(nudgeConcept(note.body, c, -1), `${c.def.name} moved up`)}><ArrowUp size={16} />Move up</button>}
              {c.placed && idx >= 0 && idx < n - 1 && <button className={row} onClick={() => run(nudgeConcept(note.body, c, 1), `${c.def.name} moved down`)}><ArrowDown size={16} />Move down</button>}
              <button className={row} onClick={() => setMode("stage")}><Layers size={16} />{c.placed ? "Move to stage…" : "Place in a stage…"}</button>
              <button className={row} onClick={() => setMode("merge")}><GitMerge size={16} />Merge into another concept…</button>
              {c.placed && <button className={cx(row, "text-bad")} onClick={() => run(removeConcept(note.body, c), `${c.def.name} taken out of the path`)}><Trash2 size={16} />Take out of the path</button>}
            </>
          )}
          {mode === "stage" && (stages.length ? stages.filter((s) => s !== c.stage).map((s) => (
            <button key={s} className={row} onClick={() => run(placeConcept(note.body, c, s, null), `${c.def.name} moved to ${s}`)}><span dir="auto" className="truncate">{s}</span></button>
          )) : <p className="px-3 py-2 text-[13px] text-muted">Add a stage first.</p>)}
          {mode === "merge" && (
            <>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a concept" dir="auto" className={inputCls + " mx-1 mb-1 !w-[calc(100%-8px)]"} />
              {targets.map((x) => (
                <button key={x.key} className={row} onClick={() => { onClose(); confirm(<>Merge “<b dir="auto">{c.def.name}</b>” into “<b dir="auto">{x.def.name}</b>”?</>, "Merge", () => { save(mergeConcepts(note.body, x, c)); toast(`Merged into “${x.def.name}”`); }); }}>
                  <span dir="auto" className="min-w-0 flex-1 truncate">{x.def.name}</span><span className="shrink-0 text-[12px] text-muted">{x.placed ? shortStage(x.stage) : "not placed"}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** Phone accordion (R4-14I): one stage open at a time ("Expand all" opens every stage). */
export function StagesPhone({ path, note, onOpen, save, confirm, keep, group, allOpen }: { path: BuiltPath; note: Note; onOpen: (k: string) => void; save: (b: string) => void; confirm: Ask; keep: (c: BuiltConcept) => boolean; group: GroupBy; allOpen: boolean }) {
  const cols = groupColumns(path, group, keep);
  const firstOpen = cols.find((s) => s.concepts.some((c) => c.status !== "done"))?.name ?? cols[0]?.name ?? null;
  const [open, setOpen] = useState<string | null>(firstOpen);
  const [newStage, setNewStage] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [notes, setNotes] = useState(false);
  const menuC = menu ? path.byKey.get(menu) : null;
  const used = useMemo(() => new Set(path.concepts.flatMap((c) => [c.key, ...c.def.notes.map((n) => n.toLowerCase())]).concat(path.concepts.map((c) => c.def.name.toLowerCase()))), [path]);
  const lastStage = path.doc.stages[path.doc.stages.length - 1]?.name ?? "Stage 1";
  const editable = group === "stage";
  return (
    <div className="flex flex-col gap-2 px-4 pb-24">
      {!path.courses.length && <p className="px-1 text-[12.5px] leading-relaxed text-muted">No courses yet: build your own path. Add stages, type concepts, or add notes as concepts.</p>}
      {cols.map((s, i) => {
        if (s.name === UNPLACED && !s.concepts.length) return null;
        const full = editable ? path.stages.find((x) => x.name === s.name)?.concepts ?? s.concepts : s.concepts;
        const done = full.filter((c) => c.status === "done").length;
        const unplaced = s.name === UNPLACED;
        const isOpen = allOpen || open === s.name;
        const label = s.label ?? shortStage(s.name);
        return (
          <section key={s.name} data-stage={s.name} className={cx("shrink-0 overflow-hidden rounded-[12px]", unplaced ? "border-[1.5px] border-dashed border-line" : "border border-line bg-surface")}>
            <button onClick={() => setOpen(isOpen && !allOpen ? null : s.name)} aria-expanded={isOpen} className="flex h-[52px] w-full items-center gap-2.5 px-3 text-left">
              <span className="flex size-[22px] shrink-0 items-center justify-center rounded-[6px] bg-surface-2 text-[11px] font-[650]">{unplaced ? "•" : editable ? i + 1 : label[0]}</span>
              <span dir="auto" className="min-w-0 flex-1 truncate font-semibold">{unplaced ? UNPLACED : label}</span>
              <span className="text-[12px] tabular-nums text-muted">{done}/{full.length}</span>
              <span className="h-1 w-10 overflow-hidden rounded-[2px] bg-surface-2"><span className="block h-full bg-ok" style={{ width: `${full.length ? (done / full.length) * 100 : 0}%` }} /></span>
              {isOpen ? <ChevronUp size={15} className="text-muted" /> : <ChevronDown size={15} className="text-muted" />}
            </button>
            {isOpen && (
              <div className="flex flex-col gap-1 px-2 pb-2">
                {unplaced && <p className="px-1 pb-1 text-[12px] text-muted">Course topics not in any stage yet. Use ⋯ to place one, or Organize.</p>}
                {s.concepts.map((c) => {
                  const courses = conceptCourses(c);
                  return (
                    <div key={c.key} className="flex min-h-[48px] items-center gap-2.5 rounded-[8px] bg-bg pe-1 ps-2.5" style={{ opacity: c.status === "locked" ? 0.5 : 1 }}>
                      <button data-concept={c.key} onClick={() => onOpen(c.key)} className="flex min-h-[48px] min-w-0 flex-1 items-center gap-2.5 text-left">
                        <StatusIcon c={c} size={16} />
                        <span dir="auto" className="min-w-0 flex-1 font-medium">{c.def.name}</span>
                        <span className="flex gap-[3px]">{courses.slice(0, 3).map((k) => <span key={k.key} className="size-1.5 rounded-full" style={{ background: k.color }} />)}</span>
                        {c.reviewDue && <span className="rounded-full px-1.5 text-[11px] font-semibold leading-[17px]" style={{ background: "color-mix(in srgb,var(--learn) 16%,transparent)", color: "var(--learn)" }}>revise</span>}
                      </button>
                      <button aria-label={`Move or merge ${c.def.name}`} onClick={() => setMenu(c.key)} className="flex size-10 shrink-0 items-center justify-center text-muted"><MoreHorizontal size={18} /></button>
                    </div>
                  );
                })}
                {editable && !unplaced && <AddConcept big onAdd={(n) => { const b = addConcept(note.body, s.name, n); if (b === serializePath(path.doc)) toast(`“${n}” is already in this path`); else save(b); }} />}
                {editable && !unplaced && (
                  <div className="flex justify-end gap-3 px-1 pt-1 text-[12px] text-muted">
                    {i > 0 && <button onClick={() => save(moveStage(note.body, s.name, -1))} className="flex items-center gap-1 py-1"><ArrowUp size={12} /> Move up</button>}
                    {i < path.stages.length - 1 && path.stages[i + 1]?.name !== UNPLACED && <button onClick={() => save(moveStage(note.body, s.name, 1))} className="flex items-center gap-1 py-1"><ArrowDown size={12} /> Move down</button>}
                    {!full.length && <button onClick={() => save(removeStage(note.body, s.name))} className="flex items-center gap-1 py-1"><Trash2 size={12} /> Delete</button>}
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
      {editable && (
        <>
          <form onSubmit={(e) => { e.preventDefault(); if (newStage.trim()) { save(addStage(note.body, newStage.trim())); setNewStage(""); } }}>
            <input value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="+ New stage" className={inputCls} />
          </form>
          <button onClick={() => setNotes(true)} className="flex h-11 items-center justify-center gap-2 rounded-[12px] border border-line text-[14px] text-muted"><NotebookPen size={15} />Add notes as concepts</button>
        </>
      )}
      {notes && (
        <>
          <div className="fixed inset-0 z-40" style={{ background: "rgba(5,6,8,.55)" }} onClick={() => setNotes(false)} />
          <div className="sheet-in safe-b fixed inset-x-0 bottom-0 z-50 flex h-[70dvh] flex-col overflow-hidden rounded-t-[14px] border-t border-line">
            <NotesTray className="h-full" spaceId={note.spaceId} used={used} onClose={() => setNotes(false)} title="Add notes as concepts" hint={<>Tap + to add a note as a concept in the last stage ({shortStage(lastStage)}).</>}
              onPick={(n) => { save(addConcept(note.body, lastStage, n.title, { note: n.title })); toast(`Added “${n.title}”`); }} />
          </div>
        </>
      )}
      {menuC && <PhoneConceptMenu c={menuC} path={path} note={note} save={save} confirm={confirm} onClose={() => setMenu(null)} />}
    </div>
  );
}
