// Shared Display-panel pieces for the notes graph and canvases (design round 4, 14b Graphs & connections):
// segmented controls, edge-shape segment with its little path icons, line samples, the Tidy up button and the
// Tidy up preview banner.
import type { ReactNode } from "react";
import { cx } from "./ui";
import { Glyph } from "./Glyph";
import { t, tk } from "../lib/i18n";

export type EdgeShape = "curved" | "elbow" | "straight";
export const EDGE_SHAPES: [EdgeShape, string, string][] = [
  ["curved", tk("Curved"), "M2 2C8 2 8 10 14 10"],
  ["elbow", tk("Elbow"), "M2 2H7Q8 2 8 3V9Q8 10 9 10H14"],
  ["straight", tk("Straight"), "M2 2L14 10"],
];

/** On/off switch (9A: 30×18, amber when on). */
export function Switch({ on, onChange, label, right }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode; right?: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full items-center gap-2.5 text-start leading-[18px]">
      <span className="flex min-w-0 flex-1 items-center gap-2.5">{label}</span>
      {right}
      <span className={cx("relative box-border h-[18px] w-[30px] shrink-0 rounded-full transition-colors", on ? "bg-accent" : "border border-line bg-surface-2")}>
        <span className={cx("absolute size-3 rounded-full", on ? "end-[3px] top-[3px] bg-accent-fg" : "start-[2px] top-[2px] bg-muted")} />
      </span>
    </button>
  );
}

/** Segmented control (bg track, 3px padding, selected = surface-2 + 600). */
export function Seg<T extends string>({ value, options, onChange, h = 24, label, big }: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void; h?: number; label: string; big?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("grid gap-0.5 border border-line bg-bg p-[3px]", big ? "rounded-[10px]" : "rounded-[8px]")} style={{ gridTemplateColumns: `repeat(${options.length},minmax(0,1fr))` }}>
      {options.map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)} style={{ height: h }}
          className={cx("flex min-w-0 items-center justify-center gap-[5px] whitespace-nowrap", big ? "rounded-[8px]" : "rounded-[6px]", value === k ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}>{l}</button>
      ))}
    </div>
  );
}

/** Curved · Elbow · Straight with the design's 16×12 path icons. */
export function EdgeSeg({ value, onChange, big }: { value: EdgeShape; onChange: (v: EdgeShape) => void; big?: boolean }) {
  return (
    <Seg label={t("Edges")} value={value} onChange={onChange} h={big ? 40 : 30} big={big}
      options={EDGE_SHAPES.map(([k, l, d]) => [k, <><svg width="16" height="12" aria-hidden className="shrink-0"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>{t(l)}</>])} />
  );
}

/** 26×10 line sample used in "Show links" rows and legends. */
export function LineSample({ color, dash, w = 26, width = 2 }: { color: string; dash?: string; w?: number; width?: number }) {
  return <svg width={w} height="10" aria-hidden className="shrink-0"><path d={`M2 5H${w - 2}`} fill="none" stroke={color} strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" /></svg>;
}

/** Tidy up button (panel: 38px amber-outlined with ⇧T; phone sheet: 52px). */
export function TidyButton({ onClick, big, busy }: { onClick: () => void; big?: boolean; busy?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} title={t("Tidy up (Shift T)")}
      className={cx("flex shrink-0 items-center justify-center gap-2 border border-accent bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] font-semibold hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] disabled:opacity-60", big ? "h-[52px] rounded-[12px]" : "h-[38px] rounded-[10px]")}>
      {!big && <Glyph name="wide" size={16} color="var(--accent)" />}{t("Tidy up")}{!big && <span className="font-mono text-[11px] font-medium text-muted">⇧T</span>}
    </button>
  );
}

export interface TidyStats { moved: number; before: number | null; after: number | null; pinned: number; label?: string }

/** "Tidy up preview · moves 14 cards · 31 → 0 crossings · 2 pinned cards kept   Cancel  Apply" (14b-C). */
export function TidyBanner({ stats, onCancel, onApply, top = 14 }: { stats: TidyStats; onCancel: () => void; onApply: () => void; top?: number }) {
  const parts = [
    stats.label,
    t("moves {n} card|moves {n} cards", { n: stats.moved }),
    stats.before != null && stats.after != null ? t("{before} → {after} crossings", { before: stats.before, after: stats.after }) : null,
    stats.pinned ? t("{n} pinned card kept|{n} pinned cards kept", { n: stats.pinned }) : null,
  ].filter(Boolean);
  return (
    <div role="dialog" aria-label={t("Tidy up preview")} className="absolute left-1/2 z-30 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-3 rounded-[12px] border border-accent bg-surface-2 py-2 ps-3.5 pe-2 text-[13px] shadow-[0_14px_32px_rgba(0,0,0,.4)] fade-in" style={{ top }}>
      <Glyph name="wide" size={16} color="var(--accent)" className="shrink-0" />
      <span className="min-w-0"><b className="font-semibold">{t("Tidy up preview")}</b> <span className="text-muted">· {parts.join(" · ")}</span></span>
      <button type="button" onClick={onCancel} className="flex h-[30px] shrink-0 items-center px-2.5 text-muted hover:text-ink">{t("Cancel")}</button>
      <button type="button" onClick={onApply} autoFocus className="flex h-[30px] shrink-0 items-center rounded-[8px] bg-accent px-3 font-semibold text-accent-fg">{t("Apply")}</button>
    </div>
  );
}

/** Shift+T anywhere outside a text field. */
export function isTidyKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return false;
  return e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "T" || e.key === "t");
}
