// Shared UI for prerequisite graphs (design round 4, 14b Graphs & connections · ConnGraph): used by the learning-path
// Graph (src/views/path-graph.tsx) and the course Skill tree (src/views/roadmap-tree.tsx).
//  · PrereqEdge: curved / elbow / straight edge with arrowhead, optional bundling through the stage gutter, top-down flow
//  · LinkTip: drag feedback on a target (loop refused · already implied asks first · already connected)
//  · DropTag: "Becomes a prerequisite" tag on a valid target (14b-H)
//  · LinkMenu: click a link → change type (needs → after → related), reverse, remove (14b-L / phone 14b-P2)
//  · PrereqDisplayPanel / PrereqDisplaySheet: the Display panel (14b-C) and the phone sheet (14b-P1); options that don't
//    apply to a view are hidden, not disabled. Choices are saved per view (usePrereqDisplay).
import { BaseEdge, type Edge, type EdgeProps } from "@xyflow/react";
import { useEffect, useState, type ReactNode } from "react";
import { arrow, edgePath, LINK_DASH, LINK_LABEL, type EdgeShape, type LinkCheck, type LinkKind } from "../lib/prereq-graph";
import { EdgeSeg, LineSample, Seg, Switch, TidyButton } from "./graph-display";
import { Glyph } from "./Glyph";
import { cx } from "./ui";
import { fmtNum, t, tk } from "../lib/i18n";

// ------------------------------------------------------------------ display state
export type PrereqLayout = "stage" | "top" | "free";
export interface PrereqDisplay {
  layout: PrereqLayout; edges: EdgeShape;
  needs: boolean; after: boolean; related: boolean; added: boolean; implied: boolean;
  group: boolean; bundle: boolean; dim: boolean; keepPinned: boolean; roomy: boolean;
}
export const PREREQ_DISPLAY: PrereqDisplay = { layout: "stage", edges: "curved", needs: true, after: true, related: true, added: true, implied: false, group: true, bundle: false, dim: true, keepPinned: true, roomy: false };
/** Display choices, saved per view in localStorage (`lumen.prereq.display.<view>`). */
export function usePrereqDisplay(view: string) {
  const key = `lumen.prereq.display.${view}`;
  const [d, setD] = useState<PrereqDisplay>(() => { try { const s = localStorage.getItem(key); if (s) return { ...PREREQ_DISPLAY, ...JSON.parse(s) }; } catch { /* private mode */ } return PREREQ_DISPLAY; });
  const set = (p: Partial<PrereqDisplay> | null) => setD((o) => { const n = p ? { ...o, ...p } : PREREQ_DISPLAY; try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* private mode */ } return n; });
  return [d, set] as const;
}

// ------------------------------------------------------------------ edge
export type PrereqEdgeData = { shape: EdgeShape; vertical?: boolean; bundleAt?: number | null; color: string; width?: number; dash?: string; opacity?: number; arrow?: boolean };
export function PrereqEdge({ id, sourceX, sourceY, targetX, targetY, data, interactionWidth }: EdgeProps<Edge<PrereqEdgeData>>) {
  const D = data!;
  const { d, ah } = edgePath(D.shape, sourceX, sourceY, targetX, targetY, { vertical: D.vertical, bundleAt: D.bundleAt });
  return (
    <>
      <BaseEdge id={id} path={d} interactionWidth={interactionWidth ?? 14} style={{ fill: "none", stroke: D.color, strokeWidth: D.width ?? 1.6, strokeDasharray: D.dash, opacity: D.opacity ?? 0.9, strokeLinecap: "round", transition: "opacity .12s" }} />
      {D.arrow !== false && <path d={ah} style={{ fill: D.color, stroke: "none", opacity: D.opacity ?? 0.9, pointerEvents: "none" }} />}
    </>
  );
}
export const prereqEdgeTypes = { prereq: PrereqEdge };

/** Colour / pattern of one link (14b · 1): prerequisites by progress, the other kinds fixed. */
export function linkLook(kind: LinkKind | "added" | "implied", from: "done" | "learning" | "todo" | "locked" | string, toLocked: boolean): { color: string; dash?: string; width: number; arrow: boolean; opacity: number } {
  if (kind === "after") return { color: "var(--muted)", dash: LINK_DASH.after, width: 1.6, arrow: true, opacity: 0.9 };
  if (kind === "related") return { color: "var(--link)", dash: LINK_DASH.related, width: 1.8, arrow: false, opacity: 0.9 };
  if (kind === "added") return { color: "var(--accent)", dash: LINK_DASH.added, width: 1.6, arrow: true, opacity: 0.9 };
  if (kind === "implied") return { color: "var(--muted)", dash: LINK_DASH.implied, width: 1.6, arrow: true, opacity: 0.5 };
  return { color: from === "done" ? "var(--success)" : toLocked ? "var(--muted)" : "var(--info)", width: 1.6, arrow: true, opacity: 0.9 };
}

