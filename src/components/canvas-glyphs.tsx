import { Glyph } from "./Glyph";

/** Canvas icons drawn with the shared round-7 glyph set (same look as whiteboard / architecture). */
const g = (name: string) => function CanvasGlyph({ size = 14, className }: { size?: number; className?: string }) { return <Glyph name={name} size={size} className={className} />; };

export const Download = g("export"), Copy = g("copy"), CopyPlus = g("duplicate"), Pin = g("pin"), Lock = g("lock"), Plus = g("plus"), Minus = g("minus"), Trash2 = g("trash"),
  Search = g("search"), Check = g("check"), ChevronDown = g("chevron-down"), Undo2 = g("undo"), Redo2 = g("redo"), Presentation = g("present"), Network = g("tree"), Orbit = g("graph"),
  Code2 = g("code"), Waypoints = g("diagram"), FileText = g("note"), FilePlus = g("note-card"), Link2 = g("link"), Group = g("group"), Type = g("text"), ImageIcon = g("image"),
  BringToFront = g("bring-front"), SendToBack = g("send-back"), AlignStartVertical = g("align-left"), AlignCenterVertical = g("align-center"), AlignEndVertical = g("align-right"),
  AlignStartHorizontal = g("align-top"), AlignCenterHorizontal = g("align-middle"), AlignEndHorizontal = g("align-bottom"), AlignHorizontalSpaceAround = g("distribute-h"),
  AlignVerticalSpaceAround = g("distribute-v"), MapIcon = g("minimap"), Scan = g("fit"), Ellipsis = g("more"), SquareTerminal = g("script"), LayoutDashboard = g("canvas"),
  Shuffle = g("switch"), Workflow = g("mermaid"), ListTree = g("toc"), GitFork = g("mind-map"), Grid3x3 = g("pattern-grid"), CornerUpLeft = g("undo"), Pencil = g("whiteboard");
