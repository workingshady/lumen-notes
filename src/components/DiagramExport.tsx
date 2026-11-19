import { Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copyImage, downloadBlob, EXT, exportPrefs, finalize, maxScale, safeName, saveExportPrefs, type DiagramExportPrefs, type ExportJob } from "../lib/diagram-export";
import { toast } from "../lib/store";
import { Toggle } from "./ShareSheet";
import { ChipSelect } from "./chip-select";
import { cx } from "./ui";

const SCALES = [1, 2, 3, 4, 6, 8];
const PADS = [0, 8, 16, 24, 32, 48, 64, 96];
const BG_PRESETS = [{ v: "white", l: "White", c: "#ffffff" }, { v: "paper", l: "Paper", c: "#faf8f3" }, { v: "black", l: "Black", c: "#0b0c0e" }];
const THEMES: { value: DiagramExportPrefs["theme"]; label: string }[] = [{ value: "app", label: "Match app" }, { value: "default", label: "Paper" }, { value: "dark", label: "Lamplight" }, { value: "neutral", label: "Neutral" }, { value: "forest", label: "Forest" }];
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
  const [copyOpen, setCopyOpen] = useState(false);
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


  useEffect(() => {
    if (!job) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !copyOpen) { e.preventDefault(); close(); } };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  if (!job) return null;
  const bgValue = p.background === "custom" ? (BG_PRESETS.find((b) => b.c.toLowerCase() === p.color.toLowerCase())?.v ?? "custom") : p.format === "jpeg" && p.background === "transparent" ? "theme" : p.background;
  const setBg = (v: string) => { const pre = BG_PRESETS.find((b) => b.v === v); if (pre) set({ background: "custom", color: pre.c }); else if (v === "custom") set({ background: "custom" }); else set({ background: v as DiagramExportPrefs["background"] }); };
  const lossy = p.format === "jpeg" || p.format === "webp";
  const fmtBtn = (f: DiagramExportPrefs["format"], l: string) => (
    <button key={f} onClick={() => set({ format: f })} className={cx("flex h-[26px] items-center justify-center", p.format === f ? "rounded-[6px] bg-surface-2 font-semibold" : "text-muted hover:text-ink")}>{l}</button>
  );
  const row = (l: string, ctl: React.ReactNode) => <div className="flex items-center gap-2.5"><span className="flex-1 text-muted">{l}</span>{ctl}</div>;
  return (
    // R4-17H: live preview on a checkerboard · format · Scale / Background / Theme / Padding / Quality · size · Copy / Download
    <div className="fixed inset-0 z-[70] flex items-end justify-center text-[13px] text-ink md:items-center">
      <div className="absolute inset-0 bg-[rgba(5,6,8,.55)]" onClick={close} />
      <div role="dialog" aria-label={job.title} className="relative flex max-h-[94dvh] w-full flex-col overflow-y-auto rounded-t-[14px] border border-line bg-surface md:grid md:w-[820px] md:max-w-[calc(100vw-32px)] md:grid-cols-[1fr_300px] md:overflow-visible md:rounded-[14px]">
        <div className="relative flex min-h-[240px] items-center justify-center overflow-hidden p-4 md:min-h-[380px] md:rounded-l-[14px]" style={{ background: "repeating-conic-gradient(#20242c 0 25%, #1a1d24 0 50%) 0 0/16px 16px" }}>
          {out && <img src={out.url} alt="Export preview" className="max-h-[440px] max-w-full rounded-[4px] object-contain" />}
          {busy && <div className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-surface/90 px-2 py-1 text-[11.5px] text-muted"><Loader2 size={12} className="animate-spin" />Rendering</div>}
          {err && <div className="absolute inset-x-3 bottom-3 rounded-[8px] bg-[color-mix(in_srgb,var(--danger)_14%,var(--surface))] px-3 py-2 text-[12.5px] text-bad">{err}</div>}
        </div>
        <div className="flex flex-col gap-3.5 border-line p-[18px] md:border-l">
          <div className="flex items-center"><span className="flex-1 text-[16px] font-[650]">{job.title}</span><button aria-label="Close" onClick={close} className="text-muted hover:text-ink"><X size={16} /></button></div>
          <div className="grid grid-cols-4 gap-0.5 rounded-[8px] border border-line bg-bg p-[3px] text-[12px]">{fmtBtn("svg", "SVG")}{fmtBtn("png", "PNG")}{fmtBtn("jpeg", "JPEG")}{fmtBtn("webp", "WebP")}</div>
          {row("Scale", <ChipSelect value={p.scale} disabled={!raster} onChange={(s) => set({ scale: s })} label={raster ? `${p.scale}×` : "Vector"}
            options={SCALES.map((s) => ({ value: s, label: `${s}×`, hint: out ? `${Math.round(out.natural.w * s)} × ${Math.round(out.natural.h * s)} px` : undefined, disabled: !!out && s > maxScale(out.natural.w, out.natural.h) + 0.01 }))} />)}
          {row("Background", <span className="flex items-center gap-1.5">
            {bgValue === "custom" && <input type="color" value={p.color} onChange={(e) => set({ color: e.target.value })} className="h-7 w-8 cursor-pointer rounded border border-line bg-transparent" title="Any colour" />}
            <ChipSelect value={bgValue} onChange={setBg} options={[...(p.format === "jpeg" ? [] : [{ value: "transparent", label: "Transparent" }]), { value: "theme", label: "Theme" }, ...BG_PRESETS.map((b) => ({ value: b.v, label: b.l })), { value: "custom", label: "Colour…" }]} />
          </span>)}
          {job.themable !== false && row("Theme", <ChipSelect value={p.theme} onChange={(t) => set({ theme: t })} options={THEMES} />)}
          {row("Padding", <ChipSelect value={p.padding} onChange={(v) => set({ padding: v })} options={PADS.map((n) => ({ value: n, label: `${n} px` }))} />)}
          {row("Quality", <ChipSelect value={Math.round(p.quality * 100)} disabled={!lossy} label={lossy ? `${Math.round(p.quality * 100)}%` : "Lossless"} onChange={(q) => set({ quality: q / 100 })} options={[60, 70, 80, 90, 95, 100].map((q) => ({ value: q, label: `${q}%` }))} />)}
          <span className="text-[12px] text-muted">
            {out ? <>{raster ? `${out.width} × ${out.height} px` : `${Math.round(out.natural.w)} × ${Math.round(out.natural.h)} · vector`} · ~{fmtBytes(out.blob.size)}</> : "Rendering…"}
            {capped && <span className="text-warn"> · limited to {out!.scale.toFixed(1)}× by the browser</span>}
          </span>
          <details className="text-[12.5px]">
            <summary className="cursor-pointer text-muted hover:text-ink">More options</summary>
            <div className="mt-2.5 flex flex-col gap-2.5">
              <label className="flex items-center gap-2"><Toggle on={p.svgText} onChange={(v) => set({ svgText: v })} /><span className="flex-1">Text as SVG text <span className="text-muted">(editable in Figma)</span></span></label>
              <label className="flex items-center gap-2"><Toggle on={p.embedFont} onChange={(v) => set({ embedFont: v })} /><span className="flex-1">Embed font</span></label>
              <div className="flex items-center rounded-[8px] border border-line bg-bg pe-2.5"><input aria-label="File name" value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 font-mono text-[12px] outline-none" /><span className="font-mono text-[12px] text-muted">.{EXT[p.format]}</span></div>
            </div>
          </details>
          <div className="mt-auto flex gap-2">
            <span className="relative flex-1">
              <button onClick={() => setCopyOpen((o) => !o)} className="flex h-[34px] w-full items-center justify-center rounded-[9px] border border-line hover:bg-surface-2">Copy</button>
              {copyOpen && (
                <div className="absolute bottom-full left-0 z-10 mb-1.5 flex w-[180px] flex-col rounded-[9px] border border-line bg-surface-2 p-1 shadow-[0_12px_28px_rgba(0,0,0,.35)]" onMouseLeave={() => setCopyOpen(false)}>
                  {([["Copy image", copyImg], ["Copy SVG", copySvg], ...(job.src ? [["Copy source", copySrc]] : [])] as [string, () => Promise<void>][]).map(([l, f]) => (
                    <button key={l} onClick={() => { setCopyOpen(false); void f(); }} className="flex h-8 items-center rounded-[6px] px-2.5 text-left hover:bg-surface">{l}</button>
                  ))}
                </div>
              )}
            </span>
            <button disabled={!out || busy} onClick={() => void download()} className="flex h-[34px] flex-1 items-center justify-center rounded-[9px] bg-accent font-semibold text-accent-fg hover:brightness-110 disabled:opacity-50">Download</button>
          </div>
        </div>
      </div>
    </div>
  );
}
