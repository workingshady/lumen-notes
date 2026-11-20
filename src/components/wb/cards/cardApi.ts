// A card edits its own element through the board's API (kept by Whiteboard via bindWbApi). No API (a shared, read-only
// board) means the card only displays.
import { getBoundApi } from "../../dnd/wb-drop";
import { cardLink, type LumenCard } from "../../../lib/convert/cards";

type El = Record<string, unknown> & { id: string; customData?: Record<string, unknown>; version?: number };
export const canEditBoard = () => !!getBoundApi();

/** Change one element. Bumps the version fields so the board saves and syncs it. */
export function patchEl(id: string, fn: (e: El) => El, undoable = false) {
  const api = getBoundApi();
  if (!api) return;
  const all = api.getSceneElementsIncludingDeleted() as unknown as El[];
  api.updateScene({
    elements: all.map((e) => (e.id === id ? { ...fn(e), version: (e.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() } : e)),
    captureUpdate: undoable ? "IMMEDIATELY" : "EVENTUALLY",
  });
}

/** Merge into the card's data (and re-point the link / resize when asked). */
export function patchCard(id: string, p: Partial<LumenCard>, size?: [number, number], undoable = true) {
  patchEl(id, (e) => {
    const c = { ...((e.customData?.lumenCard as LumenCard | undefined) ?? { kind: "note" }), ...p } as LumenCard;
    return { ...e, customData: { ...e.customData, lumenCard: c }, link: cardLink(c), ...(size ? { width: size[0], height: size[1] } : {}) };
  }, undoable);
}

export function removeEl(id: string) {
  patchEl(id, (e) => ({ ...e, isDeleted: true }), true);
}
