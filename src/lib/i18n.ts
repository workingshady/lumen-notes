import { createElement, Fragment, useSyncExternalStore, type ReactNode } from "react";
import { AR } from "../i18n/ar";
import { setSettings } from "./settings";

/**
 * Interface language (docs/I18N.md).
 * - `t("English source", vars?)`: the English string is the key; catalogs live in `src/i18n/<lang>.ts`.
 * - Interpolation: `{name}` is replaced by `vars.name` (numbers go through `fmtNum`, so they follow the digits setting).
 * - Plurals: write the English forms as `"{n} note|{n} notes"` and pass `{ n }`. A catalog entry can be a string
 *   or an object of CLDR plural categories (`zero one two few many other`), picked with `Intl.PluralRules(lang)`.
 * - Homonyms: add a context after "@@" (`t("Area@@chart")`); English shows the part before "@@".
 * - Missing key → the English source (with the English plural form).
 * - `tx(key, vars)` interpolates React nodes (bold names, links). `tk(key)` only marks a key for the coverage
 *   check (labels kept in module-level constants are translated later with `t(label)`).
 * Settings: `lang` = "auto" | "en" | "ar" (auto follows navigator.language), `digits` = "latn" | "arab".
 * Direction follows the language: `<html dir lang>` is set here.
 */
export type Lang = "en" | "ar";
export type LangPref = "auto" | Lang;
export type Digits = "latn" | "arab";
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Catalog = Record<string, string | PluralForms>;
type Vars = Record<string, string | number | null | undefined>;

const CATALOGS: Record<Lang, Catalog> = { en: {}, ar: AR };
const RTL: Record<Lang, boolean> = { en: false, ar: true };
/** Stored in the `lumen.settings` object (keys `lang`, `digits`) like lib/reading-prefs.ts; settings.ts keeps unknown keys. */
const KEY = "lumen.settings";

interface State { pref: LangPref; digits: Digits }
let state: State = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { lang?: string; digits?: string };
    if (raw.lang) return { pref: raw.lang === "en" || raw.lang === "ar" ? raw.lang : "auto", digits: raw.digits === "arab" ? "arab" : "latn" };
    // Round-2 RTL shell stored only a direction: RTL meant the Arabic shell.
    const dir = localStorage.getItem("lumen.uiDir");
    return { pref: dir === "rtl" ? "ar" : dir === "ltr" ? "en" : "auto", digits: raw.digits === "arab" ? "arab" : "latn" };
  } catch { return { pref: "auto", digits: "latn" }; }
})();
const subs = new Set<() => void>();

const navLang = () => (typeof navigator !== "undefined" ? navigator.language || "" : "");
/** Resolve a preference to a supported language (auto: Arabic when the device language is Arabic). */
export function resolveLang(p: LangPref = state.pref, nav = navLang()): Lang { return p === "auto" ? (/^ar\b/i.test(nav) ? "ar" : "en") : p; }

let lang: Lang = resolveLang();
let snap = { pref: state.pref, lang, digits: state.digits, rtl: RTL[lang] };

function commit() {
  lang = resolveLang();
  snap = { pref: state.pref, lang, digits: state.digits, rtl: RTL[lang] };
  fmtCache.clear();
  applyLang();
  subs.forEach((f) => f());
}
export function setLangPrefs(p: Partial<State>) {
  state = { ...state, ...p };
  try { setSettings({ lang: state.pref, digits: state.digits } as never); localStorage.removeItem("lumen.uiDir"); } catch { /* ignore (tests: no DOM) */ }
  commit();
}
export const setLang = (pref: LangPref) => setLangPrefs({ pref });
export const setDigits = (digits: Digits) => setLangPrefs({ digits });
export const getLang = () => lang;
export const isRtl = () => RTL[lang];
export const getLangState = () => snap;

export function applyLang() {
  if (typeof document === "undefined") return;
  const h = document.documentElement;
  h.lang = lang;
  h.dir = RTL[lang] ? "rtl" : "ltr";
  h.dataset.digits = state.digits;
  try { h.dataset.arFont = (JSON.parse(localStorage.getItem(KEY) ?? "{}") as { arReadFont?: string }).arReadFont === "plex" ? "plex" : "naskh"; } catch { /* no storage */ }
}
if (typeof document !== "undefined") applyLang();
if (typeof window !== "undefined") window.addEventListener("languagechange", () => { if (state.pref === "auto") commit(); });

const subscribe = (f: () => void) => (subs.add(f), () => { subs.delete(f); });
/** Re-render on language / digits change. Returns `{ pref, lang, digits, rtl }`. */
export const useLang = () => useSyncExternalStore(subscribe, () => snap, () => snap);

