// Imports from Anki, Notion and Obsidian (docs/IMPORT.md): the shared model. Pure: no DOM, no Dexie, runs in Node tests.
//
// Every source parser turns its input into an ImportPlan: notes (with a relative folder path), attachments, flashcard
// schedules and review-log rows. The plan is previewed (tree + counts + warnings), then written by import-write.ts as one
// batch tagged with an import id, so the whole import can be undone.
import type { NoteType } from "../../shared/types";
import { fmtNum, t } from "./i18n";

export type ImportSourceKind = "anki" | "notion" | "obsidian" | "markdown";

/** A file inside a zip, a picked folder or a test fixture. `path` uses "/" and has no leading slash. */
export interface VFile {
  path: string;
  size: number;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
}

export interface PlanAttachment {
  /** Plan-local reference, used in bodies as `att:@@<ref>@@` until the writer swaps in the real attachment id. */
  ref: string;
  name: string;
  mime: string;
  size: number;
  /** Path inside the source (vaults): shown in the preview tree, where it can be unticked. */
  path?: string;
  bytes(): Promise<Uint8Array>;
}

export interface PlanNote {
  /** Unique within the plan (source path or deck id). */
  key: string;
  /** Folder path under the import target, e.g. ["Languages", "Spanish"]. */
  folder: string[];
  title: string;
  type: NoteType;
  /** Full Markdown (front matter + `# Title` + text). Attachments as `att:@@ref@@`, folders as `@@FOLDER:a/b@@`. */
  body: string;
  tags: string[];
  props: Record<string, string>;
  createdAt?: number;
  /** Preview badge: "deck", "page", "database", "row", "canvas"… */
  badge?: string;
  /** Number of flashcards in the note (Anki decks), for the preview. */
  cards?: number;
  /** Unticked in the preview by default (e.g. notes in the vault's `.trash`). */
  off?: boolean;
  /** Audio attachments in the note (Anki decks), for the preview tag. */
  audio?: number;
  /** Notion databases: what the base needs to be rebuilt with another first view (`withBaseView`). */
  baseSpec?: { folder: string; order: string[]; group?: string; date?: string };
}

/** Schedule of one flashcard, keyed by the note key and the Lumen card key (see docs/FLASHCARDS.md). */
export interface PlanCard {
  noteKey: string;
  cardKey: string;
  due: number;
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
  suspended?: 0 | 1;
  stability?: number;
  difficulty?: number;
  lastReview?: number;
  state?: "new" | "learning" | "review" | "relearning";
}
export interface PlanReview {
  noteKey: string;
  cardKey: string;
  at: number;
  grade: 0 | 1 | 2 | 3;
  state: "new" | "learning" | "review" | "relearning";
  elapsed: number;
  scheduled: number;
}

export interface ImportPlan {
  source: ImportSourceKind;
  /** Display name: file or folder name. */
  name: string;
  notes: PlanNote[];
  attachments: Map<string, PlanAttachment>;
  cards: PlanCard[];
  reviews: PlanReview[];
  warnings: string[];
  /** Folder paths (joined with "/") that must exist even if empty after deselection, e.g. database folders. */
  folders: string[];
  /** Source-specific numbers for the preview (Notion: page links converted, embeds that can't come over). */
  stats?: { pageLinks?: number; embeds?: number; embedProviders?: string[]; syncedBlocks?: number; total?: number; totalBytes?: number };
}

export const emptyPlan = (source: ImportSourceKind, name: string): ImportPlan =>
  ({ source, name, notes: [], attachments: new Map(), cards: [], reviews: [], warnings: [], folders: [] });

/** An error the dialog shows with its own layout (`code`), e.g. a Notion HTML export. `message` is already translated. */
export class ImportError extends Error {
  constructor(public code: "notion-html" | "not-anki" | "generic", message: string, public file = "") { super(message); }
}

