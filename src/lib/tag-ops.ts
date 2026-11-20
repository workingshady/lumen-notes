/**
 * Tag operations (design R6-30O tag ⋯ menu + tag page): rename (also "Merge into…" and "Move under…"), delete,
 * add to many notes, colour, pin. Every change rewrites the tag where it is written (inline `#tag` in the body and the
 * front-matter `tags:` list) and goes through updateNote(), so the record, sync and search follow.
 * Each bulk operation returns an undo function that puts the previous bodies/tags back. Format: docs/TAGS.md.
 */
import type { Note } from "../../shared/types";
import { updateNote } from "./actions";
import { db, patch } from "./db";
import { fmList, setFrontMatter, splitFrontMatter } from "./parse";
import { readTagMeta, serializeTagMeta, TAG_PROP, TAG_SPACE, underTag, type TagMeta } from "./tag-tree";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isMd = (n: Note) => !["canvas", "whiteboard", "board", "diagram"].includes(n.type);

/** Map one tag path through a rename (`from` → `to`, children follow) or a delete (`to` = null drops it and its children). */
export function mapTag(tag: string, from: string, to: string | null): string | null {
  if (!underTag(tag, from)) return tag;
  return to === null ? null : to + tag.slice(from.length);
}

/** Rewrite one Markdown body: inline `#from` / `#from/child` tokens (outside fenced code) and the front-matter list. */
export function rewriteTagInBody(body: string, from: string, to: string | null): string {
  const { data } = splitFrontMatter(body);
  let out = body;
  if (data.tags !== undefined) {
    const list = fmList(data.tags);
    const next = [...new Set(list.map((t) => mapTag(t, from, to)).filter((t): t is string => !!t))];
    if (next.join() !== list.join()) out = setFrontMatter(out, { tags: next });
  }
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(out)?.[0] ?? "";
  const rest = out.slice(fm.length);
  // `(^|\s)#from` followed by end, a non-tag character, or `/child`
  const re = to === null
    ? new RegExp(`(^|[ \\t])#${esc(from)}(?:/[\\p{L}\\p{N}_/-]*)?(?![\\p{L}\\p{N}_/-])`, "gimu")
    : new RegExp(`(^|\\s)#${esc(from)}(?![\\p{L}\\p{N}_-])`, "giu");
  const parts = rest.split(/(```[\s\S]*?```)/g); // odd indexes = fenced code: left alone
  const body2 = parts.map((p, i) => (i % 2 ? p : to === null ? p.split("\n").map((l) => { const l2 = l.replace(re, "$1"); return l2 === l ? l : l2.replace(/[ \t]{2,}/g, " ").replace(/ ([,.;:!?])/g, "$1").replace(/[ \t]+$/, ""); }).join("\n") : p.replace(re, `$1#${to}`))).join("");
  return fm + body2;
}

/** Notes that carry `tag` or a tag nested under it. */
export async function notesWithTag(tag: string): Promise<Note[]> {
  return (await db.notes.toArray()).filter((n) => !n.deleted && n.tags.some((t) => underTag(t, tag)));
}

type Snap = { id: string; body: string; tags: string[] };
const restore = async (snaps: Snap[]) => { for (const s of snaps) { const n = await db.notes.get(s.id); if (!n) continue; await (isMd(n) ? updateNote(s.id, { body: s.body }) : updateNote(s.id, { tags: s.tags })); } };

async function rewrite(notes: Note[], from: string, to: string | null): Promise<Snap[]> {
  const snaps: Snap[] = [];
  for (const n of notes) {
    snaps.push({ id: n.id, body: n.body, tags: n.tags });
    const tags = [...new Set(n.tags.map((t) => mapTag(t, from, to)).filter((t): t is string => !!t))];
    if (isMd(n)) {
      const body = rewriteTagInBody(n.body, from, to);
      // tags that only lived on the record (not written in the body) are written to the front-matter
      const fmTags = fmList(splitFrontMatter(body).data.tags);
      const missing = tags.filter((t) => !fmTags.includes(t) && !new RegExp(`(^|\\s)#${esc(t)}(?![\\p{L}\\p{N}_/-])`, "iu").test(splitFrontMatter(body).body));
      await updateNote(n.id, { body: missing.length ? setFrontMatter(body, { tags: [...fmTags, ...missing] }) : body });
    } else await updateNote(n.id, { tags });
  }
  return snaps;
}

