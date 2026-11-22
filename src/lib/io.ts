import type JSZip from "jszip";
import type { Folder, Note, Space } from "../../shared/types";
import { createNote, snapshot, updateNote } from "./actions";
import { attUrl } from "./api";
import { db, newFolder, save } from "./db";
import { splitFrontMatter, toFrontMatter } from "./parse";
import { isWbType } from "../../shared/types";

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 120) || "Untitled";

export function download(name: string, data: Blob | string, mime = "text/plain") {
  const blob = typeof data === "string" ? new Blob([data], { type: mime }) : data;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Tag a Board's exported scene so a re-import opens it as a Board again (`lumen*` keys are ignored by other apps). */
function withLumenType(scene: string, type: Note["type"]) {
  if (type !== "board") return scene;
  try { return JSON.stringify({ ...JSON.parse(scene), lumenType: "board" }); } catch { return scene; }
}

export function noteToMarkdown(n: Note) {
  if (n.type === "canvas" || isWbType(n.type)) return n.body;
  const fm = toFrontMatter({ title: n.title, type: n.type !== "note" ? n.type : undefined, status: n.status ?? undefined, tags: n.tags, created: new Date(n.createdAt).toISOString(), slug: n.slug || undefined, ...n.props });
  return fm + splitFrontMatter(n.body).body;
}
const fileName = (n: Note) => n.type === "diagram" ? safe(n.title.replace(/\.mermaid$/i, "")) + ".mermaid" : safe(n.title) + (n.type === "canvas" ? ".canvas" : isWbType(n.type) ? ".excalidraw" : ".md");

export const exportNoteMd = (n: Note) => download(fileName(n), noteToMarkdown(n), "text/markdown");

// JSZip and the Markdown renderer load on first use (they are only needed for import / export).
const loadZip = async () => (await import("jszip")).default;

/** Self-contained HTML of one note (lib/print-doc.ts: math, diagrams, images and fonts inline; no CDN). Uses the dialog's remembered settings. */
export async function exportNoteHtml(n: Note) {
  const [{ runExport }, { loadNoteExportPrefs }] = await Promise.all([import("./print-run"), import("./note-export")]);
  const p = loadNoteExportPrefs();
  await runExport({ format: "html", scope: { kind: "note", ids: [n.id] }, opts: p, htmlFolder: false, engine: "auto" });
}

/** Print one note now: paper theme, Paged.js page layout in a hidden frame (no pop-up window), then the print dialog. */
export async function printNote(n: Note) {
  const [{ runExport }, { loadNoteExportPrefs }] = await Promise.all([import("./print-run"), import("./note-export")]);
  const p = loadNoteExportPrefs();
  await runExport({ format: "print", scope: { kind: "note", ids: [n.id] }, opts: p, htmlFolder: false, engine: "paged" });
}

// ------------------------------------------------------------------ export

/** Where a finished export went: a file the user picked (File System Access API) or a browser download. */
export type SaveTarget = { kind: "picker"; handle: FileSystemFileHandleLike; name: string } | { kind: "download"; name: string };
/** Minimal structural type for FileSystemFileHandle (not in every TS DOM lib). */
export interface FileSystemFileHandleLike { name: string; createWritable(): Promise<{ write(d: Blob | string): Promise<void>; close(): Promise<void> }> }
type PickerWindow = Window & {
  showSaveFilePicker?: (o: { suggestedName?: string; startIn?: unknown; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandleLike>;
  showOpenFilePicker?: (o: { startIn?: unknown; multiple?: boolean }) => Promise<unknown[]>;
};
/** True when the browser lets the user choose the destination folder (Chrome/Edge desktop). */
export const canPickFolder = () => typeof window !== "undefined" && typeof (window as PickerWindow).showSaveFilePicker === "function";

/**
 * Ask where to save BEFORE the slow work (the picker needs the click's user activation).
 * Returns null when the user cancels the picker; a download target when the API is missing.
 */
export async function chooseSaveTarget(name: string, mime: string, ext: string): Promise<SaveTarget | null> {
  const w = window as PickerWindow;
  if (!w.showSaveFilePicker) return { kind: "download", name };
  try {
    const handle = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: ext === ".zip" ? "Zip archive" : "JSON", accept: { [mime]: [ext] } }] });
    return { kind: "picker", handle, name: handle.name };
  } catch (e) {
    if ((e as DOMException).name === "AbortError") return null;
    return { kind: "download", name }; // e.g. SecurityError in iframes: fall back
  }
}
async function writeTo(target: SaveTarget, blob: Blob) {
  if (target.kind === "picker") {
    const wr = await target.handle.createWritable();
    await wr.write(blob);
    await wr.close();
  } else download(target.name, blob);
}
/**
 * "Show in folder" for the web: browsers can't open the OS file manager, but the file picker can be opened
 * in the folder the export went to (startIn = the saved file's handle), which shows the file in place.
 * Returns false when that isn't possible (plain download → the browser's Downloads folder).
 */
