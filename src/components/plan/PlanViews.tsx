// Plan page (design round 8: PlanViews.dc.html, "Lumen 54 Plans and Timelines" 54A–Q), converted 1:1.
// Header (tile, title, sub, chips, progress ring, Continue), the view switch (Timeline · Lanes · Board · Agenda,
// remembered per plan), tools (Group, Filter, zoom, Today, Organize) and the Organize popover (phone: a sheet).
// Used by plan notes (RoadmapView hook), the project hub Timeline tab and anywhere a Plan is at hand.
import { useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type ReactNode } from "react";
import type { Note } from "../../../shared/types";
import { Glyph } from "../Glyph";
import { openNote, useVault } from "../../lib/store";
import { criticalPath, daysLate, isoOf, planProgress, sessionMinutes, todayDay, dayOf, isDone, type ColourKey, type Day, type GroupKey, type Plan, type PlanItem, type PlanPrefs, type PlanViewKind, type ShowKey, type SortKey } from "../../lib/plan-model";
import { planCta, planFromNote } from "../../lib/plan-sources";
import { fmtNum, t } from "../../lib/i18n";
import { usePhone } from "../../views/spaces-util";
import { AC16, MenuPop, Opt, PLAN_CSS, TOKENS, fmtDay, fmtDow, statusWords, useDismiss, usePlanWrites, useWidth, type PlanWrites } from "./plan-ui";
import { Agenda, Board, Gantt, Lanes } from "./plan-views-parts";

const VIEWS: [PlanViewKind, string, string][] = [["gantt", "timeline", "Timeline"], ["lanes", "lanes", "Lanes"], ["board", "kanban", "Board"], ["agenda", "agenda", "Agenda"]];

/** A plan note opened as a page. */
export function PlanPage({ note }: { note: Note }) {
  const v = useVault();
  const plan = useMemo(() => planFromNote(note, { notes: v.notes, spaces: v.spaces }), [note, v.notes, v.spaces]);
  return <PlanViews plan={plan} />;
}

