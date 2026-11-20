/**
 * Export job API: one Export dialog (components/DiagramExport.tsx) for every visual.
 *
 * A workspace (whiteboard, board, canvas, Mermaid file, architecture studio) opens the dialog with a job:
 *
 *   openExportJob({
 *     kind: "whiteboard",                    // "whiteboard" | "board" | "canvas" | "mermaid" | "architecture" | "graph"
 *     title: "Week 3 · Optics", name: "week-3-optics",   // dialog subtitle, default file name
 *     sourceExt: ".excalidraw",              // label of the "Source" format tile
 *     scopes: ["whole", "selection", "visible", "frames"],   // what is available now (others render disabled)
 *     pickers: { frames: [{ id, name, thumb? }] },           // multi-select lists for the "frames" / "groups" / "layers" scopes
 *     boardBackground: "#0f1115", hasPattern: true, themable: true,
 *     content: ["frameNames", "hiddenLayers", "media", "embedScene"],   // content toggles to show
 *     media: { videos: 2, gifs: 1 },         // drives the "can't animate in images" warning
 *     link: "https://...",                   // enables "Copy link" (shared notes)
 *     build: async (req) => ({ blob, width, height }) | ({ svg, width, height }),   // one image per call, see BuildRequest
 *     source: async () => text | Blob,       // "Source" format + "Copy source"
 *     markdown: async (opts) => text | { text, files },  // "Markdown" format + "Copy as Markdown"
 *     mermaid: async (opts, kind) => text,   // "Mermaid" format (omit if the workspace cannot)
 *     mermaidKinds: ["flowchart"], mermaidNote: "Best effort: ...",
 *     formats: [{ id, label, glyph, sub, ext, mime, run: async (opts) => string | Blob }],   // extra format plugins
 *   });
 *
 * `build(req)` renders ONE image: `req.scope` + `req.ids` (frame / group / layer ids, empty for whole / selection / visible),
 * `req.opts` (look and content options), `req.format` ("svg" asks for vector, others for raster), `req.scale` (a number, or
 * null when the user picked "Max px": then use `req.maxPx` as the longest side). Return `{ svg, width, height }` (the dialog
 * rasterises it off the main thread, applies aspect, background and quality) or `{ blob, width, height, limited? }` when the
 * workspace renders pixels itself (set `limited` to the scale it had to fall back to). The dialog calls `build` once per frame
 * for "one page per frame" PDFs and multi-frame image exports (those are zipped).
 *
 * Whiteboard example (Excalidraw; `api` = ExcalidrawImperativeAPI, `exp` = await import("@excalidraw/excalidraw")):
 *
 *   openExportJob({
 *     kind: "whiteboard", title, name: title, sourceExt: ".excalidraw", themable: true, hasPattern: true,
 *     scopes: ["whole", "selection", "visible", "frames"],
 *     pickers: { frames: frameEls.map((f) => ({ id: f.id, name: f.name ?? "Frame" })) },
 *     content: ["frameNames", "hiddenLayers", "media", "embedScene"],
 *     build: async ({ scope, ids, opts, format, scale }) => {
 *       const all = api.getSceneElements().filter((e) => opts.hiddenLayers || !isHidden(e));
 *       const sel = api.getAppState().selectedElementIds;
 *       const els = scope === "selection" ? all.filter((e) => sel[e.id])
 *         : scope === "frames" ? all.filter((e) => ids.includes(e.id) || ids.includes(e.frameId ?? "")) : all; // "visible": filter by viewport rect
 *       const common = { elements: els, files: api.getFiles(), appState: { exportBackground: opts.bgColor !== null,
 *         viewBackgroundColor: opts.bgColor ?? "#ffffff", exportWithDarkMode: opts.theme === "dark", exportScale: scale ?? 1, exportEmbedScene: opts.embedScene },
 *         exportPadding: opts.padding, exportingFrame: scope === "frames" && ids.length === 1 ? frameById(ids[0]) : null };
 *       if (format === "svg") { const el = await exp.exportToSvg(common); return { svg: el.outerHTML, width: +el.getAttribute("width")!, height: +el.getAttribute("height")! }; }
 *       const blob = await exp.exportToBlob({ ...common, mimeType: "image/png" });
 *       const bm = await createImageBitmap(blob); return { blob, width: bm.width, height: bm.height };
 *     },
 *     source: async () => serializeAsJSON(...),
 *   });
 *
 * `opts.bgColor` is the resolved background colour (null = transparent). Settings are remembered per `kind`.
 */
export type ExportKind = "whiteboard" | "board" | "canvas" | "mermaid" | "architecture" | "graph";
export type ExportScope = "whole" | "selection" | "visible" | "frames" | "groups" | "layers";
export type RasterFormat = "png" | "jpeg" | "webp";
/** Built-in ids, or the id of a format plugin. */
export type ExportFormat = RasterFormat | "svg" | "pdf" | "source" | "markdown" | "mermaid" | (string & {});
export type PageSize = "fit" | "a4" | "letter" | "16:9";