// ------------------------------------------------------------------ drag feedback
export type DropState = "valid" | "loop" | "implied" | "duplicate" | null;
export const dropState = (c: LinkCheck | null): DropState => (!c || c.kind === "self" ? null : c.kind);
/** Card border while a link is dragged over it (ConnGraph: green valid · red loop · grey duplicate). */
export const dropBorder = (s: DropState) => (s === "valid" ? "2px solid var(--success)" : s === "loop" ? "2px solid var(--danger)" : s === "implied" ? "2px solid var(--warning)" : s === "duplicate" ? "2px solid var(--muted)" : null);
export const dropLineColor = (s: DropState) => (s === "valid" ? "var(--success)" : s === "loop" ? "var(--danger)" : s === "implied" ? "var(--warning)" : s === "duplicate" ? "var(--muted)" : "var(--accent)");
/** "Becomes a prerequisite" (14b-H), above the target card. */
export function DropTag() {
  return <span className="pointer-events-none absolute start-2 top-[-22px] z-10 whitespace-nowrap rounded-[6px] px-2 text-[11px] font-semibold leading-5" style={{ background: "color-mix(in srgb,var(--success) 18%,var(--bg))", color: "var(--success)" }}>{t("Becomes a prerequisite")}</span>;
}

/** Loop (refused) · Already implied (Add anyway / Cancel) · Already connected. */
export function LinkTip({ state, title, body, x, y, onAdd, onCancel }: { state: Exclude<DropState, "valid" | null>; title: string; body: string; x: number; y: number; onAdd?: () => void; onCancel?: () => void }) {
  const [g, c, bd] = state === "loop" ? ["c-danger", "var(--danger)", "var(--danger)"] : state === "implied" ? ["c-warning", "var(--warning)", "var(--warning)"] : ["c-info", "var(--muted)", "var(--border)"];
  return (
    <div role={onAdd ? "alertdialog" : "status"} aria-live="polite" className={cx("absolute z-30 flex max-w-[300px] flex-col gap-1.5 rounded-[10px] bg-surface-2 px-3 py-[9px] text-[12.5px] leading-[18px] shadow-[0_12px_28px_rgba(0,0,0,.4)]", !onAdd && "pointer-events-none")}
      style={{ left: x, top: y, border: `1px solid ${bd}` }}>
      <span className="flex items-center gap-2 font-semibold" style={{ color: c }}><Glyph name={g} size={15} />{title}</span>
      <span dir="auto">{body}</span>
      {onAdd && (
        <span className="mt-0.5 flex gap-2">
          <button autoFocus onClick={onAdd} className="flex h-[26px] items-center rounded-[7px] border border-line px-2.5 hover:bg-bg">{t("Add anyway")}</button>
          <button onClick={onCancel} className="flex h-[26px] items-center px-2.5 text-muted hover:text-ink">{t("Cancel")}</button>
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ link menu
const KIND_LINE: Record<LinkKind, [string, string | undefined]> = { needs: ["var(--info)", undefined], after: ["var(--muted)", "6 5"], related: ["var(--link)", "1.5 5"] };
/** 14b-L (desktop popover, 220px) / 14b-P2 (phone sheet rows). `kind` null = a link that can't be retyped here. */
export function LinkMenu({ from, to, kind, note, onKind, onReverse, onRemove, onClose, x, y, phone }: {
  from: string; to: string; kind: LinkKind | null; note?: string; onKind?: (k: LinkKind) => void; onReverse?: () => void; onRemove?: () => void; onClose: () => void; x: number; y: number; phone?: boolean;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  }, [onClose]);
  const row = (label: string, line: [string, string | undefined], on: boolean, f: (() => void) | undefined, danger?: boolean, first?: boolean) => (
    <button key={label} role="menuitemradio" aria-checked={on} autoFocus={first} disabled={!f} onClick={f}
      className={cx("flex items-center gap-2 rounded-[6px] px-2 text-start disabled:opacity-45", phone ? "h-12 text-[15px]" : "h-[30px]", on ? "bg-bg" : "hover:bg-bg")} style={{ color: danger ? "var(--danger)" : undefined }}>
      <svg width={phone ? 26 : 22} height="10" aria-hidden className="shrink-0"><path d={`M1 5h${phone ? 24 : 20}`} fill="none" stroke={line[0]} strokeWidth="2" strokeDasharray={line[1]} strokeLinecap="round" /></svg>
      <span className="flex-1">{label}</span>{on && <Glyph name="check" size={phone ? 16 : 13} color="var(--accent)" />}
    </button>
  );
  const body = (
    <>
      <span className={cx("px-2 pb-1 pt-1.5 text-muted", phone ? "text-[15px] font-semibold text-ink" : "text-[11px]")} dir="auto">{from}{arrow()}{to}</span>
      {note && <span className={cx("px-2 pb-1 text-muted", phone ? "text-[13px]" : "text-[11px]")} dir="auto">{note}</span>}
      {(["needs", "after", "related"] as LinkKind[]).map((k, i) => row(t(LINK_LABEL[k]), KIND_LINE[k], kind === k, onKind && kind !== null ? () => onKind(k) : undefined, false, i === 0))}
      <div className="mx-1 my-[3px] h-px bg-line" />
      {row(t("Reverse direction"), ["var(--muted)", undefined], false, onReverse)}
      {row(t("Remove link"), ["var(--danger)", undefined], false, onRemove, true)}
    </>
  );
  if (phone) return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div role="menu" aria-label={`${from}${arrow()}${to}`} className="sheet-in fixed inset-x-0 bottom-0 z-50 flex flex-col gap-px rounded-t-[14px] border-t border-line bg-surface px-3 pb-2 safe-b">
        <div className="flex justify-center py-2.5"><span className="h-1 w-9 rounded-full bg-line" /></div>
        {body}
      </div>
    </>
  );
  return (
    <div role="menu" aria-label={`${from}${arrow()}${to}`} className="fade-in absolute z-30 flex w-[220px] flex-col gap-px rounded-[10px] border border-line bg-surface-2 p-1 text-[12.5px] shadow-[0_14px_32px_rgba(0,0,0,.45)]" style={{ left: x, top: y }}>
      {body}
    </div>
  );
}

// ------------------------------------------------------------------ Display panel
export interface LinkCounts { needs: number; after: number; related: number; added?: number; implied: number }
type Opts = { layouts?: PrereqLayout[]; groupLabel?: string; bundleLabel?: string; dimLabel?: string; tidy?: () => void; busy?: boolean; pinned?: boolean };
const LAYOUT_LABEL: Record<PrereqLayout, string> = { stage: tk("By stage"), top: tk("Top-down"), free: tk("Free") };
const LBL = "text-[11px] font-medium text-muted";

/** 14b-C right panel (300px). */
export function PrereqDisplayPanel({ d, set, counts, o, onClose }: { d: PrereqDisplay; set: (p: Partial<PrereqDisplay> | null) => void; counts: LinkCounts; o: Opts; onClose?: () => void }) {
  const rows: [keyof PrereqDisplay, string, string, string | undefined, number | undefined][] = [
    ["needs", t("Prerequisites"), "var(--info)", undefined, counts.needs],
    ["after", t("Recommended"), "var(--muted)", LINK_DASH.after, counts.after],
    ["related", t("Related"), "var(--link)", LINK_DASH.related, counts.related],
    ...(counts.added !== undefined ? [["added", t("Added by you"), "var(--accent)", LINK_DASH.added, counts.added] as [keyof PrereqDisplay, string, string, string | undefined, number]] : []),
    ["implied", t("Implied"), "var(--muted)", LINK_DASH.implied, counts.implied],
  ];
  return (
    <aside aria-label={t("Display")} className="absolute bottom-0 end-0 top-0 z-20 flex w-[300px] flex-col border-s border-line bg-surface text-[13px]">
      <div className="flex h-11 shrink-0 items-center gap-2 px-3.5">
        <span className="flex-1 font-semibold">{t("Display")}</span>
        <button onClick={() => set(null)} className="text-[12px] text-muted hover:text-ink">{t("Reset")}</button>
        {onClose && <button aria-label={t("Close display")} onClick={onClose} className="flex size-6 items-center justify-center text-muted hover:text-ink"><Glyph name="x" size={14} /></button>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 pb-3">
        {o.layouts && o.layouts.length > 1 && (
          <div className="flex flex-col gap-1.5"><span className={LBL}>{t("Layout")}</span>
            <Seg label={t("Layout")} value={d.layout} onChange={(l) => set({ layout: l })} h={26} options={o.layouts.map((l) => [l, t(LAYOUT_LABEL[l])])} /></div>
        )}
        <div className="flex flex-col gap-1.5"><span className={LBL}>{t("Edges")}</span><EdgeSeg value={d.edges} onChange={(e) => set({ edges: e })} /></div>
        <div className="flex flex-col gap-0.5" aria-label={t("Show links")}>
          <span className={cx(LBL, "pb-1")}>{t("Show links")}</span>
          {rows.map(([k, l, c, dash, n]) => (
            <div key={k} className="flex h-8 items-center">
              <Switch on={!!d[k]} onChange={(x) => set({ [k]: x } as Partial<PrereqDisplay>)} label={<><LineSample color={c} dash={dash} /><span className="truncate">{l}</span></>}
                right={<span className="text-[12px] text-muted">{k === "implied" ? (d.implied ? fmtNum(n ?? 0) : t("{n} hidden", { n: n ?? 0 })) : fmtNum(n ?? 0)}</span>} />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-0.5 border-t border-line pt-3">
          <span className={cx(LBL, "pb-1")}>{t("Declutter")}</span>
          <div className="flex h-8 items-center"><Switch label={o.groupLabel ?? t("Group by stage")} on={d.group} onChange={(x) => set({ group: x })} /></div>
          {d.group && <div className="flex h-8 items-center"><Switch label={o.bundleLabel ?? t("Bundle links between stages")} on={d.bundle} onChange={(x) => set({ bundle: x })} /></div>}
          <div className="flex h-8 items-center"><Switch label={o.dimLabel ?? t("Dim cards outside focus")} on={d.dim} onChange={(x) => set({ dim: x })} /></div>
          {o.pinned && <div className="flex h-8 items-center"><Switch label={t("Keep pinned cards")} on={d.keepPinned} onChange={(x) => set({ keepPinned: x })} /></div>}
          <div className="flex h-8 items-center gap-2.5">
            <span className="flex-1">{t("Spacing")}</span>
            <div className="flex gap-0.5 rounded-[7px] border border-line bg-bg p-0.5 text-[12px]">
              {([false, true] as const).map((r) => <button key={String(r)} onClick={() => set({ roomy: r })} aria-pressed={d.roomy === r} className={cx("flex h-[22px] items-center rounded-[5px] px-2", d.roomy === r ? "bg-surface-2 font-semibold" : "text-muted hover:text-ink")}>{r ? t("Roomy") : t("Compact")}</button>)}
            </div>
          </div>
        </div>
      </div>
      {o.tidy && <div className="shrink-0 px-3.5 pb-3.5 [&>button]:w-full"><TidyButton onClick={o.tidy} busy={o.busy} /></div>}
    </aside>
  );
}

/** 14b-P1 phone sheet: edges, link chips, Tidy up. */
export function PrereqDisplaySheet({ d, set, onClose, tidy, more }: { d: PrereqDisplay; set: (p: Partial<PrereqDisplay>) => void; onClose: () => void; tidy?: () => void; more?: ReactNode }) {
  const chip = (k: "needs" | "after" | "related", l: string, c: string) => (
    <button key={k} onClick={() => set({ [k]: !d[k] })} aria-pressed={d[k]} className={cx("flex h-9 items-center rounded-full px-3", !d[k] && "border border-line text-muted")} style={d[k] ? { background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c } : undefined}>{l}</button>
  );
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div role="dialog" aria-label={t("Display")} className="sheet-in fixed inset-x-0 bottom-0 z-40 flex max-h-[85%] flex-col rounded-t-[14px] border-t border-line bg-surface text-[14px]">
        <div className="flex justify-center pt-2.5"><button aria-label={t("Close display")} onClick={onClose} className="h-1 w-9 rounded-full bg-line" /></div>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pb-2 pt-3">
          <span className="text-[16px] font-[650]">{t("Display")}</span>
          <EdgeSeg big value={d.edges} onChange={(e) => set({ edges: e })} />
          <div className="flex flex-wrap gap-2">{chip("needs", t("Prerequisites"), "var(--info)")}{chip("after", t("Recommended"), "var(--info)")}{chip("related", t("Related"), "var(--info)")}</div>
          {tidy && <TidyButton big onClick={() => { onClose(); tidy(); }} />}
          {more}
        </div>
        <div className="flex h-6 shrink-0 items-center justify-center safe-b"><span className="h-1 w-[108px] rounded-full bg-muted opacity-45" /></div>
      </div>
    </>
  );
}
