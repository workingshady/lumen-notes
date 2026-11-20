// Model features (48G–48I): reused objects across diagrams, C4 zoom levels, and version diff from History.
import type { Note, Version } from "../../shared/types";
import { db, uid } from "./db";
import { updateNote } from "./actions";
import { withDsl } from "./arch-dsl";
import { displayOf, isArchBody, isGroup, nameOf, parseArch, stringifyArch, type ANode, type ArchCanvas, type LumenNode } from "./arch-model";

export const archNotes = (notes: Note[]) => notes.filter((n) => !n.deleted && n.type === "canvas" && isArchBody(n.body));

export interface ModelObject { key: string; ref?: string; node: ANode; noteId: string; noteTitle: string; used: number }
/** Every node across all diagrams, one entry per reused object (same `ref`) or per unshared node. */
export function listObjects(notes: Note[]): ModelObject[] {
  const byRef = new Map<string, ModelObject>(), loose: ModelObject[] = [];
  for (const n of archNotes(notes)) {
    const c = parseArch(n.body);
    if (!c) continue;
    for (const x of c.nodes) {
      if (isGroup(x) || x.lumenNode?.kind === "junction") continue;
      const ref = x.lumenNode?.ref;
      if (ref) {
        const o = byRef.get(ref);
        if (o) { o.used++; if (n.updatedAt > (notes.find((m) => m.id === o.noteId)?.updatedAt ?? 0)) Object.assign(o, { node: x, noteId: n.id, noteTitle: n.title }); }
        else byRef.set(ref, { key: ref, ref, node: x, noteId: n.id, noteTitle: n.title, used: 1 });
      } else loose.push({ key: `${n.id}:${x.id}`, node: x, noteId: n.id, noteTitle: n.title, used: 1 });
    }
  }
  return [...byRef.values(), ...loose];
}
/** How many diagrams contain the object `ref`. */
export function usedIn(notes: Note[], ref: string | undefined): number {
  if (!ref) return 0;
  return archNotes(notes).filter((n) => n.body.includes(`"ref": "${ref}"`) || n.body.includes(`"ref":"${ref}"`)).length;
}
/** Make sure the source node has a ref (so a linked insert stays linked), returning it. */
export async function ensureRef(o: ModelObject, notes: Note[]): Promise<string> {
  if (o.ref) return o.ref;
  const ref = `obj-${uid().slice(0, 8)}`;
  const src = notes.find((n) => n.id === o.noteId);
  const c = src && parseArch(src.body);
  if (src && c) {
    const id = o.key.split(":")[1];
    const next = withDsl({ ...c, nodes: c.nodes.map((n) => (n.id === id ? { ...n, lumenNode: { ...(n.lumenNode ?? {}), ref } } : n)) });
    await updateNote(src.id, { body: stringifyArch(next) });
  }
  return ref;
}
const SHARED: (keyof LumenNode)[] = ["icon", "kind", "tech", "status", "owner", "description", "links", "tags", "cost", "sla"];
/** Edits to a reused object update every other diagram that holds it (name, tech, owner…; never positions). */
export async function propagate(node: ANode, notes: Note[], exceptNoteId: string): Promise<number> {
  const ref = node.lumenNode?.ref;
  if (!ref) return 0;
  let count = 0;
  for (const n of archNotes(notes)) {
    if (n.id === exceptNoteId) continue;
    const c = parseArch(n.body);
    if (!c || !c.nodes.some((x) => x.lumenNode?.ref === ref)) continue;
    const next = withDsl({ ...c, nodes: c.nodes.map((x) => {
      if (x.lumenNode?.ref !== ref || x.type !== "text" || node.type !== "text") return x;
      const ln: LumenNode = { ...x.lumenNode };
      for (const k of SHARED) { const v = node.lumenNode?.[k]; if (v === undefined) delete ln[k]; else (ln as Record<string, unknown>)[k] = v; }
      return { ...x, text: node.text, lumenNode: ln };
    }) });
    const body = stringifyArch(next);
    if (body !== n.body) { await updateNote(n.id, { body }); count++; }
  }
  return count;
}

