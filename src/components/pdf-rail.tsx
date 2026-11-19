// Left rail of the PDF reader: Thumbnails / Outline (the PDF's bookmarks) / Highlights (filter, sort, export).
// On phones the same component sits in a bottom sheet.
import { ArrowDownUp, Download, FilePlus, Image as ImageIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { resolveAtt } from "../lib/attachments";
import { renderThumb, type OutlineItem, type PdfDoc } from "../lib/pdf-doc";
import { allTags, filterHighlights, HL_COLORS, hlCardText, hlHex, sortHighlights, type HlColor, type Highlight } from "../lib/pdf-format";
import { HL_MIME } from "../lib/pdf-note";
import { cx } from "./ui";

export type RailTab = "thumbs" | "outline" | "highlights";

export function PdfRail(p: {
  doc: PdfDoc | null; pages: number; page: number; tab: RailTab; setTab: (t: RailTab) => void; outline: OutlineItem[] | null;
  highlights: Highlight[]; title: string; onPage: (n: number) => void; onHl: (h: Highlight) => void; onAllNote: () => void; onExport: () => void;
}) {
  const tabs: [RailTab, string][] = [["thumbs", "Pages"], ["outline", "Outline"], ["highlights", `Highlights${p.highlights.length ? ` ${p.highlights.length}` : ""}`]];
  return (
    <div className="pdfr-rail flex h-full min-h-0 flex-col">
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-line px-2 py-1.5">
        {tabs.map(([v, l]) => (
          <button key={v} role="tab" aria-selected={p.tab === v} onClick={() => p.setTab(v)}
            className={cx("h-8 flex-1 whitespace-nowrap rounded-[7px] px-2 text-[12.5px]", p.tab === v ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}>{l}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {p.tab === "thumbs" ? <Thumbs doc={p.doc} pages={p.pages} page={p.page} onPage={p.onPage} />
          : p.tab === "outline" ? <Outline items={p.outline} page={p.page} onPage={p.onPage} />
            : <HlPanel highlights={p.highlights} title={p.title} onHl={p.onHl} onAllNote={p.onAllNote} onExport={p.onExport} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ thumbnails (rendered lazily as they scroll in)
function Thumbs({ doc, pages, page, onPage }: { doc: PdfDoc | null; pages: number; page: number; onPage: (n: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector(`[data-thumb="${page}"]`)?.scrollIntoView({ block: "nearest" }); }, [page]);
  return (
    <div ref={ref} className="grid grid-cols-2 gap-2 p-2.5">
      {Array.from({ length: pages }, (_, i) => <Thumb key={i} doc={doc} n={i + 1} active={page === i + 1} onPage={onPage} root={ref} />)}
    </div>
  );
}
const thumbCache = new WeakMap<PdfDoc, Map<number, string>>();
const Thumb = memo(function Thumb({ doc, n, active, onPage, root }: { doc: PdfDoc | null; n: number; active: boolean; onPage: (n: number) => void; root: React.RefObject<HTMLDivElement | null> }) {
  const el = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState<string | null>(() => (doc ? thumbCache.get(doc)?.get(n) ?? null : null));
  useEffect(() => {
    if (!doc || src || !el.current) return;
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void renderThumb(doc, n, 96).then((u) => {
        let m = thumbCache.get(doc);
        if (!m) thumbCache.set(doc, (m = new Map()));
        m.set(n, u);
        setSrc(u);
      }).catch(() => undefined);
    }, { root: root.current?.parentElement ?? null, rootMargin: "300px" });
    io.observe(el.current);
    return () => io.disconnect();
  }, [doc, n, src, root]);
  return (
    <button ref={el} data-thumb={n} onClick={() => onPage(n)} className="flex flex-col items-center gap-1 rounded-[8px] p-1 hover:bg-surface-2" aria-label={`Page ${n}`}>
      <span className={cx("block aspect-[3/4] w-full overflow-hidden rounded-[3px] bg-[#FBFAF7]", active ? "outline-2 outline-accent" : "outline-1 outline-line", "outline")}>
        {src && <img src={src} alt="" className="h-full w-full object-contain" />}
      </span>
      <span className={cx("font-mono text-[11px]", active ? "font-semibold text-accent" : "text-muted")}>{n}</span>
    </button>
  );
});

// ------------------------------------------------------------------ outline
function Outline({ items, page, onPage }: { items: OutlineItem[] | null; page: number; onPage: (n: number) => void }) {
  if (!items) return <div className="p-4 text-[12.5px] text-muted">Reading bookmarks…</div>;
  if (!items.length) return <div className="p-4 text-[12.5px] leading-5 text-muted">This PDF has no bookmarks. Use the page thumbnails or search instead.</div>;
  // the section containing the current page
  let cur = -1;
  items.forEach((it, i) => { if (it.page && it.page <= page) cur = i; });
  return (
    <div className="flex flex-col py-1.5">
      {items.map((it, i) => (
        <button key={i} disabled={!it.page} onClick={() => it.page && onPage(it.page)} dir="auto"
          className={cx("flex min-h-9 items-center gap-2 py-1.5 pe-3 text-start text-[12.5px] leading-[17px] hover:bg-surface-2 disabled:opacity-50", i === cur ? "font-semibold text-ink" : "text-muted")}
          style={{ paddingInlineStart: 12 + it.depth * 14 }}>
          <span className="min-w-0 flex-1">{it.title}</span>
          {it.page > 0 && <span className="shrink-0 font-mono text-[11px] text-muted">{it.page}</span>}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ highlights panel
function HlPanel({ highlights, title, onHl, onAllNote, onExport }: { highlights: Highlight[]; title: string; onHl: (h: Highlight) => void; onAllNote: () => void; onExport: () => void }) {
  const [color, setColor] = useState<HlColor | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<"page" | "date">("page");
  const tags = useMemo(() => allTags(highlights), [highlights]);
  const shown = useMemo(() => sortHighlights(filterHighlights(highlights, { color, tag }), sort), [highlights, color, tag, sort]);
  if (!highlights.length) return <div className="p-4 text-[12.5px] leading-5 text-muted">No highlights yet. Select text on a page and pick a color, or switch on area mode to capture a figure.</div>;
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-2.5 py-2">
        {HL_COLORS.map((c) => (
          <button key={c.name} aria-label={`Only ${c.name}`} aria-pressed={color === c.name} title={c.name} onClick={() => setColor(color === c.name ? null : c.name)}
            className={cx("flex size-7 items-center justify-center rounded-full", color === c.name && "bg-surface-2")}>
            <span className={cx("size-3.5 rounded-full", color === c.name && "ring-2 ring-ink ring-offset-1 ring-offset-surface")} style={{ background: c.hex }} />
          </button>
        ))}
        <span className="flex-1" />
        <button onClick={() => setSort(sort === "page" ? "date" : "page")} className="flex h-7 items-center gap-1 rounded-[7px] px-2 text-[12px] text-muted hover:bg-surface-2 hover:text-ink" title="Sort"><ArrowDownUp size={13} />{sort === "page" ? "Page" : "Newest"}</button>
        {tags.length > 0 && (
          <div className="flex w-full flex-wrap gap-1 pt-1">
            {tags.map((t) => <button key={t} onClick={() => setTag(tag === t ? null : t)} className={cx("rounded-[6px] px-1.5 text-[11.5px] leading-[20px]", tag === t ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted hover:text-ink")}>#{t}</button>)}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        {shown.map((h) => <HlItem key={h.id} h={h} title={title} onClick={() => onHl(h)} />)}
        {!shown.length && <div className="p-3 text-[12.5px] text-muted">No highlights match this filter.</div>}
      </div>
      <div className="sticky bottom-0 flex flex-col gap-1 border-t border-line bg-surface p-2">
        <button onClick={onAllNote} className="flex h-9 items-center gap-2 rounded-[8px] px-2.5 text-[12.5px] hover:bg-surface-2"><FilePlus size={14} className="text-muted" />Make a note from all highlights</button>
        <button onClick={onExport} className="flex h-9 items-center gap-2 rounded-[8px] px-2.5 text-[12.5px] hover:bg-surface-2"><Download size={14} className="text-muted" />Export as Markdown</button>
      </div>
    </div>
  );
}

function AttImg({ src, className }: { src: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(src.startsWith("att:") ? null : src);
  useEffect(() => { if (src.startsWith("att:")) void resolveAtt(src.slice(4)).then(setUrl); }, [src]);
  return url ? <img src={url} alt="" className={className} draggable={false} /> : <span className={cx("flex items-center justify-center bg-surface-2 text-muted", className)}><ImageIcon size={16} /></span>;
}
export { AttImg };

function HlItem({ h, title, onClick }: { h: Highlight; title: string; onClick: () => void }) {
  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(HL_MIME, JSON.stringify({ title, h }));
        e.dataTransfer.setData("text/plain", hlCardText(title, h));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onClick}
      title="Click to jump · drag onto a canvas to make a card"
      className="flex w-full gap-2 rounded-[8px] border border-line bg-bg p-2 text-start hover:border-[color-mix(in_srgb,var(--accent)_50%,var(--border))]"
      style={{ borderInlineStartWidth: 3, borderInlineStartColor: hlHex(h.color) }}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {h.image ? <AttImg src={h.image} className="max-h-28 w-full rounded-[4px] object-contain" /> : <span dir="auto" className="line-clamp-4 text-[12.5px] leading-[18px] text-ink">{h.quote}</span>}
        {h.comment && <span dir="auto" className="line-clamp-2 text-[12px] leading-[17px] text-muted">{h.comment}</span>}
        <span className="flex flex-wrap items-center gap-1">
          <span className="rounded-[5px] bg-surface-2 px-1.5 font-mono text-[10.5px] leading-[18px] text-muted">p. {h.page}</span>
          {h.tags.map((t) => <span key={t} className="text-[11px] text-muted">#{t}</span>)}
        </span>
      </span>
    </button>
  );
}
