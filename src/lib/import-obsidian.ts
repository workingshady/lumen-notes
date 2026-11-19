// Obsidian vault (folder or .zip) and plain Markdown files/folders import (docs/IMPORT.md). Pure: works on a VFile list.
//
// Notes keep their folders, [[links]], tags and front matter (block lists are rewritten as flow lists, which is what
// Lumen's front-matter reader understands). Attachments referenced by `![[file.png]]`, `![[file.png|300]]` or relative
// Markdown paths become Lumen attachments; links to notes written as Markdown paths become [[Title]]. `.canvas` (JSON
// Canvas, native) and `.base` (Obsidian Bases, native) files come over as they are; `.excalidraw.md` drawings with a
// plain ```json scene become whiteboards. A `# Title` H1 is added where the note has none (Lumen's title = first H1).
import {
  attLink, attRef, baseName, cleanName, dirName, emptyPlan, extOf, isAttachmentFile, mimeOf, stripCommonRoot, yieldUI,
  type ImportPlan, type ImportSourceKind, type PlanNote, type Progress, type VFile,
} from "./import-model";
import { t } from "./i18n";

export const OBSIDIAN_TEXT = {
  compressedDrawing: (n: number) => t("{n} Excalidraw drawing is compressed; imported as a Markdown note (turn off “Compress Excalidraw JSON” in the plugin and export again to get a whiteboard).|{n} Excalidraw drawings are compressed; imported as Markdown notes (turn off “Compress Excalidraw JSON” in the plugin and export again to get whiteboards).", { n }),
  unreferenced: (n: number) => t("{n} file in the vault isn't linked from any note and was left out.|{n} files in the vault aren't linked from any note and were left out.", { n }),
  missing: (n: number) => t("{n} embedded file was not found in the vault; the link stays as it is.|{n} embedded files were not found in the vault; the links stay as they are.", { n }),
  canvasFiles: (n: number) => t("{n} canvas card points to a vault file; it shows as a file card.|{n} canvas cards point to a vault file; they show as file cards.", { n }),
  nothing: () => t("No Markdown, canvas or base files found."),
};

