import JSZip from "jszip";
import type { Folder, Note, Space } from "../../shared/types";
import { createNote } from "./actions";
import { db, newFolder, save } from "./db";
import { render } from "./markdown";
import { splitFrontMatter, toFrontMatter } from "./parse";
import { activeTheme } from "./settings";

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 120) || "Untitled";

export function download(name: string, data: Blob | string, mime = "text/plain") {
  const blob = typeof data === "string" ? new Blob([data], { type: mime }) : data;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function noteToMarkdown(n: Note) {
  if (n.type === "canvas" || n.type === "whiteboard") return n.body;
  const fm = toFrontMatter({ title: n.title, type: n.type !== "note" ? n.type : undefined, status: n.status ?? undefined, tags: n.tags, created: new Date(n.createdAt).toISOString(), slug: n.slug || undefined, ...n.props });
  return fm + splitFrontMatter(n.body).body;
}
const fileName = (n: Note) => safe(n.title) + (n.type === "canvas" ? ".canvas" : n.type === "whiteboard" ? ".excalidraw" : ".md");

export const exportNoteMd = (n: Note) => download(fileName(n), noteToMarkdown(n), "text/markdown");

/** Standalone styled HTML (KaTeX CSS from CDN; Mermaid blocks rendered client-side by its CDN script). */
export function noteHtml(n: Note) {
  const t = activeTheme();
  const vars = Object.entries(t.vars).map(([k, v]) => `--${k}:${v}`).join(";");
  const body = render(n.body).replace(/<div class="mermaid-block"[^>]*data-src="([^"]*)"><div class="muted">Rendering diagram…<\/div><\/div>/g,
    (_m, src: string) => `<pre class="mermaid">${decodeURIComponent(src).replace(/</g, "&lt;")}</pre>`);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${n.title.replace(/</g, "&lt;")}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<style>:root{${vars}}body{background:var(--bg);color:var(--text);font:17px/1.75 Inter,system-ui,sans-serif;max-width:72ch;margin:40px auto;padding:0 20px}a{color:var(--link)}pre{background:var(--surface-2);padding:12px;border-radius:10px;overflow:auto}code{font-family:'JetBrains Mono',monospace;font-size:.9em}.code-head{display:none}table{border-collapse:collapse}td,th{border:1px solid var(--border);padding:6px 10px}.callout{border-left:3px solid var(--accent);background:var(--surface);padding:8px 14px;border-radius:8px;margin:1em 0}.callout-title{font-weight:600}img{max-width:100%}</style></head>
