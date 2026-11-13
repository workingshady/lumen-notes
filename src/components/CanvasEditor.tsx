import { json } from "@codemirror/lang-json";
import CodeMirror from "@uiw/react-codemirror";
import {
  addEdge, Background, BackgroundVariant, ConnectionMode, Controls, Handle, MarkerType, MiniMap, NodeResizer, Position, ReactFlow, ReactFlowProvider,
  useEdgesState, useNodesState, useReactFlow, type Connection, type Edge, type Node as RFNode, type NodeProps,
} from "@xyflow/react";
import { Code2, Download, FileText, Group, LayoutGrid, Link as LinkIcon, ListTree, Network, Palette, Play, Terminal, Trash2, Type, X } from "lucide-react";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasEdge, CanvasNode, JsonCanvas, Note, Side } from "../../shared/types";
import { findOrCreateByTitle, updateNote } from "../lib/actions";
import { colorOf, fromOutline, layout, parseCanvas, PRESETS, runScript, stringify, validate } from "../lib/canvas";
import { download } from "../lib/io";
import { excerpt } from "../lib/parse";
import { openNote, toast, useVault } from "../lib/store";
import { Preview } from "./Preview";
import { Button, cx, IconButton } from "./ui";

type Data = { node: CanvasNode };
type FlowNode = RFNode<Data>;
const SIDE_POS: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };

