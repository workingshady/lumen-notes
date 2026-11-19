// PDF reader for `type: pdf` notes (Lumen 19 · PdfDesk). Scroll or single-page view with virtualized pages, fit width /
// fit page / zoom levels, page field + keyboard, rail (Pages / Outline / Highlights), right Highlights panel, search with
// hit markers on pages + thumbnails, reading progress + "Continue where you left off", dark inversion, text and area
// highlights stored as Markdown in the note (lib/pdf-format.ts). States: loading in parts, password, scanned.
import { ArrowDown, ArrowUp } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { takePendingBlock } from "../lib/blocks";
import { download } from "../lib/io";
import { cropPage, flatOutline, hasTextLayer, openPdf, pageText, PdfError, textInRect, textOffset, type OutlineItem, type PdfDoc } from "../lib/pdf-doc";
import { highlightsMarkdown, hlLink, isoNow, newHlId, parseHighlights, pdfMeta, progressOf, searchPages, type HlColor, type Highlight, type Rect, type SearchHit } from "../lib/pdf-format";
import { normRects, unionRect } from "../lib/pdf-geom";
import { addHighlightToCanvas, appendFlashcard, deleteHighlight, noteFromAll, noteFromHighlight, saveAreaImage, saveHighlight, saveReading, takePdfJump } from "../lib/pdf-note";
import { openNote, toast } from "../lib/store";
import { Glyph } from "./Glyph";
import { CanvasPickSheet, FlashcardSheet, HighlightBar, PasswordPrompt, PopMenu, type MenuItem } from "./pdf-dialogs";
import { PdfPage } from "./pdf-page";
import { HlPanel, PdfRail, type RailTab } from "./pdf-rail";
import { cx, Sheet } from "./ui";

type Load = { kind: "loading"; loaded: number; total: number } | { kind: "ready" } | { kind: "error"; msg: string; password: boolean } | { kind: "password"; retry: boolean };
type Zoom = { mode: "width" | "page" | "custom"; scale: number };
type Sel = { page: number; rects: Rect[]; quote: string; text: [number, number] | null };
type Bar =
  | { kind: "new"; x: number; y: number; below: number; sel: Sel }
  | { kind: "area"; x: number; y: number; below: number; page: number; rect: Rect }
  | { kind: "edit"; x: number; y: number; below: number; id: string };

