// Note › Diagrams tab — design round 6, Lumen 31 (NoteTabsDesk): R6-31A…E. Every Mermaid block and diagram image of the
// note in a 1- or 2-column grid; each card: kind glyph, title, type, view source, expand, and its own zoom bar tucked in
// the bottom corner (pinch / Ctrl+wheel / drag to pan). Selected card has an amber border. "Save all to canvas" puts
// every Mermaid diagram on one board. Expand = full screen with prev/next (‹ › · arrows · swipe), a centred zoom bar
// (− % + · Fit · 100%), a minimap (click to jump) and a live-validating source panel (edits can be applied to the note).
// Logic: lib/note-tabs.ts (what counts as a diagram), lib/diagrams.ts (files, canvas), lib/diagram-export.ts (PNG).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { updateNote } from "../lib/actions";
import { resolveAtt } from "../lib/attachments";
import { downloadBlob, exportDiagram, exportPrefs, openDiagramExport, safeName } from "../lib/diagram-export";
import { diagramFocus, diagramHash, saveDiagramToCanvas } from "../lib/diagrams";
import { fmtNum, isRtl, t, useLang } from "../lib/i18n";
import { renderMermaidForExport } from "../lib/markdown";
import { noteDiagrams, type NoteDiagram } from "../lib/note-tabs";
import { useExtraPrefs, withLook } from "../lib/reading-prefs";
import { activeTheme } from "../lib/settings";
import { openNote, setUI, toast, useVault } from "../lib/store";
import { sidebarInset } from "./ChatParts";
import { Glyph } from "./Glyph";
import { cx } from "./ui";

const COLS_KEY = "lumen.diagramCols";

// ------------------------------------------------------------------ render one diagram (Mermaid → SVG, or an image)
interface Drawn { html: string; w: number; h: number }
function useDrawn(d: NoteDiagram, srcOverride?: string): { drawn: Drawn | null; err: string } {
  const p = useExtraPrefs();
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [err, setErr] = useState("");
  const dark = activeTheme().dark;
  const src = srcOverride ?? d.block?.src ?? "";
  useEffect(() => {
    let live = true;
    const tm = setTimeout(async () => {
      try {
        if (d.kind === "image") {
          const url = d.url!.startsWith("att:") ? await resolveAtt(d.url!.slice(4)) : d.url!;
          const img = new Image();
          await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error(t("Couldn't load the image"))); img.src = url; });
          if (live) { setDrawn({ html: `<img src="${url.replace(/"/g, "&quot;")}" alt="" style="width:100%;height:100%;display:block" draggable="false">`, w: img.naturalWidth || 600, h: img.naturalHeight || 400 }); setErr(""); }
          return;
        }
        const html = await renderMermaidForExport(withLook(src, p.diagramHand), p.diagramTheme, false);
        const doc = new DOMParser().parseFromString(html, "image/svg+xml").documentElement;
        const vb = (doc.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
        const w = vb[2] || parseFloat(doc.getAttribute("width") ?? "") || 400, h = vb[3] || parseFloat(doc.getAttribute("height") ?? "") || 300;
        if (live) { setDrawn({ html, w, h }); setErr(""); }
      } catch (e) { if (live) setErr((e as Error).message.split("\n")[0] || t("Couldn't render this diagram")); }
    }, 150);
    return () => { live = false; clearTimeout(tm); };
  }, [d.kind, d.url, src, p.diagramTheme, p.diagramHand, dark]);
  return { drawn, err };
}

