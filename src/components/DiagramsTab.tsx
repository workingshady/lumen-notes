import { Code2, Columns2, Download, FileText, LayoutDashboard, Loader2, Square, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Note } from "../../shared/types";
import { openDiagramExport } from "../lib/diagram-export";
import { canvasesWith, diagramFiles, diagramFocus, diagramHash, diagramName, fileFor, mermaidBlocks, saveDiagramToCanvas, type DiagramBlock } from "../lib/diagrams";
import { t, tx } from "../lib/i18n";
import { openNote, setUI, toast, useVault } from "../lib/store";
import { DiagramView } from "./diagram-view";
import { Glyph } from "./Glyph";
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
      toast(t("{n} diagram saved to the canvas|{n} diagrams saved to the canvas", { n: blocks.length }), last ? { label: t("Open canvas"), run: () => { diagramFocus.canvas = last; openNote(last!.canvasId); } } : undefined);
    } finally { setBusy(false); }
  };

  if (!blocks.length) return <div className="flex h-full items-center justify-center text-muted">{tx("No Mermaid diagrams in this note yet. Add a {fence} block in Edit.", { fence: <code className="mx-1" dir="ltr">```mermaid</code> })}</div>;
  return (
    <div className={cx("h-full overflow-y-auto", wide ? "px-8 py-6" : "px-4 py-4")}>
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <Glyph name="diagram" size={16} />
          <span className="font-semibold">{t("{n} diagram|{n} diagrams", { n: blocks.length })}</span>
          <span className="text-muted">{tx("in “{title}”", { title: <bdi dir="auto">{note.title}</bdi> })}</span>
          <span className="flex-1" />
          {wide && (
            <div className="flex rounded-[8px] border border-line p-0.5">
              {([1, 2] as const).map((c) => (
                <button key={c} title={c === 1 ? t("One per row") : t("Two per row")} onClick={() => { setCols(c); try { localStorage.setItem(COLS_KEY, String(c)); } catch { /* ignore */ } }}
                  className={cx("flex size-7 items-center justify-center rounded-[6px]", cols === c ? "bg-surface-2 text-ink" : "text-muted hover:text-ink")}>{c === 1 ? <Square size={14} /> : <Columns2 size={14} />}</button>
              ))}
            </div>
          )}
          <Button size="sm" onClick={() => void saveAll()} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <LayoutDashboard size={14} />}{t("Save all to canvas")}</Button>
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
        <span className="min-w-0 truncate font-mono text-[12.5px] text-ink" dir="auto">{name}</span>
        <span className="rounded-[5px] bg-surface-2 px-1.5 font-mono text-[11px] text-muted">{b.kind}</span>
        {b.heading && <span className="min-w-0 truncate text-[12px] text-muted">§ {b.heading}</span>}
        {found?.stale && <span className="text-[11.5px] text-warn">{t("changed since saved")}</span>}
        <span className="flex-1" />
        <button className={btn} title={t("Show it in the note")} onClick={jump}><Undo2 size={13} />{t("In note")}</button>
        <button className={btn} title={t("Export: SVG, PNG, JPEG, WebP")} onClick={() => openDiagramExport(b.src, name)}><Download size={13} />{t("Export")}</button>
        <button className={btn} title={where.length ? t("Open on its canvas") : t("Save to canvas")} onClick={() => void toCanvas()}><LayoutDashboard size={13} />{where.length ? t("Canvas") : t("To canvas")}</button>
        {found && <button className={btn} title={t("Open {title}", { title: found.file.title })} onClick={() => openNote(found.file.id, "read")}><FileText size={13} />{t("File")}</button>}
        <button className={btn} title={t("Copy Mermaid source")} aria-label={t("Copy Mermaid source")} onClick={() => void navigator.clipboard.writeText(b.src).then(() => toast(t("Source copied")))}><Code2 size={13} /></button>
      </div>
      <div style={{ height: tall ? "min(70vh, 640px)" : 380 }}>
        <DiagramView src={b.src} />
      </div>
    </div>
  );
}
