// Video notes bar + dock (design update 04, D8). Shown above the editor when the note has a video (or one is
// playing on screen): play/pause + time, Timestamp (Alt+T), Flashcard at this moment, speed, Pause while typing,
// and Dock: the note's player pinned above the editor (phone: small and sticky, you write below it). The dock is
// owned by this component, so it keeps playing while the preview re-renders as you type.
import { Pause } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { hydrate, render } from "../lib/markdown";
import { formatTime, videoSources } from "../lib/video-notes";
import { cx } from "./ui";
import { digits, fmtNum, t } from "../lib/i18n";
import { Glyph } from "./Glyph";
import { Toggle } from "./SmartFolders";
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
  const keep = (e: React.MouseEvent) => e.preventDefault(); // keep the caret in the editor
  const now = cur ? cur.time() : 0;
  const dur = cur?.duration() ?? 0;
  const pct = dur ? Math.min(100, (now / dur) * 100) : 0;
  const seekBar = (e: React.MouseEvent<HTMLSpanElement>) => {
    if (!cur || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    const f = (document.documentElement.dir === "rtl" ? r.right - e.clientX : e.clientX - r.left) / r.width;
    resetTypingPause();
    cur.seek(Math.max(0, Math.min(1, f)) * dur, cur.playing());
  };
  // 20b D8: one control bar (play, time / length, progress, speed, Dock) under the docked player, or on its own above
  // the editor. Owner extras in the same style: Timestamp (Alt+T), Flashcard at this moment, Pause while typing.
  const ib = "vn-b flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[6px] px-1.5 text-[12px]";

  return (
    <div className={cx("vn-bar-wrap shrink-0", dock ? "vn-docked-open" : "")}>
      {!!dock && src && (
        <div className="vn-dock">
          <div ref={hostRef} className="vn-dock-host prose" />
        </div>
      )}
      {!dock && <div ref={hostRef} hidden />}
      <div className={cx("vn-bar flex items-center gap-2.5 overflow-x-auto px-3", dock ? "vn-bar-on" : "vn-bar-solo")} role="toolbar" aria-label={t("Video notes")}>
        <button type="button" className={ib} aria-label={playing ? t("Pause video") : t("Play video")} title={playing ? t("Pause") : t("Play")} onMouseDown={keep} onClick={playPause}>
          {playing ? <Pause size={15} fill="currentColor" strokeWidth={0} /> : <Glyph name="play" size={15} />}
        </button>
        <span className="vn-time shrink-0 font-mono text-[12px] font-medium tabular-nums" aria-live="off">{cur ? digits(formatTime(now)) : "–:––"}<span className="max-md:hidden">{dur ? ` / ${digits(formatTime(dur))}` : ""}</span></span>
        <span className="vn-prog relative h-1 min-w-[40px] flex-1 cursor-pointer rounded-[2px]" onMouseDown={keep} onClick={seekBar} role="slider" aria-label={t("Seek")} aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(now)}>
          <span className="vn-prog-fill absolute inset-y-0 start-0 rounded-[2px]" style={{ width: `${pct}%` }} />
        </span>
        <button type="button" className="vn-rate-pill shrink-0 rounded-[5px] border px-1.5 text-[12px] tabular-nums max-md:hidden" title={t("Playback speed")} aria-label={t("Playback speed {rate}×", { rate: cur?.rate() ?? 1 })} disabled={!cur} onMouseDown={keep}
          onClick={() => { if (!cur) return; const i = RATES.indexOf(cur.rate()); cur.setRate(RATES[(i + 1) % RATES.length]); }}>{fmtNum(cur?.rate() ?? 1)}×</button>
        <button type="button" className={ib} title={t("Insert a timestamp at the caret (Alt+T)")} aria-label={t("Insert timestamp")} onMouseDown={keep} onClick={() => insertVideoMark("timestamp")}>
          <Glyph name="timestamp" size={16} />
        </button>
        <button type="button" className={ib} title={t("Flashcard at this moment")} aria-label={t("Flashcard at this moment")} onMouseDown={keep} onClick={() => insertVideoMark("card")}>
          <Glyph name="flashcards" size={16} />
        </button>
        <span className="flex shrink-0 items-center gap-1.5 text-[12px]" title={t("Pause while typing: the first keystroke after a timestamp pauses the video; Enter on an empty line or 4 s idle resumes it")} onMouseDown={keep}>
          <span className="max-2xl:hidden">{t("Pause while typing")}</span>
          <Toggle on={pt} label={t("Pause while typing")} onChange={(on) => { pauseTyping.set(on); setPt(on); resetTypingPause(); }} />
        </span>
        {sources.length > 1 && !!dock && (
          <select className="vn-sel h-7 shrink-0 rounded-[6px] border px-1 text-[12px]" aria-label={t("Video in the dock")} value={dock} onChange={(e) => setDock(Number(e.target.value))}>
            {sources.map((_, i) => <option key={i} value={i + 1}>{t("Video {n}", { n: i + 1 })}</option>)}
          </select>
        )}
        {!!sources.length && (
          <button type="button" className="shrink-0 text-[12px] hover:underline" aria-pressed={!!dock} title={dock ? t("Undock the video") : t("Dock the video above the editor")} onMouseDown={keep} onClick={toggleDock}>{dock ? t("Undock") : t("Dock")}</button>
        )}
      </div>
    </div>
  );
}
