import {
  addEdge, Background, BackgroundVariant, ConnectionMode, Handle, MiniMap, NodeResizer, Position, ReactFlow, ReactFlowProvider,
  useEdgesState, useNodesState, useReactFlow, useViewport, type Connection, type Edge, type Node as RFNode, type NodeChange, type NodeProps,
} from "@xyflow/react";
import {
  ArrowRight, Code2, CornerUpLeft, Copy, Download, Ellipsis, Pin, RotateCw, FilePlus, FileText, GitFork, Group, LayoutDashboard, LayoutGrid, Link2, ListTree, Minus, Network, Orbit, Pencil, Plus, Scan,
  Image as ImageIcon, Search, SquareTerminal, Trash2, Type, Waypoints, Workflow,
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceAround, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceAround,
  BringToFront, Presentation, Shuffle, Check, ChevronDown, ClipboardPaste, CopyPlus, Focus, Grid3x3, Keyboard, Lock, Map as MapIcon, Redo2, Scissors, SendToBack, SlidersHorizontal, Undo2,
} from "lucide-react";
import { ConvertMenu } from "./wb/cards/ConvertMenu";
import { sourceOf } from "../lib/convert";
import { CanvasPresenter } from "./wb/present/workspaces";
import { CanvasEdgeCtx, canvasEdgeTypes, type CanvasEdgeApi } from "./CanvasEdge";
import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CanvasEdge, CanvasNode, JsonCanvas, Note, Side } from "../../shared/types";
import { createNote, duplicateNote, findOrCreateByTitle, restoreNote, trashNote, updateNote } from "../lib/actions";
import { unfurl, type Unfurl } from "../lib/api";
import {
  alignNodes, canvasFromText, cloneFragment, colorOf, fromOutline, isLocked, isPinned, layout, parseCanvas, pickSelection, PRESETS, reorder, runScript, setLocked, setPinned, stringify, tidyCanvas, validate,
  type AlignMode,
} from "../lib/canvas";
import { CanvasHistory } from "../lib/canvas-history";
import {
  bgColorOf, bgPatternOf, borderOf, collapsibleOf, dashFor, edgePathOf, edgeStyleOf, fillOf, headOf, isCollapsed, labelStyleOf, lineOf, markerId, markerSvg, membersOf, nodeStyleOf, patternCss, patternOf,
  pickMeta, setBorder, setCollapsed, setEdgePath, setFill, setHead, setLabelStyle, setLine, setPattern, setShape, setWidth, shapeOf, shapePath, shapeInsetPct, widthOf,
  type CanvasMeta, type HeadKind, type NodeShape, type BorderStyle, type FillStyle, type PathKind, type Pattern,
} from "../lib/canvas-style";
import { CanvasOptions } from "./CanvasOptions";
import { checkNewEdge } from "../lib/graph-checks";
import { EdgeSeg, isTidyKey, TidyBanner, type EdgeShape, type TidyStats } from "./graph-display";
import { Glyph } from "./Glyph";
import { CanvasKeys } from "./CanvasKeys";
import { diagramFocus, diagramFolderFor, diagramHash, diagramKind, diagramText, fenced, mermaidBlocks, metaOf, migrateDiagramCards, newDiagramFile, parseDiagramText, type DiagramNode } from "../lib/diagrams";
import { getSettings } from "../lib/settings";
import { download } from "../lib/io";
import { openExportJob } from "../lib/export-job";
import { canvasJob } from "../lib/export-jobs";
import { fmtNum, t, tk, tx, useLang } from "../lib/i18n";
import { openNote, setUI, toast, useVault } from "../lib/store";
import { canvasToSkeleton, type Skeleton } from "../lib/whiteboard";
import { plainExcerpt } from "./nav-text";
import { Preview } from "./Preview";
import { useCustomPaletteMap } from "./wb/palette/palettes";
import { HL_MIME, hlDropNode, PdfFileCard, PdfHighlightCard } from "./pdf-canvas";
import { registerZone } from "../lib/dnd";
import { canvasZone } from "./dnd/canvas-drop";
import { DndHost } from "./dnd/DndHost";
import { parseHlCard } from "../lib/pdf-format";
import { cx, relTime, STATUS_COLOR } from "./ui";
import {
  CodeEditor, CodePanel, ErrorBanner, errorLine, ExamplesMenu, itemAt, jsonItemSpans, OutputStrip, PanelBar, PhoneActions, RunButton, runKey, ValidChip, ValidFooter,
  type CodeEditorHandle, type CodeTab, type Example,
} from "./VisualCodePanel";

type Data = { node: CanvasNode };
type FlowNode = RFNode<Data>;
const SIDE_POS: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };

/** `mark(key)` names the next history step so quick repeats coalesce (e.g. edits to one card's text). */
const Ctx = createContext<{ spaceId: string; mark: (key: string) => void }>({ spaceId: "", mark: () => {} });

// Board chrome in Lumen tokens (CanvasBoard design): amber connection dots + square resize handles on the selection only.
const CANVAS_CSS = `
/* React Flow ends an edge at the handle box's outer side: a zero-thickness box on the border makes lines meet the card exactly;
   the 12 px dot (and its hit area) is drawn by ::before, centred on the border */
.lumen-canvas .react-flow__handle { min-width: 0; min-height: 0; border: 0; border-radius: 0; background: transparent; opacity: 0; transition: opacity .12s; overflow: visible; }
.lumen-canvas .react-flow__handle-top, .lumen-canvas .react-flow__handle-bottom { width: 12px; height: 0; }
.lumen-canvas .react-flow__handle-left, .lumen-canvas .react-flow__handle-right { width: 0; height: 12px; }
.lumen-canvas .react-flow__handle::before { content: ""; position: absolute; left: 50%; top: 50%; width: 12px; height: 12px; transform: translate(-50%,-50%); border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px var(--bg); }
.lumen-canvas .react-flow__node.selected .react-flow__handle, .lumen-canvas .react-flow__node:hover .react-flow__handle, .lumen-canvas.connecting .react-flow__handle { opacity: 1; }
.lumen-canvas .react-flow__resize-control.handle { width: 8px; height: 8px; border-radius: 2px; background: var(--bg); border: 1.5px solid var(--accent); }
.lumen-canvas .react-flow__resize-control.line { border-color: transparent; }
.lumen-canvas .react-flow__edge-textbg { fill: var(--bg); stroke: var(--border); stroke-width: 1px; }
.lumen-canvas .react-flow__edge-text { fill: var(--muted); font-size: 11.5px; font-family: Inter, system-ui, sans-serif; }
.lumen-canvas .react-flow__minimap { border-radius: 10px; border: 1px solid var(--border); background: var(--surface); overflow: hidden; }
.lumen-canvas .react-flow__node-group { z-index: -1 !important; background: transparent; border: 0; border-radius: 0; padding: 0; box-shadow: none; }
.lumen-canvas .react-flow__node-group.selected, .lumen-canvas .react-flow__node-group:hover { box-shadow: none; }
`;

// ------------------------------------------------------------------ conversions
function toFlow(c: JsonCanvas): { nodes: FlowNode[]; edges: Edge[] } {
  const nodes = (c.nodes ?? []).map((n): FlowNode => ({
    id: n.id, type: n.type, position: { x: n.x, y: n.y }, width: n.width, height: n.height, data: { node: n },
    zIndex: n.type === "group" ? -1 : 0, ...(n.type === "group" ? { dragHandle: ".group-handle" } : {}), ...lockFlags(n),
  }));
  const edges = (c.edges ?? []).map(toFlowEdge);
  return { nodes, edges };
}
/** A locked card can't be dragged or deleted on the board (it can still be selected, edited and connected). */
const lockFlags = (n: CanvasNode) => (isLocked(n) ? { draggable: false, deletable: false } : { draggable: undefined, deletable: undefined });
function toFlowEdge(e: CanvasEdge): Edge {
  return { id: e.id, type: "straight", source: e.fromNode, target: e.toNode, sourceHandle: e.fromSide ?? null, targetHandle: e.toSide ?? null, label: e.label, data: { edge: e }, labelBgPadding: [8, 3], labelBgBorderRadius: 6 };
}
/** The look of an edge, derived from its `lumen*` fields every render (type, line, heads, label style). */
function decorateEdge(e: Edge, def: PathKind): Edge {
  const ed = (e.data?.edge ?? {}) as CanvasEdge;
  const color = colorOf(ed.color) ?? "var(--muted)";
  const w = widthOf(ed), dash = dashFor(lineOf(ed), w), he = headOf(ed, "to"), hs = headOf(ed, "from"), ls = labelStyleOf(ed);
  return {
    ...e, type: EDGE_RF[edgePathOf(ed) ?? def],
    markerEnd: he === "none" ? undefined : markerId(he, color), markerStart: hs === "none" ? undefined : markerId(hs, color),
    style: { stroke: color, strokeWidth: w, strokeDasharray: dash, strokeLinecap: dash ? "round" : undefined },
    label: ls === "hidden" ? undefined : e.label, labelShowBg: ls === "pill", labelBgPadding: [8, 3], labelBgBorderRadius: 6,
  };
}
/** Hidden SVG with the arrowhead markers the board's edges use. */
function MarkerDefs({ edges }: { edges: Edge[] }) {
  const defs = new Map<string, string>();
  for (const e of edges) {
    const ed = (e.data?.edge ?? {}) as CanvasEdge, color = colorOf(ed.color) ?? "var(--muted)";
    for (const k of [headOf(ed, "to"), headOf(ed, "from")] as HeadKind[]) if (k !== "none") { const id = markerId(k, color); if (!defs.has(id)) defs.set(id, markerSvg(k, id, color)); }
  }
  return <svg width="0" height="0" className="pointer-events-none absolute" aria-hidden><defs dangerouslySetInnerHTML={{ __html: [...defs.values()].join("") }} /></svg>;
}
const edgeOf = (e: Edge): CanvasEdge => {
  const out: CanvasEdge = { ...((e.data?.edge ?? {}) as CanvasEdge), id: e.id, fromNode: e.source, toNode: e.target };
  if (e.sourceHandle) out.fromSide = e.sourceHandle as Side; else delete out.fromSide;
  if (e.targetHandle) out.toSide = e.targetHandle as Side; else delete out.toSide;
  return out;
};

function fromFlow(nodes: FlowNode[], edges: Edge[]): JsonCanvas {
  return {
    nodes: [...nodes].sort((a, b) => (a.data.node.type === "group" ? 0 : 1) - (b.data.node.type === "group" ? 0 : 1)).map((n) => ({
      ...n.data.node, id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y),
      width: Math.round(n.width ?? n.measured?.width ?? n.data.node.width), height: Math.round(n.height ?? n.measured?.height ?? n.data.node.height),
    })),
    edges: edges.map((e) => {
      const old = (e.data?.edge ?? {}) as Partial<CanvasEdge>;
      const out: CanvasEdge = { ...old, id: e.id, fromNode: e.source, toNode: e.target };
      if (e.sourceHandle) out.fromSide = e.sourceHandle as Side; else delete out.fromSide;
      if (e.targetHandle) out.toSide = e.targetHandle as Side; else delete out.toSide;
      if (typeof e.label === "string" && e.label) out.label = e.label; else delete out.label;
      return out;
    }),
  };
}

// ------------------------------------------------------------------ node renderers
function Handles({ n }: { n?: CanvasNode }) {
  return (
    <>
      {(Object.keys(SIDE_POS) as Side[]).map((s) => <Handle key={s} id={s} type="source" position={SIDE_POS[s]} />)}
      {/* Pinned card (Tidy up leaves it where it is): small amber pin on the corner. */}
      {n && isPinned(n) && <span title={t("Pinned: Tidy up keeps it here")} className="pointer-events-none absolute -right-2 -top-2 z-10 flex size-[18px] items-center justify-center rounded-full bg-accent text-accent-fg shadow-[0_0_0_2px_var(--bg)]"><Pin size={10} /></span>}
      {n && isLocked(n) && <span title={t("Locked: can't be moved, resized or deleted")} className={cx("pointer-events-none absolute -top-2 z-10 flex size-[18px] items-center justify-center rounded-full bg-surface-2 text-ink shadow-[0_0_0_2px_var(--bg)]", isPinned(n) ? "right-[14px]" : "-right-2")}><Lock size={10} /></span>}
    </>
  );
}
/**
 * Card shell: 1px border in the card colour (selected = 2px amber + soft ring), shape / border style / background from
 * the card's lumen* options (lib/canvas-style.ts). Diamond, parallelogram and cylinder are drawn as an SVG behind the
 * content; every shape insets its content so text stays inside the outline.
 */