const PT = 96 / 72; // CSS px per PDF point at 100 %
const PART = 1_500_000; // attachments stream from D1 in 1.5 MB parts (lib/attachments.ts CHUNK)
const MAX_PAGE_W = 640; // "Fit width" page width on desktop (Lumen 19)
const EMPTY_H: Highlight[] = [];
const EMPTY_S: [number, number][] = [];
const ls = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
const usePhone = () => { const [p, setP] = useState(() => innerWidth < 768); useEffect(() => { const f = () => setP(innerWidth < 768); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return p; };
const mb = (b: number) => (b / 1048576).toFixed(1);
async function copy(text: string) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }
const ZOOMS = [50, 75, 100, 125, 150, 200, 300];

export function PdfReader({ note }: { note: Note }) {
  const meta = useMemo(() => pdfMeta(note.body), [note.body]);
  const highlights = useMemo(() => parseHighlights(note.body), [note.body]);
  const phone = usePhone();
  const [reload, setReload] = useState(0);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading", loaded: 0, total: 0 });
  const pwResolve = useRef<((pw: string | null) => void) | null>(null);

  // ---------------------------------------------------------------- open the file
  useEffect(() => {
    let dead = false, d: PdfDoc | null = null, last = 0;
    setDoc(null);
    setLoad({ kind: "loading", loaded: 0, total: 0 });
    openPdf(meta.file, {
      onProgress: (loaded, total) => { const t = Date.now(); if (!dead && (t - last > 120 || loaded === total)) { last = t; setLoad({ kind: "loading", loaded, total }); } },
      askPassword: (retry) => new Promise((res) => { pwResolve.current = res; if (!dead) setLoad({ kind: "password", retry }); }),
    }).then((x) => {
      if (dead) { void x.destroy(); return; }
      d = x; setDoc(x); setLoad({ kind: "ready" });
    }).catch((e: unknown) => { if (!dead) setLoad({ kind: "error", msg: e instanceof Error ? e.message : "Couldn't open this PDF.", password: e instanceof PdfError && e.kind === "password" }); });
    return () => { dead = true; pwResolve.current?.(null); void d?.destroy(); };
  }, [meta.file, reload]);
  const pages = doc?.numPages ?? 0;

  // page sizes (PDF points); every page starts with page 1's size, the rest are filled in the background
  const [sizes, setSizes] = useState<[number, number][]>([]);
  useEffect(() => {
    if (!doc) { setSizes([]); return; }
    let dead = false;
    void (async () => {
      const v = (await doc.getPage(1)).getViewport({ scale: 1 });
      const arr: [number, number][] = Array.from({ length: doc.numPages }, () => [v.width, v.height]);
      if (!dead) setSizes([...arr]);
      let changed = false;
      for (let i = 2; i <= Math.min(doc.numPages, 600) && !dead; i++) {
        const w = (await doc.getPage(i)).getViewport({ scale: 1 });
        if (w.width !== arr[i - 1][0] || w.height !== arr[i - 1][1]) { arr[i - 1] = [w.width, w.height]; changed = true; }
      }
      if (!dead && changed) setSizes([...arr]);
    })().catch(() => undefined);
    return () => { dead = true; };
  }, [doc]);
  const [outline, setOutline] = useState<OutlineItem[] | null>(null);
  const [hasText, setHasText] = useState(true);
  useEffect(() => {
    setOutline(null);
    if (!doc) return;
    void flatOutline(doc).then(setOutline);
    void hasTextLayer(doc).then(setHasText);
  }, [doc]);

  // ---------------------------------------------------------------- layout + zoom
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!scroller) return;
    const ro = new ResizeObserver(() => setView({ w: scroller.clientWidth, h: scroller.clientHeight }));
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [scroller]);
  const [zoom, setZoom] = useState<Zoom>(() => { try { return JSON.parse(ls.get("lumen.pdf.zoom." + note.id) ?? "") as Zoom; } catch { return { mode: "width", scale: 1 }; } });
  useEffect(() => ls.set("lumen.pdf.zoom." + note.id, JSON.stringify(zoom)), [zoom, note.id]);
  const [single, setSingle] = useState(() => ls.get("lumen.pdf.single") === "1");
  useEffect(() => ls.set("lumen.pdf.single", single ? "1" : "0"), [single]);
  const PAD = phone ? 10 : 56, GAP = phone ? 10 : 16, TOP = phone ? 12 : 28;
  const maxW = sizes.length ? Math.max(...sizes.map((s) => s[0])) : 612;
  const fitW = Math.max(0.2, Math.min(phone ? Infinity : MAX_PAGE_W, view.w - PAD * 2) / maxW);
  const fitP = Math.min(Math.max(0.2, (view.w - PAD * 2) / maxW), Math.max(0.2, (view.h - TOP * 2) / (sizes[0]?.[1] ?? 792)));
  const scale = zoom.mode === "width" ? fitW : zoom.mode === "page" ? fitP : zoom.scale;
  const pct = Math.round((scale / PT) * 100);
  const zoomBy = useCallback((f: number) => setZoom({ mode: "custom", scale: Math.min(5 * PT, Math.max(0.25 * PT, scale * f)) }), [scale]);

  // ---------------------------------------------------------------- current page, goto, keep position through zoom
  const [page, setPage] = useState(1);
  const shown = useMemo(() => (single ? [page] : sizes.map((_, i) => i + 1)), [single, page, sizes]);
  const lay = useMemo(() => {
    const tops: number[] = [];
    let y = TOP;
    for (const n of shown) { tops[n - 1] = y; y += (sizes[n - 1]?.[1] ?? 0) * scale + GAP; }
    return { tops, total: y - GAP + TOP };
  }, [sizes, scale, TOP, GAP, shown]);
  const anchor = useRef({ page: 1, frac: 0 });
  const moved = useRef(false); // the reader has been scrolled / navigated (only then is the position saved)
  const pageAt = useCallback((y: number) => { let best = 1; for (let i = 0; i < lay.tops.length; i++) if (lay.tops[i] !== undefined && lay.tops[i] <= y) best = i + 1; return best; }, [lay]);
  const goto = useCallback((n: number, yFrac = 0, smooth = false) => {
    if (!scroller || !sizes.length) return;
    const p = Math.max(1, Math.min(sizes.length, n));
    moved.current = true;
    if (single) {
      setPage(p);
      requestAnimationFrame(() => scroller.scrollTo({ top: yFrac ? Math.max(0, TOP + yFrac * sizes[p - 1][1] * scale - view.h * 0.3) : 0 }));
      return;
    }
    const top = lay.tops[p - 1] + yFrac * sizes[p - 1][1] * scale - (yFrac ? view.h * 0.3 : 8);
    scroller.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  }, [scroller, sizes, lay, scale, view.h, single, TOP]);
  const onScroll = useCallback(() => {
    if (!scroller || !sizes.length || single) return;
    const p = pageAt(scroller.scrollTop + scroller.clientHeight * 0.35);
    if (scroller.scrollTop > 4) moved.current = true;
    setPage(p);
    const h = sizes[p - 1][1] * scale;
    anchor.current = { page: p, frac: (scroller.scrollTop - lay.tops[p - 1]) / h };
  }, [scroller, sizes, scale, lay, pageAt, single]);
  const prevScale = useRef(scale);
  useLayoutEffect(() => {
    if (!scroller || prevScale.current === scale || !sizes.length || single) { prevScale.current = scale; return; }
    prevScale.current = scale;
    const { page: p, frac } = anchor.current;
    scroller.scrollTop = lay.tops[p - 1] + frac * sizes[p - 1][1] * scale;
  }, [scale, scroller, lay, sizes, single]);
  // switching scroll ↔ single keeps the page
  const prevSingle = useRef(single);
  useLayoutEffect(() => {
    if (prevSingle.current === single || !scroller) return;
    prevSingle.current = single;
    if (single) scroller.scrollTop = 0; else if (lay.tops[page - 1] !== undefined) scroller.scrollTop = lay.tops[page - 1] - 8;
  }, [single, scroller, lay, page]);
  // single page: wheel past the bottom / top edge turns the page
  const wheelAt = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    if (!single || !scroller || e.ctrlKey) return;
    const now = Date.now();
    if (now - wheelAt.current < 450) return;
    const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2, atTop = scroller.scrollTop <= 0;
    if (e.deltaY > 30 && atEnd && page < pages) { wheelAt.current = now; goto(page + 1); }
    else if (e.deltaY < -30 && atTop && page > 1) { wheelAt.current = now; goto(page - 1); }
  };

  // ---------------------------------------------------------------- resume ("Continue where you left off") / jump to a highlight
  const [jump] = useState(() => takePdfJump(note.id) ?? (() => { const id = takePendingBlock(note.title); return id ? { page: 0, hl: id } : null; })());
  const [flash, setFlash] = useState<string | null>(null);
  const [resume, setResume] = useState(0);
  const restored = useRef(false);
  const flashHl = useCallback((h: Highlight) => {
    const u = unionRect(h.rects);
    goto(h.page, u ? u[1] : 0);
    setFlash(h.id);
    setTimeout(() => setFlash((f) => (f === h.id ? null : f)), 2000);
  }, [goto]);
  useEffect(() => {
    if (restored.current || !doc || !sizes.length || !view.h) return;
    restored.current = true;
    if (meta.pages !== doc.numPages) void saveReading(note.id, { pages: doc.numPages });
    const h = jump?.hl ? highlights.find((x) => x.id === jump.hl) : undefined;
    if (h) flashHl(h);
    else if (jump?.page) goto(jump.page);
    else if (meta.page > 1 && meta.page <= sizes.length) setResume(meta.page);
  }, [doc, sizes, view.h]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (resume && page >= resume) setResume(0); }, [page, resume]);
  const furthest = Math.max(meta.progress, progressOf(page, pages));

  // reading position → front matter (debounced; keeps the note's "updated" time). Not before the reader has moved,
  // so opening a paper at page 1 with a "Continue" offer doesn't overwrite the saved page.
  useEffect(() => {
    if (!restored.current || !pages || !moved.current) return;
    const t = setTimeout(() => {
      if (page !== meta.page || furthest !== meta.progress || pages !== meta.pages) void saveReading(note.id, { page, progress: furthest, pages });
    }, 1500);
    return () => clearTimeout(t);
  }, [page, pages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- search
  const [search, setSearch] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [hitIdx, setHitIdx] = useState(0);
  const [searching, setSearching] = useState(false);
  const qRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!doc || !search || q.trim().length < 2) { setHits([]); return; }
    let dead = false;
    const t = setTimeout(async () => {
      setSearching(true);
      const texts: string[] = [];
      for (let i = 1; i <= doc.numPages && !dead; i++) texts.push(await pageText(doc, i));
      if (dead) return;
      const hs = searchPages(texts, q);
      setHits(hs); setSearching(false);
      const first = hs.findIndex((h) => h.page >= page);
      setHitIdx(first < 0 ? 0 : first);
    }, 250);
    return () => { dead = true; clearTimeout(t); setSearching(false); };
  }, [q, doc, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = hits[hitIdx];
  useEffect(() => { if (cur) goto(cur.page); }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const spansByPage = useMemo(() => {
    const m = new Map<number, [number, number][]>();
    const len = q.trim().length;
    for (const h of hits) { if (!m.has(h.page)) m.set(h.page, []); m.get(h.page)!.push([h.at, len]); }
    return m;
  }, [hits, q]);
  const hitPages = useMemo(() => new Set(spansByPage.keys()), [spansByPage]);
  const stepHit = (d: number) => hits.length && setHitIdx((i) => (i + d + hits.length) % hits.length);
  const openSearch = () => { setSearch(true); setTimeout(() => qRef.current?.select(), 0); };

  // ---------------------------------------------------------------- highlights
  const hlByPage = useMemo(() => {
    const m = new Map<number, Highlight[]>();
    for (const h of highlights) { if (!m.has(h.page)) m.set(h.page, []); m.get(h.page)!.push(h); }
    return m;
  }, [highlights]);
  const [lastColor, setLastColor] = useState<HlColor>(() => (ls.get("lumen.pdf.color") as HlColor) || "yellow");
  const [bar, setBar] = useState<Bar | null>(null);
  const barRef = useRef(bar);
  barRef.current = bar;
  const [area, setArea] = useState(false);
  const [invert, setInvert] = useState(() => ls.get("lumen.pdf.invert") === "1");
  useEffect(() => ls.set("lumen.pdf.invert", invert ? "1" : "0"), [invert]);
  const [card, setCard] = useState<Highlight | null>(null);
  const [canvasFor, setCanvasFor] = useState<Highlight | null>(null);
  const stageXY = (r: { left: number; top: number; width: number; bottom: number }) => {
    const sr = stage.current!.getBoundingClientRect();
    return { x: r.left + r.width / 2 - sr.left, y: r.top - sr.top, below: r.bottom - sr.top };
  };

  // text selection → "new" bar (mouse, keyboard and long-press selections all end in selectionchange)
  const checkSel = useCallback(() => {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !scroller || !stage.current) { if (barRef.current?.kind === "new") setBar(null); return; }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const pageEl = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(".pdfr-page");
    if (!pageEl || !scroller.contains(pageEl)) return;
    const quote = sel.toString().replace(/\s+/g, " ").trim();
    if (!quote) return;
    const pb = pageEl.getBoundingClientRect();
    const rects = normRects([...range.getClientRects()].filter((r) => r.bottom > pb.top && r.top < pb.bottom).map((r) => ({ left: r.left, top: r.top, width: r.width, height: r.height })), { left: pb.left, top: pb.top, width: pb.width, height: pb.height });
    if (!rects.length) return;
    const tl = pageEl.querySelector<HTMLElement>(".textLayer");
    setBar({ kind: "new", ...stageXY(range.getBoundingClientRect()), sel: { page: Number(pageEl.dataset.page), rects, quote, text: tl ? textOffset(tl, range) : null } });
  }, [scroller]);
  useEffect(() => {
    let t = 0;
    const on = () => { clearTimeout(t); t = window.setTimeout(checkSel, 180); };
    document.addEventListener("selectionchange", on);
    return () => { document.removeEventListener("selectionchange", on); clearTimeout(t); };
  }, [checkSel]);

  const pageEl = (n: number) => scroller?.querySelector<HTMLElement>(`.pdfr-page[data-page="${n}"]`) ?? null;
  const create = async (color: HlColor): Promise<Highlight | null> => {
    const b = barRef.current;
    if (!b || b.kind === "edit") return null;
    if (b.kind === "area") {
      if (!doc) return null;
      const el = pageEl(b.page);
      try {
        const blob = await cropPage(doc, b.page, b.rect, (sizes[b.page - 1]?.[0] ?? 612) * scale);
        if (!blob) throw new Error("capture");
        const image = await saveAreaImage(blob, note.title, b.page);
        const h: Highlight = { id: newHlId(), color, page: b.page, quote: el ? textInRect(el, b.rect).slice(0, 400) : "", image, tags: [], rects: [b.rect], created: isoNow() };
        await saveHighlight(note.id, h);
        return h;
      } catch { toast("Couldn't capture that area"); return null; }
    }
    const h: Highlight = { id: newHlId(), color, page: b.sel.page, quote: b.sel.quote, tags: [], rects: b.sel.rects, ...(b.sel.text ? { text: b.sel.text } : {}), created: isoNow() };
    await saveHighlight(note.id, h);
    getSelection()?.removeAllRanges();
    return h;
  };
  /** The highlight the bar acts on (creating it from the selection / area when needed). */
  const target = async (): Promise<Highlight | null> => {
    const b = barRef.current;
    if (!b) return null;
    if (b.kind === "edit") return highlights.find((h) => h.id === b.id) ?? null;
    return create(lastColor);
  };
  const pickColor = async (c: HlColor) => {
    setLastColor(c); ls.set("lumen.pdf.color", c);
    const b = barRef.current;
    if (b?.kind === "edit") { const h = highlights.find((x) => x.id === b.id); if (h) await saveHighlight(note.id, { ...h, color: c }); return; }
    const h = await create(c);
    setBar(null);
    if (h?.image) setArea(false);
  };
  const actNote = async () => {
    const h = await target(); setBar(null);
    if (!h) return;
    const n = await noteFromHighlight(note, h);
    toast(`Note created: ${n.title}`, { label: "Open", run: () => openNote(n.id, "edit") });
  };
  const actCard = async () => { const h = await target(); setBar(null); if (h) setCard(h); };
  const actCopy = async () => {
    const b = barRef.current;
    const h = b?.kind === "edit" ? highlights.find((x) => x.id === b.id) : undefined;
    const quote = b?.kind === "new" ? b.sel.quote : b?.kind === "area" ? (pageEl(b.page) ? textInRect(pageEl(b.page)!, b.rect) : "") : h?.quote ?? "";
    const p = b?.kind === "new" ? b.sel.page : b?.kind === "area" ? b.page : h?.page ?? page;
    toast(await copy(`“${quote}” (${note.title}, p. ${p})`) ? "Quote copied" : "Couldn't copy");
  };
  const actLink = async () => { const h = await target(); setBar(null); if (h) toast(await copy(hlLink(note.title, h)) ? "Link copied. Paste it into any note." : "Couldn't copy"); };
  const actDelete = async () => {
    const b = barRef.current;
    const h = b?.kind === "edit" ? highlights.find((x) => x.id === b.id) : undefined;
    setBar(null);
    if (!h) return;
    await deleteHighlight(note.id, h.id);
    toast("Highlight deleted", { label: "Undo", run: () => void saveHighlight(note.id, h) });
  };
  const actMeta = (comment: string, tags: string[]) => {
    const b = barRef.current;
    const h = b?.kind === "edit" ? highlights.find((x) => x.id === b.id) : undefined;
    if (h && (comment !== (h.comment ?? "") || tags.join(" ") !== h.tags.join(" "))) void saveHighlight(note.id, { ...h, comment: comment || undefined, tags });
  };
  const onPickHl = useCallback((id: string, x: number, y: number) => {
    const sr = stage.current?.getBoundingClientRect();
    if (!sr) return;
    setBar({ kind: "edit", id, x: x - sr.left, y: y - sr.top - 6, below: y - sr.top + 14 });
  }, []);
  // area mode: a dragged box waits (dashed) for a colour or an action, like a text selection
  const onArea = useCallback((n: number, r: Rect) => {
    const el = scroller?.querySelector<HTMLElement>(`.pdfr-page[data-page="${n}"]`);
    const sr = stage.current?.getBoundingClientRect();
    if (!el || !sr) return;
    const pb = el.getBoundingClientRect();
    const bottom = pb.top + (r[1] + r[3]) * pb.height - sr.top;
    setBar({ kind: "area", page: n, rect: r, x: pb.left + (r[0] + r[2] / 2) * pb.width - sr.left, y: bottom + 24, below: bottom - 22 });
  }, [scroller]);
  const onText = useCallback(() => undefined, []);

  // ---------------------------------------------------------------- panels, menus, keyboard
  const [railOpen, setRailOpen] = useState(() => ls.get("lumen.pdf.rail") !== "0");
  useEffect(() => ls.set("lumen.pdf.rail", railOpen ? "1" : "0"), [railOpen]);
  const [panel, setPanel] = useState(() => ls.get("lumen.pdf.panel") === "1");
  useEffect(() => ls.set("lumen.pdf.panel", panel ? "1" : "0"), [panel]);
  const [sheet, setSheet] = useState<null | "rail" | "highlights">(null);
  const [menu, setMenu] = useState<null | "more" | "fit">(null);
  const [tab, setTab] = useState<RailTab>("thumbs");
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); openSearch(); return; }
      if (t.closest("input,textarea,select,[contenteditable=true]") || card || canvasFor || sheet || menu || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); goto(page + 1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); goto(page - 1); }
      else if (e.key === "Home") { e.preventDefault(); goto(1); }
      else if (e.key === "End") { e.preventDefault(); goto(pages); }
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1.15); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomBy(1 / 1.15); }
      else if (e.key === "Escape") { if (bar) setBar(null); else if (area) setArea(false); else if (search) setSearch(false); else if (resume) setResume(0); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [goto, page, pages, zoomBy, bar, area, search, card, canvasFor, sheet, menu, resume]);

  // ---------------------------------------------------------------- render
  const ready = load.kind === "ready" && sizes.length > 0;
  const [pageField, setPageField] = useState<string | null>(null);
  const fitLabel = zoom.mode === "width" ? "Fit width" : zoom.mode === "page" ? "Fit page" : `${pct}%`;
  const allNote = async () => { if (!highlights.length) return; const n = await noteFromAll(note, highlights); setSheet(null); toast(`Created “${n.title}”`, { label: "Open", run: () => openNote(n.id, "read") }); };
  const exportMd = () => download(`${note.title} highlights.md`, highlightsMarkdown(note.title, highlights), "text/markdown");
  const onHl = (h: Highlight) => { flashHl(h); setSheet(null); };
  const rail = (
    <PdfRail doc={doc} pages={pages} page={page} tab={tab} setTab={setTab} outline={outline} highlights={highlights} title={note.title} hitPages={hitPages} invert={invert}
      onPage={(n) => { goto(n); setSheet(null); }} onHl={onHl} />
  );
  const hlPanel = (sheetMode: boolean) => <HlPanel highlights={highlights} title={note.title} onHl={onHl} onAllNote={allNote} onExport={exportMd} sheet={sheetMode} />;
  const barH = bar?.kind === "edit" ? highlights.find((h) => h.id === bar.id) : undefined;
  const moreItems: MenuItem[] = phone ? [
    { label: "Highlights", hint: String(highlights.length), run: () => setSheet("highlights") },
    { label: "Pages and outline", run: () => { setTab("thumbs"); setSheet("rail"); } },
    { label: "Find in document", run: openSearch },
    "-",
    { label: "Scroll", on: !single, run: () => setSingle(false) },
    { label: "Single page", on: single, run: () => setSingle(true) },
    { label: "Fit width", on: zoom.mode === "width", run: () => setZoom({ mode: "width", scale }) },
    { label: "Zoom in", hint: `${pct}%`, run: () => zoomBy(1.2) },
    { label: "Zoom out", run: () => zoomBy(1 / 1.2) },
    "-",
    { label: "Dark pages", on: invert, run: () => setInvert(!invert) },
    { label: "Export highlights as Markdown", run: exportMd },
  ] : [
    { label: "Pages sidebar", on: railOpen, run: () => setRailOpen(!railOpen) },
    { label: "Highlights panel", on: panel, hint: String(highlights.length), run: () => setPanel(!panel) },
    "-",
    { label: "Dark pages", on: invert, hint: "images kept", run: () => setInvert(!invert) },
    { label: "Make a note from all highlights", run: () => void allNote() },
    { label: "Export highlights as Markdown", run: exportMd },
  ];
  const fitItems: MenuItem[] = [
    { label: "Fit width", on: zoom.mode === "width", run: () => setZoom({ mode: "width", scale }) },
    { label: "Fit page", on: zoom.mode === "page", run: () => setZoom({ mode: "page", scale }) },
    "-",
    ...ZOOMS.map((z) => ({ label: `${z}%`, on: zoom.mode === "custom" && pct === z, run: () => setZoom({ mode: "custom", scale: (z / 100) * PT }) })),
    "-",
    { label: "Zoom in", hint: "+", run: () => zoomBy(1.15) },
    { label: "Zoom out", hint: "−", run: () => zoomBy(1 / 1.15) },
  ];
  const tb = "flex h-7 items-center gap-1.5 rounded-[7px] border border-line px-2.5 text-[13px] text-ink hover:bg-surface-2";
  const loadParts = load.kind === "loading" && load.total > PART ? Math.ceil(load.total / PART) : 0;
  const skelW = phone ? Math.max(240, (view.w || 412) - 20) : 640, skelH = phone ? Math.round(skelW * 1.94) : 830;

  return (
    <div className={cx("pdfr relative flex h-full min-h-0 flex-col bg-bg text-[13px]", invert && "pdfr-inv")}>
      {/* toolbar */}
      <div className={cx("flex shrink-0 items-center gap-2.5 border-b border-line", phone ? "h-[52px] px-3" : "h-12 px-5")}>
        <Glyph name="pdf" size={18} color="var(--danger)" />
        <span dir="auto" className="min-w-0 flex-1 truncate font-semibold">{note.title}</span>
        {!phone && (
          <span className="flex items-center gap-1.5 text-muted" title="Furthest point read (saved with the note)">
            <span className="h-1 w-20 rounded-[2px] bg-surface-2"><span className="block h-full rounded-[2px] bg-ink" style={{ width: `${furthest}%` }} /></span>{furthest}%
          </span>
        )}
        {!phone && (
          <div className="flex gap-[2px] rounded-[9px] border border-line bg-surface p-[3px] text-[12px]" role="radiogroup" aria-label="Page layout">
            {([[false, "Scroll"], [true, "Single"]] as const).map(([v, l]) => (
              <button key={l} role="radio" aria-checked={single === v} onClick={() => setSingle(v)} className={cx("flex h-6 items-center rounded-[6px] px-[9px]", single === v ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}>{l}</button>
            ))}
          </div>
        )}
        {!phone && (
          <span className="relative">
            <button className={tb} aria-haspopup="menu" onClick={() => setMenu(menu === "fit" ? null : "fit")}>{fitLabel}<span aria-hidden className="text-[9px]">▾</span></button>
            {menu === "fit" && <PopMenu items={fitItems} onClose={() => setMenu(null)} className="right-0 top-9" />}
          </span>
        )}
        <span className="flex items-center font-mono text-[12px] text-muted">
          <input aria-label="Page" inputMode="numeric" className="w-[3ch] bg-transparent text-end text-muted outline-none focus:text-ink" style={{ width: `${Math.max(1, String(pageField ?? page).length) + 0.4}ch` }}
            value={pageField ?? String(page)} onFocus={(e) => { setPageField(String(page)); e.target.select(); }} onChange={(e) => setPageField(e.target.value.replace(/\D/g, ""))}
            onBlur={() => setPageField(null)} onKeyDown={(e) => { if (e.key === "Enter") { goto(Number(pageField) || page); (e.target as HTMLInputElement).blur(); } else if (e.key === "Escape") (e.target as HTMLInputElement).blur(); }} />
          <span>&nbsp;/ {pages || meta.pages || "–"}</span>
        </span>
        <button aria-pressed={area} title={area ? "Area on: drag a box over a figure" : "Area: highlight a figure or a paragraph as an image"} onClick={() => { setArea(!area); setBar(null); }}
          className={cx("flex h-7 items-center gap-1.5 rounded-[7px] border px-2.5", area ? "border-accent bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]" : "border-line hover:bg-surface-2")}>
          <Glyph name="occlusion" size={14} />{!phone && "Area"}
        </button>
        {!phone && (
          <button aria-label="Find in document (Ctrl+F)" title="Find in document (Ctrl+F)" aria-pressed={search} onClick={() => (search ? setSearch(false) : openSearch())}
            className={cx("flex size-7 items-center justify-center rounded-[7px] border", search ? "border-accent" : "border-line hover:bg-surface-2")}><Glyph name="query" size={14} /></button>
        )}
        <span className="relative">
          <button aria-label="PDF menu" aria-haspopup="menu" onClick={() => setMenu(menu === "more" ? null : "more")} className={cx("flex items-center justify-center rounded-[7px] text-[16px] text-muted hover:text-ink", phone ? "size-11" : "h-7 w-6")}>⋯</button>
          {menu === "more" && <PopMenu items={moreItems} onClose={() => setMenu(null)} className="right-0 top-9" />}
        </span>
      </div>
      {search && (
        <div className={cx("flex h-11 shrink-0 items-center gap-2.5 border-b border-line bg-surface", phone ? "px-3" : "px-5")}>
          <input ref={qRef} dir="auto" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find in document" aria-label="Find in document"
            className={cx("h-[30px] min-w-0 rounded-[6px] border border-accent bg-bg px-2.5 text-ink outline-none", phone ? "flex-1" : "w-[280px]")}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); stepHit(e.shiftKey ? -1 : 1); } else if (e.key === "Escape") { setSearch(false); setQ(""); } }} />
          <span className="truncate whitespace-nowrap text-muted">{searching ? "Searching…" : q.trim().length >= 2 ? (hits.length ? `${hitIdx + 1} of ${hits.length} · ${hitPages.size === 1 ? "page" : "pages"} ${[...hitPages].slice(0, 6).join(", ")}${hitPages.size > 6 ? "…" : ""}` : "No matches") : ""}</span>
          <button aria-label="Previous match" onClick={() => stepHit(-1)} className="flex size-7 items-center justify-center rounded-[6px] hover:bg-surface-2"><ArrowUp size={15} /></button>
          <button aria-label="Next match" onClick={() => stepHit(1)} className="flex size-7 items-center justify-center rounded-[6px] hover:bg-surface-2"><ArrowDown size={15} /></button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {!phone && railOpen && load.kind !== "password" && <aside className="w-[220px] shrink-0 border-e border-line bg-surface">{rail}</aside>}
        <div ref={stage} className="pdfr-stage relative min-w-0 flex-1">
          {load.kind === "password" ? (
            <div className="absolute inset-0 flex items-center justify-center pb-20">
              <PasswordPrompt retry={load.retry} onSubmit={(pw) => { setLoad({ kind: "loading", loaded: 0, total: 0 }); pwResolve.current?.(pw); }} onCancel={() => pwResolve.current?.(null)} />
            </div>
          ) : load.kind === "error" ? (
            <div className="mx-auto mt-[14vh] flex max-w-[400px] flex-col items-center gap-3 px-6 text-center">
              <div className="text-[16px] font-semibold">{load.password ? "This PDF is locked" : "Couldn't open this PDF"}</div>
              <div className="text-[13px] leading-5 text-muted">{load.msg}</div>
              <button className="h-9 rounded-[9px] bg-accent px-4 font-semibold text-accent-fg" onClick={() => setReload((r) => r + 1)}>{load.password ? "Enter password" : "Try again"}</button>
              <div className="text-[12px] text-muted">Highlights are kept in the note. Press Edit to see them as Markdown.</div>
            </div>
          ) : !ready ? (
            <div className="absolute inset-0 flex justify-center overflow-hidden" style={{ paddingTop: TOP }}>
              <div className="flex shrink-0 flex-col gap-3 rounded-[2px] bg-surface" style={{ width: skelW, height: skelH, maxHeight: `calc(100% - ${TOP + 16}px)`, padding: phone ? "22px 20px" : "48px 56px" }} aria-busy>
                <span className="h-4 w-[40%] rounded-[4px] bg-surface-2" />
                {["100%", "96%", "92%", "100%", "88%", "95%", "70%", "98%"].map((w, i) => <span key={i} className="h-[9px] rounded-[4px] bg-surface-2" style={{ width: w }} />)}
                <span className="mt-auto text-[12px] text-muted">
                  {load.kind === "loading" && loadParts ? `Loading part ${Math.min(loadParts, Math.floor(load.loaded / PART) + 1)} of ${loadParts} · ${mb(load.loaded)} of ${mb(load.total)} MB`
                    : load.kind === "loading" && load.loaded > 0 ? `Loading · ${mb(load.loaded)} MB` : "Opening…"}
                </span>
              </div>
            </div>
          ) : null}
          <div ref={setScroller} onWheel={onWheel}
            onScroll={() => { onScroll(); if (barRef.current?.kind === "new") checkSel(); else if (barRef.current && !document.activeElement?.closest(".pdfr-bar")) setBar(null); }}
            onMouseDown={(e) => { if (barRef.current && barRef.current.kind !== "new" && !(e.target as HTMLElement).closest(".pdfr-mark,.pdfr-bar")) setBar(null); }}
            className={cx("pdfr-scroll absolute inset-0 overflow-auto", !ready && "invisible", area && "pdfr-areamode")}>
            {doc && sizes.length > 0 && (
              <div className="pdfr-pages" style={{ padding: `${TOP}px ${PAD}px`, gap: GAP }}>
                {shown.map((n) => (
                  <PdfPage key={n} doc={doc} n={n} width={sizes[n - 1][0] * scale} height={sizes[n - 1][1] * scale} invert={invert} root={scroller}
                    highlights={hlByPage.get(n) ?? EMPTY_H} flash={flash && hlByPage.get(n)?.some((h) => h.id === flash) ? flash : null}
                    hitSpans={spansByPage.get(n) ?? EMPTY_S} activeHit={cur && cur.page === n ? cur.index : -1}
                    area={area} pending={bar?.kind === "area" && bar.page === n ? bar.rect : null} markers={!phone}
                    onArea={onArea} onText={onText} onPickHl={onPickHl} />
                ))}
              </div>
            )}
          </div>
          {/* search hit markers on the scrollbar */}
          {hits.length > 0 && lay.total > 0 && !single && (
            <div className="pdfr-track" aria-hidden>
              {[...hitPages].map((p) => <i key={p} className={cur?.page === p ? "active" : ""} style={{ top: `${((lay.tops[p - 1] + (sizes[p - 1]?.[1] ?? 0) * scale * 0.5) / lay.total) * 100}%` }} />)}
            </div>
          )}
          {ready && !hasText && (
            <div className="absolute left-1/2 top-[14px] z-20 flex h-9 max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 overflow-hidden whitespace-nowrap rounded-full border border-line bg-surface-2 px-3.5">
              <Glyph name="c-info" size={15} color="var(--info)" />
              <span className="truncate">Scanned PDF: no text to select. Use <button className="font-semibold" onClick={() => setArea(true)}>Area</button> to highlight figures and paragraphs.</span>
            </div>
          )}
          {ready && resume > 0 && (
            <div className="absolute bottom-5 left-1/2 z-20 flex h-10 max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-[10px] border border-line bg-surface-2 pe-2 ps-3.5 shadow-[0_12px_28px_rgba(0,0,0,.4)]">
              <span className="truncate">Continue where you left off · p. {resume} ({meta.progress}%)</span>
              <button className="flex h-7 items-center rounded-[7px] bg-accent px-2.5 font-semibold text-accent-fg" onClick={() => { goto(resume); setResume(0); }}>Continue</button>
            </div>
          )}
          {bar && (bar.kind !== "edit" || barH) && (
            <HighlightBar key={bar.kind === "edit" ? bar.id : bar.kind} kind={bar.kind} h={barH} color={barH?.color ?? lastColor} x={bar.x} y={bar.y} below={bar.below} phone={phone}
              onColor={pickColor} onNote={actNote} onCard={actCard} onCopy={actCopy} onLink={actLink}
              onCanvas={bar.kind === "edit" ? () => { setCanvasFor(barH ?? null); setBar(null); } : undefined}
              onDelete={bar.kind === "edit" ? actDelete : undefined} onMeta={actMeta} />
          )}
        </div>
        {!phone && panel && load.kind !== "password" && <aside className="w-[320px] shrink-0 border-s border-line bg-surface">{hlPanel(false)}</aside>}
      </div>

      {phone && <Sheet open={sheet === "rail"} onClose={() => setSheet(null)} title={note.title}><div className="-mx-4 -mb-4 h-[62dvh]">{rail}</div></Sheet>}
      {phone && <Sheet open={sheet === "highlights"} onClose={() => setSheet(null)}><div className="-mx-4 -mb-4 h-[66dvh]">{hlPanel(true)}</div></Sheet>}
      <FlashcardSheet open={!!card} onClose={() => setCard(null)} quote={card?.quote ?? ""} pdfTitle={note.title}
        onSave={async (tgt, fq, fa) => { if (!card) return; const n = await appendFlashcard(tgt, fq, fa, note, card); setCard(null); toast(`Card added to “${n.title}”`, { label: "Open", run: () => openNote(n.id, "edit") }); }} />
      <CanvasPickSheet open={!!canvasFor} onClose={() => setCanvasFor(null)} spaceId={note.spaceId}
        onPick={async (id) => { if (!canvasFor) return; await addHighlightToCanvas(id, note, canvasFor); setCanvasFor(null); toast("Added to the canvas", { label: "Open", run: () => openNote(id) }); }} />
    </div>
  );
}

export default PdfReader;
