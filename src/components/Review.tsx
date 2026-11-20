// Review session (Lumen 57F–I, 57K–L · ReviewStudio screens "q", "a", "cloze", "done"), ported 1:1 from
// design/handoffs/2026-11-21-round-8/ReviewStudio.dc.html and wired to FSRS-6 (lib/fsrs.ts) + the synced review log.
// Normal sessions grade with FSRS and write the card + a "review" log entry; custom study (`cram`) is a preview
// session (Anki filtered deck with rescheduling off): ratings only reorder this session, nothing is written.
import { useLiveQuery } from "dexie-react-hooks";
import { riskOf } from "./review-risk";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Card, Note, ReviewLog } from "../../shared/types";
import { db, patch, save, uid } from "../lib/db";
import { useCardItems, useDueCards, type CardExtra, type DueItem } from "../lib/due-cards";
import { clozeEnabled, clozeSides } from "../lib/cloze";
import { OcclusionImage } from "./OcclusionEditor";
import { inSteps, memoryOf, scheduleAll, userParams, type FsrsCard, type Grade } from "../lib/fsrs";
import { getSettings } from "../lib/settings";
import { schedule as sm2Schedule, previewIntervals as sm2Preview, newCard } from "../lib/srs";
import { go, openNote, toast, useVault } from "../lib/store";
import { Preview } from "./Preview";
import { cardLine, openNoteAtLine } from "./study-nav";
import { EmptyState } from "./EmptyState";
import { Glyph } from "./Glyph";
import type { GlyphName } from "../lib/glyphs";
import { fmtIntervalLong, kindOf, SHORT_KIND, stateOf } from "../lib/review-decks";
import { spaceColor } from "../lib/space-icon";
import { fmtNum, t, tk } from "../lib/i18n";
import { RV_CSS, TOKENS, usePhone, useStreak } from "./review/shared";

type Item = DueItem;
export { useDueCards } from "../lib/due-cards";

