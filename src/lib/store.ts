import { liveQuery } from "dexie";
import { useSyncExternalStore } from "react";
import type { Folder, Note, Space } from "../../shared/types";
import { db, DEFAULT_SPACE } from "./db";
import { wikiLinks } from "./parse";
import { scheduleIndex } from "./search";

export type View = "home" | "notes" | "tasks" | "kanban" | "calendar" | "review" | "graph" | "table" | "space" | "settings" | "trash";
export type Mode = "edit" | "split" | "read" | "focus" | "slides" | "review";
export type Panel = null | "outline" | "backlinks" | "properties" | "versions" | "ai";

export interface UI {
  view: View;
  noteId: string | null;
  /** Current space, or "all". */
  spaceId: string;
  folderId: string | null;
  tag: string | null;
  /** Sidebar quick filters: "visual" = canvases + whiteboards, "published" = blog posts. */
  filter: "visual" | "published" | "paths" | null;
  mode: Mode;
  panel: Panel;
  sidebar: boolean;
  list: boolean;
  palette: boolean;
  newSpace: boolean;
  io: boolean;
  history: string[];
}

const KEY = "lumen.ui";
const wide = () => typeof innerWidth === "number" && innerWidth >= 900;
/** Docked full sidebar only from 1200 px; tablets (900–1199) keep the rail and open the sidebar as a drawer. */
const docked = () => typeof innerWidth === "number" && innerWidth >= 1200;
let ui: UI = (() => {
  const base: UI = { view: "home", noteId: null, spaceId: DEFAULT_SPACE, folderId: null, tag: null, filter: null, mode: wide() ? "split" : "read", panel: null, sidebar: docked(), list: true, palette: false, newSpace: false, io: false, history: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<UI>;
    return { ...base, ...saved, palette: false, newSpace: false, io: false, sidebar: docked() ? saved.sidebar ?? true : false, history: [] };
  } catch { return base; }
})();
const subs = new Set<() => void>();
export const useUI = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => ui);
export const getUI = () => ui;
export function setUI(p: Partial<UI> | ((u: UI) => Partial<UI>)) {
  ui = { ...ui, ...(typeof p === "function" ? p(ui) : p) };
  try {
    const { view, noteId, spaceId, folderId, mode, panel, sidebar, list } = ui;
    localStorage.setItem(KEY, JSON.stringify({ view, noteId, spaceId, folderId, mode, panel, sidebar, list }));
  } catch { /* ignore */ }
  subs.forEach((f) => f());
}

export function openNote(id: string, mode?: Mode) {
  setUI((u) => ({
    view: "notes", noteId: id, ...(mode ? { mode } : {}),
    history: u.noteId && u.noteId !== id ? [...u.history.slice(-30), u.noteId] : u.history,
    sidebar: docked() ? u.sidebar : false,
  }));
}
export const go = (view: View, extra: Partial<UI> = {}) => setUI((u) => ({ view, sidebar: docked() ? u.sidebar : false, ...extra }));
export function back() {
  setUI((u) => {
    const prev = u.history[u.history.length - 1];
    return prev ? { noteId: prev, history: u.history.slice(0, -1), view: "notes" } : { noteId: null };
  });
}

// ------------------------------------------------------------------ vault (all live data + derived indexes)
export interface Vault {
  ready: boolean;
  notes: Note[];
  byId: Map<string, Note>;
  byTitle: Map<string, Note>;
  folders: Folder[];
  folderMap: Map<string, Folder>;
  spaces: Space[];
  spaceMap: Map<string, Space>;
  /** note id → ids of notes linking to it */
  backlinks: Map<string, string[]>;
  /** note id → ids of notes it links to (resolved) */
  outlinks: Map<string, string[]>;
  tags: [string, number][];
}

/**
 * Per-note derived data (flashcards, task counts, list previews…), cached by note id + updatedAt.
 * With 10k+ notes, re-parsing every body on each save is what made typing lag; this re-parses only edited notes.
 */
const derivedCache = new Map<string, Map<string, { v: number; r: unknown }>>();
export function noteDerived<T>(kind: string, n: Note, fn: (n: Note) => T): T {
  let m = derivedCache.get(kind);
  if (!m) derivedCache.set(kind, (m = new Map()));
  const hit = m.get(n.id);
  if (hit && hit.v === n.updatedAt) return hit.r as T;
  const r = fn(n);
  m.set(n.id, { v: n.updatedAt, r });
  return r;
}

const linkCache = new Map<string, { v: number; links: string[] }>();
function linksOf(n: Note): string[] {
  const hit = linkCache.get(n.id);
  if (hit && hit.v === n.updatedAt) return hit.links;
  const links = n.type === "canvas" ? canvasFiles(n.body) : n.type === "whiteboard" ? [] : wikiLinks(n.body);
  linkCache.set(n.id, { v: n.updatedAt, links });
  return links;
}

// One shared vault for the whole app. Every useVault() caller reads the same snapshot, so the notes table is
// read from IndexedDB once per change (not once per mounted component) and the derived maps are built once.
// Full-text indexing runs in the background (scheduleIndex), never inside render: with ~12k notes it takes seconds.
let rawNotes: Note[] | undefined, rawFolders: Folder[] | undefined, rawSpaces: Space[] | undefined;
let vaultSnap: Vault = buildVault(undefined, undefined, undefined);
const vaultSubs = new Set<() => void>();
let vaultStarted = false;
function startVault() {
  if (vaultStarted) return;
  vaultStarted = true;
  const rebuild = () => { vaultSnap = buildVault(rawNotes, rawFolders, rawSpaces); vaultSubs.forEach((f) => f()); };
  const watch = <T,>(q: () => Promise<T>, set: (v: T) => void) =>
    liveQuery(q).subscribe({ next: (v) => { set(v); rebuild(); }, error: (e) => console.error("vault query failed", e) });
  watch(() => db.notes.toArray(), (v) => { rawNotes = v; scheduleIndex(v.filter((n) => !n.deleted)); });
  watch(() => db.folders.toArray(), (v) => { rawFolders = v; });
  watch(() => db.spaces.toArray(), (v) => { rawSpaces = v; });
}
const subscribeVault = (f: () => void) => { vaultSubs.add(f); return () => { vaultSubs.delete(f); }; };

