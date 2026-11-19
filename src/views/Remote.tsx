import { EyeOff, Smartphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ImageZoom, SlideStage } from "../components/Slides";
import { SlideFrame } from "../components/SlideThumb";
import { useWidth } from "../components/slides-deck";
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
  const box = useRef<HTMLDivElement>(null);
  const bw = useWidth(box);

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
  const btn = "text-[12px] text-muted hover:text-ink disabled:opacity-40";
  return (
    // R4-17D: status row (dot · Remote · device · timer), current slide, Next, speaker notes, ← / → (→ is the big one)
    <div className="flex h-full flex-col bg-bg text-[13px] text-ink">
      <div className="safe-t h-8 shrink-0" />
      <div className="flex shrink-0 items-center gap-2.5 px-5 py-3">
        <span className="size-2 shrink-0 rounded-full" style={{ background: live ? "var(--success)" : conn === "missing" ? "var(--danger)" : "var(--warning)" }} />
        <span className="min-w-0 flex-1 truncate font-semibold" dir="auto" title={`Pairing code ${prettyCode(code)}`}>{status || `Remote · ${st?.device ?? "laptop"}`}</span>
        <button disabled={!live} onClick={() => send("timer")} onDoubleClick={() => send("timer-reset")} title={st?.pausedAt ? "Resume timer (double-click resets)" : "Pause timer (double-click resets)"}
          className={`font-mono text-[15px] font-medium tabular-nums ${st?.pausedAt ? "text-muted" : ""}`}>{st ? clock(elapsedOf(st)) : "00:00"}</button>
      </div>
      <div className="flex shrink-0 flex-col gap-2.5 px-4"
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, t: Date.now() })}
        onTouchEnd={(e) => {
          const t = touch.current; touch.current = null;
          if (!t) return;
          const dx = e.changedTouches[0].clientX - t.x;
          if (Math.abs(dx) > 50) send(dx < 0 ? "next" : "prev");
        }}>
        <div ref={box}>
          {st && bw > 0 ? (
            <SlideFrame width={bw} className="relative">
              <div className="absolute inset-0"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("img,a,video,iframe")) return;
                  // Tap edges: left third = back, the rest = forward.
                  const r = e.currentTarget.getBoundingClientRect();
                  send(e.clientX - r.left < r.width / 3 ? "prev" : "next");
                }}>
                <SlideStage key={st.i + st.md} note={{ id: st.noteId, spaceId: st.spaceId }} md={st.md} dirs={st.dirs} blank={st.blank} frameless bare onZoom={(src, alt) => setZoom({ src, alt })} />
                {st.blank && <span className="absolute inset-0 flex items-center justify-center gap-2 text-[13px] text-muted"><EyeOff size={15} />Screen blanked</span>}
              </div>
            </SlideFrame>
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-[12px] border border-line bg-bg px-6 text-center text-muted">{status || "Waiting for the presenter…"}</div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="flex-1 text-[12px] text-muted">{st ? (st.i < st.n - 1 ? "Next" : "Last slide") : "Next"}</span>
          {st && <span className="text-[12px] tabular-nums text-muted">{st.i + 1} / {st.n}</span>}
          <button disabled={!live} onClick={() => send("blank")} aria-pressed={!!st?.blank} className={btn} style={st?.blank ? { color: "var(--accent)" } : undefined}>{st?.blank ? "Unblank" : "Blank"}</button>
          <button onClick={() => nav("/")} className={btn}>Leave</button>
        </div>
        {st && st.i < st.n - 1 && (
          st.nextMd !== undefined
            ? <SlideFrame width={180}><SlideStage key={"n" + st.i} note={{ id: st.noteId, spaceId: st.spaceId }} md={st.nextMd} dirs={st.nextDirs} frameless bare /></SlideFrame>
            : <SlideFrame width={180}><div className="flex h-full items-center px-3 text-[12px] font-semibold" dir="auto">{st.next}</div></SlideFrame>
        )}
      </div>
      <div className="mx-4 mt-3.5 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-[12px] bg-surface p-3.5 text-[15px] leading-[23px]" dir="auto">
        {st?.notes || <span className="text-muted">{st ? "No speaker notes on this slide." : "Speaker notes appear here."}</span>}
      </div>
      <div className="grid shrink-0 grid-cols-[1fr_2fr] gap-2.5 p-4">
        <button aria-label="Previous slide" disabled={!live || st!.i === 0} onClick={() => send("prev")} className="flex h-[72px] items-center justify-center rounded-[14px] border border-line text-[22px] active:bg-surface-2 disabled:opacity-40">←</button>
        <button aria-label="Next slide" disabled={!live || st!.i >= st!.n - 1} onClick={() => send("next")} className="flex h-[72px] items-center justify-center rounded-[14px] bg-accent text-[22px] font-bold text-accent-fg active:brightness-110 disabled:opacity-40">→</button>
      </div>
      <div className="safe-b h-6 shrink-0" />
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
