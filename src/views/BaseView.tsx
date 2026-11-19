// Bases: database views of notes (table / board / gallery / list / calendar). Definition = YAML in the note body
// (lib/base.ts). Every change made here is written back to that YAML or to the listed notes through updateNote.
// Layout follows design/handoffs/2026-11-19-round-4/BaseDesk.dc.html (R4-18A..J, T).
import { EmptyState } from "../components/EmptyState";
import { ReaderBack } from "../components/reader-bar";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Note, Status } from "../../shared/types";
import { NOTE_TYPES, STATUSES } from "../../shared/types";
import { createNote, updateNote } from "../lib/actions";
import {
  BASE_TEMPLATES, BUILTIN, NONE, canon, copiesOf, editable, filterCount, filterRows, fmtDate, getValue, groupRows, impliedProps, isDateProp, isStatus, isType, knownProps, label,
  moveMessage, newView, parseBase, propsOf, rowsToFilter, runView, serializeBase, show, swapValue, templateBody, writeBase, yamlName, ymd, asTime,
  type BaseConfig, type BaseTemplate, type BaseViewDef, type Cond, type Ctx, type FilterRow, type FilterRows, type Group as RowGroup, type Row, type SortRule, type Val, type ViewType,
} from "../lib/base";
import { presetVar, SERIES_ORDER } from "../lib/dashboard";
import { db } from "../lib/db";
import { splitFrontMatter, setFrontMatter, inlineTags } from "../lib/parse";
import { noteDerived, openNote, setUI, useVault } from "../lib/store";
import { Glyph } from "../components/Glyph";
import { cx, Sheet } from "../components/ui";

