// Contextual property bar (design 33A / 33C / 44A): floats 24 px above the selection, or docks under the toolbar when
// a tool is active and nothing is selected. Shows only what the selection has; each control opens a small popover.
// Replaces Excalidraw's tall style panel and the old sticky bar (both hidden), so nothing can overlap any more.
import { ArrangePopover } from "./layers/Arrange";
import { selectedIsVendor } from "../../lib/library-items";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { t, tk } from "../../lib/i18n";
import { Glyph } from "../Glyph";
import { cx } from "../ui";
import { wbRegistry, type WbCtx } from "./hooks";
import { LUMEN_INK_DARK, LUMEN_INK_LIGHT, PAPER, shown } from "./tools";
import { pxToSw, swToPx, THICK_PRESETS } from "./pens/model";
import { libraryPopover } from "../library/register";
import { AC_BG, Choices, Label, Pop, Row, Swatch } from "./ui";

export type BarMode = "shape" | "line" | "ink" | "sticky" | "text" | "media" | "tool-ink" | "tool-shape" | "tool-line" | "tool-text";
export type Style = {
  strokeColor: string | null; backgroundColor: string | null; fillStyle: string | null; strokeWidth: number | null; strokeStyle: string | null;
  roughness: number | null; roundness: "round" | "sharp" | null; fontFamily: number | null; fontSize: number | null; textAlign: string | null;
  opacity: number | null; startArrowhead: string | null; endArrowhead: string | null; arrowType: string | null; link: string | null; locked: boolean;
  /** W2-A: customData.lumenExact on every selected element (keep exact colour in dark theme). */
  exact?: boolean | null;
};
export type Action = "front" | "forward" | "backward" | "back" | "group" | "ungroup" | "duplicate" | "delete" | "lock" | "align-left" | "align-center" | "align-right" | "align-top" | "align-middle" | "align-bottom";

const FONTS: [number, string][] = [[5, tk("Hand")], [6, tk("Sans")], [20, tk("Serif")], [8, tk("Code")], [21, tk("Arabic")]];
const SIZES: [number, string][] = [[16, "S"], [20, "M"], [28, "L"], [36, "XL"]];
const HEADS: [string, string, string][] = [["none", "arrowhead-none", tk("None")], ["arrow", "arrowhead-arrow", tk("Arrow")], ["triangle", "arrowhead-triangle-filled", tk("Triangle")], ["triangle_outline", "arrowhead-triangle-outline", tk("Triangle outline")], ["bar", "arrowhead-bar", tk("Bar")], ["dot", "arrowhead-dot", tk("Dot")], ["circle_outline", "arrowhead-dot-outline", tk("Circle outline")], ["diamond", "arrowhead-diamond", tk("Diamond")]];
const fontName = (f: number | null) => t(FONTS.find(([v]) => v === f)?.[1] ?? (f == null ? "Hand" : "Mixed"));

type Key = "stroke" | "fill" | "fillStyle" | "width" | "rough" | "edges" | "font" | "size" | "opacity" | "arrange" | "link" | "more" | "heads" | "type";

