// Learning path view (design: Lumen 14 Learning Paths + PathDesk, round 4). The parts live in path-*.tsx:
// header (path-header), Stages (path-stages), Graph (path-graph), Matrix (path-matrix), Timeline (path-timeline),
// Revise (path-revise), concept sheet (path-sheet), shared design parts (path-ui).
import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Note } from "../../shared/types";
import { Glyph } from "../components/Glyph";
import { createNote, updateNote } from "../lib/actions";
import { aiRun, getToken } from "../lib/api";
import {
  addStage, autoOrganize, buildPath, filterCount, matchesFilter, mergeConcepts, moveConcept, NO_FILTER, norm, pathProgress, resolveCourses, scheduleNewlyDone, serializePath, UNPLACED,
  type BuiltConcept, type GroupBy, type PathFilter,
} from "../lib/path";
import { toast, useVault } from "../lib/store";
import { Graph } from "./path-graph";
import { OverlapsPanel, PathHeader, PathHeaderPhone, useOverlaps } from "./path-header";
import { Matrix } from "./path-matrix";
import { Revise } from "./path-revise";
import { ConceptSheet } from "./path-sheet";
import { Stages, StagesPhone } from "./path-stages";
import { Timeline } from "./path-timeline";
import { FilterRow, FilterSheet, TabBar, usePathConfirm, useStored, type Tab } from "./path-ui";
import { usePhone } from "./spaces-util";

