// Unlock helpers for the home area: server unlock with attempt counter, device-local app lock,
// and fingerprint / face / device-PIN unlock via a WebAuthn platform authenticator.
//
// The device lock is local by design: the WebAuthn credential and its public key live in this browser's
// localStorage, the assertion is verified here (signature + user-verification flag + challenge), and nothing
// is sent to the server. It keeps a casual person out of an unlocked device; it is not server auth.
import { API_BASE, getToken, signedIn } from "./api";
import { Capacitor } from "@capacitor/core";
import { isNativeBiometricAvailable, nativeBiometricVerify } from "./native-biometric";

/** Inside the Android APK the WebView has no WebAuthn platform authenticator, so use the native fingerprint prompt. */
const NATIVE = (() => { try { return Capacitor.isNativePlatform(); } catch { return false; } })();

const LOCK_KEY = "lumen.appLock";
const CRED_KEY = "lumen.webauthn";
const SESSION_KEY = "lumen.unlocked";
const LOCAL_TRIES = "lumen.lockTries";
const OFFERED_KEY = "lumen.webauthnOffered";

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ------------------------------------------------------------------ server unlock (POST /api/unlock)

export type UnlockResult = { ok: true } | { ok: false; error: string; attemptsLeft?: number; retryAfterSec?: number };

export async function unlockWithServer(passcode: string): Promise<UnlockResult> {
  let res: Response;
  try {
    res = await fetch(API_BASE + "/api/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode }) });
  } catch {
    return { ok: false, error: "Can't reach the server · check your connection" };
  }
  const data = (await res.json().catch(() => ({}))) as { token?: string; account?: string; error?: string; attemptsLeft?: number; retryAfterSec?: number };
  if (res.ok && data.token) { signedIn(data.token, data.account); markSessionUnlocked(); return { ok: true }; }
  return { ok: false, error: data.error ?? `HTTP ${res.status}`, attemptsLeft: data.attemptsLeft, retryAfterSec: data.retryAfterSec };
}

// ------------------------------------------------------------------ app lock (this device)

export const appLockEnabled = () => ls.get(LOCK_KEY) === "1";
export function setAppLock(on: boolean) { ls.set(LOCK_KEY, on ? "1" : null); if (on) markSessionUnlocked(); }
export const sessionUnlocked = () => { try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch { return false; } };
export const markSessionUnlocked = () => { try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* ignore */ } };
/** True when the lock screen must show before the workspace. */
export const lockActive = () => appLockEnabled() && !sessionUnlocked() && (hasDeviceCredential() || !!getToken());

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/**
 * Offline passcode check for the app lock: the sync token is HMAC-SHA256(passcode, "lumen:owner:v1"),
 * so a passcode can be verified against the stored token without the network. Misses are rate-limited
 * locally the same way the server does it (5 tries, then 1, 2, 4… minute lockouts).
 */
export async function verifyPasscodeLocally(passcode: string): Promise<UnlockResult> {
  const tok = getToken();
  if (!tok) return { ok: false, error: "Passcode unlock needs sync set up on this device" };
  const st = JSON.parse(ls.get(LOCAL_TRIES) ?? "{}") as { fails?: number; strikes?: number; until?: number };
  const now = Date.now();
  if ((st.until ?? 0) > now) return { ok: false, error: "Too many attempts.", attemptsLeft: 0, retryAfterSec: Math.ceil((st.until! - now) / 1000) };
  const key = await crypto.subtle.importKey("raw", enc.encode(passcode), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mine = hex(await crypto.subtle.sign("HMAC", key, enc.encode("lumen:owner:v1")));
  let diff = mine.length ^ tok.length;
  for (let i = 0; i < Math.min(mine.length, tok.length); i++) diff |= mine.charCodeAt(i) ^ tok.charCodeAt(i);
  if (!diff) { ls.set(LOCAL_TRIES, null); markSessionUnlocked(); return { ok: true }; }
  let fails = (st.fails ?? 0) + 1, strikes = st.strikes ?? 0, until = 0;
  if (fails >= 5) { strikes++; until = now + Math.min(86_400, 60 * 2 ** (strikes - 1)) * 1000; fails = 0; }
  ls.set(LOCAL_TRIES, JSON.stringify({ fails, strikes, until }));
  return until ? { ok: false, error: "Too many attempts.", attemptsLeft: 0, retryAfterSec: Math.ceil((until - now) / 1000) } : { ok: false, error: "Wrong passcode.", attemptsLeft: 5 - fails };
}

// ------------------------------------------------------------------ WebAuthn platform authenticator

type StoredCred = { id: string; alg: number; pk: string; rp: string; native?: true };
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));

function storedCred(): StoredCred | null {
  try { const c = JSON.parse(ls.get(CRED_KEY) ?? "null") as StoredCred | null; return c && c.rp === location.hostname ? c : null; } catch { return null; }
}
export const hasDeviceCredential = () => !!storedCred();
export function forgetDeviceCredential() { ls.set(CRED_KEY, null); }

