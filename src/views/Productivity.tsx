import { Glyph } from "../components/Glyph";
import { SpaceIcon } from "../components/SpaceIcon";
import { EmptyState } from "../components/EmptyState";
import { ArrowDown, ArrowUp, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Columns3, FileText, GripVertical, Layers, ListChecks, NotebookPen, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NOTE_TYPES, STATUSES, type Note, type NoteType } from "../../shared/types";
import { createNote, purgeNote, restoreNote, updateNote } from "../lib/actions";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { flashcards, tasks, toggleTask, words } from "../lib/parse";
import { matcher, parseQuery } from "../lib/search";
import { go, openNote, scoped, setUI, useUI, useVault, type View } from "../lib/store";
import { openNoteAtLine } from "../components/study-nav";
import { ReviewSession, useDueCards } from "../components/Review";
import { Button, cx, relTime, STATUS_COLOR, StatusDot } from "../components/ui";
import { dragNote } from "../components/Sidebar";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => iso(new Date());
const Header = ({ title, sub, count, children }: { title: React.ReactNode; sub?: string; count?: React.ReactNode; children?: React.ReactNode }) => (
  <div className="mt-[env(safe-area-inset-top)] flex shrink-0 flex-wrap items-center gap-3.5 px-4 pb-3 pt-4 md:px-8 md:pt-6">
    <div className="flex min-w-0 items-baseline gap-3">
      <span className="text-[22px] font-[650] tracking-[-.02em]">{title}</span>
      {count != null && <span className="text-[13px] text-muted">{count}</span>}
    </div>
    {children}
    {sub && <div className="w-full text-[12px] text-muted">{sub}</div>}
  </div>
);

/** List · Kanban · Calendar lens switch. */
function Lens({ value }: { value: View }) {
  const opts: [View, string, typeof ListChecks][] = [["tasks", "List", ListChecks], ["kanban", "Kanban", Columns3], ["calendar", "Calendar", CalendarDays]];
  return (
    <div className="flex gap-0.5 rounded-[10px] border border-line bg-surface p-[3px] text-[13px]">
      {opts.map(([v, l, I]) => (
        <button key={v} onClick={() => go(v)} className={cx("flex h-7 items-center gap-1.5 rounded-[7px] px-3", value === v ? "bg-surface-2 font-semibold" : "text-muted hover:text-ink")}>
          <I size={14} /><span className="hidden sm:inline">{l}</span>
        </button>
      ))}
    </div>
  );
}

const Box = ({ done, onClick }: { done: boolean; onClick?: () => void }) => (
  <button onClick={onClick} aria-label={done ? "Mark not done" : "Mark done"} className={cx("flex size-4 shrink-0 items-center justify-center rounded-[5px]", done ? "bg-ok" : "border-[1.5px] border-muted hover:border-accent")}>
    {done && <Check size={11} strokeWidth={3} className="text-bg" />}
  </button>
);

function dueLabel(d: string, t0: string) {
  if (d === t0) return "Today";
  const dt = new Date(d + "T12:00");
  const days = Math.round((dt.getTime() - new Date(t0 + "T12:00").getTime()) / 86_400_000);
  if (days === 1) return "Tomorrow";
  const mon = dt.toLocaleDateString("en-GB", { month: "short" });
  if (days > 1 && days < 7) return `${dt.toLocaleDateString("en-GB", { weekday: "short" })} ${dt.getDate()}`;
  return `${dt.getDate()} ${mon}${dt.getFullYear() !== new Date().getFullYear() ? " " + dt.getFullYear() : ""}`;
}

/** `📅 fri`, `📅 tomorrow`, `📅 today` → `📅 YYYY-MM-DD`. */
function expandDate(text: string) {
  return text.replace(/📅\s*(today|tomorrow|mon|tue|wed|thu|fri|sat|sun)\w*/i, (_m, w: string) => {
    const d = new Date();
    const k = w.toLowerCase();
    if (k === "tomorrow") d.setDate(d.getDate() + 1);
    else if (k !== "today") { const target = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(k); d.setDate(d.getDate() + (((target - d.getDay() + 7) % 7) || 7)); }
    return "📅 " + iso(d);
  });
}

// ------------------------------------------------------------------ Tasks
type TaskRow = ReturnType<typeof tasks>[number] & { note: Note };
const taskKey = (t: TaskRow) => `${t.note.id}:${t.line}`;

/** Replace (or add / remove) the `📅 YYYY-MM-DD` date on one task line. */
function setTaskDue(md: string, line: number, date: string | null) {
  const lines = md.split("\n");
  let l = (lines[line] ?? "").replace(/\s*(📅\s*\d{4}-\d{2}-\d{2}|@due\(\d{4}-\d{2}-\d{2}\))/u, "");
  if (date) l = l.replace(/\s*$/, "") + " 📅 " + date;
  lines[line] = l;
  return lines.join("\n");
}

/** Fixed-position popover anchored under an element (escapes overflow-hidden tables and lists). */
function Pop({ anchor, onClose, children, width = 220, align = "left", at }: { anchor: HTMLElement; onClose: () => void; children: React.ReactNode; width?: number; align?: "left" | "right"; at?: { right: number; top: number } }) {
  const ref = useRef<HTMLDivElement>(null);
  const r = anchor.getBoundingClientRect();
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    addEventListener("mousedown", h); addEventListener("keydown", k, true);
    return () => { removeEventListener("mousedown", h); removeEventListener("keydown", k, true); };
  }, [anchor, onClose]);
  const left = at ? at.right - width : Math.max(8, Math.min(innerWidth - width - 8, align === "right" ? r.right - width : r.left));
  const top = at ? at.top : r.bottom + 6 + 260 > innerHeight ? Math.max(8, r.top - 6 - 260) : r.bottom + 6;
  return (
    <div ref={ref} onClick={(e) => e.stopPropagation()} className="fixed z-50 flex flex-col gap-px rounded-[10px] border border-line bg-surface-2 p-1.5 text-[13px] shadow-[0_12px_32px_rgba(0,0,0,.4)] fade-in" style={{ left, top, width }}>
      {children}
    </div>
  );
}
const MenuItem = ({ on, children, onClick }: { on?: boolean; children: React.ReactNode; onClick: () => void }) => (
  <button onClick={onClick} className={cx("flex h-[30px] items-center gap-2.5 rounded-[6px] px-2 text-left hover:bg-surface", on && "font-semibold")}>
    {children}<span className="flex-1" />{on && <Check size={13} className="text-accent" />}
  </button>
);

