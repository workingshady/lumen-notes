// Browser side of imports (docs/IMPORT.md): the Dexie-backed ImportStore (all writes through save()), the lazily loaded
// decoders for Anki (sql.js SQLite WASM served from the app bundle, fzstd), and `readSource` which turns picked files into
// a parsed source ready for the preview.
import type { Kind } from "../../shared/types";
import { db, getMeta, save, setMeta, TABLE, uid } from "./db";
import type { AnkiCollection, AnkiDeps } from "./import-anki";
import { expandNestedZips, filesFromList, isZip, zipFiles, type ImportSourceKind, type Progress, type VFile } from "./import-model";
import type { ImportRecord, ImportStore } from "./import-write";

const REGISTRY = "imports";

export const dexieStore: ImportStore = {
  notesIn: (spaceId) => db.notes.where("spaceId").equals(spaceId).toArray(),
  foldersIn: (spaceId) => db.folders.where("spaceId").equals(spaceId).toArray(),
  get: (kind, id) => TABLE[kind].get(id),
  put: async (kind, rec) => { await save(kind, rec); },
  putBlob: async (id, bytes, mime) => { await db.blobs.put({ id, blob: new Blob([bytes as BlobPart], { type: mime }), uploaded: 0 }); },
  deleteBlob: async (id) => { await db.blobs.delete(id); },
  tagged: (kind: Kind, importId) => TABLE[kind].filter((r: { lumenImport?: string }) => r.lumenImport === importId).toArray(),
  batch: (fn) => db.transaction("rw", [db.notes, db.folders, db.cards, db.reviews, db.attachments], fn),
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

export type ParsedSource =
  | { kind: "anki"; name: string; col: AnkiCollection }
  | { kind: "notion" | "obsidian" | "markdown"; name: string; files: VFile[] };

/** Read picked files for a source (zip, apkg, folder). Throws with a readable message on a wrong file. */
export async function readSource(kind: ImportSourceKind, list: File[], onProgress?: Progress): Promise<ParsedSource> {
  if (!list.length) throw new Error("No files");
  const first = list[0];
  const rel = (first as File & { webkitRelativePath?: string }).webkitRelativePath;
  const name = rel ? rel.split("/")[0] : list.length === 1 ? first.name : `${list.length} files`;
  if (kind === "anki") {
    const bytes = new Uint8Array(await first.arrayBuffer());
    if (!isZip(bytes)) throw new Error("This isn't an Anki package (.apkg / .colpkg).");
    const [{ readAnki }, deps] = await Promise.all([import("./import-anki"), loadAnkiDeps()]);
    return { kind, name: first.name, col: await readAnki(bytes, first.name, deps, onProgress) };
  }
  let files: VFile[] = [];
  for (const f of list) {
    if (/\.zip$/i.test(f.name) && !(f as File & { webkitRelativePath?: string }).webkitRelativePath) files.push(...(await zipFiles(f, onProgress)));
    else files.push(...filesFromList([f]));
  }
  if (kind === "notion") files = await expandNestedZips(files, onProgress);
  return { kind, name, files };
}