<body><h1>${n.title.replace(/</g, "&lt;")}</h1>${body}
<script type="module">import m from "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";m.initialize({startOnLoad:true,theme:${t.dark ? '"dark"' : '"neutral"'}});</script></body></html>`;
}
export const exportNoteHtml = (n: Note) => download(safe(n.title) + ".html", noteHtml(n), "text/html");

export function printNote(n: Note) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(noteHtml(n));
  w.document.close();
  setTimeout(() => w.print(), 900);
}

/** Vault zip: <Space>/<folder path>/<note>.md|.canvas + attachments/ */
export async function exportVaultZip() {
  const zip = new JSZip();
  const [spaces, folders, notes] = await Promise.all([db.spaces.toArray(), db.folders.toArray(), db.notes.toArray()]);
  const fmap = new Map(folders.map((f) => [f.id, f]));
  const smap = new Map(spaces.map((s) => [s.id, s]));
  const pathOf = (n: Note) => {
    const parts: string[] = [];
    for (let f = n.folderId ? fmap.get(n.folderId) : undefined; f; f = f.parentId ? fmap.get(f.parentId) : undefined) parts.unshift(safe(f.name));
    return [safe(smap.get(n.spaceId)?.name ?? "Inbox"), ...parts].join("/");
  };
  const used = new Set<string>();
  for (const n of notes.filter((x) => !x.deleted)) {
    let p = `${pathOf(n)}/${fileName(n)}`;
    for (let i = 2; used.has(p.toLowerCase()); i++) p = `${pathOf(n)}/${safe(n.title)} ${i}${n.type === "canvas" ? ".canvas" : ".md"}`;
    used.add(p.toLowerCase());
    zip.file(p, noteToMarkdown(n));
  }
  for (const b of await db.blobs.toArray()) {
    const meta = await db.attachments.get(b.id);
    zip.file(`attachments/${b.id}-${safe(meta?.name ?? "file")}`, b.blob);
  }
  download(`lumen-vault-${new Date().toISOString().slice(0, 10)}.zip`, await zip.generateAsync({ type: "blob" }));
}

/** Full JSON backup (everything except attachment bytes). */
export async function exportBackup() {
  const data = {
    app: "lumen", version: 1, at: new Date().toISOString(),
    spaces: await db.spaces.toArray(), folders: await db.folders.toArray(), notes: await db.notes.toArray(),
    versions: await db.versions.toArray(), cards: await db.cards.toArray(), sessions: await db.sessions.toArray(), attachments: await db.attachments.toArray(),
  };
  download(`lumen-backup-${data.at.slice(0, 10)}.json`, JSON.stringify(data), "application/json");
}

export interface ImportResult { notes: number; folders: number; skipped: string[] }

export async function importFiles(files: File[], spaceId: string, folderId: string | null): Promise<ImportResult> {
  const res: ImportResult = { notes: 0, folders: 0, skipped: [] };
  for (const f of files) {
    const name = f.name.toLowerCase();
    if (name.endsWith(".zip")) await importZip(f, spaceId, folderId, res);
    else if (name.endsWith(".json")) await importBackup(f, res);
    else if (/\.(md|markdown|txt)$/.test(name)) { await importMd(f.name, await f.text(), spaceId, folderId); res.notes++; }
    else if (name.endsWith(".excalidraw")) { await createNote({ type: "whiteboard", title: f.name.replace(/\.excalidraw$/i, ""), body: await f.text(), spaceId, folderId }); res.notes++; }
    else if (name.endsWith(".canvas")) { await createNote({ type: "canvas", title: f.name.replace(/\.canvas$/i, ""), body: await f.text(), spaceId, folderId }); res.notes++; }
    else res.skipped.push(f.name);
  }
  return res;
}

async function importMd(fname: string, text: string, spaceId: string, folderId: string | null) {
  const { data } = splitFrontMatter(text);
  const title = data.title || fname.replace(/\.(md|markdown|txt)$/i, "");
  const tags = (data.tags ?? "").replace(/[[\]]/g, "").split(/[,\s]+/).map((t) => t.replace(/^#/, "").toLowerCase()).filter(Boolean);
  const known = new Set(["title", "tags", "type", "status", "created", "slug"]);
  const props = Object.fromEntries(Object.entries(data).filter(([k]) => !known.has(k)));
  return createNote({
    title, body: text, spaceId, folderId, tags,
    type: (data.type as Note["type"]) || "note", status: (data.status as Note["status"]) || null,
    createdAt: data.created ? Date.parse(data.created) || Date.now() : Date.now(), slug: data.slug ?? "", props,
  });
}

async function importZip(file: File, spaceId: string, rootFolder: string | null, res: ImportResult) {
  const zip = await JSZip.loadAsync(file);
  const cache = new Map<string, string | null>([["", rootFolder]]);
  const ensure = async (dir: string): Promise<string | null> => {
    if (cache.has(dir)) return cache.get(dir)!;
    const parts = dir.split("/");
    const parent = await ensure(parts.slice(0, -1).join("/"));
    const f: Folder = newFolder({ spaceId, parentId: parent, name: parts[parts.length - 1] });
    await save("folder", f);
    res.folders++;
    cache.set(dir, f.id);
    return f.id;
  };
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || /(^|\/)\.|__MACOSX/.test(entry.name)) continue;
    const parts = entry.name.split("/");
    const base = parts.pop()!;
    if (!/\.(md|markdown|canvas|excalidraw)$/i.test(base)) { res.skipped.push(entry.name); continue; }
    const folderId = await ensure(parts.join("/"));
    const text = await entry.async("string");
    if (base.toLowerCase().endsWith(".excalidraw")) await createNote({ type: "whiteboard", title: base.replace(/\.excalidraw$/i, ""), body: text, spaceId, folderId });
    else if (base.toLowerCase().endsWith(".canvas")) await createNote({ type: "canvas", title: base.replace(/\.canvas$/i, ""), body: text, spaceId, folderId });
    else await importMd(base, text, spaceId, folderId);
    res.notes++;
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
