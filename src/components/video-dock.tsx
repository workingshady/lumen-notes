// Video notes bar + dock (design update 04, D8). Shown above the editor when the note has a video (or one is
// playing on screen): play/pause + time, Timestamp (Alt+T), Flashcard at this moment, speed, Pause while typing,
// and Dock: the note's player pinned above the editor (phone: small and sticky, you write below it). The dock is
// owned by this component, so it keeps playing while the preview re-renders as you type.
import { Clock, Gauge, Keyboard, Layers, PanelTop, Pause, Play, X } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { hydrate, render } from "../lib/markdown";
import { formatTime, videoSources } from "../lib/video-notes";
import { cx } from "./ui";
import { insertVideoMark, pauseTyping, resetTypingPause } from "./editor-video";
import { ctlFor, currentPlayer, indexOf, onVideoChange, PLAYER_SEL, RATES, videoRegistry } from "./video-players";

const DOCK_PREF = "lumen.video.dock";
const readPref = () => { try { return localStorage.getItem(DOCK_PREF) === "1"; } catch { return false; } };

export function VideoNoteBar({ body }: { body: string }) {
  const sources = useMemo(() => videoSources(body), [body]);
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onVideoChange(force), []);
  const [dock, setDock] = useState(() => (readPref() ? 1 : 0)); // 1-based player of the note shown in the dock, 0 = closed
  const [pt, setPt] = useState(pauseTyping.get);
  const hostRef = useRef<HTMLDivElement>(null);
  const pending = useRef<{ t: number; playing: boolean; rate: number } | null>(null);
  const srcRef = useRef(sources);
  srcRef.current = sources;

  // Register as the dock: a playing preview player that gets re-rendered (you typed) continues here.
  useEffect(() => {
    videoRegistry.dock = {
      take: (video, t, playing, rate) => {
        if (!srcRef.current[video - 1]) return false;
        pending.current = { t, playing, rate };
        setDock(video);
        return true;
      },
      root: () => hostRef.current,
    };
    return () => { videoRegistry.dock = null; };
  }, []);

  const src = dock ? sources[dock - 1] ?? sources[0] : undefined;
  const srcText = src?.text ?? "";
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (!srcText) { el.replaceChildren(); return; }
    el.dataset.vnDock = String(Math.min(dock, sources.length) || 1);
    el.dataset.vnRoot = "1";
    el.innerHTML = render(srcText);
    hydrate(el);
    const want = pending.current;
    pending.current = null;
    if (!want) return;
    // uploads resolve asynchronously: wait for the player to appear
    let n = 0;
    const go = () => {
      const c = ctlFor(el.querySelector(PLAYER_SEL));
      if (c) { c.setRate(want.rate); c.seek(want.t, want.playing); return; }
      if (n++ < 30) setTimeout(go, 100);
    };
    go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcText, dock]);

  const cur = currentPlayer();
  if (!sources.length && !cur) return null;
  const playing = !!cur?.playing();
  const toggleDock = () => {
    const next = dock ? 0 : Math.max(1, cur ? indexOf(cur) : 1);
    if (next && cur?.playing()) { pending.current = { t: cur.time(), playing: true, rate: cur.rate() }; cur.pause(); }
    setDock(next);
    try { localStorage.setItem(DOCK_PREF, next ? "1" : "0"); } catch { /* ignore */ }
  };
  const playPause = () => {
    resetTypingPause();
    if (cur) { if (cur.playing()) cur.pause(); else cur.play(); return; }
    if (!dock) { pending.current = { t: 0, playing: true, rate: 1 }; setDock(1); return; }
    ctlFor(hostRef.current?.querySelector(PLAYER_SEL))?.play();
  };
  const btn = "flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-[8px] px-2 text-[12.5px] text-muted hover:bg-surface-2 hover:text-ink md:h-8 md:min-w-8";
  const keep = (e: React.MouseEvent) => e.preventDefault(); // keep the caret in the editor

  return (
    <div className={cx("vn-bar-wrap shrink-0", dock ? "vn-docked-open" : "")}>
      {!!dock && src && (
        <div className="vn-dock">
          <div ref={hostRef} className="vn-dock-host prose" />
          <button type="button" className="vn-dock-x" aria-label="Close the docked video" title="Close the docked video" onMouseDown={keep} onClick={toggleDock}><X size={14} /></button>
        </div>
      )}
      {!dock && <div ref={hostRef} hidden />}
      <div className="vn-bar flex items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-2" role="toolbar" aria-label="Video notes">
        <button type="button" className={cx(btn, "text-ink")} aria-label={playing ? "Pause video" : "Play video"} title={playing ? "Pause" : "Play"} onMouseDown={keep} onClick={playPause}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <span className="vn-time min-w-[44px] font-mono text-[12px] tabular-nums text-muted" aria-live="off">{cur ? formatTime(cur.time()) : "–:––"}</span>
        <span className="mx-1 h-5 w-px shrink-0 bg-line" />
        <button type="button" className={btn} title="Insert a timestamp at the caret (Alt+T)" aria-label="Insert timestamp" onMouseDown={keep} onClick={() => insertVideoMark("timestamp")}>
          <Clock size={15} /><span className="max-md:hidden">Timestamp</span>
        </button>
        <button type="button" className={btn} title="Make a flashcard at this moment" aria-label="Make a flashcard at this moment" onMouseDown={keep} onClick={() => insertVideoMark("card")}>
          <Layers size={15} /><span className="max-md:hidden">Flashcard</span>
        </button>
        <button type="button" className={btn} title="Playback speed" aria-label={`Playback speed ${cur?.rate() ?? 1}×`} disabled={!cur} onMouseDown={keep}
          onClick={() => { if (!cur) return; const i = RATES.indexOf(cur.rate()); cur.setRate(RATES[(i + 1) % RATES.length]); }}>
          <Gauge size={15} /><span className="tabular-nums">{cur?.rate() ?? 1}×</span>
        </button>
        <button type="button" className={cx(btn, pt && "text-accent")} aria-pressed={pt} title="Pause while typing: the first keystroke after a timestamp pauses the video; Enter on an empty line or 4 s idle resumes it"
          onMouseDown={keep} onClick={() => { pauseTyping.set(!pt); setPt(!pt); resetTypingPause(); }}>
          <Keyboard size={15} /><span className="max-md:hidden">Pause while typing</span>
        </button>
        <span className="flex-1" />
        {sources.length > 1 && !!dock && (
          <select className="h-8 rounded-[6px] border border-line bg-surface px-1 text-[12px]" aria-label="Video in the dock" value={dock} onChange={(e) => setDock(Number(e.target.value))}>
            {sources.map((_, i) => <option key={i} value={i + 1}>Video {i + 1}</option>)}
          </select>
        )}
        {!!sources.length && (
          <button type="button" className={cx(btn, !!dock && "text-accent")} aria-pressed={!!dock} title={dock ? "Undock the video" : "Dock the video above the editor"} onMouseDown={keep} onClick={toggleDock}>
            <PanelTop size={15} /><span className="max-md:hidden">{dock ? "Undock" : "Dock video"}</span>
          </button>
        )}
      </div>
    </div>
  );
}
