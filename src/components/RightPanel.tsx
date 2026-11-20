import { diffLines } from "diff";
import { FolderGroups } from "./grouped-links"; // Lumen 22: backlinks over 20 group by folder
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowRight, BookOpen, Calendar, ChevronDown, ChevronRight, CircleDot, Copy, Gauge, Hash,
  History, Link, Link2, ListTree, Plus, SlidersHorizontal, Tag, Text, Timer, Trash2, X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { NOTE_TYPES, STATUSES, type Note, type Version } from "../../shared/types";
import { snapshot, updateNote } from "../lib/actions";
import { db } from "../lib/db";
import { inlineTags, outline, setFrontMatter, splitFrontMatter } from "../lib/parse";
import { noteDerived, openNote, setUI, toast, useUI, useVault, type Panel } from "../lib/store";
import { aliasesOf, findMentions, ignoredOf, linkMentions, mayMention, normalizeTerm, PROSE_TYPES, relocate, type Mention } from "../lib/mentions";
import { normalize } from "../lib/search";
import { scrollEditorToLine } from "./Editor";
import { AssistantPanel, AssistantRail, toggleAssistantRail, useAssistantRail } from "./Assistant";
import { Glyph } from "./Glyph";
import { HistoryPanel } from "./HistoryPanel";
import { NoteTagPicker } from "./TagPicker";
import { Button, cx, STATUS_COLOR } from "./ui";
import { digits, fmtDate, fmtNum, t, tk, tx } from "../lib/i18n";

const SECTION = "px-1 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted";

