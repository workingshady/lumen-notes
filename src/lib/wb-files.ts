// Whiteboard images live as Lumen attachments, not inside the board JSON.
// Before: every image was a base64 dataURL inside note.body, so each autosave (every ~0.7 s), History snapshot and sync
// push rewrote megabytes → the board lagged. Now the body keeps a small ref per file:
//   files[fileId] = { id, mimeType, created, lumenAtt: "<attachment id>" }   (no dataURL)
// and the editor loads the bytes from the attachment (local blob first, else /api/att/<id>).
// Exported .excalidraw files get the dataURLs inlined again (inlineSceneFiles), so the open format stays complete.

export type SceneFile = { id: string; mimeType: string; created?: number; dataURL?: string; lumenAtt?: string; [k: string]: unknown };
export type BlobSource = (attId: string) => Promise<Blob | null>;

export const blobToDataURL = (b: Blob) =>
  new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

export const dataURLToBlob = async (u: string) => (await fetch(u)).blob();

/** Raster photos Lumen inserts itself (SVG and GIF keep their own paths). */
export const isPhoto = (mime: string) => /^image\/(png|jpe?g|webp|bmp|avif)$/i.test(mime);

/**
 * Shrink a photo to at most `max` px without blocking the page: the browser decodes and resizes in createImageBitmap
 * (off the main thread) and encodes asynchronously. Excalidraw's own insert resizes with pica on the main thread,
 * which froze the board for ~0.5 s per 12 MP photo. Returns the bytes plus the natural size.
 */
export async function shrinkImage(file: Blob, max = 1600): Promise<{ blob: Blob; w: number; h: number }> {
  const full = await createImageBitmap(file);
  const { width: w0, height: h0 } = full;
  const s = Math.min(1, max / Math.max(w0, h0));
  if (s === 1 && file.size < 1_500_000) { full.close(); return { blob: file, w: w0, h: h0 }; }
  const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
  let bmp = full;
  if (s < 1) { bmp = await createImageBitmap(file, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" }); full.close(); }
  let blob: Blob | null = null;
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const oc = new OffscreenCanvas(w, h);
      oc.getContext("2d")!.drawImage(bmp, 0, 0);
      blob = await oc.convertToBlob({ type: "image/webp", quality: 0.86 });
    }
  } catch { blob = null; }
  if (!blob) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    cv.getContext("2d")!.drawImage(bmp, 0, 0);
    blob = await new Promise<Blob | null>((r) => cv.toBlob(r, "image/webp", 0.86));
  }
  bmp.close();
  return { blob: blob && blob.size < file.size ? blob : file, w, h };
}

/** Files that only have a ref (no bytes yet). */
export const refsOf = (files: Record<string, SceneFile> | undefined) => Object.values(files ?? {}).filter((f) => f && f.lumenAtt && !f.dataURL);

/** Bytes for ref-only files → full Excalidraw BinaryFileData entries (skips files whose bytes can't be found). */
export async function hydrateFiles(files: Record<string, SceneFile> | undefined, source: BlobSource): Promise<SceneFile[]> {
  const out = await Promise.all(refsOf(files).map(async (f) => {
    try {
      const b = await source(f.lumenAtt!);
      if (!b) return null;
      return { id: f.id, mimeType: f.mimeType || b.type, created: f.created ?? Date.now(), dataURL: await blobToDataURL(b) } as SceneFile;
    } catch { return null; }
  }));
  return out.filter((x): x is SceneFile => !!x);
}

/** Server fetch of an attachment (works on shared pages too: /api/att is public by unguessable id). */
export const serverSource = (url: (id: string) => string): BlobSource => async (id) => {
  const r = await fetch(url(id));
  return r.ok ? r.blob() : null;
};

/** A board body with every ref-only file filled with its dataURL (for .excalidraw exports). */
export async function inlineSceneFiles(body: string, source: BlobSource): Promise<string> {
  let s: { files?: Record<string, SceneFile> };
  try { s = JSON.parse(body); } catch { return body; }
  if (!refsOf(s.files).length) return body;
  const full = await hydrateFiles(s.files, source);
  const files: Record<string, SceneFile> = { ...s.files };
  for (const f of full) files[f.id] = { ...files[f.id], ...f };
  for (const f of Object.values(files)) delete f.lumenAtt;
  return JSON.stringify({ ...s, files }, null, 2);
}
