import { simApi } from "./sim/faults";

// API client. Web build: same origin. Android build: VITE_API_BASE (the deployed Worker).
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
const TOKEN_KEY = "lumen.token";

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t: string | null) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };

/**
 * Which server account this device is signed in to ("main" or an extra one, see worker/accounts.ts).
 * Each account has its own local database (db.ts), so switching accounts reloads the app.
 */
const ACCOUNT_KEY = "lumen.account";
export const getAccount = () => { try { return localStorage.getItem(ACCOUNT_KEY) || "main"; } catch { return "main"; } };
/** Store the token + account from a sign-in; returns true when the page must reload into another account's data. */
export function signedIn(token: string, account = "main", remember = true) {
  const switched = account !== getAccount();
  setToken(token);
  try { account === "main" ? localStorage.removeItem(ACCOUNT_KEY) : localStorage.setItem(ACCOUNT_KEY, account); } catch { /* private mode */ }
  if (remember) rememberAccount(account, token);
  if (switched) setTimeout(() => location.reload(), 300);
  return switched;
}

// ------------------------------------------------------------------ accounts saved on this device
// Switch accounts in one click: each account's sign-in TOKEN (never the passcode) is kept on this device after the
// first sign-in, like "add another account" in mail/chat apps. A token the server rejects (passcode changed) is
// forgotten automatically; "Forget" removes one from this device.
export interface SavedAccount { id: string; token: string; savedAt: number; lastUsed: number }
const SAVED_KEY = "lumen.savedAccounts";
export const ACCOUNT_LABEL: Record<string, string> = { main: "Main", roadmap: "Road-map" };
export const accountLabel = (id: string) => ACCOUNT_LABEL[id] ?? id;
export function savedAccounts(): SavedAccount[] {
  try { return (JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]") as SavedAccount[]).filter((a) => a && a.id && a.token); } catch { return []; }
}
const writeSaved = (list: SavedAccount[]) => { try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); dispatchEvent(new Event("lumen:accounts")); } catch { /* private mode */ } };
export function rememberAccount(id: string, token: string) {
  const now = Date.now();
  const list = savedAccounts().filter((a) => a.id !== id);
  writeSaved([...list, { id, token, savedAt: savedAccounts().find((a) => a.id === id)?.savedAt ?? now, lastUsed: now }]);
}
export function forgetAccount(id: string) { writeSaved(savedAccounts().filter((a) => a.id !== id)); }
/** Open another saved account on this device (reloads into its own local database). */
export function switchAccount(id: string) {
  const a = savedAccounts().find((x) => x.id === id);
  if (!a) return false;
  rememberAccount(id, a.token); // bump lastUsed
  setToken(a.token);
  try { id === "main" ? localStorage.removeItem(ACCOUNT_KEY) : localStorage.setItem(ACCOUNT_KEY, id); } catch { /* private mode */ }
  location.reload();
  return true;
}
// The account already signed in before this feature existed is saved on first load.
{ const t = getToken(); if (t && !savedAccounts().some((a) => a.id === getAccount())) rememberAccount(getAccount(), t); }

