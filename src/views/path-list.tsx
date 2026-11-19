// Learning paths list (design: Lumen 14 · "Paths list"): one card per path (glyph tile, name, courses · concepts, progress bar,
// learned · to revise) + a dashed "New path" card that opens the New learning path dialog.
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Glyph } from "../components/Glyph";
import { NewPathDialog } from "../components/NewPathDialog";
import { buildPath, COURSE_COLORS, parsePath, pathProgress, resolveCourses } from "../lib/path";
import { openNote, useVault } from "../lib/store";
import { usePhone } from "./spaces-util";

const TILE = ["#F2A93B", ...COURSE_COLORS.slice(1)];

export function PathsList() {
  const v = useVault();
  const phone = usePhone();
  const [dlg, setDlg] = useState(false);
  const cards = useMemo(() => v.notes.filter((n) => n.type === "path" && !n.deleted).sort((a, b) => b.updatedAt - a.updatedAt).map((n, i) => {
    const doc = parsePath(n.body);
    const p = pathProgress(buildPath(n.body, resolveCourses(doc.courses, v.notes, v.spaces)));
    return { n, color: TILE[i % TILE.length], courses: doc.courses.length, p };
  }), [v.notes, v.spaces]);
  return (
    <div className="h-full overflow-y-auto px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto flex max-w-[900px] flex-col gap-4">
        <div className="flex items-center gap-2.5"><Glyph name="path" size={20} tile="#F2A93B" color="var(--accent)" /><span className="text-[20px] font-[650] tracking-[-.02em]">Learning paths</span></div>
        {!cards.length && <span className="text-[13px] text-muted">No learning path yet. Gather courses that teach the same subject.</span>}
        <div className="grid gap-3.5" style={{ gridTemplateColumns: phone ? "1fr" : "repeat(3, 1fr)" }}>
          {cards.map(({ n, color, courses, p }) => (
            <button key={n.id} onClick={() => openNote(n.id)} className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4 text-left hover:border-ink/40">
              <span className="flex items-center gap-2.5"><Glyph name="path" size={16} tile={color} color={color} /><span className="flex-1 truncate text-[15px] font-[650]" dir="auto">{n.title}</span></span>
              <span className="text-[12.5px] text-muted">{courses} {courses === 1 ? "course" : "courses"} · {p.total} concepts</span>
              <span className="h-[5px] overflow-hidden rounded-[3px] bg-surface-2"><span className="block h-full bg-ok" style={{ width: `${p.pct}%` }} /></span>
              <span className="flex gap-2.5 text-[12px]"><span>{p.done} learned</span>{p.review > 0 && <span className="text-learn">{p.review} to revise</span>}</span>
            </button>
          ))}
          <button onClick={() => setDlg(true)} className="flex min-h-[120px] items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-line p-4 text-muted hover:text-ink"><Plus size={16} />New path</button>
        </div>
      </div>
      <NewPathDialog open={dlg} onClose={() => setDlg(false)} />
    </div>
  );
}
