// Small pieces of the Versioning design (Lumen 58 · VersionStudio.dc.html), ported 1:1: pill buttons, the diff mode
// segment, one diff row, the history side list, a dropdown of versions.
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { fmtNum, t } from "../../lib/i18n";
import type { DLine } from "../../lib/versions-diff";
import { Glyph } from "../Glyph";
import { dayStart, DAY, hm, restoreText, whenLong, type HRow } from "./vs-util";
import { fmtDate } from "../../lib/i18n";

export const AC16 = "color-mix(in srgb,var(--accent) 16%,transparent)";
const mix = (c: string, p: number) => `color-mix(in srgb,${c} ${p}%,transparent)`;

/** Header / dialog button (design `btn`): primary = accent fill, else outlined. */
export function VBtn({ l, g, pri, onClick, disabled, h = 32, hide, title }: { l?: string; g?: string; pri?: boolean; onClick?: () => void; disabled?: boolean; h?: number; hide?: boolean; title?: string }) {
  if (hide) return null;
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={title ?? l}
      style={{ height: h, padding: `0 ${h > 34 ? 14 : 11}px`, borderRadius: h > 34 ? 9 : 8, border: `1px solid ${pri ? "transparent" : "var(--border)"}`, background: pri ? "var(--accent)" : "transparent", color: pri ? "var(--accent-fg)" : "var(--text)", display: "flex", alignItems: "center", gap: 6, fontSize: h > 34 ? 13 : 12.5, fontWeight: pri ? 650 : 500, whiteSpace: "nowrap", opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer" }}>
      {g && <Glyph name={g as never} size={15} />}{l}
    </button>
  );
}

/** Inline | Side by side | Preview segment. */
export function Seg3<T extends string>({ value, options, onChange }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" style={{ display: "flex", padding: 3, borderRadius: 9, background: "var(--surface-2)", gap: 2 }}>
      {options.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
          style={{ height: 26, padding: "0 10px", borderRadius: 6, display: "flex", alignItems: "center", fontSize: 12, background: value === o.v ? "var(--surface)" : "transparent", color: value === o.v ? "var(--text)" : "var(--muted)", fontWeight: value === o.v ? 600 : 400, whiteSpace: "nowrap" }}>{o.l}</button>
      ))}
    </div>
  );
}

/** One diff row (design `LN`): marker column, tint, 3px edge, words with their own marks. `picked` outlines a selected row. */
export function DRow({ l, phone, onClick, picked, strike = true }: { l: DLine; phone: boolean; onClick?: () => void; picked?: boolean; strike?: boolean }) {
  const m = l.m;
  const colour = m === "+" ? "var(--success)" : m === "-" ? "var(--danger)" : m === "~" ? "var(--warning)" : "transparent";
  const style: CSSProperties = {
    display: "flex", gap: 10, padding: l.h ? "8px 8px 2px" : "3px 8px", borderRadius: 6,
    background: m === "+" ? mix("var(--success)", 10) : m === "-" ? mix("var(--danger)", 10) : m === "~" ? mix("var(--warning)", 8) : "transparent",
    borderLeft: `3px solid ${colour}`, cursor: onClick && m ? "pointer" : undefined, outline: picked ? "2px solid var(--accent)" : "none", outlineOffset: -2,
  };
  return (
    <div style={style} onClick={m ? onClick : undefined} data-m={m || undefined} dir="auto">
      <span style={{ width: 12, flexShrink: 0, font: "600 12px 'JetBrains Mono',monospace", color: m === "+" ? "var(--success)" : m === "-" ? "var(--danger)" : "var(--muted)", paddingTop: l.h === 1 ? 8 : 4 }}>{m === "~" ? "~" : m}</span>
      <span style={{ flex: 1, minWidth: 0, fontFamily: l.h ? "Inter" : "'Source Serif 4',Georgia,serif", fontSize: l.h ? (l.h === 1 ? 22 : 16) : phone ? 14.5 : 15.5, fontWeight: l.h ? 650 : 400, lineHeight: 1.6, color: m === "-" ? "var(--muted)" : "var(--text)", textDecoration: m === "-" ? "line-through" : "none", textWrap: "pretty", overflowWrap: "anywhere" }}>
        {l.toks.map((w, i) => (
          <span key={i} style={{ background: w.k === "+" ? mix("var(--success)", 26) : w.k === "-" ? mix("var(--danger)", 26) : "transparent", textDecoration: w.k === "-" && strike ? "line-through" : "none", borderRadius: 3, padding: "0 1px" }}>{w.s}</span>
        ))}
      </span>
    </div>
  );
}

const KIND_COLOUR = { cur: "var(--success)", named: "var(--accent)", ai: "var(--learn)", sync: "var(--link)", restore: "var(--muted)", auto: "var(--muted)" } as const;
export const TAG: Record<string, string> = { named: "Named", ai: "AI", sync: "Sync", restore: "Restore" };

