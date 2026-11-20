import { Excalidraw, convertToExcalidrawElements, exportToSvg, restore, restoreElements, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { Check, Shapes, StickyNote, GitFork, Workflow, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { duplicateNote, restoreNote, trashNote, updateNote } from "../lib/actions";
import { download } from "../lib/io";
import { attUrl } from "../lib/api";
import { attBlob, resolveAtt, storeBlob } from "../lib/attachments";
import { blobToDataURL, dataURLToBlob, hydrateFiles, inlineSceneFiles, isPhoto, shrinkImage, type SceneFile } from "../lib/wb-files";
import { embedProps, mediaElement, mediaKindOf, mediaSize } from "./wb-media";
import { useSettings, activeTheme } from "../lib/settings";
import { t, tk } from "../lib/i18n";
import { back, openNote, setUI, toast, useUI, useVaultSelector } from "../lib/store";
import { canGoBack } from "../lib/nav-history";
import { openExport } from "../lib/diagram-export";
import { parseScene, placeBoundArrows, sk, type Scene, type Skeleton } from "../lib/whiteboard";
import { Button, cx } from "./ui";
import { useRtl } from "./ws-dir";
import { ShareSheet } from "./ShareSheet";
import { CodeEditor, CodePanel, ErrorBanner, errorLine, ExamplesMenu, itemAt, jsonItemSpans, OutputStrip, PanelBar, PhoneActions, RunButton, runKey, StatusFooter, ValidChip, type CodeEditorHandle, type CodeTab, type Example } from "./VisualCodePanel";
import { onRegistry, wbRegistry, type WbAPI, type WbCtx, type WbPanel } from "./wb/hooks";
import { Toolbar, type ArrowType, type MoreItem } from "./wb/Toolbar";
import { PropertyBar, type Action, type BarMode, type Style } from "./wb/PropertyBar";
import { ToolWheel } from "./wb/ToolWheel";
import { HeaderMenu, type MenuItem } from "./wb/HeaderMenu";
import { PhoneDock } from "./wb/PhoneDock";
import { BoardHeader, useSavedLine } from "./wb/BoardHeader";
import { FrameChip, Minimap, ZoomCluster } from "./wb/BottomBar";
import { Banner, EmptyBoard } from "./wb/States";
import { NoteCardPicker, noteCardSkeleton } from "./wb/NoteCard";
import { Glyph } from "./Glyph";
import { KEY_TOOL, loadInk, loadRecent, lumenTool, PAPER, pushRecent, saveInk, shown, type Ink, type LineKind, type ShapeKind, type ToolId, type WheelSlot } from "./wb/tools";

type API = WbAPI;
type El = Record<string, unknown> & { id: string; type: string; x: number; y: number; width: number; height: number; isDeleted?: boolean; containerId?: string | null; boundElements?: { id: string; type: string }[] | null; groupIds?: string[] };

/** Dark-theme ink filter: near-black inks (#1e1e1e) turn light on the dark board, pure black (#000, sticky ink) and paper colours stay as they are. */
const INK_TABLE = "0.100 0.105 0.110 0.115 0.120 0.125 0.130 0.135 0.140 0.393 0.900 0.900 0.900 0.900 0.900 0.657 0.413 0.170 0.180 0.190 0.200 0.210 0.220 0.230 0.240 0.250 0.260 0.270 0.280 0.290 0.300 0.310 0.320 0.330 0.340 0.350 0.360 0.370 0.380 0.390 0.400 0.410 0.420 0.430 0.440 0.450 0.460 0.470 0.480 0.490 0.500 0.510 0.520 0.530 0.540 0.550 0.560 0.570 0.580 0.590 0.600 0.610 0.620 0.630 0.640 0.650 0.660 0.670 0.680 0.690 0.700 0.710 0.720 0.730 0.740 0.750 0.760 0.770 0.780 0.790 0.800 0.810 0.820 0.830 0.840 0.850 0.860 0.870 0.880 0.890 0.900 0.910 0.920 0.930 0.940 0.950 0.960 0.970 0.980 0.990 1.000";
/** Output-line markers OutputStrip (VisualCodePanel) turns into a check / x icon; the characters never render. */
const LOG_OK = "✓", LOG_ERR = "✖";
const PERF_LIMIT = 3000;
const isSticky = (e: El) => e.type === "rectangle" && PAPER.includes(String(e.backgroundColor).toLowerCase());
const rid = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);

const SCRIPT_EXAMPLE = `// Whiteboard scripting (Excalidraw element skeletons).
// Helpers: sk.rect(x,y,w,h,label) sk.ellipse sk.diamond sk.text(x,y,text) sk.sticky(x,y,text,color)
//          sk.arrow(x,y,dx,dy) sk.connect(fromId,toId,label) sk.frame([ids],name)
// board.add([...skeletons])  board.fromMermaid(code)  board.clear()  board.elements  log(...)
const topics = ["Variables", "Functions", "Recursion", "Data structures"];
board.add(topics.map((t, i) => ({ ...sk.sticky(i * 240, 0, t, i), id: "t" + i })));
board.add(topics.slice(1).map((_, i) => sk.connect("t" + i, "t" + (i + 1))));
log("added", topics.length, "stickies");`;

const EXAMPLES: Example[] = [
  { icon: <GitFork size={15} />, title: tk("Mind map from headings"), desc: tk("Each ## heading becomes a branch"), code: `// Paste headings; each ## becomes a branch around the # root.
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
  { icon: <StickyNote size={15} />, title: tk("Stickies from list"), desc: tk("One sticky per bullet, colours cycled"), code: `// One sticky per bullet, wrapped in a frame.
const list = \`- Read chapter 3
- Redo exercise 2.4
- Flashcards: eigenvalues
- Ask about SVD in forum
- Past paper 2023\`;
const items = list.split("\\n").map((l) => l.replace(/^[-*]\\s*/, "").trim()).filter(Boolean);
board.add(items.map((t, i) => ({ ...sk.sticky((i % 3) * 230, Math.floor(i / 3) * 190, t, i), id: "s" + i })));
board.add([sk.frame(items.map((_, i) => "s" + i), "This week")]);
log("stickies:", items.length);` },
  { icon: <Workflow size={15} />, title: tk("Flowchart from Mermaid"), desc: tk("Turns a mermaid block into shapes"), code: `await board.fromMermaid(\`flowchart TD
  A[Lecture] --> B[Notes]
  B --> C{Clear?}
  C -->|yes| D([Flashcards])
  C -->|no| E[Ask in forum]
  E --> B\`);
log("flowchart added");` },
];

const MMD_DEFAULT = "flowchart TD\n  A[Lecture] --> B[Notes]\n  B --> C{Clear?}\n  C -->|yes| D([Flashcards])\n  C -->|no| E[Ask in forum]\n  E --> B";

/** Excalidraw's own chrome is off: Lumen's toolbar, property bar, menus and clusters drive it through the API. */
const UI_OPTIONS = { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, clearCanvas: false, changeViewBackgroundColor: false, toggleTheme: false }, tools: { image: false } } as const;

