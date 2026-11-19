import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, type Connection, type Edge, type Node as RFNode, type NodeProps } from "@xyflow/react";
import { ArrowDown, ArrowUp, BookOpen, Brain, CalendarDays, Check, ChevronDown, ExternalLink, FileText, GitMerge, GripVertical, Grid3x3, Layers, Link2, Loader2, Lock, MoreHorizontal, Network, NotebookPen, Plus, RotateCcw, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { Fragment, memo, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as RKeyboardEvent } from "react";
import type { Note } from "../../shared/types";
import { createNote, findOrCreateByTitle, updateNote } from "../lib/actions";
import { aiRun, getToken } from "../lib/api";
import { hydrate } from "../lib/markdown";
import { embedHtml } from "../lib/markdown";
import { excerpt, linkTopicNote, setTopicStatus, type TopicStatus } from "../lib/parse";
import {
  addConcept, addConceptNeed, addResource, addStage, autoOrganize, buildPath, cellStatus, linkNote, markRevised, mergeConcepts, moveAlias, moveConcept, moveStage, norm, nudgeConcept, pathNeeds, pathProgress, placeConcept,
  MASTERY_INTERVAL, overlapSuggestions, removeConcept, removeConceptNeed, removeResource, removeStage, renameConcept, renameStage, reorderStage, resolveCourses, REVIEW_LADDER, scheduleNewlyDone, serializePath, setManualDone, UNPLACED, wouldCycle,
  type BuiltConcept, type BuiltPath, type CourseRef,
} from "../lib/path";
import { go, openNote, toast, useVault } from "../lib/store";
import { Button, cx, inputCls, Segmented } from "../components/ui";
import { Ring } from "./RoadmapView";
import { ConceptPractice } from "../components/ConceptPractice";
import { usePhone } from "./spaces-util";
import { announce, dragging, dragKind, dropData, endDrag, NotesTray, startDrag, useConfirm, useRefocus, zoneX, zoneY } from "./dnd-parts";

type Ask = ReturnType<typeof useConfirm>[1];
const sel$ = (attr: string, v: string) => `[${attr}="${CSS.escape(v)}"]`;

type Tab = "stages" | "matrix" | "graph" | "timeline" | "revise";
const ST_COLOR: Record<string, string> = { todo: "var(--muted)", learning: "var(--info)", done: "var(--success)", locked: "var(--muted)", skipped: "var(--muted)" };

// ------------------------------------------------------------------ resources: from the path + from course lesson notes
export interface Res { label: string; url: string; kind: "video" | "article" | "book" | "course" | "file" | "link"; from: string }
const kindOf = (u: string): Res["kind"] =>
  /youtu\.?be|vimeo\.com|\.(mp4|webm|mov)(\?|$)/i.test(u) ? "video" : /\.(pdf|epub)(\?|$)/i.test(u) ? "book" : /coursera|edx|udemy|khanacademy|fast\.ai|stanford\.edu|mit\.edu|deeplearning\.ai/i.test(u) ? "course" : /^att:/.test(u) ? "file" : /medium|blog|substack|dev\.to|wikipedia|arxiv|github\.io/i.test(u) ? "article" : "link";
const KIND_ICON: Record<Res["kind"], string> = { video: "▶", article: "📄", book: "📘", course: "🎓", file: "📎", link: "🔗" };

function conceptResources(c: BuiltConcept, notes: Map<string, Note>): Res[] {
  const out: Res[] = c.def.resources.map((r) => ({ ...r, kind: kindOf(r.url), from: "Path" }));
  const seen = new Set(out.map((r) => r.url));
  const lessonTitles = new Set([...c.def.notes, ...c.coverage.map((x) => x.topic.note ?? x.topic.name)]);
  for (const t of lessonTitles) {
    const n = notes.get(t.toLowerCase());
    if (!n || n.type === "canvas" || n.type === "whiteboard") continue;
    const course = c.coverage.find((x) => (x.topic.note ?? x.topic.name).toLowerCase() === t.toLowerCase())?.course.title ?? "Note";
    for (const m of n.body.matchAll(/\[([^\]]+)\]\((https?:[^)\s]+|att:[^)\s]+)\)|(?:^|\s)(https?:\/\/[^\s)]+)/gm)) {
      const url = m[2] ?? m[3];
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ label: m[1] ?? url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60), url, kind: kindOf(url), from: course });
    }
  }
  return out;
}

// ------------------------------------------------------------------ main view
export function PathView({ note }: { note: Note }) {
  const v = useVault();
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem("lumen.path.tab") as Tab) || "stages");
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const courseNames = useMemo(() => buildPath(note.body, []).doc.courses, [note.body]);
  const courses = useMemo(() => resolveCourses(courseNames, v.notes, v.spaces), [courseNames, v.notes, v.spaces]);
  const path = useMemo(() => buildPath(note.body, courses), [note.body, courses]);
  const prog = pathProgress(path);
  const save = (body: string) => void updateNote(note.id, { body });
  useEffect(() => { try { localStorage.setItem("lumen.path.tab", tab); } catch { /* ignore */ } }, [tab]);
  // concepts that just became done enter the revision ladder
  useEffect(() => { const b = scheduleNewlyDone(note.body, path); if (b && b !== note.body) save(b); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = sel ? path.byKey.get(sel) ?? null : null;
  const phone = usePhone();
  const [confirmNode, confirm] = useConfirm();
  // summary header: collapsed by default for big paths (many course chips); remembered per path
  const headKey = `lumen.path.head.${note.id}`;
  const [headOpen, setHeadOpen] = useState(() => { try { const v = localStorage.getItem(headKey); if (v) return v === "1"; } catch { /* ignore */ } return courseNames.length <= 6; });
  const toggleHead = () => setHeadOpen((o) => { try { localStorage.setItem(headKey, o ? "0" : "1"); } catch { /* ignore */ } return !o; });
  const overlapCount = useMemo(() => { let d: string[] = []; try { d = JSON.parse(localStorage.getItem(`lumen.path.dismiss.${note.id}`) ?? "[]"); } catch { /* ignore */ } return overlapSuggestions(path, d).length; }, [path, note.id]);

  async function aiOrganize() {
    if (!getToken()) return toast("AI needs sync on (Settings → Sync).");
    setBusy(true);
    try {
      const list = path.concepts.map((c) => `- ${c.def.name} [${[...new Set(c.coverage.map((x) => x.course.title))].join(", ")}]${c.needs.length ? ` (needs: ${c.needs.map((n) => path.byKey.get(n)?.def.name).join(", ")})` : ""}`).join("\n");
      const md = await aiRun("path", `Courses: ${courses.map((c) => c.title).join(", ")}\nConcepts:\n${list}`);
      // AI returns "## Stage" + "- Concept" lines; keep our concept data and only adopt its grouping/order/merges
      const ai = buildPath(`---\ntype: path\n---\n# x\n\n${md}`, []).doc;
      let body = serializePath({ ...path.doc, stages: [] });
      const known = new Map(path.concepts.map((c) => [c.key, c]));
      for (const s of ai.stages) {
        body = addStage(body, s.name);
        for (const d of s.concepts) {
          const target = known.get(norm(d.name)) ?? [...known.values()].find((c) => d.aliases.map(norm).includes(c.key));
          if (target) { body = moveConcept(body, target, s.name); known.delete(target.key); }
          for (const a of d.aliases) { const other = known.get(norm(a)); if (other && target) { body = mergeConcepts(body, target, other); known.delete(other.key); } }
        }
      }
      save(body);
      toast("Organized with AI. Check the stages and adjust.");
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }

  const tabs: { value: Tab; label: React.ReactNode }[] = [
    { value: "stages", label: <><Layers size={13} /> Stages</> },
    { value: "matrix", label: <><Grid3x3 size={13} /> Matrix</> },
    { value: "graph", label: <><Network size={13} /> Graph</> },
    { value: "timeline", label: <><CalendarDays size={13} /> Timeline</> },
    { value: "revise", label: <><Brain size={13} /> Revise{prog.review ? ` · ${prog.review}` : ""}</> },
  ];

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-line px-4 pb-2.5 pt-3 md:px-5 md:pb-3 md:pt-4">
          <div className="flex items-center gap-3 md:gap-4">
            <button onClick={toggleHead} aria-expanded={headOpen} title={headOpen ? "Collapse summary" : "Show courses and overlaps"} className="flex min-w-0 flex-1 items-center gap-3 text-left md:gap-4">
              <Ring pct={prog.pct} size={headOpen ? (phone ? 44 : 52) : 36} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">
                  <span className="truncate">Learning path · {courses.length} courses</span>
                  {!headOpen && overlapCount > 0 && <span className="shrink-0 rounded-full bg-accent/15 px-1.5 text-[10.5px] normal-case tracking-normal text-accent">{overlapCount} overlaps</span>}
                  <ChevronDown size={13} className={cx("shrink-0 transition-transform", headOpen && "rotate-180")} />
                </span>
                <span className={cx("block text-[13px] leading-snug text-muted", !headOpen && "truncate")}><b className="text-ink">{prog.done}</b>/{prog.total} learned · {prog.mastered} mastered · {prog.learning} learning · <span className={prog.review ? "text-learn" : ""}>{prog.review} to revise</span></span>
              </span>
            </button>
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" title="Auto-organize: rebuild stages from prerequisites" onClick={() => { save(autoOrganize(note.body, path)); toast("Stages rebuilt from prerequisites across all courses"); }}><Wand2 size={14} />{!phone && " Auto-organize"}</Button>
              <Button size="sm" variant="ghost" title="AI organize" onClick={aiOrganize} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{!phone && " AI organize"}</Button>
            </div>
          </div>
          {headOpen && <CourseChips courses={courses} path={path} note={note} phone={phone} />}
          {headOpen && <Overlaps path={path} note={note} save={save} />}
          <div className={cx("mt-2.5 md:mt-3", phone && "-mx-4 overflow-x-auto px-4 [scrollbar-width:none]")}>
            <Segmented className={phone ? "w-max" : ""} value={tab} onChange={setTab} options={tabs} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {tab === "stages" ? <Stages path={path} note={note} onOpen={setSel} save={save} confirm={confirm} />
            : !courses.length && !path.concepts.length ? (
            <div className="mx-auto max-w-md p-10 text-center text-[13px] text-muted">Add courses to this path (button above), or build it yourself in Stages. Each course keeps its own roadmap; the path merges overlapping topics into concepts.</div>
          )
            : tab === "matrix" ? <Matrix path={path} onOpen={setSel} />
            : tab === "graph" ? <ReactFlowProvider><Graph path={path} onOpen={setSel} sel={sel} note={note} save={save} /></ReactFlowProvider>
            : tab === "timeline" ? <Timeline path={path} onOpen={setSel} />
            : <Revise path={path} note={note} save={save} onOpen={setSel} />}
        </div>
      </div>
      {selected && <ConceptSheet c={selected} path={path} note={note} save={save} onClose={() => setSel(null)} onOpen={setSel} confirm={confirm} />}
      {confirmNode}
    </div>
  );
}

/** Course chips: one swipeable line on phones, wrapped on wider screens; long lists collapse behind "+N more". */
function CourseChips({ courses, path, note, phone }: { courses: CourseRef[]; path: BuiltPath; note: Note; phone: boolean }) {
  const [all, setAll] = useState(false);
  const LIMIT = 8;
  const shown = phone || all ? courses : courses.slice(0, LIMIT);
  return (
    <div className={cx("mt-2 flex gap-1.5", phone ? "-mx-4 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]" : "flex-wrap")}>
      {shown.map((c) => <CourseChip key={c.key} c={c} path={path} />)}
      {!phone && courses.length > LIMIT && (
        <button onClick={() => setAll((a) => !a)} className="flex h-6 shrink-0 items-center rounded-full border border-line px-2 text-[12px] text-muted hover:text-ink">{all ? "Show less" : `+${courses.length - LIMIT} more`}</button>
      )}
      <CoursePicker note={note} path={path} />
    </div>
  );
}

function CourseChip({ c, path }: { c: CourseRef; path: BuiltPath }) {
  const total = path.concepts.filter((x) => x.coverage.some((y) => y.course.key === c.key));
  const done = total.filter((x) => cellStatus(x, c) === "done").length;
  return (
    <button onClick={() => (c.spaceId ? go("space", { spaceId: c.spaceId, folderId: null, noteId: null }) : c.note && openNote(c.note.id))} title={c.spaceId ? `Open the ${c.spaceName} course page` : c.note ? `Open ${c.title}` : "Course roadmap not found"}
      className={cx("flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[12px] md:h-6 md:px-2", c.note ? "hover:border-ink" : "opacity-60")}
      style={{ borderColor: `color-mix(in srgb, ${c.color} 45%, transparent)`, background: `color-mix(in srgb, ${c.color} 12%, transparent)` }}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: c.color }} />
      <span className="max-w-[190px] truncate md:max-w-[240px]">{c.spaceIcon} {c.spaceName}</span>
      <span className="tabular-nums text-muted">{done}/{total.length}</span>
    </button>
  );
}

