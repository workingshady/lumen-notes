// The four plan views (design round 8: PlanViews.dc.html, Lumen 54 A–D / M–P), converted 1:1 and wired to the plan
// model (lib/plan-model.ts): Timeline (Gantt with dependencies + milestones), Lanes (track / owner), Board
// (Overdue · Now · Next · Later · Done, drag to reschedule) and Agenda (by week, load against pace, milestones).
import { useMemo, useState, type DragEvent, type MouseEvent as RMouseEvent } from "react";
import {
  bucketItems, daysLate, groupItems, isDone, itemColor, monthStart, mondayOf, planSpan, weeklyLoad, dateOf,
  type Bucket, type Day, type Plan, type PlanItem,
} from "../../lib/plan-model";
import { fmtNum, t } from "../../lib/i18n";
import { AC16, fmtDay, monthShort, type PlanWrites } from "./plan-ui";

export interface ViewProps {
  plan: Plan; today: Day; phone: boolean; width: number; height: number; items: PlanItem[];
  writes: PlanWrites; onItem: (i: PlanItem, e: RMouseEvent) => void; scrollRef?: (el: HTMLDivElement | null) => void;
}
const AV_TX = "#1A1206";

// ------------------------------------------------------------------ time axis (shared by Timeline and Lanes)
export function axis(plan: Plan, zoom: "week" | "month" | "quarter", viewW: number, today: Day) {
  const sp = planSpan(plan);
  const lo = Math.min(sp.lo, today), hi = Math.max(sp.hi + 3, lo + 14);
  const total = hi - lo;
  const fit = (viewW - 30) / total;
  const pxD = zoom === "week" ? 44 / 7 : zoom === "quarter" ? fit * 0.8 : fit;
  const X = (d: Day) => (d - lo) * pxD;
  const ticks: { x: number; top: number; c: string }[] = [], labels: { x: number; w: number; l: string; c: string; fw: number }[] = [], years: { x: number; l: string }[] = [];
  if (zoom === "week") {
    for (let d = mondayOf(lo); d <= hi; d += 7) {
      const D = dateOf(d), first = D.getUTCDate() <= 7;
      ticks.push({ x: X(d), top: 48, c: first ? "var(--bd)" : "color-mix(in srgb,var(--bd) 45%,transparent)" });
      const cur = today >= d && today < d + 7;
      labels.push({ x: X(d), w: 7 * pxD, l: fmtNum(D.getUTCDate()), c: cur ? "var(--ac)" : "var(--mu)", fw: cur ? 650 : 400 });
      if (first || d === mondayOf(lo)) years.push({ x: X(d), l: monthShort(D.getUTCMonth()) + (D.getUTCMonth() === 0 || d === mondayOf(lo) ? ` ${fmtNum(D.getUTCFullYear(), { useGrouping: false })}` : "") });
    }
  } else {
    for (let m = 0; m < 120; m++) {
      const ms = monthStart(lo, m);
      if (ms > hi) break;
      const D = dateOf(ms), a = Math.max(ms, lo), b = Math.min(monthStart(lo, m + 1), hi), w = (b - a) * pxD;
      ticks.push({ x: X(a), top: D.getUTCMonth() === 0 ? 0 : 48, c: D.getUTCMonth() === 0 ? "var(--mu)" : "var(--bd)" });
      const cur = today >= a && today < b;
      if (zoom === "quarter") { if (D.getUTCMonth() % 3 === 0 || m === 0) { const qe = Math.min(monthStart(lo, m + 3 - (D.getUTCMonth() % 3)), hi); labels.push({ x: X(a), w: (qe - a) * pxD, l: `Q${Math.floor(D.getUTCMonth() / 3) + 1}`, c: cur ? "var(--ac)" : "var(--mu)", fw: cur ? 650 : 400 }); } }
      else labels.push({ x: X(a), w, l: w > 26 ? monthShort(D.getUTCMonth()) : w > 12 ? monthShort(D.getUTCMonth())[0] : "", c: cur ? "var(--ac)" : "var(--mu)", fw: cur ? 650 : 400 });
      if (m === 0 || D.getUTCMonth() === 0) years.push({ x: X(a), l: fmtNum(D.getUTCFullYear(), { useGrouping: false }) });
    }
  }
  return { lo, hi, pxD, X, ticks, labels, years, gridW: Math.max(viewW, total * pxD + 40) };
}