/** Rename `from` → `to` in every note (children follow: #ml/llm/rag → #ai/llm/rag). Also used by Merge into / Move under. */
export async function renameTag(from: string, to: string): Promise<{ count: number; undo: () => Promise<void> }> {
  if (!to || from === to || underTag(to, from)) return { count: 0, undo: async () => {} };
  const notes = await notesWithTag(from);
  const snaps = await rewrite(notes, from, to);
  const meta0 = await getMeta();
  await setMeta((m) => {
    const colors: Record<string, string> = {};
    for (const [k, v] of Object.entries(m.colors)) { const k2 = mapTag(k, from, to)!; if (k2 === k || !(k2 in m.colors)) colors[k2] = v; }
    return { colors, pinned: [...new Set(m.pinned.map((p) => mapTag(p, from, to)!))] };
  });
  return { count: notes.length, undo: async () => { await restore(snaps); await setMeta(() => meta0); } };
}

/** Remove a tag (and its nested tags) from every note. */
export async function deleteTag(tag: string): Promise<{ count: number; undo: () => Promise<void> }> {
  const notes = await notesWithTag(tag);
  const snaps = await rewrite(notes, tag, null);
  const meta0 = await getMeta();
  await setMeta((m) => ({ colors: Object.fromEntries(Object.entries(m.colors).filter(([k]) => !underTag(k, tag))), pinned: m.pinned.filter((p) => !underTag(p, tag)) }));
  return { count: notes.length, undo: async () => { await restore(snaps); await setMeta(() => meta0); } };
}

/** Add `tag` to each note (bulk bar "Tag", picker). Markdown notes get it in the front-matter list. */
export async function addTagToNotes(ids: string[], tag: string): Promise<{ count: number; undo: () => Promise<void> }> {
  const snaps: Snap[] = [];
  for (const id of ids) {
    const n = await db.notes.get(id);
    if (!n || n.deleted || n.tags.includes(tag)) continue;
    snaps.push({ id, body: n.body, tags: n.tags });
    if (isMd(n)) { const fmTags = fmList(splitFrontMatter(n.body).data.tags); await updateNote(id, { body: setFrontMatter(n.body, { tags: [...fmTags, tag] }) }); }
    else await updateNote(id, { tags: [...n.tags, tag] });
  }
  return { count: snaps.length, undo: () => restore(snaps) };
}

/** Remove one tag from one note (× on a chip in the tag picker). */
export async function removeTagFromNote(id: string, tag: string) {
  const n = await db.notes.get(id);
  if (!n) return;
  if (isMd(n)) await updateNote(id, { body: rewriteTagInBody(n.body, tag, null) });
  else await updateNote(id, { tags: n.tags.filter((t) => t !== tag) });
}

// ------------------------------------------------------------------ meta (colours + pins)
async function getMeta(): Promise<TagMeta> { return readTagMeta((await db.spaces.get(TAG_SPACE))?.props?.[TAG_PROP]); }
async function setMeta(fn: (m: TagMeta) => TagMeta) {
  const sp = await db.spaces.get(TAG_SPACE);
  if (!sp) return;
  await patch("space", TAG_SPACE, { props: { ...(sp.props ?? {}), [TAG_PROP]: serializeTagMeta(fn(readTagMeta(sp.props?.[TAG_PROP]))) } });
}
/** Set (or clear with null) a tag's colour: a preset key "1".."6" or a CSS colour. */
export const setTagColor = (tag: string, color: string | null) => setMeta((m) => { const colors = { ...m.colors }; if (color) colors[tag] = color; else delete colors[tag]; return { ...m, colors }; });
/** Pin / unpin a tag to the top of the sidebar's tag section. */
export const toggleTagPin = (tag: string) => setMeta((m) => ({ ...m, pinned: m.pinned.includes(tag) ? m.pinned.filter((p) => p !== tag) : [...m.pinned, tag] }));