export async function showInFolder(target: SaveTarget): Promise<boolean> {
  const w = window as PickerWindow;
  if (target.kind !== "picker" || !w.showOpenFilePicker) return false;
  try { await w.showOpenFilePicker({ startIn: target.handle, multiple: false }); } catch { /* user closed it */ }
  return true;
}

export interface ExportEstimate { notes: number; canvases: number; attachments: number; missing: number; bytes: number; spaces: number }
/** What a vault export will contain, before running it (note text + attachment sizes; zip compression ignored). */
export async function estimateVaultExport(): Promise<ExportEstimate> {
  const [notes, atts, blobs, spaces] = await Promise.all([db.notes.toArray(), db.attachments.toArray(), db.blobs.toCollection().primaryKeys(), db.spaces.toArray()]);
  const live = notes.filter((n) => !n.deleted);
  const enc = new TextEncoder();
  const local = new Set(blobs as string[]);
  const liveAtts = atts.filter((a) => !a.deleted);
  return {
    notes: live.filter((n) => n.type !== "canvas" && !isWbType(n.type)).length,
    canvases: live.filter((n) => n.type === "canvas" || isWbType(n.type)).length,
    attachments: liveAtts.length,
    missing: liveAtts.filter((a) => !local.has(a.id)).length,
    bytes: live.reduce((s, n) => s + enc.encode(noteToMarkdown(n)).length, 0) + liveAtts.reduce((s, a) => s + (a.size || 0), 0),
    spaces: spaces.filter((s) => !s.deleted).length,
  };
}

export interface ExportResult {
  file: string; bytes: number; notes: number; canvases: number; attachments: number;
  /** Attachments whose bytes aren't on this device and couldn't be fetched from the server. */
  skipped: { id: string; name: string }[];
  target: SaveTarget;
}
export interface ExportOptions {
  /** Pre-chosen destination (see chooseSaveTarget); defaults to a download. */
  target?: SaveTarget;
  onProgress?: (done: number, total: number, current: string) => void;
}

/** Bytes of an attachment: local blob, else fetched from /api/att/<id> and cached on this device. */
async function attachmentBytes(id: string): Promise<Blob | null> {
  const b = await db.blobs.get(id);
  if (b) return b.blob;
  try {
    const r = await fetch(attUrl(id));
    if (!r.ok) return null;
    const blob = await r.blob();
    await db.blobs.put({ id, blob, uploaded: 1 }); // already on the server: never re-upload
    return blob;
  } catch { return null; }
}

/** Vault zip: <Space>/<folder path>/<note>.md|.canvas + attachments/ */
export async function exportVaultZip(opts: ExportOptions = {}): Promise<ExportResult> {
  const zip = new (await loadZip())();
  const [spaces, folders, notes, atts] = await Promise.all([db.spaces.toArray(), db.folders.toArray(), db.notes.toArray(), db.attachments.toArray()]);
  const fmap = new Map(folders.map((f) => [f.id, f]));
  const smap = new Map(spaces.map((s) => [s.id, s]));
  const pathOf = (n: Note) => {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (let f = n.folderId ? fmap.get(n.folderId) : undefined; f && !seen.has(f.id); f = f.parentId ? fmap.get(f.parentId) : undefined) { seen.add(f.id); parts.unshift(safe(f.name)); }
    return [safe(smap.get(n.spaceId)?.name ?? "Inbox"), ...parts].join("/");
  };
  const live = notes.filter((x) => !x.deleted);
  const liveAtts = atts.filter((a) => !a.deleted);
  const total = live.length + liveAtts.length;
  let done = 0;
  const used = new Set<string>();
  for (const n of live) {
    let p = `${pathOf(n)}/${fileName(n)}`;
    for (let i = 2; used.has(p.toLowerCase()); i++) p = `${pathOf(n)}/${safe(n.title.replace(/\.mermaid$/i, ""))} ${i}${n.type === "canvas" ? ".canvas" : isWbType(n.type) ? ".excalidraw" : n.type === "diagram" ? ".mermaid" : ".md"}`;
    used.add(p.toLowerCase());
    // Whiteboards keep images as attachment refs; the exported .excalidraw gets them inlined so it opens anywhere.
    // A Board is an .excalidraw scene too; `lumenType` lets a re-import restore the Board type (other apps ignore it).
    zip.file(p, isWbType(n.type) ? withLumenType(await (await import("./wb-files")).inlineSceneFiles(n.body, attachmentBytes), n.type) : noteToMarkdown(n));
    opts.onProgress?.(++done, total, p);
  }
  const skipped: ExportResult["skipped"] = [];
  let attachments = 0;
  for (const a of liveAtts) {
    const name = `attachments/${a.id}-${safe(a.name ?? "file")}`;
    opts.onProgress?.(done, total, name);
    const blob = await attachmentBytes(a.id);
    if (blob) { zip.file(name, blob); attachments++; } else skipped.push({ id: a.id, name: a.name ?? "file" });
    opts.onProgress?.(++done, total, name);
  }
  const out = await zip.generateAsync({ type: "blob" });
  const file = `lumen-vault-${new Date().toISOString().slice(0, 10)}.zip`;
  const target = opts.target ?? { kind: "download", name: file };
  await writeTo(target, out);
  return {
    file: target.name, bytes: out.size, attachments, skipped, target,
    notes: live.filter((n) => n.type !== "canvas" && !isWbType(n.type)).length,
    canvases: live.filter((n) => n.type === "canvas" || isWbType(n.type)).length,
  };
}

