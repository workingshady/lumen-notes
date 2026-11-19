// One page of the PDF reader: renders (canvas + text layer) only while near the viewport, draws highlight overlays,
// margin markers, search hits and the area-mode rectangle. Highlights are stored as normalized rects, so they
// stay put through zoom and re-render.
import { memo, useEffect, useRef, useState } from "react";
import { rangesFor, renderPage, type PdfDoc } from "../lib/pdf-doc";
import { hlHex, type Highlight, type Rect } from "../lib/pdf-format";
import { dragRect, normRects, unionRect } from "../lib/pdf-geom";
import { t, useLang } from "../lib/i18n";
import { Glyph } from "./Glyph";

/** Margin markers: one numbered square per highlight (a pen when it has a comment), pushed down so they never overlap. */
function marks(hs: Highlight[], height: number) {
  const list = hs.map((h) => ({ h, y: (unionRect(h.rects)?.[1] ?? 0) * height })).sort((a, b) => a.y - b.y);
  let last = -Infinity;
  return list.map(({ h, y }, i) => { const top = Math.max(y, last + 20); last = top; return { h, top, n: i + 1 }; });
}

export interface PageProps {
  doc: PdfDoc;
  n: number;
  width: number;
  height: number;
  invert: boolean;
  root: HTMLElement | null;
  highlights: Highlight[];
  flash: string | null;
  hitSpans: [number, number][];
  activeHit: number;
  area: boolean;
  /** area selection waiting for a colour / action (dashed box) */
  pending: Rect | null;
  /** margin markers to the right of the page (desktop) */
  markers: boolean;
  onArea: (n: number, r: Rect) => void;
  onText: (n: number, hasText: boolean) => void;
  onPickHl: (id: string, x: number, y: number) => void;
}

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
const rectStyle = (r: Rect) => ({ left: pct(r[0]), top: pct(r[1]), width: pct(r[2]), height: pct(r[3]) });

export const PdfPage = memo(function PdfPage(p: PageProps) {
  useLang(); // memo: re-render on a language change (marker labels)
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(0); // bumps after each render (text layer changed)
  const [hitRects, setHitRects] = useState<Rect[][]>([]);
  const [draft, setDraft] = useState<Rect | null>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  // Near the viewport → render; far away → drop the canvas (memory stays flat on 500-page books).
  useEffect(() => {
    const el = box.current;
    if (!el || !p.root) return;
    const io = new IntersectionObserver((es) => setVisible(es[es.length - 1].isIntersecting), { root: p.root, rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [p.root]);

  useEffect(() => {
    const h = host.current;
    if (!h) return;
    if (!visible) { h.replaceChildren(); setRendered(0); return; }
    const signal = { cancelled: false };
    let cancel: (() => void) | null = null;
    const t = setTimeout(() => {
      void renderPage(p.doc, p.n, h, Math.round(p.width), { invert: p.invert, signal }).then((r) => {
        if (!r || signal.cancelled) return;
        cancel = r.cancel;
        p.onText(p.n, r.hasText);
        setRendered((x) => x + 1);
      });
    }, h.childElementCount ? 140 : 0);
    return () => { signal.cancelled = true; clearTimeout(t); cancel?.(); };
  }, [visible, p.width, p.invert, p.doc, p.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Search hits → normalized rects from the text layer.
  useEffect(() => {
    const tl = host.current?.querySelector<HTMLElement>(".textLayer");
    const b = box.current;
    if (!tl || !b || !p.hitSpans.length) { setHitRects([]); return; }
    const pb = b.getBoundingClientRect();
    setHitRects(rangesFor(tl, p.hitSpans).map((r) => normRects([...r.getClientRects()].map((c) => ({ left: c.left, top: c.top, width: c.width, height: c.height })), { left: pb.left, top: pb.top, width: pb.width, height: pb.height })));
  }, [rendered, p.hitSpans]);
  useEffect(() => { if (p.activeHit >= 0) activeRef.current?.scrollIntoView({ block: "center" }); }, [p.activeHit, hitRects]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r };
  };
  const onClick = (e: React.MouseEvent) => {
    if (p.area) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;
    const { x, y } = local(e);
    const pad = 0.004;
    const hit = [...p.highlights].reverse().find((h) => h.rects.some((r) => x >= r[0] - pad && x <= r[0] + r[2] + pad && y >= r[1] - pad && y <= r[1] + r[3] + pad));
    if (hit) p.onPickHl(hit.id, e.clientX, e.clientY);
  };

  // Area mode: draw a rectangle with mouse, pen or finger.
  const start = useRef<{ x: number; y: number } | null>(null);
  const areaHandlers = p.area ? {
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); start.current = { x: e.clientX, y: e.clientY }; setDraft(null); },
    onPointerMove: (e: React.PointerEvent) => { const s = start.current; if (!s) return; const r = box.current!.getBoundingClientRect(); setDraft(dragRect(s.x, s.y, e.clientX, e.clientY, r)); },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current; start.current = null;
      if (!s) return;
      const r = dragRect(s.x, s.y, e.clientX, e.clientY, box.current!.getBoundingClientRect());
      setDraft(null);
      if (r[2] > 0.02 && r[3] > 0.01) p.onArea(p.n, r);
    },
    onPointerCancel: () => { start.current = null; setDraft(null); },
  } : {};

  return (
    <div ref={box} className={"pdfr-page" + (p.invert ? " inverted" : "")} data-page={p.n} style={{ width: p.width, height: p.height }} onClick={onClick}>
      <div ref={host} className="pdfr-host" />
      <div className="pdfr-tint" aria-hidden /><div className="pdfr-tint2" aria-hidden />
      {!rendered && <div className="pdfr-skel" aria-hidden><i /><i /><i /><i /><i /></div>}
      <div className="pdfr-hls" aria-hidden>
        {p.highlights.map((h) => (
          <div key={h.id} className={"pdfr-hl-group" + (p.flash === h.id ? " pdfr-flash" : "")} data-hl={h.id}>
            {h.rects.map((r, i) => <div key={i} className={h.image ? "pdfr-area" : "pdfr-hl"} style={{ ...rectStyle(r), ["--hl" as string]: hlHex(h.color) }} />)}
          </div>
        ))}
        {hitRects.map((rs, k) => rs.map((r, i) => <div key={`${k}-${i}`} ref={k === p.activeHit && i === 0 ? activeRef : undefined} className={"pdfr-hit" + (k === p.activeHit ? " active" : "")} style={rectStyle(r)} />))}
      </div>
      {p.markers && marks(p.highlights, p.height).map(({ h, top, n }) => (
        <button key={h.id} type="button" className="pdfr-mark" title={h.comment || h.quote || t("Area highlight")} aria-label={t("Highlight {n} on page {page}", { n, page: p.n })}
          style={{ top, background: hlHex(h.color), color: h.color === "blue" || h.color === "purple" ? "#0F1115" : "#1F1D1A" }}
          onClick={(e) => { e.stopPropagation(); p.onPickHl(h.id, e.clientX, e.clientY); }}>
          {h.comment ? <Glyph name="d-draft" size={11} stroke={2.2} /> : n}
        </button>
      ))}
      {p.pending && <div className="pdfr-draft" style={rectStyle(p.pending)} />}
      {p.area && <div className="pdfr-areaz" {...areaHandlers}>{draft && <div className="pdfr-draft" style={rectStyle(draft)} />}</div>}
    </div>
  );
});
