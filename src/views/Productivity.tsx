import { ChevronLeft, ChevronRight, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { STATUSES, type Note, type Status } from "../../shared/types";
import { createNote, purgeNote, restoreNote, updateNote } from "../lib/actions";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { excerpt, tasks, toggleTask, words } from "../lib/parse";
import { matcher, parseQuery } from "../lib/search";
import { openNote, scoped, useUI, useVault } from "../lib/store";
import { ReviewSession, useDueCards } from "../components/Review";
import { Button, Chip, cx, Empty, inputCls, relTime, Segmented, STATUS_COLOR, StatusDot, StatusPill } from "../components/ui";
import { dragNote } from "../components/Sidebar";

const today = () => new Date().toISOString().slice(0, 10);
const Header = ({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) => (
  <div className="safe-t flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
    <div className="mr-auto"><div className="text-[17px] font-semibold">{title}</div>{sub && <div className="text-[12px] text-muted">{sub}</div>}</div>
    {children}
  </div>
);

// ------------------------------------------------------------------ Tasks
export function TasksView() {
  const v = useVault();
  const ui = useUI();
  const [show, setShow] = useState<"open" | "done">("open");
  const all = useMemo(() => scoped(v, { ...ui, folderId: null, tag: null }).filter((n) => n.type !== "roadmap").flatMap((n) => tasks(n.body).map((t) => ({ ...t, note: n }))), [v, ui]);
  const t0 = today();
  const open = all.filter((t) => !t.done);
  const groups: [string, typeof all][] = show === "done" ? [["Done", all.filter((t) => t.done)]] : [
    ["Overdue", open.filter((t) => t.due && t.due < t0)],
    ["Today", open.filter((t) => t.due === t0)],
    ["Upcoming", open.filter((t) => t.due && t.due > t0).sort((a, b) => a.due!.localeCompare(b.due!))],
    ["No date", open.filter((t) => !t.due)],
  ];
  const toggle = (t: (typeof all)[number]) => updateNote(t.note.id, { body: toggleTask(t.note.body, t.line) });
  return (
    <div className="flex h-full flex-col">
      <Header title="Tasks" sub={`${open.length} open · from every - [ ] in your notes. Add 📅 2026-12-01 for a due date.`}>
        <Segmented value={show} onChange={setShow} options={[{ value: "open", label: "Open" }, { value: "done", label: "Done" }]} />
      </Header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-6">
        <div className="mx-auto max-w-3xl space-y-5">
          {groups.map(([g, ts]) => ts.length ? (
            <section key={g}>
              <div className={cx("mb-1 text-[12px] font-semibold uppercase tracking-wider", g === "Overdue" ? "text-bad" : "text-muted")}>{g} · {ts.length}</div>
              {ts.map((t) => (
                <div key={t.note.id + t.line} className="flex items-start gap-3 rounded-[10px] px-2 py-2 hover:bg-surface-2">
                  <input type="checkbox" checked={t.done} onChange={() => toggle(t)} className="mt-1 size-4 accent-[var(--accent)]" />
                  <div className="min-w-0 flex-1">
                    <div className={cx("text-[14px]", t.done && "text-muted line-through")}>{t.text}</div>
                    <button onClick={() => openNote(t.note.id)} className="truncate text-[12px] text-muted hover:text-link">{v.spaceMap.get(t.note.spaceId)?.icon} {t.note.title}</button>
                  </div>
                  {t.due && <span className={cx("text-[12px] tabular-nums", !t.done && t.due < t0 ? "text-bad" : "text-muted")}>{t.due}</span>}
                </div>
              ))}
            </section>
          ) : null)}
          {!all.length && <Empty icon={<span className="text-3xl">☑️</span>} title="No tasks yet" hint="Write - [ ] something in any note. It shows up here, across all your notes." />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Kanban (notes by learning status)
export function KanbanView() {
  const v = useVault();
  const ui = useUI();
  const notes = scoped(v, ui).filter((n) => n.type !== "canvas");
  const [over, setOver] = useState<string | null>(null);
  const cols: (Status | "none")[] = ["none", ...STATUSES];
  return (
    <div className="flex h-full flex-col">
      <Header title="Board" sub="Drag notes between columns to set their learning status" />
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3 md:p-5">
        {cols.map((c) => {
          const items = notes.filter((n) => (n.status ?? "none") === c).sort((a, b) => b.updatedAt - a.updatedAt);
          if (c === "none" && !items.length) return null;
          return (
            <div key={c}
              onDragOver={(e) => { e.preventDefault(); setOver(c); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const raw = e.dataTransfer.getData("application/x-lumen"); if (raw) { const d = JSON.parse(raw); if (d.kind === "note") void updateNote(d.id, { status: c === "none" ? null : c }); } }}
              className={cx("flex w-[280px] shrink-0 flex-col rounded-[14px] bg-surface p-2", over === c && "ring-2 ring-accent/50")}>
              <div className="flex items-center gap-2 px-2 py-1.5 text-[13px] font-semibold capitalize">
                <span className="size-2 rounded-full" style={{ background: c === "none" ? "var(--border)" : STATUS_COLOR[c] }} />{c === "none" ? "No status" : c}
                <span className="ml-auto text-[12px] font-normal text-muted">{items.length}</span>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-1">
                {items.map((n) => (
                  <button key={n.id} draggable onDragStart={(e) => dragNote(e, n.id)} onClick={() => openNote(n.id)} className="block w-full rounded-[10px] border border-line bg-bg p-3 text-left hover:border-accent">
                    <div className="text-[13.5px] font-medium">{n.title}</div>
                    <div className="mt-1 line-clamp-2 text-[12px] text-muted">{excerpt(n.body, 100)}</div>
                    <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-muted">{n.tags.slice(0, 3).map((t) => <span key={t} className="rounded-full bg-surface-2 px-1.5">#{t}</span>)}</div>
                  </button>
                ))}
                {c !== "none" && <button onClick={async () => openNote((await createNote({ template: "lesson", status: c, spaceId: ui.spaceId === "all" ? "inbox" : ui.spaceId })).id, "edit")} className="w-full rounded-[10px] py-2 text-[12.5px] text-muted hover:bg-surface-2">+ Add</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Calendar
export function CalendarView() {
  const v = useVault();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [sel, setSel] = useState(today());
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const lk = (t: number) => key(new Date(t));
  const info = useMemo(() => {
    const m = new Map<string, { created: Note[]; journal: Note[]; tasks: { text: string; note: Note; done: boolean }[] }>();
    const get = (k: string) => m.get(k) ?? (m.set(k, { created: [], journal: [], tasks: [] }), m.get(k)!);
    for (const n of v.notes) {
      if (n.type === "journal") { const d = /\d{4}-\d{2}-\d{2}/.exec(n.title)?.[0] ?? lk(n.createdAt); get(d).journal.push(n); }
      else get(lk(n.createdAt)).created.push(n);
      if (n.type !== "roadmap") for (const t of tasks(n.body)) if (t.due) get(t.due).tasks.push({ text: t.text, note: n, done: t.done });
    }
    return m;
  }, [v.notes]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = new Date(month);
  first.setDate(1 - ((first.getDay() + 6) % 7)); // Monday start
  const days = Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
  const day = info.get(sel);
  return (
    <div className="flex h-full flex-col">
      <Header title={month.toLocaleDateString(undefined, { month: "long", year: "numeric" })} sub="Journals, new notes and due tasks">
        <Button size="sm" variant="ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={16} /></Button>
        <Button size="sm" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSel(today()); }}>Today</Button>
        <Button size="sm" variant="ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={16} /></Button>
      </Header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row">
        <div className="p-3 md:flex-1 md:p-5">
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d}>{d}</div>)}</div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {days.map((d) => {
              const k = key(d);
              const i = info.get(k);
              const inMonth = d.getMonth() === month.getMonth();
              return (
                <button key={k} onClick={() => setSel(k)} className={cx("flex aspect-square flex-col items-center justify-start rounded-[10px] p-1 text-[13px] md:aspect-auto md:h-20 md:items-start md:p-2", sel === k ? "bg-accent/15 ring-1 ring-accent" : "hover:bg-surface-2", !inMonth && "opacity-35", k === today() && "font-bold text-accent")}>
                  {d.getDate()}
                  <span className="mt-auto flex gap-0.5">
                    {i?.journal.length ? <span className="size-1.5 rounded-full bg-accent" /> : null}
                    {i?.created.length ? <span className="size-1.5 rounded-full bg-info" /> : null}
                    {i?.tasks.some((t) => !t.done) ? <span className="size-1.5 rounded-full bg-warn" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex gap-4 text-[11.5px] text-muted"><span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-accent" /> journal</span><span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-info" /> new notes</span><span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-warn" /> tasks due</span></div>
        </div>
        <div className="border-t border-line p-4 md:w-80 md:border-l md:border-t-0">
          <div className="mb-2 font-semibold">{new Date(sel + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</div>
          {!day?.journal.length && <Button size="sm" className="mb-3" onClick={async () => openNote((await createNote({ template: "journal", title: `Journal ${sel}`, spaceId: "inbox" })).id, "edit")}>+ Journal for this day</Button>}
          {[["Journal", day?.journal ?? []], ["Created", day?.created ?? []]].map(([l, ns]) => (ns as Note[]).length ? (
            <div key={l as string} className="mb-3"><div className="text-[11px] uppercase tracking-wider text-muted">{l as string}</div>{(ns as Note[]).map((n) => <button key={n.id} onClick={() => openNote(n.id)} className="block w-full truncate rounded px-1 py-1 text-left text-[13.5px] hover:bg-surface-2">{n.title}</button>)}</div>
          ) : null)}
          {day?.tasks.length ? <div><div className="text-[11px] uppercase tracking-wider text-muted">Tasks due</div>{day.tasks.map((t, i) => <button key={i} onClick={() => openNote(t.note.id)} className={cx("block w-full truncate rounded px-1 py-1 text-left text-[13.5px] hover:bg-surface-2", t.done && "text-muted line-through")}>☐ {t.text}</button>)}</div> : null}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Database table
type Col = "title" | "type" | "status" | "tags" | "space" | "updated" | "created" | "words";
export function TableView() {
  const v = useVault();
  const ui = useUI();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: "updated", dir: -1 });
  const [hidden, setHidden] = useState<Set<Col>>(new Set(["created"]));
  const rows = useMemo(() => {
    const query = parseQuery(q);
    const f = matcher(query, v.folderMap, v.spaceMap);
    const t = query.text.toLowerCase();
    const val = (n: Note, c: Col): string | number => c === "title" ? n.title.toLowerCase() : c === "type" ? n.type : c === "status" ? STATUSES.indexOf(n.status as Status) : c === "tags" ? n.tags.join(" ") : c === "space" ? v.spaceMap.get(n.spaceId)?.name ?? "" : c === "updated" ? n.updatedAt : c === "created" ? n.createdAt : words(n.body);
    return scoped(v, ui).filter((n) => f(n) && (!t || n.title.toLowerCase().includes(t))).sort((a, b) => { const x = val(a, sort.col), y = val(b, sort.col); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [v, ui, q, sort]);
  const cols: Col[] = ["title", "type", "status", "tags", "space", "updated", "created", "words"];
  const shown = cols.filter((c) => !hidden.has(c));
  return (
    <div className="flex h-full flex-col">
      <Header title="Database" sub={`${rows.length} notes`}>
        <input className={inputCls + " h-9 w-full md:w-72"} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter: text type:lesson status:review tag:x" />
      </Header>
      <div className="flex flex-wrap gap-1 border-b border-line px-4 py-2">
        {cols.slice(1).map((c) => <Chip key={c} active={!hidden.has(c)} onClick={() => setHidden((h) => { const n = new Set(h); n.has(c) ? n.delete(c) : n.add(c); return n; })}>{c}</Chip>)}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead className="sticky top-0 bg-surface text-left text-[11.5px] uppercase tracking-wider text-muted">
            <tr>{shown.map((c) => <th key={c} className="cursor-pointer border-b border-line px-3 py-2 font-semibold" onClick={() => setSort((s) => ({ col: c, dir: s.col === c ? (-s.dir as 1 | -1) : 1 }))}>{c}{sort.col === c ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.id} onClick={() => openNote(n.id)} className="cursor-pointer border-b border-line/60 hover:bg-surface-2">
                {shown.map((c) => (
                  <td key={c} className="max-w-[320px] truncate px-3 py-2">
                    {c === "title" ? <span className="flex items-center gap-2 font-medium"><StatusDot status={n.status} />{n.title}</span>
                      : c === "status" ? (n.status ? <StatusPill status={n.status} /> : <span className="text-muted">—</span>)
                      : c === "tags" ? <span className="text-muted">{n.tags.map((t) => "#" + t).join(" ")}</span>
                      : c === "space" ? <span className="text-muted">{v.spaceMap.get(n.spaceId)?.icon} {v.spaceMap.get(n.spaceId)?.name}</span>
                      : c === "updated" ? <span className="text-muted">{relTime(n.updatedAt)}</span>
                      : c === "created" ? <span className="text-muted">{new Date(n.createdAt).toLocaleDateString()}</span>
                      : c === "words" ? <span className="tabular-nums text-muted">{n.type === "canvas" ? "—" : words(n.body)}</span>
                      : <span className="text-muted">{n.type}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Review (all due cards)
export function ReviewView() {
  const v = useVault();
  const ui = useUI();
  const notes = scoped(v, { ...ui, folderId: null });
  const due = useDueCards(notes);
  return (
    <div className="flex h-full flex-col">
      <Header title="Review" sub={`${due?.length ?? 0} cards due${ui.spaceId !== "all" ? " in this space" : ""}`} />
      <div className="min-h-0 flex-1"><ReviewSession notes={notes} title="All decks" /></div>
    </div>
  );
}

// ------------------------------------------------------------------ Trash
export function TrashView() {
  const trashed = useLiveQuery(() => db.notes.where("deleted").equals(1).toArray(), []) ?? [];
  const items = trashed.filter((n) => n.title !== "(deleted)").sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="flex h-full flex-col">
      <Header title="Trash" sub="Deleted notes stay here until you delete them forever" />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {items.length ? items.map((n) => (
          <div key={n.id} className="flex items-center gap-2 rounded-[10px] px-3 py-2 hover:bg-surface-2">
            <div className="min-w-0 flex-1"><div className="truncate text-[14px]">{n.title}</div><div className="text-[12px] text-muted">deleted {relTime(n.updatedAt)}</div></div>
            <Button size="sm" onClick={() => restoreNote(n.id)}><RotateCcw size={13} /> Restore</Button>
            <Button size="sm" variant="danger" onClick={() => confirm(`Delete “${n.title}” forever? Its history goes too.`) && purgeNote(n.id)}><Trash2 size={13} /></Button>
          </div>
        )) : <Empty icon={<Trash2 size={30} />} title="Trash is empty" />}
      </div>
    </div>
  );
}
