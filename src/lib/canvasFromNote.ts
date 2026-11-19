import type { Note } from "../../shared/types";
import { fromOutline, stringify } from "./canvas";
import { t } from "./i18n";
import { toast } from "./store";

/** Build a canvas note from a Markdown note's outline (headings + bullets → tree). */
export async function canvasFromNote(n: Note, createNote: (p: Partial<Note>) => Promise<Note>) {
  const c = fromOutline(n.body);
  if (!c.nodes?.length) { toast(t("No headings or bullets to map")); return null; }
  return createNote({ type: "canvas", title: `${n.title} (map)`, body: stringify(c), spaceId: n.spaceId, folderId: n.folderId });
}
