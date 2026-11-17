// Diagram ↔ canvas: a Mermaid block in a note can be "saved to canvas". It becomes a diagram card in the note's
// diagram canvas ("<note> · diagrams", one per note, same space/folder), named like a file (`c4-system-context.mermaid`),
// with a note card for the source and an arrow to each diagram. Links work both ways:
//   note → canvas: a footer under the diagram ("In canvas: …") opens the canvas centred on that card;
//   canvas → note: the card header "↩ note" opens the note scrolled to that diagram.
// Stored as plain JSON Canvas: a text node whose text is `## name.mermaid` + a ```mermaid fence. The link back is
// `lumenDiagram: { note, line, hash }` on the node (extra keys are allowed; Lumen-only fields use the lumen* prefix).
import type { CanvasNode, JsonCanvas, Note } from "../../shared/types";
import { createNote, updateNote } from "./actions";
import { parseCanvas, stringify } from "./canvas";
import { hash } from "./parse";

export interface DiagramBlock { line: number; src: string; heading: string; kind: string }
export interface DiagramRef { note: string; line: number; hash: string }
export type DiagramNode = Extract<CanvasNode, { type: "text" }> & { lumenDiagram?: DiagramRef };

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
/** File-like name for a diagram: `<heading>.mermaid`, else `<note>-<kind>.mermaid`; unique within `taken`. */
export function diagramName(note: Pick<Note, "title">, b: DiagramBlock, taken: Set<string> = new Set()) {
  const base = slug(b.heading) || `${slug(note.title).slice(0, 30)}-${slug(b.kind)}` || "diagram";
  let name = `${base}.mermaid`, i = 2;
  while (taken.has(name)) name = `${base}-${i++}.mermaid`;
  return name;
}
export const diagramText = (name: string, src: string) => `## ${name}\n\n\`\`\`mermaid\n${src.trim()}\n\`\`\``;
/** A text node that is a diagram card: `## name` (optional) + one ```mermaid fence. */
export function parseDiagramText(text: string): { name: string; src: string } | null {
  const m = /^\s*(?:#{1,6}\s+(.+?)\s*\n+)?\s*(`{3,}|~{3,})\s*mermaid[^\n]*\n([\s\S]*?)\n\s*\2\s*$/.exec(text);
  return m ? { name: m[1] ?? "diagram.mermaid", src: m[3] } : null;
}

// ------------------------------------------------------------------ index: which diagrams are on which canvas
export interface DiagramLink { canvas: Note; nodeId: string; name: string; ref: DiagramRef; src: string }
const idxCache = new WeakMap<Note[], Map<string, DiagramLink[]>>();
/** source note id → diagram cards that point back to it (any canvas). Cached per vault snapshot. */
export function diagramIndex(notes: Note[]): Map<string, DiagramLink[]> {
  const hit = idxCache.get(notes);
  if (hit) return hit;
  const out = new Map<string, DiagramLink[]>();
  for (const c of notes) {
    if (c.type !== "canvas" || c.deleted || !c.body.includes("lumenDiagram")) continue;
    const { canvas } = parseCanvas(c.body);
    for (const n of (canvas.nodes ?? []) as DiagramNode[]) {
      if (n.type !== "text" || !n.lumenDiagram?.note) continue;
      const d = parseDiagramText(n.text);
      if (!d) continue;
      const list = out.get(n.lumenDiagram.note) ?? [];
      list.push({ canvas: c, nodeId: n.id, name: d.name, ref: n.lumenDiagram, src: d.src });
      out.set(n.lumenDiagram.note, list);
    }
  }
  idxCache.set(notes, out);
  return out;
}
/** The canvas card for one diagram of a note: same content first (fresh), else same line (stale: the note changed). */
export function linkFor(index: Map<string, DiagramLink[]>, noteId: string, b: DiagramBlock): (DiagramLink & { stale: boolean }) | null {
  const list = index.get(noteId) ?? [];
  const h = diagramHash(b.src);
  const same = list.find((l) => diagramHash(l.src) === h);
  if (same) return { ...same, stale: false };
  const byLine = list.find((l) => l.ref.line === b.line);
  return byLine ? { ...byLine, stale: true } : null;
}

// ------------------------------------------------------------------ navigation hand-off (in-memory, one shot)
export const diagramFocus: { canvas: { canvasId: string; nodeId: string } | null; note: { noteId: string; line: number; hash: string } | null } = { canvas: null, note: null };

// ------------------------------------------------------------------ save a note's diagram to its canvas
const W = 620, H = 400, GAP = 60, SRC_W = 300;
/**
 * Put diagram `b` of `note` on the note's diagram canvas (created on first use) and return where it is.
 * Already there (same content or same line) → the card is refreshed with the note's current source.
 */
export async function saveDiagramToCanvas(note: Note, b: DiagramBlock, notes: Note[]): Promise<{ canvasId: string; nodeId: string; created: boolean }> {
  const existing = linkFor(diagramIndex(notes), note.id, b);
  const ref: DiagramRef = { note: note.id, line: b.line, hash: diagramHash(b.src) };
  if (existing) {
    const { canvas } = parseCanvas(existing.canvas.body);
    const nodes = (canvas.nodes ?? []) as DiagramNode[];
    const n = nodes.find((x) => x.id === existing.nodeId);
    if (n && (existing.stale || n.lumenDiagram?.line !== b.line)) {
      n.text = diagramText(existing.name, b.src);
      n.lumenDiagram = ref;
      await updateNote(existing.canvas.id, { body: stringify(canvas) });
    }
    return { canvasId: existing.canvas.id, nodeId: existing.nodeId, created: false };
  }
  let canvasNote = notes.find((n) => n.type === "canvas" && !n.deleted && n.props?.diagramsFor === note.id);
  let canvas: JsonCanvas;
  if (!canvasNote) {
    canvas = { nodes: [{ id: "source", type: "file", file: note.title, x: -(SRC_W + 120), y: 0, width: SRC_W, height: 160, color: "4" }], edges: [] };
    canvasNote = await createNote({ type: "canvas", title: `${note.title} · diagrams`, spaceId: note.spaceId, folderId: note.folderId, props: { diagramsFor: note.id }, body: stringify(canvas) });
  } else canvas = parseCanvas(canvasNote.body).canvas;
  const nodes = (canvas.nodes ??= []);
  const edges = (canvas.edges ??= []);
  const diagrams = nodes.filter((n): n is DiagramNode => n.type === "text" && !!(n as DiagramNode).lumenDiagram);
  const taken = new Set(diagrams.map((n) => parseDiagramText(n.text)?.name ?? ""));
  const i = diagrams.length;
  const id = `dg-${hash(note.id + ":" + ref.hash)}`;
  nodes.push({ id, type: "text", text: diagramText(diagramName(note, b, taken), b.src), x: (i % 2) * (W + GAP), y: Math.floor(i / 2) * (H + GAP), width: W, height: H, lumenDiagram: ref } as DiagramNode);
  const src = nodes.find((n) => n.type === "file" && n.file === note.title);
  if (src) edges.push({ id: `e-${id}`, fromNode: src.id, fromSide: "right", toNode: id, toSide: "left", toEnd: "arrow", color: "4" });
  await updateNote(canvasNote.id, { body: stringify(canvas) });
  return { canvasId: canvasNote.id, nodeId: id, created: i === 0 };
}
