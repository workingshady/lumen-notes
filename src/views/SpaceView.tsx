import { Archive, ArchiveRestore, Check, Columns3, EllipsisVertical, FileText, FileUp, Flag, GraduationCap, LayoutTemplate, List, Loader2, MoreHorizontal, Pencil, Play, Plus, Settings2, Share, Share2, Sparkles, Target, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { SPACE_KINDS, type Note, type Space } from "../../shared/types";
import { createNote, updateNote } from "../lib/actions";
import { aiRun, getToken } from "../lib/api";
import { DEFAULT_SPACE, patch, save } from "../lib/db";
import { PRESETS } from "../lib/canvas";
import { cycleTask, progress, roadmap, setTaskStatus, tasks, type Module, type Task, type TaskStatus } from "../lib/parse";
import { openNote, setUI, toast, useUI, useVault } from "../lib/store";
import { ROADMAP_PRESETS } from "../lib/templates";
import { KIND_LABEL } from "../components/Sidebar";
import { Button, cx, Empty, Field, inputCls, Sheet } from "../components/ui";
import { ShareSheet } from "../components/ShareSheet";
import { currentTopic, openTopicNote, Ring, RoadmapView, type RoadmapViewKind } from "./RoadmapView";
import { DAY, fmtDay, fmtFull, fmtWdDay, recentLabel, todayIso, usePhone } from "./spaces-util";

/** Plain outline (headings + bullets, e.g. a syllabus) → roadmap Markdown. Existing `- [x]` markers are kept. */
export function outlineToRoadmap(text: string) {
  const out: string[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const l = raw.trimEnd();
    if (!l.trim()) continue;
    const h = /^\s*#{1,6}\s+(.+)$/.exec(l);
    if (h) { out.push("", `## ${h[1].trim()}`); continue; }
    if (/^\s*[-*+]\s+\[( |\/|x|X|-)\]\s+/.test(l)) { out.push(l.trim()); continue; }
    const b = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/.exec(l);
    if (b) { out.push(`- [ ] ${b[1].trim()}`); continue; }
    if (/^\S/.test(l) && !out.length) { out.push(`## ${l.trim()}`); continue; }
    out.push(/^\S/.test(l) && l.length < 60 && !/[.!?]$/.test(l) ? `\n## ${l.trim()}` : `- [ ] ${l.trim()}`);
  }
  return out.join("\n").replace(/^\n+/, "") + "\n";
}

export function SpaceView() {
  const ui = useUI();
  const v = useVault();
  const phone = usePhone();
  const sp = v.spaceMap.get(ui.spaceId);
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState(false);
  const [menu, setMenu] = useState(false);
  const [tplMenu, setTplMenu] = useState(false);
  const [view, setView] = useState<RoadmapViewKind>("outline");
  const fileIn = useRef<HTMLInputElement>(null);
  const notes = useMemo(() => v.notes.filter((n) => n.spaceId === ui.spaceId), [v.notes, ui.spaceId]);
  if (!sp) return <Empty icon={<Target size={30} />} title="Pick a space" hint="Use the space switcher at the top of the sidebar." />;
  const rm = sp.roadmapId ? v.byId.get(sp.roadmapId) : undefined;
  const mods = rm ? roadmap(rm.body) : [];
  const p = rm ? progress(mods) : null;
  const cur = rm ? currentTopic(mods) : undefined;
  const allTasks: T[] = notes.filter((n) => n.type !== "roadmap").flatMap((n) => tasks(n.body, { doing: true }).map((t) => ({ ...t, note: n })));
  const openTasks = allTasks.filter((t) => !t.done);
  const deadline = sp.props.deadline || sp.props.target;
  const daysLeft = deadline ? Math.ceil((Date.parse(deadline + "T00:00:00") - Date.parse(todayIso() + "T00:00:00")) / DAY) : null;
  const color = sp.color ? PRESETS[sp.color] ?? sp.color : "var(--accent)";
  const isCourse = sp.kind === "course";
  const isProject = sp.kind === "project";
  const learning = mods.flatMap((m) => m.topics).filter((t) => t.status === "learning").length;
  const noteCount = notes.filter((n) => n.id !== rm?.id).length;

  async function setRoadmap(md: string, label: string) {
    if (rm) {
      if (rm.body.trim() && !confirm(`Replace the current ${isProject ? "milestones" : "roadmap"} with ${label}? The old version stays in History.`)) return;
      await updateNote(rm.id, { body: md });
    } else {
      const n = await createNote({ type: "roadmap", title: `${sp!.name} ${isProject ? "milestones" : "roadmap"}`, body: md, spaceId: sp!.id });
      await patch("space", sp!.id, { roadmapId: n.id });
    }
    toast(`${isProject ? "Milestones" : "Roadmap"} updated from ${label}`);
  }
  async function addRoadmap() {
    const n = await createNote({ template: "roadmap", title: `${sp!.name} ${isProject ? "milestones" : "roadmap"}`, spaceId: sp!.id });
    await patch("space", sp!.id, { roadmapId: n.id });
  }
  async function aiRoadmap() {
    if (!getToken()) return toast("AI needs sync unlocked (Settings → Sync)");
    const topic = prompt("Describe the course or skill (paste the syllabus if you have it):", sp!.name);
    if (!topic) return;
    setBusy(true);
    try { await setRoadmap(await aiRun("roadmap", topic), "AI"); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }
  async function importOutline(f?: File) {
    let text = f ? await f.text() : prompt("Paste an outline (headings become modules, bullets become topics):") ?? "";
    if (!text.trim()) return;
    if (f && /\.opml$/i.test(f.name)) text = [...text.matchAll(/<outline[^>]*text="([^"]*)"/g)].map((m) => `- ${m[1]}`).join("\n");
    await setRoadmap(outlineToRoadmap(text), f ? f.name : "the pasted outline");
  }
  const newNote = async () => openNote((await createNote({ template: isCourse ? "lesson" : "blank", spaceId: sp.id })).id, "edit");

  const meta: ReactNode[] = [];
  if (sp.props.goal) meta.push(<span key="g" className="flex min-w-0 items-center gap-1.5"><Target size={14} className="shrink-0" /><span className="truncate">Goal: {sp.props.goal}</span></span>);
  if (isCourse && (sp.props.provider || sp.props.url)) meta.push(
    sp.props.url
      ? <a key="u" className="flex items-center gap-1.5 hover:text-ink" href={sp.props.url} target="_blank" rel="noreferrer"><GraduationCap size={14} />{sp.props.provider || "Course page"}</a>
      : <span key="u" className="flex items-center gap-1.5"><GraduationCap size={14} />{sp.props.provider}</span>,
  );
  if (deadline && !isProject) meta.push(<span key="d" className={cx("flex items-center gap-1.5", daysLeft !== null && daysLeft < 0 && "text-bad")}><Flag size={14} />Target {fmtDay(deadline)}{daysLeft !== null ? ` · ${daysLeft >= 0 ? `${daysLeft} days left` : `${-daysLeft} days over`}` : ""}</span>);
  if (!isProject) meta.push(<span key="n" className="flex items-center gap-1.5"><FileText size={14} />{noteCount} notes</span>);

  const what = isProject ? "milestones" : "roadmap";
  const menuItems: MenuItem[] = [
    ...(rm ? [{ icon: <Pencil size={14} />, label: "Edit as Markdown", run: () => openNote(rm.id, "edit") }] : []),
    ...(isCourse || isProject || rm ? [
      { icon: <FileUp size={14} />, label: "Import outline", run: () => fileIn.current?.click(), alt: { label: "Paste", run: () => void importOutline() } },
      { icon: <LayoutTemplate size={14} />, label: "Apply template", run: () => setTplMenu(true), keep: true },
      { icon: busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />, label: `${rm ? "Regenerate" : "Generate"} ${what} with AI`, run: () => void aiRoadmap() },
    ] : []),
    { icon: <Share2 size={14} />, label: sp.shareId ? "Shared · manage link" : "Share space", run: () => setShare(true) },
    { icon: <Settings2 size={14} />, label: "Space settings", run: () => setEdit(true) },
    ...(sp.id !== DEFAULT_SPACE ? [{ icon: sp.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />, label: sp.archived ? "Unarchive space" : "Archive space", run: () => void patch("space", sp.id, { archived: sp.archived ? 0 : 1 }) }] : []),
  ];
  const tplItems: MenuItem[] = ROADMAP_PRESETS.map((t) => ({ icon: <LayoutTemplate size={14} />, label: t.name, run: () => void setRoadmap(t.body, `“${t.name}”`) }));
  const menuEl = (menu || tplMenu) && <Menu items={tplMenu ? tplItems : menuItems} title={tplMenu ? "Apply template" : undefined} onClose={() => { setMenu(false); setTplMenu(false); }} onKeep={() => setMenu(false)} />;
  const hidden = (
    <>
      <input ref={fileIn} type="file" hidden accept=".md,.markdown,.txt,.opml" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importOutline(f); }} />
      <EditSpace open={edit} onClose={() => setEdit(false)} />
      <ShareSheet target={{ kind: "space", space: sp }} open={share} onClose={() => setShare(false)} />
    </>
  );
  const iconBox = (size: number, r: number, fs: number, onClick?: () => void) => (
    <div onClick={onClick} className={cx("flex shrink-0 items-center justify-center", onClick && "cursor-pointer")}
      style={{ width: size, height: size, borderRadius: r, fontSize: fs, background: `color-mix(in srgb, ${color} 18%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 50%, transparent)` }}>{sp.icon}</div>
  );

  // ---------------------------------------------------------------- phone course page (design 1E / 1E′)
  if (phone && isCourse && rm) {
    const tree = view === "tree";
    const sub = tree ? (deadline && daysLeft !== null ? (daysLeft >= 0 ? `${daysLeft} days to ${fmtDay(deadline)}` : `${-daysLeft} days over ${fmtDay(deadline)}`) : `${p?.done ?? 0} of ${p?.total ?? 0} topics`)
      : ["Course", deadline ? `Target ${fmtDay(deadline)}` : null, daysLeft !== null ? `${Math.abs(daysLeft)} days${daysLeft < 0 ? " over" : ""}` : null].filter(Boolean).join(" · ");
    return (
      <div className="relative flex h-full flex-col">
        <div className="safe-t shrink-0"><div className={cx("relative flex items-center gap-3 px-4", tree ? "py-2.5" : "py-3")}>
          {iconBox(tree ? 40 : 48, tree ? 10 : 12, tree ? 20 : 24)}
          <div className={cx("flex min-w-0 flex-1 flex-col", tree ? "gap-0.5" : "gap-[3px]")}>
            <span className={cx("truncate font-[650]", tree ? "text-[17px]" : "text-[19px]")} dir="auto">{sp.name}</span>
            <span className="truncate text-[12px] text-muted">{sub}</span>
          </div>
          {p && <Ring pct={p.pct} size={tree ? 44 : 48} />}
          {/* Share (info colour once shared, as on the phone share screens) + overflow menu */}
          <div className="-mr-2 flex">
            <button aria-label={sp.shareId ? "Shared · manage link" : "Share space"} title={sp.shareId ? "Shared · manage link" : "Share space"} onClick={() => setShare(true)}
              className="flex h-12 w-11 items-center justify-center" style={{ color: sp.shareId ? "var(--info)" : "var(--text)" }}><Share size={19} /></button>
            <button aria-label="More" onClick={() => setMenu((x) => !x)} className="flex h-12 w-11 items-center justify-center"><EllipsisVertical size={20} /></button>
          </div>
          {menuEl && <div className="absolute right-4 top-full z-30">{menuEl}</div>}
        </div></div>
        <div className="min-h-0 flex-1"><RoadmapView note={rm} compact target={deadline || null} view={view} onView={setView} /></div>
        {cur && !tree && (
          <div className="shrink-0 px-4 py-3">
            <button onClick={() => void openTopicNote(rm, cur, v.byTitle)} className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[12px] bg-accent text-[15px] font-semibold text-accent-fg"><Play size={14} />Continue: {cur.name}</button>
          </div>
        )}
        {hidden}
      </div>
    );
  }

  return (
    <div className={cx("relative h-full", isCourse && rm ? "flex flex-col overflow-hidden" : "overflow-y-auto")}>
      <div className="safe-t shrink-0"><div className="px-4 pt-5 md:px-12 md:pt-7">
        <div className="flex flex-wrap items-center gap-x-[18px] gap-y-3 md:flex-nowrap">
          {iconBox(56, 14, 28)}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <h1 className="truncate text-[19px] font-[650] tracking-[-.02em] md:text-[24px]" dir="auto" title={sp.description || undefined}>{sp.name}</h1>
              <span className="shrink-0 rounded-[6px] border border-line px-[7px] text-[12px] leading-5 text-muted">{KIND_LABEL[sp.kind]}{sp.archived ? " · archived" : ""}</span>
            </div>
            <div className="flex min-w-0 gap-x-4 gap-y-1 overflow-hidden whitespace-nowrap text-[13px] text-muted max-md:flex-wrap">{meta}</div>
          </div>
          {p && !isProject && (
            <div className="mr-3 flex shrink-0 items-center gap-3">
              <Ring pct={p.pct} size={52} />
              <div className="hidden flex-col gap-0.5 text-[12px] text-muted sm:flex"><span><b className="font-semibold text-ink">{p.done}</b> of {p.total} topics</span><span>{learning} learning</span></div>
            </div>
          )}
          <div className="flex w-full items-center gap-[18px] md:w-auto">
            {isCourse && cur && rm ? (
              <button className="flex h-9 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-accent px-3.5 font-semibold text-accent-fg hover:brightness-110 md:flex-none" onClick={() => void openTopicNote(rm, cur, v.byTitle)}><Play size={13} />Continue: {cur.name}</button>
            ) : (
              <button className="flex h-9 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-accent px-3.5 font-semibold text-accent-fg hover:brightness-110 md:flex-none" onClick={newNote}><Plus size={14} />New {isCourse ? "lesson" : "note"}</button>
            )}
            <div className="relative">
              <button aria-label="More" title="More" onClick={() => setMenu((x) => !x)} className="flex size-9 items-center justify-center rounded-[10px] border border-line text-muted hover:bg-surface-2 hover:text-ink"><MoreHorizontal size={16} /></button>
              {menuEl && <div className="absolute right-0 top-11 z-30">{menuEl}</div>}
            </div>
          </div>
        </div>
      </div></div>

      {isCourse && rm ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <RoadmapView note={rm} compact target={deadline || null} view={view} onView={setView} />
        </div>
      ) : isProject ? (
        <ProjectBody sp={sp} rm={rm} mods={mods} notes={notes} allTasks={allTasks} daysLeft={daysLeft} deadline={deadline} onCreate={addRoadmap} onEdit={() => setEdit(true)} />
      ) : (
        <div className="space-y-4 px-4 py-6 md:px-12">
          {(isCourse || rm) && (
            <section className="overflow-hidden rounded-[14px] border border-line bg-surface">
              {rm ? <div className="relative h-[min(70vh,640px)]"><RoadmapView note={rm} target={deadline || null} /></div> : (
                <div className="p-8 text-center text-[13px] text-muted">
                  No roadmap yet. Plain Markdown underneath; three views of the same file.
                  <div className="mt-3 flex justify-center gap-2">
                    <Button size="sm" variant="primary" onClick={addRoadmap}><Plus size={14} /> Create one</Button>
                    <Button size="sm" onClick={aiRoadmap} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate with AI</Button>
                  </div>
                </div>
              )}
            </section>
          )}
          <div className="grid gap-5 md:grid-cols-[1fr_340px]">
            <TaskList tasks={openTasks} />
            <RecentNotes notes={notes} />
          </div>
        </div>
      )}
      {hidden}
    </div>
  );
}

