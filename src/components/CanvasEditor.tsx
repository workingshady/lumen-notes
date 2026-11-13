import {
  addEdge, Background, BackgroundVariant, ConnectionMode, Handle, MarkerType, MiniMap, NodeResizer, Position, ReactFlow, ReactFlowProvider,
  useEdgesState, useNodesState, useReactFlow, useViewport, type Connection, type Edge, type Node as RFNode, type NodeProps,
} from "@xyflow/react";
import {
  ArrowRight, Code2, Copy, Download, Ellipsis, FilePlus, FileText, GitFork, Group, LayoutDashboard, LayoutGrid, Link2, ListTree, Minus, Network, Orbit, Pencil, Plus, Scan,
  Search, SquareTerminal, Trash2, Type, Workflow,
} from "lucide-react";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CanvasEdge, CanvasNode, JsonCanvas, Note, Side } from "../../shared/types";
import { createNote, duplicateNote, findOrCreateByTitle, restoreNote, trashNote, updateNote } from "../lib/actions";
import { unfurl, type Unfurl } from "../lib/api";
import { colorOf, fromOutline, layout, parseCanvas, PRESETS, runScript, stringify, validate } from "../lib/canvas";
import { download } from "../lib/io";
import { openNote, setUI, toast, useVault } from "../lib/store";
import { canvasToSkeleton, type Skeleton } from "../lib/whiteboard";
import { plainExcerpt } from "./nav-text";
import { Preview } from "./Preview";
import { cx, STATUS_COLOR } from "./ui";
import {
  CodeEditor, CodePanel, ErrorBanner, errorLine, ExamplesMenu, itemAt, jsonItemSpans, OutputStrip, PanelBar, PhoneActions, RunButton, runKey, ValidChip, ValidFooter,
  type CodeEditorHandle, type CodeTab, type Example,
} from "./VisualCodePanel";

type Data = { node: CanvasNode };
type FlowNode = RFNode<Data>;
const SIDE_POS: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };

const Ctx = createContext<{ spaceId: string }>({ spaceId: "" });

