/**
 * Tag links for the graph view (design update 04 §D6). Pure logic, no React.
 * - "nodes":  one node per tag, an edge from each note to each of its tags.
 * - "shared": no tag nodes; faint dashed edges between notes that share a tag. A tag with many notes would turn into a
 *   hairball (n² edges), so each tag contributes at most `perTag` edges: a full clique for small tags, else a ring
 *   through its notes (every note stays connected to the tag's group with 2 edges). Pairs already joined by a link
 *   or by an earlier tag are skipped.
 */
export type TagMode = "off" | "nodes" | "shared";
export interface TagNote { id: string; tags: string[] }
export interface TagEdge { source: string; target: string; tag: string }

/** Notes per tag (exact tag names), only tags used by at least `min` of the given notes. */
export function tagMembers(notes: TagNote[], min = 1): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const n of notes) for (const t of new Set(n.tags)) (m.get(t) ?? m.set(t, []).get(t)!).push(n.id);
  for (const [t, ids] of m) if (ids.length < min) m.delete(t);
  return m;
}

/** Note → tag-node edges. Tag node ids are `#tag`. */
export function tagNodeEdges(notes: TagNote[]): { tags: { id: string; tag: string; count: number }[]; edges: TagEdge[] } {
  const members = tagMembers(notes);
  const tags = [...members].map(([tag, ids]) => ({ id: `#${tag}`, tag, count: ids.length }));
  const edges: TagEdge[] = [];
  for (const [tag, ids] of members) for (const id of ids) edges.push({ source: id, target: `#${tag}`, tag });
  return { tags, edges };
}

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

/** Dashed "shared tag" edges between notes, capped per tag. `linked` = pairs already joined by a real link. */
export function sharedTagEdges(notes: TagNote[], opts: { perTag?: number; linked?: Iterable<[string, string]>; maxTagSize?: number } = {}): TagEdge[] {
  const perTag = opts.perTag ?? 24;
  const seen = new Set<string>();
  for (const [a, b] of opts.linked ?? []) seen.add(pairKey(a, b));
  const out: TagEdge[] = [];
  // Smaller (more specific) tags first: they say more about the pair than a tag on half the vault.
  const members = [...tagMembers(notes, 2)].sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]));
  for (const [tag, ids] of members) {
    if (opts.maxTagSize && ids.length > opts.maxTagSize) continue;
    let added = 0;
    const add = (a: string, b: string) => {
      const k = pairKey(a, b);
      if (seen.has(k) || added >= perTag) return;
      seen.add(k); added++;
      out.push({ source: a, target: b, tag });
    };
    const clique = (ids.length * (ids.length - 1)) / 2 <= perTag;
    if (clique) { for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) add(ids[i], ids[j]); }
    else for (let i = 0; i < ids.length && added < perTag; i++) add(ids[i], ids[(i + 1) % ids.length]);
  }
  return out;
}