// Board background = theme bg with the design's dot pattern (WBStudio: radial dots 1.2 px every 22 px, muted 16%).
const WB_CSS = `
.lumen-wb { background-color: var(--bg); background-image: radial-gradient(color-mix(in srgb,var(--muted) 16%,transparent) 1.2px, transparent 1.4px); background-size: 22px 22px; }
.lumen-wb .excalidraw, .lumen-wb .excalidraw.theme--dark {
  --island-bg-color: var(--surface); --default-border-color: var(--border); --button-hover-bg: var(--surface-2);
  --color-surface-primary: var(--surface); --color-surface-low: var(--surface-2); --color-surface-mid: var(--surface-2); --color-surface-high: var(--surface-2); --color-surface-lowest: var(--bg);
  --color-primary: var(--accent); --color-primary-darker: var(--accent); --color-primary-darkest: var(--accent); --color-primary-hover: var(--accent);
  --color-primary-light: color-mix(in srgb,var(--accent) 18%,transparent); --color-primary-light-darker: color-mix(in srgb,var(--accent) 26%,transparent);
  --color-on-primary-container: var(--accent); --color-surface-primary-container: color-mix(in srgb,var(--accent) 18%,transparent); --color-brand-hover: var(--accent); --color-brand-active: var(--accent);
  --text-primary-color: var(--text); --icon-fill-color: var(--text); --ui-font: Inter, system-ui, sans-serif;
}
.lumen-wb .excalidraw:focus, .lumen-wb .excalidraw:focus-visible, .lumen-wb .excalidraw .excalidraw-container:focus-visible { outline: none; }
.lumen-wb .excalidraw .Island { border: 1px solid var(--border); box-shadow: none; }
/* One Lumen toolbar + property bar: Excalidraw's tool island, style panel, footer, menus, hints and mobile bars stay hidden. */
.lumen-wb .excalidraw .App-menu_top, .lumen-wb .excalidraw .App-menu__left, .lumen-wb .excalidraw .layer-ui__wrapper__footer-left, .lumen-wb .excalidraw .layer-ui__wrapper__footer-right,
.lumen-wb .excalidraw .layer-ui__wrapper__footer-center, .lumen-wb .excalidraw .footer-center, .lumen-wb .excalidraw .default-sidebar-trigger, .lumen-wb .excalidraw .HintViewer, .lumen-wb .excalidraw .help-icon,
.lumen-wb .excalidraw .main-menu-trigger, .lumen-wb .excalidraw .App-bottom-bar, .lumen-wb .excalidraw .App-toolbar--mobile, .lumen-wb .excalidraw .mobile-misc-tools-container, .lumen-wb .excalidraw .App-top-bar,
.lumen-wb .excalidraw .disable-zen-mode, .lumen-wb .excalidraw .scroll-back-to-content { display: none !important; }
/* Dark theme: flip only the dark inks (black strokes/text turn light) and keep paper colours as paper, so stickies read the same in both themes. */
.lumen-wb .excalidraw.theme--dark { --theme-filter: url(#lumen-wb-ink); }
/* Pen speed: the SVG ink filter is costly per repaint. Only the static layer (finished drawing, repainted per stroke) keeps it;
   the stroke-in-progress and pointer/selection layers repaint on every move, so they use the GPU CSS filter instead. */
.lumen-wb .excalidraw.theme--dark canvas:not(.static) { filter: invert(93%) hue-rotate(180deg); }
/* Performance mode (over ~3,000 elements): the static layer switches to the GPU filter too, and floating chrome drops its shadows. */
.lumen-wb.wb-perf .excalidraw.theme--dark { --theme-filter: invert(93%) hue-rotate(180deg); }
.wb-perf-root [data-wb-chrome] { box-shadow: none !important; }
`;

/** Space › folder crumb for the header (narrow vault subscription so the board doesn't re-render on vault changes). */
function useCrumb(note: Note) {
  return useVaultSelector((v) => {
    const sp = v.spaceMap.get(note.spaceId)?.name ?? t("Inbox");
    const f = note.folderId ? v.folderMap.get(note.folderId)?.name : undefined;
    return f ? `${sp} / ${f}` : sp;
  });
}

const STYLE_KEYS: Record<string, string> = { strokeColor: "currentItemStrokeColor", backgroundColor: "currentItemBackgroundColor", fillStyle: "currentItemFillStyle", strokeWidth: "currentItemStrokeWidth", strokeStyle: "currentItemStrokeStyle", roughness: "currentItemRoughness", roundness: "currentItemRoundness", fontFamily: "currentItemFontFamily", fontSize: "currentItemFontSize", textAlign: "currentItemTextAlign", opacity: "currentItemOpacity", startArrowhead: "currentItemStartArrowhead", endArrowhead: "currentItemEndArrowhead", arrowType: "currentItemArrowType" };
const EMPTY_STYLE: Style = { strokeColor: null, backgroundColor: null, fillStyle: null, strokeWidth: null, strokeStyle: null, roughness: null, roundness: null, fontFamily: null, fontSize: null, textAlign: null, opacity: null, startArrowhead: null, endArrowhead: null, arrowType: null, link: null, locked: false };
/** One value if every element agrees, else null ("mixed"). */
const same = <T,>(xs: T[]): T | null => (xs.length && xs.every((x) => x === xs[0]) ? xs[0] : null);
type BarState = { mode: BarMode; style: Style; pos: { x: number; y: number } | null; ids: string[] };

