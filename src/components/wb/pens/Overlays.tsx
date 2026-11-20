// On-board overlays (W2-A): the ruler (34D), the Undo-snap chip with its 3 s countdown ring (34E), the lasso path (34F)
// and the eraser cursor.
import { useEffect, useRef, useState } from "react";
import { t } from "../../../lib/i18n";
import { Glyph } from "../../Glyph";
import { getInk, setInk, useInk } from "./model";

// ------------------------------------------------------------------ ruler
const RW = 420, RH = 52;
/** Ruler position in host px (centre); the top edge is the drawing edge. */
export const rulerState = { cx: 0, cy: 0, placed: false };
/** Top edge of the ruler in host coordinates (a, b). */
export function rulerEdge(): [[number, number], [number, number]] {
  const a = getInk().rulerAngle, c = Math.cos(a), s = Math.sin(a);
  const ox = rulerState.cx + (RH / 2) * s, oy = rulerState.cy - (RH / 2) * c; // centre of the top edge
  return [[ox - (RW / 2) * c, oy - (RW / 2) * s], [ox + (RW / 2) * c, oy + (RW / 2) * s]];
}

export function Ruler({ host }: { host: HTMLElement | null }) {
  const ink = useInk();
  const [, force] = useState(0);
  const drag = useRef<{ mode: "move" | "rot"; sx: number; sy: number; cx: number; cy: number } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ a0: number; ang: number } | null>(null);
  useEffect(() => {
    if (!rulerState.placed && host) { rulerState.cx = host.clientWidth / 2; rulerState.cy = host.clientHeight / 2; rulerState.placed = true; force((n) => n + 1); }
  }, [host]);
  if (!ink.ruler) return null;
  const deg = Math.round(((ink.rulerAngle * 180) / Math.PI + 360) % 360);
  const snap = (a: number, shift: boolean) => (shift && getInk().rulerSnap ? Math.round(a / (Math.PI / 12)) * (Math.PI / 12) : a);
  const rel = (e: React.PointerEvent) => { const r = host!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (mode: "move" | "rot") => (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, rel(e));
      if (touches.current.size === 2) { const [p, q] = [...touches.current.values()]; pinch.current = { a0: Math.atan2(q.y - p.y, q.x - p.x), ang: getInk().rulerAngle }; drag.current = null; return; }
    }
    const p = rel(e);
    drag.current = { mode, sx: p.x, sy: p.y, cx: rulerState.cx, cy: rulerState.cy };
  };
  const move = (e: React.PointerEvent) => {
    const p = rel(e);
    if (e.pointerType === "touch" && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, p);
    if (pinch.current && touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      setInk({ rulerAngle: snap(pinch.current.ang + Math.atan2(b.y - a.y, b.x - a.x) - pinch.current.a0, e.shiftKey) });
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (d.mode === "move") { rulerState.cx = d.cx + p.x - d.sx; rulerState.cy = d.cy + p.y - d.sy; force((n) => n + 1); }
    else setInk({ rulerAngle: snap(Math.atan2(p.y - rulerState.cy, p.x - rulerState.cx), e.shiftKey) });
  };
  const up = (e: React.PointerEvent) => { touches.current.delete(e.pointerId); if (touches.current.size < 2) pinch.current = null; drag.current = null; };
  const cm = 96 / 2.54;
  return (
    <div data-wb-chrome className="absolute z-20" style={{ left: rulerState.cx - RW / 2, top: rulerState.cy - RH / 2, width: RW, height: RH, transform: `rotate(${ink.rulerAngle}rad)`, touchAction: "none" }}
      onPointerDown={down("move")} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="absolute inset-0 cursor-grab rounded-[6px] border border-line" style={{ background: `repeating-linear-gradient(90deg,var(--text) 0 1px,transparent 1px ${ink.rulerCm ? cm / 10 : 10}px) 0 0/100% 40% no-repeat, repeating-linear-gradient(90deg,var(--text) 0 1px,transparent 1px ${ink.rulerCm ? cm : 50}px) 0 0/100% 70% no-repeat, color-mix(in srgb,var(--surface-2) 80%,transparent)`, boxShadow: "0 8px 22px rgba(0,0,0,.25)" }} />
      {ink.rulerCm && Array.from({ length: Math.floor(RW / cm) + 1 }, (_, i) => <span key={i} className="pointer-events-none absolute top-[37px] -translate-x-1/2 text-[9px] tabular-nums text-muted" style={{ left: i * cm }}>{i}</span>)}
      <span className="pointer-events-none absolute bottom-[6px] left-1/2 -translate-x-1/2 rounded-full bg-surface px-1.5 text-[11px] font-medium tabular-nums">{deg}°</span>
      <button type="button" aria-label={t("Rotate ruler")} title={t("Rotate · Shift snaps to 15°")} onPointerDown={down("rot")} className="absolute -right-[14px] top-1/2 size-[26px] -translate-y-1/2 cursor-alias rounded-full border border-line bg-surface shadow" />
      <button type="button" aria-label={t("Hide ruler")} title={t("Hide ruler")} onPointerDown={(e) => e.stopPropagation()} onClick={() => setInk({ ruler: false })} className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full text-muted hover:text-ink"><Glyph name="x" size={12} /></button>
    </div>
  );
}

