/**
 * Nested tags (design R6 · Tags): `#ml/llm/rag` is one tag whose path has three levels. This module builds the tree
 * (with counts rolled up to every parent), resolves tag colours (own colour, else the nearest coloured ancestor) and
 * reads the synced tag metadata (colours + pins).
 *
 * Storage (docs/TAGS.md): JSON in the Inbox space record, `space.props.lumenTagMeta`:
 *   {"colors": {"ml": "6", "arabic": "5"}, "pinned": ["arabic"]}
 * Colours are preset keys "1".."6" (the 6 JSON Canvas presets, lib/canvas PRESETS) or a CSS colour. It syncs like any
 * space edit, so every device sees the same colours and pins.
 */
import { useMemo } from "react";
import { colorOf, PRESETS } from "./canvas";
import { go, useVault } from "./store";

export interface TagNode { name: string; path: string; count: number; color: string | null; children: TagNode[]; pinned: boolean }
export interface TagMeta { colors: Record<string, string>; pinned: string[] }

export const TAG_SPACE = "inbox";
export const TAG_PROP = "lumenTagMeta";
/** The 6 colour presets in design order (red, orange, yellow, green, cyan, purple) as stored keys. */
export const TAG_PRESET_KEYS = ["1", "2", "3", "4", "5", "6"] as const;
export const presetColor = (k: string) => PRESETS[k] ?? k;

export function readTagMeta(raw: string | undefined | null): TagMeta {
  if (!raw) return { colors: {}, pinned: [] };
  try {
    const o = JSON.parse(raw) as Partial<TagMeta>;
    const colors: Record<string, string> = {};
    if (o && typeof o.colors === "object" && o.colors) for (const [k, v] of Object.entries(o.colors)) if (typeof v === "string" && v) colors[k.toLowerCase()] = v;
    const pinned = Array.isArray(o?.pinned) ? o!.pinned.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()) : [];
    return { colors, pinned: [...new Set(pinned)] };
  } catch { return { colors: {}, pinned: [] }; }
}
export const serializeTagMeta = (m: TagMeta) => JSON.stringify({ colors: m.colors, pinned: m.pinned });

/** Tag colours + pins (synced, Inbox space props). Colours are stored values: resolve with tagColor(). */
export function useTagMeta(): TagMeta {
  const v = useVault();
  const raw = v.spaceMap.get(TAG_SPACE)?.props?.[TAG_PROP];
  return useMemo(() => readTagMeta(raw), [raw]);
}

/** Parent paths of a tag: "a/b/c" → ["a", "a/b"]. */
export const tagAncestors = (path: string) => { const p = path.split("/"); return p.slice(0, -1).map((_, i) => p.slice(0, i + 1).join("/")); };
/** Is `tag` the same as `path` or nested under it? */
export const underTag = (tag: string, path: string) => tag === path || tag.startsWith(path + "/");
/** Resolved CSS colour of a tag: its own, else its nearest coloured ancestor, else null. */
export function tagColor(path: string, colors: Record<string, string> = {}): string | null {
  for (let p: string | undefined = path; p; p = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : undefined) if (colors[p]) return colorOf(colors[p]) ?? null;
  return null;
}

/**
 * Nested tag tree from flat `[tag, count]` pairs (the vault's `tags`). Parents that only exist through children are
 * created; each node's count = its own notes + its children's counts (rolled up). Order: pinned first, then by count.
 */
