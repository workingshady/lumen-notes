import { useState } from "react";
import { ChipSelect, PrefRow } from "../components/chip-select";
import { setExtraPrefs, useExtraPrefs, type DiagramPrefs } from "../lib/reading-prefs";
import { DIAGRAM_EXPORT_DEFAULTS, setSettings, type DiagramExportPrefs } from "../lib/settings";
import { cx } from "../components/ui";
import { fmtNum, t, tk } from "../lib/i18n";

const THEMES: { value: DiagramPrefs["diagramTheme"]; label: string }[] = [{ value: "app", label: tk("Match app") }, { value: "default", label: tk("Paper") }, { value: "dark", label: tk("Lamplight") }, { value: "neutral", label: tk("Neutral") }, { value: "forest", label: tk("Forest") }];
const FMT: Record<DiagramExportPrefs["format"], string> = { svg: "SVG", png: "PNG", jpeg: "JPEG", webp: "WebP" };
const bgLabel = (e: DiagramExportPrefs) => e.background === "transparent" ? t("transparent") : e.background === "theme" ? t("theme") : e.color.toLowerCase() === "#ffffff" ? t("white") : e.color;
const onOffOpts = () => [{ value: "on", label: t("On") }, { value: "off", label: t("Off") }];

/** Settings › Diagrams (design round 4, Lumen 17 · R4-17I): default theme, hand-drawn look, export defaults,
 *  how .mermaid files open, max render size; plus where saved diagrams go, auto-save and AI names. */
