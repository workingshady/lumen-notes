import { setSettings, useSettings } from "../lib/settings";
import { intervalDays, paramsFor } from "../lib/fsrs";
import { Segmented } from "../components/ui";

const OPTIONS = ["0.8", "0.85", "0.9", "0.95"] as const;

/** Settings › Reading › Flashcards: FSRS desired retention. */
export function ReviewSettings() {
  const s = useSettings();
  const ret = s.retention ?? 0.9;
  const cur = OPTIONS.find((o) => Math.abs(Number(o) - ret) < 0.001) ?? "0.9";
  // What a card with 30 days of stability would get at this retention (makes the trade-off concrete).
  const sample = intervalDays(30, paramsFor(ret));
  return (
    <div className="mt-6 flex max-w-[640px] flex-col gap-3">
      <div>
        <div className="text-[17px] font-[650]">Flashcards</div>
        <div className="mt-1 text-[13px] text-muted">Review uses FSRS-6 scheduling. Desired retention is the chance you still remember a card when it comes due: higher means more reviews, lower means longer gaps.</div>
      </div>
      <div className="flex flex-col gap-1.5 rounded-[12px] border border-line bg-surface p-4">
        <span className="text-[13px] font-medium">Desired retention · {Math.round(ret * 100)}%</span>
        <Segmented value={cur} onChange={(v) => setSettings({ retention: Number(v) })} options={OPTIONS.map((o) => ({ value: o, label: `${Math.round(Number(o) * 100)}%` }))} />
        <span className="text-[12.5px] text-muted">A well-known card due in 30 days at 90% would be due in {sample} days.</span>
      </div>
    </div>
  );
}
