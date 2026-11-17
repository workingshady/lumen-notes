import { diffLines } from "diff";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlignLeft, ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Bookmark, Calendar, ChevronDown, ChevronRight, CircleDot, Clock, Copy, CornerUpLeft, FileText, Gauge, Hash,
  History, Layers, Link, Link2, ListTree, Loader2, MessageCircleQuestion, Plus, RefreshCw, SlidersHorizontal, Sparkles, Tag, Text, Timer, Trash2, X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NOTE_TYPES, STATUSES, type Note, type Version } from "../../shared/types";
import { snapshot, updateNote } from "../lib/actions";
import { aiRun, getToken } from "../lib/api";
import { db } from "../lib/db";
import { inlineTags, outline, setFrontMatter, splitFrontMatter } from "../lib/parse";
import { openNote, setUI, toast, useUI, useVault, type Panel } from "../lib/store";
import { getSelectionText, insertText, scrollEditorToLine } from "./Editor";
import { Preview } from "./Preview";
import { Button, cx, STATUS_COLOR } from "./ui";

const SECTION = "px-1 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted";

const TABS: { value: Exclude<Panel, null>; label: string; icon: ReactNode }[] = [
  { value: "outline", label: "Outline", icon: <ListTree size={15} /> },
  { value: "backlinks", label: "Links", icon: <Link2 size={15} /> },
  { value: "properties", label: "Properties", icon: <SlidersHorizontal size={15} /> },
  { value: "versions", label: "Versions", icon: <History size={15} /> },
  { value: "ai", label: "AI", icon: <Sparkles size={15} /> },
];
const useWidth = () => { const [w, setW] = useState(() => innerWidth); useEffect(() => { const f = () => setW(innerWidth); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return w; };

export function RightPanel({ note }: { note: Note }) {
  const { panel } = useUI();
  const phone = useWidth() < 768;
  if (!panel) return null;
  if (panel === "versions" && phone) return <PhoneVersions note={note} />;
  return (
    <aside className={cx("fixed inset-0 z-40 flex flex-col bg-surface text-[13px] md:static md:z-auto md:shrink-0 md:border-l md:border-line fade-in", panel === "ai" ? "md:w-[340px]" : "md:w-[300px]")}>
      {/* Icon tabs; the active one expands to icon + label */}
      <div className="safe-t flex h-12 shrink-0 items-center gap-0.5 border-b border-line px-2">
        <div role="tablist" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {TABS.map((t) => {
            const on = panel === t.value;
            return (
              <button key={t.value} role="tab" aria-selected={on} title={t.label} aria-label={t.label} onClick={() => setUI({ panel: t.value })}
                className={cx("flex h-[30px] shrink-0 items-center justify-center gap-1.5 rounded-[6px]", on ? "bg-surface-2 px-2.5 font-semibold text-ink [&>svg]:text-accent" : "w-8 text-muted hover:bg-surface-2 hover:text-ink")}>
                {t.icon}{on && t.label}
              </button>
            );
          })}
        </div>
        <button aria-label="Close panel" title="Close panel" className="flex size-8 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink md:hidden" onClick={() => setUI({ panel: null })}><X size={16} /></button>
      </div>
      <div className={cx("min-h-0 flex-1 overflow-y-auto", panel === "versions" || panel === "properties" || panel === "ai" ? "" : "p-3")}>
        {panel === "outline" && <Outline note={note} />}
        {panel === "backlinks" && <Backlinks note={note} />}
        {panel === "properties" && <Properties note={note} />}
        {panel === "versions" && <Versions note={note} />}
        {panel === "ai" && <AI note={note} />}
      </div>
    </aside>
  );
}

function Outline({ note }: { note: Note }) {
  const hs = useMemo(() => outline(note.body), [note.body]);
  if (!hs.length) return <p className="px-1 text-[13px] text-muted">No headings yet. Use <code>#</code>, <code>##</code>, <code>###</code>.</p>;
  const min = Math.min(...hs.map((h) => h.level));
  return (
    <nav className="flex flex-col gap-px">
      <div className={SECTION}>Outline · {hs.length}</div>
      {hs.map((h) => (
        <button key={h.line} dir="auto" onClick={() => { scrollEditorToLine(h.line); document.querySelector(`.prose [data-line="${h.line}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
          className={cx("relative block w-full truncate rounded-[8px] py-1.5 pr-2 text-left text-[13px] hover:bg-surface-2 hover:text-ink", h.level === min ? "font-medium text-ink" : "text-muted")}
          style={{ paddingLeft: 10 + (h.level - min) * 14 }}>
          {h.level > min && <span className="absolute bottom-1 top-1 w-px bg-line" style={{ left: 4 + (h.level - min) * 14 }} />}
          {h.text}
        </button>
      ))}
    </nav>
  );
}

function Backlinks({ note }: { note: Note }) {
  const v = useVault();
  const back = (v.backlinks.get(note.id) ?? []).map((id) => v.byId.get(id)!).filter(Boolean);
  const out = (v.outlinks.get(note.id) ?? []).map((id) => v.byId.get(id)!).filter(Boolean);
  // Unlinked mentions: notes that mention this title in plain text but don't link it.
  const mentions = note.title.length > 3 ? v.notes.filter((n) => n.id !== note.id && !back.includes(n) && n.body.toLowerCase().includes(note.title.toLowerCase())).slice(0, 20) : [];
  const List = ({ title, items, icon }: { title: string; items: Note[]; icon: ReactNode }) => (
    <div className="mb-3">
      <div className={SECTION}>{title} · {items.length}</div>
      {items.length ? items.map((n) => (
        <button key={n.id} onClick={() => openNote(n.id)} className="flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-left hover:bg-surface-2">
          <span className="mt-0.5 shrink-0 text-muted">{icon}</span>
          <span className="min-w-0 flex-1">
            <span dir="auto" className="block truncate text-[13px] font-medium">{n.title}</span>
            <span className="block truncate text-[12px] text-muted">{v.folderMap.get(n.folderId ?? "")?.name ?? v.spaceMap.get(n.spaceId)?.name ?? ""}</span>
          </span>
        </button>
      )) : <div className="px-2.5 text-[12.5px] text-muted">None</div>}
    </div>
  );
  return (<><List title="Backlinks" items={back} icon={<CornerUpLeft size={14} />} /><List title="Links out" items={out} icon={<ArrowUpRight size={14} />} /><List title="Unlinked mentions" items={mentions} icon={<FileText size={14} />} /></>);
}

// ------------------------------------------------------------------ properties (typed front-matter values)
type PropKind = "text" | "url" | "date" | "dots";
const ADVANCED = ["aliases", "cssclass", "cssclasses", "id"];
const DATE_KEYS = /^(due|date|deadline|start|end|exam|scheduled|created|updated)$/i;
const URL_KEYS = /^(source|url|link|website|video)$/i;
const DOT_KEYS = /^(difficulty|rating|priority|importance|confidence)$/i;
const kindOf = (k: string, v: string): PropKind => DOT_KEYS.test(k) ? "dots" : DATE_KEYS.test(k) || /^\d{4}-\d{2}-\d{2}$/.test(v) ? "date" : URL_KEYS.test(k) || /^https?:\/\//.test(v) ? "url" : "text";
const PROP_ICON: Record<string, ReactNode> = { course: <BookOpen size={13} />, book: <BookOpen size={13} />, difficulty: <Gauge size={13} />, status: <CircleDot size={13} />, type: <Tag size={13} />, tags: <Hash size={13} />, studied: <Timer size={13} /> };
const iconFor = (k: string, kind: PropKind) => PROP_ICON[k.toLowerCase()] ?? (kind === "url" ? <Link size={13} /> : kind === "date" ? <Calendar size={13} /> : kind === "dots" ? <Gauge size={13} /> : <Text size={13} />);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function parseDate(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t);
}
function showDate(v: string) {
  const d = parseDate(v);
  if (!d) return { t: v, c: "var(--text)" };
  const days = Math.round((d.getTime() - new Date(ymd(new Date()) + "T00:00").getTime()) / 86400000);
  // "Wed 19 Nov" (year only when it isn't this year)
  const t = days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.getDate()} ${d.toLocaleDateString(undefined, { month: "short" })}${d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : ""}`;
  return { t, c: days < 0 ? "var(--danger)" : days <= 7 ? "var(--warning)" : "var(--text)" };
}
const studiedText = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min` : `${min} min`);

function Properties({ note }: { note: Note }) {
  const v = useVault();
  const sessions = useLiveQuery(() => db.sessions.where("noteId").equals(note.id).toArray(), [note.id]) ?? [];
  const minutes = sessions.filter((s) => !s.deleted).reduce((a, s) => a + s.minutes, 0);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [adv, setAdv] = useState(false);
  const md = !["canvas", "whiteboard", "diagram"].includes(note.type);

  /** Write a property to the record and (for Markdown notes) to the YAML front-matter. */
  const setProp = (key: string, val: string | null) => {
    const props = { ...note.props };
    if (val === null || val === "") delete props[key]; else props[key] = val;
    if (!md) return void updateNote(note.id, { props });
    const inl = inlineTags(splitFrontMatter(note.body).body);
    const body = setFrontMatter(note.body, { [key]: val || null, type: note.type === "note" ? null : note.type, status: note.status ?? null, tags: note.tags.filter((t) => !inl.includes(t)) });
    void updateNote(note.id, { props, body });
  };
  const custom = Object.entries(note.props).filter(([k]) => !ADVANCED.includes(k.toLowerCase()) && !["type", "status", "tags"].includes(k));

  const Row = ({ id, k, icon, children, edit }: { id: string; k: string; icon: ReactNode; children: ReactNode; edit?: ReactNode }) => (
    <div className={cx("group grid min-h-9 grid-cols-[104px_1fr] items-center gap-2 rounded-[6px] px-1.5", editing === id ? "bg-surface-2" : "hover:bg-surface-2")}>
      <span className="flex min-w-0 items-center gap-2 text-muted"><span className="shrink-0">{icon}</span><span className="truncate" title={k}>{k}</span></span>
      {editing === id && edit ? <div className="min-w-0 py-1">{edit}</div> : <div className="flex min-w-0 items-center">{children}</div>}
    </div>
  );
  const valBtn = (id: string, content: ReactNode, color = "var(--text)") => (
    <button onClick={() => setEditing(id)} className="min-w-0 flex-1 truncate py-2 text-left" style={{ color }}>{content}</button>
  );
  const field = "h-7 w-full rounded-[6px] border border-accent bg-bg px-2 text-ink outline-none";
  const TextEdit = ({ init, onDone, type = "text" }: { init: string; onDone: (v: string | null) => void; type?: string }) => (
    <input autoFocus type={type} defaultValue={init} className={field}
      onBlur={(e) => { onDone(e.target.value); setEditing(null); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null); }} />
  );
  const Dots = ({ k, val }: { k: string; val: string }) => {
    const n = Math.max(0, Math.min(5, parseInt(val, 10) || (val.match(/●/g)?.length ?? 0)));
    return (
      <span className="flex flex-1 items-center py-2 tracking-[.04em]" title="1–5">
        {[1, 2, 3, 4, 5].map((i) => <button key={i} aria-label={`${k} ${i}`} onClick={() => setProp(k, n === i ? null : String(i))} className="hover:text-accent">{i <= n ? "●" : "○"}</button>)}
      </span>
    );
  };
  const Chips = ({ opts, cur, onPick }: { opts: string[]; cur: string; onPick: (v: string) => void }) => (
    <div className="flex flex-wrap gap-1">
      {opts.map((o) => <button key={o} onClick={() => { onPick(o); setEditing(null); }} className={cx("h-6 rounded-full border px-2 text-[12px] capitalize", o === cur ? "border-accent text-ink" : "border-line text-muted hover:text-ink")}>{o}</button>)}
    </div>
  );

  return (
    <div className="flex flex-col gap-0.5 p-3">
      {custom.map(([k, val]) => {
        const kind = kindOf(k, val);
        const id = "p:" + k;
        if (kind === "dots") return <Row key={k} id={id} k={k} icon={iconFor(k, kind)}><Dots k={k} val={val} /><RemoveBtn onClick={() => setProp(k, null)} /></Row>;
        if (kind === "date") {
          const d = showDate(val);
          return <Row key={k} id={id} k={k} icon={iconFor(k, kind)} edit={<TextEdit type="date" init={parseDate(val) ? ymd(parseDate(val)!) : ""} onDone={(x) => setProp(k, x)} />}>{valBtn(id, d.t, d.c)}<RemoveBtn onClick={() => setProp(k, null)} /></Row>;
        }
        if (kind === "url") {
          const href = /^https?:\/\//.test(val) ? val : `https://${val}`;
          return (
            <Row key={k} id={id} k={k} icon={iconFor(k, kind)} edit={<TextEdit init={val} onDone={(x) => setProp(k, x)} />}>
              <a href={href} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate py-2 text-link hover:underline" onClick={(e) => { if (e.altKey) { e.preventDefault(); setEditing(id); } }}>{val.replace(/^https?:\/\/(www\.)?/, "")}</a>
              <EditBtn onClick={() => setEditing(id)} /><RemoveBtn onClick={() => setProp(k, null)} />
            </Row>
          );
        }
        return <Row key={k} id={id} k={k} icon={iconFor(k, kind)} edit={<TextEdit init={val} onDone={(x) => setProp(k, x)} />}>{valBtn(id, val || <span className="text-muted">Empty</span>)}<RemoveBtn onClick={() => setProp(k, null)} /></Row>;
      })}
      {md || note.status ? (
        <Row id="status" k="status" icon={<CircleDot size={13} />} edit={<Chips opts={[...STATUSES, "none"]} cur={note.status ?? "none"} onPick={(s) => void updateNote(note.id, { status: s === "none" ? null : (s as Note["status"]) })} />}>
          {valBtn("status", note.status ? cap(note.status) : <span className="text-muted">None</span>, note.status ? STATUS_COLOR[note.status] : undefined)}
        </Row>
      ) : null}
      <Row id="type" k="type" icon={<Tag size={13} />} edit={<Chips opts={NOTE_TYPES.filter((t) => md ? !["canvas", "whiteboard", "diagram"].includes(t) : t === note.type)} cur={note.type} onPick={(t) => void updateNote(note.id, { type: t as Note["type"] })} />}>
        {valBtn("type", note.type === "moc" ? "Map of content" : cap(note.type))}
      </Row>
      <Row id="tags" k="tags" icon={<Hash size={13} />} edit={<TextEdit init={note.tags.join(" ")} onDone={(x) => void updateNote(note.id, { tags: [...new Set((x ?? "").split(/[\s,]+/).map((t) => t.replace(/^#/, "").toLowerCase()).filter(Boolean))] })} />}>
        {valBtn("tags", note.tags.length ? note.tags.map((t) => `#${t}`).join("  ") : "Add tags", "var(--muted)")}
      </Row>
      <Row id="studied" k="studied" icon={<Timer size={13} />}><span className="flex-1 truncate py-2" title="Study-timer minutes logged to this note">{studiedText(minutes)}</span></Row>

      {adding ? (
        <AddProp existing={Object.keys(note.props)} onAdd={(k, val) => { setProp(k, val || (kindOf(k, "") === "date" ? ymd(new Date()) : kindOf(k, "") === "dots" ? "3" : "")); setAdding(false); if (!val && kindOf(k, "") !== "dots") setEditing("p:" + k); }} onCancel={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} className="flex items-center gap-2 rounded-[6px] px-1.5 py-2.5 text-left text-muted hover:text-ink"><Plus size={13} />Add property</button>
      )}

      <div className="mt-1.5 border-t border-line px-1.5 pt-2.5">
        <button onClick={() => setAdv((a) => !a)} className="flex w-full items-center gap-1.5 text-left text-[12px] text-muted hover:text-ink">
          {adv ? <ChevronDown size={12} /> : <ChevronRight size={12} />}Advanced · id, created, aliases, cssclass
        </button>
        {adv && (
          <div className="mt-2 flex flex-col gap-0.5">
            <div className="grid min-h-8 grid-cols-[104px_1fr] items-center gap-2 text-[12.5px]"><span className="text-muted">id</span><span className="truncate font-mono text-[11.5px]" title={note.id}>{note.id}</span></div>
            <div className="grid min-h-8 grid-cols-[104px_1fr] items-center gap-2 text-[12.5px]"><span className="text-muted">created</span><span>{new Date(note.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span></div>
            <div className="grid min-h-8 grid-cols-[104px_1fr] items-center gap-2 text-[12.5px]"><span className="text-muted">updated</span><span>{new Date(note.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span></div>
            {["aliases", "cssclass"].map((k) => (
              <div key={k} className="grid min-h-8 grid-cols-[104px_1fr] items-center gap-2 text-[12.5px]">
                <span className="text-muted">{k}</span>
                <input defaultValue={note.props[k] ?? ""} key={note.props[k] ?? ""} placeholder={k === "aliases" ? "Other names, comma separated" : "css class for export"} onBlur={(e) => e.target.value !== (note.props[k] ?? "") && setProp(k, e.target.value.trim() || null)}
                  className="h-7 min-w-0 rounded-[6px] border border-transparent bg-transparent px-1.5 outline-none placeholder:text-muted hover:border-line focus:border-accent" />
              </div>
            ))}
            {!v.ready && null}
          </div>
        )}
      </div>
    </div>
  );
}
function RemoveBtn({ onClick }: { onClick: () => void }) {
  return <button aria-label="Remove property" title="Remove" onClick={onClick} className="ml-1 hidden size-6 shrink-0 items-center justify-center rounded-[6px] text-muted hover:text-bad group-hover:flex"><Trash2 size={12} /></button>;
}
function EditBtn({ onClick }: { onClick: () => void }) {
  return <button aria-label="Edit" title="Edit" onClick={onClick} className="ml-1 hidden h-6 shrink-0 items-center rounded-[6px] px-1.5 text-[11.5px] text-muted hover:text-ink group-hover:flex">Edit</button>;
}
const SUGGEST = ["course", "source", "due", "difficulty", "exam", "teacher", "aliases"];
function AddProp({ existing, onAdd, onCancel }: { existing: string[]; onAdd: (k: string, v: string) => void; onCancel: () => void }) {
  const [k, setK] = useState("");
  const [val, setVal] = useState("");
  const kind = kindOf(k, val);
  const submit = () => { const key = k.trim().toLowerCase().replace(/\s+/g, "-"); if (key && !existing.includes(key)) onAdd(key, val.trim()); else if (!key) onCancel(); else toast(`“${key}” already exists`); };
  return (
    <form className="flex flex-col gap-1.5 rounded-[8px] border border-line bg-bg p-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="flex gap-1.5">
        <input autoFocus list="lumen-prop-keys" value={k} onChange={(e) => setK(e.target.value)} placeholder="Name" onKeyDown={(e) => e.key === "Escape" && onCancel()}
          className="h-7 w-[104px] shrink-0 rounded-[6px] border border-line bg-surface px-2 outline-none focus:border-accent" />
        <input value={val} onChange={(e) => setVal(e.target.value)} type={kind === "date" ? "date" : "text"} placeholder={kind === "dots" ? "1–5" : kind === "url" ? "https://" : "Value"} onKeyDown={(e) => e.key === "Escape" && onCancel()}
          className="h-7 min-w-0 flex-1 rounded-[6px] border border-line bg-surface px-2 outline-none focus:border-accent" />
      </div>
      <datalist id="lumen-prop-keys">{SUGGEST.filter((s) => !existing.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
      <div className="flex justify-end gap-1.5"><Button size="sm" variant="ghost" type="button" className="h-7" onClick={onCancel}>Cancel</Button><Button size="sm" variant="primary" type="submit" className="h-7">Add</Button></div>
    </form>
  );
}

// ------------------------------------------------------------------ versions
/** +added / −removed line counts between two bodies. */
function lineDelta(from: string, to: string) {
  let add = 0, del = 0;
  for (const p of diffLines(from, to)) {
    if (p.added) add += p.count ?? 0;
    else if (p.removed) del += p.count ?? 0;
  }
  return { add, del };
}
const fmt = (n: number) => n.toLocaleString();
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
const hm = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function when(t: number) {
  if (sameDay(t, Date.now())) return hm(t);
  if (sameDay(t, Date.now() - 86400000)) return `Yesterday ${hm(t)}`;
  const d = new Date(t);
  // "Mon 10 Nov 20:18"
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.getDate()} ${d.toLocaleDateString(undefined, { month: "short" })}${d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : ""} ${hm(t)}`;
}
/** "Today 21:12" style for labels and the comparing bar. */
const whenLong = (t: number) => (sameDay(t, Date.now()) ? `Today ${hm(t)}` : when(t));
const isRestore = (v: Version) => v.label.startsWith("Restored") || v.label === "Before restore";
const labelOf = (v: Version) => (v.label ? (isRestore(v) || v.label === "Manual save" ? v.label : `“${v.label}”`) : "Auto-save");

function useVersions(note: Note) {
  const versions = useLiveQuery(() => db.versions.where("noteId").equals(note.id).reverse().sortBy("createdAt"), [note.id]) ?? [];
  const live = useMemo(() => versions.filter((v) => !v.deleted), [versions]);
  const deltas = useMemo(() => live.map((v, i) => lineDelta(live[i + 1]?.body ?? "", v.body)), [live]);
  return { live, deltas };
}
/** Restoring never overwrites: the current text is kept as a version, then the old text becomes a new version on top. */
async function restore(note: Note, v: Version, live: Version[]) {
  const before = { title: note.title, body: note.body };
  if (live[0]?.body !== note.body) await snapshot(note, "");
  await updateNote(note.id, { title: v.title, body: v.body });
  await snapshot({ ...note, title: v.title, body: v.body }, `Restored from ${whenLong(v.createdAt)}`);
  toast(`Restored from ${whenLong(v.createdAt)}`, { label: "Undo", run: () => void updateNote(note.id, before) });
}
const copy = (t: string) => { void navigator.clipboard.writeText(t); toast("Copied"); };

function Counts({ add, del }: { add: number; del: number }) {
  return (
    <span className="mt-px flex shrink-0 gap-1.5 font-mono text-[11.5px] font-medium">
      {add > 0 && <span className="text-ok">+{fmt(add)}</span>}
      {del > 0 && <span className="text-bad">−{fmt(del)}</span>}
    </span>
  );
}

function Versions({ note }: { note: Note }) {
  const { live, deltas } = useVersions(note);
  const [selId, setSelId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const sel = live.find((v) => v.id === selId) ?? null;
  const current = useMemo(() => lineDelta(live[0]?.body ?? "", note.body), [live, note.body]);
  const ref = useRef<HTMLDivElement>(null);

  // ↑↓ step through versions, Esc returns to the live note.
  useEffect(() => {
    if (!sel) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, .cm-editor")) return;
      const i = live.findIndex((v) => v.id === sel.id);
      if (e.key === "ArrowDown" && i < live.length - 1) { e.preventDefault(); setSelId(live[i + 1].id); }
      else if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); setSelId(live[i - 1].id); }
      else if (e.key === "Escape") setSelId(null);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [sel, live]);

  let lastGroup = "Today";
  return (
    <div ref={ref} className="flex flex-col">
      <form className="flex gap-2 p-3" onSubmit={async (e) => { e.preventDefault(); await snapshot(note, label || "Manual save"); setLabel(""); toast("Version saved"); }}>
        <input className="h-8 min-w-0 flex-1 rounded-[6px] border border-line bg-bg px-2.5 text-ink outline-none placeholder:text-muted focus:border-accent" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" />
        <button type="submit" className="flex h-8 items-center rounded-[10px] border border-line px-2.5 font-medium hover:bg-surface-2">Save</button>
      </form>
      <div className="flex flex-col gap-0.5 px-2 pb-3">
        <div className="px-2 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Today</div>
        <button onClick={() => setSelId(null)} className="flex items-start gap-2.5 rounded-[8px] px-2.5 py-[9px] text-left">
          <CircleDot size={14} className="mt-0.5 shrink-0 text-muted" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="leading-4">Current</span><span className="text-[12px] leading-[15px] text-muted">Now · this device</span></span>
          <Counts {...current} />
        </button>
        {live.map((v, i) => {
          const group = sameDay(v.createdAt, Date.now()) ? "Today" : "Earlier";
          const header = group !== lastGroup;
          lastGroup = group;
          const on = v.id === selId;
          return (
            <div key={v.id} className="flex flex-col">
              {header && <div className="px-2 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{group}</div>}
              <button onClick={() => setSelId(on ? null : v.id)} className={cx("flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-[9px] text-left", on ? "bg-surface-2 shadow-[inset_0_0_0_1px_var(--accent)]" : "hover:bg-surface-2")}>
                <span className={cx("mt-0.5 shrink-0", on ? "text-accent" : "text-muted")}>{isRestore(v) ? <History size={14} /> : v.label ? <Bookmark size={14} /> : <Clock size={14} />}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cx("truncate leading-4", (on || v.label) && "font-semibold")}>{when(v.createdAt)}</span>
                  <span className="truncate text-[12px] leading-[15px] text-muted">{labelOf(v)}</span>
                </span>
                <Counts {...deltas[i]} />
              </button>
            </div>
          );
        })}
        {!live.length && <p className="px-2.5 pt-2 text-[13px] text-muted">Versions are saved automatically while you write (every 2 min at most), and whenever you click Save. Restoring never overwrites: it adds a new version on top.</p>}
      </div>
      {sel && <DiffOverlay anchor={ref} note={note} v={sel} onClose={() => setSelId(null)} onRestore={async () => { await restore(note, sel, live); setSelId(null); }} />}
    </div>
  );
}

/** Full-width diff in the main pane (left of the side panel): Viewing version · read-only. */
function DiffOverlay({ anchor, note, v, onClose, onRestore }: { anchor: React.RefObject<HTMLDivElement | null>; note: Note; v: Version; onClose: () => void; onRestore: () => void }) {
  const vault = useVault();
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [mode, setMode] = useState<"inline" | "side">(() => { try { return (localStorage.getItem("lumen.diffMode") as "inline" | "side") ?? "inline"; } catch { return "inline"; } });
  useLayoutEffect(() => {
    const aside = anchor.current?.closest("aside");
    const main = aside?.previousElementSibling as HTMLElement | null;
    if (!main) return;
    const upd = () => { const r = main.getBoundingClientRect(); setBox({ left: r.left, top: r.top, width: r.width, height: r.height }); };
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(main);
    addEventListener("resize", upd);
    return () => { ro.disconnect(); removeEventListener("resize", upd); };
  }, [anchor]);
  const d = useMemo(() => lineDelta(v.body, note.body), [v.body, note.body]);
  const setM = (m: "inline" | "side") => { setMode(m); try { localStorage.setItem("lumen.diffMode", m); } catch { /* ignore */ } };
  const folder = note.folderId ? vault.folderMap.get(note.folderId)?.name : vault.spaceMap.get(note.spaceId)?.name;
  if (!box) return null;
  return (
    <div className="fixed z-30 flex flex-col bg-bg text-[13px] text-ink fade-in" style={box}>
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line pl-5 pr-4">
        {folder && <><span className="truncate text-muted">{folder}</span><ChevronRight size={12} className="shrink-0 text-muted" /></>}
        <span dir="auto" className="truncate font-medium">{v.title}</span>
        <span className="shrink-0 rounded-[6px] bg-surface-2 px-2 text-[12px] leading-[22px] text-muted">Viewing version · read-only</span>
        <span className="flex-1" />
        <button onClick={() => copy(v.body)} className="flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border border-line px-3 hover:bg-surface-2"><Copy size={14} />Copy</button>
        <button onClick={onRestore} className="flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] bg-accent px-3.5 font-semibold text-accent-fg hover:brightness-110"><History size={14} />Restore as new version</button>
      </div>
      <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line px-5 text-muted">
        <span>Comparing</span><span className="font-medium text-ink">{whenLong(v.createdAt)}</span><ArrowRight size={13} /><span className="font-medium text-ink">Current</span>
        <span className="flex-1" />
        <span className="text-ok">+{fmt(d.add)}</span><span className="text-bad">−{fmt(d.del)}</span>
        <span className="ml-2 flex gap-0.5 rounded-[8px] border border-line bg-surface p-[3px]">
          {(["inline", "side"] as const).map((m) => (
            <button key={m} onClick={() => setM(m)} className={cx("flex h-[22px] items-center rounded-[6px] px-2 text-[12px]", mode === m ? "bg-surface-2 text-ink" : "hover:text-ink")}>{m === "inline" ? "Inline" : "Side by side"}</button>
          ))}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        <Diff from={v.body} to={note.body} mode={mode} />
      </div>
    </div>
  );
}

/** Phone: full-screen sheet with version cards, the diff, Copy + Restore. */
function PhoneVersions({ note }: { note: Note }) {
  const { live, deltas } = useVersions(note);
  const [selId, setSelId] = useState<string | null>(null);
  const sel = live.find((v) => v.id === selId) ?? live[0] ?? null;
  return (
    <div className="safe-t safe-b fixed inset-0 z-40 flex flex-col bg-surface text-[14px] fade-in">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line pl-5 pr-1">
        <div className="flex min-w-0 flex-1 flex-col"><span className="text-[17px] font-[650]">Version history</span><span className="truncate text-[12px] text-muted">{note.title} · {live.length} version{live.length === 1 ? "" : "s"}</span></div>
        <button aria-label="Close" onClick={() => setUI({ panel: null })} className="flex size-12 items-center justify-center"><X size={20} /></button>
      </div>
      {live.length ? (
        <>
          <div className="flex shrink-0 gap-2 overflow-x-auto px-4 py-3">
            {live.map((v, i) => (
              <button key={v.id} onClick={() => setSelId(v.id)} className={cx("box-border flex w-[150px] shrink-0 flex-col gap-1 rounded-[12px] bg-bg px-3 py-2.5 text-left", v.id === sel?.id ? "border-[1.5px] border-accent" : "border border-line")}>
                <span className="truncate text-[13.5px] font-semibold leading-[18px]">{sameDay(v.createdAt, Date.now() - 86400000) ? "Yesterday" : when(v.createdAt)}</span>
                <span className="truncate text-[12px] leading-[15px] text-muted">{labelOf(v).replace(/[“”]/g, "")}</span>
                <span className="font-mono text-[11.5px] font-medium leading-[15px]"><span className="text-ok">{deltas[i].add ? `+${fmt(deltas[i].add)}` : ""}</span> <span className="text-bad">{deltas[i].del ? `−${fmt(deltas[i].del)}` : ""}</span></span>
              </button>
            ))}
          </div>
          <div className="mx-4 min-h-0 flex-1 overflow-auto rounded-[12px] border border-line bg-bg">{sel && <Diff from={sel.body} to={note.body} mode="phone" />}</div>
          <div className="flex shrink-0 gap-2.5 px-4 py-3">
            <button aria-label="Copy this version" onClick={() => sel && copy(sel.body)} className="flex size-[52px] items-center justify-center rounded-[12px] border border-line"><Copy size={18} /></button>
            <button onClick={async () => { if (sel) { await restore(note, sel, live); setUI({ panel: null }); } }} className="flex h-[52px] flex-1 items-center justify-center rounded-[12px] bg-accent text-[15px] font-semibold text-accent-fg">Restore as new version</button>
          </div>
        </>
      ) : <p className="p-5 text-[13px] text-muted">No versions yet. They are saved automatically while you write (every 2 min at most).</p>}
    </div>
  );
}

type DiffRow = { kind: "ctx" | "add" | "del" | "fold"; text: string; a?: number; b?: number; id?: number; n?: number };
function diffRows(from: string, to: string): DiffRow[] {
  const out: DiffRow[] = [];
  let a = 1, b = 1, fold = 0;
  const parts = diffLines(from, to);
  parts.forEach((p, pi) => {
    const lines = p.value.replace(/\n$/, "").split("\n");
    if (p.added) { for (const l of lines) out.push({ kind: "add", text: l, b: b++ }); return; }
    if (p.removed) { for (const l of lines) out.push({ kind: "del", text: l, a: a++ }); return; }
    // Unchanged run: keep 1 line of context on each side of a change, collapse the middle.
    const keepHead = pi > 0 ? 1 : 0, keepTail = pi < parts.length - 1 ? 1 : 0;
    if (lines.length > keepHead + keepTail + 2) {
      for (const l of lines.slice(0, keepHead)) out.push({ kind: "ctx", text: l, a: a++, b: b++ });
      const mid = lines.slice(keepHead, lines.length - keepTail);
      const id = fold++;
      out.push({ kind: "fold", text: `⋯  ${mid.length} unchanged lines`, id, n: mid.length });
      for (const l of mid) out.push({ kind: "ctx", text: l, a: a++, b: b++, id });
      for (const l of lines.slice(lines.length - keepTail)) out.push({ kind: "ctx", text: l, a: a++, b: b++ });
    } else for (const l of lines) out.push({ kind: "ctx", text: l, a: a++, b: b++ });
  });
  return out;
}
const BG = { add: "color-mix(in srgb,var(--success) 13%,transparent)", del: "color-mix(in srgb,var(--danger) 13%,transparent)", fold: "var(--surface)", ctx: "transparent" };
const NUM = "shrink-0 select-none pr-2 text-right text-[11px] text-muted opacity-60";

function Diff({ from, to, mode }: { from: string; to: string; mode: "inline" | "side" | "phone" }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const rows = useMemo(() => diffRows(from, to), [from, to]);
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const visible = rows.filter((r) => !(r.kind === "ctx" && r.id !== undefined && !open.has(r.id)));
  const foldRow = (r: DiffRow, key: number | string) => (
    <button key={key} onClick={() => toggle(r.id!)} className="flex w-full items-center pl-[110px] text-left font-sans text-[12px] text-muted hover:text-ink" style={{ background: BG.fold, paddingLeft: mode === "phone" ? 22 : mode === "side" ? 52 : 110 }}>
      {open.has(r.id!) ? `▾  hide ${r.n} unchanged lines` : r.text}
    </button>
  );
  const same = !rows.some((r) => r.kind === "add" || r.kind === "del");
  const sign = (k: DiffRow["kind"]) => <span className={cx("w-[22px] shrink-0 select-none text-center", k === "add" ? "text-ok" : k === "del" ? "text-bad" : "")}>{k === "add" ? "+" : k === "del" ? "−" : ""}</span>;

  if (mode === "side") {
    // Pair deletions with additions in each changed run; context sits on both sides.
    type Pair = { l?: DiffRow; r?: DiffRow; fold?: DiffRow };
    const pairs: Pair[] = [];
    for (let i = 0; i < visible.length;) {
      const r = visible[i];
      if (r.kind === "fold") { pairs.push({ fold: r }); i++; continue; }
      if (r.kind === "ctx") { pairs.push({ l: r, r }); i++; continue; }
      const dels: DiffRow[] = [], adds: DiffRow[] = [];
      while (i < visible.length && (visible[i].kind === "del" || visible[i].kind === "add")) { (visible[i].kind === "del" ? dels : adds).push(visible[i]); i++; }
      for (let j = 0; j < Math.max(dels.length, adds.length); j++) pairs.push({ l: dels[j], r: adds[j] });
    }
    const cell = (r: DiffRow | undefined, side: "a" | "b") => (
      <div className="flex min-w-0" style={{ background: r ? BG[r.kind] : "color-mix(in srgb,var(--surface) 60%,transparent)" }}>
        <span className={cx(NUM, "w-11")}>{r ? (side === "a" ? r.a : r.b) ?? "" : ""}</span>
        {r && sign(r.kind)}
        <span dir="auto" className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-3">{r?.text || " "}</span>
      </div>
    );
    return (
      <div className="overflow-hidden rounded-[10px] border border-line font-mono text-[13px] leading-6">
        {pairs.map((p, i) => p.fold ? foldRow(p.fold, i) : (
          <div key={i} className="grid grid-cols-2 [&>div:first-child]:border-r [&>div:first-child]:border-line">{cell(p.l, "a")}{cell(p.r, "b")}</div>
        ))}
        {same && <div className="px-3 py-2 font-sans text-[12px] text-muted">Identical to the current note.</div>}
      </div>
    );
  }
  const phone = mode === "phone";
  return (
    <div className={cx("overflow-hidden font-mono", phone ? "text-[12.5px] leading-6" : "rounded-[10px] border border-line text-[13px] leading-6")}>
      <div className={phone ? "" : "overflow-x-auto"}>
        {visible.map((r, i) => r.kind === "fold" ? foldRow(r, i) : (
          <div key={i} className={cx("flex", phone ? "pr-2.5" : "min-w-max")} style={{ background: BG[r.kind] }}>
            {!phone && <><span className={cx(NUM, "w-11")}>{r.a ?? ""}</span><span className={cx(NUM, "w-11")}>{r.b ?? ""}</span></>}
            {sign(r.kind)}
            <span dir="auto" className={cx("flex-1 pr-3", phone ? "whitespace-pre-wrap break-words" : "whitespace-pre")}>{r.text || " "}</span>
          </div>
        ))}
        {same && <div className="px-3 py-2 font-sans text-[12px] text-muted">Identical to the current note.</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ AI assist
type AiAction = "summarize" | "flashcards" | "explain" | "tags";
const AI_ACTIONS: { id: AiAction; label: string; icon: ReactNode }[] = [
  { id: "summarize", label: "Summarize", icon: <AlignLeft size={15} /> },
  { id: "flashcards", label: "Generate flashcards", icon: <Layers size={15} /> },
  { id: "explain", label: "Explain selection", icon: <MessageCircleQuestion size={15} /> },
  { id: "tags", label: "Suggest tags", icon: <Hash size={15} /> },
];
const selectedText = () => getSelectionText() || (typeof getSelection === "function" ? getSelection()?.toString() ?? "" : "");
const parseCards = (t: string) => t.split("\n").map((l) => /^\s*(?:[-*\d.)]+\s*)?(.+?)\s*::\s*(.+)$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ q: m[1].replace(/\*\*/g, ""), a: m[2] }));
const parseTags = (t: string) => [...new Set((t.match(/#?[\p{L}\p{N}][\p{L}\p{N}_/-]*/gu) ?? []).map((x) => x.replace(/^#/, "").toLowerCase()))].slice(0, 8);

/** Append flashcards under a "## Flashcards" heading (created if missing) so Review picks them up. */
function withCards(body: string, cards: { q: string; a: string }[]) {
  const lines = cards.map((c) => `${c.q} :: ${c.a}`);
  const m = /^##\s+Flashcards\s*$/im.exec(body);
  if (!m) return `${body.replace(/\s*$/, "")}\n\n## Flashcards\n\n${lines.join("\n")}\n`;
  const start = m.index + m[0].length;
  const next = body.slice(start).search(/\n#{1,2}\s/);
  const end = next < 0 ? body.length : start + next;
  return `${body.slice(0, end).replace(/\s*$/, "")}\n${lines.join("\n")}\n${body.slice(end)}`;
}

function AI({ note }: { note: Note }) {
  const [res, setRes] = useState<{ action: AiAction; text: string; from: "whole note" | "selection" } | null>(null);
  const [busy, setBusy] = useState<AiAction | null>(null);
  const [hasSel, setHasSel] = useState(() => !!selectedText().trim());
  useEffect(() => {
    const f = () => setHasSel(!!selectedText().trim());
    document.addEventListener("selectionchange", f);
    document.addEventListener("keyup", f);
    return () => { document.removeEventListener("selectionchange", f); document.removeEventListener("keyup", f); };
  }, []);
  const token = !!getToken();
  const active: AiAction = busy ?? res?.action ?? (hasSel ? "explain" : "flashcards");

  async function run(id: AiAction) {
    if (!getToken()) return toast("AI needs sync: unlock it in Settings → Sync.");
    const sel = selectedText().trim();
    const useSel = !!sel && (id === "explain" || id === "summarize" || id === "flashcards");
    const text = useSel ? sel : splitFrontMatter(note.body).body;
    if (!text.trim()) return toast("Note is empty");
    setBusy(id);
    try { setRes({ action: id, text: await aiRun(id, text), from: useSel ? "selection" : "whole note" }); } catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  }
  // Palette → "Generate flashcards from …" opens this tab and runs it once.
  useEffect(() => {
    try {
      const r = JSON.parse(sessionStorage.getItem("lumen.aiAuto") ?? "null") as { id: string; action: AiAction } | null;
      if (r?.id === note.id) { sessionStorage.removeItem("lumen.aiAuto"); void run(r.action); }
    } catch { /* ignore */ }
  }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cards = res?.action === "flashcards" ? parseCards(res.text) : [];
  const tags = res?.action === "tags" ? parseTags(res.text) : [];
  const meta = res && ({
    summarize: { icon: <AlignLeft size={14} className="text-info" />, title: "Summary" },
    flashcards: { icon: <Layers size={14} className="text-learn" />, title: `${cards.length} flashcard${cards.length === 1 ? "" : "s"}` },
    explain: { icon: <MessageCircleQuestion size={14} className="text-info" />, title: "Explanation" },
    tags: { icon: <Hash size={14} className="text-link" />, title: `${tags.length} tag${tags.length === 1 ? "" : "s"}` },
  })[res.action];
  const insert = () => {
    if (!res) return;
    if (res.action === "tags") { void updateNote(note.id, { tags: [...new Set([...note.tags, ...tags])] }); toast(`Added ${tags.length} tags`); return; }
    if (res.action === "flashcards" && cards.length) { void updateNote(note.id, { body: withCards(note.body, cards) }); toast(`${cards.length} flashcards added under “Flashcards”`); return; }
    const block = "\n\n" + res.text.trim() + "\n";
    if (!insertText(block, "end")) void updateNote(note.id, { body: note.body.replace(/\s*$/, "") + block });
  };

  return (
    <div className="flex flex-col gap-3 p-3.5">
      <div className="grid grid-cols-2 gap-2">
        {AI_ACTIONS.map((a) => {
          const on = a.id === active;
          return (
            <button key={a.id} onClick={() => run(a.id)} disabled={!!busy}
              className={cx("flex h-14 items-center gap-2.5 rounded-[10px] border px-3 text-left leading-tight disabled:cursor-wait", on ? "border-learn bg-[color-mix(in_srgb,var(--learn)_10%,transparent)] font-semibold" : "border-line hover:bg-surface-2")}>
              <span className={cx("shrink-0", on ? "text-learn" : "text-muted")}>{busy === a.id ? <Loader2 size={15} className="animate-spin" /> : a.icon}</span>{a.label}
            </button>
          );
        })}
      </div>
      {res && meta && (
        <div className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-surface-2 fade-in">
          <div className="flex items-center gap-2 border-b border-line px-3.5 py-3">{meta.icon}<span className="flex-1 font-semibold">{meta.title}</span><span className="text-[12px] text-muted">from {res.from}</span></div>
          {res.action === "flashcards" && cards.length ? cards.map((c, i) => (
            <div key={i} className="flex flex-col gap-[3px] border-b border-line px-3.5 py-2.5 text-[12.5px] leading-[18px]"><span dir="auto" className="font-medium">{c.q}</span><span dir="auto" className="text-muted">:: {c.a}</span></div>
          )) : res.action === "tags" ? (
            <div className="flex flex-wrap gap-1.5 border-b border-line px-3.5 py-3">{tags.map((t) => <span key={t} className={cx("rounded-full px-2 py-0.5 text-[12px]", note.tags.includes(t) ? "bg-surface text-muted" : "bg-[color-mix(in_srgb,var(--link)_14%,transparent)] text-link")}>#{t}</span>)}</div>
          ) : (
            <div className="max-h-[50vh] overflow-y-auto border-b border-line px-3.5 py-2.5"><Preview note={{ id: note.id, body: res.text, spaceId: note.spaceId }} className="!text-[13px]" /></div>
          )}
          <div className="flex gap-2 px-3.5 py-3">
            <button onClick={insert} className="flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-accent font-semibold text-accent-fg hover:brightness-110"><ArrowDownToLine size={14} />{res.action === "tags" ? "Add tags" : "Insert below"}</button>
            <button onClick={() => copy(res.text)} className="flex h-[34px] items-center gap-1.5 rounded-[10px] border border-line px-3 hover:bg-surface"><Copy size={13} />Copy</button>
            <button aria-label="Regenerate" title="Regenerate" onClick={() => run(res.action)} disabled={!!busy} className="flex size-[34px] items-center justify-center rounded-[10px] border border-line hover:bg-surface"><RefreshCw size={13} className={busy ? "animate-spin" : ""} /></button>
          </div>
        </div>
      )}
      <span className="text-[12px] leading-[18px] text-muted">
        {token ? "Runs on Cloudflare Workers AI. Only this note's text is sent; nothing is stored. Results are never inserted without your click." : "Runs on Cloudflare Workers AI once sync is unlocked (Settings → Sync). Only this note's text is sent; nothing is stored."}
      </span>
    </div>
  );
}
