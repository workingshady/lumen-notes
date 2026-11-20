// Layers panel (design 38A Lamplight · 38B Paper · 38C / 44E phone sheet; WBStudio overlay "layers").
import { useEffect, useRef, useState } from "react";
import { t } from "../../../lib/i18n";
import { toast } from "../../../lib/store";
import { Glyph } from "../../Glyph";
import type { WbCtx } from "../hooks";
import { Note, PANEL_END, RowIcon, RowItem } from "../kit";
import { BlockHead, PanelShell, Slider } from "../panel";
import { Pop, Row } from "../ui";
import { ArrangeGrid } from "./Arrange";
import { useLayers, type LayerStore } from "./model";
import { useReorder } from "./reorder";

export function LayersPanel({ ctx, store }: { ctx: WbCtx; store: LayerStore }) {
  useLayers(store);
  const { list, active } = store.meta;
  const counts = store.counts();
  const [edit, setEdit] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; y: number } | null>(null);
  const [selCount, setSelCount] = useState(0);
  // selection size (for "Move selection" and the arrange grid)
  useEffect(() => {
    const read = () => setSelCount(Object.keys((ctx.api?.getAppState().selectedElementIds ?? {}) as object).length);
    read();
    const id = setInterval(read, 300);
    return () => clearInterval(id);
  }, [ctx.api]);
  const rl = useReorder(list.length, (from, to) => store.reorder(list[from].id, to));
  const act = store.byId(active);
  const add = () => { const l = store.add(t("Layer {n}", { n: list.length + 1 })); setEdit(l.id); };
  const del = (id: string) => {
    const name = store.byId(id)?.name ?? "";
    const r = store.remove(id);
    if (r) toast(r.moved ? t("Deleted “{name}”; {n} items moved to “{into}”", { name, n: r.moved, into: r.into }) : t("Deleted “{name}”", { name }));
  };
  return (
    <PanelShell glyph="layers" title={t("Layers")} sub={t("{n} layers", { n: list.length })} onClose={ctx.close} sheet={ctx.phone} portal={ctx.phone} className={ctx.phone ? "!fixed z-50" : PANEL_END} label={t("Layers")}>
      <Note boxed>{t("Layers are a Lumen feature saved inside the .excalidraw file. Other apps see one flat drawing.")}</Note>
      <div className="flex flex-col gap-2">
        <BlockHead h={t("Layers")} right={t("+ Add")} rightColor="var(--accent)" onRight={add} />
        <div ref={rl.list} className="relative grid grid-cols-1 gap-1">
          {list.map((l, i) => (
            <div key={l.id} data-row className="relative">
              {rl.lineBefore(i) && <span className="pointer-events-none absolute -top-[3px] inset-x-1 z-10 h-0.5 rounded-full bg-accent" />}
              <RowItem mh={40} on={l.id === active} op={l.hidden ? 0.55 : 1} onClick={() => store.setActive(l.id)} onDoubleClick={() => setEdit(l.id)}
                onKeyDownCapture={rl.keys(i)} onContextMenu={(e: React.MouseEvent) => { e.preventDefault(); setMenu({ id: l.id, y: (e.currentTarget as HTMLElement).offsetTop + 40 }); }}
                title={t("Click to make active · double-click to rename · right-click for more")}>
                <span {...rl.grip(i)} aria-label={t("Drag to reorder")} className="select-none text-[11px] tracking-[-2px] text-muted">⋮⋮</span>
                {edit === l.id ? (
                  <input autoFocus defaultValue={l.name} dir="auto" aria-label={t("Layer name")} onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => { store.rename(l.id, e.target.value); setEdit(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { e.stopPropagation(); setEdit(null); } }}
                    className="h-7 min-w-0 flex-1 rounded-[6px] border border-accent bg-bg px-1.5 text-[12.5px] outline-none" />
                ) : <span dir="auto" className="min-w-0 flex-1 truncate whitespace-nowrap">{l.name}</span>}
                <span className="whitespace-nowrap text-[11px] text-muted">{t("{n} items", { n: counts.get(l.id) ?? 0 })}</span>
                {(l.opacity ?? 100) !== 100 && <button type="button" title={t("Opacity")} onClick={(e) => { e.stopPropagation(); setMenu({ id: l.id, y: (e.currentTarget.closest("[data-row]") as HTMLElement).offsetTop + 40 }); }} className="whitespace-nowrap rounded-full border border-muted px-[5px] text-[10px] font-semibold text-muted">{l.opacity}%</button>}
                <span className="flex gap-[2px]">
                  <RowIcon glyph={l.hidden ? "layer-hidden" : "eye"} tip={l.hidden ? t("Show layer") : t("Hide layer")} active={!l.hidden} onClick={() => store.toggleHidden(l.id)} />
                  <RowIcon glyph={l.locked ? "lock" : "unlock"} tip={l.locked ? t("Unlock layer") : t("Lock layer")} color={l.locked ? "var(--text)" : undefined} active={l.locked} onClick={() => store.toggleLock(l.id)} />
                </span>
              </RowItem>
            </div>
          ))}
          {rl.lineBefore(list.length) && <span className="pointer-events-none absolute -bottom-[3px] inset-x-1 h-0.5 rounded-full bg-accent" />}
          {menu && (() => { const l = store.byId(menu.id); if (!l) return null; return (
            <Pop onClose={() => setMenu(null)} className="end-0 w-[230px]" style={{ top: menu.y }} label={l.name}>
              <div className="flex items-center gap-2 px-2 py-2 text-[12.5px]"><span className="text-muted">{t("Opacity")}</span><LayerOpacity store={store} id={l.id} /></div>
              <Row glyph="pen" label={t("Rename")} onClick={() => { setMenu(null); setEdit(l.id); }} />
              <Row glyph="trash" label={t("Delete layer")} danger disabled={list.length < 2} onClick={() => { setMenu(null); del(l.id); }} />
            </Pop>
          ); })()}
        </div>
      </div>
      <button type="button" disabled={!selCount} onClick={() => { const n = store.moveSelection(active); if (n) toast(t("Moved {n} items to “{name}”", { n, name: act?.name ?? "" })); }}
        className="flex min-h-[34px] items-center gap-2 rounded-[8px] border border-line px-2 text-start text-[12.5px] hover:bg-surface-2 disabled:opacity-40">
        <Glyph name="move-to-group" size={18} /><span className="min-w-0 flex-1 truncate">{t("Move selection to “{name}”", { name: act?.name ?? "" })}</span>
      </button>
      <div className="flex flex-col gap-2">
        <BlockHead h={t("Arrange")} />
        <ArrangeGrid count={selCount} run={(a) => ctx.arrange?.(a)} />
      </div>
    </PanelShell>
  );
}

function LayerOpacity({ store, id }: { store: LayerStore; id: string }) {
  const l = store.byId(id);
  const [v, setV] = useState(l?.opacity ?? 100);
  const last = useRef(v);
  return (<>
    <Slider value={v} min={10} max={100} step={5} label={t("Layer opacity")} onChange={(n) => { setV(n); last.current = n; store.setOpacity(id, n, false); }} onCommit={() => store.setOpacity(id, last.current, true)} />
    <span className="w-9 text-end tabular-nums text-muted">{v}%</span>
  </>);
}
