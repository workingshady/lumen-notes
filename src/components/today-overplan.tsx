// Today with too much planned (Lumen 22 §5): reviews always stay, so a backlog can push the plan past the daily goal.
// Then Today says so ("185 min planned · goal 90"), shows goal vs overflow, and the new lessons it trimmed are listed
// under "Moved to tomorrow (N)" (the plan's over-budget lessons, lib/plan.ts `extra`).
import { fmtNum, t } from "../lib/i18n";

export function OverPlan({ planned, goal, trimmed }: { planned: number; goal: number; trimmed: number }) {
  if (!goal || planned <= goal) return null;
  const inGoal = (goal / planned) * 100;
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-3.5 py-3" data-overplan>
      <b className="font-semibold">{t("{p} min planned · goal {g}", { p: fmtNum(planned), g: fmtNum(goal) })}</b>
      <span className="text-[12.5px] leading-[18px] text-muted">{trimmed ? t("Today trims new lessons first, keeps reviews. Trimmed items show under “Moved to tomorrow ({n})”.", { n: trimmed }) : t("Reviews always stay in the plan. Today has no new lessons left to trim.")}</span>
      <span className="flex h-1.5 overflow-hidden rounded-[3px] bg-surface-2" role="img" aria-label={t("{p} min planned · goal {g}", { p: fmtNum(planned), g: fmtNum(goal) })}>
        <span style={{ width: `${inGoal}%`, background: "var(--success)" }} />
        <span style={{ width: `${100 - inGoal}%`, background: "color-mix(in srgb, var(--warning) 70%, transparent)" }} />
      </span>
    </div>
  );
}
