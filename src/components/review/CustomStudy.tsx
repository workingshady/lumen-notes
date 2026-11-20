// Custom study (Lumen 57E / 57M · ReviewStudio screen "custom"). A preview session: it never changes the schedule.
import { useMemo, useState } from "react";
import type { Space } from "../../../shared/types";
import type { DueItem } from "../../lib/due-cards";
import { customMatch, limitCount, limitMs, LIMIT, ORDER, WHICH, type CustomOpts } from "../../lib/review-decks";
import { spaceColor } from "../../lib/space-icon";
import { t } from "../../lib/i18n";

const AC = "color-mix(in srgb,var(--ac) 16%,transparent)";
const chip = (on: boolean) => ({ height: 32, padding: "0 11px", borderRadius: 8, display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, border: `1px solid ${on ? "var(--ac)" : "var(--bd)"}`, background: on ? AC : "transparent", fontWeight: on ? 600 : 400, whiteSpace: "nowrap" as const, color: "var(--tx)", cursor: "pointer" });

export function CustomStudy({ items, spaces, forgotten, phone, secPer, onClose, onStart }: {
  items: DueItem[]; spaces: Space[]; forgotten: Set<string>; phone: boolean; secPer: number;
  onClose: () => void; onStart: (queue: DueItem[], timeLimit: number, title: string) => void;
}) {
  const [o, setO] = useState<CustomOpts>({ from: [], which: 0, order: 0, limit: 1 });
  const [extra, setExtra] = useState<{ key: string; l: string; c: string }[]>([]);
  const [pick, setPick] = useState(false);
  const [q, setQ] = useState("");
  const now = useMemo(() => Date.now(), [o]); // eslint-disable-line react-hooks/exhaustive-deps
  const withCards = useMemo(() => new Set(items.map((x) => x.note.spaceId)), [items]);
  const srcSpaces = spaces.filter((s) => withCards.has(s.id) && !s.archived).map((s) => ({ key: `s:${s.id}`, l: s.name, c: spaceColor(s) }));
  const sources = [...srcSpaces, ...extra];
  const choices = useMemo(() => {
    const tags = new Map<string, number>(), notes = new Map<string, { l: string; n: number }>();
    for (const it of items) {
      for (const tg of it.note.tags ?? []) tags.set(tg, (tags.get(tg) ?? 0) + 1);
      const x = notes.get(it.note.id); if (x) x.n++; else notes.set(it.note.id, { l: it.note.title, n: 1 });
    }
    return [...[...tags].map(([tg, n]) => ({ key: `t:${tg}`, l: `#${tg}`, n })), ...[...notes].map(([id, x]) => ({ key: `n:${id}`, l: x.l, n: x.n }))];
  }, [items]);
  const match = useMemo(() => customMatch(items, o, forgotten, now), [items, o, forgotten, now]);
  const lim = limitCount(o), tl = limitMs(o);
  const count = Math.min(match.length, lim);
  const mins = Math.max(match.length ? 1 : 0, Math.round(((count * secPer) / 60)));
  const shownMins = tl ? Math.min(mins, 15) : mins;
  const toggle = (k: string) => setO((x) => ({ ...x, from: x.from.includes(k) ? x.from.filter((y) => y !== k) : [...x.from, k] }));
  const sec = (h: string, body: React.ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}><span style={{ fontSize: 11, fontWeight: 650, letterSpacing: ".06em", color: "var(--mu)" }}>{h}</span><div style={{ display: "flex", flexWrap: "wrap", gap: 6, position: "relative" }}>{body}</div></div>
  );
  const one = (list: readonly string[], key: "which" | "order" | "limit") => list.map((l, i) => <button key={l} type="button" style={chip(o[key] === i)} onClick={() => setO((x) => ({ ...x, [key]: i }))}>{/^\d+$/.test(l) ? l : t(l)}</button>);
  const filtered = choices.filter((c) => !sources.some((s) => s.key === c.key) && c.l.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  const title = o.from.length ? sources.filter((s) => o.from.includes(s.key)).map((s) => s.l).join(", ") : t("Custom study");
  return (
    <>
      <div className="rv-fade" style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 5 }} onClick={onClose} />
      <div role="dialog" aria-label={t("Custom study")} className={phone ? "rv-sheet" : "rv-pop"} style={{ position: "absolute", zIndex: 6, left: phone ? 0 : "calc(50% - 280px)", right: phone ? 0 : "calc(50% - 280px)", top: 120, bottom: phone ? 0 : "auto", maxHeight: phone ? undefined : "calc(100% - 140px)", overflowY: "auto", background: "var(--sf)", border: "1px solid var(--bd)", borderRadius: phone ? "20px 20px 0 0" : 16, boxShadow: "0 30px 80px rgba(0,0,0,.45)", display: "flex", flexDirection: "column", gap: 16, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center" }}><span style={{ fontWeight: 650, fontSize: 16, flex: 1 }}>{t("Custom study")}</span><button type="button" aria-label={t("Close")} onClick={onClose} style={{ color: "var(--mu)", fontSize: 18 }}>×</button></div>
        {sec(t("FROM"), <>
          {sources.map((s) => <button key={s.key} type="button" style={chip(o.from.includes(s.key))} onClick={() => toggle(s.key)}><span style={{ width: 8, height: 8, borderRadius: 2, background: s.c }} /><span dir="auto">{s.l}</span></button>)}
          <button type="button" style={chip(false)} onClick={() => setPick((p) => !p)}>{t("+ deck or tag")}</button>
          {pick && (
            <div style={{ position: "absolute", top: "100%", insetInlineStart: 0, marginTop: 6, width: 280, maxHeight: 260, overflowY: "auto", zIndex: 2, background: "var(--sf)", border: "1px solid var(--bd)", borderRadius: 10, boxShadow: "0 12px 30px rgba(0,0,0,.35)", padding: 6, display: "flex", flexDirection: "column", gap: 2 }}>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Find a deck or tag")} style={{ height: 30, padding: "0 8px", borderRadius: 7, border: "1px solid var(--bd)", background: "var(--bg)", color: "var(--tx)", fontSize: 12.5, marginBottom: 4 }} />
              {filtered.length ? filtered.map((c) => (
                <button key={c.key} type="button" className="rv-hover" onClick={() => { setExtra((x) => [...x, { key: c.key, l: c.l, c: c.key.startsWith("t:") ? "var(--ln)" : "var(--mu)" }]); setO((x) => ({ ...x, from: [...x.from, c.key] })); setPick(false); setQ(""); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 8px", borderRadius: 7, fontSize: 12.5, textAlign: "start" }}>
                  <span dir="auto" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.l}</span><span style={{ color: "var(--mu)", fontSize: 11.5 }}>{c.n}</span>
                </button>
              )) : <span style={{ padding: 8, fontSize: 12, color: "var(--mu)" }}>{t("Nothing to add")}</span>}
            </div>
          )}
        </>)}
        {sec(t("WHICH CARDS"), one(WHICH, "which"))}
        {sec(t("ORDER"), one(ORDER, "order"))}
        {sec(t("LIMIT"), one(LIMIT, "limit"))}
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1, fontSize: 12.5, color: "var(--mu)" }}>{t("{n} card match|{n} cards match", { n: count })} · ~{t("{n} min", { n: shownMins })} · {t("doesn’t change your schedule")}</span>
          <button type="button" disabled={!count} onClick={() => onStart(match.slice(0, lim === Infinity ? undefined : lim), tl, title)} style={{ height: 38, padding: "0 16px", borderRadius: 10, background: "var(--ac)", color: "var(--af)", display: "flex", alignItems: "center", fontWeight: 650, opacity: count ? 1 : .5 }}>{t("Start")}</button>
        </div>
      </div>
    </>
  );
}
