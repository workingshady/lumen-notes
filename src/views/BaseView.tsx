// Bases: database views of notes (table / board / gallery / list / calendar). Definition = YAML in the note body
// (lib/base.ts). Every change made here is written back to that YAML or to the listed notes through updateNote.
import { ArrowDown, ArrowUp, CalendarDays, ChevronLeft, ChevronRight, Columns3, Download, Filter, FileCode2, GalleryVerticalEnd, Group, List, MoreHorizontal, Plus, Search, Settings2, SortAsc, Table2, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Note } from "../../shared/types";
import { NOTE_TYPES, STATUSES } from "../../shared/types";
import { createNote, updateNote } from "../lib/actions";
import {
  BUILTIN, NONE, canon, condToExpr, editable, flatten, fmtDate, getValue, groupRows, impliedProps, isDateProp, isStatus, isType, knownProps, label,
  newView, parseBase, propsOf, runView, serializeBase, show, unflatten, unsupported, writeBase, yamlName, ymd, asTime,
  type BaseConfig, type BaseViewDef, type Cond, type Ctx, type FilterNode, type Group as RowGroup, type Row, type SortRule, type Val, type ViewType,
} from "../lib/base";
import { excerpt, inlineTags, setFrontMatter, splitFrontMatter } from "../lib/parse";
import { noteDerived, openNote, setUI, toast, useVault } from "../lib/store";
import { Button, cx, Sheet, STATUS_COLOR, inputCls } from "../components/ui";

