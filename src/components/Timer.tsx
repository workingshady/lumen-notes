import { useLiveQuery } from "dexie-react-hooks";
import { Pause, Play, RotateCcw, Settings2, SkipForward, Timer as TimerIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { db, save, uid } from "../lib/db";
import { toast } from "../lib/store";

// Block lengths (minutes) are configurable from the popover's settings icon; stored per device.
const LEN_KEY = "lumen.timer.len";
const LEN = (() => { try { const v = JSON.parse(localStorage.getItem(LEN_KEY) ?? "null"); if (v?.focus > 0 && v?.break > 0) return { focus: v.focus * 60_000, break: v.break * 60_000 }; } catch { /* ignore */ } return { focus: 25 * 60_000, break: 5 * 60_000 }; })();
// One global study timer (survives switching notes).
type S = { running: boolean; endsAt: number; left: number; phase: "focus" | "break"; noteId: string | null; startedAt: number; round: number };
let s: S = { running: false, endsAt: 0, left: LEN.focus, phase: "focus", noteId: null, startedAt: 0, round: 1 };
const subs = new Set<() => void>();
const set = (p: Partial<S>) => { s = { ...s, ...p }; subs.forEach((f) => f()); };
const useTimer = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => s);


function chime() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
    o.start(); o.stop(ctx.currentTime + 1.25);
  } catch { /* no audio */ }
}

function endFocus(logged: boolean) {
  if (logged) void save("session", { id: uid(), noteId: s.noteId, minutes: Math.max(1, Math.round((Date.now() - s.startedAt) / 60_000)), at: Date.now() });
  set({ phase: "break", endsAt: Date.now() + LEN.break, left: LEN.break, startedAt: Date.now() });
}
function endBreak() { set({ phase: "focus", left: LEN.focus, endsAt: Date.now() + LEN.focus, startedAt: Date.now(), round: (s.round % 4) + 1 }); }

setInterval(() => {
  if (!s.running || Date.now() < s.endsAt) return;
  chime();
  if (s.phase === "focus") {
    toast("Focus session done: 5 min break");
    try { new Notification("Lumen", { body: "Focus session done. Take 5." }); } catch { /* no permission */ }
    endFocus(true);
  } else {
    toast("Break over");
    endBreak();
    set({ running: false });
  }
}, 1000);