/** A user-verifying platform authenticator exists (fingerprint, face, Windows Hello, device PIN). */
export async function deviceUnlockAvailable(): Promise<boolean> {
  try {
    if (NATIVE) return await isNativeBiometricAvailable();
    if (!window.isSecureContext || typeof PublicKeyCredential === "undefined") return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

/** Ask once per device after the first successful passcode (design note 4). */
export const shouldOfferDeviceUnlock = async () => !hasDeviceCredential() && ls.get(OFFERED_KEY) !== "1" && (await deviceUnlockAvailable());
export const markDeviceUnlockOffered = () => ls.set(OFFERED_KEY, "1");

/** Register a platform credential (fingerprint etc.) for this device. Throws a readable Error on failure. */
export async function enrollDeviceUnlock(displayName: string): Promise<void> {
  if (NATIVE) {
    if (!(await nativeBiometricVerify("Use fingerprint to unlock Lumen"))) throw new Error("Cancelled");
    ls.set(CRED_KEY, JSON.stringify({ id: "native", alg: 0, pk: "", rp: "android", native: true } satisfies StoredCred));
    markDeviceUnlockOffered();
    return;
  }
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: "Lumen", id: location.hostname },
      user: { id: rand(16), name: "lumen-owner", displayName: displayName || "Lumen owner" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged", requireResidentKey: false },
      attestation: "none",
      timeout: 60_000,
    },
  }).catch((e: Error) => { throw new Error(e.name === "NotAllowedError" ? "Cancelled" : e.message); })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Cancelled");
  const r = cred.response as AuthenticatorAttestationResponse;
  const pk = r.getPublicKey?.();
  const alg = r.getPublicKeyAlgorithm?.() ?? -7;
  if (!pk) throw new Error("This browser can't register a device key");
  ls.set(CRED_KEY, JSON.stringify({ id: b64u(cred.rawId), alg, pk: b64u(pk), rp: location.hostname } satisfies StoredCred));
  markDeviceUnlockOffered();
}

/** DER ECDSA signature → raw r||s (WebCrypto wants raw). */
function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  let i = 2;
  const int = () => { i++; const len = der[i++]; let v = der.slice(i, i + len); i += len; while (v.length > 32 && v[0] === 0) v = v.slice(1); const out = new Uint8Array(32); out.set(v, 32 - v.length); return out; };
  const r = int(), s = int();
  const raw = new Uint8Array(64); raw.set(r); raw.set(s, 32);
  return raw;
}

/** Unlock with the device's fingerprint / face / PIN. Verifies the assertion locally. */
export async function unlockWithDevice(): Promise<UnlockResult> {
  const c = storedCred();
  if (!c) return { ok: false, error: "Fingerprint unlock isn't set up on this device" };
  if (c.native) return (await nativeBiometricVerify("Unlock Lumen")) ? { ok: true } : { ok: false, error: "Fingerprint cancelled · use your passcode" };
  const challenge = rand(32);
  let a: PublicKeyCredential | null;
  try {
    a = (await navigator.credentials.get({
      publicKey: { challenge, rpId: c.rp, allowCredentials: [{ type: "public-key", id: unb64u(c.id), transports: ["internal", "hybrid"] }], userVerification: "required", timeout: 60_000 },
    })) as PublicKeyCredential | null;
  } catch (e) {
    return { ok: false, error: (e as Error).name === "NotAllowedError" ? "Fingerprint cancelled · use your passcode" : (e as Error).message };
  }
  if (!a) return { ok: false, error: "Fingerprint cancelled · use your passcode" };
  const r = a.response as AuthenticatorAssertionResponse;
  const auth = new Uint8Array(r.authenticatorData);
  const client = JSON.parse(new TextDecoder().decode(r.clientDataJSON)) as { type: string; challenge: string; origin: string };
  const uv = (auth[32] & 0x04) !== 0; // flags byte: UV
  if (client.type !== "webauthn.get" || client.challenge !== b64u(challenge) || !uv) return { ok: false, error: "Device check failed · use your passcode" };
  const data = new Uint8Array(auth.length + 32);
  data.set(auth); data.set(new Uint8Array(await crypto.subtle.digest("SHA-256", r.clientDataJSON)), auth.length);
  const pk = unb64u(c.pk);
  let ok = false;
  try {
    if (c.alg === -257) {
      const key = await crypto.subtle.importKey("spki", pk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, r.signature, data);
    } else {
      const key = await crypto.subtle.importKey("spki", pk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(new Uint8Array(r.signature)), data);
    }
  } catch { ok = false; }
  if (!ok) return { ok: false, error: "Device check failed · use your passcode" };
  markSessionUnlocked();
  return { ok: true };
}