function DuePicker({ anchor, value, onPick, onClose }: { anchor: HTMLElement; value: string | null; onPick: (d: string | null) => void; onClose: () => void }) {
  const [d, setD] = useState(value ?? today());
  const add = (n: number) => { const x = new Date(); x.setDate(x.getDate() + n); return iso(x); };
  const nextMon = () => { const x = new Date(); x.setDate(x.getDate() + (((8 - x.getDay()) % 7) || 7)); return iso(x); };
  return (
    <Pop anchor={anchor} onClose={onClose} width={220} align="right">
      <span className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Due date</span>
      <MenuItem onClick={() => onPick(today())}>Today</MenuItem>
      <MenuItem onClick={() => onPick(add(1))}>Tomorrow</MenuItem>
      <MenuItem onClick={() => onPick(nextMon())}>Next week</MenuItem>
      <div className="flex items-center gap-1.5 px-1 py-1">
        <input autoFocus type="date" value={d} onChange={(e) => setD(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && d) onPick(d); }} className="h-7 min-w-0 flex-1 rounded-[6px] border border-line bg-surface px-1.5 text-[12.5px] [color-scheme:dark] focus:border-accent focus:outline-none" />
        <button onClick={() => d && onPick(d)} className="h-7 rounded-[6px] bg-accent px-2 text-[12px] font-semibold text-accent-fg">Set</button>
      </div>
      {value && <MenuItem onClick={() => onPick(null)}><span className="text-bad">Remove date</span></MenuItem>}
    </Pop>
  );
}

function SpacePicker() {
  const v = useVault();
  const ui = useUI();
  const [open, setOpen] = useState<HTMLElement | null>(null);
  const sp = ui.spaceId !== "all" ? v.spaceMap.get(ui.spaceId) : null;
  return (
    <>
      <button onClick={(e) => setOpen(open ? null : e.currentTarget)} className="flex h-[30px] items-center gap-1.5 rounded-[8px] border border-line px-2.5 text-[13px] text-muted hover:text-ink">
        {sp ? <><SpaceIcon space={sp} size={15} />{sp.name}</> : <><Glyph name="globe" size={15} color="#57AB5A" />All spaces</>}<ChevronDown size={12} />
      </button>
      {open && (
        <Pop anchor={open} onClose={() => setOpen(null)} align="right" width={220}>
          <MenuItem on={!sp} onClick={() => { setUI({ spaceId: "all", folderId: null }); setOpen(null); }}><span className="flex items-center gap-1.5"><Glyph name="globe" size={15} color="#57AB5A" />All spaces</span></MenuItem>
          {v.spaces.filter((s) => !s.archived).map((s) => <MenuItem key={s.id} on={sp?.id === s.id} onClick={() => { setUI({ spaceId: s.id, folderId: null }); setOpen(null); }}><span className="flex min-w-0 items-center gap-1.5"><SpaceIcon space={s} size={15} /><span className="truncate">{s.name}</span></span></MenuItem>)}
        </Pop>
      )}
    </>
  );
}

export function TasksView() {
  const v = useVault();
  const ui = useUI();
  const [folded, setFolded] = useState<Set<string>>(() => new Set(["Done"]));
  const [draft, setDraft] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [dating, setDating] = useState<{ key: string; el: HTMLElement } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const all = useMemo<TaskRow[]>(() => scoped(v, { ...ui, folderId: null, tag: null }).filter((n) => n.type !== "roadmap").flatMap((n) => tasks(n.body).map((t) => ({ ...t, note: n }))), [v, ui]);
  const t0 = today();
  const open = all.filter((t) => !t.done);
  const groups: [string, TaskRow[]][] = [
    ["Overdue", open.filter((t) => t.due && t.due < t0).sort((a, b) => a.due!.localeCompare(b.due!))],
    ["Today", open.filter((t) => t.due === t0)],
    ["Upcoming", open.filter((t) => t.due && t.due > t0).sort((a, b) => a.due!.localeCompare(b.due!))],
    ["No date", open.filter((t) => !t.due)],
    ["Done", all.filter((t) => t.done)],
  ];
  const visible = groups.flatMap(([g, ts]) => (folded.has(g) ? [] : ts));
  const toggle = (t: TaskRow) => updateNote(t.note.id, { body: toggleTask(t.note.body, t.line) });
  const setDue = (t: TaskRow, d: string | null) => updateNote(t.note.id, { body: setTaskDue(t.note.body, t.line, d) });
  async function add() {
    const text = expandDate(draft.trim());
    if (!text) return;
    setDraft("");
    let daily = v.notes.find((n) => n.type === "journal" && n.title.includes(t0));
    daily ??= await createNote({ template: "journal", title: `Journal ${t0}`, spaceId: ui.spaceId === "all" ? "inbox" : ui.spaceId });
    const body = daily.body.replace(/\s*$/, "");
    await updateNote(daily.id, { body: `${body}${body ? "\n" : ""}- [ ] ${text}\n` });
  }
  // Keyboard: ↑/↓ (or J/K) select, X toggles, D sets a date, Enter opens the source line.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select,.cm-editor") || e.metaKey || e.ctrlKey || e.altKey || dating) return;
      const key = e.key.toLowerCase();
      const idx = visible.findIndex((t) => taskKey(t) === sel);
      const cur = idx >= 0 ? visible[idx] : null;
      if (key === "arrowdown" || key === "j" || key === "arrowup" || key === "k") {
        e.preventDefault();
        const d = key === "arrowdown" || key === "j" ? 1 : -1;
        const nx = visible[Math.max(0, Math.min(visible.length - 1, idx < 0 ? 0 : idx + d))];
        if (nx) { setSel(taskKey(nx)); rowRefs.current.get(taskKey(nx))?.scrollIntoView({ block: "nearest" }); }
      } else if (key === "x" && cur) { e.preventDefault(); void toggle(cur); }
      else if (key === "d" && cur) { e.preventDefault(); const el = rowRefs.current.get(taskKey(cur))?.querySelector<HTMLElement>("[data-due]"); if (el) setDating({ key: taskKey(cur), el }); }
      else if (key === "enter" && cur) { e.preventDefault(); openNoteAtLine(cur.note.id, cur.line, cur.note.body); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });
  const datingTask = dating ? all.find((t) => taskKey(t) === dating.key) : null;
  return (
    <div className="flex h-full flex-col">
      <div className="mt-[env(safe-area-inset-top)] flex shrink-0 flex-wrap items-center gap-3.5 px-4 pb-[18px] pt-4 md:px-12 md:pt-6">
        <span className="text-[22px] font-[650] tracking-[-.02em]">Tasks</span>
        <Lens value="tasks" />
        <span className="flex-1" />
        <SpacePicker />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 md:px-12">
        <label className="mb-[18px] flex h-11 items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5 text-[13px] text-muted focus-within:border-accent">
          <Plus size={15} className="shrink-0" />
          <span className="relative min-w-0 flex-1">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} aria-label="Add a task" className="w-full bg-transparent text-ink focus:outline-none" />
            {!draft && <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center truncate">Add a task… <span className="mx-1 inline-flex items-center gap-1 font-mono text-[12px]"><Glyph name="date" size={12} />fri</span> sets a date</span>}
          </span>
          <span className="hidden shrink-0 text-[12px] sm:inline">goes to today's daily note</span>
        </label>
        <div className="flex max-w-[900px] flex-col gap-[18px]">
          {groups.map(([g, ts]) => ts.length ? (
            <section key={g} className="flex flex-col gap-0.5">
              <button onClick={() => setFolded((f) => { const n = new Set(f); n.has(g) ? n.delete(g) : n.add(g); return n; })} className={cx("flex items-center gap-2 px-1 pb-1.5 text-left text-[13px] font-semibold", g === "Overdue" ? "text-bad" : "text-ink")}>
                {folded.has(g) ? <ChevronRight size={13} className="text-muted" /> : <ChevronDown size={13} className="text-muted" />}{g}<span className="font-normal text-muted">{ts.length}</span>
              </button>
              {!folded.has(g) && ts.map((t) => {
                const k = taskKey(t);
                return (
                  <div key={k} ref={(el) => { if (el) rowRefs.current.set(k, el); else rowRefs.current.delete(k); }} onMouseEnter={() => setSel(k)}
                    className={cx("flex min-h-10 items-center gap-3 rounded-[8px] px-3 py-1.5 text-[13px]", sel === k && "bg-surface")}>
                    <Box done={t.done} onClick={() => toggle(t)} />
                    <span className={cx("min-w-0 flex-1", t.done && "text-muted line-through")} dir="auto">{t.text}</span>
                    <button onClick={() => openNoteAtLine(t.note.id, t.line, t.note.body)} title="Open the note at this line" className="hidden max-w-[260px] items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[6px] bg-surface px-2 py-0.5 text-[12px] text-muted hover:text-link sm:flex">
                      <FileText size={12} className="shrink-0" /><span className="truncate">{t.note.title}</span>
                    </button>
                    <button data-due onClick={(e) => setDating({ key: k, el: e.currentTarget })} title="Set a date (D)" className={cx("w-20 shrink-0 text-right text-[12px] hover:text-ink", !t.done && t.due && t.due < t0 ? "text-bad" : !t.done && t.due === t0 ? "text-warn" : "text-muted")}>{t.due ? dueLabel(t.due, t0) : ""}</button>
                  </div>
                );
              })}
            </section>
          ) : null)}
          {!all.length && <EmptyState glyph="task" text="No tasks yet. Write - [ ] in any note, or add one above." action={{ label: "Add a task", onClick: () => document.querySelector<HTMLInputElement>('input[aria-label="Add a task"]')?.focus() }} />}
        </div>
      </div>
      {dating && datingTask && <DuePicker anchor={dating.el} value={datingTask.due} onClose={() => setDating(null)} onPick={(d) => { void setDue(datingTask, d); setDating(null); }} />}
    </div>
  );
}

