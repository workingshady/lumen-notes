// Week / day / 3-day time grid (round 8, page 55 E, H; PlanDesk.dc.html screen "week", converted 1:1): 08:00–21:00,
// all-day chips (milestones as diamonds, review counts), timed items, dashed suggestions, now line. Drag any timed
// item (15-minute snap, across days) to move it; drag a suggestion to accept it where you drop it; click an empty slot
// to schedule there.
import { useEffect, useRef, useState } from "react";
import { durLabel, hm, type CalItem } from "../../lib/calendar";
import { fmtD, tint, V } from "./parts";
import { fmtNum, t } from "../../lib/i18n";

type Drag = { it: CalItem; dx: number; dy: number; x0: number; y0: number; moved: boolean; day: number; start: number };

/** Side-by-side columns for overlapping items in one day. */
function lanes(items: CalItem[]) {
  const out = new Map<string, { col: number; cols: number }>();
  const sorted = [...items].sort((a, b) => a.start! - b.start! || b.dur - a.dur);
  let group: CalItem[] = [], end = -1;
  const flush = () => {
    const cols: number[] = [];
    for (const it of group) { let c = cols.findIndex((e) => e <= it.start!); if (c < 0) { c = cols.length; cols.push(0); } cols[c] = it.start! + Math.max(it.dur, 20); out.set(it.id, { col: c, cols: 0 }); }
    for (const it of group) out.get(it.id)!.cols = cols.length;
    group = [];
  };
  for (const it of sorted) { if (it.start! >= end) flush(); group.push(it); end = Math.max(end, it.start! + Math.max(it.dur, 20)); }
  flush();
  return out;
}

