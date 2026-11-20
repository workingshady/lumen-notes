// Colour popover (design 37A–37D, 44C; WBStudio overlay "palette"): palette switcher, swatches, shades of the selected
// swatch, recent, hex + eyedropper, opacity, "Keep exact colour in dark theme" and the AA contrast warning.
// Desktop: 300 px panel under the property bar. Phone: bottom sheet.
import { useMemo, useState } from "react";
import { t } from "../../../lib/i18n";
import { toast } from "../../../lib/store";
import { Glyph } from "../../Glyph";
import { cx } from "../../ui";
import { BlockHead, ColourTile, ON_STYLE, PanelShell, Slider, Tog } from "../panel";
import { openWbPanel } from "../pens/live";
import { shown } from "../tools";
import type { WbAPI } from "../hooks";
import { boardPalette, colourName, contrast, parseHex, pushRecent, SHADE_STEPS, shade, SHIPPED, suggestShade, toHex, useCustomPalettes, usePalPrefs, setPalPrefs, writeCustom, type Palette } from "./palettes";

/** All palettes in switcher order: Lumen ink, Paper stickies, Highlighters, Okabe-Ito, Greys, Vivid, This board, custom. */
export function usePalettes(dark: boolean, api: WbAPI | null | undefined): Palette[] {
  const custom = useCustomPalettes();
  const els = api?.getSceneElements();
  const board = useMemo(() => boardPalette(els ?? []), [els]);
  return useMemo(() => [...SHIPPED(dark), board, ...custom], [dark, board, custom]);
}

const strip = (p: Palette, dark: boolean) => {
  const cs = p.colors.slice(0, 5).map((s) => shown(s.c, dark));
  if (!cs.length) return "var(--surface-2)";
  return `linear-gradient(90deg,${cs.map((c, i) => `${c} ${(i * 100) / cs.length}% ${((i + 1) * 100) / cs.length}%`).join(",")})`;
};

/** Palette switcher rows (design: 54×14 strip · name · sub), then "New palette…". */
export function PaletteSwitcher({ list, current, dark, onPick }: { list: Palette[]; current: string; dark: boolean; onPick: (id: string) => void }) {
  const newPalette = async () => {
    const id = Math.random().toString(36).slice(2, 10);
    await writeCustom((cur) => [...cur, { id, name: t("New palette"), sub: "", custom: true, colors: [] }]);
    setPalPrefs({ palette: id });
    openWbPanel("palette", { edit: id });
  };
  return (
    <div className="grid gap-1">
      {list.map((p) => (
        <button key={p.id} type="button" onClick={() => onPick(p.id)} className="flex min-h-[34px] items-center gap-2 rounded-[8px] border border-transparent px-2 text-start text-[12.5px] hover:bg-surface-2" style={p.id === current ? ON_STYLE : undefined}>
          <span className="box-border h-[14px] w-[54px] shrink-0 rounded-[4px] border border-line" style={{ background: strip(p, dark) }} />
          <span className="min-w-0 flex-1 truncate">{t(p.name)}</span>
          {(p.custom || p.themeAware) && <span className="whitespace-nowrap text-[11px] text-muted">{p.custom ? t("custom") : t("theme-aware")}</span>}
        </button>
      ))}
      <button type="button" onClick={() => void newPalette()} className="flex min-h-[34px] items-center gap-2 rounded-[8px] px-2 text-start text-[12.5px] text-muted hover:bg-surface-2"><Glyph name="swatch-add" size={18} />{t("New palette…")}</button>
    </div>
  );
}

/** Eyedropper (Chromium EyeDropper API); falls back to the system colour picker elsewhere. */
export async function pickScreenColour(): Promise<string | null> {
  const ED = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
  if (ED) { try { return (await new ED().open()).sRGBHex; } catch { return null; } }
  return new Promise((res) => {
    const i = document.createElement("input");
    i.type = "color";
    i.onchange = () => res(i.value);
    i.oncancel = () => res(null);
    i.click();
  });
}

export interface ColourCtx {
  api: WbAPI | null | undefined; dark: boolean; phone: boolean;
  target: "stroke" | "fill";
  /** Current colour (null = mixed). */
  value: string | null;
  opacity: number | null;
  exact: boolean | null;
  onPick: (c: string) => void;
  onOpacity: (n: number) => void;
  onExact: (v: boolean) => void;
  onClose: () => void;
  /** Text-on-fill contrast pair for the warning: [text colour, fill colour] (null = nothing to check). */
  pair?: [string, string] | null;
  className?: string;
}

