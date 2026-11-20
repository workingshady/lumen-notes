// Board states (design 33G empty · 33H view-only · 33I offline · 33J performance mode), ported from WBStudio.dc.html:
// the empty block (40 px glyph, one line, three start actions, drop hint) and the one-line banner under the toolbar.
import { t } from "../../lib/i18n";
import { Glyph } from "../Glyph";

export function EmptyBoard({ kind, phone, onDraw, onCard, onPaste }: { kind: "whiteboard" | "board"; phone: boolean; onDraw: () => void; onCard: () => void; onPaste: () => void }) {
  const acts: [string, string, boolean, () => void][] = [["pen-fountain", t("Draw"), true, onDraw], ["note-card", t("Add a note card"), false, onCard], ["image", t("Paste an image"), false, onPaste]];
  return (
    <div data-wb-chrome className="pointer-events-none absolute left-1/2 top-[calc(50%-30px)] z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-4 text-center fade-in" style={{ width: phone ? 320 : 460 }}>
      <Glyph name={kind === "board" ? "board" : "whiteboard"} size={40} stroke={1.5} color="var(--muted)" />
      <span className="text-[15px] text-ink">{t("A blank board. Start anywhere.")}</span>
      <div className="pointer-events-auto flex flex-wrap justify-center gap-2">
        {acts.map(([g, l, p, run]) => (
          <button key={l} type="button" onClick={run} className="flex h-[38px] items-center gap-2 rounded-[10px] border px-[14px] text-[13px] transition-[filter] hover:brightness-110"
            style={{ background: p ? "var(--accent)" : "var(--surface)", color: p ? "var(--accent-fg)" : "var(--text)", borderColor: p ? "transparent" : "var(--border)", fontWeight: p ? 600 : 500 }}>
            <Glyph name={g} size={16} />{l}
          </button>
        ))}
      </div>
      <span className="text-[12px] text-muted">{t("or drop files, notes and links here")}</span>
    </div>
  );
}

export function Banner({ dot, text, action, onAction, phone }: { dot: string; text: string; action?: string; onAction?: () => void; phone?: boolean }) {
  return (
    <div data-wb-chrome role="status" className="absolute left-1/2 z-20 flex h-9 -translate-x-1/2 items-center gap-2.5 whitespace-nowrap rounded-full max-w-[calc(100%-20px)] border border-line bg-surface-2 pe-2 ps-[14px] text-[12.5px] shadow-[0_8px_22px_rgba(0,0,0,.25)] fade-in"
      style={{ top: phone ? 56 : 64 }} onPointerDown={(e) => e.stopPropagation()}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: dot }} /><span className="min-w-0 truncate">{text}</span>
      {action && <button type="button" onClick={onAction} className="flex h-[26px] shrink-0 items-center rounded-full border border-line px-2.5 font-medium hover:bg-surface">{action}</button>}
    </div>
  );
}
