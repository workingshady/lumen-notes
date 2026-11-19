// Big-data limits (Lumen 32 · "Big-data limits", Lumen 22 scale rules). Per device, localStorage "lumen.scale".
// Read by the graph ("too big" choice), skill tree (topics per column), folder lists (page size), media tab
// (thumbnails at once) and Read-mode tables (rows before paging / "Open as base").
import { useSyncExternalStore } from "react";

export type GraphDefault = "ask" | "full" | "grouped" | "tree";
export interface ScalePrefs {
  /** Graph: what opens when a graph is above `graphAsk` notes. */
  graphDefault: GraphDefault;
  /** Graph: ask (or use the default view) above this many notes. */
  graphAsk: number;
  /** Skill tree / path stages: topics per column before "+N more". */
  topicsPerColumn: number;
  /** Folder / note lists: rows per "Show N more" page. */
  pageSize: number;
  /** Media tab: thumbnails loaded at once. */
  mediaBatch: number;
  /** Tables in Read mode: rows per page above 300 rows. */
  tableRows: number;
  /** Per-space remembered graph choice (space id → view). */
  graphChoice: Record<string, Exclude<GraphDefault, "ask">>;
}
const KEY = "lumen.scale";
export const SCALE_DEFAULTS: ScalePrefs = { graphDefault: "ask", graphAsk: 300, topicsPerColumn: 12, pageSize: 200, mediaBatch: 12, tableRows: 100, graphChoice: {} };
let cur: ScalePrefs = (() => { try { return { ...SCALE_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return SCALE_DEFAULTS; } })();
const subs = new Set<() => void>();
export const getScale = () => cur;
export const useScale = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => cur);
export function setScale(p: Partial<ScalePrefs>) {
  cur = { ...cur, ...p };
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* private mode */ }
  subs.forEach((f) => f());
}
export const OPTIONS = {
  graphDefault: ["ask", "full", "grouped", "tree"] as GraphDefault[],
  graphAsk: [150, 300, 500, 1000],
  topicsPerColumn: [8, 12, 16, 24],
  pageSize: [100, 200, 500],
  mediaBatch: [6, 12, 24],
  tableRows: [50, 100, 200],
};

/** Tables with more rows than this page in Read mode (Lumen 22: "Over 300 rows"). */
export const TABLE_PAGE_ABOVE = 300;

// ------------------------------------------------------------------ slow device detection (Lumen 22 "Slow or old device")
/** Reduce effects (Settings › Appearance › Advanced): simpler graph/canvas. Auto-on after a slow frame budget, said once. */
export function reduceEffects(): boolean {
  try { return !!(JSON.parse(localStorage.getItem("lumen.advanced") ?? "{}") as { reduceEffects?: boolean }).reduceEffects; } catch { return false; }
}
/** Call with a measured draw time (ms). Over budget twice → switch on Reduce effects and return true the first time. */
let slowHits = 0;
export function reportDrawTime(ms: number): boolean {
  if (reduceEffects() || ms < 120) return false;
  if (++slowHits < 2) return false;
  try {
    if (localStorage.getItem("lumen.slowNotice")) return false;
    localStorage.setItem("lumen.slowNotice", "1");
    const a = JSON.parse(localStorage.getItem("lumen.advanced") ?? "{}");
    localStorage.setItem("lumen.advanced", JSON.stringify({ ...a, reduceEffects: true }));
  } catch { return false; }
  return true;
}
