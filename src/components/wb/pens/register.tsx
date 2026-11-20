// W2-A registration: pens (toolbar pen slot), palette (property-bar colour popovers), lasso, ink extras, pen look,
// and the "palette" (palette manager), "handwriting" and "pens" panels. Imported once by Whiteboard.
import { registerPanel, registerWb, type WbCtx } from "../hooks";
import { ColourPopover } from "../palette/ColourPopover";
import { PaletteManager } from "../palette/PaletteManager";
import { shown } from "../tools";
import type { El } from "./engine";
import { HandwritingPanel } from "./Handwriting";
import { InkExtras } from "./InkBars";
import { getLive, setLive } from "./live";
import { PenPanel, penLookOf } from "./PenPanel";

/** [text colour, fill colour] of the selection, for the AA warning (shapes with text, stickies, text on the board). */
function contrastPair(ctx: WbCtx, target: "stroke" | "fill"): [string, string] | null {
  const a = ctx.api;
  if (!a) return null;
  const sel = (a.getAppState().selectedElementIds ?? {}) as Record<string, boolean>;
  const els = a.getSceneElements() as El[];
  const chosen = els.filter((e) => sel[e.id]);
  const dark = !!ctx.dark;
  const boardBg = dark ? "#0F1115" : "#FAF8F3";
  for (const e of chosen) {
    // bound text, else free text sitting on the shape (its centre inside the shape: 37C "forward" on an Okabe-orange box)
    const inside = (x: El) => { const cx = Number(x.x) + Number(x.width) / 2, cy = Number(x.y) + Number(x.height) / 2; return cx >= Number(e.x) && cx <= Number(e.x) + Number(e.width) && cy >= Number(e.y) && cy <= Number(e.y) + Number(e.height); };
    const txt = els.find((x) => x.type === "text" && x.containerId === e.id) ?? (e.type !== "text" ? els.find((x) => x.type === "text" && !x.containerId && !x.isDeleted && inside(x)) : undefined);
    if (txt && target === "fill") { const fill = String(e.backgroundColor ?? "transparent"); if (fill !== "transparent") return [shown(String(txt.strokeColor), dark), shown(fill, dark)]; }
    if (e.type === "text" && target === "stroke") {
      const box = e.containerId ? els.find((x) => x.id === e.containerId) : null;
      const bg = box && box.backgroundColor !== "transparent" ? String(box.backgroundColor) : boardBg;
      return [shown(String(e.strokeColor), dark), shown(bg, dark)];
    }
  }
  return null;
}

registerWb("pens", (ctx) => <PenPanel api={ctx.api} dark={!!ctx.dark} phone={!!ctx.phone} onClose={ctx.close} />);
registerWb("palette", (ctx) => {
  const st = ctx.style;
  const value = ctx.target === "fill" ? st?.backgroundColor ?? null : st?.strokeColor ?? null;
  return (
    <ColourPopover api={ctx.api} dark={!!ctx.dark} phone={!!ctx.phone} target={ctx.target === "fill" ? "fill" : "stroke"} value={value} opacity={st?.opacity ?? null} exact={st?.exact ?? null}
      pair={contrastPair(ctx, ctx.target === "fill" ? "fill" : "stroke")}
      onPick={(c) => ctx.setStyle?.(ctx.target === "fill" ? { backgroundColor: c } : { strokeColor: c })}
      onOpacity={(n) => ctx.setStyle?.({ opacity: n })} onExact={(v) => ctx.setStyle?.({ exact: v })} onClose={ctx.close} />
  );
});
registerWb("lasso", () => setLive({ tool: "lasso" }));
registerWb("inkExtras", (ctx) => <InkExtras phone={!!ctx.phone} />);
registerWb("penLook", () => penLookOf(getLive().tool, getLive().dark));
registerPanel("palette", (ctx) => <PaletteManager ctx={ctx} />);
registerPanel("handwriting", (ctx) => <HandwritingPanel ctx={ctx} />);
registerPanel("pens", (ctx) => <PenPanel api={ctx.api} dark={!!ctx.dark} phone={!!ctx.phone} onClose={ctx.close} docked />);

