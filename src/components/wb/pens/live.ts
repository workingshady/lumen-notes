// Live bridge between the open Whiteboard and the W2-A panels: current tool, pen mode, and the board's actions
// (switch tool, open a panel with arguments). Whiteboard fills `live.actions` on mount.
import { useSyncExternalStore } from "react";
import type { WbPanel } from "../hooks";
import type { ToolId } from "../tools";

type State = { tool: ToolId; penMode: boolean; panelArg: Record<string, string>; hw: boolean; hwBusy: boolean; hwDone: number; hwTotal: number; dark: boolean };
let state: State = { tool: "select", penMode: false, panelArg: {}, hw: false, hwBusy: false, hwDone: 0, hwTotal: 0, dark: true };
const subs = new Set<() => void>();
export const getLive = () => state;
export function setLive(p: Partial<State>) {
  if (Object.entries(p).every(([k, v]) => state[k as keyof State] === v)) return;
  state = { ...state, ...p };
  subs.forEach((f) => f());
}
export const useLive = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), getLive);

export const live = {
  activate: (_t: ToolId) => {},
  setPenMode: (_v: boolean) => {},
  openPanel: (_p: WbPanel) => {},
  setHandwriting: (_v: boolean) => {},
  recognise: async () => {},
};
/** Open a whiteboard panel with arguments (e.g. the palette manager on one palette). */
export function openWbPanel(p: WbPanel, arg: Record<string, string> = {}) { setLive({ panelArg: arg }); live.openPanel(p); }
