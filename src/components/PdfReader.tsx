// PDF reader for `type: pdf` notes (design update 04 · D1). Continuous scroll with virtualized pages, fit width /
// fit page / zoom, page field + keyboard, rail (pages / outline / highlights), search with hit markers, reading
// progress + resume, dark-mode inversion, text and area highlights stored as Markdown in the note (lib/pdf-format.ts).
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ListTree, Maximize, Moon, MoveHorizontal, PanelLeft, RotateCcw, ScanText, Search, SquareDashed, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { takePendingBlock } from "../lib/blocks";
import { download } from "../lib/io";
import { cropPage, flatOutline, hasTextLayer, openPdf, pageText, PdfError, textInRect, textOffset, type OutlineItem, type PdfDoc } from "../lib/pdf-doc";
import { highlightsMarkdown, hlLink, isoNow, newHlId, parseHighlights, pdfMeta, progressOf, searchPages, type HlColor, type Highlight, type Rect, type SearchHit } from "../lib/pdf-format";
import { normRects, unionRect } from "../lib/pdf-geom";
import { addHighlightToCanvas, appendFlashcard, deleteHighlight, noteFromAll, noteFromHighlight, saveAreaImage, saveHighlight, saveReading, takePdfJump } from "../lib/pdf-note";
import { openNote, toast } from "../lib/store";
import { CanvasPickSheet, FlashcardSheet, HighlightBar, PasswordPrompt } from "./pdf-dialogs";
import { PdfPage } from "./pdf-page";
import { PdfRail, type RailTab } from "./pdf-rail";
import { Button, cx, IconButton, Sheet } from "./ui";

type Load = { kind: "loading"; loaded: number; total: number } | { kind: "ready" } | { kind: "error"; msg: string; password: boolean } | { kind: "password"; retry: boolean };
type Zoom = { mode: "width" | "page" | "custom"; scale: number };
type Bar =
  | { kind: "new"; x: number; y: number; sel: { page: number; rects: Rect[]; quote: string; text: [number, number] | null } }
  | { kind: "edit"; x: number; y: number; id: string };