function AxisHeader({ ax, h = 48 }: { ax: ReturnType<typeof axis>; h?: number }) {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: h, borderBottom: "1px solid var(--bd)", background: "var(--bg)", zIndex: 1 }}>
      {ax.years.map((y, k) => <span key={k} style={{ position: "absolute", left: y.x, top: 7, fontSize: 11, fontWeight: 650, paddingLeft: 6, whiteSpace: "nowrap" }}>{y.l}</span>)}
      {ax.labels.map((l, k) => <span key={k} style={{ position: "absolute", left: l.x, width: l.w, top: 26, fontSize: 11.5, color: l.c, fontWeight: l.fw, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden" }}>{l.l}</span>)}
    </div>
  );
}
function TodayLine({ x, top = 38, pill = true }: { x: number; top?: number; pill?: boolean }) {
  return (
    <>
      <div data-today style={{ position: "absolute", left: x, top, bottom: 0, width: 2, background: "var(--ac)", zIndex: 2 }} />
      {pill && <span style={{ position: "absolute", left: x, top: top - 4, transform: "translateX(-50%)", height: 16, padding: "0 6px", borderRadius: 999, background: "var(--ac)", color: "var(--af)", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", zIndex: 2 }}>{t("Today")}</span>}
    </>
  );
}

// ------------------------------------------------------------------ Timeline (Gantt)
export function Gantt({ plan, today, phone, width, items, onItem, scrollRef, folded, onFold }: ViewProps & { folded: Set<string>; onFold: (k: string) => void }) {
  const colW = phone ? 132 : 260, viewW = Math.max(200, width - colW);
  const ax = axis(plan, plan.prefs.zoom, viewW, today);
  const groups = groupItems(plan, plan.prefs.group, items).filter((g) => g.items.length || plan.prefs.show.includes("empty"));
  const GH = 34, IH = 34;
  const rows: { h: number; pl: number; chev: string; dot?: string; l: string; fs: number; fw: number; n: string; bg: string; bb: string; bl: string; av?: string; avC?: string; key: string; item?: PlanItem; group?: string }[] = [];
  const bars: { x: number; y: number; w: number; h: number; r: number; bg: string; bd: string; ring: string; prog: string; pc: string; l: string; tip: string; o: boolean; ox: number; oy: number; ol: string; oc: string; ofw: number; item?: PlanItem }[] = [];
  const rowAt = new Map<string, number>();
  let y = 48;
  const lateTxt = (i: PlanItem) => t("overdue {n} day|overdue {n} days", { n: daysLate(i, today) });
  for (const g of groups) {
    const open = !folded.has(g.key);
    const its = g.items;
    const gs = its.length ? Math.min(...its.map((i) => i.start)) : ax.lo, ge = its.length ? Math.max(...its.map((i) => i.end + 1)) : ax.lo;
    const gd = its.filter((i) => i.status === "done").length;
    rows.push({ key: g.key, group: g.key, h: GH, pl: 12, chev: open ? "⌄" : "›", dot: g.color, l: g.name, fs: 13, fw: 650, n: plan.kind === "course" && plan.groupBy === "Level" ? "" : `${fmtNum(gd)}/${fmtNum(its.length)}`, bg: "var(--sf)", bb: "var(--bd)", bl: "transparent" });
    if (its.length) bars.push({ x: ax.X(gs), y: y + 10, w: (ge - gs) * ax.pxD, h: 14, r: 4, bg: `color-mix(in srgb,${g.color} 22%,transparent)`, bd: "transparent", ring: "none", prog: `${(gd / its.length) * 100}%`, pc: g.color, l: "", tip: g.name, o: false, ox: 0, oy: 0, ol: "", oc: "", ofw: 400 });
    y += GH;
    if (!open) continue;
    for (const i of its) {
      const late = daysLate(i, today) > 0, active = i.status === "doing" || i.status === "review";
      const gc = itemColor(plan, i);
      rowAt.set(i.name.toLowerCase(), y);
      rows.push({ key: i.key, item: i, h: IH, pl: 26, chev: "", l: i.name, fs: 12.5, fw: active || late ? 600 : 400, n: i.count > 1 ? `${fmtNum(i.count)} ${t(plan.unit)}` : "", bg: "transparent", bb: "color-mix(in srgb,var(--bd) 50%,transparent)", bl: active ? "var(--ac)" : late ? "var(--da)" : "transparent", av: i.owner ? (plan.people[i.owner] ?? i.owner)[0].toUpperCase() : undefined, avC: i.owner ? personC(plan, i.owner) : undefined });
      const w = Math.max(6, (i.end + 1 - i.start) * ax.pxD), lbl = w > 110 ? i.name : "";
      const prog = i.src === "module" && i.count ? (i.doneCount ?? 0) / i.count : active ? 0.45 : 0;
      bars.push({
        item: i, x: ax.X(i.start), y: y + 7, w, h: 20, r: 6, bg: i.status === "done" ? `color-mix(in srgb,${gc} 45%,transparent)` : `color-mix(in srgb,${gc} 14%,var(--bg))`,
        bd: late ? "var(--da)" : active ? "var(--ac)" : `color-mix(in srgb,${gc} 45%,transparent)`, ring: active ? "0 0 0 3px color-mix(in srgb,var(--ac) 20%,transparent)" : "none",
        prog: `${prog * 100}%`, pc: `color-mix(in srgb,${gc} 45%,transparent)`, l: lbl, tip: i.name, o: lbl ? late : true, ox: ax.X(i.end + 1) + 8, oy: y + 10,
        ol: late ? (lbl ? "" : `${i.name} · `) + lateTxt(i) : i.name, oc: late ? "var(--da)" : "var(--mu)", ofw: late ? 600 : 400,
      });
      y += IH;
    }
  }
  const deps: string[] = [];
  if (plan.prefs.show.includes("deps")) for (const i of items) for (const n of i.needs) {
    const p = items.find((x) => x.name.toLowerCase() === n.toLowerCase());
    const ya = p && rowAt.get(p.name.toLowerCase()), yb = rowAt.get(i.name.toLowerCase());
    if (!p || ya == null || yb == null) continue;
    const x1 = ax.X(p.end + 1), x2 = ax.X(i.start);
    deps.push(`M${x1} ${ya + 17} H${x1 + 8} V${yb + 17} H${x2}`);
  }
  const showMs = plan.prefs.show.includes("milestones") && plan.milestones.length > 0;
  const msY = y;
  if (showMs) { rows.push({ key: "ms", h: 40, pl: 12, chev: "", l: t("Milestones"), fs: 12.5, fw: 600, n: fmtNum(plan.milestones.length), bg: "transparent", bb: "transparent", bl: "transparent" }); y += 40; }
  const H = Math.max(y + 20, 300);
  return (
    <div ref={scrollRef} style={{ flex: 1, minWidth: 0, overflow: "auto", position: "relative", scrollbarWidth: "thin" }}>
      <div style={{ display: "flex", width: colW + ax.gridW, minHeight: "100%", height: H, position: "relative" }}>
        <div style={{ width: colW, flexShrink: 0, borderInlineEnd: "1px solid var(--bd)", display: "flex", flexDirection: "column", zIndex: 3, background: "var(--bg)", position: "sticky", left: 0 }}>
          <div style={{ height: 48, flexShrink: 0, display: "flex", alignItems: "flex-end", padding: "0 14px 8px 20px", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", color: "var(--mu)", borderBottom: "1px solid var(--bd)", boxSizing: "border-box", position: "sticky", top: 0, background: "var(--bg)", zIndex: 1 }}>{t(plan.prefs.group === "group" ? plan.groupBy : GROUP_HEAD[plan.prefs.group]).toUpperCase()}</div>
          {rows.map((r) => (
            <div key={r.key} className="pl-row" role={r.item || r.group ? "button" : undefined} tabIndex={r.item || r.group ? 0 : undefined}
              onClick={(e) => { if (r.group) onFold(r.group); else if (r.item) onItem(r.item, e); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (r.group) onFold(r.group); else if (r.item) onItem(r.item, e as unknown as RMouseEvent); } }}
              style={{ height: r.h, flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: `0 12px 0 ${r.pl}px`, boxSizing: "border-box", background: r.bg, borderBottom: `1px solid ${r.bb}`, borderInlineStart: `3px solid ${r.bl}`, cursor: r.item || r.group ? "pointer" : "default" }}>
              <span style={{ width: 12, color: "var(--mu)", fontSize: 12 }}>{r.chev}</span>
              {r.dot && <span style={{ width: 10, height: 10, borderRadius: 3, background: r.dot, flexShrink: 0 }} />}
              <span dir="auto" style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: r.fs, fontWeight: r.fw }}>{r.l}</span>
              {r.av && <span style={{ width: 20, height: 20, borderRadius: "50%", background: r.avC, color: AV_TX, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{r.av}</span>}
              {!phone && <span style={{ fontSize: 11.5, color: "var(--mu)", whiteSpace: "nowrap" }}>{r.n}</span>}
            </div>
          ))}
        </div>
        <div style={{ position: "relative", width: ax.gridW, flexShrink: 0 }}>
          {ax.ticks.map((tk, k) => <div key={k} style={{ position: "absolute", left: tk.x, top: tk.top, bottom: 0, width: 1, background: tk.c }} />)}
          <div style={{ position: "sticky", top: 0, height: 48, zIndex: 2 }}><AxisHeader ax={ax} /></div>
          <svg width={ax.gridW} height={H} style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}>{deps.map((d, k) => <path key={k} d={d} style={{ fill: "none", stroke: "var(--mu)", strokeWidth: 1.3, strokeDasharray: "3 3" }} />)}</svg>
          {bars.map((b, k) => (
            <div key={k}>
              <div title={b.tip} className={b.item ? "pl-bar" : undefined} onClick={b.item ? (e) => onItem(b.item!, e) : undefined}
                style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: b.r, background: b.bg, border: `1px solid ${b.bd}`, boxSizing: "border-box", overflow: "hidden", display: "flex", alignItems: "center", boxShadow: b.ring }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: b.prog, background: b.pc }} />
                <span dir="auto" style={{ position: "relative", padding: "0 8px", fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", color: "var(--tx)" }}>{b.l}</span>
              </div>
              {b.o && b.ol && <span dir="auto" style={{ position: "absolute", left: b.ox, top: b.oy, fontSize: 11.5, color: b.oc, whiteSpace: "nowrap", fontWeight: b.ofw }}>{b.ol}</span>}
            </div>
          ))}
          {showMs && plan.milestones.map((m, k) => (
            <div key={k} title={`${m.name} · ${fmtDay(m.day)}`}>
              <div style={{ position: "absolute", left: ax.X(m.day), top: msY + 14, width: 12, height: 12, marginLeft: -6, transform: "rotate(45deg)", background: m.done ? "var(--ac)" : "var(--bg)", border: "2px solid var(--ac)", boxSizing: "border-box" }} />
              <span dir="auto" style={{ position: "absolute", left: ax.X(m.day) + 10, top: msY + 12, fontSize: 11.5, color: "var(--tx)", fontWeight: 600, whiteSpace: "nowrap" }}>{m.name}</span>
            </div>
          ))}
          <TodayLine x={ax.X(today)} />
        </div>
      </div>
    </div>
  );
}
const GROUP_HEAD: Record<string, string> = { track: "Track", owner: "Owner", status: "Status", tag: "Tag", source: "Source note", none: "Item", group: "Group" };
function personC(plan: Plan, owner: string) { return itemColor(plan, { ...plan.items[0], owner, status: "todo" }, "owner"); }

// ------------------------------------------------------------------ Lanes
export function Lanes({ plan, today, phone, width, height, items, onItem, scrollRef }: ViewProps) {
  const ax = axis(plan, plan.prefs.zoom, width, today);
  const byOwner = plan.owners;
  const lanesG = groupItems(plan, byOwner ? "owner" : "track", items);
  const pend: number[] = [];
  const phases = plan.groups.map((g, gi) => {
    const its = items.filter((i) => i.group === gi);
    if (!its.length) return null;
    const gs = Math.min(...its.map((i) => i.start)), ge = Math.max(...its.map((i) => i.end + 1));
    let r = 0; while (pend[r] != null && pend[r] > gs) r++; pend[r] = ge;
    return { x: ax.X(gs), w: (ge - gs) * ax.pxD - 4, l: g.name, c: g.color, y: 4 + r * 20 };
  }).filter((p): p is NonNullable<typeof p> => !!p);
  const head = Math.max(48, 8 + pend.length * 20);
  const LH0 = phone ? 110 : Math.min(150, Math.floor((height - head) / Math.max(1, lanesG.length)));
  const lanes: { y: number; h: number; l: string; n: string; av?: string; c: string }[] = [];
  const lbars: { x: number; y: number; w: number; l: string; s: string; bg: string; bd: string; ring: string; item: PlanItem }[] = [];
  let y0 = head;
  for (const ln of lanesG) {
    const sub: number[] = [];
    const start = lbars.length;
    for (const i of [...ln.items].sort((a, b) => a.start - b.start)) {
      let k = 0; while (sub[k] != null && sub[k] > i.start) k++; sub[k] = i.end + 1;
      const gc = itemColor(plan, i), late = daysLate(i, today) > 0;
      lbars.push({ item: i, x: ax.X(i.start) + 2, y: y0 + 34 + k * 40, w: Math.max(24, (i.end + 1 - i.start) * ax.pxD - 4), l: i.name, s: `${fmtDay(i.start)} – ${fmtDay(i.end)}${late ? ` · ${t("overdue")}` : ""}`,
        bg: i.status === "done" ? `color-mix(in srgb,${gc} 30%,var(--bg))` : `color-mix(in srgb,${gc} 12%,var(--bg))`, bd: late ? "var(--da)" : i.status === "doing" ? "var(--ac)" : `color-mix(in srgb,${gc} 45%,transparent)`, ring: i.status === "doing" ? "0 0 0 3px color-mix(in srgb,var(--ac) 20%,transparent)" : "none" });
    }
    const h = Math.max(LH0, 34 + sub.length * 40 + 8);
    lanes.push({ y: y0, h, l: ln.name, n: fmtNum(lbars.length - start), av: byOwner ? ln.avatar : undefined, c: ln.color });
    y0 += h;
  }
  return (
    <div ref={scrollRef} style={{ flex: 1, minWidth: 0, position: "relative", overflow: "auto" }}>
      <div style={{ position: "relative", width: ax.gridW, height: Math.max(y0, height - 2) }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: head, borderBottom: "1px solid var(--bd)" }}>
          {phases.map((p, k) => <div key={k} style={{ position: "absolute", left: p.x, width: p.w, top: p.y, height: 18, fontSize: 11, padding: "0 10px", boxSizing: "border-box", display: "flex", alignItems: "center", gap: 8, borderRadius: 8, background: `color-mix(in srgb,${p.c} 14%,transparent)`, borderLeft: `3px solid ${p.c}`, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden" }} dir="auto">{p.l}</div>)}
        </div>
        {ax.ticks.map((tk, k) => <div key={k} style={{ position: "absolute", left: tk.x, top: head, bottom: 0, width: 1, background: "color-mix(in srgb,var(--bd) 60%,transparent)" }} />)}
        {lanes.map((ln, k) => (
          <div key={k} style={{ position: "absolute", left: 0, right: 0, top: ln.y, height: ln.h, borderBottom: "1px solid var(--bd)" }}>
            <span style={{ position: "sticky", left: 12, marginLeft: 12, top: 8, display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 650, color: "var(--mu)", zIndex: 1, background: "var(--bg)", paddingRight: 8, marginTop: 8 }}>
              {ln.av && <span style={{ width: 22, height: 22, borderRadius: "50%", background: ln.c, color: AV_TX, fontSize: 10.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{ln.av}</span>}
              <span dir="auto">{ln.l}</span><span style={{ fontWeight: 400 }}>{ln.n}</span>
            </span>
          </div>
        ))}
        {lbars.map((b) => (
          <div key={b.item.key} className="pl-bar" onClick={(e) => onItem(b.item, e)} title={b.l}
            style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: 34, borderRadius: 8, background: b.bg, border: `1px solid ${b.bd}`, boxSizing: "border-box", padding: "0 10px", display: "flex", flexDirection: "column", justifyContent: "center", overflow: "hidden", boxShadow: b.ring }}>
            <span dir="auto" style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.l}</span>
            <span style={{ fontSize: 10.5, color: "var(--mu)", whiteSpace: "nowrap" }}>{b.s}</span>
          </div>
        ))}
        <TodayLine x={ax.X(today)} top={head - 4} pill={false} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Board
const COLS: [Bucket, string, string][] = [["overdue", "Overdue", "var(--da)"], ["now", "Now", "var(--ac)"], ["next", "Next", "var(--ln)"], ["later", "Later", "var(--mu)"], ["done", "Done", "var(--ok)"]];
export function Board({ plan, today, phone, items, writes, onItem }: ViewProps) {
  const nextDays = Math.max(14, Math.round((planSpan(plan).hi - planSpan(plan).lo) / 5));
  const b = bucketItems(items, today, nextDays);
  const [more, setMore] = useState<Set<Bucket>>(new Set());
  const [over, setOver] = useState<Bucket | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  /** Drop = reschedule: Now starts today, Next in a week, Later in four weeks (duration kept), Done marks it done. */
  const drop = (col: Bucket, e: DragEvent) => {
    e.preventDefault(); setOver(null);
    const it = items.find((i) => i.key === (e.dataTransfer.getData("text/plan-item") || drag));
    setDrag(null);
    if (!it || col === "overdue") return;
    const dur = it.end - it.start;
    if (col === "done") return void writes.status(it, "done");
    const s = col === "now" ? today : col === "next" ? today + 7 : today + 28;
    void writes.both(it, col === "now" ? "doing" : "todo", s, s + dur);
  };
  const max = phone ? 5 : 4;
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 14, padding: phone ? "12px 14px" : "16px 28px", overflow: "auto" }}>
      {COLS.map(([k, l, c], ci) => {
        if (phone && ci > 1) return null;
        const its = b[k].filter((i) => k !== "done" || plan.prefs.show.includes("done"));
        const open = more.has(k);
        return (
          <div key={k} className={over === k ? "pl-drop" : undefined} onDragOver={(e) => { if (k !== "overdue") { e.preventDefault(); setOver(k); } }} onDragLeave={() => setOver((o) => (o === k ? null : o))} onDrop={(e) => drop(k, e)}
            style={{ flex: 1, minWidth: phone ? 0 : 200, display: "flex", flexDirection: "column", gap: 8, background: "var(--sf)", border: "1px solid var(--bd)", borderRadius: 14, padding: 10, alignSelf: "flex-start", maxHeight: "100%", overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px 4px" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: c }} /><span style={{ fontWeight: 650, fontSize: 13 }}>{t(l)}</span><span style={{ color: "var(--mu)", fontSize: 12 }}>{fmtNum(its.length)}</span>
              <span style={{ flex: 1 }} /><span style={{ fontSize: 11.5, color: k === "now" && its.length > 3 ? "var(--da)" : "var(--mu)" }}>{k === "now" ? t("WIP {n}", { n: 3 }) : ""}</span>
            </div>
            {(open ? its : its.slice(0, max)).map((i) => {
              const gc = itemColor(plan, i), late = k === "overdue";
              return (
                <div key={i.key} draggable onDragStart={(e) => { e.dataTransfer.setData("text/plan-item", i.key); e.dataTransfer.effectAllowed = "move"; setDrag(i.key); }} onDragEnd={() => { setDrag(null); setOver(null); }}
                  onClick={(e) => onItem(i, e)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onItem(i, e as unknown as RMouseEvent); }}
                  style={{ display: "flex", flexDirection: "column", gap: 7, padding: "10px 12px", borderRadius: 10, background: "var(--bg)", border: `1px solid ${late ? "var(--da)" : "var(--bd)"}`, opacity: k === "done" ? 0.7 : drag === i.key ? 0.5 : 1, cursor: "grab" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--mu)" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: gc }} /><span dir="auto" style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{plan.groups[i.group]?.name}</span>
                    {i.owner && <span style={{ width: 18, height: 18, borderRadius: "50%", background: personC(plan, i.owner), color: AV_TX, fontSize: 9.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{(plan.people[i.owner] ?? i.owner)[0].toUpperCase()}</span>}
                  </div>
                  <span dir="auto" style={{ fontSize: 13, fontWeight: 600, lineHeight: "18px" }}>{i.name}</span>
                  {k === "now" && <div style={{ height: 4, borderRadius: 2, background: "var(--sf2)" }}><div style={{ width: `${i.src === "module" && i.count ? ((i.doneCount ?? 0) / i.count) * 100 : 45}%`, height: "100%", borderRadius: 2, background: gc }} /></div>}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: late ? "var(--da)" : "var(--mu)" }}>
                    <span>{k === "done" ? t("Done {date}", { date: fmtDay(i.end) }) : t("Due {date}", { date: fmtDay(i.end) })}</span><span style={{ flex: 1 }} />
                    <span style={{ color: "var(--mu)" }}>{i.count > 1 ? `${fmtNum(i.count)} ${t(plan.unit)}` : ""}</span>
                  </div>
                </div>
              );
            })}
            {its.length > max && <button onClick={() => setMore((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} style={{ fontSize: 12, color: "var(--mu)", padding: 4, textAlign: "start" }}>{open ? t("Show less") : t("+ {n} more", { n: its.length - max })}</button>}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ Agenda
export function Agenda({ plan, today, phone, items, writes, onItem }: ViewProps) {
  const w0 = mondayOf(today);
  const load = useMemo(() => weeklyLoad({ ...plan, items }, today, 8), [plan, items, today]);
  const weeks = Array.from({ length: phone ? 3 : 4 }, (_, k) => {
    const a = w0 + k * 7, b = a + 6;
    const its = items.filter((i) => !isDone(i) && (k === 0 ? i.start <= b && i.end >= a : i.start >= a && i.start <= b)).sort((x, y) => x.start - y.start);
    const carried = k > 0 ? items.filter((i) => !isDone(i) && i.start < a && i.end >= a).length : 0;
    const ms = plan.milestones.filter((m) => m.day >= a && m.day <= b);
    const h = load[k]?.hours ?? 0;
    return { a, b, k, its: its.slice(0, 4), extra: its.length - 4, carried, ms, h };
  });
  const maxH = Math.max(plan.pace || 4, ...load.map((l) => l.hours));
  const anyOver = load.some((l) => l.over);
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 28, padding: phone ? "0 16px" : "8px 28px", overflow: "auto", justifyContent: "center" }}>
      <div style={{ flex: 1, maxWidth: 760, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {weeks.map((w) => (
          <div key={w.k} style={{ display: "flex", flexDirection: "column", paddingBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "12px 0 8px", borderBottom: "1px solid var(--bd)" }}>
              <span style={{ fontSize: 14, fontWeight: 650, color: w.k === 0 ? "var(--ac)" : "var(--tx)" }}>{w.k === 0 ? t("This week") : w.k === 1 ? t("Next week") : t("Week of {date}", { date: fmtDay(w.a) })}</span>
              <span style={{ fontSize: 12, color: "var(--mu)" }}>{fmtDay(w.a)} – {fmtDay(w.b)}</span><span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: "var(--mu)" }}>{w.h ? t("{n} h planned", { n: fmtNum(Math.round(w.h)) }) : ""}</span>
            </div>
            {w.its.map((i) => {
              const late = daysLate(i, today) > 0, act = i.status === "doing" || i.status === "review";
              const chip = late ? t("Overdue") : act ? t("In progress") : plan.owners && i.owner ? plan.people[i.owner] ?? i.owner : "";
              return (
                <div key={i.key} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 46, padding: "4px 0", borderBottom: "1px solid color-mix(in srgb,var(--bd) 50%,transparent)" }}>
                  <button aria-label={t("Mark done")} title={t("Mark done")} disabled={i.src === "module"} onClick={() => void writes.status(i, "done")}
                    style={{ width: 20, height: 20, borderRadius: 6, border: `1.5px solid ${late ? "var(--da)" : "var(--bd)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} />
                  <button onClick={(e) => onItem(i, e)} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span dir="auto" style={{ fontSize: 13.5, fontWeight: act || late ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.name}</span>
                    <span style={{ fontSize: 11.5, color: "var(--mu)", display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: itemColor(plan, i) }} /><span dir="auto">{plan.groups[i.group]?.name}</span></span>
                  </button>
                  {chip && <span style={{ height: 22, padding: "0 8px", borderRadius: 999, fontSize: 11, fontWeight: 650, display: "flex", alignItems: "center", background: late ? "color-mix(in srgb,var(--da) 16%,transparent)" : AC16, color: late ? "var(--da)" : "var(--ac)", whiteSpace: "nowrap" }}>{chip}</span>}
                  <span style={{ fontSize: 12, color: "var(--mu)", whiteSpace: "nowrap", width: phone ? "auto" : 90, textAlign: "end" }}>{t("until {date}", { date: fmtDay(i.end) })}</span>
                </div>
              );
            })}
            {(w.carried > 0 || w.extra > 0) && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 46, padding: "4px 0", borderBottom: "1px solid color-mix(in srgb,var(--bd) 50%,transparent)" }}>
                <span style={{ width: 20, height: 20, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 13.5, color: "var(--mu)" }}>{w.extra > 0 ? t("+ {n} more", { n: w.extra }) : t("{n} items continue from earlier weeks", { n: w.carried })}</span>
                  <span style={{ fontSize: 11.5, color: "var(--mu)", display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: "var(--bd)" }} />{t("Carried over")}</span>
                </div>
              </div>
            )}
            {w.ms.map((m, k) => (
              <div key={`m${k}`} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 46, padding: "4px 0", borderBottom: "1px solid color-mix(in srgb,var(--bd) 50%,transparent)" }}>
                <span style={{ width: 20, height: 20, borderRadius: 6, border: "1.5px solid var(--ac)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ac)", fontSize: 12, flexShrink: 0 }}>◆</span>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span dir="auto" style={{ fontSize: 13.5, fontWeight: 650, color: "var(--ac)" }}>{m.name}</span>
                  <span style={{ fontSize: 11.5, color: "var(--mu)", display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: "var(--ac)" }} />{t("Milestone")}</span>
                </div>
                <span style={{ fontSize: 12, color: "var(--mu)", width: 90, textAlign: "end" }}>{fmtDay(m.day)}</span>
              </div>
            ))}
            {!w.its.length && !w.ms.length && !w.carried && <span style={{ fontSize: 12.5, color: "var(--mu)", padding: "12px 0" }}>{t("Nothing planned.")}</span>}
          </div>
        ))}
      </div>
      {!phone && (
        <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12, paddingTop: 12 }}>
          <div style={{ padding: 14, borderRadius: 14, background: "var(--sf)", border: "1px solid var(--bd)", display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 650, color: "var(--mu)", letterSpacing: ".05em" }}>{t("LOAD · NEXT 8 WEEKS")}</span>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 80 }}>
              {load.map((l, k) => (
                <div key={k} title={t("{n} h planned", { n: fmtNum(l.hours) })} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ width: "100%", height: Math.min(66, Math.max(6, (l.hours / maxH) * 60 + 6)), borderRadius: 4, background: l.over ? "var(--da)" : k === 0 ? "var(--ac)" : "color-mix(in srgb,var(--mu) 45%,transparent)" }} />
                  <span style={{ fontSize: 10, color: "var(--mu)" }}>{fmtNum(dateOf(l.week).getUTCDate())}</span>
                </div>
              ))}
            </div>
            <span style={{ fontSize: 12, color: "var(--mu)", lineHeight: "17px" }}>{anyOver ? t("One week is over your pace. Spread it out with Organize › Schedule.") : t("Even load at your current pace.")}</span>
          </div>
          <div style={{ padding: 14, borderRadius: 14, background: "var(--sf)", border: "1px solid var(--bd)", display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 650, color: "var(--mu)", letterSpacing: ".05em" }}>{t("MILESTONES")}</span>
            {plan.milestones.map((m, k) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                <span style={{ width: 9, height: 9, transform: "rotate(45deg)", border: "2px solid var(--ac)", background: m.done ? "var(--ac)" : "transparent", flexShrink: 0 }} /><span dir="auto" style={{ flex: 1 }}>{m.name}</span><span style={{ color: "var(--mu)" }}>{fmtDay(m.day)}</span>
              </div>
            ))}
            {!plan.milestones.length && <span style={{ fontSize: 12, color: "var(--mu)" }}>{t("No milestones yet.")}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
