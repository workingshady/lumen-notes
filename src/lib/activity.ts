/* Note activity log ("what happened", kind "activity"; History panel › Activity).
 * Every note write goes through save() in db.ts, which hands (before, after) to the hook below. The hook only queues:
 * writes to the log happen after a short idle (1.5 s, right away for discrete events like trash/share/publish), off the
 * save path. Like Google Docs / Confluence history, a typing session coalesces: edits (and renames, tag and type/status
 * changes) on one device within 5 minutes of the last change update one entry instead of adding new ones.
 * Per-note cap: the newest CAP live entries; older ones become tombstones (deleted: 1) so other devices drop them too. */
import { diffChars } from "diff";
import Dexie from "dexie";
import type { Activity, ActivityAction, Note } from "../../shared/types";
import { db, now, onNoteSaved, save, uid } from "./db";
import { splitFrontMatter } from "./parse";

export const ACTIVITY_WINDOW = 5 * 60_000;
/** A coalesced session never spans more than this (a long writing day still shows as several entries). */
const SESSION_MAX = 60 * 60_000;
export const ACTIVITY_CAP = 300;

/** +added / −removed characters from `a` to `b` (common prefix/suffix trimmed; very long middles fall back to an estimate). */
export function charDelta(a: string, b: string): { add: number; del: number } {
  if (a === b) return { add: 0, del: 0 };
  let s = 0;
  const n = Math.min(a.length, b.length);
  while (s < n && a[s] === b[s]) s++;
  let e = 0;
  while (e < n - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const x = a.slice(s, a.length - e), y = b.slice(s, b.length - e);
  if (x.length + y.length > 40000) return { add: Math.max(0, y.length - x.length) || y.length, del: Math.max(0, x.length - y.length) || x.length };
  let add = 0, del = 0;
  for (const p of diffChars(x, y)) { if (p.added) add += p.value.length; else if (p.removed) del += p.value.length; }
  return { add, del };
}

/** This device's name for version and activity rows (Settings › Devices name, else a guess from the browser). */
export function thisDevice(): string {
  try { const n = localStorage.getItem("lumen.deviceName"); if (n) return n; } catch { /* ignore */ }
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return /Android/i.test(ua) ? (/Mobile/i.test(ua) ? "Android phone" : "Android tablet") : /iPhone/i.test(ua) ? "iPhone" : /iPad/i.test(ua) ? "iPad" : /Mac OS X/i.test(ua) ? "Mac" : /Windows/i.test(ua) ? "Windows PC" : /Linux|CrOS/i.test(ua) ? "Linux PC" : "Browser";
}

// ------------------------------------------------------------------ hints from callers that know more than a diff
type Hint = { action: "reverted" | "duplicated"; ver?: string; from?: string; to?: string };
const hints = new Map<string, Hint>();
const quiet = new Set<string>();
/** The next write of this note is a known action (restore from a version, duplicate) rather than a plain edit. */
export function activityHint(noteId: string, h: Hint) { hints.set(noteId, h); }
/** The next write of this note is automatic (a format conversion): don't log it. */
export function activityQuiet(noteId: string) { quiet.add(noteId); }
/** Latest version saved on this device per note: edit entries point at it, for Preview / Restore to here. */
const lastVer = new Map<string, { id: string; at: number }>();
export function activityVersion(noteId: string, id: string, at: number) {
  lastVer.set(noteId, { id, at });
  if (pending.has(noteId)) return; // the queued flush picks it up
  // A trailing snapshot after the session went quiet: point the open edit entry at it.
  chain = chain.then(async () => {
    const o = await open(noteId, "edited", thisDevice(), at);
    if (o && o.ver !== id && (o.end ?? o.at) <= at) await save("activity", { ...o, ver: id });
  }).catch((e) => console.warn("activity", e));
}

// ------------------------------------------------------------------ queue
interface Pending { before: Note | undefined; after: Note; timer?: ReturnType<typeof setTimeout> }
const pending = new Map<string, Pending>();
let chain: Promise<void> = Promise.resolve();

onNoteSaved((before, after) => {
  if (quiet.delete(after.id) && !pending.has(after.id)) return;
  let p = pending.get(after.id);
  if (p) { p.after = after; clearTimeout(p.timer); } else pending.set(after.id, (p = { before, after }));
  const b = p.before;
  const urgent = !b || hints.has(after.id) || b.deleted !== after.deleted || !!b.shareId !== !!after.shareId || b.published !== after.published;
  p.timer = setTimeout(() => flush(after.id), urgent ? 0 : 1500);
});

function flush(id: string) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  const hint = hints.get(id);
  hints.delete(id);
  chain = chain.then(() => record(p.before, p.after, hint)).catch((e) => console.warn("activity", e));
}
/** Write everything queued now (page hide, tests). */
export function flushActivity() {
  for (const id of [...pending.keys()]) flush(id);
  return chain;
}
if (typeof window !== "undefined") {
  addEventListener("pagehide", () => void flushActivity());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flushActivity(); });
}

