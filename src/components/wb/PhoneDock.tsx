// Phone dock (design 44A / 44K): Hand · Pen (current pen + colour dot) · Mark · Erase · Shapes · Text · More, above the
// home indicator. More opens a sheet with the rest of the tools and the code / script / Mermaid panels.
import { useRef } from "react";
import { t } from "../../lib/i18n";
import { Glyph } from "../Glyph";
import { AC_BG } from "./ui";
import { TOOL_META, type ToolId } from "./tools";

export type DockMore = { glyph: string; label: string; run: () => void; on?: boolean };

export function PhoneDock({ tool, penGlyph, penColor, more, moreOpen, onTool, onMore, onPenSheet }: {
  tool: ToolId; penGlyph: string; penColor: string; more: DockMore[]; moreOpen: boolean; onTool: (t: ToolId) => void; onMore: (open: boolean) => void;
  /** Pen slot long-press (or tap while the pen is active): the pen sheet with saved pens (design 44 / 34C). */
  onPenSheet?: () => void;
}) {
  const press = useRef<{ t: ReturnType<typeof setTimeout>; fired: boolean } | null>(null);
  const items: [ToolId | "more", string, string, string?][] = [["hand", "hand", "Hand"], ["pen", penGlyph, "Pen", penColor], ["hl", "highlighter", "Mark"], ["eraser", "eraser-stroke", "Erase"], ["shape", "shape-library", "Shapes"], ["text", "text", "Text"], ["more", "more", "More"]];
  return (
    <>
      {moreOpen && (
        <>
          <div className="fixed inset-0 z-30 md:hidden" onClick={() => onMore(false)} />
          <div data-wb-chrome className="sheet-in absolute inset-x-[10px] bottom-[calc(86px+env(safe-area-inset-bottom))] z-40 grid grid-cols-4 gap-1 rounded-[16px] border border-line bg-surface p-2 shadow-[0_10px_28px_rgba(0,0,0,.25)] md:hidden" onPointerDown={(e) => e.stopPropagation()}>
            {more.map((m) => (
              <button key={m.label} type="button" onClick={() => { onMore(false); m.run(); }} className="flex h-14 flex-col items-center justify-center gap-0.5 rounded-[12px] text-[10.5px]" style={m.on ? { background: AC_BG, color: "var(--accent)" } : undefined}>
                <Glyph name={m.glyph} size={20} />{m.label}
              </button>
            ))}
          </div>
        </>
      )}
      <div data-wb-chrome className="absolute inset-x-[10px] bottom-[calc(12px+env(safe-area-inset-bottom))] z-30 flex h-16 items-center justify-around rounded-[20px] border border-line bg-surface shadow-[0_10px_28px_rgba(0,0,0,.25)] md:hidden" onPointerDown={(e) => e.stopPropagation()}>
        {items.map(([id, g, l, dot]) => {
          const on = id === "more" ? moreOpen : tool === id;
          return (
            <button key={id} type="button" aria-label={t(id === "more" ? "More tools" : TOOL_META[id].at(1)!)}
              onPointerDown={() => { if (id !== "pen" || !onPenSheet) return; const p = { fired: false, t: setTimeout(() => { p.fired = true; onPenSheet(); }, 500) }; press.current = p; }}
              onPointerUp={() => { if (press.current && !press.current.fired) clearTimeout(press.current.t); }} onPointerLeave={() => { if (press.current && !press.current.fired) clearTimeout(press.current.t); }}
              onContextMenu={(e) => { if (id === "pen") e.preventDefault(); }}
              onClick={() => { if (id === "pen" && press.current?.fired) { press.current = null; return; } if (id === "pen" && tool === "pen" && onPenSheet) return onPenSheet(); if (id === "more") onMore(!moreOpen); else onTool(id); }}
              className="relative flex size-12 flex-col items-center justify-center gap-[2px] rounded-[14px]" style={on ? { background: AC_BG, color: "var(--accent)" } : { color: "var(--text)" }}>
              <Glyph name={g} size={22} /><span className="text-[9.5px]">{t(l)}</span>
              {dot && <span className="absolute end-[9px] top-[7px] size-2 rounded-full" style={{ background: dot, boxShadow: "0 0 0 1.5px var(--surface)" }} />}
            </button>
          );
        })}
      </div>
    </>
  );
}
