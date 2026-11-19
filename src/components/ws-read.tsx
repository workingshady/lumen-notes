import { Minus, Plus, Type } from "lucide-react";
import { useState } from "react";
import { setSettings, useSettings, type Settings } from "../lib/settings";
import { cx } from "./ui";
import { t, tk } from "../lib/i18n";

const MIN = 12, MAX = 26;
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, n));

/**
 * Reading options in the note header ("Aa"): text size, line width and reading font, applied live to every note.
 * The same values as Settings › Appearance, a click away while reading. Diagrams zoom on their own (mermaid card toolbar).
 */
export function ReadMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button title={t("Reading: text size, width, font")} aria-label={t("Reading options")} onClick={() => setOpen((o) => !o)}
        className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[8px] border border-line px-2 text-[12px] text-muted hover:text-ink">
        <Type size={13} />Aa
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute end-0 top-full z-40 mt-1 w-72 rounded-[12px] border border-line bg-surface p-1.5 shadow-xl fade-in">
            <ReadRows />
          </div>
        </>
      )}
    </div>
  );
}

/** The rows of the reading menu (also shown inside the phone ⋯ menu). */
export function ReadRows() {
  const s = useSettings();
  const seg = (on: boolean) => cx("h-7 rounded-[6px] px-2.5 text-[12px]", on ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink");
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div onClick={stop}>
      <div className="flex items-center gap-2 px-2.5 py-2 text-[13px]">
        <span className="flex-1 text-muted">{t("Text size")}</span>
        <button aria-label={t("Smaller text")} title={t("Smaller text")} disabled={s.fontSize <= MIN} onClick={() => setSettings({ fontSize: clamp(s.fontSize - 1) })} className="flex size-7 items-center justify-center rounded-[6px] border border-line text-muted hover:text-ink disabled:opacity-40"><Minus size={13} /></button>
        <button title={t("Reset to {n} px", { n: 16 })} onClick={() => setSettings({ fontSize: 16 })} className="w-12 text-center tabular-nums">{t("{n} px", { n: s.fontSize })}</button>
        <button aria-label={t("Larger text")} title={t("Larger text")} disabled={s.fontSize >= MAX} onClick={() => setSettings({ fontSize: clamp(s.fontSize + 1) })} className="flex size-7 items-center justify-center rounded-[6px] border border-line text-muted hover:text-ink disabled:opacity-40"><Plus size={13} /></button>
      </div>
      <div className="flex items-center gap-2 px-2.5 py-2 text-[13px]">
        <span className="flex-1 text-muted">{t("Line width")}</span>
        <div className="flex gap-0.5 rounded-[8px] border border-line bg-surface p-0.5">
          {([[60, tk("Narrow")], [68, tk("Normal")], [80, tk("Wide")], [0, tk("Full")]] as [Settings["measure"], string][]).map(([m, l]) => (
            <button key={m} className={seg(s.measure === m)} onClick={() => setSettings({ measure: m })}>{t(l)}</button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 px-2.5 py-2 text-[13px]">
        <span className="flex-1 text-muted">{t("Font")}</span>
        <div className="flex gap-0.5 rounded-[8px] border border-line bg-surface p-0.5">
          {([["serif", tk("Serif")], ["sans", tk("Sans")], ["mono", tk("Mono")]] as [Settings["readingFont"], string][]).map(([f, l]) => (
            <button key={f} className={seg(s.readingFont === f)} onClick={() => setSettings({ readingFont: f })}>{t(l)}</button>
          ))}
        </div>
      </div>
      <div className="px-2.5 pb-1.5 pt-1 text-[11.5px] leading-4 text-muted">{t("Diagrams: use + / − on a diagram, Ctrl + scroll or pinch to zoom, drag to move, double-click to fit.")}</div>
    </div>
  );
}
