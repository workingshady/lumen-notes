// Review hub decks (Lumen 57 · ReviewStudio). Pure helpers: no React, no DB writes.
//
// Cards live in notes; decks are views over them. A card can sit in a space deck, a plan deck, a tag deck and a type
// deck at once, but it is reviewed once a day whichever deck is opened (the due list is shared, see due-cards.ts).
//   Group by  Space → one deck per note with cards, under its space
//             Plan  → course / project roadmaps: one deck per topic with a linked lesson note, current module first
//             Tag   → one deck per note tag
//             Type  → Basic, Reversed (`Front ::: Back`), Cloze, Image occlusion, Listening (audio in the question)
//   Smart decks: Leeches (missed LEECH_LAPSES+ times) and Due soon (next DUE_SOON_DAYS days).
// Custom study (customQueue) is a preview session (Anki filtered deck with "reschedule" off): it never writes cards
// or the review log, so the real FSRS schedule stays as it was.
import type { Card, Note, ReviewLog, Space } from "../../shared/types";
import type { DueItem } from "./due-cards";
import { memoryOf, type FsrsCard } from "./fsrs";
import { roadmap } from "./parse";
import { spaceColor } from "./space-icon";
import { t, tk } from "./i18n";

export const LEECH_LAPSES = 4;
export const DUE_SOON_DAYS = 3;
export const DAY = 86_400_000;
const MIN = 60_000;
/** Design colours for card types / plan + tag fallbacks (ReviewStudio `C`). */
export const DC = { dl: "#B48EF0", en: "#5CC8C2", ex: "#E8893A", th: "#7AA2F7", ph: "#6BCB8B" };
const PALETTE = [DC.ex, DC.th, DC.dl, DC.en, DC.ph, "#E8B34A"];
const AUDIO = /\.(mp3|m4a|wav|ogg|oga|opus|aac|flac)\b|<audio\b/i;

export type CardKind = "basic" | "reversed" | "cloze" | "occlusion" | "listening";
export const KIND: Record<CardKind, { l: string; glyph: string; c: string }> = {
  basic: { l: tk("Basic Q → A"), glyph: "flashcards", c: DC.th },
  reversed: { l: tk("Reversed"), glyph: "switch", c: DC.th },
  cloze: { l: tk("Cloze"), glyph: "cloze", c: DC.dl },
  occlusion: { l: tk("Image occlusion"), glyph: "image", c: DC.dl },
  listening: { l: tk("Listening"), glyph: "headphones", c: DC.en },
};
export const SHORT_KIND: Record<CardKind, string> = { basic: tk("Basic"), reversed: tk("Reversed"), cloze: tk("Cloze"), occlusion: tk("Image occlusion"), listening: tk("Listening") };
export function kindOf(it: Pick<DueItem, "fc">): CardKind {
  if (it.fc.kind === "occlusion") return "occlusion";
  if (it.fc.kind === "cloze") return "cloze";
  if (AUDIO.test(it.fc.q)) return "listening";
  return it.fc.rev ? "reversed" : "basic";
}
export const stateOf = (c: Card, now: number) => memoryOf(c as FsrsCard, now).state;
export const isLeech = (c: Card) => c.lapses >= LEECH_LAPSES;

// ------------------------------------------------------------------ interval text ("1 min", "4 days")
/** Long interval for the rating buttons (design: "1 min · 8 min · 4 days · 11 days"). */
export function fmtIntervalLong(ms: number) {
  const m = ms / MIN;
  if (m < 60) return t("{n} min", { n: Math.max(1, Math.round(m)) });
  if (m < 1440) return t("{n} hour|{n} hours", { n: Math.round(m / 60) });
  const d = Math.round(m / 1440);
  if (d < 31) return t("{n} day|{n} days", { n: d });
  if (d < 365) return t("{n} month|{n} months", { n: Math.round(d / 30) });
  return t("{n} year|{n} years", { n: +(d / 365).toFixed(1) });
}

