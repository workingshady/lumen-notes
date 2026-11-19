// Learning paths: shared design parts (Lumen 14 / PathDesk / Lumen 21 components): status icons, ring, menus,
// tab bar with counts, filter row + phone filter sheet, inline confirm bar, remembered UI state.
import { Check, ChevronDown, Circle, CircleCheck, CircleDot, History, Lock, Star, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Glyph } from "../components/Glyph";
import { cx } from "../components/ui";
import type { GlyphName } from "../lib/glyphs";
import { conceptState, filterCount, NO_FILTER, UNPLACED, type BuiltConcept, type BuiltPath, type ConceptState, type GroupBy, type PathFilter } from "../lib/path";

export type Tab = "stages" | "graph" | "matrix" | "timeline" | "revise";

// ------------------------------------------------------------------ statuses (Lucide in cards, as the design does; glyphs in headers)
export const ST: Record<ConceptState | "revise", { icon: LucideIcon; glyph: GlyphName; color: string; label: string }> = {
  todo: { icon: Circle, glyph: "s-todo", color: "var(--muted)", label: "Todo" },
  learning: { icon: CircleDot, glyph: "s-learning", color: "var(--info)", label: "Learning" },
  learned: { icon: CircleCheck, glyph: "s-done", color: "var(--success)", label: "Learned" },
  mastered: { icon: Star, glyph: "s-mastered", color: "var(--success)", label: "Mastered" },
  locked: { icon: Lock, glyph: "s-locked", color: "var(--muted)", label: "Locked" },
  revise: { icon: History, glyph: "s-revise", color: "var(--learn)", label: "To revise" },
};
export const stOf = (c: BuiltConcept) => ST[conceptState(c)];
export function StatusIcon({ c, size = 15, className }: { c: BuiltConcept; size?: number; className?: string }) {
  const s = stOf(c);
  const I = s.icon;
  return <I size={size} strokeWidth={2} className={cx("shrink-0", className)} style={{ color: s.color }} aria-label={s.label} />;
}
export const stageLabel = (path: BuiltPath, c: BuiltConcept) => (c.placed ? `Step ${c.stageIndex + 1} · ${c.stage.replace(/^Stage \d+ · /, "")}` : UNPLACED);
export const shortStage = (name: string) => name.replace(/^Stage \d+ · /, "");

/** Progress ring (design: conic gradient, inner disc, % label). */
export function Ring({ pct, size = 40, inner = 32, label = true }: { pct: number; size?: number; inner?: number; label?: boolean }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full" style={{ width: size, height: size, background: `conic-gradient(var(--success) 0 ${pct}%, var(--surface-2) ${pct}% 100%)` }} aria-label={`${pct}% learned`}>
      <span className="flex items-center justify-center rounded-full bg-bg text-[10.5px] font-[650]" style={{ width: inner, height: inner }}>{label ? `${pct}%` : ""}</span>
    </span>
  );
}

/** Remembered UI state (per path / per section), localStorage-backed. */
export function useStored<T>(key: string, init: T | (() => T)) {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem(key); if (s !== null) return JSON.parse(s) as T; } catch { /* ignore */ } return typeof init === "function" ? (init as () => T)() : init; });
  const set = (x: T | ((o: T) => T)) => setV((o) => { const n = typeof x === "function" ? (x as (o: T) => T)(o) : x; try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  return [v, set] as const;
}

// ------------------------------------------------------------------ popover menu
export function Popover({ open, onClose, children, className, style }: { open: boolean; onClose: () => void; children: ReactNode; className?: string; style?: CSSProperties }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div role="menu" className={cx("fade-in absolute z-40 rounded-[12px] border border-line bg-surface-2 p-1.5 shadow-xl", className)} style={style}>{children}</div>
    </>
  );
}
export function MenuItem({ on, children, onClick, hint }: { on?: boolean; children: ReactNode; onClick: () => void; hint?: ReactNode }) {
  return (
    <button role="menuitemcheckbox" aria-checked={!!on} onClick={onClick} className="flex min-h-[32px] w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13px] hover:bg-surface">
      <span className={cx("flex size-4 shrink-0 items-center justify-center rounded-[4px]", on ? "bg-accent text-accent-fg" : "border border-line")}>{on && <Check size={11} strokeWidth={3} />}</span>
      <span className="min-w-0 flex-1 truncate" dir="auto">{children}</span>
      {hint && <span className="shrink-0 text-[11.5px] text-muted">{hint}</span>}
    </button>
  );
}

