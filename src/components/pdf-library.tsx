// PDF library for a space (NoteList "PDFs"): cover, title, pages, progress and highlight count; "Add PDF" uploads a
// file and creates its `type: pdf` note.
import { FileText, Upload, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types";
import { openPdf, renderThumb } from "../lib/pdf-doc";
import { parseHighlights, pdfMeta } from "../lib/pdf-format";
import { addPdfFile } from "../lib/pdf-note";
import { openNote, toast, useUI, useVault } from "../lib/store";
import { Button, cx } from "./ui";

export function PdfLibrary({ spaceId, folderId, onClose }: { spaceId: string; folderId: string | null; onClose: () => void }) {
  const v = useVault();
  const ui = useUI();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => v.notes.filter((n) => n.type === "pdf" && (ui.spaceId === "all" || n.spaceId === ui.spaceId)).sort((a, b) => b.updatedAt - a.updatedAt), [v.notes, ui.spaceId]);
  const add = async (fl: FileList | null) => {
    const f = fl?.[0];
    if (!f) return;
    if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) { toast("That isn't a PDF"); return; }
    setBusy(true);
    try { const n = await addPdfFile(f, spaceId, folderId); openNote(n.id, "read"); } catch (e) { toast(e instanceof Error ? e.message : "Upload failed"); } finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <FileText size={14} className="text-bad" /><span className="text-[13px] font-semibold">PDFs</span><span className="text-[12px] text-muted">{list.length}</span>
        <span className="flex-1" />
        <Button size="sm" disabled={busy} onClick={() => file.current?.click()}><Upload size={13} />{busy ? "Adding…" : "Add PDF"}</Button>
        <button aria-label="Close PDFs" className="flex size-8 items-center justify-center text-muted hover:text-ink" onClick={onClose}><X size={14} /></button>
        <input ref={file} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1.5">
        {list.map((n) => <PdfRow key={n.id} n={n} />)}
        {!list.length && (
          <div className="flex flex-col items-center gap-2.5 px-8 py-14 text-center">
            <div className="text-[15px] font-semibold">No PDFs here yet</div>
            <div className="max-w-[300px] text-[13px] leading-5 text-muted">Add a paper or a chapter to read it with highlights. PDFs already in a note have an “Open as PDF note” button.</div>
            <Button variant="primary" onClick={() => file.current?.click()}><Upload size={14} />Add PDF</Button>
          </div>
        )}
      </div>
    </div>
  );
}

const covers = new Map<string, Promise<string | null>>();
function cover(file: string): Promise<string | null> {
  if (!covers.has(file)) covers.set(file, (async () => {
    const key = "lumen.pdf.cover." + file;
    try { const c = localStorage.getItem(key); if (c) return c; } catch { /* ignore */ }
    try {
      const doc = await openPdf(file);
      const url = await renderThumb(doc, 1, 48);
      void doc.destroy();
      try { localStorage.setItem(key, url); } catch { /* full */ }
      return url;
    } catch { return null; }
  })());
  return covers.get(file)!;
}

const PdfRow = memo(function PdfRow({ n }: { n: Note }) {
  const meta = pdfMeta(n.body);
  const hs = parseHighlights(n.body).length;
  const el = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!el.current || !meta.file) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); void cover(meta.file).then(setSrc); } });
    io.observe(el.current);
    return () => io.disconnect();
  }, [meta.file]);
  return (
    <button ref={el} onClick={() => openNote(n.id, "read")} className="flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-start hover:bg-surface-2">
      <span className={cx("flex h-[60px] w-[46px] shrink-0 items-center justify-center overflow-hidden rounded-[3px] border border-line bg-[#FBFAF7]")}>
        {src ? <img src={src} alt="" className="h-full w-full object-cover object-top" /> : <FileText size={16} className="text-[#9a948a]" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span dir="auto" className="truncate text-[13.5px] font-semibold">{n.title}</span>
        <span className="text-[12px] text-muted">{meta.pages ? `${meta.pages} pages · ` : ""}{meta.progress}% read · {hs} highlight{hs === 1 ? "" : "s"}</span>
        <span className="h-1 overflow-hidden rounded-full bg-surface-2"><span className="block h-full bg-accent" style={{ width: `${meta.progress}%` }} /></span>
      </span>
    </button>
  );
}, (a, b) => a.n.id === b.n.id && a.n.updatedAt === b.n.updatedAt && a.n.body === b.n.body);