// ------------------------------------------------------------------ stats
export interface Stat { total: number; n: number; l: number; d: number; ret: number | null }
/** Retention per card over 30 days: [passed, reviewed] counting only reviews of cards in review state (true retention). */
export function retentionMap(logs: ReviewLog[], now: number) {
  const m = new Map<string, [number, number]>();
  for (const r of logs) {
    if (r.deleted || r.at < now - 30 * DAY || r.state !== "review") continue;
    const x = m.get(r.cardId) ?? [0, 0];
    x[1]++; if (r.grade > 0) x[0]++;
    m.set(r.cardId, x);
  }
  return m;
}
export interface Ctx { now: number; due: Map<string, DueItem>; ret: Map<string, [number, number]> }
export function statOf(items: DueItem[], cx: Ctx): Stat {
  const s: Stat = { total: items.length, n: 0, l: 0, d: 0, ret: null };
  let ok = 0, all = 0;
  for (const it of items) {
    const r = cx.ret.get(it.card.id);
    if (r) { ok += r[0]; all += r[1]; }
    if (!cx.due.has(it.card.id)) continue;
    const st = stateOf(it.card, cx.now);
    if (st === "new") s.n++; else if (st === "review") s.d++; else s.l++;
  }
  s.ret = all ? ok / all : null;
  return s;
}

// ------------------------------------------------------------------ decks
export type Group = "Space" | "Plan" | "Tag" | "Type";
export const GROUPS: Group[] = ["Space", "Plan", "Tag", "Type"];
export const GROUP_LABEL: Record<Group, string> = { Space: tk("Space"), Plan: tk("Plan"), Tag: tk("Tag"), Type: tk("Type") };
export type Row =
  | { kind: "head"; id: string; h: string; c: string; hn: string }
  | { kind: "deck"; id: string; glyph: string; label: string; sub: string; c: string; top?: boolean; smart?: "leech" | "soon"; items: DueItem[]; stat: Stat };

