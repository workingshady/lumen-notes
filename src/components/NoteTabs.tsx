// Note tabs — design round 6, Lumen 31 (NoteTabsDesk): the tab row under the note header (Note · Diagrams n · Media n ·
// Links n · Outline; a tab shows only when the note has that content, R6-31L), the Media tab (R6-31F…H: player with
// timestamp ticks, Add timestamp, Dock above note, your timestamps, everything found in the note incl. plain links that
// look like a video → "Show player?") and the Links tab (R6-31I…K: grouped Web / Video / PDF / Notes / Broken with use
// counts and filter chips, preview pane from a cached page snapshot, Open · Show as card in note · Save snapshot; phone:
// tap opens the preview sheet). Diagrams tab: DiagramsTab.tsx. Pure logic: lib/note-tabs.ts; snapshots + link check:
// lib/link-snapshots.ts + worker/ext/links.ts.
import { LazyMore, useBatch } from "./lazy-more";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { updateNote } from "../lib/actions";
import { API_BASE, getToken } from "../lib/api";
import { DEMO } from "../lib/db";
import { fmtDate, fmtNum, t, useLang } from "../lib/i18n";
import { brokenReason, cachedSnapshot, checkLinks, getSnapshot, saveSnapshot, useLinkStore, type Snapshot } from "../lib/link-snapshots";
import { hydrate, render } from "../lib/markdown";
import { addTimestamp, LINK_ORDER, noteDiagrams, noteLinks, noteMedia, noteTimestamps, promoteLink, type LinkItem, type LinkKind, type MediaItem } from "../lib/note-tabs";
import { excerpt, outline } from "../lib/parse";
import { tabVisible, useTabPrefs } from "../lib/tab-prefs";
import { openNote, setUI, toast, useUI, useVault, type Mode } from "../lib/store";
import { formatTime, timestampMd } from "../lib/video-notes";
import { Glyph } from "./Glyph";
import { ctlFor, onVideoChange, PLAYER_SEL, RATES, type VideoCtl } from "./video-players";
import { cx } from "./ui";

// ------------------------------------------------------------------ tab row
let lastNoteMode: Mode | null = null;
/** Remember which note view (edit / split / read) the Note tab returns to. */
export const rememberNoteMode = (m: Mode) => { if (m === "edit" || m === "split" || m === "read") lastNoteMode = m; };
const brokenFmt = (status: number, since: number) => (status ? t("{status} since {date}", { status, date: fmtDate(since, { day: "numeric", month: "short" }) }) : t("Unreachable since {date}", { date: fmtDate(since, { day: "numeric", month: "short" }) }));