// ------------------------------------------------------------------ snap chip
/** "Snapped to circle · Undo snap" with a countdown ring; stays 3 s, then fades. */
export function SnapChip({ x, y, name, onUndo, onDone }: { x: number; y: number; name: string; onUndo: () => void; onDone: () => void }) {
  const [fading, setFading] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const a = setTimeout(() => setFading(true), 3000);
    const b = setTimeout(() => done.current(), 3250);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [x, y, name]);
  return (
    <div data-wb-chrome role="status" onPointerDown={(e) => e.stopPropagation()} className="fade-in absolute z-30 flex h-8 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface-2 pe-1.5 ps-3 text-[12px] transition-opacity duration-200"
      style={{ left: x, top: y, opacity: fading ? 0 : 1, boxShadow: "0 8px 20px rgba(0,0,0,.25)" }}>
      {t("Snapped to {shape}", { shape: t(name) })}
      <button type="button" onClick={onUndo} className="flex h-6 items-center rounded-full bg-accent px-2.5 font-semibold text-accent-fg">{t("Undo snap")}</button>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="-rotate-90">
        <circle cx="8" cy="8" r="7" fill="none" stroke="var(--border)" strokeWidth="2" />
        <circle cx="8" cy="8" r="7" fill="none" stroke="var(--muted)" strokeWidth="2" strokeDasharray="44" style={{ animation: "lumen-snap-ring 3s linear forwards" }} />
      </svg>
      <style>{"@keyframes lumen-snap-ring { from { stroke-dashoffset: 0 } to { stroke-dashoffset: 44 } }"}</style>
    </div>
  );
}

// ------------------------------------------------------------------ lasso path + eraser cursor
export function LassoPath({ pts, erase }: { pts: [number, number][]; erase?: boolean }) {
  if (pts.length < 2) return null;
  const d = "M" + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L") + "z";
  const c = erase ? "var(--danger)" : "var(--accent)";
  return (
    <svg className="pointer-events-none absolute inset-0 z-20 size-full overflow-visible" aria-hidden>
      <path d={d} style={{ fill: `color-mix(in srgb,${c} 7%,transparent)`, stroke: c, strokeWidth: 1.5, strokeDasharray: "6 5" }} />
    </svg>
  );
}
export function EraserCursor({ x, y, r }: { x: number; y: number; r: number }) {
  return <span className="pointer-events-none absolute z-20 rounded-full border border-muted" style={{ left: x - r, top: y - r, width: r * 2, height: r * 2, background: "color-mix(in srgb,var(--muted) 12%,transparent)" }} />;
}
