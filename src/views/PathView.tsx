import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, type Edge, type Node as RFNode, type NodeProps } from "@xyflow/react";
import { ArrowDown, ArrowUp, BookOpen, Brain, CalendarDays, Check, ChevronDown, ExternalLink, FileText, GitMerge, Grid3x3, Layers, Link2, Loader2, Lock, Network, Plus, RotateCcw, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { createNote, findOrCreateByTitle, updateNote } from "../lib/actions";
import { aiRun, getToken } from "../lib/api";
import { hydrate } from "../lib/markdown";
import { embedHtml } from "../lib/markdown";
import { excerpt, linkTopicNote, setTopicStatus, type TopicStatus } from "../lib/parse";
import {
  addResource, addStage, autoOrganize, buildPath, cellStatus, linkNote, markRevised, mergeConcepts, moveConcept, moveStage, norm, pathProgress,
  overlapSuggestions, removeResource, removeStage, renameConcept, renameStage, resolveCourses, scheduleNewlyDone, serializePath, setManualDone, UNPLACED,
  type BuiltConcept, type BuiltPath, type CourseRef,
} from "../lib/path";
import { openNote, toast, useVault } from "../lib/store";
import { Button, cx, inputCls, Segmented } from "../components/ui";
import { Ring } from "./RoadmapView";

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
        <div className="border-b border-line px-5 pb-3 pt-4">
          <div className="flex flex-wrap items-center gap-4">
            <Ring pct={prog.pct} size={52} />
            <div className="min-w-0 flex-1">
              <div className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Learning path · {courses.length} courses</div>
              <div className="text-[13px] text-muted"><b className="text-ink">{prog.done}</b> of {prog.total} concepts · {prog.learning} learning · <span className={prog.review ? "text-learn" : ""}>{prog.review} to revise</span></div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {courses.map((c) => <CourseChip key={c.key} c={c} path={path} />)}
                <CoursePicker note={note} path={path} />
              </div>
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => { save(autoOrganize(note.body, path)); toast("Stages rebuilt from prerequisites across all courses"); }}><Wand2 size={14} /> Auto-organize</Button>
              <Button size="sm" variant="ghost" onClick={aiOrganize} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} AI organize</Button>
            </div>
          </div>
          <Overlaps path={path} note={note} save={save} />
          <Segmented className="mt-3" value={tab} onChange={setTab} options={tabs} />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {!courses.length ? (
            <div className="mx-auto max-w-md p-10 text-center text-[13px] text-muted">Add courses to this path (button above). Each course keeps its own roadmap; the path merges overlapping topics into concepts.</div>
          ) : tab === "stages" ? <Stages path={path} note={note} onOpen={setSel} save={save} />
            : tab === "matrix" ? <Matrix path={path} onOpen={setSel} />
            : tab === "graph" ? <ReactFlowProvider><Graph path={path} onOpen={setSel} sel={sel} /></ReactFlowProvider>
            : tab === "timeline" ? <Timeline path={path} onOpen={setSel} />
            : <Revise path={path} note={note} save={save} onOpen={setSel} />}
        </div>
      </div>
      {selected && <ConceptSheet c={selected} path={path} note={note} save={save} onClose={() => setSel(null)} onOpen={setSel} />}
    </div>
  );
}

