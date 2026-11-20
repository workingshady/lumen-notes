// Pen picker (design 34A desktop · 34B Paper · 34C/44B phone sheet; WBStudio overlay "pen"): saved pens (synced, up to 8,
// drag to reorder), pen types with a stroke preview, thickness slider + five preset dots, colour from the active palette,
// opacity, pressure, smoothing, pressure curve, draw-straight-when-I-pause and pen mode.
import { useRef, useState } from "react";
import { t } from "../../../lib/i18n";
import { toast } from "../../../lib/store";
import { Glyph } from "../../Glyph";
import { cx } from "../../ui";
import { BlockHead, ColourTile, ON_STYLE, PanelShell, Seg, Slider, Tog } from "../panel";
import { shown } from "../tools";
import { colourName, setPalPrefs, usePalPrefs } from "../palette/palettes";
import { PaletteSwitcher, usePalettes } from "../palette/ColourPopover";
import type { WbAPI } from "../hooks";
import { live, setLive, useLive } from "./live";
import { getInk, MAX_SAVED, PEN_PV, PEN_TYPES, penMeta, penSub, rid, setInk, setPen, THICK_PRESETS, useInk, useSavedPens, writeSaved, type PenSettings, type PenType, type SavedPen } from "./model";

/** Which pen the panel edits: the highlighter / laser tool, else the current drawing pen. */
export function shownType(tool: string, current: PenType): PenType { return tool === "hl" ? "highlighter" : tool === "laser" ? "laser" : current; }

/** Pick a pen type or a saved pen: switches the tool too (highlighter and laser are their own tools). */
export function choosePen(type: PenType, settings?: Partial<PenSettings>, savedId: string | null = null) {
  if (settings) setPen(settings, type);
  if (type === "highlighter") { setInk({ savedId }); live.activate("hl"); return; }
  if (type === "laser") { setInk({ savedId }); live.activate("laser"); return; }
  setInk({ current: type, savedId });
  live.activate("pen");
}

// thickness slider: 0.5–24 px on a square-root scale (thin pens get most of the track)
const toK = (w: number) => Math.sqrt((w - 0.5) / 23.5);
const fromK = (k: number) => Math.round((0.5 + 23.5 * k * k) * 2) / 2;

function Preview({ type, color, w }: { type: PenType; color: string; w: number }) {
  const m = penMeta(type);
  return (
    <svg width={w} height="20" viewBox="0 0 120 20" preserveAspectRatio="none" className="shrink-0 overflow-visible" aria-hidden>
      <path d={m.pv ?? PEN_PV} style={{ fill: m.pvF ? color : "none", stroke: m.pvC ?? color, strokeWidth: m.pvW2, opacity: m.pvO ?? 1, strokeLinecap: m.pvCap ?? "round", strokeDasharray: m.pvDa ?? "none" }} />
    </svg>
  );
}