/** Fetch attachments that weren't on this device (the export's "fetch & retry"). Returns the ids still missing. */
export async function fetchMissingAttachments(ids: string[], onProgress?: (done: number, total: number, current: string) => void): Promise<string[]> {
  const still: string[] = [];
  for (const [i, id] of ids.entries()) {
    onProgress?.(i, ids.length, id);
    if (!(await attachmentBytes(id))) still.push(id);
  }
  onProgress?.(ids.length, ids.length, "");
  return still;
}

/** Full JSON backup (everything except attachment bytes). */
export async function exportBackup(opts: ExportOptions = {}): Promise<ExportResult> {
  const data = {
    app: "lumen", version: 1, at: new Date().toISOString(),
    spaces: await db.spaces.toArray(), folders: await db.folders.toArray(), notes: await db.notes.toArray(),
    versions: await db.versions.toArray(), cards: await db.cards.toArray(), sessions: await db.sessions.toArray(), attachments: await db.attachments.toArray(),
  };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const file = `lumen-backup-${data.at.slice(0, 10)}.json`;
  const target = opts.target ?? { kind: "download", name: file };
  await writeTo(target, blob);
  const live = data.notes.filter((n) => !n.deleted);
  return {
    file: target.name, bytes: blob.size, skipped: [], target, attachments: data.attachments.filter((a) => !a.deleted).length,
    notes: live.filter((n) => n.type !== "canvas" && !isWbType(n.type)).length,
    canvases: live.filter((n) => n.type === "canvas" || isWbType(n.type)).length,
  };
}

// ------------------------------------------------------------------ import

export interface ImportResult { notes: number; folders: number; skipped: string[]; /** Duplicates handled per the chosen policy. */ duplicates?: number; replaced?: number; cancelled?: boolean }
/**
 * Duplicate = an existing note with the same title in the same space + folder.
 * skip: keep the existing note, ignore the file · rename: keep both ("Title 2") · overwrite: replace the
 * existing note's body, after saving its current text as a version (nothing is lost).
 */
export type DuplicatePolicy = "skip" | "rename" | "overwrite";
export interface ImportOptions {
  onProgress?: (done: number, total: number, current: string) => void;
  duplicates?: DuplicatePolicy;
  /** Tag renames applied to imported notes, e.g. { "ml": "machine-learning" } (front-matter and inline #tags). */
  tagMap?: Record<string, string>;
  signal?: AbortSignal;
}
type Ctx = { spaceId: string; res: ImportResult; o: ImportOptions; done: number; total: number; existing: Map<string, Note>; /** Overwrites run outside the batch transaction (updateNote does follow-up async work). */ later: (() => Promise<void>)[] };
const dupKey = (spaceId: string, folderId: string | null, title: string) => `${spaceId}|${folderId ?? ""}|${title.trim().toLowerCase()}`;

