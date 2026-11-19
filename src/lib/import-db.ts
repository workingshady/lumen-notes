// Browser side of imports (docs/IMPORT.md): the Dexie-backed ImportStore (all writes through save()), the lazily loaded
// decoders for Anki (sql.js SQLite WASM served from the app bundle, fzstd), and `readSource` which turns picked files into
// a parsed source ready for the preview.
import type { Kind } from "../../shared/types";
import { db, getMeta, save, setMeta, TABLE, uid } from "./db";
import type { AnkiCollection, AnkiDeps } from "./import-anki";
import { t } from "./i18n";
import { detectSource, detectSourceInZip, expandNestedZips, filesFromList, ImportError, isZip, zipFiles, type ImportSourceKind, type VFile } from "./import-model";
import type { ImportRecord, ImportStore } from "./import-write";

const REGISTRY = "imports";

export const dexieStore: ImportStore = {
  notesIn: (spaceId) => db.notes.where("spaceId").equals(spaceId).toArray(),
  allNotes: () => db.notes.filter((n) => !n.deleted).toArray(),
  foldersIn: (spaceId) => db.folders.where("spaceId").equals(spaceId).toArray(),
  get: (kind, id) => TABLE[kind].get(id),
  put: async (kind, rec) => { await save(kind, rec); },
  putBlob: async (id, bytes, mime) => { await db.blobs.put({ id, blob: new Blob([bytes as BlobPart], { type: mime }), uploaded: 0 }); },
  deleteBlob: async (id) => { await db.blobs.delete(id); },
  tagged: (kind: Kind, importId) => TABLE[kind].filter((r: { lumenImport?: string }) => r.lumenImport === importId).toArray(),
  batch: (fn) => db.transaction("rw", [db.spaces, db.notes, db.folders, db.cards, db.reviews, db.attachments], fn),
  registry: () => getMeta<ImportRecord[]>(REGISTRY, []),
  setRegistry: async (r) => { await setMeta(REGISTRY, r); },
  uid,
};

let ankiDeps: Promise<AnkiDeps> | null = null;
/** sql.js (WASM, ~690 KB, bundled by Vite) + fzstd, loaded only when an Anki file is imported. */
export function loadAnkiDeps(): Promise<AnkiDeps> {
  return (ankiDeps ??= (async () => {
    const [{ default: initSqlJs }, { default: wasmUrl }, fzstd] = await Promise.all([
      import("sql.js"), import("sql.js/dist/sql-wasm-browser.wasm?url"), import("fzstd"),
    ]);
    const SQL = await initSqlJs({ locateFile: () => wasmUrl } as unknown as Parameters<typeof initSqlJs>[0]);
    return { openDb: (bytes: Uint8Array) => new SQL.Database(bytes), zstd: (b: Uint8Array) => fzstd.decompress(b) };
  })().catch((e) => { ankiDeps = null; throw e; }));
}

export type ParsedSource = ({ kind: "anki"; col: AnkiCollection } | { kind: "notion" | "obsidian" | "markdown"; files: VFile[] }) & {
  /** File or folder name ("vault.zip", "MyVault", "48 files"). */
  name: string;
  /** Bytes read from disk. */
  bytes: number;
};
/** Reading progress in bytes (the reading step shows "58% · 14.2 of 24.6 MB"). */
export type ByteProgress = (done: number, total: number) => void;

const relPath = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || "";

/** A File's bytes, streamed so the reading step can show real progress. */
async function readBytes(f: File, onBytes: (n: number) => void): Promise<Uint8Array> {
  if (typeof f.stream !== "function") { const u = new Uint8Array(await f.arrayBuffer()); onBytes(u.length); return u; }
  const out = new Uint8Array(f.size);
  let o = 0;
  const r = f.stream().getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    if (o + value.length > out.length) { const u = new Uint8Array(await f.arrayBuffer()); onBytes(u.length); return u; }
    out.set(value, o);
    o += value.length;
    onBytes(o);
  }
  return o === out.length ? out : out.subarray(0, o);
}

/** Display name of a pick: the folder, the single file, or "N files". */
export function pickName(list: File[]): string {
  const rel = relPath(list[0]);
  return rel ? rel.split("/")[0] : list.length === 1 ? list[0].name : t("{n} file|{n} files", { n: list.length });
}

/**
 * Read picked or dropped files (zip, apkg, folder) for a source; `"auto"` detects the source (drop zone of the source
 * step). Throws an ImportError / Error with a translated message on a wrong file.
 */
export async function readSource(kind: ImportSourceKind | "auto", list: File[], onProgress?: ByteProgress): Promise<ParsedSource> {
  if (!list.length) throw new Error(t("No files"));
  const name = pickName(list);
  const total = list.reduce((s, f) => s + f.size, 0);
  let done = 0;
  const report = () => onProgress?.(Math.min(done, total), total);
  onProgress?.(0, total);
  // single archive: read it with progress, then look inside
  const one = list.length === 1 && !relPath(list[0]) ? list[0] : null;
  let zipped: Uint8Array | null = null;
  if (one && (kind === "anki" || /\.(zip|apkg|colpkg)$/i.test(one.name) || kind === "auto")) {
    zipped = await readBytes(one, (n) => { done = n; report(); });
    if (!isZip(zipped)) {
      if (kind === "anki" || /\.(apkg|colpkg)$/i.test(one.name)) throw new ImportError("not-anki", ANKI_NOT_PKG(), one.name);
      zipped = null;
    }
  }
  if (kind === "auto") {
    if (zipped) {
      const { default: JSZip } = await import("jszip");
      const paths = Object.keys((await JSZip.loadAsync(zipped)).files);
      kind = /\.(apkg|colpkg)$/i.test(one!.name) ? "anki" : detectSourceInZip(paths) ?? "obsidian";
    } else kind = detectSource(list.map((f) => relPath(f) || f.name)) ?? "markdown";
  }
  if (kind === "anki") {
    if (!zipped) throw new ImportError("not-anki", ANKI_NOT_PKG(), list[0].name);
    const [{ readAnki }, deps] = await Promise.all([import("./import-anki"), loadAnkiDeps()]);
    return { kind, name: list[0].name, bytes: total, col: await readAnki(zipped, list[0].name, deps) };
  }
  let files: VFile[] = [];
  if (zipped) files = await zipFiles(zipped);
  else {
    for (const f of list) {
      if (/\.zip$/i.test(f.name) && !relPath(f)) { files.push(...(await zipFiles(await readBytes(f, (n) => { onProgress?.(done + n, total); })))); done += f.size; report(); }
      else {
        // folder files are read lazily by the parsers: count their bytes as they are read
        const [v] = filesFromList([f]);
        let counted = false;
        const count = () => { if (!counted) { counted = true; done += f.size; report(); } };
        files.push({ ...v, bytes: async () => { const b = await v.bytes(); count(); return b; }, text: async () => { const s = await v.text(); count(); return s; } });
      }
    }
  }
  if (kind === "notion") files = await expandNestedZips(files);
  return { kind, name, bytes: total, files };
}
const ANKI_NOT_PKG = () => t("This isn't an Anki package (.apkg / .colpkg).");
