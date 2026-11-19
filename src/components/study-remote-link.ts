import { useEffect, useRef, useState } from "react";
import { api, API_BASE, getToken } from "../lib/api";
import { t } from "../lib/i18n";

/** What the presenter broadcasts (to the phone remote over a Durable Object, and to an audience window over BroadcastChannel). */
export interface DeckState {
  type: "state";
  noteId: string;
  spaceId: string;
  title: string;
  i: number;
  n: number;
  blank: boolean;
  md: string;
  /** Layout directives in effect on this slide (lib/deck.ts). */
  dirs?: Record<string, string>;
  notes: string;
  next: string;
  /** Presenter device shown on the remote ("laptop", "tablet", "desktop"). */
  device?: string;
  /** The next slide (Markdown + directives) for the remote's "Next" preview; omitted when very long. */
  nextMd?: string;
  nextDirs?: Record<string, string>;
  t0: number;
  pausedAt: number | null;
}
export type DeckCmd = { type: "cmd"; cmd: "next" | "prev" | "goto" | "blank" | "timer" | "timer-reset"; i?: number };

const base = () => API_BASE || location.origin;
export const remoteUrl = (code: string) => `${base()}/remote/${code}`;
export const wsUrl = (code: string, q: string) => `${base().replace(/^http/, "ws")}/api/remote/${code}/ws?${q}`;
export const prettyCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;
export const elapsedOf = (s: Pick<DeckState, "t0" | "pausedAt">, now = Date.now()) => Math.max(0, (s.pausedAt ?? now) - s.t0);
export const clock = (ms: number) => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0"); const ss = String(s % 60).padStart(2, "0"); return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`; };

type Status = "off" | "connecting" | "waiting" | "synced";
const KEY = "lumen.remote.pair";

/** Presenter side of the phone remote: opens a room, keeps a WebSocket to it, pushes state, receives commands. */
export function useRemoteLink(state: DeckState, onCmd: (c: DeckCmd) => void) {
  const [pair, setPair] = useState<{ code: string; key: string } | null>(() => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? "null"); } catch { return null; } });
  const [status, setStatus] = useState<Status>("off");
  const [error, setError] = useState("");
  const ws = useRef<WebSocket | null>(null);
  const stateRef = useRef(state);
  const cmdRef = useRef(onCmd);
  cmdRef.current = onCmd;
  const json = JSON.stringify(state);

  async function open() {
    setError("");
    if (pair) return;
    if (!getToken()) { setError(t("Sign in to sync first: the remote goes through your Cloudflare Worker.")); return; }
    try {
      const r = await api<{ code: string; key: string }>("/remote", { method: "POST" });
      try { sessionStorage.setItem(KEY, JSON.stringify(r)); } catch { /* ignore */ }
      setPair(r);
    } catch (e) { setError((e as Error).message || t("Could not open a remote room")); }
  }
  function stop() {
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    setPair(null);
    setStatus("off");
  }

  useEffect(() => {
    if (!pair) return;
    let closed = false, retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const s = new WebSocket(wsUrl(pair.code, `role=presenter&key=${pair.key}`));
      ws.current = s;
      setStatus("connecting");
      s.onopen = () => { retry = 0; s.send(JSON.stringify(stateRef.current)); setStatus("waiting"); };
      s.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data as string);
          if (m.type === "peers") setStatus(m.remotes > 0 ? "synced" : "waiting");
          else if (m.type === "cmd") cmdRef.current(m as DeckCmd);
        } catch { /* ignore */ }
      };
      s.onclose = (e) => {
        if (closed) return;
        if (e.code === 1008 || retry > 8) { setError(t("The remote room closed.")); stop(); return; }
        setStatus("connecting");
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
      };
    };
    connect();
    const ping = setInterval(() => { if (ws.current?.readyState === 1) ws.current.send('{"type":"ping"}'); }, 25_000);
    return () => { closed = true; clearTimeout(timer); clearInterval(ping); ws.current?.close(1000); ws.current = null; };
  }, [pair]);

  useEffect(() => {
    stateRef.current = state;
    if (ws.current?.readyState === 1) ws.current.send(json);
  }, [json]); // eslint-disable-line react-hooks/exhaustive-deps

  return { pair, status, error, open, stop };
}

/** Draw a QR code for `text` into a data URL (lazy: the encoder only loads when pairing). */
export async function qrDataUrl(text: string) {
  const QR = await import("qrcode");
  return QR.toDataURL(text, { margin: 0, width: 320, errorCorrectionLevel: "M", color: { dark: "#0F1115", light: "#E8E6E1" } });
}
