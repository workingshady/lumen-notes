// Review hub (Lumen 57A–E, 57J, 57M · ReviewStudio screens "hub" / "custom"), ported 1:1 from
// design/handoffs/2026-11-21-round-8/ReviewStudio.dc.html. Review all mixes every due card; decks group the same
// cards by space, plan, tag or card type; smart decks (leeches, due soon); custom study never changes the schedule.
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { Glyph } from "../Glyph";
import type { GlyphName } from "../../lib/glyphs";
import { db } from "../../lib/db";
import { useCardItems, useDueCards, type DueItem } from "../../lib/due-cards";
import { avgMinutesPerDay, buildRows, DAY, forecast, GROUP_LABEL, GROUPS, isLeech, retentionMap, secPerCard, statOf, type Group, type Row, deckQueue } from "../../lib/review-decks";
import { go, useVault } from "../../lib/store";
import { fmtNum, locale, t } from "../../lib/i18n";
import { ReviewSession } from "../Review";
import { BacklogCard, BACKLOG } from "../review-backlog";
import { CustomStudy } from "./CustomStudy";
import { RV_CSS, TOKENS, usePhone, useStreak } from "./shared";

interface Run { items: DueItem[]; pool: DueItem[]; title: string; cram?: boolean; timeLimit?: number; limit?: number; backlog?: boolean }
const GROUP_KEY = "lumen.review.group";
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

