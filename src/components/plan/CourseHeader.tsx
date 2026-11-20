// Course page header (design round 8: CourseTimeline.dc.html header, Lumen 53A): 48 px tile, title on its own line
// with the description under it (no truncation into one line), chips (kind · level range · dates and weeks · pace),
// a progress ring, and Continue with the module above the topic name.
import { useMemo, type ReactNode } from "react";
import type { Note, Space } from "../../../shared/types";
import { Glyph } from "../Glyph";
import { courseFacts } from "./CourseTimeline";
import { fmtNum, t } from "../../lib/i18n";
import { TOKENS, fmtMonthYear } from "./plan-ui";

export function CourseHeader({ sp, rm, color, done, total, onContinue, more }: { sp: Space; rm: Note; color: string; done: number; total: number; onContinue?: () => void; more?: ReactNode }) {
  const f = useMemo(() => courseFacts(rm, sp), [rm, sp]);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const icon = sp.icon.startsWith("glyph:") ? sp.icon.slice(6) : "course";
  const meta: [string, string][] = [
    ["lesson", sp.props.provider || t("Self-study course")],
    ...(sp.props.levels || f.fm.levelrange ? [["s-mastered", sp.props.levels || f.fm.levelrange] as [string, string]] : []),
    ["due", `${fmtMonthYear(f.lo)} – ${fmtMonthYear(f.hi)} · ${t("{n} weeks", { n: f.weeks })}`],
    ["clock", t("{n} h / week", { n: f.cm.plan.pace })],
  ];
  return (
    <div className="pl-root" style={{ ...TOKENS, display: "flex", alignItems: "flex-start", gap: 16, fontSize: 13, lineHeight: "normal" }}>
      <span style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: `color-mix(in srgb,${color} 16%,transparent)`, color }}><Glyph name={icon} size={24} /></span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span dir="auto" style={{ fontSize: 24, fontWeight: 650, letterSpacing: "-.02em" }}>{sp.name}</span>
          {sp.props.language && <span style={{ fontSize: 13, color: "var(--mu)" }}>{t("in {lang}", { lang: sp.props.language })}</span>}
        </div>
        {sp.description && <span dir="auto" style={{ fontSize: 13.5, color: "var(--mu)", textWrap: "pretty" } as React.CSSProperties}>{sp.description}</span>}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4, fontSize: 12, color: "var(--mu)" }}>
          {meta.map(([g, l]) => <span key={g} style={{ display: "flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 999, background: "var(--sf2)", whiteSpace: "nowrap" }}><Glyph name={g} size={13} stroke={1.9} /><span dir="auto">{l}</span></span>)}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden><circle cx="20" cy="20" r="16" style={{ fill: "none", stroke: "var(--bd)", strokeWidth: 4 }} /><circle cx="20" cy="20" r="16" pathLength={200} style={{ fill: "none", stroke: "var(--ac)", strokeWidth: 4, strokeLinecap: "round", strokeDasharray: `${Math.max(0.5, pct * 2)} 200`, transform: "rotate(-90deg)", transformOrigin: "20px 20px" }} /></svg>
          <div style={{ display: "flex", flexDirection: "column" }}><span style={{ fontSize: 15, fontWeight: 650 }}>{t("{pct}%", { pct })}</span><span style={{ fontSize: 11, color: "var(--mu)", whiteSpace: "nowrap" }}>{t("{done} of {total}", { done: fmtNum(done), total: fmtNum(total) })}</span></div>
        </div>
        {f.next && onContinue && (
          <button onClick={onContinue} style={{ display: "flex", alignItems: "center", gap: 10, height: 52, padding: "0 16px 0 12px", borderRadius: 12, background: "var(--ac)", color: "var(--af)", maxWidth: 340, border: 0, cursor: "pointer", font: "inherit" }}>
            <span style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(0,0,0,.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><svg width="14" height="14" viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" style={{ fill: "currentColor" }} /></svg></span>
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0, textAlign: "start" }}><span dir="auto" style={{ fontSize: 11, fontWeight: 600, opacity: 0.75, whiteSpace: "nowrap" }}>{t("Continue · {where}", { where: f.where })}</span><span dir="auto" style={{ fontSize: 13.5, fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.next.name}</span></div>
          </button>
        )}
        {more}
      </div>
    </div>
  );
}