export class ApiError extends Error { constructor(msg: string, public status: number) { super(msg); } }

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  // AI usage meter (src/lib/ai-usage.ts) listens to "lumen:ai" after every Workers AI call.
  if (/^\/(ai|transcribe)(\/|$|\?)/.test(path) && path !== "/ai/usage") {
    const ev = (status: number, error?: string) => { try { window.dispatchEvent(new CustomEvent("lumen:ai", { detail: { path, status, error, action: (init.json as { action?: string } | undefined)?.action } })); } catch { /* no window */ } };
    return apiCall<T>(path, init).then((r) => (ev(200), r), (e: unknown) => { ev(e instanceof ApiError ? e.status : 0, (e as Error)?.message); throw e; });
  }
  return apiCall<T>(path, init);
}
async function apiCall<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const sim = await simApi(path, init.method ?? "GET"); // Dev simulator fault injection (no-op outside demo mode)
  if (sim && "mock" in sim) return sim.mock as T;
  if (sim) {
    if (sim.status === 401) setToken(null);
    throw new ApiError(sim.error, sim.status);
  }
  const headers = new Headers(init.headers);
  const tok = getToken();
  // Sign-in requests carry no token: the passcode alone picks the account.
  if (tok && path !== "/login" && path !== "/unlock") headers.set("Authorization", `Bearer ${tok}`);
  let body = init.body;
  if (init.json !== undefined) { headers.set("Content-Type", "application/json"); body = JSON.stringify(init.json); }
  const res = await fetch(API_BASE + "/api" + path, { ...init, headers, body });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && path !== "/login" && path !== "/unlock") { setToken(null); forgetAccount(getAccount()); } // token rejected (passcode changed): forget it here too
    throw new ApiError((data as { error?: string })?.error ?? `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

export async function login(passcode: string, remember = true) {
  const { token, account } = await api<{ token: string; account?: string }>("/login", { method: "POST", json: { passcode } });
  signedIn(token, account, remember);
}

export const aiRun = (action: string, text: string) => api<{ text: string }>("/ai", { method: "POST", json: { action, text } }).then((r) => r.text);
export const attUrl = (id: string) => `${API_BASE}/api/att/${id}`;

export interface Unfurl { title?: string; description?: string; image?: string; site?: string }
const unfurlCache = new Map<string, Promise<Unfurl | null>>();
/** Link-preview metadata (Open Graph) fetched by the Worker; cached in memory and localStorage. */
export function unfurl(url: string): Promise<Unfurl | null> {
  if (!unfurlCache.has(url)) {
    unfurlCache.set(url, (async () => {
      const key = "lumen.unfurl." + url;
      try { const c = localStorage.getItem(key); if (c) return JSON.parse(c) as Unfurl; } catch { /* ignore */ }
      try {
        if (await simApi("/unfurl")) return null; // Dev simulator: offline / signed out
        const tok = getToken();
        if (!tok) { // visitors: only what the owner's device already cached (Lumen 10); /api/unfurl itself needs a sign-in
          const pr = await fetch(`${API_BASE}/api/public/unfurl?url=${encodeURIComponent(url)}`);
          return pr.ok ? ((await pr.json()) as Unfurl) : null;
        }
        const r = await fetch(`${API_BASE}/api/unfurl?url=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${tok}` } });
        if (!r.ok) return null;
        const d = (await r.json()) as Unfurl;
        try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* storage full */ }
        return d;
      } catch { return null; }
    })());
  }
  return unfurlCache.get(url)!;
}

export interface AskSource { n: number; title: string; heading?: string; text: string }
/**
 * "Ask your vault" (worker/ext/ask.ts): question + numbered excerpts → grounded answer. Streams (SSE from Workers AI)
 * and calls `onDelta` with the text so far; falls back to a plain JSON answer. Resolves with the full answer.
 */
export async function aiAsk(question: string, sources: AskSource[], onDelta: (text: string) => void, signal?: AbortSignal): Promise<string> {
  const sim = await simApi("/ai/ask", "POST");
  if (sim && "mock" in sim) {
    // Dev simulator: a canned answer that cites the retrieved excerpts, streamed word by word.
    const cite = (i: number) => (sources[i] ? `[${sources[i].n}]` : "");
    const full = sources.length
      ? `**Mock answer (simulator).** Your notes describe this in ${sources.length} places ${cite(0)}. ${sources[1] ? `Another note adds detail ${cite(1)}${cite(2)}.` : ""}\n\n- First point from your notes ${cite(0)}\n- Second point ${cite(1) || cite(0)}`
      : "Not in your notes.";
    let out = "";
    for (const w of full.split(/(?<=\s)/)) { if (signal?.aborted) break; out += w; onDelta(out); await new Promise((r) => setTimeout(r, 25)); }
    return out;
  }
  if (sim) { if (sim.status === 401) setToken(null); throw new ApiError(sim.error, sim.status); }
  const headers = new Headers({ "Content-Type": "application/json" });
  const tok = getToken();
  if (tok) headers.set("Authorization", `Bearer ${tok}`);
  const res = await fetch(API_BASE + "/api/ai/ask", { method: "POST", headers, body: JSON.stringify({ question, sources }), signal });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    const data = type.includes("json") ? ((await res.json()) as { error?: string }) : { error: await res.text() };
    if (res.status === 401) { setToken(null); forgetAccount(getAccount()); }
    throw new ApiError(data?.error || `HTTP ${res.status}`, res.status);
  }
  if (type.includes("json")) { const t = ((await res.json()) as { text?: string }).text ?? ""; onDelta(t); return t; }
  if (!res.body) { const t = await res.text(); onDelta(t); return t; }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const d = line.slice(5).trim();
      if (!d || d === "[DONE]") continue;
      try {
        const j = JSON.parse(d) as { response?: string; choices?: { delta?: { content?: string } }[] };
        const piece = j.response ?? j.choices?.[0]?.delta?.content ?? "";
        if (piece) { out += piece; onDelta(out); }
      } catch { /* partial / keep-alive line */ }
    }
  }
  return out.trim();
}
