import { Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, ViewportPortal, type Connection, type Edge, type Node as RFNode, type NodeProps } from "@xyflow/react";
import { ArrowDown, ArrowUp, Ban, Check, ChevronDown, ChevronRight, Columns2, FileText, GanttChart, GitFork, GripVertical, Link2, ListTree, Lock, Minus, MoveHorizontal, NotebookPen, Plus, Scan, Trash2, X } from "lucide-react";
import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as RPointerEvent } from "react";
import type { Note } from "../../shared/types";
import { createNote, updateNote } from "../lib/actions";
import {
  addModule, addTopic, addTopicNeed, deleteModule, deleteTopic, excerpt, flashcards, linkTopicNote, moveModule, moveTopic, nudgeModule, nudgeTopic, progress, removeTopicNeed,
  renameModule, renameTopic, roadmap, setTopicDue, setTopicNeeds, setTopicStatus, topicBlock, topicLineByName, uniqueTopicName, type Module, type Topic, type TopicStatus,
} from "../lib/parse";
import { openNote, toast, useVault, type Vault } from "../lib/store";
import { cx, StatusDot } from "../components/ui";
import { DAY, fmtDay, fmtLong, isoDay, todayIso, usePhone } from "./spaces-util";
import { announce, dragging, dragKind, dropData, endDrag, NotesTray, startDrag, useConfirm, useRefocus, zoneY } from "./dnd-parts";

const NEXT: Record<TopicStatus, TopicStatus> = { todo: "learning", learning: "done", done: "todo", skipped: "todo" };
const STATUS_LABEL: Record<TopicStatus, string> = { todo: "Todo", learning: "Learning", done: "Done", skipped: "Skipped" };
const today = todayIso;
const overdue = (t: Topic, due = t.due) => !!due && t.status !== "done" && t.status !== "skipped" && due < today();
const finished = (t?: Topic) => t?.status === "done" || t?.status === "skipped";

/** Progress ring: success arc on a surface-2 track, transparent centre so it sits on any background. */
export function Ring({ pct, size = 44 }: { pct: number; size?: number }) {
  const sw = Math.max(3, Math.round(size * 0.1));
  const r = size / 2 - sw / 2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="-rotate-90 shrink-0" aria-label={`${pct}% done`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--surface-2)" strokeWidth={sw} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--success)" strokeWidth={sw} fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      <text x="50%" y="50%" transform={`rotate(90 ${size / 2} ${size / 2})`} textAnchor="middle" dominantBaseline="central" fontSize={size >= 52 ? 13 : size >= 48 ? 12 : 11} fontWeight={650} fill="var(--text)">{pct}%</text>
    </svg>
  );
}

