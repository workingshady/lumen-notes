import { useSyncExternalStore } from "react";

/**
 * Settings › Appearance › Advanced: per-device extras that live outside lib/settings.
 * Applied at startup (imported for side effects by ShareSheet, which loads eagerly) and live on change.
 */
export interface Advanced {
  /** Whole-UI zoom in percent. */
  uiScale: 90 | 100 | 110 | 125;
  reduceMotion: boolean;
  /** User CSS snippet appended to the page. */
  css: string;
  /** Settings › AI › Advanced: keep the last 50 AI calls in localStorage "lumen.aiLog". */
  aiLog?: boolean;
  /** Settings › Appearance › Advanced: simpler graph/canvas drawing (no animation, labels on zoom). Set automatically on slow devices. */
  reduceEffects?: boolean;
}
const KEY = "lumen.advanced";
const DEF: Advanced = { uiScale: 100, reduceMotion: false, css: "" };
let cur: Advanced = (() => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return DEF; } })();
const subs = new Set<() => void>();
export const useAdvanced = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => cur);
export function setAdvanced(p: Partial<Advanced>) {
  cur = { ...cur, ...p };
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* private mode */ }
  applyAdvanced();
  subs.forEach((f) => f());
}

function styleTag(id: string) {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) { el = document.createElement("style"); el.id = id; document.head.appendChild(el); }
  return el;
}
export function applyAdvanced() {
  if (typeof document === "undefined") return;
  const z = cur.uiScale / 100;
  // Zoom the app root and shrink its box by the same factor so full-height layouts still fit the window.
  styleTag("lumen-ui-scale").textContent = z === 1 ? "" : `#root{zoom:${z};width:calc(100% / ${z});height:calc(100% / ${z})}`;
  styleTag("lumen-reduce-motion").textContent = cur.reduceMotion
    ? "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;scroll-behavior:auto!important}"
    : "";
  styleTag("lumen-custom-css").textContent = cur.css;
}
applyAdvanced();
