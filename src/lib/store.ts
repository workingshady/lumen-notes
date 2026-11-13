import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useSyncExternalStore } from "react";
import type { Folder, Note, Space } from "../../shared/types";
import { db, DEFAULT_SPACE } from "./db";
import { wikiLinks } from "./parse";
import { updateIndex } from "./search";

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
let ui: UI = (() => {
  const base: UI = { view: "home", noteId: null, spaceId: DEFAULT_SPACE, folderId: null, tag: null, mode: wide() ? "split" : "read", panel: null, sidebar: wide(), list: true, palette: false, newSpace: false, io: false, history: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<UI>;
    return { ...base, ...saved, palette: false, newSpace: false, io: false, sidebar: wide() ? saved.sidebar ?? true : false, history: [] };
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
    sidebar: wide() ? u.sidebar : false,
  }));
}
export const go = (view: View, extra: Partial<UI> = {}) => setUI((u) => ({ view, sidebar: wide() ? u.sidebar : false, ...extra }));
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

export function useVault(): Vault {
  const notes = useLiveQuery(() => db.notes.toArray(), []);
  const folders = useLiveQuery(() => db.folders.toArray(), []);
  const spaces = useLiveQuery(() => db.spaces.toArray(), []);
  return useMemo(() => {
    const live = (notes ?? []).filter((n) => !n.deleted);
    updateIndex(live);
    const byId = new Map((notes ?? []).map((n) => [n.id, n]));
    const byTitle = new Map(live.map((n) => [n.title.toLowerCase(), n]));
    const outlinks = new Map<string, string[]>();
    const backlinks = new Map<string, string[]>();
    const tagCount = new Map<string, number>();
    for (const n of live) {
      const outs = (n.type === "canvas" ? canvasFiles(n.body) : wikiLinks(n.body)).map((t) => byTitle.get(t.toLowerCase())?.id).filter((x): x is string => !!x && x !== n.id);
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
  }, [notes, folders, spaces]);
}

function canvasFiles(body: string): string[] {
  try {
    return ((JSON.parse(body) as { nodes?: { type: string; file?: string }[] }).nodes ?? []).filter((n) => n.type === "file" && n.file).map((n) => n.file!.replace(/\.md$/i, ""));
  } catch { return []; }
}

/** Notes visible in the current scope (space / folder / tag). */
export function scoped(v: Vault, u: Pick<UI, "spaceId" | "folderId" | "tag">) {
  return v.notes.filter((n) => (u.spaceId === "all" || n.spaceId === u.spaceId) && (!u.folderId || n.folderId === u.folderId) && (!u.tag || n.tags.includes(u.tag)));
}

// ------------------------------------------------------------------ toasts
export interface Toast { id: number; text: string; action?: { label: string; run: () => void } }
let toasts: Toast[] = [];
const tsubs = new Set<() => void>();
export const useToasts = () => useSyncExternalStore((f) => (tsubs.add(f), () => tsubs.delete(f)), () => toasts);
export function toast(text: string, action?: Toast["action"]) {
  const t = { id: Date.now() + Math.random(), text, action };
  toasts = [...toasts, t];
  tsubs.forEach((f) => f());
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== t.id); tsubs.forEach((f) => f()); }, action ? 6000 : 3000);
}