// Board chrome in Lumen tokens (CanvasBoard design): amber connection dots + square resize handles on the selection only.
const CANVAS_CSS = `
.lumen-canvas .react-flow__handle { width: 12px; height: 12px; min-width: 0; min-height: 0; border: 0; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px var(--bg); opacity: 0; transition: opacity .12s; }
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
    zIndex: n.type === "group" ? -1 : 0, ...(n.type === "group" ? { dragHandle: ".group-handle" } : {}),
  }));
  const edges = (c.edges ?? []).map(toFlowEdge);
  return { nodes, edges };
}
function toFlowEdge(e: CanvasEdge): Edge {
  const color = colorOf(e.color) ?? "var(--muted)";
  return {
    id: e.id, type: "straight", source: e.fromNode, target: e.toNode, sourceHandle: e.fromSide ?? null, targetHandle: e.toSide ?? null, label: e.label,
    data: { edge: e },
    markerEnd: e.toEnd === "none" ? undefined : { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
    markerStart: e.fromEnd === "arrow" ? { type: MarkerType.ArrowClosed, color, width: 18, height: 18 } : undefined,
    style: { stroke: color, strokeWidth: 2 },
    labelBgPadding: [8, 3], labelBgBorderRadius: 6,
  };
}
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
function Handles() {
  return (<>{(Object.keys(SIDE_POS) as Side[]).map((s) => <Handle key={s} id={s} type="source" position={SIDE_POS[s]} />)}</>);
}
/** Card shell: 10px radius, 1px border in the card colour; selected = 2px amber + soft amber ring. */
function shell(n: CanvasNode, selected: boolean, base = "var(--surface)") {
  const c = colorOf(n.color);
  return {
    className: "box-border flex h-full w-full flex-col overflow-hidden rounded-[10px]",
    style: {
      border: selected ? "2px solid var(--accent)" : `1px solid ${c ?? "var(--border)"}`,
      boxShadow: selected ? "0 0 0 4px color-mix(in srgb,var(--accent) 16%,transparent)" : "none",
      background: c ? `color-mix(in srgb, ${c} 14%, var(--surface))` : base,
    },
  };
}
const RESIZER = { lineStyle: { borderColor: "transparent" } };

/** "# Idea\nbody…" → title + body, so a text card reads like the design (bold title, muted body). */
function splitTitle(t: string) {
  const m = /^\s*#{1,6}\s+(.+?)\s*(?:\n|$)/.exec(t);
  return m ? { title: m[1], body: t.slice(m[0].length).trim() } : { title: "", body: t };
}

const TextNode = memo(({ id, data, selected }: NodeProps<FlowNode>) => {
  const n = data.node as Extract<CanvasNode, { type: "text" }>;
  const { updateNodeData } = useReactFlow();
  const { spaceId } = useContext(Ctx);
  const [edit, setEdit] = useState(!n.text);
  const s = shell(n, !!selected);
  const { title, body } = splitTitle(n.text);
  const rich = /\$|\*\*|`|\[\[|^\s*([-*>]|\d+\.)\s/m.test(body);
  return (
    <>
      <NodeResizer isVisible={!!selected} minWidth={120} minHeight={50} {...RESIZER} />
      <Handles />
      <div {...s} onDoubleClick={() => setEdit(true)}>
        {edit ? (
          <textarea
            autoFocus
            className="nodrag nowheel h-full w-full resize-none bg-transparent px-3.5 py-3 font-mono text-[13px] text-ink outline-none"
            defaultValue={n.text}
            onBlur={(e) => { updateNodeData(id, { node: { ...n, text: e.target.value } }); setEdit(false); }}
            onKeyDown={(e) => e.key === "Escape" && (e.target as HTMLTextAreaElement).blur()}
          />
        ) : (
          <div className="nowheel flex h-full flex-col gap-1.5 overflow-auto px-3.5 py-3">
            {title && <span dir="auto" className="text-[14px] font-[650]">{title}</span>}
            {body ? (
              rich
                ? <div className="text-[13px] leading-[19px] opacity-85 [&_.katex]:text-[15px]"><Preview note={{ id, body: body.replace(/([^\n])\n(?=[^\n])/g, "$1  \n"), spaceId }} className="!font-sans !text-[13px] !leading-[19px]" /></div>
                : <span dir="auto" className="whitespace-pre-line text-[13px] leading-[19px] text-ink opacity-85">{body}</span>
            ) : !title && <span className="text-[13px] text-muted">Double-click to edit</span>}
          </div>
        )}
      </div>
    </>
  );
});

const FileNode = memo(({ data, selected }: NodeProps<FlowNode>) => {
  const n = data.node as Extract<CanvasNode, { type: "file" }>;
  const v = useVault();
  const { spaceId } = useContext(Ctx);
  const title = n.file.replace(/\.md$/i, "").split("/").pop()!;
  const note = v.byTitle.get(title.toLowerCase());
  const folder = note ? (note.folderId ? v.folderMap.get(note.folderId)?.name : v.spaceMap.get(note.spaceId)?.name) : n.file.split("/").slice(-2, -1)[0];
  const s = shell(n, !!selected);
  return (
    <>
      <NodeResizer isVisible={!!selected} minWidth={140} minHeight={60} {...RESIZER} />
      <Handles />
      <div {...s}>
        <div className="flex h-[30px] shrink-0 items-center gap-1.5 border-b border-line px-2.5 text-[11.5px] text-muted">
          <FileText size={12} className="shrink-0" /><span className="flex-1 truncate">{folder ?? "Note"}</span>
          <span className="size-[7px] shrink-0 rounded-full" style={{ background: note?.status ? STATUS_COLOR[note.status] : note ? "var(--info)" : "var(--border)" }} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-[5px] px-3 py-2.5">
          <button className="nodrag truncate text-left text-[14px] font-[650] hover:text-accent" onClick={async () => openNote((note ?? (await findOrCreateByTitle(title, spaceId))).id)}>
            {title}{!note && <span className="ml-1.5 text-[11px] font-normal text-muted">create</span>}
          </button>
          <span dir="auto" className="nowheel overflow-hidden text-[12px] leading-[17px] text-muted">{note ? plainExcerpt(note.body, 90) : "Note not found. Click the title to create it."}</span>
        </div>
      </div>
    </>
  );
});

