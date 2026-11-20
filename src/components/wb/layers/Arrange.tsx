// Arrange (design 38E, R6Parts part "arrange"): Order · Group & lock · Align & distribute, with shortcuts.
// Opened from the property bar's Arrange button; the Layers panel shows the same 18 actions as a compact grid.
// Order / group / lock / flip run Excalidraw's own actions; align, distribute and unlock-all are element math in
// Whiteboard (`arrange()`), each one undo step.
import { t, tk } from "../../../lib/i18n";
import { Glyph } from "../../Glyph";
import { AC } from "../kit";

export type ArrangeId = "front" | "forward" | "backward" | "back" | "group" | "ungroup" | "lock" | "unlock-all"
  | "align-left" | "align-center" | "align-right" | "align-top" | "align-middle" | "align-bottom" | "distribute-h" | "distribute-v" | "flip-h" | "flip-v";

const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const k = (s: string) => (mac ? s : s.replace(/⇧⌘/g, "Ctrl+Shift+").replace(/⌘/g, "Ctrl+").replace(/⇧/g, "Shift+"));
export const ORDER: [ArrangeId, string, string, string][] = [["front", "bring-front", tk("Bring to front"), "⇧⌘]"], ["forward", "bring-forward", tk("Bring forward"), "⌘]"], ["backward", "send-backward", tk("Send backward"), "⌘["], ["back", "send-back", tk("Send to back"), "⇧⌘["]];
export const GROUP: [ArrangeId, string, string, string][] = [["group", "group", tk("Group"), "⌘G"], ["ungroup", "ungroup", tk("Ungroup"), "⇧⌘G"], ["lock", "lock", tk("Lock"), "⇧⌘L"], ["unlock-all", "unlock", tk("Unlock all"), ""]];
export const ALIGN: [ArrangeId, string, string, string][] = [["align-left", "align-left", tk("Left"), "⇧⌘←"], ["align-center", "align-center", tk("Centre"), ""], ["align-right", "align-right", tk("Right"), "⇧⌘→"], ["align-top", "align-top", tk("Top"), "⇧⌘↑"], ["align-middle", "align-middle", tk("Middle"), ""], ["align-bottom", "align-bottom", tk("Bottom"), "⇧⌘↓"]];
export const DIST: [ArrangeId, string, string, string][] = [["distribute-h", "distribute-h", tk("Horiz."), ""], ["distribute-v", "distribute-v", tk("Vert."), ""], ["flip-h", "flip-h", tk("Flip H"), "⇧H"], ["flip-v", "flip-v", tk("Flip V"), "⇧V"]];
/** The Layers panel's 18-tile grid order (WBStudio layers › Arrange). */
export const GRID: ArrangeId[] = ["front", "forward", "backward", "back", "group", "ungroup", "align-left", "align-center", "align-right", "align-top", "align-middle", "align-bottom", "distribute-h", "distribute-v", "flip-h", "flip-v", "lock", "unlock-all"];
const ALL = [...ORDER, ...GROUP, ...ALIGN, ...DIST];
export const arrangeMeta = (id: ArrangeId) => ALL.find((x) => x[0] === id)!;

const Head = ({ glyph, title }: { glyph: string; title: string }) => (
  <div className="flex items-center gap-2 border-b border-line px-[14px] pb-[10px] pt-3"><Glyph name={glyph} size={16} className="text-muted" /><span className="flex-1 text-[13.5px] font-semibold">{title}</span></div>
);
const H = ({ children }: { children: string }) => <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{children}</div>;
const Rowb = ({ id, run, enabled }: { id: [ArrangeId, string, string, string]; run: (a: ArrangeId) => void; enabled: boolean }) => (
  <button type="button" disabled={!enabled} onClick={() => run(id[0])} className="flex min-h-[34px] items-center gap-2 rounded-[8px] px-2 text-start text-[12.5px] hover:bg-surface-2 disabled:opacity-40">
    <Glyph name={id[1]} size={18} /><span className="min-w-0 flex-1 truncate">{t(id[2])}</span>{id[3] && <span className="whitespace-nowrap text-[11px] text-muted">{k(id[3])}</span>}
  </button>
);
const Tile = ({ id, run, enabled }: { id: [ArrangeId, string, string, string]; run: (a: ArrangeId) => void; enabled: boolean }) => (
  <button type="button" disabled={!enabled} title={id[3] ? `${t(id[2])} · ${k(id[3])}` : t(id[2])} onClick={() => run(id[0])}
    className="flex min-h-[58px] min-w-0 flex-col items-center justify-center gap-1 rounded-[8px] border border-line px-1 py-1.5 text-[10.5px] hover:bg-surface-2 disabled:opacity-40">
    <Glyph name={id[1]} size={18} /><span className="truncate">{t(id[2])}</span>
  </button>
);

