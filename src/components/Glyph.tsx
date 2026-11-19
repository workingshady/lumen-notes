// <Glyph> = the design's LumenGlyph component (design/handoffs/2026-11-19-round-4/LumenGlyph.dc.html), 1:1.
// Plain glyph, or a tinted tile (`tile` = colour → 14% fill, glyph in `color`), or initials on a tile.
import type { CSSProperties } from "react";
import { GLYPHS, type GlyphName } from "../lib/glyphs";

export interface GlyphProps {
  name: GlyphName;
  size?: number;
  color?: string;
  /** Tile colour: draws a rounded tile at 14% of this colour behind the glyph. */
  tile?: string;
  /** One or two letters instead of a glyph (space icon "Use initials"). */
  initials?: string;
  stroke?: number;
  tileScale?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function Glyph({ name, size = 20, color = "currentColor", tile, initials = "", stroke = 1.75, tileScale = 1.75, className, style, title }: GlyphProps) {
  const def = GLYPHS[name] ?? GLYPHS.note ?? [];
  const box = tile ? Math.round(size * tileScale) : size;
  return (
    <span
      className={className}
      data-glyph={name}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, width: box, height: box,
        borderRadius: tile ? Math.round(box * 0.28) : 0, background: tile ? `color-mix(in srgb, ${tile} 14%, transparent)` : "transparent",
        color, font: `600 ${Math.round(size * 0.62)}px Inter, system-ui, sans-serif`, letterSpacing: "-.02em", ...style,
      }}
    >
      {initials ? initials.slice(0, 2) : (
        <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block", overflow: "visible" }}>
          {def.map((p, i) => {
            const d = typeof p === "string" ? p : p.d;
            const fill = typeof p !== "string" && p.fill ? "currentColor" : "none";
            const strokeC = typeof p === "string" ? "currentColor" : p.stroke ?? (p.fill ? "none" : "currentColor");
            return <path key={i} d={d} fill={fill} stroke={strokeC} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />;
          })}
        </svg>
      )}
    </span>
  );
}