export function PropertyBar({ mode, style, pos, phone, dark, ctx, onSet, onAction, penLabel, penGlyph, onPens }: {
  mode: BarMode; style: Style; pos: { x: number; y: number } | null; phone: boolean; dark: boolean; ctx: WbCtx;
  onSet: (p: Partial<Style>) => void; onAction: (a: Action) => void; penLabel?: string; penGlyph?: string; onPens?: () => void;
}) {
  const [open, setOpen] = useState<Key | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  const ink = dark ? LUMEN_INK_DARK : LUMEN_INK_LIGHT;
  const tool = mode.startsWith("tool-");
  const toggle = (k: Key) => (e: React.MouseEvent) => { setAnchor((e.currentTarget as HTMLElement).getBoundingClientRect()); setOpen(open === k ? null : k); if (k === "link") setLinkDraft(style.link ?? ""); };
  const close = () => setOpen(null);

  // vendor icons are shown exactly as published: no recolouring
  const vendor = !!ctx.api && !mode.startsWith("tool-") && selectedIsVendor(ctx.api as never);
  const Btn = ({ k, glyph, sw, label, tip, on }: { k: Key; glyph?: string; sw?: string | null; label?: ReactNode; tip: string; on?: boolean }) => (
    <button type="button" data-pop-anchor title={vendor && (k === "stroke" || k === "fill") ? t("Vendor icons are never recoloured") : tip} aria-label={tip} disabled={vendor && (k === "stroke" || k === "fill")} onClick={toggle(k)}
      className={cx("flex h-[30px] min-w-[30px] shrink-0 items-center justify-center gap-[5px] rounded-[7px] px-[6px] text-[12px]", open === k || on ? "text-accent" : "text-ink hover:bg-surface")}
      style={open === k || on ? { background: AC_BG } : undefined}>
      {sw !== undefined && <span className="size-[18px] rounded-[5px]" style={{ background: sw == null ? "linear-gradient(135deg,var(--surface) 45%,var(--muted) 45% 55%,var(--surface) 55%)" : sw === "transparent" ? "repeating-conic-gradient(var(--surface) 0 25%, var(--bg) 0 50%) 0 0/6px 6px" : shown(sw, dark), boxShadow: "inset 0 0 0 1px rgba(0,0,0,.15)" }} />}
      {glyph && <Glyph name={glyph} size={17} />}
      {label != null && <span className="whitespace-nowrap">{label}</span>}
    </button>
  );
  const S = () => <span aria-hidden className="mx-[3px] h-5 w-px shrink-0 bg-line" />;

  const colours = (target: "stroke" | "fill") => {
    if (wbRegistry.palette) return wbRegistry.palette({ ...ctx, dark, phone, style, setStyle: onSet, close, anchor, target });
    const cur = target === "stroke" ? style.strokeColor : style.backgroundColor;
    const list = target === "stroke" ? ink : ["transparent", ...PAPER, ...ink.slice(1)];
    return (
      <div className="w-[248px]">
        <Label right={t("Lumen ink")}>{target === "stroke" ? t("Stroke") : t("Fill")}</Label>
        <div className="grid grid-cols-6 gap-1.5 p-1">{list.map((c) => <Swatch key={c} c={c === "transparent" ? c : shown(c, dark)} title={c === "transparent" ? t("No fill") : c} sel={cur?.toLowerCase() === c.toLowerCase()} size={30} onClick={() => onSet(target === "stroke" ? { strokeColor: c } : { backgroundColor: c, ...(c !== "transparent" && style.fillStyle == null ? { fillStyle: "solid" } : {}) })} />)}</div>
        <label className="mt-1 flex h-[32px] items-center gap-2 rounded-[8px] border border-line px-2 text-[12px]">
          <span className="size-4 rounded-[4px]" style={{ background: cur && cur !== "transparent" ? shown(cur, dark) : "transparent", boxShadow: "inset 0 0 0 1px rgba(0,0,0,.15)" }} />
          <input key={cur ?? ""} defaultValue={cur ?? ""} spellCheck={false} dir="ltr" className="min-w-0 flex-1 bg-transparent font-mono outline-none" aria-label={t("Hex colour")}
            onKeyDown={(e) => { const v = (e.target as HTMLInputElement).value.trim(); if (e.key === "Enter" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) onSet(target === "stroke" ? { strokeColor: v } : { backgroundColor: v }); }} />
        </label>
      </div>
    );
  };
  const range = (v: number, set: (n: number) => void, min = 0, max = 100, step = 10, unit = "%") => (
    <div className="flex w-[220px] items-center gap-3 px-1 py-1.5">
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" aria-label={t("Value")} />
      <span className="w-10 text-end text-[12px] tabular-nums text-muted">{v}{unit}</span>
    </div>
  );
  const inkMode = mode === "ink" || mode === "tool-ink";
  const widths: [number, string, string][] = inkMode ? THICK_PRESETS.map((px) => [pxToSw(px), "stroke-solid", px + " px"] as [number, string, string]) : [[1, "stroke-thin", t("Thin")], [2, "stroke-solid", t("Bold")], [4, "stroke-bold", t("Extra bold")]];

  const body = (): ReactNode => {
    if (!(inkMode && open === "width")) { const lib = libraryPopover(open, mode, { ...ctx, dark, phone, style, setStyle: onSet, close }); if (lib) return lib; }
    switch (open) {
      case "stroke": return colours("stroke");
      case "fill": return colours("fill");
      case "fillStyle": return <div className="p-1"><Label>{t("Fill style")}</Label><Choices value={style.fillStyle} onPick={(v) => onSet({ fillStyle: v })} items={[["hachure", "fill-hachure", t("Hachure")], ["cross-hatch", "fill-crosshatch", t("Cross-hatch")], ["solid", "fill-solid", t("Solid")], ["zigzag", "fill-zigzag", t("Zigzag")]]} /></div>;
      case "width": return (
        <div className="flex flex-col gap-2 p-1">
          <Label right={style.strokeWidth != null ? `${inkMode ? swToPx(style.strokeWidth) : style.strokeWidth} px` : "—"}>{t("Thickness")}</Label>
          <div className="flex gap-1">{widths.map(([v, , tip]) => (
            <button key={v} type="button" title={tip} onClick={() => onSet({ strokeWidth: v })} className={cx("flex h-[32px] min-w-[36px] items-center justify-center rounded-[8px] border", Math.abs((style.strokeWidth ?? -9) - v) < 0.01 ? "border-accent" : "border-line hover:bg-surface-2")} style={Math.abs((style.strokeWidth ?? -9) - v) < 0.01 ? { background: AC_BG } : undefined}>
              <span className="rounded-full bg-ink" style={{ width: inkMode ? Math.max(4, Math.min(16, swToPx(v))) : Math.max(4, Math.min(16, v + 2)), height: inkMode ? Math.max(4, Math.min(16, swToPx(v))) : Math.max(4, Math.min(16, v + 2)) }} />
            </button>))}</div>
          {mode !== "ink" && mode !== "tool-ink" && <><Label>{t("Stroke style")}</Label><Choices value={style.strokeStyle} onPick={(v) => onSet({ strokeStyle: v })} items={[["solid", "stroke-solid", t("Solid")], ["dashed", "stroke-dashed", t("Dashed")], ["dotted", "stroke-dotted", t("Dotted")]]} /></>}
        </div>
      );
      case "rough": return <div className="p-1"><Label>{t("Sloppiness")}</Label><Choices value={style.roughness} onPick={(v) => onSet({ roughness: v })} items={[[0, "sloppiness-0", t("Architect")], [1, "sloppiness-1", t("Artist")], [2, "sloppiness-2", t("Cartoonist")]]} /></div>;
      case "edges": return <div className="p-1"><Label>{t("Edges")}</Label><Choices value={style.roundness} onPick={(v) => onSet({ roundness: v })} items={[["sharp", "edges-sharp", t("Sharp")], ["round", "edges-round", t("Round")]]} /></div>;
      case "font": case "size": return (
        <div className="flex w-[220px] flex-col gap-1 p-1">
          <Label>{t("Font")}</Label>
          {FONTS.map(([v, l]) => <Row key={v} label={<span style={{ fontFamily: v === 8 ? "'JetBrains Mono',monospace" : v === 20 ? "'Source Serif 4',serif" : v === 21 ? "'IBM Plex Sans Arabic',sans-serif" : v === 6 ? "Inter,sans-serif" : "Caveat,'Comic Sans MS',cursive", fontSize: v === 5 ? 16 : 12.5 }}>{t(l)}</span>} on={style.fontFamily === v} onClick={() => onSet({ fontFamily: v })} />)}
          <Label>{t("Size")}</Label>
          <div className="flex gap-1">{SIZES.map(([v, l]) => <button key={v} type="button" onClick={() => onSet({ fontSize: v })} className={cx("h-[30px] flex-1 rounded-[7px] border text-[12px] font-semibold", style.fontSize === v ? "border-accent text-accent" : "border-line")} style={style.fontSize === v ? { background: AC_BG } : undefined}>{l}</button>)}</div>
          {mode !== "sticky" && <><Label>{t("Align")}</Label><Choices value={style.textAlign} onPick={(v) => onSet({ textAlign: v })} items={[["left", "align-left", t("Left")], ["center", "align-center", t("Centre")], ["right", "align-right", t("Right")]]} /></>}
        </div>
      );
      case "opacity": return <div className="p-1"><Label>{t("Opacity")}</Label>{range(style.opacity ?? 100, (n) => onSet({ opacity: n }))}</div>;
      case "heads": return (
        <div className="flex flex-col gap-1 p-1">
          <Label>{t("Start")}</Label><div className="flex flex-wrap gap-1"><Choices value={style.startArrowhead ?? "none"} onPick={(v) => onSet({ startArrowhead: v })} items={HEADS.map(([v, g, l]) => [v, g, t(l)])} /></div>
          <Label>{t("End")}</Label><div className="flex flex-wrap gap-1"><Choices value={style.endArrowhead ?? "none"} onPick={(v) => onSet({ endArrowhead: v })} items={HEADS.map(([v, g, l]) => [v, g, t(l)])} /></div>
        </div>
      );
      case "type": return <div className="p-1"><Label>{t("Arrow type")}</Label><Choices value={style.arrowType} onPick={(v) => onSet({ arrowType: v })} items={[["sharp", "path-straight", t("Straight")], ["round", "path-curved", t("Curved")], ["elbow", "path-elbow", t("Elbow")]]} /></div>;
      case "arrange": return <ArrangePopover phone={phone} count={Object.keys((ctx.api?.getAppState().selectedElementIds ?? {}) as object).length} run={(x) => { if (ctx.arrange) ctx.arrange(x); else onAction(x as Action); close(); }} />;
      case "link": return (
        <form className="flex w-[280px] items-center gap-1.5 p-1" onSubmit={(e) => { e.preventDefault(); onSet({ link: linkDraft.trim() || null }); close(); }}>
          <input autoFocus value={linkDraft} onChange={(e) => setLinkDraft(e.target.value)} placeholder="https://…" dir="ltr" className="h-[32px] min-w-0 flex-1 rounded-[8px] border border-line bg-bg px-2 text-[12.5px] outline-none focus:border-accent" aria-label={t("Link")} />
          <button type="submit" className="h-[32px] rounded-[8px] bg-accent px-2.5 text-[12.5px] font-semibold text-accent-fg">{t("Save")}</button>
          {style.link && <button type="button" title={t("Remove link")} onClick={() => { onSet({ link: null }); close(); }} className="flex size-[32px] items-center justify-center rounded-[8px] border border-line"><Glyph name="trash" size={15} /></button>}
        </form>
      );
      case "more": return (
        <div className="w-[200px]">
          <Row glyph="duplicate" label={t("Duplicate")} hint="Ctrl D" onClick={() => { onAction("duplicate"); close(); }} />
          <Row glyph={style.locked ? "unlock" : "lock"} label={style.locked ? t("Unlock") : t("Lock")} onClick={() => { onAction("lock"); close(); }} />
          <Row glyph="trash" label={t("Delete")} hint="Del" danger onClick={() => { onAction("delete"); close(); }} />
        </div>
      );
      default: return null;
    }
  };

  const items: ReactNode[] = [];
  const push = (...n: ReactNode[]) => items.push(...n);
  const arrange = [<Btn key="ar" k="arrange" glyph="bring-front" tip={t("Arrange")} />];
  const tail = [<Btn key="ln" k="link" glyph="link" tip={t("Link")} on={!!style.link} />, <Btn key="mo" k="more" glyph="more" tip={t("More")} />];
  if (mode === "shape" || mode === "tool-shape") {
    push(<Btn key="s" k="stroke" sw={style.strokeColor} tip={t("Stroke colour")} />, <Btn key="f" k="fill" sw={style.backgroundColor} tip={t("Fill colour")} />, <Btn key="fs" k="fillStyle" glyph={style.fillStyle === "solid" ? "fill-solid" : style.fillStyle === "cross-hatch" ? "fill-crosshatch" : style.fillStyle === "zigzag" ? "fill-zigzag" : "fill-hachure"} tip={t("Fill style")} />, <S key="1" />,
      <Btn key="w" k="width" glyph={style.strokeStyle === "dashed" ? "stroke-dashed" : style.strokeStyle === "dotted" ? "stroke-dotted" : "stroke-solid"} tip={t("Stroke width and style")} />, <Btn key="r" k="rough" glyph={`sloppiness-${style.roughness ?? 1}`} tip={t("Sloppiness")} />, <Btn key="e" k="edges" glyph={style.roundness === "sharp" ? "edges-sharp" : "edges-round"} tip={t("Edges")} />, <S key="2" />);
    if (style.fontFamily != null || mode === "shape") push(<Btn key="fo" k="font" glyph="font" label={fontName(style.fontFamily)} tip={t("Font")} />);
    push(<Btn key="o" k="opacity" glyph="opacity" tip={t("Opacity")} />);
    if (!tool) push(<S key="3" />, ...arrange, ...tail);
  } else if (mode === "line" || mode === "tool-line") {
    push(<Btn key="s" k="stroke" sw={style.strokeColor} tip={t("Stroke colour")} />, <S key="1" />, <Btn key="w" k="width" glyph={style.strokeStyle === "dashed" ? "stroke-dashed" : style.strokeStyle === "dotted" ? "stroke-dotted" : "stroke-solid"} tip={t("Stroke width and style")} />, <Btn key="r" k="rough" glyph={`sloppiness-${style.roughness ?? 1}`} tip={t("Sloppiness")} />,
      <Btn key="h" k="heads" glyph={`arrowhead-${style.endArrowhead === "triangle" ? "triangle-filled" : style.endArrowhead && style.endArrowhead !== "none" ? (style.endArrowhead === "circle_outline" ? "dot-outline" : style.endArrowhead === "triangle_outline" ? "triangle-outline" : style.endArrowhead) : "none"}`} tip={t("Arrowheads")} />,
      <Btn key="ty" k="type" glyph={style.arrowType === "elbow" ? "path-elbow" : style.arrowType === "round" ? "path-curved" : "path-straight"} tip={t("Arrow type")} />, <S key="2" />, <Btn key="o" k="opacity" glyph="opacity" tip={t("Opacity")} />);
    if (!tool) push(<S key="3" />, ...arrange, ...tail);
  } else if (mode === "ink" || mode === "tool-ink") {
    push(<Btn key="s" k="stroke" sw={style.strokeColor} tip={t("Colour")} />);
    if (penLabel && onPens) push(<button key="pen" type="button" title={t("Change pen")} onClick={onPens} className="flex h-[30px] items-center gap-[5px] rounded-[7px] px-[6px] text-[12px] hover:bg-surface"><Glyph name={penGlyph ?? "pen-fountain"} size={17} />{penLabel}</button>);
    push(<Btn key="w" k="width" glyph="stroke-solid" label={style.strokeWidth == null ? "—" : tool ? `${swToPx(style.strokeWidth)} px` : String(swToPx(style.strokeWidth))} tip={t("Thickness")} />, <Btn key="o" k="opacity" glyph="opacity" label={tool ? `${style.opacity ?? 100}%` : undefined} tip={t("Opacity")} />);
    if (tool && wbRegistry.inkExtras) push(<S key="x" />, <span key="ex" className="contents">{wbRegistry.inkExtras(ctx)}</span>);
    if (!tool) push(<S key="3" />, ...arrange, tail[1]);
  } else if (mode === "sticky") {
    push(<Btn key="f" k="fill" sw={style.backgroundColor} tip={t("Paper colour")} />, <Btn key="sz" k="size" glyph="rect" label={SIZES.find(([v]) => v === style.fontSize)?.[1] ?? "M"} tip={t("Size")} />, <Btn key="fo" k="font" glyph="font" label={fontName(style.fontFamily)} tip={t("Font")} />, <S key="1" />,
      <Btn key="fs" k="fillStyle" glyph={style.fillStyle === "solid" ? "fill-solid" : style.fillStyle === "cross-hatch" ? "fill-crosshatch" : style.fillStyle === "zigzag" ? "fill-zigzag" : "fill-hachure"} tip={t("Fill style")} />, <Btn key="r" k="rough" glyph={`sloppiness-${style.roughness ?? 1}`} tip={t("Sloppiness")} />, <Btn key="e" k="edges" glyph={style.roundness === "sharp" ? "edges-sharp" : "edges-round"} tip={t("Edges")} />, <S key="2" />,
      <Btn key="st" k="arrange" glyph="layers" label={t("Stack")} tip={t("Stack")} />,
      <button key="du" type="button" title={t("Duplicate") + " · Ctrl D"} aria-label={t("Duplicate")} onClick={() => onAction("duplicate")} className="flex size-[30px] items-center justify-center rounded-[7px] hover:bg-surface"><Glyph name="duplicate" size={17} /></button>,
      <button key="de" type="button" title={t("Delete") + " · Delete"} aria-label={t("Delete")} onClick={() => onAction("delete")} className="flex size-[30px] items-center justify-center rounded-[7px] hover:bg-surface hover:text-bad"><Glyph name="trash" size={17} /></button>);
  } else if (mode === "text" || mode === "tool-text") {
    push(<Btn key="s" k="stroke" sw={style.strokeColor} tip={t("Text colour")} />, <Btn key="fo" k="font" glyph="font" label={fontName(style.fontFamily)} tip={t("Font")} />, <S key="1" />, <Btn key="o" k="opacity" glyph="opacity" tip={t("Opacity")} />);
    if (!tool) push(<S key="3" />, ...arrange, ...tail);
  } else {
    push(<Btn key="o" k="opacity" glyph="opacity" tip={t("Opacity")} />, <S key="3" />, ...arrange, ...tail);
  }

  const popUp = !phone && pos && pos.y > 300;
  const barRef = useRef<HTMLDivElement>(null);
  useFitPopover(barRef, open, phone);
  return (
    <div ref={barRef} data-wb-chrome onPointerDown={(e) => e.stopPropagation()}
      className={cx("absolute z-30 flex max-w-[calc(100%-20px)] flex-wrap items-center gap-[2px] whitespace-nowrap rounded-[10px] border border-line bg-surface-2 p-1 shadow-[0_10px_28px_rgba(0,0,0,.3)]", phone ? "inset-x-[10px] bottom-[calc(96px+env(safe-area-inset-bottom))] w-fit max-w-none" : "")}
      style={phone ? undefined : pos ? { left: pos.x, top: pos.y } : { left: "50%", top: 64, transform: "translateX(-50%)" }}>
      {items}
      {open === "arrange" && <div data-fit className={phone ? "absolute inset-x-0 bottom-[calc(100%+8px)] z-40 max-h-[70vh] overflow-y-auto" : popUp ? "absolute bottom-[calc(100%+8px)] start-0 z-40 fade-in" : "absolute start-0 top-[calc(100%+8px)] z-40 fade-in"}><ArrangeOutside onClose={close}>{body()}</ArrangeOutside></div>}
      {open !== "arrange" && open && (open === "stroke" || open === "fill") && wbRegistry.palette
        ? <div data-fit className={phone ? "" : popUp ? "absolute bottom-[calc(100%+6px)] start-0 z-40 [&>[role=dialog]]:bottom-0" : "absolute start-0 top-[calc(100%+6px)] z-40"}>{body()}</div>
        : open && open !== "arrange" && <Pop onClose={close} className={phone ? "bottom-[calc(100%+8px)] start-0" : popUp ? "bottom-[calc(100%+8px)] start-0" : "start-0 top-[calc(100%+8px)]"}>{body()}</Pop>}
    </div>
  );
}