function CourseChip({ c, path }: { c: CourseRef; path: BuiltPath }) {
  const total = path.concepts.filter((x) => x.coverage.some((y) => y.course.key === c.key));
  const done = total.filter((x) => cellStatus(x, c) === "done").length;
  return (
    <button onClick={() => c.note && openNote(c.note.id)} title={c.note ? `Open ${c.title}` : "Course roadmap not found"}
      className={cx("flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-[12px]", c.note ? "hover:border-ink" : "opacity-60")}
      style={{ borderColor: `color-mix(in srgb, ${c.color} 45%, transparent)`, background: `color-mix(in srgb, ${c.color} 12%, transparent)` }}>
      <span className="size-2 rounded-full" style={{ background: c.color }} />{c.spaceIcon} {c.spaceName}
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
          <div className="absolute left-0 top-full z-40 mt-1 w-72 rounded-[12px] border border-line bg-surface p-1.5 shadow-xl fade-in">
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
function ConceptCard({ c, onOpen, drag }: { c: BuiltConcept; onOpen: (k: string) => void; drag?: boolean }) {
  const courses = [...new Map(c.coverage.map((x) => [x.course.key, x.course])).values()];
  return (
    <button draggable={drag} onDragStart={(e) => e.dataTransfer.setData("text/lumen-concept", c.key)} onClick={() => onOpen(c.key)}
      className={cx("group flex w-full flex-col gap-1.5 rounded-[10px] border border-line bg-surface p-2.5 text-left hover:border-ink/40", c.status === "locked" && "opacity-60", c.reviewDue && "ring-1 ring-learn/60")}>
      <span className="flex items-start gap-2">
        {c.status === "locked" ? <Lock size={13} className="mt-0.5 shrink-0 text-muted" /> : <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: ST_COLOR[c.status] }} />}
        <span dir="auto" className={cx("flex-1 text-[13.5px] font-medium leading-snug", c.status === "done" && "text-muted")}>{c.def.name}</span>
        {c.reviewDue && <span className="rounded-full bg-learn/15 px-1.5 text-[10.5px] font-semibold text-learn">revise</span>}
      </span>
      <span className="flex flex-wrap items-center gap-1">
        {courses.map((k) => <span key={k.key} title={k.title} className="size-2 rounded-full" style={{ background: k.color }} />)}
        {courses.length > 1 && <span className="text-[11px] text-muted">{courses.length} courses</span>}
        {!courses.length && <span className="text-[11px] text-muted">your own</span>}
        {c.def.resources.length > 0 && <span className="ml-auto text-[11px] text-muted">{c.def.resources.length} res.</span>}
      </span>
    </button>
  );
}

