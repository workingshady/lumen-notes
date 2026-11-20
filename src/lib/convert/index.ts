// Convert (round 7 · Lumen 40H / 52): every workspace to every other as a copy; the original is never touched.
//   convertSource(src, to)  → what the copy will be (type, title, body).      Pure apart from the lazy chunks it loads
//   convertCopy(src, to)    → creates the note, opens it with the "Undo conversion" chip.
import type { Note, NoteType } from "../../../shared/types";
import { parseCanvas, stringify } from "../canvas";
import { buildScene, boardToWhiteboard, canvasToBoardSkeleton, bbox, materialise, nodeEdges, sceneToCanvas, splitScene, sceneEls, type El } from "./scene";
import { canvasToSkeleton, parseScene } from "../whiteboard";
import { archToCanvas, archToOutline, archToSkeleton, canvasToArch } from "./arch";
import { canvasToMermaid, mermaidToCanvas, outlineToMermaid } from "./mermaid";
import { canvasToOutline, graphToBoardSkeleton, graphToCanvas, graphToMermaid, graphToOutline, noteToBoardSkeleton, noteToCanvas, sceneToOutline, type GraphData } from "./outline";
import { cardSkeleton } from "./cards";
import { parseArch, stringifyArch } from "../arch-model";
import { TARGET_SUFFIX, TARGET_TYPE, type Target, type Workspace } from "./model";
import { t } from "../i18n";

export * from "./model";
export * from "./cards";
export type { GraphData } from "./outline";

export interface ConvertSource {
  kind: Workspace;
  id?: string;
  title: string;
  /** whiteboard / board: the .excalidraw JSON (current elements + files). canvas / architecture: the canvas JSON. mermaid: the source. note: Markdown. */
  body: string;
  spaceId: string;
  folderId: string | null;
  graph?: GraphData;
}
export interface ConvertOut { type: NoteType; title: string; body: string; /** One line for the result chip / toast. */ summary: string }
export class ConvertError extends Error { constructor(msg: string, public code: "empty" | "invalid" | "unsupported" | "ai") { super(msg); } }

export const sourceOf = (n: Pick<Note, "id" | "type" | "title" | "body" | "spaceId" | "folderId">): ConvertSource => ({
  kind: n.type === "whiteboard" ? "whiteboard" : n.type === "board" ? "board" : n.type === "diagram" ? "mermaid" : n.type === "canvas" ? (parseArch(n.body) ? "architecture" : "canvas") : "note",
  id: n.id, title: n.title, body: n.body, spaceId: n.spaceId, folderId: n.folderId,
});

const titleFor = (src: ConvertSource, to: Target) => (to === "mermaid" ? `${src.title.replace(/\.mermaid$/i, "")}.mermaid` : `${src.title} (${TARGET_SUFFIX[to]})`);
const md = (body: string) => (body.trim() ? body : "");

/** Render the drawing part of a board (ink, pictures, loose shapes) to one PNG attachment. Null when there is none. */
export async function inkAttachment(body: string): Promise<string | null> {
  const { scene } = parseScene(body);
  const parts = splitScene(sceneEls(body));
  if (!parts.drawing.length) return null;
  const [{ exportToBlob }, { storeBlob }] = await Promise.all([import("@excalidraw/excalidraw"), import("../attachments")]);
  const blob = await exportToBlob({ elements: parts.drawing as never, files: (scene.files ?? {}) as never, mimeType: "image/png", appState: { exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false } as never, exportPadding: 8 });
  return (await storeBlob(blob, "ink.png", { shrink: true })).id;
}

const need = (ok: unknown, msg: string) => { if (!ok) throw new ConvertError(msg, "empty"); };

async function archNoteBody(dsl: string, kind: Parameters<typeof import("../arch-starters").archFromDsl>[0]): Promise<string> {
  const { archFromDsl, emptyArch } = await import("../arch-starters");
  let c = archFromDsl(kind, dsl, emptyArch(kind));
  try { const { elkLayout } = await import("../arch-layout"); c = await elkLayout(c, { direction: c.lumenArch.direction, spacing: "roomy", keep: false, scope: "all" }); } catch { /* placement is fine without ELK */ }
  return stringifyArch(c);
}

