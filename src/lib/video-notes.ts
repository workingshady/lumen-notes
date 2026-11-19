// Video notes with timestamps (design update 04, D8). Pure logic: no DOM, no React. Format: docs/VIDEO_NOTES.md.
//
//   [12:34]              → a timestamp chip for the note's first player
//   [1:02:03]            → hours form
//   [12:34](#video-2)    → targets the 2nd player of the note (players count top to bottom: YouTube, Vimeo, video and audio files)
//
// Not a timestamp: `[12:34](https://…)` (a normal link), `[12:34][ref]` (reference link), `\[12:34]` (escaped),
// `[^1]` footnotes, `[ ]` / `[x]` task boxes, and anything inside code.

/** One timestamp in a line of text. `from`/`to` are offsets in that text; `video` is 1-based. */
export interface Timestamp { from: number; to: number; seconds: number; video: number; label: string }

/** Inline (markdown-it) form: matched at the current position. */
export const TS_AT = /^\[(?:(\d{1,2}):([0-5]\d):([0-5]\d)|(\d{1,3}):([0-5]\d))\](?:\(#video-(\d{1,2})\))?/;
const TS_ALL = /(\\?)\[(?:(\d{1,2}):([0-5]\d):([0-5]\d)|(\d{1,3}):([0-5]\d))\](\(#video-(\d{1,2})\)|\(|\[)?/g;

const secs = (h: string | undefined, m: string, s: string) => (h ? Number(h) * 3600 : 0) + Number(m) * 60 + Number(s);

/** "12:34" / "1:02:03" → seconds, or null. */
export function parseTime(label: string): number | null {
  const m = /^(?:(\d{1,2}):([0-5]\d):([0-5]\d)|(\d{1,3}):([0-5]\d))$/.exec(label.trim());
  if (!m) return null;
  return m[1] !== undefined ? secs(m[1], m[2], m[3]) : secs(undefined, m[4], m[5]);
}

/** seconds → "m:ss" (under an hour) or "h:mm:ss". */
export function formatTime(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  t = Math.floor(t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** The markdown for a timestamp: `[12:34]`, or `[12:34](#video-2)` when it targets a later player. */
export const timestampMd = (t: number, video = 1) => `[${formatTime(t)}]${video > 1 ? `(#video-${video})` : ""}`;

/** Parse the match returned by TS_AT (used by the markdown-it rule). */
export function fromMatch(m: RegExpExecArray): { seconds: number; video: number; label: string } {
  const label = m[1] !== undefined ? `${m[1]}:${m[2]}:${m[3]}` : `${m[4]}:${m[5]}`;
  return { seconds: m[1] !== undefined ? secs(m[1], m[2], m[3]) : secs(undefined, m[4], m[5]), video: Number(m[6] || 1), label };
}

/** Every timestamp in one line of text (skips escaped ones, normal links and inline `code`). */
export function findTimestamps(line: string): Timestamp[] {
  const out: Timestamp[] = [];
  const code: [number, number][] = [];
  for (const c of line.matchAll(/(`+)[^`]*?\1/g)) code.push([c.index!, c.index! + c[0].length]);
  for (const m of line.matchAll(TS_ALL)) {
    const at = m.index! + m[1].length;
    if (m[1] || (m[7] && !m[8])) continue; // escaped, or "[12:34](" / "[12:34][" = a real link
    if (code.some(([a, b]) => at >= a && at < b)) continue;
    const label = m[2] !== undefined ? `${m[2]}:${m[3]}:${m[4]}` : `${m[5]}:${m[6]}`;
    const seconds = m[2] !== undefined ? secs(m[2], m[3], m[4]) : secs(undefined, m[5], m[6]);
    out.push({ from: at, to: m.index! + m[0].length, seconds, video: Number(m[8] || 1), label });
  }
  return out;
}

/** The timestamp under offset `pos` of `line`, if any. */
export const timestampAt = (line: string, pos: number) => findTimestamps(line).find((t) => pos >= t.from && pos <= t.to) ?? null;

// ------------------------------------------------------------------ players in a note (same order as the renderer)
export type VideoKind = "youtube" | "vimeo" | "file" | "audio";
export interface VideoSource { line: number; kind: VideoKind; url: string; text: string }

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac|flac)(\?|#|$)/i;
function kindOf(url: string, name = ""): VideoKind | null {
  if (/^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch|shorts|embed|live)|youtu\.be\/)/i.test(url)) return "youtube";
  if (/^https?:\/\/(www\.|player\.)?vimeo\.com\/(video\/)?\d+/i.test(url)) return "vimeo";
  const probe = url.startsWith("att:") ? name : url;
  if (VIDEO_EXT.test(probe)) return "file";
  if (AUDIO_EXT.test(probe)) return "audio";
  return null;
}

/**
 * Players of a note, top to bottom: a line that is only a bare URL (YouTube, Vimeo, video/audio file) or a
 * media image `![name](url)` (incl. uploads `![lecture.mp4](att:id)`). Lines inside code fences are skipped.
 */
export function videoSources(md: string): VideoSource[] {
  const out: VideoSource[] = [];
  let fence = false;
  md.split("\n").forEach((raw, i) => {
    const l = raw.trim();
    if (/^(`{3,}|~{3,})/.test(l)) { fence = !fence; return; }
    if (fence) return;
    let k: VideoKind | null = null, url = "";
    const bare = /^(https?:\/\/\S+)$/.exec(l);
    if (bare) { url = bare[1]; k = kindOf(url); }
    else {
      const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(l);
      if (img) { url = img[2]; k = kindOf(url, img[1]); }
    }
    if (k) out.push({ line: i, kind: k, url, text: l });
  });
  return out;
}

// ------------------------------------------------------------------ editor inserts
/**
 * Text to insert for a timestamp at the caret: on an empty line just `[12:34] `, otherwise a new line below the
 * caret's line. Returns the insert position and text plus where the caret goes.
 */
export function timestampInsert(doc: string, caret: number, t: number, video = 1): { at: number; text: string; caret: number } {
  const ls = doc.lastIndexOf("\n", caret - 1) + 1;
  let le = doc.indexOf("\n", caret);
  if (le < 0) le = doc.length;
  const ts = timestampMd(t, video) + " ";
  if (!doc.slice(ls, le).trim()) return { at: ls, text: ts, caret: ls + ts.length };
  return { at: le, text: "\n" + ts, caret: le + 1 + ts.length };
}

/** "Make a flashcard at this moment": a `question [12:34] :: ` line, caret where the question goes. */
export function flashcardInsert(doc: string, caret: number, t: number, video = 1): { at: number; text: string; caret: number } {
  const ls = doc.lastIndexOf("\n", caret - 1) + 1;
  let le = doc.indexOf("\n", caret);
  if (le < 0) le = doc.length;
  const card = ` ${timestampMd(t, video)} :: `;
  if (!doc.slice(ls, le).trim()) return { at: ls, text: card, caret: ls };
  return { at: le, text: "\n" + card, caret: le + 1 };
}

// ------------------------------------------------------------------ "Pause while typing"
/**
 * After a timestamp is inserted while the video plays, the first keystroke pauses the video; Enter on an empty
 * line, or `idleMs` without typing, resumes it. Pure state machine: the caller performs the returned action.
 */
export class TypingPause {
  armed = false;
  paused = false;
  last = 0;
  constructor(public idleMs = 4000) {}
  /** A timestamp was inserted; `playing` = the player was running. */
  inserted(playing: boolean) { this.armed = playing; this.paused = false; }
  /** A keystroke that changed the text. `enterOnEmpty` = Enter pressed on an empty line. */
  key(now: number, enterOnEmpty = false): "pause" | "resume" | null {
    this.last = now;
    if (this.paused && enterOnEmpty) { this.paused = false; return "resume"; }
    if (this.armed) { this.armed = false; this.paused = true; return "pause"; }
    return null;
  }
  /** Called on a timer. */
  tick(now: number): "resume" | null {
    if (this.paused && now - this.last >= this.idleMs) { this.paused = false; return "resume"; }
    return null;
  }
  /** The user played or paused by hand: forget our pause. */
  reset() { this.armed = false; this.paused = false; }
}

// ------------------------------------------------------------------ bridge (set by the player layer, read by slash.ts)
/** The current player's clock, if a video is loaded on screen (set by components/video-players.ts). */
export const videoClock: { now: () => { seconds: number; video: number } | null } = { now: () => null };