/** Group header text for a row: Today / Yesterday / "18 November". */
export function dayLabel(ts: number) {
  const d0 = dayStart(Date.now());
  if (ts >= d0) return t("Today");
  if (ts >= d0 - DAY) return t("Yesterday");
  return fmtDate(ts, { day: "numeric", month: "long", ...(new Date(ts).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}

export interface SideItem { key: string; label: string; sub: string; time: string; add?: number; del?: number; tag?: string; tagKind?: keyof typeof KIND_COLOUR; kind: keyof typeof KIND_COLOUR; selected?: boolean; second?: boolean; head?: string; onClick?: (e: React.MouseEvent) => void; onDouble?: () => void; title?: string }

/** The history column: day headers and version rows with a dot (named = rotated square), tag pills and +/- counts. */
export function SideList({ items, empty }: { items: SideItem[]; empty?: string }) {
  return (
    <>
      {items.map((v) => (
        <div key={v.key}>
          {v.head && <div style={{ padding: "10px 16px 4px", fontSize: 11, fontWeight: 650, letterSpacing: ".06em", color: "var(--muted)", textTransform: "uppercase" }}>{v.head}</div>}
          <div role="button" tabIndex={0} aria-selected={!!v.selected} title={v.title} onClick={v.onClick} onDoubleClick={v.onDouble} onKeyDown={(e) => { if (e.key === "Enter") (v.onClick as unknown as () => void)?.(); }}
            style={{ display: "flex", gap: 10, margin: "0 8px", padding: "8px 8px 8px 10px", borderRadius: 9, background: v.selected ? AC16 : v.second ? mix("var(--success)", 12) : "transparent", border: `1px solid ${v.selected ? mix("var(--accent)", 50) : v.second ? mix("var(--success)", 50) : "transparent"}`, position: "relative", cursor: "pointer", outline: "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 14, paddingTop: 4 }}>
              <span style={{ width: v.kind === "named" ? 10 : 8, height: v.kind === "named" ? 10 : 8, borderRadius: v.kind === "named" ? 2 : "50%", background: KIND_COLOUR[v.kind], boxShadow: "0 0 0 3px var(--surface)", transform: v.kind === "named" ? "rotate(45deg)" : "none" }} />
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span dir="auto" style={{ fontSize: 13, fontWeight: v.kind === "named" || v.selected ? 650 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>{v.label}</span>
                <span style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{v.time}</span>
              </div>
              <span dir="auto" style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.sub}</span>
              {(v.add || v.del || v.tag) ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, font: "500 11px 'JetBrains Mono',monospace", whiteSpace: "nowrap" }}>
                  <span style={{ color: "var(--success)" }}>{v.add ? `+${fmtNum(v.add)}` : ""}</span>
                  <span style={{ color: "var(--danger)" }}>{v.del ? `−${fmtNum(v.del)}` : ""}</span>
                  {v.tag && <span style={{ fontFamily: "Inter", fontSize: 10.5, fontWeight: 650, padding: "0 6px", borderRadius: 999, border: `1px solid ${KIND_COLOUR[v.tagKind ?? v.kind]}`, color: KIND_COLOUR[v.tagKind ?? v.kind] }}>{v.tag}</span>}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ))}
      {!items.length && empty && <p style={{ padding: "6px 16px", color: "var(--muted)" }}>{empty}</p>}
    </>
  );
}

/** Text labels of a history row, shared by the side list and the from / to menus. */
export function rowLabels(r: HRow, device: string): { label: string; sub: string; time: string; tag?: string } {
  const v = r.v!;
  const who = r.mine ? t("You") : v.device || t("another device");
  const dev = v.device || device;
  const time = hm(r.to);
  if (r.kind === "named") return { label: `★ ${v.label === "Manual save" ? t("Manual save") : v.label}`, sub: `${t("Named")} · ${who} · ${t("kept forever")}`, time, tag: t(TAG.named) };
  if (r.kind === "ai") return { label: v.label, sub: `${t("Ask")} · ${t("applied by you")} · ${time}`, time, tag: t(TAG.ai) };
  if (r.kind === "restore") return { label: restoreText(v.label), sub: `${who} · ${time}`, time, tag: t(TAG.restore) };
  if (r.kind === "sync") return { label: t("Synced from {device}", { device: dev }), sub: `${who} · ${time}`, time, tag: t(TAG.sync) };
  return { label: r.n > 1 ? t("{n} edits", { n: fmtNum(r.n) }) : t("auto-save"), sub: `${who} · ${dev} · ${r.n > 1 ? `${hm(r.from)} – ${hm(r.to)}` : whenLong(r.to)}`, time };
}

/** Closes a popover on an outside click or Escape. */
export function usePopClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    addEventListener("mousedown", down);
    addEventListener("keydown", key, true);
    return () => { removeEventListener("mousedown", down); removeEventListener("keydown", key, true); };
  }, [open, close]);
  return ref;
}

export function Pill({ dot, children, onClick, open, menu }: { dot: string; children: ReactNode; onClick: () => void; open?: boolean; menu?: ReactNode }) {
  return (
    <span style={{ position: "relative" }}>
      <button type="button" onClick={onClick} aria-expanded={!!open} style={{ display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 10px", borderRadius: 8, background: "var(--surface-2)", fontSize: 12.5, whiteSpace: "nowrap" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot }} />{children} ▾
      </button>
      {open && menu}
    </span>
  );
}
