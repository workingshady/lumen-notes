import { Glyph } from "./Glyph";
import { LayoutDashboard, Loader2, Sparkles, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { openExportJob } from "../lib/export-job";
import { mermaidJob } from "../lib/export-jobs";
import type { Note } from "../../shared/types";
import { canvasesWith, diagramFocus, diagramHash, diagramKind, mermaidBlocks, metaOf, placeOnCanvas, renameDiagramWithAI } from "../lib/diagrams";
import { t, tx } from "../lib/i18n";
import { getExtraPrefs } from "../lib/reading-prefs";
import { openNote, setUI, toast, useVault } from "../lib/store";
import { DiagramView } from "./diagram-view";
import { Editor } from "./Editor";
import { relTime } from "./ui";

/**
 * A `.mermaid` file (note type "diagram"), design round 4 (Lumen 17 · R4-17H): Source = the raw Mermaid text,
 * Preview = the diagram on a dot grid with the viewer toolbar, Split = 420 px of source + the preview. A strip on the
 * preview says where it came from (source note › heading) and which canvases show it, with links both ways.
 * The first view follows Settings › Diagrams › "Open .mermaid files in".
 */
export function DiagramFile({ note, mode, wide }: { note: Note; mode: "edit" | "split" | "read"; wide: boolean }) {
  const first = useRef<string | null>(null);
  useEffect(() => {
    if (first.current === note.id) return;
    first.current = note.id;
    const pref = getExtraPrefs().diagramOpenIn;
    if (pref && pref !== mode) setUI({ mode: pref });
  }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (mode === "edit") return <Editor key={note.id} note={note} />;
  if (mode === "split" && wide) {
    return (
      <div className="grid h-full min-h-0 grid-cols-[420px_1fr]">
        <div className="split-editor min-h-0 border-e border-line"><Editor key={note.id} note={note} /></div>
        <DiagramPreview note={note} />
      </div>
    );
  }
  return <DiagramPreview note={note} />;
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
  const chip = "pointer-events-auto inline-flex items-center gap-1 rounded-[6px] border border-line bg-surface/90 px-1.5 py-0.5 hover:bg-surface-2 hover:text-ink";
  const [naming, setNaming] = useState(false);
  const suggest = async () => {
    setNaming(true);
    try { const nm = await renameDiagramWithAI(note, v.notes); toast(nm ? t("Renamed to {name}", { name: nm }) : t("No name suggestion (AI off or over today's limit)")); } finally { setNaming(false); }
  };
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="order-2 min-h-0 flex-1">
        {note.body.trim()
          ? <DiagramView src={note.body} />
          : <div className="flex h-full items-center justify-center text-muted">{t("Empty diagram. Switch to Source and write Mermaid.")}</div>}
      </div>
      <div className="pointer-events-none order-1 flex shrink-0 flex-wrap px-4 py-2.5 items-center justify-end gap-1.5 text-[12px] text-muted">
        <span className="pointer-events-auto rounded-[6px] bg-surface/90 px-1.5 font-mono text-[11.5px]">{diagramKind(note.body)} · {t("updated {when}", { when: relTime(note.updatedAt) })}{meta?.savedAt ? ` · ${t("saved {when}", { when: relTime(Date.parse(meta.savedAt)) })}` : ""}</span>
        {meta ? (
          live ? <button className={chip} onClick={back} title={t("Open the source note at this diagram")}><Undo2 size={12} />{tx("From {title}", { title: <bdi dir="auto">{src!.title}{meta.heading ? ` › ${meta.heading}` : ""}</bdi> })}</button>
            : <span className={chip + " border-dashed"}>{tx("From “{title}” (deleted or renamed)", { title: <bdi dir="auto">{meta.fromTitle}</bdi> })}</span>
        ) : null}
        {drift && <span className={chip + " text-warn"} title={t("The source note's copy is different from this file")}>{t("source changed since saved")}</span>}
        {where.map((w) => (
          <button key={w.canvas.id} className={chip} onClick={() => { diagramFocus.canvas = { canvasId: w.canvas.id, nodeId: w.nodeId }; openNote(w.canvas.id); }}><LayoutDashboard size={12} /><bdi dir="auto">{w.canvas.title}</bdi></button>
        ))}
        {!where.length && <button className={chip} onClick={() => void toCanvas().catch(() => toast(t("Couldn't add it to a canvas")))}><LayoutDashboard size={12} />{t("Add to canvas")}</button>}
        <button className={chip} onClick={() => void suggest()} disabled={naming} title={t("Ask the AI for a short descriptive file name")}>{naming ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}{t("Suggest name")}</button>
        <button className="pointer-events-auto inline-flex h-[30px] items-center gap-1.5 rounded-[8px] bg-accent px-3 text-[13px] font-semibold text-accent-fg hover:brightness-110" onClick={() => openExportJob(mermaidJob(note.body, note.title))} title={t("Export: SVG, PNG, JPEG, WebP")}><Glyph name="export" size={14} />{t("Export")}</button>
      </div>
    </div>
  );
}
