// PDF note actions: create / find the note for a file, write highlights and reading position, and turn
// highlights into notes, flashcards and canvas cards. Pure formatting lives in pdf-format.ts.
import type { Note } from "../../shared/types";
import { addFile } from "./attachments";
import { createNote, findOrCreateByTitle, updateNote } from "./actions";
import { db, uid } from "./db";
import { t } from "./i18n";
import {
  flashcardLine, highlightsMarkdown, hlCanvasNode, hlNoteBody, newPdfBody, pdfMeta, removeHighlight, setPdfMeta, shortTitle, titleFromFile, upsertHighlight,
  type Highlight, type PdfMeta,
} from "./pdf-format";

/** Where the reader should land when it opens next (canvas file card `#page=4`, library "Continue"). */
export const pdfJump: { noteId: string; page: number; hl: string; at: number } = { noteId: "", page: 0, hl: "", at: 0 };
export function setPdfJump(noteId: string, page: number, hl = "") { Object.assign(pdfJump, { noteId, page, hl, at: Date.now() }); }
export function takePdfJump(noteId: string): { page: number; hl: string } | null {
  if (pdfJump.noteId !== noteId || Date.now() - pdfJump.at > 8000) return null;
  const r = { page: pdfJump.page, hl: pdfJump.hl };
  pdfJump.noteId = "";
  return r;
}

const live = async () => (await db.notes.toArray()).filter((n) => !n.deleted);

/** The pdf note that points at this file, if any. */
export async function pdfNoteFor(file: string): Promise<Note | undefined> {
  return (await live()).find((n) => n.type === "pdf" && pdfMeta(n.body).file === file);
}

/** A unique title in the vault ("Paper", "Paper (2)", …): titles are link targets. */
async function freeTitle(title: string) {
  const taken = new Set((await live()).map((n) => n.title.toLowerCase()));
  if (!taken.has(title.toLowerCase())) return title;
  for (let i = 2; ; i++) if (!taken.has(`${title} (${i})`.toLowerCase())) return `${title} (${i})`;
}

export async function createPdfNote(o: { file: string; name: string; spaceId: string; folderId?: string | null; pages?: number }): Promise<Note> {
  const title = await freeTitle(titleFromFile(o.name));
  return createNote({ type: "pdf", title, spaceId: o.spaceId, folderId: o.folderId ?? null, body: newPdfBody({ title, file: o.file, pages: o.pages }) });
}

/** "Open as PDF note" from an inline PDF card: reuses the note for that file or makes one. */
export async function openOrCreatePdfNote(file: string, name: string, spaceId: string, folderId: string | null = null): Promise<Note> {
  return (await pdfNoteFor(file)) ?? createPdfNote({ file, name, spaceId, folderId });
}

/** "Open as PDF note" on an inline PDF card: in the space of the note being viewed. */
export async function openPdfFromCard(file: string, name: string): Promise<void> {
  const { getUI, openNote, toast } = await import("./store");
  const ui = getUI();
  const cur = ui.noteId ? await db.notes.get(ui.noteId) : undefined;
  const existing = await pdfNoteFor(file);
  const n = existing ?? (await createPdfNote({ file, name, spaceId: cur?.spaceId ?? (ui.spaceId === "all" ? "inbox" : ui.spaceId), folderId: cur?.folderId ?? null }));
  if (!existing) toast(t("Created PDF note “{title}”", { title: n.title }));
  openNote(n.id, "read");
}

/** Upload a PDF (stored like any attachment) and make its note. */
export async function addPdfFile(f: File, spaceId: string, folderId: string | null = null): Promise<Note> {
  const md = await addFile(f);
  const id = /\(att:([^)]+)\)/.exec(md)?.[1];
  if (!id) throw new Error(t("Upload failed"));
  return createPdfNote({ file: `att:${id}`, name: f.name, spaceId, folderId });
}

// ------------------------------------------------------------------ serialized body edits (no lost updates between quick highlights)
const queues = new Map<string, Promise<unknown>>();
export function editBody(noteId: string, fn: (body: string) => string, opts: { keepTime?: boolean } = {}): Promise<void> {
  const prev = queues.get(noteId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const n = await db.notes.get(noteId);
    if (!n) return;
    const body = fn(n.body);
    if (body !== n.body) await updateNote(noteId, { body }, opts);
  }).catch(() => undefined);
  queues.set(noteId, next);
  return next;
}
export const saveHighlight = (noteId: string, h: Highlight) => editBody(noteId, (b) => upsertHighlight(b, h));
export const deleteHighlight = (noteId: string, id: string) => editBody(noteId, (b) => removeHighlight(b, id));
/** Reading position (front matter `page` / `progress` / `pages`); keeps the note's "updated" time. */
export const saveReading = (noteId: string, p: Partial<PdfMeta>) => editBody(noteId, (b) => setPdfMeta(b, p), { keepTime: true });

/** Area highlight image → attachment id (`att:<id>`). */
export async function saveAreaImage(blob: Blob, pdfTitle: string, page: number): Promise<string> {
  const md = await addFile(new File([blob], `${pdfTitle.replace(/[^\w-]+/g, "-").slice(0, 40)}-p${page}-area.png`, { type: "image/png" }));
  const id = /\(att:([^)]+)\)/.exec(md)?.[1];
  if (!id) throw new Error(t("Couldn't save the image"));
  return `att:${id}`;
}

// ------------------------------------------------------------------ highlight → note / flashcard / canvas
export async function noteFromHighlight(pdf: Note, h: Highlight): Promise<Note> {
  const title = await freeTitle(shortTitle(h.quote, `${pdf.title}, p. ${h.page}`).replace(/[[\]#|^]/g, ""));
  return createNote({ title, spaceId: pdf.spaceId, folderId: pdf.folderId, body: hlNoteBody(pdf.title, h, title) });
}
export async function noteFromAll(pdf: Note, hs: Highlight[]): Promise<Note> {
  const title = await freeTitle(`${pdf.title}: highlights`);
  return createNote({ title, spaceId: pdf.spaceId, folderId: pdf.folderId, body: highlightsMarkdown(pdf.title, hs, title) });
}
/** Appends a flashcard line to the note called `target` (created when missing). Returns that note. */
export async function appendFlashcard(target: string, q: string, a: string, pdf: Note, h: Highlight): Promise<Note> {
  const n = await findOrCreateByTitle(target.trim() || `${pdf.title}: cards`, pdf.spaceId);
  const line = flashcardLine(q, a, pdf.title, h);
  await editBody(n.id, (b) => `${b.replace(/\s*$/, "")}\n\n${line}\n`);
  return n;
}
/** Adds a highlight card to a canvas note (to the right of what's there). */
export async function addHighlightToCanvas(canvasId: string, pdf: Note, h: Highlight): Promise<void> {
  await editBody(canvasId, (b) => {
    let c: { nodes?: { x: number; y: number; width: number; height: number }[]; edges?: unknown[] } = {};
    try { c = JSON.parse(b || "{}"); } catch { /* start fresh */ }
    const nodes = c.nodes ?? [];
    const x = nodes.length ? Math.max(...nodes.map((n) => n.x + n.width)) + 40 : 0;
    const y = nodes.length ? Math.min(...nodes.map((n) => n.y)) : 0;
    return JSON.stringify({ nodes: [...nodes, hlCanvasNode(pdf.title, h, x, y, uid().replace(/-/g, "").slice(0, 16))], edges: c.edges ?? [] }, null, 2);
  });
}

/** Drag payload for a highlight (canvas drop target reads it; text/plain is the card text for other apps). */
export const HL_MIME = "application/x-lumen-pdf-highlight";
