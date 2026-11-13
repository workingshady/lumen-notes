import { useLiveQuery } from "dexie-react-hooks";
import { ArrowUpRight, Brain, Check, Layers, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Card, Note } from "../../shared/types";
import { db, save } from "../lib/db";
import { flashcards, type Flashcard } from "../lib/parse";
import { newCard, previewIntervals, schedule, type Grade } from "../lib/srs";
import { go, openNote, toast, useVault } from "../lib/store";
import { Preview } from "./Preview";
import { cardLine, openNoteAtLine } from "./study-nav";
import { cx, Empty } from "./ui";

interface Item { note: Note; fc: Flashcard; card: Card }

/** Collect due cards for some notes (one note in Review mode, or all notes in the Review view). Suspended cards never count. */
export function useDueCards(notes: Note[], includeNew = true) {
  const cards = useLiveQuery(() => db.cards.toArray(), []);
  return useMemo(() => {
    if (!cards) return null;
    const map = new Map(cards.map((c) => [c.id, c]));
    const now = Date.now();
    const out: Item[] = [];
    for (const n of notes) {
      if (n.type === "canvas") continue;
      for (const fc of flashcards(n.body)) {
        const id = `${n.id}:${fc.key}`;
        const card = map.get(id) ?? newCard(id, n.id);
        if (card.suspended) continue;
        if (card.due <= now && (includeNew || card.reps > 0)) out.push({ note: n, fc, card });
      }
    }
    return out.sort((a, b) => a.card.due - b.card.due);
  }, [cards, notes, includeNew]);
}

const GRADES = [
  { n: "Again", c: "var(--danger)" },
  { n: "Hard", c: "var(--warning)" },
  { n: "Good", c: "var(--success)" },
  { n: "Easy", c: "var(--info)" },
] as const;
const tint = (c: string) => ({ background: `color-mix(in srgb, ${c} 10%, var(--surface))`, borderColor: `color-mix(in srgb, ${c} 30%, transparent)` });
const Kbd = ({ children }: { children: React.ReactNode }) => <span className="mr-1.5 rounded-[4px] border border-line px-2 py-0.5 font-mono text-[11px] font-medium">{children}</span>;
const DAY = 86_400_000;
/** One-line answers: the first sentence is the headline, the rest the explanation ("The step size. θ ← …"). */
const headline = (a: string) => (a.includes("\n") ? a : a.replace(/^(.{3,120}?[.!?])\s+(?=\S)/, "$1\n\n"));
const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

/** Days in a row with study activity (edits, timer sessions, reviews), ending today or yesterday. Same rule as Home's streak. */
function useStreak(tick: number) {
  const v = useVault();
  const data = useLiveQuery(async () => ({
    sessions: await db.sessions.toArray(),
    versions: await db.versions.where("createdAt").above(Date.now() - 400 * DAY).toArray(),
    cards: await db.cards.toArray(),
  }), [tick]);
  return useMemo(() => {
    if (!data) return 0;
    const days = new Set<string>();
    for (const x of data.versions) days.add(dayKey(x.createdAt));
    for (const n of v.notes) days.add(dayKey(n.updatedAt));
    for (const s of data.sessions) if (!s.deleted) days.add(dayKey(s.at));
    for (const c of data.cards) if (c.reps > 0 || c.lapses > 0) days.add(dayKey(c.updatedAt));
    let streak = 0;
    let d = days.has(dayKey(Date.now())) ? Date.now() : Date.now() - DAY;
    for (; days.has(dayKey(d)); d -= DAY) streak++;
    return streak;
  }, [data, v.notes]);
}

type Step = { kind: "grade" | "suspend"; item: Item; prev: Card; queue: Item[]; done: number; stats: number[]; again: [string, { n: number; q: string }][] };

