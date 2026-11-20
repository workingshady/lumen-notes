// Due flashcards (Review view, Review mode, Today, Home, the sidebar / tab-bar / favicon badges).
// Lives outside components/Review.tsx so the badges don't pull the review screen (and OcclusionEditor) into the
// start-up bundle. All callers share one live query on db.cards instead of one each.
import { liveQuery } from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useSyncExternalStore } from "react";
import type { Card, Note } from "../../shared/types";
import { db } from "./db";
import { memoryOf, type FsrsCard } from "./fsrs";
import { flashcards, type Flashcard } from "./parse";
import { useSettings } from "./settings";
import { newCard } from "./srs";
import { noteDerived, useVaultSelector } from "./store";

export interface DueItem { note: Note; fc: Flashcard; card: Card }

let cards: Card[] | undefined;
let cardsStarted = false;
const cardSubs = new Set<() => void>();
function subscribeCards(f: () => void) {
  cardSubs.add(f);
  if (!cardsStarted) {
    cardsStarted = true;
    liveQuery(() => db.cards.toArray()).subscribe({ next: (v) => { cards = v; cardSubs.forEach((g) => g()); }, error: (e) => console.error("cards query failed", e) });
  }
  return () => { cardSubs.delete(f); };
}
const useCards = () => useSyncExternalStore(subscribeCards, () => cards);

// Callers passing the same inputs (the badges + Today + Home all pass the whole vault) share one computed list.
let last: { notes: Note[]; cards: Card[]; includeNew: boolean; perDay: number; started: number; at: number; out: DueItem[] } | null = null;

/** Collect due cards for some notes (one note in Review mode, or all notes in the Review view). Suspended cards never count. */
export function useDueCards(notes: Note[], includeNew = true) {
  const cards = useCards();
  // Settings › Review › New cards a day (0 = no limit): new cards already started today (review log) count against it.
  const perDay = useSettings().fsrsNewPerDay ?? 0;
  const startedToday = useLiveQuery(() => (perDay > 0 ? db.reviews.where("at").aboveOrEqual(new Date().setHours(0, 0, 0, 0)).filter((r) => r.state === "new" && !r.deleted).count() : 0), [perDay, cards]);
  return useMemo(() => {
    if (!cards || startedToday === undefined) return null;
    const l = last;
    if (l && l.notes === notes && l.cards === cards && l.includeNew === includeNew && l.perDay === perDay && l.started === startedToday && Date.now() - l.at < 60_000) return l.out;
    const map = new Map(cards.map((c) => [c.id, c]));
    const now = Date.now();
    const out: DueItem[] = [];
    for (const n of notes) {
      if (n.type === "canvas") continue;
      for (const fc of noteDerived("flashcards", n, (x) => flashcards(x.body))) {
        const id = `${n.id}:${fc.key}`;
        const card = map.get(id) ?? newCard(id, n.id);
        if (card.suspended) continue;
        if (card.due <= now && (includeNew || card.reps > 0)) out.push({ note: n, fc, card });
      }
    }
    out.sort((a, b) => a.card.due - b.card.due);
    let res = out;
    if (perDay > 0) {
      let left = Math.max(0, perDay - startedToday);
      res = out.filter((x) => memoryOf(x.card as FsrsCard, now).state !== "new" || left-- > 0);
    }
    last = { notes, cards, includeNew, perDay, started: startedToday, at: now, out: res };
    return res;
  }, [cards, notes, includeNew, perDay, startedToday]);
}

/** Number of due cards in the whole vault (badges). */
export function useDueCount(): number {
  const notes = useVaultSelector((v) => v.notes);
  return useDueCards(notes)?.length ?? 0;
}
