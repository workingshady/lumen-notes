import { useLiveQuery } from "dexie-react-hooks";
import { Brain, PartyPopper } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Card, Note } from "../../shared/types";
import { db, save } from "../lib/db";
import { flashcards, type Flashcard } from "../lib/parse";
import { newCard, previewIntervals, schedule, type Grade } from "../lib/srs";
import { Preview } from "./Preview";
import { Button, Empty } from "./ui";

interface Item { note: Note; fc: Flashcard; card: Card }

/** Collect due cards for some notes (one note in Review mode, or all notes in the Review view). */
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
        if (card.due <= now && (includeNew || card.reps > 0)) out.push({ note: n, fc, card });
      }
    }
    return out.sort((a, b) => a.card.due - b.card.due);
  }, [cards, notes, includeNew]);
}

export function ReviewSession({ notes, title }: { notes: Note[]; title?: string }) {
  const due = useDueCards(notes);
  const [queue, setQueue] = useState<Item[] | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);
  const [stats, setStats] = useState([0, 0, 0, 0]);

  useEffect(() => { if (due && queue === null) setQueue(due); }, [due, queue]);

  const cur = queue?.[0];
  async function grade(g: Grade) {
    if (!cur) return;
    const next = schedule(cur.card, g);
    await save("card", next);
    setStats((s) => s.map((v, i) => (i === g ? v + 1 : v)));
    setFlipped(false);
    setQueue((q) => {
      const rest = q!.slice(1);
      // "Again" comes back later in this session.
      return g === 0 ? [...rest, { ...cur, card: next }] : rest;
    });
    if (g > 0) setDone((d) => d + 1);
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,.cm-editor")) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); setFlipped((f) => !f); }
      else if (flipped && ["1", "2", "3", "4"].includes(e.key)) void grade((Number(e.key) - 1) as Grade);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  if (!queue) return null;
  if (!cur) {
    return done ? (
      <Empty icon={<PartyPopper size={36} />} title={`Session done: ${done} cards`} hint={`Again ${stats[0]} · Hard ${stats[1]} · Good ${stats[2]} · Easy ${stats[3]}`} action={<Button onClick={() => { setQueue(null); setDone(0); setStats([0, 0, 0, 0]); }}>Check again</Button>} />
    ) : (
      <Empty icon={<Brain size={36} />} title="Nothing due" hint="Write cards as `Question :: Answer`, or a question line, then `?`, then the answer. Due cards show up here." />
    );
  }
  const iv = previewIntervals(cur.card);
  const total = done + queue.length;
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col p-4 md:p-8">
      <div className="mb-3 flex items-center gap-3 text-[12px] text-muted">
        <span>{title ?? cur.note.title}</span>
        <div className="h-1 flex-1 rounded bg-surface-2"><div className="h-full rounded bg-learn transition-all" style={{ width: `${(done / total) * 100}%` }} /></div>
        <span className="tabular-nums">{done + 1} / {total}</span>
      </div>
      <button onClick={() => setFlipped((f) => !f)} className="flex min-h-[280px] flex-1 flex-col rounded-[14px] border border-line bg-surface p-6 text-left shadow-sm md:p-10">
        <div className="mb-2 text-[11px] uppercase tracking-wider text-muted">{cur.note.title}</div>
        <Preview note={{ id: cur.note.id, body: cur.fc.q, spaceId: cur.note.spaceId }} className="!m-0 text-[1.15em] font-medium" />
        {flipped ? (
          <div className="mt-5 border-t border-line pt-5 fade-in"><Preview note={{ id: cur.note.id, body: cur.fc.a, spaceId: cur.note.spaceId }} className="!m-0" /></div>
        ) : (
          <div className="mt-auto pt-6 text-center text-[12px] text-muted">Tap or press Space to show the answer</div>
        )}
      </button>
      <div className="safe-b mt-4 grid grid-cols-4 gap-2">
        {flipped ? (
          (["Again", "Hard", "Good", "Easy"] as const).map((l, g) => (
            <button key={l} onClick={() => grade(g as Grade)} className="flex h-14 flex-col items-center justify-center rounded-[10px] border border-line bg-surface-2 hover:bg-surface" style={{ color: ["var(--danger)", "var(--warning)", "var(--success)", "var(--info)"][g] }}>
              <span className="text-[13.5px] font-semibold">{l}</span>
              <span className="text-[11px] text-muted">{iv[g]} · {g + 1}</span>
            </button>
          ))
        ) : (
          <Button variant="primary" className="col-span-4 h-14" onClick={() => setFlipped(true)}>Show answer</Button>
        )}
      </div>
    </div>
  );
}
