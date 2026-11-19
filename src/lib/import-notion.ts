// Notion export import ("Markdown & CSV" zip, docs/IMPORT.md). Pure: works on a VFile list, runs in Node tests.
//
// Export layout: `Page <32-hex id>.md` with its sub-pages in the folder `Page <id>/`; a database is `DB <id>.csv`
// (newer exports add `DB <id>_all.csv`) plus a folder `DB <id>/` with one .md page per row, whose first lines after the
// H1 are `Property: value`. Links between pages are relative, URL-encoded paths to those files.
//
// Mapping: pages → notes keeping the folder tree (ids stripped from names); databases → a Base note (type: base, table
// view filtered to the database folder) whose rows are notes with front-matter properties; page links → [[Title]];
// images and files → attachments; unsupported embeds are counted in warnings.
import { serializeBase, type BaseViewDef, type ViewType } from "./base";
import { t } from "./i18n";
import {
  attLink, attRef, baseName, cleanName, dirName, emptyPlan, extOf, htmlToMd, mimeOf, stripCommonRoot, yieldUI, ImportError, isNotionHtmlExport,
  type ImportPlan, type PlanNote, type Progress, type VFile,
} from "./import-model";
import { toFrontMatter } from "./parse";

export const NOTION_TEXT = {
  embeds: (n: number, providers: string) => providers
    ? t("{n} embed ({list}) can't be imported; it stays as a link.|{n} embeds ({list}) can't be imported; they stay as links.", { n, list: providers })
    : t("{n} embed can't be imported; it stays as a link.|{n} embeds can't be imported; they stay as links.", { n }),
  outside: (n: number) => t("{n} link points to a Notion page that isn't in this export; it stays as a web link.|{n} links point to Notion pages that aren't in this export; they stay as web links.", { n }),
  missingFiles: (n: number) => t("{n} image or file is referenced but missing from the export.|{n} images or files are referenced but missing from the export.", { n }),
  notNotion: () => t("This zip doesn't look like a Notion export (no .md or .csv pages)."),
  html: () => t("This file looks like an HTML export. Lumen needs Markdown & CSV."),
};
/** Embeds Notion exports as a bare link line (`[url](url)`) or an iframe: provider names for the preview. */
const PROVIDERS: [RegExp, string][] = [
  [/figma\.com$/, "Figma"], [/loom\.com$/, "Loom"], [/(youtube\.com|youtu\.be)$/, "YouTube"], [/vimeo\.com$/, "Vimeo"], [/miro\.com$/, "Miro"],
  [/codepen\.io$/, "CodePen"], [/(docs|drive)\.google\.com$/, "Google Drive"], [/(twitter|x)\.com$/, "X"], [/gist\.github\.com$/, "GitHub Gist"],
  [/(maps\.google\.com|google\.com\/maps)$/, "Google Maps"], [/(open\.)?spotify\.com$/, "Spotify"], [/whimsical\.com$/, "Whimsical"], [/excalidraw\.com$/, "Excalidraw"],
  [/airtable\.com$/, "Airtable"], [/typeform\.com$/, "Typeform"], [/(github\.com)$/, "GitHub"],
];
const providerOf = (url: string): string | null => {
  try { const h = new URL(url).hostname.replace(/^www\./, ""); return PROVIDERS.find(([re]) => re.test(h))?.[1] ?? null; } catch { return null; }
};

/** A Notion database base note with another first view (the preview's "Base · Table / Board / Gallery…" choice). */
export function withBaseView(n: PlanNote, view: ViewType): PlanNote {
  if (!n.baseSpec) return n;
  const { folder, order, group, date } = n.baseSpec;
  const name = { table: t("Table"), board: t("Board"), cards: t("Gallery"), list: t("List"), calendar: t("Calendar") }[view];
  const v: BaseViewDef = { type: view, name, order };
  if (view === "board" && group) v.groupBy = { property: group, direction: "ASC" };
  if (view === "calendar" && date) v.date = date;
  const yaml = serializeBase({ filters: { and: [`file.inFolder("@@FOLDER:${folder}@@")`] }, views: [v] });
  return { ...n, body: `---\ntype: base\n---\n# ${n.title}\n\n\`\`\`base\n${yaml}\`\`\`\n` };
}

