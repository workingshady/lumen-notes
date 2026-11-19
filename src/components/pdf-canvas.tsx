// Canvas cards for PDFs. Both are standard JSON Canvas nodes, rendered specially:
//  - a text node whose text is `> quote` (or `![…](att:…)`) + `[[Paper#^hl-id|Paper · p. 4]]` → highlight card
//    (colored left edge, quote or image, page chip that opens the reader at the highlight);
//  - a file node pointing at a `type: pdf` note (optional subpath `#page=4`) → PDF card that opens the reader.
import { FileText } from "lucide-react";
import type { CanvasNode, Note } from "../../shared/types";
import { colorOf } from "../lib/canvas";
import { hlCanvasNode, pageOfSubpath, parseHighlights, pdfMeta, type Highlight } from "../lib/pdf-format";
import { HL_MIME, setPdfJump } from "../lib/pdf-note";
import { openNote, toast, useVault } from "../lib/store";
import { t } from "../lib/i18n";
import { Glyph } from "./Glyph";
import { AttImg } from "./pdf-rail";

const box = (n: CanvasNode, selected: boolean, edge?: string) => ({
  className: "box-border flex h-full w-full flex-col overflow-hidden rounded-[10px] bg-surface",
  style: {
    border: selected ? "2px solid var(--accent)" : "1px solid var(--border)",
    borderInlineStart: `${selected ? 2 : 4}px solid ${edge ?? colorOf(n.color) ?? "var(--border)"}`,
    boxShadow: selected ? "0 0 0 4px color-mix(in srgb,var(--accent) 16%,transparent)" : "none",
  },
});

export function PdfHighlightCard({ n, card, selected }: { n: CanvasNode; card: { quote: string; image?: string; title: string; id: string; page: number }; selected: boolean }) {
  const v = useVault();
  const pdf = v.byTitle.get(card.title.toLowerCase());
  const open = () => {
    if (!pdf) { toast(t("“{title}” isn't in this vault", { title: card.title })); return; }
    setPdfJump(pdf.id, card.page, card.id);
    openNote(pdf.id, "read");
  };
  return (
    <div className="box-border flex h-full w-full flex-col overflow-hidden rounded-[10px] bg-surface"
      style={{ border: selected ? "2px solid var(--accent)" : "1px solid var(--border)", boxShadow: selected ? "0 0 0 4px color-mix(in srgb,var(--accent) 16%,transparent)" : "none" }}>
      <div className="h-1 shrink-0" style={{ background: colorOf(n.color) ?? "var(--border)" }} />
      <div className="nowheel flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto px-3 py-2.5">
        {card.image ? <AttImg src={card.image} className="max-h-full w-full rounded-[4px] object-contain" /> : <span dir="auto" className="text-[14px] leading-5 text-ink" style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}>“{card.quote}”</span>}
        <button className="nodrag flex min-w-0 items-center gap-1.5 self-start text-[11.5px] text-muted hover:text-ink" title={t("Open the PDF at this highlight")} onClick={open}>
          <Glyph name="pdf" size={12} color="var(--danger)" /><span className="truncate" dir="auto">{card.title} · {card.page ? t("p. {n}", { n: card.page }) : t("p. ?")}</span>
        </button>
      </div>
    </div>
  );
}

export function PdfFileCard({ n, note, selected }: { n: Extract<CanvasNode, { type: "file" }>; note: Note; selected: boolean }) {
  const meta = pdfMeta(note.body);
  const hs = parseHighlights(note.body).length;
  const at = pageOfSubpath(n.subpath) || meta.page;
  const s = box(n, selected, "var(--danger)");
  return (
    <div {...s}>
      <div className="flex h-[30px] shrink-0 items-center gap-1.5 border-b border-line px-2.5 text-[11.5px] text-muted">
        <FileText size={12} className="shrink-0 text-bad" /><span className="flex-1 truncate">{meta.pages ? t("PDF · {n} page|PDF · {n} pages", { n: meta.pages }) : "PDF"}</span><span>{t("{n} highlight|{n} highlights", { n: hs })}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2.5">
        <button dir="auto" className="nodrag truncate text-start text-[14px] font-[650] hover:text-accent" onClick={() => { setPdfJump(note.id, at); openNote(note.id, "read"); }}>{note.title}</button>
        <div className="h-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-accent" style={{ width: `${meta.progress}%` }} /></div>
        <button className="nodrag self-start text-[12px] text-link" onClick={() => { setPdfJump(note.id, at); openNote(note.id, "read"); }}>{t("Open at p. {n}", { n: at })}</button>
      </div>
    </div>
  );
}

/** A highlight dragged from the reader's panel → the node to add on drop (null if it isn't one). */
export function hlDropNode(dt: DataTransfer): Extract<CanvasNode, { type: "text" }> | null {
  try {
    const raw = dt.getData(HL_MIME);
    if (!raw) return null;
    const { title, h } = JSON.parse(raw) as { title: string; h: Highlight };
    return hlCanvasNode(title, h, 0, 0, "");
  } catch { return null; }
}
export { HL_MIME };