const PT = 96 / 72; // CSS px per PDF point at 100 %
const EMPTY_H: Highlight[] = [];
const EMPTY_S: [number, number][] = [];
const ls = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
const usePhone = () => { const [p, setP] = useState(() => innerWidth < 768); useEffect(() => { const f = () => setP(innerWidth < 768); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []); return p; };
const mb = (b: number) => (b / 1048576).toFixed(1);
async function copy(text: string) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }

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
  const PAD = phone ? 6 : 28, GAP = phone ? 8 : 16, TOP = phone ? 8 : 18;
  const maxW = sizes.length ? Math.max(...sizes.map((s) => s[0])) : 612;
  const fitW = Math.max(0.2, (view.w - PAD * 2 - (phone ? 0 : 16)) / maxW);
  const fitP = Math.min(fitW, Math.max(0.2, (view.h - TOP * 2) / (sizes[0]?.[1] ?? 792)));
  const scale = zoom.mode === "width" ? Math.min(fitW, phone ? 9 : 2.6 * PT) : zoom.mode === "page" ? fitP : zoom.scale;
  const pct = Math.round((scale / PT) * 100);
  const zoomBy = useCallback((f: number) => setZoom({ mode: "custom", scale: Math.min(5 * PT, Math.max(0.25 * PT, scale * f)) }), [scale]);
  const lay = useMemo(() => {
    const tops: number[] = [];
    let y = TOP;
    for (const s of sizes) { tops.push(y); y += s[1] * scale + GAP; }
    return { tops, total: y - GAP + TOP };
  }, [sizes, scale, TOP, GAP]);

  // ---------------------------------------------------------------- current page, goto, keep position through zoom
  const [page, setPage] = useState(1);
  const anchor = useRef({ page: 1, frac: 0 });
  const pageAt = useCallback((y: number) => { const t = lay.tops; let lo = 0, hi = t.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (t[m] <= y) lo = m; else hi = m - 1; } return lo + 1; }, [lay]);
  const goto = useCallback((n: number, yFrac = 0, smooth = false) => {
    if (!scroller || !sizes.length) return;
    const p = Math.max(1, Math.min(sizes.length, n));
    const top = lay.tops[p - 1] + yFrac * sizes[p - 1][1] * scale - (yFrac ? view.h * 0.3 : 8);
    scroller.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  }, [scroller, sizes, lay, scale, view.h]);
  const onScroll = useCallback(() => {
    if (!scroller || !sizes.length) return;
    const p = pageAt(scroller.scrollTop + scroller.clientHeight * 0.35);
    setPage(p);
    const h = sizes[p - 1][1] * scale;
    anchor.current = { page: p, frac: (scroller.scrollTop - lay.tops[p - 1]) / h };
  }, [scroller, sizes, scale, lay, pageAt]);
  const prevScale = useRef(scale);
  useLayoutEffect(() => {
    if (!scroller || prevScale.current === scale || !sizes.length) { prevScale.current = scale; return; }
    prevScale.current = scale;
    const { page: p, frac } = anchor.current;
    scroller.scrollTop = lay.tops[p - 1] + frac * sizes[p - 1][1] * scale;
  }, [scale, scroller, lay, sizes]);

  // ---------------------------------------------------------------- resume / jump to a highlight
  const [jump] = useState(() => takePdfJump(note.id) ?? (() => { const id = takePendingBlock(note.title); return id ? { page: 0, hl: id } : null; })());
  const [flash, setFlash] = useState<string | null>(null);
  const [resumed, setResumed] = useState(0);
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
    else if (meta.page > 1 && meta.page <= sizes.length) { goto(meta.page); setResumed(meta.page); setTimeout(() => setResumed(0), 7000); }
  }, [doc, sizes, view.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // reading position → front matter (debounced; keeps the note's "updated" time)
  useEffect(() => {
    if (!restored.current || !pages) return;
    const t = setTimeout(() => {
      const progress = Math.max(meta.progress, progressOf(page, pages));
      if (page !== meta.page || progress !== meta.progress || pages !== meta.pages) void saveReading(note.id, { page, progress, pages });
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
  const stepHit = (d: number) => hits.length && setHitIdx((i) => (i + d + hits.length) % hits.length);

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
    const u = range.getBoundingClientRect(), sr = stage.current.getBoundingClientRect();
    setBar({ kind: "new", x: u.left + u.width / 2 - sr.left, y: u.top - sr.top, sel: { page: Number(pageEl.dataset.page), rects, quote, text: tl ? textOffset(tl, range) : null } });
  }, [scroller]);
  useEffect(() => {
    let t = 0;
    const on = () => { clearTimeout(t); t = window.setTimeout(checkSel, 180); };
    document.addEventListener("selectionchange", on);
    return () => { document.removeEventListener("selectionchange", on); clearTimeout(t); };
  }, [checkSel]);

  const create = async (color: HlColor): Promise<Highlight | null> => {
    const b = barRef.current;
    if (!b || b.kind !== "new") return null;
    const h: Highlight = { id: newHlId(), color, page: b.sel.page, quote: b.sel.quote, tags: [], rects: b.sel.rects, ...(b.sel.text ? { text: b.sel.text } : {}), created: isoNow() };
    await saveHighlight(note.id, h);
    getSelection()?.removeAllRanges();
    return h;
  };
  /** The highlight the bar acts on (creating it from the selection when needed). */
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
    await create(c);
    setBar(null);
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
    const quote = b?.kind === "new" ? b.sel.quote : highlights.find((h) => b && h.id === b.id)?.quote ?? "";
    const p = b?.kind === "new" ? b.sel.page : highlights.find((h) => b && h.id === b.id)?.page ?? page;
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
    setBar({ kind: "edit", id, x: x - sr.left, y: y - sr.top });
  }, []);
  const onArea = useCallback(async (n: number, r: Rect) => {
    if (!doc) return;
    const pageEl = scroller?.querySelector<HTMLElement>(`.pdfr-page[data-page="${n}"]`);
    try {
      const blob = await cropPage(doc, n, r, (sizes[n - 1]?.[0] ?? 612) * scale);
      if (!blob) throw new Error("capture");
      const image = await saveAreaImage(blob, note.title, n);
      const h: Highlight = { id: newHlId(), color: lastColor, page: n, quote: pageEl ? textInRect(pageEl, r).slice(0, 400) : "", image, tags: [], rects: [r], created: isoNow() };
      await saveHighlight(note.id, h);
      const pb = pageEl?.getBoundingClientRect(), sr = stage.current?.getBoundingClientRect();
      if (pb && sr) setBar({ kind: "edit", id: h.id, x: pb.left + (r[0] + r[2] / 2) * pb.width - sr.left, y: pb.top + r[1] * pb.height - sr.top });
      toast("Area saved as an image highlight");
    } catch { toast("Couldn't capture that area"); }
  }, [doc, scroller, sizes, scale, note.id, note.title, lastColor]);
  const onText = useCallback(() => undefined, []);

  // ---------------------------------------------------------------- keyboard
  const [railOpen, setRailOpen] = useState(() => ls.get("lumen.pdf.rail") !== "0");
  useEffect(() => ls.set("lumen.pdf.rail", railOpen ? "1" : "0"), [railOpen]);
  const [sheet, setSheet] = useState(false);
  const [tab, setTab] = useState<RailTab>(() => (highlights.length ? "highlights" : "thumbs"));
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); setSearch(true); setTimeout(() => qRef.current?.select(), 0); return; }
      if (t.closest("input,textarea,select,[contenteditable=true]") || card || canvasFor || sheet || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); goto(page + 1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); goto(page - 1); }
      else if (e.key === "Home") { e.preventDefault(); goto(1); }
      else if (e.key === "End") { e.preventDefault(); goto(pages); }
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1.15); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomBy(1 / 1.15); }
      else if (e.key === "Escape") { if (bar) setBar(null); else if (area) setArea(false); else if (search) setSearch(false); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [goto, page, pages, zoomBy, bar, area, search, card, canvasFor, sheet]);

  // ---------------------------------------------------------------- render
  const [pageField, setPageField] = useState("");
  const pageInput = (
    <span className="flex items-center gap-1 font-mono text-[12.5px] text-muted">
      <input aria-label="Page" inputMode="numeric" className="h-8 w-11 rounded-[7px] border border-line bg-bg text-center text-ink focus:border-accent focus:outline-none"
        value={pageField || String(page)} onFocus={(e) => { setPageField(String(page)); e.target.select(); }} onChange={(e) => setPageField(e.target.value.replace(/\D/g, ""))}
        onBlur={() => setPageField("")} onKeyDown={(e) => { if (e.key === "Enter") { goto(Number(pageField) || page); (e.target as HTMLInputElement).blur(); } }} />
      <span>/ {pages || "–"}</span>
    </span>
  );
  const sep = <span className="mx-1 h-5 w-px shrink-0 bg-line" />;
  const progress = pages ? Math.round((page / pages) * 100) : 0;
  const rail = (
    <PdfRail doc={doc} pages={pages} page={page} tab={tab} setTab={setTab} outline={outline} highlights={highlights} title={note.title}
      onPage={(n) => { goto(n); setSheet(false); }} onHl={(h) => { flashHl(h); setSheet(false); }}
      onAllNote={async () => { if (!highlights.length) return; const n = await noteFromAll(note, highlights); toast(`Created “${n.title}”`, { label: "Open", run: () => openNote(n.id, "read") }); }}
      onExport={() => download(`${note.title} highlights.md`, highlightsMarkdown(note.title, highlights), "text/markdown")} />
  );
  const barH = bar?.kind === "edit" ? highlights.find((h) => h.id === bar.id) : undefined;

  return (
    <div className="pdfr flex h-full min-h-0 flex-col bg-bg">
      {/* toolbar */}
      <div className="flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-2">
        {phone
          ? <IconButton label="Pages, outline and highlights" onClick={() => setSheet(true)}><ListTree size={16} /></IconButton>
          : <IconButton label={railOpen ? "Hide sidebar" : "Show sidebar"} active={railOpen} onClick={() => setRailOpen(!railOpen)}><PanelLeft size={16} /></IconButton>}
        {!phone && <>{sep}<IconButton label="Previous page" onClick={() => goto(page - 1)}><ChevronLeft size={16} /></IconButton>{pageInput}<IconButton label="Next page" onClick={() => goto(page + 1)}><ChevronRight size={16} /></IconButton>{sep}
          <IconButton label="Zoom out (-)" onClick={() => zoomBy(1 / 1.15)}><ZoomOut size={16} /></IconButton>
          <button className="h-8 w-12 rounded-[7px] font-mono text-[12px] text-muted hover:bg-surface-2 hover:text-ink" title="Fit width" onClick={() => setZoom({ mode: "width", scale })}>{pct}%</button>
          <IconButton label="Zoom in (+)" onClick={() => zoomBy(1.15)}><ZoomIn size={16} /></IconButton>
          <IconButton label="Fit width" active={zoom.mode === "width"} onClick={() => setZoom({ mode: "width", scale })}><MoveHorizontal size={16} /></IconButton>
          <IconButton label="Fit page" active={zoom.mode === "page"} onClick={() => setZoom({ mode: "page", scale })}><Maximize size={15} /></IconButton>{sep}</>}
        <IconButton label="Search (Ctrl+F)" active={search} onClick={() => { setSearch(!search); setTimeout(() => qRef.current?.focus(), 0); }}><Search size={16} /></IconButton>
        <IconButton label={area ? "Area mode on: drag a rectangle" : "Area mode: capture a figure"} active={area} onClick={() => { setArea(!area); setBar(null); }}><SquareDashed size={16} /></IconButton>
        <IconButton label={invert ? "Light pages" : "Dark pages (images stay as they are)"} active={invert} onClick={() => setInvert(!invert)}><Moon size={16} /></IconButton>
        <span className="flex-1" />
        {area && <span className="whitespace-nowrap px-2 text-[12px] text-accent">Drag over a figure or equation</span>}
        {!phone && pages > 0 && <span className="whitespace-nowrap px-2 text-[12px] text-muted" title="Furthest page read is saved with the note">{progress}% · {highlights.length} highlight{highlights.length === 1 ? "" : "s"}</span>}
      </div>
      {/* reading progress */}
      <div className="h-[2px] shrink-0 bg-line" aria-hidden><div className="h-full bg-accent transition-[width]" style={{ width: `${progress}%` }} /></div>
      {search && (
        <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-2">
          <Search size={14} className="ms-1 shrink-0 text-muted" />
          <input ref={qRef} dir="auto" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find in document" className="h-8 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); stepHit(e.shiftKey ? -1 : 1); } else if (e.key === "Escape") setSearch(false); }} />
          <span className="whitespace-nowrap font-mono text-[12px] text-muted">{searching ? "Searching…" : q.trim().length >= 2 ? (hits.length ? `${hitIdx + 1} / ${hits.length}` : "No matches") : ""}</span>
          <IconButton label="Previous match" onClick={() => stepHit(-1)}><ChevronUp size={16} /></IconButton>
          <IconButton label="Next match" onClick={() => stepHit(1)}><ChevronDown size={16} /></IconButton>
          <IconButton label="Close search" onClick={() => { setSearch(false); setQ(""); }}><X size={16} /></IconButton>
        </div>
      )}
      {load.kind === "ready" && !hasText && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2 text-[12.5px] text-muted">
          <ScanText size={15} className="shrink-0" />
          <span className="min-w-0 flex-1">This looks like a scanned PDF: it has no text layer, so text can't be selected or searched. Area highlights still work.</span>
          {!area && <Button size="sm" onClick={() => setArea(true)}>Area mode</Button>}
        </div>
      )}
      {resumed > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-1.5 text-[12.5px]">
          <span className="text-muted">Continued where you left off, p. {resumed}.</span>
          <button className="flex items-center gap-1 text-link" onClick={() => { goto(1); setResumed(0); }}><RotateCcw size={12} />Start from the beginning</button>
          <span className="flex-1" /><button aria-label="Dismiss" className="text-muted" onClick={() => setResumed(0)}><X size={14} /></button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {!phone && railOpen && load.kind === "ready" && <aside className="w-[244px] shrink-0 border-e border-line bg-surface">{rail}</aside>}
        <div ref={stage} className="relative min-w-0 flex-1">
          {load.kind === "password" ? (
            <PasswordPrompt retry={load.retry} onSubmit={(pw) => { setLoad({ kind: "loading", loaded: 0, total: 0 }); pwResolve.current?.(pw); }} onCancel={() => pwResolve.current?.(null)} />
          ) : load.kind === "error" ? (
            <div className="mx-auto mt-[14vh] flex max-w-[400px] flex-col items-center gap-3 px-6 text-center">
              <div className="text-[16px] font-semibold">{load.password ? "This PDF is locked" : "Couldn't open this PDF"}</div>
              <div className="text-[13px] leading-5 text-muted">{load.msg}</div>
              <div className="flex gap-2"><Button variant="primary" onClick={() => setReload((r) => r + 1)}>{load.password ? "Enter password" : "Try again"}</Button></div>
              <div className="text-[12px] text-muted">Highlights are kept in the note. Press Edit to see them as Markdown.</div>
            </div>
          ) : load.kind === "loading" || !sizes.length ? (
            <div className="absolute inset-0 overflow-hidden">
              <div className="flex flex-col items-center gap-4 pt-5">
                <div className="h-4 text-[12px] text-muted">{load.kind === "loading" && load.total > 4 * 1048576 ? `Loading ${mb(load.loaded)} of ${mb(load.total)} MB` : load.kind === "loading" && load.loaded > 0 ? `Loading ${mb(load.loaded)} MB` : "Opening…"}</div>
                {[0, 1, 2].map((i) => <div key={i} className="pdfr-page pdfr-skelpage" style={{ width: Math.min(680, Math.max(240, (view.w || 600) - 2 * PAD)), aspectRatio: "612 / 792" }}><div className="pdfr-skel"><i /><i /><i /><i /><i /></div></div>)}
              </div>
            </div>
          ) : null}
          <div ref={setScroller} onScroll={() => { onScroll(); if (barRef.current?.kind === "new") checkSel(); else if (barRef.current && !document.activeElement?.closest(".pdfr-bar")) setBar(null); }}
            onMouseDown={(e) => { if (barRef.current?.kind === "edit" && !(e.target as HTMLElement).closest(".pdfr-mark")) setBar(null); }}
            className={cx("pdfr-scroll absolute inset-0 overflow-auto", (load.kind !== "ready" || !sizes.length) && "invisible", area && "pdfr-areamode")}>
            {doc && sizes.length > 0 && (
              <div className="pdfr-pages" style={{ padding: `${TOP}px ${PAD}px`, gap: GAP }}>
                {sizes.map((s, i) => (
                  <PdfPage key={i} doc={doc} n={i + 1} width={s[0] * scale} height={s[1] * scale} invert={invert} root={scroller}
                    highlights={hlByPage.get(i + 1) ?? EMPTY_H} flash={flash && hlByPage.get(i + 1)?.some((h) => h.id === flash) ? flash : null}
                    hitSpans={spansByPage.get(i + 1) ?? EMPTY_S} activeHit={cur && cur.page === i + 1 ? cur.index : -1}
                    area={area} onArea={onArea} onText={onText} onPickHl={onPickHl} />
                ))}
              </div>
            )}
          </div>
          {/* search hit markers on the scrollbar */}
          {hits.length > 0 && lay.total > 0 && (
            <div className="pdfr-track" aria-hidden>
              {[...spansByPage.keys()].map((p) => <i key={p} className={cur?.page === p ? "active" : ""} style={{ top: `${((lay.tops[p - 1] + (sizes[p - 1]?.[1] ?? 0) * scale * 0.5) / lay.total) * 100}%` }} />)}
            </div>
          )}
          {bar && (bar.kind === "new" || barH) && (
            <HighlightBar key={bar.kind === "edit" ? bar.id : "new"} kind={bar.kind} h={barH} x={bar.x} y={bar.y} docked={phone}
              onColor={pickColor} onNote={actNote} onCard={actCard} onCopy={actCopy} onLink={actLink}
              onCanvas={bar.kind === "edit" ? () => { setCanvasFor(barH ?? null); setBar(null); } : undefined}
              onDelete={bar.kind === "edit" ? actDelete : undefined} onMeta={actMeta} />
          )}
        </div>
      </div>

      {phone && (
        <div className="safe-b flex h-12 shrink-0 items-center gap-1 border-t border-line bg-surface px-2">
          <IconButton label="Previous page" className="size-11" onClick={() => goto(page - 1)}><ChevronLeft size={18} /></IconButton>
          {pageInput}
          <IconButton label="Next page" className="size-11" onClick={() => goto(page + 1)}><ChevronRight size={18} /></IconButton>
          <span className="flex-1" />
          <IconButton label="Zoom out" className="size-11" onClick={() => zoomBy(1 / 1.2)}><ZoomOut size={18} /></IconButton>
          <button className="h-11 min-w-12 rounded-[8px] font-mono text-[12px] text-muted" onClick={() => setZoom({ mode: "width", scale })} title="Fit width">{pct}%</button>
          <IconButton label="Zoom in" className="size-11" onClick={() => zoomBy(1.2)}><ZoomIn size={18} /></IconButton>
        </div>
      )}
      {phone && <Sheet open={sheet} onClose={() => setSheet(false)} title={note.title}><div className="-mx-4 -mb-4 h-[62dvh]">{rail}</div></Sheet>}
      <FlashcardSheet open={!!card} onClose={() => setCard(null)} quote={card?.quote ?? ""} pdfTitle={note.title}
        onSave={async (tgt, fq, fa) => { if (!card) return; const n = await appendFlashcard(tgt, fq, fa, note, card); setCard(null); toast(`Card added to “${n.title}”`, { label: "Open", run: () => openNote(n.id, "edit") }); }} />
      <CanvasPickSheet open={!!canvasFor} onClose={() => setCanvasFor(null)} spaceId={note.spaceId}
        onPick={async (id) => { if (!canvasFor) return; await addHighlightToCanvas(id, note, canvasFor); setCanvasFor(null); toast("Added to the canvas", { label: "Open", run: () => openNote(id) }); }} />
    </div>
  );
}

export default PdfReader;
