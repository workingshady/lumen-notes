// Empty state (design round 4, Lumen 21 › "One glyph, one line, one action").
// Glyph 24 on a muted 14% tile (42 px), one line of text (19 px line height), one outline action (32 px, radius 9).
// `framed` draws the design's card (bg, 1 px border, radius 14, 220 px tall); unframed it centres in its parent.
import type { ReactNode } from "react";
import { Glyph } from "./Glyph";

export interface EmptyStateProps {
  glyph: string;
  /** One line. Keep it short: what's missing, and (optionally) why. */
  text: ReactNode;
  /** One action: a label + handler, or your own element. */
  action?: { label: string; onClick: () => void } | ReactNode;
  framed?: boolean;
  className?: string;
}

export function EmptyState({ glyph, text, action, framed, className }: EmptyStateProps) {
  const act = action && typeof action === "object" && "label" in (action as object) && "onClick" in (action as object)
    ? (() => { const a = action as { label: string; onClick: () => void }; return <button type="button" onClick={a.onClick} className="flex h-8 items-center rounded-[9px] border border-line px-3 font-medium text-ink hover:bg-surface-2">{a.label}</button>; })()
    : (action as ReactNode);
  return (
    <div className={"flex flex-col items-center justify-center gap-3 px-6 text-center text-[13px] " + (framed ? "h-[220px] rounded-[14px] border border-line bg-bg " : "py-14 ") + (className ?? "")}>
      <Glyph name={glyph} size={24} color="var(--muted)" tile="var(--muted)" />
      <span dir="auto" className="max-w-[360px] leading-[19px] text-ink">{text}</span>
      {act}
    </div>
  );
}