/** 38E: three panels side by side (desktop) or stacked (phone). `count` = selected items (align needs 2, distribute 3). */
export function ArrangePopover({ run, count, phone }: { run: (a: ArrangeId) => void; count: number; phone?: boolean }) {
  const can = (id: ArrangeId) => (id.startsWith("align") ? count >= 2 : id.startsWith("distribute") ? count >= 3 : id === "unlock-all" ? true : count >= 1) && (id !== "group" || count >= 2);
  const panel = "box-border flex flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_10px_30px_rgba(0,0,0,.14)]";
  return (
    <div className={phone ? "flex w-full flex-col gap-3" : "flex items-start gap-[18px]"} role="menu" aria-label={t("Arrange")}>
      <div className={panel} style={{ width: phone ? "100%" : 300 }}>
        <Head glyph="bring-front" title={t("Order")} />
        <div className="flex flex-col gap-1 px-[14px] pb-[14px] pt-3">{ORDER.map((x) => <Rowb key={x[0]} id={x} run={run} enabled={can(x[0])} />)}</div>
      </div>
      <div className={panel} style={{ width: phone ? "100%" : 300 }}>
        <Head glyph="group" title={t("Group & lock")} />
        <div className="flex flex-col gap-2 px-[14px] pb-[14px] pt-3">
          <div className="flex flex-col gap-1">{GROUP.map((x) => <Rowb key={x[0]} id={x} run={run} enabled={can(x[0])} />)}</div>
          <div className="text-[11.5px] leading-[17px] text-muted">{t("Locked items show a lock glyph on hover and explain how to unlock.")}</div>
        </div>
      </div>
      <div className={panel} style={{ width: phone ? "100%" : 380 }}>
        <Head glyph="align-left" title={t("Align & distribute")} />
        <div className="flex flex-col gap-[14px] px-[14px] pb-[14px] pt-3">
          <div className="flex flex-col gap-2"><H>{t("Align")}</H><div className="grid grid-cols-6 gap-1">{ALIGN.map((x) => <Tile key={x[0]} id={x} run={run} enabled={can(x[0])} />)}</div></div>
          <div className="flex flex-col gap-2"><H>{t("Distribute & flip")}</H><div className="grid grid-cols-4 gap-1">{DIST.map((x) => <Tile key={x[0]} id={x} run={run} enabled={can(x[0])} />)}</div></div>
        </div>
      </div>
    </div>
  );
}

/** Compact 6×3 grid (Layers panel › Arrange). */
export function ArrangeGrid({ run, count }: { run: (a: ArrangeId) => void; count: number }) {
  return (
    <div className="grid grid-cols-6 gap-1">
      {GRID.map((id) => { const m = arrangeMeta(id); const ok = id === "unlock-all" || (id.startsWith("align") ? count >= 2 : id.startsWith("distribute") ? count >= 3 : count >= 1);
        return <button key={id} type="button" disabled={!ok} title={m[3] ? `${t(m[2])} · ${k(m[3])}` : t(m[2])} aria-label={t(m[2])} onClick={() => run(id)} className="flex min-h-[36px] items-center justify-center rounded-[8px] border border-line hover:bg-surface-2 disabled:opacity-40" style={undefined}><Glyph name={m[1]} size={18} /></button>; })}
    </div>
  );
}
export { AC };
