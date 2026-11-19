// Moments (design round 4, Lumen 21 › "Unlock · mastered · streak"): quiet, ~200 ms ease-out, no confetti, no sound.
// Reduced motion shows the end frame only. Use the components inline (e.g. a just-unlocked pill), or call
// `showMoment({ kind, … })` from anywhere to flash one centred near the bottom of the screen for ~1.8 s.
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { db } from "../lib/db";
import { REVIEW_LADDER, type BuiltPath } from "../lib/path";
import { useVault } from "../lib/store";
import { Glyph } from "./Glyph";

const CSS = `@keyframes lm-moment-in{from{opacity:0;transform:translateY(4px) scale(.97)}to{opacity:1;transform:none}}
@keyframes lm-moment-ring{from{box-shadow:0 0 0 0 var(--lm-ring)}to{box-shadow:0 0 0 var(--lm-ring-w) var(--lm-ring)}}
@keyframes lm-moment-cell{from{transform:scale(.4);opacity:.2}to{transform:none;opacity:1}}
.lm-moment{animation:lm-moment-in .2s cubic-bezier(.2,.8,.2,1) both}
.lm-moment-ring{animation:lm-moment-ring .2s cubic-bezier(.2,.8,.2,1) both}
.lm-moment-cell{animation:lm-moment-cell .2s cubic-bezier(.2,.8,.2,1) both}
@media (prefers-reduced-motion:reduce){.lm-moment,.lm-moment-ring,.lm-moment-cell{animation:none}}`;
let styled = false;
function useMomentCss() {
  useEffect(() => {
    if (styled || typeof document === "undefined") return;
    styled = true;
    const s = document.createElement("style"); s.dataset.lumen = "moments"; s.textContent = CSS; document.head.appendChild(s);
  }, []);
}

/** Unlock: a blue pill with a soft 5 px ring ("Weight init is open"). */
export function UnlockMoment({ label }: { label: ReactNode }) {
  useMomentCss();
  return (
    <span className="lm-moment lm-moment-ring inline-flex h-10 items-center gap-2 rounded-[10px] bg-surface px-3 text-[13px] text-ink"
      style={{ border: "1.5px solid var(--info)", ["--lm-ring" as string]: "color-mix(in srgb, var(--info) 16%, transparent)", ["--lm-ring-w" as string]: "5px", boxShadow: "0 0 0 5px color-mix(in srgb, var(--info) 16%, transparent)" }}>
      <Glyph name="s-todo" size={16} color="var(--info)" />{label}
    </span>
  );
}