/** Count importable items up-front so progress is real (files, not a spinner). */
async function countItems(files: File[], zips: Map<File, JSZip>) {
  let n = 0;
  for (const f of files) {
    const name = f.name.toLowerCase();
    if (name.endsWith(".zip")) {
      const z = await (await loadZip()).loadAsync(f);
      zips.set(f, z);
      n += Object.values(z.files).filter((e) => !e.dir && !/(^|\/)\.|__MACOSX/.test(e.name)).length;
    } else n++;
  }
  return n;
}

export async function importFiles(files: File[], spaceId: string, folderId: string | null, opts: ImportOptions = {}): Promise<ImportResult> {
  const res: ImportResult = { notes: 0, folders: 0, skipped: [], duplicates: 0, replaced: 0 };
  const zips = new Map<File, JSZip>();
  const total = await countItems(files, zips);
  const existing = new Map<string, Note>();
  for (const n of await db.notes.where("spaceId").equals(spaceId).toArray()) if (!n.deleted) existing.set(dupKey(n.spaceId, n.folderId, n.title), n);
  const ctx: Ctx = { spaceId, res, o: opts, done: 0, total, existing, later: [] };
  opts.onProgress?.(0, total, files[0]?.name ?? "");
  for (const f of files) {
    if (opts.signal?.aborted) { res.cancelled = true; break; }
    const name = f.name.toLowerCase();
    if (name.endsWith(".zip")) { await importZip(zips.get(f)!, folderId, ctx); continue; }
    if (name.endsWith(".json")) await importBackup(f, res);
    else if (/\.(md|markdown|txt)$/.test(name)) await importOne(ctx, f.name, await f.text(), folderId);
    else if (/\.(excalidraw|canvas|mermaid|mmd)$/.test(name)) await importOne(ctx, f.name, await f.text(), folderId);
    else res.skipped.push(f.name);
    for (const fn of ctx.later.splice(0)) await fn();
    opts.onProgress?.(++ctx.done, total, f.name);
  }
  if (opts.signal?.aborted) res.cancelled = true;
  return res;
}

