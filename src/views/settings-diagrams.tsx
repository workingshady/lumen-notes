import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { DIAGRAM_EXPORT_DEFAULTS, setSettings, useSettings, type DiagramExportPrefs } from "../lib/settings";
import { Toggle } from "../components/ShareSheet";
import { cx, Segmented } from "../components/ui";

/** Settings › Diagrams: where diagram files go, auto-save and AI names, and the export defaults. */
export function DiagramsSection() {
  const s = useSettings();
  const ex: DiagramExportPrefs = { ...DIAGRAM_EXPORT_DEFAULTS, ...(s.diagramExport ?? {}) };
  const setEx = (p: Partial<DiagramExportPrefs>) => setSettings({ diagramExport: { ...ex, ...p } });
  const raster = ex.format !== "svg";
  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div>
        <div className="text-[17px] font-[650]">Diagrams</div>
        <div className="mt-1 text-[13px] text-muted">Mermaid diagrams in notes, <span className="font-mono">.mermaid</span> files, canvases and exports.</div>
      </div>

      <Block title="Storage" hint="Like an attachments folder: diagrams saved from notes go to one place instead of mixing with your notes.">
        <Field label="Diagram files saved from notes go to">
          <Segmented value={s.diagramFolder ?? "sub"} onChange={(v) => setSettings({ diagramFolder: v })}
            options={[{ value: "sub", label: "diagrams/ next to the note" }, { value: "space", label: "One Diagrams folder" }, { value: "same", label: "The note's folder" }]} />
        </Field>
      </Block>

      <Block title="Saving">
        <ToggleRow title="Save new diagrams to the canvas automatically" hint="A few seconds after you stop editing a note, any new Mermaid block is saved to the note's diagram canvas, and a changed diagram updates its file." on={!!s.diagramAutoSave} onChange={(v) => setSettings({ diagramAutoSave: v })} />
        <ToggleRow title="Name new diagram files with AI" hint="Asks Workers AI for a short descriptive name (e.g. feed-refresh-pipeline.mermaid). Falls back to the section heading when AI is off or over today's free limit." on={!!s.diagramAiNames} onChange={(v) => setSettings({ diagramAiNames: v })} />
      </Block>

      <Block title="Export defaults" hint="Used by the Export dialog on every diagram; the dialog remembers your last choice here too."
        right={<button className="flex items-center gap-1 text-[12px] text-link" onClick={() => setSettings({ diagramExport: DIAGRAM_EXPORT_DEFAULTS })}><RotateCcw size={12} />Reset</button>}>
        <Field label="Format">
          <Segmented value={ex.format} onChange={(f) => setEx({ format: f })} options={[{ value: "svg", label: "SVG" }, { value: "png", label: "PNG" }, { value: "jpeg", label: "JPEG" }, { value: "webp", label: "WebP" }]} />
        </Field>
        {raster && (
          <Field label={`Scale · ${ex.scale}×`}>
            <div className="flex gap-1">{[1, 2, 3, 4, 6, 8].map((n) => <button key={n} onClick={() => setEx({ scale: n })} className={cx("h-8 flex-1 rounded-[7px] border text-[12.5px]", ex.scale === n ? "border-accent font-semibold" : "border-line text-muted hover:text-ink")}>{n}×</button>)}</div>
          </Field>
        )}
        {(ex.format === "jpeg" || ex.format === "webp") && (
          <Field label={`Quality · ${Math.round(ex.quality * 100)}%`}>
            <input type="range" min={50} max={100} value={Math.round(ex.quality * 100)} onChange={(e) => setEx({ quality: Number(e.target.value) / 100 })} className="w-full accent-[var(--accent)]" />
          </Field>
        )}
        <Field label="Background">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={ex.background} onChange={(b) => setEx({ background: b })} options={[{ value: "transparent", label: "Transparent" }, { value: "theme", label: "Theme" }, { value: "custom", label: "Colour" }]} />
            {ex.background === "custom" && <input type="color" value={ex.color} onChange={(e) => setEx({ color: e.target.value })} className="h-7 w-10 cursor-pointer rounded border border-line bg-transparent" />}
          </div>
        </Field>
        <Field label="Theme">
          <Segmented value={ex.theme} onChange={(t) => setEx({ theme: t })} options={[{ value: "app", label: "App" }, { value: "default", label: "Light" }, { value: "dark", label: "Dark" }, { value: "neutral", label: "Neutral" }, { value: "forest", label: "Forest" }]} />
        </Field>
        <Field label={`Padding · ${ex.padding} px`}>
          <input type="range" min={0} max={120} step={4} value={ex.padding} onChange={(e) => setEx({ padding: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
        </Field>
        <ToggleRow title="Text as SVG text" hint="Sharp at any size and editable in Figma, Illustrator or Inkscape. Turn off only if a diagram type renders text badly." on={ex.svgText} onChange={(v) => setEx({ svgText: v })} />
        <ToggleRow title="Embed font" hint="Embeds just the Inter (and Arabic) glyphs the diagram uses, so text looks the same on any machine." on={ex.embedFont} onChange={(v) => setEx({ embedFont: v })} />
      </Block>
    </div>
  );
}

function Block({ title, hint, right, children }: { title: string; hint?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <div className="flex-1"><div className="text-[12px] font-semibold uppercase tracking-[.06em] text-muted">{title}</div>{hint && <div className="mt-0.5 text-[12.5px] leading-[18px] text-muted">{hint}</div>}</div>
        {right}
      </div>
      <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4">{children}</div>
    </section>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-col gap-1.5"><span className="text-[13px] font-medium">{label}</span>{children}</div>;
}
function ToggleRow({ title, hint, on, onChange }: { title: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-1"><div className="text-[13.5px] font-medium">{title}</div><div className="mt-0.5 text-[12.5px] leading-[18px] text-muted">{hint}</div></div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}
