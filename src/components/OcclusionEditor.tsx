// Image occlusion: the box editor (full-screen), the review/readonly image, and a mount helper for CodeMirror.
// Data format + card rules: lib/occlusion.ts, docs/FLASHCARDS.md.
import { ArrowDown, ArrowUp, Hand, ImagePlus, Maximize, Minus, Plus, SquareDashed, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { createRoot } from "react-dom/client";
import { addFile, resolveAtt } from "../lib/attachments";
import { attId, clampBox, nextBoxId, noteImages, occlusionCardCount, safeImageUrl, type Occlusion, type OcclusionBox, type OcclusionMode } from "../lib/occlusion";
import { toast } from "../lib/store";
import { Glyph } from "./Glyph";
import { Button, cx, IconButton, inputCls } from "./ui";

/** Resolve `att:id` (local blob or server) or a safe URL to an <img> src. */
export function useImageSrc(src: string) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const id = attId(src);
    if (!id) { setUrl(safeImageUrl(src)); return; }
    let live = true;
    void resolveAtt(id).then((u) => live && setUrl(u)).catch(() => live && setUrl(""));
    return () => { live = false; };
  }, [src]);
  return url;
}

const pct = (v: number) => `${v * 100}%`;
const boxStyle = (b: OcclusionBox) => ({ left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h) });

/**
 * The image with its boxes, for Review (and anywhere read-only).
 * hide-one: target solid accent, others outlined · hide-all: all solid, target accent. Revealed: target becomes an accent outline.
 */
export function OcclusionImage({ data, target, revealed, className }: { data: Occlusion; target: string[]; revealed: boolean; className?: string }) {
  const url = useImageSrc(data.image);
  const tset = new Set(target);
  return (
    <div className={cx("occl-review relative inline-block max-w-full select-none", className)}>
      {url ? <img src={url} alt={data.alt ?? "Image occlusion"} draggable={false} className="block max-h-[52dvh] max-w-full md:max-h-[300px]" /> : <div className="flex h-40 w-72 items-center justify-center text-[13px] text-muted">Loading image…</div>}
      {url && data.boxes.map((b) => {
        const isT = tset.has(b.id);
        const cls = isT ? (revealed ? "occl-r-shown" : "occl-r-target") : data.mode === "hide-all" ? "occl-r-hidden" : "occl-r-other";
        return <span key={b.id} className={cx("occl-r", cls)} style={boxStyle(b)} />;
      })}
    </div>
  );
}

// ------------------------------------------------------------------ editor
type Op =
  | { k: "draw"; id: string; ax: number; ay: number }
  | { k: "move"; id: string; px: number; py: number; b: OcclusionBox }
  | { k: "resize"; id: string; corner: string; b: OcclusionBox }
  | { k: "pan"; cx: number; cy: number; tx: number; ty: number }
  | { k: "pinch"; d: number; mx: number; my: number; s: number; tx: number; ty: number };

interface EditorProps { initial: Occlusion; noteBody?: string; onSave: (o: Occlusion) => void; onClose: () => void }

