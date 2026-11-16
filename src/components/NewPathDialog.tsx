import { Check, Route } from "lucide-react";
import { useMemo, useState } from "react";
import { createNote } from "../lib/actions";
import { newPathBody, resolveCourses } from "../lib/path";
import { openNote, useUI, useVault } from "../lib/store";
import { Button, cx, Field, inputCls, Sheet } from "./ui";

/** New learning path: pick 2+ course roadmaps; overlapping topics merge into concepts, stages come from prerequisites. */
export function NewPathDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const v = useVault();
  const ui = useUI();
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const options = useMemo(() => {
    const spaces = v.spaces.filter((s) => s.roadmapId && !s.archived).map((s) => ({ name: s.name, icon: s.icon, sub: s.kind === "course" ? s.props.provider || "Course" : s.kind }));
    const loose = v.notes.filter((n) => n.type === "roadmap" && !v.spaces.some((s) => s.roadmapId === n.id)).map((n) => ({ name: n.title, icon: "🗺️", sub: "Roadmap note" }));
    return [...spaces, ...loose];
  }, [v.spaces, v.notes]);
  const toggle = (n: string) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
  async function create() {
    const name = title.trim() || "Learning path";
    const courses = resolveCourses(picked, v.notes, v.spaces);
    const n = await createNote({ type: "path", title: name, body: newPathBody(name, picked, courses), spaceId: ui.spaceId === "all" ? "inbox" : ui.spaceId });
    onClose();
    setTitle(""); setPicked([]);
    openNote(n.id);
  }
  return (
    <Sheet open={open} onClose={onClose} title={<span className="flex items-center gap-2"><Route size={16} /> New learning path</span>}>
      <div className="space-y-4">
        <p className="text-[13px] text-muted">One roadmap of <b className="text-ink">concepts</b> on top of several courses. Each course keeps its own roadmap and progress; topics that appear in more than one course become one concept, with all their resources and a revision schedule.</p>
        <Field label="Name"><input autoFocus className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Deep learning, end to end" /></Field>
        <Field label={`Courses · ${picked.length} picked`}>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-[10px] border border-line p-1">
            {options.map((o) => {
              const on = picked.includes(o.name);
              return (
                <button key={o.name} onClick={() => toggle(o.name)} className={cx("flex w-full items-center gap-2.5 rounded-[8px] px-2 py-2 text-left text-[13px]", on ? "bg-accent/10" : "hover:bg-surface-2")}>
                  <span className={cx("flex size-4 items-center justify-center rounded-[4px] border", on ? "border-accent bg-accent text-accent-fg" : "border-line")}>{on && <Check size={11} />}</span>
                  <span>{o.icon}</span><span className="flex-1">{o.name}</span><span className="text-[11.5px] text-muted">{o.sub}</span>
                </button>
              );
            })}
            {!options.length && <div className="p-3 text-[12.5px] text-muted">No course roadmaps yet. Create Course spaces first (each gets a roadmap), then combine them here.</div>}
          </div>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={create} disabled={!picked.length}>Create path</Button>
        </div>
      </div>
    </Sheet>
  );
}
