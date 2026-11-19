// Deck editing (design round 4, Lumen 17 · R4-17A/B/C): the Arrange workspace (slide rail with drag-to-reorder,
// the slide with box handles/guides/coordinates, the layout picker + style), the overview grid, and the
// doc → deck preview. All edits are written back to the note as plain Markdown (lib/deck.ts).
import { Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Note } from "../../shared/types";
import { updateNote } from "../lib/actions";
import { autoSplit, moveSlide, planSlide, setSlideDirectives, type DeckSlide, type SplitAt } from "../lib/deck";
import { setUI } from "../lib/store";
import { Glyph } from "./Glyph";
import { fmtNum, t, tk, tx } from "../lib/i18n";
import { SlideFrame, SlideThumb, LAYOUT_LABELS, layoutLabel, variantOf, type Variant } from "./SlideThumb";

const VARIANT_LABEL: Record<Variant, string> = { normal: tk("Normal"), invert: tk("Invert"), accent: tk("Accent") };
import { SlideStage, type BoxPos } from "./Slides";
import { cx } from "./ui";

/** Width of an element (ResizeObserver). */
export function useWidth(ref: RefObject<HTMLElement | null>) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const f = () => setW(el.clientWidth);
    f();
    const ro = new ResizeObserver(f);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** A real slide in a SlideThumb frame. */
export function LiveSlide({ note, slide, width, selected, className }: { note: Pick<Note, "id" | "spaceId">; slide: Pick<DeckSlide, "md" | "dirs">; width: number; selected?: boolean; className?: string }) {
  return (
    <SlideFrame width={width} selected={selected} className={cx("pointer-events-none", className)}>
      {width > 0 && <SlideStage note={note} md={slide.md} dirs={slide.dirs} frameless bare />}
    </SlideFrame>
  );
}

const layoutOf = (s: Pick<DeckSlide, "md" | "dirs">) => planSlide(s.md, s.dirs).layout;