export function ReviewSession({ notes, title, onExit }: { notes: Note[]; title?: string; onExit?: () => void }) {
  const v = useVault();
  const due = useDueCards(notes);
  const [queue, setQueue] = useState<Item[] | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);
  const [stats, setStats] = useState([0, 0, 0, 0]);
  const [started, setStarted] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const again = useRef(new Map<string, { n: number; q: string }>());
  const againItems = useRef(new Map<string, Item>());
  const history = useRef<Step[]>([]);
  const touch = useRef<number | null>(null);

  useEffect(() => { if (due && queue === null) { setQueue(due); setStarted(Date.now()); } }, [due, queue]);
  const streak = useStreak(done);

  // Cards from these notes due tomorrow (for the summary).
  const ids = useMemo(() => new Set(notes.map((n) => n.id)), [notes]);
  const nextDue = useLiveQuery(async () => {
    const end = new Date(); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + 2);
    const now = Date.now();
    return (await db.cards.where("due").below(end.getTime()).toArray()).filter((c) => ids.has(c.noteId) && c.due > now && !c.suspended && !c.deleted).length;
  }, [ids, done]);

  const cur = queue?.[0];
  const snapshot = (kind: Step["kind"], item: Item): Step => ({ kind, item, prev: item.card, queue: queue!, done, stats, again: [...again.current] });

  async function grade(g: Grade) {
    if (!cur) return;
    history.current.push(snapshot("grade", cur));
    const next = schedule(cur.card, g);
    await save("card", next);
    setStats((s) => s.map((x, i) => (i === g ? x + 1 : x)));
    if (g === 0) {
      const a = again.current.get(cur.card.id);
      again.current.set(cur.card.id, { n: (a?.n ?? 0) + 1, q: cur.fc.q });
      againItems.current.set(cur.card.id, cur);
    }
    setFlipped(false);
    setQueue((q) => {
      const rest = q!.slice(1);
      // "Again" comes back later in this session.
      return g === 0 ? [...rest, { ...cur, card: next }] : rest;
    });
    if (g > 0) setDone((d) => d + 1);
    setElapsed(Date.now() - started);
  }

  async function suspend() {
    if (!cur) return;
    history.current.push(snapshot("suspend", cur));
    await save("card", { ...cur.card, suspended: 1 });
    setFlipped(false);
    setQueue((q) => q!.slice(1).filter((x) => x.card.id !== cur.card.id));
    toast("Card suspended · U to undo");
  }

  async function undo() {
    const s = history.current.pop();
    if (!s) return;
    // Put the card back exactly as it was (a never-reviewed card goes back to "new").
    await save("card", s.prev);
    again.current = new Map(s.again);
    setQueue(s.queue);
    setDone(s.done);
    setStats(s.stats);
    setFlipped(false);
  }

  function edit() {
    if (!cur) return;
    const line = cardLine(cur.note.body, cur.fc.q);
    if (line >= 0) openNoteAtLine(cur.note.id, line, cur.note.body);
    else openNote(cur.note.id, "edit");
  }

  function redoAgain() {
    const items = [...againItems.current.values()];
    void db.cards.bulkGet(items.map((x) => x.card.id)).then((cards) => {
      setQueue(items.map((x, k) => ({ ...x, card: cards[k] ?? x.card })));
      setDone(0); setStats([0, 0, 0, 0]); setStarted(Date.now());
      again.current.clear(); againItems.current.clear(); history.current = [];
    });
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,.cm-editor") || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "u") { e.preventDefault(); void undo(); return; }
      if (!cur) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); setFlipped((f) => !f); }
      else if (flipped && ["1", "2", "3", "4"].includes(e.key)) void grade((Number(e.key) - 1) as Grade);
      else if (key === "e") { e.preventDefault(); edit(); }
      else if (key === "s") { e.preventDefault(); void suspend(); }
      else if (e.key === "Escape" && onExit) onExit();
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  if (!queue) return null;
  const close = onExit && (
    <button onClick={onExit} aria-label="Close review" className="flex size-11 shrink-0 items-center justify-center rounded-[8px] text-ink hover:bg-surface-2 md:size-8 md:text-muted md:hover:text-ink"><X className="size-5 md:size-[18px]" /></button>
  );
  if (!cur) {
    if (!done) return (
      <div className="relative h-full">
        {close && <div className="absolute left-2 top-1.5 md:left-6 md:top-3">{close}</div>}
        <Empty icon={<Brain size={36} />} title="Nothing due" hint="Write cards as `Question :: Answer`, or a question line, then `?`, then the answer. Due cards show up here." />
      </div>
    );
    const total = stats.reduce((a, b) => a + b, 0) || 1;
    const hardest = [...again.current.values()].sort((a, b) => b.n - a.n)[0];
    const mins = Math.max(1, Math.round(elapsed / 60_000));
    const redo = againItems.current.size;
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto p-4">
        <div className="flex w-full max-w-[520px] flex-col gap-6 [line-height:normal] fade-in">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="flex size-[52px] items-center justify-center rounded-full text-ok" style={{ background: "color-mix(in srgb, var(--success) 16%, transparent)" }}><Check size={26} /></span>
            <span className="mt-2 text-[26px] font-[650] tracking-[-.02em]">Session complete</span>
            <span className="text-[14px] text-muted">{done} {done === 1 ? "card" : "cards"} in {mins} min{streak > 0 && ` · streak now ${streak} ${streak === 1 ? "day" : "days"}`}</span>
          </div>
          <div className="flex flex-col gap-3.5 rounded-[14px] border border-line bg-surface p-5">
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[5px]">
              {GRADES.map((g, k) => stats[k] ? <span key={g.n} style={{ width: `${(stats[k] / total) * 100}%`, background: g.c }} /> : null)}
            </div>
            <div className="grid grid-cols-4 gap-2 text-[12.5px]">
              {GRADES.map((g, k) => <span key={g.n} className="flex flex-col gap-0.5"><b className="text-[18px] font-[650]">{stats[k]}</b><span style={{ color: g.c }}>{g.n}</span></span>)}
            </div>
            <div className="flex flex-col gap-2 border-t border-line pt-3 text-[13px] text-muted">
              {hardest && <span className="flex justify-between gap-4"><span className="shrink-0">Hardest card</span><span className="truncate text-ink" dir="auto">{hardest.q.replace(/[*_`#$]/g, "").split("\n")[0]}</span></span>}
              <span className="flex justify-between gap-4"><span>Next review</span><span className="text-ink">{nextDue ? `Tomorrow · ${nextDue} ${nextDue === 1 ? "card" : "cards"}` : "Nothing due tomorrow"}</span></span>
            </div>
          </div>
          <div className="flex gap-2.5">
            <button className="flex h-11 flex-1 items-center justify-center rounded-[10px] bg-accent text-[14px] font-semibold text-accent-fg hover:brightness-110" onClick={() => (onExit ? onExit() : go("home"))}>Back to Home</button>
            {redo > 0 && <button className="flex h-11 items-center rounded-[10px] border border-line px-4 text-[14px] hover:bg-surface" onClick={redoAgain}>Redo {redo} “Again” {redo === 1 ? "card" : "cards"}</button>}
          </div>
        </div>
      </div>
    );
  }
  const iv = previewIntervals(cur.card);
  const total = done + queue.length;
  const left = queue.length - 1;
  const pos = Math.min(done + 1, total);
  const md = (body: string) => ({ id: cur.note.id, body, spaceId: cur.note.spaceId });
  const folder = cur.note.folderId ? v.folderMap.get(cur.note.folderId)?.name : null;
  const pct = `${(pos / total) * 100}%`;
  return (
    <div
      className="flex h-full flex-col"
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        // Swipe left = Again, right = Good (once the answer is showing).
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (flipped && Math.abs(dx) > 80) { try { navigator.vibrate?.(10); } catch { /* ignore */ } void grade(dx < 0 ? 0 : 2); }
      }}
    >
      {/* Phone top bar: close · progress · count */}
      <div className="safe-t flex h-14 shrink-0 items-center gap-2 px-2 text-[14px] md:hidden">
        {close ?? <span className="w-2" />}
        <span className="h-1 flex-1 overflow-hidden rounded-[2px] bg-surface-2"><span className="block h-full bg-learn transition-all" style={{ width: pct }} /></span>
        <span className="px-3 font-semibold tabular-nums">{pos} / {total}</span>
      </div>
      {/* Desktop top bar */}
      <div className="hidden h-14 shrink-0 items-center gap-4 px-6 text-[13px] md:flex">
        {close}
        <span className="truncate text-muted">{title ?? cur.note.title}</span>
        <span className="flex-1" />
        <span className="font-semibold tabular-nums">{pos} <span className="font-normal text-muted">/ {total}</span></span>
      </div>
      <div className="hidden h-[3px] shrink-0 bg-surface-2 md:block"><div className="h-full bg-learn transition-all" style={{ width: pct }} /></div>

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-2 md:items-center md:justify-center md:gap-7 md:p-4">
        <div role="button" tabIndex={-1} onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input")) setFlipped((f) => !f); }}
          className={cx("review-card flex min-h-0 w-full flex-1 cursor-pointer flex-col overflow-y-auto rounded-[14px] border border-line bg-surface p-5 md:h-[400px] md:w-[680px] md:max-w-full md:flex-none md:px-9 md:py-7", flipped && "gap-4 md:gap-[18px]")}>
          <div className="flex items-center gap-1.5 text-[12px] text-muted md:gap-2">
            <Layers size={13} className="shrink-0 text-learn" />
            <span className="truncate">{cur.note.title}</span>
            {folder && <><span className="opacity-50">·</span><span className="truncate">{folder}</span></>}
            <span className="flex-1" />
            {flipped
              ? <button onClick={() => openNote(cur.note.id)} className="hidden shrink-0 items-center gap-1 hover:text-ink md:flex"><ArrowUpRight size={12} />Open note</button>
              : cur.card.reps === 0 && <span className="shrink-0">New</span>}
          </div>
          {flipped ? (
            <div key="back" className="flex flex-1 flex-col gap-4 fade-in md:gap-[18px]">
              <Preview note={md(cur.fc.q)} className="!m-0 w-full !max-w-none pt-5 text-center [&>*]:!m-0 !text-[17px] !leading-[26px] text-muted md:pt-2.5 md:!text-[20px] md:!leading-[30px]" />
              <div className="mx-6 h-px shrink-0 bg-line md:mx-10" />
              <div className="flex flex-1 items-center justify-center">
                <Preview note={md(headline(cur.fc.a))} className="review-answer !m-0 w-full !max-w-none text-center !text-[19px] !leading-[30px]" />
              </div>
            </div>
          ) : (
            <div key="front" className="flex flex-1 flex-col fade-in">
              <div className="flex flex-1 items-center justify-center px-2 md:px-5">
                <Preview note={md(cur.fc.q)} className="!m-0 w-full !max-w-none text-center !text-[22px] font-semibold !leading-[32px] tracking-[-.01em] md:!text-[30px] md:!leading-[42px]" />
              </div>
              <div className="text-center text-[12.5px] text-muted"><span className="hidden md:inline"><Kbd>Space</Kbd>to show answer</span><span className="md:hidden">Tap to show answer</span></div>
            </div>
          )}
        </div>
        <div className="safe-b w-full shrink-0 pt-4 md:w-auto md:pt-0">
          {flipped ? (
            <div className="grid grid-cols-4 gap-2 md:grid-cols-[repeat(4,150px)] md:gap-2.5">
              {GRADES.map((g, k) => (
                <button key={g.n} onClick={() => grade(k as Grade)} className="relative flex h-[68px] flex-col items-center justify-center gap-[3px] rounded-[12px] border transition-[filter] hover:brightness-125 md:h-16 md:gap-1 md:rounded-[10px]" style={tint(g.c)}>
                  <span className="text-[14px] font-semibold" style={{ color: g.c }}>{g.n}</span>
                  <span className="text-[12px] text-muted">{iv[k]}</span>
                  <span className="absolute left-2 top-1.5 hidden font-mono text-[10px] font-medium text-muted md:block">{k + 1}</span>
                </button>
              ))}
            </div>
          ) : (
            <button onClick={() => setFlipped(true)} className="h-[52px] w-full rounded-[12px] border border-line bg-surface-2 px-7 text-[14px] font-semibold hover:bg-surface md:h-12 md:w-auto md:rounded-[10px]">Show answer</button>
          )}
        </div>
      </div>
      <div className="hidden h-11 shrink-0 items-center justify-between px-6 text-[12px] text-muted md:flex">
        {!flipped && <>
          <span>{left} left in this {title ? "deck" : "session"} · about {Math.max(1, Math.round((left * 44) / 60))} min</span>
          <span className="flex gap-3.5">
            <button onClick={edit} className="hover:text-ink">E edit card</button>
            <button onClick={() => void suspend()} className="hover:text-ink">S suspend</button>
            <button onClick={() => void undo()} disabled={!history.current.length} className="hover:text-ink disabled:hover:text-muted">U undo</button>
          </span>
        </>}
      </div>
      <style>{`.review-card [dir="auto"]{text-align:center}@media(max-width:767px){.review-card .prose{font-family:Inter,system-ui,sans-serif}}.review-answer>p{margin:0}.review-answer>p+p{opacity:.85;margin-top:16px}.review-answer>p:first-child{font-size:22px;line-height:32px;font-weight:600}@media(min-width:768px){.review-answer>p:first-child{font-size:28px;line-height:38px}.review-answer>p+p{margin-top:14px}}`}</style>
    </div>
  );
}
