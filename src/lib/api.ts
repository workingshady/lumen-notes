import { simApi } from "./sim/faults";

// API client. Web build: same origin. Android build: VITE_API_BASE (the deployed Worker).
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
const TOKEN_KEY = "lumen.token";

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t: string | null) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };

export class ApiError extends Error { constructor(msg: string, public status: number) { super(msg); } }

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const sim = await simApi(path, init.method ?? "GET"); // Dev simulator fault injection (no-op outside demo mode)
  if (sim && "mock" in sim) return sim.mock as T;
  if (sim) {
    if (sim.status === 401) setToken(null);
    throw new ApiError(sim.error, sim.status);
  }
  const headers = new Headers(init.headers);
  const tok = getToken();
  if (tok) headers.set("Authorization", `Bearer ${tok}`);
  let body = init.body;
  if (init.json !== undefined) { headers.set("Content-Type", "application/json"); body = JSON.stringify(init.json); }
  const res = await fetch(API_BASE + "/api" + path, { ...init, headers, body });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && path !== "/login") setToken(null);
    throw new ApiError((data as { error?: string })?.error ?? `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

export async function login(passcode: string) {
  const { token } = await api<{ token: string }>("/login", { method: "POST", json: { passcode } });
  setToken(token);
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
        const r = await fetch(`${API_BASE}/api/unfurl?url=${encodeURIComponent(url)}`);
        if (!r.ok) return null;
        const d = (await r.json()) as Unfurl;
        try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* storage full */ }
        return d;
      } catch { return null; }
    })());
  }
  return unfurlCache.get(url)!;
}