// ------------------------------------------------------------------ diff → entries
const BOARD = new Set(["canvas", "whiteboard", "board"]);
/** Markdown text without front-matter and the title line: type/status/tags/title changes live there and get their own entries. */
const prose = (n: Note) => (BOARD.has(n.type) || n.type === "diagram" ? n.body : splitFrontMatter(n.body).body.replace(/^#\s+.*$/m, ""));
const place = (n: Note) => `${n.spaceId}/${n.folderId ?? ""}`;

function boardItems(n: Note): { ids: Set<string>; img: Set<string> } {
  const ids = new Set<string>(), img = new Set<string>();
  try {
    const j = JSON.parse(n.body || "{}");
    if (n.type === "canvas") for (const x of j.nodes ?? []) ids.add(String(x.id));
    else for (const x of j.elements ?? []) if (!x.isDeleted) { ids.add(String(x.id)); if (x.type === "image") img.add(String(x.id)); }
  } catch { /* not valid yet: counts as no items */ }
  return { ids, img };
}
function boardDelta(a: Note, b: Note) {
  const x = boardItems(a), y = boardItems(b);
  let add = 0, del = 0, img = 0;
  for (const i of y.ids) if (!x.ids.has(i)) add++;
  for (const i of x.ids) if (!y.ids.has(i)) del++;
  for (const i of y.img) if (!x.img.has(i)) img++;
  return { add, del, img };
}

type Draft = Omit<Activity, "id" | "updatedAt" | "deleted" | "noteId" | "at" | "device" | "title">;

async function record(before: Note | undefined, after: Note, hint?: Hint) {
  const t = now();
  const ctx = { noteId: after.id, title: after.title, device: thisDevice() };
  const add = (d: Draft) => put({ ...ctx, ...d, at: t, end: t });
  if (!before) {
    const imported = !!(after as Note & { lumenImport?: string }).lumenImport || after.createdAt < t - 60_000;
    await add(hint?.action === "duplicated" ? { action: "duplicated", from: hint.from } : { action: imported ? "imported" : "created" });
    return;
  }
  if (after.deleted && after.title === "(deleted)" && !after.body) return; // deleted forever: purgeNote tombstones the log
  if (hint?.action === "reverted") {
    const d = charDelta(before.body, after.body);
    await add({ action: "reverted", ver: hint.ver, from: hint.from, to: hint.to, add: d.add, del: d.del, unit: "chars" });
    return;
  }
  if (before.deleted !== after.deleted) await add({ action: after.deleted ? "trashed" : "restored" });
  if (!!before.shareId !== !!after.shareId) await add({ action: after.shareId ? "shared" : "unshared" });
  if (before.published !== after.published) await add({ action: after.published ? "published" : "unpublished" });
  if (place(before) !== place(after)) await change("moved", place(before), place(after), ctx, t);
  if (before.type !== after.type) await change("type", before.type, after.type, ctx, t);
  if ((before.status ?? "") !== (after.status ?? "")) await change("status", before.status ?? "", after.status ?? "", ctx, t);
  if (before.title !== after.title) await change("renamed", before.title, after.title, ctx, t);
  const bt = new Set(before.tags ?? []), at = new Set(after.tags ?? []);
  const plus = [...at].filter((x) => !bt.has(x)), minus = [...bt].filter((x) => !at.has(x));
  if (plus.length || minus.length) await tags(plus, minus, ctx, t);
  if (before.body !== after.body && prose(before) !== prose(after)) {
    if (BOARD.has(after.type) && BOARD.has(before.type)) {
      const d = boardDelta(before, after);
      await edit({ add: d.add, del: d.del, img: d.img, unit: after.type === "canvas" ? "cards" : "elements" }, ctx, t);
    } else {
      const d = charDelta(prose(before), prose(after));
      await edit({ add: d.add, del: d.del, unit: "chars" }, ctx, t);
    }
  }
}

/** The open entry of this action (same device, last change within the window, session not too long), if any. */
async function open(noteId: string, action: ActivityAction, device: string, t: number) {
  const rows = await db.activity.where("[noteId+at]").between([noteId, t - SESSION_MAX], [noteId, Dexie.maxKey]).toArray();
  return rows.filter((r) => !r.deleted && r.action === action && r.device === device && (r.end ?? r.at) >= t - ACTIVITY_WINDOW).sort((a, b) => b.at - a.at)[0];
}
type Ctx = { noteId: string; title: string; device: string };
const verFor = (noteId: string, since: number) => { const v = lastVer.get(noteId); return v && v.at >= since - 1000 ? v.id : undefined; };

async function edit(d: { add: number; del: number; img?: number; unit: Activity["unit"] }, ctx: Ctx, t: number) {
  const o = await open(ctx.noteId, "edited", ctx.device, t);
  if (o && o.unit === d.unit) {
    await save("activity", { ...o, title: ctx.title, end: t, add: (o.add ?? 0) + d.add, del: (o.del ?? 0) + d.del, ...(d.img || o.img ? { img: (o.img ?? 0) + (d.img ?? 0) } : {}), ver: verFor(ctx.noteId, o.at) ?? o.ver });
    return;
  }
  await put({ ...ctx, action: "edited", at: t, end: t, add: d.add, del: d.del, unit: d.unit, ...(d.img ? { img: d.img } : {}), ver: verFor(ctx.noteId, t - 5000) });
}
/** from → to changes (rename, move, type, status): a session keeps the first `from`; back to the start = no entry. */
async function change(action: ActivityAction, from: string, to: string, ctx: Ctx, t: number) {
  const o = await open(ctx.noteId, action, ctx.device, t);
  if (!o) return void (await put({ ...ctx, action, at: t, end: t, from, to }));
  if (o.from === to) await tomb(o);
  else await save("activity", { ...o, title: ctx.title, end: t, to });
}
/** Tag changes merge into the session's net result (typing #mach… #machine leaves only "+machine"). */
async function tags(plus: string[], minus: string[], ctx: Ctx, t: number) {
  const o = await open(ctx.noteId, "tagged", ctx.device, t);
  if (!o) return void (await put({ ...ctx, action: "tagged", at: t, end: t, plus, minus }));
  const p = new Set(o.plus ?? []), m = new Set(o.minus ?? []);
  for (const x of plus) { if (m.has(x)) m.delete(x); else p.add(x); }
  for (const x of minus) { if (p.has(x)) p.delete(x); else m.add(x); }
  if (!p.size && !m.size) await tomb(o);
  else await save("activity", { ...o, title: ctx.title, end: t, plus: [...p], minus: [...m] });
}

const tomb = (a: Activity) => save("activity", { id: a.id, noteId: a.noteId, action: a.action, at: a.at, updatedAt: a.updatedAt, deleted: 1 });
async function put(a: Omit<Activity, "id" | "updatedAt" | "deleted">) {
  await save("activity", { ...a, id: uid(), deleted: 0 });
  // Cap: keep the newest entries of this note; older ones become tombstones.
  const live = await db.activity.where("noteId").equals(a.noteId).filter((r) => !r.deleted).toArray();
  if (live.length <= ACTIVITY_CAP) return;
  live.sort((x, y) => x.at - y.at);
  for (const r of live.slice(0, live.length - ACTIVITY_CAP)) await tomb(r);
}

/** Note deleted forever: its log goes too (tombstones). */
export async function purgeActivity(noteId: string) {
  for (const r of await db.activity.where("noteId").equals(noteId).filter((r) => !r.deleted).toArray()) await tomb(r);
}
