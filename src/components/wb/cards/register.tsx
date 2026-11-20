// Hooks the Convert menu into the whiteboard / Board header (W3-B). Imported for its side effect by ../NoteCard (which Whiteboard
// already imports), so no Whiteboard edit is needed:
//   registerPanel("convert") → the floating panel (⋯ menu › Convert to…), a bottom sheet on phones (40H, 52A, 44 phone)
import { useMemo } from "react";
import { sourceOf } from "../../../lib/convert";
import { useVaultSelector } from "../../../lib/store";
import { registerPanel, type WbCtx } from "../hooks";
import { ConvertMenu } from "./ConvertMenu";

/** Source = the live scene (elements incl. files) of the board that is open, under the note's title and place. */
function WbConvert({ ctx }: { ctx: WbCtx }) {
  const note = useVaultSelector((v) => v.byId.get(ctx.noteId));
  const source = useMemo(() => () => {
    const api = ctx.api;
    const body = api
      ? JSON.stringify({ type: "excalidraw", version: 2, source: "lumen", elements: api.getSceneElementsIncludingDeleted(), appState: {}, files: api.getFiles() })
      : note?.body ?? "";
    return { ...sourceOf(note ?? { id: ctx.noteId, type: ctx.kind, title: "Untitled", body, spaceId: "", folderId: null }), kind: ctx.kind, body };
  }, [ctx.api, ctx.noteId, ctx.kind, note?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!note) return null;
  return <ConvertMenu source={source} onClose={ctx.close} phone={ctx.phone} />;
}

registerPanel("convert", (ctx) => <WbConvert ctx={ctx} />);