function CoursePicker({ note, path }: { note: Note; path: BuiltPath }) {
  const v = useVault();
  const [open, setOpen] = useState(false);
  const options = useMemo(() => {
    const fromSpaces = v.spaces.filter((s) => s.kind === "course" && s.roadmapId).map((s) => s.name);
    const loose = v.notes.filter((n) => n.type === "roadmap" && !v.spaces.some((s) => s.roadmapId === n.id)).map((n) => n.title);
    return [...new Set([...fromSpaces, ...loose])];
  }, [v.spaces, v.notes]);
  const set = (names: string[]) => void updateNote(note.id, { body: serializePath({ ...path.doc, courses: names }) });
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex h-6 items-center gap-1 rounded-full border border-dashed border-line px-2 text-[12px] text-muted hover:text-ink"><Plus size={12} /> Courses</button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="fixed inset-x-3 bottom-3 z-40 max-h-[70vh] overflow-y-auto rounded-[14px] border border-line bg-surface p-1.5 shadow-xl fade-in md:absolute md:inset-x-auto md:bottom-auto md:left-0 md:top-full md:mt-1 md:max-h-[60vh] md:w-72 md:rounded-[12px]">
            <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Courses in this path</div>
            {options.map((o) => {
              const on = path.doc.courses.some((c) => c.toLowerCase() === o.toLowerCase());
              return (
                <button key={o} onClick={() => set(on ? path.doc.courses.filter((c) => c.toLowerCase() !== o.toLowerCase()) : [...path.doc.courses, o])} className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[13px] hover:bg-surface-2">
                  <span className={cx("flex size-4 items-center justify-center rounded-[4px] border", on ? "border-accent bg-accent text-accent-fg" : "border-line")}>{on && <Check size={11} />}</span>{o}
                </button>
              );
            })}
            {!options.length && <div className="px-2 py-2 text-[12.5px] text-muted">No course roadmaps yet. Create a Course space first.</div>}
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Stages (kanban of stages, drag concepts)
/** Concept state + how to complete it: learned via any one course or "I already know this"; mastery after spaced reviews. */
function MasteryBox({ c, path, onToggle, onOpen }: { c: BuiltConcept; path: BuiltPath; onToggle: (on: boolean) => void; onOpen: (k: string) => void }) {
  const learned = c.status === "done";
  const via = c.learnedVia === "manual" ? "you marked it learned" : c.learnedVia ? `finished in ${path.courses.find((x) => x.key === c.learnedVia)?.spaceName ?? c.learnedVia}` : null;
  const step = Math.max(0, REVIEW_LADDER.indexOf(c.def.interval)) + 1;
  const toMastery = REVIEW_LADDER.indexOf(MASTERY_INTERVAL) + 1;
  const blockers = c.needs.map((n) => path.byKey.get(n)).filter((x): x is BuiltConcept => !!x && x.status !== "done");
  return (
    <section className={cx("rounded-[12px] border p-3", learned ? "border-ok/40 bg-ok/[.06]" : "border-line bg-surface-2/40")}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-[13px]">
          <b className={learned ? "text-ok" : "text-ink"}>{c.mastered ? "★ Mastered" : learned ? "✓ Learned" : c.status === "locked" ? "Locked" : c.status === "learning" ? "In progress" : "Not started"}</b>
          {via && <span className="text-muted"> · {via}</span>}
        </span>
        <Button size="sm" variant={learned ? "ghost" : "primary"} onClick={() => onToggle(c.learnedVia !== "manual")} disabled={learned && c.learnedVia !== "manual"}
          title={learned && c.learnedVia !== "manual" ? "Learned through a course: unmark its lessons there to undo" : undefined}>
          {c.learnedVia === "manual" ? "Unmark" : learned ? "Learned" : <><Check size={13} /> Mark learned</>}
        </Button>
      </div>
      {!learned && (
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
          Finish its lessons in <b>any one</b> course below, or mark it learned if you already know it. The other courses stay as optional extra material.
          {blockers.length > 0 && <> Needs first: {blockers.slice(0, 4).map((b, i) => <Fragment key={b.key}>{i > 0 && ", "}<button onClick={() => onOpen(b.key)} className="text-link hover:underline" dir="auto">{b.def.name}</button></Fragment>)}{blockers.length > 4 && ` +${blockers.length - 4}`}.</>}
        </p>
      )}
      {learned && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-[11.5px] text-muted"><span>{c.mastered ? "Mastered · keep reviewing occasionally" : `Review ${Math.min(step, toMastery)} of ${toMastery} to mastery`}</span>{c.def.review && <span>next review {c.def.review}</span>}</div>
          <div className="mt-1 flex gap-1">{Array.from({ length: toMastery }, (_, i) => <span key={i} className={cx("h-1.5 flex-1 rounded-full", i < (c.mastered ? toMastery : step - 1) ? "bg-ok" : "bg-surface-2")} />)}</div>
        </div>
      )}
    </section>
  );
}