// ------------------------------------------------------------------ zoomable canvas
interface View { z: number; x: number; y: number }
function useZoom(drawn: Drawn | null, box: React.RefObject<HTMLDivElement | null>, pad = 24) {
  const [v, setV] = useState<View>({ z: 1, x: 0, y: 0 });
  const [fitted, setFitted] = useState(true);
  const fitZ = useCallback(() => {
    const el = box.current;
    if (!el || !drawn) return 1;
    return Math.max(0.05, Math.min(3, (el.clientWidth - pad * 2) / drawn.w, (el.clientHeight - pad * 2) / drawn.h));
  }, [drawn, box, pad]);
  const fit = useCallback(() => { setFitted(true); setV({ z: fitZ(), x: 0, y: 0 }); }, [fitZ]);
  useLayoutEffect(() => { if (drawn) { setFitted(true); setV({ z: Math.min(1, fitZ()), x: 0, y: 0 }); } }, [drawn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (fitted) setV((o) => ({ ...o, z: Math.min(1, fitZ()) })); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitZ, box, fitted]);
  const zoom = (f: number) => { setFitted(false); setV((o) => ({ ...o, z: Math.min(8, Math.max(0.05, o.z * f)) })); };
  const actual = () => { setFitted(false); setV({ z: 1, x: 0, y: 0 }); };
  /** Centre the view on drawing point (px, py). */
  const center = (px: number, py: number) => { if (!drawn) return; setFitted(false); setV((o) => ({ ...o, x: -(px - drawn.w / 2) * o.z, y: -(py - drawn.h / 2) * o.z })); };
  // pointer: drag to pan, two fingers to pinch-zoom
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button,[data-minimap]")) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.current.size === 2) { const [a, b] = [...pts.current.values()]; pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: v.z }; }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const prev = pts.current.get(e.pointerId);
      if (!prev) return;
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      setFitted(false);
      if (pts.current.size === 2 && pinch.current) {
        const [a, b] = [...pts.current.values()];
        const z = Math.min(8, Math.max(0.05, pinch.current.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d)));
        setV((o) => ({ ...o, z }));
      } else if (pts.current.size === 1) setV((o) => ({ ...o, x: o.x + e.clientX - prev.x, y: o.y + e.clientY - prev.y }));
    },
    onPointerUp: (e: React.PointerEvent) => { pts.current.delete(e.pointerId); if (pts.current.size < 2) pinch.current = null; },
    onPointerCancel: (e: React.PointerEvent) => { pts.current.delete(e.pointerId); pinch.current = null; },
    onWheel: (e: React.WheelEvent) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); } },
    onDoubleClick: () => (fitted ? actual() : fit()),
  };
  return { v, fitted, zoom, fit, actual, center, handlers };
}
function Drawing({ drawn, v }: { drawn: Drawn; v: View }) {
  return <div className="r6-diagram pointer-events-none absolute left-1/2 top-1/2" style={{ width: drawn.w, height: drawn.h, transform: `translate(calc(-50% + ${v.x}px), calc(-50% + ${v.y}px)) scale(${v.z})` }} dangerouslySetInnerHTML={{ __html: drawn.html }} />;
}

