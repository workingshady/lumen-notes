// Convert a copy: create the note, open it, and leave the "Undo conversion" chip (Lumen 52 · scene "Undo conversion chip").
// The original is never changed. Undo deletes the copy (a tombstone, so other devices drop it too) and goes back.
import type { Note } from "../../../shared/types";
import { createNote, trashNote } from "../actions";
import { openNote } from "../store";
import { convertSource, type ConvertSource } from "./index";
import type { Target, Workspace } from "./model";

export interface ConversionChip { noteId: string; fromId?: string; fromTitle: string; from: Workspace }
let chip: ConversionChip | null = null;
const subs = new Set<() => void>();
export const getConversionChip = () => chip;
export const onConversionChip = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function setConversionChip(c: ConversionChip | null) { chip = c; subs.forEach((f) => f()); }

/** Create the converted copy and open it with the chip. Throws ConvertError when there is nothing to convert. */
export async function convertCopy(src: ConvertSource, to: Target): Promise<{ note: Note; summary: string }> {
  const r = await convertSource(src, to);
  const note = await createNote({ type: r.type, title: r.title, body: r.body, spaceId: src.spaceId, folderId: src.folderId });
  setConversionChip({ noteId: note.id, fromId: src.id, fromTitle: src.title, from: src.kind });
  openNote(note.id);
  return { note, summary: r.summary };
}

export async function undoConversion(c: ConversionChip) {
  await trashNote(c.noteId);
  setConversionChip(null);
  if (c.fromId) openNote(c.fromId);
}