export function WeekGrid({ days, today, nowMin, items, reviews, showReviews, phone, onItem, onSlot, onMove, onAccept }: {
  days: string[]; today: string; nowMin: number; items: CalItem[]; reviews: Map<string, number>; showReviews: boolean; phone: boolean;
  onItem: (it: CalItem, el: HTMLElement) => void; onSlot: (date: string, start: number) => void;
  onMove: (it: CalItem, date: string, start: number) => void; onAccept: (it: CalItem, date?: string, start?: number) => void;
}) {
  const PX = phone ? 40 : 46;
  // 08:00–21:00 as designed, stretched when something sits earlier or later that week.
  const tm = items.filter((x) => x.start != null && days.includes(x.date));
  const H0 = Math.min(8, ...tm.map((x) => Math.floor(x.start! / 60)));
  const H1 = Math.min(24, Math.max(21, ...tm.map((x) => Math.ceil((x.start! + Math.max(x.dur, 30)) / 60))));
  const cols = `52px repeat(${days.length},1fr)`;
  const hours = Array.from({ length: H1 - H0 + 1 }, (_, i) => H0 + i);
  const body = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  useEffect(() => { // scroll so the now line (or 08:00) is in view
    const el = body.current;
    if (el && days.includes(today)) el.scrollTop = Math.max(0, ((nowMin / 60 - H0) - 2) * PX);
  }, [days, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const colAt = (clientX: number) => {
    const el = body.current; if (!el) return 0;
    const r = el.getBoundingClientRect();
    const w = (r.width - 52) / days.length;
    const rtl = getComputedStyle(el).direction === "rtl";
    const x = rtl ? r.right - clientX - 52 : clientX - r.left - 52;
    return Math.max(0, Math.min(days.length - 1, Math.floor(x / w)));
  };
  const minAt = (clientY: number) => { const el = body.current!; const r = el.getBoundingClientRect(); return Math.round(((clientY - r.top + el.scrollTop) / PX * 60 + H0 * 60) / 15) * 15; };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current!; const moved = d.moved || Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 4;
      const start = Math.max(H0 * 60, Math.min(H1 * 60 - 15, minAt(e.clientY) - d.dy));
      setDrag({ ...d, moved, day: colAt(e.clientX), start });
    };
    const up = () => {
      const d = dragRef.current!; setDrag(null);
      if (!d.moved) return;
      const date = days[d.day];
      if (date === d.it.date && d.start === d.it.start) return;
      if (d.it.kind === "suggested") onAccept(d.it, date, d.start); else onMove(d.it, date, d.start);
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up, { once: true });
    return () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
  }, [drag != null]); // eslint-disable-line react-hooks/exhaustive-deps

  const movable = (it: CalItem) => it.kind === "suggested" || (it.noteId != null && it.line != null && it.kind !== "milestone" && it.kind !== "item");
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", margin: phone ? "0 12px 12px" : "0 28px 24px", border: `1px solid ${V.bd}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, borderBottom: `1px solid ${V.bd}` }}>
        <span />
        {days.map((d) => {
          const on = d === today;
          const all = items.filter((x) => x.date === d && x.start == null);
          const rv = reviews.get(d) ?? 0;
          const chips = [...(showReviews && rv ? [{ id: "rv", l: t("{n} reviews", { n: rv }), c: "#E8B34A", it: null as CalItem | null }] : []), ...all.map((x) => ({ id: x.id, l: (x.kind === "milestone" ? "◆ " : "") + x.title, c: x.color === "var(--text)" ? V.mu : x.color, it: x }))];
          return (
            <div key={d} style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 2, borderInlineStart: `1px solid ${V.bd}`, minWidth: 0 }}>
              <span style={{ fontSize: 11, color: V.mu }}>{fmtD(d, { weekday: "short" })}</span>
              <span style={{ fontSize: 18, fontWeight: on ? 700 : 500, color: on ? V.ac : V.tx }}>{fmtNum(Number(d.slice(8)))}</span>
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                {chips.slice(0, 3).map((a) => <button key={a.id} onClick={(e) => a.it && onItem(a.it, e.currentTarget)} dir="auto" style={{ fontSize: 10.5, padding: "1px 6px", borderRadius: 4, background: tint(a.c), color: a.c, whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", textDecoration: a.it?.done ? "line-through" : undefined }}>{a.l}</button>)}
                {chips.length > 3 && <span style={{ fontSize: 10.5, color: V.mu }}>+{fmtNum(chips.length - 3)}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div ref={body} style={{ flex: 1, minHeight: 0, overflowY: "auto", position: "relative" }}>
        <div style={{ position: "relative", display: "grid", gridTemplateColumns: cols, height: (H1 - H0) * PX + 8 }}>
          <div style={{ position: "relative" }}>{hours.map((h) => <span key={h} style={{ position: "absolute", top: (h - H0) * PX, insetInlineEnd: 8, fontSize: 10.5, color: V.mu, transform: "translateY(-50%)", marginTop: h === H0 ? 7 : 0 }}>{hm(h * 60)}</span>)}</div>
          {days.map((d, di) => {
            const on = d === today;
            const timed = items.filter((x) => x.date === d && x.start != null);
            const L = lanes(timed);
            return (
              <div key={d} style={{ position: "relative", borderInlineStart: `1px solid ${V.bd}`, background: on ? "color-mix(in srgb,var(--accent) 4%,transparent)" : "transparent" }}
                onClick={(e) => { if (e.target === e.currentTarget) onSlot(d, Math.max(H0 * 60, Math.floor(minAt(e.clientY) / 30) * 30)); }}>
                {hours.map((h) => <div key={h} style={{ position: "absolute", left: 0, right: 0, top: (h - H0) * PX, height: 1, background: "color-mix(in srgb,var(--border) 50%,transparent)", pointerEvents: "none" }} />)}
                {timed.map((x) => {
                  const ln = L.get(x.id)!;
                  const dragging = drag?.it.id === x.id && drag.moved;
                  const sug = x.kind === "suggested";
                  const c = x.color === "var(--text)" ? V.mu : x.color;
                  const top = (((dragging ? drag!.start : x.start!) / 60) - H0) * PX;
                  const w = 100 / ln.cols;
                  return (
                    <div key={x.id} role="button" tabIndex={0} aria-label={`${x.title} ${hm(x.start!)}`}
                      onPointerDown={(e) => { if (!movable(x) || e.button !== 0) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDrag({ it: x, dx: 0, dy: Math.round(((e.clientY - r.top) / PX) * 60 / 15) * 15, x0: e.clientX, y0: e.clientY, moved: false, day: di, start: x.start! }); }}
                      onClick={(e) => { if (drag?.moved) return; if (sug) onAccept(x); else onItem(x, e.currentTarget); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { if (sug) onAccept(x); else onItem(x, e.currentTarget); } }}
                      title={sug ? t("Suggested from your plan’s pace. Click to accept, or drag it.") : undefined}
                      style={{ position: "absolute", insetInlineStart: dragging ? `calc(${(drag!.day - di) * 100}% + 3px)` : `calc(${ln.col * w}% + 3px)`, width: dragging ? "calc(100% - 6px)" : `calc(${w}% - 6px)`, top: top + 1, height: Math.max(18, (Math.max(x.dur, 20) / 60) * PX - 2), borderRadius: 6, background: sug ? "transparent" : tint(c), borderInlineStart: `3px solid ${c}`, outline: sug ? `1.5px dashed ${c}` : "none", outlineOffset: -1, padding: "4px 6px", boxSizing: "border-box", overflow: "hidden", display: "flex", flexDirection: "column", gap: 1, cursor: movable(x) ? "grab" : "pointer", opacity: x.done ? 0.55 : 1, zIndex: dragging ? 5 : 1, boxShadow: dragging ? "0 8px 20px rgba(0,0,0,.35)" : "none", transition: dragging ? "none" : "top .12s var(--ease)", touchAction: "none" }}>
                      <span dir="auto" style={{ fontSize: 11, fontWeight: 600, lineHeight: "14px", textDecoration: x.done ? "line-through" : "none" }}>{x.title}</span>
                      <span style={{ fontSize: 10, color: V.mu }}>{hm(dragging ? drag!.start : x.start!)} · {durLabel(x.dur || 30)}{sug ? ` · ${t("suggested")}` : ""}</span>
                    </div>
                  );
                })}
                {on && nowMin >= H0 * 60 && nowMin <= H1 * 60 && <div style={{ position: "absolute", left: 0, right: 0, top: (nowMin / 60 - H0) * PX, height: 2, background: V.ac, pointerEvents: "none", zIndex: 4 }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
