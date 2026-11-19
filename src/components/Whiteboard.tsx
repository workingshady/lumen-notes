import { Excalidraw, convertToExcalidrawElements, exportToBlob, exportToSvg, restore, restoreElements, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { Check, Circle, Code2, Copy, Diamond, Download, Ellipsis, Eraser, Frame, GitFork, Hand, Image, Minus, MousePointer2, MoveUpRight, Pencil, Redo2, Shapes, Square, SquareTerminal, StickyNote, Trash2, Type, Undo2, Workflow, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { updateNote } from "../lib/actions";
import { download } from "../lib/io";
import { useSettings, activeTheme } from "../lib/settings";
import { toast } from "../lib/store";
import { parseScene, placeBoundArrows, sk, type Scene, type Skeleton } from "../lib/whiteboard";
import { Button, cx } from "./ui";
import { CodeEditor, CodePanel, ErrorBanner, errorLine, ExamplesMenu, itemAt, jsonItemSpans, OutputStrip, PanelBar, PhoneActions, RunButton, runKey, StatusFooter, ValidChip, type CodeEditorHandle, type CodeTab, type Example } from "./VisualCodePanel";

// Excalidraw's types are deep; we only need a handful of calls.
type API = {
  getSceneElements: () => readonly Record<string, unknown>[];
  getSceneElementsIncludingDeleted: () => readonly Record<string, unknown>[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
  updateScene: (s: { elements?: readonly unknown[]; appState?: Record<string, unknown> }) => void;
  scrollToContent: (target?: unknown, opts?: { fitToContent?: boolean; animate?: boolean }) => void;
  addFiles: (files: unknown[]) => void;
  setActiveTool: (t: { type: string }) => void;
};
type El = Record<string, unknown> & { id: string; type: string; x: number; y: number; width: number; height: number; isDeleted?: boolean; containerId?: string | null; boundElements?: { id: string; type: string }[] | null; groupIds?: string[] };

/** Dark-theme ink filter: near-black inks (#1e1e1e) turn light on the dark board, pure black (#000, sticky ink) and paper colours stay as they are. */
const INK_TABLE = "0.100 0.105 0.110 0.115 0.120 0.125 0.130 0.135 0.140 0.393 0.900 0.900 0.900 0.900 0.900 0.657 0.413 0.170 0.180 0.190 0.200 0.210 0.220 0.230 0.240 0.250 0.260 0.270 0.280 0.290 0.300 0.310 0.320 0.330 0.340 0.350 0.360 0.370 0.380 0.390 0.400 0.410 0.420 0.430 0.440 0.450 0.460 0.470 0.480 0.490 0.500 0.510 0.520 0.530 0.540 0.550 0.560 0.570 0.580 0.590 0.600 0.610 0.620 0.630 0.640 0.650 0.660 0.670 0.680 0.690 0.700 0.710 0.720 0.730 0.740 0.750 0.760 0.770 0.780 0.790 0.800 0.810 0.820 0.830 0.840 0.850 0.860 0.870 0.880 0.890 0.900 0.910 0.920 0.930 0.940 0.950 0.960 0.970 0.980 0.990 1.000";
/** Output-line markers OutputStrip (VisualCodePanel) turns into a check / x icon; the characters never render. */
const LOG_OK = "\u2713", LOG_ERR = "\u2716";
/** Sticky paper colours (WhiteboardBoard design); ink stays dark on every colour, in both themes. */
const PAPER = ["#fff3bf", "#d3f9d8", "#d0ebff", "#ffd8a8", "#eebefa", "#ffc9c9"];
const SIZES = [["S", 16], ["M", 20], ["L", 28]] as const;
const FONTS = [["Hand", 5], ["Sans", 6], ["Code", 8]] as const;
const isSticky = (e: El) => e.type === "rectangle" && PAPER.includes(String(e.backgroundColor).toLowerCase());
const rid = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
type Bar = { x: number; y: number; ids: string[]; color: string | null; size: number | null; font: number | null; text: boolean; stickies: boolean };

const SCRIPT_EXAMPLE = `// Whiteboard scripting (Excalidraw element skeletons).
// Helpers: sk.rect(x,y,w,h,label) sk.ellipse sk.diamond sk.text(x,y,text) sk.sticky(x,y,text,color)
//          sk.arrow(x,y,dx,dy) sk.connect(fromId,toId,label) sk.frame([ids],name)
// board.add([...skeletons])  board.fromMermaid(code)  board.clear()  board.elements  log(...)
const topics = ["Variables", "Functions", "Recursion", "Data structures"];
board.add(topics.map((t, i) => ({ ...sk.sticky(i * 240, 0, t, i), id: "t" + i })));
board.add(topics.slice(1).map((_, i) => sk.connect("t" + i, "t" + (i + 1))));
log("added", topics.length, "stickies");`;

const EXAMPLES: Example[] = [
  { icon: <GitFork size={15} />, title: "Mind map from headings", desc: "Each ## heading becomes a branch", code: `// Paste headings; each ## becomes a branch around the # root.
const md = \`# Study plan
## Linear algebra
## Optimization
## Neural networks
## Probability\`;
const lines = md.split("\\n");
const root = lines.find((l) => l.startsWith("# ")).slice(2);
const kids = lines.filter((l) => l.startsWith("## ")).map((l) => l.slice(3));
board.add([{ ...sk.ellipse(0, 0, 220, 110, root), id: "root" }]);
kids.forEach((k, i) => {
  const a = (i / kids.length) * Math.PI * 2;
  board.add([{ ...sk.rect(Math.cos(a) * 380 + 10, Math.sin(a) * 240 + 5, 200, 90, k), id: "k" + i }, sk.connect("root", "k" + i)]);
});
log("branches:", kids.length);` },
  { icon: <StickyNote size={15} />, title: "Stickies from list", desc: "One sticky per bullet, colours cycled", code: `// One sticky per bullet, wrapped in a frame.
const list = \`- Read chapter 3
- Redo exercise 2.4
- Flashcards: eigenvalues
- Ask about SVD in forum
- Past paper 2023\`;
const items = list.split("\\n").map((l) => l.replace(/^[-*]\\s*/, "").trim()).filter(Boolean);
board.add(items.map((t, i) => ({ ...sk.sticky((i % 3) * 230, Math.floor(i / 3) * 190, t, i), id: "s" + i })));
board.add([sk.frame(items.map((_, i) => "s" + i), "This week")]);
log("stickies:", items.length);` },
  { icon: <Workflow size={15} />, title: "Flowchart from Mermaid", desc: "Turns a mermaid block into shapes", code: `await board.fromMermaid(\`flowchart TD
  A[Lecture] --> B[Notes]
  B --> C{Clear?}
  C -->|yes| D([Flashcards])
  C -->|no| E[Ask in forum]
  E --> B\`);
log("flowchart added");` },
];

const MMD_DEFAULT = "flowchart TD\n  A[Lecture] --> B[Notes]\n  B --> C{Clear?}\n  C -->|yes| D([Flashcards])\n  C -->|no| E[Ask in forum]\n  E --> B";

// Excalidraw chrome in Lumen tokens (surface, border, amber active tool) + paper-on-grid background.
const WB_CSS = `
.lumen-wb { background-color: var(--bg); background-image: linear-gradient(color-mix(in srgb,var(--muted) 9%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--muted) 9%,transparent) 1px,transparent 1px); background-size: 24px 24px; }
.lumen-wb .excalidraw, .lumen-wb .excalidraw.theme--dark {
  --island-bg-color: var(--surface); --default-border-color: var(--border); --button-hover-bg: var(--surface-2);
  --color-surface-primary: var(--surface); --color-surface-low: var(--surface-2); --color-surface-mid: var(--surface-2); --color-surface-high: var(--surface-2); --color-surface-lowest: var(--bg);
  --color-primary: var(--accent); --color-primary-darker: var(--accent); --color-primary-darkest: var(--accent); --color-primary-hover: var(--accent);
  --color-primary-light: color-mix(in srgb,var(--accent) 18%,transparent); --color-primary-light-darker: color-mix(in srgb,var(--accent) 26%,transparent);
  --color-on-primary-container: var(--accent); --color-surface-primary-container: color-mix(in srgb,var(--accent) 18%,transparent); --color-brand-hover: var(--accent); --color-brand-active: var(--accent);
  --text-primary-color: var(--text); --icon-fill-color: var(--text); --ui-font: Inter, system-ui, sans-serif;
}
.lumen-wb .excalidraw .Island { border: 1px solid var(--border); box-shadow: none; }
.lumen-wb.wb-sticky-sel .excalidraw .App-menu__left { display: none; }
/* Lumen chrome replaces these: export lives in the cluster, hints and help stay out of the way. */
.lumen-wb .excalidraw .default-sidebar-trigger, .lumen-wb .excalidraw .HintViewer, .lumen-wb .excalidraw .help-icon, .lumen-wb .excalidraw .main-menu-trigger { display: none !important; }
/* Dark theme: flip only the dark inks (black strokes/text turn light) and keep paper colours as paper, so stickies read the same in both themes. */
.lumen-wb .excalidraw.theme--dark { --theme-filter: url(#lumen-wb-ink); }
@media (max-width: 767px) { .lumen-wb .excalidraw .App-bottom-bar, .lumen-wb .excalidraw .App-toolbar--mobile, .lumen-wb .excalidraw .mobile-misc-tools-container { display: none !important; } }
`;

export default function Whiteboard({ note }: { note: Note }) {
  const settings = useSettings();
  const dark = useMemo(() => activeTheme().dark, [settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const initial = useMemo(() => parseScene(note.body), []); // eslint-disable-line react-hooks/exhaustive-deps
  const api = useRef<API | null>(null);
  const lastSaved = useRef(note.body);
  const lastVersion = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [panel, setPanel] = useState<CodeTab | null>(null);
  const [mermaidOpen, setMermaidOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [src, setSrc] = useState(() => { try { return localStorage.getItem("lumen.wbScript") ?? SCRIPT_EXAMPLE; } catch { return SCRIPT_EXAMPLE; } });
  const [logs, setLogs] = useState<string[]>([]);
  const [bar, setBar] = useState<Bar | null>(null);
  const [tool, setTool] = useState("selection");
  const [more, setMore] = useState(false);
  const barKey = useRef("");
  const pendingDone = useRef(false);
  const [cursor, setCursor] = useState<{ line: number; col: number } | null>({ line: 1, col: 1 });
  const ed = useRef<CodeEditorHandle | null>(null);
  const host = useRef<HTMLDivElement>(null);

  // A conversion ("Mermaid block → Whiteboard" with no block found) asks to open the Mermaid dialog.
  useEffect(() => {
    try { if (sessionStorage.getItem("lumen.wbMermaid.open") === note.id) { sessionStorage.removeItem("lumen.wbMermaid.open"); setMermaidOpen(true); } } catch { /* ignore */ }
  }, [note.id]);

  /** Selection → compact style bar above it (paper colours, size, font, duplicate, delete). */
  const track = (els: readonly El[], st: Record<string, unknown>) => {
    const at = st.activeTool as { type: string } | undefined;
    if (at && at.type !== tool) setTool(at.type);
    const selIds = Object.keys((st.selectedElementIds as Record<string, boolean>) ?? {});
    const sel = els.filter((e) => selIds.includes(e.id) && !e.isDeleted);
    if (!sel.length || st.editingTextElement || st.selectedElementsAreBeingDragged || st.resizingElement || (at && at.type !== "selection")) {
      if (barKey.current) { barKey.current = ""; setBar(null); }
      return;
    }
    const z = (st.zoom as { value: number }).value, sx = st.scrollX as number, sy = st.scrollY as number;
    const minX = Math.min(...sel.map((e) => Math.min(e.x, e.x + e.width))), minY = Math.min(...sel.map((e) => Math.min(e.y, e.y + e.height)));
    const maxY = Math.max(...sel.map((e) => Math.max(e.y, e.y + e.height)));
    const texts = els.filter((e) => e.type === "text" && !e.isDeleted && (selIds.includes(e.id) || (!!e.containerId && selIds.includes(e.containerId))));
    const fill = sel.find((e) => e.type !== "text" && e.type !== "arrow" && e.type !== "line" && e.type !== "freedraw");
    const x = (minX + sx) * z - 10, top = (minY + sy) * z - 54;
    const b: Bar = {
      x: Math.max(8, x), y: top < 60 ? (maxY + sy) * z + 14 : top, ids: sel.map((e) => e.id),
      color: fill ? String(fill.backgroundColor).toLowerCase() : null, size: texts[0] ? Number(texts[0].fontSize) : null, font: texts[0] ? Number(texts[0].fontFamily) : null,
      text: texts.length > 0, stickies: sel.every((e) => isSticky(e) || (e.type === "text" && !!e.containerId)),
    };
    const k = JSON.stringify(b);
    if (k !== barKey.current) { barKey.current = k; setBar(b); }
  };
  /** Rewrite the selected elements (and their bound text), re-measuring text so sizes/fonts stay laid out. */
  const restyle = (fn: (e: El, selected: boolean) => El | null) => {
    const a = api.current;
    if (!a || !bar) return;
    const ids = new Set(bar.ids);
    const els = a.getSceneElementsIncludingDeleted() as El[];
    const next = els.map((e) => {
      const selected = ids.has(e.id);
      if (!selected && !(e.containerId && ids.has(e.containerId))) return e;
      const r = fn({ ...e }, selected);
      return r ? { ...r, version: ((e.version as number) ?? 1) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() } : e;
    });
    a.updateScene({ elements: restoreElements(next as never, null, { refreshDimensions: true, repairBindings: true }) });
  };
  const paint = (c: string) => restyle((e, selected) => {
    if (e.type === "text") return e.containerId || selected ? { ...e, strokeColor: "#000000" } : null;
    if (e.type === "arrow" || e.type === "line" || e.type === "freedraw") return null;
    return { ...e, backgroundColor: c, fillStyle: "solid", ...(isSticky(e) || e.strokeColor === "transparent" ? { strokeColor: "transparent" } : {}) };
  });
  const textStyle = (p: Record<string, unknown>) => restyle((e) => (e.type === "text" ? { ...e, ...p } : null));
  const duplicate = () => {
    const a = api.current;
    if (!a || !bar) return;
    const els = a.getSceneElementsIncludingDeleted() as El[];
    const ids = new Set(bar.ids);
    const pick = els.filter((e) => !e.isDeleted && (ids.has(e.id) || (!!e.containerId && ids.has(e.containerId))));
    const map = new Map(pick.map((e) => [e.id, rid()]));
    const groups = new Map<string, string>();
    const gid = (g: string) => { if (!groups.has(g)) groups.set(g, rid()); return groups.get(g)!; };
    const copies = pick.map((e) => ({
      ...e, id: map.get(e.id)!, x: e.x + 20, y: e.y + 20, seed: Math.floor(Math.random() * 2 ** 31), version: 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now(),
      containerId: e.containerId ? map.get(e.containerId) ?? null : e.containerId ?? null,
      boundElements: e.boundElements?.filter((b) => map.has(b.id)).map((b) => ({ ...b, id: map.get(b.id)! })) ?? null,
      groupIds: (e.groupIds ?? []).map(gid),
    }));
    const selected = Object.fromEntries(pick.filter((e) => ids.has(e.id)).map((e) => [map.get(e.id)!, true]));
    a.updateScene({ elements: restoreElements([...els, ...copies] as never, null, { refreshDimensions: true }), appState: { selectedElementIds: selected } });
  };
  const remove = () => {
    const a = api.current;
    if (!a || !bar) return;
    const ids = new Set(bar.ids);
    a.updateScene({ elements: (a.getSceneElementsIncludingDeleted() as El[]).map((e) => (ids.has(e.id) || (e.containerId && ids.has(e.containerId)) ? { ...e, isDeleted: true, version: ((e.version as number) ?? 1) + 1 } : e)), appState: { selectedElementIds: {} } });
  };
  /** Sticky (Lumen addition): a paper note at the centre of the view, selected and ready to type. */
  const addSticky = () => {
    const a = api.current;
    if (!a) return;
    const st = a.getAppState() as Record<string, number> & { zoom: { value: number } };
    const z = st.zoom.value, w = host.current?.clientWidth ?? 400, h = host.current?.clientHeight ?? 600;
    const id = rid();
    const els = convertToExcalidrawElements([{ ...sk.sticky(w / 2 / z - st.scrollX - 100, h / 2.4 / z - st.scrollY - 80, "", Math.floor(Math.random() * 6)), id }] as never, { regenerateIds: false });
    a.updateScene({ elements: [...a.getSceneElementsIncludingDeleted(), ...els], appState: { selectedElementIds: { [id]: true } } });
    a.setActiveTool({ type: "selection" });
  };
  const key = (k: string, shift = false) => host.current?.querySelector(".excalidraw")?.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: "Key" + k.toUpperCase(), ctrlKey: true, metaKey: true, shiftKey: shift, bubbles: true }));

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
  const save = (keepTime = false) => {
    if (!api.current) return;
    const s = serialize();
    if (s === lastSaved.current) return;
    lastSaved.current = s;
    void updateNote(note.id, { body: s }, { keepTime });
  };
  const add = async (skel: Skeleton[], auto = false) => {
    const a = api.current;
    if (!a || !skel.length) return;
    // Sticky ink is pure black so it stays dark on paper in both themes (see INK_TABLE).
    const fixed = skel.map((k) => (k.type === "rectangle" && PAPER.includes(String(k.backgroundColor).toLowerCase()) && k.label ? { ...k, label: { ...(k.label as object), strokeColor: "#000000" } } : k));
    const conv = convertToExcalidrawElements(placeBoundArrows(fixed as Skeleton[], a.getSceneElements() as never) as never, { regenerateIds: false }) as unknown as El[];
    const stickyIds = new Set(conv.filter(isSticky).map((e) => e.id));
    const els = conv.map((e) => (e.type === "text" && e.containerId && stickyIds.has(e.containerId) ? { ...e, strokeColor: "#000000" } : e));
    a.updateScene({ elements: [...a.getSceneElementsIncludingDeleted(), ...els] });
    setTimeout(() => { a.scrollToContent(els as never, { fitToContent: true, animate: true }); save(auto); }, 50);
  };

  // Apply skeletons pushed through the REST API (lumenPending), once the editor is ready.
  const applyPending = (sc: Scene) => {
    if (!sc.lumenPending?.length) return;
    const pending = sc.lumenPending;
    sc.lumenPending = undefined; // save() serializes from the editor, which never includes lumenPending
    void add(pending, true);
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
    const t0 = performance.now();
    try {
      await new Function("board", "sk", "log", `"use strict"; return (async () => { ${src}\n })();`)(board, sk, log);
      setLogs([...out, `${LOG_OK} done · ${Math.round(performance.now() - t0)} ms · restore from History`]);
      setTimeout(save, 200);
    } catch (e) { setLogs([...out, `${LOG_ERR} ${(e as Error).message}`]); }
  }

  async function fromMermaid(c: string, opts: { sketchy?: boolean; frame?: boolean } = {}) {
    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
    const { elements, files } = await parseMermaidToExcalidraw(c);
    if (files) api.current?.addFiles(Object.values(files));
    let skel = elements as Skeleton[];
    if (opts.sketchy === false) skel = skel.map((e) => ({ ...e, roughness: 0 }));
    if (opts.frame) {
      skel = skel.map((e, i) => ({ ...e, id: (e.id as string | undefined) ?? `mmd-${Date.now().toString(36)}-${i}` }));
      skel.push(sk.frame(skel.map((e) => e.id as string), "Mermaid"));
    }
    await add(skel);
  }

  async function exportAs(kind: "png" | "svg" | "excalidraw") {
    setExportOpen(false);
    const a = api.current;
    if (!a) return;
    if (kind === "excalidraw") return download(`${note.title}.excalidraw`, serialize(), "application/json");
    const opts = { elements: a.getSceneElements() as never, appState: { ...a.getAppState(), exportBackground: true, viewBackgroundColor: dark ? "#0F1115" : "#ffffff", exportWithDarkMode: dark } as never, files: a.getFiles() as never };
    if (kind === "png") download(`${note.title}.png`, await exportToBlob({ ...opts, mimeType: "image/png" }));
    else download(`${note.title}.svg`, new XMLSerializer().serializeToString(await exportToSvg(opts)), "image/svg+xml");
  }

  const openTab = (t: CodeTab) => {
    if (t === "json") { setCode(JSON.stringify(JSON.parse(serialize()), null, 2)); setCodeErr(null); }
    setPanel(t);
  };
  const toggleTab = (t: CodeTab) => (panel === t ? setPanel(null) : openTab(t));
  const applyCode = () => {
    const { scene, error } = parseScene(code);
    if (error) return setCodeErr(error);
    const r = restore({ elements: scene.elements as never }, null, null);
    api.current?.updateScene({ elements: r.elements });
    setTimeout(save, 50);
    setCodeErr(null);
    toast("Applied to the board");
  };
  const jsonSpans = useMemo(() => (panel === "json" ? jsonItemSpans(code) : new Map<string, { from: number; to: number }>()), [panel, code]);
  const clusterBtn = (on: boolean) => cx("flex size-8 items-center justify-center rounded-[8px] transition-colors", on ? "text-accent" : "text-ink hover:bg-surface-2");

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <style>{WB_CSS}</style>
      <svg width="0" height="0" className="absolute" aria-hidden>
        <filter id="lumen-wb-ink" colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="table" tableValues={INK_TABLE} />
            <feFuncG type="table" tableValues={INK_TABLE} />
            <feFuncB type="table" tableValues={INK_TABLE} />
          </feComponentTransfer>
        </filter>
      </svg>
      <div ref={host} className={cx("lumen-wb relative min-h-0 flex-1", bar?.stickies && "wb-sticky-sel")}>
        <Excalidraw
          excalidrawAPI={(a) => { api.current = a as unknown as API; if (!pendingDone.current) { pendingDone.current = true; setTimeout(() => applyPending(initial.scene), 60); } }}
          initialData={initialData as never}
          theme={dark ? "dark" : "light"}
          onChange={(els, st) => {
            track(els as unknown as readonly El[], st as unknown as Record<string, unknown>);
            const v = (els as readonly { version: number; id: string }[]).reduce((s, e) => s + e.version, 0) + ":" + els.length;
            if (v === lastVersion.current) return; // ignore pure scroll/zoom/selection changes
            lastVersion.current = v;
            clearTimeout(timer.current);
            timer.current = setTimeout(save, 700);
          }}
          UIOptions={{ canvasActions: { loadScene: true, saveToActiveFile: false, export: { saveFileToDisk: true }, toggleTheme: false } }}
          renderTopRightUI={() => (
            // Lumen cluster: </> code · >_ script · Mermaid → shapes · export
            <div className={cx("relative items-center gap-0.5 rounded-[12px] border border-line bg-surface p-1", exportOpen ? "flex" : "hidden md:flex")}>
              <button title="Code: edit .excalidraw JSON" aria-label="Code" className={cx(clusterBtn(panel === "json"), panel === "json" && "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]")} onClick={() => toggleTab("json")}><Code2 size={16} /></button>
              <button title="Script console" aria-label="Script console" className={cx(clusterBtn(panel === "script"), panel === "script" && "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]")} onClick={() => toggleTab("script")}><SquareTerminal size={16} /></button>
              <button title="Mermaid → shapes" aria-label="Mermaid to shapes" className={cx(clusterBtn(mermaidOpen), "!w-auto gap-1.5 px-2.5 text-[12.5px]")} onClick={() => setMermaidOpen(true)}><Workflow size={15} /><span className="hidden lg:inline">Mermaid</span></button>
              <span className="mx-0.5 h-5 w-px bg-line" />
              <button title="Export" aria-label="Export" className={clusterBtn(exportOpen)} onClick={() => setExportOpen((o) => !o)}><Download size={16} /></button>
              {exportOpen && (
                <div className="absolute right-0 top-11 z-30 flex w-44 flex-col gap-px rounded-[12px] border border-line bg-surface-2 p-1.5 text-[13px] shadow-[0_16px_40px_rgba(0,0,0,.45)] fade-in">
                  {([["png", "PNG image"], ["svg", "SVG vector"], ["excalidraw", ".excalidraw file"]] as const).map(([k, l]) => (
                    <button key={k} onClick={() => exportAs(k)} className="flex h-[34px] items-center gap-2.5 rounded-[8px] px-2.5 text-left hover:bg-bg"><Download size={14} className="text-muted" />{l}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        />

        {/* Selection style bar: 6 paper colours · size · font · duplicate · delete */}
        {bar && (
          <div className="absolute z-20 flex items-center gap-1.5 rounded-[10px] border border-line bg-surface-2 p-1.5 shadow-[0_10px_28px_rgba(0,0,0,.35)] fade-in" style={{ left: bar.x, top: bar.y }} onPointerDown={(e) => e.stopPropagation()}>
            {PAPER.map((c) => (
              <button key={c} aria-label={"Colour " + c} title="Paper colour" onClick={() => paint(c)} className="size-[22px] rounded-[5px]"
                style={{ background: c, boxShadow: bar.color === c ? "0 0 0 2px var(--surface-2), 0 0 0 3.5px var(--text)" : "inset 0 0 0 1px rgba(0,0,0,.08)" }} />
            ))}
            {bar.text && (
              <>
                <span className="mx-0.5 h-[18px] w-px bg-line" />
                <button title="Text size" onClick={() => { const i = SIZES.findIndex(([, v]) => v === bar.size); textStyle({ fontSize: SIZES[(i + 1) % SIZES.length][1] }); }} className="flex h-[26px] min-w-[26px] items-center justify-center rounded-[6px] px-1 text-[12px] font-semibold text-muted hover:bg-bg hover:text-ink">
                  {SIZES.find(([, v]) => v === bar.size)?.[0] ?? "M"}
                </button>
                <button title="Font" onClick={() => { const i = FONTS.findIndex(([, v]) => v === bar.font); textStyle({ fontFamily: FONTS[(i + 1) % FONTS.length][1] }); }} className="flex h-[26px] items-center justify-center rounded-[6px] px-1.5 text-[12px] text-muted hover:bg-bg hover:text-ink"
                  style={{ fontFamily: bar.font === 8 ? "'JetBrains Mono', monospace" : bar.font === 6 ? "Inter, sans-serif" : "Caveat, 'Comic Sans MS', cursive", fontSize: bar.font === 5 || !bar.font ? 15 : 12 }}>
                  {FONTS.find(([, v]) => v === bar.font)?.[0] ?? "Hand"}
                </button>
              </>
            )}
            <span className="mx-0.5 h-[18px] w-px bg-line" />
            <button aria-label="Duplicate" title="Duplicate" onClick={duplicate} className="flex size-[26px] items-center justify-center rounded-[6px] text-muted hover:bg-bg hover:text-ink"><Copy size={14} /></button>
            <button aria-label="Delete" title="Delete" onClick={remove} className="flex size-[26px] items-center justify-center rounded-[6px] text-muted hover:bg-bg hover:text-bad"><Trash2 size={14} /></button>
          </div>
        )}

        {/* Phone: bottom tool dock (thumb reach); the ellipsis holds the rest */}
        {!panel && (
          <div className="absolute inset-x-3 bottom-4 z-20 md:hidden" onPointerDown={(e) => e.stopPropagation()}>
            {more && (
              <div className="mb-2 grid grid-cols-4 gap-1 rounded-[16px] border border-line bg-surface p-2 fade-in">
                {([["selection", <MousePointer2 size={20} />, "Select"], ["eraser", <Eraser size={20} />, "Eraser"], ["frame", <Frame size={20} />, "Frame"], ["image", <Image size={20} />, "Image"], ["diamond", <Diamond size={20} />, "Diamond"], ["ellipse", <Circle size={20} />, "Ellipse"], ["line", <Minus size={20} />, "Line"]] as const).map(([t, icon, l]) => (
                  <button key={t} onClick={() => { api.current?.setActiveTool({ type: t }); setMore(false); }} className={cx("flex h-14 flex-col items-center justify-center gap-0.5 rounded-[12px] text-[10.5px]", tool === t ? "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-accent" : "")}>{icon}{l}</button>
                ))}
                {([["json", <Code2 size={20} />, "Code"], ["script", <SquareTerminal size={20} />, "Script"], ["mermaid", <Workflow size={20} />, "Mermaid"], ["export", <Download size={20} />, "Export"]] as const).map(([k, icon, l]) => (
                  <button key={k} onClick={() => { setMore(false); if (k === "mermaid") setMermaidOpen(true); else if (k === "export") setExportOpen(true); else openTab(k); }} className="flex h-14 flex-col items-center justify-center gap-0.5 rounded-[12px] text-[10.5px]">{icon}{l}</button>
                ))}
                <div className="flex items-center justify-center gap-1">
                  <button aria-label="Undo" onClick={() => key("z")} className="flex size-11 items-center justify-center rounded-[12px]"><Undo2 size={19} /></button>
                  <button aria-label="Redo" onClick={() => key("z", true)} className="flex size-11 items-center justify-center rounded-[12px]"><Redo2 size={19} /></button>
                </div>
              </div>
            )}
            <div className="grid h-16 grid-cols-7 items-center rounded-[16px] border border-line bg-surface px-1">
              {([["hand", <Hand size={20} />], ["freedraw", <Pencil size={20} />], ["rectangle", <Square size={20} />], ["arrow", <MoveUpRight size={20} />], ["sticky", <StickyNote size={20} />], ["text", <Type size={20} />]] as const).map(([t, icon]) => (
                <button key={t} aria-label={t === "freedraw" ? "Pen" : t} onClick={() => { setMore(false); if (t === "sticky") addSticky(); else api.current?.setActiveTool({ type: tool === t && t !== "hand" ? "selection" : t }); }}
                  className={cx("flex h-12 items-center justify-center rounded-[12px]", tool === t && "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-accent")}>{icon}</button>
              ))}
              <button aria-label="More tools" onClick={() => setMore((m) => !m)} className={cx("flex h-12 items-center justify-center rounded-[12px]", (more || ["eraser", "frame", "image", "diamond", "ellipse", "line"].includes(tool)) && "text-accent")}><Ellipsis size={20} /></button>
            </div>
          </div>
        )}
      </div>

      {panel && (
        <CodePanel tab={panel} onTab={openTab} onClose={() => setPanel(null)} phoneRight={panel === "json" ? <ValidChip error={codeErr} big /> : <ExamplesMenu examples={EXAMPLES} onPick={setSrc} />}>
          {panel === "json" ? (
            <>
              <PanelBar>
                <span className="font-semibold">Excalidraw</span>
                <span className="truncate font-mono text-[11.5px] text-muted">.excalidraw · v2</span>
                <span className="flex-1" />
                <ValidChip error={codeErr} />
                <button onClick={applyCode} disabled={!!codeErr} className="flex h-7 items-center rounded-[8px] border border-line px-2.5 text-[13px] hover:bg-surface-2 disabled:opacity-50 disabled:hover:bg-transparent">Apply</button>
                <button title="Download .excalidraw" aria-label="Download .excalidraw" onClick={() => exportAs("excalidraw")} className="flex size-7 items-center justify-center rounded-[8px] border border-line hover:bg-surface-2"><Download size={14} /></button>
              </PanelBar>
              {codeErr && <ErrorBanner error={codeErr} line={errorLine(codeErr, code)} onGoto={() => { const l = errorLine(codeErr, code); if (l) ed.current?.goto(l); }} />}
              <CodeEditor value={code} handle={ed} onChange={(t) => { setCode(t); setCodeErr(parseScene(t).error); }}
                band={(() => { const id = bar?.ids[0]; return id ? jsonSpans.get(id) ?? null : null; })()}
                onCursor={(c) => { setCursor({ line: c.line, col: c.col }); if (c.user) { const id = itemAt(jsonSpans, c.pos); if (id && !bar?.ids.includes(id)) api.current?.updateScene({ appState: { selectedElementIds: { [id]: true } } }); } }} />
              <StatusFooter><span className="truncate">{codeErr ? "Board keeps last valid state" : "Edit, then Apply"}</span><span className="flex-1" />{cursor && <span className="shrink-0 tabular-nums">Ln {cursor.line}, Col {cursor.col}</span>}</StatusFooter>
              <PhoneActions>
                <button aria-label="Download .excalidraw" onClick={() => exportAs("excalidraw")} className="flex size-[52px] items-center justify-center rounded-[12px] border border-line"><Download size={18} /></button>
                <button disabled={!!codeErr} onClick={() => { applyCode(); setPanel(null); }} className="flex h-[52px] flex-1 items-center justify-center rounded-[12px] bg-accent text-[15px] font-semibold text-accent-fg disabled:opacity-50">Apply</button>
              </PhoneActions>
            </>
          ) : (
            <>
              <PanelBar>
                <ExamplesMenu examples={EXAMPLES} onPick={setSrc} />
                <span className="flex-1" />
                <span className="text-[11.5px] text-muted">board · sk · log</span>
                <RunButton onRun={runScript} />
              </PanelBar>
              <CodeEditor lang="js" value={src} onChange={setSrc} onKeyDown={runKey(runScript)} />
              <OutputStrip logs={logs} onClear={() => setLogs([])} empty="Output appears here." />
              <PhoneActions><RunButton onRun={runScript} big /></PhoneActions>
            </>
          )}
        </CodePanel>
      )}

      {mermaidOpen && <MermaidDialog dark={dark} onClose={() => setMermaidOpen(false)} onAdd={(c, o) => fromMermaid(c, o)} />}
    </div>
  );
}

/** Small switch (30×18), amber when on. */
function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex items-center gap-2 text-[13px]">
      <span className={cx("relative h-[18px] w-[30px] shrink-0 rounded-full", on ? "bg-accent" : "border border-line bg-surface-2")}>
        <span className={cx("absolute size-3 rounded-full", on ? "right-[3px] top-[3px] bg-accent-fg" : "left-[2px] top-[2px] bg-muted")} />
      </span>
      {label}
    </button>
  );
}

let mmdSeq = 0;
/** Mermaid → whiteboard: code on the left, live preview on the right (250 ms debounce, keeps the last good drawing). */
function MermaidDialog({ dark, onClose, onAdd }: { dark: boolean; onClose: () => void; onAdd: (code: string, o: { sketchy: boolean; frame: boolean }) => Promise<void> }) {
  const [src, setSrc] = useState(() => { try { return localStorage.getItem("lumen.wbMermaid") ?? MMD_DEFAULT; } catch { return MMD_DEFAULT; } });
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState("flowchart");
  const [sketchy, setSketchy] = useState(true);
  const [frame, setFrame] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"code" | "preview">("code");

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        // Preview = exactly what gets added: Mermaid → Excalidraw shapes, rendered hand-drawn (or clean) by Excalidraw.
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
        await mermaid.parse(src);
        const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
        const { elements, files } = await parseMermaidToExcalidraw(src);
        const els = convertToExcalidrawElements((elements as Skeleton[]).map((e) => ({ ...e, roughness: sketchy ? 1 : 0, ...(sketchy ? {} : { fontFamily: 2 }) })) as never, { regenerateIds: true });
        const out = await exportToSvg({ elements: els as never, appState: { exportBackground: false, exportWithDarkMode: dark, viewBackgroundColor: "transparent" } as never, files: (files ?? {}) as never, exportPadding: 16 });
        if (!live) return;
        setSvg(out.outerHTML);
        setErr(null);
        setKind(src.trim().split(/\s/)[0] || "diagram");
      } catch (e) {
        if (!live) return;
        setErr(String((e as Error).message ?? e).split("\n")[0]);
        document.getElementById(`dwb-mmd-${mmdSeq}`)?.remove();
      }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [src, dark, sketchy]);

  async function add() {
    setBusy(true);
    try {
      try { localStorage.setItem("lumen.wbMermaid", src); } catch { /* ignore */ }
      await onAdd(src, { sketchy, frame });
      onClose();
    } catch (e) { toast(`Mermaid: ${(e as Error).message}`); } finally { setBusy(false); }
  }

  const preview = (
    <div className="relative mx-4 h-full min-h-0 overflow-hidden rounded-[12px] border border-line bg-bg md:mx-0 md:rounded-none md:border-0 md:bg-[image:var(--wb-grid)] md:bg-[size:24px_24px]" style={{ ["--wb-grid" as string]: "linear-gradient(color-mix(in srgb,var(--muted) 9%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--muted) 9%,transparent) 1px,transparent 1px)" }}>
      <span className="absolute left-3.5 top-3 hidden text-[11.5px] font-medium text-muted md:inline">Live preview{sketchy ? " · hand-drawn style" : ""}</span>
      <div className="flex h-full items-center justify-center px-10 pb-6 pt-10 [&_svg]:h-auto [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(5,6,8,.62)] md:items-center fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-in safe-t safe-b flex h-dvh w-full flex-col overflow-hidden bg-surface md:h-[620px] md:border md:border-line md:max-h-[90dvh] md:max-w-[1040px] md:rounded-[14px]">
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-5">
          <Workflow size={17} className="hidden text-muted md:block" />
          <span className="flex-1 text-[17px] font-[650] md:text-[16px]">Mermaid → whiteboard</span>
          <span className={cx("hidden h-[26px] items-center rounded-full px-2.5 text-[12px] font-semibold md:flex", err ? "bg-bad/14 text-bad" : "bg-ok/14 text-ok")}>{err ? <><X size={12} className="mr-1" />invalid</> : <><Check size={12} className="mr-1" />{kind} · valid</>}</span>
          <button aria-label="Close" onClick={onClose} className="-mr-4 ml-1.5 flex size-12 items-center justify-center rounded-[8px] text-ink hover:bg-surface-2 md:mr-0 md:size-9 md:text-muted md:hover:text-ink [&>svg]:size-5 md:[&>svg]:size-[18px]"><X size={18} /></button>
        </div>
        <div className="flex shrink-0 items-center gap-2.5 px-4 py-3 md:hidden">
          <div className="grid flex-1 grid-cols-2 rounded-[10px] border border-line bg-bg p-[3px]">
            {(["code", "preview"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={cx("h-[38px] rounded-[7px] text-[13px] capitalize", tab === t ? "bg-surface-2 font-semibold" : "text-muted")}>{t}</button>)}
          </div>
          <span className={cx("flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold", err ? "bg-bad/14 text-bad" : "bg-ok/14 text-ok")}>{err ? <X size={12} /> : <><Check size={12} className="mr-1" />valid</>}</span>
        </div>
        <div className="grid min-h-0 flex-1 md:grid-cols-[400px_1fr]">
          <div className={cx("flex min-h-0 flex-col border-line bg-bg md:flex md:border-r", tab === "code" ? "flex" : "hidden")}>
            <CodeEditor lang="mermaid" value={src} onChange={setSrc} className="min-h-0 flex-1 overflow-auto pt-0.5 [&_.cm-content]:[font-variant-ligatures:none] [&_.cm-editor]:!text-[13px] [&_.cm-scroller]:!leading-[22px]" />
            {err && <div className="shrink-0 border-t border-line px-3.5 py-2 text-[12px] text-bad">{err}</div>}
          </div>
          <div className={cx("min-h-0 md:block", tab === "preview" ? "block" : "hidden")}>{preview}</div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-[18px] gap-y-2 px-4 py-3 md:h-16 md:border-t md:border-line md:px-5 md:py-0">
          <span className="hidden md:contents"><Switch label="Hand-drawn style" on={sketchy} onChange={setSketchy} /><Switch label="Wrap in a frame" on={frame} onChange={setFrame} /></span>
          <span className="flex-1" />
          <Button variant="ghost" className="max-md:!hidden" onClick={onClose}>Cancel</Button>
          <Button variant="primary" className="h-[52px] w-full rounded-[12px] text-[15px] font-semibold md:h-[38px] md:w-auto md:rounded-[10px] md:text-[13px]" disabled={!!err || busy} onClick={add}><Shapes size={15} />Add as editable shapes</Button>
        </div>
      </div>
    </div>
  );
}
