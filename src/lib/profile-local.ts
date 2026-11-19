// The local profile's time zone (Settings › Account, 27B: "Name, avatar, language and time zone already exist locally
// and are editable"). Name/avatar live in `lumen.settings` (author/avatar) and the language in i18n; the time zone is
// kept here on this device and becomes the account's time zone when an account is created (register sends it).
import { useSyncExternalStore } from "react";

const KEY = "lumen.timeZone";
const subs = new Set<() => void>();
export const deviceTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };
export function localTimeZone(): string {
  try { return localStorage.getItem(KEY) || deviceTimeZone(); } catch { return deviceTimeZone(); }
}
export function setLocalTimeZone(tz: string) {
  try { localStorage.setItem(KEY, tz); } catch { /* private mode */ }
  subs.forEach((f) => f());
}
export const useLocalTimeZone = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), localTimeZone, localTimeZone);
