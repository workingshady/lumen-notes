import { ChevronLeft, ChevronRight, EyeOff, Pause, Play, RotateCcw, Smartphone, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ImageZoom, SlideStage } from "../components/Slides";
import { clock, elapsedOf, prettyCode, wsUrl, type DeckCmd, type DeckState } from "../components/study-remote-link";
import { API_BASE } from "../lib/api";

/**
 * /remote/<code>            phone remote for a desktop presenter (WebSocket via the SlidesRemote Durable Object)
 * /remote/<local-id>?screen  audience window opened by the presenter (same browser, BroadcastChannel)
 * /remote                    enter a pairing code
 */
export function Remote({ path }: { path: string }) {
  const code = decodeURIComponent(path.split("/")[2] ?? "").trim();
  const screen = new URLSearchParams(location.search).has("screen");
  if (screen && code) return <Audience id={code} />;
  if (!code) return <EnterCode />;
  return <PhoneRemote code={code.toUpperCase().replace(/[^A-Z0-9]/g, "")} />;
}

const nav = (to: string) => { history.pushState(null, "", to); dispatchEvent(new PopStateEvent("popstate")); };

function EnterCode() {
  const [v, setV] = useState("");
  const clean = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-[#0A0C0F] p-6 text-ink">
      <Smartphone size={28} className="text-accent" />
      <div className="flex flex-col items-center gap-1 text-center"><span className="text-[20px] font-[650]">Phone remote</span><span className="text-[14px] text-muted">Enter the code shown on the presenter screen.</span></div>
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && clean.length === 8) nav(`/remote/${clean}`); }} maxLength={9} placeholder="ABCD-2345" inputMode="text" autoCapitalize="characters"
        className="h-14 w-full max-w-[280px] rounded-[12px] border border-line bg-surface text-center font-mono text-[24px] tracking-[.12em] uppercase placeholder:text-muted/50 focus:border-accent focus:outline-none" />
      <button disabled={clean.length !== 8} onClick={() => nav(`/remote/${clean}`)} className="h-[52px] w-full max-w-[280px] rounded-[12px] bg-accent font-semibold text-accent-fg disabled:opacity-40">Connect</button>
    </div>
  );
}

// ------------------------------------------------------------------ phone remote
type Conn = "connecting" | "live" | "presenter-away" | "missing" | "offline";

