import { useEffect, useMemo, useRef } from "react";
import type { Note } from "../../shared/types";
import { findOrCreateByTitle, updateNote } from "../lib/actions";
import { parseCanvas, previewSvg } from "../lib/canvas";
import { diagramFocus, diagramHash, diagramIndex, linkFor, mermaidBlocks, saveDiagramToCanvas, type DiagramBlock } from "../lib/diagrams";
import { handleCopyClick, hydrate, render } from "../lib/markdown";
import { icon } from "./ws-icons";
import { tasks, toggleTask } from "../lib/parse";
import { matcher, parseQuery } from "../lib/search";
import { go, openNote, toast, useVault, type Vault } from "../lib/store";

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
  if (!rows.length) { el.innerHTML = `<div class="muted">No notes match <code>${esc(q)}</code></div>`; return; }
  el.innerHTML = opts.view === "table"
    ? `<table><thead><tr><th>Note</th><th>Type</th><th>Status</th><th>Tags</th><th>Updated</th></tr></thead><tbody>${rows.map((n) => `<tr><td><a class="wikilink" href="#" data-note="${esc(n.title)}">${esc(n.title)}</a></td><td>${n.type}</td><td>${n.status ?? ""}</td><td>${n.tags.map((t) => "#" + esc(t)).join(" ")}</td><td>${new Date(n.updatedAt).toLocaleDateString()}</td></tr>`).join("")}</tbody></table>`
    : `<div class="muted" style="font-size:12px;margin-bottom:4px">${rows.length} notes · <code>${esc(q)}</code></div><ul style="margin:0">${rows.map((n) => `<li><a class="wikilink" href="#" data-note="${esc(n.title)}">${esc(n.title)}</a></li>`).join("")}</ul>`;
}

/** Source line of the last block the reader clicked (for the ¶ direction menu in Read mode). */
export const lastBlock = { noteId: "", line: -1 };

export function Preview({ note, className, onLine }: { note: Pick<Note, "id" | "body" | "spaceId">; className?: string; onLine?: (line: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const vault = useVault();
  const html = useMemo(() => render(note.body), [note.body]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    el.querySelectorAll<HTMLAnchorElement>("a.wikilink").forEach((a) => { if (!vault.byTitle.has((a.dataset.note ?? "").toLowerCase())) a.classList.add("missing"); });
    hydrate(el, {
      query: (q, src) => renderQuery(q, src, vault),
      canvas: (c, json) => { const { canvas, error } = parseCanvas(json); c.innerHTML = error ? `<div class="render-error">${esc(error)}</div>` : previewSvg(canvas); },
      // PDF highlight → quote at the end of the note (design 08: "Highlights made here become quotes in the note").
      quote: async (text, page, name) => {
        const cur = vault.byId.get(note.id)?.body ?? note.body;
        await updateNote(note.id, { body: `${cur.replace(/\s*$/, "")}\n\n> ${text.replace(/\n/g, "\n> ")}\n> — ${name}, p. ${page}\n` });
        toast("Quote added to the note");
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
    const blocks = new Map(mermaidBlocks(note.body).map((b) => [b.line, b]));
    const index = diagramIndex(vault.notes);
    const go = async (b: DiagramBlock, stay = false) => {
      const cur = vault.byId.get(note.id);
      if (!cur) return;
      const r = await saveDiagramToCanvas({ ...cur, body: note.body }, b, vault.notes);
      if (stay) { toast("Canvas copy updated"); return; }
      diagramFocus.canvas = { canvasId: r.canvasId, nodeId: r.nodeId };
      if (r.created) toast("Diagram saved to a new canvas");
      openNote(r.canvasId);
    };
    el.querySelectorAll<HTMLElement>(".mermaid-card[data-line]").forEach((card) => {
      const b = blocks.get(Number(card.dataset.line));
      card.querySelector(".mm-canvas")?.remove();
      card.querySelector(".mm-foot")?.remove();
      if (!b) return;
      const link = linkFor(index, note.id, b);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mm-canvas";
      btn.title = link ? "Open in canvas" : "Save to canvas (as a .mermaid card) and open it";
      btn.innerHTML = icon("layout-dashboard", 13);
      btn.onclick = () => void go(b);
      card.querySelector(".mm-src")?.before(btn);
      if (!link) return;
      const foot = document.createElement("div");
      foot.className = "mm-foot";
      foot.innerHTML = `${icon("layout-dashboard", 12)}<span>In canvas</span><a href="#" class="mm-open">${esc(link.canvas.title)} › <b>${esc(link.name)}</b></a>${link.stale ? `<span class="mm-stale">changed here</span><button type="button" class="mm-sync">${icon("refresh-cw", 12)} Update canvas copy</button>` : ""}`;
      foot.querySelector<HTMLAnchorElement>(".mm-open")!.onclick = (e) => { e.preventDefault(); diagramFocus.canvas = { canvasId: link.canvas.id, nodeId: link.nodeId }; openNote(link.canvas.id); };
      const sync = foot.querySelector<HTMLButtonElement>(".mm-sync");
      if (sync) sync.onclick = () => void go(b, true);
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
  }, [html, vault, note.id, note.body]);

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
