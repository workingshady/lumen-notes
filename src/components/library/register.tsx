// Hooks the shared library into the whiteboard (W2-B). Imported once by Whiteboard.tsx (`import "./library/register";`).
//   registerPanel("library")  → the floating Library panel (header ⋯ menu / shortcut / openPanel("library")); a bottom sheet on phones (36C, 44D)
//   registerWb("shapes")      → the Shapes split-button caret opens the same panel (36A)
// The connector / shape-style / text / sticky / stamp popovers are exported from ./Popovers and mounted by the property bar:
// see `libraryPopover()` below for the key → component map.
import { selectedIsVendor } from "../../lib/library-items";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placeOnBoard } from "../../lib/library-items";
import { registerPanel, registerWb, type WbCtx } from "../wb/hooks";
import { LibraryPanel } from "./LibraryPanel";
import { ConnectorPopover, FillStrokePopover, InsertIconPopover, LookPopover, StampsPopover, StickyPopover, TextPopover } from "./Popovers";

const place = (ctx: WbCtx) => async (item: Parameters<typeof placeOnBoard>[1], o?: Parameters<typeof placeOnBoard>[2]) => {
  if (!ctx.api) return;
  await placeOnBoard(ctx.api as never, item, o);
  ctx.save();
};

function usePhone() {
  const [p, setP] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(max-width: 767px)").matches);
  useLayoutEffect(() => { const m = matchMedia("(max-width: 767px)"), f = () => setP(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return p;
}

function FloatingLibrary({ ctx }: { ctx: WbCtx }) {
  const phone = usePhone();
  useLayoutEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement)?.closest?.("input,textarea")) ctx.close(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [ctx]);
  if (phone) {
    return (
      <>
        <div className="absolute inset-0 z-30 bg-black/30" onPointerDown={ctx.close} />
        <div data-wb-chrome className="sheet-in absolute inset-x-0 bottom-0 z-40 flex max-h-[72%] flex-col" onPointerDown={(e) => e.stopPropagation()}>
          <div className="flex justify-center rounded-t-[20px] bg-surface pt-2"><span className="h-1 w-9 rounded-full bg-line" /></div>
          <LibraryPanel workspace={ctx.kind} variant="sheet" onClose={ctx.close} onPlace={place(ctx)} selectedVendor={ctx.api ? selectedIsVendor(ctx.api as never) : false} width="100%" />
        </div>
      </>
    );
  }
  return (
    <div data-wb-chrome className="absolute z-30 flex" style={{ left: 14, top: 108, bottom: 60, width: 320, maxHeight: "calc(100% - 168px)" }} onPointerDown={(e) => e.stopPropagation()}>
      <LibraryPanel workspace={ctx.kind} onClose={ctx.close} onPlace={place(ctx)} selectedVendor={ctx.api ? selectedIsVendor(ctx.api as never) : false} />
    </div>
  );
}

/** Shapes caret: opens the library panel where the design draws it (left of the board); the toolbar's own 200 px popover frame stays an empty sliver behind it. */
function ShapesSlot({ ctx }: { ctx: WbCtx }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [r, setR] = useState<DOMRect | null>(null);
  useLayoutEffect(() => { const c = (ref.current?.closest(".excalidraw") ?? document.querySelector(".excalidraw"))?.getBoundingClientRect(); setR(c ?? null); const pop = ref.current?.closest("[role=menu]") as HTMLElement | null; if (pop) { pop.style.opacity = "0"; pop.style.pointerEvents = "none"; } }, []);
  return (
    <>
      <span ref={ref} style={{ display: "block", height: 1 }} />
      {r && createPortal(
        <div data-pop-anchor data-wb-chrome style={{ position: "fixed", left: r.left + 14, top: r.top + 60, bottom: Math.max(8, innerHeight - r.bottom + 60), zIndex: 60, display: "flex" }}>
          <LibraryPanel workspace={ctx.kind} onClose={ctx.close} onPlace={place(ctx)} selectedVendor={ctx.api ? selectedIsVendor(ctx.api as never) : false} />
        </div>, document.body)}
    </>
  );
}

registerPanel("library", (ctx) => <FloatingLibrary ctx={ctx} />);
registerWb("shapes", (ctx) => <ShapesSlot ctx={ctx} />);

/**
 * Property-bar popover bodies. `key` is PropertyBar's popover key, `mode` its BarMode. Mount:
 *   in PropertyBar.body(): `const lib = libraryPopover(open, mode, ctx); if (lib) return lib;` before the switch.
 */
export function libraryPopover(key: string | null, mode: string, ctx: WbCtx): ReactNode | null {
  const line = mode === "line" || mode === "tool-line";
  switch (key) {
    case "heads": case "type": return <ConnectorPopover ctx={ctx} />;
    case "width": return line ? <ConnectorPopover ctx={ctx} /> : <FillStrokePopover ctx={ctx} />;
    case "fillStyle": return <FillStrokePopover ctx={ctx} />;
    case "rough": case "edges": return <LookPopover ctx={ctx} />;
    case "font": return <TextPopover ctx={ctx} />;
    case "size": return mode === "sticky" ? <StickyPopover ctx={ctx} /> : <TextPopover ctx={ctx} />;
    case "stamps": return <StampsPopover ctx={ctx} />;
    case "icons": return <InsertIconPopover ctx={ctx} />;
    default: return null;
  }
}
export { ConnectorPopover, FillStrokePopover, InsertIconPopover, LookPopover, StampsPopover, StickyPopover, TextPopover };
