// Date scrubber on the right edge of long note lists (Lumen 22 "Lists that stay fast": sticky month headers + a date
// scrubber jump through 1,240 notes). Months come from every note in the list (not only the rendered page); jumping to
// a month that isn't rendered yet loads pages until its header exists, then scrolls to it.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { t } from "../lib/i18n";
import { MONTHS_ABOVE, monthKey, monthName } from "./note-list-desk";
import { cx } from "./ui";

export function DateScrubber({ notes, timeOf }: { notes: Note[]; timeOf: (n: Note) => number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  const [cur, setCur] = useState<string | null>(null);
  const months = useMemo(() => {
    const seen: string[] = [];
    for (const n of notes) { if (n.pinned) continue; const k = monthKey(timeOf(n)).slice(2); if (!seen.includes(k)) seen.push(k); }
    return seen;
  }, [notes, timeOf]);
  const box = () => ref.current?.closest<HTMLElement>("[data-note-list]") ?? null;
  useEffect(() => {
    const el = box();
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    const onScroll = () => {
      let last: string | null = null;
      for (const hd of el.querySelectorAll<HTMLElement>("[data-month]")) { if (hd.offsetTop - el.offsetTop <= el.scrollTop + 4) last = hd.dataset.month!; else break; }
      setCur(last ?? months[0] ?? null);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener("scroll", onScroll); };
  }, [months]); // eslint-disable-line react-hooks/exhaustive-deps
  if (notes.length <= MONTHS_ABOVE || months.length < 2) return null;
  const jump = async (ym: string) => {
    const el = box();
    if (!el) return;
    for (let i = 0; i < 40 && !el.querySelector(`[data-month="${ym}"]`); i++) {
      const more = el.querySelector<HTMLButtonElement>("[data-list-more] button");
      if (!more) break;
      more.click();
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    }
    const hd = el.querySelector<HTMLElement>(`[data-month="${ym}"]`);
    if (hd) { el.scrollTop = hd.offsetTop - el.offsetTop; setCur(ym); }
  };
  // Evenly sampled labels (≈ one per 56 px); the year shows where it changes.
  const slots = Math.max(2, Math.min(months.length, Math.floor((h - 24) / 56)));
  const pick = Array.from({ length: slots }, (_, i) => months[Math.round((i * (months.length - 1)) / (slots - 1))]).filter((m, i, a) => a.indexOf(m) === i);
  const thisYear = String(new Date().getFullYear());
  return (
    <div ref={ref} className="pointer-events-none sticky top-0 z-[2] h-0 shrink-0 self-end" aria-hidden={false}>
      <nav data-scrubber aria-label={t("Jump to month")} className="pointer-events-auto absolute end-0 top-0 flex w-7 flex-col items-end justify-between py-3 pe-1" style={{ height: h }}
        onPointerMove={(e) => { if (e.buttons !== 1) return; const r = e.currentTarget.getBoundingClientRect(); const i = Math.max(0, Math.min(months.length - 1, Math.floor(((e.clientY - r.top) / r.height) * months.length))); if (months[i] !== cur) void jump(months[i]); }}>
        {pick.map((m, i) => {
          const y = m.slice(0, 4), prevY = i ? pick[i - 1].slice(0, 4) : thisYear;
          return (
            <button key={m} onClick={() => void jump(m)} title={monthName(m)} className={cx("text-[10.5px] leading-none hover:text-ink", m === cur ? "font-semibold text-accent" : "text-muted")}>
              {y !== prevY ? y : monthName(m, true).replace(/\s*\d{4}$/, "")}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
