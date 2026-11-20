// W3-A panels: Layers (38A–C, 44E), Frames (38D, 41E), Board settings (39A–E, 44F), Present (41A–D).
// Whiteboard puts its stores and actions on the WbCtx; the panels open through the ⋯ menu, header buttons and keys.
import { getLive } from "./pens/live";
import { currentPen } from "./pens/model";
import { registerPanel } from "./hooks";
import { FramesPanel } from "./layers/FramesPanel";
import { LayersPanel } from "./layers/LayersPanel";
import { BoardPresenter } from "./present/BoardPresenter";
import { BoardSettingsPanel } from "./settings/BoardSettingsPanel";
import { boardDark } from "./settings/model";

registerPanel("layers", (ctx) => (ctx.layers ? <LayersPanel ctx={ctx} store={ctx.layers} /> : null));
registerPanel("frames", (ctx) => <FramesPanel ctx={ctx} tick={ctx.tick ?? 0} />);
registerPanel("settings", (ctx) => (ctx.board ? <BoardSettingsPanel ctx={ctx} store={ctx.board} /> : null));
registerPanel("present", (ctx) => {
  if (!ctx.api || !ctx.board) return null;
  const b = ctx.board.get();
  const meta = ctx.presentMeta;
  return <BoardPresenter api={ctx.api} board={b} dark={boardDark(b) ?? getLive().dark} phone={!!ctx.phone} title={meta?.title ?? ""} noteId={ctx.noteId} spaceId={meta?.spaceId ?? ""}
    start={meta?.start} penColor={currentPen().color === "#1e1e1e" ? "#F2A93B" : currentPen().color} onExit={ctx.close} onSaved={ctx.save} />;
});