// ------------------------------------------------------------------ tab bar (desktop underline tabs with glyph + count; phone pills)
export const TABS: { k: Tab; l: string; g: GlyphName }[] = [
  { k: "stages", l: "Stages", g: "v-board" }, { k: "graph", l: "Graph", g: "graph" }, { k: "matrix", l: "Matrix", g: "v-table" }, { k: "timeline", l: "Timeline", g: "v-calendar" }, { k: "revise", l: "Revise", g: "s-revise" },
];
const Count = ({ n }: { n: number }) => <span className="inline-block rounded-full px-1.5 text-[11px] font-semibold leading-[17px]" style={{ background: "color-mix(in srgb,var(--learn) 16%,transparent)", color: "var(--learn)" }}>{n}</span>;
export function TabBar({ tab, setTab, revise, phone }: { tab: Tab; setTab: (t: Tab) => void; revise: number; phone?: boolean }) {
  if (phone) return (
    <div role="tablist" className="flex shrink-0 gap-1.5 overflow-x-auto px-4 pb-2.5 [scrollbar-width:none]">
      {TABS.map((t) => (
        <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)}
          className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px]"
          style={{ background: tab === t.k ? "var(--surface-2)" : "transparent", border: `1px solid ${tab === t.k ? "var(--accent)" : "var(--border)"}`, fontWeight: tab === t.k ? 600 : 450 }}>
          {t.l}{t.k === "revise" && revise > 0 && <Count n={revise} />}
        </button>
      ))}
    </div>
  );
  return (
    <div role="tablist" className="flex items-center gap-[18px]">
      {TABS.map((t) => (
        <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)} className="flex items-center gap-1.5 pb-2.5 pt-2"
          style={{ boxShadow: tab === t.k ? "inset 0 -2px 0 var(--accent)" : "none", fontWeight: tab === t.k ? 600 : 450, color: tab === t.k ? "var(--text)" : "var(--muted)" }}>
          <Glyph name={t.g} size={15} />{t.l}{t.k === "revise" && revise > 0 && <Count n={revise} />}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ filters
const STATES: ConceptState[] = ["todo", "learning", "learned", "mastered", "locked"];
const toggle = <T,>(a: T[], x: T) => (a.includes(x) ? a.filter((y) => y !== x) : [...a, x]);

function FilterButton({ label, active, children, width = 260 }: { label: string; active: boolean; children: (close: () => void) => ReactNode; width?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[6px] border px-2.5 text-[12.5px]"
        style={{ borderColor: active ? "var(--accent)" : "var(--border)", background: active ? "color-mix(in srgb,var(--accent) 10%,transparent)" : "transparent", color: active ? "var(--text)" : "var(--muted)" }}>
        {label}<ChevronDown size={12} className="text-muted" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="right-0 top-full mt-1 max-h-[60vh] overflow-y-auto" style={{ width }}>{children(() => setOpen(false))}</Popover>
    </div>
  );
}

/** Desktop filter row: Course · Status · Stage · Group by. Filters apply to every tab. */
export function FilterRow({ path, f, setF, group, setGroup, collapseAll, onCollapseAll }: { path: BuiltPath; f: PathFilter; setF: (f: PathFilter) => void; group: GroupBy; setGroup: (g: GroupBy) => void; collapseAll?: boolean | null; onCollapseAll?: () => void }) {
  const [q, setQ] = useState("");
  const courseName = (k: string) => path.courses.find((c) => c.key === k)?.spaceName ?? k;
  const stages = path.stages.map((s) => s.name);
  const cl = !f.courses.length ? `Course: all ${path.courses.length}` : f.courses.length === 1 ? `Course: ${courseName(f.courses[0])}` : `Course: ${f.courses.length} picked`;
  const sl = !f.states.length && !f.overlapping && !f.revise && !f.unplaced ? "Status: any" : f.states.length === 1 && !f.revise && !f.overlapping && !f.unplaced ? `Status: ${ST[f.states[0]].label.toLowerCase()}` : `Status: ${f.states.length + Number(f.revise) + Number(f.overlapping) + Number(f.unplaced)} picked`;
  const gl = !f.stages.length ? "Stage: all" : f.stages.length === 1 ? `Stage: ${shortStage(f.stages[0])}` : `Stage: ${f.stages.length} picked`;
  return (
    <div className="flex items-center gap-2">
      <FilterButton label={cl} active={!!f.courses.length} width={300}>
        {() => (
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a course" autoFocus className="mb-1 h-8 w-full rounded-[7px] border border-line bg-bg px-2 text-[13px] outline-none focus:border-accent" />
            <MenuItem on={!f.courses.length} onClick={() => setF({ ...f, courses: [] })} hint={path.courses.length}>All courses</MenuItem>
            {path.courses.filter((c) => !q || c.spaceName.toLowerCase().includes(q.toLowerCase())).map((c) => (
              <MenuItem key={c.key} on={f.courses.includes(c.key)} onClick={() => setF({ ...f, courses: toggle(f.courses, c.key) })}><span className="me-1.5 inline-block h-3 w-[3px] rounded-[2px] align-[-1px]" style={{ background: c.color }} />{c.spaceName}</MenuItem>
            ))}
          </>
        )}
      </FilterButton>
      <FilterButton label={sl} active={!!(f.states.length || f.revise || f.overlapping || f.unplaced)}>
        {() => (
          <>
            <MenuItem on={!f.states.length} onClick={() => setF({ ...f, states: [] })}>Any status</MenuItem>
            {STATES.map((s) => <MenuItem key={s} on={f.states.includes(s)} onClick={() => setF({ ...f, states: toggle(f.states, s) })}>{ST[s].label}</MenuItem>)}
            <div className="my-1 border-t border-line" />
            <MenuItem on={f.revise} onClick={() => setF({ ...f, revise: !f.revise })}>To revise</MenuItem>
            <MenuItem on={f.overlapping} onClick={() => setF({ ...f, overlapping: !f.overlapping })}>Only overlapping</MenuItem>
            <MenuItem on={f.unplaced} onClick={() => setF({ ...f, unplaced: !f.unplaced })}>Not placed</MenuItem>
          </>
        )}
      </FilterButton>
      <FilterButton label={gl} active={!!f.stages.length}>
        {() => (
          <>
            <MenuItem on={!f.stages.length} onClick={() => setF({ ...f, stages: [] })}>All stages</MenuItem>
            {stages.map((s, i) => <MenuItem key={s} on={f.stages.includes(s)} onClick={() => setF({ ...f, stages: toggle(f.stages, s) })} hint={s === UNPLACED ? "" : i + 1}>{shortStage(s)}</MenuItem>)}
          </>
        )}
      </FilterButton>
      <GroupMenu group={group} setGroup={setGroup} />
      {filterCount(f) > 0 && <button onClick={() => setF(NO_FILTER)} className="whitespace-nowrap text-[12.5px] text-link">Clear</button>}
      {onCollapseAll && <button onClick={onCollapseAll} className="ms-1 whitespace-nowrap text-[12.5px] text-muted hover:text-ink">{collapseAll ? "Expand all" : "Collapse all"}</button>}
    </div>
  );
}
function GroupMenu({ group, setGroup }: { group: GroupBy; setGroup: (g: GroupBy) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[6px] border border-line px-2.5 text-[12.5px] text-ink">Group by {group}<ChevronDown size={12} className="text-muted" /></button>
      <Popover open={open} onClose={() => setOpen(false)} className="right-0 top-full mt-1 w-[200px]">
        {(["stage", "course", "status"] as GroupBy[]).map((g) => <MenuItem key={g} on={group === g} onClick={() => { setGroup(g); setOpen(false); }}>{g[0].toUpperCase() + g.slice(1)}</MenuItem>)}
      </Popover>
    </div>
  );
}

/** Phone filter sheet (R4-14M): Status · Course · Show chips, Clear + "Show N concepts". */
export function FilterSheet({ path, f, setF, count, onClose }: { path: BuiltPath; f: PathFilter; setF: (f: PathFilter) => void; count: (f: PathFilter) => number; onClose: () => void }) {
  const [d, setD] = useState(f);
  useEscape(onClose);
  const [more, setMore] = useState(false);
  const chip = (l: ReactNode, on: boolean, run: () => void, k: string) => (
    <button key={k} onClick={run} className="flex h-[38px] items-center rounded-full px-3 text-[13px]" style={{ border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "color-mix(in srgb,var(--accent) 14%,transparent)" : "transparent", fontWeight: on ? 600 : 450 }}>{l}</button>
  );
  const courses = more ? path.courses : path.courses.slice(0, 3);
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: "rgba(5,6,8,.55)" }} onClick={onClose} />
      <div role="dialog" aria-label="Filter" className="sheet-in safe-b fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] min-h-[60dvh] flex-col rounded-t-[14px] bg-surface px-4 pt-2.5">
        <div className="flex justify-center pb-2.5"><span className="h-1 w-9 rounded-[2px] bg-line" /></div>
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto">
          <span className="text-[18px] font-[650]">Filter</span>
          <div className="flex flex-col gap-2"><span className="text-[12.5px] font-medium text-muted">Status</span>
            <div className="flex flex-wrap gap-2">{STATES.map((s) => chip(ST[s].label, d.states.includes(s), () => setD({ ...d, states: toggle(d.states, s) }), s))}</div></div>
          <div className="flex flex-col gap-2"><span className="text-[12.5px] font-medium text-muted">Course</span>
            <div className="flex flex-wrap gap-2">
              {chip(`All ${path.courses.length}`, !d.courses.length, () => setD({ ...d, courses: [] }), "all")}
              {courses.map((c) => chip(c.spaceName, d.courses.includes(c.key), () => setD({ ...d, courses: toggle(d.courses, c.key) }), c.key))}
              {!more && path.courses.length > 3 && chip("More…", false, () => setMore(true), "more")}
            </div></div>
          <div className="flex flex-col gap-2"><span className="text-[12.5px] font-medium text-muted">Show</span>
            <div className="flex flex-wrap gap-2">
              {chip("Only overlapping", d.overlapping, () => setD({ ...d, overlapping: !d.overlapping }), "o")}
              {chip("To revise", d.revise, () => setD({ ...d, revise: !d.revise }), "r")}
              {chip("Not placed", d.unplaced, () => setD({ ...d, unplaced: !d.unplaced }), "u")}
            </div></div>
        </div>
        <div className="flex gap-2.5 py-3">
          <button onClick={() => setD(NO_FILTER)} className="flex h-[52px] items-center px-4 text-muted">Clear</button>
          <button onClick={() => { setF(d); onClose(); }} className="flex h-[52px] flex-1 items-center justify-center rounded-[12px] bg-accent font-semibold text-accent-fg">Show {count(d)} concepts</button>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ inline confirm bar (Lumen 21: "Delete this view?  Cancel  [Delete]")
export type Ask = (text: ReactNode, ok: string, run: () => void, danger?: boolean) => void;
export function ConfirmBar({ text, ok, danger, onOk, onCancel, className }: { text: ReactNode; ok: string; danger?: boolean; onOk: () => void; onCancel: () => void; className?: string }) {
  const c = danger ? "var(--danger)" : "var(--accent)";
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { btn.current?.focus(); }, []);
  return (
    <div role="alertdialog" aria-label="Confirm" className={cx("pdnd-confirm flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px]", className)}
      style={{ background: `color-mix(in srgb, ${c} 10%, var(--surface))`, border: `1px solid color-mix(in srgb, ${c} 30%, transparent)` }}>
      <span className="min-w-0 flex-1" dir="auto">{text}</span>
      <button onClick={onCancel} className="shrink-0 text-muted hover:text-ink">Cancel</button>
      <button ref={btn} onClick={onOk} className="flex h-[26px] shrink-0 items-center rounded-[7px] px-2.5 font-semibold" style={{ background: c, color: danger ? "#1A0B0B" : "var(--accent-fg)" }}>{ok}</button>
    </div>
  );
}
/** Confirm for drops on the board: the same inline bar, floating at the bottom of the view. */
export function usePathConfirm() {
  const [ask, setAsk] = useState<{ text: ReactNode; ok: string; run: () => void; danger?: boolean } | null>(null);
  useEffect(() => {
    if (!ask) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setAsk(null); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [ask]);
  const node = ask && (
    <div className="fade-in fixed inset-x-3 bottom-4 z-[60] mx-auto max-w-[480px] shadow-xl">
      <ConfirmBar text={ask.text} ok={ask.ok} danger={ask.danger} onCancel={() => setAsk(null)} onOk={() => { const r = ask.run; setAsk(null); r(); }} />
    </div>
  );
  const fn: Ask = (text, ok, run, danger) => setAsk({ text, ok, run, danger });
  return [node, fn] as const;
}

/** Close a sheet on Escape (the app's Back gesture sends Escape to the top `.sheet-in`). */
export function useEscape(onClose: () => void, on = true) {
  useEffect(() => {
    if (!on) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [on, onClose]);
}