const TABS: { value: Exclude<Panel, null>; label: string; icon: ReactNode }[] = [
  { value: "outline", label: tk("Outline"), icon: <ListTree size={15} /> },
  { value: "backlinks", label: tk("Links"), icon: <Link2 size={15} /> },
  { value: "properties", label: tk("Properties"), icon: <SlidersHorizontal size={15} /> },
  { value: "versions", label: tk("Versions"), icon: <History size={15} /> },
  { value: "ai", label: tk("Assistant"), icon: <Glyph name="assistant" size={15} /> },
];
const useWidth = () => { const [w, setW] = useState(() => innerWidth); useEffect(() => { const f = () => setW(innerWidth); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return w; };

export function RightPanel({ note }: { note: Note }) {
  const { panel } = useUI();
  const phone = useWidth() < 768;
  const railed = useAssistantRail();
  if (!panel) return null;
  // AI = the note Assistant (R6-31M…T): 360 px panel, phone sheet, or the collapsed rail
  if (panel === "ai") return railed && !phone ? <AssistantRail /> : <AssistantPanel note={note} phone={phone} />;
  if (panel === "versions" && phone) return <PhoneVersions note={note} />;
  return (
    <aside className={cx("fixed inset-0 z-40 flex flex-col bg-surface text-[13px] md:static md:z-auto md:shrink-0 md:border-s md:border-line fade-in", panel === "versions" ? "md:w-[320px]" : "md:w-[300px]")}>
      {/* Icon tabs; the active one expands to icon + label */}
      <div className="safe-t flex h-12 shrink-0 items-center gap-0.5 border-b border-line px-2">
        <div role="tablist" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {TABS.map((tab) => {
            const on = panel === tab.value;
            return (
              <button key={tab.value} role="tab" aria-selected={on} title={t(tab.label)} aria-label={t(tab.label)} onClick={() => (tab.value === "ai" ? toggleAssistantRail(false) : setUI({ panel: tab.value }))}
                className={cx("flex h-[30px] items-center justify-center gap-1.5 rounded-[6px]", on ? "min-w-0 bg-surface-2 px-2.5 font-semibold text-ink [&>svg]:shrink-0 [&>svg]:text-accent" : "w-8 shrink-0 text-muted hover:bg-surface-2 hover:text-ink")}>
                {tab.icon}{on && <span className="truncate">{t(tab.label)}</span>}
              </button>
            );
          })}
        </div>
        <button aria-label={t("Close panel")} title={t("Close panel")} className="flex size-8 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-ink" onClick={() => setUI({ panel: null })}><X size={16} /></button>
      </div>
      <div className={cx("min-h-0 flex-1 overflow-y-auto", panel === "versions" || panel === "properties" ? "" : "p-3")}>
        {panel === "outline" && <Outline note={note} />}
        {panel === "backlinks" && <Backlinks note={note} />}
        {panel === "properties" && <Properties note={note} />}
        {panel === "versions" && <HistoryPanel note={note} />}
      </div>
    </aside>
  );
}

function Outline({ note }: { note: Note }) {
  const hs = useMemo(() => outline(note.body), [note.body]);
  const [jump, setJump] = useState("");
  const [folded, setFolded] = useState(false);
  if (!hs.length) return <p className="px-1 text-[13px] text-muted">{tx("No headings yet. Use {h1}, {h2}, {h3}.", { h1: <code>#</code>, h2: <code>##</code>, h3: <code>###</code> })}</p>;
  const min = Math.min(...hs.map((h) => h.level));
  // Lumen 22 long notes: Collapse all (folds every section in Read mode) + Jump to section… past 12 headings.
  const shown = jump.trim() ? hs.filter((h) => h.text.toLowerCase().includes(jump.trim().toLowerCase())) : hs;
  return (
    <nav className="flex flex-col gap-px">
      <div className={cx(SECTION, "flex items-center")}><span className="flex-1">{t("Outline · {n}", { n: hs.length })}</span>
        {hs.length > 12 && <button onClick={() => { const f = !folded; setFolded(f); dispatchEvent(new CustomEvent("lumen:fold-all", { detail: { fold: f } })); }} className="normal-case tracking-normal text-[12px] font-normal text-muted hover:text-ink">{folded ? t("Expand all") : t("Collapse all")}</button>}
      </div>
      {hs.length > 12 && <input value={jump} onChange={(e) => setJump(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) { scrollEditorToLine(shown[0].line); document.querySelector(`.prose [data-line="${shown[0].line}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }); } }}
        placeholder={t("Jump to section…")} aria-label={t("Jump to section…")} className="mb-1.5 h-7 rounded-[6px] border border-line bg-bg px-2 text-[12.5px] outline-none placeholder:text-muted focus:border-accent" />}
      {shown.map((h) => (
        <button key={h.line} dir="auto" onClick={() => { scrollEditorToLine(h.line); document.querySelector(`.prose [data-line="${h.line}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
          title={h.text} className={cx("relative line-clamp-3 w-full rounded-[8px] py-1.5 pe-2 text-start text-[13px] hover:bg-surface-2 hover:text-ink", h.level === min ? "font-medium text-ink" : "text-muted")}
          style={{ paddingInlineStart: 10 + (h.level - min) * 14 }}>
          {h.level > min && <span className="absolute bottom-1 top-1 w-px bg-line" style={{ insetInlineStart: 4 + (h.level - min) * 14 }} />}
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
  // 20b D6: section label, then plain titles (folder / space in the tooltip)
  const List = ({ title, items, top }: { title: string; items: Note[]; top?: boolean }) => (
    <div className={cx("flex flex-col gap-2 px-0.5 py-2.5", top && "border-t border-line")} data-links={title}>
      <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t("{title} · {n}", { title, n: items.length })}</div>
      {items.length ? <FolderGroups notes={items} item={(n) => (
        <button key={n.id} dir="auto" data-dnd-note={n.id} draggable onClick={() => openNote(n.id)} title={v.folderMap.get(n.folderId ?? "")?.name ?? v.spaceMap.get(n.spaceId)?.name ?? ""}
          className="-mx-1.5 truncate rounded-[6px] px-1.5 text-start text-[13px] font-medium hover:bg-surface-2">{n.title}</button>
      )} /> : <div className="text-[12.5px] text-muted">{t("None")}</div>}
    </div>
  );
  return (<div className="-mt-2.5"><List title={t("Linked mentions")} items={back} /><UnlinkedMentions note={note} /><List title={t("Links out")} items={out} top /></div>);
}

// ------------------------------------------------------------------ unlinked mentions (design 04 §D6; logic in lib/mentions.ts)
type MentionGroup = { src: Note; ms: Mention[] };
const NON_MD = ["canvas", "whiteboard", "board", "diagram"];
function UnlinkedMentions({ note }: { note: Note }) {
  const v = useVault();
  const [confirm, setConfirm] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  const fm = useMemo(() => (NON_MD.includes(note.type) ? {} : splitFrontMatter(note.body).data), [note.body, note.type]);
  const terms = useMemo(() => (note.title && note.title !== "Untitled" ? [note.title, ...aliasesOf(fm.aliases, note.props.aliases)] : []), [note.title, fm.aliases, note.props.aliases]);
  const ignoreRaw = fm["mentions-ignore"] ?? note.props["mentions-ignore"];
  const ignored = useMemo(() => new Set(ignoredOf(ignoreRaw).map((t) => t.toLowerCase())), [ignoreRaw]);
  // Pre-filter on a cached normalized body (re-normalized only when that note changes), then mask + match the few candidates.
  const groups = useMemo<MentionGroup[]>(() => {
    const nt = terms.map(normalizeTerm).filter((t) => t.length >= 3);
    if (!nt.length) return [];
    const out: MentionGroup[] = [];
    for (const n of v.notes) {
      if (n.id === note.id || !PROSE_TYPES.has(n.type)) continue;
      if (!mayMention(noteDerived("mentionNorm", n, (x) => normalize(x.body)), nt)) continue;
      const ms = findMentions(n.body, terms);
      if (ms.length) out.push({ src: n, ms });
    }
    return out.sort((a, b) => b.ms.length - a.ms.length || b.src.updatedAt - a.src.updatedAt);
  }, [v.notes, note.id, terms]);
  const shown = groups.filter((g) => !ignored.has(g.src.title.toLowerCase()));
  const hidden = groups.filter((g) => ignored.has(g.src.title.toLowerCase()));
  const total = shown.reduce((a, g) => a + g.ms.length, 0);

  /** Rewrite mentions in each source note (re-read from the DB, re-located if it changed), with one Undo for the batch. */
  async function link(items: MentionGroup[]) {
    const undo: { id: string; before: string; after: string }[] = [];
    let count = 0;
    for (const { src, ms } of items) {
      const cur = await db.notes.get(src.id);
      if (!cur) continue;
      const all = findMentions(src.body, terms);
      const fresh = cur.body === src.body ? ms : ms.map((m) => relocate(cur.body, terms, m, all.filter((x) => x.text === m.text).findIndex((x) => x.start === m.start))).filter((m): m is Mention => !!m);
      const body = linkMentions(cur.body, fresh, note.title);
      if (body === cur.body) continue;
      count += fresh.length;
      undo.push({ id: cur.id, before: cur.body, after: body });
      await updateNote(cur.id, { body });
    }
    if (!count) return void toast(t("Nothing to link: the text changed"), undefined, { icon: "info" });
    toast(t("Linked {n} mention in {notes}|Linked {n} mentions in {notes}", { n: count, notes: t("{n} note|{n} notes", { n: undo.length }) }), {
      label: t("Undo"),
      run: async () => {
        for (const u of undo) { const cur = await db.notes.get(u.id); if (cur && cur.body === u.after) await updateNote(u.id, { body: u.before }); }
        toast(t("Links removed"), undefined, { icon: "check" });
      },
    }, { icon: "link" });
  }
  /** The ignore list lives on this note: front-matter `mentions-ignore: [Source title, …]` (record props for non-Markdown notes). */
  async function setIgnored(title: string, on: boolean) {
    const list = ignoredOf(ignoreRaw).filter((t) => t.toLowerCase() !== title.toLowerCase());
    if (on) list.push(title.replace(/[,[\]]/g, " ").trim());
    if (NON_MD.includes(note.type)) {
      const props = { ...note.props };
      if (list.length) props["mentions-ignore"] = `[${list.join(", ")}]`; else delete props["mentions-ignore"];
      return void updateNote(note.id, { props });
    }
    const cur = (await db.notes.get(note.id))?.body ?? note.body;
    await updateNote(note.id, { body: setFrontMatter(cur, { "mentions-ignore": list.length ? list : null }) });
  }

  // 20b D6: source title, then the sentence in the reading serif with the mention underlined (dashed, link colour) and "Link"
  const Group = ({ g, muted }: { g: MentionGroup; muted?: boolean }) => (
    <div className={cx("group/m flex flex-col gap-1", muted && "opacity-60")}>
      <div className="flex items-center gap-1.5">
        <button dir="auto" data-dnd-note={g.src.id} draggable onClick={() => openNote(g.src.id)} className="min-w-0 flex-1 truncate text-start text-[13px] font-medium hover:underline">{g.src.title}</button>
        <button onClick={() => void setIgnored(g.src.title, !muted)} title={muted ? t("Show this note's mentions again") : t("Hide this note's mentions")} className={cx("shrink-0 text-[11.5px] text-muted hover:text-ink", !muted && "opacity-0 focus:opacity-100 group-hover/m:opacity-100 max-md:opacity-100")}>{muted ? "Unignore" : "Ignore"}</button>
      </div>
      {!muted && g.ms.map((m, i) => (
        <span key={i} dir="auto" className="break-words text-[14px] leading-5 text-muted" style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}>
          {m.before}<mark className="bg-transparent text-ink" style={{ borderBottom: "1.5px dashed var(--link)" }}>{m.match}</mark>{m.after}
          <button onClick={() => void link([{ src: g.src, ms: [m] }])} title={t("Link to “{title}”", { title: note.title })} className="ms-1.5 font-sans text-[12px] text-link hover:underline">{t("Link@@verb")}</button>
        </span>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-2.5 border-t border-line px-0.5 py-2.5" data-mentions>
      <div className="flex items-center">
        <div className="flex-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t("Unlinked mentions · {n}", { n: total })}</div>
        {total > 0 && !confirm && <button onClick={() => setConfirm(true)} className="flex h-[26px] items-center rounded-[7px] border border-line px-2.5 text-[12px] hover:bg-surface-2">{t("Link all")}</button>}
      </div>
      {confirm && (
        <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface-2 p-2.5 text-[12.5px]">
          <span>{tx("Link {n} mention in {notes} to “{title}”? You can undo it.|Link {n} mentions in {notes} to “{title}”? You can undo it.", { n: total, notes: t("{n} note|{n} notes", { n: shown.length }), title: <span dir="auto">{note.title}</span> })}</span>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => { setConfirm(false); void link(shown); }}>{t("Link all")}</Button>
            <Button onClick={() => setConfirm(false)}>{t("Cancel")}</Button>
          </div>
        </div>
      )}
      {!terms.length ? <div className="text-[12.5px] text-muted">{t("Give this note a title to find mentions.")}</div>
        : shown.length ? shown.map((g) => <Group key={g.src.id} g={g} />) : <div className="text-[12.5px] text-muted">{t("None")}</div>}
      {hidden.length > 0 && (
        <div className="flex flex-col gap-2">
          <button onClick={() => setShowIgnored((s) => !s)} className="flex h-7 items-center gap-1 text-[12px] text-muted hover:text-ink">
            {showIgnored ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{t("{n} ignored note|{n} ignored notes", { n: hidden.length })}
          </button>
          {showIgnored && hidden.map((g) => <Group key={g.src.id} g={g} muted />)}
        </div>
      )}
    </div>
  );
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
/** Display labels for status / type values (the stored values stay English). */
const VAL_L: Record<string, string> = { todo: tk("To do"), learning: tk("Learning"), review: tk("Review"), mastered: tk("Mastered"), none: tk("None"), note: tk("Note"), lesson: tk("Lesson"), journal: tk("Journal"), flashcards: tk("Flashcards"), slides: tk("Slides"), post: tk("Post"), canvas: tk("Canvas"), whiteboard: tk("Whiteboard"), board: tk("Board"), roadmap: tk("Roadmap"), moc: tk("Map of content"), path: tk("Path"), diagram: tk("Diagram"), base: tk("Base"), pdf: tk("PDF"), dashboard: tk("Dashboard") };
const valLabel = (s: string) => (VAL_L[s] ? t(VAL_L[s]) : cap(s));
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function parseDate(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t);
}
function showDate(v: string) {
  const d = parseDate(v);
  if (!d) return { label: v, c: "var(--text)" };
  const days = Math.round((d.getTime() - new Date(ymd(new Date()) + "T00:00").getTime()) / 86400000);
  // "Wed 19 Nov" (year only when it isn't this year)
  const label = days === 0 ? t("Today") : days === 1 ? t("Tomorrow") : fmtDate(d, { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  return { label, c: days < 0 ? "var(--danger)" : days <= 7 ? "var(--warning)" : "var(--text)" };
}
const studiedText = (min: number) => (min >= 60 ? t("{h} h {m} min", { h: Math.floor(min / 60), m: digits(String(min % 60).padStart(2, "0")) }) : t("{n} min", { n: min }));

function Properties({ note }: { note: Note }) {
  const v = useVault();
  const sessions = useLiveQuery(() => db.sessions.where("noteId").equals(note.id).toArray(), [note.id]) ?? [];
  const minutes = sessions.filter((s) => !s.deleted).reduce((a, s) => a + s.minutes, 0);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [adv, setAdv] = useState(false);
  const md = !["canvas", "whiteboard", "board", "diagram"].includes(note.type);

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
    <button onClick={() => setEditing(id)} className="min-w-0 flex-1 truncate py-2 text-start" style={{ color }}>{content}</button>
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
      {opts.map((o) => <button key={o} onClick={() => { onPick(o); setEditing(null); }} className={cx("h-6 rounded-full border px-2 text-[12px] capitalize", o === cur ? "border-accent text-ink" : "border-line text-muted hover:text-ink")}>{valLabel(o)}</button>)}
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
          return <Row key={k} id={id} k={k} icon={iconFor(k, kind)} edit={<TextEdit type="date" init={parseDate(val) ? ymd(parseDate(val)!) : ""} onDone={(x) => setProp(k, x)} />}>{valBtn(id, d.label, d.c)}<RemoveBtn onClick={() => setProp(k, null)} /></Row>;
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
        return <Row key={k} id={id} k={k} icon={iconFor(k, kind)} edit={<TextEdit init={val} onDone={(x) => setProp(k, x)} />}>{valBtn(id, val || <span className="text-muted">{t("Empty")}</span>)}<RemoveBtn onClick={() => setProp(k, null)} /></Row>;
      })}
      {md || note.status ? (
        <Row id="status" k="status" icon={<CircleDot size={13} />} edit={<Chips opts={[...STATUSES, "none"]} cur={note.status ?? "none"} onPick={(s) => void updateNote(note.id, { status: s === "none" ? null : (s as Note["status"]) })} />}>
          {valBtn("status", note.status ? valLabel(note.status) : <span className="text-muted">{t("None")}</span>, note.status ? STATUS_COLOR[note.status] : undefined)}
        </Row>
      ) : null}
      <Row id="type" k="type" icon={<Tag size={13} />} edit={<Chips opts={NOTE_TYPES.filter((t) => md ? !["canvas", "whiteboard", "board", "diagram"].includes(t) : t === note.type)} cur={note.type} onPick={(t) => void updateNote(note.id, { type: t as Note["type"] })} />}>
        {valBtn("type", valLabel(note.type))}
      </Row>
      <Row id="tags" k="tags" icon={<Hash size={13} />} edit={<NoteTagPicker note={note} onDone={() => setEditing(null)} />}>
        {valBtn("tags", note.tags.length ? note.tags.map((t) => `#${t}`).join("  ") : t("Add tags"), "var(--muted)")}
      </Row>
      <Row id="studied" k="studied" icon={<Timer size={13} />}><span className="flex-1 truncate py-2" title={t("Study-timer minutes logged to this note")}>{studiedText(minutes)}</span></Row>

      {adding ? (
        <AddProp existing={Object.keys(note.props)} onAdd={(k, val) => { setProp(k, val || (kindOf(k, "") === "date" ? ymd(new Date()) : kindOf(k, "") === "dots" ? "3" : "")); setAdding(false); if (!val && kindOf(k, "") !== "dots") setEditing("p:" + k); }} onCancel={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} className="flex items-center gap-2 rounded-[6px] px-1.5 py-2.5 text-start text-muted hover:text-ink"><Plus size={13} />{t("Add property")}</button>
      )}

      <div className="mt-1.5 border-t border-line px-1.5 pt-2.5">
        <button onClick={() => setAdv((a) => !a)} className="flex w-full items-center gap-1.5 text-start text-[12px] text-muted hover:text-ink">
          {adv ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{t("Advanced · id, created, aliases, cssclass")}
        </button>
        {adv && (
          <div className="mt-2 flex flex-col gap-0.5">
            <div className="grid min-h-8 grid-cols-[104px_1fr] items-center gap-2 text-[12.5px]"><span className="text-muted">id</span><span className="truncate font-mono text-[11.5px]" title={note.id}>{note.id}</span></div>
            <div className="grid min-h-8 grid-cols-[104px_1fr] items-center gap-2 text-[12.5px]"><span className="text-muted">created</span><span>{fmtDate(note.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span></div>
            <div className="grid min-h-8 grid-cols-[104px_1fr] items-center gap-2 text-[12.5px]"><span className="text-muted">updated</span><span>{fmtDate(note.updatedAt, { dateStyle: "medium", timeStyle: "short" })}</span></div>
            {["aliases", "cssclass"].map((k) => (
              <div key={k} className="grid min-h-8 grid-cols-[104px_1fr] items-center gap-2 text-[12.5px]">
                <span className="text-muted">{k}</span>
                <input defaultValue={note.props[k] ?? ""} key={note.props[k] ?? ""} placeholder={k === "aliases" ? t("Other names, comma separated") : t("css class for export")} onBlur={(e) => e.target.value !== (note.props[k] ?? "") && setProp(k, e.target.value.trim() || null)}
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
  return <button aria-label={t("Remove property")} title={t("Remove")} onClick={onClick} className="ms-1 hidden size-6 shrink-0 items-center justify-center rounded-[6px] text-muted hover:text-bad group-hover:flex"><Trash2 size={12} /></button>;
}
function EditBtn({ onClick }: { onClick: () => void }) {
  return <button aria-label={t("Edit")} title={t("Edit")} onClick={onClick} className="ms-1 hidden h-6 shrink-0 items-center rounded-[6px] px-1.5 text-[11.5px] text-muted hover:text-ink group-hover:flex">{t("Edit")}</button>;
}
const SUGGEST = ["course", "source", "due", "difficulty", "exam", "teacher", "aliases"];
function AddProp({ existing, onAdd, onCancel }: { existing: string[]; onAdd: (k: string, v: string) => void; onCancel: () => void }) {
  const [k, setK] = useState("");
  const [val, setVal] = useState("");
  const kind = kindOf(k, val);
  const submit = () => { const key = k.trim().toLowerCase().replace(/\s+/g, "-"); if (key && !existing.includes(key)) onAdd(key, val.trim()); else if (!key) onCancel(); else toast(t("“{key}” already exists", { key })); };
  return (
    <form className="flex flex-col gap-1.5 rounded-[8px] border border-line bg-bg p-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="flex gap-1.5">
        <input autoFocus list="lumen-prop-keys" value={k} onChange={(e) => setK(e.target.value)} placeholder={t("Name")} onKeyDown={(e) => e.key === "Escape" && onCancel()}
          className="h-7 w-[104px] shrink-0 rounded-[6px] border border-line bg-surface px-2 outline-none focus:border-accent" />
        <input value={val} onChange={(e) => setVal(e.target.value)} type={kind === "date" ? "date" : "text"} placeholder={kind === "dots" ? "1–5" : kind === "url" ? "https://" : t("Value")} onKeyDown={(e) => e.key === "Escape" && onCancel()}
          className="h-7 min-w-0 flex-1 rounded-[6px] border border-line bg-surface px-2 outline-none focus:border-accent" />
      </div>
      <datalist id="lumen-prop-keys">{SUGGEST.filter((s) => !existing.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
      <div className="flex justify-end gap-1.5"><Button size="sm" variant="ghost" type="button" className="h-7" onClick={onCancel}>{t("Cancel")}</Button><Button size="sm" variant="primary" type="submit" className="h-7">{t("Add")}</Button></div>
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
const fmt = (n: number) => fmtNum(n);
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
const hm = (ts: number) => fmtDate(ts, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function when(ts: number) {
  if (sameDay(ts, Date.now())) return hm(ts);
  if (sameDay(ts, Date.now() - 86400000)) return t("Yesterday {time}", { time: hm(ts) });
  const d = new Date(ts);
  // "Mon 10 Nov 20:18"
  return `${fmtDate(d, { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) })} ${hm(ts)}`;
}
/** "Today 21:12" style for labels and the comparing bar. */
const whenLong = (ts: number) => (sameDay(ts, Date.now()) ? t("Today {time}", { time: hm(ts) }) : when(ts));
/** Version labels are stored in English; the known automatic ones are shown translated. */
const storedLabel = (l: string) => (l === "Manual save" || l === "Before restore" || l === "Before keeping the other version" ? t(l) : l.startsWith("Restored from ") ? t("Restored from {when}", { when: l.slice(14) }) : l);
const isRestore = (v: Version) => v.label.startsWith("Restored") || v.label === "Before restore";
const labelOf = (v: Version) => (v.label ? (isRestore(v) || v.label === "Manual save" ? storedLabel(v.label) : `“${v.label}”`) : t("Auto-save"));

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
  toast(t("Restored from {when}", { when: whenLong(v.createdAt) }), { label: t("Undo"), run: () => void updateNote(note.id, before) });
}
const copy = (s: string) => { void navigator.clipboard.writeText(s); toast(t("Copied")); };

/** Full-width diff in the main pane (left of the side panel): Viewing version · read-only. */
export function DiffOverlay({ anchor, note, v, onClose, onRestore }: { anchor: React.RefObject<HTMLDivElement | null>; note: Note; v: Version; onClose: () => void; onRestore: () => void }) {
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
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line pe-4 ps-5">
        {folder && <><span dir="auto" className="truncate text-muted">{folder}</span><ChevronRight size={12} className="shrink-0 text-muted" /></>}
        <span dir="auto" className="truncate font-medium">{v.title}</span>
        <span className="shrink-0 rounded-[6px] bg-surface-2 px-2 text-[12px] leading-[22px] text-muted">{t("Viewing version · read-only")}</span>
        <span className="flex-1" />
        <button onClick={() => copy(v.body)} className="flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border border-line px-3 hover:bg-surface-2"><Copy size={14} />{t("Copy")}</button>
        <button onClick={onRestore} className="flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] bg-accent px-3.5 font-semibold text-accent-fg hover:brightness-110"><History size={14} />{t("Restore as new version")}</button>
      </div>
      <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line px-5 text-muted">
        <span>{t("Comparing")}</span><span className="font-medium text-ink">{whenLong(v.createdAt)}</span><ArrowRight size={13} /><span className="font-medium text-ink">{t("Current")}</span>
        <span className="flex-1" />
        <span className="text-ok">+{fmt(d.add)}</span><span className="text-bad">−{fmt(d.del)}</span>
        <span className="ms-2 flex gap-0.5 rounded-[8px] border border-line bg-surface p-[3px]">
          {(["inline", "side"] as const).map((m) => (
            <button key={m} onClick={() => setM(m)} className={cx("flex h-[22px] items-center rounded-[6px] px-2 text-[12px]", mode === m ? "bg-surface-2 text-ink" : "hover:text-ink")}>{m === "inline" ? t("Inline") : t("Side by side")}</button>
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
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line pe-1 ps-5">
        <div className="flex min-w-0 flex-1 flex-col"><span className="text-[17px] font-[650]">{t("Version history")}</span><span className="truncate text-[12px] text-muted"><span dir="auto">{note.title}</span> · {t("{n} version|{n} versions", { n: live.length })}</span></div>
        <button aria-label={t("Close")} onClick={() => setUI({ panel: null })} className="flex size-12 items-center justify-center"><X size={20} /></button>
      </div>
      {live.length ? (
        <>
          <div className="flex shrink-0 gap-2 overflow-x-auto px-4 py-3">
            {live.map((v, i) => (
              <button key={v.id} onClick={() => setSelId(v.id)} className={cx("box-border flex w-[150px] shrink-0 flex-col gap-1 rounded-[12px] bg-bg px-3 py-2.5 text-start", v.id === sel?.id ? "border-[1.5px] border-accent" : "border border-line")}>
                <span className="truncate text-[13.5px] font-semibold leading-[18px]">{sameDay(v.createdAt, Date.now() - 86400000) ? t("Yesterday") : when(v.createdAt)}</span>
                <span className="truncate text-[12px] leading-[15px] text-muted">{labelOf(v).replace(/[“”]/g, "")}</span>
                <span className="font-mono text-[11.5px] font-medium leading-[15px]"><span className="text-ok">{deltas[i].add ? `+${fmt(deltas[i].add)}` : ""}</span> <span className="text-bad">{deltas[i].del ? `−${fmt(deltas[i].del)}` : ""}</span></span>
              </button>
            ))}
          </div>
          <div className="mx-4 min-h-0 flex-1 overflow-auto rounded-[12px] border border-line bg-bg">{sel && <Diff from={sel.body} to={note.body} mode="phone" />}</div>
          <div className="flex shrink-0 gap-2.5 px-4 py-3">
            <button aria-label={t("Copy this version")} onClick={() => sel && copy(sel.body)} className="flex size-[52px] items-center justify-center rounded-[12px] border border-line"><Copy size={18} /></button>
            <button onClick={async () => { if (sel) { await restore(note, sel, live); setUI({ panel: null }); } }} className="flex h-[52px] flex-1 items-center justify-center rounded-[12px] bg-accent text-[15px] font-semibold text-accent-fg">{t("Restore as new version")}</button>
          </div>
        </>
      ) : <p className="p-5 text-[13px] text-muted">{t("No versions yet. They are saved automatically while you write (every 2 min at most).")}</p>}
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
      out.push({ kind: "fold", text: "⋯  " + t("{n} unchanged line|{n} unchanged lines", { n: mid.length }), id, n: mid.length });
      for (const l of mid) out.push({ kind: "ctx", text: l, a: a++, b: b++, id });
      for (const l of lines.slice(lines.length - keepTail)) out.push({ kind: "ctx", text: l, a: a++, b: b++ });
    } else for (const l of lines) out.push({ kind: "ctx", text: l, a: a++, b: b++ });
  });
  return out;
}
const BG = { add: "color-mix(in srgb,var(--success) 13%,transparent)", del: "color-mix(in srgb,var(--danger) 13%,transparent)", fold: "var(--surface)", ctx: "transparent" };
const NUM = "shrink-0 select-none pe-2 text-end text-[11px] text-muted opacity-60";

function Diff({ from, to, mode }: { from: string; to: string; mode: "inline" | "side" | "phone" }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const rows = useMemo(() => diffRows(from, to), [from, to]);
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const visible = rows.filter((r) => !(r.kind === "ctx" && r.id !== undefined && !open.has(r.id)));
  const foldRow = (r: DiffRow, key: number | string) => (
    <button key={key} onClick={() => toggle(r.id!)} className="flex w-full items-center ps-[110px] text-start font-sans text-[12px] text-muted hover:text-ink" style={{ background: BG.fold, paddingInlineStart: mode === "phone" ? 22 : mode === "side" ? 52 : 110 }}>
      {open.has(r.id!) ? "▾  " + t("hide {n} unchanged line|hide {n} unchanged lines", { n: r.n ?? 0 }) : r.text}
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
        <span dir="auto" className="min-w-0 flex-1 whitespace-pre-wrap break-words pe-3">{r?.text || " "}</span>
      </div>
    );
    return (
      <div className="overflow-hidden rounded-[10px] border border-line font-mono text-[13px] leading-6">
        {pairs.map((p, i) => p.fold ? foldRow(p.fold, i) : (
          <div key={i} className="grid grid-cols-2 [&>div:first-child]:border-e [&>div:first-child]:border-line">{cell(p.l, "a")}{cell(p.r, "b")}</div>
        ))}
        {same && <div className="px-3 py-2 font-sans text-[12px] text-muted">{t("Identical to the current note.")}</div>}
      </div>
    );
  }
  const phone = mode === "phone";
  return (
    <div className={cx("overflow-hidden font-mono", phone ? "text-[12.5px] leading-6" : "rounded-[10px] border border-line text-[13px] leading-6")}>
      <div className={phone ? "" : "overflow-x-auto"}>
        {visible.map((r, i) => r.kind === "fold" ? foldRow(r, i) : (
          <div key={i} className={cx("flex", phone ? "pe-2.5" : "min-w-max")} style={{ background: BG[r.kind] }}>
            {!phone && <><span className={cx(NUM, "w-11")}>{r.a ?? ""}</span><span className={cx(NUM, "w-11")}>{r.b ?? ""}</span></>}
            {sign(r.kind)}
            <span dir="auto" className={cx("flex-1 pe-3", phone ? "whitespace-pre-wrap break-words" : "whitespace-pre")}>{r.text || " "}</span>
          </div>
        ))}
        {same && <div className="px-3 py-2 font-sans text-[12px] text-muted">{t("Identical to the current note.")}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ AI: the note Assistant (round 6, Lumen 31) lives in Assistant.tsx
