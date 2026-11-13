import { Copy, FileVideo, Lightbulb } from "lucide-react";
import { useEffect } from "react";
import { MAX_FILE } from "../lib/attachments";
import { toast } from "../lib/store";

const size = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`);
export const isTooBig = (f: File) => f.size > MAX_FILE;
const TIP = "Upload long videos to YouTube as Unlisted, then paste the link. It plays inline, in slides and for visitors, and costs nothing.";

/** Shown instead of a toast when a dropped/picked file is over the 100 MB limit (design: Lumen 11, R3-4B desktop dialog / R3-4C phone sheet). */
export function TooBigDialog({ file, onClose, onPasteLink, onChooseAnother }: { file: File | null; onClose: () => void; onPasteLink?: () => void; onChooseAnother?: () => void }) {
  useEffect(() => {
    if (!file) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [file, onClose]);
  if (!file) return null;
  const paste = () => { onPasteLink?.(); onClose(); };
  const another = () => { onChooseAnother?.(); onClose(); };
  return (
    <div className="fade-in fixed inset-0 z-50 text-[14px] leading-[normal] text-ink md:text-[13px]" style={{ background: "rgba(5,6,8,.62)" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {/* desktop dialog */}
      <div role="dialog" aria-modal="true" className="absolute left-1/2 top-1/2 hidden w-[522px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[14px] border border-line bg-surface md:flex">
        <div className="flex items-start gap-3.5 px-6 pt-[22px]">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] text-warn" style={{ background: "color-mix(in srgb, var(--warning) 14%, transparent)" }}><FileVideo size={19} /></span>
          <div className="flex flex-col gap-1">
            <span className="text-[17px] font-[650]">This file is too big to store</span>
            <span className="leading-[19px] text-muted"><span className="font-mono text-ink">{file.name}</span> is {size(file.size)}. Lumen stores files up to 100 MB on your free Cloudflare.</span>
          </div>
        </div>
        <div className="mx-6 mt-[18px] flex flex-col gap-2.5 rounded-[10px] bg-surface-2 p-3.5">
          <span className="flex items-center gap-2 font-semibold"><Lightbulb size={15} className="text-accent" />Tip for long videos</span>
          <span className="leading-5">Upload it to YouTube as <b className="font-semibold">Unlisted</b>, then paste the link here. It plays inline, in slides and for visitors, and costs nothing.</span>
          <button onClick={() => navigator.clipboard.writeText(TIP).then(() => toast("Tip copied"))} className="flex h-[32px] items-center gap-1.5 self-start rounded-[8px] border border-line px-2.5"><Copy size={13} />Copy tip</button>
        </div>
        <div className="flex justify-end gap-2 px-6 py-[18px]">
          <button onClick={another} className="flex h-9 items-center rounded-[10px] px-3.5 text-muted hover:text-ink">Choose another file</button>
          <button onClick={paste} className="flex h-9 items-center rounded-[10px] bg-accent px-4 font-semibold text-accent-fg">Paste a link instead</button>
        </div>
      </div>
      {/* phone bottom sheet */}
      <div role="dialog" aria-modal="true" className="sheet-in safe-b absolute inset-x-0 bottom-0 flex flex-col gap-3.5 rounded-t-[14px] bg-surface px-5 pb-6 pt-2.5 md:hidden">
        <div className="flex justify-center"><span className="h-1 w-9 rounded-sm bg-line" /></div>
        <span className="text-[18px] font-[650]">Too big to store</span>
        <span className="leading-[21px] text-muted">{file.name} is {size(file.size)}. The limit is 100 MB per file.</span>
        <div className="rounded-[12px] bg-surface-2 p-3.5 leading-[21px]"><b className="font-semibold">Tip:</b> upload long videos to YouTube as <b className="font-semibold">Unlisted</b> and paste the link.</div>
        <button onClick={paste} className="flex h-[52px] items-center justify-center rounded-[12px] bg-accent font-semibold text-accent-fg">Paste a link instead</button>
        <button onClick={another} className="flex h-12 items-center justify-center text-muted">Choose another file</button>
      </div>
    </div>
  );
}
