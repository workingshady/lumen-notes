// Devices that sync (Settings › Sync › Devices; Worker: worker/ext/access.ts). This device has a random id and a name
// (editable); after each successful sync it reports itself (throttled), so the owner sees every unlocked device and
// when it last synced. A device the owner signed out elsewhere drops its token on its next report.
import { useEffect } from "react";
import { api, forgetAccount, getAccount, getToken, setToken } from "./api";
import { DEMO } from "./db";
import { toast } from "./store";
import { useSync } from "./sync";

const ID_KEY = "lumen.deviceId";
const NAME_KEY = "lumen.deviceName";
const SEEN_KEY = "lumen.deviceSeenAt";
const THROTTLE = 10 * 60_000;

export interface Device { id: string; name: string; platform: string; firstSeen: number; unlockedAt: number; lastSeen: number; expired: boolean; signingOut: boolean }

export function deviceId(): string {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) { id = crypto.randomUUID().replace(/-/g, ""); localStorage.setItem(ID_KEY, id); }
    return id;
  } catch { return "session" + Math.random().toString(36).slice(2, 12); }
}

/** "Windows PC", "Mac", "Android phone", "iPhone", "Linux PC" (+ the app on Android). */
export function guessDeviceName(ua = navigator.userAgent): string {
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Linux|CrOS/i.test(ua)) return "Linux PC";
  return "Browser";
}
export const deviceName = () => { try { return localStorage.getItem(NAME_KEY) || guessDeviceName(); } catch { return guessDeviceName(); } };
export const platformOf = (ua = navigator.userAgent) => (/Android/i.test(ua) ? "android" : /iPhone|iPad/i.test(ua) ? "ios" : /Mac OS X/i.test(ua) ? "mac" : /Windows/i.test(ua) ? "windows" : "web");

/** Report this device now (unless reported in the last 10 minutes, or `force`). */
export async function reportDevice(force = false) {
  if (DEMO || !getToken()) return;
  try { if (!force && Date.now() - Number(localStorage.getItem(SEEN_KEY) || 0) < THROTTLE) return; } catch { /* ignore */ }
  try {
    const r = await api<{ revoked: boolean }>("/access/seen", { method: "POST", json: { id: deviceId(), name: deviceName(), platform: platformOf() } });
    try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* ignore */ }
    if (r.revoked) {
      setToken(null);
      forgetAccount(getAccount());
      toast("This device was signed out from another device. Unlock again to sync.");
    }
  } catch { /* offline or older server: try again after the next sync */ }
}

export const listDevices = () => api<{ devices: Device[] }>("/access/devices").then((r) => r.devices);
export async function renameDevice(id: string, name: string) {
  if (id === deviceId()) try { localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ }
  await api("/access/devices/" + id, { method: "PUT", json: { name } });
}
export const signOutDevice = (id: string) => api("/access/devices/" + id + "/sign-out", { method: "POST" });
export const removeDevice = (id: string) => api("/access/devices/" + id, { method: "DELETE" });

/** App-level hook: report after each successful sync (throttled). */
export function useDeviceHeartbeat() {
  const s = useSync();
  useEffect(() => { if (s.status === "idle" && s.last) void reportDevice(); }, [s.status, s.last]);
}