/** Folded groups, per plan (localStorage). Default: a levelled course shows its first two levels open. */
function useFolds(plan: Plan) {
  const key = `lumen.plan.fold.${plan.id}`;
  const init = (): Set<string> => {
    try { const s = localStorage.getItem(key); if (s) return new Set(JSON.parse(s)); } catch { /* private mode */ }
    return new Set(plan.groupBy === "Level" ? plan.groups.map((_, gi) => `g${gi}`).slice(2) : []);
  };
  const [f, setF] = useState(init);
  useEffect(() => setF(init()), [plan.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (k: string) => setF((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); try { localStorage.setItem(key, JSON.stringify([...n])); } catch { /* ignore */ } return n; });
  return [f, toggle] as const;
}

export function PlanViews({ plan: plan0, embedded }: { plan: Plan; embedded?: boolean }) {
  const phone = usePhone();
  const writes = usePlanWrites(plan0);
  const today = todayDay();
  // Organize changes show at once (optimistic) and are written to the plan's home.
  const [local, setLocal] = useState<PlanPrefs | null>(null);
  useEffect(() => setLocal(null), [plan0]);
  const prefs = local ?? plan0.prefs;
  const plan = useMemo(() => ({ ...plan0, prefs }), [plan0, prefs]);
  const setPrefs = (p: Partial<PlanPrefs>) => { const n = { ...prefs, ...p }; setLocal(n); void writes.prefs(n); };
  const [org, setOrg] = useState(false);
  const [filter, setFilter] = useState(false);
  const [q, setQ] = useState("");
  const [zoomMenu, setZoomMenu] = useState(false);
  const [paceMenu, setPaceMenu] = useState(false);
  const [pop, setPop] = useState<{ item: PlanItem; x: number; y: number } | null>(null);
  const [folded, fold] = useFolds(plan);
  const [bodyRef, bodyW] = useWidth<HTMLDivElement>(1180);
  const [bodyH, setBodyH] = useState(600);
  useEffect(() => { const el = bodyRef.current; if (!el) return; const ro = new ResizeObserver(() => setBodyH(el.clientHeight)); ro.observe(el); return () => ro.disconnect(); }, [bodyRef]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const view = prefs.view;
  const items = useMemo(() => plan.items.filter((i) => (prefs.show.includes("done") || !isDone(i)) && (!q || i.name.toLowerCase().includes(q.toLowerCase()))), [plan.items, prefs.show, q]);
  const prog = planProgress(plan);
  const next = plan.next;
  const cta = planCta(plan);
  const groupKey = (i: PlanItem) => plan.groups[i.group]?.name.split(" · ")[0] ?? "";
  const ctaK = !next ? t("All done") : cta === "continue" ? (plan.groupBy === "Level" ? t("Continue · {where}", { where: `${groupKey(next)} ${next.track}` }) : t("Continue · {where}", { where: plan.groups[next.group]?.name ?? "" }))
    : cta === "today" ? t("Today · {n} min", { n: sessionMinutes(plan) }) : cta === "yours" ? t("Your next task") : t("Next");
  const v = useVault();
  const runCta = () => { if (!next) return; const ln = next.link ? v.byTitle.get(next.link.toLowerCase()) : null; openNote(ln?.id ?? next.noteId); };
  const scrollToday = () => {
    const el = scroller.current;
    if (!el) return;
    const tl = el.querySelector<HTMLElement>("[data-today]");
    if (tl) { el.scrollLeft = Math.max(0, tl.offsetLeft - el.clientWidth / 3); return; }
    el.scrollTo({ top: 0, behavior: "smooth" });
  };
  const onItem = (item: PlanItem, e: RMouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPop({ item, x: Math.min(innerWidth - 340, r.left), y: Math.min(innerHeight - 330, r.bottom + 6) }); };
  const groupLabel = view === "lanes" ? (plan.owners ? t("Owner") : t("Track")) : view === "board" ? t("Status") : view === "agenda" ? t("Week") : t(prefs.group === "group" ? plan.groupBy : GROUP_LABEL[prefs.group]);
  const zoomL = { week: t("Week"), month: t("Month"), quarter: t("Quarter") }[prefs.zoom];
  const tb = (active: boolean): React.CSSProperties => ({ display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 10px", borderRadius: 8, border: `1px solid ${active ? "var(--ac)" : "var(--bd)"}`, background: active ? AC16 : "transparent", fontSize: 12, whiteSpace: "nowrap", color: "var(--tx)", position: "relative" });
  const chips = phone ? plan.meta.slice(0, 2) : plan.meta;

  return (
    <div className="pl-root" style={{ ...TOKENS, position: embedded ? "relative" : "absolute", inset: embedded ? undefined : 0, height: embedded ? "100%" : undefined, overflow: "hidden", background: "var(--bg)", fontFamily: "Inter,system-ui,sans-serif", fontSize: 13, color: "var(--tx)", display: "flex", flexDirection: "column", lineHeight: "normal" }}>
      <style>{PLAN_CSS}</style>
      {!embedded && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: phone ? 10 : 16, padding: phone ? "12px 16px 12px" : "20px 28px 14px" }}>
          <span style={{ width: phone ? 40 : 48, height: phone ? 40 : 48, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: `color-mix(in srgb,${plan.color} 16%,transparent)`, color: plan.color }}><Glyph name={plan.icon} size={22} /></span>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            <span dir="auto" style={{ fontSize: phone ? 17 : 22, fontWeight: 650, letterSpacing: "-.02em", lineHeight: 1.2 }}>{plan.title}</span>
            {!phone && plan.sub && <span dir="auto" style={{ fontSize: 13, color: "var(--mu)" }}>{plan.sub}</span>}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 4, fontSize: 12, color: "var(--mu)", position: "relative" }}>
              {chips.map((m, k) => {
                const pace = m.glyph === "clock";
                const body = <><Glyph name={m.glyph} size={13} stroke={1.9} /><span dir="auto">{m.label}</span></>;
                const st: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 999, background: m.warn ? "color-mix(in srgb,var(--da) 14%,transparent)" : "var(--sf2)", color: m.warn ? "var(--da)" : "var(--mu)", whiteSpace: "nowrap" };
                return pace ? <button key={k} title={t("Pace")} onClick={() => setPaceMenu(true)} style={st}>{body}</button> : <span key={k} style={st}>{body}</span>;
              })}
              {paceMenu && <MenuPop onClose={() => setPaceMenu(false)} style={{ top: 28, left: 0 }} items={[2, 3, 4, 6, 8, 10, 12, 15, 20].map((h) => ({ l: t("{n} h / week", { n: h }), on: plan.pace === h, run: () => void writes.home({ pace: String(h) }) }))} />}
            </div>
          </div>
          {!phone && (
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <svg width="40" height="40" viewBox="0 0 40 40" aria-label={t("{pct}% done", { pct: prog.pct })}><circle cx="20" cy="20" r="16" style={{ fill: "none", stroke: "var(--bd)", strokeWidth: 4 }} /><circle cx="20" cy="20" r="16" pathLength={100} style={{ fill: "none", stroke: plan.color, strokeWidth: 4, strokeLinecap: "round", strokeDasharray: `${Math.max(0.5, prog.pct)} 100`, transform: "rotate(-90deg)", transformOrigin: "20px 20px" }} /></svg>
                <div style={{ display: "flex", flexDirection: "column" }}><span style={{ fontSize: 15, fontWeight: 650 }}>{t("{pct}%", { pct: prog.pct })}</span><span style={{ fontSize: 11, color: "var(--mu)", whiteSpace: "nowrap" }}>{t("{done} of {total} done", { done: fmtNum(prog.done), total: fmtNum(prog.total) })}</span></div>
              </div>
              <button onClick={runCta} disabled={!next} style={{ display: "flex", alignItems: "center", gap: 10, height: 50, padding: "0 16px 0 12px", borderRadius: 12, background: "var(--ac)", color: "var(--af)", maxWidth: 320 }}>
                <span style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(0,0,0,.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><svg width="13" height="13" viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" style={{ fill: "currentColor" }} /></svg></span>
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0, textAlign: "start" }}><span style={{ fontSize: 11, fontWeight: 600, opacity: 0.75, whiteSpace: "nowrap" }} dir="auto">{ctaK}</span><span dir="auto" style={{ fontSize: 13.5, fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{next?.name ?? ""}</span></div>
              </button>
            </div>
          )}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: phone ? "8px 14px 10px" : embedded ? "10px 0" : "10px 28px", borderBottom: "1px solid var(--bd)", flexWrap: phone ? "wrap" : "nowrap", overflowX: phone ? undefined : "auto", scrollbarWidth: "none" }}>
        <div role="tablist" style={{ display: "flex", padding: 3, borderRadius: 10, background: "var(--sf2)", gap: 2, flex: phone ? "1 1 100%" : "0 0 auto" }}>
          {VIEWS.map(([k, g, l]) => { const on = k === view; return (
            <button key={k} role="tab" aria-selected={on} title={t(l)} onClick={() => setPrefs({ view: k })} style={{ flex: 1, height: 30, padding: "0 10px", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12.5, background: on ? "var(--sf)" : "transparent", color: on ? "var(--tx)" : "var(--mu)", fontWeight: on ? 600 : 400, boxShadow: on ? "0 1px 2px rgba(0,0,0,.2)" : "none", whiteSpace: "nowrap" }}>
              <Glyph name={g} size={15} />{(!phone || on) && <span>{t(l)}</span>}
            </button>
          ); })}
        </div>
        {!phone && <span style={{ flex: 1 }} />}
        <button style={tb(false)} onClick={() => setOrg(true)}><Glyph name="layers" size={14} color="var(--mu)" /><span style={{ color: "var(--mu)" }}>{t("Group")}</span>{groupLabel}</button>
        {!phone && <div style={{ position: "relative" }}>
          <button style={tb(filter || !!q)} onClick={() => setFilter((f) => !f)}><Glyph name="filter" size={14} color="var(--mu)" />{q ? t("Filter · {q}", { q }) : t("Filter")}</button>
          {filter && <FilterPop q={q} setQ={setQ} prefs={prefs} setPrefs={setPrefs} onClose={() => setFilter(false)} />}
        </div>}
        {!phone && (view === "gantt" || view === "lanes") && <div style={{ position: "relative" }}>
          <button style={tb(false)} onClick={() => setZoomMenu(true)}><Glyph name="due" size={14} color="var(--mu)" />{zoomL} ▾</button>
          {zoomMenu && <MenuPop onClose={() => setZoomMenu(false)} style={{ top: 36, right: 0 }} items={(["week", "month", "quarter"] as const).map((z) => ({ l: { week: t("Week"), month: t("Month"), quarter: t("Quarter") }[z], on: prefs.zoom === z, run: () => setPrefs({ zoom: z }) }))} />}
        </div>}
        {!phone && <button style={tb(false)} onClick={scrollToday}><Glyph name="today" size={14} color="var(--mu)" />{t("Today")}</button>}
        <button style={tb(org)} onClick={() => setOrg((o) => !o)}><Glyph name="sort" size={14} color="var(--mu)" />{t("Organize")}</button>
      </div>

      <div ref={bodyRef} style={{ flex: 1, minHeight: 0, position: "relative", display: "flex" }}>
        {(() => {
          const vp = { plan, today, phone, width: bodyW, height: bodyH, items, writes, onItem, scrollRef: (el: HTMLDivElement | null) => { scroller.current = el; } };
          if (!plan.items.length && !plan.milestones.length) return <div style={{ margin: "auto", color: "var(--mu)", fontSize: 13, maxWidth: 420, textAlign: "center", lineHeight: "20px", padding: 24 }}>{t("Nothing to plan yet. Add task lines with dates or estimates (start:2026-12-01 due:2026-12-12 ~6h) under ## headings.")}</div>;
          if (view === "lanes") return <Lanes {...vp} />;
          if (view === "board") return <Board {...vp} />;
          if (view === "agenda") return <Agenda {...vp} />;
          return <Gantt {...vp} folded={folded} onFold={fold} />;
        })()}
        {org && <Organize plan={plan} phone={phone} onClose={() => setOrg(false)} setPrefs={setPrefs} writes={writes} />}
      </div>
      {pop && <ItemPop plan={plan} today={today} pop={pop} writes={writes} onClose={() => setPop(null)} />}
    </div>
  );
}
const GROUP_LABEL: Record<GroupKey, string> = { group: "Group", track: "Track", owner: "Owner", status: "Status", tag: "Tag", source: "Source note", none: "None" };

