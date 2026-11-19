// Learning path · Timeline (PathDesk "timeline", R4-14G): one lane per course (collapsible) with the lessons that teach each
// concept placed by planned date, a violet revision lane, and the amber today line.
import { ChevronDown, ChevronRight, CircleCheck, CircleDot, Circle, History } from "lucide-react";
import { useMemo } from "react";
import { cx } from "../components/ui";
import type { BuiltConcept, BuiltPath } from "../lib/path";
import { useStored } from "./path-ui";
import { usePhone } from "./spaces-util";
import { fmtDate, fmtNum, t } from "../lib/i18n";

type Item = { lane: string; date: string; start: number; end: number; label: string; key: string; status: string; color: string; kind: "topic" | "review" };
const DAY = 864e5;
const ts = (d: string) => new Date(d + "T12:00").getTime();

export function Timeline({ path, onOpen, keep, noteId }: { path: BuiltPath; onOpen: (k: string) => void; keep: (c: BuiltConcept) => boolean; noteId: string }) {
  const phone = usePhone();
  const [closed, setClosed] = useStored<string[]>(`lumen.path.tlanes.${noteId}`, []);
  const today = new Date().toISOString().slice(0, 10);
  const items = useMemo(() => {
    const raw: Omit<Item, "start" | "end">[] = [];
    for (const c of path.concepts) {
      if (!keep(c)) continue;
      for (const cov of c.coverage) if (cov.topic.due) raw.push({ lane: cov.course.key, color: cov.course.color, date: cov.topic.due, label: cov.topic.name, key: c.key, status: cov.topic.status, kind: "topic" });
      if (c.def.review && c.status === "done") raw.push({ lane: "__review", color: "var(--learn)", date: c.def.review, label: c.def.name, key: c.key, status: c.reviewDue ? "due" : "later", kind: "review" });
    }
    // a lesson bar runs from the previous lesson's date in that lane (at most 14 days back, at least 9) to its own date
    const out: Item[] = [];
    const byLane = new Map<string, typeof raw>();
    for (const r of raw) byLane.set(r.lane, [...(byLane.get(r.lane) ?? []), r]);
    for (const [, list] of byLane) {
      list.sort((a, b) => a.date.localeCompare(b.date));
      let prev = -Infinity;
      for (const r of list) {
        const end = ts(r.date) + DAY;
        const span = r.kind === "review" ? 8 * DAY : Math.min(14 * DAY, Math.max(9 * DAY, end - prev));
        out.push({ ...r, start: end - span, end });
        prev = end;
      }
    }
    return out;
  }, [path, keep]);
  if (!items.length) return <div className="p-10 text-center text-[13px] text-muted">{t("No dates yet. Add dates to course topics (in each course roadmap); revision dates appear here once concepts are learned.")}</div>;
  const min = Math.min(...items.map((i) => i.start), ts(today)), max = Math.max(...items.map((i) => i.end), ts(today) + DAY);
  const s0 = new Date(min); s0.setDate(s0.getDate() - ((s0.getDay() + 6) % 7)); s0.setHours(12, 0, 0, 0);
  const start = s0.getTime();
  const weeks = Math.max(10, Math.ceil((max - start) / (7 * DAY)));
  const span = weeks * 7 * DAY;
  const pct = (x: number) => `${((x - start) / span) * 100}%`;
  const LABEL = phone ? 120 : 200;
  const lanes = [
    ...path.courses.filter((c) => items.some((i) => i.lane === c.key)).map((c) => ({ key: c.key, label: c.spaceName, color: c.color, review: false })),
    ...(items.some((i) => i.lane === "__review") ? [{ key: "__review", label: t("Revision"), color: "var(--learn)", review: true }] : []),
  ];
  return (
    <div className={cx("flex h-full min-h-0 flex-col overflow-auto", phone ? "px-4 py-2" : "px-7 py-3")}>
      <div className="relative" style={{ minWidth: LABEL + weeks * 96 }}>
        <div className="grid h-[30px] items-center border-b border-line text-[12px] text-muted" style={{ gridTemplateColumns: `${LABEL}px 1fr` }}>
          <span className="sticky start-0 z-[3] bg-bg">{t("Course")}</span>
          <div className="grid" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }}>
            {Array.from({ length: weeks }, (_, i) => <span key={i}>{fmtDate(start + i * 7 * DAY, { day: "numeric", month: "short" })}</span>)}
          </div>
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute bottom-0 top-0 z-[2] w-0.5 bg-accent" style={{ insetInlineStart: `calc(${LABEL}px + (100% - ${LABEL}px) * ${((ts(today) - start) / span).toFixed(4)})` }}>
            <span className="absolute -start-[22px] -top-px rounded-[6px] bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-accent-fg">{t("Today")}</span>
          </div>
          {lanes.map((l) => {
            const its = items.filter((i) => i.lane === l.key);
            const isClosed = closed.includes(l.key);
            const rowsEnd: number[] = [];
            const placed = its.map((i) => {
              let r = rowsEnd.findIndex((e) => e <= i.start);
              if (r < 0) { r = rowsEnd.length; rowsEnd.push(0); }
              rowsEnd[r] = i.end + DAY;
              return { ...i, row: r };
            });
            const h = isClosed ? 36 : 62 + Math.max(0, rowsEnd.length - 1) * 34;
            return (
              <div key={l.key} className="grid border-b border-line" style={{ gridTemplateColumns: `${LABEL}px 1fr`, height: h, background: l.review ? "color-mix(in srgb,var(--learn) 5%,transparent)" : "transparent" }}>
                <button onClick={() => setClosed((o) => (o.includes(l.key) ? o.filter((x) => x !== l.key) : [...o, l.key]))} aria-expanded={!isClosed} title={l.label}
                  className={cx("sticky start-0 z-[3] flex items-center gap-2 pe-2 text-start font-semibold", l.review ? "" : "bg-bg")}>
                  <span className="h-[22px] w-[3px] shrink-0 rounded-[2px]" style={{ background: l.color }} />
                  <span className="min-w-0 flex-1 truncate" dir="auto">{l.label}</span>
                  {isClosed ? <span className="flex items-center gap-1 text-[11.5px] font-normal text-muted">{fmtNum(its.length)}<ChevronRight size={12} /></span> : <ChevronDown size={12} className="shrink-0 text-muted opacity-40" />}
                </button>
                <div className="relative">
                  {!isClosed && placed.map((i, k) => {
                    const Icon = i.kind === "review" ? History : i.status === "done" ? CircleCheck : i.status === "learning" ? CircleDot : Circle;
                    const gc = i.kind === "review" ? "var(--learn)" : i.status === "done" ? "var(--success)" : i.status === "learning" ? "var(--info)" : "var(--muted)";
                    return (
                      <button key={k} onClick={() => onOpen(i.key)} title={`${i.label} · ${fmtDate(i.date + "T12:00")}`}
                        className="absolute flex h-[30px] items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[8px] px-2.5 text-[12px] font-medium hover:z-10"
                        style={{ insetInlineStart: pct(i.start), width: `${((i.end - i.start) / span) * 100}%`, minWidth: 96, top: 16 + i.row * 34,
                          background: i.kind === "review" ? "color-mix(in srgb,var(--learn) 12%,var(--surface))" : i.status === "done" ? `color-mix(in srgb, ${i.color} 14%, var(--surface))` : "var(--surface)",
                          border: `1px solid ${i.kind === "review" ? "color-mix(in srgb,var(--learn) 40%,transparent)" : i.status === "learning" ? "var(--info)" : "var(--border)"}` }}>
                        <Icon size={13} className="shrink-0" style={{ color: gc }} /><span className="truncate" dir="auto">{i.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
