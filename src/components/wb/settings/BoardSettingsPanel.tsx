// Board settings (design 39A–39E desktop, 44F phone sheet; WBStudio overlay "settings").
import { useRef } from "react";
import { t } from "../../../lib/i18n";
import { openSettings } from "../../ShareSheet";
import type { WbCtx } from "../hooks";
import { ColItem, PANEL_END, RowItem } from "../kit";
import { BlockHead, PanelShell, Seg, Slider, Tog } from "../panel";
import { BACKGROUNDS, PATTERNS, useBoard, type BoardStore, type PageMode } from "./model";

export function BoardSettingsPanel({ ctx, store }: { ctx: WbCtx; store: BoardStore }) {
  const b = useBoard(store);
  const set = (p: Parameters<BoardStore["set"]>[0]) => { store.set(p); ctx.save(); };
  const custom = useRef<HTMLInputElement>(null);
  const toggles: [keyof typeof b, string, string, string?][] = [
    ["snapGrid", "snap", t("Snap to grid")], ["snapObjects", "snap", t("Snap to objects")], ["angleSnap", "arrow", t("Angle snap · 15°")],
    ["minimap", "minimap", t("Minimap")], ["zen", "zen", t("Zen mode"), "⌥Z"], ["viewOnly", "eye", t("View only")],
  ];
  return (
    <PanelShell glyph="gear" title={t("Board settings")} onClose={ctx.close} sheet={ctx.phone} portal={ctx.phone} className={ctx.phone ? "!fixed z-50" : PANEL_END} label={t("Board settings")}>
      <div className="flex flex-col gap-2">
        <BlockHead h={t("Background")} />
        <div className="grid grid-cols-4 gap-1">
          {BACKGROUNDS.map(([k, l, c]) => (
            <ColItem key={k} label={t(l)} thumb={k === "custom" && b.bg === "custom" ? b.custom : c} on={b.bg === k} mh={58} pad="4px" bd="transparent"
              onClick={() => { if (k === "custom") custom.current?.click(); set({ bg: k }); }} />
          ))}
          <input ref={custom} type="color" value={b.custom} onChange={(e) => set({ bg: "custom", custom: e.target.value })} className="sr-only" tabIndex={-1} aria-label={t("Custom colour")} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <BlockHead h={t("Pattern")} />
        <div className="grid grid-cols-4 gap-1">
          {PATTERNS.map(([k, g, l]) => <ColItem key={k} glyph={g} label={t(l)} on={b.pattern === k && b.bg !== "transparent"} mh={54} onClick={() => set({ pattern: k })} />)}
        </div>
      </div>
      <RowItem label={t("Density")} right={<><span className="whitespace-nowrap text-[11px] text-muted">{t("{n} px", { n: b.density })}</span><Slider value={b.density} min={12} max={48} step={1} label={t("Density")} onChange={(n) => store.set({ density: n })} onCommit={() => ctx.save()} /></>} />
      <div className="flex flex-col gap-2">
        <BlockHead h={t("Mode")} />
        <Seg<PageMode> items={[["infinite", t("Infinite")], ["a4", t("Pages · A4")], ["letter", t("Letter")], ["16:9", "16:9"]]} value={b.mode} onPick={(v) => set({ mode: v })} />
      </div>
      <div className="flex flex-col gap-2">
        <BlockHead h={t("Snapping & view")} />
        <div className="grid grid-cols-1 gap-0">
          {toggles.map(([k, g, l, sub]) => (
            <RowItem key={k} glyph={g} label={l} sub={sub} onClick={() => set({ [k]: !b[k] })} right={<span onClick={(e) => e.stopPropagation()}><Tog on={!!b[k]} onChange={(v) => set({ [k]: v })} label={l} /></span>} />
          ))}
        </div>
        <div className="text-[11.5px] leading-[17px] text-muted">
          {t("Defaults for new boards live in")} <button type="button" onClick={() => { ctx.close(); openSettings("diagrams"); window.dispatchEvent(new CustomEvent("lumen:settings-section", { detail: "diagrams" })); }} className="text-muted underline-offset-2 hover:text-ink hover:underline">{t("Settings › Diagrams.")}</button>
        </div>
      </div>
    </PanelShell>
  );
}
