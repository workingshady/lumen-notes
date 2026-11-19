import { useState } from "react";
import { ChipSelect, PrefRow } from "../components/chip-select";
import { setExtraPrefs, useExtraPrefs, type DiagramPrefs } from "../lib/reading-prefs";
import { DIAGRAM_EXPORT_DEFAULTS, setSettings, type DiagramExportPrefs } from "../lib/settings";
import { cx } from "../components/ui";

const THEMES: { value: DiagramPrefs["diagramTheme"]; label: string }[] = [{ value: "app", label: "Match app" }, { value: "default", label: "Paper" }, { value: "dark", label: "Lamplight" }, { value: "neutral", label: "Neutral" }, { value: "forest", label: "Forest" }];
const FMT: Record<DiagramExportPrefs["format"], string> = { svg: "SVG", png: "PNG", jpeg: "JPEG", webp: "WebP" };
const bgLabel = (e: DiagramExportPrefs) => e.background === "transparent" ? "transparent" : e.background === "theme" ? "theme" : e.color.toLowerCase() === "#ffffff" ? "white" : e.color;
const onOff = [{ value: "on", label: "On" }, { value: "off", label: "Off" }];

/** Settings › Diagrams (design round 4, Lumen 17 · R4-17I): default theme, hand-drawn look, export defaults,
 *  how .mermaid files open, max render size; plus where saved diagrams go, auto-save and AI names. */
export function DiagramsSection() {
  const s = useExtraPrefs();
  const ex: DiagramExportPrefs = { ...DIAGRAM_EXPORT_DEFAULTS, ...(s.diagramExport ?? {}) };
  const setEx = (p: Partial<DiagramExportPrefs>) => setSettings({ diagramExport: { ...ex, ...p } });
  const [exOpen, setExOpen] = useState(false);
  const raster = ex.format !== "svg";
  return (
    <div className="flex w-full max-w-[560px] flex-col gap-3.5 rounded-[14px] border border-line bg-bg p-6 text-[13px] text-ink">
      <span className="text-[20px] font-[650]">Diagrams</span>
      <PrefRow label="Default theme" desc="Diagrams follow the app theme">
        <ChipSelect value={s.diagramTheme} onChange={(v) => setExtraPrefs({ diagramTheme: v })} options={THEMES} />
      </PrefRow>
      <PrefRow label="Hand-drawn look" desc="Rough strokes like whiteboard">
        <ChipSelect value={s.diagramHand ? "on" : "off"} onChange={(v) => setExtraPrefs({ diagramHand: v === "on" })} options={onOff} />
      </PrefRow>
      <PrefRow label="Export defaults" desc="Format, scale, background">
        <button onClick={() => setExOpen((o) => !o)} aria-expanded={exOpen} className={cx("flex h-7 items-center rounded-[7px] border px-2.5 text-[12.5px] hover:bg-surface-2", exOpen ? "border-accent" : "border-line")}>
          {FMT[ex.format]}{raster ? ` · ${ex.scale}×` : ""} · {bgLabel(ex)}
        </button>
      </PrefRow>
      {exOpen && (
        <div className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-surface p-3">
          {([
            ["Format", <ChipSelect key="f" value={ex.format} onChange={(f) => setEx({ format: f })} options={(Object.keys(FMT) as DiagramExportPrefs["format"][]).map((f) => ({ value: f, label: FMT[f] }))} />],
            ["Scale", <ChipSelect key="s" value={ex.scale} disabled={!raster} onChange={(v) => setEx({ scale: v })} options={[1, 2, 3, 4, 6, 8].map((n) => ({ value: n, label: `${n}×` }))} />],
            ["Background", <span key="b" className="flex items-center gap-1.5">{ex.background === "custom" && <input type="color" value={ex.color} onChange={(e) => setEx({ color: e.target.value })} className="h-7 w-8 cursor-pointer rounded border border-line bg-transparent" />}<ChipSelect value={ex.background} onChange={(v) => setEx({ background: v })} options={[{ value: "transparent", label: "Transparent" }, { value: "theme", label: "Theme" }, { value: "custom", label: "Colour" }]} /></span>],
            ["Theme", <ChipSelect key="t" value={ex.theme} onChange={(v) => setEx({ theme: v })} options={THEMES} />],
            ["Padding", <ChipSelect key="p" value={ex.padding} onChange={(v) => setEx({ padding: v })} options={[0, 8, 16, 24, 32, 48, 64, 96].map((n) => ({ value: n, label: `${n} px` }))} />],
            ["Quality", <ChipSelect key="q" value={Math.round(ex.quality * 100)} disabled={ex.format !== "jpeg" && ex.format !== "webp"} onChange={(v) => setEx({ quality: v / 100 })} options={[60, 70, 80, 90, 95, 100].map((n) => ({ value: n, label: `${n}%` }))} />],
            ["Text as SVG text", <ChipSelect key="x" value={ex.svgText ? "on" : "off"} onChange={(v) => setEx({ svgText: v === "on" })} options={onOff} />],
            ["Embed font", <ChipSelect key="e" value={ex.embedFont ? "on" : "off"} onChange={(v) => setEx({ embedFont: v === "on" })} options={onOff} />],
          ] as const).map(([l, c]) => <div key={l} className="flex items-center gap-2"><span className="flex-1 text-muted">{l}</span>{c}</div>)}
          <button className="self-start text-[12px] text-link hover:underline" onClick={() => setSettings({ diagramExport: DIAGRAM_EXPORT_DEFAULTS })}>Reset to defaults</button>
        </div>
      )}
      <PrefRow label="Open .mermaid files in" desc="When a diagram file opens">
        <ChipSelect value={s.diagramOpenIn} onChange={(v) => setExtraPrefs({ diagramOpenIn: v })} options={[{ value: "edit", label: "Source" }, { value: "split", label: "Split" }, { value: "read", label: "Preview" }]} />
      </PrefRow>
      <PrefRow label="Max render size" desc="Larger diagrams show a fit button">
        <ChipSelect value={s.diagramMaxPx} onChange={(v) => setExtraPrefs({ diagramMaxPx: v })} options={[1000, 2000, 4000, 8000, 0].map((n) => ({ value: n, label: n ? `${n} px` : "No limit" }))} />
      </PrefRow>
      <PrefRow label="Diagrams saved from notes go to" desc="Like an attachments folder">
        <ChipSelect value={s.diagramFolder ?? "sub"} onChange={(v) => setSettings({ diagramFolder: v })} options={[{ value: "sub", label: "diagrams/ next to the note" }, { value: "space", label: "One Diagrams folder" }, { value: "same", label: "The note's folder" }]} />
      </PrefRow>
      <PrefRow label="Save new diagrams to the canvas" desc="A few seconds after you stop editing a note">
        <ChipSelect value={s.diagramAutoSave ? "on" : "off"} onChange={(v) => setSettings({ diagramAutoSave: v === "on" })} options={onOff} />
      </PrefRow>
      <PrefRow label="Name new diagram files" desc="A short name from Workers AI, else the section heading">
        <ChipSelect value={s.diagramAiNames ? "on" : "off"} onChange={(v) => setSettings({ diagramAiNames: v === "on" })} options={[{ value: "on", label: "Suggested" }, { value: "off", label: "From heading" }]} />
      </PrefRow>
    </div>
  );
}
