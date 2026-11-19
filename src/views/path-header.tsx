// Learning path header (PathDesk): collapsible summary, course chips, searchable course list, + Courses, Organize ▾,
// overlaps panel (Merge / They're different / Review all in bulk). Phone: compact header row + ⋯ menu.
import { ArrowLeft, Check, ChevronDown, ChevronUp, EllipsisVertical, Loader2, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Note } from "../../shared/types";
import { Glyph } from "../components/Glyph";
import { cx } from "../components/ui";
import { updateNote } from "../lib/actions";
import type { GlyphName } from "../lib/glyphs";
import { cellStatus, mergeConcepts, overlapReason, overlapSuggestions, serializePath, type BuiltConcept, type BuiltPath, type CourseRef } from "../lib/path";
import { back, go, openNote, toast, useVault } from "../lib/store";
import { canGoBack } from "../lib/nav-history";
import { NavButtons } from "../components/nav-buttons";
import { MenuItem, Popover, Ring, useEscape } from "./path-ui";

export const kindGlyph = (c: CourseRef): GlyphName => `k-${c.kind ?? "video"}` as GlyphName;
export function courseProgress(path: BuiltPath, c: CourseRef) {
  const total = path.concepts.filter((x) => x.coverage.some((y) => y.course.key === c.key));
  return { done: total.filter((x) => cellStatus(x, c) === "done").length, total: total.length };
}
const openCourse = (c: CourseRef) => (c.spaceId ? go("space", { spaceId: c.spaceId, folderId: null, noteId: null }) : c.note ? openNote(c.note.id) : toast("Course roadmap not found"));

export interface Stats { done: number; total: number; pct: number; learning: number; review: number; mastered: number }

export function StatsLine({ s }: { s: Stats }) {
  return (
    <span className="flex items-center gap-2.5 whitespace-nowrap">
      <span><b className="font-[650]">{s.done}</b> <span className="text-muted">/ {s.total} learned</span></span><span className="text-muted">·</span>
      <span className="text-info">{s.learning} learning</span><span className="text-muted">·</span>
      <span className="text-learn">{s.review} to revise</span><span className="text-muted">·</span>
      <span className="text-ok">{s.mastered} mastered</span>
    </span>
  );
}

/** Course chip: colour bar · kind glyph · name · done/total (opens the course page). */
export function CourseChip({ c, path }: { c: CourseRef; path: BuiltPath }) {
  const p = courseProgress(path, c);
  return (
    <button onClick={() => openCourse(c)} title={c.note ? `Open ${c.spaceName}` : "Course roadmap not found"} data-course-chip={c.key}
      className={cx("flex h-8 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-[8px] border border-line bg-surface pe-2.5 hover:border-ink/40", !c.note && "opacity-60")}>
      <span className="w-[3px] self-stretch" style={{ background: c.color }} />
      <Glyph name={kindGlyph(c)} size={14} color={c.color} />
      <span className="font-medium" dir="auto">{c.spaceName}</span>
      <span className="text-[12px] tabular-nums text-muted">{p.done}/{p.total}</span>
    </button>
  );
}