/** Which source a dropped file list most likely is (the source step's drop zone picks it automatically). */
export function detectSource(paths: string[]): ImportSourceKind | null {
  if (!paths.length) return null;
  const p = paths.map((x) => x.replace(/\\/g, "/"));
  if (p.some((x) => /\.(apkg|colpkg)$/i.test(x) || /(^|\/)collection\.anki2[1b]?$/i.test(x))) return "anki";
  const hex = /\s[0-9a-f]{32}(\.(md|csv|html)|\/|$)/i;
  if (p.some((x) => hex.test(x))) return "notion";
  if (p.some((x) => /(^|\/)\.obsidian\//.test(x) || /\.(canvas|base)$/i.test(x))) return "obsidian";
  if (p.length === 1 && /\.zip$/i.test(p[0])) return null; // look inside (detectSourceInZip)
  if (p.some((x) => /\.(md|markdown|txt)$/i.test(x))) return p.some((x) => x.includes("/")) ? "obsidian" : "markdown";
  return null;
}
/** A zip's entries: Anki package, Notion export (Markdown or the unsupported HTML one), or a vault. */
export function detectSourceInZip(paths: string[]): ImportSourceKind | null {
  const s = detectSource(paths.filter((x) => !/\.zip$/i.test(x)));
  if (s) return s;
  if (paths.some((x) => /\.zip$/i.test(x)) || paths.some((x) => /\.html?$/i.test(x))) return "notion";
  return null;
}
/** Notion "HTML" exports have .html pages and no Markdown: Lumen needs "Markdown & CSV". */
export const isNotionHtmlExport = (paths: string[]) => !paths.some((x) => /\.(md|csv)$/i.test(x)) && paths.some((x) => /\.html?$/i.test(x));

/** `[[links]]` in a Markdown body (outside code). */
export function wikiLinks(body: string): string[] {
  const out: string[] = [];
  for (const seg of body.split(/(```[\s\S]*?```|`[^`\n]*`)/g).filter((_s, i) => i % 2 === 0)) {
    for (const m of seg.matchAll(/(?<!!)\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g)) out.push(m[1].trim());
  }
  return out;
}

/** "1.1 GB", "24.6 MB", "340 KB" (decimal units, like the OS file browsers). */
export function fmtBytes(n: number): string {
  if (n >= 1e9) return t("{size} GB", { size: fmtNum(+(n / 1e9).toFixed(1), { maximumFractionDigits: 1 }) });
  if (n >= 1e6) return t("{size} MB", { size: fmtNum(+(n / 1e6).toFixed(1), { maximumFractionDigits: 1 }) });
  if (n >= 1e3) return t("{size} KB", { size: fmtNum(Math.round(n / 1e3)) });
  return t("{size} B", { size: fmtNum(n) });
}
/** Megabytes with one decimal ("14.2"), for "14.2 of 24.6 MB". */
export const fmtMB = (n: number) => fmtNum(+(n / 1e6).toFixed(1), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export type Progress = (done: number, total: number, current: string) => void;

// ------------------------------------------------------------------ small helpers
export const DAY = 86_400_000;
export const attRef = (ref: string) => `att:@@${ref}@@`;
export const ATT_REF = /att:@@([^@\s)]+)@@/g;
export const FOLDER_REF = /@@FOLDER:([^@]*)@@/g;
export const baseName = (p: string) => p.split("/").pop() ?? p;
export const dirName = (p: string) => p.split("/").slice(0, -1).join("/");
export const extOf = (p: string) => (/\.([a-z0-9]+)$/i.exec(p)?.[1] ?? "").toLowerCase();
/** Folder/title names Lumen can store and export (no path separators or reserved characters). */
export const cleanName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || "Untitled";

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", opus: "audio/opus",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/mp4", mkv: "video/x-matroska",
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv", json: "application/json", zip: "application/zip",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export const mimeOf = (name: string) => MIME[extOf(name)] ?? "application/octet-stream";
/** Inline (image / audio / video / PDF) attachments render as `![]()`, other files as links, like attachments.ts addFile. */
export const attLink = (name: string, ref: string) => {
  const label = name.replace(/[[\]]/g, "");
  return /^(image|video|audio)\/|^application\/pdf$/.test(mimeOf(name)) ? `![${label}](${attRef(ref)})` : `[${label}](${attRef(ref)})`;
};
export const isAttachmentFile = (p: string) => !/\.(md|markdown|canvas|base|csv)$/i.test(p);

export const yieldUI = () => new Promise<void>((r) => setTimeout(r, 0));

export function vfileFromBytes(path: string, data: Uint8Array | string): VFile {
  const u8 = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return { path, size: u8.length, bytes: async () => u8, text: async () => new TextDecoder().decode(u8) };
}

/** Byte-level checks used to sniff formats. */
export const isZstd = (u: Uint8Array) => u.length > 4 && u[0] === 0x28 && u[1] === 0xb5 && u[2] === 0x2f && u[3] === 0xfd;
export const isZip = (u: Uint8Array) => u.length > 4 && u[0] === 0x50 && u[1] === 0x4b && (u[2] === 3 || u[2] === 5);

// ------------------------------------------------------------------ zip → VFiles (jszip, already a dependency)
type JSZipLike = { files: Record<string, { name: string; dir: boolean; async(t: "uint8array"): Promise<Uint8Array>; _data?: { uncompressedSize?: number } }> };
export async function zipFiles(data: Uint8Array | Blob, onProgress?: Progress): Promise<VFile[]> {
  const { default: JSZip } = await import("jszip");
  const zip = (await JSZip.loadAsync(data)) as unknown as JSZipLike;
  const entries = Object.values(zip.files).filter((e) => !e.dir && !/(^|\/)__MACOSX\//.test(e.name) && !/(^|\/)\.DS_Store$/.test(e.name));
  onProgress?.(0, entries.length, "");
  return entries.map((e) => {
    let cache: Uint8Array | null = null;
    const bytes = async () => (cache ??= await e.async("uint8array"));
    return { path: e.name.replace(/^\/+/, ""), size: e._data?.uncompressedSize ?? 0, bytes, text: async () => new TextDecoder().decode(await bytes()) };
  });
}
/** Notion wraps big exports as a zip of zips ("Export-…-Part-1.zip"): unpack nested zips into one file list. */
export async function expandNestedZips(files: VFile[], onProgress?: Progress): Promise<VFile[]> {
  const out: VFile[] = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.path)) out.push(...(await zipFiles(await f.bytes(), onProgress)));
    else out.push(f);
  }
  return out;
}

/** Files from `<input webkitdirectory>` or a multi-file pick (uses webkitRelativePath when present). */
export function filesFromList(list: File[]): VFile[] {
  return list.map((f) => {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    return { path: rel.replace(/\\/g, "/"), size: f.size, bytes: async () => new Uint8Array(await f.arrayBuffer()), text: () => f.text() };
  });
}
/** Drop the common top folder ("MyVault/…") so the tree starts at the vault root. Returns the files and the root name. */
export function stripCommonRoot(files: VFile[]): { files: VFile[]; root: string } {
  const firsts = new Set(files.map((f) => (f.path.includes("/") ? f.path.split("/")[0] : "")));
  if (firsts.size !== 1 || firsts.has("")) return { files, root: "" };
  const root = [...firsts][0];
  return { root, files: files.map((f) => ({ ...f, path: f.path.slice(root.length + 1) })) };
}

// ------------------------------------------------------------------ HTML → Markdown (Anki fields, Notion HTML bits)
const ENT: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", times: "×", divide: "÷", deg: "°", middot: "·", bull: "•", rarr: "→", larr: "←", copy: "©", reg: "®" };
export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const attr = (attrs: string, name: string) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "") : "";
};
/**
 * A small HTML → Markdown converter for flashcard fields (no DOM, so it runs in tests and workers).
 * `media(src)` maps an image / sound file name to Markdown (attachment link) or null to keep it as text.
 */
export function htmlToMd(html: string, media: (name: string, kind: "img" | "sound") => string | null = () => null): string {
  let s = html.replace(/\r\n?/g, "\n");
  // Anki sound tags and LaTeX
  s = s.replace(/\[sound:([^\]]+)\]/g, (_m, n: string) => media(n.trim(), "sound") ?? `[${n}]`);
  s = s.replace(/\[latex\]([\s\S]*?)\[\/latex\]/gi, (_m, t: string) => `$$${t.trim()}$$`).replace(/\[\$\$\]([\s\S]*?)\[\/\$\$\]/g, (_m, t: string) => `$$${t.trim()}$$`).replace(/\[\$\]([\s\S]*?)\[\/\$\]/g, (_m, t: string) => `$${t.trim()}$`);
  s = s.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  let out = "";
  const lists: { ordered: boolean; n: number }[] = [];
  const links: string[] = [];
  let pre = 0;
  const nl = () => { if (out && !out.endsWith("\n")) out += "\n"; };
  const para = () => { nl(); if (out && !out.endsWith("\n\n")) out += "\n"; };
  const re = /<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)|(<)/g;
  for (let m: RegExpExecArray | null; (m = re.exec(s));) {
    if (m[4] !== undefined || m[5] !== undefined) {
      const t = decodeEntities(m[4] ?? m[5]);
      out += pre ? t : t.replace(/[ \t]*\n[ \t]*/g, " ").replace(/[ \t]{2,}/g, " ");
      continue;
    }
    const close = !!m[1], tag = m[2].toLowerCase(), attrs = m[3] ?? "";
    switch (tag) {
      case "br": out += "\n"; break;
      case "div": case "section": case "article": case "header": case "footer": nl(); break;
      case "p": para(); break;
      case "b": case "strong": out += "**"; break;
      case "i": case "em": out += "*"; break;
      case "s": case "strike": case "del": out += "~~"; break;
      case "sub": out += "~"; break;
      case "sup": out += "^"; break;
      case "mark": out += close ? "" : ""; break;
      case "code": if (!pre) out += "`"; break;
      case "pre": if (close) { pre = Math.max(0, pre - 1); nl(); out += "```\n"; } else { nl(); out += "```\n"; pre++; } break;
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": if (close) { nl(); } else { para(); out += "#".repeat(Number(tag[1])) + " "; } break;
      case "blockquote": if (!close) { nl(); out += "> "; } else nl(); break;
      case "ul": case "ol": if (close) { lists.pop(); if (!lists.length) nl(); } else { nl(); lists.push({ ordered: tag === "ol", n: 0 }); } break;
      case "li": if (!close) { nl(); const l = lists[lists.length - 1]; const ind = "  ".repeat(Math.max(0, lists.length - 1)); out += ind + (l?.ordered ? `${++l.n}. ` : "- "); } break;
      case "tr": nl(); break;
      case "td": case "th": if (!close) out += out.endsWith("\n") || !out ? "" : " | "; break;
      case "hr": para(); out += "---\n"; break;
      case "a": if (close) { const h = links.pop(); out += h ? `](${h})` : ""; } else { const h = attr(attrs, "href"); links.push(h); if (h) out += "["; } break;
      case "img": {
        const src = attr(attrs, "src"), alt = attr(attrs, "alt");
        const md = src ? media(decodeURIComponent(src.replace(/^\.\//, "")), "img") : null;
        out += md ?? (/^https?:/i.test(src) ? `![${alt}](${src})` : alt ? `[${alt}]` : "");
        break;
      }
      default: break;
    }
  }
  // MathJax delimiters → KaTeX Markdown
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_m, t: string) => `$${t.trim()}$`).replace(/\\\[([\s\S]*?)\\\]/g, (_m, t: string) => `$$${t.trim()}$$`);
  return out.replace(/\*\*\s*\*\*/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
/** Plain text of an HTML field (sort fields, titles). */
export const htmlText = (html: string) => decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

// ------------------------------------------------------------------ protobuf (Anki 2.1.50+ metadata) — read-only, tiny
export interface PbField { no: number; wire: number; int?: number; bytes?: Uint8Array }
export function readProto(u: Uint8Array): PbField[] {
  const out: PbField[] = [];
  let i = 0;
  const varint = () => { let r = 0, mul = 1; for (;;) { const b = u[i++]; r += (b & 0x7f) * mul; if (b < 0x80) return r; mul *= 128; if (i >= u.length) return r; } };
  while (i < u.length) {
    const key = varint();
    const no = Math.floor(key / 8), wire = key & 7;
    if (wire === 0) out.push({ no, wire, int: varint() });
    else if (wire === 2) { const len = varint(); out.push({ no, wire, bytes: u.subarray(i, i + len) }); i += len; }
    else if (wire === 1) { out.push({ no, wire }); i += 8; }
    else if (wire === 5) { out.push({ no, wire }); i += 4; }
    else break; // groups (3/4) are not used by Anki
  }
  return out;
}

// ------------------------------------------------------------------ image size from the header bytes (PNG / GIF / JPEG / WebP)
export function imageSize(u: Uint8Array): { w: number; h: number } | null {
  const be32 = (o: number) => ((u[o] << 24) | (u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3]) >>> 0;
  if (u.length > 24 && u[0] === 0x89 && u[1] === 0x50) return { w: be32(16), h: be32(20) };
  if (u.length > 10 && u[0] === 0x47 && u[1] === 0x49) return { w: u[6] | (u[7] << 8), h: u[8] | (u[9] << 8) };
  if (u.length > 30 && u[0] === 0x52 && u[1] === 0x49 && u[8] === 0x57) {
    const tag = String.fromCharCode(u[12], u[13], u[14], u[15]);
    if (tag === "VP8X") return { w: 1 + (u[24] | (u[25] << 8) | (u[26] << 16)), h: 1 + (u[27] | (u[28] << 8) | (u[29] << 16)) };
    if (tag === "VP8 ") return { w: (u[26] | (u[27] << 8)) & 0x3fff, h: (u[28] | (u[29] << 8)) & 0x3fff };
    if (tag === "VP8L") { const b = u[21] | (u[22] << 8) | (u[23] << 16) | (u[24] << 24); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
  }
  if (u.length > 4 && u[0] === 0xff && u[1] === 0xd8) {
    let o = 2;
    while (o + 9 < u.length) {
      if (u[o] !== 0xff) { o++; continue; }
      const marker = u[o + 1];
      const len = (u[o + 2] << 8) | u[o + 3];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: (u[o + 5] << 8) | u[o + 6], w: (u[o + 7] << 8) | u[o + 8] };
      o += 2 + len;
    }
  }
  return null;
}

// ------------------------------------------------------------------ preview tree
export interface TreeNode {
  id: string; name: string; kind: "folder" | "note" | "file"; badge?: string; cards?: number; children: TreeNode[];
  /** Selection keys under this node: note keys, and `att:<ref>` for attachment files. */
  noteKeys: string[];
  /** A Notion page / database whose sub-pages (or rows) are this folder: the page's own note key. */
  self?: string;
  /** Totals under a folder (filled by planTree). */
  notes?: number; canvases?: number; files?: number; bytes?: number; audio?: number;
  /** Flashcards under a folder (Anki parent decks), its own page included. */
  allCards?: number;
  /** Every note under it is unticked by default (the vault's `.trash`). */
  off?: boolean;
}
/** Selection key of an attachment file in the preview tree. */
export const attKey = (ref: string) => "att:" + ref;
/**
 * Folder tree of the plan's notes (folders first, natural order, dot-folders last). Folder ids are "f:<path>", note ids
 * "n:<key>", files "a:<ref>". `files`: attachments with a source path are listed (vaults) and can be unticked.
 * `pages`: a page and the folder of its sub-pages with the same name become one node (Notion).
 */
export function planTree(plan: ImportPlan, opts: { files?: boolean; pages?: boolean } = {}): TreeNode {
  const root: TreeNode = { id: "f:", name: plan.name, kind: "folder", children: [], noteKeys: [] };
  const folders = new Map<string, TreeNode>([["", root]]);
  const ensure = (parts: string[]): TreeNode => {
    const p = parts.join("/");
    const hit = folders.get(p);
    if (hit) return hit;
    const parent = ensure(parts.slice(0, -1));
    const f: TreeNode = { id: "f:" + p, name: parts[parts.length - 1], kind: "folder", children: [], noteKeys: [] };
    parent.children.push(f);
    folders.set(p, f);
    return f;
  };
  for (const p of plan.folders) ensure(p.split("/").filter(Boolean));
  const offKeys = new Set<string>();
  for (const n of plan.notes) {
    const parent = ensure(n.folder);
    if (n.off) offKeys.add(n.key);
    parent.children.push({ id: "n:" + n.key, name: n.title, kind: "note", badge: n.badge, cards: n.cards, audio: n.audio, children: [], noteKeys: [n.key], off: n.off });
  }
  if (opts.files) {
    for (const a of plan.attachments.values()) {
      if (!a.path) continue;
      const parent = ensure(dirName(a.path).split("/").filter(Boolean).map(cleanName));
      parent.children.push({ id: "a:" + a.ref, name: a.name, kind: "file", children: [], noteKeys: [attKey(a.ref)], files: 1, bytes: a.size });
    }
  }
  if (opts.pages) {
    const fold = (t: TreeNode) => {
      for (const f of t.children.filter((c) => c.kind === "folder")) {
        const i = t.children.findIndex((c) => c.kind === "note" && c.name.toLowerCase() === f.name.toLowerCase());
        if (i >= 0) {
          const page = t.children[i];
          t.children.splice(i, 1);
          Object.assign(f, { self: page.noteKeys[0], badge: page.badge, cards: page.cards });
        }
        fold(f);
      }
    };
    fold(root);
  }
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const rank = (x: TreeNode) => (x.kind === "folder" ? (x.name.startsWith(".") ? 1 : 0) : x.kind === "note" ? 2 : 3);
  const fill = (node: TreeNode): string[] => {
    node.children.sort((a, b) => rank(a) - rank(b) || coll.compare(a.name, b.name));
    if (node.kind === "folder") {
      node.noteKeys = [...(node.self ? [node.self] : []), ...node.children.flatMap(fill)];
      const kids = node.children;
      node.notes = kids.reduce((s, c) => s + (c.kind === "note" ? 1 : c.kind === "folder" ? (c.notes ?? 0) + (c.self ? 1 : 0) : 0), 0);
      node.canvases = kids.reduce((s, c) => s + (c.kind === "note" && (c.badge === "canvas" || c.badge === "whiteboard") ? 1 : c.canvases ?? 0), 0);
      node.files = kids.reduce((s, c) => s + (c.kind === "folder" || c.kind === "file" ? c.files ?? 0 : 0), 0);
      node.bytes = kids.reduce((s, c) => s + (c.kind === "folder" || c.kind === "file" ? c.bytes ?? 0 : 0), 0);
      node.allCards = (node.self ? node.cards ?? 0 : 0) + kids.reduce((s, c) => s + (c.kind === "folder" ? c.allCards ?? 0 : c.cards ?? 0), 0);
      node.audio = kids.reduce((s, c) => s + (c.audio ?? 0), 0);
      const notes = node.noteKeys.filter((k) => !k.startsWith("att:"));
      node.off = notes.length > 0 && notes.every((k) => offKeys.has(k));
    }
    return node.noteKeys;
  };
  fill(root);
  return root;
}