const cardsText = (n: number) => t("{n} card|{n} cards", { n });
/** Most common card kind of a deck → its glyph (cloze deck, occlusion deck…). */
function deckGlyph(items: DueItem[]) {
  const c = new Map<CardKind, number>();
  for (const it of items) { const k = kindOf(it); c.set(k, (c.get(k) ?? 0) + 1); }
  const top = [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "basic";
  return top === "basic" ? "flashcards" : KIND[top].glyph;
}
const tagColor = (tag: string) => { let h = 0; for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return /mistake|wrong|error/i.test(tag) ? "var(--da)" : PALETTE[h % PALETTE.length]; };

export interface DeckInput { items: DueItem[]; spaces: Space[]; notes: Note[]; cx: Ctx }

export function buildRows(group: Group, inp: DeckInput): Row[] {
  const { items, spaces, cx } = inp;
  const deck = (id: string, glyph: string, label: string, sub: string, c: string, its: DueItem[], o: { top?: boolean; smart?: "leech" | "soon" } = {}): Row => ({ kind: "deck", id, glyph, label, sub, c, items: its, stat: statOf(its, cx), ...o });
  const head = (id: string, h: string, c: string, hn = ""): Row => ({ kind: "head", id, h, c, hn });
  const byNote = new Map<string, DueItem[]>();
  for (const it of items) { const a = byNote.get(it.note.id); if (a) a.push(it); else byNote.set(it.note.id, [it]); }
  const rows: Row[] = [head("all", t("ALL"), "var(--ac)")];
  if (group === "Space") {
    rows.push(deck("all", "flashcards", t("All decks"), `${cardsText(items.length)} · ${t("{n} deck|{n} decks", { n: byNote.size })}`, "var(--ac)", items, { top: true }));
    const bySpace = new Map<string, Note[]>();
    for (const id of byNote.keys()) { const n = byNote.get(id)![0].note; const a = bySpace.get(n.spaceId); if (a) a.push(n); else bySpace.set(n.spaceId, [n]); }
    const order = [...spaces].sort((a, b) => a.sort - b.sort);
    const known = new Set(order.map((s) => s.id));
    const sp = [...order.filter((s) => bySpace.has(s.id)).map((s) => ({ id: s.id, name: s.name, c: spaceColor(s) })), ...[...bySpace.keys()].filter((id) => !known.has(id)).map((id) => ({ id, name: t("Other"), c: "var(--mu)" }))];
    for (const s of sp) {
      // Decks with cards to study first (so the smart decks aren't pushed off the screen by empty ones), then by title.
      const busy = (n: Note) => { const x = statOf(byNote.get(n.id)!, cx); return x.d + x.l; };
      const ns = bySpace.get(s.id)!.sort((a, b) => busy(b) - busy(a) || a.title.localeCompare(b.title));
      rows.push(head(`s:${s.id}`, s.name, s.c, t("{n} deck|{n} decks", { n: ns.length })));
      for (const n of ns) { const its = byNote.get(n.id)!; rows.push(deck(`n:${n.id}`, deckGlyph(its), n.title, cardsText(its.length), s.c, its)); }
    }
    rows.push(head("smart", t("SMART DECKS"), "var(--mu)"));
    const leech = items.filter((it) => isLeech(it.card));
    rows.push(deck("leech", "c-warning", t("Leeches · missed {n}+ times", { n: LEECH_LAPSES }), cardsText(leech.length), "var(--da)", leech, { smart: "leech" }));
    const soon = items.filter((it) => it.card.due > cx.now && it.card.due <= cx.now + DUE_SOON_DAYS * DAY);
    rows.push(deck("soon", "clock", t("Due soon · next {n} days", { n: DUE_SOON_DAYS }), cardsText(soon.length), "var(--mu)", soon, { smart: "soon" }));
  } else if (group === "Plan") {
    rows.push(deck("all", "flashcards", t("All plans"), cardsText(items.length), "var(--ac)", items, { top: true }));
    const byTitle = new Map<string, Note[]>();
    for (const n of inp.notes) { const k = n.title.trim().toLowerCase(); const a = byTitle.get(k); if (a) a.push(n); else byTitle.set(k, [n]); }
    const noteMap = new Map(inp.notes.map((n) => [n.id, n]));
    for (const s of [...spaces].sort((a, b) => a.sort - b.sort)) {
      const rm = s.roadmapId ? noteMap.get(s.roadmapId) : null;
      if (!rm || s.archived) continue;
      const mods = roadmap(rm.body).map((m) => ({ m, decks: m.topics.flatMap((tp) => {
        if (!tp.note) return [];
        const cands = byTitle.get(tp.note.trim().toLowerCase()) ?? [];
        const n = cands.find((x) => x.spaceId === s.id) ?? cands[0];
        const its = n ? byNote.get(n.id) : undefined;
        return its?.length ? [{ tp, n: n!, its }] : [];
      }) }));
      const cur = mods.findIndex(({ m }) => m.topics.some((tp) => tp.status === "todo" || tp.status === "learning"));
      const ordered = cur > 0 ? [mods[cur], ...mods.filter((_, i) => i !== cur)] : mods;
      const c = spaceColor(s);
      for (const { m, decks } of ordered) {
        if (!decks.length) continue;
        rows.push(head(`p:${s.id}:${m.line}`, `${s.name} · ${m.name}`, c, mods[cur] && mods[cur].m === m ? t("current") : ""));
        for (const d of decks) rows.push(deck(`pt:${d.n.id}:${m.line}`, "lesson", d.tp.name, cardsText(d.its.length), c, d.its));
      }
    }
  } else if (group === "Tag") {
    rows.push(deck("all", "flashcards", t("All tags"), cardsText(items.length), "var(--ac)", items, { top: true }));
    const byTag = new Map<string, DueItem[]>();
    for (const its of byNote.values()) for (const tag of its[0].note.tags ?? []) { const a = byTag.get(tag); if (a) a.push(...its); else byTag.set(tag, [...its]); }
    rows.push(head("tags", t("TAGS"), "var(--mu)"));
    for (const [tag, its] of [...byTag].sort((a, b) => b[1].length - a[1].length)) rows.push(deck(`t:${tag}`, "tag", `#${tag}`, cardsText(its.length), tagColor(tag), its));
  } else {
    rows.push(deck("all", "flashcards", t("All types"), cardsText(items.length), "var(--ac)", items, { top: true }));
    rows.push(head("types", t("CARD TYPE"), "var(--mu)"));
    const byKind = new Map<CardKind, DueItem[]>((Object.keys(KIND) as CardKind[]).map((k) => [k, []]));
    for (const it of items) byKind.get(kindOf(it))!.push(it);
    for (const [k, its] of byKind) rows.push(deck(`k:${k}`, KIND[k].glyph, t(KIND[k].l), cardsText(its.length), KIND[k].c, its));
  }
  return rows;
}

/** Session queue for a deck: its due cards in due order (shared new-card limit). Smart decks study all their cards. */
export function deckQueue(row: Extract<Row, { kind: "deck" }>, dueList: DueItem[]): DueItem[] {
  if (row.smart === "leech") return [...row.items].sort((a, b) => b.card.lapses - a.card.lapses);
  if (row.smart === "soon") return [...row.items].sort((a, b) => a.card.due - b.card.due);
  const ids = new Set(row.items.map((x) => x.card.id));
  return dueList.filter((x) => ids.has(x.card.id));
}

// ------------------------------------------------------------------ custom study
export const WHICH = [tk("Due"), tk("Forgotten in last 7 days"), tk("New only"), tk("Leeches"), tk("All, ignore schedule")] as const;
export const ORDER = [tk("Interleave decks"), tk("Deck by deck"), tk("Hardest first"), tk("Random")] as const;
export const LIMIT = ["20", "50", "100", tk("No limit"), tk("15 min")] as const;
export interface CustomOpts { from: string[]; which: number; order: number; limit: number }
/** Source keys: `s:<spaceId>`, `t:<tag>`, `n:<noteId>`. Empty = everything. */
export function inSource(it: DueItem, from: string[]) {
  if (!from.length) return true;
  return from.some((f) => (f.startsWith("s:") ? it.note.spaceId === f.slice(2) : f.startsWith("t:") ? (it.note.tags ?? []).includes(f.slice(2)) : it.note.id === f.slice(2)));
}
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
/** Cards matching the custom-study options (before the limit), in the chosen order. */
export function customMatch(items: DueItem[], o: CustomOpts, forgotten: Set<string>, now: number): DueItem[] {
  let m = items.filter((it) => inSource(it, o.from));
  m = m.filter((it) => {
    const st = stateOf(it.card, now);
    switch (o.which) {
      case 0: return it.card.due <= now;
      case 1: return forgotten.has(it.card.id);
      case 2: return st === "new";
      case 3: return isLeech(it.card);
      default: return true;
    }
  });
  if (o.order === 2) return m.sort((a, b) => (b.card.difficulty ?? 0) - (a.card.difficulty ?? 0) || b.card.lapses - a.card.lapses);
  if (o.order === 3) return shuffle(m);
  m.sort((a, b) => a.note.title.localeCompare(b.note.title) || a.card.due - b.card.due);
  if (o.order === 1) return m;
  // Interleave: one card from each deck in turn.
  const decks = new Map<string, DueItem[]>();
  for (const it of m) { const a = decks.get(it.note.id); if (a) a.push(it); else decks.set(it.note.id, [it]); }
  const lists = [...decks.values()], out: DueItem[] = [];
  for (let i = 0; out.length < m.length; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}
export const limitCount = (o: CustomOpts) => [20, 50, 100, Infinity, Infinity][o.limit] ?? Infinity;
export const limitMs = (o: CustomOpts) => (o.limit === 4 ? 15 * MIN : 0);

// ------------------------------------------------------------------ hub numbers
/** Cards due on each of the next 7 days (day 0 = due now + later today). */
export function forecast(items: DueItem[], dueNow: number, now: number) {
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const start = d0.getTime();
  const out = [dueNow, 0, 0, 0, 0, 0, 0];
  for (const it of items) {
    const d = it.card.due;
    if (!it.card.reps && !it.card.lastReview) continue; // new cards aren't "due" on a day
    if (d <= now) continue;
    const k = Math.floor((d - start) / DAY);
    if (k >= 0 && k < 7) out[k]++;
  }
  return out.map((n, i) => ({ n, day: start + i * DAY }));
}
/** Average seconds per review from the log (`took`), else 8 s. */
export function secPerCard(logs: ReviewLog[]) {
  const ts = logs.map((r) => (r as ReviewLog & { took?: number }).took).filter((x): x is number => !!x && x > 0);
  if (ts.length < 5) return 8;
  return Math.min(60, Math.max(3, ts.reduce((a, b) => a + b, 0) / ts.length / 1000));
}
/** Minutes a day spent reviewing, averaged over days with reviews in the last 30 days. */
export function avgMinutesPerDay(logs: ReviewLog[], now: number) {
  const sec = secPerCard(logs);
  const days = new Map<string, number>();
  for (const r of logs) {
    if (r.deleted || r.at < now - 30 * DAY) continue;
    const k = new Date(r.at).toDateString();
    const took = (r as ReviewLog & { took?: number }).took;
    days.set(k, (days.get(k) ?? 0) + (took ? took / 1000 : sec));
  }
  if (!days.size) return 0;
  return Math.round([...days.values()].reduce((a, b) => a + b, 0) / days.size / 60);
}