const Ctx = createContext<{ spaceId: string }>({ spaceId: "" });

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
  const color = colorOf(e.color);
  return {
    id: e.id, source: e.fromNode, target: e.toNode, sourceHandle: e.fromSide ?? null, targetHandle: e.toSide ?? null, label: e.label,
    data: { edge: e },
    markerEnd: e.toEnd === "none" ? undefined : { type: MarkerType.ArrowClosed, color: color ?? "var(--muted)" },
    markerStart: e.fromEnd === "arrow" ? { type: MarkerType.ArrowClosed, color: color ?? "var(--muted)" } : undefined,
    style: { stroke: color ?? "var(--muted)", strokeWidth: 2 },
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
function shell(n: CanvasNode, selected: boolean) {
  const c = colorOf(n.color);
  return {
    className: cx("h-full w-full overflow-hidden rounded-[12px] border-2 shadow-sm", selected && "ring-2 ring-accent/60"),
    style: { borderColor: c ?? "var(--border)", background: c ? `color-mix(in oklab, ${c} 14%, var(--surface))` : "var(--surface)" },
  };
}

const TextNode = memo(({ id, data, selected }: NodeProps<FlowNode>) => {
  const n = data.node as Extract<CanvasNode, { type: "text" }>;
  const { updateNodeData } = useReactFlow();
  const { spaceId } = useContext(Ctx);
  const [edit, setEdit] = useState(!n.text);
  const s = shell(n, !!selected);
  return (
    <>
      <NodeResizer isVisible={!!selected} minWidth={120} minHeight={50} />
      <Handles />
      <div {...s} onDoubleClick={() => setEdit(true)}>
        {edit ? (
          <textarea
            autoFocus
            className="nodrag nowheel h-full w-full resize-none bg-transparent p-3 font-mono text-[13px] text-ink outline-none"
            defaultValue={n.text}
            onBlur={(e) => { updateNodeData(id, { node: { ...n, text: e.target.value } }); setEdit(false); }}
            onKeyDown={(e) => e.key === "Escape" && (e.target as HTMLTextAreaElement).blur()}
          />
        ) : (
          <div className="nowheel h-full overflow-auto p-3"><Preview note={{ id, body: n.text || "*Double-click to edit*", spaceId }} className="!text-[14px] !leading-relaxed" /></div>
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
  const s = shell(n, !!selected);
  return (
    <>
      <NodeResizer isVisible={!!selected} minWidth={140} minHeight={60} />
      <Handles />
      <div {...s}>
        <button className="nodrag flex w-full items-center gap-1.5 border-b border-line px-3 py-2 text-left text-[13px] font-semibold hover:text-accent"
          onClick={async () => openNote((note ?? (await findOrCreateByTitle(title, spaceId))).id)}>
          <FileText size={14} className="shrink-0 text-muted" /><span className="truncate">{title}</span>
          {!note && <span className="ml-auto text-[11px] font-normal text-muted">create</span>}
        </button>
        <div className="nowheel h-[calc(100%-37px)] overflow-hidden px-3 py-2 text-[12.5px] text-muted">{note ? excerpt(note.body, 400) : "Note not found. Click the title to create it."}</div>
      </div>
    </>
  );
});

const LinkNode = memo(({ data, selected }: NodeProps<FlowNode>) => {
  const n = data.node as Extract<CanvasNode, { type: "link" }>;
  const s = shell(n, !!selected);
  let host = n.url;
  try { host = new URL(n.url).hostname; } catch { /* keep */ }
  return (
    <>
      <NodeResizer isVisible={!!selected} minWidth={140} minHeight={50} />
      <Handles />
      <div {...s}>
        <a href={n.url} target="_blank" rel="noopener noreferrer" className="nodrag flex h-full flex-col justify-center gap-1 p-3 text-[13px]">
          <span className="flex items-center gap-1.5 font-semibold text-link"><img alt="" className="size-4" src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`} />{host}</span>
          <span className="break-all text-[12px] text-muted">{n.url}</span>
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
      <NodeResizer isVisible={!!selected} minWidth={160} minHeight={100} />
      <div className="h-full w-full rounded-[16px] border-2 border-dashed" style={{ borderColor: c, background: `color-mix(in oklab, ${c} 6%, transparent)` }}>
        <input
          className="group-handle -mt-7 ml-1 w-60 cursor-move bg-transparent text-[14px] font-semibold outline-none"
          style={{ color: c }}
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

export function CanvasEditor({ note }: { note: Note }) {
  return (
    <ReactFlowProvider>
      <Ctx.Provider value={{ spaceId: note.spaceId }}>
        <Inner note={note} />
      </Ctx.Provider>
    </ReactFlowProvider>
  );
}

function Inner({ note }: { note: Note }) {
  const v = useVault();
  const initial = useMemo(() => parseCanvas(note.body), []); // eslint-disable-line react-hooks/exhaustive-deps
  const flow = useMemo(() => toFlow(initial.canvas), [initial]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(flow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(flow.edges);
  const rf = useReactFlow<FlowNode, Edge>();
  const [code, setCode] = useState(false);
  const [script, setScript] = useState(false);
  const [codeText, setCodeText] = useState(note.body);
  const [codeErr, setCodeErr] = useState<string | null>(initial.error);
  const [src, setSrc] = useState(() => { try { return localStorage.getItem("lumen.canvasScript") ?? SCRIPT_EXAMPLE; } catch { return SCRIPT_EXAMPLE; } });
  const [logs, setLogs] = useState<string[]>([]);
  const lastSaved = useRef(stringify(initial.canvas));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback((c: JsonCanvas) => {
    const f = toFlow(c);
    setNodes(f.nodes);
    setEdges(f.edges);
  }, [setNodes, setEdges]);

  // Persist (debounced) on any change.
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const s = stringify(fromFlow(nodes, edges));
      if (s === lastSaved.current) return;
      lastSaved.current = s;
      if (!code) setCodeText(s);
      void updateNote(note.id, { body: s });
    }, 500);
    return () => clearTimeout(timer.current);
  }, [nodes, edges, note.id, code]);

  // External change (sync, REST API, another tab) → reload.
  useEffect(() => {
    if (note.body === lastSaved.current) return;
    const { canvas, error } = parseCanvas(note.body);
    if (error) return;
    const s = stringify(canvas);
    if (s === lastSaved.current) return;
    lastSaved.current = s;
    setCodeText(s);
    load(canvas);
  }, [note.body, load]);

  const center = () => {
    const vp = rf.getViewport();
    const el = document.querySelector(".react-flow")?.getBoundingClientRect();
    return { x: Math.round(((el?.width ?? 800) / 2 - vp.x) / vp.zoom - 130), y: Math.round(((el?.height ?? 600) / 2 - vp.y) / vp.zoom - 60) };
  };
  const addNode = (n: Partial<CanvasNode> & { type: CanvasNode["type"] }) => {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const p = center();
    const node = { id, x: p.x, y: p.y, width: 260, height: 120, ...n } as CanvasNode;
    setNodes((ns) => [...ns.map((x) => ({ ...x, selected: false })), { ...toFlow({ nodes: [node] }).nodes[0], selected: true }]);
  };
  const selected = nodes.filter((n) => n.selected);
  const setColor = (c: string | undefined) => {
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: { node: { ...n.data.node, color: c } } } : n)));
    setEdges((es) => es.map((e) => (e.selected ? toFlowEdge({ ...((e.data?.edge ?? {}) as CanvasEdge), id: e.id, fromNode: e.source, toNode: e.target, fromSide: (e.sourceHandle ?? undefined) as Side | undefined, toSide: (e.targetHandle ?? undefined) as Side | undefined, label: e.label as string | undefined, color: c }) : e)));
  };
  const doLayout = (k: "grid" | "tree" | "force") => { load(layout(fromFlow(nodes, edges), k)); setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 50); };
  const onConnect = (c: Connection) => setEdges((es) => addEdge({ ...c, id: crypto.randomUUID().slice(0, 12), markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 2 } }, es));

  const [palette, setPalette] = useState(false);

  async function run() {
    try { localStorage.setItem("lumen.canvasScript", src); } catch { /* ignore */ }
    const helpers = { notes: v.notes.map((n) => ({ id: n.id, title: n.title, tags: n.tags, type: n.type, status: n.status })), outline: fromOutline };
    const r = await runScript(src, fromFlow(nodes, edges), helpers);
    setLogs([...r.logs, ...(r.error ? [`✖ ${r.error}`] : ["✓ done"])]);
    if (!r.error) { load(r.canvas); setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 50); }
  }

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <div className="relative min-h-0 flex-1">
        <ReactFlow
          nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} nodeTypes={nodeTypes}
          connectionMode={ConnectionMode.Loose} fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.05} maxZoom={3} snapToGrid snapGrid={[20, 20]}
          deleteKeyCode={["Delete", "Backspace"]} multiSelectionKeyCode={["Shift", "Meta", "Control"]} proOptions={{ hideAttribution: true }}
          onEdgeDoubleClick={(_, e) => { const l = prompt("Edge label", (e.label as string) ?? ""); if (l !== null) setEdges((es) => es.map((x) => (x.id === e.id ? { ...x, label: l || undefined } : x))); }}
          onPaneClick={() => setPalette(false)}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--border)" />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap pannable zoomable className="!hidden md:!block" nodeColor={(n) => colorOf((n.data as Data).node.color) ?? "var(--surface-2)"} maskColor="color-mix(in oklab, var(--bg) 70%, transparent)" />
        </ReactFlow>
        <div className="absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-[12px] border border-line bg-surface/95 p-1 shadow-lg backdrop-blur">
          <IconButton label="Add text card" onClick={() => addNode({ type: "text", text: "" })}><Type size={17} /></IconButton>
          <IconButton label="Add note card" onClick={() => { const t = prompt("Note title"); if (t) addNode({ type: "file", file: t, width: 300, height: 200 }); }}><FileText size={17} /></IconButton>
          <IconButton label="Add link card" onClick={() => { const u = prompt("URL", "https://"); if (u) addNode({ type: "link", url: u, width: 300, height: 110 }); }}><LinkIcon size={17} /></IconButton>
          <IconButton label="Add group" onClick={() => addNode({ type: "group", label: "Group", width: 600, height: 400 })}><Group size={17} /></IconButton>
          <span className="mx-1 h-5 w-px bg-line" />
          <IconButton label="Color selected" active={palette} onClick={() => setPalette((p) => !p)} disabled={!selected.length && !edges.some((e) => e.selected)}><Palette size={17} /></IconButton>
          <IconButton label="Delete selected" onClick={() => { const ids = new Set(selected.map((n) => n.id)); setNodes((ns) => ns.filter((n) => !n.selected)); setEdges((es) => es.filter((e) => !e.selected && !ids.has(e.source) && !ids.has(e.target))); }} disabled={!selected.length && !edges.some((e) => e.selected)}><Trash2 size={17} /></IconButton>
          <span className="mx-1 h-5 w-px bg-line" />
          <IconButton label="Tree layout" onClick={() => doLayout("tree")}><ListTree size={17} /></IconButton>
          <IconButton label="Grid layout" onClick={() => doLayout("grid")}><LayoutGrid size={17} /></IconButton>
          <IconButton label="Force layout" onClick={() => doLayout("force")}><Network size={17} /></IconButton>
          <span className="mx-1 h-5 w-px bg-line" />
          <IconButton label="Code: edit as JSON Canvas" active={code} onClick={() => { setCodeText(stringify(fromFlow(nodes, edges))); setCode((c) => !c); setScript(false); }}><Code2 size={17} /></IconButton>
          <IconButton label="Script console" active={script} onClick={() => { setScript((s) => !s); setCode(false); }}><Terminal size={17} /></IconButton>
          <IconButton label="Download .canvas" onClick={() => download(`${note.title}.canvas`, stringify(fromFlow(nodes, edges)), "application/json")}><Download size={17} /></IconButton>
        </div>
        {palette && (
          <div className="absolute left-1/2 top-16 z-10 flex -translate-x-1/2 gap-1.5 rounded-[12px] border border-line bg-surface p-2 shadow-lg fade-in">
            <button title="No color" onClick={() => setColor(undefined)} className="size-7 rounded-full border-2 border-line bg-surface-2" />
            {Object.entries(PRESETS).map(([k, c]) => <button key={k} title={`Preset ${k}`} onClick={() => setColor(k)} className="size-7 rounded-full" style={{ background: c }} />)}
          </div>
        )}
        {!nodes.length && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-[13px] text-muted">
            Empty canvas. Add cards from the toolbar, paste JSON Canvas in <b className="mx-1">Code</b>, or generate with a <b className="ml-1">script</b>.
          </div>
        )}
      </div>

      {code && (
        <div className="flex h-[45%] min-h-0 flex-col border-t border-line bg-surface md:h-auto md:w-[42%] md:border-l md:border-t-0">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px]">
            <Code2 size={14} className="text-muted" /> <b>JSON Canvas 1.0</b>
            <span className={cx("ml-2 truncate", codeErr ? "text-bad" : "text-ok")}>{codeErr ?? "valid ✓ (applies live)"}</span>
            <IconButton label="Close" className="ml-auto" onClick={() => setCode(false)}><X size={16} /></IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-auto text-[13px]">
            <CodeMirror value={codeText} theme="none" extensions={[json()]} basicSetup={{ lineNumbers: true, foldGutter: true }}
              onChange={(t) => {
                setCodeText(t);
                try {
                  const c = JSON.parse(t);
                  const err = validate(c);
                  setCodeErr(err);
                  if (!err) load({ nodes: c.nodes ?? [], edges: c.edges ?? [] });
                } catch (e) { setCodeErr(`JSON: ${(e as Error).message}`); }
              }} />
          </div>
        </div>
      )}

      {script && (
        <div className="flex h-[50%] min-h-0 flex-col border-t border-line bg-surface md:h-auto md:w-[42%] md:border-l md:border-t-0">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px]">
            <Terminal size={14} className="text-muted" /> <b>Script console</b>
            <Button size="sm" variant="primary" className="ml-auto" onClick={run}><Play size={13} /> Run</Button>
            <IconButton label="Close" onClick={() => setScript(false)}><X size={16} /></IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-auto text-[13px]">
            <CodeMirror value={src} theme="none" onChange={setSrc} basicSetup={{ lineNumbers: true }} />
          </div>
          <pre className="max-h-32 overflow-auto border-t border-line bg-bg px-3 py-2 font-mono text-[12px] text-muted">{logs.join("\n") || "Output appears here. Every change is kept in History, so you can restore the board."}</pre>
        </div>
      )}
    </div>
  );
}

/** Build a canvas note from a Markdown note's outline. */
export async function canvasFromNote(n: Note, createNote: (p: Partial<Note>) => Promise<Note>) {
  const c = fromOutline(n.body);
  if (!c.nodes?.length) { toast("No headings or bullets to map"); return null; }
  return createNote({ type: "canvas", title: `${n.title} (map)`, body: stringify(c), spaceId: n.spaceId, folderId: n.folderId });
}