/** Study timer pill + popover. With a `noteId` minutes log to that note; without one it is the global timer (Home). */
export function StudyTimer({ noteId }: { noteId?: string | null }) {
  const t = useTimer();
  const [, tick] = useState(0);
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const today = useLiveQuery(async () => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return (await db.sessions.where("at").aboveOrEqual(d.getTime()).toArray()).filter((x) => !x.deleted).reduce((a, x) => a + x.minutes, 0);
  }, [t.phase, t.running]) ?? 0;
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
  const full = LEN[t.phase];
  const pct = Math.min(100, Math.max(0, ((full - left) / full) * 100));
  const start = () => { try { void Notification.requestPermission?.(); } catch { /* ignore */ } set({ running: true, endsAt: Date.now() + t.left, noteId: noteId ?? null, startedAt: Date.now() }); };
  const pause = () => {
    // Log partial focus time (≥ 1 min) so the dashboard counts it.
    const mins = Math.floor((Date.now() - t.startedAt) / 60_000);
    if (t.phase === "focus" && mins >= 1) void save("session", { id: uid(), noteId: t.noteId, minutes: mins, at: Date.now() });
    set({ running: false, left: Math.max(0, t.endsAt - Date.now()) });
  };
  const skip = () => {
    const wasRunning = t.running;
    if (t.phase === "focus") endFocus(wasRunning && Date.now() - t.startedAt >= 60_000);
    else endBreak();
    if (!wasRunning) set({ running: false, left: LEN[s.phase] });
  };
  const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`);
  const pill = t.running || t.left !== LEN.focus || t.phase !== "focus";
  return (
    <div ref={ref} className="relative">
      {t.running ? (
        <span className="flex h-7 items-center gap-1.5 rounded-full border pl-2.5 pr-1" style={{ borderColor: t.phase === "focus" ? "var(--accent)" : "var(--success)", background: `color-mix(in srgb, ${t.phase === "focus" ? "var(--accent)" : "var(--success)"} 10%, transparent)` }}>
          <button onClick={() => setOpen((o) => !o)} title="Study timer" className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full" style={{ background: t.phase === "focus" ? "var(--accent)" : "var(--success)" }} />
            <span className="font-mono text-[12px] font-medium tabular-nums">{mm}:{ss}</span>
          </button>
          <button onClick={pause} aria-label="Pause timer" className="flex size-5 items-center justify-center rounded-full bg-surface-2"><Pause size={10} /></button>
        </span>
      ) : (
        <span className="flex h-7 items-center gap-1.5 rounded-full border border-line pl-2.5 pr-1">
          <button onClick={() => setOpen((o) => !o)} title="Study timer" className="flex items-center gap-1.5">
            <TimerIcon size={13} className="text-muted" />
            <span className="font-mono text-[12px] font-medium tabular-nums">{mm}:{ss}</span>
          </button>
          <button onClick={start} aria-label={pill ? "Resume timer" : "Start timer"} className="flex size-5 items-center justify-center rounded-full bg-surface-2 hover:text-accent"><Play size={10} /></button>
        </span>
      )}
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 flex w-[280px] flex-col items-center gap-3.5 rounded-[14px] border border-line bg-surface-2 p-[18px] shadow-[0_16px_40px_rgba(0,0,0,.45)] fade-in">
          <div className="flex w-full justify-between text-[12px] text-muted"><span>{t.phase === "focus" ? `Focus · ${t.round} of 4` : "Break"}</span><button onClick={() => setCfg((c) => !c)} aria-label="Timer settings" title="Block lengths" className={cfg ? "text-ink" : "hover:text-ink"}><Settings2 size={14} /></button></div>
          {cfg && (
            <div className="flex w-full items-center gap-2 rounded-[10px] bg-surface p-2.5 text-[12px] text-muted">
              {(["focus", "break"] as const).map((k) => (
                <label key={k} className="flex flex-1 items-center gap-1.5 capitalize">{k}
                  <input type="number" min={1} max={180} defaultValue={LEN[k] / 60_000} onChange={(e) => {
                    const m = Math.max(1, Math.min(180, Number(e.target.value) || 0));
                    LEN[k] = m * 60_000;
                    try { localStorage.setItem(LEN_KEY, JSON.stringify({ focus: LEN.focus / 60_000, break: LEN.break / 60_000 })); } catch { /* ignore */ }
                    if (!s.running && s.phase === k) set({ left: LEN[k] });
                  }} className="h-7 w-12 rounded-[6px] border border-line bg-surface-2 px-1.5 text-ink focus:border-accent focus:outline-none" />min</label>
              ))}
            </div>
          )}
          <div className="flex size-[148px] items-center justify-center rounded-full" style={{ background: `conic-gradient(${t.phase === "focus" ? "var(--accent)" : "var(--success)"} 0 ${pct}%, var(--border) ${pct}% 100%)` }}>
            <div className="flex size-[136px] flex-col items-center justify-center gap-0.5 rounded-full bg-surface-2">
              <span className="font-mono text-[32px] font-medium tracking-[-.02em] tabular-nums">{mm}:{ss}</span>
              <span className="text-[12px] text-muted">of {String(full / 60_000).padStart(2, "0")}:00</span>
            </div>
          </div>
          <div className="flex w-full gap-2">
            <button onClick={t.running ? pause : start} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-accent font-semibold text-accent-fg">{t.running ? <><Pause size={13} />Pause</> : <><Play size={13} />{t.left === full ? "Start" : "Resume"}</>}</button>
            <button onClick={() => set({ running: false, phase: "focus", left: LEN.focus })} aria-label="Reset" title="Reset" className="flex h-9 items-center rounded-[10px] border border-line px-3 hover:bg-surface"><RotateCcw size={14} /></button>
            <button onClick={skip} aria-label="Skip" title={t.phase === "focus" ? "Skip to break" : "Skip break"} className="flex h-9 items-center rounded-[10px] border border-line px-3 hover:bg-surface"><SkipForward size={14} /></button>
          </div>
          <div className="flex w-full justify-between border-t border-line pt-3 text-[12px] text-muted"><span>Today {fmtMin(today)}</span><span>{t.noteId && t.noteId !== noteId ? "Logs to another note" : noteId ? "Logs to this note" : "Logs to today"}</span></div>
        </div>
      )}
    </div>
  );
}