type MenuItem = { icon: ReactNode; label: string; run: () => void; danger?: boolean; keep?: boolean; alt?: { label: string; run: () => void } };
function Menu({ items, title, onClose, onKeep }: { items: MenuItem[]; title?: string; onClose: () => void; onKeep: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const id = setTimeout(() => addEventListener("mousedown", down));
    addEventListener("keydown", key);
    return () => { clearTimeout(id); removeEventListener("mousedown", down); removeEventListener("keydown", key); };
  }, [onClose]);
  return (
    <div ref={ref} className="fade-in flex w-64 flex-col gap-0.5 rounded-[14px] border border-line bg-surface-2 p-1.5 shadow-2xl">
      {title && <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{title}</div>}
      {items.map((it) => (
        <div key={it.label} className="flex items-center">
          <button onClick={() => { it.run(); if (it.keep) onKeep(); else onClose(); }} className={cx("flex h-[34px] min-w-0 flex-1 items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] hover:bg-bg", it.danger ? "text-bad" : "text-ink")}>
            <span className="text-muted">{it.icon}</span><span className="truncate">{it.label}</span>
          </button>
          {it.alt && <button onClick={() => { it.alt!.run(); onClose(); }} className="h-[34px] rounded-[8px] px-2 text-[12px] text-muted hover:bg-bg hover:text-ink">{it.alt.label}</button>}
        </div>
      ))}
    </div>
  );
}

