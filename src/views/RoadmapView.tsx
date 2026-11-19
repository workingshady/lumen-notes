// Course roadmap: Outline · Skill tree · Timeline over one Markdown roadmap note (design round 4: RoadmapDesk,
// "Lumen 15 Roadmaps and Project Hub" R4-15A…I). The pieces live in roadmap-*.tsx; this file wires them up and keeps
// the exports other views use (Ring, TopicDot, currentTopic, openTopicNote, ViewSwitch).
import { ReactFlowProvider } from "@xyflow/react";
import { Ban, Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Note } from "../../shared/types";
import { createNote, updateNote } from "../lib/actions";
import {
  addModule, addTopic, addTopicNeed, deleteTopic, linkTopicNote, progress, removeTopicNeed, renameTopic, roadmap, setTopicDue, setTopicNeeds, setTopicStatus,
  topicLineByName, uniqueTopicName, type Module, type Topic, type TopicStatus,
} from "../lib/parse";
import type { GlyphName } from "../lib/glyphs";
import { openNote, toast, useVault } from "../lib/store";
import { Glyph } from "../components/Glyph";
import { cx } from "../components/ui";
import { announce } from "./dnd-parts";
import { Builder, Outline, PhoneOutline, type TopicOps } from "./roadmap-outline";
import { RM_STYLE, RoadmapTray, useInlineConfirm, useModuleFold } from "./roadmap-parts";
import { PhoneTopicSheet, TopicSheet } from "./roadmap-sheet";
import { Timeline } from "./roadmap-timeline";
import { Tree } from "./roadmap-tree";
import { usePhone } from "./spaces-util";

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

/** Status dot used outside the roadmap (paths, legends): ring (todo), info ring (learning), filled check (done), ban (skipped). */
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

/**
 * Topics that just became unlocked (a prerequisite was marked done): they play the quiet unlock moment (600 ms:
 * the link draws in green, the lock becomes an open circle with a brief blue ring) and a toast "X is now open."
 */
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
    const names = mods.flatMap((m) => m.topics).filter((t) => unlocked.includes(t.name.toLowerCase())).map((t) => t.name);
    toast(names.length === 1 ? `${names[0]} is now open.` : `${names.length} topics are now open.`);
    const id = setTimeout(() => setFresh(new Set()), 900);
    return () => clearTimeout(id);
  }, [mods]);
  return fresh;
}

export type RoadmapViewKind = "outline" | "tree" | "timeline";
const VIEWS: { v: RoadmapViewKind; l: string; g: GlyphName }[] = [{ v: "outline", l: "Outline", g: "roadmap" }, { v: "tree", l: "Skill tree", g: "graph" }, { v: "timeline", l: "Timeline", g: "v-calendar" }];

/** Outline / Skill tree / Timeline: underline tabs on desktop (design 15A), a full-width segmented control on phones (15H). */
export function ViewSwitch({ view, onView, phone }: { view: RoadmapViewKind; onView: (v: RoadmapViewKind) => void; phone?: boolean }) {
  if (phone) return (
    <div role="tablist" className="grid grid-cols-3 rounded-[10px] border border-line bg-surface p-[3px] text-[14px]">
      {VIEWS.map(({ v: k, l }) => <button key={k} role="tab" aria-selected={view === k} onClick={() => onView(k)} className={cx("h-9 rounded-[7px]", view === k ? "bg-surface-2 font-semibold" : "text-muted")}>{l}</button>)}
    </div>
  );
  return (
    <div role="tablist" className="flex items-center gap-3.5">
      {VIEWS.map(({ v: k, l, g }) => (
        <button key={k} role="tab" aria-selected={view === k} onClick={() => onView(k)}
          className={cx("flex items-center gap-1.5 whitespace-nowrap px-0.5 pb-3", view === k ? "font-semibold text-ink shadow-[inset_0_-2px_0_var(--accent)]" : "font-[450] text-muted hover:text-ink")}>
          <Glyph name={g} size={16} />{l}
        </button>
      ))}
    </div>
  );
}

/**
 * The roadmap's three views. `compact` = embedded in a course space page (the page owns the header above the tabs).
 * The view can be controlled (`view`/`onView`) so the page can adapt its header on phones.
 */