const ID = /\s+[0-9a-f]{32}$/i;
const ID_LOOSE = /\s*[0-9a-f]{32}$/i;
/** "Page 1a2b…(32 hex)" → "Page"; also drops the `_all` suffix of database CSVs. */
export const stripNotionId = (s: string) => s.replace(/\.(md|csv)$/i, "").replace(/_all$/i, "").replace(ID, "").replace(ID_LOOSE, "").trim() || s;
const cleanSeg = (s: string) => cleanName(stripNotionId(s));

/** RFC 4180 CSV (quotes, doubled quotes, newlines in cells, BOM). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
      continue;
    }
    if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((x) => x.trim()));
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** Notion dates ("November 19, 2026", "Nov 19, 2026 10:00 AM", "2026/11/19", ranges "A → B") → "2026-11-19". */
export function notionDate(v: string): string | null {
  const first = v.split("→")[0].trim();
  let m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(first);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.startsWith(m![1].toLowerCase().slice(0, 3)));
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(first);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(first);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

/** Column names that would collide with Lumen's own fields in bases get a `notion-` prefix. */
const RESERVED = new Set(["title", "type", "status", "tags", "space", "folder", "created", "updated", "modified", "course", "cards", "slug", "file.name"]);
const propKey = (col: string) => {
  const k = col.trim().replace(/[:\n]/g, " ").trim() || "Property";
  return RESERVED.has(k.toLowerCase()) && k.toLowerCase() !== "tags" ? `notion-${k.toLowerCase().replace(/\s+/g, "-")}` : k;
};

interface Db { csvPath: string; title: string; folderPath: string; folder: string[]; header: string[]; rows: string[][] }