type T = Task & { note: Note };
const COLS: { s: TaskStatus; n: string; c: string }[] = [{ s: "todo", n: "Todo", c: "var(--muted)" }, { s: "doing", n: "Doing", c: "var(--info)" }, { s: "done", n: "Done", c: "var(--success)" }];

function ProjectBody({ sp, rm, mods, notes, allTasks, daysLeft, deadline, onCreate, onEdit }: {
  sp: Space; rm?: Note; mods: Module[]; notes: Note[]; allTasks: T[]; daysLeft: number | null; deadline?: string; onCreate: () => void; onEdit: () => void;
}) {
  const [list, setList] = useState(false);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [allDone, setAllDone] = useState(false);
  const done = allTasks.filter((t) => t.done).length;
  const taskPct = allTasks.length ? Math.round((done / allTasks.length) * 100) : 0;
  const end = deadline ? Date.parse(deadline + "T00:00:00") : NaN;
  const start = sp.props.start ? Date.parse(sp.props.start + "T00:00:00") : sp.createdAt;
  const timePct = !isNaN(end) && end > start ? Math.min(100, Math.max(0, Math.round(((Date.now() - start) / (end - start)) * 100))) : null;
  // Milestones = roadmap modules (or topics when there's only one module).
  const steps = (mods.length > 1 ? mods.map((m) => ({ name: m.name, due: m.due, done: m.topics.length > 0 && m.topics.every((t) => t.status === "done" || t.status === "skipped") }))
    : (mods[0]?.topics ?? []).map((t) => ({ name: t.name, due: t.due, done: t.status === "done" || t.status === "skipped" })));
  const curIdx = steps.findIndex((s) => !s.done);
  const sourceCount = new Set(allTasks.map((t) => t.note.id)).size;
  const today = todayIso();
  const move = (t: T, s: TaskStatus) => { if (t.status !== s) void updateNote(t.note.id, { body: setTaskStatus(t.note.body, t.line, s) }); };
  const drop = (s: TaskStatus) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const key = e.dataTransfer.getData("text/x-lumen-task");
    const t = allTasks.find((x) => `${x.note.id}:${x.line}` === key);
    if (t) move(t, s);
  };
  const dueText = (t: T) => (t.done || !t.due ? "" : t.due < today ? "Overdue" : fmtWdDay(t.due));

  return (
    <div className="flex flex-col gap-[22px] px-4 py-6 md:px-12 md:pt-[22px]">
      <div className="grid gap-5 md:grid-cols-[260px_1fr]">
        <button onClick={onEdit} title="Change deadline" className="flex flex-col gap-1.5 rounded-[14px] border border-line bg-surface px-5 py-[18px] text-left text-[13px] hover:border-muted">
          <span className="text-muted">Deadline</span>
          {deadline && daysLeft !== null ? (
            <>
              <span className={cx("text-[44px] font-[650] leading-[52px] tracking-[-.03em]", daysLeft < 0 && "text-bad")}>{Math.abs(daysLeft)} <span className="text-[18px] font-medium tracking-normal text-muted">{daysLeft < 0 ? "days over" : "days"}</span></span>
              <span className="text-muted">{fmtFull(deadline)} · {Math.max(0, Math.round(daysLeft / 7))} weeks</span>
            </>
          ) : <span className="py-3 text-[15px] text-muted">No deadline set</span>}
          <span className="mt-1.5 h-1.5 overflow-hidden rounded-[3px] bg-surface-2"><span className="block h-full bg-ink opacity-70" style={{ width: `${timePct ?? 0}%` }} /></span>
          <span className="text-[12px] text-muted">{timePct !== null ? `${timePct}% of time used · ` : ""}{taskPct}% of tasks done</span>
        </button>
        <div className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface px-6 py-[18px] text-[13px]">
          <span className="text-[14px] font-semibold">Milestones</span>
          {steps.length ? (
            <div className="flex items-start overflow-x-auto">
              {steps.map((s, i) => {
                const isCur = i === curIdx;
                return (
                  <div key={i} className="flex min-w-[96px] flex-1 flex-col gap-2">
                    <div className="flex items-center">
                      <span className="box-border flex size-[22px] shrink-0 items-center justify-center rounded-full"
                        style={{ background: s.done ? "var(--success)" : "transparent", border: s.done ? "none" : isCur ? "2px solid var(--accent)" : "1.5px solid var(--muted)", boxShadow: isCur ? "0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent)" : "none" }}>
                        {s.done && <Check size={12} strokeWidth={3} style={{ color: "var(--bg)" }} />}
                      </span>
                      <span className="mx-1.5 h-0.5 flex-1" style={{ background: i === steps.length - 1 ? "transparent" : s.done ? "var(--success)" : "var(--border)" }} />
                    </div>
                    <span className={cx("pr-2", isCur ? "font-semibold" : "font-[450]")} dir="auto">{s.name}</span>
                    <span className={cx("text-[12px]", isCur ? "text-accent" : "text-muted")}>{s.due ? fmtDay(s.due) : ""}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-3 text-muted">No milestones yet.<Button size="sm" variant="primary" onClick={onCreate}><Plus size={14} />Create milestones</Button>{rm && <button onClick={() => openNote(rm.id, "edit")} className="text-link">Edit</button>}</div>
          )}
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-3 text-[13px]">
          <div className="flex items-center gap-2.5"><span className="text-[14px] font-semibold">Tasks</span><span className="text-[12px] text-muted">from {sourceCount} note{sourceCount === 1 ? "" : "s"} in this space</span>
            <span className="flex-1" />
            <button onClick={() => setList((x) => !x)} className="flex items-center gap-1.5 text-[12px] text-muted hover:text-ink">{list ? <Columns3 size={13} /> : <List size={13} />}{list ? "Board" : "List"}</button>
          </div>
          {!allTasks.length ? <div className="rounded-[14px] bg-surface p-4 text-muted">No tasks yet. Write <code>- [ ] task</code> in any note in this space (<code>- [/]</code> = doing).</div>
            : list ? (
              <div className="flex flex-col rounded-[14px] bg-surface p-1.5">
                {allTasks.map((t) => (
                  <div key={t.note.id + t.line} className="flex items-center gap-2.5 rounded-[8px] px-2.5 py-2 hover:bg-surface-2">
                    <button title={`${t.status} · click to advance`} onClick={() => void updateNote(t.note.id, { body: cycleTask(t.note.body, t) })} className="flex size-4 shrink-0 items-center justify-center rounded-[5px]"
                      style={t.status === "done" ? { background: "var(--success)" } : { border: `1.5px solid ${t.status === "doing" ? "var(--info)" : "var(--muted)"}`, background: t.status === "doing" ? "linear-gradient(90deg, var(--info) 50%, transparent 50%)" : undefined }}>
                      {t.status === "done" && <Check size={11} strokeWidth={3} style={{ color: "var(--bg)" }} />}
                    </button>
                    <button onClick={() => openNote(t.note.id)} className={cx("min-w-0 flex-1 truncate text-left font-medium", t.done && "text-muted line-through")} dir="auto">{t.text}</button>
                    <span className="max-w-[35%] truncate text-[11.5px] text-muted">{t.note.title}</span>
                    <span className={cx("w-16 shrink-0 text-right text-[11.5px]", dueText(t) === "Overdue" ? "text-bad" : "text-muted")}>{dueText(t)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {COLS.map((col) => {
                  const items = allTasks.filter((t) => t.status === col.s);
                  // Done keeps only the latest two cards unless expanded (design: "Done 14" with two cards).
                  const shown = col.s === "done" && !allDone ? items.slice(-2).reverse() : items.slice(0, 20);
                  return (
                    <div key={col.s} onDragOver={(e) => { e.preventDefault(); setOver(col.s); }} onDragLeave={() => setOver(null)} onDrop={drop(col.s)}
                      className="flex flex-col gap-2 rounded-[14px] bg-surface p-2.5" style={over === col.s ? { boxShadow: "inset 0 0 0 1.5px var(--accent)" } : undefined}>
                      <button disabled={col.s !== "done"} onClick={() => setAllDone((x) => !x)} title={col.s === "done" ? (allDone ? "Show the latest two" : `Show all ${items.length}`) : undefined} className="flex items-center gap-2 px-1 pb-1 pt-0.5 text-left font-medium text-muted enabled:hover:text-ink"><span className="size-2 rounded-full" style={{ background: col.c }} />{col.n}<span className="text-[12px]">{items.length}</span></button>
                      {shown.map((t) => {
                        const due = dueText(t);
                        return (
                          <button key={t.note.id + t.line} draggable onDragStart={(e) => { e.dataTransfer.setData("text/x-lumen-task", `${t.note.id}:${t.line}`); e.dataTransfer.effectAllowed = "move"; }}
                            onClick={() => openNote(t.note.id)} onContextMenu={(e) => { e.preventDefault(); void updateNote(t.note.id, { body: cycleTask(t.note.body, t) }); }}
                            title="Drag to another column to change its status · right-click: next status"
                            className="flex cursor-grab flex-col gap-1.5 rounded-[10px] bg-surface-2 px-3 py-2.5 text-left hover:brightness-110 active:cursor-grabbing">
                            <span className={cx("font-medium leading-[18px]", t.done && "text-muted line-through")} dir="auto">{t.text}</span>
                            <span className="flex items-center gap-1.5 text-[11.5px] text-muted"><FileText size={12} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{t.note.title}</span>{due && <span className={due === "Overdue" ? "text-bad" : ""}>{due}</span>}</span>
                          </button>
                        );
                      })}
                      {col.s !== "done" && items.length > 20 && <span className="px-1 text-[12px] text-muted">+{items.length - 20} more</span>}
                    </div>
                  );
                })}
              </div>
            )}
        </div>
        <RecentNotes notes={notes.filter((n) => n.id !== rm?.id)} />
      </div>
    </div>
  );
}

function TaskList({ tasks: list }: { tasks: T[] }) {
  const today = todayIso();
  return (
    <section className="flex flex-col self-start rounded-[14px] border border-line bg-surface px-2 py-3.5 text-[13px]">
      <span className="px-3 pb-2 text-[14px] font-semibold">Open tasks <span className="font-normal text-muted">· {list.length}</span></span>
      {list.slice(0, 12).map((t) => (
        <button key={t.note.id + t.line} onClick={() => openNote(t.note.id)} className="flex items-center gap-2.5 rounded-[8px] px-3 py-2 text-left hover:bg-surface-2">
          <span className="size-3.5 shrink-0 rounded-[4px] border-[1.5px]" style={{ borderColor: t.status === "doing" ? "var(--info)" : "var(--muted)" }} />
          <span className="min-w-0 flex-1 truncate" dir="auto">{t.text}</span>
          <span className="max-w-[40%] truncate text-[11.5px] text-muted">{t.note.title}</span>
          {t.due && <span className={cx("text-[11.5px]", t.due < today ? "text-bad" : "text-muted")}>{fmtDay(t.due)}</span>}
        </button>
      ))}
      {!list.length && <div className="px-3 py-1 text-muted">No open tasks. Write <code>- [ ] task</code> in a note.</div>}
    </section>
  );
}

function RecentNotes({ notes }: { notes: Note[] }) {
  return (
    <section className="flex flex-col self-start rounded-[14px] border border-line bg-surface px-2 py-3.5 text-[13px]">
      <span className="px-3 pb-2 text-[14px] font-semibold">Recent notes</span>
      {[...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6).map((n) => (
        <button key={n.id} onClick={() => openNote(n.id)} className="flex flex-col gap-0.5 rounded-[8px] px-3 py-2 text-left hover:bg-surface-2">
          <span className="truncate font-medium" dir="auto">{n.title || "Untitled"}</span><span className="text-[12px] text-muted">{recentLabel(n.updatedAt)}</span>
        </button>
      ))}
      {!notes.length && <div className="px-3 py-1 text-muted">Empty space.</div>}
    </section>
  );
}

function EditSpace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ui = useUI();
  const v = useVault();
  const sp = v.spaceMap.get(ui.spaceId);
  if (!sp) return null;
  const set = (p: Record<string, unknown>) => void patch("space", sp.id, p);
  const setProp = (k: string, val: string) => set({ props: { ...sp.props, [k]: val } });
  return (
    <Sheet open={open} onClose={onClose} title="Space settings">
      <div className="space-y-4 text-[13px]" key={sp.id}>
        <div className="flex gap-2">
          <Field label="Icon"><input className={inputCls + " w-14 text-center text-[18px]"} defaultValue={sp.icon} onBlur={(e) => set({ icon: e.target.value || "📁" })} /></Field>
          <div className="flex-1"><Field label="Name"><input className={inputCls} defaultValue={sp.name} onBlur={(e) => e.target.value.trim() && set({ name: e.target.value.trim() })} /></Field></div>
        </div>
        <Field label="Description"><input className={inputCls} defaultValue={sp.description} onBlur={(e) => set({ description: e.target.value })} /></Field>
        <Field label="Kind">
          <select className={inputCls} value={sp.kind} onChange={(e) => set({ kind: e.target.value })}>{SPACE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Goal"><input className={inputCls} defaultValue={sp.props.goal ?? ""} onBlur={(e) => setProp("goal", e.target.value)} /></Field>
          <Field label="Deadline / target"><input type="date" className={inputCls} defaultValue={sp.props.deadline ?? sp.props.target ?? ""} onBlur={(e) => setProp(sp.kind === "course" ? "target" : "deadline", e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Provider"><input className={inputCls} defaultValue={sp.props.provider ?? ""} onBlur={(e) => setProp("provider", e.target.value)} placeholder="e.g. Coursera · Stanford" /></Field>
          <Field label="URL"><input className={inputCls} defaultValue={sp.props.url ?? ""} onBlur={(e) => setProp("url", e.target.value)} placeholder="https://" /></Field>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="mr-1 text-[12px] font-medium text-muted">Colour</span>
          <button aria-label="No colour" onClick={() => set({ color: null })} className="size-6 rounded-full border border-dashed border-muted" style={!sp.color ? { boxShadow: "0 0 0 2px var(--surface), 0 0 0 4px var(--text)" } : undefined} />
          {Object.entries(PRESETS).map(([k, c]) => <button key={k} aria-label={`Colour ${k}`} onClick={() => set({ color: k })} className="size-6 rounded-full" style={{ background: c, boxShadow: sp.color === k ? "0 0 0 2px var(--surface), 0 0 0 4px var(--text)" : undefined }} />)}
        </div>
        {sp.id !== DEFAULT_SPACE && (
          <div className="flex gap-2 border-t border-line pt-4">
            <Button size="sm" onClick={() => { set({ archived: sp.archived ? 0 : 1 }); onClose(); }}>{sp.archived ? <><ArchiveRestore size={14} /> Unarchive</> : <><Archive size={14} /> Archive</>}</Button>
            <span className="flex-1" />
            <Button size="sm" variant="danger" onClick={async () => {
              if (!confirm(`Delete space “${sp.name}”? Its notes and folders move to Inbox.`)) return;
              for (const n of v.notes.filter((x) => x.spaceId === sp.id)) await save("note", { ...n, spaceId: DEFAULT_SPACE });
              for (const f of v.folders.filter((x) => x.spaceId === sp.id)) await save("folder", { ...f, spaceId: DEFAULT_SPACE });
              await patch("space", sp.id, { deleted: 1 });
              onClose();
              setUI({ spaceId: DEFAULT_SPACE, view: "notes" });
            }}><Trash2 size={14} /> Delete space</Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
