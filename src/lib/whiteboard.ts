// Whiteboard = an Excalidraw scene (open .excalidraw JSON) stored as the note body.
// Protocol: GET/PUT /api/whiteboard/:id (full .excalidraw JSON), or POST /api/whiteboard/:id/elements with
// { "skeleton": [...] } (Excalidraw element skeletons) which the app converts and merges on next open.
import type { JsonCanvas } from "../../shared/types";
import { colorOf } from "./canvas";

export interface Scene {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: Record<string, unknown>[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
  /** Skeletons pushed through the API, converted by the app on next open. */
  lumenPending?: Skeleton[];
}
export type Skeleton = Record<string, unknown> & { type: string };

export const EMPTY_SCENE: Scene = { type: "excalidraw", version: 2, source: "lumen", elements: [], appState: { viewBackgroundColor: "transparent", gridSize: null }, files: {} };

export function parseScene(text: string): { scene: Scene; error: string | null } {
  if (!text.trim()) return { scene: { ...EMPTY_SCENE }, error: null };
  try {
    const s = JSON.parse(text) as Scene;
    if (!s || !Array.isArray(s.elements)) return { scene: { ...EMPTY_SCENE }, error: "Missing `elements` array" };
    return { scene: { ...EMPTY_SCENE, ...s }, error: null };
  } catch (e) {
    return { scene: { ...EMPTY_SCENE }, error: `JSON: ${(e as Error).message}` };
  }
}

/** Plain text in a whiteboard (for search and previews). */
export function sceneText(body: string) {
  try {
    return ((JSON.parse(body) as Scene).elements ?? []).filter((e) => !e.isDeleted && typeof e.text === "string").map((e) => e.text as string).join("\n");
  } catch { return ""; }
}

// ------------------------------------------------------------------ skeleton helpers (used by the script console)
const STICKY = ["#fff3bf", "#d3f9d8", "#d0ebff", "#ffd8a8", "#eebefa", "#ffc9c9"];
export const sk = {
  rect: (x: number, y: number, w = 200, h = 100, label?: string, o: Record<string, unknown> = {}): Skeleton => ({ type: "rectangle", x, y, width: w, height: h, roundness: { type: 3 }, ...(label ? { label: { text: label } } : {}), ...o }),
  ellipse: (x: number, y: number, w = 160, h = 100, label?: string, o: Record<string, unknown> = {}): Skeleton => ({ type: "ellipse", x, y, width: w, height: h, ...(label ? { label: { text: label } } : {}), ...o }),
  diamond: (x: number, y: number, w = 160, h = 120, label?: string, o: Record<string, unknown> = {}): Skeleton => ({ type: "diamond", x, y, width: w, height: h, ...(label ? { label: { text: label } } : {}), ...o }),
  text: (x: number, y: number, text: string, o: Record<string, unknown> = {}): Skeleton => ({ type: "text", x, y, text, fontSize: 20, ...o }),
  sticky: (x: number, y: number, text: string, color = 0): Skeleton => ({ type: "rectangle", x, y, width: 200, height: 160, backgroundColor: STICKY[color % STICKY.length], fillStyle: "solid", strokeColor: "transparent", roundness: { type: 3 }, label: { text, fontSize: 18, strokeColor: "#1e1e1e" } }),
  arrow: (x: number, y: number, dx: number, dy: number, o: Record<string, unknown> = {}): Skeleton => ({ type: "arrow", x, y, width: dx, height: dy, points: [[0, 0], [dx, dy]], ...o }),
  /** Arrow bound between two element ids (ids you gave to skeletons). */
  connect: (fromId: string, toId: string, label?: string): Skeleton => ({ type: "arrow", x: 0, y: 0, start: { id: fromId }, end: { id: toId }, ...(label ? { label: { text: label } } : {}) }),
  frame: (children: string[], name: string): Skeleton => ({ type: "frame", children, name }),
};

/** JSON Canvas → whiteboard skeletons (cards become boxes, edges become bound arrows, groups become frames). */
export function canvasToSkeleton(c: JsonCanvas): Skeleton[] {
  const out: Skeleton[] = [];
  const nodes = c.nodes ?? [];
  for (const n of nodes) {
    if (n.type === "group") continue;
    const label = n.type === "text" ? n.text.replace(/^#+\s*/gm, "").slice(0, 300) : n.type === "file" ? `📄 ${n.file}` : `🔗 ${n.url}`;
    const col = colorOf(n.color);
    out.push({ type: "rectangle", id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, roundness: { type: 3 }, ...(col ? { strokeColor: col, backgroundColor: col + "33", fillStyle: "solid" } : {}), label: { text: label, fontSize: 16 } });
  }
  for (const e of c.edges ?? []) out.push({ type: "arrow", x: 0, y: 0, start: { id: e.fromNode }, end: { id: e.toNode }, ...(e.label ? { label: { text: e.label } } : {}), ...(colorOf(e.color) ? { strokeColor: colorOf(e.color) } : {}) });
  for (const g of nodes.filter((n) => n.type === "group")) {
    const kids = nodes.filter((n) => n.type !== "group" && n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height).map((n) => n.id);
    if (kids.length) out.push({ type: "frame", children: kids, name: (g as { label?: string }).label ?? "Group" });
  }
  return out;
}
