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
/** Highest history position reached in this session (Forward is possible while idx < top). */
let top = 0;
/** Places by history position, for the long-press Back list (this session only). */
const stack: Loc[] = [];
const subs = new Set<() => void>();
const changed = () => subs.forEach((f) => f());

export function installNavHistory() {
  if (installed || typeof history === "undefined") return;
  installed = true;
  const cur = stateOf(history.state);
  idx = cur?.idx ?? 0;
  const l = locOf(getUI());
  last = keyOf(l);
  stack[idx] = l; top = idx;
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
    stack[idx] = now; stack.length = idx + 1; top = idx;
    lastPush = Date.now();
    changed();
  });
}

/** Restore a place from a history entry without creating a new one. */
export function restoreFrom(state: unknown): boolean {
  const s = stateOf(state);
  if (!s) return false;
  restoring = true;
  try {
    idx = s.idx;
    stack[idx] = s.lumen;
    if (idx > top) top = idx;
    last = keyOf(s.lumen);
    setUI({ ...s.lumen, palette: false, newSpace: false, io: false, history: [], returnTo: null });
  } finally { restoring = false; }
  changed();
  return true;
}

/** Re-add the current place after Back only closed a layer (sheet, mode, keyboard…): the page itself didn't change. */
export function keepPlace() {
  idx += 1;
  const l = locOf(getUI());
  history.pushState({ lumen: l, idx }, "");
  stack[idx] = l; stack.length = idx + 1; top = idx;
  lastPush = Date.now();
  changed();
}

/** Position of the page currently shown (before a popstate is applied): lower idx in the event = Back, higher = Forward. */
export const currentIdx = () => idx;

/** True when there is an earlier in-app page to go back to. */
export const canGoBack = () => (stateOf(history.state)?.idx ?? 0) > 0;

/** True when Forward leads to a later in-app page (after going Back). */
export const canGoForward = () => idx < top;

/** Earlier places, most recent first (long-press Back), with how many steps back each one is. */
export function backList(n = 6): { loc: Loc; steps: number }[] {
  const out: { loc: Loc; steps: number }[] = [];
  for (let i = idx - 1; i >= 0 && out.length < n; i--) if (stack[i]) out.push({ loc: stack[i], steps: idx - i });
  return out;
}
export const goBackSteps = (steps: number) => history.go(-steps);

/** Re-render on history moves (Back / Forward enabled state). */
export const subscribeNav = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const navVersion = () => `${idx}:${top}`;
