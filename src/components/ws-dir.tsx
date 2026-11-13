import { useSyncExternalStore } from "react";

/**
 * Interface direction (design: Lumen 08 · R2-3E "Arabic UI · RTL shell").
 * Auto follows the browser language (ar/fa/he/ur → RTL). Stored in localStorage `lumen.uiDir`.
 * The whole shell mirrors with dir="rtl" on <html>; note content keeps its own per-block direction.
 */
export type UiDir = "auto" | "ltr" | "rtl";
const KEY = "lumen.uiDir";
const RTL_LANGS = /^(ar|fa|he|iw|ur|ps|sd|ug|yi|ckb|dv)\b/i;

let pref: UiDir = (() => { try { const v = localStorage.getItem(KEY); return v === "ltr" || v === "rtl" ? v : "auto"; } catch { return "auto"; } })();
const subs = new Set<() => void>();

export const resolveDir = (p: UiDir = pref): "ltr" | "rtl" => (p === "auto" ? (RTL_LANGS.test(typeof navigator !== "undefined" ? navigator.language : "") ? "rtl" : "ltr") : p);
export const getUiDir = () => pref;
export function setUiDir(p: UiDir) {
  pref = p;
  try { p === "auto" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, p); } catch { /* ignore */ }
  applyDir();
  subs.forEach((f) => f());
}
export function applyDir() {
  const d = resolveDir();
  document.documentElement.dir = d;
  document.documentElement.lang = d === "rtl" ? "ar" : "en";
}
if (typeof document !== "undefined") applyDir();
if (typeof window !== "undefined") window.addEventListener("languagechange", () => { if (pref === "auto") { applyDir(); subs.forEach((f) => f()); } });

export const useUiDir = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => pref);
/** Resolved direction ("ltr" | "rtl"), reactive. */
export function useRtl() { useUiDir(); return resolveDir() === "rtl"; }

/** Arabic labels for the shell (shown when the interface is RTL). English is the key. */
const AR: Record<string, string> = {
  Home: "الرئيسية", Inbox: "الوارد", "Daily note": "الملاحظة اليومية", Tasks: "المهام", Calendar: "التقويم", Review: "المراجعة", Graph: "الخريطة",
  Canvases: "اللوحات", Blog: "المدونة", Folders: "المجلدات", Tags: "الوسوم", Trash: "المهملات", Search: "بحث", Notes: "الملاحظات", More: "المزيد",
  Edit: "تحرير", Split: "مقسوم", Read: "قراءة", Focus: "تركيز", Slides: "شرائح", Share: "مشاركة", Shared: "مُشارَك", Published: "منشور", Publish: "نشر",
  Saved: "محفوظ", "Local only": "على هذا الجهاز فقط", "Syncing…": "جارٍ المزامنة…", Offline: "غير متصل", queued: "في الانتظار", "Sync error": "خطأ في المزامنة",
  "tap for details": "اضغط للتفاصيل", "Synced just now": "تمت المزامنة الآن", Synced: "تمت المزامنة", Course: "مقرّر", Project: "مشروع", Area: "مجال", Resource: "مرجع", Archive: "أرشيف",
  "All spaces": "كل المساحات", "All notes": "كل الملاحظات", "New note": "ملاحظة جديدة", "New folder": "مجلد جديد", Settings: "الإعدادات", Pinned: "المثبّتة",
  "Course overview": "نظرة على المقرّر", "Space overview": "نظرة على المساحة", "done": "مكتمل", notes: "ملاحظات", words: "كلمة", min: "د",
};
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export const arDigits = (s: string) => s.replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
/** Translate a shell label when the interface is RTL. */
export function tr(s: string, rtl = resolveDir() === "rtl") { return rtl ? AR[s] ?? s : s; }
/** Numbers in the shell use Arabic-Indic digits in the RTL shell (design R2-3E). */
export function num(n: number | string, rtl = resolveDir() === "rtl") { return rtl ? arDigits(String(n)) : String(n); }
/** Relative "synced" time in the shell language. */
export function syncedAgo(last: number, rtl = resolveDir() === "rtl") {
  if (!last) return rtl ? "تمت المزامنة" : "Synced";
  const m = Math.floor((Date.now() - last) / 60000);
  if (rtl) return m < 1 ? "تمت المزامنة الآن" : m === 2 ? "تمت المزامنة قبل دقيقتين" : m < 60 ? `تمت المزامنة قبل ${arDigits(String(m))} د` : `تمت المزامنة ${arDigits(new Date(last).toLocaleTimeString("ar", { hour: "numeric", minute: "2-digit" }))}`;
  return m < 1 ? "Synced just now" : m < 60 ? `Synced ${m}m ago` : `Synced ${new Date(last).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}
