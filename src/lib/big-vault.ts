// Big vaults (design 20b, A15: 700+ notes). Shared numbers + hooks for the progressive states:
//  - note list: pages of LIST_PAGE rows, "Showing 200 of 738" + "Show 200 more" (NoteList.tsx)
//  - search index: "Indexing 512 / 738" while lib/search.ts indexes in the background
//  - graph: `useGraphProgress` / `graphProgressive` for GraphView (owned by the graph area): draw the most
//    connected notes first and say so, then load the rest on demand.
import { useSyncExternalStore } from "react";
import { indexStatus, onIndexStatus, type IndexStatus } from "./search";
import { t } from "./i18n";

/** A vault this size gets the progressive states. */
export const BIG_VAULT = 700;
/** Note list page size. */
export const LIST_PAGE = 200;
/** Graph: nodes drawn at first in a big vault (the most connected ones). */
export const GRAPH_FIRST = 300;

export const useIndexStatus = (): IndexStatus => useSyncExternalStore(onIndexStatus, indexStatus, indexStatus);

/** "Indexing 512 / 738" while the search index catches up (null when it is idle or the vault is small enough to be instant). */
export function indexLabel(s: IndexStatus): string | null {
  return s.running && s.total - s.done > 20 ? t("Indexing {done} / {total}", { done: s.done, total: s.total }) : null;
}

export interface GraphProgress {
  /** True when only part of the graph is drawn. */
  progressive: boolean;
  shown: number;
  total: number;
  /** Hint for the graph toolbar, e.g. "Showing the 300 most linked of 738 notes". */
  label: string | null;
  /** Ids to draw (most connected first, capped unless `all`). */
  ids: string[];
}

/**
 * Which graph nodes to draw. `degree` = links per note id. In a big vault only the GRAPH_FIRST most connected
 * notes are drawn until the user asks for all (`all = true`). Ties keep the input order.
 */
export function graphProgressive(ids: string[], degree: (id: string) => number, all = false, first = GRAPH_FIRST): GraphProgress {
  const total = ids.length;
  if (all || total < BIG_VAULT || total <= first) return { progressive: false, shown: total, total, label: null, ids };
  const pick = ids.map((id, i) => ({ id, i, d: degree(id) })).sort((a, b) => b.d - a.d || a.i - b.i).slice(0, first).map((x) => x.id);
  return { progressive: true, shown: pick.length, total, label: t("Showing the {shown} most linked of {total} notes", { shown: pick.length, total }), ids: pick };
}

/** Hook form for GraphView: index status + the progressive pick. */
export function useGraphProgress(ids: string[], degree: (id: string) => number, all = false) {
  const s = useIndexStatus();
  return { ...graphProgressive(ids, degree, all), indexing: indexLabel(s) };
}