export function DiagramsSection() {
  const s = useExtraPrefs();
  const ex: DiagramExportPrefs = { ...DIAGRAM_EXPORT_DEFAULTS, ...(s.diagramExport ?? {}) };
  const setEx = (p: Partial<DiagramExportPrefs>) => setSettings({ diagramExport: { ...ex, ...p } });
  const [exOpen, setExOpen] = useState(false);
  const raster = ex.format !== "svg";
  const onOff = onOffOpts();
  const themes = THEMES.map((o) => ({ ...o, label: t(o.label) }));
  return (
    <div className="flex w-full max-w-[560px] flex-col gap-3.5 rounded-[14px] border border-line bg-bg p-6 text-[13px] text-ink">
      <span className="text-[20px] font-[650]">{t("Diagrams")}</span>
      <PrefRow label={t("Default theme")} desc={t("Diagrams follow the app theme")}>
        <ChipSelect value={s.diagramTheme} onChange={(v) => setExtraPrefs({ diagramTheme: v })} options={themes} />
      </PrefRow>
      <PrefRow label={t("Hand-drawn look")} desc={t("Rough strokes like whiteboard")}>
        <ChipSelect value={s.diagramHand ? "on" : "off"} onChange={(v) => setExtraPrefs({ diagramHand: v === "on" })} options={onOff} />
      </PrefRow>
      <PrefRow label={t("Export defaults")} desc={t("Format, scale, background")}>
        <button onClick={() => setExOpen((o) => !o)} aria-expanded={exOpen} className={cx("flex h-7 items-center rounded-[7px] border px-2.5 text-[12.5px] hover:bg-surface-2", exOpen ? "border-accent" : "border-line")}>
          {FMT[ex.format]}{raster ? ` · ${fmtNum(ex.scale)}×` : ""} · {bgLabel(ex)}
        </button>
      </PrefRow>
      {exOpen && (
        <div className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-surface p-3">
          {([
            [t("Format@@file"), <ChipSelect key="f" value={ex.format} onChange={(f) => setEx({ format: f })} options={(Object.keys(FMT) as DiagramExportPrefs["format"][]).map((f) => ({ value: f, label: FMT[f] }))} />],
            [t("Scale"), <ChipSelect key="s" value={ex.scale} disabled={!raster} onChange={(v) => setEx({ scale: v })} options={[1, 2, 3, 4, 6, 8].map((n) => ({ value: n, label: `${fmtNum(n)}×` }))} />],
            [t("Background"), <span key="b" className="flex items-center gap-1.5">{ex.background === "custom" && <input type="color" value={ex.color} onChange={(e) => setEx({ color: e.target.value })} className="h-7 w-8 cursor-pointer rounded border border-line bg-transparent" />}<ChipSelect value={ex.background} onChange={(v) => setEx({ background: v })} options={[{ value: "transparent", label: t("Transparent") }, { value: "theme", label: t("Theme") }, { value: "custom", label: t("Colour") }]} /></span>],
            [t("Theme"), <ChipSelect key="t" value={ex.theme} onChange={(v) => setEx({ theme: v })} options={themes} />],
            [t("Padding"), <ChipSelect key="p" value={ex.padding} onChange={(v) => setEx({ padding: v })} options={[0, 8, 16, 24, 32, 48, 64, 96].map((n) => ({ value: n, label: t("{n} px", { n }) }))} />],
            [t("Quality"), <ChipSelect key="q" value={Math.round(ex.quality * 100)} disabled={ex.format !== "jpeg" && ex.format !== "webp"} onChange={(v) => setEx({ quality: v / 100 })} options={[60, 70, 80, 90, 95, 100].map((n) => ({ value: n, label: t("{n}%", { n }) }))} />],
            [t("Text as SVG text"), <ChipSelect key="x" value={ex.svgText ? "on" : "off"} onChange={(v) => setEx({ svgText: v === "on" })} options={onOff} />],
            [t("Embed font"), <ChipSelect key="e" value={ex.embedFont ? "on" : "off"} onChange={(v) => setEx({ embedFont: v === "on" })} options={onOff} />],
          ] as const).map(([l, c]) => <div key={l} className="flex items-center gap-2"><span className="flex-1 text-muted">{l}</span>{c}</div>)}
          <button className="self-start text-[12px] text-link hover:underline" onClick={() => setSettings({ diagramExport: DIAGRAM_EXPORT_DEFAULTS })}>{t("Reset to defaults")}</button>
        </div>
      )}
      <PrefRow label={t("Open .mermaid files in")} desc={t("When a diagram file opens")}>
        <ChipSelect value={s.diagramOpenIn} onChange={(v) => setExtraPrefs({ diagramOpenIn: v })} options={[{ value: "edit", label: t("Source") }, { value: "split", label: t("Split") }, { value: "read", label: t("Preview") }]} />
      </PrefRow>
      <PrefRow label={t("Max render size")} desc={t("Larger diagrams show a fit button")}>
        <ChipSelect value={s.diagramMaxPx} onChange={(v) => setExtraPrefs({ diagramMaxPx: v })} options={[1000, 2000, 4000, 8000, 0].map((n) => ({ value: n, label: n ? t("{n} px", { n }) : t("No limit") }))} />
      </PrefRow>
      <PrefRow label={t("Diagrams saved from notes go to")} desc={t("Like an attachments folder")}>
        <ChipSelect value={s.diagramFolder ?? "sub"} onChange={(v) => setSettings({ diagramFolder: v })} options={[{ value: "sub", label: t("diagrams/ next to the note") }, { value: "space", label: t("One Diagrams folder") }, { value: "same", label: t("The note's folder") }]} />
      </PrefRow>
      <PrefRow label={t("Save new diagrams to the canvas")} desc={t("A few seconds after you stop editing a note")}>
        <ChipSelect value={s.diagramAutoSave ? "on" : "off"} onChange={(v) => setSettings({ diagramAutoSave: v === "on" })} options={onOff} />
      </PrefRow>
      <PrefRow label={t("Name new diagram files")} desc={t("A short name from Workers AI, else the section heading")}>
        <ChipSelect value={s.diagramAiNames ? "on" : "off"} onChange={(v) => setSettings({ diagramAiNames: v === "on" })} options={[{ value: "on", label: t("Suggested") }, { value: "off", label: t("From heading") }]} />
      </PrefRow>
    </div>
  );
}
