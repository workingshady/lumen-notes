// Auto-save diagrams (Settings › Diagrams › "Save new diagrams to canvas automatically").
// A few seconds after a note stops changing, every Mermaid block that has no saved file yet is saved to the note's
// diagram canvas (file in the diagrams folder), and a saved diagram whose block changed updates its file.
import { db } from "./db";
import { diagramFiles, fileFor, mermaidBlocks, saveDiagramFile, saveDiagramToCanvas } from "./diagrams";
import { t } from "./i18n";
import { getSettings } from "./settings";
import { getVault, toast } from "./store";
import { isWbType } from "../../shared/types";

const IDLE_MS = 4000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Set<string>();

export function scheduleDiagramAutoSave(noteId: string) {
  if (!getSettings().diagramAutoSave) return;
  clearTimeout(timers.get(noteId));
  timers.set(noteId, setTimeout(() => { timers.delete(noteId); void run(noteId); }, IDLE_MS));
}

async function run(noteId: string) {
  if (running.has(noteId) || !getSettings().diagramAutoSave) return;
  running.add(noteId);
  try {
    const note = await db.notes.get(noteId);
    if (!note || note.deleted || note.type === "canvas" || isWbType(note.type) || note.type === "diagram") return;
    const blocks = mermaidBlocks(note.body);
    if (!blocks.length) return;
    const v = getVault();
    let notes = v.notes;
    let added = 0, updated = 0, canvasId = "";
    for (const b of blocks) {
      const found = fileFor(diagramFiles(notes), note.id, b);
      if (!found) {
        const r = await saveDiagramToCanvas(note, b, notes, v.folders);
        notes = [...notes, r.file];
        canvasId = r.canvasId;
        added++;
      } else if (found.stale) {
        await saveDiagramFile(note, b, notes, { folders: v.folders });
        updated++;
      }
    }
    if (added) toast(t("{n} new diagram saved to the canvas|{n} new diagrams saved to the canvas", { n: added }), canvasId ? { label: t("Open"), run: () => void import("./store").then((s) => s.openNote(canvasId)) } : undefined);
    else if (updated) toast(t("{n} diagram file updated|{n} diagram files updated", { n: updated }));
  } catch (e) {
    console.warn("diagram auto-save failed", e);
  } finally { running.delete(noteId); }
}
