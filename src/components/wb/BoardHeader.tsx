// Board header (design 33A desktop · 44A phone): crumb / title · saved line, then History · Layers · Present · Share · ⋯.
// Offline turns the saved line amber: "Saved on device" (33I).
import type { ReactNode } from "react";
import { t } from "../../lib/i18n";
import { Glyph } from "../Glyph";
import { cx } from "../ui";
import { useSaving, useSyncLook } from "../ws-sync";

export function useSavedLine(): { text: string; color: string; offline: boolean } {
  const l = useSyncLook();
  const saving = useSaving();
  const offline = l.kind === "offline" || (typeof navigator !== "undefined" && !navigator.onLine);
  if (saving) return { text: t("Saving…"), color: "var(--muted)", offline };
  if (offline || l.kind === "local") return { text: t("Saved on device"), color: "var(--warning)", offline };
  if (l.kind === "error") return { text: l.text, color: "var(--danger)", offline };
  if (l.kind === "syncing") return { text: t("Saved · {status}", { status: t("Syncing…") }), color: "var(--muted)", offline };
  return { text: t("Saved · Synced"), color: "var(--success)", offline };
}

const HBtn = ({ glyph, label, tip, onClick, on, primary }: { glyph: string; label?: string; tip: string; onClick: () => void; on?: boolean; primary?: boolean }) => (
  <button type="button" title={tip} aria-label={tip} onClick={onClick}
    className={cx("flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[8px] border px-2.5 text-[12.5px]", primary ? "border-transparent bg-accent font-semibold text-accent-fg" : label ? "border-line font-medium hover:bg-surface-2" : "border-transparent font-medium hover:bg-surface-2", on && "text-accent")}>
    <Glyph name={glyph} size={16} />{label}
  </button>
);

export function BoardHeader({ crumb, title, saved, phone, buttons, onBack, right, badge }: {
  crumb: string; title: string; saved: { text: string; color: string }; phone: boolean;
  buttons: { glyph: string; label?: string; tip: string; run: () => void; on?: boolean; primary?: boolean }[];
  onBack?: () => void; right?: ReactNode;
  /** Handwriting search badge (34H): "Searchable". */
  badge?: string;
}) {
  if (phone) return (
    <header data-wb-chrome className="safe-t flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line bg-bg px-2.5">
      <button type="button" aria-label={t("Back")} onClick={onBack} className="flex size-11 items-center justify-center"><Glyph name="chevron-right" size={22} style={{ transform: "scaleX(-1)" }} className="rtl:!scale-x-100" /></button>
      <div className="flex min-w-0 flex-1 flex-col">
        <span dir="auto" className="truncate text-[15px] font-semibold">{title}</span>
        <span className="text-[11px]" style={{ color: saved.color }}>{saved.text}</span>
      </div>
      {right}
    </header>
  );
  return (
    <header data-wb-chrome className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-[14px]" style={{ background: "color-mix(in srgb,var(--bg) 88%,transparent)" }}>
      <span dir="auto" className="whitespace-nowrap text-[12.5px] text-muted">{crumb}</span>
      <span className="text-muted">/</span>
      <span dir="auto" className="truncate text-[13.5px] font-semibold">{title}</span>
      <span className="flex items-center gap-1.5 whitespace-nowrap text-[12px]" style={{ color: saved.color }}><span className="size-1.5 rounded-full" style={{ background: saved.color }} />{saved.text}</span>
      {badge && <span title={badge} className="whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{badge}</span>}
      <span className="flex-1" />
      {buttons.map((b) => <HBtn key={b.tip} glyph={b.glyph} label={b.label} tip={b.tip} onClick={b.run} on={b.on} primary={b.primary} />)}
    </header>
  );
}