/** "+N more" → searchable course list with progress. */
function CourseList({ path, more }: { path: BuiltPath; more: number }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = path.courses.filter((c) => !q || c.spaceName.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex h-8 items-center rounded-[8px] border border-dashed border-line px-3 text-muted hover:text-ink">+{more} more</button>
      <Popover open={open} onClose={() => setOpen(false)} className="left-0 top-full mt-1 flex max-h-[60vh] w-[340px] flex-col">
        <label className="mb-1 flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] border border-line bg-bg px-2">
          <Search size={13} className="text-muted" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${path.courses.length} courses`} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
        </label>
        <div className="min-h-0 overflow-y-auto">
          {list.map((c) => {
            const p = courseProgress(path, c);
            return (
              <button key={c.key} onClick={() => { setOpen(false); openCourse(c); }} className="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left hover:bg-surface">
                <span className="h-5 w-[3px] shrink-0 rounded-[2px]" style={{ background: c.color }} />
                <Glyph name={kindGlyph(c)} size={14} color={c.color} />
                <span className="min-w-0 flex-1 truncate text-[13px]" dir="auto">{c.spaceName}</span>
                <span className="h-1 w-12 shrink-0 overflow-hidden rounded-[2px] bg-bg"><span className="block h-full bg-ok" style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} /></span>
                <span className="w-11 shrink-0 text-right text-[12px] tabular-nums text-muted">{p.done}/{p.total}</span>
              </button>
            );
          })}
          {!list.length && <p className="px-2 py-3 text-[12.5px] text-muted">No course matches.</p>}
        </div>
      </Popover>
    </div>
  );
}

/** + Courses: pick the course roadmaps this path combines. */
export function CoursePicker({ note, path, open, setOpen, className }: { note: Note; path: BuiltPath; open: boolean; setOpen: (o: boolean) => void; className?: string }) {
  const v = useVault();
  const [q, setQ] = useState("");
  const options = useMemo(() => {
    const fromSpaces = v.spaces.filter((s) => s.kind === "course" && s.roadmapId && !s.deleted).map((s) => s.name);
    const loose = v.notes.filter((n) => n.type === "roadmap" && !n.deleted && !v.spaces.some((s) => s.roadmapId === n.id)).map((n) => n.title);
    return [...new Set([...fromSpaces, ...loose])];
  }, [v.spaces, v.notes]);
  const set = (names: string[]) => void updateNote(note.id, { body: serializePath({ ...path.doc, courses: names }) });
  return (
    <Popover open={open} onClose={() => setOpen(false)} className={cx("flex max-h-[60vh] w-[300px] flex-col", className)}>
      <div className="px-2 pb-1 pt-0.5 text-[12px] font-medium text-muted">Courses in this path · {path.doc.courses.length}</div>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a course" className="mb-1 h-8 w-full shrink-0 rounded-[7px] border border-line bg-bg px-2 text-[13px] outline-none focus:border-accent" />
      <div className="min-h-0 overflow-y-auto">
        {options.filter((o) => !q || o.toLowerCase().includes(q.toLowerCase())).map((o) => {
          const on = path.doc.courses.some((c) => c.toLowerCase() === o.toLowerCase());
          return <MenuItem key={o} on={on} onClick={() => set(on ? path.doc.courses.filter((c) => c.toLowerCase() !== o.toLowerCase()) : [...path.doc.courses, o])}>{o}</MenuItem>;
        })}
        {!options.length && <div className="px-2 py-2 text-[12.5px] text-muted">No course roadmaps yet. Create a Course space first.</div>}
      </div>
    </Popover>
  );
}

/** Organize ▾ : Auto (from prerequisites) / AI. */
function OrganizeMenu({ onAuto, onAI, busy }: { onAuto: () => void; onAI: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex h-8 items-center gap-1.5 rounded-[10px] border border-line px-3 hover:border-ink/40">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Glyph name="organize" size={15} />}Organize<ChevronDown size={13} className="text-muted" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="right-0 top-full mt-1 w-[280px]">
        <button onClick={() => { setOpen(false); onAuto(); }} className="flex w-full flex-col items-start gap-0.5 rounded-[7px] px-2.5 py-2 text-left hover:bg-surface"><span className="font-semibold">Auto</span><span className="text-[12px] text-muted">Stages from prerequisites across all courses.</span></button>
        <button onClick={() => { setOpen(false); onAI(); }} disabled={busy} className="flex w-full flex-col items-start gap-0.5 rounded-[7px] px-2.5 py-2 text-left hover:bg-surface disabled:opacity-50"><span className="font-semibold">AI</span><span className="text-[12px] text-muted">Groups and merges concepts by meaning. Needs sync.</span></button>
      </Popover>
    </div>
  );
}

export function useOverlaps(path: BuiltPath, noteId: string) {
  const key = `lumen.path.dismiss.${noteId}`;
  const [dismissed, setDismissed] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; } });
  const pairs = useMemo(() => overlapSuggestions(path, dismissed), [path, dismissed]);
  const dismiss = (list: [BuiltConcept, BuiltConcept][]) => setDismissed((d) => { const n = [...d, ...list.flatMap(([a, b]) => [`${a.key}|${b.key}`, `${b.key}|${a.key}`])]; try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  return { pairs, dismiss };
}

/** Overlaps panel: one pair per row (Merge / They're different), "Review all" = bulk decisions + one Apply. */
export function OverlapsPanel({ path, note, save, ov, onClose, className }: { path: BuiltPath; note: Note; save: (b: string) => void; ov: ReturnType<typeof useOverlaps>; onClose: () => void; className?: string }) {
  const [bulk, setBulk] = useState<Record<string, "merge" | "diff"> | null>(null);
  const id = ([a, b]: [BuiltConcept, BuiltConcept]) => `${a.key}|${b.key}`;
  const merge = ([a, b]: [BuiltConcept, BuiltConcept]) => { save(mergeConcepts(note.body, a, b)); toast(`Merged into “${a.def.name}”`); };
  function apply() {
    if (!bulk) return;
    let body = note.body, n = 0;
    const diff: [BuiltConcept, BuiltConcept][] = [];
    for (const pr of ov.pairs) {
      const d = bulk[id(pr)];
      if (d === "merge") { body = mergeConcepts(body, pr[0], pr[1]); n++; } else if (d === "diff") diff.push(pr);
    }
    if (n) save(body);
    if (diff.length) ov.dismiss(diff);
    toast(`${n} merged · ${diff.length} kept apart`);
    setBulk(null);
  }
  return (
    <div role="dialog" aria-label="Possible overlaps" className={cx("fade-in z-[25] flex max-h-[70vh] w-[420px] flex-col rounded-[14px] border border-line bg-surface-2", className)} style={{ boxShadow: "0 16px 40px rgba(0,0,0,.4)" }}>
      <div className="flex items-center gap-2 px-4 pb-2.5 pt-3.5">
        <span className="flex-1 text-[15px] font-[650]">{ov.pairs.length} possible overlaps</span>
        {ov.pairs.length > 0 && <button onClick={() => setBulk(bulk ? null : Object.fromEntries(ov.pairs.map((p) => [id(p), "merge" as const])))} className="text-[12.5px] text-link">{bulk ? "One by one" : "Review all"}</button>}
        <button aria-label="Close" onClick={onClose} className="text-muted hover:text-ink"><X size={15} /></button>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {ov.pairs.map((pr) => {
          const [a, b] = pr;
          const d = bulk?.[id(pr)];
          return (
            <div key={id(pr)} className="flex flex-col gap-2 border-t border-line px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2"><span className="font-semibold" dir="auto">{a.def.name}</span><span className="text-muted">≈</span><span className="font-semibold" dir="auto">{b.def.name}</span><span className="flex-1" /><span className="text-[12px] text-muted">{overlapReason(a, b)}</span></div>
              {bulk ? (
                <div className="flex gap-1.5">
                  {(["merge", "diff"] as const).map((k) => (
                    <button key={k} onClick={() => setBulk({ ...bulk, [id(pr)]: k })} className="flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px]"
                      style={{ border: `1px solid ${d === k ? "var(--accent)" : "var(--border)"}`, background: d === k ? "color-mix(in srgb,var(--accent) 14%,transparent)" : "transparent", fontWeight: d === k ? 600 : 450 }}>
                      {d === k && <Check size={12} />}{k === "merge" ? "Merge" : "They're different"}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <button onClick={() => merge(pr)} className="flex h-7 items-center gap-1.5 rounded-[8px] border border-line px-2.5 text-[12.5px] hover:border-ink/40"><Glyph name="merge" size={13} />Merge</button>
                  <button onClick={() => ov.dismiss([pr])} className="flex h-7 items-center rounded-[8px] px-2.5 text-[12.5px] text-muted hover:text-ink">They're different</button>
                </div>
              )}
            </div>
          );
        })}
        {!ov.pairs.length && <p className="border-t border-line px-4 py-3 text-[13px] text-muted">No overlaps left. Courses that name the same idea differently show up here.</p>}
      </div>
      {bulk && ov.pairs.length > 0 && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
          <span className="flex-1 text-[12.5px] text-muted">{Object.values(bulk).filter((x) => x === "merge").length} to merge · {Object.values(bulk).filter((x) => x === "diff").length} different</span>
          <button onClick={() => setBulk(null)} className="text-[12.5px] text-muted">Cancel</button>
          <button onClick={apply} className="flex h-7 items-center rounded-[8px] bg-accent px-3 text-[12.5px] font-semibold text-accent-fg">Apply</button>
        </div>
      )}
    </div>
  );
}

/** Desktop header. Collapsed (default above 6 courses): one line. Expanded: + Courses, Organize ▾, course chips. */
export function PathHeader({ note, path, stats, open, toggle, ov, ovOpen, setOvOpen, onAuto, onAI, busy, save, children }: {
  note: Note; path: BuiltPath; stats: Stats; open: boolean; toggle: () => void; ov: ReturnType<typeof useOverlaps>; ovOpen: boolean; setOvOpen: (o: boolean) => void;
  onAuto: () => void; onAI: () => void; busy: boolean; save: (b: string) => void; children: React.ReactNode;
}) {
  const [pick, setPick] = useState(false);
  const LIMIT = 8;
  const stageCount = path.stages.filter((s) => s.name !== "Not placed yet").length;
  return (
    <div className="relative flex flex-col gap-3.5 border-b border-line px-7 pt-4">
      <div className="flex items-center gap-3.5">
        <NavButtons />
        <Glyph name="path" size={20} tile="#F2A93B" color="var(--accent)" />
        <div className="flex min-w-0 max-w-[45%] shrink-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2"><span className="truncate text-[20px] font-[650] tracking-[-.02em]" dir="auto">{note.title}</span><span className="shrink-0 rounded-[6px] border border-line px-[7px] text-[12px] leading-5 text-muted">Path</span></div>
          <span className="truncate text-[12px] text-muted">{path.courses.length} {path.courses.length === 1 ? "course" : "courses"} · {stats.total} concepts · {stageCount} {stageCount === 1 ? "stage" : "stages"}</span>
        </div>
        <span className="ms-2 shrink-0"><Ring pct={stats.pct} /></span>
        <span className="min-w-0 overflow-hidden"><StatsLine s={stats} /></span>
        <span className="flex-1" />
        <button onClick={() => setOvOpen(!ovOpen)} aria-expanded={ovOpen} className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 font-medium"
          style={{ border: `1px solid ${ovOpen ? "var(--accent)" : "var(--border)"}`, background: ovOpen ? "color-mix(in srgb,var(--accent) 12%,transparent)" : "transparent" }}>
          <Glyph name="overlap" size={15} />{ov.pairs.length} overlaps
        </button>
        {open && (
          <>
            <div className="relative">
              <button onClick={() => setPick((o) => !o)} className="flex h-8 items-center gap-1.5 rounded-[10px] border border-line px-3 hover:border-ink/40"><Plus size={14} />Courses</button>
              <CoursePicker note={note} path={path} open={pick} setOpen={setPick} className="right-0 top-full mt-1" />
            </div>
            <OrganizeMenu onAuto={onAuto} onAI={onAI} busy={busy} />
          </>
        )}
        <button onClick={toggle} aria-expanded={open} aria-label={open ? "Collapse header" : "Expand header"} title={open ? "Collapse" : "Show courses and actions"} className="flex size-8 items-center justify-center rounded-[8px] border border-line text-muted hover:text-ink">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
      </div>
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          {path.courses.slice(0, LIMIT).map((c) => <CourseChip key={c.key} c={c} path={path} />)}
          {path.courses.length > LIMIT && <CourseList path={path} more={path.courses.length - LIMIT} />}
          {!path.courses.length && <span className="text-[12.5px] text-muted">No courses yet: add some with + Courses, or build the path yourself in Stages.</span>}
        </div>
      )}
      {children}
      {ovOpen && <OverlapsPanel path={path} note={note} save={save} ov={ov} onClose={() => setOvOpen(false)} className="absolute right-[250px] top-[58px]" />}
    </div>
  );
}

/** Phone header (R4-14I): back · path tile · name + "41 / 101 learned · 3 to revise" · ring · ⋯ menu. */
export function PathHeaderPhone({ note, path, stats, ovCount, onOverlaps, onAuto, onAI, busy }: { note: Note; path: BuiltPath; stats: Stats; ovCount: number; onOverlaps: () => void; onAuto: () => void; onAI: () => void; busy: boolean }) {
  const [menu, setMenu] = useState<null | "main" | "courses" | "list">(null);
  useEscape(() => setMenu(null), !!menu);
  const row = "flex min-h-[48px] w-full items-center gap-3 rounded-[10px] px-3 text-left text-[15px] active:bg-surface-2";
  return (
    <>
      {/* the path view's header is the only header on a path note (NoteView hides its toolbar), so it has Back */}
      <div className="safe-t flex h-14 shrink-0 items-center gap-1 ps-1 pe-1">
        <button aria-label="Back" onClick={() => (canGoBack() ? history.back() : back())} className="flex size-11 shrink-0 items-center justify-center"><ArrowLeft size={20} className="rtl:rotate-180" /></button>
        <Glyph name="path" size={16} tile="#F2A93B" color="var(--accent)" />
        <div className="ms-1.5 flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[16px] font-[650]" dir="auto">{note.title}</span>
          <span className="truncate text-[11.5px] text-muted">{stats.done} / {stats.total} learned · {stats.review} to revise</span>
        </div>
        <Ring pct={stats.pct} size={34} inner={27} label={false} />
        <button aria-label="Path menu" onClick={() => setMenu("main")} className="flex h-12 w-11 items-center justify-center">{busy ? <Loader2 size={18} className="animate-spin" /> : <EllipsisVertical size={20} />}</button>
      </div>
      {menu && (
        <>
          <div className="fixed inset-0 z-40" style={{ background: "rgba(5,6,8,.55)" }} onClick={() => setMenu(null)} />
          <div role="dialog" aria-label="Path menu" className="sheet-in safe-b fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col rounded-t-[14px] bg-surface px-2 pb-3 pt-2.5">
            <div className="flex justify-center pb-2"><span className="h-1 w-9 rounded-[2px] bg-line" /></div>
            <div className="min-h-0 overflow-y-auto">
              {menu === "main" && (
                <>
                  <button className={row} onClick={() => setMenu("list")}><Glyph name="course" size={18} />Courses · {path.courses.length}</button>
                  <button className={row} onClick={() => setMenu("courses")}><Plus size={18} />Add or remove courses</button>
                  <button className={row} onClick={() => { setMenu(null); onAuto(); }}><Glyph name="organize" size={18} />Organize · Auto</button>
                  <button className={row} onClick={() => { setMenu(null); onAI(); }}><Glyph name="organize" size={18} />Organize · AI</button>
                  <button className={row} onClick={() => { setMenu(null); onOverlaps(); }}><Glyph name="overlap" size={18} />{ovCount} overlaps</button>
                </>
              )}
              {menu === "list" && path.courses.map((c) => <div key={c.key} className="px-1 py-0.5"><CourseChip c={c} path={path} /></div>)}
              {menu === "courses" && <PhoneCoursePicker note={note} path={path} />}
            </div>
          </div>
        </>
      )}
    </>
  );
}
function PhoneCoursePicker({ note, path }: { note: Note; path: BuiltPath }) {
  const v = useVault();
  const options = [...new Set([...v.spaces.filter((s) => s.kind === "course" && s.roadmapId && !s.deleted).map((s) => s.name), ...v.notes.filter((n) => n.type === "roadmap" && !n.deleted && !v.spaces.some((s) => s.roadmapId === n.id)).map((n) => n.title)])];
  const set = (names: string[]) => void updateNote(note.id, { body: serializePath({ ...path.doc, courses: names }) });
  return <>{options.map((o) => { const on = path.doc.courses.some((c) => c.toLowerCase() === o.toLowerCase()); return <MenuItem key={o} on={on} onClick={() => set(on ? path.doc.courses.filter((c) => c.toLowerCase() !== o.toLowerCase()) : [...path.doc.courses, o])}>{o}</MenuItem>; })}</>;
}