function PhoneRemote({ code }: { code: string }) {
  const [st, setSt] = useState<DeckState | null>(null);
  const [conn, setConn] = useState<Conn>("connecting");
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const [, tick] = useState(0);
  const ws = useRef<WebSocket | null>(null);
  const touch = useRef<{ x: number; t: number } | null>(null);

  useEffect(() => {
    let closed = false, retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function connect() {
      // Ask first so a wrong code gets a clear message instead of a silent socket failure.
      try {
        const r = await fetch(`${API_BASE || location.origin}/api/remote/${code}/ws`);
        const j = (await r.json()) as { open?: boolean };
        if (!r.ok || !j.open) { if (!closed) setConn("missing"); return; }
      } catch { if (!closed) { setConn("offline"); timer = setTimeout(connect, 3000); } return; }
      if (closed) return;
      const s = new WebSocket(wsUrl(code, "role=remote"));
      ws.current = s;
      s.onopen = () => { retry = 0; setConn("live"); };
      s.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data as string);
          if (m.type === "state") setSt(m as DeckState);
          else if (m.type === "peers") setConn(m.presenters > 0 ? "live" : "presenter-away");
        } catch { /* ignore */ }
      };
      s.onclose = () => { if (closed) return; setConn("connecting"); timer = setTimeout(connect, Math.min(8000, 500 * 2 ** retry++)); };
    }
    void connect();
    const ping = setInterval(() => { if (ws.current?.readyState === 1) ws.current.send('{"type":"ping"}'); }, 25_000);
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => { closed = true; clearTimeout(timer); clearInterval(ping); clearInterval(t); ws.current?.close(1000); };
  }, [code]);

  const send = (cmd: DeckCmd["cmd"], i?: number) => {
    if (ws.current?.readyState !== 1) return;
    ws.current.send(JSON.stringify({ type: "cmd", cmd, ...(i !== undefined ? { i } : {}) } satisfies DeckCmd));
    try { navigator.vibrate?.(8); } catch { /* ignore */ }
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); send("next"); }
      else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); send("prev"); }
      else if (e.key === "b") send("blank");
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  const status = conn === "missing" ? "No presentation with this code" : conn === "offline" ? "Offline · retrying" : conn === "connecting" ? "Connecting…" : conn === "presenter-away" ? "Presenter disconnected" : "";
  const live = conn === "live" && st;
  return (
    <div className="flex h-full flex-col bg-[#0A0C0F] text-[14px] text-ink">
      <div className="safe-t h-8 shrink-0" />
      <div className="flex h-14 shrink-0 items-center gap-2 px-2 text-muted">
        <button aria-label="Leave remote" onClick={() => nav("/")} className="flex size-11 items-center justify-center text-ink"><X size={20} /></button>
        <span className="min-w-0 flex-1 truncate" dir="auto">{st?.title ?? "Phone remote"}</span>
        <span className="flex h-11 items-center gap-1.5 px-3 font-mono text-[12px]" title="Pairing code">
          <span className="size-1.5 rounded-full" style={{ background: live ? "var(--success)" : conn === "missing" ? "var(--danger)" : "var(--warning)" }} />{prettyCode(code)}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-center gap-3 px-3"
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, t: Date.now() })}
        onTouchEnd={(e) => {
          const t = touch.current; touch.current = null;
          if (!t) return;
          const dx = e.changedTouches[0].clientX - t.x;
          if (Math.abs(dx) > 50) send(dx < 0 ? "next" : "prev");
        }}>
        {st ? (
          <div className="relative aspect-video w-full"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("img,a,video,iframe")) return;
              // Tap edges: left third = back, the rest = forward.
              const r = e.currentTarget.getBoundingClientRect();
              send(e.clientX - r.left < r.width / 3 ? "prev" : "next");
            }}>
            <SlideStage key={st.i + st.md} note={{ id: st.noteId, spaceId: st.spaceId }} md={st.md} dirs={st.dirs} blank={st.blank} onZoom={(src, alt) => setZoom({ src, alt })} />
            {st.blank && <span className="absolute inset-0 flex items-center justify-center gap-2 text-[13px] text-muted"><EyeOff size={15} />Screen blanked</span>}
          </div>
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-[8px] border border-line bg-bg px-6 text-center text-muted">{status || "Waiting for the presenter…"}</div>
        )}
        {st?.notes ? <div className="max-h-[22vh] overflow-y-auto whitespace-pre-wrap rounded-[10px] border border-line bg-surface p-3 text-[14px] leading-[22px]" dir="auto">{st.notes}</div> : null}
        {st && <div className="text-[12px] text-muted">{st.next ? `Next: ${st.next}` : "Last slide"}</div>}
      </div>

      <div className="safe-b flex shrink-0 flex-col gap-3 px-5 pb-5 pt-3">
        <div className="h-[3px] rounded-[2px] bg-surface-2"><div className="h-full rounded-[2px] bg-accent transition-all" style={{ width: st ? `${((st.i + 1) / st.n) * 100}%` : "0%" }} /></div>
        <div className="flex justify-between text-[13px] text-muted"><span>{status || "Swipe or tap edges"}</span><span className="tabular-nums">{st ? `${st.i + 1} / ${st.n}` : ""}</span></div>
        <div className="flex gap-2.5">
          <div className="flex h-11 flex-1 items-center gap-1 rounded-[12px] border border-line pl-3.5 pr-1">
            <span className={`flex-1 font-mono text-[17px] font-medium tabular-nums ${st?.pausedAt ? "text-muted" : ""}`}>{st ? clock(elapsedOf(st)) : "00:00"}</span>
            <button aria-label={st?.pausedAt ? "Resume timer" : "Pause timer"} disabled={!live} onClick={() => send("timer")} className="flex size-9 items-center justify-center rounded-[9px] hover:bg-surface-2 disabled:opacity-40">{st?.pausedAt ? <Play size={15} /> : <Pause size={15} />}</button>
            <button aria-label="Reset timer" disabled={!live} onClick={() => send("timer-reset")} className="flex size-9 items-center justify-center rounded-[9px] hover:bg-surface-2 disabled:opacity-40"><RotateCcw size={15} /></button>
          </div>
          <button disabled={!live} onClick={() => send("blank")} aria-pressed={!!st?.blank} className="flex h-11 items-center gap-2 rounded-[12px] border px-4 disabled:opacity-40" style={st?.blank ? { borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 10%, transparent)" } : { borderColor: "var(--border)" }}>
            <EyeOff size={16} />{st?.blank ? "Unblank" : "Blank"}
          </button>
        </div>
        <div className="flex gap-2.5">
          <button aria-label="Previous slide" disabled={!live || st!.i === 0} onClick={() => send("prev")} className="flex h-[52px] flex-1 items-center justify-center rounded-[12px] border border-line active:bg-surface-2 disabled:opacity-40"><ChevronLeft size={20} /></button>
          <button aria-label="Next slide" disabled={!live || st!.i >= st!.n - 1} onClick={() => send("next")} className="flex h-[52px] flex-1 items-center justify-center rounded-[12px] border border-line active:bg-surface-2 disabled:opacity-40"><ChevronRight size={20} /></button>
        </div>
      </div>
      {zoom && <ImageZoom src={zoom.src} alt={zoom.alt} onClose={() => setZoom(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ audience window (second screen)
function Audience({ id }: { id: string }) {
  const [st, setSt] = useState<DeckState | null>(null);
  const bc = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    const c = new BroadcastChannel("lumen.slides." + id);
    bc.current = c;
    c.onmessage = (e) => { try { const m = JSON.parse(e.data); if (m.type === "state") setSt(m); } catch { /* ignore */ } };
    c.postMessage("hello");
    document.title = "Lumen · audience";
    return () => c.close();
  }, [id]);
  const send = (cmd: DeckCmd["cmd"]) => bc.current?.postMessage(JSON.stringify({ type: "cmd", cmd } satisfies DeckCmd));
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (["ArrowRight", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); send("next"); }
      else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); send("prev"); }
      else if (e.key === "b") send("blank");
      else if (e.key === "f") void document.documentElement.requestFullscreen?.();
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });
  return (
    <div className="flex h-full items-center justify-center bg-black text-muted" onClick={() => send("next")} onDoubleClick={() => void document.documentElement.requestFullscreen?.()}>
      {st ? <SlideStage key={st.i + st.md} note={{ id: st.noteId, spaceId: st.spaceId }} md={st.md} dirs={st.dirs} blank={st.blank} frameless /> : "Waiting for the presenter… (F for full screen)"}
    </div>
  );
}
