// Insert gallery (design R4-16C "Insert gallery · hover preview"): note ⋯ › Insert…, or "Insert gallery…" in the "/" menu.
// Three rows of layout thumbnails (LayoutThumb, theme tokens) + a preview pane with the Markdown it will write.
// Desktop = centred 860 px dialog; phone = bottom sheet without the preview pane.
import type { EditorView } from "@codemirror/view";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { applySlash, GALLERY, SLASH, slashById, slashMarkdown, type SlashCommand } from "../lib/slash";
import { Glyph } from "./Glyph";
import { LayoutThumb } from "./LayoutThumb";

export interface GalleryTarget { view: EditorView; from: number; to: number }
let opener: ((t: GalleryTarget | null) => void) | null = null;
let fallbackView: () => EditorView | null = () => null;
/** Opens the gallery for an editor (default: the active editor at its caret). */
export function openInsertGallery(t?: GalleryTarget) {
  const v = t?.view ?? fallbackView();
  if (!v) return false;
  const head = v.state.selection.main.head;
  opener?.(t ?? { view: v, from: head, to: head });
  return true;
}
export const setGalleryEditor = (f: () => EditorView | null) => { fallbackView = f; };

export function InsertGallery() {
  const [target, setTarget] = useState<GalleryTarget | null>(null);
  const [q, setQ] = useState("");
  const [cur, setCur] = useState("sidebar-l");
  const phone = typeof innerWidth === "number" && innerWidth < 640;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { opener = (t) => { setTarget(t); setQ(""); setCur("sidebar-l"); }; return () => { opener = null; }; }, []);

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return GALLERY.map((g) => ({ name: g.group as string, items: g.ids.map(slashById).filter((c): c is SlashCommand => !!c) }));
    const hit = SLASH.filter((c) => !c.action && `${c.label} ${c.keys} ${c.hint}`.toLowerCase().includes(s));
    return hit.length ? [{ name: `${hit.length} block${hit.length === 1 ? "" : "s"}`, items: hit }] : [];
  }, [q]);
  const flat = groups.flatMap((g) => g.items);
  useEffect(() => { if (flat.length && !flat.some((c) => c.id === cur)) setCur(flat[0].id); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return null;
  const close = () => { setTarget(null); target.view.focus(); };
  const insert = (c: SlashCommand) => { const t = target; setTarget(null); applySlash(t.view, c, t.from, t.to); };
  const pc = slashById(cur) ?? flat[0];
  const onKey = (e: React.KeyboardEvent) => {
    const i = flat.findIndex((c) => c.id === cur);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: phone ? 3 : 5, ArrowUp: phone ? -3 : -5 }[e.key];
    if (step && flat.length) { e.preventDefault(); setCur(flat[Math.max(0, Math.min(flat.length - 1, i + step))].id); }
    else if (e.key === "Enter" && pc) { e.preventDefault(); insert(pc); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  };
  const tile = (c: SlashCommand) => (
    <button key={c.id} onMouseEnter={() => setCur(c.id)} onFocus={() => setCur(c.id)} onClick={() => insert(c)} title={c.hint}
      className="flex flex-col gap-1.5 rounded-[10px] p-1.5 text-start outline-none"
      style={c.id === cur ? { background: "color-mix(in srgb,var(--accent) 10%,transparent)", boxShadow: "inset 0 0 0 1.5px var(--accent)" } : undefined}>
      {c.thumb ? <LayoutThumb kind={c.thumb} /> : <span className="flex h-16 w-24 items-center justify-center rounded-[8px] border border-line bg-bg"><Glyph name={c.glyph} size={22} /></span>}
      <span className="px-0.5 text-[12px] font-medium leading-4">{c.label}</span>
    </button>
  );

  return createPortal(
    <div className="fixed inset-0 z-[70]" onKeyDown={onKey}>
      <div className="absolute inset-0" style={{ background: "rgba(5,6,8,.55)" }} onClick={close} />
      <div role="dialog" aria-label="Insert" className={phone
        ? "absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col overflow-hidden rounded-t-[14px] bg-surface fade-in"
        : "absolute left-1/2 top-1/2 flex w-[860px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border border-line bg-surface fade-in"}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="flex-1 text-[17px] font-[650]">Insert</span>
          <label className={phone ? "flex h-8 w-44 items-center gap-2 rounded-[6px] border border-line bg-bg px-2.5 text-muted" : "flex h-8 w-60 items-center gap-2 rounded-[6px] border border-line bg-bg px-2.5 text-muted"}>
            <Glyph name="query" size={14} />
            <input ref={input} autoFocus={!phone} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search blocks" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-muted" />
          </label>
        </div>
        <div className="flex min-h-0">
          <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
            {groups.map((g) => (
              <div key={g.name} className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{g.name}</span>
                <div className={phone ? "grid grid-cols-3 gap-2.5" : "grid grid-cols-5 gap-2.5"}>{g.items.map(tile)}</div>
              </div>
            ))}
            {!groups.length && <div className="py-6 text-muted">No block matches “{q}”. Type <kbd className="rounded border border-line px-1">/</kbd> in the note to see every command.</div>}
          </div>
          {!phone && pc && (
            <div className="flex w-60 shrink-0 flex-col gap-2.5 border-s border-line bg-bg p-4">
              <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Preview</span>
              {pc.thumb ? <LayoutThumb kind={pc.thumb} scale={2.15} /> : <span className="flex h-[138px] w-[206px] items-center justify-center rounded-[8px] border border-line"><Glyph name={pc.glyph} size={40} color="var(--muted)" /></span>}
              <span className="font-semibold">{pc.label}</span>
              <span className="text-[12px] leading-[17px] text-muted">{pc.desc ?? pc.hint}</span>
              <code className="overflow-hidden whitespace-pre font-mono text-[11.5px] leading-[18px] text-muted">{previewMd(pc)}</code>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The skeleton of the Markdown (placeholder text dropped, like the design's preview). */
function previewMd(c: SlashCommand) {
  const md = slashMarkdown(c).replace(/\n+$/, "");
  if (!md.startsWith(":::")) return md;
  return md.split("\n").filter((l) => /^\s*:::/.test(l) || /^#{1,6} /.test(l)).join("\n");
}