/** Drag & drop wiring for one concept card (desktop board). */
type CardDnd = { cls: string; tag: string | null; over: (e: DragEvent) => void; drop: (e: DragEvent) => void; key: (e: RKeyboardEvent) => void; dragging: boolean };

function ConceptCard({ c, onOpen, drag, dnd }: { c: BuiltConcept; onOpen: (k: string) => void; drag?: boolean; dnd?: CardDnd }) {
  const courses = [...new Map(c.coverage.map((x) => [x.course.key, x.course])).values()];
  return (
    <button draggable={drag} data-concept={c.key} data-pdnd-row
      onDragStart={(e) => startDrag(e, "concept", c.key, c.def.name)} onDragEnd={() => endDrag()}
      onDragOver={dnd?.over} onDrop={dnd?.drop} onKeyDown={dnd?.key} onClick={() => onOpen(c.key)}
      aria-label={dnd ? `${c.def.name}, ${c.status}. Alt+arrows to move.` : undefined}
      className={cx("group relative flex w-full flex-col gap-1.5 rounded-[10px] border border-line bg-surface p-2.5 text-left hover:border-ink/40", c.status === "locked" && "opacity-60", c.reviewDue && "ring-1 ring-learn/60", dnd?.cls, dnd?.dragging && "pdnd-dragging")}>
      <span className="flex items-start gap-2">
        {c.status === "locked" ? <Lock size={13} className="mt-0.5 shrink-0 text-muted" /> : <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: ST_COLOR[c.status] }} />}
        <span dir="auto" className={cx("flex-1 text-[13.5px] font-medium leading-snug", c.status === "done" && "text-muted")}>{c.def.name}</span>
        {c.reviewDue && <span className="rounded-full bg-learn/15 px-1.5 text-[10.5px] font-semibold text-learn">revise</span>}
        {c.mastered && !c.reviewDue && <span title="Mastered: spaced reviews reached the 14-day step" className="rounded-full bg-ok/15 px-1.5 text-[10.5px] font-semibold text-ok">★ mastered</span>}
        {drag && <GripVertical size={13} aria-hidden className="pdnd-grip mt-0.5 shrink-0 text-muted" />}
      </span>
      <span className="flex flex-wrap items-center gap-1">
        {courses.slice(0, 8).map((k) => <span key={k.key} title={k.title} className="size-2 rounded-full" style={{ background: k.color }} />)}
        {courses.length > 8 && <span className="text-[10.5px] text-muted">+{courses.length - 8}</span>}
        {courses.length > 1 && <span className="ml-1 text-[11px] text-muted">{courses.length} courses</span>}
        {!courses.length && <span className="text-[11px] text-muted">your own</span>}
        {c.def.resources.length > 0 && <span className="ml-auto text-[11px] text-muted">{c.def.resources.length} res.</span>}
      </span>
      {dnd?.tag && <span className="pdnd-tag">{dnd.tag}</span>}
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

