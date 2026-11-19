// User accounts, client side (docs/ACCOUNTS.md). Built behind the server switch ACCOUNTS_ENABLED, which is OFF:
// `useAccountsConfig()` then reports {enabled:false} and the UI shows the "coming soon" states only.
//
// A signed-in user holds a session token (`lms_…`) in the same slot as the owner token (`lumen.token`) and gets its
// own local database (account id "u-<user id>", see db.ts), so the owner's notes never mix with a user's.
// Preview of the active screens (no server needed): demo mode + `?accounts=preview`.
import { useEffect, useSyncExternalStore } from "react";
import { API_BASE, ApiError, getToken, setToken, signedIn, forgetAccount, getAccount } from "./api";
import { DEMO } from "./db";

export const AUTH_TEXT = {
  network: "Can't reach the server. Check your connection.",
  previewOnly: "Preview only: accounts aren't active yet.",
  weak: "Weak", fair: "Fair", good: "Good", strong: "Strong", tooShort: "Too short",
} as const;

export interface ProviderFlags { google: boolean; email: boolean; magic: boolean }
export interface AccountsConfig { enabled: boolean; providers: ProviderFlags; preview?: boolean }
export interface AuthUser {
  id: string; email: string; emailVerified: boolean; name: string; avatar: string; lang: string; tz: string; createdAt: number;
  hasPassword: boolean; passwordChangedAt: number | null; identities: { provider: string; email: string; linkedAt: number }[];
}
export interface AuthSession { id: string; device: string; platform: string; method: string; createdAt: number; lastSeen: number; current: boolean }

const OFF: AccountsConfig = { enabled: false, providers: { google: false, email: false, magic: false } };

// ------------------------------------------------------------------ preview (demo only, client-side canned data)
const PREVIEW_KEY = "lumen.accountsPreview";
export const accountsPreview = (() => {
  if (!DEMO) return false;
  try {
    const q = new URLSearchParams(location.search).get("accounts");
    if (q === "preview") sessionStorage.setItem(PREVIEW_KEY, "1");
    if (q === "off") sessionStorage.removeItem(PREVIEW_KEY);
    return sessionStorage.getItem(PREVIEW_KEY) === "1";
  } catch { return false; }
})();
const PREVIEW_USER: AuthUser = {
  id: "u-preview", email: "layla@example.com", emailVerified: true, name: "Layla Haddad", avatar: "glyph:owl", lang: "en", tz: "Asia/Dubai",
  createdAt: Date.UTC(2026, 9, 2), hasPassword: true, passwordChangedAt: Date.UTC(2026, 9, 20), identities: [{ provider: "google", email: "layla@example.com", linkedAt: Date.UTC(2026, 9, 2) }],
};
const PREVIEW_SESSIONS: AuthSession[] = [
  { id: "a1", device: "Windows PC · Edge", platform: "windows", method: "google", createdAt: Date.UTC(2026, 10, 1), lastSeen: Date.UTC(2026, 10, 13, 21, 30), current: true },
  { id: "b2", device: "Pixel 8", platform: "android", method: "password", createdAt: Date.UTC(2026, 9, 12), lastSeen: Date.UTC(2026, 10, 12, 8, 5), current: false },
];

// ------------------------------------------------------------------ config (one fetch per page load)
let config: AccountsConfig = accountsPreview ? { enabled: true, providers: { google: true, email: true, magic: true }, preview: true } : OFF;
let loaded = accountsPreview;
const subs = new Set<() => void>();
async function loadConfig() {
  if (loaded) return;
  loaded = true;
  try {
    const r = await fetch(API_BASE + "/api/accounts/config", { headers: { accept: "application/json" } });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return; // older server / offline → off
    const c = (await r.json()) as AccountsConfig;
    config = { enabled: c.enabled === true, providers: { google: !!c.providers?.google, email: !!c.providers?.email, magic: !!c.providers?.magic } };
    subs.forEach((f) => f());
  } catch { /* offline: stays off */ }
}
/** {enabled, providers}. Off until the server says otherwise (and always off when it can't be reached). */
export function useAccountsConfig(): AccountsConfig {
  useEffect(() => { void loadConfig(); }, []);
  return useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => config);
}

// ------------------------------------------------------------------ requests
export const isSessionToken = (t: string | null | undefined) => !!t && /^lms_[A-Za-z0-9_-]{43}$/.test(t);
export const hasUserSession = () => accountsPreview || isSessionToken(getToken());
export class AuthError extends ApiError {
  constructor(msg: string, status: number, public data: Record<string, unknown>) { super(msg, status); }
}

function previewAnswer(path: string, method: string): unknown {
  if (path === "/auth/me") return { user: PREVIEW_USER };
  if (path === "/auth/sessions") return { sessions: PREVIEW_SESSIONS };
  if (method !== "GET" && ["/auth/login", "/auth/register", "/auth/magic", "/auth/forgot", "/auth/verify/resend"].includes(path)) {
    return path === "/auth/login" ? { token: "", user: PREVIEW_USER } : { ok: true, mail: "sent" };
  }
  throw new AuthError(AUTH_TEXT.previewOnly, 400, {});
}

