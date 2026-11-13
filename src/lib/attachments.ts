import { api, attUrl, getToken } from "./api";
import { db, save, uid } from "./db";

/** Shrink big photos so they fit D1 fallback storage and load fast on phones. */
async function compress(file: File): Promise<Blob> {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type) || file.size < 400_000) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * scale);
  cv.height = Math.round(bmp.height * scale);
  cv.getContext("2d")!.drawImage(bmp, 0, 0, cv.width, cv.height);
  const out = await new Promise<Blob | null>((r) => cv.toBlob(r, "image/webp", 0.82));
  return out && out.size < file.size ? out : file;
}

/** Store a file locally and queue its upload. Returns the Markdown to insert. */
export async function addFile(file: File): Promise<string> {
  const id = uid();
  const blob = await compress(file);
  await db.blobs.put({ id, blob, uploaded: 0 });
  await save("attachment", { id, name: file.name || "file", mime: blob.type || file.type, size: blob.size });
  const name = (file.name || "file").replace(/[[\]]/g, "");
  // Images, video, audio and PDFs render inline (players / viewer); other files become download links.
  return /^(image|video|audio)\/|^application\/pdf$/.test(blob.type) ? `![${name}](att:${id})` : `[📎 ${name}](att:${id})`;
}

export async function uploadPending() {
  if (!getToken()) return;
  for (const b of await db.blobs.where("uploaded").equals(0).toArray()) {
    await api(`/att/${b.id}`, { method: "PUT", body: b.blob, headers: { "Content-Type": b.blob.type || "application/octet-stream" } });
    await db.blobs.update(b.id, { uploaded: 1 });
  }
}

const urlCache = new Map<string, string>();
/** Local object URL if we have the bytes, else the server URL. */
export async function resolveAtt(id: string): Promise<string> {
  if (urlCache.has(id)) return urlCache.get(id)!;
  const b = await db.blobs.get(id);
  const url = b ? URL.createObjectURL(b.blob) : attUrl(id);
  urlCache.set(id, url);
  return url;
}

export async function attMime(id: string): Promise<string> {
  return (await db.attachments.get(id))?.mime ?? "";
}