// ------------------------------------------------------------------ overview grid (R4-17C)
/** Every slide in a grid; click jumps there. Desktop 4 columns (gap 22), phone 2. */
export function OverviewGrid({ note, slides, i, onPick, className }: { note: Pick<Note, "id" | "spaceId">; slides: DeckSlide[]; i: number; onPick: (k: number) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const w = useWidth(ref);
  const cols = w < 700 ? 2 : 4, gap = w < 700 ? 12 : 22;
  const tw = Math.floor((w - gap * (cols - 1)) / cols);
  const cur = useRef<HTMLButtonElement>(null);
  useEffect(() => { cur.current?.scrollIntoView({ block: "nearest" }); }, []);
  return (
    <div ref={ref} className={cx("grid content-start", className)} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap }}>
      {w > 0 && slides.map((s, k) => (
        <button key={k} ref={k === i ? cur : undefined} onClick={(e) => { e.stopPropagation(); onPick(k); }} className="flex flex-col gap-1.5 text-start">
          <LiveSlide note={note} slide={s} width={tw} selected={k === i} />
          <span className="text-[12px]" style={{ color: k === i ? "var(--accent)" : "var(--muted)" }}>{k === i ? t("{n} · current", { n: k + 1 }) : fmtNum(k + 1)}</span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ doc → deck preview (R4-17B)
export function DocToDeckDialog({ note, slides, split, onSplit, onPresent, onSave, onClose }: {
  note: Note; slides: DeckSlide[]; split: SplitAt; onSplit: (s: SplitAt) => void; onPresent: () => void; onSave: () => void; onClose: () => void;
}) {
  const auto = useMemo(() => autoSplit(note.body), [note.body]);
  const sel = split === "auto" ? auto : split;
  const ref = useRef<HTMLDivElement>(null);
  const w = useWidth(ref);
  const cols = w < 640 ? 2 : 4, gap = 16;
  const tw = Math.floor((w - gap * (cols - 1)) / cols);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); onClose(); } else if (e.key === "Enter" && !(e.target as HTMLElement).closest("button")) { e.preventDefault(); onPresent(); } };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  }, [onClose, onPresent]);
  const opt = (v: Exclude<SplitAt, "auto">, l: string) => (
    <button key={v} onClick={() => onSplit(v)} className={cx("flex h-6 items-center px-2.5", sel === v ? "rounded-[6px] bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}>{l}</button>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg text-[13px] text-ink">
      <div className="absolute inset-0 bg-[rgba(5,6,8,.6)]" onClick={onClose} />
      <div role="dialog" aria-label={t("Make slides")} className="relative flex h-[700px] max-h-[calc(100dvh-32px)] w-[1060px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[14px] border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <Glyph name="slides" size={18} />
          <span className="min-w-0 flex-1 truncate text-[17px] font-[650]">{tx("Make slides from “{title}”", { title: <bdi dir="auto">{note.title}</bdi> })}</span>
          <span className="text-muted">{t("Split at")}</span>
          <div dir="ltr" className="flex gap-0.5 rounded-[8px] border border-line bg-bg p-[3px] text-[12px]">{opt("h1", "# H1")}{opt("h2", "## H2")}{opt("hr", "---")}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div ref={ref} className="grid content-start" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap }}>
            {w > 0 && slides.map((s, k) => (
              <div key={k} className="flex flex-col gap-1.5">
                <LiveSlide note={note} slide={s} width={tw} />
                <span className="text-[12px] text-muted">{fmtNum(k + 1)} · {layoutLabel(layoutOf(s) || "default")}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 border-t border-line px-5 py-3.5">
          <span className="min-w-0 flex-1 text-muted">{t("{n} slide|{n} slides", { n: slides.length })} · {t("layouts picked from content · the note is not changed")}</span>
          <button onClick={onPresent} className="flex h-[34px] items-center px-3.5 text-muted hover:text-ink">{t("Present without saving")}</button>
          <button onClick={onSave} className="flex h-[34px] items-center rounded-[10px] bg-accent px-4 font-semibold text-accent-fg hover:brightness-110">{t("Save as deck")}</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ arrange workspace (R4-17A)
export type DeckTab = "arrange" | "overview";
export function DeckWorkspace({ note, slides, i, setI, tab, setTab, onPresent, writeBox, addBox }: {
  note: Note; slides: DeckSlide[]; i: number; setI: (k: number) => void; tab: DeckTab; setTab: (t: DeckTab) => void; onPresent: () => void;
  writeBox: (line: number, p: BoxPos) => void; addBox: () => void;
}) {
  const n = slides.length;
  const cur = slides[Math.min(i, n - 1)];
  const plan = useMemo(() => (cur ? planSlide(cur.md, cur.dirs) : null), [cur]);
  const layout = plan?.layout ?? "";
  const variant: Variant = variantOf(plan?.cls);
  const hasBoxes = !!cur && /^\s*:{3,}\s*box\b/m.test(cur.md);

  const write = (body: string) => { if (body !== note.body) void updateNote(note.id, { body }); };
  const pickLayout = (k: string) => write(setSlideDirectives(note.body, i, { layout: k }));
  const pickVariant = (v: Variant) => {
    const rest = (plan?.cls ?? "").split(/\s+/).filter((c) => c && !["invert", "accent", "normal", "align-left"].includes(c));
    const own = cur?.dirs.class ?? "";
    const cls = [...rest, ...(v === "normal" ? [] : [v])].join(" ");
    // A per-slide `_class` overrides a carried `class` for this slide only.
    write(setSlideDirectives(note.body, i, { _class: cls || (/\b(invert|accent)\b/.test(own) ? "normal" : null) }));
  };

  // keyboard: ↑/↓ (and ←/→) pick a slide, Esc / P present
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select,.cm-editor") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (["ArrowDown", "ArrowRight", "PageDown"].includes(e.key)) { e.preventDefault(); setI(Math.min(n - 1, i + 1)); }
      else if (["ArrowUp", "ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); setI(Math.max(0, i - 1)); }
      else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(n - 1);
      else if (e.key === "o" || e.key === "g") setTab(tab === "overview" ? "arrange" : "overview");
      else if (e.key === "Escape" || e.key === "p" || e.key === "a") { e.preventDefault(); onPresent(); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  // centre stage size: up to 800 px wide, 16:9, inside the free space
  const stageBox = useRef<HTMLDivElement>(null);
  const [sw, setSw] = useState(0);
  useLayoutEffect(() => {
    const el = stageBox.current;
    if (!el) return;
    const f = () => setSw(Math.floor(Math.max(0, Math.min(800, el.clientWidth - 16, ((el.clientHeight - 32) * 16) / 9))));
    f();
    const ro = new ResizeObserver(f);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab]);

  const seg = (id: DeckTab | "edit", l: string) => (
    <button key={id} onClick={() => (id === "edit" ? setUI({ mode: "edit" }) : setTab(id))} className={cx("flex h-6 items-center px-2.5", tab === id ? "rounded-[6px] bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}>{l}</button>
  );
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-[13px] text-ink">
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-5">
        <span className="min-w-0 truncate font-semibold" dir="auto">{note.title}</span>
        <span className="shrink-0 text-muted">{t("{n} slide|{n} slides", { n })}</span>
        <span className="flex-1" />
        <div className="flex gap-0.5 rounded-[9px] border border-line bg-surface p-[3px] text-[12px]">{seg("edit", t("Edit"))}{seg("arrange", t("Arrange"))}{seg("overview", t("Overview"))}</div>
        <button onClick={onPresent} title={t("Present (P)")} className="flex h-8 items-center rounded-[9px] bg-accent px-3.5 font-semibold text-accent-fg hover:brightness-110">{t("Present")}</button>
      </div>
      {tab === "overview" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-[60px] py-12">
          <OverviewGrid note={note} slides={slides} i={i} onPick={(k) => { setI(k); setTab("arrange"); }} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <Rail note={note} slides={slides} i={i} setI={setI} />
          <div ref={stageBox} className="relative flex min-w-0 flex-1 items-center justify-center" style={{ background: "color-mix(in srgb,var(--surface) 40%,var(--bg))" }}>
            {cur && sw > 0 && (
              <SlideFrame width={sw} style={{ overflow: "visible" }}>
                <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: Math.max(4, sw / 32) }}>
                  <SlideStage key={i + ":" + cur.md.length} note={note} md={cur.md} dirs={cur.dirs} frameless bare arrange={writeBox} />
                </div>
              </SlideFrame>
            )}
          </div>
          <div className="hidden w-[329px] shrink-0 flex-col gap-3 overflow-y-auto border-s border-line bg-surface p-3.5 lg:flex">
            <span className="font-semibold">{t("Layout · slide {n}", { n: i + 1 })}</span>
            <div className="grid grid-cols-3 gap-2">
              {LAYOUT_LABELS.map(([k, l]) => (
                <button key={k} onClick={() => pickLayout(k)} title={`<!-- layout: ${k} -->`} className="flex flex-col items-center gap-1">
                  <SlideThumb layout={k} width={84} selected={layout === k} />
                  <span className="text-[11px]" style={{ color: layout === k ? "var(--accent)" : "var(--muted)" }}>{t(l)}</span>
                </button>
              ))}
            </div>
            <span className="pt-1.5 text-[12px] text-muted">{t("Style")}</span>
            <div className="grid grid-cols-3 gap-0.5 rounded-[8px] border border-line bg-bg p-[3px] text-[12px]">
              {(["normal", "invert", "accent"] as const).map((v) => (
                <button key={v} onClick={() => pickVariant(v)} className={cx("flex h-[26px] items-center justify-center", variant === v ? "rounded-[6px] bg-surface-2 font-semibold" : "text-muted hover:text-ink")}>{t(VARIANT_LABEL[v])}</button>
              ))}
            </div>
            <span className="text-[12px] leading-[17px] text-muted">{tx("Writes {code} above the slide. Drag thumbnails to reorder; the amber line shows the drop.", { code: <bdi dir="ltr">&lt;!-- layout: {layout || "two-cols"} --&gt;</bdi> })}</span>
            <span className="mt-2 border-t border-line pt-3 text-[12px] text-muted">{t("Boxes")}</span>
            <span className="text-[12px] leading-[17px] text-muted">{hasBoxes ? t("Drag a box on the slide to move it; corners resize. Amber guides snap to the centre and other boxes (hold Alt to place freely).") : t("Place text or an image anywhere on this slide.")}</span>
            <button onClick={addBox} className="flex h-8 items-center justify-center gap-1.5 rounded-[8px] border border-line hover:bg-surface-2"><Plus size={14} />{t("Add box")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Slide rail: numbered thumbnails; drag to reorder (dashed = the slide being moved, amber line = where it lands). */
function Rail({ note, slides, i, setI }: { note: Note; slides: DeckSlide[]; i: number; setI: (k: number) => void }) {
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const [drag, setDrag] = useState<{ from: number; ins: number } | null>(null);
  const n = slides.length;
  useEffect(() => { rows.current[i]?.scrollIntoView({ block: "nearest" }); }, [i]);
  const down = (e: React.PointerEvent, k: number) => {
    if (e.button !== 0) return;
    const y0 = e.clientY;
    let active = false, ins = k;
    const move = (m: PointerEvent) => {
      if (!active && Math.abs(m.clientY - y0) < 5) return;
      active = true;
      ins = n;
      for (let r = 0; r < n; r++) { const b = rows.current[r]?.getBoundingClientRect(); if (b && m.clientY < b.top + b.height / 2) { ins = r; break; } }
      setDrag({ from: k, ins });
    };
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up);
      setDrag(null);
      if (!active) { setI(k); return; }
      if (ins === k || ins === k + 1) return;
      const to = ins > k ? ins - 1 : ins;
      void updateNote(note.id, { body: moveSlide(note.body, k, to) }).then(() => setI(to));
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  const line = <div className="ms-[26px] h-0.5 shrink-0 rounded-[1px] bg-accent" />;
  return (
    <div className="hidden w-[245px] shrink-0 flex-col gap-2.5 overflow-y-auto border-e border-line p-3 md:flex" style={{ touchAction: "none" }}>
      {drag && drag.ins === 0 && drag.from !== 0 && line}
      {slides.map((s, k) => (
        <div key={k} className="contents">
          <div ref={(el) => { rows.current[k] = el; }} onPointerDown={(e) => down(e, k)} className="flex cursor-grab select-none items-start gap-2">
            <span className="w-[18px] shrink-0 pt-1 text-end text-[11px] text-muted">{fmtNum(k + 1)}</span>
            <div className="relative">
              <LiveSlide note={note} slide={s} width={168} selected={k === i} />
              {drag?.from === k && <span className="absolute inset-0 rounded-[6px] bg-[rgba(242,169,59,.06)]" style={{ outline: "2px dashed var(--accent)", outlineOffset: -2 }} />}
            </div>
          </div>
          {drag && drag.ins === k + 1 && drag.ins !== drag.from && drag.ins !== drag.from + 1 && line}
        </div>
      ))}
    </div>
  );
}
