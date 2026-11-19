/**
 * "Recently opened" (history panel R6-30Q, second tab): the notes this device opened, newest first, with the time.
 * Kept per device in localStorage `lumen.recentOpened` = [{ id, at }] (max 60); recorded whenever the open note changes.
 */
import { useSyncExternalStore } from "react";
import { getUI, subscribeUI } from "./store";

const KEY = "lumen.recentOpened";
const MAX = 60;
export interface Opened { id: string; at: number }

let list: Opened[] = (() => { try { const a = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Opened[]; return Array.isArray(a) ? a.filter((x) => x && typeof x.id === "string" && typeof x.at === "number") : []; } catch { return []; } })();
const subs = new Set<() => void>();
let last: string | null = null;

export function recordOpened(id: string) {
  list = [{ id, at: Date.now() }, ...list.filter((x) => x.id !== id)].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
  subs.forEach((f) => f());
}
export const useRecentOpened = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => list);

// record on every change of the open note (any way it was opened: list, link, palette, back)
subscribeUI(() => { const id = getUI().noteId; if (id && id !== last) { last = id; recordOpened(id); } });
