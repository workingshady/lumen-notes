import { ChevronRight, CircleAlert, CloudOff, RefreshCw, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { DEMO } from "../lib/db";
import { go } from "../lib/store";
import { syncNow, useSync, type SyncState } from "../lib/sync";
import { num, syncedAgo, tr, useRtl } from "./ws-dir";
import { cx } from "./ui";

/* Sync indicator states (design: Lumen 12 · R3-6, Lumen Components "sync"):
   same dot + words in the sidebar footer (desktop) and under the title (phone). Only an error is tappable for details. */

// Remember the last /api/sync HTTP status + time for the error details popover.
export const lastSyncHttp: { status: number; at: number; path: string } = { status: 0, at: 0, path: "/api/sync" };
if (typeof window !== "undefined" && !(window as unknown as { __lumenFetchTap?: 1 }).__lumenFetchTap) {
  (window as unknown as { __lumenFetchTap?: 1 }).__lumenFetchTap = 1;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    try {
      const r = await orig(input, init);
      if (url.includes("/api/sync")) Object.assign(lastSyncHttp, { status: r.status, at: Date.now() });
      return r;
    } catch (e) {
      if (url.includes("/api/sync")) Object.assign(lastSyncHttp, { status: 0, at: Date.now() });
      throw e;
    }
  };
}

// Re-render every 30 s so "Synced 2m ago" stays true.
const tick = { n: 0 };
const tsubs = new Set<() => void>();
if (typeof window !== "undefined") {
  const bump = () => { tick.n++; tsubs.forEach((f) => f()); };
  setInterval(bump, 30_000);
  addEventListener("online", bump); addEventListener("offline", bump);
}
const useTick = () => useSyncExternalStore((f) => (tsubs.add(f), () => tsubs.delete(f)), () => tick.n);

// "Saving…" while the editor has an unsaved debounce pending.
let saving = false;
const ssubs = new Set<() => void>();
export function setSaving(v: boolean) { if (v !== saving) { saving = v; ssubs.forEach((f) => f()); } }
export const useSaving = () => useSyncExternalStore((f) => (ssubs.add(f), () => ssubs.delete(f)), () => saving);

export type SyncLook = { dot: React.CSSProperties; text: string; color: string; error: boolean; kind: SyncState["status"] };
export function syncLook(s: SyncState, rtl = false): SyncLook {
  // Demo mode never syncs; show the design's steady state ("Synced 2m ago") so screens compare 1:1.
  if (DEMO && s.status === "local") s = navigator.onLine ? { ...s, status: "idle", last: Date.now() - 2 * 60000 - 5000 } : { ...s, status: "offline", pending: 3 };
  const base = { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 } as React.CSSProperties;
  if (s.status === "local") return { kind: s.status, error: false, color: "var(--muted)", text: tr("Local only", rtl), dot: { ...base, background: "transparent", boxShadow: "0 0 0 1.5px var(--muted) inset" } };
  if (s.status === "syncing") return { kind: s.status, error: false, color: "var(--muted)", text: tr("Syncing…", rtl), dot: { ...base, background: "var(--info)", boxShadow: "0 0 0 3px color-mix(in srgb,var(--info) 25%,transparent)" } };
  if (s.status === "offline") return { kind: s.status, error: false, color: "var(--muted)", text: `${tr("Offline", rtl)}${s.pending ? ` · ${num(s.pending, rtl)} ${tr("queued", rtl)}` : ""}`, dot: { ...base, background: "var(--warning)" } };
  if (s.status === "error") return { kind: s.status, error: true, color: "var(--danger)", text: `${tr("Sync error", rtl)} · ${tr("tap for details", rtl)}`, dot: { ...base, background: "var(--danger)" } };
  return { kind: s.status, error: false, color: "var(--muted)", text: syncedAgo(s.last, rtl), dot: { ...base, background: "var(--success)" } };
}

export function useSyncLook() {
  useTick();
  const rtl = useRtl();
  return syncLook(useSync(), rtl);
}

/** Error → details popover (design: Lumen 12 "Error → details popover"). */
export function SyncErrorPopover({ onClose, className, style }: { onClose: () => void; className?: string; style?: React.CSSProperties }) {
  const s = useSync();
  const code = lastSyncHttp.status || (/401|unauthor|token/i.test(s.error ?? "") ? 401 : 0);
  const msg = code === 401 ? "Cloudflare rejected the passcode token (expired)." : s.error ? `${s.error.replace(/\.?$/, ".")}` : "The server didn't answer.";
  const at = new Date(lastSyncHttp.at || Date.now()).toLocaleTimeString([], { hour12: false });
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={cx("z-50 w-[296px] rounded-[12px] border border-line bg-surface p-[14px] shadow-xl fade-in", className)} style={style} role="dialog" aria-label="Sync error">
        <div className="flex items-center gap-2 font-semibold text-bad"><CircleAlert size={15} />Sync error</div>
        <div className="mt-2 text-[13px] leading-[19px]">{msg} Your {s.pending || "unsynced"} change{s.pending === 1 ? "" : "s"} {s.pending === 1 ? "is" : "are"} safe on this device.</div>
        <div className="mt-2 font-mono text-[11.5px] text-muted">{code || "—"} · {lastSyncHttp.path} · {at}</div>
        <div className="mt-3 flex gap-2">
          {code === 401 && <button className="h-[30px] rounded-[8px] bg-accent px-2.5 text-[13px] font-semibold text-accent-fg" onClick={() => { onClose(); go("settings"); }}>Unlock again</button>}
          <button className="h-[30px] rounded-[8px] border border-line px-2.5 text-[13px] font-medium" onClick={() => { onClose(); void syncNow(); }}>Retry</button>
        </div>
      </div>
    </>
  );
}

