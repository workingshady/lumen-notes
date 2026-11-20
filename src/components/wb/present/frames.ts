// Frames as slides (brief §5 frames navigator, §8 presentation): order = customData.lumenOrder (Frames panel order =
// slide order), customData.lumenHidden hides a frame from the presentation only, customData.lumenNotes = presenter notes.
import { exportToBlob, restoreElements } from "@excalidraw/excalidraw";
import type { WbAPI } from "../hooks";

export type FrameEl = Record<string, unknown> & { id: string; type: string; x: number; y: number; width: number; height: number; name?: string | null; customData?: Record<string, unknown> | null; frameId?: string | null; isDeleted?: boolean; version?: number };
const cd = (f: FrameEl) => (f.customData ?? {}) as { lumenOrder?: number; lumenHidden?: boolean; lumenNotes?: string };

/** Frames in slide order: explicit lumenOrder first, then reading order (top → bottom, left → right). */
export function orderedFrames(api: WbAPI | null): FrameEl[] {
  if (!api) return [];
  const fr = (api.getSceneElements() as FrameEl[]).filter((e) => (e.type === "frame" || e.type === "magicframe") && !e.isDeleted);
  const reading = [...fr].sort((a, b) => (Math.abs(a.y - b.y) > 80 ? a.y - b.y : a.x - b.x));
  const pos = new Map(reading.map((f, i) => [f.id, i]));
  return [...fr].sort((a, b) => (cd(a).lumenOrder ?? 1e6 + pos.get(a.id)!) - (cd(b).lumenOrder ?? 1e6 + pos.get(b.id)!));
}
export const frameName = (f: FrameEl, i: number) => (f.name && String(f.name).trim()) || `Frame ${i + 1}`;
export const isHidden = (f: FrameEl) => !!cd(f).lumenHidden;
export const notesOf = (f: FrameEl) => cd(f).lumenNotes ?? "";

const nonce = () => Math.floor(Math.random() * 2 ** 31);
function patch(api: WbAPI, fn: (f: FrameEl) => FrameEl | null, capture: "IMMEDIATELY" | "NEVER" = "IMMEDIATELY") {
  const els = api.getSceneElementsIncludingDeleted() as FrameEl[];
  const next = els.map((e) => { const r = fn(e); return r ? { ...r, version: (e.version ?? 1) + 1, versionNonce: nonce(), updated: Date.now() } : e; });
  api.updateScene({ elements: restoreElements(next as never, null, { refreshDimensions: false, repairBindings: true }), captureUpdate: capture });
}
/** Move frame `from` → `to` in the slide order (writes lumenOrder 0…n-1 on every frame; one undo step). */
export function reorderFrames(api: WbAPI, from: number, to: number) {
  const fr = orderedFrames(api);
  const [m] = fr.splice(from, 1);
  fr.splice(to, 0, m);
  const idx = new Map(fr.map((f, i) => [f.id, i]));
  patch(api, (e) => (idx.has(e.id) ? { ...e, customData: { ...(e.customData ?? {}), lumenOrder: idx.get(e.id) } } : null));
}
export function setFrameHidden(api: WbAPI, id: string, hidden: boolean) {
  patch(api, (e) => { if (e.id !== id) return null; const c = { ...(e.customData ?? {}) }; if (hidden) c.lumenHidden = true; else delete c.lumenHidden; return { ...e, customData: c }; });
}
export function renameFrame(api: WbAPI, id: string, name: string) { patch(api, (e) => (e.id === id ? { ...e, name: name.trim() || null } : null)); }
export function setFrameNotes(api: WbAPI, id: string, notes: string) {
  patch(api, (e) => { if (e.id !== id) return null; const c = { ...(e.customData ?? {}) }; if (notes.trim()) c.lumenNotes = notes; else delete c.lumenNotes; return { ...e, customData: c }; });
}
/** The frame and the elements inside it (frame children + bound text). */
export function frameContents(api: WbAPI, f: FrameEl): FrameEl[] {
  const els = api.getSceneElements() as FrameEl[];
  const ids = new Set(els.filter((e) => e.frameId === f.id).map((e) => e.id));
  return els.filter((e) => e.id === f.id || ids.has(e.id) || (e.containerId && ids.has(String(e.containerId))));
}
/** Small PNG thumbnail of a frame (cached by the frame contents' versions). */
const thumbs = new Map<string, { key: string; url: string }>();
export async function frameThumb(api: WbAPI, f: FrameEl, dark: boolean, w = 128): Promise<string> {
  const els = frameContents(api, f);
  const key = els.map((e) => `${e.id}:${e.version}`).join() + (dark ? "d" : "l");
  const hit = thumbs.get(f.id);
  if (hit?.key === key) return hit.url;
  const blob = await exportToBlob({ elements: els as never, files: api.getFiles() as never, mimeType: "image/png", exportPadding: 0, exportingFrame: f as never, maxWidthOrHeight: w, appState: { exportBackground: false, exportWithDarkMode: false, frameRendering: { enabled: true, name: false, outline: false, clip: true } } as never });
  const url = URL.createObjectURL(blob);
  if (hit) URL.revokeObjectURL(hit.url);
  thumbs.set(f.id, { key, url });
  return url;
}