/** Auth routes only ever see the user session token (never the owner's passcode token). */
export async function authApi<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const method = init.method ?? (init.json !== undefined ? "POST" : "GET");
  if (accountsPreview) return previewAnswer(path, method) as T;
  const headers: Record<string, string> = { accept: "application/json" };
  const tok = getToken();
  if (isSessionToken(tok)) headers.authorization = `Bearer ${tok}`;
  if (init.json !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(API_BASE + "/api" + path, { method, headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined, credentials: "same-origin" });
  } catch { throw new AuthError(AUTH_TEXT.network, 0, {}); }
  const data = (res.headers.get("content-type") ?? "").includes("json") ? ((await res.json()) as Record<string, unknown>) : {};
  if (!res.ok) {
    if (res.status === 401 && isSessionToken(tok) && path !== "/auth/password") endLocalSession();
    throw new AuthError(String(data.error ?? `HTTP ${res.status}`), res.status, data);
  }
  return data as T;
}

// ------------------------------------------------------------------ device info, sign-in, sign-out
export function deviceInfo() {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone" : /Mac OS X/i.test(ua) ? "Mac" : /Windows/i.test(ua) ? "Windows PC" : /Linux|CrOS/i.test(ua) ? "Linux PC" : "Browser";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return { device: br ? `${os} · ${br}` : os, platform: /Android/i.test(ua) ? "android" : /iPhone|iPad/i.test(ua) ? "ios" : /Mac OS X/i.test(ua) ? "mac" : /Windows/i.test(ua) ? "windows" : "web" };
}
const USER_KEY = "lumen.authUser";
/** Keep the session on this device; reloads into the user's own local database. */
export function completeSignIn(r: { token: string; user: AuthUser }) {
  if (accountsPreview || !r.token) return;
  try { localStorage.setItem(USER_KEY, JSON.stringify({ id: r.user.id, name: r.user.name, email: r.user.email })); } catch { /* private mode */ }
  if (!signedIn(r.token, "u-" + r.user.id)) location.reload();
}
function endLocalSession() {
  setToken(null);
  forgetAccount(getAccount());
  try { localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
}
export async function signOut(everywhere = false) {
  try { await authApi(everywhere ? "/auth/signout-all" : "/auth/signout", { json: {} }); } catch { /* signed out locally anyway */ }
  endLocalSession();
  location.reload();
}
export async function startGoogle(link = false) {
  const { url } = await authApi<{ url: string }>("/auth/google/start", { json: { return: location.pathname, link } });
  location.href = url;
}
export async function downloadExport() {
  const tok = getToken();
  const r = await fetch(API_BASE + "/api/auth/export", { headers: isSessionToken(tok) ? { authorization: `Bearer ${tok}` } : {} });
  if (!r.ok) throw new AuthError(AUTH_TEXT.network, r.status, {});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await r.blob());
  a.download = `lumen-account-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ------------------------------------------------------------------ links that come back to the app (?auth=…)
export type AuthReturn =
  | { kind: "verify" | "magic" | "reset"; token: string }
  | { kind: "google"; code: string }
  | { kind: "google-linked" }
  | { kind: "google-error"; reason: string };
let pending: AuthReturn | null = null;
{
  try {
    const q = new URLSearchParams(location.search);
    const kind = q.get("auth");
    if (kind) {
      if ((kind === "verify" || kind === "magic" || kind === "reset") && q.get("token")) pending = { kind, token: q.get("token")! };
      else if (kind === "google" && q.get("code")) pending = { kind, code: q.get("code")! };
      else if (kind === "google-linked") pending = { kind };
      else if (kind === "google-error") pending = { kind, reason: q.get("reason") ?? "provider" };
      for (const k of ["auth", "token", "code", "reason"]) q.delete(k); // one-time secrets leave the address bar at once
      history.replaceState(history.state, "", location.pathname + (q.toString() ? `?${q}` : "") + location.hash);
    }
  } catch { /* no location (tests) */ }
}
/** The pending email-link / Google return, if the page was opened from one (read once). */
export function takeAuthReturn(): AuthReturn | null { const p = pending; pending = null; return p; }
export const peekAuthReturn = () => pending;

// ------------------------------------------------------------------ password strength (client hint; server enforces ≥ 10)
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (pw.length < 10) return { score: pw ? 1 : 0, label: pw ? AUTH_TEXT.tooShort : "" };
  let s = 1;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length >= 14) s++;
  if (kinds >= 3 || pw.split(/\s+/).length >= 3) s++;
  if (pw.length >= 18 && kinds >= 2) s++;
  if (/^(.)\1+$/.test(pw) || /^(password|123456|qwerty)/i.test(pw)) s = 1;
  const score = Math.min(4, s) as 1 | 2 | 3 | 4;
  return { score, label: [AUTH_TEXT.tooShort, AUTH_TEXT.weak, AUTH_TEXT.fair, AUTH_TEXT.good, AUTH_TEXT.strong][score] };
}
export const timeZones = (): string[] => {
  try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone"); } catch { return ["UTC"]; }
};