function Stages({ path, note, onOpen, save }: { path: BuiltPath; note: Note; onOpen: (k: string) => void; save: (b: string) => void }) {
  const [over, setOver] = useState<string | null>(null);
  const [newStage, setNewStage] = useState("");
  return (
    <div className="flex min-h-full gap-3 overflow-x-auto p-4">
      {path.stages.map((s, i) => {
        const done = s.concepts.filter((c) => c.status === "done").length;
        const unplaced = s.name === UNPLACED;
        return (
          <section key={s.name}
            onDragOver={(e) => { e.preventDefault(); setOver(s.name); }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); const k = e.dataTransfer.getData("text/lumen-concept"); const c = path.byKey.get(k); if (c && !unplaced) save(moveConcept(note.body, c, s.name)); }}
            className={cx("flex w-[280px] shrink-0 flex-col rounded-[14px] p-2", unplaced ? "border border-dashed border-line" : "bg-surface-2/40", over === s.name && "ring-2 ring-accent/50")}>
            <header className="group flex items-center gap-2 px-1.5 pb-2 pt-1">
              <span className="text-[11px] font-semibold tabular-nums text-muted">{unplaced ? "•" : i + 1}</span>
              <input dir="auto" defaultValue={s.name} key={s.name} disabled={unplaced} onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && save(renameStage(note.body, s.name, e.target.value.trim()))}
                className="min-w-0 flex-1 bg-transparent text-[13.5px] font-semibold outline-none" />
              <span className="text-[11.5px] tabular-nums text-muted">{done}/{s.concepts.length}</span>
              {!unplaced && (
                <span className="hidden gap-0.5 text-muted group-hover:flex">
                  <button title="Move left" onClick={() => save(moveStage(note.body, s.name, -1))}><ArrowUp size={12} className="-rotate-90" /></button>
                  <button title="Move right" onClick={() => save(moveStage(note.body, s.name, 1))}><ArrowDown size={12} className="-rotate-90" /></button>
                  {!s.concepts.length && <button title="Delete stage" onClick={() => save(removeStage(note.body, s.name))}><Trash2 size={12} /></button>}
                </span>
              )}
            </header>
            {s.concepts.length > 0 && <div className="mx-1.5 mb-2 h-1 rounded-full bg-surface-2"><div className="h-full rounded-full bg-ok" style={{ width: `${(done / s.concepts.length) * 100}%` }} /></div>}
            {unplaced && <p className="px-1.5 pb-2 text-[11.5px] text-muted">Course topics not in any stage yet. Drag them into a stage, or use Auto-organize.</p>}
            <div className="flex flex-col gap-1.5">{s.concepts.map((c) => <ConceptCard key={c.key} c={c} onOpen={onOpen} drag />)}</div>
          </section>
        );
      })}
      <form onSubmit={(e) => { e.preventDefault(); if (newStage.trim()) { save(addStage(note.body, newStage.trim())); setNewStage(""); } }} className="w-[220px] shrink-0">
        <input value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="+ New stage" className={inputCls} />
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ Matrix: concepts × courses (overlaps + gaps)
function Matrix({ path, onOpen }: { path: BuiltPath; onOpen: (k: string) => void }) {
  const dot = (s: TopicStatus | null) => s === null ? <span className="text-muted/50">—</span> : <span className="inline-block size-3 rounded-full" style={{ background: s === "done" ? "var(--success)" : s === "learning" ? "var(--info)" : "transparent", border: s === "todo" ? "1.5px solid var(--muted)" : "none" }} />;
  return (
    <div className="p-4">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-10 bg-bg">
          <tr>
            <th className="border-b border-line px-3 py-2 text-left text-[11.5px] font-semibold uppercase tracking-[.06em] text-muted">Concept</th>
            {path.courses.map((c) => <th key={c.key} className="border-b border-line px-3 py-2 text-center text-[12px] font-semibold"><span className="mr-1 inline-block size-2 rounded-full" style={{ background: c.color }} />{c.spaceName}</th>)}
            <th className="border-b border-line px-3 py-2 text-center text-[11.5px] font-semibold uppercase tracking-[.06em] text-muted">Overlap</th>
          </tr>
        </thead>
        <tbody>
          {path.stages.map((s) => (
            <Fragment key={s.name}>
              <tr><td colSpan={path.courses.length + 2} className="bg-surface-2/50 px-3 py-1.5 text-[11.5px] font-semibold text-muted">{s.name}</td></tr>
              {s.concepts.map((c) => {
                const n = new Set(c.coverage.map((x) => x.course.key)).size;
                return (
                  <tr key={c.key} onClick={() => onOpen(c.key)} className="cursor-pointer hover:bg-surface-2">
                    <td className="border-b border-line/60 px-3 py-2"><span className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: ST_COLOR[c.status] }} /><span dir="auto">{c.def.name}</span>{c.reviewDue && <span className="text-[11px] text-learn">revise</span>}</span></td>
                    {path.courses.map((k) => <td key={k.key} className="border-b border-line/60 px-3 py-2 text-center">{dot(cellStatus(c, k))}</td>)}
                    <td className="border-b border-line/60 px-3 py-2 text-center text-[12px] text-muted">{n > 1 ? <span className="rounded-full bg-accent/15 px-2 text-accent">{n}×</span> : n === 1 ? "1" : "own"}</td>
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
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <span className="flex items-center gap-1.5 text-[12.5px] font-medium leading-tight">{c.status === "locked" && <Lock size={11} />}<span className="line-clamp-2" dir="auto">{c.def.name}</span></span>
      <span className="flex items-center gap-1">{courses.map((k) => <span key={k.key} className="h-1.5 w-4 rounded-full" style={{ background: k.color }} />)}<span className="ml-auto text-[10px] text-muted">{data.stageNo ? `S${data.stageNo}` : "—"}</span></span>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
});
function Graph({ path, onOpen, sel }: { path: BuiltPath; onOpen: (k: string) => void; sel: string | null }) {
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
    path.concepts.forEach((c) => d(c));
    const cols = new Map<number, BuiltConcept[]>();
    for (const c of [...path.concepts].sort((x, y) => x.stageIndex - y.stageIndex)) cols.set(depth.get(c.key)!, [...(cols.get(depth.get(c.key)!) ?? []), c]);
    const stageNo = (c: BuiltConcept) => (c.placed ? c.stageIndex + 1 : 0);
    const nodes: RFNode<GData>[] = [];
    for (const [lvl, cs] of cols) cs.forEach((c, i) => nodes.push({ id: c.key, type: "concept", position: { x: lvl * 250, y: 40 + i * 72 }, width: 200, height: 54, data: { c, sel: c.key === sel, stageNo: stageNo(c) }, draggable: false, connectable: false }));
    const edges: Edge[] = path.concepts.flatMap((c) => c.needs.map((n) => {
      const done = path.byKey.get(n)?.status === "done";
      return { id: `${n}>${c.key}`, source: n, target: c.key, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: done ? "var(--success)" : "var(--muted)", strokeWidth: 1.5, opacity: 0.75 } };
    }));
    const levels = Math.max(0, ...cols.keys()) + 1;
    return { nodes, edges, levels };
  }, [path, sel]);
  return (
    <div className="relative h-full min-h-[480px]">
      <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex gap-0 px-4 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">
        <span>Left → right: what to learn first. Arrows = prerequisites merged from every course · {levels} steps · S1… = stage</span>
      </div>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={{ concept: GNode }} fitView fitViewOptions={{ padding: 0.15 }} minZoom={0.1} proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => onOpen(n.id)} nodesConnectable={false}>
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
      <div className="absolute bottom-3 right-3 flex flex-wrap gap-2 rounded-[10px] border border-line bg-surface/95 px-3 py-2 text-[11.5px] text-muted">
        {path.courses.map((c) => <span key={c.key} className="flex items-center gap-1"><span className="h-1.5 w-4 rounded-full" style={{ background: c.color }} />{c.spaceName}</span>)}
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

function ConceptSheet({ c, path, note, save, onClose, onOpen }: { c: BuiltConcept; path: BuiltPath; note: Note; save: (b: string) => void; onClose: () => void; onOpen: (k: string) => void }) {
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
        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Taught in · {new Set(c.coverage.map((x) => x.course.key)).size} courses</h4>
          {c.coverage.map((cov, k) => (
            <div key={k} className="mb-1.5 flex items-center gap-2 rounded-[10px] border border-line px-2.5 py-2" style={{ borderLeft: `3px solid ${cov.course.color}` }}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium" dir="auto">{cov.topic.name}</div>
                <div className="truncate text-[11.5px] text-muted">{cov.course.spaceIcon} {cov.course.spaceName} › {cov.module}{cov.topic.due ? ` · 📅 ${cov.topic.due}` : ""}</div>
              </div>
              <select value={cov.topic.status} onChange={(e) => setCourseStatus(cov, e.target.value as TopicStatus)} className="rounded-[6px] border border-line bg-bg px-1.5 py-1 text-[12px]">
                {(["todo", "learning", "done", "skipped"] as TopicStatus[]).map((s) => <option key={s}>{s}</option>)}
              </select>
              <button title="Open lesson note" onClick={() => openLesson(cov)} className="text-muted hover:text-link"><FileText size={15} /></button>
            </div>
          ))}
          {!c.coverage.length && (
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!c.def.done} onChange={(e) => save(setManualDone(note.body, c, e.target.checked))} className="size-4 accent-[var(--accent)]" /> Learned (your own concept, not in a course)</label>
          )}
        </section>

        {(c.needs.length > 0 || c.unlocks.length > 0) && (
          <section>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Prerequisites (merged across courses)</h4>
            <div className="flex flex-wrap gap-1.5">
              {c.needs.map((n) => { const d = path.byKey.get(n)!; return <button key={n} onClick={() => onOpen(n)} className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[12px]"><span className="size-1.5 rounded-full" style={{ background: ST_COLOR[d.status] }} />{d.def.name}</button>; })}
            </div>
            {c.unlocks.length > 0 && <div className="mt-2 text-[12px] text-muted">Unlocks: {c.unlocks.map((n) => path.byKey.get(n)?.def.name).join(", ")}</div>}
          </section>
        )}

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
              {path.concepts.filter((x) => x.key !== c.key).map((x) => <button key={x.key} onClick={() => { save(mergeConcepts(note.body, c, x)); setMerge(false); toast(`Merged “${x.def.name}” into “${c.def.name}”`); }} className="flex w-full justify-between rounded-[6px] px-2 py-1 text-left text-[12.5px] hover:bg-surface-2"><span>{x.def.name}</span><span className="text-muted">{[...new Set(x.coverage.map((y) => y.course.spaceName))].join(", ")}</span></button>)}
            </div>
          )}
        </section>
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
    <div className="mt-3 rounded-[10px] border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--accent)_7%,transparent)] px-3 py-2 text-[12.5px]">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left"><GitMerge size={14} className="text-accent" /><b>{pairs.length} possible overlaps</b><span className="text-muted">between courses: same idea, different names?</span><ChevronDown size={13} className={cx("ml-auto transition-transform", open && "rotate-180")} /></button>
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
