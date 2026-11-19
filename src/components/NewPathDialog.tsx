// New learning path (design: Lumen 14 · "Paths list · new path"): name, picked courses as chips (+ Add → searchable list),
// "Start with": Organize from course outlines (preview the proposed stages before anything is saved) or empty stages.
import { Check, ChevronLeft, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { createNote } from "../lib/actions";
import { buildPath, newPathBody, parsePath, resolveCourses, serializePath, UNPLACED } from "../lib/path";
import { openNote, useUI, useVault } from "../lib/store";
import { Glyph } from "./Glyph";
import { cx, inputCls, Sheet } from "./ui";

export function NewPathDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const v = useVault();
  const ui = useUI();
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"organize" | "empty">("organize");
  const [preview, setPreview] = useState<string | null>(null);
  const options = useMemo(() => {
    const spaces = v.spaces.filter((s) => s.roadmapId && !s.archived && !s.deleted).map((s) => ({ name: s.name, sub: s.kind === "course" ? s.props.provider || "Course" : s.kind }));
    const loose = v.notes.filter((n) => n.type === "roadmap" && !n.deleted && !v.spaces.some((s) => s.roadmapId === n.id)).map((n) => ({ name: n.title, sub: "Roadmap note" }));
    return [...new Map([...spaces, ...loose].map((o) => [o.name.toLowerCase(), o])).values()];
  }, [v.spaces, v.notes]);
  const refs = useMemo(() => resolveCourses(picked, v.notes, v.spaces), [picked, v.notes, v.spaces]);
  const toggle = (n: string) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
  const name = title.trim() || "Learning path";
  const body = () => mode === "organize" ? newPathBody(name, picked, refs) : serializePath({ courses: picked, title: name, intro: "", stages: [1, 2, 3].map((i) => ({ name: `Stage ${i}`, concepts: [] })), fm: {} });
  function close() { onClose(); setTitle(""); setPicked([]); setPreview(null); setAdding(false); setQ(""); setMode("organize"); }
  async function create(b: string) {
    const n = await createNote({ type: "path", title: name, body: b, spaceId: ui.spaceId === "all" ? "inbox" : ui.spaceId });
    close();
    openNote(n.id);
  }
  const proposed = preview ? buildPath(preview, refs) : null;
  const pv = preview ? parsePath(preview) : null;
  const opt = (on: boolean) => ({ border: on ? "1.5px solid var(--accent)" : "1px solid var(--border)", background: on ? "color-mix(in srgb,var(--accent) 6%,var(--bg))" : "transparent" });
  return (
    <Sheet open={open} onClose={close} title={preview ? <span className="flex items-center gap-1.5"><button aria-label="Back" onClick={() => setPreview(null)} className="text-muted hover:text-ink"><ChevronLeft size={17} /></button>Proposed stages</span> : "New learning path"}>
      {preview && proposed && pv ? (
        <div className="flex flex-col gap-3.5">
          <span className="text-[12.5px] text-muted">{proposed.concepts.length} concepts from {picked.length} courses in {pv.stages.length} stages. Nothing is saved until you create the path; you can still move everything afterwards.</span>
          <div className="flex max-h-[46vh] flex-col gap-2 overflow-y-auto">
            {proposed.stages.filter((s) => s.name !== UNPLACED || s.concepts.length).map((s, i) => (
              <div key={s.name} className="rounded-[10px] border border-line bg-bg px-3 py-2">
                <div className="flex items-center gap-2"><span className="flex size-5 items-center justify-center rounded-[6px] bg-surface-2 text-[11px] font-[650]">{s.name === UNPLACED ? "•" : i + 1}</span><span className="flex-1 font-semibold" dir="auto">{s.name.replace(/^Stage \d+ · /, "")}</span><span className="text-[12px] text-muted">{s.concepts.length}</span></div>
                <div className="mt-1.5 text-[12.5px] leading-[19px] text-muted" dir="auto">{s.concepts.slice(0, 12).map((c) => c.def.name).join(" · ")}{s.concepts.length > 12 ? ` · +${s.concepts.length - 12}` : ""}</div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setPreview(null)} className="flex h-9 items-center rounded-[10px] px-3.5 text-muted hover:text-ink">Back</button>
            <button onClick={() => void create(preview)} className="flex h-9 items-center rounded-[10px] bg-accent px-4 font-semibold text-accent-fg">Create path</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5"><span className="text-[12px] font-medium text-muted">Name</span><input autoFocus className={inputCls + " !h-[38px]"} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. AI Engineer" /></div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-muted">Courses · {picked.length} picked</span>
            <div className="flex flex-wrap gap-1.5">
              {refs.map((c) => (
                <span key={c.key} className="flex h-7 items-center gap-1.5 rounded-[6px] bg-surface-2 px-2 text-[12.5px]">
                  <span className="h-3.5 w-[3px] rounded-[2px]" style={{ background: c.color }} /><span dir="auto">{c.spaceName}</span>
                  <button aria-label={`Remove ${c.spaceName}`} onClick={() => toggle(c.key)} className="text-muted hover:text-ink"><X size={11} /></button>
                </span>
              ))}
              <button onClick={() => setAdding((a) => !a)} aria-expanded={adding} className="flex h-7 items-center rounded-[6px] border border-dashed border-line px-2.5 text-[12.5px] text-muted hover:text-ink">+ Add</button>
            </div>
            {adding && (
              <div className="rounded-[10px] border border-line bg-bg p-1.5">
                <label className="mb-1 flex h-8 items-center gap-1.5 rounded-[7px] border border-line px-2"><Search size={13} className="text-muted" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a course" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" /></label>
                <div className="max-h-52 overflow-y-auto">
                  {options.filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase())).map((o) => {
                    const on = picked.includes(o.name);
                    return (
                      <button key={o.name} onClick={() => toggle(o.name)} className={cx("flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left text-[13px]", on ? "bg-accent/10" : "hover:bg-surface-2")}>
                        <span className={cx("flex size-4 items-center justify-center rounded-[4px] border", on ? "border-accent bg-accent text-accent-fg" : "border-line")}>{on && <Check size={11} />}</span>
                        <span className="min-w-0 flex-1 truncate" dir="auto">{o.name}</span><span className="text-[11.5px] text-muted">{o.sub}</span>
                      </button>
                    );
                  })}
                  {!options.length && <div className="p-2 text-[12.5px] text-muted">No course roadmaps yet. Create Course spaces first (each gets a roadmap), then combine them here.</div>}
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-medium text-muted">Start with</span>
            <button onClick={() => setMode("organize")} aria-pressed={mode === "organize"} className="flex gap-2.5 rounded-[10px] px-3 py-2.5 text-left" style={opt(mode === "organize")}>
              <Glyph name="organize" size={16} color={mode === "organize" ? "var(--accent)" : "var(--muted)"} />
              <span className="flex flex-col gap-0.5"><span className="font-semibold">Organize from course outlines</span><span className="text-[12px] text-muted">Matches topics across courses, proposes stages. You review before anything is saved.</span></span>
            </button>
            <button onClick={() => setMode("empty")} aria-pressed={mode === "empty"} className="flex gap-2.5 rounded-[10px] px-3 py-2.5 text-left" style={opt(mode === "empty")}>
              <Glyph name="v-board" size={16} color={mode === "empty" ? "var(--accent)" : "var(--muted)"} /><span className="font-semibold">Empty stages, I'll arrange</span>
            </button>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={close} className="flex h-9 items-center rounded-[10px] px-3.5 text-muted hover:text-ink">Cancel</button>
            <button onClick={() => (mode === "organize" && picked.length ? setPreview(body()) : void create(body()))} className="flex h-9 items-center rounded-[10px] bg-accent px-4 font-semibold text-accent-fg">Create path</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