export async function convertSource(src: ConvertSource, to: Target): Promise<ConvertOut> {
  const title = titleFor(src, to);
  const out = (body: string, summary: string): ConvertOut => ({ type: TARGET_TYPE[to], title, body, summary });
  const k = src.kind;
  if (k === to) throw new ConvertError(t("Already a {kind}.", { kind: t(TARGET_SUFFIX[to]) }), "unsupported");

  // ---------------------------------------------------------------- whiteboard / board
  if (k === "whiteboard" || k === "board") {
    src = { ...src, body: await materialise(src.body) };
    const els = sceneEls(src.body);
    if (to === "board" || to === "whiteboard") {
      if (k === "whiteboard") return out(src.body, t("Copied as a Board"));
      return out(await boardToWhiteboard(src.body), t("Copied as a Whiteboard"));
    }
    if (to === "canvas" || to === "architecture" || to === "mermaid") {
      const parts = splitScene(els);
      need(parts.nodes.size || parts.drawing.length, t("This {kind} is empty.", { kind: t(k) }));
      if (to === "canvas") {
        const inkAtt = await inkAttachment(src.body);
        return out(stringify(sceneToCanvas(els, { inkAtt: inkAtt ?? undefined })), t("Shapes with text became cards; ink became one image card"));
      }
      const c = sceneToCanvas(els);
      need(c.nodes?.length, t("Nothing here has text to turn into a diagram."));
      return to === "architecture" ? out(canvasToArch(c), t("Cards became nodes")) : out(canvasToMermaid(c), t("Flowchart-like parts became Mermaid"));
    }
    if (to === "note") return out(sceneToOutline(title, src.body, k === "board"), t("Written as an outline"));
  }

  // ---------------------------------------------------------------- canvas
  if (k === "canvas") {
    const { canvas, error } = parseCanvas(src.body);
    if (error) throw new ConvertError(error, "invalid");
    need(canvas.nodes?.length, t("This canvas is empty."));
    if (to === "whiteboard") return out(await buildScene(canvasToSkeleton(nodeEdges(canvas))), t("Cards became boxes, edges arrows"));
    if (to === "board") return out(await buildScene(canvasToBoardSkeleton(canvas)), t("Cards are live on the board"));
    if (to === "architecture") return out(canvasToArch(canvas), t("Cards became nodes"));
    if (to === "mermaid") return out(canvasToMermaid(canvas), t("Written as a flowchart"));
    return out(canvasToOutline(title, canvas), t("Written as an outline"));
  }

  // ---------------------------------------------------------------- architecture
  if (k === "architecture") {
    const a = parseArch(src.body);
    if (!a) throw new ConvertError(t("This isn't an architecture diagram."), "invalid");
    need(a.nodes.length, t("This diagram is empty."));
    if (to === "whiteboard") return out(await buildScene(archToSkeleton(a), [], {}), t("Drawn as a sketch"));
    if (to === "board") return out(await buildScene(archToSkeleton(a)), t("Nodes became boxes"));
    if (to === "canvas") return out(stringify(archToCanvas(a)), t("Nodes became plain cards"));
    if (to === "mermaid") { const { toMermaid } = await import("../arch-convert"); return out(toMermaid(a), t("Written as Mermaid")); }
    return out(archToOutline(title, a), t("Written as a table and Mermaid"));
  }

  // ---------------------------------------------------------------- mermaid
  if (k === "mermaid") {
    const code = src.body.trim();
    need(code, t("This diagram file is empty."));
    if (to === "whiteboard") {
      const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
      let r;
      try { r = await parseMermaidToExcalidraw(code); } catch (e) { throw new ConvertError(t("Couldn't read this diagram: {why}", { why: String((e as Error).message).split("\n")[0] }), "invalid"); }
      const body = await buildScene(r.elements as never);
      return out(r.files ? JSON.stringify({ ...JSON.parse(body), files: r.files }, null, 2) : body, t("Nodes and arrows became shapes"));
    }
    if (to === "board") return out(await buildScene([cardSkeleton({ kind: "mermaid", noteId: src.id, title: src.title, src: code }, 0, 0, { w: 560, h: 340 }) as never]), t("A live Mermaid card"));
    if (to === "canvas") return out(stringify(mermaidToCanvas(code)), t("Nodes became cards"));
    if (to === "architecture") {
      const { detectPaste, toDsl } = await import("../arch-convert");
      const { dsl, archKind } = toDsl(code, detectPaste(code) ?? "mermaid-flowchart");
      return out(await archNoteBody(dsl, archKind ?? "flowchart"), t("Parsed to nodes and edges"));
    }
    return out(`# ${title}\n\n\`\`\`mermaid\n${code}\n\`\`\`\n`, t("Written as a Mermaid block"));
  }

  // ---------------------------------------------------------------- graph
  if (k === "graph") {
    const g = src.graph;
    need(g?.nodes.length, t("The graph has no notes."));
    if (to === "canvas") return out(stringify(graphToCanvas(g!)), t("Layout kept"));
    if (to === "board") return out(await buildScene(graphToBoardSkeleton(g!)), t("Notes are live cards, layout kept"));
    if (to === "mermaid") return out(graphToMermaid(g!), t("A flowchart of the links"));
    if (to === "note") return out(graphToOutline(title, g!), t("A list of links"));
  }

  // ---------------------------------------------------------------- note
  if (k === "note") {
    if (to === "board") return out(await buildScene(noteToBoardSkeleton({ id: src.id, title: src.title, body: src.body })), t("Sent to a board"));
    if (to === "canvas") return out(stringify(noteToCanvas(src)), t("Headings and bullets became cards"));
    if (to === "mermaid") return out(outlineToMermaid(md(src.body)), t("The outline as a flowchart"));
    if (to === "architecture") {
      const { archFromText } = await import("../ai-convert");
      try {
        const r = await archFromText(src.body.slice(0, 12000), { source: "describe", type: "architecture" });
        return out(await archNoteBody(r.dsl, "architecture"), t("Drawn by AI. Check it before you rely on it"));
      } catch (e) { const m = (e as Error).message ?? ""; throw new ConvertError(/unauthor|offline|401|sign/i.test(m) ? t("AI needs your Cloudflare account. You're offline or signed out.") : m || t("AI couldn't draw this."), "ai"); }
    }
  }
  throw new ConvertError(t("This conversion isn't available."), "unsupported");
}

export { bbox };
export type { El };