export function useVault(): Vault {
  startVault();
  return useSyncExternalStore(subscribeVault, () => vaultSnap);
}

function buildVault(notes: Note[] | undefined, folders: Folder[] | undefined, spaces: Space[] | undefined): Vault {
  {
    const live = (notes ?? []).filter((n) => !n.deleted);
    const byId = new Map((notes ?? []).map((n) => [n.id, n]));
    const byTitle = new Map(live.map((n) => [n.title.toLowerCase(), n]));
    const outlinks = new Map<string, string[]>();
    const backlinks = new Map<string, string[]>();
    const tagCount = new Map<string, number>();
    for (const n of live) {
      const outs = linksOf(n).map((t) => byTitle.get(t.toLowerCase())?.id).filter((x): x is string => !!x && x !== n.id);
      outlinks.set(n.id, [...new Set(outs)]);
      for (const o of new Set(outs)) backlinks.set(o, [...(backlinks.get(o) ?? []), n.id]);
      for (const t of n.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    }
    const liveFolders = (folders ?? []).filter((f) => !f.deleted);
    const liveSpaces = (spaces ?? []).filter((s) => !s.deleted).sort((a, b) => a.sort - b.sort);
    return {
      ready: !!notes && !!folders && !!spaces,
      notes: live, byId, byTitle, folders: liveFolders, folderMap: new Map(liveFolders.map((f) => [f.id, f])),
      spaces: liveSpaces, spaceMap: new Map(liveSpaces.map((s) => [s.id, s])), backlinks, outlinks,
      tags: [...tagCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    };
  }
}

function canvasFiles(body: string): string[] {
  try {
    return ((JSON.parse(body) as { nodes?: { type: string; file?: string }[] }).nodes ?? []).filter((n) => n.type === "file" && n.file).map((n) => n.file!.replace(/\.md$/i, ""));
  } catch { return []; }
}

/** Notes visible in the current scope (space / folder / tag). */
export function scoped(v: Vault, u: Pick<UI, "spaceId" | "folderId" | "tag"> & { filter?: UI["filter"] }) {
  return v.notes.filter((n) => (u.spaceId === "all" || n.spaceId === u.spaceId) && (!u.folderId || n.folderId === u.folderId) && (!u.tag || n.tags.includes(u.tag))
    && (!u.filter || (u.filter === "visual" ? n.type === "canvas" || n.type === "whiteboard" : u.filter === "paths" ? n.type === "path" : !!n.published)));
}

// ------------------------------------------------------------------ toasts
/** Toast icon (design: 06b states + component sheet). Inferred from the text when not given. */
export type ToastIcon = "trash" | "merge" | "globe" | "link" | "history" | "check" | "error" | "offline" | "info" | "copy" | "none";
export interface Toast {
  id: number; text: string; action?: { label: string; run: () => void };
  /** Muted second line (e.g. conflict: "From Pixel 8 at 21:39 · the other is in history"). */
  sub?: string; icon?: ToastIcon; ms: number; at: number;
  /** Action button style: "link" (teal text, conflict "View other") or "button" (bordered, Undo ⌘Z). */
  actionStyle?: "link" | "button";
}
export interface ToastOpts { sub?: string; icon?: ToastIcon; ms?: number; actionStyle?: "link" | "button" }
let toasts: Toast[] = [];
const tsubs = new Set<() => void>();
export const useToasts = () => useSyncExternalStore((f) => (tsubs.add(f), () => tsubs.delete(f)), () => toasts);
function inferIcon(text: string, action?: Toast["action"]): ToastIcon {
  if (/trash|deleted/i.test(text)) return "trash";
  if (/unpublish|published|blog/i.test(text)) return "globe";
  if (/link/i.test(text)) return "link";
  if (/version|restored/i.test(text)) return "history";
  if (/cop(y|ied)/i.test(text)) return "copy";
  if (/fail|error|couldn|not available|can't|cannot/i.test(text)) return "error";
  if (/offline/i.test(text)) return "offline";
  return action ? "info" : "check";
}
export function dismissToast(id: number) { toasts = toasts.filter((x) => x.id !== id); tsubs.forEach((f) => f()); }
export function toast(text: string, action?: Toast["action"], opts: ToastOpts = {}) {
  const undo = action && /undo/i.test(action.label);
  const ms = opts.ms ?? (undo ? 8000 : action ? 6000 : 3000);
  const t: Toast = { id: Date.now() + Math.random(), text, action, sub: opts.sub, icon: opts.icon ?? inferIcon(text, action), ms, at: Date.now(), actionStyle: opts.actionStyle ?? (undo ? "button" : "link") };
  toasts = [...toasts.slice(-2), t];
  tsubs.forEach((f) => f());
  setTimeout(() => dismissToast(t.id), ms);
  return t.id;
}
/** Ctrl/⌘ Z outside editors runs the newest Undo toast. */
export function runLatestUndo() {
  const t = [...toasts].reverse().find((x) => x.action && /undo/i.test(x.action.label));
  if (!t) return false;
  t.action!.run();
  dismissToast(t.id);
  return true;
}
