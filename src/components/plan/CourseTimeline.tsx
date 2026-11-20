// Course timeline + topic panel (design round 8: CourseTimeline.dc.html, "Lumen 53 Course Timeline" 53A–K), 1:1.
// Long courses (178 topics, 94 weeks): two-tier axis (year over months, Week zoom = month over day numbers), one bar
// per module split into topic segments, collapsible levels (A1–C2) with a summary bar each, status in the bar (done
// fill, up-next accent, locked tint, red hatched overrun with Replan when behind), today line, Week / Month / Quarter.
// Dates come from the plan model (lib/plan-model.ts + plan-sources.ts courseModel): forward from the course start at
// the course pace (h / week), one track per module kind, checkpoints after their level, `(needs: …)` finish-to-start.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Note } from "../../../shared/types";
import { Glyph } from "../Glyph";
import { addTopic, addTopicNeed, flashcards, moveTopic, setFrontMatter, setTopicDue, splitFrontMatter, type Topic } from "../../lib/parse";
import { courseModel, type CourseLevel, type CourseModule, type CourseTopic } from "../../lib/plan-sources";
import { dateOf, dayOf, isoOf, monthStart, mondayOf, projectFromToday, todayDay, type Day } from "../../lib/plan-model";
import { useVault } from "../../lib/store";
import { fmtNum, t, tx } from "../../lib/i18n";
import { usePhone } from "../../views/spaces-util";
import { MenuPop, PLAN_CSS, TOKENS, fmtDay, fmtDow, fmtMonthYear, monthShort, useDismiss, useWidth } from "./plan-ui";
import type { TopicOps } from "../../views/roadmap-outline";

// ------------------------------------------------------------------ view state shared by the tools row and the timeline
type Zoom = "week" | "month" | "quarter";
interface TlState { zoom: Zoom; hidden: string[]; collapsed: string[] | null; expanded: string[] }
const KEY = (id: string) => `lumen.ctl.${id}`;
const subs = new Set<() => void>();
const cache = new Map<string, TlState>();
function read(id: string): TlState {
  if (!cache.has(id)) { let s: TlState = { zoom: "month", hidden: [], collapsed: null, expanded: [] }; try { s = { ...s, ...JSON.parse(localStorage.getItem(KEY(id)) || "{}") }; } catch { /* ignore */ } cache.set(id, s); }
  return cache.get(id)!;
}
function write(id: string, p: Partial<TlState>) {
  const n = { ...read(id), ...p }; cache.set(id, n);
  try { localStorage.setItem(KEY(id), JSON.stringify(n)); } catch { /* private mode */ }
  subs.forEach((f) => f());
}
export function useCourseTl(id: string) {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => read(id));
  return [s, (p: Partial<TlState>) => write(id, p)] as const;
}
const scrollers = new Map<string, () => void>();
const lvBg = (c: string) => `color-mix(in srgb,${c} 20%,transparent)`;
const AC = "color-mix(in srgb,var(--ac) 16%,transparent)";
const isCollapsed = (s: TlState, L: CourseLevel, li: number) => (s.collapsed ? s.collapsed.includes(L.key) : li >= 2);

/** Pace · Levels · Week/Month/Quarter · Today · Collapse all (design: right side of the Outline / Skill tree / Timeline row). */
export function CourseTimelineTools({ note }: { note: Note }) {
  const [s, set] = useCourseTl(note.id);
  const cm = useMemo(() => courseModel(note), [note]);
  const [menu, setMenu] = useState<"pace" | "levels" | null>(null);
  const pace = cm.plan.pace;
  const allCollapsed = cm.levels.every((L, li) => isCollapsed(s, L, li));
  const zooms: Zoom[] = ["week", "month", "quarter"];
  const box: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 10px", borderRadius: 8, border: "1px solid var(--bd)", fontSize: 12, whiteSpace: "nowrap", position: "relative" };
  const writePace = (h: number) => { void import("../../lib/actions").then(({ updateNote }) => updateNote(note.id, { body: setFrontMatter(note.body, { pace: String(h) }) })); };
  return (
    <div className="pl-root" style={{ ...TOKENS, display: "flex", alignItems: "center", gap: 8, paddingBottom: 6, fontSize: 13 }}>
      <div style={{ position: "relative" }}>
        <button style={box} onClick={() => setMenu("pace")}><span style={{ color: "var(--mu)" }}>{t("Pace")}</span> {t("{n} h/wk", { n: fmtNum(pace) })} ▾</button>
        {menu === "pace" && <MenuPop onClose={() => setMenu(null)} style={{ top: 34, left: 0 }} items={[2, 3, 4, 5, 6, 8, 10, 12].map((h) => ({ l: t("{n} h / week", { n: h }), on: h === pace, run: () => writePace(h) }))} />}
      </div>
      <div style={{ position: "relative" }}>
        <button style={box} onClick={() => setMenu("levels")}><span style={{ color: "var(--mu)" }}>{cm.levelled ? t("Levels") : t("Modules")}</span> {s.hidden.length ? fmtNum(cm.levels.length - s.hidden.length) : t("All")} ▾</button>
        {menu === "levels" && <MenuPop onClose={() => setMenu(null)} style={{ top: 34, left: 0 }} items={[
          { l: t("All"), on: !s.hidden.length, run: () => set({ hidden: [] }) },
          ...cm.levels.map((L) => ({ l: L.name && L.name !== L.key ? `${L.key} · ${L.name}` : L.key || t("Course"), on: !s.hidden.includes(L.key), run: () => set({ hidden: s.hidden.includes(L.key) ? s.hidden.filter((x) => x !== L.key) : [...s.hidden, L.key] }) })),
        ]} />}
      </div>
      <div role="radiogroup" aria-label={t("Zoom")} style={{ display: "flex", padding: 2, borderRadius: 8, background: "var(--sf2)", gap: 2 }}>
        {zooms.map((z) => { const on = z === s.zoom; return <button key={z} role="radio" aria-checked={on} onClick={() => set({ zoom: z })} style={{ height: 26, padding: "0 11px", borderRadius: 6, display: "flex", alignItems: "center", fontSize: 12, background: on ? "var(--sf)" : "transparent", color: on ? "var(--tx)" : "var(--mu)", fontWeight: on ? 600 : 400, boxShadow: on ? "0 1px 2px rgba(0,0,0,.2)" : "none" }}>{{ week: t("Week"), month: t("Month"), quarter: t("Quarter") }[z]}</button>; })}
      </div>
      <button style={box} onClick={() => scrollers.get(note.id)?.()}>{t("Today")}</button>
      <button title={allCollapsed ? t("Expand all") : t("Collapse all")} aria-label={allCollapsed ? t("Expand all") : t("Collapse all")} onClick={() => set({ collapsed: allCollapsed ? [] : cm.levels.map((L) => L.key), expanded: [] })}
        style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid var(--bd)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--mu)" }}><Glyph name="fit" size={15} /></button>
    </div>
  );
}