/** Front matter with YAML block lists (`tags:\n  - a`) → flow lists (`tags: [a, b]`); `tag:`/`aliases` kept. */
export function normalizeFrontMatter(md: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(md);
  if (!m) return md;
  const lines = m[1].split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const k = /^([^\s:#][^:]*):\s*$/.exec(l);
    if (k && /^\s*-\s+/.test(lines[i + 1] ?? "")) {
      const items: string[] = [];
      while (/^\s*-\s+/.test(lines[i + 1] ?? "")) items.push(lines[++i].replace(/^\s*-\s+/, "").trim().replace(/^["']|["']$/g, ""));
      out.push(`${k[1]}: [${items.join(", ")}]`);
    } else out.push(l);
  }
  // Obsidian allows `tags: a, b` and `tags: a b`; Lumen reads lists — normalise tags to a list.
  const fixed = out.map((l) => { const t = /^tags?:\s*([^[\s].*)$/.exec(l); return t ? `tags: [${t[1].split(/[,\s]+/).filter(Boolean).map((x) => x.replace(/^#/, "")).join(", ")}]` : l; });
  return `---\n${fixed.join("\n")}\n---\n` + md.slice(m[0].length);
}

/** Insert `# Title` after the front matter unless the first line already is that H1. */
export function ensureH1(md: string, title: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/.exec(md);
  const head = m ? m[0].replace(/\r?\n?$/, "\n") : "";
  const rest = (m ? md.slice(m[0].length) : md).replace(/^\s*\n/, "");
  const first = rest.split("\n").find((l) => l.trim()) ?? "";
  if (/^#\s+/.test(first) && first.replace(/^#\s+/, "").trim().toLowerCase() === title.toLowerCase()) return head + rest;
  return `${head}# ${title}\n\n${rest}`;
}

/** Dot-folders (`.obsidian`, `.git`) are skipped, except the vault's `.trash`, which is listed unticked. */
const skip = (p: string) => p.split("/").some((s, i) => (s.startsWith(".") && !(i === 0 && s === ".trash")) || s === "__MACOSX" || s === "node_modules");
const inTrash = (p: string) => p.startsWith(".trash/");

export async function obsidianPlan(input: VFile[], name: string, onProgress?: Progress, source: ImportSourceKind = "obsidian"): Promise<ImportPlan> {
  const { files: all, root } = stripCommonRoot(input);
  const files = all.filter((f) => !skip(f.path));
  const plan = emptyPlan(source, root || name.replace(/\.zip$/i, ""));
  const notes = files.filter((f) => /\.(md|markdown|txt|canvas|base)$/i.test(f.path));
  if (!notes.length) throw new Error(OBSIDIAN_TEXT.nothing());
  const atts = files.filter((f) => isAttachmentFile(f.path) && !/\.(markdown|txt)$/i.test(f.path));
  const byFull = new Map(atts.map((f) => [f.path.toLowerCase(), f]));
  const byBase = new Map<string, VFile>();
  for (const f of atts) { const b = baseName(f.path).toLowerCase(); if (!byBase.has(b)) byBase.set(b, f); }
  const noteTitles = new Map(notes.map((f) => [f.path.toLowerCase(), cleanName(baseName(f.path).replace(/\.(md|markdown|txt|canvas|base)$/i, ""))]));
  const counts = { compressed: 0, missing: 0, canvasFiles: 0 };
  const refOf = new Map<string, string>();
  const attach = (f: VFile) => {
    let ref = refOf.get(f.path);
    if (!ref) {
      ref = `o${refOf.size}`;
      refOf.set(f.path, ref);
      plan.attachments.set(ref, { ref, name: baseName(f.path), mime: mimeOf(f.path), size: f.size, path: f.path, bytes: () => f.bytes() });
    }
    return ref;
  };
  const findFile = (from: string, target: string): VFile | undefined => {
    let t = target.trim();
    try { t = decodeURIComponent(t); } catch { /* keep */ }
    t = t.split("#")[0].replace(/^\.\//, "").replace(/^\//, "");
    const rel = [...dirName(from).split("/").filter(Boolean)];
    for (const p of t.split("/")) { if (p === "..") rel.pop(); else if (p && p !== ".") rel.push(p); }
    return byFull.get(rel.join("/").toLowerCase()) ?? byFull.get(t.toLowerCase()) ?? byBase.get(baseName(t).toLowerCase());
  };
  const findNote = (from: string, target: string): string | undefined => {
    let t = target.trim();
    try { t = decodeURIComponent(t); } catch { /* keep */ }
    t = t.split("#")[0];
    const rel = dirName(from).split("/").filter(Boolean);
    for (const p of t.split("/")) { if (p === "..") rel.pop(); else if (p && p !== ".") rel.push(p); }
    const hit = noteTitles.get(rel.join("/").toLowerCase()) ?? noteTitles.get(t.toLowerCase());
    if (hit) return hit;
    const b = baseName(t).toLowerCase();
    for (const [p, title] of noteTitles) if (baseName(p) === b) return title;
    return undefined;
  };
  const rewrite = (path: string, md: string) => {
    // keep code untouched
    const parts = md.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
    return parts.map((seg, i) => {
      if (i % 2) return seg;
      let s = seg.replace(/!\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (m, target: string) => {
        if (/\.(md|canvas|base)$/i.test(target) || !/\.[a-z0-9]{2,5}$/i.test(target.trim())) return m; // note embed
        const f = findFile(path, target);
        if (!f) { counts.missing++; return m; }
        return attLink(baseName(f.path), attach(f));
      });
      s = s.replace(/(!?)\[([^\]]*)\]\((<[^>]+>|[^)\s]+)(\s+"[^"]*")?\)/g, (m, bang: string, text: string, href0: string) => {
        const href = href0.replace(/^<|>$/g, "");
        if (/^([a-z][\w+.-]*:|#)/i.test(href)) return m;
        if (/\.(md|markdown)(#.*)?$/i.test(href)) {
          const title = findNote(path, href.replace(/(#.*)$/, ""));
          if (!title) return m;
          const anchor = /#(.+)$/.exec(href)?.[1];
          const label = text && text !== title ? `|${text}` : "";
          return `[[${title}${anchor ? "#" + decodeURIComponent(anchor) : ""}${label}]]`;
        }
        const f = findFile(path, href);
        if (!f) { if (bang) counts.missing++; return m; }
        const ref = attach(f);
        const label = (text || baseName(f.path)).replace(/[[\]]/g, "");
        return bang ? attLink(baseName(f.path), ref).replace(/^(!?)\[[^\]]*\]/, `$1[${label}]`) : `[${label}](${attRef(ref)})`;
      });
      // [[file.pdf]] wikilinks to non-note files → attachment links
      s = s.replace(/(?<!!)\[\[([^\]|#]+\.(pdf|png|jpe?g|gif|webp|svg|mp3|mp4|webm|m4a|wav|docx?|xlsx|pptx|zip))(?:\|([^\]]*))?\]\]/gi, (m, target: string, _e: string, alias?: string) => {
        const f = findFile(path, target);
        return f ? `[${(alias || baseName(f.path)).replace(/[[\]]/g, "")}](${attRef(attach(f))})` : m;
      });
      return s;
    }).join("");
  };

  let i = 0;
  for (const f of notes) {
    if (++i % 50 === 0) { onProgress?.(i, notes.length, f.path); await yieldUI(); }
    const folder = dirName(f.path).split("/").filter(Boolean).map(cleanName);
    const ext = extOf(f.path);
    const raw = (await f.text()).replace(/^﻿/, "").replace(/\r\n/g, "\n");
    const title = noteTitles.get(f.path.toLowerCase())!;
    let n: PlanNote;
    if (ext === "canvas") {
      try {
        const c = JSON.parse(raw) as { nodes?: { type: string; file?: string }[] };
        counts.canvasFiles += (c.nodes ?? []).filter((x) => x.type === "file" && x.file && !/\.md$/i.test(x.file)).length;
      } catch { /* invalid canvas: imported as is, the editor shows the error */ }
      n = { key: f.path, folder, title, type: "canvas", body: raw, tags: [], props: {}, badge: "canvas" };
    } else if (ext === "base") {
      n = { key: f.path, folder, title, type: "base", body: `---\ntype: base\n---\n# ${title}\n\n\`\`\`base\n${raw.trimEnd()}\n\`\`\`\n`, tags: [], props: {}, badge: "base" };
    } else if (/\.excalidraw\.md$/i.test(f.path)) {
      const json = /```json\n([\s\S]*?)\n```/.exec(raw)?.[1];
      const dt = title.replace(/\.excalidraw$/i, "");
      let scene: string | null = null;
      if (json) { try { const o = JSON.parse(json) as { type?: string; elements?: unknown[] }; if (Array.isArray(o.elements)) scene = JSON.stringify({ type: "excalidraw", version: 2, source: "lumen-import", elements: o.elements, appState: {}, files: {} }); } catch { /* fall through */ } }
      if (scene) n = { key: f.path, folder, title: dt, type: "whiteboard", body: scene, tags: [], props: {}, badge: "whiteboard" };
      else {
        counts.compressed++;
        n = { key: f.path, folder, title: dt, type: "note", body: ensureH1(normalizeFrontMatter(raw.replace(/```compressed-json[\s\S]*?```/g, "")), dt), tags: [], props: {}, badge: "note" };
      }
    } else {
      const body = ensureH1(rewrite(f.path, normalizeFrontMatter(raw)), title);
      const fmType = /^---\n[\s\S]*?^type:\s*([\w-]+)\s*$[\s\S]*?^---/m.exec(body)?.[1];
      n = { key: f.path, folder, title, type: (fmType as PlanNote["type"]) || "note", body: body.trimEnd() + "\n", tags: [], props: {}, badge: "note" };
    }
    if (inTrash(f.path)) n.off = true;
    plan.notes.push(n);
  }
  plan.stats = { total: files.length, totalBytes: files.reduce((a, f) => a + f.size, 0) };
  const unreferenced = atts.filter((f) => !refOf.has(f.path)).length;
  if (counts.compressed) plan.warnings.push(OBSIDIAN_TEXT.compressedDrawing(counts.compressed));
  if (counts.missing) plan.warnings.push(OBSIDIAN_TEXT.missing(counts.missing));
  if (counts.canvasFiles) plan.warnings.push(OBSIDIAN_TEXT.canvasFiles(counts.canvasFiles));
  if (unreferenced) plan.warnings.push(OBSIDIAN_TEXT.unreferenced(unreferenced));
  onProgress?.(notes.length, notes.length, "");
  return plan;
}