export function ReviewView() {
  const v = useVault();
  const phone = usePhone();
  const items = useCardItems(v.notes);
  const due = useDueCards(v.notes);
  const [now] = useState(() => Date.now());
  const logs = useLiveQuery(() => db.reviews.where("at").above(Date.now() - 30 * DAY).toArray(), []) ?? [];
  const [group, setGroupS] = useState<Group>(() => { try { const g = localStorage.getItem(GROUP_KEY) as Group; return GROUPS.includes(g) ? g : "Space"; } catch { return "Space"; } });
  const setGroup = (g: Group) => { setGroupS(g); try { localStorage.setItem(GROUP_KEY, g); } catch { /* private mode */ } };
  const [custom, setCustom] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [tick, setTick] = useState(0);
  const streak = useStreak(tick);

  const live = useMemo(() => (logs ?? []).filter((r) => !r.deleted), [logs]);
  const cx = useMemo(() => ({ now: Date.now(), due: new Map((due ?? []).map((d) => [d.card.id, d])), ret: retentionMap(live, Date.now()) }), [due, live]);
  const rows = useMemo(() => (items ? buildRows(group, { items, spaces: v.spaces, notes: v.notes, cx }) : []), [group, items, v.spaces, v.notes, cx]);
  const forgotten = useMemo(() => new Set(live.filter((r) => r.grade === 0 && r.at > Date.now() - 7 * DAY).map((r) => r.cardId)), [live]);
  const sec = secPerCard(live);

  if (!items || !due) return null;

  if (run) {
    if (run.backlog) return <div className="fixed inset-0 z-40 bg-bg"><BacklogCard cards={run.items.map((d) => d.card)} onChunk={(n) => setRun({ ...run, backlog: false, limit: n })} onAll={() => setRun({ ...run, backlog: false })} onExit={() => setRun(null)} /></div>;
    return <div className="fixed inset-0 z-40 bg-bg"><ReviewSession items={run.items} pool={run.pool} title={run.title} cram={run.cram} timeLimit={run.timeLimit} limit={run.limit} onExit={() => { setRun(null); setTick((x) => x + 1); }} /></div>;
  }

  const all = statOf(items, cx);
  const total = due.length;
  const mins = Math.max(total ? 1 : 0, Math.round((total * sec) / 60));
  const start = (r: Extract<Row, { kind: "deck" }>) => setRun({ items: r.top ? due : deckQueue(r, due), pool: r.items, title: r.label });
  const reviewAll = () => setRun({ items: due, pool: items, title: t("All decks"), backlog: due.length > BACKLOG });
  const fcData = forecast(items, total, cx.now);
  const fcMax = Math.max(1, ...fcData.map((b) => b.n));
  const wd = new Intl.DateTimeFormat(locale() ?? undefined, { weekday: "short" });
  const leeches = items.filter((it) => isLeech(it.card)).length;
  const retAll = (() => { let ok = 0, n = 0; for (const r of cx.ret.values()) { ok += r[0]; n += r[1]; } return n ? ok / n : null; })();
  const stats = [[pct(retAll), t("Retention · 30 d"), "var(--ok)"], [fmtNum(streak), t("Day streak"), "var(--ac)"], [t("{n} min", { n: avgMinutesPerDay(live, cx.now) }), t("Avg / day"), "var(--tx)"], [fmtNum(leeches), t("Leeches"), "var(--da)"]];
  const dk = phone ? "none" : "flex";
  void now;

  return (
    <div className="rv57" style={{ ...TOKENS, position: "relative", height: "100%", overflow: "hidden", background: "var(--bg)", fontFamily: "Inter,system-ui,sans-serif", fontSize: 13, color: "var(--tx)", display: "flex", flexDirection: "column" }}>
      <div className="safe-t" style={{ display: "flex", alignItems: "center", gap: 12, padding: phone ? "6px 16px 12px" : "22px 28px 14px", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: phone ? 22 : 26, fontWeight: 650, letterSpacing: "-.02em" }}>{t("Review")}</span>
          <span style={{ fontSize: 13, color: "var(--mu)" }}>{t("{due} due · {new} new · about {min} min.", { due: fmtNum(all.d + all.l), new: fmtNum(all.n), min: fmtNum(mins) })}{streak > 0 && <> {t("{n}-day streak.", { n: streak })}</>}</span>
        </div>
        <button type="button" className="rv-hover" onClick={() => setCustom(true)} style={{ display: dk, height: 36, padding: "0 12px", borderRadius: 9, border: "1px solid var(--bd)", alignItems: "center", gap: 6, fontSize: 12.5 }}>{t("Custom study…")}</button>
        <button type="button" disabled={!total} onClick={reviewAll} className="rv-bright" style={{ height: 42, padding: "0 18px", borderRadius: 11, background: "var(--ac)", color: "var(--af)", display: "flex", alignItems: "center", gap: 8, fontWeight: 650, fontSize: 14, whiteSpace: "nowrap", opacity: total ? 1 : .55 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" className="rtl:-scale-x-100"><path d="M8 5l11 7-11 7z" style={{ fill: "currentColor" }} /></svg>{t("Review all · {n}", { n: fmtNum(total) })}
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: phone ? "0 16px 10px" : "0 28px 12px", borderBottom: "1px solid var(--bd)", flexWrap: phone ? "nowrap" : "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--mu)" }}>{t("Group decks by")}</span>
        <div role="tablist" style={{ display: "flex", padding: 3, borderRadius: 10, background: "var(--sf2)", gap: 2 }}>
          {GROUPS.map((g) => { const on = g === group; return <button key={g} role="tab" aria-selected={on} type="button" onClick={() => setGroup(g)} style={{ height: 28, padding: "0 10px", borderRadius: 7, display: "flex", alignItems: "center", fontSize: 12.5, background: on ? "var(--sf)" : "transparent", color: on ? "var(--tx)" : "var(--mu)", fontWeight: on ? 600 : 400, boxShadow: on ? "0 1px 2px rgba(0,0,0,.2)" : "none", whiteSpace: "nowrap", transition: "background .15s, color .15s" }}>{t(GROUP_LABEL[g])}</button>; })}
        </div>
        {phone && <><span style={{ flex: 1 }} /><button type="button" title={t("Custom study…")} aria-label={t("Custom study…")} onClick={() => setCustom(true)} style={{ width: 34, height: 34, borderRadius: 9, border: "1px solid var(--bd)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--mu)" }}><Glyph name="filter" size={16} /></button></>}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 20, padding: phone ? "0 8px" : "8px 28px 20px", overflow: "hidden" }}>
        <div className="rv-scroll" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflowY: "auto", paddingBottom: phone ? 90 : 0 }}>
          <div style={{ display: dk, alignItems: "center", gap: 10, padding: "10px 12px", fontSize: 11, fontWeight: 650, letterSpacing: ".06em", color: "var(--mu)", flexShrink: 0 }}>
            <span style={{ flex: 1 }}>{t("DECK")}</span><span style={{ width: 52, textAlign: "end", color: "var(--ln)" }}>{t("NEW")}</span><span style={{ width: 60, textAlign: "end", color: "var(--wa)" }}>{t("LEARN")}</span><span style={{ width: 52, textAlign: "end", color: "var(--ok)" }}>{t("DUE")}</span><span style={{ width: 90, textAlign: "end" }}>{t("RETENTION")}</span><span style={{ width: 84 }} />
          </div>
          {rows.map((d) => d.kind === "head" ? (
            <div key={`h-${d.id}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 12px 6px", fontSize: 12, fontWeight: 650, color: "var(--mu)", flexShrink: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: d.c }} /><span dir="auto">{d.h}</span><span style={{ fontWeight: 400 }}>{d.hn}</span>
            </div>
          ) : (
            <div key={`d-${d.id}`} className="rv-row" role="button" tabIndex={0} onClick={() => start(d)} onKeyDown={(e) => { if (e.key === "Enter") start(d); }}
              style={{ display: "flex", alignItems: "center", gap: 10, minHeight: d.top ? 54 : 48, paddingBlock: 0, paddingInlineStart: d.top || phone ? 12 : 30, paddingInlineEnd: 12, borderRadius: 10, background: d.top ? "var(--sf)" : "transparent", borderBottom: "1px solid color-mix(in srgb,var(--bd) 50%,transparent)", cursor: "pointer", flexShrink: 0 }}>
              <Glyph name={d.glyph as GlyphName} size={16} color={d.c} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span dir="auto" style={{ fontSize: 13.5, fontWeight: d.top ? 650 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.label}</span>
                <span style={{ fontSize: 11.5, color: "var(--mu)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.sub}</span>
              </div>
              <span style={{ width: 52, textAlign: "end", fontVariantNumeric: "tabular-nums", color: d.stat.n ? "var(--ln)" : "var(--mu)" }}>{fmtNum(d.stat.n)}</span>
              <span style={{ display: phone ? "none" : "block", width: 60, textAlign: "end", fontVariantNumeric: "tabular-nums", color: d.stat.l ? "var(--wa)" : "var(--mu)" }}>{fmtNum(d.stat.l)}</span>
              <span style={{ width: 52, textAlign: "end", fontVariantNumeric: "tabular-nums", fontWeight: 650, color: d.stat.d ? "var(--ok)" : "var(--mu)" }}>{fmtNum(d.stat.d)}</span>
              <div style={{ display: dk, width: 90, justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
                <div style={{ width: 44, height: 4, borderRadius: 2, background: "var(--sf2)" }}><div style={{ height: "100%", width: d.stat.ret === null ? 0 : pct(d.stat.ret), borderRadius: 2, background: d.stat.ret !== null && d.stat.ret < 0.8 ? "var(--wa)" : "var(--ok)" }} /></div>
                <span style={{ fontSize: 11.5, color: "var(--mu)", width: 30, textAlign: "end" }}>{pct(d.stat.ret)}</span>
              </div>
              <button type="button" className="rv-hover" onClick={(e) => { e.stopPropagation(); start(d); }} style={{ display: phone ? "none" : "flex", width: 84, height: 30, borderRadius: 8, border: "1px solid var(--bd)", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{t("Study")}</button>
            </div>
          ))}
        </div>
        <div style={{ width: 300, flexShrink: 0, display: dk, flexDirection: "column", gap: 14, overflowY: "auto" }}>
          <div style={{ padding: 14, borderRadius: 14, background: "var(--sf)", border: "1px solid var(--bd)", display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 650, color: "var(--mu)", letterSpacing: ".05em" }}>{t("DUE · NEXT 7 DAYS")}</span>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 90 }}>
              {fcData.map((b, i) => (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }} title={new Date(b.day).toLocaleDateString(locale() ?? undefined)}>
                  <span style={{ fontSize: 10, color: "var(--mu)" }}>{fmtNum(b.n)}</span>
                  <div className="rv-bar" style={{ width: "100%", height: (b.n / fcMax) * 56, borderRadius: 4, background: i === 0 ? "var(--ac)" : "color-mix(in srgb,var(--mu) 45%,transparent)" }} />
                  <span style={{ fontSize: 10.5, color: "var(--mu)" }}>{wd.format(b.day)}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ padding: 14, borderRadius: 14, background: "var(--sf)", border: "1px solid var(--bd)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {stats.map(([val, l, c]) => <div key={l} style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 20, fontWeight: 650, color: c }}>{val}</span><span style={{ fontSize: 11.5, color: "var(--mu)" }}>{l}</span></div>)}
          </div>
          <div style={{ padding: 14, borderRadius: 14, background: "var(--sf)", border: "1px solid var(--bd)", display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, lineHeight: "18px" }}>
            <b>{t("All, or by category?")}</b>
            <span style={{ color: "var(--mu)" }}>{t("Both. Review all mixes every due card, spaced across decks. Pick a deck, plan, tag or smart deck to study only that. Cards live in notes, so a card can be in a space deck and a tag deck at once; it is still reviewed once.")}</span>
          </div>
        </div>
      </div>
      {!items.length && (
        <div style={{ position: "absolute", insetInline: 0, bottom: phone ? 110 : 40, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
          <span style={{ fontSize: 12.5, color: "var(--mu)", pointerEvents: "auto" }}>{t("No cards yet. Write Question :: Answer in any note.")} <button type="button" onClick={() => go("notes")} style={{ color: "var(--ln)" }}>{t("Open notes")}</button></span>
        </div>
      )}
      {custom && <CustomStudy items={items} spaces={v.spaces} forgotten={forgotten} phone={phone} secPer={sec} onClose={() => setCustom(false)}
        onStart={(queue, tl, title) => { setCustom(false); setRun({ items: queue, pool: queue, title, cram: true, timeLimit: tl || undefined }); }} />}
      <style>{RV_CSS}</style>
    </div>
  );
}

