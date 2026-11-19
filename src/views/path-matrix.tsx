// Learning path · Matrix (PathDesk "matrix", R4-14F): concepts × courses. Rows grouped (collapsible), sticky concept column,
// rotated + abbreviated course headers (full name on hover), overlap column, "Only overlapping" / "Missing from my courses".
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { cx } from "../components/ui";
import { abbrevCourse, conceptCourses, UNPLACED, type BuiltConcept, type BuiltPath, type GroupBy, type PathFilter } from "../lib/path";
import { groupColumns } from "./path-stages";
import { shortStage, StatusIcon } from "./path-ui";
import { usePhone } from "./spaces-util";
import { fmtNum, t } from "../lib/i18n";

export function Matrix({ path, onOpen, keep, group, f, setF, noteId }: { path: BuiltPath; onOpen: (k: string) => void; keep: (c: BuiltConcept) => boolean; group: GroupBy; f: PathFilter; setF: (f: PathFilter) => void; noteId: string }) {
  const phone = usePhone();
  const [missing, setMissing] = useState(false);
  const [closed, setClosed] = useState<string[]>([]);
  void noteId;
  const courses = f.courses.length ? path.courses.filter((c) => f.courses.includes(c.key)) : path.courses;
  const groups = useMemo(() => groupColumns(path, group, (c) => keep(c) && (!missing || !c.coverage.length)).filter((g) => g.concepts.length), [path, group, keep, missing]);
  const overlapN = path.concepts.filter((c) => conceptCourses(c).length > 1).length;
  const missingN = path.concepts.filter((c) => !c.coverage.length).length;
  const cw = phone ? 34 : 40;
  const cols = `${phone ? 150 : 240}px repeat(${courses.length}, minmax(${cw}px, 1fr)) ${phone ? 52 : 80}px`;
  const minW = (phone ? 150 : 240) + courses.length * cw + (phone ? 52 : 80);
  const chip = (on: boolean) => ({ background: on ? "color-mix(in srgb,var(--accent) 14%,transparent)" : "transparent", boxShadow: on ? "inset 0 0 0 1px var(--accent)" : "inset 0 0 0 1px var(--border)", fontWeight: on ? 600 : 450, color: on ? "var(--text)" : "var(--muted)" });
  return (
    <div className={cx("flex h-full min-h-0 flex-col", phone ? "px-4 py-2" : "px-7 py-3")}>
      <div className="mb-2.5 flex shrink-0 gap-2">
        <button onClick={() => setF({ ...f, overlapping: !f.overlapping })} aria-pressed={f.overlapping} className="flex h-7 items-center rounded-full px-2.5 text-[12.5px]" style={chip(f.overlapping)}>{t("Only overlapping · {n}", { n: overlapN })}</button>
        <button onClick={() => setMissing((m) => !m)} aria-pressed={missing} className="flex h-7 items-center rounded-full px-2.5 text-[12.5px]" style={chip(missing)}>{t("Missing from my courses · {n}", { n: missingN })}</button>
      </div>
      <div className="min-h-0 overflow-auto rounded-[12px] border border-line" role="table" aria-label={t("Concepts by course")}>
        <div style={{ minWidth: minW }}>
          <div className="sticky top-0 z-[3] grid h-[112px] items-end border-b border-line bg-surface" style={{ gridTemplateColumns: cols }} role="row">
            <span className="sticky start-0 z-[1] bg-surface px-3.5 py-2.5 text-[12px] font-semibold text-muted" role="columnheader">{t("Concept")}</span>
            {courses.map((c) => (
              <span key={c.key} className="relative h-[104px]" role="columnheader" title={c.spaceName}>
                <span className="absolute bottom-2.5 left-1/2 flex origin-[0_50%] -rotate-[55deg] items-center gap-1.5 whitespace-nowrap text-[12px]"><span className="size-2 shrink-0 rounded-[2px]" style={{ background: c.color }} />{abbrevCourse(c.spaceName)}</span>
              </span>
            ))}
            <span className="px-2 py-2.5 text-center text-[12px] font-semibold text-muted" role="columnheader">{phone ? "×" : t("Overlap")}</span>
          </div>
          {groups.map((g) => {
            const label = g.label ?? (g.name === UNPLACED ? t(UNPLACED) : shortStage(g.name));
            const isClosed = closed.includes(g.name);
            return (
              <Fragment key={g.name}>
                <button onClick={() => setClosed((o) => (o.includes(g.name) ? o.filter((x) => x !== g.name) : [...o, g.name]))} aria-expanded={!isClosed}
                  className="flex h-[30px] w-full items-center gap-1.5 border-t border-line bg-bg px-3.5 text-start text-[11px] font-semibold uppercase tracking-[.06em] text-muted first-of-type:border-t-0">
                  <span className="sticky start-3.5 flex items-center gap-1.5">{isClosed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}{label}<span className="font-medium normal-case tracking-normal">· {fmtNum(g.concepts.length)}</span></span>
                </button>
                {!isClosed && g.concepts.map((c) => {
                  const k = conceptCourses(c).length;
                  const learned = c.status === "done";
                  return (
                    <div key={c.key} role="row" onClick={() => onOpen(c.key)} className="lp-mrow grid h-9 cursor-pointer items-center border-t border-line" style={{ gridTemplateColumns: cols }}>
                      <span className="lp-mcell sticky start-0 z-[1] flex h-full items-center gap-2 bg-bg px-3.5 font-medium" role="cell"><StatusIcon c={c} size={14} /><span className="truncate" dir="auto" title={c.def.name}>{c.def.name}</span></span>
                      {courses.map((col) => {
                        const on = c.coverage.some((x) => x.course.key === col.key);
                        return (
                          <span key={col.key} className="flex items-center justify-center" role="cell" title={`${col.spaceName}: ${on ? (learned ? t("taught · learned") : t("taught · not learned yet")) : t("not taught")}`}>
                            <span className="size-3 rounded-full" style={{ background: on && learned ? col.color : "transparent", boxShadow: on ? `inset 0 0 0 2px ${col.color}` : "inset 0 0 0 1px var(--border)" }} />
                          </span>
                        );
                      })}
                      <span className="text-center font-[650]" role="cell" style={{ color: k >= 4 ? "var(--text)" : "var(--muted)" }}>{k ? `${fmtNum(k)}×` : t("own")}</span>
                    </div>
                  );
                })}
              </Fragment>
            );
          })}
          {!groups.length && <p className="px-4 py-6 text-center text-[13px] text-muted">{t("No concepts match the filters.")}</p>}
        </div>
      </div>
      <p className="mt-2 shrink-0 text-[12px] text-muted">{t("Filled dot = taught and learned · ring = taught, not learned yet · “3×” = taught by three courses: learn it once, use every course's material.")}</p>
    </div>
  );
}