export interface ExportOptions {
  scope: ExportScope;
  /** Picked frame / group / layer ids (for those scopes). */
  ids: string[];
  format: ExportFormat;
  /** 1..4, or "max" (then `maxPx` is the longest side). */
  scale: 1 | 2 | 3 | 4 | "max";
  maxPx: number;
  background: "transparent" | "theme" | "custom" | "board";
  color: string;
  /** Resolved colour for the background choice (null = transparent). */
  bgColor: string | null;
  pattern: boolean;
  theme: "app" | "default" | "dark" | "neutral" | "forest";
  padding: number;
  /** 0..1, lossy formats. */
  quality: number;
  frameNames: boolean;
  hiddenLayers: boolean;
  media: "still" | "placeholder";
  embedScene: boolean;
  cardStyle: "screen" | "flat" | "print";
  groupLabels: boolean;
  edgeLabels: boolean;
  /** Fixed width / height ratio (presets), 0 = natural. */
  aspect: number;
  pdfMode: "per-frame" | "single";
  pdfPage: PageSize;
  pdfOrient: "landscape" | "portrait";
  pdfMargin: number;
  mdOutline: boolean;
  mdAttachments: boolean;
  mdTable: boolean;
  mdMermaid: boolean;
  mermaidKind: string;
  fileName: string;
  // fields the legacy Mermaid exporter understands
  svgText: boolean;
  embedFont: boolean;
}

export interface BuildRequest { scope: ExportScope; ids: string[]; opts: ExportOptions; format: "svg" | RasterFormat; scale: number | null; maxPx: number }
export type Rendered =
  | { svg: string; width: number; height: number }
  | { blob: Blob; width: number; height: number; limited?: number };

export interface PickItem { id: string; name: string; thumb?: string }
export type ContentToggle = "frameNames" | "hiddenLayers" | "media" | "embedScene" | "cardStyle" | "groupLabels" | "edgeLabels";
export interface FormatPlugin {
  id: string; label: string; glyph: string; sub?: string; ext: string; mime: string;
  run: (opts: ExportOptions) => Promise<string | Blob>;
}
export interface MarkdownResult { text: string; files?: { name: string; blob: Blob }[] }

export interface VisualExportJob {
  kind: ExportKind;
  title: string;
  name: string;
  sourceExt?: string;
  scopes: ExportScope[];
  pickers?: Partial<Record<"frames" | "groups" | "layers", PickItem[]>>;
  boardBackground?: string;
  hasPattern?: boolean;
  themable?: boolean;
  content?: ContentToggle[];
  media?: { videos: number; gifs: number };
  link?: string;
  /** Per-kind option defaults (e.g. a Mermaid file defaults to SVG). */
  defaults?: Partial<ExportOptions>;
  build: (req: BuildRequest) => Promise<Rendered>;
  source?: () => Promise<string | Blob>;
  markdown?: (opts: ExportOptions) => Promise<string | MarkdownResult>;
  mermaid?: (opts: ExportOptions, kind: string) => Promise<string>;
  mermaidKinds?: string[];
  mermaidNote?: string;
  formats?: FormatPlugin[];
  /** Restrict the image formats (e.g. no "svg" when the workspace only renders pixels). */
  imageFormats?: ("png" | "jpeg" | "webp" | "svg" | "pdf")[];
}

export const EXPORT_EVENT = "lumen:export";
export function openExportJob(job: VisualExportJob) { dispatchEvent(new CustomEvent(EXPORT_EVENT, { detail: job })); }
export const isVisualJob = (d: unknown): d is VisualExportJob => !!d && typeof d === "object" && "scopes" in d && "kind" in d;

export const DEFAULT_OPTIONS: ExportOptions = {
  scope: "whole", ids: [], format: "png", scale: 2, maxPx: 4096, background: "board", color: "#ffffff", bgColor: null, pattern: true, theme: "app", padding: 24, quality: 0.92,
  frameNames: true, hiddenLayers: false, media: "still", embedScene: true, cardStyle: "screen", groupLabels: true, edgeLabels: true, aspect: 0,
  pdfMode: "per-frame", pdfPage: "16:9", pdfOrient: "landscape", pdfMargin: 12, mdOutline: true, mdAttachments: true, mdTable: true, mdMermaid: true, mermaidKind: "flowchart",
  fileName: "", svgText: true, embedFont: true,
};

const KEY = (k: ExportKind) => `lumen:export:${k}`;
/** Options remembered for this workspace kind (scope and picked ids are never remembered). */
export function loadOptions(job: VisualExportJob): ExportOptions {
  let saved: Partial<ExportOptions> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY(job.kind)) ?? "{}"); } catch { /* private mode */ }
  const o: ExportOptions = { ...DEFAULT_OPTIONS, ...(job.defaults ?? {}), ...saved, scope: "whole", ids: [], fileName: job.name };
  if (job.mermaidKinds?.length && !job.mermaidKinds.includes(o.mermaidKind)) o.mermaidKind = job.mermaidKinds[0];
  return o;
}
export function saveOptions(kind: ExportKind, o: ExportOptions) {
  const { scope: _s, ids: _i, fileName: _f, bgColor: _b, aspect: _a, ...rest } = o;
  try { localStorage.setItem(KEY(kind), JSON.stringify(rest)); } catch { /* ignore */ }
}