function Whiteboard({ note }: { note: Note; /** Routing hook (round 7): NoteView passes the note type; the editor also derives it from note.type. */ kind?: "whiteboard" | "board" }) {
  const settings = useSettings();
  const ui = useUI();
  const rtl = useRtl();
  const dark = useMemo(() => activeTheme().dark, [settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const initial = useMemo(() => parseScene(note.body), []); // eslint-disable-line react-hooks/exhaustive-deps
  const kind: "whiteboard" | "board" = (note.type as string) === "board" ? "board" : "whiteboard";
  const api = useRef<API | null>(null);
  const [apiReady, setApiReady] = useState<API | null>(null);
  const lastSaved = useRef(note.body);
  const lastVersion = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [panel, setPanel] = useState<CodeTab | null>(null);
  const [mermaidOpen, setMermaidOpen] = useState(false);
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [src, setSrc] = useState(() => { try { return localStorage.getItem("lumen.wbScript") ?? SCRIPT_EXAMPLE; } catch { return SCRIPT_EXAMPLE; } });
  const [logs, setLogs] = useState<string[]>([]);
  const [bar, setBar] = useState<BarState | null>(null);
  const [tool, setTool] = useState<ToolId>("select");
  const [shape, setShape] = useState<ShapeKind>(() => (localStorage.getItem("lumen.wbShape") as ShapeKind) || "rectangle");
  const [line, setLine] = useState<LineKind>("arrow");
  const [arrowType, setArrowType] = useState<ArrowType>("round");
  const [locked, setLocked] = useState(false);
  const [penInk, setPenInk] = useState<Ink>(() => loadInk("pen"));
  const [hlInk, setHlInk] = useState<Ink>(() => loadInk("hl"));
  const hlMode = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [tick, setTick] = useState(0);
  const [count, setCount] = useState(-1);
  const [frameCount, setFrameCount] = useState(0);
  const [zen, setZen] = useState(false);
  const [penMode, setPenMode] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const histOp = useRef(false);
  const [menu, setMenu] = useState(false);
  const [wheel, setWheel] = useState<{ x: number; y: number; slots: WheelSlot[] } | null>(null);
  const [dockMore, setDockMore] = useState(false);
  const [picker, setPicker] = useState(false);
  const [share, setShare] = useState(false);
  const [open, setOpen] = useState<WbPanel | null>(null);
  const [minimap, setMinimap] = useState(() => localStorage.getItem("lumen.wbMinimap") === "1");
  const [perfOff, setPerfOff] = useState(false);
  const [phone, setPhone] = useState(() => matchMedia("(max-width: 767px)").matches);
  const [, setReg] = useState(0);
  const barKey = useRef("");
  const pendingDone = useRef(false);
  const [cursor, setCursor] = useState<{ line: number; col: number } | null>({ line: 1, col: 1 });
  const ed = useRef<CodeEditorHandle | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  /** fileId → small ref entry ({ id, mimeType, created, lumenAtt }) for images already stored as attachments. */
  const refs = useRef(new Map<string, SceneFile>(Object.values((initial.scene.files ?? {}) as Record<string, SceneFile>).filter((f) => f?.lumenAtt).map((f) => [f.id, { id: f.id, mimeType: f.mimeType, created: f.created, lumenAtt: f.lumenAtt }])));
  const storing = useRef(new Set<string>());
  const embeds = useMemo(() => embedProps(resolveAtt), []);
  const crumb = useCrumb(note);
  const saved = useSavedLine();

  useEffect(() => onRegistry(() => setReg((n) => n + 1)), []);
  useEffect(() => { const m = matchMedia("(max-width: 767px)"); const f = () => setPhone(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  // A conversion ("Mermaid block → Whiteboard" with no block found) asks to open the Mermaid dialog.
  useEffect(() => {
    try { if (sessionStorage.getItem("lumen.wbMermaid.open") === note.id) { sessionStorage.removeItem("lumen.wbMermaid.open"); setMermaidOpen(true); } } catch { /* ignore */ }
  }, [note.id]);

  const ctx: WbCtx = { api: apiReady, noteId: note.id, kind, close: () => setOpen(null), save: () => scheduleSave(100) };
  const openPanel = (p: WbPanel) => {
    setMenu(false);
    if (wbRegistry.panels[p]) setOpen(p);
    else toast(t("{name} isn't available on this board yet", { name: t(({ settings: "Board settings", layers: "Layers", frames: "Frames", present: "Present", convert: "Convert to…", handwriting: "Handwriting search", library: "Library", pens: "Pens", palette: "Palette" } as Record<WbPanel, string>)[p]) }));
  };

  // ------------------------------------------------------------------ selection / tool → property bar
  const styleOf = (sel: El[], els: readonly El[], st: Record<string, unknown>): Style => {
    if (!sel.length) {
      const g = (k: string) => st[STYLE_KEYS[k]] as never;
      const r = g("roundness") as unknown as string;
      return { ...EMPTY_STYLE, strokeColor: g("strokeColor"), backgroundColor: g("backgroundColor"), fillStyle: g("fillStyle"), strokeWidth: g("strokeWidth"), strokeStyle: g("strokeStyle"), roughness: g("roughness"), roundness: r === "sharp" ? "sharp" : "round", fontFamily: g("fontFamily"), fontSize: g("fontSize"), textAlign: g("textAlign"), opacity: g("opacity"), startArrowhead: g("startArrowhead"), endArrowhead: g("endArrowhead"), arrowType: g("arrowType") };
    }
    const ids = new Set(sel.map((e) => e.id));
    const texts = els.filter((e) => e.type === "text" && !e.isDeleted && (ids.has(e.id) || (!!e.containerId && ids.has(e.containerId))));
    const shapes = sel.filter((e) => e.type !== "text");
    const base = shapes.length ? shapes : sel;
    const v = <K extends string>(xs: El[], k: K) => same(xs.map((e) => e[k] as never));
    return {
      strokeColor: v(base, "strokeColor"), backgroundColor: v(base, "backgroundColor"), fillStyle: v(base, "fillStyle"), strokeWidth: v(base, "strokeWidth"), strokeStyle: v(base, "strokeStyle"), roughness: v(base, "roughness"),
      roundness: same(base.map((e) => (e.roundness ? "round" : "sharp"))) as "round" | "sharp" | null,
      fontFamily: v(texts, "fontFamily"), fontSize: v(texts, "fontSize"), textAlign: v(texts, "textAlign"), opacity: v(sel, "opacity"),
      startArrowhead: v(base, "startArrowhead"), endArrowhead: v(base, "endArrowhead"), arrowType: same(base.map((e) => (e.elbowed ? "elbow" : e.roundness ? "round" : "sharp"))),
      link: v(sel, "link"), locked: sel.every((e) => !!e.locked),
    };
  };
  const track = (els: readonly El[], st: Record<string, unknown>) => {
    const at = st.activeTool as { type: string; locked?: boolean } | undefined;
    const lt = lumenTool(at?.type ?? "selection", hlMode.current);
    if (lt !== tool) setTool(lt);
    if (!!at?.locked !== locked) setLocked(!!at?.locked);
    if (!!st.zenModeEnabled !== zen) setZen(!!st.zenModeEnabled);
    if (!!st.penMode !== penMode) setPenMode(!!st.penMode);
    const z = (st.zoom as { value: number }).value;
    if (z !== zoom) setZoom(z);
    // Drawing (pen, shapes): skip the per-move work so strokes stay smooth; only the docked tool bar shows.
    const drawing = st.cursorButton === "down" || !!st.newElement || !!st.multiElement || !!st.selectedElementsAreBeingDragged || !!st.resizingElement || !!st.editingTextElement;
    if (drawing) { if (barKey.current && !barKey.current.startsWith("tool")) { barKey.current = ""; setBar(null); } return; }
    if (at && at.type === "freedraw") {
      // remember the ink the user set (pen and highlighter keep their own)
      const ink: Ink = { color: String(st.currentItemStrokeColor), width: Number(st.currentItemStrokeWidth), opacity: Number(st.currentItemOpacity) };
      const cur = hlMode.current ? hlInk : penInk;
      if (ink.color !== cur.color || ink.width !== cur.width || ink.opacity !== cur.opacity) { if (hlMode.current) { setHlInk(ink); saveInk("hl", ink); } else { setPenInk(ink); saveInk("pen", ink); } }
    }
    const selMap = (st.selectedElementIds as Record<string, boolean>) ?? {};
    const selIds = Object.keys(selMap);
    const sel = selIds.length ? (els.filter((e) => selMap[e.id] && !e.isDeleted) as El[]) : [];
    let b: BarState | null = null;
    if (sel.length && at?.type === "selection") {
      const all = (f: (e: El) => boolean) => sel.every(f);
      const mode: BarMode = all((e) => e.type === "freedraw") ? "ink" : all((e) => isSticky(e) || (e.type === "text" && !!e.containerId)) ? "sticky" : all((e) => e.type === "text") ? "text"
        : all((e) => e.type === "arrow" || e.type === "line") ? "line" : all((e) => ["image", "embeddable", "iframe", "frame", "magicframe"].includes(e.type)) ? "media" : "shape";
      const sx = st.scrollX as number, sy = st.scrollY as number;
      const minX = Math.min(...sel.map((e) => Math.min(e.x, e.x + e.width))), minY = Math.min(...sel.map((e) => Math.min(e.y, e.y + e.height)));
      const maxY = Math.max(...sel.map((e) => Math.max(e.y, e.y + e.height)));
      const top = (minY + sy) * z - 24 - 38; // 24 px above the selection
      const W = host.current?.clientWidth ?? 1200;
      b = { mode, style: styleOf(sel, els as El[], st), ids: sel.map((e) => e.id), pos: { x: Math.min(Math.max(10, (minX + sx) * z), W - 480), y: top < 60 ? (maxY + sy) * z + 24 : top } };
    } else if (!sel.length && at && ["freedraw", "rectangle", "ellipse", "diamond", "arrow", "line", "text"].includes(at.type)) {
      const mode: BarMode = at.type === "freedraw" ? "tool-ink" : at.type === "text" ? "tool-text" : at.type === "arrow" || at.type === "line" ? "tool-line" : "tool-shape";
      b = { mode, style: styleOf([], els as El[], st), ids: [], pos: null };
    }
    const k = b ? (b.pos ? "sel" : "tool") + JSON.stringify(b) : "";
    if (k !== barKey.current) { barKey.current = k; setBar(b); }
  };

  /** Rewrite the selected elements (and their bound text), re-measuring text so sizes/fonts stay laid out. */
  const restyle = (ids: string[], fn: (e: El, selected: boolean) => El | null) => {
    const a = api.current;
    if (!a) return;
    const set = new Set(ids);
    const els = a.getSceneElementsIncludingDeleted() as El[];
    const next = els.map((e) => {
      const selected = set.has(e.id);
      if (!selected && !(e.containerId && set.has(e.containerId))) return e;
      const r = fn({ ...e }, selected);
      return r ? { ...r, version: ((e.version as number) ?? 1) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() } : e;
    });
    a.updateScene({ elements: restoreElements(next as never, null, { refreshDimensions: true, repairBindings: true }) });
  };
  /** Property bar → elements (selection) and Excalidraw's current-item style (so the next element matches). */
  const setStyle = (p: Partial<Style>) => {
    const a = api.current;
    if (!a) return;
    const app: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) if (STYLE_KEYS[k] && v != null) app[STYLE_KEYS[k]] = v;
    if (Object.keys(app).length) a.updateScene({ appState: app });
    if (!bar || !bar.ids.length) { barKey.current = ""; track(a.getSceneElements() as El[], a.getAppState()); return; }
    restyle(bar.ids, (e, selected) => {
      const isText = e.type === "text", isLine = e.type === "arrow" || e.type === "line";
      const out: El = { ...e };
      if (p.strokeColor != null && (selected || !isText)) { if (!(isText && e.containerId && PAPER.includes(String((a.getSceneElements() as El[]).find((x) => x.id === e.containerId)?.backgroundColor).toLowerCase()))) out.strokeColor = p.strokeColor; }
      if (p.backgroundColor != null && !isText && !isLine && e.type !== "freedraw") { out.backgroundColor = p.backgroundColor; if (isSticky(e)) out.strokeColor = "transparent"; if (p.backgroundColor !== "transparent" && !p.fillStyle && isSticky({ ...e, backgroundColor: p.backgroundColor } as El)) out.fillStyle = "solid"; }
      if (p.fillStyle != null && !isText && !isLine) out.fillStyle = p.fillStyle;
      if (p.strokeWidth != null && !isText) out.strokeWidth = p.strokeWidth;
      if (p.strokeStyle != null && !isText) out.strokeStyle = p.strokeStyle;
      if (p.roughness != null && !isText) out.roughness = p.roughness;
      if (p.roundness != null && !isText && e.type !== "freedraw") out.roundness = p.roundness === "sharp" ? null : { type: isLine ? 2 : 3 };
      if (p.opacity != null && (selected || isText)) out.opacity = p.opacity;
      if (isText && p.fontFamily != null) out.fontFamily = p.fontFamily;
      if (isText && p.fontSize != null) out.fontSize = p.fontSize;
      if (isText && p.textAlign != null) out.textAlign = p.textAlign;
      if (e.type === "arrow" && p.startArrowhead != null) out.startArrowhead = p.startArrowhead === "none" ? null : p.startArrowhead;
      if (e.type === "arrow" && p.endArrowhead != null) out.endArrowhead = p.endArrowhead === "none" ? null : p.endArrowhead;
      if (e.type === "arrow" && p.arrowType != null) { out.elbowed = p.arrowType === "elbow"; out.roundness = p.arrowType === "round" ? { type: 2 } : null; }
      if ("link" in p && selected) out.link = p.link ?? null;
      return out;
    });
  };
  const key = (k: string, o: { shift?: boolean; ctrl?: boolean; code?: string } = {}) => host.current?.querySelector(".excalidraw")?.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: o.code ?? (k.length === 1 ? "Key" + k.toUpperCase() : k), ctrlKey: o.ctrl ?? true, metaKey: o.ctrl ?? true, shiftKey: !!o.shift, bubbles: true }));
  const undo = () => { histOp.current = true; key("z"); setCanRedo(true); };
  const redo = () => { histOp.current = true; key("z", { shift: true }); };
  const action = (x: Action) => {
    const a = api.current;
    if (!a || !bar) return;
    const K: Partial<Record<Action, () => void>> = {
      front: () => key("]", { shift: true, code: "BracketRight" }), forward: () => key("]", { code: "BracketRight" }), backward: () => key("[", { code: "BracketLeft" }), back: () => key("[", { shift: true, code: "BracketLeft" }),
      group: () => key("g"), ungroup: () => key("g", { shift: true }), duplicate: () => key("d"), lock: () => key("l", { shift: true }), delete: () => key("Delete", { ctrl: false, code: "Delete" }),
      "align-left": () => key("ArrowLeft", { shift: true, code: "ArrowLeft" }), "align-right": () => key("ArrowRight", { shift: true, code: "ArrowRight" }), "align-top": () => key("ArrowUp", { shift: true, code: "ArrowUp" }), "align-bottom": () => key("ArrowDown", { shift: true, code: "ArrowDown" }),
    };
    if (K[x]) return K[x]!();
    // centre / middle (no Excalidraw shortcut): move each selected element onto the selection's centre line
    const els = a.getSceneElements() as El[], ids = new Set(bar.ids), sel = els.filter((e) => ids.has(e.id));
    const minX = Math.min(...sel.map((e) => e.x)), maxX = Math.max(...sel.map((e) => e.x + e.width)), minY = Math.min(...sel.map((e) => e.y)), maxY = Math.max(...sel.map((e) => e.y + e.height));
    const dx = (e: El) => (x === "align-center" ? (minX + maxX) / 2 - (e.x + e.width / 2) : 0), dy = (e: El) => (x === "align-middle" ? (minY + maxY) / 2 - (e.y + e.height / 2) : 0);
    const byId = new Map(sel.map((e) => [e.id, e]));
    restyle(bar.ids, (e) => { const o = byId.get(e.id) ?? (e.containerId ? byId.get(e.containerId) : undefined); return o ? { ...e, x: e.x + dx(o), y: e.y + dy(o) } : null; });
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
  /** Note card: the note's title in a card linked to it (opens in Lumen); goes to the centre of the view. */
  const addNoteCard = (n: Note) => {
    const a = api.current;
    if (!a) return;
    const st = a.getAppState() as Record<string, number> & { zoom: { value: number } };
    const z = st.zoom.value, w = host.current?.clientWidth ?? 400, h = host.current?.clientHeight ?? 600;
    const id = rid();
    const els = convertToExcalidrawElements([{ ...noteCardSkeleton(n, w / 2 / z - st.scrollX - 130, h / 2.4 / z - st.scrollY - 50), id }] as never, { regenerateIds: false });
    a.updateScene({ elements: [...a.getSceneElementsIncludingDeleted(), ...els], appState: { selectedElementIds: { [id]: true } } });
    a.setActiveTool({ type: "selection" });
    setPicker(false);
  };

  // ------------------------------------------------------------------ tools
  const applyInk = (ink: Ink) => api.current?.updateScene({ appState: { currentItemStrokeColor: ink.color, currentItemStrokeWidth: ink.width, currentItemOpacity: ink.opacity } });
  const activate = (id: ToolId, o: { shape?: ShapeKind; line?: LineKind; arrow?: ArrowType } = {}) => {
    const a = api.current;
    if (!a) return;
    setDockMore(false);
    const wasHl = hlMode.current;
    if (wasHl && id !== "hl") { hlMode.current = false; applyInk(penInk); }
    const set = (type: string) => a.setActiveTool({ type, locked });
    switch (id) {
      case "select": set("selection"); break;
      case "lasso": if (wbRegistry.lasso) wbRegistry.lasso(ctx); else { set("selection"); toast(t("Lasso: drag a box to select for now; free-form lasso comes with the pens update")); } break;
      case "pen": hlMode.current = false; applyInk(penInk); set("freedraw"); setTool("pen"); break;
      case "hl": hlMode.current = true; applyInk(hlInk); set("freedraw"); setTool("hl"); break;
      case "shape": { const s = o.shape ?? shape; setShape(s); try { localStorage.setItem("lumen.wbShape", s); } catch { /* ignore */ } set(s); break; }
      case "arrow": { const l = o.line ?? line; setLine(l); if (o.arrow) { setArrowType(o.arrow); a.updateScene({ appState: { currentItemArrowType: o.arrow } }); } set(l); break; }
      case "sticky": addSticky(); break;
      case "image": pickImage(); break;
      case "media": pickMedia(); break;
      case "web": set("embeddable"); break;
      case "note": setPicker(true); break;
      default: set(id);
    }
    pushRecent({ tool: id, shape: id === "shape" ? (o.shape ?? shape) : undefined });
  };
  const toggleLock = () => { const a = api.current; if (!a) return; const at = a.getAppState().activeTool as { type: string }; a.setActiveTool({ type: at.type === "custom" ? "selection" : at.type, locked: !locked }); setLocked(!locked); };

  const initialData = useMemo(() => {
    const r = restore({ elements: initial.scene.elements as never, appState: initial.scene.appState as never, files: initial.scene.files as never }, null, null);
    // Ref-only files (bytes in attachments) load after the editor is up; Excalidraw shows a placeholder meanwhile.
    const files = Object.fromEntries(Object.entries((r.files ?? {}) as Record<string, SceneFile>).filter(([, f]) => !!f?.dataURL));
    return { elements: r.elements, appState: { ...r.appState, viewBackgroundColor: "transparent", collaborators: new Map() }, files, scrollToContent: true };
  }, [initial]);

  /** Load attachment bytes for ref-only files into the editor. */
  const hydrate = async (files: Record<string, SceneFile> | undefined) => {
    for (const f of Object.values(files ?? {})) if (f?.lumenAtt) refs.current.set(f.id, { id: f.id, mimeType: f.mimeType, created: f.created, lumenAtt: f.lumenAtt });
    const loaded = (api.current?.getFiles() ?? {}) as Record<string, SceneFile>;
    const todo = Object.fromEntries(Object.entries(files ?? {}).filter(([id, f]) => f?.lumenAtt && !f.dataURL && !loaded[id]?.dataURL));
    const full = await hydrateFiles(todo, attBlob);
    if (full.length) api.current?.addFiles(full);
  };
  /** New image (dataURL from Excalidraw's own insert) → attachment; the next save writes only the ref. */
  const storeFile = (fid: string, f: SceneFile) => {
    if (storing.current.has(fid) || !f.dataURL) return;
    storing.current.add(fid);
    void (async () => {
      try {
        const blob = await dataURLToBlob(f.dataURL!);
        // Excalidraw already resized it to 1440 px; only re-encode when it is still heavy (big PNG screenshots).
        const { id } = await storeBlob(blob, `whiteboard-image.${(f.mimeType.split("/")[1] ?? "png").replace("+xml", "")}`, { shrink: blob.size > 1_500_000 });
        refs.current.set(fid, { id: fid, mimeType: f.mimeType, created: f.created ?? Date.now(), lumenAtt: id });
        clearTimeout(timer.current);
        scheduleSave(150);
      } catch (e) { toast((e as Error).message); } finally { storing.current.delete(fid); }
    })();
  };

  /** Board JSON as stored: images are small refs to attachments, never inline bytes (that made every autosave heavy). */
  const serialize = () => {
    const a = api.current!;
    const els = a.getSceneElements() as readonly El[];
    const s = JSON.parse(serializeAsJSON(els as never, a.getAppState() as never, {} as never, "local")) as Scene;
    const loaded = a.getFiles() as Record<string, SceneFile>;
    const prev = (initial.scene.files ?? {}) as Record<string, SceneFile>;
    const files: Record<string, SceneFile> = {};
    for (const e of els) {
      const fid = e.fileId as string | undefined;
      if (e.type !== "image" || !fid || files[fid]) continue;
      const ref = refs.current.get(fid);
      if (ref) files[fid] = ref;
      // Not stored yet: start storing; save() waits for it, so the big dataURL never lands in the note, History or sync.
      else if (loaded[fid]?.dataURL) { files[fid] = { id: fid, mimeType: loaded[fid].mimeType, created: loaded[fid].created }; storeFile(fid, loaded[fid]); }
      else if (prev[fid]) files[fid] = prev[fid];
    }
    s.files = files;
    s.source = "lumen";
    return JSON.stringify(s);
  };
  /** Full .excalidraw (dataURLs inlined) for downloads, so the file opens anywhere. */
  const serializeFull = () => inlineSceneFiles(serialize(), attBlob);

  /** GIF / video / audio file → attachment + embeddable element (plays on the board). Returns false for other files. */
  const addMedia = async (file: File, at?: { clientX: number; clientY: number }, i = 0) => {
    const mk = mediaKindOf(file.type);
    const a = api.current;
    if (!mk || !a) return false;
    try {
      const { id } = await storeBlob(file, file.name || mk);
      const { w, h } = await mediaSize(file, mk);
      const st = a.getAppState() as Record<string, number> & { zoom: { value: number } };
      const z = st.zoom.value, r = host.current?.getBoundingClientRect();
      const vx = at && r ? at.clientX - r.left : (r?.width ?? 800) / 2, vy = at && r ? at.clientY - r.top : (r?.height ?? 600) / 2.4;
      const el = mediaElement({ x: vx / z - st.scrollX - w / 2 + i * 24, y: vy / z - st.scrollY - h / 2 + i * 24, w, h, kind: mk, attId: id, link: new URL(attUrl(id), location.href).href });
      a.updateScene({ elements: [...a.getSceneElementsIncludingDeleted(), ...restoreElements([el] as never, null)], appState: { selectedElementIds: { [el.id]: true } } });
      a.setActiveTool({ type: "selection" });
    } catch (e) { toast((e as Error).message); }
    return true;
  };
  /** Photo → shrunk off the main thread → attachment → image element. Skips Excalidraw's main-thread resize (the lag). */
  const addImage = async (file: File, at?: { clientX: number; clientY: number }, i = 0) => {
    const a = api.current;
    if (!a) return;
    try {
      const { blob, w, h } = await shrinkImage(file);
      const { id } = await storeBlob(blob, file.name || "image", { shrink: false });
      const mimeType = blob.type || file.type;
      const ref: SceneFile = { id, mimeType, created: Date.now(), lumenAtt: id };
      refs.current.set(id, ref);
      a.addFiles([{ ...ref, dataURL: await blobToDataURL(blob) }]);
      const st = a.getAppState() as Record<string, number> & { zoom: { value: number } };
      const z = st.zoom.value, r = host.current?.getBoundingClientRect();
      const k = Math.min(1, 560 / Math.max(w, h)), dw = Math.round(w * k), dh = Math.round(h * k);
      const vx = at && r ? at.clientX - r.left : (r?.width ?? 800) / 2, vy = at && r ? at.clientY - r.top : (r?.height ?? 600) / 2.4;
      const els = convertToExcalidrawElements([{ type: "image", fileId: id, status: "saved", x: vx / z - st.scrollX - dw / 2 + i * 24, y: vy / z - st.scrollY - dh / 2 + i * 24, width: dw, height: dh }] as never) as unknown as El[];
      a.updateScene({ elements: [...a.getSceneElementsIncludingDeleted(), ...els], appState: { selectedElementIds: Object.fromEntries(els.map((e) => [e.id, true])) } });
      a.setActiveTool({ type: "selection" });
      scheduleSave(200);
    } catch (e) { toast((e as Error).message); }
  };
  /** Any file Lumen inserts itself: photos (fast path) or GIF / video / audio (playable embeds). */
  const ours = (f: File) => isPhoto(f.type) || !!mediaKindOf(f.type);
  const addFile = (f: File, at?: { clientX: number; clientY: number }, i = 0) => void (isPhoto(f.type) ? addImage(f, at, i) : addMedia(f, at, i));
  const pick = (accept: string) => { const el = mediaInput.current; if (!el) return; el.accept = accept; el.click(); };
  const pickMedia = () => pick("image/gif,image/apng,video/*,audio/*");
  const pickImage = () => pick("image/*");
  /** Empty state "Paste an image": the clipboard image if the browser allows reading it, else the file picker. */
  const pasteImage = async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((x) => x.startsWith("image/"));
        if (type) { const b = await item.getType(type); return addImage(new File([b], "pasted." + type.split("/")[1], { type })); }
      }
      toast(t("No image on the clipboard. Pick a file instead."));
    } catch { /* permission denied or unsupported */ }
    pickImage();
  };
  /** Debounced autosave that never runs mid-stroke (pen down, shape being drawn, drag) and yields to the browser when idle. */
  const scheduleSave = (ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const st = api.current?.getAppState();
      if (st && (st.cursorButton === "down" || st.newElement || st.multiElement || st.selectedElementsAreBeingDragged || st.resizingElement)) return scheduleSave(400);
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) ric(() => save(), { timeout: 1500 }); else save();
    }, ms);
  };
  const save = (keepTime = false) => {
    if (!api.current) return;
    const s = serialize();
    if (storing.current.size) return; // an image is still moving into attachments; storeFile saves again when it's done
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
    toast(t("Added {n} elements from the API", { n: pending.length }));
  };

  // External change (sync / REST / another device).
  useEffect(() => {
    if (!api.current || note.body === lastSaved.current) return;
    const { scene, error } = parseScene(note.body);
    if (error) return;
    lastSaved.current = note.body;
    const r = restore({ elements: scene.elements as never }, null, null);
    api.current.updateScene({ elements: r.elements });
    void hydrate(scene.files as Record<string, SceneFile>);
    applyPending(scene);
  }, [note.body]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { clearTimeout(timer.current); }, []);

  // Keyboard: the design's tool keys (1 select · 2 lasso · 3 pen · 4 highlighter · 5 eraser · 6 shapes · 7 arrow · 8 text ·
  // 9 sticky · 0 image · N note card · F frame · H hand · K laser), L layers, ⌥P present, ⇧⌘E export. Key 0 / image go to the
  // fast off-main-thread photo insert, never Excalidraw's slow resize.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    const typing = (x: EventTarget | null) => x instanceof HTMLElement && !!x.closest("input,textarea,select,[contenteditable=true],.cm-editor");
    if (!host.current?.isConnected || typing(e.target) || !e.isTrusted) return;
    if (api.current?.getAppState().editingTextElement) return;
    const k = e.key.toLowerCase();
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === "e") { stop(); doExport(); return; }
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === "KeyP")) { stop(); openPanel("present"); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === "l" && !e.shiftKey && wbRegistry.panels.layers) { stop(); openPanel("layers"); return; }
    const id = KEY_TOOL[k];
    if (id && !e.shiftKey) { stop(); activate(id); }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    // Excalidraw's own image button (if it ever shows) goes to the fast path too.
    const onClick = (e: Event) => {
      const btn = (e.target as HTMLElement | null)?.closest?.('[data-testid="toolbar-image"]');
      if (!btn || !host.current?.contains(btn)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === "click") pickImageRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onClick, true);
    window.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("pointerdown", onClick, true); window.removeEventListener("click", onClick, true); };
  }, []);
  const pickImageRef = useRef(pickImage);
  pickImageRef.current = pickImage;

  // ------------------------------------------------------------------ tool wheel: right-click on empty board, long-press on touch
  const hitTest = (clientX: number, clientY: number) => {
    const a = api.current, r = host.current?.getBoundingClientRect();
    if (!a || !r) return false;
    const st = a.getAppState() as { zoom: { value: number }; scrollX: number; scrollY: number };
    const x = (clientX - r.left) / st.zoom.value - st.scrollX, y = (clientY - r.top) / st.zoom.value - st.scrollY;
    return (a.getSceneElements() as El[]).some((e) => e.type !== "frame" && !e.isDeleted && x >= Math.min(e.x, e.x + e.width) - 6 && x <= Math.max(e.x, e.x + e.width) + 6 && y >= Math.min(e.y, e.y + e.height) - 6 && y <= Math.max(e.y, e.y + e.height) + 6);
  };
  const openWheel = (x: number, y: number) => setWheel({ x, y, slots: loadRecent() });
  const press = useRef<{ t: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch" || !(e.target as HTMLElement).closest("canvas")) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (press.current) { clearTimeout(press.current.t); press.current = null; }
    // In pen mode one finger pans, so the wheel needs two fingers held still.
    const need = api.current?.getAppState().penMode ? 2 : 1;
    if (touches.current.size !== need) return;
    const pts = [...touches.current.values()], cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    press.current = { x: cx, y: cy, t: setTimeout(() => { press.current = null; openWheel(cx, cy); }, 550) };
  };
  const onPointerMoveCapture = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    const p0 = touches.current.get(e.pointerId);
    if (p0 && press.current && Math.hypot(e.clientX - p0.x, e.clientY - p0.y) > 10) { clearTimeout(press.current.t); press.current = null; }
  };
  const onPointerUpCapture = (e: React.PointerEvent) => { touches.current.delete(e.pointerId); if (press.current) { clearTimeout(press.current.t); press.current = null; } };
  const pickSlot = (s: WheelSlot) => { setWheel(null); activate(s.tool, { shape: s.shape }); };

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
      setLogs([...out, `${LOG_OK} ${t("done · {ms} ms · restore from History", { ms: Math.round(performance.now() - t0) })}`]);
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

  /** Export: the shared export dialog (format, scale, background, padding…) with the board as an SVG source. */
  function doExport() {
    const a = api.current;
    if (!a) return;
    openExport({
      name: note.title, title: t("Export whiteboard"), themable: true,
      build: async (p) => {
        const bgKind = p.background, darkOut = p.theme === "dark" || (p.theme === "app" && dark);
        const svg = await exportToSvg({ elements: a.getSceneElements() as never, files: a.getFiles() as never, exportPadding: p.padding,
          appState: { ...a.getAppState(), exportBackground: bgKind !== "transparent", viewBackgroundColor: bgKind === "custom" ? p.color : darkOut ? "#0F1115" : "#ffffff", exportWithDarkMode: darkOut, exportEmbedScene: false } as never });
        return { svg: new XMLSerializer().serializeToString(svg), width: Number(svg.getAttribute("width")) || 800, height: Number(svg.getAttribute("height")) || 600 };
      },
    });
  }
  const downloadExcalidraw = async () => download(`${note.title}.excalidraw`, await serializeFull(), "application/json");

  const openTab = (tb: CodeTab) => {
    if (tb === "json") { setCode(JSON.stringify(JSON.parse(serialize()), null, 2)); setCodeErr(null); }
    setPanel(tb);
  };
  const applyCode = () => {
    const { scene, error } = parseScene(code);
    if (error) return setCodeErr(error);
    const r = restore({ elements: scene.elements as never }, null, null);
    api.current?.updateScene({ elements: r.elements });
    setTimeout(save, 50);
    setCodeErr(null);
    toast(t("Applied to the board"));
  };
  const jsonSpans = useMemo(() => (panel === "json" ? jsonItemSpans(code) : new Map<string, { from: number; to: number }>()), [panel, code]);

  // Stable Excalidraw props: the board must not re-render on every save or parent update (that made the pen stutter).
  const live = useRef({
    onChange: (_els: readonly El[], _st: Record<string, unknown>) => {},
    onPaste: (_ev: ClipboardEvent | null) => true as boolean,
    onApi: (_a: unknown) => {},
    onLink: (_el: El, _ev: CustomEvent<{ nativeEvent: MouseEvent }>) => {},
  });
  const tickAt = useRef(0);
  live.current.onChange = (els, st) => {
    track(els, st);
    const now = performance.now();
    if (now - tickAt.current > 120) { tickAt.current = now; setTick((n) => n + 1); }
    const v = els.reduce((n, e) => n + ((e.version as number) ?? 0), 0) + ":" + els.length;
    if (v === lastVersion.current) return; // ignore pure scroll/zoom/selection changes
    const first = !lastVersion.current;
    lastVersion.current = v;
    const live = els.filter((e) => !e.isDeleted);
    if (live.length !== count) setCount(live.length);
    const fc = live.filter((e) => e.type === "frame" || e.type === "magicframe").length;
    if (fc !== frameCount) setFrameCount(fc);
    if (first) return;
    if (histOp.current) histOp.current = false; else if (canRedo) setCanRedo(false);
    scheduleSave(900);
  };
  live.current.onPaste = (ev) => {
    const files = [...(ev?.clipboardData?.files ?? [])].filter(ours);
    if (!files.length) return true;
    files.forEach((f, i) => addFile(f, undefined, i));
    return false;
  };
  live.current.onApi = (a) => {
    api.current = a as API;
    setApiReady(a as API);
    if (!pendingDone.current) { pendingDone.current = true; void hydrate(initial.scene.files as Record<string, SceneFile>); setTimeout(() => applyPending(initial.scene), 60); }
  };
  // Note cards link to "lumen:note/<id>": open the note in Lumen instead of a browser tab.
  live.current.onLink = (el, ev) => {
    const l = String(el.link ?? "");
    if (l.startsWith("lumen:note/")) { ev.preventDefault(); openNote(l.slice(11)); }
  };
  const stable = useMemo(() => ({
    onChange: (els: unknown, st: unknown) => live.current.onChange(els as readonly El[], st as Record<string, unknown>),
    onPaste: (_d: unknown, ev: ClipboardEvent | null) => live.current.onPaste(ev),
    onApi: (a: unknown) => live.current.onApi(a),
    onLink: (el: unknown, ev: unknown) => live.current.onLink(el as El, ev as CustomEvent<{ nativeEvent: MouseEvent }>),
  }), []);
  const board = useMemo(() => (
    <Excalidraw
      excalidrawAPI={stable.onApi as never}
      initialData={initialData as never}
      theme={dark ? "dark" : "light"}
      {...(embeds as object)}
      onPaste={stable.onPaste as never}
      onChange={stable.onChange as never}
      onLinkOpen={stable.onLink as never}
      UIOptions={UI_OPTIONS as never}
    />
  ), [initialData, dark, embeds, stable]);

  // ------------------------------------------------------------------ chrome data
  const penLook = wbRegistry.penLook?.() ?? { glyph: "pen-fountain", color: shown(penInk.color, dark), label: t("Pen") };
  const perf = count > PERF_LIMIT && !perfOff;
  const toggleZen = () => api.current?.updateScene({ appState: { zenModeEnabled: !zen } });
  const togglePenMode = () => api.current?.updateScene({ appState: { penMode: !penMode, penDetected: true } });
  const toggleMinimap = () => { const v = !minimap; setMinimap(v); try { localStorage.setItem("lumen.wbMinimap", v ? "1" : "0"); } catch { /* ignore */ } };
  const openHistory = () => setUI({ panel: ui.panel === "versions" ? null : "versions" });
  const moreItems: MoreItem[] = [
    { glyph: "mermaid", label: t("Mermaid → shapes"), run: () => setMermaidOpen(true), on: mermaidOpen },
    { glyph: "code", label: t("Code: .excalidraw JSON"), run: () => (panel === "json" ? setPanel(null) : openTab("json")), on: panel === "json" },
    { glyph: "script", label: t("Script console"), run: () => (panel === "script" ? setPanel(null) : openTab("script")), on: panel === "script" },
    { glyph: "gear", label: t("Board settings"), run: () => openPanel("settings") },
    { glyph: "download", label: t("Download .excalidraw"), run: () => void downloadExcalidraw() },
  ];
  const menuItems: MenuItem[] = [
    { id: "settings", glyph: "gear", label: t("Board settings"), run: () => openPanel("settings") },
    { id: "layers", glyph: "layers", label: t("Layers"), hint: "L", run: () => openPanel("layers") },
    { id: "frames", glyph: "frame", label: t("Frames"), run: () => openPanel("frames") },
    { id: "present", glyph: "present", label: t("Present"), hint: "⌥P", run: () => openPanel("present") },
    { id: "export", glyph: "export", label: t("Export…"), hint: "⇧⌘E", run: doExport },
    { id: "convert", glyph: "switch", label: t("Convert to…"), hint: "›", run: () => openPanel("convert") },
    { id: "history", glyph: "history", label: t("History"), run: openHistory },
    { id: "handwriting", glyph: "searchable", label: t("Handwriting search"), hint: wbRegistry.panels.handwriting ? t("On") : t("Off"), run: () => openPanel("handwriting") },
    { id: "zen", glyph: "zen", label: t("Zen mode"), hint: "⌥Z", on: zen, run: toggleZen },
    { id: "note", glyph: "note", label: t("Note"), hint: "›", run: () => {} },
  ];
  const noteItems: MenuItem[] = [
    { id: "pin", glyph: "pin", label: note.pinned ? t("Unpin") : t("Pin"), run: () => void updateNote(note.id, { pinned: note.pinned ? 0 : 1 }) },
    { id: "fav", glyph: "star", label: note.favorite ? t("Remove favorite") : t("Favorite"), run: () => void updateNote(note.id, { favorite: note.favorite ? 0 : 1 }) },
    { id: "props", glyph: "info", label: t("Properties"), run: () => setUI({ panel: "properties" }) },
    { id: "share", glyph: "link", label: t("Share / publish…"), run: () => setShare(true) },
    { id: "dup", glyph: "duplicate", label: t("Duplicate"), run: async () => { const d = await duplicateNote(note.id); if (d) openNote(d.id); } },
    { id: "trash", glyph: "trash", label: t("Move to trash"), run: async () => { const title = note.title; await trashNote(note.id); setUI({ noteId: null }); toast(t("“{title}” moved to Trash", { title }), { label: t("Undo"), run: () => { void restoreNote(note.id); openNote(note.id); } }); } },
  ];
  const dockMoreItems = [
    { glyph: "select", label: t("Select"), run: () => activate("select"), on: tool === "select" },
    { glyph: "lasso", label: t("Lasso"), run: () => activate("lasso") },
    { glyph: "laser", label: t("Laser"), run: () => activate("laser"), on: tool === "laser" },
    { glyph: "arrow", label: t("Arrow"), run: () => activate("arrow"), on: tool === "arrow" },
    { glyph: "sticky", label: t("Sticky"), run: () => activate("sticky") },
    { glyph: "image", label: t("Image"), run: () => activate("image") },
    { glyph: "media", label: t("GIF / video"), run: () => activate("media") },
    { glyph: "web-embed", label: t("Web page"), run: () => activate("web"), on: tool === "web" },
    { glyph: "note-card", label: t("Note card"), run: () => activate("note") },
    { glyph: "frame", label: t("Frame"), run: () => activate("frame"), on: tool === "frame" },
    { glyph: "mermaid", label: "Mermaid", run: () => setMermaidOpen(true) },
    { glyph: "code", label: t("Code"), run: () => openTab("json") },
    { glyph: "script", label: t("Script"), run: () => openTab("script") },
    { glyph: "export", label: t("Export"), run: doExport },
  ];
  const showBar = !!bar && !zen && !(phone && dockMore) && !wheel;
  const empty = count === 0 && tool === "select" && !panel;
  const panelRender = open ? wbRegistry.panels[open] : undefined;
  const drawingPhone = phone && (tool !== "select" && tool !== "hand" || !!bar?.ids.length);
  const banner = saved.offline ? { dot: "var(--warning)", text: t("Offline · changes save on this device and sync later") } : perf ? { dot: "var(--muted)", text: t("Large board · {n} elements · Performance mode: shadows off", { n: count.toLocaleString() }), action: t("Turn off"), onAction: () => setPerfOff(true) } : null;

  return (
    <div dir={rtl ? "rtl" : "ltr"} className={cx("relative flex h-full min-h-0 flex-col", perf && "wb-perf-root")}>
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
      <BoardHeader crumb={crumb} title={note.title} saved={saved} phone={phone} onBack={() => (canGoBack() ? history.back() : back())}
        buttons={[
          { glyph: "history", tip: t("History"), run: openHistory, on: ui.panel === "versions" },
          { glyph: "layers", tip: t("Layers") + " · L", run: () => openPanel("layers") },
          { glyph: "present", label: t("Present"), tip: t("Present") + " · ⌥P", run: () => openPanel("present") },
          { glyph: "link", label: t("Share"), tip: t("Share"), run: () => setShare(true) },
          { glyph: "more", tip: t("Board"), run: () => setMenu((m) => !m), on: menu },
        ]}
        right={<>
          <button type="button" aria-pressed={penMode} title={t("Pen mode: stylus draws, finger pans")} onClick={togglePenMode} className="flex h-9 items-center rounded-full border px-3 text-[13px]" style={penMode ? { borderColor: "var(--accent)", color: "var(--accent)", background: "color-mix(in srgb,var(--accent) 18%,transparent)" } : { borderColor: "var(--border)" }}>{t("Pen")}</button>
          <button type="button" aria-label={t("Board")} onClick={() => setMenu(true)} className="flex size-11 items-center justify-center"><Glyph name="more" size={18} /></button>
        </>} />
      {menu && <HeaderMenu items={menuItems} noteItems={noteItems} phone={phone} onClose={() => setMenu(false)} />}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div ref={host} className={cx("lumen-wb relative min-h-0 flex-1", perf && "wb-perf")}
          onPointerDownCapture={onPointerDownCapture} onPointerMoveCapture={onPointerMoveCapture} onPointerUpCapture={onPointerUpCapture} onPointerCancelCapture={onPointerUpCapture}
          onContextMenuCapture={(e) => {
            if (!(e.target as HTMLElement).closest("canvas") || hitTest(e.clientX, e.clientY)) return; // on an element: Excalidraw's menu
            e.preventDefault(); e.stopPropagation();
            openWheel(e.clientX, e.clientY);
          }}
          onDropCapture={(e) => {
            // Photos (fast path) and GIF / video / audio (playable embeds) are Lumen's; SVG, .excalidraw and text stay Excalidraw's.
            const files = [...e.dataTransfer.files].filter(ours);
            if (!files.length) return;
            e.preventDefault();
            e.stopPropagation();
            files.forEach((f, i) => addFile(f, e, i));
          }}>
          <input ref={mediaInput} type="file" accept="image/gif,image/apng,video/*,audio/*" multiple hidden onChange={(e) => { [...(e.target.files ?? [])].filter(ours).forEach((f, i) => addFile(f, undefined, i)); e.target.value = ""; }} />
          {/* the drawing never mirrors: Excalidraw stays LTR inside an RTL shell */}
          <div dir="ltr" className="absolute inset-0">{board}</div>

          {!zen && !phone && (
            <Toolbar tool={tool} shape={shape} line={line} arrowType={arrowType} locked={locked} pen={penLook}
              onTool={(id) => activate(id)} onLock={toggleLock} onShape={(s) => activate("shape", { shape: s })} onLine={(l, at) => activate("arrow", { line: l, arrow: at })}
              more={moreItems} penPopover={wbRegistry.pens?.({ ...ctx, anchor: null, target: "tool" })} shapePopover={wbRegistry.shapes?.({ ...ctx, anchor: null, target: "tool" })} />
          )}
          {showBar && bar && (
            <PropertyBar key={bar.ids.join() || bar.mode} mode={bar.mode} style={bar.style} pos={bar.pos} phone={phone} dark={dark} ctx={ctx} onSet={setStyle} onAction={action}
              penLabel={bar.mode === "ink" && wbRegistry.pens ? t("Pen") : undefined} onPens={wbRegistry.pens ? () => openPanel("pens") : undefined} />
          )}
          {banner && !zen && <Banner {...banner} phone={phone} />}
          {empty && <EmptyBoard kind={kind} phone={phone} onDraw={() => activate("pen")} onCard={() => setPicker(true)} onPaste={() => void pasteImage()} />}
          {picker && <NoteCardPicker phone={phone} exclude={note.id} onPick={addNoteCard} onClose={() => setPicker(false)} />}
          {!zen && <ZoomCluster api={apiReady} zoom={zoom} canRedo={canRedo} onUndo={undo} onRedo={redo} />}
          {!zen && minimap && <Minimap api={apiReady} tick={tick} />}
          {!zen && !empty && <FrameChip api={apiReady} count={frameCount} tick={tick} minimap={minimap} onMinimap={toggleMinimap} onFrames={() => openPanel("frames")} />}
          {wheel && <ToolWheel x={wheel.x} y={wheel.y} slots={wheel.slots} current={tool} penColor={shown(penInk.color, dark)} hlColor={hlInk.color} onPick={pickSlot} onUndo={undo} onRedo={redo} onClose={() => setWheel(null)} />}

          {/* Phone: undo/redo top-start while drawing, pen-mode rule chip top-end, dock at the bottom */}
          {phone && !panel && (
            <>
              {drawingPhone && (
                <div data-wb-chrome className="absolute start-3 top-3 z-20 flex gap-1.5">
                  <button type="button" aria-label={t("Undo")} onClick={undo} className="flex size-11 items-center justify-center rounded-[12px] border border-line bg-surface"><Glyph name="undo" size={20} /></button>
                  <button type="button" aria-label={t("Redo")} onClick={redo} className={cx("flex size-11 items-center justify-center rounded-[12px] border border-line bg-surface", !canRedo && "text-muted")}><Glyph name="redo" size={20} /></button>
                </div>
              )}
              {penMode && <div data-wb-chrome className="absolute end-3 top-3 z-20 flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[11.5px] text-muted">{t("Stylus draws · finger pans")}</div>}
              <PhoneDock tool={tool} penGlyph={penLook.glyph} penColor={penLook.color} more={dockMoreItems} moreOpen={dockMore} onMore={setDockMore}
                onTool={(id) => (id === tool && id !== "hand" && id !== "select" ? activate("select") : activate(id))} />
            </>
          )}
          {panelRender && <div data-wb-chrome className="contents">{panelRender(ctx)}</div>}
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
                  <button onClick={applyCode} disabled={!!codeErr} className="flex h-7 items-center rounded-[8px] border border-line px-2.5 text-[13px] hover:bg-surface-2 disabled:opacity-50 disabled:hover:bg-transparent">{t("Apply")}</button>
                  <button title={t("Download .excalidraw")} aria-label={t("Download .excalidraw")} onClick={() => void downloadExcalidraw()} className="flex size-7 items-center justify-center rounded-[8px] border border-line hover:bg-surface-2"><Glyph name="download" size={14} /></button>
                </PanelBar>
                {codeErr && <ErrorBanner error={codeErr} line={errorLine(codeErr, code)} onGoto={() => { const l = errorLine(codeErr, code); if (l) ed.current?.goto(l); }} />}
                <CodeEditor value={code} handle={ed} onChange={(x) => { setCode(x); setCodeErr(parseScene(x).error); }}
                  band={(() => { const id = bar?.ids[0]; return id ? jsonSpans.get(id) ?? null : null; })()}
                  onCursor={(c) => { setCursor({ line: c.line, col: c.col }); if (c.user) { const id = itemAt(jsonSpans, c.pos); if (id && !bar?.ids.includes(id)) api.current?.updateScene({ appState: { selectedElementIds: { [id]: true } } }); } }} />
                <StatusFooter><span className="truncate">{codeErr ? t("Board keeps last valid state") : t("Edit, then Apply")}</span><span className="flex-1" />{cursor && <span className="shrink-0 tabular-nums">{t("Ln {line}, Col {col}", { line: cursor.line, col: cursor.col })}</span>}</StatusFooter>
                <PhoneActions>
                  <button aria-label={t("Download .excalidraw")} onClick={() => void downloadExcalidraw()} className="flex size-[52px] items-center justify-center rounded-[12px] border border-line"><Glyph name="download" size={18} /></button>
                  <button disabled={!!codeErr} onClick={() => { applyCode(); setPanel(null); }} className="flex h-[52px] flex-1 items-center justify-center rounded-[12px] bg-accent text-[15px] font-semibold text-accent-fg disabled:opacity-50">{t("Apply")}</button>
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
                <OutputStrip logs={logs} onClear={() => setLogs([])} empty={t("Output appears here.")} />
                <PhoneActions><RunButton onRun={runScript} big /></PhoneActions>
              </>
            )}
          </CodePanel>
        )}
      </div>

      <ShareSheet target={{ kind: "note", note }} open={share} onClose={() => setShare(false)} />
      {mermaidOpen && <MermaidDialog dark={dark} onClose={() => setMermaidOpen(false)} onAdd={(c, o) => fromMermaid(c, o)} />}
    </div>
  );
}

