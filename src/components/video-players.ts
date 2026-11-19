// Player control layer for video notes (design update 04, D8). No React: ws-embeds.tsx registers every rendered
// player here; timestamp chips, the editor (editor-video.ts) and the dock (video-dock.tsx) drive them.
//  - YouTube: the privacy-first thumbnail loads the no-cookie player only on play (or on a timestamp click), with
//    enablejsapi=1; the IFrame API script (youtube.com/iframe_api) is loaded on demand at that moment. If the script
//    can't load, commands go straight to the iframe over postMessage (the protocol the API itself uses).
//  - Vimeo: Player postMessage API directly (no script).
//  - <video> / <audio>: the element itself.
import { findTimestamps, formatTime, videoClock, type VideoKind } from "../lib/video-notes";
import { icon as wsIcon } from "./ws-icons";

// Lucide bodies not in ws-icons (kept here so that file stays untouched).
const EXTRA: Record<string, string> = {
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
};
const icon = (name: string, size = 16) => (EXTRA[name] ? wsIcon("x", size).replace("></svg>", `>${EXTRA[name]}</svg>`) : wsIcon(name, size));

export interface VideoCtl {
  el: HTMLElement;
  kind: VideoKind;
  /** youtube:ID, vimeo:ID or the media URL: identifies "the same video" across re-renders. */
  key: string;
  /** The rendered root (Preview, dock, blog post) this player belongs to. */
  root: HTMLElement | null;
  loaded(): boolean;
  playing(): boolean;
  time(): number;
  rate(): number;
  /** Length in seconds (0 while unknown). */
  duration(): number;
  /** Seek; loads the player first when it is still a thumbnail. */
  seek(t: number, play?: boolean): void;
  play(): void;
  pause(): void;
  setRate(r: number): void;
  /** Last time it played, was seeked or loaded (ms). */
  active: number;
  /** Snapshot kept fresh while playing, so a re-rendered copy can take over. */
  snap: { t: number; playing: boolean };
  /** Paused by "Pause while typing" (counts as playing when the preview re-renders). */
  held?: boolean;
}

export interface DockHost {
  /** Show player `video` (1-based) of the note in the dock and continue at `t`. Returns false if it can't. */
  take(video: number, t: number, playing: boolean, rate: number): boolean;
  /** The dock's root element (its players count as `video` = the dock's index). */
  root(): HTMLElement | null;
}

const ctls = new Set<VideoCtl>();
const byEl = new WeakMap<HTMLElement, VideoCtl>();
const listeners = new Set<() => void>();
export const videoRegistry = {
  dock: null as DockHost | null,
  /** Set by editor-video.ts while an editor is open: inserts a timestamp / flashcard line for this player. */
  insert: null as ((kind: "timestamp" | "card", ctl: VideoCtl) => void) | null,
};
export const PLAYER_SEL = "figure.vthumb, .vfile, .afile";
export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

export function onVideoChange(f: () => void) { listeners.add(f); return () => void listeners.delete(f); }
const emit = () => listeners.forEach((f) => f());
const touch = (c: VideoCtl) => { c.active = Date.now(); emit(); };

export const ctlFor = (el: Element | null | undefined) => (el ? byEl.get(el as HTMLElement) ?? null : null);
export const rootOf = (el: Element) => el.parentElement?.closest<HTMLElement>("[data-vn-root]") ?? null;

/** 1-based position of a player among the players of its root (the dock says which note player it shows). */
export function indexOf(c: VideoCtl): number {
  const r = c.root;
  if (!r) return 1;
  if (r.dataset.vnDock) return Number(r.dataset.vnDock) || 1;
  return Math.max(1, [...r.querySelectorAll(PLAYER_SEL)].indexOf(c.el) + 1);
}

/** All connected players, most recently used first. */
export function livePlayers(): VideoCtl[] {
  for (const c of ctls) if (!c.el.isConnected && Date.now() - c.active > 30000) ctls.delete(c);
  return [...ctls].filter((c) => c.el.isConnected).sort((a, b) => b.active - a.active);
}
/** The player the editor writes timestamps for: the last one used that is loaded. */
export const currentPlayer = () => livePlayers().find((c) => c.loaded() && c.active > 0) ?? null;