// ------------------------------------------------------------------ the tab
export function DiagramsTab({ note, wide }: { note: Note; wide: boolean }) {
  const v = useVault();
  useLang();
  const list = useMemo(() => noteDiagrams(note.body), [note.body]);
  const [cols, setCols] = useState<1 | 2>(() => { try { return localStorage.getItem(COLS_KEY) === "1" ? 1 : 2; } catch { return 2; } });
  const [sel, setSel] = useState<string | null>(null);
  const [expand, setExpand] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const two = wide && cols === 2;
  const mermaids = list.filter((d) => d.kind === "mermaid");
  const nGraph = mermaids.filter((d) => /^graph\b/.test(d.type)).length;
  const parts = ([[mermaids.length - nGraph, t("Mermaid")], [nGraph, t("graph")], [list.length - mermaids.length, t("image")]] as [number, string][]).filter(([n]) => n);

  const saveAll = async () => {
    setBusy(true);
    try {
      let notes = v.notes, last: { canvasId: string; nodeId: string } | null = null;
      for (const d of mermaids) { const r = await saveDiagramToCanvas({ ...note }, d.block!, notes, v.folders); last = r; notes = [...notes, r.file]; }
      toast(t("{n} diagram saved to the canvas|{n} diagrams saved to the canvas", { n: mermaids.length }), last ? { label: t("Open canvas"), run: () => { diagramFocus.canvas = last; openNote(last!.canvasId); } } : undefined);
    } finally { setBusy(false); }
  };

  if (!list.length) return <div className="flex h-full items-center justify-center px-6 text-center text-muted">{t("No diagrams in this note yet. Add a Mermaid block or a diagram image in Edit.")}</div>;
  return (
    <div className={cx("h-full overflow-y-auto text-[13px]", wide ? "px-7 py-5" : "p-3.5")} data-tab="diagrams">
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-center gap-2.5 text-[13px]">
          <span className="font-semibold">{t("{n} diagram in this note|{n} diagrams in this note", { n: list.length })}</span>
          <span className="text-muted">{parts.map(([n, l]) => `${fmtNum(n)} ${l}`).join(" · ")}</span>
          <span className="flex-1" />
          {wide && (
            <div role="radiogroup" aria-label={t("Columns")} className="flex gap-0.5 rounded-[8px] border border-line bg-surface p-[3px]">
              {([1, 2] as const).map((c) => (
                <button key={c} role="radio" aria-checked={cols === c} onClick={() => { setCols(c); try { localStorage.setItem(COLS_KEY, String(c)); } catch { /* ignore */ } }}
                  className="flex h-6 items-center rounded-[6px] px-2" style={cols === c ? { background: "var(--surface-2)", fontWeight: 600 } : { color: "var(--muted)" }}>{c === 1 ? t("1 col") : t("2 col")}</button>
              ))}
            </div>
          )}
          {wide && mermaids.length > 0 && <button onClick={() => void saveAll()} disabled={busy} className="flex h-[30px] items-center gap-1.5 rounded-[8px] border border-line px-2.5 hover:bg-surface-2 disabled:opacity-60" data-act="save-all"><Glyph name="canvas" size={14} />{busy ? t("Saving…") : t("Save all to canvas")}</button>}
        </div>
        <div className={cx("grid gap-3.5", two ? "grid-cols-2" : "grid-cols-1")}>
          {list.map((d, i) => <DiagramCard key={d.id} d={d} selected={sel === d.id} onSelect={() => setSel(d.id)} onExpand={() => setExpand(i)} height={wide ? (two ? 200 : 320) : 140} compact={!wide} />)}
        </div>
      </div>
      {expand !== null && list[expand] && <Expanded note={note} list={list} index={expand} setIndex={setExpand} onClose={() => setExpand(null)} phone={!wide} />}
    </div>
  );
}