/** Sidebar footer status: dot + words (+ spinning refresh while syncing, cloud-off while offline). */
export function SidebarSync() {
  const l = useSyncLook();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-2.5">
      <button title={l.text} onClick={() => (l.error ? setOpen(true) : l.kind === "local" ? go("settings") : void syncNow())} className="flex min-w-0 flex-1 items-center gap-2.5 text-start">
        <span style={l.dot} />
        <span className="truncate text-[12px]" style={{ color: l.color }}>{l.text}</span>
        {l.error && <ChevronRight size={13} className="shrink-0 text-bad rtl:rotate-180" />}
      </button>
      {l.kind === "syncing" && <RefreshCw size={14} className="shrink-0 animate-spin text-muted [animation-duration:1.6s]" />}
      {l.kind === "offline" && <CloudOff size={14} className="shrink-0 text-muted" />}
      {open && <SyncErrorPopover onClose={() => setOpen(false)} className="absolute bottom-[calc(100%+10px)] start-0" />}
    </div>
  );
}

/** Rail: just the dot. */
export function RailSync() {
  const l = useSyncLook();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative mb-2 flex">
      <button title={l.text} aria-label={l.text} onClick={() => (l.error ? setOpen(true) : l.kind === "local" ? go("settings") : void syncNow())} style={l.dot} />
      {open && <SyncErrorPopover onClose={() => setOpen(false)} className="absolute bottom-0 start-6" />}
    </div>
  );
}

/** Phone header sub-line under the title. */
export function PhoneSyncLine({ saving }: { saving?: boolean }) {
  const l = useSyncLook();
  const rtl = useRtl();
  const [open, setOpen] = useState(false);
  if (saving) return <span className="ps-2.5 text-[11.5px] leading-4 text-muted">Saving…</span>;
  const text = l.kind === "idle" ? `${tr("Saved", rtl)} · ${l.text}` : l.text;
  return (
    <span className="relative flex">
      <button onClick={() => l.error && setOpen(true)} className="flex min-w-0 items-center gap-[5px] text-[11.5px] leading-4" style={{ color: l.color, cursor: l.error ? "pointer" : "default" }}>
        <span style={{ ...l.dot, width: 6, height: 6 }} /><span className="truncate">{text}</span>
      </button>
      {open && <SyncErrorPopover onClose={() => setOpen(false)} className="fixed inset-x-4 top-16 w-auto" />}
    </span>
  );
}

/** Desktop note header: "Saved · Synced 2m ago" / "Saved locally · 3 queued". */
export function HeaderSync({ wrap }: { wrap?: boolean }) {
  const l = useSyncLook();
  const s = useSync();
  const rtl = useRtl();
  const saving = useSaving();
  const [open, setOpen] = useState(false);
  const pending = DEMO ? 3 : s.pending;
  const text = saving ? "Saving…" : l.kind === "idle" ? `${tr("Saved", rtl)} · ${l.text}` : l.kind === "offline" ? `Saved locally${pending ? ` · ${pending} queued` : ""}` : l.kind === "local" ? "Saved on this device" : l.kind === "syncing" ? `${tr("Saved", rtl)} · ${tr("Syncing…", rtl)}` : l.text;
  return (
    <span className="relative flex">
      <button onClick={() => l.error && setOpen(true)} className={cx("flex items-center gap-1.5 text-[12px]", wrap ? "max-w-[96px] text-start leading-[14px]" : "whitespace-nowrap")} style={{ color: l.color, cursor: l.error ? "pointer" : "default" }}>
        <span style={{ ...l.dot, width: 7, height: 7, ...(l.kind === "syncing" ? { boxShadow: "0 0 0 2px color-mix(in srgb,var(--info) 25%,transparent)" } : {}) }} />{text}
      </button>
      {open && <SyncErrorPopover onClose={() => setOpen(false)} className="absolute end-0 top-[calc(100%+8px)]" />}
    </span>
  );
}

/** Offline banner (design: 06b · 22E): once per offline session, dismissible. */
let dismissedSession = 0;
export function OfflineBanner() {
  const s = useSync();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [, force] = useState(0);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener("online", on); addEventListener("offline", off);
    return () => { removeEventListener("online", on); removeEventListener("offline", off); };
  }, []);
  const offline = s.status === "offline" || (!online && (DEMO || s.status !== "local"));
  const session = useOfflineSession(offline);
  if (!offline || dismissedSession === session) return null;
  return (
    <div className="flex h-9 shrink-0 items-center gap-2.5 px-4 text-[12.5px]" style={{ background: "color-mix(in srgb,var(--warning) 12%,var(--bg))", borderBottom: "1px solid color-mix(in srgb,var(--warning) 30%,transparent)" }} role="status">
      <CloudOff size={14} className="shrink-0 text-warn" />
      <span className="truncate"><b className="font-semibold">Offline</b> · {(DEMO ? 3 : s.pending) ? `${DEMO ? 3 : s.pending} change${s.pending === 1 ? "" : "s"} queued. ` : ""}Everything is saved on this device and will sync when you're back.</span>
      <span className="flex-1" />
      <button aria-label="Dismiss" className="text-muted hover:text-ink" onClick={() => { dismissedSession = session; force((x) => x + 1); }}><X size={14} /></button>
    </div>
  );
}
let sessionN = 0;
let wasOffline = false;
function useOfflineSession(offline: boolean) {
  if (offline && !wasOffline) sessionN++;
  wasOffline = offline;
  return sessionN;
}
