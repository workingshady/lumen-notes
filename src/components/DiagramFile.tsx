import { FileText, LayoutDashboard, Undo2 } from "lucide-react";
import type { Note } from "../../shared/types";
import { canvasesWith, diagramFocus, diagramHash, diagramKind, fenced, mermaidBlocks, metaOf, placeOnCanvas } from "../lib/diagrams";
import { openNote, toast, useVault } from "../lib/store";
import { Editor } from "./Editor";
import { Preview } from "./Preview";
import { relTime } from "./ui";

/**
 * A `.mermaid` file (note type "diagram"): Source = the raw Mermaid text, Preview = the zoomable diagram with its
 * export toolbar, Split = both. The header shows where it came from (source note › heading, saved/updated) and
 * which canvases show it, with links both ways.
 */
export function DiagramFile({ note, mode, wide }: { note: Note; mode: "edit" | "split" | "read"; wide: boolean }) {
  if (mode === "edit") return <Editor key={note.id} note={note} />;
  const view = <DiagramPreview note={note} />;
  if (mode === "split" && wide) {
    return (
      <div className="grid h-full grid-cols-2">
        <div className="split-editor min-h-0 border-e border-line bg-surface"><Editor key={note.id} note={note} /></div>
        <div className="min-h-0 overflow-y-auto px-6 py-6">{view}</div>
      </div>
    );
  }
  return <div className={wide ? "h-full overflow-y-auto px-8 py-10" : "h-full overflow-y-auto px-4 py-4"}><div className="mx-auto max-w-[1100px]">{view}</div></div>;
}

function DiagramPreview({ note }: { note: Note }) {
  const v = useVault();
  const meta = metaOf(note);
  const src = meta ? v.byId.get(meta.from) : undefined;
  const live = src && !src.deleted;
  // Is the source note's copy still the same? (it may have been edited after saving)
  const block = live ? mermaidBlocks(src.body).find((b) => diagramHash(b.src) === meta!.hash) ?? mermaidBlocks(src.body).find((b) => b.line === meta!.line) : undefined;
  const drift = block && diagramHash(block.src) !== diagramHash(note.body);
  const where = canvasesWith(v.notes, note);
  const back = () => { if (!src || !meta) return; diagramFocus.note = { noteId: src.id, line: block?.line ?? meta.line, hash: block ? diagramHash(block.src) : meta.hash }; openNote(src.id, "read"); };
  const toCanvas = async () => {
    const r = await placeOnCanvas(note, live ? src! : null, v.notes);
    diagramFocus.canvas = r;
    openNote(r.canvasId);
  };
  const chip = "inline-flex items-center gap-1 rounded-[6px] border border-line px-1.5 py-0.5 hover:bg-surface-2 hover:text-ink";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-muted">
        <span className="inline-flex items-center gap-1.5 font-mono text-[13px] text-ink"><FileText size={14} className="text-accent" />{note.title}</span>
        <span className="rounded-[6px] bg-surface-2 px-1.5 font-mono text-[11.5px]">{diagramKind(note.body)}</span>
        <span>updated {relTime(note.updatedAt)}</span>
        {meta?.savedAt && <span>· saved {relTime(Date.parse(meta.savedAt))}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        {meta ? (
          live ? (
            <button className={chip} onClick={back} title="Open the source note at this diagram"><Undo2 size={12} />From {src!.title}{meta.heading ? ` › ${meta.heading}` : ""}</button>
          ) : <span className="rounded-[6px] border border-dashed border-line px-1.5 py-0.5">From “{meta.fromTitle}” (note deleted or renamed)</span>
        ) : <span>Standalone diagram</span>}
        {drift && <span className="text-warn" title="The source note's copy is different from this file">source note changed since saved</span>}
        {where.map((w) => (
          <button key={w.canvas.id} className={chip} onClick={() => { diagramFocus.canvas = { canvasId: w.canvas.id, nodeId: w.nodeId }; openNote(w.canvas.id); }}><LayoutDashboard size={12} />{w.canvas.title}</button>
        ))}
        {!where.length && <button className={chip} onClick={() => void toCanvas().catch(() => toast("Couldn't add it to a canvas"))}><LayoutDashboard size={12} />Add to canvas</button>}
      </div>
      {note.body.trim()
        // Same boxed viewer as a canvas card: fills the screen height and fits the diagram both ways.
        ? <div className="diagram-node diagram-file overflow-hidden rounded-[10px] border border-line bg-surface" style={{ height: "max(360px, calc(100dvh - 210px))" }}><Preview note={{ id: note.id, body: fenced(note.body), spaceId: note.spaceId }} className="!m-0 !max-w-none" /></div>
        : <div className="rounded-[10px] border border-dashed border-line p-6 text-center text-muted">Empty diagram. Switch to Source and write Mermaid.</div>}
    </div>
  );
}