function mapTags(text: string, map?: Record<string, string>) {
  if (!map || !Object.keys(map).length) return text;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  let out = text;
  for (const [from, to] of Object.entries(map)) {
    const f = from.replace(/^#/, ""), t = to.replace(/^#/, "");
    if (!f || !t) continue;
    out = out.replace(new RegExp(`(^|\\s)#${esc(f)}(?![\\p{L}\\p{N}_/-])`, "giu"), `$1#${t}`);
    // front-matter list: tags: [a, b]
    out = out.replace(/^(---\r?\n[\s\S]*?^tags:\s*)(.*)$/m, (_m, head: string, list: string) =>
      head + list.replace(new RegExp(`(^|[\\[,\\s])#?${esc(f)}(?=$|[\\],\\s])`, "giu"), `$1${t}`));
  }
  return out;
}

/** One file (Markdown / canvas / whiteboard) into a folder, honouring the duplicate policy. */
async function importOne(ctx: Ctx, fname: string, raw: string, folderId: string | null) {
  const { spaceId, res, o } = ctx;
  const lower = fname.toLowerCase();
  const kind = lower.endsWith(".excalidraw") ? (/"lumenType"\s*:\s*"board"/.test(raw) ? "board" : "whiteboard") : lower.endsWith(".canvas") ? "canvas" : /\.(mermaid|mmd)$/.test(lower) ? "diagram" : "md";
  // .mermaid / .mmd files become diagram files (note type "diagram", title "<name>.mermaid", body = the raw Mermaid text).
  const text = kind === "md" ? mapTags(raw, o.tagMap) : kind === "diagram" ? raw.replace(/^\s*```mermaid[^\n]*\n|\n?```\s*$/g, "").trim() + "\n" : raw;
  let title = kind === "md" ? splitFrontMatter(text).data.title || fname.replace(/\.(md|markdown|txt)$/i, "") : kind === "diagram" ? fname.replace(/\.(mermaid|mmd)$/i, "") + ".mermaid" : fname.replace(/\.(excalidraw|canvas)$/i, "");
  const dup = ctx.existing.get(dupKey(spaceId, folderId, title));
  if (dup) {
    res.duplicates = (res.duplicates ?? 0) + 1;
    const policy = o.duplicates ?? "rename";
    if (policy === "skip") { res.skipped.push(fname); return; }
    if (policy === "overwrite") {
      ctx.later.push(async () => { await snapshot(dup, "Before import"); await updateNote(dup.id, { body: text }); });
      res.replaced = (res.replaced ?? 0) + 1;
      return;
    }
    title = nextFree(ctx, spaceId, folderId, title);
  }
  const n = kind === "md" ? await importMd(title, text, spaceId, folderId) : await createNote({ type: kind, title, body: text, spaceId, folderId, ...(kind === "diagram" ? { tags: ["diagram"] } : {}) });
  ctx.existing.set(dupKey(spaceId, folderId, n.title), n);
  res.notes++;
}
function nextFree(ctx: Ctx, spaceId: string, folderId: string | null, title: string) {
  const base = title;
  let i = 2;
  while (ctx.existing.has(dupKey(spaceId, folderId, `${base} ${i}`))) i++;
  return `${base} ${i}`;
}

async function importMd(title: string, text: string, spaceId: string, folderId: string | null) {
  const { data } = splitFrontMatter(text);
  const tags = (data.tags ?? "").replace(/[[\]]/g, "").split(/[,\s]+/).map((t) => t.replace(/^#/, "").toLowerCase()).filter(Boolean);
  const known = new Set(["title", "tags", "type", "status", "created", "slug"]);
  const props = Object.fromEntries(Object.entries(data).filter(([k]) => !known.has(k)));
  return createNote({
    title, body: text, spaceId, folderId, tags,
    type: (data.type as Note["type"]) || "note", status: (data.status as Note["status"]) || null,
    createdAt: data.created ? Date.parse(data.created) || Date.now() : Date.now(), slug: data.slug ?? "", props,
  });
}

async function importZip(zip: JSZip, rootFolder: string | null, ctx: Ctx) {
  const { spaceId, res, o } = ctx;
  // Reuse folders that already exist (same name under the same parent), so re-imports land in place.
  const have = (await db.folders.where("spaceId").equals(spaceId).toArray()).filter((f) => !f.deleted);
  const cache = new Map<string, string | null>([["", rootFolder]]);
  const ensure = async (dir: string): Promise<string | null> => {
    if (cache.has(dir)) return cache.get(dir)!;
    const parts = dir.split("/");
    const parent = await ensure(parts.slice(0, -1).join("/"));
    const name = parts[parts.length - 1];
    let f: Folder | undefined = have.find((x) => x.parentId === parent && x.name.toLowerCase() === name.toLowerCase());
    if (!f) {
      f = newFolder({ spaceId, parentId: parent, name });
      await save("folder", f);
      have.push(f);
      res.folders++;
    }
    cache.set(dir, f.id);
    return f.id;
  };
  const entries = Object.values(zip.files).filter((e) => !e.dir && !/(^|\/)\.|__MACOSX/.test(e.name));
  // Batches of 20 notes per IndexedDB transaction: one UI refresh per batch instead of per note.
  for (let i = 0; i < entries.length; i += 20) {
    if (o.signal?.aborted) { res.cancelled = true; return; }
    const batch = entries.slice(i, i + 20);
    o.onProgress?.(ctx.done, ctx.total, batch[0].name);
    // Read the bytes first: awaiting non-IndexedDB work inside a transaction would commit it early.
    const texts = await Promise.all(batch.map((e) => (/\.(md|markdown|canvas|excalidraw|mermaid|mmd)$/i.test(e.name) ? e.async("string") : Promise.resolve(null))));
    await db.transaction("rw", [db.notes, db.folders, db.versions], async () => {
      for (const [k, entry] of batch.entries()) {
        const parts = entry.name.split("/");
        const base = parts.pop()!;
        const text = texts[k];
        if (text === null) res.skipped.push(entry.name);
        else await importOne(ctx, base, text, await ensure(parts.join("/")));
      }
    });
    for (const f of ctx.later.splice(0)) await f();
    ctx.done += batch.length;
    o.onProgress?.(ctx.done, ctx.total, batch[batch.length - 1].name);
    await new Promise((r) => setTimeout(r, 0)); // let the progress bar paint
  }
}

async function importBackup(file: File, res: ImportResult) {
  const data = JSON.parse(await file.text()) as { app?: string; spaces?: Space[]; folders?: Folder[]; notes?: Note[]; [k: string]: unknown };
  if (data.app !== "lumen") { res.skipped.push(file.name); return; }
  const kinds = [["spaces", "space"], ["folders", "folder"], ["notes", "note"], ["versions", "version"], ["cards", "card"], ["sessions", "session"], ["attachments", "attachment"]] as const;
  for (const [key, kind] of kinds) {
    for (const r of (data[key] as { id: string }[] | undefined) ?? []) {
      await save(kind, r);
      if (kind === "note") res.notes++;
      if (kind === "folder") res.folders++;
    }
  }
}