const DAY = 86_400_000;
const EMPTY: Note[] = [];
const RATE = [
  { l: tk("Again"), c: "var(--da)" },
  { l: tk("Hard"), c: "var(--wa)" },
  { l: tk("Good"), c: "var(--ok)" },
  { l: tk("Easy"), c: "var(--ln)" },
] as const;
const STATE: Record<string, string> = { new: tk("new"), learning: tk("learning"), review: tk("review"), relearning: tk("relearning") };
const sm2 = () => (getSettings() as { srsAlgo?: string }).srsAlgo === "sm2";
/** The empty state's next-due sentence. */
const nextWhen = (at: number) => { const d = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / DAY); return d <= 0 ? t("No cards due. Next ones later today.") : d === 1 ? t("No cards due. Next ones tomorrow.") : t("No cards due. Next ones in {n} day.|No cards due. Next ones in {n} days.", { n: d }); };
/** Paragraph number (1-based) of a 0-based line: blank-line separated blocks, front matter skipped. */
function paragraphOf(body: string, line: number) {
  const ls = body.split("\n");
  let i = 0;
  if (ls[0]?.trim() === "---") { i = ls.findIndex((l, k) => k > 0 && l.trim() === "---") + 1; }
  let n = 0, prevBlank = true;
  for (; i <= line && i < ls.length; i++) { const blank = !ls[i].trim(); if (!blank && prevBlank) n++; prevBlank = blank; }
  return Math.max(1, n);
}
const plain = (s: string) => s.replace(/\{\{c\d+::([^}:]*)(::[^}]*)?\}\}/g, "$1").replace(/[*_`#$=]/g, "").split("\n")[0].trim();

type Step = { item: Item; prev: Card; wrote: boolean; log?: string; queue: Item[]; done: number; stats: number[]; again: [string, { n: number; q: string; c: string }][] };

export interface ReviewSessionProps {
  /** Review the due cards of these notes (Review mode of a note). */
  notes?: Note[];
  /** Or an explicit queue (hub decks, custom study). */
  items?: Item[];
  /** Cards to draw "Practice anyway" / "Study 10 new" from (defaults to every card of `notes`). */
  pool?: Item[];
  title?: string;
  onExit?: () => void;
  /** Backlog: only the `limit` cards most likely forgotten (Lumen 22). */
  limit?: number;
  /** Custom study: preview only, the schedule never changes. */
  cram?: boolean;
  /** Custom study "15 min": end the session after this many ms. */
  timeLimit?: number;
}

export function ReviewSession({ notes, items, pool: poolIn, title, onExit, limit, cram, timeLimit }: ReviewSessionProps) {
  const v = useVault();
  const phone = usePhone();
  const dueOfNotes = useDueCards(notes ?? EMPTY);
  const notePool = useCardItems(notes ?? EMPTY);
  const source = items ?? dueOfNotes;
  const pool = useMemo(() => poolIn ?? notePool ?? [], [poolIn, notePool]);
  const [queue, setQueue] = useState<Item[] | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);
  const [stats, setStats] = useState([0, 0, 0, 0]);
  const [started, setStarted] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [menu, setMenu] = useState(false);
  const [, force] = useState(0);
  const again = useRef(new Map<string, { n: number; q: string; c: string }>());
  const againItems = useRef(new Map<string, Item>());
  const seen = useRef(new Set<string>());
  const history = useRef<Step[]>([]);
  const touch = useRef<number | null>(null);
  const shownAt = useRef(Date.now());

  useEffect(() => {
    if (source && queue === null) {
      const now = Date.now();
      setQueue(limit ? [...source].sort((a, b) => riskOf(b.card, now) - riskOf(a.card, now)).slice(0, limit) : source);
      setStarted(now);
    }
  }, [source, queue]); // eslint-disable-line react-hooks/exhaustive-deps
  const streak = useStreak(done);
  const cur = queue?.[0];
  useEffect(() => { shownAt.current = Date.now(); setMenu(false); }, [cur?.card.id, queue?.length]);

  // Scope of this session (its notes) for the summary: still due today, due tomorrow.
  const scopeNotes = useMemo(() => notes ?? [...new Map(pool.map((x) => [x.note.id, x.note])).values()], [notes, pool]);
  const scopeDue = useDueCards(scopeNotes);
  const ids = useMemo(() => new Set(scopeNotes.map((n) => n.id)), [scopeNotes]);
  const tomorrow = useLiveQuery(async () => {
    const a = new Date(); a.setHours(0, 0, 0, 0); a.setDate(a.getDate() + 1);
    const b = a.getTime() + DAY;
    return (await db.cards.where("due").between(a.getTime(), b).toArray()).filter((c) => ids.has(c.noteId) && !c.suspended && !c.deleted).length;
  }, [ids, done]);

  const deckOf = (it: Item) => { const s = v.spaceMap.get(it.note.spaceId); return { label: s ? `${s.name} · ${it.note.title}` : it.note.title, c: s ? spaceColor(s) : "var(--le)" }; };
  const fresh = (it: Item) => !seen.current.has(it.card.id);
  const upcoming = useMemo(() => pool.filter((x) => x.card.due > Date.now() && fresh(x)).sort((a, b) => a.card.due - b.card.due).slice(0, 20), [pool, queue]); // eslint-disable-line react-hooks/exhaustive-deps
  const newLeft = useMemo(() => pool.filter((x) => fresh(x) && stateOf(x.card, Date.now()) === "new"), [pool, queue]); // eslint-disable-line react-hooks/exhaustive-deps

  function restart(q: Item[]) {
    setQueue(q); setDone(0); setStats([0, 0, 0, 0]); setStarted(Date.now()); setElapsed(0); setFlipped(false);
    again.current.clear(); againItems.current.clear(); history.current = [];
  }
  const snapshot = (item: Item, wrote = true): Step => ({ item, prev: item.card, wrote, queue: queue!, done, stats, again: [...again.current] });
  const replaceCur = (card: Card) => setQueue((q) => (q ? q.map((x) => (x.card.id === card.id ? { ...x, card } : x)) : q));

  async function grade(g: Grade) {
    if (!cur) return;
    const at = Date.now();
    history.current.push(snapshot(cur, !cram));
    seen.current.add(cur.card.id);
    setStats((s) => s.map((x, i) => (i === g ? x + 1 : x)));
    if (g === 0) {
      const a = again.current.get(cur.card.id);
      again.current.set(cur.card.id, { n: (a?.n ?? 0) + 1, q: cur.fc.q, c: deckOf(cur).c });
      againItems.current.set(cur.card.id, cur);
    }
    setFlipped(false);
    if (cram) {
      // Preview: Again comes back after 3 cards, Hard at the end, Good / Easy leave the session. Nothing is written.
      setQueue((q) => { const rest = q!.slice(1); if (g === 0) return [...rest.slice(0, 3), cur, ...rest.slice(3)]; if (g === 1) return [...rest, cur]; return rest; });
      if (g > 1) setDone((d) => d + 1);
    } else {
      // FSRS-6 (lib/fsrs.ts); SM-2 cards migrate here on their first FSRS review.
      const prevMem = memoryOf(cur.card as FsrsCard, at);
      const next = { ...(sm2() ? sm2Schedule(cur.card, g, at) : scheduleAll(cur.card, at, userParams(getSettings()))[g]), flagged: (cur.card as CardExtra).flagged } as Card;
      await save("card", next);
      // Review log (synced as kind "review"): feeds Settings › Review › Optimize, the new-cards limit and the hub stats.
      const log = uid();
      history.current[history.current.length - 1].log = log;
      const took = Math.min(5 * 60_000, at - shownAt.current);
      await save("review", { id: log, cardId: cur.card.id, noteId: cur.card.noteId, at, grade: g, state: prevMem.state,
        elapsed: prevMem.state === "new" ? 0 : +((at - prevMem.last) / DAY).toFixed(4), scheduled: +((next.due - at) / DAY).toFixed(4), took, updatedAt: at, deleted: 0 } as ReviewLog);
      // "Again" and cards still in their minute-long learning steps come back later in this session (Anki-style).
      const requeue = g === 0 || inSteps(next);
      setQueue((q) => { const rest = q!.slice(1); return requeue ? [...rest, { ...cur, card: next }] : rest; });
      if (!requeue) setDone((d) => d + 1);
    }
    setElapsed(at - started);
    if (timeLimit && at - started >= timeLimit) { setQueue([]); toast(t("Time is up · {n} min", { n: Math.round(timeLimit / 60_000) })); }
  }

  async function remove(kind: "suspend" | "bury" | "forget") {
    if (!cur) return;
    history.current.push(snapshot(cur));
    const c = cur.card as CardExtra;
    if (kind === "suspend") await save("card", { ...c, suspended: 1 });
    else if (kind === "bury") { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); d.setHours(4); await save("card", { ...c, buriedUntil: d.getTime() } as Card); }
    else await save("card", { ...newCard(c.id, c.noteId), flagged: c.flagged } as Card);
    setFlipped(false);
    setQueue((q) => q!.slice(1).filter((x) => x.card.id !== cur.card.id));
    toast(kind === "suspend" ? t("Card suspended") : kind === "bury" ? t("Card buried until tomorrow") : t("Card reset to new"), { label: t("Undo"), run: () => void undo() });
  }

  async function flag() {
    if (!cur) return;
    const c = cur.card as CardExtra;
    const next = { ...c, flagged: c.flagged ? 0 : 1 } as Card;
    await save("card", next);
    replaceCur(next);
    toast(c.flagged ? t("Flag removed") : t("Card flagged"));
  }

  async function undo() {
    const s = history.current.pop();
    if (!s) return;
    if (s.log) await patch("review", s.log, { deleted: 1 }); // an undone grade leaves the review log
    // Put the card back exactly as it was (a never-reviewed card goes back to "new"). A cram grade wrote nothing.
    if (s.wrote) await save("card", s.prev);
    again.current = new Map(s.again);
    seen.current.delete(s.item.card.id);
    setQueue(s.queue);
    setDone(s.done);
    setStats(s.stats);
    setFlipped(false);
    force((x) => x + 1);
  }

  const lineOf = (it: Item) => it.fc.line ?? cardLine(it.note.body, it.fc.q);
  function edit() {
    if (!cur) return;
    const line = lineOf(cur);
    if (line >= 0) openNoteAtLine(cur.note.id, line, cur.note.body);
    else openNote(cur.note.id, "edit");
  }
  function redoAgain() {
    const list = [...againItems.current.values()];
    void db.cards.bulkGet(list.map((x) => x.card.id)).then((cards) => restart(list.map((x, k) => ({ ...x, card: cards[k] ?? x.card }))));
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,.cm-editor") || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "u" || key === "z") { e.preventDefault(); void undo(); return; }
      if (e.key === "Escape") { if (menu) setMenu(false); else onExit?.(); return; }
      if (!cur) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); setFlipped((f) => !f); }
      else if (flipped && ["1", "2", "3", "4"].includes(e.key)) void grade((Number(e.key) - 1) as Grade);
      else if (key === "e") { e.preventDefault(); edit(); }
      else if (key === "f") { e.preventDefault(); void flag(); }
      else if (key === "b") { e.preventDefault(); void remove("bury"); }
      else if (key === "s") { e.preventDefault(); void remove("suspend"); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  if (!queue) return null;
  const root = (children: React.ReactNode) => (
    <div className="rv57" style={{ ...TOKENS, position: "relative", height: "100%", overflow: "hidden", background: "var(--bg)", fontFamily: "Inter,system-ui,sans-serif", fontSize: 13, color: "var(--tx)", display: "flex", flexDirection: "column" }}>
      {children}<style>{RV_CSS}</style>
    </div>
  );
  const closeBtn = (
    <button type="button" onClick={() => (onExit ? onExit() : go("review"))} aria-label={t("Close review")} className="rv-hover" style={{ width: 36, height: 36, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "var(--mu)", flexShrink: 0 }}>×</button>
  );

  // ---------------------------------------------------------------- empty / done
  if (!cur) {
    if (!done && !stats.some(Boolean)) return root(
      <div className="relative h-full">
        <div className="safe-t" style={{ position: "absolute", insetInlineStart: phone ? 12 : 28, top: phone ? 4 : 16 }}>{closeBtn}</div>
        {upcoming.length
          ? <EmptyState className="h-full" glyph="flashcards" text={nextWhen(upcoming[0].card.due)} action={{ label: t("Practice anyway"), onClick: () => restart(upcoming) }} />
          : <EmptyState className="h-full" glyph="flashcards" text={t("No cards yet. Write Question :: Answer in any note.")} action={onExit ? { label: t("Back"), onClick: onExit } : undefined} />}
      </div>
    );
    const graded = stats.reduce((a, b) => a + b, 0) || 1;
    const correct = Math.round(((graded - stats[0]) / graded) * 100);
    const mins = Math.max(1, Math.round(elapsed / 60_000));
    const missed = [...again.current.values()].sort((a, b) => b.n - a.n).slice(0, 3);
    const allDone = !cram && (scopeDue?.length ?? 0) === 0;
    const doneStats: [string, string, string][] = [[fmtNum(done), t("Reviewed"), "var(--tx)"], [`${fmtNum(correct)}%`, t("Correct"), "var(--ok)"], [t("{n} m", { n: mins }), t("Time"), "var(--tx)"], [fmtNum(streak), t("Day streak"), "var(--ac)"]];
    const btn = { height: 38, padding: "0 14px", borderRadius: 10, border: "1px solid var(--bd)", display: "flex", alignItems: "center" } as const;
    return root(
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, overflowY: "auto" }}>
        <div className="rv-in" style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, textAlign: "center" }}>
          <span style={{ width: 56, height: 56, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", background: "color-mix(in srgb,var(--ok) 16%,transparent)", color: "var(--ok)", fontSize: 26 }}><Glyph name="check" size={26} /></span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 24, fontWeight: 650 }}>{allDone ? t("Done for today") : t("Session complete")}</span>
            <span style={{ fontSize: 14, color: "var(--mu)" }}>{t("{n} card in {mins} min.|{n} cards in {mins} min.", { n: done, mins })} {cram ? t("Your schedule didn’t change.") : t("Next reviews tomorrow: {n}.", { n: tomorrow ?? 0 })}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, width: "100%" }}>
            {doneStats.map(([val, l, c]) => <div key={l} style={{ padding: "12px 6px", borderRadius: 12, background: "var(--sf)", border: "1px solid var(--bd)", display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 18, fontWeight: 650, color: c }}>{val}</span><span style={{ fontSize: 11, color: "var(--mu)" }}>{l}</span></div>)}
          </div>
          {missed.length > 0 && (
            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6, padding: 12, borderRadius: 12, background: "var(--sf)", border: "1px solid var(--bd)", textAlign: "start" }}>
              <span style={{ fontSize: 12, fontWeight: 650, color: "var(--mu)" }}>{t("MISSED MOST · {n} card|MISSED MOST · {n} cards", { n: missed.length })}</span>
              {missed.map((m, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: m.c, flexShrink: 0 }} /><span dir="auto" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{plain(m.q)}</span><span style={{ color: "var(--da)" }}>×{fmtNum(m.n)}</span></div>)}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {againItems.current.size > 0 && <button type="button" className="rv-hover" style={btn} onClick={redoAgain}>{t("Review missed again")}</button>}
            {!cram && newLeft.length > 0 && <button type="button" className="rv-hover" style={btn} onClick={() => restart(newLeft.slice(0, 10))}>{t("Study {n} new", { n: Math.min(10, newLeft.length) })}</button>}
            <button type="button" className="rv-bright" onClick={() => { onExit?.(); go("today"); }} style={{ height: 38, padding: "0 16px", borderRadius: 10, background: "var(--ac)", color: "var(--af)", display: "flex", alignItems: "center", fontWeight: 650 }}>{t("Back to Today")}</button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- card
  const now = Date.now();
  const kind = kindOf(cur);
  const st = stateOf(cur.card, now);
  const deck = deckOf(cur);
  const iv: string[] = cram ? [t("again soon"), t("later"), t("done"), t("done")] : sm2() ? sm2Preview(cur.card) : scheduleAll(cur.card, now, userParams(getSettings())).map((n) => fmtIntervalLong(n.due - now));
  const total = done + queue.length;
  const pos = Math.min(done + 1, total);
  const graded = stats.reduce((a, b) => a + b, 0);
  const okW = total ? ((graded - stats[0]) / Math.max(total, graded)) * 100 : 0;
  const daW = total ? (stats[0] / Math.max(total, graded)) * 100 : 0;
  const md = (body: string) => ({ id: cur.note.id, body, spaceId: cur.note.spaceId });
  const sides = cur.fc.kind === "cloze" && cur.fc.cloze ? clozeSides(cur.fc.cloze.block, cur.fc.cloze.n, clozeEnabled(cur.note.body)) : null;
  const clozeTotal = cur.fc.cloze ? new Set([...cur.fc.cloze.block.matchAll(/\{\{c(\d+)::/g)].map((m) => m[1])).size || (cur.fc.cloze.block.match(/==[^=]+==/g) ?? []).length : 0;
  const lastSeen = cur.card.lastReview ? Math.floor((now - cur.card.lastReview) / DAY) : null;
  const typeText = [
    kind === "cloze" && clozeTotal > 1 ? t("Cloze {n} of {total}", { n: cur.fc.cloze!.n, total: clozeTotal }) : t(SHORT_KIND[kind]),
    t(STATE[st]),
    lastSeen === null ? null : lastSeen === 0 ? t("last seen today") : t("last seen {n} d ago", { n: lastSeen }),
  ].filter(Boolean).join(" · ");
  const line = lineOf(cur);
  const space = v.spaceMap.get(cur.note.spaceId);
  const folder = cur.note.folderId ? v.folderMap.get(cur.note.folderId)?.name : null;
  const src = [space?.name, folder, cur.note.title].filter(Boolean).join(" / ") + (line >= 0 ? ` · ¶ ${paragraphOf(cur.note.body, line)}` : "");
  const flagged = !!(cur.card as CardExtra).flagged;
  const openSrc = () => (line >= 0 ? openNoteAtLine(cur.note.id, line, cur.note.body) : openNote(cur.note.id));
  const tools: { g: GlyphName; l: string; m: string; run: () => void; on?: boolean; off?: boolean }[] = [
    { g: "pen", l: t("Edit card · E"), m: t("Edit card"), run: edit },
    { g: "flag", l: t("Flag · F"), m: flagged ? t("Remove flag") : t("Flag"), run: () => void flag(), on: flagged },
    { g: "pause", l: t("Bury until tomorrow · B"), m: t("Bury until tomorrow"), run: () => void remove("bury") },
    { g: "eye-off", l: t("Suspend · S"), m: t("Suspend"), run: () => void remove("suspend") },
    { g: "undo", l: t("Undo · Z"), m: t("Undo"), run: () => void undo(), off: !history.current.length },
  ];
  const more: { l: string; run: () => void }[] = [
    ...(phone ? tools.filter((x) => !x.off).map((x) => ({ l: x.m, run: x.run })) : []),
    { l: t("Open source note"), run: openSrc },
    { l: t("Reset card to new"), run: () => void remove("forget") },
    { l: t("Copy question"), run: () => { void navigator.clipboard?.writeText(cur.fc.q).then(() => toast(t("Copied"))); } },
  ];

  return root(
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        // Swipe left = Again, right = Good (once the answer is showing).
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (flipped && Math.abs(dx) > 80) { try { navigator.vibrate?.(10); } catch { /* ignore */ } void grade(dx < 0 ? 0 : 2); }
      }}>
      <div className="safe-t" style={{ display: "flex", alignItems: "center", gap: 12, padding: phone ? "4px 12px 8px" : "16px 28px", flexShrink: 0 }}>
        {closeBtn}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--mu)", minWidth: 0 }}>
            <span dir="auto" title={title} style={{ display: "block", height: 22, lineHeight: "22px", padding: "0 8px", borderRadius: 999, background: `color-mix(in srgb,${deck.c} 16%,transparent)`, color: deck.c, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: phone ? "60%" : 360, flexShrink: 0 }}>{deck.label}</span>
            {cram && <span style={{ whiteSpace: "nowrap", color: "var(--ln)" }}>{t("Custom · schedule unchanged")}</span>}
            {!phone && <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{typeText}</span>}
            <span style={{ flex: 1 }} />
            <span dir="ltr" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtNum(pos)} / {fmtNum(total)}</span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: "var(--sf2)", display: "flex", overflow: "hidden" }}>
            <div style={{ width: `${okW}%`, background: "var(--ok)", transition: "width .3s var(--ease)" }} /><div style={{ width: `${daW}%`, background: "var(--da)", transition: "width .3s var(--ease)" }} />
          </div>
        </div>
        <span style={{ display: "flex", gap: 4, position: "relative" }}>
          {!phone && tools.map((x) => (
            <button key={x.g} type="button" title={x.l} aria-label={x.l} aria-pressed={x.g === "flag" ? flagged : undefined} disabled={x.off} onClick={x.run} className="rv-hover" style={{ width: 34, height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: x.on ? "var(--ac)" : "var(--mu)", opacity: x.off ? .45 : 1 }}><Glyph name={x.g} size={17} /></button>
          ))}
          <button type="button" title={t("More")} aria-label={t("More")} aria-expanded={menu} onClick={() => setMenu((m) => !m)} className="rv-hover" style={{ width: 34, height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--mu)" }}><Glyph name="more" size={17} /></button>
          {menu && <>
            <div style={{ position: "fixed", inset: 0, zIndex: 9 }} onClick={() => setMenu(false)} />
            <div role="menu" className="rv-pop" style={{ position: "absolute", top: 40, insetInlineEnd: 0, zIndex: 10, minWidth: 220, padding: 5, borderRadius: 10, background: "var(--sf)", border: "1px solid var(--bd)", boxShadow: "0 16px 40px rgba(0,0,0,.35)", display: "flex", flexDirection: "column" }}>
              {more.map((m) => <button key={m.l} role="menuitem" type="button" className="rv-hover" onClick={() => { setMenu(false); m.run(); }} style={{ height: 32, padding: "0 10px", borderRadius: 7, textAlign: "start", fontSize: 13 }}>{m.l}</button>)}
            </div>
          </>}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: phone ? "flex-start" : "center", justifyContent: "center", padding: phone ? "8px 12px" : "0 28px", overflowY: "auto" }}>
        <div key={cur.card.id} className="rv-in" role="button" tabIndex={-1} onClick={(e) => { if (!flipped && !(e.target as HTMLElement).closest("a,button,input")) setFlipped(true); }}
          style={{ width: "100%", maxWidth: 720, display: "flex", flexDirection: "column", gap: 18, padding: phone ? 20 : "32px 36px", borderRadius: 20, background: "var(--sf)", border: "1px solid var(--bd)", boxShadow: "0 20px 50px rgba(0,0,0,.25)", ["--qfs" as string]: phone ? "20px" : "26px", ["--afs" as string]: phone ? "16px" : "18px", cursor: flipped ? "default" : "pointer", maxHeight: phone ? undefined : "100%" }}>
          <span style={{ fontSize: 11, fontWeight: 650, letterSpacing: ".08em", color: "var(--mu)" }}>{t("QUESTION")}</span>
          {kind === "occlusion" && cur.fc.occlusion
            ? <OcclusionImage data={cur.fc.occlusion.data} target={cur.fc.occlusion.target} revealed={flipped} />
            : <Preview note={md(sides ? (flipped ? sides.back : sides.front) : cur.fc.q)} className="rv-q" />}
          {flipped && (
            <div className="rv-in" style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 16, borderTop: "1px dashed var(--bd)" }}>
              <span style={{ fontSize: 11, fontWeight: 650, letterSpacing: ".08em", color: "var(--mu)" }}>{t("ANSWER")}</span>
              <Preview note={md(cur.fc.a)} className="rv-a" />
              <button type="button" onClick={openSrc} className="rv-hover"
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 9, background: "var(--bg)", border: "1px solid var(--bd)", fontSize: 12, color: "var(--mu)", textAlign: "start" }}>
                <Glyph name="note" size={14} color="var(--ln)" />
                <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t("From")} <span dir="auto" style={{ color: "var(--ln)" }}>{src}</span></span>
                <span style={{ whiteSpace: "nowrap" }}>{t("Open")} <span className="rtl:-scale-x-100" style={{ display: "inline-block" }}>↗</span></span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="safe-b" style={{ display: "flex", justifyContent: "center", padding: phone ? "10px 12px 30px" : "18px 28px 28px", flexShrink: 0 }}>
        {!flipped ? (
          <button type="button" onClick={() => setFlipped(true)} className="rv-hover" style={{ display: "flex", width: "100%", maxWidth: 720, height: 54, borderRadius: 14, background: "var(--sf2)", border: "1px solid var(--bd)", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 14, fontWeight: 600 }}>
            {t("Show answer")}{!phone && <span style={{ fontSize: 11, color: "var(--mu)", border: "1px solid var(--bd)", padding: "1px 7px", borderRadius: 5, fontWeight: 400 }}>{t("Space")}</span>}
          </button>
        ) : (
          <div className="rv-in" style={{ display: "flex", width: "100%", maxWidth: 720, gap: 8 }}>
            {RATE.map((r, k) => (
              <button key={r.l} type="button" onClick={() => void grade(k as Grade)} className="rv-bright" style={{ flex: 1, minWidth: 0, height: phone ? 60 : 64, borderRadius: 14, background: `color-mix(in srgb,${r.c} 14%,var(--sf))`, border: `1px solid color-mix(in srgb,${r.c} 45%,transparent)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 650, color: r.c }}>{t(r.l)}</span>
                <span style={{ fontSize: 11.5, color: "var(--mu)", whiteSpace: "nowrap" }}>{iv[k]}{!phone && <span> · {k + 1}</span>}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