export async function notionPlan(input: VFile[], name: string, onProgress?: Progress): Promise<ImportPlan> {
  const { files } = stripCommonRoot(input);
  const plan = emptyPlan("notion", name.replace(/\.zip$/i, ""));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const lower = new Map(files.map((f) => [f.path.toLowerCase(), f]));
  const mds = files.filter((f) => extOf(f.path) === "md");
  const csvs = files.filter((f) => extOf(f.path) === "csv");
  if (!mds.length && !csvs.length) {
    if (isNotionHtmlExport(files.map((f) => f.path))) throw new ImportError("notion-html", NOTION_TEXT.html(), name);
    throw new Error(NOTION_TEXT.notNotion());
  }
  const folderOf = (path: string) => dirName(path).split("/").filter(Boolean).map(cleanSeg);
  const titleOfPath = new Map<string, string>(); // md/csv path → note title

  // databases: prefer `_all.csv` when both exist
  const dbs: Db[] = [];
  const dbByFolder = new Map<string, Db>();
  for (const f of csvs) {
    const stem = f.path.replace(/(_all)?\.csv$/i, "");
    if (!/_all\.csv$/i.test(f.path) && byPath.has(stem + "_all.csv")) continue;
    const table = parseCsv(await f.text());
    if (!table.length) continue;
    const db: Db = { csvPath: f.path, title: cleanSeg(baseName(stem)), folderPath: stem, folder: folderOf(f.path), header: table[0].map((h) => h.trim()), rows: table.slice(1) };
    dbs.push(db);
    dbByFolder.set(stem, db);
    titleOfPath.set(f.path, db.title);
    if (byPath.has(stem + ".csv")) titleOfPath.set(stem + ".csv", db.title);
  }
  // first pass: titles (H1 wins over the file name)
  const texts = new Map<string, string>();
  let i = 0;
  for (const f of mds) {
    const t = await f.text();
    texts.set(f.path, t);
    const h1 = /^﻿?#\s+(.+?)\s*$/m.exec(t.split("\n").find((l) => l.trim()) ?? "")?.[1];
    titleOfPath.set(f.path, cleanName(h1 ?? stripNotionId(baseName(f.path))));
    if (++i % 100 === 0) { onProgress?.(i, mds.length * 2, f.path); await yieldUI(); }
  }

  const counts = { embeds: 0, outside: 0, missing: 0, links: 0 };
  const providers = new Set<string>();
  const attByPath = new Map<string, string>();
  const attach = (path: string) => {
    const f = byPath.get(path) ?? lower.get(path.toLowerCase());
    if (!f) return null;
    let ref = attByPath.get(f.path);
    if (!ref) {
      ref = `a${attByPath.size}`;
      attByPath.set(f.path, ref);
      plan.attachments.set(ref, { ref, name: baseName(f.path), mime: mimeOf(f.path), size: f.size, bytes: () => f.bytes() });
    }
    return ref;
  };
  const resolve = (from: string, href: string) => {
    let h = href.trim().replace(/^<|>$/g, "");
    try { h = decodeURIComponent(h); } catch { /* keep */ }
    const parts = dirName(from).split("/").filter(Boolean);
    for (const p of h.split("#")[0].split("/")) { if (p === "..") parts.pop(); else if (p && p !== ".") parts.push(p); }
    return parts.join("/");
  };
  /** Rewrite one page's Markdown: links, images, HTML bits. */
  const rewrite = (path: string, md: string) => {
    let s = md;
    // <aside> callouts → Obsidian-style callouts
    s = s.replace(/<aside>([\s\S]*?)<\/aside>/gi, (_m, inner: string) => "> [!note]\n" + htmlToMd(inner).split("\n").map((l) => `> ${l}`).join("\n"));
    s = s.replace(/<(iframe|video|embed|object)\b[^>]*>(?:[\s\S]*?<\/\1>)?/gi, (m) => { counts.embeds++; const src = /src="([^"]+)"/.exec(m)?.[1]; const pv = src && providerOf(src); if (pv) providers.add(pv); return src ? `<${src}>` : ""; });
    // embed blocks export as a line with only `[url](url)`: count them (they stay links)
    s = s.replace(/^\[(https?:[^\]\s]+)\]\((https?:[^)\s]+)\)\s*$/gm, (m, a: string, b: string) => { const pv = a === b ? providerOf(b) : null; if (pv) { counts.embeds++; providers.add(pv); } return m; });
    s = s.replace(/<\/?(span|div|br|p|details|summary|figure|figcaption)\b[^>]*>/gi, "\n");
    // images and links
    s = s.replace(/(!?)\[([^\]]*)\]\(([^)\s]+(?:\s[^)"]+)*)(?:\s+"[^"]*")?\)/g, (m, bang: string, text: string, href: string) => {
      if (/^(https?:|mailto:|#)/i.test(href)) {
        if (/notion\.so\//i.test(href)) counts.outside++;
        return m;
      }
      const target = resolve(path, href);
      const ext = extOf(target);
      if (ext === "md" || ext === "csv") {
        const title = titleOfPath.get(target) ?? titleOfPath.get([...titleOfPath.keys()].find((k) => k.toLowerCase() === target.toLowerCase()) ?? "");
        if (!title) return text || m;
        counts.links++;
        return text && stripNotionId(text) !== title ? `[[${title}|${text}]]` : `[[${title}]]`;
      }
      const ref = attach(target);
      if (!ref) { counts.missing++; return m; }
      const label = (text || baseName(target)).replace(/[[\]]/g, "");
      return bang ? attLink(baseName(target), ref).replace(/^(!?)\[[^\]]*\]/, `$1[${label}]`) : `[${label}](${attRef(ref)})`;
    });
    return s.replace(/\n{3,}/g, "\n\n");
  };
  const withH1 = (title: string, body: string) => {
    const lines = body.replace(/^﻿/, "").split("\n");
    const first = lines.findIndex((l) => l.trim());
    if (first >= 0 && /^#\s+/.test(lines[first])) lines.splice(first, 1);
    return `# ${title}\n\n${lines.join("\n").replace(/^\n+/, "")}`;
  };

  // pages and database rows
  const rowPages = new Map<Db, Map<string, string[]>>(); // db → lowercased title → paths
  for (const f of mds) {
    const db = dbByFolder.get(dirName(f.path));
    if (!db) continue;
    const t = titleOfPath.get(f.path)!.toLowerCase();
    const m = rowPages.get(db) ?? new Map<string, string[]>();
    m.set(t, [...(m.get(t) ?? []), f.path]);
    rowPages.set(db, m);
  }
  const usedRowPages = new Set<string>();
  for (const db of dbs) {
    const keys = db.header.map(propKey);
    const titleCol = 0;
    const tagCols = new Set(db.header.map((h, k) => (/^tags?$/i.test(h) ? k : -1)).filter((k) => k >= 0));
    const boolCols = new Set(db.header.map((_h, k) => (db.rows.length && db.rows.every((r) => /^(yes|no|)$/i.test((r[k] ?? "").trim())) && db.rows.some((r) => r[k]) ? k : -1)).filter((k) => k >= 0));
    const dateCols = new Set(db.header.map((_h, k) => (db.rows.some((r) => r[k]) && db.rows.every((r) => !r[k]?.trim() || notionDate(r[k]) !== null) ? k : -1)).filter((k) => k >= 0));
    const order = ["file.name", ...keys.filter((_k, k) => k !== titleCol).map((k) => (tagCols.has(keys.indexOf(k)) ? "file.tags" : k))];
    const rowFolder = [...db.folder, db.title];
    plan.folders.push(rowFolder.join("/"));
    const pages = rowPages.get(db) ?? new Map<string, string[]>();
    db.rows.forEach((r, ri) => {
      const title = cleanName(r[titleCol]?.trim() || "Untitled");
      const fm: Record<string, string | string[]> = {};
      const tags: string[] = [];
      r.forEach((raw, k) => {
        if (k === titleCol) return;
        const v = (raw ?? "").trim();
        if (!v) return;
        if (tagCols.has(k)) { for (const t of v.split(",").map((x) => x.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean)) tags.push(t); return; }
        if (boolCols.has(k)) { fm[keys[k]] = /^yes$/i.test(v) ? "true" : "false"; return; }
        if (dateCols.has(k)) { fm[keys[k]] = notionDate(v) ?? v; return; }
        // relations: "Other page (Other%20page%20<id>.md)" → [[Other page]]
        const rel = [...v.matchAll(/([^,(]+?)\s*\(([^)]+\.md)\)/g)];
        if (rel.length) { fm[keys[k]] = rel.map((x) => `[[${titleOfPath.get(resolve(db.csvPath, x[2])) ?? cleanName(stripNotionId(x[1].trim()))}]]`).join(", "); return; }
        fm[keys[k]] = v.replace(/\n+/g, " ");
      });
      if (tags.length) fm.tags = [...new Set(tags)];
      const pagePath = pages.get(title.toLowerCase())?.find((p) => !usedRowPages.has(p));
      let body = "";
      if (pagePath) {
        usedRowPages.add(pagePath);
        // drop the "Property: value" lines Notion writes after the H1
        const lines = withH1(title, texts.get(pagePath)!).split("\n");
        let j = 2;
        const heads = new Set(db.header.map((h) => h.toLowerCase()));
        while (j < lines.length && /^[^:]+:\s/.test(lines[j]) && heads.has(lines[j].slice(0, lines[j].indexOf(":")).trim().toLowerCase())) j++;
        body = lines.slice(j).join("\n").replace(/^\n+/, "");
        body = rewrite(pagePath, body);
      }
      const n: PlanNote = {
        key: pagePath ?? `${db.csvPath}#${ri}`, folder: rowFolder, title, type: "note",
        body: toFrontMatter(fm) + `# ${title}\n\n${body}`.trimEnd() + "\n", tags: [...new Set(tags)], props: {}, badge: "row",
      };
      plan.notes.push(n);
    });
    const group = keys.find((_k, ci) => ci !== titleCol && !tagCols.has(ci) && !dateCols.has(ci) && !boolCols.has(ci) && /status|stage|state|priority|category|type/i.test(db.header[ci]));
    const date = keys.find((_k, ci) => dateCols.has(ci));
    plan.notes.push(withBaseView({
      key: db.csvPath, folder: db.folder, title: db.title, type: "base", badge: "database", tags: [], props: {}, body: "", cards: db.rows.length,
      baseSpec: { folder: rowFolder.join("/"), order, group, date },
    }, "table"));
  }
  i = 0;
  for (const f of mds) {
    if (usedRowPages.has(f.path)) continue;
    if (++i % 100 === 0) { onProgress?.(mds.length + i, mds.length * 2, f.path); await yieldUI(); }
    const title = titleOfPath.get(f.path)!;
    const db = dbByFolder.get(dirName(f.path));
    plan.notes.push({ key: f.path, folder: db ? [...db.folder, db.title] : folderOf(f.path), title, type: "note", body: rewrite(f.path, withH1(title, texts.get(f.path)!)).trimEnd() + "\n", tags: [], props: {}, badge: db ? "row" : "page" });
  }
  if (counts.embeds) plan.warnings.push(NOTION_TEXT.embeds(counts.embeds, [...providers].join(", ")));
  plan.stats = { pageLinks: counts.links, embeds: counts.embeds, embedProviders: [...providers], syncedBlocks: 0, total: mds.length + dbs.length, totalBytes: files.reduce((a, f) => a + f.size, 0) };
  if (counts.outside) plan.warnings.push(NOTION_TEXT.outside(counts.outside));
  if (counts.missing) plan.warnings.push(NOTION_TEXT.missingFiles(counts.missing));
  onProgress?.(1, 1, "");
  return plan;
}