videoClock.now = () => { const c = currentPlayer(); return c ? { seconds: c.time(), video: indexOf(c) } : null; };

// keep snapshots fresh (needed for YouTube / Vimeo, where the time lives in the iframe)
let ticker: ReturnType<typeof setInterval> | undefined;
function tick() {
  let any = false;
  for (const c of ctls) {
    if (!c.el.isConnected) continue;
    const p = c.playing();
    if (p) any = true;
    if (c.loaded()) c.snap = { t: c.time(), playing: p };
  }
  if (any) emit();
  markChips();
}

/**
 * Chip states (20b): the chip of the moment that is playing gets `.vts-on` (ring); chips that target a player the
 * note doesn't have turn grey (`.vts-none`, "No video at this position in the note").
 */
export function markChips(scope: ParentNode = document) {
  const cur = currentPlayer();
  const idx = cur ? indexOf(cur) : 0;
  const t = cur ? cur.time() : -1;
  for (const root of scope.querySelectorAll<HTMLElement>("[data-vn-ts]")) {
    const players = root.querySelectorAll(PLAYER_SEL).length;
    let best: HTMLElement | null = null, bt = -1;
    for (const b of root.querySelectorAll<HTMLElement>("button.vts")) {
      const v = Number(b.dataset.v) || 1, bs = Number(b.dataset.t) || 0;
      const none = v > players && !(videoRegistry.dock?.root() && Number(videoRegistry.dock.root()!.dataset.vnDock) === v);
      b.classList.toggle("vts-none", none);
      b.title = none ? "No video at this position in the note" : `Play from ${b.textContent}${v > 1 ? ` (video ${v})` : ""}`;
      if (cur && v === idx && bs <= t + 0.5 && bs > bt) { best = b; bt = bs; }
    }
    root.querySelectorAll("button.vts.vts-on").forEach((b) => b !== best && b.classList.remove("vts-on"));
    best?.classList.add("vts-on");
  }
}
const startTicker = () => { ticker ??= setInterval(tick, 500); };

/** A re-rendered copy of a player that was in use: hand it to the dock (editor open) or continue in place. */
function adopt(c: VideoCtl) {
  const prev = [...ctls].find((p) => p !== c && p.key === c.key && p.root === c.root && !p.el.isConnected && p.active && (p.snap.playing || Date.now() - p.active < 15000));
  if (!prev) return;
  ctls.delete(prev);
  const { t, playing } = prev.snap;
  const rate = prev.rate();
  const dock = videoRegistry.dock;
  if ((playing || prev.held) && dock && c.root !== dock.root() && dock.take(indexOf(c), t, playing, rate)) { c.el.classList.add("vn-docked"); return; }
  c.held = prev.held;
  if (playing || t > 0) { c.setRate(rate); c.seek(t, playing); }
}

/** The connected copy of a player that was re-rendered (the dock's first, else the most recently used). */
export function twinOf(c: VideoCtl): VideoCtl | null {
  if (c.el.isConnected) return c;
  const dr = videoRegistry.dock?.root();
  const all = livePlayers().filter((x) => x.key === c.key);
  return all.find((x) => x.root === dr) ?? all[0] ?? null;
}

function add(c: VideoCtl) {
  byEl.set(c.el, c);
  ctls.add(c);
  adopt(c);
  decorate(c);
  startTicker();
}

// ------------------------------------------------------------------ YouTube / Vimeo
interface YTPlayer { getDuration(): number; seekTo(t: number, allow: boolean): void; playVideo(): void; pauseVideo(): void; getCurrentTime(): number; getPlayerState(): number; setPlaybackRate(r: number): void; getPlaybackRate(): number }
type YTNs = { Player: new (el: HTMLIFrameElement, o: { events: Record<string, (e: { target: YTPlayer; data?: number }) => void> }) => YTPlayer };
declare global { interface Window { YT?: YTNs; onYouTubeIframeAPIReady?: () => void } }
let ytApi: Promise<YTNs> | null = null;
function loadYT(): Promise<YTNs> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  ytApi ??= new Promise<YTNs>((res, rej) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); res(window.YT!); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => { ytApi = null; rej(new Error("YouTube API unavailable")); };
    document.head.append(s);
    setTimeout(() => rej(new Error("YouTube API timeout")), 8000);
  });
  return ytApi;
}

