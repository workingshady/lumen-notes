import { Archive, ArchiveRestore, ExternalLink, Loader2, Pencil, Plus, Sparkles, Target, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { SPACE_KINDS } from "../../shared/types";
import { createNote, updateNote } from "../lib/actions";
import { aiRun, getToken } from "../lib/api";
import { DEFAULT_SPACE, patch, save } from "../lib/db";
import { PRESETS } from "../lib/canvas";
import { progress, roadmap, tasks } from "../lib/parse";
import { go, openNote, setUI, toast, useUI, useVault } from "../lib/store";
import { NoteRow } from "../components/NoteList";
import { KIND_LABEL } from "../components/Sidebar";
import { Button, cx, Empty, Field, inputCls, Sheet } from "../components/ui";
import { Ring, RoadmapView } from "./RoadmapView";

export function SpaceView() {
  const ui = useUI();
  const v = useVault();
  const sp = v.spaceMap.get(ui.spaceId);
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const notes = useMemo(() => v.notes.filter((n) => n.spaceId === ui.spaceId), [v.notes, ui.spaceId]);
  if (!sp) return <Empty icon={<Target size={30} />} title="Pick a space" hint="Use the space switcher at the top of the sidebar." />;
  const rm = sp.roadmapId ? v.byId.get(sp.roadmapId) : undefined;
  const p = rm ? progress(roadmap(rm.body)) : null;
  const openTasks = notes.filter((n) => n.type !== "roadmap").flatMap((n) => tasks(n.body).filter((t) => !t.done).map((t) => ({ ...t, note: n })));
  const deadline = sp.props.deadline || sp.props.target;
  const daysLeft = deadline ? Math.ceil((Date.parse(deadline) - Date.now()) / 86_400_000) : null;
  const color = sp.color ? PRESETS[sp.color] ?? sp.color : "var(--accent)";

  async function addRoadmap() {
    const n = await createNote({ template: "roadmap", title: `${sp!.name} ${sp!.kind === "project" ? "milestones" : "roadmap"}`, spaceId: sp!.id });
    await patch("space", sp!.id, { roadmapId: n.id });
  }
  async function aiRoadmap() {
    if (!getToken()) return toast("AI needs sync unlocked (Settings → Sync)");
    const topic = prompt("Describe the course or skill (paste the syllabus if you have it):", sp!.name);
    if (!topic) return;
    setBusy(true);
    try {
      const md = await aiRun("roadmap", topic);
      if (rm) await updateNote(rm.id, { body: md });
      else { const n = await createNote({ type: "roadmap", title: `${sp!.name} roadmap`, body: md, spaceId: sp!.id }); await patch("space", sp!.id, { roadmapId: n.id }); }
      toast("Roadmap generated. Review and edit it.");
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="safe-t" style={{ background: `linear-gradient(180deg, color-mix(in oklab, ${color} 14%, transparent), transparent)` }}>
        <div className="mx-auto max-w-5xl px-4 pb-4 pt-6 md:px-8">
          <div className="flex items-start gap-4">
            <div className="flex size-14 items-center justify-center rounded-[14px] bg-surface text-3xl shadow-sm">{sp.icon}</div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{KIND_LABEL[sp.kind]}{sp.archived ? " · archived" : ""}</div>
              <h1 className="truncate text-[26px] font-bold tracking-tight">{sp.name}</h1>
              {sp.description && <p className="text-[14px] text-muted">{sp.description}</p>}
              <div className="mt-2 flex flex-wrap gap-3 text-[12.5px] text-muted">
                {sp.props.goal && <span>🎯 {sp.props.goal}</span>}
                {deadline && <span className={cx(daysLeft !== null && daysLeft < 0 && "text-bad")}>📅 {deadline}{daysLeft !== null ? ` · ${daysLeft >= 0 ? `${daysLeft} days left` : `${-daysLeft} days over`}` : ""}</span>}
                {sp.props.url && <a className="flex items-center gap-1 text-link" href={sp.props.url} target="_blank" rel="noreferrer">Course page <ExternalLink size={12} /></a>}
                <span>{notes.length} notes</span>
              </div>
            </div>
            {p && <Ring pct={p.pct} size={60} />}
            <Button size="sm" variant="ghost" onClick={() => setEdit(true)}><Pencil size={14} /></Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-4 px-4 pb-10 md:px-8">
        {(sp.kind === "course" || sp.kind === "project" || rm) && (
          <section className="overflow-hidden rounded-[14px] border border-line bg-surface">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <div className="font-semibold">{sp.kind === "project" ? "Milestones" : "Roadmap"}</div>
              <div className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" onClick={aiRoadmap} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {rm ? "Regenerate" : "Generate"} with AI</Button>
                {rm && <Button size="sm" variant="ghost" onClick={() => openNote(rm.id)}><Pencil size={14} /> Edit</Button>}
              </div>
            </div>
            {rm ? <div className="h-[min(70vh,640px)]"><RoadmapView note={rm} compact /></div> : (
              <div className="p-6 text-center text-[13px] text-muted">
                No {sp.kind === "project" ? "milestones" : "roadmap"} yet.
                <div className="mt-3"><Button size="sm" variant="primary" onClick={addRoadmap}><Plus size={14} /> Create one</Button></div>
              </div>
            )}
          </section>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-[14px] border border-line bg-surface p-3">
            <div className="mb-2 flex items-center px-1"><div className="font-semibold">Notes</div>
              <button className="ml-auto text-[12px] text-link" onClick={() => go("notes", { folderId: null, tag: null })}>Open list</button></div>
            {notes.length ? [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8).map((n) => <NoteRow key={n.id} n={n} />) : <div className="p-3 text-[13px] text-muted">Empty space.</div>}
            <Button size="sm" className="mt-2 w-full" onClick={async () => openNote((await createNote({ template: sp.kind === "course" ? "lesson" : "blank", spaceId: sp.id })).id, "edit")}><Plus size={14} /> New {sp.kind === "course" ? "lesson" : "note"}</Button>
          </section>
          <section className="rounded-[14px] border border-line bg-surface p-3">
            <div className="mb-2 px-1 font-semibold">Open tasks · {openTasks.length}</div>
            {openTasks.slice(0, 12).map((t) => (
              <button key={t.note.id + t.line} onClick={() => openNote(t.note.id)} className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13.5px] hover:bg-surface-2">
                <span className="text-muted">☐</span><span className="flex-1 truncate">{t.text}</span>{t.due && <span className="text-[11.5px] text-muted">{t.due}</span>}
              </button>
            ))}
            {!openTasks.length && <div className="p-2 text-[13px] text-muted">No open tasks. Write <code>- [ ] task</code> in a note.</div>}
          </section>
        </div>
      </div>
      <EditSpace open={edit} onClose={() => setEdit(false)} />
    </div>
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
      <div className="space-y-3" key={sp.id}>
        <div className="flex gap-2">
          <Field label="Icon"><input className={inputCls + " w-16 text-center"} defaultValue={sp.icon} onBlur={(e) => set({ icon: e.target.value || "📁" })} /></Field>
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
        <Field label="URL"><input className={inputCls} defaultValue={sp.props.url ?? ""} onBlur={(e) => setProp("url", e.target.value)} placeholder="https://" /></Field>
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[12px] text-muted">Color</span>
          <button onClick={() => set({ color: null })} className="size-6 rounded-full border border-line" />
          {Object.entries(PRESETS).map(([k, c]) => <button key={k} onClick={() => set({ color: k })} className={cx("size-6 rounded-full", sp.color === k && "ring-2 ring-accent ring-offset-2 ring-offset-surface")} style={{ background: c }} />)}
        </div>
        {sp.id !== DEFAULT_SPACE && (
          <div className="flex gap-2 border-t border-line pt-3">
            <Button size="sm" onClick={() => { set({ archived: sp.archived ? 0 : 1 }); onClose(); }}>{sp.archived ? <><ArchiveRestore size={14} /> Unarchive</> : <><Archive size={14} /> Archive</>}</Button>
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