/** Re-render only when this note's content changes, not on every vault update (saves elsewhere, sync, list changes). */
export default memo(Whiteboard, (a, b) => a.note.id === b.note.id && a.note.body === b.note.body && a.note.title === b.note.title && a.note.pinned === b.note.pinned && a.note.favorite === b.note.favorite && a.note.shareId === b.note.shareId);

/** Small switch (30×18), amber when on. */
function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex items-center gap-2 text-[13px]">
      <span className={cx("relative h-[18px] w-[30px] shrink-0 rounded-full", on ? "bg-accent" : "border border-line bg-surface-2")}>
        <span className={cx("absolute size-3 rounded-full", on ? "end-[3px] top-[3px] bg-accent-fg" : "start-[2px] top-[2px] bg-muted")} />
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
    const tm = setTimeout(async () => {
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
    return () => { live = false; clearTimeout(tm); };
  }, [src, dark, sketchy]);

  async function add() {
    setBusy(true);
    try {
      try { localStorage.setItem("lumen.wbMermaid", src); } catch { /* ignore */ }
      await onAdd(src, { sketchy, frame });
      onClose();
    } catch (e) { toast(t("Mermaid: {error}", { error: (e as Error).message })); } finally { setBusy(false); }
  }

  const preview = (
    <div className="relative mx-4 h-full min-h-0 overflow-hidden rounded-[12px] border border-line bg-bg md:mx-0 md:rounded-none md:border-0 md:bg-[image:var(--wb-grid)] md:bg-[size:24px_24px]" style={{ ["--wb-grid" as string]: "linear-gradient(color-mix(in srgb,var(--muted) 9%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--muted) 9%,transparent) 1px,transparent 1px)" }}>
      <span className="absolute start-3.5 top-3 hidden text-[11.5px] font-medium text-muted md:inline">{sketchy ? t("Live preview · hand-drawn style") : t("Live preview")}</span>
      <div className="flex h-full items-center justify-center px-10 pb-6 pt-10 [&_svg]:h-auto [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(5,6,8,.62)] md:items-center fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-in safe-t safe-b flex h-dvh w-full flex-col overflow-hidden bg-surface md:h-[620px] md:border md:border-line md:max-h-[90dvh] md:max-w-[1040px] md:rounded-[14px]">
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-5">
          <Workflow size={17} className="hidden text-muted md:block" />
          <span className="flex-1 text-[17px] font-[650] md:text-[16px]">{t("Mermaid → whiteboard")}</span>
          <span className={cx("hidden h-[26px] items-center rounded-full px-2.5 text-[12px] font-semibold md:flex", err ? "bg-bad/14 text-bad" : "bg-ok/14 text-ok")}>{err ? <><X size={12} className="me-1" />{t("invalid")}</> : <><Check size={12} className="me-1" />{t("{kind} · valid", { kind })}</>}</span>
          <button aria-label={t("Close")} onClick={onClose} className="-me-4 ms-1.5 flex size-12 items-center justify-center rounded-[8px] text-ink hover:bg-surface-2 md:me-0 md:size-9 md:text-muted md:hover:text-ink [&>svg]:size-5 md:[&>svg]:size-[18px]"><X size={18} /></button>
        </div>
        <div className="flex shrink-0 items-center gap-2.5 px-4 py-3 md:hidden">
          <div className="grid flex-1 grid-cols-2 rounded-[10px] border border-line bg-bg p-[3px]">
            {([["code", tk("Code")], ["preview", tk("Preview")]] as const).map(([id, l]) => <button key={id} onClick={() => setTab(id)} className={cx("h-[38px] rounded-[7px] text-[13px]", tab === id ? "bg-surface-2 font-semibold" : "text-muted")}>{t(l)}</button>)}
          </div>
          <span className={cx("flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold", err ? "bg-bad/14 text-bad" : "bg-ok/14 text-ok")}>{err ? <X size={12} /> : <><Check size={12} className="me-1" />{t("valid")}</>}</span>
        </div>
        <div className="grid min-h-0 flex-1 md:grid-cols-[400px_1fr]">
          <div className={cx("flex min-h-0 flex-col border-line bg-bg md:flex md:border-e", tab === "code" ? "flex" : "hidden")}>
            <CodeEditor lang="mermaid" value={src} onChange={setSrc} className="min-h-0 flex-1 overflow-auto pt-0.5 [&_.cm-content]:[font-variant-ligatures:none] [&_.cm-editor]:!text-[13px] [&_.cm-scroller]:!leading-[22px]" />
            {err && <div className="shrink-0 border-t border-line px-3.5 py-2 text-[12px] text-bad">{err}</div>}
          </div>
          <div className={cx("min-h-0 md:block", tab === "preview" ? "block" : "hidden")}>{preview}</div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-[18px] gap-y-2 px-4 py-3 md:h-16 md:border-t md:border-line md:px-5 md:py-0">
          <span className="hidden md:contents"><Switch label={t("Hand-drawn style")} on={sketchy} onChange={setSketchy} /><Switch label={t("Wrap in a frame")} on={frame} onChange={setFrame} /></span>
          <span className="flex-1" />
          <Button variant="ghost" className="max-md:!hidden" onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" className="h-[52px] w-full rounded-[12px] text-[15px] font-semibold md:h-[38px] md:w-auto md:rounded-[10px] md:text-[13px]" disabled={!!err || busy} onClick={add}><Shapes size={15} />{t("Add as editable shapes")}</Button>
        </div>
      </div>
    </div>
  );
}
