// Dev simulator: network / runtime fault injection. Only active in demo mode (localStorage "lumen.demo" = "1");
// everywhere else every hook is a no-op. Imports nothing from the app so api.ts / sync.ts can use it without cycles.
import { useSyncExternalStore } from "react";

export type NetMode = "local" | "online" | "offline" | "error" | "slow" | "upload-fail" | "unauthorized";
export type AiMode = "real" | "mock" | "quota" | "error";
export type UploadMode = "ok" | "fail" | "too-big";

export interface Faults {
  /** Sync / network behaviour. "local" = the original demo behaviour (no account, status "Local"). */
  net: NetMode;
  /** Records reported as queued while offline / failing (0 = count real dirty records). */
  queued: number;
  /** Delay for "slow" sync and for every API call while slow (ms). */
  slowMs: number;
  ai: AiMode;
  upload: UploadMode;
}

export const SIM_ON = (() => { try { return localStorage.getItem("lumen.demo") === "1"; } catch { return false; } })();
const KEY = "lumen.sim.faults";
export const DEFAULT_FAULTS: Faults = { net: "local", queued: 7, slowMs: 6000, ai: "real", upload: "ok" };

let faults: Faults = (() => {
  if (!SIM_ON) return DEFAULT_FAULTS;
  try { return { ...DEFAULT_FAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return DEFAULT_FAULTS; }
})();
const subs = new Set<() => void>();
export const getFaults = () => faults;
export const useFaults = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => faults);
export const onFaults = (f: () => void) => (subs.add(f), () => void subs.delete(f));

export function setFaults(p: Partial<Faults>) {
  if (!SIM_ON) return;
  const wasOffline = faults.net === "offline";
  faults = { ...faults, ...p };
  try { localStorage.setItem(KEY, JSON.stringify(faults)); } catch { /* ignore */ }
  const isOffline = faults.net === "offline";
  if (wasOffline !== isOffline) dispatchEvent(new Event(isOffline ? "offline" : "online"));
  subs.forEach((f) => f());
}
export const resetFaults = () => setFaults(DEFAULT_FAULTS);

// navigator.onLine follows the simulated network so offline banners/checks elsewhere in the app react too.
if (SIM_ON) {
  try {
    const real = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => (faults.net === "offline" ? false : real?.get ? real.get.call(navigator) : true) });
  } catch { /* read-only in this browser */ }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Result of api fault injection: throw this status/message, return this mock value, or carry on. */
export type ApiFault = { error: string; status: number } | { mock: unknown } | null;

/** Called by api() before every request (demo mode only). */
export async function simApi(path: string, method = "GET"): Promise<ApiFault> {
  if (!SIM_ON) return null;
  const f = faults;
  if (f.net === "slow") await sleep(f.slowMs);
  if (f.net === "offline") return { error: "Failed to fetch (offline, simulated)", status: 0 };
  if (f.net === "unauthorized" && path !== "/login") return { error: "Unauthorized (simulated 401)", status: 401 };
  if (/^\/(ai|transcribe)\b/.test(path)) {
    if (f.ai === "quota") return { error: "AI quota exceeded for today. Try again tomorrow (simulated).", status: 429 };
    if (f.ai === "error") return { error: "AI service error: upstream model timed out (simulated)", status: 502 };
    if (f.ai === "mock") { await sleep(600); return { mock: { text: MOCK_AI } }; }
  }
  if (/^\/att\//.test(path) && method === "PUT") {
    if (f.upload === "fail") return { error: "Upload failed: R2 write error (simulated)", status: 500 };
    if (f.upload === "too-big") return { error: "File too large (simulated 413)", status: 413 };
  }
  if (f.net === "error" && path === "/sync") return { error: "HTTP 500 (simulated sync error)", status: 500 };
  return null;
}

const MOCK_AI = "**Summary (mock AI).** This is canned simulator output: the note explains the key idea, gives one worked example and lists two open questions.\n\n- Key idea in one line\n- Worked example\n- Open questions: why? when not?";

/** Local-file hook (attachments): error to throw when the simulated upload mode rejects a new file. */
export function simLocalFileError(name: string): string | null {
  if (!SIM_ON) return null;
  if (faults.upload === "too-big") return `${name || "file"} is over 100 MB. Upload long videos to YouTube (unlisted) and paste the link. (simulated)`;
  if (faults.upload === "fail") return "Upload failed: storage write error (simulated)";
  return null;
}

export type SimSyncState = { status: "local" | "idle" | "syncing" | "offline" | "error"; last?: number; pending: number; error?: string };
/**
 * Demo-mode replacement for a sync round: never talks to the server, just walks the status machine
 * the chosen network mode would produce. `dirty` = real count of unsynced demo records.
 */
export async function simSync(set: (s: Partial<SimSyncState>) => void, dirty: () => Promise<number>) {
  const f = faults;
  const queued = async () => f.queued || (await dirty());
  switch (f.net) {
    case "local": set({ status: "local", pending: 0, error: undefined }); return;
    case "offline": set({ status: "offline", pending: await queued(), error: undefined }); return;
    case "unauthorized": set({ status: "error", pending: await queued(), error: "Signed out: the server answered 401. Sign in again (simulated)." }); return;
    case "error":
      set({ status: "syncing", error: undefined }); await sleep(900);
      set({ status: "error", pending: await queued(), error: "HTTP 500 (simulated sync error)" }); return;
    case "upload-fail":
      set({ status: "syncing", error: undefined }); await sleep(900);
      set({ status: "error", pending: await queued(), error: "Upload failed: lecture-07-attention.m4a (simulated)" }); return;
    case "slow":
      set({ status: "syncing", error: undefined, pending: await queued() }); await sleep(f.slowMs);
      if (faults.net !== "slow") return;
      set({ status: "idle", last: Date.now(), pending: 0 }); return;
    case "online":
      set({ status: "syncing", error: undefined }); await sleep(400);
      set({ status: "idle", last: Date.now(), pending: 0 }); return;
  }
}

/** True while a scenario is being written (fault hooks stay out of the way). */
export const seeding = { on: false };
