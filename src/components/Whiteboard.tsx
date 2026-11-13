import { json } from "@codemirror/lang-json";
import { Excalidraw, convertToExcalidrawElements, exportToBlob, exportToSvg, restore, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import CodeMirror from "@uiw/react-codemirror";
import { Code2, Download, Play, Terminal, Workflow, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { updateNote } from "../lib/actions";
import { download } from "../lib/io";
import { useSettings, activeTheme } from "../lib/settings";
import { toast } from "../lib/store";
import { parseScene, sk, type Scene, type Skeleton } from "../lib/whiteboard";
import { Button, cx, IconButton } from "./ui";

// Excalidraw's types are deep; we only need a handful of calls.
type API = {
  getSceneElements: () => readonly Record<string, unknown>[];
  getSceneElementsIncludingDeleted: () => readonly Record<string, unknown>[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
  updateScene: (s: { elements?: readonly unknown[]; appState?: Record<string, unknown> }) => void;
  scrollToContent: (target?: unknown, opts?: { fitToContent?: boolean; animate?: boolean }) => void;
  addFiles: (files: unknown[]) => void;
};

const SCRIPT_EXAMPLE = `// Whiteboard scripting (Excalidraw element skeletons).
// Helpers: sk.rect(x,y,w,h,label) sk.ellipse sk.diamond sk.text(x,y,text) sk.sticky(x,y,text,color)
//          sk.arrow(x,y,dx,dy) sk.connect(fromId,toId,label) sk.frame([ids],name)
// board.add([...skeletons])  board.fromMermaid(code)  board.clear()  board.elements  log(...)
const topics = ["Variables", "Functions", "Recursion", "Data structures"];
board.add(topics.map((t, i) => ({ ...sk.sticky(i * 240, 0, t, i), id: "t" + i })));
board.add(topics.slice(1).map((_, i) => sk.connect("t" + i, "t" + (i + 1))));
log("added", topics.length, "stickies");`;

export default function Whiteboard({ note }: { note: Note }) {
  const settings = useSettings();
  const dark = useMemo(() => activeTheme().dark, [settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const initial = useMemo(() => parseScene(note.body), []); // eslint-disable-line react-hooks/exhaustive-deps
  const api = useRef<API | null>(null);
  const lastSaved = useRef(note.body);
  const lastVersion = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [panel, setPanel] = useState<null | "code" | "script" | "mermaid">(null);
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [src, setSrc] = useState(() => { try { return localStorage.getItem("lumen.wbScript") ?? SCRIPT_EXAMPLE; } catch { return SCRIPT_EXAMPLE; } });
  const [mmd, setMmd] = useState("flowchart TD\n  A[Question] --> B{Know it?}\n  B -->|yes| C[Next topic]\n  B -->|no| D[Review notes]");
  const [logs, setLogs] = useState<string[]>([]);

  const initialData = useMemo(() => {
    const r = restore({ elements: initial.scene.elements as never, appState: initial.scene.appState as never, files: initial.scene.files as never }, null, null);
    return { elements: r.elements, appState: { ...r.appState, viewBackgroundColor: "transparent", collaborators: new Map() }, files: r.files, scrollToContent: true };
  }, [initial]);

  const serialize = () => {
    const a = api.current!;
    const s = JSON.parse(serializeAsJSON(a.getSceneElements() as never, a.getAppState() as never, a.getFiles() as never, "local")) as Scene;
    s.source = "lumen";
    return JSON.stringify(s);
  };
  const save = () => {
    if (!api.current) return;
    const s = serialize();
    if (s === lastSaved.current) return;
    lastSaved.current = s;
    void updateNote(note.id, { body: s });
  };
  const add = async (skel: Skeleton[]) => {
    const a = api.current;
    if (!a || !skel.length) return;
    const els = convertToExcalidrawElements(skel as never, { regenerateIds: false });
    a.updateScene({ elements: [...a.getSceneElementsIncludingDeleted(), ...els] });
    setTimeout(() => { a.scrollToContent(els as never, { fitToContent: true, animate: true }); save(); }, 50);
  };

  // Apply skeletons pushed through the REST API (lumenPending), once the editor is ready.
  const applyPending = (sc: Scene) => {
    if (!sc.lumenPending?.length) return;
    const pending = sc.lumenPending;
    sc.lumenPending = undefined; // save() serializes from the editor, which never includes lumenPending
    void add(pending);
    toast(`Added ${pending.length} elements from the API`);
  };

  // External change (sync / REST / another device).
  useEffect(() => {
    if (!api.current || note.body === lastSaved.current) return;
    const { scene, error } = parseScene(note.body);
    if (error) return;
    lastSaved.current = note.body;
    const r = restore({ elements: scene.elements as never }, null, null);
    api.current.updateScene({ elements: r.elements });
    applyPending(scene);
  }, [note.body]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { clearTimeout(timer.current); }, []);

  async function runScript() {
    try { localStorage.setItem("lumen.wbScript", src); } catch { /* ignore */ }
    const out: string[] = [];
    const log = (...a: unknown[]) => out.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    const board = {
      get elements() { return api.current?.getSceneElements() ?? []; },
      add: (s: Skeleton | Skeleton[]) => add(Array.isArray(s) ? s : [s]),
      clear: () => api.current?.updateScene({ elements: [] }),
      fromMermaid: (c: string) => fromMermaid(c),
    };
    try {
      await new Function("board", "sk", "log", `"use strict"; return (async () => { ${src}\n })();`)(board, sk, log);
      setLogs([...out, "✓ done"]);
      setTimeout(save, 200);
    } catch (e) { setLogs([...out, `✖ ${(e as Error).message}`]); }
  }

  async function fromMermaid(c: string) {
    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
    const { elements, files } = await parseMermaidToExcalidraw(c);
    if (files) api.current?.addFiles(Object.values(files));
    await add(elements as Skeleton[]);
  }

  async function exportAs(kind: "png" | "svg" | "excalidraw") {
    const a = api.current;
    if (!a) return;
    if (kind === "excalidraw") return download(`${note.title}.excalidraw`, serialize(), "application/json");
    const opts = { elements: a.getSceneElements() as never, appState: { ...a.getAppState(), exportBackground: true, viewBackgroundColor: dark ? "#0F1115" : "#ffffff", exportWithDarkMode: dark } as never, files: a.getFiles() as never };
    if (kind === "png") download(`${note.title}.png`, await exportToBlob({ ...opts, mimeType: "image/png" }));
    else download(`${note.title}.svg`, new XMLSerializer().serializeToString(await exportToSvg(opts)), "image/svg+xml");
  }

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <div className="relative min-h-0 flex-1" style={{ background: "var(--bg)" }}>
        <Excalidraw
          excalidrawAPI={(a) => { api.current = a as unknown as API; applyPending(initial.scene); }}
          initialData={initialData as never}
          theme={dark ? "dark" : "light"}
          onChange={(els) => {
            const v = (els as readonly { version: number; id: string }[]).reduce((s, e) => s + e.version, 0) + ":" + els.length;
            if (v === lastVersion.current) return; // ignore pure scroll/zoom/selection changes
            lastVersion.current = v;
            clearTimeout(timer.current);
            timer.current = setTimeout(save, 700);
          }}
          UIOptions={{ canvasActions: { loadScene: true, saveToActiveFile: false, export: { saveFileToDisk: true }, toggleTheme: false } }}
          renderTopRightUI={() => (
            <div className="flex items-center gap-0.5 rounded-[10px] border border-line bg-surface p-0.5">
              <IconButton label="Code: edit .excalidraw JSON" active={panel === "code"} onClick={() => { setCode(JSON.stringify(JSON.parse(serialize()), null, 2)); setCodeErr(null); setPanel(panel === "code" ? null : "code"); }}><Code2 size={16} /></IconButton>
              <IconButton label="Script console" active={panel === "script"} onClick={() => setPanel(panel === "script" ? null : "script")}><Terminal size={16} /></IconButton>
              <IconButton label="Mermaid → whiteboard" active={panel === "mermaid"} onClick={() => setPanel(panel === "mermaid" ? null : "mermaid")}><Workflow size={16} /></IconButton>
              <IconButton label="Export PNG" onClick={() => exportAs("png")}><Download size={16} /></IconButton>
            </div>
          )}
        />
      </div>

      {panel && (
        <div className="flex h-[45%] min-h-0 flex-col border-t border-line bg-surface md:h-auto md:w-[40%] md:border-l md:border-t-0">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px]">
            <b>{panel === "code" ? ".excalidraw JSON" : panel === "script" ? "Script console" : "Mermaid → whiteboard"}</b>
            {panel === "code" && <span className={cx("truncate", codeErr ? "text-bad" : "text-muted")}>{codeErr ?? "edit, then Apply"}</span>}
            <span className="ml-auto flex gap-1">
              {panel === "code" && <Button size="sm" variant="primary" onClick={() => {
                const { scene, error } = parseScene(code);
                if (error) return setCodeErr(error);
                const r = restore({ elements: scene.elements as never }, null, null);
                api.current?.updateScene({ elements: r.elements });
                setTimeout(save, 50);
                setCodeErr(null);
              }}>Apply</Button>}
              {panel === "script" && <Button size="sm" variant="primary" onClick={runScript}><Play size={13} /> Run</Button>}
              {panel === "mermaid" && <Button size="sm" variant="primary" onClick={() => fromMermaid(mmd).catch((e) => toast(`Mermaid: ${(e as Error).message}`))}><Play size={13} /> Add to board</Button>}
              {panel === "code" && <Button size="sm" variant="ghost" onClick={() => exportAs("excalidraw")}>.excalidraw</Button>}
              {panel === "code" && <Button size="sm" variant="ghost" onClick={() => exportAs("svg")}>SVG</Button>}
              <IconButton label="Close" onClick={() => setPanel(null)}><X size={16} /></IconButton>
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto text-[13px]">
            {panel === "code" && <CodeMirror value={code} theme="none" extensions={[json()]} onChange={setCode} basicSetup={{ lineNumbers: true, foldGutter: true }} />}
            {panel === "script" && <CodeMirror value={src} theme="none" onChange={setSrc} basicSetup={{ lineNumbers: true }} />}
            {panel === "mermaid" && <CodeMirror value={mmd} theme="none" onChange={setMmd} basicSetup={{ lineNumbers: true }} />}
          </div>
          {panel === "script" && <pre className="max-h-28 overflow-auto border-t border-line bg-bg px-3 py-2 font-mono text-[12px] text-muted">{logs.join("\n") || "Output appears here."}</pre>}
          {panel === "mermaid" && <p className="border-t border-line px-3 py-2 text-[11.5px] text-muted">Flowcharts become editable shapes; other diagram types are added as an image.</p>}
        </div>
      )}
    </div>
  );
}