function DiagramCard({ d, selected, onSelect, onExpand, height, compact }: { d: NoteDiagram; selected: boolean; onSelect: () => void; onExpand: () => void; height: number; compact: boolean }) {
  const [src, setSrc] = useState(false);
  const { drawn, err } = useDrawn(d);
  const box = useRef<HTMLDivElement>(null);
  const zm = useZoom(drawn, box, 12);
  const glyph = d.kind === "image" ? "image" : /^graph\b/.test(d.type) ? "graph" : "diagram";
  const zb = "flex size-[22px] items-center justify-center rounded-[5px] hover:bg-surface-2";
  return (
    <div className="flex flex-col overflow-hidden rounded-[12px] border bg-surface" style={{ borderColor: selected ? "var(--accent)" : "var(--border)" }} onPointerDown={onSelect} data-diagram={d.id}>
      <div className="flex h-9 items-center gap-2 border-b border-line pe-2 ps-3">
        <Glyph name={glyph} size={14} color="var(--muted)" />
        <span dir="auto" className="min-w-0 flex-1 truncate font-semibold">{d.title}</span>
        {!compact && <span className="text-[11.5px] text-muted">{d.type}</span>}
        {d.kind === "mermaid" && <button aria-label={t("View source")} aria-pressed={src} title={t("View source")} onClick={() => setSrc((s) => !s)} className={cx("flex size-[26px] items-center justify-center rounded-[6px] hover:bg-surface-2", src ? "text-accent" : "text-muted")}><Glyph name="code" size={13} /></button>}
        <button aria-label={t("Expand")} title={t("Expand")} onClick={onExpand} className="flex size-[26px] items-center justify-center rounded-[6px] text-muted hover:bg-surface-2" data-act="expand"><Glyph name="full" size={13} /></button>
      </div>
      {src ? (
        <pre dir="ltr" className="m-0 overflow-auto whitespace-pre p-3 font-mono text-[12px] leading-[19px]" style={{ height }}>{d.block?.src}</pre>
      ) : (
        <div ref={box} className="r6-dots relative overflow-hidden" style={{ height, cursor: "grab", touchAction: "none" }} {...zm.handlers}>
          {drawn && <Drawing drawn={drawn} v={zm.v} />}
          {!drawn && !err && <span className="absolute inset-0 flex items-center justify-center text-[12px] text-muted">{t("Rendering diagram…")}</span>}
          {err && <span className="absolute inset-x-3 top-3 rounded-[7px] px-2 py-1.5 font-mono text-[11.5px] text-bad" style={{ background: "color-mix(in srgb, var(--danger) 12%, var(--surface))" }}>{err}</span>}
          <div className="absolute bottom-2 end-2 flex items-center gap-px rounded-[7px] border border-line p-[2px] text-[11px]" style={{ background: "color-mix(in srgb, var(--surface) 92%, transparent)" }} data-zoombar>
            <button aria-label={t("Zoom out")} onClick={() => zm.zoom(1 / 1.2)} className={zb}><Glyph name="zoom-out" size={12} /></button>
            <button title={t("Actual size")} onClick={zm.actual} className="w-[34px] text-center text-muted tabular-nums">{d.kind === "image" && zm.fitted ? t("fit") : `${fmtNum(Math.round(zm.v.z * 100))}%`}</button>
            <button aria-label={t("Zoom in")} onClick={() => zm.zoom(1.2)} className={zb}><Glyph name="zoom-in" size={12} /></button>
            <button aria-label={t("Fit")} title={t("Fit")} onClick={zm.fit} className={zb}><Glyph name="fit" size={12} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Expand (full screen)
function Expanded({ note, list, index, setIndex, onClose, phone }: { note: Note; list: NoteDiagram[]; index: number; setIndex: (i: number) => void; onClose: () => void; phone: boolean }) {
  const v = useVault();
  const d = list[index];
  const [showSrc, setShowSrc] = useState(!phone);
  const [draft, setDraft] = useState(d.block?.src ?? "");
  useEffect(() => setDraft(d.block?.src ?? ""), [d.id, d.block?.src]);
  const { drawn, err } = useDrawn(d, d.kind === "mermaid" ? draft : undefined);
  const box = useRef<HTMLDivElement>(null);
  const zm = useZoom(drawn, box, 60);
  const [inset, setInset] = useState(0);
  const go = (k: number) => setIndex((index + k + list.length) % list.length);
  useEffect(() => {
    setInset(phone ? 0 : sidebarInset());
  }, [phone]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("textarea,input")) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(isRtl() ? -1 : 1);
      if (e.key === "ArrowLeft") go(isRtl() ? 1 : -1);
      if (e.key === "+" || e.key === "=") zm.zoom(1.2);
      if (e.key === "-") zm.zoom(1 / 1.2);
      if (e.key === "0") zm.fit();
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const dirty = d.kind === "mermaid" && draft.trim() !== (d.block?.src ?? "").trim();
  const apply = async () => {
    if (!d.block) return;
    const lines = note.body.split("\n");
    const start = d.block.line + 1, n = d.block.src.split("\n").length;
    lines.splice(start, n, ...draft.replace(/\s+$/, "").split("\n"));
    await updateNote(note.id, { body: lines.join("\n") });
    toast(t("Diagram updated in the note"));
  };
  const png = async () => {
    try {
      if (d.kind === "image") { const url = d.url!.startsWith("att:") ? await resolveAtt(d.url!.slice(4)) : d.url!; const b = await (await fetch(url)).blob(); await downloadBlob(b, safeName(d.title) + "." + (b.type.split("/")[1] || "png")); return; }
      const r = await exportDiagram(draft, { ...exportPrefs(), format: "png" });
      await downloadBlob(r.blob, safeName(d.title) + ".png");
    } catch (e) { toast((e as Error).message); }
  };
  const toCanvas = async () => { if (!d.block) return; const r = await saveDiagramToCanvas({ ...note }, d.block, v.notes, v.folders); diagramFocus.canvas = { canvasId: r.canvasId, nodeId: r.nodeId }; openNote(r.canvasId); };
  const inNote = () => { if (!d.block) return; diagramFocus.note = { noteId: note.id, line: d.block.line, hash: diagramHash(d.block.src) }; onClose(); setUI({ mode: "read" }); };
  const bar = "flex size-8 items-center justify-center rounded-[7px] hover:bg-surface";
  // minimap: the drawing scaled into 160×100, the visible area as an amber frame; click to jump there
  const el = box.current;
  const mm = drawn && el ? (() => {
    const s = Math.min(150 / drawn.w, 90 / drawn.h);
    const vw = el.clientWidth / zm.v.z, vh = el.clientHeight / zm.v.z;
    const cx0 = drawn.w / 2 - zm.v.x / zm.v.z, cy0 = drawn.h / 2 - zm.v.y / zm.v.z;
    const ox = (160 - drawn.w * s) / 2, oy = (100 - drawn.h * s) / 2;
    const x1 = Math.max(0, ox + (cx0 - vw / 2) * s), y1 = Math.max(0, oy + (cy0 - vh / 2) * s);
    const x2 = Math.min(160, ox + (cx0 + vw / 2) * s), y2 = Math.min(100, oy + (cy0 + vh / 2) * s);
    return { s, ox, oy, x1, y1, w: Math.max(6, x2 - x1), h: Math.max(6, y2 - y1) };
  })() : null;
  const kindLine = d.kind === "mermaid" ? `mermaid · ${d.type}` : t("image");
  return (
    <div role="dialog" aria-label={d.title} className="fixed inset-y-0 z-50 flex flex-col bg-bg text-[13px] fade-in" style={{ insetInlineStart: inset, insetInlineEnd: 0 }} data-expand data-r6-layer>
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-3">
        <button aria-label={t("Close")} onClick={onClose} className="flex size-7 items-center justify-center rounded-[7px] hover:bg-surface-2"><Glyph name="x" size={16} /></button>
        <b dir="auto" className="min-w-0 flex-1 truncate font-semibold">{d.title}</b>
        <span className="text-[12px] text-muted">{t("{i} of {n}", { i: index + 1, n: list.length })}</span>
        <button aria-label={t("Previous diagram")} onClick={() => go(-1)} className="flex size-7 items-center justify-center rounded-[7px] border border-line hover:bg-surface-2"><span aria-hidden>{isRtl() ? "›" : "‹"}</span></button>
        <button aria-label={t("Next diagram")} onClick={() => go(1)} className="flex size-7 items-center justify-center rounded-[7px] border border-line hover:bg-surface-2"><span aria-hidden>{isRtl() ? "‹" : "›"}</span></button>
        {!phone && d.kind === "mermaid" && <button aria-pressed={showSrc} onClick={() => setShowSrc((s) => !s)} className={cx("flex h-[30px] items-center gap-1.5 rounded-[7px] px-2.5", showSrc ? "bg-surface-2" : "border border-line hover:bg-surface-2")}><Glyph name="code" size={13} />{t("Source")}</button>}
        {!phone && <button onClick={() => void png()} className="flex h-[30px] items-center gap-1.5 rounded-[7px] border border-line px-2.5 hover:bg-surface-2" data-act="png"><Glyph name="export" size={13} />PNG</button>}
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={box} className="r6-dots-lg relative min-w-0 flex-1 overflow-hidden" style={{ cursor: "grab", touchAction: "none" }}
          {...zm.handlers}
          onTouchStart={(e) => { swipe.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }}
          onTouchEnd={(e) => { const s = swipe.current; swipe.current = null; if (!s || !phone) return; const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y; if (Math.abs(dx) > 70 && Math.abs(dy) < 50 && zm.fitted) go((dx < 0) !== isRtl() ? 1 : -1); }}>
          {drawn && <Drawing drawn={drawn} v={zm.v} />}
          {!drawn && !err && <span className="absolute inset-0 flex items-center justify-center text-muted">{t("Rendering diagram…")}</span>}
          {err && phone && <span className="absolute inset-x-3 top-3 rounded-[7px] px-2 py-1.5 font-mono text-[11.5px] text-bad" style={{ background: "color-mix(in srgb, var(--danger) 12%, var(--surface))" }}>{err}</span>}
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-[10px] border border-line bg-surface-2 p-1 shadow-[0_8px_20px_rgba(0,0,0,.3)]" data-zoombar>
            <button aria-label={t("Zoom out")} onClick={() => zm.zoom(1 / 1.2)} className={bar}><Glyph name="zoom-out" size={16} /></button>
            <span className="w-12 text-center tabular-nums">{fmtNum(Math.round(zm.v.z * 100))}%</span>
            <button aria-label={t("Zoom in")} onClick={() => zm.zoom(1.2)} className={bar}><Glyph name="zoom-in" size={16} /></button>
            <span className="h-[18px] w-px bg-line" />
            <button onClick={zm.fit} className="flex h-8 items-center gap-[5px] rounded-[7px] px-2 hover:bg-surface"><Glyph name="fit" size={15} />{t("Fit")}</button>
            <button onClick={zm.actual} className="flex h-8 items-center rounded-[7px] px-2 hover:bg-surface">100%</button>
          </div>
          {!phone && mm && drawn && (
            <div className="absolute bottom-4 end-4 h-[100px] w-[160px] cursor-pointer overflow-hidden rounded-[9px] border border-line bg-surface" data-minimap
              onPointerDown={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); zm.center((e.clientX - r.left - mm.ox) / mm.s, (e.clientY - r.top - mm.oy) / mm.s); }}>
              <div className="pointer-events-none absolute opacity-60" style={{ left: mm.ox, top: mm.oy, width: drawn.w, height: drawn.h, transform: `scale(${mm.s})`, transformOrigin: "0 0" }} dangerouslySetInnerHTML={{ __html: drawn.html }} />
              <span className="pointer-events-none absolute rounded-[4px] border-[1.5px] border-accent" style={{ left: mm.x1, top: mm.y1, width: mm.w, height: mm.h }} />
            </div>
          )}
        </div>
        {!phone && showSrc && d.kind === "mermaid" && (
          <div className="flex w-[320px] shrink-0 flex-col border-s border-line bg-surface" data-source>
            <div className="flex h-9 items-center gap-2 border-b border-line px-3 text-[12px] text-muted">
              <span className="truncate">{kindLine}</span><span className="flex-1" />
              {err ? <span className="text-bad">{t("Error")}</span> : <span className="flex items-center gap-1 text-ok">{t("Valid")}<Glyph name="check" size={12} /></span>}
            </div>
            <textarea dir="ltr" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} aria-label={t("Mermaid source")}
              className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[12.5px] leading-[21px] text-ink outline-none" />
            {err && <span className="border-t border-line px-3 py-2 font-mono text-[11.5px] text-bad">{err}</span>}
            <div className="flex flex-wrap gap-1.5 border-t border-line p-2.5">
              {dirty && <button onClick={() => void apply()} disabled={!!err} className="flex h-7 items-center rounded-[7px] bg-accent px-2.5 font-semibold text-accent-fg disabled:opacity-50" data-act="apply">{t("Apply to note")}</button>}
              {dirty && <button onClick={() => setDraft(d.block?.src ?? "")} className="flex h-7 items-center rounded-[7px] border border-line px-2.5 hover:bg-surface-2">{t("Revert")}</button>}
              <button onClick={inNote} className="flex h-7 items-center rounded-[7px] border border-line px-2.5 hover:bg-surface-2">{t("In note")}</button>
              <button onClick={() => void toCanvas()} className="flex h-7 items-center rounded-[7px] border border-line px-2.5 hover:bg-surface-2">{t("To canvas")}</button>
              <button onClick={() => openDiagramExport(draft, d.title)} className="flex h-7 items-center rounded-[7px] border border-line px-2.5 hover:bg-surface-2">{t("Export…")}</button>
              <button onClick={() => void navigator.clipboard.writeText(draft).then(() => toast(t("Source copied")))} className="flex h-7 items-center rounded-[7px] border border-line px-2.5 hover:bg-surface-2">{t("Copy")}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
