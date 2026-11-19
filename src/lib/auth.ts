// User accounts, client side (docs/ACCOUNTS.md). Built behind the server switch ACCOUNTS_ENABLED, which is OFF:
// `useAccountsConfig()` then reports {enabled:false} and the UI shows the "coming soon" states only.
//
// A signed-in user holds a session token (`lms_…`) in the same slot as the owner token (`lumen.token`) and gets its
// own local database (account id "u-<user id>", see db.ts), so the owner's notes never mix with a user's.
// Preview of the active screens (no server needed): demo mode + `?accounts=preview` (a small in-memory stand-in for
// the server answers every route, so each control on the active screens does something; nothing is sent).
// `&authScreen=<screen>` opens the signed-out flow on one screen (preview only; used by the design checks).
import { Capacitor } from "@capacitor/core";
import { useEffect, useSyncExternalStore } from "react";
import { API_BASE, ApiError, getToken, setToken, signedIn, forgetAccount, getAccount } from "./api";
import { DEMO } from "./db";
import { t, tk } from "./i18n";

/** UI strings produced here (rendered with t() by the components). */
export const AUTH_TEXT = {
  network: tk("Can't reach the server. Check your connection."),
  previewOnly: tk("Preview only: accounts aren't active yet."),
  weak: tk("Weak"), fair: tk("Fair"), strong: tk("Strong"), tooShort: tk("Too short"),
} as const;
/**
 * Messages the Worker sends (worker/ext/auth.ts, auth-core.ts). Listed with tk() so they have Arabic entries; the UI
 * shows them through t(), unknown ones fall back to English.
 */
export const SERVER_TEXT = [
  tk("Not found"), tk("This isn't available for accounts yet."), tk("You're signed out. Sign in again."), tk("Enter a valid email address."),
  tk("Please accept the terms to create an account."), tk("Wrong email or password."), tk("Too many attempts."),
  tk("Confirm your email first. We can send the link again."), tk("Email isn't set up on this server yet."),
  tk("This link is invalid or was already used."), tk("This link has expired. Ask for a new one."), tk("Your current password is wrong."),
  tk("Add a password first, so you can still sign in."), tk("Type the phrase exactly to confirm."), tk("Some profile fields aren't valid."),
  tk("That email is already used by another account."), tk("That's already your email."), tk("Use at least 10 characters."),
  tk("That password is too long."), tk("Pick a less predictable password."), tk("Google sign-in isn't set up on this server."),
  tk("Lumen app"), // session platform label (deviceInfo)
];

export interface ProviderFlags { google: boolean; email: boolean; magic: boolean }
export interface AccountsConfig { enabled: boolean; providers: ProviderFlags; preview?: boolean }
export interface AuthUser {
  id: string; email: string; emailVerified: boolean; name: string; avatar: string; lang: string; tz: string; createdAt: number;
  hasPassword: boolean; passwordChangedAt: number | null; identities: { provider: string; email: string; linkedAt: number }[];
}
export interface AuthSession { id: string; device: string; platform: string; method: string; createdAt: number; lastSeen: number; current: boolean }
export type MailState = "sent" | "unavailable";

const OFF: AccountsConfig = { enabled: false, providers: { google: false, email: false, magic: false } };

// ------------------------------------------------------------------ preview (demo only, client-side stand-in)
const PREVIEW_KEY = "lumen.accountsPreview";
const PREVIEW_STATE = "lumen.accountsPreviewState";
export const accountsPreview = (() => {
  if (!DEMO) return false;
  try {
    const q = new URLSearchParams(location.search).get("accounts");
    if (q === "preview") sessionStorage.setItem(PREVIEW_KEY, "1");
    if (q === "off") { sessionStorage.removeItem(PREVIEW_KEY); sessionStorage.removeItem(PREVIEW_STATE); }
    return sessionStorage.getItem(PREVIEW_KEY) === "1";
  } catch { return false; }
})();
/** Preview only: `&authScreen=` opens the signed-out flow on that screen. */
export const previewScreen = (() => {
  if (!accountsPreview) return "";
  try { return new URLSearchParams(location.search).get("authScreen") ?? ""; } catch { return ""; }
})();