const useWide = () => { const [w, setW] = useState(() => innerWidth >= 900); useEffect(() => { const f = () => setW(innerWidth >= 900); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return w; };
const VIEW_GLYPH: Record<ViewType, string> = { table: "v-table", board: "v-board", cards: "v-gallery", list: "v-list", calendar: "v-calendar" };
const VIEW_LABEL: Record<ViewType, string> = { table: "Table", board: "Board", cards: "Gallery", list: "List", calendar: "Calendar" };
const PAGE = 200;
const propsFor = (n: Note) => noteDerived("baseProps", n, propsOf);
const isMd = (n: Note) => !["canvas", "whiteboard", "diagram"].includes(n.type);
const DEFAULT_ORDER = ["file.name", "status", "file.tags", "file.mtime"];
type Spaces = { id: string; name: string; color: string | null }[];

// ------------------------------------------------------------------ status + colour helpers (design: glyph pills, course bars)
export const STATUS_META: Record<Status, { g: string; c: string; l: string }> = {
  todo: { g: "s-todo", c: "var(--muted)", l: "Todo" }, learning: { g: "s-learning", c: "var(--info)", l: "Learning" },
  review: { g: "s-revise", c: "var(--warning)", l: "To revise" }, mastered: { g: "s-mastered", c: "var(--success)", l: "Mastered" },
};
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
/** Course / space colour: the space's own canvas preset, else a stable preset from the name. */
function useColorOf(spaces: Spaces) {
  return useMemo(() => {
    const byName = new Map(spaces.map((s) => [s.name, s.color]));
    return (v: string) => { const c = byName.get(v); return c && /^[1-6]$/.test(c) ? presetVar(c) : c && /^#/.test(c) ? c : presetVar(SERIES_ORDER[hash(v) % 6]); };
  }, [spaces]);
}
const isCourse = (p: string) => ["space", "course", "courses"].includes(canon(p));
const fmtShort = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// ------------------------------------------------------------------ writes to listed notes
async function writeValue(n: Note, prop: string, value: string | null, spaces: Spaces) {
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
/** The current value of a property as the text writeValue takes (for Undo). */
function rawOf(r: Row, prop: string, ctx: Ctx): string | null {
  const k = canon(prop);
  if (k === "status") return r.n.status;
  if (k === "tags") return r.n.tags.join(", ");
  if (k === "space") return r.n.spaceId;
  const v = getValue(r.n, prop, ctx, r.props);
  return v === null ? null : Array.isArray(v) ? `[${v.join(", ")}]` : String(v);
}

interface Moved { text: string; undo: () => void; t: number }
/** Move a note from one group to another (board columns, calendar days). Multi-value properties swap the one value. */
async function moveTo(r: Row, prop: string, from: string, to: string, ctx: Ctx, spaces: Spaces, say: (m: Moved | null) => void) {
  if (from === to) return;
  const k = canon(prop);
  if (!editable(k)) { say({ text: `${label(k)} can't be changed by dragging`, undo: () => {}, t: Date.now() }); return; }
  const before = rawOf(r, prop, ctx);
  const undo = () => { void writeValue(r.n, prop, before, spaces); say(null); };
  const cur = getValue(r.n, prop, ctx, r.props);
  if (Array.isArray(cur)) {
    // one copy of a multi-value note: only the dragged value changes ("Moved from #cv to #nlp, still in #llm")
    const vals = cur.map(String);
    const next = swapValue(vals, from, to);
    await writeValue(r.n, prop, k === "tags" ? next.join(", ") : next.length ? `[${next.join(", ")}]` : null, spaces);
    say({ text: moveMessage(prop, from, to, vals), undo, t: Date.now() });
    return;
  }
  await writeValue(r.n, prop, to === NONE ? null : to, spaces);
  const f = (x: string) => (x === NONE ? `no ${label(k).toLowerCase()}` : k === "status" && isStatus(x) ? STATUS_META[x].l : /^\d{4}-\d{2}-\d{2}$/.test(x) ? fmtShort(asTime(x)!) : x);
  say({ text: `Moved from ${f(from)} to ${f(to)}`, undo, t: Date.now() });
}

// ------------------------------------------------------------------ pointer drag (mouse: move 5px; touch: long-press)
interface DragState { id: string; from: string; title: string; x: number; y: number; w: number; dx: number; dy: number; over: string | null; meta?: ReactNode }
function useDragCards(onDrop: (id: string, from: string, to: string) => void, scroller: React.RefObject<HTMLElement | null>) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragged = useRef(false);
  const start = (e: React.PointerEvent, id: string, from: string, title: string, meta?: ReactNode) => {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY, touch = e.pointerType !== "mouse";
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    let active = false, timer = 0, raf = 0, last = { x: sx, y: sy };
    const overAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest("[data-drop]") as HTMLElement | null)?.dataset.drop ?? null;
    const begin = () => { active = true; dragged.current = true; navigator.vibrate?.(8); setDrag({ id, from, title, meta, x: last.x, y: last.y, w: box.width, dx: sx - box.left, dy: sy - box.top, over: overAt(last.x, last.y) }); };
    const scroll = () => {
      const el = scroller.current;
      if (active && el) {
        const r = el.getBoundingClientRect(), edge = 48;
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
  const ghost = drag && (
    <div className="base-ghost" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: Math.min(drag.w, 320) }} dir="auto">
      <span className="font-medium">{drag.title || "Untitled"}</span>{drag.meta}
    </div>
  );
  return { drag, start, ghost, wasDrag: () => dragged.current };
}

// ------------------------------------------------------------------ popovers (desktop: anchored card; phone: sheet)
type PopKind = "filter" | "sort" | "group" | "props" | "view" | "add" | "search";
function Pop({ at, width, onClose, children, label: lbl }: { at: { x: number; y: number }; width: number; onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => { const t = e.target as HTMLElement; if (ref.current && !ref.current.contains(t) && !t.closest("[data-pop-anchor]")) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const id = setTimeout(() => addEventListener("pointerdown", down), 0);
    addEventListener("keydown", key);
    return () => { clearTimeout(id); removeEventListener("pointerdown", down); removeEventListener("keydown", key); };
  }, [onClose]);
  return <div ref={ref} role="dialog" aria-label={lbl} className="base-pop" style={{ left: at.x, top: at.y, width }}>{children}</div>;
}
const ctl = "h-[30px] min-w-0 rounded-[7px] border border-line bg-bg px-[10px] text-[13px] text-ink outline-none focus:border-accent";

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
  const [pop, setPop] = useState<{ kind: PopKind; x: number; y: number } | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [moved, setMoved] = useState<Moved | null>(null);
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => setShown(PAGE), [idx, search]);
  useEffect(() => { if (!moved) return; const t = setTimeout(() => setMoved((m) => (m === moved ? null : m)), 7000); return () => clearTimeout(t); }, [moved]);
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { tabsRef.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [idx]);

  const cards = useLiveQuery(() => db.cards.toArray(), []);
  const cardCount = useMemo(() => { const m = new Map<string, number>(); for (const c of cards ?? []) if (!c.deleted) m.set(c.noteId, (m.get(c.noteId) ?? 0) + 1); return m; }, [cards]);
  const ctx: Ctx = useMemo(() => ({
    spaceName: (id) => v.spaceMap.get(id)?.name ?? (id === "inbox" ? "Inbox" : id),
    folderPath: (id) => {
      const names: string[] = []; const seen = new Set<string>();
      for (let f = id ? v.folderMap.get(id) : undefined; f && !seen.has(f.id); f = f.parentId ? v.folderMap.get(f.parentId) : undefined) { seen.add(f.id); names.unshift(f.name); }
      return names.join("/");
    },
    cardCount: (id) => cardCount.get(id) ?? 0,
  }), [v, cardCount]);
  const spaces: Spaces = useMemo(() => v.spaces.map((s) => ({ id: s.id, name: s.name, color: s.color })), [v.spaces]);
  const colorOf = useColorOf(spaces);
  const { rows, total } = useMemo(() => runView(v.notes, cfg, view, ctx, propsFor, { search, self: note.id }), [v.notes, cfg, view, ctx, search, note.id]);
  const allProps = useMemo(() => [...BUILTIN, "cards", ...knownProps(v.notes.slice(0, 4000).map((n) => ({ props: propsFor(n) })))], [v.notes]);

  /** Change the definition: clone, mutate, write the YAML back into the body. */
  const edit = (fn: (c: BaseConfig, view: BaseViewDef) => void) => {
    const c = structuredClone(cfg) as BaseConfig;
    fn(c, c.views[idx]);
    void updateNote(note.id, { body: writeBase(note.body, c) });
  };
  const order = view.order?.length ? view.order : DEFAULT_ORDER;
  const cols = order.filter((p) => canon(p) !== "title");
  const groupBy = view.type === "board" ? view.groupBy ?? { property: "status", direction: "ASC" as const } : view.groupBy;
  const implied = impliedProps(cfg, view);
  const say = (m: Moved | null) => setMoved(m);

  const newNote = async (extra: Record<string, string> = {}) => {
    const imp = { ...implied, ...extra };
    const fm: Record<string, string> = {};
    let type: Note["type"] | undefined, status: Note["status"] | undefined, tags: string[] = [], spaceId = note.spaceId;
    for (const [k, val] of Object.entries(imp)) {
      if (k === "type" && isType(val)) type = val;
      else if (k === "status") status = isStatus(val) ? val : null;
      else if (k === "tags") tags = val.split(",").map((t) => t.trim()).filter(Boolean);
      else if (k === "space" || k === "course") spaceId = spaces.find((s) => s.name === val)?.id ?? spaceId;
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

  const nFilter = filterCount(view.filters) + filterCount(cfg.filters);
  const visible = rows.slice(0, shown);
  const groups = useMemo(() => (groupBy ? groupRows(rows, groupBy, ctx, { multi: view.groupMulti, allStatuses: view.type === "board" }) : null), [rows, groupBy, ctx, view.groupMulti, view.type]);
  const copies = useMemo(() => (groups ? copiesOf(groups) : new Map<string, string[]>()), [groups]);
  const more = rows.length > shown && <div className="flex justify-center py-3"><button className="base-tool" onClick={() => setShown((s) => s + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more</button></div>;
  const count = copies.size ? `${rows.length} notes · ${copies.size} shown in several groups` : `${total} note${total === 1 ? "" : "s"}${nFilter || search ? " · filtered" : ""}`;

  // popover anchoring: below the clicked control, inside the view
  const open = (kind: PopKind, el?: HTMLElement | null) => {
    if (pop?.kind === kind) { setPop(null); return; }
    const root = rootRef.current?.getBoundingClientRect();
    const r = el?.getBoundingClientRect();
    const W = kind === "filter" ? 520 : kind === "view" || kind === "props" ? 300 : 340;
    const x = root && r ? Math.max(8, Math.min(r.left - root.left, root.width - W - 8)) : 32;
    const y = root && r ? r.bottom - root.top + 6 : 150;
    setPop({ kind, x, y });
  };
  const close = useRef(() => setPop(null)).current;

  const newType = implied.type && isType(implied.type) ? implied.type : null;
  const tpl = useTemplateOffer(note, found);
  const tools: { k: PopKind; l: string; n?: number }[] = [
    { k: "filter", l: "Filter", n: nFilter },
    { k: "sort", l: "Sort", n: view.sort?.length ?? 0 },
    ...(view.type !== "calendar" ? [{ k: "group" as const, l: groupBy ? `Group: ${label(groupBy.property).toLowerCase()}` : "Group" }] : []),
    ...(wide ? [{ k: "props" as const, l: "Properties", n: order.length }] : []),
  ];

  const popBody = (kind: PopKind) => {
    switch (kind) {
      case "filter": return <FilterPanel cfg={cfg} view={view} props={allProps} notes={v.notes} ctx={ctx} edit={edit} />;
      case "sort": return <SortEditor sort={view.sort ?? []} props={allProps} onChange={(s) => edit((_c, w) => { w.sort = s.length ? s : undefined; })} />;
      case "group": return <GroupEditor view={view} groupBy={groupBy} props={allProps} edit={edit} />;
      case "props": return <PropsEditor order={order} props={allProps} onChange={(o) => edit((_c, w) => { w.order = o; })} />;
      case "add": return (
        <div className="flex flex-col gap-0.5">
          <span className="px-1 pb-1 font-semibold">Add a view</span>
          {(["table", "board", "cards", "list", "calendar"] as ViewType[]).map((t) => (
            <button key={t} className="base-menu-item" onClick={() => { setPop(null); edit((c) => { c.views.push({ ...newView(t), filters: view.filters }); }); pick(cfg.views.length); }}>
              <Glyph name={VIEW_GLYPH[t]} size={15} />{VIEW_LABEL[t]}
            </button>
          ))}
        </div>
      );
      case "view": return (
        <ViewSettings key={idx} view={view} props={allProps} canDelete={cfg.views.length > 1} edit={edit} phone={!wide} onProps={() => setPop({ kind: "props", x: 16, y: 120 })} onSearch={() => setPop({ kind: "search", x: 0, y: 0 })} onNew={() => { setPop(null); void newNote(); }} newLabel={`New ${newType ?? "note"}`}
          onDuplicate={() => { setPop(null); edit((c, w) => { c.views.splice(idx + 1, 0, { ...structuredClone(w), name: `${w.name} copy` }); }); pick(idx + 1); }}
          onDelete={() => { setPop(null); edit((c) => { c.views.splice(idx, 1); }); pick(Math.max(0, idx - 1)); }}
          onSource={() => { setPop(null); setUI({ mode: "edit" }); }} onDownload={download} />
      );
      case "search": return null;
    }
  };
  const POP_TITLE: Record<PopKind, string> = { filter: "Filter", sort: "Sort", group: view.type === "board" ? "Board columns" : "Group", props: view.type === "table" ? "Columns" : "Properties", view: "View settings", add: "Add a view", search: "Search" };

  return (
    <div ref={rootRef} className="base relative flex h-full min-h-0 flex-col">
      <div className={cx("flex shrink-0 flex-col gap-3", wide ? "px-8 pt-5" : "px-4 pt-3")}>
        <div className="flex items-center gap-2.5">
          <ReaderBack phone={!wide} />
          <Glyph name="base" size={20} />
          <span dir="auto" className={cx("min-w-0 flex-1 truncate font-[650] tracking-[-.02em]", wide ? "text-[20px]" : "text-[17px]")}>{note.title || "Untitled base"}</span>
          {wide && <button className="base-primary" onClick={() => newNote()}>New {newType ?? "note"}</button>}
        </div>
        {/* views */}
        <div ref={tabsRef} className="flex items-end gap-3.5 overflow-x-auto whitespace-nowrap border-b border-line" style={{ scrollbarWidth: "none" }}>
          {cfg.views.map((w, i) => (
            <button key={i} data-active={i === idx || undefined} data-pop-anchor={i === idx || undefined} onClick={(e) => (i === idx ? open("view", e.currentTarget) : pick(i))} title={i === idx ? "View settings" : w.name}
              className={cx("base-vtab", i === idx && "is-on")}>
              <Glyph name={VIEW_GLYPH[w.type]} size={15} /><span dir="auto" className="max-w-[160px] truncate">{w.name}</span>
            </button>
          ))}
          <button aria-label="Add view" title="Add view" data-pop-anchor onClick={(e) => open("add", e.currentTarget)} className="pb-2.5 text-muted hover:text-ink">+</button>
        </div>
        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-1.5">
          {tools.map((t) => (
            <button key={t.k} data-pop-anchor onClick={(e) => open(t.k, e.currentTarget)} className={cx("base-tool", pop?.kind === t.k && "is-on")}>
              {t.l}{t.n ? <span className="base-badge">{t.n}</span> : null}
            </button>
          ))}
          {wide && <button data-pop-anchor aria-label="View settings" onClick={(e) => open("view", e.currentTarget)} className={cx("base-tool", pop?.kind === "view" && "is-on")}>⋯</button>}
          {pop?.kind === "search" || search ? (
            <label className="base-tool w-[180px] focus-within:border-accent">
              <Search size={13} className="shrink-0 text-muted" />
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => !search && setPop(null)} onKeyDown={(e) => e.key === "Escape" && (setSearch(""), setPop(null))} placeholder="Search" dir="auto" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted" />
              {search && <button aria-label="Clear search" onClick={() => setSearch("")}><X size={12} /></button>}
            </label>
          ) : wide && <button aria-label="Search" title="Search" onClick={() => setPop({ kind: "search", x: 0, y: 0 })} className="base-tool px-2 text-muted"><Search size={13} /></button>}
          <span className="flex-1" />
          {view.type === "calendar" && (
            <span className="flex items-center gap-1 text-[12.5px]">
              <span className="me-1 font-semibold">{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
              <button aria-label="Previous month" className="base-icon rtl:rotate-180" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={15} /></button>
              <button className="base-icon w-auto px-1.5 text-[12px]" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</button>
              <button aria-label="Next month" className="base-icon rtl:rotate-180" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={15} /></button>
            </span>
          )}
          <span className="text-[12px] text-muted" title={view.limit && total > rows.length ? `Limited to ${view.limit}` : undefined}>{count}</span>
        </div>
      </div>

      {(error || !found) && !tpl.show && (
        <div className={cx("shrink-0 pt-2 text-[12px]", wide ? "px-8" : "px-4", error ? "text-bad" : "text-muted")} dir="auto">
          {error ? `Couldn't read the base definition: ${error}` : "No ```base block yet: showing every note. Change a view here or use Edit to write the YAML."}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {tpl.show ? <TemplatePicker note={note} onCancel={tpl.dismiss} /> : view.type === "table" ? (
          <TableView rows={visible} cols={cols} view={view} ctx={ctx} spaces={spaces} colorOf={colorOf} groups={groups} copies={copies} wide={wide} more={more} edit={edit} />
        ) : view.type === "board" ? (
          <BoardView groups={groups!} copies={copies} cols={cols} groupBy={groupBy!} ctx={ctx} spaces={spaces} colorOf={colorOf} wide={wide} say={say} onNew={(k) => newNote(k === NONE ? {} : { [canon(groupBy!.property)]: k })} />
        ) : view.type === "calendar" ? (
          <CalendarView rows={rows} view={view} cols={cols} ctx={ctx} spaces={spaces} colorOf={colorOf} wide={wide} month={month} say={say} />
        ) : view.type === "list" ? (
          <ListView rows={visible} groups={groups} cols={cols} view={view} ctx={ctx} colorOf={colorOf} wide={wide} more={more} />
        ) : (
          <GalleryView rows={visible} groups={groups} by={groupBy} cols={cols} ctx={ctx} colorOf={colorOf} wide={wide} more={more} />
        )}
        {/* Lumen 21 empty state: one glyph, one line, one action (clears the search, else this view's filters, else the base-wide ones) */}
        {!rows.length && !tpl.show && <EmptyState glyph="base" text={search ? `No notes match “${search}”.` : "No notes match this view."}
          action={search || nFilter ? { label: search ? "Clear search" : "Clear filters", onClick: () => { if (search) { setSearch(""); return; } edit((c, w) => { if (filterCount(w.filters)) w.filters = undefined; else c.filters = undefined; }); } } : undefined} />}
      </div>

      {pop && pop.kind !== "search" && (wide ? (
        <Pop at={pop} width={pop.kind === "filter" ? 520 : pop.kind === "view" || pop.kind === "props" ? 300 : 340} onClose={close} label={POP_TITLE[pop.kind]}>{popBody(pop.kind)}</Pop>
      ) : (
        <Sheet open onClose={close} title={POP_TITLE[pop.kind]}>{popBody(pop.kind)}</Sheet>
      ))}

      {moved && (
        <div role="status" className="base-toast">
          <span dir="auto">{moved.text.split(/(#[^\s,]+)/).map((s, i) => (i % 2 ? <b key={i}>{s}</b> : s))}</span>
          {moved.text.startsWith("Moved") || moved.text.startsWith("Removed") ? <button onClick={moved.undo}>Undo</button> : null}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ New base · template picker (R4-18T)
/** Offer the template picker on a base that has no YAML yet, or is still the untouched default template. */
function useTemplateOffer(note: Note, found: boolean) {
  const key = `lumen.base.tpl.${note.id}`;
  const [gone, setGone] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  // the default "Base (database view)" template, created in the last 10 minutes and never changed from the toolbar
  const fresh = note.body.includes("Notes shown as a database. Change views with the toolbar") && note.body.includes("name: All notes") && !/^filters:/m.test(note.body) && Date.now() - note.createdAt < 10 * 60_000;
  return { show: !gone && (!found && !note.body.trim() || fresh), dismiss: () => { setGone(true); try { localStorage.setItem(key, "1"); } catch { /* ignore */ } } };
}
export function TemplatePicker({ note, onCancel }: { note: Note; onCancel: () => void }) {
  const [sel, setSel] = useState<BaseTemplate>(BASE_TEMPLATES[0]);
  const create = () => {
    const title = !note.title || /^new base$/i.test(note.title) || note.title === "Untitled" ? sel.title : note.title;
    void updateNote(note.id, { title, type: sel.type, body: templateBody(sel) });
    onCancel();
  };
  return (
    <div className="flex justify-center overflow-y-auto px-4 py-6">
      <div className="base-tpl">
        <div className="px-5 pb-1.5 pt-[18px] text-[17px] font-[650]">New from template</div>
        <div className="grid grid-cols-1 gap-2.5 px-5 py-2.5 sm:grid-cols-3">
          {BASE_TEMPLATES.map((t) => (
            <button key={t.id} aria-pressed={sel.id === t.id} onClick={() => setSel(t)} onDoubleClick={create} className={cx("base-tpl-card", sel.id === t.id && "is-on")}>
              <Glyph name={t.glyph} size={18} /><span className="font-semibold">{t.name}</span><span className="text-[12px] leading-[17px] text-muted">{t.desc}</span>
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3.5">
          <button className="h-[34px] px-3.5 text-muted hover:text-ink" onClick={onCancel}>Cancel</button>
          <button className="base-primary h-[34px] rounded-[10px] px-4" onClick={create}>{sel.type === "dashboard" ? "Create dashboard" : "Create base"}</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ cells
function StatusPill({ s, ring }: { s: string | null; ring?: boolean }) {
  if (!s) return <span className="text-muted">—</span>;
  const m = isStatus(s) ? STATUS_META[s] : { g: "s-todo", c: "var(--muted)", l: s };
  return (
    <span className="base-pill" style={{ color: m.c, background: `color-mix(in srgb, ${m.c} 14%, transparent)`, boxShadow: ring ? "0 0 0 2px var(--accent)" : undefined }}>
      <Glyph name={m.g} size={12} />{m.l}
    </span>
  );
}
const Bar = ({ c, h = 14 }: { c: string; h?: number }) => <span className="shrink-0 rounded-[2px]" style={{ width: 4, height: h, background: c }} />;
function ValueView({ v, p, colorOf }: { v: Val; p: string; colorOf: (s: string) => string }) {
  const k = canon(p);
  if (k === "status") return <StatusPill s={v as string | null} />;
  if (v === null || v === "" || (Array.isArray(v) && !v.length)) return <span className="text-muted/60">—</span>;
  if (isCourse(p)) {
    const vs = Array.isArray(v) ? v : [String(v)];
    return <span className="inline-flex min-w-0 items-center gap-1.5">{vs.slice(0, 2).map((x) => <span key={x} className="inline-flex min-w-0 items-center gap-1.5"><Bar c={colorOf(x)} /><span dir="auto" className="truncate">{x}</span></span>)}</span>;
  }
  if (Array.isArray(v)) return <span className="inline-flex max-w-full gap-1 overflow-hidden">{v.map((t) => <span key={t} dir="auto" className="base-chip">{k === "tags" ? "#" : ""}{t}</span>)}</span>;
  if (typeof v === "string" && /^https?:\/\//.test(v)) return <a href={v} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-link hover:underline">{v.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}</a>;
  const t = isDateProp(p, v) ? asTime(v as string | number) : null;
  return <span dir="auto" className={cx(t !== null || typeof v === "number" ? "text-muted" : "")}>{t !== null ? fmtShort(t) : show(v, p)}</span>;
}

/** Status menu (R4-18B): glyph rows, check on the current one. */
function StatusMenu({ cur, at, onPick, onClose }: { cur: Status | null; at: DOMRect; onPick: (s: Status | null) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const id = setTimeout(() => addEventListener("pointerdown", down), 0); addEventListener("keydown", key);
    ref.current?.querySelector<HTMLButtonElement>("[aria-checked=true]")?.focus();
    return () => { clearTimeout(id); removeEventListener("pointerdown", down); removeEventListener("keydown", key); };
  }, [onClose]);
  const opts: (Status | null)[] = [...STATUSES, null];
  const top = at.bottom + 236 > innerHeight ? Math.max(8, at.top - 236) : at.bottom + 6;
  return createPortal(
    <div ref={ref} role="menu" className="base-menu" style={{ position: "fixed", left: Math.min(at.left - 2, innerWidth - 238), top }} onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return; e.preventDefault(); const bs = [...ref.current!.querySelectorAll<HTMLButtonElement>("button")]; const i = bs.indexOf(document.activeElement as HTMLButtonElement); bs[(i + (e.key === "ArrowDown" ? 1 : bs.length - 1)) % bs.length]?.focus(); }}>
      {opts.map((s) => {
        const m = s ? STATUS_META[s] : null;
        return (
          <button key={s ?? "none"} role="menuitemradio" aria-checked={cur === s} onClick={() => { onPick(s); onClose(); }} className={cx("base-menu-item", cur === s && "is-on")}>
            {m ? <Glyph name={m.g} size={14} color={m.c} /> : <span className="w-3.5" />}
            <span className={cx("flex-1", !m && "text-muted")}>{m ? m.l : "No status"}</span>
            {cur === s && <span className="text-accent">✓</span>}
          </button>
        );
      })}
    </div>, document.body,
  );
}

/** Tag chip input: Enter / comma adds, Backspace on empty removes the last chip. */
function ChipInput({ value, onCommit, prefix = "" }: { value: string[]; onCommit: (v: string[]) => void; prefix?: string }) {
  const [vals, setVals] = useState(value);
  const [draft, setDraft] = useState("");
  const done = useRef(false);
  const commit = (vs = vals) => { if (done.current) return; done.current = true; const d = draft.trim().replace(/^#/, ""); onCommit(d ? [...vs, d] : vs); };
  return (
    <div className="base-chips" onClick={(e) => { e.stopPropagation(); (e.currentTarget.querySelector("input") as HTMLInputElement)?.focus(); }}>
      {vals.map((t) => <span key={t} className="base-chip">{prefix}{t}<button aria-label={`Remove ${t}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setVals(vals.filter((x) => x !== t))}>×</button></span>)}
      <input autoFocus value={draft} dir="auto" aria-label="Add value" onChange={(e) => { const s = e.target.value; if (s.endsWith(",")) { const d = s.slice(0, -1).trim().replace(/^#/, ""); if (d && !vals.includes(d)) setVals([...vals, d]); setDraft(""); } else setDraft(s); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const d = draft.trim().replace(/^#/, ""); if (d) { if (!vals.includes(d)) setVals([...vals, d]); setDraft(""); } else commit(); } else if (e.key === "Backspace" && !draft && vals.length) setVals(vals.slice(0, -1)); else if (e.key === "Escape") { done.current = true; onCommit(value); } }}
        onBlur={() => commit()} className="min-w-[60px] flex-1 bg-transparent outline-none" />
    </div>
  );
}

/** Inline editor for one cell (R4-18B): status = glyph menu, type/space = select, dates = picker, tags = chip input,
 *  other properties = text. Title, created, updated, folder and cards are read-only. */
function CellEdit({ r, p, ctx, spaces, colorOf }: { r: Row; p: string; ctx: Ctx; spaces: Spaces; colorOf: (s: string) => string }) {
  const k = canon(p);
  const v = getValue(r.n, p, ctx, r.props);
  const [editing, setEditing] = useState(false);
  const [at, setAt] = useState<DOMRect | null>(null);
  const sel = "h-7 w-full cursor-pointer appearance-none rounded-[6px] bg-transparent px-1 text-[13px] outline-none hover:bg-surface-2 focus:bg-surface-2";
  if (k === "status") return (
    <div className="relative">
      <button className="flex h-7 items-center rounded-[6px] px-0.5" aria-haspopup="menu" aria-expanded={editing} aria-label="Status" onClick={(e) => { e.stopPropagation(); setAt(e.currentTarget.getBoundingClientRect()); setEditing(!editing); }}><StatusPill s={r.n.status} ring={editing} /></button>
      {editing && at && <StatusMenu cur={r.n.status} at={at} onPick={(s) => writeValue(r.n, "status", s, spaces)} onClose={() => setEditing(false)} />}
    </div>
  );
  if (k === "type") return <select aria-label="Type" value={r.n.type} onChange={(e) => writeValue(r.n, "type", e.target.value, spaces)} className={sel}>{NOTE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>;
  if (k === "space") return (
    <div className="relative flex items-center gap-1.5 ps-1"><Bar c={colorOf(ctx.spaceName(r.n.spaceId))} />
      <select aria-label="Space" value={r.n.spaceId} onChange={(e) => writeValue(r.n, "space", e.target.value, spaces)} className={sel} dir="auto">{spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}{!spaces.some((s) => s.id === r.n.spaceId) && <option value={r.n.spaceId}>{ctx.spaceName(r.n.spaceId)}</option>}</select>
    </div>
  );
  if (!editable(k)) return <ValueView v={v} p={p} colorOf={colorOf} />;
  const text = Array.isArray(v) ? v.join(", ") : v === null ? "" : String(v);
  const date = isDateProp(k, v) && (text === "" || /^\d{4}-\d{2}-\d{2}$/.test(text));
  if (!editing) return <button className="flex min-h-7 w-full items-center truncate rounded-[6px] px-1 text-start hover:bg-surface-2" onClick={(e) => { e.stopPropagation(); setEditing(true); }}><ValueView v={v} p={p} colorOf={colorOf} /></button>;
  if (k === "tags" || Array.isArray(v)) return (
    <ChipInput value={Array.isArray(v) ? v.map(String) : text ? [text] : []} prefix={k === "tags" ? "#" : ""}
      onCommit={(vs) => { setEditing(false); const next = k === "tags" ? vs.join(", ") : vs.length > 1 ? `[${vs.join(", ")}]` : vs[0] ?? ""; if (next !== (k === "tags" ? text : Array.isArray(v) ? `[${text}]` : text)) void writeValue(r.n, p, next || null, spaces); }} />
  );
  const commit = (val: string) => { setEditing(false); if (val.trim() !== text) void writeValue(r.n, p, val.trim() || null, spaces); };
  return (
    <input autoFocus ref={date ? (el) => { try { el?.showPicker?.(); } catch { /* needs a user gesture */ } } : undefined} type={date ? "date" : "text"} defaultValue={text} dir="auto" aria-label={label(p)}
      onClick={(e) => e.stopPropagation()} onBlur={(e) => commit(e.target.value)} onChange={date ? (e) => { if (e.target.value) commit(e.target.value); } : undefined}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(false); }}
      className="h-7 w-full rounded-[6px] border border-accent bg-bg px-1 text-[13px] text-ink outline-none" />
  );
}

// ------------------------------------------------------------------ table (R4-18A/B/G/I)
function TableView({ rows, cols, view, ctx, spaces, colorOf, groups, copies, wide, more, edit }: { rows: Row[]; cols: string[]; view: BaseViewDef; ctx: Ctx; spaces: Spaces; colorOf: (s: string) => string; groups: RowGroup[] | null; copies: Map<string, string[]>; wide: boolean; more: ReactNode; edit: (fn: (c: BaseConfig, v: BaseViewDef) => void) => void }) {
  const size = (p: string) => view.columnSize?.[p] ?? view.columnSize?.[yamlName(canon(p))] ?? (canon(p) === "title" ? (wide ? 300 : 150) : canon(p) === "tags" ? 150 : canon(p) === "cards" ? 70 : isDateProp(p) ? 110 : wide ? 140 : 110);
  const [live, setLive] = useState<Record<string, number>>({});
  const w = (p: string) => live[p] ?? size(p);
  const all = ["file.name", ...cols];
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
  // grouped tables page through the visible rows only
  const ids = new Set(rows.map((r) => r.n.id));
  const gs: RowGroup[] = groups ? groups.map((g) => ({ ...g, rows: g.rows.filter((r) => ids.has(r.n.id)) })).filter((g) => g.rows.length) : [{ key: "", label: "", rows }];
  const gLabel = new Map(gs.map((g) => [g.key, g.label]));
  const by = view.groupBy;
  const body = (r: Row, gk: string) => {
    const others = (copies.get(r.n.id) ?? []).filter((k) => k !== gk);
    const tag = (k: string) => (by && canon(by.property) === "tags" ? "#" : "") + (gLabel.get(k) ?? k);
    return (
      <tr key={gk + r.n.id} onClick={() => openNote(r.n.id)} className="base-row">
        <td className="base-sticky"><span className="flex items-center gap-2"><Glyph name={r.n.type} size={14} color="var(--muted)" /><span dir="auto" className="truncate font-medium">{r.n.title || "Untitled"}</span>
          {others.length > 0 && <span className="base-also" title={`Also in ${others.map(tag).join(", ")}`}>also in {others.length} group{others.length === 1 ? "" : "s"}</span>}</span></td>
        {cols.map((p) => (
          <td key={p} onClick={editable(p) ? (e) => e.stopPropagation() : undefined} className={cx(canon(p) === "cards" && "text-end")}>
            {editable(p) ? <CellEdit r={r} p={p} ctx={ctx} spaces={spaces} colorOf={colorOf} /> : <span className="block truncate"><ValueView v={getValue(r.n, p, ctx, r.props)} p={p} colorOf={colorOf} /></span>}
          </td>
        ))}
      </tr>
    );
  };
  return (
    <div className={cx("base-scroll h-full overflow-auto", wide ? "px-8 py-3" : "px-4 py-3")}>
      <div className="base-tablebox">
        <table className="base-table" style={{ minWidth: all.reduce((a, p) => a + w(p), 0) }}>
          <colgroup>{all.map((p) => <col key={p} style={{ width: w(p) }} />)}</colgroup>
          <thead>
            <tr>
              {all.map((p, i) => (
                <th key={p} className={cx(i === 0 && "base-sticky", sortOf(p) && "is-sorted", canon(p) === "cards" && "text-end")} onClick={() => clickHead(p)} title={`Sort by ${label(p)}`}>
                  <span className={cx("inline-flex items-center gap-1", canon(p) === "cards" && "justify-end")}><span className="truncate">{label(p)}</span>{sortOf(p) === "ASC" ? <ArrowUp size={12} /> : sortOf(p) === "DESC" ? <ArrowDown size={12} /> : null}</span>
                  <span className="base-resize" onPointerDown={(e) => resize(e, p)} onClick={(e) => e.stopPropagation()} aria-hidden />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gs.map((g) => [
              groups && by && (
                <tr key={"g" + g.key} className="base-group"><td className="base-sticky" colSpan={1}><span className="flex items-center gap-2">{canon(by.property) === "status" && g.key !== NONE ? <StatusPill s={g.key} /> : <span dir="auto" className="font-semibold">{g.label}</span>}<span className="text-muted">{g.rows.length}</span></span></td><td colSpan={cols.length} /></tr>
              ),
              ...g.rows.map((r) => body(r, g.key)),
            ])}
          </tbody>
        </table>
      </div>
      {more}
    </div>
  );
}

// ------------------------------------------------------------------ board (R4-18C/H/J)
function cardMeta(r: Row, cols: string[], ctx: Ctx, colorOf: (s: string) => string) {
  const course = cols.find(isCourse);
  const cv = course ? getValue(r.n, course, ctx, r.props) : null;
  const cs = cv === null ? "" : Array.isArray(cv) ? cv[0] ?? "" : String(cv);
  const rest = cols.filter((p) => p !== course).map((p) => [p, getValue(r.n, p, ctx, r.props)] as const).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length)).slice(0, 2);
  return { cs, color: cs ? colorOf(cs) : "", rest };
}
function BoardView({ groups, copies, cols, groupBy, ctx, spaces, colorOf, wide, say, onNew }: { groups: RowGroup[]; copies: Map<string, string[]>; cols: string[]; groupBy: SortRule; ctx: Ctx; spaces: Spaces; colorOf: (s: string) => string; wide: boolean; say: (m: Moved | null) => void; onNew: (key: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(groups.flatMap((g) => g.rows.map((r) => [r.n.id, r] as const))), [groups]);
  const { drag, start, ghost, wasDrag } = useDragCards((id, from, to) => { const r = byId.get(id); if (r) void moveTo(r, groupBy.property, from, to, ctx, spaces, say); }, scroller);
  const isStatusCol = canon(groupBy.property) === "status";
  const isTags = canon(groupBy.property) === "tags";
  const shownCols = cols.filter((p) => canon(p) !== canon(groupBy.property));
  const name = (k: string) => (isTags && k !== NONE ? "#" : "") + (groups.find((x) => x.key === k)?.label ?? k);
  return (
    <div ref={scroller} className={cx("base-board h-full overflow-auto", drag && "is-dragging", wide ? "px-8 py-3" : "px-4 py-3")}>
      <div className="flex h-full items-stretch gap-3">
        {groups.map((g) => {
          const m = isStatusCol && isStatus(g.key) ? STATUS_META[g.key] : null;
          const over = !!drag && drag.over === g.key && drag.from !== g.key;
          return (
            <section key={g.key} data-drop={g.key} className={cx("base-col", over && "is-over")}>
              <header className="group/h flex items-center gap-1.5 p-1 font-semibold">
                {m ? <Glyph name={m.g} size={15} color={m.c} /> : g.key !== NONE ? <Bar c={colorOf(g.key)} /> : null}
                <span dir="auto" className="truncate">{m ? m.l : name(g.key)}</span>
                <span className="font-normal text-muted">{g.rows.length}</span>
                <span className="flex-1" />
                <button aria-label={`New note in ${g.label}`} title="New note here" onClick={() => onNew(g.key)} className="base-icon opacity-0 group-hover/h:opacity-100 focus:opacity-100 max-md:opacity-100">+</button>
              </header>
              <div className="flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto">
                {g.rows.slice(0, 300).map((r) => {
                  const cp = copies.get(r.n.id);
                  const also = cp?.filter((k) => k !== g.key) ?? [];
                  const meta = cardMeta(r, shownCols, ctx, colorOf);
                  const metaRow = (
                    <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted">
                      {meta.cs && <><Bar c={meta.color} h={12} /><span dir="auto" className="truncate">{meta.cs}</span></>}
                      {meta.rest.map(([p, v]) => <span key={p} className="truncate" title={label(p)}>{Array.isArray(v) ? v.map((x) => (canon(p) === "tags" ? "#" : "") + x).join(" ") : isDateProp(p, v) && asTime(v as string) !== null ? fmtShort(asTime(v as string)!) : String(v)}</span>)}
                      <span className="flex-1" />
                      {also.length > 0 && <span className="base-also-card" title={`Also in ${also.map(name).join(", ")}`}>also in {also.length > 1 ? `${also.length} groups` : name(also[0])}</span>}
                    </div>
                  );
                  return (
                    <article key={r.n.id} onPointerDown={(e) => start(e, r.n.id, g.key, r.n.title, metaRow)} onClick={() => !wasDrag() && openNote(r.n.id)}
                      onKeyDown={(e) => { if (e.key === "Enter") openNote(r.n.id); }} tabIndex={0}
                      className={cx("base-card", drag?.id === r.n.id && drag.from === g.key && "is-ghost")}>
                      <span dir="auto" className="font-medium">{r.n.title || "Untitled"}</span>
                      {metaRow}
                    </article>
                  );
                })}
                {over && <span className="base-slot" aria-hidden />}
                {g.rows.length > 300 && <div className="px-1 text-[12px] text-muted">+{g.rows.length - 300} more</div>}
              </div>
            </section>
          );
        })}
      </div>
      {ghost}
    </div>
  );
}

// ------------------------------------------------------------------ gallery (R4-18D) + list (R4-18E)
const IMG = /!\[[^\]]*\]\((https?:\/\/[^)\s]+|data:image\/[^)\s]+)/;
const COVER = /^(https?:\/\/\S+\.(png|jpe?g|gif|webp|avif|svg))(\?\S*)?$/i;
/** Cover = a cover/image property, else the first image in the note. */
const coverOf = (r: Row) => noteDerived("baseCover", r.n, (n) => Object.entries(r.props).find(([k, val]) => /^(cover|image|banner|thumbnail)$/i.test(k) && COVER.test(val))?.[1] ?? (isMd(n) ? IMG.exec(n.body.slice(0, 20000))?.[1] ?? "" : ""));
function GroupHead({ g, by }: { g: RowGroup; by: SortRule }) {
  const m = canon(by.property) === "status" && isStatus(g.key) ? STATUS_META[g.key] : null;
  return <div className="base-ghead">{m ? m.l : (canon(by.property) === "tags" && g.key !== NONE ? "#" : "") + g.label}<span className="ms-1.5 font-normal">{g.rows.length}</span></div>;
}
function useGroups(rows: Row[], groups: RowGroup[] | null) {
  const ids = new Set(rows.map((r) => r.n.id));
  return groups ? groups.map((g) => ({ ...g, rows: g.rows.filter((r) => ids.has(r.n.id)) })).filter((g) => g.rows.length) : [{ key: "", label: "", rows }];
}
function GalleryView({ rows, groups, by, cols, ctx, colorOf, wide, more }: { rows: Row[]; groups: RowGroup[] | null; by?: SortRule; cols: string[]; ctx: Ctx; colorOf: (s: string) => string; wide: boolean; more: ReactNode }) {
  const gs = useGroups(rows, groups);
  const showStatus = cols.some((p) => canon(p) === "status");
  return (
    <div className={cx("h-full overflow-y-auto", wide ? "px-8 py-3" : "px-4 py-3")}>
      {gs.map((g) => (
        <section key={g.key} className="mb-4">
          {groups && by && <GroupHead g={g} by={by} />}
          <div className="base-gallery">
            {g.rows.map((r) => {
              const cover = coverOf(r);
              const meta = cardMeta(r, cols.filter((p) => canon(p) !== "status"), ctx, colorOf);
              const m = r.n.status ? STATUS_META[r.n.status] : null;
              return (
                <button key={r.n.id} onClick={() => openNote(r.n.id)} className="base-gcard">
                  {cover ? <img src={cover} alt="" loading="lazy" className="h-[110px] w-full object-cover" /> : <div className="base-cover"><span>cover</span></div>}
                  <div className="flex flex-col gap-1.5 px-3 py-2.5">
                    <span dir="auto" className="line-clamp-2 font-semibold">{r.n.title || "Untitled"}</span>
                    <span className="flex min-w-0 items-center gap-1.5 text-[12px]" style={{ color: m?.c ?? "var(--muted)" }}>
                      {showStatus && m && <><Glyph name={m.g} size={12} />{m.l}</>}
                      {meta.cs && <span dir="auto" className="truncate text-muted">{showStatus && m ? "· " : ""}{meta.cs}</span>}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {more}
    </div>
  );
}

function ListView({ rows, groups, cols, view, ctx, colorOf, wide, more }: { rows: Row[]; groups: RowGroup[] | null; cols: string[]; view: BaseViewDef; ctx: Ctx; colorOf: (s: string) => string; wide: boolean; more: ReactNode }) {
  const gs = useGroups(rows, groups);
  const dateP = view.date ?? cols.find((p) => isDateProp(p));
  return (
    <div className={cx("h-full overflow-y-auto", wide ? "px-8 py-1.5" : "px-4 py-1.5")}>
      {gs.map((g) => (
        <section key={g.key}>
          {groups && view.groupBy && <GroupHead g={g} by={view.groupBy} />}
          {g.rows.map((r) => {
            const m = r.n.status ? STATUS_META[r.n.status] : null;
            const meta = cardMeta(r, cols.filter((p) => p !== dateP && canon(p) !== "status"), ctx, colorOf);
            const dv = dateP ? getValue(r.n, dateP, ctx, r.props) : null;
            const dt = dv === null ? null : asTime(Array.isArray(dv) ? dv[0] ?? null : dv);
            return (
              <button key={r.n.id} onClick={() => openNote(r.n.id)} className="base-lrow">
                {m ? <Glyph name={m.g} size={15} color={m.c} /> : <Glyph name={r.n.type} size={15} color="var(--muted)" />}
                <span dir="auto" className="min-w-0 flex-1 truncate font-medium">{r.n.title || "Untitled"}</span>
                {meta.cs && <span dir="auto" className="truncate text-[12px] text-muted">{meta.cs}</span>}
                {dateP && <span className="w-14 shrink-0 text-end text-[12px] text-muted">{dt !== null ? fmtShort(dt) : ""}</span>}
              </button>
            );
          })}
        </section>
      ))}
      {more}
    </div>
  );
}

// ------------------------------------------------------------------ calendar (R4-18F)
function CalendarView({ rows, view, cols, ctx, spaces, colorOf, wide, month, say }: { rows: Row[]; view: BaseViewDef; cols: string[]; ctx: Ctx; spaces: Spaces; colorOf: (s: string) => string; wide: boolean; month: Date; say: (m: Moved | null) => void }) {
  const prop = view.date ?? "file.ctime";
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
  const { drag, start, ghost, wasDrag } = useDragCards((id, from, to) => { const r = byId.get(id); if (r) void moveTo(r, prop, from, to, ctx, spaces, say); }, scroller);
  const lead = (month.getDay() + 6) % 7; // weeks start on Monday
  const dim = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((lead + dim) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => new Date(month.getFullYear(), month.getMonth(), 1 - lead + i));
  const today = ymd(new Date());
  const selRows = sel ? byDay.m.get(sel) ?? [] : [];
  const courseP = cols.find(isCourse) ?? "space";
  const colorFor = (r: Row) => { const v = getValue(r.n, courseP, ctx, r.props); const s = Array.isArray(v) ? v[0] : v; return s ? colorOf(String(s)) : "var(--muted)"; };
  const fit = wide ? 3 : 0;
  return (
    <div ref={scroller} className={cx("flex h-full flex-col overflow-y-auto", wide ? "px-8 py-3" : "px-4 py-3")}>
      <div className="grid grid-cols-7 pb-1.5 text-[12px] text-muted">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d}>{wide ? d : d.slice(0, 1)}</span>)}</div>
      <div className="base-cal" style={{ gridTemplateRows: `repeat(${weeks}, minmax(${wide ? 104 : 56}px, 1fr))` }}>
        {days.map((d) => {
          const k = ymd(d), list = byDay.m.get(k) ?? [], out = d.getMonth() !== month.getMonth();
          return (
            <div key={k} data-drop={k} onClick={() => setSel(sel === k ? null : k)} className={cx("base-day", out && "is-out", sel === k && "is-sel", drag?.over === k && "is-over")}>
              <span className={cx("text-[12px]", k === today ? "font-bold text-accent" : "text-muted")}>{out ? "" : d.getDate()}</span>
              {fit ? (
                <>
                  {list.slice(0, fit).map((r) => (
                    <span key={r.n.id} onPointerDown={(e) => start(e, r.n.id, k, r.n.title)} onClick={(e) => { e.stopPropagation(); if (!wasDrag()) openNote(r.n.id); }} dir="auto"
                      className="base-cal-item" style={{ borderInlineStartColor: colorFor(r) }}>{r.n.title || "Untitled"}</span>
                  ))}
                  {list.length > fit && <span className="px-1 text-[11px] text-muted">+{list.length - fit} more</span>}
                </>
              ) : list.length > 0 && <span className="flex flex-wrap gap-0.5">{list.slice(0, 4).map((r) => <span key={r.n.id} className="size-1.5 rounded-full" style={{ background: colorFor(r) }} />)}</span>}
            </div>
          );
        })}
      </div>
      {byDay.none > 0 && <div className="mt-2 text-[12px] text-muted">{byDay.none} note{byDay.none === 1 ? "" : "s"} without a {label(prop).toLowerCase()}</div>}
      {sel && (
        <div className="mt-3 shrink-0 rounded-[12px] border border-line bg-surface">
          <div className="border-b border-line px-3 py-2 text-[13px] font-semibold">{fmtDate(asTime(sel)!)} <span className="font-normal text-muted">{selRows.length}</span></div>
          {selRows.length ? selRows.map((r) => (
            <button key={r.n.id} onClick={() => openNote(r.n.id)} className="flex w-full items-center gap-2 px-3 py-2.5 text-start hover:bg-surface-2">
              <Bar c={colorFor(r)} /><span dir="auto" className="truncate text-[13.5px]">{r.n.title || "Untitled"}</span>
            </button>
          )) : <div className="px-3 py-3 text-[12.5px] text-muted">Nothing on this day.</div>}
        </div>
      )}
      {ghost}
    </div>
  );
}

// ------------------------------------------------------------------ editors (filters, sort, group, properties, view)
function PropSelect({ value, props, onChange, allowNone, className }: { value: string; props: string[]; onChange: (p: string) => void; allowNone?: boolean; className?: string }) {
  const has = props.some((p) => canon(p) === canon(value));
  return (
    <select aria-label="Property" value={has ? props.find((p) => canon(p) === canon(value)) : value} onChange={(e) => onChange(e.target.value ? yamlName(canon(e.target.value)) : "")} className={cx(ctl, "cursor-pointer", className)}>
      {allowNone && <option value="">None</option>}
      {!has && value && <option value={value}>{canon(value)}</option>}
      {props.map((p) => <option key={p} value={p}>{canon(p) === "title" ? "title" : canon(p)}</option>)}
    </select>
  );
}
const DirButton = ({ dir, onClick }: { dir: "ASC" | "DESC"; onClick: () => void }) => (
  <button onClick={onClick} className={cx(ctl, "flex shrink-0 items-center gap-1 hover:border-accent")}>{dir === "ASC" ? <><ArrowUp size={13} />Ascending</> : <><ArrowDown size={13} />Descending</>}</button>
);
const Remove = ({ onClick, l }: { onClick: () => void; l: string }) => <button aria-label={l} onClick={onClick} className="px-1 text-muted hover:text-bad">×</button>;

const OPS: { id: string; l: string; op: Cond["op"] | "any"; neg: boolean; noValue?: boolean }[] = [
  { id: "is", l: "is", op: "==", neg: false }, { id: "any", l: "is any of", op: "any", neg: false }, { id: "isnt", l: "is not", op: "!=", neg: false },
  { id: "has", l: "contains", op: "contains", neg: false }, { id: "hasnt", l: "does not contain", op: "contains", neg: true },
  { id: "starts", l: "starts with", op: "startsWith", neg: false },
  { id: "gt", l: ">", op: ">", neg: false }, { id: "gte", l: "≥", op: ">=", neg: false }, { id: "lt", l: "<", op: "<", neg: false }, { id: "lte", l: "≤", op: "<=", neg: false },
  { id: "empty", l: "is empty", op: "isEmpty", neg: false, noValue: true }, { id: "set", l: "is not empty", op: "isEmpty", neg: true, noValue: true },
  { id: "tag", l: "has tag", op: "hasTag", neg: false }, { id: "notag", l: "does not have tag", op: "hasTag", neg: true },
  { id: "folder", l: "in folder", op: "inFolder", neg: false },
];
const opId = (c: Cond) => (c.op === "==" && c.neg ? "isnt" : c.op === "!=" && c.neg ? "is" : OPS.find((o) => o.op === c.op && o.neg === c.neg)?.id ?? "is");

/** Filter popover (R4-18A): rows read like a sentence (Where · property · operator · value), "any of" groups nest one level. */
function FilterPanel({ cfg, view, props, notes, ctx, edit }: { cfg: BaseConfig; view: BaseViewDef; props: string[]; notes: Note[]; ctx: Ctx; edit: (fn: (c: BaseConfig, v: BaseViewDef) => void) => void }) {
  const [scope, setScope] = useState<"view" | "all">(() => (!view.filters && cfg.filters ? "all" : "view"));
  const node = scope === "view" ? view.filters : cfg.filters;
  const fr = filterRows(node);
  const set = (next: FilterRows) => edit((c, w) => { const f = rowsToFilter(next); if (scope === "view") w.filters = f; else c.filters = f; });
  const values = (p: string) => {
    const s = new Set<string>();
    for (const n of notes.slice(0, 3000)) { const v = getValue(n, p, ctx, propsFor(n)); for (const x of Array.isArray(v) ? v : v === null ? [] : [canon(p) === "created" || canon(p) === "updated" ? ymd(new Date(v as number)) : String(v)]) if (s.size < 200) s.add(String(x)); }
    return [...s].sort();
  };
  const upd = (i: number, r: FilterRow | null) => set({ ...fr, rows: r ? fr.rows.map((x, j) => (j === i ? r : x)) : fr.rows.filter((_, j) => j !== i) });
  const join = (i: number, mode: "and" | "or", toggle: () => void) => i === 0 ? <span className="w-11 shrink-0 text-[12px] text-muted">Where</span> : <button className="w-11 shrink-0 text-start text-[12px] text-muted hover:text-ink" title="Switch between and / or" onClick={toggle}>{mode}</button>;
  const toggleTop = () => set({ ...fr, mode: fr.mode === "and" ? "or" : "and" });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="flex-1 font-semibold">Filter</span>
        <span className="flex rounded-[7px] border border-line p-0.5 text-[11.5px]">
          {(["view", "all"] as const).map((s) => <button key={s} onClick={() => setScope(s)} className={cx("rounded-[5px] px-2 leading-5", scope === s ? "bg-bg text-ink" : "text-muted")}>{s === "view" ? "This view" : "All views"}</button>)}
        </span>
      </div>
      {fr.rows.map((r, i) => {
        if (r.kind === "raw") return <div key={i} className="flex items-center gap-1.5">{join(i, fr.mode, toggleTop)}<span className="min-w-0 flex-1 truncate rounded-[7px] bg-bg px-2.5 py-1.5 font-mono text-[12px] text-muted" title="Edit in the YAML source">{typeof r.node === "string" ? r.node : JSON.stringify(r.node)}</span><Remove l="Remove filter" onClick={() => upd(i, null)} /></div>;
        if (r.kind === "group") return (
          <div key={i} className="flex items-start gap-1.5">
            {join(i, fr.mode, toggleTop)}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-[9px] border border-dashed border-line p-1.5">
              <span className="text-[11.5px] text-muted">Any of</span>
              {r.conds.map((c, j) => (
                <CondRow key={j} c={c} lead={j === 0 ? <span className="w-6 shrink-0 text-[12px] text-muted" /> : <span className="w-6 shrink-0 text-[12px] text-muted">or</span>} props={props} values={values}
                  onChange={(nc) => upd(i, { kind: "group", conds: nc && nc.kind === "cond" ? r.conds.map((x, k) => (k === j ? nc.c : x)) : r.conds.filter((_, k) => k !== j) })} />
              ))}
              <button className="self-start text-[12px] text-muted hover:text-ink" onClick={() => upd(i, { kind: "group", conds: [...r.conds, { prop: "status", op: "==", neg: false, args: ["learning"] }] })}>+ Add condition</button>
            </div>
            <Remove l="Remove group" onClick={() => upd(i, null)} />
          </div>
        );
        return <CondRow key={i} row={r} lead={join(i, fr.mode, toggleTop)} props={props} values={values} onChange={(nr) => upd(i, nr)} />;
      })}
      {!fr.rows.length && <span className="text-[12.5px] text-muted">No filters: every note is shown.</span>}
      <div className="flex flex-wrap items-center gap-2.5 pt-1 text-[12.5px] text-muted">
        <button className="hover:text-ink" onClick={() => set({ ...fr, rows: [...fr.rows, { kind: "cond", c: { prop: "status", op: "==", neg: false, args: ["learning"] } }] })}>+ Add filter</button>
        <button className="hover:text-ink" onClick={() => set({ ...fr, rows: [...fr.rows, { kind: "group", conds: [{ prop: "status", op: "==", neg: false, args: ["learning"] }, { prop: "status", op: "==", neg: false, args: ["review"] }] }] })}>+ Add group (any of)</button>
        <span className="flex-1" />
        <span>Writes to the base YAML</span>
      </div>
    </div>
  );
}

/** One condition: property · operator · value · ×. `row` (top level) may be an "is any of" row; `c` = plain condition. */
function CondRow({ row, c: c0, lead, props, values, onChange }: { row?: FilterRow; c?: Cond; lead: ReactNode; props: string[]; values: (p: string) => string[]; onChange: (r: FilterRow | null) => void }) {
  const r: FilterRow = row ?? { kind: "cond", c: c0! };
  const prop = r.kind === "any" ? r.prop : r.kind === "cond" ? r.c.prop : "";
  const c = r.kind === "cond" ? r.c : null;
  const o = r.kind === "any" ? OPS[1] : OPS.find((x) => x.id === opId(c!))!;
  const listId = useMemo(() => `bv-${Math.random().toString(36).slice(2, 8)}`, []);
  const setOp = (id: string) => {
    const n = OPS.find((x) => x.id === id)!;
    const first = r.kind === "any" ? r.values[0] ?? "" : c?.args[0] ?? "";
    if (n.op === "any") { if (row) onChange({ kind: "any", prop, values: first === "" ? [] : [String(first)] }); return; }
    onChange({ kind: "cond", c: { prop: n.op === "hasTag" ? "tags" : n.op === "inFolder" ? "folder" : prop, op: n.op, neg: n.neg, args: n.noValue ? [] : [first] } });
  };
  const status = canon(prop) === "status";
  return (
    <div className="flex items-center gap-1.5">
      {lead}
      {o.op === "hasTag" || o.op === "inFolder" ? <span className={cx(ctl, "flex min-w-[90px] items-center text-muted")}>{o.op === "hasTag" ? "tags" : "folder"}</span>
        : <PropSelect value={prop} props={props} className="w-[110px] shrink-0" onChange={(p) => onChange(r.kind === "any" ? { ...r, prop: p } : { kind: "cond", c: { ...c!, prop: p } })} />}
      <select aria-label="Operator" value={o.id} onChange={(e) => setOp(e.target.value)} className={cx(ctl, "w-auto shrink-0 cursor-pointer")}>
        {OPS.filter((x) => x.op !== "any" || row).map((x) => <option key={x.id} value={x.id}>{x.l}</option>)}
      </select>
      {r.kind === "any" ? (
        <span className={cx(ctl, "flex min-h-[30px] flex-1 flex-wrap items-center gap-1 py-0.5")}>
          {r.values.map((x) => <span key={x} className="inline-flex items-center gap-1">{status && isStatus(x) ? STATUS_META[x].l.toLowerCase() : x}<button aria-label={`Remove ${x}`} className="text-muted hover:text-ink" onClick={() => onChange({ ...r, values: r.values.filter((y) => y !== x) })}>×</button></span>)}
          {status ? (
            <select aria-label="Add value" value="" onChange={(e) => e.target.value && onChange({ ...r, values: [...r.values, e.target.value] })} className="min-w-0 flex-1 bg-transparent text-muted outline-none">
              <option value="">+</option>{STATUSES.filter((s) => !r.values.includes(s)).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <input aria-label="Add value" list={listId} placeholder={r.values.length ? "" : "value, value"} dir="auto" className="min-w-[50px] flex-1 bg-transparent outline-none"
              onKeyDown={(e) => { const t = e.currentTarget; if ((e.key === "Enter" || e.key === ",") && t.value.trim()) { e.preventDefault(); onChange({ ...r, values: [...r.values, t.value.trim()] }); t.value = ""; } }}
              onBlur={(e) => { if (e.target.value.trim()) onChange({ ...r, values: [...r.values, e.target.value.trim()] }); }} />
          )}
          <datalist id={listId}>{values(prop).map((x) => <option key={x} value={x} />)}</datalist>
        </span>
      ) : o.noValue ? <span className="flex-1" /> : status && (o.op === "==" || o.op === "!=") ? (
        <select aria-label="Value" value={String(c!.args[0] ?? "")} onChange={(e) => onChange({ kind: "cond", c: { ...c!, args: [e.target.value] } })} className={cx(ctl, "flex-1 cursor-pointer")}>
          <option value="">—</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      ) : (
        <>
          <input aria-label="Value" defaultValue={String(c!.args[0] ?? "")} list={listId} dir="auto" placeholder={isDateProp(prop) ? "2026-11-13 or today()" : "value"} key={String(c!.args[0] ?? "")}
            onBlur={(e) => { const raw = e.target.value.trim(); if (raw === String(c!.args[0] ?? "")) return; onChange({ kind: "cond", c: { ...c!, args: [/^-?\d+(\.\d+)?$/.test(raw) && !isDateProp(prop) ? Number(raw) : raw] } }); }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className={cx(ctl, "flex-1")} />
          <datalist id={listId}>{(o.op === "hasTag" ? values("tags") : values(prop)).map((x) => <option key={x} value={x} />)}</datalist>
        </>
      )}
      <Remove l="Remove filter" onClick={() => onChange(null)} />
    </div>
  );
}

function SortEditor({ sort, props, onChange }: { sort: SortRule[]; props: string[]; onChange: (s: SortRule[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-semibold">Sort</span>
      {!sort.length && <div className="text-[12.5px] text-muted">Default: last updated first. Tip: click a table column header to sort by it.</div>}
      {sort.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-11 shrink-0 text-[12px] text-muted">{i ? "then" : "By"}</span>
          <PropSelect value={s.property} props={props} className="flex-1" onChange={(p) => { const n = [...sort]; n[i] = { ...s, property: p }; onChange(n); }} />
          <DirButton dir={s.direction} onClick={() => { const n = [...sort]; n[i] = { ...s, direction: s.direction === "ASC" ? "DESC" : "ASC" }; onChange(n); }} />
          <Remove l="Remove sort" onClick={() => onChange(sort.filter((_, j) => j !== i))} />
        </div>
      ))}
      <button className="self-start pt-1 text-[12.5px] text-muted hover:text-ink" onClick={() => onChange([...sort, { property: "file.name", direction: "ASC" }])}>+ Add sort</button>
    </div>
  );
}

function GroupEditor({ view, groupBy, props, edit }: { view: BaseViewDef; groupBy?: SortRule; props: string[]; edit: (fn: (c: BaseConfig, v: BaseViewDef) => void) => void }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="font-semibold">{view.type === "board" ? "Board columns" : "Group"}</span>
      <span className="text-[12.5px] text-muted">{view.type === "board" ? "Each value is a column. Dragging a card to another column writes the property." : "Rows are grouped under a header per value."}</span>
      <div className="flex items-center gap-1.5">
        <span className="w-11 shrink-0 text-[12px] text-muted">By</span>
        <PropSelect value={groupBy?.property ?? ""} props={props} className="flex-1" allowNone={view.type !== "board"} onChange={(p) => edit((_c, w) => { w.groupBy = p ? { property: p, direction: w.groupBy?.direction ?? "ASC" } : undefined; })} />
        {groupBy && <DirButton dir={groupBy.direction} onClick={() => edit((_c, w) => { w.groupBy = { property: groupBy.property, direction: groupBy.direction === "ASC" ? "DESC" : "ASC" }; })} />}
      </div>
      {groupBy && <SeveralValues view={view} edit={edit} />}
    </div>
  );
}
const SeveralValues = ({ view, edit }: { view: BaseViewDef; edit: (fn: (c: BaseConfig, v: BaseViewDef) => void) => void }) => (
  <div className="flex items-center gap-2">
    <span className="flex-1 text-muted">Several values</span>
    <select aria-label="Several values" value={view.groupMulti ?? "each"} onChange={(e) => edit((_c, w) => { w.groupMulti = e.target.value === "first" ? "first" : "each"; })} className={cx(ctl, "h-7 cursor-pointer text-[12.5px]")}>
      <option value="each">Show in each group</option><option value="first">First group only</option>
    </select>
  </div>
);

function PropsEditor({ order, props, onChange }: { order: string[]; props: string[]; onChange: (o: string[]) => void }) {
  const on = order.map(canon);
  const rest = props.filter((p) => !on.includes(canon(p)));
  const move = (i: number, d: number) => { const n = [...order]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  return (
    <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
      <span className="px-1 pb-1 font-semibold">Properties</span>
      {order.map((p, i) => (
        <div key={p} className="flex items-center gap-2 rounded-[6px] px-1.5 py-1 hover:bg-bg">
          <input type="checkbox" checked disabled={canon(p) === "title"} onChange={() => onChange(order.filter((x) => x !== p))} className="accent-[var(--accent)]" aria-label={`Hide ${label(p)}`} />
          <span className="flex-1">{label(p)}</span>
          <button aria-label="Move up" onClick={() => move(i, -1)} className="text-muted hover:text-ink"><ArrowUp size={13} /></button>
          <button aria-label="Move down" onClick={() => move(i, 1)} className="text-muted hover:text-ink"><ArrowDown size={13} /></button>
        </div>
      ))}
      {rest.length > 0 && <div className="mt-1 border-t border-line px-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Hidden</div>}
      {rest.map((p) => (
        <label key={p} className="flex cursor-pointer items-center gap-2 rounded-[6px] px-1.5 py-1 hover:bg-bg">
          <input type="checkbox" checked={false} onChange={() => onChange([...order, yamlName(canon(p))])} className="accent-[var(--accent)]" />
          <span className="flex-1 text-muted">{label(p)}</span>
        </label>
      ))}
    </div>
  );
}

/** View settings (R4-18F): name, layout, group by, several values, limit (+ date property for calendars), then actions. */
function ViewSettings({ view, props, canDelete, edit, phone, onProps, onSearch, onNew, newLabel, onDuplicate, onDelete, onSource, onDownload }: { view: BaseViewDef; props: string[]; canDelete: boolean; edit: (fn: (c: BaseConfig, v: BaseViewDef) => void) => void; phone: boolean; onProps: () => void; onSearch: () => void; onNew: () => void; newLabel: string; onDuplicate: () => void; onDelete: () => void; onSource: () => void; onDownload: () => void }) {
  const row = (l: string, el: ReactNode) => <label className="flex items-center gap-2"><span className="flex-1 text-muted">{l}</span>{el}</label>;
  const box = cx(ctl, "h-7 max-w-[170px] text-[12.5px]");
  return (
    <div className="flex flex-col gap-2.5">
      <span className="font-semibold">View settings</span>
      {row("Name", <input defaultValue={view.name} dir="auto" className={cx(box, "w-[150px] text-end")} onBlur={(e) => e.target.value.trim() && e.target.value !== view.name && edit((_c, w) => { w.name = e.target.value.trim(); })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />)}
      {row("Layout", (
        <select value={view.type} className={cx(box, "cursor-pointer")} onChange={(e) => { const t = e.target.value as ViewType; edit((_c, w) => { w.type = t; if (t === "board" && !w.groupBy) w.groupBy = { property: "status", direction: "ASC" }; }); }}>
          {(["table", "board", "cards", "list", "calendar"] as ViewType[]).map((t) => <option key={t} value={t}>{VIEW_LABEL[t]}</option>)}
        </select>
      ))}
      {view.type === "calendar"
        ? row("Date property", <PropSelect value={view.date ?? "file.ctime"} props={props.filter((p) => isDateProp(p) || !BUILTIN.includes(p as never))} className={box} onChange={(p) => edit((_c, w) => { w.date = p; })} />)
        : row("Group by", <PropSelect value={view.groupBy?.property ?? (view.type === "board" ? "status" : "")} props={props} className={box} allowNone={view.type !== "board"} onChange={(p) => edit((_c, w) => { w.groupBy = p ? { property: p, direction: w.groupBy?.direction ?? "ASC" } : undefined; })} />)}
      {(view.groupBy || view.type === "board") && view.type !== "calendar" && <SeveralValues view={view} edit={edit} />}
      {row("Limit", <input type="number" min={1} placeholder="All" defaultValue={view.limit ?? ""} className={cx(box, "w-[70px] text-end")} onBlur={(e) => { const n = Number(e.target.value); if ((n || undefined) !== view.limit) edit((_c, w) => { w.limit = n > 0 ? n : undefined; }); }} />)}
      <div className="h-px bg-line" />
      {phone && <button className="text-start font-semibold text-accent" onClick={onNew}>{newLabel}</button>}
      {phone && <button className="text-start" onClick={onSearch}>Search…</button>}
      {phone && <button className="text-start" onClick={onProps}>Properties…</button>}
      <button className="text-start hover:text-accent" onClick={onDuplicate}>Duplicate view</button>
      <button className="text-start hover:text-accent" onClick={onSource}>Edit YAML</button>
      <button className="text-start hover:text-accent" onClick={onDownload}>Download .base</button>
      {canDelete && <button className="text-start text-bad hover:underline" onClick={onDelete}>Delete view</button>}
    </div>
  );
}