export function tagTree(tags: [string, number][], colors?: Record<string, string>, pinned: string[] = []): TagNode[] {
  const pin = new Set(pinned);
  const nodes = new Map<string, TagNode & { own: number }>();
  const get = (path: string) => {
    let n = nodes.get(path);
    if (!n) { n = { name: path.slice(path.lastIndexOf("/") + 1), path, count: 0, own: 0, color: tagColor(path, colors), children: [], pinned: pin.has(path) }; nodes.set(path, n); }
    return n;
  };
  for (const [tag, count] of tags) {
    const path = tag.replace(/^#/, "").replace(/\/+$/, "").toLowerCase();
    if (!path) continue;
    get(path).own += count;
    for (const a of tagAncestors(path)) get(a);
  }
  const roots: TagNode[] = [];
  for (const n of nodes.values()) {
    const i = n.path.lastIndexOf("/");
    if (i < 0) roots.push(n); else get(n.path.slice(0, i)).children.push(n);
  }
  const finish = (list: TagNode[]): TagNode[] => {
    for (const n of list) { finish(n.children); n.count = (n as TagNode & { own: number }).own + n.children.reduce((s, c) => s + c.count, 0); }
    list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.count - a.count || a.path.localeCompare(b.path));
    for (const n of list) delete (n as Partial<TagNode & { own: number }>).own;
    return list;
  };
  return finish(roots);
}
/** Find one node by path in a tree. */
export function findTag(tree: TagNode[], path: string): TagNode | null {
  for (const n of tree) { if (n.path === path) return n; if (path.startsWith(n.path + "/")) return findTag(n.children, path); }
  return null;
}

/**
 * Fuzzy tag match on the whole path (tag picker R6-30P): a contiguous hit scores best (earlier and at a segment start
 * is better), else the letters in order. Returns the hit range for highlighting.
 */
export interface TagHit { tag: string; count: number; score: number; from: number; to: number }
export function fuzzyTags(query: string, tags: [string, number][], limit = 8): TagHit[] {
  const q = query.replace(/^#/, "").toLowerCase().trim();
  const out: TagHit[] = [];
  for (const [tag, count] of tags) {
    if (!q) { out.push({ tag, count, score: count, from: 0, to: 0 }); continue; }
    const i = tag.indexOf(q);
    if (i >= 0) {
      const seg = i === 0 || tag[i - 1] === "/";
      // a typed parent path ("ml/to") reads as context: only the part after its last "/" is highlighted
      out.push({ tag, count, score: 1000 - i * 4 + (seg ? 200 : 0) + Math.min(count, 99) / 100, from: i + q.lastIndexOf("/") + 1, to: i + q.length });
      continue;
    }
    // "ml/to" also offers tags whose own segment starts with "to" (#tools), below the full-path hits
    const leaf = q.slice(q.lastIndexOf("/") + 1);
    if (leaf && leaf !== q) {
      const k = tag.split("/").findIndex((s) => s.startsWith(leaf));
      if (k >= 0) { const at = tag.split("/").slice(0, k).join("/").length + (k ? 1 : 0); out.push({ tag, count, score: 400 - k * 10 + Math.min(count, 99) / 100, from: at, to: at + leaf.length }); continue; }
    }
    // letters in order (subsequence): highlight the span from the first to the last matched letter
    let j = 0, first = -1, last = -1;
    for (let k = 0; k < tag.length && j < q.length; k++) if (tag[k] === q[j]) { if (first < 0) first = k; last = k; j++; }
    if (j === q.length && q.length > 1) out.push({ tag, count, score: 100 - (last - first), from: first, to: last + 1 });
  }
  return out.sort((a, b) => b.score - a.score || b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, limit);
}

/** Valid tag path from typed text ("#ML/ To " → "ml/to"); null when nothing usable is left. */
export function cleanTag(s: string): string | null {
  const t = s.trim().replace(/^#+/, "").toLowerCase().replace(/\s*\/\s*/g, "/").replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_/-]/gu, "").replace(/\/{2,}/g, "/").replace(/^\/|\/$/g, "");
  return t && !/^\d+$/.test(t) ? t : null;
}

/** Open the tag page (R6-30M) for a tag path: the main pane shows the tag; opening a note from it shows the list filtered by the tag. */
export const openTag = (tag: string) => go("notes", { tag: tag.replace(/^#/, "").toLowerCase(), noteId: null, spaceId: "all", folderId: null, filter: null });