export function ColourPopover(p: ColourCtx) {
  const pal = usePalPrefs();
  const list = usePalettes(p.dark, p.api);
  const [switching, setSwitching] = useState(false);
  const cur = list.find((x) => x.id === pal.palette) ?? list[0];
  const val = (p.value ?? "").toLowerCase();
  const selIdx = cur.colors.findIndex((s) => s.c.toLowerCase() === val);
  const base = selIdx >= 0 ? cur.colors[selIdx].c : p.value && p.value !== "transparent" ? p.value : cur.colors[0]?.c ?? "#1e1e1e";
  const [hex, setHex] = useState<string | null>(null);
  const pick = (c: string) => { p.onPick(c); pushRecent(c); setHex(null); };
  const shownHex = (c: string | null) => { if (!c || c === "transparent") return c ?? ""; const x = parseHex(shown(c, p.dark)); return x ? toHex(x[0], x[1], x[2], x[3]) : c; };
  const warn = p.pair ? (() => { const r = contrast(p.pair[0], p.pair[1]); return r < 4.5 ? { r, s: suggestShade(p.pair[1], p.pair[0]) } : null; })() : null;
  const pastel = cur.id === "okabe" ? "Okabe-Ito" : t("Swatches");
  const col = Math.min(Math.max(cur.colors.length, 1), 6);

  return (
    <PanelShell glyph="palette" title={t("Colour")} sub={p.target === "stroke" ? t("Stroke") : t("Fill")} onClose={p.onClose} sheet={p.phone} portal={p.phone}
      className={cx(p.phone ? "!fixed z-50" : "w-[300px]", p.className)}>
      <button type="button" onClick={() => setSwitching((s) => !s)} aria-expanded={switching}
        className="flex min-h-[34px] items-center gap-2 rounded-[8px] border border-line px-2 text-[12.5px] hover:bg-surface-2">
        <Glyph name="palette" size={18} /><span className="min-w-0 flex-1 truncate text-start font-semibold">{t(cur.name)}</span><span className="text-[11px] text-muted">{switching ? "▴" : "▾"}</span>
      </button>
      {switching ? (
        <PaletteSwitcher list={list} current={cur.id} dark={p.dark} onPick={(id) => { setPalPrefs({ palette: id }); setSwitching(false); }} />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <BlockHead h={pastel} right={cur.custom ? t("Edit") : undefined} onRight={cur.custom ? () => openWbPanel("palette", { edit: cur.id }) : undefined} />
            {cur.colors.length ? (
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${col},1fr)` }}>
                {cur.colors.map((s, i) => <ColourTile key={s.c + i} c={shown(s.c, p.dark)} title={s.name ?? colourName(s.c) ?? s.c} sel={i === selIdx} onClick={() => pick(s.c)} />)}
              </div>
            ) : <span className="text-[11.5px] text-muted">{cur.id === "board" ? t("No colours on this board yet.") : t("No colours yet. Edit the palette to add some.")}</span>}
          </div>
          {base && parseHex(base) && (
            <div className="flex flex-col gap-2">
              <BlockHead h={t("Shades")} right={colourName(base) ? t(colourName(base)!) : shownHex(base)} />
              <div className="grid grid-cols-6 gap-1">
                {SHADE_STEPS.map((k) => { const c = k === 1 ? base : shade(base, k); return <ColourTile key={k} c={shown(c, p.dark)} title={shownHex(c)} sel={k === 1 ? selIdx >= 0 || val === base.toLowerCase() : val === c.toLowerCase()} onClick={() => pick(c)} />; })}
              </div>
            </div>
          )}
          {pal.recent.length > 0 && (
            <div className="flex flex-col gap-2">
              <BlockHead h={t("Recent")} />
              <div className="grid grid-cols-8 gap-1">{pal.recent.map((c) => <ColourTile key={c} c={shown(c, p.dark)} title={colourName(c) ?? c} onClick={() => pick(c)} />)}</div>
            </div>
          )}
          <div className="grid grid-cols-[1fr_36px] gap-1">
            <label className="flex min-h-[34px] items-center gap-2 rounded-[8px] border border-line px-2 text-[12.5px]">
              <span className="box-border size-4 shrink-0 rounded-[4px] border border-line" style={{ background: p.value && p.value !== "transparent" ? shown(p.value, p.dark) : "transparent" }} />
              <input value={hex ?? (p.value ? shownHex(p.value) : "")} onChange={(e) => setHex(e.target.value)} spellCheck={false} dir="ltr" aria-label={t("Hex colour")} placeholder="#RRGGBB"
                onKeyDown={(e) => { if (e.key === "Enter") { const v = (hex ?? "").trim(); const x = parseHex(v.startsWith("#") ? v : "#" + v); if (x) pick(toHex(x[0], x[1], x[2], x[3])); else toast(t("Use a hex colour like #5CC8C2")); } }}
                onBlur={() => { const v = (hex ?? "").trim(); const x = v && parseHex(v.startsWith("#") ? v : "#" + v); if (x) pick(toHex(x[0], x[1], x[2], x[3])); else setHex(null); }}
                className="min-w-0 flex-1 bg-transparent font-medium uppercase outline-none" />
            </label>
            <button type="button" title={t("Eyedropper")} aria-label={t("Eyedropper")} onClick={async () => { const c = await pickScreenColour(); if (c) pick(c.toUpperCase()); }}
              className="flex min-h-[34px] items-center justify-center rounded-[8px] border border-line hover:bg-surface-2"><Glyph name="eyedropper" size={18} /></button>
          </div>
          <div className="grid gap-1.5">
            <div className="flex min-h-[34px] items-center gap-2 px-2 text-[12.5px]">
              <span className="flex-1">{t("Opacity")}</span>
              <span className="whitespace-nowrap text-[11px] text-muted">{p.opacity == null ? "—" : `${p.opacity}%`}</span>
              <Slider value={p.opacity ?? 100} onChange={p.onOpacity} min={0} max={100} step={5} label={t("Opacity")} />
            </div>
            <div className="flex min-h-[34px] items-center gap-2 px-2 text-[12.5px]">
              <span className="flex-1">{t("Keep exact colour in dark theme")}</span>
              <Tog on={!!p.exact} onChange={p.onExact} label={t("Keep exact colour in dark theme")} />
            </div>
          </div>
          {warn && (
            <div className="rounded-[8px] px-2.5 py-2 text-[11.5px] leading-[17px]" style={{ color: "var(--warning)", background: "color-mix(in srgb,var(--warning) 12%,transparent)" }}>
              {t("Text on this fill is {r} : 1, below AA (4.5 : 1).", { r: warn.r.toFixed(1) })}{" "}
              {warn.s ? <button type="button" className="underline" onClick={() => pick(warn.s!)}>{t("Try a darker shade.")}</button> : t("Try a darker shade.")}
            </div>
          )}
        </>
      )}
    </PanelShell>
  );
}