// ------------------------------------------------------------------ timeline
export function CourseTimeline({ note, ops, phone: phoneProp }: { note: Note; ops: TopicOps; phone?: boolean }) {
  const v = useVault();
  const sp = note.spaceId ? v.spaceMap.get(note.spaceId) ?? null : null;
  const cm = useMemo(() => courseModel(note, { space: sp }), [note, sp]);
  const [s, set] = useCourseTl(note.id);
  const phoneQ = usePhone();
  const phone = phoneProp ?? phoneQ;
  const [panel, setPanel] = useState<number | null>(null); // topic line
  const today = todayDay();
  const all = cm.levels.flatMap((L) => L.mods.flatMap((m) => m.topics));
  const cur = cm.plan.next;
  const proj = useMemo(() => projectFromToday(cm.plan, today), [cm, today]);
  const sel = panel == null ? null : all.find((x) => x.topicLine === panel) ?? null;

  const body = phone ? <PhoneTimeline cm={cm} s={s} set={set} cur={cur?.line ?? null} onTopic={(l) => setPanel(l)} today={today} />
    : <DeskTimeline note={note} cm={cm} s={s} set={set} cur={cur?.line ?? null} today={today} proj={proj} sel={panel} onTopic={(l) => setPanel(l)} ops={ops} />;
  return (
    <div className="pl-root" style={{ ...TOKENS, position: "relative", height: "100%", minHeight: 0, display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--tx)", fontSize: 13, lineHeight: "normal" }}>
      <style>{PLAN_CSS}</style>
      {body}
      {sel && <TopicPanel note={note} cm={cm} tp={sel} ops={ops} phone={phone} today={today} onClose={() => setPanel(null)} onTopic={(l) => setPanel(l)} />}
    </div>
  );
}

function DeskTimeline({ note, cm, s, set, cur, today, proj, sel, onTopic, ops }: { note: Note; cm: ReturnType<typeof courseModel>; s: TlState; set: (p: Partial<TlState>) => void; cur: number | null; today: Day; proj: ReturnType<typeof projectFromToday>; sel: number | null; onTopic: (line: number) => void; ops: TopicOps }) {
  const colW = 280;
  const [wrap, width] = useWidth<HTMLDivElement>(1158);
  const scroll = useRef<HTMLDivElement>(null);
  const [scrollX, setScrollX] = useState(0);
  const viewW = Math.max(300, width);
  const zoom = s.zoom;
  const levels = cm.levels.filter((L) => !s.hidden.includes(L.key));
  const start = Math.min(cm.plan.start, today - 4);
  const end = Math.max(start + 28, ...cm.levels.map((L) => L.end + 1), ...[...proj.end.values()].map((d) => d + 1));
  const totalDays = end - start;
  const pxDay = zoom === "week" ? 44 / 7 : zoom === "quarter" ? ((viewW - 40) / totalDays) * 0.8 : (viewW - 30) / totalDays;
  const X = (d: Day) => Math.round((d - start) * pxDay);
  const fmtM = (d: Day) => fmtMonthYear(d);
  const todayX = X(today);
  useEffect(() => {
    scrollers.set(note.id, () => { const el = scroll.current; if (el) el.scrollTo({ left: Math.max(0, todayX - 80), behavior: "smooth" }); });
    return () => { scrollers.delete(note.id); };
  }, [note.id, todayX]);
  // header ticks: two tiers, labels never narrower than their text
  const ticks: { x: number; top: number; c: string }[] = [], labels: { x: number; w: number; l: string; c: string; fw: number }[] = [], years: { x: number; l: string }[] = [];
  if (zoom === "week") {
    for (let d = mondayOf(start); d <= end + 7; d += 7) {
      const D = dateOf(d), first = D.getUTCDate() <= 7;
      ticks.push({ x: X(d), top: 52, c: first ? "var(--bd)" : "color-mix(in srgb,var(--bd) 45%,transparent)" });
      labels.push({ x: X(d), w: 7 * pxDay, l: fmtNum(D.getUTCDate()), c: "var(--mu)", fw: 400 });
      if (first || d === mondayOf(start)) years.push({ x: X(d), l: monthShort(D.getUTCMonth()) + (D.getUTCMonth() === 0 || d === mondayOf(start) ? ` ${fmtNum(D.getUTCFullYear(), { useGrouping: false })}` : "") });
    }
  } else {
    for (let m = 0; m < 200; m++) {
      const ms = monthStart(start, m); if (ms > end) break;
      const a = Math.max(start, ms), b = Math.min(monthStart(start, m + 1), end), D = dateOf(ms);
      ticks.push({ x: X(a), top: D.getUTCMonth() === 0 ? 0 : 52, c: D.getUTCMonth() === 0 ? "var(--mu)" : "var(--bd)" });
      const cur = today >= a && today < monthStart(start, m + 1);
      if (zoom === "quarter") { if (D.getUTCMonth() % 3 === 0 || m === 0) labels.push({ x: X(a), w: (Math.min(monthStart(start, m + 3 - (D.getUTCMonth() % 3)), end) - a) * pxDay, l: `Q${Math.floor(D.getUTCMonth() / 3) + 1}`, c: cur ? "var(--ac)" : "var(--mu)", fw: cur ? 650 : 400 }); }
      else { const w = (b - a) * pxDay; labels.push({ x: X(a), w, l: w >= 24 ? monthShort(D.getUTCMonth()) : w >= 10 ? monthShort(D.getUTCMonth())[0] : "", c: cur ? "var(--ac)" : "var(--mu)", fw: cur ? 650 : 400 }); }
      if (m === 0 || D.getUTCMonth() === 0) years.push({ x: X(a), l: fmtNum(D.getUTCFullYear(), { useGrouping: false }) });
    }
  }
  // rows + bars
  type Row = { key: string; h: number; pl: number; bg?: string; bb?: string; bl?: string; chev?: string; lv?: string; lvC?: string; g?: string; gc?: string; l: string; n?: string; fs?: number; fw?: number; c?: string; run?: () => void };
  type Bar = { key: string; x: number; y: number; w: number; h: number; r: string; bg: string; bd: string; ring: string; prog: number; pc: string; segs: number[]; sc: string; l: string; fs: number; tip: string; o?: { x: number; y: number; l: ReactNode; c: string; fw: number; chip?: boolean; run?: () => void }; run?: () => void };
  const rows: Row[] = [], bars: Bar[] = [], diamonds: { x: number; y: number; c: string; tip: string; l: string }[] = [], bands: { x: number; w: number; bg: string }[] = [];
  let y = 52; const RH = 40, LH = 36, TH = 30;
  const curMod = cm.levels.flatMap((L) => L.mods).find((m) => m.topics.some((t) => t.topicLine === cur));
  const replan = () => {
    // restart the remaining work today: move the course start so the done work ends today
    const doneH = cm.plan.items.filter((i) => i.status === "done").reduce((a, i) => a + i.hours, 0);
    const ns = today - Math.round((doneH / Math.max(1, cm.plan.pace)) * 7);
    ops.write(setFrontMatter(note.body, { start: isoOf(ns) }));
  };
  levels.forEach((L, li0) => {
    const li = cm.levels.indexOf(L);
    const open = !isCollapsed(s, L, li);
    const toggle = () => { const c = s.collapsed ?? cm.levels.filter((x, k) => k >= 2).map((x) => x.key); set({ collapsed: open ? [...c, L.key] : c.filter((x) => x !== L.key) }); };
    if (cm.levelled) {
      rows.push({ key: `L${li}`, h: LH, pl: 16, chev: open ? "⌄" : "›", lv: L.key, lvC: L.color, l: L.name || L.key, n: `${fmtNum(L.done)}/${fmtNum(L.total)}`, fw: 650, bg: "var(--sf)", bb: "var(--bd)", run: toggle });
      bands.push({ x: X(L.start), w: (L.end + 1 - L.start) * pxDay, bg: li0 % 2 ? "transparent" : "color-mix(in srgb,var(--sf) 55%,transparent)" });
      const bw = (L.end + 1 - L.start) * pxDay;
      bars.push({ key: `Lb${li}`, x: X(L.start), y: y + 9, w: bw, h: 18, r: "5px", bg: lvBg(L.color), bd: "transparent", ring: "none", prog: L.total ? L.done / L.total : 0, pc: L.color, segs: [], sc: "", l: bw > 150 ? `${L.key} · ${fmtM(L.start)} – ${fmtM(L.end)}` : L.key, fs: 11, tip: `${L.key} ${L.name}`, run: toggle });
      y += LH;
      if (!open) return;
    }
    for (const m of L.mods) {
      const isExp = s.expanded.includes(m.key);
      const now = m === curMod;
      const late = m.topics.some((t) => t.status !== "done" && t.status !== "skipped" && t.item.end < today);
      const projEnd = Math.max(m.end, ...m.topics.map((t) => proj.end.get(t.item.key) ?? 0));
      const tog = () => set({ expanded: isExp ? s.expanded.filter((k) => k !== m.key) : [...s.expanded, m.key] });
      rows.push({ key: `m${m.mi}`, h: RH, pl: cm.levelled ? 28 : 16, chev: m.milestone ? "" : isExp ? "⌄" : "›", g: m.glyph, gc: L.color, l: m.short, n: `${fmtNum(m.done)}/${fmtNum(m.total)}`, bg: isExp ? "color-mix(in srgb,var(--ac) 7%,transparent)" : "transparent", bl: now ? "var(--ac)" : "transparent", fw: now ? 600 : 500, run: m.milestone ? () => m.topics[0] && onTopic(m.topics[0].topicLine) : tog });
      if (m.milestone) {
        diamonds.push({ x: X(m.start), y: y + 14, c: L.color, tip: t("{level} checkpoint", { level: L.key }), l: `${m.topics[0]?.item.name ?? t("{level} checkpoint", { level: L.key })} · ${fmtDay(m.start)}` });
      } else {
        const w = (m.end + 1 - m.start) * pxDay, n = Math.max(1, m.topics.length);
        const segs = w / n > 5 ? Array.from({ length: n - 1 }, (_, i) => ((i + 1) / n) * 100) : [];
        const lbl = t("{n} topics", { n: m.total });
        bars.push({
          key: `mb${m.mi}`, x: X(m.start), y: y + 8, w, h: 24, r: "6px", bg: `color-mix(in srgb,${L.color} ${late ? 10 : 16}%,var(--bg))`, bd: late ? "var(--da)" : now ? "var(--ac)" : `color-mix(in srgb,${L.color} 45%,transparent)`,
          ring: now ? "0 0 0 3px color-mix(in srgb,var(--ac) 22%,transparent)" : "none", prog: m.total ? m.done / m.total : 0, pc: `color-mix(in srgb,${L.color} 55%,transparent)`, segs, sc: `color-mix(in srgb,${L.color} 35%,transparent)`,
          l: w > 120 ? lbl : "", fs: 11, tip: `${L.key} ${m.short} · ${fmtDay(m.start)} – ${fmtDay(m.end)}`, run: tog,
          o: w > 120 ? undefined : { x: X(m.end + 1) + 8, y: y + 12, l: `${lbl} · ${fmtDay(m.start)} – ${fmtDay(m.end)}`, c: "var(--mu)", fw: 400 },
        });
        if (late && projEnd > m.end) {
          const wk = Math.max(1, Math.round((projEnd - m.end) / 7));
          bars.push({ key: `ov${m.mi}`, x: X(m.end + 1), y: y + 8, w: (projEnd - m.end) * pxDay, h: 24, r: "0 6px 6px 0", bg: "repeating-linear-gradient(135deg,color-mix(in srgb,var(--da) 22%,transparent) 0 4px,transparent 4px 8px)", bd: "var(--da)", ring: "none", prog: 0, pc: "", segs: [], sc: "", l: "", fs: 11, tip: t("Projected {n} week late|Projected {n} weeks late", { n: wk }),
            o: { x: X(projEnd + 1) + 8, y: y + 12, l: <>{t("{n} week behind|{n} weeks behind", { n: wk })} · <button onClick={replan} style={{ color: "var(--da)", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 2 }}>{t("Replan")}</button></>, c: "var(--da)", fw: 600 } });
        }
      }
      y += RH;
      if (isExp) {
        const show = zoom === "week" ? m.topics.length : 6;
        for (const tp of m.topics.slice(0, show)) {
          const st = tp.status === "done" ? "done" : tp.topicLine === cur || tp.status === "learning" ? "next" : tp.locked ? "locked" : "todo";
          const per = tp.item.end + 1 - tp.item.start;
          rows.push({ key: `t${tp.topicLine}`, h: TH, pl: cm.levelled ? 50 : 38, g: st === "done" ? "check" : st === "next" ? "play" : st === "locked" ? "lock" : "status-planned", gc: st === "done" ? "var(--ok)" : st === "next" ? "var(--ac)" : "var(--mu)", l: tp.item.name, fs: 12.5, fw: st === "next" ? 600 : 400, c: st === "locked" ? "var(--mu)" : "var(--tx)", n: fmtDay(tp.item.start), bb: "transparent", run: () => onTopic(tp.topicLine) });
          bars.push({ key: `tb${tp.topicLine}`, x: X(tp.item.start), y: y + 9, w: Math.max(6, per * pxDay - 2), h: 12, r: "3px", bg: st === "done" ? L.color : st === "next" ? "var(--ac)" : `color-mix(in srgb,${L.color} 30%,transparent)`, bd: "transparent", ring: sel === tp.topicLine ? "0 0 0 2px var(--bg), 0 0 0 4px var(--ac)" : "none", prog: 0, pc: "", segs: [], sc: "", l: "", fs: 10, tip: tp.item.name, run: () => onTopic(tp.topicLine),
            o: zoom === "week" ? { x: X(tp.item.end + 1) + 6, y: y + 7, l: tp.item.name, c: st === "locked" ? "var(--mu)" : "var(--tx)", fw: st === "next" ? 600 : 400, chip: st === "next" } : undefined });
          y += TH;
        }
        if (show < m.topics.length) { rows.push({ key: `more${m.mi}`, h: TH, pl: cm.levelled ? 50 : 38, l: t("+ {n} more topics · switch to Week to see each one", { n: m.topics.length - show }), fs: 12, c: "var(--ac)", bb: "transparent", run: () => set({ zoom: "week" }) }); y += TH; }
      }
    }
  });
  const gridW = Math.max(viewW, totalDays * pxDay + 40);
  const H = Math.max(y + 24, 200);
  const visA = start + Math.floor(scrollX / pxDay), visB = start + Math.floor((scrollX + viewW) / pxDay);
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", position: "relative", overflow: "hidden" }}>
      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", overflowX: "hidden", display: "flex" }}>
        <div style={{ width: colW, flexShrink: 0, borderInlineEnd: "1px solid var(--bd)", display: "flex", flexDirection: "column", background: "var(--bg)", zIndex: 2, height: H, position: "relative" }}>
          <div style={{ height: 52, flexShrink: 0, display: "flex", alignItems: "flex-end", padding: "0 16px 8px 28px", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", color: "var(--mu)", borderBottom: "1px solid var(--bd)", boxSizing: "border-box" }}>{t("MODULE")}</div>
          {rows.map((r) => (
            <div key={r.key} className="pl-row" role={r.run ? "button" : undefined} tabIndex={r.run ? 0 : undefined} onClick={r.run} onKeyDown={(e) => { if (r.run && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); r.run(); } }}
              style={{ height: r.h, flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: `0 14px 0 ${r.pl}px`, boxSizing: "border-box", background: r.bg ?? "transparent", borderBottom: `1px solid ${r.bb ?? "color-mix(in srgb,var(--bd) 50%,transparent)"}`, borderInlineStart: `3px solid ${r.bl ?? "transparent"}`, cursor: r.run ? "pointer" : "default" }}>
              {r.chev !== undefined && <span style={{ width: 14, color: "var(--mu)", fontSize: 12 }}>{r.chev}</span>}
              {r.lv && <span style={{ display: "flex", height: 20, minWidth: 26, padding: "0 6px", borderRadius: 5, fontSize: 11, fontWeight: 700, alignItems: "center", justifyContent: "center", background: lvBg(r.lvC!), color: r.lvC, boxSizing: "border-box" }}>{r.lv}</span>}
              {r.g && <Glyph name={r.g} size={13} stroke={1.9} color={r.gc} />}
              <span dir="auto" style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: r.fs ?? 13, fontWeight: r.fw ?? 500, color: r.c ?? "var(--tx)" }}>{r.l}</span>
              <span style={{ fontSize: 11.5, color: "var(--mu)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{r.n}</span>
            </div>
          ))}
        </div>
        <div ref={wrap} style={{ flex: 1, minWidth: 0, position: "relative", height: H }}>
          <div ref={scroll} onScroll={(e) => setScrollX(e.currentTarget.scrollLeft)} onWheel={(e) => { if (e.shiftKey && scroll.current) { scroll.current.scrollLeft += e.deltaY; } }}
            style={{ position: "absolute", inset: 0, overflowX: zoom === "week" ? "auto" : "hidden", overflowY: "hidden", scrollbarWidth: "none" }}>
            <div style={{ position: "relative", width: gridW, height: "100%" }}>
              {bands.map((b, k) => <div key={k} style={{ position: "absolute", left: b.x, width: b.w, top: 52, bottom: 0, background: b.bg }} />)}
              {ticks.map((tk, k) => <div key={k} style={{ position: "absolute", left: tk.x, top: tk.top, bottom: 0, width: 1, background: tk.c }} />)}
              <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 52, borderBottom: "1px solid var(--bd)", background: "var(--bg)" }}>
                {years.map((yy, k) => <span key={k} style={{ position: "absolute", left: yy.x, top: 8, fontSize: 11, fontWeight: 650, color: "var(--tx)", paddingLeft: 6, borderLeft: "1px solid var(--bd)", whiteSpace: "nowrap" }}>{yy.l}</span>)}
                {labels.map((l, k) => <span key={k} style={{ position: "absolute", left: l.x, width: l.w, top: 28, fontSize: 11.5, color: l.c, fontWeight: l.fw, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden" }}>{l.l}</span>)}
              </div>
              {bars.map((b) => (
                <div key={b.key}>
                  <div title={b.tip} className="pl-bar" onClick={b.run} style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: b.r, background: b.bg, border: `1px solid ${b.bd}`, boxSizing: "border-box", overflow: "hidden", display: "flex", alignItems: "center", boxShadow: b.ring }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${b.prog * 100}%`, background: b.pc }} />
                    {b.segs.map((sx, k) => <div key={k} style={{ position: "absolute", left: `${sx}%`, top: 4, bottom: 4, width: 1, background: b.sc }} />)}
                    {b.l && <span style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, padding: "0 8px", fontSize: b.fs, fontWeight: 600, color: "var(--tx)", whiteSpace: "nowrap" }}>{b.l}</span>}
                  </div>
                  {b.o && <span dir="auto" style={{ position: "absolute", left: b.o.x, top: b.o.y, display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: b.o.c, whiteSpace: "nowrap", fontWeight: b.o.fw }}>{b.o.l}{b.o.chip && <span style={{ display: "flex", height: 18, padding: "0 7px", borderRadius: 999, fontSize: 10.5, fontWeight: 650, alignItems: "center", background: "var(--ac)", color: "var(--af)" }}>{t("Up next")}</span>}</span>}
                </div>
              ))}
              {diamonds.map((d, k) => (
                <div key={k}>
                  <div title={d.tip} style={{ position: "absolute", left: d.x, top: d.y, width: 12, height: 12, marginLeft: -6, transform: "rotate(45deg)", background: "var(--bg)", border: `2px solid ${d.c}`, boxSizing: "border-box" }} />
                  <span dir="auto" style={{ position: "absolute", left: d.x + 12, top: d.y - 2, fontSize: 11.5, color: "var(--mu)", whiteSpace: "nowrap" }}>{d.l}</span>
                </div>
              ))}
              <div style={{ position: "absolute", left: todayX, top: 40, bottom: 0, width: 2, background: "var(--ac)" }} />
              <span style={{ position: "absolute", left: todayX, top: 36, transform: "translateX(-50%)", height: 16, padding: "0 6px", borderRadius: 999, background: "var(--ac)", color: "var(--af)", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center" }}>{t("Today")}</span>
            </div>
          </div>
          {zoom === "week" && <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 40, background: "linear-gradient(90deg,transparent,var(--bg))", pointerEvents: "none" }} />}
        </div>
      </div>
      {zoom === "week" && <div style={{ position: "absolute", right: 16, bottom: 14, display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 12px", borderRadius: 999, background: "var(--sf2)", border: "1px solid var(--bd)", fontSize: 11.5, color: "var(--mu)", zIndex: 3 }}>{t("Showing {a} – {b} · scroll or Shift + wheel for more", { a: fmtM(visA), b: fmtM(visB) })}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ phone (53I/K): vertical timeline
function PhoneTimeline({ cm, s, set, cur, onTopic, today }: { cm: ReturnType<typeof courseModel>; s: TlState; set: (p: Partial<TlState>) => void; cur: number | null; onTopic: (l: number) => void; today: Day }) {
  const short = (d: Day) => fmtMonthYear(d).replace(/\s(\d\d)(\d\d)$/, " ’$2");
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 14px 24px", display: "flex", flexDirection: "column" }}>
      {cm.levels.filter((L) => !s.hidden.includes(L.key)).map((L, li) => {
        const open = !isCollapsed(s, L, cm.levels.indexOf(L));
        const span = Math.max(1, L.end + 1 - L.start);
        return (
          <div key={L.key || li}>
            {cm.levelled && (
              <button onClick={() => { const c = s.collapsed ?? cm.levels.filter((x, k) => k >= 2).map((x) => x.key); set({ collapsed: open ? [...c, L.key] : c.filter((x) => x !== L.key) }); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "14px 0 6px", fontSize: 12, fontWeight: 650, color: "var(--mu)", letterSpacing: ".04em" }}>
                <span style={{ height: 20, minWidth: 26, padding: "0 6px", borderRadius: 5, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", background: lvBg(L.color), color: L.color, boxSizing: "border-box" }}>{L.key}</span>
                <span style={{ flex: 1, textAlign: "start" }}>{(L.name || L.key).toUpperCase()}</span><span style={{ fontWeight: 500 }}>{short(L.start)} – {short(L.end)}</span>
              </button>
            )}
            {open && L.mods.map((m) => {
              const now = m.topics.some((t) => t.topicLine === cur);
              const exp = s.expanded.includes(m.key);
              return (
                <div key={m.mi}>
                  <button onClick={() => (m.milestone ? m.topics[0] && onTopic(m.topics[0].topicLine) : set({ expanded: exp ? s.expanded.filter((k) => k !== m.key) : [...s.expanded, m.key] }))}
                    style={{ width: "100%", display: "flex", gap: 12, padding: "8px 0", minHeight: 44, alignItems: "center", borderBottom: "1px solid var(--bd)" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 14, alignSelf: "stretch" }}><span style={{ width: 10, height: 10, borderRadius: "50%", marginTop: 6, background: now ? "var(--ac)" : "var(--bg)", boxShadow: `0 0 0 3px ${now ? AC : "var(--bd)"}` }} /><span style={{ flex: 1, width: 2, background: "var(--bd)" }} /></div>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5, textAlign: "start" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span dir="auto" style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.short}</span><span style={{ fontSize: 11.5, color: "var(--mu)" }}>{fmtNum(m.done)}/{fmtNum(m.total)}</span></div>
                      <div style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--sf2)" }}><div style={{ position: "absolute", left: `${((m.start - L.start) / span) * 100}%`, width: `${Math.max(2, ((m.end + 1 - m.start) / span) * 100)}%`, top: 0, bottom: 0, borderRadius: 3, background: now ? "var(--ac)" : L.color }} /></div>
                      <span style={{ fontSize: 11.5, color: now ? "var(--ac)" : "var(--mu)" }}>{m.milestone ? t("Checkpoint · {date}", { date: fmtDay(m.start) }) : `${fmtDay(m.start)} – ${fmtDay(m.end)}${now ? ` · ${t("in progress")}` : m.end < today && m.done < m.total ? ` · ${t("overdue")}` : ""}`}</span>
                    </div>
                  </button>
                  {exp && m.topics.map((tp) => (
                    <button key={tp.topicLine} onClick={() => onTopic(tp.topicLine)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, minHeight: 40, padding: "0 0 0 26px", borderBottom: "1px solid color-mix(in srgb,var(--bd) 50%,transparent)", textAlign: "start" }}>
                      <Glyph name={tp.status === "done" ? "check" : tp.topicLine === cur ? "play" : tp.locked ? "lock" : "status-planned"} size={14} color={tp.status === "done" ? "var(--ok)" : tp.topicLine === cur ? "var(--ac)" : "var(--mu)"} />
                      <span dir="auto" style={{ flex: 1, minWidth: 0, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: tp.locked ? "var(--mu)" : "var(--tx)" }}>{tp.item.name}</span>
                      <span style={{ fontSize: 11.5, color: "var(--mu)" }}>{fmtDay(tp.item.start)}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ topic panel (53G/H, phone sheet 53J)
function TopicPanel({ note, cm, tp, ops, phone, today, onClose, onTopic }: { note: Note; cm: ReturnType<typeof courseModel>; tp: CourseTopic; ops: TopicOps; phone: boolean; today: Day; onClose: () => void; onTopic: (l: number) => void }) {
  const v = useVault();
  const ref = useDismiss(true, onClose);
  const [more, setMore] = useState(false);
  const [menu, setMenu] = useState<"more" | "move" | "needs" | null>(null);
  const [dateEdit, setDateEdit] = useState(false);
  const all = cm.levels.flatMap((L) => L.mods.flatMap((m) => m.topics));
  const mod = cm.levels.flatMap((L) => L.mods).find((m) => m.topics.includes(tp)) as CourseModule;
  const L = cm.levels[mod.level];
  const topic: Topic | undefined = ops.mods.flatMap((m) => m.topics).find((x) => x.line === tp.topicLine);
  if (!topic) return null;
  const byName = new Map(all.map((x) => [x.item.name.toLowerCase(), x]));
  const needs = tp.needs.map((n) => byName.get(n.toLowerCase())).filter((x): x is CourseTopic => !!x);
  const blocking = needs.filter((x) => x.status !== "done" && x.status !== "skipped");
  const locked = tp.locked;
  const unlocks = all.filter((x) => x.needs.some((n) => n.toLowerCase() === tp.item.name.toLowerCase()));
  const linked = (tp.note ? v.byTitle.get(tp.note.toLowerCase()) : null) ?? v.byTitle.get(tp.item.name.toLowerCase()) ?? null;
  const cards = linked ? flashcards(linked.body).length : 0;
  const due = tp.due ? dayOf(tp.due) : tp.item.end;
  const week = Math.floor((due - cm.plan.start) / 7) + 1;
  const inDays = due - today;
  const stat: [Topic["status"], string, string][] = [["todo", t("To do"), "var(--mu)"], ["learning", t("Learning"), "var(--ac)"], ["done", t("Done"), "var(--ok)"], ["skipped", t("Skipped"), "var(--bd)"]];
  const cta = locked ? t("Study anyway") : tp.status === "learning" ? t("Continue") : tp.status === "done" ? t("Review") : t("Start topic");
  const runCta = () => { if (tp.status === "todo") ops.setStatus(topic, "learning"); ops.open(topic); };
  const pos = mod.topics.indexOf(tp) + 1;
  const row = (key: string, glyph: string | null, l: ReactNode, o: { sub?: string; gc?: string; c?: string; fw?: number; bd?: string; run?: () => void } = {}) => (
    <button key={key} onClick={o.run} disabled={!o.run} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32, padding: "0 10px", borderRadius: 8, border: `1px solid ${o.bd ?? "transparent"}`, color: o.c ?? "var(--tx)", fontSize: 13, minWidth: 0, width: "100%", cursor: o.run ? "pointer" : "default", textAlign: "start" }}>
      {glyph && <Glyph name={glyph} size={15} color={o.gc ?? "var(--mu)"} />}
      <span dir="auto" style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: o.fw ?? 400 }}>{l}</span>
      {o.sub && <span style={{ fontSize: 11.5, color: "var(--mu)", whiteSpace: "nowrap" }}>{o.sub}</span>}
    </button>
  );
  const field = (k: string, items: ReactNode, cnt?: number) => (
    <div style={{ display: "grid", gridTemplateColumns: "96px minmax(0,1fr)", gap: 12, padding: "10px 0", borderBottom: "1px solid color-mix(in srgb,var(--bd) 60%,transparent)", alignItems: "start" }}>
      <span style={{ fontSize: 12.5, color: "var(--mu)", paddingTop: 6, display: "flex", alignItems: "center", gap: 6 }}>{k}{cnt ? <span style={{ fontSize: 11, padding: "0 6px", borderRadius: 999, background: "var(--sf2)" }}>{fmtNum(cnt)}</span> : null}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, position: "relative" }}>{items}</div>
    </div>
  );
  const shown = more ? unlocks : unlocks.slice(0, 4);
  const moduleItems = ops.mods.map((m, mi) => ({ l: m.name, on: mi === topic.module, run: () => ops.write(moveTopic(ops.body, topic.line, mi, null)) }));
  return (
    <>
      <div style={{ position: "absolute", inset: 0, background: phone ? "rgba(0,0,0,.5)" : "rgba(0,0,0,.25)", zIndex: 20, ...(phone ? { position: "fixed" } : {}) }} />
      <div ref={ref} role="dialog" aria-label={tp.item.name} className={phone ? "pl-sheet" : "pl-pop"}
        style={{ position: phone ? "fixed" : "absolute", right: phone ? 0 : 16, left: phone ? 0 : "auto", top: phone ? 56 : 16, bottom: phone ? 0 : 16, width: phone ? "auto" : 420, background: "var(--sf)", border: "1px solid var(--bd)", borderRadius: phone ? "20px 20px 0 0" : 16, boxShadow: "0 24px 60px rgba(0,0,0,.4)", display: "flex", flexDirection: "column", overflow: "hidden", zIndex: 21 }}>
        {phone && <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}><span style={{ width: 36, height: 4, borderRadius: 2, background: "var(--bd)" }} /></div>}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "16px 18px 12px" }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--mu)" }}>
              {cm.levelled && <span style={{ height: 18, padding: "0 6px", borderRadius: 5, fontSize: 10.5, fontWeight: 700, display: "flex", alignItems: "center", background: lvBg(L.color), color: L.color }}>{L.key}</span>}
              <span dir="auto">{mod.short}</span><span>·</span>{t("topic {n} of {total}", { n: pos, total: mod.topics.length })}
            </div>
            <span dir="auto" style={{ fontSize: 20, fontWeight: 650, letterSpacing: "-.01em", lineHeight: 1.25 }}>{tp.item.name}</span>
          </div>
          <div style={{ position: "relative" }}>
            <button title={t("More")} aria-label={t("More")} onClick={() => setMenu("more")} style={{ width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--mu)" }}><Glyph name="more" size={18} /></button>
            {menu === "more" && <MenuPop onClose={() => setMenu(null)} style={{ top: 34, right: 0 }} items={[{ l: t("Edit as Markdown"), run: () => ops.open(topic, "edit") }, { l: t("Open in split view"), run: () => ops.open(topic, "split") }]} />}
          </div>
          <button title={t("Close · Esc")} aria-label={t("Close")} onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--mu)", fontSize: 18 }}>×</button>
        </div>
        {locked && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 18px", padding: "10px 12px", borderRadius: 10, background: "var(--sf2)", fontSize: 12.5, lineHeight: "18px" }}>
            <Glyph name="lock" size={16} color="var(--mu)" />
            <span style={{ flex: 1 }}>{tx("Locked until {name} is done.", { name: <b dir="auto">{blocking.map((b) => b.item.name).join(", ")}</b> })}</span>
            <button onClick={() => ops.setStatus(topic, "learning")} style={{ height: 28, padding: "0 10px", borderRadius: 7, border: "1px solid var(--bd)", display: "flex", alignItems: "center", fontSize: 12, whiteSpace: "nowrap" }}>{t("Unlock now")}</button>
          </div>
        )}
        <div style={{ padding: "14px 18px 0" }}>
          <div role="radiogroup" aria-label={t("Status")} style={{ display: "flex", padding: 3, borderRadius: 10, background: "var(--sf2)", gap: 2 }}>
            {stat.map(([k, l, dot]) => { const on = tp.status === k; return (
              <button key={k} role="radio" aria-checked={on} onClick={() => ops.setStatus(topic, k)} style={{ flex: 1, height: 32, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12.5, background: on ? "var(--sf)" : "transparent", color: on ? "var(--tx)" : "var(--mu)", fontWeight: on ? 600 : 400, boxShadow: on ? "0 1px 2px rgba(0,0,0,.25)" : "none" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: dot }} />{l}</button>
            ); })}
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", scrollbarWidth: "none", display: "flex", flexDirection: "column", padding: "8px 18px 0" }}>
          {field(t("Due"), dateEdit
            ? <input type="date" autoFocus defaultValue={isoOf(due)} onBlur={() => setDateEdit(false)} onChange={(e) => { if (e.target.value) { ops.write(setTopicDue(ops.body, topic.line, e.target.value)); setDateEdit(false); } }} style={{ height: 32, borderRadius: 8, border: "1px solid var(--bd)", background: "var(--bg)", color: "var(--tx)", padding: "0 8px", font: "inherit", colorScheme: "light dark" }} />
            : row("due", "due", fmtDow(due), { sub: `${t("week {n}", { n: week })} · ${inDays >= 0 ? t("in {n} day|in {n} days", { n: inDays }) : t("{n} day ago|{n} days ago", { n: -inDays })}`, bd: "var(--bd)", run: () => setDateEdit(true) }))}
          {field(t("Needs"), <>
            {needs.map((n) => row(`n${n.topicLine}`, n.status === "done" || n.status === "skipped" ? "check" : "status-planned", n.item.name, { gc: n.status === "done" ? "var(--ok)" : "var(--mu)", sub: n.status === "done" ? t("done") : [cm.levels[cm.levels.flatMap((x) => x.mods).find((m) => m.topics.includes(n))?.level ?? 0]?.key, cardsOf(v, n) ? t("{done} of {total} cards", { done: 0, total: cardsOf(v, n) }) : t("to do")].filter(Boolean).join(" · "), bd: "var(--bd)", run: () => onTopic(n.topicLine) }))}
            {row("add", "plus", t("Add prerequisite"), { c: "var(--mu)", run: () => setMenu("needs") })}
            {menu === "needs" && <MenuPop onClose={() => setMenu(null)} style={{ top: "100%", left: 0, maxHeight: 260, overflowY: "auto" }} items={all.filter((x) => x !== tp && !tp.needs.some((n) => n.toLowerCase() === x.item.name.toLowerCase())).slice(0, 60).map((x) => ({ l: x.item.name, run: () => ops.write(addTopicNeed(ops.body, topic.line, x.topicLine)) }))} />}
          </>)}
          {field(t("Note"), linked
            ? row("note", "note", linked.title, { gc: "var(--ln)", c: "var(--ln)", fw: 500, sub: t("{n} cards", { n: cards }), run: () => ops.open(topic) })
            : row("note", "plus", t("Create lesson note"), { c: "var(--mu)", run: () => ops.open(topic) }))}
          {unlocks.length > 0 && field(t("Unlocks"), <>
            {shown.map((u) => row(`u${u.topicLine}`, u.locked ? "lock" : u.status === "done" ? "check" : "status-planned", u.item.name, { sub: cm.levelled ? (cm.levels.flatMap((x) => x.mods).find((m) => m.topics.includes(u))?.short ?? "") : "", run: () => onTopic(u.topicLine) }))}
            {unlocks.length > 4 && row("more", more ? "chevron-up" : "chevron-down", more ? t("Show less") : t("{n} more", { n: unlocks.length - 4 }), { c: "var(--ac)", run: () => setMore((m) => !m) })}
          </>, unlocks.length)}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 0" }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", color: "var(--mu)" }}>{t("ORGANIZE")}</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, position: "relative" }}>
              {([["chevron-right", t("Move to module…"), t("Move"), () => setMenu("move")], ["text", t("Rename"), "F2", () => { const n = prompt(t("Rename topic"), topic.name); if (n?.trim()) ops.rename(topic, n.trim()); }], ["due", t("Change date"), "", () => setDateEdit(true)], ["duplicate", t("Duplicate"), "", () => ops.write(addTopic(ops.body, topic.module, `${topic.name} (2)`, { beforeLine: null }))]] as const).map(([g, l, tip, run]) => (
                <button key={l} title={tip || undefined} onClick={run} style={{ height: 32, padding: "0 10px", borderRadius: 8, border: "1px solid var(--bd)", display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, whiteSpace: "nowrap" }}><Glyph name={g} size={15} color="var(--mu)" />{l}</button>
              ))}
              {menu === "move" && <MenuPop onClose={() => setMenu(null)} style={{ bottom: "100%", left: 0, maxHeight: 260, overflowY: "auto" }} items={moduleItems} />}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: `12px 18px ${phone ? 28 : 12}px`, borderTop: "1px solid var(--bd)" }}>
          <button onClick={() => { if (confirm(t("Delete topic “{name}”? Topics that need it stop needing it.", { name: topic.name }))) { ops.remove(topic); onClose(); } }} style={{ height: 36, padding: "0 10px", borderRadius: 9, display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--da)" }}><Glyph name="trash" size={15} />{t("Delete")}</button>
          <span style={{ flex: 1 }} />
          <button onClick={() => ops.open(topic)} style={{ height: 36, padding: "0 14px", borderRadius: 9, border: "1px solid var(--bd)", display: "flex", alignItems: "center", fontSize: 13, whiteSpace: "nowrap" }}>{t("Open note")}</button>
          <button onClick={runCta} style={{ height: 36, padding: "0 14px", borderRadius: 9, background: "var(--ac)", color: "var(--af)", display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 650, whiteSpace: "nowrap" }}>{cta}</button>
        </div>
      </div>
    </>
  );
}
function cardsOf(v: ReturnType<typeof useVault>, c: CourseTopic) {
  const n = (c.note ? v.byTitle.get(c.note.toLowerCase()) : null) ?? v.byTitle.get(c.item.name.toLowerCase());
  return n ? flashcards(n.body).length : 0;
}
/** Course page header for the timeline tab (53A): two-line title, chips, ring, Continue with the module above the topic. */
export function courseFacts(note: Note, space: { props: Record<string, string> } | null) {
  const cm = courseModel(note, { space: space as never });
  const fm = splitFrontMatter(note.body).data;
  const lo = cm.plan.start, hi = Math.max(lo, ...cm.levels.map((L) => L.end));
  const next = cm.plan.next;
  const lv = next ? cm.levels[next.group] : null;
  return { cm, fm, lo, hi, weeks: Math.round((hi - lo) / 7), next, where: next ? (cm.levelled ? `${lv?.key ?? ""} ${next.track}` : cm.levels.flatMap((L) => L.mods).find((m) => m.topics.some((x) => x.item === next))?.name ?? "") : "" };
}
