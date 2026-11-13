import { EditorView } from "@codemirror/view";
import { openNote } from "../lib/store";
import { scrollEditorToLine } from "./Editor";

/** Open a note in edit mode with the cursor on `line` (0-based, counted in the full body incl. front-matter). */
export function openNoteAtLine(noteId: string, line: number, body?: string) {
  openNote(noteId, "edit");
  let tries = 0;
  const t = setInterval(() => {
    const el = document.querySelector<HTMLElement>(".cm-editor");
    const view = el ? EditorView.findFromDOM(el) : null;
    const ready = view && (body === undefined || view.state.doc.toString() === body);
    if (ready || ++tries > 60) {
      clearInterval(t);
      if (view) requestAnimationFrame(() => scrollEditorToLine(line));
    }
  }, 50);
}

/** Line of a flashcard's question in the note body (−1 if not found). */
export function cardLine(body: string, q: string) {
  const first = q.split("\n")[0].trim();
  const lines = body.split("\n");
  const k = lines.findIndex((l) => l.includes(first) && /\s::\s/.test(l));
  return k >= 0 ? k : lines.findIndex((l, i) => l.trim() === first && lines[i + 1]?.trim() === "?");
}
