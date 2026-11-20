// One presenter for every workspace (design 41A–41F; WBStudio overlay "present", R6Parts part "presenters"):
// full screen, slide-to-slide camera animation, laser and pen while presenting, slide counter, presenter notes,
// phone remote through the SlidesRemote Durable Object. Whiteboards / Boards step through frames, the canvas through
// groups, the architecture studio through layers, groups or C4 levels: they pass `steps` and either a `scene`
// (camera mode: one drawing in scene units, each step a rect the camera flies to) or `renderStep` (one view per step).
//
//   <Presenter steps={[{ id, label, notes?, rect? }]} scene={{ node, x0, y0, w, h }} counter={(i, n) => `Group ${i + 1} of ${n}`}
//     background={{ color: "var(--bg)" }} onExit={() => setPresenting(false)} />
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t, tx } from "../../../lib/i18n";
import { Glyph } from "../../Glyph";
import { prettyCode, qrDataUrl, remoteUrl, useRemoteLink, type DeckCmd, type DeckState } from "../../study-remote-link";

export interface PresenterStep { id: string; label: string; notes?: string; rect?: { x: number; y: number; w: number; h: number } }
export interface PresenterProps {
  steps: PresenterStep[];
  start?: number;
  /** "Frame 2 of 5" / "Group 3 of 7" / "Layer · Data flow". */
  counter?: (i: number, n: number, s: PresenterStep) => string;
  /** Notes header ("PRESENTER NOTES · FRAME 2"). */
  notesHead?: (i: number, s: PresenterStep) => string;
  /** Camera mode: the whole drawing in scene units; (x0, y0) = scene point at the node's top-left. */
  scene?: { node: ReactNode; x0: number; y0: number; w: number; h: number };
  /** View mode: the content of one step (cross-fades between steps). */
  renderStep?: (i: number) => ReactNode;
  background?: { color: string; image?: string; size?: string };
  /** Step mode switch shown above the bar (architecture: Layers · Groups · C4 levels). */
  modes?: { items: [string, string][]; value: string; onChange: (v: string) => void };
  onExit: () => void;
  onStep?: (i: number) => void;
  /** Notes are editable when given (saved back, e.g. to the frame's description). */
  onNotes?: (i: number, text: string) => void;
  phone?: boolean;
  /** Phone remote room data. */
  remote?: { noteId: string; spaceId: string; title: string };
  /** Pen colour while presenting. */
  penColor?: string;
}

const BAR_BG = "#16191E", BAR_ON = "#2A2416", BAR_ON_C = "#F2A93B", BAR_C = "#E8E6E1", LASER = "#EF6B6B";
const PRESENT_CSS = `
@keyframes lumen-pr-in { from { opacity: 0; transform: translateX(4%) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes lumen-pr-back { from { opacity: 0; transform: translateX(-4%) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes lumen-pr-fade { from { opacity: 0; } to { opacity: 1; } }
.lumen-pr-cam { transition: transform 650ms cubic-bezier(.22,.8,.25,1), clip-path 650ms cubic-bezier(.22,.8,.25,1); will-change: transform; }
@media (prefers-reduced-motion: reduce) { .lumen-pr-cam { transition: none; } .lumen-pr-step { animation: none !important; } }
`;
type Pt = [number, number];

