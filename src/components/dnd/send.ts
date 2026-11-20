// "Send to…" (brief §12.4/§12.5): the menu path for every drag. Targets: any mounted drop zone, or another visual note
// (canvas / whiteboard / Board) that gets the item appended without being opened.
import type { CanvasEdge, CanvasNode, Note } from "../../../shared/types";
import { updateNote } from "../../lib/actions";
import { parseCanvas, stringify } from "../../lib/canvas";
import { describe, showChip, type DndPayload } from "../../lib/dnd";
import { t } from "../../lib/i18n";
import { build } from "./canvas-drop";
import { sendToWhiteboardNote } from "./wb-drop";

/** Append the payload to another note's visual body. Returns false when that note type can't take it. */
export async function sendToNote(p: DndPayload, note: Note): Promise<boolean> {
  const label = describe(p).label;
  const before = note.body;
  if (note.type === "canvas") {
    const c = parseCanvas(note.body).canvas;
    const nodes = c.nodes ?? [];
    const x = nodes.length ? Math.max(...nodes.map((n) => n.x + n.width)) + 60 : 0;
    const y = nodes.length ? Math.min(...nodes.map((n) => n.y)) : 0;
    const added: { n: CanvasNode[]; e: CanvasEdge[] } = { n: [], e: [] };
    const b = await build({ add: (n, e) => { added.n.push(...n); added.e.push(...e); }, update: () => undefined, noteId: note.id, nodes: () => nodes, undo: () => undefined }, p.kind === "files" ? { kind: "text", text: p.files.map((f) => f.name).join(", ") } : p, { x, y }, false);
    if (b) { added.n.push(...b.nodes); added.e.push(...(b.edges ?? [])); }
    if (!added.n.length) return false;
    await updateNote(note.id, { body: stringify({ ...c, nodes: [...nodes, ...added.n], edges: [...(c.edges ?? []), ...added.e] }) });
  } else if (note.type === "whiteboard" || note.type === "board") {
    const r = await sendToWhiteboardNote(p.kind === "files" ? { kind: "text", text: p.files.map((f) => f.name).join(", ") } : p, note.body, note.type, note.id);
    if (!r) return false;
    await updateNote(note.id, { body: r.body });
  } else return false;
  showChip(t("Sent {name} to {board} · Undo", { name: label, board: note.title }), () => { void updateNote(note.id, { body: before }); });
  return true;
}