function CardShell({ n, selected, base = "var(--surface)", children, ...rest }: { n: CanvasNode; selected: boolean; base?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  const shape = shapeOf(n), border = borderOf(n), fill = fillOf(n), c = colorOf(n.color);
  const bg = fill === "none" ? "transparent" : fill === "solid" ? c ?? "var(--surface-2)" : c ? `color-mix(in srgb, ${c} 14%, var(--surface))` : base;
  const solid = fill === "solid" && !!c;
  const inset = shapeInsetPct(shape);
  const svgShape = shape === "diamond" || shape === "parallelogram" || shape === "cylinder";
  const radius = shape === "rect" ? 4 : shape === "pill" ? 9999 : shape === "circle" ? "50%" : 10;
  const stroke = selected ? "var(--accent)" : c ?? "var(--border)";
  const style: React.CSSProperties = { ...(solid ? { ["--text" as string]: "#0F1115", ["--muted" as string]: "#3A3D44", color: "#0F1115" } : {}), isolation: "isolate" };
  const inner = inset ? <div className="absolute flex flex-col overflow-hidden" style={{ left: `${inset.l}%`, right: `${inset.r}%`, top: `${inset.t}%`, bottom: `${inset.b}%` }}>{children}</div> : children;
  if (svgShape) {
    const { d, rim } = shapePath(shape, 0, 0, 100, 100);
    const dash = dashFor(border, 1.5);
    const sp = { fill: "none", stroke: border === "none" && !selected ? "none" : stroke, strokeWidth: selected ? 2 : 1.2, strokeDasharray: dash, vectorEffect: "non-scaling-stroke" as const, strokeLinecap: dash ? ("round" as const) : undefined };
    return (
      <div {...rest} className="relative box-border flex h-full w-full flex-col" style={style}>
        <svg className="absolute inset-0 -z-10" width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ overflow: "visible", filter: selected ? "drop-shadow(0 0 4px color-mix(in srgb,var(--accent) 45%,transparent))" : undefined }}>
          {fill !== "none" && <path d={d} style={{ fill: solid ? c : base }} />}
          {fill === "tint" && c && <path d={d} style={{ fill: c, fillOpacity: 0.14 }} />}
          <path d={d} {...sp} />{rim && <path d={rim} {...sp} />}
        </svg>
        {inner}
      </div>
    );
  }
  return (
    <div {...rest} className="relative box-border flex h-full w-full flex-col overflow-hidden" style={{
      ...style, borderRadius: radius, borderWidth: selected ? 2 : 1, borderStyle: border === "none" ? "solid" : border, borderColor: border === "none" && !selected ? "transparent" : stroke,
      boxShadow: selected ? "0 0 0 4px color-mix(in srgb,var(--accent) 16%,transparent)" : "none", background: bg,
    }}>{inner}</div>
  );
}
const RESIZER = { lineStyle: { borderColor: "transparent" } };

/** "# Idea\nbody…" → title + body, so a text card reads like the design (bold title, muted body). */
function splitTitle(t: string) {
  const m = /^\s*#{1,6}\s+(.+?)\s*(?:\n|$)/.exec(t);
  return m ? { title: m[1], body: t.slice(m[0].length).trim() } : { title: "", body: t };
}

/**
 * A diagram card (lib/diagrams.ts): `## name.mermaid` + one ```mermaid fence. Header = drag handle with the name,
 * a back-link to the note to the source diagram and "Update from note" when the note's copy changed; body = the zoomable
 * diagram (nodrag/nowheel so its own pan/zoom work). Double-click the header to edit the source.
 */
function DiagramBody({ id, n, name, src, selected, onEdit }: { id: string; n: DiagramNode; name: string; src: string; selected: boolean; onEdit: () => void }) {
  const v = useVault();
  const { updateNodeData } = useReactFlow();
  const { spaceId } = useContext(Ctx);
  const ref = n.lumenDiagram;
  const source = ref ? v.byId.get(ref.note) : undefined;
  const now = source && !source.deleted ? mermaidBlocks(source.body) : [];
  const cur = ref ? now.find((b) => diagramHash(b.src) === ref.hash) ?? now.find((b) => b.line === ref.line) : undefined;
  const stale = !!cur && diagramHash(cur.src) !== diagramHash(src);
  const back = () => { if (!source || !ref) return; diagramFocus.note = { noteId: source.id, line: cur?.line ?? ref.line, hash: cur ? diagramHash(cur.src) : ref.hash }; openNote(source.id, "read"); };
  const pull = () => { if (!cur || !ref) return; updateNodeData(id, { node: { ...n, text: diagramText(name, cur.src), lumenDiagram: { ...ref, line: cur.line, hash: diagramHash(cur.src) } } }); toast(t("Diagram updated from the note")); };
  const body = useMemo(() => `\`\`\`mermaid\n${src}\n\`\`\``, [src]);
  return (
    <CardShell n={n} selected={selected}>
      <div className="flex h-[30px] shrink-0 cursor-grab items-center gap-1.5 border-b border-line px-2.5 text-[11.5px] text-muted" onDoubleClick={onEdit} title={t("Drag to move · double-click to edit the source")}>
        <Waypoints size={12} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate font-mono text-ink">{name}</span>
        {stale && <button className="nodrag shrink-0 rounded-[6px] px-1.5 py-0.5 text-warn hover:bg-surface-2" title={t("The note's copy of this diagram changed")} onClick={pull}><RotateCw size={11} className="mr-1 inline align-[-1px]" />{t("Update from note")}</button>}
        {source && <button className="nodrag max-w-[45%] shrink-0 truncate rounded-[6px] px-1.5 py-0.5 hover:bg-surface-2 hover:text-ink" title={t("Open “{title}” at this diagram", { title: source.title })} onClick={back}><CornerUpLeft size={11} className="mr-1 inline align-[-1px]" />{source.title}</button>}
        {ref && !source && <span className="shrink-0 text-[11px]" title={t("The source note was deleted or renamed")}>{t("source missing")}</span>}
      </div>
      <div className="nodrag nowheel diagram-node min-h-0 flex-1 overflow-hidden"><Preview note={{ id, body, spaceId }} className="!m-0 !max-w-none" /></div>
    </CardShell>
  );
}