export function Presenter({ steps, start = 0, counter, notesHead, scene, renderStep, background, modes, onExit, onStep, onNotes, phone, remote, penColor = "#F2A93B" }: PresenterProps) {
  const n = steps.length;
  const [i, setI] = useState(Math.min(Math.max(0, start), Math.max(0, n - 1)));
  const [dir, setDir] = useState(1);
  const [tool, setTool] = useState<"laser" | "pen" | null>("laser");
  const [notes, setNotes] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 1280, h: 720 });
  const t0 = useRef(Date.now());
  const step = steps[i];
  const go = useCallback((k: number) => { setI((cur) => { const nx = Math.max(0, Math.min(n - 1, k)); if (nx !== cur) setDir(nx > cur ? 1 : -1); return nx; }); }, [n]);
  useEffect(() => { onStep?.(i); }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (i > n - 1) setI(Math.max(0, n - 1)); }, [n, i]);

  // full screen (desktop); leaving full screen ends the presentation
  useEffect(() => {
    const el = root.current;
    let entered = false;
    if (!phone && el?.requestFullscreen) el.requestFullscreen().then(() => { entered = true; }).catch(() => {});
    const fs = () => { if (entered && !document.fullscreenElement) onExit(); };
    document.addEventListener("fullscreenchange", fs);
    return () => { document.removeEventListener("fullscreenchange", fs); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // keyboard
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("textarea,input")) { if (e.key === "Escape") (e.target as HTMLElement).blur(); return; }
      const key = e.key;
      let used = true;
      if (key === "ArrowRight" || key === "ArrowDown" || key === "PageDown" || key === " " || key === "Enter") go(i + 1);
      else if (key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp" || key === "Backspace") go(i - 1);
      else if (key === "Home") go(0);
      else if (key === "End") go(n - 1);
      else if (key.toLowerCase() === "l") setTool((x) => (x === "laser" ? null : "laser"));
      else if (key.toLowerCase() === "p") setTool((x) => (x === "pen" ? null : "pen"));
      else if (key.toLowerCase() === "n") setNotes((x) => !x);
      else if (key === "Escape") onExit();
      else used = false;
      if (used) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  }, [i, n, go, onExit]);

  // the slide: largest 16:9 box in the stage
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => { const r = el.getBoundingClientRect(); const w = Math.min(r.width, (r.height * 16) / 9); setBox({ w: Math.max(1, w), h: Math.max(1, (w * 9) / 16) }); };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [notes]);

  // camera (scene mode)
  const cam = useMemo(() => {
    const r = step?.rect;
    if (!scene || !r) return null;
    const k = Math.min(box.w / r.w, box.h / r.h);
    const tx = box.w / 2 - (r.x + r.w / 2 - scene.x0) * k, ty = box.h / 2 - (r.y + r.h / 2 - scene.y0) * k;
    const L = box.w / 2 - (r.w * k) / 2, T = box.h / 2 - (r.h * k) / 2;
    return { k, tx, ty, clip: `inset(${T}px ${box.w - L - r.w * k}px ${box.h - T - r.h * k}px ${L}px)` };
  }, [step, scene, box]);

  // laser trail + pen ink (pen strokes kept per step for this session, in 0–1 slide units)
  const laser = useRef<HTMLCanvasElement>(null);
  const trail = useRef<{ x: number; y: number; t: number }[]>([]);
  const raf = useRef(0);
  const [ink, setInk] = useState<Record<string, Pt[][]>>({});
  const drawing = useRef<Pt[] | null>(null);
  const paintLaser = () => {
    const c = laser.current, ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = devicePixelRatio || 1;
    if (c.width !== Math.round(box.w * dpr)) { c.width = Math.round(box.w * dpr); c.height = Math.round(box.h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    const now = performance.now();
    trail.current = trail.current.filter((p) => now - p.t < 700);
    const pts = trail.current;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (let j = 1; j < pts.length; j++) {
      const a = 1 - (now - pts[j].t) / 700;
      ctx.strokeStyle = LASER; ctx.globalAlpha = Math.max(0, a) * 0.9; ctx.lineWidth = 2 + 3 * a;
      ctx.beginPath(); ctx.moveTo(pts[j - 1].x, pts[j - 1].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
    }
    const last = pts[pts.length - 1];
    if (last) { ctx.globalAlpha = 1; ctx.fillStyle = LASER; ctx.shadowColor = LASER; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(last.x, last.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; }
    raf.current = pts.length ? requestAnimationFrame(paintLaser) : 0;
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const local = (e: React.PointerEvent): Pt => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const onMove = (e: React.PointerEvent) => {
    if (tool === "laser") { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); trail.current.push({ x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() }); if (!raf.current) raf.current = requestAnimationFrame(paintLaser); }
    else if (tool === "pen" && drawing.current) { drawing.current.push(local(e)); setInk((m) => ({ ...m })); }
  };
  const onDown = (e: React.PointerEvent) => {
    if (tool !== "pen") return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const s: Pt[] = [local(e)];
    drawing.current = s;
    setInk((m) => ({ ...m, [step.id]: [...(m[step.id] ?? []), s] }));
  };
  const onUp = () => { drawing.current = null; };

  // phone remote (existing SlidesRemote Durable Object)
  const next = steps[i + 1];
  const state: DeckState = { type: "state", noteId: remote?.noteId ?? "", spaceId: remote?.spaceId ?? "", title: remote?.title ?? "", i, n, blank: false, md: `# ${step?.label ?? ""}`, notes: step?.notes ?? "", next: next?.label ?? "", nextMd: next ? `# ${next.label}` : undefined, device: phone ? "phone" : "laptop", t0: t0.current, pausedAt: null };
  const link = useRemoteLink(state, (c: DeckCmd) => { if (c.cmd === "next") go(i + 1); else if (c.cmd === "prev") go(i - 1); else if (c.cmd === "goto" && c.i != null) go(c.i); });

  const label = counter ? counter(i, n, step) : t("{n} of {total}", { n: i + 1, total: n });
  const Btn = ({ glyph, l, on, onClick, tip, disabled, remoteBtn }: { glyph?: string; l?: string; on?: boolean; onClick?: () => void; tip?: string; disabled?: boolean; remoteBtn?: boolean }) => (
    <button type="button" title={tip ?? l} aria-label={tip ?? l} aria-pressed={on} disabled={disabled} onClick={onClick} data-remote-btn={remoteBtn || undefined}
      className="flex h-10 min-w-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] text-[13px] transition-colors disabled:opacity-40"
      style={{ padding: l ? "0 12px" : 0, background: on ? BAR_ON : BAR_BG, color: on ? BAR_ON_C : BAR_C }}>
      {glyph && <Glyph name={glyph} size={18} />}{l}
    </button>
  );
  const notesOn = notes && !phone;
  const bg = background ?? { color: "var(--bg)" };
  const strokes = ink[step?.id ?? ""] ?? [];

  const body = (
    <div ref={root} dir="ltr" role="dialog" aria-label={t("Presenting")} className="fixed inset-0 z-[70] flex flex-col" style={{ background: "#08090B", animation: "lumen-pr-fade .2s ease-out" }}>
      <style>{PRESENT_CSS}</style>
      <div className="flex min-h-0 flex-1 items-center justify-center gap-6" style={{ padding: phone ? "60px 8px 0" : "40px 40px 0" }}>
        <div ref={stage} className="flex h-full min-w-0 flex-1 items-center justify-center" style={{ maxHeight: phone ? undefined : notesOn ? 560 : 700 }}>
          <div className="relative overflow-hidden rounded-[8px]" style={{ width: box.w, height: box.h, backgroundColor: bg.color, backgroundImage: bg.image, backgroundSize: bg.size, boxShadow: "0 0 0 1px #2A303B" }}>
            {scene && cam ? (
              <div className="lumen-pr-cam absolute inset-0" style={{ clipPath: cam.clip }}>
                <div className="lumen-pr-cam absolute start-0 top-0 origin-top-left" style={{ width: scene.w, height: scene.h, transform: `translate(${cam.tx}px,${cam.ty}px) scale(${cam.k})` }}>{scene.node}</div>
              </div>
            ) : renderStep ? (
              <div key={step?.id ?? i} className="lumen-pr-step absolute inset-0" style={{ animation: `${dir > 0 ? "lumen-pr-in" : "lumen-pr-back"} .45s cubic-bezier(.22,.8,.25,1)` }}>{renderStep(i)}</div>
            ) : null}
            <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 1 1" preserveAspectRatio="none">
              {strokes.map((s, j) => <polyline key={j} points={s.map((p) => p.join(",")).join(" ")} fill="none" stroke={penColor} strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />)}
            </svg>
            <canvas ref={laser} className="pointer-events-none absolute inset-0 size-full" />
            <div className="absolute inset-0" style={{ cursor: tool === "laser" ? "none" : tool === "pen" ? "crosshair" : "default", touchAction: "none" }}
              onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={onUp}
              onClick={() => { if (!tool) go(i + 1); }} />
          </div>
        </div>
        {notesOn && (
          <div className="flex w-[300px] shrink-0 flex-col gap-2.5 self-stretch rounded-[12px] p-[18px] text-[14px] leading-[22px]" style={{ background: "#12151A", color: "#C9C6BF", maxHeight: 560, alignSelf: "center", height: box.h }}>
            <span className="text-[11px] font-semibold tracking-[.08em]" style={{ color: "#7D7A73" }}>{notesHead ? notesHead(i, step) : t("PRESENTER NOTES · {n}", { n: i + 1 })}</span>
            {onNotes ? (
              <textarea key={step?.id} dir="auto" defaultValue={step?.notes ?? ""} placeholder={t("Add notes for this slide…")} onBlur={(e) => onNotes(i, e.target.value)}
                className="min-h-0 flex-1 resize-none bg-transparent text-[14px] leading-[22px] outline-none placeholder:text-[#7D7A73]" style={{ color: "#C9C6BF" }} />
            ) : <span dir="auto" className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap">{step?.notes || t("No notes for this slide.")}</span>}
            <span className="mt-auto text-[12px]" style={{ color: "#7D7A73" }}>{next ? t("Next: {name}", { name: next.label }) : t("Last slide")}</span>
          </div>
        )}
      </div>
      {modes && (
        <div className="flex justify-center pt-3">
          <div className="flex gap-[2px] rounded-[8px] p-[2px]" style={{ background: BAR_BG }}>
            {modes.items.map(([v, l]) => <button key={v} type="button" onClick={() => modes.onChange(v)} className="h-7 rounded-[6px] px-3 text-[12px]" style={v === modes.value ? { background: "#2A303B", color: BAR_C, fontWeight: 600 } : { color: "#9AA0AA" }}>{l}</button>)}
          </div>
        </div>
      )}
      <div className="relative flex items-center justify-center gap-2" style={{ padding: phone ? "18px 8px 40px" : 18 }}>
        {phone ? (<>
          <Btn glyph="slide-prev" tip={t("Previous")} onClick={() => go(i - 1)} disabled={i === 0} />
          <Btn l={`${i + 1} / ${n}`} />
          <Btn glyph="slide-next" tip={t("Next")} onClick={() => go(i + 1)} disabled={i >= n - 1} />
          <Btn glyph="laser" tip={t("Laser")} on={tool === "laser"} onClick={() => setTool(tool === "laser" ? null : "laser")} />
          <Btn glyph="pen-fountain" tip={t("Pen")} on={tool === "pen"} onClick={() => setTool(tool === "pen" ? null : "pen")} />
          <Btn glyph="x" tip={t("Exit")} onClick={onExit} />
        </>) : (<>
          <Btn glyph="slide-prev" l={t("Prev")} onClick={() => go(i - 1)} disabled={i === 0} />
          <Btn l={label} />
          <Btn glyph="slide-next" l={t("Next")} onClick={() => go(i + 1)} disabled={i >= n - 1} />
          <Btn glyph="laser" l={t("Laser")} on={tool === "laser"} onClick={() => setTool(tool === "laser" ? null : "laser")} tip={t("Laser") + " · L"} />
          <Btn glyph="pen-fountain" l={t("Pen")} on={tool === "pen"} onClick={() => setTool(tool === "pen" ? null : "pen")} tip={t("Pen") + " · P"} />
          <Btn glyph="presenter-notes" l={t("Notes")} on={notes} onClick={() => setNotes(!notes)} tip={t("Notes") + " · N"} />
          <Btn glyph="remote" l={t("Phone remote")} on={remoteOpen || link.status === "synced"} onClick={() => setRemoteOpen(!remoteOpen)} remoteBtn />
          <Btn glyph="x" l={t("Exit · Esc")} onClick={onExit} />
          {strokes.length > 0 && <button type="button" onClick={() => setInk((m) => ({ ...m, [step.id]: [] }))} className="absolute end-6 text-[12px]" style={{ color: "#9AA0AA" }}>{t("Clear ink")}</button>}
          {remoteOpen && <RemoteCard link={link} onClose={() => setRemoteOpen(false)} />}
        </>)}
      </div>
    </div>
  );
  return createPortal(body, document.body);
}

function RemoteCard({ link, onClose }: { link: ReturnType<typeof useRemoteLink>; onClose: () => void }) {
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
  const dot = link.status === "synced" ? "#6BCB8B" : link.status === "waiting" ? "#F2A93B" : "#9AA0AA";
  return (
    <div ref={ref} className="absolute bottom-[calc(100%-6px)] left-1/2 z-10 flex w-[300px] translate-x-[60px] flex-col items-center gap-3.5 rounded-[14px] border p-[18px] text-[13px] shadow-[0_16px_40px_rgba(0,0,0,.45)] fade-in" style={{ background: "#12151A", borderColor: "#2A303B", color: BAR_C }}>
      <div className="flex w-full items-center justify-between text-[12px]" style={{ color: "#9AA0AA" }}><span className="flex items-center gap-1.5"><Glyph name="remote" size={14} />{t("Phone remote")}</span><button onClick={onClose} aria-label={t("Close")}><Glyph name="x" size={14} /></button></div>
      {link.error ? <span className="text-center leading-5" style={{ color: "#9AA0AA" }}>{link.error}</span> : !link.pair ? <span className="py-8" style={{ color: "#9AA0AA" }}>{t("Opening a room…")}</span> : <>
        <div className="flex size-[168px] items-center justify-center rounded-[12px] bg-[#E8E6E1] p-3">{qr ? <img src={qr} alt={t("QR code for the phone remote")} className="size-full [image-rendering:pixelated]" /> : null}</div>
        <span dir="ltr" className="font-mono text-[22px] font-medium tracking-[.08em]">{prettyCode(link.pair.code)}</span>
        <span className="text-center text-[12px] leading-[18px]" style={{ color: "#9AA0AA" }}>{tx("Scan with your phone, or open {url}", { url: <span dir="ltr" className="break-all" style={{ color: BAR_C }}>{url.replace(/^https?:\/\//, "")}</span> })}</span>
        <div className="flex w-full items-center justify-between border-t pt-3 text-[12px]" style={{ borderColor: "#2A303B", color: "#9AA0AA" }}>
          <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full" style={{ background: dot }} />{link.status === "synced" ? t("Phone connected") : link.status === "waiting" ? t("Waiting for phone…") : t("Connecting…")}</span>
          <button onClick={() => { link.stop(); onClose(); }}>{t("Stop")}</button>
        </div>
      </>}
    </div>
  );
}
