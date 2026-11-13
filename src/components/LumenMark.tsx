import { useId } from "react";

type Tile = "dark" | "light" | "accent" | "ink" | "glyph" | "mono" | "monoDark";
const T: Record<Tile, { tile: string; border: string; ink: string; flame: string }> = {
  dark: { tile: "#161A21", border: "#2A303B", ink: "#E8E6E1", flame: "#F2A93B" },
  light: { tile: "#FFFFFF", border: "#E4DFD3", ink: "#1F1D1A", flame: "#D98A1E" },
  accent: { tile: "#F2A93B", border: "#F2A93B", ink: "#1A1206", flame: "#1A1206" },
  ink: { tile: "#0F1115", border: "#0F1115", ink: "#E8E6E1", flame: "#F2A93B" },
  glyph: { tile: "transparent", border: "transparent", ink: "#E8E6E1", flame: "#F2A93B" },
  mono: { tile: "transparent", border: "transparent", ink: "#E8E6E1", flame: "#E8E6E1" },
  monoDark: { tile: "transparent", border: "transparent", ink: "#1F1D1A", flame: "#1F1D1A" },
};

/** Lumen mark (design handoff: LumenMark): a flame with a light cone over a desk line, on a rounded tile. */
export function LumenMark({ size = 64, tile = "dark", glyph = "flame", cone = true, glow = true }: { size?: number; tile?: Tile; glyph?: "flame" | "dot"; cone?: boolean; glow?: boolean }) {
  const id = useId().replace(/:/g, "");
  const t = T[tile];
  const plain = tile === "accent" || tile === "mono" || tile === "monoDark";
  const showCone = cone && !plain;
  const glowOp = plain || !glow ? 0 : tile === "light" ? 0.28 : 0.45;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ display: "block", flexShrink: 0 }} aria-label="Lumen">
      <defs>
        <linearGradient id={`${id}c`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={t.flame} stopOpacity={showCone ? (tile === "light" ? 0.22 : 0.3) : 0} />
          <stop offset="1" stopColor={t.flame} stopOpacity={0} />
        </linearGradient>
        <radialGradient id={`${id}g`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={t.flame} stopOpacity={glowOp} />
          <stop offset="1" stopColor={t.flame} stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect x="0.5" y="0.5" width="63" height="63" rx="16" fill={t.tile} stroke={t.border} strokeWidth="1" />
      <circle cx="32" cy="22" r="15" fill={`url(#${id}g)`} />
      {showCone && <path d="M27 27 L37 27 L51 45 L13 45 Z" fill={`url(#${id}c)`} />}
      {glyph === "flame" ? <path d="M32 11.5 C35.6 15.6 38 18.9 38 22.4 A6 6 0 0 1 26 22.4 C26 18.9 28.4 15.6 32 11.5 Z" fill={t.flame} /> : <circle cx="32" cy="22" r="6.5" fill={t.flame} />}
      <rect x="12" y="44" width="40" height="3.5" rx="1.75" fill={t.ink} />
    </svg>
  );
}

/** Wordmark: lowercase "lumen", Inter 600, tight tracking. */
export const Wordmark = ({ size = 30 }: { size?: number }) => <span style={{ fontWeight: 600, fontSize: size, lineHeight: 1, letterSpacing: "-0.045em" }}>lumen</span>;