const TextNode = memo(({ id, data, selected }: NodeProps<FlowNode>) => {
  useLang();
  const n = data.node as Extract<CanvasNode, { type: "text" }>;
  const { updateNodeData } = useReactFlow();
  const { spaceId, mark } = useContext(Ctx);
  const [edit, setEdit] = useState(!n.text);
  useEffect(() => { const f = (e: Event) => { if ((e as CustomEvent<string>).detail === id) setEdit(true); }; addEventListener("lumen-canvas-edit", f); return () => removeEventListener("lumen-canvas-edit", f); }, [id]);
  const diagram = !edit ? parseDiagramText(n.text) : null;
  if (diagram) return (
    <>
      <NodeResizer isVisible={!!selected && !isLocked(n)} minWidth={240} minHeight={160} {...RESIZER} />
      <Handles n={n} />
      <DiagramBody id={id} n={n as DiagramNode} name={diagram.name} src={diagram.src} selected={!!selected} onEdit={() => setEdit(true)} />
    </>
  );
  // PDF highlight card: `> quote` + `[[Paper#^hl-id|…]]` (components/pdf-canvas.tsx)
  const hl = !edit ? parseHlCard(n.text) : null;
  if (hl) return (
    <>
      <NodeResizer isVisible={!!selected && !isLocked(n)} minWidth={180} minHeight={90} {...RESIZER} />
      <Handles n={n} />
      <div className="h-full w-full" onDoubleClick={() => setEdit(true)}><PdfHighlightCard n={n} card={hl} selected={!!selected} /></div>
    </>
  );
  const { title, body } = splitTitle(n.text);
  const rich = /\$|\*\*|`|\[\[|!?\[[^\]]*\]\(att:|^\*[^*\n]+\* · |^\s*([-*>]|\d+\.)\s/m.test(body); // + attachments dropped onto the board (lib/dnd.ts) and their progress line
  return (
    <>
      <NodeResizer isVisible={!!selected && !isLocked(n)} minWidth={120} minHeight={50} {...RESIZER} />
      <Handles n={n} />
      <CardShell n={n} selected={!!selected} onDoubleClick={() => setEdit(true)}>
        {edit ? (
          <textarea
            autoFocus
            className="nodrag nowheel h-full w-full resize-none bg-transparent px-3.5 py-3 font-mono text-[13px] text-ink outline-none"
            defaultValue={n.text}
            onBlur={(e) => { if (e.target.value !== n.text) { mark(`text:${id}`); updateNodeData(id, { node: { ...n, text: e.target.value } }); } setEdit(false); }}
            onKeyDown={(e) => e.key === "Escape" && (e.target as HTMLTextAreaElement).blur()}
          />
        ) : (
          <div className="nowheel flex h-full flex-col gap-1.5 overflow-auto px-3.5 py-3">
            {title && <span dir="auto" className="text-[14px] font-[650]">{title}</span>}
            {body ? (
              rich
                ? <div className="text-[13px] leading-[19px] opacity-85 [&_.katex]:text-[15px]"><Preview note={{ id, body: body.replace(/([^\n])\n(?=[^\n])/g, "$1  \n"), spaceId }} className="!font-sans !text-[13px] !leading-[19px]" /></div>
                : <span dir="auto" className="whitespace-pre-line text-[13px] leading-[19px] text-ink opacity-85">{body}</span>
            ) : !title && <span className="text-[13px] text-muted">{t("Double-click to edit")}</span>}
          </div>
        )}
      </CardShell>
    </>
  );
});

/** A file card pointing at a `.mermaid` file: name + type header (drag handle), the zoomable diagram, and where it came from. */
function DiagramFileCard({ n, note, selected }: { n: CanvasNode; note: Note; selected: boolean }) {
  const v = useVault();
  const meta = metaOf(note);
  const src = meta ? v.byId.get(meta.from) : undefined;
  const back = () => { if (!src || !meta) return; const b = mermaidBlocks(src.body).find((x) => diagramHash(x.src) === meta.hash); diagramFocus.note = { noteId: src.id, line: b?.line ?? meta.line, hash: b ? diagramHash(b.src) : meta.hash }; openNote(src.id, "read"); };
  const body = useMemo(() => fenced(note.body), [note.body]);
  return (
    <CardShell n={n} selected={selected}>
      <div className="flex h-[30px] shrink-0 cursor-grab items-center gap-1.5 border-b border-line px-2.5 text-[11.5px] text-muted" title={t("Drag to move")}>
        <Waypoints size={12} className="shrink-0 text-accent" />
        <button className="nodrag min-w-0 flex-1 truncate text-left font-mono text-ink hover:text-accent" title={t("Open the .mermaid file")} onClick={() => openNote(note.id, "read")}>{note.title}</button>
        <span className="shrink-0 rounded-[5px] bg-surface-2 px-1 font-mono text-[10.5px]">{diagramKind(note.body)}</span>
      </div>
      <div className="nodrag nowheel diagram-node min-h-0 flex-1 overflow-hidden">{note.body.trim() ? <Preview note={{ id: note.id, body, spaceId: note.spaceId }} className="!m-0 !max-w-none" /> : <div className="p-4 text-[12px] text-muted">{t("Empty diagram. Open it to write Mermaid.")}</div>}</div>
      <div className="flex h-[24px] shrink-0 items-center gap-1.5 border-t border-line px-2.5 text-[11px] text-muted">
        {src && !src.deleted ? <button className="nodrag min-w-0 truncate hover:text-ink" title={t("Open the source note at this diagram")} onClick={back}><CornerUpLeft size={11} className="mr-1 inline align-[-1px]" />{src.title}{meta?.heading ? ` › ${meta.heading}` : ""}</button> : <span className="truncate">{meta ? t("from “{title}”", { title: meta.fromTitle }) : t("standalone diagram")}</span>}
        <span className="ms-auto shrink-0">{t("updated {when}", { when: relTime(note.updatedAt) })}</span>
      </div>
    </CardShell>
  );
}

const FileNode = memo(({ data, selected }: NodeProps<FlowNode>) => {
  useLang();
  const n = data.node as Extract<CanvasNode, { type: "file" }>;
  const v = useVault();
  const { spaceId } = useContext(Ctx);
  const title = n.file.replace(/\.md$/i, "").split("/").pop()!;
  const note = v.byTitle.get(title.toLowerCase());
  if (note?.type === "diagram") return (
    <>
      <NodeResizer isVisible={!!selected && !isLocked(n)} minWidth={240} minHeight={180} {...RESIZER} />
      <Handles n={n} />
      <DiagramFileCard n={n} note={note} selected={!!selected} />
    </>
  );
  if (note?.type === "pdf") return (
    <>
      <NodeResizer isVisible={!!selected && !isLocked(n)} minWidth={200} minHeight={110} {...RESIZER} />
      <Handles n={n} />
      <PdfFileCard n={n} note={note} selected={!!selected} />
    </>
  );
  const folder = note ? (note.folderId ? v.folderMap.get(note.folderId)?.name : v.spaceMap.get(note.spaceId)?.name) : n.file.split("/").slice(-2, -1)[0];
  return (
    <>
      <NodeResizer isVisible={!!selected && !isLocked(n)} minWidth={140} minHeight={60} {...RESIZER} />
      <Handles n={n} />
      <CardShell n={n} selected={!!selected}>
        <div className="flex h-[30px] shrink-0 items-center gap-1.5 border-b border-line px-2.5 text-[11.5px] text-muted">
          <FileText size={12} className="shrink-0" /><span className="flex-1 truncate" dir="auto">{folder ?? t("Note")}</span>
          <span className="size-[7px] shrink-0 rounded-full" style={{ background: note?.status ? STATUS_COLOR[note.status] : note ? "var(--info)" : "var(--border)" }} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-[5px] px-3 py-2.5">
          <button className="nodrag truncate text-left text-[14px] font-[650] hover:text-accent" onClick={async () => openNote((note ?? (await findOrCreateByTitle(title, spaceId))).id)}>
            {title}{!note && <span className="ml-1.5 text-[11px] font-normal text-muted">{t("create")}</span>}
          </button>
          <span dir="auto" className="nowheel overflow-hidden text-[12px] leading-[17px] text-muted">{note ? plainExcerpt(note.body, 90) : t("Note not found. Click the title to create it.")}</span>
        </div>
      </CardShell>
    </>
  );
});

const BADGE = "#8C1515";
const LinkNode = memo(({ data, selected }: NodeProps<FlowNode>) => {
  const n = data.node as Extract<CanvasNode, { type: "link" }>;
  const [meta, setMeta] = useState<Unfurl | null>(null);
  useEffect(() => { let live = true; void unfurl(n.url).then((m) => live && setMeta(m)); return () => { live = false; }; }, [n.url]);
  let host = n.url;
  try { host = new URL(n.url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
  const badge = host.split(".")[0].slice(0, 2).toUpperCase();
  const embed = (n as unknown as { lumenEmbed?: string }).lumenEmbed; // YouTube / Vimeo dropped from the browser: a live player (lib/dnd.ts)
  return (
    <>
      <NodeResizer isVisible={!!selected && !isLocked(n)} minWidth={140} minHeight={50} {...RESIZER} />
      <Handles n={n} />
      <CardShell n={n} selected={!!selected}>
        {embed ? (
          <iframe src={embed} title={meta?.title || host} loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowFullScreen className="nodrag h-full w-full rounded-[inherit] border-0" />
        ) : (
        <a href={n.url} target="_blank" rel="noopener noreferrer" className="nodrag flex h-full items-center gap-3 p-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[8px] text-[13px] font-bold text-white" style={{ background: BADGE }}>{badge}</span>
          <span className="flex min-w-0 flex-col gap-[3px]">
            <span className="truncate font-semibold text-ink">{meta?.title || host}</span>
            <span className="flex min-w-0 items-center gap-1 text-[12px] text-link"><Link2 size={12} className="shrink-0" /><span className="truncate">{n.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span></span>
          </span>
        </a>
        )}
      </CardShell>
    </>
  );
});

/** Board-level group options (collapsible, "N cards" counts, toggling) shared with every group card. */
const GroupCtx = createContext<{ counts: Map<string, number>; collapsible: boolean }>({ counts: new Map(), collapsible: true });
const GROUP_HEAD = 44;

const GroupNode = memo(({ id, data, selected }: NodeProps<FlowNode>) => {
  useLang();
  const n = data.node as Extract<CanvasNode, { type: "group" }>;
  const { updateNodeData } = useReactFlow();
  const { mark } = useContext(Ctx);
  const g = useContext(GroupCtx);
  const c = colorOf(n.color) ?? "var(--muted)";
  const collapsed = isCollapsed(n), count = g.counts.get(id) ?? 0, pat = patternOf(n);
  const label = (
    <input
      className="group-handle h-6 min-w-0 cursor-move outline-none"
      style={g.collapsible ? { flex: 1, background: "transparent", fontSize: 12, fontWeight: 600, color: "var(--text)", padding: 0 } : { position: "absolute", top: -30, left: 0, borderRadius: 6, padding: "0 10px", fontSize: 12.5, fontWeight: 600, color: "#0F1115", background: c, width: `${Math.max(6, (n.label ?? "Group").length + 3)}ch` }}
      defaultValue={n.label ?? ""}
      placeholder={t("Group@@noun")}
      onBlur={(e) => { if (e.target.value !== (n.label ?? "")) { mark(`label:${id}`); updateNodeData(id, { node: { ...n, label: e.target.value } }); } }}
    />
  );
  return (
    <>
      <NodeResizer isVisible={!!selected && !isLocked(n) && !collapsed} minWidth={160} minHeight={100} {...RESIZER} />
      <Handles n={n} />
      <div className="pointer-events-auto relative w-full rounded-[14px]" style={{
        height: collapsed ? GROUP_HEAD : "100%", border: `1.5px solid ${selected ? "var(--accent)" : c}`, backgroundColor: `color-mix(in srgb, ${c} 8%, transparent)`,
        ...(pat !== "none" && !collapsed ? patternCss(pat, `color-mix(in srgb, ${c} 35%, transparent)`, 16) : {}),
      }}>
        {g.collapsible ? (
          <div className="absolute inset-x-3.5 top-2 flex h-6 items-center gap-1.5">
            <button className="nodrag flex size-5 shrink-0 items-center justify-center text-ink" aria-label={collapsed ? t("Expand group") : t("Collapse group")} aria-expanded={!collapsed} onClick={() => updateNodeData(id, { node: setCollapsed(n, !collapsed) })}>
              <ChevronDown size={13} className={collapsed ? "-rotate-90 rtl:rotate-90" : ""} />
            </button>
            {label}
            <span className="shrink-0 whitespace-nowrap rounded-full border border-line bg-surface-2 px-3 text-[11.5px] font-medium leading-6 text-ink">{t("{n} card|{n} cards", { n: count })}</span>
          </div>
        ) : label}
      </div>
    </>
  );
});

const nodeTypes = { text: TextNode, file: FileNode, link: LinkNode, group: GroupNode };

// ------------------------------------------------------------------ editor
const SCRIPT_EXAMPLE = `// JSON Canvas scripting. API: canvas.addText / addNote / addLink / addGroup / addEdge,
// canvas.find(pred), canvas.update(id, {...}), canvas.remove(id), canvas.layout("tree"|"grid"|"force"),
// canvas.fromOutline(markdown), canvas.clear(), log(...). helpers.notes = all notes (title, tags, type).
const root = canvas.addText("# Machine learning", { color: "6" });
for (const t of ["Supervised", "Unsupervised", "Reinforcement"]) {
  const id = canvas.addText("## " + t);
  canvas.addEdge(root, id, { label: "type" });
}
canvas.layout("tree");
log("nodes:", canvas.nodes.length);`;

const EXAMPLES: Example[] = [
  { icon: <GitFork size={15} />, title: tk("Mind map from headings"), desc: tk("Each ## heading becomes a branch"), code: `// Paste an outline; every heading becomes a card linked to its parent.
canvas.fromOutline(\`# Backpropagation
## Forward pass
### Activations
## Backward pass
### Chain rule
### Vanishing gradients\`);
canvas.layout("tree");
log("cards:", canvas.nodes.length);` },
  { icon: <FileText size={15} />, title: tk("Cards from tagged notes"), desc: tk("One note card per note with a tag"), code: `// Change the tag, then Run. Notes become file cards in a grid.
const tag = "math";
const hits = helpers.notes.filter((n) => n.tags.includes(tag));
for (const n of hits) canvas.addNote(n.title);
canvas.layout("grid");
log(hits.length, "notes tagged #" + tag);` },
  { icon: <Network size={15} />, title: tk("Concept tree"), desc: tk("A root card with typed children"), code: SCRIPT_EXAMPLE },
];

/** Output-line markers OutputStrip (VisualCodePanel) turns into a check / x icon; the characters themselves never render. */
const LOG_OK = "\u2713", LOG_ERR = "\u2716";
// custom edge types (CanvasEdge.tsx): React Flow's paths plus touch-friendly reconnect handles and in-place labels
const EDGE_RF: Record<EdgeShape, string> = { curved: "cvCurved", elbow: "cvStep", straight: "cvStraight" };
const TOOL = "flex h-8 items-center justify-center gap-[5px] rounded-[8px] text-ink hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent";
const CAPTION = "shrink-0 whitespace-nowrap ps-1 pe-1.5 text-[10.5px] font-semibold uppercase tracking-[.06em] text-muted";
const SEP = <span className="mx-1.5 h-[22px] w-px shrink-0 bg-line" />;
type PhoneTab = "add" | "arrange" | "style" | "code";
/** Ctrl on Windows / Linux, the Command key on Apple devices (shown in tooltips and the shortcuts sheet). */
const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "\u2318" : "Ctrl";
const isEditable = (el: EventTarget | null) => {
  const h = el as HTMLElement | null;
  return !!h && (h.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(h.tagName) || !!h.closest?.(".cm-editor"));
};
/** Board shortcuts apply when nothing else has focus (body) or focus is on the board / its toolbar. */
const onBoard = (el: EventTarget | null) => { const h = el as HTMLElement | null; return !h || h === document.body || h === document.documentElement || !!h.closest?.(".lumen-canvas"); };
/**
 * Toolbar fit levels (ResizeObserver on the board): each step hides one more thing until the bar fits its own width,
 * so it never runs under the side panel. 1 captions, 2 Arrange labels, 3 Tidy label, 4 Code group → More,
 * 5 Style → More, 6 Arrange (but Tidy) → More, 7 Add (but Text) → More.
 */
const MAX_LVL = 7;
const VIEW_KEY = "lumen.canvasView";
type Tool = [name: string, icon: ReactNode, label: string, run: () => void, on?: boolean, off?: boolean];

/** A row in the canvas ⋯ menu: icon, label, optional shortcut, optional on/off check. */
function MenuRow({ icon, label, keys, on, off, onClick }: { icon: ReactNode; label: string; keys?: string; on?: boolean; off?: boolean; onClick: () => void }) {
  return (
    <button disabled={off} onClick={onClick} className="flex h-[34px] shrink-0 items-center gap-2.5 rounded-[8px] px-2.5 text-start hover:bg-bg disabled:opacity-40 disabled:hover:bg-transparent">
      <span className="flex w-[14px] justify-center text-muted [&>svg]:size-[14px]">{icon}</span>
      <span className="flex-1">{label}</span>
      {on !== undefined && <Check size={14} className={on ? "text-accent" : "opacity-0"} />}
      {keys && <kbd dir="ltr" className="font-sans text-[11.5px] text-muted">{keys}</kbd>}
    </button>
  );
}
const MENU_HEAD = "shrink-0 px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted";

export function CanvasEditor({ note }: { note: Note }) {
  return (
    <ReactFlowProvider>
      <Inner note={note} />
    </ReactFlowProvider>
  );
}

function ZoomPill() {
  const { zoom } = useViewport();
  const rf = useReactFlow();
  return (
    <div className="absolute bottom-4 start-4 z-10 hidden items-center gap-0.5 rounded-[10px] border border-line bg-surface p-[3px] md:flex">
      <button aria-label={t("Zoom out")} onClick={() => rf.zoomOut({ duration: 150 })} className="flex size-7 items-center justify-center rounded-[7px] hover:bg-surface-2"><Minus size={14} /></button>
      <button title={t("Fit")} onClick={() => rf.fitView({ padding: 0.2, duration: 300 })} className="w-10 text-center text-[12px] tabular-nums">{fmtNum(Math.round(zoom * 100))}%</button>
      <button aria-label={t("Zoom in")} onClick={() => rf.zoomIn({ duration: 150 })} className="flex size-7 items-center justify-center rounded-[7px] hover:bg-surface-2"><Plus size={14} /></button>
    </div>
  );
}

function Inner({ note }: { note: Note }) {
  const v = useVault();
  const customPalettes = useCustomPaletteMap(); // W2-A: synced custom palettes for the colour options
  const initial = useMemo(() => parseCanvas(note.body), []); // eslint-disable-line react-hooks/exhaustive-deps
  const flow = useMemo(() => toFlow(initial.canvas), [initial]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(flow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(flow.edges);
  const rf = useReactFlow<FlowNode, Edge>();
  const [panel, setPanel] = useState<CodeTab | null>(null);
  const code = panel === "json";
  const [phoneTab, setPhoneTab] = useState<PhoneTab>("add");
  const [defColor, setDefColor] = useState<string | undefined>(undefined);
  const [codeText, setCodeText] = useState(note.body);
  const [codeErr, setCodeErr] = useState<string | null>(initial.error);
  const [cursor, setCursor] = useState<{ line: number; col: number } | null>({ line: 1, col: 1 });
  const [src, setSrc] = useState(() => { try { return localStorage.getItem("lumen.canvasScript") ?? SCRIPT_EXAMPLE; } catch { return SCRIPT_EXAMPLE; } });
  const [logs, setLogs] = useState<string[]>([]);
  const [menu, setMenu] = useState<null | "main" | "outline" | "align">(null);
  const [connecting, setConnecting] = useState(false);
  // Tidy up preview (14b): the board shows the tidied layout; Cancel restores, Apply keeps it with an Undo toast.
  const [tidyPrev, setTidyPrev] = useState<null | { prev: JsonCanvas; stats: TidyStats }>(null);
  // Canvas-level lumen* options (background, default edge path, group options). Older boards kept the edge path in localStorage.
  const [meta, setMetaRaw] = useState<CanvasMeta>(() => {
    const m = pickMeta(initial.canvas);
    if (!m.lumenEdgePath) { try { const v = localStorage.getItem(`lumen.canvasEdges.${note.id}`); if (v === "curved" || v === "elbow") m.lumenEdgePath = v; } catch { /* ignore */ } }
    return m;
  });
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const setMeta = (p: Partial<CanvasMeta>) => setMetaRaw((o) => ({ ...o, ...p }));
  const edgeShape: EdgeShape = meta.lumenEdgePath ?? "straight";
  /** The "Edges" segment in the menu = every edge: set the board default and clear per-edge overrides. */
  const setEdgeShape = (e: EdgeShape) => { setMeta({ lumenEdgePath: e }); setEdges((es) => es.map((x) => (x.data?.edge && edgePathOf(x.data.edge as CanvasEdge) ? { ...x, data: { edge: setEdgePath(x.data.edge as CanvasEdge, undefined) } } : x))); };
  const [optsOpen, setOptsOpen] = useState(false);
  const [defNode, setDefNode] = useState<{ shape: NodeShape; border: BorderStyle; fill: FillStyle }>({ shape: "rounded", border: "solid", fill: "tint" });
  const [defEdge, setDefEdge] = useState<CanvasEdge>({ id: "", fromNode: "", toNode: "" });
  const snap = (n: FlowNode[] = nodes, e: Edge[] = edges): JsonCanvas => ({ ...fromFlow(n, e), ...pickMeta(meta) });
  /** Shared Export dialog (lib/export-job.ts): scopes whole / selection / visible area / groups. */
  const openCanvasExport = () => {
    const pane = document.querySelector(".lumen-canvas .react-flow__pane")?.getBoundingClientRect();
    const a = pane ? rf.screenToFlowPosition({ x: pane.left, y: pane.top }) : null, b = pane ? rf.screenToFlowPosition({ x: pane.right, y: pane.bottom }) : null;
    openExportJob(canvasJob({ title: note.title, canvas: () => snap(), notes: v.notes, selectedIds: nodes.filter((n) => n.selected).map((n) => n.id), view: a && b ? { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y } : undefined }));
  };
  const lastSaved = useRef(stringify({ ...initial.canvas, ...pickMeta(meta) }));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const parseT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const jsonFocus = useRef(false);
  const ed = useRef<CodeEditorHandle | null>(null);
  const lang = useLang();
  // View preferences (not part of the file): snap to grid, minimap.
  const [view, setViewRaw] = useState<{ snap: boolean; minimap: boolean }>(() => { try { return { snap: true, minimap: true, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") }; } catch { return { snap: true, minimap: true }; } });
  const setView = (p: Partial<typeof view>) => setViewRaw((o) => { const n = { ...o, ...p }; try { localStorage.setItem(VIEW_KEY, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const [keysOpen, setKeysOpen] = useState(false);
  const [convOpen, setConvOpen] = useState(false);
  const [presenting, setPresenting] = useState(false);

  // ------------------------------------------------------------ undo / redo (lib/canvas-history.ts)
  // One snapshot per settled change; the component is keyed by note id, so opening another note starts a new history.
  const hist = useRef<CanvasHistory | null>(null);
  if (!hist.current) hist.current = new CanvasHistory(stringify({ ...fromFlow(flow.nodes, flow.edges), ...pickMeta(meta) }));
  const [, setHistV] = useState(0);
  const nextKey = useRef<string | undefined>(undefined); // coalescing key for the next step
  const silent = useRef(false); // the next settled state isn't a user step (sync, undo/redo)
  const busy = useRef(false); // a drag or resize is running: no steps per frame
  const tidyOn = useRef(false); // Tidy up preview showing: Apply makes the step, Cancel makes none
  const histT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nodesRef = useRef(nodes), edgesRef = useRef(edges);
  const memberMapRef = useRef(new Map<string, string[]>());
  nodesRef.current = nodes; edgesRef.current = edges;
  const selIds = () => [...nodesRef.current.filter((n) => n.selected).map((n) => n.id), ...edgesRef.current.filter((e) => e.selected).map((e) => e.id)];
  const mark = useCallback((k: string) => { nextKey.current = k; }, []);
  const ctx = useMemo(() => ({ spaceId: note.spaceId, mark }), [note.spaceId, mark]);
  const commit = useCallback(() => {
    clearTimeout(histT.current);
    if (busy.current || tidyOn.current) return;
    const h = hist.current!;
    const body = stringify({ ...fromFlow(nodesRef.current, edgesRef.current), ...pickMeta(metaRef.current) });
    const sel = [...nodesRef.current.filter((n) => n.selected).map((n) => n.id), ...edgesRef.current.filter((e) => e.selected).map((e) => e.id)];
    if (silent.current) { silent.current = false; h.absorb(body, sel); }
    else if (h.record(body, sel, nextKey.current)) setHistV((x) => x + 1);
    nextKey.current = undefined;
  }, []);
  const scheduleCommit = useCallback(() => { clearTimeout(histT.current); histT.current = setTimeout(commit, 80); }, [commit]);
  useEffect(scheduleCommit, [nodes, edges, meta, scheduleCommit]);
  useEffect(() => () => clearTimeout(histT.current), []);

  const load = useCallback((c: JsonCanvas, only?: string[]) => {
    // Keep the board selection across reloads (JSON edits, scripts, sync), or select `only` (undo/redo, paste).
    setNodes((old) => { const sel = new Set(only ?? old.filter((n) => n.selected).map((n) => n.id)); return toFlow(c).nodes.map((n) => (sel.has(n.id) ? { ...n, selected: true } : n)); });
    setEdges((old) => { const sel = new Set(only ?? old.filter((e) => e.selected).map((e) => e.id)); return toFlow(c).edges.map((e) => (sel.has(e.id) ? { ...e, selected: true } : e)); });
  }, [setNodes, setEdges]);
  const restore = (body: string, sel: string[]) => { silent.current = true; const c = parseCanvas(body).canvas; load(c, sel); setMetaRaw(pickMeta(c)); setHistV((x) => x + 1); };
  const undo = () => {
    if (busy.current || tidyOn.current) return;
    commit(); // a change still settling becomes its own step first
    const s = hist.current!.undo(selIds());
    if (s) restore(s.body, s.sel);
  };
  const redo = () => {
    if (busy.current || tidyOn.current) return;
    commit();
    const s = hist.current!.redo(selIds());
    if (s) restore(s.body, s.sel);
  };

  // Persist (debounced) on any change; mirror into the JSON panel unless you're typing in it.
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const s = stringify(snap());
      if (!jsonFocus.current && !codeErr) setCodeText(s);
      if (s === lastSaved.current) return;
      lastSaved.current = s;
      void updateNote(note.id, { body: s });
    }, code ? 150 : 500);
    return () => clearTimeout(timer.current);
  }, [nodes, edges, meta, note.id, code, codeErr]); // eslint-disable-line react-hooks/exhaustive-deps

  // External change (sync, REST API, another tab) → reload.
  useEffect(() => {
    if (note.body === lastSaved.current) return;
    const { canvas, error } = parseCanvas(note.body);
    if (error) return;
    const s = stringify(canvas);
    if (s === lastSaved.current) return;
    lastSaved.current = s;
    if (!jsonFocus.current) setCodeText(s);
    silent.current = true; // not the owner's step: it becomes the new base
    load(canvas);
    setMetaRaw(pickMeta(canvas));
  }, [note.body, load]);

  // Board ↔ JSON: the selected node/edge's object gets the amber band; a cursor inside an object selects it.
  const spans = useMemo(() => (code ? jsonItemSpans(codeText) : new Map<string, { from: number; to: number }>()), [code, codeText]);
  const selItem = nodes.find((n) => n.selected)?.id ?? edges.find((e) => e.selected)?.id ?? null;
  const band = selItem ? spans.get(selItem) ?? null : null;
  const selectItem = (id: string | null) => {
    if (id === selItem) return;
    const isNode = !!id && nodes.some((n) => n.id === id);
    setNodes((ns) => ns.map((n) => (n.selected !== (isNode && n.id === id) ? { ...n, selected: isNode && n.id === id } : n)));
    setEdges((es) => es.map((e) => (e.selected !== (!isNode && e.id === id) ? { ...e, selected: !isNode && e.id === id } : e)));
  };
  const onJson = (t: string) => {
    setCodeText(t);
    clearTimeout(parseT.current);
    parseT.current = setTimeout(() => {
      try {
        const c = JSON.parse(t);
        const err = validate(c);
        setCodeErr(err);
        if (!err) { nextKey.current = "json"; load({ nodes: c.nodes ?? [], edges: c.edges ?? [] }); setMetaRaw(pickMeta(c)); }
      } catch (e) { setCodeErr(`JSON: ${(e as Error).message}`); }
    }, 300);
  };
  const errLine = errorLine(codeErr, codeText);

  const center = () => {
    const vp = rf.getViewport();
    const el = document.querySelector(".react-flow")?.getBoundingClientRect();
    return { x: Math.round(((el?.width ?? 800) / 2 - vp.x) / vp.zoom - 130), y: Math.round(((el?.height ?? 600) / 2 - vp.y) / vp.zoom - 60) };
  };
  const addNode = (n: Partial<CanvasNode> & { type: CanvasNode["type"] }, at?: { x: number; y: number }) => {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const p = at ?? center();
    let node = { id, x: p.x, y: p.y, width: 260, height: 120, ...(defColor ? { color: defColor } : {}), ...n } as CanvasNode;
    if (node.type !== "group") node = setFill(setBorder(setShape(node, defNode.shape), defNode.border), defNode.fill);
    setNodes((ns) => [...ns.map((x) => ({ ...x, selected: false })), { ...toFlow({ nodes: [node] }).nodes[0], selected: true }]);
  };
  // Drag and drop target (lib/dnd.ts, components/dnd/canvas-drop.ts): notes, graph nodes, files, text, URLs, library items.
  const dropLatest = useRef({ undo, snap: view.snap, defNode, title: note.title });
  dropLatest.current = { undo, snap: view.snap, defNode, title: note.title };
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const L = dropLatest;
    const abs = (): CanvasNode[] => nodesRef.current.map((n) => ({ ...n.data.node, x: n.position.x, y: n.position.y, width: n.width ?? n.measured?.width ?? n.data.node.width, height: n.height ?? n.measured?.height ?? n.data.node.height }));
    const zone = canvasZone({
      rf, el, name: L.current.title, noteId: note.id,
      get grid() { return L.current.snap ? 20 : undefined; },
      nodes: abs,
      add: (ns, es) => {
        const d = L.current.defNode;
        const styled = ns.map((n) => (n.type === "group" ? n : setFill(setBorder(setShape(n, d.shape), d.border), d.fill)));
        const f = toFlow({ nodes: styled, edges: es });
        setNodes((old) => [...old.map((x) => (x.selected ? { ...x, selected: false } : x)), ...f.nodes.map((x) => ({ ...x, selected: true }))]);
        if (f.edges.length) setEdges((old) => [...old.map((x) => (x.selected ? { ...x, selected: false } : x)), ...f.edges]);
      },
      update: (id, patch) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { node: { ...n.data.node, ...patch } as CanvasNode } } : n))),
      undo: () => L.current.undo(),
      pan: (dx, dy) => { const vp = rf.getViewport(); rf.setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom }); },
    });
    return registerZone({ ...zone, ignore: (dt) => dt.types.includes(HL_MIME) });
  }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = nodes.filter((n) => n.selected);
  const anySel = selected.length > 0 || edges.some((e) => e.selected);
  const setColor = (c: string | undefined) => {
    if (!anySel) { setDefColor(c); return; }
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: { node: { ...n.data.node, color: c } } } : n)));
    setEdges((es) => es.map((e) => { if (!e.selected) return e; const ed = edgeOf(e); if (c) ed.color = c; else delete ed.color; return { ...e, data: { edge: ed } }; }));
  };
  // ------------------------------------------------------------ canvas options (CanvasOptions.tsx)
  const selNodes = selected.filter((n) => n.data.node.type !== "group");
  const selEdges = edges.filter((e) => e.selected);
  const selGroups = selected.filter((n) => n.data.node.type === "group");
  const nodeStyle = selNodes.length ? nodeStyleOf(selNodes[0].data.node) : defNode;
  const onNodeStyle = (p: Partial<{ shape: NodeShape; border: BorderStyle; fill: FillStyle }>) => {
    const fn = (n: CanvasNode) => { let o = n; if (p.shape) o = setShape(o, p.shape); if (p.border) o = setBorder(o, p.border); if (p.fill) o = setFill(o, p.fill); return o; };
    if (!selNodes.length) return setDefNode((d) => ({ ...d, ...p }));
    setNodes((ns) => ns.map((n) => (n.selected && n.data.node.type !== "group" ? { ...n, data: { node: fn(n.data.node) } } : n)));
  };
  const edgeNow: CanvasEdge = selEdges.length ? edgeOf(selEdges[0]) : defEdge;
  const edgeStyle = { path: edgePathOf(edgeNow) ?? (selEdges.length ? edgeShape : edgeShape), line: lineOf(edgeNow), width: widthOf(edgeNow), from: headOf(edgeNow, "from"), to: headOf(edgeNow, "to"), label: labelStyleOf(edgeNow) };
  const onEdgeStyle = (p: Partial<typeof edgeStyle>) => {
    const fn = (e: CanvasEdge) => { let o = e; if (p.path) o = setEdgePath(o, p.path); if (p.line) o = setLine(o, p.line); if (p.width) o = setWidth(o, p.width); if (p.from) o = setHead(o, "from", p.from); if (p.to) o = setHead(o, "to", p.to); if (p.label) o = setLabelStyle(o, p.label); return o; };
    if (!selEdges.length) { if (p.path) setMeta({ lumenEdgePath: p.path }); const { path: _p, ...rest } = p; if (Object.keys(rest).length) setDefEdge((d) => fn(d)); return; }
    setEdges((es) => es.map((e) => (e.selected ? { ...e, data: { edge: fn(edgeOf(e)) } } : e)));
  };
  const groupNodes = nodes.filter((n) => n.data.node.type === "group");
  const groupPattern: Pattern = patternOf((selGroups[0] ?? groupNodes[0])?.data.node ?? ({} as CanvasNode));
  const memberMap = useMemo(() => {
    const flat = nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, width: n.width ?? n.measured?.width ?? n.data.node.width, height: n.height ?? n.measured?.height ?? n.data.node.height, type: n.data.node.type }));
    const m = new Map<string, string[]>();
    for (const g of flat) if (g.type === "group") m.set(g.id, membersOf(g as unknown as CanvasNode, flat));
    return m;
  }, [nodes]);
  memberMapRef.current = memberMap;
  const groupCtx = useMemo(() => ({ counts: new Map([...memberMap].map(([k, v]) => [k, v.length] as [string, number])), collapsible: collapsibleOf(meta) }), [memberMap, meta]);
  const shownNodes = useMemo(() => {
    const hide = new Set<string>();
    for (const n of nodes) if (isCollapsed(n.data.node)) for (const id of memberMap.get(n.id) ?? []) hide.add(id);
    return nodes.map((n) => (hide.has(n.id) ? { ...n, hidden: true } : isCollapsed(n.data.node) ? { ...n, height: GROUP_HEAD, style: { ...n.style, pointerEvents: "none" as const } } : n));
  }, [nodes, memberMap]);
  // Edges to or from a card hidden in a collapsed group are drawn to the group itself (its summary edge); both ends in one group: hidden.
  const shownEdges = useMemo(() => {
    const owner = new Map<string, string>();
    for (const n of nodes) if (isCollapsed(n.data.node)) for (const id of memberMap.get(n.id) ?? []) owner.set(id, n.id);
    const out: Edge[] = [];
    for (const e of edges) {
      const a = owner.get(e.source), b = owner.get(e.target);
      const d = decorateEdge(e, edgeShape);
      if (!a && !b) { out.push(d); continue; }
      if (a && a === b) continue;
      out.push({ ...d, id: e.id, source: a ?? e.source, target: b ?? e.target, sourceHandle: a ? "right" : e.sourceHandle, targetHandle: b ? "left" : e.targetHandle, selectable: false, focusable: false });
    }
    return out;
  }, [edges, edgeShape, nodes, memberMap]);
  const onGroups = (p: Partial<{ collapsible: boolean; pattern: Pattern }>) => {
    if (p.collapsible !== undefined) setMeta({ lumenGroups: { collapsible: p.collapsible } });
    if (p.pattern) { const all = !selGroups.length; setNodes((ns) => ns.map((n) => (n.data.node.type === "group" && (all || n.selected) ? { ...n, data: { node: setPattern(n.data.node, p.pattern!) } } : n))); }
  };
  const onBg = (p: { pattern?: Pattern; color?: string | null }) => setMeta({ lumenBackground: { ...meta.lumenBackground, ...(p.pattern ? { pattern: p.pattern } : {}), ...(p.color === null ? { color: undefined } : p.color ? { color: p.color } : {}) } });
  const bgPat = bgPatternOf(meta), bgCol = bgColorOf(meta);
  const exampleCount = groupCtx.counts.get((selGroups[0] ?? groupNodes[0])?.id ?? "") ?? 7;
  // Moving a collapsed group carries the cards it hides.
  const groupDrag = useRef<{ id: string; x: number; y: number } | null>(null);

  const delSelected = () => {
    const ids = new Set(nodesRef.current.filter((n) => n.selected && !isLocked(n.data.node)).map((n) => n.id));
    setNodes((ns) => ns.filter((n) => !ids.has(n.id)));
    setEdges((es) => es.filter((e) => !e.selected && !ids.has(e.source) && !ids.has(e.target)));
  };
  const doLayout = (k: "grid" | "tree" | "force") => { load(layout(fromFlow(nodes, edges), k)); setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 50); };
  const fit = () => rf.fitView({ padding: 0.2, duration: 300 });
  const startTidy = () => {
    if (tidyPrev || !nodes.length) return;
    commit();
    tidyOn.current = true;
    const cur = fromFlow(nodes, edges);
    const r = tidyCanvas(cur, { keepPinned: true });
    load(r.canvas);
    setTidyPrev({ prev: cur, stats: { moved: r.moved, before: r.before, after: r.after, pinned: r.pinned } });
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 50);
  };
  const cancelTidy = () => { if (!tidyPrev) return; tidyOn.current = false; load(tidyPrev.prev); setTidyPrev(null); setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 50); };
  const applyTidy = () => {
    if (!tidyPrev) return;
    const { stats } = tidyPrev;
    setTidyPrev(null);
    tidyOn.current = false;
    nextKey.current = "tidy";
    commit(); // Tidy up = one history step; the toast's Undo uses the same stack as Ctrl Z
    toast(t("Tidied up · {n} card moved|Tidied up · {n} cards moved", { n: stats.moved }), { label: t("Undo"), run: () => { undo(); setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 50); } });
  };
  const selPinned = selected.length > 0 && selected.every((n) => isPinned(n.data.node));
  const togglePin = () => {
    if (!selected.length) return toast(t("Select the cards to pin first"));
    const on = !selPinned;
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: { node: setPinned(n.data.node, on) } } : n)));
    toast(on ? t("Pinned {n} card · Tidy up leaves it|Pinned {n} cards · Tidy up leaves them", { n: selected.length }) : t("Unpinned"));
  };
  const selLocked = selected.length > 0 && selected.every((n) => isLocked(n.data.node));
  const toggleLock = () => {
    if (!selected.length) return toast(t("Select the cards to lock first"));
    const on = !selLocked;
    setNodes((ns) => ns.map((n) => { if (!n.selected) return n; const node = setLocked(n.data.node, on); return { ...n, ...lockFlags(node), data: { node } }; }));
    toast(on ? t("Locked {n} card|Locked {n} cards", { n: selected.length }) : t("Unlocked"));
  };

  // ------------------------------------------------------------ selection editing: clipboard, duplicate, nudge, align, order
  const selSet = () => new Set(nodesRef.current.filter((n) => n.selected).map((n) => n.id));
  const clip = useRef<string | null>(null); // last copy, for the menu's Paste when the system clipboard can't be read
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const copySel = (): string | null => {
    const ids = selSet();
    if (!ids.size) return null;
    const s = stringify(pickSelection(fromFlow(nodesRef.current, edgesRef.current), ids));
    clip.current = s;
    return s;
  };
  const pasteAt = () => {
    const r = boardRef.current?.getBoundingClientRect();
    const p = pointer.current;
    if (r && p && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) return rf.screenToFlowPosition(p);
    return center();
  };
  /** Paste: JSON Canvas (Lumen, another canvas, Obsidian) keeps cards + edges; a URL becomes a link card, other text a text card. */
  const pasteText = (text: string) => {
    const s = text.trim();
    if (!s) return false;
    const frag = canvasFromText(s)
      ?? (/^https?:\/\/\S+$/.test(s) ? { nodes: [{ id: "p", type: "link", url: s, x: 0, y: 0, width: 300, height: 84 }] } as JsonCanvas
        : { nodes: [{ id: "p", type: "text", text: s, x: 0, y: 0, width: 260, height: Math.min(400, 60 + 19 * s.split("\n").length) }] } as JsonCanvas);
    const r = cloneFragment(frag, { at: pasteAt(), grid: view.snap ? 20 : undefined });
    const cur = fromFlow(nodesRef.current, edgesRef.current);
    load({ nodes: [...(cur.nodes ?? []), ...(r.canvas.nodes ?? [])], edges: [...(cur.edges ?? []), ...(r.canvas.edges ?? [])] }, r.ids);
    return true;
  };
  const pasteMenu = async () => {
    let text = "";
    try { text = await navigator.clipboard.readText(); } catch { /* permission refused: use the last copy */ }
    if (!pasteText(text || clip.current || "")) toast(t("Nothing to paste"));
  };
  const copyMenu = async (cut = false) => {
    const s = copySel();
    if (!s) return toast(t("Select cards first"));
    try { await navigator.clipboard.writeText(s); } catch { /* the in-app copy still works */ }
    if (cut) delSelected();
    else toast(t("Copied {n} card|Copied {n} cards", { n: selected.length }));
  };
  // ------------------------------------------------------------ edges: reconnect, labels in place (CanvasEdge.tsx)
  const [edgeEdit, setEdgeEdit] = useState<string | null>(null);
  const edgeApi: CanvasEdgeApi = {
    editing: edgeEdit, setEditing: setEdgeEdit,
    saveLabel: (id, text) => { const x = text.trim(); setEdges((es) => es.map((e) => (e.id !== id ? e : { ...e, label: x || undefined, data: { edge: { ...edgeOf(e), ...(x ? { label: x } : {}) } } }))); },
    reconnect: (id, end, node, side) => setEdges((es) => es.map((e) => {
      if (e.id !== id) return e;
      if ((end === "source" ? e.target : e.source) === node) return e; // no self-loops
      return end === "source" ? { ...e, source: node, sourceHandle: side ?? null, selected: true } : { ...e, target: node, targetHandle: side ?? null, selected: true };
    })),
  };
  /** Ctrl+G: a group around the selected cards (groups are spatial: everything inside belongs to it). */
  const groupSel = () => {
    const sel = nodesRef.current.filter((n) => n.selected && n.data.node.type !== "group");
    if (!sel.length) return;
    const ns = sel.map((n) => n.data.node);
    const x0 = Math.min(...ns.map((n) => n.x)), y0 = Math.min(...ns.map((n) => n.y)), x1 = Math.max(...ns.map((n) => n.x + n.width)), y1 = Math.max(...ns.map((n) => n.y + n.height));
    addNode({ type: "group", label: t("Group"), width: x1 - x0 + 80, height: y1 - y0 + 100 }, { x: x0 - 40, y: y0 - 60 });
  };
  const duplicateSel = () => {
    const ids = selSet();
    if (!ids.size) return;
    const cur = fromFlow(nodesRef.current, edgesRef.current);
    const r = cloneFragment(pickSelection(cur, ids), { offset: 40 });
    load({ nodes: [...(cur.nodes ?? []), ...(r.canvas.nodes ?? [])], edges: [...(cur.edges ?? []), ...(r.canvas.edges ?? [])] }, r.ids);
  };
  const selectAll = () => { setNodes((ns) => ns.map((n) => (n.selected ? n : { ...n, selected: true }))); setEdges((es) => es.map((e) => (e.selected ? e : { ...e, selected: true }))); };
  const nudge = (dx: number, dy: number) => {
    const ids = new Set(selected.filter((n) => !isLocked(n.data.node)).map((n) => n.id));
    if (!ids.size) return;
    for (const id of [...ids]) if (isCollapsed(nodesRef.current.find((n) => n.id === id)?.data.node ?? ({} as CanvasNode))) for (const m of memberMap.get(id) ?? []) ids.add(m);
    nextKey.current = `nudge:${[...ids].sort().join()}`; // a run of arrow presses = one step
    setNodes((ns) => ns.map((n) => (ids.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)));
  };
  const align = (m: AlignMode) => {
    const dist = m === "hspace" || m === "vspace";
    if (selected.length < (dist ? 3 : 2)) return toast(dist ? t("Select 3 or more cards to distribute") : t("Select 2 or more cards to align"));
    load(alignNodes(fromFlow(nodes, edges), selSet(), m));
  };
  const order = (to: "front" | "back") => { if (!selected.length) return; load(reorder(fromFlow(nodes, edges), selSet(), to)); };
  const zoomToSel = () => (selected.length ? rf.fitView({ nodes: selected.map((n) => ({ id: n.id })), padding: 0.3, maxZoom: 1.5, duration: 300 }) : fit());
  // Canvases from the first diagram version (text cards) are upgraded to .mermaid file cards once, on open.
  useEffect(() => { if (note.body.includes("lumenDiagram")) void migrateDiagramCards(note, v.notes, v.folders).then((c) => c && toast(t("Diagram cards upgraded to .mermaid files"))); }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Arrived from a note's diagram ("Open in canvas"): select that card and centre it, once it exists (a just-saved
  // card can arrive a moment after the canvas opens).
  useEffect(() => {
    const f = diagramFocus.canvas;
    if (!f || f.canvasId !== note.id || !nodes.some((n) => n.id === f.nodeId)) return;
    diagramFocus.canvas = null;
    setNodes((ns) => ns.map((n) => (n.selected !== (n.id === f.nodeId) ? { ...n, selected: n.id === f.nodeId } : n)));
    setTimeout(() => rf.fitView({ nodes: [{ id: f.nodeId }], padding: 0.25, maxZoom: 1, duration: 400 }), 80);
  }, [nodes, note.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // A drag or resize is one history step: nothing is recorded until it ends (no step per frame).
  const onNodesChangeH = useCallback((ch: NodeChange<FlowNode>[]) => {
    for (const c of ch) if (c.type === "dimensions" && typeof c.resizing === "boolean") busy.current = c.resizing;
    onNodesChange(ch);
  }, [onNodesChange]);
  const dragStart = useCallback((_e: unknown, a: FlowNode | FlowNode[], b?: FlowNode[]) => {
    commit(); // settle anything pending first, then remember what the drag picked up (restored on undo)
    busy.current = true;
    const dragged = Array.isArray(a) ? a : b ?? [a];
    const gd = dragged.find((n) => n.data.node.type === "group" && isCollapsed(n.data.node));
    groupDrag.current = gd ? { id: gd.id, x: gd.position.x, y: gd.position.y } : null;
    hist.current!.select([...new Set([...dragged.map((n) => n.id), ...edgesRef.current.filter((e) => e.selected).map((e) => e.id)])]);
  }, [commit]);
  const dragStop = useCallback((_e?: unknown, nodeOrList?: FlowNode | FlowNode[]) => {
    const node = Array.isArray(nodeOrList) ? undefined : nodeOrList;
    const gd = groupDrag.current;
    groupDrag.current = null;
    if (gd && node && node.id === gd.id) {
      const dx = node.position.x - gd.x, dy = node.position.y - gd.y, ids = new Set(memberMapRef.current.get(gd.id) ?? []);
      if (ids.size && (dx || dy)) setNodes((ns) => ns.map((n) => (ids.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)));
    }
    busy.current = false; scheduleCommit();
  }, [scheduleCommit, setNodes]);
  const onConnect = (c: Connection) => {
    // Connection check (14b-K): no self links, no second edge between the same two cards.
    const name = (id: string) => { const n = nodes.find((x) => x.id === id)?.data.node; return !n ? id : n.type === "text" ? (splitTitle(n.text).title || n.text.split("\n")[0] || "Card").slice(0, 40) : n.type === "file" ? n.file.replace(/\.md$/i, "") : n.type === "link" ? n.url : n.label ?? "Group"; };
    const chk = checkNewEdge(edges.map((e) => ({ from: e.source, to: e.target })), c.source, c.target, name);
    if (!chk.ok) { toast(chk.title, undefined, { sub: chk.body }); return; }
    setEdges((es) => addEdge({ ...c, id: crypto.randomUUID().slice(0, 12), type: "straight", data: { edge: { id: "", fromNode: c.source, toNode: c.target, ...edgeStyleOf(defEdge) } }, labelBgPadding: [8, 3], labelBgBorderRadius: 6 }, es));
  };
  const refit = () => setTimeout(() => rf.fitView({ padding: 0.12, maxZoom: 1, duration: 200 }), 60);
  const togglePanel = (t: CodeTab) => { if (t === "json") setCodeText(stringify(snap())); setPanel((p) => (p === t ? null : t)); refit(); };
  const switchTab = (t: CodeTab) => { if (t === "json") setCodeText(stringify(snap())); setPanel(t); };
  const exportCanvas = () => download(`${note.title}.canvas`, stringify(snap()), "application/json");

  // ⌘` toggles the script console.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "`") { e.preventDefault(); setPanel((p) => (p === "script" ? null : "script")); } };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);
  // Shift+T = Tidy up; Esc / Enter answer the preview.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (isTidyKey(e)) { e.preventDefault(); startTidy(); }
      else if (tidyPrev && e.key === "Escape") cancelTidy();
      else if (tidyPrev && e.key === "Enter" && !(e.target as HTMLElement)?.closest?.("input,textarea,.cm-editor")) { e.preventDefault(); applyTidy(); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });
  // Board shortcuts (capture phase, so the board's keys win over app-wide ones while the canvas is open). In a text
  // field none of these run: the field keeps its own undo, select all and arrows.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (isEditable(e.target) || !onBoard(e.target)) return;
      const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (keysOpen && e.key === "Escape") { stop(); setKeysOpen(false); }
      else if (mod && !e.altKey && key === "z") { stop(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && !e.altKey && !e.shiftKey && key === "y") { stop(); redo(); }
      else if (mod && !e.altKey && !e.shiftKey && key === "a") { stop(); selectAll(); }
      else if (mod && !e.altKey && !e.shiftKey && key === "d") { stop(); duplicateSel(); }
      else if (mod && !e.altKey && !e.shiftKey && key === "g") { stop(); groupSel(); }
      else if (!mod && (e.key === "Enter" || e.key === "F2") && (selected.length + edgesRef.current.filter((x) => x.selected).length) === 1) {
        stop();
        const se = edgesRef.current.find((x) => x.selected);
        if (se) setEdgeEdit(se.id); else dispatchEvent(new CustomEvent("lumen-canvas-edit", { detail: selected[0].id }));
      }
      else if (e.key === "Escape" && !tidyPrev && (selected.length || edgesRef.current.some((x) => x.selected))) { stop(); setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n))); setEdges((es) => es.map((x) => (x.selected ? { ...x, selected: false } : x))); }
      else if (mod && e.shiftKey && key === "l") { stop(); toggleLock(); }
      else if (mod && e.shiftKey && e.code === "BracketRight") { stop(); order("front"); }
      else if (mod && e.shiftKey && e.code === "BracketLeft") { stop(); order("back"); }
      else if (!mod && !e.altKey && e.key.startsWith("Arrow") && selected.length) {
        stop();
        const step = view.snap ? (e.shiftKey ? 100 : 20) : e.shiftKey ? 10 : 1;
        const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, number[]>)[e.key];
        if (d) nudge(d[0], d[1]);
      }
      else if (!mod && !e.altKey && e.shiftKey && e.code === "Digit1") { stop(); fit(); }
      else if (!mod && !e.altKey && e.shiftKey && e.code === "Digit2") { stop(); zoomToSel(); }
      else if (!mod && (e.key === "?" || e.key === "\u061F")) { stop(); setKeysOpen((o) => !o); }
    };
    const copy = (e: ClipboardEvent, cut: boolean) => {
      if (isEditable(e.target) || !onBoard(e.target) || getSelection()?.toString()) return;
      const s = copySel();
      if (!s) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", s);
      if (cut) delSelected();
    };
    const onCopy = (e: ClipboardEvent) => copy(e, false), onCut = (e: ClipboardEvent) => copy(e, true);
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target) || !onBoard(e.target)) return;
      if (pasteText(e.clipboardData?.getData("text/plain") ?? "")) e.preventDefault();
    };
    addEventListener("keydown", k, true);
    addEventListener("copy", onCopy); addEventListener("cut", onCut); addEventListener("paste", onPaste);
    return () => { removeEventListener("keydown", k, true); removeEventListener("copy", onCopy); removeEventListener("cut", onCut); removeEventListener("paste", onPaste); };
  });

  // The swatch that matches the selection (or the default colour for new cards).
  const curColor = anySel ? (selected[0]?.data.node.color ?? null) : defColor ?? null;

  async function run() {
    try { localStorage.setItem("lumen.canvasScript", src); } catch { /* ignore */ }
    const helpers = { notes: v.notes.map((n) => ({ id: n.id, title: n.title, tags: n.tags, type: n.type, status: n.status })), outline: fromOutline };
    const t0 = performance.now();
    const r = await runScript(src, fromFlow(nodes, edges), helpers);
    setLogs([...r.logs, ...(r.error ? [`${LOG_ERR} ${r.error}`] : [`${LOG_OK} ${t("done · {n} nodes · {ms} ms · restore from History", { n: r.canvas.nodes?.length ?? 0, ms: Math.round(performance.now() - t0) })}`])]);
    if (!r.error) { load(r.canvas); setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 50); }
  }

  // ------------------------------------------------------------ ⋯ conversions (always copies; the new file opens)
  const where = { spaceId: note.spaceId, folderId: note.folderId };
  const toWhiteboard = async (skel: Skeleton[], title: string, openMermaid = false) => {
    const w = await createNote({ type: "whiteboard", title, ...where, body: JSON.stringify({ type: "excalidraw", version: 2, source: "lumen", elements: [], ...(skel.length ? { lumenPending: skel } : {}) }) });
    if (openMermaid) try { sessionStorage.setItem("lumen.wbMermaid.open", w.id); } catch { /* ignore */ }
    openNote(w.id);
  };
  const convertCanvas = () => toWhiteboard(canvasToSkeleton(fromFlow(nodes, edges)), `${note.title} (whiteboard)`);
  const convertMermaid = async () => {
    // Mermaid blocks in this board's text cards (and the notes its file cards point to).
    const texts = nodes.map((n) => n.data.node).flatMap((n) => n.type === "text" ? [n.text] : n.type === "file" ? [v.byTitle.get(n.file.replace(/\.md$/i, "").split("/").pop()!.toLowerCase())?.body ?? ""] : []);
    const blocks = texts.flatMap((t) => [...t.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)].map((m) => m[1].trim()));
    if (!blocks.length) { toast(t("No Mermaid block on this board: write it in the dialog")); return toWhiteboard([], `${note.title} (diagram)`, true); }
    try {
      const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
      const skel: Skeleton[] = [];
      let dy = 0;
      for (const b of blocks) {
        const { elements } = await parseMermaidToExcalidraw(b);
        const els = elements as Skeleton[];
        const maxY = Math.max(0, ...els.map((e) => ((e.y as number) ?? 0) + ((e.height as number) ?? 0)));
        skel.push(...els.map((e) => ({ ...e, y: ((e.y as number) ?? 0) + dy })));
        dy += maxY + 120;
      }
      await toWhiteboard(skel, `${note.title} (diagram)`);
    } catch (e) { toast(t("Mermaid: {error}", { error: (e as Error).message })); }
  };
  const convertOutline = async (src: Note) => {
    const c = fromOutline(src.body);
    if (!c.nodes?.length) return toast(t("That note has no headings or bullets to map"));
    const n = await createNote({ type: "canvas", title: `${src.title} (map)`, body: stringify(c), ...where });
    openNote(n.id);
  };
  const duplicate = async () => { const d = await duplicateNote(note.id); if (d) openNote(d.id); };
  const del = async () => { await trashNote(note.id); setUI({ noteId: null }); toast(t("Canvas moved to trash"), { label: t("Undo"), run: () => { void restoreNote(note.id); openNote(note.id); } }); };

  const addTools: Tool[] = [
    // [name (English key, rendered with t()), icon, label (translated), run, on]
    [tk("Text"), <Type size={15} />, t("Add text card"), () => addNode({ type: "text", text: "" })],
    [tk("Diagram"), <Waypoints size={15} />, t("New .mermaid diagram file on this canvas"), async () => { const folderId = await diagramFolderFor(note.spaceId, note.folderId, getSettings().diagramFolder ?? "sub", v.folders); const f = await newDiagramFile({ spaceId: note.spaceId, folderId }, v.notes); addNode({ type: "file", file: f.title, width: 560, height: 380 }); toast(t("Created {title}", { title: f.title }), { label: t("Open"), run: () => openNote(f.id, "edit") }); }],
    [tk("Note"), <FilePlus size={15} />, t("Add note card"), () => { const nt = prompt(t("Note title")); if (nt) addNode({ type: "file", file: nt, width: 300, height: 200 }); }],
    [tk("Link"), <Link2 size={15} />, t("Add link card"), () => { const u = prompt("URL", "https://"); if (u) addNode({ type: "link", url: u, width: 300, height: 84 }); }],
    [tk("Group"), <Group size={15} />, t("Add group"), () => addNode({ type: "group", label: "Group", width: 600, height: 400 })],
  ];
  const arrangeTools: Tool[] = [
    [tk("Tidy up"), <Glyph name="wide" size={15} color="var(--accent)" />, t("Tidy up: lay out by links, keep groups and pinned cards (Shift T)"), startTidy],
    [tk("Pin"), <Pin size={15} />, selPinned ? t("Unpin selected cards") : t("Pin selected cards (Tidy up leaves them)"), togglePin, selPinned],
    [tk("Lock"), <Lock size={15} />, selLocked ? t("Unlock selected cards ({keys})", { keys: `${MOD} Shift L` }) : t("Lock selected cards: no moving, resizing or deleting ({keys})", { keys: `${MOD} Shift L` }), toggleLock, selLocked],
    [tk("Align"), <AlignStartVertical size={15} />, t("Align, distribute and order the selection"), () => setMenu((m) => (m === "align" ? null : "align")), menu === "align"],
    [tk("Tree"), <Network size={15} />, t("Tree layout"), () => doLayout("tree")],
    [tk("Grid"), <LayoutGrid size={15} />, t("Grid layout"), () => doLayout("grid")],
    [tk("Force"), <Orbit size={15} />, t("Force layout"), () => doLayout("force")],
  ];
  const codeTools: Tool[] = [
    ["JSON", <Code2 size={15} />, t("Code: edit as JSON Canvas"), () => togglePanel("json"), panel === "json"],
    [tk("Script"), <SquareTerminal size={15} />, t("Script console (Ctrl `)"), () => togglePanel("script"), panel === "script"],
    [tk("Export"), <Download size={15} />, t("Download .canvas"), exportCanvas],
    [tk("Image"), <ImageIcon size={15} />, t("Export as image: SVG, PNG, JPEG, WebP (diagram cards included)"), () => openCanvasExport()],
  ];
  const histTools: Tool[] = [
    [tk("Undo"), <Undo2 size={15} />, t("Undo ({keys})", { keys: `${MOD} Z` }), undo, false, !hist.current.canUndo || !!tidyPrev],
    [tk("Redo"), <Redo2 size={15} />, t("Redo ({keys})", { keys: `${MOD} Shift Z` }), redo, false, !hist.current.canRedo || !!tidyPrev],
  ];
  const alignTools: [AlignMode, ReactNode, string][] = [
    ["left", <AlignStartVertical size={15} />, t("Align left")], ["hcenter", <AlignCenterVertical size={15} />, t("Align centres (horizontal)")], ["right", <AlignEndVertical size={15} />, t("Align right")],
    ["top", <AlignStartHorizontal size={15} />, t("Align top")], ["vcenter", <AlignCenterHorizontal size={15} />, t("Align middles (vertical)")], ["bottom", <AlignEndHorizontal size={15} />, t("Align bottom")],
  ];

  // ------------------------------------------------------------ toolbar fit (see MAX_LVL): measured against its own board
  const barRef = useRef<HTMLDivElement>(null);
  const [lvl, setLvl] = useState(0);
  const [boardW, setBoardW] = useState(0);
  useEffect(() => {
    const el = boardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => setBoardW(Math.round(es[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fitKey = `${boardW}|${lang.lang}`;
  const fitFor = useRef("");
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || !boardW || !bar.offsetParent) return; // hidden on phones
    if (fitFor.current !== fitKey) { fitFor.current = fitKey; if (lvl !== 0) { setLvl(0); return; } }
    if (bar.scrollWidth > boardW - 24 && lvl < MAX_LVL) setLvl(lvl + 1);
  });
  const shownAdd = lvl >= 7 ? addTools.slice(0, 1) : addTools;
  const shownArrange = lvl >= 6 ? arrangeTools.slice(0, 1) : arrangeTools;

  const ring = "0 0 0 2px var(--surface),0 0 0 3.5px var(--text)";
  const swatches = (size: string) => (
    <span className="flex items-center gap-[5px] px-1">
      {Object.entries(PRESETS).map(([k, c]) => (
        <button key={k} title={anySel ? (curColor === k ? t("Remove colour") : t("Colour {c}", { c: k })) : t("Default colour {c} for new cards", { c: k })} aria-label={t("Colour {c}", { c: k })} onClick={() => setColor(curColor === k ? undefined : k)} className={cx(size, "shrink-0 rounded-full")}
          style={{ background: c, boxShadow: curColor === k ? ring : undefined }} />
      ))}
    </span>
  );

  const conversions: [ReactNode, ReactNode, string, string, () => void][] = [
    [<ListTree size={13} />, <LayoutDashboard size={13} />, t("Note outline → Canvas"), t("headings → cards"), () => setMenu("outline")],
    [<LayoutDashboard size={13} />, <Pencil size={13} />, t("Canvas → Whiteboard"), t("cards → shapes"), () => { setMenu(null); void convertCanvas(); }],
    [<Workflow size={13} />, <Pencil size={13} />, t("Mermaid block → Whiteboard"), t("editable shapes"), () => { setMenu(null); void convertMermaid(); }],
  ];
  const menuEl = menu && (
    <>
      <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} />
      <div className="absolute end-3 top-[-6px] z-30 flex max-h-[calc(100%-12px)] w-max min-w-[300px] max-w-[calc(100%-24px)] flex-col gap-px overflow-y-auto whitespace-nowrap rounded-[12px] border border-line bg-surface-2 p-1.5 text-[13px] shadow-[0_16px_40px_rgba(0,0,0,.45)] fade-in max-md:bottom-[150px] max-md:top-auto max-md:max-h-[calc(100%-170px)]">
        {menu === "outline" ? <OutlinePicker exclude={note.id} onPick={(n) => { setMenu(null); void convertOutline(n); }} onBack={() => setMenu("main")} /> : menu === "align" ? (
          <>
            <span className={MENU_HEAD}>{t("Align")}</span>
            <div className="grid shrink-0 grid-cols-6 gap-0.5 px-1 pb-1">
              {alignTools.map(([m, icon, label]) => <button key={m} title={label} aria-label={label} disabled={selected.length < 2} onClick={() => align(m)} className={cx(TOOL, "w-full")}>{icon}</button>)}
            </div>
            <MenuRow icon={<AlignHorizontalSpaceAround />} label={t("Distribute horizontally")} off={selected.length < 3} onClick={() => align("hspace")} />
            <MenuRow icon={<AlignVerticalSpaceAround />} label={t("Distribute vertically")} off={selected.length < 3} onClick={() => align("vspace")} />
            <div className="m-1 h-px shrink-0 bg-line" />
            <MenuRow icon={<BringToFront />} label={t("Bring to front")} keys={`${MOD} Shift ]`} off={!selected.length} onClick={() => order("front")} />
            <MenuRow icon={<SendToBack />} label={t("Send to back")} keys={`${MOD} Shift [`} off={!selected.length} onClick={() => order("back")} />
            {selected.length < 2 && <span className="px-2.5 py-1.5 text-[12px] text-muted">{t("Select 2 or more cards to align")}</span>}
          </>
        ) : (
          <>
            {lvl >= 7 && <><span className={MENU_HEAD}>{t("Add")}</span>{addTools.slice(1).map(([name, icon, , fn]) => <MenuRow key={name} icon={icon} label={t(name)} onClick={() => { setMenu(null); fn(); }} />)}</>}
            {lvl >= 6 && <><span className={MENU_HEAD}>{t("Arrange")}</span>{arrangeTools.slice(1).map(([name, icon, , fn, on]) => <MenuRow key={name} icon={icon} label={t(name)} on={name === "Pin" || name === "Lock" ? !!on : undefined} onClick={() => { if (name !== "Align") setMenu(null); fn(); }} />)}</>}
            {lvl >= 5 && <><span className={MENU_HEAD}>{t("Style")}</span><div className="flex h-9 shrink-0 items-center px-1.5">{swatches("size-5")}</div></>}
            {lvl >= 4 && <><span className={MENU_HEAD}>{t("Code")}</span>{codeTools.map(([name, icon, , fn, on]) => <MenuRow key={name} icon={icon} label={t(name)} on={name === "JSON" || name === "Script" ? !!on : undefined} onClick={() => { setMenu(null); fn(); }} />)}</>}
            {lvl >= 4 && <div className="m-1 h-px shrink-0 bg-line" />}
            <span className={MENU_HEAD}>{t("Edit")}</span>
            <MenuRow icon={<Copy />} label={t("Copy")} keys={`${MOD} C`} off={!selected.length} onClick={() => { setMenu(null); void copyMenu(); }} />
            <MenuRow icon={<Scissors />} label={t("Cut")} keys={`${MOD} X`} off={!selected.length} onClick={() => { setMenu(null); void copyMenu(true); }} />
            <MenuRow icon={<ClipboardPaste />} label={t("Paste")} keys={`${MOD} V`} onClick={() => { setMenu(null); void pasteMenu(); }} />
            <MenuRow icon={<CopyPlus />} label={t("Duplicate cards")} keys={`${MOD} D`} off={!selected.length} onClick={() => { setMenu(null); duplicateSel(); }} />
            <MenuRow icon={<Focus />} label={t("Zoom to selection")} keys="Shift 2" onClick={() => { setMenu(null); zoomToSel(); }} />
            <div className="m-1 h-px shrink-0 bg-line" />
            <span className={MENU_HEAD}>{t("View")}</span>
            <MenuRow icon={<Grid3x3 />} label={t("Snap to grid")} on={view.snap} onClick={() => setView({ snap: !view.snap })} />
            <MenuRow icon={<MapIcon />} label={t("Minimap")} on={view.minimap} onClick={() => setView({ minimap: !view.minimap })} />
            <MenuRow icon={<SlidersHorizontal />} label={t("Canvas options")} on={optsOpen} onClick={() => { setMenu(null); setOptsOpen(true); }} />
            <MenuRow icon={<Keyboard />} label={t("Keyboard shortcuts")} keys="?" onClick={() => { setMenu(null); setKeysOpen(true); }} />
            <MenuRow icon={<Presentation />} label={t("Present groups as slides")} onClick={() => { setMenu(null); setPresenting(true); }} />
            <div className="m-1 h-px shrink-0 bg-line" />
            <span className={MENU_HEAD}>{t("Convert")}</span>
            <MenuRow icon={<Shuffle />} label={t("Convert…")} onClick={() => { setMenu(null); setConvOpen(true); }} />
            {conversions.map(([a, b, l, n, fn]) => (
              <button key={l} onClick={fn} className="flex h-10 items-center gap-2.5 rounded-[8px] px-2.5 text-start hover:bg-bg">
                <span className="flex items-center gap-[3px] rounded-[6px] border border-line bg-bg px-1.5 py-[3px] text-muted">{a}<ArrowRight size={10} /><span className="text-ink">{b}</span></span>
                <span className="flex-1">{l}</span><span className="text-[11.5px] text-muted">{n}</span>
              </button>
            ))}
            <div className="m-1 h-px bg-line" />
            <span className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t("Edges")}</span>
            <div className="px-1.5 pb-1.5 text-[12px]"><EdgeSeg value={edgeShape} onChange={setEdgeShape} /></div>
            <div className="m-1 h-px bg-line" />
            <button onClick={() => { setMenu(null); exportCanvas(); }} className="flex h-[34px] items-center gap-2.5 rounded-[8px] px-2.5 text-start hover:bg-bg"><Download size={14} className="text-muted" />{t("Export .canvas")}</button>
            <button onClick={() => { setMenu(null); void duplicate(); }} className="flex h-[34px] items-center gap-2.5 rounded-[8px] px-2.5 text-start hover:bg-bg"><Copy size={14} className="text-muted" />{t("Duplicate canvas")}</button>
            <button onClick={() => { setMenu(null); void del(); }} className="flex h-[34px] items-center gap-2.5 rounded-[8px] px-2.5 text-start text-bad hover:bg-bg"><Trash2 size={14} />{t("Delete canvas")}</button>
          </>
        )}
      </div>
    </>
  );

  return (
    <Ctx.Provider value={ctx}>
    <GroupCtx.Provider value={groupCtx}>
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <style>{CANVAS_CSS}</style>
      <DndHost />
      <div ref={boardRef} className={cx("lumen-canvas relative min-h-0 flex-1", connecting && "connecting")}
        onPointerMove={(e) => { pointer.current = { x: e.clientX, y: e.clientY }; }}
        // A highlight dragged from the PDF reader's panel → highlight card where it's dropped.
        onDragOver={(e) => { if (e.dataTransfer.types.includes(HL_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
        onDrop={(e) => { const d = hlDropNode(e.dataTransfer); if (!d) return; e.preventDefault(); const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }); const { id: _id, x: _x, y: _y, ...rest } = d; addNode(rest, { x: Math.round(p.x / 20) * 20, y: Math.round(p.y / 20) * 20 }); }}
        onDoubleClick={(e) => {
          // Double-click on empty space = new text card there.
          if (!(e.target as HTMLElement).classList.contains("react-flow__pane")) return;
          const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          addNode({ type: "text", text: "" }, { x: Math.round(p.x / 20) * 20, y: Math.round(p.y / 20) * 20 });
        }}>
        <CanvasEdgeCtx.Provider value={edgeApi}><ReactFlow
          nodes={shownNodes} edges={shownEdges} onNodesChange={onNodesChangeH} onEdgesChange={onEdgesChange} onConnect={onConnect} nodeTypes={nodeTypes} edgeTypes={canvasEdgeTypes}
          onNodeDragStart={dragStart} onNodeDragStop={dragStop} onSelectionDragStart={dragStart} onSelectionDragStop={dragStop}
          onConnectStart={() => setConnecting(true)} onConnectEnd={() => setConnecting(false)}
          connectionMode={ConnectionMode.Loose} fitView fitViewOptions={{ padding: 0.15, maxZoom: 1, ...(typeof innerWidth === "number" && innerWidth < 768 ? { minZoom: 0.62 } : {}) }} minZoom={0.05} maxZoom={3} snapToGrid={view.snap} snapGrid={[20, 20]} zoomOnDoubleClick={false}
          deleteKeyCode={["Delete", "Backspace"]} multiSelectionKeyCode={["Shift", "Meta", "Control"]} proOptions={{ hideAttribution: true }}
          connectionLineStyle={{ stroke: "var(--accent)", strokeWidth: 2 }} style={bgCol ? { background: `color-mix(in srgb, ${colorOf(bgCol)} 10%, var(--bg))` } : undefined}
          onEdgeDoubleClick={(_, e) => setEdgeEdit(e.id)} disableKeyboardA11y
        >
          {bgPat !== "none" && <Background variant={bgPat === "grid" ? BackgroundVariant.Lines : BackgroundVariant.Dots} gap={22} size={bgPat === "grid" ? 1 : 1.1} color={bgPat === "grid" ? "color-mix(in srgb, var(--muted) 16%, transparent)" : "color-mix(in srgb, var(--muted) 35%, transparent)"} />}
          <ZoomPill />
          <MarkerDefs edges={edges} />
          {!panel && !optsOpen && view.minimap && <MiniMap pannable zoomable className="!hidden lg:!block" style={{ width: 176, height: 112 }} nodeBorderRadius={3}
            nodeColor={(n) => { const c = colorOf((n.data as Data).node.color); return c ? `color-mix(in srgb, ${c} 45%, transparent)` : "color-mix(in srgb, var(--muted) 45%, transparent)"; }}
            maskColor="color-mix(in srgb, var(--surface) 55%, transparent)" maskStrokeColor="var(--accent)" maskStrokeWidth={2} />}
        </ReactFlow></CanvasEdgeCtx.Provider>

        {/* Desktop toolbar: Undo Redo | Add | Arrange | Style | Code | ⋯. It fits its own board width (lvl): captions and
            labels go first, then whole groups move into ⋯, so it never runs under the side panel. */}
        <div ref={barRef} className="absolute left-1/2 top-3.5 z-10 hidden max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-0.5 overflow-hidden rounded-[12px] border border-line bg-surface px-1.5 py-1 md:flex">
          {histTools.map(([name, icon, label, fn, , off]) => <button key={name} title={label} aria-label={label} disabled={off} onClick={fn} className={cx(TOOL, "w-8 shrink-0")}>{icon}</button>)}
          {SEP}
          {lvl < 1 && <span className={CAPTION}>{t("Add")}</span>}
          {shownAdd.map(([, icon, label, fn]) => <button key={label} title={label} aria-label={label} onClick={fn} className={cx(TOOL, "w-8 shrink-0")}>{icon}</button>)}
          {SEP}
          {lvl < 1 && <span className={CAPTION}>{t("Arrange")}</span>}
          {shownArrange.map(([name, icon, label, fn, on]) => <button key={name} title={label} aria-label={label} onClick={fn} className={cx(TOOL, "shrink-0 whitespace-nowrap px-2 text-[12px]", on && "bg-surface-2 text-accent", name === "Tidy up" && "font-semibold")}>{icon}{(name === "Tidy up" ? lvl < 3 : lvl < 2) && <span>{t(name)}</span>}</button>)}
          {lvl < 5 && <>{SEP}{lvl < 1 && <span className={CAPTION}>{t("Style")}</span>}{swatches("size-4")}<button title={t("Canvas options: shapes, borders, edges, groups, background")} aria-label={t("Canvas options")} aria-pressed={optsOpen} onClick={() => setOptsOpen((o) => !o)} className={cx(TOOL, "w-8 shrink-0", optsOpen && "bg-surface-2 text-accent")}><SlidersHorizontal size={15} /></button></>}
          {lvl < 4 && <>{SEP}{lvl < 1 && <span className={CAPTION}>{t("Code")}</span>}{codeTools.map(([, icon, label, fn, on]) => <button key={label} title={label} aria-label={label} onClick={fn} className={cx(TOOL, "w-8 shrink-0", on && "bg-surface-2 text-accent")}>{icon}</button>)}</>}
          {SEP}
          <button title={lvl >= 4 ? t("More: tools, edit, view, convert, export") : t("More: edit, view, convert, export")} aria-label={t("Canvas menu")} onClick={() => setMenu((m) => (m === "main" ? null : "main"))} className={cx(TOOL, "w-8 shrink-0", menu === "main" && "bg-surface-2")}><Ellipsis size={16} /></button>
        </div>
        {menuEl}
        {optsOpen && (
          <div className="fade-in absolute inset-0 z-30 overflow-y-auto bg-bg p-4 md:inset-auto md:bottom-3 md:end-3 md:top-[64px] md:w-[372px] md:bg-transparent md:p-0 md:pe-0.5">
            <CanvasOptions selNodes={selNodes.length} selEdges={selEdges.length} node={nodeStyle} onNode={onNodeStyle} edge={edgeStyle} onEdge={onEdgeStyle}
              color={curColor} anySel={anySel} onColor={setColor} groups={{ collapsible: collapsibleOf(meta), pattern: groupPattern, example: exampleCount }} onGroups={onGroups}
              bg={{ pattern: bgPat, color: bgCol }} onBg={onBg} onClose={() => setOptsOpen(false)} customPalettes={customPalettes}
              onPresent={() => { setOptsOpen(false); setPresenting(true); }}
              onExport={() => { setOptsOpen(false); openCanvasExport(); }} />
          </div>
        )}
        {keysOpen && <CanvasKeys mod={MOD} onClose={() => setKeysOpen(false)} />}
      {convOpen && <ConvertMenu source={() => sourceOf({ ...note, body: stringify(snap()) })} onClose={() => setConvOpen(false)} />}
      {presenting && <CanvasPresenter canvas={snap()} notes={v.notes} title={note.title} noteId={note.id} spaceId={note.spaceId} onExit={() => setPresenting(false)} />}
        {tidyPrev && <TidyBanner stats={tidyPrev.stats} onCancel={cancelTidy} onApply={applyTidy} top={64} />}

        {/* Phone: one bottom tool card, groups as tabs */}
        {!panel && (
          <div className="absolute inset-x-3 bottom-4 z-10 flex flex-col overflow-hidden rounded-[16px] border border-line bg-surface-2 md:hidden">
            <div className="flex h-9 border-b border-line text-[12px] font-semibold text-muted">
              <div className="grid flex-1 grid-cols-4">
                {([["add", tk("Add")], ["arrange", tk("Arrange")], ["style", tk("Style")], ["code", tk("Code")]] as [PhoneTab, string][]).map(([id, l]) => (
                  <button key={id} onClick={() => setPhoneTab(id)} className={cx(phoneTab === id && "text-ink shadow-[inset_0_-2px_0_var(--accent)]")}>{t(l)}</button>
                ))}
              </div>
              <div className="flex items-center border-s border-line">
                {histTools.map(([name, icon, label, fn, , off]) => <button key={name} aria-label={label} title={label} disabled={off} onClick={fn} className="flex h-9 w-10 items-center justify-center text-ink disabled:opacity-35 [&>svg]:size-[17px]">{icon}</button>)}
              </div>
            </div>
            <div className="grid h-[60px] items-center" style={{ gridTemplateColumns: `repeat(${phoneTab === "arrange" ? arrangeTools.length + 1 : phoneTab === "add" ? addTools.length : 4},minmax(0,1fr))` }}>
              {phoneTab === "style" ? (
                <div className="col-span-4 flex items-center justify-center gap-2">{swatches("size-7")}<button aria-label={t("Canvas options")} onClick={() => setOptsOpen(true)} className="flex size-11 items-center justify-center"><SlidersHorizontal size={20} /></button>{anySel && <button aria-label={t("Delete selected")} onClick={delSelected} className="flex size-11 items-center justify-center text-bad"><Trash2 size={20} /></button>}</div>
              ) : (
                (phoneTab === "add" ? addTools : phoneTab === "arrange" ? [...arrangeTools, [tk("Fit"), <Scan size={15} />, t("Fit to screen"), fit] as Tool] : [...codeTools, [tk("More"), <Ellipsis size={15} />, t("Convert, duplicate, delete"), () => setMenu("main")] as Tool]).map(([name, icon, label, fn, on]) => (
                  <button key={name} aria-label={label} onClick={fn} className={cx("flex h-full flex-col items-center justify-center gap-0.5 text-[10.5px] [&>svg]:size-5", on && "text-accent")}>{icon}{t(name)}</button>
                ))
              )}
            </div>
          </div>
        )}

        {!nodes.length && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] text-muted">
            {tx("Empty canvas. Double-click to add a card, paste JSON Canvas in {code}, or generate with a {script}.", { code: <b className="mx-1">{t("Code")}</b>, script: <b className="mx-1">{t("script")}</b> })}
          </div>
        )}
      </div>

      {panel && (
        <CodePanel tab={panel} onTab={switchTab} onClose={() => { setPanel(null); refit(); }}
          phoneRight={panel === "json" ? <ValidChip error={codeErr} big /> : <ExamplesMenu examples={EXAMPLES} onPick={setSrc} />}>
          {panel === "json" ? (
            <>
              <PanelBar>
                <span className="font-semibold">JSON Canvas</span>
                <span className="truncate font-mono text-[11.5px] text-muted">.canvas · 1.0</span>
                <span className="flex-1" />
                <ValidChip error={codeErr} />
                <button title={t("Format (Shift Alt F)")} onClick={() => ed.current?.format()} className="flex h-7 items-center rounded-[8px] border border-line px-2.5 text-muted hover:bg-surface-2 hover:text-ink">{t("Format")}</button>
                <button title={t("Download .canvas")} aria-label={t("Download .canvas")} onClick={exportCanvas} className="flex size-7 items-center justify-center rounded-[8px] border border-line hover:bg-surface-2"><Download size={14} /></button>
              </PanelBar>
              {codeErr && <ErrorBanner error={codeErr} line={errLine} onGoto={() => errLine && ed.current?.goto(errLine)} />}
              <div className="flex min-h-0 flex-1 flex-col md:pt-0" onFocus={() => (jsonFocus.current = true)} onBlur={() => (jsonFocus.current = false)}>
                <CodeEditor value={codeText} onChange={onJson} band={band} handle={ed}
                  onCursor={(c) => { setCursor({ line: c.line, col: c.col }); if (c.user) { const id = itemAt(spans, c.pos); if (id) selectItem(id); } }} />
              </div>
              <ValidFooter error={codeErr} detail={t("{nodes} nodes · {edges} edges · live round-trip", { nodes: nodes.length, edges: edges.length })} cursor={cursor} />
              <PhoneActions>
                <button aria-label={t("Download .canvas")} onClick={exportCanvas} className="flex size-[52px] items-center justify-center rounded-[12px] border border-line"><Download size={18} /></button>
                <button disabled={!!codeErr} onClick={() => { onJson(codeText); setPanel(null); }} className="flex h-[52px] flex-1 items-center justify-center rounded-[12px] bg-accent text-[15px] font-semibold text-accent-fg disabled:opacity-50">{t("Apply")}</button>
              </PhoneActions>
            </>
          ) : (
            <>
              <PanelBar>
                <ExamplesMenu examples={EXAMPLES} onPick={setSrc} />
                <span className="flex-1" />
                <span className="text-[11.5px] text-muted">canvas · helpers · log</span>
                <RunButton onRun={run} />
              </PanelBar>
              <CodeEditor lang="js" value={src} onChange={setSrc} onKeyDown={runKey(run)} />
              <OutputStrip logs={logs} onClear={() => setLogs([])} empty={t("Output appears here. Every change is kept in History, so you can restore the board.")} />
              <PhoneActions><RunButton onRun={run} big /></PhoneActions>
            </>
          )}
        </CodePanel>
      )}
    </div>
    </GroupCtx.Provider>
    </Ctx.Provider>
  );
}

