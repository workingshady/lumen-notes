// Settings › Review (FSRS) (Lumen 20 · A12): target retention slider 0.80–0.97, a workload chart estimated from the
// cards' current FSRS memory (lib/workload.ts), card states, and Advanced: max interval, new cards a day, learning /
// relearning steps, and "Optimize from history" (fits the FSRS-6 weights to the review log, lib/fsrs-optimize.ts).
import { useLiveQuery } from "dexie-react-hooks";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { intervalDays, parseSteps, userParams } from "../lib/fsrs";
import { fitWeights, MIN_REVIEWS } from "../lib/fsrs-optimize";
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
  const work = useMemo(() => (cards ? estimateWorkload(cards, userParams(s, shown), 30, now) : []), [cards, shown, now, s]);
  const workCmp = useMemo(() => (cards ? estimateWorkload(cards, userParams(s, cmp), 30, now) : []), [cards, cmp, now, s]);
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
            <Glyph name="chevron-right" size={13} className="transition-transform" style={{ transform: adv ? "rotate(90deg)" : "none" }} />Advanced · max interval, new cards a day, optimize from history
          </button>
          {adv && <AdvancedReview value={value} />}
        </div>
      </section>
    </div>
  );
}

const field = "h-8 rounded-[7px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-accent";

/** Settings › Review › Advanced: editable scheduler limits + "Optimize from history" over the review log. */
function AdvancedReview({ value }: { value: number }) {
  const s = useSettings();
  const p = userParams(s, value);
  const logs = useLiveQuery(() => db.reviews.filter((r) => !r.deleted).toArray(), []);
  const longTerm = useMemo(() => {
    if (!logs) return 0;
    const last = new Map<string, number>(); let n = 0;
    for (const r of [...logs].sort((a, b) => a.at - b.at)) { const l = last.get(r.cardId); if (l !== undefined && r.at - l >= 86_400_000) n++; last.set(r.cardId, r.at); }
    return n;
  }, [logs]);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const optimize = async () => {
    if (!logs) return;
    setBusy(0); setMsg("");
    const r = await fitWeights(logs.map((l) => ({ cardId: l.cardId, at: l.at, grade: l.grade })), { onProgress: (f) => setBusy(f) });
    setBusy(null);
    if (!r) { setMsg(`Needs at least ${MIN_REVIEWS} reviews a day or more apart; you have ${longTerm}.`); return; }
    setSettings({ fsrsWeights: r.w, fsrsFit: { at: Date.now(), reviews: r.n, before: +r.before.toFixed(4), after: +r.after.toFixed(4) } });
    setMsg(r.after < r.before ? `Fitted to ${r.n} reviews: prediction error (log loss) ${r.before.toFixed(3)} → ${r.after.toFixed(3)}.` : `The default parameters already fit your ${r.n} reviews best.`);
  };
  const fit = s.fsrsWeights && s.fsrsFit;
  return (
    <div className="flex flex-col gap-2.5 text-[12.5px]">
      <label className="flex items-center gap-3"><span className="flex-1 text-muted">Max interval</span>
        <NumField value={s.fsrsMaxInterval} min={1} max={36500} onCommit={(v) => setSettings({ fsrsMaxInterval: v })} aria="Max interval in days" />
        <span className="w-[86px] text-muted">days{s.fsrsMaxInterval >= 365 ? ` · ${+(s.fsrsMaxInterval / 365).toFixed(1)} y` : ""}</span></label>
      <label className="flex items-center gap-3"><span className="flex-1 text-muted">New cards a day</span>
        <NumField value={s.fsrsNewPerDay} min={0} max={9999} onCommit={(v) => setSettings({ fsrsNewPerDay: v })} aria="New cards a day" />
        <span className="w-[86px] text-muted">{s.fsrsNewPerDay ? "per day" : "no limit"}</span></label>
      <label className="flex items-center gap-3"><span className="flex-1 text-muted">Learning steps</span>
        <StepsField value={s.fsrsLearningSteps} onCommit={(v) => setSettings({ fsrsLearningSteps: v })} aria="Learning steps" /></label>
      <label className="flex items-center gap-3"><span className="flex-1 text-muted">Relearning steps</span>
        <StepsField value={s.fsrsRelearningSteps} onCommit={(v) => setSettings({ fsrsRelearningSteps: v })} aria="Relearning steps" /></label>
      <div className="flex items-center gap-3"><span className="flex-1 text-muted">A card known for 30 days comes back in</span><span className="tabular-nums">{intervalDays(30, p)} days</span></div>
      <div className="flex items-center gap-3"><span className="flex-1 text-muted">Scheduler</span><span className="text-end">{fit ? `FSRS-6, fitted to ${fit.reviews} reviews · ${new Date(fit.at).toLocaleDateString()}` : "FSRS-6, default parameters"}</span></div>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button disabled={busy !== null || !logs} onClick={() => void optimize()} className="h-8 rounded-[8px] border border-line px-3 font-medium text-ink hover:bg-surface-2 disabled:opacity-60">
          {busy !== null ? `Optimizing… ${Math.round(busy * 100)}%` : "Optimize from history"}
        </button>
        {fit && <button onClick={() => { setSettings({ fsrsWeights: null, fsrsFit: null }); setMsg("Back to the default parameters."); }} className="h-8 px-2 text-muted hover:text-ink">Use defaults</button>}
        <span className="text-muted">{logs ? `${logs.length} review${logs.length === 1 ? "" : "s"} logged · ${longTerm} a day or more apart` : ""}</span>
      </div>
      {msg && <div role="status" className="text-muted">{msg}</div>}
    </div>
  );
}

function NumField({ value, min, max, onCommit, aria }: { value: number; min: number; max: number; onCommit: (v: number) => void; aria: string }) {
  const [t, setT] = useState(String(value));
  useEffect(() => setT(String(value)), [value]);
  const commit = () => { const v = Math.round(Number(t)); if (Number.isFinite(v) && t.trim() !== "") onCommit(Math.min(max, Math.max(min, v))); else setT(String(value)); };
  return <input aria-label={aria} inputMode="numeric" value={t} onChange={(e) => setT(e.target.value.replace(/[^0-9]/g, ""))} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className={field + " w-[84px] text-end tabular-nums"} />;
}

const fmtSteps = (v: number[]) => v.map((m) => (m >= 60 && m % 60 === 0 ? `${m / 60}h` : `${m}m`)).join(" ");
function StepsField({ value, onCommit, aria }: { value: number[]; onCommit: (v: number[]) => void; aria: string }) {
  const [t, setT] = useState(fmtSteps(value));
  const [bad, setBad] = useState(false);
  useEffect(() => setT(fmtSteps(value)), [value]);
  const commit = () => { const v = parseSteps(t); if (v) { setBad(false); onCommit(v); setT(fmtSteps(v)); } else setBad(true); };
  return <input aria-label={aria} aria-invalid={bad} title="Minutes or hours under a day, e.g. 1m 10m" value={t} onChange={(e) => { setT(e.target.value); setBad(false); }} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className={field + " w-[178px] max-sm:w-[130px]" + (bad ? " !border-bad" : "")} />;
}