export function useTabCounts(note: Note) {
  const v = useVault();
  useLinkStore();
  return useMemo(() => {
    const exists = (title: string) => v.byTitle.has(title.toLowerCase());
    return { diagrams: noteDiagrams(note.body).length, media: noteMedia(note.body).length, links: noteLinks(note.body, exists, (u) => brokenReason(u, brokenFmt)).length, headings: outline(note.body).length };
  }, [note.body, v.byTitle]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Tab row (R6-31): only when the note has diagrams, media or links. */
export function NoteTabBar({ note, mode, wide }: { note: Note; mode: Mode; wide: boolean }) {
  useLang();
  const ui = useUI();
  const c = useTabCounts(note);
  const prefs = useTabPrefs(); // Settings › Diagrams: tab order, modes, hide empty tabs
  const onNote = !["diagrams", "media", "links"].includes(mode);
  if (onNote) rememberNoteMode(mode);
  type Tab = { k: string; l: string; g: string; n?: number; on: boolean; go: () => void };
  const defs: Record<string, { has: boolean; tab: Tab }> = {
    note: { has: true, tab: { k: "note", l: t("Note"), g: "lesson", on: onNote, go: () => setUI({ mode: lastNoteMode ?? (wide ? "split" : "read") }) } },
    diagrams: { has: c.diagrams > 0, tab: { k: "diagrams", l: t("Diagrams"), g: "diagrams-tab", n: c.diagrams, on: mode === "diagrams", go: () => setUI({ mode: "diagrams" }) } },
    media: { has: c.media > 0, tab: { k: "media", l: t("Media"), g: "media", n: c.media, on: mode === "media", go: () => setUI({ mode: "media" }) } },
    links: { has: c.links > 0, tab: { k: "links", l: t("Links"), g: "links-tab", n: c.links, on: mode === "links", go: () => setUI({ mode: "links" }) } },
    outline: { has: wide && c.headings > 1, tab: { k: "outline", l: t("Outline"), g: "toc", on: ui.panel === "outline", go: () => setUI({ panel: ui.panel === "outline" ? null : "outline" }) } },
    history: { has: true, tab: { k: "history", l: t("History"), g: "history", on: ui.panel === "versions", go: () => setUI({ panel: ui.panel === "versions" ? null : "versions" }) } },
  };
  const tabs: Tab[] = prefs.tabs.filter((p) => defs[p.id] && tabVisible(p, defs[p.id].has, prefs.hideEmpty)).map((p) => defs[p.id].tab);
  // Only the Note tab left: no tab row (the note is the whole view).
  if (tabs.length <= 1) return null;
  return (
    <div role="tablist" aria-label={t("Note tabs")} className={cx("flex shrink-0 text-[13px] items-end gap-1 overflow-x-auto border-b border-line bg-bg", wide ? "px-6" : "px-3.5")} data-note-tabs>
      {tabs.map((tb) => (
        <button key={tb.k} role="tab" aria-selected={tb.on} onClick={tb.go} data-tab-btn={tb.k} title={tb.l}
          className={cx("flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap", wide ? "px-2.5" : "px-2", tb.on ? "font-semibold text-ink" : "font-[450] text-muted hover:text-ink")}
          style={{ boxShadow: tb.on ? "inset 0 -2px 0 var(--accent)" : "none", ...(tb.k === "outline" && ui.panel === "outline" ? { color: "var(--text)" } : {}) }}>
          <Glyph name={tb.g} size={15} />
          {(wide || tb.on) && <span>{tb.l}</span>}
          {tb.n ? <span className="rounded-full px-1.5 text-[11px] font-semibold leading-[17px]" style={tb.on ? { background: "color-mix(in srgb, var(--accent) 16%, transparent)", color: "var(--accent)" } : { background: "var(--surface-2)", color: "var(--muted)" }}>{fmtNum(tb.n)}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Media tab
const MEDIA_GLYPH: Record<string, string> = { youtube: "play", vimeo: "play", file: "media", audio: "audio" };
const vmeta = (url: string): { title?: string; duration?: number } | null => { try { return JSON.parse(localStorage.getItem("lumen.vmeta." + url) ?? "null"); } catch { return null; } };
const DISMISS = "lumen.media.asked";

export function MediaTab({ note, wide }: { note: Note; wide: boolean }) {
  useLang();
  const items = useMemo(() => noteMedia(note.body), [note.body]);
  const stamps = useMemo(() => noteTimestamps(note.body), [note.body]);
  const players = items.filter((m) => m.player);
  const [selUrl, setSelUrl] = useState<string | null>(null);
  const sel = players.find((m) => m.url === selUrl) ?? players[0];
  const host = useRef<HTMLDivElement>(null);
  const [ctl, setCtl] = useState<VideoCtl | null>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [, setAsked] = useState(0);
  const lines = note.body.split("\n");
  const selText = sel ? lines[sel.line]?.trim() ?? sel.url : "";

  // render the selected player (same markup + control layer as the preview: video-players.ts)
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    setCtl(null);
    if (!sel) { el.replaceChildren(); return; }
    el.dataset.vnRoot = "1";
    el.dataset.vnDock = String(sel.player ?? 1);
    el.innerHTML = render(selText);
    hydrate(el);
    let n = 0;
    const find = () => { const c = ctlFor(el.querySelector(PLAYER_SEL)); if (c) setCtl(c); else if (n++ < 40) setTimeout(find, 100); };
    find();
  }, [selText, sel?.player]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onVideoChange(force), []);
  useEffect(() => { const i = setInterval(force, 500); return () => clearInterval(i); }, []);

  const mine = stamps.filter((s) => s.video === (sel?.player ?? 1));
  const time = ctl?.loaded() ? ctl.time() : 0;
  const dur = ctl?.duration() || vmeta(sel?.url ?? "")?.duration || 0;
  const cur = [...mine].reverse().find((s) => s.seconds <= time + 0.5);
  const addStamp = async () => {
    if (!sel) return;
    const secs = Math.floor(ctl?.loaded() ? ctl.time() : 0);
    const r = addTimestamp(note.body, secs, sel.player ?? 1, sel.line, timestampMd(secs, sel.player ?? 1));
    await updateNote(note.id, { body: r.body });
    toast(t("{stamp} added to the note", { stamp: `[${formatTime(secs)}]` }), { label: t("Write"), run: () => setUI({ mode: "edit" }) });
  };
  const dock = () => {
    try { localStorage.setItem("lumen.video.dock", "1"); } catch { /* ignore */ }
    if (ctl?.loaded()) ctl.pause();
    setUI({ mode: wide ? "split" : "edit" });
  };
  const showPlayer = async (m: MediaItem) => {
    try { const a = JSON.parse(localStorage.getItem(DISMISS) ?? "[]") as string[]; localStorage.setItem(DISMISS, JSON.stringify([...a, m.url])); } catch { /* ignore */ }
    await updateNote(note.id, { body: promoteLink(note.body, m.url) });
    setSelUrl(m.url);
    setAsked((x) => x + 1);
  };
  const asked = (u: string) => { try { return (JSON.parse(localStorage.getItem(DISMISS) ?? "[]") as string[]).includes(u); } catch { return false; } };
  const sub = (m: MediaItem) => {
    if (m.detected) return t("Plain link, detected as video");
    const meta = vmeta(m.url);
    const d = m === sel && dur ? dur : meta?.duration ?? 0;
    const kind = m.kind === "youtube" ? "YouTube" : m.kind === "vimeo" ? "Vimeo" : m.kind === "audio" ? t("Audio") : m.url.startsWith("att:") || /^!\[/.test(lines[m.line] ?? "") ? t("Uploaded") : t("Video");
    return [kind, d ? formatTime(d) : "", m === sel && ctl?.playing() ? t("playing") : ""].filter(Boolean).join(" · ");
  };
  const titleOf = (m: MediaItem) => vmeta(m.url)?.title || m.title;
  const batch = useBatch(items.length, note.id); // lazy thumbnails, mediaBatch at a time (Lumen 32 R6-32F)

  if (!items.length) return <div className="flex h-full items-center justify-center text-muted">{t("No videos or audio in this note.")}</div>;
  return (
    <div className={cx("h-full overflow-y-auto text-[13px]", wide ? "px-7 py-5" : "p-3.5")} data-tab="media">
      <div className={cx("grid gap-4", wide ? "grid-cols-[1.4fr_1fr]" : "grid-cols-1")}>
        <div className="flex min-w-0 flex-col gap-2.5">
          {sel ? (
            <div className="relative overflow-hidden rounded-[12px] border border-line bg-[#161A21]" style={{ aspectRatio: sel.kind === "audio" ? undefined : "16 / 9" }}>
              <div ref={host} className="r6-media h-full w-full [&_.embed]:!m-0 [&_figure]:!m-0 [&_figure]:h-full [&_iframe]:h-full [&_video]:h-full [&_video]:w-full" />
              {sel.kind !== "audio" && (
                <div className="pointer-events-none absolute inset-x-3 bottom-2.5 flex items-center gap-2.5 text-[12px] text-white" data-scrub>
                  <span className="tabular-nums">{formatTime(time)}</span>
                  <span className="pointer-events-auto relative h-1 flex-1 cursor-pointer rounded-[2px] bg-white/25"
                    onClick={(e) => { if (!ctl || !dur) return; const r = e.currentTarget.getBoundingClientRect(); ctl.seek(((e.clientX - r.left) / r.width) * dur, true); }}>
                    <span className="absolute inset-y-0 start-0 rounded-[2px] bg-[#F2A93B]" style={{ width: dur ? `${Math.min(100, (time / dur) * 100)}%` : 0 }} />
                    {dur > 0 && mine.map((s) => <span key={s.line} title={s.text} className="absolute -top-[3px] h-2.5 w-0.5 bg-white opacity-80" style={{ insetInlineStart: `${Math.min(100, (s.seconds / dur) * 100)}%` }} />)}
                  </span>
                  <span className="tabular-nums">{dur ? formatTime(dur) : "–:––"}</span>
                  <button className="pointer-events-auto rounded-[5px] bg-white/15 px-1.5" onClick={() => { if (!ctl) return; const i = RATES.indexOf(ctl.rate()); ctl.setRate(RATES[(i + 1) % RATES.length]); force(); }} title={t("Speed")}>{fmtNum(ctl?.rate() ?? 1)}×</button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-[12px] border border-dashed border-line text-muted">{t("Pick a video on the right, or show a detected link as a player.")}</div>
          )}
          {sel && (
            <div className="flex flex-wrap items-center gap-2">
              <b dir="auto" className="min-w-0 flex-1 truncate font-semibold">{titleOf(sel)}</b>
              <button onClick={() => void addStamp()} className="flex h-7 items-center gap-1.5 rounded-[7px] border border-line px-2.5 hover:bg-surface-2" data-act="add-timestamp"><Glyph name="timestamp" size={13} />{t("Add timestamp")}</button>
              {wide && <button onClick={dock} className="flex h-7 items-center rounded-[7px] border border-line px-2.5 hover:bg-surface-2" data-act="dock">{t("Dock above note")}</button>}
            </div>
          )}
          {sel && (
            <div className="flex flex-col gap-0.5">
              <span className="pb-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t("Your timestamps")}</span>
              {!mine.length && <span className="text-[12.5px] text-muted">{t("None yet. Play the video and press Add timestamp.")}</span>}
              {mine.map((s) => (
                <button key={s.line} onClick={() => ctl?.seek(s.seconds, true)} className="flex h-8 items-center gap-2.5 rounded-[7px] px-1.5 text-start hover:bg-surface" style={{ background: cur === s ? "var(--surface)" : undefined }} data-stamp={s.label}>
                  <span className="rounded-[5px] px-1.5 font-mono text-[12px] font-medium leading-5 text-info" style={{ background: "color-mix(in srgb, var(--info) 14%, transparent)" }}>{s.label}</span>
                  <span dir="auto" className="min-w-0 flex-1 truncate">{s.text || t("(no note)")}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center"><span className="flex-1 font-semibold">{t("Found in this note · {n}", { n: items.length })}</span><span className="text-[12px] text-muted">{t("Auto-detected")}</span></div>
          {items.slice(0, batch.shown).map((m) => {
            const on = m === sel;
            return (
              <div key={m.url} role="button" tabIndex={0} onClick={() => (m.player ? setSelUrl(m.url) : void 0)} onKeyDown={(e) => e.key === "Enter" && m.player && setSelUrl(m.url)}
                className={cx("flex items-center gap-2.5 rounded-[10px] border p-2", !!m.player && "cursor-pointer")} style={{ borderColor: on ? "var(--accent)" : "var(--border)", background: on ? "color-mix(in srgb, var(--accent) 6%, var(--surface))" : "var(--surface)" }} data-media={m.kind}>
                <span className="flex h-10 w-16 shrink-0 items-center justify-center rounded-[6px]" style={{ background: "repeating-linear-gradient(135deg, var(--surface-2) 0 6px, var(--bg) 6px 12px)" }}><Glyph name={m.detected ? "link" : MEDIA_GLYPH[m.kind]} size={15} color="var(--muted)" /></span>
                <span className="flex min-w-0 flex-1 flex-col gap-px"><span dir="auto" className="truncate font-medium">{titleOf(m)}</span><span className="text-[11.5px] text-muted">{sub(m)}</span></span>
                {m.detected && !asked(m.url) && <button onClick={(e) => { e.stopPropagation(); void showPlayer(m); }} className="whitespace-nowrap rounded-[5px] px-1.5 text-[11px] leading-[18px] text-warn" style={{ background: "color-mix(in srgb, var(--warning) 14%, transparent)" }} data-act="show-player">{t("Show player?")}</button>}
              </div>
            );
          })}
          <LazyMore {...batch} />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Links tab
const KIND_LABEL: Record<LinkKind, string> = { web: "Web", video: "Video", pdf: "PDF", note: "Notes", broken: "Broken" };
const KIND_GLYPH: Record<LinkKind, string> = { web: "link", video: "play", pdf: "pdf", note: "wikilink", broken: "broken-link" };
const HUES = ["#E8893A", "#B31B1B", "#57AB5A", "#E5534B", "#4A8FD8", "#8E6BD8", "#2BA3A3", "#C2852E"];
const favColor = (host: string, kind: LinkKind) => (kind === "note" || kind === "broken" ? "var(--surface-2)" : kind === "pdf" ? "#EF6B6B" : kind === "video" && /youtu/.test(host) ? "#E5534B" : HUES[[...host].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length]);
const CHECK_KEY = (id: string) => `lumen.linkcheck.at.${id}`;

export function LinksTab({ note, wide }: { note: Note; wide: boolean }) {
  const v = useVault();
  useLang();
  useLinkStore();
  const links = useMemo(() => noteLinks(note.body, (x) => v.byTitle.has(x.toLowerCase()), (u) => brokenReason(u, brokenFmt)), [note.body, v.byTitle]); // eslint-disable-line react-hooks/exhaustive-deps
  const [filter, setFilter] = useState<LinkKind | "all">("all");
  const [sel, setSel] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [checking, setChecking] = useState(false);
  const counts = Object.fromEntries(LINK_ORDER.map((k) => [k, links.filter((l) => l.kind === k).length])) as Record<LinkKind, number>;
  const shown = links.filter((l) => filter === "all" || l.kind === filter);
  const cur = links.find((l) => l.key === sel) ?? (wide ? links.find((l) => l.kind === "web") ?? links[0] : undefined);
  const webUrls = links.filter((l) => l.kind === "web" || l.kind === "video" || (l.kind === "broken" && !l.target)).map((l) => l.url);
  const check = async (quiet = false) => {
    if (!webUrls.length || checking) return;
    if (!getToken() && !DEMO) { if (!quiet) toast(t("Unlock sync to check links.")); return; }
    setChecking(true);
    try { const bad = await checkLinks(webUrls); try { localStorage.setItem(CHECK_KEY(note.id), String(Date.now())); } catch { /* ignore */ } if (!quiet) toast(bad ? t("{n} broken link found|{n} broken links found", { n: bad }) : t("All links work")); }
    catch (e) { if (!quiet) toast((e as Error).message); } finally { setChecking(false); }
  };
  // check once a day per note, quietly, when online
  useEffect(() => {
    const at = Number((() => { try { return localStorage.getItem(CHECK_KEY(note.id)); } catch { return 0; } })() || 0);
    if (Date.now() - at > 86_400_000 && navigator.onLine !== false) void check(true);
  }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const chip = (k: LinkKind | "all", label: string, n: number) => (
    <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className="flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-[12px]"
      style={filter === k ? { borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 12%, transparent)", fontWeight: 600 } : { borderColor: "var(--border)", fontWeight: 450 }}>{label}<span className="text-muted">{fmtNum(n)}</span></button>
  );
  if (!links.length) return <div className="flex h-full items-center justify-center text-muted">{t("No links in this note.")}</div>;
  return (
    <div className={cx("h-full overflow-hidden text-[13px]", wide ? "px-7 py-5" : "p-3.5")} data-tab="links">
      <div className={cx("grid h-full gap-4", wide ? "grid-cols-[1fr_1.1fr]" : "grid-cols-1")}>
        <div className="flex min-h-0 min-w-0 flex-col gap-1.5 overflow-y-auto">
          <div className="flex flex-wrap gap-1.5 pb-1">
            {chip("all", t("All"), links.length)}
            {LINK_ORDER.filter((k) => counts[k]).map((k) => chip(k, t(KIND_LABEL[k]), counts[k]))}
          </div>
          {LINK_ORDER.filter((k) => (filter === "all" || filter === k) && counts[k]).map((k) => (
            <div key={k} className="flex flex-col gap-1.5">
              <div className="flex items-center px-0.5 pb-0.5 pt-2">
                <span className="flex-1 text-[11px] font-semibold uppercase tracking-[.06em]" style={{ color: k === "broken" ? "var(--danger)" : "var(--muted)" }}>{t(KIND_LABEL[k])} · {fmtNum(counts[k])}</span>
                {(k === "broken" || (k === "web" && !counts.broken)) && webUrls.length > 0 && <button onClick={() => void check()} disabled={checking} className="text-[11.5px] text-link hover:underline disabled:opacity-60" data-act="check-links">{checking ? t("Checking…") : t("Check links")}</button>}
              </div>
              {shown.filter((l) => l.kind === k).map((l) => <LinkRow key={l.key} spaceId={note.spaceId} l={l} on={cur?.key === l.key && wide} onClick={() => { setSel(l.key); if (!wide) setSheet(true); }} />)}
            </div>
          ))}
        </div>
        {wide && cur && <LinkPreview note={note} l={cur} />}
      </div>
      {!wide && sheet && cur && (
        <div className="fixed inset-0 z-50 bg-[rgba(5,6,8,.5)] fade-in" onMouseDown={(e) => e.target === e.currentTarget && setSheet(false)}>
          <div className="absolute inset-x-0 bottom-0 flex h-[78%] flex-col rounded-t-[14px] bg-surface" role="dialog" aria-label={t("Link preview")}>
            <span className="flex justify-center py-2"><span className="h-1 w-9 rounded-[2px] bg-line" /></span>
            <div className="min-h-0 flex-1 px-3 pb-4"><LinkPreview note={note} l={cur} onDone={() => setSheet(false)} /></div>
          </div>
        </div>
      )}
    </div>
  );
}

function LinkRow({ l, on, onClick, spaceId }: { l: LinkItem; on: boolean; onClick: () => void; spaceId: string }) {
  const v = useVault();
  const fav = favColor(l.host, l.kind);
  const tn = l.target ? v.byTitle.get(l.target.toLowerCase()) : undefined;
  const where = tn ? (tn.spaceId === spaceId ? t("in this space") : v.spaceMap.get(tn.spaceId)?.name ?? t("Inbox")) : "";
  const title = l.kind === "video" ? vmeta(l.url)?.title || l.title : l.title;
  const plain = fav.startsWith("var(");
  return (
    <button onClick={onClick} className="flex min-h-11 items-center gap-2.5 rounded-[9px] px-2.5 py-1.5 text-start hover:bg-surface" style={{ background: on ? "var(--surface)" : undefined, boxShadow: on ? "inset 2px 0 0 var(--accent)" : "none" }} data-link={l.kind}>
      <span className="flex size-[22px] shrink-0 items-center justify-center rounded-[5px]" style={{ background: fav }}><Glyph name={KIND_GLYPH[l.kind]} size={13} color={plain ? "var(--muted)" : "#fff"} /></span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span dir="auto" className="truncate font-medium leading-[17px]" style={{ color: l.kind === "broken" ? "var(--danger)" : undefined }}>{title}</span>
        <span className="truncate text-[11.5px] text-muted" dir="auto">{l.kind === "note" ? `${l.url} · ${where}` : l.kind === "broken" ? (l.target ? t("{link} · no such note", { link: l.url }) : `${l.host} · ${l.why}`) : l.host || l.url}</span>
      </span>
      {l.count > 1 && <span className="text-[11px] text-muted">{fmtNum(l.count)}×</span>}
    </button>
  );
}

function LinkPreview({ note, l, onDone }: { note: Note; l: LinkItem; onDone?: () => void }) {
  const v = useVault();
  useLinkStore();
  const [snap, setSnap] = useState<Snapshot | null>(() => (l.kind === "web" || l.kind === "video" || l.kind === "broken" ? cachedSnapshot(l.url) : null));
  const [loading, setLoading] = useState(false);
  const web = !l.target && l.kind !== "pdf";
  useEffect(() => {
    if (!web) return;
    let live = true;
    setSnap(cachedSnapshot(l.url));
    setLoading(true);
    void getSnapshot(l.url).then((s) => { if (live) { setSnap(s); setLoading(false); } });
    return () => { live = false; };
  }, [l.url, web]);
  const target = l.target ? v.byTitle.get(l.target.toLowerCase()) : undefined;
  const open = () => {
    onDone?.();
    if (target) return openNote(target.id);
    if (l.target) return toast(t("“{title}” doesn't exist yet. Create it from the link in the note.", { title: l.target }));
    if (l.url.startsWith("att:")) return window.open(`${API_BASE}/api/att/${l.url.slice(4)}`, "_blank", "noopener");
    window.open(l.url, "_blank", "noopener,noreferrer");
  };
  const asCard = async () => { await updateNote(note.id, { body: promoteLink(note.body, l.url) }); toast(t("Shown as a card in the note")); onDone?.(); };
  const keep = async () => { const s = await saveSnapshot(l.url); if (s) { setSnap(s); toast(t("Snapshot saved on this device")); } else toast(t("Couldn't fetch the page. Try again online.")); };
  const btn = "flex h-[30px] items-center rounded-[7px] border border-line px-2.5 hover:bg-surface-2";
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[12px] border border-line bg-surface" data-link-preview>
      <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-line px-2.5">
        <span className="size-3.5 shrink-0 rounded-[3px]" style={{ background: favColor(l.host, l.kind) }} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted" dir="ltr">{l.target ? `[[${l.target}]]` : l.url.replace(/^https?:\/\//, "")}</span>
        {snap?.saved ? <span className="text-[11px] text-ok">{t("Saved {date}", { date: fmtDate(snap.saved, { day: "numeric", month: "short" }) })}</span> : null}
        <button aria-label={t("Open")} onClick={open} className="flex size-6 items-center justify-center text-muted hover:text-ink"><Glyph name="external" size={14} /></button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-[18px]" style={target ? undefined : { background: "#FBFAF7", color: "#1F1D1A" }}>
        {target ? (
          <>
            <span dir="auto" className="font-serif text-[22px] font-bold">{target.title}</span>
            <span dir="auto" className="leading-[1.6] text-muted">{excerpt(target.body, 600)}</span>
          </>
        ) : l.target ? (
          <span className="text-[#6A655C]">{t("This note doesn't exist yet.")}</span>
        ) : l.kind === "pdf" ? (
          <><span dir="auto" className="font-serif text-[22px] font-bold">{l.title}</span><span className="text-[#6A655C]">{t("PDF · open it to read and annotate.")}</span></>
        ) : (
          <>
            {snap?.image ? <img src={snap.image} alt="" className="h-[120px] w-full rounded-[6px] object-cover" /> : <span className="h-[120px] shrink-0 rounded-[6px]" style={{ background: "repeating-linear-gradient(135deg, #ECE9E1 0 8px, #F4F2EC 8px 16px)" }} />}
            {snap ? (
              <>
                <span dir="auto" className="font-serif text-[22px] font-bold leading-[1.25]">{snap.title || l.host}</span>
                {!snap.ok && <span className="text-[#C42B2B]">{snap.status ? t("The page answered {status}.", { status: snap.status }) : t("The page couldn't be reached.")}</span>}
                {snap.description && <span dir="auto" className="leading-[1.6] text-[#4A463F]">{snap.description}</span>}
                {snap.text && snap.text.split("\n\n").slice(0, 4).map((p, i) => <p key={i} dir="auto" className="m-0 font-serif text-[14.5px] leading-[1.65]">{p}</p>)}
                <span className="text-[11.5px] text-[#6A655C]">{t("Snapshot from {date}", { date: fmtDate(snap.fetchedAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })}</span>
              </>
            ) : loading ? (
              <>{[90, 80, 86, 60].map((w) => <span key={w} className="h-1.5 rounded-[3px] bg-[#D8D4CA]" style={{ width: `${w}%` }} />)}</>
            ) : <span className="text-[#6A655C]">{t("No snapshot yet. Open the page, or save a snapshot when you're online.")}</span>}
          </>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 border-t border-line p-2.5">
        <button onClick={open} className="flex h-[30px] items-center rounded-[7px] bg-accent px-2.5 font-semibold text-accent-fg" data-act="open-link">{t("Open")}</button>
        {web && <button onClick={() => void asCard()} className={btn} data-act="as-card">{t("Show as card in note")}</button>}
        {web && <button onClick={() => void keep()} className={btn} data-act="save-snapshot">{snap?.saved ? t("Update snapshot") : t("Save snapshot")}</button>}
        {l.kind === "broken" && l.target && <button onClick={() => { onDone?.(); setUI({ mode: "edit" }); }} className={btn}>{t("Fix in the note")}</button>}
      </div>
    </div>
  );
}