/** Mastered: green disc with the mastered glyph, a title and one muted line. */
export function MasteredMoment({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  useMomentCss();
  return (
    <span className="lm-moment flex flex-col items-center gap-2.5 text-[13px] text-ink">
      <span className="lm-moment-ring flex size-14 items-center justify-center rounded-full"
        style={{ background: "color-mix(in srgb, var(--success) 16%, transparent)", ["--lm-ring" as string]: "color-mix(in srgb, var(--success) 8%, transparent)", ["--lm-ring-w" as string]: "6px", boxShadow: "0 0 0 6px color-mix(in srgb, var(--success) 8%, transparent)" }}>
        <Glyph name="s-mastered" size={26} color="var(--success)" />
      </span>
      <span className="font-semibold">{title}</span>
      {sub && <span className="text-[12px] text-muted">{sub}</span>}
    </span>
  );
}

/** Streak: the last `days` squares (green), today in amber, the count and one muted line. */
export function StreakMoment({ days, sub, cells = 14 }: { days: number; sub?: ReactNode; cells?: number }) {
  useMomentCss();
  const n = Math.min(cells, Math.max(days, 1));
  return (
    <span className="lm-moment flex flex-col items-center gap-3 text-[13px] text-ink">
      <span className="flex gap-1">
        {Array.from({ length: n }, (_, i) => <span key={i} className={i === n - 1 ? "lm-moment-cell" : undefined}
          style={{ width: 14, height: 14, borderRadius: 3, background: i === n - 1 ? "var(--accent)" : "color-mix(in srgb, var(--success) 65%, var(--surface-2))" }} />)}
      </span>
      <span className="font-semibold">{days} {days === 1 ? "day" : "days"} in a row</span>
      {sub && <span className="text-[12px] text-muted">{sub}</span>}
    </span>
  );
}

export type MomentSpec =
  | { kind: "unlock"; label: string }
  | { kind: "mastered"; title: string; sub?: string }
  | { kind: "streak"; days: number; sub?: string };

let current: (MomentSpec & { id: number }) | null = null;
const subs = new Set<() => void>();
let seq = 0;
let hosted = false;
/** Flash a moment (replaces any showing one). Auto-hides after `ms` (default 1800). */
export function showMoment(m: MomentSpec, ms = 1800) {
  if (!hosted && typeof document !== "undefined") { hosted = true; const el = document.createElement("div"); el.dataset.lumen = "moment-host"; document.body.appendChild(el); createRoot(el).render(<MomentHost />); }
  const id = ++seq;
  current = { ...m, id };
  subs.forEach((f) => f());
  setTimeout(() => { if (current?.id === id) { current = null; subs.forEach((f) => f()); } }, ms);
}

/** Renders the moment `showMoment` asked for (self-mounted on first use). */
function MomentHost() {
  const m = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current, () => null);
  useMomentCss();
  if (!m) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[80] flex justify-center" role="status" aria-live="polite">
      <div key={m.id} className="rounded-[14px] border border-line bg-bg px-6 py-5 shadow-[0_16px_40px_rgba(0,0,0,.35)]">
        {m.kind === "unlock" ? <UnlockMoment label={m.label} /> : m.kind === "mastered" ? <MasteredMoment title={m.title} sub={m.sub} /> : <StreakMoment days={m.days} sub={m.sub} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ wiring
/**
 * Learning path moments: a concept that stops being locked ("Weight init is open") and a concept that reaches
 * mastery ("Gradient descent · mastered"). Compares each new build of the path with the previous one, so any
 * action (sheet, Stages, Revise tab, a course lesson finished elsewhere) fires it; the first build never does.
 */
export function usePathMoments(pathId: string, path: BuiltPath) {
  const prev = useRef<{ id: string; state: Map<string, { locked: boolean; mastered: boolean }> } | null>(null);
  useEffect(() => {
    const state = new Map(path.concepts.map((c) => [c.key, { locked: c.status === "locked", mastered: c.mastered }]));
    const before = prev.current?.id === pathId ? prev.current.state : null;
    prev.current = { id: pathId, state };
    if (!before) return;
    const mastered = path.concepts.find((c) => c.mastered && before.get(c.key) && !before.get(c.key)!.mastered);
    if (mastered) {
      const streak = Math.max(1, REVIEW_LADDER.indexOf(mastered.def.interval));
      const days = mastered.def.review ? Math.max(0, Math.round((new Date(mastered.def.review + "T12:00:00").getTime() - Date.now()) / 86_400_000)) : mastered.def.interval;
      showMoment({ kind: "mastered", title: `${mastered.def.name} · mastered`, sub: `${streak} ${streak === 1 ? "revision" : "revisions"} in a row · next in ${days} ${days === 1 ? "day" : "days"}` });
      return;
    }
    const opened = path.concepts.filter((c) => c.status !== "locked" && before.get(c.key)?.locked);
    if (opened.length) showMoment({ kind: "unlock", label: opened.length === 1 ? `${opened[0].def.name} is open` : `${opened[0].def.name} and ${opened.length - 1} more are open` });
  }, [pathId, path]);
}

const DAY = 86_400_000;
const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
/**
 * Streak moment: when today's first study activity (a timer session, a flashcard review or an edit) extends a
 * streak of 2+ days, flash "14 days in a row · Today counted after 1 timer session". Same day rule as Home's
 * streak. Once per day (remembered in localStorage); never on launch, only on the change.
 */
export function useStreakMoment() {
  const v = useVault();
  const data = useLiveQuery(async () => ({
    sessions: (await db.sessions.where("at").above(Date.now() - 400 * DAY).toArray()).filter((x) => !x.deleted),
    versions: await db.versions.where("createdAt").above(Date.now() - 400 * DAY).toArray(),
    reviews: (await db.cards.toArray()).filter((c) => !c.deleted && (c.reps > 0 || c.lapses > 0) && c.updatedAt > Date.now() - 400 * DAY),
  }), []);
  const info = useMemo(() => {
    if (!data || !v.ready) return null;
    const days = new Set<string>();
    for (const x of data.versions) days.add(dayKey(x.createdAt));
    for (const n of v.notes) days.add(dayKey(n.updatedAt));
    for (const x of data.sessions) days.add(dayKey(x.at));
    for (const c of data.reviews) days.add(dayKey(c.updatedAt));
    const today = dayKey(Date.now());
    let streak = 0;
    for (let d = Date.now(); days.has(dayKey(d)); d -= DAY) streak++;
    const timers = data.sessions.filter((x) => dayKey(x.at) === today).length;
    const reviews = data.reviews.filter((c) => dayKey(c.updatedAt) === today).length;
    return { counted: days.has(today), streak, timers, reviews };
  }, [data, v.ready, v.notes]);
  const was = useRef<boolean | null>(null);
  useEffect(() => {
    if (!info) return;
    const before = was.current;
    was.current = info.counted;
    if (before !== false || !info.counted || info.streak < 2) return;
    const key = "lumen.streakMoment", today = dayKey(Date.now());
    try { if (localStorage.getItem(key) === today) return; localStorage.setItem(key, today); } catch { /* private mode: show anyway */ }
    const why = info.timers ? `${info.timers} timer ${info.timers === 1 ? "session" : "sessions"}` : info.reviews ? `${info.reviews} ${info.reviews === 1 ? "review" : "reviews"}` : "an edit";
    showMoment({ kind: "streak", days: info.streak, sub: `Today counted after ${why}` }, 2400);
  }, [info]);
}
