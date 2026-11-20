import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { copyImage, downloadBlob } from "../lib/diagram-export";
import type { ExportOptions, ExportScope, VisualExportJob } from "../lib/export-job";
import { EXPORT_EVENT, isVisualJob, loadOptions, saveOptions } from "../lib/export-job";
import { legacyJob } from "../lib/export-jobs";
import { isImageFormat, renderPreview, renderUnit, resolveBg, runExport, withBg, type Preview } from "../lib/export-run";
import { fmtNum, t } from "../lib/i18n";
import { toast } from "../lib/store";
import { Glyph } from "./Glyph";
import type { GlyphName } from "../lib/glyphs";

// Port of design/handoffs/2026-11-20-round-7/ExportDlg.dc.html (frames 42A-I, 43C). Tokens: --sf = --surface, --sf2 = --surface-2, --bd = --border,
// --tx = --text, --mu = --muted, --ac = --accent, --af = --accent-fg, --ok = --success, --wa = --warning, --le = --learn.
const g = (n: string) => n as GlyphName;
const AC = "color-mix(in srgb,var(--accent) 18%,transparent)";
const HATCH = "repeating-linear-gradient(135deg,var(--surface-2) 0 4px,var(--bg) 4px 8px)";
const CHECKER = "conic-gradient(var(--surface-2) 25%,var(--bg) 0 50%,var(--surface-2) 0 75%,var(--bg) 0) 0 0/16px 16px";
const fmtBytes = (n: number) => (n > 1e6 ? `≈ ${fmtNum(n / 1e6, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB` : `≈ ${fmtNum(Math.max(1, Math.round(n / 1e3)))} KB`);
const KIND_G: Record<string, string> = { whiteboard: "whiteboard", board: "board", canvas: "canvas", mermaid: "mermaid", architecture: "diagram", graph: "graph" };
const KIND_FOOT: Record<string, () => string> = { whiteboard: () => t("whiteboards"), board: () => t("boards"), canvas: () => t("canvas"), mermaid: () => t("diagrams"), architecture: () => t("architectures"), graph: () => t("graphs") };

interface Cell { l?: string; g?: string; sub?: string; on?: boolean; op?: number; col?: boolean; mh?: string; tag?: string; th?: string; thumb?: string; tog?: boolean; sli?: [number, number, number, (v: number) => void]; tip?: string; onClick?: () => void; pick?: { options: [string, string][]; value: string; onChange: (v: string) => void }; input?: ReactNode }

