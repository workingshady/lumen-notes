// Palettes panel (design 37E Lamplight · 37F Paper; R6Parts part "palettes"): the shipped palettes and the custom palette
// editor (create, name, add from eyedropper or hex, name each colour, drag to reorder, delete). Custom palettes sync.
import { useRef, useState } from "react";
import { t } from "../../../lib/i18n";
import { toast } from "../../../lib/store";
import { Glyph } from "../../Glyph";
import { cx } from "../../ui";
import { Pop, Row } from "../ui";
import { ColourTile, PanelShell } from "../panel";
import { shown } from "../tools";
import type { WbCtx } from "../hooks";
import { useLive } from "../pens/live";
import { pickScreenColour, usePalettes } from "./ColourPopover";
import { colourName, parseHex, setPalPrefs, toHex, usePalPrefs, writeCustom, type Palette } from "./palettes";

const newId = () => Math.random().toString(36).slice(2, 10);

function Card({ p, dark, sel, onUse }: { p: Palette; dark: boolean; sel: string | null; onUse: () => void }) {
  return (
    <div className="box-border flex flex-col overflow-hidden rounded-[14px] border border-line bg-surface" style={{ boxShadow: "0 10px 30px rgba(0,0,0,.14)" }}>
      <button type="button" onClick={onUse} title={t("Use this palette")} className="flex items-center gap-2 border-b border-line px-[14px] pb-[10px] pt-3 text-start">
        <Glyph name={p.glyph ?? "palette"} size={16} className="text-muted" />
        <span className="flex-1 truncate text-[13.5px] font-semibold">{t(p.name)}</span>
        <span className="whitespace-nowrap text-[11.5px] text-muted">{p.id === "okabe" ? p.sub : t(p.sub)}</span>
      </button>
      <div className="grid gap-1 px-[14px] pb-[14px] pt-3" style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(p.colors.length, 1), 6)},1fr)` }}>
        {p.colors.length ? p.colors.map((s, i) => <ColourTile key={s.c + i} c={shown(s.c, dark)} h={30} sel={sel === s.c.toLowerCase()} title={s.name ?? (colourName(s.c) ? t(colourName(s.c)!) : s.c)} />)
          : <span className="col-span-6 text-[11.5px] text-muted">{t("No colours on this board yet.")}</span>}
      </div>
    </div>
  );
}

function Editor({ p, dark, onDelete }: { p: Palette; dark: boolean; onDelete: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(p.name);
  const [hexOpen, setHexOpen] = useState(false);
  const [hex, setHex] = useState("");
  const [menu, setMenu] = useState(false);
  const [editC, setEditC] = useState<number | null>(null);
  const drag = useRef<number | null>(null);
  const upd = (fn: (x: Palette) => Palette) => void writeCustom((cur) => cur.map((x) => (x.id === p.id ? fn(x) : x)));
  const add = (c: string) => upd((x) => ({ ...x, colors: [...x.colors, { c }] }));
  return (
    <div className="box-border flex flex-col overflow-hidden rounded-[14px] border border-line bg-surface md:col-span-2" style={{ boxShadow: "0 10px 30px rgba(0,0,0,.14)" }}>
      <div className="relative flex items-center gap-2 border-b border-line px-[14px] pb-[10px] pt-3">
        <Glyph name="swatch-add" size={16} className="text-muted" />
        <span className="flex-1 truncate text-[13.5px] font-semibold">{p.name}</span>
        <span className="whitespace-nowrap text-[11.5px] text-muted">{t("Custom · synced")}</span>
        <button type="button" data-pop-anchor aria-label={t("More")} onClick={() => setMenu((m) => !m)} className="flex size-[26px] items-center justify-center rounded-[7px] text-muted hover:bg-surface-2"><Glyph name="more" size={15} /></button>
        {menu && (
          <Pop onClose={() => setMenu(false)} className="end-2 top-[40px] w-[200px]">
            <Row glyph="palette" label={t("Use this palette")} onClick={() => { setPalPrefs({ palette: p.id }); setMenu(false); }} />
            <Row glyph="duplicate" label={t("Duplicate")} onClick={() => { setMenu(false); void writeCustom((cur) => [...cur, { ...p, id: newId(), name: t("{name} copy", { name: p.name }) }]); }} />
            <Row glyph="trash" label={t("Delete palette")} danger onClick={() => { setMenu(false); onDelete(); }} />
          </Pop>
        )}
      </div>
      <div className="flex flex-col gap-[14px] px-[14px] pb-[14px] pt-3">
        <div className="flex min-h-[34px] items-center gap-2 rounded-[8px] border border-line px-2 text-[12.5px]">
          {renaming
            ? <input autoFocus value={name} onChange={(e) => setName(e.target.value)} dir="auto" aria-label={t("Palette name")} className="min-w-0 flex-1 bg-transparent font-semibold outline-none"
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setName(p.name); setRenaming(false); } }}
                onBlur={() => { setRenaming(false); const v = name.trim(); if (v && v !== p.name) upd((x) => ({ ...x, name: v })); else setName(p.name); }} />
            : <span dir="auto" className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>}
          <button type="button" onClick={() => setRenaming(true)} className="text-[11px] text-muted hover:text-ink">{t("Rename")}</button>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-muted">{t("Colours · drag to reorder")}</div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {p.colors.map((s, i) => (
              <div key={s.c + i} draggable onDragStart={(e) => { drag.current = i; e.dataTransfer.effectAllowed = "move"; }} onDragOver={(e) => { if (drag.current != null) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); const from = drag.current; drag.current = null; if (from == null || from === i) return; upd((x) => { const c = [...x.colors]; const [m] = c.splice(from, 1); c.splice(i, 0, m); return { ...x, colors: c }; }); }}
                title={s.name ?? s.c} className="group flex min-h-[36px] cursor-grab items-center gap-2 rounded-[8px] border border-line px-2 text-[12.5px]">
                <span className="text-[11px] tracking-[-2px] text-muted">⋮⋮</span>
                <span className="box-border size-[18px] shrink-0 rounded-[4px] border border-line" style={{ background: shown(s.c, dark) }} />
                {editC === i
                  ? <input autoFocus defaultValue={s.name ?? ""} placeholder={t("Name")} dir="auto" aria-label={t("Colour name")} className="min-w-0 flex-1 bg-transparent outline-none"
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditC(null); }}
                      onBlur={(e) => { const v = e.target.value.trim(); setEditC(null); upd((x) => ({ ...x, colors: x.colors.map((y, j) => (j === i ? { c: y.c, name: v || undefined } : y)) })); }} />
                  : <button type="button" onClick={() => setEditC(i)} dir="auto" className={cx("min-w-0 flex-1 truncate text-start", !s.name && "text-muted")}>{s.name ?? t("Name")}</button>}
                <span className="whitespace-nowrap text-[11px] uppercase text-muted">{s.c}</span>
                <button type="button" aria-label={t("Remove colour")} onClick={() => upd((x) => ({ ...x, colors: x.colors.filter((_, j) => j !== i) }))} className="flex size-5 items-center justify-center rounded text-muted opacity-0 hover:text-ink focus:opacity-100 group-hover:opacity-100"><Glyph name="x" size={12} /></button>
              </div>
            ))}
            <button type="button" onClick={async () => { const c = await pickScreenColour(); if (c) add(c.toUpperCase()); }} className="flex min-h-[34px] items-center gap-2 rounded-[8px] border border-line px-2 text-[12.5px] text-muted hover:bg-surface-2"><Glyph name="eyedropper" size={18} />{t("Add from eyedropper")}</button>
            {hexOpen
              ? <form className="flex min-h-[34px] items-center gap-2 rounded-[8px] border border-accent px-2 text-[12.5px]" onSubmit={(e) => { e.preventDefault(); const v = hex.trim(); const x = parseHex(v.startsWith("#") ? v : "#" + v); if (!x) return toast(t("Use a hex colour like #5CC8C2")); add(toHex(x[0], x[1], x[2], x[3])); setHex(""); }}>
                  <Glyph name="plus" size={18} className="text-muted" />
                  <input autoFocus value={hex} onChange={(e) => setHex(e.target.value)} onBlur={() => !hex && setHexOpen(false)} placeholder="#RRGGBB" dir="ltr" aria-label={t("Hex colour")} className="min-w-0 flex-1 bg-transparent uppercase outline-none" />
                </form>
              : <button type="button" onClick={() => setHexOpen(true)} className="flex min-h-[34px] items-center gap-2 rounded-[8px] border border-line px-2 text-[12.5px] text-muted hover:bg-surface-2"><Glyph name="plus" size={18} />{t("Add hex…")}</button>}
          </div>
        </div>
        <div className="text-[11.5px] leading-[17px] text-muted">{t("Swatch names show in tooltips and to screen readers. Delete palette is at the bottom of ⋯.")}</div>
      </div>
    </div>
  );
}

export function PaletteManager({ ctx }: { ctx: WbCtx }) {
  const dark = !!ctx.dark;
  const list = usePalettes(dark, ctx.api);
  const pal = usePalPrefs();
  const lv = useLive();
  const sel = (ctx.style?.strokeColor ?? "").toLowerCase() || null;
  const shipped = list.filter((p) => !p.custom), custom = list.filter((p) => p.custom);
  const focus = lv.panelArg.edit;
  const ordered = focus ? [...custom.filter((p) => p.id === focus), ...custom.filter((p) => p.id !== focus)] : custom;
  const create = () => { const id = newId(); void writeCustom((cur) => [...cur, { id, name: t("New palette"), sub: "", custom: true, colors: [] }]); setPalPrefs({ palette: id }); };
  const del = (p: Palette) => {
    let before: Palette[] = [];
    void writeCustom((cur) => { before = cur; return cur.filter((x) => x.id !== p.id); });
    if (pal.palette === p.id) setPalPrefs({ palette: "lumen" });
    toast(t("Palette “{name}” deleted", { name: p.name }), { label: t("Undo"), run: () => void writeCustom(() => before) });
  };
  return (
    <PanelShell glyph="palette" title={t("Palettes")} sub={t("8 shipped · custom ones sync")} onClose={ctx.close} sheet={!!ctx.phone}
      className={ctx.phone ? "z-50" : "end-[14px] top-[60px] bottom-[60px] w-[700px] max-w-[calc(100%-28px)]"}
      foot={<button type="button" onClick={create} className="flex h-8 items-center gap-1.5 rounded-[8px] bg-accent px-3 text-[12.5px] font-semibold text-accent-fg"><Glyph name="swatch-add" size={15} />{t("New palette")}</button>}>
      {ordered.map((p) => <Editor key={p.id} p={p} dark={dark} onDelete={() => del(p)} />)}
      <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2">
        {shipped.map((p) => <Card key={p.id} p={p} dark={dark} sel={sel} onUse={() => { setPalPrefs({ palette: p.id }); toast(t("{name} is now the active palette", { name: t(p.name) })); }} />)}
      </div>
    </PanelShell>
  );
}
