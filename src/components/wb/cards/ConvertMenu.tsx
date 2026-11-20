// Convert menu (Lumen 40H, 52A) and the conversion matrix (52B, 52C). Same panel in every workspace: the whiteboard / board
// header registers it as the "convert" panel; Canvas and the Architecture studio mount <ConvertMenu source={sourceOf(note)} …/>.
//   Every target says what is kept and what is lost; "Convert a copy" always makes a copy (the original stays), opens it
//   and leaves the "Undo conversion" chip (./UndoChip).
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { convertCopy } from "../../../lib/convert/copy";
import { ConvertError, pathOf, targetsOf, TARGET, WORKSPACES, WS_LABEL, MATRIX, type ConvertSource, type Target, type Workspace } from "../../../lib/convert";
import { t } from "../../../lib/i18n";
import { toast } from "../../../lib/store";
import { Glyph } from "../../Glyph";
import { cx } from "../../ui";
import { AC_BG } from "../ui";
import { PanelShell } from "../panel";
import "./UndoChip";

const btn = (pri?: boolean) => ({ height: 32, padding: "0 12px", borderRadius: 8, fontSize: 12.5, fontWeight: pri ? 600 : 500, background: pri ? "var(--accent)" : "transparent", color: pri ? "var(--accent-fg)" : "var(--text)", border: `1px solid ${pri ? "transparent" : "var(--border)"}`, whiteSpace: "nowrap" as const });

export function ConvertMenu({ source, onClose, phone, className, style }: {
  source: ConvertSource | (() => ConvertSource);
  onClose: () => void;
  /** Bottom sheet instead of the floating panel. */
  phone?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const src = useMemo(() => (typeof source === "function" ? source() : source), []); // eslint-disable-line react-hooks/exhaustive-deps
  const targets = targetsOf(src.kind);
  const [to, setTo] = useState<Target>(targets.includes("canvas") ? "canvas" : targets[0]);
  const [busy, setBusy] = useState(false);
  const [matrix, setMatrix] = useState(false);
  const p = pathOf(src.kind, to);
  const kindName = t(WS_LABEL[src.kind]).toLowerCase();

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await convertCopy(typeof source === "function" ? source() : source, to);
      toast(`${r.summary}. ${t("The original {kind} stays.", { kind: kindName })}`);
      onClose();
    } catch (e) {
      toast(e instanceof ConvertError ? e.message : t("Couldn't convert: {why}", { why: (e as Error).message ?? String(e) }));
      setBusy(false);
    }
  };

  const foot = (
    <>
      <button type="button" onClick={onClose} style={btn()} className="hover:bg-surface-2">{t("Cancel")}</button>
      <button type="button" disabled={busy || !p} onClick={() => void run()} style={btn(true)} className="disabled:opacity-60">{busy ? t("Converting…") : t("Convert a copy")}</button>
    </>
  );
  return (
    <PanelShell glyph="switch" title={t("Convert to")} sub={t("Makes a copy")} onClose={onClose} sheet={phone} foot={foot} label={t("Convert to")}
      className={cx(!phone && (matrix ? "right-[14px] top-[4px] w-[min(780px,calc(100%-28px))]" : "right-[14px] top-[4px] w-[400px]"), className)} style={{ maxHeight: phone ? undefined : "calc(100% - 112px)", ...style }}>
      {matrix ? <ConversionMatrix from={src.kind} /> : (
        <>
          <div role="radiogroup" aria-label={t("Convert to")} className="flex flex-col gap-[2px]">
            {targets.map((k) => {
              const on = k === to, pa = pathOf(src.kind, k)!;
              return (
                <button key={k} type="button" role="radio" aria-checked={on} title={`${pa.kept}${pa.lost ? ` ${t("Lost:")} ${pa.lost}` : ""}`} onClick={() => setTo(k)} onDoubleClick={() => { setTo(k); }}
                  className={cx("flex min-h-[52px] w-full min-w-0 items-center gap-[10px] rounded-[8px] border px-[10px] text-start text-[12.5px] font-semibold", on ? "border-accent text-ink" : "border-transparent text-ink hover:bg-surface-2")}
                  style={on ? { background: AC_BG } : undefined}>
                  <Glyph name={TARGET[k].glyph} size={16} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t(TARGET[k].label)}</span>
                </button>
              );
            })}
          </div>
          {p && (
            <div className="rounded-[8px] text-[11.5px] leading-[17px] text-muted" aria-live="polite">
              <b className="font-semibold text-ink">{t(TARGET[to].label)}:</b> {p.kept}{p.lost ? <> <span className="text-ink">{t("Lost:")}</span> {p.lost}</> : null} {t("The original {kind} stays.", { kind: kindName })}
            </div>
          )}
          <button type="button" onClick={() => setMatrix(true)} className="self-start text-[11.5px] text-muted underline-offset-2 hover:text-ink hover:underline">{t("All conversions")}</button>
        </>
      )}
      {matrix && <button type="button" onClick={() => setMatrix(false)} className="self-start text-[11.5px] text-muted underline-offset-2 hover:text-ink hover:underline">{t("Back to this menu")}</button>}
    </PanelShell>
  );
}

/** 52B / 52C: From ↓ To → grid. The row of the workspace you are in is highlighted. */
export function ConversionMatrix({ from }: { from?: Workspace }) {
  const cols: Target[] = ["whiteboard", "board", "canvas", "architecture", "mermaid", "note"];
  const cell = (extra?: React.CSSProperties) => ({ minHeight: 40, padding: "4px 8px", display: "flex", alignItems: "center", fontSize: 12, minWidth: 0, ...extra });
  return (
    <div>
      <div className="overflow-x-auto">
        <div style={{ display: "grid", gridTemplateColumns: "120px repeat(6,minmax(96px,1fr))", gap: 4, minWidth: 700 }}>
          <div style={cell({ fontWeight: 600, color: "var(--muted)" })}>{t("From ↓  To →")}</div>
          {cols.map((c) => <div key={c} style={cell({ fontWeight: 600 })}>{t(WS_LABEL[c])}</div>)}
          {WORKSPACES.map((r) => (
            <div key={r} className="contents">
              <div style={cell({ fontWeight: 600, color: r === from ? "var(--accent)" : undefined })}>{t(WS_LABEL[r])}</div>
              {cols.map((c) => {
                const pa = MATRIX[r]?.[c];
                return <div key={c} title={pa ? `${pa.kept}${pa.lost ? ` ${t("Lost:")} ${pa.lost}` : ""}` : undefined} style={cell({ border: "1px solid " + (r === from && pa ? "var(--accent)" : "var(--border)"), borderRadius: 8, color: pa ? "var(--text)" : "var(--muted)", background: r === from && pa ? AC_BG : undefined })}>{pa ? t(pa.cell) : "—"}</div>;
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3 text-[11.5px] leading-[17px] text-muted">{t("AI steps always open the review sheet. Lumen-only data rides in lumen* keys so other apps still open the files.")}</p>
    </div>
  );
}

/** Hosts a <ConvertMenu> in document.body (for editors that have no floating-panel layer): `openConvertMenu(source)`. */
export function ConvertMenuPortal({ source, onClose }: { source: ConvertSource | (() => ConvertSource); onClose: () => void }) {
  return createPortal(<div className="fixed inset-0 z-[300]" data-wb-chrome><div className="relative h-full w-full"><ConvertMenu source={source} onClose={onClose} className="!top-[52px]" /></div></div>, document.body);
}