/** Phone: everything drag does on desktop, as an explicit menu (no hover, no drag). */
function PhoneConceptMenu({ c, path, note, save, confirm, onClose }: { c: BuiltConcept; path: BuiltPath; note: Note; save: (b: string) => void; confirm: Ask; onClose: () => void }) {
  const [mode, setMode] = useState<"main" | "stage" | "merge">("main");
  const [q, setQ] = useState("");
  const stages = path.doc.stages.map((s) => s.name);
  const run = (b: string, msg: string) => { save(b); announce(msg); toast(msg); onClose(); };
  const row = "flex min-h-[48px] w-full items-center gap-3 rounded-[10px] px-3 text-left text-[15px] active:bg-surface-2";
  const idx = path.stages.find((s) => s.name === c.stage)?.concepts.findIndex((x) => x.key === c.key) ?? -1;
  const n = path.stages.find((s) => s.name === c.stage)?.concepts.length ?? 0;
  const targets = path.concepts.filter((x) => x.key !== c.key && (!q || x.def.name.toLowerCase().includes(q.toLowerCase()))).slice(0, 60);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div role="dialog" aria-label={`Move ${c.def.name}`} className="sheet-in safe-b fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col rounded-t-[14px] border-t border-line bg-surface px-2 pb-3 pt-2">
        <div className="flex items-center gap-2 px-3 pb-2 pt-1"><span dir="auto" className="min-w-0 flex-1 truncate text-[16px] font-semibold">{c.def.name}</span><button aria-label="Close" onClick={onClose} className="p-2 text-muted"><X size={18} /></button></div>
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
                <button key={x.key} className={row} onClick={() => { onClose(); confirm(<>Merge “<b dir="auto">{c.def.name}</b>” into “<b dir="auto">{x.def.name}</b>”? Its course topics, resources and notes join it.</>, "Merge", () => { save(mergeConcepts(note.body, x, c)); toast(`Merged into “${x.def.name}”`); }); }}>
                  <span dir="auto" className="min-w-0 flex-1 truncate">{x.def.name}</span><span className="shrink-0 text-[12px] text-muted">{x.placed ? x.stage.replace(/^Stage \d+ · /, "") : "not placed"}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** Phones: stages as a vertical list of collapsible sections (the first unfinished stage starts open). */
function StagesPhone({ path, note, onOpen, save, confirm }: { path: BuiltPath; note: Note; onOpen: (k: string) => void; save: (b: string) => void; confirm: Ask }) {
  const firstOpen = path.stages.find((s) => s.concepts.some((c) => c.status !== "done"))?.name ?? path.stages[0]?.name;
  const [open, setOpen] = useState<Set<string>>(() => new Set(firstOpen ? [firstOpen] : []));
  const [newStage, setNewStage] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [notes, setNotes] = useState(false);
  const toggle = (n: string) => setOpen((o) => { const s = new Set(o); s.has(n) ? s.delete(n) : s.add(n); return s; });
  const menuC = menu ? path.byKey.get(menu) : null;
  const used = useMemo(() => new Set(path.concepts.flatMap((c) => [c.key, ...c.def.notes.map((n) => n.toLowerCase())]).concat(path.concepts.map((c) => c.def.name.toLowerCase()))), [path]);
  const lastStage = path.doc.stages[path.doc.stages.length - 1]?.name ?? "Stage 1";
  return (
    <div className="flex flex-col gap-2 p-3 pb-24">
      {!path.courses.length && <p className="px-1 text-[12.5px] leading-relaxed text-muted">No courses yet: build your own path. Add stages, type concepts, or add notes as concepts.</p>}
      {path.stages.map((s, i) => {
        const done = s.concepts.filter((c) => c.status === "done").length;
        const learning = s.concepts.filter((c) => c.status === "learning").length;
        const unplaced = s.name === UNPLACED;
        const isOpen = open.has(s.name);
        return (
          <section key={s.name} className={cx("rounded-[14px]", unplaced ? "border border-dashed border-line" : "border border-line bg-surface-2/40")}>
            <button onClick={() => toggle(s.name)} aria-expanded={isOpen} className="flex w-full items-center gap-2.5 px-3 py-3 text-left">
              <span className={cx("flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums", done === s.concepts.length && s.concepts.length ? "bg-ok/20 text-ok" : "bg-surface-2 text-muted")}>{unplaced ? "•" : i + 1}</span>
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block truncate text-[14px] font-semibold">{s.name.replace(/^Stage \d+ · /, "")}</span>
                <span className="mt-1 flex items-center gap-2">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-ok" style={{ width: `${s.concepts.length ? (done / s.concepts.length) * 100 : 0}%` }} /></span>
                  <span className="text-[11.5px] tabular-nums text-muted">{done}/{s.concepts.length}{learning ? ` · ${learning} active` : ""}</span>
                </span>
              </span>
              <ChevronDown size={16} className={cx("shrink-0 text-muted transition-transform", !isOpen && "-rotate-90")} />
            </button>
            {isOpen && (
              <div className="flex flex-col gap-1.5 px-2 pb-2">
                {unplaced && <p className="px-1 pb-1 text-[12px] text-muted">Course topics not in any stage yet. Use ⋯ to place one, or Auto-organize (wand icon above).</p>}
                {s.concepts.map((c) => (
                  <div key={c.key} className="flex items-stretch gap-1">
                    <div className="min-w-0 flex-1"><ConceptCard c={c} onOpen={onOpen} /></div>
                    <button aria-label={`Move or merge ${c.def.name}`} onClick={() => setMenu(c.key)} className="flex w-11 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface text-muted"><MoreHorizontal size={18} /></button>
                  </div>
                ))}
                {!unplaced && <AddConcept big onAdd={(n) => { const b = addConcept(note.body, s.name, n); if (b === serializePath(path.doc)) toast(`“${n}” is already in this path`); else save(b); }} />}
                {!unplaced && (
                  <div className="flex justify-end gap-3 px-1 pt-1 text-[12px] text-muted">
                    {i > 0 && <button onClick={() => save(moveStage(note.body, s.name, -1))} className="flex items-center gap-1 py-1"><ArrowUp size={12} /> Move up</button>}
                    {i < path.stages.length - 1 && path.stages[i + 1]?.name !== UNPLACED && <button onClick={() => save(moveStage(note.body, s.name, 1))} className="flex items-center gap-1 py-1"><ArrowDown size={12} /> Move down</button>}
                    {!s.concepts.length && <button onClick={() => save(removeStage(note.body, s.name))} className="flex items-center gap-1 py-1"><Trash2 size={12} /> Delete</button>}
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
      <form onSubmit={(e) => { e.preventDefault(); if (newStage.trim()) { save(addStage(note.body, newStage.trim())); setNewStage(""); } }}>
        <input value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="+ New stage" className={inputCls} />
      </form>
      <button onClick={() => setNotes(true)} className="flex h-11 items-center justify-center gap-2 rounded-[12px] border border-line text-[14px] text-muted"><NotebookPen size={15} />Add notes as concepts</button>
      {notes && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setNotes(false)} />
          <div className="sheet-in safe-b fixed inset-x-0 bottom-0 z-50 flex h-[70dvh] flex-col overflow-hidden rounded-t-[14px] border-t border-line">
            <NotesTray className="h-full" spaceId={note.spaceId} used={used} onClose={() => setNotes(false)} title="Add notes as concepts" hint={<>Tap + to add a note as a concept in the last stage ({lastStage.replace(/^Stage \d+ · /, "")}).</>}
              onPick={(n) => { save(addConcept(note.body, lastStage, n.title, { note: n.title })); toast(`Added “${n.title}”`); }} />
          </div>
        </>
      )}
      {menuC && <PhoneConceptMenu c={menuC} path={path} note={note} save={save} confirm={confirm} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Drop feedback on the board: before/after a card, merge into a card, end of a column, before/after a column. */
type SHint = { kind: "before" | "after" | "merge" | "alias" | "link"; key: string } | { kind: "end" | "col-before" | "col-after"; stage: string } | null;

/**
 * Desktop stage board. Drag a card: between cards (reorder / move), onto a card's middle (merge, with confirm), into
 * "Not placed yet" (take it out). Drag a stage header to reorder stages. Drop notes from the tray to create concepts, or onto a
 * card to link them. Drag a course topic from the concept sheet onto a card to make it an alias there.
 */
function Stages({ path, note, onOpen, save, confirm }: { path: BuiltPath; note: Note; onOpen: (k: string) => void; save: (b: string) => void; confirm: Ask }) {
  const phone = usePhone();
  const [hint, setHint] = useState<SHint>(null);
  const [newStage, setNewStage] = useState("");
  const [tray, setTray] = useState(() => !path.concepts.length);
  const refocus = useRefocus(note.body);
  const used = useMemo(() => new Set(path.concepts.flatMap((c) => [c.def.name.toLowerCase(), ...c.def.notes.map((n) => n.toLowerCase())])), [path]);
  if (phone) return <StagesPhone path={path} note={note} onOpen={onOpen} save={save} confirm={confirm} />;
  const body = note.body;
  const set = (h: SHint) => setHint((o) => (JSON.stringify(o) === JSON.stringify(h) ? o : h));
  const finish = () => { setHint(null); endDrag(); };
  const real = path.stages.filter((s) => s.name !== UNPLACED);
  const firstStage = real[0]?.name ?? "Stage 1";
  const unchanged = (b: string) => b === serializePath(path.doc);

  const cardDnd = (c: BuiltConcept, s: { name: string; concepts: BuiltConcept[] }, i: number): CardDnd => {
    const h = hint && "key" in hint && hint.key === c.key ? hint : null;
    return {
      cls: h ? (h.kind === "before" ? "pdnd-before" : h.kind === "after" ? "pdnd-after" : "pdnd-inside") : "",
      tag: h ? (h.kind === "merge" ? "merge" : h.kind === "alias" ? "add as alias" : h.kind === "link" ? "link note" : null) : null,
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
          confirm(<>Merge “<b dir="auto">{other.def.name}</b>” into “<b dir="auto">{c.def.name}</b>”? Its course topics, resources and notes join it; its name becomes an alias.</>, "Merge", doMerge);
          return;
        }
        if (s.name === UNPLACED) { if (other.placed) { save(removeConcept(body, other)); announce(`${other.def.name} taken out of the path`); } return; }
        const before = hh.kind === "before" ? c.key : s.concepts[i + 1]?.key ?? null;
        save(placeConcept(body, other, s.name, before));
        announce(`Moved ${other.def.name} to ${s.name}`);
        refocus(sel$("data-concept", other.key));
      },
      key: (e) => {
        if (!e.altKey) return;
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
  const colOver = (e: DragEvent, s: { name: string }) => {
    const k = dragKind(e);
    const unplaced = s.name === UNPLACED;
    if (k === "concept") { e.preventDefault(); set({ kind: "end", stage: s.name }); }
    else if (k === "note" && !unplaced) { e.preventDefault(); set({ kind: "end", stage: s.name }); }
    else if (k === "stage" && !unplaced && dragging()?.id !== s.name) { e.preventDefault(); set({ kind: zoneX(e) === "before" ? "col-before" : "col-after", stage: s.name }); }
  };
  const colDrop = (e: DragEvent, s: { name: string }) => {
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 px-4 pt-3 text-[12px] text-muted">
        <span className="min-w-0 flex-1 truncate">{path.courses.length ? "Drag cards to reorder or move · onto a card to merge · into “Not placed yet” to take out · drag stage names to reorder · Alt+arrows with the keyboard"
          : "No courses yet: build your own path. Add stages, type concepts, or drag notes in from the list."}</span>
        <button onClick={() => setTray((t) => !t)} aria-pressed={tray} title="Drag notes in to make them concepts"
          className={cx("flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] border px-2.5 text-[12.5px]", tray ? "border-accent/50 bg-accent/10 text-ink" : "border-line text-muted hover:text-ink")}><NotebookPen size={13} />Add notes</button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-full min-w-0 flex-1 gap-3 overflow-x-auto p-4" onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setHint(null); }} onDragEnd={finish}>
          {path.stages.map((s, i) => {
            const done = s.concepts.filter((c) => c.status === "done").length;
            const unplaced = s.name === UNPLACED;
            const ch = hint && "stage" in hint && hint.stage === s.name ? hint.kind : null;
            return (
              <section key={s.name} data-stage={s.name} onDragOver={(e) => colOver(e, s)} onDrop={(e) => colDrop(e, s)}
                className={cx("flex w-[280px] shrink-0 flex-col rounded-[14px] p-2", unplaced ? "border border-dashed border-line" : "bg-surface-2/40", ch === "end" && "ring-2 ring-accent/50", ch === "col-before" && "pdnd-col-before", ch === "col-after" && "pdnd-col-after")}>
                <header className="group flex items-center gap-2 px-1.5 pb-2 pt-1" draggable={!unplaced} data-stage-head={s.name}
                  onDragStart={(e) => { if ((e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); return; } startDrag(e, "stage", s.name); }} onDragEnd={finish}>
                  {!unplaced && <GripVertical size={12} aria-hidden className="pdnd-grip -ml-1 shrink-0 cursor-grab text-muted" />}
                  <span className="text-[11px] font-semibold tabular-nums text-muted">{unplaced ? "•" : i + 1}</span>
                  <input dir="auto" defaultValue={s.name} key={s.name} disabled={unplaced} aria-label="Stage name"
                    onKeyDown={(e) => {
                      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                        e.preventDefault();
                        const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
                        save(moveStage(body, s.name, (e.key === "ArrowRight") !== rtl ? 1 : -1));
                        refocus(`${sel$("data-stage-head", s.name)} input`);
                      } else if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && save(renameStage(body, s.name, e.target.value.trim()))}
                    className="min-w-0 flex-1 bg-transparent text-[13.5px] font-semibold outline-none" />
                  <span className="text-[11.5px] tabular-nums text-muted">{done}/{s.concepts.length}</span>
                  {!unplaced && (
                    <span className="hidden gap-0.5 text-muted group-hover:flex">
                      <button title="Move left" onClick={() => save(moveStage(body, s.name, -1))}><ArrowUp size={12} className="-rotate-90" /></button>
                      <button title="Move right" onClick={() => save(moveStage(body, s.name, 1))}><ArrowDown size={12} className="-rotate-90" /></button>
                      {!s.concepts.length && <button title="Delete stage" onClick={() => save(removeStage(body, s.name))}><Trash2 size={12} /></button>}
                    </span>
                  )}
                </header>
                {s.concepts.length > 0 && <div className="mx-1.5 mb-2 h-1 rounded-full bg-surface-2"><div className="h-full rounded-full bg-ok" style={{ width: `${(done / s.concepts.length) * 100}%` }} /></div>}
                {unplaced && <p className="px-1.5 pb-2 text-[11.5px] text-muted">Course topics not in any stage yet. Drag them into a stage or onto a concept (alias), or use Auto-organize. Drop a placed concept here to take it out.</p>}
                <div className="flex flex-col gap-1.5">{s.concepts.map((c, ci) => <ConceptCard key={c.key} c={c} onOpen={onOpen} drag dnd={cardDnd(c, s, ci)} />)}</div>
                {!unplaced && <div className="mt-1.5"><AddConcept onAdd={(n) => { const b = addConcept(body, s.name, n); if (unchanged(b)) toast(`“${n}” is already in this path`); else { save(b); announce(`Added ${n}`); } }} /></div>}
              </section>
            );
          })}
          <form onSubmit={(e) => { e.preventDefault(); if (newStage.trim()) { save(addStage(body, newStage.trim())); setNewStage(""); } }} className="w-[220px] shrink-0">
            <input value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="+ New stage" className={inputCls} />
          </form>
        </div>
        {tray && <NotesTray className="w-[260px] shrink-0 border-l" spaceId={note.spaceId} used={used} onClose={() => setTray(false)} title="Notes → concepts"
          hint={<>Drag a note into a stage to make it a concept, or onto a concept to link it.</>}
          onPick={(n) => { const b = addConcept(body, real[real.length - 1]?.name ?? "Stage 1", n.title, { note: n.title }); if (unchanged(b)) toast(`“${n.title}” is already in this path`); else save(b); }} />}
      </div>
    </div>
  );
}
// ------------------------------------------------------------------ Matrix: concepts × courses (overlaps + gaps)
function Matrix({ path, onOpen }: { path: BuiltPath; onOpen: (k: string) => void }) {
  const dot = (s: TopicStatus | null) => s === null ? <span className="text-muted/50">—</span> : <span className="inline-block size-3 rounded-full" style={{ background: s === "done" ? "var(--success)" : s === "learning" ? "var(--info)" : "transparent", border: s === "todo" ? "1.5px solid var(--muted)" : "none" }} />;
  const phone = usePhone();
  const cell = phone ? "px-1.5 py-2" : "px-3 py-2";
  // first column stays visible while the course columns scroll sideways
  const stick = "sticky left-0 z-[5] bg-bg";
  return (
    <div className="p-2 md:p-4">
      <table className="min-w-full border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-10 bg-bg">
          <tr>
            <th className={cx(stick, "z-[11] border-b border-line px-3 py-2 text-left text-[11.5px] font-semibold uppercase tracking-[.06em] text-muted")}>Concept</th>
            <th className={cx("border-b border-line text-center text-[11.5px] font-semibold uppercase tracking-[.06em] text-muted", cell)}>{phone ? "×" : "Overlap"}</th>
            {path.courses.map((c) => (
              <th key={c.key} title={c.title} className={cx("border-b border-line text-center text-[12px] font-semibold", cell)}>
                {phone ? <span className="flex flex-col items-center gap-0.5"><span className="text-[14px] leading-none">{c.spaceIcon}</span><span className="h-1 w-4 rounded-full" style={{ background: c.color }} /></span>
                  : <span className="whitespace-nowrap"><span className="mr-1 inline-block size-2 rounded-full" style={{ background: c.color }} />{c.spaceName}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {path.stages.map((s) => (
            <Fragment key={s.name}>
              <tr><td colSpan={path.courses.length + 2} className="bg-surface-2/50 px-3 py-1.5 text-[11.5px] font-semibold text-muted"><span className="sticky left-3">{s.name}</span></td></tr>
              {s.concepts.map((c) => {
                const n = new Set(c.coverage.map((x) => x.course.key)).size;
                return (
                  <tr key={c.key} onClick={() => onOpen(c.key)} className="cursor-pointer hover:bg-surface-2">
                    <td className={cx(stick, "border-b border-r border-line/60 px-3 py-2", phone && "max-w-[150px]")}><span className="flex items-center gap-2"><span className="size-2 shrink-0 rounded-full" style={{ background: ST_COLOR[c.status] }} /><span dir="auto" className={phone ? "line-clamp-2 text-[12.5px] leading-snug" : ""}>{c.def.name}</span>{c.reviewDue && <span className="text-[11px] text-learn">revise</span>}</span></td>
                    <td className={cx("border-b border-line/60 text-center text-[12px] text-muted", cell)}>{n > 1 ? <span className="rounded-full bg-accent/15 px-2 text-accent">{n}×</span> : n === 1 ? "1" : "own"}</td>
                    {path.courses.map((k) => <td key={k.key} className={cx("border-b border-line/60 text-center", cell)}>{dot(cellStatus(c, k))}</td>)}
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[12px] text-muted">● done · ● learning (blue) · ○ to learn · — not in that course. "2×" = taught by two courses: learn it once, use both courses' material.</p>
    </div>
  );
}

// ------------------------------------------------------------------ Graph: concepts in stage columns, merged prerequisites
type GData = { c: BuiltConcept; sel: boolean; stageNo: number };
const GNode = memo(({ data }: NodeProps<RFNode<GData>>) => {
  const c = data.c;
  const courses = [...new Map(c.coverage.map((x) => [x.course.key, x.course])).values()];
  return (
    <div className={cx("flex h-full flex-col justify-center gap-1 rounded-[12px] border-2 bg-surface px-3", c.status === "locked" && "opacity-55", data.sel && "ring-2 ring-accent")}
      style={{ borderColor: c.status === "done" ? "var(--success)" : c.status === "learning" ? "var(--info)" : "var(--border)" }}>
      {/* whole card is the drop target for "this needs …"; the right-edge dot starts the drag */}
      <Handle type="target" position={Position.Left} isConnectableStart={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", transform: "none", left: 0, top: 0, border: 0, background: "transparent", borderRadius: 12, opacity: 0 }} />
      <span className="flex items-center gap-1.5 text-[12.5px] font-medium leading-tight">{c.status === "locked" && <Lock size={11} />}<span className="line-clamp-2" dir="auto">{c.def.name}</span></span>
      <span className="flex items-center gap-1">{courses.map((k) => <span key={k.key} className="h-1.5 w-4 rounded-full" style={{ background: k.color }} />)}<span className="ml-auto text-[10px] text-muted">{data.stageNo ? `S${data.stageNo}` : "—"}</span></span>
      <Handle type="source" position={Position.Right} title="Drag onto a concept to make this its prerequisite" className="pdnd-src"
        style={{ width: 10, height: 10, right: -6, background: "var(--accent)", border: "2px solid var(--bg)", cursor: "crosshair" }} />
    </div>
  );
});
function Graph({ path, onOpen, sel, note, save }: { path: BuiltPath; onOpen: (k: string) => void; sel: string | null; note: Note; save: (b: string) => void }) {
  const [edgeMenu, setEdgeMenu] = useState<{ x: number; y: number; from: BuiltConcept; to: BuiltConcept } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const { nodes, edges, levels } = useMemo(() => {
    // depth = longest prerequisite chain (merged across courses); ties keep stage order, then course module order
    const depth = new Map<string, number>();
    const d = (c: BuiltConcept, seen = new Set<string>()): number => {
      if (depth.has(c.key)) return depth.get(c.key)!;
      if (seen.has(c.key)) return 0;
      seen.add(c.key);
      const v = c.needs.length ? 1 + Math.max(...c.needs.map((n) => (path.byKey.get(n) ? d(path.byKey.get(n)!, seen) : 0))) : 0;
      depth.set(c.key, v);
      return v;
    };
    // loose "Not placed yet" topics stay in the Stages tab; the graph shows the placed path
    const list = path.concepts.some((c) => c.placed) ? path.concepts.filter((c) => c.placed) : path.concepts;
    const inGraph = new Set(list.map((c) => c.key));
    list.forEach((c) => d(c));
    const cols = new Map<number, BuiltConcept[]>();
    for (const c of [...list].sort((x, y) => x.stageIndex - y.stageIndex)) cols.set(depth.get(c.key)!, [...(cols.get(depth.get(c.key)!) ?? []), c]);
    const stageNo = (c: BuiltConcept) => (c.placed ? c.stageIndex + 1 : 0);
    const nodes: RFNode<GData>[] = [];
    for (const [lvl, cs] of cols) cs.forEach((c, i) => nodes.push({ id: c.key, type: "concept", position: { x: lvl * 250, y: 40 + i * 72 }, width: 200, height: 54, data: { c, sel: c.key === sel, stageNo: stageNo(c) }, draggable: false }));
    const edges: Edge[] = list.flatMap((c) => c.needs.filter((n) => inGraph.has(n)).map((n) => {
      const done = path.byKey.get(n)?.status === "done";
      const own = pathNeeds(c, path.byKey.get(n)!);
      return { id: `${n}>${c.key}`, source: n, target: c.key, type: "smoothstep", interactionWidth: 18, className: "pdnd-edge", markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: done ? "var(--success)" : "var(--muted)", strokeWidth: 1.5, opacity: 0.75, strokeDasharray: own ? "5 4" : undefined } };
    }));
    const levels = Math.max(0, ...cols.keys()) + 1;
    return { nodes, edges, levels };
  }, [path, sel]);
  const phone = usePhone();
  const [legend, setLegend] = useState(() => !phone && path.courses.length <= 8);
  // phones: open on the first two columns (where you start) at a readable zoom; pan right to follow the arrows
  // desktop: the first ~5 columns; the whole graph (25+ steps) would shrink every card to an unreadable size
  // drag from a concept's dot onto another: the target needs the source (a `  - needs:` line in the path)
  const connect = (cn: Connection) => {
    const pre = cn.source ? path.byKey.get(cn.source) : null, c = cn.target ? path.byKey.get(cn.target) : null;
    if (!pre || !c || pre.key === c.key) return;
    if (c.needs.includes(pre.key)) return toast(`“${c.def.name}” already needs “${pre.def.name}”`);
    if (wouldCycle(path, c, pre)) return toast("That would make a loop: it already depends on this concept.");
    save(addConceptNeed(note.body, c, pre));
    announce(`${c.def.name} now needs ${pre.def.name}`);
  };
  const openEdgeMenu = (e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    const from = path.byKey.get(edge.source), to = path.byKey.get(edge.target), r = box.current!.getBoundingClientRect();
    if (from && to) setEdgeMenu({ x: Math.min(e.clientX - r.left, r.width - 250), y: Math.min(e.clientY - r.top, r.height - 110), from, to });
  };
  const fitOpts = { padding: phone ? 0.08 : 0.12, maxZoom: 1, minZoom: 0.45, nodes: nodes.filter((n) => n.position.x <= (phone ? 250 : 1000)).map((n) => ({ id: n.id })) };
  return (
    <div ref={box} className="pdnd-flow lm-flow relative h-full min-h-[480px]">
      <div className="pointer-events-none absolute inset-x-0 top-2 z-10 px-4 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">
        <span>{phone ? `Learn left → right · ${levels} steps · drag to pan` : `Left → right: what to learn first. Arrows = prerequisites merged from every course (dashed = added in this path) · ${levels} steps · drag from a card's dot to link, click an arrow to remove`}</span>
      </div>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={{ concept: GNode }} fitView fitViewOptions={fitOpts} minZoom={0.1} proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => { setEdgeMenu(null); onOpen(n.id); }}
        nodesConnectable connectOnClick={false} onConnect={connect} isValidConnection={(c) => c.source !== c.target} connectionLineStyle={{ stroke: "var(--accent)", strokeWidth: 1.5 }}
        onEdgeClick={openEdgeMenu} onEdgeContextMenu={openEdgeMenu} onPaneClick={() => setEdgeMenu(null)}>
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
      {edgeMenu && (
        <div role="dialog" aria-label="Prerequisite" className="fade-in absolute z-20 w-[240px] rounded-[10px] border border-line bg-surface p-1.5 text-[12.5px] shadow-xl" style={{ left: Math.max(8, edgeMenu.x), top: Math.max(8, edgeMenu.y) }}>
          <div className="px-2 pb-1.5 pt-1 text-muted" dir="auto"><b className="text-ink">{edgeMenu.to.def.name}</b> needs <b className="text-ink">{edgeMenu.from.def.name}</b></div>
          {pathNeeds(edgeMenu.to, edgeMenu.from) ? (
            <button autoFocus onClick={() => { save(removeConceptNeed(note.body, edgeMenu.to, edgeMenu.from)); announce(`${edgeMenu.to.def.name} no longer needs ${edgeMenu.from.def.name}`); setEdgeMenu(null); }}
              className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-bad hover:bg-bad/10"><X size={13} />Remove prerequisite</button>
          ) : (
            <p className="px-2 pb-1 text-[12px] text-muted">This one comes from a course roadmap ({[...new Set(edgeMenu.to.coverage.map((x) => x.course.spaceName))].join(", ")}); change it there.</p>
          )}
          <button onClick={() => setEdgeMenu(null)} className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-muted hover:bg-surface-2">Close</button>
        </div>
      )}
      <div className="absolute bottom-3 right-3 max-w-[calc(100%-5rem)] rounded-[10px] border border-line bg-surface/95 text-[11.5px] text-muted">
        <button onClick={() => setLegend((l) => !l)} className="flex w-full items-center gap-1.5 px-3 py-1.5 font-semibold">
          <span className="flex gap-0.5">{path.courses.slice(0, 6).map((c) => <span key={c.key} className="h-1.5 w-2.5 rounded-full" style={{ background: c.color }} />)}</span>
          {path.courses.length} courses <ChevronDown size={12} className={cx("transition-transform", legend && "rotate-180")} />
        </button>
        {legend && (
          <div className="flex max-h-[40vh] flex-wrap gap-x-3 gap-y-1.5 overflow-y-auto border-t border-line px-3 py-2">
            {path.courses.map((c) => <span key={c.key} className="flex items-center gap-1"><span className="h-1.5 w-4 shrink-0 rounded-full" style={{ background: c.color }} />{c.spaceName}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Timeline: one lane per course + revision lane
function Timeline({ path, onOpen }: { path: BuiltPath; onOpen: (k: string) => void }) {
  const items = useMemo(() => {
    const out: { lane: string; color: string; date: string; label: string; key: string; status: string; kind: "topic" | "review" }[] = [];
    for (const c of path.concepts) {
      for (const cov of c.coverage) if (cov.topic.due) out.push({ lane: cov.course.key, color: cov.course.color, date: cov.topic.due, label: cov.topic.name, key: c.key, status: cov.topic.status, kind: "topic" });
      if (c.def.review) out.push({ lane: "__review", color: "var(--learn)", date: c.def.review, label: c.def.name, key: c.key, status: c.reviewDue ? "due" : "later", kind: "review" });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [path]);
  if (!items.length) return <div className="p-10 text-center text-[13px] text-muted">No dates yet. Add 📅 dates to course topics (in each course roadmap); revision dates appear here once concepts are done.</div>;
  const min = new Date(items[0].date + "T12:00"), max = new Date(items[items.length - 1].date + "T12:00");
  const start = new Date(min); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const weeks = Math.max(1, Math.ceil((max.getTime() - start.getTime()) / (7 * 864e5)) + 1);
  const W = 120;
  const x = (d: string) => ((new Date(d + "T12:00").getTime() - start.getTime()) / (7 * 864e5)) * W;
  const todayX = x(new Date().toISOString().slice(0, 10));
  const lanes = [...path.courses.map((c) => ({ key: c.key, label: `${c.spaceIcon} ${c.spaceName}`, color: c.color })), { key: "__review", label: "🧠 Revision", color: "var(--learn)" }];
  return (
    <div className="overflow-x-auto p-4">
      <div className="relative" style={{ width: 180 + weeks * W }}>
        <div className="flex border-b border-line pb-1 pl-[180px] text-[11px] text-muted">
          {Array.from({ length: weeks }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i * 7); return <span key={i} style={{ width: W }} className="shrink-0">{d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>; })}
        </div>
        {todayX >= 0 && todayX <= weeks * W && <div className="absolute bottom-0 top-0 z-10 w-px bg-accent" style={{ left: 180 + todayX }} title="Today" />}
        {lanes.map((l) => {
          const its = items.filter((i) => i.lane === l.key);
          // greedy row packing by estimated pill width
          const rowsEnd: number[] = [];
          const placed = its.map((i) => {
            const x0 = x(i.date), w = Math.min(180, 28 + i.label.length * 6.6);
            let r = rowsEnd.findIndex((end) => end + 6 <= x0);
            if (r < 0) { r = rowsEnd.length; rowsEnd.push(0); }
            rowsEnd[r] = x0 + w;
            return { ...i, row: r };
          });
          return (
            <div key={l.key} className="relative flex min-h-[52px] items-start border-b border-line/60 py-2">
              <span className="sticky left-0 z-10 w-[180px] shrink-0 truncate bg-bg pr-2 text-[12.5px] font-medium">{l.label}</span>
              <div className="relative flex-1" style={{ height: Math.max(28, rowsEnd.length * 30) }}>
                {placed.map((i, k) => (
                  <button key={k} onClick={() => onOpen(i.key)} title={`${i.label} · ${i.date}`}
                    className="absolute flex h-6 max-w-[180px] items-center gap-1 truncate rounded-full border px-2 text-[11.5px] hover:z-20"
                    style={{ left: x(i.date), top: i.row * 30, borderColor: i.color, background: i.status === "done" ? `color-mix(in srgb, ${i.color} 30%, var(--bg))` : `color-mix(in srgb, ${i.color} 12%, var(--bg))` }}>
                    {i.kind === "review" ? "↻" : i.status === "done" ? "✓" : "•"} {i.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Revise: spaced revision of finished concepts
function Revise({ path, note, save, onOpen }: { path: BuiltPath; note: Note; save: (b: string) => void; onOpen: (k: string) => void }) {
  const v = useVault();
  const due = path.concepts.filter((c) => c.reviewDue).sort((a, b) => (a.def.review ?? "").localeCompare(b.def.review ?? ""));
  const later = path.concepts.filter((c) => c.status === "done" && !c.reviewDue && c.def.review).sort((a, b) => (a.def.review ?? "").localeCompare(b.def.review ?? ""));
  const [i, setI] = useState(0);
  const cur = due[Math.min(i, due.length - 1)];
  const res = cur ? conceptResources(cur, v.byTitle) : [];
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-5">
      {cur ? (
        <div className="rounded-[14px] border border-line bg-surface p-5">
          <div className="mb-1 text-[11.5px] text-muted">Revise · {due.length} due · interval {cur.def.interval || 1} days</div>
          <button onClick={() => onOpen(cur.key)} className="text-left text-[22px] font-bold" dir="auto">{cur.def.name}</button>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[12px] text-muted">{cur.coverage.map((x, k) => <span key={k} className="rounded-full bg-surface-2 px-2">{x.course.spaceName} › {x.topic.name}</span>)}</div>
          <p className="mt-3 text-[13px] text-muted">Recall it without looking: explain it in two sentences, give an example, say where it's used. Then open a resource to check.</p>
          <div className="mt-3 flex flex-wrap gap-1.5">{res.slice(0, 6).map((r) => <a key={r.url} href={r.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-[8px] border border-line px-2 py-1 text-[12px] hover:border-ink/40">{KIND_ICON[r.kind]} {r.label}</a>)}</div>
          <div className="mt-4 flex gap-2">
            <Button variant="danger" onClick={() => { save(markRevised(note.body, cur, false)); }}><RotateCcw size={14} /> Again (tomorrow)</Button>
            <Button variant="primary" onClick={() => { save(markRevised(note.body, cur, true)); setI(0); }}><Check size={14} /> Got it</Button>
          </div>
        </div>
      ) : (
        <div className="rounded-[14px] border border-line bg-surface p-6 text-center text-[13px] text-muted">Nothing to revise right now. Finished concepts come back after 1, 3, 7, 14, 30, 60 and 120 days.</div>
      )}
      {later.length > 0 && (
        <section>
          <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-[.06em] text-muted">Coming up</div>
          {later.slice(0, 20).map((c) => <button key={c.key} onClick={() => onOpen(c.key)} className="flex w-full justify-between rounded-[8px] px-2 py-1.5 text-left text-[13px] hover:bg-surface-2"><span dir="auto">{c.def.name}</span><span className="text-muted">{c.def.review}</span></button>)}
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Concept sheet
function ResourcePlayer({ r }: { r: Res }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open && ref.current) { ref.current.innerHTML = embedHtml(r.url, r.label); hydrate(ref.current); } }, [open, r]);
  return (
    <div className="rounded-[10px] border border-line">
      <div className="flex items-center gap-2 px-2.5 py-2 text-[12.5px]">
        <span>{KIND_ICON[r.kind]}</span>
        <a href={r.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-link" title={r.url}>{r.label}</a>
        <span className="text-[11px] text-muted">{r.from}</span>
        {r.kind === "video" && <button onClick={() => setOpen((o) => !o)} className="rounded-[6px] bg-surface-2 px-2 py-0.5 text-[11.5px]">{open ? "Hide" : "▶ Play"}</button>}
        <a href={r.url} target="_blank" rel="noreferrer" className="text-muted hover:text-ink"><ExternalLink size={12} /></a>
      </div>
      {open && <div ref={ref} className="prose !max-w-none px-2.5 pb-2.5" />}
    </div>
  );
}

function ConceptSheet({ c, path, note, save, onClose, onOpen, confirm }: { c: BuiltConcept; path: BuiltPath; note: Note; save: (b: string) => void; onClose: () => void; onOpen: (k: string) => void; confirm: Ask }) {
  const [addingNeed, setAddingNeed] = useState(false);
  const needCandidates = path.concepts.filter((x) => x.key !== c.key && !c.needs.includes(x.key) && !wouldCycle(path, c, x));
  const v = useVault();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [merge, setMerge] = useState(false);
  const res = conceptResources(c, v.byTitle);
  const linked = [...new Set([...c.def.notes, ...c.coverage.map((x) => x.topic.note).filter((x): x is string => !!x)])];
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  async function setCourseStatus(cov: BuiltConcept["coverage"][number], s: TopicStatus) {
    if (!cov.course.note) return;
    await updateNote(cov.course.note.id, { body: setTopicStatus(cov.course.note.body, cov.topic.line, s) });
  }
  async function openLesson(cov?: BuiltConcept["coverage"][number]) {
    if (cov?.topic.note) { const n = v.byTitle.get(cov.topic.note.toLowerCase()); if (n) return openNote(n.id); }
    const title = cov?.topic.name ?? c.def.name;
    const n = await findOrCreateByTitle(title, cov?.course.spaceId ?? note.spaceId);
    if (cov?.course.note && !cov.topic.note) await updateNote(cov.course.note.id, { body: linkTopicNote(cov.course.note.body, cov.topic.line, n.title) });
    else if (!cov) save(linkNote(note.body, c, n.title));
    openNote(n.id);
  }
  return (
    <aside className="fixed inset-0 z-40 flex flex-col bg-surface md:static md:z-auto md:w-[380px] md:shrink-0 md:border-l md:border-line fade-in">
      <div className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-muted">{c.stage} · <span style={{ color: ST_COLOR[c.status] }}>{c.status}</span>{c.due ? ` · due ${c.due}` : ""}</div>
          <input dir="auto" key={c.key} defaultValue={c.def.name} onBlur={(e) => e.target.value.trim() && e.target.value !== c.def.name && save(renameConcept(note.body, c, e.target.value.trim()))} className="w-full bg-transparent text-[18px] font-bold outline-none" />
        </div>
        <button onClick={onClose} className="text-muted hover:text-ink"><X size={18} /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <MasteryBox c={c} path={path} onToggle={(on) => save(setManualDone(note.body, c, on))} onOpen={onOpen} />
        <ConceptPractice concept={c} path={path} note={note} onTestOut={() => save(setManualDone(note.body, c, true))} />
        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Taught in · {new Set(c.coverage.map((x) => x.course.key)).size} courses</h4>
          {/* grouped by course: one header per course (collapsible), its topics below */}
          {[...new Map(c.coverage.map((x) => [x.course.key, x.course])).values()].map((course, gi) => {
            const items = c.coverage.filter((x) => x.course.key === course.key);
            const done = items.filter((x) => x.topic.status === "done" || x.topic.status === "skipped").length;
            return (
              <details key={course.key} open={gi < 3} className="group mb-2 overflow-hidden rounded-[10px] border border-line" style={{ borderLeft: `3px solid ${course.color}` }}>
                <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{course.spaceIcon} {course.spaceName}</span>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-muted">{done}/{items.length}</span>
                  <ChevronDown size={13} className="shrink-0 text-muted transition-transform group-open:rotate-180" />
                </summary>
                {items.map((cov, k) => (
                  <div key={k} draggable onDragStart={(e) => startDrag(e, "alias", JSON.stringify({ name: cov.topic.name, from: c.key }), cov.topic.name)} onDragEnd={() => endDrag()}
                    title="Drag onto another concept on the board: this topic then counts as that concept"
                    className="group flex cursor-grab items-center gap-2 border-t border-line/60 px-2.5 py-2 active:cursor-grabbing">
                    <GripVertical size={12} aria-hidden className="pdnd-grip -ml-1 shrink-0 text-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-[13px] font-medium leading-snug" dir="auto">{cov.topic.name}</div>
                      <div className="truncate text-[11.5px] text-muted">{cov.module}{cov.topic.due ? ` · 📅 ${cov.topic.due}` : ""}</div>
                    </div>
                    <select value={cov.topic.status} onChange={(e) => setCourseStatus(cov, e.target.value as TopicStatus)} className="h-8 shrink-0 rounded-[6px] border border-line bg-bg px-1.5 text-[12px]">
                      {(["todo", "learning", "done", "skipped"] as TopicStatus[]).map((s) => <option key={s}>{s}</option>)}
                    </select>
                    <button title="Open lesson note" onClick={() => openLesson(cov)} className="flex size-8 shrink-0 items-center justify-center text-muted hover:text-link"><FileText size={15} /></button>
                  </div>
                ))}
              </details>
            );
          })}
          {!c.coverage.length && (
            <p className="text-[12.5px] text-muted">Your own concept (not in a course): use “Mark learned” above.</p>
          )}
        </section>

        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Prerequisites (merged across courses)</h4>
          <div className="flex flex-wrap items-center gap-1.5">
            {c.needs.map((n) => {
              const d = path.byKey.get(n)!;
              const own = pathNeeds(c, d);
              return (
                <span key={n} className={cx("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px]", own ? "border-dashed border-accent/50" : "border-line")} title={own ? "Added in this path" : "From a course roadmap"}>
                  <button onClick={() => onOpen(n)} className="flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: ST_COLOR[d.status] }} /><span dir="auto">{d.def.name}</span></button>
                  {own && <button aria-label={`Remove ${d.def.name}`} onClick={() => save(removeConceptNeed(note.body, c, d))} className="text-muted hover:text-ink"><X size={11} /></button>}
                </span>
              );
            })}
            {addingNeed ? (
              <select autoFocus defaultValue="" onBlur={() => setAddingNeed(false)} className="h-7 max-w-[220px] rounded-[6px] border border-line bg-bg px-1.5 text-[12.5px]"
                onChange={(e) => { const d = path.byKey.get(e.target.value); if (d) save(addConceptNeed(note.body, c, d)); setAddingNeed(false); }}>
                <option value="" disabled>Needs which concept…</option>
                {needCandidates.map((x) => <option key={x.key} value={x.key}>{x.def.name}</option>)}
              </select>
            ) : (
              <button onClick={() => setAddingNeed(true)} disabled={!needCandidates.length} className="flex h-6 items-center gap-1 rounded-full border border-dashed border-line px-2 text-[12px] text-muted hover:text-ink disabled:opacity-50"><Plus size={11} />Add</button>
            )}
          </div>
          {c.unlocks.length > 0 && <div className="mt-2 text-[12px] text-muted">Unlocks: {c.unlocks.map((n) => path.byKey.get(n)?.def.name).join(", ")}</div>}
        </section>

        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Resources · {res.length}</h4>
          <div className="space-y-1.5">
            {res.map((r) => (
              <div key={r.url} className="group relative">
                <ResourcePlayer r={r} />
                {r.from === "Path" && <button title="Remove" onClick={() => save(removeResource(note.body, c, r.url))} className="absolute -right-1.5 -top-1.5 hidden rounded-full border border-line bg-surface p-0.5 text-muted group-hover:block"><X size={11} /></button>}
              </div>
            ))}
          </div>
          <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (!/^https?:\/\//.test(url)) return toast("Paste a link (YouTube, course video, article, book…)"); const base = c.placed ? note.body : moveConcept(note.body, c, path.doc.stages[0]?.name ?? "Stage 1"); save(addResource(base, c, label.trim() || url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60), url)); setUrl(""); setLabel(""); }}>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link: YouTube, course video, article…" className={inputCls + " min-w-0 flex-1"} />
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name" className={inputCls + " !w-24 shrink-0"} />
            <Button size="sm" variant="primary" type="submit"><Plus size={14} /></Button>
          </form>
          <p className="mt-1 text-[11.5px] text-muted">Links inside each course's lesson notes are collected here automatically.</p>
        </section>

        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Notes</h4>
          {linked.map((t) => { const n = v.byTitle.get(t.toLowerCase()); return <button key={t} onClick={() => n && openNote(n.id)} className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] hover:bg-surface-2"><BookOpen size={14} className="text-muted" /><span className="flex-1 truncate">{t}</span>{n && <span className="truncate text-[11.5px] text-muted">{excerpt(n.body, 40)}</span>}</button>; })}
          <Button size="sm" className="mt-1" onClick={() => openLesson(c.coverage[0])}><Plus size={13} /> {linked.length ? "Open / add lesson note" : "Create lesson note"}</Button>
        </section>

        {c.status === "done" && (
          <section>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Revision</h4>
            <div className="text-[13px]">{c.def.review ? <>Next: <b>{c.def.review}</b> · every {c.def.interval || 1} days{c.reviewDue && <span className="ml-1 text-learn">(due now)</span>}</> : "Scheduled when done."}</div>
            {c.reviewDue && <div className="mt-2 flex gap-2"><Button size="sm" variant="danger" onClick={() => save(markRevised(note.body, c, false))}>Again</Button><Button size="sm" variant="primary" onClick={() => save(markRevised(note.body, c, true))}>Got it</Button></div>}
          </section>
        )}

        <section>
          <button onClick={() => setMerge((m) => !m)} className="flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink"><GitMerge size={13} /> Merge with another concept (same idea, different name) <ChevronDown size={12} /></button>
          {merge && (
            <div className="mt-2 max-h-48 overflow-y-auto rounded-[10px] border border-line p-1">
              {path.concepts.filter((x) => x.key !== c.key).map((x) => <button key={x.key} onClick={() => { setMerge(false); confirm(<>Merge “<b dir="auto">{x.def.name}</b>” into “<b dir="auto">{c.def.name}</b>”?</>, "Merge", () => { save(mergeConcepts(note.body, c, x)); toast(`Merged “${x.def.name}” into “${c.def.name}”`); }); }} className="flex w-full justify-between rounded-[6px] px-2 py-1 text-left text-[12.5px] hover:bg-surface-2"><span>{x.def.name}</span><span className="text-muted">{[...new Set(x.coverage.map((y) => y.course.spaceName))].join(", ")}</span></button>)}
            </div>
          )}
        </section>
        {c.placed && <button onClick={() => { save(removeConcept(note.body, c)); toast(`“${c.def.name}” taken out of the path`); onClose(); }} className="flex items-center gap-1.5 text-[12.5px] text-muted hover:text-bad"><Trash2 size={13} /> Take out of the path (course topics go back to “Not placed yet”)</button>}
        <div className="flex items-center gap-1.5 text-[11.5px] text-muted"><Link2 size={12} /> Courses stay independent: status changes here update that course's own roadmap.</div>
      </div>
    </aside>
  );
}

/** Create a new path note from selected courses. */
export async function createPath(title: string, courseNames: string[], spaceId: string, ctx: { notes: Note[]; spaces: { id: string; name: string; icon: string; roadmapId: string | null }[] }) {
  const { newPathBody } = await import("../lib/path");
  const body = newPathBody(title, courseNames, resolveCourses(courseNames, ctx.notes, ctx.spaces));
  return createNote({ type: "path", title, body, spaceId });
}

/** "These look like the same concept" — one-click merge across courses (or dismiss). */
function Overlaps({ path, note, save }: { path: BuiltPath; note: Note; save: (b: string) => void }) {
  const key = `lumen.path.dismiss.${note.id}`;
  const [dismissed, setDismissed] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; } });
  const [open, setOpen] = useState(false);
  const pairs = useMemo(() => overlapSuggestions(path, dismissed), [path, dismissed]);
  if (!pairs.length) return null;
  const dismiss = (a: BuiltConcept, b: BuiltConcept) => { const d = [...dismissed, `${a.key}|${b.key}`, `${b.key}|${a.key}`]; setDismissed(d); try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* ignore */ } };
  return (
    <div className="mt-2.5 rounded-[10px] border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_7%,transparent)] px-3 py-1.5 text-[12.5px] md:mt-3 md:py-2">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left"><GitMerge size={14} className="shrink-0 text-accent" /><b className="shrink-0">{pairs.length} possible overlaps</b><span className="truncate text-muted">between courses: same idea, different names?</span><ChevronDown size={13} className={cx("ml-auto shrink-0 transition-transform", open && "rotate-180")} /></button>
      {open && (
        <div className="mt-2 space-y-1">
          {pairs.map(([a, b]) => (
            <div key={a.key + b.key} className="flex flex-wrap items-center gap-2 rounded-[8px] bg-surface px-2 py-1.5">
              <span dir="auto" className="font-medium">{a.def.name}</span><span className="text-muted">({[...new Set(a.coverage.map((x) => x.course.spaceName))].join(", ")})</span>
              <span className="text-muted">≈</span>
              <span dir="auto" className="font-medium">{b.def.name}</span><span className="text-muted">({[...new Set(b.coverage.map((x) => x.course.spaceName))].join(", ")})</span>
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="primary" onClick={() => { save(mergeConcepts(note.body, a, b)); toast(`Merged into “${a.def.name}”`); }}><GitMerge size={13} /> Merge</Button>
                <Button size="sm" variant="ghost" onClick={() => dismiss(a, b)}>Different</Button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