type PreviewState = { signedIn: boolean; user: AuthUser; sessions: AuthSession[] };
const previewDefault = (): PreviewState => ({
  signedIn: true,
  user: {
    id: "u-preview", email: "amir@nightshift.dev", emailVerified: true, name: "Amir Hakim", avatar: "glyph:owl", lang: "en", tz: "Asia/Kuala_Lumpur",
    createdAt: Date.UTC(2026, 9, 2), hasPassword: true, passwordChangedAt: Date.UTC(2026, 9, 20),
    identities: [{ provider: "google", email: "amir.hakim@gmail.com", linkedAt: Date.UTC(2026, 9, 2) }],
  },
  sessions: [
    { id: "a1a1a1a1a1a1a1a1", device: "Laptop", platform: "Chrome on macOS", method: "google", createdAt: Date.UTC(2026, 10, 1), lastSeen: Date.now(), current: true },
    { id: "b2b2b2b2b2b2b2b2", device: "Pixel 8", platform: "Lumen app", method: "password", createdAt: Date.UTC(2026, 9, 12), lastSeen: Date.now() - 3600_000, current: false },
  ],
});
function previewState(): PreviewState {
  try { const s = sessionStorage.getItem(PREVIEW_STATE); if (s) return JSON.parse(s) as PreviewState; } catch { /* fall through */ }
  return previewDefault();
}
function savePreview(p: PreviewState) { try { sessionStorage.setItem(PREVIEW_STATE, JSON.stringify(p)); } catch { /* private mode */ } }

/** The preview's stand-in for worker/ext/auth.ts: same routes, same answers, state kept in this tab. */
function previewAnswer(path: string, method: string, json: Record<string, unknown> = {}): unknown {
  const p = previewState();
  const save = () => savePreview(p);
  const mail = { ok: true, mail: "sent" };
  if (path === "/auth/me" && method === "GET") return { user: p.user };
  if (path === "/auth/me" && method === "PUT") {
    for (const k of ["name", "avatar", "lang", "tz"] as const) if (typeof json[k] === "string") p.user[k] = json[k] as string;
    save(); return { user: p.user };
  }
  if (path === "/auth/sessions") return { sessions: p.sessions };
  if (path.startsWith("/auth/sessions/") && method === "DELETE") { p.sessions = p.sessions.filter((s) => s.id !== path.slice(15)); save(); return { ok: true }; }
  if (path === "/auth/signout-others") { const n = p.sessions.length - 1; p.sessions = p.sessions.filter((s) => s.current); save(); return { ok: true, ended: n }; }
  if (path === "/auth/signout" || path === "/auth/signout-all") { p.signedIn = false; save(); return { ok: true }; }
  if (path === "/auth/identities/google" && method === "DELETE") {
    if (!p.user.hasPassword) throw new AuthError("Add a password first, so you can still sign in.", 400, {});
    p.user.identities = p.user.identities.filter((i) => i.provider !== "google"); save(); return { user: p.user };
  }
  if (path === "/auth/password") {
    if (String(json.next ?? "").length < 10) throw new AuthError("Use at least 10 characters.", 400, {});
    p.user.hasPassword = true; p.user.passwordChangedAt = Date.now(); p.sessions = p.sessions.filter((s) => s.current); save(); return { ok: true };
  }
  if (path === "/auth/email") return { ...mail, email: String(json.email ?? "").trim().toLowerCase() };
  if (path === "/auth/delete") {
    if (String(json.confirm ?? "").trim().toLowerCase() !== deletePhrase(p.user)) throw new AuthError("Type the phrase exactly to confirm.", 400, {});
    savePreview({ ...previewDefault(), signedIn: false });
    return { ok: true };
  }
  if (path === "/auth/login" || path.endsWith("/confirm") || path === "/auth/exchange" || path === "/auth/reset") {
    p.signedIn = true; save(); return { token: "", user: p.user };
  }
  if (["/auth/register", "/auth/magic", "/auth/forgot", "/auth/verify/resend"].includes(path)) return mail;
  if (path === "/auth/link/renew") return { ...mail, kind: "verify", email: "am••@nightshift.dev" };
  // Google can't run in a preview: answer like the real return when the consent window is closed (27K).
  if (path === "/auth/google/start") return { url: location.pathname + "?auth=google-error&reason=cancelled" };
  throw new AuthError(AUTH_TEXT.previewOnly, 400, {});
}

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
export const isSessionToken = (tok: string | null | undefined) => !!tok && /^lms_[A-Za-z0-9_-]{43}$/.test(tok);
export const hasUserSession = () => (accountsPreview ? previewState().signedIn : isSessionToken(getToken()));
export class AuthError extends ApiError {
  constructor(msg: string, status: number, public data: Record<string, unknown>) { super(msg, status); }
}

