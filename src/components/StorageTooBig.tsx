import { Copy, FileVideo, Lightbulb } from "lucide-react";
import { useEffect } from "react";
import { MAX_FILE } from "../lib/attachments";
import { toast } from "../lib/store";
import { fmtNum, t, tx } from "../lib/i18n";

const size = (b: number) => (b >= 1024 ** 3 ? t("{n} GB", { n: fmtNum(Number((b / 1024 ** 3).toFixed(1))) }) : t("{n} MB", { n: Math.round(b / 1024 ** 2) }));
export const isTooBig = (f: File) => f.size > MAX_FILE;
const tip = () => t("Upload long videos to YouTube as Unlisted, then paste the link. It plays inline, in slides and for visitors, and costs nothing.");

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
            <span className="text-[17px] font-[650]">{t("This file is too big to store")}</span>
            <span className="leading-[19px] text-muted">{tx("{name} is {size}. Lumen stores files up to 100 MB on your free Cloudflare.", { name: <span className="font-mono text-ink" dir="auto">{file.name}</span>, size: size(file.size) })}</span>
          </div>
        </div>
        <div className="mx-6 mt-[18px] flex flex-col gap-2.5 rounded-[10px] bg-surface-2 p-3.5">
          <span className="flex items-center gap-2 font-semibold"><Lightbulb size={15} className="text-accent" />{t("Tip for long videos")}</span>
          <span className="leading-5">{tx("Upload it to YouTube as {unlisted}, then paste the link here. It plays inline, in slides and for visitors, and costs nothing.", { unlisted: <b className="font-semibold">{t("Unlisted")}</b> })}</span>
          <button onClick={() => navigator.clipboard.writeText(tip()).then(() => toast(t("Tip copied")))} className="flex h-[32px] items-center gap-1.5 self-start rounded-[8px] border border-line px-2.5"><Copy size={13} />{t("Copy tip")}</button>
        </div>
        <div className="flex justify-end gap-2 px-6 py-[18px]">
          <button onClick={another} className="flex h-9 items-center rounded-[10px] px-3.5 text-muted hover:text-ink">{t("Choose another file")}</button>
          <button onClick={paste} className="flex h-9 items-center rounded-[10px] bg-accent px-4 font-semibold text-accent-fg">{t("Paste a link instead")}</button>
        </div>
      </div>
      {/* phone bottom sheet */}
      <div role="dialog" aria-modal="true" className="sheet-in safe-b absolute inset-x-0 bottom-0 flex flex-col gap-3.5 rounded-t-[14px] bg-surface px-5 pb-6 pt-2.5 md:hidden">
        <div className="flex justify-center"><span className="h-1 w-9 rounded-sm bg-line" /></div>
        <span className="text-[18px] font-[650]">{t("Too big to store")}</span>
        <span className="leading-[21px] text-muted">{tx("{name} is {size}. The limit is 100 MB per file.", { name: <span dir="auto">{file.name}</span>, size: size(file.size) })}</span>
        <div className="rounded-[12px] bg-surface-2 p-3.5 leading-[21px]">{tx("{tip} upload long videos to YouTube as {unlisted} and paste the link.", { tip: <b className="font-semibold">{t("Tip:")}</b>, unlisted: <b className="font-semibold">{t("Unlisted")}</b> })}</div>
        <button onClick={paste} className="flex h-[52px] items-center justify-center rounded-[12px] bg-accent font-semibold text-accent-fg">{t("Paste a link instead")}</button>
        <button onClick={another} className="flex h-12 items-center justify-center text-muted">{t("Choose another file")}</button>
      </div>
    </div>
  );
}
