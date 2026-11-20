// The conversion matrix (Lumen 52 · §13.1): every source to every other, always as a copy.
import { tk } from "../i18n";
import type { NoteType } from "../../../shared/types";

export type Workspace = "whiteboard" | "board" | "canvas" | "architecture" | "mermaid" | "graph" | "note";
export type Target = Exclude<Workspace, "graph">;
export const WORKSPACES: Workspace[] = ["whiteboard", "board", "canvas", "architecture", "mermaid", "graph", "note"];
export const WS_LABEL: Record<Workspace, string> = { whiteboard: tk("Whiteboard"), board: tk("Board"), canvas: tk("Canvas"), architecture: tk("Architecture"), mermaid: tk("Mermaid"), graph: tk("Graph"), note: tk("Note") };
/** Convert-menu row label and glyph of a target (design 40H). */
export const TARGET: Record<Target, { label: string; glyph: string }> = {
  whiteboard: { label: tk("Whiteboard"), glyph: "whiteboard" }, board: { label: tk("Board"), glyph: "board" }, canvas: { label: tk("Canvas"), glyph: "canvas" },
  architecture: { label: tk("Architecture diagram"), glyph: "diagram" }, mermaid: { label: tk("Mermaid file"), glyph: "mermaid" }, note: { label: tk("Note (Markdown)"), glyph: "note" },
};
/** Note type of what a conversion creates. */
export const TARGET_TYPE: Record<Target, NoteType> = { whiteboard: "whiteboard", board: "board", canvas: "canvas", architecture: "canvas", mermaid: "diagram", note: "note" };
export const TARGET_SUFFIX: Record<Target, string> = { whiteboard: tk("whiteboard"), board: tk("board"), canvas: tk("canvas"), architecture: tk("diagram"), mermaid: tk("mermaid"), note: tk("outline") };

/** Matrix cell (the short phrase in 52B) and the full "kept / lost" text the menu shows for the selected target. */
export interface Path { cell: string; kept: string; lost?: string }
const P = (cell: string, kept: string, lost?: string): Path => ({ cell: tk(cell), kept: tk(kept), lost: lost ? tk(lost) : undefined });

export const MATRIX: Partial<Record<Workspace, Partial<Record<Target, Path>>>> = {
  whiteboard: {
    board: P("all kept", "Everything kept: ink, shapes, text and images come across unchanged."),
    canvas: P("text shapes → cards", "Shapes with text become cards, arrows become edges. Ink becomes one image card.", "Handwriting is no longer editable."),
    architecture: P("ink → AI · shapes → nodes", "Shapes with text become nodes, bound arrows become edges.", "Ink is left out."),
    mermaid: P("best effort", "Flowchart-like parts only: labelled shapes and the arrows between them.", "Ink, pictures and loose drawings."),
    note: P("outline", "Text and images as an outline, frames as headings.", "Drawings."),
  },
  board: {
    whiteboard: P("ink + shapes", "Ink and shapes stay. Note, Mermaid, link and PDF cards become labelled boxes.", "Live cards no longer update."),
    canvas: P("cards + edges · ink as image", "Note cards become file cards, link cards link cards, Mermaid cards diagram text, arrows edges. Ink becomes one image card."),
    architecture: P("cards → nodes", "Cards and labelled shapes become nodes, arrows become edges.", "Ink and pictures."),
    mermaid: P("best effort", "Flowchart-like parts only.", "Ink, pictures and cards without arrows."),
    note: P("outline + links", "Text as an outline, note cards as [[links]], Mermaid blocks, link cards and arrows as connections.", "Drawings."),
  },
  canvas: {
    whiteboard: P("cards → shapes", "Cards become boxes with their text, edges become bound arrows, groups become frames.", "Markdown formatting inside cards."),
    board: P("yes", "Note cards stay live, link cards get previews, Mermaid cards render, groups become frames."),
    architecture: P("kinds guessed", "Cards become nodes (icon and kind guessed from the name), edges stay.", "Card colours and Markdown bodies."),
    mermaid: P("flowchart", "A flowchart of the cards and their edges.", "Card text beyond the first line."),
    note: P("outline", "The tree of cards as an outline; note cards as [[links]].", "Card positions."),
  },
  architecture: {
    whiteboard: P("sketch style", "Nodes and edges as hand-drawn boxes and arrows.", "Icons, status and the code view."),
    board: P("yes", "Nodes and edges as boxes and bound arrows.", "Icons, status and the code view."),
    canvas: P("plain cards", "Plain cards and edges, no architecture data.", "Icons, kinds and the code view."),
    mermaid: P("arch-beta · ER · C4", "The diagram as Mermaid in the matching flavour (architecture-beta, ER, C4, flowchart or sequence)."),
    note: P("table + Mermaid", "A table of the nodes plus the Mermaid source."),
  },
  mermaid: {
    whiteboard: P("editable shapes", "Nodes and arrows as editable shapes.", "The Mermaid source stays only in the original."),
    board: P("card or shapes", "A live Mermaid card that flips to edit, linked to the file."),
    canvas: P("cards + edges", "Flowchart nodes become cards, links edges. Other diagram types come across as one Mermaid card."),
    architecture: P("parsed to nodes", "Parsed to nodes and edges.", "Styling and unsupported syntax."),
    note: P("mermaid block", "A note with the diagram in a mermaid block."),
  },
  graph: {
    board: P("notes + edges", "Notes as live cards, links as arrows, layout kept."),
    canvas: P("layout kept", "Notes as file cards, links as edges, layout kept."),
    mermaid: P("flowchart of links", "A flowchart of the links."),
    note: P("list of links", "A note listing every link."),
  },
  note: {
    board: P("Send to board", "The note as a live card with the notes it links to around it, joined by arrows."),
    canvas: P("outline → canvas", "Headings and bullets become a tree of cards.", "Text under the headings."),
    architecture: P("Make a diagram · AI", "Asks AI to draw the system the note describes.", "Needs your Cloudflare account."),
    mermaid: P("/diagram", "The outline as a Mermaid flowchart."),
  },
};

/** Targets offered for a source, in menu order (the design's: Board / Canvas / Architecture / Mermaid / Note, plus Whiteboard). */
export function targetsOf(src: Workspace): Target[] {
  const m = MATRIX[src] ?? {};
  return (["whiteboard", "board", "canvas", "architecture", "mermaid", "note"] as Target[]).filter((t) => m[t]);
}
export const pathOf = (src: Workspace, to: Target): Path | undefined => MATRIX[src]?.[to];