// ------------------------------------------------------------------ formatting
const fmtCache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat | Intl.PluralRules>();
/** BCP-47 locale for Intl: Arabic always uses the Gregorian calendar and the chosen digits. */
export function locale(l: Lang = lang, d: Digits = state.digits) { return l === "ar" ? `ar-u-ca-gregory-nu-${d}` : d === "arab" ? "en-u-nu-arab" : undefined; }
function cached<T>(k: string, make: () => T): T { let v = fmtCache.get(k) as T | undefined; if (!v) { v = make(); fmtCache.set(k, v as never); } return v; }

/** Number in the interface digits (Western by default, Arabic-Indic when chosen). */
export function fmtNum(n: number, opts?: Intl.NumberFormatOptions) {
  if (!Number.isFinite(n)) return String(n);
  // Grouping from 1,000 up (design: "3,142"), whatever the locale's minimum-grouping rule; pass { useGrouping: false } for ids/years.
  return cached(`n|${lang}|${state.digits}|${JSON.stringify(opts ?? {})}`, () => new Intl.NumberFormat(locale(), { useGrouping: true, ...opts })).format(n);
}
/** Replace ASCII digits in an already-formatted string (times like 1:05, versions) with the interface digits. */
export function digits(s: string | number) { const x = String(s); return state.digits === "arab" ? x.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]) : x; }

/** Date in the interface language (Arabic month names). Default: "19 Nov 2026" style. */
export function fmtDate(d: Date | number | string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return cached(`d|${lang}|${state.digits}|${JSON.stringify(opts)}`, () => new Intl.DateTimeFormat(locale(), opts)).format(date);
}
export const fmtTime = (d: Date | number | string) => fmtDate(d, { hour: "numeric", minute: "2-digit" });

/** "2 minutes ago" / "منذ دقيقتين"; `now` is injectable for tests and the demo clock. */
export function fmtRelative(when: Date | number, now: number = Date.now()) {
  const t = when instanceof Date ? when.getTime() : when;
  const s = Math.round((t - now) / 1000), a = Math.abs(s);
  const rtf = cached(`r|${lang}|${state.digits}`, () => new Intl.RelativeTimeFormat(locale() ?? "en", { numeric: "auto" }));
  if (a < 45) return t <= now ? t_("just now") : rtf.format(0, "second");
  if (a < 60 * 45) return rtf.format(Math.round(s / 60), "minute");
  if (a < 3600 * 22) return rtf.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 26) return rtf.format(Math.round(s / 86400), "day");
  if (a < 86400 * 320) return rtf.format(Math.round(s / (86400 * 30)), "month");
  return rtf.format(Math.round(s / (86400 * 365)), "year");
}

// ------------------------------------------------------------------ translate
const pluralCat = (l: Lang, n: number) => cached(`p|${l}`, () => new Intl.PluralRules(l)).select(n);

function pick(key: string, vars: Vars | undefined, l: Lang): string {
  const entry = CATALOGS[l][key];
  const n = vars ? (typeof vars.n === "number" ? vars.n : typeof vars.count === "number" ? vars.count : null) : null;
  if (entry !== undefined && l !== "en") {
    if (typeof entry === "string") return entry;
    if (n === null) return entry.other;
    const cat = pluralCat(l, n);
    return entry[cat] ?? entry.other;
  }
  // English source: drop a "@@context" disambiguator ("Area@@chart"), then the "one|other" plural pair.
  const at = key.indexOf("@@");
  if (at >= 0) key = key.slice(0, at);
  const bar = key.indexOf("|");
  if (bar < 0) return key;
  const [one, other] = [key.slice(0, bar), key.slice(bar + 1)];
  return n !== null && pluralCat("en", n) === "one" ? one : other;
}
function fill(s: string, vars?: Vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = vars[k];
    return v === undefined || v === null ? m : typeof v === "number" ? fmtNum(v) : v;
  });
}
function t_(key: string, vars?: Vars, l: Lang = lang) { return fill(pick(key, vars, l), vars); }

/** Translate an English source string into the interface language. */
export function t(key: string, vars?: Vars): string { return t_(key, vars); }
/** Translate into a specific language (tests, server-like rendering). */
export const tIn = (l: Lang, key: string, vars?: Vars) => t_(key, vars, l);
/** Mark a key for the coverage check without translating (translate at render with `t(x)`). */
export const tk = <S extends string>(key: S): S => key;
/** Translate with React nodes as values: `tx("Delete {name}?", { name: <b>{title}</b> })`. */
export function tx(key: string, vars: Record<string, ReactNode>): ReactNode {
  const n = typeof vars.n === "number" ? vars.n : typeof vars.count === "number" ? vars.count : undefined;
  const s = pick(key, n === undefined ? undefined : { n }, lang);
  const parts = s.split(/(\{\w+\})/g);
  return createElement(Fragment, null, ...parts.map((p) => {
    const m = /^\{(\w+)\}$/.exec(p);
    if (!m || !(m[1] in vars)) return p;
    const v = vars[m[1]];
    return typeof v === "number" ? fmtNum(v) : v;
  }));
}
/** Catalog access for the coverage test. */
export const catalog = (l: Lang) => CATALOGS[l];