/** One grid cell: the design's `it()` item (glyph, label, sub, toggle, slider, tag). */
function Item({ c }: { c: Cell }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener("mousedown", h);
    return () => removeEventListener("mousedown", h);
  }, [open]);
  const disabled = c.op !== undefined && c.op < 0.5;
  const st: CSSProperties = {
    display: "flex", flexDirection: c.col ? "column" : "row", alignItems: "center", justifyContent: c.col ? "center" : "flex-start", gap: c.col ? 3 : 8, minHeight: c.mh ?? (c.col ? 50 : 32), padding: c.col ? "5px 3px" : "0 8px",
    borderRadius: 8, background: c.on ? AC : "transparent", border: `1px solid ${c.on ? "var(--accent)" : "var(--border)"}`, color: "var(--text)", opacity: c.op ?? 1, fontSize: c.col ? 10.5 : 12.5, boxSizing: "border-box", minWidth: 0,
    position: "relative", cursor: disabled ? "not-allowed" : c.onClick || c.pick || c.tog !== undefined ? "pointer" : "default", transition: "background .14s var(--ease),border-color .14s var(--ease)", textAlign: "start",
  };
  const label = c.l && <span style={{ flex: c.col ? "0 0 auto" : 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: c.on ? 600 : 400, textAlign: c.col ? "center" : "start" }}>{c.l}</span>;
  return (
    <div ref={ref} title={c.tip ?? c.l ?? ""} style={st} role={c.tog !== undefined ? "switch" : "button"} aria-checked={c.tog} aria-pressed={c.on} tabIndex={0}
      onClick={() => { if (c.pick) setOpen((o) => !o); else if (!disabled || c.thumb) c.onClick?.(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      {(c.th || c.thumb) && <span style={{ width: "100%", height: 34, flexShrink: 0, borderRadius: 4, background: c.thumb ? `center/cover url(${c.thumb})` : HATCH, border: "1px solid var(--border)", boxSizing: "border-box" }} />}
      {c.g && <Glyph name={g(c.g)} size={17} style={{ flexShrink: 0 }} />}
      {label}
      {c.sub && <span style={{ fontSize: 10.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{c.sub}</span>}
      {c.input}
      {c.tog !== undefined && <span style={{ width: 30, height: 18, borderRadius: 999, background: c.tog ? "var(--accent)" : "var(--border)", position: "relative", flexShrink: 0, transition: "background .16s var(--ease)" }}><span style={{ position: "absolute", top: 2, left: c.tog ? 14 : 2, width: 14, height: 14, borderRadius: "50%", background: c.tog ? "var(--accent-fg)" : "var(--muted)", transition: "left .16s var(--ease)" }} /></span>}
      {c.sli && (() => { const [v, lo, hi, set] = c.sli; const pc = ((v - lo) / (hi - lo)) * 100; return (
        <span style={{ display: "block", flex: 1, height: 4, borderRadius: 2, background: `linear-gradient(to ${typeof document !== "undefined" && getComputedStyle(document.documentElement).direction === "rtl" ? "left" : "right"},var(--accent) ${pc}%,var(--border) ${pc}%)`, position: "relative", minWidth: 60 }}>
          <span style={{ position: "absolute", insetInlineStart: `${pc}%`, top: -6, width: 16, height: 16, marginInlineStart: -8, borderRadius: "50%", background: "var(--text)" }} />
          <input type="range" min={lo} max={hi} value={v} disabled={disabled} onChange={(e) => set(+e.target.value)} aria-label={c.l} style={{ position: "absolute", inset: "-8px 0", width: "100%", height: 20, opacity: 0, cursor: "pointer", margin: 0 }} />
        </span>); })()}
      {c.tag && <span style={{ fontSize: 10, fontWeight: 600, color: "var(--learn)", border: "1px solid var(--learn)", padding: "0 5px", borderRadius: 999, whiteSpace: "nowrap" }}>{c.tag}</span>}
      {c.pick && open && (
        <div role="listbox" style={{ position: "absolute", insetInlineEnd: 0, top: "calc(100% + 4px)", zIndex: 5, minWidth: 140, padding: 4, borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border)", boxShadow: "0 14px 36px rgba(0,0,0,.35)", display: "flex", flexDirection: "column", animation: "lm-pop .14s var(--ease)" }}>
          {c.pick.options.map(([v, l]) => <div key={v} role="option" aria-selected={v === c.pick!.value} onClick={(e) => { e.stopPropagation(); c.pick!.onChange(v); setOpen(false); }} style={{ height: 30, display: "flex", alignItems: "center", padding: "0 10px", borderRadius: 6, fontSize: 12.5, fontWeight: v === c.pick!.value ? 600 : 400, background: v === c.pick!.value ? AC : "transparent", whiteSpace: "nowrap" }}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

interface Block { h?: string; seg?: string[]; segOn?: number; segPick?: (i: number) => void; items?: Cell[]; cols?: string; gap?: string; note?: string; noteC?: string; noteBg?: string }
function BlockView({ b }: { b: Block }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {b.h && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}><span>{b.h}</span></div>}
      {b.seg && (
        <div role="tablist" style={{ display: "flex", flexWrap: "wrap", padding: 2, borderRadius: 8, background: "var(--surface-2)", gap: 2 }}>
          {b.seg.map((l, i) => { const on = i === (b.segOn ?? 0); return (
            <button key={l} role="tab" aria-selected={on} onClick={() => b.segPick?.(i)} style={{ flex: b.seg!.length > 5 ? "1 0 auto" : 1, height: 28, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, background: on ? "var(--surface)" : "transparent", color: on ? "var(--text)" : "var(--muted)", fontWeight: on ? 600 : 400, whiteSpace: "nowrap", boxShadow: on ? "0 1px 2px rgba(0,0,0,.2)" : "none", padding: "0 6px", border: 0, transition: "background .14s var(--ease),color .14s var(--ease)" }}>{l}</button>
          ); })}
        </div>
      )}
      {b.items && <div style={{ display: "grid", gridTemplateColumns: b.cols ?? "1fr", gap: b.gap ?? "4px" }}>{b.items.map((c, i) => <Item key={i} c={c} />)}</div>}
      {b.note && <div style={{ fontSize: 11.5, lineHeight: "17px", color: b.noteC ?? "var(--muted)", background: b.noteBg ?? "transparent", padding: b.noteBg ? "8px 10px" : 0, borderRadius: 8 }}>{b.note}</div>}
    </div>
  );
}

const SCALES: ExportOptions["scale"][] = [1, 2, 3, 4, "max"];
/** Mermaid kind ids → the label the design shows. */
const MK_LABEL: Record<string, string> = { c4: "C4", sequence: "sequence", state: "state", class: "class" };
/** Shortcut label for the platform (⇧⌘C on Apple, Ctrl+Shift+C elsewhere). */
export const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
export const shortcut = (k: string) => (MAC ? `⇧⌘${k}` : `Ctrl+Shift+${k}`);
const PRESETS: { g: string; l: () => string; set: Partial<ExportOptions> }[] = [
  { g: "present", l: () => t("Slides 16:9"), set: { format: "png", scale: 2, aspect: 16 / 9, padding: 32, background: "board", pdfPage: "16:9", pdfOrient: "landscape" } },
  { g: "pdf", l: () => t("A4 print"), set: { format: "pdf", scale: 2, aspect: 0, pdfPage: "a4", pdfOrient: "portrait", pdfMargin: 12, background: "theme", theme: "default", pattern: false } },
  { g: "shape-square", l: () => t("Social square"), set: { format: "png", scale: 2, aspect: 1, padding: 48 } },
  { g: "transparent", l: () => t("Sticker"), set: { format: "png", scale: 3, aspect: 0, background: "transparent", pattern: false, padding: 8, frameNames: false } },
];
const usePhone = () => {
  const [p, setP] = useState(() => matchMedia("(max-width: 767px)").matches);
  useEffect(() => { const m = matchMedia("(max-width: 767px)"); const f = () => setP(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return p;
};
const mediaWhat = (m: { videos: number; gifs: number }) => [m.videos ? (m.videos === 1 ? t("1 video") : t("{n} videos", { n: m.videos })) : "", m.gifs ? (m.gifs === 1 ? t("1 GIF") : t("{n} GIFs", { n: m.gifs })) : ""].filter(Boolean).join(` ${t("and")} `);

/** The one Export dialog for every visual (opened with `openExportJob(job)`, see lib/export-job.ts). */
export function DiagramExport() {
  const [job, setJob] = useState<VisualExportJob | null>(null);
  const [o, setO] = useState<ExportOptions | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<[number, number] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const phone = usePhone();
  const seq = useRef(0);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail;
      const j: VisualExportJob = isVisualJob(d) ? d : legacyJob(d);
      const opt = loadOptions(j);
      if (!j.scopes.includes(opt.scope)) opt.scope = "whole";
      setJob(j); setO(opt); setPv(null); setErr(null); setProg(null); setCopyOpen(false);
    };
    addEventListener(EXPORT_EVENT, on);
    return () => removeEventListener(EXPORT_EVENT, on);
  }, []);

  const key = o ? JSON.stringify({ ...o, fileName: "" }) : "";
  useEffect(() => {
    if (!job || !o) return;
    const my = ++seq.current;
    setBusy(true); setErr(null);
    const tm = setTimeout(async () => {
      try {
        const r = await renderPreview(job, withBg(job, o));
        if (my !== seq.current) return;
        setPv((old) => { if (old?.url) URL.revokeObjectURL(old.url); return r; });
      } catch (e) { if (my === seq.current) setErr((e as Error).message); }
      finally { if (my === seq.current) setBusy(false); }
    }, 220);
    return () => clearTimeout(tm);
  }, [job, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { seq.current++; setJob(null); setPv((old) => { if (old?.url) URL.revokeObjectURL(old.url); return null; }); };
  const set = (x: Partial<ExportOptions>) => setO((p) => { const n = { ...p!, ...x }; if (job) saveOptions(job.kind, n); return n; });
  const exporting = prog !== null;

  const download = async () => {
    if (!job || !o || exporting) return;
    setProg([0, 1]); setErr(null);
    try {
      const r = await runExport(job, withBg(job, o), (d, n) => setProg([d, n]));
      await downloadBlob(r.blob, r.file);
      const url = URL.createObjectURL(r.blob);
      setTimeout(() => URL.revokeObjectURL(url), 120000);
      const count = r.pages ? ` · ${r.file.endsWith(".zip") ? t("{n} files", { n: r.pages }) : r.pages === 1 ? t("1 page") : t("{n} pages", { n: r.pages })}` : "";
      // browsers can't open the Downloads folder: "Show in Files" opens the saved file itself
      toast(`${t("Saved")} ${r.file}${count} · ${fmtBytes(r.blob.size).replace("≈ ", "")}`, { label: t("Show in Files"), run: () => { window.open(url, "_blank"); } }, { icon: "check" });
    } catch (e) { setErr((e as Error).message); toast((e as Error).message); }
    finally { setProg(null); }
  };

  const copy = async (what: "png" | "svg" | "source" | "markdown" | "link") => {
    if (!job || !o) return;
    setCopyOpen(false);
    try {
      const oo = withBg(job, o);
      const ids = oo.scope === "frames" || oo.scope === "groups" || oo.scope === "layers" ? oo.ids : [];
      if (what === "png") { const u = await renderUnit(job, { ...oo, format: "png" }, ids, "png"); await copyImage(u.blob!); toast(t("Image copied")); }
      else if (what === "svg") { const u = await renderUnit(job, { ...oo, format: "svg" }, ids, "svg"); await navigator.clipboard.writeText(u.svg!); toast(t("SVG code copied")); }
      else if (what === "source") { const v = await job.source!(); await navigator.clipboard.writeText(typeof v === "string" ? v : await v.text()); toast(t("Source copied")); }
      else if (what === "markdown") { const v = await job.markdown!(oo); await navigator.clipboard.writeText(typeof v === "string" ? v : v.text); toast(t("Markdown copied")); }
      else { await navigator.clipboard.writeText(job.link!); toast(t("Link copied")); }
    } catch (e) { toast((e as Error).message); }
  };

  useEffect(() => {
    if (!job) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); if (copyOpen) setCopyOpen(false); else close(); }
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c" && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); void copy("png"); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  const view = useMemo(() => {
    if (!job || !o) return null;
    const kind = job.kind, has = (s: ExportScope) => job.scopes.includes(s);
    const frames = job.pickers?.frames, groups = job.pickers?.groups, layers = job.pickers?.layers;
    const fourth: { id: ExportScope; g: string; l: string; list?: typeof frames } = frames ? { id: "frames", g: "scope-frame", l: `${t("Frames")} · ${o.scope === "frames" ? o.ids.length : frames.length}`, list: frames }
      : kind === "architecture" ? { id: "layers", g: "layers", l: t("Layer / C4 level"), list: layers } : { id: "groups", g: "group", l: t("Groups"), list: groups };
    const wholeL = kind === "canvas" ? t("Whole canvas") : kind === "mermaid" || kind === "architecture" ? t("Whole diagram") : kind === "graph" ? t("Whole graph") : t("Whole board");
    const picker = o.scope === "frames" ? frames : o.scope === "groups" ? groups : o.scope === "layers" ? layers : undefined;
    const cols4 = phone ? "repeat(2,1fr)" : "repeat(4,1fr)";
    const f = o.format, imgOk = (x: string) => !job.imageFormats || job.imageFormats.includes(x as never);
    const isImg = isImageFormat(f), lossy = f === "jpeg" || f === "webp";
    const fmts: Cell[] = [
      ...(["png", "jpeg", "webp"] as const).map((x): Cell => ({ g: "image", l: x === "png" ? "PNG" : x === "jpeg" ? "JPEG" : "WebP", on: f === x, col: true, mh: "50px", op: imgOk(x) ? 1 : 0.4, onClick: () => set({ format: x }) })),
      { g: "vector", l: "SVG", on: f === "svg", col: true, mh: "50px", op: imgOk("svg") ? 1 : 0.4, onClick: () => set({ format: "svg" }) },
      { g: "pdf", l: "PDF", on: f === "pdf", col: true, mh: "50px", op: imgOk("pdf") ? 1 : 0.4, onClick: () => set({ format: "pdf" }) },
      { g: "code", l: t("Source"), sub: phone ? "" : job.sourceExt ?? "", on: f === "source", col: true, mh: "50px", op: job.source ? 1 : 0.4, onClick: () => set({ format: "source" }) },
      { g: "markdown", l: "Markdown", on: f === "markdown", col: true, mh: "50px", op: job.markdown ? 1 : 0.4, onClick: () => set({ format: "markdown" }) },
      { g: "mermaid", l: "Mermaid", sub: phone || !(kind === "whiteboard" || kind === "board") ? "" : t("best effort"), on: f === "mermaid", col: true, mh: "50px", op: job.mermaid ? 1 : 0.4, onClick: () => set({ format: "mermaid" }) },
      ...(job.formats ?? []).map((p): Cell => ({ g: p.glyph, l: p.label, sub: phone ? "" : p.sub, on: f === p.id, col: true, mh: "50px", onClick: () => set({ format: p.id }) })),
      { g: "globe", l: "HTML", tag: t("Later"), col: true, mh: "50px", op: 0.55, tip: t("Interactive read-only HTML export is planned") },
    ];
    const blocks: Block[] = [
      { h: t("Preset"), cols: cols4, items: PRESETS.map((p): Cell => ({ g: p.g, l: p.l(), on: (Object.keys(p.set) as (keyof ExportOptions)[]).every((k) => o[k] === p.set[k]), onClick: () => set(p.set) })) },
      { h: t("Scope"), cols: cols4, items: [
        { g: "board", l: wholeL, on: o.scope === "whole", onClick: () => set({ scope: "whole", ids: [] }) },
        { g: "scope-selection", l: t("Selection"), on: o.scope === "selection", op: has("selection") ? 1 : 0.4, onClick: () => set({ scope: "selection", ids: [] }) },
        { g: "scope-visible", l: t("Visible area"), on: o.scope === "visible", op: has("visible") ? 1 : 0.4, onClick: () => set({ scope: "visible", ids: [] }) },
        { g: fourth.g, l: fourth.l, on: o.scope === fourth.id, op: has(fourth.id) && fourth.list?.length ? 1 : 0.4, onClick: () => set({ scope: fourth.id, ids: o.scope === fourth.id ? o.ids : fourth.list!.map((x) => x.id) }) },
      ] },
      ...(picker ? [{ cols: "repeat(5,1fr)", items: picker.map((p, i): Cell => ({ th: "1", thumb: p.thumb, l: `${i + 1} ${p.name}`, col: true, on: o.ids.includes(p.id), mh: "56px", onClick: () => { const on = o.ids.includes(p.id); if (on && o.ids.length === 1) return; set({ ids: picker.map((x) => x.id).filter((x) => (x === p.id ? !on : o.ids.includes(x))) }); } })) } as Block] : []),
      { h: t("Format"), cols: phone ? "repeat(4,1fr)" : "repeat(6,1fr)", items: fmts },
    ];
    const lim = pv?.limited && isImg && f !== "svg";
    const warn: string | null = lim ? t("Limited to {n}× by the browser for a board this size ({w} px wide).", { n: fmtNum(Math.floor(pv!.limited! * 10) / 10), w: fmtNum(Math.round(pv!.width / Math.max(pv!.scale, 0.01))) })
      : job.media && (job.media.videos || job.media.gifs) && isImg ? t(o.media === "still" ? "{what} can't animate in images. They'll export as a still frame." : "{what} can't animate in images. They'll export as a placeholder.", { what: mediaWhat(job.media) }) : null;
    if (warn) blocks.splice(3, 0, { note: warn, noteC: "var(--warning)", noteBg: "color-mix(in srgb,var(--warning) 12%,transparent)" });
    if (f === "pdf") blocks.push(
      { seg: [t("One page per frame"), t("Single page")], segOn: o.pdfMode === "per-frame" ? 0 : 1, segPick: (i) => set({ pdfMode: i === 0 ? "per-frame" : "single" }) },
      { cols: "1fr 1fr 1fr", items: [
        { l: t("Page"), sub: `${({ fit: t("Fit"), a4: "A4", letter: "Letter", "16:9": "16:9" })[o.pdfPage]} ▾`, pick: { value: o.pdfPage, options: [["fit", t("Fit")], ["a4", "A4"], ["letter", "Letter"], ["16:9", "16:9"]], onChange: (v) => set({ pdfPage: v as ExportOptions["pdfPage"] }) } },
        { l: t("Orientation"), sub: `${o.pdfOrient === "landscape" ? t("Landscape") : t("Portrait")} ▾`, pick: { value: o.pdfOrient, options: [["landscape", t("Landscape")], ["portrait", t("Portrait")]], onChange: (v) => set({ pdfOrient: v as ExportOptions["pdfOrient"] }) } },
        { l: t("Margins"), sub: `${o.pdfMargin} mm ▾`, pick: { value: String(o.pdfMargin), options: [0, 6, 12, 20].map((n) => [String(n), `${n} mm`] as [string, string]), onChange: (v) => set({ pdfMargin: +v }) } },
      ] });
    const nameCell: Cell = { l: t("File name"), input: <input value={o.fileName} onChange={(e) => set({ fileName: e.target.value })} onClick={(e) => e.stopPropagation()} aria-label={t("File name")} dir="ltr" style={{ flex: 1, minWidth: 0, textAlign: "end", background: "transparent", border: 0, outline: 0, color: "var(--muted)", fontSize: 10.5, fontFamily: "inherit" }} /> };
    if (f === "mermaid") blocks.push({ h: t("Mermaid kind"), seg: (job.mermaidKinds ?? ["flowchart"]).map((k) => MK_LABEL[k] ?? k), segOn: Math.max(0, (job.mermaidKinds ?? ["flowchart"]).indexOf(o.mermaidKind)), segPick: (i) => set({ mermaidKind: (job.mermaidKinds ?? ["flowchart"])[i] }), note: job.mermaidNote ?? (kind === "architecture" ? t("Groups become groups, junctions stay. Positions are not kept; Mermaid lays out by itself.") : t("Best effort: only boxes, diamonds and arrows convert. Ink and images are skipped.")), noteBg: "var(--surface-2)" });
    if (isImg) {
      const themes: [string, string][] = [["app", t("Match app")], ["default", t("Paper")], ["dark", t("Lamplight")], ...(kind === "mermaid" ? [["neutral", t("Neutral")], ["forest", t("Forest")]] as [string, string][] : [])];
      const themeL = themes.find((x) => x[0] === o.theme)?.[1] ?? "";
      const ct = job.content ?? [];
      const tg = (k: "groupLabels" | "edgeLabels" | "frameNames" | "hiddenLayers", l: string): Cell => ({ l, tog: o[k], onClick: () => set({ [k]: !o[k] }) });
      blocks.push(
        { h: t("Look · scale"), seg: ["1×", "2×", "3×", "4×", t("Max px")], segOn: SCALES.indexOf(o.scale), segPick: (i) => set({ scale: SCALES[i] }) },
        { seg: [t("Transparent"), t("Theme"), t("Custom"), t("Board bg")], segOn: ["transparent", "theme", "custom", "board"].indexOf(o.background), segPick: (i) => set({ background: (["transparent", "theme", "custom", "board"] as const)[i] }) },
        { cols: phone ? "1fr" : "1fr 1fr", gap: "4px 12px", items: [
          { l: t("Include pattern (dots/grid)"), tog: o.pattern, op: job.hasPattern ? 1 : 0.45, onClick: () => job.hasPattern && set({ pattern: !o.pattern }) },
          { l: t("Theme"), sub: `${themeL} ▾`, op: job.themable === false ? 0.45 : 1, pick: { value: o.theme, options: themes, onChange: (v) => set({ theme: v as ExportOptions["theme"] }) } },
          { l: t("Padding"), sub: t("{n} px", { n: o.padding }), sli: [o.padding, 0, 96, (v) => set({ padding: v })] },
          { l: t("Quality"), sub: lossy ? `${Math.round(o.quality * 100)}%` : t("lossless"), op: lossy ? 1 : 0.45, sli: [Math.round(o.quality * 100), 50, 100, (v) => set({ quality: v / 100 })] },
          ...(o.background === "custom" ? [{ l: t("Colour"), input: <input type="color" value={o.color} onChange={(e) => set({ color: e.target.value })} aria-label={t("Any colour")} style={{ width: 34, height: 22, border: "1px solid var(--border)", borderRadius: 5, background: "transparent", padding: 0, marginInlineStart: "auto" }} /> } as Cell] : []),
          ...(o.scale === "max" ? [{ l: t("Longest side"), sub: `${fmtNum(o.maxPx)} px ▾`, pick: { value: String(o.maxPx), options: [1024, 2048, 4096, 8192, 16384].map((n) => [String(n), `${fmtNum(n)} px`] as [string, string]), onChange: (v: string) => set({ maxPx: +v }) } } as Cell] : []),
        ] },
        { h: t("Content"), cols: phone ? "1fr" : "1fr 1fr", gap: "4px 12px", items: [
          ...(ct.includes("cardStyle") ? [{ l: t("Card style"), sub: `${({ screen: t("As on screen"), flat: t("Flat"), print: t("Print") })[o.cardStyle]} ▾`, pick: { value: o.cardStyle, options: [["screen", t("As on screen")], ["flat", t("Flat")], ["print", t("Print")]], onChange: (v: string) => set({ cardStyle: v as ExportOptions["cardStyle"] }) } } as Cell] : []),
          ...(ct.includes("groupLabels") ? [tg("groupLabels", t("Group labels"))] : []),
          ...(ct.includes("edgeLabels") ? [tg("edgeLabels", t("Edge labels"))] : []),
          ...(ct.includes("frameNames") ? [tg("frameNames", t("Frame names"))] : []),
          ...(ct.includes("hiddenLayers") ? [tg("hiddenLayers", t("Hidden layers"))] : []),
          ...(ct.includes("media") ? [{ l: t("Media"), sub: `${o.media === "still" ? t("Still frame") : t("Placeholder")} ▾`, pick: { value: o.media, options: [["still", t("Still frame")], ["placeholder", t("Placeholder")]], onChange: (v: string) => set({ media: v as ExportOptions["media"] }) } } as Cell] : []),
          ...(ct.includes("embedScene") ? [{ l: t("Embed scene data"), tog: o.embedScene, op: f === "svg" || f === "png" ? 1 : 0.45, onClick: () => set({ embedScene: !o.embedScene }) } as Cell] : []),
          nameCell,
        ] },
      );
    } else if (f === "markdown" || f === "md-table") {
      blocks.push({ h: "Markdown", cols: "1fr 1fr", items: [
        { l: t("Outline of text and links"), tog: o.mdOutline, onClick: () => set({ mdOutline: !o.mdOutline }) },
        { l: t("Images as attachments"), tog: o.mdAttachments, onClick: () => set({ mdAttachments: !o.mdAttachments }) },
        ...(kind === "architecture" ? [{ l: t("Component table"), tog: o.mdTable, onClick: () => set({ mdTable: !o.mdTable }) } as Cell] : []),
        { l: t("Include Mermaid block"), tog: o.mdMermaid, onClick: () => set({ mdMermaid: !o.mdMermaid }) },
        nameCell,
      ] });
    } else blocks.push({ cols: "1fr", items: [nameCell] });
    return { blocks, isImg };
  }, [job, o, pv, phone]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!job || !o || !view) return null;
  const f = o.format;
  const textFmt = !view.isImg;
  const transparent = view.isImg && !resolveBg(job, o);
  const dims = textFmt ? t("Text file") : pv && pv.width ? `${fmtNum(Math.round(pv.width))} × ${fmtNum(Math.round(pv.height))} px${f !== "svg" && o.scale !== 1 ? ` (${fmtNum(Math.round(pv.scale * 10) / 10)}×)` : ""}${f === "svg" ? ` · ${t("vector")}` : ""}` : t("Rendering…");
  const est = !pv ? "" : textFmt ? `${fmtBytes(pv.bytes)} ${t("text")}` : f === "pdf" ? `${t("{n} pages", { n: pv.count })} · ${fmtBytes(pv.bytes)}` : pv.count > 1 ? `${t("{n} files", { n: pv.count })} · ${fmtBytes(pv.bytes)}` : fmtBytes(pv.bytes);
  const lines = (pv?.text ?? "").split("\n").slice(0, 8);
  const copyItems: [string, string, string, () => void, boolean][] = [
    ["copy-image", t("Copy PNG"), shortcut("C"), () => void copy("png"), !job.imageFormats || job.imageFormats.includes("png")],
    ["vector", t("Copy SVG"), "", () => void copy("svg"), !job.imageFormats || job.imageFormats.includes("svg")],
    ["code", t("Copy source"), "", () => void copy("source"), !!job.source],
    ["markdown", t("Copy as Markdown"), "", () => void copy("markdown"), !!job.markdown],
    ["link", t("Copy link"), job.link ? t("shared") : "", () => void copy("link"), !!job.link],
  ];
  const n = prog?.[1] ?? 0;
  return (
    <div className="fixed inset-0 z-[70] text-[13px]" style={{ color: "var(--text)", fontFamily: "Inter,system-ui,sans-serif", animation: "lm-fade .16s var(--ease)" }}>
      <style>{`@keyframes lm-fade{from{opacity:0}to{opacity:1}}@keyframes lm-pop{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}@keyframes lm-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}@keyframes lm-spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.5)" }} onClick={close} />
      <div role="dialog" aria-label={t("Export")} style={{ position: "absolute", left: phone ? 0 : "max(16px,calc(50% - 570px))", right: phone ? 0 : "max(16px,calc(50% - 570px))", top: phone ? 40 : 36, bottom: phone ? 0 : 36, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: phone ? "20px 20px 0 0" : 14, boxShadow: "0 30px 80px rgba(0,0,0,.45)", display: "flex", flexDirection: "column", overflow: "hidden", animation: `${phone ? "lm-rise" : "lm-pop"} .2s var(--ease)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <Glyph name={g(KIND_G[job.kind] ?? "export")} size={18} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>{t("Export")}</span>
          <span style={{ color: "var(--muted)", fontSize: 13, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{job.title}</span>
          <button aria-label={t("Close")} onClick={close} style={{ fontSize: 16, color: "var(--muted)", background: "none", border: 0, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: "flex", flexDirection: phone ? "column" : "row", flex: 1, minHeight: 0, overflowY: phone ? "auto" : "visible" }}>
          <div style={{ flex: phone ? "0 0 auto" : "1.1", display: "flex", flexDirection: "column", gap: 10, padding: 16, minWidth: 0, borderInlineEnd: phone ? "none" : "1px solid var(--border)", borderBottom: phone ? "1px solid var(--border)" : "none", ...(phone ? { position: "sticky", top: 0, background: "var(--surface)", zIndex: 2 } : {}) }}>
            <div style={{ flex: 1, minHeight: phone ? 200 : 0, borderRadius: 10, border: "1px solid var(--border)", position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: transparent ? CHECKER : "var(--surface-2)" }}>
              {textFmt ? (
                <div style={{ width: "70%", background: "var(--bg)", boxShadow: "0 0 0 1px color-mix(in srgb,var(--muted) 30%,transparent)", padding: 18, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 6, alignItems: "center", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "var(--muted)", overflow: "hidden", minHeight: 120 }}>
                  {lines.map((l, i) => <span key={i} style={{ whiteSpace: "pre", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", color: i === 0 ? "var(--text)" : "var(--muted)", fontWeight: i === 0 ? 500 : 400, fontSize: i === 0 ? 13 : 12 }}>{l}</span>)}
                </div>
              ) : pv?.url ? (
                <img src={pv.url} alt={t("Export preview")} style={{ maxWidth: "86%", maxHeight: "86%", objectFit: "contain", boxShadow: "0 0 0 1px color-mix(in srgb,var(--muted) 30%,transparent)", opacity: exporting ? 0.5 : 1, transition: "opacity .2s" }} />
              ) : null}
              {(exporting || (busy && !pv)) && (
                <div style={{ position: "absolute", inset: 0, background: "color-mix(in srgb,var(--surface) 70%,transparent)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 12.5, color: "var(--muted)", animation: "lm-fade .15s" }}>
                  <span style={{ width: 26, height: 26, borderRadius: "50%", border: "3px solid var(--border)", borderTopColor: "var(--accent)", animation: "lm-spin .8s linear infinite" }} />
                  {exporting && n > 1 ? t("Rendering {n} frames… {i} of {n}", { n, i: Math.min(n, (prog?.[0] ?? 0) + 1) }) : t("Rendering…")}
                </div>
              )}
              {busy && pv && !exporting && <span style={{ position: "absolute", insetInlineEnd: 8, top: 8, width: 14, height: 14, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--accent)", animation: "lm-spin .8s linear infinite" }} />}
              {err && <div style={{ position: "absolute", insetInline: 12, bottom: 12, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--danger)", background: "color-mix(in srgb,var(--danger) 14%,var(--surface))" }}>{err} <button onClick={() => set({})} style={{ textDecoration: "underline", background: "none", border: 0, color: "inherit" }}>{t("Retry")}</button></div>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--muted)", flexWrap: "wrap" }}><span>{dims}</span><span>·</span><span>{est}</span><span style={{ flex: 1 }} /><span>{t("Preview at fit")}</span></div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, padding: "16px 18px", minWidth: 0, overflow: phone ? "visible" : "auto", scrollbarWidth: "none" }}>
            {view.blocks.map((b, i) => <BlockView key={i} b={b} />)}
          </div>
        </div>
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", borderTop: "1px solid var(--border)", flexWrap: "wrap", background: "var(--surface)" }}>
          <span style={{ fontSize: 12, color: "var(--muted)", flex: 1, minWidth: phone ? 120 : 160 }}>{exporting ? t("Rendering off the main thread; you can keep working.") : t("Remembers these settings for {kind}.", { kind: (KIND_FOOT[job.kind] ?? (() => ""))() })}</span>
          <button onClick={() => setCopyOpen((x) => !x)} aria-haspopup="menu" aria-expanded={copyOpen} style={{ height: 36, padding: "0 14px", borderRadius: 9, display: "flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", fontSize: 13, background: copyOpen ? "var(--surface-2)" : "transparent", color: "var(--text)" }}>{t("Copy")} ▾</button>
          <button disabled={exporting || (busy && !pv)} onClick={() => void download()} style={{ height: 36, padding: "0 16px", borderRadius: 9, display: "flex", alignItems: "center", gap: 8, background: "var(--accent)", color: "var(--accent-fg)", fontWeight: 600, fontSize: 13, border: 0, opacity: exporting ? 0.6 : 1, transition: "opacity .15s,filter .15s" }}>
            <Glyph name={g("export")} size={16} />{exporting ? t("Rendering…") : t("Download")}
          </button>
          {copyOpen && (
            <div role="menu" style={{ position: "absolute", right: phone ? 18 : 150, bottom: 56, width: 230, padding: 6, borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--border)", boxShadow: "0 14px 36px rgba(0,0,0,.35)", display: "flex", flexDirection: "column", animation: "lm-pop .14s var(--ease)", zIndex: 6 }}>
              {copyItems.map(([gl, l, k, run, ok]) => (
                <button key={l} role="menuitem" disabled={!ok} onClick={run} className="hover:bg-[var(--surface)]" style={{ display: "flex", alignItems: "center", gap: 10, height: 34, padding: "0 10px", borderRadius: 7, fontSize: 12.5, opacity: ok ? 1 : 0.4, background: "transparent", border: 0, color: "var(--text)", textAlign: "start" }}>
                  <Glyph name={g(gl)} size={16} color="var(--muted)" /><span style={{ flex: 1 }}>{l}</span><span style={{ fontSize: 11, color: "var(--muted)" }}>{k}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
