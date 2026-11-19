// Settings › Review (FSRS) (Lumen 20 · A12): target retention slider 0.80–0.97, a workload chart estimated from the
// cards' current FSRS memory (lib/workload.ts), card states, and Advanced (the scheduler's fixed parameters).
import { useLiveQuery } from "dexie-react-hooks";
import { useDeferredValue, useMemo, useState } from "react";
import { DEFAULT_PARAMS, intervalDays, paramsFor } from "../lib/fsrs";
import { db } from "../lib/db";
import { Glyph } from "../components/Glyph";
import { setSettings, useSettings } from "../lib/settings";
import { average, cardStates, estimateWorkload } from "../lib/workload";

const MIN = 0.8, MAX = 0.97;
const STATES = [["new", "New", "var(--info)"], ["learning", "Learning", "var(--warning)"], ["review", "Review", "var(--success)"], ["relearning", "Relearning", "var(--danger)"], ["suspended", "Suspended", "var(--muted)"]] as const;

export function ReviewSettings() {
  const s = useSettings();
  const ret = Math.min(MAX, Math.max(MIN, s.retention ?? 0.9));
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? ret;
  const shown = useDeferredValue(value);
  const [adv, setAdv] = useState(false);
  const cards = useLiveQuery(() => db.cards.toArray(), []);
  const now = useMemo(() => Date.now(), [cards]); // eslint-disable-line react-hooks/exhaustive-deps
  const cmp = shown >= 0.95 ? 0.9 : 0.95;
  const work = useMemo(() => (cards ? estimateWorkload(cards, shown, 30, now) : []), [cards, shown, now]);
  const workCmp = useMemo(() => (cards ? estimateWorkload(cards, cmp, 30, now) : []), [cards, cmp, now]);
  const states = useMemo(() => (cards ? cardStates(cards, now) : null), [cards, now]);
  const max = Math.max(1, ...work, ...workCmp);
  const pct = ((value - MIN) / (MAX - MIN)) * 100;
  const commit = (v: number) => { setDraft(null); setSettings({ retention: Math.round(v * 100) / 100 }); };
  const total = states ? Object.values(states).reduce((a, b) => a + b, 0) : 0;
  return (
    <div className="mt-6 flex max-w-[640px] flex-col gap-3 text-[13px]">
      <div>
        <div className="text-[17px] font-[650]">Review</div>
        <div className="mt-1 text-muted">Flashcards use FSRS scheduling. Target retention is the chance you still remember a card when it comes due.</div>
      </div>
      <section aria-label="Review (FSRS)" className="flex flex-col gap-3.5 rounded-[14px] border border-line bg-bg p-[22px] max-sm:p-4">
        <div className="flex items-baseline gap-2"><span className="flex-1 font-semibold">Target retention</span><b className="text-[20px] tabular-nums">{value.toFixed(2)}</b></div>
        <div className="relative h-5">
          <span className="absolute inset-x-0 top-[7px] h-1.5 rounded-[3px]" style={{ background: "linear-gradient(90deg, var(--surface-2), var(--learn))" }} />
          <span className="pointer-events-none absolute top-0 -ml-2.5 size-5 rounded-full border-[3px] border-bg bg-ink" style={{ left: `${pct}%` }} />
          <input type="range" min={MIN} max={MAX} step={0.01} value={value} aria-label="Target retention" aria-valuetext={`${value.toFixed(2)}`}
            onChange={(e) => setDraft(Number(e.target.value))} onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))} onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))} onBlur={() => draft != null && commit(draft)}
            className="absolute inset-0 m-0 w-full cursor-pointer opacity-0" />
        </div>
        <div className="flex justify-between text-[11.5px] text-muted"><span>0.80 · fewer reviews</span><span>0.97 · forget less</span></div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-muted">Reviews per day, next 30 days</span>
          <div className="relative flex h-[90px] items-end gap-[3px] border-b border-line" role="img" aria-label={`Estimated reviews per day: about ${Math.round(average(work))} a day at ${shown.toFixed(2)}`}>
            {work.map((n, i) => (
              <span key={i} title={`${i === 0 ? "Today" : `In ${i} day${i === 1 ? "" : "s"}`}: ~${Math.round(n)}`} className="flex-1 rounded-t-[2px]"
                style={{ height: `${(n / max) * 100}%`, background: i < 3 ? "var(--learn)" : "color-mix(in srgb, var(--learn) 55%, transparent)" }} />
            ))}
            {workCmp.length > 0 && (
              <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 300 90" preserveAspectRatio="none">
                <polyline fill="none" stroke="var(--text)" strokeOpacity=".7" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"
                  points={workCmp.map((n, i) => `${i * 10 + 5},${90 - (n / max) * 90}`).join(" ")} />
              </svg>
            )}
          </div>
          <span className="text-[12px] text-muted">{cards ? (total ? `~${Math.round(average(work))} a day at ${shown.toFixed(2)} · ~${Math.round(average(workCmp))} at ${cmp.toFixed(2)} (dashed)` : "No flashcards yet. Add Q :: A lines to a note.") : "Estimating…"}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[12px]">
          {STATES.map(([k, l, c]) => (
            <span key={k} className="rounded-full px-2 font-semibold leading-[22px]" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>{l}{states ? ` ${states[k]}` : ""}</span>
          ))}
        </div>
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <button onClick={() => setAdv((o) => !o)} aria-expanded={adv} className="flex items-center gap-1.5 text-left text-[12.5px] text-muted hover:text-ink">
            <Glyph name="chevron-right" size={13} className="transition-transform" style={{ transform: adv ? "rotate(90deg)" : "none" }} />Advanced · max interval, learning steps, card at 30 days
          </button>
          {adv && (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[12.5px]">
              <dt className="text-muted">Max interval</dt><dd>{Math.round(DEFAULT_PARAMS.maxInterval / 365)} years</dd>
              <dt className="text-muted">Learning steps</dt><dd>{DEFAULT_PARAMS.learningSteps.map((m) => `${m} min`).join(" · ")}</dd>
              <dt className="text-muted">Relearning steps</dt><dd>{DEFAULT_PARAMS.relearningSteps.map((m) => `${m} min`).join(" · ")}</dd>
              <dt className="text-muted">A card known for 30 days comes back in</dt><dd className="tabular-nums">{intervalDays(30, paramsFor(value))} days</dd>
              <dt className="text-muted">Scheduler</dt><dd>FSRS-6, default parameters</dd>
            </dl>
          )}
        </div>
      </section>
    </div>
  );
}
