// Opening the note Export dialog (components/NoteExport.tsx) and remembering its settings per device.
import type { Note } from "../../shared/types";
import { t } from "./i18n";
import type { ExportRequest, Format, Scope } from "./print-run";
import { PRINT_DEFAULTS, type PrintOptions } from "./print-doc";

export interface NoteExportPrefs extends PrintOptions { format: Format; htmlFolder: boolean; engine: ExportRequest["engine"] }
export const NOTE_EXPORT_EVENT = "lumen:note-export";
export const NOTE_EXPORT_DEFAULTS: NoteExportPrefs = { ...PRINT_DEFAULTS, format: "pdf", htmlFolder: false, engine: "auto" };
const KEY = "lumen.noteexport.v1";

export type ScopeKey = "note" | "selection" | "folder" | "space";
/** What the dialog is opened for: the scopes on offer (each with its own title), the one to start on, and optionally a format. */
export interface NoteExportJob { scopes: Partial<Record<ScopeKey, { scope: Scope; title: string }>>; start: ScopeKey; format?: Format }

export function loadNoteExportPrefs(): NoteExportPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...NOTE_EXPORT_DEFAULTS, ...(JSON.parse(raw) as Partial<NoteExportPrefs>) };
  } catch { /* private window / blocked storage: defaults */ }
  return { ...NOTE_EXPORT_DEFAULTS };
}
export function saveNoteExportPrefs(p: NoteExportPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage full or blocked: not remembered */ }
}
/** Open the dialog. Cheap to import: the dialog itself is a lazy chunk. */
export function openNoteExport(job: NoteExportJob) {
  window.dispatchEvent(new CustomEvent(NOTE_EXPORT_EVENT, { detail: job }));
}

/** The dialog for one note: this note, its folder, its space. */
export function noteExportJob(n: Pick<Note, "id" | "title" | "folderId" | "spaceId">, names: { folder?: string; space?: string }, format?: Format): NoteExportJob {
  return {
    start: "note", format,
    scopes: {
      note: { scope: { kind: "note", ids: [n.id] }, title: n.title },
      ...(n.folderId ? { folder: { scope: { kind: "folder", folderId: n.folderId } as Scope, title: names.folder ?? t("Folder") } } : {}),
      space: { scope: { kind: "space", spaceId: n.spaceId }, title: names.space ?? t("Space") },
    },
  };
}
export const selectionExportJob = (ids: string[]): NoteExportJob => ({ start: "selection", scopes: { selection: { scope: { kind: "selection", ids }, title: t("{n} notes", { n: ids.length }) } } });
export const folderExportJob = (f: { id: string; name: string; spaceId: string }, spaceName: string): NoteExportJob => ({
  start: "folder", scopes: { folder: { scope: { kind: "folder", folderId: f.id }, title: f.name }, space: { scope: { kind: "space", spaceId: f.spaceId }, title: spaceName } },
});
export const spaceExportJob = (s: { id: string; name: string }): NoteExportJob => ({ start: "space", scopes: { space: { scope: { kind: "space", spaceId: s.id }, title: s.name } } });
