// Shared bits of the plan views (design round 8: PlanViews.dc.html / CourseTimeline.dc.html).
// The design's short tokens (--sf --sf2 --bd --tx --mu --ac --af --ln --ok --wa --da --le) are aliased onto the app's
// theme variables on each plan root, so the markup converts 1:1 and follows Lamplight / Paper.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { patch } from "../../lib/db";
import { updateNote } from "../../lib/actions";
import { useVault } from "../../lib/store";
import { dateOf, type Day, type ItemStatus, type Plan, type PlanItem, type PlanPrefs } from "../../lib/plan-model";
import { bodyWithDates, bodyWithPlanFm, bodyWithStatus, serializePrefs } from "../../lib/plan-sources";
import { fmtDate, t } from "../../lib/i18n";

export const TOKENS = {
  "--sf": "var(--surface)", "--sf2": "var(--surface-2)", "--bd": "var(--border)", "--tx": "var(--text)", "--mu": "var(--muted)",
  "--ac": "var(--accent)", "--af": "var(--accent-fg)", "--ln": "var(--link)", "--ok": "var(--success)", "--wa": "var(--warning)", "--da": "var(--danger)", "--le": "var(--learn)",
} as CSSProperties;
export const AC16 = "color-mix(in srgb,var(--ac) 16%,transparent)";
export const PLAN_CSS = `
.pl-root button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-align: inherit; }
.pl-root .pl-bar { transition: box-shadow .12s var(--ease), filter .12s; cursor: pointer; }
.pl-root .pl-bar:hover { filter: brightness(1.12); }
.pl-root .pl-row:hover { background: color-mix(in srgb, var(--sf2) 60%, transparent) !important; }
.pl-root .pl-drop { outline: 2px dashed var(--ac); outline-offset: -2px; }
.pl-pop { animation: fade .16s var(--ease); }
.pl-sheet { animation: sheet .24s var(--ease); }
@media (prefers-reduced-motion: reduce) { .pl-pop, .pl-sheet { animation: none; } }
`;

/** Short month labels, localized. */
export const monthShort = (m: number) => fmtDate(new Date(Date.UTC(2026, m, 15)), { month: "short", timeZone: "UTC" });
/** "29 Nov" (localized). */
export const fmtDay = (d: Day) => fmtDate(dateOf(d), { day: "numeric", month: "short", timeZone: "UTC" });
/** "Sun 29 Nov". */
export const fmtDow = (d: Day) => fmtDate(dateOf(d), { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
/** "Nov 2026". */
export const fmtMonthYear = (d: Day) => fmtDate(dateOf(d), { month: "short", year: "numeric", timeZone: "UTC" });

/** Width of an element, live. */
export function useWidth<T extends HTMLElement>(initial = 1000) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Close on outside click / Esc. */
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const id = setTimeout(() => addEventListener("mousedown", down));
    addEventListener("keydown", key);
    return () => { clearTimeout(id); removeEventListener("mousedown", down); removeEventListener("keydown", key); };
  }, [open, onClose]);
  return ref;
}

/** Plan writes: item status / dates go to the item's note line; prefs and schedule to the plan's home. */
export function usePlanWrites(plan: Plan) {
  const v = useVault();
  const edit = async (noteId: string, f: (body: string) => string) => {
    const n = v.byId.get(noteId);
    if (!n) return;
    const body = f(n.body);
    if (body !== n.body) await updateNote(n.id, { body });
  };
  const setHome = async (keys: Record<string, string | null>) => {
    if (plan.home.kind === "note") return edit(plan.home.id, (b) => bodyWithPlanFm(b, keys));
    const sp = v.spaceMap.get(plan.home.id);
    if (!sp) return;
    const props = { ...sp.props };
    for (const [k, val] of Object.entries(keys)) { if (val == null || val === "") delete props[k]; else props[k] = val; }
    await patch("space", sp.id, { props });
  };
  return {
    status: (i: PlanItem, s: ItemStatus) => edit(i.noteId, (b) => bodyWithStatus(b, i, s)),
    dates: (i: PlanItem, start: Day | null, end: Day | null) => edit(i.noteId, (b) => bodyWithDates(b, i, start, end)),
    both: (i: PlanItem, s: ItemStatus, start: Day | null, end: Day | null) => edit(i.noteId, (b) => bodyWithDates(bodyWithStatus(b, i, s), i, start, end)),
    prefs: (p: PlanPrefs) => setHome({ lumenplan: serializePrefs(p) }),
    home: setHome,
  };
}
export type PlanWrites = ReturnType<typeof usePlanWrites>;

/** Small chip button used in popovers (Organize, menus). */
export function Opt({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button aria-pressed={on} onClick={onClick} style={{ height: 30, padding: "0 10px", borderRadius: 8, display: "flex", alignItems: "center", fontSize: 12.5, border: `1px solid ${on ? "var(--ac)" : "var(--bd)"}`, background: on ? AC16 : "transparent", fontWeight: on ? 600 : 400, whiteSpace: "nowrap" }}>{children}</button>
  );
}

/** Generic floating menu (the ▾ controls). */
export function MenuPop({ items, onClose, style }: { items: { l: string; on?: boolean; run: () => void }[]; onClose: () => void; style?: CSSProperties }) {
  const ref = useDismiss(true, onClose);
  return (
    <div ref={ref} role="menu" className="pl-pop" style={{ position: "absolute", zIndex: 30, minWidth: 150, padding: 4, borderRadius: 10, background: "var(--sf2)", border: "1px solid var(--bd)", boxShadow: "0 14px 34px rgba(0,0,0,.35)", display: "flex", flexDirection: "column", gap: 1, ...style }}>
      {items.map((x) => (
        <button key={x.l} role="menuitemradio" aria-checked={!!x.on} onClick={() => { x.run(); onClose(); }} style={{ height: 30, padding: "0 10px", borderRadius: 7, fontSize: 12.5, display: "flex", alignItems: "center", gap: 8, fontWeight: x.on ? 600 : 400, background: x.on ? AC16 : "transparent", whiteSpace: "nowrap" }}>{x.l}</button>
      ))}
    </div>
  );
}

/** Status words for the item popover. */
export const statusWords = (): [ItemStatus, string, string][] => [["todo", t("To do"), "var(--mu)"], ["doing", t("In progress"), "var(--ac)"], ["done", t("Done"), "var(--ok)"], ["skipped", t("Skipped"), "var(--bd)"]];
