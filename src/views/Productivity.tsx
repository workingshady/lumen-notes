import { Glyph } from "../components/Glyph";
import { TasksScreen } from "../components/calendar/TasksScreen";
import { CalendarScreen } from "../components/calendar/CalendarScreen";
import { BacklogCard, BACKLOG } from "../components/review-backlog";
import { SpaceIcon } from "../components/SpaceIcon";
import { EmptyState } from "../components/EmptyState";
import { ArrowDown, ArrowUp, CalendarDays, Check, Columns3, GripVertical, Layers, ListChecks, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NOTE_TYPES, STATUSES, type Note, type NoteType } from "../../shared/types";
import { createNote, purgeNote, purgeOldTrash, restoreNote, updateNote } from "../lib/actions";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { flashcards, words } from "../lib/parse";
import { matcher, parseQuery } from "../lib/search";
import { go, openNote, scoped, useUI, useVault, type View } from "../lib/store";
import { ReviewSession, useDueCards } from "../components/Review";
import { Button, cx, relTime, STATUS_COLOR, StatusDot } from "../components/ui";
import { dragNote } from "../components/Sidebar";
import { fmtDate, fmtNum, fmtRelative, getLang, t, tk } from "../lib/i18n";
import { isWbType } from "../../shared/types";

/** Learning status labels (the ids are stored values). */
const STATUS_NAME: Record<string, string> = { todo: tk("Todo"), learning: tk("Learning"), review: tk("Review"), mastered: tk("Mastered"), none: tk("No status") };
const statusName = (st: string) => (STATUS_NAME[st] ? t(STATUS_NAME[st]) : st.charAt(0).toUpperCase() + st.slice(1));

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
  const opts: [View, string, typeof ListChecks][] = [["tasks", tk("List"), ListChecks], ["kanban", tk("Kanban"), Columns3], ["calendar", tk("Calendar"), CalendarDays]];
  return (
    <div className="flex gap-0.5 rounded-[10px] border border-line bg-surface p-[3px] text-[13px]">
      {opts.map(([v, l, I]) => (
        <button key={v} onClick={() => go(v)} className={cx("flex h-7 items-center gap-1.5 rounded-[7px] px-3", value === v ? "bg-surface-2 font-semibold" : "text-muted hover:text-ink")}>
          <I size={14} /><span className="hidden sm:inline">{t(l)}</span>
        </button>
      ))}
    </div>
  );
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
  <button onClick={onClick} className={cx("flex h-[30px] items-center gap-2.5 rounded-[6px] px-2 text-start hover:bg-surface", on && "font-semibold")}>
    {children}<span className="flex-1" />{on && <Check size={13} className="text-accent" />}
  </button>
);

/** Tasks (round 8, page 55 I–K): components/calendar/TasksScreen. */
export function TasksView() { return <TasksScreen />; }