export function RoadmapView({ note, compact, target, view: cView, onView, header }: { note: Note; compact?: boolean; target?: string | null; view?: RoadmapViewKind; onView?: (v: RoadmapViewKind) => void; header?: ReactNode }) {
  const [uView, setUView] = useState<RoadmapViewKind>("outline");
  const mods = useMemo(() => roadmap(note.body), [note.body]);
  const empty = !mods.some((m) => m.topics.length);
  const view = cView ?? uView;
  const setView = onView ?? setUView;
  // selection follows the topic by name, so it survives reorders that change line numbers
  const [selKey, setSelKey] = useState<string | null>(null);
  const fresh = useJustUnlocked(mods);
  const phone = usePhone();
  const v = useVault();
  const all = mods.flatMap((m) => m.topics);
  const cur = currentTopic(mods);
  const fold = useModuleFold(note.id, mods, cur?.line);
  const selected = selKey === null ? undefined : all.find((t) => t.name.toLowerCase() === selKey);
  const sel = selected?.line ?? null;
  const select = (t: Topic) => setSelKey(t.name.toLowerCase());
  // the notes tray: opens by itself for an empty roadmap (builder) and stays open after the first drop
  const [trayPref, setTray] = useState<boolean | null>(() => { try { const s = localStorage.getItem("lumen.rm.tray"); return s === null ? null : s === "1"; } catch { return null; } });
  const [startedEmpty] = useState(empty);
  const tray = !phone && view === "outline" && (empty || (trayPref ?? startedEmpty));
  const toggleTray = () => { const n = !tray; setTray(n); try { localStorage.setItem("lumen.rm.tray", n ? "1" : "0"); } catch { /* private mode */ } };
  const [phoneTray, setPhoneTray] = useState(false);
  const [confirmNode, confirm] = useInlineConfirm();

  const write = (body: string) => { if (body !== note.body) void updateNote(note.id, { body }); };
  const addNeed = (topicLine: number, prereqLine: number) => {
    const md = addTopicNeed(note.body, topicLine, prereqLine);
    const t = all.find((x) => x.line === topicLine), d = all.find((x) => x.line === prereqLine);
    if (md === note.body) { if (t && d && t.line !== d.line && !t.needs.some((n) => n.toLowerCase() === d.name.toLowerCase())) toast(`Can't link: ${d.name} already needs ${t.name}, so this would make a loop.`); return; }
    write(md);
    announce(`${t?.name} now needs ${d?.name}`);
  };
  /** New topic (palette drop, link dropped on the canvas, "+ Topic"): optionally needing another one; it opens selected. */
  const createTopic = (module: number | null, needs?: Topic) => {
    const name = uniqueTopicName(mods);
    const mi = module ?? (mods.length ? mods.length - 1 : null);
    if (mi !== null && mods[mi] && !fold.isOpen(mi)) fold.toggle(mi); // a new topic is never born inside a folded module
    let md = addTopic(note.body, mi, name);
    const line = topicLineByName(md, name);
    if (needs && line !== null) md = setTopicNeeds(md, line, [needs.name]);
    write(md);
    setSelKey(name.toLowerCase());
    announce(`Added ${name}${needs ? `, needs ${needs.name}` : ""}`);
  };
  const remove = (t: Topic) => {
    write(deleteTopic(note.body, t.line));
    if (selKey === t.name.toLowerCase()) setSelKey(null);
    announce(`Deleted ${t.name}`);
  };
  const ops: TopicOps = {
    body: note.body, write, mods, spaceId: note.spaceId, remove,
    rename: (t, name) => { const md = renameTopic(note.body, t.line, name); write(md); if (md !== note.body) setSelKey(name.trim().replace(/[()]/g, "").toLowerCase()); },
    setStatus: (t, s) => write(setTopicStatus(note.body, t.line, s)),
    open: (t, mode) => void openTopicNote(note, t, v.byTitle, mode),
    link: (t, n) => { write(linkTopicNote(note.body, t.line, n.title)); announce(`${t.name} linked to ${n.title}`); },
  };
  // Delete / Backspace removes the selected node in the skill tree (inline confirm)
  useEffect(() => {
    if (view !== "tree" || !selected) return;
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if ((e.key === "Delete" || e.key === "Backspace") && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        confirm(<>Delete topic “<b dir="auto">{selected.name}</b>”? Topics that need it stop needing it.</>, "Delete", () => remove(selected));
      }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });
  const used = useMemo(() => new Set(all.flatMap((t) => [t.name.toLowerCase(), ...(t.note ? [t.note.toLowerCase()] : [])])), [all]);
  const pickNote = (n: Note) => {
    if (used.has(n.title.toLowerCase())) return;
    write(mods.length ? addTopic(note.body, mods.length - 1, n.title, { note: n.title }) : addModule(note.body, "Module 1", [{ name: n.title, note: n.title }]));
    announce(`Added ${n.title}`);
  };
  const addAll = (ns: Note[]) => {
    let md = note.body;
    if (!roadmap(md).length) md = addModule(md, "Module 1");
    const last = roadmap(md).length - 1;
    for (const n of ns) md = addTopic(md, last, n.title, { note: n.title });
    write(md);
    announce(`Added ${ns.length} topics`);
  };
  const p = progress(mods);

  return (
    <>
      <style>{RM_STYLE}</style>
      <div className={cx("flex h-full min-h-0 flex-col text-[13px] leading-[normal]", !compact && "relative")}>
        {phone ? (
          <div className="px-4 pb-2.5 pt-1">{empty ? <p className="text-[15px] font-semibold">Create roadmap</p> : <ViewSwitch view={view} onView={setView} phone />}</div>
        ) : (
          <div className={cx("flex flex-col gap-[19px] px-8", (!!header || !compact) && "pt-[22px]")}>
            {header}
            <div className="flex items-center gap-3.5 border-b border-line">
              <ViewSwitch view={view} onView={setView} />
              <span className="flex-1" />
              {!compact && !header && <span className="flex items-center gap-2 pb-3 text-[12px] text-muted"><span className="h-1.5 w-[150px] overflow-hidden rounded-[3px] bg-surface-2"><span className="block h-full bg-ok" style={{ width: `${p.pct}%` }} /></span>{p.done} of {p.total} done</span>}
              {view === "outline" && !empty && (
                <button onClick={() => fold.setAll(!fold.allOpen)} className="flex items-center gap-1.5 pb-3 text-muted hover:text-ink">
                  <Glyph name={fold.allOpen ? "wide" : "expand"} size={16} />{fold.allOpen ? "Collapse all" : "Expand all"}
                </button>
              )}
              {view === "outline" && (
                <button onClick={toggleTray} aria-pressed={tray} title="Drag notes in to make them topics" className={cx("flex items-center gap-1.5 pb-3 hover:text-ink", tray ? "text-ink" : "text-muted")}>
                  <Glyph name="file" size={16} />Notes tray
                </button>
              )}
            </div>
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <div className={cx("min-h-0 min-w-0 flex-1", view === "tree" ? "relative overflow-hidden" : "overflow-auto")}>
            {view === "outline" && (phone
              ? <PhoneOutline mods={mods} sel={sel ?? undefined} onSelect={select} ops={ops} fold={fold} fresh={fresh} onNotes={() => setPhoneTray(true)} />
              : empty ? <Builder mods={mods} ops={ops} />
                : <Outline mods={mods} sel={sel ?? undefined} onSelect={select} ops={ops} fold={fold} fresh={fresh} />)}
            {view === "tree" && <ReactFlowProvider><Tree mods={mods} sel={sel} phone={phone} fold={fold} fresh={fresh} onSelect={select} onConnect={addNeed} onCreate={createTopic} onRemoveNeed={(t, n) => { write(removeTopicNeed(note.body, t.line, n)); announce(`${t.name} no longer needs ${n}`); }} onEditLinks={(f, said) => { write(f(note.body)); announce(said); }} /></ReactFlowProvider>}
            {view === "timeline" && <Timeline mods={mods} target={target} onSelect={select} onDue={(t, due) => write(setTopicDue(note.body, t.line, due))} fresh={fresh} />}
          </div>
          {tray && <RoadmapTray spaceId={note.spaceId} used={used} onPick={pickNote} builder={empty} onAddAll={addAll} />}
        </div>
        {selected && (phone
          ? <PhoneTopicSheet mods={mods} t={selected} onClose={() => setSelKey(null)} onSelect={select} ops={ops} fresh={fresh} />
          : <TopicSheet mods={mods} t={selected} onClose={() => setSelKey(null)} onSelect={select} ops={ops} fresh={fresh} />)}
        {phoneTray && (
          <>
            <div className="fixed inset-0 z-40 bg-[rgba(5,6,8,.55)]" onClick={() => setPhoneTray(false)} />
            <div className="sheet-in safe-b fixed inset-x-0 bottom-0 z-50 flex h-[70dvh] flex-col overflow-hidden rounded-t-[14px] bg-surface [&>aside]:w-full [&>aside]:border-0">
              <RoadmapTray spaceId={note.spaceId} used={used} onPick={pickNote} />
            </div>
          </>
        )}
        {confirmNode}
      </div>
    </>
  );
}
