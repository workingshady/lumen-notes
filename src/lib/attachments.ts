import { api, attUrl, getToken } from "./api";
import { db, save, uid } from "./db";
import { t } from "./i18n";

/** Shrink big photos so they fit D1 fallback storage and load fast on phones. */
async function compress(file: Blob): Promise<Blob> {
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
  if (file.size > MAX_FILE) throw new Error(t("{name} is over 100 MB. Upload long videos to YouTube (unlisted) and paste the link.", { name: file.name }));
  const id = uid();
  const blob = await compress(file);
  await db.blobs.put({ id, blob, uploaded: 0 });
  await save("attachment", { id, name: file.name || "file", mime: blob.type || file.type, size: blob.size });
  const name = (file.name || "file").replace(/[[\]]/g, "");
  // Images, video, audio and PDFs render inline (players / viewer); other files become download links.
  return /^(image|video|audio)\/|^application\/pdf$/.test(blob.type) ? `![${name}](att:${id})` : `[${name}](att:${id})`;
}

/** Store bytes as an attachment (big photos shrunk; GIF/video/SVG kept as is); the next sync uploads it. Returns the attachment id. */
export async function storeBlob(blob: Blob, name: string): Promise<{ id: string; blob: Blob }> {
  if (blob.size > MAX_FILE) throw new Error(t("{name} is over 100 MB. Upload long videos to YouTube (unlisted) and paste the link.", { name }));
  const id = uid();
  const out = await compress(blob);
  await db.blobs.put({ id, blob: out, uploaded: 0 });
  await save("attachment", { id, name: name || "file", mime: out.type || blob.type, size: out.size });
  return { id, blob: out };
}

/** Attachment bytes: this device first, else the server (cached locally, never re-uploaded). */
export async function attBlob(id: string): Promise<Blob | null> {
  const b = await db.blobs.get(id);
  if (b) return b.blob;
  try {
    const r = await fetch(attUrl(id));
    if (!r.ok) return null;
    const blob = await r.blob();
    await db.blobs.put({ id, blob, uploaded: 1 });
    return blob;
  } catch { return null; }
}

const CHUNK = 1_500_000; // must match worker CHUNK
export const MAX_FILE = 100 * 1024 * 1024;

/** Upload queued files in 1.5 MB parts (free-tier D1 storage; idempotent, so a retry just re-sends). */
/** Settings › Sync (round 6): "Sync files" Always / On Wi-Fi / On open and "Sync on mobile data". Notes always sync. */
export function filesMayUpload(opening = false): boolean {
  let x: { syncMobile?: boolean; syncFiles?: "always" | "wifi" | "open" } = {};
  try { x = JSON.parse(localStorage.getItem("lumen.settings") ?? "{}"); } catch { /* defaults */ }
  const mode = x.syncFiles ?? "wifi";
  if (mode === "open" && !opening) return false;
  const conn = (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection;
  const cellular = conn?.type === "cellular" || !!conn?.saveData;
  if (cellular && (mode === "wifi" || !x.syncMobile)) return false;
  return true;
}
/**
 * Storage almost full (Lumen 22 §5): uploads pause at 98 % of the Cloudflare limit (4.9 of 5 GB); files stay queued on
 * this device and go up once there is room again. Notes keep syncing (they are small). Usage is re-read every 10 min.
 */
let usage: { at: number; room: number } | null = null;
let paused = false;
export const uploadsPaused = () => paused;
async function storageRoom(): Promise<number> {
  if (usage && Date.now() - usage.at < 600_000) return usage.room;
  try {
    const u = await api<{ limitBytes: number; records: { bytes: number }; files: { bytes: number }; r2: { bytes: number } | null }>("/usage");
    usage = { at: Date.now(), room: u.limitBytes * 0.98 - (u.records.bytes + u.files.bytes + (u.r2?.bytes ?? 0)) };
  } catch { usage = { at: Date.now(), room: Infinity }; }
  return usage.room;
}
export async function uploadPending(opening = false) {
  if (!getToken()) return;
  if (!filesMayUpload(opening)) return;
  const queued = await db.blobs.where("uploaded").equals(0).toArray();
  let room = queued.length ? await storageRoom() : Infinity;
  paused = false;
  for (const b of queued) {
    const size = b.blob.size;
    if (size > room) { paused = true; continue; }
    room -= size;
    if (usage) usage.room = room;
    const parts = Math.max(1, Math.ceil(size / CHUNK));
    const mime = b.blob.type || "application/octet-stream";
    for (let i = 0; i < parts; i++) {
      await api(`/att/${b.id}?part=${i}&parts=${parts}&size=${size}`, { method: "PUT", body: b.blob.slice(i * CHUNK, (i + 1) * CHUNK), headers: { "Content-Type": mime } });
    }
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
