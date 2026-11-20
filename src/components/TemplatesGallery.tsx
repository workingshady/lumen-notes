// Templates gallery (design round 7, Lumen 51): study, whiteboard, architecture and interview starters as thumbnails.
// Picking one creates a real note (.excalidraw scene or JSON Canvas with lumenArch) where the chooser said.
import { useEffect } from "react";
import { createNote } from "../lib/actions";
import { t, tk } from "../lib/i18n";
import { openNote } from "../lib/store";
import { VISUAL_TEMPLATES, type TplCategory, type VisualTemplate } from "../lib/templates-visual";
import { Glyph } from "./Glyph";

export type Where = { spaceId: string; folderId: string | null };
const SECTIONS: TplCategory[] = ["Study", "Architecture", "Interview"];
const CAT_L: Record<TplCategory, string> = { Study: tk("Study"), Architecture: tk("Architecture"), Interview: tk("Interview") };

export async function createFromTemplate(tpl: VisualTemplate, where: Where) {
  const n = await createNote({ type: tpl.type, title: tpl.title, body: tpl.build(), spaceId: where.spaceId, folderId: where.folderId });
  openNote(n.id);
  return n;
}

function Thumb({ tpl }: { tpl: VisualTemplate }) {
  return (
    <div className="relative h-[170px] w-full overflow-hidden rounded-[12px] border border-line bg-bg" style={{ backgroundImage: "radial-gradient(color-mix(in srgb,var(--muted) 18%,transparent) 1px,transparent 1.2px)", backgroundSize: "16px 16px" }}>
      <div className="absolute start-0 top-0 h-[170px] w-[310px]" dir="ltr">
        {tpl.els.map((e, i) => (
          <div key={i} className="absolute box-border flex items-center gap-1.5 overflow-hidden whitespace-nowrap" style={{ left: e.x, top: e.y, width: e.w, height: e.h, background: e.bg, border: e.bd, borderRadius: e.r, fontSize: e.fs, fontWeight: e.fw, color: e.c ?? "var(--text)", padding: e.t ? "0 6px" : 0 }}>
            {e.g && <Glyph name={e.g as never} size={13} color={e.gc} />}{e.t}
          </div>
        ))}
        <svg width="100%" height="100%" className="pointer-events-none absolute inset-0 overflow-visible">
          {tpl.lines.map((l, i) => <path key={i} d={l.d} fill="none" stroke={l.c} strokeWidth={l.w ?? 1} strokeDasharray={l.da} strokeLinecap="round" />)}
        </svg>
      </div>
    </div>
  );
}

export function TemplatesGallery({ open, where, onClose, onPicked }: { open: boolean; where: Where; onClose: () => void; onPicked?: () => void }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div role="dialog" aria-label={t("Templates")} className="fixed inset-0 z-[60] overflow-y-auto bg-bg text-[13px] text-ink fade-in">
      <div className="flex items-center gap-3 px-4 pt-[14px] md:px-7">
        <span className="text-[18px] font-[650] tracking-[-.01em]">{t("Templates")}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{t("Study · Whiteboard · Architecture · Interview")}</span>
        <button aria-label={t("Close")} onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-ink"><Glyph name="x" size={16} /></button>
      </div>
      <div className="flex flex-col gap-[18px] px-4 pb-7 pt-4 md:px-7">
        <div className="flex flex-wrap content-start items-start gap-x-4 gap-y-[18px]">
          {SECTIONS.flatMap((s) => VISUAL_TEMPLATES.filter((x) => x.cat === s)).map((tpl) => (
            <button key={tpl.id} onClick={async () => { await createFromTemplate(tpl, where); onPicked?.(); onClose(); }} aria-label={tpl.name}
              className="flex w-full flex-col gap-2 text-start md:w-[312px]">
              <Thumb tpl={tpl} />
              <span className="flex flex-col gap-0.5"><span className="text-[13px] font-semibold" dir="auto">{tpl.name}</span><span className="text-[12px] leading-[17px] text-muted">{tpl.caption || t(CAT_L[tpl.cat])}</span></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