export function OcclusionEditor({ initial, noteBody = "", onSave, onClose }: EditorProps) {
  const [o, setO] = useState<Occlusion>(initial);
  const [sel, setSel] = useState<string | null>(null);
  const [tool, setTool] = useState<"draw" | "pan">("draw");
  const [view, setView] = useState({ s: 1, tx: 0, ty: 0 });
  const [picking, setPicking] = useState(!initial.image);
  const [sheet, setSheet] = useState(false);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const op = useRef<Op | null>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const dirty = useRef(false);
  const url = useImageSrc(o.image);
  const cards = occlusionCardCount(o);

  const edit = useCallback((f: (x: Occlusion) => Occlusion) => { dirty.current = true; setO(f); }, []);
  const setBox = (id: string, f: (b: OcclusionBox) => OcclusionBox) => edit((x) => ({ ...x, boxes: x.boxes.map((b) => (b.id === id ? f(b) : b)) }));
  const remove = (id: string) => { edit((x) => ({ ...x, boxes: x.boxes.filter((b) => b.id !== id) })); setSel((s) => (s === id ? null : s)); };
  const reorder = (id: string, d: -1 | 1) => edit((x) => {
    const i = x.boxes.findIndex((b) => b.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= x.boxes.length) return x;
    const boxes = [...x.boxes];
    [boxes[i], boxes[j]] = [boxes[j], boxes[i]];
    return { ...x, boxes };
  });

  // Fit the image into the stage.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [picking]);
  const fit = useMemo(() => {
    if (!nat || !stage.w) return null;
    const pad = 24;
    const k = Math.min((stage.w - pad * 2) / nat.w, (stage.h - pad * 2) / nat.h, 2);
    const w = Math.max(40, nat.w * k), h = Math.max(40, nat.h * k);
    return { w, h, x: (stage.w - w) / 2, y: (stage.h - h) / 2 };
  }, [nat, stage]);

  const close = useCallback(() => {
    if (dirty.current && !confirm("Discard changes to these boxes?")) return;
    onClose();
  }, [onClose]);
  const save = () => { onSave({ ...o, boxes: o.boxes.map((b) => clampBox(b)) }); onClose(); };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input,textarea,select")) { if (e.key === "Escape") t.blur(); return; }
      if (e.key === "Escape") { e.preventDefault(); if (sel) setSel(null); else close(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); remove(sel); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); save(); }
      else if (e.key === "+" || e.key === "=") zoomBy(1.25);
      else if (e.key === "-") zoomBy(0.8);
      else if (e.key === "0") setView({ s: 1, tx: 0, ty: 0 });
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  // ---- pointer math: normalized point on the image
  const norm = (cx0: number, cy0: number) => {
    const r = innerRef.current!.getBoundingClientRect();
    return { x: (cx0 - r.left) / r.width, y: (cy0 - r.top) / r.height };
  };
  const stagePt = (cx0: number, cy0: number) => { const r = stageRef.current!.getBoundingClientRect(); return { x: cx0 - r.left, y: cy0 - r.top }; };
  const clampS = (s: number) => Math.min(8, Math.max(1, s));
  function zoomAt(s1: number, px: number, py: number) {
    setView((v) => {
      const s = clampS(s1);
      if (s === 1) return { s: 1, tx: 0, ty: 0 };
      // keep the stage point (px,py) fixed: p = t + s*q
      return { s, tx: px - ((px - v.tx) * s) / v.s, ty: py - ((py - v.ty) * s) / v.s };
    });
  }
  const zoomBy = (f: number) => zoomAt(view.s * f, stage.w / 2, stage.h / 2);

  function down(e: RPointerEvent<HTMLDivElement>) {
    if (!fit || (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1)) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2) {
      // second finger: abandon the current op (a box being drawn is dropped) and pinch
      if (op.current?.k === "draw") { const id = op.current.id; setO((x) => ({ ...x, boxes: x.boxes.filter((b) => b.id !== id) })); }
      const [a, b] = [...ptrs.current.values()];
      const m = stagePt((a.x + b.x) / 2, (a.y + b.y) / 2);
      op.current = { k: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: m.x, my: m.y, s: view.s, tx: view.tx, ty: view.ty };
      return;
    }
    if (ptrs.current.size > 2) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-box],[data-handle]");
    const p = norm(e.clientX, e.clientY);
    if (el?.dataset.handle) {
      const b = o.boxes.find((x) => x.id === el.dataset.id);
      if (b) { op.current = { k: "resize", id: b.id, corner: el.dataset.handle, b }; setSel(b.id); }
      return;
    }
    if (el?.dataset.box && tool === "draw") {
      const b = o.boxes.find((x) => x.id === el.dataset.box)!;
      op.current = { k: "move", id: b.id, px: p.x, py: p.y, b };
      setSel(b.id);
      return;
    }
    if (tool === "pan" || e.button === 1) {
      const s = stagePt(e.clientX, e.clientY);
      op.current = { k: "pan", cx: s.x, cy: s.y, tx: view.tx, ty: view.ty };
      return;
    }
    if (p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1) { setSel(null); return; }
    const id = nextBoxId(o);
    dirty.current = true;
    setO((x) => ({ ...x, boxes: [...x.boxes, { id, x: p.x, y: p.y, w: 0, h: 0 }] }));
    op.current = { k: "draw", id, ax: p.x, ay: p.y };
    setSel(id);
  }
  function move(e: RPointerEvent<HTMLDivElement>) {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = op.current;
    if (!c) return;
    if (c.k === "pinch") {
      const [a, b] = [...ptrs.current.values()];
      if (!b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const m = stagePt((a.x + b.x) / 2, (a.y + b.y) / 2);
      const s = clampS((c.s * d) / c.d);
      // image point under the start midpoint stays under the (moving) midpoint
      setView(s === 1 ? { s: 1, tx: 0, ty: 0 } : { s, tx: m.x - ((c.mx - c.tx) * s) / c.s, ty: m.y - ((c.my - c.ty) * s) / c.s });
      return;
    }
    if (c.k === "pan") { const s = stagePt(e.clientX, e.clientY); setView((v) => ({ ...v, tx: c.tx + s.x - c.cx, ty: c.ty + s.y - c.cy })); return; }
    const p = norm(e.clientX, e.clientY);
    const cl = (v: number) => Math.min(1, Math.max(0, v));
    if (c.k === "draw") {
      const x = cl(p.x), y = cl(p.y);
      setBox(c.id, (b) => ({ ...b, x: Math.min(c.ax, x), y: Math.min(c.ay, y), w: Math.abs(x - c.ax), h: Math.abs(y - c.ay) }));
    } else if (c.k === "move") {
      setBox(c.id, () => clampBox({ ...c.b, x: c.b.x + p.x - c.px, y: c.b.y + p.y - c.py }));
    } else if (c.k === "resize") {
      const b = c.b;
      let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
      if (c.corner.includes("w")) x1 = cl(p.x); if (c.corner.includes("e")) x2 = cl(p.x);
      if (c.corner.includes("n")) y1 = cl(p.y); if (c.corner.includes("s")) y2 = cl(p.y);
      setBox(c.id, (bb) => ({ ...bb, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }));
    }
  }
  function up(e: RPointerEvent<HTMLDivElement>) {
    ptrs.current.delete(e.pointerId);
    const c = op.current;
    if (c?.k === "pinch") { if (ptrs.current.size < 2) op.current = null; return; }
    op.current = null;
    if (c?.k === "draw") {
      setO((x) => {
        const b = x.boxes.find((bb) => bb.id === c.id);
        if (!b) return x;
        // a tap (no drag) makes no box
        if (b.w < 0.008 && b.h < 0.008) { queueMicrotask(() => setSel(null)); return { ...x, boxes: x.boxes.filter((bb) => bb.id !== c.id) }; }
        return { ...x, boxes: x.boxes.map((bb) => (bb.id === c.id ? clampBox(bb) : bb)) };
      });
      setSheet(false);
    } else if (c?.k === "resize" || c?.k === "move") setBox(c.id, (b) => clampBox(b));
  }
  function wheel(e: React.WheelEvent) {
    if (!fit) return;
    const s = stagePt(e.clientX, e.clientY);
    if (e.ctrlKey || e.metaKey) zoomAt(view.s * Math.exp(-e.deltaY / 300), s.x, s.y);
    else if (view.s > 1) setView((v) => ({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY }));
  }

  // ---- image picker
  const images = useMemo(() => noteImages(noteBody), [noteBody]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlIn, setUrlIn] = useState("");
  const pick = (src: string) => { edit((x) => ({ ...x, image: src })); setNat(null); setView({ s: 1, tx: 0, ty: 0 }); setPicking(false); };
  async function upload(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast("Choose an image file"); return; }
    try { const md = await addFile(f); const id = /\(att:([\w-]+)\)/.exec(md)?.[1]; if (id) pick(`att:${id}`); } catch (err) { toast((err as Error).message); }
  }

  const selBox = o.boxes.find((b) => b.id === sel);
  const list = (
    <div className="flex flex-col gap-1">
      {!o.boxes.length && <p className="px-1 py-2 text-[13px] text-muted">Drag on the image to draw a box over each label. Each box becomes one card.</p>}
      {o.boxes.map((b, i) => (
        <div key={b.id} onClick={() => setSel(b.id)} className={cx("group flex flex-col gap-1.5 rounded-[8px]", sel === b.id ? "bg-surface-2" : "hover:bg-[color-mix(in_srgb,var(--surface-2)_50%,transparent)]")}>
          <div className="flex min-h-9 items-center gap-2.5 px-2">
            <span className="occl-num static" style={{ background: sel === b.id ? "var(--accent)" : "var(--learn)" }}>{i + 1}</span>
            <input dir="auto" aria-label={`Label for box ${i + 1}`} placeholder="Label (the answer)" value={b.label ?? ""} onChange={(e) => setBox(b.id, (x) => ({ ...x, label: e.target.value || undefined }))} className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-muted" />
            <IconButton label="Delete box" className={cx("size-9 md:size-7", sel !== b.id && "md:opacity-0 md:group-hover:opacity-100")} onClick={(e) => { e.stopPropagation(); remove(b.id); }}><Trash2 size={14} /></IconButton>
          </div>
          {sel === b.id && (
            <div className="flex items-center gap-1.5 pb-1.5 pe-2 ps-9">
              <input dir="auto" aria-label="Group" placeholder="Group (optional)" value={b.group ?? ""} onChange={(e) => setBox(b.id, (x) => ({ ...x, group: e.target.value.trim() || undefined }))} className={cx(inputCls, "h-9 min-w-0 flex-1 text-[13px]")} />
              <IconButton label="Move up" className="size-9 md:size-8" disabled={i === 0} onClick={(e) => { e.stopPropagation(); reorder(b.id, -1); }}><ArrowUp size={15} /></IconButton>
              <IconButton label="Move down" className="size-9 md:size-8" disabled={i === o.boxes.length - 1} onClick={(e) => { e.stopPropagation(); reorder(b.id, 1); }}><ArrowDown size={15} /></IconButton>
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const modeCtl = (
    <div role="radiogroup" aria-label="Card mode" className="flex gap-[2px] self-start rounded-[8px] border border-line bg-surface p-[3px] text-[12px]">
      {([["hide-one", "Hide one", "Hide one, show others"], ["hide-all", "Hide all", "Hide all, guess one"]] as [OcclusionMode, string, string][]).map(([v, l, t]) => (
        <button key={v} role="radio" aria-checked={o.mode === v} title={t} onClick={() => edit((x) => ({ ...x, mode: v }))}
          className={cx("flex h-6 items-center rounded-[6px] px-[9px]", o.mode === v ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}>{l}</button>
      ))}
    </div>
  );

  return (
    <div className="occl-editor fixed inset-0 z-[60] flex flex-col bg-bg text-ink fade-in" role="dialog" aria-modal="true" aria-label="Image occlusion">
      <div className="safe-t flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-2 text-[13px] md:h-12 md:px-4">
        <IconButton label="Close" className="size-11 md:size-7" onClick={close}><X size={16} /></IconButton>
        <Glyph name="occlusion" size={16} color="var(--learn)" />
        <span className="min-w-0 flex-1 truncate font-semibold">Image occlusion{o.alt ? ` · ${o.alt}` : ""}</span>
        <div className="hidden md:block">{modeCtl}</div>
        {!picking && (
          <span className="hidden items-center gap-1 text-muted md:flex">
            <button aria-label="Zoom out" className="px-1 hover:text-ink" onClick={() => zoomBy(0.8)}>−</button>
            <button title="Fit" className="tabular-nums hover:text-ink" onClick={() => setView({ s: 1, tx: 0, ty: 0 })}>{Math.round(view.s * 100)}%</button>
            <button aria-label="Zoom in" className="px-1 hover:text-ink" onClick={() => zoomBy(1.25)}>+</button>
          </span>
        )}
        {!picking && <button className="hidden text-muted hover:text-ink md:flex md:items-center md:gap-1" onClick={() => setPicking(true)}><ImagePlus size={14} />Image</button>}
        <button onClick={save} disabled={!o.image} className="flex h-10 items-center whitespace-nowrap rounded-[8px] bg-accent px-3 font-semibold text-accent-fg disabled:opacity-50 md:h-[30px]">Done · {cards} {cards === 1 ? "card" : "cards"}</button>
      </div>

      {picking ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto flex max-w-[640px] flex-col gap-5">
            <div>
              <div className="text-[17px] font-semibold">Choose an image</div>
              <p className="mt-1 text-[13px] text-muted">Use an image from this note, a PDF area capture, a new upload or a link.</p>
            </div>
            {images.length > 0 && (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {images.map((im) => <PickTile key={im.src} src={im.src} alt={im.alt} active={im.src === o.image} onPick={() => pick(im.src)} />)}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="lg" onClick={() => fileRef.current?.click()}><ImagePlus size={17} />Upload image</Button>
              {o.image && <Button size="lg" variant="ghost" onClick={() => setPicking(false)}>Keep current image</Button>}
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const u = urlIn.trim(); if (safeImageUrl(u) || attId(u)) pick(u); else toast("Enter an https:// image link"); }}>
              <input value={urlIn} onChange={(e) => setUrlIn(e.target.value)} placeholder="https://… image link" className={cx(inputCls, "h-11 flex-1")} dir="ltr" />
              <Button size="lg" type="submit">Use link</Button>
            </form>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="relative min-h-0 min-w-0 flex-1">
            <div
              ref={stageRef}
              className={cx("occl-stage-ed absolute inset-0 overflow-hidden bg-[color-mix(in_srgb,var(--surface)_50%,var(--bg))]", tool === "pan" ? "cursor-grab" : "cursor-crosshair")}
              style={{ touchAction: "none" }}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}
            >
              {url && (
                <div style={{ position: "absolute", left: 0, top: 0, transform: `translate(${view.tx}px,${view.ty}px) scale(${view.s})`, transformOrigin: "0 0" }}>
                  <div ref={innerRef} className="absolute" style={fit ? { left: fit.x, top: fit.y, width: fit.w, height: fit.h } : { left: 0, top: 0, visibility: "hidden" }}>
                    <img src={url} alt={o.alt ?? ""} draggable={false} onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth || 800, h: e.currentTarget.naturalHeight || 600 })} className="pointer-events-none block size-full select-none" />
                    {o.boxes.map((b, i) => (
                      <div key={b.id} data-box={b.id} className={cx("occl-ed-box", sel === b.id && "on")} style={{ ...boxStyle(b), ["--k" as string]: 1 / view.s }}>
                        <span className="occl-num">{i + 1}</span>
                        {sel === b.id && ["nw", "ne", "sw", "se"].map((h) => <span key={h} data-handle={h} data-id={b.id} className={`occl-ed-h occl-ed-${h}`} />)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!url && <div className="absolute inset-0 flex items-center justify-center text-[13px] text-muted">Loading image…</div>}
            </div>
            {/* floating tools */}
            <div className="absolute start-3 top-3 z-10 flex gap-1 rounded-[10px] border border-line bg-surface p-1 shadow-lg">
              <IconButton label="Draw boxes" active={tool === "draw"} className="size-10 md:size-8" onClick={() => setTool("draw")}><SquareDashed size={16} /></IconButton>
              <IconButton label="Pan" active={tool === "pan"} className="size-10 md:size-8" onClick={() => setTool("pan")}><Hand size={16} /></IconButton>
              <span className="my-1 w-px bg-line md:hidden" />
              <IconButton label="Zoom out" className="size-10 md:hidden" onClick={() => zoomBy(0.8)}><Minus size={16} /></IconButton>
              <IconButton label="Fit" className="size-10 md:hidden" onClick={() => setView({ s: 1, tx: 0, ty: 0 })}><Maximize size={15} /></IconButton>
              <IconButton label="Zoom in" className="size-10 md:hidden" onClick={() => zoomBy(1.25)}><Plus size={16} /></IconButton>
              {selBox && <><span className="my-1 w-px bg-line" /><IconButton label="Delete box" className="size-10 md:size-8" onClick={() => remove(selBox.id)}><Trash2 size={15} /></IconButton></>}
            </div>
          </div>
          {/* desktop side panel */}
          <aside className="hidden w-[260px] shrink-0 flex-col gap-2 border-s border-line bg-surface p-[14px] text-[13px] md:flex">
            <span className="font-semibold">Boxes · {o.boxes.length}</span>
            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">{list}</div>
            <p className="text-[12px] leading-[17px] text-muted">Drag to draw · drag a box to move · corners resize · Delete removes · labels are the answers. Same group = one card.</p>
          </aside>
          {/* phone bottom sheet */}
          <div className={cx("safe-b flex shrink-0 flex-col border-t border-line bg-surface md:hidden", sheet ? "h-[52dvh]" : "")}>
            <button className="flex h-14 w-full items-center gap-3 px-4 text-[14px]" onClick={() => setSheet((s) => !s)} aria-expanded={sheet}>
              <span className="h-1 w-9 rounded-[2px] bg-line" />
              <span className="font-semibold">{o.boxes.length} {o.boxes.length === 1 ? "box" : "boxes"}</span>
              <span className="text-muted">· {cards} {cards === 1 ? "card" : "cards"}</span>
              <span className="flex-1" />
              <span className="text-[13px] text-accent">{sheet ? "Hide" : "Edit list"}</span>
            </button>
            {sheet && (
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
                {modeCtl}
                <Button variant="ghost" className="self-start" onClick={() => setPicking(true)}><ImagePlus size={15} />Change image</Button>
                {list}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PickTile({ src, alt, active, onPick }: { src: string; alt: string; active: boolean; onPick: () => void }) {
  const url = useImageSrc(src);
  return (
    <button onClick={onPick} className={cx("flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[10px] border bg-surface p-1", active ? "border-accent" : "border-line hover:border-muted")} title={alt || src}>
      {url ? <img src={url} alt={alt} className="max-h-full max-w-full object-contain" /> : <span className="text-[12px] text-muted">Loading…</span>}
    </button>
  );
}

/** Open the editor outside the React tree (used by the CodeMirror extension). */
export function openOcclusionEditor(props: Omit<EditorProps, "onClose"> & { onClose?: () => void }) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const done = () => { root.unmount(); host.remove(); props.onClose?.(); };
  root.render(<OcclusionEditor {...props} onClose={done} />);
  return done;
}