// ------------------------------------------------------------------ C4 levels
const NEXT: Record<string, "container" | "component"> = { context: "container", container: "component" };
/** The C4 level a diagram stands for: its own `c4` block, else Context for a C4 diagram and Container for an architecture one. */
export const c4LevelOf = (c: ArchCanvas): "context" | "container" | "component" => c.lumenArch.c4?.level ?? (c.lumenArch.kind === "c4" ? "context" : "container");
const hasZoom = (c: ArchCanvas) => c.nodes.some((n) => !!n.lumenNode?.zoom);
/** Nodes you can open one level deeper: systems and containers (not people, stores, queues or notes). */
export function canZoom(c: ArchCanvas, n: ANode): boolean {
  if (isGroup(n) || !NEXT[c4LevelOf(c)]) return false;
  if (n.lumenNode?.zoom) return true;
  const i = n.lumenNode?.icon ?? "service";
  return /^(service|server|api|container|pod|function|worker|gateway|external-system|cluster|llm|model)$/.test(i);
}
export const C4_LABEL = { context: "Context", container: "Container", component: "Component" } as const;
/** Chain of diagrams from the top level down to this one (for the breadcrumb). */
export function c4Chain(notes: Note[], note: Note): { note: Note; level: "context" | "container" | "component" }[] {
  const out: { note: Note; level: "context" | "container" | "component" }[] = [];
  let cur: Note | undefined = note, guard = 0;
  while (cur && guard++ < 6) {
    const c = parseArch(cur.body);
    // a plain architecture diagram with drill-downs is the Container level of its chain
    const level = c?.lumenArch.c4?.level ?? (c && (out.length || hasZoom(c)) ? c4LevelOf(c) : null);
    if (!c || !level) break;
    out.unshift({ note: cur, level });
    if (!c.lumenArch.c4) break;
    const pid: string | undefined = c.lumenArch.c4.parent;
    cur = pid ? notes.find((n) => n.id === pid && !n.deleted) : undefined;
  }
  return out;
}
/** Double-click a container: open its diagram one level deeper, creating it (linked both ways) the first time. */
export async function zoomInto(note: Note, c: ArchCanvas, node: ANode): Promise<string | null> {
  const level = c4LevelOf(c);
  const next = NEXT[level];
  if (!next || isGroup(node)) return null;
  const existing = node.lumenNode?.zoom && (await db.notes.get(node.lumenNode.zoom));
  if (existing && !existing.deleted) return existing.id;
  const { createArchNote } = await import("./arch-starters");
  const nm = displayOf(node);
  const dsl = next === "container"
    ? `direction right\n${JSON.stringify(nm)} [icon: region] {\n  Web [icon: browser, tech: "SPA"]\n  API [icon: service]\n  DB [icon: database]\n}\nWeb > API: JSON/HTTPS\nAPI > DB: SQL (data)\n`
    : `direction right\n${JSON.stringify(nm)} [icon: container] {\n  Controller [icon: api]\n  Service [icon: service]\n  Repository [icon: database]\n}\nController > Service\nService > Repository (data)\n`;
  const child = await createArchNote("c4", note, { title: `${nm} · ${C4_LABEL[next].toLowerCase()}s`, dsl, c4: { level: next, parent: note.id, parentNode: node.id } });
  const fresh = parseArch((await db.notes.get(note.id))?.body ?? "") ?? c;
  await updateNote(note.id, { body: stringifyArch({ ...fresh, nodes: fresh.nodes.map((n) => (n.id === node.id ? { ...n, lumenNode: { ...(n.lumenNode ?? {}), zoom: child.id } } : n)) }) });
  return child.id;
}

// ------------------------------------------------------------------ versions
export async function archVersions(noteId: string): Promise<Version[]> {
  const all = await db.versions.where("noteId").equals(noteId).filter((v) => !v.deleted && !!parseArch(v.body)).toArray();
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
export const nodeName = nameOf;
