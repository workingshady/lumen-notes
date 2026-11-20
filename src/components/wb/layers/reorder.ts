// Drag-to-reorder for panel lists (layers, frames): pointer drag on the grip, an insertion line shows where it lands
// (design 38D note). Works with mouse, pen and touch; Alt+↑ / Alt+↓ on a focused row moves it without a mouse.
import { useRef, useState, type PointerEvent as RPE } from "react";

export function useReorder(count: number, onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<{ from: number; at: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const indexAt = (y: number) => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
    for (let i = 0; i < rows.length; i++) { const r = rows[i].getBoundingClientRect(); if (y < r.top + r.height / 2) return i; }
    return rows.length;
  };
  const grip = (i: number) => ({
    onPointerDown: (e: RPE) => { e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag({ from: i, at: i }); },
    onPointerMove: (e: RPE) => { if (drag) setDrag({ from: drag.from, at: indexAt(e.clientY) }); },
    onPointerUp: () => { if (drag) { const to = drag.at > drag.from ? drag.at - 1 : drag.at; if (to !== drag.from) onMove(drag.from, Math.max(0, Math.min(count - 1, to))); } setDrag(null); },
    onPointerCancel: () => setDrag(null),
    style: { cursor: drag ? "grabbing" : "grab", touchAction: "none" as const },
  });
  const keys = (i: number) => (e: React.KeyboardEvent) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const to = e.key === "ArrowUp" ? i - 1 : i + 1;
    if (to >= 0 && to < count) onMove(i, to);
  };
  /** Insertion line before row `i` (or after the last when i === count). */
  const lineBefore = (i: number) => !!drag && drag.at === i && drag.at !== drag.from && drag.at !== drag.from + 1;
  return { list, grip, keys, drag, lineBefore };
}