// ------------------------------------------------------------------ Kanban (notes by learning status)
export function KanbanView() {
  const v = useVault();
  const ui = useUI();
  const inScope = scoped(v, ui).filter((n) => n.type !== "canvas" && !isWbType(n.type) && n.type !== "roadmap");
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
        <span className="text-[22px] font-[650] tracking-[-.02em]">{t("Learning board")}</span>
        <Lens value="kanban" />
        <span className="flex-1" />
        <button onClick={() => setTypeFilter((t) => (t === "lesson" ? "any" : "lesson"))} title={t("Toggle the type filter")} className="hidden text-[13px] text-muted hover:text-ink md:inline">
          <span className="flex items-center gap-1.5">{space ? <><SpaceIcon space={space} size={15} /><bdi>{space.name}</bdi></> : <><Glyph name="globe" size={15} color="#57AB5A" />{t("All spaces")}</>}{lessonsOnly ? ` · ${t("type: lesson")}` : ` · ${t("all types")}`}</span>
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
              <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-1 text-[13px] font-semibold leading-4">
                <span className="size-2 rounded-full" style={{ background: STATUS_COLOR[c] }} />{statusName(c)}
                <span className="font-normal text-muted">{fmtNum(items.length)}</span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                {items.map((n) => {
                  const f = n.folderId ? v.folderMap.get(n.folderId) : null;
                  const cards = flashcards(n.body).length;
                  return (
                    <button key={n.id} draggable onDragStart={(e) => lift(e, n.id)} onDragEnd={() => { setDragging(null); setOver(null); }} onClick={() => openNote(n.id)}
                      className={cx("flex w-full shrink-0 flex-col gap-2 rounded-[10px] border border-transparent bg-surface-2 p-3 text-start text-[13px] hover:border-accent", dragging === n.id && "!border-[1.5px] !border-dashed !border-line [&>*]:opacity-0")}>
                      <span className="font-semibold leading-[18px]" dir="auto">{n.title}</span>
                      <span className="flex items-center gap-1.5 text-[11.5px] leading-[14px] text-muted">
                        {f ? <><span className="size-[7px] shrink-0 rounded-[2px]" style={{ background: f.color ?? "var(--muted)" }} /><span className="flex-1 truncate" dir="auto">{f.name}</span></> : <span className="flex-1 truncate" dir="auto">{n.tags.slice(0, 2).map((t) => "#" + t).join(" ") || v.spaceMap.get(n.spaceId)?.name}</span>}
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

// ------------------------------------------------------------------ Calendar (round 8, page 55 D–H: components/calendar/CalendarScreen)
export function CalendarView() { return <CalendarScreen />; }

// ------------------------------------------------------------------ Database table
type Col = "title" | "type" | "status" | "tags" | "folder" | "updated" | "words" | "created" | "cards";
const ALL_COLS: Col[] = ["title", "type", "status", "tags", "folder", "updated", "words", "created", "cards"];
const COL_LABEL: Record<Col, string> = { title: tk("Title"), type: tk("Type"), status: tk("Status"), tags: tk("Tags"), folder: tk("Folder"), updated: tk("Updated"), created: tk("Created"), words: tk("Words"), cards: tk("Flashcards") };
const COL_W: Record<Col, string> = { title: "2.4fr", type: "1fr", status: "1.1fr", tags: "1.6fr", folder: "1.4fr", updated: "1fr", created: "1fr", words: ".7fr", cards: ".8fr" };
type Sort = { col: Col; dir: 1 | -1 };
type FKey = "status" | "type" | "tag" | "in" | "space" | "is" | "text";
type Chip = { k: FKey; vals: string[] };
const F_LABEL: Record<FKey, string> = { status: tk("Status"), type: tk("Type"), tag: tk("Tag"), in: tk("Folder"), space: tk("Space"), is: tk("Is"), text: tk("Text") };
const TABLE_KEY = "lumen.table";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const MD_TYPES = NOTE_TYPES.filter((t) => t !== "canvas" && !isWbType(t) && t !== "diagram");

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
function updatedLabel(ts: number) {
  const s = (Date.now() - ts) / 1000;
  if (getLang() === "ar" && s < 3 * 3600) return fmtRelative(ts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 3 * 3600) return `${Math.floor(s / 3600)} h ago`;
  const d = new Date(ts), now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (days === 0) return t("Today");
  if (days === 1) return t("Yesterday");
  if (days < 7) return fmtDate(d, { weekday: "short" });
  return getLang() === "ar" ? fmtDate(d, { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) }) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
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
        <span className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t("Filter by")}</span>
        {(Object.keys(F_LABEL) as FKey[]).map((x) => <MenuItem key={x} onClick={() => { setK(x); setText(""); }}>{t(F_LABEL[x])}</MenuItem>)}
      </> : k === "text" ? <>
        <span className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t("Title or text contains")}</span>
        <input autoFocus defaultValue={vals[0] ?? ""} onKeyDown={(e) => { if (e.key === "Enter") { const t = e.currentTarget.value.trim(); onSave(t ? { k: "text", vals: [t] } : null); onClose(); } }} className="h-7 rounded-[6px] border border-line bg-surface px-2 text-[12.5px] focus:border-accent focus:outline-none" />
      </> : <>
        <span className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t("{field} is any of", { field: t(F_LABEL[k]) })}</span>
        {options.length > 8 && <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Search…")} className="mb-1 h-7 rounded-[6px] border border-line bg-surface px-2 text-[12.5px] placeholder:text-muted focus:border-accent focus:outline-none" />}
        <div className="flex max-h-[220px] flex-col gap-px overflow-y-auto">
          {shown.map((o) => <MenuItem key={o} on={vals.includes(o)} onClick={() => toggle(o)}><span className="truncate" dir="auto">{k === "tag" ? "#" + o : k === "status" ? statusName(o) : cap(o)}</span></MenuItem>)}
          {!shown.length && <span className="px-2 py-1.5 text-muted">{t("Nothing here")}</span>}
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
  const sortLabel = sort.map((s) => t(COL_LABEL[s.col])).join(t(", then "));
  return (
    <div className="flex h-full flex-col">
      <div className="mt-[env(safe-area-inset-top)] flex shrink-0 flex-wrap items-center gap-3 px-4 pb-3.5 pt-4 md:px-8 md:pt-6">
        <span className="text-[22px] font-[650] tracking-[-.02em]">{t("All notes")}</span>
        <span className="text-[13px] text-muted">{fmtNum(scope.length)}</span>
        <span className="flex-1" />
        <button onClick={(e) => setMenu(menu ? null : e.currentTarget)} className="flex h-[30px] items-center gap-1.5 rounded-[8px] border border-line px-2.5 text-[13px] hover:bg-surface-2"><Columns3 size={14} className="text-muted" />{t("Columns")}<span className="text-muted">{fmtNum(shown.length)}</span></button>
        <button onClick={async () => openNote((await createNote({ spaceId: ui.spaceId === "all" ? "inbox" : ui.spaceId })).id, "edit")} className="flex h-[30px] items-center gap-1.5 rounded-[8px] bg-accent px-3 text-[13px] font-semibold text-accent-fg hover:brightness-110"><Plus size={14} />{t("New note")}</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3.5 md:px-8">
        {chips.map((c, i) => (
          <span key={i} className="flex h-7 items-center gap-1.5 rounded-[6px] ps-2.5 pe-1.5 text-[12.5px]" style={c.k === "status" ? { background: "color-mix(in srgb, var(--info) 14%, transparent)", color: "var(--info)" } : { background: "var(--surface-2)" }}>
            <button onClick={(e) => setFilterAt({ el: e.currentTarget.parentElement!, i })}>{c.k === "in" ? "folder" : c.k}: {c.vals.map((x) => (c.k === "tag" ? "#" + x : x)).join(", ")}</button>
            <button aria-label={t("Remove filter")} onClick={() => setChips((cs) => cs.filter((_, k) => k !== i))} className={c.k === "status" ? "" : "text-muted hover:text-ink"}><X size={12} /></button>
          </span>
        ))}
        <button onClick={(e) => setFilterAt({ el: e.currentTarget, i: null })} className="flex h-7 items-center gap-1.5 rounded-[6px] border border-dashed border-line px-2.5 text-[12.5px] text-muted hover:text-ink"><Plus size={12} />{t("Filter")}</button>
        <span className="ms-auto text-[12px] text-muted">{t("{n} match · sorted by {sort}", { n: rows.length, sort: sortLabel })}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-6 md:px-8">
        <div ref={tableRef} className="min-w-[720px] overflow-hidden rounded-[12px] border border-line text-[13px]">
          <div className="sticky top-0 z-10 grid h-[38px] items-center bg-surface text-[12px] font-semibold text-muted" style={grid}>
            {shown.map((c) => {
              const si = sort.findIndex((s) => s.col === c);
              const s = sort[si];
              return (
                <button key={c} {...colDrag(c)} onClick={(e) => clickHeader(c, e.shiftKey)} title={t("Click to sort · Shift-click for a secondary sort · drag to reorder")}
                  className={cx("flex h-full items-center gap-1 px-3.5 text-start hover:text-ink", si === 0 && "text-ink", right(c) && "justify-end", dragCol === c && "opacity-50", overCol === c && dragCol !== c && "shadow-[inset_2px_0_0_var(--accent)]")}>
                  {t(COL_LABEL[c])}
                  {s && (s.dir === 1 ? <ArrowUp size={12} className={si === 0 ? "text-accent" : "text-muted"} /> : <ArrowDown size={12} className={si === 0 ? "text-accent" : "text-muted"} />)}
                  {si === 1 && <span className="text-[10px] font-medium text-muted">2</span>}
                </button>
              );
            })}
          </div>
          {rows.map((n) => {
            const f = n.folderId ? v.folderMap.get(n.folderId) : null;
            const md = n.type !== "canvas" && !isWbType(n.type);
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
                      : <span className="truncate font-medium" dir="auto" title={t("Double-click to rename")}>{n.title}</span>)
                      : c === "status" ? (n.status ? <span className="inline-flex items-center gap-1.5 rounded-full px-2 text-[12px] font-medium leading-[22px]" style={{ background: `color-mix(in srgb, ${STATUS_COLOR[n.status]} 14%, transparent)`, color: STATUS_COLOR[n.status] }}><span className="size-1.5 rounded-full" style={{ background: STATUS_COLOR[n.status] }} />{statusName(n.status)}</span> : <span className="text-muted">—</span>)
                      : c === "tags" ? (edit?.id === n.id && edit.col === "tags"
                        ? <input autoFocus defaultValue={n.tags.map((t) => "#" + t).join(" ")} onClick={(e) => e.stopPropagation()} onBlur={(e) => { const tags = [...new Set(e.currentTarget.value.split(/[\s,]+/).map((t) => t.replace(/^#/, "").trim().toLowerCase()).filter(Boolean))]; if (tags.join() !== n.tags.join()) void updateNote(n.id, { tags }); setEdit(null); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEdit(null); }} placeholder="#tag #other" className="h-7 w-full min-w-0 rounded-[6px] border border-accent bg-bg px-1.5 text-[12px] focus:outline-none" />
                        : n.tags.slice(0, 3).map((t) => <span key={t} className="shrink-0 rounded-[6px] bg-surface-2 px-1.5 text-[11.5px] leading-5 text-muted">#{t}</span>))
                      : c === "folder" ? (f ? <span className="flex min-w-0 items-center gap-1.5 text-muted"><span className="size-[7px] shrink-0 rounded-[2px]" style={{ background: f.color ?? "var(--muted)" }} /><span className="truncate" dir="auto">{f.name}</span></span> : <span className="text-muted">—</span>)
                      : c === "updated" ? <span className="truncate text-muted">{updatedLabel(n.updatedAt)}</span>
                      : c === "created" ? <span className="truncate text-muted">{updatedLabel(n.createdAt)}</span>
                      : c === "words" ? <span className="text-muted">{n.type === "canvas" ? "—" : fmtNum(words(n.body), { useGrouping: true })}</span>
                      : c === "cards" ? <span className="text-muted">{n.type === "canvas" ? "—" : fmtNum(flashcards(n.body).length) || "—"}</span>
                      : <span className="truncate text-muted">{cap(n.type === "moc" ? "Map" : n.type)}</span>}
                  </span>
                ))}
              </div>
            );
          })}
          {!rows.length && <div className="border-t border-line p-6 text-center text-muted">{t("No notes match.")}</div>}
        </div>
      </div>

      {menu && (
        <Pop anchor={menu} onClose={() => setMenu(null)} align="right" width={210} at={(() => { const t = tableRef.current?.getBoundingClientRect(); return t ? { right: t.right - 12, top: t.top + 42 } : undefined; })()}>
          <span className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t("Show columns")}</span>
          {order.map((c) => {
            const on = !hidden.has(c), lock = c === "title";
            return (
              <div key={c} {...colDrag(c)} className={cx("flex h-[30px] items-center gap-2.5 rounded-[6px] px-2 hover:bg-surface", dragCol === c && "opacity-50", overCol === c && dragCol !== c && "shadow-[inset_0_2px_0_var(--accent)]")}>
                <button disabled={lock} onClick={() => setHidden((h) => { const s = new Set(h); s.has(c) ? s.delete(c) : s.add(c); return s; })} className="flex min-w-0 flex-1 items-center gap-2.5 text-start">
                  <span className="relative h-4 w-7 shrink-0 rounded-full" style={{ background: on ? "var(--accent)" : "var(--border)" }}><span className="absolute top-0.5 size-3 rounded-full transition-all" style={{ insetInlineStart: on ? 14 : 2, background: on ? "var(--accent-fg)" : "var(--muted)" }} /></span>
                  <span className={cx("flex-1", lock && "text-muted")}>{t(COL_LABEL[c])}</span>
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
          {STATUSES.map((st) => <MenuItem key={st} on={editNote.status === st} onClick={() => { void updateNote(editNote.id, { status: st }); setEdit(null); }}><StatusDot status={st} />{statusName(st)}</MenuItem>)}
          <MenuItem on={!editNote.status} onClick={() => { void updateNote(editNote.id, { status: null }); setEdit(null); }}><span className="size-2 rounded-full border border-muted" />{t("No status")}</MenuItem>
        </Pop>
      )}
      {edit && editNote && edit.col === "type" && (
        <Pop anchor={edit.el} onClose={() => setEdit(null)} width={180}>
          {MD_TYPES.map((ty) => <MenuItem key={ty} on={editNote.type === ty} onClick={() => { void updateNote(editNote.id, { type: ty as NoteType }); setEdit(null); }}>{ty === "moc" ? t("Map of content") : cap(ty)}</MenuItem>)}
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
  // Lumen 22 backlog: above BACKLOG due cards, offer "Do 50 now · Spread over 7 days · Review all" first.
  const [chunk, setChunk] = useState<number | null>(null);
  if (decks === null || !due) return null;
  const title = `${space ? space.name : t("All spaces")} · ${t("{n} deck|{n} decks", { n: decks })}`;
  if (chunk === null && due.length > BACKLOG) return <div className="fixed inset-0 z-40 bg-bg"><BacklogCard cards={due.map((d) => d.card)} onChunk={setChunk} onAll={() => setChunk(0)} onExit={() => go("home")} /></div>;
  // Full-screen: one card, nothing else (no sidebar or tab bar).
  return <div className="fixed inset-0 z-40 bg-bg"><ReviewSession notes={notes} title={title} onExit={() => go("home")} limit={chunk || undefined} /></div>;
}

// ------------------------------------------------------------------ Trash
export function TrashView() {
  useEffect(() => { void purgeOldTrash(); }, []);
  const trashed = useLiveQuery(() => db.notes.where("deleted").equals(1).toArray(), []) ?? [];
  const items = trashed.filter((n) => n.title !== "(deleted)").sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="flex h-full flex-col">
      <Header title={t("Trash")} sub={t("Deleted notes stay here for 30 days, then they are deleted forever")} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 md:px-8">
        {items.length ? items.map((n) => (
          <div key={n.id} className="flex items-center gap-2 rounded-[10px] px-3 py-2 hover:bg-surface">
            <div className="min-w-0 flex-1"><div className="truncate text-[14px]" dir="auto">{n.title}</div><div className="text-[12px] text-muted">{t("deleted {ago}", { ago: getLang() === "ar" ? fmtRelative(n.updatedAt) : relTime(n.updatedAt) })}</div></div>
            <Button size="sm" onClick={() => restoreNote(n.id)}><RotateCcw size={13} /> {t("Restore")}</Button>
            <Button size="sm" variant="danger" aria-label={t("Delete forever")} onClick={() => confirm(t("Delete “{title}” forever? Its history goes too.", { title: n.title })) && purgeNote(n.id)}><Trash2 size={13} /></Button>
          </div>
        )) : <EmptyState glyph="archive" text={t("Trash is empty. Deleted notes wait here.")} action={{ label: t("Back to notes"), onClick: () => go("notes") }} />}
      </div>
    </div>
  );
}
