import { useDeferredValue, useEffect, useMemo, useRef } from "react";
import type { Note } from "../../shared/types";
import { findOrCreateByTitle, updateNote } from "../lib/actions";
import { parseCanvas, previewSvg } from "../lib/canvas";
import { canvasesWith, diagramFiles, diagramName, diagramFocus, diagramHash, fileFor, mermaidBlocks, saveDiagramFile, saveDiagramToCanvas, type DiagramBlock } from "../lib/diagrams";
import { handleCopyClick, hydrate, render } from "../lib/markdown";
import { icon } from "./ws-icons";
import { tasks, toggleTask } from "../lib/parse";
import { matcher, parseQuery } from "../lib/search";
import { go, openNote, toast, useVault, type Vault } from "../lib/store";

import { fmtDate, fmtRelative, t } from "../lib/i18n";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** ```query block: operators + optional `sort:updated|title|created` `limit:N` `view:list|table`. */
export function renderQuery(el: HTMLElement, q: string, v: Vault) {
  const opts = { sort: "updated", limit: 50, view: "list" };
  const rest = q.replace(/\b(sort|limit|view):(\S+)/g, (_m, k: keyof typeof opts, val: string) => { (opts as Record<string, unknown>)[k] = k === "limit" ? Number(val) || 50 : val; return ""; });
  const query = parseQuery(rest);
  const f = matcher(query, v.folderMap, v.spaceMap);
  const text = query.text.toLowerCase();
  let rows = v.notes.filter((n) => f(n) && (!text || n.title.toLowerCase().includes(text) || n.body.toLowerCase().includes(text)));
  rows.sort(opts.sort === "title" ? (a, b) => a.title.localeCompare(b.title) : opts.sort === "created" ? (a, b) => b.createdAt - a.createdAt : (a, b) => b.updatedAt - a.updatedAt);
  rows = rows.slice(0, opts.limit);
  if (!rows.length) { el.innerHTML = `<div class="muted">${esc(t("No notes match {query}", { query: "\u0000" })).replace("\u0000", `<code dir="ltr">${esc(q)}</code>`)}</div>`; return; }
  el.innerHTML = opts.view === "table"
    ? `<table><thead><tr><th>${esc(t("Note"))}</th><th>${esc(t("Type"))}</th><th>${esc(t("Status"))}</th><th>${esc(t("Tags"))}</th><th>${esc(t("Updated"))}</th></tr></thead><tbody>${rows.map((n) => `<tr><td><a class="wikilink" href="#" data-note="${esc(n.title)}">${esc(n.title)}</a></td><td>${n.type}</td><td>${n.status ?? ""}</td><td>${n.tags.map((tag) => "#" + esc(tag)).join(" ")}</td><td>${esc(fmtDate(n.updatedAt))}</td></tr>`).join("")}</tbody></table>`
    : `<div class="muted" style="font-size:12px;margin-bottom:4px">${esc(t("{n} note|{n} notes", { n: rows.length }))} · <code dir="ltr">${esc(q)}</code></div><ul style="margin:0">${rows.map((n) => `<li><a class="wikilink" href="#" data-note="${esc(n.title)}">${esc(n.title)}</a></li>`).join("")}</ul>`;
}

const plainHeading = (s: string) => s.replace(/[*_`[\]]/g, "").replace(/\s+#*\s*$/, "").trim().toLowerCase();
/** `![[Note]]` / `![[Note#Heading]]` source: the note body (no front-matter, no H1) or one section of it. */
export function includeSource(v: Vault, title: string, heading: string): string | null {
  const n = v.byTitle.get(title.toLowerCase());
  if (!n || n.deleted || n.type === "canvas" || n.type === "whiteboard") return null;
  const body = n.body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const lines = body.split("\n");
  if (!heading) return lines.filter((l, i) => !(i === lines.findIndex((x) => /^#\s/.test(x)) && /^#\s/.test(l))).join("\n");
  const want = plainHeading(heading);
  let fence = false, start = -1, level = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(`{3,}|~{3,})/.test(lines[i])) fence = !fence;
    const h = !fence && /^(#{1,6})\s+(.+)$/.exec(lines[i]);
    if (!h) continue;
    if (start >= 0 && h[1].length <= level) return lines.slice(start + 1, i).join("\n");
    if (start < 0 && plainHeading(h[2]) === want) { start = i; level = h[1].length; }
  }
  return start >= 0 ? lines.slice(start + 1).join("\n") : `*${t("No heading “{heading}” in {title}.", { heading, title: n.title })}*`;
}

/** Source line of the last block the reader clicked (for the ¶ direction menu in Read mode). */
export const lastBlock = { noteId: "", line: -1 };

export function Preview({ note, className, onLine }: { note: Pick<Note, "id" | "body" | "spaceId">; className?: string; onLine?: (line: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const vault = useVault();
  // Deferred: a save (or a keystroke in a live preview) commits first; the Markdown render + DOM swap follow in a
  // low-priority pass, so typing never waits on KaTeX / highlight.js / Mermaid.
  const body = useDeferredValue(note.body);
  const html = useMemo(() => render(body), [body]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    el.querySelectorAll<HTMLAnchorElement>("a.wikilink").forEach((a) => { if (!vault.byTitle.has((a.dataset.note ?? "").toLowerCase())) a.classList.add("missing"); });
    hydrate(el, {
      query: (q, src) => renderQuery(q, src, vault),
      include: (title, heading) => includeSource(vault, title, heading),
      canvas: (c, json) => { const { canvas, error } = parseCanvas(json); c.innerHTML = error ? `<div class="render-error">${esc(error)}</div>` : previewSvg(canvas); },
      // PDF highlight → quote at the end of the note (design 08: "Highlights made here become quotes in the note").
      quote: async (text, page, name) => {
        const cur = vault.byId.get(note.id)?.body ?? note.body;
        await updateNote(note.id, { body: `${cur.replace(/\s*$/, "")}\n\n> ${text.replace(/\n/g, "\n> ")}\n> — ${name}, p. ${page}\n` });
        toast(t("Quote added to the note"));
      },
      // Link card ⋯ → "Convert to plain link"
      convert: async (href) => {
        const cur = vault.byId.get(note.id)?.body ?? note.body;
        let host = href;
        try { const u = new URL(href); host = (u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/$/, ""); } catch { /* keep */ }
        const lines = cur.split("\n");
        const i = lines.findIndex((l) => { const t = l.trim(); return t === href || t === `<${href}>`; });
        if (i < 0) return;
        lines[i] = `[${host}](${href})`;
        await updateNote(note.id, { body: lines.join("\n") });
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, vault.notes.length]);

  // Diagram ↔ canvas (lib/diagrams.ts): a "save to canvas" button on every Mermaid card of a real note, a footer link
  // when the diagram is already on a canvas, and scrolling to the diagram when the reader comes back from the canvas.
  // Runs after the render effect and only touches the cards' toolbar/footer, so vault changes don't re-render diagrams.
  useEffect(() => {
    const el = ref.current;
    const src = vault.byId.get(note.id);
    if (!el || !src || src.type === "canvas" || src.deleted) return;
    // Export file names: a .mermaid file exports under its own name.
    if (src.type === "diagram") { el.querySelectorAll<HTMLElement>(".mermaid-card").forEach((c) => { c.dataset.name = src.title; }); return; }
    const blocks = new Map(mermaidBlocks(body).map((b) => [b.line, b]));
    const index = diagramFiles(vault.notes);
    const current = () => { const cur = vault.byId.get(note.id); return cur ? { ...cur, body } : null; };
    const toCanvas = async (b: DiagramBlock) => {
      const cur = current();
      if (!cur) return;
      const r = await saveDiagramToCanvas(cur, b, vault.notes, vault.folders);
      diagramFocus.canvas = { canvasId: r.canvasId, nodeId: r.nodeId };
      if (r.created) toast(t("Saved as {title}", { title: r.file.title }));
      openNote(r.canvasId);
    };
    const toFile = async (b: DiagramBlock, open = false) => {
      const cur = current();
      if (!cur) return;
      const { file, created } = await saveDiagramFile(cur, b, vault.notes, { folders: vault.folders });
      if (open) openNote(file.id, "read");
      else toast(created ? t("Saved as {title}", { title: file.title }) : t("{title} updated", { title: file.title }), { label: t("Open"), run: () => openNote(file.id, "read") });
    };
    const btn = (cls: string, title: string, ic: string, run: () => void) => {
      const x = document.createElement("button");
      x.type = "button"; x.className = cls; x.title = title; x.innerHTML = icon(ic, 13); x.onclick = run;
      return x;
    };
    el.querySelectorAll<HTMLElement>(".mermaid-card[data-line]").forEach((card) => {
      const b = blocks.get(Number(card.dataset.line));
      card.querySelectorAll(".mm-canvas, .mm-file, .mm-foot").forEach((x) => x.remove());
      if (!b) return;
      const found = fileFor(index, note.id, b);
      card.dataset.name = found?.file.title ?? diagramName(vault.byId.get(note.id)?.title ?? "diagram", b);
      const where = found ? canvasesWith(vault.notes, found.file) : [];
      const src = card.querySelector(".mm-src");
      src?.before(btn("mm-file", found ? t("Open {name}", { name: found.file.title }) : t("Save as a .mermaid file"), "file-text", () => void toFile(b, !!found && !found.stale)));
      src?.before(btn("mm-canvas", where.length ? t("Open in canvas") : t("Save to canvas (as a .mermaid file card) and open it"), "layout-dashboard", () => void toCanvas(b)));
      if (!found) return;
      const foot = document.createElement("div");
      foot.className = "mm-foot";
      const saved = found.file.props?.diagramSavedAt ? " · " + t("saved {ago}", { ago: fmtRelative(Date.parse(found.file.props.diagramSavedAt)) }) : "";
      foot.innerHTML = `${icon("file-text", 12)}<span>${esc(t("Saved as"))}</span><a href="#" class="mm-openfile" dir="auto"><b>${esc(found.file.title)}</b></a><span class="mm-dim">${esc(saved)}</span>`
        + (where.length ? `<span class="mm-dot">·</span>${icon("layout-dashboard", 12)}<span>${esc(t("In canvas"))}</span>${where.map((w, i) => `<a href="#" class="mm-open" data-i="${i}">${esc(w.canvas.title)}</a>`).join(", ")}` : `<span class="mm-dot">·</span><button type="button" class="mm-tocanvas">${icon("layout-dashboard", 12)} ${esc(t("Add to canvas"))}</button>`)
        + (found.stale ? `<span class="mm-stale">${esc(t("changed here since saved"))}</span><button type="button" class="mm-sync">${icon("refresh-cw", 12)} ${esc(t("Update file"))}</button>` : "");
      foot.querySelector<HTMLAnchorElement>(".mm-openfile")!.onclick = (e) => { e.preventDefault(); openNote(found.file.id, "read"); };
      foot.querySelectorAll<HTMLAnchorElement>(".mm-open").forEach((a) => { a.onclick = (e) => { e.preventDefault(); const w = where[Number(a.dataset.i)]; diagramFocus.canvas = { canvasId: w.canvas.id, nodeId: w.nodeId }; openNote(w.canvas.id); }; });
      const add = foot.querySelector<HTMLButtonElement>(".mm-tocanvas");
      if (add) add.onclick = () => void toCanvas(b);
      const sync = foot.querySelector<HTMLButtonElement>(".mm-sync");
      if (sync) sync.onclick = () => void toFile(b);
      card.append(foot);
    });
    // Arrived from a canvas card ("↩ note"): scroll to that diagram and flash it.
    const f = diagramFocus.note;
    if (f && f.noteId === note.id) {
      diagramFocus.note = null;
      const all = [...blocks.values()];
      const b = all.find((x) => diagramHash(x.src) === f.hash) ?? all.reduce<DiagramBlock | undefined>((best, x) => (!best || Math.abs(x.line - f.line) < Math.abs(best.line - f.line) ? x : best), undefined);
      const card = b && el.querySelector<HTMLElement>(`.mermaid-card[data-line="${b.line}"]`);
      if (card) requestAnimationFrame(() => { card.scrollIntoView({ block: "center", behavior: "smooth" }); card.classList.add("mm-flash"); setTimeout(() => card.classList.remove("mm-flash"), 1800); });
    }
  }, [html, vault, note.id, body]);

  async function onClick(e: React.MouseEvent) {
    if (handleCopyClick(e)) return;
    const t = e.target as HTMLElement;
    const blk = t.closest<HTMLElement>("[data-line]");
    if (blk) Object.assign(lastBlock, { noteId: note.id, line: Number(blk.dataset.line) });
    const wl = t.closest<HTMLAnchorElement>("a.wikilink");
    if (wl) {
      e.preventDefault();
      const n = await findOrCreateByTitle(wl.dataset.note ?? "Untitled", note.spaceId);
      openNote(n.id);
      return;
    }
    const tag = t.closest<HTMLAnchorElement>("a.tag");
    if (tag) { e.preventDefault(); go("notes", { tag: tag.dataset.tag ?? null, spaceId: "all", folderId: null }); return; }
    if (t instanceof HTMLInputElement && t.type === "checkbox") {
      const boxes = [...(ref.current?.querySelectorAll<HTMLInputElement>(".task-list-item-checkbox") ?? [])];
      const i = boxes.indexOf(t);
      const ts = tasks(note.body);
      if (i >= 0 && ts[i]) void updateNote(note.id, { body: toggleTask(note.body, ts[i].line) });
      return;
    }
    if (onLine && e.detail === 2) {
      const blk = t.closest<HTMLElement>("[data-line]");
      if (blk) onLine(Number(blk.dataset.line));
    }
  }

  return <div ref={ref} onClick={onClick} className={"prose " + (className ?? "")} />;
}
