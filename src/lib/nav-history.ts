// Browser history ⇄ app navigation.
// Every "place" (view + note + space + folder + filter + tag) is one history entry, so the browser / Android Back and
// Forward buttons, the phone back gesture and the in-app Back arrow all walk the same sequence of pages.
// Transient layers (sheets, palette, drawers, slide/focus modes, the keyboard) are closed by Back first (App.tsx).
import { getUI, setUI, subscribeUI, type UI } from "./store";

export type Loc = Pick<UI, "view" | "noteId" | "spaceId" | "folderId" | "filter" | "tag">;
interface NavState { lumen: Loc; idx: number }

const locOf = (u: UI): Loc => ({ view: u.view, noteId: u.noteId, spaceId: u.spaceId, folderId: u.folderId, filter: u.filter, tag: u.tag });
const keyOf = (l: Loc) => JSON.stringify(l);
const stateOf = (s: unknown): NavState | null => (s && typeof s === "object" && "lumen" in s ? (s as NavState) : null);

let installed = false;
let restoring = false;
let last = "";
let idx = 0;
let lastPush = 0;

export function installNavHistory() {
  if (installed || typeof history === "undefined") return;
  installed = true;
  const cur = stateOf(history.state);
  idx = cur?.idx ?? 0;
  const l = locOf(getUI());
  last = keyOf(l);
  history.replaceState({ ...(history.state ?? {}), lumen: l, idx }, "");
  subscribeUI(() => {
    if (restoring) return;
    const now = locOf(getUI());
    const k = keyOf(now);
    if (k === last) return;
    last = k;
    // several navigation updates in the same tick (e.g. go() then openNote()) collapse into one entry
    if (Date.now() - lastPush < 60) history.replaceState({ lumen: now, idx }, "");
    else { idx += 1; history.pushState({ lumen: now, idx }, ""); }
    lastPush = Date.now();
  });
}

/** Restore a place from a history entry without creating a new one. */
export function restoreFrom(state: unknown): boolean {
  const s = stateOf(state);
  if (!s) return false;
  restoring = true;
  try {
    idx = s.idx;
    last = keyOf(s.lumen);
    setUI({ ...s.lumen, palette: false, newSpace: false, io: false, history: [], returnTo: null });
  } finally { restoring = false; }
  return true;
}

/** Re-add the current place after Back only closed a layer (sheet, mode, keyboard…): the page itself didn't change. */
export function keepPlace() {
  idx += 1;
  history.pushState({ lumen: locOf(getUI()), idx }, "");
  lastPush = Date.now();
}

/** Position of the page currently shown (before a popstate is applied): lower idx in the event = Back, higher = Forward. */
export const currentIdx = () => idx;

/** True when there is an earlier in-app page to go back to. */
export const canGoBack = () => (stateOf(history.state)?.idx ?? 0) > 0;