export function PathView({ note }: { note: Note }) {
  const v = useVault();
  const phone = usePhone();
  const [tab, setTab] = useStored<Tab>("lumen.path.tab", "stages");
  const [sel, setSel] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ovOpen, setOvOpen] = useState(false);
  const [filterSheet, setFilterSheet] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [f, setF] = useStored<PathFilter>(`lumen.path.filter.${note.id}`, NO_FILTER);
  const [group, setGroup] = useStored<GroupBy>(`lumen.path.group.${note.id}`, "stage");
  const [cols, setCols] = useStored<string[]>(`lumen.path.cols.${note.id}`, []);
  const courseNames = useMemo(() => buildPath(note.body, []).doc.courses, [note.body]);
  const courses = useMemo(() => resolveCourses(courseNames, v.notes, v.spaces), [courseNames, v.notes, v.spaces]);
  const path = useMemo(() => buildPath(note.body, courses), [note.body, courses]);
  const prog = pathProgress(path);
  const save = (body: string) => void updateNote(note.id, { body });
  const ov = useOverlaps(path, note.id);
  const [confirmNode, confirm] = usePathConfirm();
  // concepts that just became done enter the revision ladder
  useEffect(() => { const b = scheduleNewlyDone(note.body, path); if (b && b !== note.body) save(b); }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  // header: collapsed by default above 6 courses; remembered per path
  const headKey = `lumen.path.head.${note.id}`;
  const [headOpen, setHeadOpen] = useState(() => { try { const x = localStorage.getItem(headKey); if (x) return x === "1"; } catch { /* ignore */ } return courseNames.length <= 6; });
  const toggleHead = () => setHeadOpen((o) => { try { localStorage.setItem(headKey, o ? "0" : "1"); } catch { /* ignore */ } return !o; });
  const keep = useCallback((c: BuiltConcept) => matchesFilter(c, f), [f]);
  const count = (x: PathFilter) => path.concepts.filter((c) => matchesFilter(c, x)).length;
  const selected = sel ? path.byKey.get(sel) ?? null : null;
  const openConcept = (k: string) => setSel(k);
  const focusIn = (k: string) => { setFocus(k); setSel(phone ? null : k); setTab("graph"); };
  const realStages = path.stages.filter((s) => s.name !== UNPLACED).map((s) => s.name);
  const allCollapsed = realStages.length > 0 && realStages.every((s) => cols.includes(s));

  function auto() { save(autoOrganize(note.body, path)); toast("Stages rebuilt from prerequisites across all courses"); }
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

  const empty = !courses.length && !path.concepts.length;
  const view = tab === "stages"
    ? phone ? <StagesPhone path={path} note={note} onOpen={openConcept} save={save} confirm={confirm} keep={keep} group={group} allOpen={allOpen} />
      : <Stages path={path} note={note} onOpen={openConcept} save={save} confirm={confirm} keep={keep} group={group} collapsed={cols} setCollapsed={setCols} sel={sel} />
    : empty ? <div className="mx-auto flex max-w-md flex-col items-center gap-3 p-10 text-center text-[13px] text-muted"><Glyph name="path" size={24} color="var(--muted)" />Add courses to this path, or build it yourself in Stages. Each course keeps its own roadmap; the path merges overlapping topics into concepts.</div>
    : tab === "graph" ? <ReactFlowProvider><Graph path={path} note={note} save={save} onOpen={openConcept} sel={sel} keep={keep} focus={focus} setFocus={setFocus} /></ReactFlowProvider>
    : tab === "matrix" ? <Matrix path={path} onOpen={openConcept} keep={keep} group={group} f={f} setF={setF} noteId={note.id} />
    : tab === "timeline" ? <Timeline path={path} onOpen={openConcept} keep={keep} noteId={note.id} />
    : <Revise path={path} note={note} save={save} onOpen={openConcept} keep={keep} />;

  if (phone) {
    const n = filterCount(f);
    return (
      <div className="lp-root flex h-full min-h-0 flex-col bg-bg text-[14px]">
        <PathHeaderPhone note={note} path={path} stats={prog} ovCount={ov.pairs.length} onOverlaps={() => setOvOpen(true)} onAuto={auto} onAI={aiOrganize} busy={busy} />
        <TabBar tab={tab} setTab={setTab} revise={prog.review} phone />
        <div className="flex shrink-0 gap-2 px-4 pb-3">
          <button onClick={() => setFilterSheet(true)} className="flex h-9 items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13px]"><Glyph name="filter" size={15} />Filter{n > 0 && <span className="rounded-full bg-surface-2 px-1.5 text-[11px] leading-[17px]">{n}</span>}</button>
          <button onClick={() => setOvOpen(true)} className="flex h-9 items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13px]"><Glyph name="overlap" size={15} />{ov.pairs.length} overlaps</button>
          <span className="flex-1" />
          {tab === "stages" && <button onClick={() => setAllOpen((a) => !a)} className="flex h-9 items-center text-[13px] text-muted">{allOpen ? "Collapse all" : "Expand all"}</button>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{view}</div>
        {selected && <ConceptSheet c={selected} path={path} note={note} save={save} onClose={() => setSel(null)} onOpen={openConcept} onFocus={focusIn} phone />}
        {filterSheet && <FilterSheet path={path} f={f} setF={setF} count={count} onClose={() => setFilterSheet(false)} />}
        {ovOpen && (
          <>
            <div className="fixed inset-0 z-40" style={{ background: "rgba(5,6,8,.55)" }} onClick={() => setOvOpen(false)} />
            <div className="sheet-in fixed inset-x-0 bottom-0 z-50 [&>div]:!w-full [&>div]:rounded-b-none"><OverlapsPanel path={path} note={note} save={save} ov={ov} onClose={() => setOvOpen(false)} /></div>
          </>
        )}
        {confirmNode}
      </div>
    );
  }

  return (
    <div className="lp-root relative flex h-full min-h-0 flex-col bg-bg text-[13px]">
      <PathHeader note={note} path={path} stats={prog} open={headOpen} toggle={toggleHead} ov={ov} ovOpen={ovOpen} setOvOpen={setOvOpen} onAuto={auto} onAI={aiOrganize} busy={busy} save={save}>
        <div className="flex items-center gap-[18px]">
          <TabBar tab={tab} setTab={setTab} revise={prog.review} />
          <span className="flex-1" />
          <FilterRow path={path} f={f} setF={setF} group={group} setGroup={setGroup} collapseAll={tab === "stages" ? allCollapsed : null}
            onCollapseAll={tab === "stages" && group === "stage" ? () => setCols(allCollapsed ? [] : realStages) : undefined} />
        </div>
      </PathHeader>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 isolate overflow-hidden">{view}</div>
      </div>
      {selected && <ConceptSheet c={selected} path={path} note={note} save={save} onClose={() => setSel(null)} onOpen={openConcept} onFocus={focusIn} phone={false} />}
      {confirmNode}
    </div>
  );
}

/** Create a new path note from selected courses. */
export async function createPath(title: string, courseNames: string[], spaceId: string, ctx: { notes: Note[]; spaces: { id: string; name: string; icon: string; roadmapId: string | null }[] }) {
  const { newPathBody } = await import("../lib/path");
  const body = newPathBody(title, courseNames, resolveCourses(courseNames, ctx.notes, ctx.spaces));
  return createNote({ type: "path", title, body, spaceId });
}
