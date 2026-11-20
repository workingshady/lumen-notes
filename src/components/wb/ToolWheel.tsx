// Tool wheel (design 33E / 33F / 44H): 240 px radial menu at the pointer with the 6 last-used tools and pens around
// Undo · Redo. Release or click over a slot to switch; Esc or a click outside closes it.
import { useEffect, useRef } from "react";
import { t } from "../../lib/i18n";
import { Glyph } from "../Glyph";
import { AC_BG } from "./ui";
import { SHAPE_GLYPH, SHAPE_NAME, TOOL_META, type WheelSlot } from "./tools";

const LABEL: Partial<Record<string, string>> = { pen: "Pen", hl: "Highlight", eraser: "Eraser" };
const PEN: Record<string, [glyph: string, name: string]> = { fountain: ["pen-fountain", "Fountain"], ballpoint: ["pen-ballpoint", "Ballpoint"], brush: ["pen-brush", "Brush"], marker: ["pen-marker", "Marker"], pencil: ["pen-pencil", "Pencil"], calligraphy: ["pen-calligraphy", "Calligraphy"] };

export function ToolWheel({ x, y, slots, current, penColor, hlColor, penType = "fountain", onPick, onUndo, onRedo, onClose }: {
  x: number; y: number; slots: WheelSlot[]; current: string; penColor: string; hlColor: string; penType?: string;
  onPick: (s: WheelSlot) => void; onUndo: () => void; onRedo: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const tm = setTimeout(() => addEventListener("pointerdown", down, true), 0);
    addEventListener("keydown", key, true);
    return () => { clearTimeout(tm); removeEventListener("keydown", key, true); removeEventListener("pointerdown", down, true); };
  }, [onClose]);
  // Keep the whole wheel on screen.
  const cx = Math.min(Math.max(x, 128), innerWidth - 128), cy = Math.min(Math.max(y, 128), innerHeight - 128);
  return (
    <div ref={ref} data-wb-chrome role="menu" aria-label={t("Tool wheel")} dir="ltr" onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 size-[240px] rounded-full border border-line bg-surface shadow-[0_18px_50px_rgba(0,0,0,.35)] fade-in" style={{ left: cx - 120, top: cy - 120 }}>
      {slots.slice(0, 6).map((s, i) => {
        const a = -Math.PI / 2 + i * Math.PI / 3;
        const [g, name] = TOOL_META[s.tool];
        const pt = s.tool === "pen" ? PEN[s.pen ?? penType] ?? PEN.fountain : null; // saved pens show by name (33E)
        const glyph = s.tool === "shape" && s.shape ? SHAPE_GLYPH[s.shape] : pt ? pt[0] : g;
        const label = s.tool === "shape" && s.shape ? SHAPE_NAME[s.shape] : pt ? pt[1] : LABEL[s.tool] ?? name;
        const dot = s.tool === "pen" ? penColor : s.tool === "hl" ? hlColor : undefined;
        const on = current === s.tool && (s.tool !== "pen" || (s.pen ?? penType) === penType) && slots.findIndex((o) => o.tool === s.tool) === i;
        return (
          <button key={i} type="button" role="menuitem" onPointerUp={() => onPick(s)} onClick={() => onPick(s)}
            className="absolute -ms-7 -mt-7 flex size-14 flex-col items-center justify-center gap-[2px] rounded-full text-[9.5px] hover:bg-surface-2"
            style={{ left: 120 + 88 * Math.cos(a), top: 120 + 88 * Math.sin(a), ...(on ? { background: AC_BG, color: "var(--accent)" } : { color: "var(--text)" }) }}>
            <Glyph name={glyph} size={20} />{t(label)}
            {dot && <span className="size-1.5 rounded-full" style={{ background: dot }} />}
          </button>
        );
      })}
      <div className="absolute left-1/2 top-1/2 -ms-[42px] -mt-[42px] flex size-[84px] items-center justify-center gap-[2px] rounded-full border border-line bg-surface-2">
        <button type="button" title={t("Undo") + " · Ctrl Z"} aria-label={t("Undo")} onClick={onUndo} className="flex size-[34px] items-center justify-center rounded-full text-ink hover:bg-surface"><Glyph name="undo" size={18} /></button>
        <button type="button" title={t("Redo") + " · Ctrl Shift Z"} aria-label={t("Redo")} onClick={onRedo} className="flex size-[34px] items-center justify-center rounded-full text-muted hover:bg-surface"><Glyph name="redo" size={18} /></button>
      </div>
    </div>
  );
}