export function PenPanel({ api, dark, phone, onClose, docked }: { api: WbAPI | null | undefined; dark: boolean; phone: boolean; onClose: () => void; /** Rendered by the board (not under the toolbar): 60 px from the top. */ docked?: boolean }) {
  const ink = useInk();
  const lv = useLive();
  const saved = useSavedPens();
  const pal = usePalPrefs();
  const palettes = usePalettes(dark, api);
  const [switching, setSwitching] = useState(false);
  const drag = useRef<number | null>(null);
  const type = shownType(lv.tool, ink.current);
  const p = ink.byType[type];
  const set = (x: Partial<PenSettings>) => setPen(x, type);
  const curPal = palettes.find((x) => x.id === pal.palette) ?? palettes[0];
  const colours = curPal.colors.slice(0, 10);
  const savePen = () => {
    if (saved.length >= MAX_SAVED) return toast(t("Up to 8 saved pens. Remove one first (right-click or long-press it)."));
    const id = rid();
    void writeSaved((cur) => [...cur, { ...p, id }]).then(() => setInk({ savedId: id }));
    toast(t("Pen saved"));
  };
  const removePen = (sp: SavedPen) => {
    let before: SavedPen[] = [];
    void writeSaved((cur) => { before = cur; return cur.filter((x) => x.id !== sp.id); });
    toast(t("Pen removed"), { label: t("Undo"), run: () => void writeSaved(() => before) });
  };
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pvW = phone ? 40 : 96;

  return (
    <PanelShell glyph={penMeta(type).glyph} title={t("Pens")} sub={penSub(p)} onClose={onClose} sheet={phone} label={t("Pens")}
      className={phone ? "z-50" : cx("left-1/2 w-[600px] max-w-[calc(100vw-28px)] -translate-x-1/2", docked ? "top-[60px]" : "top-[48px]")}>
      <div className="flex flex-col gap-2">
        <BlockHead h={t("Saved pens")} right={t("Synced · drag to reorder")} />
        <div className="grid grid-cols-8 gap-1">
          {saved.map((sp, i) => (
            <button key={sp.id} type="button" draggable title={`${t(penMeta(sp.type).label)} · ${colourName(sp.color) ? t(colourName(sp.color)!) : sp.color} · ${sp.width} px`}
              onClick={() => choosePen(sp.type, { ...sp }, sp.id)}
              onContextMenu={(e) => { e.preventDefault(); removePen(sp); }}
              onPointerDown={(e) => { if (e.pointerType === "touch") press.current = setTimeout(() => { press.current = null; removePen(sp); }, 600); }}
              onPointerUp={() => { if (press.current) clearTimeout(press.current); }} onPointerLeave={() => { if (press.current) clearTimeout(press.current); }}
              onDragStart={(e) => { drag.current = i; e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { if (drag.current != null) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); const from = drag.current; drag.current = null; if (from == null || from === i) return; void writeSaved((cur) => { const n = [...cur]; const [m] = n.splice(from, 1); n.splice(i, 0, m); return n; }); }}
              className="flex min-h-[40px] flex-col items-center justify-center rounded-[8px] border border-line px-1 py-1.5 hover:bg-surface-2"
              style={ink.savedId === sp.id ? ON_STYLE : undefined}>
              <Glyph name={penMeta(sp.type).glyph} size={20} style={{ color: shown(sp.color, dark) }} />
            </button>
          ))}
          {saved.length < MAX_SAVED && (
            <button type="button" title={t("Save this pen")} aria-label={t("Save this pen")} onClick={savePen} className="flex min-h-[40px] flex-col items-center justify-center rounded-[8px] border border-line text-muted hover:bg-surface-2"><Glyph name="plus" size={20} /></button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <BlockHead h={t("Pen type")} />
        <div className="grid grid-cols-2 gap-x-2 gap-y-[2px]">
          {PEN_TYPES.map((m) => {
            const on = m.type === type;
            return (
              <button key={m.type} type="button" onClick={() => choosePen(m.type)} className={cx("flex min-h-[34px] min-w-0 items-center gap-2 rounded-[8px] border border-transparent px-2 text-start text-[12.5px] hover:bg-surface-2", on && "font-semibold")} style={on ? ON_STYLE : undefined}>
                <Glyph name={m.glyph} size={18} />
                <Preview type={m.type} color={m.type === "highlighter" || m.type === "laser" ? (m.pvC ?? "var(--text)") : "var(--text)"} w={pvW} />
                <span className="min-w-0 flex-1 truncate">{t(m.label)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <BlockHead h={t("Thickness")} right={`${p.width} px`} />
        <div className="grid items-center gap-1" style={{ gridTemplateColumns: "2.4fr repeat(5,1fr)" }}>
          <span className="flex min-h-[24px] items-center px-2"><Slider value={toK(p.width)} min={0} max={1} step={0.005} onChange={(k) => set({ width: fromK(k) })} label={t("Thickness")} /></span>
          {THICK_PRESETS.map((w) => (
            <button key={w} type="button" title={`${w} px`} aria-label={`${w} px`} onClick={() => set({ width: w })} className="flex min-h-[26px] items-center justify-center rounded-full border border-transparent hover:bg-surface-2" style={THICK_PRESETS.reduce((b, x) => (Math.abs(x - p.width) < Math.abs(b - p.width) ? x : b)) === w ? ON_STYLE : undefined}>
              <span className="box-border shrink-0 rounded-[4px] border border-line bg-ink" style={{ width: Math.max(4, w), height: Math.max(4, w) }} />
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <BlockHead h={t("Colour")} right={`${t(curPal.name)} ${switching ? "▴" : "▾"}`} rightColor="var(--text)" onRight={() => setSwitching((s) => !s)} />
        {switching
          ? <PaletteSwitcher list={palettes} current={curPal.id} dark={dark} onPick={(id) => { setPalPrefs({ palette: id }); setSwitching(false); }} />
          : <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(colours.length, 1)},1fr)` }}>
              {colours.map((s, i) => <ColourTile key={s.c + i} c={shown(s.c, dark)} title={s.name ?? (colourName(s.c) ? t(colourName(s.c)!) : s.c)} sel={s.c.toLowerCase() === p.color.toLowerCase()} onClick={() => set({ color: s.c })} />)}
            </div>}
      </div>

      <div className="flex flex-col gap-2">
        <BlockHead h={t("Feel")} />
        <div className={cx("grid gap-x-4 gap-y-1.5", phone ? "grid-cols-1 min-[380px]:grid-cols-2" : "grid-cols-2")}>
          <div className="flex min-h-[34px] items-center gap-2 px-2 text-[12.5px]">
            <span className="flex-1">{t("Opacity")}</span><span className="whitespace-nowrap text-[11px] text-muted">{p.opacity}%</span>
            <Slider value={p.opacity} min={5} max={100} step={5} onChange={(v) => set({ opacity: v })} label={t("Opacity")} />
          </div>
          <div className="flex min-h-[34px] items-center gap-2 px-2 text-[12.5px]">
            <span className="flex-1">{t("Pressure")}</span><span className="whitespace-nowrap text-[11px] text-muted">{t("stylus only")}</span>
            <Tog on={p.pressure} onChange={(v) => set({ pressure: v })} label={t("Pressure")} />
          </div>
        </div>
      </div>
      <Seg items={[["off", t("Smoothing: Off")], ["low", t("Low")], ["high", t("High")]]} value={p.smoothing} onPick={(v) => set({ smoothing: v })} />
      <Seg items={[["soft", t("Pressure curve: Soft")], ["linear", t("Linear")], ["firm", t("Firm")]]} value={p.curve} onPick={(v) => set({ curve: v })} className={p.pressure ? "" : "opacity-50"} />
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          <div className="flex min-h-[34px] min-w-0 items-center gap-2 px-2 text-[12.5px]">
            <Glyph name="line" size={18} /><span className="min-w-0 flex-1 truncate">{t("Draw straight when I pause")}</span>
            <Tog on={p.straight} onChange={(v) => set({ straight: v })} label={t("Draw straight when I pause")} />
          </div>
          <div className="flex min-h-[34px] min-w-0 items-center gap-2 px-2 text-[12.5px]">
            <Glyph name="pen-mode" size={18} /><span className="min-w-0 flex-1 truncate" title={t("Stylus draws, finger pans")}>{t("Stylus draws, finger pans")}</span>
            <span className="whitespace-nowrap text-[11px] text-muted">{t("auto-detected")}</span>
            <Tog on={lv.penMode} onChange={(v) => { live.setPenMode(v); setLive({ penMode: v }); }} label={t("Stylus draws, finger pans")} />
          </div>
        </div>
        <div className="text-[11.5px] leading-[17px] text-muted">{t("Palm rejection is on while pen mode is on. Your hand can rest on the screen.")}</div>
      </div>
    </PanelShell>
  );
}

/** Current pen look for the toolbar slot and the phone dock (glyph + colour as shown on this theme). */
export function penLookOf(tool: string, dark: boolean) {
  const x = getInk();
  const type = shownType(tool, x.current);
  const p = x.byType[type === "highlighter" || type === "laser" ? x.current : type];
  return { glyph: penMeta(p.type).glyph, color: shown(p.color, dark), label: t(penMeta(p.type).label) };
}
