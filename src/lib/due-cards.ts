// Due flashcards (Review view, Review mode, Today, Home, the sidebar / tab-bar / favicon badges).
// Lives outside components/Review.tsx so the badges don't pull the review screen (and OcclusionEditor) into the
// start-up bundle. All callers share one live query on db.cards instead of one each.
import { liveQuery } from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useSyncExternalStore } from "react";
import type { Card, Note } from "../../shared/types";
import { db } from "./db";
import { memoryOf, type FsrsCard } from "./fsrs";
import { flashcards, hash, type Flashcard } from "./parse";
import { useSettings } from "./settings";
import { newCard } from "./srs";
import { noteDerived, useVaultSelector } from "./store";

/** A flashcard plus the reversed pair from `Front ::: Back` lines (rev 1 = front → back, rev 2 = back → front). */
export type DeckCard = Flashcard & { rev?: 1 | 2 };
export interface DueItem { note: Note; fc: DeckCard; card: Card }
/** Review-only card fields (stored in the synced card record): flag (F) and bury-until (B, Anki "bury"). */
export type CardExtra = Card & { flagged?: 0 | 1; buriedUntil?: number };

/** `Front ::: Back` (Lumen 57 "Reversed" card type): two cards, one each way. Fenced code is skipped. */
export function reversedCards(md: string): DeckCard[] {
  const out: DeckCard[] = [];
  let fence = false;
  md.split("\n").forEach((l, line) => {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
    if (fence) return;
    const m = /^(?:[-*]\s+)?(.+?)\s+:::\s+(.+)$/.exec(l);
    if (!m) return;
    const q = m[1].trim(), a = m[2].trim();
    out.push({ q, a, key: `rv1-${hash(q)}`, line, rev: 1 }, { q: a, a: q, key: `rv2-${hash(q)}`, line, rev: 2 });
  });
  return out;
}
/** Every card of a note: Q :: A, Q ? A, cloze, image occlusion (parse.ts) and reversed pairs. Cached per note body. */
export const deckCards = (n: Note): DeckCard[] => noteDerived("deckcards", n, (x) => [...flashcards(x.body), ...reversedCards(x.body)]);

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
/** Every stored card record (shared live query). */
export const useCards = () => useSyncExternalStore(subscribeCards, () => cards);

const buried = (c: Card, now: number) => ((c as CardExtra).buriedUntil ?? 0) > now;

/** Every card of these notes with its record (new cards get a fresh record). Suspended and deleted cards are left out. */
export function useCardItems(notes: Note[]): DueItem[] | null {
  const all = useCards();
  return useMemo(() => {
    if (!all) return null;
    const map = new Map(all.map((c) => [c.id, c]));
    const out: DueItem[] = [];
    for (const n of notes) {
      if (n.type === "canvas") continue;
      for (const fc of deckCards(n)) {
        const id = `${n.id}:${fc.key}`;
        const card = map.get(id) ?? newCard(id, n.id);
        if (card.suspended || card.deleted) continue;
        out.push({ note: n, fc, card });
      }
    }
    return out;
  }, [all, notes]);
}

// Callers passing the same inputs (the badges + Today + Home all pass the whole vault) share one computed list.
let last: { notes: Note[]; cards: Card[]; includeNew: boolean; perDay: number; started: number; at: number; out: DueItem[] } | null = null;

/** Collect due cards for some notes (one note in Review mode, or all notes in the Review view). Suspended and buried cards never count. */
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
      for (const fc of deckCards(n)) {
        const id = `${n.id}:${fc.key}`;
        const card = map.get(id) ?? newCard(id, n.id);
        if (card.suspended || card.deleted || buried(card, now)) continue;
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