// ------------------------------------------------------------------ Organize (54K/L, phone sheet 54Q)
function Organize({ plan, phone, onClose, setPrefs, writes }: { plan: Plan; phone: boolean; onClose: () => void; setPrefs: (p: Partial<PlanPrefs>) => void; writes: PlanWrites }) {
  const ref = useDismiss(true, onClose);
  const p = plan.prefs;
  const groupOpts: [GroupKey, string][] = [["group", plan.groupBy], ["track", "Track"], ["owner", "Owner"], ["status", "Status"], ["tag", "Tag"], ["source", "Source note"], ["none", "None"]];
  const colourOpts: [ColourKey, string][] = [["group", plan.groupBy], ["status", "Status"], ["owner", "Owner"], ["tag", "Tag"]];
  const showOpts: [ShowKey, string][] = [["milestones", "Milestones"], ["deps", "Dependencies"], ["done", "Done items"], ["weekends", "Weekends"], ["empty", "Empty groups"]];
  const sortOpts: [SortKey, string][] = [["start", "Start date"], ["due", "Due date"], ["manual", "Manual"], ["priority", "Priority"]];
  const deadline = plan.deadline;
  const schedNote = plan.mode === "deadline" && deadline != null ? t("Sessions are placed backwards from {date}, leaving the last week for mocks.", { date: fmtDow(deadline) })
    : plan.mode === "fixed" ? t("Dates come from the items (start: and due:). Undated items follow their track.") : t("Missed items roll forward; nothing is marked late until its end date passes.");
  const setMode = (m: Plan["mode"]) => {
    if (m === "deadline" && deadline == null) { const d = prompt(t("Deadline (YYYY-MM-DD)"), isoOf(todayDay() + 60)); if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return; void writes.home({ schedule: m, deadline: d }); return; }
    void writes.home({ schedule: m });
  };
  const sec = (h: string, body: ReactNode, note?: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", color: "var(--mu)" }}>{h}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{body}</div>
      {note && <span style={{ fontSize: 11.5, color: "var(--mu)", lineHeight: "16px" }}>{note}</span>}
    </div>
  );
  return (
    <>
      {phone && <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(5,6,8,.5)", zIndex: 40 }} />}
      <div ref={ref} role="dialog" aria-label={t("Organize")} className={phone ? "pl-sheet" : "pl-pop"}
        style={{ position: phone ? "fixed" : "absolute", left: phone ? 0 : "auto", right: phone ? 0 : 28, top: phone ? "auto" : 8, bottom: phone ? 0 : "auto", width: phone ? "auto" : 400, background: "var(--sf)", border: "1px solid var(--bd)", borderRadius: phone ? "20px 20px 0 0" : 14, boxShadow: "0 20px 50px rgba(0,0,0,.35)", display: "flex", flexDirection: "column", gap: 14, padding: phone ? "16px 16px 28px" : 16, zIndex: 50, maxHeight: phone ? "80dvh" : "calc(100% - 16px)", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center" }}><span style={{ fontWeight: 650, fontSize: 14, flex: 1 }}>{t("Organize")}</span><span style={{ fontSize: 12, color: "var(--mu)" }}>{t("Saved per plan")}</span></div>
        {sec(t("GROUP BY"), groupOpts.map(([k, l]) => <Opt key={k} on={p.group === k} onClick={() => setPrefs({ group: k })}>{t(l)}</Opt>))}
        {sec(t("SCHEDULE"), (["fixed", "pace", "deadline"] as const).map((m) => <Opt key={m} on={plan.mode === m} onClick={() => setMode(m)}>{m === "fixed" ? t("Fixed dates") : m === "pace" ? t("By pace · h / week") : t("Back from deadline")}</Opt>), schedNote)}
        {sec(t("COLOUR BY"), colourOpts.map(([k, l]) => <Opt key={k} on={p.colour === k} onClick={() => setPrefs({ colour: k })}>{t(l)}</Opt>))}
        {sec(t("SHOW"), showOpts.map(([k, l]) => <Opt key={k} on={p.show.includes(k)} onClick={() => setPrefs({ show: p.show.includes(k) ? p.show.filter((x) => x !== k) : [...p.show, k] })}>{t(l)}</Opt>))}
        {sec(t("SORT"), sortOpts.map(([k, l]) => <Opt key={k} on={p.sort === k} onClick={() => setPrefs({ sort: k })}>{t(l)}</Opt>))}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Filter
function FilterPop({ q, setQ, prefs, setPrefs, onClose }: { q: string; setQ: (s: string) => void; prefs: PlanPrefs; setPrefs: (p: Partial<PlanPrefs>) => void; onClose: () => void }) {
  const ref = useDismiss(true, onClose);
  const done = prefs.show.includes("done");
  return (
    <div ref={ref} className="pl-pop" style={{ position: "absolute", top: 36, right: 0, zIndex: 30, width: 260, padding: 10, borderRadius: 12, background: "var(--sf)", border: "1px solid var(--bd)", boxShadow: "0 14px 34px rgba(0,0,0,.35)", display: "flex", flexDirection: "column", gap: 8 }}>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Filter items")} aria-label={t("Filter items")} dir="auto" style={{ height: 32, borderRadius: 8, border: "1px solid var(--bd)", background: "var(--bg)", padding: "0 10px", color: "var(--tx)", outline: "none", font: "inherit" }} />
      <div style={{ display: "flex", gap: 5 }}><Opt on={!done} onClick={() => setPrefs({ show: done ? prefs.show.filter((x) => x !== "done") : [...prefs.show, "done"] })}>{t("Hide done")}</Opt>{q && <Opt on={false} onClick={() => setQ("")}>{t("Clear")}</Opt>}</div>
    </div>
  );
}

// ------------------------------------------------------------------ item popover: status, dates, open
function ItemPop({ plan, today, pop, writes, onClose }: { plan: Plan; today: Day; pop: { item: PlanItem; x: number; y: number }; writes: PlanWrites; onClose: () => void }) {
  const ref = useDismiss(true, onClose);
  const i = plan.items.find((x) => x.key === pop.item.key) ?? pop.item;
  const cpm = useMemo(() => criticalPath(plan), [plan]);
  const slack = cpm.slack.get(i.key);
  const late = daysLate(i, today);
  const v = useVault();
  const linked = i.link ? v.byTitle.get(i.link.toLowerCase()) : null;
  const ro = i.src === "module";
  return (
    <div ref={ref} role="dialog" aria-label={i.name} className="pl-pop" style={{ ...TOKENS, position: "fixed", left: Math.max(8, pop.x), top: Math.max(8, pop.y), zIndex: 60, width: 320, padding: 14, borderRadius: 14, background: "var(--sf)", border: "1px solid var(--bd)", boxShadow: "0 20px 50px rgba(0,0,0,.4)", display: "flex", flexDirection: "column", gap: 10, fontSize: 13, color: "var(--tx)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11.5, color: "var(--mu)", display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: plan.groups[i.group]?.color }} /><span dir="auto">{plan.groups[i.group]?.name}</span><span>·</span><span dir="auto">{i.owner ? plan.people[i.owner] ?? i.owner : i.track}</span></span>
        <span dir="auto" style={{ fontSize: 15, fontWeight: 650 }}>{i.name}</span>
        <span style={{ fontSize: 12, color: late ? "var(--da)" : "var(--mu)" }}>{fmtDay(i.start)} – {fmtDay(i.end)} · {late ? t("overdue {n} day|overdue {n} days", { n: late }) : slack === 0 ? t("on the critical path") : slack != null ? t("{n} day of slack|{n} days of slack", { n: slack }) : t("done")}</span>
      </div>
      {!ro && (
        <div style={{ display: "flex", padding: 3, borderRadius: 10, background: "var(--sf2)", gap: 2 }}>
          {statusWords().map(([s, l, dot]) => { const on = i.status === s || (s === "doing" && i.status === "review") || (s === "todo" && i.status === "backlog"); return (
            <button key={s} onClick={() => void writes.status(i, s)} style={{ flex: 1, height: 30, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 12, background: on ? "var(--sf)" : "transparent", color: on ? "var(--tx)" : "var(--mu)", fontWeight: on ? 600 : 400, boxShadow: on ? "0 1px 2px rgba(0,0,0,.25)" : "none" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: dot }} />{l}</button>
          ); })}
        </div>
      )}
      {!ro && (
        <div style={{ display: "grid", gridTemplateColumns: i.src === "topic" ? "1fr" : "1fr 1fr", gap: 8 }}>
          {i.src !== "topic" && <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: "var(--mu)" }}>{t("Start")}<input type="date" defaultValue={isoOf(i.start)} onChange={(e) => e.target.value && void writes.dates(i, dayOf(e.target.value), Math.max(dayOf(e.target.value), i.end))} style={dateCss} /></label>}
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: "var(--mu)" }}>{t("Due")}<input type="date" defaultValue={isoOf(i.end)} onChange={(e) => e.target.value && void writes.dates(i, i.src === "topic" ? null : Math.min(i.start, dayOf(e.target.value)), dayOf(e.target.value))} style={dateCss} /></label>
        </div>
      )}
      {ro && <span style={{ fontSize: 12, color: "var(--mu)" }}>{t("{done} of {total} topics done", { done: i.doneCount ?? 0, total: i.count })}</span>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {linked && <button onClick={() => { openNote(linked.id); onClose(); }} style={{ height: 32, padding: "0 12px", borderRadius: 8, border: "1px solid var(--bd)" }}>{t("Open note")}</button>}
        <button onClick={() => { openNote(i.noteId); onClose(); }} style={{ height: 32, padding: "0 12px", borderRadius: 8, background: "var(--ac)", color: "var(--af)", fontWeight: 650 }}>{t("Open source")}</button>
      </div>
    </div>
  );
}
const dateCss: React.CSSProperties = { height: 32, borderRadius: 8, border: "1px solid var(--bd)", background: "var(--bg)", padding: "0 8px", color: "var(--tx)", font: "inherit", colorScheme: "light dark" };
