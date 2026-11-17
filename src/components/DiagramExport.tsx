import { Clipboard, Code2, Download, FileCode, Image as ImageIcon, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copyImage, downloadBlob, EXT, exportPrefs, finalize, maxScale, safeName, saveExportPrefs, type DiagramExportPrefs, type ExportJob } from "../lib/diagram-export";
import { toast } from "../lib/store";
import { Toggle } from "./ShareSheet";
import { Button, cx, Segmented, Sheet } from "./ui";

const SCALES = [1, 2, 3, 4, 6, 8];
const SWATCHES = ["#ffffff", "#f6f4ef", "#0b0c0e", "#1b1d22", "#0f172a", "#fff7e6"];
const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

/**
 * Export a Mermaid diagram (opened by `openDiagramExport(src, name)` from any diagram toolbar).
 * Live preview of the real output; choices are remembered as the defaults (Settings › Diagrams edits them too).
 */
export function DiagramExport() {
  const [job, setJob] = useState<ExportJob | null>(null);
  const [p, setP] = useState<DiagramExportPrefs>(exportPrefs);
  const [name, setName] = useState("diagram");
  const [out, setOut] = useState<{ url: string; blob: Blob; width: number; height: number; scale: number; natural: { w: number; h: number } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ExportJob>).detail;
      setP(exportPrefs());
      setName(safeName(d.name));
      setJob(d);
    };
    addEventListener("lumen:export", on);
    return () => removeEventListener("lumen:export", on);
  }, []);

  // Re-render the real output (debounced) whenever an option changes.
  useEffect(() => {
    if (!job) return;
    const my = ++seq.current;
    setBusy(true); setErr(null);
    const t = setTimeout(async () => {
      try {
        const b = await job.build(p);
        const r = await finalize(b, p);
        if (my !== seq.current) return;
        setOut((old) => { if (old) URL.revokeObjectURL(old.url); return { ...r, url: URL.createObjectURL(r.blob), natural: { w: b.width, h: b.height } }; });
      } catch (e) {
        console.warn("export failed", e);
        if (my === seq.current) setErr((e as Error).message);
      } finally { if (my === seq.current) setBusy(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [job, p]);

  const close = () => { setJob(null); setOut((old) => { if (old) URL.revokeObjectURL(old.url); return null; }); };
  const set = (x: Partial<DiagramExportPrefs>) => { setP((o) => ({ ...o, ...x })); saveExportPrefs(x); };
  const raster = p.format !== "svg";
  const capped = out && raster && out.scale < p.scale - 0.01;
  const file = `${name || "diagram"}.${EXT[p.format]}`;

  const download = async () => {
    if (!out) return;
    await downloadBlob(out.blob, file);
    toast(`Saved ${file}`);
  };
  const copyImg = async () => {
    if (!job) return;
    try {
      const png = p.format === "png" ? out!.blob : (await finalize(await job.build({ ...p, format: "png" }), { ...p, format: "png" })).blob;
      await copyImage(png);
      toast("Image copied");
    } catch (e) { toast((e as Error).message); }
  };
  const copySvg = async () => { if (!job) return; const b = await job.build({ ...p, format: "svg" }); await navigator.clipboard.writeText(b.svg); toast("SVG code copied"); };
  const copySrc = async () => { if (!job?.src) return; await navigator.clipboard.writeText(job.src); toast("Mermaid source copied"); };

  const label = "text-[12px] font-semibold uppercase tracking-[.05em] text-muted";
  return (
    <Sheet open={!!job} onClose={close} title={job?.title ?? "Export"} wide>
      <div className="flex flex-col gap-4 md:flex-row">
        {/* preview */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className={cx("relative flex h-[300px] items-center justify-center overflow-hidden rounded-[10px] border border-line md:h-[440px]", "export-checker")}>
            {out && <img src={out.url} alt="Export preview" className="max-h-full max-w-full object-contain" />}
            {busy && <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-surface/90 px-2 py-1 text-[11.5px] text-muted"><Loader2 size={12} className="animate-spin" />Rendering</div>}
            {err && <div className="absolute inset-x-3 bottom-3 rounded-[8px] bg-[color-mix(in_srgb,var(--danger)_14%,var(--surface))] px-3 py-2 text-[12.5px] text-bad">{err}</div>}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
            {out && <span className="tabular-nums text-ink">{raster ? `${out.width.toLocaleString()} × ${out.height.toLocaleString()} px` : `${Math.round(out.natural.w)} × ${Math.round(out.natural.h)} (vector)`}</span>}
            {out && <span>{fmtBytes(out.blob.size)}</span>}
            {capped && <span className="text-warn">scale limited to {out!.scale.toFixed(1)}× by the browser's maximum image size</span>}
          </div>
        </div>

        {/* options */}
        <div className="flex w-full shrink-0 flex-col gap-3.5 md:w-[300px]">
          <div className="flex flex-col gap-1.5"><span className={label}>Format</span>
            <Segmented value={p.format} onChange={(f) => set({ format: f })} options={[{ value: "svg", label: "SVG", title: "Vector: sharp at any size, editable" }, { value: "png", label: "PNG", title: "Lossless, supports transparency" }, { value: "jpeg", label: "JPEG", title: "Small, no transparency" }, { value: "webp", label: "WebP", title: "Small, supports transparency" }]} />
          </div>
          {raster && (
            <div className="flex flex-col gap-1.5"><span className={label}>Scale {out && <span className="font-normal normal-case tracking-normal">· max {Math.floor(maxScale(out.natural.w, out.natural.h))}×</span>}</span>
              <div className="flex gap-1">{SCALES.map((s) => <button key={s} onClick={() => set({ scale: s })} className={cx("h-8 flex-1 rounded-[7px] border text-[12.5px] tabular-nums", p.scale === s ? "border-accent bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] font-semibold" : "border-line text-muted hover:text-ink")}>{s}×</button>)}</div>
            </div>
          )}
          {(p.format === "jpeg" || p.format === "webp") && (
            <div className="flex flex-col gap-1.5"><span className={label}>Quality <span className="font-normal normal-case tracking-normal">· {Math.round(p.quality * 100)}%</span></span>
              <input type="range" min={50} max={100} value={Math.round(p.quality * 100)} onChange={(e) => set({ quality: Number(e.target.value) / 100 })} className="accent-[var(--accent)]" />
            </div>
          )}
          <div className="flex flex-col gap-1.5"><span className={label}>Background</span>
            <Segmented value={p.format === "jpeg" && p.background === "transparent" ? "theme" : p.background} onChange={(b) => set({ background: b })}
              options={[...(p.format === "jpeg" ? [] : [{ value: "transparent" as const, label: "Transparent" }]), { value: "theme", label: "Theme" }, { value: "custom", label: "Colour" }]} />
            {p.background === "custom" && (
              <div className="flex items-center gap-1.5">
                {SWATCHES.map((c) => <button key={c} title={c} onClick={() => set({ color: c })} className={cx("size-6 rounded-full border", p.color === c ? "border-accent ring-2 ring-[color-mix(in_srgb,var(--accent)_35%,transparent)]" : "border-line")} style={{ background: c }} />)}
                <input type="color" value={p.color} onChange={(e) => set({ color: e.target.value })} className="ms-auto h-7 w-10 cursor-pointer rounded border border-line bg-transparent" title="Any colour" />
              </div>
            )}
          </div>
          {job?.themable !== false && <div className="flex flex-col gap-1.5"><span className={label}>Theme</span>
            <Segmented value={p.theme} onChange={(t) => set({ theme: t })} options={[{ value: "app", label: "App" }, { value: "default", label: "Light" }, { value: "dark", label: "Dark" }, { value: "neutral", label: "Neutral" }, { value: "forest", label: "Forest" }]} />
          </div>}
          <div className="flex flex-col gap-1.5"><span className={label}>Padding <span className="font-normal normal-case tracking-normal">· {p.padding} px</span></span>
            <input type="range" min={0} max={120} step={4} value={p.padding} onChange={(e) => set({ padding: Number(e.target.value) })} className="accent-[var(--accent)]" />
          </div>
          <div className="flex flex-col gap-2 text-[13px]">
            <label className="flex items-center gap-2"><Toggle on={p.svgText} onChange={(v) => set({ svgText: v })} /><span className="flex-1">Text as SVG text <span className="text-muted">(sharp, editable in Figma)</span></span></label>
            <label className="flex items-center gap-2"><Toggle on={p.embedFont} onChange={(v) => set({ embedFont: v })} /><span className="flex-1">Embed font <span className="text-muted">(looks the same everywhere)</span></span></label>
          </div>
          <div className="flex flex-col gap-1.5"><span className={label}>File name</span>
            <div className="flex items-center rounded-[8px] border border-line bg-surface-2 pe-2.5"><input value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 font-mono text-[12.5px] outline-none" /><span className="font-mono text-[12px] text-muted">.{EXT[p.format]}</span></div>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
        {job?.src && <Button size="sm" variant="ghost" onClick={() => void copySrc()}><Code2 size={14} />Copy source</Button>}
        <Button size="sm" variant="ghost" onClick={() => void copySvg()}><FileCode size={14} />Copy SVG</Button>
        <Button size="sm" variant="ghost" onClick={() => void copyImg()}><Clipboard size={14} />Copy image</Button>
        <span className="flex-1" />
        <Button variant="primary" disabled={!out || busy} onClick={() => void download()}>{p.format === "svg" ? <FileCode size={15} /> : <ImageIcon size={15} />}<Download size={14} />Download {file}</Button>
      </div>
    </Sheet>
  );
}
