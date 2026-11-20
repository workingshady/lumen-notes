import { restoreNote, trashNote } from "./actions";
import { db } from "./db";
import { t } from "./i18n";
import { getUI, openNote, setUI, toast } from "./store";

/** Move notes to Trash with the usual Undo toast (Ctrl/⌘Z runs it). Closes the open note if it is among them. */
export async function trashWithUndo(ids: string[], title?: string) {
  const list = [...ids];
  if (!list.length) return;
  if (list.length === 1 && title === undefined) title = (await db.notes.get(list[0]))?.title ?? "";
  const openId = getUI().noteId;
  const wasOpen = !!openId && list.includes(openId);
  for (const id of list) await trashNote(id);
  if (wasOpen) setUI({ noteId: null });
  const undo = () => { for (const id of list) void restoreNote(id); if (wasOpen && openId) openNote(openId); };
  toast(list.length === 1 && title !== undefined ? t("“{title}” moved to Trash", { title }) : t("Moved {n} notes to Trash", { n: list.length }), { label: t("Undo"), run: undo });
}
