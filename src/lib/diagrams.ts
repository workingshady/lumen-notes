// Diagrams as files. A Mermaid block in a note can be saved as a `.mermaid` file: a note of type "diagram" whose body
// is the raw Mermaid source and whose title is a file name (`c4-system-context.mermaid`). Where it came from is kept
// in its props (source note, heading, line, content hash, saved/updated time) and shown wherever the file appears.
//
// Canvases reference the file with a standard JSON Canvas file node (`{ type: "file", file: "<name>.mermaid" }`), so
// the canvas holds a link, not a copy; the canvas card renders the diagram preview and the metadata.
//   note → file/canvas: under each saved diagram, "Saved as … · In canvas …" (stale → "Update file");
//   file/canvas → note: "↩ <source note>" opens the note scrolled to that diagram.
// One diagram canvas per source note ("<note> · diagrams", same space and folder), created on first use.
import type { CanvasNode, Folder, JsonCanvas, Note } from "../../shared/types";
import { createFolder, createNote, updateNote } from "./actions";
import { getSettings } from "./settings";
import { parseCanvas, stringify } from "./canvas";
import { hash } from "./parse";

export interface DiagramBlock { line: number; src: string; heading: string; kind: string }

/** Every ```mermaid block in a note body: 0-based start line (same as the preview's data-line), source, nearest heading. */
export function mermaidBlocks(body: string): DiagramBlock[] {
  const out: DiagramBlock[] = [];
  const lines = body.split("\n");
  let heading = "", open: { line: number; fence: string; mermaid: boolean; buf: string[] } | null = null;
  lines.forEach((l, i) => {
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
export const diagramKind = (src: string) => (src.split("\n").find((l) => l.trim() && !/^\s*%%/.test(l)) ?? "diagram").trim().split(/\s+/)[0];
export const diagramHash = (src: string) => hash(src.trim());
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48);
/** File name for a diagram: `<heading>.mermaid`, else `<note>-<kind>.mermaid`; unique among `taken` (lower-case titles). */
export function diagramName(noteTitle: string, b: Pick<DiagramBlock, "heading" | "kind">, taken: Set<string> = new Set()) {
  const base = slug(b.heading) || `${slug(noteTitle).slice(0, 30)}-${slug(b.kind)}`.replace(/^-|-$/g, "") || "diagram";
  let name = `${base}.mermaid`, i = 2;
  while (taken.has(name.toLowerCase())) name = `${base}-${i++}.mermaid`;
  return name;
}
export const isDiagramFile = (n: Pick<Note, "type"> | undefined | null): boolean => n?.type === "diagram";
/** A diagram file's body as a fenced block, for the Markdown preview (zoom/export toolbar included). */
export const fenced = (src: string) => `\`\`\`mermaid\n${src.trim()}\n\`\`\``;

// ------------------------------------------------------------------ metadata (note props)
export interface DiagramMeta { from: string; fromTitle: string; heading: string; line: number; hash: string; savedAt: string }
export function metaOf(n: Note): DiagramMeta | null {
  const p = n.props ?? {};
  if (!p.diagramFrom) return null;
  return { from: p.diagramFrom, fromTitle: p.diagramFromTitle ?? "", heading: p.diagramHeading ?? "", line: Number(p.diagramLine) || 0, hash: p.diagramHash ?? "", savedAt: p.diagramSavedAt ?? "" };
}
const metaProps = (src: Note, b: DiagramBlock): Record<string, string> => ({
  diagramFrom: src.id, diagramFromTitle: src.title, diagramHeading: b.heading, diagramLine: String(b.line), diagramHash: diagramHash(b.src), diagramKind: b.kind,
  diagramSavedAt: new Date().toISOString(),
});

// ------------------------------------------------------------------ index: which diagram files came from which note
const idxCache = new WeakMap<Note[], Map<string, Note[]>>();
/** source note id → its saved diagram files. Cached per vault snapshot. */
export function diagramFiles(notes: Note[]): Map<string, Note[]> {
  const hit = idxCache.get(notes);
  if (hit) return hit;
  const out = new Map<string, Note[]>();
  for (const n of notes) {
    if (n.type !== "diagram" || n.deleted) continue;
    const from = n.props?.diagramFrom;
    if (!from) continue;
    out.set(from, [...(out.get(from) ?? []), n]);
  }
  idxCache.set(notes, out);
  return out;
}
/** The saved file for one diagram of a note: same content (fresh) first, else same line (stale: the note changed). */
export function fileFor(index: Map<string, Note[]>, noteId: string, b: DiagramBlock): { file: Note; stale: boolean } | null {
  const list = index.get(noteId) ?? [];
  const h = diagramHash(b.src);
  const same = list.find((f) => f.props?.diagramHash === h || diagramHash(f.body) === h);
  if (same) return { file: same, stale: false };
  const byLine = list.find((f) => Number(f.props?.diagramLine) === b.line);
  return byLine ? { file: byLine, stale: true } : null;
}
/** Canvases that show a diagram file (file nodes pointing at its title). */
export function canvasesWith(notes: Note[], file: Note): { canvas: Note; nodeId: string }[] {
  const out: { canvas: Note; nodeId: string }[] = [];
  const t = file.title.toLowerCase();
  for (const c of notes) {
    if (c.type !== "canvas" || c.deleted || !c.body.toLowerCase().includes(t)) continue;
    const node = (parseCanvas(c.body).canvas.nodes ?? []).find((x) => x.type === "file" && x.file.replace(/\.md$/i, "").split("/").pop()!.toLowerCase() === t);
    if (node) out.push({ canvas: c, nodeId: node.id });
  }
  return out;
}

// ------------------------------------------------------------------ navigation hand-off (in-memory, one shot)
export const diagramFocus: { canvas: { canvasId: string; nodeId: string } | null; note: { noteId: string; line: number; hash: string } | null } = { canvas: null, note: null };

// ------------------------------------------------------------------ where diagram files live
// Like an attachments folder: diagrams saved from notes go to one place instead of mixing with the notes.
//   "sub"   → a `diagrams` subfolder of the note's folder (default; at the space root when the note has no folder)
//   "space" → one `Diagrams` folder at the root of the space
//   "same"  → the note's own folder
export const DIAGRAM_FOLDER = { sub: "diagrams", space: "Diagrams" } as const;
/** The folder for diagram files of a note in `spaceId` / `folderId` (created on first use), or null for "same". */
export async function diagramFolderFor(spaceId: string, folderId: string | null, mode: "sub" | "space" | "same", folders: Folder[]): Promise<string | null> {
  if (mode === "same") return folderId;
  const parentId = mode === "space" ? null : folderId;
  const name = mode === "space" ? DIAGRAM_FOLDER.space : DIAGRAM_FOLDER.sub;
  // Already inside a diagrams folder (e.g. a note kept there)? Use it.
  const here = folderId ? folders.find((f) => f.id === folderId) : undefined;
  if (here && here.name.toLowerCase() === name.toLowerCase()) return here.id;
  const hit = folders.find((f) => !f.deleted && f.spaceId === spaceId && f.parentId === parentId && f.name.toLowerCase() === name.toLowerCase());
  if (hit) return hit.id;
  return (await createFolder(spaceId, parentId, name)).id;
}

// ------------------------------------------------------------------ save
/** Save (or refresh) diagram `b` of note `src` as a `.mermaid` file in the diagram folder. Returns the file note. */
export async function saveDiagramFile(src: Note, b: DiagramBlock, notes: Note[], opts: { name?: string; folders?: Folder[]; mode?: "sub" | "space" | "same" } = {}): Promise<{ file: Note; created: boolean }> {
  const found = fileFor(diagramFiles(notes), src.id, b);
  if (found) {
    if (found.stale || found.file.body.trim() !== b.src.trim() || found.file.props?.diagramLine !== String(b.line)) {
      await updateNote(found.file.id, { body: b.src.trim() + "\n", props: { ...found.file.props, ...metaProps(src, b) } });
    }
    return { file: { ...found.file, body: b.src.trim() + "\n" }, created: false };
  }
  const taken = new Set(notes.filter((n) => !n.deleted).map((n) => n.title.toLowerCase()));
  const title = opts.name ? diagramName(src.title, { heading: opts.name.replace(/\.mermaid$/i, ""), kind: b.kind }, taken) : diagramName(src.title, b, taken);
  const folderId = await diagramFolderFor(src.spaceId, src.folderId, opts.mode ?? getSettings().diagramFolder ?? "sub", opts.folders ?? []);
  const file = await createNote({ type: "diagram", title, body: b.src.trim() + "\n", spaceId: src.spaceId, folderId, tags: ["diagram"], props: metaProps(src, b) });
  return { file, created: true };
}

/** A new, standalone `.mermaid` file (canvas "Diagram" tool, command palette). */
export async function newDiagramFile(where: Pick<Note, "spaceId" | "folderId">, notes: Note[], kind = "flowchart", src = STARTERS.flowchart): Promise<Note> {
  const taken = new Set(notes.filter((n) => !n.deleted).map((n) => n.title.toLowerCase()));
  return createNote({ type: "diagram", title: diagramName("", { heading: kind === "flowchart" ? "diagram" : `${kind}-diagram`, kind }, taken), body: src.trim() + "\n", spaceId: where.spaceId, folderId: where.folderId, tags: ["diagram"] });
}
export const STARTERS: Record<string, string> = {
  flowchart: "flowchart LR\n  A[Start] --> B[Next step]\n  B --> C{Decision}\n  C -->|yes| D[Done]\n  C -->|no| B",
  sequence: "sequenceDiagram\n  participant U as User\n  participant A as App\n  participant S as Server\n  U->>A: Click\n  A->>S: Request\n  S-->>A: Response\n  A-->>U: Show result",
  state: "stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review\n  Review --> Approved\n  Review --> Draft: changes\n  Approved --> [*]",
  class: "classDiagram\n  class Note {\n    +string title\n    +string body\n    +save()\n  }\n  class Canvas\n  Note <|-- Canvas",
  er: "erDiagram\n  USER ||--o{ NOTE : writes\n  NOTE ||--o{ TAG : has\n  NOTE }o--|| SPACE : in",
  gantt: "gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Build\n  Design :a1, 2026-11-18, 3d\n  Build  :after a1, 5d\n  section Ship\n  Release :milestone, 2026-11-30, 0d",
  mindmap: "mindmap\n  root((Topic))\n    Idea A\n      Detail\n    Idea B\n    Idea C",
  timeline: "timeline\n  title Milestones\n  2026-11 : Kick-off\n  2026-12 : Beta\n  2027-01 : Launch",
  pie: "pie showData title Share\n  \"A\" : 45\n  \"B\" : 30\n  \"C\" : 25",
  xychart: "xychart-beta\n  title \"Monthly\"\n  x-axis [Jan, Feb, Mar, Apr]\n  y-axis \"Count\"\n  bar [12, 30, 22, 41]",
  journey: "journey\n  title Sign-up\n  section Visit\n    Open site: 4: User\n    Read docs: 3: User\n  section Join\n    Create account: 5: User",
  architecture: "architecture-beta\n  group api(cloud)[API]\n  service db(database)[Database] in api\n  service server(server)[Server] in api\n  db:L -- R:server",
};

const W = 620, H = 420, GAP = 60, SRC_W = 300;
/**
 * Put a diagram file on a canvas (the source note's diagram canvas, created on first use, unless `canvasId` is given)
 * as a JSON Canvas file node, plus the source note card and an arrow. Already there → returns that node.
 */
export async function placeOnCanvas(file: Note, src: Note | null, notes: Note[], canvasId?: string): Promise<{ canvasId: string; nodeId: string }> {
  const t = file.title.toLowerCase();
  let canvasNote = canvasId ? notes.find((n) => n.id === canvasId) : src ? notes.find((n) => n.type === "canvas" && !n.deleted && n.props?.diagramsFor === src.id) : undefined;
  let canvas: JsonCanvas;
  if (!canvasNote) {
    canvas = { nodes: src ? [{ id: "source", type: "file", file: src.title, x: -(SRC_W + 120), y: 0, width: SRC_W, height: 160, color: "4" }] : [], edges: [] };
    canvasNote = await createNote({ type: "canvas", title: `${src?.title ?? file.title.replace(/\.mermaid$/i, "")} · diagrams`, spaceId: file.spaceId, folderId: file.folderId, props: src ? { diagramsFor: src.id } : {}, body: stringify(canvas) });
  } else canvas = parseCanvas(canvasNote.body).canvas;
  const nodes: CanvasNode[] = (canvas.nodes ??= []);
  const edges = (canvas.edges ??= []);
  const there = nodes.find((x) => x.type === "file" && x.file.replace(/\.md$/i, "").split("/").pop()!.toLowerCase() === t);
  if (there) return { canvasId: canvasNote.id, nodeId: there.id };
  const diagrams = nodes.filter((x) => x.type === "file" && /\.mermaid$/i.test(x.file));
  const i = diagrams.length;
  const id = `dg-${hash(file.id)}`;
  nodes.push({ id, type: "file", file: file.title, x: (i % 2) * (W + GAP), y: Math.floor(i / 2) * (H + GAP), width: W, height: H });
  const srcNode = src && nodes.find((x) => x.type === "file" && x.file === src.title);
  if (srcNode) edges.push({ id: `e-${id}`, fromNode: srcNode.id, fromSide: "right", toNode: id, toSide: "left", toEnd: "arrow", color: "4" });
  await updateNote(canvasNote.id, { body: stringify(canvas) });
  return { canvasId: canvasNote.id, nodeId: id };
}

/** Note diagram → `.mermaid` file → the note's diagram canvas. */
export async function saveDiagramToCanvas(src: Note, b: DiagramBlock, notes: Note[], folders: Folder[] = []) {
  const { file, created } = await saveDiagramFile(src, b, notes, { folders });
  const where = await placeOnCanvas(file, src, created ? [...notes, file] : notes);
  return { ...where, file, created };
}

// ------------------------------------------------------------------ legacy: diagram text cards (first version)
export interface DiagramRef { note: string; line: number; hash: string }
export type DiagramNode = Extract<CanvasNode, { type: "text" }> & { lumenDiagram?: DiagramRef };

/**
 * Upgrade a canvas from the first version (diagram text cards with `lumenDiagram`) to `.mermaid` files: each card
 * becomes a diagram file (with its origin metadata) and the node becomes a file node in the same place and size.
 * Returns true when the canvas changed.
 */
const migrating = new Set<string>();
export async function migrateDiagramCards(canvasNote: Note, notes: Note[], folders: Folder[] = []): Promise<boolean> {
  if (!canvasNote.body.includes("lumenDiagram") || migrating.has(canvasNote.id)) return false;
  migrating.add(canvasNote.id);
  try {
    const { canvas, error } = parseCanvas(canvasNote.body);
    if (error) return false;
    const taken = new Set(notes.filter((n) => !n.deleted).map((n) => n.title.toLowerCase()));
    const byId = new Map(notes.map((n) => [n.id, n]));
    const files = diagramFiles(notes);
    const onCanvas = new Set((canvas.nodes ?? []).filter((x) => x.type === "file").map((x) => (x as Extract<CanvasNode, { type: "file" }>).file.toLowerCase()));
    let changed = false;
    const nodes: CanvasNode[] = [];
    const dropped = new Set<string>();
    for (const n of canvas.nodes ?? []) {
      const d = n.type === "text" && (n as DiagramNode).lumenDiagram ? parseDiagramText(n.text) : null;
      if (!d) { nodes.push(n); continue; }
      const ref = (n as DiagramNode).lumenDiagram!;
      const src = byId.get(ref.note);
      const b = src ? mermaidBlocks(src.body).find((x) => diagramHash(x.src) === ref.hash) ?? mermaidBlocks(src.body).find((x) => x.line === ref.line) : undefined;
      // Already saved as a file (same source diagram)? Reuse it; and if that file is already on this canvas, drop the old card.
      const existing = src && (files.get(src.id) ?? []).find((f) => f.props?.diagramHash === diagramHash(d.src) || diagramHash(f.body) === diagramHash(d.src));
      if (existing) {
        changed = true;
        if (onCanvas.has(existing.title.toLowerCase())) { dropped.add(n.id); continue; }
        const { text: _t, lumenDiagram: _l, ...rest } = n as DiagramNode;
        nodes.push({ ...rest, type: "file", file: existing.title } as CanvasNode);
        onCanvas.add(existing.title.toLowerCase());
        continue;
      }
      const title = diagramName("", { heading: d.name.replace(/\.mermaid$/i, ""), kind: diagramKind(d.src) }, taken);
      taken.add(title.toLowerCase());
      onCanvas.add(title.toLowerCase());
      const props: Record<string, string> = src
        ? { diagramFrom: src.id, diagramFromTitle: src.title, diagramHeading: b?.heading ?? "", diagramLine: String(b?.line ?? ref.line), diagramHash: diagramHash(d.src), diagramKind: diagramKind(d.src), diagramSavedAt: new Date().toISOString() }
        : {};
      const folderId = await diagramFolderFor(canvasNote.spaceId, canvasNote.folderId, getSettings().diagramFolder ?? "sub", folders);
      await createNote({ type: "diagram", title, body: d.src.trim() + "\n", spaceId: canvasNote.spaceId, folderId, tags: ["diagram"], props });
      const { text: _t, lumenDiagram: _l, ...rest } = n as DiagramNode;
      nodes.push({ ...rest, type: "file", file: title } as CanvasNode);
      changed = true;
    }
    if (changed) await updateNote(canvasNote.id, { body: stringify({ ...canvas, nodes, edges: (canvas.edges ?? []).filter((e) => !dropped.has(e.fromNode) && !dropped.has(e.toNode)) }) });
    return changed;
  } finally { migrating.delete(canvasNote.id); }
}
export const diagramText = (name: string, src: string) => `## ${name}\n\n${fenced(src)}`;
/** A text node that is a diagram card: `## name` (optional) + one ```mermaid fence. */
export function parseDiagramText(text: string): { name: string; src: string } | null {
  const m = /^\s*(?:#{1,6}\s+(.+?)\s*\n+)?\s*(`{3,}|~{3,})\s*mermaid[^\n]*\n([\s\S]*?)\n\s*\2\s*$/.exec(text);
  return m ? { name: m[1] ?? "diagram.mermaid", src: m[3] } : null;
}