const BADGE = "#8C1515";
const LinkNode = memo(({ data, selected }: NodeProps<FlowNode>) => {
  const n = data.node as Extract<CanvasNode, { type: "link" }>;
  const s = shell(n, !!selected);
  const [meta, setMeta] = useState<Unfurl | null>(null);
  useEffect(() => { let live = true; void unfurl(n.url).then((m) => live && setMeta(m)); return () => { live = false; }; }, [n.url]);
  let host = n.url;
  try { host = new URL(n.url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
  const badge = host.split(".")[0].slice(0, 2).toUpperCase();
  return (
    <>
      <NodeResizer isVisible={!!selected} minWidth={140} minHeight={50} {...RESIZER} />
      <Handles />
      <div {...s}>
        <a href={n.url} target="_blank" rel="noopener noreferrer" className="nodrag flex h-full items-center gap-3 p-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[8px] text-[13px] font-bold text-white" style={{ background: BADGE }}>{badge}</span>
          <span className="flex min-w-0 flex-col gap-[3px]">
            <span className="truncate font-semibold text-ink">{meta?.title || host}</span>
            <span className="flex min-w-0 items-center gap-1 text-[12px] text-link"><Link2 size={12} className="shrink-0" /><span className="truncate">{n.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span></span>
          </span>
        </a>
      </div>
    </>
  );
});

const GroupNode = memo(({ id, data, selected }: NodeProps<FlowNode>) => {
  const n = data.node as Extract<CanvasNode, { type: "group" }>;
  const { updateNodeData } = useReactFlow();
  const c = colorOf(n.color) ?? "var(--muted)";
  return (
    <>
      <NodeResizer isVisible={!!selected} minWidth={160} minHeight={100} {...RESIZER} />
      <Handles />
      <div className="relative h-full w-full rounded-[14px]" style={{ border: `1.5px solid ${selected ? "var(--accent)" : c}`, background: `color-mix(in srgb, ${c} 8%, transparent)` }}>
        <input
          className="group-handle absolute -top-[30px] left-0 h-6 cursor-move rounded-[6px] px-2.5 text-[12.5px] font-semibold text-[#0F1115] outline-none"
          style={{ background: c, width: `${Math.max(6, (n.label ?? "Group").length + 3)}ch` }}
          defaultValue={n.label ?? ""}
          placeholder="Group"
          onBlur={(e) => updateNodeData(id, { node: { ...n, label: e.target.value } })}
        />
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
  { icon: <GitFork size={15} />, title: "Mind map from headings", desc: "Each ## heading becomes a branch", code: `// Paste an outline; every heading becomes a card linked to its parent.
canvas.fromOutline(\`# Backpropagation
## Forward pass
### Activations
## Backward pass
### Chain rule
### Vanishing gradients\`);
canvas.layout("tree");
log("cards:", canvas.nodes.length);` },
  { icon: <FileText size={15} />, title: "Cards from tagged notes", desc: "One note card per note with a tag", code: `// Change the tag, then Run. Notes become file cards in a grid.
const tag = "math";
const hits = helpers.notes.filter((n) => n.tags.includes(tag));
for (const n of hits) canvas.addNote(n.title);
canvas.layout("grid");
log(hits.length, "notes tagged #" + tag);` },
  { icon: <Network size={15} />, title: "Concept tree", desc: "A root card with typed children", code: SCRIPT_EXAMPLE },
];

const TOOL = "flex h-8 items-center justify-center gap-[5px] rounded-[8px] text-ink hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent";
const CAPTION = "hidden pl-1 pr-1.5 text-[10.5px] font-semibold uppercase tracking-[.06em] text-muted xl:inline";
const SEP = <span className="mx-1.5 h-[22px] w-px shrink-0 bg-line" />;
type PhoneTab = "add" | "arrange" | "style" | "code";
type Tool = [name: string, icon: ReactNode, label: string, run: () => void, on?: boolean];

export function CanvasEditor({ note }: { note: Note }) {
  return (
    <ReactFlowProvider>
      <Ctx.Provider value={{ spaceId: note.spaceId }}>
        <Inner note={note} />
      </Ctx.Provider>
    </ReactFlowProvider>
  );
}

function ZoomPill() {
  const { zoom } = useViewport();
  const rf = useReactFlow();
  return (
    <div className="absolute bottom-4 left-4 z-10 hidden items-center gap-0.5 rounded-[10px] border border-line bg-surface p-[3px] md:flex">
      <button aria-label="Zoom out" onClick={() => rf.zoomOut({ duration: 150 })} className="flex size-7 items-center justify-center rounded-[7px] hover:bg-surface-2"><Minus size={14} /></button>
      <button title="Fit" onClick={() => rf.fitView({ padding: 0.2, duration: 300 })} className="w-10 text-center text-[12px] tabular-nums">{Math.round(zoom * 100)}%</button>
      <button aria-label="Zoom in" onClick={() => rf.zoomIn({ duration: 150 })} className="flex size-7 items-center justify-center rounded-[7px] hover:bg-surface-2"><Plus size={14} /></button>
    </div>
  );
}

function Inner({ note }: { note: Note }) {
  const v = useVault();
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
  const [menu, setMenu] = useState<null | "main" | "outline">(null);
  const [connecting, setConnecting] = useState(false);
  const lastSaved = useRef(stringify(initial.canvas));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const parseT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const jsonFocus = useRef(false);
  const ed = useRef<CodeEditorHandle | null>(null);

  const load = useCallback((c: JsonCanvas) => {
    // Keep the board selection across reloads (JSON edits, scripts, sync).
    setNodes((old) => { const sel = new Set(old.filter((n) => n.selected).map((n) => n.id)); return toFlow(c).nodes.map((n) => (sel.has(n.id) ? { ...n, selected: true } : n)); });
    setEdges((old) => { const sel = new Set(old.filter((e) => e.selected).map((e) => e.id)); return toFlow(c).edges.map((e) => (sel.has(e.id) ? { ...e, selected: true } : e)); });
  }, [setNodes, setEdges]);

  // Persist (debounced) on any change; mirror into the JSON panel unless you're typing in it.
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const s = stringify(fromFlow(nodes, edges));
      if (!jsonFocus.current && !codeErr) setCodeText(s);
      if (s === lastSaved.current) return;
      lastSaved.current = s;
      void updateNote(note.id, { body: s });
    }, code ? 150 : 500);
    return () => clearTimeout(timer.current);
  }, [nodes, edges, note.id, code, codeErr]);

  // External change (sync, REST API, another tab) → reload.
  useEffect(() => {
    if (note.body === lastSaved.current) return;
    const { canvas, error } = parseCanvas(note.body);
    if (error) return;
    const s = stringify(canvas);
    if (s === lastSaved.current) return;
    lastSaved.current = s;
    if (!jsonFocus.current) setCodeText(s);
    load(canvas);
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
        if (!err) load({ nodes: c.nodes ?? [], edges: c.edges ?? [] });
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
    const node = { id, x: p.x, y: p.y, width: 260, height: 120, ...(defColor ? { color: defColor } : {}), ...n } as CanvasNode;
    setNodes((ns) => [...ns.map((x) => ({ ...x, selected: false })), { ...toFlow({ nodes: [node] }).nodes[0], selected: true }]);
  };
  const selected = nodes.filter((n) => n.selected);
  const anySel = selected.length > 0 || edges.some((e) => e.selected);
  const setColor = (c: string | undefined) => {
    if (!anySel) { setDefColor(c); return; }
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: { node: { ...n.data.node, color: c } } } : n)));
    setEdges((es) => es.map((e) => (e.selected ? { ...toFlowEdge({ ...((e.data?.edge ?? {}) as CanvasEdge), id: e.id, fromNode: e.source, toNode: e.target, fromSide: (e.sourceHandle ?? undefined) as Side | undefined, toSide: (e.targetHandle ?? undefined) as Side | undefined, label: e.label as string | undefined, color: c }), selected: true } : e)));
  };
  const delSelected = () => { const ids = new Set(selected.map((n) => n.id)); setNodes((ns) => ns.filter((n) => !n.selected)); setEdges((es) => es.filter((e) => !e.selected && !ids.has(e.source) && !ids.has(e.target))); };
  const doLayout = (k: "grid" | "tree" | "force") => { load(layout(fromFlow(nodes, edges), k)); setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 50); };
  const fit = () => rf.fitView({ padding: 0.2, duration: 300 });
  const onConnect = (c: Connection) => setEdges((es) => addEdge({ ...c, id: crypto.randomUUID().slice(0, 12), type: "straight", markerEnd: { type: MarkerType.ArrowClosed, color: "var(--muted)", width: 18, height: 18 }, style: { stroke: "var(--muted)", strokeWidth: 2 }, labelBgPadding: [8, 3], labelBgBorderRadius: 6 }, es));
  const refit = () => setTimeout(() => rf.fitView({ padding: 0.12, maxZoom: 1, duration: 200 }), 60);
  const togglePanel = (t: CodeTab) => { if (t === "json") setCodeText(stringify(fromFlow(nodes, edges))); setPanel((p) => (p === t ? null : t)); refit(); };
  const switchTab = (t: CodeTab) => { if (t === "json") setCodeText(stringify(fromFlow(nodes, edges))); setPanel(t); };
  const exportCanvas = () => download(`${note.title}.canvas`, stringify(fromFlow(nodes, edges)), "application/json");

  // ⌘` toggles the script console.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "`") { e.preventDefault(); setPanel((p) => (p === "script" ? null : "script")); } };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);

  // The swatch that matches the selection (or the default colour for new cards).
  const curColor = anySel ? (selected[0]?.data.node.color ?? null) : defColor ?? null;

  async function run() {
    try { localStorage.setItem("lumen.canvasScript", src); } catch { /* ignore */ }
    const helpers = { notes: v.notes.map((n) => ({ id: n.id, title: n.title, tags: n.tags, type: n.type, status: n.status })), outline: fromOutline };
    const t0 = performance.now();
    const r = await runScript(src, fromFlow(nodes, edges), helpers);
    setLogs([...r.logs, ...(r.error ? [`✖ ${r.error}`] : [`✓ done · ${r.canvas.nodes?.length ?? 0} nodes · ${Math.round(performance.now() - t0)} ms · restore from History`])]);
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
    if (!blocks.length) { toast("No Mermaid block on this board: write it in the dialog"); return toWhiteboard([], `${note.title} (diagram)`, true); }
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
    } catch (e) { toast(`Mermaid: ${(e as Error).message}`); }
  };
  const convertOutline = async (src: Note) => {
    const c = fromOutline(src.body);
    if (!c.nodes?.length) return toast("That note has no headings or bullets to map");
    const n = await createNote({ type: "canvas", title: `${src.title} (map)`, body: stringify(c), ...where });
    openNote(n.id);
  };
  const duplicate = async () => { const d = await duplicateNote(note.id); if (d) openNote(d.id); };
  const del = async () => { await trashNote(note.id); setUI({ noteId: null }); toast("Canvas moved to trash", { label: "Undo", run: () => { void restoreNote(note.id); openNote(note.id); } }); };

  const addTools: Tool[] = [
    ["Text", <Type size={15} />, "Add text card", () => addNode({ type: "text", text: "" })],
    ["Note", <FilePlus size={15} />, "Add note card", () => { const t = prompt("Note title"); if (t) addNode({ type: "file", file: t, width: 300, height: 200 }); }],
    ["Link", <Link2 size={15} />, "Add link card", () => { const u = prompt("URL", "https://"); if (u) addNode({ type: "link", url: u, width: 300, height: 84 }); }],
    ["Group", <Group size={15} />, "Add group", () => addNode({ type: "group", label: "Group", width: 600, height: 400 })],
  ];
  const arrangeTools: Tool[] = [
    ["Tree", <Network size={15} />, "Tree layout", () => doLayout("tree")],
    ["Grid", <LayoutGrid size={15} />, "Grid layout", () => doLayout("grid")],
    ["Force", <Orbit size={15} />, "Force layout", () => doLayout("force")],
  ];
  const codeTools: Tool[] = [
    ["JSON", <Code2 size={15} />, "Code: edit as JSON Canvas", () => togglePanel("json"), panel === "json"],
    ["Script", <SquareTerminal size={15} />, "Script console (Ctrl `)", () => togglePanel("script"), panel === "script"],
    ["Export", <Download size={15} />, "Download .canvas", exportCanvas],
  ];
  const ring = "0 0 0 2px var(--surface),0 0 0 3.5px var(--text)";
  const swatches = (size: string) => (
    <span className="flex items-center gap-[5px] px-1">
      {Object.entries(PRESETS).map(([k, c]) => (
        <button key={k} title={anySel ? (curColor === k ? "Remove colour" : `Colour ${k}`) : `Default colour ${k} for new cards`} aria-label={`Colour ${k}`} onClick={() => setColor(curColor === k ? undefined : k)} className={cx(size, "shrink-0 rounded-full")}
          style={{ background: c, boxShadow: curColor === k ? ring : undefined }} />
      ))}
    </span>
  );

  const conversions: [ReactNode, ReactNode, string, string, () => void][] = [
    [<ListTree size={13} />, <LayoutDashboard size={13} />, "Note outline → Canvas", "headings → cards", () => setMenu("outline")],
    [<LayoutDashboard size={13} />, <Pencil size={13} />, "Canvas → Whiteboard", "cards → shapes", () => { setMenu(null); void convertCanvas(); }],
    [<Workflow size={13} />, <Pencil size={13} />, "Mermaid block → Whiteboard", "editable shapes", () => { setMenu(null); void convertMermaid(); }],
  ];
  const menuEl = menu && (
    <>
      <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} />
      <div className="absolute right-3 top-[-6px] z-30 flex w-max min-w-[360px] max-w-[calc(100%-24px)] flex-col gap-px whitespace-nowrap rounded-[12px] border border-line bg-surface-2 p-1.5 text-[13px] shadow-[0_16px_40px_rgba(0,0,0,.45)] fade-in max-md:bottom-[150px] max-md:top-auto">
        {menu === "outline" ? <OutlinePicker exclude={note.id} onPick={(n) => { setMenu(null); void convertOutline(n); }} onBack={() => setMenu("main")} /> : (
          <>
            <span className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Convert</span>
            {conversions.map(([a, b, l, n, fn]) => (
              <button key={l} onClick={fn} className="flex h-10 items-center gap-2.5 rounded-[8px] px-2.5 text-left hover:bg-bg">
                <span className="flex items-center gap-[3px] rounded-[6px] border border-line bg-bg px-1.5 py-[3px] text-muted">{a}<ArrowRight size={10} /><span className="text-ink">{b}</span></span>
                <span className="flex-1">{l}</span><span className="text-[11.5px] text-muted">{n}</span>
              </button>
            ))}
            <div className="m-1 h-px bg-line" />
            <button onClick={() => { setMenu(null); exportCanvas(); }} className="flex h-[34px] items-center gap-2.5 rounded-[8px] px-2.5 text-left hover:bg-bg"><Download size={14} className="text-muted" />Export .canvas</button>
            <button onClick={() => { setMenu(null); void duplicate(); }} className="flex h-[34px] items-center gap-2.5 rounded-[8px] px-2.5 text-left hover:bg-bg"><Copy size={14} className="text-muted" />Duplicate</button>
            <button onClick={() => { setMenu(null); void del(); }} className="flex h-[34px] items-center gap-2.5 rounded-[8px] px-2.5 text-left text-bad hover:bg-bg"><Trash2 size={14} />Delete canvas</button>
          </>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <style>{CANVAS_CSS}</style>
      <div className={cx("lumen-canvas relative min-h-0 flex-1", connecting && "connecting")}
        onDoubleClick={(e) => {
          // Double-click on empty space = new text card there.
          if (!(e.target as HTMLElement).classList.contains("react-flow__pane")) return;
          const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          addNode({ type: "text", text: "" }, { x: Math.round(p.x / 20) * 20, y: Math.round(p.y / 20) * 20 });
        }}>
        <ReactFlow
          nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} nodeTypes={nodeTypes}
          onConnectStart={() => setConnecting(true)} onConnectEnd={() => setConnecting(false)}
          connectionMode={ConnectionMode.Loose} fitView fitViewOptions={{ padding: 0.15, maxZoom: 1, ...(typeof innerWidth === "number" && innerWidth < 768 ? { minZoom: 0.62 } : {}) }} minZoom={0.05} maxZoom={3} snapToGrid snapGrid={[20, 20]} zoomOnDoubleClick={false}
          deleteKeyCode={["Delete", "Backspace"]} multiSelectionKeyCode={["Shift", "Meta", "Control"]} proOptions={{ hideAttribution: true }}
          connectionLineStyle={{ stroke: "var(--accent)", strokeWidth: 2 }}
          onEdgeDoubleClick={(_, e) => { const l = prompt("Edge label", (e.label as string) ?? ""); if (l !== null) setEdges((es) => es.map((x) => (x.id === e.id ? { ...x, label: l || undefined } : x))); }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="color-mix(in srgb, var(--muted) 35%, transparent)" />
          <ZoomPill />
          {!panel && <MiniMap pannable zoomable className="!hidden lg:!block" style={{ width: 176, height: 112 }} nodeBorderRadius={3}
            nodeColor={(n) => { const c = colorOf((n.data as Data).node.color); return c ? `color-mix(in srgb, ${c} 45%, transparent)` : "color-mix(in srgb, var(--muted) 45%, transparent)"; }}
            maskColor="color-mix(in srgb, var(--surface) 55%, transparent)" maskStrokeColor="var(--accent)" maskStrokeWidth={2} />}
        </ReactFlow>

        {/* Desktop toolbar: Add | Arrange | Style | Code (captions at ≥1280px, icon-only below) + ⋯ */}
        <div className="absolute left-1/2 top-3.5 z-10 hidden max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-0.5 rounded-[12px] border border-line bg-surface px-1.5 py-1 md:flex">
          <span className={CAPTION}>Add</span>
          {addTools.map(([, icon, label, fn]) => <button key={label} title={label} aria-label={label} onClick={fn} className={cx(TOOL, "w-8 shrink-0")}>{icon}</button>)}
          {SEP}
          <span className={CAPTION}>Arrange</span>
          {arrangeTools.map(([name, icon, label, fn]) => <button key={label} title={label} aria-label={label} onClick={fn} className={cx(TOOL, "shrink-0 px-2 text-[12px]")}>{icon}<span className="hidden lg:inline">{name}</span></button>)}
          {SEP}
          <span className={CAPTION}>Style</span>
          {swatches("size-4")}
          {SEP}
          <span className={CAPTION}>Code</span>
          {codeTools.map(([, icon, label, fn, on]) => <button key={label} title={label} aria-label={label} onClick={fn} className={cx(TOOL, "w-8 shrink-0", on && "bg-surface-2 text-accent")}>{icon}</button>)}
          {SEP}
          <button title="More: convert, export, duplicate" aria-label="Canvas menu" onClick={() => setMenu((m) => (m ? null : "main"))} className={cx(TOOL, "w-8 shrink-0", menu && "bg-surface-2")}><Ellipsis size={16} /></button>
        </div>
        {menuEl}

        {/* Phone: one bottom tool card, groups as tabs */}
        {!panel && (
          <div className="absolute inset-x-3 bottom-4 z-10 flex flex-col overflow-hidden rounded-[16px] border border-line bg-surface-2 md:hidden">
            <div className="grid h-9 grid-cols-4 border-b border-line text-[12px] font-semibold text-muted">
              {(["add", "arrange", "style", "code"] as PhoneTab[]).map((t) => (
                <button key={t} onClick={() => setPhoneTab(t)} className={cx("capitalize", phoneTab === t && "text-ink shadow-[inset_0_-2px_0_var(--accent)]")}>{t}</button>
              ))}
            </div>
            <div className="grid h-[60px] grid-cols-4 items-center">
              {phoneTab === "style" ? (
                <div className="col-span-4 flex items-center justify-center gap-2">{swatches("size-7")}{anySel && <button aria-label="Delete selected" onClick={delSelected} className="flex size-11 items-center justify-center text-bad"><Trash2 size={20} /></button>}</div>
              ) : (
                (phoneTab === "add" ? addTools : phoneTab === "arrange" ? [...arrangeTools, ["Fit", <Scan size={15} />, "Fit to screen", fit] as Tool] : [...codeTools, ["More", <Ellipsis size={15} />, "Convert, duplicate, delete", () => setMenu("main")] as Tool]).map(([name, icon, label, fn]) => (
                  <button key={label} aria-label={label} onClick={fn} className="flex h-full flex-col items-center justify-center gap-0.5 text-[10.5px] [&>svg]:size-5">{icon}{name}</button>
                ))
              )}
            </div>
          </div>
        )}

        {!nodes.length && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] text-muted">
            Empty canvas. Double-click to add a card, paste JSON Canvas in <b className="mx-1">Code</b>, or generate with a <b className="ml-1">script</b>.
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
                <button title="Format (Shift Alt F)" onClick={() => ed.current?.format()} className="flex h-7 items-center rounded-[8px] border border-line px-2.5 text-muted hover:bg-surface-2 hover:text-ink">Format</button>
                <button title="Download .canvas" aria-label="Download .canvas" onClick={exportCanvas} className="flex size-7 items-center justify-center rounded-[8px] border border-line hover:bg-surface-2"><Download size={14} /></button>
              </PanelBar>
              {codeErr && <ErrorBanner error={codeErr} line={errLine} onGoto={() => errLine && ed.current?.goto(errLine)} />}
              <div className="flex min-h-0 flex-1 flex-col md:pt-0" onFocus={() => (jsonFocus.current = true)} onBlur={() => (jsonFocus.current = false)}>
                <CodeEditor value={codeText} onChange={onJson} band={band} handle={ed}
                  onCursor={(c) => { setCursor({ line: c.line, col: c.col }); if (c.user) { const id = itemAt(spans, c.pos); if (id) selectItem(id); } }} />
              </div>
              <ValidFooter error={codeErr} detail={`${nodes.length} nodes · ${edges.length} edges · live round-trip`} cursor={cursor} />
              <PhoneActions>
                <button aria-label="Download .canvas" onClick={exportCanvas} className="flex size-[52px] items-center justify-center rounded-[12px] border border-line"><Download size={18} /></button>
                <button disabled={!!codeErr} onClick={() => { onJson(codeText); setPanel(null); }} className="flex h-[52px] flex-1 items-center justify-center rounded-[12px] bg-accent text-[15px] font-semibold text-accent-fg disabled:opacity-50">Apply</button>
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
              <OutputStrip logs={logs} onClear={() => setLogs([])} empty="Output appears here. Every change is kept in History, so you can restore the board." />
              <PhoneActions><RunButton onRun={run} big /></PhoneActions>
            </>
          )}
        </CodePanel>
      )}
    </div>
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
        <button onClick={onBack} className="normal-case tracking-normal hover:text-ink">← Convert</button><span className="flex-1" />Note outline → Canvas
      </div>
      <label className="mx-1 mb-1 flex h-8 items-center gap-2 rounded-[8px] border border-line bg-bg px-2.5 text-muted focus-within:border-accent">
        <Search size={13} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Which note? (headings become cards)" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted"
          onKeyDown={(e) => { if (e.key === "Enter" && list[0]) onPick(list[0]); }} />
      </label>
      {list.map((n) => (
        <button key={n.id} onClick={() => onPick(n)} className="flex h-9 items-center gap-2.5 rounded-[8px] px-2.5 text-left hover:bg-bg">
          <FileText size={14} className="shrink-0 text-muted" /><span dir="auto" className="flex-1 truncate">{n.title}</span>
          <span className="text-[11.5px] text-muted">{(n.body.match(/^#{1,6}\s/gm) ?? []).length} headings</span>
        </button>
      ))}
      {!list.length && <span className="px-2.5 py-2 text-[12.5px] text-muted">No note with headings matches.</span>}
    </>
  );
}
