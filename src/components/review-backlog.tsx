// Review backlog (Lumen 22 "512 cards due after a break"): above BACKLOG due cards Review first offers smaller pieces.
// Do 50 now (the 50 cards you are most likely to forget) · Spread over 7 days (keeps a seventh due today, moves the
// rest to the next six days, most at-risk first) · Review all. Overdue cards are ordered by forgetting risk.
import type { Card } from "../../shared/types";
import { patch } from "../lib/db";
import { DAY_MS, riskOf } from "./review-risk";
import { fmtNum, t } from "../lib/i18n";
import { toast } from "../lib/store";

/** Due cards above this open the backlog card instead of a session. */
export const BACKLOG = 200;
/** "Do 50 now". */
export const BACKLOG_CHUNK = 50;
/** Seconds per card for the time estimates (50 ≈ 17 min, 512 ≈ 3 h). */
const SEC_PER_CARD = 20;

export function minutesFor(n: number) { return Math.max(1, Math.round((n * SEC_PER_CARD) / 60)); }
function hoursText(n: number) { const m = minutesFor(n); return m >= 90 ? t("about {n} hours", { n: Math.round(m / 60) }) : t("about {n} min", { n: m }); }

/** Spread due cards over `days` days (today included), most at-risk first. Undoable. */
export async function spreadBacklog(cards: Card[], days = 7) {
  const now = Date.now();
  const order = [...cards].sort((a, b) => riskOf(b, now) - riskOf(a, now));
  const per = Math.ceil(order.length / days);
  const t0 = new Date(now); t0.setHours(4, 0, 0, 0);
  const before = order.map((c) => [c.id, c.due] as const);
  let moved = 0;
  for (let i = per; i < order.length; i++) {
    const d = Math.floor(i / per);
    await patch("card", order[i].id, { due: t0.getTime() + d * DAY_MS });
    moved++;
  }
  toast(t("Spread over {n} days: {k} today, {m} moved", { n: days, k: Math.min(per, order.length), m: moved }), {
    label: t("Undo"),
    run: async () => { for (const [id, due] of before) await patch("card", id, { due }); },
  });
}

export function BacklogCard({ cards, onChunk, onAll, onExit }: { cards: Card[]; onChunk: (n: number) => void; onAll: () => void; onExit: () => void }) {
  const n = cards.length;
  const chunk = Math.min(BACKLOG_CHUNK, n);
  return (
    <div className="flex h-full items-center justify-center p-4">
      <div className="flex w-full max-w-[540px] flex-col gap-3 rounded-[14px] border border-line bg-surface p-5 text-[13px]" role="dialog" aria-label={t("{n} cards are waiting", { n })}>
        <b className="text-[18px] font-[650]">{t("{n} cards are waiting", { n })}</b>
        <span className="leading-[19px] text-muted">{t("That's {time}. Catch up in smaller pieces — overdue cards are sorted by how likely you are to forget them.", { time: hoursText(n) })}</span>
        <button onClick={() => onChunk(chunk)} className="flex h-[38px] items-center justify-center rounded-[8px] bg-accent font-medium text-accent-fg">{t("Do {n} now · ~{m} min", { n: chunk, m: minutesFor(chunk) })}</button>
        <button onClick={() => void spreadBacklog(cards).then(() => onChunk(Math.ceil(n / 7)))} className="flex h-[38px] items-center justify-center rounded-[8px] border border-line hover:bg-surface-2">{t("Spread over {n} days", { n: 7 })}</button>
        <button onClick={onAll} className="flex h-8 items-center justify-center text-muted hover:text-ink">{t("Review all {n}", { n: fmtNum(n) })}</button>
        <button onClick={onExit} className="self-center text-[12px] text-muted hover:text-ink">{t("Not now")}</button>
      </div>
    </div>
  );
}