// ------------------------------------------------------------------ Kanban (notes by learning status)
export function KanbanView() {
  const v = useVault();
  const ui = useUI();
  const inScope = scoped(v, ui).filter((n) => n.type !== "canvas" && n.type !== "whiteboard" && n.type !== "roadmap");
  const hasLessons = inScope.some((n) => n.type === "lesson");
  const [typeFilter, setTypeFilter] = useState<"lesson" | "any">("lesson");
  const lessonsOnly = typeFilter === "lesson" && hasLessons;
  const notes = lessonsOnly ? inScope.filter((n) => n.type === "lesson") : inScope;
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const space = ui.spaceId !== "all" ? v.spaceMap.get(ui.spaceId) : null;
  function lift(e: React.DragEvent<HTMLElement>, id: string) {
    dragNote(e, id);
    setDragging(id);
    // Drag image: the card lifted with a 2° tilt and a soft shadow.
    const src = e.currentTarget;
    const ghost = src.cloneNode(true) as HTMLElement;
    Object.assign(ghost.style, { position: "fixed", top: "-1000px", left: "-1000px", width: `${src.offsetWidth}px`, transform: "rotate(2deg)", boxShadow: "0 16px 32px rgba(0,0,0,.5)", borderColor: "var(--accent)", pointerEvents: "none" });
    const wrap = document.createElement("div");
    Object.assign(wrap.style, { position: "fixed", top: "-1000px", left: "-1000px", padding: "24px" });
    ghost.style.position = "static";
    wrap.appendChild(ghost);
    document.body.appendChild(wrap);
    try { e.dataTransfer.setDragImage(wrap, e.nativeEvent.offsetX + 24, e.nativeEvent.offsetY + 24); } catch { /* ignore */ }
    setTimeout(() => wrap.remove(), 0);
  }
  return (
    <div className="flex h-full flex-col">
      <div className="mt-[env(safe-area-inset-top)] flex shrink-0 flex-wrap items-center gap-3.5 px-4 pb-[18px] pt-4 md:px-8 md:pt-6">
        <span className="text-[22px] font-[650] tracking-[-.02em]">Learning board</span>
        <Lens value="kanban" />
        <span className="flex-1" />
        <button onClick={() => setTypeFilter((t) => (t === "lesson" ? "any" : "lesson"))} title="Toggle the type filter" className="hidden text-[13px] text-muted hover:text-ink md:inline">
          <span className="flex items-center gap-1.5">{space ? <><SpaceIcon space={space} size={15} />{space.name}</> : <><Glyph name="globe" size={15} color="#57AB5A" />All spaces</>}{lessonsOnly ? " · type: lesson" : " · all types"}</span>
        </button>
      </div>
      <div className="grid min-h-0 flex-1 auto-cols-[minmax(240px,1fr)] grid-flow-col gap-3.5 overflow-x-auto px-3 pb-6 md:grid-flow-row md:grid-cols-4 md:px-8">
        {STATUSES.map((c) => {
          // Notes without a status sit in Todo until moved.
          const items = notes.filter((n) => (n.status ?? "todo") === c).sort((a, b) => b.updatedAt - a.updatedAt);
          const dragNoteObj = dragging ? notes.find((n) => n.id === dragging) : null;
          const slot = over === c && dragNoteObj && (dragNoteObj.status ?? "todo") !== c;
          return (
            <div key={c}
              onDragOver={(e) => { e.preventDefault(); setOver(c); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
              onDrop={(e) => { e.preventDefault(); setOver(null); setDragging(null); const raw = e.dataTransfer.getData("application/x-lumen"); if (raw) { const d = JSON.parse(raw); if (d.kind === "note") void updateNote(d.id, { status: c }); } }}
              className="flex min-h-0 flex-col gap-2 rounded-[14px] bg-surface p-2.5">
              <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-1 text-[13px] font-semibold capitalize leading-4">
                <span className="size-2 rounded-full" style={{ background: STATUS_COLOR[c] }} />{c}
                <span className="font-normal text-muted">{items.length}</span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                {items.map((n) => {
                  const f = n.folderId ? v.folderMap.get(n.folderId) : null;
                  const cards = flashcards(n.body).length;
                  return (
                    <button key={n.id} draggable onDragStart={(e) => lift(e, n.id)} onDragEnd={() => { setDragging(null); setOver(null); }} onClick={() => openNote(n.id)}
                      className={cx("flex w-full shrink-0 flex-col gap-2 rounded-[10px] border border-transparent bg-surface-2 p-3 text-left text-[13px] hover:border-accent", dragging === n.id && "!border-[1.5px] !border-dashed !border-line [&>*]:opacity-0")}>
                      <span className="font-semibold leading-[18px]" dir="auto">{n.title}</span>
                      <span className="flex items-center gap-1.5 text-[11.5px] leading-[14px] text-muted">
                        {f ? <><span className="size-[7px] shrink-0 rounded-[2px]" style={{ background: f.color ?? "var(--muted)" }} /><span className="flex-1 truncate">{f.name}</span></> : <span className="flex-1 truncate">{n.tags.slice(0, 2).map((t) => "#" + t).join(" ") || v.spaceMap.get(n.spaceId)?.name}</span>}
                        {cards > 0 && <span className="flex items-center gap-1 text-learn"><Layers size={11} />{cards}</span>}
                      </span>
                    </button>
                  );
                })}
                {slot && <div className="h-[66px] shrink-0 rounded-[10px] border-[1.5px] border-dashed border-line" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Calendar
/** Home can ask the calendar to open on a given day (sessionStorage "lumen.calendarDay" = YYYY-MM-DD). */
function takeCalendarDay() {
  try {
    const raw = sessionStorage.getItem("lumen.calendarDay");
    if (raw === null) return null;
    sessionStorage.removeItem("lumen.calendarDay");
    const m = /\d{4}-\d{2}-\d{2}/.exec(raw)?.[0] ?? (Number(raw) ? iso(new Date(Number(raw))) : null);
    return m;
  } catch { return null; }
}

export function CalendarView() {
  const v = useVault();
  const [start] = useState(() => takeCalendarDay() ?? today());
  const [month, setMonth] = useState(() => { const d = new Date(start + "T12:00"); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [sel, setSel] = useState(start);
  const lk = (t: number) => iso(new Date(t));
  const sessions = useLiveQuery(() => db.sessions.toArray(), []);
  const studied = useMemo(() => { const m = new Map<string, number>(); for (const s of sessions ?? []) if (!s.deleted) m.set(lk(s.at), (m.get(lk(s.at)) ?? 0) + s.minutes); return m; }, [sessions]); // eslint-disable-line react-hooks/exhaustive-deps
  const info = useMemo(() => {
    const m = new Map<string, { created: Note[]; journal: Note[]; tasks: { text: string; note: Note; done: boolean; line: number }[] }>();
    const get = (k: string) => m.get(k) ?? (m.set(k, { created: [], journal: [], tasks: [] }), m.get(k)!);
    for (const n of v.notes) {
      if (n.type === "journal") { const d = /\d{4}-\d{2}-\d{2}/.exec(n.title)?.[0] ?? lk(n.createdAt); get(d).journal.push(n); }
      else get(lk(n.createdAt)).created.push(n);
      if (n.type !== "roadmap") for (const t of tasks(n.body)) if (t.due) get(t.due).tasks.push({ text: t.text, note: n, done: t.done, line: t.line });
    }
    return m;
  }, [v.notes]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = new Date(month);
  first.setDate(1 - ((first.getDay() + 6) % 7)); // Monday start
  const days = Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
  const day = info.get(sel);
  const t0 = today();
  const mins = studied.get(sel) ?? 0;
  const sq = "flex size-7 items-center justify-center rounded-[6px] border border-line hover:bg-surface-2";
  const Label = ({ children }: { children: React.ReactNode }) => <div className="mt-1.5 text-[12px] text-muted">{children}</div>;
  return (
    <div className="flex h-full flex-col">
      <div className="mt-[env(safe-area-inset-top)] flex shrink-0 flex-wrap items-center gap-3.5 px-4 pb-4 pt-4 md:px-8 md:pt-6">
        <span className="text-[22px] font-[650] leading-[normal] tracking-[-.02em]">{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
        <span className="flex gap-0.5">
          <button aria-label="Previous month" className={sq} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={14} /></button>
          <button aria-label="Next month" className={sq} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={14} /></button>
        </span>
        <button className="h-7 rounded-[6px] border border-line px-2.5 text-[13px] hover:bg-surface-2" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSel(t0); }}>Today</button>
        <span className="md:hidden"><Lens value="calendar" /></span>
        <span className="ml-auto hidden gap-3.5 text-[12px] text-muted lg:flex">
          <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-ink" />Daily note</span>
          <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-info" />Notes created</span>
          <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-warn" />Tasks due</span>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-6 md:flex-row md:px-8">
        <div className="flex flex-col overflow-hidden rounded-[14px] border border-line md:min-h-0 md:flex-1">
          <div className="grid grid-cols-7 bg-surface text-[12px] leading-[normal] text-muted">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d} className="px-2 py-2 md:px-3">{d}</span>)}</div>
          <div className="grid flex-1 grid-cols-7 grid-rows-6">
            {days.map((d, idx) => {
              const k = iso(d);
              const i = info.get(k);
              const inMonth = d.getMonth() === month.getMonth();
              const isToday = k === t0;
              return (
                <button key={k} onClick={() => setSel(k)}
                  className={cx("flex min-h-12 flex-col gap-1.5 border-t border-line p-1.5 text-left md:min-h-0 md:px-2.5 md:py-2", idx % 7 !== 0 && "border-l", !inMonth && "bg-surface/50", sel === k && !isToday && "bg-surface-2", isToday ? "shadow-[inset_0_0_0_1.5px_var(--accent)]" : "hover:bg-surface-2")}>
                  <span className={cx("flex size-6 items-center justify-center rounded-full text-[12.5px]", isToday ? "bg-accent font-bold text-accent-fg" : inMonth ? "text-ink" : "text-muted")}>{d.getDate()}</span>
                  {inMonth && <span className="flex gap-1">
                    {i?.journal.length ? <span className="size-1.5 rounded-full bg-ink" /> : null}
                    {i?.created.length ? <span className="size-1.5 rounded-full bg-info" /> : null}
                    {i?.tasks.some((t) => !t.done) ? <span className="size-1.5 rounded-full bg-warn" /> : null}
                  </span>}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-3 text-[13px] leading-[normal] md:w-[300px]">
          <span className="text-[15px] font-semibold">{new Date(sel + "T12:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}{sel === t0 ? " · today" : ""}</span>
          {day?.journal.length ? day.journal.map((n) => (
            <button key={n.id} onClick={() => openNote(n.id)} className="flex items-center gap-2.5 rounded-[10px] border border-line bg-surface p-3 text-left hover:border-accent">
              <NotebookPen size={16} className="shrink-0 text-muted" /><span className="flex-1 truncate font-medium">{n.title}</span><ChevronRight size={14} className="text-muted" />
            </button>
          )) : (
            <button onClick={async () => openNote((await createNote({ template: "journal", title: `Journal ${sel}`, spaceId: "inbox" })).id, "edit")} className="flex items-center gap-2.5 rounded-[10px] border border-dashed border-line p-3 text-left text-muted hover:text-ink">
              <Plus size={16} />Daily note for this day
            </button>
          )}
          {day?.tasks.length ? <>
            <Label>Tasks due · {day.tasks.length}</Label>
            {day.tasks.map((t, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <Box done={t.done} onClick={() => updateNote(t.note.id, { body: toggleTask(t.note.body, t.line) })} />
                <button onClick={() => openNoteAtLine(t.note.id, t.line, t.note.body)} className={cx("min-w-0 flex-1 truncate text-left hover:text-link", t.done && "text-muted line-through")} dir="auto">{t.text}</button>
              </div>
            ))}
          </> : null}
          {day?.created.length ? <>
            <Label>Created · {day.created.length}</Label>
            {day.created.map((n) => (
              <button key={n.id} onClick={() => openNote(n.id)} className="flex items-center gap-2 text-left hover:text-link">
                {n.status ? <StatusDot status={n.status} className="!size-[7px] shrink-0" /> : <span className="size-[7px] shrink-0 rounded-full bg-muted" />}<span className="truncate" dir="auto">{n.title}</span>
              </button>
            ))}
          </> : null}
          {mins > 0 && <Label>Studied · {mins >= 60 ? `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, "0")} min` : `${mins} min`}</Label>}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Database table
type Col = "title" | "type" | "status" | "tags" | "folder" | "updated" | "words" | "created" | "cards";
const ALL_COLS: Col[] = ["title", "type", "status", "tags", "folder", "updated", "words", "created", "cards"];
const COL_LABEL: Record<Col, string> = { title: "Title", type: "Type", status: "Status", tags: "Tags", folder: "Folder", updated: "Updated", created: "Created", words: "Words", cards: "Flashcards" };
const COL_W: Record<Col, string> = { title: "2.4fr", type: "1fr", status: "1.1fr", tags: "1.6fr", folder: "1.4fr", updated: "1fr", created: "1fr", words: ".7fr", cards: ".8fr" };
type Sort = { col: Col; dir: 1 | -1 };
type FKey = "status" | "type" | "tag" | "in" | "space" | "is" | "text";
type Chip = { k: FKey; vals: string[] };
const F_LABEL: Record<FKey, string> = { status: "Status", type: "Type", tag: "Tag", in: "Folder", space: "Space", is: "Is", text: "Text" };
const TABLE_KEY = "lumen.table";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const MD_TYPES = NOTE_TYPES.filter((t) => t !== "canvas" && t !== "whiteboard" && t !== "diagram");

function loadTable(): { order: Col[]; hidden: Col[]; sort: Sort[]; chips: Chip[] } {
  const def = { order: ALL_COLS, hidden: ["created", "cards"] as Col[], sort: [{ col: "updated", dir: -1 }] as Sort[], chips: [] as Chip[] };
  try {
    const s = JSON.parse(localStorage.getItem(TABLE_KEY) ?? "null");
    if (!s) return def;
    const order = ((s.order ?? []) as Col[]).filter((c) => ALL_COLS.includes(c));
    return { order: [...order, ...ALL_COLS.filter((c) => !order.includes(c))], hidden: (s.hidden ?? def.hidden).filter((c: Col) => ALL_COLS.includes(c)), sort: s.sort?.length ? s.sort.filter((x: Sort) => ALL_COLS.includes(x.col)) : def.sort, chips: s.chips ?? [] };
  } catch { return def; }
}

/** "12 min ago", "2 h ago", "Today", "Yesterday", "Mon", "8 Nov". */
function updatedLabel(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 3 * 3600) return `${Math.floor(s / 3600)} h ago`;
  const d = new Date(t), now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-GB", { weekday: "short" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

function FilterMenu({ anchor, chip, onSave, onClose }: { anchor: HTMLElement; chip: Chip | null; onSave: (c: Chip | null, typed?: Chip[]) => void; onClose: () => void }) {
  const v = useVault();
  const [k, setK] = useState<FKey | null>(chip?.k ?? null);
  const [vals, setVals] = useState<string[]>(chip?.vals ?? []);
  const [text, setText] = useState("");
  const options = useMemo(() => {
    if (k === "status") return [...STATUSES, "none"];
    if (k === "type") return NOTE_TYPES as string[];
    if (k === "tag") return [...new Set(v.notes.flatMap((n) => n.tags))].sort();
    if (k === "in") return [...new Set(v.folders.map((f) => f.name.toLowerCase()))].sort();
    if (k === "space") return v.spaces.map((s) => s.name.toLowerCase());
    if (k === "is") return ["pinned", "published", "favorite"];
    return [];
  }, [k, v]);
  const shown = options.filter((o) => !text || o.includes(text.toLowerCase()));
  const commit = (next = vals) => onSave(next.length && k ? { k, vals: next } : null);
  const toggle = (o: string) => { const next = vals.includes(o) ? vals.filter((x) => x !== o) : [...vals, o]; setVals(next); commit(next); };
  // Typed operators (same as search): "status:review tag:x" → chips.
  function typed() {
    const q = parseQuery(text);
    const out: Chip[] = [];
    if (q.statuses.length) out.push({ k: "status", vals: q.statuses });
    if (q.types.length) out.push({ k: "type", vals: q.types });
    for (const t of q.tags) out.push({ k: "tag", vals: [t] });
    if (q.folders.length) out.push({ k: "in", vals: q.folders });
    if (q.spaces.length) out.push({ k: "space", vals: q.spaces });
    if (q.is.length) out.push({ k: "is", vals: q.is });
    if (q.text) out.push({ k: "text", vals: [q.text] });
    if (out.length) onSave(null, out);
  }
  return (
    <Pop anchor={anchor} onClose={onClose} width={240}>
      {!k ? <>
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") typed(); }} placeholder="status:review tag:x …" className="mb-1 h-7 rounded-[6px] border border-line bg-surface px-2 text-[12.5px] placeholder:text-muted focus:border-accent focus:outline-none" />
        <span className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Filter by</span>
        {(Object.keys(F_LABEL) as FKey[]).map((x) => <MenuItem key={x} onClick={() => { setK(x); setText(""); }}>{F_LABEL[x]}</MenuItem>)}
      </> : k === "text" ? <>
        <span className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Title or text contains</span>
        <input autoFocus defaultValue={vals[0] ?? ""} onKeyDown={(e) => { if (e.key === "Enter") { const t = e.currentTarget.value.trim(); onSave(t ? { k: "text", vals: [t] } : null); onClose(); } }} className="h-7 rounded-[6px] border border-line bg-surface px-2 text-[12.5px] focus:border-accent focus:outline-none" />
      </> : <>
        <span className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{F_LABEL[k]} is any of</span>
        {options.length > 8 && <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Search…" className="mb-1 h-7 rounded-[6px] border border-line bg-surface px-2 text-[12.5px] placeholder:text-muted focus:border-accent focus:outline-none" />}
        <div className="flex max-h-[220px] flex-col gap-px overflow-y-auto">
          {shown.map((o) => <MenuItem key={o} on={vals.includes(o)} onClick={() => toggle(o)}><span className="truncate">{k === "tag" ? "#" + o : cap(o)}</span></MenuItem>)}
          {!shown.length && <span className="px-2 py-1.5 text-muted">Nothing here</span>}
        </div>
      </>}
    </Pop>
  );
}

export function TableView() {
  const v = useVault();
  const ui = useUI();
  const [init] = useState(loadTable);
  const [order, setOrder] = useState<Col[]>(init.order);
  const [hidden, setHidden] = useState<Set<Col>>(new Set(init.hidden));
  const [sort, setSort] = useState<Sort[]>(init.sort);
  const [chips, setChips] = useState<Chip[]>(init.chips);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [filterAt, setFilterAt] = useState<{ el: HTMLElement; i: number | null } | null>(null);
  const [edit, setEdit] = useState<{ id: string; col: Col; el: HTMLElement } | null>(null);
  const [dragCol, setDragCol] = useState<Col | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [overCol, setOverCol] = useState<Col | null>(null);
  useEffect(() => { try { localStorage.setItem(TABLE_KEY, JSON.stringify({ order, hidden: [...hidden], sort, chips })); } catch { /* private mode */ } }, [order, hidden, sort, chips]);

  const scope = useMemo(() => scoped(v, ui), [v, ui]);
  const rows = useMemo(() => {
    const preds = chips.map((c) => c.k === "text"
      ? (n: Note) => c.vals.every((t) => (n.title + "\n" + n.body).toLowerCase().includes(t.toLowerCase()))
      : (() => { const fs = c.vals.map((x) => matcher(parseQuery(`${c.k}:"${x}"`), v.folderMap, v.spaceMap)); return (n: Note) => fs.some((f) => f(n)); })());
    const val = (n: Note, c: Col): string | number => c === "title" ? n.title.toLowerCase() : c === "type" ? n.type : c === "status" ? (n.status ? STATUSES.indexOf(n.status) : 99) : c === "tags" ? n.tags.join(" ") : c === "folder" ? (n.folderId ? v.folderMap.get(n.folderId)?.name ?? "" : "") : c === "updated" ? n.updatedAt : c === "created" ? n.createdAt : c === "cards" ? (n.type === "canvas" ? 0 : flashcards(n.body).length) : words(n.body);
    return scope.filter((n) => preds.every((p) => p(n))).sort((a, b) => {
      for (const s of sort) { const x = val(a, s.col), y = val(b, s.col); if (x !== y) return (x < y ? -1 : 1) * s.dir; }
      return 0;
    });
  }, [v, scope, chips, sort]);
  const shown = order.filter((c) => !hidden.has(c));
  const grid = { gridTemplateColumns: shown.map((c) => COL_W[c]).join(" ") };
  const right = (c: Col) => c === "words" || c === "cards";
  const defDir = (c: Col): 1 | -1 => (c === "updated" || c === "created" || c === "words" || c === "cards" ? -1 : 1);
  function clickHeader(c: Col, shift: boolean) {
    setSort((s) => {
      const i = s.findIndex((x) => x.col === c);
      if (!shift) return [{ col: c, dir: i === 0 ? (-s[0].dir as 1 | -1) : defDir(c) }];
      // Shift-click: add (or flip) a secondary sort key; the primary stays.
      if (i >= 0) return s.map((x, k) => (k === i ? { ...x, dir: -x.dir as 1 | -1 } : x));
      return [s[0], { col: c, dir: defDir(c) }];
    });
  }
  function moveCol(from: Col, to: Col) {
    if (from === to) return;
    setOrder((o) => { const n = o.filter((c) => c !== from); n.splice(n.indexOf(to) + (o.indexOf(from) < o.indexOf(to) ? 1 : 0), 0, from); return n; });
  }
  const colDrag = (c: Col) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData("text/x-lumen-col", c); e.dataTransfer.effectAllowed = "move"; setDragCol(c); },
    onDragOver: (e: React.DragEvent) => { if (dragCol) { e.preventDefault(); setOverCol(c); } },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); if (dragCol) moveCol(dragCol, c); setDragCol(null); setOverCol(null); },
    onDragEnd: () => { setDragCol(null); setOverCol(null); },
  });
  const editNote = edit ? v.byId.get(edit.id) : null;
  const sortLabel = sort.map((s) => COL_LABEL[s.col]).join(", then ");
  return (
    <div className="flex h-full flex-col">
      <div className="mt-[env(safe-area-inset-top)] flex shrink-0 flex-wrap items-center gap-3 px-4 pb-3.5 pt-4 md:px-8 md:pt-6">
        <span className="text-[22px] font-[650] tracking-[-.02em]">All notes</span>
        <span className="text-[13px] text-muted">{scope.length}</span>
        <span className="flex-1" />
        <button onClick={(e) => setMenu(menu ? null : e.currentTarget)} className="flex h-[30px] items-center gap-1.5 rounded-[8px] border border-line px-2.5 text-[13px] hover:bg-surface-2"><Columns3 size={14} className="text-muted" />Columns<span className="text-muted">{shown.length}</span></button>
        <button onClick={async () => openNote((await createNote({ spaceId: ui.spaceId === "all" ? "inbox" : ui.spaceId })).id, "edit")} className="flex h-[30px] items-center gap-1.5 rounded-[8px] bg-accent px-3 text-[13px] font-semibold text-accent-fg hover:brightness-110"><Plus size={14} />New note</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3.5 md:px-8">
        {chips.map((c, i) => (
          <span key={i} className="flex h-7 items-center gap-1.5 rounded-[6px] pl-2.5 pr-1.5 text-[12.5px]" style={c.k === "status" ? { background: "color-mix(in srgb, var(--info) 14%, transparent)", color: "var(--info)" } : { background: "var(--surface-2)" }}>
            <button onClick={(e) => setFilterAt({ el: e.currentTarget.parentElement!, i })}>{c.k === "in" ? "folder" : c.k}: {c.vals.map((x) => (c.k === "tag" ? "#" + x : x)).join(", ")}</button>
            <button aria-label="Remove filter" onClick={() => setChips((cs) => cs.filter((_, k) => k !== i))} className={c.k === "status" ? "" : "text-muted hover:text-ink"}><X size={12} /></button>
          </span>
        ))}
        <button onClick={(e) => setFilterAt({ el: e.currentTarget, i: null })} className="flex h-7 items-center gap-1.5 rounded-[6px] border border-dashed border-line px-2.5 text-[12.5px] text-muted hover:text-ink"><Plus size={12} />Filter</button>
        <span className="ml-auto text-[12px] text-muted">{rows.length} match · sorted by {sortLabel}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-6 md:px-8">
        <div ref={tableRef} className="min-w-[720px] overflow-hidden rounded-[12px] border border-line text-[13px]">
          <div className="sticky top-0 z-10 grid h-[38px] items-center bg-surface text-[12px] font-semibold text-muted" style={grid}>
            {shown.map((c) => {
              const si = sort.findIndex((s) => s.col === c);
              const s = sort[si];
              return (
                <button key={c} {...colDrag(c)} onClick={(e) => clickHeader(c, e.shiftKey)} title="Click to sort · Shift-click for a secondary sort · drag to reorder"
                  className={cx("flex h-full items-center gap-1 px-3.5 text-left hover:text-ink", si === 0 && "text-ink", right(c) && "justify-end", dragCol === c && "opacity-50", overCol === c && dragCol !== c && "shadow-[inset_2px_0_0_var(--accent)]")}>
                  {COL_LABEL[c]}
                  {s && (s.dir === 1 ? <ArrowUp size={12} className={si === 0 ? "text-accent" : "text-muted"} /> : <ArrowDown size={12} className={si === 0 ? "text-accent" : "text-muted"} />)}
                  {si === 1 && <span className="text-[10px] font-medium text-muted">2</span>}
                </button>
              );
            })}
          </div>
          {rows.map((n) => {
            const f = n.folderId ? v.folderMap.get(n.folderId) : null;
            const md = n.type !== "canvas" && n.type !== "whiteboard";
            const editable = (c: Col) => (c === "status" || c === "tags" || c === "type") && md;
            return (
              <div key={n.id} onClick={() => openNote(n.id)} className="grid h-[43px] cursor-pointer items-center border-t border-line hover:bg-surface" style={grid}>
                {shown.map((c) => (
                  <span key={c}
                    onClick={editable(c) ? (e) => { e.stopPropagation(); setEdit({ id: n.id, col: c, el: e.currentTarget }); } : undefined}
                    onDoubleClick={c === "title" ? (e) => { e.stopPropagation(); setEdit({ id: n.id, col: c, el: e.currentTarget }); } : undefined}
                    className={cx("flex h-full min-w-0 items-center gap-1 overflow-hidden px-3.5", right(c) && "justify-end tabular-nums", editable(c) && "cursor-text hover:bg-surface-2")}>
                    {c === "title" ? (edit?.id === n.id && edit.col === "title"
                      ? <input autoFocus defaultValue={n.title} onClick={(e) => e.stopPropagation()} onBlur={(e) => { const t = e.currentTarget.value.trim(); if (t && t !== n.title) void updateNote(n.id, { title: t }); setEdit(null); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEdit(null); }} className="h-7 w-full min-w-0 rounded-[6px] border border-accent bg-bg px-1.5 font-medium focus:outline-none" dir="auto" />
                      : <span className="truncate font-medium" dir="auto" title="Double-click to rename">{n.title}</span>)
                      : c === "status" ? (n.status ? <span className="inline-flex items-center gap-1.5 rounded-full px-2 text-[12px] font-medium leading-[22px]" style={{ background: `color-mix(in srgb, ${STATUS_COLOR[n.status]} 14%, transparent)`, color: STATUS_COLOR[n.status] }}><span className="size-1.5 rounded-full" style={{ background: STATUS_COLOR[n.status] }} />{cap(n.status)}</span> : <span className="text-muted">—</span>)
                      : c === "tags" ? (edit?.id === n.id && edit.col === "tags"
                        ? <input autoFocus defaultValue={n.tags.map((t) => "#" + t).join(" ")} onClick={(e) => e.stopPropagation()} onBlur={(e) => { const tags = [...new Set(e.currentTarget.value.split(/[\s,]+/).map((t) => t.replace(/^#/, "").trim().toLowerCase()).filter(Boolean))]; if (tags.join() !== n.tags.join()) void updateNote(n.id, { tags }); setEdit(null); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEdit(null); }} placeholder="#tag #other" className="h-7 w-full min-w-0 rounded-[6px] border border-accent bg-bg px-1.5 text-[12px] focus:outline-none" />
                        : n.tags.slice(0, 3).map((t) => <span key={t} className="shrink-0 rounded-[6px] bg-surface-2 px-1.5 text-[11.5px] leading-5 text-muted">#{t}</span>))
                      : c === "folder" ? (f ? <span className="flex min-w-0 items-center gap-1.5 text-muted"><span className="size-[7px] shrink-0 rounded-[2px]" style={{ background: f.color ?? "var(--muted)" }} /><span className="truncate">{f.name}</span></span> : <span className="text-muted">—</span>)
                      : c === "updated" ? <span className="truncate text-muted">{updatedLabel(n.updatedAt)}</span>
                      : c === "created" ? <span className="truncate text-muted">{updatedLabel(n.createdAt)}</span>
                      : c === "words" ? <span className="text-muted">{n.type === "canvas" ? "—" : words(n.body).toLocaleString("en-US")}</span>
                      : c === "cards" ? <span className="text-muted">{n.type === "canvas" ? "—" : flashcards(n.body).length || "—"}</span>
                      : <span className="truncate text-muted">{cap(n.type === "moc" ? "Map" : n.type)}</span>}
                  </span>
                ))}
              </div>
            );
          })}
          {!rows.length && <div className="border-t border-line p-6 text-center text-muted">No notes match.</div>}
        </div>
      </div>

      {menu && (
        <Pop anchor={menu} onClose={() => setMenu(null)} align="right" width={210} at={(() => { const t = tableRef.current?.getBoundingClientRect(); return t ? { right: t.right - 12, top: t.top + 42 } : undefined; })()}>
          <span className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Show columns</span>
          {order.map((c) => {
            const on = !hidden.has(c), lock = c === "title";
            return (
              <div key={c} {...colDrag(c)} className={cx("flex h-[30px] items-center gap-2.5 rounded-[6px] px-2 hover:bg-surface", dragCol === c && "opacity-50", overCol === c && dragCol !== c && "shadow-[inset_0_2px_0_var(--accent)]")}>
                <button disabled={lock} onClick={() => setHidden((h) => { const s = new Set(h); s.has(c) ? s.delete(c) : s.add(c); return s; })} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                  <span className="relative h-4 w-7 shrink-0 rounded-full" style={{ background: on ? "var(--accent)" : "var(--border)" }}><span className="absolute top-0.5 size-3 rounded-full transition-[left]" style={{ left: on ? 14 : 2, background: on ? "var(--accent-fg)" : "var(--muted)" }} /></span>
                  <span className={cx("flex-1", lock && "text-muted")}>{COL_LABEL[c]}</span>
                </button>
                <GripVertical size={13} className="shrink-0 cursor-grab text-muted" />
              </div>
            );
          })}
        </Pop>
      )}
      {filterAt && (
        <FilterMenu anchor={filterAt.el} chip={filterAt.i === null ? null : chips[filterAt.i]} onClose={() => setFilterAt(null)}
          onSave={(c, typed) => {
            if (typed) { setChips((cs) => [...cs, ...typed]); setFilterAt(null); return; }
            setChips((cs) => {
              if (filterAt.i === null) { if (!c) return cs; setFilterAt({ ...filterAt, i: cs.length }); return [...cs, c]; }
              return c ? cs.map((x, k) => (k === filterAt.i ? c : x)) : cs.filter((_, k) => k !== filterAt.i);
            });
          }} />
      )}
      {edit && editNote && edit.col === "status" && (
        <Pop anchor={edit.el} onClose={() => setEdit(null)} width={180}>
          {STATUSES.map((st) => <MenuItem key={st} on={editNote.status === st} onClick={() => { void updateNote(editNote.id, { status: st }); setEdit(null); }}><StatusDot status={st} />{cap(st)}</MenuItem>)}
          <MenuItem on={!editNote.status} onClick={() => { void updateNote(editNote.id, { status: null }); setEdit(null); }}><span className="size-2 rounded-full border border-muted" />No status</MenuItem>
        </Pop>
      )}
      {edit && editNote && edit.col === "type" && (
        <Pop anchor={edit.el} onClose={() => setEdit(null)} width={180}>
          {MD_TYPES.map((t) => <MenuItem key={t} on={editNote.type === t} onClick={() => { void updateNote(editNote.id, { type: t as NoteType }); setEdit(null); }}>{t === "moc" ? "Map of content" : cap(t)}</MenuItem>)}
        </Pop>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Review (all due cards)
export function ReviewView() {
  const v = useVault();
  const ui = useUI();
  const notes = scoped(v, { ...ui, folderId: null });
  const due = useDueCards(notes);
  const space = ui.spaceId !== "all" ? v.spaceMap.get(ui.spaceId) : null;
  // Deck count at the start of the session (it would shrink as cards are graded).
  const [decks, setDecks] = useState<number | null>(null);
  useEffect(() => { if (due && decks === null) setDecks(new Set(due.map((d) => d.note.id)).size); }, [due, decks]);
  if (decks === null) return null;
  const title = `${space ? space.name : "All spaces"} · ${decks} ${decks === 1 ? "deck" : "decks"}`;
  // Full-screen: one card, nothing else (no sidebar or tab bar).
  return <div className="fixed inset-0 z-40 bg-bg"><ReviewSession notes={notes} title={title} onExit={() => go("home")} /></div>;
}

// ------------------------------------------------------------------ Trash
export function TrashView() {
  const trashed = useLiveQuery(() => db.notes.where("deleted").equals(1).toArray(), []) ?? [];
  const items = trashed.filter((n) => n.title !== "(deleted)").sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="flex h-full flex-col">
      <Header title="Trash" sub="Deleted notes stay here until you delete them forever" />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 md:px-8">
        {items.length ? items.map((n) => (
          <div key={n.id} className="flex items-center gap-2 rounded-[10px] px-3 py-2 hover:bg-surface">
            <div className="min-w-0 flex-1"><div className="truncate text-[14px]">{n.title}</div><div className="text-[12px] text-muted">deleted {relTime(n.updatedAt)}</div></div>
            <Button size="sm" onClick={() => restoreNote(n.id)}><RotateCcw size={13} /> Restore</Button>
            <Button size="sm" variant="danger" onClick={() => confirm(`Delete “${n.title}” forever? Its history goes too.`) && purgeNote(n.id)}><Trash2 size={13} /></Button>
          </div>
        )) : <EmptyState glyph="archive" text="Trash is empty. Deleted notes wait here." action={{ label: "Back to notes", onClick: () => go("notes") }} />}
      </div>
    </div>
  );
}
