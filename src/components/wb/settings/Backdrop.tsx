// Board backdrop: background colour + pattern drawn as a CSS layer behind the transparent Excalidraw canvas (brief §6).
// The pattern lives in scene space (moves and scales with scroll / zoom); in pages mode A4 / Letter / 16:9 pages stack
// vertically from the origin and the pattern is drawn on the pages only.
import { forwardRef, useImperativeHandle, useRef } from "react";
import { boardColor, lineColor, PAGE_GAP, PAGE_SIZE, patternCss, type LumenBoard } from "./model";

export interface BackdropHandle { update: (st: { zoom: { value: number }; scrollX: number; scrollY: number }, bottom?: number) => void }
const MAX_PAGES = 40;

export const Backdrop = forwardRef<BackdropHandle, { board: LumenBoard; dark: boolean }>(function Backdrop({ board, dark }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const last = useRef<{ zoom: { value: number }; scrollX: number; scrollY: number } | null>(null);
  const bottomRef = useRef(0);
  const bg = boardColor(board);
  const lc = lineColor(board, dark);
  const transparent = board.bg === "transparent";
  const paint = () => {
    const st = last.current, el = root.current;
    if (!st || !el) return;
    const z = st.zoom.value;
    const pat = patternCss(board.pattern, lc, board.density, z);
    const ox = st.scrollX * z, oy = st.scrollY * z;
    const apply = (t: HTMLElement, x: number, y: number) => {
      if (transparent) { t.style.backgroundImage = "conic-gradient(var(--surface-2) 25%,var(--bg) 0 50%,var(--surface-2) 0 75%,var(--bg) 0)"; t.style.backgroundSize = "20px 20px"; t.style.backgroundPosition = "0 0"; t.style.backgroundRepeat = "repeat"; return; }
      t.style.backgroundImage = pat.image; t.style.backgroundSize = pat.size; t.style.backgroundRepeat = pat.repeat ?? "repeat";
      t.style.backgroundPosition = pat.image === "none" ? "0 0" : pat.image.split("),").map(() => `${x}px ${y}px`).join(", ");
    };
    if (board.mode === "infinite") { apply(el, ox, oy); return; }
    el.style.backgroundImage = "none";
    const host = pages.current;
    if (!host) return;
    const [pw, ph] = PAGE_SIZE[board.mode];
    const n = Math.min(MAX_PAGES, Math.max(3, Math.ceil((bottomRef.current + ph) / (ph + PAGE_GAP))));
    while (host.children.length < n) { const d = document.createElement("div"); d.style.cssText = "position:absolute;box-shadow:0 1px 0 rgba(0,0,0,.05),0 8px 24px rgba(0,0,0,.18);border-radius:2px"; host.appendChild(d); }
    [...host.children].forEach((c, i) => {
      const d = c as HTMLDivElement;
      if (i >= n) { d.style.display = "none"; return; }
      const x = ox, y = oy + i * (ph + PAGE_GAP) * z;
      Object.assign(d.style, { display: "block", left: `${x}px`, top: `${y}px`, width: `${pw * z}px`, height: `${ph * z}px`, backgroundColor: bg });
      apply(d, 0, 0);
    });
  };
  useImperativeHandle(ref, () => ({ update: (st, bottom) => { last.current = st; if (bottom != null) bottomRef.current = bottom; paint(); } }));
  // re-paint after a settings change (same render pass)
  queueMicrotask(paint);
  return (
    <div ref={root} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden transition-[background-color] duration-200"
      style={{ backgroundColor: board.mode === "infinite" ? bg : "color-mix(in srgb,var(--surface-2) 70%,var(--bg))" }}>
      {board.mode !== "infinite" && <div ref={pages} className="absolute inset-0" />}
    </div>
  );
});
