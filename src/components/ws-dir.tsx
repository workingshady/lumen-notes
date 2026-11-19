import { digits, fmtRelative, fmtTime, getLangState, isRtl, setLang, t, useLang, type LangPref } from "../lib/i18n";

/**
 * Interface direction (design: Lumen 08 · R2-3E "Arabic UI · RTL shell"), now a thin layer over lib/i18n.ts:
 * the direction follows the interface language (English → LTR, العربية → RTL). Kept for the shell components
 * that already use `tr` / `num` / `useRtl`.
 */
export type UiDir = "auto" | "ltr" | "rtl";
const toDir = (p: LangPref): UiDir => (p === "ar" ? "rtl" : p === "en" ? "ltr" : "auto");

export const resolveDir = (): "ltr" | "rtl" => (isRtl() ? "rtl" : "ltr");
export const getUiDir = (): UiDir => toDir(getLangState().pref);
/** Old direction switch: RTL = Arabic interface, LTR = English, Auto = device language. */
export function setUiDir(p: UiDir) { setLang(p === "rtl" ? "ar" : p === "ltr" ? "en" : "auto"); }
export function applyDir() { /* i18n applies <html dir lang> */ }

export const useUiDir = (): UiDir => toDir(useLang().pref);
/** Resolved direction, reactive. */
export function useRtl() { return useLang().rtl; }

export const arDigits = (s: string) => s.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
/** Translate a shell label (the `rtl` argument is ignored: the language decides). */
export function tr(s: string, _rtl?: boolean) { return t(s); }
/** Numbers in the interface digits (Western by default; Arabic-Indic when chosen in Settings › Appearance). */
export function num(n: number | string, _rtl?: boolean) { return digits(n); }
/** Relative "synced" time in the interface language. */
export function syncedAgo(last: number, _rtl?: boolean) {
  if (!last) return t("Synced");
  const m = Math.floor((Date.now() - last) / 60000);
  return m < 1 ? t("Synced just now") : m < 60 ? t("Synced {ago}", { ago: fmtRelative(last) }) : t("Synced {time}", { time: fmtTime(last) });
}
