import { useEffect, useMemo, useRef } from "react";
import type { Note } from "../../shared/types";
import { findOrCreateByTitle, updateNote } from "../lib/actions";
import { parseCanvas, previewSvg } from "../lib/canvas";
import { handleCopyClick, hydrate, render } from "../lib/markdown";
import { tasks, toggleTask } from "../lib/parse";
import { matcher, parseQuery } from "../lib/search";
import { go, openNote, useVault, type Vault } from "../lib/store";

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
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, vault.notes.length]);

  async function onClick(e: React.MouseEvent) {
    if (handleCopyClick(e)) return;
    const t = e.target as HTMLElement;
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