/** Auth routes only ever see the user session token (never the owner's passcode token). */
export async function authApi<T>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const method = init.method ?? (init.json !== undefined ? "POST" : "GET");
  if (accountsPreview) {
    await new Promise((r) => setTimeout(r, 250)); // feels like a request (busy states show)
    return previewAnswer(path, method, (init.json ?? {}) as Record<string, unknown>) as T;
  }
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
    if (res.status === 401 && isSessionToken(tok) && path !== "/auth/password" && path !== "/auth/email") endLocalSession();
    throw new AuthError(String(data.error ?? `HTTP ${res.status}`), res.status, data);
  }
  return data as T;
}
/** A readable, translated message for any error from authApi. */
export function authErrorText(e: unknown): string {
  if (e instanceof AuthError) {
    const d = e.data as { retryAfterSec?: number; attemptsLeft?: number };
    if (e.status === 429 && d.retryAfterSec) {
      const s = d.retryAfterSec;
      return t("Too many attempts · try again in {time}", { time: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` });
    }
    if (e.status === 401 && typeof d.attemptsLeft === "number" && e.message === "Wrong email or password.") return t("Wrong email or password · {n} try left|Wrong email or password · {n} tries left", { n: d.attemptsLeft });
    return t(e.message);
  }
  return String((e as Error)?.message ?? e);
}

// ------------------------------------------------------------------ device info, sign-in, sign-out
/** What a session is called in the list (27M): a device name + "browser on system" (or "Lumen app"). */
export function deviceInfo(ua = navigator.userAgent, native = Capacitor.isNativePlatform()) {
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? (/iPad/.test(ua) ? "iPadOS" : "iOS") : /Mac OS X/i.test(ua) ? "macOS" : /Windows/i.test(ua) ? "Windows" : /CrOS/i.test(ua) ? "ChromeOS" : /Linux/i.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  const model = /Android [\d.]+; (?:[a-z]{2}-[a-z]{2}; )?([^;)]+?)(?: Build[^;)]*)?\)/i.exec(ua)?.[1]?.trim();
  const phone = /Android|iPhone/i.test(ua) && !/iPad/.test(ua);
  const device = model && model !== "K" ? model : /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : phone ? "Phone" : "Computer";
  const platform = native ? "Lumen app" : br && os ? `${br} on ${os}` : br || os || "Browser";
  return { device, platform };
}
const USER_KEY = "lumen.authUser";
/** Keep the session on this device; reloads into the user's own local database. */
export function completeSignIn(r: { token: string; user: AuthUser }) {
  if (accountsPreview) { openAccountAfterReload(); return; }
  if (!r.token) return;
  try { localStorage.setItem(USER_KEY, JSON.stringify({ id: r.user.id, name: r.user.name, email: r.user.email })); } catch { /* private mode */ }
  if (!signedIn(r.token, "u-" + r.user.id)) location.reload();
}
/** Preview: after "signing in", open Settings › Account (the profile) like a first visit would. */
function openAccountAfterReload() {
  try {
    localStorage.setItem("lumen.welcomed", "1");
    sessionStorage.setItem("lumen.settingsSection", "account");
    const u = JSON.parse(localStorage.getItem("lumen.ui") ?? "{}") as Record<string, unknown>;
    localStorage.setItem("lumen.ui", JSON.stringify({ ...u, view: "settings" }));
  } catch { /* private mode */ }
  location.href = location.pathname;
}
function endLocalSession() {
  setToken(null);
  forgetAccount(getAccount());
  try { localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
}
/** Sign this device out (the server session ends too). */
export async function signOut() {
  try { await authApi("/auth/signout", { json: {} }); } catch { /* signed out locally anyway */ }
  if (!accountsPreview) endLocalSession();
  try { sessionStorage.setItem("lumen.settingsSection", "account"); } catch { /* ignore */ } // back on Settings › Account
  location.reload();
}
/** "Sign out everywhere" (27M): every other session ends, this one stays. Returns how many ended. */
export async function signOutOthers(): Promise<number> {
  const r = await authApi<{ ended: number }>("/auth/signout-others", { json: {} });
  return r.ended ?? 0;
}
export async function startGoogle(link = false) {
  const { url } = await authApi<{ url: string }>("/auth/google/start", { json: { return: location.pathname, link } });
  location.href = url;
}

// ------------------------------------------------------------------ links that come back to the app (?auth=…)
export type AuthReturn =
  | { kind: "verify" | "magic" | "reset"; token: string }
  | { kind: "google"; code: string }
  | { kind: "google-linked" }
  | { kind: "google-error"; reason: string };
let pending: AuthReturn | null = null;
let emailToken = "";
{
  try {
    const q = new URLSearchParams(location.search);
    const kind = q.get("auth");
    if (kind) {
      if ((kind === "verify" || kind === "magic" || kind === "reset") && q.get("token")) pending = { kind, token: q.get("token")! };
      else if (kind === "email" && q.get("token")) emailToken = q.get("token")!;
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

/**
 * "Change email" link (/?auth=email&token=…): confirmed as soon as the app loads, on any screen and any device.
 * Listeners get the outcome (the profile refreshes; a toast says what happened).
 */
export type EmailChangeResult = { ok: true; email: string } | { ok: false; error: string; expired: boolean };
let emailResult: EmailChangeResult | null = null;
const emailSubs = new Set<(r: EmailChangeResult) => void>();
export const onEmailChange = (f: (r: EmailChangeResult) => void) => { emailSubs.add(f); if (emailResult) f(emailResult); return () => { emailSubs.delete(f); }; };
if (emailToken) {
  setTimeout(() => {
    authApi<{ user: AuthUser }>("/auth/email/confirm", { json: { token: emailToken } })
      .then((r): EmailChangeResult => ({ ok: true, email: r.user.email }))
      .catch((e): EmailChangeResult => ({ ok: false, error: authErrorText(e), expired: e instanceof AuthError && e.data.code === "expired" }))
      .then((r) => { emailResult = r; emailSubs.forEach((f) => f(r)); });
  }, 0);
}

// ------------------------------------------------------------------ password strength (client hint; server enforces ≥ 10)
export type Strength = { score: 0 | 1 | 2 | 3 | 4; level: "" | "short" | "weak" | "fair" | "strong"; label: string; hint: string };
/**
 * 27F meter: four segments, red weak, amber fair, green strong; the hint says how to improve, not just a score.
 * `label` and `hint` are English keys (render with t()).
 */
export function passwordStrength(pw: string): Strength {
  if (!pw) return { score: 0, level: "", label: "", hint: "" };
  if (pw.length < 10) return { score: 1, level: "short", label: AUTH_TEXT.tooShort, hint: tk("use at least 10 characters") };
  const hasLower = /[a-z]/.test(pw), hasUpper = /[A-Z]/.test(pw), hasDigit = /\d/.test(pw), hasSym = /[^A-Za-z0-9\s]/.test(pw);
  const words = pw.trim().split(/\s+/).length;
  const kinds = [hasLower, hasUpper, hasDigit, hasSym].filter(Boolean).length;
  const common = /^(.)\1+$/.test(pw) || /(password|123456|qwerty|letmein|abcdef|111111)/i.test(pw);
  let s = 1;
  if (pw.length >= 12) s++;
  if (kinds >= 3 || words >= 4) s++;
  if ((pw.length >= 16 && kinds >= 2) || (words >= 4 && pw.length >= 20)) s++;
  if (common) s = 1;
  const score = Math.min(4, s) as 1 | 2 | 3 | 4;
  const level = score === 1 ? "weak" : score === 4 ? "strong" : "fair";
  const hint = common ? tk("avoid common words and repeats")
    : score === 4 ? tk("good to go")
    : !hasDigit ? tk("add a number or a longer phrase")
    : !hasSym && !hasUpper ? tk("add a symbol or a longer phrase")
    : tk("use a longer phrase");
  return { score, level, label: level === "weak" ? AUTH_TEXT.weak : level === "fair" ? AUTH_TEXT.fair : AUTH_TEXT.strong, hint };
}
export const timeZones = (): string[] => {
  try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone"); } catch { return ["UTC"]; }
};
/** "GMT+8", "GMT+5:30", "GMT" for a zone right now. */
export function tzOffset(tz: string, at = new Date()): string {
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(at).find((x) => x.type === "timeZoneName")?.value;
    return p ?? "GMT";
  } catch { return "GMT"; }
}
/** Same rule as worker/ext/auth-core.ts deletePhrase (design 27N "delete amir"). */
export function deletePhrase(u: { name: string; email: string }) {
  const first = (u.name ?? "").trim().split(/\s+/)[0]?.toLowerCase().replace(/[^\p{L}\p{N}._-]/gu, "") ?? "";
  return "delete " + (first || (u.email ?? "").split("@")[0].toLowerCase());
}
/**
 * "Open email app" (27G): the web inbox for well-known providers (opens in a new tab), else the system mail app
 * (mailto: with no address opens the default client on desktop and phones).
 */
export function emailAppUrl(email: string): { url: string; web: boolean } {
  const d = (email.split("@")[1] ?? "").toLowerCase();
  const web: Record<string, string> = {
    "gmail.com": "https://mail.google.com/mail/u/0/#inbox", "googlemail.com": "https://mail.google.com/mail/u/0/#inbox",
    "outlook.com": "https://outlook.live.com/mail/0/inbox", "hotmail.com": "https://outlook.live.com/mail/0/inbox", "live.com": "https://outlook.live.com/mail/0/inbox", "msn.com": "https://outlook.live.com/mail/0/inbox",
    "yahoo.com": "https://mail.yahoo.com/", "icloud.com": "https://www.icloud.com/mail", "me.com": "https://www.icloud.com/mail", "mac.com": "https://www.icloud.com/mail",
    "proton.me": "https://mail.proton.me/u/0/inbox", "protonmail.com": "https://mail.proton.me/u/0/inbox", "aol.com": "https://mail.aol.com/", "zoho.com": "https://mail.zoho.com/",
    "gmx.com": "https://www.gmx.com/", "gmx.de": "https://www.gmx.net/", "yandex.com": "https://mail.yandex.com/", "fastmail.com": "https://app.fastmail.com/",
  };
  return web[d] ? { url: web[d], web: true } : { url: "mailto:", web: false };
}