/** Closes the arrange popover on an outside press or Esc (like Pop, without Pop's frame: 38E draws its own panels). */
function ArrangeOutside({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.("[data-pop-anchor]")) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    const tm = setTimeout(() => addEventListener("pointerdown", down, true), 0);
    addEventListener("keydown", key, true);
    return () => { clearTimeout(tm); removeEventListener("pointerdown", down, true); removeEventListener("keydown", key, true); };
  }, [onClose]);
  // keep the three panels on screen: shift left when they would run past the window edge
  useEffect(() => { const el = ref.current; if (!el) return; const r = el.getBoundingClientRect(); const over = r.right - (innerWidth - 12); if (over > 0) el.style.transform = `translateX(${-Math.min(over, r.left - 12)}px)`; }, []);
  return <div ref={ref} className="whitespace-normal" onPointerDown={(e) => e.stopPropagation()}>{children}</div>;
}

/**
 * Keeps the open popover fully on the board (36D connector, 37A colour): never under the toolbar (top 110 px) or past an edge.
 * A popover that doesn't fit above the bar flips below it; what still overflows shifts in. Re-runs when the popover resizes.
 */
function useFitPopover(bar: React.RefObject<HTMLDivElement | null>, open: string | null, phone: boolean) {
  useLayoutEffect(() => {
    const b = bar.current;
    if (!b || !open) return;
    const el = b.querySelector<HTMLElement>(":scope > [data-fit], :scope > [role=menu]");
    if (!el) return;
    const fit = () => {
      const host = (b.closest(".lumen-wb") as HTMLElement | null)?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
      el.style.transform = "";
      const box = () => { const r = el.getBoundingClientRect(); const c = el.firstElementChild as HTMLElement | null; return r.height < 4 && c ? c.getBoundingClientRect() : r; };
      const top = host.top + (phone ? 8 : 110), bottom = host.bottom - 8, left = host.left + 8, right = host.right - 8;
      let r = box(), flip = 0;
      const br = b.getBoundingClientRect();
      if (r.top < top && r.bottom <= br.top + 1 && br.bottom + 8 + r.height <= bottom) { // above the bar but no room: flip below
        flip = br.bottom + 8 - r.top;
        el.style.transform = `translateY(${flip}px)`;
        r = box();
      }
      if (r.height > bottom - top) { el.style.maxHeight = `${bottom - top}px`; el.style.overflowY = "auto"; r = box(); }
      let dy = 0, dx = 0;
      if (r.bottom > bottom) dy = bottom - r.bottom;
      if (r.top + dy < top) dy = top - r.top;
      if (r.right > right) dx = right - r.right;
      if (r.left + dx < left) dx = left - r.left;
      if (dx || dy) el.style.transform = `translate(${dx}px, ${flip + dy}px)`;
    };
    fit();
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [open, phone]); // eslint-disable-line react-hooks/exhaustive-deps
}
