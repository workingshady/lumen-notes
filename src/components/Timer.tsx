import { Pause, Play, RotateCcw, Timer as TimerIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { save, uid } from "../lib/db";
import { toast } from "../lib/store";

// One global study timer (survives switching notes).
type S = { running: boolean; endsAt: number; left: number; phase: "focus" | "break"; noteId: string | null; startedAt: number };
let s: S = { running: false, endsAt: 0, left: 25 * 60_000, phase: "focus", noteId: null, startedAt: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<S>) => { s = { ...s, ...p }; subs.forEach((f) => f()); };
const useTimer = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => s);
const LEN = { focus: 25 * 60_000, break: 5 * 60_000 };

setInterval(() => {
  if (!s.running || Date.now() < s.endsAt) return;
  if (s.phase === "focus") {
    void save("session", { id: uid(), noteId: s.noteId, minutes: Math.max(1, Math.round((Date.now() - s.startedAt) / 60_000)), at: Date.now() });
    toast("Focus session done: 5 min break");
    try { new Notification("Lumen", { body: "Focus session done. Take 5." }); } catch { /* no permission */ }
    set({ phase: "break", endsAt: Date.now() + LEN.break, left: LEN.break });
  } else {
    toast("Break over");
    set({ running: false, phase: "focus", left: LEN.focus });
  }
}, 1000);

export function StudyTimer({ noteId }: { noteId: string }) {
  const t = useTimer();
  const [, tick] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!t.running) return; const i = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(i); }, [t.running]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    addEventListener("mousedown", h);
    return () => removeEventListener("mousedown", h);
  }, [open]);
  const left = t.running ? Math.max(0, t.endsAt - Date.now()) : t.left;
  const mm = String(Math.floor(left / 60_000)).padStart(2, "0");
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, "0");
  const start = () => { try { void Notification.requestPermission?.(); } catch { /* ignore */ } set({ running: true, endsAt: Date.now() + t.left, noteId, startedAt: Date.now() }); };
  const pause = () => {
    // Log partial focus time (≥ 1 min) so the dashboard counts it.
    const mins = Math.floor((Date.now() - t.startedAt) / 60_000);
    if (t.phase === "focus" && mins >= 1) void save("session", { id: uid(), noteId: t.noteId, minutes: mins, at: Date.now() });
    set({ running: false, left: Math.max(0, t.endsAt - Date.now()) });
  };
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} title="Study timer" className={"flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] tabular-nums transition-colors " + (t.running ? (t.phase === "focus" ? "bg-accent/15 text-accent" : "bg-ok/15 text-ok") : "text-muted hover:bg-surface-2")}>
        <TimerIcon size={14} /> {t.running || t.left !== LEN.focus ? `${mm}:${ss}` : ""}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-[12px] border border-line bg-surface p-4 text-center shadow-xl fade-in">
          <div className="text-[11px] uppercase tracking-wider text-muted">{t.phase === "focus" ? "Focus" : "Break"}</div>
          <div className="my-1 text-4xl font-semibold tabular-nums">{mm}:{ss}</div>
          <div className="mt-3 flex justify-center gap-2">
            <button onClick={t.running ? pause : start} className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-fg">{t.running ? <Pause size={18} /> : <Play size={18} />}</button>
            <button onClick={() => set({ running: false, phase: "focus", left: LEN.focus })} className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-muted"><RotateCcw size={16} /></button>
          </div>
          <div className="mt-3 text-[11.5px] text-muted">25 min focus · 5 min break. Minutes count toward your study streak.</div>
        </div>
      )}
    </div>
  );
}
