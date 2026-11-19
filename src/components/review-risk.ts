// Forgetting risk of a due card (1 − retrievability now): sorts backlogs so the cards you'd lose first come first.
import type { Card } from "../../shared/types";
import { memoryOf, retrievability, type FsrsCard } from "../lib/fsrs";

export const DAY_MS = 86_400_000;
export function riskOf(c: Card, now: number) {
  const m = memoryOf(c as FsrsCard, now);
  if (m.state === "new" || !m.s) return 0.5;
  return 1 - retrievability(Math.max(0, (now - m.last) / DAY_MS), m.s);
}