const useWide = () => { const [w, setW] = useState(() => innerWidth >= 900); useEffect(() => { const f = () => setW(innerWidth >= 900); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return w; };
const VIEW_ICON: Record<ViewType, ReactNode> = { table: <Table2 size={14} />, board: <Columns3 size={14} />, cards: <GalleryVerticalEnd size={14} />, list: <List size={14} />, calendar: <CalendarDays size={14} /> };
const VIEW_LABEL: Record<ViewType, string> = { table: "Table", board: "Board", cards: "Gallery", list: "List", calendar: "Calendar" };
const PAGE = 200;
const propsFor = (n: Note) => noteDerived("baseProps", n, propsOf);
const isMd = (n: Note) => !["canvas", "whiteboard", "diagram"].includes(n.type);
const DEFAULT_ORDER = ["file.name", "status", "file.tags", "file.mtime"];

// ------------------------------------------------------------------ writes to listed notes
async function writeValue(n: Note, prop: string, value: string | null, spaces: { id: string; name: string }[]) {
  const k = canon(prop);
  if (k === "status") return updateNote(n.id, { status: value && isStatus(value) ? value : null });
  if (k === "type") return value && isType(value) ? updateNote(n.id, { type: value }) : undefined;
  if (k === "tags") return updateNote(n.id, { tags: [...new Set((value ?? "").split(",").map((t) => t.trim().replace(/^#/, "").toLowerCase()).filter(Boolean))] });
  if (k === "space") {
    const sp = spaces.find((s) => s.name === value || s.id === value);
    return sp ? updateNote(n.id, { spaceId: sp.id, folderId: null }) : undefined;
  }
  if (!editable(k)) return;
  // front-matter property: same write as the Properties panel (record props + YAML front-matter)
  const props = { ...n.props };
  if (!value) delete props[k]; else props[k] = value;
  if (!isMd(n)) return updateNote(n.id, { props });
  const inl = inlineTags(splitFrontMatter(n.body).body);
  const body = setFrontMatter(n.body, { [k]: value || null, type: n.type === "note" ? null : n.type, status: n.status ?? null, tags: n.tags.filter((t) => !inl.includes(t)) });
  return updateNote(n.id, { props, body });
}

/** Move a note from one group to another (board columns, calendar days). Multi-value properties swap the one value. */
async function moveTo(r: Row, prop: string, from: string, to: string, ctx: Ctx, spaces: { id: string; name: string }[]) {
  if (from === to) return;
  const k = canon(prop);
  if (!editable(k)) { toast(`${label(k)} can't be changed by dragging`, undefined, { icon: "info" }); return; }
  const cur = getValue(r.n, prop, ctx, r.props);
  if (Array.isArray(cur)) {
    const next = [...new Set([...cur.filter((x) => x !== from), ...(to === NONE ? [] : [to])])];
    return writeValue(r.n, prop, k === "tags" ? next.join(", ") : next.length ? `[${next.join(", ")}]` : null, spaces);
  }
  return writeValue(r.n, prop, to === NONE ? null : to, spaces);
}

// ------------------------------------------------------------------ pointer drag (mouse: move 5px; touch: long-press)
interface DragState { id: string; from: string; title: string; x: number; y: number; over: string | null }
function useDragCards(onDrop: (id: string, from: string, to: string) => void, scroller: React.RefObject<HTMLElement | null>) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragged = useRef(false);
  const start = (e: React.PointerEvent, id: string, from: string, title: string) => {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY, touch = e.pointerType !== "mouse";
    let active = false, timer = 0, raf = 0, last = { x: sx, y: sy };
    const overAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest("[data-drop]") as HTMLElement | null)?.dataset.drop ?? null;
    const begin = () => { active = true; dragged.current = true; navigator.vibrate?.(8); setDrag({ id, from, title, x: last.x, y: last.y, over: overAt(last.x, last.y) }); };
    const scroll = () => {
      const el = scroller.current;
      if (active && el) {
        const r = el.getBoundingClientRect(), edge = 48;
        // speed grows as the pointer nears the edge (max ~10px per frame)
        const sp = (d: number) => Math.round(10 * Math.min(1, (edge - d) / edge));
        const dx = last.x < r.left + edge ? -sp(last.x - r.left) : last.x > r.right - edge ? sp(r.right - last.x) : 0;
        const dy = last.y < r.top + edge ? -sp(last.y - r.top) : last.y > r.bottom - edge ? sp(r.bottom - last.y) : 0;
        if (dx || dy) el.scrollBy(dx, dy);
      }
      raf = requestAnimationFrame(scroll);
    };
    const move = (ev: PointerEvent) => {
      last = { x: ev.clientX, y: ev.clientY };
      const dist = Math.hypot(ev.clientX - sx, ev.clientY - sy);
      if (!active) {
        if (touch) { if (dist > 8) cleanup(); return; }
        if (dist > 5) begin(); else return;
      }
      setDrag((d) => (d ? { ...d, x: ev.clientX, y: ev.clientY, over: overAt(ev.clientX, ev.clientY) } : d));
    };
    const blockTouch = (ev: TouchEvent) => { if (active) ev.preventDefault(); };
    const up = () => {
      if (active) { const to = overAt(last.x, last.y); if (to !== null) onDrop(id, from, to); }
      cleanup();
      setTimeout(() => { dragged.current = false; }, 0);
    };
    function cleanup() {
      clearTimeout(timer); cancelAnimationFrame(raf);
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", cancel);
      removeEventListener("touchmove", blockTouch);
      setDrag(null);
    }
    const cancel = () => { if (!active) cleanup(); };
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", cancel);
    addEventListener("touchmove", blockTouch, { passive: false });
    if (touch) timer = window.setTimeout(begin, 300);
    raf = requestAnimationFrame(scroll);
  };
  const ghost = drag && <div className="base-ghost" style={{ left: drag.x + 8, top: drag.y + 8 }} dir="auto">{drag.title || "Untitled"}</div>;
  return { drag, start, ghost, wasDrag: () => dragged.current };
}

// ------------------------------------------------------------------ main view
export function BaseView({ note }: { note: Note }) {
  const v = useVault();
  const wide = useWide();
  const { cfg, error, found } = useMemo(() => parseBase(note.body), [note.body]);
  const vKey = `lumen.base.view.${note.id}`;
  const [vi, setVi] = useState(() => { try { return Number(localStorage.getItem(vKey)) || 0; } catch { return 0; } });
  const idx = Math.min(vi, cfg.views.length - 1);
  const view = cfg.views[idx];
  const pick = (i: number) => { setVi(i); try { localStorage.setItem(vKey, String(i)); } catch { /* ignore */ } };
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<null | "filter" | "sort" | "group" | "props" | "view" | "add">(null);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [idx, search]);
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { tabsRef.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [idx]);

  const ctx: Ctx = useMemo(() => ({
    spaceName: (id) => v.spaceMap.get(id)?.name ?? (id === "inbox" ? "Inbox" : id),
    folderPath: (id) => {
      const names: string[] = []; const seen = new Set<string>();
      for (let f = id ? v.folderMap.get(id) : undefined; f && !seen.has(f.id); f = f.parentId ? v.folderMap.get(f.parentId) : undefined) { seen.add(f.id); names.unshift(f.name); }
      return names.join("/");
    },
  }), [v]);
  const spaces = useMemo(() => v.spaces.map((s) => ({ id: s.id, name: s.name })), [v.spaces]);
  const { rows, total } = useMemo(() => runView(v.notes, cfg, view, ctx, propsFor, { search, self: note.id }), [v.notes, cfg, view, ctx, search, note.id]);
  const allProps = useMemo(() => [...BUILTIN, ...knownProps(v.notes.slice(0, 4000).map((n) => ({ props: propsFor(n) })))], [v.notes]);
  const bad = useMemo(() => [...unsupported(cfg.filters), ...unsupported(view.filters)], [cfg.filters, view.filters]);

  /** Change the definition: clone, mutate, write the YAML back into the body. */
  const edit = (fn: (c: BaseConfig, view: BaseViewDef) => void) => {
    const c = structuredClone(cfg) as BaseConfig;
    fn(c, c.views[idx]);
    void updateNote(note.id, { body: writeBase(note.body, c) });
  };
  const order = view.order?.length ? view.order : DEFAULT_ORDER;
  const cols = order.filter((p) => canon(p) !== "title");
  const groupBy = view.type === "board" ? view.groupBy ?? { property: "status", direction: "ASC" as const } : view.groupBy;

  const newNote = async (extra: Record<string, string> = {}) => {
    const imp = { ...impliedProps(cfg, view), ...extra };
    const fm: Record<string, string> = {};
    let type: Note["type"] | undefined, status: Note["status"] | undefined, tags: string[] = [], spaceId = note.spaceId;
    for (const [k, val] of Object.entries(imp)) {
      if (k === "type" && isType(val)) type = val;
      else if (k === "status") status = isStatus(val) ? val : null;
      else if (k === "tags") tags = val.split(",").map((t) => t.trim()).filter(Boolean);
      else if (k === "space") spaceId = spaces.find((s) => s.name === val)?.id ?? spaceId;
      else if (editable(k) && !["title", "folder", "created", "updated"].includes(k)) fm[k] = val;
    }
    const n = await createNote({ spaceId, ...(type ? { type } : {}), ...(status !== undefined ? { status } : {}), tags, ...(Object.keys(fm).length ? { fm } : {}) });
    openNote(n.id, "edit");
  };

  const download = () => {
    const blob = new Blob([serializeBase(cfg)], { type: "text/yaml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${note.title || "base"}.base`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const filterCount = flatten(view.filters).conds.length + flatten(view.filters).raw.length + (cfg.filters ? flatten(cfg.filters).conds.length + flatten(cfg.filters).raw.length : 0);
  const tool = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] px-2 text-[12.5px] text-muted hover:bg-surface-2 hover:text-ink";
  const visible = rows.slice(0, shown);
  const more = rows.length > shown && <div className="flex justify-center py-3"><Button size="sm" onClick={() => setShown((s) => s + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more</Button></div>;

  return (
    <div className="base flex h-full min-h-0 flex-col">
      {/* views */}
      <div ref={tabsRef} className={cx("flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line", wide ? "px-6 pt-3" : "px-3 pt-2")} style={{ scrollbarWidth: "none" }}>
        <span dir="auto" className="me-2 hidden max-w-[260px] truncate text-[15px] font-semibold md:inline">{note.title}</span>
        {cfg.views.map((w, i) => (
          <button key={i} data-active={i === idx || undefined} onClick={() => (i === idx ? setPanel("view") : pick(i))} title={i === idx ? "View settings" : w.name}
            className={cx("flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-[13px]", i === idx ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink")}>
            {VIEW_ICON[w.type]}<span dir="auto" className="max-w-[160px] truncate">{w.name}</span>
          </button>
        ))}
        <button aria-label="Add view" title="Add view" onClick={() => setPanel("add")} className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-ink"><Plus size={15} /></button>
      </div>

      {/* toolbar */}
      <div className={cx("flex shrink-0 items-center gap-1 border-b border-line py-1.5", wide ? "px-6" : "px-3")}>
        <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-[8px] border border-line bg-bg px-2 text-muted focus-within:border-accent md:max-w-[280px]">
          <Search size={14} className="shrink-0" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" dir="auto" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-muted" />
          {search && <button aria-label="Clear search" onClick={() => setSearch("")}><X size={13} /></button>}
        </label>
        <span className="shrink-0 px-1.5 text-[12px] tabular-nums text-muted" title={view.limit && total > rows.length ? `Limited to ${view.limit}` : undefined}>{rows.length}{total > rows.length ? `/${total}` : ""} {wide ? (rows.length === 1 ? "note" : "notes") : ""}</span>
        <span className="flex-1 max-md:hidden" />
        <button className={cx(tool, filterCount > 0 && "text-accent")} onClick={() => setPanel("filter")} title="Filter"><Filter size={14} />{wide && "Filter"}{filterCount ? <b className="text-[11px]">{filterCount}</b> : null}</button>
        <button className={cx(tool, !!view.sort?.length && "text-accent")} onClick={() => setPanel("sort")} title="Sort"><SortAsc size={14} />{wide && "Sort"}</button>
        {view.type !== "calendar" && <button className={cx(tool, groupBy && "text-accent")} onClick={() => setPanel("group")} title={view.type === "board" ? "Columns" : "Group"}><Group size={14} />{wide && (view.type === "board" ? `By ${label(groupBy!.property).toLowerCase()}` : "Group")}</button>}
        <button className={tool} onClick={() => setPanel("props")} title="Properties"><Settings2 size={14} />{wide && "Properties"}</button>
        <button className={tool} onClick={() => setPanel("view")} aria-label="View settings" title="View settings"><MoreHorizontal size={15} /></button>
        <Button size="sm" variant="primary" className="ms-1" onClick={() => newNote()}><Plus size={13} />{wide ? "New" : ""}</Button>
      </div>

      {(error || bad.length > 0 || !found) && (
        <div className={cx("shrink-0 border-b border-line py-1.5 text-[12px]", wide ? "px-6" : "px-3", error ? "text-bad" : "text-muted")} dir="auto">
          {error ? `Couldn't read the base definition: ${error}` : !found ? "No ```base block yet: showing every note. Change a view here or use Edit to write the YAML." : `Ignored filter${bad.length > 1 ? "s" : ""} Lumen can't evaluate: ${bad.join(" · ")}`}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {view.type === "table" ? (
          <TableView rows={visible} cols={cols} view={view} ctx={ctx} spaces={spaces} groupBy={groupBy} wide={wide} more={more} edit={edit} />
        ) : view.type === "board" ? (
          <BoardView rows={rows} cols={cols} groupBy={groupBy!} ctx={ctx} spaces={spaces} wide={wide} onNew={(k) => newNote(k === NONE ? {} : { [canon(groupBy!.property)]: k })} />
        ) : view.type === "calendar" ? (
          <CalendarView rows={rows} view={view} ctx={ctx} spaces={spaces} wide={wide} />
        ) : (
          <CardsView rows={visible} cols={cols} ctx={ctx} groupBy={groupBy} list={view.type === "list"} wide={wide} more={more} />
        )}
        {!rows.length && <div className="px-6 py-14 text-center text-[13px] text-muted">{search ? `No notes match “${search}”.` : "No notes match this view's filters."}</div>}
      </div>

      {/* panels */}
      <Sheet open={panel === "filter"} onClose={() => setPanel(null)} title="Filter">
        <FilterEditor title="This view" node={view.filters} props={allProps} notes={v.notes} ctx={ctx} onChange={(f) => edit((_c, w) => { w.filters = f; })} />
        <div className="my-4 border-t border-line" />
        <FilterEditor title="All views (base filter)" node={cfg.filters} props={allProps} notes={v.notes} ctx={ctx} onChange={(f) => edit((c) => { c.filters = f; })} />
      </Sheet>
      <Sheet open={panel === "sort"} onClose={() => setPanel(null)} title="Sort">
        <SortEditor sort={view.sort ?? []} props={allProps} onChange={(s) => edit((_c, w) => { w.sort = s.length ? s : undefined; })} />
      </Sheet>
      <Sheet open={panel === "group"} onClose={() => setPanel(null)} title={view.type === "board" ? "Board columns" : "Group by"}>
        <div className="space-y-3">
          <div className="text-[12.5px] text-muted">{view.type === "board" ? "Each value of this property is a column. Dragging a card to another column changes the property on the note." : "Rows are grouped under a header per value."}</div>
          <div className="flex gap-2">
            <PropSelect value={groupBy?.property ?? ""} props={allProps} allowNone={view.type !== "board"} onChange={(p) => edit((_c, w) => { w.groupBy = p ? { property: p, direction: w.groupBy?.direction ?? "ASC" } : undefined; })} />
            {groupBy && <DirButton dir={groupBy.direction} onClick={() => edit((_c, w) => { w.groupBy = { property: groupBy.property, direction: groupBy.direction === "ASC" ? "DESC" : "ASC" }; })} />}
          </div>
        </div>
      </Sheet>
      <Sheet open={panel === "props"} onClose={() => setPanel(null)} title={view.type === "table" ? "Columns" : "Shown properties"}>
        <PropsEditor order={order} props={allProps} onChange={(o) => edit((_c, w) => { w.order = o; })} />
      </Sheet>
      <Sheet open={panel === "add"} onClose={() => setPanel(null)} title="Add a view">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {(["table", "board", "cards", "list", "calendar"] as ViewType[]).map((t) => (
            <button key={t} className="flex items-center gap-2 rounded-[10px] border border-line p-3 text-start text-[13.5px] hover:border-accent"
              onClick={() => { setPanel(null); edit((c) => { c.views.push({ ...newView(t), filters: view.filters }); }); pick(cfg.views.length); }}>
              {VIEW_ICON[t]} {VIEW_LABEL[t]}
            </button>
          ))}
        </div>
      </Sheet>
      <Sheet open={panel === "view"} onClose={() => setPanel(null)} title="View settings">
        <ViewSettings key={idx} view={view} props={allProps} canDelete={cfg.views.length > 1} edit={edit}
          onDuplicate={() => { setPanel(null); edit((c, w) => { c.views.splice(idx + 1, 0, { ...structuredClone(w), name: `${w.name} copy` }); }); pick(idx + 1); }}
          onDelete={() => { setPanel(null); edit((c) => { c.views.splice(idx, 1); }); pick(Math.max(0, idx - 1)); }}
          onSource={() => { setPanel(null); setUI({ mode: "edit" }); }} onDownload={download} />
      </Sheet>
    </div>
  );
}

// ------------------------------------------------------------------ cells
function StatusChip({ s }: { s: string | null }) {
  if (!s) return <span className="text-muted">—</span>;
  const c = isStatus(s) ? STATUS_COLOR[s] : "var(--muted)";
  return <span className="inline-flex items-center gap-1.5 rounded-full px-2 text-[12px] font-medium capitalize leading-[20px]" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}><span className="size-1.5 rounded-full" style={{ background: c }} />{s}</span>;
}
function ValueView({ v, p }: { v: Val; p: string }) {
  const k = canon(p);
  if (k === "status") return <StatusChip s={v as string | null} />;
  if (v === null || v === "" || (Array.isArray(v) && !v.length)) return <span className="text-muted/60">—</span>;
  if (Array.isArray(v)) return <span className="inline-flex flex-wrap gap-1">{v.map((t) => <span key={t} dir="auto" className="rounded-[6px] bg-surface-2 px-1.5 text-[11.5px] leading-[18px] text-muted">{k === "tags" ? "#" : ""}{t}</span>)}</span>;
  if (typeof v === "string" && /^https?:\/\//.test(v)) return <a href={v} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-link hover:underline">{v.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}</a>;
  return <span dir="auto">{show(v, p)}</span>;
}

/** Inline editor for one cell. Status/type/space = select; tags & properties = text (date picker for date-like keys). */
function CellEdit({ r, p, ctx, spaces }: { r: Row; p: string; ctx: Ctx; spaces: { id: string; name: string }[] }) {
  const k = canon(p);
  const v = getValue(r.n, p, ctx, r.props);
  const [editing, setEditing] = useState(false);
  const sel = "h-7 w-full cursor-pointer appearance-none rounded-[6px] bg-transparent px-1 text-[13px] outline-none hover:bg-surface-2 focus:bg-surface-2";
  if (k === "status") return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-0 flex items-center px-1"><StatusChip s={r.n.status} /></div>
      <select aria-label="Status" value={r.n.status ?? ""} onChange={(e) => writeValue(r.n, "status", e.target.value || null, spaces)} className={cx(sel, "text-transparent")}>
        <option value="">—</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
  if (k === "type") return <select aria-label="Type" value={r.n.type} onChange={(e) => writeValue(r.n, "type", e.target.value, spaces)} className={sel}>{NOTE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>;
  if (k === "space") return <select aria-label="Space" value={r.n.spaceId} onChange={(e) => writeValue(r.n, "space", e.target.value, spaces)} className={sel} dir="auto">{spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}{!spaces.some((s) => s.id === r.n.spaceId) && <option value={r.n.spaceId}>{ctx.spaceName(r.n.spaceId)}</option>}</select>;
  if (!editable(k)) return <ValueView v={v} p={p} />;
  const text = Array.isArray(v) ? v.join(", ") : v === null ? "" : String(v);
  const date = isDateProp(k, v) && (text === "" || /^\d{4}-\d{2}-\d{2}$/.test(text));
  if (!editing) return <button className="block min-h-7 w-full truncate rounded-[6px] px-1 text-start hover:bg-surface-2" onClick={(e) => { e.stopPropagation(); setEditing(true); }}><ValueView v={v} p={p} /></button>;
  const commit = (val: string) => {
    setEditing(false);
    const next = k === "tags" ? val : Array.isArray(v) && val.includes(",") ? `[${val}]` : val.trim();
    if (next !== text) void writeValue(r.n, p, next.trim() || null, spaces);
  };
  return (
    <input autoFocus ref={date ? (el) => { try { el?.showPicker?.(); } catch { /* needs a user gesture */ } } : undefined} type={date ? "date" : "text"} defaultValue={text} dir="auto" aria-label={label(p)}
      onClick={(e) => e.stopPropagation()} onBlur={(e) => commit(e.target.value)} onChange={date ? (e) => { if (e.target.value) commit(e.target.value); } : undefined}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className="h-7 w-full rounded-[6px] border border-transparent bg-transparent px-1 text-[13px] text-ink outline-none hover:bg-surface-2 focus:border-accent focus:bg-bg" />
  );
}

// ------------------------------------------------------------------ table
function TableView({ rows, cols, view, ctx, spaces, groupBy, wide, more, edit }: { rows: Row[]; cols: string[]; view: BaseViewDef; ctx: Ctx; spaces: { id: string; name: string }[]; groupBy?: SortRule; wide: boolean; more: ReactNode; edit: (fn: (c: BaseConfig, v: BaseViewDef) => void) => void }) {
  const size = (p: string) => view.columnSize?.[p] ?? view.columnSize?.[yamlName(canon(p))] ?? (canon(p) === "title" ? (wide ? 280 : 160) : canon(p) === "tags" ? 180 : 140);
  const [live, setLive] = useState<Record<string, number>>({});
  const w = (p: string) => live[p] ?? size(p);
  const titleKey = "file.name";
  const all = [titleKey, ...cols];
  const resize = (e: React.PointerEvent, p: string) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, start = w(p);
    let cur = start;
    const move = (ev: PointerEvent) => { cur = Math.max(60, Math.min(800, start + (document.dir === "rtl" ? sx - ev.clientX : ev.clientX - sx))); setLive((l) => ({ ...l, [p]: cur })); };
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up);
      if (cur !== start) edit((_c, vv) => { vv.columnSize = { ...(vv.columnSize ?? {}), [p]: Math.round(cur) }; });
      setTimeout(() => setLive((l) => { const { [p]: _x, ...rest } = l; void _x; return rest; }), 400);
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  const sortOf = (p: string) => view.sort?.[0] && canon(view.sort[0].property) === canon(p) ? view.sort[0].direction : null;
  const clickHead = (p: string) => edit((_c, vv) => {
    const d = sortOf(p);
    vv.sort = d === "ASC" ? [{ property: p, direction: "DESC" }] : d === "DESC" ? undefined : [{ property: p, direction: "ASC" }];
  });
  const groups: RowGroup[] = groupBy ? groupRows(rows, groupBy, ctx) : [{ key: "", label: "", rows }];
  const body = (r: Row, gk: string) => (
    <tr key={gk + r.n.id} onClick={() => openNote(r.n.id)} className="base-row">
      <td className="base-sticky"><span className="flex items-center gap-2"><span className="size-[7px] shrink-0 rounded-full" style={{ background: r.n.status ? STATUS_COLOR[r.n.status] : "var(--muted)" }} /><span dir="auto" className="truncate font-medium">{r.n.title || "Untitled"}</span></span></td>
      {cols.map((p) => (
        <td key={p} onClick={editable(p) ? (e) => e.stopPropagation() : undefined}>
          {editable(p) ? <CellEdit r={r} p={p} ctx={ctx} spaces={spaces} /> : <span className="block truncate"><ValueView v={getValue(r.n, p, ctx, r.props)} p={p} /></span>}
        </td>
      ))}
      <td aria-hidden />
    </tr>
  );
  return (
    <div className="base-scroll h-full overflow-auto">
      <table className="base-table" style={{ width: all.reduce((a, p) => a + w(p), 0) + 40 }}>
        <colgroup>{all.map((p) => <col key={p} style={{ width: w(p) }} />)}<col style={{ width: 40 }} /></colgroup>
        <thead>
          <tr>
            {all.map((p, i) => (
              <th key={p} className={cx(i === 0 && "base-sticky")} onClick={() => clickHead(p)} title={`Sort by ${label(p)}`}>
                <span className="flex items-center gap-1"><span className="truncate">{label(p)}</span>{sortOf(p) === "ASC" ? <ArrowUp size={12} /> : sortOf(p) === "DESC" ? <ArrowDown size={12} /> : null}</span>
                <span className="base-resize" onPointerDown={(e) => resize(e, p)} onClick={(e) => e.stopPropagation()} aria-hidden />
              </th>
            ))}
            <th aria-hidden />
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            [groupBy && (
              <tr key={"g" + g.key} className="base-group"><td className="base-sticky" colSpan={1}><span className="flex items-center gap-2">{canon(groupBy.property) === "status" && g.key !== NONE ? <StatusChip s={g.key} /> : <span dir="auto" className="font-semibold">{g.label}</span>}<span className="text-muted">{g.rows.length}</span></span></td><td colSpan={cols.length + 1} /></tr>
            ), ...g.rows.map((r) => body(r, g.key))]
          ))}
        </tbody>
      </table>
      {more}
    </div>
  );
}

// ------------------------------------------------------------------ board
function BoardView({ rows, cols, groupBy, ctx, spaces, wide, onNew }: { rows: Row[]; cols: string[]; groupBy: SortRule; ctx: Ctx; spaces: { id: string; name: string }[]; wide: boolean; onNew: (key: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(rows.map((r) => [r.n.id, r])), [rows]);
  const { drag, start, ghost, wasDrag } = useDragCards((id, from, to) => { const r = byId.get(id); if (r) void moveTo(r, groupBy.property, from, to, ctx, spaces); }, scroller);
  const groups = useMemo(() => groupRows(rows, groupBy, ctx, { allStatuses: true }), [rows, groupBy, ctx]);
  const isStatusCol = canon(groupBy.property) === "status";
  return (
    <div ref={scroller} className={cx("base-board h-full overflow-auto", drag && "is-dragging", wide ? "px-6 py-4" : "px-3 py-3")}>
      <div className="flex h-full items-stretch gap-3">
        {groups.map((g) => (
          <section key={g.key} data-drop={g.key} className={cx("base-col flex shrink-0 flex-col rounded-[12px] border border-line bg-surface", drag?.over === g.key && drag.from !== g.key && "is-over")}>
            <header className="flex items-center gap-2 px-3 pb-1.5 pt-2.5 text-[13px]">
              {isStatusCol && g.key !== NONE ? <StatusChip s={g.key} /> : <span dir="auto" className="truncate font-semibold">{g.label}</span>}
              <span className="text-muted">{g.rows.length}</span>
              <span className="flex-1" />
              <button aria-label={`New note in ${g.label}`} title="New note here" onClick={() => onNew(g.key)} className="flex size-6 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink"><Plus size={14} /></button>
            </header>
            <div className="flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {g.rows.slice(0, 300).map((r) => (
                <article key={r.n.id} onPointerDown={(e) => start(e, r.n.id, g.key, r.n.title)} onClick={() => !wasDrag() && openNote(r.n.id)}
                  className={cx("base-card cursor-pointer select-none rounded-[10px] border border-line bg-bg p-2.5 hover:border-accent/60", drag?.id === r.n.id && "opacity-40")}>
                  <div dir="auto" className="text-[13.5px] font-semibold leading-5">{r.n.title || "Untitled"}</div>
                  <CardProps r={r} cols={cols.filter((p) => canon(p) !== canon(groupBy.property))} ctx={ctx} />
                </article>
              ))}
              {g.rows.length > 300 && <div className="px-1 text-[12px] text-muted">+{g.rows.length - 300} more</div>}
            </div>
          </section>
        ))}
      </div>
      {ghost}
    </div>
  );
}

function CardProps({ r, cols, ctx }: { r: Row; cols: string[]; ctx: Ctx }) {
  const items = cols.map((p) => [p, getValue(r.n, p, ctx, r.props)] as const).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length));
  if (!items.length) return null;
  return <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">{items.map(([p, v]) => <span key={p} title={label(p)} className="max-w-full truncate"><ValueView v={v} p={p} /></span>)}</div>;
}

// ------------------------------------------------------------------ gallery + list
const COVER = /^(https?:\/\/\S+\.(png|jpe?g|gif|webp|avif|svg))(\?\S*)?$/i;
function CardsView({ rows, cols, ctx, groupBy, list, wide, more }: { rows: Row[]; cols: string[]; ctx: Ctx; groupBy?: SortRule; list: boolean; wide: boolean; more: ReactNode }) {
  const groups: RowGroup[] = groupBy ? groupRows(rows, groupBy, ctx) : [{ key: "", label: "", rows }];
  const text = (n: Note) => noteDerived("baseExcerpt", n, (x) => (isMd(x) ? excerpt(splitFrontMatter(x.body.slice(0, 6000)).body.replace(/^\s*#\s.*$/m, "").replace(/```[\s\S]*?```/g, " "), 140) : x.type));
  return (
    <div className={cx("h-full overflow-y-auto", wide ? "px-6 py-4" : "px-3 py-3")}>
      {groups.map((g) => (
        <section key={g.key} className="mb-5">
          {groupBy && <h3 className="mb-2 flex items-center gap-2 text-[13px]">{canon(groupBy.property) === "status" && g.key !== NONE ? <StatusChip s={g.key} /> : <span dir="auto" className="font-semibold">{g.label}</span>}<span className="text-muted">{g.rows.length}</span></h3>}
          {list ? (
            <div className="divide-y divide-line rounded-[12px] border border-line bg-surface">
              {g.rows.map((r) => (
                <button key={r.n.id} onClick={() => openNote(r.n.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-start hover:bg-surface-2">
                  <span className="size-[7px] shrink-0 rounded-full" style={{ background: r.n.status ? STATUS_COLOR[r.n.status] : "var(--muted)" }} />
                  <span dir="auto" className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{r.n.title || "Untitled"}</span>
                  <span className="hidden shrink-0 md:block"><CardProps r={r} cols={cols.slice(0, 4)} ctx={ctx} /></span>
                </button>
              ))}
            </div>
          ) : (
            <div className="base-gallery grid gap-3">
              {g.rows.map((r) => {
                const cover = Object.entries(r.props).find(([k, val]) => /^(cover|image|banner|thumbnail)$/i.test(k) && COVER.test(val))?.[1];
                return (
                  <button key={r.n.id} onClick={() => openNote(r.n.id)} className="flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface text-start hover:border-accent/60">
                    {cover ? <img src={cover} alt="" loading="lazy" className="h-28 w-full object-cover" /> : <div dir="auto" className="line-clamp-4 h-[92px] overflow-hidden [overflow-wrap:anywhere] border-b border-line bg-surface-2/50 px-3 py-2.5 text-[12px] leading-[18px] text-muted">{text(r.n) || " "}</div>}
                    <div className="flex flex-col gap-1 p-3">
                      <div dir="auto" className="line-clamp-2 text-[13.5px] font-semibold leading-5">{r.n.title || "Untitled"}</div>
                      <CardProps r={r} cols={cols} ctx={ctx} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      ))}
      {more}
    </div>
  );
}

// ------------------------------------------------------------------ calendar
function CalendarView({ rows, view, ctx, spaces, wide }: { rows: Row[]; view: BaseViewDef; ctx: Ctx; spaces: { id: string; name: string }[]; wide: boolean }) {
  const prop = view.date ?? "file.ctime";
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [sel, setSel] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const byDay = useMemo(() => {
    const m = new Map<string, Row[]>(); let none = 0;
    for (const r of rows) {
      const raw = getValue(r.n, prop, ctx, r.props);
      const t = asTime(Array.isArray(raw) ? raw[0] ?? null : raw);
      if (t === null) { none++; continue; }
      const k = ymd(new Date(t));
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return { m, none };
  }, [rows, prop, ctx]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.n.id, r])), [rows]);
  const { drag, start, ghost, wasDrag } = useDragCards((id, from, to) => { const r = byId.get(id); if (r) void moveTo(r, prop, from, to, ctx, spaces); }, scroller);
  const first = new Date(month); const lead = (first.getDay() + 6) % 7; // weeks start on Monday
  const days = Array.from({ length: 42 }, (_, i) => new Date(month.getFullYear(), month.getMonth(), 1 - lead + i));
  const today = ymd(new Date());
  const selRows = sel ? byDay.m.get(sel) ?? [] : [];
  return (
    <div ref={scroller} className={cx("h-full overflow-y-auto", wide ? "px-6 py-4" : "px-2 py-3")}>
      <div className="mb-3 flex items-center gap-2 px-1">
        <div className="text-[15px] font-semibold">{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</div>
        <span className="text-[12px] text-muted">by {label(prop).toLowerCase()}</span>
        <span className="flex-1" />
        <button aria-label="Previous month" className="flex size-8 items-center justify-center rounded-[8px] text-muted hover:bg-surface-2 rtl:rotate-180" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={16} /></button>
        <Button size="sm" variant="ghost" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSel(today); }}>Today</Button>
        <button aria-label="Next month" className="flex size-8 items-center justify-center rounded-[8px] text-muted hover:bg-surface-2 rtl:rotate-180" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={16} /></button>
      </div>
      <div className="base-cal grid grid-cols-7 overflow-hidden rounded-[12px] border border-line">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="border-b border-line bg-surface px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">{wide ? d : d[0]}</div>)}
        {days.map((d) => {
          const k = ymd(d), list = byDay.m.get(k) ?? [], out = d.getMonth() !== month.getMonth();
          return (
            <div key={k} data-drop={k} onClick={() => setSel(sel === k ? null : k)}
              className={cx("base-day cursor-pointer border-b border-e border-line p-1", out && "bg-surface/40 text-muted", sel === k && "is-sel", drag?.over === k && "is-over")}>
              <div className={cx("mb-0.5 flex size-6 items-center justify-center rounded-full text-[12px]", k === today && "bg-accent font-semibold text-accent-fg")}>{d.getDate()}</div>
              {wide ? (
                <div className="flex flex-col gap-0.5">
                  {list.slice(0, 3).map((r) => (
                    <div key={r.n.id} onPointerDown={(e) => start(e, r.n.id, k, r.n.title)} onClick={(e) => { e.stopPropagation(); if (!wasDrag()) openNote(r.n.id); }} dir="auto"
                      className="truncate rounded-[5px] px-1.5 text-[11.5px] leading-[18px] hover:brightness-110" style={{ background: `color-mix(in srgb, ${r.n.status ? STATUS_COLOR[r.n.status] : "var(--muted)"} 18%, transparent)` }}>{r.n.title || "Untitled"}</div>
                  ))}
                  {list.length > 3 && <div className="px-1 text-[11px] text-muted">+{list.length - 3} more</div>}
                </div>
              ) : list.length > 0 && <div className="flex flex-wrap gap-0.5 px-0.5">{list.slice(0, 4).map((r) => <span key={r.n.id} className="size-1.5 rounded-full" style={{ background: r.n.status ? STATUS_COLOR[r.n.status] : "var(--accent)" }} />)}</div>}
            </div>
          );
        })}
      </div>
      {byDay.none > 0 && <div className="mt-2 px-1 text-[12px] text-muted">{byDay.none} note{byDay.none === 1 ? "" : "s"} without a {label(prop).toLowerCase()}</div>}
      {sel && (
        <div className="mt-3 rounded-[12px] border border-line bg-surface">
          <div className="border-b border-line px-3 py-2 text-[13px] font-semibold">{fmtDate(asTime(sel)!)} <span className="font-normal text-muted">{selRows.length}</span></div>
          {selRows.length ? selRows.map((r) => (
            <button key={r.n.id} onClick={() => openNote(r.n.id)} className="flex w-full items-center gap-2 px-3 py-2.5 text-start hover:bg-surface-2">
              <span className="size-[7px] shrink-0 rounded-full" style={{ background: r.n.status ? STATUS_COLOR[r.n.status] : "var(--muted)" }} />
              <span dir="auto" className="truncate text-[13.5px]">{r.n.title || "Untitled"}</span>
            </button>
          )) : <div className="px-3 py-3 text-[12.5px] text-muted">Nothing on this day.</div>}
        </div>
      )}
      {ghost}
    </div>
  );
}

// ------------------------------------------------------------------ editors (filters, sort, columns, view)
function PropSelect({ value, props, onChange, allowNone }: { value: string; props: string[]; onChange: (p: string) => void; allowNone?: boolean }) {
  const has = props.some((p) => canon(p) === canon(value));
  return (
    <select value={has ? props.find((p) => canon(p) === canon(value)) : value} onChange={(e) => onChange(e.target.value ? yamlName(canon(e.target.value)) : "")} className={cx(inputCls, "min-w-0 flex-1 text-[13px]")}>
      {allowNone && <option value="">None</option>}
      {!has && value && <option value={value}>{label(value)}</option>}
      {props.map((p) => <option key={p} value={p}>{label(p)}</option>)}
    </select>
  );
}
const DirButton = ({ dir, onClick }: { dir: "ASC" | "DESC"; onClick: () => void }) => (
  <button onClick={onClick} className="flex h-9 shrink-0 items-center gap-1 rounded-[6px] border border-line px-2.5 text-[12.5px] hover:bg-surface-2">{dir === "ASC" ? <><ArrowUp size={13} />Ascending</> : <><ArrowDown size={13} />Descending</>}</button>
);

const OPS: { id: string; l: string; op: Cond["op"]; neg: boolean; noValue?: boolean }[] = [
  { id: "is", l: "is", op: "==", neg: false }, { id: "isnt", l: "is not", op: "!=", neg: false },
  { id: "has", l: "contains", op: "contains", neg: false }, { id: "hasnt", l: "does not contain", op: "contains", neg: true },
  { id: "starts", l: "starts with", op: "startsWith", neg: false },
  { id: "gt", l: ">", op: ">", neg: false }, { id: "gte", l: "≥", op: ">=", neg: false }, { id: "lt", l: "<", op: "<", neg: false }, { id: "lte", l: "≤", op: "<=", neg: false },
  { id: "empty", l: "is empty", op: "isEmpty", neg: false, noValue: true }, { id: "set", l: "is not empty", op: "isEmpty", neg: true, noValue: true },
  { id: "tag", l: "has tag", op: "hasTag", neg: false }, { id: "notag", l: "does not have tag", op: "hasTag", neg: true },
  { id: "folder", l: "in folder", op: "inFolder", neg: false },
];
const opId = (c: Cond) => (c.op === "==" && c.neg ? "isnt" : c.op === "!=" && c.neg ? "is" : OPS.find((o) => o.op === c.op && o.neg === c.neg)?.id ?? "is");

function FilterEditor({ title, node, props, notes, ctx, onChange }: { title: string; node: FilterNode | undefined; props: string[]; notes: Note[]; ctx: Ctx; onChange: (f: FilterNode | undefined) => void }) {
  const ff = flatten(node);
  const set = (conds: Cond[], mode = ff.mode) => onChange(unflatten({ mode, conds, raw: ff.raw }));
  const values = (p: string) => {
    const s = new Set<string>();
    for (const n of notes.slice(0, 3000)) { const v = getValue(n, p, ctx, propsFor(n)); for (const x of Array.isArray(v) ? v : v === null ? [] : [canon(p) === "created" || canon(p) === "updated" ? ymd(new Date(v as number)) : String(v)]) if (s.size < 200) s.add(x); }
    return [...s].sort();
  };
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="text-[13px] font-semibold">{title}</div>
        {ff.conds.length + ff.raw.length > 1 && (
          <select aria-label="Match" value={ff.mode} onChange={(e) => set(ff.conds, e.target.value as "and" | "or")} className="h-7 rounded-[6px] border border-line bg-bg px-1.5 text-[12px]">
            <option value="and">All match (AND)</option><option value="or">Any matches (OR)</option>
          </select>
        )}
      </div>
      {ff.conds.map((c, i) => {
        const o = OPS.find((x) => x.id === opId(c))!;
        const vals = values(c.prop);
        const listId = `bv-${title.length}-${i}`;
        return (
          <div key={i + condToExpr(c)} className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,1fr)_auto] items-center gap-1.5">
            {o.op === "hasTag" || o.op === "inFolder" ? <div className={cx(inputCls, "flex items-center text-[13px] text-muted")}>{o.op === "hasTag" ? "Tags" : "Folder"}</div> :
              <PropSelect value={c.prop} props={props} onChange={(p) => { const cs = [...ff.conds]; cs[i] = { ...c, prop: p }; set(cs); }} />}
            <select aria-label="Operator" value={o.id} onChange={(e) => { const n = OPS.find((x) => x.id === e.target.value)!; const cs = [...ff.conds]; cs[i] = { prop: n.op === "hasTag" ? "tags" : n.op === "inFolder" ? "folder" : c.prop, op: n.op, neg: n.neg, args: n.noValue ? [] : c.args.length ? c.args : [""] }; set(cs); }} className={cx(inputCls, "max-w-[150px] text-[13px]")}>
              {OPS.map((x) => <option key={x.id} value={x.id}>{x.l}</option>)}
            </select>
            {o.noValue ? <span /> : (canon(c.prop) === "status" && (o.op === "==" || o.op === "!=") ? (
              <select aria-label="Value" value={String(c.args[0] ?? "")} onChange={(e) => { const cs = [...ff.conds]; cs[i] = { ...c, args: [e.target.value] }; set(cs); }} className={cx(inputCls, "min-w-0 flex-1 text-[13px]")}>
                <option value="">—</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <div className="min-w-0">
                <input aria-label="Value" defaultValue={String(c.args[0] ?? "")} list={listId} dir="auto" placeholder={isDateProp(c.prop) ? "2026-11-13 or today()" : "value"}
                  onBlur={(e) => { const raw = e.target.value.trim(); if (raw === String(c.args[0] ?? "")) return; const cs = [...ff.conds]; cs[i] = { ...c, args: [/^-?\d+(\.\d+)?$/.test(raw) && !isDateProp(c.prop) ? Number(raw) : raw] }; set(cs); }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className={cx(inputCls, "min-w-0 flex-1 text-[13px]")} />
                <datalist id={listId}>{(o.op === "hasTag" ? values("tags") : vals).map((x) => <option key={x} value={x} />)}</datalist>
              </div>
            ))}
            <button aria-label="Remove filter" onClick={() => set(ff.conds.filter((_, j) => j !== i))} className="flex size-9 shrink-0 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-bad"><X size={14} /></button>
          </div>
        );
      })}
      {ff.raw.map((r, i) => <div key={"r" + i} className="rounded-[6px] bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] text-muted" title="Edit in the YAML source">{typeof r === "string" ? r : JSON.stringify(r)}</div>)}
      <Button size="sm" variant="ghost" onClick={() => set([...ff.conds, { prop: "status", op: "==", neg: false, args: ["learning"] }])}><Plus size={13} />Add filter</Button>
    </div>
  );
}

function SortEditor({ sort, props, onChange }: { sort: SortRule[]; props: string[]; onChange: (s: SortRule[]) => void }) {
  return (
    <div className="space-y-2">
      {!sort.length && <div className="text-[12.5px] text-muted">Default: last updated first. Tip: click a table column header to sort by it.</div>}
      {sort.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <PropSelect value={s.property} props={props} onChange={(p) => { const n = [...sort]; n[i] = { ...s, property: p }; onChange(n); }} />
          <DirButton dir={s.direction} onClick={() => { const n = [...sort]; n[i] = { ...s, direction: s.direction === "ASC" ? "DESC" : "ASC" }; onChange(n); }} />
          <button aria-label="Remove sort" onClick={() => onChange(sort.filter((_, j) => j !== i))} className="flex size-9 shrink-0 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-bad"><X size={14} /></button>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => onChange([...sort, { property: "file.name", direction: "ASC" }])}><Plus size={13} />Add sort</Button>
    </div>
  );
}

function PropsEditor({ order, props, onChange }: { order: string[]; props: string[]; onChange: (o: string[]) => void }) {
  const on = order.map(canon);
  const rest = props.filter((p) => !on.includes(canon(p)));
  const move = (i: number, d: number) => { const n = [...order]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {order.map((p, i) => (
          <div key={p} className="flex items-center gap-2 rounded-[8px] px-2 py-1.5 hover:bg-surface-2">
            <input type="checkbox" checked disabled={canon(p) === "title"} onChange={() => onChange(order.filter((x) => x !== p))} className="accent-[var(--accent)]" aria-label={`Hide ${label(p)}`} />
            <span className="flex-1 text-[13px]">{label(p)}</span>
            <button aria-label="Move up" onClick={() => move(i, -1)} className="text-muted hover:text-ink"><ArrowUp size={14} /></button>
            <button aria-label="Move down" onClick={() => move(i, 1)} className="text-muted hover:text-ink"><ArrowDown size={14} /></button>
          </div>
        ))}
      </div>
      {rest.length > 0 && <div className="border-t border-line pt-2 text-[11.5px] font-medium uppercase tracking-wide text-muted">Hidden</div>}
      <div className="space-y-1">
        {rest.map((p) => (
          <label key={p} className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 hover:bg-surface-2">
            <input type="checkbox" checked={false} onChange={() => onChange([...order, yamlName(canon(p))])} className="accent-[var(--accent)]" />
            <span className="flex-1 text-[13px]">{label(p)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function ViewSettings({ view, props, canDelete, edit, onDuplicate, onDelete, onSource, onDownload }: { view: BaseViewDef; props: string[]; canDelete: boolean; edit: (fn: (c: BaseConfig, v: BaseViewDef) => void) => void; onDuplicate: () => void; onDelete: () => void; onSource: () => void; onDownload: () => void }) {
  return (
    <div className="space-y-4">
      <label className="block space-y-1">
        <span className="text-[12px] font-medium text-muted">Name</span>
        <input defaultValue={view.name} dir="auto" className={inputCls} onBlur={(e) => e.target.value.trim() && e.target.value !== view.name && edit((_c, w) => { w.name = e.target.value.trim(); })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      </label>
      <div className="space-y-1">
        <span className="text-[12px] font-medium text-muted">Layout</span>
        <div className="grid grid-cols-3 gap-1.5 md:grid-cols-5">
          {(["table", "board", "cards", "list", "calendar"] as ViewType[]).map((t) => (
            <button key={t} onClick={() => edit((_c, w) => { w.type = t; if (t === "board" && !w.groupBy) w.groupBy = { property: "status", direction: "ASC" }; })}
              className={cx("flex flex-col items-center gap-1 rounded-[10px] border p-2 text-[12px]", view.type === t ? "border-accent text-ink" : "border-line text-muted hover:text-ink")}>{VIEW_ICON[t]}{VIEW_LABEL[t]}</button>
          ))}
        </div>
      </div>
      {view.type === "calendar" && (
        <label className="block space-y-1">
          <span className="text-[12px] font-medium text-muted">Date property</span>
          <PropSelect value={view.date ?? "file.ctime"} props={props.filter((p) => isDateProp(p) || !BUILTIN.includes(p as never))} onChange={(p) => edit((_c, w) => { w.date = p; })} />
        </label>
      )}
      <label className="block space-y-1">
        <span className="text-[12px] font-medium text-muted">Limit (empty = all)</span>
        <input type="number" min={1} defaultValue={view.limit ?? ""} className={inputCls} onBlur={(e) => { const n = Number(e.target.value); if ((n || undefined) !== view.limit) edit((_c, w) => { w.limit = n > 0 ? n : undefined; }); }} />
      </label>
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <Button size="sm" onClick={onDuplicate}><Plus size={13} />Duplicate view</Button>
        <Button size="sm" onClick={onSource}><FileCode2 size={13} />Edit YAML</Button>
        <Button size="sm" onClick={onDownload}><Download size={13} />Download .base</Button>
        {canDelete && <Button size="sm" variant="danger" onClick={onDelete}><Trash2 size={13} />Delete view</Button>}
      </div>
    </div>
  );
}
