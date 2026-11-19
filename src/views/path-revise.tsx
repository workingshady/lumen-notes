// Learning path · Revise (PathDesk "revise", R4-14H): one concept at a time, where it's taught, a recall prompt (a flashcard from
// its notes when there is one), resources, Again (back to 1 day) / Got it (next ladder step), and what's coming up.
import { useMemo, useState } from "react";
import type { Note } from "../../shared/types";
import { gatherMaterial } from "../components/ConceptPractice";
import { Glyph } from "../components/Glyph";
import { cx } from "../components/ui";
import { flashcards } from "../lib/parse";
import { abbrevCourse, markRevised, nextInterval, REVIEW_LADDER, type BuiltConcept, type BuiltPath } from "../lib/path";
import { openNote, useVault } from "../lib/store";
import { ago, conceptNotes, conceptResources, RES_GLYPH, until } from "./path-res";
import { stageLabel } from "./path-ui";
import { usePhone } from "./spaces-util";

const SERIF = { fontFamily: "'Source Serif 4', Georgia, serif" };

export function Revise({ path, note, save, onOpen, keep }: { path: BuiltPath; note: Note; save: (b: string) => void; onOpen: (k: string) => void; keep: (c: BuiltConcept) => boolean }) {
  const v = useVault();
  const phone = usePhone();
  const today = new Date().toISOString().slice(0, 10);
  const due = path.concepts.filter((c) => c.reviewDue && keep(c)).sort((a, b) => (a.def.review ?? "").localeCompare(b.def.review ?? ""));
  const later = path.concepts.filter((c) => c.status === "done" && !c.reviewDue && c.def.review && keep(c)).sort((a, b) => (a.def.review ?? "").localeCompare(b.def.review ?? ""));
  const [done, setDone] = useState(0);
  const [show, setShow] = useState(false);
  const cur = due[0];
  const total = due.length + done;
  const card = useMemo(() => {
    if (!cur) return null;
    const cards = gatherMaterial(cur, v.byTitle).notes.flatMap((n) => flashcards(n.body).filter((c) => c.kind !== "occlusion"));
    const step = Math.max(0, REVIEW_LADDER.indexOf(cur.def.interval));
    return cards.length ? cards[step % cards.length] : null;
  }, [cur, v.byTitle]);
  const lessons = cur ? conceptNotes(cur, v.byTitle).filter((x) => x.note) : [];
  const links = cur ? conceptResources(cur, v.byTitle) : [];
  const rate = (ok: boolean) => { if (!cur) return; save(markRevised(note.body, cur, ok)); setDone((d) => d + 1); setShow(false); };
  const lastSeen = cur?.def.review && cur.def.interval ? (() => { const d = new Date(cur.def.review + "T12:00"); d.setDate(d.getDate() - cur.def.interval); return d.toISOString().slice(0, 10); })() : null;
  return (
    <div className={cx("flex h-full min-h-0 justify-center gap-7 overflow-y-auto", phone ? "flex-col px-4 py-3" : "px-7 pb-6 pt-7")}>
      <div className={cx("flex flex-col gap-4", phone ? "w-full" : "w-[640px]")}>
        {cur ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-muted"><span className="font-semibold text-learn">Revise · {done + 1} of {total}</span><span>·</span><span>{lastSeen ? `last seen ${ago(lastSeen, today)}` : "first revision"} · interval {cur.def.interval || 1} d</span></div>
            <div className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface px-7 py-6 max-md:px-4 max-md:py-4">
              <div className="flex items-center gap-2.5">
                <Glyph name="s-revise" size={18} color="var(--learn)" />
                <button onClick={() => onOpen(cur.key)} className="text-left text-[24px] font-[650] tracking-[-.02em]" dir="auto">{cur.def.name}</button>
                <span className="flex-1" />
                {!phone && <span className="text-[12px] text-muted">{stageLabel(path, cur)}</span>}
              </div>
              {cur.coverage.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="self-center text-[12px] text-muted">Taught in</span>
                  {cur.coverage.slice(0, 6).map((x, k) => (
                    <span key={k} className="flex h-[26px] items-center gap-1.5 overflow-hidden rounded-[6px] bg-surface-2 pe-[9px] text-[12px]" title={`${x.course.spaceName} › ${x.module} › ${x.topic.name}`}>
                      <span className="w-[3px] self-stretch" style={{ background: x.course.color }} /><span dir="auto">{abbrevCourse(x.course.spaceName, 14)} · {abbrevCourse(x.module, 14)}</span>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-col gap-1.5 rounded-[10px] bg-bg px-[18px] py-4">
                <span className="text-[12px] text-muted">Recall, then check</span>
                <span style={SERIF} className="text-[19px] leading-[28px]" dir="auto">{card ? card.q : `Explain ${cur.def.name} in two sentences: what it is, an example, and where it's used.`}</span>
                {card && (show ? <span className="mt-1 border-t border-line pt-2 text-[14px] leading-[22px]" dir="auto">{card.a}</span> : <button onClick={() => setShow(true)} className="self-start text-[12.5px] text-link">Show answer</button>)}
              </div>
              {(lessons.length > 0 || links.length > 0) && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[12px] text-muted">Resources</span>
                  {lessons.slice(0, 3).map(({ title, note: n }) => (
                    <button key={title} onClick={() => n && openNote(n.id)} className="flex items-center gap-2 text-left hover:text-link">
                      <Glyph name={n?.type === "pdf" ? "pdf" : "lesson"} size={15} color="var(--muted)" /><span className="min-w-0 flex-1 truncate" dir="auto">{title}</span><span className="text-[12px] text-muted">{n ? ago(new Date(n.updatedAt).toISOString().slice(0, 10), today).replace(" days", " d") : ""}</span>
                    </button>
                  ))}
                  {links.slice(0, Math.max(1, 4 - lessons.length)).map((r) => (
                    <a key={r.url} href={r.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-link">
                      <Glyph name={RES_GLYPH[r.kind]} size={15} color="var(--muted)" /><span className="min-w-0 flex-1 truncate" dir="auto">{r.label}</span><span className="text-[12px] text-muted">{r.from}</span>
                    </a>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2.5">
                <button onClick={() => rate(false)} className="flex h-12 flex-col items-center justify-center rounded-[10px]" style={{ background: "color-mix(in srgb,var(--danger) 10%,var(--surface))", border: "1px solid color-mix(in srgb,var(--danger) 30%,transparent)" }}>
                  <b className="font-semibold text-bad">Again</b><span className="text-[11.5px] text-muted">back to 1 day</span>
                </button>
                <button onClick={() => rate(true)} className="flex h-12 flex-col items-center justify-center rounded-[10px]" style={{ background: "color-mix(in srgb,var(--success) 10%,var(--surface))", border: "1px solid color-mix(in srgb,var(--success) 30%,transparent)" }}>
                  <b className="font-semibold text-ok">Got it</b><span className="text-[11.5px] text-muted">next in {nextInterval(cur)} {nextInterval(cur) === 1 ? "day" : "days"}</span>
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-[14px] border border-line bg-surface p-6 text-center text-[13px] text-muted">{done ? `Done: ${done} revised. ` : ""}Nothing to revise right now. Learned concepts come back after 1, 3, 7, 14, 30, 60 and 120 days.</div>
        )}
      </div>
      <div className={cx("flex flex-col gap-2.5", phone ? "w-full" : "w-[260px]")}>
        <span className="font-semibold">Coming up</span>
        {later.slice(0, 8).map((c) => {
          const u = until(c.def.review!, today);
          return (
            <button key={c.key} onClick={() => onOpen(c.key)} className="flex items-center gap-2.5 rounded-[8px] bg-surface px-2.5 py-2 text-left hover:bg-surface-2">
              <span className="min-w-0 flex-1 truncate" dir="auto">{c.def.name}</span><span className="text-[12px]" style={{ color: u === "today" ? "var(--learn)" : "var(--muted)" }}>{u}</span>
            </button>
          );
        })}
        {!later.length && <span className="text-[12.5px] text-muted">Nothing scheduled yet.</span>}
        <span className="text-[12px] leading-[18px] text-muted">Intervals: {REVIEW_LADDER.join(" → ")} days. Again resets to 1.</span>
      </div>
    </div>
  );
}
