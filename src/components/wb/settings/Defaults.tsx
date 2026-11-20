// Settings › Diagrams › "New boards" (brief §6: defaults for new boards: pen, background, pattern, mode, snapping).
import { useSettings } from "../../../lib/settings";
import { t } from "../../../lib/i18n";
import { ChipSelect, PrefRow } from "../../chip-select";
import { getInk, setInk, useInk, type PenType } from "../pens/model";
import { BACKGROUNDS, boardDefaults, PATTERNS, setBoardDefaults, type BgKey, type PageMode, type PatKey } from "./model";

export function BoardDefaultsRows() {
  useSettings();
  const ink = useInk();
  const d = boardDefaults();
  const onOff = [{ value: "on", label: t("On") }, { value: "off", label: t("Off") }];
  const pens: PenType[] = ["ballpoint", "fountain", "brush", "marker", "pencil", "calligraphy"];
  return (<>
    <span className="mt-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t("New boards")}</span>
    <PrefRow label={t("Default pen")} desc={t("The pen the pen tool starts with")}>
      <ChipSelect value={ink.current === "highlighter" ? "fountain" : ink.current} onChange={(v) => { if (getInk().current !== v) setInk({ current: v as PenType }); }} options={pens.map((p) => ({ value: p, label: t(p.charAt(0).toUpperCase() + p.slice(1)) }))} />
    </PrefRow>
    <PrefRow label={t("Background")} desc={t("Theme follows Lamplight / Paper")}>
      <ChipSelect value={d.bg} onChange={(v) => setBoardDefaults({ bg: v as BgKey })} options={BACKGROUNDS.filter(([k]) => k !== "custom").map(([k, l]) => ({ value: k, label: t(l) }))} />
    </PrefRow>
    <PrefRow label={t("Pattern")} desc={t("{n} px spacing", { n: d.density })}>
      <ChipSelect value={d.pattern} onChange={(v) => setBoardDefaults({ pattern: v as PatKey })} options={PATTERNS.map(([k, , l]) => ({ value: k, label: t(l) }))} />
    </PrefRow>
    <PrefRow label={t("Mode")} desc={t("Pages stack vertically for handwritten notes and printing")}>
      <ChipSelect value={d.mode} onChange={(v) => setBoardDefaults({ mode: v as PageMode })} options={[{ value: "infinite", label: t("Infinite") }, { value: "a4", label: "A4" }, { value: "letter", label: t("Letter") }, { value: "16:9", label: "16:9" }]} />
    </PrefRow>
    <PrefRow label={t("Snap to grid")} desc={t("Moves and new shapes land on the pattern")}>
      <ChipSelect value={d.snapGrid ? "on" : "off"} onChange={(v) => setBoardDefaults({ snapGrid: v === "on" })} options={onOff} />
    </PrefRow>
    <PrefRow label={t("Snap to objects")} desc={t("Edges and centres line up")}>
      <ChipSelect value={d.snapObjects ? "on" : "off"} onChange={(v) => setBoardDefaults({ snapObjects: v === "on" })} options={onOff} />
    </PrefRow>
  </>);
}