/** "Note outline → Canvas": pick the Markdown note whose headings become cards. */
function OutlinePicker({ exclude, onPick, onBack }: { exclude: string; onPick: (n: Note) => void; onBack: () => void }) {
  const v = useVault();
  const [q, setQ] = useState("");
  const list = v.notes.filter((n) => n.id !== exclude && !["canvas", "whiteboard"].includes(n.type) && /^#{1,6}\s/m.test(n.body) && (!q || n.title.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 7);
  return (
    <>
      <div className="flex items-center gap-2 px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">
        <button onClick={onBack} className="flex items-center gap-1 normal-case tracking-normal hover:text-ink"><ArrowRight size={11} className="rotate-180" />{t("Convert")}</button><span className="flex-1" />{t("Note outline → Canvas")}
      </div>
      <label className="mx-1 mb-1 flex h-8 items-center gap-2 rounded-[8px] border border-line bg-bg px-2.5 text-muted focus-within:border-accent">
        <Search size={13} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Which note? (headings become cards)")} className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted"
          onKeyDown={(e) => { if (e.key === "Enter" && list[0]) onPick(list[0]); }} />
      </label>
      {list.map((n) => (
        <button key={n.id} onClick={() => onPick(n)} className="flex h-9 items-center gap-2.5 rounded-[8px] px-2.5 text-start hover:bg-bg">
          <FileText size={14} className="shrink-0 text-muted" /><span dir="auto" className="flex-1 truncate">{n.title}</span>
          <span className="text-[11.5px] text-muted">{t("{n} heading|{n} headings", { n: (n.body.match(/^#{1,6}\s/gm) ?? []).length })}</span>
        </button>
      ))}
      {!list.length && <span className="px-2.5 py-2 text-[12.5px] text-muted">{t("No note with headings matches.")}</span>}
    </>
  );
}
