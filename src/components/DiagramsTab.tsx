import { Code2, Columns2, Download, FileText, LayoutDashboard, Loader2, Square, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { openDiagramExport } from "../lib/diagram-export";
import { canvasesWith, diagramFiles, diagramFocus, diagramHash, diagramName, fenced, fileFor, mermaidBlocks, saveDiagramToCanvas, type DiagramBlock } from "../lib/diagrams";
import { openNote, setUI, toast, useVault } from "../lib/store";
import { Preview } from "./Preview";
import { Button, cx } from "./ui";

const COLS_KEY = "lumen.diagramCols";

/**
 * Diagrams tab (next to Edit / Split / Read): every Mermaid block of the note as a gallery of zoomable previews,
 * each with jump-to-in-note, export, save/open on canvas, open file and copy source.
 */
export function DiagramsTab({ note, wide }: { note: Note; wide: boolean }) {
  const v = useVault();
  const blocks = useMemo(() => mermaidBlocks(note.body), [note.body]);
  const [cols, setCols] = useState<1 | 2>(() => { try { return localStorage.getItem(COLS_KEY) === "2" ? 2 : 1; } catch { return 1; } });
  const [busy, setBusy] = useState(false);
  const index = diagramFiles(v.notes);
  const two = wide && cols === 2;

  const saveAll = async () => {
    setBusy(true);
    try {
      let notes = v.notes, last: { canvasId: string; nodeId: string } | null = null;
      for (const b of blocks) { const r = await saveDiagramToCanvas({ ...note }, b, notes, v.folders); last = r; notes = [...notes, r.file]; }
      toast(`${blocks.length} diagram${blocks.length === 1 ? "" : "s"} saved to the canvas`, last ? { label: "Open canvas", run: () => { diagramFocus.canvas = last; openNote(last!.canvasId); } } : undefined);
    } finally { setBusy(false); }
  };

  if (!blocks.length) return <div className="flex h-full items-center justify-center text-muted">No Mermaid diagrams in this note yet. Add a <code className="mx-1">```mermaid</code> block in Edit.</div>;
  return (
    <div className={cx("h-full overflow-y-auto", wide ? "px-8 py-6" : "px-4 py-4")}>
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="font-semibold">{blocks.length} diagram{blocks.length === 1 ? "" : "s"}</span>
          <span className="text-muted">in “{note.title}”</span>
          <span className="flex-1" />
          {wide && (
            <div className="flex rounded-[8px] border border-line p-0.5">
              {([1, 2] as const).map((c) => (
                <button key={c} title={c === 1 ? "One per row" : "Two per row"} onClick={() => { setCols(c); try { localStorage.setItem(COLS_KEY, String(c)); } catch { /* ignore */ } }}
                  className={cx("flex size-7 items-center justify-center rounded-[6px]", cols === c ? "bg-surface-2 text-ink" : "text-muted hover:text-ink")}>{c === 1 ? <Square size={14} /> : <Columns2 size={14} />}</button>
              ))}
            </div>
          )}
          <Button size="sm" onClick={() => void saveAll()} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <LayoutDashboard size={14} />}Save all to canvas</Button>
        </div>
        <div className={cx("grid gap-4", two ? "grid-cols-2" : "grid-cols-1")}>
          {blocks.map((b) => <DiagramItem key={`${b.line}:${diagramHash(b.src)}`} note={note} b={b} found={fileFor(index, note.id, b)} tall={!two} />)}
        </div>
      </div>
    </div>
  );
}

function DiagramItem({ note, b, found, tall }: { note: Note; b: DiagramBlock; found: { file: Note; stale: boolean } | null; tall: boolean }) {
  const v = useVault();
  const name = found?.file.title ?? diagramName(note.title, b);
  const where = found ? canvasesWith(v.notes, found.file) : [];
  const body = useMemo(() => fenced(b.src), [b.src]);
  const box = useRef<HTMLDivElement>(null);
  // Name the card so its own toolbar export uses the diagram name.
  useEffect(() => { box.current?.querySelectorAll<HTMLElement>(".mermaid-card").forEach((c) => { c.dataset.name = name; }); });
  const jump = () => { diagramFocus.note = { noteId: note.id, line: b.line, hash: diagramHash(b.src) }; setUI({ mode: "read" }); };
  const toCanvas = async () => {
    const r = await saveDiagramToCanvas({ ...note }, b, v.notes, v.folders);
    diagramFocus.canvas = { canvasId: r.canvasId, nodeId: r.nodeId };
    openNote(r.canvasId);
  };
  const btn = "flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[12px] text-muted hover:bg-surface-2 hover:text-ink";
  return (
    <div className="flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-2">
        <span className="min-w-0 truncate font-mono text-[12.5px] text-ink">{name}</span>
        <span className="rounded-[5px] bg-surface-2 px-1.5 font-mono text-[11px] text-muted">{b.kind}</span>
        {b.heading && <span className="min-w-0 truncate text-[12px] text-muted">§ {b.heading}</span>}
        {found?.stale && <span className="text-[11.5px] text-warn">changed since saved</span>}
        <span className="flex-1" />
        <button className={btn} title="Show it in the note" onClick={jump}><Undo2 size={13} />In note</button>
        <button className={btn} title="Export: SVG, PNG, JPEG, WebP" onClick={() => openDiagramExport(b.src, name)}><Download size={13} />Export</button>
        <button className={btn} title={where.length ? "Open on its canvas" : "Save to canvas"} onClick={() => void toCanvas()}><LayoutDashboard size={13} />{where.length ? "Canvas" : "To canvas"}</button>
        {found && <button className={btn} title={`Open ${found.file.title}`} onClick={() => openNote(found.file.id, "read")}><FileText size={13} />File</button>}
        <button className={btn} title="Copy Mermaid source" onClick={() => void navigator.clipboard.writeText(b.src).then(() => toast("Source copied"))}><Code2 size={13} /></button>
      </div>
      <div ref={box} className="diagram-node" style={{ height: tall ? "min(70vh, 640px)" : 380 }}>
        <Preview note={{ id: `${note.id}#dg${b.line}`, body, spaceId: note.spaceId }} className="!m-0 !max-w-none" />
      </div>
    </div>
  );
}
