import { useEffect, useMemo, useRef, useState } from "react";
import { fmtNum, t } from "../lib/i18n";
import { loadNoteExportPrefs, saveNoteExportPrefs, type NoteExportJob, type NoteExportPrefs, type ScopeKey } from "../lib/note-export";
import type { PrintDoc } from "../lib/print-doc";
import { PAPER_MM } from "../lib/print-css";
import { collectScope, isCancel, previewDoc, runExport, type ExportRequest, type Format } from "../lib/print-run";
import { toast } from "../lib/store";
import { BlockView, type Block, type Cell } from "./DiagramExport";
import { Glyph } from "./Glyph";

// The note Export dialog: same look and building blocks as the visual Export dialog (DiagramExport). Settings are remembered per device.
const usePhone = () => {
  const [p, setP] = useState(() => matchMedia("(max-width: 767px)").matches);
  useEffect(() => { const m = matchMedia("(max-width: 767px)"); const f = () => setP(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return p;
};
const MM_PX = 96 / 25.4;
const FORMATS: { id: Format; g: string; l: () => string; sub: () => string }[] = [
  { id: "pdf", g: "pdf", l: () => "PDF", sub: () => t("file") },
  { id: "html", g: "globe", l: () => "HTML", sub: () => t("self-contained") },
  { id: "md", g: "markdown", l: () => "Markdown", sub: () => t("source") },
  { id: "print", g: "print", l: () => t("Print"), sub: () => t("dialog") },
];
const SCOPE_G: Record<ScopeKey, string> = { note: "note", selection: "scope-selection", folder: "folder", space: "layers" };
const SCOPE_L: Record<ScopeKey, () => string> = { note: () => t("This note"), selection: () => t("Selected notes"), folder: () => t("Folder"), space: () => t("Space") };

export default function NoteExport({ job, onClose }: { job: NoteExportJob; onClose: () => void }) {
  const phone = usePhone();
  const [o, setO] = useState<NoteExportPrefs>(() => ({ ...loadNoteExportPrefs(), ...(job.format ? { format: job.format } : {}) }));
  const [scopeKey, setScopeKey] = useState<ScopeKey>(job.start);
  const [fileName, setFileName] = useState("");
  const [counts, setCounts] = useState<Partial<Record<ScopeKey, number>>>({});
  const [pv, setPv] = useState<{ html: string; paged: boolean; doc: PrintDoc } | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [prog, setProg] = useState<[number, number] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);
  const run = useRef<AbortController | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const [paneW, setPaneW] = useState(0);
  const sc = job.scopes[scopeKey] ?? job.scopes[job.start]!;
  const multi = scopeKey !== "note" && (counts[scopeKey] ?? 2) > 1;
  const set = (x: Partial<NoteExportPrefs>) => setO((p) => { const n = { ...p, ...x }; saveNoteExportPrefs(n); return n; });

  // how many notes each scope holds (shown on the scope tiles)
  useEffect(() => {
    let live = true;
    void (async () => {
      const out: Partial<Record<ScopeKey, number>> = {};
      for (const [k, v] of Object.entries(job.scopes)) { try { out[k as ScopeKey] = (await collectScope(v.scope)).notes.length; } catch { /* leave blank */ } }
      if (live) setCounts(out);
    })();
    return () => { live = false; };
  }, [job]);

  const req = (): ExportRequest => ({ format: o.format, scope: sc.scope, opts: o, htmlFolder: o.htmlFolder, engine: o.engine, fileName });
  const key = JSON.stringify({ ...o, htmlFolder: 0, engine: 0, sc: sc.scope });

  // live preview (debounced; a newer request cancels the older one)
  useEffect(() => {
    const my = ++seq.current;
    const ctl = new AbortController();
    setBusy(true); setErr(null); setPages(null);
    const tm = setTimeout(async () => {
      try {
        const r = await previewDoc(req(), { signal: ctl.signal });
        if (my !== seq.current) return;
        setPv(r);
      } catch (e) { if (my === seq.current && !isCancel(e)) { setErr((e as Error).message); setPv(null); } }
      finally { if (my === seq.current) setBusy(false); }
    }, 380);
    return () => { clearTimeout(tm); ctl.abort(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Paged.js reports its page count from inside the preview frame
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || typeof e.data !== "object" || !("lumenPaged" in e.data)) return;
      const d = e.data as { lumenPaged: string; pages: number };
      setPages(d.lumenPaged === "done" ? d.pages || 0 : -1);
    };
    addEventListener("message", on);
    return () => removeEventListener("message", on);
  }, []);
  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPaneW(el.clientWidth));
    ro.observe(el); setPaneW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const cancel = () => { run.current?.abort(); };
  const close = () => { run.current?.abort(); seq.current++; onClose(); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); if (working) cancel(); else close(); } };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  const go = async (engine: ExportRequest["engine"], format: Format = o.format) => {
    if (working) return;
    const ctl = new AbortController();
    run.current = ctl;
    setWorking(t("Preparing the document…")); setErr(null); setProg([0, 1]);
    try {
      const r = await runExport({ ...req(), format, engine }, { signal: ctl.signal, onProgress: (d, n) => setProg([d, n]), notify: setWorking });
      const w = r.warnings;
      const notes = [
        w?.imagesMissing ? t("{n} image(s) not available offline", { n: w.imagesMissing }) : "",
        w?.diagramsFallback ? t("{n} diagram(s) shown as code", { n: w.diagramsFallback }) : "",
        w?.fonts ? t("fonts not embedded (offline)") : "",
        r.skipped ? t("{n} item(s) skipped (not text notes)", { n: r.skipped }) : "",
      ].filter(Boolean).join(" · ");
      const head = r.file ? `${t("Saved")} ${r.file}` : format === "print" || r.engine ? t("Opened the print dialog") : t("Done");
      toast([head, r.fellBack, notes].filter(Boolean).join(" · "), undefined, { icon: "check" });
      if (r.file || r.engine) onClose();
    } catch (e) {
      if (isCancel(e)) toast(t("Export cancelled"));
      else { setErr((e as Error).message); toast((e as Error).message); }
    } finally { setWorking(null); setProg(null); run.current = null; }
  };

  const view = useMemo(() => {
    const f = o.format;
    const paged = f === "pdf" || f === "print";
    const cols4 = phone ? "repeat(2,1fr)" : "repeat(4,1fr)";
    const tog = (l: string, k: keyof NoteExportPrefs, extra: Partial<Cell> = {}): Cell => ({ l, tog: !!o[k], onClick: () => set({ [k]: !o[k] } as Partial<NoteExportPrefs>), ...extra });
    const pick = (l: string, value: string, options: [string, string][], onChange: (v: string) => void): Cell => ({ l, sub: `${options.find((x) => x[0] === value)?.[1] ?? ""} ▾`, pick: { value, options, onChange } });
    const keys = (Object.keys(job.scopes) as ScopeKey[]);
    const blocks: Block[] = [
      { h: t("Format"), cols: cols4, items: FORMATS.map((x): Cell => ({ g: x.g, l: x.l(), sub: phone ? "" : x.sub(), on: f === x.id, col: true, mh: "50px", onClick: () => set({ format: x.id }) })) },
      { h: t("Scope"), cols: keys.length > 2 && !phone ? `repeat(${keys.length},1fr)` : "1fr 1fr", items: keys.map((k): Cell => ({ g: SCOPE_G[k], l: SCOPE_L[k](), sub: counts[k] !== undefined ? fmtNum(counts[k]!) : "", on: scopeKey === k, onClick: () => setScopeKey(k) })) },
    ];
    if (f === "html" && multi) blocks.push({ cols: "1fr", items: [tog(t("One page per note, as a folder (.zip)"), "htmlFolder")] });
    if (paged) blocks.push({ h: t("Paper"), cols: "1fr 1fr", items: [
      pick(t("Paper"), o.paper, [["a4", "A4"], ["letter", "Letter"], ["a5", "A5"]], (v) => set({ paper: v as NoteExportPrefs["paper"] })),
      pick(t("Orientation"), o.landscape ? "l" : "p", [["p", t("Portrait")], ["l", t("Landscape")]], (v) => set({ landscape: v === "l" })),
      pick(t("Margins"), String(o.marginMm), [10, 15, 18, 25].map((n) => [String(n), `${n} mm`] as [string, string]), (v) => set({ marginMm: +v })),
      pick(t("Font size"), String(o.fontPt), [9, 10, 10.5, 11, 12].map((n) => [String(n), `${n} pt`] as [string, string]), (v) => set({ fontPt: +v })),
    ] });
    if (f !== "md") blocks.push({ h: t("Theme"), seg: [t("Paper"), t("As on screen"), t("Black & white")], segOn: ["paper", "screen", "bw"].indexOf(o.theme), segPick: (i) => set({ theme: (["paper", "screen", "bw"] as const)[i] }),
      note: o.theme === "screen" ? t("Keeps the app's colours (dark themes print with a dark background).") : o.theme === "bw" ? t("High contrast, for a black-and-white printer.") : undefined });
    if (f !== "md") blocks.push({ h: t("Include"), cols: phone ? "1fr" : "1fr 1fr", gap: "4px 12px", items: [
      tog(t("Title page"), "titlePage"),
      tog(paged ? t("Table of contents with page numbers") : t("Table of contents"), "toc"),
      ...(paged ? [tog(t("Page numbers"), "pageNumbers"), tog(t("Header and footer"), "headerFooter", { tip: t("title · date · page X of Y") })] : []),
      tog(t("Front matter and properties"), "frontMatter"),
      ...(paged ? [tog(t("Break before each H1"), "breakH", { tog: o.breakH === "h1", onClick: () => set({ breakH: o.breakH === "h1" ? "none" : "h1" }) }), tog(t("Break before each H2"), "breakH", { tog: o.breakH === "h2", onClick: () => set({ breakH: o.breakH === "h2" ? "none" : "h2" }) })] : []),
      ...(multi ? [{ l: t("Each note on a new page"), tog: true, op: 0.6 } as Cell] : paged ? [tog(t("Each note on a new page"), "newPagePerNote")] : []),
      pick(t("Links"), o.links, [["footnote", t("Numbered footnotes")], ["inline", t("URL after the link")], ["none", t("Text only")]], (v) => set({ links: v as NoteExportPrefs["links"] })),
      pick(t("Media"), o.media, [["poster", t("Poster, title, URL")], ["qr", t("Poster and QR code")], ["text", t("Title and URL")]], (v) => set({ media: v as NoteExportPrefs["media"] })),
      pick(t("Flashcard answers"), o.answers, [["show", t("Shown")], ["hide", t("Hidden")], ["key", t("Answer key at the end")]], (v) => set({ answers: v as NoteExportPrefs["answers"] })),
    ] });
    return { blocks, paged };
  }, [o, counts, scopeKey, multi, phone, job]); // eslint-disable-line react-hooks/exhaustive-deps

  const f = o.format;
  const [pw, ph] = PAPER_MM[o.paper];
  const pageW = (o.landscape ? ph : pw) * MM_PX + 56;
  const htmlW = 980;
  const frameW = view.paged && pv?.paged ? pageW : f === "html" ? htmlW : pageW;
  const scale = paneW ? Math.min(1, (paneW - 4) / frameW) : 0.5;
  const w = pv?.doc.warnings;
  const warn = [
    w?.imagesMissing ? t("{n} image(s) not available offline", { n: w.imagesMissing }) : "",
    w?.diagramsFallback ? t("{n} diagram(s) shown as code", { n: w.diagramsFallback }) : "",
    w?.fonts ? t("fonts not embedded (offline)") : "",
    w?.skippedNotes ? t("{n} item(s) skipped (not text notes)", { n: w.skippedNotes }) : "",
  ].filter(Boolean).join(" · ");
  const note = (Object.keys(job.scopes).length ? counts[scopeKey] : undefined);
  const primary = f === "pdf" ? t("Download PDF") : f === "html" ? (multi && o.htmlFolder ? t("Download folder (.zip)") : t("Download HTML")) : f === "md" ? t("Download Markdown") : t("Print");
  const nameCell: Cell = { l: t("File name"), input: <input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder={sc.title} dir="auto" aria-label={t("File name")} style={{ flex: 1, minWidth: 0, textAlign: "end", background: "transparent", border: 0, outline: 0, color: "var(--muted)", fontSize: 12.5 }} /> };
  const exporting = working !== null;

  return (
    <div className="fixed inset-0 z-[70] text-[13px]" style={{ color: "var(--text)", fontFamily: "Inter,system-ui,sans-serif", animation: "lm-fade .16s var(--ease)" }} data-note-export>
      <style>{`@keyframes lm-fade{from{opacity:0}to{opacity:1}}@keyframes lm-spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.5)" }} onClick={close} />
      <div role="dialog" aria-label={t("Export")} style={{ position: "absolute", left: phone ? 0 : "max(16px,calc(50% - 570px))", right: phone ? 0 : "max(16px,calc(50% - 570px))", top: phone ? 0 : 36, bottom: phone ? 0 : 36, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: phone ? 0 : 16, boxShadow: "0 24px 70px rgba(0,0,0,.5)", display: "flex", flexDirection: "column", overflow: "hidden", animation: "lm-fade .18s var(--ease)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <Glyph name="export" size={18} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>{t("Export")}</span>
          <span dir="auto" style={{ color: "var(--muted)", fontSize: 13, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sc.title}{note !== undefined && note > 1 ? ` · ${t("{n} notes", { n: fmtNum(note) })}` : ""}</span>
          <button aria-label={t("Close")} onClick={close} style={{ fontSize: 18, color: "var(--muted)", background: "none", border: 0, lineHeight: 1, padding: 6 }}>×</button>
        </div>
        <div style={{ display: "flex", flexDirection: phone ? "column" : "row", flex: 1, minHeight: 0, overflowY: phone ? "auto" : "visible" }}>
          <div style={{ flex: phone ? "0 0 auto" : "1.1", display: "flex", flexDirection: "column", gap: 10, padding: 16, minWidth: 0, borderInlineEnd: phone ? "none" : "1px solid var(--border)", borderBottom: phone ? "1px solid var(--border)" : "none" }}>
            <div ref={pane} style={{ flex: 1, minHeight: phone ? 260 : 0, height: phone ? 300 : undefined, borderRadius: 10, border: "1px solid var(--border)", position: "relative", overflow: "hidden", background: "var(--surface-2)", direction: "ltr" }}>
              {f === "md" ? (
                <div style={{ padding: 20, color: "var(--muted)", fontSize: 13, lineHeight: "20px" }}>{multi ? t("A .zip with one Markdown file per note, plus the attachments they use.") : t("The note as a Markdown file, with its front matter.")}</div>
              ) : pv ? (
                <iframe ref={frame} key={pv.html.length + String(pv.paged)} title={t("Export preview")} sandbox="allow-scripts" srcDoc={pv.html} style={{ border: 0, width: frameW, height: scale ? (pane.current?.clientHeight ?? 500) / scale : 500, transform: `scale(${scale})`, transformOrigin: "top left", background: "transparent", opacity: exporting ? 0.5 : 1 }} />
              ) : null}
              {(exporting || (busy && !pv)) && (
                <div style={{ position: "absolute", inset: 0, background: "color-mix(in srgb,var(--surface) 70%,transparent)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 12.5, color: "var(--muted)" }}>
                  <span style={{ width: 26, height: 26, borderRadius: "50%", border: "3px solid var(--border)", borderTopColor: "var(--accent)", animation: "lm-spin .8s linear infinite" }} />
                  <span style={{ maxWidth: "80%", textAlign: "center" }}>{working ?? t("Rendering…")}{exporting && prog && prog[1] > 1 ? ` ${prog[0]}/${prog[1]}` : ""}</span>
                  {exporting && <button onClick={cancel} style={{ height: 30, padding: "0 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 12.5 }}>{t("Cancel")}</button>}
                </div>
              )}
              {busy && pv && !exporting && <span style={{ position: "absolute", insetInlineEnd: 8, top: 8, width: 14, height: 14, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--accent)", animation: "lm-spin .8s linear infinite" }} />}
              {err && <div role="alert" style={{ position: "absolute", insetInline: 12, bottom: 12, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--danger)", background: "color-mix(in srgb,var(--danger) 14%,var(--surface))" }}>{err}</div>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--muted)", flexWrap: "wrap" }}>
              <span>{f === "md" ? t("Text file") : pages && pages > 0 ? t("{n} pages", { n: fmtNum(pages) }) : pages === -1 ? t("Plain page layout (no table of contents page numbers)") : f === "html" ? t("Web page") : t("Laying out pages…")}</span>
              {warn && <><span>·</span><span style={{ color: "var(--warning)" }}>{warn}</span></>}
              <span style={{ flex: 1 }} /><span>{t("Preview at fit")}</span>
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, padding: "16px 18px", minWidth: 0, overflow: phone ? "visible" : "auto", scrollbarWidth: "none" }}>
            {view.blocks.map((b, i) => <BlockView key={i} b={b} />)}
            <BlockView b={{ cols: "1fr", items: [nameCell] }} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", borderTop: "1px solid var(--border)", flexWrap: "wrap", background: "var(--surface)" }}>
          <span style={{ fontSize: 12, color: "var(--muted)", flex: 1, minWidth: phone ? 120 : 160 }}>{t("Remembers these settings on this device.")}</span>
          {f === "pdf" && !phone && <button disabled={exporting || (busy && !pv)} onClick={() => void go("paged", "print")} style={{ height: 36, padding: "0 14px", borderRadius: 9, display: "flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", fontSize: 13, background: "transparent", color: "var(--text)", opacity: exporting ? 0.6 : 1 }} title={t("Opens the print dialog; choose “Save as PDF”. Works offline.")}><Glyph name="print" size={15} />{t("Use print dialog")}</button>}
          <button disabled={exporting || (busy && !pv && f !== "md")} onClick={() => void go(f === "pdf" ? "server" : "auto")} style={{ height: 36, padding: "0 16px", borderRadius: 9, display: "flex", alignItems: "center", gap: 8, background: "var(--accent)", color: "var(--accent-fg)", fontWeight: 600, fontSize: 13, border: 0, opacity: exporting ? 0.6 : 1 }}>
            <Glyph name={f === "print" ? "print" : "export"} size={16} />{exporting ? t("Working…") : primary}
          </button>
        </div>
      </div>
    </div>
  );
}
