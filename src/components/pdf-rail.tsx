// PDF reader side panels (Lumen 19 · PdfDesk): the left rail (Pages / Outline / Highlights, 220 px) and the right
// Highlights panel (320 px: by page, kind, comment, "Make a note from all highlights", "Export as Markdown").
// On phones the same lists sit in bottom sheets.
import { EmptyState } from "./EmptyState";
import { Image as ImageIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { resolveAtt } from "../lib/attachments";
import { renderThumb, type OutlineItem, type PdfDoc } from "../lib/pdf-doc";
import { allTags, filterHighlights, HL_COLORS, hlCardText, hlHex, sortHighlights, type HlColor, type Highlight } from "../lib/pdf-format";
import { HL_MIME } from "../lib/pdf-note";
import { PopMenu } from "./pdf-dialogs";
import { fmtNum, t, tk, useLang } from "../lib/i18n";
import { cx } from "./ui";

export type RailTab = "thumbs" | "outline" | "highlights";
const SERIF = "'Source Serif 4', Georgia, serif";

export function PdfRail(p: {
  doc: PdfDoc | null; pages: number; page: number; tab: RailTab; setTab: (t: RailTab) => void; outline: OutlineItem[] | null;
  highlights: Highlight[]; title: string; hitPages: Set<number>; invert: boolean; onPage: (n: number) => void; onHl: (h: Highlight) => void;
}) {
  const tabs: [RailTab, string][] = [["thumbs", tk("Pages")], ["outline", tk("Outline")], ["highlights", tk("Highlights")]];
  return (
    <div className="pdfr-rail flex h-full min-h-0 flex-col">
      <div role="tablist" className="m-[10px] flex shrink-0 gap-[2px] rounded-[8px] border border-line bg-bg p-[3px] text-[12px]">
        {tabs.map(([v, l]) => (
          <button key={v} role="tab" aria-selected={p.tab === v} onClick={() => p.setTab(v)}
            className={cx("flex h-6 flex-1 items-center justify-center whitespace-nowrap rounded-[6px]", p.tab === v ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}>{t(l)}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {p.tab === "thumbs" ? <Thumbs doc={p.doc} pages={p.pages} page={p.page} onPage={p.onPage} hitPages={p.hitPages} invert={p.invert} />
          : p.tab === "outline" ? <Outline items={p.outline} page={p.page} onPage={p.onPage} />
            : <RailHls highlights={p.highlights} title={p.title} onHl={p.onHl} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ thumbnails (rendered lazily as they scroll in)
function Thumbs({ doc, pages, page, onPage, hitPages, invert }: { doc: PdfDoc | null; pages: number; page: number; onPage: (n: number) => void; hitPages: Set<number>; invert: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector(`[data-thumb="${page}"]`)?.scrollIntoView({ block: "nearest" }); }, [page]);
  return (
    <div ref={ref} className="flex flex-col items-center gap-[14px] px-[30px] pb-4">
      {Array.from({ length: Math.max(pages, doc ? 0 : 4) }, (_, i) => <Thumb key={i} doc={doc} n={i + 1} active={page === i + 1} hit={hitPages.has(i + 1)} invert={invert} onPage={onPage} root={ref} />)}
    </div>
  );
}
const thumbCache = new WeakMap<PdfDoc, Map<number, string>>();
const Thumb = memo(function Thumb({ doc, n, active, hit, invert, onPage, root }: { doc: PdfDoc | null; n: number; active: boolean; hit: boolean; invert: boolean; onPage: (n: number) => void; root: React.RefObject<HTMLDivElement | null> }) {
  useLang(); // memo: re-render on a language / digits change
  const el = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState<string | null>(() => (doc ? thumbCache.get(doc)?.get(n) ?? null : null));
  useEffect(() => {
    if (!doc || src || !el.current) return;
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      void renderThumb(doc, n, 110).then((u) => {
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
    <button ref={el} data-thumb={n} onClick={() => onPage(n)} className="flex flex-col items-center gap-1" aria-label={t("Page {n}", { n })} aria-current={active ? "page" : undefined}>
      <span className={cx("pdfr-thumb relative block w-[110px] overflow-hidden rounded-[2px]", invert && "inverted")}
        style={{ aspectRatio: "612 / 792", boxShadow: active ? "0 0 0 2px var(--accent)" : "0 1px 4px rgba(0,0,0,.3)" }}>
        {src && <img src={src} alt="" className="h-full w-full object-cover object-top" />}
        {hit && <span className="absolute right-1 top-1 size-2 rounded-full bg-accent" />}
      </span>
      <span className={cx("text-[11px] tabular-nums", active ? "text-accent" : "text-muted")}>{fmtNum(n)}</span>
    </button>
  );
});

// ------------------------------------------------------------------ outline
function Outline({ items, page, onPage }: { items: OutlineItem[] | null; page: number; onPage: (n: number) => void }) {
  if (!items) return <div className="p-4 text-[12.5px] text-muted">{t("Reading bookmarks…")}</div>;
  if (!items.length) return <div className="p-4 text-[12.5px] leading-5 text-muted">{t("This PDF has no bookmarks. Use the page thumbnails or search instead.")}</div>;
  let cur = -1;
  items.forEach((it, i) => { if (it.page && it.page <= page) cur = i; });
  return (
    <div className="flex flex-col px-[10px] pb-3">
      {items.map((it, i) => (
        <button key={i} disabled={!it.page} onClick={() => it.page && onPage(it.page)} dir="auto"
          className={cx("flex min-h-8 items-center gap-2 rounded-[6px] py-1.5 pe-2 text-start text-[12.5px] leading-[17px] hover:bg-surface-2 disabled:opacity-50", i === cur ? "bg-surface-2 font-semibold text-ink" : "text-muted")}
          style={{ paddingInlineStart: 8 + it.depth * 14 }}>
          <span className="min-w-0 flex-1">{it.title}</span>
          {it.page > 0 && <span className="shrink-0 text-[11px] tabular-nums text-muted">{fmtNum(it.page)}</span>}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ rail: compact highlight cards
function RailHls({ highlights, title, onHl }: { highlights: Highlight[]; title: string; onHl: (h: Highlight) => void }) {
  const shown = useMemo(() => sortHighlights(highlights, "page"), [highlights]);
  if (!highlights.length) return <div className="p-4 text-[12.5px] leading-5 text-muted">{t("No highlights yet. Select text on a page and pick a colour, or switch on Area to capture a figure.")}</div>;
  return (
    <div className="flex flex-col gap-2 px-[10px] pb-3">
      {shown.map((h) => (
        <DragHl key={h.id} h={h} title={title} onClick={() => onHl(h)} className="flex flex-col gap-1 rounded-[8px] bg-bg px-[10px] py-2 text-start" style={{ borderInlineStart: `3px solid ${hlHex(h.color)}` }}>
          <span className="text-[11px] text-muted">{t("p. {n}", { n: h.page })}{h.tags.length ? ` · ${h.tags.map((tg) => "#" + tg).join(" ")}` : ""}</span>
          <HlBody h={h} size={13} lh={18} />
          {h.comment && <span dir="auto" className="text-[12px] text-muted">{h.comment}</span>}
        </DragHl>
      ))}
    </div>
  );
}

function HlBody({ h, size, lh }: { h: Highlight; size: number; lh: number }) {
  if (h.image && !h.quote) return <AttImg src={h.image} className="max-h-28 w-full rounded-[4px] object-contain" />;
  return <span dir="auto" className="line-clamp-5 font-normal text-ink" style={{ fontFamily: SERIF, fontSize: size, lineHeight: `${lh}px` }}>{h.quote}</span>;
}

function DragHl({ h, title, onClick, className, style, children }: { h: Highlight; title: string; onClick: () => void; className: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <button draggable onClick={onClick} className={className} style={style} title={t("Click to jump · drag onto a canvas to make a card")}
      onDragStart={(e) => { e.dataTransfer.setData(HL_MIME, JSON.stringify({ title, h })); e.dataTransfer.setData("text/plain", hlCardText(title, h)); e.dataTransfer.effectAllowed = "copy"; }}>
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ right panel (desktop) / sheet body (phone)
export function HlPanel({ highlights, title, onHl, onAllNote, onExport, sheet }: { highlights: Highlight[]; title: string; onHl: (h: Highlight) => void; onAllNote: () => void; onExport: () => void; sheet?: boolean }) {
  const [color, setColor] = useState<HlColor | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<"page" | "date">("page");
  const [menu, setMenu] = useState(false);
  const tags = useMemo(() => allTags(highlights), [highlights]);
  const shown = useMemo(() => sortHighlights(filterHighlights(highlights, { color, tag }), sort), [highlights, color, tag, sort]);
  const colorName = (c: HlColor) => t(c[0].toUpperCase() + c.slice(1)); // Yellow / Green / Blue / Red / Purple
  const label = (sort === "page" ? t("By page") : t("Newest first")) + (color ? ` · ${colorName(color)}` : "") + (tag ? ` · #${tag}` : "");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cx("relative flex shrink-0 items-center gap-2 border-b border-line", sheet ? "px-4 pb-3" : "p-[14px]")}>
        <span className="flex-1 font-semibold">{t("Highlights · {n}", { n: highlights.length })}</span>
        <button onClick={() => setMenu(!menu)} className="flex items-center gap-1 text-[12px] text-muted hover:text-ink" aria-haspopup="menu">{label}<span aria-hidden className="text-[9px]">▾</span></button>
        {menu && (
          <PopMenu onClose={() => setMenu(false)} className="end-[14px] top-[40px]" items={[
            { label: t("By page"), on: sort === "page", run: () => setSort("page") },
            { label: t("Newest first"), on: sort === "date", run: () => setSort("date") },
            "-",
            { label: t("All colours"), on: !color, run: () => setColor(null) },
            ...HL_COLORS.map((c) => ({ label: colorName(c.name), swatch: c.hex, on: color === c.name, run: () => setColor(c.name) })),
            ...(tags.length ? ["-" as const, { label: t("All tags"), on: !tag, run: () => setTag(null) }, ...tags.map((tg) => ({ label: "#" + tg, on: tag === tg, run: () => setTag(tg) }))] : []),
          ]} />
        )}
      </div>
      <div className={cx("flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto py-[10px]", sheet ? "px-4" : "px-[14px]")}>
        {shown.map((h) => (
          <DragHl key={h.id} h={h} title={title} onClick={() => onHl(h)} className="flex flex-col gap-[5px] border-b border-line pb-[10px] text-start">
            <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
              <span className="size-2 rounded-[2px]" style={{ background: hlHex(h.color) }} />{t("p. {n}", { n: h.page })}{h.tags.length ? ` · ${h.tags.map((tg) => "#" + tg).join(" ")}` : ""}
              <span className="flex-1" />{h.image ? t("area") : t("text")}
            </span>
            <HlBody h={h} size={13.5} lh={19} />
            {h.comment && <span dir="auto" className="text-[12.5px] text-muted">{h.comment}</span>}
          </DragHl>
        ))}
        {/* Lumen 21 empty state (the design's "Open reader" action is moot here: this panel lives in the reader) */}
        {!highlights.length && <EmptyState className="!px-2" glyph="pdf" text={t("No highlights yet. Select text on a page, or switch on Area to capture a figure.")} />}
        {highlights.length > 0 && !shown.length && <div className="py-3 text-[12.5px] text-muted">{t("No highlights match this filter.")}</div>}
      </div>
      <div className={cx("mt-auto flex shrink-0 flex-col gap-2 border-t border-line py-3", sheet ? "px-4" : "px-[14px]")}>
        <button disabled={!highlights.length} onClick={onAllNote} className="flex h-[34px] items-center justify-center rounded-[9px] bg-accent font-semibold text-accent-fg disabled:opacity-50">{t("Make a note from all highlights")}</button>
        <button disabled={!highlights.length} onClick={onExport} className="flex h-[30px] items-center justify-center text-muted hover:text-ink disabled:opacity-50">{t("Export as Markdown")}</button>
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
