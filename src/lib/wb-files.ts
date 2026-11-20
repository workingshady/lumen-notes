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