/** Called from ws-embeds.tsx for every `figure.vthumb`; returns the controller (its `load` replaces the old click). */
export function remoteCtl(fig: HTMLElement, provider: "youtube" | "vimeo", id: string, start: number): VideoCtl & { load(t?: number, play?: boolean): void } {
  let frame: HTMLIFrameElement | null = null;
  let yt: YTPlayer | null = null;
  let ready = false;
  let pending: (() => void)[] = [];
  let playing = false;
  let t0 = start, at = 0; // time estimate: t0 at wall clock `at` (+ elapsed × rate while playing)
  let r = 1;
  let dur = 0;
  const est = () => t0 + (playing && at ? ((Date.now() - at) / 1000) * r : 0);
  const mark = (t: number, p: boolean) => { t0 = t; at = Date.now(); playing = p; };
  const vimeo = provider === "vimeo";
  const post = (msg: unknown) => frame?.contentWindow?.postMessage(JSON.stringify(msg), vimeo ? "https://player.vimeo.com" : "*");
  const ytCmd = (func: string, args: unknown[] = []) => (yt ? (yt as unknown as Record<string, (...a: unknown[]) => void>)[func](...args) : post({ event: "command", func, args, id: 1, channel: "widget" }));
  const whenReady = (f: () => void) => (ready ? f() : pending.push(f));
  const flush = () => { ready = true; const p = pending; pending = []; p.forEach((f) => f()); };

  const onMsg = (e: MessageEvent) => {
    if (!frame || e.source !== frame.contentWindow) return;
    let d: { event?: string; method?: string; value?: unknown; data?: { seconds?: number }; info?: { currentTime?: number; playerState?: number; playbackRate?: number } };
    try { d = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
    if (vimeo) {
      if (d.event === "ready") { ["timeupdate", "play", "pause", "seeked"].forEach((v) => post({ method: "addEventListener", value: v })); flush(); }
      else if (d.event === "timeupdate" && d.data?.seconds != null) { mark(d.data.seconds, true); const du = (d.data as { duration?: number }).duration; if (du) dur = du; }
      else if (d.event === "play") { mark(est(), true); touch(ctl); } else if (d.event === "pause") { mark(est(), false); emit(); }
    } else if (!yt && d.event === "infoDelivery" && d.info) {
      // postMessage fallback (API script blocked): the player streams its state
      if (d.info.playerState != null) playing = d.info.playerState === 1;
      if (d.info.currentTime != null) mark(d.info.currentTime, playing);
      if (d.info.playbackRate) r = d.info.playbackRate;
      const du = (d.info as { duration?: number }).duration; if (du) dur = du;
    } else if (!yt && (d.event === "onReady" || d.event === "initialDelivery")) flush();
  };

  function load(t = t0, play = true) {
    if (frame) { ctl.seek(t, play); return; }
    // already playing in the editor's dock? drive that one instead
    const dock = videoRegistry.dock?.root();
    const twin = dock && ctl.root !== dock ? [...dock.querySelectorAll<HTMLElement>(PLAYER_SEL)].map(ctlFor).find((c) => c?.key === ctl.key && c.loaded()) : null;
    if (twin) { twin.seek(t, play); return; }
    const s = Math.floor(t);
    const origin = encodeURIComponent(location.origin);
    const src = vimeo
      ? `https://player.vimeo.com/video/${id}?autoplay=${play ? 1 : 0}&dnt=1${s ? `#t=${s}s` : ""}`
      : `https://www.youtube-nocookie.com/embed/${id}?autoplay=${play ? 1 : 0}&rel=0&enablejsapi=1&origin=${origin}${s ? `&start=${s}` : ""}`;
    const f = document.createElement("iframe");
    f.src = src; f.title = fig.querySelector(".vt-title")?.textContent || "Video";
    f.allow = "accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen";
    f.allowFullscreen = true;
    frame = f;
    addEventListener("message", onMsg);
    fig.querySelector(".embed")!.replaceChildren(f);
    fig.classList.add("playing");
    fig.classList.remove("vn-docked");
    mark(t, play);
    touch(ctl);
    if (vimeo) return;
    void loadYT().then((YT) => {
      if (!frame?.isConnected) return;
      yt = new YT.Player(f, {
        events: {
          onReady: () => { flush(); if (r !== 1) yt!.setPlaybackRate(r); },
          onStateChange: (e) => { const p = e.data === 1; mark(yt!.getCurrentTime(), p); if (p) touch(ctl); else emit(); },
          onPlaybackRateChange: () => { r = yt!.getPlaybackRate(); emit(); },
        },
      });
    }).catch(() => {
      // no API script: talk to the iframe directly
      f.addEventListener("load", () => { post({ event: "listening", id: 1, channel: "widget" }); setTimeout(flush, 300); });
    });
  }

  const ctl: VideoCtl & { load(t?: number, play?: boolean): void } = {
    el: fig, kind: provider, key: `${provider}:${id}`, root: rootOf(fig), active: 0, snap: { t: start, playing: false },
    load,
    loaded: () => !!frame && frame.isConnected,
    playing: () => (yt && ready ? yt.getPlayerState() === 1 : playing),
    time: () => (yt && ready ? yt.getCurrentTime() : est()),
    rate: () => r,
    duration: () => (yt && ready ? yt.getDuration() || dur : dur),
    seek(t, play = true) {
      if (!frame) { load(t, play); return; }
      mark(t, play);
      touch(ctl);
      whenReady(() => {
        if (vimeo) { post({ method: "setCurrentTime", value: t }); post({ method: play ? "play" : "pause" }); return; }
        ytCmd("seekTo", [t, true]);
        ytCmd(play ? "playVideo" : "pauseVideo");
      });
    },
    play() { if (!frame) { load(t0, true); return; } mark(est(), true); touch(ctl); whenReady(() => (vimeo ? post({ method: "play" }) : ytCmd("playVideo"))); },
    pause() { if (!frame) return; mark(est(), false); emit(); whenReady(() => (vimeo ? post({ method: "pause" }) : ytCmd("pauseVideo"))); },
    setRate(x) { r = x; emit(); if (frame) whenReady(() => (vimeo ? post({ method: "setPlaybackRate", value: x }) : ytCmd("setPlaybackRate", [x]))); },
  };
  add(ctl);
  return ctl;
}

// ------------------------------------------------------------------ <video> / <audio>
export function mediaCtl(el: HTMLElement, m: HTMLMediaElement): VideoCtl {
  const ctl: VideoCtl = {
    el, kind: m instanceof HTMLAudioElement ? "audio" : "file", key: el.dataset.src || m.currentSrc || m.src, root: rootOf(el), active: 0, snap: { t: 0, playing: false },
    loaded: () => true,
    playing: () => !m.paused && !m.ended,
    time: () => m.currentTime,
    rate: () => m.playbackRate,
    duration: () => (isFinite(m.duration) ? m.duration : 0),
    seek(t, play = true) {
      const go = () => { m.currentTime = Math.max(0, t); if (play) void m.play().catch(() => {}); };
      if (m.readyState >= 1) go(); else { m.preload = "auto"; m.addEventListener("loadedmetadata", go, { once: true }); m.load(); }
      touch(ctl);
    },
    play() { void m.play().catch(() => {}); },
    pause() { m.pause(); },
    setRate(r) { m.playbackRate = r; },
  };
  const live = () => m.isConnected;
  m.addEventListener("play", () => { if (live()) { ctl.snap = { t: m.currentTime, playing: true }; touch(ctl); } });
  // a removed <video> pauses itself: keep the snapshot as it was so the re-rendered copy can resume
  m.addEventListener("pause", () => { if (live()) { ctl.snap = { t: m.currentTime, playing: false }; emit(); } });
  m.addEventListener("timeupdate", () => { if (live()) ctl.snap = { t: m.currentTime, playing: !m.paused }; });
  m.addEventListener("ratechange", () => { el.querySelectorAll<HTMLElement>(".mb-speed").forEach((b) => (b.textContent = `${m.playbackRate}×`)); emit(); });
  add(ctl);
  return ctl;
}

// ------------------------------------------------------------------ extras row under each player
/** Speed (0.75–2×) for every Lumen player; "Timestamp" and "Flashcard at this moment" while an editor is open. */
function decorate(c: VideoCtl) {
  if (c.el.nextElementSibling?.classList.contains("vn-extras") || c.el.querySelector(".vn-extras")) return;
  const row = document.createElement("div");
  row.className = "vn-extras";
  row.innerHTML = (c.kind === "audio" ? "" : `<button type="button" class="vn-rate" title="Playback speed">${icon("gauge", 13)}<span>1×</span></button>`)
    + `<button type="button" class="vn-ed vn-ts" title="Insert a timestamp at the caret (Alt+T)">${icon("clock", 13)}<span>Timestamp</span></button>`
    + `<button type="button" class="vn-ed vn-card" title="Make a flashcard at this moment">${icon("layers", 13)}<span>Flashcard at this moment</span></button>`;
  const rate = row.querySelector<HTMLElement>(".vn-rate");
  let off = () => {};
  const showRate = () => { if (!c.el.isConnected && Date.now() - c.active > 2000) { off(); return; } if (rate) rate.querySelector("span")!.textContent = `${c.rate()}×`; };
  rate?.addEventListener("click", (e) => { e.stopPropagation(); const i = RATES.indexOf(c.rate()); c.setRate(RATES[(i + 1) % RATES.length]); showRate(); });
  off = onVideoChange(showRate); // dropped once the player is gone (the preview re-renders while you type)
  const ins = (k: "timestamp" | "card") => (e: Event) => { e.stopPropagation(); if (!c.loaded()) c.seek(c.snap.t, false); videoRegistry.insert?.(k, c); };
  row.querySelector(".vn-ts")!.addEventListener("click", ins("timestamp"));
  row.querySelector(".vn-card")!.addEventListener("click", ins("card"));
  if (c.el.tagName === "FIGURE") c.el.append(row); else c.el.after(row);
}

// ------------------------------------------------------------------ timestamp chips in rendered notes
/** Seek player `video` (1-based) of `root` to `t` and play; loads it first if it is still a thumbnail. */
export function seekIn(root: ParentNode, video: number, t: number): boolean {
  const el = root.querySelectorAll<HTMLElement>(PLAYER_SEL)[video - 1];
  let c = ctlFor(el);
  if (!c) return false;
  // the same video already running in the editor's dock → drive that one
  const dock = videoRegistry.dock?.root();
  if (dock && c.root !== dock && Number(dock.dataset.vnDock) === video) { const d = ctlFor(dock.querySelector(PLAYER_SEL)); if (d?.key === c.key) c = d; }
  c.seek(t, true);
  if (c.root !== dock) c.el.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  return true;
}

/** From the editor: player `video` of the open note (dock first, then the rendered note), or open the dock. */
export function seekNote(video: number, t: number): boolean {
  const dock = videoRegistry.dock;
  const dr = dock?.root();
  if (dr && Number(dr.dataset.vnDock) === video && dr.querySelector(PLAYER_SEL)) return seekIn(dr, 1, t);
  const roots = [...new Set(livePlayers().map((c) => c.root).filter((r): r is HTMLElement => !!r && r !== dr))];
  for (const r of roots) if (seekIn(r, video, t)) return true;
  return dock ? dock.take(video, t, true, 1) : false;
}

/** Called from hydrateEmbeds: marks the render root and turns timestamp chips into seek buttons. */
export function hydrateTimestamps(root: HTMLElement) {
  if (!root.closest("[data-vn-root]")) root.dataset.vnRoot = "1";
  if (root.dataset.vnTs) return;
  root.dataset.vnTs = "1";
  setTimeout(() => markChips(root.parentElement ?? root), 400);
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("button.vts");
    if (!b || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    const scope = b.closest<HTMLElement>("[data-vn-root]") ?? root;
    if (!seekIn(scope, Number(b.dataset.v) || 1, Number(b.dataset.t) || 0)) {
      b.classList.add("vts-none");
      b.title = "No video at this position in the note";
    }
  });
}

/** Chip HTML for the markdown renderer. */
export const timestampChip = (seconds: number, video: number, label: string) =>
  `<button type="button" class="vts" data-t="${seconds}" data-v="${video}" title="Play from ${label}${video > 1 ? ` (video ${video})` : ""}">${icon("play", 10)}<span>${label}</span></button>`;

export { findTimestamps, formatTime };
