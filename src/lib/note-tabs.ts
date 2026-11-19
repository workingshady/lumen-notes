// Note tabs (design round 6, Lumen 31 · NoteTabsDesk): what a note contains, for the Diagrams / Media / Links tabs.
// Pure (no DOM, no React) so it can be tested (scripts/note-tabs.test.ts). Format notes: docs/NOTE_TABS.md.
//
//  noteDiagrams(body) → every ```mermaid block + every diagram image (alt / file name says diagram, figure, chart, graph,
//                        flow, schema, architecture, or an .svg)
//  noteMedia(body)    → players (bare YouTube / Vimeo / video / audio lines, as video-notes.ts) + inline links that look
//                        like a video ("Plain link, detected as video" → Show player? promotes it to its own line)
//  noteLinks(body)    → every link grouped Web / Video / PDF / Notes / Broken, with how many times each is used
//  promoteLink(body, url) → the URL on its own line under its paragraph (Show player · Show as card in note)
//  noteTimestamps(body)   → [12:34] lines per player, with the text after the stamp as the label
import type { DiagramBlock } from "./diagrams";
import { findTimestamps, videoSources, type VideoKind } from "./video-notes";

// ------------------------------------------------------------------ diagrams
// Same rules as lib/diagrams.ts mermaidBlocks (kept here so this file stays free of app imports and testable in Node).
const diagramKind = (src: string) => (src.split("\n").find((l) => l.trim() && !/^\s*%%/.test(l)) ?? "diagram").trim().split(/\s+/)[0];
function mermaidBlocks(body: string): DiagramBlock[] {
  const out: DiagramBlock[] = [];
  let heading = "", open: { line: number; fence: string; mermaid: boolean; buf: string[] } | null = null;
  body.split("\n").forEach((l, i) => {
    if (open) {
      if (l.trimStart().startsWith(open.fence) && l.trim().replace(/[`~]/g, "") === "") {
        if (open.mermaid) { const src = open.buf.join("\n"); out.push({ line: open.line, src, heading, kind: diagramKind(src) }); }
        open = null;
      } else open.buf.push(l);
      return;
    }
    const f = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(l);
    if (f) { open = { line: i, fence: f[1], mermaid: f[2].toLowerCase() === "mermaid", buf: [] }; return; }
    const h = /^#{1,6}\s+(.+?)\s*#*$/.exec(l);
    if (h) heading = h[1].replace(/[*_`[\]]/g, "").trim();
  });
  return out;
}
export interface NoteDiagram { id: string; kind: "mermaid" | "image"; title: string; type: string; line: number; block?: DiagramBlock; url?: string }
const DIAGRAM_IMG = /diagram|figure|\bfig\b|fig[\s_-]?\d|chart|graph|flow|schema|architecture|\.svg(\?|#|$)/i;
const MEDIA_EXT = /\.(mp4|webm|mov|m4v|mp3|wav|ogg|m4a|aac|flac)(\?|#|$)/i;
/** "flowchart TD", "sequenceDiagram" … from the first line of a Mermaid source. */
export const mermaidType = (src: string) => (src.split("\n").find((l) => l.trim() && !/^\s*%%/.test(l)) ?? "diagram").trim().split(/\s+/).slice(0, 2).join(" ").replace(/[;{].*$/, "");
export function noteDiagrams(body: string): NoteDiagram[] {
  const out: NoteDiagram[] = mermaidBlocks(body).map((b, i) => ({ id: `m${b.line}`, kind: "mermaid" as const, title: b.heading || `${diagramKind(b.src)} ${i + 1}`, type: mermaidType(b.src), line: b.line, block: b }));
  let fence = false;
  body.split("\n").forEach((l, i) => {
    if (/^\s*(`{3,}|~{3,})/.test(l)) { fence = !fence; return; }
    if (fence) return;
    for (const m of l.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const [, alt, url] = m;
      if (MEDIA_EXT.test(url) || MEDIA_EXT.test(alt)) continue;
      if (!DIAGRAM_IMG.test(alt) && !DIAGRAM_IMG.test(url)) continue;
      out.push({ id: `i${i}:${m.index}`, kind: "image", title: alt.trim() || fileOf(url), type: "image", line: i, url });
    }
  });
  return out.sort((a, b) => a.line - b.line);
}
const fileOf = (u: string) => { try { return decodeURIComponent(u.split(/[?#]/)[0].split("/").pop() || u); } catch { return u; } };

// ------------------------------------------------------------------ media
export interface MediaItem { url: string; kind: VideoKind; line: number; title: string; /** 1-based player index (players only). */ player?: number; /** Inline link that looks like a video (not a player yet). */ detected?: boolean }
export const VIDEO_HOST = /^https?:\/\/(www\.|m\.|player\.)?(youtube\.com\/(watch|shorts|embed|live)|youtu\.be\/|vimeo\.com\/(video\/)?\d+)/i;
const isVideoUrl = (u: string) => VIDEO_HOST.test(u) || MEDIA_EXT.test(u);
const kindOfUrl = (u: string): VideoKind => (/youtu/i.test(u) ? "youtube" : /vimeo/i.test(u) ? "vimeo" : /\.(mp3|wav|ogg|m4a|aac|flac)(\?|#|$)/i.test(u) ? "audio" : "file");
export function noteMedia(body: string): MediaItem[] {
  const players = videoSources(body).map((s, i) => {
    const alt = /^!\[([^\]]*)\]/.exec(s.text)?.[1];
    return { url: s.url, kind: s.kind, line: s.line, title: alt || (s.kind === "youtube" || s.kind === "vimeo" ? s.url.replace(/^https?:\/\/(www\.)?/, "") : fileOf(s.url)), player: i + 1 };
  });
  const seen = new Set(players.map((p) => p.url));
  const out: MediaItem[] = [...players];
  let fence = false;
  body.split("\n").forEach((l, i) => {
    if (/^\s*(`{3,}|~{3,})/.test(l)) { fence = !fence; return; }
    if (fence || players.some((p) => p.line === i)) return;
    for (const m of l.matchAll(/(?:\[([^\]]*)\]\()?(https?:\/\/[^\s)<>\]]+)\)?/g)) {
      const url = m[2].replace(/[.,;:!?]+$/, "");
      if (!isVideoUrl(url) || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, kind: kindOfUrl(url), line: i, title: m[1]?.trim() || url.replace(/^https?:\/\/(www\.)?/, ""), detected: true });
    }
  });
  return out;
}

/** Timestamps in the note: per player (1-based), with the text after the stamp as the label. */
export interface StampRow { seconds: number; label: string; video: number; line: number; text: string }
export function noteTimestamps(body: string): StampRow[] {
  const out: StampRow[] = [];
  let fence = false;
  body.split("\n").forEach((l, i) => {
    if (/^\s*(`{3,}|~{3,})/.test(l)) { fence = !fence; return; }
    if (fence) return;
    for (const ts of findTimestamps(l)) {
      const rest = l.slice(ts.to).replace(/^[\s:–—-]+/, "").replace(/\s*::.*$/, "").replace(/[*_`]/g, "").trim();
      const before = l.slice(0, ts.from).replace(/^\s*(?:[-*+]|\d+[.)])\s*/, "").replace(/[*_`]/g, "").trim();
      out.push({ seconds: ts.seconds, label: ts.label, video: ts.video, line: i, text: rest || before || "" });
    }
  });
  return out.sort((a, b) => a.video - b.video || a.seconds - b.seconds);
}

/** `[mm:ss] ` written on a new line after the last timestamp of that player (else under the player's line). */
export function addTimestamp(body: string, seconds: number, video: number, playerLine: number, stamp: string): { body: string; line: number } {
  const lines = body.split("\n");
  const last = noteTimestamps(body).filter((s) => s.video === video).pop();
  const at = (last ? last.line : playerLine) + 1;
  void seconds;
  lines.splice(at, 0, stamp + " ");
  return { body: lines.join("\n"), line: at };
}

// ------------------------------------------------------------------ links
export type LinkKind = "web" | "video" | "pdf" | "note" | "broken";
export interface LinkItem { key: string; kind: LinkKind; url: string; title: string; host: string; count: number; line: number; /** Wikilink target (kind note / broken note). */ target?: string; /** Broken: why (missing note, HTTP status). */ why?: string }
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const bare = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
const isPdf = (u: string) => /\.pdf(\?|#|$)/i.test(u);
/**
 * Every link of the note, once each (count = uses). `noteExists(title)` decides whether a [[wikilink]] resolves;
 * `brokenWeb(url)` returns a reason ("404 since 2 Nov") for a web link a link check found broken.
 */
export function noteLinks(body: string, noteExists: (title: string) => boolean, brokenWeb: (url: string) => string | null = () => null): LinkItem[] {
  const map = new Map<string, LinkItem>();
  const add = (key: string, mk: () => Omit<LinkItem, "count" | "key">) => { const e = map.get(key); if (e) e.count++; else map.set(key, { key, count: 1, ...mk() }); };
  let fence = false;
  body.split("\n").forEach((l, i) => {
    if (/^\s*(`{3,}|~{3,})/.test(l)) { fence = !fence; return; }
    if (fence) return;
    const s = l.replace(/`[^`]*`/g, " ");
    for (const m of s.matchAll(/!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g)) {
      if (m[0].startsWith("!")) continue; // embeds are content, not links
      const target = m[1].trim();
      const ok = noteExists(target);
      add(`note:${target.toLowerCase()}`, () => ({ kind: ok ? "note" : "broken", url: `[[${target}]]`, title: m[2]?.trim() || target, host: ok ? "" : "", line: i, target, why: ok ? undefined : "missing" }));
    }
    const noWiki = s.replace(/!?\[\[[^\]]*\]\]/g, " ");
    for (const m of noWiki.matchAll(/(!?)\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<>)\]]+)/g)) {
      if (m[1] === "!") { if (!isPdf(m[3])) continue; } // images aren't links; an embedded PDF is
      const raw = (m[3] ?? m[4] ?? "").replace(/[.,;:!?]+$/, "");
      if (!raw || raw.startsWith("#")) continue;
      const isAtt = raw.startsWith("att:");
      if (!/^https?:\/\//i.test(raw) && !isAtt) continue;
      const label = (m[2] ?? "").trim();
      if (isPdf(raw) || (isAtt && /\.pdf$/i.test(label))) { add(`url:${raw}`, () => ({ kind: "pdf", url: raw, title: label || fileOf(raw), host: isAtt ? "" : hostOf(raw), line: i })); continue; }
      if (isAtt) continue;
      const why = brokenWeb(raw);
      const kind: LinkKind = why ? "broken" : isVideoUrl(raw) ? "video" : "web";
      add(`url:${raw}`, () => ({ kind, url: raw, title: label && label !== raw ? label : bare(raw), host: hostOf(raw), line: i, why: why ?? undefined }));
    }
  });
  return [...map.values()];
}
export const LINK_ORDER: LinkKind[] = ["web", "video", "pdf", "note", "broken"];

/** Put `url` on its own line right after the paragraph it is in (a bare line renders as a player / link card). */
export function promoteLink(body: string, url: string): string {
  const lines = body.split("\n");
  const i = lines.findIndex((l) => l.includes(url));
  if (i < 0) return body;
  if (lines[i].trim() === url) return body;
  let end = i;
  while (end + 1 < lines.length && lines[end + 1].trim() && !/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~)/.test(lines[end + 1].trim())) end++;
  lines.splice(end + 1, 0, "", url, "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Counts for the tab badges. */
export function tabCounts(body: string, noteExists: (t: string) => boolean, brokenWeb?: (u: string) => string | null) {
  return { diagrams: noteDiagrams(body).length, media: noteMedia(body).length, links: noteLinks(body, noteExists, brokenWeb).length };
}
