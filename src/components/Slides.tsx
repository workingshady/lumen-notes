import { ChevronLeft, ChevronRight, Maximize, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { splitFrontMatter } from "../lib/parse";
import { Preview } from "./Preview";
import { IconButton } from "./ui";

/** `---` on its own line (outside code fences) separates slides. */
export function splitSlides(md: string) {
  const body = splitFrontMatter(md).body;
  const out: string[] = [];
  let cur: string[] = [];
  let fence = false;
  for (const l of body.split("\n")) {
    if (/^```/.test(l)) fence = !fence;
    if (!fence && /^---\s*$/.test(l)) { out.push(cur.join("\n")); cur = []; continue; }
    cur.push(l);
  }
  out.push(cur.join("\n"));
  return out.filter((s) => s.trim());
}

export function Slides({ note, onExit }: { note: Note; onExit: () => void }) {
  const slides = useMemo(() => splitSlides(note.body), [note.body]);
  const [i, setI] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const touch = useRef<number | null>(null);
  const n = slides.length;
  const go = (d: number) => setI((x) => Math.max(0, Math.min(n - 1, x + d)));

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); go(1); }
      else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); go(-1); }
      else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(n - 1);
      else if (e.key === "Escape" && !document.fullscreenElement) onExit();
      else if (e.key === "f") void root.current?.requestFullscreen?.();
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  if (!n) return <div className="p-10 text-muted">No slides. Separate slides with a line containing only <code>---</code>.</div>;
  return (
    <div
      ref={root}
      className="relative flex h-full flex-col bg-bg"
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => { if (touch.current === null) return; const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); touch.current = null; }}
    >
      <div className="h-1 bg-surface-2"><div className="h-full bg-accent transition-all" style={{ width: `${((i + 1) / n) * 100}%` }} /></div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6 md:p-16" onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input,details")) go(1); }}>
        <div className="slide w-full max-w-5xl" style={{ fontSize: "clamp(16px, 2.2vw, 28px)" }}>
          <Preview key={i} note={{ id: note.id, body: slides[i], spaceId: note.spaceId }} className="!max-w-none !text-[1em]" />
        </div>
      </div>
      <div className="safe-b flex items-center gap-1 border-t border-line px-3 py-1.5 text-[12px] text-muted">
        <IconButton label="Previous" onClick={() => go(-1)} disabled={i === 0}><ChevronLeft size={18} /></IconButton>
        <span className="tabular-nums">{i + 1} / {n}</span>
        <IconButton label="Next" onClick={() => go(1)} disabled={i === n - 1}><ChevronRight size={18} /></IconButton>
        <div className="mx-2 hidden gap-1 overflow-x-auto md:flex">
          {slides.map((s, k) => (
            <button key={k} onClick={() => setI(k)} className={"h-7 max-w-36 truncate rounded-md px-2 text-[11px] " + (k === i ? "bg-surface-2 text-ink" : "hover:bg-surface-2")}>
              {k + 1}. {(/^#+\s*(.+)$/m.exec(s)?.[1] ?? s.trim().split("\n")[0]).slice(0, 24)}
            </button>
          ))}
        </div>
        <span className="ml-auto hidden md:inline">← → / space · F fullscreen · Esc exit</span>
        <IconButton label="Fullscreen" onClick={() => void root.current?.requestFullscreen?.()}><Maximize size={16} /></IconButton>
        <IconButton label="Exit slides" onClick={onExit}><X size={18} /></IconButton>
      </div>
    </div>
  );
}