/** Status glyph from the design: ring (todo), info ring (learning; half-filled on phone), filled check (done), ban (skipped). */
export function TopicDot({ s, size = 14, half }: { s: TopicStatus; size?: number; half?: boolean }) {
  const base: CSSProperties = { width: size, height: size, borderRadius: "50%", boxSizing: "border-box", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" };
  if (s === "done") return <span style={{ ...base, background: "var(--success)" }}><Check size={Math.round(size * 0.72)} strokeWidth={3.2} style={{ color: "var(--bg)" }} /></span>;
  if (s === "learning") return half
    ? <span style={{ ...base, border: "1.5px solid var(--info)", background: "linear-gradient(90deg, var(--info) 50%, transparent 50%)" }} />
    : <span style={{ ...base, border: "2px solid var(--info)" }} />;
  if (s === "skipped") return <Ban size={size} className="shrink-0 text-muted" />;
  return <span style={{ ...base, border: "1.5px solid var(--muted)" }} />;
}

/** The "current thing": first topic being learned, else the first unlocked todo. */
export function currentTopic(mods: Module[]): Topic | undefined {
  const all = mods.flatMap((m) => m.topics);
  return all.find((t) => t.status === "learning") ?? all.find((t) => t.status === "todo" && !t.locked);
}

/** Open the topic's lesson note, creating (from the Lesson template) and linking it if needed. */
export async function openTopicNote(note: Note, t: Topic, byTitle: Map<string, Note>, mode?: "edit" | "split") {
  const existing = t.note ? byTitle.get(t.note.toLowerCase()) : byTitle.get(t.name.toLowerCase());
  if (existing) { if (!t.note) void updateNote(note.id, { body: linkTopicNote(note.body, t.line, existing.title) }); openNote(existing.id, mode); return; }
  const n = await createNote({ template: "lesson", title: t.note ?? t.name, spaceId: note.spaceId, folderId: note.folderId });
  let body = t.note ? note.body : linkTopicNote(note.body, t.line, n.title);
  if (t.status === "todo") body = setTopicStatus(body, t.line, "learning");
  if (body !== note.body) await updateNote(note.id, { body });
  openNote(n.id, mode ?? "edit");
}

// Line edits live in lib/parse.ts (pure Markdown rewrites); re-exported for older imports.
export { setTopicDue, setTopicNeeds };
const sel$ = (attr: string, v: string) => `[${attr}="${CSS.escape(v)}"]`;

/** First prose of a lesson (skips front-matter, headings, callouts, lists, code), keeping hyphens. */
function lessonExcerpt(md: string) {
  const body = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").replace(/```[\s\S]*?```/g, "").replace(/\$\$[\s\S]*?\$\$/g, "");
  const para = body.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^(#|>|[-*+]\s|\d+[.)]\s|\||!\[)/.test(p)) ?? "";
  return para.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, a: string, b: string) => b || a).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\$([^$\n]+)\$/g, (_m, x: string) => x.replace(/\\[a-zA-Z]+/g, "").trim()).replace(/[*_`]/g, "").replace(/\s+/g, " ").slice(0, 200) || excerpt(md);
}

/** Notes "in a topic": its linked lesson + notes in the space that link to it; cards = flashcards in those notes. */
function topicStats(v: Vault, note: Note, t: Topic) {
  const linked = t.note ? v.byTitle.get(t.note.toLowerCase()) : undefined;
  if (!linked) return { notes: 0, cards: 0, linked };
  const needle = `[[${linked.title.toLowerCase()}`;
  const linking = v.notes.filter((n) => n.spaceId === note.spaceId && n.id !== linked.id && n.id !== note.id && n.body.toLowerCase().includes(needle));
  const group = [linked, ...linking];
  return { notes: group.length, cards: group.reduce((s, n) => s + flashcards(n.body).length, 0), linked };
}

/** Topics that just became unlocked (e.g. after marking a prerequisite Done) — they play the 180 ms fade-up. */
const UnlockCtx = createContext<Set<string>>(new Set());
function useJustUnlocked(mods: Module[]) {
  const prev = useRef<Map<string, boolean> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    const now = new Map(mods.flatMap((m) => m.topics).map((t) => [t.name.toLowerCase(), t.locked]));
    const was = prev.current;
    prev.current = now;
    if (!was) return;
    const unlocked = [...now].filter(([k, locked]) => !locked && was.get(k) === true).map(([k]) => k);
    if (!unlocked.length) return;
    setFresh(new Set(unlocked));
    const id = setTimeout(() => setFresh(new Set()), 900);
    return () => clearTimeout(id);
  }, [mods]);
  return fresh;
}
const unlockCls = (fresh: Set<string>, t: Topic) => (fresh.has(t.name.toLowerCase()) ? "lm-unlock" : "");
const STYLE = `
@keyframes lm-unlock { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.lm-unlock { animation: lm-unlock .18s cubic-bezier(.2,.8,.2,1) both; }
.lm-flow .react-flow__handle { min-width: 0; min-height: 0; }
.lm-flow .react-flow__edge-path { transition: stroke .12s, opacity .12s; }
.lm-flow .react-flow__node { cursor: pointer; }
[data-dark="0"] .lm-sheet { box-shadow: 0 1px 2px rgb(0 0 0 / .06), 0 4px 16px rgb(0 0 0 / .06); }
.lm-flow .lm-src { opacity: 0; transition: opacity .12s; }
.lm-flow .react-flow__node:hover .lm-src, .lm-flow .lm-src.connecting { opacity: 1; }
`;

export type RoadmapViewKind = "outline" | "tree" | "timeline";
const VIEWS: { v: RoadmapViewKind; l: string; I: typeof ListTree }[] = [{ v: "outline", l: "Outline", I: ListTree }, { v: "tree", l: "Skill tree", I: GitFork }, { v: "timeline", l: "Timeline", I: GanttChart }];

/** Outline / Skill tree / Timeline switch (desktop look; the phone uses a full-width variant). */
export function ViewSwitch({ view, onView, phone }: { view: RoadmapViewKind; onView: (v: RoadmapViewKind) => void; phone?: boolean }) {
  if (phone) return (
    <div role="tablist" className="grid grid-cols-3 gap-0.5 rounded-[10px] border border-line bg-surface p-[3px] text-[14px]">
      {VIEWS.map(({ v: k, l }) => <button key={k} role="tab" aria-selected={view === k} onClick={() => onView(k)} className={cx("h-9 rounded-[7px]", view === k ? "bg-surface-2 font-semibold" : "text-muted")}>{l}</button>)}
    </div>
  );
  return (
    <div role="tablist" className="flex gap-0.5 rounded-[10px] border border-line bg-surface p-[3px]">
      {VIEWS.map(({ v: k, l, I }) => (
        <button key={k} role="tab" aria-selected={view === k} onClick={() => onView(k)}
          className={cx("flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-3 text-[13px]", view === k ? "bg-surface-2 font-semibold text-ink" : "font-[450] text-muted hover:text-ink")}>
          <I size={14} />{l}
        </button>
      ))}
    </div>
  );
}

function Legend() {
  const dot = (s: CSSProperties) => <span style={{ width: 12, height: 12, borderRadius: "50%", boxSizing: "border-box", ...s }} />;
  return (
    <div className="hidden items-center gap-3.5 text-[12px] text-muted lg:flex">
      <span className="flex items-center gap-1.5">{dot({ border: "1.5px solid var(--muted)" })}Todo</span>
      <span className="flex items-center gap-1.5">{dot({ border: "2px solid var(--info)" })}Learning</span>
      <span className="flex items-center gap-1.5">{dot({ background: "var(--success)" })}Done</span>
      <span className="flex items-center gap-1.5"><Ban size={12} />Skipped</span>
      <span className="flex items-center gap-1.5"><Lock size={12} />Locked</span>
    </div>
  );
}

/**
 * The roadmap's three views. `compact` = embedded in a course space page (the page owns the header; the
 * toolbar sits inside the page's 48px gutters and the topic sheet overlays the page). The view can be
 * controlled (`view`/`onView`) so the page can adapt its header on phones.
 */
export function RoadmapView({ note, compact, target, view: cView, onView }: { note: Note; compact?: boolean; target?: string | null; view?: RoadmapViewKind; onView?: (v: RoadmapViewKind) => void }) {
  const [uView, setUView] = useState<RoadmapViewKind>("outline");
  const mods = useMemo(() => roadmap(note.body), [note.body]);
  const empty = !mods.some((m) => m.topics.length);
  // an empty roadmap opens as the "Create roadmap" builder: outline + notes to drag in
  const view = empty ? "outline" : cView ?? uView;
  const setView = onView ?? setUView;
  // selection follows the topic by name, so it survives reorders that change line numbers
  const [selKey, setSelKey] = useState<string | null>(null);
  const fresh = useJustUnlocked(mods);
  const phone = usePhone();
  const p = progress(mods);
  const v = useVault();
  const all = mods.flatMap((m) => m.topics);
  const cur = currentTopic(mods);
  const selected = selKey === null ? undefined : all.find((t) => t.name.toLowerCase() === selKey);
  const sel = selected?.line ?? null;
  const select = (t: Topic) => setSelKey(t.name.toLowerCase());
  // the builder keeps its notes list open after the first drop (the roadmap stops being empty then)
  const [trayPref, setTray] = useState<boolean | null>(() => (empty ? true : null));
  const tray = !phone && view === "outline" && (trayPref ?? empty);
  const [confirmNode, confirm] = useConfirm();

  const write = (body: string) => { if (body !== note.body) void updateNote(note.id, { body }); };
  const setStatus = (t: Topic, s: TopicStatus) => write(setTopicStatus(note.body, t.line, s));
  const openTopic = (t: Topic, mode?: "edit" | "split") => void openTopicNote(note, t, v.byTitle, mode);
  const addNeed = (topicLine: number, prereqLine: number) => {
    const md = addTopicNeed(note.body, topicLine, prereqLine);
    const t = all.find((x) => x.line === topicLine), d = all.find((x) => x.line === prereqLine);
    if (md === note.body) { if (t && d && t.line !== d.line && !t.needs.some((n) => n.toLowerCase() === d.name.toLowerCase())) toast("That would make a loop: it already depends on this topic."); return; }
    write(md);
    announce(`${t?.name} now needs ${d?.name}`);
  };
  const setDue = (t: Topic, due: string | null) => write(setTopicDue(note.body, t.line, due));
  const stats = (t: Topic) => topicStats(v, note, t);
  /** New topic (palette drop, edge dropped on the canvas, "+ Topic"): optionally needing another one; it opens selected. */
  const createTopic = (module: number | null, needs?: Topic) => {
    const name = uniqueTopicName(mods);
    let md = addTopic(note.body, module ?? (mods.length ? mods.length - 1 : null), name);
    const line = topicLineByName(md, name);
    if (needs && line !== null) md = setTopicNeeds(md, line, [needs.name]);
    write(md);
    setSelKey(name.toLowerCase());
    announce(`Added ${name}${needs ? `, needs ${needs.name}` : ""}`);
  };
  const removeTopic = (t: Topic) => confirm(<>Delete topic “<b dir="auto">{t.name}</b>”? Topics that need it stop needing it.</>, "Delete", () => {
    write(deleteTopic(note.body, t.line));
    if (selKey === t.name.toLowerCase()) setSelKey(null);
    announce(`Deleted ${t.name}`);
  }, true);
  const removeNeed = (t: Topic, name: string) => { write(removeTopicNeed(note.body, t.line, name)); announce(`${t.name} no longer needs ${name}`); };
  const ops: TopicOps = {
    body: note.body, write, mods, remove: removeTopic,
    rename: (t, name) => { const md = renameTopic(note.body, t.line, name); write(md); if (md !== note.body) setSelKey(name.trim().replace(/[()]/g, "").toLowerCase()); },
  };
  // Delete / Backspace removes the selected node in the skill tree
  useEffect(() => {
    if (view !== "tree" || !selected) return;
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if ((e.key === "Delete" || e.key === "Backspace") && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.isContentEditable) { e.preventDefault(); removeTopic(selected); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });
  const used = useMemo(() => new Set(mods.flatMap((m) => m.topics).flatMap((t) => [t.name.toLowerCase(), ...(t.note ? [t.note.toLowerCase()] : [])])), [mods]);
  const pickNote = (n: Note) => {
    if (used.has(n.title.toLowerCase())) return;
    write(mods.length ? addTopic(note.body, mods.length - 1, n.title, { note: n.title }) : addModule(note.body, "Module 1", [{ name: n.title, note: n.title }]));
    announce(`Added ${n.title}`);
  };

  return (
    <UnlockCtx.Provider value={fresh}>
      <style>{STYLE}</style>
      <div className={cx("flex h-full min-h-0 flex-col", !compact && "relative")}>
        {phone ? (
          <div className={cx("px-4", view === "tree" ? "pb-2.5" : "pb-3 pt-1")}>{empty ? <p className="text-[15px] font-semibold">Create roadmap</p> : <ViewSwitch view={view} onView={setView} phone />}</div>
        ) : (
          <div className={cx("flex flex-wrap items-center gap-4 border-b border-line", compact ? "mx-12 mt-5 pb-3.5" : "px-6 py-3")}>
            {!compact && (
              <div className="flex items-center gap-3">
                <Ring pct={p.pct} size={44} />
                <div className="flex flex-col text-[12px] text-muted"><span><b className="font-semibold text-ink">{p.done}</b> of {p.total} topics</span><span>{all.filter((t) => t.status === "learning").length} learning · {all.filter((t) => t.locked).length} locked</span></div>
              </div>
            )}
            {empty ? <span className="text-[14px] font-semibold">Create roadmap</span> : <ViewSwitch view={view} onView={setView} />}
            <span className="flex-1" />
            {!empty && <Legend />}
            {view === "outline" && (
              <button onClick={() => setTray(!tray)} aria-pressed={tray} title="Drag notes in to make them topics"
                className={cx("flex h-7 items-center gap-1.5 rounded-[8px] border px-2.5 text-[12.5px]", tray ? "border-accent/50 bg-accent/10 text-ink" : "border-line text-muted hover:text-ink")}>
                <NotebookPen size={13} />Add notes
              </button>
            )}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <div className={cx("min-h-0 min-w-0 flex-1", view === "tree" ? "relative overflow-hidden" : "overflow-auto")}>
            {view === "outline" && (phone
              ? <PhoneOutline mods={mods} cur={selected?.line ?? cur?.line} stats={stats} onSelect={select} ops={ops} spaceId={note.spaceId} used={used} onPickNote={pickNote} />
              : <Outline mods={mods} cur={selected?.line ?? cur?.line} onStatus={setStatus} onOpen={openTopic} onSelect={select} ops={ops} empty={empty} />)}
            {view === "tree" && <ReactFlowProvider><Tree mods={mods} sel={sel} phone={phone} onSelect={select} onConnect={addNeed} onCreate={createTopic} onRemoveNeed={removeNeed} /></ReactFlowProvider>}
            {view === "timeline" && <Timeline mods={mods} target={target} onSelect={select} onDue={setDue} />}
          </div>
          {tray && <NotesTray className="w-[260px] shrink-0 border-l" spaceId={note.spaceId} used={used} onPick={pickNote} onClose={() => setTray(false)} title="Notes → topics"
            hint={<>Drag a note onto a module (or between topics) to make it a topic linked to that note.</>} />}
        </div>
        {selected && (phone
          ? <PhoneTopicSheet note={note} mods={mods} t={selected} stats={stats(selected)} onClose={() => setSelKey(null)} onStatus={setStatus} onOpen={openTopic} onSelect={select} ops={ops} />
          : <TopicSheet note={note} mods={mods} t={selected} stats={stats(selected)} onClose={() => setSelKey(null)} onStatus={setStatus} onOpen={openTopic} onSelect={select} ops={ops} />)}
        {confirmNode}
      </div>
    </UnlockCtx.Provider>
  );
}

/** What the outline / sheets need to rewrite the roadmap. */
interface TopicOps { body: string; write: (body: string) => void; mods: Module[]; remove: (t: Topic) => void; rename: (t: Topic, name: string) => void }

/** Every topic `t` (transitively) depends on, by line. */
function ancestors(all: Topic[], t: Topic): Set<number> {
  const byName = new Map(all.map((x) => [x.name.toLowerCase(), x]));
  const out = new Set<number>();
  const stack = [t];
  while (stack.length) {
    const x = stack.pop()!;
    for (const n of x.needs) { const d = byName.get(n.toLowerCase()); if (d && !out.has(d.line)) { out.add(d.line); stack.push(d); } }
  }
  return out;
}

/** Every topic that (transitively) needs `t`: what finishing it unlocks. */
function descendants(all: Topic[], t: Topic): Set<number> {
  const kids = new Map<string, Topic[]>();
  for (const x of all) for (const n of x.needs) { const k = n.toLowerCase(); kids.set(k, [...(kids.get(k) ?? []), x]); }
  const out = new Set<number>();
  const stack = [t];
  while (stack.length) {
    const x = stack.pop()!;
    for (const c of kids.get(x.name.toLowerCase()) ?? []) if (!out.has(c.line)) { out.add(c.line); stack.push(c); }
  }
  return out;
}

/// ------------------------------------------------------------------ outline

/** Drop feedback on the outline: line before/after a topic, "becomes a prerequisite" ring, module ends, the new-module zone. */
type Hint = { kind: "before" | "after" | "need"; line: number } | { kind: "mod-before" | "mod-after" | "mod-end"; i: number } | { kind: "new" } | null;
const hintCls = (h: Hint, line: number) => (h && "line" in h && h.line === line ? (h.kind === "need" ? "pdnd-inside" : `pdnd-${h.kind}`) : "");

type RowDnd = { cls: string; needTag: boolean; over: (e: DragEvent) => void; drop: (e: DragEvent) => void; key: (e: React.KeyboardEvent) => void; dragging: boolean };
function TopicRow({ t, cur, onStatus, onOpen, onSelect, dnd }: { t: Topic; cur?: boolean; onStatus: (t: Topic, s: TopicStatus) => void; onOpen: (t: Topic) => void; onSelect: (t: Topic) => void; dnd?: RowDnd }) {
  const fresh = useContext(UnlockCtx);
  return (
    <div onClick={() => onSelect(t)} data-topic={t.name} data-pdnd-row tabIndex={dnd ? 0 : undefined} role={dnd ? "button" : undefined}
      aria-label={dnd ? `${t.name}, ${STATUS_LABEL[t.status]}. Alt+Up or Alt+Down to move.` : undefined}
      draggable={!!dnd} onDragStart={dnd && ((e) => startDrag(e, "topic", String(t.line), t.name))} onDragEnd={dnd && (() => endDrag())}
      onDragOver={dnd?.over} onDrop={dnd?.drop} onKeyDown={dnd?.key}
      className={cx("group relative flex h-[38px] cursor-pointer items-center gap-3 rounded-[8px] pl-[34px] pr-3", cur ? "bg-surface-2" : "hover:bg-surface-2/60", unlockCls(fresh, t), dnd?.cls, dnd?.dragging && "pdnd-dragging")} style={{ opacity: t.locked && !dnd?.dragging ? 0.5 : undefined }}>
      {dnd && <GripVertical size={13} aria-hidden className="pdnd-grip absolute left-[10px] top-1/2 -translate-y-1/2 text-muted" />}
      <button title={`${STATUS_LABEL[t.status]}. Click: ${STATUS_LABEL[NEXT[t.status]]}, right-click: skip`}
        onClick={(e) => { e.stopPropagation(); onStatus(t, NEXT[t.status]); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onStatus(t, t.status === "skipped" ? "todo" : "skipped"); }}
        className="-m-1.5 flex p-1.5">
        <TopicDot s={t.status} />
      </button>
      <span className={cx("w-[230px] min-w-0 shrink-0 truncate font-medium", t.status === "skipped" && "line-through")} dir="auto">{t.name}</span>
      {t.locked && <Lock size={13} className="shrink-0 text-muted" />}
      <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{t.needs.length && t.locked ? `needs ${t.needs.join(", ")}` : ""}</span>
      {dnd && (
        <span draggable onDragStart={(e) => startDrag(e, "need", String(t.line), t.name)} onDragEnd={() => endDrag()} onClick={(e) => e.stopPropagation()}
          title="Drag onto another topic: that topic will need this one" aria-hidden
          className="pdnd-grip flex size-6 shrink-0 items-center justify-center rounded-[6px] text-muted hover:bg-surface hover:text-accent"><Link2 size={13} /></span>
      )}
      <button onClick={(e) => { e.stopPropagation(); onOpen(t); }} title={t.note ? `Open ${t.note}` : "Create lesson note"}
        className={cx("flex w-[230px] min-w-0 shrink-0 items-center gap-1.5 text-left text-[12.5px]", t.note ? "text-link hover:underline" : "text-muted hover:text-ink")}>
        {t.note ? <FileText size={13} className="shrink-0" /> : <Plus size={13} className="shrink-0" />}<span className="truncate">{t.note ?? "Create lesson note"}</span>
      </button>
      <span className={cx("w-16 shrink-0 text-right text-[12px] tabular-nums", overdue(t) ? "text-bad" : "text-muted")}>{t.due ? fmtDay(t.due) : ""}</span>
      {dnd?.needTag && <span className="pdnd-tag">needs this</span>}
    </div>
  );
}

function moduleDue(m: Module) {
  const p = progress([m]);
  const allDone = m.topics.length > 0 && m.topics.every(finished);
  if (allDone) return { text: m.due && today() < m.due ? "Done early" : "Done", late: false };
  void p;
  return m.due ? { text: `Module due ${fmtDay(m.due)}`, late: m.due < today() } : null;
}

function useClosed() {
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setClosed((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return [closed, toggle] as const;
}

/** Inline "+ Add …" input: Enter adds and keeps the field open for the next one. */
function AddRow({ placeholder, onAdd, className, inputCls, value, onValue }: { placeholder: string; onAdd: (name: string) => void; className?: string; inputCls?: string; value?: string; onValue?: (v: string) => void }) {
  const [own, setOwn] = useState("");
  const v = value ?? own;
  const setV = onValue ?? setOwn;
  return (
    <form className={cx("flex items-center gap-2", className)} onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(""); } }} onClick={(e) => e.stopPropagation()}>
      <Plus size={13} className="shrink-0 text-muted" />
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder} dir="auto"
        className={cx("min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted", inputCls)} />
    </form>
  );
}

/** Desktop outline with drag & drop: reorder topics and modules, drop on a topic's middle to make it a prerequisite, drop notes in. */
function Outline({ mods, cur, onStatus, onOpen, onSelect, ops, empty }: { mods: Module[]; cur?: number; onStatus: (t: Topic, s: TopicStatus) => void; onOpen: (t: Topic) => void; onSelect: (t: Topic) => void; ops: TopicOps; empty?: boolean }) {
  // Modules that are all done start folded, like the design (03/04 collapsed).
  const [closed, toggle] = useClosed();
  const [init] = useState(() => new Set(mods.map((m, i) => (m.topics.length && (m.topics.every(finished) || (cur !== undefined && !m.topics.some((t) => t.line === cur) && i > mods.findIndex((x) => x.topics.some((t) => t.line === cur)) + 1)) ? i : -1)).filter((i) => i >= 0)));
  const isOpen = (i: number) => closed.has(i) === init.has(i);
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

  const rowDnd = (m: Module, mi: number, t: Topic): RowDnd => ({
    cls: hintCls(hint, t.line),
    needTag: !!hint && "line" in hint && hint.line === t.line && hint.kind === "need",
    dragging: draggedLine() === t.line && !!hint,
    over: (e) => {
      const k = dragKind(e);
      if (k !== "topic" && k !== "need" && k !== "note") return;
      if (draggedLine() === t.line) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = k === "need" ? "link" : "move";
      const z = k === "need" ? "inside" : zoneY(e);
      set({ kind: z === "inside" ? (k === "note" ? (zoneY(e, 0.5) === "after" ? "after" : "before") : "need") : z, line: t.line });
    },
    drop: (e) => {
      const k = dragKind(e);
      const h = hint;
      e.preventDefault(); e.stopPropagation();
      if (!h || !("line" in h) || (k !== "topic" && k !== "need" && k !== "note")) return finish();
      const id = dropData(e, k);
      finish();
      const before = h.kind === "before" ? t.line : after(m, t);
      if (k === "note") return addNote(body, mi, id, before);
      const from = byLine(Number(id));
      if (!from) return;
      if (h.kind === "need") {
        const md = addTopicNeed(body, t.line, from.line);
        if (md === body) { toast(t.needs.some((n) => n.toLowerCase() === from.name.toLowerCase()) ? `${t.name} already needs ${from.name}` : "That would make a loop: it already depends on this topic."); return; }
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
    <div className="flex max-w-[1076px] flex-col gap-2.5 px-12 py-4" onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHint(null); }} onDragEnd={finish}>
      {empty && (
        <p className="mb-1 max-w-[640px] text-[13px] leading-relaxed text-muted">
          Start your roadmap: drag notes from the list on the right into a module (each becomes a topic linked to that note), or type a module name below and add topics. You can still write the Markdown by hand in <b>Edit</b>: <code>## Module</code> and <code>- [ ] Topic (needs: Other)</code>.
        </p>
      )}
      {mods.map((m, i) => {
        const p = progress([m]);
        const open = isOpen(i);
        const due = moduleDue(m);
        const mh = hint && "i" in hint && hint.i === i ? hint.kind : null;
        return (
          <section key={i} data-module-section={i} onDragOver={(e) => modOver(e, i)} onDrop={(e) => modDrop(e, i)}
            className={cx("overflow-hidden rounded-[14px] border border-line bg-surface", mh === "mod-before" && "pdnd-before !overflow-visible", mh === "mod-after" && "pdnd-after !overflow-visible", mh === "mod-end" && "pdnd-inside")}>
            <div role="button" tabIndex={0} aria-expanded={open} data-module={m.name} data-pdnd-row draggable={m.line >= 0 && renaming !== i}
              aria-label={`Module ${m.name}. Enter to fold. Alt+Up or Alt+Down to move.`}
              onDragStart={(e) => startDrag(e, "module", String(i), m.name)} onDragEnd={finish}
              onClick={() => renaming !== i && toggle(i)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if ((e.key === "Enter" || e.key === " ") && !e.altKey) { e.preventDefault(); toggle(i); return; }
                if (e.key === "F2") { setRenaming(i); return; }
                if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                  e.preventDefault();
                  const md = nudgeModule(body, i, e.key === "ArrowUp" ? -1 : 1);
                  if (md !== body) { write(md); refocus(sel$("data-module", m.name)); announce(`Module ${m.name} moved ${e.key === "ArrowUp" ? "up" : "down"}`); }
                }
              }}
              className="group flex h-[52px] w-full cursor-pointer items-center gap-3 px-4 text-left">
              {open ? <ChevronDown size={15} className="shrink-0 text-muted" /> : <ChevronRight size={15} className="shrink-0 text-muted" />}
              {renaming === i ? (
                <input autoFocus defaultValue={m.name} dir="auto" aria-label="Module name" onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(null); }}
                  onBlur={(e) => { const v = e.target.value.trim(); setRenaming(null); if (v && v !== m.name) write(renameModule(body, i, v)); }}
                  className="w-[220px] shrink-0 rounded-[6px] border border-line bg-bg px-1.5 text-[14px] font-semibold outline-none" />
              ) : (
                <span className="w-[220px] shrink-0 truncate text-[14px] font-semibold" dir="auto" title={m.line >= 0 ? "Double-click to rename · drag to reorder" : undefined}
                  onDoubleClick={(e) => { if (m.line >= 0) { e.stopPropagation(); setRenaming(i); } }}>{m.name}</span>
              )}
              <span className="h-1.5 max-w-[260px] flex-1 overflow-hidden rounded-[3px] bg-surface-2"><span className="block h-full bg-ok" style={{ width: `${p.pct}%` }} /></span>
              <span className="w-[90px] shrink-0 text-[12px] text-muted">{p.pct}% · {p.done}/{p.total}</span>
              <span className="flex-1" />
              {due && <span className={cx("shrink-0 text-[12px]", due.late ? "text-bad" : "text-muted")}>{due.text}</span>}
              {!m.topics.length && m.line >= 0 && (
                <button aria-label={`Delete module ${m.name}`} title="Delete empty module" onClick={(e) => { e.stopPropagation(); write(deleteModule(body, i)); announce(`Deleted module ${m.name}`); }}
                  className="pdnd-grip flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-surface-2 hover:text-bad"><Trash2 size={13} /></button>
              )}
              {m.line >= 0 && <GripVertical size={14} aria-hidden className="pdnd-grip shrink-0 text-muted" />}
            </div>
            {open && (
              <div className="border-t border-line px-2 pb-2 pt-1">
                {m.topics.map((t) => <TopicRow key={t.line} t={t} cur={t.line === cur} onStatus={onStatus} onOpen={onOpen} onSelect={onSelect} dnd={rowDnd(m, i, t)} />)}
                <AddRow placeholder={m.topics.length ? "Add topic" : "Add a topic, or drop topics and notes here"} className="h-[34px] pl-[34px] pr-3"
                  onAdd={(name) => { if (hasTopic(name)) return toast(`“${name}” is already a topic`); write(addTopic(body, i, name)); announce(`Added ${name}`); }} />
              </div>
            )}
          </section>
        );
      })}
      <div onDragOver={newOver} onDrop={newDrop} className={cx("pdnd-zone flex h-[52px] items-center px-4", hint?.kind === "new" && "pdnd-over")}>
        <AddRow placeholder={hint?.kind === "new" ? `Drop to start “${newMod.trim() || `Module ${mods.length + 1}`}”` : "New module: type a name, or drop topics / notes here"} className="flex-1"
          inputCls="font-semibold" value={newMod} onValue={setNewMod} onAdd={(name) => { write(addModule(body, name)); announce(`New module ${name}`); }} />
      </div>
    </div>
  );
}
function phoneSub(t: Topic, notes: number) {
  if (t.locked) return `Locked · needs ${t.needs.join(", ")}`;
  if (t.status === "done") return t.due ? `Done ${fmtDay(t.due)}` : "Done";
  if (t.status === "skipped") return "Skipped";
  const parts = [t.due ? (overdue(t) ? `Overdue · ${fmtLong(t.due)}` : `Due ${fmtLong(t.due)}`) : t.status === "learning" ? "Learning" : "Todo"];
  if (notes) parts.push(`${notes} note${notes === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function PhoneOutline({ mods, cur, stats, onSelect, ops, spaceId, used, onPickNote }: { mods: Module[]; cur?: number; stats: (t: Topic) => { notes: number }; onSelect: (t: Topic) => void; ops: TopicOps; spaceId: string; used: Set<string>; onPickNote: (n: Note) => void }) {
  const fresh = useContext(UnlockCtx);
  const [closed, toggle] = useClosed();
  const [notes, setNotes] = useState(false);
  const curMod = mods.findIndex((m) => m.topics.some((t) => t.line === cur));
  const firstOpen = curMod >= 0 ? curMod : 0;
  const isOpen = (i: number) => (i === firstOpen) !== closed.has(i);
  const { body, write } = ops;
  const hasTopic = (name: string) => mods.some((m) => m.topics.some((t) => t.name.toLowerCase() === name.toLowerCase()));
  return (
    <div className="flex flex-col gap-2.5 px-4 pb-3">
      {!mods.length && <p className="text-[13px] leading-relaxed text-muted">Name a first module below, then add topics, or add notes as topics.</p>}
      {mods.map((m, i) => {
        const p = progress([m]);
        const open = isOpen(i);
        return (
          <section key={i} className="overflow-hidden rounded-[14px] border border-line bg-surface">
            <button className="flex h-14 w-full items-center gap-2.5 px-3.5 text-left" onClick={() => toggle(i)} aria-expanded={open}>
              {open ? <ChevronDown size={16} className="shrink-0 text-muted" /> : <ChevronRight size={16} className="shrink-0 text-muted" />}
              <span className="min-w-0 flex-1 truncate font-semibold" dir="auto">{m.name}</span>
              <span className="text-[12px] text-muted">{p.done}/{p.total}</span>
              <span className="h-[5px] w-12 overflow-hidden rounded-[3px] bg-surface-2"><span className="block h-full bg-ok" style={{ width: `${p.pct}%` }} /></span>
            </button>
            {open && m.topics.filter((t) => t.status !== "skipped").map((t) => (
              <button key={t.line} onClick={() => onSelect(t)} className={cx("flex min-h-[52px] w-full items-center gap-3 border-t border-line pl-10 pr-3.5 text-left", t.line === cur && "bg-surface-2", unlockCls(fresh, t))} style={{ opacity: t.locked ? 0.5 : 1 }}>
                <TopicDot s={t.status} size={16} half />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5"><span className="truncate font-medium" dir="auto">{t.name}</span><span className="truncate text-[12px] text-muted">{phoneSub(t, stats(t).notes)}</span></span>
                {t.locked ? <Lock size={15} className="shrink-0 text-muted" /> : <ChevronRight size={15} className="shrink-0 text-muted" />}
              </button>
            ))}
            {open && <AddRow placeholder="Add topic" className="h-12 border-t border-line pl-10 pr-3.5" inputCls="text-[15px]"
              onAdd={(name) => { if (hasTopic(name)) return toast(`“${name}” is already a topic`); write(addTopic(body, i, name)); }} />}
          </section>
        );
      })}
      <div className="pdnd-zone flex h-12 items-center px-3.5"><AddRow placeholder="New module" className="flex-1" inputCls="text-[15px] font-semibold" onAdd={(name) => write(addModule(body, name))} /></div>
      <button onClick={() => setNotes(true)} className="flex h-11 items-center justify-center gap-2 rounded-[12px] border border-line text-[14px] text-muted"><NotebookPen size={15} />Add notes as topics</button>
      {notes && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setNotes(false)} />
          <div className="sheet-in safe-b fixed inset-x-0 bottom-0 z-50 flex h-[70dvh] flex-col overflow-hidden rounded-t-[14px] border-t border-line">
            <NotesTray className="h-full" spaceId={spaceId} used={used} onPick={onPickNote} onClose={() => setNotes(false)} title="Add notes as topics" hint={<>Tap + to add a note to the last module.</>} />
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ skill tree

type TData = { t: Topic; sel: boolean; dim: boolean; path: boolean; w: number; h: number; fresh: boolean; phone: boolean };
const TopicNode = memo(({ data }: NodeProps<RFNode<TData>>) => {
  const { t, sel, dim, path, w, h, fresh, phone } = data;
  const style: CSSProperties = {
    width: w, height: h,
    background: t.status === "done" ? "color-mix(in srgb, var(--success) 16%, var(--surface))" : "var(--surface)",
    border: sel ? "2px solid var(--accent)" : path ? "1.5px solid var(--accent)" : t.status === "done" ? "1px solid color-mix(in srgb, var(--success) 55%, transparent)" : t.status === "learning" ? "1.5px solid var(--info)" : "1px solid var(--border)",
    boxShadow: sel ? "0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent)" : "none",
    opacity: (t.locked ? 0.45 : 1) * (dim ? 0.35 : 1),
    transition: "opacity .12s",
  };
  return (
    <div className="relative">
      {/* whole node is a drop target for "add prerequisite"; only the right-edge dot starts a drag */}
      <Handle type="target" position={Position.Left} isConnectableStart={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", transform: "none", left: 0, top: 0, border: 0, background: "transparent", borderRadius: 10 }} />
      <div className={cx("box-border flex items-center rounded-[10px] text-[13px]", phone ? "gap-2 px-2.5" : "gap-2.5 px-3", fresh && "lm-unlock")} style={style}>
        <TopicDot s={t.status} half={phone} />
        <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
        {t.locked && <Lock size={12} className="shrink-0 text-muted" />}
      </div>
      <Handle type="source" position={Position.Right} title="Drag onto a topic to make this its prerequisite" className="lm-src"
        style={{ width: 10, height: 10, right: 0, transform: "translate(0,-50%)", background: "var(--accent)", border: "2px solid var(--bg)", cursor: "crosshair" }} />
    </div>
  );
});
TopicNode.displayName = "TopicNode";

const LABELS = ["Foundations", "Core", "Applied", "Advanced"];
function treeLayout(mods: Module[], phone: boolean) {
  const all = mods.flatMap((m) => m.topics).filter((t) => t.status !== "skipped");
  const byName = new Map(all.map((t) => [t.name.toLowerCase(), t]));
  const deps = (t: Topic) => t.needs.map((n) => byName.get(n.toLowerCase())).filter((d): d is Topic => !!d && d.line !== t.line);
  const depth = new Map<number, number>();
  const visiting = new Set<number>();
  // Column = prerequisite depth; topics with no prerequisites sit in their module's column.
  const d = (t: Topic): number => {
    if (depth.has(t.line)) return depth.get(t.line)!;
    if (visiting.has(t.line)) return 0;
    visiting.add(t.line);
    const ds = deps(t);
    const v = ds.length ? 1 + Math.max(...ds.map(d)) : t.module;
    visiting.delete(t.line);
    depth.set(t.line, v);
    return v;
  };
  all.forEach(d);
  const G = phone ? { x0: 16, colW: 170, w: 150, h: 44, y0: 40, step: 80 } : { x0: 48, colW: 241, w: 188, h: 42, y0: 60, step: 80 };
  const cols = Math.max(...depth.values()) + 1;
  const ys = new Map<number, number>();
  for (let c = 0; c < cols; c++) {
    let prev: number | undefined;
    for (const t of all.filter((x) => depth.get(x.line) === c)) {
      const ps = deps(t).map((x) => ys.get(x.line)).filter((y): y is number => y !== undefined);
      const want = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : prev === undefined ? (c === 0 ? G.y0 : G.y0 - 20) : prev + G.step;
      const y = Math.max(phone ? 40 : 40, prev === undefined ? want : Math.max(want, prev + G.step));
      ys.set(t.line, y);
      prev = y;
    }
  }
  const edges: { from: Topic; to: Topic }[] = [];
  for (const t of all) for (const x of deps(t)) edges.push({ from: x, to: t });
  return { all, G, cols, pos: (t: Topic) => ({ x: G.x0 + depth.get(t.line)! * G.colW, y: ys.get(t.line)! }), edges };
}

function TreeControls() {
  const rf = useReactFlow();
  const b = "flex h-7 w-[30px] items-center justify-center rounded-[7px] hover:bg-surface-2";
  return (
    <div className="absolute bottom-5 left-5 z-10 flex gap-0.5 rounded-[10px] border border-line bg-surface p-[3px]">
      <button className={b} aria-label="Zoom in" onClick={() => void rf.zoomIn({ duration: 150 })}><Plus size={14} /></button>
      <button className={b} aria-label="Zoom out" onClick={() => void rf.zoomOut({ duration: 150 })}><Minus size={14} /></button>
      <button className={b} aria-label="Fit" onClick={() => void rf.fitView({ duration: 200, padding: 0.12 })}><Scan size={14} /></button>
    </div>
  );
}

function Tree({ mods, sel, phone, onSelect, onConnect, onCreate, onRemoveNeed }: {
  mods: Module[]; sel: number | null; phone: boolean; onSelect: (t: Topic) => void; onConnect: (topicLine: number, prereqLine: number) => void;
  onCreate: (module: number | null, needs?: Topic) => void; onRemoveNeed: (t: Topic, name: string) => void;
}) {
  const fresh = useContext(UnlockCtx);
  const [hover, setHover] = useState<number | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<{ x: number; y: number; from: Topic; to: Topic } | null>(null);
  const [paletteOver, setPaletteOver] = useState<number | "pane" | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const L = useMemo(() => treeLayout(mods, phone), [mods, phone]);
  // focus = hovered topic, else the selected one: highlight its prerequisite chain AND everything it unlocks
  const focus = hover ?? sel;
  const path = useMemo(() => {
    if (focus === null) return null;
    const t = L.all.find((x) => x.line === focus);
    if (!t) return null;
    const s = ancestors(L.all, t);
    for (const d of descendants(L.all, t)) s.add(d);
    s.add(t.line);
    return s.size > 1 ? s : null;
  }, [focus, L]);
  const nodes = useMemo(() => L.all.map((t): RFNode<TData> => ({
    id: String(t.line), type: "topic", position: L.pos(t), width: L.G.w, height: L.G.h, draggable: false, selectable: false,
    data: { t, sel: t.line === sel || paletteOver === t.line, dim: !!path && !path.has(t.line), path: !!path && path.has(t.line) && t.line !== focus, w: L.G.w, h: L.G.h, fresh: fresh.has(t.name.toLowerCase()), phone },
  })), [L, sel, path, focus, fresh, phone, paletteOver]);
  const edges = useMemo(() => L.edges.map(({ from, to }): Edge => {
    const on = !!path && path.has(from.line) && path.has(to.line);
    // colour = state of the prerequisite: done (green) unlocks, in progress (blue), still to do (muted)
    const c = on ? "var(--accent)" : from.status === "done" ? "var(--success)" : from.status === "learning" ? "var(--info)" : "var(--muted)";
    return { id: `${from.line}>${to.line}`, source: String(from.line), target: String(to.line), type: "default", selectable: false, focusable: false, className: "pdnd-edge", interactionWidth: 18,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: c },
      style: { strokeWidth: on ? 2.25 : 1.5, stroke: c, opacity: on ? 1 : path ? 0.12 : to.locked ? 0.45 : 0.85, transition: "opacity .12s" } };
  }), [L, path]);
  const connect = (c: Connection) => { if (c.source && c.target && c.source !== c.target) onConnect(Number(c.target), Number(c.source)); };
  const byLine = (id: string) => L.all.find((t) => t.line === Number(id));
  const openEdgeMenu = (e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    const from = byLine(edge.source), to = byLine(edge.target), r = box.current!.getBoundingClientRect();
    if (from && to) setEdgeMenu({ x: Math.min(e.clientX - r.left, r.width - 230), y: Math.min(e.clientY - r.top, r.height - 90), from, to });
  };
  // palette: drag "+ Topic" onto the canvas (new topic) or onto a node (new topic that needs it)
  const nodeAt = (e: DragEvent) => { const el = (e.target as Element).closest?.(".react-flow__node"); return el ? Number(el.getAttribute("data-id")) : null; };
  const onPaletteOver = (e: DragEvent) => { if (dragKind(e) !== "palette") return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; const n = nodeAt(e); setPaletteOver(n ?? "pane"); };
  const onPaletteDrop = (e: DragEvent) => {
    if (dragKind(e) !== "palette") return;
    e.preventDefault();
    const n = nodeAt(e);
    setPaletteOver(null);
    endDrag();
    const t = n === null ? undefined : L.all.find((x) => x.line === n);
    onCreate(t ? t.module : null, t);
  };

  return (
    <div ref={box} className="lm-flow absolute inset-0" style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)", backgroundSize: "20px 20px" }}
      onDragOver={onPaletteOver} onDrop={onPaletteDrop} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setPaletteOver(null); }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={{ topic: TopicNode }} defaultViewport={{ x: 0, y: 0, zoom: 1 }} minZoom={0.2} maxZoom={2}
        proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => { setEdgeMenu(null); onSelect((n.data as TData).t); }}
        onNodeMouseEnter={(_, n) => setHover(Number(n.id))} onNodeMouseLeave={() => setHover(null)}
        onEdgeClick={openEdgeMenu} onEdgeContextMenu={openEdgeMenu} onPaneClick={() => setEdgeMenu(null)}
        onConnect={connect} isValidConnection={(c) => c.source !== c.target} connectionLineStyle={{ stroke: "var(--accent)", strokeWidth: 1.5 }}
        onConnectEnd={(e, st) => {
          // dropped on empty canvas: a new topic that needs the one you dragged from
          if (st.isValid || !st.fromNode) return;
          const target = (e as MouseEvent).target as Element | null;
          if (!target?.classList.contains("react-flow__pane")) return;
          const from = byLine(st.fromNode.id);
          if (from) onCreate(from.module, from);
        }}
        nodesConnectable connectOnClick={false} zoomOnDoubleClick={false} panOnScroll={!phone} elementsSelectable={false}>
        {!phone && (
          <ViewportPortal>
            {/* one label per column, aligned to it: columns are prerequisite depth ("step"), not difficulty */}
            {Array.from({ length: L.cols }, (_, i) => (
              <span key={i} className="pointer-events-none absolute whitespace-nowrap text-[11px] font-semibold uppercase tracking-[.06em] text-muted" style={{ left: L.G.x0, top: 20, transform: `translateX(${i * L.G.colW}px)` }}>
                Step {i + 1}{i < LABELS.length ? <span className="font-medium normal-case tracking-normal opacity-70"> · {LABELS[i]}</span> : null}
              </span>
            ))}
          </ViewportPortal>
        )}
      </ReactFlow>
      {paletteOver === "pane" && <div className="pointer-events-none absolute inset-2 rounded-[14px] border-2 border-dashed border-accent/60" />}
      {edgeMenu && (
        <div role="dialog" aria-label="Prerequisite" className="fade-in absolute z-20 w-[220px] rounded-[10px] border border-line bg-surface p-1.5 text-[12.5px] shadow-xl" style={{ left: Math.max(8, edgeMenu.x), top: Math.max(8, edgeMenu.y) }}>
          <div className="px-2 pb-1.5 pt-1 text-muted" dir="auto"><b className="text-ink">{edgeMenu.to.name}</b> needs <b className="text-ink">{edgeMenu.from.name}</b></div>
          <button autoFocus onClick={() => { onRemoveNeed(edgeMenu.to, edgeMenu.from.name); setEdgeMenu(null); }} className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-bad hover:bg-bad/10"><X size={13} />Remove prerequisite</button>
          <button onClick={() => setEdgeMenu(null)} className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-muted hover:bg-surface-2">Cancel</button>
        </div>
      )}
      {/* palette: drag onto the canvas / a topic, or click to add */}
      <div className={cx("absolute z-10 flex items-center gap-1.5", phone ? "bottom-3 left-3" : "bottom-5 left-[124px]")}>
        <button draggable onDragStart={(e) => startDrag(e, "palette", "topic", "New topic")} onDragEnd={() => { endDrag(); setPaletteOver(null); }} onClick={() => onCreate(sel !== null ? L.all.find((t) => t.line === sel)?.module ?? null : null)}
          title="Drag onto the canvas for a new topic, or onto a topic for a next step that needs it. Click to add."
          className={cx("flex cursor-grab items-center gap-1.5 rounded-[10px] border border-line bg-surface px-2.5 text-[12.5px] font-medium hover:border-accent/60 active:cursor-grabbing", phone ? "h-10" : "h-[36px]")}>
          <Plus size={13} />Topic
        </button>
        {!phone && <span className="text-[11.5px] text-muted">drag from a dot to link · click an arrow to remove · Del deletes</span>}
      </div>
      {phone
        ? <span className="pointer-events-none absolute right-3 top-3 flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[12px] text-muted"><MoveHorizontal size={13} />swipe</span>
        : <TreeControls />}
    </div>
  );
}

// ------------------------------------------------------------------ timeline

function Timeline({ mods, target, onSelect, onDue }: { mods: Module[]; target?: string | null; onSelect: (t: Topic) => void; onDue: (t: Topic, due: string) => void }) {
  const lanes = mods.map((m) => ({ m, items: m.topics.filter((t) => t.status !== "skipped" && t.due).map((t) => ({ t, due: t.due })).sort((a, b) => a.due!.localeCompare(b.due!)) }));
  const dates = lanes.flatMap((l) => l.items.map((x) => Date.parse(x.due! + "T00:00:00")));
  const now = Date.parse(today() + "T00:00:00");
  const tgt = target ? Date.parse(target + "T00:00:00") : NaN;
  // Freeze the scale while dragging so the bar follows the pointer.
  const frozen = useRef<{ lo: number; hi: number; weeks: number } | null>(null);
  let scale = frozen.current;
  if (!scale) {
    const lo0 = Math.min(now, ...dates);
    const lo = lo0 - ((new Date(lo0).getDay() + 6) % 7) * DAY; // snap to Monday
    const hiRaw = Math.max(now + 14 * DAY, ...dates, ...(isNaN(tgt) ? [] : [tgt])) + 4 * DAY;
    const weeks = Math.max(4, Math.ceil((hiRaw - lo) / (7 * DAY)));
    scale = { lo, hi: lo + weeks * 7 * DAY, weeks };
  }
  const { lo, hi, weeks } = scale;
  const frac = (t: number) => (t - lo) / (hi - lo);
  const area = useRef<HTMLDivElement>(null);
  const [laneW, setLaneW] = useState(1000);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLaneW(el.clientWidth - 200));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="flex min-h-full min-w-[760px] flex-col px-4 py-4 md:px-12">
      {!dates.length && <p className="mb-3 text-[13px] text-muted">Add dates with <code>📅 2026-12-01</code> on topics or module headings (or set a due date in the topic sheet) to place them here.</p>}
      <div className="grid h-8 shrink-0 grid-cols-[200px_1fr] items-center border-b border-line text-[12px] text-muted">
        <span>Module</span>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}>{Array.from({ length: weeks }, (_, i) => <span key={i}>{fmtDay(lo + i * 7 * DAY)}</span>)}</div>
      </div>
      <div ref={area} className="relative flex-1">
        <div className="pointer-events-none absolute inset-y-0 left-[200px] right-0">
          <div className="absolute inset-y-0 w-0.5 bg-accent" style={{ left: `${frac(now) * 100}%` }}>
            <span className="absolute -left-[22px] -top-0.5 rounded-[6px] bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-accent-fg">Today</span>
          </div>
          {!isNaN(tgt) && <div className="absolute inset-y-0 border-l-[1.5px] border-dashed border-muted opacity-60" style={{ left: `${frac(tgt) * 100}%` }}><span className="absolute left-1.5 top-1 whitespace-nowrap text-[11px] text-muted">Target · {fmtDay(target!)}</span></div>}
        </div>
        {lanes.map(({ m, items }, i) => {
          const p = progress([m]);
          // Rows 38 px apart (16, 54, …): a bar goes to the first row where it doesn't overlap.
          const ends: number[] = [];
          const placed = items.map((x) => {
            const w = 40 + x.t.name.length * 7.1 + fmtDay(x.due!).length * 6.3 + (overdue(x.t, x.due) ? 54 : 0);
            const left = Math.max(0, Math.min(frac(Date.parse(x.due! + "T00:00:00")) * laneW, laneW - w));
            let row = ends.findIndex((e) => left >= e + 6);
            if (row < 0) { row = ends.length; ends.push(0); }
            ends[row] = left + w;
            return { ...x, left, row };
          });
          return (
            <div key={i} className="grid grid-cols-[200px_1fr] border-b border-line" style={{ minHeight: Math.max(96, 16 + ends.length * 38 + 12) }}>
              <div className="flex flex-col gap-1.5 py-4 pr-3"><span className="truncate font-semibold" dir="auto">{m.name}</span><span className="text-[12px] text-muted">{p.done} / {p.total} done</span></div>
              <div className="relative">
                {placed.map((x) => <TimelineBar key={x.t.line} t={x.t} due={x.due!} left={x.left} top={16 + x.row * 38} pxPerDay={laneW / ((hi - lo) / DAY)}
                  onSelect={onSelect} onDrop={(due) => onDue(x.t, due)} freeze={(on) => { frozen.current = on ? scale : null; }} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A topic bar: click opens the sheet, horizontal drag moves its date (snaps to days, writes `📅 YYYY-MM-DD`). */
function TimelineBar({ t, due, left, top, pxPerDay, onSelect, onDrop, freeze }: { t: Topic; due: string; left: number; top: number; pxPerDay: number; onSelect: (t: Topic) => void; onDrop: (due: string) => void; freeze: (on: boolean) => void }) {
  const fresh = useContext(UnlockCtx);
  const drag = useRef<{ x: number; id: number; moved: boolean } | null>(null);
  const [dx, setDx] = useState(0);
  const days = Math.round(dx / pxPerDay);
  const shown = days ? isoDay(Date.parse(due + "T00:00:00") + days * DAY) : due;
  const late = overdue(t, shown);
  const done = t.status === "done";
  const down = (e: RPointerEvent) => { if (e.button !== 0) return; drag.current = { x: e.clientX, id: e.pointerId, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); freeze(true); };
  const move = (e: RPointerEvent) => { const d = drag.current; if (!d) return; const x = e.clientX - d.x; if (Math.abs(x) > 3) d.moved = true; if (d.moved) setDx(x); };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    freeze(false);
    if (!d) return;
    if (!d.moved) { onSelect(t); return; }
    setDx(0);
    if (days) onDrop(shown);
  };
  return (
    <button onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setDx(0); freeze(false); }}
      title="Click to open · drag sideways to change the date"
      className={cx("absolute flex h-[30px] touch-none select-none items-center gap-2 whitespace-nowrap rounded-[8px] px-2.5 text-[12.5px] font-medium", dx ? "z-20 cursor-grabbing shadow-lg" : "cursor-grab hover:brightness-110", unlockCls(fresh, t))}
      style={{ left: left + dx, top, background: done ? "color-mix(in srgb, var(--success) 12%, var(--surface))" : "var(--surface)", border: `1px solid ${dx ? "var(--accent)" : late ? "var(--danger)" : "var(--border)"}`, opacity: t.locked ? 0.6 : 1 }}>
      <span className="size-[7px] rounded-full" style={{ background: done ? "var(--success)" : t.status === "learning" ? "var(--info)" : "var(--muted)" }} />
      {t.name}
      <span className={cx("text-[11.5px] font-normal", late ? "text-bad" : "text-muted")}>{fmtDay(shown)}{late ? " · overdue" : ""}</span>
    </button>
  );
}

// ------------------------------------------------------------------ topic sheet

type SheetProps = { note: Note; mods: Module[]; t: Topic; stats: ReturnType<typeof topicStats>; onClose: () => void; onStatus: (t: Topic, s: TopicStatus) => void; onOpen: (t: Topic, mode?: "edit" | "split") => void; onSelect: (t: Topic) => void; ops: TopicOps };

function useEsc(onClose: () => void) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
}

function StatusSelector({ t, onStatus, tall }: { t: Topic; onStatus: (t: Topic, s: TopicStatus) => void; tall?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Status" className="grid grid-cols-4 gap-0.5 rounded-[10px] border border-line bg-bg p-[3px] text-[13px]">
      {(["todo", "learning", "done", "skipped"] as TopicStatus[]).map((s) => (
        <button key={s} role="radio" aria-checked={t.status === s} onClick={() => onStatus(t, s)} className={cx("flex items-center justify-center gap-1.5 rounded-[7px]", tall ? "h-[38px]" : "h-[30px]", t.status === s ? "bg-surface font-semibold text-ink" : "text-muted hover:text-ink")}>
          {t.status === s && s !== "todo" && s !== "skipped" && <TopicDot s={s} size={10} />}{STATUS_LABEL[s]}
        </button>
      ))}
    </div>
  );
}

/** Body shared by the desktop side sheet and the expanded phone sheet. */
function SheetSections({ note, mods, t, stats, onStatus, onOpen, onSelect, phone, ops }: SheetProps & { phone?: boolean }) {
  const v = useVault();
  const fresh = useContext(UnlockCtx);
  const [adding, setAdding] = useState(false);
  const m = mods[t.module];
  const all = mods.flatMap((x) => x.topics);
  const byName = new Map(all.map((x) => [x.name.toLowerCase(), x]));
  const unlocks = all.filter((x) => x.needs.some((n) => n.toLowerCase() === t.name.toLowerCase()));
  const linkedNote = stats.linked;
  const fallback = !t.note ? v.byTitle.get(t.name.toLowerCase()) : undefined;
  const setNeeds = (needs: string[]) => void updateNote(note.id, { body: setTopicNeeds(note.body, t.line, needs) });
  const candidates = all.filter((x) => x.line !== t.line && !t.needs.some((n) => n.toLowerCase() === x.name.toLowerCase()) && !ancestors(all, x).has(t.line));
  const label = "text-[12px] font-medium text-muted";
  const blocking = t.needs.filter((n) => { const d = byName.get(n.toLowerCase()); return d && !finished(d); });

  return (
    <>
      {!phone && (
        <div className="flex flex-col gap-2"><span className={label}>Status</span>
          <StatusSelector t={t} onStatus={onStatus} />
          {t.locked && <span className="flex items-center gap-1.5 text-[12px] text-muted"><Lock size={12} />Locked until {blocking.join(", ")} {blocking.length > 1 ? "are" : "is"} done</span>}
        </div>
      )}

      <div className="flex flex-col gap-2"><span className={label}>Linked lesson</span>
        {linkedNote ? (
          <div className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-surface p-3">
            <div className="flex items-center gap-2"><FileText size={15} className="shrink-0 text-muted" /><span className="min-w-0 flex-1 truncate font-semibold" dir="auto">{linkedNote.title}</span><StatusDot status={linkedNote.status} className="size-[7px]" /></div>
            {lessonExcerpt(linkedNote.body) && <span className="line-clamp-2 text-[12.5px] leading-[19px] text-muted" dir="auto">{lessonExcerpt(linkedNote.body)}</span>}
            <div className="flex gap-2">
              <button onClick={() => onOpen(t)} className="flex h-8 items-center rounded-[10px] bg-accent px-3.5 font-semibold text-accent-fg hover:brightness-110">Open note</button>
              <button onClick={() => onOpen(t, "split")} className="flex h-8 items-center gap-1.5 rounded-[10px] border border-line px-3 hover:bg-surface-2"><Columns2 size={13} />Open in split</button>
            </div>
          </div>
        ) : (
          <button onClick={() => onOpen(t)} className="flex h-10 items-center justify-center gap-2 rounded-[10px] border border-dashed border-line text-muted hover:border-muted hover:text-ink">
            <Plus size={14} />{fallback ? `Link “${fallback.title}”` : "Create lesson note"}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2"><span className={label}>Prerequisites</span>
        <div className="flex flex-wrap gap-1.5">
          {t.needs.map((n) => {
            const d = byName.get(n.toLowerCase());
            const ok = finished(d);
            return (
              <span key={n} className="flex h-7 items-center gap-1.5 rounded-[6px] pl-2 pr-1.5"
                style={ok ? { background: "color-mix(in srgb, var(--success) 12%, var(--surface))", border: "1px solid color-mix(in srgb, var(--success) 40%, transparent)" } : { background: "var(--surface)", border: "1px solid var(--border)" }}>
                {ok ? <span className="flex size-3 items-center justify-center rounded-full bg-ok"><Check size={9} strokeWidth={3.5} style={{ color: "var(--bg)" }} /></span> : d ? <TopicDot s={d.status} size={12} /> : <span className="size-3 rounded-full border border-dashed border-muted" title="Not in this roadmap" />}
                <button onClick={() => d && onSelect(d)} className="hover:underline">{n}</button>
                <button aria-label={`Remove ${n}`} onClick={() => setNeeds(t.needs.filter((x) => x !== n))} className="text-muted hover:text-ink"><X size={12} /></button>
              </span>
            );
          })}
          {adding ? (
            <select autoFocus className="h-7 rounded-[6px] border border-line bg-bg px-1.5 text-[12.5px]" defaultValue="" onBlur={() => setAdding(false)}
              onChange={(e) => { if (e.target.value) setNeeds([...t.needs, e.target.value]); setAdding(false); }}>
              <option value="" disabled>Pick a topic…</option>
              {candidates.map((x) => <option key={x.line} value={x.name}>{x.name}</option>)}
            </select>
          ) : (
            <button onClick={() => setAdding(true)} disabled={!candidates.length} className="flex h-7 items-center gap-1.5 rounded-[6px] border border-dashed border-line px-2.5 text-muted hover:text-ink disabled:opacity-50"><Plus size={12} />Add</button>
          )}
        </div>
      </div>

      {unlocks.length > 0 && (
        <div className="flex flex-col gap-2"><span className={label}>Unlocks</span>
          <div className="flex flex-wrap gap-1.5">
            {unlocks.map((x) => <button key={x.line} onClick={() => onSelect(x)} className={cx("flex items-center gap-1.5 rounded-[6px] border border-line bg-surface px-2.5 py-1 hover:bg-surface-2", unlockCls(fresh, x))}>{x.locked ? <Lock size={11} className="text-muted" /> : <TopicDot s={x.status} size={11} />}{x.name}</button>)}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <label className="relative flex cursor-pointer flex-col gap-0.5 rounded-[10px] bg-surface px-3 py-2.5" title="Change due date">
          <span className="text-[12px] text-muted">Due</span>
          <span className={cx("font-semibold", overdue(t) ? "text-bad" : t.due ? "" : "text-muted")}>{t.due ? fmtLong(t.due) : m?.due ? `Module · ${fmtDay(m.due)}` : "Set date"}</span>
          <input type="date" className="absolute inset-0 cursor-pointer opacity-0" value={t.due ?? ""} onChange={(e) => void updateNote(note.id, { body: setTopicDue(note.body, t.line, e.target.value || null) })} />
        </label>
        <div className="flex flex-col gap-0.5 rounded-[10px] bg-surface px-3 py-2.5">
          <span className="text-[12px] text-muted">In this topic</span>
          <span className="font-semibold">{stats.notes ? `${stats.notes} note${stats.notes === 1 ? "" : "s"}${stats.cards ? ` · ${stats.cards} card${stats.cards === 1 ? "" : "s"}` : ""}` : "No notes yet"}</span>
        </div>
      </div>
      <TopicOrganize t={t} phone={phone} ops={ops} />
    </>
  );
}

function TopicSheet(props: SheetProps) {
  const { mods, t, onClose } = props;
  useEsc(onClose);
  const m = mods[t.module];
  return (
    <aside className="sheet-in absolute bottom-3 right-3 top-3 z-40 flex w-[380px] flex-col overflow-hidden rounded-[14px] border border-line bg-surface-2 lm-sheet" aria-label={`Topic ${t.name}`}>
      <div className="flex flex-col gap-1.5 border-b border-line px-5 pb-3.5 pt-[18px]">
        <div className="flex items-center justify-between text-[12px] text-muted">
          <span className="truncate">{m?.name ?? "Topics"} · Topic {(m?.topics.indexOf(t) ?? 0) + 1} of {m?.topics.length ?? 1}</span>
          <button aria-label="Close" title="Close (Esc)" onClick={onClose} className="-m-1 rounded-md p-1 hover:bg-surface hover:text-ink"><X size={16} /></button>
        </div>
        <input key={t.name} defaultValue={t.name} dir="auto" aria-label="Topic name" title="Rename (updates every “needs” that mentions it)"
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) props.ops.rename(t, v); }}
          className="-mx-1 rounded-[6px] bg-transparent px-1 text-[20px] font-[650] tracking-[-.01em] outline-none focus:bg-surface" />
      </div>
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4 text-[13px]">
        <SheetSections {...props} />
      </div>
    </aside>
  );
}

/** Phone: peek sheet (title, status, needs, open lesson); drag the handle up for the full editor. */
function PhoneTopicSheet(props: SheetProps) {
  const { mods, t, onClose, onStatus, onOpen, stats } = props;
  useEsc(onClose);
  const [full, setFull] = useState(false);
  const drag = useRef<number | null>(null);
  const all = mods.flatMap((x) => x.topics);
  const byName = new Map(all.map((x) => [x.name.toLowerCase(), x]));
  const dueCls = !t.due ? "text-muted" : overdue(t) ? "text-bad" : "text-warn";
  return (
    <>
      <aside className="sheet-in safe-b fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col gap-3 rounded-t-[14px] border-t border-line bg-surface-2 px-4 pt-2.5 text-[13px]" aria-label={`Topic ${t.name}`}>
        <div className="flex touch-none justify-center py-1" role="button" aria-label={full ? "Collapse" : "Expand"}
          onPointerDown={(e) => { drag.current = e.clientY; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
          onPointerUp={(e) => { const y0 = drag.current; drag.current = null; if (y0 === null) return; const dy = e.clientY - y0; if (dy < -24) setFull(true); else if (dy > 24) (full ? setFull(false) : onClose()); else setFull((x) => !x); }}>
          <span className="h-1 w-9 rounded-[2px] bg-[var(--border)]" />
        </div>
        <div className="flex items-center gap-3"><span className="min-w-0 flex-1 truncate text-[17px] font-[650]" dir="auto">{t.name}</span>
          <span className={cx("shrink-0 text-[12.5px]", dueCls)}>{t.due ? `Due ${fmtLong(t.due)}` : t.locked ? "Locked" : ""}</span></div>
        <StatusSelector t={t} onStatus={onStatus} tall />
        <div className={cx("flex min-h-0 flex-col gap-3 overflow-y-auto", full && "gap-5")}>
          {!full && t.needs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5"><span className="mr-0.5 text-[12px] text-muted">Needs</span>
              {t.needs.map((n) => {
                const ok = finished(byName.get(n.toLowerCase()));
                return <span key={n} className="flex h-[30px] items-center gap-1.5 rounded-[6px] px-2.5"
                  style={ok ? { background: "color-mix(in srgb, var(--success) 12%, var(--surface))", border: "1px solid color-mix(in srgb, var(--success) 40%, transparent)" } : { background: "var(--surface)", border: "1px solid var(--border)" }}>
                  {ok ? <Check size={12} className="text-ok" /> : <Lock size={11} className="text-muted" />}{n}</span>;
              })}
            </div>
          )}
          {full && <SheetSections {...props} phone />}
        </div>
        <div className="flex gap-2.5 pb-3">
          <button onClick={() => onOpen(t)} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[12px] bg-accent font-semibold text-accent-fg"><FileText size={15} />{stats.linked ? "Open lesson note" : "Create lesson note"}</button>
        </div>
      </aside>
    </>
  );
}

/** Move / rename / delete without dragging: the phone path (no hover, no drag) and the keyboard-free desktop alternative. */
function TopicOrganize({ t, phone, ops }: { t: Topic; phone?: boolean; ops: TopicOps }) {
  const { body, write, mods } = ops;
  const label = "text-[12px] font-medium text-muted";
  const btn = cx("flex items-center justify-center gap-1.5 rounded-[8px] border border-line hover:bg-surface", phone ? "h-10 px-3" : "h-8 px-2.5");
  const nudge = (dir: -1 | 1) => { const md = nudgeTopic(body, t.line, dir); if (md !== body) { write(md); announce(`${t.name} moved ${dir < 0 ? "up" : "down"}`); } };
  return (
    <div className="flex flex-col gap-2"><span className={label}>Organize</span>
      {phone && (
        <input key={t.name} defaultValue={t.name} dir="auto" aria-label="Topic name" onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) ops.rename(t, v); }}
          className="h-10 rounded-[8px] border border-line bg-bg px-3 text-[14px] outline-none" />
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <button className={btn} onClick={() => nudge(-1)} aria-label="Move up"><ArrowUp size={13} />{phone && "Up"}</button>
        <button className={btn} onClick={() => nudge(1)} aria-label="Move down"><ArrowDown size={13} />{phone && "Down"}</button>
        <select aria-label="Move to module" value={t.module} className={cx("min-w-0 flex-1 rounded-[8px] border border-line bg-bg px-2", phone ? "h-10" : "h-8")}
          onChange={(e) => { const i = Number(e.target.value); write(moveTopic(body, t.line, i, null)); announce(`${t.name} moved to ${mods[i]?.name}`); }}>
          {mods.map((m, i) => <option key={i} value={i}>{i === t.module ? `In ${m.name}` : `Move to ${m.name}`}</option>)}
        </select>
        <button className={cx(btn, "text-bad hover:bg-bad/10")} onClick={() => ops.remove(t)} aria-label="Delete topic"><Trash2 size={13} />{phone && "Delete"}</button>
      </div>
    </div>
  );
}
