import { ChevronLeft, ChevronRight, PanelRight, Smartphone, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { splitFrontMatter } from "../lib/parse";
import { Preview } from "./Preview";
import { cx, IconButton } from "./ui";
import { clock, prettyCode, qrDataUrl, remoteUrl, useRemoteLink, type DeckCmd, type DeckState } from "./study-remote-link";

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

// ------------------------------------------------------------------ layout detection (styling, not a layout engine)
type Layout = "title" | "bullets" | "image" | "video" | "diagram" | "text";
const HEAD = /^#{1,6}\s/;
const LIST = /^([-*+]|\d+[.)])\s/;
const IMG = /^!\[([^\]]*)\]\([^)]+\)$|^!\[\[[^\]]+\]\]$/;
const MEDIA = /^<?https?:\/\/\S+>?$/;
const isMediaUrl = (l: string) => MEDIA.test(l) && /youtu\.?be|vimeo\.com|\.(mp4|webm|mov|m4v|mp3|wav|ogg|m4a)(\?|>|$)/i.test(l);

/** Split a slide into its visible Markdown and speaker notes (everything after a `Note:` line). */
function parseSlide(md: string) {
  const lines = md.split("\n");
  let fence = false;
  for (let k = 0; k < lines.length; k++) {
    if (/^```/.test(lines[k])) fence = !fence;
    if (!fence && /^Notes?:/i.test(lines[k])) return { body: lines.slice(0, k).join("\n"), notes: [lines[k].replace(/^Notes?:\s*/i, ""), ...lines.slice(k + 1)].join("\n").trim() };
  }
  return { body: md, notes: "" };
}

function slideInfo(md: string) {
  const lines = md.split("\n").map((l) => l.trim()).filter(Boolean);
  const heads = lines.filter((l) => HEAD.test(l));
  // A short paragraph straight before the first heading is a kicker, not content.
  const hi = lines.findIndex((l) => HEAD.test(l));
  const rest = lines.filter((l, k) => !HEAD.test(l) && !(hi > 0 && k < hi));
  const title = heads[0]?.replace(/^#+\s*/, "") ?? "";
  let layout: Layout = "text";
  let caption = "";
  const fences = rest.filter((l) => l.startsWith("```")).length;
  if (rest.length >= 2 && /^```mermaid\b/.test(rest[0]) && /^```\s*$/.test(rest[rest.length - 1]) && fences === 2) {
    layout = "diagram";
    caption = "mermaid · " + (rest[1] ?? "").trim();
  } else if (rest.length === 1 && IMG.test(rest[0]) && /\.(mp4|webm|mov|m4v|mp3|wav|ogg|m4a)\b/i.test(rest[0])) layout = "video";
  else if (rest.length === 1 && IMG.test(rest[0])) {
    layout = "image";
    caption = IMG.exec(rest[0])?.[1] ?? "";
  } else if (rest.length === 1 && isMediaUrl(rest[0])) layout = "video";
  else if (heads.length && !fences && rest.some((l) => LIST.test(l)) && rest.every((l) => LIST.test(l) || /^\s/.test(l) || !/^[!|>]/.test(l))) layout = "bullets";
  else if (heads.length && rest.length <= 2 && !fences && !rest.some((l) => LIST.test(l) || /^[!|>]/.test(l) || MEDIA.test(l))) layout = "title";
  const media = layout === "image" ? "🖼 Image" : layout === "video" ? "▶ Media" : /!\[/.test(md) ? "🖼 Image" : lines.some(isMediaUrl) ? "▶ Media" : "";
  const alt = IMG.exec(rest.find((l) => IMG.test(l)) ?? "")?.[1];
  const label = title || ((layout === "image" || layout === "video") && alt) || (lines[0] ?? "").replace(/^!\[[^\]]*\]\([^)]*\).*/, "Image").replace(/^```(\w*).*/, "$1 diagram").replace(/^<?https?:\/\/\S+.*/, "Media");
  return { layout, caption, title: label, media };
}

// Scoped slide styles (sizes are at the 1280 × 720 design scale; the stage is scaled to fit).
const CSS = `
.lslide{width:1280px;height:720px;box-sizing:border-box;padding:72px 96px;display:flex;flex-direction:column;background:var(--bg);color:var(--text);font-family:Inter,system-ui,sans-serif;overflow:hidden;transform-origin:0 0;position:absolute;left:0;top:0}
.lslide.l-text{overflow:auto}
.lslide .prose{max-width:none;margin:0;font-family:inherit;font-size:30px;line-height:1.45;flex:1;min-height:0;display:flex;flex-direction:column}
.lslide .prose>*{margin-top:0}
.lslide .prose h1,.lslide .prose h2{font-size:60px;font-weight:700;letter-spacing:-.025em;line-height:1.1;margin:0 0 .5em;padding:0;border:0}
.lslide .prose h3{font-size:40px;font-weight:650;margin:0 0 .5em}
.lslide .prose p{margin:0 0 .6em}
.lslide .prose>p:first-child:has(+h1,+h2){font-size:18px;line-height:1.3;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;margin:0 0 18px}
.lslide .prose ul{list-style:none;padding:0}
.lslide .prose ul>li:not(.task-list-item){display:flex;gap:20px}
.lslide .prose ul>li:not(.task-list-item)::before{content:"•";color:var(--muted)}
.l-bullets .prose :is(h1,h2){margin-bottom:0}
.l-bullets .prose li{margin:0}
.l-bullets .prose>ul,.l-bullets .prose>ol{margin:48px 0 0;display:flex;flex-direction:column;gap:26px;font-size:34px;line-height:44px}
.l-bullets .prose ul ul{font-size:.8em;margin:12px 0 0;gap:12px;display:flex;flex-direction:column}
.l-title .prose{justify-content:center}
.l-title .prose h1,.l-title .prose h2{font-size:84px;letter-spacing:-.035em;line-height:1;margin:0}
.l-title .prose>p:first-child:has(+h1,+h2){font-size:20px;font-weight:600;color:var(--accent);letter-spacing:.08em;margin:0 0 26px}
.l-title .prose :is(h1,h2)~p{font-size:26px;color:var(--muted);margin:26px 0 0}
:is(.l-image,.l-video,.l-diagram) .prose :is(h1,h2,h3){font-size:48px;letter-spacing:-.02em;text-align:center;margin:0}
.l-image .prose p:has(>img){flex:1;min-height:0;display:flex;align-items:center;justify-content:center;margin:16px 0 0}
.l-image .prose img{max-height:446px;max-width:100%;border-radius:16px;object-fit:contain;display:block}
.l-video .prose .embed{width:800px;max-width:100%;margin:auto;border-radius:16px;border:0}
.l-video .prose .embed.video{aspect-ratio:16/9}
.l-video .prose .embed video{max-height:450px}
.l-diagram .prose .mermaid-block{margin:auto;background:transparent;border:0;padding:0;font-size:24px}
.l-diagram .prose .mermaid-block svg{max-height:440px;max-width:1088px}
.lslide .cap{text-align:center;color:var(--muted);font-size:20px;margin-top:16px}
.l-diagram .cap{font:500 16px 'JetBrains Mono',ui-monospace,monospace}
.zoomable img{cursor:zoom-in}
.lslide .embed-cap{display:none}
.lslide .mm-head{display:none}
.l-diagram .prose .mermaid-card{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:transparent;border:0;margin:0;padding:0}
.l-diagram .prose .mermaid-card .mermaid-block svg{min-width:900px}
`;

/** One slide rendered at 1280 × 720 and scaled to fit its box. Images are tap-to-zoom. */
export function SlideStage({ note, md, blank, counter, frameless, onZoom, className }: {
  note: Pick<Note, "id" | "spaceId">; md: string; blank?: boolean; counter?: { i: number; n: number }; frameless?: boolean; onZoom?: (src: string, alt: string) => void; className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const info = useMemo(() => slideInfo(md), [md]);
  const slideRef = useRef<HTMLDivElement>(null);
  // Title slides: when a long title wraps, break after its first comma ("Backprop,⏎from one neuron up").
  useEffect(() => {
    const h = slideRef.current?.querySelector<HTMLElement>(".l-title :is(h1,h2)");
    if (!h || h.querySelector("br") || h.offsetHeight < 84 * 1.5) return;
    const t = [...h.childNodes].find((n) => n.nodeType === 3 && /,\s/.test(n.textContent ?? ""));
    if (!t) return;
    const [a, ...b] = t.textContent!.split(/,\s/);
    t.replaceWith(document.createTextNode(a + ","), document.createElement("br"), document.createTextNode(b.join(", ")));
  });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / 1280, el.clientHeight / 720));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className={cx("flex h-full w-full items-center justify-center", className)}>
      <style>{CSS}</style>
      <div className={cx("relative overflow-hidden bg-bg", frameless ? "rounded-[6px] md:rounded-[10px]" : "rounded-[10px] border border-line")} style={{ width: 1280 * scale, height: 720 * scale, visibility: scale ? "visible" : "hidden" }}
        onClick={(e) => {
          const img = (e.target as HTMLElement).closest("img");
          if (img && onZoom) { e.stopPropagation(); onZoom(img.currentSrc || img.src, img.alt); }
        }}>
        {!blank && (
          <div ref={slideRef} className={cx("lslide", "l-" + info.layout, onZoom && "zoomable")} style={{ transform: `scale(${scale})` }}>
            <Preview note={{ id: note.id, body: md, spaceId: note.spaceId }} />
            {info.caption && (info.layout === "image" || info.layout === "diagram") && <div className="cap">{info.caption}</div>}
          </div>
        )}
        {counter && !blank && <>
          <span className="absolute bottom-5 right-7 text-[14px] text-muted tabular-nums">{counter.i + 1} / {counter.n}</span>
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-surface-2"><div className="h-full bg-accent transition-all" style={{ width: `${((counter.i + 1) / counter.n) * 100}%` }} /></div>
        </>}
      </div>
    </div>
  );
}

/** Full-screen image viewer (tap a slide image). Tap, Esc or the X closes; wheel / pinch zooms. */
export function ImageZoom({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [z, setZ] = useState(1);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === " ") { e.preventDefault(); e.stopImmediatePropagation(); onClose(); } };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 fade-in" onClick={onClose} onWheel={(e) => setZ((x) => Math.max(1, Math.min(5, x * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))}>
      <div className="flex h-14 shrink-0 items-center gap-3 px-4 text-[13px] text-white/70">
        <span className="min-w-0 flex-1 truncate" dir="auto">{alt}</span>
        <button aria-label="Close image" onClick={onClose} className="flex size-10 items-center justify-center rounded-full hover:bg-white/10"><X size={20} /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4" style={{ touchAction: "pinch-zoom" }}>
        <img src={src} alt={alt} onClick={(e) => { e.stopPropagation(); setZ((x) => (x > 1 ? 1 : 2)); }} className="max-h-full max-w-full rounded-[8px] object-contain transition-transform" style={{ transform: `scale(${z})`, cursor: z > 1 ? "zoom-out" : "zoom-in" }} />
      </div>
    </div>
  );
}

const pad2 = (x: number) => String(x).padStart(2, "0");

function RemotePopover({ link, onClose }: { link: ReturnType<typeof useRemoteLink>; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [qr, setQr] = useState("");
  const url = link.pair ? remoteUrl(link.pair.code) : "";
  useEffect(() => { if (!link.pair) void link.open(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (url) void qrDataUrl(url).then(setQr); }, [url]);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest("[data-remote-btn]") && onClose();
    addEventListener("mousedown", h);
    return () => removeEventListener("mousedown", h);
  }, [onClose]);
  const dot = link.status === "synced" ? "var(--success)" : link.status === "waiting" ? "var(--accent)" : "var(--muted)";
  return (
    <div ref={ref} className="absolute bottom-full right-0 z-40 mb-2 flex w-[280px] flex-col items-center gap-3.5 rounded-[14px] border border-line bg-surface-2 p-[18px] text-[13px] text-ink shadow-[0_16px_40px_rgba(0,0,0,.45)] fade-in">
      <div className="flex w-full items-center justify-between text-[12px] text-muted"><span className="flex items-center gap-1.5"><Smartphone size={13} />Phone remote</span><button onClick={onClose} aria-label="Close" className="hover:text-ink"><X size={14} /></button></div>
      {link.error ? <span className="text-center leading-5 text-muted">{link.error}</span> : !link.pair ? <span className="py-8 text-muted">Opening a room…</span> : <>
        <div className="flex size-[168px] items-center justify-center rounded-[12px] bg-[#E8E6E1] p-3">{qr ? <img src={qr} alt="QR code for the phone remote" className="size-full [image-rendering:pixelated]" /> : null}</div>
        <span className="font-mono text-[22px] font-medium tracking-[.08em]">{prettyCode(link.pair.code)}</span>
        <span className="text-center text-[12px] leading-[18px] text-muted">Scan with your phone, or open <span className="break-all text-ink">{url.replace(/^https?:\/\//, "")}</span></span>
        <div className="flex w-full items-center justify-between border-t border-line pt-3 text-[12px] text-muted">
          <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full" style={{ background: dot }} />{link.status === "synced" ? "Phone connected" : link.status === "waiting" ? "Waiting for phone…" : "Connecting…"}</span>
          <button onClick={() => { link.stop(); onClose(); }} className="hover:text-ink">Stop</button>
        </div>
      </>}
    </div>
  );
}

export function Slides({ note, onExit }: { note: Note; onExit: () => void }) {
  const raw = useMemo(() => splitSlides(note.body), [note.body]);
  const slides = useMemo(() => raw.map(parseSlide), [raw]);
  const infos = useMemo(() => slides.map((s) => slideInfo(s.body)), [slides]);
  const [i, setI] = useState(0);
  const [blank, setBlank] = useState(false);
  const [presenter, setPresenter] = useState(false);
  const [timer, setTimer] = useState<{ t0: number; pausedAt: number | null }>(() => ({ t0: Date.now(), pausedAt: null }));
  const [, tick] = useState(0);
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const touch = useRef<number | null>(null);
  const audience = useRef<BroadcastChannel | null>(null);
  const n = slides.length;
  const go = (d: number) => { setBlank(false); setI((x) => Math.max(0, Math.min(n - 1, x + d))); };
  const cur = slides[Math.min(i, n - 1)];
  const next = infos[i + 1];

  const state: DeckState = { type: "state", noteId: note.id, spaceId: note.spaceId, title: note.title, i, n, blank, md: cur?.body ?? "", notes: cur?.notes ?? "", next: next?.title ?? "", t0: timer.t0, pausedAt: timer.pausedAt };
  function onCmd(c: DeckCmd) {
    if (c.cmd === "next") go(1);
    else if (c.cmd === "prev") go(-1);
    else if (c.cmd === "goto" && typeof c.i === "number") { setBlank(false); setI(Math.max(0, Math.min(n - 1, c.i))); }
    else if (c.cmd === "blank") setBlank((b) => !b);
    else if (c.cmd === "timer") setTimer((t) => (t.pausedAt ? { t0: t.t0 + (Date.now() - t.pausedAt), pausedAt: null } : { ...t, pausedAt: Date.now() }));
    else if (c.cmd === "timer-reset") setTimer((t) => ({ t0: Date.now(), pausedAt: t.pausedAt ? Date.now() : null }));
  }
  const link = useRemoteLink(state, onCmd);

  // Audience window (second screen): same origin, synced over BroadcastChannel; no network needed.
  const stateJson = JSON.stringify(state);
  useEffect(() => { audience.current?.postMessage(stateJson); }, [stateJson]);
  useEffect(() => () => audience.current?.close(), []);
  async function openAudience() {
    const id = "local" + Math.random().toString(36).slice(2, 10);
    audience.current?.close();
    const bc = new BroadcastChannel("lumen.slides." + id);
    bc.onmessage = (e) => { if (e.data === "hello") bc.postMessage(JSON.stringify(stateRef.current)); else { try { onCmdRef.current(JSON.parse(e.data)); } catch { /* ignore */ } } };
    audience.current = bc;
    let features = "popup,width=1280,height=720";
    try {
      // Window Management API: put the audience view on the other screen when there is one.
      const sd = await (window as unknown as { getScreenDetails?: () => Promise<{ screens: { availLeft: number; availTop: number; availWidth: number; availHeight: number; isPrimary: boolean }[]; currentScreen: unknown }> }).getScreenDetails?.();
      const other = sd?.screens.find((s) => s !== sd.currentScreen);
      if (other) features = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
    } catch { /* permission denied: plain new window */ }
    window.open(`/remote/${id}?screen=1`, "lumen-audience-" + id, features);
    setPresenter(true);
  }
  const stateRef = useRef(state);
  stateRef.current = state;
  const onCmdRef = useRef(onCmd);
  onCmdRef.current = onCmd;

  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,.cm-editor") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " ") {
        // Space plays/pauses media on the current slide (never autoplays); otherwise advances.
        e.preventDefault();
        const m = stage.current?.querySelector<HTMLMediaElement>("video,audio");
        if (m) void (m.paused ? m.play() : m.pause());
        else go(1);
      } else if (["ArrowRight", "PageDown", "Enter"].includes(e.key)) { e.preventDefault(); go(1); }
      else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); go(-1); }
      else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(n - 1);
      else if (e.key === "Escape" && !document.fullscreenElement) onExit();
      else if (e.key === "f") void root.current?.requestFullscreen?.();
      else if (e.key === "b") setBlank((b) => !b);
      else if (e.key === "p") setPresenter((p) => !p);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  if (!n) return <div className="p-10 text-muted">No slides. Separate slides with a line containing only <code>---</code>.</div>;
  const zoomer = (src: string, alt: string) => setZoom({ src, alt });
  const thumbs = (big: boolean) => (
    <div className={cx("hidden shrink-0 items-center gap-2.5 overflow-x-auto px-6 min-[1200px]:flex", big ? "h-[120px] py-4" : "h-[120px] border-t border-surface-2")}>
      {infos.map((s, k) => (
        <button key={k} onClick={() => go(k - i)} className={cx("relative flex shrink-0 flex-col rounded-[6px] bg-bg text-left", big ? "h-20 w-[142px] gap-1.5 p-2.5" : "h-[68px] w-[120px] gap-[5px] p-2", k === i ? "border-2 border-accent" : "border border-line", k < i && (big ? "opacity-60" : "opacity-55"))}>
          <span className={cx("truncate font-[650]", big ? "text-[10.5px]" : "text-[9.5px]")}>{s.title}</span>
          {big ? <><span className="h-[3px] w-[80%] rounded-[2px] bg-muted/40" /><span className="h-[3px] w-[60%] rounded-[2px] bg-muted/40" /></> : <span className="h-[3px] w-[70%] rounded-[2px] bg-muted/35" />}
          {s.media && <span className="absolute bottom-[5px] left-1.5 rounded-[4px] bg-white/10 px-[5px] text-[9.5px] leading-[15px]">{s.media}</span>}
          <span className={cx("absolute text-muted", big ? "bottom-1 right-1.5 text-[10px]" : "bottom-1 right-1.5 text-[9.5px]")}>{k + 1}</span>
        </button>
      ))}
    </div>
  );
  const remoteBtn = (label: React.ReactNode, className: string) => (
    <span className="relative">
      <button data-remote-btn onClick={() => setRemoteOpen((o) => !o)} className={className}>{label}</button>
      {remoteOpen && <RemotePopover link={link} onClose={() => setRemoteOpen(false)} />}
    </span>
  );
  const remoteLabel = link.status === "synced" ? "Synced to phone remote" : link.status === "off" ? "Phone remote" : link.status === "waiting" ? "Waiting for phone…" : "Connecting remote…";
  const el = timer.pausedAt ? timer.pausedAt - timer.t0 : Date.now() - timer.t0;
  const now = new Date();
  return (
    <div
      ref={root}
      className="fixed inset-0 z-40 flex flex-col bg-[#0A0C0F] text-ink"
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => { if (touch.current === null) return; const dx = e.changedTouches[0].clientX - touch.current; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); touch.current = null; }}
    >
      {presenter ? (
        // ---------------------------------------------------------- presenter view (desktop)
        <>
          <div className="flex min-h-0 flex-1 gap-6 px-6 pt-6">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
              <div ref={stage} className="aspect-video min-h-0 w-full shrink" onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input,details,video,audio,iframe,img")) go(1); }}>
                <SlideStage key={i} note={note} md={cur.body} blank={blank} counter={{ i, n }} onZoom={zoomer} className="!justify-start" />
              </div>
              <div className="flex shrink-0 items-center gap-4 text-[12px] text-muted">
                <span>← → / Space to move</span><span>F full screen</span><span>B blank</span><span>Esc exit</span>
                <span className="flex-1" />
                <button onClick={openAudience} className="hover:text-ink">Audience window</button>
                <button onClick={() => setPresenter(false)} className="hover:text-ink">P hide notes</button>
                {remoteBtn(<span className="flex items-center gap-1.5">{link.status !== "off" && <span className="size-1.5 rounded-full" style={{ background: link.status === "synced" ? "var(--success)" : "var(--accent)" }} />}{remoteLabel}</span>, "hover:text-ink")}
              </div>
            </div>
            <aside className="flex w-[312px] shrink-0 flex-col gap-4">
              <div className="flex items-baseline justify-between">
                <button onClick={() => onCmd({ type: "cmd", cmd: "timer" })} title={timer.pausedAt ? "Resume timer" : "Pause timer"} className={cx("font-mono text-[36px] font-medium tracking-[-.02em] tabular-nums", !!timer.pausedAt && "text-muted")}>{clock(el)}</button>
                <span className="text-[13px] text-muted">elapsed · {pad2(now.getHours())}:{pad2(now.getMinutes())}</span>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-[12px] text-muted">Next</span>
                <button onClick={() => next && go(1)} className="flex h-[170px] flex-col gap-2.5 rounded-[8px] border border-line bg-bg p-[18px] text-left">
                  {next ? <><span className="text-[17px] font-bold">{next.title}</span>{[80, 64, 70].map((w) => <span key={w} className="h-[5px] rounded-[3px] bg-muted/40" style={{ width: `${w}%` }} />)}</> : <span className="text-[13px] text-muted">End of deck</span>}
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <span className="text-[12px] text-muted">Speaker notes</span>
                <div className="flex-1 overflow-y-auto whitespace-pre-wrap rounded-[10px] border border-line bg-surface p-3.5 text-[15px] leading-6" dir="auto">{cur.notes || <span className="text-muted">No notes. Add a line starting with <code>Note:</code> at the end of a slide.</span>}</div>
              </div>
            </aside>
          </div>
          {thumbs(true)}
        </>
      ) : (
        // ---------------------------------------------------------- audience-style view (desktop) + phone
        <>
          <div className="h-8 shrink-0 md:hidden" />
          <div className="safe-t h-[3px] shrink-0 bg-surface-2"><div className="h-full bg-accent transition-all" style={{ width: `${((i + 1) / n) * 100}%` }} /></div>
          <div ref={stage} className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-2 md:p-6" onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input,details,video,audio,iframe,img")) go(1); }}>
            <div className="h-full w-full md:max-w-[1120px]"><SlideStage key={i} note={note} md={cur.body} blank={blank} onZoom={zoomer} frameless /></div>
          </div>
          {thumbs(false)}
          {/* Desktop bar */}
          <div className="hidden h-[52px] shrink-0 items-center gap-3.5 border-t border-surface-2 px-6 text-[13px] text-muted md:flex">
            <span className="flex-1 truncate">{note.title}</span>
            <button aria-label="Previous" onClick={() => go(-1)} disabled={i === 0} className="flex size-[34px] items-center justify-center rounded-[8px] border border-line text-ink disabled:opacity-40"><ChevronLeft size={16} /></button>
            <span className="text-ink tabular-nums">{i + 1} / {n}</span>
            <button aria-label="Next" onClick={() => go(1)} disabled={i === n - 1} className="flex size-[34px] items-center justify-center rounded-[8px] border border-line text-ink disabled:opacity-40"><ChevronRight size={16} /></button>
            <span className="flex flex-1 items-center justify-end gap-1">
              <span className="mr-2 hidden lg:inline">F fullscreen · Esc exit</span>
              <IconButton label="Presenter view (P)" onClick={() => setPresenter(true)}><PanelRight size={16} /></IconButton>
              {remoteBtn(<Smartphone size={16} style={{ color: link.status === "synced" ? "var(--success)" : undefined }} />, "flex size-8 items-center justify-center rounded-[8px] hover:bg-surface-2 hover:text-ink")}
              <IconButton label="Exit slides" onClick={onExit}><X size={18} /></IconButton>
            </span>
          </div>
          {/* Phone controls */}
          <div className="safe-b shrink-0 md:hidden">
            <div className="flex items-center gap-3 px-4 pb-3">
              <button aria-label="Previous" onClick={() => go(-1)} disabled={i === 0} className="flex h-[52px] flex-1 items-center justify-center rounded-[12px] border border-line disabled:opacity-40"><ChevronLeft size={20} /></button>
              <span className="w-[60px] text-center text-[14px] tabular-nums">{i + 1} / {n}</span>
              <button aria-label="Next" onClick={() => go(1)} disabled={i === n - 1} className="flex h-[52px] flex-1 items-center justify-center rounded-[12px] border border-line disabled:opacity-40"><ChevronRight size={20} /></button>
            </div>
            <div className="pb-1.5 text-center text-[12px] text-muted">Swipe ← → · tap image to zoom</div>
          </div>
          <button aria-label="Exit slides" onClick={onExit} className="safe-t absolute left-2 top-0 flex size-8 items-center justify-center text-muted md:hidden"><X size={18} /></button>
        </>
      )}
      {zoom && <ImageZoom src={zoom.src} alt={zoom.alt} onClose={() => setZoom(null)} />}
    </div>
  );
}
